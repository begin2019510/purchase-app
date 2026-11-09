'use strict';
// 待办提醒调度：晚间小结（21:00-21:15）+ 多档提前提醒（Web Push）+ 每日固定时刻（daily_times）
// 按 reminders（分钟数组）逐档各发一次：如 3 点到期 + [10,20] → 14:50、14:40 各一条
// 空 reminders 且设了具体时间 → 默认 [10,20]
// daily_times = ["09:00","18:00"]：每天到点各推一次（与 due 无关）；幂等 notified_daily = YYYY-MM-DD|HH:MM,HH:MM
// 项目/普通待办文案区分（📁 vs ⏰）
// 建议每 5 分钟跑一次（systemd timer）；幂等：notified_rems 记录已发档位
// 晚间：users.notify_evening_date（DATE 列，必须 DATE_FORMAT 比对，勿用 Date 对象 !== 字符串）
// 用法: sudo node server/scripts/notify-todos.js [--dry]
const fs = require('fs');
const cfg = require('../src/config');
const db = require('../src/db');
const webpush = require('/opt/push-sender/node_modules/web-push');

const CF = process.env.CF_BASE || 'https://121212121.top';
const DRY = process.argv.includes('--dry');
const TZ = 8 * 3600000;
const MS = 86400000;
const log = (...a) => console.log(new Date(Date.now() + TZ).toISOString().slice(11, 19), ...a);

// 与前端 saveTodo 默认一致
const DEFAULT_REMINDERS = [10, 20];
const ACTIVE_BUY = ['已下单', '已到', '已归档'];

const KEYS = JSON.parse(fs.readFileSync('/opt/push-sender/vapid-keys.json', 'utf8'));
webpush.setVapidDetails('mailto:admin@121212121.top', KEYS.publicKey, KEYS.privateKey);

function bjParts(ts) {
  const d = new Date(ts + TZ);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}
const pad = n => String(n).padStart(2, '0');
const yuan = n => '¥' + Math.round(n).toLocaleString('zh-CN');

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

// daily_times 列：["09:00",...]
function parseDailyTimes(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    if (!Array.isArray(a)) return [];
    return a.map(t => String(t == null ? '' : t).trim())
      .filter(s => /^([01]?\d|2[0-3]):[0-5]\d$/.test(s))
      .map(s => { const [h, m] = s.split(':'); return String(Number(h)).padStart(2, '0') + ':' + m; });
  } catch (e) { return []; }
}

// notified_daily = "2026-11-09|09:00,18:00"；跨日自动作废
function parseNotifiedDaily(raw, todayStr) {
  const s = String(raw || '');
  if (!s) return { date: '', times: [] };
  const i = s.indexOf('|');
  if (i < 0) return { date: '', times: [] };
  const date = s.slice(0, i);
  if (date !== todayStr) return { date: todayStr, times: [] };
  return { date, times: s.slice(i + 1).split(',').filter(Boolean) };
}

function markNotifiedDaily(id, dateStr, times) {
  if (DRY || !times.length) return;
  const val = dateStr + '|' + [...new Set(times)].sort().join(',');
  return db.exec('UPDATE todos SET notified_daily = ? WHERE id = ?', [val, id]);
}

// 北京时区某天 HH:MM 的毫秒时间戳
function dailyFireMs(y, m, d, hhmm) {
  const [h, mi] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi, 0, 0) - TZ;
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

async function markEvening(userId, dateStr) {
  if (DRY) return;
  await db.exec('UPDATE users SET notify_evening_date = ? WHERE id = ?', [dateStr, userId]);
}

async function markRem(id, mins) {
  if (DRY || !mins.length) return;
  await db.exec('UPDATE todos SET notified_rems = ? WHERE id = ?', [JSON.stringify(mins), id]);
}

// 分期采购的每月付款日：取购买日的「日」，超出当月天数则取月末；
// 起始月优先用 installment_start，缺失时退回购买月。只列 dayStart 那一天应还。
function installmentsForDay(pRecs, dayStart) {
  const dayEnd = dayStart + MS;
  const nowBj = new Date(Date.now() + TZ);
  const nowIdx = nowBj.getUTCFullYear() * 12 + nowBj.getUTCMonth();
  const tBj = new Date(dayStart + TZ);
  const tY = tBj.getUTCFullYear(), tM = tBj.getUTCMonth();
  const tIdx = tY * 12 + tM;
  const out = [];
  for (const r of pRecs) {
    const tp = Number(r.installments) || 0;
    if (tp <= 1 || !ACTIVE_BUY.includes(r.status)) continue;
    const dateMs = Number(r.date_ms) || 0;
    if (!dateMs) continue;
    const pd = new Date(dateMs + TZ);
    let start = String(r.installment_start || '');
    if (!/^\d{4}-\d{2}$/.test(start)) start = pd.getUTCFullYear() + '-' + String(pd.getUTCMonth() + 1).padStart(2, '0');
    const [sy, sm] = start.split('-').map(Number);
    if (!sy || !sm || sm < 1 || sm > 12) continue;
    const amount = Number(r.installment_amount) || Math.round(((Number(r.price) || 0) * (Number(r.qty) || 1)) / tp);
    if (amount <= 0) continue;
    // dayStart 可能是明天（跨月也要算），上界放到 nowIdx+1
    if (tIdx < sy * 12 + (sm - 1) || tIdx > nowIdx + 1) continue;
    const payDay = pd.getUTCDate() || 1;
    const dim = new Date(Date.UTC(tY, tM + 1, 0)).getUTCDate();
    const evTs = Date.UTC(tY, tM, Math.min(payDay, dim)) - TZ;
    if (evTs < dayStart || evTs >= dayEnd) continue;
    // 期数越界不计；已还清与否按日历应还展示（用户可能未点还款）
    const k = (tY - sy) * 12 + (tM - (sm - 1));
    if (k < 0 || k >= tp) continue;
    out.push({ name: r.name || '分期', amount });
  }
  return out;
}

function eveningBody(todayExp, todayPur, inst, tomTodos) {
  const lines = [];
  if (todayExp.amount > 0 || todayPur.amount > 0) {
    const parts = [];
    if (todayExp.amount > 0) parts.push(`记账 ${yuan(todayExp.amount)} · ${todayExp.count} 笔`);
    if (todayPur.amount > 0) parts.push(`采购 ${yuan(todayPur.amount)} · ${todayPur.count} 笔`);
    lines.push(parts.join('｜'));
    if (todayExp.topCats.length) {
      lines.push('分类 ' + todayExp.topCats.map(c => c[0] + ' ' + yuan(c[1])).join(' · '));
    }
  } else {
    lines.push('今天还没有记账');
  }
  if (inst.length) {
    const n = inst.slice(0, 2).map(x => `${x.name} ${yuan(x.amount)}`).join('、');
    lines.push(`明天分期应还 ${inst.length > 2 ? n + ' 等' : n}`);
  }
  if (tomTodos.length) {
    const names = tomTodos.slice(0, 3).map(t => todoLabel(t).body).join('、');
    const more = tomTodos.length > 3 ? ` 等 ${tomTodos.length} 项` : '';
    lines.push(`明天待办 ${tomTodos.length} 项：${names}${more}`);
  }
  if (!inst.length && !tomTodos.length && lines.length === 1 && lines[0] === '今天还没有记账') {
    lines.push('明天暂无分期/待办');
  }
  return lines.join('\n');
}

(async () => {
  // 3.0.42：补列（幂等，缺了才加）
  try {
    const [c1] = await db.pool.query("SHOW COLUMNS FROM todos LIKE 'daily_times'");
    if (!c1.length) await db.exec('ALTER TABLE todos ADD COLUMN daily_times VARCHAR(200) NULL AFTER reminders');
    const [c2] = await db.pool.query("SHOW COLUMNS FROM todos LIKE 'notified_daily'");
    if (!c2.length) await db.exec('ALTER TABLE todos ADD COLUMN notified_daily VARCHAR(200) NULL AFTER notified_rems');
  } catch (e) { log('daily 列检查:', e.message); }

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
  let sentCount = 0, usersEvening = 0, usersDue = 0, usersDaily = 0;

  // 晚间窗口与日期边界（BEIJING）
  const inEvening = bj.hh === 21 && bj.mm >= 0 && bj.mm <= 15;
  const dayStart = Date.UTC(bj.y, bj.m - 1, bj.d) - TZ;
  const tomStart = dayStart + MS;

  for (const u of users) {
    const sub = subs[u.subKey];
    if (!sub) continue;
    const todos = await db.query(
      `SELECT t.id, t.title, t.due_ms, t.priority, t.notified_due_ms,
              t.project_id, t.phase_idx, t.reminders, t.notified_rems,
              p.name AS project_name, ph.display_name AS phase_name
       FROM todos t
       LEFT JOIN projects p ON p.id = CAST(REPLACE(COALESCE(t.project_id, ''), 'rec_', '') AS UNSIGNED)
       LEFT JOIN project_phases ph ON ph.project_id = p.id AND ph.phase_idx = t.phase_idx
       WHERE t.user_id = ? AND t.status IN ('待办','进行中') AND t.due_ms IS NOT NULL AND t.due_ms > 0
       ORDER BY t.due_ms`,
      [u.id]);

    // ---- A. 晚间小结（21:00-21:15，每天一次；即使很空也发，便于确认通道）----
    if (inEvening) {
      // DATE_FORMAT 保证拿字符串，避免 mysql2 返回 Date 对象导致 !== 恒真
      const row = await db.one(
        `SELECT DATE_FORMAT(notify_evening_date, '%Y-%m-%d') AS d FROM users WHERE id = ?`,
        [u.id]);
      const marked = row && row.d === todayStr;
      if (!marked) {
        const [expRows, todayPurRows, allPurRows] = await Promise.all([
          db.query(
            `SELECT amount, category, note FROM expenses
             WHERE user_id = ? AND type = '支出' AND date_ms >= ? AND date_ms < ?`,
            [u.id, dayStart, dayStart + MS]),
          db.query(
            `SELECT n.name, o.price_paid AS price, o.qty, n.category, o.status, o.installments
             FROM purchase_orders o JOIN purchase_needs n ON n.id = o.need_id
             WHERE o.user_id = ? AND o.date_ms >= ? AND o.date_ms < ?`,
            [u.id, dayStart, dayStart + MS]),
          db.query(
            `SELECT n.name, o.price_paid AS price, o.qty, n.category, o.status, o.installments,
                    o.installment_amount, o.installment_start, o.installment_paid, o.date_ms
             FROM purchase_orders o JOIN purchase_needs n ON n.id = o.need_id
             WHERE o.user_id = ?`,
            [u.id]),
        ]);

        let expAmt = 0, expN = 0;
        const byCat = {};
        for (const e of expRows) {
          const note = String(e.note || '');
          if (note.includes('[固定]') || note.includes('[采购]') || note.includes('[采购分期]')) continue;
          const amt = Number(e.amount) || 0;
          if (amt <= 0) continue;
          expAmt += amt; expN++;
          const cat = e.category || '其他';
          byCat[cat] = (byCat[cat] || 0) + amt;
        }

        let purAmt = 0, purN = 0;
        for (const p of todayPurRows) {
          if (!ACTIVE_BUY.includes(p.status)) continue;
          if ((Number(p.installments) || 0) > 1) continue;
          const amt = (Number(p.price) || 0) * (Number(p.qty) || 1);
          if (amt <= 0) continue;
          purAmt += amt; purN++;
        }

        const inst = installmentsForDay(allPurRows, tomStart);

        const tomTodos = todos.filter(t => t.due_ms >= tomStart && t.due_ms < tomStart + MS);

        const body = eveningBody(
          { amount: expAmt, count: expN, topCats: Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3) },
          { amount: purAmt, count: purN },
          inst,
          tomTodos);

        const ok = await send(sub, {
          title: `🌙 今日小结 · ${bj.m}-${bj.d}`,
          body,
          url: '/',
          tag: 'evening-' + todayStr,
          kind: 'evening',
          actions: [{ action: 'open', title: '去查看' }, { action: 'dismiss', title: '知道了' }],
        });
        if (ok) { sentCount++; usersEvening++; await markEvening(u.id, todayStr); }
      }
    }

    // ---- B. 多档提前提醒：对每个未发档位，在 fireAt ~ due 之间各发一次 ----
    for (const t of todos) {
      const p = bjParts(t.due_ms);
      if (p.hh === 0 && p.mm === 0) continue; // 只设了日期 → 靠晚间小结里的「明天待办」

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

    // ---- C. 每日固定时刻（daily_times）：与 due 无关，未完成就每天到点各推一次 ----
    const dailyRows = await db.query(
      `SELECT t.id, t.title, t.daily_times, t.notified_daily,
              t.project_id, t.phase_idx,
              p.name AS project_name, ph.display_name AS phase_name
       FROM todos t
       LEFT JOIN projects p ON p.id = CAST(REPLACE(COALESCE(t.project_id, ''), 'rec_', '') AS UNSIGNED)
       LEFT JOIN project_phases ph ON ph.project_id = p.id AND ph.phase_idx = t.phase_idx
       WHERE t.user_id = ? AND t.status IN ('待办','进行中')
         AND t.daily_times IS NOT NULL AND t.daily_times <> '' AND t.daily_times <> '[]'`,
      [u.id]);
    for (const t of dailyRows) {
      const times = parseDailyTimes(t.daily_times);
      if (!times.length) continue;
      const nd = parseNotifiedDaily(t.notified_daily, todayStr);
      const sentToday = nd.times.slice();
      const justDaily = [];
      // 窗口：到点后 0~6 分钟内发（覆盖 5 分钟 timer + 随机延迟）；错过则等明天
      for (const hhmm of times) {
        if (sentToday.includes(hhmm)) continue;
        const fireAt = dailyFireMs(bj.y, bj.m, bj.d, hhmm);
        if (now < fireAt || now > fireAt + 6 * 60000) continue;
        const ok = await send(sub, {
          title: t.project_id ? '📁 项目 · 每日提醒' : '⏰ 每日提醒',
          body: todoLabel(t).body + ' · ' + hhmm,
          url: '/',
          tag: `daily-${t.id}-${hhmm.replace(':', '')}`,
          kind: t.project_id ? 'project-todo' : 'todo',
          projectId: t.project_id || null,
          dailyAt: hhmm,
          actions: [{ action: 'open', title: '去查看' }, { action: 'dismiss', title: '知道了' }],
        });
        if (ok) {
          sentCount++; usersDaily++;
          sentToday.push(hhmm);
          justDaily.push(hhmm);
        }
      }
      if (justDaily.length) await markNotifiedDaily(t.id, todayStr, sentToday);
    }
  }

  log(`done: sent=${sentCount} evening_users=${usersEvening} due_users=${usersDue} daily_users=${usersDaily}${DRY ? ' (dry)' : ''}`);
  process.exit(0);
})().catch(e => { console.error('NOTIFY CRASH:', e.message); process.exit(1); });
