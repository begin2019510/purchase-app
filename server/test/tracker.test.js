'use strict';
// 长期跟踪项目纯函数单测：字段/配置规范化、指标聚合、周月边界、里程碑、结项
// 用法: node server/test/tracker.test.js
const assert = require('assert');
const T = require('../src/lib/tracker');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok', name); }
  catch (e) { console.error('  FAIL', name, '→', e.message); process.exitCode = 1; }
}

// 2026-11-14 12:00 北京时间（周六）→ 本周一 11-09，本月 11-01 ~ 11-30
const NOW = Date.UTC(2026, 10, 14, 4, 0, 0);

const FIELDS = T.normalizeFields([
  { key: 'date', name: '日期', type: 'date', required: true },
  { key: 'company', name: '公司', type: 'text' },
  { key: 'event', name: '事件', type: 'select', options: ['投递', '一面', 'Offer'] },
  { key: 'weight', name: '体重', type: 'number', unit: 'kg' },
  { key: 'minutes', name: '时长', type: 'number', unit: '分钟' },
  { key: 'done', name: '完成', type: 'checkbox' },
]);

function rec(id, date, data) {
  return { id: 'rec_' + id, recordDate: date, data: data };
}
function cfg(over) {
  const base = {
    template: 'job',
    startDate: '2026-10-01',
    targetDate: '2026-12-31',
    goal: {
      text: '拿到 Offer', kind: 'number',
      metric: { agg: 'countValue', field: 'event', value: 'Offer' },
      target: 1, unit: '个', direction: 'up',
    },
    week: { target: 2, unit: '份', metric: { agg: 'countValue', field: 'event', value: '投递' } },
    milestones: [
      { id: 'resume', name: '简历定稿', done: true, doneDate: '2026-11-10' },
      { id: 'interview', name: '第一次面试', done: false },
    ],
    dateField: 'date',
    kanbanField: 'event',
  };
  return Object.assign(base, over || {});
}

const RECORDS = [
  rec(1, '2026-11-08', { date: '2026-11-08', event: '投递', company: 'A' }),
  rec(2, '2026-11-09', { date: '2026-11-09', event: '投递', company: 'B' }),
  rec(3, '2026-11-10', { date: '2026-11-10', event: '投递', company: 'C' }),
  rec(4, '2026-11-10', { date: '2026-11-10', event: '一面', company: 'C' }),
  rec(5, '2026-11-12', { date: '2026-11-12', event: '投递', company: 'D' }),
  rec(6, '2026-11-13', { date: '2026-11-13', event: 'Offer', company: 'D' }),
  rec(7, '2026-11-14', { date: '2026-11-14', event: '投递', company: 'E' }),
];

console.log('== 字段规范化 ==');
t('去重 key / 限制类型 / 保留选项', () => {
  const fs = T.normalizeFields([
    { key: 'date', name: '日期', type: 'date' },
    { key: 'date', name: '重复', type: 'text' },
    { key: 'BAD KEY', name: '', type: 'unknown' },
    { key: 's', name: '状态', type: 'select', options: ['a', 'a', '', 'b'] },
  ]);
  assert.strictEqual(fs.length, 4);
  assert.strictEqual(fs[1].key, 'f2');
  assert.strictEqual(fs[2].key, 'f3');
  assert.strictEqual(fs[2].type, 'text');
  assert.deepStrictEqual(fs[3].options, ['a', 'b']);
});
t('最多 24 个字段', () => {
  const fs = T.normalizeFields(Array.from({ length: 40 }, (_, i) => ({ key: 'f' + i, name: 'F' + i, type: 'text' })));
  assert.strictEqual(fs.length, 24);
});

console.log('== 记录规范化 ==');
t('空值不落库，0/false 保留', () => {
  const d = T.normalizeData(FIELDS, { date: '2026-11-14', company: '  ', weight: 0, done: false, minutes: '' });
  assert.strictEqual(d.company, undefined);
  assert.strictEqual(d.weight, 0);
  assert.strictEqual(d.done, false);
  assert.strictEqual(d.minutes, undefined);
});
t('必填校验', () => {
  const d = T.normalizeData(FIELDS, { company: 'A' });
  assert.deepStrictEqual(T.missingRequired(FIELDS, d), ['日期']);
  const d2 = T.normalizeData(FIELDS, { date: '2026-11-14' });
  assert.deepStrictEqual(T.missingRequired(FIELDS, d2), []);
});
t('记录日期优先 dateField，datetime 转北京日期', () => {
  const c = T.normalizeConfig({ dateField: 'date' }, FIELDS);
  assert.strictEqual(T.recordDateOf(FIELDS, { date: '2026-11-14T20:00:00Z' }, c), '2026-11-15');
  assert.strictEqual(T.recordDateOf(FIELDS, { date: '2026-11-14' }, c), '2026-11-14');
});

console.log('== 配置规范化 ==');
t('默认值 + 非法指标回退 count', () => {
  const c = T.normalizeConfig({ goal: { text: '测试', kind: 'number', metric: { agg: 'sum', field: 'event' } } }, FIELDS);
  assert.strictEqual(c.goal.metric.agg, 'count');
  assert.strictEqual(c.goal.direction, 'up');
  assert.strictEqual(c.week.target, 0);
  assert.strictEqual(c.dateField, 'date');
  assert.strictEqual(c.kanbanField, 'event');
});
t('里程碑 id 去重、空名丢弃', () => {
  const c = T.normalizeConfig({ milestones: [
    { id: 'm1', name: 'A' }, { id: 'm1', name: 'B' }, { id: '', name: '' }, { name: 'C' },
  ] }, FIELDS);
  assert.deepStrictEqual(c.milestones.map(m => m.name), ['A', 'B', 'C']);
  assert.strictEqual(new Set(c.milestones.map(m => m.id)).size, 3);
});
t('目标日期早于开始日期时清空', () => {
  const c = T.normalizeConfig({ startDate: '2026-11-10', targetDate: '2026-11-01' }, FIELDS);
  assert.strictEqual(c.targetDate, '');
});
t('结项信息规范化', () => {
  const c = T.normalizeConfig({ closed: { at: NOW, result: 'ended', note: '  ok  ' } }, FIELDS);
  assert.strictEqual(c.closed.result, 'ended');
  assert.strictEqual(c.closed.note, 'ok');
  assert.strictEqual(T.normalizeConfig({ closed: { result: 'achieved' } }, FIELDS).closed, null);
});

console.log('== 日期区间 ==');
t('北京时间周一~周日', () => {
  assert.deepStrictEqual(T.weekRange('2026-11-14'), { start: '2026-11-09', end: '2026-11-15' });
  assert.deepStrictEqual(T.weekRange('2026-11-09'), { start: '2026-11-09', end: '2026-11-15' });
  assert.deepStrictEqual(T.weekRange('2026-11-15'), { start: '2026-11-09', end: '2026-11-15' });
});
t('月份边界', () => {
  assert.deepStrictEqual(T.monthRange('2026-11-14'), { start: '2026-11-01', end: '2026-11-30', label: '2026年11月' });
  assert.strictEqual(T.monthRange('2024-02-10').end, '2024-02-29');
});
t('北京日期', () => {
  assert.strictEqual(T.bjToday(NOW), '2026-11-14');
  assert.strictEqual(T.bjToday(Date.UTC(2026, 10, 14, 16, 30, 0)), '2026-11-15');
});

console.log('== 指标聚合 ==');
t('count / countValue / countTrue / sum / latest / max', () => {
  const rs = [
    rec(1, '2026-11-01', { weight: 90, minutes: 30, done: true, event: '投递' }),
    rec(2, '2026-11-02', { weight: 88, minutes: 20, done: false, event: '投递' }),
    rec(3, '2026-11-03', { weight: 85, minutes: 50, done: true, event: 'Offer' }),
  ];
  assert.strictEqual(T.metricValue({ agg: 'count' }, rs), 3);
  assert.strictEqual(T.metricValue({ agg: 'countValue', field: 'event', value: '投递' }, rs), 2);
  assert.strictEqual(T.metricValue({ agg: 'countTrue', field: 'done' }, rs), 2);
  assert.strictEqual(T.metricValue({ agg: 'sum', field: 'minutes' }, rs), 100);
  assert.strictEqual(T.metricValue({ agg: 'latest', field: 'weight' }, rs.slice().reverse()), 85);
  assert.strictEqual(T.metricValue({ agg: 'max', field: 'weight' }, rs), 90);
  assert.strictEqual(T.metricValue({ agg: 'sum', field: 'minutes' }, []), 0);
  assert.strictEqual(T.metricValue({ agg: 'latest', field: 'weight' }, []), null);
});

console.log('== 目标进度 ==');
t('正向数值目标', () => {
  const c = T.normalizeConfig(cfg(), FIELDS);
  const g = T.goalProgress(c, RECORDS);
  assert.strictEqual(g.current, 1);
  assert.strictEqual(g.pct, 100);
  assert.strictEqual(g.achieved, true);
  assert.strictEqual(g.remaining, 0);
});
t('反向目标用基线算进度', () => {
  const c = T.normalizeConfig(cfg({
    goal: { text: '减到65kg', kind: 'number', metric: { agg: 'latest', field: 'weight' }, target: 65, unit: 'kg', direction: 'down' },
  }), FIELDS);
  const rs = [
    rec(1, '2026-10-01', { weight: 90 }),
    rec(2, '2026-10-20', { weight: 80 }),
    rec(3, '2026-11-10', { weight: 70 }),
  ];
  const g = T.goalProgress(c, rs);
  assert.strictEqual(g.baseline, 90);
  assert.strictEqual(g.current, 70);
  assert.strictEqual(g.pct, 80);
  assert.strictEqual(g.remaining, 5);
  assert.strictEqual(g.achieved, false);
});
t('里程碑目标进度', () => {
  const c = T.normalizeConfig(cfg({ goal: { text: '完成准备', kind: 'milestone' } }), FIELDS);
  const g = T.goalProgress(c, RECORDS);
  assert.strictEqual(g.total, 2);
  assert.strictEqual(g.done, 1);
  assert.strictEqual(g.pct, 50);
  assert.strictEqual(g.achieved, false);
});

console.log('== 周/月汇总 ==');
t('本周指标、活跃天数、里程碑', () => {
  const c = T.normalizeConfig(cfg(), FIELDS);
  const ov = T.computeOverview(FIELDS, c, RECORDS, NOW);
  assert.strictEqual(ov.today, '2026-11-14');
  assert.strictEqual(ov.week.start, '2026-11-09');
  assert.strictEqual(ov.week.end, '2026-11-15');
  assert.strictEqual(ov.week.count, 6);
  assert.strictEqual(ov.week.activeDays, 5);
  assert.strictEqual(ov.week.value, 4);
  assert.strictEqual(ov.week.met, true);
  assert.strictEqual(ov.week.milestones.length, 1);
  assert.ok(ov.week.summary.indexOf('已达标') >= 0);
  assert.strictEqual(ov.month.count, 7);
  assert.strictEqual(ov.month.milestones.length, 1);
  assert.ok(ov.month.summary.indexOf('完成里程碑') >= 0);
  assert.strictEqual(ov.goal.current, 1);
  assert.strictEqual(ov.streak, 1);
  assert.strictEqual(ov.nextMilestone.name, '第一次面试');
  assert.strictEqual(ov.series.week.length, 7);
  assert.strictEqual(ov.series.week[1].count, 2); // 11-10 有两条记录
  assert.strictEqual(ov.series.month.length, 5);
  assert.strictEqual(ov.series.all.length, 2);
  assert.deepStrictEqual(ov.distribution[0], { name: '投递', count: 5 });
});
t('本周未达标不打断上周连续记录', () => {
  const c = T.normalizeConfig(cfg({ week: { target: 10, unit: '份', metric: { agg: 'count' } } }), FIELDS);
  const rs = RECORDS.concat([
    rec(10, '2026-11-02', { event: '投递' }), rec(11, '2026-11-03', { event: '投递' }),
    rec(12, '2026-11-04', { event: '投递' }), rec(13, '2026-11-05', { event: '投递' }),
    rec(14, '2026-11-06', { event: '投递' }), rec(15, '2026-11-07', { event: '投递' }),
    rec(16, '2026-11-08', { event: '投递' }), rec(17, '2026-11-08', { event: '投递' }),
    rec(18, '2026-11-08', { event: '投递' }),
  ]);
  // 本周 6 条 < 10，未达标；上周 10 条达标
  assert.strictEqual(T.computeStreak(c, rs, '2026-11-14'), 1);
});
t('结项报告', () => {
  const c = T.normalizeConfig(cfg({ closed: { at: NOW, result: 'achieved', note: '完成' } }), FIELDS);
  const ov = T.computeOverview(FIELDS, c, RECORDS, NOW);
  assert.ok(ov.report);
  assert.strictEqual(ov.report.resultText, '达成目标');
  assert.strictEqual(ov.report.startDate, '2026-10-01');
  assert.strictEqual(ov.report.endDate, '2026-11-14');
  assert.strictEqual(ov.report.days, 45);
  assert.strictEqual(ov.report.records, 7);
  assert.strictEqual(ov.report.milestonesDone, 1);
});
t('看板轻量统计', () => {
  const c = T.normalizeConfig(cfg(), FIELDS);
  const b = T.boardStats(FIELDS, c, RECORDS, NOW);
  assert.strictEqual(b.goal.achieved, true);
  assert.strictEqual(b.week.met, true);
  assert.strictEqual(b.streak, 1);
  assert.strictEqual(b.nextMilestone.name, '第一次面试');
  assert.strictEqual(b.milestoneDone, 1);
  assert.strictEqual(b.milestoneTotal, 2);
  assert.strictEqual(b.overdueDays, 0);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', failures above' : ''));
