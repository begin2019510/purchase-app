'use strict';
// /api/items 镜像 CF items.js：中文键 JSON、状态联动 Todo、阶段图片、分期字段
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const IMG = require('../lib/images');
const { requireAuth, guard, clientIP } = require('../middleware');
const { logOp } = require('../lib/helpers');

const router = express.Router();

function rowToItem(r) {
  return {
    id: 'rec_' + r.id,
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
  };
}

async function getOwnedItem(userId, id) {
  const n = H.numFromId(id);
  if (!n) return null;
  return db.one('SELECT * FROM purchases WHERE id = ? AND user_id = ?', [n, userId]);
}

router.use(guard(['items']));

router.get('/items', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.json([]);
    const rows = await db.query('SELECT * FROM purchases WHERE user_id = ? ORDER BY id', [uid]);
    res.json(rows.map(rowToItem));
  } catch (e) { next(e); }
});

router.post('/items', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.status(401).json({ error: '用户不存在' });
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'name required' });
    let imageRef = '';
    if (b.image && b.image.startsWith('data:')) imageRef = await IMG.saveDataImage(req.username, uid, b.image, 'purchase');
    else if (b.image && b.image.startsWith('kv:')) imageRef = b.image;

    let imageVal = imageRef;
    if (b.stageImage && b.stageName) {
      let existing = {};
      try { if (imageRef.startsWith('{')) existing = JSON.parse(imageRef); } catch (e) { existing = {}; }
      if (typeof existing !== 'object') existing = {};
      existing[b.stageName] = imageRef;
      imageVal = JSON.stringify(existing);
    }
    const [ins] = await db.pool.query(
      `INSERT INTO purchases (user_id,name,platform,category,price,qty,status,date_ms,note,created_at_text,
        eval_summary,buy_reason,budget_range,installments,installment_amount,installment_start,installment_paid,is_quick,is_virtual,image_ref)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, b.name, b.platform || '拼多多', b.category || '其他', b.price || 0, b.qty || 1,
        b.status || (b.quick ? '已到' : '待审批'),
        b.date ? new Date(b.date).getTime() : Date.now(), b.note || '', H.bjNow(),
        b.evalSummary || '', b.buyReason || '', b.budgetRange || '',
        String(b.installments || 0), String(b.installmentAmount || 0), b.installmentStart || '', '1',
        b.quick ? 1 : 0, b.virtual ? 1 : 0, imageVal]);
    if (b.quick) await db.exec('UPDATE purchases SET arrived_at = ? WHERE id = ?', [H.bjNow(), ins.insertId]);
    res.json({ id: 'rec_' + ins.insertId });
  } catch (e) { next(e); }
});

router.put('/items', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ error: 'id required' });
    const old = await getOwnedItem(uid, b.id);
    if (!old) return res.status(404).json({ error: 'not found' });

    const cols = {};
    const map = {
      name: 'name', platform: 'platform', price: 'price', qty: 'qty', status: 'status',
      category: 'category', note: 'note', evalSummary: 'eval_summary', buyReason: 'buy_reason',
      budgetRange: 'budget_range', cancelReason: 'cancel_reason', installmentStart: 'installment_start',
    };
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) cols[col] = b[k];
    if (b.date !== undefined) cols.date_ms = b.date ? new Date(b.date).getTime() : null;
    if (b.installments !== undefined) cols.installments = String(b.installments);
    if (b.installmentAmount !== undefined) cols.installment_amount = String(b.installmentAmount);
    if (b.installmentPaid !== undefined) cols.installment_paid = String(b.installmentPaid);
    if (b.virtual !== undefined) cols.is_virtual = b.virtual ? 1 : 0;
    if (b.setDate && cols.date_ms === undefined) cols.date_ms = Date.now();

    // 图片（阶段语义与 CF PUT 一致）
    if (b.image !== undefined) {
      let ref = '';
      if (b.image && b.image.startsWith('data:')) ref = await IMG.saveDataImage(req.username, uid, b.image, 'purchase');
      else if (b.image && b.image.startsWith('kv:')) ref = b.image;
      if (b.stageImage && b.stageName) {
        let ex = {};
        try { ex = JSON.parse(old.image_ref && old.image_ref.startsWith('{') ? old.image_ref : (b.image && b.image.startsWith('{') ? b.image : '{}')); } catch (e) { ex = {}; }
        if (typeof ex !== 'object') ex = {};
        if (!b.image) delete ex[b.stageName]; else ex[b.stageName] = ref;
        cols.image_ref = JSON.stringify(ex);
      } else {
        cols.image_ref = ref;
      }
    }

    const sets = Object.keys(cols).map(k => k + ' = ?').join(', ');
    if (sets) await db.exec('UPDATE purchases SET ' + sets + ' WHERE id = ?', [...Object.values(cols), old.id]);

    if (b.status !== undefined && old.status && b.status !== old.status) {
      await logOp(req.username, 'status_change', old.status + ' → ' + b.status + '（' + (b.name || old.name) + '）', clientIP(req));
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.patch('/items', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    if (!b.ids || !b.ids.length) return res.status(400).json({ error: 'ids required' });
    const timeMap = { '待评估': 'created_at_text', '待审批': 'created_at_text', '已审批': 'approved_at', '已下单': 'ordered_at', '已到': 'arrived_at', '已退': 'arrived_at', '已归档': 'archived_at', '已取消': 'archived_at' };
    const timeCol = b.status ? timeMap[b.status] : null;
    const results = [];
    for (const id of b.ids) {
      const item = await getOwnedItem(uid, id);
      if (!item) { results.push({ id, ok: false }); continue; }
      const cols = {}; const vals = [];
      if (b.status) { cols['status'] = b.status; }
      if (timeCol) { cols[timeCol] = H.bjNow(); }
      if (b.note !== undefined) cols['note'] = b.note;
      if (b.cancelReason !== undefined) cols['cancel_reason'] = b.cancelReason;
      const sets = Object.keys(cols).map(k => '`' + k + '` = ?').join(', ');
      if (sets) await db.exec('UPDATE purchases SET ' + sets + ' WHERE id = ?', [...Object.values(cols), item.id]);
      results.push({ id, ok: true });

      // Todo 联动（镜像 CF 行为）
      const itemName = item.name || '商品';
      const instPeriods = Number(item.installments) || 0;
      const instAmount = Number(item.installment_amount) || 0;
      if (b.status === '已审批') await createLinkedTodo(uid, '下单：' + itemName, null, '高', 'rec_' + item.id);
      if (b.status === '已下单' && instPeriods > 1) {
        for (let p = 1; p <= instPeriods; p++) {
          const due = calcInstallmentDate(item.date_ms || Date.now(), p);
          await createLinkedTodo(uid, `第${p}期还款 ¥${instAmount}`, due, '中', 'rec_' + item.id);
        }
      }
      if (b.status === '已到') await completeLinkedTodos(uid, 'rec_' + item.id, '下单');
      if (b.status === '已退' || b.status === '已取消') await deleteLinkedTodos(uid, 'rec_' + item.id);
    }
    res.json({ results, updated: results.filter(r => r.ok).length });
  } catch (e) { next(e); }
});

router.delete('/items', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const item = await getOwnedItem(uid, id);
    if (!item) return res.json({ ok: true });
    await db.exec('DELETE FROM purchases WHERE id = ?', [item.id]);
    await deleteLinkedTodos(uid, id).catch(() => {});
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ===== Todo 联动（直接操作 todos 表）=====
async function createLinkedTodo(uid, title, dueDate, priority, linkId) {
  try {
    const dueMs = dueDate ? new Date(dueDate).getTime() : null;
    await db.exec(
      `INSERT INTO todos (user_id,title,priority,category,status,\`repeat\`,subtasks,link_type,link_id,due_ms,due_iso)
       VALUES (?,?,?,'采购','待办','无','[]','采购',?,?,?)`,
      [uid, title.slice(0, 200), priority || '中', linkId, dueMs, dueDate || '']);
  } catch (e) { console.error('createLinkedTodo:', e.message); }
}
async function deleteLinkedTodos(uid, itemId) {
  try { await db.exec('DELETE FROM todos WHERE user_id = ? AND link_type = ? AND link_id = ?', [uid, '采购', itemId]); }
  catch (e) { console.error('deleteLinkedTodos:', e.message); }
}
async function completeLinkedTodos(uid, itemId, titlePrefix) {
  try {
    await db.exec(
      "UPDATE todos SET status = '已完成', completed_ms = ? WHERE user_id = ? AND link_type = '采购' AND link_id = ? AND title LIKE ? AND status <> '已完成'",
      [Date.now(), uid, itemId, titlePrefix + '%']);
  } catch (e) { console.error('completeLinkedTodos:', e.message); }
}
function calcInstallmentDate(baseMs, period) {
  const d = new Date(Number(baseMs));
  d.setMonth(d.getMonth() + period);
  d.setDate(15);
  return d.toISOString().slice(0, 10);
}

module.exports = router;
