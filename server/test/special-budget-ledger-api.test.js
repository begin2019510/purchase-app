'use strict';
// 特殊预算 v3.2.4 台账 / 审计 / 快照 / CSV 导出测试（只操作 purchase_app_test 隔离库）
// 覆盖：只读口径、本人/全局 scope、月度与年度归集、对账、时间线、快照幂等与未来月份拦截、
//       CSV（BOM / 指纹 / 公式注入防护）、405/400/401。
// 用法: PURCHASE_DB_NAME=purchase_app_test PURCHASE_SPECIAL_BUDGET=1 node server/test/special-budget-ledger-api.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';
process.env.PURCHASE_SPECIAL_BUDGET = '1';

const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const cfg = require('../src/config');
const db = require('../src/db');
const A = require('../src/lib/special-budget/approvals');
const F = require('../src/lib/special-budget/funds');
const C = require('../src/lib/special-budget/config-service');
const L = require('../src/lib/special-budget/ledger');
const { parseJWT } = require('../src/middleware');

const U = 'sb_ledger_u';
const X = 'sb_ledger_x';
let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok', name); }
  else { console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); process.exitCode = 1; }
}
function at(s) { return new Date(s + (s.length === 16 ? ':00+08:00' : '+08:00')); }
function key(p) { return (p || 'k') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

function migrate(script) {
  const r = spawnSync(process.execPath, [script, '--apply'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PURCHASE_DB_NAME: 'purchase_app_test' }),
    encoding: 'utf8', timeout: 60000,
  });
  if (r.status !== 0) throw new Error('migrate failed: ' + ((r.stdout || '') + (r.stderr || '')));
}
async function fresh() {
  for (const t of ['special_budget_idempotency', 'special_budget_events', 'special_budget_schedules',
    'special_budget_links', 'special_budget_approvals', 'special_budget_snapshots', 'special_budget_rules']) {
    await db.exec(`DELETE FROM ${t}`);
  }
  migrate('scripts/migrate-special-budget.js');
  migrate('scripts/migrate-special-budget-v321.js');
}
async function ensureUser(name) {
  const row = await db.one('SELECT id FROM users WHERE username = ?', [name]);
  if (row) return row.id;
  const ins = await db.exec(
    'INSERT INTO users (username, password_hash, salt, hash_version, is_admin) VALUES (?,?,?,1,0)',
    [name, '0'.repeat(64), '0'.repeat(32)]);
  return ins.insertId;
}
async function mkNeed(uid, name) {
  const r = await db.exec(
    'INSERT INTO purchase_needs (user_id, name, status, category) VALUES (?,?,?,?)',
    [uid, name, '已定点', '其他']);
  return r.insertId;
}
async function mkOrder(uid, needId, price) {
  const r = await db.exec(
    `INSERT INTO purchase_orders
       (user_id, need_id, role, qty, price_paid, status, date_ms, arrived_at, budget_type)
     VALUES (?,?, 'formal', 1, ?, '已下单', ?, NULL, 'general')`,
    [uid, needId, price, Date.parse('2026-12-10T10:00:00+08:00')]);
  return r.insertId;
}

(async () => {
  if (!cfg.SERVICE_TOKEN) { console.error('FAIL 缺少 SERVICE_TOKEN'); process.exit(1); }
  let server = null;
  try {
    await fresh();
    const uid = await ensureUser(U);
    await ensureUser(X);

    // ---------------- 种子数据：300 元普通审批 → 付款 → 部分退款 50 ----------------
    const sub = await A.submit({
      username: U, type: 'normal', amount: 300, purpose: '台账测试', installments: 1,
      now: at('2026-12-01T10:00'), idemKey: key('sub'),
    });
    const aid = sub.body.approval.id;
    await A.approve({ username: U, id: aid, now: at('2026-12-01T10:05'), idemKey: key('ap') });
    const needId = await mkNeed(uid, '台账测试需求');
    const orderId = await mkOrder(uid, needId, 300);
    await A.linkOrder({ username: U, id: aid, orderId, amount: 300, now: at('2026-12-02T09:00'), idemKey: key('link') });
    await F.payOrder({ username: U, orderId, now: at('2026-12-02T10:00'), idemKey: key('pay') });
    await F.refundOrder({
      username: U, orderId, amount: 50, reason: '部分退款',
      releaseFuture: true, now: at('2026-12-03T10:00'), idemKey: key('refund'),
    });

    const app = express();
    app.use('/api', (req, res, next) => {
      if (req.headers['x-service-token'] !== cfg.SERVICE_TOKEN) return res.status(403).json({ error: 'forbidden' });
      next();
    });
    app.use(express.json({ limit: '8mb' }));
    app.use(parseJWT);
    app.use('/api', require('../src/routes/special-budget'));
    app.use((req, res) => res.status(404).json({ error: 'not_found' }));

    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;

    async function req(method, p, opts) {
      const o = opts || {};
      const headers = { 'Content-Type': 'application/json' };
      if (o.token !== false) headers['X-Service-Token'] = cfg.SERVICE_TOKEN;
      if (o.auth !== false) headers['X-Auth-User'] = o.user || U;
      if (o.key) headers['Idempotency-Key'] = o.key;
      const r = await fetch(base + p, {
        method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body),
      });
      let data = null;
      try { data = await r.json(); } catch (e) {}
      return { status: r.status, data, allow: r.headers.get('allow') };
    }
    async function raw(p, opts) {
      const o = opts || {};
      const headers = {};
      if (o.token !== false) headers['X-Service-Token'] = cfg.SERVICE_TOKEN;
      if (o.auth !== false) headers['X-Auth-User'] = o.user || U;
      const r = await fetch(base + p, { headers });
      return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() };
    }

    // ---------------- 0. 只读边界 / 参数 ----------------
    ok('csvCell 防公式注入 =', L.csvCell('=1+2') === "'=1+2", L.csvCell('=1+2'));
    ok('csvCell 防公式注入 @', L.csvCell('@cmd') === "'@cmd");
    ok('csvCell 正常文本加引号', L.csvCell('a,b') === '"a,b"', L.csvCell('a,b'));
    const saved = cfg.SPECIAL_BUDGET_ENABLED;
    cfg.SPECIAL_BUDGET_ENABLED = false;
    let r = await req('GET', '/api/special-budget/ledger?year=2026&month=12');
    ok('开关关闭 → 404', r.status === 404, JSON.stringify(r.data));
    cfg.SPECIAL_BUDGET_ENABLED = saved;
    r = await req('GET', '/api/special-budget/ledger?year=2026&month=12', { auth: false });
    ok('无身份 → 401', r.status === 401);
    r = await req('GET', '/api/special-budget/ledger?year=2025&month=12');
    ok('非法年份 → 400 INVALID_YEAR', r.status === 400 && r.data.error === 'INVALID_YEAR', JSON.stringify(r.data));
    r = await req('POST', '/api/special-budget/ledger', { body: {} });
    ok('台账 POST → 405 + Allow GET', r.status === 405 && r.allow === 'GET', JSON.stringify({ s: r.status, a: r.allow }));

    // ---------------- 1. 台账口径 ----------------
    r = await req('GET', '/api/special-budget/ledger?year=2026&month=12');
    const led = r.data || {};
    ok('台账 200 / 只读 / 本人 scope', r.status === 200 && led.ok === true &&
      led.readonly === true && led.scope === 'self' && led.permissions.write === false, JSON.stringify(led.permissions));
    ok('月度 12 行', Array.isArray(led.monthly) && led.monthly.length === 12);
    ok('年度已占用 = 300 − 50 = 250', led.annual && led.annual.annual_committed === 250,
      JSON.stringify(led.annual));
    ok('年度剩余 = 1000 − 250 = 750', led.annual && led.annual.annual_remaining === 750, JSON.stringify(led.annual));
    ok('年度已退 50 / 已付 300', led.annual && led.annual.annual_refunded === 50 && led.annual.annual_paid === 300,
      JSON.stringify(led.annual));
    const dec = (led.monthly || [])[11] || {};
    ok('12 月付款 300 / 退款 50 / 净现金流 250',
      dec.paid_amount === 300 && dec.refunded_amount === 50 && dec.net_cash === 250, JSON.stringify(dec));
    ok('审批追溯含分期/付款/退款汇总', (led.approvals || []).length === 1 &&
      led.approvals[0].approval_no === sub.body.approval.approval_no &&
      led.approvals[0].paid_amount === 300 && led.approvals[0].refunded_amount === 50 &&
      led.approvals[0].event_count >= 4, JSON.stringify(led.approvals[0]));
    ok('年度分段含 2026 / 2027', (led.schedule_years || []).length >= 1 &&
      led.schedule_years.some(x => x.year === 2026 && x.committed === 250), JSON.stringify(led.schedule_years));
    ok('计算过程 4 条且结果可核对', (led.formulas || []).length === 4 &&
      led.formulas[0].key === 'annual_committed' && led.formulas[0].result === 250, JSON.stringify(led.formulas));
    ok('审计指纹 64 位', /^[0-9a-f]{64}$/.test(String(led.fingerprint || '')), String(led.fingerprint));
    ok('对账无差异', led.reconciliation && led.reconciliation.reconciled === true &&
      led.reconciliation.difference === 0, JSON.stringify(led.reconciliation));
    const fp1 = led.fingerprint;

    r = await req('GET', '/api/special-budget/ledger?year=2026&month=12', { user: X });
    ok('他人台账 scope=self 且不串数据', r.status === 200 && r.data.scope === 'self' &&
      r.data.approvals.length === 0 && r.data.annual.annual_committed === 0, JSON.stringify(r.data.annual));
    r = await req('GET', '/api/special-budget/ledger?year=2026&month=12', { user: 'admin' });
    ok('admin 台账 scope=global 且看到全局 250', r.status === 200 && r.data.scope === 'global' &&
      r.data.approvals.length === 1 && r.data.annual.annual_committed === 250, JSON.stringify(r.data.annual));

    // ---------------- 2. 时间线 ----------------
    r = await req('GET', '/api/special-budget/timeline?year=2026&limit=200');
    const tl = r.data || {};
    ok('时间线 200 / 只读', r.status === 200 && tl.readonly === true && tl.scope === 'self');
    const types = (tl.events || []).map(e => e.event_type);
    ok('时间线覆盖提交/批准/关联/付款/退款',
      ['submit', 'approve', 'link', 'pay', 'refund'].every(t => types.indexOf(t) >= 0), JSON.stringify(types));
    ok('时间线事件带中文标签和操作人', (tl.events || []).every(e => e.event_label && e.actor),
      JSON.stringify((tl.events || [])[0]));
    ok('时间线含配置历史（只读）', Array.isArray(tl.config_history) && tl.config_history.length >= 1 &&
      tl.config_history_readonly === true, JSON.stringify({ h: (tl.config_history || []).length }));
    r = await req('GET', '/api/special-budget/timeline?year=2026&limit=200', { user: X });
    ok('他人时间线不含本人事件', r.status === 200 && r.data.scope === 'self' && r.data.events.length === 0,
      JSON.stringify(r.data.events));

    // ---------------- 3. 快照 ----------------
    r = await req('GET', '/api/special-budget/snapshots?year=2026');
    ok('快照列表 200 / 只读', r.status === 200 && r.data.ok === true && r.data.readonly === true);
    ok('试运行前不把 12 月列为已到期快照', Array.isArray(r.data.expected_months) &&
      r.data.expected_months.indexOf(12) < 0 && r.data.snapshots.length === 0,
      JSON.stringify({ e: r.data.expected_months, m: r.data.missing_months, s: r.data.snapshots }));
    r = await req('POST', '/api/special-budget/snapshots', { body: { year: 2026, month: 12 } });
    ok('快照缺幂等键 → 400', r.status === 400 && r.data.error === 'IDEMPOTENCY_KEY_REQUIRED', JSON.stringify(r.data));
    r = await req('POST', '/api/special-budget/snapshots', { key: key('snap'), body: { year: 2026, month: 12 } });
    ok('未来月份快照 → 400 FUTURE_PERIOD', r.status === 400 && r.data.error === 'FUTURE_PERIOD', JSON.stringify(r.data));

    const snapKey = 'ledger-snap-nov-1';
    r = await req('POST', '/api/special-budget/snapshots', { key: snapKey, body: { year: 2026, month: 11 } });
    ok('可生成已过月份快照', r.status === 200 && r.data.ok === true && r.data.snapshot.month === 11 &&
      /^[0-9a-f]{64}$/.test(r.data.snapshot.fingerprint), JSON.stringify(r.data));
    const novId = r.data.snapshot && r.data.snapshot.fingerprint;
    r = await req('POST', '/api/special-budget/snapshots', { key: snapKey, body: { year: 2026, month: 11 } });
    ok('快照幂等重放同指纹', r.status === 200 && r.data.snapshot.fingerprint === novId, JSON.stringify(r.data));

    const servSnap = await L.generateSnapshot({
      username: U, year: 2026, month: 12, now: at('2026-12-03T12:00'), idemKey: key('snap-svc'),
    });
    ok('服务层可为 12 月按指定时间生成快照', servSnap.status === 200 && servSnap.body.snapshot.month === 12,
      JSON.stringify(servSnap.body));
    r = await req('GET', '/api/special-budget/snapshots?year=2026');
    ok('快照列表包含已生成的 11/12 月', r.status === 200 &&
      r.data.snapshots.some(s => s.month === 11) && r.data.snapshots.some(s => s.month === 12),
      JSON.stringify({ m: r.data.missing_months, s: r.data.snapshots.map(x => x.month) }));
    r = await req('GET', '/api/special-budget/timeline?year=2026&limit=200');
    ok('生成快照写入审计事件', (r.data.events || []).some(e => e.event_type === 'snapshot'),
      JSON.stringify((r.data.events || []).map(e => e.event_type)));

    // ---------------- 4. 配置修改后口径 / 指纹变化 ----------------
    await C.updateConfig({
      username: U, year: 2026, annualCap: 1200, reason: '台账审计测试调高上限',
      secondConfirm: true, idemKey: key('cfg'), now: at('2026-12-04T10:00'),
    });
    r = await req('GET', '/api/special-budget/ledger?year=2026&month=12');
    ok('配置修改后年度上限 1200 / 剩余 950', r.status === 200 &&
      r.data.annual.annual_cap === 1200 && r.data.annual.annual_remaining === 950, JSON.stringify(r.data.annual));
    ok('配置修改后台账指纹变化', r.data.fingerprint !== fp1, JSON.stringify({ old: fp1, now: r.data.fingerprint }));
    r = await req('GET', '/api/special-budget/timeline?year=2026&limit=200');
    ok('配置修改写入时间线 config_update', (r.data.events || []).some(e => e.event_type === 'config_update'));

    // ---------------- 5. CSV 导出 ----------------
    const ledNow = await req('GET', '/api/special-budget/ledger?year=2026&month=12');
    let csv = await raw('/api/special-budget/export?type=ledger&year=2026&month=12');
    ok('台账导出 200 / text/csv / 正文以 BOM 开头', csv.status === 200 && /text\/csv/.test(csv.type) &&
      csv.text.indexOf('特殊预算台账') === 0 && L.ledgerCsv(ledNow.data).charCodeAt(0) === 0xFEFF,
      JSON.stringify({ s: csv.status, t: csv.type, b: csv.text.slice(0, 12) }));
    ok('台账 CSV 含指纹 / 月度 / 审批明细', csv.text.includes('审计指纹') &&
      csv.text.includes('月度台账') && csv.text.includes(sub.body.approval.approval_no), csv.text.slice(0, 200));
    ok('台账 CSV 指纹与接口一致', csv.text.includes(ledNow.data.fingerprint), JSON.stringify({ fp: ledNow.data.fingerprint }));
    csv = await raw('/api/special-budget/export?type=audit&year=2026');
    ok('审计导出 200 / 含时间线表头 / 事件类型', csv.status === 200 &&
      csv.text.includes('特殊预算审计时间线') && csv.text.includes('事件') && csv.text.includes('退款'),
      csv.text.slice(0, 200));
    r = await req('GET', '/api/special-budget/export?type=bad&year=2026');
    ok('未知导出类型 → 400 INVALID_EXPORT_TYPE', r.status === 400 && r.data.error === 'INVALID_EXPORT_TYPE',
      JSON.stringify(r.data));
    r = await req('GET', '/api/special-budget/export?type=ledger&year=2026&month=12', { auth: false });
    ok('导出无身份 → 401', r.status === 401);

    // 公式注入：直接调用服务层验证（用户可控的用途字段）
    const malicious = await A.submit({
      username: U, type: 'normal', amount: 10, purpose: '=HYPERLINK("x")', installments: 1,
      now: at('2026-12-15T10:00'), idemKey: key('evil'),
    });
    const ledEvil = await L.getLedger(U, { year: 2026, month: 12 });
    const evilCsv = L.ledgerCsv(ledEvil);
    ok('用户用途以 = 开头时导出被前缀单引号', !!malicious.body.approval &&
      evilCsv.includes("'=HYPERLINK"), evilCsv.split('\r\n').filter(x => x.includes('HYPERLINK'))[0]);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.pool.end();
  }
  console.log(`\nSPECIAL-BUDGET-LEDGER ${process.exitCode ? 'FAIL' : 'PASS'}: ${passed} passed`);
})().catch(e => {
  console.error('FAIL uncaught', e && (e.stack || e.message || e));
  process.exit(1);
});
