'use strict';
// /api/items 镜像 CF items.js：中文键 JSON、状态联动 Todo、阶段图片、分期字段
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const IMG = require('../lib/images');
const { requireAuth, guard, clientIP } = require('../middleware');
const { logOp } = require('../lib/helpers');

const router = express.Router();

const ITEM_STATUS = new Set(['待评估', '待审批', '已审批', '已下单', '已到', '已退', '已归档', '已取消']);
const MAX_MONEY = 9999999;

function _projId(b){var s=String(b.projectId||'').trim();var m=/^(?:rec_)?(\d+)$/.exec(s);return m?Number(m[1]):null;}
function _phaseIdx(b){if(b.phaseIdx===null||b.phaseIdx===undefined||b.phaseIdx==='')return null;var n=Number(b.phaseIdx);return Number.isInteger(n)&&n>=0&&n<=5?n:null;}
function _money(v){if(v===undefined||v===null||v==='')return 0;var n=Number(v);return Number.isFinite(n)?n:NaN;}
function _int(v,def){if(v===undefined||v===null||v==='')return def;var n=Number(v);return Number.isInteger(n)?n:NaN;}
function _dateMs(v){if(v===undefined||v===null||v==='')return null;var t=new Date(v).getTime();return Number.isFinite(t)?t:NaN;}
async function _ownedProject(uid,pid){if(!pid)return true;return !!(await db.one('SELECT id FROM projects WHERE id=? AND user_id=?',[pid,uid]));}

// 表单校验：只允许有限的金额/数量/状态，防止负值、NaN 和超长文本写库
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
  if (b.installmentPaid !== undefined) {
    const paid = _int(b.installmentPaid, 0);
    if (Number.isNaN(paid) || paid < 0 || paid > installments) return { error: '已还期数不正确' };
  }
  if (b.date !== undefined) { const t = _dateMs(b.date); if (Number.isNaN(t)) return { error: '日期格式不正确' }; }
  for (const [k, max] of [['platform', 20], ['category', 30], ['budgetRange', 50], ['cancelReason', 200], ['note', 5000], ['evalSummary', 5000], ['buyReason', 5000]]) {
    if (b[k] !== undefined && String(b[k] == null ? '' : b[k]).length > max) return { error: k + ' 过长' };
  }
  if (b.projectId !== undefined && b.projectId && !_projId(b)) return { error: '项目ID格式不正确' };
  if (b.phaseIdx !== undefined && b.phaseIdx !== null && b.phaseIdx !== '' && _phaseIdx(b) === null) return { error: '阶段序号不正确' };
  return { name, price, qty, status, installments, instAmount, instStart };
}

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
    '项目ID': r.project_id ? 'rec_' + r.project_id : '',
    '阶段': r.phase_idx == null ? null : Number(r.phase_idx),
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
    const v = validateItem(b, null);
    if (v.error) return res.status(400).json({ error: v.error });
    const pid = _projId(b), pidx = _phaseIdx(b);
    if (!(await _ownedProject(uid, pid))) return res.status(404).json({ error: '项目不存在' });
    let imageRef = '';
    if (typeof b.image === 'string' && b.image.startsWith('data:')) {
      if (b.image.length > 12 * 1024 * 1024) return res.status(413).json({ error: '图片过大' });
      imageRef = await IMG.saveDataImage(req.username, uid, b.image, 'purchase');
    } else if (typeof b.image === 'string' && b.image.startsWith('kv:')) imageRef = b.image;

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
        eval_summary,buy_reason,budget_range,installments,installment_amount,installment_start,installment_paid,is_quick,is_virtual,image_ref,project_id,phase_idx)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, v.name, b.platform || '拼多多', b.category || '其他', v.price, v.qty,
        v.status || (b.quick ? '已到' : '待审批'),
        b.date ? _dateMs(b.date) : Date.now(), b.note || '', H.bjNow(),
        b.evalSummary || '', b.buyReason || '', b.budgetRange || '',
        String(v.installments), String(v.instAmount), v.instStart, String(Number(b.installmentPaid) || 0),
        b.quick ? 1 : 0, b.virtual ? 1 : 0, imageVal, pid, pidx]);
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

    const v = validateItem(b, old);
    if (v.error) return res.status(400).json({ error: v.error });
    const npid = b.projectId !== undefined ? _projId(b) : old.project_id;
    const npidx = b.phaseIdx !== undefined ? _phaseIdx(b) : old.phase_idx;
    if (!(await _ownedProject(uid, npid))) return res.status(404).json({ error: '项目不存在' });
    const cols = {};
    const map = {
      name: 'name', platform: 'platform', price: 'price', qty: 'qty', status: 'status',
      category: 'category', note: 'note', evalSummary: 'eval_summary', buyReason: 'buy_reason',
      budgetRange: 'budget_range', cancelReason: 'cancel_reason', installmentStart: 'installment_start',
    };
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) cols[col] = b[k];
    if (b.name !== undefined) cols.name = v.name;
    if (b.price !== undefined) cols.price = v.price;
    if (b.qty !== undefined) cols.qty = v.qty;
    if (b.status !== undefined) cols.status = v.status;
    if (b.installmentStart !== undefined) cols.installment_start = v.instStart;
    if (b.date !== undefined) cols.date_ms = b.date ? _dateMs(b.date) : null;
    if (b.installments !== undefined) cols.installments = String(v.installments);
    if (b.installmentAmount !== undefined) cols.installment_amount = String(v.instAmount);
    if (b.installmentPaid !== undefined) cols.installment_paid = String(Number(b.installmentPaid) || 0);
    if (b.virtual !== undefined) cols.is_virtual = b.virtual ? 1 : 0;
    if (b.projectId !== undefined) cols.project_id = npid;
    if (b.phaseIdx !== undefined) cols.phase_idx = npidx;
    if (b.setDate && cols.date_ms === undefined) cols.date_ms = Date.now();

    // 图片（阶段语义与 CF PUT 一致）
    if (b.image !== undefined) {
      let ref = '';
      if (typeof b.image === 'string' && b.image.startsWith('data:')) {
        if (b.image.length > 12 * 1024 * 1024) return res.status(413).json({ error: '图片过大' });
        ref = await IMG.saveDataImage(req.username, uid, b.image, 'purchase');
      } else if (typeof b.image === 'string' && b.image.startsWith('kv:')) ref = b.image;
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
    if (!Array.isArray(b.ids) || !b.ids.length) return res.status(400).json({ error: 'ids required' });
    if (b.ids.length > 500) return res.status(400).json({ error: '一次最多操作 500 条' });
    if (b.status !== undefined && !ITEM_STATUS.has(String(b.status))) return res.status(400).json({ error: '无效状态' });
    if (b.note !== undefined && String(b.note).length > 5000) return res.status(400).json({ error: '备注过长' });
    if (b.cancelReason !== undefined && String(b.cancelReason).length > 200) return res.status(400).json({ error: '取消原因过长' });
    const timeMap = { '待评估': 'created_at_text', '待审批': 'created_at_text', '已审批': 'approved_at', '已下单': 'ordered_at', '已到': 'arrived_at', '已退': 'arrived_at', '已归档': 'archived_at', '已取消': 'archived_at' };
    const timeCol = b.status ? timeMap[b.status] : null;
    const results = [];
    for (const id of b.ids) {
      const item = await getOwnedItem(uid, id);
      if (!item) { results.push({ id, ok: false }); continue; }
      const statusChanged = b.status !== undefined && b.status !== item.status;
      const cols = {}; const vals = [];
      if (b.status) { cols['status'] = b.status; }
      if (timeCol && statusChanged) { cols[timeCol] = H.bjNow(); }
      if (b.note !== undefined) cols['note'] = b.note;
      if (b.cancelReason !== undefined) cols['cancel_reason'] = b.cancelReason;
      const sets = Object.keys(cols).map(k => '`' + k + '` = ?').join(', ');
      if (sets) await db.exec('UPDATE purchases SET ' + sets + ' WHERE id = ?', [...Object.values(cols), item.id]);
      results.push({ id, ok: true });

      // Todo 联动（镜像 CF 行为）：只在状态真正变化时触发，且插入前按标题去重
      if (!statusChanged) continue;
      const itemName = item.name || '商品';
      const instPeriods = Number(item.installments) || 0;
      const instAmount = Number(item.installment_amount) || 0;
      if (b.status === '已审批') await createLinkedTodo(uid, '下单：' + itemName, null, '高', 'rec_' + item.id);
      if (b.status === '已下单' && instPeriods > 1) {
        for (let p = 1; p <= instPeriods; p++) {
          const due = calcInstallmentDate(item, p);
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
    const t = String(title).slice(0, 200);
    const dup = await db.one('SELECT id FROM todos WHERE user_id = ? AND link_type = ? AND link_id = ? AND title = ? LIMIT 1', [uid, '采购', linkId, t]);
    if (dup) return;
    // YYYY-MM-DD 按北京时间零点落库，避免 UTC 零点在东八区显示成前一天
    const dueMs = dueDate ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate + 'T00:00:00+08:00' : dueDate) : null;
    await db.exec(
      `INSERT INTO todos (user_id,title,priority,category,status,\`repeat\`,subtasks,link_type,link_id,due_ms,due_iso)
       VALUES (?,?,?,'采购','待办','无','[]','采购',?,?,?)`,
      [uid, t, priority || '中', linkId, Number.isFinite(dueMs) ? dueMs : null, dueDate || '']);
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
// 第 1 期落在「分期开始月」的 15 日；开始月缺失时退回购买月。
// 纯整数月运算，避免 setMonth 在 1/31 +1 个月时溢出到 3 月。
function calcInstallmentDate(item, period) {
  let sy, sm;
  const start = String(item.installment_start || '');
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(start)) {
    sy = Number(start.slice(0, 4)); sm = Number(start.slice(5, 7));
  } else {
    const pd = new Date((Number(item.date_ms) || Date.now()) + 8 * 3600000);
    sy = pd.getUTCFullYear(); sm = pd.getUTCMonth() + 1;
  }
  const idx = sy * 12 + (sm - 1) + Math.max(0, (Number(period) || 1) - 1);
  return Math.floor(idx / 12) + '-' + String(idx % 12 + 1).padStart(2, '0') + '-15';
}

module.exports = router;
