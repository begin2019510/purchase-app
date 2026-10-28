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

const TZ = 8 * 3600000;
const STATUSES = new Set(['待办', '进行中', '已完成', '已取消', '已删除']);
const PRIORITIES = new Set(['高', '中', '低']);
const REPEATS = new Set(['无', '每天', '每周', '每月']);

// 兼容前端传的 ISO 时间与只写日期的 YYYY-MM-DD（按北京时间零点）
function dueToMs(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v);
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s + 'T00:00:00+08:00') : new Date(s).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

// 重复待办续期的下一次到期时间：每天/每周按毫秒平移，每月按北京日历加月并夹到月末
function nextDue(old) {
  const base = old.due_ms != null ? Number(old.due_ms) : dueToMs(old.due_iso);
  if (!Number.isFinite(base)) return null;
  const rep = old.repeat;
  if (rep === '每天') return base + 86400000;
  if (rep === '每周') return base + 7 * 86400000;
  if (rep === '每月') {
    const bj = new Date(base + TZ);
    const y = bj.getUTCFullYear(), mo = bj.getUTCMonth(), day = bj.getUTCDate();
    const idx = y * 12 + mo + 1;
    const ty = Math.floor(idx / 12), tm = idx % 12;
    const dim = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return Date.UTC(ty, tm, Math.min(day, dim), bj.getUTCHours(), bj.getUTCMinutes(), bj.getUTCSeconds(), bj.getUTCMilliseconds()) - TZ;
  }
  return null;
}

async function insertRenewed(uid, old) {
  const ms = nextDue(old);
  if (ms == null) return false;
  let resetSubs = '[]';
  try { const subs = JSON.parse(old.subtasks || '[]'); resetSubs = JSON.stringify(subs.map(s => ({ text: s.text, done: false }))); } catch (e) {}
  await db.exec(
    `INSERT INTO todos (user_id,title,description,due_ms,due_iso,priority,category,status,\`repeat\`,subtasks,link_type,link_id,project_id,phase_idx,tags,sort_no)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uid, old.title, old.description || '', ms, new Date(ms).toISOString(), old.priority, old.category,
      '待办', old.repeat, resetSubs, old.link_type || '无', old.link_id || '', old.project_id || '', old.phase_idx, old.tags || '[]', Number(old.sort_no) || 0]);
  return true;
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
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Title required' });
    if (title.length > 200) return res.status(400).json({ error: '标题过长' });
    if (b.priority !== undefined && !PRIORITIES.has(String(b.priority))) return res.status(400).json({ error: '无效优先级' });
    if (b.status !== undefined && !STATUSES.has(String(b.status))) return res.status(400).json({ error: '无效状态' });
    if (b.repeat !== undefined && !REPEATS.has(String(b.repeat))) return res.status(400).json({ error: '无效重复规则' });
    if (b.linkType !== undefined && !['无', '采购', '记账'].includes(String(b.linkType))) return res.status(400).json({ error: '无效关联类型' });
    const category = String(b.category || '其他');
    if (category.length > 10) return res.status(400).json({ error: '分类过长' });
    const dueMs = dueToMs(b.dueDate);
    if (Number.isNaN(dueMs)) return res.status(400).json({ error: '日期格式不正确' });
    let imageRef = '';
    if (typeof b.image === 'string' && b.image.startsWith('data:')) {
      if (b.image.length > 12 * 1024 * 1024) return res.status(413).json({ error: '图片过大' });
      imageRef = await IMG.saveDataImage(req.username, uid, b.image, 'todo');
    } else if (typeof b.image === 'string' && b.image.startsWith('kv:')) imageRef = b.image;
    const [ins] = await db.pool.query(
      `INSERT INTO todos (user_id,title,description,due_ms,due_iso,priority,category,status,\`repeat\`,subtasks,image_ref,link_type,link_id,project_id,phase_idx,tags,sort_no,reminders)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uid, title, String(b.description || '').slice(0, 2000), dueMs, b.dueDate || '',
        b.priority || '中', category, b.status || '待办', b.repeat || '无', String(b.subtasks || '[]').slice(0, 20000),
        imageRef, b.linkType || '无', String(b.linkId || '').slice(0, 40), String(b.projectId || '').slice(0, 40), _phaseIdx(b.phaseIdx),
        String(b.tags || '[]').slice(0, 10000), Number(b.order) || 0, '']);
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
    if (b.title !== undefined) {
      const t = String(b.title || '').trim();
      if (!t) return res.status(400).json({ error: '标题不能为空' });
      if (t.length > 200) return res.status(400).json({ error: '标题过长' });
      cols.title = t;
    }
    if (b.description !== undefined) cols.description = String(b.description || '').slice(0, 2000);
    if (b.dueDate !== undefined) {
      const ms = dueToMs(b.dueDate);
      if (Number.isNaN(ms)) return res.status(400).json({ error: '日期格式不正确' });
      cols.due_ms = ms; cols.due_iso = b.dueDate || '';
    }
    if (b.priority !== undefined) {
      if (!PRIORITIES.has(String(b.priority))) return res.status(400).json({ error: '无效优先级' });
      cols.priority = b.priority;
    }
    if (b.category !== undefined) {
      const c = String(b.category || '其他');
      if (c.length > 10) return res.status(400).json({ error: '分类过长' });
      cols.category = c;
    }
    if (b.status !== undefined) {
      if (!STATUSES.has(String(b.status))) return res.status(400).json({ error: '无效状态' });
      cols.status = b.status;
      cols.completed_ms = b.status === '已完成' ? Date.now() : null;
    }
    if (b.repeat !== undefined) {
      if (!REPEATS.has(String(b.repeat))) return res.status(400).json({ error: '无效重复规则' });
      cols.repeat = b.repeat;
    }
    if (b.subtasks !== undefined) cols.subtasks = String(b.subtasks || '[]').slice(0, 20000);
    if (b.linkType !== undefined) {
      if (!['无', '采购', '记账'].includes(String(b.linkType))) return res.status(400).json({ error: '无效关联类型' });
      cols.link_type = b.linkType;
    }
    if (b.linkId !== undefined) cols.link_id = String(b.linkId || '').slice(0, 40);
    if (b.projectId !== undefined) cols.project_id = String(b.projectId || '').slice(0, 40);
    if (b.phaseIdx !== undefined) cols.phase_idx = _phaseIdx(b.phaseIdx);
    if (b.tags !== undefined) cols.tags = String(b.tags || '[]').slice(0, 10000);
    if (b.order !== undefined) cols.sort_no = Number(b.order) || 0;
    if (b.reminders !== undefined) cols.reminders = String(b.reminders || '').slice(0, 5000);
    if (b.image !== undefined) {
      if (typeof b.image === 'string' && b.image.startsWith('data:')) {
        if (b.image.length > 12 * 1024 * 1024) return res.status(413).json({ error: '图片过大' });
        cols.image_ref = await IMG.saveDataImage(req.username, uid, b.image, 'todo');
      } else cols.image_ref = typeof b.image === 'string' && b.image.startsWith('kv:') ? b.image : '';
    }
    const sets = Object.keys(cols).map(k => '`' + k + '` = ?').join(', ');
    // 并发保护：完成动作带 status<>'已完成' 条件，只有一个请求能真正完成并触发续期
    const claim = b.status === '已完成' && old.status !== '已完成';
    let claimed = true;
    if (sets) {
      const sql = 'UPDATE todos SET ' + sets + ' WHERE id = ?' + (claim ? " AND status <> '已完成'" : '');
      const r = await db.exec(sql, [...Object.values(cols), old.id]);
      if (claim && Number(r.affectedRows) !== 1) claimed = false;
    }

    // 重复待办完成 → 自动续期下一条。只在「未完成 → 已完成」时触发，防止重复提交生成多条
    let renewed = false;
    if (claimed && b.status === '已完成' && old.status !== '已完成' && old.repeat && old.repeat !== '无') {
      try {
        const src = { ...old, due_ms: cols.due_ms !== undefined ? cols.due_ms : old.due_ms, due_iso: cols.due_iso !== undefined ? cols.due_iso : old.due_iso };
        renewed = await insertRenewed(uid, src);
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
    if (!Array.isArray(b.ids) || !b.ids.length) return res.status(400).json({ error: 'ids required' });
    if (b.ids.length > 500) return res.status(400).json({ error: '一次最多操作 500 条' });
    if (b.status !== undefined && !STATUSES.has(String(b.status))) return res.status(400).json({ error: '无效状态' });
    const results = [];
    for (const id of b.ids) {
      const n = H.numFromId(id);
      if (!n) { results.push({ id, ok: false }); continue; }
      const old = await db.one('SELECT * FROM todos WHERE id = ? AND user_id = ?', [n, uid]);
      if (!old) { results.push({ id, ok: false }); continue; }
      const cols = [];
      const vals = [];
      if (b.status) {
        cols.push('status = ?'); vals.push(b.status);
        cols.push('completed_ms = ?'); vals.push(b.status === '已完成' ? Date.now() : null);
      }
      let claimed = true;
      if (cols.length) {
        const claim = b.status === '已完成' && old.status !== '已完成';
        vals.push(n); vals.push(uid);
        const sql = 'UPDATE todos SET ' + cols.join(', ') + ' WHERE id = ? AND user_id = ?' + (claim ? " AND status <> '已完成'" : '');
        const r = await db.exec(sql, vals);
        if (claim && Number(r.affectedRows) !== 1) claimed = false;
      }
      if (claimed && b.status === '已完成' && old.status !== '已完成' && old.repeat && old.repeat !== '无') {
        try { await insertRenewed(uid, old); } catch (e) { console.error('auto-renew:', e.message); }
      }
      results.push({ id, ok: true });
    }
    res.json({ ok: true, results });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports._nextDue = nextDue;
module.exports._dueToMs = dueToMs;
