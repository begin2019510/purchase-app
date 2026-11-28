'use strict';
// 时间格式化（北京时间）。数据库 DATETIME 存的是北京墙上时间字面量，
// mysql2 按进程时区（本机 Asia/Shanghai）读成 Date，因此输出时要 +8h 还原字面量。
function pad(n) { return String(n).padStart(2, '0'); }

function bjDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) return null;
    return new Date(v.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }
  const s = String(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : s;
}

function bjDateTime(v, withMs) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) return null;
    const iso = new Date(v.getTime() + 8 * 3600 * 1000).toISOString();
    return iso.slice(0, 19).replace('T', ' ') + (withMs ? '.' + iso.slice(20, 23) : '');
  }
  return String(v);
}

function lastDay(year, month) {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

// 'YYYY-MM-DD'（当月最后一天）
function monthEndDate(year, month) {
  return `${year}-${pad(month)}-${pad(lastDay(year, month))}`;
}

// 'YYYY-MM-DD 23:59:59'（申请/审批当月有效期末）
function monthEndDateTime(year, month) {
  return `${monthEndDate(year, month)} 23:59:59`;
}

function monthBounds(year, month) {
  const next = Number(month) === 12 ? { y: Number(year) + 1, m: 1 } : { y: Number(year), m: Number(month) + 1 };
  return {
    start: `${year}-${pad(month)}-01 00:00:00`,
    end: `${next.y}-${pad(next.m)}-01 00:00:00`,
  };
}

function nextDate(dateStr) {
  const d = new Date(String(dateStr) + 'T00:00:00+08:00');
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return bjDate(d);
}

module.exports = { pad, bjDate, bjDateTime, monthEndDate, monthEndDateTime, monthBounds, nextDate };
