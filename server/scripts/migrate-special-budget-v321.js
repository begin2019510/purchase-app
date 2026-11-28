'use strict';
// 特殊预算 v3.2.1 迁移（非破坏性、可重复）
// 用法:
//   node server/scripts/migrate-special-budget-v321.js            # DRY-RUN
//   node server/scripts/migrate-special-budget-v321.js --apply    # 实际执行
//
// 前置：先执行 v3.2.0 的 migrate-special-budget.js（6 张表 + purchase_orders 5 列）。
// 本脚本只补三样东西：
//   1) special_budget_idempotency 表（申请/审批/退款/配置修改的幂等键）
//   2) special_budget_approvals 的分期计划字段 installments / first_year / first_month
//   3) special_budget_approvals(type,status) 索引（月度/周六聚合）
// 不修改任何业务数据，不删除任何表/列；回滚同 v3.2.0：关开关 + 回退后端，表保留。

const cfg = require('../src/config');
const db = require('../src/db');

const APPLY = process.argv.includes('--apply');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const TABLE = {
  name: 'special_budget_idempotency',
  sql: `CREATE TABLE IF NOT EXISTS special_budget_idempotency (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(64) NOT NULL,
    scope VARCHAR(40) NOT NULL,
    idem_key VARCHAR(64) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    status_code SMALLINT NOT NULL DEFAULT 0,
    response_json MEDIUMTEXT NOT NULL,
    resource_id BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_scope_key (username, scope, idem_key),
    KEY idx_created (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

const COLUMNS = [
  { table: 'special_budget_approvals', name: 'installments', ddl: 'INT NOT NULL DEFAULT 1' },
  { table: 'special_budget_approvals', name: 'first_year', ddl: 'SMALLINT NULL' },
  { table: 'special_budget_approvals', name: 'first_month', ddl: 'TINYINT NULL' },
];

const INDEXES = [
  { table: 'special_budget_approvals', name: 'idx_type_status', ddl: '(type, status)' },
];

async function tableExists(name) {
  const row = await db.one(
    'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [cfg.DB.database, name]);
  return Number(row.c) > 0;
}

async function columnExists(table, column) {
  const row = await db.one(
    'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
    [cfg.DB.database, table, column]);
  return Number(row.c) > 0;
}

async function indexExists(table, index) {
  const row = await db.one(
    'SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
    [cfg.DB.database, table, index]);
  return Number(row.c) > 0;
}

async function run() {
  log(`DB=${cfg.DB.database} ${APPLY ? '[APPLY]' : '[DRY-RUN]（加 --apply 才执行）'}`);

  for (const t of ['special_budget_rules', 'special_budget_approvals', 'special_budget_schedules',
    'special_budget_links', 'special_budget_events', 'special_budget_snapshots']) {
    if (!(await tableExists(t))) {
      throw new Error(`缺少 ${t}，请先执行 migrate-special-budget.js --apply`);
    }
  }

  let created = 0, addedColumns = 0, addedIndexes = 0;

  if (await tableExists(TABLE.name)) {
    log(`表 ${TABLE.name}: 已存在，跳过`);
  } else {
    log(`表 ${TABLE.name}: ${APPLY ? '创建' : '将创建'}`);
    if (APPLY) await db.exec(TABLE.sql);
    created++;
  }

  for (const c of COLUMNS) {
    if (await columnExists(c.table, c.name)) {
      log(`列 ${c.table}.${c.name}: 已存在，跳过`);
      continue;
    }
    log(`列 ${c.table}.${c.name}: ${APPLY ? '添加' : '将添加'} ${c.ddl}`);
    if (APPLY) await db.exec(`ALTER TABLE ${c.table} ADD COLUMN ${c.name} ${c.ddl}`);
    addedColumns++;
  }

  for (const x of INDEXES) {
    if (await indexExists(x.table, x.name)) {
      log(`索引 ${x.table}.${x.name}: 已存在，跳过`);
      continue;
    }
    log(`索引 ${x.table}.${x.name}: ${APPLY ? '添加' : '将添加'} ${x.ddl}`);
    if (APPLY) await db.exec(`ALTER TABLE ${x.table} ADD INDEX ${x.name} ${x.ddl}`);
    addedIndexes++;
  }

  log(`完成：新增表 ${created}，新增列 ${addedColumns}，新增索引 ${addedIndexes}${APPLY ? '' : '（DRY-RUN，未写入）'}`);
}

(async () => {
  try {
    await run();
    process.exit(0);
  } catch (e) {
    console.error('FAILED:', e.code || e.message);
    process.exit(1);
  }
})();
