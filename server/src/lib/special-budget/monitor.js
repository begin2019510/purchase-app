'use strict';
// 特殊预算 v3.2.5：试运行监控（只读）
// 目标：在 2026-12 试运行期间，每天用同一套口径回答四个问题：
//   1) 有没有超年度 / 超月度 800 / 超周六 10%？
//   2) 台账对账是否为 0？
//   3) 每一笔记账动作是否有审计事件，采购单与关联是否一致？
//   4) 该有的月度快照是否齐全？
// 本模块只做 SELECT；唯一入口 getMonitor 会先校验管理员身份。
const db = require('../../db');
const R = require('./rules');
const T = require('./time');
const { BizError } = require('./errors');

const CHECK_LABEL = {
  config_effective: '配置已生效',
  annual_cap: '年度上限未超',
  monthly_cap: '月度常规 800 未超',
  saturday_cap: '周六 10% 未超',
  additional_window: '周六追加均在周六申请',
  reconciliation: '台账对账差异为 0',
  audit_pay: '付款有审计且金额一致',
  audit_refund: '退款有审计且金额一致',
  audit_release: '释放有审计且金额一致',
  audit_approve: '批准有审计事件',
  audit_link: '关联有审计事件',
  link_amount: '关联金额 = 采购单金额',
  order_consistency: '特殊采购单关联一致',
  config_audit: '配置修改有审计',
  event_orphans: '业务事件均挂审批单',
  snapshot_coverage: '月度快照齐全',
  overdue: '无逾期未处理分期',
  stale_pending: '无超过 48h 的待审批',
  unlinked_approved: '已批准单已及时关联',
};

function pad2(v) { return String(v).padStart(2, '0'); }
function n(v) { return R.round2(Number(v) || 0); }
function qall(conn, sql, params) { return conn.query(sql, params).then(r => r[0]); }
function qone(conn, sql, params) { return conn.query(sql, params).then(r => (r[0] && r[0][0]) || null); }

function validatePeriod(opts) {
  const o = opts || {};
  const now = o.now instanceof Date ? o.now : new Date();
  const bj = R.beijingParts(now);
  const year = o.year === undefined || o.year === null || o.year === '' ? bj.year : Number(o.year);
  const month = o.month === undefined || o.month === null || o.month === '' ? bj.month : Number(o.month);
  if (!Number.isInteger(year) || year < 2026 || year > 2100) {
    throw new BizError('INVALID_YEAR', 'year 需为 2026..2100 的整数', 400);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new BizError('INVALID_MONTH', 'month 需为 1..12 的整数', 400);
  }
  return { year, month, now, bj };
}

async function isGlobal(username) {
  const u = String(username == null ? '' : username).trim();
  if (!u) throw new BizError('INVALID_USER', '用户无效', 400);
  if (u === 'admin') return true;
  const row = await db.one('SELECT is_admin FROM users WHERE username = ?', [u]);
  return !!(row && Number(row.is_admin));
}

function mk(key, status, expected, actual, difference, detail) {
  return {
    key,
    label: CHECK_LABEL[key] || key,
    status,
    expected: expected === undefined ? null : expected,
    actual: actual === undefined ? null : actual,
    difference: difference === undefined ? null : n(difference),
    detail: detail || null,
  };
}

function expectedSnapshotMonths(config, year, nowBj) {
  let start = 1;
  const from = config && config.effective_from ? String(config.effective_from) : '';
  if (from.slice(0, 4) === String(year)) start = Math.max(1, Number(from.slice(5, 7)) || 1);
  let end = 12;
  if (year > nowBj.year) end = 0;
  else if (year === nowBj.year) end = nowBj.month;
  const out = [];
  for (let m = start; m <= end; m++) out.push(m);
  return out;
}

async function collect(conn, opts) {
  const { year, month, now, bj } = validatePeriod(opts);
  const nowText = T.bjDateTime(now);
  const today = T.bjDate(now);
  const yearBounds = T.monthBounds(year, 1);
  const yearStart = yearBounds.start;
  const yearEnd = T.monthBounds(year, 12).end;
  const monthBounds = T.monthBounds(year, month);
  const staleBefore = T.bjDateTime(new Date(now.getTime() - 48 * 3600 * 1000));
  const unlinkedBefore = T.bjDateTime(new Date(now.getTime() - 24 * 3600 * 1000));

  const configRow = await qone(conn,
    'SELECT * FROM special_budget_rules WHERE year = ? ORDER BY effective_from DESC, id DESC LIMIT 1',
    [year]);
  const config = configRow ? R.configView(configRow) : null;
  if (!config) throw new BizError('CONFIG_MISSING', `${year} 年未配置特殊预算`, 404);

  const [
    scheduleAgg, eventAgg, approvalAgg, sameMonthRefundAgg,
    monthCash, futureRows, dueAgg, overdueAgg, stalePending, unlinkedApproved,
    saturdayRows, nonSaturdayAdditional,
    paidAudit, refundAudit, releaseAudit, approveAudit, linkAudit,
    linkAmountMismatch, orphanSpecialOrders, linkNotSpecial, configAuditGap, eventOrphans,
    snapshotRows, orderCounts, eventTotal,
  ] = await Promise.all([
    qone(conn,
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(amount), 0) AS total,
              COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN amount ELSE 0 END), 0) AS paid,
              COALESCE(SUM(refund_amount), 0) AS refunded,
              COALESCE(SUM(CASE WHEN status = 'released' THEN amount ELSE 0 END), 0) AS released
         FROM special_budget_schedules WHERE year = ?`, [year]),
    qall(conn,
      `SELECT e.event_type, COALESCE(SUM(e.amount), 0) AS amount, COUNT(*) AS count
         FROM special_budget_events e
         JOIN special_budget_schedules sc ON sc.id = e.schedule_id
        WHERE sc.year = ? AND e.event_type IN ('pay','refund','release')
        GROUP BY e.event_type`, [year]),
    qall(conn,
      `SELECT type, status, MONTH(applied_at) AS m,
              COALESCE(SUM(approved_amount), 0) AS amount, COUNT(*) AS count
         FROM special_budget_approvals
        WHERE applied_at >= ? AND applied_at < ?
        GROUP BY type, status, MONTH(applied_at)`, [yearStart, yearEnd]),
    qall(conn,
      `SELECT MONTH(a.applied_at) AS m, COALESCE(SUM(e.amount), 0) AS amount
         FROM special_budget_events e
         JOIN special_budget_schedules sc ON sc.id = e.schedule_id
         JOIN special_budget_approvals a ON a.id = e.approval_id
        WHERE e.event_type = 'refund' AND a.type = 'normal' AND a.status = 'approved'
          AND a.applied_at >= ? AND a.applied_at < ?
          AND YEAR(e.at) = YEAR(a.applied_at) AND MONTH(e.at) = MONTH(a.applied_at)
        GROUP BY MONTH(a.applied_at)`, [yearStart, yearEnd]),
    qone(conn,
      `SELECT
         COALESCE((SELECT SUM(amount) FROM special_budget_schedules
                    WHERE paid_at >= ? AND paid_at < ?), 0) AS paid,
         COALESCE((SELECT SUM(amount) FROM special_budget_events
                    WHERE event_type = 'refund' AND at >= ? AND at < ?), 0) AS refunded`,
      [monthBounds.start, monthBounds.end, monthBounds.start, monthBounds.end]),
    qall(conn,
      `SELECT year, COALESCE(SUM(amount), 0) AS amount
         FROM special_budget_schedules
        WHERE year > ? AND status IN ('planned','overdue')
        GROUP BY year ORDER BY year`, [year]),
    qone(conn,
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
         FROM special_budget_schedules
        WHERE year = ? AND month = ? AND status IN ('planned','overdue')`, [year, month]),
    qone(conn,
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
         FROM special_budget_schedules
        WHERE year = ? AND status IN ('planned','overdue') AND due_date < ?`, [year, today]),
    qone(conn,
      `SELECT COUNT(*) AS count FROM special_budget_approvals
        WHERE status = 'pending' AND applied_at >= ? AND applied_at < ? AND applied_at < ?`,
      [yearStart, yearEnd, staleBefore]),
    qone(conn,
      `SELECT COUNT(*) AS count
         FROM special_budget_approvals a
         LEFT JOIN special_budget_links l ON l.approval_id = a.id AND l.status = 'active'
        WHERE a.status = 'approved' AND a.applied_at >= ? AND a.applied_at < ?
          AND a.approved_at IS NOT NULL AND a.approved_at < ? AND l.id IS NULL`,
      [yearStart, yearEnd, unlinkedBefore]),
    qall(conn,
      `SELECT DATE(applied_at) AS day, COALESCE(SUM(approved_amount), 0) AS amount, COUNT(*) AS count
         FROM special_budget_approvals
        WHERE type = 'additional' AND status = 'approved'
          AND applied_at >= ? AND applied_at < ?
        GROUP BY DATE(applied_at)
        ORDER BY amount DESC, day ASC`, [yearStart, yearEnd]),
    qone(conn,
      `SELECT COUNT(*) AS count FROM special_budget_approvals
        WHERE type = 'additional' AND status = 'approved'
          AND applied_at >= ? AND applied_at < ? AND DAYOFWEEK(applied_at) <> 7`,
      [yearStart, yearEnd]),
    qone(conn,
      `SELECT COUNT(*) AS count, COALESCE(SUM(sc.amount), 0) AS amount
         FROM special_budget_schedules sc
         LEFT JOIN (SELECT schedule_id, COUNT(*) AS c, SUM(amount) AS amount
                      FROM special_budget_events WHERE event_type = 'pay'
                     GROUP BY schedule_id) e ON e.schedule_id = sc.id
        WHERE sc.year = ? AND sc.paid_at IS NOT NULL
          AND (e.schedule_id IS NULL OR ABS(COALESCE(e.amount, 0) - sc.amount) > 0.005)`, [year]),
    qone(conn,
      `SELECT COUNT(*) AS count, COALESCE(SUM(sc.refund_amount), 0) AS amount
         FROM special_budget_schedules sc
         LEFT JOIN (SELECT schedule_id, COUNT(*) AS c, SUM(amount) AS amount
                      FROM special_budget_events WHERE event_type = 'refund'
                     GROUP BY schedule_id) e ON e.schedule_id = sc.id
        WHERE sc.year = ? AND sc.refund_amount > 0
          AND (e.schedule_id IS NULL OR ABS(COALESCE(e.amount, 0) - sc.refund_amount) > 0.005)`, [year]),
    qone(conn,
      `SELECT COUNT(*) AS count, COALESCE(SUM(sc.amount), 0) AS amount
         FROM special_budget_schedules sc
         LEFT JOIN (SELECT schedule_id, COUNT(*) AS c, SUM(amount) AS amount
                      FROM special_budget_events WHERE event_type = 'release'
                     GROUP BY schedule_id) e ON e.schedule_id = sc.id
        WHERE sc.year = ? AND sc.status = 'released'
          AND (e.schedule_id IS NULL OR ABS(COALESCE(e.amount, 0) - sc.amount) > 0.005)`, [year]),
    qone(conn,
      `SELECT COUNT(*) AS count
         FROM special_budget_approvals a
         LEFT JOIN (SELECT DISTINCT approval_id FROM special_budget_events
                     WHERE event_type = 'approve') e ON e.approval_id = a.id
        WHERE a.status = 'approved' AND a.applied_at >= ? AND a.applied_at < ?
          AND e.approval_id IS NULL`, [yearStart, yearEnd]),
    qone(conn,
      `SELECT COUNT(*) AS count
         FROM special_budget_links l
         LEFT JOIN (SELECT DISTINCT approval_id, order_id FROM special_budget_events
                     WHERE event_type = 'link') e
           ON e.approval_id = l.approval_id AND e.order_id = l.order_id
        WHERE l.status = 'active' AND l.linked_at >= ? AND l.linked_at < ?
          AND e.approval_id IS NULL`, [yearStart, yearEnd]),
    qone(conn,
      `SELECT COUNT(*) AS count
         FROM special_budget_links l
         JOIN purchase_orders o ON o.id = l.order_id
        WHERE l.status = 'active'
          AND ABS(l.linked_amount - (COALESCE(o.price_paid, 0) * COALESCE(o.qty, 0))) > 0.005`),
    qone(conn,
      `SELECT COUNT(*) AS count
         FROM purchase_orders o
         LEFT JOIN special_budget_approvals a ON a.id = o.special_approval_id
        WHERE o.budget_type = 'special' AND a.id IS NULL`),
    qone(conn,
      `SELECT COUNT(*) AS count
         FROM special_budget_links l
         JOIN purchase_orders o ON o.id = l.order_id
        WHERE l.status = 'active'
          AND (o.budget_type IS NULL OR o.budget_type <> 'special'
               OR o.special_approval_id IS NULL OR o.special_approval_id <> l.approval_id)`),
    qone(conn,
      `SELECT COUNT(*) AS count
         FROM special_budget_rules r
         LEFT JOIN special_budget_events e
           ON e.event_type = 'config_update' AND e.rule_version = r.rule_version
        WHERE r.year = ? AND r.changed_by <> 'system:seed' AND e.id IS NULL`, [year]),
    qone(conn,
      `SELECT COUNT(*) AS count FROM special_budget_events
        WHERE approval_id IS NULL AND event_type NOT IN ('snapshot','config_update')`),
    qall(conn, 'SELECT month FROM special_budget_snapshots WHERE year = ? ORDER BY month', [year]),
    qone(conn,
      `SELECT
         SUM(CASE WHEN budget_type = 'special' THEN 1 ELSE 0 END) AS special_count,
         COALESCE(SUM(CASE WHEN budget_type = 'special' THEN price_paid * qty ELSE 0 END), 0) AS special_amount,
         SUM(CASE WHEN budget_type <> 'special' OR budget_type IS NULL THEN 1 ELSE 0 END) AS general_count,
         COALESCE(SUM(CASE WHEN budget_type <> 'special' OR budget_type IS NULL THEN price_paid * qty ELSE 0 END), 0) AS general_amount
         FROM purchase_orders
        WHERE status IN ('已下单','已到','已归档')
          AND date_ms >= ? AND date_ms < ?`,
      [Date.parse(monthBounds.start.replace(' ', 'T') + '+08:00'), Date.parse(monthBounds.end.replace(' ', 'T') + '+08:00')]),
    qone(conn,
      'SELECT COUNT(*) AS count FROM special_budget_events WHERE at >= ? AND at < ?',
      [yearStart, yearEnd]),
  ]);

  const cap = n(config.annual_cap);
  const total = n(scheduleAgg.total);
  const paid = n(scheduleAgg.paid);
  const refunded = n(scheduleAgg.refunded);
  const released = n(scheduleAgg.released);
  const committed = n(Math.max(0, total - released - refunded));
  const remaining = n(cap - committed);
  const saturdayCap = n(cap * Number(config.saturday_rate));

  const eventByType = {};
  for (const e of eventAgg) eventByType[e.event_type] = e;
  const payEvents = n(eventByType.pay && eventByType.pay.amount);
  const refundEvents = n(eventByType.refund && eventByType.refund.amount);
  const releaseEvents = n(eventByType.release && eventByType.release.amount);
  const recChecks = [
    { name: 'pay_events_vs_schedules', expected: paid, actual: payEvents, difference: n(Math.abs(paid - payEvents)) },
    { name: 'refund_events_vs_schedules', expected: refunded, actual: refundEvents, difference: n(Math.abs(refunded - refundEvents)) },
    { name: 'release_events_vs_schedules', expected: released, actual: releaseEvents, difference: n(Math.abs(released - releaseEvents)) },
  ];
  const recDifference = n(recChecks.reduce((m, c) => Math.max(m, c.difference), 0));

  // 月度 800：普通申请按批准金额占用，同月退款恢复；跨月退款不恢复（与 summary.js 同口径）。
  const regularApproved = {};
  const additionalApproved = {};
  const refundSameMonth = {};
  let approvalCount = 0;
  let pendingCount = 0;
  let approvedCount = 0;
  for (const a of approvalAgg) {
    approvalCount += Number(a.count) || 0;
    if (a.status === 'pending') pendingCount += Number(a.count) || 0;
    if (a.status === 'approved') approvedCount += Number(a.count) || 0;
    if (a.status !== 'approved') continue;
    if (a.type === 'normal') {
      regularApproved[a.m] = n((regularApproved[a.m] || 0) + (Number(a.amount) || 0));
    } else if (a.type === 'additional') {
      additionalApproved[a.m] = n((additionalApproved[a.m] || 0) + (Number(a.amount) || 0));
    }
  }
  for (const r of sameMonthRefundAgg) refundSameMonth[r.m] = n(r.amount);

  const monthlyCap = n(config.monthly_regular_cap);
  let worstMonth = { month: 0, amount: 0, over: 0 };
  const monthlyDetail = [];
  for (let m = 1; m <= 12; m++) {
    const net = n(Math.max(0, (regularApproved[m] || 0) - (refundSameMonth[m] || 0)));
    const over = n(Math.max(0, net - monthlyCap));
    monthlyDetail.push({ month: m, approved: regularApproved[m] || 0, refunded: refundSameMonth[m] || 0, net, over });
    if (over > worstMonth.over + 0.0001) worstMonth = { month: m, amount: net, over };
  }

  const saturdayWorst = saturdayRows.length
    ? { day: saturdayRows[0].day, amount: n(saturdayRows[0].amount), over: n(Math.max(0, n(saturdayRows[0].amount) - saturdayCap)) }
    : { day: null, amount: 0, over: 0 };

  const effectiveFrom = config.effective_from ? String(config.effective_from) : null;
  const effectiveOk = !effectiveFrom || effectiveFrom <= nowText;

  const expectedMonths = expectedSnapshotMonths(config, year, bj);
  const haveMonths = new Set(snapshotRows.map(r => Number(r.month)));
  const missingMonths = expectedMonths.filter(m => !haveMonths.has(m));

  const orderConsistencyCount = Number(orphanSpecialOrders.count || 0) + Number(linkNotSpecial.count || 0);

  const checks = [
    mk('config_effective', effectiveOk ? 'pass' : 'warn',
      effectiveFrom || '立即生效', nowText, null,
      effectiveOk ? null : { effective_from: effectiveFrom, note: '尚未到配置生效时间，试运行前属正常' }),
    mk('annual_cap', committed <= cap + 0.005 ? 'pass' : 'fail',
      cap, committed, Math.max(0, n(committed - cap)),
      { remaining }),
    mk('monthly_cap', worstMonth.over > 0.005 ? 'fail' : 'pass',
      monthlyCap, worstMonth.amount, worstMonth.over,
      { month: worstMonth.month || null, monthly: monthlyDetail }),
    mk('saturday_cap', saturdayWorst.over > 0.005 ? 'fail' : 'pass',
      saturdayCap, saturdayWorst.amount, saturdayWorst.over,
      { worst_day: saturdayWorst.day }),
    mk('additional_window', Number(nonSaturdayAdditional.count || 0) === 0 ? 'pass' : 'fail',
      0, Number(nonSaturdayAdditional.count || 0), Number(nonSaturdayAdditional.count || 0), null),
    mk('reconciliation', recDifference < 0.005 ? 'pass' : 'fail',
      0, recDifference, recDifference, { checks: recChecks }),
    mk('audit_pay', Number(paidAudit.count || 0) === 0 ? 'pass' : 'fail',
      0, Number(paidAudit.count || 0), Number(paidAudit.count || 0), { affected_amount: n(paidAudit.amount) }),
    mk('audit_refund', Number(refundAudit.count || 0) === 0 ? 'pass' : 'fail',
      0, Number(refundAudit.count || 0), Number(refundAudit.count || 0), { affected_amount: n(refundAudit.amount) }),
    mk('audit_release', Number(releaseAudit.count || 0) === 0 ? 'pass' : 'fail',
      0, Number(releaseAudit.count || 0), Number(releaseAudit.count || 0), { affected_amount: n(releaseAudit.amount) }),
    mk('audit_approve', Number(approveAudit.count || 0) === 0 ? 'pass' : 'fail',
      0, Number(approveAudit.count || 0), Number(approveAudit.count || 0), null),
    mk('audit_link', Number(linkAudit.count || 0) === 0 ? 'pass' : 'fail',
      0, Number(linkAudit.count || 0), Number(linkAudit.count || 0), null),
    mk('link_amount', Number(linkAmountMismatch.count || 0) === 0 ? 'pass' : 'fail',
      0, Number(linkAmountMismatch.count || 0), Number(linkAmountMismatch.count || 0), null),
    mk('order_consistency', orderConsistencyCount === 0 ? 'pass' : 'fail',
      0, orderConsistencyCount, orderConsistencyCount,
      { orphan_special_orders: Number(orphanSpecialOrders.count || 0), link_not_special: Number(linkNotSpecial.count || 0) }),
    mk('config_audit', Number(configAuditGap.count || 0) === 0 ? 'pass' : 'fail',
      0, Number(configAuditGap.count || 0), Number(configAuditGap.count || 0), null),
    mk('event_orphans', Number(eventOrphans.count || 0) === 0 ? 'pass' : 'fail',
      0, Number(eventOrphans.count || 0), Number(eventOrphans.count || 0), null),
    mk('snapshot_coverage', missingMonths.length === 0 ? 'pass' : 'warn',
      expectedMonths.length, haveMonths.size, missingMonths.length, { missing_months: missingMonths }),
    mk('overdue', Number(overdueAgg.count || 0) === 0 ? 'pass' : 'warn',
      0, Number(overdueAgg.count || 0), n(overdueAgg.amount), null),
    mk('stale_pending', Number(stalePending.count || 0) === 0 ? 'pass' : 'warn',
      0, Number(stalePending.count || 0), Number(stalePending.count || 0), null),
    mk('unlinked_approved', Number(unlinkedApproved.count || 0) === 0 ? 'pass' : 'warn',
      0, Number(unlinkedApproved.count || 0), Number(unlinkedApproved.count || 0), null),
  ];

  const verdict = checks.some(c => c.status === 'fail') ? 'FAIL'
    : (checks.some(c => c.status === 'warn') ? 'WARN' : 'PASS');

  return {
    ok: true,
    as_of: R.fmtBeijing(bj),
    year,
    month,
    scope: 'global',
    readonly: true,
    verdict,
    config,
    summary: {
      annual_cap: cap,
      annual_committed: committed,
      annual_paid: paid,
      annual_refunded: refunded,
      annual_released: released,
      annual_remaining: remaining,
      monthly_regular_cap: monthlyCap,
      monthly_regular_approved: n(regularApproved[month] || 0),
      monthly_regular_available: n(Math.max(0, monthlyCap - ((regularApproved[month] || 0) - (refundSameMonth[month] || 0)))),
      monthly_additional_approved: n(additionalApproved[month] || 0),
      monthly_installment_due: n(dueAgg.amount),
      monthly_cash: n(monthCash.paid) - n(monthCash.refunded),
      future_commitments: futureRows.map(r => ({ year: Number(r.year), amount: n(r.amount) })),
    },
    counts: {
      approvals: approvalCount,
      pending: pendingCount,
      approved: approvedCount,
      schedules: Number(scheduleAgg.count || 0),
      events: Number(eventTotal.count || 0),
      due_month_count: Number(dueAgg.count || 0),
      due_month_amount: n(dueAgg.amount),
      overdue_count: Number(overdueAgg.count || 0),
      overdue_amount: n(overdueAgg.amount),
      stale_pending: Number(stalePending.count || 0),
      unlinked_approved: Number(unlinkedApproved.count || 0),
      missing_snapshots: missingMonths.length,
      special_orders_month: Number(orderCounts.special_count || 0),
      special_amount_month: n(orderCounts.special_amount),
      general_orders_month: Number(orderCounts.general_count || 0),
      general_amount_month: n(orderCounts.general_amount),
    },
    checks,
    reconciliation: { difference: recDifference, reconciled: recDifference < 0.005, checks: recChecks },
    snapshots: {
      expected_months: expectedMonths,
      present_months: Array.from(haveMonths).sort((a, b) => a - b),
      missing_months: missingMonths,
    },
    future_commitments: futureRows.map(r => ({ year: Number(r.year), amount: n(r.amount) })),
    generated_at: nowText,
  };
}

async function getMonitor(username, opts) {
  if (!(await isGlobal(username))) {
    throw new BizError('FORBIDDEN', '仅管理员可查看试运行监控', 403);
  }
  const conn = await db.pool.getConnection();
  try {
    return await collect(conn, opts);
  } finally {
    conn.release();
  }
}

module.exports = { getMonitor, collect, validatePeriod, expectedSnapshotMonths, CHECK_LABEL };
