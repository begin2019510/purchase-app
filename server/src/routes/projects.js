'use strict';
// /api/projects 镜像 CF projects.js
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const { requireAuth, guard } = require('../middleware');

const router = express.Router();
router.use(guard(['projects']));

function rowToProject(r) {
  return {
    id: 'rec_' + r.id,
    name: r.name || '',
    description: r.description || '',
    dueDate: r.due_iso || (r.due_ms != null ? Number(r.due_ms) : null),
    status: r.status || '进行中',
    color: r.color || '#6366f1',
    progress: Number(r.progress) || 0,
    parentId: r.parent_id || '',
  };
}

router.get('/projects', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.json([]);
    const rows = await db.query('SELECT * FROM projects WHERE user_id = ? ORDER BY id', [uid]);
    res.json(rows.map(rowToProject));
  } catch (e) { next(e); }
});

router.post('/projects', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.status(401).json({ error: '用户不存在' });
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Name required' });
    const dueMs = b.dueDate ? new Date(b.dueDate).getTime() : null;
    const [ins] = await db.pool.query(
      'INSERT INTO projects (user_id,name,description,due_ms,due_iso,status,color,progress,parent_id) VALUES (?,?,?,?,?,?,?,?,?)',
      [uid, String(b.name).slice(0, 200), String(b.description || '').slice(0, 2000), dueMs, b.dueDate || '',
        b.status || '进行中', b.color || '#6366f1', 0, b.parentId || '']);
    res.json({ id: 'rec_' + ins.insertId, ok: true });
  } catch (e) { next(e); }
});

router.put('/projects', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    if (!b.id) return res.status(400).json({ error: 'Missing id' });
    const n = H.numFromId(b.id);
    const cols = {};
    if (b.name !== undefined) cols.name = String(b.name).slice(0, 200);
    if (b.description !== undefined) cols.description = String(b.description || '').slice(0, 2000);
    if (b.dueDate !== undefined) { cols.due_ms = b.dueDate ? new Date(b.dueDate).getTime() : null; cols.due_iso = b.dueDate || ''; }
    if (b.status !== undefined) cols.status = b.status;
    if (b.color !== undefined) cols.color = b.color;
    if (b.progress !== undefined) cols.progress = b.progress;
    if (b.parentId !== undefined) cols.parent_id = b.parentId || '';
    const sets = Object.keys(cols).map(k => k + ' = ?').join(', ');
    if (sets) await db.exec('UPDATE projects SET ' + sets + ' WHERE id = ? AND user_id = ?', [...Object.values(cols), n, uid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/projects', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const n = H.numFromId(req.query.id);
    if (!n) return res.status(400).json({ error: 'Missing id' });
    await db.exec('DELETE FROM projects WHERE id = ? AND user_id = ?', [n, uid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
