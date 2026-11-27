'use strict';
// 预算历史视图纯前端测试：不启动浏览器，只在 vm 里加载 js/budget.js。
// 用法: node server/test/budget-ui.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed++;
    console.log('  ok', name);
  });
}
function plain(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function monthLabel(m) {
  const p = m.split('-');
  return p[0] + '年' + Number(p[1]) + '月';
}

const doc = {
  '2026-06': 600,
  '2026-10': {
    total: 3200,
    perWeek: 0,
    weeks: {},
    additions: [
      { id: 'a1', amt: 500, src: '国庆特别资金', note: '', ts: 1792312728000 },
      { id: 'a2', amt: 200, src: '生日月特别资金', note: '', ts: 1792595552000 },
      { id: 'a3', amt: 500, src: '大连旅游特别资金', note: '', ts: 1793031114000 },
    ],
  },
  '2026-11': { total: 2000, perWeek: 0, weeks: {}, additions: [] },
  'bad-key': { total: 999 },
};

const els = {};
const sandbox = {
  console,
  Date,
  Math,
  Number,
  String,
  Array,
  Object,
  JSON,
  RegExp,
  parseInt,
  parseFloat,
  isNaN,
  App: { budget: {} },
  getBudgets: () => doc,
  getThisMonth: () => '2026-11',
  monthLabel,
  esc: plain,
  getBudgetNum: (m) => {
    const v = doc[m];
    return typeof v === 'number' ? v : (v && typeof v === 'object' ? (v.total || 0) : 0);
  },
  document: {
    getElementById: (id) => {
      if (!els[id]) els[id] = { innerHTML: '', classList: { add() {}, remove() {} } };
      return els[id];
    },
  },
  alert: () => {},
  confirm: () => true,
  toast: () => {},
  render: () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/budget.js'), 'utf8'), sandbox);

(async () => {
  await t('北京时间格式化到秒', () => {
    assert.strictEqual(sandbox.App.budget.budgetBjDateTime(1792312728000), '2026-10-18 16:38:48');
    assert.strictEqual(sandbox.App.budget.budgetBjDateTime(1792595552000), '2026-10-21 23:12:32');
    assert.strictEqual(sandbox.App.budget.budgetBjDateTime(1793031114000), '2026-10-27 00:11:54');
    assert.strictEqual(sandbox.App.budget.budgetBjDateTime(null), '时间未记录');
  });

  await t('历史月份按倒序汇总，基础预算 = 总额 - 追加', () => {
    const rows = sandbox.App.budget.budgetHistoryRows();
    assert.strictEqual(Array.from(rows, r => r.month).join(','), '2026-11,2026-10,2026-06');
    const oct = rows.find(r => r.month === '2026-10');
    assert.strictEqual(oct.total, 3200);
    assert.strictEqual(oct.additionTotal, 1200);
    assert.strictEqual(oct.base, 2000);
    assert.strictEqual(oct.additions.length, 3);
    assert.strictEqual(oct.legacy, false);
    const jun = rows.find(r => r.month === '2026-06');
    assert.strictEqual(jun.total, 600);
    assert.strictEqual(jun.base, 600);
    assert.strictEqual(jun.legacy, true);
  });

  await t('历史视图包含 10 月构成、精确时间和只读标识', () => {
    sandbox.App.budget.renderBudgetHistory();
    const html = els.budgetHistoryList.innerHTML;
    assert.ok(html.includes('2026年10月'));
    assert.ok(html.includes('¥3200'));
    assert.ok(html.includes('基础预算'));
    assert.ok(html.includes('¥2000'));
    assert.ok(html.includes('历史只读'));
    assert.ok(html.includes('本月可编辑'));
    assert.ok(html.includes('国庆特别资金'));
    assert.ok(html.includes('生日月特别资金'));
    assert.ok(html.includes('大连旅游特别资金'));
    assert.ok(html.includes('2026-10-18 16:38:48'));
    assert.ok(html.includes('2026-10-21 23:12:32'));
    assert.ok(html.includes('2026-10-27 00:11:54'));
    assert.ok(html.includes('早期记录为纯数字'));
  });

  await t('追加备注中的 HTML 被转义', () => {
    doc['2026-10'].additions[0].note = '<img src=x onerror=alert(1)>';
    sandbox.App.budget.renderBudgetHistory();
    const html = els.budgetHistoryList.innerHTML;
    assert.ok(!html.includes('<img src=x'), '不得注入原始标签');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
    doc['2026-10'].additions[0].note = '';
  });

  await t('追加合计超过总额时显示异常提示', () => {
    doc['2026-11'] = {
      total: 100,
      additions: [{ id: 'x', amt: 300, src: '异常', note: '', ts: 1793031114000 }],
    };
    sandbox.App.budget.renderBudgetHistory();
    const html = els.budgetHistoryList.innerHTML;
    assert.ok(html.includes('追加合计超过总预算'));
    doc['2026-11'] = { total: 2000, perWeek: 0, weeks: {}, additions: [] };
  });

  console.log(`\n${passed} passed`);
})().catch(e => {
  console.error('FAIL', e && e.stack || e);
  process.exitCode = 1;
});
