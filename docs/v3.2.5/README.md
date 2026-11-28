# 特殊预算 v3.2.5 · 全量试运行包（2026-12-01 起）

本目录是 v3.2.5 的**切换与试运行操作包**。代码已在分支 `feat/special-budget-v3.2.5` 完成并推送（PR #11），**尚未合并、未部署、未迁移生产库、未打开开关**。

- 试运行开始：**2026-12-01 09:00（北京时间）**
- 观察期：**2026-12-01 ～ 2026-12-07（7×24）**
- Go/No-Go：**2026-12-08**
- 2026 年配置：年度 1000 / 月度常规 800 / 周六追加率 10%（周六上限 100）/ 大额阈值 800 / 不跨年，生效 2026-12-01
- 2027 年配置：年度 10000 / 月度常规 800 / 周六追加率 10% / 大额阈值 800 / 允许跨年，生效 2027-01-01

## 文件

| 文件 | 用途 |
| --- | --- |
| `SWITCH_CHECKLIST.md` | 12-01 切换逐项检查表（迁移 → 开关 → 前端 → UAT → 基线） |
| `MONITORING.sql` | 只读监控 SQL，日常巡检查超限/对账/审计缺口 |
| `DAILY_RECONCILIATION.md` | 每日对账流程与 `v325-daily-recon.js` 用法 |
| `ROLLBACK_RUNBOOK.md` | 回滚步骤（关开关、前端回退、不回滚库） |
| `ISSUE_LOG.md` | 试运行问题清单模板 + 分级定义 |
| `GO_NO_GO.md` | 12-08 决策模板与判定标准 |
| `TRIAL_POLICY.md` | 试运行期额度/年度上限锁定与二次确认规则 |

## 工具

```bash
# 切换前/后只读预检（默认 switch 阶段；prep 阶段允许开关关闭/健康接口不可用）
PURCHASE_SPECIAL_BUDGET=1 node server/scripts/v325-preflight.js --phase=prep
PURCHASE_SPECIAL_BUDGET=1 node server/scripts/v325-preflight.js            # 切换后
PURCHASE_SPECIAL_BUDGET=1 node server/scripts/v325-preflight.js --json --strict

# 每日只读对账
node server/scripts/v325-daily-recon.js
node server/scripts/v325-daily-recon.js --date=2026-12-01 --out=/tmp/recon-2026-12-01.json
```

管理端（App「🔍 审计」页顶部）也有一张**试运行监控卡**，数据来自 `GET /api/special-budget/monitor`，仅管理员可见、只读。

## 本地验收（2026-11-28）

- 后端：`npm run test:special-budget` 12 个套件 **473 项断言全过**（新增 Cloudflare 代理路由测试 `cloudflare-special-budget-proxy.test.js` 和账号/管理员闸门测试 `special-budget-access.test.js`）。
- 前端：`node scripts/smoke-v325.mjs` 单实例 headless Chromium **53 项通过**（含监控卡 19 项检查、403 降级、管理员入口隐藏、按单退款/多关联单付款、版本 3.2.5）。
- 版本：`3.2.5` / `purchase-cache-v196`（index/chat/utils/help/sw 已同步 `www/`）。
- 预检在隔离测试库 `purchase_app_test` 上验证；未触碰生产库。

## 评审后修复（2026-11-28，未合并）

针对上线前对抗性评审的 P0/P1/P2 问题，分支内已修复并有测试覆盖：

- **P0 接线**：新增 `/api/special-budget/*` Cloudflare Pages 函数（catch-all 转发），避免 SPA 回退把 API 返回 200 HTML；代理透传 `Idempotency-Key` 并在 CORS 预检放行。
- **P0 账号**：特殊预算路由校验账号仍存在（已删除用户的旧 JWT 不可再写）；`/api/auth` 删除用户时按 username 清理审批单/分期/关联/事件/幂等键，保留全局规则/快照。
- **P1 现金口径**：月度退款改为按 `special_budget_events` 事件发生月归集，跨月退款不再污染原月份；同月退款恢复当月 800。
- **P1 管理员闸门**：年度配置 PUT、月度快照 POST 需 `is_admin`（服务端 `FORBIDDEN` 403 兜底），前端隐藏入口。
- **P1 资金控制**：直接付未来年度分期返回 `USE_PREPAY`（走提前还款）；单采购单累计付款不得超过订单总额（`PAY_EXCEEDS_ORDER`）；改期禁止回到已过月份（`PAST_PERIOD`）。
- **P2 前端/AI 口径**：普通/大额申请窗口拆分（大额增加周六）；退款按采购单分别计算并可退已释放关联的剩余付款；多关联单逐单付款；一般需求「已入账」排除特殊预算单；`schema.sql` 补齐 7 张特殊预算表与 5 个订单列；事务对死锁/锁等待自动重试。
- 新增错误码：`USE_PREPAY`、`PAY_EXCEEDS_ORDER`、`PAST_PERIOD`、`FORBIDDEN`。

## 硬性约束

- 未获用户明确授权：**不部署、不对生产库执行迁移、不 commit/push**。
- 两个 CLI 只执行 SELECT，并使用 `START TRANSACTION READ ONLY` + `ROLLBACK`；不会写库、不改快照。
- 生产服务目录是 `/opt/purchase-server`，环境变量在 `/etc/purchase-app/server.env`；本仓库 `/root/purchase-app/server` 是源目录。
- 监控/审计不提供任何金额修改入口；试运行期间年度上限修改需同一账号二次确认。
