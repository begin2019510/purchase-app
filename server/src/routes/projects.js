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
const PROJECT_STATUSES = ['进行中', '已完成', '已归档'];
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const MAX_BUDGET = 1e9;

// 返回 null / 数字 / NaN；调用方负责把 NaN 转成 400，避免把 NaN 写进 MySQL 触发 500
function dueMsOf(v) {
  if (!v) return null;
  return new Date(v).getTime();
}
function budgetNum(v) {
  if (v === null || v === undefined || v === '') return null;
  return Number(v);
}

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
            phases.push({ project_id: p.id, phase_idx: i, display_name: null, status: 'todo', note: '', budget: null, planned_start_ms: null, planned_end_ms: null, started_at_ms: null, finished_at_ms: null });
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
        budget: ph.budget == null ? null : Number(ph.budget),
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

// ===== 新建（固定 6 个槽位；第一步 P0、最后一步 P5，中间空槽标记未使用）=====
router.post('/projects', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.status(401).json({ error: '用户不存在' });
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name required' });
    if (name.length > 100) return res.status(400).json({ error: '项目名称过长' });
    const dueMs = dueMsOf(b.dueDate);
    if (dueMs !== null && !Number.isFinite(dueMs)) return res.status(400).json({ error: 'bad dueDate' });
    const budget = budgetNum(b.budget);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > MAX_BUDGET)) return res.status(400).json({ error: 'bad budget' });
    const status = b.status || '进行中';
    if (!PROJECT_STATUSES.includes(status)) return res.status(400).json({ error: 'bad status' });
    let color = '#6366f1';
    if (b.color !== undefined) {
      if (typeof b.color !== 'string' || !COLOR_RE.test(b.color)) return res.status(400).json({ error: 'bad color' });
      color = b.color;
    }

    // 步骤规划是粗粒度的：只写现在知道的，最多 6 步；空行忽略。
    // 每步可以是字符串，也可以是 {name, budget}（本步预算，可空）。
    // 不填步骤 → 6 个槽位都保留待规划；填了 N 步 → 最后一步固定放 P5，中间空槽标记 skipped（未使用）。
    let steps = [];
    if (b.steps !== undefined && b.steps !== null) {
      if (!Array.isArray(b.steps)) return res.status(400).json({ error: 'bad steps' });
      for (const raw of b.steps) {
        let name = '';
        let stepBudget = null;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          name = String(raw.name == null ? '' : raw.name).trim().slice(0, 50);
          if (raw.budget !== undefined && raw.budget !== null && raw.budget !== '') {
            stepBudget = Number(raw.budget);
            if (!Number.isFinite(stepBudget) || stepBudget < 0 || stepBudget > MAX_BUDGET) {
              return res.status(400).json({ error: 'bad step budget' });
            }
          }
        } else {
          name = String(raw == null ? '' : raw).trim().slice(0, 50);
        }
        if (!name) continue;
        steps.push({ name, budget: stepBudget });
      }
      if (steps.length > PHASE_COUNT) return res.status(400).json({ error: '最多规划 6 步' });
    }
    // 槽位映射：第一步固定 P0，最后一步固定 P5，中间步骤依次填 P1~P4。
    // 只写 4 步 → 前 3 步在 P0~P2，第 4 步在 P5；P3、P4 自动标为未使用。
    const slotNames = new Array(PHASE_COUNT).fill(null);
    const slotBudgets = new Array(PHASE_COUNT).fill(null);
    if (steps.length > 0) {
      for (let i = 0; i < steps.length - 1; i++) {
        slotNames[i] = steps[i].name;
        slotBudgets[i] = steps[i].budget;
      }
      slotNames[PHASE_COUNT - 1] = steps[steps.length - 1].name;
      slotBudgets[PHASE_COUNT - 1] = steps[steps.length - 1].budget;
    }
    const startPhase = steps.length === 1 ? PHASE_COUNT - 1 : 0;

    await conn.beginTransaction();
    const [ins] = await conn.query(
      'INSERT INTO projects (user_id,name,description,due_ms,due_iso,status,color,budget,progress,current_phase) VALUES (?,?,?,?,?,?,?,?,0,?)',
      [uid, name, String(b.description || '').slice(0, 2000), dueMs, b.dueDate || '',
        status, color, budget, startPhase]);
    for (let i = 0; i < PHASE_COUNT; i++) {
      const unused = steps.length > 0 && slotNames[i] === null;
      await conn.query(
        'INSERT INTO project_phases (project_id, phase_idx, display_name, status, budget) VALUES (?,?,?,?,?)',
        [ins.insertId, i, slotNames[i], unused ? 'skipped' : 'todo', unused ? null : slotBudgets[i]]);
    }
    await conn.commit();
    res.json({ id: 'rec_' + ins.insertId, ok: true, steps: steps.length });
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
    if (b.name !== undefined) {
      const name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ error: '项目名称不能为空' });
      if (name.length > 100) return res.status(400).json({ error: '项目名称过长' });
      cols.name = name;
    }
    if (b.description !== undefined) cols.description = String(b.description || '').slice(0, 2000);
    if (b.dueDate !== undefined) {
      const dueMs = dueMsOf(b.dueDate);
      if (dueMs !== null && !Number.isFinite(dueMs)) return res.status(400).json({ error: 'bad dueDate' });
      cols.due_ms = dueMs; cols.due_iso = b.dueDate || '';
    }
    if (b.status !== undefined) {
      if (!PROJECT_STATUSES.includes(b.status)) return res.status(400).json({ error: 'bad status' });
      cols.status = b.status;
    }
    if (b.color !== undefined) {
      if (typeof b.color !== 'string' || !COLOR_RE.test(b.color)) return res.status(400).json({ error: 'bad color' });
      cols.color = b.color;
    }
    if (b.budget !== undefined) {
      const budget = budgetNum(b.budget);
      if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > MAX_BUDGET)) return res.status(400).json({ error: 'bad budget' });
      cols.budget = budget;
    }
    if (b.currentPhase !== undefined) {
      const cp = Number(b.currentPhase);
      if (!Number.isInteger(cp) || cp < 0 || cp >= PHASE_COUNT) return res.status(400).json({ error: 'bad currentPhase' });
      cols.current_phase = cp;
    }
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

    // 第 1 步（P0）和第 6 步（P5）必须完成，中间步骤可跳过。
    // 自动补足的“未使用”槽位本来就是 skipped，不参与这里的判断。
    if (b.status === 'skipped') {
      if (idx === 0 && (ph.status || 'todo') !== 'skipped') {
        await conn.rollback();
        return res.status(400).json({ error: '第 1 步必须完成，不能跳过' });
      }
      if (idx === PHASE_COUNT - 1) {
        await conn.rollback();
        return res.status(400).json({ error: '第 6 步必须完成，不能跳过' });
      }
    }

    // 计算本次变更后的状态，用于通关门禁和指针推进
    const statusAfter = {};
    phases.forEach(x => { statusAfter[Number(x.phase_idx)] = x.status || 'todo'; });
    if (b.status !== undefined) statusAfter[idx] = b.status;
    const activeAfter = [];
    for (let i = 0; i < PHASE_COUNT; i++) {
      if (statusAfter[i] !== 'skipped') activeAfter.push(i);
    }
    const lastActiveAfter = activeAfter.length ? activeAfter[activeAfter.length - 1] : null;

    // 第 6 步完成前，其余仍在使用的步骤都必须已完成（跳过/未使用的不阻塞）
    if (b.status === 'done' && idx === PHASE_COUNT - 1) {
      const pending = activeAfter.filter(i => i !== idx && statusAfter[i] !== 'done');
      if (pending.length) {
        await conn.rollback();
        return res.status(400).json({ error: '请先完成 ' + pending.map(i => '第 ' + (i + 1) + ' 步').join('、') });
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
    if (b.budget !== undefined) {
      const phaseBudget = budgetNum(b.budget);
      if (phaseBudget !== null && (!Number.isFinite(phaseBudget) || phaseBudget < 0 || phaseBudget > MAX_BUDGET)) {
        await conn.rollback();
        return res.status(400).json({ error: 'bad budget' });
      }
      cols.budget = phaseBudget;
    }
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

    // 阶段完成/跳过 → 该阶段未完成待办批量置为已完成（撤销阶段不恢复待办，避免误伤手标完成）
    if (b.status === 'done' || b.status === 'skipped') {
      await conn.query(
        "UPDATE todos SET status = '已完成', completed_ms = ? WHERE user_id = ? AND project_id = ? AND phase_idx = ? AND status IN ('待办','进行中')",
        [now, uid, 'rec_' + pid, idx]);
    }

    let pointer = Number(own.current_phase) || 0;
    let projectStatus = own.status || '进行中';

    if (b.status !== undefined) {
      const st = b.status;
      if (st === 'done' || st === 'skipped') {
        // 指针落到下一个仍在使用的步骤；若它还没开始则自动开始
        let next = idx + 1;
        while (next < PHASE_COUNT && (statusAfter[next] === 'done' || statusAfter[next] === 'skipped')) next++;
        if (next < PHASE_COUNT) {
          pointer = next;
          if (statusAfter[next] === 'todo') {
            await conn.query(
              "UPDATE project_phases SET status = 'doing', started_at_ms = ?, finished_at_ms = NULL WHERE project_id = ? AND phase_idx = ?",
              [now, pid, next]);
            statusAfter[next] = 'doing';
          }
        } else {
          pointer = lastActiveAfter != null ? lastActiveAfter : idx;
        }
      } else if (st === 'doing') {
        pointer = idx;
      } else if (st === 'todo') {
        pointer = idx;
        // 若下一阶段是上一次“完成/跳过”时自动开始的，回退时一并撤回
        if ((oldStatus === 'done' || oldStatus === 'skipped') && oldFinished) {
          for (let j = idx + 1; j < PHASE_COUNT; j++) {
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

      // 通关不变量：第 6 步已完成，且其余仍在使用的步骤都已完成。
      // 跳过/未使用的槽位不计入，也不会挡住通关。
      const p5Done = statusAfter[PHASE_COUNT - 1] === 'done';
      const othersDone = activeAfter.every(i => i === PHASE_COUNT - 1 || statusAfter[i] === 'done');
      if (p5Done && othersDone) {
        if (projectStatus !== '已归档') projectStatus = '已完成';
        pointer = PHASE_COUNT - 1;
      } else if (projectStatus === '已完成') {
        // 回退最后一步，或重新打开任一仍在使用的步骤：项目回到进行中
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

// ===== 删除项目（事务级联阶段/子项；钱与待办解除关联）=====
router.delete('/projects', async (req, res, next) => {
  const conn = await db.pool.getConnection();
  try {
    const uid = await H.resolveUserId(req.username);
    const pid = projectIdNum(req.query.id);
    if (!pid) return res.status(400).json({ error: 'Missing id' });
    await conn.beginTransaction();
    const [ownRows] = await conn.query('SELECT id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE', [pid, uid]);
    if (!ownRows[0]) {
      await conn.rollback();
      return res.json({ ok: true });
    }
    await conn.query('DELETE FROM project_phases WHERE project_id = ?', [pid]);
    await conn.query('DELETE FROM phase_items WHERE project_id = ?', [pid]);
    await conn.query('UPDATE purchases SET project_id = NULL, phase_idx = NULL WHERE project_id = ? AND user_id = ?', [pid, uid]);
    await conn.query('UPDATE expenses SET project_id = NULL, phase_idx = NULL WHERE project_id = ? AND user_id = ?', [pid, uid]);
    // todos.project_id 是字符串列（存 rec_<id>），与 purchases/expenses 的数字列不同；
    // 用数字比较会触发 MySQL 的 Truncated incorrect DOUBLE value 而整个删除事务失败。
    await conn.query('UPDATE todos SET project_id = NULL, phase_idx = NULL WHERE user_id = ? AND (project_id = ? OR project_id = ?)', [uid, 'rec_' + pid, String(pid)]);
    await conn.query('DELETE FROM projects WHERE id = ? AND user_id = ?', [pid, uid]);
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    try { await conn.rollback(); } catch (x) {}
    next(e);
  } finally { conn.release(); }
});

module.exports = router;
