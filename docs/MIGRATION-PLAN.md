# 采购记账平台后端迁移方案（定稿）

> **状态：方案定稿，暂不实施。** 正式开工时按本文档执行。
> 仓库：https://github.com/begin2019510/purchase-app
> 本地：`/root/purchase-app`
> 定稿日期：2026-10-09

---

## 1. 背景与目标

「个人管家」采购记账 PWA 已上线 Cloudflare Pages。ICP 备案已完成，决定把**业务数据自主到自己服务器**：

| 现状 | 目标 |
|------|------|
| 数据在飞书 Bitable（每用户一套表） | MySQL 共享表 + `user_id`（阿里云服务器） |
| 图片在 CF KV，前端压到 2MB 很糊 | 图片存服务器磁盘，上限 **5MB**、最长边 4096px |
| 前端 + API 全在 Cloudflare | **前端仍在 CF**；API 由 CF Functions **反代**到服务器 |

```
目标架构：
浏览器 → CF Pages(/api/*) → CF Functions(反代) → 服务器 Node API(:3500) → MySQL + 磁盘图片
                                              ↘ 每日同步 → 飞书 Bitable（灾备热备）
```

---

## 2. 关键决策（已确认）

| 项 | 决定 |
|----|------|
| API 接入 | CF Functions 反代到服务器（前端路径 `/api/*` 不变） |
| 切换策略 | 预迁移 + 对账 + **可回滚切换**（观察期 7 天，非裸切、非长期双写） |
| 图片 | **5MB**，最长边 4096px，存 `/var/lib/purchase-app/images/` |
| 多用户 | 共享表 + `user_id`，废除「每用户一套 Bitable」 |
| 飞书推送/提醒 | **本次关闭**，不加新通道；后续另找方案 |
| AI（MiMo） | 不动 |
| 容灾主体 | **飞书 Bitable**（平台不会挂）；同步频率 **24 小时一次** |
| 服务器挂了 | CF 一键切回飞书读路径（RPO≤24h，RTO 分钟级） |
| 图片灾备 | 每日打包 dump 到 OSS/R2（可选，文字数据优先保） |

---

## 3. 目标 MySQL 表结构

库名：`purchase_app`，`utf8mb4`。列名英文，API 层映射回前端中文 JSON。

```sql
users            -- id, username UNIQUE, password_hash, salt, hash_version, is_admin,
                 -- feishu_* tokens(灾备同步用，保留), created_at
refresh_tokens   -- id, user_id, token_hash, expires_at, revoked
purchases        -- id, user_id, name, platform, category, price, qty, status,
                 -- date_ms, note, image_ref,
                 -- created_at_text, approved_at, ordered_at, arrived_at, archived_at,
                 -- eval_summary, buy_reason, budget_range, cancel_reason,
                 -- installments, installment_amount, installment_start, installment_paid,
                 -- created_at, updated_at
expenses         -- id, user_id, type, amount, category, date_ms, note, image_ref,
                 -- split_weeks, split_start_week, created_at, updated_at
todos            -- id, user_id, title, description, due_ms, priority, category,
                 -- status, repeat, subtasks, image_ref, link_type, link_id,
                 -- completed_ms, project_id, created_at, updated_at
projects         -- id, user_id, name, description, due_ms, status, color, progress,
                 -- created_at, updated_at
budgets          -- user_id PK, data JSON
recurring        -- user_id PK, data JSON
images           -- id, user_id, file_key, filename, mime, size_bytes, created_at
op_logs          -- id, user_id, action, detail, ip, created_at
```

字段枚举与现有 Bitable `createUserTables` 保持一致（平台/分类/状态等选项见 `functions/api/auth.js:51-103`）。

---

## 4. 服务器 Node API

路径：`/opt/purchase-server/`（避开已有 `/opt/purchase-api` 监听 3443）

```
package.json          # express, mysql2, jsonwebtoken, multer, cors
src/index.js          # listen 127.0.0.1:3500
src/db.js             # mysql2/promise 连接池（innodb_buffer_pool_size≈256M，整机仅 1.6G 内存）
src/auth.js           # JWT HS256（与 CF 同 JWT_SECRET）；密码兼容 v1 SHA-256 + v2 PBKDF2 100k
src/routes/           # auth, purchases, expenses, todos, projects, budgets, recurring,
                      # images(上传/下载/删除, multer 5MB), ai-data
scripts/sync-to-feishu.js   # 每日 24h 灾备同步 MySQL→飞书
```

- **内网鉴权**：CF→服务器带 `X-Service-Token` 共享密钥
- **图片路径**：`/var/lib/purchase-app/images/{user_id}/{file_key}`，防穿越
- **systemd**：`purchase-server.service`，开机自启
- **Nginx**：`api.121212121.top` → 443 反代 `127.0.0.1:3500`，`client_max_body_size 8m`

---

## 5. CF Functions 改造

1. 保留 JWT 认证、CORS、限流（`functions/api/_auth.js`）
2. 旁路所有 `feishuFetch` / Bitable 调用
3. 新增共享 `_proxy.js`：转发到 `SERVER_API_BASE`，带 `X-Service-Token`
4. **双路径开关**：env `DATA_BACKEND=mongo|feishu`（`mysql` 或 `feishu`）
   - `mysql`：反代服务器
   - `feishu`：走旧代码（灾备切换用）
5. `js/api.js`：图片 `MAX=4096`，目标 5MB（去掉压到 2MB 的 while）
6. push cron 本次 no-op/停用

CF 环境变量：`SERVER_API_BASE`、`SERVICE_TOKEN`、`DATA_BACKEND`、`JWT_SECRET`（不变）

---

## 6. 数据迁移（预迁移 + 对账）

`scripts/migrate/`：

1. CF KV dump `user:*` → `users`（密码哈希原样）
2. 按用户 `bitable.*` 拉四张表 → MySQL 行（中文字段→英文列；`kv:key` 图片下载到磁盘）
3. `budget:*`、`recurring:*` → JSON 列
4. 对账：COUNT + 抽样金额/日期/图片，出报告
5. **切换前增量 migrate**，窗口缩到几分钟

---

## 7. 容灾备份（核心补充）

### 7.1 设计原则
- **飞书 = 灾备热备**：大厂 SaaS，平台本身不会挂；服务器挂了它还在
- **同步频率 24 小时**（不搞小时级，个人应用足够）
- **不长期双写**：正常路径只写 MySQL；飞书只作只读灾备副本

### 7.2 同步链路
```
服务器 cron（每日 03:00）：
  mysqldump 业务表 + 读 images 元数据
  → 飞书 Open API 写回各用户 Bitable（覆盖式或 upsert）
  → 同步结果用飞书机器人推一条日志（可选，服务器自身故障时此步会停，但已同步数据仍在飞书）
```

### 7.3 服务器故障切换（RTO 分钟级）
```
1. 改 CF 环境变量 DATA_BACKEND=feishu（或 redeploy 旧版 Functions）
2. 用户立即回到飞书链路
3. 数据延迟 ≤ 24h（最多丢最近一天新增）
4. 服务器恢复后：从飞书导回 MySQL 增量，再切回 DATA_BACKEND=mysql
```

### 7.4 图片容灾
- 飞书不适合存 5MB 大图
- **每日**将 `/var/lib/purchase-app/images/` 打包上传 OSS 或 CF R2（保留 30 天）
- 灾难时：文字数据秒级可读（飞书），图片从最近一次备份恢复；可接受短期图裂

### 7.5 指标
| | 值 |
|--|--|
| RPO（最多丢数据） | ≤ 24 小时 |
| RTO（恢复服务） | 分钟级（切 CF 开关） |
| 成本 | ≈0（复用飞书；OSS 几毛钱） |

### 7.6 升级路径
数据价值/量上来后可升：阿里云 RDS 或第二台 VPS 主从（RPO 秒级），飞书降为第三副本。

---

## 8. 上线切换（可回滚）

```
0. [ ] 确认 api.121212121.top 解析 + HTTPS 证书
1. [ ] 服务器建库建表 → 部署 purchase-server → systemd（先 127.0.0.1:3500）
2. [ ] 预迁移全量 → 对账报告全过
3. [ ] Nginx API 站点 + 健康检查
4. [ ] CF Functions 反代版先预览环境验证
5. [ ] 切换前 5 分钟：增量 migrate
6. [ ] 正式：DATA_BACKEND=mysql → 前端验证登录/CRUD/图片
7. [ ] 观察 7 天：
       出问题 → DATA_BACKEND=feishu（秒级回滚，最多丢切换后新写入）
       正常 → 停飞书 App 写凭证（同步任务仍需凭证；业务读凭证可停）
8. [ ] 启用每日 sync-to-feishu + 图片 OSS 备份 cron
9. [ ] 关闭飞书推送 cron
```

---

## 9. 安全清单

- [ ] MySQL 仅 127.0.0.1，专用账号最小权限
- [ ] `SERVICE_TOKEN` 只在 CF env + 服务器 env，不进 git
- [ ] 图片接口必须 JWT；文件名不落用户可控路径
- [ ] 服务器 API 先只绑 127.0.0.1，经 Nginx TLS 暴露
- [ ] 安全组/防火墙只放行 22/80/443（**顺手处理现有 7681/8080/3389 暴露**）
- [ ] 登录限流沿用；图片按用户配额
- [ ] 每日 mysqldump + 图片备份 cron

---

## 10. 风险与回滚

| 风险 | 缓解 |
|------|------|
| CF→国内服务器延迟/不稳 | api 域名可临时 DNS only 直连 |
| MySQL 有问题 | 预迁移对账不过不动 CF；切后 7 天可回飞书 |
| 服务器挂 | DATA_BACKEND 切飞书；数据≤24h 旧 |
| 内存 1.6G | buffer_pool 调小；观察 mysqld+node 合计 |
| 3443 端口冲突 | 新服务用 3500；确认旧 purchase-api 是否废弃 |
| 迁移丢数据 | 飞书不删；全量+增量+对账 |

---

## 11. 交付物

| 路径 | 内容 |
|------|------|
| `/opt/purchase-server/` | Node API + 同步脚本 |
| `purchase-app/schema.sql` | MySQL DDL |
| `purchase-app/scripts/migrate/` | 飞书→MySQL |
| `purchase-app/scripts/sync-to-feishu/` | 每日灾备同步 |
| `functions/api/_proxy.js` + 各 endpoint | CF 反代 + DATA_BACKEND 开关 |
| `js/api.js` | 图片压缩放宽 5MB |
| systemd + nginx conf | 服务与站点 |

**实施节奏**：PR1 建表+骨架 → PR2 CRUD+图片 → PR3 迁移对账 → PR4 CF 反代+切换 → PR5 灾备同步+关推送

---

## 12. 验证

1. `curl http://127.0.0.1:3500/health`（带 Service-Token）
2. `https://api.121212121.top/health`
3. 前端登录→采购带图→记账→刷新→MySQL 有数据、图能开
4. 迁移 COUNT 对账
5. 老账号密码可登录
6. 模拟：`DATA_BACKEND=feishu` 切回旧链路可读
