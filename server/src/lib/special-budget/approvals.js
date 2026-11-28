'use strict';
// 特殊预算 v3.2.1：申请 / 批准 / 驳回 / 取消 / 关联采购单
// 关键约束：
//  - 年度上限是全局额度（不按用户各算各的），审批聚合不带 username 过滤；username 只用于归属与操作权限。
//  - 审批通过才占用年度额度，并立即生成分期/单期计划（status=planned）。
//  - 所有写入在事务内完成；审批并发按年度配置行 FOR UPDATE 串行，防止超额。
//  - 大额必须同账号二次确认；配置修改同样。
//  - 审计事件与业务写入同事务，失败即整笔回滚。
const crypto = require('crypto');
const db = require('../../db');
const R = require('./rules');
const SCH = require('./schedule');
const T = require('./time');
const audit = require('./audit');
const idem = require('./idempotency');
const { BizError } = require('./errors');

const TYPES = ['normal', 'additional', 'large'];
const STATUSES = ['pending', 'approved', 'rejected', 'cancelled', 'expired', 'closed'];

function pad(n) { return String(n).padStart(2, '0'); }
function qall(conn, sql, params) { return conn.query(sql, params).then(r => r[0]); }
function qone(conn, sql, params) { return qall(conn, sql, params).then(r => r[0] || null); }

function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

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

function requireText(v, field, max, optional) {
  if (v === null || v === undefined || String(v).trim() === '') {
    if (optional) return null;
    throw new BizError('INVALID_' + field.toUpperCase(), `${field} 不能为空`, 400);
  }
  const s = String(v).trim();
  if (s.length > max) throw new BizError('INVALID_' + field.toUpperCase(), `${field} 不能超过 ${max} 字`, 400);
  return s;
}

function pickDetail(r) {
  const keys = ['window', 'shortfall', 'calculation', 'config', 'years', 'year', 'detail', 'first', 'last', 'segments'];
  const d = {};
  for (const k of keys) if (r && r[k] !== undefined) d[k] = r[k];
  return Object.keys(d).length ? d : null;
}

function ruleFail(r) {
  throw new BizError(r.code || 'RULE_FAILED', r.message || '规则校验未通过', 400, pickDetail(r));
}

function approvalView(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    approval_no: r.approval_no,
    username: r.username,
    type: r.type,
    purpose: r.purpose,
    requested_amount: R.round2(r.requested_amount),
    approved_amount: r.approved_amount == null ? null : R.round2(r.approved_amount),
    status: r.status,
    rule_version: r.rule_version,
    applied_at: T.bjDateTime(r.applied_at),
    approved_at: T.bjDateTime(r.approved_at),
    expires_at: T.bjDateTime(r.expires_at),
    second_confirmed_by: r.second_confirmed_by || null,
    second_confirmed_at: T.bjDateTime(r.second_confirmed_at),
    parent_id: r.parent_id == null ? null : Number(r.parent_id),
    note: r.note == null ? null : r.note,
    installments: Number(r.installments) || 1,
    first_year: r.first_year == null ? null : Number(r.first_year),
    first_month: r.first_month == null ? null : Number(r.first_month),
    created_at: T.bjDateTime(r.created_at),
    updated_at: T.bjDateTime(r.updated_at),
  };
}

function scheduleView(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    approval_id: Number(r.approval_id),
    order_id: r.order_id == null ? null : Number(r.order_id),
    seq: Number(r.seq),
    due_date: T.bjDate(r.due_date),
    year: Number(r.year),
    month: r.month == null ? null : Number(r.month),
    amount: R.round2(r.amount),
    status: r.status,
    paid_at: T.bjDateTime(r.paid_at),
    refunded_at: T.bjDateTime(r.refunded_at),
    refund_amount: R.round2(r.refund_amount || 0),
  };
}

function linkView(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    approval_id: Number(r.approval_id),
    order_id: Number(r.order_id),
    link_type: r.link_type,
    linked_amount: R.round2(r.linked_amount),
    status: r.status,
    linked_at: T.bjDateTime(r.linked_at),
    released_at: T.bjDateTime(r.released_at),
  };
}

async function latestConfigRow(conn, year) {
  return qone(conn,
    'SELECT * FROM special_budget_rules WHERE year = ? ORDER BY effective_from DESC, id DESC LIMIT 1',
    [year]);
}

async function lockYear(conn, year) {
  await qall(conn, 'SELECT id FROM special_budget_rules WHERE year = ? ORDER BY id FOR UPDATE', [year]);
}

async function configsForYears(conn, years) {
  const list = Array.from(new Set(years.map(Number))).sort((a, b) => a - b);
  if (!list.length) return [];
  const rows = await qall(conn,
    `SELECT * FROM special_budget_rules WHERE year IN (${list.map(() => '?').join(',')})
      ORDER BY year, effective_from, id`, list);
  const latest = new Map();
  for (const r of rows) latest.set(Number(r.year), r); // 升序，后者覆盖前者
  return Array.from(latest.values());
}

// 年度已占用 = 计划总额 - 已释放 - 已退款（与只读汇总口径一致）
async function committedForYear(conn, year) {
  const r = await qone(conn,
    `SELECT COALESCE(SUM(amount), 0) AS total,
            COALESCE(SUM(CASE WHEN status = 'released' THEN amount ELSE 0 END), 0) AS released,
            COALESCE(SUM(refund_amount), 0) AS refunded
       FROM special_budget_schedules WHERE year = ?`, [year]);
  return R.round2(Math.max(0, Number(r.total) - Number(r.released) - Number(r.refunded)));
}

// 某月已批普通 / 某日已批周六追加（全局额度，不含当前审批）
async function monthAgg(conn, year, month, dateStr, excludeId) {
  const b = T.monthBounds(year, month);
  const ex = excludeId ? ' AND id <> ?' : '';
  const p1 = [b.start, b.end].concat(excludeId ? [excludeId] : []);
  const normal = await qone(conn,
    `SELECT COALESCE(SUM(approved_amount), 0) AS s FROM special_budget_approvals
      WHERE type = 'normal' AND status = 'approved' AND applied_at >= ? AND applied_at < ?${ex}`, p1);
  const dayStart = `${dateStr} 00:00:00`;
  const dayEnd = `${T.nextDate(dateStr)} 00:00:00`;
  const p2 = [dayStart, dayEnd].concat(excludeId ? [excludeId] : []);
  const sat = await qone(conn,
    `SELECT COALESCE(SUM(approved_amount), 0) AS s FROM special_budget_approvals
      WHERE type = 'additional' AND status = 'approved' AND applied_at >= ? AND applied_at < ?${ex}`, p2);
  // 同月退款恢复当月 800；跨月/跨年退款不恢复原月、不结转（§3.6）。
  const sameMonthRefund = await qone(conn,
    `SELECT COALESCE(SUM(e.amount), 0) AS s
       FROM special_budget_events e
       JOIN special_budget_schedules sc ON sc.id = e.schedule_id
       JOIN special_budget_approvals a ON a.id = e.approval_id
      WHERE e.event_type = 'refund' AND a.type = 'normal' AND a.status = 'approved'
        AND a.applied_at >= ? AND a.applied_at < ?
        AND e.at >= ? AND e.at < ?`,
    [b.start, b.end, b.start, b.end]);
  return {
    monthlyApproved: R.round2(Math.max(0, Number(normal.s) - Number(sameMonthRefund.s))),
    saturdayApproved: R.round2(sat.s),
  };
}

async function approvalRow(conn, id, username) {
  return qone(conn,
    `SELECT * FROM special_budget_approvals WHERE id = ?${username ? ' AND username = ?' : ''}`,
    username ? [id, username] : [id]);
}

async function lockApproval(conn, id, username) {
  const rows = await qall(conn,
    'SELECT * FROM special_budget_approvals WHERE id = ? AND username = ? FOR UPDATE',
    [id, username]);
  return rows[0] || null;
}

async function schedulesOf(conn, approvalId) {
  return qall(conn,
    'SELECT * FROM special_budget_schedules WHERE approval_id = ? ORDER BY seq', [approvalId]);
}

async function linksOf(conn, approvalId) {
  return qall(conn,
    'SELECT * FROM special_budget_links WHERE approval_id = ? ORDER BY id', [approvalId]);
}

function newApprovalNo(bj) {
  const rand = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `SB${bj.year}${pad(bj.month)}${pad(bj.day)}-${rand}`.slice(0, 32);
}

function planSummary(plan) {
  return {
    total: plan.total,
    installments: plan.installments_count,
    first: plan.first,
    last: plan.last,
    monthly_base: plan.monthly_base,
    monthly_last: plan.monthly_last,
    segments: plan.segments,
    cross_year_allowed: plan.cross_year_allowed,
    note: plan.note,
  };
}

function normalizeInstallments(v, type) {
  const n = v === undefined || v === null ? 1 : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > SCH.MAX_INSTALLMENTS) {
    throw new BizError('INVALID_INSTALLMENTS', `分期期数需为 1~${SCH.MAX_INSTALLMENTS} 的整数`, 400);
  }
  if (type !== 'large' && n !== 1) {
    throw new BizError('INVALID_INSTALLMENTS', '仅大额采购可以分期', 400);
  }
  return n;
}

function assertAmount(v, field) {
  const n = num(v);
  if (!Number.isFinite(n) || n <= 0) throw new BizError('INVALID_AMOUNT', `${field}必须大于 0`, 400);
  if (n > R.MAX_AMOUNT) throw new BizError('AMOUNT_TOO_LARGE', `${field}不能超过 ${R.MAX_AMOUNT}`, 400);
  if (!R.hasAtMost2Decimals(n)) throw new BizError('INVALID_AMOUNT', `${field}最多两位小数`, 400);
  return R.round2(n);
}

// ---------------- 提交 ----------------
async function submit(opts) {
  const o = opts || {};
  const username = requireUsername(o.username);
  const now = o.now instanceof Date ? o.now : new Date();
  const bj = R.beijingParts(now);
  const type = String(o.type || '');
  if (!TYPES.includes(type)) throw new BizError('INVALID_TYPE', '申请类型只能是 normal / additional / large', 400);
  const amount = assertAmount(o.amount, '申请金额');
  const purpose = requireText(o.purpose, 'purpose', 500);
  const installments = normalizeInstallments(o.installments, type);
  const note = o.note == null ? null : String(o.note).slice(0, 2000);

  const requestHash = idem.hash({ type, amount, purpose, installments, note });

  return idem.run({ username, scope: 'approval.submit', key: o.idemKey, requestHash }, async conn => {
    const cfgRow = await latestConfigRow(conn, bj.year);
    if (!cfgRow) throw new BizError('CONFIG_MISSING', `${bj.year} 年未配置特殊预算`, 400);
    const config = R.configView(cfgRow);
    const committed = await committedForYear(conn, bj.year);
    const agg = await monthAgg(conn, bj.year, bj.month, T.bjDate(now), null);

    let calc;
    const v = R.validateApplication({
      type, amount, at: now, config,
      monthlyApproved: agg.monthlyApproved,
      annualCommitted: committed,
      saturdayApprovedToday: agg.saturdayApproved,
    });
    if (!v.ok) ruleFail(v);
    if (type === 'large') {
      const plan = SCH.buildInstallmentSchedule({
        total: amount, installments,
        firstYear: bj.year, firstMonth: bj.month,
        crossYearAllowed: config.cross_year_allowed === 1,
      });
      if (!plan.ok) ruleFail(plan);
      const years = plan.segments.map(s => s.year);
      const configs = await configsForYears(conn, years);
      const yearlyCommitted = {};
      for (const y of years) yearlyCommitted[y] = await committedForYear(conn, y);
      const annual = R.checkAnnualAvailability({ segments: plan.segments, yearlyCommitted, configs });
      if (!annual.ok) ruleFail(annual);
      calc = Object.assign({}, v.calculation, { schedule: planSummary(plan), annual_years: annual.years });
    } else {
      calc = v.calculation;
    }

    const approvalNo = newApprovalNo(bj);
    const expiresAt = T.monthEndDateTime(bj.year, bj.month);
    const [ins] = await conn.query(
      `INSERT INTO special_budget_approvals
         (approval_no, username, type, purpose, requested_amount, status, rule_version,
          applied_at, expires_at, installments, first_year, first_month, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [approvalNo, username, type, purpose, amount, 'pending', config.rule_version,
        T.bjDateTime(now), expiresAt, installments, bj.year, bj.month, note]);
    const id = Number(ins.insertId);
    const row = await approvalRow(conn, id);
    await audit.appendEvent(conn, {
      approvalId: id, eventType: 'submit', amount, actor: username, at: now, ip: o.ip,
      reason: null, before: null,
      after: { approval: approvalView(row), calculation: calc },
      ruleVersion: config.rule_version,
    });
    return {
      status: 201,
      body: { ok: true, approval: approvalView(row), calculation: calc },
      resourceId: id,
    };
  });
}

// ---------------- 过期处理 ----------------
// 申请只在申请当月有效；审批前若已过期，先落 expire 事件再拒绝，避免 pending 永久悬挂。
async function expireIfDue(opts) {
  const o = opts || {};
  const id = requireId(o.id);
  const username = requireUsername(o.username);
  const now = o.now instanceof Date ? o.now : new Date();
  return require('./tx').withTransaction(async conn => {
    const appr = await lockApproval(conn, id, username);
    if (!appr || appr.status !== 'pending' || !appr.expires_at) return false;
    if (now.getTime() <= new Date(appr.expires_at).getTime()) return false;
    await conn.query("UPDATE special_budget_approvals SET status = 'expired' WHERE id = ?", [id]);
    await audit.appendEvent(conn, {
      approvalId: id, eventType: 'expire',
      amount: Number(appr.approved_amount == null ? appr.requested_amount : appr.approved_amount),
      actor: 'system:expire', at: now, ip: o.ip, reason: '申请当月未审批，自动过期',
      before: approvalView(appr), after: { status: 'expired' }, ruleVersion: appr.rule_version,
    });
    return true;
  });
}

// ---------------- 批准 ----------------
async function approve(opts) {
  const o = opts || {};
  const username = requireUsername(o.username);
  const id = requireId(o.id);
  const now = o.now instanceof Date ? o.now : new Date();
  const secondConfirm = o.secondConfirm === true;
  const reason = o.reason == null || String(o.reason).trim() === '' ? null : String(o.reason).trim().slice(0, 500);
  const installmentsInput = o.installments === undefined ? null : o.installments;

  await expireIfDue({ id, username, now, ip: o.ip });

  const requestHash = idem.hash({
    id,
    approvedAmount: o.approvedAmount === undefined ? null : num(o.approvedAmount),
    installments: installmentsInput,
    secondConfirm, reason,
  });

  return idem.run({ username, scope: 'approval.approve', key: o.idemKey, requestHash }, async conn => {
    const appr = await lockApproval(conn, id, username);
    if (!appr) throw new BizError('APPROVAL_NOT_FOUND', '审批单不存在', 404);
    if (appr.status === 'expired') throw new BizError('APPROVAL_EXPIRED', '审批单已过期', 409);
    if (appr.status !== 'pending') throw new BizError('NOT_PENDING', `审批单状态为 ${appr.status}，不能批准`, 409);

    const bj = R.beijingParts(appr.applied_at);
    if (!bj) throw new BizError('INVALID_APPLIED_AT', '审批单申请时间异常', 500);

    const reviewedAmount = o.approvedAmount === undefined || o.approvedAmount === null
      ? R.round2(appr.requested_amount)
      : assertAmount(o.approvedAmount, '批准金额');
    const requested = R.round2(appr.requested_amount);
    if (reviewedAmount > requested + 0.005) {
      throw new BizError('APPROVAL_AMOUNT_EXCEEDED', `批准金额不能超过申请金额 ${requested}`, 400);
    }
    const type = appr.type;
    const installments = installmentsInput === null
      ? normalizeInstallments(appr.installments, type)
      : normalizeInstallments(installmentsInput, type);

    // 锁申请年度配置行（所有审批先锁本年度行，按年升序；与配置修改互斥）
    await lockYear(conn, bj.year);
    const cfgRow = await latestConfigRow(conn, bj.year);
    if (!cfgRow) throw new BizError('CONFIG_MISSING', `${bj.year} 年未配置特殊预算`, 400);
    const config = R.configView(cfgRow);

    if (type === 'large' && !secondConfirm) {
      throw new BizError('SECOND_CONFIRM_REQUIRED', '大额采购需要同一账号二次确认', 428);
    }

    let plan = null;
    let years = [bj.year];
    if (type === 'large') {
      plan = SCH.buildInstallmentSchedule({
        total: reviewedAmount, installments,
        firstYear: bj.year, firstMonth: bj.month,
        crossYearAllowed: config.cross_year_allowed === 1,
      });
      if (!plan.ok) ruleFail(plan);
      years = plan.segments.map(s => s.year);
      for (const y of years) {
        if (y !== bj.year) await lockYear(conn, y);
      }
    }

    const committed = await committedForYear(conn, bj.year);
    const agg = await monthAgg(conn, bj.year, bj.month, T.bjDate(appr.applied_at), id);
    let calc;
    const v = R.validateApplication({
      type, amount: reviewedAmount, at: appr.applied_at, config,
      monthlyApproved: agg.monthlyApproved,
      annualCommitted: committed,
      saturdayApprovedToday: agg.saturdayApproved,
    });
    if (!v.ok) ruleFail(v);

    if (type === 'large') {
      const configs = await configsForYears(conn, years);
      const yearlyCommitted = {};
      for (const y of years) yearlyCommitted[y] = await committedForYear(conn, y);
      const annual = R.checkAnnualAvailability({ segments: plan.segments, yearlyCommitted, configs });
      if (!annual.ok) ruleFail(annual);
      calc = Object.assign({}, v.calculation, { schedule: planSummary(plan), annual_years: annual.years });
    } else {
      calc = v.calculation;
    }

    await conn.query(
      `UPDATE special_budget_approvals
          SET approved_amount = ?, status = 'approved', approved_at = ?,
              rule_version = ?, installments = ?, first_year = ?, first_month = ?,
              second_confirmed_by = ?, second_confirmed_at = ?
        WHERE id = ?`,
      [reviewedAmount, T.bjDateTime(now), config.rule_version, installments, bj.year, bj.month,
        type === 'large' ? username : null, type === 'large' ? T.bjDateTime(now) : null, id]);

    if (plan) {
      for (const e of plan.entries) {
        await conn.query(
          `INSERT INTO special_budget_schedules
             (approval_id, seq, due_date, year, month, amount, status)
           VALUES (?,?,?,?,?,?, 'planned')`,
          [id, e.seq, e.due_date, e.year, e.month, e.amount]);
      }
    } else {
      await conn.query(
        `INSERT INTO special_budget_schedules
           (approval_id, seq, due_date, year, month, amount, status)
         VALUES (?, 1, ?, ?, ?, ?, 'planned')`,
        [id, T.monthEndDate(bj.year, bj.month), bj.year, bj.month, reviewedAmount]);
    }

    const updated = await approvalRow(conn, id);
    const schedules = await schedulesOf(conn, id);
    await audit.appendEvent(conn, {
      approvalId: id, eventType: 'approve', amount: reviewedAmount, actor: username, at: now, ip: o.ip,
      reason, before: approvalView(appr),
      after: {
        approval: approvalView(updated),
        schedules: schedules.map(scheduleView),
        calculation: calc,
      },
      ruleVersion: config.rule_version,
    });
    return {
      status: 200,
      body: {
        ok: true,
        approval: approvalView(updated),
        schedules: schedules.map(scheduleView),
        calculation: calc,
        second_confirmed: type === 'large',
      },
      resourceId: id,
    };
  });
}

// ---------------- 驳回 / 取消 ----------------
async function reject(opts) {
  const o = opts || {};
  const username = requireUsername(o.username);
  const id = requireId(o.id);
  const now = o.now instanceof Date ? o.now : new Date();
  const reason = requireText(o.reason, 'reason', 500);
  const requestHash = idem.hash({ id, reason });
  return idem.run({ username, scope: 'approval.reject', key: o.idemKey, requestHash }, async conn => {
    const appr = await lockApproval(conn, id, username);
    if (!appr) throw new BizError('APPROVAL_NOT_FOUND', '审批单不存在', 404);
    if (appr.status !== 'pending') throw new BizError('NOT_PENDING', `审批单状态为 ${appr.status}，不能驳回`, 409);
    await conn.query("UPDATE special_budget_approvals SET status = 'rejected' WHERE id = ?", [id]);
    const updated = await approvalRow(conn, id);
    await audit.appendEvent(conn, {
      approvalId: id, eventType: 'reject', amount: Number(appr.requested_amount),
      actor: username, at: now, ip: o.ip, reason,
      before: approvalView(appr), after: approvalView(updated), ruleVersion: appr.rule_version,
    });
    return { status: 200, body: { ok: true, approval: approvalView(updated) }, resourceId: id };
  });
}

async function cancel(opts) {
  const o = opts || {};
  const username = requireUsername(o.username);
  const id = requireId(o.id);
  const now = o.now instanceof Date ? o.now : new Date();
  const reason = o.reason == null || String(o.reason).trim() === '' ? '申请人取消' : String(o.reason).trim().slice(0, 500);
  const requestHash = idem.hash({ id, reason });
  return idem.run({ username, scope: 'approval.cancel', key: o.idemKey, requestHash }, async conn => {
    const appr = await lockApproval(conn, id, username);
    if (!appr) throw new BizError('APPROVAL_NOT_FOUND', '审批单不存在', 404);
    if (appr.status !== 'pending') throw new BizError('NOT_PENDING', `审批单状态为 ${appr.status}，不能取消`, 409);
    await conn.query("UPDATE special_budget_approvals SET status = 'cancelled' WHERE id = ?", [id]);
    const updated = await approvalRow(conn, id);
    await audit.appendEvent(conn, {
      approvalId: id, eventType: 'cancel', amount: Number(appr.requested_amount),
      actor: username, at: now, ip: o.ip, reason,
      before: approvalView(appr), after: approvalView(updated), ruleVersion: appr.rule_version,
    });
    return { status: 200, body: { ok: true, approval: approvalView(updated) }, resourceId: id };
  });
}

// ---------------- 关联采购单 ----------------
async function linkOrder(opts) {
  const o = opts || {};
  const username = requireUsername(o.username);
  const id = requireId(o.id);
  const orderId = requireId(o.orderId);
  const now = o.now instanceof Date ? o.now : new Date();
  const amountInput = o.amount === undefined || o.amount === null ? null : num(o.amount);
  const requestHash = idem.hash({ id, orderId, amount: amountInput });

  return idem.run({ username, scope: 'approval.link', key: o.idemKey, requestHash }, async conn => {
    const appr = await lockApproval(conn, id, username);
    if (!appr) throw new BizError('APPROVAL_NOT_FOUND', '审批单不存在', 404);
    if (appr.status !== 'approved') {
      throw new BizError('APPROVAL_NOT_APPROVED', `审批单状态为 ${appr.status}，不能关联采购单`, 409);
    }
    if (appr.expires_at && now.getTime() > new Date(appr.expires_at).getTime()) {
      throw new BizError('APPROVAL_EXPIRED', '审批单已过期', 409);
    }

    const user = await qone(conn, 'SELECT id FROM users WHERE username = ?', [username]);
    if (!user) throw new BizError('USER_NOT_FOUND', '用户不存在', 404);

    const orders = await qall(conn,
      'SELECT * FROM purchase_orders WHERE id = ? AND user_id = ? FOR UPDATE', [orderId, user.id]);
    const order = orders[0];
    if (!order) throw new BizError('ORDER_NOT_FOUND', '采购单不存在', 404);
    if (['已归档', '已取消', '已退'].includes(order.status)) {
      throw new BizError('ORDER_NOT_LINKABLE', `采购单状态为 ${order.status}，不能关联`, 409);
    }
    if (order.budget_type !== 'general' || order.special_approval_id != null) {
      throw new BizError('ORDER_ALREADY_SPECIAL', '采购单已属于特殊预算', 409);
    }
    const active = await qone(conn,
      "SELECT id, approval_id FROM special_budget_links WHERE order_id = ? AND status = 'active' LIMIT 1",
      [orderId]);
    if (active) throw new BizError('ORDER_ALREADY_LINKED', '采购单已被特殊预算审批占用', 409);

    const orderTotal = R.round2((Number(order.price_paid) || 0) * (Number(order.qty) || 1));
    if (orderTotal <= 0) throw new BizError('ORDER_AMOUNT_INVALID', '采购单金额必须大于 0', 400);
    const linkedAmount = amountInput === null ? orderTotal : R.round2(amountInput);
    if (!Number.isFinite(linkedAmount) || linkedAmount <= 0) {
      throw new BizError('INVALID_AMOUNT', '关联金额必须大于 0', 400);
    }
    if (Math.abs(linkedAmount - orderTotal) > 0.005) {
      throw new BizError('LINK_AMOUNT_MISMATCH', `关联金额必须等于采购单总额 ${orderTotal}`, 400);
    }

    const sum = await qone(conn,
      "SELECT COALESCE(SUM(linked_amount), 0) AS s FROM special_budget_links WHERE approval_id = ? AND status = 'active'",
      [id]);
    const approved = R.round2(appr.approved_amount);
    const used = R.round2(sum.s);
    const remaining = R.round2(Math.max(0, approved - used));
    if (linkedAmount > remaining + 0.005) {
      throw new BizError('LINK_EXCEEDS_APPROVED', `超出批准金额：剩余可关联 ${remaining}`, 409, {
        approved_amount: approved, linked: used, remaining, order_total: orderTotal,
      });
    }

    await conn.query(
      `INSERT INTO special_budget_links
         (approval_id, order_id, link_type, linked_amount, status, linked_at)
       VALUES (?,?,?,?, 'active', ?)`,
      [id, orderId, 'order', linkedAmount, T.bjDateTime(now)]);
    await conn.query(
      "UPDATE purchase_orders SET budget_type = 'special', special_approval_id = ? WHERE id = ?",
      [id, orderId]);
    const newOrder = await qone(conn, 'SELECT * FROM purchase_orders WHERE id = ?', [orderId]);
    const link = await qone(conn,
      'SELECT * FROM special_budget_links WHERE approval_id = ? AND order_id = ?', [id, orderId]);
    await audit.appendEvent(conn, {
      approvalId: id, orderId, eventType: 'link', amount: linkedAmount, actor: username, at: now, ip: o.ip,
      reason: null,
      before: { order: { id: orderId, budget_type: order.budget_type, special_approval_id: order.special_approval_id } },
      after: {
        link: linkView(link),
        order: { id: orderId, budget_type: newOrder.budget_type, special_approval_id: Number(newOrder.special_approval_id) },
        remaining_after: R.round2(remaining - linkedAmount),
      },
      ruleVersion: appr.rule_version,
    });
    return {
      status: 200,
      body: {
        ok: true,
        approval: approvalView(appr),
        link: linkView(link),
        approved_amount: approved,
        linked_total: R.round2(used + linkedAmount),
        remaining: R.round2(remaining - linkedAmount),
      },
      resourceId: id,
    };
  });
}

// ---------------- 查询 ----------------
async function getApproval(username, id) {
  const u = requireUsername(username);
  const n = requireId(id);
  const appr = await db.one('SELECT * FROM special_budget_approvals WHERE id = ? AND username = ?', [n, u]);
  if (!appr) throw new BizError('APPROVAL_NOT_FOUND', '审批单不存在', 404);
  const schedules = await db.query('SELECT * FROM special_budget_schedules WHERE approval_id = ? ORDER BY seq', [n]);
  const links = await db.query('SELECT * FROM special_budget_links WHERE approval_id = ? ORDER BY id', [n]);
  const evs = await db.query(
    "SELECT after_json FROM special_budget_events WHERE approval_id = ? AND event_type IN ('approve','submit') ORDER BY id DESC",
    [n]);
  let calculation = null;
  for (const e of evs) {
    let after = e.after_json;
    if (typeof after === 'string') { try { after = JSON.parse(after); } catch (err) { after = null; } }
    if (after && after.calculation) { calculation = after.calculation; break; }
  }
  return {
    ok: true,
    approval: approvalView(appr),
    schedules: schedules.map(scheduleView),
    links: links.map(linkView),
    calculation,
  };
}

async function listApprovals(username, opts) {
  const u = requireUsername(username);
  const o = opts || {};
  const nowBj = R.beijingParts(new Date());
  const year = o.year === undefined || o.year === null || o.year === ''
    ? nowBj.year : Number(o.year);
  if (!Number.isInteger(year) || year < 2026 || year > 2100) {
    throw new BizError('INVALID_YEAR', 'year 需为 2026..2100 的整数', 400);
  }
  let month = null;
  if (o.month !== undefined && o.month !== null && o.month !== '') {
    month = Number(o.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BizError('INVALID_MONTH', 'month 需为 1..12 的整数', 400);
    }
  }
  let status = null;
  if (o.status !== undefined && o.status !== null && o.status !== '') {
    status = String(o.status);
    if (!STATUSES.includes(status)) throw new BizError('INVALID_STATUS', 'status 无效', 400);
  }
  const params = [u];
  let where = 'username = ?';
  if (month) {
    const b = T.monthBounds(year, month);
    where += ' AND applied_at >= ? AND applied_at < ?';
    params.push(b.start, b.end);
  } else {
    where += ' AND applied_at >= ? AND applied_at < ?';
    params.push(`${year}-01-01 00:00:00`, `${year + 1}-01-01 00:00:00`);
  }
  if (status) { where += ' AND status = ?'; params.push(status); }
  const rows = await db.query(
    `SELECT * FROM special_budget_approvals WHERE ${where} ORDER BY applied_at DESC, id DESC LIMIT 200`,
    params);
  return { ok: true, year, month, status, approvals: rows.map(approvalView) };
}

async function getAudit(username, id) {
  const u = requireUsername(username);
  const n = requireId(id);
  const appr = await db.one('SELECT * FROM special_budget_approvals WHERE id = ? AND username = ?', [n, u]);
  if (!appr) throw new BizError('APPROVAL_NOT_FOUND', '审批单不存在', 404);
  const events = await audit.listEvents(n);
  return { ok: true, approval: approvalView(appr), events };
}

module.exports = {
  TYPES,
  STATUSES,
  approvalView,
  scheduleView,
  linkView,
  latestConfigRow,
  committedForYear,
  submit,
  approve,
  reject,
  cancel,
  linkOrder,
  expireIfDue,
  getApproval,
  listApprovals,
  getAudit,
};
