'use strict';
// 长期跟踪项目的纯函数内核：字段规范化 / 记录规范化 / 目标指标 / 周月汇总 / 结项报告
// 字段定义存 projects.track_fields，统计与目标存 projects.track_config，记录存 project_records。
// 所有日期都是北京时间 YYYY-MM-DD（record_date 用 CHAR(10)，避免 MySQL 驱动做时区换算）。

const FIELD_TYPES = new Set(['text', 'longtext', 'number', 'date', 'select', 'checkbox']);
const MAX_FIELDS = 24;
const MAX_OPTIONS = 30;
const MAX_MILESTONES = 60;
const MAX_NUMBER = 1e9;
const KEY_RE = /^[a-z][a-z0-9_]{0,23}$/;
const TEMPLATES = new Set(['job', 'fitness', 'reading', 'study', 'habit', 'custom']);
const AGGS = new Set(['count', 'countValue', 'countTrue', 'sum', 'latest', 'max']);

const DAY_MS = 86400000;

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}
function parseJSON(raw, def) {
  if (raw == null || raw === '') return def;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch (e) { return def; }
}
function isDateStr(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
// 统一成北京时间的 YYYY-MM-DD；纯日期原样保留，带时间的按 +08:00 取日期
function normDate(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isDateStr(s) ? s : '';
  const ms = new Date(s).getTime();
  if (!Number.isFinite(ms)) return '';
  const bj = new Date(ms + 8 * 3600 * 1000);
  return bj.toISOString().slice(0, 10);
}
function normNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(-MAX_NUMBER, Math.min(MAX_NUMBER, n));
}
function round2(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}
function fmtNum(n) {
  const r = round2(n);
  if (r == null) return '';
  return String(Math.round(r) === r ? Math.round(r) : r);
}
function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

// ===== 日期区间（全部基于北京时间日期字符串）=====
function bjDateStr(ms) {
  return new Date((ms == null ? Date.now() : ms) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function bjToday(nowMs) { return bjDateStr(nowMs); }
function addDays(dateStr, n) {
  const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7)), d = Number(dateStr.slice(8, 10));
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}
function daysBetween(from, to) {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / DAY_MS);
}
function weekRange(dateStr) {
  const d = isDateStr(dateStr) ? dateStr : bjDateStr(Date.now());
  const dt = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))));
  const dow = (dt.getUTCDay() + 6) % 7; // 周一=0
  const start = addDays(d, -dow);
  return { start: start, end: addDays(start, 6) };
}
function monthRange(dateStr) {
  const d = isDateStr(dateStr) ? dateStr : bjDateStr(Date.now());
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  return {
    start: d.slice(0, 7) + '-01',
    end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10),
    label: y + '年' + m + '月',
  };
}

// ===== 字段定义 =====
// 去重 key、限制类型/长度/选项数；宽高只是前端展示提示
function normalizeFields(raw) {
  const arr = parseJSON(raw, []);
  if (!Array.isArray(arr)) return [];
  const out = [];
  const used = new Set();
  for (const f of arr.slice(0, MAX_FIELDS)) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
    let key = str(f.key, 24).toLowerCase();
    if (!KEY_RE.test(key) || used.has(key)) {
      let i = out.length + 1;
      while (used.has('f' + i)) i++;
      key = 'f' + i;
    }
    used.add(key);
    const name = str(f.name, 20) || ('字段' + (out.length + 1));
    const type = FIELD_TYPES.has(String(f.type)) ? String(f.type) : 'text';
    const one = { key: key, name: name, type: type };
    if (type === 'select') {
      const opts = (Array.isArray(f.options) ? f.options : [])
        .map(x => str(x && typeof x === 'object' ? x.name : x, 30))
        .filter(Boolean);
      one.options = [...new Set(opts)].slice(0, MAX_OPTIONS);
    }
    if (type === 'number') one.unit = str(f.unit, 10);
    if (f.required === true) one.required = true;
    const w = Number(f.width);
    if (Number.isFinite(w)) one.width = Math.min(320, Math.max(60, Math.round(w)));
    out.push(one);
  }
  return out;
}

function normalizeValue(field, v) {
  if (field.type === 'checkbox') return !!(v === true || v === 1 || v === '1' || v === 'true');
  if (field.type === 'number') return normNumber(v);
  if (field.type === 'date') return normDate(v);
  if (field.type === 'select') return str(v, 30);
  return str(v, field.type === 'longtext' ? 5000 : 300);
}

// 只保留当前字段定义里存在的键；空字符串/空日期/空选项不落库，数字 0 和 false 保留
function normalizeData(fields, raw) {
  const src = parseJSON(raw, {});
  const out = {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const f of fields) {
    if (!Object.prototype.hasOwnProperty.call(src, f.key)) continue;
    const v = normalizeValue(f, src[f.key]);
    if (f.type === 'checkbox') out[f.key] = v;
    else if (f.type === 'number') { if (v !== null) out[f.key] = v; }
    else if (v !== '') out[f.key] = v;
  }
  return out;
}

function missingRequired(fields, data) {
  const miss = [];
  for (const f of fields) {
    if (!f.required) continue;
    const v = data[f.key];
    if (v === undefined || v === null || v === '' || v === false) miss.push(f.name);
  }
  return miss;
}

// 记录归属日期：优先配置的 dateField，否则取第一个有值的日期字段
function recordDateOf(fields, data, config) {
  const cfg = config || {};
  const byKey = {};
  fields.forEach(f => { byKey[f.key] = f; });
  if (cfg.dateField && byKey[cfg.dateField] && byKey[cfg.dateField].type === 'date') {
    const v = normDate(data[cfg.dateField]);
    if (v) return v;
  }
  for (const f of fields) {
    if (f.type !== 'date') continue;
    const v = normDate(data[f.key]);
    if (v) return v;
  }
  return null;
}

// ===== 统计配置 =====
function fieldByName(fields, key) {
  return fields.find(f => f.key === key) || null;
}

function normMetric(raw, fields) {
  const m = (raw && typeof raw === 'object') ? raw : {};
  let agg = AGGS.has(String(m.agg)) ? String(m.agg) : 'count';
  const key = str(m.field, 24);
  const field = fields.find(f => f.key === key) || null;
  const value = str(m.value, 30);
  if (agg === 'countTrue') {
    if (!field || field.type !== 'checkbox') agg = 'count';
  } else if (agg === 'countValue') {
    if (!field || field.type === 'checkbox' || field.type === 'number' || field.type === 'date') agg = 'count';
  } else if (agg === 'sum' || agg === 'latest' || agg === 'max') {
    if (!field || field.type !== 'number') agg = 'count';
  }
  if (agg === 'count') return { agg: 'count', field: '', value: '' };
  if (agg === 'countTrue') return { agg: agg, field: field.key, value: '' };
  if (agg === 'countValue') return { agg: agg, field: field.key, value: value };
  return { agg: agg, field: field.key, value: '' };
}

function metricLabel(metric, fields) {
  if (!metric || metric.agg === 'count') return '记录数';
  const f = fieldByName(fields, metric.field);
  const name = f ? f.name : metric.field;
  if (metric.agg === 'countValue') return name + ' = ' + metric.value;
  return name;
}

function normalizeMilestones(raw) {
  const arr = parseJSON(raw, []);
  if (!Array.isArray(arr)) return [];
  const out = [];
  const used = new Set();
  for (const m of arr.slice(0, MAX_MILESTONES)) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    let id = str(m.id, 24).toLowerCase();
    if (!/^[a-z0-9_-]{1,24}$/.test(id) || used.has(id)) {
      let i = out.length + 1;
      while (used.has('m' + i)) i++;
      id = 'm' + i;
    }
    used.add(id);
    const name = str(m.name, 50);
    if (!name) continue;
    const one = {
      id: id,
      name: name,
      targetDate: normDate(m.targetDate),
      targetValue: normNumber(m.targetValue),
      done: m.done === true || m.done === 1 || m.done === '1',
      doneDate: '',
    };
    if (one.done) one.doneDate = normDate(m.doneDate);
    out.push(one);
  }
  return out;
}

function normalizeClosed(raw) {
  const c = (raw && typeof raw === 'object') ? raw : null;
  if (!c) return null;
  let at = Number(c.at);
  if (!Number.isFinite(at) || at <= 0) at = normDate(c.at) ? new Date(normDate(c.at) + 'T00:00:00+08:00').getTime() : 0;
  if (!at) return null;
  const result = c.result === 'ended' ? 'ended' : 'achieved';
  return { at: at, result: result, note: str(c.note, 2000) };
}

// 配置只认当前字段里存在的 key；非法值静默回退，保证前端怎么改都不会把项目写坏
function normalizeConfig(raw, fields) {
  const c = parseJSON(raw, {}) || {};
  const first = type => (fields.find(f => f.type === type) || {}).key || '';
  const pick = (v, type) => {
    const k = str(v, 24);
    return fields.some(f => f.key === k && (!type || f.type === type)) ? k : '';
  };

  const g = (c.goal && typeof c.goal === 'object') ? c.goal : {};
  let kind = ['number', 'milestone', 'none'].includes(String(g.kind)) ? String(g.kind) : 'none';
  const metric = normMetric(g.metric, fields);
  let target = normNumber(g.target);
  if (target !== null && target < 0) target = null;
  let baseline = normNumber(g.baseline);
  const goal = {
    text: str(g.text, 200),
    kind: kind,
    metric: metric,
    target: target,
    unit: str(g.unit, 10),
    direction: g.direction === 'down' ? 'down' : 'up',
    baseline: baseline,
  };

  const w = (c.week && typeof c.week === 'object') ? c.week : {};
  let weekTarget = Math.round(Number(w.target));
  if (!Number.isFinite(weekTarget) || weekTarget < 0) weekTarget = 0;
  if (weekTarget > 1000) weekTarget = 1000;
  const week = {
    target: weekTarget,
    unit: str(w.unit, 10) || '次',
    metric: normMetric(w.metric, fields),
  };

  let startDate = normDate(c.startDate);
  let targetDate = normDate(c.targetDate);
  if (startDate && targetDate && targetDate < startDate) targetDate = '';

  return {
    template: TEMPLATES.has(String(c.template)) ? String(c.template) : 'custom',
    startDate: startDate,
    targetDate: targetDate,
    goal: goal,
    week: week,
    milestones: normalizeMilestones(c.milestones),
    dateField: pick(c.dateField, 'date') || first('date'),
    titleField: pick(c.titleField) || first('text') || first('longtext') || first('date'),
    kanbanField: pick(c.kanbanField, 'select') || first('select'),
    closed: normalizeClosed(c.closed),
  };
}

// mysql 行 → 前端记录（DATE 列故意用 CHAR(10)，避免驱动时区换算）
function rowToRecord(r) {
  return {
    id: 'rec_' + r.id,
    projectId: 'rec_' + r.project_id,
    recordDate: r.record_date ? String(r.record_date).slice(0, 10) : '',
    data: parseJSON(r.data, {}),
    createdAt: r.created_at ? new Date(r.created_at).getTime() : null,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
  };
}

// ===== 指标计算 =====
function recordKey(rec) {
  const m = /(\d+)$/.exec(String(rec && rec.id || ''));
  return m ? Number(m[1]) : 0;
}
function sortedRecords(records) {
  return (records || []).slice().sort((a, b) => {
    const da = a.recordDate || '', db = b.recordDate || '';
    if (da !== db) return da < db ? -1 : 1;
    return recordKey(a) - recordKey(b);
  });
}

// 指标值：count 类空集返回 0，数值类空集返回 null
function metricValue(metric, records) {
  const list = records || [];
  const agg = metric && metric.agg ? metric.agg : 'count';
  if (agg === 'count') return list.length;
  if (!metric || !metric.field) return agg === 'sum' ? 0 : null;
  const f = metric.field;
  if (agg === 'countValue') {
    if (!metric.value) return 0;
    return list.reduce((n, r) => n + (String((r.data || {})[f]) === metric.value ? 1 : 0), 0);
  }
  if (agg === 'countTrue') {
    return list.reduce((n, r) => n + ((r.data || {})[f] === true ? 1 : 0), 0);
  }
  const nums = [];
  for (const r of sortedRecords(list)) {
    const v = (r.data || {})[f];
    if (typeof v === 'number' && Number.isFinite(v)) nums.push(v);
  }
  if (agg === 'sum') return nums.length ? round2(nums.reduce((a, b) => a + b, 0)) : 0;
  if (agg === 'latest') return nums.length ? nums[nums.length - 1] : null;
  if (agg === 'max') return nums.length ? Math.max.apply(null, nums) : null;
  return null;
}

function goalProgress(config, records) {
  const g = config.goal;
  const all = records || [];
  const out = {
    text: g.text,
    kind: g.kind,
    unit: g.unit,
    direction: g.direction,
    target: g.target,
    current: null,
    baseline: g.baseline,
    pct: null,
    achieved: false,
    remaining: null,
    total: 0,
    done: 0,
  };
  if (g.kind === 'milestone') {
    const ms = config.milestones || [];
    out.total = ms.length;
    out.done = ms.filter(m => m.done).length;
    out.current = out.done;
    out.achieved = out.total > 0 && out.done >= out.total;
    out.pct = out.total > 0 ? clampPct(out.done / out.total * 100) : null;
    out.remaining = out.total > 0 ? Math.max(0, out.total - out.done) : null;
    return out;
  }
  if (g.kind !== 'number') return out;

  out.current = metricValue(g.metric, all);
  if (g.direction === 'down' && out.baseline == null && g.metric.agg === 'latest') {
    const sorted = sortedRecords(all);
    for (const r of sorted) {
      const v = (r.data || {})[g.metric.field];
      if (typeof v === 'number' && Number.isFinite(v)) { out.baseline = v; break; }
    }
  }
  const cur = out.current, target = g.target;
  if (cur != null && target != null) {
    out.achieved = g.direction === 'down' ? cur <= target : cur >= target;
    if (g.direction === 'down') {
      if (out.baseline != null && out.baseline > target) {
        out.pct = clampPct((out.baseline - cur) / (out.baseline - target) * 100);
      } else if (out.baseline != null) {
        out.pct = out.achieved ? 100 : 0;
      } else {
        out.pct = out.achieved ? 100 : (cur > 0 ? clampPct(target / cur * 100) : 0);
      }
      out.remaining = out.achieved ? 0 : round2(cur - target);
    } else {
      out.pct = target > 0 ? clampPct(cur / target * 100) : (cur >= 0 ? 100 : 0);
      out.remaining = out.achieved ? 0 : round2(target - cur);
    }
  }
  return out;
}

function milestonesDoneBetween(config, start, end) {
  return (config.milestones || []).filter(m => {
    if (!m.done || !m.doneDate) return false;
    if (start && m.doneDate < start) return false;
    if (end && m.doneDate > end) return false;
    return true;
  });
}

function nextMilestone(config) {
  const ms = (config.milestones || []).filter(m => !m.done);
  if (!ms.length) return null;
  return ms.slice().sort((a, b) => {
    const da = a.targetDate || '9999-99-99', db = b.targetDate || '9999-99-99';
    if (da !== db) return da < db ? -1 : 1;
    return 0;
  })[0];
}

// 连续达标周：当前周未达标不打断，从上一完整周继续往前数
function computeStreak(config, records, todayStr) {
  const target = config.week.target;
  if (!(target > 0)) return 0;
  const start = config.startDate || (records.length ? sortedRecords(records)[0].recordDate : todayStr);
  if (!isDateStr(start)) return 0;
  const map = {};
  for (const r of records) {
    if (!r.recordDate) continue;
    const ws = weekRange(r.recordDate).start;
    (map[ws] = map[ws] || []).push(r);
  }
  const startWeek = weekRange(start).start;
  let cursor = weekRange(todayStr).start;
  let streak = 0;
  let current = true;
  for (let guard = 0; guard < 520 && cursor >= startWeek; guard++) {
    const val = metricValue(config.week.metric, map[cursor] || []);
    const met = val != null && val >= target;
    if (current) {
      current = false;
      if (met) streak++;
    } else {
      if (!met) break;
      streak++;
    }
    cursor = addDays(cursor, -7);
  }
  return streak;
}

function statusDistribution(config, records) {
  const key = config.kanbanField;
  if (!key) return [];
  const counts = {};
  let empty = 0;
  for (const r of records) {
    const v = (r.data || {})[key];
    const s = v == null ? '' : String(v);
    if (!s) { empty++; continue; }
    counts[s] = (counts[s] || 0) + 1;
  }
  const out = Object.keys(counts).map(k => ({ name: k, count: counts[k] }));
  out.sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
  if (empty) out.push({ name: '未填', count: empty });
  return out.slice(0, 12);
}

// ===== 周期统计 =====
function inRange(rec, start, end) {
  return !!rec.recordDate && rec.recordDate >= start && rec.recordDate <= end;
}
function activeDaysOf(records) {
  const set = new Set();
  for (const r of records) if (r.recordDate) set.add(r.recordDate);
  return set.size;
}
function summarize(label, count, activeDays, config, doneMilestones, metricNow) {
  if (!count) {
    let s = label + '还没有记录';
    if (doneMilestones.length) s += '，但完成了里程碑「' + doneMilestones.map(m => m.name).join('」「') + '」';
    return s;
  }
  let s = label + '记录 ' + count + ' 条，活跃 ' + activeDays + ' 天';
  if (metricNow != null && config.goal.kind === 'number' && config.goal.metric.agg !== 'count') {
    s += '，' + metricNow.label + ' ' + metricNow.value + (metricNow.unit ? ' ' + metricNow.unit : '');
  }
  if (doneMilestones.length) s += '，完成里程碑「' + doneMilestones.map(m => m.name).join('」「') + '」';
  return s;
}

function weekSeries(records, start) {
  const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    out.push({ date: d, label: labels[i], count: records.filter(r => r.recordDate === d).length });
  }
  return out;
}
function monthSeries(records, start) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const days = [];
    for (let d = i * 7 + 1; d <= Math.min((i + 1) * 7, 31); d++) days.push(String(d).padStart(2, '0'));
    out.push({ label: '第' + (i + 1) + '周', count: records.filter(r => days.includes(Number(r.recordDate.slice(8, 10)))).length });
  }
  return out;
}
function allSeries(records, startDate, endDate) {
  const first = startDate || (records.length ? sortedRecords(records)[0].recordDate : endDate);
  if (!isDateStr(first)) return [];
  let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7));
  const ey = Number(endDate.slice(0, 4)), em = Number(endDate.slice(5, 7));
  const keys = [];
  for (let guard = 0; guard < 240 && (y < ey || (y === ey && m <= em)); guard++) {
    keys.push(y + '-' + String(m).padStart(2, '0'));
    m++;
    if (m > 12) { m = 1; y++; }
  }
  const cut = keys.length > 24 ? keys.slice(keys.length - 24) : keys;
  return cut.map(k => {
    const rs = records.filter(r => r.recordDate && r.recordDate.slice(0, 7) === k);
    return { label: k, count: rs.length, value: null };
  });
}

function computeOverview(fields, config, rawRecords, nowMs) {
  const records = sortedRecords(rawRecords);
  const today = bjToday(nowMs);
  const todayMs = nowMs == null ? Date.now() : nowMs;
  const closedAt = config.closed && config.closed.at ? config.closed.at : null;
  const endForAll = closedAt ? bjDateStr(closedAt) : today;

  const firstRecord = records.length ? records[0].recordDate : '';
  const startDate = config.startDate || firstRecord || today;
  const wr = weekRange(today);
  const mr = monthRange(today);

  const weekRecs = records.filter(r => inRange(r, wr.start, wr.end));
  const monthRecs = records.filter(r => inRange(r, mr.start, mr.end));
  const allEnd = endForAll >= startDate ? endForAll : today;
  const allRecs = records.filter(r => !r.recordDate || (r.recordDate >= startDate && r.recordDate <= allEnd));

  const wDone = milestonesDoneBetween(config, wr.start, wr.end);
  const mDone = milestonesDoneBetween(config, mr.start, mr.end);
  const aDone = milestonesDoneBetween(config, startDate, allEnd);

  const goal = goalProgress(config, allRecs);

  function metricNow(label, recs) {
    if (config.goal.kind !== 'number' || config.goal.metric.agg === 'count') return null;
    const v = metricValue(config.goal.metric, recs);
    if (v == null) return null;
    const f = fieldByName(fields, config.goal.metric.field);
    return { label: f ? f.name : metricLabel(config.goal.metric, fields), value: fmtNum(v), unit: f && f.unit ? f.unit : '' };
  }

  const weekValue = metricValue(config.week.metric, weekRecs);
  const week = {
    start: wr.start,
    end: wr.end,
    count: weekRecs.length,
    activeDays: activeDaysOf(weekRecs),
    value: weekValue,
    target: config.week.target,
    unit: config.week.unit,
    metricLabel: metricLabel(config.week.metric, fields),
    pct: config.week.target > 0 && weekValue != null ? clampPct(weekValue / config.week.target * 100) : null,
    met: config.week.target > 0 && weekValue != null && weekValue >= config.week.target,
    milestones: wDone,
    distribution: statusDistribution(config, weekRecs),
    summary: '',
  };
  week.summary = summarize('本周', week.count, week.activeDays, config, wDone, metricNow(null, weekRecs));
  if (week.count && week.target > 0) {
    week.summary += '；' + week.metricLabel + ' ' + fmtNum(weekValue) + ' ' + week.unit +
      (week.met ? '，已达标 🎉' : '，还差 ' + fmtNum(Math.max(0, week.target - weekValue)) + ' ' + week.unit);
  }

  const month = {
    start: mr.start,
    end: mr.end,
    label: mr.label,
    count: monthRecs.length,
    activeDays: activeDaysOf(monthRecs),
    value: metricValue(config.week.metric, monthRecs),
    target: config.week.target,
    unit: config.week.unit,
    metricLabel: metricLabel(config.week.metric, fields),
    milestones: mDone,
    distribution: statusDistribution(config, monthRecs),
    summary: '',
  };
  month.summary = summarize('本月', month.count, month.activeDays, config, mDone, metricNow(null, monthRecs));

  const all = {
    count: allRecs.length,
    activeDays: activeDaysOf(allRecs),
    start: startDate,
    end: allEnd,
    milestones: aDone,
    distribution: statusDistribution(config, allRecs),
    summary: '',
  };
  all.summary = summarize('累计', all.count, all.activeDays, config, aDone, metricNow(null, allRecs));

  const streak = computeStreak(config, records, today);

  // 图表序列：周=7 天，月=5 个周段，全部=最近 24 个月
  const series = {
    week: weekSeries(weekRecs, wr.start),
    month: monthSeries(monthRecs, mr.start),
    all: allSeries(allRecs, startDate, allEnd),
  };
  if (series.all.length) {
    series.all.forEach(b => {
      const rs = allRecs.filter(r => r.recordDate && r.recordDate.slice(0, 7) === b.label);
      b.value = config.goal.kind === 'number' ? metricValue(config.goal.metric, rs) : null;
      b.activeDays = activeDaysOf(rs);
    });
  }
  series.week.forEach(b => {
    b.value = config.goal.kind === 'number' ? metricValue(config.goal.metric, weekRecs.filter(r => r.recordDate === b.date)) : null;
  });
  series.month.forEach((b, i) => {
    const rs = monthRecs.filter(r => {
      const day = Number(r.recordDate.slice(8, 10));
      return Math.min(4, Math.floor((day - 1) / 7)) === i;
    });
    b.value = config.goal.kind === 'number' ? metricValue(config.goal.metric, rs) : null;
  });

  const startInfo = daysBetween(startDate, today);
  const daysLeft = config.targetDate ? daysBetween(today, config.targetDate) : null;
  const overdueDays = config.targetDate && !config.closed && config.targetDate < today ? daysBetween(config.targetDate, today) : 0;

  const doneCount = (config.milestones || []).filter(m => m.done).length;

  let report = null;
  if (config.closed) {
    const closeDate = bjDateStr(config.closed.at);
    const totalDays = Math.max(1, daysBetween(startDate, closeDate) + 1);
    const g = goalProgress(config, records);
    report = {
      closedAt: config.closed.at,
      closedDate: closeDate,
      result: config.closed.result,
      resultText: config.closed.result === 'achieved' ? '达成目标' : '提前结束',
      note: config.closed.note,
      days: totalDays,
      startDate: startDate,
      endDate: closeDate,
      records: allRecs.length,
      activeDays: activeDaysOf(allRecs),
      milestonesDone: doneCount,
      milestonesTotal: (config.milestones || []).length,
      goal: g,
      summary: '从 ' + startDate + ' 到 ' + closeDate + '，共 ' + totalDays + ' 天；记录 ' + allRecs.length +
        ' 条，活跃 ' + activeDaysOf(allRecs) + ' 天；里程碑完成 ' + doneCount + '/' + (config.milestones || []).length + ' 个。',
    };
  }

  return {
    fields: fields,
    config: config,
    today: today,
    records: {
      total: records.length,
      activeDays: activeDaysOf(records),
      firstDate: firstRecord,
      lastDate: records.length ? records[records.length - 1].recordDate : '',
    },
    goal: goal,
    week: week,
    month: month,
    all: all,
    streak: streak,
    series: series,
    distribution: statusDistribution(config, allRecs),
    nextMilestone: nextMilestone(config),
    milestones: config.milestones,
    startDate: startDate,
    targetDate: config.targetDate,
    daysElapsed: startInfo,
    daysLeft: daysLeft,
    overdueDays: overdueDays,
    closed: config.closed,
    report: report,
  };
}

// 项目列表/看板用的轻量统计（每条跟踪项目计算一次，跟踪项目数量预期很少）
function boardStats(fields, config, records, nowMs) {
  const today = bjToday(nowMs);
  const g = goalProgress(config, records);
  const wr = weekRange(today);
  const weekRecs = records.filter(r => inRange(r, wr.start, wr.end));
  const wv = metricValue(config.week.metric, weekRecs);
  const next = nextMilestone(config);
  return {
    goal: g,
    week: {
      start: wr.start,
      end: wr.end,
      count: weekRecs.length,
      value: wv,
      target: config.week.target,
      unit: config.week.unit,
      metricLabel: metricLabel(config.week.metric, fields || []),
      pct: config.week.target > 0 && wv != null ? clampPct(wv / config.week.target * 100) : null,
      met: config.week.target > 0 && wv != null && wv >= config.week.target,
    },
    streak: computeStreak(config, records, today),
    nextMilestone: next,
    startDate: config.startDate,
    targetDate: config.targetDate,
    daysLeft: config.targetDate ? daysBetween(today, config.targetDate) : null,
    overdueDays: config.targetDate && !config.closed && config.targetDate < today ? daysBetween(config.targetDate, today) : 0,
    closed: config.closed,
    milestoneDone: (config.milestones || []).filter(m => m.done).length,
    milestoneTotal: (config.milestones || []).length,
  };
}

module.exports = {
  FIELD_TYPES,
  MAX_FIELDS,
  MAX_MILESTONES,
  TEMPLATES,
  normalizeFields,
  normalizeData,
  normalizeConfig,
  normalizeValue,
  missingRequired,
  recordDateOf,
  rowToRecord,
  normDate,
  normNumber,
  bjDateStr,
  bjToday,
  addDays,
  daysBetween,
  weekRange,
  monthRange,
  metricValue,
  metricLabel,
  goalProgress,
  milestonesDoneBetween,
  nextMilestone,
  computeStreak,
  statusDistribution,
  computeOverview,
  boardStats,
  fmtNum,
};
