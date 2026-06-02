# 个人管家 v3.0.0

多用户采购记账 PWA，基于飞书 Bitable + Cloudflare Pages。

## 功能

### 采购管理
- 增删改查采购记录（商品、平台、单价、数量、分类、备注）
- 审批流：待评估 → 待审批 → 已审批 → 已下单 → 已到/已退 → 已归档
- 批量操作：批量改状态、批量删除
- 搜索过滤：按状态、分类筛选
- 卡片左滑删除、右滑改状态
- 详情弹窗 Stepper 流程展示

### 记账
- 收支记录（类型、分类、金额、备注、时间）
- 日历视图：按天聚合，点击查看明细
- 列表视图：按时间线展示
- 图片附件：拍照/相册上传，压缩后存 Cloudflare KV
- 导出 CSV/TSV

### AI 功能（MiMo）
- 自然语言记账：说句话自动解析金额/分类/时间
- 智能分类：输入备注时自动推荐分类+标签
- 财务分析报告：消费异常、省钱建议、趋势洞察
- 消费画像：深度分析消费习惯、生活方式
- 自然语言查询：问问题直接回答（如"这个月奶茶花了多少？"）

### 统计
- 本月总计卡片
- 采购/记账分类饼图
- 每日支出趋势折线图
- 每周支出柱状对比
- 收入 vs 支出双线对比
- 支出分类排行

### 推送提醒
- 飞书机器人推送（国内可用，无需 VPN）
- 每日 12:00/18:00 记账提醒
- 每天 10:00 归档检查（超3天未归档推送提醒）
- 每周日 12:03 周度汇总
- 每月1号 12:05 月度汇总

### 其他
- PWA 支持：添加到主屏幕，离线可用
- 暗色模式（跟随系统 + 手动切换）
- 骨架屏加载动画
- 下拉刷新
- 预算管理
- 固定支出管理

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | HTML + CSS + 原生 JS（模块化，无框架），PWA |
| 后端 | Cloudflare Pages Functions |
| 数据库 | 飞书 Bitable（多维表格） |
| 图片存储 | Cloudflare KV（IMAGE_STORE） |
| AI | MiMo API（xiaomimimo.com） |
| 认证 | JWT（HS256）+ PBKDF2 密码哈希 + Refresh Token |
| 推送 | 飞书自定义机器人 Webhook |
| 定时任务 | Cloudflare Worker Cron Triggers |
| 部署 | Cloudflare Pages + GitHub Actions（双通道） |

## 文件结构

```
purchase-app/
├── index.html              # 主页面（HTML 结构）
├── js/                     # 前端模块化 JS
│   ├── utils.js            # 版本号、工具函数（esc, toast, getMonth）
│   ├── auth.js             # 认证（登录/注册/JWT刷新/管理员/日志查看）
│   ├── api.js              # API 封装（采购/记账/预算/固定支出/图片）
│   ├── stats.js            # 统计图表（饼图/折线/柱状/排行）
│   ├── expense.js          # 记账渲染（列表/日历/周视图/CRUD）
│   ├── items.js            # 采购渲染（卡片/批量/审批/详情弹窗）
│   ├── ai.js               # AI 助手（记账/分类/分析/评估/查询）
│   ├── budget.js           # 预算弹窗/导出
│   └── app.js              # 初始化/核心渲染/事件/离线检测/设置
├── theme.css               # 样式（主题+暗色模式+响应式）
├── sw.js                   # Service Worker（离线缓存+推送）
├── manifest.json           # PWA 清单
├── icon-192.png / icon-512.png
├── help.html               # 在线帮助文档
├── IMAGE_ARCH.md           # 图片存储架构说明
├── functions/              # Cloudflare Pages Functions（API）
│   └── api/
│       ├── _auth.js        # 公共认证模块（JWT/PBKDF2/Refresh Token/CORS）
│       ├── auth.js         # 多用户认证（注册/登录/邀请码/管理员）
│       ├── items.js        # 采购 CRUD + 缓存
│       ├── expenses.js     # 记账 CRUD
│       ├── images.js       # 图片上传/读取/删除（KV）
│       ├── ai.js           # AI 代理（解析/分类/分析/画像/查询/评估）
│       ├── notify.js       # 飞书机器人消息推送
│       ├── budgets.js      # 预算存储
│       ├── recurring.js    # 固定支出存储
│       └── push/
│           ├── trigger.js  # 每日记账提醒
│           ├── summary.js  # 周度/月度汇总
│           └── archive-check.js # 归档检查
├── cron-worker/            # Cloudflare Worker Cron
│   ├── index.js            # 定时任务调度
│   └── wrangler.toml       # Worker 配置
├── .github/workflows/      # GitHub Actions（双通道兜底）
│   ├── daily-reminder.yml
│   ├── archive-check.yml
│   ├── summary-weekly.yml
│   └── summary-monthly.yml
└── _headers                # Cloudflare Pages 响应头
```

## 环境变量

### Cloudflare Pages

| 变量名 | 用途 |
|--------|------|
| `JWT_SECRET` | JWT 签名密钥 |
| `FEISHU_APP_ID` | 飞书应用 ID |
| `FEISHU_APP_SECRET` | 飞书应用密钥 |
| `FEISHU_BOT_WEBHOOK` | 飞书机器人 Webhook |
| `MIMO_API_KEY` | MiMo AI API Key |
| `INVITE_CODE` | 注册邀请码（可重复使用） |
| `IMAGE_STORE` | Cloudflare KV namespace |

### Cloudflare Worker (cron-worker)

| 变量名 | 用途 |
|--------|------|
| `API_BASE` | API 基础 URL（https://121212121.top） |
| `CRON_SECRET` | 调用密钥 |

## 认证系统

### 安全特性（v3.0）
- **密码哈希**: PBKDF2-SHA256（100,000 次迭代）+ 随机 salt
- **自动升级**: 旧版 SHA-256 用户登录时自动升级为 PBKDF2
- **JWT 会话**: HS256 签名，1小时 Access Token + 30天 Refresh Token
- **Token 轮换**: Refresh Token 使用后立即销毁，签发新的
- **登录限流**: 5次/15分钟，防止暴力破解
- **AI 限流**: 每用户每小时30次，防止滥用
- **输入校验**: 所有 API 端点有长度/范围/白名单校验

### 多用户（v2.6.0 新增）
1. **注册**：用户名 + 密码 + 邀请码 → 创建独立 Bitable 表 → 返回 JWT
2. **登录**：用户名 + 密码 → 验证 → 返回 JWT + Refresh Token
3. **认证方式**：`Authorization: Bearer <jwt_token>`
4. **管理员**：`admin` 账户可创建邀请码、删除用户
5. **邀请码**：环境变量（可重复）+ KV 动态码（一次性）双模式

## 图片存储

详见 [IMAGE_ARCH.md](IMAGE_ARCH.md)

- 前端压缩（max 800px, quality 0.7, 上限 500KB）
- 存入 Cloudflare KV，Bitable 只存 `kv:key` 引用
- GET 返回二进制图片（支持 `<img src>` 直接加载）
- 图片认证：`?token=jwt` 查询参数（浏览器 img 不支持自定义头）

## 部署

### Cloudflare Pages

```bash
# 安装依赖
npm install

# 部署
npx wrangler pages deploy . --project-name=purchase-app

# 设置环境变量
npx wrangler pages secret put JWT_SECRET
npx wrangler pages secret put FEISHU_BOT_WEBHOOK
npx wrangler pages secret put MIMO_API_KEY
npx wrangler pages secret put INVITE_CODE
# ... 其他变量
```

### Cloudflare Worker Cron

```bash
cd cron-worker
npx wrangler deploy
```

### GitHub Actions

代码推送到 GitHub 后自动部署，Actions cron 作为 Cloudflare Worker 的兜底。

## 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v3.0.0 | 2026-06-02 | 全面重构：前端模块化(9文件)/PBKDF2密码哈希/移除旧PIN认证/AI限流/输入校验/后端公共模块提取 |
| v2.11.0 | 2026-06-01 | 分期管理/固定支出自动记账/AI需求评估优化 |
| v2.10.0 | 2026-05-27 | 采购评估流程优化：新增购买理由输入、评估摘要窗口 |
| v2.9.0 | 2026-05-27 | 安全加固：登录限流/XSS修复/AI提示注入防护 |
| v2.8.0 | 2026-05-25 | AI 需求评估：输入商品名AI分析历史采购+预算 |
| v2.7.0 | 2026-05-24 | 导出增强/统计页重架/离线优化/帮助文档/代码审查修复 |
| v2.6.0 | 2026-05-23 | 代码重构：JS提取为独立文件；多用户登录系统 |
| v2.5.0 | 2026-05-20 | 归档功能 + 完整审批流 |
| v2.4.0 | 2026-05-20 | 采购审批流 + 暗色模式 + 记账图片附件 |
