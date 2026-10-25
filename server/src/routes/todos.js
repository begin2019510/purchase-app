'use strict';
// /api/todos 镜像 CF todos.js：英文 JSON 键、重复待办完成自动续期、软删/硬删
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const IMG = require('../lib/images');
const { requireAuth, guard } = require('../middleware');

const router = express.Router();
router.use(guard(['todos']));

function _phaseIdx(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null;
}

function rowToTodo(r) {
  return {
    id: 'rec_' + r.id,
    title: r.title || '',
    description: r.description || '',
    dueDate: r.due_iso || (r.due_ms != null ? Number(r.due_ms) : null),
    priority: r.priority || '中',
    category: r.category || '其他',
    status: r.status || '待办',
    repeat: r.repeat || '无',
    subtasks: r.subtasks || '',
    image: r.image_ref || '',
    linkType: r.link_type || '无',
    linkId: r.link_id || '',
    completedAt: r.completed_ms != null ? Number(r.completed_ms) : null,
    projectId: r.project_id || '',
    phaseIdx: r.phase_idx == null ? null : Number(r.phase_idx),
    tags: r.tags || '',
    order: Number(r.sort_no) || 0,
    reminders: r.reminders || '',
  };
}

router.get('/todos', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.json([]);
    const rows = await db.query('SELECT * FROM todos WHERE user_id = ? ORDER BY id', [uid]);
    res.json(rows.map(rowToTodo));
  } catch (e) { next(e); }
});

router.post('/todos', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.status(401).json({ error: '用户不存在' });
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'Title required' });
    let imageRef = '';
    if (b.image && b.image.startsWith('data:')) imageRef = await IMG.saveDataImage(req.username, uid, b.image, 'todo');
    else if (b.image) imageRef = b.image;
    const dueMs = b.dueDate ? new Date(b.dueDate).getTime() : null;
    const [ins] = await db.pool.query(
      `INSERT INTO todos (user_id,title,description,due_ms,due_iso,priority,category,status,\`repeat\`,subtasks,image_ref,link_type,link_id,project_id,phase_idx,tags,sort_no,reminders)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, String(b.title).slice(0, 200), String(b.description || '').slice(0, 2000), dueMs, b.dueDate || '',
        b.priority || '中', b.category || '其他', b.status || '待办', b.repeat || '无', b.subtasks || '[]',
        imageRef, b.linkType || '无', b.linkId || '', b.projectId || '', _phaseIdx(b.phaseIdx), b.tags || '[]', b.order || 0, '']);
    res.status(201).json({ id: 'rec_' + ins.insertId, ok: true });
  } catch (e) { next(e); }
});

router.put('/todos', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ error: 'Missing id' });
    const n = H.numFromId(b.id);
    const old = await db.one('SELECT * FROM todos WHERE id = ? AND user_id = ?', [n, uid]);
    if (!old) return res.status(404).json({ error: 'not found' });

    const cols = {};
    if (b.title !== undefined) cols.title = b.title;
    if (b.description !== undefined) cols.description = b.description;
    if (b.dueDate !== undefined) { cols.due_ms = b.dueDate ? new Date(b.dueDate).getTime() : null; cols.due_iso = b.dueDate || ''; }
    if (b.priority !== undefined) cols.priority = b.priority;
    if (b.category !== undefined) cols.category = b.category;
    if (b.status !== undefined) { cols.status = b.status; if (b.status === '已完成') cols.completed_ms = Date.now(); }
    if (b.repeat !== undefined) cols.repeat = b.repeat;
    if (b.subtasks !== undefined) cols.subtasks = b.subtasks;
    if (b.linkType !== undefined) cols.link_type = b.linkType;
    if (b.linkId !== undefined) cols.link_id = b.linkId;
    if (b.projectId !== undefined) cols.project_id = b.projectId;
    if (b.phaseIdx !== undefined) cols.phase_idx = _phaseIdx(b.phaseIdx);
    if (b.tags !== undefined) cols.tags = b.tags;
    if (b.order !== undefined) cols.sort_no = b.order;
    if (b.reminders !== undefined) cols.reminders = b.reminders;
    if (b.image !== undefined) {
      if (b.image && b.image.startsWith('data:')) cols.image_ref = await IMG.saveDataImage(req.username, uid, b.image, 'todo');
      else cols.image_ref = b.image || '';
    }
    const sets = Object.keys(cols).map(k => '`' + k + '` = ?').join(', ');
    if (sets) await db.exec('UPDATE todos SET ' + sets + ' WHERE id = ?', [...Object.values(cols), old.id]);

    // 重复待办完成 → 自动续期下一条（镜像 CF）
    let renewed = false;
    if (b.status === '已完成' && old.repeat && old.repeat !== '无' && old.due_iso) {
      try {
        const oldDue = new Date(old.due_iso);
        if (old.repeat === '每天') oldDue.setDate(oldDue.getDate() + 1);
        else if (old.repeat === '每周') oldDue.setDate(oldDue.getDate() + 7);
        else if (old.repeat === '每月') oldDue.setMonth(oldDue.getMonth() + 1);
        let resetSubs = '[]';
        try { const subs = JSON.parse(old.subtasks || '[]'); resetSubs = JSON.stringify(subs.map(s => ({ text: s.text, done: false }))); } catch (e) {}
        await db.exec(
          `INSERT INTO todos (user_id,title,description,due_ms,due_iso,priority,category,status,\`repeat\`,subtasks,link_type,link_id,project_id,phase_idx)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [uid, old.title, old.description || '', oldDue.getTime(), oldDue.toISOString(), old.priority, old.category,
            '待办', old.repeat, resetSubs, old.link_type || '无', old.link_id || '', old.project_id || '', old.phase_idx]);
        renewed = true;
      } catch (e) { console.error('auto-renew:', e.message); }
    }
    res.json({ ok: true, renewed });
  } catch (e) { next(e); }
});

router.delete('/todos', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const n = H.numFromId(req.query.id);
    if (!n) return res.status(400).json({ error: 'Missing id' });
    if (req.query.action === 'purge') {
      await db.exec('DELETE FROM todos WHERE id = ? AND user_id = ?', [n, uid]);
      return res.json({ ok: true, purged: true });
    }
    await db.exec("UPDATE todos SET status = '已删除' WHERE id = ? AND user_id = ?", [n, uid]);
    res.json({ ok: true, softDeleted: true });
  } catch (e) { next(e); }
});

router.patch('/todos', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    if (!b.ids || !b.ids.length) return res.status(400).json({ error: 'ids required' });
    const results = [];
    for (const id of b.ids) {
      const n = H.numFromId(id);
      const cols = [];
      const vals = [];
      if (b.status) { cols.push('status = ?'); vals.push(b.status); if (b.status === '已完成') { cols.push('completed_ms = ?'); vals.push(Date.now()); } }
      if (cols.length) { vals.push(n); vals.push(uid); await db.exec('UPDATE todos SET ' + cols.join(', ') + ' WHERE id = ? AND user_id = ?', vals); }
      results.push({ id, ok: true });
    }
    res.json({ ok: true, results });
  } catch (e) { next(e); }
});

module.exports = router;
