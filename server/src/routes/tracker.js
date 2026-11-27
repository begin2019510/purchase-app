'use strict';
// /api/tracker —— 长期跟踪项目：记录 CRUD / 仪表盘汇总 / 结项与重开
// 字段定义在 projects.track_fields，记录在 project_records；只对 project_type='track' 生效。
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const T = require('../lib/tracker');
const { guard } = require('../middleware');

const router = express.Router();
router.use(guard(['tracker']));

function _pid(v) {
  const m = /^(?:rec_)?(\d+)$/.exec(String(v || '').trim());
  return m ? Number(m[1]) : null;
}
async function _ownedTrackProject(uid, pid) {
  if (!pid) return null;
  return db.one("SELECT * FROM projects WHERE id = ? AND user_id = ? AND project_type = 'track'", [pid, uid]);
}
function _fieldsOf(p) { return T.normalizeFields(p.track_fields); }
function _configOf(p, fields) { return T.normalizeConfig(p.track_config, fields); }
function _isClosed(config) { return !!(config && config.closed); }
function _closedError(res) {
  return res.status(409).json({ error: '项目已结项，如需继续记录请先重新打开' });
}
async function _allRecords(uid, pid) {
  const rows = await db.query(
    'SELECT * FROM project_records WHERE user_id = ? AND project_id = ? ORDER BY record_date ASC, id ASC',
    [uid, pid]);
  return rows.map(T.rowToRecord);
}
function _projectSummary(p, fields, config) {
  return {
    id: 'rec_' + p.id,
    name: p.name || '',
    description: p.description || '',
    status: p.status || '进行中',
    color: p.color || '#6366f1',
    projectType: 'track',
    trackFields: fields,
    trackConfig: config,
  };
}

// 列表：按记录日期倒序（没日期的按创建时间倒序），默认最近 500 条
router.get('/tracker/records', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const pid = _pid(req.query.projectId);
    if (!pid) return res.status(400).json({ error: '缺少项目 ID' });
    const p = await _ownedTrackProject(uid, pid);
    if (!p) return res.status(404).json({ error: '跟踪项目不存在' });
    let limit = Math.round(Number(req.query.limit));
    if (!Number.isFinite(limit) || limit < 1) limit = 500;
    limit = Math.min(1000, limit);
    // id 作为次级排序，同一天多条记录按录入顺序稳定展示
    limit = Math.floor(limit);
    const rows = await db.query(
      'SELECT * FROM project_records WHERE user_id = ? AND project_id = ? ORDER BY record_date DESC, id DESC LIMIT ' + limit,
      [uid, pid]);
    res.json(rows.map(T.rowToRecord));
  } catch (e) { next(e); }
});

// 仪表盘：服务端按全部记录算，避免前端只拿到最近 1000 条导致累计数被截断
router.get('/tracker/overview', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const pid = _pid(req.query.projectId);
    if (!pid) return res.status(400).json({ error: '缺少项目 ID' });
    const p = await _ownedTrackProject(uid, pid);
    if (!p) return res.status(404).json({ error: '跟踪项目不存在' });
    const fields = _fieldsOf(p);
    const config = _configOf(p, fields);
    const records = await _allRecords(uid, pid);
    const ov = T.computeOverview(fields, config, records, Date.now());
    ov.project = _projectSummary(p, fields, config);
    res.json(ov);
  } catch (e) { next(e); }
});

router.post('/tracker/records', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const pid = _pid(b.projectId);
    if (!pid) return res.status(400).json({ error: '缺少项目 ID' });
    const p = await _ownedTrackProject(uid, pid);
    if (!p) return res.status(404).json({ error: '跟踪项目不存在' });
    const fields = _fieldsOf(p);
    if (!fields.length) return res.status(400).json({ error: '请先设置跟踪字段' });
    const config = _configOf(p, fields);
    if (_isClosed(config)) return _closedError(res);
    const data = T.normalizeData(fields, b.data);
    const miss = T.missingRequired(fields, data);
    if (miss.length) return res.status(400).json({ error: '请填写：' + miss.join('、') });
    // 自定义项目可能没有日期字段：没填日期就记到今天，保证周/月汇总不会漏掉这条
    const recordDate = T.recordDateOf(fields, data, config) || T.bjToday();
    // 先打卡后记明细：当天若只有自动生成的「纯打卡」记录（只含日期/勾选字段），
    // 把这次明细合并进去，避免同一天出现两条记录、把记录数当成次数。
    const dateKeys = new Set(fields.filter(f => f.type === 'date').map(f => f.key));
    const parseData = raw => {
      try { const d = JSON.parse(raw || '{}'); return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {}; } catch (_) { return {}; }
    };
    const isCheckinOnly = raw => {
      const d = parseData(raw);
      return !Object.keys(d).some(k => {
        if (dateKeys.has(k)) return false;
        const f = fields.find(x => x.key === k);
        if (f && f.type === 'checkbox') return false;
        const v = d[k];
        return v !== '' && v !== false && v !== null && v !== undefined;
      });
    };
    const sameDay = await db.query(
      'SELECT id, data FROM project_records WHERE user_id = ? AND project_id = ? AND record_date = ? ORDER BY id ASC',
      [uid, pid, recordDate]);
    const bare = sameDay.find(r => isCheckinOnly(r.data));
    if (bare) {
      const old = parseData(bare.data);
      const merged = Object.assign({}, old, data);
      // 勾选字段保留旧值 true：打卡不能被「记一笔」表单里的空勾选覆盖
      fields.forEach(f => {
        if (f.type === 'checkbox' && old[f.key] === true) merged[f.key] = true;
      });
      const norm = T.normalizeData(fields, merged);
      await db.exec('UPDATE project_records SET data = ? WHERE id = ? AND user_id = ?',
        [JSON.stringify(norm), bare.id, uid]);
      const mergedRow = await db.one('SELECT * FROM project_records WHERE id = ? AND user_id = ?', [bare.id, uid]);
      return res.json(T.rowToRecord(mergedRow));
    }
    const r = await db.exec(
      'INSERT INTO project_records (user_id, project_id, record_date, data) VALUES (?,?,?,?)',
      [uid, pid, recordDate, JSON.stringify(data)]);
    const row = await db.one('SELECT * FROM project_records WHERE id = ? AND user_id = ?', [r.insertId, uid]);
    res.json(T.rowToRecord(row));
  } catch (e) { next(e); }
});

router.put('/tracker/records', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const id = H.numFromId(b.id);
    if (!id) return res.status(400).json({ error: '缺少记录 ID' });
    const rec = await db.one('SELECT * FROM project_records WHERE id = ? AND user_id = ?', [id, uid]);
    if (!rec) return res.status(404).json({ error: '记录不存在' });
    const p = await _ownedTrackProject(uid, rec.project_id);
    if (!p) return res.status(404).json({ error: '跟踪项目不存在' });
    const fields = _fieldsOf(p);
    if (!fields.length) return res.status(400).json({ error: '请先设置跟踪字段' });
    const config = _configOf(p, fields);
    if (_isClosed(config)) return _closedError(res);
    const data = T.normalizeData(fields, b.data);
    const miss = T.missingRequired(fields, data);
    if (miss.length) return res.status(400).json({ error: '请填写：' + miss.join('、') });
    const recordDate = T.recordDateOf(fields, data, config) || T.bjToday();
    await db.exec(
      'UPDATE project_records SET record_date = ?, data = ? WHERE id = ? AND user_id = ?',
      [recordDate, JSON.stringify(data), id, uid]);
    const row = await db.one('SELECT * FROM project_records WHERE id = ? AND user_id = ?', [id, uid]);
    res.json(T.rowToRecord(row));
  } catch (e) { next(e); }
});

// 项目内打卡：只改当天记录里的某个「勾选」字段，不校验其它必填项。
// 打卡是项目里的重复动作，不应被「写详细记录」的必填字段拦住。
router.post('/tracker/checkin', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const pid = _pid(b.projectId);
    if (!pid) return res.status(400).json({ error: '缺少项目 ID' });
    const p = await _ownedTrackProject(uid, pid);
    if (!p) return res.status(404).json({ error: '跟踪项目不存在' });
    const fields = _fieldsOf(p);
    if (!fields.length) return res.status(400).json({ error: '请先设置跟踪字段' });
    const config = _configOf(p, fields);
    if (_isClosed(config)) return _closedError(res);

    const key = String(b.field || '').trim();
    const field = fields.find(f => f.key === key);
    if (!field) return res.status(400).json({ error: '打卡项不存在' });
    if (field.type !== 'checkbox') return res.status(400).json({ error: '只有勾选字段可以作为打卡项' });
    const value = !!(b.value === true || b.value === 1 || b.value === '1' || b.value === 'true');

    // 补卡：允许指定过去日期，最早到项目开始日，最晚今天；不传则记今天
    const today = T.bjToday();
    const startDate = config.startDate || T.normDate(p.created_at) || today;
    let recordDate = today;
    if (b.date != null && String(b.date).trim() !== '') {
      const want = T.normDate(b.date);
      if (!want) return res.status(400).json({ error: '打卡日期格式不对' });
      if (want > today) return res.status(400).json({ error: '不能给未来日期打卡' });
      if (want < startDate) return res.status(400).json({ error: '补卡最早从项目开始日 ' + startDate + ' 起' });
      recordDate = want;
    }
    // 打卡是「一整天」的属性：同一天可能有多条记录（同日可多条是允许的），
    // 状态与写入都必须覆盖当天所有记录，否则会出现「页面看明细行、接口改打卡行」的错位。
    const dayRows = await db.query(
      'SELECT id, data FROM project_records WHERE user_id = ? AND project_id = ? AND record_date = ? ORDER BY id ASC',
      [uid, pid, recordDate]);

    const dateField = fields.find(f => f.type === 'date' && f.key === config.dateField)
      || fields.find(f => f.type === 'date');
    const hasContent = data => Object.keys(data).some(k => {
      if (dateField && k === dateField.key) return false;
      const v = data[k];
      return v !== '' && v !== false && v !== null && v !== undefined;
    });
    const parseData = raw => {
      try { const d = JSON.parse(raw || '{}'); return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {}; } catch (_) { return {}; }
    };

    if (!dayRows.length) {
      if (!value) return res.json({ ok: true, checked: false, record: null });
      const data = {};
      if (dateField) data[dateField.key] = recordDate;
      data[key] = true;
      const normalized = T.normalizeData(fields, data);
      const r = await db.exec(
        'INSERT INTO project_records (user_id, project_id, record_date, data) VALUES (?,?,?,?)',
        [uid, pid, recordDate, JSON.stringify(normalized)]);
      const row = await db.one('SELECT * FROM project_records WHERE id = ? AND user_id = ?', [r.insertId, uid]);
      return res.json({ ok: true, checked: true, record: T.rowToRecord(row) });
    }

    if (value) {
      // 优先勾到「有内容」的记录上，避免又新增一条纯打卡行
      const target = dayRows.find(r => hasContent(parseData(r.data))) || dayRows[0];
      const data = parseData(target.data);
      data[key] = true;
      const normalized = T.normalizeData(fields, data);
      await db.exec('UPDATE project_records SET data = ? WHERE id = ? AND user_id = ?',
        [JSON.stringify(normalized), target.id, uid]);
      const row = await db.one('SELECT * FROM project_records WHERE id = ? AND user_id = ?', [target.id, uid]);
      return res.json({ ok: true, checked: true, record: T.rowToRecord(row) });
    }

    // 取消：清掉当天每条记录的该勾选；改完没有任何内容的记录顺手删除
    let firstRow = null;
    for (const r of dayRows) {
      const data = parseData(r.data);
      data[key] = false;
      const normalized = T.normalizeData(fields, data);
      if (!hasContent(normalized)) {
        await db.exec('DELETE FROM project_records WHERE id = ? AND user_id = ?', [r.id, uid]);
      } else {
        await db.exec('UPDATE project_records SET data = ? WHERE id = ? AND user_id = ?',
          [JSON.stringify(normalized), r.id, uid]);
        if (!firstRow) firstRow = await db.one('SELECT * FROM project_records WHERE id = ? AND user_id = ?', [r.id, uid]);
      }
    }
    res.json({ ok: true, checked: false, record: firstRow ? T.rowToRecord(firstRow) : null, deleted: !firstRow });
  } catch (e) { next(e); }
});

// 记录是真删：表格行是用户主动录入的过程数据，不做回收站，避免和待办的软删语义混淆
router.delete('/tracker/records', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const id = H.numFromId(req.query.id);
    if (!id) return res.status(400).json({ error: '缺少记录 ID' });
    const rec = await db.one('SELECT * FROM project_records WHERE id = ? AND user_id = ?', [id, uid]);
    if (!rec) return res.json({ ok: true });
    const p = await _ownedTrackProject(uid, rec.project_id);
    if (p) {
      const config = _configOf(p, _fieldsOf(p));
      if (_isClosed(config)) return _closedError(res);
    }
    await db.exec('DELETE FROM project_records WHERE id = ? AND user_id = ?', [id, uid]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 字段/目标/里程碑/日期/看板配置整体保存；删字段不删历史 data（重新加回同 key 时还能看到）
router.put('/tracker/fields', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const pid = _pid(b.projectId);
    if (!pid) return res.status(400).json({ error: '缺少项目 ID' });
    const p = await _ownedTrackProject(uid, pid);
    if (!p) return res.status(404).json({ error: '跟踪项目不存在' });
    const oldFields = _fieldsOf(p);
    const oldConfig = _configOf(p, oldFields);
    if (_isClosed(oldConfig)) return _closedError(res);

    const fields = T.normalizeFields(b.fields === undefined ? oldFields : b.fields);
    if (!fields.length) return res.status(400).json({ error: '至少保留一个字段' });
    // 目标文案是跟踪项目的必填项；改配置时不能被清空
    const rawConfig = b.config === undefined ? oldConfig : (b.config || {});
    const config = T.normalizeConfig(rawConfig, fields);
    if (!config.goal.text) return res.status(400).json({ error: '请填写项目目标' });
    if (!config.startDate) config.startDate = oldConfig.startDate || T.bjToday();

    await db.exec('UPDATE projects SET track_fields = ?, track_config = ? WHERE id = ? AND user_id = ?',
      [JSON.stringify(fields), JSON.stringify(config), pid, uid]);
    res.json({ ok: true, fields: fields, config: config });
  } catch (e) { next(e); }
});

// 里程碑单独勾选：仪表盘/明细里点一下就更新，不用把整份配置回传
router.post('/tracker/milestone', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const pid = _pid(b.projectId);
    if (!pid) return res.status(400).json({ error: '缺少项目 ID' });
    const p = await _ownedTrackProject(uid, pid);
    if (!p) return res.status(404).json({ error: '跟踪项目不存在' });
    const fields = _fieldsOf(p);
    const config = _configOf(p, fields);
    if (_isClosed(config)) return _closedError(res);
    const mid = String(b.id || '').trim();
    const ms = config.milestones.find(m => m.id === mid);
    if (!ms) return res.status(404).json({ error: '里程碑不存在' });
    ms.done = b.done === true || b.done === 1 || b.done === '1';
    ms.doneDate = ms.done ? (T.normDate(b.doneDate) || T.bjToday()) : '';
    await db.exec('UPDATE projects SET track_config = ? WHERE id = ? AND user_id = ?',
      [JSON.stringify(config), pid, uid]);
    res.json({ ok: true, milestones: config.milestones });
  } catch (e) { next(e); }
});

// 结项：复用 status='已完成'（不改旧状态枚举），结果/备注/时间存 track_config.closed
router.post('/tracker/close', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const pid = _pid(b.projectId);
    if (!pid) return res.status(400).json({ error: '缺少项目 ID' });
    const p = await _ownedTrackProject(uid, pid);
    if (!p) return res.status(404).json({ error: '跟踪项目不存在' });
    const fields = _fieldsOf(p);
    const config = _configOf(p, fields);
    if (config.closed) {
      return res.json({ ok: true, already: true, closed: config.closed });
    }
    const result = b.result === 'ended' ? 'ended' : 'achieved';
    config.closed = {
      at: Date.now(),
      result: result,
      note: String(b.note || '').trim().slice(0, 2000),
    };
    await db.exec("UPDATE projects SET status = '已完成', track_config = ? WHERE id = ? AND user_id = ?",
      [JSON.stringify(config), pid, uid]);
    const records = await _allRecords(uid, pid);
    const ov = T.computeOverview(fields, config, records, Date.now());
    res.json({ ok: true, closed: config.closed, report: ov.report, overview: ov });
  } catch (e) { next(e); }
});

// 重新打开：清空结项信息，状态回到进行中，历史记录原样保留
router.post('/tracker/reopen', async (req, res, next) => {
  try {
    const uid = await H.resolveUserId(req.username);
    const b = req.body || {};
    const pid = _pid(b.projectId);
    if (!pid) return res.status(400).json({ error: '缺少项目 ID' });
    const p = await _ownedTrackProject(uid, pid);
    if (!p) return res.status(404).json({ error: '跟踪项目不存在' });
    const fields = _fieldsOf(p);
    const config = _configOf(p, fields);
    config.closed = null;
    await db.exec("UPDATE projects SET status = '进行中', track_config = ? WHERE id = ? AND user_id = ?",
      [JSON.stringify(config), pid, uid]);
    res.json({ ok: true, config: config });
  } catch (e) { next(e); }
});

module.exports = router;
