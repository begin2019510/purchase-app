'use strict';
// 特殊预算 v3.2.0 迁移（非破坏性、可重复）
// 用法:
//   node server/scripts/migrate-special-budget.js            # DRY-RUN，只打印计划
//   node server/scripts/migrate-special-budget.js --apply    # 实际执行
//
// 只做四件事：建 6 张表、给 purchase_orders 加 5 列、加 1 个索引、补缺失的 2026/2027 默认配置。
// 不修改任何采购/审批/付款/退款业务数据；已有年度配置不覆盖（避免抹掉人工修改）。
// 回滚：关闭功能开关 + 后端回退；新增表和列保留，不做向下删除（见交接文件 §10）。

const cfg = require('../src/config');
const db = require('../src/db');

const APPLY = process.argv.includes('--apply');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const TABLES = [
  {
    name: 'special_budget_rules',
    sql: `CREATE TABLE IF NOT EXISTS special_budget_rules (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      year SMALLINT NOT NULL,
      annual_cap DECIMAL(12,2) NOT NULL,
      monthly_regular_cap DECIMAL(12,2) NOT NULL DEFAULT 800.00,
      saturday_rate DECIMAL(5,4) NOT NULL DEFAULT 0.1000,
      large_threshold DECIMAL(12,2) NOT NULL DEFAULT 800.00,
      cross_year_allowed TINYINT NOT NULL DEFAULT 0,
      effective_from DATETIME NOT NULL,
      effective_to DATETIME NULL,
      rule_version VARCHAR(20) NOT NULL,
      changed_by VARCHAR(64) NOT NULL,
      change_reason VARCHAR(500) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_year_version (year, rule_version),
      KEY idx_year_effective (year, effective_from)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'special_budget_approvals',
    sql: `CREATE TABLE IF NOT EXISTS special_budget_approvals (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      approval_no VARCHAR(32) NOT NULL,
      username VARCHAR(64) NOT NULL,
      type VARCHAR(10) NOT NULL,
      purpose VARCHAR(500) NOT NULL,
      requested_amount DECIMAL(12,2) NOT NULL,
      approved_amount DECIMAL(12,2) NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'pending',
      rule_version VARCHAR(20) NOT NULL,
      applied_at DATETIME NOT NULL,
      approved_at DATETIME NULL,
      expires_at DATETIME NULL,
      second_confirmed_by VARCHAR(64) NULL,
      second_confirmed_at DATETIME NULL,
      parent_id BIGINT UNSIGNED NULL,
      note TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_approval_no (approval_no),
      KEY idx_user_status (username, status),
      KEY idx_applied (applied_at),
      KEY idx_parent (parent_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'special_budget_schedules',
    sql: `CREATE TABLE IF NOT EXISTS special_budget_schedules (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      approval_id BIGINT UNSIGNED NOT NULL,
      order_id BIGINT UNSIGNED NULL,
      seq INT NOT NULL,
      due_date DATE NOT NULL,
      year SMALLINT NOT NULL,
      month TINYINT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'planned',
      paid_at DATETIME NULL,
      refunded_at DATETIME NULL,
      refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_approval_seq (approval_id, seq),
      KEY idx_year_month (year, month),
      KEY idx_order (order_id),
      KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'special_budget_links',
    sql: `CREATE TABLE IF NOT EXISTS special_budget_links (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      approval_id BIGINT UNSIGNED NOT NULL,
      order_id BIGINT UNSIGNED NOT NULL,
      link_type VARCHAR(16) NOT NULL,
      linked_amount DECIMAL(12,2) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'active',
      linked_at DATETIME NOT NULL,
      released_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_approval_order (approval_id, order_id),
      KEY idx_order (order_id),
      KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'special_budget_events',
    sql: `CREATE TABLE IF NOT EXISTS special_budget_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      approval_id BIGINT UNSIGNED NULL,
      order_id BIGINT UNSIGNED NULL,
      schedule_id BIGINT UNSIGNED NULL,
      event_type VARCHAR(20) NOT NULL,
      amount DECIMAL(12,2) NULL,
      actor VARCHAR(64) NOT NULL,
      at DATETIME(3) NOT NULL,
      ip VARCHAR(45) NULL,
      reason VARCHAR(500) NULL,
      before_json JSON NULL,
      after_json JSON NULL,
      rule_version VARCHAR(20) NULL,
      KEY idx_approval (approval_id),
      KEY idx_order (order_id),
      KEY idx_at (at),
      KEY idx_type (event_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
  {
    name: 'special_budget_snapshots',
    sql: `CREATE TABLE IF NOT EXISTS special_budget_snapshots (
      year SMALLINT NOT NULL,
      month TINYINT NOT NULL,
      annual_cap DECIMAL(12,2) NOT NULL,
      annual_committed DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      annual_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      annual_refunded DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      annual_released DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      annual_remaining DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      monthly_regular_cap DECIMAL(12,2) NOT NULL DEFAULT 800.00,
      monthly_regular_approved DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      monthly_installment_due DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      monthly_cash DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      future_commitments_json JSON NULL,
      generated_at DATETIME NOT NULL,
      PRIMARY KEY (year, month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  },
];

const ORDER_COLUMNS = [
  { name: 'budget_type', ddl: "VARCHAR(10) NOT NULL DEFAULT 'general'" },
  { name: 'special_approval_id', ddl: 'BIGINT UNSIGNED NULL' },
  { name: 'paid_at', ddl: 'DATETIME NULL' },
  { name: 'refunded_at', ddl: 'DATETIME NULL' },
  { name: 'refund_amount', ddl: 'DECIMAL(12,2) NOT NULL DEFAULT 0.00' },
];

const ORDER_INDEX = { name: 'idx_user_budget', ddl: '(user_id, budget_type)' };

const SEEDS = [
  {
    year: 2026,
    annual_cap: 1000,
    monthly_regular_cap: 800,
    saturday_rate: 0.10,
    large_threshold: 800,
    cross_year_allowed: 0,
    rule_version: '2026-v1',
    effective_from: '2026-12-01 00:00:00',
    changed_by: 'system:seed',
    change_reason: 'v3.2.0 初始化：2026-12 试运行默认配置（1000/800/100，不跨年）',
  },
  {
    year: 2027,
    annual_cap: 10000,
    monthly_regular_cap: 800,
    saturday_rate: 0.10,
    large_threshold: 800,
    cross_year_allowed: 1,
    rule_version: '2027-v1',
    effective_from: '2027-01-01 00:00:00',
    changed_by: 'system:seed',
    change_reason: 'v3.2.0 初始化：2027 默认配置（10000/800/1000，允许跨年分期）',
  },
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
  let createdTables = 0, addedColumns = 0, addedIndexes = 0, seeded = 0;

  for (const t of TABLES) {
    if (await tableExists(t.name)) {
      log(`表 ${t.name}: 已存在，跳过`);
      continue;
    }
    log(`表 ${t.name}: ${APPLY ? '创建' : '将创建'}`);
    if (APPLY) await db.exec(t.sql);
    createdTables++;
  }

  if (!(await tableExists('purchase_orders'))) {
    throw new Error('purchase_orders 不存在，请先执行 migrate-purchase-needs.js');
  }

  for (const c of ORDER_COLUMNS) {
    if (await columnExists('purchase_orders', c.name)) {
      log(`列 purchase_orders.${c.name}: 已存在，跳过`);
      continue;
    }
    log(`列 purchase_orders.${c.name}: ${APPLY ? '添加' : '将添加'} ${c.ddl}`);
    if (APPLY) await db.exec(`ALTER TABLE purchase_orders ADD COLUMN ${c.name} ${c.ddl}`);
    addedColumns++;
  }

  if (await indexExists('purchase_orders', ORDER_INDEX.name)) {
    log(`索引 purchase_orders.${ORDER_INDEX.name}: 已存在，跳过`);
  } else {
    log(`索引 purchase_orders.${ORDER_INDEX.name}: ${APPLY ? '添加' : '将添加'} ${ORDER_INDEX.ddl}`);
    if (APPLY) await db.exec(`ALTER TABLE purchase_orders ADD INDEX ${ORDER_INDEX.name} ${ORDER_INDEX.ddl}`);
    addedIndexes++;
  }

  // dry-run 且规则表尚不存在时，无法检查配置（不连不存在表做查询）
  if (!(await tableExists('special_budget_rules'))) {
    log(`配置 2026/2027: 规则表尚未创建，${APPLY ? '异常' : 'dry-run 跳过检查'}`);
  } else {
    for (const s of SEEDS) {
      const row = await db.one('SELECT id FROM special_budget_rules WHERE year = ? LIMIT 1', [s.year]);
      if (row) {
        log(`配置 ${s.year}: 已存在，跳过（不覆盖人工修改）`);
        continue;
      }
      log(`配置 ${s.year}: ${APPLY ? '写入' : '将写入'} annual_cap=${s.annual_cap} monthly=${s.monthly_regular_cap} saturday_rate=${s.saturday_rate} cross_year=${s.cross_year_allowed} rule_version=${s.rule_version}`);
      if (APPLY) {
        await db.exec(
          `INSERT INTO special_budget_rules
             (year, annual_cap, monthly_regular_cap, saturday_rate, large_threshold, cross_year_allowed,
              effective_from, rule_version, changed_by, change_reason)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [s.year, s.annual_cap, s.monthly_regular_cap, s.saturday_rate, s.large_threshold,
            s.cross_year_allowed, s.effective_from, s.rule_version, s.changed_by, s.change_reason]);
      }
      seeded++;
    }
  }

  if (APPLY) {
    const configs = await db.query(
      `SELECT year, annual_cap, monthly_regular_cap, saturday_rate, large_threshold,
              cross_year_allowed, rule_version, effective_from
         FROM special_budget_rules ORDER BY year, effective_from`);
    log('当前配置:');
    for (const c of configs) {
      log(`  ${c.year}: cap=${c.annual_cap} monthly=${c.monthly_regular_cap} ` +
        `saturday_rate=${c.saturday_rate} saturday_cap=${Math.round(Number(c.annual_cap) * Number(c.saturday_rate) * 100) / 100} ` +
        `large_threshold=${c.large_threshold} cross_year=${c.cross_year_allowed} rule=${c.rule_version}`);
    }
    const orders = await db.one('SELECT COUNT(*) AS c FROM purchase_orders');
    const specials = await db.one("SELECT COUNT(*) AS c FROM purchase_orders WHERE budget_type = 'special'");
    log(`purchase_orders=${orders.c}，其中 special=${specials.c}（迁移不产生特殊业务数据）`);
  }

  log(`完成：新增表 ${createdTables}，新增列 ${addedColumns}，新增索引 ${addedIndexes}，写入配置 ${seeded}${APPLY ? '' : '（DRY-RUN，未写入）'}`);
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
