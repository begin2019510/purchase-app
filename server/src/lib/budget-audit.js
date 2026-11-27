'use strict';
// 预算文档审计辅助：只记录发生变化的月份，避免整份 JSON 反复入日志。
// 预算按月存在同一个 JSON 文档里（{"2026-10": {...}}），没有 month 列，
// 因此 before/after 必须按 key 比对，才能回答“某个历史月为什么是这个数”。

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function parseDoc(v) {
  if (v == null) return {};
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (e) { return {}; }
  }
  return isPlainObject(v) ? v : {};
}

// 请求体 data 必须是对象；字符串 JSON 也接受（兼容旧客户端），其它类型拒绝。
function normalizePayload(v) {
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (e) { return null; }
  }
  return isPlainObject(v) ? v : null;
}

function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (isPlainObject(v)) {
    return '{' + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ':' + stable(v[k]);
    }).join(',') + '}';
  }
  return JSON.stringify(v);
}

function changedKeys(before, after) {
  var keys = Object.create(null);
  Object.keys(before || {}).forEach(function (k) { keys[k] = 1; });
  Object.keys(after || {}).forEach(function (k) { keys[k] = 1; });
  return Object.keys(keys).filter(function (k) {
    return stable((before || {})[k]) !== stable((after || {})[k]);
  }).sort();
}

function totalOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (isPlainObject(v)) {
    var n = Number(v.total);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function additionsOf(v) {
  return isPlainObject(v) && Array.isArray(v.additions) ? v.additions : [];
}

function sumAdditions(v) {
  return additionsOf(v).reduce(function (sum, a) {
    var n = Number(a && a.amt);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function additionKey(a) {
  return stable(a);
}

function diffAdditions(before, after) {
  var rest = additionsOf(before).slice();
  var added = [];
  additionsOf(after).forEach(function (a) {
    var k = additionKey(a);
    var idx = -1;
    for (var i = 0; i < rest.length; i++) {
      if (additionKey(rest[i]) === k) { idx = i; break; }
    }
    if (idx >= 0) rest.splice(idx, 1);
    else added.push(a);
  });
  return { added: added, removed: rest };
}

function trimText(v, max) {
  if (typeof v !== 'string') return v;
  return v.length > max ? v.slice(0, max) + '…' : v;
}

function slimAddition(a) {
  if (!isPlainObject(a)) return a;
  var out = {};
  ['id', 'amt', 'src', 'note', 'ts'].forEach(function (k) {
    if (a[k] !== undefined) out[k] = k === 'note' ? trimText(a[k], 300) : a[k];
  });
  return out;
}

function monthSummary(month, before, after) {
  var bExists = before !== undefined;
  var aExists = after !== undefined;
  var d = diffAdditions(before, after);
  return {
    month: month,
    existsBefore: bExists,
    existsAfter: aExists,
    totalBefore: totalOf(before),
    totalAfter: totalOf(after),
    baseBefore: round2(totalOf(before) - sumAdditions(before)),
    baseAfter: round2(totalOf(after) - sumAdditions(after)),
    additionsBefore: additionsOf(before).length,
    additionsAfter: additionsOf(after).length,
    additionsAdded: d.added.map(slimAddition),
    additionsRemoved: d.removed.map(slimAddition),
  };
}

// 北京时间 ISO（带 +08:00），与支出审计日志保持同一口径。
function bjIso() {
  return new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString().replace(/\.\d{3}Z$/, '+08:00');
}

function buildDetail(source, before, after, changed) {
  var beforePart = {};
  var afterPart = {};
  changed.forEach(function (m) {
    if (Object.prototype.hasOwnProperty.call(before, m)) beforePart[m] = before[m];
    if (Object.prototype.hasOwnProperty.call(after, m)) afterPart[m] = after[m];
  });
  var detail = {
    at: bjIso(),
    source: source || 'api',
    changedMonths: changed,
    summary: changed.map(function (m) {
      return monthSummary(m,
        Object.prototype.hasOwnProperty.call(before, m) ? before[m] : undefined,
        Object.prototype.hasOwnProperty.call(after, m) ? after[m] : undefined);
    }),
    before: beforePart,
    after: afterPart,
  };
  var text = JSON.stringify(detail);
  // op_logs.detail 是 TEXT（65535 字节）。文档异常大时保留摘要，丢掉全文，
  // 宁可少存 before/after，也不能让审计写入失败导致预算改动被回滚。
  if (Buffer.byteLength(text, 'utf8') > 60000) {
    detail.truncated = true;
    detail.before = null;
    detail.after = null;
    text = JSON.stringify(detail);
  }
  return text;
}

function actionFor(before, after) {
  var b = Object.keys(before || {}).length;
  var a = Object.keys(after || {}).length;
  if (!b && a) return 'budget_create';
  if (b && !a) return 'budget_delete';
  return 'budget_update';
}

module.exports = {
  parseDoc,
  normalizePayload,
  changedKeys,
  totalOf,
  additionsOf,
  sumAdditions,
  monthSummary,
  buildDetail,
  actionFor,
};
