'use strict';
// /api/expenses 镜像 CF expenses.js：日期字符串⇄毫秒、分摊字段、类型校验
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const { requireAuth, guard } = require('../middleware');

const router = express.Router();

function _projId(b){var m=/^rec_(\d+)$/.exec(String(b.projectId||''));return m?Number(m[1]):null;}
function _phaseIdx(b){if(b.phaseIdx===null||b.phaseIdx===undefined||b.phaseIdx==='')return null;var n=Number(b.phaseIdx);return isNaN(n)?null:n;}
router.use(guard(['expenses']));

function rowToExpense(r) {
  return {
    id: 'rec_' + r.id,
    '日期': H.tsToBjStr(r.date_ms),
    '类型': r.type || '支出',
    '分类': r.category || '其他',
    '金额': Number(r.amount) || 0,
    '备注': r.note || '',
    '分摊周数': Number(r.split_weeks) || 0,
    '分摊开始周': r.split_start_week || '',
    '图片': r.image_ref || '',
    '项目ID': r.project_id ? 'rec_' + r.project_id : '',
    '阶段': r.phase_idx == null ? null : Number(r.phase_idx),
  };
}

router.get('/expenses', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.json([]);
    const rows = await db.query('SELECT * FROM expenses WHERE user_id = ? ORDER BY id', [uid]);
    res.json(rows.map(rowToExpense));
  } catch (e) { next(e); }
});

router.post('/expenses', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.status(401).json({ error: '用户不存在' });
    const b = req.body || {};
    const amount = Number(b.amount) || 0;
    if (amount < 0 || amount > 999999) return res.status(400).json({ error: '金额需在 0 ~ 999999 之间' });
    const validTypes = ['支出', '收入', '采购'];
    if (b.type && !validTypes.includes(b.type)) return res.status(400).json({ error: '无效类型' });
    let imageRef = '';
    if (b.imageKey) imageRef = 'kv:' + b.imageKey;
    else if (b.image && b.image.length <= 30000) imageRef = b.image;
    const [ins] = await db.pool.query(
      `INSERT INTO expenses (user_id,type,category,amount,date_ms,note,image_ref,split_weeks,split_start_week,project_id,phase_idx)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, b.type || '支出', b.category || '其他', amount, H.dateStrToTs(b.date),
        String(b.note || '').slice(0, 500), imageRef,
        b.splitWeeks ? Number(b.splitWeeks) || 0 : null, b.splitStartWeek || null, _projId(b), _phaseIdx(b)]);
    res.status(201).json({ id: 'rec_' + ins.insertId, ok: true });
  } catch (e) { next(e); }
});

router.put('/expenses', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ error: 'Missing id' });
    const n = H.numFromId(b.id);
    const old = await db.one('SELECT * FROM expenses WHERE id = ? AND user_id = ?', [n, uid]);
    if (!old) return res.status(404).json({ error: 'not found' });
    const cols = {};
    if (b.type !== undefined) cols.type = b.type;
    if (b.category !== undefined) cols.category = b.category;
    if (b.amount !== undefined) {
      const amt = Number(b.amount);
      if (amt < 0 || amt > 999999) return res.status(400).json({ error: '金额需在 0 ~ 999999 之间' });
      cols.amount = amt;
    }
    if (b.note !== undefined) cols.note = String(b.note || '').slice(0, 500);
    if (b.splitWeeks !== undefined) cols.split_weeks = Number(b.splitWeeks) || 0;
    if (b.splitStartWeek !== undefined) cols.split_start_week = b.splitStartWeek || '';
    if (b.date !== undefined) cols.date_ms = H.dateStrToTs(b.date);
    if (b.projectId !== undefined) cols.project_id = _projId(b);
    if (b.phaseIdx !== undefined) cols.phase_idx = _phaseIdx(b);
    if (b.imageKey !== undefined) cols.image_ref = b.imageKey ? 'kv:' + b.imageKey : '';
    else if (b.image !== undefined) { if (b.image && b.image.length <= 30000) cols.image_ref = b.image; else if (!b.image) cols.image_ref = ''; }
    const sets = Object.keys(cols).map(k => k + ' = ?').join(', ');
    if (sets) await db.exec('UPDATE expenses SET ' + sets + ' WHERE id = ?', [...Object.values(cols), old.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/expenses', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const n = H.numFromId(req.query.id);
    if (!n) return res.status(400).json({ error: 'Missing id' });
    await db.exec('DELETE FROM expenses WHERE id = ? AND user_id = ?', [n, uid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
