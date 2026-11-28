# v3.2.5 切换检查表（2026-12-01 09:00）

> 执行前提：用户已明确授权本次生产部署与迁移。未授权则只做 `--phase=prep` 只读预检。
> 全程记录：每步执行人、时间、命令输出摘要，填到本表或 `ISSUE_LOG.md`。

## 0. 切换前（T-24h，11-30）

- [ ] 本地/测试库全量测试通过：`npm --prefix server run test:special-budget`，后端套件全绿
- [ ] 预检 prep 通过（允许开关关闭、健康接口跳过）：
  ```bash
  PURCHASE_SPECIAL_BUDGET=1 node server/scripts/v325-preflight.js --phase=prep --skip-api
  ```
- [ ] 前端版本 3.2.5 / SW `purchase-cache-v196`，`www/` 已同步
- [ ] 备份：MySQL 生产库逻辑备份 + `/opt/purchase-server` 目录快照（或 git 记录当前版本）
- [ ] 确认回滚手册可用（`ROLLBACK_RUNBOOK.md`），开关改回方式已知

## 1. 生产库迁移（09:00）

先 dry-run，核对 SQL 与影响面，再 apply；**顺序不能反**：

```bash
# 1.1 dry-run（只读，打印将执行的 DDL）
node server/scripts/migrate-special-budget.js
node server/scripts/migrate-special-budget-v321.js

# 1.2 正式执行（需授权）
node server/scripts/migrate-special-budget.js --apply
node server/scripts/migrate-special-budget-v321.js --apply
```

- [ ] 7 张 `special_budget_*` 表创建成功
- [ ] `purchase_orders` 新增 5 列 + `idx_user_budget`
- [ ] 2026/2027 默认配置写入，`effective_from` 分别为 2026-12-01 / 2027-01-01
- [ ] 迁移脚本可重复执行（幂等），二次执行无报错

## 2. 部署代码到生产目录

```bash
# 将本地 server/ 同步到 /opt/purchase-server（示例，按实际部署方式执行）
rsync -a --delete --exclude node_modules --exclude test /root/purchase-app/server/ /opt/purchase-server/
```

- [ ] `/opt/purchase-server` 版本与本地一致（含 `lib/special-budget/monitor.js`、`scripts/v325-*.js`）
- [ ] 前端 3.2.5 随仓库/CF 发布（版本号、SW v196 生效）

## 3. 打开功能开关

编辑 `/etc/purchase-app/server.env`，加入：

```
SPECIAL_BUDGET_ENABLED=1
```

```bash
sudo systemctl restart purchase-server
```

- [ ] `/health` 正常
- [ ] 功能关闭时 `/api/special-budget/*` 为 404，打开后受鉴权保护
- [ ] 非管理员访问 `/api/special-budget/monitor` 返回 403

> 重启 ttyd / tmux 会中断当前会话，禁止在本会话内执行；`purchase-server` 重启不受此限制。

## 4. 切换后预检（switch 阶段，必须全 PASS）

```bash
PURCHASE_SPECIAL_BUDGET=1 node server/scripts/v325-preflight.js --strict
```

- [ ] 数据库/表/列/索引 PASS
- [ ] 2026、2027 默认配置与生效时间 PASS
- [ ] 功能开关 PASS
- [ ] `/health` PASS
- [ ] 前端版本 3.2.5 / SW v196 PASS
- [ ] 监控 PASS 或仅剩已知 WARN（逐条记录）

## 5. 内部 UAT（手机 390px + 桌面）

- [ ] 概览数字与台账一致，年度占用/剩余计算正确
- [ ] 申请：普通（1/15）、周六追加（仅周六）、大额（1/15 或周六）窗口校验生效
- [ ] 超 800 走大额；月度 800 用尽后普通/追加被拒
- [ ] 审批（含二次确认）、关联采购单、分期付款、退款、提前还款、改期
- [ ] 采购页特殊单标识、金额编辑锁定、退货/取消入口隐藏
- [ ] 台账/审计/导出 CSV 正常；审计页监控卡显示 PASS/WARN/FAIL
- [ ] 300～400 字用户口吻文案无英文报错泄露

## 6. 全量打开 + D0 基线

- [ ] 正式用户可正常使用特殊预算
- [ ] 生成 2026-12 D0 基线快照（App「🔍 审计」→ 生成快照）
- [ ] 运行首次日对账，记录结果（预期差异 0）：
  ```bash
  node server/scripts/v325-daily-recon.js --date=2026-12-01 --out=/tmp/recon-D0.json
  ```

## 7. 签字

| 项 | 执行人 | 时间 | 结果 |
| --- | --- | --- | --- |
| 迁移 |  |  |  |
| 部署 |  |  |  |
| 开关 |  |  |  |
| switch 预检 |  |  |  |
| UAT |  |  |  |
| D0 基线 |  |  |  |
