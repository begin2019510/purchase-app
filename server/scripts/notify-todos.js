'use strict';
// 待办提醒调度：早间摘要 + 到期前提醒（Web Push / APNs）
// 建议每 5 分钟跑一次（systemd timer）；幂等：DB 记录已发送状态
// 用法: sudo node server/scripts/notify-todos.js [--dry]
const fs = require('fs');
const cfg = require('../src/config');
const db = require('../src/db');
const webpush = require('/opt/push-sender/node_modules/web-push');

const CF = process.env.CF_BASE || 'https://121212121.top';
const DRY = process.argv.includes('--dry');
const TZ = 8 * 3600000;
const log = (...a) => console.log(new Date(Date.now() + TZ).toISOString().slice(11, 19), ...a);

// VAPID（与 CF 端 WEBPUSH_VAPID_PUBLIC 对应）
const KEYS = JSON.parse(fs.readFileSync('/opt/push-sender/vapid-keys.json', 'utf8'));
webpush.setVapidDetails('mailto:admin@121212121.top', KEYS.publicKey, KEYS.privateKey);

function bjParts(ts) {
  const d = new Date(ts + TZ);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
const pad = n => String(n).padStart(2, '0');

async function getSubs() {
  const r = await fetch(`${CF}/api/push/subscribe?export=1&token=${encodeURIComponent(cfg.SERVICE_TOKEN)}`);
  if (!r.ok) throw new Error('subs HTTP ' + r.status);
  const d = await r.json();
  const map = {};
  for (const s of (d.subs || [])) map[s.username] = s.subscription;
  return map;
}

async function send(sub, payload) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600, urgency: 'high' });
    return true;
  } catch (e) {
    log('send failed', e.statusCode || e.message);
    return false;
  }
}

async function markMorning(todoIds, dateStr) {
  if (DRY || !todoIds.length) return;
  const ph = todoIds.map(() => '?').join(',');
  await db.pool.query(`UPDATE todos SET notify_morning_date = ? WHERE id IN (${ph})`, [dateStr, ...todoIds]);
}
async function markDue(id, dueMs) {
  if (DRY) return;
  await db.exec('UPDATE todos SET notified_due_ms = ? WHERE id = ?', [dueMs, id]);
}

(async () => {
  const now = Date.now();
  const bj = bjParts(now);
  const todayStr = `${bj.y}-${pad(bj.m)}-${pad(bj.d)}`;
  const subs = await getSubs();
  const subNames = Object.keys(subs);
  if (!subNames.length) { log('无推送订阅'); process.exit(0); }

  const users = await db.query('SELECT id, username FROM users WHERE username IN (' + subNames.map(() => '?').join(',') + ')', subNames);
  let sentCount = 0, usersMorning = 0, usersDue = 0;

  for (const u of users) {
    const sub = subs[u.username];
    if (!sub) continue;
    const todos = await db.query(
      "SELECT id, title, due_ms, priority, notified_due_ms, notify_morning_date FROM todos WHERE user_id = ? AND status IN ('待办','进行中') AND due_ms IS NOT NULL AND due_ms > 0 ORDER BY due_ms",
      [u.id]);

    // ---- A. 早间摘要（08:25-08:40，每天一次；只提醒当天到期的）----
    const inMorning = bj.hh === 8 && bj.mm >= 25 && bj.mm <= 40;
    if (inMorning) {
      // 当天 00:00 ~ 23:59 边界（北京时间）
      const dayStart = Date.UTC(bj.y, bj.m - 1, bj.d) - TZ;
      const dayEnd = dayStart + 86400000;
      const dueToday = todos.filter(t => t.due_ms >= dayStart && t.due_ms < dayEnd && t.notify_morning_date !== todayStr);
      if (dueToday.length) {
        const names = dueToday.slice(0, 3).map(t => t.title).join('、') + (dueToday.length > 3 ? ` 等 ${dueToday.length} 项` : '');
        const ok = await send(sub, { title: '📋 今日待办 ' + dueToday.length + ' 项', body: names, url: '/', tag: 'todo-morning-' + todayStr });
        if (ok) { sentCount++; usersMorning++; await markMorning(dueToday.map(t => t.id), todayStr); }
      }
    }

    // ---- B. 到期前提醒（10-20 分钟内到期，且设了具体时间）----
    const soon = todos.filter(t => {
      const p = bjParts(t.due_ms);
      if (p.hh === 0 && p.mm === 0) return false;              // 只设了日期 → 靠早间摘要
      if (t.notified_due_ms === t.due_ms) return false;        // 已提醒过
      const diff = t.due_ms - now;
      return diff > 10 * 60000 && diff <= 20 * 60000;
    });
    for (const t of soon) {
      const p = bjParts(t.due_ms);
      const timeStr = pad(p.hh) + ':' + pad(p.mm);
      const ok = await send(sub, { title: '⏰ ' + timeStr + ' 到期', body: t.title, url: '/', tag: 'todo-due-' + t.id });
      if (ok) { sentCount++; usersDue++; await markDue(t.id, t.due_ms); }
    }
  }

  log(`done: sent=${sentCount} morning_users=${usersMorning} due_users=${usersDue}${DRY ? ' (dry)' : ''}`);
  process.exit(0);
})().catch(e => { console.error('NOTIFY CRASH:', e.message); process.exit(1); });
