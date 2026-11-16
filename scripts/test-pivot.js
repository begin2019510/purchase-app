// 聚合口径测试：不依赖浏览器 DOM，用 vm 加载 js/pivot.js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'js', 'pivot.js'), 'utf8');

// 最小浏览器桩
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
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout: () => {},
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  },
  document: {
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, setAttribute() {}, remove() {}, click() {} }),
    body: { appendChild() {} },
    activeElement: null
  },
  Blob: function () {},
  URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
  window: null
};
sandbox.window = sandbox;
sandbox.App = { utils: {} };
sandbox.toast = () => {};
sandbox.confirm = () => true;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'pivot.js' });

const P = sandbox.App.pivot;
let failed = 0;
function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.log('FAIL ' + label + '  actual=' + a + '  expected=' + e);
  } else {
    console.log('ok   ' + label + ' = ' + a);
  }
}

// ---- 固定夹具（北京时间口径）----
// 记账：支出（含奶茶两笔、固定房租、旧采购镜像应排除）
const expenses = [
  { '类型': '支出', '金额': 20, '分类': '餐饮', '备注': '喜茶', '日期': '2026-11-03T12:00' },
  { '类型': '支出', '金额': 20, '分类': '餐饮', '备注': '蜜雪冰城', '日期': '2026-11-05T18:30' },
  { '类型': '支出', '金额': 2000, '分类': '居住', '备注': '[固定] 房租', '日期': '2026-11-01T09:00' },
  { '类型': '支出', '金额': 100, '分类': '数码', '备注': '旧采购镜像', '日期': '2026-11-02T10:00' },
  { '类型': '收入', '金额': 5000, '分类': '工资', '备注': '工资', '日期': '2026-11-05T10:00' }
];
// 给旧镜像打上 [采购] 标记（模拟旧版写入）
expenses[3]['备注'] = '[采购] 旧采购镜像';

// 采购：电子 3000 分 3 期（2026-09 起，每期 1000）；衣服直接买 300
const items = [
  {
    '名称': '机械键盘', '分类': '电子', '平台': '淘宝', '状态': '已到',
    '单价': 3000, '数量': 1, '日期': Date.UTC(2026, 8, 20) + 8 * 3600000,
    '分期期数': 3, '分期金额': 1000, '分期开始月': '2026-09', '分期已还': 1
  },
  {
    '名称': 'T恤', '分类': '服装', '平台': '京东', '状态': '已到',
    '单价': 300, '数量': 1, '日期': Date.UTC(2026, 10, 2) + 8 * 3600000,
    '分期期数': 0, '分期金额': 0, '分期开始月': '', '分期已还': 0
  },
  {
    '名称': '已取消订单', '分类': '电子', '平台': '京东', '状态': '已取消',
    '单价': 999, '数量': 1, '日期': Date.UTC(2026, 10, 3) + 8 * 3600000,
    '分期期数': 0
  }
];

// 全局桩：pivot.js 通过 typeof 判断
sandbox.expenses = expenses;
sandbox.orderRows = () => {
  // 复刻 needs.js orderRows 的字段
  return items.map((n) => ({
    '商品名称': n['名称'],
    '分类': n['分类'],
    '平台': n['平台'],
    '单价': Number(n['单价']) || 0,
    '数量': Number(n['数量']) || 1,
    '状态': n['状态'],
    '日期': n['日期'],
    '备注': n['备注'] || '',
    '分期期数': n['分期期数'] || 0,
    '分期金额': n['分期金额'] || 0,
    '分期开始月': n['分期开始月'] || '',
    '分期已还': n['分期已还'] || 0
  }));
};
sandbox.isActiveBuy = (s) => ['已下单', '已到', '已归档'].indexOf(s) >= 0;
sandbox.rangeExpDayMs = (d) => {
  const s = String(d || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return 0;
  const [y, m, day] = s.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, day) - 8 * 3600000;
};
sandbox.rangeItemDayMs = (d) => {
  if (typeof d === 'number' && isFinite(d)) return d;
  const s = String(d || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return sandbox.rangeExpDayMs(s);
  const t = Date.parse(s);
  return isFinite(t) ? t : 0;
};
sandbox.getItemInstallmentAmount = (i) => {
  if (Number(i['分期金额']) > 0) return Number(i['分期金额']);
  return Math.round(((Number(i['单价']) || 0) * (Number(i['数量']) || 1)) / (Number(i['分期期数']) || 1));
};
sandbox.getItemInstallmentStartMonth = (i) => {
  const d = new Date(Number(i['日期']) + 8 * 3600000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
};

// ---- 用例 ----
P._setCfg({ range: '全部', source: '全部', row: '分类', col: '无', metric: '金额', keyword: '', from: '', to: '' });
P._setGroups([
  { id: 'g_tea', name: '奶茶', keywords: ['喜茶', '蜜雪', '蜜雪冰城', '茶百道'] },
  { id: 'g_api', name: 'API', keywords: ['API', 'Claude', 'token'] },
  { id: 'g_daily', name: '日用品', keywords: ['纸巾', '洗衣液'] },
  { id: 'g_cloth', name: '衣服', keywords: ['T恤', '衣服'] }
]);

// 1) 事件数与总额
// 期望：记账有效 4 笔（20+20+2000+? 注意 [采购] 镜像 100 被排除、收入被排除 → 20+20+2000=2040）
// 采购：T恤 300（直接） + 键盘分期 3 期×1000（2026-09/10/11，均已到或当月） = 300+3000=3300
// 总额 2040+3300=5340；事件数 3(expense 20/20/2000) + 1 + 3 = 7
let built = P._buildEvents();
eq('事件数', built.events.length, 7);
eq('总额', Math.round(built.events.reduce((s, e) => s + e.amount, 0)), 5340);

// 2) 采购事件：直接 + 分期
const purchases = built.events.filter((e) => e.source === '采购' || e.source === '分期');
eq('采购来源合计', Math.round(purchases.reduce((s, e) => s + e.amount, 0)), 3300);
const electronics = purchases.filter((e) => e.category === '电子');
eq('电子事件数(分期3)', electronics.length, 3);
eq('电子合计', Math.round(electronics.reduce((s, e) => s + e.amount, 0)), 3000);
eq('电子各期', electronics.map((e) => e.amount).sort(), [1000, 1000, 1000]);
eq('电子月份', electronics.map((e) => e.month).sort(), ['2026-09', '2026-10', '2026-11']);

// 3) 旧 [采购] 镜像与收入不计入
const mirror = built.events.filter((e) => /旧采购镜像/.test(e.title + e.note));
eq('旧采购镜像排除', mirror.length, 0);
const incomes = built.events.filter((e) => /工资/.test(e.title + e.note));
eq('收入排除', incomes.length, 0);

// 4) 固定支出标记
const rent = built.events.filter((e) => e.source === '固定');
eq('固定事件数', rent.length, 1);
eq('固定金额', rent[0] && rent[0].amount, 2000);

// 5) 关键词组
const groups = {};
built.events.forEach((e) => { groups[e.group] = (groups[e.group] || 0) + e.amount; });
eq('奶茶组', groups['奶茶'], 40);
eq('衣服组', groups['衣服'], 300);
eq('未分组含房租', groups['未分组'], 2000 + 3000); // 房租 + 键盘（机械键盘不在组里）

// 6) 来源过滤
P._setCfg({ source: '采购' });
let only = P._buildEvents();
eq('source=采购 事件数', only.events.length, 4);
eq('source=采购 合计', Math.round(only.events.reduce((s, e) => s + e.amount, 0)), 3300);
P._setCfg({ source: '固定' });
only = P._buildEvents();
eq('source=fixed 事件数', only.events.length, 1);
eq('source=fixed 合计', only.events.reduce((s, e) => s + e.amount, 0), 2000);
P._setCfg({ source: '记账' });
only = P._buildEvents();
eq('source=记账 事件数', only.events.length, 2); // 排除 [采购] 镜像、收入与固定
eq('source=记账 合计', Math.round(only.events.reduce((s, e) => s + e.amount, 0)), 40);

// 7) 关键词过滤
P._setCfg({ source: '全部', keyword: '喜茶,蜜雪' });
only = P._buildEvents();
eq('keyword 喜茶,蜜雪 事件数', only.events.length, 2);
eq('keyword 喜茶,蜜雪 合计', only.events.reduce((s, e) => s + e.amount, 0), 40);

// 8) 透视矩阵：行=商品组，列=无，指标=金额
P._setCfg({ keyword: '', row: '商品组', col: '无', metric: '金额', source: '全部' });
built = P._buildEvents();
let res = P._computePivot(built.events, P._getCfg());
const byRow = {};
res.rows.forEach((r) => { byRow[r.label] = r.amount; });
eq('行 奶茶', byRow['奶茶'], 40);
eq('行 衣服', byRow['衣服'], 300);
eq('行 未分组', byRow['未分组'], 5000);
eq('grand', res.grand.amount, 5340);
eq('grand.count', res.grand.count, 7);

// 9) 指标：笔数 / 平均
P._setCfg({ row: '分类', col: '无', metric: '笔数' });
res = P._computePivot(P._buildEvents().events, P._getCfg());
const catCount = {};
res.rows.forEach((r) => { catCount[r.label] = r.value; });
eq('分类 餐饮 笔数', catCount['餐饮'], 2);
eq('分类 电子 笔数', catCount['电子'], 3);
eq('笔数合计(grand.count)', res.grand.count, 7);

P._setCfg({ metric: '平均' });
res = P._computePivot(P._buildEvents().events, P._getCfg());
const catAvg = {};
res.rows.forEach((r) => { catAvg[r.label] = Math.round(r.value * 100) / 100; });
eq('分类 电子 平均', catAvg['电子'], 1000);
eq('分类 餐饮 平均', catAvg['餐饮'], 20);

// 10) 列=月份
P._setCfg({ row: '分类', col: '月份', metric: '金额' });
res = P._computePivot(P._buildEvents().events, P._getCfg());
eq('列含月份', res.cols.includes('2026-09') && res.cols.includes('2026-11'), true);
const elec = res.rows.find((r) => r.label === '电子');
eq('电子×2026-09', elec.cells['2026-09'].amount, 1000);
eq('电子×合计', elec.amount, 3000);

// 11) 范围：自定义（只含 11 月）
P._setCfg({ col: '无', row: '分类', metric: '金额', range: '自定义', from: '2026-11-01', to: '2026-11-30' });
only = P._buildEvents();
const novMonths = new Set(only.events.map((e) => e.month));
eq('自定义仅11月', [...novMonths], ['2026-11']);
eq('自定义事件数', only.events.length, 5); // 2奶茶 + 房租 + 键盘11期 + T恤

// 12) dimValue / 归组工具
eq('dim 来源', P._dimValue({ source: '分期' }, '来源'), '分期');
eq('matchGroup', P._matchGroup({ category: '餐饮', title: '蜜雪冰城 奶昔', note: '', platform: '' }, P._getGroups()), '奶茶');
eq('normalizeKeywords', P._normalizeKeywords('喜茶， 蜜雪,蜜雪, ,茶百道'), ['喜茶', '蜜雪', '茶百道']);

console.log('\n' + (failed ? ('FAILED: ' + failed) : 'ALL PASS'));
process.exit(failed ? 1 : 0);
