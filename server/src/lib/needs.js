'use strict';
// 采购两级模型共享库（PURCHASE-REDESIGN）：状态机 / 口径 / 旧形态合成 / 打分
// 供 routes/needs.js、routes/items.js（兼容层）、report/projects/notify/sync 使用
const db = require('../db');
const H = require('./helpers');

// ===== 状态白名单 =====
const NEED_STATUS = new Set(['对比中', '已定点', '已完成', '已取消']);
// 子单新状态机（砍掉 待评估/待审批/已审批）
const ORDER_STATUS = new Set(['待下单', '已下单', '已到', '已退', '已归档', '已取消']);
// 记账口径（全站唯一）：仅这三种状态计入预算/周报/项目花费/分类统计
const ACTIVE_BUY = ['已下单', '已到', '已归档'];
// 旧 8 状态（兼容层输入/输出）
const LEGACY_STATUS = new Set(['待评估', '待审批', '已审批', '已下单', '已到', '已退', '已归档', '已取消']);

// 默认对比维度（价格3/功能2/颜值1/质量口碑2/售后1）
const DEFAULT_DIMENSIONS = Object.freeze([
  { key: 'price', label: '价格', weight: 3 },
  { key: 'feature', label: '功能', weight: 2 },
  { key: 'design', label: '颜值', weight: 1 },
  { key: 'quality', label: '质量口碑', weight: 2 },
  { key: 'service', label: '售后', weight: 1 },
]);

// ===== 子单流转合法性（本表第一次有流转校验）=====
// 待下单 →(已下单|已取消)；已下单 →(已到|已退|已取消)；已到 →(已归档|已退|已取消)；
// 已退 →(已取消)；退货后不允许再归档（归档属于已入账口径，会把退款重新算进预算/统计）
const ORDER_TRANSITIONS = {
  '待下单': ['已下单', '已取消'],
  '已下单': ['已到', '已退', '已取消'],
  '已到': ['已归档', '已退', '已取消'],
  '已退': ['已取消'],
  '已归档': [],
  '已取消': [],
};
function canTransition(from, to) {
  if (!ORDER_STATUS.has(to)) return false;
  const outs = ORDER_TRANSITIONS[from] || [];
  return outs.includes(to);
}
// 状态迁移时应写入的时间戳列
function transitionTimeCol(to) {
  return ({ '已下单': 'ordered_at', '已到': 'arrived_at', '已退': 'arrived_at', '已归档': 'archived_at', '已取消': 'archived_at' })[to] || null;
}

// ===== 需求流转 =====
// 对比中 →已定点（定点）；已定点 ⇄ 对比中（回退守卫在路由层查正式单）；已定点 →已完成（正式单归档）；任意非终态 →已取消
function canNeedTransition(from, to) {
  if (!NEED_STATUS.has(to)) return false;
  if (from === to) return false;
  if (from === '已完成' || from === '已取消') return false; // 终态
  if (to === '已完成') return from === '已定点';
  if (to === '已取消') return from === '对比中' || from === '已定点';
  if (to === '对比中') return from === '已定点';
  if (to === '已定点') return from === '对比中';
  return false;
}

// ===== 旧状态 ⇄ 新状态（兼容层 / 迁移）=====
// 旧 → 新（子单）：待评估=无子单（need 对比中）；待审批/已审批 → 待下单；其余原样
function legacyToOrderStatus(s) {
  if (s === '待评估') return null; // 不建子单
  if (s === '待审批' || s === '已审批') return '待下单';
  return ORDER_STATUS.has(s) ? s : '待下单';
}
// 新 → 旧（显示）：待下单 → 待审批（旧前端 stepper/徽章口径）
function orderToLegacyStatus(order, need) {
  if (!order) return '待评估';
  if (order.status === '待下单') return '待审批'; // 已审批在兼容层经 approved_at 区分，徽章统一显示待审批
  return order.status;
}
// 旧状态 → 需求状态（迁移）
function legacyToNeedStatus(s) {
  if (s === '待评估') return '对比中';
  if (s === '已取消') return '已取消';
  if (s === '已归档') return '已完成';
  return '已定点'; // 待审批/已审批/已下单/已到/已退
}

// ===== 打分 =====
// 加权总分 = Σ(score×weight)/Σ(weight)；未打分的维度按 0 计入分子、权重仍计入分母
function weightedTotal(dims, scores) {
  const d = Array.isArray(dims) && dims.length ? dims : DEFAULT_DIMENSIONS;
  const s = scores && typeof scores === 'object' ? scores : {};
  let num = 0, den = 0;
  for (const dim of d) {
    const w = Number(dim.weight) || 0;
    if (w <= 0) continue;
    den += w;
    const sc = Number(s[dim.key]);
    if (Number.isFinite(sc) && sc >= 1 && sc <= 5) num += sc * w;
  }
  if (den <= 0) return 0;
  return Math.round((num / den) * 100) / 100; // 两位小数
}

// 维度校验：≤20 个、weight 1..9、key/label 长度
function validateDimensions(dims) {
  if (dims == null) return { ok: true, value: null };
  if (!Array.isArray(dims)) return { error: '维度必须是数组' };
  if (dims.length > 20) return { error: '维度最多 20 个' };
  const out = [], keys = new Set();
  for (const d of dims) {
    const key = String((d && d.key) || '').trim();
    const label = String((d && d.label) || '').trim();
    const weight = Number(d && d.weight);
    // key 会被拼进前端内联 onclick 的 JS 字符串，必须是安全字符集
    if (!key || key.length > 30 || !/^[A-Za-z0-9_-]+$/.test(key)) return { error: '维度 key 不合法' };
    if (!label || label.length > 30) return { error: '维度名称过长' };
    if (!Number.isInteger(weight) || weight < 1 || weight > 9) return { error: '维度权重需为 1~9 的整数' };
    if (keys.has(key)) return { error: '维度 key 重复：' + key };
    keys.add(key);
    out.push({ key, label, weight });
  }
  return { ok: true, value: out };
}

// 打分校验：{dimKey: 1..5 整数}，key 必须在维度内
function validateScores(dims, scores) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) return { error: 'scores 必须是对象' };
  const keys = new Set((dims || DEFAULT_DIMENSIONS).map(d => d.key));
  const out = {};
  for (const [k, v] of Object.entries(scores)) {
    if (v == null || v === '') continue; // 清空该维
    if (!keys.has(k)) return { error: '未知维度：' + k };
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) return { error: '分数需为 1~5 的整数' };
    out[k] = n;
  }
  return { ok: true, value: out };
}

// ===== 预算区间 =====
function parseBudgetRange(text) {
  // 旧 budget_range 自由文本 → {min,max}；解析失败返回 null（字段保留为 NULL）
  const s = String(text || '').trim();
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)\s*[-~～—]\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const min = Number(m[1]), max = Number(m[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  const n = Number(s);
  if (Number.isFinite(n)) return { min: n, max: n };
  return null;
}
function formatBudgetRange(min, max) {
  if (min == null && max == null) return '';
  if (min != null && max != null) return String(Number(min)) + '-' + String(Number(max));
  return String(Number(min != null ? min : max));
}

// ===== 一次性拉齐图（needs 内嵌 suppliers/orders）=====
async function loadGraph(uid) {
  const [needs, suppliers, orders] = await Promise.all([
    db.query('SELECT * FROM purchase_needs WHERE user_id = ? ORDER BY id DESC', [uid]),
    db.query('SELECT * FROM purchase_suppliers WHERE user_id = ? ORDER BY need_id, sort_order, id', [uid]),
    db.query('SELECT * FROM purchase_orders WHERE user_id = ? ORDER BY need_id, id', [uid]),
  ]);
  const supByNeed = {}, ordByNeed = {};
  for (const s of suppliers) (supByNeed[s.need_id] = supByNeed[s.need_id] || []).push(s);
  for (const o of orders) (ordByNeed[o.need_id] = ordByNeed[o.need_id] || []).push(o);
  return needs.map(n => ({
    need: n,
    suppliers: supByNeed[n.id] || [],
    orders: ordByNeed[n.id] || [],
  }));
}

function parseDimsJson(v) {
  if (v == null) return DEFAULT_DIMENSIONS.map(d => ({ ...d }));
  try {
    const a = typeof v === 'string' ? JSON.parse(v) : v;
    if (Array.isArray(a) && a.length) return a;
  } catch (e) { /* 落回默认 */ }
  return DEFAULT_DIMENSIONS.map(d => ({ ...d }));
}

// ===== 旧形态合成（/api/items GET、sync-to-feishu 共用）=====
// 一 need 一行：有正式单显示其状态，无正式单显示「待评估」
function synthLegacyRow(need, suppliers, orders) {
  const formal = orders.find(o => o.role === 'formal'); // 兼容行只反映正式单
  const sup = (suppliers.find(s => Number(need.selected_supplier_id) === Number(s.id))) || suppliers[0] || null;
  const o = formal;
  const dims = parseDimsJson(need.dimensions);
  // 预算区间文本
  const budgetRange = need.budget_min == null && need.budget_max == null ? ''
    : formatBudgetRange(need.budget_min, need.budget_max);
  return {
    id: 'rec_' + need.id,
    // 以下键与旧 rowToItem / sync-to-feishu 读取的列名对齐
    legacy_id: need.id,
    ext_id: need.ext_id || null,
    name: need.name || '',
    platform: sup ? (sup.platform || '') : '',
    category: need.category || '其他',
    price: o ? Number(o.price_paid) || 0 : (sup && sup.price != null ? Number(sup.price) || 0 : 0),
    qty: o ? Number(o.qty) || 1 : 1,
    status: o ? orderToLegacyStatus(o, need) : '待评估',
    date_ms: o && o.date_ms != null ? Number(o.date_ms) : null,
    note: (o && o.note) || '',
    created_at_text: (o && o.created_at_text) || '',
    approved_at: (o && o.approved_at) || '',
    ordered_at: (o && o.ordered_at) || '',
    arrived_at: (o && o.arrived_at) || '',
    archived_at: (o && o.archived_at) || '',
    eval_summary: need.eval_summary || '', // 迁移留存，不进新流程
    buy_reason: need.buy_reason || '',
    budget_range: budgetRange,
    cancel_reason: need.cancel_reason || '',
    installments: o ? Number(o.installments) || 0 : 0,
    installment_amount: o && o.installment_amount != null ? Number(o.installment_amount) || 0 : 0,
    installment_start: (o && o.installment_start) || '',
    installment_paid: o ? Number(o.installment_paid) || 0 : 0,
    is_quick: need.is_quick ? 1 : 0,
    is_virtual: need.is_virtual ? 1 : 0,
    project_id: need.project_id || null,
    phase_idx: need.phase_idx == null ? null : Number(need.phase_idx),
    image_ref: (o && o.image_ref) || '',
    // 扩展：给新前端/调试看
    _need_status: need.status,
    _supplier_count: suppliers.length,
    _order_count: orders.length,
    _trial_count: orders.filter(x => x.role === 'trial').length,
    _selected_supplier_id: need.selected_supplier_id || null,
    _dims: dims,
    _scores: sup ? (typeof sup.scores === 'string' ? safeJson(sup.scores) : sup.scores) || {} : {},
  };
}

function safeJson(v) { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } }

// 拉齐并合成旧形态行（一 need 一行，按 need id 升序，与旧 purchases id 序近似）
async function synthLegacyRows(uid) {
  const graph = await loadGraph(uid);
  // loadGraph 按 id DESC；兼容行按旧习惯升序
  return graph.slice().reverse().map(g => synthLegacyRow(g.need, g.suppliers, g.orders));
}

// 记账口径：子单是否计入
function countsTowardBudget(status) {
  return ACTIVE_BUY.includes(String(status || ''));
}

// 记账金额：price_paid × qty
function orderAmount(o) {
  // 钱一律两位小数，避免 19.9*3=59.699999… 的浮点误差
  return Math.round((Number(o.price_paid) || 0) * (Number(o.qty) || 1) * 100) / 100;
}

// ===== 状态迁移统一执行（写时间戳 + 需求联动）=====
// 期望在事务连接上执行；返回 {ok} 或 {error}
async function applyOrderTransition(conn, uid, order, to, opts = {}) {
  if (!canTransition(order.status, to)) {
    return { error: `状态流转不合法：${order.status} → ${to}` };
  }
  const timeCol = transitionTimeCol(to);
  const sets = ['status = ?'], vals = [to];
  if (timeCol) { sets.push(timeCol + ' = ?'); vals.push(H.bjNow()); }
  if (opts.note !== undefined) { sets.push('note = ?'); vals.push(opts.note); }
  vals.push(order.id, uid);
  await conn.query('UPDATE purchase_orders SET ' + sets.join(', ') + ' WHERE id = ? AND user_id = ?', vals);

  // 正式单归档 → 需求已完成
  if (order.role === 'formal' && to === '已归档') {
    await conn.query('UPDATE purchase_needs SET status = ?, updated_at = NOW() WHERE id = ? AND user_id = ?', ['已完成', order.need_id, uid]);
  }
  // 试用/正式单终态清理：只有该需求已无其它在途子单时才删关联待办。
  // 旧模型一单一条待办；两级模型下退掉一张落选试用单不应删掉正式单的待办。
  if (to === '已退' || to === '已取消') {
    const [act] = await conn.query(
      "SELECT COUNT(*) AS c FROM purchase_orders WHERE user_id = ? AND need_id = ? AND id <> ? AND status IN ('待下单','已下单','已到')",
      [uid, order.need_id, order.id]);
    if (Number(act[0].c) === 0) {
      await conn.query('DELETE FROM todos WHERE user_id = ? AND link_type = ? AND link_id = ?', [uid, '采购', 'rec_' + order.need_id]);
    }
  }
  return { ok: true };
}

module.exports = {
  NEED_STATUS, ORDER_STATUS, LEGACY_STATUS, ACTIVE_BUY, DEFAULT_DIMENSIONS,
  ORDER_TRANSITIONS, canTransition, canNeedTransition, transitionTimeCol,
  legacyToOrderStatus, orderToLegacyStatus, legacyToNeedStatus,
  weightedTotal, validateDimensions, validateScores,
  parseBudgetRange, formatBudgetRange,
  loadGraph, parseDimsJson, synthLegacyRow, synthLegacyRows,
  countsTowardBudget, orderAmount, applyOrderTransition, safeJson,
};
