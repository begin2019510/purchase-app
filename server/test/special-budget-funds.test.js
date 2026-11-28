'use strict';
// 特殊预算 v3.2.2 资金服务测试（只操作 purchase_app_test 隔离库）
// 覆盖：付款/幂等/乱序付款、同月/跨月/跨年退款、部分退款、未来分期释放、
//       提前还款、改期（二次确认/跨年/2026 限制）、过期失效、对账差异 0、一般预算隔离、
//       订单状态机修正（已退写 refunded_at、特殊订单禁止走旧流转）。
// 用法: PURCHASE_DB_NAME=purchase_app_test PURCHASE_SPECIAL_BUDGET=1 node server/test/special-budget-funds.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';
process.env.PURCHASE_SPECIAL_BUDGET = '1';

const path = require('path');
const { spawnSync } = require('child_process');
const cfg = require('../src/config');
const db = require('../src/db');
const tx = require('../src/lib/special-budget/tx');
const A = require('../src/lib/special-budget/approvals');
const F = require('../src/lib/special-budget/funds');
const S = require('../src/lib/special-budget/summary');
const N = require('../src/lib/needs');
const R = require('../src/lib/special-budget/rules');
const T = require('../src/lib/special-budget/time');

const U = 'sb_fund_svc';
const ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok', name); }
  else { console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); process.exitCode = 1; }
}
function at(s) { return new Date(s + (s.length === 16 ? ':00+08:00' : '+08:00')); }
function key(p) { return (p || 'k') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
async function err(fn) {
  try { await fn(); return { none: true }; }
  catch (e) { return { code: e.code, status: e.status, message: e.message }; }
}
function isErr(r, code) {
  return !r.none && (code === undefined || r.code === code);
}

function migrateApply() {
  const r = spawnSync(process.execPath, ['scripts/migrate-special-budget.js', '--apply'], {
    cwd: ROOT,
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
  // 清掉上次失败可能残留的特殊预算标记，避免污染全局对账
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
async function mkNeed(uid, name, status) {
  const r = await db.exec(
    'INSERT INTO purchase_needs (user_id, name, status, category) VALUES (?,?,?,?)',
    [uid, name, status || '已定点', '其他']);
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
    [year, cap, `${year}-01-01 00:00:00`, `${year}-v1`, 'test:seed', '资金测试年度配置']);
}
async function submitAt(type, amount, when, extra) {
  return A.submit(Object.assign({
    username: U, type, amount, purpose: '资金单测', installments: 1,
    now: at(when), idemKey: key('sub'),
  }, extra || {}));
}
async function approveAt(id, when, extra) {
  return A.approve(Object.assign({
    username: U, id, now: at(when), idemKey: key('ap'),
  }, extra || {}));
}
async function linkAt(approvalId, orderId, when) {
  return A.linkOrder({
    username: U, id: Number(approvalId), orderId: Number(orderId),
    now: at(when), idemKey: key('link'),
  });
}
async function committed(year) {
  return tx.withTransaction(conn => A.committedForYear(conn, year));
}
async function schedBySeq(approvalId, seq) {
  return db.one('SELECT * FROM special_budget_schedules WHERE approval_id = ? AND seq = ?', [approvalId, seq]);
}
function monthRange(year, month) {
  const b = T.monthBounds(year, month);
  return {
    start: b.start, end: b.end,
    msStart: Date.parse(b.start.replace(' ', 'T') + '+08:00'),
    msEnd: Date.parse(b.end.replace(' ', 'T') + '+08:00'),
  };
}
async function orderMonth(year, month, special) {
  const r = monthRange(year, month);
  return db.one(
    `SELECT COUNT(*) AS count, COALESCE(SUM(price_paid * qty), 0) AS amount
       FROM purchase_orders
      WHERE budget_type ${special ? "= 'special'" : "<> 'special'"}
        AND status IN ('已下单','已到','已归档')
        AND date_ms IS NOT NULL AND date_ms >= ? AND date_ms < ?`,
    [r.msStart, r.msEnd]);
}

(async () => {
  if (!cfg.SERVICE_TOKEN) {
    console.error('FAIL 缺少 SERVICE_TOKEN');
    process.exit(1);
  }
  let createdUsers = [];
  try {
    const uid = await ensureUser(U);
    createdUsers.push(U);

    // ================= 1. 付款 / 同月部分退款 / 对账 / 一般预算隔离 =================
    await fresh();
    const needA = await mkNeed(uid, '资金测试需求A');
    const subA = await submitAt('normal', 300, '2026-12-01T10:00');
    const aidA = subA.body.approval.id;
    await approveAt(aidA, '2026-12-01T10:05');
    ok('批准后年度占用 300', await committed(2026) === 300, String(await committed(2026)));

    const oidA = await mkOrder(uid, needA, 300, { status: '已下单', arrivedAt: '2026-12-03 09:00:00' });
    const lkA = await linkAt(aidA, oidA, '2026-12-02T10:00');
    ok('关联采购单 → special', lkA.status === 200 && lkA.body.link.order_id === oidA, JSON.stringify(lkA.body));

    const payKey = 'pay-sec1-1';
    const p1 = await F.payOrder({ username: U, orderId: oidA, idemKey: payKey, now: at('2026-12-05T10:00') });
    ok('付款 → 200 / 计划 paid / paid_at', p1.status === 200 && p1.body.schedule.status === 'paid' &&
      p1.body.schedule.paid_at === '2026-12-05 10:00:00', JSON.stringify(p1.body.schedule));
    ok('付款回写订单 paid_at', p1.body.order && p1.body.order.paid_at === '2026-12-05 10:00:00',
      JSON.stringify(p1.body.order && p1.body.order.paid_at));
    const p2 = await F.payOrder({ username: U, orderId: oidA, idemKey: payKey, now: at('2026-12-06T10:00') });
    ok('付款幂等重放同一响应', p2.replayed === true && p2.body.schedule.id === p1.body.schedule.id);
    const payEv1 = await db.one("SELECT COUNT(*) AS c FROM special_budget_events WHERE event_type = 'pay' AND approval_id = ?", [aidA]);
    ok('重放不重复写 pay 事件', Number(payEv1.c) === 1, String(payEv1.c));
    const againPay = await err(() => F.payOrder({ username: U, orderId: oidA, idemKey: key('p'), now: at('2026-12-06T10:00') }));
    ok('已付再付（按单）→ NO_PAYABLE_SCHEDULE 409', isErr(againPay, 'NO_PAYABLE_SCHEDULE') && againPay.status === 409,
      JSON.stringify(againPay));
    const againSched = await err(() => F.paySchedule({ username: U, scheduleId: p1.body.schedule.id, idemKey: key('p'), now: at('2026-12-06T10:00') }));
    ok('已付再付（按期）→ SCHEDULE_NOT_PAYABLE 409', isErr(againSched, 'SCHEDULE_NOT_PAYABLE') && againSched.status === 409,
      JSON.stringify(againSched));

    const rec1 = await F.reconcile({ year: 2026, month: 12 });
    ok('对账差异 0（付款后）', rec1.difference === 0 && rec1.reconciled === true, JSON.stringify(rec1.checks));
    ok('对账：计划已付 = pay 事件 = 300', rec1.payments.paid_amount === 300 && rec1.payments.pay_events === 300,
      JSON.stringify(rec1.payments));
    const gen1 = await orderMonth(2026, 12, false);
    const spe1 = await orderMonth(2026, 12, true);
    ok('一般预算口径排除 special（与直查一致）',
      rec1.cash_flow.general.count === Number(gen1.count) &&
      rec1.cash_flow.general.amount === R.round2(gen1.amount), JSON.stringify(rec1.cash_flow.general));
    ok('special 单独列示且我们的单被排除在一般预算外',
      rec1.cash_flow.special_excluded_from_general.count === Number(spe1.count) &&
      rec1.cash_flow.special_excluded_from_general.amount === R.round2(spe1.amount) &&
      !(await db.one("SELECT id FROM purchase_orders WHERE id = ? AND budget_type <> 'special'", [oidA])));
    ok('总现金流 = 一般 + 特殊实付 - 特殊退款',
      rec1.cash_flow.total === R.round2(R.round2(gen1.amount) + 300), JSON.stringify(rec1.cash_flow));

    const nr = await err(() => F.refundOrder({ username: U, orderId: oidA, amount: 100, idemKey: key('r'), now: at('2026-12-20T10:00') }));
    ok('退款缺原因 → INVALID_REASON 400', isErr(nr, 'INVALID_REASON') && nr.status === 400, JSON.stringify(nr));
    const zero = await err(() => F.refundOrder({ username: U, orderId: oidA, amount: 0, reason: 'x', idemKey: key('r'), now: at('2026-12-20T10:00') }));
    ok('退款 0 → INVALID_AMOUNT 400', isErr(zero, 'INVALID_AMOUNT') && zero.status === 400, JSON.stringify(zero));

    const r100 = await F.refundOrder({ username: U, orderId: oidA, amount: 100, reason: '部分退款', idemKey: key('r'), now: at('2026-12-20T10:00') });
    ok('部分退款 100 → 200 / 累计 100', r100.status === 200 && r100.body.refund_amount === 100 &&
      r100.body.cumulative_refund === 100, JSON.stringify(r100.body));
    ok('退款分摊到 1 期 / 原付款年度 2026', r100.body.allocations.length === 1 &&
      r100.body.allocations[0].amount === 100 && r100.body.allocations[0].year === 2026,
      JSON.stringify(r100.body.allocations));
    const schA1 = await schedBySeq(aidA, 1);
    ok('部分退款后计划仍 paid，refund_amount=100', schA1.status === 'paid' && Number(schA1.refund_amount) === 100,
      JSON.stringify({ status: schA1.status, refund: schA1.refund_amount }));
    const ordA = await db.one(
      "SELECT status, refund_amount, DATE_FORMAT(arrived_at,'%Y-%m-%d %H:%i:%s') AS arr, DATE_FORMAT(refunded_at,'%Y-%m-%d %H:%i:%s') AS ref FROM purchase_orders WHERE id = ?", [oidA]);
    ok('退款订单进入已退，且不覆盖 arrived_at',
      ordA.status === '已退' && Number(ordA.refund_amount) === 100 &&
      ordA.arr === '2026-12-03 09:00:00' && String(ordA.ref || '').indexOf('2026-12-20') === 0,
      JSON.stringify(ordA));
    ok('部分退款后年度占用 200', await committed(2026) === 200, String(await committed(2026)));
    const sumA1 = await S.getSummary(2026, 12);
    ok('同月退款恢复 800：已批 200 / 可批 600',
      sumA1.summary.monthly_regular_approved === 200 && sumA1.summary.monthly_regular_available === 600,
      JSON.stringify({ approved: sumA1.summary.monthly_regular_approved, available: sumA1.summary.monthly_regular_available }));

    const over = await err(() => F.refundOrder({ username: U, orderId: oidA, amount: 300, reason: '超额', idemKey: key('r'), now: at('2026-12-20T10:00') }));
    ok('退款超已付 → REFUND_EXCEEDS_PAID 400', isErr(over, 'REFUND_EXCEEDS_PAID') && over.status === 400,
      JSON.stringify(over));
    const r200 = await F.refundOrder({ username: U, orderId: oidA, amount: 200, reason: '退完', idemKey: key('r'), now: at('2026-12-20T10:00') });
    ok('退完剩余 200 → 累计 300', r200.status === 200 && r200.body.cumulative_refund === 300);
    ok('全部退款后年度占用归零', await committed(2026) === 0, String(await committed(2026)));
    const sumA2 = await S.getSummary(2026, 12);
    ok('同月退完恢复 800：已批 0 / 可批 800',
      sumA2.summary.monthly_regular_approved === 0 && sumA2.summary.monthly_regular_available === 800,
      JSON.stringify({ approved: sumA2.summary.monthly_regular_approved, available: sumA2.summary.monthly_regular_available }));
    const none = await err(() => F.refundOrder({ username: U, orderId: oidA, amount: 1, reason: '无', idemKey: key('r'), now: at('2026-12-21T10:00') }));
    ok('无可退金额 → NO_PAID_AMOUNT 409', isErr(none, 'NO_PAID_AMOUNT') && none.status === 409, JSON.stringify(none));

    const rec2 = await F.reconcile({ year: 2026, month: 12 });
    ok('对账差异 0（退完后）', rec2.difference === 0, JSON.stringify(rec2.checks));
    ok('退完对账：实付 300 / 退款 300 / 年度 0',
      rec2.payments.paid_amount === 300 && rec2.refunds.refunded_amount === 300 &&
      rec2.annual.annual_committed === 0 && rec2.annual.annual_remaining === 1000, JSON.stringify(rec2.annual));

    // ================= 2. 跨月退款：不恢复原月 800、年度在原付款年度释放 =================
    await fresh();
    const subB = await submitAt('normal', 800, '2026-12-01T10:00');
    const aidB = subB.body.approval.id;
    await approveAt(aidB, '2026-12-01T10:05');
    const needB = await mkNeed(uid, '资金测试需求B');
    const oidB = await mkOrder(uid, needB, 800);
    await linkAt(aidB, oidB, '2026-12-02T10:00');
    await F.payOrder({ username: U, orderId: oidB, idemKey: key('p'), now: at('2026-12-05T10:00') });
    const beforeB = await S.getSummary(2026, 12);
    ok('退款前当月已批 800', beforeB.summary.monthly_regular_approved === 800);

    const rfB = await F.refundOrder({ username: U, orderId: oidB, amount: 100, reason: '跨月退款', idemKey: key('r'), now: at('2027-01-05T10:00') });
    ok('跨月退款 → 200', rfB.status === 200 && rfB.body.refund_amount === 100);
    const decB = await S.getSummary(2026, 12);
    ok('跨月退款不恢复原月 800', decB.summary.monthly_regular_approved === 800,
      String(decB.summary.monthly_regular_approved));
    const janB = await S.getSummary(2027, 1);
    ok('退款不结转到退款月', janB.summary.monthly_regular_approved === 0 && janB.summary.annual_committed === 0,
      JSON.stringify({ m: janB.summary.monthly_regular_approved, y: janB.summary.annual_committed }));
    ok('年度在原付款年度释放：2026 占 700 / 2027 占 0',
      await committed(2026) === 700 && await committed(2027) === 0,
      JSON.stringify({ y2026: await committed(2026), y2027: await committed(2027) }));
    const recDecB = await F.reconcile({ year: 2026, month: 12 });
    ok('2026-12 对账差异 0 且当月无退款事件', recDecB.difference === 0 && recDecB.refunds.refunded_amount === 0);
    const recJanB = await F.reconcile({ year: 2027, month: 1 });
    ok('2027-01 现金流体现退款 100、年度承诺 0',
      recJanB.cash_flow.special.refunded === 100 && recJanB.annual.annual_committed === 0 &&
      recJanB.difference === 0, JSON.stringify(recJanB.cash_flow));

    // ================= 3. 大额跨年分期：乱序 / 首期不失效 / 跨年退款 =================
    await fresh();
    await addYearConfig(2028, 10000);
    await addYearConfig(2029, 10000);
    const subL = await submitAt('large', 4800, '2027-05-01T10:00', { installments: 24 });
    const aidL = subL.body.approval.id;
    const apL = await approveAt(aidL, '2027-05-01T10:05', { secondConfirm: true });
    const seg = {};
    for (const s of apL.body.schedules) seg[s.year] = R.round2((seg[s.year] || 0) + s.amount);
    ok('24 期按年分段 2027/2028/2029 = 1600/2400/800',
      seg[2027] === 1600 && seg[2028] === 2400 && seg[2029] === 800, JSON.stringify(seg));

    const needL = await mkNeed(uid, '资金测试大额');
    const oidL = await mkOrder(uid, needL, 4800);
    await linkAt(aidL, oidL, '2027-05-02T10:00');
    const s2 = await schedBySeq(aidL, 2);
    const oo = await err(() => F.paySchedule({ username: U, scheduleId: s2.id, idemKey: key('p'), now: at('2027-05-20T10:00') }));
    ok('跨期付款 → PAY_OUT_OF_ORDER 409', isErr(oo, 'PAY_OUT_OF_ORDER') && oo.status === 409, JSON.stringify(oo));

    const payL1 = await F.payOrder({ username: U, orderId: oidL, idemKey: key('p'), now: at('2027-05-20T10:00') });
    ok('首期付款成功（2027-05）', payL1.status === 200 && payL1.body.schedule.seq === 1 &&
      payL1.body.schedule.paid_at === '2027-05-20 10:00:00', JSON.stringify(payL1.body.schedule));
    const exp0 = await F.expireDue({ username: U, now: at('2027-06-02T10:00') });
    const stL0 = await db.one('SELECT status FROM special_budget_approvals WHERE id = ?', [aidL]);
    ok('大额首期已付 → 不失效', exp0.count === 0 && stL0.status === 'approved', JSON.stringify({ exp: exp0, st: stL0.status }));

    let payOk = true;
    for (let i = 2; i <= 9; i++) {
      const r = await F.payOrder({ username: U, orderId: oidL, idemKey: key('p'), now: at('2028-01-15T10:00') });
      if (r.status !== 200) { payOk = false; ok('连付第 ' + i + ' 期', false, JSON.stringify(r.body)); }
    }
    ok('连续付至第 9 期', payOk);
    ok('年度占用：2027 1600 / 2028 2400 / 2029 800（含未付计划）',
      await committed(2027) === 1600 && await committed(2028) === 2400 && await committed(2029) === 800,
      JSON.stringify({ y27: await committed(2027), y28: await committed(2028), y29: await committed(2029) }));

    const rfL = await F.refundOrder({ username: U, orderId: oidL, amount: 1800, reason: '跨年退款', idemKey: key('r'), now: at('2029-02-10T10:00') });
    ok('跨年退款 1800 → 200', rfL.status === 200 && rfL.body.refund_amount === 1800, JSON.stringify(rfL.body));
    ok('退款按原付款年度分摊（8×2027 + 1×2028）',
      rfL.body.allocations.length === 9 &&
      rfL.body.allocations.filter(a => a.year === 2027).length === 8 &&
      rfL.body.allocations.filter(a => a.year === 2028).length === 1,
      JSON.stringify(rfL.body.allocations));
    ok('未到期分期全部释放（15 期）', rfL.body.released_schedules.length === 15 && rfL.body.released_future === true,
      String(rfL.body.released_schedules.length));
    ok('退款年度 2029 不新增占用，三年占用均归零',
      await committed(2027) === 0 && await committed(2028) === 0 && await committed(2029) === 0,
      JSON.stringify({ y27: await committed(2027), y28: await committed(2028), y29: await committed(2029) }));
    const rec27 = await F.reconcile({ year: 2027, month: 5 });
    ok('2027 对账差异 0：年付 1600 / 年退 1600 / 月付 200',
      rec27.difference === 0 && rec27.annual.annual_paid === 1600 &&
      rec27.annual.annual_refunded === 1600 && rec27.payments.paid_amount === 200,
      JSON.stringify({ a: rec27.annual, p: rec27.payments }));
    const rec28 = await F.reconcile({ year: 2028, month: 1 });
    ok('2028 对账差异 0：年付 200 / 年退 200 / 释放 2200 / 月付 1600',
      rec28.difference === 0 && rec28.annual.annual_paid === 200 &&
      rec28.annual.annual_refunded === 200 && rec28.annual.annual_released === 2200 &&
      rec28.payments.paid_amount === 1600,
      JSON.stringify({ a: rec28.annual, p: rec28.payments }));

    // ================= 4. 提前还款 / 改期 =================
    await fresh();
    await addYearConfig(2028, 10000);
    await addYearConfig(2029, 10000);
    const subP = await submitAt('large', 4800, '2027-05-01T10:00', { installments: 24 });
    const aidP = subP.body.approval.id;
    await approveAt(aidP, '2027-05-01T10:05', { secondConfirm: true });
    const sP1 = await schedBySeq(aidP, 1);
    await F.paySchedule({ username: U, scheduleId: sP1.id, idemKey: key('p'), now: at('2027-05-20T10:00') });
    const s21 = await db.one('SELECT * FROM special_budget_schedules WHERE approval_id = ? AND year = 2029 ORDER BY seq LIMIT 1', [aidP]);
    const prep = await F.prepaySchedule({ username: U, scheduleId: s21.id, idemKey: key('pre'), now: at('2028-06-10T10:00') });
    ok('提前还款：释放 2029 承诺', prep.status === 200 && prep.body.released.status === 'released' &&
      prep.body.released.year === 2029, JSON.stringify(prep.body.released));
    ok('提前还款：计入 2028-06 当天并标记 paid',
      prep.body.paid.status === 'paid' && prep.body.paid.year === 2028 && prep.body.paid.month === 6 &&
      prep.body.paid.amount === 200 && prep.body.paid.due_date === '2028-06-10',
      JSON.stringify(prep.body.paid));
    ok('提前还款后 2029 占 600 / 2028 占 2600',
      await committed(2029) === 600 && await committed(2028) === 2600,
      JSON.stringify({ y28: await committed(2028), y29: await committed(2029) }));
    const sCur = await db.one("SELECT id FROM special_budget_schedules WHERE approval_id = ? AND year = 2028 AND status = 'planned' ORDER BY seq LIMIT 1", [aidP]);
    const notFuture = await err(() => F.prepaySchedule({ username: U, scheduleId: sCur.id, idemKey: key('pre'), now: at('2028-06-10T10:00') }));
    ok('当年分期不能提前还款 → NOT_FUTURE_YEAR', isErr(notFuture, 'NOT_FUTURE_YEAR'), JSON.stringify(notFuture));

    const sP2 = await schedBySeq(aidP, 2);
    const noConfirm = await err(() => F.rescheduleSchedule({
      username: U, scheduleId: sP2.id, year: 2027, month: 8, reason: '改期',
      idemKey: key('rs'), now: at('2027-05-20T10:00'),
    }));
    ok('改期未二次确认 → 428', isErr(noConfirm, 'SECOND_CONFIRM_REQUIRED') && noConfirm.status === 428, JSON.stringify(noConfirm));
    const rs2 = await F.rescheduleSchedule({
      username: U, scheduleId: sP2.id, year: 2027, month: 8, reason: '改期',
      secondConfirm: true, idemKey: key('rs'), now: at('2027-05-20T10:00'),
    });
    ok('改期成功：旧释放 / 新计划 2027-08-31 planned',
      rs2.status === 200 && rs2.body.released.status === 'released' &&
      rs2.body.scheduled.year === 2027 && rs2.body.scheduled.month === 8 &&
      rs2.body.scheduled.due_date === '2027-08-31' && rs2.body.scheduled.status === 'planned',
      JSON.stringify(rs2.body));
    ok('改期不改变年度占用（2027 仍 1600）', await committed(2027) === 1600, String(await committed(2027)));

    const sP3 = await schedBySeq(aidP, 3);
    const samePeriod = await err(() => F.rescheduleSchedule({
      username: U, scheduleId: sP3.id, year: 2027, month: 7, reason: '同期',
      secondConfirm: true, idemKey: key('rs'), now: at('2027-05-20T10:00'),
    }));
    ok('改到相同期间 → SAME_PERIOD', isErr(samePeriod, 'SAME_PERIOD'), JSON.stringify(samePeriod));
    const bad2026 = await err(() => F.rescheduleSchedule({
      username: U, scheduleId: sP3.id, year: 2026, month: 11, reason: '非 12 月',
      secondConfirm: true, idemKey: key('rs'), now: at('2027-05-20T10:00'),
    }));
    ok('2026 目标非 12 月 → 2026_ONLY_DECEMBER', isErr(bad2026, '2026_ONLY_DECEMBER'), JSON.stringify(bad2026));
    const past = await err(() => F.rescheduleSchedule({
      username: U, scheduleId: sP3.id, year: 2027, month: 4, reason: '已结束月份',
      secondConfirm: true, idemKey: key('rs'), now: at('2027-05-20T10:00'),
    }));
    ok('改期到已结束月份 → PAST_PERIOD', isErr(past, 'PAST_PERIOD'), JSON.stringify(past));
    const rs28 = await F.rescheduleSchedule({
      username: U, scheduleId: sP3.id, year: 2028, month: 2, reason: '跨年改期',
      secondConfirm: true, idemKey: key('rs'), now: at('2027-05-20T10:00'),
    });
    ok('跨年改期 → 2028-02-29 planned',
      rs28.status === 200 && rs28.body.scheduled.year === 2028 &&
      rs28.body.scheduled.month === 2 && rs28.body.scheduled.due_date === '2028-02-29',
      JSON.stringify(rs28.body.scheduled));
    ok('跨年改期后 2027 占 1400 / 2028 占 2800',
      await committed(2027) === 1400 && await committed(2028) === 2800,
      JSON.stringify({ y27: await committed(2027), y28: await committed(2028) }));

    const sub26 = await submitAt('normal', 100, '2026-12-01T10:00');
    await approveAt(sub26.body.approval.id, '2026-12-01T10:05');
    const s26 = await schedBySeq(sub26.body.approval.id, 1);
    const cross26 = await err(() => F.rescheduleSchedule({
      username: U, scheduleId: s26.id, year: 2027, month: 1, reason: '2026 跨年',
      secondConfirm: true, idemKey: key('rs'), now: at('2026-12-10T10:00'),
    }));
    ok('2026 分期禁止跨年改期 → CROSS_YEAR_NOT_ALLOWED', isErr(cross26, 'CROSS_YEAR_NOT_ALLOWED'), JSON.stringify(cross26));

    // ================= 5. 过期失效 =================
    await fresh();
    const subE1 = await submitAt('normal', 199, '2026-12-01T10:00');
    await approveAt(subE1.body.approval.id, '2026-12-01T10:05');
    const subE2 = await submitAt('large', 801, '2026-12-15T10:00');
    await approveAt(subE2.body.approval.id, '2026-12-15T10:05', { secondConfirm: true });
    ok('两单批准后占用 = 上限 1000', await committed(2026) === 1000, String(await committed(2026)));
    const ex = await F.expireDue({ username: U, now: at('2027-01-02T10:00') });
    ok('月末未付自动失效 2 单', ex.count === 2 && ex.expired.length === 2, JSON.stringify(ex));
    ok('失效后释放全部额度', await committed(2026) === 0, String(await committed(2026)));
    const sts = await db.query('SELECT status FROM special_budget_approvals');
    ok('审批状态全部 expired', sts.every(x => x.status === 'expired'), JSON.stringify(sts));
    const schExp = await schedBySeq(subE1.body.approval.id, 1);
    const payExp = await err(() => F.paySchedule({ username: U, scheduleId: schExp.id, idemKey: key('p'), now: at('2027-01-03T10:00') }));
    ok('失效单付款 → APPROVAL_EXPIRED 409', isErr(payExp, 'APPROVAL_EXPIRED') && payExp.status === 409, JSON.stringify(payExp));

    await fresh();
    await addYearConfig(2028, 10000);
    await addYearConfig(2029, 10000);
    const subEU = await submitAt('large', 900, '2027-05-01T10:00', { installments: 1 });
    await approveAt(subEU.body.approval.id, '2027-05-01T10:05', { secondConfirm: true });
    const exU = await F.expireDue({ username: U, now: at('2027-06-02T10:00') });
    const stEU = await db.one('SELECT status FROM special_budget_approvals WHERE id = ?', [subEU.body.approval.id]);
    ok('大额当月未付 → 过期扫描失效并释放', exU.count === 1 && stEU.status === 'expired' &&
      await committed(2027) === 0, JSON.stringify({ ex: exU, st: stEU.status }));
    const subE3 = await submitAt('large', 4800, '2027-05-01T10:00', { installments: 24 });
    await approveAt(subE3.body.approval.id, '2027-05-01T10:05', { secondConfirm: true });
    const sE1 = await schedBySeq(subE3.body.approval.id, 1);
    await F.paySchedule({ username: U, scheduleId: sE1.id, idemKey: key('p'), now: at('2027-05-20T10:00') });
    const ex2 = await F.expireDue({ username: U, now: at('2027-06-02T10:00') });
    const stE3 = await db.one('SELECT status FROM special_budget_approvals WHERE id = ?', [subE3.body.approval.id]);
    ok('大额首期已付 → 过期扫描不失效', ex2.count === 0 && stE3.status === 'approved', JSON.stringify({ ex: ex2, st: stE3.status }));

    // ================= 6. 边界与状态机 =================
    await fresh();
    const needG = await mkNeed(uid, '普通单');
    const oidG = await mkOrder(uid, needG, 100);
    const notSpecial = await err(() => F.payOrder({ username: U, orderId: oidG, idemKey: key('p'), now: at('2026-12-05T10:00') }));
    ok('普通单走特殊付款 → ORDER_NOT_SPECIAL 409', isErr(notSpecial, 'ORDER_NOT_SPECIAL') && notSpecial.status === 409, JSON.stringify(notSpecial));
    const rfG = await err(() => F.refundOrder({ username: U, orderId: oidG, amount: 10, reason: 'x', idemKey: key('r'), now: at('2026-12-05T10:00') }));
    ok('普通单走特殊退款 → ORDER_NOT_SPECIAL', isErr(rfG, 'ORDER_NOT_SPECIAL'), JSON.stringify(rfG));
    const nf = await err(() => F.paySchedule({ username: U, scheduleId: 999999, idemKey: key('p'), now: at('2026-12-05T10:00') }));
    ok('不存在分期 → SCHEDULE_NOT_FOUND 404', isErr(nf, 'SCHEDULE_NOT_FOUND') && nf.status === 404, JSON.stringify(nf));
    ok('已退状态写入 refunded_at 列', N.transitionTimeCol('已退') === 'refunded_at');
    const trRefund = await N.applyOrderTransition(null, 1,
      { id: 1, need_id: 1, role: 'formal', status: '已下单', budget_type: 'special' }, '已退');
    ok('特殊订单退款流转被拦截', !!trRefund.error && trRefund.error.indexOf('特殊预算') >= 0, JSON.stringify(trRefund));
    const trCancel = await N.applyOrderTransition(null, 1,
      { id: 1, need_id: 1, role: 'formal', status: '已下单', budget_type: 'special' }, '已取消');
    ok('特殊订单取消流转被拦截', !!trCancel.error, JSON.stringify(trCancel));

    // ================= 7. 付款订单上限 / 未来年度分期只能提前还款 =================
    const subCap = await submitAt('large', 1600, '2027-05-01T10:00', { installments: 2 });
    const aidCap = subCap.body.approval.id;
    await approveAt(aidCap, '2027-05-01T10:05', { secondConfirm: true });
    const needCap = await mkNeed(uid, '订单上限保护');
    const oidCap = await mkOrder(uid, needCap, 800);
    await linkAt(aidCap, oidCap, '2027-05-02T10:00');
    const pCap1 = await F.payOrder({ username: U, orderId: oidCap, idemKey: key('p'), now: at('2027-05-20T10:00') });
    ok('单张订单首期 800 付款成功', pCap1.status === 200 && pCap1.body.schedule.amount === 800,
      JSON.stringify(pCap1.body.schedule));
    const pCap2 = await err(() => F.payOrder({ username: U, orderId: oidCap, idemKey: key('p'), now: at('2027-06-20T10:00') }));
    ok('超过采购单总额的第二期 → PAY_EXCEEDS_ORDER 409',
      isErr(pCap2, 'PAY_EXCEEDS_ORDER') && pCap2.status === 409, JSON.stringify(pCap2));

    await addYearConfig(2028, 10000);
    await addYearConfig(2029, 10000);
    const subF = await submitAt('large', 4800, '2027-05-01T10:00', { installments: 24 });
    const aidF = subF.body.approval.id;
    await approveAt(aidF, '2027-05-01T10:05', { secondConfirm: true });
    const sF28 = await db.one(
      'SELECT * FROM special_budget_schedules WHERE approval_id = ? AND year = 2028 ORDER BY seq LIMIT 1', [aidF]);
    const payF28 = await err(() => F.paySchedule({
      username: U, scheduleId: sF28.id, idemKey: key('p'), now: at('2027-05-20T10:00'),
    }));
    ok('未来年度直接付款 → USE_PREPAY 409',
      isErr(payF28, 'USE_PREPAY') && payF28.status === 409, JSON.stringify(payF28));
  } catch (e) {
    console.error('FAIL', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    try {
      for (const u of createdUsers) await db.exec('DELETE FROM users WHERE username = ?', [u]);
      if (createdUsers.length) {
        await db.exec('DELETE po FROM purchase_orders po LEFT JOIN users u ON u.id = po.user_id WHERE u.id IS NULL');
        await db.exec('DELETE pn FROM purchase_needs pn LEFT JOIN users u ON u.id = pn.user_id WHERE u.id IS NULL');
      }
      for (const t of ['special_budget_idempotency', 'special_budget_events', 'special_budget_schedules',
        'special_budget_links', 'special_budget_approvals', 'special_budget_snapshots', 'special_budget_rules']) {
        await db.exec(`DELETE FROM ${t}`);
      }
      migrateApply();
      await db.exec("UPDATE purchase_orders SET budget_type = 'general', special_approval_id = NULL WHERE budget_type <> 'general'");
    } catch (e) {
      console.error('cleanup failed:', e.message);
    }
    await db.pool.end();
  }

  console.log(`\n${passed} passed${process.exitCode ? '（有失败）' : ''}`);
})();
