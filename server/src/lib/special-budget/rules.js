'use strict';
// 特殊预算规则引擎（v3.2.0 基础层）
// 纯函数，不访问数据库；金额统一两位小数，日期一律按北京时间 UTC+8 判定。
// 规则出处：HANDOFF_SPECIAL_BUDGET.md §3.1-§3.7。改规则必须先改交接文件并升 rule_version。

const MAX_AMOUNT = 9999999;
const EPS = 0.005; // 金额比较容差（半分钱）

// 每个年份单独配置；历史年份只读。v3.2.0 只 seed 这两年，未来年份由 v3.3.0 配置。
const DEFAULT_CONFIGS = {
  2026: {
    year: 2026,
    annual_cap: 1000,
    monthly_regular_cap: 800,
    saturday_rate: 0.10,
    large_threshold: 800,
    cross_year_allowed: 0,
    rule_version: '2026-v1',
    effective_from: '2026-12-01 00:00:00',
  },
  2027: {
    year: 2027,
    annual_cap: 10000,
    monthly_regular_cap: 800,
    saturday_rate: 0.10,
    large_threshold: 800,
    cross_year_allowed: 1,
    rule_version: '2027-v1',
    effective_from: '2027-01-01 00:00:00',
  },
};

function round2(n) {
  const v = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
}

function hasAtMost2Decimals(n) {
  return Math.abs(Number(n) * 100 - Math.round(Number(n) * 100)) < 1e-6;
}

function defaultConfig(year) {
  const c = DEFAULT_CONFIGS[Number(year)];
  return c ? configView(c) : null;
}

// mysql2 默认把 DATETIME 返回为 Date；统一转成北京时间字符串，避免接口输出 UTC ISO。
function beijingDateTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    return new Date(v.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  }
  return String(v);
}

// DB 行 / 默认配置 → 统一视图（补 saturday_cap，数值化）
function configView(row) {
  if (!row) return null;
  const annualCap = round2(row.annual_cap);
  const rate = Number(row.saturday_rate);
  return {
    year: Number(row.year),
    annual_cap: annualCap,
    monthly_regular_cap: round2(row.monthly_regular_cap),
    saturday_rate: Number.isFinite(rate) ? rate : 0.10,
    saturday_cap: round2(annualCap * (Number.isFinite(rate) ? rate : 0.10)),
    large_threshold: round2(row.large_threshold),
    cross_year_allowed: Number(row.cross_year_allowed) ? 1 : 0,
    rule_version: String(row.rule_version || ''),
    effective_from: beijingDateTime(row.effective_from),
    effective_to: beijingDateTime(row.effective_to),
  };
}

// 北京时间分解。传入 Date 或可被 Date 解析的字符串/时间戳。
function beijingParts(at) {
  const d = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(d.getTime())) return null;
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  return {
    year: bj.getUTCFullYear(),
    month: bj.getUTCMonth() + 1,
    day: bj.getUTCDate(),
    weekday: bj.getUTCDay(), // 0=周日, 6=周六
    hour: bj.getUTCHours(),
    minute: bj.getUTCMinutes(),
  };
}

function fmtBeijing(bj) {
  const p = n => String(n).padStart(2, '0');
  return `${bj.year}-${p(bj.month)}-${p(bj.day)} ${p(bj.hour)}:${p(bj.minute)} +08:00`;
}

// 申请窗口（§3.2）：普通=每月 1/15；周六追加=每周六；大额=1/15 或周六。
function windowFor(type, at) {
  const bj = beijingParts(at);
  if (!bj) return { ok: false, code: 'INVALID_TIME', message: '时间格式无效' };
  let ok = false;
  let rule = '';
  if (type === 'normal') {
    ok = bj.day === 1 || bj.day === 15;
    rule = '每月 1 号、15 号';
  } else if (type === 'additional') {
    ok = bj.weekday === 6;
    rule = '自然月内每周六（且当月 800 已全部批完）';
  } else if (type === 'large') {
    ok = bj.day === 1 || bj.day === 15 || bj.weekday === 6;
    rule = '每月 1 号、15 号或周六';
  } else {
    return { ok: false, code: 'INVALID_TYPE', message: '申请类型只能是 normal / additional / large' };
  }
  return {
    ok,
    code: ok ? null : 'NOT_IN_WINDOW',
    message: ok ? null : `不在申请窗口（${rule}）`,
    rule,
    at: bj,
    at_text: fmtBeijing(bj),
  };
}

function fail(code, message, extra) {
  return Object.assign({ ok: false, code, message }, extra || {});
}

// 普通 / 周六追加 / 大额的提交校验（§3.1、§3.2）。
// 大额的多年度占用必须另调 checkAnnualAvailability(segments, ...)，
// 本函数只对普通/周六追加做当年年度上限校验，避免与分期分段重复计算。
function validateApplication(opts) {
  const o = opts || {};
  const type = String(o.type || '');
  const rawAmount = Number(o.amount);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) return fail('INVALID_AMOUNT', '金额必须大于 0');
  if (rawAmount > MAX_AMOUNT) return fail('AMOUNT_TOO_LARGE', `金额不能超过 ${MAX_AMOUNT}`);
  if (!hasAtMost2Decimals(rawAmount)) return fail('INVALID_AMOUNT', '金额最多两位小数');
  const amount = round2(rawAmount);

  const win = windowFor(type, o.at || new Date());
  if (!win.ok) return fail(win.code, win.message, { window: win });

  const bj = win.at;
  const config = o.config || defaultConfig(bj.year);
  if (!config) return fail('CONFIG_MISSING', `${bj.year} 年未配置特殊预算`);
  if (Number(config.year) !== bj.year) {
    return fail('CONFIG_YEAR_MISMATCH', `配置年份 ${config.year} 与申请年份 ${bj.year} 不一致`);
  }

  const annualCap = round2(config.annual_cap);
  const monthlyCap = round2(config.monthly_regular_cap);
  const monthlyApproved = round2(Math.max(0, Number(o.monthlyApproved) || 0));
  const annualCommitted = round2(Math.max(0, Number(o.annualCommitted) || 0));
  const saturdayCap = round2(annualCap * Number(config.saturday_rate));
  const saturdayApproved = round2(Math.max(0, Number(o.saturdayApprovedToday) || 0));

  const base = {
    type,
    amount,
    at: bj,
    at_text: fmtBeijing(bj),
    rule_version: config.rule_version,
    window: win,
    config: {
      year: config.year,
      annual_cap: annualCap,
      monthly_regular_cap: monthlyCap,
      saturday_rate: Number(config.saturday_rate),
      saturday_cap: saturdayCap,
      large_threshold: round2(config.large_threshold),
      cross_year_allowed: Number(config.cross_year_allowed) ? 1 : 0,
    },
  };

  if (type === 'normal' || type === 'additional') {
    if (annualCommitted + amount > annualCap + EPS) {
      return fail('ANNUAL_EXCEEDED', `年度额度不足：剩余 ${round2(Math.max(0, annualCap - annualCommitted))}`, Object.assign(base, {
        shortfall: round2(annualCommitted + amount - annualCap),
        calculation: { annual_cap: annualCap, annual_committed: annualCommitted, requested: amount },
      }));
    }
    base.calculation = { annual_cap: annualCap, annual_committed: annualCommitted, requested: amount };
  }

  if (type === 'normal') {
    if (amount > monthlyCap + EPS) {
      return fail('LARGE_REQUIRED', `单笔超过 ${monthlyCap} 必须走大额采购`, base);
    }
    const available = round2(Math.max(0, monthlyCap - monthlyApproved));
    if (monthlyApproved + amount > monthlyCap + EPS) {
      return fail('MONTHLY_CAP_EXCEEDED', `本月常规额度不足：可批 ${available}`, Object.assign(base, {
        shortfall: round2(monthlyApproved + amount - monthlyCap),
        calculation: { monthly_regular_cap: monthlyCap, monthly_approved: monthlyApproved, requested: amount },
      }));
    }
    base.calculation = Object.assign(base.calculation || {}, {
      monthly_regular_cap: monthlyCap,
      monthly_approved: monthlyApproved,
      monthly_available_before: available,
      monthly_available_after: round2(available - amount),
    });
  } else if (type === 'additional') {
    // 周六追加不占 800，但前提是当月 800 已按审批金额全部批完（不是实际付款）。
    if (monthlyApproved + EPS < monthlyCap) {
      return fail('MONTHLY_NOT_FULLY_APPROVED',
        `当月 800 尚未全部批完（已批 ${monthlyApproved}），不能申请周六追加`,
        Object.assign(base, { calculation: { monthly_regular_cap: monthlyCap, monthly_approved: monthlyApproved } }));
    }
    if (saturdayApproved + amount > saturdayCap + EPS) {
      return fail('SATURDAY_CAP_EXCEEDED', `本周六额度不足：剩余 ${round2(Math.max(0, saturdayCap - saturdayApproved))}`, Object.assign(base, {
        shortfall: round2(saturdayApproved + amount - saturdayCap),
        calculation: { saturday_cap: saturdayCap, saturday_approved: saturdayApproved, requested: amount },
      }));
    }
    base.calculation = Object.assign(base.calculation || {}, {
      monthly_regular_cap: monthlyCap,
      monthly_approved: monthlyApproved,
      saturday_cap: saturdayCap,
      saturday_approved: saturdayApproved,
      saturday_available_before: round2(Math.max(0, saturdayCap - saturdayApproved)),
      saturday_available_after: round2(Math.max(0, saturdayCap - saturdayApproved - amount)),
    });
  } else if (type === 'large') {
    // 大额不占月度 800、不占周六 10%，但占年度上限（含未来年度承诺）。
    if (amount <= round2(config.large_threshold)) {
      return fail('LARGE_THRESHOLD_NOT_MET', `金额未超过 ${round2(config.large_threshold)}，应按普通申请提交`, base);
    }
    base.calculation = {
      large_threshold: round2(config.large_threshold),
      requested: amount,
      note: '大额不占月度 800 / 周六 10%，按分期分段占用年度上限，需另做多年度校验',
    };
  }

  return Object.assign({ ok: true }, base);
}

// 大额分期按年分段后的年度上限校验（§3.4、§3.5）。
// segments: [{year, amount}]；yearlyCommitted: {2027: 已占用, ...}；
// configs: 数组或 {year: config}，每年必须有配置，否则拒绝（不默认给未来年份 10000）。
function checkAnnualAvailability(opts) {
  const o = opts || {};
  const segments = Array.isArray(o.segments) ? o.segments : [];
  if (!segments.length) return { ok: true, years: [] };
  const yearlyCommitted = o.yearlyCommitted || {};
  const configMap = new Map();
  const list = Array.isArray(o.configs) ? o.configs : Object.values(o.configs || {});
  for (const c of list) {
    const v = configView(c);
    if (v) configMap.set(v.year, v);
  }

  const required = new Map();
  for (const s of segments) {
    const year = Number(s.year);
    const amt = round2(s.amount);
    if (!Number.isInteger(year) || !Number.isFinite(amt) || amt < 0) {
      return fail('INVALID_SEGMENT', '分期分段数据无效');
    }
    required.set(year, round2((required.get(year) || 0) + amt));
  }

  const years = [];
  for (const [year, need] of Array.from(required.entries()).sort((a, b) => a[0] - b[0])) {
    const config = configMap.get(year);
    if (!config) {
      return fail('YEAR_CONFIG_MISSING', `${year} 年未配置年度上限，不能占用未来年度`, {
        year,
        detail: { year, required: need },
      });
    }
    const committed = round2(Math.max(0, Number(yearlyCommitted[year]) || 0));
    const cap = round2(config.annual_cap);
    const row = {
      year,
      annual_cap: cap,
      committed,
      required: need,
      available: round2(cap - committed),
      remaining_after: round2(cap - committed - need),
      rule_version: config.rule_version,
    };
    years.push(row);
    if (committed + need > cap + EPS) {
      return fail('ANNUAL_EXCEEDED', `${year} 年度上限不足：需 ${need}，剩余 ${row.available}`, {
        year,
        shortfall: round2(committed + need - cap),
        detail: row,
        years,
      });
    }
  }
  return { ok: true, years };
}

// 年度上限修改校验（§3.7）。历史年份只读；调低不得低于已占用/未来承诺。
function validateConfigChange(opts) {
  const o = opts || {};
  const year = Number(o.year);
  const nowYear = Number.isInteger(Number(o.currentYear))
    ? Number(o.currentYear)
    : (beijingParts(new Date()) || {}).year;
  if (!Number.isInteger(year) || year < 2026 || year > 2100) return fail('INVALID_YEAR', '年份无效');
  if (year < nowYear) return fail('HISTORY_READONLY', `${year} 年为历史年份，只读`);

  const newCapRaw = Number(o.newCap);
  if (!Number.isFinite(newCapRaw) || newCapRaw < 0) return fail('INVALID_ANNUAL_CAP', '年度上限必须是非负数字');
  if (newCapRaw > MAX_AMOUNT) return fail('INVALID_ANNUAL_CAP', `年度上限不能超过 ${MAX_AMOUNT}`);
  if (!hasAtMost2Decimals(newCapRaw)) return fail('INVALID_ANNUAL_CAP', '年度上限最多两位小数');
  const newCap = round2(newCapRaw);

  const paid = round2(Math.max(0, Number(o.paid) || 0));
  const approvedUnpaid = round2(Math.max(0, Number(o.approvedUnpaid) || 0));
  const installmentPlan = round2(Math.max(0, Number(o.installmentPlan) || 0));
  const futureCommitments = round2(Math.max(0, Number(o.futureCommitments) || 0));
  const occupied = round2(paid + approvedUnpaid + installmentPlan);
  const floor = round2(Math.max(occupied, futureCommitments));
  const rate = o.config && Number.isFinite(Number(o.config.saturday_rate))
    ? Number(o.config.saturday_rate) : 0.10;

  const calc = {
    year,
    new_cap: newCap,
    paid,
    approved_unpaid: approvedUnpaid,
    installment_plan: installmentPlan,
    occupied,
    future_commitments: futureCommitments,
    floor,
    saturday_cap: round2(newCap * rate),
    rule_version: o.config ? o.config.rule_version : null,
  };

  if (newCap < floor - EPS) {
    return fail('CONFIG_TOO_LOW', `调低被拒绝：${year} 年最低不得低于 ${floor}`, Object.assign(calc, {
      shortfall: round2(floor - newCap),
    }));
  }
  return Object.assign({ ok: true }, calc);
}

function saturdayCap(config) {
  const c = configView(config);
  return c ? c.saturday_cap : null;
}

module.exports = {
  MAX_AMOUNT,
  DEFAULT_CONFIGS,
  round2,
  hasAtMost2Decimals,
  defaultConfig,
  configView,
  beijingParts,
  fmtBeijing,
  windowFor,
  validateApplication,
  checkAnnualAvailability,
  validateConfigChange,
  saturdayCap,
};
