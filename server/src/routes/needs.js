'use strict';
// /api/needs 采购两级模型路由（PURCHASE-REDESIGN §3）
// 需求 → 供应商（对比层）→ 子采购单（执行层，唯一记账单元）
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const IMG = require('../lib/images');
const N = require('../lib/needs');
const { guard, clientIP } = require('../middleware');

const router = express.Router();
const MAX_MONEY = 9999999;

function _numId(id) { return H.numFromId(id); }
function _projId(b) { var s = String(b && b.projectId || '').trim(); var m = /^(?:rec_)?(\d+)$/.exec(s); if (!m) return null; var n = Number(m[1]); return n > 0 ? n : null; }
// 传了非空 projectId 但解析失败（含 '0' / 'rec_0'）→ 拒绝，避免把金额挂到不存在的项目 0
function _badProjectId(b) { return !!(b && b.projectId !== undefined && b.projectId !== null && String(b.projectId).trim() !== '' && !_projId(b)); }
function _phaseIdx(b) { if (!b || b.phaseIdx === null || b.phaseIdx === undefined || b.phaseIdx === '') return null; var n = Number(b.phaseIdx); return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null; }
function _money(v) { if (v === undefined || v === null || v === '') return null; var n = Number(v); return Number.isFinite(n) ? n : NaN; }
function _int(v, def) { if (v === undefined || v === null || v === '') return def; var n = Number(v); return Number.isInteger(n) ? n : NaN; }
function _dateMs(v) { if (v === undefined || v === null || v === '') return null; var t = new Date(v).getTime(); return Number.isFinite(t) ? t : NaN; }
async function _ownedProject(uid, pid) { if (!pid) return true; return !!(await db.one('SELECT id FROM projects WHERE id=? AND user_id=?', [pid, uid])); }

async function _saveImage(req, uid, val, prefix) {
  if (typeof val === 'string' && val.startsWith('data:')) {
    if (val.length > 12 * 1024 * 1024) { const e = new Error('图片过大'); e.status = 413; throw e; }
    return await IMG.saveDataImage(req.username, uid, val, prefix);
  }
  // kv 引用只接受图片模块实际生成的 key 形态，挡住超长串/任意字符串写库
  if (typeof val === 'string' && val.startsWith('kv:')) return /^kv:[\w.-]{1,200}$/.test(val) ? val : null;
  if (val === '' || val == null) return '';
  return null; // 非法
}

async function getOwnedNeed(uid, id) {
  const n = _numId(id);
  if (!n) return null;
  return db.one('SELECT * FROM purchase_needs WHERE id = ? AND user_id = ?', [n, uid]);
}
async function getOwnedSupplier(uid, id) {
  const n = _numId(id);
  if (!n) return null;
  return db.one('SELECT * FROM purchase_suppliers WHERE id = ? AND user_id = ?', [n, uid]);
}
async function getOwnedOrder(uid, id) {
  const n = _numId(id);
  if (!n) return null;
  return db.one('SELECT * FROM purchase_orders WHERE id = ? AND user_id = ?', [n, uid]);
}

function rowToNeed(n, suppliers, orders) {
  return {
    id: 'rec_' + n.id,
    '名称': n.name || '',
    '分类': n.category || '其他',
    '预算下限': n.budget_min == null ? null : Number(n.budget_min),
    '预算上限': n.budget_max == null ? null : Number(n.budget_max),
    '状态': n.status || '对比中',
    '维度': N.parseDimsJson(n.dimensions),
    '定点供应商ID': n.selected_supplier_id ? 'rec_' + n.selected_supplier_id : '',
    '项目ID': n.project_id ? 'rec_' + n.project_id : '',
    '阶段': n.phase_idx == null ? null : Number(n.phase_idx),
    '虚拟': n.is_virtual ? '1' : '',
    '极速': n.is_quick ? '1' : '',
    '历史': n.legacy_purchase_id ? '1' : '',
    '取消原因': n.cancel_reason || '',
    '定点时间': n.decided_at || '',
    '创建时间': n.created_at ? formatDt(n.created_at) : '',
    suppliers: (suppliers || []).map(rowToSupplier),
    orders: (orders || []).map(rowToOrder),
  };
}
function formatDt(d) {
  const x = new Date(d);
  const p = n => String(n).padStart(2, '0');
  // 与旧 created_at_text 同形（东八区）
  const bj = new Date(x.getTime() + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 16).replace('T', ' ');
}
function rowToSupplier(s) {
  const dims = null; // 维度挂 need，打分原样返回
  return {
    id: 'rec_' + s.id,
    needId: 'rec_' + s.need_id,
    '谁': s.name || '',
    '平台': s.platform || '',
    '报价': s.price == null ? null : Number(s.price),
    '图片': s.image_ref || '',
    '优点': s.pros || '',
    '缺点': s.cons || '',
    '备注': s.note || '',
    '打分': N.safeJson(s.scores) || {},
    '排序': Number(s.sort_order) || 0,
  };
}
function rowToOrder(o) {
  return {
    id: 'rec_' + o.id,
    needId: 'rec_' + o.need_id,
    supplierId: o.supplier_id ? 'rec_' + o.supplier_id : '',
    role: o.role || 'formal',
    '数量': Number(o.qty) || 1,
    '实付': Number(o.price_paid) || 0,
    '状态': o.status || '待下单',
    '分期期数': Number(o.installments) || 0,
    '分期金额': o.installment_amount == null ? 0 : Number(o.installment_amount),
    '分期开始月': o.installment_start || '',
    '分期已还': Number(o.installment_paid) || 0,
    '日期': o.date_ms == null ? null : Number(o.date_ms),
    '图片': o.image_ref || '',
    '备注': o.note || '',
    '极速': o.is_quick ? '1' : '',
    '创建时间': o.created_at_text || '',
    '审批时间': o.approved_at || '',
    '下单时间': o.ordered_at || '',
    '到货时间': o.arrived_at || '',
    '归档时间': o.archived_at || '',
  };
}

// 校验需求输入
function validateNeedInput(b, old) {
  const o = old || {};
  const creating = !old;
  let name = creating ? String(b.name || '').trim() : (b.name !== undefined ? String(b.name).trim() : String(o.name || ''));
  if (b.name !== undefined || creating) {
    if (!name) return { error: '名称不能为空' };
    if (name.length > 200) return { error: '名称过长' };
  }
  let category = creating ? String(b.category || '其他').trim() : (b.category !== undefined ? String(b.category).trim() : (o.category || '其他'));
  if (category.length > 30) return { error: '分类过长' };
  let bmin = creating ? null : (o.budget_min == null ? null : Number(o.budget_min));
  let bmax = creating ? null : (o.budget_max == null ? null : Number(o.budget_max));
  if (b.budgetMin !== undefined) {
    if (b.budgetMin === null || b.budgetMin === '') bmin = null;
    else { bmin = _money(b.budgetMin); if (Number.isNaN(bmin) || bmin < 0 || bmin > MAX_MONEY) return { error: '预算下限格式不正确' }; }
  }
  if (b.budgetMax !== undefined) {
    if (b.budgetMax === null || b.budgetMax === '') bmax = null;
    else { bmax = _money(b.budgetMax); if (Number.isNaN(bmax) || bmax < 0 || bmax > MAX_MONEY) return { error: '预算上限格式不正确' }; }
  }
  if (bmin != null && bmax != null && bmin > bmax) return { error: '预算下限不能大于上限' };
  if (b.cancelReason !== undefined && String(b.cancelReason || '').length > 200) return { error: '取消原因过长' };
  return { name, category, bmin, bmax };
}

function validateSupplierInput(b, old) {
  const o = old || {};
  const creating = !old;
  const name = (b.name !== undefined || creating) ? String(b.name || '').trim() : String(o.name || '');
  if (b.name !== undefined || creating) {
    if (!name) return { error: '供应商名称不能为空' };
    if (name.length > 120) return { error: '供应商名称过长' };
  }
  let price = o.price == null ? null : Number(o.price);
  if (b.price !== undefined) {
    if (b.price === null || b.price === '') price = null;
    else { price = _money(b.price); if (Number.isNaN(price) || price < 0 || price > MAX_MONEY) return { error: '报价格式不正确' }; }
  }
  const platform = b.platform !== undefined ? String(b.platform || '').slice(0, 20) : (o.platform || '');
  for (const [k, max] of [['pros', 2000], ['cons', 2000], ['note', 5000]]) {
    if (b[k] !== undefined && String(b[k] == null ? '' : b[k]).length > max) return { error: k + ' 过长' };
  }
  return { name, price, platform };
}

function validateOrderInput(b, old) {
  const o = old || {};
  const creating = !old;
  let qty = creating ? 1 : Number(o.qty) || 1;
  if (b.qty !== undefined) { qty = _int(b.qty, 1); if (Number.isNaN(qty) || qty < 1 || qty > 9999) return { error: '数量格式不正确' }; }
  let pricePaid = creating ? 0 : Number(o.price_paid) || 0;
  if (b.pricePaid !== undefined) { pricePaid = _money(b.pricePaid); if (pricePaid == null || Number.isNaN(pricePaid) || pricePaid < 0 || pricePaid > MAX_MONEY) return { error: '实付格式不正确' }; }
  let installments = creating ? 0 : Number(o.installments) || 0;
  if (b.installments !== undefined) { installments = _int(b.installments, 0); if (Number.isNaN(installments) || installments < 0 || installments > 120) return { error: '分期期数需在 0~120 之间' }; }
  let instAmount = creating ? 0 : (o.installment_amount == null ? 0 : Number(o.installment_amount) || 0);
  if (b.installmentAmount !== undefined) { instAmount = _money(b.installmentAmount); if (instAmount == null || Number.isNaN(instAmount) || instAmount < 0 || instAmount > MAX_MONEY) return { error: '分期金额格式不正确' }; }
  let instStart = creating ? '' : (o.installment_start || '');
  if (b.installmentStart !== undefined) {
    instStart = String(b.installmentStart || '');
    if (instStart && !/^\d{4}-(0[1-9]|1[0-2])$/.test(instStart)) return { error: '分期开始月格式应为 YYYY-MM' };
  }
  let instPaid = creating ? 0 : Number(o.installment_paid) || 0;
  if (b.installmentPaid !== undefined) {
    instPaid = _int(b.installmentPaid, 0);
    if (Number.isNaN(instPaid) || instPaid < 0) return { error: '已还期数不正确' };
  }
  // 期数调小但没传已还期数时，也要用「更新后」的期数复核，避免出现已还 8/共 2 期
  if (instPaid > installments) return { error: '已还期数不能大于分期期数' };
  let dateMs = creating ? null : (o.date_ms == null ? null : Number(o.date_ms));
  if (b.date !== undefined) { const t = _dateMs(b.date); if (Number.isNaN(t)) return { error: '日期格式不正确' }; dateMs = t; }
  if (b.note !== undefined && String(b.note || '').length > 5000) return { error: '备注过长' };
  return { qty, pricePaid, installments, instAmount, instStart, instPaid, dateMs };
}

router.use(guard(['needs', 'suppliers', 'orders']));

// ===== 聚合列表 =====
router.get('/needs', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.json([]);
    const graph = await N.loadGraph(uid);
    res.json(graph.map(g => rowToNeed(g.need, g.suppliers, g.orders)));
  } catch (e) { next(e); }
});

// ===== 创建需求 =====
router.post('/needs', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.status(401).json({ error: '用户不存在' });
    const b = req.body || {};
    const v = validateNeedInput(b, null);
    if (v.error) return res.status(400).json({ error: v.error });
    const dv = N.validateDimensions(b.dimensions);
    if (dv.error) return res.status(400).json({ error: dv.error });
    if (_badProjectId(b)) return res.status(400).json({ error: '项目ID格式不正确' });
    const pid = _projId(b), pidx = _phaseIdx(b);
    if (!(await _ownedProject(uid, pid))) return res.status(404).json({ error: '项目不存在' });
    const dims = dv.value || N.DEFAULT_DIMENSIONS;
    const [ins] = await db.pool.query(
      `INSERT INTO purchase_needs (user_id,name,category,budget_min,budget_max,status,dimensions,project_id,phase_idx,is_virtual,is_quick)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, v.name, v.category, v.bmin, v.bmax, '对比中', JSON.stringify(dims), pid, pidx, b.virtual ? 1 : 0, 0]);
    res.json({ id: 'rec_' + ins.insertId });
  } catch (e) { next(e); }
});

// ===== 更新需求（含维度；已定点后维度不可改）=====
router.put('/needs/:id', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const need = await getOwnedNeed(uid, req.params.id);
    if (!need) return res.status(404).json({ error: 'not found' });
    // 终态需求不可再改字段，否则历史花费可能被迁到别的项目/分类
    if (need.status === '已完成' || need.status === '已取消') return res.status(400).json({ error: '需求已结束，不可修改' });
    const b = req.body || {};
    const v = validateNeedInput(b, need);
    if (v.error) return res.status(400).json({ error: v.error });
    const cols = {}, vals = [];
    function set(col, val) { cols[col] = val; }
    if (b.name !== undefined) set('name', v.name);
    if (b.category !== undefined) set('category', v.category);
    if (b.budgetMin !== undefined) set('budget_min', v.bmin);
    if (b.budgetMax !== undefined) set('budget_max', v.bmax);
    if (b.virtual !== undefined) set('is_virtual', b.virtual ? 1 : 0);
    if (b.projectId !== undefined) {
      if (_badProjectId(b)) return res.status(400).json({ error: '项目ID格式不正确' });
      const pid = _projId(b);
      if (!(await _ownedProject(uid, pid))) return res.status(404).json({ error: '项目不存在' });
      set('project_id', pid);
    }
    if (b.phaseIdx !== undefined) set('phase_idx', _phaseIdx(b));
    let newDims = null;
    if (b.dimensions !== undefined) {
      if (need.status !== '对比中') return res.status(400).json({ error: '已定点后不可修改对比维度' });
      const dv = N.validateDimensions(b.dimensions);
      if (dv.error) return res.status(400).json({ error: dv.error });
      newDims = dv.value || N.DEFAULT_DIMENSIONS.map(d => ({ ...d }));
      set('dimensions', JSON.stringify(newDims));
    }
    if (b.cancelReason !== undefined) set('cancel_reason', String(b.cancelReason || '').slice(0, 200));
    const keys = Object.keys(cols);
    if (keys.length) {
      await db.exec('UPDATE purchase_needs SET ' + keys.map(k => k + ' = ?').join(', ') + ' WHERE id = ? AND user_id = ?',
        [...keys.map(k => cols[k]), need.id, uid]);
    }
    // 删维度时同步修剪供应商打分里的旧 key，否则之后任一打分都会因「未知维度」永久失败
    if (newDims) {
      const allowed = new Set(newDims.map(d => d.key));
      const sups = await db.query('SELECT id, scores FROM purchase_suppliers WHERE need_id = ? AND user_id = ?', [need.id, uid]);
      for (const s of sups) {
        let sc = N.safeJson(s.scores);
        if (!sc || typeof sc !== 'object') sc = {};
        let changed = false;
        const kept = {};
        for (const k of Object.keys(sc)) {
          if (allowed.has(k)) kept[k] = sc[k]; else changed = true;
        }
        if (changed) await db.exec('UPDATE purchase_suppliers SET scores = ? WHERE id = ? AND user_id = ?', [JSON.stringify(kept), s.id, uid]);
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ===== 删除需求（级联供应商+子单；解绑待办）=====
router.delete('/needs/:id', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    const n = _numId(req.params.id);
    if (!n) return res.json({ ok: true });
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM purchase_needs WHERE id = ? AND user_id = ? FOR UPDATE', [n, uid]);
    if (!rows[0]) { await conn.rollback(); return res.json({ ok: true }); }
    // 子单已入账（已下单起）的需求不允许直接删：先归档/退货，避免账目凭空消失
    const [spent] = await conn.query(
      "SELECT COUNT(*) AS c FROM purchase_orders WHERE need_id = ? AND status IN ('已下单','已到','已归档')", [n]);
    if (Number(spent[0].c) > 0) {
      await conn.rollback();
      return res.status(400).json({ error: '已有入账子单，请先退货或归档后再删除' });
    }
    await conn.query('DELETE FROM todos WHERE user_id = ? AND link_type = ? AND link_id = ?', [uid, '采购', 'rec_' + n]);
    await conn.query('DELETE FROM purchase_needs WHERE id = ? AND user_id = ?', [n, uid]); // FK 级联 supplier/order
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

// ===== 供应商 CRUD =====
router.post('/needs/:id/suppliers', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const need = await getOwnedNeed(uid, req.params.id);
    if (!need) return res.status(404).json({ error: '需求不存在' });
    // 只有对比中才能新增供应商；已定点/终态加供应商没有业务意义
    if (need.status !== '对比中') return res.status(400).json({ error: '当前状态不可添加供应商' });
    const b = req.body || {};
    const v = validateSupplierInput(b, null);
    if (v.error) return res.status(400).json({ error: v.error });
    let imageRef = '';
    if (b.image !== undefined && b.image !== '' && b.image != null) {
      imageRef = await _saveImage(req, uid, b.image, 'supplier');
      if (imageRef === null) return res.status(400).json({ error: '图片格式不正确' });
    }
    const sv = N.validateScores(N.parseDimsJson(need.dimensions), b.scores || {});
    if (sv.error) return res.status(400).json({ error: sv.error });
    const [cnt] = await db.pool.query('SELECT COUNT(*) AS c FROM purchase_suppliers WHERE need_id = ?', [need.id]);
    const [ins] = await db.pool.query(
      `INSERT INTO purchase_suppliers (user_id,need_id,name,platform,price,image_ref,pros,cons,note,scores,sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, need.id, v.name, v.platform, v.price, imageRef, b.pros || '', b.cons || '', b.note || '',
        JSON.stringify(sv.value || {}), Number(cnt[0].c) || 0]);
    res.json({ id: 'rec_' + ins.insertId });
  } catch (e) { next(e); }
});

router.put('/suppliers/:id', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const sup = await getOwnedSupplier(uid, req.params.id);
    if (!sup) return res.status(404).json({ error: 'not found' });
    const supNeed = await db.one('SELECT status FROM purchase_needs WHERE id = ? AND user_id = ?', [sup.need_id, uid]);
    if (supNeed && (supNeed.status === '已完成' || supNeed.status === '已取消')) {
      return res.status(400).json({ error: '需求已结束，不可修改供应商' });
    }
    const b = req.body || {};
    const v = validateSupplierInput(b, sup);
    if (v.error) return res.status(400).json({ error: v.error });
    const cols = {}, vals = [];
    if (b.name !== undefined) { cols.name = v.name; }
    if (b.price !== undefined) { cols.price = v.price; }
    if (b.platform !== undefined) { cols.platform = v.platform; }
    if (b.pros !== undefined) cols.pros = String(b.pros || '');
    if (b.cons !== undefined) cols.cons = String(b.cons || '');
    if (b.note !== undefined) cols.note = String(b.note || '');
    if (b.sortOrder !== undefined) { const n = _int(b.sortOrder, 0); if (!Number.isNaN(n)) cols.sort_order = n; }
    if (b.image !== undefined) {
      const ref = await _saveImage(req, uid, b.image, 'supplier');
      if (ref === null) return res.status(400).json({ error: '图片格式不正确' });
      cols.image_ref = ref;
    }
    if (b.scores !== undefined) {
      const need = await db.one('SELECT dimensions FROM purchase_needs WHERE id = ? AND user_id = ?', [sup.need_id, uid]);
      const sv = N.validateScores(N.parseDimsJson(need && need.dimensions), b.scores);
      if (sv.error) return res.status(400).json({ error: sv.error });
      cols.scores = JSON.stringify(sv.value || {});
    }
    const keys = Object.keys(cols);
    if (keys.length) {
      await db.exec('UPDATE purchase_suppliers SET ' + keys.map(k => k + ' = ?').join(', ') + ' WHERE id = ? AND user_id = ?',
        [...keys.map(k => cols[k]), sup.id, uid]);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 批量保存打分
router.put('/suppliers/:id/scores', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const sup = await getOwnedSupplier(uid, req.params.id);
    if (!sup) return res.status(404).json({ error: 'not found' });
    const need = await db.one('SELECT dimensions FROM purchase_needs WHERE id = ? AND user_id = ?', [sup.need_id, uid]);
    const b = req.body || {};
    const sv = N.validateScores(N.parseDimsJson(need && need.dimensions), b.scores);
    if (sv.error) return res.status(400).json({ error: sv.error });
    // 全量覆盖（含清空 null）
    await db.exec('UPDATE purchase_suppliers SET scores = ? WHERE id = ? AND user_id = ?', [JSON.stringify(sv.value || {}), sup.id, uid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/suppliers/:id', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const sup = await getOwnedSupplier(uid, req.params.id);
    if (!sup) return res.json({ ok: true });
    const need = await db.one('SELECT * FROM purchase_needs WHERE id = ? AND user_id = ?', [sup.need_id, uid]);
    if (need && (need.status === '已完成' || need.status === '已取消')) {
      return res.status(400).json({ error: '需求已结束，不可删除供应商' });
    }
    if (need && Number(need.selected_supplier_id) === Number(sup.id)) {
      return res.status(400).json({ error: '该供应商已定点，先回退定点再删除' });
    }
    // 关联过入账子单的供应商不可删（保留账目回溯）
    // 注意 db.query 直接返回 rows（不是 [rows, fields]），不能再解构
    const spentRows = await db.query(
      "SELECT COUNT(*) AS c FROM purchase_orders WHERE supplier_id = ? AND status IN ('已下单','已到','已归档')", [sup.id]);
    if (Number(spentRows[0] && spentRows[0].c) > 0) return res.status(400).json({ error: '该供应商已有入账子单，不可删除' });
    await db.exec('DELETE FROM purchase_suppliers WHERE id = ? AND user_id = ?', [sup.id, uid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ===== 子单 =====
router.post('/needs/:id/orders', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    await conn.beginTransaction();
    const [nrows] = await conn.query('SELECT * FROM purchase_needs WHERE id = ? AND user_id = ? FOR UPDATE', [_numId(req.params.id) || 0, uid]);
    const need = nrows[0];
    if (!need) { await conn.rollback(); return res.status(404).json({ error: '需求不存在' }); }
    const role = b.role === 'trial' ? 'trial' : 'formal';
    // 需求状态机是子单的前置条件：正式单只能从「已定点」创建，试用单只能在「对比中」创建
    if (need.status === '已完成' || need.status === '已取消') {
      await conn.rollback();
      return res.status(400).json({ error: '需求已结束，不能创建子单' });
    }
    if (role === 'formal' && need.status !== '已定点') {
      await conn.rollback();
      return res.status(400).json({ error: '只有已定点的需求才能创建正式单' });
    }
    if (role === 'trial' && need.status !== '对比中') {
      await conn.rollback();
      return res.status(400).json({ error: '只有对比中的需求才能创建试用单' });
    }
    if (role === 'formal') {
      const [ex] = await conn.query("SELECT id FROM purchase_orders WHERE need_id = ? AND role = 'formal'", [need.id]);
      if (ex.length) { await conn.rollback(); return res.status(400).json({ error: '正式单已存在（可更新或走转正）' }); }
    }
    let supplierId = null;
    if (b.supplierId) {
      supplierId = _numId(b.supplierId);
      const [s] = await conn.query('SELECT id FROM purchase_suppliers WHERE id = ? AND need_id = ? AND user_id = ?', [supplierId, need.id, uid]);
      if (!s.length) { await conn.rollback(); return res.status(404).json({ error: '供应商不存在' }); }
    }
    const v = validateOrderInput(b, null);
    if (v.error) { await conn.rollback(); return res.status(400).json({ error: v.error }); }
    // 实付默认继承供应商报价
    let pricePaid = b.pricePaid !== undefined ? v.pricePaid : null;
    if (pricePaid == null && supplierId) {
      const [s] = await conn.query('SELECT price FROM purchase_suppliers WHERE id = ?', [supplierId]);
      pricePaid = s.length && s[0].price != null ? Number(s[0].price) : 0;
    }
    if (pricePaid == null) pricePaid = 0;
    let imageRef = '';
    if (b.image !== undefined && b.image) {
      imageRef = await _saveImage(req, uid, b.image, 'order');
      if (imageRef === null) { await conn.rollback(); return res.status(400).json({ error: '图片格式不正确' }); }
    }
    const status = '待下单'; // 子单一律从待下单开始（快速采购走 /needs/quick 直接已到）
    const [ins] = await conn.query(
      `INSERT INTO purchase_orders (user_id,need_id,supplier_id,role,qty,price_paid,status,installments,installment_amount,
         installment_start,installment_paid,date_ms,image_ref,note,is_quick,created_at_text)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, need.id, supplierId, role, v.qty, pricePaid, status,
        v.installments, v.instAmount, v.instStart, v.instPaid, v.dateMs, imageRef, b.note || '', 0, H.bjNow()]);
    await conn.commit();
    res.json({ id: 'rec_' + ins.insertId });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

router.put('/orders/:id', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const order = await getOwnedOrder(uid, req.params.id);
    if (!order) return res.status(404).json({ error: 'not found' });
    // 终态子单是历史账目，任何字段都不能再改；已退子单只允许改备注/图片
    if (order.status === '已归档' || order.status === '已取消') {
      return res.status(400).json({ error: '已归档/已取消的子单不可修改' });
    }
    const b = req.body || {};
    if (order.status === '已退' && ['qty', 'pricePaid', 'date', 'installments', 'installmentAmount', 'installmentStart', 'installmentPaid', 'supplierId']
      .some(k => b[k] !== undefined)) {
      return res.status(400).json({ error: '已退货的子单只能修改备注/图片' });
    }
    const v = validateOrderInput(b, order);
    if (v.error) return res.status(400).json({ error: v.error });
    const cols = {}, vals = [];
    if (b.qty !== undefined) cols.qty = v.qty;
    if (b.pricePaid !== undefined) cols.price_paid = v.pricePaid;
    if (b.installments !== undefined) cols.installments = v.installments;
    if (b.installmentAmount !== undefined) cols.installment_amount = v.instAmount;
    if (b.installmentStart !== undefined) cols.installment_start = v.instStart;
    if (b.installmentPaid !== undefined) cols.installment_paid = v.instPaid;
    if (b.date !== undefined) cols.date_ms = v.dateMs;
    if (b.note !== undefined) cols.note = String(b.note || '');
    if (b.setDate) cols.date_ms = Date.now();
    if (b.image !== undefined) {
      // 阶段图语义与旧 items PUT 一致：stageName 合并进 JSON
      let ref = '';
      if (typeof b.image === 'string' && b.image.startsWith('data:')) {
        if (b.image.length > 12 * 1024 * 1024) return res.status(413).json({ error: '图片过大' });
        ref = await IMG.saveDataImage(req.username, uid, b.image, 'order');
      } else if (typeof b.image === 'string' && b.image.startsWith('kv:')) {
        if (!/^kv:[\w.-]{1,200}$/.test(b.image)) return res.status(400).json({ error: '图片格式不正确' });
        ref = b.image;
      }
      if (b.stageImage && b.stageName) {
        let ex = {};
        try { ex = JSON.parse(order.image_ref && String(order.image_ref).startsWith('{') ? order.image_ref : '{}'); } catch (e) { ex = {}; }
        if (typeof ex !== 'object') ex = {};
        if (!b.image) delete ex[b.stageName]; else ex[b.stageName] = ref;
        cols.image_ref = JSON.stringify(ex);
      } else {
        cols.image_ref = ref;
      }
    }
    if (b.supplierId !== undefined) {
      const sid = b.supplierId ? _numId(b.supplierId) : null;
      if (sid) {
        // db.query 返回 rows 本身，不能解构为 [rows, fields]
        const srows = await db.query('SELECT id FROM purchase_suppliers WHERE id = ? AND need_id = ? AND user_id = ?', [sid, order.need_id, uid]);
        if (!srows.length) return res.status(404).json({ error: '供应商不存在' });
      }
      cols.supplier_id = sid;
    }
    const keys = Object.keys(cols);
    if (keys.length) {
      await db.exec('UPDATE purchase_orders SET ' + keys.map(k => k + ' = ?').join(', ') + ' WHERE id = ? AND user_id = ?',
        [...keys.map(k => cols[k]), order.id, uid]);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 状态迁移（服务端校验合法性 + 写时间戳 + 需求联动）
router.post('/orders/:id/transition', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const to = String(b.to || '');
    if (!N.ORDER_STATUS.has(to)) return res.status(400).json({ error: '无效状态' });
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM purchase_orders WHERE id = ? AND user_id = ? FOR UPDATE', [_numId(req.params.id) || 0, uid]);
    const order = rows[0];
    if (!order) { await conn.rollback(); return res.status(404).json({ error: 'not found' }); }
    if (b.note !== undefined && String(b.note || '').length > 5000) {
      await conn.rollback();
      return res.status(400).json({ error: '备注过长' });
    }
    // 已完成/已取消的需求不允许再把子单推进到「计入口径」，但允许清理（退货/取消/归档）
    const [nrows] = await conn.query('SELECT status FROM purchase_needs WHERE id = ? AND user_id = ?', [order.need_id, uid]);
    const nst = nrows[0] && nrows[0].status;
    if ((nst === '已完成' || nst === '已取消') && (to === '已下单' || to === '已到')) {
      await conn.rollback();
      return res.status(400).json({ error: '需求已结束，不能再产生入账子单' });
    }
    const r = await N.applyOrderTransition(conn, uid, order, to, { note: b.note });
    if (r.error) { await conn.rollback(); return res.status(400).json({ error: r.error }); }
    await conn.commit();
    await H.logOp(req.username, 'status_change', order.status + ' → ' + to + '（子单 #' + order.id + '）', clientIP(req));
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

// 批量状态（落选批量已退 / 批量归档）
router.patch('/orders/batch', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    if (!Array.isArray(b.ids) || !b.ids.length) return res.status(400).json({ error: 'ids required' });
    if (b.ids.length > 500) return res.status(400).json({ error: '一次最多操作 500 条' });
    const to = String(b.status || '');
    if (!N.ORDER_STATUS.has(to)) return res.status(400).json({ error: '无效状态' });
    const results = [];
    for (const id of b.ids) {
      const order = await getOwnedOrder(uid, id);
      if (!order) { results.push({ id, ok: false, error: 'not found' }); continue; }
      const conn = await db.pool.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query('SELECT * FROM purchase_orders WHERE id = ? AND user_id = ? FOR UPDATE', [order.id, uid]);
        if (!rows[0]) { await conn.rollback(); results.push({ id, ok: false }); continue; }
        const r = await N.applyOrderTransition(conn, uid, rows[0], to);
        if (r.error) { await conn.rollback(); results.push({ id, ok: false, error: r.error }); continue; }
        await conn.commit();
        results.push({ id, ok: true });
      } catch (e) { try { await conn.rollback(); } catch (x) {} results.push({ id, ok: false, error: e.message }); }
      finally { conn.release(); }
    }
    res.json({ results, updated: results.filter(r => r.ok).length });
  } catch (e) { next(e); }
});

// ===== 定点 =====
router.post('/needs/:id/decide', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const needId = _numId(req.params.id);
    if (!needId) return res.status(404).json({ error: 'not found' });
    const supplierId = _numId(b.supplierId);
    if (!supplierId) return res.status(400).json({ error: 'supplierId required' });
    const mode = b.mode === 'promote' ? 'promote' : 'new';

    await conn.beginTransaction();
    const [nrows] = await conn.query('SELECT * FROM purchase_needs WHERE id = ? AND user_id = ? FOR UPDATE', [needId, uid]);
    const need = nrows[0];
    if (!need) { await conn.rollback(); return res.status(404).json({ error: '需求不存在' }); }
    if (need.status === '已完成' || need.status === '已取消') { await conn.rollback(); return res.status(400).json({ error: '需求已结束' }); }
    const [srows] = await conn.query('SELECT * FROM purchase_suppliers WHERE id = ? AND need_id = ? AND user_id = ?', [supplierId, needId, uid]);
    if (!srows.length) { await conn.rollback(); return res.status(404).json({ error: '供应商不存在' }); }
    const sup = srows[0];

    // 回退保护：已有正式单且已下单 → 不允许改定点（需先回退或走转正，转正只针对试用单）
    const [formalRows] = await conn.query("SELECT * FROM purchase_orders WHERE need_id = ? AND role = 'formal'", [needId]);
    const formal = formalRows[0] || null;
    if (formal && !['待下单'].includes(formal.status)) {
      await conn.rollback();
      return res.status(400).json({ error: '正式单已下单，不可重新定点' });
    }

    let promoted = false;
    if (mode === 'promote') {
      // 试用单转正：胜出者 status∈{已下单,已到} 的 trial 单 → role=formal（不重复计钱）
      const [trials] = await conn.query(
        "SELECT * FROM purchase_orders WHERE need_id = ? AND supplier_id = ? AND role = 'trial' AND status IN ('已下单','已到') ORDER BY id DESC",
        [needId, supplierId]);
      if (!trials.length) { await conn.rollback(); return res.status(400).json({ error: '该供应商没有可转正的试用单（已下单/已到）' }); }
      const win = trials[0];
      if (formal) {
        // 已有未下单正式单：作废它（未入账），再把试用单转正
        if (formal.status === '待下单') await conn.query('DELETE FROM purchase_orders WHERE id = ?', [formal.id]);
      }
      await conn.query("UPDATE purchase_orders SET role = 'formal' WHERE id = ?", [win.id]);
      promoted = true;
    } else {
      // 新建/复用正式单
      if (formal) {
        // 复用分支也必须走同一套入参校验，避免负金额/NaN/超大数量直接落库
        const v = validateOrderInput(b, formal);
        if (v.error) { await conn.rollback(); return res.status(400).json({ error: v.error }); }
        const sets = ['supplier_id = ?', 'price_paid = ?', 'qty = ?'], vals = [
          supplierId,
          b.pricePaid !== undefined ? v.pricePaid : (sup.price != null ? Number(sup.price) : Number(formal.price_paid) || 0),
          b.qty !== undefined ? v.qty : (Number(formal.qty) || 1),
        ];
        if (b.installments !== undefined) { sets.push('installments = ?'); vals.push(v.installments); }
        if (b.installmentAmount !== undefined) { sets.push('installment_amount = ?'); vals.push(v.instAmount); }
        if (b.installmentStart !== undefined) { sets.push('installment_start = ?'); vals.push(v.instStart); }
        if (b.installmentPaid !== undefined) { sets.push('installment_paid = ?'); vals.push(v.instPaid); }
        if (b.date !== undefined) { sets.push('date_ms = ?'); vals.push(v.dateMs); }
        if (b.note !== undefined) { sets.push('note = ?'); vals.push(String(b.note || '')); }
        vals.push(formal.id);
        await conn.query('UPDATE purchase_orders SET ' + sets.join(', ') + ' WHERE id = ?', vals);
      } else {
        const v = validateOrderInput(b, null);
        if (v.error) { await conn.rollback(); return res.status(400).json({ error: v.error }); }
        let pricePaid = b.pricePaid !== undefined ? v.pricePaid : (sup.price != null ? Number(sup.price) : 0);
        const [ins] = await conn.query(
          `INSERT INTO purchase_orders (user_id,need_id,supplier_id,role,qty,price_paid,status,installments,installment_amount,
             installment_start,installment_paid,date_ms,note,created_at_text)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [uid, needId, supplierId, 'formal', v.qty, pricePaid, '待下单',
            v.installments, v.instAmount, v.instStart, v.instPaid, v.dateMs, b.note || '', H.bjNow()]);
        void ins;
      }
    }

    await conn.query(
      'UPDATE purchase_needs SET status = ?, selected_supplier_id = ?, decided_at = ?, updated_at = NOW() WHERE id = ?',
      ['已定点', supplierId, H.bjNow(), needId]);

    // 落选处理：其它 trial 单 → 已退（UI 可另行批量确认；此处事务内默认执行）
    if (b.retireLosers !== false) {
      await conn.query(
        "UPDATE purchase_orders SET status = '已退', arrived_at = COALESCE(arrived_at, ?) WHERE need_id = ? AND role = 'trial' AND supplier_id <> ? AND status IN ('待下单','已下单','已到')",
        [H.bjNow(), needId, supplierId]);
    }

    await conn.commit();
    await H.logOp(req.username, 'decide', `定点「${need.name}」→ ${sup.name}${promoted ? '（试用转正）' : ''}`, clientIP(req));
    res.json({ ok: true, promoted });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

// 回退定点（正式单不存在或仍为待下单）
router.post('/needs/:id/undecided', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    const needId = _numId(req.params.id);
    if (!needId) return res.status(404).json({ error: 'not found' });
    await conn.beginTransaction();
    const [nrows] = await conn.query('SELECT * FROM purchase_needs WHERE id = ? AND user_id = ? FOR UPDATE', [needId, uid]);
    const need = nrows[0];
    if (!need) { await conn.rollback(); return res.status(404).json({ error: 'not found' }); }
    if (need.status !== '已定点') { await conn.rollback(); return res.status(400).json({ error: '需求未定点' }); }
    const [formalRows] = await conn.query("SELECT * FROM purchase_orders WHERE need_id = ? AND role = 'formal'", [needId]);
    const formal = formalRows[0];
    if (formal && formal.status !== '待下单') {
      await conn.rollback();
      return res.status(400).json({ error: '正式单已下单，不可回退定点' });
    }
    // 未下单的正式单是定点时生成的空壳 → 一并移除
    if (formal) await conn.query('DELETE FROM purchase_orders WHERE id = ?', [formal.id]);
    await conn.query('UPDATE purchase_needs SET status = ?, selected_supplier_id = NULL, decided_at = NULL, updated_at = NOW() WHERE id = ?',
      ['对比中', needId]);
    await conn.commit();
    await H.logOp(req.username, 'undecided', '回退定点：' + (need.name || ''), clientIP(req));
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

// 需求取消（级联未终态子单）
router.post('/needs/:id/cancel', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const needId = _numId(req.params.id);
    if (!needId) return res.status(404).json({ error: 'not found' });
    await conn.beginTransaction();
    const [nrows] = await conn.query('SELECT * FROM purchase_needs WHERE id = ? AND user_id = ? FOR UPDATE', [needId, uid]);
    const need = nrows[0];
    if (!need) { await conn.rollback(); return res.status(404).json({ error: 'not found' }); }
    if (need.status === '已完成') { await conn.rollback(); return res.status(400).json({ error: '需求已完成，不可取消' }); }
    if (need.status === '已取消') { await conn.rollback(); return res.json({ ok: true }); }
    const reason = String(b.reason || b.cancelReason || '').slice(0, 200);
    // 任一子单（试用或正式）已入账 → 拒绝取消，避免金额凭空消失
    const [spent] = await conn.query(
      "SELECT COUNT(*) AS c FROM purchase_orders WHERE need_id = ? AND status IN ('已下单','已到','已归档')", [needId]);
    if (Number(spent[0].c) > 0) {
      await conn.rollback();
      return res.status(400).json({ error: '已有入账子单，不可取消需求（请先退货或归档）' });
    }
    await conn.query(
      "UPDATE purchase_orders SET status = '已取消', archived_at = COALESCE(archived_at, ?) WHERE need_id = ? AND status NOT IN ('已归档','已取消')",
      [H.bjNow(), needId]);
    await conn.query('UPDATE purchase_needs SET status = ?, cancel_reason = ?, updated_at = NOW() WHERE id = ?',
      ['已取消', reason, needId]);
    await conn.query('DELETE FROM todos WHERE user_id = ? AND link_type = ? AND link_id = ?', [uid, '采购', 'rec_' + needId]);
    await conn.commit();
    await H.logOp(req.username, 'cancel', '取消需求：' + (need.name || '') + (reason ? '（' + reason + '）' : ''), clientIP(req));
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

// ===== 快速采购（原子：need+supplier+formal 已到）=====
router.post('/needs/quick', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.status(401).json({ error: '用户不存在' });
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    if (name.length > 200) return res.status(400).json({ error: '名称过长' });
    const price = _money(b.price != null ? b.price : b.amount);
    if (Number.isNaN(price) || price <= 0 || price > MAX_MONEY) return res.status(400).json({ error: '金额需大于 0' });
    const qty = _int(b.qty, 1);
    if (Number.isNaN(qty) || qty < 1 || qty > 9999) return res.status(400).json({ error: '数量格式不正确' });
    // 先按分位取整再比较，避免 0.1*500=50.00000000000001 被误拒
    const total = Math.round(price * qty * 100) / 100;
    // ¥50 免审语义（与旧前端一致）：超出拒绝极速通道
    if (total > 50) return res.status(400).json({ error: '快速采购仅支持 ¥50 以内，请走普通需求流程' });
    const category = String(b.category || '其他').trim().slice(0, 30);
    const platform = String(b.platform || '拼多多').trim().slice(0, 20);
    if (_badProjectId(b)) return res.status(400).json({ error: '项目ID格式不正确' });
    const pid = _projId(b), pidx = _phaseIdx(b);
    if (!(await _ownedProject(uid, pid))) return res.status(404).json({ error: '项目不存在' });
    const dateMs = b.date ? _dateMs(b.date) : Date.now();
    if (Number.isNaN(dateMs)) return res.status(400).json({ error: '日期格式不正确' });

    let imageRef = '';
    if (typeof b.image === 'string' && b.image.startsWith('data:')) {
      if (b.image.length > 12 * 1024 * 1024) return res.status(413).json({ error: '图片过大' });
      imageRef = await IMG.saveDataImage(req.username, uid, b.image, 'order');
    } else if (typeof b.image === 'string' && b.image.startsWith('kv:')) imageRef = b.image;

    await conn.beginTransaction();
    const dims = JSON.stringify(N.DEFAULT_DIMENSIONS);
    const [nins] = await conn.query(
      `INSERT INTO purchase_needs (user_id,name,category,budget_min,budget_max,status,dimensions,project_id,phase_idx,is_virtual,is_quick)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, name, category, total, total, '已定点', dims, pid, pidx, b.virtual ? 1 : 0, 1]);
    const needId = nins.insertId;
    const [sins] = await conn.query(
      'INSERT INTO purchase_suppliers (user_id,need_id,name,platform,price,scores,sort_order) VALUES (?,?,?,?,?,?,0)',
      [uid, needId, name, platform, price, '{}']);
    const supplierId = sins.insertId;
    await conn.query('UPDATE purchase_needs SET selected_supplier_id = ?, decided_at = ? WHERE id = ?', [supplierId, H.bjNow(), needId]);
    const [oins] = await conn.query(
      `INSERT INTO purchase_orders (user_id,need_id,supplier_id,role,qty,price_paid,status,date_ms,image_ref,note,is_quick,created_at_text,arrived_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, needId, supplierId, 'formal', qty, price, '已到', dateMs, imageRef, String(b.note || '').slice(0, 5000), 1, H.bjNow(), H.bjNow()]);
    await conn.commit();
    await H.logOp(req.username, 'quick_purchase', `${name} ¥${price}×${qty}`, clientIP(req));
    res.json({ id: 'rec_' + needId, orderId: 'rec_' + oins.insertId });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

module.exports = router;
