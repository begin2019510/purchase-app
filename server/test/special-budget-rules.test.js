'use strict';
// 特殊预算 v3.2.0 纯函数测试：配置 / 窗口 / 上限 / 未来年度 / 分期计算器
// 用法: node server/test/special-budget-rules.test.js
const assert = require('assert');
const R = require('../src/lib/special-budget/rules');
const S = require('../src/lib/special-budget/schedule');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok', name); }
  catch (e) { console.error('  FAIL', name, '→', e.message); process.exitCode = 1; }
}
function bj(s) { return new Date(s + '+08:00'); }
function cfgFor(year, opts) {
  return Object.assign({
    year,
    annual_cap: 10000,
    monthly_regular_cap: 800,
    saturday_rate: 0.10,
    large_threshold: 800,
    cross_year_allowed: 1,
    rule_version: year + '-v1',
  }, opts || {});
}
function ok(v) { assert.ok(v.ok, JSON.stringify(v)); return v; }
function err(v, code) { assert.strictEqual(v.ok, false, '应失败: ' + JSON.stringify(v)); assert.strictEqual(v.code, code, JSON.stringify(v)); return v; }

console.log('== 默认配置 ==');
t('2026：1000/800/10%/800/不跨年', () => {
  const c = R.defaultConfig(2026);
  assert.strictEqual(c.annual_cap, 1000);
  assert.strictEqual(c.monthly_regular_cap, 800);
  assert.strictEqual(c.saturday_rate, 0.10);
  assert.strictEqual(c.saturday_cap, 100);
  assert.strictEqual(c.large_threshold, 800);
  assert.strictEqual(c.cross_year_allowed, 0);
});
t('2027：10000/800/10%/800/可跨年', () => {
  const c = R.defaultConfig(2027);
  assert.strictEqual(c.annual_cap, 10000);
  assert.strictEqual(c.saturday_cap, 1000);
  assert.strictEqual(c.cross_year_allowed, 1);
});
t('周六上限随年度上限变化：8000→800、12000→1200', () => {
  assert.strictEqual(R.saturdayCap(cfgFor(2028, { annual_cap: 8000 })), 800);
  assert.strictEqual(R.saturdayCap(cfgFor(2028, { annual_cap: 12000 })), 1200);
});

console.log('== 申请窗口（北京时间）==');
t('普通：1 号/15 号', () => {
  ok(R.windowFor('normal', bj('2026-12-01T10:00:00')));
  ok(R.windowFor('normal', bj('2026-12-15T23:59:00')));
  err(R.windowFor('normal', bj('2026-12-02T10:00:00')), 'NOT_IN_WINDOW');
  err(R.windowFor('normal', bj('2026-12-16T10:00:00')), 'NOT_IN_WINDOW');
});
t('周六追加：只认周六', () => {
  ok(R.windowFor('additional', bj('2026-12-05T10:00:00')));
  err(R.windowFor('additional', bj('2026-12-06T10:00:00')), 'NOT_IN_WINDOW');
});
t('大额：1 号/15 号/周六', () => {
  ok(R.windowFor('large', bj('2026-12-01T10:00:00')));
  ok(R.windowFor('large', bj('2026-12-05T10:00:00')));
  err(R.windowFor('large', bj('2026-12-02T10:00:00')), 'NOT_IN_WINDOW');
});
t('UTC 边界按 UTC+8 判定', () => {
  ok(R.windowFor('normal', new Date('2026-11-30T16:30:00Z')), '12-01 00:30 北京');
  ok(R.windowFor('normal', new Date('2026-12-01T15:59:00Z')), '12-01 23:59 北京');
  err(R.windowFor('normal', new Date('2026-12-01T16:00:00Z')), 'NOT_IN_WINDOW');
});
t('非法类型/时间', () => {
  err(R.windowFor('hack', bj('2026-12-01T10:00:00')), 'INVALID_TYPE');
  err(R.windowFor('normal', 'not-a-date'), 'INVALID_TIME');
});

console.log('== 普通申请 / 800 硬上限 ==');
t('2026-12 普通 800 可批，800.01 必须走大额', () => {
  ok(R.validateApplication({ type: 'normal', amount: 800, at: bj('2026-12-01T10:00:00'), monthlyApproved: 0, annualCommitted: 0 }));
  err(R.validateApplication({ type: 'normal', amount: 800.01, at: bj('2026-12-01T10:00:00'), monthlyApproved: 0, annualCommitted: 0 }), 'LARGE_REQUIRED');
});
t('月度 800 已批 100，再批 700 可以，700.01 拒绝', () => {
  ok(R.validateApplication({ type: 'normal', amount: 700, at: bj('2026-12-15T10:00:00'), monthlyApproved: 100, annualCommitted: 100 }));
  const r = err(R.validateApplication({ type: 'normal', amount: 700.01, at: bj('2026-12-15T10:00:00'), monthlyApproved: 100, annualCommitted: 100 }), 'MONTHLY_CAP_EXCEEDED');
  assert.strictEqual(r.shortfall, 0.01);
});
t('年度不足直接拒绝，不自动降 800', () => {
  const r = err(R.validateApplication({ type: 'normal', amount: 200, at: bj('2026-12-01T10:00:00'), monthlyApproved: 0, annualCommitted: 900 }), 'ANNUAL_EXCEEDED');
  assert.strictEqual(r.shortfall, 100);
});
t('金额非法', () => {
  err(R.validateApplication({ type: 'normal', amount: 0, at: bj('2026-12-01T10:00:00') }), 'INVALID_AMOUNT');
  err(R.validateApplication({ type: 'normal', amount: -1, at: bj('2026-12-01T10:00:00') }), 'INVALID_AMOUNT');
  err(R.validateApplication({ type: 'normal', amount: 1.001, at: bj('2026-12-01T10:00:00') }), 'INVALID_AMOUNT');
});

console.log('== 周六追加 ==');
t('800 未批完不能追加', () => {
  err(R.validateApplication({ type: 'additional', amount: 50, at: bj('2026-12-05T10:00:00'), monthlyApproved: 799.99, saturdayApprovedToday: 0 }), 'MONTHLY_NOT_FULLY_APPROVED');
});
t('2026 单周六上限 100：100 可以，100.01 拒绝', () => {
  ok(R.validateApplication({ type: 'additional', amount: 100, at: bj('2026-12-05T10:00:00'), monthlyApproved: 800, annualCommitted: 800, saturdayApprovedToday: 0 }));
  const r = err(R.validateApplication({ type: 'additional', amount: 100.01, at: bj('2026-12-05T10:00:00'), monthlyApproved: 800, annualCommitted: 800, saturdayApprovedToday: 0 }), 'SATURDAY_CAP_EXCEEDED');
  assert.strictEqual(r.shortfall, 0.01);
});
t('2027 单周六上限 1000', () => {
  ok(R.validateApplication({ type: 'additional', amount: 1000, at: bj('2027-01-02T10:00:00'), monthlyApproved: 800, annualCommitted: 800, saturdayApprovedToday: 0, config: R.defaultConfig(2027) }));
  err(R.validateApplication({ type: 'additional', amount: 1000.01, at: bj('2027-01-02T10:00:00'), monthlyApproved: 800, annualCommitted: 800, saturdayApprovedToday: 0, config: R.defaultConfig(2027) }), 'SATURDAY_CAP_EXCEEDED');
});
t('同日累计已批也计入', () => {
  err(R.validateApplication({ type: 'additional', amount: 60, at: bj('2026-12-05T10:00:00'), monthlyApproved: 800, annualCommitted: 800, saturdayApprovedToday: 50 }), 'SATURDAY_CAP_EXCEEDED');
});

console.log('== 大额 ==');
t('800 不算大额，800.01 才是', () => {
  err(R.validateApplication({ type: 'large', amount: 800, at: bj('2026-12-01T10:00:00') }), 'LARGE_THRESHOLD_NOT_MET');
  ok(R.validateApplication({ type: 'large', amount: 800.01, at: bj('2026-12-01T10:00:00') }));
});
t('大额不受 800 月度限制，但需另做年度校验', () => {
  const v = ok(R.validateApplication({ type: 'large', amount: 900, at: bj('2026-12-01T10:00:00'), monthlyApproved: 800, annualCommitted: 0 }));
  assert.strictEqual(v.calculation.note.includes('大额不占月度 800'), true);
});
t('窗口外大额拒绝', () => {
  err(R.validateApplication({ type: 'large', amount: 900, at: bj('2026-12-02T10:00:00') }), 'NOT_IN_WINDOW');
});

console.log('== 未来年度承诺 ==');
t('多年度充足', () => {
  const r = ok(R.checkAnnualAvailability({
    segments: [{ year: 2027, amount: 2000 }, { year: 2028, amount: 4000 }, { year: 2029, amount: 2000 }],
    yearlyCommitted: { 2027: 0, 2028: 0, 2029: 0 },
    configs: [R.defaultConfig(2027), cfgFor(2028), cfgFor(2029)],
  }));
  assert.strictEqual(r.years.length, 3);
});
t('某年不足拒绝并给出差额', () => {
  const r = err(R.checkAnnualAvailability({
    segments: [{ year: 2027, amount: 2000 }],
    yearlyCommitted: { 2027: 9000 },
    configs: [R.defaultConfig(2027)],
  }), 'ANNUAL_EXCEEDED');
  assert.strictEqual(r.shortfall, 1000);
  assert.strictEqual(r.detail.available, 1000);
});
t('未来年份未配置直接拒绝，不默认 10000', () => {
  err(R.checkAnnualAvailability({
    segments: [{ year: 2029, amount: 100 }],
    yearlyCommitted: {},
    configs: [R.defaultConfig(2027)],
  }), 'YEAR_CONFIG_MISSING');
});
t('8000/24 按年分段占用的额度校验（7/12/5）', () => {
  const s = ok(S.buildInstallmentSchedule({ total: 8000, installments: 24, firstYear: 2027, firstMonth: 6, crossYearAllowed: true }));
  const cfg2029 = cfgFor(2029);
  const r = ok(R.checkAnnualAvailability({
    segments: s.segments,
    yearlyCommitted: {},
    configs: [R.defaultConfig(2027), cfgFor(2028), cfg2029],
  }));
  assert.deepStrictEqual(r.years.map(y => [y.year, y.required]), [[2027, 2333.31], [2028, 3999.96], [2029, 1666.73]]);
});

console.log('== 年度上限修改 ==');
t('历史年份只读', () => {
  err(R.validateConfigChange({ year: 2027, newCap: 1000, currentYear: 2028 }), 'HISTORY_READONLY');
});
t('早于系统起始年份视为非法年份', () => {
  err(R.validateConfigChange({ year: 2025, newCap: 1000, currentYear: 2026 }), 'INVALID_YEAR');
});
t('调低不得低于已付+已批未付+分期计划', () => {
  const r = err(R.validateConfigChange({
    year: 2026, newCap: 899.99, currentYear: 2026,
    paid: 500, approvedUnpaid: 300, installmentPlan: 100,
  }), 'CONFIG_TOO_LOW');
  assert.strictEqual(r.floor, 900);
  assert.strictEqual(r.shortfall, 0.01);
  ok(R.validateConfigChange({ year: 2026, newCap: 900, currentYear: 2026, paid: 500, approvedUnpaid: 300, installmentPlan: 100 }));
});
t('调低不得低于未来承诺', () => {
  const r = err(R.validateConfigChange({ year: 2028, newCap: 900, currentYear: 2026, futureCommitments: 950 }), 'CONFIG_TOO_LOW');
  assert.strictEqual(r.floor, 950);
});
t('调高立即通过，周六上限同步', () => {
  const r = ok(R.validateConfigChange({ year: 2027, newCap: 8000, currentYear: 2026, config: R.defaultConfig(2027) }));
  assert.strictEqual(r.saturday_cap, 800);
  const r2 = ok(R.validateConfigChange({ year: 2027, newCap: 12000, currentYear: 2026, config: R.defaultConfig(2027) }));
  assert.strictEqual(r2.saturday_cap, 1200);
});
t('负数/三位小数/非法年份', () => {
  err(R.validateConfigChange({ year: 2027, newCap: -1, currentYear: 2026 }), 'INVALID_ANNUAL_CAP');
  err(R.validateConfigChange({ year: 2027, newCap: 1000.001, currentYear: 2026 }), 'INVALID_ANNUAL_CAP');
  err(R.validateConfigChange({ year: 1999, newCap: 1000, currentYear: 2026 }), 'INVALID_YEAR');
});

console.log('== 分期计算器 ==');
t('8000/24 首期 2027-06 → 7/12/5，合计 8000', () => {
  const s = ok(S.buildInstallmentSchedule({ total: 8000, installments: 24, firstYear: 2027, firstMonth: 6, crossYearAllowed: true }));
  assert.deepStrictEqual(s.segments.map(x => [x.year, x.count, x.amount]), [
    [2027, 7, 2333.31], [2028, 12, 3999.96], [2029, 5, 1666.73],
  ]);
  assert.strictEqual(s.entries.length, 24);
  assert.strictEqual(R.round2(s.entries.reduce((a, e) => a + e.amount, 0)), 8000);
  assert.strictEqual(s.entries[0].due_date, '2027-06-30');
  assert.strictEqual(s.entries[23].amount, 333.41, '最后一期吸收尾差');
  assert.strictEqual(s.entries[23].due_date, '2029-05-31');
});
t('8000/24 首期 2027-05 → 8/12/4', () => {
  const s = ok(S.buildInstallmentSchedule({ total: 8000, installments: 24, firstYear: 2027, firstMonth: 5, crossYearAllowed: true }));
  assert.deepStrictEqual(s.segments.map(x => [x.year, x.count]), [[2027, 8], [2028, 12], [2029, 4]]);
  assert.strictEqual(R.round2(s.entries.reduce((a, e) => a + e.amount, 0)), 8000);
});
t('参数化 10000/24 → 12/12，合计 10000', () => {
  const s = ok(S.buildInstallmentSchedule({ total: 10000, installments: 24, firstYear: 2027, firstMonth: 1, crossYearAllowed: true }));
  assert.deepStrictEqual(s.segments.map(x => [x.year, x.count]), [[2027, 12], [2028, 12]]);
  assert.strictEqual(s.monthly_base, 416.67);
  assert.strictEqual(s.entries[23].amount, 416.59);
  assert.strictEqual(R.round2(s.entries.reduce((a, e) => a + e.amount, 0)), 10000);
});
t('参数化 12000/24 → 12/12，每期 500', () => {
  const s = ok(S.buildInstallmentSchedule({ total: 12000, installments: 24, firstYear: 2027, firstMonth: 1, crossYearAllowed: true }));
  assert.deepStrictEqual(s.segments.map(x => [x.year, x.count]), [[2027, 12], [2028, 12]]);
  assert.strictEqual(s.monthly_base, 500);
  assert.strictEqual(s.monthly_last, 500);
  assert.strictEqual(R.round2(s.entries.reduce((a, e) => a + e.amount, 0)), 12000);
});
t('闰年/平年月末到期日', () => {
  const s = ok(S.buildInstallmentSchedule({ total: 3, installments: 3, firstYear: 2027, firstMonth: 2, crossYearAllowed: true }));
  assert.strictEqual(s.entries[0].due_date, '2027-02-28');
  const s2 = ok(S.buildInstallmentSchedule({ total: 3, installments: 3, firstYear: 2028, firstMonth: 2, crossYearAllowed: true }));
  assert.strictEqual(s2.entries[0].due_date, '2028-02-29');
});
t('2026-12：1 期可以，2 期跨年拒绝', () => {
  const s = ok(S.buildInstallmentSchedule({ total: 800, installments: 1, firstYear: 2026, firstMonth: 12, crossYearAllowed: false }));
  assert.deepStrictEqual(s.segments, [{ year: 2026, count: 1, amount: 800, first_month: 12, last_month: 12 }]);
  err(S.buildInstallmentSchedule({ total: 800, installments: 2, firstYear: 2026, firstMonth: 12, crossYearAllowed: false }), 'CROSS_YEAR_NOT_ALLOWED');
});
t('2026 首期必须 12 月', () => {
  err(S.buildInstallmentSchedule({ total: 800, installments: 1, firstYear: 2026, firstMonth: 11, crossYearAllowed: false }), '2026_ONLY_DECEMBER');
});
t('2027 配置不允许跨年时拒绝', () => {
  err(S.buildInstallmentSchedule({ total: 1000, installments: 3, firstYear: 2027, firstMonth: 11, crossYearAllowed: false }), 'CROSS_YEAR_NOT_ALLOWED');
});
t('非法输入', () => {
  err(S.buildInstallmentSchedule({ total: 0, installments: 1, firstYear: 2027, firstMonth: 1 }), 'INVALID_AMOUNT');
  err(S.buildInstallmentSchedule({ total: 100, installments: 0, firstYear: 2027, firstMonth: 1 }), 'INVALID_INSTALLMENTS');
  err(S.buildInstallmentSchedule({ total: 100, installments: 121, firstYear: 2027, firstMonth: 1 }), 'INVALID_INSTALLMENTS');
  err(S.buildInstallmentSchedule({ total: 1.001, installments: 1, firstYear: 2027, firstMonth: 1 }), 'INVALID_AMOUNT');
  err(S.buildInstallmentSchedule({ total: 0.02, installments: 3, firstYear: 2027, firstMonth: 1 }), 'AMOUNT_TOO_SMALL');
});

console.log(`\n${passed} passed${process.exitCode ? '（有失败）' : ''}`);
