-- 个人管家 MySQL Schema（迁移方案 §3，2026-10-16）
-- 库：purchase_app（utf8mb4）；列↔前端中文 JSON 键映射见行尾注释
-- API 层（/opt/purchase-server）负责 DB 列 ↔ Bitable 风格中文 JSON 的双向映射

CREATE DATABASE IF NOT EXISTS purchase_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE purchase_app;

-- ===== 用户 =====
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50) NOT NULL UNIQUE,
  password_hash CHAR(64) NOT NULL,                -- v1=SHA256(salt+pwd) / v2=PBKDF2-SHA256-100k
  salt          CHAR(32) NOT NULL,
  hash_version  TINYINT NOT NULL DEFAULT 1,
  is_admin      TINYINT NOT NULL DEFAULT 0,
  invite_code   VARCHAR(40) NULL,
  invite_type   VARCHAR(10) NULL,                 -- env|dynamic
  feishu_app_id     VARCHAR(64) NULL,             -- 灾备同步凭证（注册用户独立 App）
  feishu_app_secret VARCHAR(128) NULL,
  bitable_json  JSON NULL,                        -- {purchaseApp,purchaseTable,...} 飞书灾备定位
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ===== 刷新令牌（存 sha256(token)，与原 KV raw-key 等效但更安全）=====
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked    TINYINT NOT NULL DEFAULT 0,
  KEY idx_user (user_id),
  KEY idx_exp (expires_at)
) ENGINE=InnoDB;

-- ===== 采购记录 =====  ← 商品名称/平台/分类/单价/数量/状态/日期/备注/图片
CREATE TABLE IF NOT EXISTS purchases (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id            INT UNSIGNED NOT NULL,
  name               VARCHAR(200) NOT NULL,       -- 商品名称
  platform           VARCHAR(20) NULL,            -- 平台
  category           VARCHAR(30) NULL,            -- 分类
  price              DECIMAL(10,2) NOT NULL DEFAULT 0,   -- 单价
  qty                INT NOT NULL DEFAULT 1,      -- 数量
  status             VARCHAR(10) NOT NULL DEFAULT '待审批', -- 待审批/已审批/已下单/已到/已退/已归档
  date_ms            BIGINT NULL,                 -- 日期（毫秒时间戳）
  note               TEXT NULL,                   -- 备注
  image_ref          TEXT NULL,                   -- 图片（kv:key 或阶段图 JSON）
  created_at_text    VARCHAR(30) NULL,            -- 创建时间（原样保留文本）
  approved_at        VARCHAR(30) NULL,            -- 审批时间
  ordered_at         VARCHAR(30) NULL,            -- 下单时间
  arrived_at         VARCHAR(30) NULL,            -- 到货时间
  archived_at        VARCHAR(30) NULL,            -- 归档时间
  eval_summary       TEXT NULL,                   -- 评估摘要（AI）
  buy_reason         TEXT NULL,                   -- 购买理由
  budget_range       VARCHAR(50) NULL,            -- 预算区间
  cancel_reason      VARCHAR(200) NULL,           -- 取消原因
  installments       INT NOT NULL DEFAULT 0,      -- 分期期数（0=非分期）
  installment_amount DECIMAL(10,2) NULL,          -- 分期金额
  installment_start  VARCHAR(10) NULL,            -- 分期开始月 'YYYY-MM'
  installment_paid   INT NOT NULL DEFAULT 0,      -- 分期已还
  is_quick           TINYINT NOT NULL DEFAULT 0,  -- 极速==='1' → 极速免审
  is_virtual         TINYINT NOT NULL DEFAULT 0,  -- 虚拟商品（API/服务器/会员等，无需物流）
  project_id         BIGINT UNSIGNED NULL,        -- 关联项目（项目花费聚合）
  phase_idx          TINYINT NULL,                -- 关联项目阶段 P0~P5
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_date (user_id, date_ms),
  KEY idx_user_status (user_id, status)
) ENGINE=InnoDB;

-- ===== 记账记录 =====  ← 类型/金额/分类/日期/备注/图片/分摊周数/分摊开始周
CREATE TABLE IF NOT EXISTS expenses (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED NOT NULL,
  type             VARCHAR(4) NOT NULL DEFAULT '支出',   -- 支出|收入
  amount           DECIMAL(10,2) NOT NULL DEFAULT 0,    -- 金额
  category         VARCHAR(30) NULL,                    -- 分类
  date_ms          BIGINT NULL,                         -- 日期（毫秒，精确时间）
  note             TEXT NULL,                           -- 备注
  image_ref        MEDIUMTEXT NULL,                 -- 图片（kv:key 或小图内联）
  split_weeks      INT NULL,                            -- 分摊周数（跨周分摊）
  split_start_week VARCHAR(10) NULL,                    -- 分摊开始周 'YYYY-MM'
  project_id       BIGINT UNSIGNED NULL,                -- 关联项目（项目花费聚合）
  phase_idx        TINYINT NULL,                        -- 关联项目阶段 P0~P5
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_date (user_id, date_ms)
) ENGINE=InnoDB;

-- ===== 待办 =====  ← 标题/描述/截止日期/优先级/分类/状态/重复/子任务/图片/关联类型/关联ID/完成时间/项目ID
CREATE TABLE IF NOT EXISTS todos (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  title        VARCHAR(300) NOT NULL,
  description  TEXT NULL,
  due_ms       BIGINT NULL,
  priority     VARCHAR(4) NULL DEFAULT '中',    -- 高|中|低
  category     VARCHAR(10) NULL DEFAULT '其他',
  status       VARCHAR(6) NOT NULL DEFAULT '待办', -- 待办|进行中|已完成|已取消
  `repeat`     VARCHAR(4) NOT NULL DEFAULT '无',   -- 无|每天|每周|每月
  subtasks     MEDIUMTEXT NULL,                   -- JSON 字符串原样存
  image_ref    MEDIUMTEXT NULL,
  link_type    VARCHAR(4) NULL DEFAULT '无',      -- 无|采购|记账
  link_id      VARCHAR(40) NULL,                  -- 关联记录 id（字符串）
  completed_ms BIGINT NULL,
  project_id   VARCHAR(40) NULL,                  -- 关联项目 id（字符串 rec_<id>）
  phase_idx    TINYINT NULL,                      -- 关联项目阶段 P0~P5
  tags         TEXT NULL,                         -- 标签（JSON 串）
  sort_no      INT NOT NULL DEFAULT 0,            -- 排序
  reminders    TEXT NULL,                         -- 提醒（JSON 串）
  due_iso      VARCHAR(60) NULL,                  -- 截止日期ISO
  notified_due_ms BIGINT NULL,                    -- 到期提醒已发送对应的 due_ms（去重）
  notify_morning_date DATE NULL,                  -- 早间摘要已发送日期
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_status (user_id, status),
  KEY idx_user_due (user_id, due_ms)
) ENGINE=InnoDB;

-- ===== 项目 =====  ← 名称/描述/截止日期/状态/颜色/进度
CREATE TABLE IF NOT EXISTS projects (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  name        VARCHAR(100) NOT NULL,
  description TEXT NULL,
  due_ms      BIGINT NULL,
  status      VARCHAR(6) NOT NULL DEFAULT '进行中',  -- 进行中|已完成|已归档
  color       VARCHAR(20) NULL,
  budget      DECIMAL(10,2) NULL,               -- 目标预算
  progress    INT NOT NULL DEFAULT 0,
  parent_id   VARCHAR(40) NULL,                  -- 父项目ID（旧数据只读）
  due_iso     VARCHAR(60) NULL,                  -- 截止日期ISO
  current_phase TINYINT NOT NULL DEFAULT 0,      -- 阶段指针 0~5
  legacy_flag   TINYINT NOT NULL DEFAULT 0,      -- 旧层级项目只读标记
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user (user_id, status)
) ENGINE=InnoDB;

-- ===== 单行 JSON 文档类 =====
CREATE TABLE IF NOT EXISTS budgets (         -- KV budget:{user}
  user_id    INT UNSIGNED PRIMARY KEY,
  data       JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recurring (       -- KV recurring:{user}
  user_id    INT UNSIGNED PRIMARY KEY,
  data       JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cats (            -- KV cats:{user} 自定义分类 {list:[{n,e}],icons:{...}}
  user_id    INT UNSIGNED PRIMARY KEY,
  data       JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS push_subs (       -- KV webpush:{user} APNs 订阅
  user_id    INT UNSIGNED PRIMARY KEY,
  endpoint   VARCHAR(512) NOT NULL,
  data       JSON NOT NULL,                  -- {subscription:...}
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reports (         -- KV report:latest:{user}
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  period       VARCHAR(20) NOT NULL,          -- '2026-W3'|'2026-09'
  rtype        VARCHAR(6) NOT NULL,           -- week|month
  data         JSON NOT NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id, generated_at)
) ENGINE=InnoDB;

-- ===== 图片元数据（文件在 /var/lib/purchase-app/images/{user_id}/{file_key}）=====
CREATE TABLE IF NOT EXISTS images (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  file_key   VARCHAR(80) NOT NULL UNIQUE,     -- {uuid}.{ext}
  filename   VARCHAR(200) NULL,
  mime       VARCHAR(60) NULL,
  size_bytes INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_user (user_id)
) ENGINE=InnoDB;

-- ===== 邀请码（替代 KV dynamic_invites 大数组）=====
CREATE TABLE IF NOT EXISTS invites (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(40) NOT NULL UNIQUE,
  created_by VARCHAR(50) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used       TINYINT NOT NULL DEFAULT 0,
  used_at    DATETIME NULL,
  used_by    VARCHAR(50) NULL
) ENGINE=InnoDB;

-- ===== 操作日志（替代 KV log:{date}:{ts}）=====
CREATE TABLE IF NOT EXISTS op_logs (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  log_date   DATE NOT NULL,
  username   VARCHAR(50) NULL,
  action     VARCHAR(30) NOT NULL,
  detail     TEXT NULL,
  ip         VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_date_user (log_date, username)
) ENGINE=InnoDB;

-- ===== 登录限流（替代 KV login_fail:{ip}）=====
CREATE TABLE IF NOT EXISTS login_fails (
  ip         VARCHAR(45) PRIMARY KEY,
  times      JSON NOT NULL,                   -- [ts...] 15 分钟窗口
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ===== P0~P5 阶段（PROJECT-PHASE-DESIGN）=====
CREATE TABLE IF NOT EXISTS project_phases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  phase_idx TINYINT NOT NULL,
  display_name VARCHAR(50) NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'todo',     -- todo|doing|done|skipped
  note TEXT NULL,
  planned_start_ms BIGINT NULL,                -- 规划开始
  planned_end_ms BIGINT NULL,                  -- 规划完成（里程碑日期）
  started_at_ms BIGINT NULL,                   -- 实际开始
  finished_at_ms BIGINT NULL,                  -- 实际完成
  UNIQUE KEY uq_project_phase (project_id, phase_idx),
  KEY idx_project (project_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS phase_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT UNSIGNED NOT NULL,
  phase_idx TINYINT NOT NULL,
  title VARCHAR(300) NOT NULL,
  done TINYINT NOT NULL DEFAULT 0,
  image_ref VARCHAR(500) NULL,
  note TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  completed_ms BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_project_phase (project_id, phase_idx)
) ENGINE=InnoDB;
