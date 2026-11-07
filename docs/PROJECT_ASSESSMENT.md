# 生产架构与项目完成度评估

基准：线上 `main` 提交 `4ea9a763338b9761cd6845753cec3ae499be27d2`。本报告依据仓库代码；未访问 Cloudflare 控制台、生产主机、生产数据库或密钥。

## 结论

项目的核心采购、记账、待办、项目、预算、认证和图片流程已经形成可用闭环，生产主路径代码是 Cloudflare Pages Functions → Express → MySQL，图片落服务器磁盘；飞书/Bitable 实现仍留在 Functions 中作为兼容路径。完成度按代码形态估计为 **约 75%（可运行的成熟个人工具，尚未达到可验证的生产运维成熟度）**。主要扣分来自跨端前端交付物漂移、文档与实际架构不一致、图片文件与 MySQL 元数据缺少原子性，以及生产备份/恢复和运行开关无法从代码仓库核实。

## 严重度排序的问题

### 已修复 — Android 包装页与线上 Pages 的前端源不同步

- 证据：根目录 `index.html` 为 3.0.36，根目录 `sw.js` 为 v158；`www/index.html` 为 3.8.0、引用不同的 CSS 版本，`www/sw.js` 为 v61。Capacitor `webDir` 指向 `www`。根目录 `deploy.ps1` 通过复制根 HTML/CSS/JS 到 `www` 来临时同步，但 Cloudflare Pages 发布根目录，仓库没有在每次提交时强制镜像的构建校验。
- 影响：PWA 与 Android 可能呈现不同页面和业务代码；一端修复/视觉改动不自动出现在另一端，用户无法仅凭 main 版本判断 Android 实际包含什么。
- 本次处理：将根目录视为唯一前端源，添加 `scripts/sync-ui.js` 并让 Android 发布脚本调用它；HTML/CSS/JS/SW 与新 UI 样式均同步到 `www`。同步校验已通过。

### P1 — 图片写入磁盘与元数据记录不是原子操作

- 证据：`server/src/lib/images.js` 先写入图片文件，再向 `images` 表插入元数据；插入失败时只打印日志并继续返回成功。
- 影响：数据库元数据缺失时，用户看起来上传成功但无法通过元数据管理审计/清理，磁盘会积累孤儿文件；反向删除/备份校验也无法可靠对账。文件读路径按用户目录和 key 访问，因此不能据此断言文件立刻不可读。
- 建议：用失败清理补偿或异步对账任务处理写盘成功、DB 失败的情况，并定期核对磁盘文件与 images 表。

### 已修复 — README 与图片架构文档描述过时

- 证据：`README.md` 仍将飞书 Bitable 和 Cloudflare KV 列为主数据库与图片存储；线上 Functions `_proxy.js` 在 `DATA_BACKEND=mysql` 时转发 Express，服务使用 mysql2，`server/src/config.js` 指向服务器磁盘图片目录。
- 影响：新维护者会按错误的数据流排查部署、备份与故障，且无法从文档明确判断飞书路径是生产还是回退。
- 本次处理：更新 README 和 `IMAGE_ARCH.md`，说明 MySQL/服务器磁盘是生产路径、Feishu/KV 是有限兼容路径，并列出备份与回退核验事项。

### 已修复 — MySQL 配置不完整时可能静默落入 Feishu

- 证据：原 `functions/api/_proxy.js` 只有在 `DATA_BACKEND=mysql`、`SERVER_API_BASE`、`SERVICE_TOKEN` 同时存在时才选择 MySQL；缺少后两项会让大量端点继续执行 Feishu handler。
- 影响：生产开关配置不完整时可能出现写到备用数据源而非主库的分叉。
- 本次处理：选择 `DATA_BACKEND=mysql` 后缺少代理地址或服务令牌会明确失败关闭；只有显式选择/默认回退模式才走兼容 handler。

### P2 — MySQL 回退到飞书并非功能等价

- 证据：Functions 的 `phases.js` 与 `phase-items.js` 在非 MySQL 模式返回“需要 DATA_BACKEND=mysql”的 501；MySQL 的项目阶段由 `server/src/routes/projects.js` 和 `schema.sql` 的 `project_phases` / `phase_items` 支持。
- 影响：切回 Feishu 能恢复旧采购/记账路径，但项目阶段/交付物并不完整；回退不等于无损回滚。
- 建议：在运维手册标出回退功能差异，并在切换前核对 MySQL→Feishu 数据迁移。

## 分模块检查

- 鉴权：Functions 先验 JWT，再以 `X-Auth-User` 和服务令牌反代；Express 业务路由先过服务令牌，再解析身份。服务器只监听 `127.0.0.1`，公开小组件路由单独使用 widget token。代码边界清晰；仍需运维确认服务令牌不可由外网绕过、Cloudflare secrets 均已配置且轮换。
- 账号隔离：采购、记账、待办和项目 SQL 使用 user_id 条件；项目阶段通过所属 project 查询/事务操作。静态审查未发现明显跨用户读取路径。
- MySQL：有 schema 与用户/日期、状态索引；schema 中未见数据库外键约束或版本化迁移系统。项目多步更新有事务。需补充正式迁移版本、备份恢复演练、慢查询与容量策略。
- 日期与重复待办：MySQL 待办使用 UTC+8 边界运算，月度重复按目标月份天数截断到月末；报表也显式按北京时间计算跨月区间。仍需用自动化边界用例覆盖月底、年末和客户端本地时区。
- AI/通知：由 Functions 代理 AI、工作流和定时通知；Cloudflare/GitHub Actions secrets、实际 Cron 成功率与外部供应商配额无法从代码验证。
- 图片与恢复：磁盘与数据库分离，仓库没有可验证的生产图片备份/恢复策略；应确认快照包含 MySQL 与 `IMG_DIR`，并验证两者恢复点一致。

## 运维需核验

1. Cloudflare 的 `DATA_BACKEND`、`SERVER_API_BASE`、`SERVICE_TOKEN`、`JWT_SECRET`、AI 与推送 secrets。
2. Express 是否仅内网/localhost 可达、Nginx 限流/TLS/请求体大小限制，以及生产 Node/MySQL 版本。
3. MySQL 与图片目录的备份频率、保留策略、异地副本、恢复演练结果。
4. `schema.sql` 是否已在生产完整应用，尤其项目阶段、图片、刷新令牌相关表及索引。
5. Cron 与通知 provider 的实际执行监控、重复发送幂等性和告警。

## 设计实施范围

保留原有五个入口和业务字段；统一浅色中性底、柔和蓝紫强调色、卡片分组、按钮和表单层级；采购、待办、项目、记账和统计列表/过滤器已做结构与键盘交互改造，详情数据与 MySQL/API 契约不变。弹层与勾选采用短促的 opacity/transform 动效，不为整页或长列表添加反复入场动画。尊重 `prefers-reduced-motion`，暗色模式与安全区另行适配。

模块改造同时修复采购分类过滤器无点击处理器的问题：分类按钮现在委托更新 `currentCatFilter` 并重绘；这只恢复既有筛选意图，不改变后端数据。

## 本次验证与未验证项

- 根目录模块 JS 通过 `node --check`；`git diff --check` 通过。
- Chromium 本地 390px 预览确认新增样式已加载；安全区背景、主题 token、暗色变量、弹层圆角与减少动态效果媒体查询可解析。
- `www/` 与根目录 23 个 HTML/CSS/JS/Service Worker/manifest/icon 文件哈希一致；Android 发布脚本使用统一同步脚本。
- 浏览器 mock 数据交互确认采购分类按钮更新过滤结果并标记 `aria-pressed`；语义按钮改造覆盖待办、项目、记账与统计筛选/月份浏览控件。
- 手工检查 MySQL 选择/缺少代理配置时 fail-closed，以及明确 Feishu 模式仍可进入兼容端点。
- 未验证：生产登录和多用户隔离、真实 MySQL 写读事务、日期与月末边界端到端、图片磁盘上传/读取/备份、PWA 离线实际设备行为、Android Gradle/APK 构建及原生壳交互。这些需要测试账号、数据库/磁盘环境或 Android SDK/设备；本次未连接生产数据。
