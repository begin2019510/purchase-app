'use strict';
const db = require('../db');

// Bitable 风格记录 id：rec_<自增号>，跨表引用与回滚窗口内不冲突
async function nextId(table, userId) {
  const [r] = await db.pool.query(`INSERT INTO ${table} (user_id) VALUES (?)`, [userId]);
  return { id: 'rec_' + r.insertId, numId: r.insertId };
}
function numFromId(id) {
  const m = /^rec_(\d+)$/.exec(String(id || ''));
  return m ? Number(m[1]) : null;
}

function bjNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}
// 毫秒时间戳 → 'YYYY-MM-DDTHH:mm'（东八区），与 CF expenses GET 输出一致
function tsToBjStr(ts) {
  if (ts == null) return null;
  const d = new Date(Number(ts) + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}
// 'YYYY-MM-DDTHH:mm:ss'(本地语义) → 毫秒；CF dateToTs：带 T 补 +08:00，纯日期补 00:00:00+08
function dateStrToTs(s) {
  if (!s) return Date.now();
  const str = String(s);
  if (str.includes('T')) {
    if (/[zZ]|[+-]\d\d:?\d\d$/.test(str)) return new Date(str).getTime();
    return new Date(str + '+08:00').getTime();
  }
  return new Date(str + 'T00:00:00+08:00').getTime();
}

async function resolveUserId(username) {
  const row = await db.one('SELECT id FROM users WHERE username = ?', [username]);
  return row ? row.id : null;
}
async function logOp(username, action, detail, ip) {
  try {
    const now = new Date(Date.now() + 8 * 3600 * 1000);
    await db.exec('INSERT INTO op_logs (log_date, username, action, detail, ip) VALUES (?,?,?,?,?)',
      [now.toISOString().slice(0, 10), username, action, detail || '', ip || 'unknown']);
  } catch (e) { console.error('logOp:', e.message); }
}

module.exports = { nextId, numFromId, bjNow, tsToBjStr, dateStrToTs, resolveUserId, logOp };
