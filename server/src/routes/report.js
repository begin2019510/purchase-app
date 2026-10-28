'use strict';
// /api/push/report —— 周报/月报，直接从 MySQL 计算（不再经过飞书）
// GET ?mine=1 (登录用户)          → 我的最新报告
// GET ?period=weekly|monthly     → 生成全部用户报告并返回（CF 定时来源，内网令牌闸之后）
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const { requireAuth } = require('../middleware');

const router = express.Router();
const MS = 86400000, TZ = 8 * 3600000;
const ACTIVE_BUY = ['已下单', '已到', '已归档'];

// 分期采购的每月付款日：取购买日的「日」，超出当月天数则取月末；
// 起始月优先用 installment_start，缺失时退回购买月。
function installmentEvents(pRecs) {
  const out = [];
  for (const r of pRecs) {
    const tp = Number(r.installments) || 0;
    if (tp <= 1 || !ACTIVE_BUY.includes(r.status)) continue;
    const paid = Number(r.installment_paid) || 0;
    if (paid >= tp) continue;
    const dateMs = Number(r.date_ms) || 0;
    if (!dateMs) continue;
    const pd = new Date(dateMs + TZ);
    let start = String(r.installment_start || '');
    if (!/^\d{4}-\d{2}$/.test(start)) start = pd.getUTCFullYear() + '-' + String(pd.getUTCMonth() + 1).padStart(2, '0');
    const [sy, sm] = start.split('-').map(Number);
    if (!sy || !sm || sm < 1 || sm > 12) continue;
    const amount = Number(r.installment_amount) || Math.round(((Number(r.price) || 0) * (Number(r.qty) || 1)) / tp);
    if (amount <= 0) continue;
    const payDay = pd.getUTCDate() || 1;
    const cat = r.category || '其他';
    for (let k = 0; k < tp; k++) {
      const y = sy + Math.floor((sm - 1 + k) / 12);
      const m0 = (sm - 1 + k) % 12;
      const dim = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
      out.push({ ts: Date.UTC(y, m0, Math.min(payDay, dim)) - TZ, amount, cat });
    }
  }
  return out;
}

// 与前端 getMonthWeeks / CF 同口径：整月切 4 段
function monthBlocks(y, m0) {
  const ld = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const base = Math.floor(ld / 4), rem = ld % 4;
  const arr = []; let s = 1;
  for (let i = 0; i < 4; i++) { const days = base + (i < rem ? 1 : 0); arr.push({ num: i + 1, start: s, end: s + days - 1 }); s += days; }
  return arr;
}

function range(period, now) {
  if (period === 'weekly') {
    const bj = new Date(now + TZ);
    const y = bj.getUTCFullYear(), m = bj.getUTCMonth(), d = bj.getUTCDate();
    const endedList = [];
    monthBlocks(y, m).forEach(b => { if (b.end < d) endedList.push({ ...b, y, m }); });
    if (!endedList.length) {
      const pm = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
      monthBlocks(pm.y, pm.m).forEach(b => endedList.push({ ...b, y: pm.y, m: pm.m }));
    }
    const ended = endedList[endedList.length - 1];
    let prevB = null;
    if (endedList.length >= 2) prevB = endedList[endedList.length - 2];
    else {
      const pm = ended.m === 0 ? { y: ended.y - 1, m: 11 } : { y: ended.y, m: ended.m - 1 };
      const pb = monthBlocks(pm.y, pm.m);
      prevB = { ...pb[2], y: pm.y, m: pm.m };
    }
    const start = Date.UTC(ended.y, ended.m, ended.start) - TZ;
    const end = Date.UTC(ended.y, ended.m, ended.end + 1) - TZ;
    const rangeText = (ended.m + 1) + '月' + ended.start + '日 - ' + (ended.m + 1) + '月' + ended.end + '日';
    const prevStart = prevB ? Date.UTC(prevB.y, prevB.m, prevB.start) - TZ : start - 7 * MS;
    const prevEnd = prevB ? Date.UTC(prevB.y, prevB.m, prevB.end + 1) - TZ : start;
    return { start, end, prevStart, prevEnd, label: '第' + ended.num + '周', prevLabel: '第' + prevB.num + '周', rangeText };
  }
  const bj = new Date(now + TZ);
  const y = bj.getUTCFullYear(), m = bj.getUTCMonth();
  const start = Date.UTC(y, m, 1) - TZ;
  const ps = Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1) - TZ;
  const daysInPrev = Math.round((start - ps) / MS);
  const prevM = new Date(ps + TZ);
  const rangeText = (prevM.getUTCMonth() + 1) + '月1日 - ' + (prevM.getUTCMonth() + 1) + '月' + daysInPrev + '日';
  return { start: ps, end: start, prevStart: ps - (start - ps), prevEnd: ps,
    label: (prevM.getUTCMonth() + 1) + '月', prevLabel: ((prevM.getUTCMonth() === 0 ? 12 : prevM.getUTCMonth())) + '月', rangeText };
}

async function computeForUser(u, period) {
  const [pRecs, eRecs] = await Promise.all([
    db.query('SELECT * FROM purchases WHERE user_id = ?', [u.id]),
    db.query('SELECT * FROM expenses WHERE user_id = ?', [u.id]),
  ]);
  const instEvents = installmentEvents(pRecs);
  function aggregate(start, end) {
    let buy = 0, exp = 0, count = 0;
    const byCat = {}, days = {};
    for (const r of pRecs) {
      if (!ACTIVE_BUY.includes(r.status)) continue;
      if ((Number(r.installments) || 0) > 1) continue; // 分期采购按每月付款日单独计入
      const ts = Number(r.date_ms) || 0;
      if (ts < start || ts >= end) continue;
      const amt = (Number(r.price) || 0) * (Number(r.qty) || 1);
      if (amt <= 0) continue;
      buy += amt; count++;
      const cat = r.category || '其他';
      byCat[cat] = (byCat[cat] || 0) + amt;
    }
    for (const ev of instEvents) {
      if (ev.ts < start || ev.ts >= end) continue;
      buy += ev.amount; count++;
      byCat[ev.cat] = (byCat[ev.cat] || 0) + ev.amount;
    }
    for (const e of eRecs) {
      if ((e.type || '支出') !== '支出') continue;
      const note = String(e.note || '');
      if (note.includes('[固定]') || note.includes('[采购]') || note.includes('[采购分期]')) continue;
      const ts = Number(e.date_ms) || 0;
      if (ts < start || ts >= end) continue;
      const amt = Number(e.amount) || 0;
      if (amt <= 0) continue;
      exp += amt; count++;
      const cat = e.category || '其他';
      byCat[cat] = (byCat[cat] || 0) + amt;
      const dk = new Date(ts + TZ).toISOString().slice(5, 10);
      days[dk] = (days[dk] || 0) + amt;
    }
    let topDay = null;
    for (const kv of Object.entries(days)) if (!topDay || kv[1] > topDay[1]) topDay = kv;
    return { buy, exp, total: buy + exp, count, topCats: Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3), topDay };
  }

  const R = range(period, Date.now());
  const cur = aggregate(R.start, R.end);
  const prev = aggregate(R.prevStart, R.prevEnd);

  let deltaText = '持平', deltaGood = null;
  if (prev.total > 0) {
    const d = Math.round((cur.total - prev.total) / prev.total * 100);
    deltaText = d > 0 ? '↑' + d + '%' : d < 0 ? '↓' + Math.abs(d) + '%' : '持平';
    deltaGood = d < 0 ? true : d > 0 ? false : null;
  } else if (cur.total > 0) { deltaText = '新增'; deltaGood = null; }

  const yuan = n => '¥' + Math.round(n).toLocaleString('zh-CN');
  let topDayText = null;
  if (cur.topDay) {
    const year = new Date(R.start + TZ).getUTCFullYear();
    const dt = new Date(Date.parse(year + '-' + cur.topDay[0] + 'T00:00:00+08:00') || 0);
    const w = ['日', '一', '二', '三', '四', '五', '六'][dt.getUTCDay()];
    topDayText = (dt.getUTCMonth() + 1) + '月' + dt.getUTCDate() + '日 周' + w;
  }

  let budgetInfo = null;
  if (period === 'monthly') {
    const brow = await db.one('SELECT data FROM budgets WHERE user_id = ?', [u.id]);
    const bRaw = brow ? (typeof brow.data === 'string' ? JSON.parse(brow.data) : brow.data) : null;
    const bjS = new Date(R.start + TZ);
    const bkey = bjS.getUTCFullYear() + '-' + String(bjS.getUTCMonth() + 1).padStart(2, '0');
    const mb = bRaw && bRaw[bkey];
    const budget = typeof mb === 'number' ? mb : (mb && mb.total) || 0;
    if (budget > 0) budgetInfo = { total: budget, pct: Math.min(Math.round(cur.total / budget * 100), 999) };
  }

  const lines = [];
  lines.push(`${R.label}支出 ${yuan(cur.total)}（较${R.prevLabel}${deltaText}）· 采${yuan(cur.buy)} 记${yuan(cur.exp)} · ${cur.count}笔`);
  if (cur.topCats.length) lines.push('Top: ' + cur.topCats.map(c => c[0] + ' ' + yuan(c[1])).join(' · '));
  if (topDayText) lines.push('最高一天：' + topDayText + ' ' + yuan(cur.topDay[1]));
  if (budgetInfo) lines.push(`预算 ¥${budgetInfo.total} · 已用 ${budgetInfo.pct}%`);

  const data = {
    period,
    rangeText: R.rangeText,
    generatedAt: Date.now(),
    label: R.label, prevLabel: R.prevLabel,
    total: Math.round(cur.total), buy: Math.round(cur.buy), exp: Math.round(cur.exp),
    count: cur.count, deltaText, deltaGood,
    topCats: cur.topCats.map(c => [c[0], Math.round(c[1])]),
    topDay: cur.topDay ? { text: topDayText, val: Math.round(cur.topDay[1]) } : null,
    budget: budgetInfo,
  };
  const title = '📊 ' + R.label + '账单';
  const report = { period, generatedAt: Date.now(), title, body: lines.join('\n'), url: '/', data };

  try {
    await db.exec(
      'INSERT INTO reports (user_id, period, rtype, data, generated_at) VALUES (?,?,?,?, NOW())',
      [u.id, period, period === 'monthly' ? 'month' : 'week', JSON.stringify(report)]);
  } catch (e) { console.error('report store:', e.message); }
  return report;
}

// 我的最新报告
router.get('/push/report', async (req, res, next) => {
  try {
    if (req.query.mine === '1') {
      if (!req.user || !req.user.username) return res.status(401).json({ error: 'Unauthorized' });
      const u = await db.one('SELECT id FROM users WHERE username = ?', [req.user.username]);
      if (!u) return res.json({ ok: true, report: null });
      const row = await db.one('SELECT data FROM reports WHERE user_id = ? ORDER BY generated_at DESC, id DESC LIMIT 1', [u.id]);
      const rep = row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : null;
      return res.json({ ok: true, report: rep });
    }
    // 定时生成（已过 X-Service-Token 闸）
    const period = req.query.period === 'monthly' ? 'monthly' : 'weekly';
    const users = await db.query('SELECT id, username FROM users');
    const reports = [];
    for (const u of users) {
      try {
        const rep = await computeForUser(u, period);
        reports.push({ username: u.username, title: rep.title, body: rep.body, url: rep.url, data: rep.data });
      } catch (e) { console.error('report user ' + u.username + ':', e.message); }
    }
    res.json({ ok: true, period, reports });
  } catch (e) { next(e); }
});

module.exports = router;
