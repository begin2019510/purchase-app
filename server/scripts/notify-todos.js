'use strict';
// 待办提醒调度：早间摘要 + 多档提前提醒（Web Push）
// 按 reminders（分钟数组）逐档各发一次：如 3 点到期 + [10,20] → 14:50、14:40 各一条
// 空 reminders 且设了具体时间 → 默认 [10,20]
// 项目/普通待办文案区分（📁 vs ⏰/📋）
// 建议每 5 分钟跑一次（systemd timer）；幂等：notified_rems 记录已发档位
// 用法: sudo node server/scripts/notify-todos.js [--dry]
const fs = require('fs');
const cfg = require('../src/config');
const db = require('../src/db');
const webpush = require('/opt/push-sender/node_modules/web-push');

const CF = process.env.CF_BASE || 'https://121212121.top';
const DRY = process.argv.includes('--dry');
const TZ = 8 * 3600000;
const log = (...a) => console.log(new Date(Date.now() + TZ).toISOString().slice(11, 19), ...a);

// 与前端 saveTodo 默认一致
const DEFAULT_REMINDERS = [10, 20];

const KEYS = JSON.parse(fs.readFileSync('/opt/push-sender/vapid-keys.json', 'utf8'));
webpush.setVapidDetails('mailto:admin@121212121.top', KEYS.publicKey, KEYS.privateKey);

function bjParts(ts) {
  const d = new Date(ts + TZ);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
const pad = n => String(n).padStart(2, '0');

function parseRems(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    if (!Array.isArray(a)) return [];
    return a.map(Number).filter(n => Number.isFinite(n) && n > 0);
  } catch (e) { return []; }
}

function parseSent(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : [];
  } catch (e) { return []; }
}

function todoLabel(t) {
  if (!t.project_id) return { kind: 'todo', body: t.title, tagPrefix: 'todo' };
  const phase = t.phase_name ? ` · ${t.phase_name}` : '';
  const proj = t.project_name || '项目';
  return {
    kind: 'project-todo',
    body: `${proj}${phase} · ${t.title}`,
    tagPrefix: 'pj-todo',
  };
}

function dueTitle(t, timeStr) {
  if (t.project_id) return `📁 项目 · ${timeStr} 到期`;
  return `⏰ ${timeStr} 到期`;
}

function dueBody(t) {
  return todoLabel(t).body;
}

function morningLine(t) {
  if (t.project_id) {
    const phase = t.phase_name ? `·${t.phase_name}` : '';
    const proj = t.project_name || '项目';
    return `📁${proj}${phase} ${t.title}`;
  }
  return `⏰ ${t.title}`;
}

function whenStr(min) {
  return min >= 60 ? `${Math.round(min / 60)} 小时` : `${min} 分钟`;
}

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

async function markRem(id, mins) {
  if (DRY || !mins.length) return;
  await db.exec('UPDATE todos SET notified_rems = ? WHERE id = ?', [JSON.stringify(mins), id]);
}

(async () => {
  const now = Date.now();
  const bj = bjParts(now);
  const todayStr = `${bj.y}-${pad(bj.m)}-${pad(bj.d)}`;
  const subs = await getSubs();
  const subNames = Object.keys(subs);
  if (!subNames.length) { log('无推送订阅'); process.exit(0); }

  const allUsers = await db.query('SELECT id, username FROM users');
  const users = [];
  for (const uname of subNames) {
    const exact = allUsers.find(x => x.username === uname);
    const fuzzy = exact || allUsers.find(x => x.username.length > uname.length && x.username.endsWith(uname));
    if (fuzzy) users.push({ id: fuzzy.id, username: fuzzy.username, subKey: uname });
  }
  let sentCount = 0, usersMorning = 0, usersDue = 0;

  for (const u of users) {
    const sub = subs[u.subKey];
    if (!sub) continue;
    const todos = await db.query(
      `SELECT t.id, t.title, t.due_ms, t.priority, t.notified_due_ms, t.notify_morning_date,
              t.project_id, t.phase_idx, t.reminders, t.notified_rems,
              p.name AS project_name, ph.display_name AS phase_name
       FROM todos t
       LEFT JOIN projects p ON p.id = CAST(REPLACE(COALESCE(t.project_id, ''), 'rec_', '') AS UNSIGNED)
       LEFT JOIN project_phases ph ON ph.project_id = p.id AND ph.phase_idx = t.phase_idx
       WHERE t.user_id = ? AND t.status IN ('待办','进行中') AND t.due_ms IS NOT NULL AND t.due_ms > 0
       ORDER BY t.due_ms`,
      [u.id]);

    // ---- A. 早间摘要（08:25-08:40，每天一次；只提醒当天到期的）----
    const inMorning = bj.hh === 8 && bj.mm >= 25 && bj.mm <= 40;
    if (inMorning) {
      const dayStart = Date.UTC(bj.y, bj.m - 1, bj.d) - TZ;
      const dayEnd = dayStart + 86400000;
      const dueToday = todos.filter(t => t.due_ms >= dayStart && t.due_ms < dayEnd && t.notify_morning_date !== todayStr);
      if (dueToday.length) {
        const lines = dueToday.slice(0, 3).map(morningLine);
        const names = lines.join('、') + (dueToday.length > 3 ? ` 等 ${dueToday.length} 项` : '');
        const pjN = dueToday.filter(t => t.project_id).length;
        const ok = await send(sub, {
          title: `📋 今日待办 ${dueToday.length} 项`,
          body: names,
          url: '/',
          tag: 'todo-morning-' + todayStr,
          kind: 'todo',
          hasProject: pjN > 0,
          actions: [{ action: 'open', title: '去查看' }, { action: 'dismiss', title: '知道了' }],
        });
        if (ok) { sentCount++; usersMorning++; await markMorning(dueToday.map(t => t.id), todayStr); }
      }
    }

    // ---- B. 多档提前提醒：对每个未发档位，在 fireAt ~ due 之间各发一次 ----
    for (const t of todos) {
      const p = bjParts(t.due_ms);
      if (p.hh === 0 && p.mm === 0) continue; // 只设了日期 → 靠早间摘要

      let rems = parseRems(t.reminders);
      if (!rems.length) rems = DEFAULT_REMINDERS.slice();
      rems = [...new Set(rems)].sort((a, b) => b - a); // 大档先（20 再 10）

      const sent = parseSent(t.notified_rems);
      // 旧逻辑：notified_due_ms === due_ms 表示整条已提醒；迁移为已发默认两档
      const legacy = t.notified_due_ms === t.due_ms;

      const dueP = bjParts(t.due_ms);
      const timeStr = pad(dueP.hh) + ':' + pad(dueP.mm);
      const justSent = [];

      for (const min of rems) {
        if (sent.includes(min)) continue;
        if (legacy) { sent.push(min); justSent.push(min); continue; } // 兼容：不再重复整条
        const fireAt = t.due_ms - min * 60000;
        // 窗口：到点后可补发，但最多晚 25 分钟（覆盖 5 分钟 timer 误差 + 略等）
        if (now < fireAt) continue;
        if (now > t.due_ms + 25 * 60000) continue;

        const ok = await send(sub, {
          title: dueTitle(t, timeStr),
          body: `还有${whenStr(min)} · ${dueBody(t)}`,
          url: '/',
          tag: `${todoLabel(t).tagPrefix}-due-${t.id}-m${min}`,
          kind: todoLabel(t).kind,
          projectId: t.project_id || null,
          remindMin: min,
          actions: [{ action: 'open', title: '去查看' }, { action: 'dismiss', title: '知道了' }],
        });
        if (ok) {
          sentCount++; usersDue++;
          sent.push(min);
          justSent.push(min);
        }
      }

      if (justSent.length) await markRem(t.id, [...new Set(sent)]);
      // 旧标记清掉（多档后由 notified_rems 接管）
      if (legacy && !DRY) {
        await db.exec('UPDATE todos SET notified_due_ms = NULL WHERE id = ? AND notified_due_ms = ?', [t.id, t.due_ms]);
      }
    }
  }

  log(`done: sent=${sentCount} morning_users=${usersMorning} due_users=${usersDue}${DRY ? ' (dry)' : ''}`);
  process.exit(0);
})().catch(e => { console.error('NOTIFY CRASH:', e.message); process.exit(1); });
