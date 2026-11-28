'use strict';
// 特殊预算 v3.2.2 资金接口 HTTP 测试（只操作 purchase_app_test 隔离库）
// 覆盖：新资金路由（付款/退款/分期付款/改期/提前还款/过期/对账）的鉴权、幂等键、
//       二次确认、跨用户 404、405/404；旧 /api/items 与 /api/needs 路径对特殊订单的
//       锁定/审计/禁止删除；旧「已退」只写 refunded_at 不写 arrived_at。
// 用法: PURCHASE_DB_NAME=purchase_app_test PURCHASE_SPECIAL_BUDGET=1 node server/test/special-budget-funds-api.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';
process.env.PURCHASE_SPECIAL_BUDGET = '1';

const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const cfg = require('../src/config');
const db = require('../src/db');
const A = require('../src/lib/special-budget/approvals');
const F = require('../src/lib/special-budget/funds');
const { parseJWT } = require('../src/middleware');

const U = 'sb_http_funds';
const X = 'sb_http_other';
let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok', name); }
  else { console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); process.exitCode = 1; }
}
function at(s) { return new Date(s + (s.length === 16 ? ':00+08:00' : '+08:00')); }
function key(p) { return (p || 'k') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

function migrateApply() {
  const r = spawnSync(process.execPath, ['scripts/migrate-special-budget.js', '--apply'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PURCHASE_DB_NAME: 'purchase_app_test' }),
    encoding: 'utf8',
    timeout: 60000,
  });
  if (r.status !== 0) throw new Error('migrate failed: ' + ((r.stdout || '') + (r.stderr || '')));
}
async function fresh() {
  for (const t of ['special_budget_idempotency', 'special_budget_events', 'special_budget_schedules',
    'special_budget_links', 'special_budget_approvals', 'special_budget_snapshots', 'special_budget_rules']) {
    await db.exec(`DELETE FROM ${t}`);
  }
  await db.exec("UPDATE purchase_orders SET budget_type = 'general', special_approval_id = NULL WHERE budget_type = 'special'");
  migrateApply();
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
async function mkOrder(uid, needId, price, opts) {
  const o = opts || {};
  const r = await db.exec(
    `INSERT INTO purchase_orders
       (user_id, need_id, role, qty, price_paid, status, date_ms, arrived_at, budget_type)
     VALUES (?,?, 'formal', 1, ?, ?, ?, ?, 'general')`,
    [uid, needId, price, o.status || '已下单',
      o.dateMs == null ? Date.parse('2026-12-10T10:00:00+08:00') : o.dateMs,
      o.arrivedAt || null]);
  return r.insertId;
}
async function addYearConfig(year, cap) {
  await db.exec(
    `INSERT INTO special_budget_rules
       (year, annual_cap, monthly_regular_cap, saturday_rate, large_threshold, cross_year_allowed,
        effective_from, rule_version, changed_by, change_reason)
     VALUES (?,?,800,0.1,800,1,?,?,?,?)`,
    [year, cap, `${year}-01-01 00:00:00`, `${year}-v1`, 'test:seed', 'HTTP 资金测试年度配置']);
}

(async () => {
  if (!cfg.SERVICE_TOKEN) {
    console.error('FAIL 缺少 SERVICE_TOKEN');
    process.exit(1);
  }
  const users = [U, X];
  let server = null;
  try {
    await fresh();
    const uid = await ensureUser(U);
    const xid = await ensureUser(X);

    const app = express();
    app.use('/api', (req, res, next) => {
      if (req.headers['x-service-token'] !== cfg.SERVICE_TOKEN) return res.status(403).json({ error: 'forbidden' });
      next();
    });
    app.use(express.json({ limit: '8mb' }));
    app.use(parseJWT);
    app.use('/api', require('../src/routes/items'));
    app.use('/api', require('../src/routes/needs'));
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
        method, headers,
        body: o.body === undefined ? undefined : JSON.stringify(o.body),
      });
      let data = null;
      try { data = await r.json(); } catch (e) {}
      return { status: r.status, data, allow: r.headers.get('allow') };
    }

    // ---------------- 0. 开关 / 鉴权 / 方法 / 幂等键 ----------------
    const savedFlag = cfg.SPECIAL_BUDGET_ENABLED;
    cfg.SPECIAL_BUDGET_ENABLED = false;
    let r = await req('GET', '/api/special-budget/summary?year=2026&month=12');
    ok('开关关闭：特殊预算路由 404', r.status === 404);
    r = await req('GET', '/api/items');
    ok('开关关闭不影响旧 items 路由', r.status === 200 && Array.isArray(r.data), JSON.stringify(r.data).slice(0, 80));
    cfg.SPECIAL_BUDGET_ENABLED = savedFlag;

    r = await req('POST', '/api/special-budget/orders/1/pay', { auth: false, key: 'noauth-1', body: {} });
    ok('无身份 → 401', r.status === 401);
    r = await req('POST', '/api/special-budget/orders/1/pay', { token: false, key: 'notoken-1', body: {} });
    ok('无服务令牌 → 403', r.status === 403);
    r = await req('POST', '/api/special-budget/orders/1/pay', { body: {} });
    ok('付款缺幂等键 → 400 IDEMPOTENCY_KEY_REQUIRED',
      r.status === 400 && r.data.error === 'IDEMPOTENCY_KEY_REQUIRED', JSON.stringify(r.data));
    r = await req('PATCH', '/api/special-budget/orders/1/pay', { body: {} });
    ok('错误方法 → 405 + Allow: POST', r.status === 405 && r.allow === 'POST', JSON.stringify({ s: r.status, a: r.allow }));
    r = await req('GET', '/api/special-budget/unknown-path');
    ok('未知特殊预算路径 → 404', r.status === 404);

    // ---------------- 1. 正常单：HTTP 付款 / 幂等 / 部分退款 / 对账 ----------------
    const subA = await A.submit({
      username: U, type: 'normal', amount: 300, purpose: 'HTTP 资金', installments: 1,
      now: at('2026-12-01T10:00'), idemKey: key('sub'),
    });
    const aidA = subA.body.approval.id;
    await A.approve({ username: U, id: aidA, now: at('2026-12-01T10:05'), idemKey: key('ap') });
    const needA = await mkNeed(uid, 'HTTP 正常单需求');
    const oidA = await mkOrder(uid, needA, 300);
    await A.linkOrder({ username: U, id: aidA, orderId: oidA, now: at('2026-12-02T10:00'), idemKey: key('link') });

    // v3.2.3：采购接口必须把特殊标识/审批 ID 透给前端（采购单标识 + 前端统计排除依据）
    r = await req('GET', '/api/needs');
    const needRow = (r.data || []).find(x => x.id === 'rec_' + needA);
    const orderRow = needRow && (needRow.orders || []).find(o => o.id === 'rec_' + oidA);
    ok('/api/needs 子单带特殊预算标识',
      r.status === 200 && !!orderRow && orderRow['特殊预算'] === '1' && orderRow['特殊审批ID'] === 'rec_' + aidA,
      JSON.stringify(orderRow));
    r = await req('GET', '/api/items');
    const itemRow = (r.data || []).find(x => x.id === 'rec_' + needA);
    ok('/api/items 兼容行带特殊预算标识',
      r.status === 200 && !!itemRow && itemRow['特殊预算'] === '1' && itemRow['特殊审批ID'] === 'rec_' + aidA,
      JSON.stringify(itemRow));

    r = await req('POST', `/api/special-budget/orders/${oidA}/pay`, { user: X, key: 'xuser-pay-1', body: {} });
    ok('跨用户付款 → 404', r.status === 404 && r.data.error === 'ORDER_NOT_FOUND', JSON.stringify(r.data));

    const httpPayKey = 'http-pay-sec1';
    r = await req('POST', `/api/special-budget/orders/${oidA}/pay`, { key: httpPayKey, body: {} });
    ok('付款 → 200 / 计划 paid / 记录付款时间', r.status === 200 && r.data.schedule.status === 'paid' &&
      !!r.data.schedule.paid_at, JSON.stringify(r.data));
    const firstSched = r.data.schedule.id;
    r = await req('POST', `/api/special-budget/orders/${oidA}/pay`, { key: httpPayKey, body: {} });
    ok('幂等重放同一响应', r.status === 200 && r.data.schedule.id === firstSched);

    r = await req('POST', `/api/special-budget/orders/${oidA}/refund`, { key: 'http-rf-noreason', body: { amount: 100 } });
    ok('退款缺原因 → 400 INVALID_REASON', r.status === 400 && r.data.error === 'INVALID_REASON', JSON.stringify(r.data));
    r = await req('POST', `/api/special-budget/orders/${oidA}/refund`, {
      key: 'http-rf-sec1', body: { amount: 100, reason: 'HTTP 部分退款' },
    });
    ok('部分退款 100 → 200 / 累计 100', r.status === 200 && r.data.refund_amount === 100 &&
      r.data.cumulative_refund === 100, JSON.stringify(r.data));

    r = await req('GET', '/api/special-budget/reconciliation?year=2026&month=12');
    ok('对账接口 → 200 差异 0', r.status === 200 && r.data.difference === 0 && r.data.reconciled === true,
      JSON.stringify(r.data && r.data.checks));
    r = await req('GET', '/api/special-budget/reconciliation?year=1900&month=1');
    ok('对账年份非法 → 400', r.status === 400 && r.data.error === 'INVALID_YEAR', JSON.stringify(r.data));

    r = await req('POST', '/api/special-budget/expire', { body: {} });
    ok('过期扫描接口 → 200', r.status === 200 && r.data.ok === true && r.data.count === 0, JSON.stringify(r.data));

    // ---------------- 2. 旧 /api/items：锁定 / 审计 / 禁止删除 ----------------
    r = await req('PUT', '/api/items', { body: { id: 'rec_' + needA, price: 100 } });
    ok('旧 items 改金额 → 400 SPECIAL_ORDER_LOCKED',
      r.status === 400 && r.data.error === 'SPECIAL_ORDER_LOCKED', JSON.stringify(r.data));
    r = await req('PUT', '/api/items', { body: { id: 'rec_' + needA, note: '特殊单补充备注' } });
    ok('旧 items 改备注 → 200', r.status === 200, JSON.stringify(r.data));
    const upd = await db.one(
      "SELECT COUNT(*) AS c FROM special_budget_events WHERE event_type = 'order_update' AND approval_id = ? AND actor = ?",
      [aidA, U]);
    ok('旧 items 写入留 order_update 审计', Number(upd.c) === 1, String(upd.c));
    r = await req('PATCH', '/api/items', { body: { ids: ['rec_' + needA], status: '已到' } });
    ok('旧 items 批量改状态被拒', r.status === 200 && r.data.results[0].ok === false &&
      /特殊预算/.test(r.data.results[0].error || ''), JSON.stringify(r.data));
    r = await req('DELETE', '/api/items?id=rec_' + needA);
    ok('旧 items 删除特殊需求 → 400 SPECIAL_ORDER_NO_DELETE',
      r.status === 400 && r.data.error === 'SPECIAL_ORDER_NO_DELETE', JSON.stringify(r.data));

    // ---------------- 3. /api/needs 与子单接口：全部拦截 ----------------
    r = await req('PUT', `/api/orders/rec_${oidA}`, { body: { pricePaid: 100 } });
    ok('子单改金额 → 400 SPECIAL_ORDER_LOCKED',
      r.status === 400 && r.data.error === 'SPECIAL_ORDER_LOCKED', JSON.stringify(r.data));
    r = await req('POST', `/api/orders/rec_${oidA}/transition`, { body: { to: '已取消' } });
    ok('特殊子单状态流转 → 400', r.status === 400 && /特殊预算/.test(r.data.error || ''), JSON.stringify(r.data));
    r = await req('POST', `/api/needs/rec_${needA}/decide`, { body: { supplierId: 'rec_1' } });
    ok('含特殊单需求重新定点 → 400 SPECIAL_ORDER_LOCKED',
      r.status === 400 && r.data.error === 'SPECIAL_ORDER_LOCKED', JSON.stringify(r.data));
    r = await req('POST', `/api/needs/rec_${needA}/undecided`, { body: {} });
    ok('含特殊单需求回退定点 → 400 SPECIAL_ORDER_LOCKED',
      r.status === 400 && r.data.error === 'SPECIAL_ORDER_LOCKED', JSON.stringify(r.data));
    r = await req('POST', `/api/needs/rec_${needA}/cancel`, { body: { reason: 'x' } });
    ok('含特殊单需求取消 → 400 SPECIAL_ORDER_LOCKED',
      r.status === 400 && r.data.error === 'SPECIAL_ORDER_LOCKED', JSON.stringify(r.data));
    r = await req('DELETE', `/api/needs/rec_${needA}`);
    ok('含特殊单需求删除 → 400 SPECIAL_ORDER_NO_DELETE',
      r.status === 400 && r.data.error === 'SPECIAL_ORDER_NO_DELETE', JSON.stringify(r.data));

    // ---------------- 4. 旧「已退」只写 refunded_at ----------------
    const needG = await mkNeed(uid, 'HTTP 普通单需求');
    const oidG = await mkOrder(uid, needG, 100, { status: '已下单' });
    r = await req('PUT', '/api/items', { body: { id: 'rec_' + needG, status: '已退' } });
    ok('普通单旧接口退单 → 200', r.status === 200, JSON.stringify(r.data));
    const gRow = await db.one(
      "SELECT status, refunded_at, arrived_at FROM purchase_orders WHERE id = ?", [oidG]);
    ok('旧已退写 refunded_at、不写 arrived_at',
      gRow.status === '已退' && gRow.refunded_at != null && gRow.arrived_at == null, JSON.stringify(gRow));

    // ---------------- 5. 分期：付款 / 改期二次确认 / 提前还款 ----------------
    await fresh();
    await addYearConfig(2028, 10000);
    await addYearConfig(2029, 10000);
    const subL = await A.submit({
      username: U, type: 'large', amount: 4800, purpose: 'HTTP 大额', installments: 24,
      now: at('2027-05-01T10:00'), idemKey: key('sub'),
    });
    const aidL = subL.body.approval.id;
    await A.approve({ username: U, id: aidL, secondConfirm: true, now: at('2027-05-01T10:05'), idemKey: key('ap') });
    const s1 = await db.one('SELECT id FROM special_budget_schedules WHERE approval_id = ? AND seq = 1', [aidL]);
    await F.paySchedule({ username: U, scheduleId: s1.id, now: at('2027-05-20T10:00'), idemKey: key('p') });

    const s2 = await db.one('SELECT id FROM special_budget_schedules WHERE approval_id = ? AND seq = 2', [aidL]);
    r = await req('POST', `/api/special-budget/schedules/${s2.id}/pay`, { key: 'http-sched-pay-1', body: {} });
    // 路由不可注入 now：真实当前时间（2026）付 2027 分期必须被拦，避免付款年与分期年错位。
    ok('HTTP 付未来年度分期 → 409 USE_PREPAY', r.status === 409 && r.data.error === 'USE_PREPAY',
      JSON.stringify(r.data));
    const s2sameYear = await F.paySchedule({
      username: U, scheduleId: s2.id, now: at('2027-06-20T10:00'), idemKey: key('p'),
    });
    ok('同年（2027）按分期付款 → 200 / paid', s2sameYear.status === 200 && s2sameYear.body.schedule.status === 'paid',
      JSON.stringify(s2sameYear.body.schedule));

    const s3 = await db.one('SELECT id FROM special_budget_schedules WHERE approval_id = ? AND seq = 3', [aidL]);
    r = await req('POST', `/api/special-budget/schedules/${s3.id}/reschedule`, {
      key: 'http-rs-noconfirm', body: { year: 2027, month: 8, reason: 'HTTP 改期' },
    });
    ok('改期未二次确认 → 428', r.status === 428 && r.data.error === 'SECOND_CONFIRM_REQUIRED', JSON.stringify(r.data));
    r = await req('POST', `/api/special-budget/schedules/${s3.id}/reschedule`, {
      key: 'http-rs-ok', body: { year: 2027, month: 8, reason: 'HTTP 改期', secondConfirm: true },
    });
    ok('改期成功 → 2027-08-31 planned', r.status === 200 && r.data.scheduled.month === 8 &&
      r.data.scheduled.due_date === '2027-08-31' && r.data.scheduled.status === 'planned', JSON.stringify(r.data));

    const s21 = await db.one('SELECT id FROM special_budget_schedules WHERE approval_id = ? AND year = 2029 ORDER BY seq LIMIT 1', [aidL]);
    r = await req('POST', `/api/special-budget/schedules/${s21.id}/prepay`, { key: 'http-prepay-1', body: {} });
    ok('提前还款 → 200：释放 2029、当年计入 paid', r.status === 200 &&
      r.data.released.year === 2029 && r.data.paid.status === 'paid' &&
      r.data.paid.year === 2026 && r.data.paid.month === 11, JSON.stringify(r.data));
  } catch (e) {
    console.error('FAIL', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    try {
      for (const u of users) await db.exec('DELETE FROM users WHERE username = ?', [u]);
      await db.exec('DELETE po FROM purchase_orders po LEFT JOIN users u ON u.id = po.user_id WHERE u.id IS NULL');
      await db.exec('DELETE ps FROM purchase_suppliers ps LEFT JOIN purchase_needs pn ON pn.id = ps.need_id WHERE pn.id IS NULL');
      await db.exec('DELETE pn FROM purchase_needs pn LEFT JOIN users u ON u.id = pn.user_id WHERE u.id IS NULL');
      for (const t of ['special_budget_idempotency', 'special_budget_events', 'special_budget_schedules',
        'special_budget_links', 'special_budget_approvals', 'special_budget_snapshots', 'special_budget_rules']) {
        await db.exec(`DELETE FROM ${t}`);
      }
      migrateApply();
      await db.exec("UPDATE purchase_orders SET budget_type = 'general', special_approval_id = NULL WHERE budget_type <> 'general'");
    } catch (e) {
      console.error('cleanup failed:', e.message);
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await db.pool.end();
  }
  console.log(`\n${passed} passed${process.exitCode ? '（有失败）' : ''}`);
})();
