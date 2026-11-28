'use strict';
// /api/special-budget —— v3.2.0 只读接口 + v3.2.1 审批/配置写入
// 功能开关关闭时整个前缀 404，且不得影响其他 /api 路由。
// v3.2.1 写入全部走服务层事务：申请/批准/驳回/取消/关联采购单/年度配置修改。
const express = require('express');
const cfg = require('../config');
const db = require('../db');
const S = require('../lib/special-budget/summary');
const A = require('../lib/special-budget/approvals');
const C = require('../lib/special-budget/config-service');
const F = require('../lib/special-budget/funds');
const L = require('../lib/special-budget/ledger');
const M = require('../lib/special-budget/monitor');
const R = require('../lib/special-budget/rules');
const { guard, clientIP } = require('../middleware');
const { BizError, isBizError } = require('../lib/special-budget/errors');

const router = express.Router();

// 功能开关：必须按 /special-budget 前缀限定（本 router 挂在 /api 上）。
router.use('/special-budget', (req, res, next) => {
  if (!cfg.SPECIAL_BUDGET_ENABLED) return res.status(404).json({ error: 'not_found' });
  next();
});
router.use(guard(['special-budget']));

// 活跃用户校验：CF 只验 JWT 签名，被删除账号的 24h 旧 token 仍能通过；
// 特殊预算写接口必须在服务端确认用户仍存在，否则会往已删除用户下写审批/资金数据。
// 同时缓存 is_admin，供年度配置/快照的管理员闸门使用（少一次查询）。
router.use('/special-budget', async (req, res, next) => {
  try {
    const row = await db.one('SELECT id, is_admin FROM users WHERE username = ?', [req.username]);
    if (!row) {
      // 'admin' 是保留账号且禁止删除；沿用监控/台账的既有语义，不因查询缺行而 401。
      if (req.username === 'admin') { req.userRow = { id: null, is_admin: 1 }; return next(); }
      return res.status(401).json({ error: '账号不存在或已删除' });
    }
    req.userRow = row;
    next();
  } catch (e) { next(e); }
});

function requireAdmin(req) {
  if (req.username === 'admin' || (req.userRow && Number(req.userRow.is_admin))) return;
  throw new BizError('FORBIDDEN', '仅管理员可执行此操作', 403);
}

function parseYear(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2026 || n > 2100) {
    throw new BizError('INVALID_YEAR', 'year 需为 2026..2100 的整数', 400);
  }
  return n;
}

function parseMonth(value) {
  if (value === undefined || value === '') {
    const bj = R.beijingParts(new Date());
    return bj ? bj.month : 1;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new BizError('INVALID_MONTH', 'month 需为 1..12 的整数', 400);
  }
  return n;
}

function bodyOf(req) {
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

function idemKeyOf(req, body) {
  const h = req.get('Idempotency-Key');
  const b = body ? body.idempotencyKey : undefined;
  const k = typeof h === 'string' && h.trim() ? h.trim() : (typeof b === 'string' ? b.trim() : '');
  if (!k) throw new BizError('IDEMPOTENCY_KEY_REQUIRED', '写操作必须携带 Idempotency-Key（8~64 位）', 400);
  return k;
}

function sendFailure(res, e, next) {
  if (isBizError(e)) {
    const body = { error: e.code, message: e.message };
    if (e.detail) body.detail = e.detail;
    return res.status(e.status).json(body);
  }
  if (e && e.code === 'ER_NO_SUCH_TABLE') {
    return res.status(503).json({ error: 'migration_required', message: '特殊预算表尚未迁移' });
  }
  return next(e);
}

function handle(fn) {
  return async (req, res, next) => {
    try {
      const out = await fn(req, res);
      if (!out || out.sent) return;
      res.status(out.status || 200).json(out.body);
    } catch (e) {
      sendFailure(res, e, next);
    }
  };
}

function methodNotAllowed(allowed) {
  return (req, res) => {
    res.set('Allow', allowed);
    res.status(405).json({ error: 'method_not_allowed', allowed });
  };
}

// ---------------- 配置 ----------------
router.route('/special-budget/config')
  .get(handle(async req => {
    const year = parseYear(req.query.year);
    const config = await S.getConfig(year);
    if (!config) throw new BizError('config_not_found', `${year} 年未配置特殊预算`, 404);
    const history = await C.getHistory(year);
    return { status: 200, body: { ok: true, year, config, history } };
  }))
  .put(handle(async req => {
    requireAdmin(req);
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return C.updateConfig({
      username: req.username,
      year: body.year,
      annualCap: body.annualCap,
      reason: body.reason,
      secondConfirm: body.secondConfirm === true,
      idemKey: key,
      ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('GET, PUT'));

// ---------------- 只读汇总（v3.2.0） ----------------
router.route('/special-budget/summary')
  .get(handle(async req => {
    const year = parseYear(req.query.year);
    const month = parseMonth(req.query.month);
    const out = await S.getSummary(year, month);
    if (!out.ok) throw new BizError(out.code || 'CONFIG_MISSING', out.message, 404);
    return {
      status: 200,
      body: {
        ok: true, year, month, as_of: out.as_of,
        // 前端据此隐藏「年度设置」入口；写接口仍由 requireAdmin 兜底，不能只靠 UI。
        is_admin: req.username === 'admin' || !!(req.userRow && Number(req.userRow.is_admin)),
        config: out.config, summary: out.summary, calculation: out.calculation,
      },
    };
  }))
  .all(methodNotAllowed('GET'));

// ---------------- 申请 / 列表 ----------------
router.route('/special-budget/approvals')
  .get(handle(async req => ({
    status: 200,
    body: await A.listApprovals(req.username, {
      year: req.query.year, month: req.query.month, status: req.query.status,
    }),
  })))
  .post(handle(async req => {
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return A.submit({
      username: req.username,
      type: body.type,
      amount: body.amount,
      purpose: body.purpose,
      installments: body.installments,
      note: body.note,
      idemKey: key,
      ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('GET, POST'));

router.route('/special-budget/approvals/:id')
  .get(handle(async req => ({
    status: 200,
    body: await A.getApproval(req.username, req.params.id),
  })))
  .all(methodNotAllowed('GET'));

// ---------------- 批准 / 驳回 / 取消 / 关联 ----------------
router.route('/special-budget/approvals/:id/approve')
  .post(handle(async req => {
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return A.approve({
      username: req.username,
      id: req.params.id,
      approvedAmount: body.approvedAmount,
      installments: body.installments,
      secondConfirm: body.secondConfirm === true,
      reason: body.reason,
      idemKey: key,
      ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('POST'));

router.route('/special-budget/approvals/:id/reject')
  .post(handle(async req => {
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return A.reject({
      username: req.username, id: req.params.id, reason: body.reason,
      idemKey: key, ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('POST'));

router.route('/special-budget/approvals/:id/cancel')
  .post(handle(async req => {
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return A.cancel({
      username: req.username, id: req.params.id, reason: body.reason,
      idemKey: key, ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('POST'));

router.route('/special-budget/approvals/:id/link-order')
  .post(handle(async req => {
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return A.linkOrder({
      username: req.username, id: req.params.id, orderId: body.orderId,
      amount: body.amount, idemKey: key, ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('POST'));

// ---------------- 付款 / 退款（v3.2.2） ----------------
router.route('/special-budget/orders/:orderId/pay')
  .post(handle(async req => {
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return F.payOrder({
      username: req.username, orderId: req.params.orderId,
      scheduleId: body.scheduleId, seq: body.seq, idemKey: key, ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('POST'));

router.route('/special-budget/orders/:orderId/refund')
  .post(handle(async req => {
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return F.refundOrder({
      username: req.username, orderId: req.params.orderId,
      amount: body.amount, reason: body.reason,
      releaseFuture: body.releaseFuture, idemKey: key, ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('POST'));

router.route('/special-budget/schedules/:id/pay')
  .post(handle(async req => {
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return F.paySchedule({
      username: req.username, scheduleId: req.params.id,
      orderId: body.orderId, idemKey: key, ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('POST'));

router.route('/special-budget/schedules/:id/prepay')
  .post(handle(async req => {
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return F.prepaySchedule({
      username: req.username, scheduleId: req.params.id, idemKey: key, ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('POST'));

router.route('/special-budget/schedules/:id/reschedule')
  .post(handle(async req => {
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return F.rescheduleSchedule({
      username: req.username, scheduleId: req.params.id,
      year: body.year, month: body.month, reason: body.reason,
      secondConfirm: body.secondConfirm === true, idemKey: key, ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('POST'));

// 过期扫描（普通/追加月末未付、大额首期当月未付）
router.route('/special-budget/expire')
  .post(handle(async req => {
    const out = await F.expireDue({ username: req.username, ip: clientIP(req) });
    return { status: 200, body: out };
  }))
  .all(methodNotAllowed('POST'));

// 对账报表（月度 + 年度余额 + 现金流；差异应为 0）
router.route('/special-budget/reconciliation')
  .get(handle(async req => {
    const year = parseYear(req.query.year);
    const month = parseMonth(req.query.month);
    return { status: 200, body: await F.reconcile({ year, month }) };
  }))
  .all(methodNotAllowed('GET'));

// ---------------- v3.2.5 试运行监控（管理员只读） ----------------
router.route('/special-budget/monitor')
  .get(handle(async req => ({
    status: 200,
    body: await M.getMonitor(req.username, {
      year: req.query.year, month: req.query.month,
    }),
  })))
  .all(methodNotAllowed('GET'));

// ---------------- v3.2.4 台账 / 快照 / 审计时间线 / 导出 ----------------
router.route('/special-budget/ledger')
  .get(handle(async req => ({
    status: 200,
    body: await L.getLedger(req.username, {
      year: req.query.year, month: req.query.month,
    }),
  })))
  .all(methodNotAllowed('GET'));

router.route('/special-budget/timeline')
  .get(handle(async req => ({
    status: 200,
    body: await L.getTimeline(req.username, {
      year: req.query.year, month: req.query.month,
      approvalId: req.query.approvalId, limit: req.query.limit, offset: req.query.offset,
    }),
  })))
  .all(methodNotAllowed('GET'));

router.route('/special-budget/snapshots')
  .get(handle(async req => ({
    status: 200,
    body: await L.listSnapshots(req.username, { year: req.query.year }),
  })))
  .post(handle(async req => {
    requireAdmin(req);
    const body = bodyOf(req);
    const key = idemKeyOf(req, body);
    return L.generateSnapshot({
      username: req.username, year: body.year, month: body.month,
      idemKey: key, ip: clientIP(req),
    });
  }))
  .all(methodNotAllowed('GET, POST'));

// 台账/审计导出：与本页同一服务层生成，GET 只读；不复用写权限。
router.route('/special-budget/export')
  .get(handle(async (req, res) => {
    const type = String(req.query.type || 'ledger');
    const year = parseYear(req.query.year);
    if (type === 'ledger') {
      const data = await L.getLedger(req.username, { year, month: req.query.month });
      const csv = L.ledgerCsv(data);
      const stamp = String(data.as_of || '').slice(0, 10).replace(/-/g, '');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="special-budget-ledger-${year}-${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(`特殊预算台账-${year}-${stamp}.csv`)}`);
      res.send(csv);
      return { sent: true };
    }
    if (type === 'audit' || type === 'timeline') {
      const limit = Math.max(1, Math.min(1000, Number(req.query.limit) || 1000));
      const data = await L.getTimeline(req.username, {
        year, month: req.query.month, approvalId: req.query.approvalId, limit, offset: 0,
      });
      const csv = L.timelineCsv(data);
      const stamp = String(data.as_of || '').slice(0, 10).replace(/-/g, '');
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="special-budget-audit-${year}-${stamp}.csv"; filename*=UTF-8''${encodeURIComponent(`特殊预算审计-${year}-${stamp}.csv`)}`);
      res.send(csv);
      return { sent: true };
    }
    throw new BizError('INVALID_EXPORT_TYPE', 'type 只能是 ledger / audit', 400);
  }))
  .all(methodNotAllowed('GET'));

// ---------------- 审计 ----------------
router.route('/special-budget/audit/:id')
  .get(handle(async req => ({
    status: 200,
    body: await A.getAudit(req.username, req.params.id),
  })))
  .all(methodNotAllowed('GET'));

// 未实现/未知路径落 404（不泄露内部结构）
router.use('/special-budget', (req, res) => res.status(404).json({ error: 'not_found' }));

module.exports = router;
