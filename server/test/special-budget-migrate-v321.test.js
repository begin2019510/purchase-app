'use strict';
// 特殊预算 v3.2.1 迁移测试（只操作 purchase_app_test 隔离库）
// 验证：dry-run 不写入 / --apply 补 idempotency 表 + approvals 3 列 + 索引 / 重复执行幂等 / 不动业务数据
// 用法: node server/test/special-budget-migrate-v321.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';

const path = require('path');
const { spawnSync } = require('child_process');
const cfg = require('../src/config');
const db = require('../src/db');

const ROOT = path.join(__dirname, '..');
const V320 = 'scripts/migrate-special-budget.js';
const V321 = 'scripts/migrate-special-budget-v321.js';
const IDEM = 'special_budget_idempotency';
const APPROVALS = 'special_budget_approvals';
const COLUMNS = ['installments', 'first_year', 'first_month'];
const INDEX = 'idx_type_status';

let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok', name); }
  else { console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); process.exitCode = 1; }
}

function run(script, apply) {
  const args = [script];
  if (apply) args.push('--apply');
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PURCHASE_DB_NAME: 'purchase_app_test' }),
    encoding: 'utf8',
    timeout: 60000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  ok(`${script.split('/').pop()} ${apply ? '--apply' : 'dry-run'} 退出码 0`, r.status === 0, out.trim());
  return out;
}

async function tableExists(name) {
  const row = await db.one(
    'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [cfg.DB.database, name]);
  return Number(row.c) > 0;
}

async function columnInfo(table, column) {
  return db.one(
    `SELECT column_name, column_default, is_nullable, data_type
       FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [cfg.DB.database, table, column]);
}

async function indexInfo(table, index) {
  return db.query(
    `SELECT index_name, non_unique, column_name, seq_in_index
       FROM information_schema.statistics
      WHERE table_schema = ? AND table_name = ? AND index_name = ?
      ORDER BY seq_in_index`,
    [cfg.DB.database, table, index]);
}

async function countTable(name) {
  if (!(await tableExists(name))) return 0;
  const row = await db.one(`SELECT COUNT(*) AS c FROM ${name}`);
  return Number(row.c);
}

async function snapshot() {
  const cols = {};
  for (const c of COLUMNS) cols[c] = await columnInfo(APPROVALS, c);
  const orders = await db.one('SELECT COUNT(*) AS c, COALESCE(SUM(price_paid), 0) AS s FROM purchase_orders');
  return {
    idem: await tableExists(IDEM),
    cols: JSON.stringify(cols),
    index: (await indexInfo(APPROVALS, INDEX)).length,
    approvals: await countTable(APPROVALS),
    schedules: await countTable('special_budget_schedules'),
    events: await countTable('special_budget_events'),
    rules: await countTable('special_budget_rules'),
    orders: Number(orders.c),
    ordersSum: Number(orders.s),
  };
}

(async () => {
  try {
    ok('连接的是隔离测试库', /_test$/.test(cfg.DB.database), cfg.DB.database);
    if (!(await tableExists('purchase_orders'))) {
      throw new Error('purchase_orders 不存在：请先对 purchase_app_test 执行 migrate-purchase-needs.js');
    }
    // 前置：v3.2.0 六表
    run(V320, true);

    // 共享测试库：清空特殊预算业务数据，保证“迁移不动业务数据”的基线干净
    for (const t of [IDEM, 'special_budget_events', 'special_budget_schedules',
      'special_budget_links', APPROVALS, 'special_budget_rules']) {
      if (await tableExists(t)) await db.exec(`DELETE FROM ${t}`);
    }
    // 恢复 2026/2027 默认配置（migrate 只在空表时写入）
    run(V320, true);

    const before = await snapshot();

    // 1) dry-run：结构不变
    const dry = run(V321, false);
    ok('dry-run 输出包含 DRY-RUN', /DRY-RUN/.test(dry), dry);
    const afterDry = await snapshot();
    ok('dry-run 不建 idempotency 表', afterDry.idem === before.idem, `${before.idem} → ${afterDry.idem}`);
    ok('dry-run 不加列', afterDry.cols === before.cols, `${before.cols} → ${afterDry.cols}`);
    ok('dry-run 不加索引', afterDry.index === before.index, `${before.index} → ${afterDry.index}`);
    ok('dry-run 不改业务数据',
      afterDry.approvals === before.approvals && afterDry.schedules === before.schedules &&
      afterDry.events === before.events && afterDry.rules === before.rules &&
      afterDry.orders === before.orders && afterDry.ordersSum === before.ordersSum);

    // 2) --apply：补齐结构
    const apply1 = run(V321, true);
    ok('--apply 输出新增统计', /完成：新增表 \d+，新增列 \d+，新增索引 \d+/.test(apply1), apply1);
    ok('idempotency 表存在', await tableExists(IDEM));

    const inst = await columnInfo(APPROVALS, 'installments');
    ok('installments = INT NOT NULL DEFAULT 1',
      inst && /int/i.test(inst.DATA_TYPE) && inst.IS_NULLABLE === 'NO' && String(inst.COLUMN_DEFAULT) === '1',
      JSON.stringify(inst));
    const fy = await columnInfo(APPROVALS, 'first_year');
    ok('first_year 可空 SMALLINT', fy && /smallint/i.test(fy.DATA_TYPE) && fy.IS_NULLABLE === 'YES', JSON.stringify(fy));
    const fm = await columnInfo(APPROVALS, 'first_month');
    ok('first_month 可空 TINYINT', fm && /tinyint/i.test(fm.DATA_TYPE) && fm.IS_NULLABLE === 'YES', JSON.stringify(fm));

    const idx = await indexInfo(APPROVALS, INDEX);
    ok('idx_type_status = (type,status) 普通索引',
      idx.length === 2 && idx[0].COLUMN_NAME === 'type' && idx[1].COLUMN_NAME === 'status' &&
      Number(idx[0].NON_UNIQUE) === 1, JSON.stringify(idx));

    const idemIdx = await indexInfo(IDEM, 'uq_user_scope_key');
    ok('幂等唯一键 (username,scope,idem_key)',
      idemIdx.length === 3 && idemIdx.map(x => x.COLUMN_NAME).join(',') === 'username,scope,idem_key' &&
      Number(idemIdx[0].NON_UNIQUE) === 0, JSON.stringify(idemIdx));

    const after = await snapshot();
    ok('apply 不改业务数据',
      after.approvals === before.approvals && after.schedules === before.schedules &&
      after.events === before.events && after.rules === before.rules &&
      after.orders === before.orders && after.ordersSum === before.ordersSum,
      JSON.stringify({ before, after }));

    // 3) 重复执行幂等
    const apply2 = run(V321, true);
    ok('重复执行报告“已存在”', /已存在/.test(apply2), apply2);
    const after2 = await snapshot();
    ok('重复执行结构不变', after2.cols === after.cols && after2.index === after.index && after2.idem === true);
    const rules2 = await countTable('special_budget_rules');
    ok('重复执行不重复写配置', rules2 === 2, `实际 ${rules2}`);
  } catch (e) {
    console.error('FAIL', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }

  console.log(`\n${passed} passed${process.exitCode ? '（有失败）' : ''}`);
})();
