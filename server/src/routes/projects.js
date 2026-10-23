'use strict';
// /api/projects —— P0~P5 阶段通关制（PROJECT-PHASE-DESIGN.md）
// GET 返回项目并内嵌 phases[] / items[] / 花费聚合（一次拉齐）
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const { requireAuth, guard } = require('../middleware');

const router = express.Router();
router.use(guard(['projects', 'phases', 'phase-items']));

const PHASE_COUNT = 6;

function projectIdNum(id) {
  var s = String(id || '');
  var m = /^rec_(\d+)$/.exec(s);
  return m ? Number(m[1]) : null;
}

function rowToProject(r) {
  return {
    id: 'rec_' + r.id,
    name: r.name || '',
    description: r.description || '',
    dueDate: r.due_iso || (r.due_ms != null ? Number(r.due_ms) : null),
    status: r.status || '进行中',
    color: r.color || '#6366f1',
    budget: r.budget == null ? null : Number(r.budget),
    currentPhase: Number(r.current_phase) || 0,
    legacy: !!r.legacy_flag,
    parentId: r.parent_id || '',
  };
}

// ===== 列表（内嵌阶段/子项/花费）=====
router.get('/projects', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.json([]);
    const projects = await db.query('SELECT * FROM projects WHERE user_id = ? ORDER BY id', [uid]);
    if (!projects.length) return res.json([]);

    const [phases, items, pSpend, eSpend, pLedger, eLedger] = await Promise.all([
      db.query('SELECT * FROM project_phases WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?) ORDER BY project_id, phase_idx', [uid]),
      db.query('SELECT * FROM phase_items WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?) ORDER BY project_id, phase_idx, sort_order, id', [uid]),
      db.query("SELECT project_id, phase_idx, SUM(price*qty) AS amt FROM purchases WHERE user_id = ? AND project_id IS NOT NULL AND status NOT IN ('已退','已取消') GROUP BY project_id, phase_idx", [uid]),
      db.query("SELECT project_id, phase_idx, SUM(amount) AS amt FROM expenses WHERE user_id = ? AND project_id IS NOT NULL AND type <> '收入' GROUP BY project_id, phase_idx", [uid]),
      db.query("SELECT id, project_id, phase_idx, name AS title, price*qty AS amt, date_ms FROM purchases WHERE user_id = ? AND project_id IS NOT NULL AND status NOT IN ('已退','已取消') ORDER BY date_ms DESC, id DESC", [uid]),
      db.query("SELECT id, project_id, phase_idx, note AS title, amount AS amt, date_ms FROM expenses WHERE user_id = ? AND project_id IS NOT NULL AND type <> '收入' ORDER BY date_ms DESC, id DESC", [uid]),
    ]);

    const spendMap = {}; // pid -> {buy, exp, phases:{idx:{buy,exp}}}
    function addSpend(rows, key) {
      for (const s of rows) {
        const pid = s.project_id;
        if (!spendMap[pid]) spendMap[pid] = { buy: 0, exp: 0, phases: {} };
        const amt = Number(s.amt) || 0;
        const pi = s.phase_idx == null ? -1 : Number(s.phase_idx);
        if (!spendMap[pid].phases[pi]) spendMap[pid].phases[pi] = { buy: 0, exp: 0 };
        spendMap[pid].phases[pi][key] += amt;
        spendMap[pid][key] += amt;
      }
    }
    addSpend(pSpend, 'buy');
    addSpend(eSpend, 'exp');

    const byProject = {};
    for (const p of projects) {
      const o = rowToProject(p);
      o.phases = [];
      o.items = [];
      o.spend = spendMap[p.id] || { buy: 0, exp: 0, phases: {} };
      o.ledger = [];
      byProject[p.id] = o;
    }
    // 自愈：缺阶段的旧项目补齐 P0~P5
    const have = {};
    phases.forEach(ph => { (have[ph.project_id] = have[ph.project_id] || new Set()).add(Number(ph.phase_idx)); });
    for (const p of projects) {
      for (let i = 0; i < PHASE_COUNT; i++) {
        if (!have[p.id] || !have[p.id].has(i)) {
          try {
            await db.exec('INSERT IGNORE INTO project_phases (project_id, phase_idx, status) VALUES (?,?,?)', [p.id, i, 'todo']);
            phases.push({ project_id: p.id, phase_idx: i, display_name: null, status: 'todo', note: '', planned_start_ms: null, planned_end_ms: null, started_at_ms: null, finished_at_ms: null });
          } catch (e) {}
        }
      }
      phases.sort((a, b) => Number(a.project_id) - Number(b.project_id) || Number(a.phase_idx) - Number(b.phase_idx));
    }
    for (const ph of phases) {
      const o = byProject[ph.project_id]; if (!o) continue;
      o.phases.push({
        idx: Number(ph.phase_idx),
        name: ph.display_name || ('P' + ph.phase_idx),
        status: ph.status || 'todo',
        note: ph.note || '',
        plannedStart: ph.planned_start_ms == null ? null : Number(ph.planned_start_ms),
        plannedEnd: ph.planned_end_ms == null ? null : Number(ph.planned_end_ms),
        startedAt: ph.started_at_ms == null ? null : Number(ph.started_at_ms),
        finishedAt: ph.finished_at_ms == null ? null : Number(ph.finished_at_ms),
      });
    }
    for (const r of pLedger) {
      const o = byProject[r.project_id]; if (!o) continue;
      o.ledger.push({ kind: 'purchase', id: 'rec_' + r.id, title: r.title || '采购', amount: Number(r.amt) || 0, phaseIdx: r.phase_idx == null ? -1 : Number(r.phase_idx), dateMs: r.date_ms == null ? null : Number(r.date_ms) });
    }
    for (const r of eLedger) {
      const o = byProject[r.project_id]; if (!o) continue;
      o.ledger.push({ kind: 'expense', id: 'rec_' + r.id, title: r.title || '记账', amount: Number(r.amt) || 0, phaseIdx: r.phase_idx == null ? -1 : Number(r.phase_idx), dateMs: r.date_ms == null ? null : Number(r.date_ms) });
    }
    for (const it of items) {
      const o = byProject[it.project_id]; if (!o) continue;
      o.items.push({
        id: 'pi_' + it.id,
        phaseIdx: Number(it.phase_idx),
        title: it.title,
        done: !!it.done,
        note: it.note || '',
      });
    }
    res.json(projects.map(p => byProject[p.id]));
  } catch (e) { next(e); }
});

// ===== 新建（自动建 6 个阶段，事务）=====
router.post('/projects', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.status(401).json({ error: '用户不存在' });
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Name required' });
    const dueMs = b.dueDate ? new Date(b.dueDate).getTime() : null;
    await conn.beginTransaction();
    const [ins] = await conn.query(
      'INSERT INTO projects (user_id,name,description,due_ms,due_iso,status,color,budget,progress,current_phase) VALUES (?,?,?,?,?,?,?,?,0,0)',
      [uid, String(b.name).slice(0, 200), String(b.description || '').slice(0, 2000), dueMs, b.dueDate || '',
        b.status || '进行中', b.color || '#6366f1', (b.budget === null || b.budget === undefined || b.budget === '') ? null : Number(b.budget)]);
    for (let i = 0; i < PHASE_COUNT; i++) {
      await conn.query('INSERT INTO project_phases (project_id, phase_idx, status) VALUES (?,?,?)', [ins.insertId, i, 'todo']);
    }
    await conn.commit();
    res.json({ id: 'rec_' + ins.insertId, ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

// ===== 项目基本信息 =====
router.put('/projects', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const pid = projectIdNum(b.id);
    if (!pid) return res.status(400).json({ error: 'Missing id' });
    const own = await db.one('SELECT id FROM projects WHERE id = ? AND user_id = ?', [pid, uid]);
    if (!own) return res.status(404).json({ error: 'not found' });
    const cols = {};
    if (b.name !== undefined) cols.name = String(b.name).slice(0, 200);
    if (b.description !== undefined) cols.description = String(b.description || '').slice(0, 2000);
    if (b.dueDate !== undefined) { cols.due_ms = b.dueDate ? new Date(b.dueDate).getTime() : null; cols.due_iso = b.dueDate || ''; }
    if (b.status !== undefined) cols.status = b.status;
    if (b.color !== undefined) cols.color = b.color;
    if (b.budget !== undefined) cols.budget = (b.budget === null || b.budget === '') ? null : Number(b.budget);
    if (b.currentPhase !== undefined) cols.current_phase = Math.max(0, Math.min(PHASE_COUNT - 1, Number(b.currentPhase) || 0));
    const sets = Object.keys(cols).map(k => k + ' = ?').join(', ');
    if (sets) await db.exec('UPDATE projects SET ' + sets + ' WHERE id = ?', [...Object.values(cols), pid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ===== 阶段更新（完成/跳过/回退，完全可逆）=====
// 状态变更与指针推进在同一事务内完成，避免多次请求部分失败造成不一致。
router.put('/phases', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const pid = projectIdNum(b.projectId);
    const idx = Number(b.phaseIdx);
    if (!pid || !Number.isInteger(idx) || idx < 0 || idx >= PHASE_COUNT) {
      return res.status(400).json({ error: 'bad phase' });
    }
    // 强制规则：P5 是最终阶段，不允许跳过
    if (b.status === 'skipped' && idx === 5) {
      return res.status(400).json({ error: 'P5 是最终阶段，必须完成，不能跳过' });
    }
    if (b.status !== undefined && !['todo', 'doing', 'done', 'skipped'].includes(b.status)) {
      return res.status(400).json({ error: 'bad status' });
    }

    await conn.beginTransaction();
    const [ownRows] = await conn.query('SELECT * FROM projects WHERE id = ? AND user_id = ? FOR UPDATE', [pid, uid]);
    const own = ownRows[0];
    if (!own) {
      await conn.rollback();
      return res.status(404).json({ error: 'not found' });
    }
    // 旧项目自愈：确保 6 个阶段行都存在
    for (let i = 0; i < PHASE_COUNT; i++) {
      await conn.query('INSERT IGNORE INTO project_phases (project_id, phase_idx, status) VALUES (?,?,?)', [pid, i, 'todo']);
    }
    const [phases] = await conn.query('SELECT * FROM project_phases WHERE project_id = ? ORDER BY phase_idx FOR UPDATE', [pid]);
    const byIdx = {};
    phases.forEach(x => { byIdx[Number(x.phase_idx)] = x; });
    const ph = byIdx[idx];
    if (!ph) throw new Error('phase rows missing after self-heal');

    // 最终阶段门禁：P5 完成前，P0~P4 必须已完成或已跳过
    if (b.status === 'done' && idx === 5) {
      const pending = [];
      for (let i = 0; i < 5; i++) {
        const s = (byIdx[i] || {}).status;
        if (s !== 'done' && s !== 'skipped') pending.push('P' + i);
      }
      if (pending.length) {
        await conn.rollback();
        return res.status(400).json({ error: '请先完成或跳过 ' + pending.join('、') });
      }
    }

    const now = Date.now();
    const oldStatus = ph.status || 'todo';
    const oldFinished = ph.finished_at_ms == null ? null : Number(ph.finished_at_ms);
    const cols = {};
    if (b.status !== undefined) {
      const st = b.status;
      cols.status = st;
      if (st === 'doing') {
        if (!ph.started_at_ms) cols.started_at_ms = now;
        cols.finished_at_ms = null;
      } else if (st === 'done') {
        if (!ph.started_at_ms) cols.started_at_ms = now;
        cols.finished_at_ms = now;
      } else if (st === 'skipped') {
        if (!ph.started_at_ms) cols.started_at_ms = now;
        cols.finished_at_ms = now;
      } else { // todo：完全回退，清空实际时间
        cols.started_at_ms = null;
        cols.finished_at_ms = null;
      }
    }
    if (b.displayName !== undefined) cols.display_name = String(b.displayName || '').slice(0, 50) || null;
    if (b.note !== undefined) cols.note = String(b.note || '').slice(0, 2000);
    if (b.plannedStart !== undefined) cols.planned_start_ms = b.plannedStart ? new Date(b.plannedStart).getTime() : null;
    if (b.plannedEnd !== undefined) cols.planned_end_ms = b.plannedEnd ? new Date(b.plannedEnd).getTime() : null;

    // 规划时间校验（用更新后的有效值）
    const effStart = cols.planned_start_ms !== undefined ? cols.planned_start_ms : (ph.planned_start_ms == null ? null : Number(ph.planned_start_ms));
    const effEnd = cols.planned_end_ms !== undefined ? cols.planned_end_ms : (ph.planned_end_ms == null ? null : Number(ph.planned_end_ms));
    if ((effStart != null && !Number.isFinite(effStart)) || (effEnd != null && !Number.isFinite(effEnd))) {
      await conn.rollback();
      return res.status(400).json({ error: 'bad planned time' });
    }
    if (effStart != null && effEnd != null && effEnd < effStart) {
      await conn.rollback();
      return res.status(400).json({ error: '完成时间不能早于开始时间' });
    }

    const sets = Object.keys(cols).map(k => k + ' = ?').join(', ');
    if (sets) {
      await conn.query('UPDATE project_phases SET ' + sets + ' WHERE project_id = ? AND phase_idx = ?', [...Object.values(cols), pid, idx]);
    }

    let pointer = Number(own.current_phase) || 0;
    let projectStatus = own.status || '进行中';

    if (b.status !== undefined) {
      const st = b.status;
      if (st === 'done' || st === 'skipped') {
        if (idx < 5) {
          // 指针落到下一个尚未完成/跳过的阶段，若它还没开始则自动开始
          let next = idx + 1;
          while (next <= 5 && ['done', 'skipped'].includes((byIdx[next] || {}).status)) next++;
          if (next <= 5) {
            pointer = next;
            if ((byIdx[next] || {}).status === 'todo') {
              await conn.query(
                "UPDATE project_phases SET status = 'doing', started_at_ms = ?, finished_at_ms = NULL WHERE project_id = ? AND phase_idx = ?",
                [now, pid, next]);
              byIdx[next].status = 'doing';
              byIdx[next].started_at_ms = now;
            }
          } else {
            pointer = 5;
          }
        } else {
          pointer = 5;
        }
      } else if (st === 'doing') {
        pointer = idx;
      } else if (st === 'todo') {
        pointer = idx;
        // 若下一阶段是上一次“完成/跳过”时自动开始的，回退时一并撤回
        if ((oldStatus === 'done' || oldStatus === 'skipped') && oldFinished) {
          for (let j = idx + 1; j <= 5; j++) {
            const np = byIdx[j];
            if (np && np.status === 'doing' && Number(np.started_at_ms) === oldFinished) {
              await conn.query(
                "UPDATE project_phases SET status = 'todo', started_at_ms = NULL, finished_at_ms = NULL WHERE project_id = ? AND phase_idx = ?",
                [pid, j]);
              np.status = 'todo';
              np.started_at_ms = null;
              np.finished_at_ms = null;
            }
          }
        }
      }

      // 通关不变量：P5 完成，且 P0~P4 全部完成/跳过
      const p5Done = (idx === 5 ? st : (byIdx[5] || {}).status) === 'done';
      let allPrevHandled = true;
      for (let i = 0; i < 5; i++) {
        const ps = i === idx ? st : ((byIdx[i] || {}).status || 'todo');
        if (ps !== 'done' && ps !== 'skipped') { allPrevHandled = false; break; }
      }
      if (p5Done && allPrevHandled) {
        if (projectStatus !== '已归档') projectStatus = '已完成';
        pointer = 5;
      } else if (projectStatus === '已完成') {
        // P5 回退，或已通关后又重新打开任一前置阶段：项目回到进行中
        projectStatus = '进行中';
      }
    }

    await conn.query('UPDATE projects SET current_phase = ?, status = ? WHERE id = ?', [pointer, projectStatus, pid]);
    await conn.commit();
    res.json({ ok: true, currentPhase: pointer, projectStatus: projectStatus });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

// ===== 阶段交付物 =====
router.post('/phase-items', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const pid = projectIdNum(b.projectId);
    const idx = Number(b.phaseIdx);
    if (!pid || !Number.isInteger(idx) || idx < 0 || idx >= PHASE_COUNT) {
      return res.status(400).json({ error: 'bad params' });
    }
    const own = await db.one('SELECT id FROM projects WHERE id = ? AND user_id = ?', [pid, uid]);
    if (!own) return res.status(404).json({ error: 'not found' });
    const title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title required' });
    const [ins] = await db.pool.query(
      'INSERT INTO phase_items (project_id, phase_idx, title, note, sort_order) VALUES (?,?,?,?,?)',
      [pid, idx, title.slice(0, 300), String(b.note || '').slice(0, 2000), Number(b.sortOrder) || 0]);
    res.json({ id: 'pi_' + ins.insertId, ok: true });
  } catch (e) { next(e); }
});

router.put('/phase-items', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const m = /^pi_(\d+)$/.exec(String(b.id || ''));
    if (!m) return res.status(400).json({ error: 'bad id' });
    const iid = Number(m[1]);
    const row = await db.one(
      'SELECT pi.* FROM phase_items pi JOIN projects p ON p.id = pi.project_id WHERE pi.id = ? AND p.user_id = ?', [iid, uid]);
    if (!row) return res.status(404).json({ error: 'not found' });
    const cols = {};
    if (b.title !== undefined) cols.title = String(b.title || '').slice(0, 300);
    if (b.note !== undefined) cols.note = String(b.note || '').slice(0, 2000);
    if (b.plannedStart !== undefined) cols.planned_start_ms = b.plannedStart ? new Date(b.plannedStart).getTime() : null;
    if (b.plannedEnd !== undefined) cols.planned_end_ms = b.plannedEnd ? new Date(b.plannedEnd).getTime() : null;
    if (b.done !== undefined) { cols.done = b.done ? 1 : 0; cols.completed_ms = b.done ? Date.now() : null; }
    if (b.sortOrder !== undefined) cols.sort_order = Number(b.sortOrder) || 0;
    const sets = Object.keys(cols).map(k => k + ' = ?').join(', ');
    if (sets) await db.exec('UPDATE phase_items SET ' + sets + ' WHERE id = ?', [...Object.values(cols), iid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/phase-items', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const m = /^pi_(\d+)$/.exec(String(req.query.id || ''));
    if (!m) return res.status(400).json({ error: 'bad id' });
    await db.exec('DELETE pi FROM phase_items pi JOIN projects p ON p.id = pi.project_id WHERE pi.id = ? AND p.user_id = ?', [Number(m[1]), uid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ===== 删除项目（级联阶段/子项；钱与待办解除关联）=====
router.delete('/projects', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const pid = projectIdNum(req.query.id);
    if (!pid) return res.status(400).json({ error: 'Missing id' });
    const own = await db.one('SELECT id FROM projects WHERE id = ? AND user_id = ?', [pid, uid]);
    if (!own) return res.json({ ok: true });
    await db.exec('DELETE FROM project_phases WHERE project_id = ?', [pid]);
    await db.exec('DELETE FROM phase_items WHERE project_id = ?', [pid]);
    await db.exec('UPDATE purchases SET project_id = NULL, phase_idx = NULL WHERE project_id = ?', [pid]);
    await db.exec('UPDATE expenses SET project_id = NULL, phase_idx = NULL WHERE project_id = ?', [pid]);
    await db.exec('UPDATE todos SET project_id = NULL, phase_idx = NULL WHERE project_id = ?', [pid]);
    await db.exec('DELETE FROM projects WHERE id = ? AND user_id = ?', [pid, uid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
