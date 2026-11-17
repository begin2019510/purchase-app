// 仪表盘纯函数测试：vm 加载 dashboard.js（不依赖浏览器 DOM 渲染）
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const dashCode = fs.readFileSync(path.join(root, 'js', 'dashboard.js'), 'utf8');

const store = {};
const sandbox = {
  console,
  Date,
  JSON,
  Math,
  String,
  Number,
  Array,
  Object,
  isFinite,
  parseInt,
  parseFloat,
  isNaN,
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout: () => {},
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  },
  document: {
    readyState: 'complete',
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, remove() {}, click() {}, textContent: '', get innerHTML() { return this.textContent; } }),
    body: { appendChild() {}, classList: { add() {}, remove() {}, contains: () => false } },
    addEventListener() {},
    activeElement: null
  },
  window: null,
  toast: () => {},
  confirm: () => true,
  esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  escAttr: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;'),
  getThisMonth: () => '2026-11',
  getBudgetPool: (m) => {
    // 夹具：11 月 totalSpend=3200（直购1200+记账2000），10 月=2000
    if (m === '2026-11') {
      return {
        totalBudget: 8000, fixedDeduction: 2000, installmentDeduction: 0,
        directPurchaseSpend: 1200, expenseSpend: 2000,
        available: 6000, totalSpend: 3200, remaining: 2800
      };
    }
    if (m === '2026-10') {
      return {
        totalBudget: 8000, fixedDeduction: 2000, installmentDeduction: 0,
        directPurchaseSpend: 800, expenseSpend: 1200,
        available: 6000, totalSpend: 2000, remaining: 4000
      };
    }
    return {
      totalBudget: 0, fixedDeduction: 0, installmentDeduction: 0,
      directPurchaseSpend: 0, expenseSpend: 0,
      available: 0, totalSpend: 0, remaining: 0
    };
  },
  expenses: [],
  orderRows: () => [],
  App: { pivot: null }
};
sandbox.window = sandbox;
sandbox.App = sandbox.App || {};

vm.createContext(sandbox);
vm.runInContext(dashCode, sandbox, { filename: 'dashboard.js' });

const D = sandbox.App.dashboard;
let failed = 0;
function ok(label, cond, extra) {
  if (cond) console.log('ok   ' + label);
  else { failed++; console.log('FAIL ' + label + (extra ? ' :: ' + extra : '')); }
}
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failed++; console.log('FAIL ' + label + ' actual=' + a + ' expected=' + e); }
  else console.log('ok   ' + label + ' = ' + a);
}

// ---- KPI ----
const k = D._kpi({
  monthSpend: 3200, prevMonthSpend: 2000,
  buy: 1200, exp: 2000, fixed: 2000,
  totalBudget: 8000, available: 6000,
  yearSpend: 15000, yearCount: 42
});
eq('monthSpend', k.monthSpend, 3200);
eq('deltaText 环比上升', k.deltaText, '↑60%');
eq('deltaGood 支出升=差', k.deltaGood, false);
eq('yearSpend', k.yearSpend, 15000);
eq('yearCount', k.yearCount, 42);
eq('buy/exp/fixed', [k.buy, k.exp, k.fixed], [1200, 2000, 2000]);
// usage = (1200+2000)/6000*100 = 53.33 → green
ok('usage green', k.usageLevel === 'green' && Math.abs(k.usagePct - 53.333) < 0.01, k.usagePct);
eq('budgetSet', k.budgetSet, true);

const k2 = D._kpi({ monthSpend: 100, prevMonthSpend: 0, totalBudget: 0, available: 0 });
eq('prev=0 新增', k2.deltaText, '新增');
eq('未设预算', [k2.budgetSet, k2.usagePct], [false, null]);

const k3 = D._kpi({ monthSpend: 0, prevMonthSpend: 0, totalBudget: 5000, available: 4000, buy: 0, exp: 0 });
eq('两皆0 持平', k3.deltaText, '持平');
eq('usage 0', k3.usagePct, 0);

const k4 = D._kpi({ monthSpend: 100, prevMonthSpend: 50, totalBudget: 5000, available: 500, buy: 400, exp: 100 });
eq('usage cap 100', k4.usagePct, 100);
eq('usage red', k4.usageLevel, 'red');

const k5 = D._kpi({ monthSpend: 100, prevMonthSpend: 200, totalBudget: 5000, available: 5000, buy: 100, exp: 0 });
eq('环比下降', k5.deltaText, '↓50%');
eq('deltaGood 支出降=好', k5.deltaGood, true);

// prevMonthStr
eq('prev 11→10', D._prevMonthStr('2026-11'), '2026-10');
eq('prev 01→12跨年', D._prevMonthStr('2026-01'), '2025-12');

// ---- mergeLayout ----
const defs = D._DEFAULT_CARDS;
eq('空→预设', D._mergeLayout(null, defs).cards.map(c => c.id), ['cat', 'trend', 'daily', 'rank']);
eq('空对象→预设', D._mergeLayout({}, defs).cards.length, 4);

const half = {
  v: 1,
  cards: [
    { id: 'trend', hidden: true, chart: '柱状', range: '今年', dim: '月份', metric: '笔数' },
    { id: 'unknown', hidden: false },
    { id: 'rank', hidden: false, chart: '环形', range: '全部', dim: '月份', metric: '金额' }
  ]
};
const merged = D._mergeLayout(half, defs);
eq('顺序按存储', merged.cards.map(c => c.id), ['trend', 'rank', 'cat', 'daily']);
const mt = merged.cards[0];
eq('trend 保留修改', [mt.chart, mt.range, mt.dim, mt.metric, mt.hidden], ['柱状', '今年', '月份', '笔数', true]);
const mr = merged.cards[1];
eq('环形锁分类', [mr.chart, mr.dim], ['环形', '分类']);
eq('未知 id 丢弃', merged.cards.some(c => c.id === 'unknown'), false);

// 坏 JSON 路径：loadLayout 在 localStorage 坏值时回预设
store['purchase_dash_layout_v1_tester'] = '{not-json';
// loadLayout 用 auth_user
store['auth_user'] = 'tester';
const lay = D._loadLayout();
ok('坏 JSON→预设', lay.cards.length === 4, JSON.stringify(lay).slice(0, 80));

// ---- filterRange / aggregate ----
const nowMs = Date.UTC(2026, 10, 17, 4, 0, 0); // 2026-11-17 12:00 北京 ≈ UTC 04:00
const events = [
  { ts: Date.UTC(2026, 10, 3), month: '2026-11', day: '2026-11-03', amount: 20, category: '餐饮', platform: '记账', source: '记账', group: '奶茶', title: '喜茶', note: '' },
  { ts: Date.UTC(2026, 10, 5), month: '2026-11', day: '2026-11-05', amount: 20, category: '餐饮', platform: '记账', source: '记账', group: '奶茶', title: '蜜雪', note: '' },
  { ts: Date.UTC(2026, 9, 20), month: '2026-10', day: '2026-10-20', amount: 100, category: '数码', platform: '淘宝', source: '采购', group: '未分组', title: '键盘', note: '' },
  { ts: Date.UTC(2026, 8, 1), month: '2026-09', day: '2026-09-01', amount: 50, category: '服装', platform: '京东', source: '采购', group: '衣服', title: 'T恤', note: '' },
  { ts: Date.UTC(2025, 11, 31), month: '2025-12', day: '2025-12-31', amount: 999, category: '其他', platform: '记账', source: '记账', group: '未分组', title: '去年', note: '' },
  { ts: nowMs + 5 * 86400000, month: '2026-12', day: '2026-12-01', amount: 777, category: '其他', platform: '采购', source: '采购', group: '未分组', title: '未来', note: '' }
];

eq('filter 本月', D._filterRange(events, '本月', nowMs).map(e => e.month), ['2026-11', '2026-11']);
eq('filter 今年 含去年排除', D._filterRange(events, '今年', nowMs).length, 5); // 含未来12月？今年内 2026-12 也是今年
// 2026-12 在今年内，所以 6-1=5?  events: 11,11,10,09,2025,12 → 2026 的有 11,11,10,09,12 = 5 yes
// 近6月 = 2026-06..2026-11（不含 12 月未来事件）
eq('filter 近6月', D._filterRange(events, '近6月', nowMs).map(e => e.month).sort(),
  ['2026-09', '2026-10', '2026-11', '2026-11']);
eq('filter 全部', D._filterRange(events, '全部', nowMs).length, 6);

const aggCat = D._aggregate(D._filterRange(events, '本月', nowMs), '分类', '金额');
eq('分类金额合计', aggCat.reduce((s, e) => s + e[1], 0), 40);
eq('餐饮排第一', aggCat[0], ['餐饮', 40]);

const aggCnt = D._aggregate(D._filterRange(events, '本月', nowMs), '分类', '笔数');
eq('笔数', aggCnt[0], ['餐饮', 2]);

const aggMon = D._aggregate(D._filterRange(events, '今年', nowMs), '月份', '金额');
eq('月份升序', aggMon.map(e => e[0]), ['9月', '10月', '11月', '12月']);
eq('月份金额', aggMon.map(e => e[1]), [50, 100, 40, 777]);

const aggDay = D._aggregate(D._filterRange(events, '本月', nowMs), '日', '金额');
eq('日标签', aggDay.map(e => e[0]), ['3', '5']);
eq('日金额', aggDay.map(e => e[1]), [20, 20]);

// 非法配置回落
eq('safe 环形+月份→分类', D._safeCard({ id: 'x', title: 't', chart: '环形', range: '本月', dim: '月份', metric: '金额', hidden: false }).dim, '分类');
eq('safe 坏图型', D._safeCard({ id: 'x', title: 't', chart: '饼', range: '怪', dim: '无', metric: '平均', hidden: false }),
  { id: 'x', title: 't', chart: '柱状', range: '本月', dim: '分类', metric: '金额', hidden: false });

// 空数据不崩
eq('空 events 聚合', D._aggregate([], '分类', '金额'), []);
eq('空 filter', D._filterRange([], '本月', nowMs), []);

// buildKpiInputs 走 stub getBudgetPool（App.pivot 为 null → 空事件）
sandbox.expenses = [
  { '类型': '支出', '金额': 20, '分类': '餐饮', '备注': '喜茶', '日期': '2026-11-03T12:00' }
];
const inputs = D._buildKpiInputs();
eq('inputs monthSpend 来自 pool', inputs.monthSpend, 3200);
eq('inputs prev 来自 pool', inputs.prevMonthSpend, 2000);

console.log('\n' + (failed ? 'FAILED: ' + failed : 'ALL PASS'));
process.exit(failed ? 1 : 0);
