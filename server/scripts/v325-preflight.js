'use strict';
// 特殊预算 v3.2.5 试运行预检（只读）
// 用法:
//   node server/scripts/v325-preflight.js                 # 切换阶段；任何 FAIL 退出码 1
//   node server/scripts/v325-preflight.js --phase=prep    # 试运行前；开关/生效时间可 WARN
//   node server/scripts/v325-preflight.js --json
//   node server/scripts/v325-preflight.js --strict        # WARN 也退出 1
//
// 只执行 SELECT / information_schema 查询；监控部分使用 START TRANSACTION READ ONLY。
// 不会写库、不会修改 server.env、不会重启服务、不会部署前端。
const fs = require('fs');
const path = require('path');
const cfg = require('../src/config');
const db = require('../src/db');
const T = require('../src/lib/special-budget/time');
const M = require('../src/lib/special-budget/monitor');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const STRICT = args.includes('--strict');
const phaseArg = (args.find(a => a.startsWith('--phase=')) || '--phase=switch').split('=')[1];
const PHASE = phaseArg === 'prep' ? 'prep' : 'switch';
const SKIP_API = args.includes('--skip-api');
const YEAR = Number((args.find(a => a.startsWith('--year=')) || '--year=2026').split('=')[1]) || 2026;
const MONTH = Number((args.find(a => a.startsWith('--month=')) || '--month=12').split('=')[1]) || 12;

const checks = [];
function add(key, label, status, detail) {
  checks.push({ key, label, status, detail: detail === undefined ? null : detail });
}
function passed(key, label, detail) { add(key, label, 'pass', detail); }
function warned(key, label, detail) { add(key, label, 'warn', detail); }
function failed(key, label, detail) { add(key, label, 'fail', detail); }

async function q(sql, params) { return db.query(sql, params); }
async function q1(sql, params) { return db.one(sql, params); }

async function checkDb() {
  try {
    const r = await q1('SELECT 1 AS ok');
    passed('db_connect', '数据库连接', { database: cfg.DB.database, ok: Number(r.ok) === 1 });
  } catch (e) {
    failed('db_connect', '数据库连接', { database: cfg.DB.database, error: e.code || e.message });
    throw e;
  }
}

async function checkSchema() {
  const tables = ['special_budget_rules', 'special_budget_approvals', 'special_budget_schedules',
    'special_budget_links', 'special_budget_events', 'special_budget_snapshots', 'special_budget_idempotency'];
  const rows = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = ? AND table_name IN (${tables.map(() => '?').join(',')})`,
    [cfg.DB.database].concat(tables));
  const have = new Set(rows.map(r => r.table_name || r.TABLE_NAME));
  const missing = tables.filter(t => !have.has(t));
  if (missing.length) failed('schema_tables', '特殊预算 7 张表', { missing });
  else passed('schema_tables', '特殊预算 7 张表', { count: tables.length });

  const cols = ['budget_type', 'special_approval_id', 'paid_at', 'refunded_at', 'refund_amount'];
  const colRows = await q(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = ? AND table_name = 'purchase_orders'
        AND column_name IN (${cols.map(() => '?').join(',')})`,
    [cfg.DB.database].concat(cols));
  const haveCols = new Set(colRows.map(r => r.column_name || r.COLUMN_NAME));
  const missingCols = cols.filter(c => !haveCols.has(c));
  if (missingCols.length) failed('schema_order_columns', 'purchase_orders 特殊预算列', { missing: missingCols });
  else passed('schema_order_columns', 'purchase_orders 特殊预算列', { count: cols.length });

  const idx = await q1(
    `SELECT COUNT(*) AS c FROM information_schema.statistics
      WHERE table_schema = ? AND table_name = 'purchase_orders' AND index_name = 'idx_user_budget'`,
    [cfg.DB.database]);
  if (Number(idx.c) > 0) passed('schema_order_index', 'purchase_orders 索引 idx_user_budget');
  else failed('schema_order_index', 'purchase_orders 索引 idx_user_budget', { missing: true });

  const apCols = ['installments', 'first_year', 'first_month'];
  const apRows = await q(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = ? AND table_name = 'special_budget_approvals'
        AND column_name IN (${apCols.map(() => '?').join(',')})`,
    [cfg.DB.database].concat(apCols));
  const haveAp = new Set(apRows.map(r => r.column_name || r.COLUMN_NAME));
  const missingAp = apCols.filter(c => !haveAp.has(c));
  if (missingAp.length) failed('schema_approval_columns', '审批单分期字段', { missing: missingAp });
  else passed('schema_approval_columns', '审批单分期字段', { count: apCols.length });
}

function latestConfig(rows) {
  return rows.length ? rows[rows.length - 1] : null;
}

async function checkConfigs() {
  for (const y of [2026, 2027]) {
    const rows = await q('SELECT * FROM special_budget_rules WHERE year = ? ORDER BY effective_from ASC, id ASC', [y]);
    const c = latestConfig(rows);
    if (!c) {
      failed('config_' + y, `${y} 年默认配置`, { missing: true });
      continue;
    }
    const expected = y === 2026
      ? { annual_cap: 1000, monthly_regular_cap: 800, saturday_rate: 0.1, large_threshold: 800, cross_year_allowed: 0 }
      : { annual_cap: 10000, monthly_regular_cap: 800, saturday_rate: 0.1, large_threshold: 800, cross_year_allowed: 1 };
    const diffs = [];
    for (const k of Object.keys(expected)) {
      if (Math.abs(Number(c[k]) - expected[k]) > 0.0001) {
        diffs.push({ field: k, expected: expected[k], actual: Number(c[k]) });
      }
    }
    const eff = T.bjDateTime(c.effective_from) || '';
    if (y === 2026 && !eff.startsWith('2026-12-01')) {
      diffs.push({ field: 'effective_from', expected: '2026-12-01', actual: eff });
    }
    if (y === 2027 && !eff.startsWith('2027-01-01')) {
      diffs.push({ field: 'effective_from', expected: '2027-01-01', actual: eff });
    }
    if (diffs.length) failed('config_' + y, `${y} 年默认配置`, { rule_version: c.rule_version, diffs });
    else passed('config_' + y, `${y} 年默认配置`, { rule_version: c.rule_version, effective_from: eff });
  }
}

async function checkFlag() {
  if (cfg.SPECIAL_BUDGET_ENABLED) {
    passed('feature_flag', 'SPECIAL_BUDGET_ENABLED', { enabled: true });
  } else if (PHASE === 'prep') {
    warned('feature_flag', 'SPECIAL_BUDGET_ENABLED', { enabled: false, note: '试运行前允许关闭' });
  } else {
    failed('feature_flag', 'SPECIAL_BUDGET_ENABLED', { enabled: false });
  }
}

async function checkApi() {
  if (SKIP_API) {
    warned('api_health', 'purchase-server /health', { skipped: true });
    return;
  }
  const url = `http://${cfg.HOST}:${cfg.PORT}/health`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.ok) passed('api_health', 'purchase-server /health', { status: r.status, url });
    else if (PHASE === 'prep') warned('api_health', 'purchase-server /health', { status: r.status, url });
    else failed('api_health', 'purchase-server /health', { status: r.status, url });
  } catch (e) {
    if (PHASE === 'prep') warned('api_health', 'purchase-server /health', { error: e.code || e.message, url });
    else failed('api_health', 'purchase-server /health', { error: e.code || e.message, url });
  }
}

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

function checkFrontend() {
  const checksLocal = [];
  try {
    const index = read('index.html');
    const mv = /<meta name="app-version" content="([^"]+)">/.exec(index);
    const vv = /var V='([^']+)'/.exec(index);
    const sw = read('sw.js');
    const cache = /var CACHE = '([^']+)'/.exec(sw);
    const utils = read('js/utils.js');
    const uv = /APP_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(utils);
    checksLocal.push({ name: 'index app-version', expected: '3.2.5', actual: mv && mv[1] });
    checksLocal.push({ name: 'index V', expected: '3.2.5', actual: vv && vv[1] });
    checksLocal.push({ name: 'js/utils APP_VERSION', expected: '3.2.5', actual: uv && uv[1] });
    checksLocal.push({ name: 'sw CACHE', expected: 'purchase-cache-v196', actual: cache && cache[1] });
    try {
      const www = read('www/index.html');
      checksLocal.push({ name: 'www/index 与 index 同步', expected: true, actual: www === index });
    } catch (e) {
      checksLocal.push({ name: 'www/index 与 index 同步', expected: true, actual: false });
    }
  } catch (e) {
    failed('frontend_version', '前端版本/缓存', { error: e.message });
    return;
  }
  const bad = checksLocal.filter(c => String(c.actual) !== String(c.expected));
  if (bad.length) failed('frontend_version', '前端版本/缓存', { diffs: bad });
  else passed('frontend_version', '前端版本/缓存', { version: '3.2.5', cache: 'purchase-cache-v196' });
}

async function checkMonitor() {
  const conn = await db.pool.getConnection();
  try {
    await conn.query('START TRANSACTION READ ONLY');
    try {
      const r = await M.collect(conn, { year: YEAR, month: MONTH });
      const failChecks = r.checks.filter(c => c.status === 'fail').map(c => c.key);
      const warnChecks = r.checks.filter(c => c.status === 'warn').map(c => c.key);
      if (failChecks.length) {
        failed('monitor', '试运行监控', { verdict: r.verdict, fail: failChecks, warn: warnChecks, as_of: r.as_of });
      } else if (warnChecks.length) {
        warned('monitor', '试运行监控', { verdict: r.verdict, warn: warnChecks, as_of: r.as_of });
      } else {
        passed('monitor', '试运行监控', { verdict: 'PASS', as_of: r.as_of });
      }
    } finally {
      await conn.query('ROLLBACK');
    }
  } catch (e) {
    failed('monitor', '试运行监控', { error: e.code || e.message });
  } finally {
    conn.release();
  }
}

async function main() {
  try {
    await checkDb();
    await checkSchema();
    await checkConfigs();
    await checkFlag();
    await checkApi();
    checkFrontend();
    await checkMonitor();
  } catch (e) {
    // checkDb 已记录；其他未预期异常补一条
    if (!checks.some(c => c.key === 'db_connect' && c.status === 'fail')) {
      failed('unexpected', '预检异常', { error: e.code || e.message });
    }
  } finally {
    await db.pool.end().catch(() => {});
  }

  const fails = checks.filter(c => c.status === 'fail').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  const verdict = fails ? 'FAIL' : (warns ? 'WARN' : 'PASS');
  if (JSON_OUT) {
    console.log(JSON.stringify({ phase: PHASE, year: YEAR, month: MONTH, verdict, checks }, null, 2));
  } else {
    console.log(`特殊预算 v3.2.5 预检 · 阶段=${PHASE} · ${YEAR}-${String(MONTH).padStart(2, '0')}`);
    for (const c of checks) {
      const tag = c.status === 'pass' ? 'PASS' : (c.status === 'warn' ? 'WARN' : 'FAIL');
      const detail = c.detail ? ' ' + JSON.stringify(c.detail) : '';
      console.log(`[${tag}] ${c.label}${detail}`);
    }
    console.log(`结论: ${verdict}（FAIL ${fails} / WARN ${warns}）`);
  }
  if (fails || (STRICT && warns)) process.exitCode = 1;
}

main();
