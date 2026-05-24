# 采购管家 v2.6.0

多用户采购记账 PWA，基于飞书 Bitable + Cloudflare Pages。

## 功能

### 采购管理
- 增删改查采购记录（商品、平台、单价、数量、分类、备注）
- 审批流：待审批 → 已审批 → 已下单 → 已到/已退 → 已归档
- 批量操作：批量改状态、批量删除
- 搜索过滤：按状态、分类筛选
- 卡片左滑删除、右滑改状态
- 详情弹窗 Stepper 流程展示

### 记账
- 收支记录（类型、分类、金额、备注、时间）
- 日历视图：按天聚合，点击查看明细
- 列表视图：按时间线展示
- 图片附件：拍照/相册上传，压缩后存 Cloudflare KV
- 导出 TSV

### AI 功能（DeepSeek）
- 自然语言记账：说句话自动解析金额/分类/时间，润色备注
- 智能分类：输入备注时自动推荐分类+标签
- 财务分析报告：消费异常、省钱建议、趋势洞察
- 消费画像：深度分析消费习惯、生活方式
- 自然语言查询：问问题直接回答（如"这个月奶茶花了多少"）

### 统计
- 本月总览卡片
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

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | HTML + CSS + 原生 JS（无框架），PWA |
| 后端 | Cloudflare Pages Functions |
| 数据库 | 飞书 Bitable（多维表格） |
| 图片存储 | Cloudflare KV（IMAGE_STORE） |
| AI | DeepSeek API |
| 认证 | JWT（HS256）+ 邀请码注册 |
| 推送 | 飞书自定义机器人 Webhook |
| 定时任务 | Cloudflare Worker Cron Triggers |
| 部署 | Cloudflare Pages + GitHub Actions（双通道） |

## 文件结构

```
purchase-app/
├── index.html              # 主页面（HTML 结构）
├── app.js                  # 前端所有 JS 逻辑（1227行）
├── style.css               # 样式（30KB）
├── sw.js                   # Service Worker（离线缓存 + 推送）
├── manifest.json           # PWA 清单
├── icon-192.png / icon-512.png
│
├── functions/              # Cloudflare Pages Functions（API）
│   ├── _utils.js           # 公共工具（CORS、Feishu API）
│   └── api/
│       ├── _auth.js        # 认证模块（JWT、PIN、Feishu token）
│       ├── auth.js         # 多用户认证（注册/登录/邀请码/管理员）
│       ├── items.js        # 采购 CRUD + 缓存
│       ├── expenses.js     # 记账 CRUD
│       ├── images.js       # 图片上传/读取/删除（KV）
│       ├── ai.js           # AI 代理（解析/分类/分析/画像/查询）
│       ├── notify.js       # 飞书机器人消息推送
│       └── push/
│           ├── trigger.js      # 每日记账提醒
│           ├── summary.js      # 周度/月度汇总
│           └── archive-check.js # 归档检查
│
├── api/                    # Vercel 兼容 API（旧版，已废弃）
│   └── items.js
│
├── cron-worker/            # Cloudflare Worker Cron
│   ├── index.js            # 定时任务调度
│   └── wrangler.toml       # Worker 配置
│
├── .github/workflows/      # GitHub Actions（双通道兜底）
│   ├── daily-reminder.yml
│   ├── archive-check.yml
│   ├── summary-weekly.yml
│   └── summary-monthly.yml
│
├── vercel.json             # Vercel 部署配置（已废弃）
├── package.json
├── README.md
├── IMAGE_ARCH.md           # 图片存储架构说明
└── SETUP-PUSH.md           # 推送配置指南
```

## 环境变量

### Cloudflare Pages

| 变量名 | 用途 |
|--------|------|
| `FEISHU_APP_ID` | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret |
| `FEISHU_BITABLE_APP` | 采购表 Bitable app_token |
| `FEISHU_BITABLE_TABLE` | 采购表 table_id |
| `FEISHU_EXPENSE_APP` | 记账表 Bitable app_token |
| `FEISHU_EXPENSE_TABLE` | 记账表 table_id |
| `API_KEY` | 旧版 PIN 认证密钥（兼容保留） |
| `JWT_SECRET` | JWT 签名密钥 |
| `INVITE_CODES` | 注册邀请码（逗号分隔，可重复使用） |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `FEISHU_BOT_WEBHOOK` | 飞书机器人 Webhook 地址 |
| `CRON_SECRET` | 定时任务调用密钥 |
| `IMAGE_STORE` | Cloudflare KV namespace |

### Cloudflare Worker (cron-worker)

| 变量名 | 用途 |
|--------|------|
| `API_BASE` | API 基础 URL（`https://121212121.top`） |
| `CRON_SECRET` | 调用密钥 |

## 认证系统

### 多用户（v2.6.0 新增）

1. **注册**：用户名 + 密码 + 邀请码 → 创建独立 Bitable 表 → 返回 JWT
2. **登录**：用户名 + 密码 → 验证 → 返回 JWT
3. **认证方式**：`Authorization: Bearer <jwt_token>`
4. **管理员**：`admin` 账户可创建邀请码、删除用户
5. **邀请码**：环境变量（可重复）+ KV 动态码（一次性）双模式

### 旧版兼容

- PIN 认证（`X-API-Key` 头）仍可用
- 回退到共享 Bitable 表

## 图片存储

详见 [IMAGE_ARCH.md](IMAGE_ARCH.md)

- 前端压缩（max 800px, quality 0.7, 上限 500KB）
- 存入 Cloudflare KV，Bitable 只存 `kv:key` 引用
- GET 返回二进制图片（支持 `<img src>` 直接加载）
- 图片认证：`?pin=xxx` 查询参数（浏览器 img 不支持自定义头）

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
# ... 其他变量
```

### Cloudflare Worker Cron

```bash
cd cron-worker
npx wrangler deploy
```

### GitHub Actions

代码推送到 GitHub 后自动部署，Actions cron 作为 Cloudflare Worker 的兜底。

## 已知问题

- SW 缓存旧版本会导致前端功能缺失，需手动 Unregister 后刷新
- 含中文的 JS 文件用 `edit` 工具修改可能编码损坏，用 Python 脚本处理
- `img.src` 不能发送自定义 HTTP 头，图片认证必须用 query 参数

## 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|---------|
| v2.6.0 | 2026-05-23 | 代码重构：JS 提取为独立 app.js；多用户登录系统 |
| v2.6.0 | 2026-05-24 | Bug修复：搜索框自动填充导致列表为空；AI json作用域错误 |
| v2.5.9 | 2026-05-23 | AI 智能分类 + 批量标签提炼 |
| v2.5.8 | 2026-05-23 | AI 自然语言记账 + 财务分析 |
| v2.5.7 | 2026-05-23 | 骨架屏 + 下拉刷新 + 卡片滑动 |
| v2.5.6 | 2026-05-23 | 统计页趋势图 |
| v2.5.5 | 2026-05-23 | 记账月历视图 |
| v2.5.4 | 2026-05-22 | 图片 API 二进制返回 + Cron Worker |
| v2.5.3 | 2026-05-21 | 拍照+相册双按钮 |
| v2.5.2 | 2026-05-21 | 图片改存 Cloudflare KV |
| v2.5.1 | 2026-05-21 | 精确时间戳 + 导出时间列 |
| v2.5.0 | 2026-05-20 | 归档功能 + 完整审批流 |
| v2.4.x | 2026-05-20 | 审批流分支 + 详情弹窗 stepper + 暗色模式 |
| v2.3.0 | 2026-05-20 | 暗色模式 + 记账图片 + 周月汇总推送 |
