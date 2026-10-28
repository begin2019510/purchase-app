'use strict';
// /api/expenses 镜像 CF expenses.js：日期字符串⇄毫秒、分摊字段、类型校验
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const { requireAuth, guard } = require('../middleware');

const router = express.Router();

const TYPES = ['支出', '收入', '采购'];
function _projId(b){var s=String(b.projectId||'').trim();var m=/^(?:rec_)?(\d+)$/.exec(s);return m?Number(m[1]):null;}
function _phaseIdx(b){if(b.phaseIdx===null||b.phaseIdx===undefined||b.phaseIdx==='')return null;var n=Number(b.phaseIdx);return Number.isInteger(n)&&n>=0&&n<=5?n:null;}
function _dateMs(v){const t=H.dateStrToTs(v);return Number.isFinite(t)?t:NaN;}
async function _ownedProject(uid,pid){if(!pid)return true;return !!(await db.one('SELECT id FROM projects WHERE id=? AND user_id=?',[pid,uid]));}
function _imageRef(b) {
  if (b.imageKey !== undefined) {
    const k = String(b.imageKey || '');
    if (!k) return '';
    return /^[A-Za-z0-9._-]{1,200}$/.test(k) ? 'kv:' + k : null;
  }
  if (b.image !== undefined) {
    const v = String(b.image || '');
    if (!v) return '';
    return /^data:image\//i.test(v) && v.length <= 30000 ? v : null;
  }
  return undefined;
}
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
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 999999) return res.status(400).json({ error: '金额需在 0 ~ 999999 之间' });
    if (b.type && !TYPES.includes(b.type)) return res.status(400).json({ error: '无效类型' });
    const dm = b.date == null || b.date === '' ? Date.now() : _dateMs(b.date);
    if (Number.isNaN(dm)) return res.status(400).json({ error: '日期格式不正确' });
    const category = String(b.category || '其他');
    if (category.length > 30) return res.status(400).json({ error: '分类过长' });
    const imageRef = _imageRef(b);
    if (imageRef === null) return res.status(400).json({ error: '图片格式不正确' });
    const sw = b.splitWeeks == null || b.splitWeeks === '' ? null : Number(b.splitWeeks);
    if (sw !== null && (!Number.isInteger(sw) || sw < 0 || sw > 52)) return res.status(400).json({ error: '分摊周数需在 0~52 之间' });
    if (b.projectId && !_projId(b)) return res.status(400).json({ error: '项目ID格式不正确' });
    if (b.phaseIdx !== undefined && b.phaseIdx !== null && b.phaseIdx !== '' && _phaseIdx(b) === null) return res.status(400).json({ error: '阶段序号不正确' });
    const pid = _projId(b);
    if (!(await _ownedProject(uid, pid))) return res.status(404).json({ error: '项目不存在' });
    const [ins] = await db.pool.query(
      `INSERT INTO expenses (user_id,type,category,amount,date_ms,note,image_ref,split_weeks,split_start_week,project_id,phase_idx)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, b.type || '支出', category, amount, dm,
        String(b.note || '').slice(0, 500), imageRef || '',
        sw, String(b.splitStartWeek || '').slice(0, 20) || null, pid, _phaseIdx(b)]);
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
    if (b.type !== undefined) {
      if (!TYPES.includes(String(b.type))) return res.status(400).json({ error: '无效类型' });
      cols.type = b.type;
    }
    if (b.category !== undefined) {
      const c = String(b.category || '其他');
      if (c.length > 30) return res.status(400).json({ error: '分类过长' });
      cols.category = c;
    }
    if (b.amount !== undefined) {
      const amt = Number(b.amount);
      if (!Number.isFinite(amt) || amt < 0 || amt > 999999) return res.status(400).json({ error: '金额需在 0 ~ 999999 之间' });
      cols.amount = amt;
    }
    if (b.note !== undefined) cols.note = String(b.note || '').slice(0, 500);
    if (b.splitWeeks !== undefined) {
      const sw = Number(b.splitWeeks);
      if (!Number.isInteger(sw) || sw < 0 || sw > 52) return res.status(400).json({ error: '分摊周数需在 0~52 之间' });
      cols.split_weeks = sw;
    }
    if (b.splitStartWeek !== undefined) cols.split_start_week = String(b.splitStartWeek || '').slice(0, 20);
    if (b.date !== undefined) {
      const dm = b.date === '' ? Date.now() : _dateMs(b.date);
      if (Number.isNaN(dm)) return res.status(400).json({ error: '日期格式不正确' });
      cols.date_ms = dm;
    }
    if (b.projectId !== undefined || b.phaseIdx !== undefined) {
      if (b.projectId && !_projId(b)) return res.status(400).json({ error: '项目ID格式不正确' });
      if (b.phaseIdx !== undefined && b.phaseIdx !== null && b.phaseIdx !== '' && _phaseIdx(b) === null) return res.status(400).json({ error: '阶段序号不正确' });
      const pid = b.projectId !== undefined ? _projId(b) : (old.project_id || null);
      if (!(await _ownedProject(uid, pid))) return res.status(404).json({ error: '项目不存在' });
      if (b.projectId !== undefined) cols.project_id = pid;
      if (b.phaseIdx !== undefined) cols.phase_idx = _phaseIdx(b);
    }
    if (b.imageKey !== undefined || b.image !== undefined) {
      const ref = _imageRef(b);
      if (ref === null) return res.status(400).json({ error: '图片格式不正确' });
      cols.image_ref = ref;
    }
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
