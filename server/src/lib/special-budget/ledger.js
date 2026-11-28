'use strict';
// 特殊预算 v3.2.4：台账 / 月度快照 / 审计时间线 / 对账口径 / CSV 导出
// 只读优先：台账、时间线、导出均为 GET；唯一写入是「生成月度快照」这一派生动作。
// 金额口径与 summary.js 保持一致：年度占用 = 计划总额 - 已释放 - 已退款。
const crypto = require('crypto');
const db = require('../../db');
const R = require('./rules');
const T = require('./time');
const S = require('./summary');
const F = require('./funds');
const A = require('./approvals');
const audit = require('./audit');
const idem = require('./idempotency');
const { BizError } = require('./errors');

const EVENT_LABEL = {
  submit: '提交申请',
  approve: '批准',
  reject: '驳回',
  cancel: '取消',
  expire: '过期',
  link: '关联采购单',
  pay: '付款',
  refund: '退款',
  release: '释放分期',
  reschedule: '改期',
  config_update: '修改年度上限',
  snapshot: '生成月度快照',
  order_update: '采购单更新',
  overdue: '逾期',
};

const TYPE_LABEL = { normal: '普通申请', additional: '周六追加', large: '大额采购' };
const STATUS_LABEL = {
  pending: '待审批', approved: '已批准', rejected: '已驳回',
  cancelled: '已取消', expired: '已过期', closed: '已关闭',
};

function pad2(n) { return String(n).padStart(2, '0'); }
function qall(conn, sql, params) { return conn.query(sql, params).then(r => r[0]); }
function qone(conn, sql, params) { return conn.query(sql, params).then(r => (r[0] && r[0][0]) || null); }
function n(v) { return R.round2(Number(v) || 0); }
function canonical(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonical);
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (v[k] !== undefined) out[k] = canonical(v[k]);
  }
  return out;
}
function hashOf(v) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
}

function validateYear(v) {
  const y = Number(v);
  if (!Number.isInteger(y) || y < 2026 || y > 2100) {
    throw new BizError('INVALID_YEAR', 'year 需为 2026..2100 的整数', 400);
  }
  return y;
}
function validateMonth(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  const m = Number(v);
  if (!Number.isInteger(m) || m < 1 || m > 12) {
    throw new BizError('INVALID_MONTH', 'month 需为 1..12 的整数', 400);
  }
  return m;
}
async function scopeOf(username) {
  const u = String(username == null ? '' : username).trim();
  if (!u) throw new BizError('INVALID_USER', '用户无效', 400);
  if (u === 'admin') return { scope: 'global', username: u };
  const row = await db.one('SELECT is_admin FROM users WHERE username = ?', [u]);
  return { scope: row && Number(row.is_admin) ? 'global' : 'self', username: u };
}

// ---------------- 台账 ----------------
function monthlyEmpty() {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    out.push({
      month: m, applied_count: 0, applied_amount: 0, approved_count: 0, approved_amount: 0,
      paid_count: 0, paid_amount: 0, refund_count: 0, refunded_amount: 0,
      release_count: 0, released_amount: 0, net_cash: 0,
    });
  }
  return out;
}

function approvalTraceView(r) {
  return {
    id: Number(r.id),
    approval_no: r.approval_no,
    username: r.username,
    type: r.type,
    type_label: TYPE_LABEL[r.type] || r.type,
    status: r.status,
    status_label: STATUS_LABEL[r.status] || r.status,
    purpose: r.purpose,
    requested_amount: n(r.requested_amount),
    approved_amount: r.approved_amount == null ? null : n(r.approved_amount),
    applied_at: T.bjDateTime(r.applied_at, true),
    approved_at: T.bjDateTime(r.approved_at, true),
    schedule_total: n(r.schedule_total),
    paid_amount: n(r.paid_amount),
    refunded_amount: n(r.refunded_amount),
    released_amount: n(r.released_amount),
    planned_amount: n(r.planned_amount),
    event_count: Number(r.event_count) || 0,
  };
}

function formulaList(summary, monthlyNet, paid, refunded) {
  return [
    {
      key: 'annual_committed',
      label: '年度已占用',
      formula: '计划总额 − 已释放 − 已退款',
      values: {
        schedule_total: n(summary.schedule_total),
        annual_released: n(summary.annual_released),
        annual_refunded: n(summary.annual_refunded),
      },
      result: n(summary.annual_committed),
    },
    {
      key: 'annual_remaining',
      label: '年度剩余',
      formula: '年度上限 − 年度已占用',
      values: { annual_cap: n(summary.annual_cap), annual_committed: n(summary.annual_committed) },
      result: n(summary.annual_remaining),
    },
    {
      key: 'monthly_net_cash',
      label: '月度特殊净现金流',
      formula: '当月付款 − 当月退款',
      values: { paid_amount: n(paid), refunded_amount: n(refunded) },
      result: n(monthlyNet),
    },
    {
      key: 'monthly_regular_available',
      label: '本月常规可用',
      formula: 'max(0, 月度常规上限 − 本月普通申请已批)',
      values: {
        monthly_regular_cap: n(summary.monthly_regular_cap),
        monthly_regular_approved: n(summary.monthly_regular_approved),
      },
      result: n(summary.monthly_regular_available),
    },
  ];
}

async function getLedger(username, opts) {
  const o = opts || {};
  const year = validateYear(o.year);
  const nowBj = R.beijingParts(new Date());
  const month = validateMonth(o.month, nowBj.year === year ? nowBj.month : 1);
  const { scope } = await scopeOf(username);
  const self = scope === 'self';
  const user = String(username);
  const yearStart = `${year}-01-01 00:00:00`;
  const yearEnd = `${year + 1}-01-01 00:00:00`;
  const condA = self ? ' AND a.username = ?' : '';
  const pA = self ? [user] : [];

  const summaryOut = await S.getSummary(year, month);
  if (!summaryOut.ok) throw new BizError(summaryOut.code || 'CONFIG_MISSING', summaryOut.message, 404);

  const [appliedRows, approvedRows, payRows, refundRows, releaseRows, traceRows, scheduleYearRows, eventCountRows] = await Promise.all([
    db.query(
      `SELECT MONTH(a.applied_at) AS m, COUNT(*) AS c, COALESCE(SUM(a.requested_amount),0) AS amount
         FROM special_budget_approvals a
        WHERE a.applied_at >= ? AND a.applied_at < ?${condA}
        GROUP BY MONTH(a.applied_at)`, [yearStart, yearEnd].concat(pA)),
    db.query(
      `SELECT MONTH(a.approved_at) AS m, COUNT(*) AS c, COALESCE(SUM(a.approved_amount),0) AS amount
         FROM special_budget_approvals a
        WHERE a.status = 'approved' AND a.approved_at >= ? AND a.approved_at < ?${condA}
        GROUP BY MONTH(a.approved_at)`, [yearStart, yearEnd].concat(pA)),
    db.query(
      `SELECT MONTH(e.at) AS m, COUNT(*) AS c, COALESCE(SUM(e.amount),0) AS amount
         FROM special_budget_events e
         LEFT JOIN special_budget_approvals a ON a.id = e.approval_id
        WHERE e.event_type = 'pay' AND e.at >= ? AND e.at < ?
          ${self ? 'AND (a.username = ? OR (e.approval_id IS NULL AND e.actor = ?))' : ''}
        GROUP BY MONTH(e.at)`,
      [yearStart, yearEnd].concat(self ? [user, user] : [])),
    db.query(
      `SELECT MONTH(e.at) AS m, COUNT(*) AS c, COALESCE(SUM(e.amount),0) AS amount
         FROM special_budget_events e
         LEFT JOIN special_budget_approvals a ON a.id = e.approval_id
        WHERE e.event_type = 'refund' AND e.at >= ? AND e.at < ?
          ${self ? 'AND (a.username = ? OR (e.approval_id IS NULL AND e.actor = ?))' : ''}
        GROUP BY MONTH(e.at)`,
      [yearStart, yearEnd].concat(self ? [user, user] : [])),
    db.query(
      `SELECT MONTH(e.at) AS m, COUNT(*) AS c, COALESCE(SUM(e.amount),0) AS amount
         FROM special_budget_events e
         LEFT JOIN special_budget_approvals a ON a.id = e.approval_id
        WHERE e.event_type = 'release' AND e.at >= ? AND e.at < ?
          ${self ? 'AND (a.username = ? OR (e.approval_id IS NULL AND e.actor = ?))' : ''}
        GROUP BY MONTH(e.at)`,
      [yearStart, yearEnd].concat(self ? [user, user] : [])),
    db.query(
      `SELECT a.*,
              COALESCE(sc.total,0) AS schedule_total,
              COALESCE(sc.paid_amount,0) AS paid_amount,
              COALESCE(sc.refunded_amount,0) AS refunded_amount,
              COALESCE(sc.released_amount,0) AS released_amount,
              COALESCE(sc.planned_amount,0) AS planned_amount,
              COALESCE(ev.c,0) AS event_count
         FROM special_budget_approvals a
         LEFT JOIN (
           SELECT approval_id,
                  SUM(amount) AS total,
                  SUM(CASE WHEN paid_at IS NOT NULL THEN amount ELSE 0 END) AS paid_amount,
                  SUM(refund_amount) AS refunded_amount,
                  SUM(CASE WHEN status = 'released' THEN amount ELSE 0 END) AS released_amount,
                  SUM(CASE WHEN status IN ('planned','overdue') THEN amount ELSE 0 END) AS planned_amount
             FROM special_budget_schedules GROUP BY approval_id
         ) sc ON sc.approval_id = a.id
         LEFT JOIN (
           SELECT approval_id, COUNT(*) AS c FROM special_budget_events
            WHERE approval_id IS NOT NULL GROUP BY approval_id
         ) ev ON ev.approval_id = a.id
        WHERE a.applied_at >= ? AND a.applied_at < ?${condA}
        ORDER BY a.applied_at ASC, a.id ASC`, [yearStart, yearEnd].concat(pA)),
    db.query(
      `SELECT s.year,
              COUNT(*) AS c,
              COALESCE(SUM(s.amount),0) AS total,
              COALESCE(SUM(CASE WHEN s.paid_at IS NOT NULL THEN s.amount ELSE 0 END),0) AS paid_amount,
              COALESCE(SUM(s.refund_amount),0) AS refunded_amount,
              COALESCE(SUM(CASE WHEN s.status = 'released' THEN s.amount ELSE 0 END),0) AS released_amount,
              COALESCE(SUM(CASE WHEN s.status IN ('planned','overdue') THEN s.amount ELSE 0 END),0) AS planned_amount
         FROM special_budget_schedules s
         JOIN special_budget_approvals a ON a.id = s.approval_id
        WHERE ${self ? 'a.username = ?' : '1=1'}
        GROUP BY s.year ORDER BY s.year`, self ? [user] : []),
    db.query(
      `SELECT COUNT(*) AS c
         FROM special_budget_events e
         LEFT JOIN special_budget_approvals a ON a.id = e.approval_id
        WHERE e.at >= ? AND e.at < ?
          ${self ? 'AND (a.username = ? OR (e.approval_id IS NULL AND e.actor = ?))' : ''}`,
      [yearStart, yearEnd].concat(self ? [user, user] : [])),
  ]);

  const monthly = monthlyEmpty();
  function applyMap(rows, countKey, amountKey) {
    for (const r of rows) {
      const m = Number(r.m);
      if (!(m >= 1 && m <= 12)) continue;
      monthly[m - 1][countKey] += Number(r.c) || 0;
      monthly[m - 1][amountKey] = n(monthly[m - 1][amountKey] + n(r.amount));
    }
  }
  applyMap(appliedRows, 'applied_count', 'applied_amount');
  applyMap(approvedRows, 'approved_count', 'approved_amount');
  applyMap(payRows, 'paid_count', 'paid_amount');
  applyMap(refundRows, 'refund_count', 'refunded_amount');
  applyMap(releaseRows, 'release_count', 'released_amount');
  for (const row of monthly) row.net_cash = n(row.paid_amount - row.refunded_amount);

  const scheduleYears = scheduleYearRows.map(r => {
    const total = n(r.total), released = n(r.released_amount), refunded = n(r.refunded_amount);
    return {
      year: Number(r.year), count: Number(r.c), schedule_total: total,
      paid_amount: n(r.paid_amount), refunded_amount: refunded,
      released_amount: released, planned_amount: n(r.planned_amount),
      committed: n(Math.max(0, total - released - refunded)),
    };
  });
  const curYearRow = scheduleYears.find(r => r.year === year);
  const scheduleTotal = curYearRow ? curYearRow.schedule_total : 0;
  const schedulePaid = curYearRow ? curYearRow.paid_amount : 0;
  const scheduleRefunded = curYearRow ? curYearRow.refunded_amount : 0;
  const scheduleReleased = curYearRow ? curYearRow.released_amount : 0;
  const scheduleCommitted = n(Math.max(0, scheduleTotal - scheduleReleased - scheduleRefunded));

  const selected = monthly[month - 1];
  const approvals = traceRows.map(approvalTraceView);
  const annual = {
    annual_cap: n(summaryOut.summary.annual_cap),
    schedule_total: scheduleTotal,
    annual_paid: schedulePaid,
    annual_refunded: scheduleRefunded,
    annual_released: scheduleReleased,
    annual_committed: scheduleCommitted,
    annual_remaining: n(summaryOut.summary.annual_cap - scheduleCommitted),
  };
  const summaryForFormula = Object.assign({}, summaryOut.summary, {
    schedule_total: scheduleTotal,
    annual_paid: schedulePaid,
    annual_refunded: scheduleRefunded,
    annual_released: scheduleReleased,
    annual_committed: scheduleCommitted,
    annual_remaining: annual.annual_remaining,
  });
  const formulas = formulaList(summaryForFormula, selected.net_cash, selected.paid_amount, selected.refunded_amount);
  const fingerprint = hashOf({ year, month, scope, annual, monthly, approvals: approvals.map(a => ({
    id: a.id, status: a.status, approved_amount: a.approved_amount,
    paid_amount: a.paid_amount, refunded_amount: a.refunded_amount, released_amount: a.released_amount,
  })) });

  let reconciliation = null;
  try {
    const rec = await F.reconcile({ year, month });
    reconciliation = {
      difference: rec.difference, reconciled: rec.reconciled,
      checks: rec.checks, cash_flow: rec.cash_flow,
    };
  } catch (e) { /* 台账仍可用；对账错误在页面上单列 */ }

  return {
    ok: true,
    year, month,
    as_of: R.fmtBeijing(R.beijingParts(new Date())),
    scope,
    readonly: true,
    permissions: { read: true, write: false, scope },
    config: summaryOut.config,
    summary: summaryOut.summary,
    annual,
    monthly,
    schedule_years: scheduleYears,
    future_commitments: (summaryOut.summary.future_commitments || []),
    approvals,
    event_count: Number(eventCountRows[0] && eventCountRows[0].c) || 0,
    formulas,
    reconciliation,
    fingerprint,
    calculation: {
      rule_version: summaryOut.config.rule_version,
      scope,
      note: '台账金额按事件时间归月；年度金额按分期所属年归集。',
    },
  };
}

// ---------------- 审计时间线 ----------------
function eventLabel(t) { return EVENT_LABEL[t] || t; }
function eventSummary(r) {
  const amount = r.amount == null ? '' : ` ${R.round2(r.amount).toFixed(2)} 元`;
  const label = eventLabel(r.event_type);
  if (r.event_type === 'config_update') return `${label}${amount}`;
  if (r.event_type === 'approve') return `${label}${amount}`;
  if (r.event_type === 'refund') return `${label}${amount}${r.reason ? '（' + r.reason + '）' : ''}`;
  return label + amount;
}

function timelineView(r) {
  const v = audit.eventView(r);
  return Object.assign(v, {
    event_label: eventLabel(r.event_type),
    summary_text: eventSummary(r),
    approval_no: r.approval_no || null,
    purpose: r.purpose || null,
    approval_type: r.approval_type || null,
    month: r.at ? Number(T.bjDateTime(r.at, true).slice(5, 7)) : null,
  });
}

async function getTimeline(username, opts) {
  const o = opts || {};
  const year = validateYear(o.year);
  const nowBj = R.beijingParts(new Date());
  const month = validateMonth(o.month, null);
  const { scope } = await scopeOf(username);
  const self = scope === 'self';
  const user = String(username);
  const yearStart = `${year}-01-01 00:00:00`, yearEnd = `${year + 1}-01-01 00:00:00`;
  let timeCond = 'e.at >= ? AND e.at < ?';
  let params = [yearStart, yearEnd];
  if (month) {
    const b = T.monthBounds(year, month);
    timeCond = 'e.at >= ? AND e.at < ?';
    params = [b.start, b.end];
  }
  let where = `(${timeCond} OR (e.event_type = 'config_update' AND e.rule_version LIKE ?))`;
  params.push(`${year}-%`);
  if (o.approvalId !== undefined && o.approvalId !== null && o.approvalId !== '') {
    const m = /^(?:rec_)?(\d+)$/.exec(String(o.approvalId));
    if (!m) throw new BizError('INVALID_ID', 'approvalId 格式无效', 400);
    where += ' AND e.approval_id = ?';
    params.push(Number(m[1]));
  }
  if (self) {
    where += ' AND (a.username = ? OR (e.approval_id IS NULL AND e.actor = ?))';
    params.push(user, user);
  }
  const limit = Math.max(1, Math.min(1000, Number(o.limit) || 100));
  const offset = Math.max(0, Math.min(100000, Number(o.offset) || 0));

  const join = `FROM special_budget_events e
    LEFT JOIN special_budget_approvals a ON a.id = e.approval_id`;
  const [countRow, rows] = await Promise.all([
    db.one(`SELECT COUNT(*) AS c ${join} WHERE ${where}`, params),
    db.query(
      `SELECT e.*, a.approval_no, a.purpose, a.type AS approval_type ${join}
        WHERE ${where} ORDER BY e.at DESC, e.id DESC LIMIT ? OFFSET ?`,
      params.concat([limit, offset])),
  ]);
  const total = Number(countRow && countRow.c) || 0;
  const config = await S.getConfig(year);
  const configHistory = config ? await require('./config-service').getHistory(year) : [];
  return {
    ok: true, year, month: month || null,
    as_of: R.fmtBeijing(R.beijingParts(new Date())),
    scope, readonly: true,
    permissions: { read: true, write: false, scope },
    events: rows.map(timelineView),
    total,
    limit,
    offset,
    has_more: offset + rows.length < total,
    config_history: configHistory,
    config_history_readonly: true,
  };
}

// ---------------- 月度快照 ----------------
function futureList(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  return [];
}

function snapshotCanonical(row) {
  return {
    year: Number(row.year), month: Number(row.month),
    annual_cap: n(row.annual_cap),
    annual_committed: n(row.annual_committed),
    annual_paid: n(row.annual_paid),
    annual_refunded: n(row.annual_refunded),
    annual_released: n(row.annual_released),
    annual_remaining: n(row.annual_remaining),
    monthly_regular_cap: n(row.monthly_regular_cap),
    monthly_regular_approved: n(row.monthly_regular_approved),
    monthly_installment_due: n(row.monthly_installment_due),
    monthly_cash: n(row.monthly_cash),
    future_commitments: futureList(row.future_commitments_json),
  };
}
function snapshotView(r) {
  const base = snapshotCanonical(r);
  return Object.assign(base, {
    generated_at: T.bjDateTime(r.generated_at, true),
    fingerprint: hashOf(base),
  });
}

async function generateSnapshot(opts) {
  const o = opts || {};
  const username = String(o.username == null ? '' : o.username).trim();
  if (!username) throw new BizError('INVALID_USER', '用户无效', 400);
  const now = o.now instanceof Date ? o.now : new Date();
  const nowBj = R.beijingParts(now);
  const year = validateYear(o.year);
  const month = validateMonth(o.month, nowBj.month);
  if (year > nowBj.year || (year === nowBj.year && month > nowBj.month)) {
    throw new BizError('FUTURE_PERIOD', '不能为未来月份生成快照', 400);
  }
  const requestHash = idem.hash({ year, month });
  return idem.run({ username, scope: 'snapshot.generate', key: o.idemKey, requestHash }, async conn => {
    const out = await S.getSummary(year, month);
    if (!out.ok) throw new BizError(out.code || 'CONFIG_MISSING', out.message, 404);
    const s = out.summary;
    const generatedAt = T.bjDateTime(now, true);
    await conn.query(
      `INSERT INTO special_budget_snapshots
         (year, month, annual_cap, annual_committed, annual_paid, annual_refunded, annual_released,
          annual_remaining, monthly_regular_cap, monthly_regular_approved, monthly_installment_due,
          monthly_cash, future_commitments_json, generated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         annual_cap=VALUES(annual_cap), annual_committed=VALUES(annual_committed),
         annual_paid=VALUES(annual_paid), annual_refunded=VALUES(annual_refunded),
         annual_released=VALUES(annual_released), annual_remaining=VALUES(annual_remaining),
         monthly_regular_cap=VALUES(monthly_regular_cap),
         monthly_regular_approved=VALUES(monthly_regular_approved),
         monthly_installment_due=VALUES(monthly_installment_due), monthly_cash=VALUES(monthly_cash),
         future_commitments_json=VALUES(future_commitments_json), generated_at=VALUES(generated_at)`,
      [year, month, n(s.annual_cap), n(s.annual_committed), n(s.annual_paid), n(s.annual_refunded),
        n(s.annual_released), n(s.annual_remaining), n(s.monthly_regular_cap),
        n(s.monthly_regular_approved), n(s.monthly_installment_due), n(s.monthly_cash),
        JSON.stringify(s.future_commitments || []), generatedAt]);
    const row = await qone(conn,
      'SELECT * FROM special_budget_snapshots WHERE year = ? AND month = ?', [year, month]);
    const view = snapshotView(row);
    await audit.appendEvent(conn, {
      approvalId: null, eventType: 'snapshot', amount: null,
      actor: username, at: now, ip: o.ip, reason: `${year}-${pad2(month)} 月度快照`,
      before: null, after: { year, month, fingerprint: view.fingerprint, generated_at: view.generated_at },
      ruleVersion: out.config.rule_version,
    });
    return { status: 200, body: { ok: true, snapshot: view }, resourceId: null };
  });
}

async function listSnapshots(username, opts) {
  const o = opts || {};
  const year = validateYear(o.year);
  const nowBj = R.beijingParts(new Date());
  const config = await S.getConfig(year);
  if (!config) throw new BizError('CONFIG_MISSING', `${year} 年未配置特殊预算`, 404);
  let startMonth = 1;
  if (year === 2026 && config.effective_from) startMonth = Math.max(1, Number(String(config.effective_from).slice(5, 7)) || 1);
  let endMonth = 12;
  if (year > nowBj.year) endMonth = 0;
  else if (year === nowBj.year) endMonth = nowBj.month;
  const expected = [];
  for (let m = startMonth; m <= endMonth; m++) expected.push(m);
  const rows = await db.query(
    'SELECT * FROM special_budget_snapshots WHERE year = ? ORDER BY month', [year]);
  const have = new Set(rows.map(r => Number(r.month)));
  const { scope } = await scopeOf(username);
  return {
    ok: true, year, scope, readonly: true,
    permissions: { read: true, write: false, scope },
    snapshots: rows.map(snapshotView),
    expected_months: expected,
    missing_months: expected.filter(m => !have.has(m)),
    config_history: await require('./config-service').getHistory(year),
  };
}

// ---------------- CSV ----------------
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  // 防 CSV 公式注入：用户可控文本以 = + - @ 开头时加前导单引号
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvLine(cells) { return cells.map(csvCell).join(','); }

function ledgerCsv(ledger) {
  const lines = [];
  lines.push(csvLine(['特殊预算台账', `${ledger.year} 年`, `口径 ${ledger.scope === 'global' ? '全局' : '本人'}`, `截止 ${ledger.as_of}`]));
  lines.push(csvLine(['审计指纹', ledger.fingerprint]));
  lines.push('');
  lines.push(csvLine(['月度台账']));
  lines.push(csvLine(['月份', '申请笔数', '申请金额', '批准笔数', '批准金额', '付款笔数', '付款金额', '退款笔数', '退款金额', '释放笔数', '释放金额', '净现金流']));
  for (const r of ledger.monthly) {
    lines.push(csvLine([`${ledger.year}-${pad2(r.month)}`, r.applied_count, r.applied_amount.toFixed(2),
      r.approved_count, r.approved_amount.toFixed(2), r.paid_count, r.paid_amount.toFixed(2),
      r.refund_count, r.refunded_amount.toFixed(2), r.release_count, r.released_amount.toFixed(2),
      r.net_cash.toFixed(2)]));
  }
  lines.push('');
  lines.push(csvLine(['年度分段', '期数', '计划总额', '已付', '已退', '已释放', '已占用', '待付']));
  for (const r of ledger.schedule_years) {
    lines.push(csvLine([r.year, r.count, r.schedule_total.toFixed(2), r.paid_amount.toFixed(2),
      r.refunded_amount.toFixed(2), r.released_amount.toFixed(2), r.committed.toFixed(2), r.planned_amount.toFixed(2)]));
  }
  lines.push('');
  lines.push(csvLine(['审批明细', '编号', '类型', '状态', '用途', '申请金额', '批准金额', '已付', '已退', '已释放', '事件数']));
  for (const a of ledger.approvals) {
    lines.push(csvLine([a.id, a.approval_no, a.type_label, a.status_label, a.purpose,
      a.requested_amount.toFixed(2), a.approved_amount == null ? '' : a.approved_amount.toFixed(2),
      a.paid_amount.toFixed(2), a.refunded_amount.toFixed(2), a.released_amount.toFixed(2), a.event_count]));
  }
  lines.push('');
  lines.push(csvLine(['计算过程', '口径', '公式', '结果']));
  for (const f of ledger.formulas) lines.push(csvLine([f.key, f.label, f.formula, f.result.toFixed(2)]));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function timelineCsv(timeline) {
  const lines = [];
  lines.push(csvLine(['特殊预算审计时间线', `${timeline.year} 年`, `口径 ${timeline.scope === 'global' ? '全局' : '本人'}`, `截止 ${timeline.as_of}`]));
  lines.push('');
  lines.push(csvLine(['时间', '事件', '审批单', '用途', '金额', '操作人', '原因', '规则版本', 'IP', '变更前', '变更后']));
  for (const e of timeline.events) {
    lines.push(csvLine([e.at, e.event_label, e.approval_no || '', e.purpose || '',
      e.amount == null ? '' : e.amount.toFixed(2), e.actor, e.reason || '', e.rule_version || '', e.ip || '',
      e.before == null ? '' : JSON.stringify(e.before).slice(0, 2000),
      e.after == null ? '' : JSON.stringify(e.after).slice(0, 2000)]));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = {
  EVENT_LABEL,
  getLedger,
  getTimeline,
  generateSnapshot,
  listSnapshots,
  snapshotView,
  ledgerCsv,
  timelineCsv,
  csvCell,
  hashOf,
};
