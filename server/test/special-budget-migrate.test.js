'use strict';
// 特殊预算 v3.2.0 迁移测试（只操作 purchase_app_test 隔离库）
// 验证：dry-run 不写入 / --apply 建表加列 / 重复执行幂等 / 不动业务数据
// 注意：业务库账号没有 DROP 权限（这也是生产安全边界），因此测试不做 DROP 重置，
//       改为在任意初始状态下记录快照并对比；只有 6 表均不存在时才能证明“dry-run 不建表”。
// 用法: node server/test/special-budget-migrate.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const cfg = require('../src/config');
const db = require('../src/db');

const ROOT = path.join(__dirname, '..');
const SCRIPT = 'scripts/migrate-special-budget.js';
const TABLES = [
  'special_budget_rules',
  'special_budget_approvals',
  'special_budget_schedules',
  'special_budget_links',
  'special_budget_events',
  'special_budget_snapshots',
];
const COLUMNS = ['budget_type', 'special_approval_id', 'paid_at', 'refunded_at', 'refund_amount'];

let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok', name); }
  else { console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); process.exitCode = 1; }
}

function runMigrate(apply) {
  const args = [SCRIPT];
  if (apply) args.push('--apply');
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PURCHASE_DB_NAME: 'purchase_app_test' }),
    encoding: 'utf8',
    timeout: 60000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  ok(`migrate ${apply ? '--apply' : 'dry-run'} 退出码 0`, r.status === 0, out.trim());
  return out;
}

async function tableExists(name) {
  const row = await db.one(
    'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [cfg.DB.database, name]);
  return Number(row.c) > 0;
}

async function columnExists(column) {
  const row = await db.one(
    'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
    [cfg.DB.database, 'purchase_orders', column]);
  return Number(row.c) > 0;
}

async function indexExists(name) {
  const row = await db.one(
    'SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
    [cfg.DB.database, 'purchase_orders', name]);
  return Number(row.c) > 0;
}

function bjDate(v) {
  if (v instanceof Date) return new Date(v.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

async function countTable(name) {
  const row = await db.one(`SELECT COUNT(*) AS c FROM ${name}`);
  return Number(row.c);
}

async function snapshot() {
  const tables = {};
  for (const t of TABLES) tables[t] = await tableExists(t);
  const columns = {};
  for (const c of COLUMNS) columns[c] = await columnExists(c);
  const orders = await db.one('SELECT COUNT(*) AS c, COALESCE(SUM(price_paid), 0) AS s FROM purchase_orders');
  return {
    tables,
    columns,
    index: await indexExists('idx_user_budget'),
    orders: Number(orders.c),
    ordersSum: Number(orders.s),
    approvals: (await tableExists('special_budget_approvals')) ? await countTable('special_budget_approvals') : 0,
    schedules: (await tableExists('special_budget_schedules')) ? await countTable('special_budget_schedules') : 0,
    events: (await tableExists('special_budget_events')) ? await countTable('special_budget_events') : 0,
    configs: (await tableExists('special_budget_rules')) ? await countTable('special_budget_rules') : 0,
  };
}

(async () => {
  try {
    ok('连接的是隔离测试库', /_test$/.test(cfg.DB.database), cfg.DB.database);
    if (!(await tableExists('purchase_orders'))) {
      throw new Error('purchase_orders 不存在：请先对 purchase_app_test 执行 migrate-purchase-needs.js');
    }

    // 测试库共享：先清掉其他测试/冒烟留下的特殊预算业务数据，保证“迁移不动业务数据”的基线干净
    for (const t of ['special_budget_idempotency', 'special_budget_events', 'special_budget_schedules',
      'special_budget_links', 'special_budget_approvals', 'special_budget_rules']) {
      if (await tableExists(t)) await db.exec(`DELETE FROM ${t}`);
    }
    await db.exec("UPDATE purchase_orders SET budget_type = 'general', special_approval_id = NULL WHERE budget_type <> 'general'");

    const initial = await snapshot();
    const initiallyEmpty = !Object.values(initial.tables).some(Boolean) && !Object.values(initial.columns).some(Boolean);

    // 1) dry-run：不写任何东西
    if (initiallyEmpty) {
      const dry = runMigrate(false);
      ok('dry-run 输出包含 DRY-RUN', /DRY-RUN/.test(dry), dry);
      const afterDry = await snapshot();
      ok('dry-run 后 0 张特殊预算表', !Object.values(afterDry.tables).some(Boolean), JSON.stringify(afterDry.tables));
      ok('dry-run 后 0 个新列', !Object.values(afterDry.columns).some(Boolean), JSON.stringify(afterDry.columns));
      ok('dry-run 后无 idx_user_budget', afterDry.index === false);
      ok('dry-run 后无配置', afterDry.configs === 0);
    } else {
      // 表可能已存在（重复运行）：先清空配置，验证 dry-run 不会补写
      if (await tableExists('special_budget_rules')) {
        await db.exec('DELETE FROM special_budget_rules');
      }
      const beforeDry = await snapshot();
      const dry = runMigrate(false);
      ok('dry-run 输出包含 DRY-RUN', /DRY-RUN/.test(dry), dry);
      const afterDry = await snapshot();
      ok('重复运行下 dry-run 不补写配置', afterDry.configs === 0 && beforeDry.configs === 0, `实际 ${afterDry.configs}`);
      ok('重复运行下 dry-run 不改业务数据',
        afterDry.orders === beforeDry.orders && afterDry.ordersSum === beforeDry.ordersSum);
      ok('重复运行下 dry-run 不改表/列结构', JSON.stringify(afterDry.tables) === JSON.stringify(beforeDry.tables) &&
        JSON.stringify(afterDry.columns) === JSON.stringify(beforeDry.columns) && afterDry.index === beforeDry.index);
    }

    // 2) --apply：建 6 表 / 加 5 列 / 加索引 / 写 2 条年度配置
    const apply1 = runMigrate(true);
    let tblCount = 0;
    for (const t of TABLES) if (await tableExists(t)) tblCount++;
    ok('--apply 后 6 张表齐全', tblCount === 6, `实际 ${tblCount}`);
    let colCount = 0;
    for (const c of COLUMNS) if (await columnExists(c)) colCount++;
    ok('--apply 后 5 个新列齐全', colCount === 5, `实际 ${colCount}`);
    ok('--apply 后 idx_user_budget 存在', await indexExists('idx_user_budget'));

    const configs = await db.query(
      'SELECT year, annual_cap, monthly_regular_cap, saturday_rate, large_threshold, cross_year_allowed, rule_version, effective_from FROM special_budget_rules ORDER BY year');
    ok('写入 2 条年度配置', configs.length === 2, JSON.stringify(configs));
    const c26 = configs.find(c => Number(c.year) === 2026);
    const c27 = configs.find(c => Number(c.year) === 2027);
    ok('2026 配置 = 1000/800/10%/800/不跨年/2026-v1',
      c26 && Number(c26.annual_cap) === 1000 && Number(c26.monthly_regular_cap) === 800 &&
      Number(c26.saturday_rate) === 0.1 && Number(c26.large_threshold) === 800 &&
      Number(c26.cross_year_allowed) === 0 && c26.rule_version === '2026-v1' &&
      bjDate(c26.effective_from) === '2026-12-01',
      JSON.stringify(c26));
    ok('2027 配置 = 10000/800/10%/800/可跨年/2027-v1',
      c27 && Number(c27.annual_cap) === 10000 && Number(c27.monthly_regular_cap) === 800 &&
      Number(c27.saturday_rate) === 0.1 && Number(c27.large_threshold) === 800 &&
      Number(c27.cross_year_allowed) === 1 && c27.rule_version === '2027-v1' &&
      bjDate(c27.effective_from) === '2027-01-01',
      JSON.stringify(c27));

    // 3) 业务数据未变
    const after = await db.one(
      'SELECT COUNT(*) AS c, COALESCE(SUM(price_paid), 0) AS s FROM purchase_orders');
    ok('purchase_orders 条数不变', Number(after.c) === initial.orders, `${initial.orders} → ${after.c}`);
    ok('purchase_orders 金额不变', Number(after.s) === initial.ordersSum, `${initial.ordersSum} → ${after.s}`);
    const nonGeneral = await db.one(
      "SELECT COUNT(*) AS c FROM purchase_orders WHERE budget_type <> 'general'");
    ok('迁移不产生特殊预算订单', Number(nonGeneral.c) === 0, `实际 ${nonGeneral.c}`);
    for (const t of ['special_budget_approvals', 'special_budget_schedules', 'special_budget_events']) {
      const row = await db.one(`SELECT COUNT(*) AS c FROM ${t}`);
      ok(`${t} 无业务数据`, Number(row.c) === 0, `实际 ${row.c}`);
    }

    // 4) 幂等：再跑一次不重复建/不重复写配置
    const apply2 = runMigrate(true);
    ok('重复执行报告已存在', /已存在/.test(apply2), apply2);
    const cfgCount = await db.one('SELECT COUNT(*) AS c FROM special_budget_rules');
    ok('重复执行后仍只有 2 条配置', Number(cfgCount.c) === 2, `实际 ${cfgCount.c}`);
    colCount = 0;
    for (const c of COLUMNS) if (await columnExists(c)) colCount++;
    ok('重复执行后列数仍为 5', colCount === 5, `实际 ${colCount}`);

    // 5) 不覆盖人工修改：改 2026 上限后再跑，值保持
    await db.exec("UPDATE special_budget_rules SET annual_cap = 1234 WHERE year = 2026");
    runMigrate(true);
    const c26b = await db.one('SELECT annual_cap FROM special_budget_rules WHERE year = 2026 ORDER BY id DESC LIMIT 1');
    ok('重复迁移不覆盖已有人工配置', Number(c26b.annual_cap) === 1234, `实际 ${c26b.annual_cap}`);
    await db.exec("UPDATE special_budget_rules SET annual_cap = 1000 WHERE year = 2026");
  } catch (e) {
    console.error('FAIL', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }

  console.log(`\n${passed} passed${process.exitCode ? '（有失败）' : ''}`);
})();
