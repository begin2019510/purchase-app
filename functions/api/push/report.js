import { corsHeaders, json } from './_common.js';
import { authenticate, getFeishuToken } from '../_auth.js';
import { mysqlMode, toServer, authUser } from '../_proxy.js';

// 周报/月报：生成 + 存档 + 推送数据源
// GET ?period=weekly|monthly&token=XX  -> 服务器拉取（SERVICE_TOKEN）
// GET ?mine=1  (JWT)                   -> 我的最新报告（统计页卡片）
const MS = 86400000, TZ = 8 * 3600000;
const ACTIVE_BUY = ['已下单', '已到', '已归档'];

function dayStartBJ(ts) { return Math.floor((ts + TZ) / MS) * MS - TZ; }
// 与前端 getMonthWeeks 一致：整月切4段（如31天→8/8/8/7）
function monthBlocks(y, m0) {
  const ld = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
  const base = Math.floor(ld / 4), rem = ld % 4;
  const arr = []; let s = 1;
  for (let i = 0; i < 4; i++) { const days = base + (i < rem ? 1 : 0); arr.push({ num: i + 1, start: s, end: s + days - 1 }); s += days; }
  return arr;
}
function parseWhen(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) { const t = Date.parse(s); return isNaN(t) ? 0 : t; }
  if (s.includes('T')) return Date.parse(s + '+08:00') || 0;
  return Date.parse(s + 'T00:00:00+08:00') || 0;
}
function num(v) { if (Array.isArray(v)) v = v[0]; const n = Number(v); return isNaN(n) ? 0 : n; }

async function kvList(KV, prefix) {
  const out = []; let cursor;
  do {
    const page = await KV.list({ prefix, cursor });
    out.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
async function feishuList(app, table, token) {
  const out = []; let pt = '';
  do {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${app}/tables/${table}/records?page_size=500${pt ? '&page_token=' + pt : ''}`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const d = await r.json();
    if (d.code !== 0) throw new Error('Feishu: ' + (d.msg || d.code));
    out.push(...(d.data?.items || []));
    pt = d.data?.page_token || '';
  } while (pt);
  return out;
}

function range(period, now) {
  if (period === 'weekly') {
    // 周 = 当月第N段（与周视图/动态周预算完全同口径：4段，每段7~8天）
    const bj = new Date(now + TZ);
    const y = bj.getUTCFullYear(), m = bj.getUTCMonth(), d = bj.getUTCDate();
    // 找「最近已结束」的段：end < 今天；若今天还在第1段内 → 取上月最后一段
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
      // endedList 为空时会补成上月 4 段，因此这里只可能是「今天在当月第 2 段」，
      // ended 为当月第 1 段，上一段就是上月最后一段 pb[3]。
      const pm = ended.m === 0 ? { y: ended.y - 1, m: 11 } : { y: ended.y, m: ended.m - 1 };
      const pb = monthBlocks(pm.y, pm.m);
      prevB = { ...pb[3], y: pm.y, m: pm.m };
    }
    const start = Date.UTC(ended.y, ended.m, ended.start) - TZ;
    const end = Date.UTC(ended.y, ended.m, ended.end + 1) - TZ;
    const rangeText = (ended.m + 1) + '月' + ended.start + '日 - ' + (ended.m + 1) + '月' + ended.end + '日';
    const prevStart = prevB ? Date.UTC(prevB.y, prevB.m, prevB.start) - TZ : start - 7 * MS;
    const prevEnd = prevB ? Date.UTC(prevB.y, prevB.m, prevB.end + 1) - TZ : start;
    const label = '第' + ended.num + '周';
    const prevLabel = prevB ? '第' + prevB.num + '周' : '上一段';
    return { start, end, prevStart, prevEnd, label, prevLabel, rangeText };
  }
  // 月报 = 上一个完整自然月（在 1 日生成时不会变成空报告）
  const bj = new Date(now + TZ);
  const y = bj.getUTCFullYear(), m = bj.getUTCMonth();
  const start = Date.UTC(y, m, 1) - TZ;                    // 本月 1 日 00:00 → 上月结束边界
  const ps = Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1) - TZ;
  const daysInPrev = Math.round((start - ps) / MS);
  const prevM = new Date(ps + TZ);
  const rangeText = (prevM.getUTCMonth() + 1) + '月1日 - ' + (prevM.getUTCMonth() + 1) + daysInPrev + '日';
  const ppm0 = prevM.getUTCMonth(), ppy = prevM.getUTCFullYear();
  const pps = Date.UTC(ppm0 === 0 ? ppy - 1 : ppy, ppm0 === 0 ? 11 : ppm0 - 1, 1) - TZ;
  return { start: ps, end: start, prevStart: pps, prevEnd: ps,
    label: (prevM.getUTCMonth() + 1) + '月', prevLabel: ((prevM.getUTCMonth() === 0 ? 12 : prevM.getUTCMonth()) ) + '月', rangeText };
}

async function computeForUser(env, username, r) {
  const KV = env.IMAGE_STORE;
  const userRaw = await KV.get('user:' + username, 'json');
  if (!userRaw || !userRaw.bitable) return null;
  const bt = userRaw.bitable;
  if (!bt.purchaseApp || !bt.expenseApp) return null;
  const token = await getFeishuToken(env);

  const [pRecs, eRecs] = await Promise.all([
    feishuList(bt.purchaseApp, bt.purchaseTable, token),
    feishuList(bt.expenseApp, bt.expenseTable, token),
  ]);

  function aggregate(start, end) {
    let buy = 0, exp = 0, byCat = {}, dayMax = { v: 0, key: '' }, count = 0;
    for (const rec of pRecs) {
      const f = rec.fields || {};
      const st = Array.isArray(f['状态']) ? f['状态'][0] : (f['状态'] || '');
      if (!ACTIVE_BUY.includes(st)) continue;
      const ts = num(f['日期']);
      if (ts < start || ts >= end) continue;
      const amt = num(f['单价']) * (num(f['数量']) || 1);
      if (amt <= 0) continue;
      buy += amt; count++;
      const cat = String(Array.isArray(f['分类']) ? f['分类'][0] : (f['分类'] || '其他'));
      byCat[cat] = (byCat[cat] || 0) + amt;
      const dkey = new Date(ts + TZ).toISOString().slice(5, 10);
      // 日聚合放费用侧统一做
    }
    for (const rec of eRecs) {
      const f = rec.fields || {};
      const type = Array.isArray(f['类型']) ? f['类型'][0] : (f['类型'] || '支出');
      if (type !== '支出') continue;
      const note = String(f['备注'] || '');
      if (note.includes('[固定]') || note.includes('[采购]') || note.includes('[采购分期]')) continue;
      const ts = parseWhen(f['日期']);
      if (ts < start || ts >= end) continue;
      const amt = num(f['金额']);
      if (amt <= 0) continue;
      exp += amt; count++;
      const cat = String(Array.isArray(f['分类']) ? f['分类'][0] : (f['分类'] || '其他'));
      byCat[cat] = (byCat[cat] || 0) + amt;
      const dkey = new Date(ts + TZ).toISOString().slice(5, 10);
      dayMax.map = dayMax.map || {};
      dayMax.map[dkey] = (dayMax.map[dkey] || 0) + amt;
    }
    let topDay = null;
    if (dayMax.map) for (const k of Object.entries(dayMax.map)) if (!topDay || k[1] > topDay[1]) topDay = k;
    const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return { buy, exp, total: buy + exp, count, topCats, topDay };
  }

  const R = range(r.period, Date.now());
  const cur = aggregate(R.start, R.end);
  const prev = aggregate(R.prevStart, R.prevEnd);

  let deltaText = '持平', deltaGood = null;
  if (prev.total > 0) {
    const d = Math.round((cur.total - prev.total) / prev.total * 100);
    deltaText = d > 0 ? '↑' + d + '%' : d < 0 ? '↓' + Math.abs(d) + '%' : '持平';
    deltaGood = d < 0 ? true : d > 0 ? false : null;
  } else if (cur.total > 0) { deltaText = '新增'; deltaGood = null; }

  const yuan = n => '¥' + Math.round(n).toLocaleString('zh-CN');
  const topDayText = cur.topDay ? (() => {
    const dt = new Date(Date.parse('2026-' + cur.topDay[0] + 'T00:00:00+08:00') || 0);
    const w = ['日', '一', '二', '三', '四', '五', '六'][dt.getUTCDay()];
    return (dt.getUTCMonth() + 1) + '月' + dt.getUTCDate() + '日 周' + w;
  })() : null;

  let budgetInfo = null;
  if (r.period === 'monthly') {
    const bRaw = await KV.get('budget:' + username, 'json');
    const key = R.label; // '10月' → key is YYYY-MM — derive from range start
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

  const bjNow = new Date(Date.now() + TZ);
  const title = r.period === 'weekly' ? '📊 ' + R.label + '账单' : '📊 ' + R.label + '账单';
  const data = {
    period: r.period,
    rangeText: R.rangeText,
    generatedAt: Date.now(),
    label: R.label, prevLabel: R.prevLabel,
    total: Math.round(cur.total), buy: Math.round(cur.buy), exp: Math.round(cur.exp),
    count: cur.count, deltaText, deltaGood,
    topCats: cur.topCats.map(c => [c[0], Math.round(c[1])]),
    topDay: cur.topDay ? { text: topDayText, val: Math.round(cur.topDay[1]) } : null,
    budget: budgetInfo,
  };
  const report = { period: r.period, generatedAt: Date.now(), title, body: lines.join('\n'), url: '/', data };
  await KV.put('report:latest:' + username, JSON.stringify(report), { expirationTtl: 60 * 86400 });
  return { username, report };
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const KV = env.IMAGE_STORE;
  if (!KV) return json({ error: 'KV not available' }, 500, headers);
  const url = new URL(request.url);
  const svcToken = url.searchParams.get('token') || '';
  const isSvc = env.SERVICE_TOKEN && svcToken && svcToken === env.SERVICE_TOKEN;

  // mysql 模式：报告由服务器直接从 MySQL 计算（不再读飞书）；导出路径挂上 KV 订阅后返回
  if (mysqlMode(env)) {
    const mine = url.searchParams.get('mine') === '1';
    if (mine) {
      const uname = await authUser(request, env);
      if (!uname) return json({ error: 'Unauthorized' }, 401, headers);
      const sr = await toServer(request, env, { username: uname });
      return new Response(sr.body, { status: sr.status, headers: { 'Content-Type': 'application/json', ...headers } });
    }
    if (isSvc) {
      try {
        const sr = await toServer(request, env);
        const d = await sr.json();
        if (d && Array.isArray(d.reports)) {
          for (const r of d.reports) {
            try { r.subscription = await KV.get('webpush:' + r.username, 'json'); } catch (e) { r.subscription = null; }
          }
        }
        return json(d, sr.status === 200 ? 200 : sr.status, headers);
      } catch (e) { return json({ error: e.message }, 500, headers); }
    }
    return json({ error: 'forbidden' }, 403, headers);
  }

  // 我的最新报告（统计页卡片）
  if (request.method === 'GET' && url.searchParams.get('mine') === '1') {
    const user = await authenticate(request, env);
    if (!user.authenticated) return json({ error: 'Unauthorized' }, 401, headers);
    const rep = await KV.get('report:latest:' + user.username, 'json');
    return json({ ok: true, report: rep || null }, 200, headers);
  }

  // 生成并返回待推送列表（服务器定时调用）
  if (request.method === 'GET' && isSvc) {
    const period = url.searchParams.get('period') === 'monthly' ? 'monthly' : 'weekly';
    try {
      const userKeys = await kvList(KV, 'user:');
      const reports = [];
      for (const k of userKeys) {
        const u = k.name.slice(5);
        try {
          const res = await computeForUser(env, u, { period });
          if (!res) continue;
          const sub = await KV.get('webpush:' + u, 'json');
          reports.push({ username: u, subscription: sub, title: res.report.title, body: res.report.body, url: res.report.url });
        } catch (e) { console.error('report user ' + u + ':', e.message); }
      }
      return json({ ok: true, period, reports }, 200, headers);
    } catch (e) { return json({ error: e.message }, 500, headers); }
  }

  return json({ error: 'forbidden' }, 403, headers);
}
