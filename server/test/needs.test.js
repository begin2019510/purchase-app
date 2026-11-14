'use strict';
// 采购两级模型纯函数单测：状态机 / 口径 / 打分 / 状态映射
// 用法: node server/test/needs.test.js
const assert = require('assert');
const N = require('../src/lib/needs');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok', name); }
  catch (e) { console.error('  FAIL', name, '→', e.message); process.exitCode = 1; }
}

console.log('== 子单流转 ==');
t('合法流转', () => {
  assert.ok(N.canTransition('待下单', '已下单'));
  assert.ok(N.canTransition('已下单', '已到'));
  assert.ok(N.canTransition('已下单', '已退'));
  assert.ok(N.canTransition('已到', '已归档'));
  assert.ok(N.canTransition('已退', '已取消'));
  assert.ok(N.canTransition('待下单', '已取消'));
});
t('非法流转', () => {
  assert.ok(!N.canTransition('待下单', '已到'), '跳过已下单');
  assert.ok(!N.canTransition('已到', '已下单'), '回退');
  assert.ok(!N.canTransition('已归档', '已取消'), '终态');
  assert.ok(!N.canTransition('已退', '已归档'), '退货后不能再归档（避免退款重新计入预算）');
  assert.ok(!N.canTransition('已取消', '已下单'), '终态');
  assert.ok(!N.canTransition('待下单', '已审批'), '旧状态不再合法');
});
t('时间戳列', () => {
  assert.strictEqual(N.transitionTimeCol('已下单'), 'ordered_at');
  assert.strictEqual(N.transitionTimeCol('已到'), 'arrived_at');
  assert.strictEqual(N.transitionTimeCol('已取消'), 'archived_at');
});

console.log('== 需求流转 ==');
t('对比中→已定点→已完成', () => {
  assert.ok(N.canNeedTransition('对比中', '已定点'));
  assert.ok(N.canNeedTransition('已定点', '已完成'));
  assert.ok(N.canNeedTransition('已定点', '对比中'));
  assert.ok(N.canNeedTransition('对比中', '已取消'));
});
t('终态锁死', () => {
  assert.ok(!N.canNeedTransition('已完成', '对比中'));
  assert.ok(!N.canNeedTransition('已取消', '已定点'));
  assert.ok(!N.canNeedTransition('对比中', '已完成'), '未定点不能直接完成');
});

console.log('== 状态映射（兼容层）==');
t('旧→新', () => {
  assert.strictEqual(N.legacyToOrderStatus('待评估'), null, '待评估不建子单');
  assert.strictEqual(N.legacyToOrderStatus('待审批'), '待下单');
  assert.strictEqual(N.legacyToOrderStatus('已审批'), '待下单');
  assert.strictEqual(N.legacyToOrderStatus('已下单'), '已下单');
  assert.strictEqual(N.legacyToOrderStatus('已归档'), '已归档');
});
t('新→旧（显示）', () => {
  assert.strictEqual(N.orderToLegacyStatus(null), '待评估');
  assert.strictEqual(N.orderToLegacyStatus({ status: '待下单' }), '待审批');
  assert.strictEqual(N.orderToLegacyStatus({ status: '已到' }), '已到');
});
t('旧→需求状态', () => {
  assert.strictEqual(N.legacyToNeedStatus('待评估'), '对比中');
  assert.strictEqual(N.legacyToNeedStatus('已归档'), '已完成');
  assert.strictEqual(N.legacyToNeedStatus('已取消'), '已取消');
  assert.strictEqual(N.legacyToNeedStatus('待审批'), '已定点');
});

console.log('== 记账口径 ==');
t('ACTIVE_BUY 三态', () => {
  assert.ok(N.countsTowardBudget('已下单'));
  assert.ok(N.countsTowardBudget('已到'));
  assert.ok(N.countsTowardBudget('已归档'));
  assert.ok(!N.countsTowardBudget('待下单'));
  assert.ok(!N.countsTowardBudget('已退'));
  assert.ok(!N.countsTowardBudget('已取消'));
  assert.ok(!N.countsTowardBudget('待审批'), '旧状态不入账');
  assert.deepStrictEqual(N.ACTIVE_BUY, ['已下单', '已到', '已归档']);
});
t('金额 = price_paid × qty', () => {
  assert.strictEqual(N.orderAmount({ price_paid: 19.9, qty: 3 }), 59.7);
  assert.strictEqual(N.orderAmount({ price_paid: 0, qty: 5 }), 0);
});

console.log('== 加权总分 ==');
t('默认五维全打满分=5', () => {
  const scores = { price: 5, feature: 5, design: 5, quality: 5, service: 5 };
  assert.strictEqual(N.weightedTotal(N.DEFAULT_DIMENSIONS, scores), 5);
});
t('价格3权重得5、其余得1 → (5*3+1*2+1*1+1*2+1*1)/9', () => {
  const scores = { price: 5, feature: 1, design: 1, quality: 1, service: 1 };
  // (15+2+1+2+1)/9 = 21/9 = 2.333… → 2.33
  assert.strictEqual(N.weightedTotal(N.DEFAULT_DIMENSIONS, scores), 2.33);
});
t('未打分维度按0计', () => {
  const scores = { price: 4 }; // 4*3 + 0*6 = 12/9 = 1.33
  assert.strictEqual(N.weightedTotal(N.DEFAULT_DIMENSIONS, scores), 1.33);
});
t('空维度/垃圾输入', () => {
  assert.strictEqual(N.weightedTotal([], {}), 0);
  assert.strictEqual(N.weightedTotal(null, null), 0);
});

console.log('== 维度/打分校验 ==');
t('维度校验', () => {
  assert.ok(N.validateDimensions(null).ok);
  assert.ok(N.validateDimensions(N.DEFAULT_DIMENSIONS).ok);
  assert.ok(N.validateDimensions([{ key: 'a', label: 'A', weight: 0 }]).error, 'weight 0 拒绝');
  assert.ok(N.validateDimensions([{ key: 'a', label: 'A', weight: 10 }]).error, 'weight 10 拒绝');
  assert.ok(N.validateDimensions(new Array(21).fill({ key: 'k', label: 'L', weight: 1 })).error, '21 个拒绝');
  assert.ok(N.validateDimensions([{ key: 'a', label: 'A', weight: 1 }, { key: 'a', label: 'B', weight: 1 }]).error, '重复 key');
});
t('打分校验', () => {
  const dims = N.DEFAULT_DIMENSIONS;
  assert.ok(N.validateScores(dims, { price: 3 }).ok);
  assert.ok(N.validateScores(dims, { price: 0 }).error, '0 分拒绝');
  assert.ok(N.validateScores(dims, { price: 6 }).error, '6 分拒绝');
  assert.ok(N.validateScores(dims, { price: 3.5 }).error, '小数拒绝');
  assert.ok(N.validateScores(dims, { hacker: 3 }).error, '未知维度拒绝');
  assert.deepStrictEqual(N.validateScores(dims, { price: null }).value, {}, 'null 清空');
});

console.log('== 预算区间 ==');
t('解析', () => {
  assert.deepStrictEqual(N.parseBudgetRange('100-200'), { min: 100, max: 200 });
  assert.deepStrictEqual(N.parseBudgetRange('100~200'), { min: 100, max: 200 });
  assert.deepStrictEqual(N.parseBudgetRange('200-100'), { min: 100, max: 200 }, '倒序归正');
  assert.deepStrictEqual(N.parseBudgetRange('50'), { min: 50, max: 50 });
  assert.strictEqual(N.parseBudgetRange('随便写的'), null);
  assert.strictEqual(N.parseBudgetRange(''), null);
});
t('格式化', () => {
  assert.strictEqual(N.formatBudgetRange(100, 200), '100-200');
  assert.strictEqual(N.formatBudgetRange(null, null), '');
  assert.strictEqual(N.formatBudgetRange(50, null), '50');
});

console.log('== 合成旧形态行 ==');
t('有正式单 → 显示其状态', () => {
  const need = { id: 7, name: '香氛机', category: '家居', budget_min: 100, budget_max: 200, status: '已定点', is_quick: 0, is_virtual: 0 };
  const sup = [{ id: 3, need_id: 7, name: '小米', platform: '京东', price: 189, scores: '{"price":4}' }];
  const ord = [{ id: 9, need_id: 7, supplier_id: 3, role: 'formal', qty: 1, price_paid: 189, status: '已到', date_ms: 1730000000000, image_ref: '', installments: 0 }];
  const r = N.synthLegacyRow(need, sup, ord);
  assert.strictEqual(r.id, 'rec_7');
  assert.strictEqual(r.status, '已到');
  assert.strictEqual(r.price, 189);
  assert.strictEqual(r.platform, '京东');
  assert.strictEqual(r.budget_range, '100-200');
});
t('无正式单 → 待评估', () => {
  const need = { id: 8, name: 'X', status: '对比中', is_quick: 0, is_virtual: 0 };
  const r = N.synthLegacyRow(need, [], []);
  assert.strictEqual(r.status, '待评估');
  assert.strictEqual(r.price, 0);
});
t('待下单 → 显示待审批', () => {
  const need = { id: 8, name: 'X', status: '已定点', is_quick: 0, is_virtual: 0 };
  const sup = [{ id: 1, need_id: 8, name: 'A', platform: '拼多多', price: 30 }];
  const ord = [{ id: 2, need_id: 8, supplier_id: 1, role: 'formal', qty: 1, price_paid: 30, status: '待下单' }];
  const r = N.synthLegacyRow(need, sup, ord);
  assert.strictEqual(r.status, '待审批');
});
t('定点供应商优先于第一家', () => {
  const need = { id: 8, name: 'X', status: '已定点', selected_supplier_id: 5, is_quick: 0, is_virtual: 0 };
  const sup = [
    { id: 4, need_id: 8, name: 'A', platform: '拼多多', price: 10 },
    { id: 5, need_id: 8, name: 'B', platform: '京东', price: 20 },
  ];
  const r = N.synthLegacyRow(need, sup, []);
  assert.strictEqual(r.platform, '京东');
  assert.strictEqual(r.price, 20);
});

console.log(`\n${passed} passed${process.exitCode ? '（有失败）' : ''}`);
