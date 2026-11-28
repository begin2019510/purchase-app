// v3.2.5 特殊预算前端冒烟测试（单实例 headless Chromium，stub API，不联网、不写生产）
// 在 v3.2.4 39 项基础上新增：试运行监控卡（19 项检查、年度/月度/对账/缺失快照）、非管理员 403 降级、版本 3.2.5。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/root/.bun/install/cache/playwright@1.61.1@@registry.npmmirror.com@@@1');

const ROOT = '/root/purchase-app';
const MIME = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8' };
const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/special-budget.css"></head><body>
<script src="/js/utils.js"></script>
<script src="/js/auth.js"></script>
<script src="/js/needs.js"></script>
<script src="/js/special-budget.js"></script>
<script>
localStorage.setItem('auth_token','smoke-token');
needsList = [{ id:'rec_1', '名称':'测试需求', '分类':'其他', '状态':'已定点', orders:[
  { id:'rec_11', needId:'rec_1', role:'formal', supplierId:'rec_2', '数量':1, '实付':300, '状态':'已下单','特殊预算':'1','特殊审批ID':'rec_9' },
  { id:'rec_12', needId:'rec_1', role:'formal', supplierId:'rec_2', '数量':1, '实付':200, '状态':'已下单','特殊预算':'','特殊审批ID':'' }
]}];
openSpecialBudget();
</script></body></html>`;

const CONFIG = { year: 2026, annual_cap: 1000, monthly_regular_cap: 800, saturday_rate: 0.1, saturday_cap: 100, large_threshold: 800, cross_year_allowed: 0, rule_version: '2026-v1', effective_from: '2026-12-01 00:00:00', effective_to: null };
const SUMMARY = { annual_cap: 1000, annual_committed: 300, annual_paid: 300, annual_refunded: 0, annual_released: 0, annual_remaining: 700, monthly_regular_cap: 800, monthly_regular_approved: 0, monthly_regular_available: 800, monthly_additional_approved: 0, monthly_installment_due: 250, monthly_cash: 250, future_commitments: [], approvals: { pending: 1, approved: 1 } };
const APPROVALS = [
  { id: 8, approval_no: 'SB-LARGE', username: 'smoke', type: 'large', purpose: '大额测试', requested_amount: 1200, approved_amount: null, status: 'pending', rule_version: '2026-v1', applied_at: '2026-12-01 09:00', approved_at: null, expires_at: '2026-12-31 23:59:59', second_confirmed_by: null, second_confirmed_at: null, parent_id: null, note: '', installments: 12, first_year: 2026, first_month: 12, created_at: '2026-12-01 09:00', updated_at: '2026-12-01 09:00' },
  { id: 9, approval_no: 'SB-OK', username: 'smoke', type: 'normal', purpose: '普通审批', requested_amount: 500, approved_amount: 500, status: 'approved', rule_version: '2026-v1', applied_at: '2026-12-01 09:10', approved_at: '2026-12-01 09:12', expires_at: '2026-12-31 23:59:59', second_confirmed_by: null, second_confirmed_at: null, parent_id: null, note: '', installments: 1, first_year: 2026, first_month: 12, created_at: '2026-12-01 09:10', updated_at: '2026-12-01 09:12' },
];
const DETAIL = {
  ok: true, approval: APPROVALS[1],
  schedules: [
    { id: 901, approval_id: 9, order_id: 11, seq: 1, due_date: '2026-12-31', year: 2026, month: 12, amount: 250, status: 'paid', paid_at: '2026-12-02 10:00', refunded_at: null, refund_amount: 0 },
    { id: 902, approval_id: 9, order_id: null, seq: 2, due_date: '2026-12-31', year: 2026, month: 12, amount: 250, status: 'planned', paid_at: null, refunded_at: null, refund_amount: 0 },
  ],
  links: [{ id: 91, approval_id: 9, order_id: 11, link_type: 'order', linked_amount: 300, status: 'active', linked_at: '2026-12-02 10:05', released_at: null }],
  calculation: { rule_version: '2026-v1', annual_cap: 1000, annual_committed: 300, annual_remaining: 700, schedule_total: 500, installments: 2, note: 'stub' },
};

function mkMonths() {
  const out = [];
  for (let m = 1; m <= 12; m++) out.push({
    month: m, applied_count: 0, applied_amount: 0, approved_count: 0, approved_amount: 0,
    paid_count: 0, paid_amount: 0, refund_count: 0, refunded_amount: 0,
    release_count: 0, released_amount: 0, net_cash: 0,
  });
  out[11] = Object.assign({}, out[11], { applied_count: 1, applied_amount: 300, approved_count: 1, approved_amount: 300, paid_count: 1, paid_amount: 250, refund_count: 1, refunded_amount: 50, net_cash: 200 });
  return out;
}
const LEDGER = {
  ok: true, year: 2026, month: 12, as_of: '2026-12-03 10:00', scope: 'self', readonly: true,
  permissions: { read: true, write: false, scope: 'self' },
  config: CONFIG, summary: SUMMARY,
  annual: { annual_cap: 1000, schedule_total: 300, annual_paid: 250, annual_refunded: 50, annual_released: 0, annual_committed: 250, annual_remaining: 750 },
  monthly: mkMonths(),
  schedule_years: [{ year: 2026, count: 1, schedule_total: 300, paid_amount: 250, refunded_amount: 50, released_amount: 0, planned_amount: 50, committed: 250 }],
  future_commitments: [], event_count: 5,
  approvals: [{ id: 9, approval_no: 'SB-OK', type: 'normal', type_label: '普通申请', status: 'approved', status_label: '已批准', purpose: '普通审批', requested_amount: 300, approved_amount: 300, schedule_total: 300, paid_amount: 250, refunded_amount: 50, released_amount: 0, planned_amount: 50, event_count: 5 }],
  formulas: [
    { key: 'annual_committed', label: '年度已占用', formula: '计划总额 − 已释放 − 已退款', values: { schedule_total: 300, annual_released: 0, annual_refunded: 50 }, result: 250 },
    { key: 'annual_remaining', label: '年度剩余', formula: '年度上限 − 年度已占用', values: { annual_cap: 1000, annual_committed: 250 }, result: 750 },
    { key: 'monthly_net_cash', label: '月度特殊净现金流', formula: '当月付款 − 当月退款', values: { paid_amount: 250, refunded_amount: 50 }, result: 200 },
    { key: 'monthly_regular_available', label: '本月常规可用', formula: 'max(0, 月度常规上限 − 本月普通申请已批)', values: { monthly_regular_cap: 800, monthly_regular_approved: 0 }, result: 800 },
  ],
  reconciliation: { reconciled: true, difference: 0, checks: [{ name: 'pay_events_vs_schedules', expected: 250, actual: 250, difference: 0 }], cash_flow: {} },
  fingerprint: 'a'.repeat(64), calculation: {},
};
const TIMELINE = {
  ok: true, year: 2026, month: null, as_of: '2026-12-03 10:00', scope: 'self', readonly: true,
  permissions: { read: true, write: false, scope: 'self' },
  events: [
    { id: 3, approval_id: 9, event_type: 'refund', event_label: '退款', summary_text: '退款 50.00 元', amount: 50, actor: 'smoke', at: '2026-12-02 11:00', ip: '127.0.0.1', reason: '部分退款', before: { status: 'paid' }, after: { status: 'refunded' }, rule_version: '2026-v1', approval_no: 'SB-OK', purpose: '普通审批' },
    { id: 2, approval_id: 9, event_type: 'pay', event_label: '付款', summary_text: '付款 250.00 元', amount: 250, actor: 'smoke', at: '2026-12-02 10:00', ip: null, reason: null, before: null, after: { status: 'paid' }, rule_version: '2026-v1', approval_no: 'SB-OK', purpose: '普通审批' },
  ],
  total: 2, limit: 200, offset: 0, has_more: false,
  config_history: [{ rule_version: '2026-v1', annual_cap: 1000, changed_by: 'seed', created_at: '2026-11-01 00:00:00', change_reason: '初始' }],
  config_history_readonly: true,
};
const SNAPSHOTS = {
  ok: true, year: 2026, scope: 'self', readonly: true,
  permissions: { read: true, write: false, scope: 'self' },
  snapshots: [{ year: 2026, month: 12, annual_cap: 1000, annual_committed: 250, annual_remaining: 750, monthly_cash: 200, generated_at: '2026-12-03 10:00', fingerprint: 'b'.repeat(64) }],
  expected_months: [12], missing_months: [], config_history: TIMELINE.config_history,
};

const MON_LABELS = {
  config_effective: '配置已生效', annual_cap: '年度上限未超', monthly_cap: '月度常规 800 未超',
  saturday_cap: '周六 10% 未超', additional_window: '周六追加均在周六申请', reconciliation: '台账对账差异为 0',
  audit_pay: '付款有审计且金额一致', audit_refund: '退款有审计且金额一致', audit_release: '释放有审计且金额一致',
  audit_approve: '批准有审计事件', audit_link: '关联有审计事件', link_amount: '关联金额 = 采购单金额',
  order_consistency: '特殊采购单关联一致', config_audit: '配置修改有审计', event_orphans: '业务事件均挂审批单',
  snapshot_coverage: '月度快照齐全', overdue: '无逾期未处理分期', stale_pending: '无超过 48h 的待审批',
  unlinked_approved: '已批准单已及时关联',
};
const MONITOR = {
  ok: true, as_of: '2026-12-03 10:00', year: 2026, month: 12, scope: 'global', readonly: true, verdict: 'WARN',
  config: CONFIG,
  summary: {
    annual_cap: 1000, annual_committed: 300, annual_paid: 250, annual_refunded: 50, annual_released: 0,
    annual_remaining: 700, monthly_regular_cap: 800, monthly_regular_approved: 300, monthly_regular_available: 500,
    monthly_additional_approved: 100, monthly_installment_due: 250, monthly_cash: 200, future_commitments: [],
  },
  counts: {
    approvals: 2, pending: 1, approved: 1, schedules: 2, events: 5, due_month_count: 1, due_month_amount: 250,
    overdue_count: 0, overdue_amount: 0, stale_pending: 0, unlinked_approved: 0, missing_snapshots: 1,
    special_orders_month: 1, special_amount_month: 300, general_orders_month: 0, general_amount_month: 0,
  },
  checks: Object.keys(MON_LABELS).map(k => ({
    key: k, label: MON_LABELS[k], status: k === 'snapshot_coverage' ? 'warn' : 'pass',
    expected: 0, actual: 0, difference: 0, detail: null,
  })),
  reconciliation: { difference: 0, reconciled: true, checks: [] },
  snapshots: { expected_months: [12], present_months: [], missing_months: [12] },
  future_commitments: [], generated_at: '2026-12-03 10:00',
};

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok', name); }
  else { fail++; console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__smoke') { res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }); return res.end(HARNESS); }
  const p = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({
  headless: true,
  executablePath: '/root/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const calls = [];
let dialogAnswers = [];

async function newPage(isoTime, opts) {
  const monitorMode = (opts && opts.monitor) || 'ok';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await ctx.newPage();
  if (isoTime) await page.clock.install({ time: new Date(isoTime) });
  page.on('dialog', async d => {
    if (d.type() === 'prompt') { const a = dialogAnswers.shift(); await d.accept(a === undefined ? '' : a); }
    else await d.accept();
  });
  await page.route('**/api/**', async route => {
    const req = route.request();
    const u = new URL(req.url());
    const body = req.postData() || '';
    calls.push({ method: req.method(), path: u.pathname + u.search, headers: req.headers(), body });
    const send = (status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
    if (u.pathname === '/api/special-budget/summary') return send(200, { ok: true, year: 2026, month: 12, as_of: '2026-12-01 10:00', config: CONFIG, summary: SUMMARY, calculation: { rule_version: '2026-v1' } });
    if (u.pathname === '/api/special-budget/ledger') return send(200, LEDGER);
    if (u.pathname === '/api/special-budget/timeline') return send(200, TIMELINE);
    if (u.pathname === '/api/special-budget/snapshots' && req.method() === 'GET') return send(200, SNAPSHOTS);
    if (u.pathname === '/api/special-budget/monitor') {
      if (monitorMode === 'forbidden') return send(403, { error: 'FORBIDDEN', message: '仅管理员可查看试运行监控' });
      return send(200, MONITOR);
    }
    if (u.pathname === '/api/special-budget/snapshots' && req.method() === 'POST') {
      const b = JSON.parse(body || '{}');
      return send(200, { ok: true, snapshot: Object.assign({}, SNAPSHOTS.snapshots[0], { month: b.month, fingerprint: 'c'.repeat(64) }) });
    }
    if (u.pathname === '/api/special-budget/export') {
      const kind = u.searchParams.get('type') || 'ledger';
      const csv = kind === 'audit'
        ? '﻿特殊预算审计时间线,2026 年\r\n时间,事件,金额\r\n2026-12-02 11:00,退款,50.00\r\n'
        : '﻿特殊预算台账,2026 年\r\n审计指纹,' + LEDGER.fingerprint + '\r\n月度台账\r\n2026-12,,250.00\r\n';
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="special-budget-${kind}-2026.csv"`,
        },
        body: csv,
      });
    }
    if (u.pathname === '/api/special-budget/config' && req.method() === 'GET') return send(200, { ok: true, year: 2026, config: CONFIG, history: [Object.assign({}, CONFIG, { changed_by: 'seed', change_reason: '初始', created_at: '2026-11-01 00:00' })] });
    if (u.pathname === '/api/special-budget/config' && req.method() === 'PUT') return send(200, { ok: true, year: 2026, config: Object.assign({}, CONFIG, { annual_cap: 5000, saturday_cap: 500, rule_version: '2026-v2' }), history: [], calculation: { floor: 300 } });
    if (u.pathname === '/api/special-budget/approvals' && req.method() === 'GET') return send(200, { ok: true, year: 2026, month: 12, status: null, approvals: APPROVALS });
    if (u.pathname === '/api/special-budget/approvals' && req.method() === 'POST') {
      const b = JSON.parse(body || '{}');
      return send(201, { ok: true, approval: Object.assign({}, APPROVALS[0], { id: 20, approval_no: 'SB-NEW', type: b.type, requested_amount: b.amount, purpose: b.purpose, status: 'pending', installments: b.installments || 1 }), calculation: {} });
    }
    if (u.pathname === '/api/special-budget/approvals/8/approve') return send(200, { ok: true, approval: Object.assign({}, APPROVALS[0], { status: 'approved', approved_amount: 1200 }), schedules: [], calculation: {}, second_confirmed: true });
    if (u.pathname === '/api/special-budget/approvals/9/link-order') return send(200, { ok: true, approval: APPROVALS[1], link: { id: 92, order_id: 12, linked_amount: 200, status: 'active' }, approved_amount: 500, linked_total: 500, remaining: 0 });
    if (u.pathname === '/api/special-budget/approvals/9') return send(200, DETAIL);
    if (u.pathname.startsWith('/api/special-budget/schedules/') && u.pathname.endsWith('/pay')) return send(200, { ok: true, schedule: DETAIL.schedules[0], approval: APPROVALS[1], order: null });
    if (u.pathname.startsWith('/api/special-budget/orders/') && u.pathname.endsWith('/refund')) return send(200, { ok: true, order: {}, approval: APPROVALS[1], refund_amount: 250, cumulative_refund: 250, allocations: [], released_schedules: 0, released_future: true });
    if (u.pathname === '/api/needs') return send(200, [{ id: 'rec_1', '名称': '测试需求', '分类': '其他', '状态': '已定点', suppliers: [], orders: [
      { id: 'rec_11', needId: 'rec_1', role: 'formal', supplierId: 'rec_2', '数量': 1, '实付': 300, '状态': '已下单', '特殊预算': '1', '特殊审批ID': 'rec_9' },
      { id: 'rec_12', needId: 'rec_1', role: 'formal', supplierId: 'rec_2', '数量': 1, '实付': 200, '状态': '已下单', '特殊预算': '', '特殊审批ID': '' },
    ] }]);
    if (u.pathname === '/api/items') return send(200, []);
    return send(404, { error: 'not_found' });
  });
  await page.goto(BASE + '/__smoke', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#sbOverlay.active', { timeout: 10000 });
  return page;
}

try {
  // ---------- 1. 试运行前：窗口外不能提交 ----------
  let page = await newPage('2026-11-28T10:00:00+08:00');
  await page.waitForSelector('.sb-hero-amount');
  ok('前端版本 3.2.5', (await page.evaluate(() => (typeof APP_VERSION !== 'undefined' ? APP_VERSION : null))) === '3.2.5');
  ok('概览渲染年度剩余 ¥700.00', (await page.textContent('.sb-hero-amount')).includes('¥700.00'));
  await page.locator('.sb-tab', { hasText: '申请' }).click();
  ok('试运行前申请按钮禁用', await page.locator('button', { hasText: '提交申请' }).isDisabled());
  const applyHtml = await page.textContent('#sbBody');
  ok('试运行前提示窗口原因', applyHtml.includes('试运行自 2026-12-01') && applyHtml.includes('当前不能提交'));

  const staticChecks = await page.evaluate(() => {
    const sp = needsList[0].orders[0];
    const general = needsList[0].orders[1];
    const card = buildOrderCard(needsList[0], sp, [], true);
    const normalCard = buildOrderCard(needsList[0], Object.assign({}, general, { '状态': '待下单' }), [], true);
    return {
      rows: orderRows().length,
      needSpend: needSpend(needsList[0]),
      cardHasBadge: card.includes('🧾 特殊预算'),
      cardHasEdit: card.includes('保存修改'),
      cardHasRefund: card.includes('退货'),
      cardHasApprovalLink: card.includes('openSpecialBudget('),
      normalHasEdit: normalCard.includes('保存修改'),
    };
  });
  ok('统计口径排除特殊单：orderRows=1', staticChecks.rows === 1, JSON.stringify(staticChecks));
  ok('需求入账排除特殊单：needSpend=200', staticChecks.needSpend === 200, JSON.stringify(staticChecks));
  ok('采购卡片显示特殊标识', staticChecks.cardHasBadge);
  ok('特殊单锁定金额编辑', staticChecks.cardHasEdit === false);
  ok('特殊单隐藏退货/取消', staticChecks.cardHasRefund === false);
  ok('特殊单提供审批详情入口', staticChecks.cardHasApprovalLink === true);
  ok('普通单仍可编辑', staticChecks.normalHasEdit === true);

  // ---------- 1b. v3.2.4 台账（只读 / 口径 / 指纹 / 导出） ----------
  await page.locator('.sb-tab', { hasText: '台账' }).click();
  await page.waitForSelector('.sb-readonly');
  const ledgerText = await page.textContent('#sbBody');
  const ledgerHtml = await page.innerHTML('#sbBody');
  ok('台账标记只读与口径', ledgerText.includes('只读台账') && ledgerText.includes('本人口径'));
  ok('台账显示审计指纹', ledgerText.includes('审计指纹') && ledgerText.includes('a'.repeat(64)));
  ok('台账月度表含 2026-12 与净现金流', ledgerText.includes('2026-12') && ledgerText.includes('净现金流'));
  ok('台账年度指标 = 占用 250 / 剩余 750', ledgerText.includes('¥250.00') && ledgerText.includes('¥750.00') && ledgerText.includes('使用率 25.0%'));
  ok('台账展示计算公式而非黑盒', ledgerText.includes('计划总额 − 已释放 − 已退款') && ledgerText.includes('年度上限 − 年度已占用'));
  ok('台账审批追溯含 SB-OK 与详情入口', ledgerText.includes('SB-OK') && ledgerHtml.includes('sbOpenApproval(9)'), ledgerHtml.slice(0, 600));
  ok('台账页没有金额修改按钮', !ledgerText.includes('保存年度上限'));
  await page.locator('#sbBody button', { hasText: '导出台账 CSV' }).click();
  await page.waitForTimeout(400);
  ok('台账导出发起 CSV 请求', calls.some(c => c.path.startsWith('/api/special-budget/export') && c.path.includes('type=ledger')));

  // ---------- 1c. v3.2.4 审计（快照 / 时间线 / 配置历史） ----------
  await page.locator('.sb-tab', { hasText: '审计' }).click();
  await page.waitForFunction(() => document.querySelector('#sbBody').textContent.includes('月度快照'), null, { timeout: 10000 });
  const auditText = await page.textContent('#sbBody');
  ok('审计页只读提示', auditText.includes('审计只读') && auditText.includes('不可在此页面修改任何金额'));
  ok('审计快照显示 12 月与指纹', auditText.includes('2026-12') && auditText.includes('bbbbbbbbbbbb'));
  ok('审计时间线含付款/退款事件', auditText.includes('事件时间线') && auditText.includes('退款') && auditText.includes('付款') && auditText.includes('SB-OK'));
  ok('审计显示配置变更历史（只读）', auditText.includes('配置变更历史（只读）') && auditText.includes('2026-v1'));
  ok('审计页没有写操作按钮',
    (await page.locator('#sbBody button', { hasText: '保存' }).count()) === 0 &&
    (await page.locator('#sbBody button', { hasText: '批准' }).count()) === 0 &&
    (await page.locator('#sbBody button', { hasText: '驳回' }).count()) === 0);

  // ---------- 1d. v3.2.5 试运行监控（管理员只读） ----------
  ok('监控卡出现且为 WARN', auditText.includes('试运行监控（管理员只读）') && auditText.includes('WARN'));
  ok('监控卡显示年度占用/剩余', auditText.includes('年度占用') && auditText.includes('¥300.00') && auditText.includes('¥700.00'));
  ok('监控卡显示月度 800 / 净现金 / 对账差异',
    auditText.includes('本月常规 800') && auditText.includes('本月净现金') && auditText.includes('对账差异'));
  ok('监控卡 19 项检查渲染', (await page.locator('.sb-monitor-pill').count()) === 19,
    String(await page.locator('.sb-monitor-pill').count()));
  ok('监控卡标出需关注项与缺失快照',
    auditText.includes('需关注') && auditText.includes('月度快照齐全') && auditText.includes('缺失快照') && auditText.includes('1 个'));
  const monCall = calls.find(c => c.path.startsWith('/api/special-budget/monitor'));
  ok('监控请求带 year/month', !!monCall && monCall.path.includes('year=2026') && monCall.path.includes('month=12'),
    JSON.stringify(monCall && monCall.path));
  ok('监控卡无修改按钮', !auditText.includes('保存年度上限'));

  await page.locator('#sbBody button', { hasText: '生成/刷新快照' }).click();
  await page.waitForTimeout(400);
  const snapCall = calls.find(c => c.path === '/api/special-budget/snapshots' && c.method === 'POST');
  ok('生成快照带幂等键与月份', !!snapCall && (snapCall.headers['idempotency-key'] || '').length >= 8 &&
    JSON.parse(snapCall.body).month === 12, JSON.stringify(snapCall && { b: snapCall.body, k: snapCall.headers['idempotency-key'] }));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.sb-tab', { hasText: '台账' }).click();
  await page.waitForSelector('.sb-readonly');
  const desk = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, iw: window.innerWidth,
    table: !!document.querySelector('.sb-body .sb-table'),
  }));
  ok('桌面 1280 台账无横向溢出且表格可见', desk.table && desk.sw <= desk.iw + 1, JSON.stringify(desk));
  await page.context().close();

  // ---------- 1e. 非管理员：监控不可见 ----------
  page = await newPage('2026-12-03T10:00:00+08:00', { monitor: 'forbidden' });
  await page.locator('.sb-tab', { hasText: '审计' }).click();
  await page.waitForFunction(() => document.querySelector('#sbBody').textContent.includes('仅管理员'), null, { timeout: 10000 });
  const forbidText = await page.textContent('#sbBody');
  ok('非管理员审计页提示监控仅管理员可见', forbidText.includes('仅管理员可查看全局限额监控') &&
    (await page.locator('.sb-monitor').count()) === 0);
  ok('非管理员仍可看本人审计时间线', forbidText.includes('事件时间线'));
  await page.context().close();

  // ---------- 2. 试运行日：申请校验 / 审批二次确认 / 付款 / 关联 / 退款 / 年度设置预览 ----------
  calls.length = 0;
  page = await newPage('2026-12-01T10:00:00+08:00');
  await page.waitForSelector('.sb-hero-amount');
  await page.locator('.sb-tab', { hasText: '申请' }).click();
  ok('窗口内申请按钮可用', !(await page.locator('button', { hasText: '提交申请' }).isDisabled()));

  await page.fill('#sbAmount', '900');
  await page.fill('#sbPurpose', '洗衣机');
  ok('超 800 实时提示', (await page.textContent('#sbPreview')).includes('超过 800'));
  await page.locator('button', { hasText: '提交申请' }).click();
  ok('超 800 前端拦截', (await page.textContent('#sbBody')).includes('超过 800') && !calls.some(c => c.path === '/api/special-budget/approvals' && c.method === 'POST'));

  await page.fill('#sbAmount', '750');
  await page.locator('button', { hasText: '提交申请' }).click();
  ok('超年度剩余前端拦截', (await page.textContent('#sbBody')).includes('超出年度剩余'));

  await page.fill('#sbAmount', '300');
  await page.locator('button', { hasText: '提交申请' }).click();
  await page.waitForTimeout(300);
  const sub = calls.find(c => c.path === '/api/special-budget/approvals' && c.method === 'POST');
  ok('窗口内可提交并带幂等键', !!sub && (sub.headers['idempotency-key'] || '').length >= 8 && JSON.parse(sub.body).amount === 300, JSON.stringify(sub && { k: sub.headers['idempotency-key'], b: sub.body }));

  // 大额审批：同一账号二次确认
  dialogAnswers = ['1200', '12', ''];
  await page.locator('.sb-approval[data-approval="8"] button', { hasText: '批准' }).click();
  await page.waitForTimeout(400);
  const appr = calls.find(c => c.path === '/api/special-budget/approvals/8/approve');
  ok('大额批准带 secondConfirm', !!appr && JSON.parse(appr.body).secondConfirm === true && JSON.parse(appr.body).installments === 12, JSON.stringify(appr && appr.body));

  // 详情：付款（携带已关联采购单）/ 关联 / 退款
  await page.evaluate(() => sbOpenApproval(9));
  await page.waitForSelector('#sbDetailOverlay.active');
  const detailText = await page.textContent('#sbDetail');
  ok('详情展示分期与关联信息', detailText.includes('分期计划') && detailText.includes('已关联 ¥300.00'));
  ok('详情计算过程可读且可展开原始 JSON', detailText.includes('审批时计算') &&
    detailText.includes('年度上限') && detailText.includes('原始计算 JSON'));

  await page.locator('#sbDetail .sb-sched-btn', { hasText: '付款' }).first().click();
  await page.waitForTimeout(300);
  const pay = calls.find(c => c.path === '/api/special-budget/schedules/902/pay');
  ok('付款请求带幂等键与关联采购单', !!pay && JSON.parse(pay.body).orderId === 'rec_11' && (pay.headers['idempotency-key'] || '').length >= 8, JSON.stringify(pay && { b: pay.body, k: pay.headers['idempotency-key'] }));

  await page.locator('#sbDetail button', { hasText: '关联采购单' }).click();
  await page.waitForSelector('#sbLinkSelect');
  await page.selectOption('#sbLinkSelect', 'rec_12');
  await page.locator('#sbDetail button', { hasText: '确认关联' }).click();
  await page.waitForTimeout(300);
  const link = calls.find(c => c.path === '/api/special-budget/approvals/9/link-order');
  ok('关联采购单传 rec_ 订单 ID', !!link && JSON.parse(link.body).orderId === 'rec_12', JSON.stringify(link && link.body));

  dialogAnswers = ['250', '测试退款'];
  await page.locator('#sbDetail button', { hasText: '退款' }).click();
  await page.waitForTimeout(300);
  const refund = calls.find(c => c.path === '/api/special-budget/orders/11/refund');
  ok('退款带金额/原因/释放选项', !!refund && JSON.parse(refund.body).amount === 250 && JSON.parse(refund.body).reason === '测试退款' && JSON.parse(refund.body).releaseFuture === true, JSON.stringify(refund && refund.body));

  // 年度设置实时预览 + 二次确认
  await page.evaluate(() => { sbCloseDetail(); sbSetTab('settings'); });
  await page.waitForSelector('#sbCfgCap');
  await page.fill('#sbCfgCap', '5000');
  const prev = await page.textContent('#sbCfgPreviewBox');
  ok('年度上限实时预览周六上限', prev.includes('¥500.00'), prev);
  ok('年度上限实时预览调整后剩余', prev.includes('¥4700.00'), prev);
  dialogAnswers = ['测试调整'];
  await page.locator('button', { hasText: '保存年度上限' }).click();
  await page.waitForTimeout(400);
  const cfgCall = calls.find(c => c.path === '/api/special-budget/config' && c.method === 'PUT');
  ok('配置修改带理由 + secondConfirm', !!cfgCall && JSON.parse(cfgCall.body).annualCap === 5000 && JSON.parse(cfgCall.body).secondConfirm === true && JSON.parse(cfgCall.body).reason === '测试调整', JSON.stringify(cfgCall && cfgCall.body));

  await page.context().close();
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}

console.log(`\nSMOKE ${fail === 0 ? 'PASS' : 'FAIL'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
