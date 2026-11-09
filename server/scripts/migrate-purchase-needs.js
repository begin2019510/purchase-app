'use strict';
// 采购单层 → 两级模型迁移（PURCHASE-REDESIGN §7）
// 用法:
//   node server/scripts/migrate-purchase-needs.js [--dry]     正向迁移（幂等，可重入）
//   node server/scripts/migrate-purchase-needs.js --reverse   反向：把 1:1:1 结构压回 purchases
// 正向：建三表 → 逐行复制 purchases → need+supplier+formal order → 待办 link_id 重映射
// purchases 原表只读冻结（不删不改），作为回滚备份。
const cfg = require('../src/config');
const db = require('../src/db');

const DRY = process.argv.includes('--dry');
const REVERSE = process.argv.includes('--reverse');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const DDL = [
  `CREATE TABLE IF NOT EXISTS purchase_needs (
    id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id               INT UNSIGNED NOT NULL,
    name                  VARCHAR(200) NOT NULL,
    category              VARCHAR(30) NULL,
    budget_min            DECIMAL(10,2) NULL,
    budget_max            DECIMAL(10,2) NULL,
    status                VARCHAR(10) NOT NULL DEFAULT '对比中',
    dimensions            JSON NULL,
    selected_supplier_id  BIGINT UNSIGNED NULL,
    project_id            BIGINT UNSIGNED NULL,
    phase_idx             TINYINT NULL,
    is_virtual            TINYINT NOT NULL DEFAULT 0,
    is_quick              TINYINT NOT NULL DEFAULT 0,
    buy_reason            TEXT NULL,
    eval_summary          TEXT NULL,
    cancel_reason         VARCHAR(200) NULL,
    decided_at            DATETIME NULL,
    ext_id                VARCHAR(40) NULL,
    legacy_purchase_id    BIGINT UNSIGNED NULL,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_legacy (legacy_purchase_id),
    KEY idx_user_status (user_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS purchase_suppliers (
    id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NOT NULL,
    need_id     BIGINT UNSIGNED NOT NULL,
    name        VARCHAR(120) NOT NULL,
    platform    VARCHAR(20) NULL,
    price       DECIMAL(10,2) NULL,
    image_ref   TEXT NULL,
    pros        TEXT NULL,
    cons        TEXT NULL,
    note        TEXT NULL,
    scores      JSON NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_need (need_id),
    CONSTRAINT fk_supplier_need FOREIGN KEY (need_id) REFERENCES purchase_needs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS purchase_orders (
    id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id            INT UNSIGNED NOT NULL,
    need_id            BIGINT UNSIGNED NOT NULL,
    supplier_id        BIGINT UNSIGNED NULL,
    role               VARCHAR(8) NOT NULL DEFAULT 'formal',
    qty                INT NOT NULL DEFAULT 1,
    price_paid         DECIMAL(10,2) NOT NULL DEFAULT 0,
    status             VARCHAR(10) NOT NULL DEFAULT '待下单',
    installments       INT NOT NULL DEFAULT 0,
    installment_amount DECIMAL(10,2) NULL,
    installment_start  VARCHAR(10) NULL,
    installment_paid   INT NOT NULL DEFAULT 0,
    date_ms            BIGINT NULL,
    image_ref          TEXT NULL,
    note               TEXT NULL,
    is_quick           TINYINT NOT NULL DEFAULT 0,
    created_at_text    VARCHAR(30) NULL,
    approved_at        VARCHAR(30) NULL,
    ordered_at         VARCHAR(30) NULL,
    arrived_at         VARCHAR(30) NULL,
    archived_at        VARCHAR(30) NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_need (need_id),
    KEY idx_user_status (user_id, status),
    CONSTRAINT fk_order_need FOREIGN KEY (need_id) REFERENCES purchase_needs(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // 幂等标记（schema_version 单行）
  `CREATE TABLE IF NOT EXISTS schema_meta (
    k VARCHAR(64) PRIMARY KEY,
    v VARCHAR(200) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
];

function parseBudget(text) {
  const s = String(text || '').trim();
  if (!s) return [null, null];
  const m = /^(\d+(?:\.\d+)?)\s*[-~～—]\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    return [Math.min(a, b), Math.max(a, b)];
  }
  const n = Number(s);
  if (Number.isFinite(n)) return [n, n];
  return [null, null];
}

// 旧状态 → need.status / order.status / 是否建正式单
function mapStatus(old) {
  switch (old) {
    case '待评估': return { need: '对比中', order: null, createOrder: false };
    case '待审批':
    case '已审批': return { need: '已定点', order: '待下单', createOrder: true };
    case '已归档': return { need: '已完成', order: '已归档', createOrder: true };
    case '已取消': return { need: '已取消', order: '已取消', createOrder: true };
    default: // 已下单/已到/已退
      return { need: '已定点', order: old, createOrder: true };
  }
}

async function forwardMigrate() {
  for (const sql of DDL) await db.exec(sql);
  try {
    const [cols] = await db.pool.query("SHOW COLUMNS FROM purchases LIKE 'ext_id'");
    if (!cols.length) await db.exec('ALTER TABLE purchases ADD COLUMN ext_id VARCHAR(40) NULL');
  } catch (e) { log('ext_id 检查:', e.message); }

  const olds = await db.query('SELECT * FROM purchases ORDER BY id');
  const pending = [];
  for (const p of olds) {
    const done = await db.one('SELECT id FROM purchase_needs WHERE legacy_purchase_id = ?', [p.id]);
    if (!done) pending.push(p);
  }
  const marked = await db.one('SELECT v FROM schema_meta WHERE k = ?', ['purchase_needs_migrated']);
  log(`旧记录 ${olds.length} 条，待迁移 ${pending.length} 条${marked ? '（已有标记）' : ''}${DRY ? ' [DRY]' : ''}`);
  if (!pending.length) { log('已是最新'); return; }

  if (DRY) {
    for (const p of pending) {
      const m = mapStatus(p.status);
      log(`  #${p.id} ${p.name} [${p.status}] → need=${m.need} order=${m.order || '（无）'}`);
    }
    return;
  }

  let migrated = 0, todosRemapped = 0;
  for (const p of pending) {
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const m = mapStatus(p.status);
      const [bmin, bmax] = parseBudget(p.budget_range);
      const img = p.image_ref || '';
      const isStageImg = img.startsWith('{');
      const orderImg = isStageImg ? img : '';
      const supImg = (!isStageImg && img) ? img : '';

      const dims = JSON.stringify([
        { key: 'price', label: '价格', weight: 3 }, { key: 'feature', label: '功能', weight: 2 },
        { key: 'design', label: '颜值', weight: 1 }, { key: 'quality', label: '质量口碑', weight: 2 },
        { key: 'service', label: '售后', weight: 1 }]);

      const [nins] = await conn.query(
        `INSERT INTO purchase_needs
           (user_id,name,category,budget_min,budget_max,status,dimensions,project_id,phase_idx,
            is_virtual,is_quick,buy_reason,eval_summary,cancel_reason,ext_id,legacy_purchase_id,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [p.user_id, p.name, p.category || '其他', bmin, bmax, m.need, dims,
          p.project_id || null, p.phase_idx == null ? null : Number(p.phase_idx),
          p.is_virtual ? 1 : 0, p.is_quick ? 1 : 0,
          p.buy_reason || '', p.eval_summary || '',
          p.cancel_reason || '', p.ext_id || null, p.id,
          p.created_at || undefined]);
      const needId = nins.insertId;

      // 供应商 1 行（旧数据全部 1 需求 1 供应商）
      const [sins] = await conn.query(
        `INSERT INTO purchase_suppliers (user_id,need_id,name,platform,price,image_ref,scores,sort_order)
         VALUES (?,?,?,?,?,?,'{}',0)`,
        [p.user_id, needId, p.name, p.platform || '', Number(p.price) || 0, supImg]);
      const supplierId = sins.insertId;

      // 正式单（待评估不建）
      let orderId = null;
      if (m.createOrder) {
        // 已审批标记：approved_at 保留（兼容层显示「已审批」用）
        const approvedAt = (p.status === '已审批' || p.status === '已下单' || p.status === '已到' ||
          p.status === '已退' || p.status === '已归档') ? (p.approved_at || p.created_at_text || null) : null;
        const [oins] = await conn.query(
          `INSERT INTO purchase_orders
             (user_id,need_id,supplier_id,role,qty,price_paid,status,installments,installment_amount,
              installment_start,installment_paid,date_ms,image_ref,note,is_quick,
              created_at_text,approved_at,ordered_at,arrived_at,archived_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [p.user_id, needId, supplierId, 'formal', p.qty || 1, Number(p.price) || 0, m.order,
            p.installments || 0, p.installment_amount, p.installment_start, p.installment_paid || 0,
            p.date_ms, orderImg, p.note || '', p.is_quick ? 1 : 0,
            p.created_at_text, approvedAt, p.ordered_at, p.arrived_at, p.archived_at]);
        orderId = oins.insertId;
        if (m.order === '待下单') {
          // 待审批 vs 已审批：approved_at 非空即已审批（兼容层 stepper 区分）
        }
      }
      // 定点：need.selected_supplier_id 全部指向迁移生成的 supplier（待评估除外）
      if (m.need !== '对比中') {
        await conn.query('UPDATE purchase_needs SET selected_supplier_id = ?, decided_at = ? WHERE id = ?',
          [supplierId, p.created_at || undefined, needId]);
      }

      // 待办 link_id 重映射：rec_<oldId> → rec_<needId>（link_type='采购' 保留）
      const [td] = await conn.query(
        "UPDATE todos SET link_id = ? WHERE link_type = '采购' AND link_id = ?",
        ['rec_' + needId, 'rec_' + p.id]);
      todosRemapped += td.affectedRows || 0;

      await conn.commit();
      migrated++;
    } catch (e) {
      try { await conn.rollback(); } catch (x) {}
      console.error(`迁移 #${p.id} 失败:`, e.message);
      throw e;
    } finally { conn.release(); }
  }

  await db.exec('INSERT INTO schema_meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
    ['purchase_needs_migrated', new Date().toISOString()]);
  log(`完成：迁移 ${migrated} 条，待办重映射 ${todosRemapped} 条。purchases 已冻结为备份。`);
}

// ===== 反向：把 1:1:1 结构压回 purchases（回滚兜底）=====
// 仅处理 legacy_purchase_id 非空的 need（迁移来的）；新流程产生的多供应商需求跳过并告警。
async function reverseMigrate() {
  const needs = await db.query('SELECT * FROM purchase_needs WHERE legacy_purchase_id IS NOT NULL ORDER BY legacy_purchase_id');
  log(`反向候选 need ${needs.length} 条${DRY ? ' [DRY]' : ''}`);
  let updated = 0, skipped = 0;
  for (const n of needs) {
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [sups] = await conn.query('SELECT * FROM purchase_suppliers WHERE need_id = ? ORDER BY id', [n.id]);
      const [ords] = await conn.query("SELECT * FROM purchase_orders WHERE need_id = ? AND role = 'formal' ORDER BY id DESC", [n.id]);
      if (sups.length > 1 || ords.length > 1) { skipped++; await conn.rollback(); continue; }
      const s = sups[0] || null, o = ords[0] || null;
      // need 状态回旧状态
      let oldStatus;
      if (n.status === '已取消') oldStatus = '已取消';
      else if (n.status === '已完成') oldStatus = '已归档';
      else if (!o) oldStatus = '待评估';
      else if (o.status === '待下单') oldStatus = o.approved_at ? '已审批' : '待审批';
      else oldStatus = o.status;
      const budgetRange = (n.budget_min == null && n.budget_max == null) ? null
        : (n.budget_min != null && n.budget_max != null ? Number(n.budget_min) + '-' + Number(n.budget_max)
          : String(Number(n.budget_min != null ? n.budget_min : n.budget_max)));
      const img = (o && o.image_ref) || (s && s.image_ref) || null;
      if (DRY) {
        log(`  #${n.legacy_purchase_id} ${n.name} → [${oldStatus}]`);
        await conn.rollback();
      } else {
        await conn.query(
          `UPDATE purchases SET name=?, category=?, price=?, qty=?, status=?, date_ms=?, note=?,
             image_ref=?, budget_range=?, cancel_reason=?, installments=?, installment_amount=?,
             installment_start=?, installment_paid=?, is_quick=?, is_virtual=?, project_id=?, phase_idx=?,
             ext_id=COALESCE(ext_id, ?), approved_at=?, ordered_at=?, arrived_at=?, archived_at=?
           WHERE id = ? AND user_id = ?`,
          [n.name, n.category || '其他',
            o ? Number(o.price_paid) || 0 : (s && s.price != null ? Number(s.price) : 0),
            o ? o.qty : 1, oldStatus, o ? o.date_ms : null, (o && o.note) || '',
            img, budgetRange, n.cancel_reason || '',
            o ? o.installments : 0, o ? o.installment_amount : null,
            o ? o.installment_start : null, o ? o.installment_paid || 0 : 0,
            n.is_quick ? 1 : 0, n.is_virtual ? 1 : 0, n.project_id || null,
            n.phase_idx == null ? null : Number(n.phase_idx),
            n.ext_id || null, (o && o.approved_at) || null, (o && o.ordered_at) || null,
            (o && o.arrived_at) || null, (o && o.archived_at) || null,
            n.legacy_purchase_id, n.user_id]);
        // 待办 link_id 还原
        await conn.query("UPDATE todos SET link_id = ? WHERE link_type = '采购' AND link_id = ?",
          ['rec_' + n.legacy_purchase_id, 'rec_' + n.id]);
        await conn.commit();
      }
      updated++;
    } catch (e) {
      try { await conn.rollback(); } catch (x) {}
      console.error(`反向 #${n.legacy_purchase_id} 失败:`, e.message);
      throw e;
    } finally { conn.release(); }
  }
  log(`反向完成：写回 ${updated} 条，跳过非 1:1:1 ${skipped} 条。注意：反向只回写 purchases，不删三表。`);
}

(async () => {
  try {
    if (REVERSE) await reverseMigrate();
    else await forwardMigrate();
    process.exit(0);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exit(1);
  }
})();
