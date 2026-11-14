'use strict';
// /api/items 兼容层（PURCHASE-REDESIGN §7）：读写全部映射到两级模型
// GET    → 一 need 一行合成旧形态（供旧前端缓存/回滚窗口）
// POST   → need + supplier + formal order（quick 走 ¥50 原子逻辑）
// PUT    → 单条更新（字段分流到 need/supplier/order）
// PATCH  → 批量状态/备注（旧 8 状态 → 新模型，宽松映射）
// DELETE → 级联删 need；入账中的拒绝
// 新前端请直接用 /api/needs。状态映射见 lib/needs.js。
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const IMG = require('../lib/images');
const N = require('../lib/needs');
const { guard, clientIP } = require('../middleware');
const { logOp } = require('../lib/helpers');

const router = express.Router();

const ITEM_STATUS = N.LEGACY_STATUS; // 旧 8 状态白名单（兼容层输入）
const MAX_MONEY = 9999999;

function _projId(b){var s=String(b.projectId||'').trim();var m=/^(?:rec_)?(\d+)$/.exec(s);if(!m)return null;var n=Number(m[1]);return n>0?n:null;}
function _phaseIdx(b){if(b.phaseIdx===null||b.phaseIdx===undefined||b.phaseIdx==='')return null;var n=Number(b.phaseIdx);return Number.isInteger(n)&&n>=0&&n<=5?n:null;}
function _money(v){if(v===undefined||v===null||v==='')return 0;var n=Number(v);return Number.isFinite(n)?n:NaN;}
function _int(v,def){if(v===undefined||v===null||v==='')return def;var n=Number(v);return Number.isInteger(n)?n:NaN;}
function _dateMs(v){if(v===undefined||v===null||v==='')return null;var t=new Date(v).getTime();return Number.isFinite(t)?t:NaN;}
// kv: 引用会原样写入 image_ref，必须是安全字符集（不接受任意字符串）
function _kvRef(s){return typeof s==='string'&&/^kv:[\w.-]{1,200}$/.test(s);}
async function _ownedProject(uid,pid){if(!pid)return true;return !!(await db.one('SELECT id FROM projects WHERE id=? AND user_id=?',[pid,uid]));}

// 表单校验（沿用旧规则，防负值/NaN/超长）
function validateItem(b, old) {
  const o = old || {};
  const creating = !old;
  const name = b.name !== undefined ? String(b.name).trim() : String(o.name || '');
  if (b.name !== undefined || !old) {
    if (!name) return { error: '商品名称不能为空' };
    if (name.length > 200) return { error: '商品名称过长' };
  }
  let price = creating ? 0 : o.price;
  if (b.price !== undefined) { price = _money(b.price); if (Number.isNaN(price) || price < 0 || price > MAX_MONEY) return { error: '单价格式不正确' }; }
  let qty = creating ? 1 : o.qty;
  if (b.qty !== undefined) { qty = _int(b.qty, 1); if (Number.isNaN(qty) || qty < 1 || qty > 9999) return { error: '数量格式不正确' }; }
  let status = o.status;
  if (b.status !== undefined) { status = String(b.status); if (!ITEM_STATUS.has(status)) return { error: '无效状态' }; }
  let installments = Number(o.installments) || 0;
  if (b.installments !== undefined) { installments = _int(b.installments, 0); if (Number.isNaN(installments) || installments < 0 || installments > 120) return { error: '分期期数需在 0~120 之间' }; }
  let instAmount = Number(o.installment_amount) || 0;
  if (b.installmentAmount !== undefined) { instAmount = _money(b.installmentAmount); if (Number.isNaN(instAmount) || instAmount < 0 || instAmount > MAX_MONEY) return { error: '分期金额格式不正确' }; }
  let instStart = o.installment_start || '';
  if (b.installmentStart !== undefined) {
    instStart = String(b.installmentStart || '');
    if (instStart && !/^\d{4}-(0[1-9]|1[0-2])$/.test(instStart)) return { error: '分期开始月格式应为 YYYY-MM' };
  }
  let paid = Number(o.installment_paid) || 0;
  if (b.installmentPaid !== undefined) {
    paid = _int(b.installmentPaid, 0);
    if (Number.isNaN(paid) || paid < 0) return { error: '已还期数不正确' };
  }
  // 期数调小时，未传已还期数也要复核最终组合
  if (paid > installments) return { error: '已还期数不能大于分期期数' };
  if (b.date !== undefined) { const t = _dateMs(b.date); if (Number.isNaN(t)) return { error: '日期格式不正确' }; }
  for (const [k, max] of [['platform', 20], ['category', 30], ['budgetRange', 50], ['cancelReason', 200], ['note', 5000], ['evalSummary', 5000], ['buyReason', 5000]]) {
    if (b[k] !== undefined && String(b[k] == null ? '' : b[k]).length > max) return { error: k + ' 过长' };
  }
  if (b.projectId !== undefined && b.projectId && !_projId(b)) return { error: '项目ID格式不正确' };
  if (b.phaseIdx !== undefined && b.phaseIdx !== null && b.phaseIdx !== '' && _phaseIdx(b) === null) return { error: '阶段序号不正确' };
  return { name, price, qty, status, installments, instAmount, instStart };
}

// 旧形态行 → 中文键 JSON（与旧 rowToItem 完全一致的键集合）
function rowToItem(r) {
  return {
    id: 'rec_' + r.legacy_id,
    '商品名称': r.name || '',
    '平台': r.platform || '',
    '单价': Number(r.price) || 0,
    '数量': Number(r.qty) || 1,
    '状态': r.status || '待审批',
    '分类': r.category || '其他',
    '日期': r.date_ms == null ? null : Number(r.date_ms),
    '备注': r.note || '',
    '创建时间': r.created_at_text || '',
    '审批时间': r.approved_at || '',
    '下单时间': r.ordered_at || '',
    '到货时间': r.arrived_at || '',
    '归档时间': r.archived_at || '',
    '评估摘要': r.eval_summary || '',
    '购买理由': r.buy_reason || '',
    '预算区间': r.budget_range || '',
    '取消原因': r.cancel_reason || '',
    '图片': r.image_ref || '',
    '附件': (() => { const v = r.image_ref || ''; try { return v ? JSON.parse(v) : {} } catch (e) { return v ? { legacy: v } : {} } })(),
    '分期期数': Number(r.installments) || 0,
    '分期金额': Number(r.installment_amount) || 0,
    '分期开始月': r.installment_start || '',
    '分期已还': Number(r.installment_paid) || 0,
    '极速': r.is_quick ? '1' : '',
    '虚拟': r.is_virtual ? '1' : '',
    '项目ID': r.project_id ? 'rec_' + r.project_id : '',
    '阶段': r.phase_idx == null ? null : Number(r.phase_idx),
  };
}

// id(rec_) → {need, suppliers, orders} 或 null
async function getOwnedGraph(uid, id) {
  const n = H.numFromId(id);
  if (!n) return null;
  const need = await db.one('SELECT * FROM purchase_needs WHERE id = ? AND user_id = ?', [n, uid]);
  if (!need) return null;
  const [suppliers, orders] = await Promise.all([
    db.query('SELECT * FROM purchase_suppliers WHERE need_id = ? ORDER BY sort_order, id', [n]),
    db.query('SELECT * FROM purchase_orders WHERE need_id = ? ORDER BY id', [n]),
  ]);
  return { need, suppliers, orders };
}

function formalOf(orders) { return orders.find(o => o.role === 'formal') || null; }

// 旧状态写入 → needCols / orderPatch / deleteFormal（兼容层宽松，保持旧 UI 批量行为）
function legacyStatusWrite(legacy, curNeed, curOrder) {
  const needCols = {};
  const orderPatch = {};
  let deleteFormal = false;
  switch (legacy) {
    case '待评估':
      needCols.status = '对比中';
      needCols.selected_supplier_id = null;
      needCols.decided_at = null;
      if (curOrder && curOrder.status === '待下单') deleteFormal = true;
      break;
    case '待审批':
      needCols.status = '已定点';
      if (curOrder) { orderPatch.status = '待下单'; orderPatch.approved_at = null; }
      break;
    case '已审批':
      needCols.status = '已定点';
      if (curOrder) { orderPatch.status = '待下单'; orderPatch.approved_at = H.bjNow(); }
      break;
    case '已下单':
      needCols.status = '已定点';
      if (curOrder) {
        orderPatch.status = '已下单'; orderPatch.ordered_at = H.bjNow();
        if (!curOrder.approved_at) orderPatch.approved_at = H.bjNow();
      }
      break;
    case '已到':
      needCols.status = '已定点';
      if (curOrder) { orderPatch.status = '已到'; orderPatch.arrived_at = H.bjNow(); }
      break;
    case '已退':
      needCols.status = '已定点';
      if (curOrder) { orderPatch.status = '已退'; orderPatch.arrived_at = curOrder.arrived_at || H.bjNow(); }
      break;
    case '已归档':
      needCols.status = '已完成';
      if (curOrder) { orderPatch.status = '已归档'; orderPatch.archived_at = H.bjNow(); }
      break;
    case '已取消':
      needCols.status = '已取消';
      if (curOrder) { orderPatch.status = '已取消'; orderPatch.archived_at = curOrder.archived_at || H.bjNow(); }
      break;
  }
  // 终态需求不能被兼容层改回进行中（否则退货/归档口径会被重新激活）
  if ((curNeed.status === '已完成' || curNeed.status === '已取消') && needCols.status && needCols.status !== curNeed.status) {
    return { error: '需求已结束，不能改回进行中' };
  }
  // 有正式单时按状态机校验，禁止任意回退（例如 已退 → 已归档 会把退款重新计入预算）
  if (curOrder && orderPatch.status && orderPatch.status !== curOrder.status && !N.canTransition(curOrder.status, orderPatch.status)) {
    return { error: `状态流转不合法：${curOrder.status} → ${orderPatch.status}` };
  }
  return { needCols, orderPatch, deleteFormal };
}

async function applyPatchCols(conn, table, id, cols) {
  const keys = Object.keys(cols);
  if (!keys.length) return;
  await conn.query('UPDATE ' + table + ' SET ' + keys.map(k => '`' + k + '` = ?').join(', ') + ' WHERE id = ?', [...keys.map(k => cols[k]), id]);
}

async function saveImageRef(req, uid, b, oldImgRef) {
  let ref = '';
  if (typeof b.image === 'string' && b.image.startsWith('data:')) {
    if (b.image.length > 12 * 1024 * 1024) { const e = new Error('图片过大'); e.status = 413; throw e; }
    ref = await IMG.saveDataImage(req.username, uid, b.image, 'purchase');
  } else if (_kvRef(b.image)) ref = b.image;
  if (b.stageImage && b.stageName) {
    let ex = {};
    try { ex = JSON.parse(oldImgRef && String(oldImgRef).startsWith('{') ? oldImgRef : '{}'); } catch (e) { ex = {}; }
    if (typeof ex !== 'object') ex = {};
    if (!b.image) delete ex[b.stageName]; else ex[b.stageName] = ref;
    return JSON.stringify(ex);
  }
  return ref;
}

router.use(guard(['items']));

// ===== GET：合成旧形态（一 need 一行）=====
router.get('/items', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.json([]);
    const rows = await N.synthLegacyRows(uid);
    res.json(rows.map(rowToItem));
  } catch (e) { next(e); }
});

// ===== POST：创建（need + supplier [+ formal]）=====
router.post('/items', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.status(401).json({ error: '用户不存在' });
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name required' });
    const v = validateItem(b, null);
    if (v.error) return res.status(400).json({ error: v.error });
    const pid = _projId(b), pidx = _phaseIdx(b);
    if (!(await _ownedProject(uid, pid))) return res.status(404).json({ error: '项目不存在' });

    // 快速采购：单事务原子生成（与 /needs/quick 同语义）
    if (b.quick) {
      const price = v.price, qty = v.qty;
      if (price <= 0) return res.status(400).json({ error: '金额需大于 0' });
      const quickTotal = Math.round(price * qty * 100) / 100;
      if (quickTotal > 50) return res.status(400).json({ error: '快速采购仅支持 ¥50 以内' });
      let imageVal = '';
      if (typeof b.image === 'string' && b.image.startsWith('data:')) {
        if (b.image.length > 12 * 1024 * 1024) return res.status(413).json({ error: '图片过大' });
        imageVal = await IMG.saveDataImage(req.username, uid, b.image, 'purchase');
      } else if (_kvRef(b.image)) imageVal = b.image;
      const br = b.budgetRange ? N.parseBudgetRange(b.budgetRange) : null;
      const bmin = br ? br.min : quickTotal, bmax = br ? br.max : quickTotal;
      await conn.beginTransaction();
      const [nins] = await conn.query(
        `INSERT INTO purchase_needs (user_id,name,category,budget_min,budget_max,status,dimensions,
           project_id,phase_idx,is_virtual,is_quick,buy_reason,eval_summary)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uid, v.name, b.category || '其他', bmin, bmax, '已定点', JSON.stringify(N.DEFAULT_DIMENSIONS),
          pid, pidx, b.virtual ? 1 : 0, 1, b.buyReason || '', b.evalSummary || '']);
      const needId = nins.insertId;
      const [sins] = await conn.query(
        'INSERT INTO purchase_suppliers (user_id,need_id,name,platform,price,scores,sort_order) VALUES (?,?,?,?,?,\'{}\',0)',
        [uid, needId, v.name, b.platform || '拼多多', price]);
      const supplierId = sins.insertId;
      await conn.query('UPDATE purchase_needs SET selected_supplier_id = ?, decided_at = ? WHERE id = ?', [supplierId, H.bjNow(), needId]);
      const [oins] = await conn.query(
        `INSERT INTO purchase_orders (user_id,need_id,supplier_id,role,qty,price_paid,status,date_ms,image_ref,note,
           installments,installment_amount,installment_start,installment_paid,is_quick,created_at_text,arrived_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uid, needId, supplierId, 'formal', qty, price, '已到', b.date ? _dateMs(b.date) : Date.now(),
          imageVal, b.note || '', v.installments, v.instAmount, v.instStart, Number(b.installmentPaid) || 0,
          1, H.bjNow(), H.bjNow()]);
      await conn.commit();
      return res.json({ id: 'rec_' + needId, orderId: 'rec_' + oins.insertId });
    }

    // 普通创建
    let imageVal = '';
    if (typeof b.image === 'string' && b.image) {
      if (b.image.startsWith('data:')) {
        if (b.image.length > 12 * 1024 * 1024) return res.status(413).json({ error: '图片过大' });
        imageVal = await IMG.saveDataImage(req.username, uid, b.image, 'purchase');
      } else if (_kvRef(b.image)) imageVal = b.image;
      if (b.stageImage && b.stageName) {
        let existing = {};
        try { if (imageVal.startsWith('{')) existing = JSON.parse(imageVal); } catch (e) { existing = {}; }
        if (typeof existing !== 'object') existing = {};
        existing[b.stageName] = imageVal;
        imageVal = JSON.stringify(existing);
      }
    }

    const legacyStatus = v.status || '待审批';
    const mappedOrder = N.legacyToOrderStatus(legacyStatus); // 待评估 → null
    const needStatus = N.legacyToNeedStatus(legacyStatus);
    const br = b.budgetRange ? N.parseBudgetRange(b.budgetRange) : null;
    const bmin = br ? br.min : null, bmax = br ? br.max : null;
    const dims = JSON.stringify(N.DEFAULT_DIMENSIONS);

    await conn.beginTransaction();
    const [nins] = await conn.query(
      `INSERT INTO purchase_needs (user_id,name,category,budget_min,budget_max,status,dimensions,
         project_id,phase_idx,is_virtual,is_quick,buy_reason,eval_summary)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, v.name, b.category || '其他', bmin, bmax, needStatus, dims,
        pid, pidx, b.virtual ? 1 : 0, 0, b.buyReason || '', b.evalSummary || '']);
    const needId = nins.insertId;
    const [sins] = await conn.query(
      'INSERT INTO purchase_suppliers (user_id,need_id,name,platform,price,scores,sort_order) VALUES (?,?,?,?,?,\'{}\',0)',
      [uid, needId, v.name, b.platform || '拼多多', v.price]);
    const supplierId = sins.insertId;

    let orderId = null;
    if (mappedOrder) {
      const approvedAt = legacyStatus === '已审批' || ['已下单', '已到', '已退', '已归档'].includes(legacyStatus)
        ? H.bjNow() : null;
      const [oins] = await conn.query(
        `INSERT INTO purchase_orders (user_id,need_id,supplier_id,role,qty,price_paid,status,date_ms,image_ref,note,
           installments,installment_amount,installment_start,installment_paid,created_at_text,approved_at,
           ordered_at,arrived_at,archived_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uid, needId, supplierId, 'formal', v.qty, v.price, mappedOrder,
          b.date ? _dateMs(b.date) : Date.now(), imageVal, b.note || '',
          v.installments, v.instAmount, v.instStart, Number(b.installmentPaid) || 0,
          H.bjNow(), approvedAt,
          legacyStatus === '已下单' ? H.bjNow() : null,
          ['已到', '已退'].includes(legacyStatus) ? H.bjNow() : null,
          ['已归档', '已取消'].includes(legacyStatus) ? H.bjNow() : null]);
      orderId = oins.insertId;
    }
    if (needStatus === '已定点') {
      await conn.query('UPDATE purchase_needs SET selected_supplier_id = ?, decided_at = ? WHERE id = ?', [supplierId, H.bjNow(), needId]);
    }
    await conn.commit();
    res.json({ id: 'rec_' + needId, orderId: orderId ? 'rec_' + orderId : undefined });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

// ===== PUT：单条更新（字段分流）=====
router.put('/items', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ error: 'id required' });
    const g = await getOwnedGraph(uid, b.id);
    if (!g) return res.status(404).json({ error: 'not found' });
    const { need, suppliers, orders } = g;
    let formal = formalOf(orders);

    // 用合成旧形态做校验（price/qty/status 取自正式单）
    const synth = N.synthLegacyRow(need, suppliers, orders);
    const v = validateItem(b, synth);
    if (v.error) return res.status(400).json({ error: v.error });

    const npid = b.projectId !== undefined ? _projId(b) : need.project_id;
    const npidx = b.phaseIdx !== undefined ? _phaseIdx(b) : need.phase_idx;
    if (!(await _ownedProject(uid, npid))) return res.status(404).json({ error: '项目不存在' });

    await conn.beginTransaction();
    // 锁 need 行并复核正式单：两个并发 PUT/PATCH 不得各建一张正式单
    const [lockRows] = await conn.query('SELECT id, status FROM purchase_needs WHERE id = ? AND user_id = ? FOR UPDATE', [need.id, uid]);
    if (!lockRows.length) { await conn.rollback(); return res.status(404).json({ error: 'not found' }); }
    need.status = lockRows[0].status;
    if (!formal) {
      const [frows] = await conn.query("SELECT * FROM purchase_orders WHERE need_id = ? AND role = 'formal' ORDER BY id LIMIT 1", [need.id]);
      if (frows[0]) { formal = frows[0]; orders.push(frows[0]); }
    }

    // need 侧
    const needCols = {};
    if (b.name !== undefined) needCols.name = v.name;
    if (b.category !== undefined) needCols.category = String(b.category || '其他').slice(0, 30);
    if (b.budgetRange !== undefined) {
      const r = N.parseBudgetRange(b.budgetRange);
      needCols.budget_min = r ? r.min : null;
      needCols.budget_max = r ? r.max : null;
    }
    if (b.buyReason !== undefined) needCols.buy_reason = String(b.buyReason || '');
    if (b.evalSummary !== undefined) needCols.eval_summary = String(b.evalSummary || '');
    if (b.cancelReason !== undefined) needCols.cancel_reason = String(b.cancelReason || '').slice(0, 200);
    if (b.virtual !== undefined) needCols.is_virtual = b.virtual ? 1 : 0;
    if (b.projectId !== undefined) needCols.project_id = npid;
    if (b.phaseIdx !== undefined) needCols.phase_idx = npidx;

    // 供应商侧（平台/报价/图：单供应商需求直接改；多供应商改被定点或第一家）
    const sup = (need.selected_supplier_id && suppliers.find(s => Number(s.id) === Number(need.selected_supplier_id)))
      || suppliers[0] || null;
    const supCols = {};
    if (b.platform !== undefined && sup) supCols.platform = String(b.platform || '').slice(0, 20);
    if (b.price !== undefined && sup) supCols.price = v.price;

    // order 侧
    const orderCols = {};
    if (formal) {
      if (b.qty !== undefined) orderCols.qty = v.qty;
      if (b.price !== undefined) orderCols.price_paid = v.price;
      if (b.installments !== undefined) orderCols.installments = v.installments;
      if (b.installmentAmount !== undefined) orderCols.installment_amount = v.instAmount;
      if (b.installmentStart !== undefined) orderCols.installment_start = v.instStart;
      if (b.installmentPaid !== undefined) orderCols.installment_paid = Number(b.installmentPaid) || 0;
      if (b.date !== undefined) orderCols.date_ms = b.date ? _dateMs(b.date) : null;
      if (b.note !== undefined) orderCols.note = String(b.note || '');
      if (b.setDate && orderCols.date_ms === undefined) orderCols.date_ms = Date.now();
      if (b.image !== undefined) orderCols.image_ref = await saveImageRef(req, uid, b, formal.image_ref);
    } else if (b.image !== undefined && sup) {
      // 无正式单：图落供应商
      supCols.image_ref = await saveImageRef(req, uid, b, sup.image_ref);
    }

    // 状态（旧 8 状态 → 宽松映射）
    let statusChanged = false;
    const oldStatus = synth.status;
    if (b.status !== undefined && b.status !== oldStatus) {
      statusChanged = true;
      const w = legacyStatusWrite(String(b.status), need, formal);
      if (w.error) { await conn.rollback(); return res.status(400).json({ error: w.error }); }
      Object.assign(needCols, w.needCols);
      if (w.deleteFormal) {
        await conn.query('DELETE FROM purchase_orders WHERE id = ? AND status = ?', [formal.id, '待下单']);
      } else {
        Object.assign(orderCols, w.orderPatch);
      }
      // 无正式单但新状态需要执行体（如 待审批 直接 POST 过来的反例）→ 补建
      if (!formal && !w.deleteFormal && w.orderPatch.status) {
        const [ins] = await conn.query(
          `INSERT INTO purchase_orders (user_id,need_id,supplier_id,role,qty,price_paid,status,date_ms,note,
             installments,installment_amount,installment_start,installment_paid,created_at_text,approved_at,
             ordered_at,arrived_at,archived_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [uid, need.id, sup ? sup.id : null, 'formal', v.qty, v.price, w.orderPatch.status,
            b.date ? _dateMs(b.date) : Date.now(), b.note || '',
            v.installments, v.instAmount, v.instStart, Number(b.installmentPaid) || 0,
            H.bjNow(), w.orderPatch.approved_at || null, w.orderPatch.ordered_at || null,
            w.orderPatch.arrived_at || null, w.orderPatch.archived_at || null]);
        void ins;
      }
      // 入账状态清理待办（旧语义）
      if (b.status === '已退' || b.status === '已取消') {
        await conn.query('DELETE FROM todos WHERE user_id = ? AND link_type = ? AND link_id = ?', [uid, '采购', 'rec_' + need.id]);
      }
    }

    await applyPatchCols(conn, 'purchase_needs', need.id, needCols);
    if (sup && Object.keys(supCols).length) await applyPatchCols(conn, 'purchase_suppliers', sup.id, supCols);
    if (formal && Object.keys(orderCols).length) await applyPatchCols(conn, 'purchase_orders', formal.id, orderCols);
    await conn.commit();

    if (statusChanged) {
      await logOp(req.username, 'status_change', oldStatus + ' → ' + b.status + '（' + (b.name || need.name) + '）', clientIP(req));
    }
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

// ===== PATCH：批量状态/备注/取消原因（旧 UI 批量入口）=====
router.patch('/items', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    if (!Array.isArray(b.ids) || !b.ids.length) return res.status(400).json({ error: 'ids required' });
    if (b.ids.length > 500) return res.status(400).json({ error: '一次最多操作 500 条' });
    if (b.status !== undefined && !ITEM_STATUS.has(String(b.status))) return res.status(400).json({ error: '无效状态' });
    if (b.note !== undefined && String(b.note).length > 5000) return res.status(400).json({ error: '备注过长' });
    if (b.cancelReason !== undefined && String(b.cancelReason).length > 200) return res.status(400).json({ error: '取消原因过长' });
    const results = [];
    for (const id of b.ids) {
      const g = await getOwnedGraph(uid, id);
      if (!g) { results.push({ id, ok: false }); continue; }
      const { need, suppliers, orders } = g;
      let formal = formalOf(orders);
      const synth = N.synthLegacyRow(need, suppliers, orders);
      const conn = await db.pool.getConnection();
      try {
        await conn.beginTransaction();
        const [lockRows] = await conn.query('SELECT id, status FROM purchase_needs WHERE id = ? AND user_id = ? FOR UPDATE', [need.id, uid]);
        if (!lockRows.length) throw new Error('not found');
        need.status = lockRows[0].status;
        if (!formal) {
          const [frows] = await conn.query("SELECT * FROM purchase_orders WHERE need_id = ? AND role = 'formal' ORDER BY id LIMIT 1", [need.id]);
          if (frows[0]) { formal = frows[0]; orders.push(frows[0]); }
        }
        const needCols = {}, orderCols = {};
        let deleteFormal = false;
        if (b.status !== undefined && String(b.status) !== synth.status) {
          const w = legacyStatusWrite(String(b.status), need, formal);
          if (w.error) throw new Error(w.error);
          Object.assign(needCols, w.needCols);
          if (w.deleteFormal) deleteFormal = true;
          else Object.assign(orderCols, w.orderPatch);
          if (!formal && !w.deleteFormal && w.orderPatch.status) {
            const sup = suppliers[0] || null;
            await conn.query(
              `INSERT INTO purchase_orders (user_id,need_id,supplier_id,role,qty,price_paid,status,date_ms,
                 created_at_text,approved_at,ordered_at,arrived_at,archived_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [uid, need.id, sup ? sup.id : null, 'formal', synth.qty, synth.price, w.orderPatch.status,
                synth.date_ms, H.bjNow(), w.orderPatch.approved_at || null, w.orderPatch.ordered_at || null,
                w.orderPatch.arrived_at || null, w.orderPatch.archived_at || null]);
          }
        }
        if (b.note !== undefined) orderCols.note = String(b.note || '');
        if (b.cancelReason !== undefined) needCols.cancel_reason = String(b.cancelReason || '');

        if (deleteFormal && formal) await conn.query('DELETE FROM purchase_orders WHERE id = ? AND status = ?', [formal.id, '待下单']);
        await applyPatchCols(conn, 'purchase_needs', need.id, needCols);
        if (formal && !deleteFormal && Object.keys(orderCols).length) await applyPatchCols(conn, 'purchase_orders', formal.id, orderCols);
        // 无正式单时 note 落供应商备注（避免丢数据）
        if (!formal && b.note !== undefined && suppliers[0]) {
          await applyPatchCols(conn, 'purchase_suppliers', suppliers[0].id, { note: String(b.note || '') });
        }
        await conn.commit();
        results.push({ id, ok: true });

        // 旧语义：已退/已取消清关联待办
        if (b.status === '已退' || b.status === '已取消') {
          await db.exec('DELETE FROM todos WHERE user_id = ? AND link_type = ? AND link_id = ?', [uid, '采购', 'rec_' + need.id]).catch(() => {});
        }
      } catch (e) {
        try { await conn.rollback(); } catch (x) {}
        results.push({ id, ok: false, error: e.message });
      } finally { conn.release(); }
    }
    res.json({ results, updated: results.filter(r => r.ok).length });
  } catch (e) { next(e); }
});

// ===== DELETE：级联删（入账中拒绝）=====
router.delete('/items', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const n = H.numFromId(id);
    if (!n) return res.json({ ok: true });
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM purchase_needs WHERE id = ? AND user_id = ? FOR UPDATE', [n, uid]);
    if (!rows[0]) { await conn.rollback(); return res.json({ ok: true }); }
    const [spent] = await conn.query(
      "SELECT COUNT(*) AS c FROM purchase_orders WHERE need_id = ? AND status IN ('已下单','已到','已归档')", [n]);
    if (Number(spent[0].c) > 0) {
      await conn.rollback();
      return res.status(400).json({ error: '已有入账记录，请先退货或归档后再删除' });
    }
    await conn.query('DELETE FROM todos WHERE user_id = ? AND link_type = ? AND link_id = ?', [uid, '采购', 'rec_' + n]);
    await conn.query('DELETE FROM purchase_needs WHERE id = ? AND user_id = ?', [n, uid]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

module.exports = router;
