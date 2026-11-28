'use strict';
// 特殊预算 v3.2.5 试运行监控 / 预检 / 日对账测试（只操作 purchase_app_test 隔离库）
// 覆盖：监控只读与管理员边界、19 项检查、超限/审计缺口/关联不一致检测、快照覆盖、
//       预检 CLI（prep/switch、--strict、--json）、日对账 CLI（日期、退出码）。
// 用法: PURCHASE_DB_NAME=purchase_app_test PURCHASE_SPECIAL_BUDGET=1 node server/test/special-budget-monitor-api.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';
process.env.PURCHASE_SPECIAL_BUDGET = '1';

const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const cfg = require('../src/config');
const db = require('../src/db');
const A = require('../src/lib/special-budget/approvals');
const F = require('../src/lib/special-budget/funds');
const L = require('../src/lib/special-budget/ledger');
const M = require('../src/lib/special-budget/monitor');
const { parseJWT } = require('../src/middleware');

const U = 'sb_mon_u';
const ADMIN_U = 'sb_mon_admin';
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
  // 监控是全局口径：清理其它测试遗留的特殊采购单关联，避免孤儿单污染断言。
  await db.exec(
    `UPDATE purchase_orders
        SET budget_type = 'general', special_approval_id = NULL,
            paid_at = NULL, refunded_at = NULL, refund_amount = 0
      WHERE budget_type = 'special' OR special_approval_id IS NOT NULL
         OR paid_at IS NOT NULL OR refunded_at IS NOT NULL`);
}
async function ensureUser(name, isAdmin) {
  const row = await db.one('SELECT id FROM users WHERE username = ?', [name]);
  if (row) {
    if (isAdmin) await db.exec('UPDATE users SET is_admin = 1 WHERE username = ?', [name]);
    return row.id;
  }
  const ins = await db.exec(
    'INSERT INTO users (username, password_hash, salt, hash_version, is_admin) VALUES (?,?,?,1,?)',
    [name, '0'.repeat(64), '0'.repeat(32), isAdmin ? 1 : 0]);
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
async function collectAt(now, year, month) {
  const conn = await db.pool.getConnection();
  try {
    await conn.query('START TRANSACTION READ ONLY');
    try { return await M.collect(conn, { year: year || 2026, month: month || 12, now }); }
    finally { await conn.query('ROLLBACK'); }
  } finally { conn.release(); }
}
function runCli(script, args) {
  return spawnSync(process.execPath, [script].concat(args || []), {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PURCHASE_DB_NAME: 'purchase_app_test', PURCHASE_SPECIAL_BUDGET: '1' }),
    encoding: 'utf8', timeout: 60000,
  });
}

(async () => {
  if (!cfg.SERVICE_TOKEN) { console.error('FAIL 缺少 SERVICE_TOKEN'); process.exit(1); }
  let server = null;
  try {
    await fresh();
    const uid = await ensureUser(U, false);
    await ensureUser(ADMIN_U, true);

    // ---------------- 种子：普通 300 → 批准 → 关联 → 12-01 付款 ----------------
    const sub = await A.submit({
      username: U, type: 'normal', amount: 300, purpose: '监控测试', installments: 1,
      now: at('2026-12-01T10:00'), idemKey: key('sub'),
    });
    const aid = sub.body.approval.id;
    await A.approve({ username: U, id: aid, now: at('2026-12-01T10:05'), idemKey: key('ap') });
    const needId = await mkNeed(uid, '监控测试需求');
    const orderId = await mkOrder(uid, needId, 300);
    await A.linkOrder({ username: U, id: aid, orderId, amount: 300, now: at('2026-12-01T11:00'), idemKey: key('link') });
    await F.payOrder({ username: U, orderId, now: at('2026-12-01T12:00'), idemKey: key('pay') });
    const snap = await L.generateSnapshot({
      username: U, year: 2026, month: 12, now: at('2026-12-02T12:00'), idemKey: key('snap'),
    });
    ok('种子：12 月快照已生成', snap.status === 200, JSON.stringify(snap.body));

    // ---------------- 1. 服务层：干净数据应 PASS ----------------
    let m = await collectAt(at('2026-12-02T12:00'));
    ok('监控 19 项检查', m.checks.length === 19, String(m.checks.length));
    ok('干净数据 verdict=PASS', m.verdict === 'PASS', JSON.stringify(m.checks.filter(c => c.status !== 'pass')));
    ok('年度上限 1000 / 占用 300 / 剩余 700',
      m.summary.annual_cap === 1000 && m.summary.annual_committed === 300 && m.summary.annual_remaining === 700,
      JSON.stringify(m.summary));
    ok('月度常规已批 300 / 800', m.summary.monthly_regular_approved === 300 &&
      m.summary.monthly_regular_cap === 800, JSON.stringify(m.summary));
    ok('本月净现金 300', m.summary.monthly_cash === 300, String(m.summary.monthly_cash));
    ok('对账差异 0', m.reconciliation.difference === 0 && m.reconciliation.reconciled === true,
      JSON.stringify(m.reconciliation));
    ok('快照覆盖 12 月', m.snapshots.expected_months.indexOf(12) >= 0 &&
      m.snapshots.present_months.indexOf(12) >= 0 && m.snapshots.missing_months.length === 0,
      JSON.stringify(m.snapshots));
    ok('只读标记', m.readonly === true && m.scope === 'global');

    // ---------------- 2. 超年度上限 → FAIL ----------------
    await db.exec(
      `INSERT INTO special_budget_schedules
         (approval_id, order_id, seq, due_date, year, month, amount, status)
       VALUES (?, NULL, 99, '2026-12-31', 2026, 12, 2000, 'planned')`, [aid]);
    m = await collectAt(at('2026-12-02T12:00'));
    let chk = m.checks.find(c => c.key === 'annual_cap');
    ok('超年度上限 → annual_cap fail / verdict FAIL',
      chk.status === 'fail' && m.verdict === 'FAIL', JSON.stringify({ chk, v: m.verdict }));
    ok('超限差异 = 1300', chk.difference === 1300, String(chk.difference));
    await db.exec('DELETE FROM special_budget_schedules WHERE approval_id = ? AND seq = 99', [aid]);

    // ---------------- 3. 已付分期缺审计事件 → 对账/审计 FAIL ----------------
    await db.exec(
      `INSERT INTO special_budget_schedules
         (approval_id, order_id, seq, due_date, year, month, amount, status, paid_at)
       VALUES (?, NULL, 98, '2026-12-02', 2026, 12, 10, 'paid', '2026-12-02 11:00:00')`, [aid]);
    m = await collectAt(at('2026-12-02T12:00'));
    const recChk = m.checks.find(c => c.key === 'reconciliation');
    const payChk = m.checks.find(c => c.key === 'audit_pay');
    ok('缺付款事件 → reconciliation fail', recChk.status === 'fail' && recChk.difference === 10,
      JSON.stringify(recChk));
    ok('缺付款事件 → audit_pay fail（1 笔 / 10 元）', payChk.status === 'fail' &&
      payChk.actual === 1 && payChk.detail.affected_amount === 10, JSON.stringify(payChk));
    await db.exec('DELETE FROM special_budget_schedules WHERE approval_id = ? AND seq = 98', [aid]);

    // ---------------- 4. 关联金额不一致 → link_amount FAIL ----------------
    await db.exec('UPDATE special_budget_links SET linked_amount = 299 WHERE approval_id = ?', [aid]);
    m = await collectAt(at('2026-12-02T12:00'));
    chk = m.checks.find(c => c.key === 'link_amount');
    ok('关联金额 299 ≠ 采购单 300 → link_amount fail', chk.status === 'fail' && chk.actual === 1,
      JSON.stringify(chk));
    await db.exec('UPDATE special_budget_links SET linked_amount = 300 WHERE approval_id = ?', [aid]);

    // ---------------- 5. 孤儿业务事件 → event_orphans FAIL ----------------
    await db.exec(
      `INSERT INTO special_budget_events (approval_id, event_type, amount, actor, at)
       VALUES (NULL, 'pay', 1, 'x', '2026-12-02 12:30:00.000')`);
    m = await collectAt(at('2026-12-02T12:00'));
    chk = m.checks.find(c => c.key === 'event_orphans');
    ok('无审批单的 pay 事件 → event_orphans fail', chk.status === 'fail' && chk.actual === 1,
      JSON.stringify(chk));
    await db.exec(`DELETE FROM special_budget_events WHERE approval_id IS NULL AND event_type = 'pay'`);

    // ---------------- 6. 快照缺失 → WARN ----------------
    await db.exec('DELETE FROM special_budget_snapshots WHERE year = 2026 AND month = 12');
    m = await collectAt(at('2026-12-02T12:00'));
    chk = m.checks.find(c => c.key === 'snapshot_coverage');
    ok('缺 12 月快照 → snapshot_coverage warn / verdict WARN',
      chk.status === 'warn' && chk.detail.missing_months.indexOf(12) >= 0 && m.verdict === 'WARN',
      JSON.stringify({ chk, v: m.verdict }));
    await L.generateSnapshot({
      username: U, year: 2026, month: 12, now: at('2026-12-02T12:00'), idemKey: key('snap2'),
    });

    // ---------------- 7. 参数校验 ----------------
    let bad = false;
    try { await collectAt(at('2026-12-02T12:00'), 2025, 12); } catch (e) { bad = e.code === 'INVALID_YEAR'; }
    ok('非法年份 → INVALID_YEAR', bad);
    bad = false;
    try { await collectAt(at('2026-12-02T12:00'), 2026, 13); } catch (e) { bad = e.code === 'INVALID_MONTH'; }
    ok('非法月份 → INVALID_MONTH', bad);

    // ---------------- 8. HTTP 接口：开关 / 鉴权 / 方法 / 管理员 ----------------
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
      const r = await fetch(base + p, {
        method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body),
      });
      let data = null;
      try { data = await r.json(); } catch (e) {}
      return { status: r.status, data, allow: r.headers.get('allow') };
    }

    const saved = cfg.SPECIAL_BUDGET_ENABLED;
    cfg.SPECIAL_BUDGET_ENABLED = false;
    let r = await req('GET', '/api/special-budget/monitor?year=2026&month=12');
    ok('开关关闭 → 404', r.status === 404, JSON.stringify(r.data));
    cfg.SPECIAL_BUDGET_ENABLED = saved;

    r = await req('GET', '/api/special-budget/monitor?year=2026&month=12', { auth: false });
    ok('无身份 → 401', r.status === 401);
    r = await req('GET', '/api/special-budget/monitor?year=2026&month=12');
    ok('普通账号 → 403 FORBIDDEN', r.status === 403 && r.data.error === 'FORBIDDEN', JSON.stringify(r.data));
    r = await req('POST', '/api/special-budget/monitor', { body: {} });
    ok('POST → 405 + Allow GET', r.status === 405 && r.allow === 'GET', JSON.stringify({ s: r.status, a: r.allow }));
    r = await req('GET', '/api/special-budget/monitor?year=2025&month=12', { user: ADMIN_U });
    ok('非法年份 → 400 INVALID_YEAR', r.status === 400 && r.data.error === 'INVALID_YEAR', JSON.stringify(r.data));
    r = await req('GET', '/api/special-budget/monitor?year=2026&month=13', { user: ADMIN_U });
    ok('非法月份 → 400 INVALID_MONTH', r.status === 400 && r.data.error === 'INVALID_MONTH', JSON.stringify(r.data));

    r = await req('GET', '/api/special-budget/monitor?year=2026&month=12', { user: ADMIN_U });
    const api = r.data || {};
    ok('users.is_admin=1 → 200 / 只读 / 全局', r.status === 200 && api.ok === true &&
      api.readonly === true && api.scope === 'global', JSON.stringify({ s: r.status, e: api.error }));
    ok('接口返回 19 项检查与汇总', Array.isArray(api.checks) && api.checks.length === 19 &&
      api.summary && typeof api.summary.annual_committed === 'number' &&
      api.reconciliation && typeof api.reconciliation.difference === 'number',
      JSON.stringify({ c: (api.checks || []).length }));
    ok('接口带 generated_at / as_of', !!api.generated_at && !!api.as_of,
      JSON.stringify({ g: api.generated_at, a: api.as_of }));
    r = await req('GET', '/api/special-budget/monitor?year=2026&month=12', { user: 'admin' });
    ok('admin 账号 → 200', r.status === 200 && r.data.ok === true);

    // 只读：调用监控不产生快照
    const snapBefore = await db.one('SELECT COUNT(*) AS c FROM special_budget_snapshots WHERE year = 2026');
    await req('GET', '/api/special-budget/monitor?year=2026&month=12', { user: ADMIN_U });
    const snapAfter = await db.one('SELECT COUNT(*) AS c FROM special_budget_snapshots WHERE year = 2026');
    ok('监控只读：快照数量不变', Number(snapBefore.c) === Number(snapAfter.c),
      JSON.stringify({ before: snapBefore.c, after: snapAfter.c }));

    // ---------------- 9. 预检 CLI ----------------
    let cli = runCli('scripts/v325-preflight.js', ['--phase=prep', '--skip-api', '--json']);
    let pj = null;
    try { pj = JSON.parse(cli.stdout); } catch (e) { pj = null; }
    ok('预检 --json 可解析', !!pj && Array.isArray(pj.checks), (cli.stdout || '').slice(0, 200));
    ok('预检 prep 非 strict → 退出码 0（允许 WARN）', cli.status === 0,
      'status=' + cli.status + ' stderr=' + (cli.stderr || '').slice(0, 200));
    ok('预检 prep 含 schema/config/flag/frontend 检查',
      pj && pj.checks.some(c => c.key === 'schema_tables' && c.status === 'pass') &&
      pj && pj.checks.some(c => c.key === 'config_2026' && c.status === 'pass') &&
      pj && pj.checks.some(c => c.key === 'config_2027' && c.status === 'pass') &&
      pj && pj.checks.some(c => c.key === 'frontend_version' && c.status === 'pass'),
      JSON.stringify(pj && pj.checks.filter(c => c.status === 'fail')));
    ok('预检 prep 健康接口跳过为 WARN', pj && pj.checks.some(c => c.key === 'api_health' && c.status === 'warn'));

    cli = runCli('scripts/v325-preflight.js', ['--phase=prep', '--skip-api', '--json', '--strict']);
    ok('预检 --strict 遇 WARN → 退出码 1', cli.status === 1, 'status=' + cli.status);

    // ---------------- 10. 日对账 CLI ----------------
    cli = runCli('scripts/v325-daily-recon.js', ['--date=2026-12-02', '--json']);
    let dj = null;
    try { dj = JSON.parse(cli.stdout); } catch (e) { dj = null; }
    ok('日对账 --json 可解析', !!dj && !!dj.summary && Array.isArray(dj.checks),
      (cli.stdout || '').slice(0, 200));
    ok('日对账 12-02 干净数据 PASS / 退出码 0',
      dj && dj.verdict === 'PASS' && cli.status === 0,
      JSON.stringify({ v: dj && dj.verdict, s: cli.status, bad: dj && dj.checks.filter(c => c.status !== 'pass') }));
    ok('日对账含差异/逾期/缺失快照字段', dj && typeof dj.reconciliation.difference === 'number' &&
      typeof dj.counts.overdue_count === 'number' && typeof dj.counts.missing_snapshots === 'number');

    cli = runCli('scripts/v325-daily-recon.js', ['--date=2026-13-40', '--json']);
    ok('日对账非法日期 → 退出码 1', cli.status === 1, 'status=' + cli.status);

    cli = runCli('scripts/v325-daily-recon.js', ['--date=2026-12-02', '--json', '--strict']);
    ok('日对账 PASS 在 --strict 下仍退出 0', cli.status === 0, 'status=' + cli.status);

  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await db.pool.end().catch(() => {});
  }
  console.log('\n' + (process.exitCode ? 'FAILED' : 'PASSED') + ' · ' + passed + ' assertions');
})().catch(e => {
  console.error('FATAL', e && (e.stack || e.message));
  process.exit(1);
});
