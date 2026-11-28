'use strict';
// 特殊预算只读汇总（v3.2.0）
// 只读；不创建、不修改任何审批/付款/退款数据。
// 口径：年度上限是全局额度（special_budget_rules 无 user_id），
// 因此汇总按全局口径统计；v3.2.1 的审批校验也必须用同一口径，避免多账号各算各的。

const db = require('../../db');
const R = require('./rules');

function pad2(n) { return String(n).padStart(2, '0'); }

function monthBounds(year, month) {
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return {
    start: `${year}-${pad2(month)}-01 00:00:00`,
    end: `${next.y}-${pad2(next.m)}-01 00:00:00`,
  };
}

async function getConfig(year) {
  const row = await db.one(
    'SELECT * FROM special_budget_rules WHERE year = ? ORDER BY effective_from DESC, id DESC LIMIT 1',
    [year]);
  return row ? R.configView(row) : null;
}

async function getSummary(year, month) {
  const config = await getConfig(year);
  if (!config) return { ok: false, code: 'CONFIG_MISSING', message: `${year} 年未配置特殊预算` };

  const bounds = monthBounds(year, month);

  const [approvals, schedules, cashRow, refundRow, futureRows] = await Promise.all([
    db.query(
      `SELECT type, status, requested_amount, approved_amount, applied_at, approved_at
         FROM special_budget_approvals
        WHERE applied_at >= ? AND applied_at < ?`,
      [bounds.start, bounds.end]),
    db.query(
      `SELECT amount, status, paid_at, refunded_at, refund_amount
         FROM special_budget_schedules
        WHERE year = ?`,
      [year]),
    db.one(
      `SELECT COALESCE(SUM(amount), 0) AS paid
         FROM special_budget_schedules
        WHERE paid_at >= ? AND paid_at < ?`,
      [bounds.start, bounds.end]),
    // 退款按“退款事件发生时间”计当月现金流，与监控/对账口径一致。
    // 不能用 schedules.refund_amount + refunded_at：多次分月退款时 refunded_at 只保留最后一次，
    // 会把全部累计退款都算到最后一个月，原月份现金流虚高。
    db.one(
      `SELECT COALESCE(SUM(amount), 0) AS refunded
         FROM special_budget_events
        WHERE event_type = 'refund' AND at >= ? AND at < ?`,
      [bounds.start, bounds.end]),
    db.query(
      `SELECT year, COALESCE(SUM(amount), 0) AS amount
         FROM special_budget_schedules
        WHERE year > ? AND status IN ('planned', 'overdue')
        GROUP BY year ORDER BY year`,
      [year]),
  ]);

  let monthlyRegularApproved = 0;
  let monthlyAdditionalApproved = 0;
  let pendingApprovals = 0;
  let approvedApprovals = 0;
  for (const a of approvals) {
    const amount = Number(a.approved_amount) || 0;
    if (a.status === 'approved') approvedApprovals += 1;
    if (a.status === 'pending') pendingApprovals += 1;
    if (a.status !== 'approved') continue;
    if (a.type === 'normal') monthlyRegularApproved += amount;
    else if (a.type === 'additional') monthlyAdditionalApproved += amount;
  }

  // 同月退款恢复当月 800：只扣“退款事件发生在同一自然月”的普通申请退款；
  // 跨月/跨年退款不恢复原月，也不结转（§3.6）。
  const sameMonthRefund = await db.one(
    `SELECT COALESCE(SUM(e.amount), 0) AS s
       FROM special_budget_events e
       JOIN special_budget_schedules sc ON sc.id = e.schedule_id
       JOIN special_budget_approvals a ON a.id = e.approval_id
      WHERE e.event_type = 'refund' AND a.type = 'normal' AND a.status = 'approved'
        AND a.applied_at >= ? AND a.applied_at < ?
        AND e.at >= ? AND e.at < ?`,
    [bounds.start, bounds.end, bounds.start, bounds.end]);
  monthlyRegularApproved = R.round2(Math.max(0, monthlyRegularApproved - (Number(sameMonthRefund && sameMonthRefund.s) || 0)));

  // 年度口径：分期计划按“所属年”占用；已释放/已退款不再占用。
  // committed = 计划总额 - 已释放 - 已退款；已付款但未退款仍占用。
  let scheduleTotal = 0;
  let annualPaid = 0;
  let annualRefunded = 0;
  let annualReleased = 0;
  for (const s of schedules) {
    const amount = Number(s.amount) || 0;
    const refund = Number(s.refund_amount) || 0;
    scheduleTotal += amount;
    annualRefunded += refund;
    if (s.status === 'released') annualReleased += amount;
    if (s.paid_at) annualPaid += amount;
  }

  const dueRow = await db.one(
    `SELECT COALESCE(SUM(amount), 0) AS due
       FROM special_budget_schedules
      WHERE year = ? AND month = ? AND status IN ('planned', 'overdue')`,
    [year, month]);

  const annualCap = R.round2(config.annual_cap);
  const annualCommitted = R.round2(Math.max(0, scheduleTotal - annualReleased - annualRefunded));
  const annualRemaining = R.round2(annualCap - annualCommitted);
  const monthlyCap = R.round2(config.monthly_regular_cap);
  const monthlyRegularAvailable = R.round2(Math.max(0, monthlyCap - monthlyRegularApproved));
  const monthlyCash = R.round2((Number(cashRow && cashRow.paid) || 0) - (Number(refundRow && refundRow.refunded) || 0));

  return {
    ok: true,
    year,
    month,
    as_of: R.fmtBeijing(R.beijingParts(new Date())),
    config,
    summary: {
      annual_cap: annualCap,
      annual_committed: annualCommitted,
      annual_paid: R.round2(annualPaid),
      annual_refunded: R.round2(annualRefunded),
      annual_released: R.round2(annualReleased),
      annual_remaining: annualRemaining,
      monthly_regular_cap: monthlyCap,
      monthly_regular_approved: R.round2(monthlyRegularApproved),
      monthly_regular_available: monthlyRegularAvailable,
      monthly_additional_approved: R.round2(monthlyAdditionalApproved),
      monthly_installment_due: R.round2(Number(dueRow && dueRow.due) || 0),
      monthly_cash: monthlyCash,
      future_commitments: (futureRows || []).map(r => ({ year: Number(r.year), amount: R.round2(r.amount) })),
      approvals: { pending: pendingApprovals, approved: approvedApprovals },
    },
    calculation: {
      rule_version: config.rule_version,
      scope: 'global',
      annual_committed: '计划总额 - 已释放 - 已退款',
      annual_remaining: '年度上限 - 年度已占用',
      monthly_regular_available: 'max(0, 月度常规上限 - 本月普通申请已批金额)',
      note: '大额采购与周六追加不占月度常规 800；周六追加另受年度上限×10% 的单日上限约束',
    },
  };
}

module.exports = { getConfig, getSummary, monthBounds };
