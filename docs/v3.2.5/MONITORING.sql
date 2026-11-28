-- 特殊预算 v3.2.5 试运行监控 SQL（只读）
-- 用法：mysql -N -B purchase_app < docs/v3.2.5/MONITORING.sql
-- 建议在只读账号/只读事务中执行；不要带任何 UPDATE/DELETE/INSERT。
-- 权威口径以 GET /api/special-budget/monitor 与 v325-daily-recon.js 为准，本文件用于人工巡检对照。

-- 0) 当前生效配置
SELECT year, annual_cap, monthly_regular_cap, saturday_rate,
       ROUND(annual_cap * saturday_rate, 2) AS saturday_cap,
       large_threshold, cross_year_allowed, rule_version, effective_from
FROM special_budget_rules
WHERE year IN (2026, 2027)
ORDER BY year, effective_from;

-- 1) 年度占用 / 剩余（committed = 计划总额 − 已释放 − 已退款）
SELECT c.year,
       c.annual_cap,
       ROUND(t.total - t.released - t.refunded, 2) AS annual_committed,
       ROUND(c.annual_cap - (t.total - t.released - t.refunded), 2) AS annual_remaining,
       t.total, t.paid, t.refunded, t.released
FROM (
  SELECT year, annual_cap FROM special_budget_rules r
  WHERE r.year = 2026 AND r.effective_from = (
    SELECT MAX(effective_from) FROM special_budget_rules WHERE year = r.year)
) c
JOIN (
  SELECT year,
         SUM(amount) AS total,
         SUM(CASE WHEN status = 'paid' OR paid_at IS NOT NULL THEN amount ELSE 0 END) AS paid,
         SUM(refund_amount) AS refunded,
         SUM(CASE WHEN status = 'released' THEN amount ELSE 0 END) AS released
  FROM special_budget_schedules
  WHERE year = 2026
  GROUP BY year
) t ON t.year = c.year;

-- 2) 月度常规 800：普通申请按批准金额占用，同月退款恢复
SELECT a.month, ROUND(SUM(a.amount), 2) AS regular_approved
FROM (
  SELECT MONTH(approved_at) AS month, approved_amount AS amount
  FROM special_budget_approvals
  WHERE type = 'normal' AND status = 'approved'
    AND approved_at >= '2026-12-01' AND approved_at < '2027-01-01'
) a
GROUP BY a.month
ORDER BY a.month;

-- 3) 周六追加：按日汇总，应仅出现在周六且不超过当年周六上限（2026 = 100）
SELECT DATE(applied_at) AS d, DAYOFWEEK(applied_at) AS dow,
       ROUND(SUM(approved_amount), 2) AS saturday_approved
FROM special_budget_approvals
WHERE type = 'additional' AND status = 'approved'
  AND applied_at >= '2026-01-01' AND applied_at < '2027-01-01'
GROUP BY DATE(applied_at), DAYOFWEEK(applied_at)
ORDER BY d;

-- 4) 对账差异：付款事件总额 vs 分期已付总额；退款/释放同理
SELECT
  ROUND((SELECT COALESCE(SUM(amount),0) FROM special_budget_events
         WHERE event_type = 'pay' AND at >= '2026-01-01' AND at < '2027-01-01'), 2) AS pay_events,
  ROUND((SELECT COALESCE(SUM(amount),0) FROM special_budget_schedules
         WHERE paid_at >= '2026-01-01' AND paid_at < '2027-01-01'), 2) AS pay_schedules,
  ROUND((SELECT COALESCE(SUM(amount),0) FROM special_budget_events
         WHERE event_type = 'refund' AND at >= '2026-01-01' AND at < '2027-01-01'), 2) AS refund_events,
  ROUND((SELECT COALESCE(SUM(refund_amount),0) FROM special_budget_schedules
         WHERE refunded_at >= '2026-01-01' AND refunded_at < '2027-01-01'), 2) AS refund_schedules;

-- 5) 审计缺口：已批准的审批单没有 approve 事件
SELECT a.id, a.approval_no, a.status
FROM special_budget_approvals a
WHERE a.status IN ('approved', 'closed')
  AND NOT EXISTS (SELECT 1 FROM special_budget_events e
                  WHERE e.approval_id = a.id AND e.event_type = 'approve')
ORDER BY a.id;

-- 6) 审计缺口：已付/已退/已释放分期没有对应事件
SELECT s.id, s.approval_id, s.status, s.amount, s.refund_amount
FROM special_budget_schedules s
WHERE (s.status = 'paid' AND NOT EXISTS (SELECT 1 FROM special_budget_events e
         WHERE e.schedule_id = s.id AND e.event_type = 'pay'))
   OR (s.refund_amount > 0 AND NOT EXISTS (SELECT 1 FROM special_budget_events e
         WHERE e.schedule_id = s.id AND e.event_type = 'refund'))
   OR (s.status = 'released' AND NOT EXISTS (SELECT 1 FROM special_budget_events e
         WHERE e.schedule_id = s.id AND e.event_type = 'release'))
ORDER BY s.id;

-- 7) 关联金额不一致：active 关联金额 ≠ 采购单金额
SELECT l.id, l.approval_id, l.order_id, l.linked_amount, o.amount AS order_amount
FROM special_budget_links l
JOIN purchase_orders o ON o.id = l.order_id
WHERE l.status = 'active' AND ABS(l.linked_amount - o.amount) >= 0.005;

-- 8) 特殊采购单必须属于特殊预算且有 active 关联
SELECT o.id, o.name, o.amount, o.budget_type
FROM purchase_orders o
LEFT JOIN special_budget_links l ON l.order_id = o.id AND l.status = 'active'
WHERE o.budget_type = 'special' AND l.id IS NULL
ORDER BY o.id;

-- 9) 逾期未处理分期（计划日期已过仍为 planned）
SELECT s.id, s.approval_id, s.due_date, s.amount, s.status
FROM special_budget_schedules s
WHERE s.status = 'planned' AND s.due_date < CURDATE()
ORDER BY s.due_date, s.id;

-- 10) 待审批超过 48 小时
SELECT id, approval_no, username, applied_at
FROM special_budget_approvals
WHERE status = 'pending' AND applied_at < NOW() - INTERVAL 48 HOUR
ORDER BY applied_at;

-- 11) 已批准但超过 24 小时未关联采购单
SELECT id, approval_no, approved_at
FROM special_budget_approvals
WHERE status = 'approved'
  AND approved_at < NOW() - INTERVAL 24 HOUR
  AND NOT EXISTS (SELECT 1 FROM special_budget_links l
                  WHERE l.approval_id = special_budget_approvals.id AND l.status = 'active')
ORDER BY approved_at;

-- 12) 月度快照覆盖（2026 从 12 月生效；试运行期应至少覆盖已过月份）
SELECT year, month, annual_committed, annual_remaining, monthly_cash, generated_at
FROM special_budget_snapshots
WHERE year = 2026
ORDER BY month;

-- 13) 所有业务事件都应挂审批单（config_update / snapshot 除外）
SELECT id, event_type, approval_id, order_id, schedule_id, at
FROM special_budget_events
WHERE approval_id IS NULL
  AND event_type NOT IN ('config_update', 'snapshot')
ORDER BY id DESC
LIMIT 100;
