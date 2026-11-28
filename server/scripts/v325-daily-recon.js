'use strict';
// 特殊预算 v3.2.5 日对账（只读）
// 用法:
//   node server/scripts/v325-daily-recon.js                 # 今天（北京时间）
//   node server/scripts/v325-daily-recon.js --date=2026-12-01
//   node server/scripts/v325-daily-recon.js --json
//   node server/scripts/v325-daily-recon.js --out=/tmp/recon-2026-12-01.json
//
// 只执行 SELECT；使用 START TRANSACTION READ ONLY，不写库、不改快照。
// 需要生成/刷新快照时，请在 App「🔍 审计」页点按钮（该写操作有幂等与审计）。
const fs = require('fs');
const db = require('../src/db');
const T = require('../src/lib/special-budget/time');
const M = require('../src/lib/special-budget/monitor');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const STRICT = args.includes('--strict');
const dateArg = (args.find(a => a.startsWith('--date=')) || '').split('=')[1] || '';
const yearArg = (args.find(a => a.startsWith('--year=')) || '').split('=')[1] || '';
const monthArg = (args.find(a => a.startsWith('--month=')) || '').split('=')[1] || '';
const outArg = (args.find(a => a.startsWith('--out=')) || '').split('=')[1] || '';

function pad2(v) { return String(v).padStart(2, '0'); }
function fail(message) {
  console.error(message);
  process.exitCode = 1;
  db.pool.end().catch(() => {});
}

function period() {
  if (dateArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) return null;
    const d = new Date(dateArg + 'T23:59:59+08:00');
    if (!Number.isFinite(d.getTime())) return null;
    return { year: Number(dateArg.slice(0, 4)), month: Number(dateArg.slice(5, 7)), now: d, date: dateArg };
  }
  const now = new Date();
  const date = T.bjDate(now);
  return {
    year: Number(yearArg) || Number(date.slice(0, 4)),
    month: Number(monthArg) || Number(date.slice(5, 7)),
    now,
    date,
  };
}

function tag(status) {
  return status === 'pass' ? 'PASS' : (status === 'warn' ? 'WARN' : 'FAIL');
}

(async () => {
  const p = period();
  if (!p) return fail('日期格式错误，应为 YYYY-MM-DD');
  let report = null;
  const conn = await db.pool.getConnection().catch(e => {
    fail('数据库连接失败: ' + (e.code || e.message));
    return null;
  });
  if (!conn) return;
  try {
    await conn.query('START TRANSACTION READ ONLY');
    try {
      report = await M.collect(conn, { year: p.year, month: p.month, now: p.now });
    } finally {
      await conn.query('ROLLBACK');
    }
  } catch (e) {
    return fail('日对账失败: ' + (e.code || e.message));
  } finally {
    conn.release();
    await db.pool.end().catch(() => {});
  }

  const doc = {
    date: p.date,
    year: p.year,
    month: p.month,
    verdict: report.verdict,
    as_of: report.as_of,
    summary: report.summary,
    counts: report.counts,
    reconciliation: report.reconciliation,
    snapshots: report.snapshots,
    checks: report.checks,
  };
  if (outArg) {
    try { fs.writeFileSync(outArg, JSON.stringify(doc, null, 2)); }
    catch (e) { console.error('写报告失败: ' + e.message); process.exitCode = 1; }
  }
  if (JSON_OUT) {
    console.log(JSON.stringify(doc, null, 2));
  } else {
    const s = report.summary;
    console.log(`特殊预算日对账 · ${p.date} · ${p.year}-${pad2(p.month)}`);
    console.log(`结论: ${report.verdict} · 截止 ${report.as_of}`);
    console.log(`年度占用 ${s.annual_committed.toFixed(2)} / ${s.annual_cap.toFixed(2)}，剩余 ${s.annual_remaining.toFixed(2)}`);
    console.log(`本月常规已批 ${s.monthly_regular_approved.toFixed(2)} / ${s.monthly_regular_cap.toFixed(2)}，本月净现金 ${s.monthly_cash.toFixed(2)}`);
    console.log(`对账差异 ${report.reconciliation.difference.toFixed(2)}；逾期 ${report.counts.overdue_count} 笔；缺失快照 ${report.counts.missing_snapshots} 个`);
    for (const c of report.checks) {
      if (c.status === 'pass') continue;
      console.log(`[${tag(c.status)}] ${c.label}${c.detail ? ' ' + JSON.stringify(c.detail) : ''}`);
    }
    if (report.verdict === 'PASS') console.log('全部检查通过。');
  }
  if (report.verdict === 'FAIL' || (STRICT && report.verdict === 'WARN')) process.exitCode = 1;
})().catch(e => {
  fail('未预期错误: ' + (e.code || e.message));
});
