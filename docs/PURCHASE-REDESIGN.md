# 采购模块重构设计（两级模型：需求 → 供应商 → 子采购单）

> 状态：定稿待实现 · 2026-11-09
> 决策记录：旧「选东西→预算→提交」单层流程**整体废弃**；必须保留快速采购；试用可选；打分维度预置+可自定义。

## 1. 背景与目标

现有采购是单层模型：一张 `purchases` 表一行 = 一个商品，同时承担「需求」「对比决策」「订单执行」三种语义。选品类、选预算、直接提交，无法表达「想买香氛机 → 对比小米/公牛/杂牌 → 可选买回来试 → 定点 → 正式采购」的真实决策过程。

**目标**：改为三级结构，把决策层（供应商对比、打分）与执行层（真实下单记账）彻底分开；旧模块废弃；统计口径全站统一。

```
①提交需求 → ②选择供应商 → ③下单试用(可选) → ④定点供应商 → ⑤正式采购
```

三条路径：

| 路径 | 适用 | 流程 |
|---|---|---|
| **快速采购** | 已想好买什么（≤¥50 免审） | 独立弹窗一次提交 → 底层原子生成 需求+1供应商+1正式单(已到)，对比/试用 UI 自动折叠 |
| **单供应商** | 已想好买哪家、金额不限 | 需求 + 1 供应商 → 自动定点 → 正式采购（无对比矩阵） |
| **多供应商** | 需要对比 | 需求 + N 供应商 → 对比矩阵打分 → 可选试用 → 定点 → 正式采购（试用单转正或新建） |

## 2. 数据模型

三张新表（`schema.sql`），废弃 `purchases` 单层语义（迁移后视作历史，最终删除或保留只读备份，见 §7）。

### 2.1 `purchase_needs` 采购需求（父 · 决策容器）

```sql
CREATE TABLE purchase_needs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,              -- 想买什么
  category VARCHAR(30) NULL,               -- 分类
  budget_min DECIMAL(10,2) NULL,           -- 预算区间下限
  budget_max DECIMAL(10,2) NULL,           -- 预算区间上限
  status VARCHAR(10) NOT NULL DEFAULT '对比中',  -- 对比中|已定点|已完成|已取消
  dimensions JSON NULL,                    -- [{key,label,weight}] 默认五维
  selected_supplier_id BIGINT UNSIGNED NULL,    -- 定点的供应商
  project_id BIGINT UNSIGNED NULL,         -- 项目关联上移到需求级
  phase_idx TINYINT NULL,                  -- P0~P5
  is_virtual TINYINT NOT NULL DEFAULT 0,   -- 虚拟商品（商品属性）
  is_quick TINYINT NOT NULL DEFAULT 0,     -- 快速采购生成
  cancel_reason VARCHAR(200) NULL,
  decided_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- **提交需求必填**：`name` / `category` / `budget_min` / `budget_max`。不含「为什么想买」「AI 评估摘要」（`buy_reason` / `eval_summary` 移出流程，AI 比价未来作为对比表可选增强）。
- 默认维度（`dimensions` 缺省值）：
  `[{key:'price',label:'价格',weight:3},{key:'feature',label:'功能',weight:2},{key:'design',label:'颜值',weight:1},{key:'quality',label:'质量口碑',weight:2},{key:'service',label:'售后',weight:1}]`
  可增删改（key/label/weight），打分 1-5，加权总分 = Σ(score×weight)/Σ(weight)。

### 2.2 `purchase_suppliers` 供应商（对比层 · **永不入账**）

```sql
CREATE TABLE purchase_suppliers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  need_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,              -- 谁：品牌/店家
  platform VARCHAR(20) NULL,               -- 拼多多|淘宝|京东|抖音|其他
  price DECIMAL(10,2) NULL,                -- 报价（对比表显示；与实付分离）
  image_ref TEXT NULL,                     -- 供应商图片（kv:key 或 base64）
  pros TEXT NULL,                          -- 优点（可选）
  cons TEXT NULL,                          -- 缺点（可选）
  note TEXT NULL,                          -- 备注
  scores JSON NULL,                        -- {dimKey: 1..5}
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_need (need_id),
  CONSTRAINT fk_supplier_need FOREIGN KEY (need_id) REFERENCES purchase_needs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.3 `purchase_orders` 子采购单（执行层 · **唯一记账单元**）

```sql
CREATE TABLE purchase_orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  need_id BIGINT UNSIGNED NOT NULL,
  supplier_id BIGINT UNSIGNED NULL,        -- 关联供应商（转正/试用回溯）
  role VARCHAR(8) NOT NULL DEFAULT 'formal',   -- trial|formal
  qty INT NOT NULL DEFAULT 1,
  price_paid DECIMAL(10,2) NOT NULL DEFAULT 0, -- 实付（默认继承报价，允许改）
  status VARCHAR(10) NOT NULL DEFAULT '待下单',
      -- 待下单|已下单|已到|已退|已归档|已取消   （无待评估/待审批/已审批）
  installments INT NOT NULL DEFAULT 0,
  installment_amount DECIMAL(10,2) NULL,
  installment_start VARCHAR(10) NULL,      -- YYYY-MM
  installment_paid INT NOT NULL DEFAULT 0,
  date_ms BIGINT NULL,                     -- 购买日期（毫秒）
  image_ref TEXT NULL,                     -- 阶段图 JSON {状态:kv:key}（沿用）
  note TEXT NULL,
  is_quick TINYINT NOT NULL DEFAULT 0,
  created_at_text VARCHAR(30) NULL,        -- 生命周期时间（沿用文本方案，PATCH 更新）
  ordered_at VARCHAR(30) NULL,
  arrived_at VARCHAR(30) NULL,
  archived_at VARCHAR(30) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_need (need_id),
  KEY idx_user_status (user_id, status),
  CONSTRAINT fk_order_need FOREIGN KEY (need_id) REFERENCES purchase_needs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- 一需求最多 **1 张 `role='formal'`**（应用层事务保证）；`trial` 0..N。
- 试用与正式共用同一状态机与记账规则。

### 2.4 层级字段归属速查（旧字段迁移映射）

| 旧 `purchases` 列 | 新归属 |
|---|---|
| name, category, budget_range(拆 min/max), buy_reason*, eval_summary*, is_virtual, project_id, phase_idx, cancel_reason* | **need**（*仅迁移留存，不进新流程） |
| platform, price→supplier.price, image_ref(部分) | **supplier** |
| price→order.price_paid, qty, status*, date_ms, note, installments×4, is_quick, 各时间戳, image_ref(阶段图) | **order**（*状态映射见 §7） |

### 2.5 状态机

**需求（need.status）**

```
对比中 ──定点──> 已定点 ──正式单归档──> 已完成
   │               │
   └──取消──> 已取消 <──取消（正式单未下单前）──┘
```

- `已定点` 可回退 `对比中`：条件 = 正式单不存在或状态仍为 `待下单`；正式单已下单则锁死。
- 正式单到 `已归档` → 需求自动 `已完成`；需求 `已取消` → 未归档子单批量 `已取消`（事务）。

**子单（order.status）**——试用/正式/快速共用：

```
待下单 ─> 已下单 ─> 已到 ─> 已归档
              │        │
              └> 已退 ──┘（已退可归档）
任意未终态 ─> 已取消
```

- 砍掉 `待审批/已审批`（已无任何待办副作用，形同虚设）。
- 快速采购创建即 `已到`（保留免审语义）。
- 时间戳由服务端在状态迁移时写入（`ordered_at/arrived_at/archived_at`）。

### 2.6 记账口径（全站唯一规则）

| 计入预算 / 周报月报 / 项目花费 / 分类平台统计 | 不计入 |
|---|---|
| 任何子单 `已下单 / 已到 / 已归档` | 需求、供应商、打分（**永不**） |
| | 子单 `待下单 / 已退 / 已取消` |

- 试用期多张子单同时计钱（真实支出）；退货后按状态自动扣回。
- 分期事件只对 `已下单/已到/已归档` 且 `installments>1` 的子单生成（沿用，试用/正式均可有分期，实际只会出现在正式单）。
- 现存三处不一致（前端预算含`已审批`、服务端报告只认 `已下单起`、项目花费只排除 `已退/已取消`）**全部收敛到本规则**。
- 计算单元改为读 `purchase_orders`，金额 = `price_paid × qty`。

### 2.7 定点与正式采购规则

```
定点：need.selected_supplier_id = <供应商>，need.status=已定点（事务）
正式采购（二选一，UI 根据情况给按钮）：
  A. 试用单转正：胜出者存在 status∈{已下单,已到} 的 trial 单
     → role=trial 改 formal（不新建、不重复计钱；实付保留）
  B. 新建正式单：无试用单 或 试用单已退/已取消
     → 从供应商报价生成 formal 单（qty/实付/分期/日期 在表单确认）
落选处理：其它 trial 单 → 已退（UI 引导，批量）；未试用供应商仅淘汰标记（无单可动）
```

- 定点时 UI 默认预选加权总分最高者。
- 回退定点见 §2.5。

## 3. API 设计（`server/src/routes/needs.js`）

挂载：`server/src/index.js`；CF `functions/api/needs.js` 走 `proxyToServer`（MySQL 模式反代，照抄 `items.js` 模式）。旧 `/api/items` 迁移期保留只读兼容（见 §7），新写入全部走 needs。

| 端点 | 说明 |
|---|---|
| `GET /api/needs` | 聚合返回：needs[] 内嵌 `suppliers[]`、`orders[]`（照抄 `GET /api/projects` 一次性拉齐模式，`projects.js:49-135`） |
| `POST /api/needs` | 创建需求（name/category/budget/project/phase/is_virtual/dimensions 可选覆盖默认） |
| `PUT /api/needs/:id` | 更新需求信息/维度定义（已定点后维度不可改，打分保留） |
| `DELETE /api/needs/:id` | 级联删供应商+子单；解绑待办；`project_id` 花费自动回落 |
| `POST /api/needs/:id/suppliers` / `PUT` / `DELETE` | 供应商 CRUD；删除被定点者拒绝 |
| `PUT /api/suppliers/:id/scores` | 批量保存打分 `{scores:{dimKey:1..5}}` |
| `POST /api/needs/:id/orders` | 建子单 `{supplierId, role, qty, pricePaid, installments...}` |
| `PUT /api/orders/:id` | 改实付/数量/分期/备注/图片/日期 |
| `POST /api/orders/:id/transition` | 状态迁移 `{to}`，服务端**校验合法性**（本表第一次有流转校验），写时间戳 |
| `POST /api/needs/:id/decide` | 定点 `{supplierId, mode:'new'\|'promote', ...}` 事务：定标记+建/转正式单+回退保护 |
| `POST /api/needs/:id/undecided` | 回退定点（守卫检查） |
| `POST /api/needs/:id/cancel` | 需求取消（原因），级联未终态子单 |
| `POST /api/needs/quick` | **快速采购一键端点**：事务内 need+supplier+order(formal, 已到, is_quick)；保留 ≤¥50 校验 |
| `PATCH /api/orders/batch` | 批量状态（试用落选批量已退/批量归档），≤500 |

校验：名称 ≤200、price 0..9999999、qty 1..9999、分数 1..5 整数、dimensions ≤20 个、weight 1..9、projectId 属主、状态白名单+流转合法性。`op_logs` 记录定点/取消/状态迁移。

## 4. 前端 UI（采购 tab 重做）

### 4.1 列表
- 需求卡片：名称、预算区间、状态徽章（对比中/已定点/已完成/已取消）、胜出者（或最高分供应商+总分）、子单状态摘要（如「试用 2 · 已到 1」）、项目/分期信息（挂在正式单）、快速徽章。
- 筛选 chips：`全部/对比中/已定点/已完成/已取消`（原 8 状态 chips 废弃）。
- 搜索沿用（名称/供应商名）。
- **废弃**：右滑改状态（`setupSwipe` 对需求无意义）、批量改状态入口。

### 4.2 需求详情（核心页，三段）
1. **对比段**：
   - 矩阵视图（可横滑，移动端先例：统计表格横滑）：行 = 维度 + 报价 + 优缺点；列 = 供应商，列头显示头像/名/加权总分并可按总分排序。
   - 卡片视图：每供应商一张卡（图、报价、维度打分 1-5 点选、优缺点、总分条）。
   - 维度编辑入口（加/删/改权重）。
2. **试用段**（可选）：每供应商「下单试用」按钮 → 建 trial 单；trial 卡片带状态 stepper（复用现有 `openDetailModal` stepper 交互），推进走 `transition`。
3. **定点/正式段**：
   - 已定点前：显示「定点为胜出者」（默认勾最高分）→ 确认。
   - 定点后：若可转正显示「试用单转正」，否则「正式采购」表单（qty/实付默认报价/分期/日期）。
   - 正式单状态 stepper、归档/退货/取消。

### 4.3 新建入口
- FAB → **需求表单**（名称/分类/预算 min/max，+项目/阶段）→ 保存进详情页继续加供应商。
- 供应商循环录入（谁/平台/报价/图/优缺点/备注）；**1 个供应商时对比段折叠、直达定点确认**。
- 快速 FAB → **原 `#quickOverlay` 弹窗字段与校验完全不动**，`saveQuickPurchase` 改调 `/api/needs/quick`；详情页因单供应商+已定点自动折叠对比/试用段。

### 4.4 废弃清单
- 两段式评估：`#evalPhase`/`#evalOverlay`、`openEvalModal/renderEvalModal/cancelFromEval/submitEvalToDetail/runPurchaseEval/submitEvaluation`（ai.js 评估流程保留 `functions/api/ai.js` 不动，仅采购入口删除）
- `#detailPhase` 旧采购详情表单、`#editPhase` 旧编辑（被需求/供应商/子单编辑替代）
- ¥50 极速弹窗**保留**；旧单层 stepper/滑动/批量/`待评估` 分支删除
- 预算/统计中对待评估、已取消的特判改为新口径（§2.6）

## 5. 统计/预算/项目改造点

| 位置 | 改动 |
|---|---|
| `js/api.js:360-401` `getDirectPurchaseSpend/getBudgetPool` | 数据源改子单；口径 §2.6 |
| `js/app.js:533-539` 分期月分摊 | 读子单 |
| `js/stats.js` 分类/平台/状态分布/区间小结 | 读子单；状态分布改需求状态 |
| `server/src/routes/report.js` `ACTIVE_BUY` | 语义不变，数据源换子单（`已下单/已到/已归档` 与现口径天然一致） |
| `server/src/routes/projects.js:59-63,117-124` | 花费/账本改聚合子单（排除 待下单/已退/已取消），需求名展示 |
| `server/scripts/notify-todos.js` 分期/采购统计 | 读子单 |
| 待办 `link_type='采购' link_id` | 迁移重映射为 `need_id`；卡片按 need 解析（todomodule.js:1220-1256） |
| `functions/api/push/archive-check.js` | 改读 MySQL 子单（顺带解决飞书副本滞后） |
| MCP（独立仓 purchase-app-mcp） | **PR-C 已验证：零改动可用**——`purchase.list/get/update` 走 `/api/items` 完容层，`mapPurchase` 读的 27 个中文键与 `rowToItem` 输出逐键一致（diff 空）；`npm test`（mock e2e）全过。need/supplier 新工具后续迭代 |

## 6. 快速采购（保留 · 底层换血）

- **UI 零改动**：入口 FAB、弹窗字段（名称*/金额*/数量/平台/分类/项目/阶段/日期/备注/虚拟）、¥50 限制、云平台联动，全部原样。
- **`saveQuickPurchase`**（`js/items.js:314-342`）改调 `POST /api/needs/quick`，单事务生成：
  - need：`is_quick=1`、`status=已定点`、`budget=金额~金额`、`selected_supplier_id` 回填、项目/阶段挂 need；
  - supplier：`name=商品名`、`platform`、`price=金额`；
  - order：`role=formal`、`status=已到`、`price_paid=金额`、`qty`、`date_ms`、`is_quick=1`、`arrived_at=now`。
- 列表显示极速徽章；详情因单供应商+已定点自动折叠对比/试用段 → 直接看到正式单 stepper（已到 → 归档/退货），与现状观感一致。
- 计钱规则不变（创建即 `已到`，立即入账）。

## 7. 迁移与兼容

**迁移脚本** `server/scripts/migrate-purchase-needs.js`（单事务，可重入/幂等）：

1. 建三表（IF NOT EXISTS）。
2. 对每条旧 `purchases` 行（含 `ext_id` 生产列先核对）：
   - → need：name/category/budget 拆列/buy_reason/eval_summary 留存/is_virtual/project_id/phase_idx/cancel_reason；`decided_at` 空。
   - → supplier 1 行：`name` 取商品名、`platform`、`price`（原 price）、`image_ref` 取旧图（非阶段图部分）。
   - → order 1 行：`role=formal`、qty、`price_paid=price`、分期四件套、date_ms、note、阶段图 image_ref、各时间戳、is_quick。
   - **状态映射**：

| 旧状态 | need.status | order.status |
|---|---|---|
| 待评估 | 对比中 | （无正式单；有报价则建 supplier only） |
| 待审批 / 已审批 | 已定点 | 待下单 |
| 已下单 / 已到 / 已退 / 已归档 | 已定点（归档→已完成） | 原样 |
| 已取消 | 已取消 | 已取消 |

   - `selected_supplier_id` 指向迁移生成的 supplier；旧数据全部「1 需求 1 供应商 1 正式单」。
3. 待办 `link_id='rec_<oldId>'` → 新 need id（保留 link_type='采购'，need 名称=旧商品名，解析兼容）。
4. 迁移后打 `schema_version` 标记（新表存 meta），重跑安全。

**兼容期**：
- `/api/items` 为**完全兼容层**（PR-A 最终实现，替代原 410 方案——CF Pages 合并自动发版与 server 手动部署存在时序窗口，410 会让旧前端/MCP 在窗口内全挂）：GET 从新结构合成旧形态（`rowToItem` 中文键），POST/PUT/PATCH/DELETE 经 `legacyToOrderStatus`/`legacyToNeedStatus` 映射写入三表，行为与旧 API 等价。回滚策略：三表数据保留，切回旧代码时跑反向脚本把「1:1:1」结构压回 purchases 行（`--reverse`，脚本一并写）。
- CF 飞书 `items.js` 写路径随迁移停用；`functions/api/ai.js` 评估入口保留（不再从采购流程触达）。
- 生产库先跑 `SHOW COLUMNS FROM purchases` 核对 `ext_id` 等 schema.sql 未记录列，再执行迁移。

## 8. 交付节奏（一次上线，三个 PR 依序合入）

1. **PR-A 模型+后端**：schema、迁移脚本+反向脚本、`needs.js` 全部路由+CF 反代、`report/projects/budget 相关服务端`改读子单、单测（状态机/定点事务/口径）。
2. **PR-B 前端**：需求列表/详情/矩阵/打分/试用/定点/正式/快速接线、废弃清单执行、预算统计前端切口径、sync-ui、`npm run check:sync`。
3. **PR-C 收尾**：MCP 对接、help.html、archive-check/notify 口径、CHANGELOG（版本 3.0.40 / purchase-cache-v162 起）、旧评估文档清理。

合并即 CF Pages 发版。**回滚**：revert 三连（数据迁移有反向脚本兜底）；server 需同步回滚路由并跑反向迁移。

## 9. 验收清单（手机 PWA）

1. 快速采购：原弹窗提交 → 单供应商+已定点+已到、徽章正常、立即入账。
2. 单供应商普通路径：4 字段建需求 → 1 供应商 → 自动直达定点确认 → 正式采购入账。
3. 多供应商：3 家录入 → 矩阵横滑对比、维度增删改权重、打分排序。
4. 试用可选：给 2 家建试用单推进状态 → 定点 → 胜出转正、落选批量已退、账目净额正确。
5. 纸面定点（不试用）：直接定点新建正式单。
6. 定点回退（正式单未下单）生效；下单后锁死。
7. 预算/统计/项目花费 = 子单口径，与周报月报一致；供应商报价不入账。
8. 旧数据迁移后：状态、分期、项目关联、待办关联、阶段图完好。
9. 深色/减动效/横滑矩阵可用。
