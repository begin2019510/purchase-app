'use strict';
// 特殊预算 v3.2.1 写接口 HTTP 测试（只操作 purchase_app_test 隔离库）
// 验证：鉴权/开关/幂等键/申请与批准/二次确认/配置修改/审计与列表/405/404
// 用法: PURCHASE_DB_NAME=purchase_app_test PURCHASE_SPECIAL_BUDGET=1 node server/test/special-budget-writes-api.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';
process.env.PURCHASE_SPECIAL_BUDGET = '1';

const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const cfg = require('../src/config');
const db = require('../src/db');
const R = require('../src/lib/special-budget/rules');
const { parseJWT } = require('../src/middleware');

const U = 'sb_http_test';
let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok', name); }
  else { console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); process.exitCode = 1; }
}

function migrate(script) {
  const r = spawnSync(process.execPath, [script, '--apply'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PURCHASE_DB_NAME: 'purchase_app_test' }),
    encoding: 'utf8',
    timeout: 60000,
  });
  if (r.status !== 0) throw new Error(script + ' failed: ' + ((r.stdout || '') + (r.stderr || '')));
}

async function seedPending(opts) {
  const o = opts || {};
  const no = 'SBHTTP' + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const r = await db.exec(
    `INSERT INTO special_budget_approvals
       (approval_no, username, type, purpose, requested_amount, status, rule_version,
        applied_at, expires_at, installments, first_year, first_month)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [no.slice(0, 32), U, o.type || 'normal', o.purpose || 'HTTP 单测', o.amount || 300,
      'pending', '2026-v1', o.appliedAt || '2026-12-01 10:00:00',
      o.expiresAt || '2026-12-31 23:59:59', o.installments || 1, 2026, 12]);
  return Number(r.insertId);
}

(async () => {
  if (!cfg.SERVICE_TOKEN) {
    console.error('FAIL 缺少 SERVICE_TOKEN');
    process.exit(1);
  }
  migrate('scripts/migrate-special-budget.js');
  migrate('scripts/migrate-special-budget-v321.js');
  for (const t of ['special_budget_idempotency', 'special_budget_events', 'special_budget_schedules',
    'special_budget_links', 'special_budget_approvals', 'special_budget_snapshots', 'special_budget_rules']) {
    await db.exec(`DELETE FROM ${t}`);
  }
  migrate('scripts/migrate-special-budget.js');
  // 特殊预算路由要求账号存在；U 设为管理员以继续覆盖年度配置写入，OTHER 为非管理员用于 403 断言。
  async function ensureUser(name, isAdmin) {
    const row = await db.one('SELECT id FROM users WHERE username = ?', [name]);
    if (row) return row.id;
    const ins = await db.exec(
      'INSERT INTO users (username, password_hash, salt, hash_version, is_admin) VALUES (?,?,?,1,?)',
      [name, '0'.repeat(64), '0'.repeat(32), isAdmin ? 1 : 0]);
    return ins.insertId;
  }
  await ensureUser(U, true);
  await ensureUser('sb_http_other', false);

  const app = express();
  app.use('/api', (req, res, next) => {
    if (req.headers['x-service-token'] !== cfg.SERVICE_TOKEN) return res.status(403).json({ error: 'forbidden' });
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  app.use(parseJWT);
  app.use('/api', require('../src/routes/special-budget'));
  app.use('/api/__probe', (req, res) => res.json({ ok: true, probe: true }));
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;

  async function req(method, p, opts) {
    const o = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    if (o.token !== false) headers['X-Service-Token'] = cfg.SERVICE_TOKEN;
    if (o.auth !== false) headers['X-Auth-User'] = o.user || U;
    if (o.key) headers['Idempotency-Key'] = o.key;
    const r = await fetch(base + p, {
      method, headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { status: r.status, data, allow: r.headers.get('allow') };
  }

  let largeId = null;
  const seeded = [];
  try {
    // ---- 鉴权 / 幂等键 ----
    let r = await req('POST', '/api/special-budget/approvals', { auth: false, key: 'http-noauth-1', body: { type: 'normal', amount: 100, purpose: 'x' } });
    ok('无身份 → 401', r.status === 401, JSON.stringify(r.data));
    r = await req('POST', '/api/special-budget/approvals', { token: false, key: 'http-notoken-1', body: { type: 'normal', amount: 100, purpose: 'x' } });
    ok('无服务令牌 → 403', r.status === 403, JSON.stringify(r.data));
    r = await req('POST', '/api/special-budget/approvals', { body: { type: 'normal', amount: 100, purpose: 'x' } });
    ok('缺幂等键 → 400', r.status === 400 && r.data.error === 'IDEMPOTENCY_KEY_REQUIRED', JSON.stringify(r.data));

    // ---- 2026 试运行仅 12 月：11 月提交大额应被拒绝（HTTP 校验链路） ----
    r = await req('POST', '/api/special-budget/approvals', {
      key: 'http-large-sub-1',
      body: { type: 'large', amount: 900, purpose: 'HTTP 大额', installments: 1 },
    });
    ok('2026-11 提交大额 → 400 2026_ONLY_DECEMBER',
      r.status === 400 && r.data.error === '2026_ONLY_DECEMBER', JSON.stringify(r.data));

    // 种一笔 12 月大额 pending，用 HTTP 走批准/二次确认
    largeId = await seedPending({
      type: 'large', amount: 900, purpose: 'HTTP 大额', appliedAt: '2026-12-15 10:00:00',
    });
    seeded.push(largeId);

    r = await req('POST', `/api/special-budget/approvals/${largeId}/approve`, {
      key: 'http-large-appr-1', body: {},
    });
    ok('大额未二次确认 → 428', r.status === 428 && r.data.error === 'SECOND_CONFIRM_REQUIRED', JSON.stringify(r.data));
    r = await req('POST', `/api/special-budget/approvals/${largeId}/approve`, {
      key: 'http-large-appr-2', body: { secondConfirm: true },
    });
    ok('大额二次确认 → 200 + 1 期计划', r.status === 200 && r.data.second_confirmed === true &&
      r.data.schedules.length === 1, JSON.stringify(r.data));
    const rp = await req('POST', `/api/special-budget/approvals/${largeId}/approve`, {
      key: 'http-large-appr-2', body: { secondConfirm: true },
    });
    ok('批准幂等重放同一响应', rp.status === 200 && rp.data.ok === true &&
      rp.data.schedules.length === 1, JSON.stringify(rp.data));
    const cnt = await db.one('SELECT COUNT(*) AS c FROM special_budget_schedules WHERE approval_id = ?', [largeId]);
    ok('重放不新增计划行', Number(cnt.c) === 1, `实际 ${cnt.c}`);

    // body.idempotencyKey 兜底
    r = await req('GET', `/api/special-budget/approvals/${largeId}`);
    ok('GET 详情 → 200 含审批/计划/计算', r.status === 200 && r.data.approval.id === largeId &&
      r.data.schedules.length === 1 && r.data.calculation, JSON.stringify(r.data.approval));
    r = await req('GET', `/api/special-budget/approvals/${largeId}`, { user: 'sb_http_other' });
    ok('他人查看 → 404', r.status === 404 && r.data.error === 'APPROVAL_NOT_FOUND', JSON.stringify(r.data));
    r = await req('GET', `/api/special-budget/audit/${largeId}`);
    ok('GET 审计 → 含 approve 事件（种子单无 submit）', r.status === 200 &&
      r.data.events.some(e => e.event_type === 'approve'),
      JSON.stringify(r.data.events && r.data.events.map(e => e.event_type)));
    r = await req('GET', '/api/special-budget/approvals?year=2026&month=12');
    ok('GET 列表 → 含本单且仅本人', r.status === 200 && r.data.approvals.length === 1 &&
      r.data.approvals[0].id === largeId, JSON.stringify(r.data));

    // ---- 配置修改：仅管理员 ----
    r = await req('PUT', '/api/special-budget/config', {
      user: 'sb_http_other', key: 'http-cfg-forbidden-1',
      body: { year: 2026, annualCap: 1200, reason: '非管理员尝试', secondConfirm: true },
    });
    ok('非管理员改年度配置 → 403 FORBIDDEN', r.status === 403 && r.data.error === 'FORBIDDEN', JSON.stringify(r.data));
    r = await req('POST', '/api/special-budget/snapshots', {
      user: 'sb_http_other', key: 'http-snap-forbidden-1', body: { year: 2026, month: 12 },
    });
    ok('非管理员生成快照 → 403 FORBIDDEN', r.status === 403 && r.data.error === 'FORBIDDEN', JSON.stringify(r.data));

    r = await req('PUT', '/api/special-budget/config', {
      body: { year: 2026, annualCap: 1200, reason: '试运行上调' },
    });
    ok('配置缺幂等键 → 400', r.status === 400 && r.data.error === 'IDEMPOTENCY_KEY_REQUIRED', JSON.stringify(r.data));
    r = await req('PUT', '/api/special-budget/config', {
      key: 'http-cfg-1', body: { year: 2026, annualCap: 1200, reason: '试运行上调' },
    });
    ok('配置未二次确认 → 428', r.status === 428 && r.data.error === 'SECOND_CONFIRM_REQUIRED', JSON.stringify(r.data));
    r = await req('PUT', '/api/special-budget/config', {
      key: 'http-cfg-2', body: { year: 2026, annualCap: 1200, reason: '试运行上调', secondConfirm: true },
    });
    ok('配置二次确认 → 200 / 1200 / 2026-v2 / 周六 120',
      r.status === 200 && r.data.config.annual_cap === 1200 &&
      r.data.config.rule_version === '2026-v2' && r.data.calculation.saturday_cap === 120,
      JSON.stringify(r.data));
    const rep = await req('PUT', '/api/special-budget/config', {
      key: 'http-cfg-2', body: { year: 2026, annualCap: 1200, reason: '试运行上调', secondConfirm: true },
    });
    ok('配置幂等重放', rep.status === 200 && rep.data.ok === true && rep.data.config.annual_cap === 1200,
      JSON.stringify(rep.data));
    const conf = await req('PUT', '/api/special-budget/config', {
      key: 'http-cfg-2', body: { year: 2026, annualCap: 1300, reason: '试运行上调', secondConfirm: true },
    });
    ok('配置同键换参 → 409', conf.status === 409 && conf.data.error === 'IDEMPOTENCY_CONFLICT', JSON.stringify(conf.data));
    r = await req('GET', '/api/special-budget/config?year=2026');
    ok('GET 配置含 2 条历史', r.status === 200 && r.data.config.annual_cap === 1200 &&
      r.data.history.length === 2, JSON.stringify(r.data.history && r.data.history.length));
    r = await req('PUT', '/api/special-budget/config', {
      key: 'http-cfg-bad', body: { year: 2025, annualCap: 1200, reason: '非法年份', secondConfirm: true },
    });
    ok('非法年份 → 400 INVALID_YEAR', r.status === 400 && r.data.error === 'INVALID_YEAR', JSON.stringify(r.data));

    // ---- 种子审批：批准 / 驳回 / 取消 ----
    const p1 = await seedPending({ amount: 300 });
    seeded.push(p1);
    r = await req('POST', `/api/special-budget/approvals/${p1}/approve`, {
      key: 'http-p1-appr', body: { approvedAmount: 300 },
    });
    ok('种子普通 300 批准 → 200', r.status === 200 && r.data.approval.status === 'approved' &&
      r.data.schedules.length === 1, JSON.stringify(r.data));

    const p2 = await seedPending({ amount: 100, purpose: '待驳回' });
    seeded.push(p2);
    r = await req('POST', `/api/special-budget/approvals/${p2}/reject`, {
      key: 'http-p2-reject', body: { reason: '不符合预算' },
    });
    ok('驳回 → 200 rejected', r.status === 200 && r.data.approval.status === 'rejected', JSON.stringify(r.data));
    r = await req('POST', `/api/special-budget/approvals/${p2}/approve`, {
      key: 'http-p2-approve', body: {},
    });
    ok('已驳回再批 → 409 NOT_PENDING', r.status === 409 && r.data.error === 'NOT_PENDING', JSON.stringify(r.data));

    const p3 = await seedPending({ amount: 100, purpose: '待取消' });
    seeded.push(p3);
    r = await req('POST', `/api/special-budget/approvals/${p3}/cancel`, {
      key: 'http-p3-cancel', body: {},
    });
    ok('取消 → 200 cancelled', r.status === 200 && r.data.approval.status === 'cancelled', JSON.stringify(r.data));

    // ---- 路由边界 ----
    r = await req('GET', '/api/special-budget/approvals/abc');
    ok('非法 ID → 400 INVALID_ID', r.status === 400 && r.data.error === 'INVALID_ID', JSON.stringify(r.data));
    r = await req('PUT', `/api/special-budget/approvals/${largeId}`, { body: {} });
    ok('PUT 审批详情 → 405 + Allow GET', r.status === 405 &&
      r.data.error === 'method_not_allowed' && r.allow === 'GET', JSON.stringify({ b: r.data, allow: r.allow }));
    r = await req('POST', '/api/special-budget/config', { body: {} });
    ok('POST 配置 → 405 + Allow GET, PUT', r.status === 405 &&
      r.data.error === 'method_not_allowed' && r.allow === 'GET, PUT', JSON.stringify({ b: r.data, allow: r.allow }));
    r = await req('GET', '/api/special-budget/unknown');
    ok('未知路径 → 404', r.status === 404 && r.data.error === 'not_found', JSON.stringify(r.data));

    // ---- 功能开关 ----
    cfg.SPECIAL_BUDGET_ENABLED = false;
    r = await req('GET', '/api/special-budget/approvals?year=2026');
    ok('开关关闭 → 审批 404', r.status === 404 && r.data.error === 'not_found', JSON.stringify(r.data));
    r = await req('GET', '/api/__probe');
    ok('开关关闭不影响其他 /api 路由', r.status === 200 && r.data.probe === true, JSON.stringify(r.data));
    cfg.SPECIAL_BUDGET_ENABLED = true;
  } catch (e) {
    console.error('FAIL', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    try {
      await db.exec('DELETE FROM special_budget_schedules');
      await db.exec('DELETE FROM special_budget_approvals');
      await db.exec('DELETE FROM special_budget_events');
      await db.exec('DELETE FROM special_budget_idempotency');
      await db.exec('DELETE FROM special_budget_rules');
      migrate('scripts/migrate-special-budget.js');
    } catch (e) {
      console.error('cleanup failed:', e.message);
    }
    cfg.SPECIAL_BUDGET_ENABLED = true;
    await new Promise(resolve => {
      server.close(resolve);
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
    await db.pool.end();
  }

  console.log(`\n${passed} passed${process.exitCode ? '（有失败）' : ''}`);
})();
