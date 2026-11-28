# 回滚手册（v3.2.5）

> 原则：**只回退代码与开关，不回滚数据库**。特殊预算表保留只读，不删表、不删列、不让数据下坡。
> 回滚目标：一般预算、采购、记账、统计恢复正常；特殊预算入口关闭或只读；已写入的特殊预算数据保持完整、可审计。

## 触发条件（任一）

- 特殊预算导致主流程不可用：登录、采购、记账、统计大面积报错
- 出现未经授权的金额写入或审计缺口，无法在 30 分钟内定位
- 出现 P0/P1，且当日无法修复
- 用户明确要求回滚

## 步骤 A：关闭功能开关（首选，1 分钟内）

```bash
sudo sed -i 's/^SPECIAL_BUDGET_ENABLED=.*/SPECIAL_BUDGET_ENABLED=0/' /etc/purchase-app/server.env
sudo systemctl restart purchase-server
```

验证：

- [ ] `/health` 正常
- [ ] `/api/special-budget/*` 一律 404（开关关闭）
- [ ] 一般预算、采购、记账、统计正常
- [ ] App 特殊预算页显示「特殊预算未开启」，无报错
- [ ] 数据库特殊预算表与数据未改动

> `purchase-server` 重启可在本会话执行；**禁止**重启 ttyd / kill tmux。

## 步骤 B：前端回退（仅在 A 不足或前端本身有回归时）

- 通过仓库回退到上一发布版本（3.1.26 / SW `purchase-cache-v193`）并发布；
- 或保留 3.2.5 前端（开关关闭时页面自动降级为「未开启」），**不要**手工改数据库。

验证：

- [ ] 版本号回退到目标版本，SW 缓存号同步变化
- [ ] 强制刷新后页面正常
- [ ] 特殊预算页不可用或只读

## 步骤 C：服务代码回退（仅在服务端回归时）

- 从 `/opt/purchase-server` 恢复上一版本代码（部署前快照/备份）
- `sudo systemctl restart purchase-server`
- 保持 `SPECIAL_BUDGET_ENABLED=0`

## 不做的事

- 不执行任何 `DROP TABLE` / `DROP COLUMN` / 数据回滚脚本
- 不删除 `special_budget_*` 表、`purchase_orders.budget_type` 等列
- 不清空审计事件或快照
- 不修改历史账目来「抹平」数字

## 回滚后

- 在 `ISSUE_LOG.md` 记录：触发时间、原因、执行人、A/B/C 哪一步、验证结果
- 生成一次只读对账，保留现场：`node server/scripts/v325-daily-recon.js --out=/tmp/recon-rollback.json`
- 7 天观察期重新计时，Go/No-Go 顺延
