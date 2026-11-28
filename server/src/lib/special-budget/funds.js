'use strict';
// 特殊预算 v3.2.2：付款 / 退款 / 分期付款 / 提前还款 / 改期 / 年段释放 / 对账
//
// 资金口径：
//  - 年度占用来自 special_budget_schedules：SUM(amount) - 已释放 - 已退款；
//  - 付款只改 schedule（paid_at），并可选回写订单 paid_at；
//  - 退款只能退已付金额，按原付款年度释放；未到期分期可整段释放；
//  - 同月退款恢复当月 800（由 events 统计），跨月/跨年退款不恢复原月、只释放原付款年度；
//  - 改期必须二次确认，旧计划释放 + 新计划占用，全程留事件；
//  - 所有写入同一事务，写审计失败则整笔回滚。
const db = require('../../db');
const R = require('./rules');
const T = require('./time');
const SCH = require('./schedule');
const audit = require('./audit');
const idem = require('./idempotency');
const tx = require('./tx');
const A = require('./approvals');
const S = require('./summary');
const { BizError } = require('./errors');

function qall(conn, sql, params) { return conn.query(sql, params).then(r => r[0]); }
function qone(conn, sql, params) { return qall(conn, sql, params).then(r => r[0] || null); }

function requireId(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  const m = /^(?:rec_)?(\d+)$/.exec(String(v == null ? '' : v));
  if (!m) throw new BizError('INVALID_ID', 'ID 格式无效', 400);
  return Number(m[1]);
}

function requireUsername(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.length > 64) throw new BizError('INVALID_USER', '用户无效', 400);
  return s;
}

function requireReason(v) {
  const s = String(v == null ? '' : v).trim();
  if (s.length < 1 || s.length > 500) {
    throw new BizError('INVALID_REASON', '原因必填且不超过 500 字', 400);
  }
  return s;
}

function assertMoney(v, field) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new BizError('INVALID_AMOUNT', `${field}必须大于 0`, 400);
  if (!R.hasAtMost2Decimals(n)) throw new BizError('INVALID_AMOUNT', `${field}最多两位小数`, 400);
  return R.round2(n);
}

function orderView(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    need_id: Number(r.need_id),
    supplier_id: r.supplier_id == null ? null : Number(r.supplier_id),
    status: r.status,
    budget_type: r.budget_type,
    special_approval_id: r.special_approval_id == null ? null : Number(r.special_approval_id),
    qty: Number(r.qty),
    price_paid: R.round2(r.price_paid),
    total: R.round2((Number(r.price_paid) || 0) * (Number(r.qty) || 1)),
    paid_at: T.bjDateTime(r.paid_at),
    refunded_at: T.bjDateTime(r.refunded_at),
    refund_amount: R.round2(r.refund_amount || 0),
    arrived_at: r.arrived_at || null,
    archived_at: r.archived_at || null,
  };
}

async function lockUser(conn, username) {
  return qone(conn, 'SELECT id, username FROM users WHERE username = ?', [username]);
}

async function lockOrder(conn, orderId, userId) {
  return qone(conn, 'SELECT * FROM purchase_orders WHERE id = ? AND user_id = ? FOR UPDATE', [orderId, userId]);
}

async function lockApprovalById(conn, id, username) {
  return qone(conn, 'SELECT * FROM special_budget_approvals WHERE id = ? AND username = ? FOR UPDATE', [id, username]);
}

async function schedulesOf(conn, approvalId) {
  return qall(conn, 'SELECT * FROM special_budget_schedules WHERE approval_id = ? ORDER BY seq FOR UPDATE', [approvalId]);
}

async function lockYears(conn, years) {
  const list = Array.from(new Set(years.map(Number))).sort((a, b) => a - b);
  for (const y of list) {
    await qall(conn, 'SELECT id FROM special_budget_rules WHERE year = ? ORDER BY id FOR UPDATE', [y]);
  }
}

async function nextSeq(conn, approvalId) {
  const row = await qone(conn, 'SELECT COALESCE(MAX(seq), 0) AS m FROM special_budget_schedules WHERE approval_id = ?', [approvalId]);
  return Number(row && row.m) + 1;
}

async function releaseSchedule(conn, sched, opts) {
  const o = opts || {};
  const now = o.now instanceof Date ? o.now : new Date();
  await conn.query("UPDATE special_budget_schedules SET status = 'released' WHERE id = ?", [sched.id]);
  const updated = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE id = ?', [sched.id]);
  await audit.appendEvent(conn, {
    approvalId: sched.approval_id,
    orderId: o.orderId == null ? sched.order_id : o.orderId,
    scheduleId: sched.id,
    eventType: 'release',
    amount: R.round2(sched.amount),
    actor: o.actor || 'system:release',
    at: now,
    ip: o.ip,
    reason: o.reason || '释放未到期分期',
    before: A.scheduleView(sched),
    after: A.scheduleView(updated),
    ruleVersion: o.ruleVersion || null,
  });
  return updated;
}

async function releaseSchedules(conn, appr, list, opts) {
  const out = [];
  for (const s of list || []) {
    if (!['planned', 'overdue'].includes(s.status)) continue;
    out.push(await releaseSchedule(conn, s, Object.assign({}, opts, { ruleVersion: opts && opts.ruleVersion || appr.rule_version })));
  }
  return out;
}

// 逾期只标记，不取消、不罚息（规则 §3.5）
async function markOverdue(conn, approvalId, now, ip) {
  const today = T.bjDate(now);
  const rows = await qall(conn,
    "SELECT * FROM special_budget_schedules WHERE approval_id = ? AND status = 'planned' AND due_date < ? FOR UPDATE",
    [approvalId, today]);
  const out = [];
  for (const s of rows) {
    await conn.query("UPDATE special_budget_schedules SET status = 'overdue' WHERE id = ?", [s.id]);
    await audit.appendEvent(conn, {
      approvalId, scheduleId: s.id, eventType: 'overdue', amount: R.round2(s.amount),
      actor: 'system:overdue', at: now, ip, reason: '到期未付款，标记逾期（不自动取消、不罚息）',
      before: A.scheduleView(s), after: Object.assign({}, A.scheduleView(s), { status: 'overdue' }),
      ruleVersion: null,
    });
    out.push(s.id);
  }
  return out;
}

// 审批通过后未按期付款：普通/周六追加月末失效；大额首期未在批准当月支付失效。
// 失效即释放该审批所有未付分期（年段释放），并写 expire/release 事件。
async function applyApprovedExpiry(conn, appr, now, ip) {
  if (!appr || appr.status !== 'approved' || !appr.expires_at) return false;
  if (now.getTime() <= new Date(appr.expires_at).getTime()) return false;
  const scheds = await schedulesOf(conn, appr.id);
  let expire = false;
  if (appr.type === 'large') {
    const first = scheds.find(s => Number(s.seq) === 1);
    if (!first || !first.paid_at) expire = true;
  } else if (!scheds.some(s => s.paid_at)) {
    expire = true;
  }
  if (!expire) return false;

  await conn.query("UPDATE special_budget_approvals SET status = 'expired' WHERE id = ?", [appr.id]);
  const released = await releaseSchedules(conn, appr, scheds, {
    now, ip, actor: 'system:expire', reason: '未按期付款，审批失效并释放年度额度',
  });
  await audit.appendEvent(conn, {
    approvalId: appr.id,
    eventType: 'expire',
    amount: R.round2(appr.approved_amount == null ? appr.requested_amount : appr.approved_amount),
    actor: 'system:expire',
    at: now,
    ip,
    reason: '批准后未在有效期内付款，自动失效',
    before: A.approvalView(appr),
    after: { status: 'expired', released_schedules: released.map(A.scheduleView) },
    ruleVersion: appr.rule_version,
  });
  return true;
}

async function assertPayable(conn, appr, sched, now, ip) {
  if (appr.status === 'expired') throw new BizError('APPROVAL_EXPIRED', '审批单已失效', 409);
  if (appr.status !== 'approved') {
    throw new BizError('APPROVAL_NOT_APPROVED', `审批单状态为 ${appr.status}，不能付款`, 409);
  }
  if (await applyApprovedExpiry(conn, appr, now, ip)) {
    throw new BizError('APPROVAL_EXPIRED', '已过付款有效期，审批单已失效并释放额度', 409);
  }
  if (!['planned', 'overdue'].includes(sched.status)) {
    throw new BizError('SCHEDULE_NOT_PAYABLE', `分期状态为 ${sched.status}，不能付款`, 409);
  }
  // 未来年度分期只能走「提前还款」（会释放未来年度承诺并记入当前年度），
  // 直接付款会把付款记在当前年但分期仍挂在未来年，导致年度占用/现金流口径错位。
  const bj = R.beijingParts(now);
  if (Number(sched.year) > bj.year) {
    throw new BizError('USE_PREPAY', '未来年度分期请使用「提前还款」', 409, {
      schedule_year: Number(sched.year), current_year: bj.year,
    });
  }
  const all = await qall(conn, 'SELECT * FROM special_budget_schedules WHERE approval_id = ? ORDER BY seq FOR UPDATE', [appr.id]);
  const earlier = all.filter(s => Number(s.seq) < Number(sched.seq) && ['planned', 'overdue'].includes(s.status));
  if (earlier.length) {
    throw new BizError('PAY_OUT_OF_ORDER', `请先支付第 ${earlier[0].seq} 期`, 409);
  }
}

async function doPay(conn, appr, sched, opts) {
  const o = opts || {};
  const now = o.now instanceof Date ? o.now : new Date();
  // 付款会把分期绑定到采购单，随后退款按该单已付金额封顶。
  // 若同一审批单绑了多张单，必须防止把超过单张订单总额的分期都绑到同一单上，
  // 否则超出订单总额的部分永远退不回来。
  if (o.orderId != null) {
    const order = await qone(conn,
      'SELECT price_paid, qty FROM purchase_orders WHERE id = ? FOR UPDATE', [o.orderId]);
    if (!order) throw new BizError('ORDER_NOT_FOUND', '采购单不存在', 404);
    const orderTotal = R.round2((Number(order.price_paid) || 0) * (Number(order.qty) || 1));
    const paidAgg = await qone(conn,
      `SELECT COALESCE(SUM(amount), 0) AS s
         FROM special_budget_schedules
        WHERE approval_id = ? AND order_id = ? AND paid_at IS NOT NULL AND id <> ?`,
      [appr.id, o.orderId, sched.id]);
    const already = R.round2(paidAgg.s);
    const amount = R.round2(sched.amount);
    if (R.round2(already + amount) > orderTotal + 0.005) {
      throw new BizError('PAY_EXCEEDS_ORDER',
        `采购单总额 ${orderTotal}，已付 ${already}，本次 ${amount} 超出可付金额`, 409, {
          order_total: orderTotal, paid: already, amount,
        });
    }
  }
  await conn.query(
    "UPDATE special_budget_schedules SET status = 'paid', paid_at = ?, order_id = COALESCE(order_id, ?) WHERE id = ?",
    [T.bjDateTime(now), o.orderId == null ? null : o.orderId, sched.id]);
  const updated = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE id = ?', [sched.id]);
  if (o.orderId != null) {
    await conn.query('UPDATE purchase_orders SET paid_at = COALESCE(paid_at, ?) WHERE id = ?',
      [T.bjDateTime(now), o.orderId]);
  }
  await audit.appendEvent(conn, {
    approvalId: appr.id,
    orderId: o.orderId == null ? updated.order_id : o.orderId,
    scheduleId: updated.id,
    eventType: 'pay',
    amount: R.round2(updated.amount),
    actor: o.actor,
    at: now,
    ip: o.ip,
    reason: o.reason || null,
    before: A.scheduleView(sched),
    after: A.scheduleView(updated),
    ruleVersion: appr.rule_version,
  });
  return updated;
}

// ---------------- 付款 ----------------
async function paySchedule(opts) {
  const o = opts || {};
  const username = requireUsername(o.username);
  const scheduleId = requireId(o.scheduleId);
  const now = o.now instanceof Date ? o.now : new Date();
  const orderId = o.orderId == null || o.orderId === '' ? null : requireId(o.orderId);
  const requestHash = idem.hash({ scheduleId, orderId });

  return idem.run({ username, scope: 'schedule.pay', key: o.idemKey, requestHash }, async conn => {
    const pre = await qone(conn, 'SELECT approval_id FROM special_budget_schedules WHERE id = ?', [scheduleId]);
    if (!pre) throw new BizError('SCHEDULE_NOT_FOUND', '分期不存在', 404);
    const appr = await lockApprovalById(conn, pre.approval_id, username);
    if (!appr) throw new BizError('SCHEDULE_NOT_FOUND', '分期不存在', 404);
    let sched = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE id = ? FOR UPDATE', [scheduleId]);
    if (!sched) throw new BizError('SCHEDULE_NOT_FOUND', '分期不存在', 404);

    let order = null;
    if (orderId != null) {
      const user = await lockUser(conn, username);
      if (!user) throw new BizError('USER_NOT_FOUND', '用户不存在', 404);
      order = await lockOrder(conn, orderId, user.id);
      if (!order) throw new BizError('ORDER_NOT_FOUND', '采购单不存在', 404);
      if (Number(order.special_approval_id) !== Number(appr.id) || order.budget_type !== 'special') {
        throw new BizError('ORDER_NOT_LINKED', '采购单未关联该审批单', 409);
      }
    }

    await markOverdue(conn, appr.id, now, o.ip);
    sched = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE id = ? FOR UPDATE', [scheduleId]);
    await assertPayable(conn, appr, sched, now, o.ip);
    const paid = await doPay(conn, appr, sched, {
      now, ip: o.ip, actor: username, orderId: order ? order.id : null,
    });
    const newOrder = order ? await qone(conn, 'SELECT * FROM purchase_orders WHERE id = ?', [order.id]) : null;
    return {
      status: 200,
      body: {
        ok: true,
        schedule: A.scheduleView(paid),
        approval: A.approvalView(appr),
        order: newOrder ? orderView(newOrder) : null,
      },
      resourceId: Number(sched.id),
    };
  });
}

async function payOrder(opts) {
  const o = opts || {};
  const username = requireUsername(o.username);
  const orderId = requireId(o.orderId);
  const now = o.now instanceof Date ? o.now : new Date();
  const scheduleId = o.scheduleId == null || o.scheduleId === '' ? null : requireId(o.scheduleId);
  const seq = o.seq == null || o.seq === '' ? null : Number(o.seq);
  if (seq !== null && !Number.isInteger(seq)) throw new BizError('INVALID_SEQ', 'seq 需为整数', 400);
  const requestHash = idem.hash({ orderId, scheduleId, seq });

  return idem.run({ username, scope: 'order.pay', key: o.idemKey, requestHash }, async conn => {
    const user = await lockUser(conn, username);
    if (!user) throw new BizError('USER_NOT_FOUND', '用户不存在', 404);
    const order = await lockOrder(conn, orderId, user.id);
    if (!order) throw new BizError('ORDER_NOT_FOUND', '采购单不存在', 404);
    if (order.budget_type !== 'special' || order.special_approval_id == null) {
      throw new BizError('ORDER_NOT_SPECIAL', '不是特殊预算采购单', 409);
    }
    const appr = await lockApprovalById(conn, order.special_approval_id, username);
    if (!appr) throw new BizError('APPROVAL_NOT_FOUND', '审批单不存在', 404);

    await markOverdue(conn, appr.id, now, o.ip);
    let sched;
    if (scheduleId != null) {
      sched = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE id = ? AND approval_id = ? FOR UPDATE',
        [scheduleId, appr.id]);
      if (!sched) throw new BizError('SCHEDULE_NOT_FOUND', '该审批单下无此分期', 404);
    } else if (seq != null) {
      sched = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE approval_id = ? AND seq = ? FOR UPDATE',
        [appr.id, seq]);
      if (!sched) throw new BizError('SCHEDULE_NOT_FOUND', '该审批单下无此分期', 404);
    } else {
      sched = await qone(conn,
        "SELECT * FROM special_budget_schedules WHERE approval_id = ? AND status IN ('planned','overdue') ORDER BY seq LIMIT 1 FOR UPDATE",
        [appr.id]);
      if (!sched) throw new BizError('NO_PAYABLE_SCHEDULE', '没有待付款分期', 409);
    }

    await assertPayable(conn, appr, sched, now, o.ip);
    const paid = await doPay(conn, appr, sched, {
      now, ip: o.ip, actor: username, orderId: order.id,
    });
    const newOrder = await qone(conn, 'SELECT * FROM purchase_orders WHERE id = ?', [order.id]);
    return {
      status: 200,
      body: {
        ok: true,
        schedule: A.scheduleView(paid),
        approval: A.approvalView(appr),
        order: orderView(newOrder),
      },
      resourceId: Number(paid.id),
    };
  });
}

// ---------------- 退款 ----------------
async function refundOrder(opts) {
  const o = opts || {};
  const username = requireUsername(o.username);
  const orderId = requireId(o.orderId);
  const now = o.now instanceof Date ? o.now : new Date();
  const reason = requireReason(o.reason);
  const releaseFuture = o.releaseFuture !== false;
  const amountInput = o.amount === undefined || o.amount === null || o.amount === '' ? null : o.amount;
  const requestHash = idem.hash({
    orderId, amount: amountInput === null ? null : R.round2(amountInput), reason, releaseFuture,
  });

  return idem.run({ username, scope: 'order.refund', key: o.idemKey, requestHash }, async conn => {
    const user = await lockUser(conn, username);
    if (!user) throw new BizError('USER_NOT_FOUND', '用户不存在', 404);
    const order = await lockOrder(conn, orderId, user.id);
    if (!order) throw new BizError('ORDER_NOT_FOUND', '采购单不存在', 404);
    if (order.budget_type !== 'special' || order.special_approval_id == null) {
      throw new BizError('ORDER_NOT_SPECIAL', '不是特殊预算采购单', 409);
    }
    const appr = await lockApprovalById(conn, order.special_approval_id, username);
    if (!appr) throw new BizError('APPROVAL_NOT_FOUND', '审批单不存在', 404);

    const otherLinks = await qone(conn,
      "SELECT COUNT(*) AS c FROM special_budget_links WHERE approval_id = ? AND order_id <> ? AND status = 'active'",
      [appr.id, order.id]);
    const hasOtherActive = Number(otherLinks && otherLinks.c) > 0;

    const paid = await qall(conn,
      'SELECT * FROM special_budget_schedules WHERE approval_id = ? AND paid_at IS NOT NULL ORDER BY paid_at, seq FOR UPDATE',
      [appr.id]);
    const eligible = paid.filter(s => Number(s.order_id) === Number(order.id) ||
      (!hasOtherActive && s.order_id == null));
    const remainingPaid = R.round2(eligible.reduce((acc, s) => acc + Math.max(0, Number(s.amount) - Number(s.refund_amount || 0)), 0));
    if (remainingPaid <= 0.005) {
      throw new BizError('NO_PAID_AMOUNT', '该订单没有可退金额', 409);
    }
    let amount = amountInput === null ? remainingPaid : assertMoney(amountInput, '退款金额');
    if (amount > remainingPaid + 0.005) {
      throw new BizError('REFUND_EXCEEDS_PAID', `退款金额不能超过已付未退金额 ${remainingPaid}`, 400, {
        paid: remainingPaid,
      });
    }
    amount = R.round2(amount);

    const orderTotal = R.round2((Number(order.price_paid) || 0) * (Number(order.qty) || 1));
    const oldOrderRefund = R.round2(order.refund_amount || 0);
    if (R.round2(oldOrderRefund + amount) > orderTotal + 0.005) {
      throw new BizError('REFUND_EXCEEDS_ORDER', `累计退款不能超过订单金额 ${orderTotal}`, 400, {
        order_total: orderTotal, already_refunded: oldOrderRefund,
      });
    }

    let left = amount;
    const allocations = [];
    for (const s of eligible) {
      if (left <= 0.005) break;
      const room = R.round2(Number(s.amount) - Number(s.refund_amount || 0));
      if (room <= 0.005) continue;
      const take = R.round2(Math.min(room, left));
      const before = A.scheduleView(s);
      const newRefund = R.round2(Number(s.refund_amount || 0) + take);
      const newStatus = newRefund >= Number(s.amount) - 0.005 ? 'refunded' : 'paid';
      await conn.query(
        'UPDATE special_budget_schedules SET refund_amount = ?, refunded_at = ?, status = ? WHERE id = ?',
        [newRefund, T.bjDateTime(now), newStatus, s.id]);
      const after = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE id = ?', [s.id]);
      await audit.appendEvent(conn, {
        approvalId: appr.id, orderId: order.id, scheduleId: s.id, eventType: 'refund',
        amount: take, actor: username, at: now, ip: o.ip, reason,
        before, after: A.scheduleView(after), ruleVersion: appr.rule_version,
      });
      allocations.push({ schedule_id: Number(s.id), seq: Number(s.seq), amount: take, year: Number(s.year) });
      left = R.round2(left - take);
    }
    if (left > 0.005) {
      throw new BizError('REFUND_ALLOCATION_FAILED', '退款分摊失败，请重试', 500, { unallocated: left });
    }

    await conn.query(
      "UPDATE purchase_orders SET refund_amount = ?, refunded_at = ?, status = '已退' WHERE id = ?",
      [R.round2(oldOrderRefund + amount), T.bjDateTime(now), order.id]);

    // 关联释放：A 退款后，批准单剩余额度可复用于 B（§3.4）
    await conn.query(
      "UPDATE special_budget_links SET status = 'released', released_at = ? WHERE approval_id = ? AND order_id = ? AND status = 'active'",
      [T.bjDateTime(now), appr.id, order.id]);

    let released = [];
    if (releaseFuture && !hasOtherActive) {
      const all = await schedulesOf(conn, appr.id);
      released = await releaseSchedules(conn, appr,
        all.filter(s => ['planned', 'overdue'].includes(s.status)), {
          now, ip: o.ip, actor: username, orderId: order.id,
          reason: '退款释放未到期分期/未来年度承诺',
        });
    }

    const newOrder = await qone(conn, 'SELECT * FROM purchase_orders WHERE id = ?', [order.id]);
    return {
      status: 200,
      body: {
        ok: true,
        order: orderView(newOrder),
        approval: A.approvalView(appr),
        refund_amount: amount,
        cumulative_refund: R.round2(oldOrderRefund + amount),
        allocations,
        released_schedules: released.map(A.scheduleView),
        released_future: released.length > 0,
      },
      resourceId: Number(order.id),
    };
  });
}

// ---------------- 提前还款 ----------------
async function prepaySchedule(opts) {
  const o = opts || {};
  const username = requireUsername(o.username);
  const scheduleId = requireId(o.scheduleId);
  const now = o.now instanceof Date ? o.now : new Date();
  const bj = R.beijingParts(now);
  const requestHash = idem.hash({ scheduleId });

  return idem.run({ username, scope: 'schedule.prepay', key: o.idemKey, requestHash }, async conn => {
    const pre = await qone(conn, 'SELECT approval_id, year FROM special_budget_schedules WHERE id = ?', [scheduleId]);
    if (!pre) throw new BizError('SCHEDULE_NOT_FOUND', '分期不存在', 404);
    const appr = await lockApprovalById(conn, pre.approval_id, username);
    if (!appr) throw new BizError('SCHEDULE_NOT_FOUND', '分期不存在', 404);
    let sched = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE id = ? FOR UPDATE', [scheduleId]);
    if (!sched) throw new BizError('SCHEDULE_NOT_FOUND', '分期不存在', 404);
    if (appr.status !== 'approved') {
      throw new BizError('APPROVAL_NOT_APPROVED', `审批单状态为 ${appr.status}，不能提前还款`, 409);
    }
    if (!['planned', 'overdue'].includes(sched.status)) {
      throw new BizError('SCHEDULE_NOT_PREPAYABLE', `分期状态为 ${sched.status}，不能提前还款`, 409);
    }
    if (Number(sched.year) <= Number(bj.year)) {
      throw new BizError('NOT_FUTURE_YEAR', '只有未来年度的分期可以提前还款', 400);
    }

    await lockYears(conn, [sched.year, bj.year]);
    const cfgRow = await A.latestConfigRow(conn, bj.year);
    if (!cfgRow) throw new BizError('CONFIG_MISSING', `${bj.year} 年未配置特殊预算`, 400);
    const config = R.configView(cfgRow);
    const committed = await A.committedForYear(conn, bj.year);
    const amount = R.round2(sched.amount);
    if (R.round2(committed + amount) > R.round2(config.annual_cap) + 0.005) {
      throw new BizError('ANNUAL_EXCEEDED', `${bj.year} 年年度上限不足：已占用 ${committed}，提前还款 ${amount}，上限 ${config.annual_cap}`, 400, {
        year: bj.year, committed, amount, annual_cap: config.annual_cap,
      });
    }

    const releasedSched = await releaseSchedule(conn, sched, {
      now, ip: o.ip, actor: username, orderId: sched.order_id,
      reason: '提前还款：释放未来年度承诺',
    });
    const seq = await nextSeq(conn, appr.id);
    const [ins] = await conn.query(
      `INSERT INTO special_budget_schedules
         (approval_id, order_id, seq, due_date, year, month, amount, status, paid_at)
       VALUES (?,?,?,?,?,?,?, 'paid', ?)`,
      [appr.id, sched.order_id == null ? null : sched.order_id, seq, T.bjDate(now), bj.year, bj.month,
        amount, T.bjDateTime(now)]);
    const newSched = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE id = ?', [Number(ins.insertId)]);
    await audit.appendEvent(conn, {
      approvalId: appr.id, orderId: sched.order_id, scheduleId: newSched.id, eventType: 'pay',
      amount, actor: username, at: now, ip: o.ip, reason: '提前还款',
      before: null, after: A.scheduleView(newSched), ruleVersion: config.rule_version,
    });
    return {
      status: 200,
      body: {
        ok: true,
        released: A.scheduleView(releasedSched),
        paid: A.scheduleView(newSched),
        prepaid_amount: amount,
        prepaid_year: bj.year,
        annual_cap: R.round2(config.annual_cap),
        annual_committed_before: committed,
      },
      resourceId: Number(newSched.id),
    };
  });
}

// ---------------- 改期 ----------------
async function rescheduleSchedule(opts) {
  const o = opts || {};
  const username = requireUsername(o.username);
  const scheduleId = requireId(o.scheduleId);
  const now = o.now instanceof Date ? o.now : new Date();
  const toYear = Number(o.year);
  const toMonth = Number(o.month);
  if (!Number.isInteger(toYear) || toYear < 2026 || toYear > 2100) {
    throw new BizError('INVALID_YEAR', 'year 需为 2026..2100 的整数', 400);
  }
  if (!Number.isInteger(toMonth) || toMonth < 1 || toMonth > 12) {
    throw new BizError('INVALID_MONTH', 'month 需为 1..12 的整数', 400);
  }
  const reason = requireReason(o.reason);
  if (o.secondConfirm !== true) {
    throw new BizError('SECOND_CONFIRM_REQUIRED', '改期需要同一账号二次确认', 428);
  }
  const requestHash = idem.hash({ scheduleId, toYear, toMonth, reason, secondConfirm: true });

  return idem.run({ username, scope: 'schedule.reschedule', key: o.idemKey, requestHash }, async conn => {
    const pre = await qone(conn, 'SELECT approval_id FROM special_budget_schedules WHERE id = ?', [scheduleId]);
    if (!pre) throw new BizError('SCHEDULE_NOT_FOUND', '分期不存在', 404);
    const appr = await lockApprovalById(conn, pre.approval_id, username);
    if (!appr) throw new BizError('SCHEDULE_NOT_FOUND', '分期不存在', 404);
    const sched = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE id = ? FOR UPDATE', [scheduleId]);
    if (!sched) throw new BizError('SCHEDULE_NOT_FOUND', '分期不存在', 404);
    if (appr.status !== 'approved') {
      throw new BizError('APPROVAL_NOT_APPROVED', `审批单状态为 ${appr.status}，不能改期`, 409);
    }
    if (!['planned', 'overdue'].includes(sched.status)) {
      throw new BizError('SCHEDULE_NOT_RESCHEDULABLE', `分期状态为 ${sched.status}，不能改期`, 409);
    }
    if (toYear === Number(sched.year) && toMonth === Number(sched.month)) {
      throw new BizError('SAME_PERIOD', '改期目标与原分期相同', 400);
    }
    if (toYear === 2026 && toMonth !== 12) {
      throw new BizError('2026_ONLY_DECEMBER', '2026 年仅 12 月试运行', 400);
    }
    if (Number(sched.year) === 2026 && toYear !== 2026) {
      throw new BizError('CROSS_YEAR_NOT_ALLOWED', '2026 年分期不允许跨年改期', 400);
    }
    // 不能改到已经结束的月份：否则新计划一创建就是逾期，且可绕过同期申请窗口。
    const bjNow = R.beijingParts(now);
    if (toYear < bjNow.year || (toYear === bjNow.year && toMonth < bjNow.month)) {
      throw new BizError('PAST_PERIOD', '改期目标不能早于当前月份', 400, {
        current_year: bjNow.year, current_month: bjNow.month,
      });
    }

    await lockYears(conn, [sched.year, toYear]);
    const cfgRow = await A.latestConfigRow(conn, toYear);
    if (!cfgRow) throw new BizError('CONFIG_MISSING', `${toYear} 年未配置特殊预算`, 400);
    const config = R.configView(cfgRow);

    const releasedSched = await releaseSchedule(conn, sched, {
      now, ip: o.ip, actor: username, orderId: sched.order_id,
      reason: `改期：${reason}`,
    });
    const committed = await A.committedForYear(conn, toYear);
    const amount = R.round2(sched.amount);
    if (R.round2(committed + amount) > R.round2(config.annual_cap) + 0.005) {
      throw new BizError('ANNUAL_EXCEEDED', `${toYear} 年年度上限不足：已占用 ${committed}，需 ${amount}，上限 ${config.annual_cap}`, 400, {
        year: toYear, committed, amount, annual_cap: config.annual_cap,
      });
    }

    const seq = await nextSeq(conn, appr.id);
    const [ins] = await conn.query(
      `INSERT INTO special_budget_schedules
         (approval_id, order_id, seq, due_date, year, month, amount, status)
       VALUES (?,?,?,?,?,?,?, 'planned')`,
      [appr.id, sched.order_id == null ? null : sched.order_id, seq,
        T.monthEndDate(toYear, toMonth), toYear, toMonth, amount]);
    const newSched = await qone(conn, 'SELECT * FROM special_budget_schedules WHERE id = ?', [Number(ins.insertId)]);
    await audit.appendEvent(conn, {
      approvalId: appr.id, orderId: sched.order_id, scheduleId: newSched.id, eventType: 'reschedule',
      amount, actor: username, at: now, ip: o.ip, reason,
      before: A.scheduleView(sched),
      after: { released: A.scheduleView(releasedSched), planned: A.scheduleView(newSched) },
      ruleVersion: config.rule_version,
    });
    return {
      status: 200,
      body: {
        ok: true,
        released: A.scheduleView(releasedSched),
        scheduled: A.scheduleView(newSched),
        year: toYear,
        month: toMonth,
        annual_cap: R.round2(config.annual_cap),
        annual_committed_before: committed,
        second_confirmed: true,
      },
      resourceId: Number(newSched.id),
    };
  });
}

// ---------------- 过期扫描 ----------------
async function expireDue(opts) {
  const o = opts || {};
  const now = o.now instanceof Date ? o.now : new Date();
  const username = o.username == null ? null : requireUsername(o.username);
  const params = [T.bjDateTime(now)];
  let sql = "SELECT id FROM special_budget_approvals WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at < ?";
  if (username) { sql += ' AND username = ?'; params.push(username); }
  const rows = await db.query(sql + ' ORDER BY id', params);
  const expired = [];
  for (const r of rows) {
    const changed = await tx.withTransaction(async conn => {
      const appr = await qone(conn, 'SELECT * FROM special_budget_approvals WHERE id = ? FOR UPDATE', [r.id]);
      if (!appr || appr.status !== 'approved') return false;
      if (!username || appr.username === username) {
        await markOverdue(conn, appr.id, now, o.ip);
        return applyApprovedExpiry(conn, appr, now, o.ip);
      }
      return false;
    });
    if (changed) expired.push(Number(r.id));
  }
  return { ok: true, as_of: T.bjDateTime(now), expired, count: expired.length };
}

// ---------------- 对账 ----------------
function bjMonthRange(year, month) {
  const b = T.monthBounds(year, month);
  return {
    start: b.start,
    end: b.end,
    msStart: Date.parse(b.start.replace(' ', 'T') + '+08:00'),
    msEnd: Date.parse(b.end.replace(' ', 'T') + '+08:00'),
  };
}

async function reconcile(opts) {
  const o = opts || {};
  const year = Number(o.year);
  const month = Number(o.month);
  if (!Number.isInteger(year) || year < 2026 || year > 2100) {
    throw new BizError('INVALID_YEAR', 'year 需为 2026..2100 的整数', 400);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new BizError('INVALID_MONTH', 'month 需为 1..12 的整数', 400);
  }
  const config = await S.getConfig(year);
  if (!config) throw new BizError('CONFIG_MISSING', `${year} 年未配置特殊预算`, 404);
  const rng = bjMonthRange(year, month);

  const [
    scheduleAgg, payEvent, refundEvent, releaseEvent,
    approvalAgg, linkAgg, monthPaid, monthRefund,
    generalAgg, specialExcluded,
  ] = await Promise.all([
    db.one(
      `SELECT COALESCE(SUM(amount), 0) AS total,
              COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN amount ELSE 0 END), 0) AS paid,
              COALESCE(SUM(refund_amount), 0) AS refunded,
              COALESCE(SUM(CASE WHEN status = 'released' THEN amount ELSE 0 END), 0) AS released
         FROM special_budget_schedules WHERE year = ?`, [year]),
    db.one(
      `SELECT COALESCE(SUM(e.amount), 0) AS s
         FROM special_budget_events e
         JOIN special_budget_schedules sc ON sc.id = e.schedule_id
        WHERE e.event_type = 'pay' AND sc.year = ?`, [year]),
    db.one(
      `SELECT COALESCE(SUM(e.amount), 0) AS s
         FROM special_budget_events e
         JOIN special_budget_schedules sc ON sc.id = e.schedule_id
        WHERE e.event_type = 'refund' AND sc.year = ?`, [year]),
    db.one(
      `SELECT COALESCE(SUM(e.amount), 0) AS s
         FROM special_budget_events e
         JOIN special_budget_schedules sc ON sc.id = e.schedule_id
        WHERE e.event_type = 'release' AND sc.year = ?`, [year]),
    db.one(
      `SELECT COUNT(*) AS count, COALESCE(SUM(approved_amount), 0) AS amount
         FROM special_budget_approvals
        WHERE status = 'approved' AND applied_at >= ? AND applied_at < ?`,
      [rng.start, rng.end]),
    db.one(
      `SELECT COUNT(*) AS count, COALESCE(SUM(linked_amount), 0) AS amount
         FROM special_budget_links
        WHERE linked_at >= ? AND linked_at < ?`, [rng.start, rng.end]),
    db.one(
      `SELECT COALESCE(SUM(amount), 0) AS amount
         FROM special_budget_schedules WHERE paid_at >= ? AND paid_at < ?`,
      [rng.start, rng.end]),
    db.one(
      `SELECT COALESCE(SUM(amount), 0) AS amount
         FROM special_budget_events
        WHERE event_type = 'refund' AND at >= ? AND at < ?`,
      [rng.start, rng.end]),
    db.one(
      `SELECT COUNT(*) AS count, COALESCE(SUM(price_paid * qty), 0) AS amount
         FROM purchase_orders
        WHERE budget_type <> 'special' AND status IN ('已下单','已到','已归档')
          AND date_ms IS NOT NULL AND date_ms >= ? AND date_ms < ?`,
      [rng.msStart, rng.msEnd]),
    db.one(
      `SELECT COUNT(*) AS count, COALESCE(SUM(price_paid * qty), 0) AS amount
         FROM purchase_orders
        WHERE budget_type = 'special' AND status IN ('已下单','已到','已归档')
          AND date_ms IS NOT NULL AND date_ms >= ? AND date_ms < ?`,
      [rng.msStart, rng.msEnd]),
  ]);

  const cap = R.round2(config.annual_cap);
  const total = R.round2(scheduleAgg.total);
  const paid = R.round2(scheduleAgg.paid);
  const refunded = R.round2(scheduleAgg.refunded);
  const released = R.round2(scheduleAgg.released);
  const committed = R.round2(Math.max(0, total - released - refunded));
  const remaining = R.round2(cap - committed);

  const payEvents = R.round2(payEvent.s);
  const refundEvents = R.round2(refundEvent.s);
  const releaseEvents = R.round2(releaseEvent.s);
  const checks = [
    { name: 'pay_events_vs_schedules', expected: paid, actual: payEvents, difference: R.round2(Math.abs(paid - payEvents)) },
    { name: 'refund_events_vs_schedules', expected: refunded, actual: refundEvents, difference: R.round2(Math.abs(refunded - refundEvents)) },
    { name: 'release_events_vs_schedules', expected: released, actual: releaseEvents, difference: R.round2(Math.abs(released - releaseEvents)) },
    { name: 'annual_committed_identity', expected: committed, actual: R.round2(Math.max(0, total - released - refunded)), difference: 0 },
    { name: 'annual_remaining_identity', expected: remaining, actual: R.round2(cap - committed), difference: 0 },
  ];
  const difference = R.round2(checks.reduce((m, c) => Math.max(m, c.difference), 0));

  const generalAmount = R.round2(generalAgg.amount);
  const specialPaid = R.round2(monthPaid.amount);
  const specialRefunded = R.round2(monthRefund.amount);
  const specialNet = R.round2(specialPaid - specialRefunded);

  return {
    ok: true,
    year,
    month,
    as_of: R.fmtBeijing(R.beijingParts(new Date())),
    config,
    approvals: { count: Number(approvalAgg.count), approved_amount: R.round2(approvalAgg.amount) },
    links: { count: Number(linkAgg.count), linked_amount: R.round2(linkAgg.amount) },
    payments: { paid_amount: specialPaid, pay_events: payEvents },
    refunds: { refunded_amount: specialRefunded, refund_events: refundEvents },
    annual: {
      annual_cap: cap,
      schedule_total: total,
      annual_paid: paid,
      annual_refunded: refunded,
      annual_released: released,
      annual_committed: committed,
      annual_remaining: remaining,
      paid_events: payEvents,
      refund_events: refundEvents,
      release_events: releaseEvents,
    },
    cash_flow: {
      general: { count: Number(generalAgg.count), amount: generalAmount },
      special: { paid: specialPaid, refunded: specialRefunded, net: specialNet },
      total: R.round2(generalAmount + specialNet),
      special_excluded_from_general: {
        count: Number(specialExcluded.count),
        amount: R.round2(specialExcluded.amount),
      },
      note: '一般预算排除 special；总现金流 = 一般采购 + 特殊实付 - 特殊退款',
    },
    checks,
    difference,
    reconciled: difference < 0.005,
  };
}

module.exports = {
  orderView,
  paySchedule,
  payOrder,
  refundOrder,
  prepaySchedule,
  rescheduleSchedule,
  expireDue,
  reconcile,
  releaseSchedules,
  markOverdue,
  applyApprovedExpiry,
};
