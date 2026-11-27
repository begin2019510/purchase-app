'use strict';
// 支出审计快照：op_logs.detail 里只存可核对字段，图片只存引用/数量，绝不落 base64
const H = require('./helpers');

function parseImageRefs(v) {
  if (!v) return [];
  const s = String(v);
  if (s.startsWith('[')) {
    try {
      const a = JSON.parse(s);
      if (Array.isArray(a)) return a.filter(x => typeof x === 'string' && x);
    } catch (e) {}
  }
  return [s];
}

function imageSummary(v) {
  const refs = parseImageRefs(v);
  return {
    count: refs.length,
    refs: refs.map(r => /^data:image\//i.test(r) ? '[inline-image:' + r.length + 'chars]' : r),
  };
}

function bjIso() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '+08:00');
}

function snapshot(row) {
  return {
    id: 'rec_' + row.id,
    type: row.type || '支出',
    category: row.category || '其他',
    amount: Number(row.amount) || 0,
    date: H.tsToBjStr(row.date_ms),
    note: row.note || '',
    splitWeeks: Number(row.split_weeks) || 0,
    splitStartWeek: row.split_start_week || '',
    projectId: row.project_id ? 'rec_' + row.project_id : null,
    phaseIdx: row.phase_idx == null ? null : Number(row.phase_idx),
    images: imageSummary(row.image_ref),
  };
}

const FIELD_NAMES = {
  type: 'type',
  category: 'category',
  amount: 'amount',
  note: 'note',
  split_weeks: 'splitWeeks',
  split_start_week: 'splitStartWeek',
  date_ms: 'date',
  project_id: 'projectId',
  phase_idx: 'phaseIdx',
  image_ref: 'images',
};

function sameValue(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

// 只返回实际发生变化的列，避免把“原值提交”记成一次修改
function changedColumns(before, cols) {
  return Object.keys(cols).filter(k => !sameValue(before[k], cols[k]));
}

function updateDetail(source, before, after, columns) {
  return JSON.stringify({
    at: bjIso(),
    source: source,
    id: 'rec_' + before.id,
    changed: columns.map(k => FIELD_NAMES[k] || k),
    before: snapshot(before),
    after: snapshot(after),
  });
}

function createDetail(source, row) {
  return JSON.stringify({
    at: bjIso(),
    source: source,
    id: 'rec_' + row.id,
    after: snapshot(row),
  });
}

function deleteDetail(source, row) {
  return JSON.stringify({
    at: bjIso(),
    source: source,
    id: 'rec_' + row.id,
    deleted: true,
    before: snapshot(row),
  });
}

module.exports = { parseImageRefs, imageSummary, snapshot, changedColumns, updateDetail, createDetail, deleteDetail };
