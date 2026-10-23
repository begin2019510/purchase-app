# 项目模块大改：P0~P5 阶段通关制（生活向）

> 前置：后端迁移方案见 `/root/purchase-app/docs/MIGRATION-PLAN.md`（定稿，暂不实施）。
> 本方案与迁移**一起落地**：新模型直接按 MySQL 设计，不在飞书上做过渡实现。
>
> **实现更新（v4.0.52，以此为准）**：通关改为「P5 完成 + P0~P4 全部完成/跳过」；完成/跳过时自动开始下一个未处理阶段，回退会撤回这次自动开始；重开任一前置阶段或回退 P5 时项目恢复「进行中」。完整状态变更在服务端单事务内完成。
>
> **v4.0.53 补充**：记账表单选择「项目 + 阶段」后真正随记录保存（此前 UI 有选择但提交被忽略）；完整采购表单新增项目/阶段选择并从项目快捷入口预选；关联采购/记账新增、修改、删除后项目花费与阶段明细即时刷新。阶段规划时间按浏览器本地日期保存。

---

## Context

项目模块现为扁平字段（名称/描述/截止/状态/颜色/进度%）+ 父子层级 + Todo 驱动进度，面向生活场景表达力不足。用户构想：**项目分为 P0~P5 六个固定阶段，可跳级，每阶段可选交付物（子项），走完即通关**。

与记账模块问题（历史月份不显示、全量刷新慢）、后端迁移（飞书→MySQL+服务器图片）一并改造。

### 已确认的决策

| 问题 | 决定 |
|------|------|
| 阶段命名 | UI 显示 P0~P5，每阶段可改自定义显示名（本质就是 6 个固定槽位） |
| 跳级进度 | 指针 + 跳过不计入分母；进度 = 已完成 ÷ 实际经历（非跳过） |
| 通关 | P5 完成且 P0~P4 全部完成/跳过 = 项目通关（状态→已完成，可归档） |
| 交付物 | 阶段下可选子项 0~n 个：标题 + 勾选 + 可选图片/备注；非必须 |
| 父子层级 | 旧层级**保留只读**（能看旧数据）；新项目/新交互不再创建父子 |
| Todo 关系 | Todo 独立管杂事；**项目仍可关联 Todo**（保留 projectId），但 Todo **不再自动改项目状态** |
| Todo 自动完成 | **废除**（checkProjectAutoStatus 不再改状态） |
| 阶段可逆性 | **完全可逆**：完成/跳过/指针均可来回改；回退会撤回本次自动开始的下一阶段 |
| 钱的关联 | 采购 + 记账记录挂 **项目 + 阶段**，项目详情显示「本项目花了多少」 |
| 落地时机 | 随 MySQL 迁移一起上线；飞书链路不动 |

---

## 1. 数据模型（MySQL）

```sql
projects (
  id BIGINT PK AUTO_INCREMENT,
  user_id INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  color VARCHAR(20) DEFAULT '#6366f1',
  due_date_ms BIGINT NULL,
  status ENUM('active','completed','archived') DEFAULT 'active',
  current_phase TINYINT DEFAULT 0,          -- 0~5 指针
  parent_id BIGINT NULL,                     -- 仅旧数据只读用；新写入一律 NULL
  legacy_flag TINYINT DEFAULT 0,             -- 1=旧层级项目（只读展示）
  created_at, updated_at
)

project_phases (
  id BIGINT PK,
  project_id BIGINT NOT NULL,
  phase_idx TINYINT NOT NULL,               -- 0~5
  display_name VARCHAR(50),                 -- NULL=显示默认 "P0".."P5"
  status ENUM('todo','doing','done','skipped') DEFAULT 'todo',
  note TEXT,
  started_at_ms, finished_at_ms,
  UNIQUE(project_id, phase_idx)
)

phase_items (                                -- 交付物子项
  id BIGINT PK,
  project_id BIGINT NOT NULL,
  phase_idx TINYINT NOT NULL,
  title VARCHAR(300) NOT NULL,
  done TINYINT DEFAULT 0,
  image_ref VARCHAR(500),                    -- 迁移后指向服务器图片
  note TEXT,
  sort_order INT DEFAULT 0,
  created_at, completed_at
)
```

**关联到项目/阶段（迁移时加列）：**

```sql
purchases:   ADD project_id BIGINT NULL, ADD phase_idx TINYINT NULL
expenses:    ADD project_id BIGINT NULL, ADD phase_idx TINYINT NULL
todos:       保留 project_id；ADD phase_idx TINYINT NULL（可选挂阶段）
```

旧字段 `progress` 不再存储（前端现算）；旧 `parentId` 仅 legacy 项目保留。

### 记账 / 采购挂项目的兼容
- `js` 侧新建采购/记账时可选「所属项目 → 所属阶段（可空）」
- 项目详情聚合：`SUM(单价*数量)`（采购）+ `SUM(金额)`（记账）按 project_id 过滤；可按 phase_idx 分组显示「各阶段花费」

---

## 2. 状态机与规则

```
阶段 status: todo → doing → done
              ↘ skipped（可撤销回 todo）
指针 current_phase: 0~5，可前后拖（完全可逆）

项目 status:
  active    —— 默认
  completed —— P5 done 且 P0~P4 全部 done/skipped 时自动设
  archived  —— completed 后可归档（沿用现有归档交互）

进度% = done 数 ÷ (6 - skipped 数)     // 若全 skipped 分母保护 ≥1
卡片显示：指针如 "P3 进行中" 或 "🏁 通关"，进度条用上式
```

- P5 完成前必须先把 P0~P4 标为 done 或 skipped；P5 不允许 skipped
- 完成/跳过某阶段时，指针落到其后第一个未处理阶段；若该阶段为 todo 则自动置为 doing
- 回退某阶段会清空该阶段实际时间，并撤回「由它完成时自动开始」的下一阶段
- 任一前置阶段被重新打开（todo/doing），或 P5 回退，项目自动恢复 active
- **不**再由 Todo 完成度驱动项目状态（`checkProjectAutoStatus` 保持 no-op）
- Todo 详情仍显示「所属项目」，项目详情仍列关联 Todo（保留）
- 每阶段子项勾选只更新该子项，**不**自动推进指针（推进靠用户点「完成本阶段」）

---

## 3. 交互设计（前端）

### 3.1 项目卡片（`js/project.js` renderProjectCard）
- 保留：名称/颜色/截止/筛选 chips（全部/进行中/已完成/已归档）
- 改：进度条 = 阶段进度（非 Todo%）；角标显示 `P{current_phase}` 或 🏁
- 父子缩进仅 `legacy_flag=1` 旧项目保留；新项目平铺

### 3.2 项目详情（openProjectDetail 重写）
```
[颜色] 项目名                          [✏️][📦归档][🗑️]
描述
━━ 阶段进度条 P0-P1-P2-P3-P4-P5 ━━（✓ ⏭ ▶ 样式）
当前阶段卡片：
  P2 · 自定义名「采购」  [进行中]
  备注…  子项清单：☐ A ☑ B  [+子项]
  花费：¥xxx（本阶段）
  [完成本阶段] [跳过] [←回退]
关联 Todo（原有列表，保留）
本项目总花费：采购 ¥x + 记账 ¥y
[✏️编辑]
```

- 点击进度条上任一阶段节点 → 展开该阶段详情（可改状态/子项）
- **新建项目**：仍用现有 modal（去掉父项目选择，或仅 legacy 无）；创建时后端自动插入 6 行 phase（全 todo）
- 编辑阶段显示名：详情里点 P 槽位旁 ✏️，inline 改 `display_name`

### 3.3 采购/记账表单
- 可选下拉「项目 → 阶段」（阶段列表来自当前指针附近的 6 槽，可全部）

---

## 4. 后端 API（CF Functions + 迁移后服务器）

新/改端点（迁移后在服务器 Node 实现，CF 反代）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/projects | 返回项目数组，**每项内嵌 phases[] + items[]**（一次拉齐，省往返） |
| POST | /api/projects | 建项目 + 自动建 6 phase |
| PUT | /api/projects | 基本信息 / current_phase / status（id 在 body） |
| PUT | /api/phases | 规划时间 / status / displayName / note；状态变更在事务内联动指针（projectId + phaseIdx） |
| POST/PUT/DELETE | /api/phase-items | 子项 CRUD + 勾选（POST body；PUT body.id；DELETE ?id=） |
| DELETE | /api/projects?id= | 级联删 phases/items；采购/记账/todo 的 project_id 置 NULL |

CF Functions：`functions/api/projects.js`、`phases.js`、`phase-items.js` 在 `DATA_BACKEND=mysql` 时验 JWT 并反代到内网服务；其他后端返回 JSON 501。

---

## 5. 旧数据迁移映射

| 旧 | 新 |
|----|----|
| 6 字段项目 | status 映射：进行中→active，已完成→completed，已归档→archived |
| 进度% | 丢弃（现算）；current_phase 由旧进度粗推（如 progress→已完成关数）或默认 0 |
| parentId 层级 | parent_id 保留 + legacy_flag=1；**只读展示**，详情不给「新建子项目」按钮 |
| 旧 Todo projectId | 不变；phase_idx=NULL |
| Todo 自动完成痕迹 | 无需回滚，只是之后不再触发 |

---

## 6. 你可能没想到的问题（设计时已处理）

1. **Todo 自动完成 vs 通关冲突** → 已定：阶段说了算，废除自动完成
2. **分母为 0**（6 关全跳过）→ 进度分母保护，显示「—」或 100%
3. **最后一关没经历**（跳到 P5 前用户就想结束）→ 手动设 completed 兜底
4. **全跳过后又想恢复某关** → 完全可逆已覆盖；跳过计入 skipped，撤销回 todo 后分母变大，进度会**变小**（要在 UI 上可接受）
5. **删除项目时关联数据** → 采购/记账 project_id 置 NULL（金额记录不删）；关联 Todo 保留但清 projectId；阶段子项级联删
6. **旧父子 + 新阶段并存的列表渲染** → legacy 缩进，新项目平铺，避免混乱
7. **6 个 phase 行与项目一起创建的原子性** → 服务器事务内完成
8. **AI/推送读项目数据** → push/summary 等若引用项目进度需同步改（实施时 grep 一遍 `project`）
9. **进度条在 0 经历阶段时**（新建项目全 todo）→ 显示 P0 待开始，进度 0%
10. **移动端触控**：阶段节点横向滚动，完成/跳过按钮够大（生活向用户）
11. **PWA 离线缓存**：项目列表缓存策略沿用 localStorage 5min；阶段状态变更后局部刷新
12. **每阶段时间戳** started/finished_at 已建列 —— 详情可显示「P2 花了 3 天」，但 v1 不做时间统计 UI（留字段）
13. **采购「分期」与项目阶段混淆** → 分期是财务概念，仍留在采购模块，不与 phase_idx 混用
14. **多人/分享** → 单用户模型，不考虑
15. **阶段内再嵌套** → 明确不做（子项就是叶子）

---

## 7. 实施顺序（依赖迁移）

```
PR-A  迁移方案落地（docs/MIGRATION-PLAN.md）：
      建表（含本方案 projects/phases/items + purchases/expenses/todos 加列）
      服务器 API + CF 反代 + 数据迁移 + 切换

PR-B  项目模块前端：
      renderProjectCard / openProjectDetail 重写
      新建/编辑 modal（去父子）
      阶段节点组件 + 完成/跳过/回退
      废除 checkProjectAutoStatus 改状态分支

PR-C  钱与项目关联：
      采购/记账表单加项目+阶段选择
      项目详情花费聚合

PR-D  旧数据只读渲染 + 清理（legacy 展示、迁移验证）
```

**关键文件：**
- `js/project.js`（重写详情/卡片/阶段交互）
- `js/todomodule.js`（废除自动完成；Todo 表单可选阶段）
- `js/items.js` `js/expense.js` / `js/api.js`（项目+阶段选择、去掉全量刷新）
- `index.html`（详情弹窗结构、modal）
- 迁移后：`/opt/purchase-server/src/routes/projects.js` 等新建
- `schema.sql`（新增表 + 加列）

---

## 8. 验证

1. 新建项目 → 自动出现 P0~P5，默认名可改
2. P0 直接跳到 P3（P1/P2 跳过）→ 进度 = 1/done÷(实际经历)
3. P3 完成 → 指针到下一个未处理阶段并自动开始；P0~P4 处理后完成 P5 → 状态自动 completed → 可归档
4. 完全可逆：done→todo 回退并撤回自动开始的下一阶段、skipped→todo、指针前后拖；重开前置阶段或 P5 后项目回到进行中
5. 阶段子项：增删勾选、图片（5MB 内）
6. Todo 全完成 → **项目状态不变**
7. 采购/记账选项目+阶段 → 项目详情金额正确
8. 旧父子项目：只读展示缩进，无新建子项目按钮
9. 迁移对账：旧项目数、状态映射正确
10. 回归：记账历史月份可见、列表月切换（若同批实施）

---

## 9. 待实施时再定的小项（不阻塞）

- 阶段默认显示名除了 P0-P5 是否给生活向模板（如「想法/准备/进行/收尾」）—— v1 直接 P0-P5，改名留给用户
- 完成阶段时是否 toast 提示「指针已到 P4」
- 项目卡片是否显示迷你 6 格阶段点
