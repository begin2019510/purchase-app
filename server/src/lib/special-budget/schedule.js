'use strict';
// 分期计划计算器（v3.2.0）
// 等额本金：每期金额 = round2(总额/期数)，最后一期吸收尾差，保证合计精确等于总额。
// 按“首期月份”参数化分段，不在代码里写死 7/12/5 或 8/12/4。
// 2026-12 试运行不允许跨年，且首期必须是 2026-12；2027 起按配置允许跨年。

const MAX_AMOUNT = 9999999;
const MAX_INSTALLMENTS = 120;
const EPS = 0.005;

function round2(n) {
  const v = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
}

function hasAtMost2Decimals(n) {
  return Math.abs(Number(n) * 100 - Math.round(Number(n) * 100)) < 1e-6;
}

function pad2(n) { return String(n).padStart(2, '0'); }

// 1-based 月份加法，跨年安全
function addMonths(year, month, add) {
  const idx = Number(year) * 12 + (Number(month) - 1) + Number(add);
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

function lastDayOfMonth(year, month) {
  // 下月第 0 天 = 本月最后一天
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

// 到期日暂取当月最后一天（与“月末未付款失效”口径一致）；v3.2.1 可再支持自定义扣款日。
function dueDate(year, month) {
  return `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`;
}

function fail(code, message, extra) {
  return Object.assign({ ok: false, code, message }, extra || {});
}

function buildInstallmentSchedule(opts) {
  const o = opts || {};
  const rawTotal = Number(o.total);
  const installments = Number(o.installments);
  const firstYear = Number(o.firstYear);
  const firstMonth = Number(o.firstMonth);
  const crossYearAllowed = !!o.crossYearAllowed;

  if (!Number.isFinite(rawTotal) || rawTotal <= 0) return fail('INVALID_AMOUNT', '分期总额必须大于 0');
  if (rawTotal > MAX_AMOUNT) return fail('AMOUNT_TOO_LARGE', `分期总额不能超过 ${MAX_AMOUNT}`);
  if (!hasAtMost2Decimals(rawTotal)) return fail('INVALID_AMOUNT', '分期总额最多两位小数');
  if (!Number.isInteger(installments) || installments < 1 || installments > MAX_INSTALLMENTS) {
    return fail('INVALID_INSTALLMENTS', `分期期数需为 1~${MAX_INSTALLMENTS} 的整数`);
  }
  if (!Number.isInteger(firstYear) || firstYear < 2026 || firstYear > 2100) return fail('INVALID_YEAR', '首期年份无效');
  if (!Number.isInteger(firstMonth) || firstMonth < 1 || firstMonth > 12) return fail('INVALID_MONTH', '首期月份无效');
  if (firstYear === 2026 && firstMonth !== 12) {
    return fail('2026_ONLY_DECEMBER', '2026 年仅 12 月试运行，首期必须是 2026-12');
  }
  if (firstYear === 2026 && !crossYearAllowed && installments > 1) {
    // 提前给出明确文案；下面统一的跨年判断也会拒绝
    return fail('CROSS_YEAR_NOT_ALLOWED', '2026-12 分期必须在 2026-12-31 前还完，不允许跨年分期');
  }

  const total = round2(rawTotal);
  const cents = Math.round(total * 100);
  if (cents < installments) return fail('AMOUNT_TOO_SMALL', '分期总额过小：每期不足 0.01 元');

  const base = round2(total / installments);
  if (base <= 0) return fail('AMOUNT_TOO_SMALL', '每期金额必须大于 0');
  const last = round2(total - base * (installments - 1));
  if (last < 0) return fail('INVALID_ROUNDING', '分期尾差计算异常');

  const entries = [];
  for (let i = 1; i <= installments; i++) {
    const m = addMonths(firstYear, firstMonth, i - 1);
    entries.push({
      seq: i,
      year: m.year,
      month: m.month,
      amount: i === installments ? last : base,
      due_date: dueDate(m.year, m.month),
    });
  }

  const lastEntry = entries[entries.length - 1];
  if (!crossYearAllowed && lastEntry.year !== firstYear) {
    return fail('CROSS_YEAR_NOT_ALLOWED', `${firstYear} 年配置不允许跨年分期（末期落在 ${lastEntry.year} 年）`, {
      first: { year: firstYear, month: firstMonth },
      last: { year: lastEntry.year, month: lastEntry.month },
    });
  }

  // 按年汇总：7/12/5 这类分段由首期月份自然推出，不写死。
  const byYear = new Map();
  for (const e of entries) {
    let s = byYear.get(e.year);
    if (!s) {
      s = { year: e.year, count: 0, amount: 0, first_month: e.month, last_month: e.month };
      byYear.set(e.year, s);
    }
    s.count += 1;
    s.amount = round2(s.amount + e.amount);
    s.last_month = e.month;
  }
  const segments = Array.from(byYear.values()).sort((a, b) => a.year - b.year);

  const sum = round2(entries.reduce((acc, e) => acc + e.amount, 0));
  if (Math.abs(sum - total) > EPS) {
    return fail('INVALID_ROUNDING', `分期合计 ${sum} 与总额 ${total} 不一致`);
  }

  return {
    ok: true,
    total,
    installments_count: installments,
    first: { year: firstYear, month: firstMonth },
    last: { year: lastEntry.year, month: lastEntry.month },
    cross_year_allowed: crossYearAllowed ? 1 : 0,
    monthly_base: base,
    monthly_last: last,
    segments,
    entries,
    note: '等额本金，最后一期吸收尾差；到期日暂取当月最后一天',
  };
}

// 已有分期行（DB）按年/月汇总，供台账/未来承诺使用。
function groupScheduleRows(rows) {
  const byYear = new Map();
  const byMonth = new Map();
  for (const r of rows || []) {
    const year = Number(r.year);
    const month = Number(r.month);
    const amount = round2(r.amount);
    const refund = round2(r.refund_amount || 0);
    let y = byYear.get(year);
    if (!y) { y = { year, amount: 0, count: 0, refunded: 0 }; byYear.set(year, y); }
    y.amount = round2(y.amount + amount);
    y.refunded = round2(y.refunded + refund);
    y.count += 1;
    const k = `${year}-${pad2(month)}`;
    let m = byMonth.get(k);
    if (!m) { m = { year, month, amount: 0, count: 0, refunded: 0 }; byMonth.set(k, m); }
    m.amount = round2(m.amount + amount);
    m.refunded = round2(m.refunded + refund);
    m.count += 1;
  }
  return {
    years: Array.from(byYear.values()).sort((a, b) => a.year - b.year),
    months: Array.from(byMonth.values()).sort((a, b) => a.year - b.year || a.month - b.month),
  };
}

module.exports = {
  MAX_AMOUNT,
  MAX_INSTALLMENTS,
  round2,
  addMonths,
  lastDayOfMonth,
  dueDate,
  buildInstallmentSchedule,
  groupScheduleRows,
};
