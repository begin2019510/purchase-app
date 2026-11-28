'use strict';
// 特殊预算 v3.2.0 只读 API 测试（只操作 purchase_app_test 隔离库）
// 验证：功能开关 / 鉴权 / 年份参数 / 只读哨兵 / 汇总口径
// 用法: PURCHASE_SPECIAL_BUDGET=1 node server/test/special-budget-api.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';
process.env.PURCHASE_SPECIAL_BUDGET = '1';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const cfg = require('../src/config');
const db = require('../src/db');
const R = require('../src/lib/special-budget/rules');
const { parseJWT } = require('../src/middleware');

const USER = 'sb_api_test';
let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok', name); }
  else { console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); process.exitCode = 1; }
}

function migrateApply() {
  const r = spawnSync(process.execPath, ['scripts/migrate-special-budget.js', '--apply'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PURCHASE_DB_NAME: 'purchase_app_test' }),
    encoding: 'utf8',
    timeout: 60000,
  });
  if (r.status !== 0) throw new Error('migrate failed: ' + ((r.stdout || '') + (r.stderr || '')));
}

(async () => {
  if (!cfg.SERVICE_TOKEN) {
    console.error('FAIL 缺少 SERVICE_TOKEN（/etc/purchase-app/server.env）');
    process.exit(1);
  }
  migrateApply();

  // 配置恢复为默认值（测试库内）
  await db.exec('DELETE FROM special_budget_rules');
  migrateApply();
  await db.exec('DELETE FROM special_budget_schedules');
  await db.exec('DELETE FROM special_budget_approvals');
  await db.exec('DELETE FROM special_budget_events');

  const app = express();
  // 复刻 src/index.js 的中间件顺序：服务令牌闸门 → body → 身份 → 路由
  app.use('/api', (req, res, next) => {
    if (req.headers['x-service-token'] !== cfg.SERVICE_TOKEN) return res.status(403).json({ error: 'forbidden' });
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  app.use(parseJWT);
  app.use('/api', require('../src/routes/special-budget'));
  // 探针：模拟挂在特殊预算 router 之后的其他 /api 路由（images/report/claude）。
  // 功能开关关闭时这些路由必须不受影响。
  app.use('/api/__probe', (req, res) => res.json({ ok: true, probe: true }));
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;

  async function req(method, p, opts) {
    const o = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    if (o.token !== false) headers['X-Service-Token'] = cfg.SERVICE_TOKEN;
    if (o.auth !== false) headers['X-Auth-User'] = o.user || USER;
    const r = await fetch(base + p, {
      method,
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    let data = null;
    try { data = await r.json(); } catch (e) {}
    return { status: r.status, data };
  }

  let approvalId = null;
  try {
    // ---- 配置 ----
    let r = await req('GET', '/api/special-budget/config?year=2026');
    ok('2026 配置可读', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
    ok('2026 = 1000/800/周六 100/不跨年', r.data.config &&
      r.data.config.annual_cap === 1000 && r.data.config.monthly_regular_cap === 800 &&
      r.data.config.saturday_cap === 100 && r.data.config.cross_year_allowed === 0,
      JSON.stringify(r.data.config));
    ok('配置生效时间是北京时间字符串',
      r.data.config.effective_from === '2026-12-01 00:00:00', String(r.data.config.effective_from));

    r = await req('GET', '/api/special-budget/config?year=2027');
    ok('2027 = 10000/800/周六 1000/可跨年', r.status === 200 &&
      r.data.config.annual_cap === 10000 && r.data.config.saturday_cap === 1000 &&
      r.data.config.cross_year_allowed === 1, JSON.stringify(r.data));

    r = await req('GET', '/api/special-budget/config?year=2028');
    ok('未配置年份返回 404', r.status === 404 && r.data.error === 'config_not_found', JSON.stringify(r.data));

    // ---- 参数校验 ----
    for (const q of ['year=2025', 'year=2101', 'year=abc', 'year=', 'year=2026.5']) {
      r = await req('GET', '/api/special-budget/config?' + q);
      ok(`非法 ${q} 返回 400`, r.status === 400, JSON.stringify(r.data));
    }
    for (const q of ['month=0', 'month=13', 'month=abc', 'month=1.5']) {
      r = await req('GET', '/api/special-budget/summary?year=2026&' + q);
      ok(`非法 ${q} 返回 400`, r.status === 400, JSON.stringify(r.data));
    }

    // ---- 空账汇总 ----
    r = await req('GET', '/api/special-budget/summary?year=2026&month=12');
    ok('2026-12 空账汇总成功', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
    const s0 = r.data.summary;
    ok('空账：年度 1000 / 占用 0 / 剩余 1000',
      s0.annual_cap === 1000 && s0.annual_committed === 0 && s0.annual_remaining === 1000, JSON.stringify(s0));
    ok('空账：月度常规 800 / 可批 800',
      s0.monthly_regular_cap === 800 && s0.monthly_regular_approved === 0 && s0.monthly_regular_available === 800, JSON.stringify(s0));
    ok('空账：现金 0 / 无未来承诺 / 无审批',
      s0.monthly_cash === 0 && Array.isArray(s0.future_commitments) && s0.future_commitments.length === 0 &&
      s0.approvals.pending === 0 && s0.approvals.approved === 0, JSON.stringify(s0));
    ok('汇总标注全局口径与规则版本',
      r.data.calculation && r.data.calculation.scope === 'global' && r.data.calculation.rule_version === '2026-v1',
      JSON.stringify(r.data.calculation));
    ok('as_of 带 +08:00', /\+08:00$/.test(r.data.as_of), r.data.as_of);

    r = await req('GET', '/api/special-budget/summary?year=2027&month=1');
    ok('2027-01 空账汇总成功', r.status === 200 &&
      r.data.summary.annual_cap === 10000 && r.data.calculation.rule_version === '2027-v1', JSON.stringify(r.data));

    r = await req('GET', '/api/special-budget/summary?year=2028&month=1');
    ok('未配置年份汇总 404 CONFIG_MISSING', r.status === 404 && r.data.error === 'CONFIG_MISSING', JSON.stringify(r.data));

    // 默认月份 = 北京时间当月
    r = await req('GET', '/api/special-budget/summary?year=2026');
    const nowM = R.beijingParts(new Date()).month;
    ok('不传 month 默认北京时间当月', r.status === 200 && r.data.month === nowM, `${r.data.month} vs ${nowM}`);

    // ---- 鉴权 / 开关 / 只读 ----
    r = await req('GET', '/api/special-budget/config?year=2026', { auth: false });
    ok('无身份返回 401', r.status === 401, JSON.stringify(r.data));

    r = await req('GET', '/api/special-budget/config?year=2026', { token: false });
    ok('无服务令牌返回 403', r.status === 403 && r.data.error === 'forbidden', JSON.stringify(r.data));

    cfg.SPECIAL_BUDGET_ENABLED = false;
    r = await req('GET', '/api/special-budget/config?year=2026');
    ok('功能开关关闭时配置 404', r.status === 404 && r.data.error === 'not_found', JSON.stringify(r.data));
    r = await req('GET', '/api/special-budget/summary?year=2026&month=12');
    ok('功能开关关闭时汇总 404', r.status === 404 && r.data.error === 'not_found', JSON.stringify(r.data));
    r = await req('GET', '/api/__probe');
    ok('功能开关关闭不影响其他 /api 路由', r.status === 200 && r.data.probe === true, JSON.stringify(r.data));
    cfg.SPECIAL_BUDGET_ENABLED = true;

    r = await req('GET', '/api/__probe');
    ok('功能开关开启后其他 /api 路由仍正常', r.status === 200 && r.data.probe === true, JSON.stringify(r.data));

    r = await req('POST', '/api/special-budget/config', { body: { annual_cap: 99999 } });
    ok('POST 返回 405 method_not_allowed', r.status === 405 && r.data.error === 'method_not_allowed' &&
      r.data.allowed === 'GET, PUT', JSON.stringify(r.data));

    r = await req('GET', '/api/special-budget/unknown');
    ok('未知 GET 返回 404', r.status === 404 && r.data.error === 'not_found', JSON.stringify(r.data));

    // ---- 汇总口径（临时夹具，测完删除） ----
    const stamp = Date.now();
    const a = await db.exec(
      `INSERT INTO special_budget_approvals
         (approval_no, username, type, purpose, requested_amount, approved_amount, status, rule_version, applied_at, approved_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [`SB${stamp}A`, USER, 'normal', '单测正常申请', 300, 300, 'approved', '2026-v1',
        '2026-12-01 10:00:00', '2026-12-01 10:05:00']);
    approvalId = a.insertId;
    await db.exec(
      `INSERT INTO special_budget_approvals
         (approval_no, username, type, purpose, requested_amount, approved_amount, status, rule_version, applied_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [`SB${stamp}B`, USER, 'normal', '单测待审申请', 100, null, 'pending', '2026-v1', '2026-12-02 09:00:00']);
    await db.exec(
      `INSERT INTO special_budget_schedules
         (approval_id, seq, due_date, year, month, amount, status, paid_at, refunded_at, refund_amount)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [approvalId, 1, '2026-12-31', 2026, 12, 200, 'paid', '2026-12-10 12:00:00', '2026-12-20 09:00:00', 30]);
    await db.exec(
      `INSERT INTO special_budget_schedules
         (approval_id, seq, due_date, year, month, amount, status)
       VALUES (?,?,?,?,?,?,?)`,
      [approvalId, 2, '2026-12-31', 2026, 12, 50, 'planned']);
    await db.exec(
      `INSERT INTO special_budget_schedules
         (approval_id, seq, due_date, year, month, amount, status)
       VALUES (?,?,?,?,?,?,?)`,
      [approvalId, 3, '2027-01-31', 2027, 1, 100, 'planned']);

    r = await req('GET', '/api/special-budget/summary?year=2026&month=12');
    const s1 = r.status === 200 ? r.data.summary : {};
    ok('已批普通计入月度：已批 300 / 可批 500',
      s1.monthly_regular_approved === 300 && s1.monthly_regular_available === 500, JSON.stringify(s1));
    ok('审批计数：待审 1 / 已批 1',
      s1.approvals && s1.approvals.pending === 1 && s1.approvals.approved === 1, JSON.stringify(s1.approvals));
    ok('年度占用 = 计划 250 - 退款 30 = 220，剩余 780',
      s1.annual_committed === 220 && s1.annual_remaining === 780, JSON.stringify(s1));
    ok('年度已付 200 / 已退 30 / 已释放 0',
      s1.annual_paid === 200 && s1.annual_refunded === 30 && s1.annual_released === 0, JSON.stringify(s1));
    ok('本月到期未付 = 50', s1.monthly_installment_due === 50, JSON.stringify(s1));
    ok('本月现金 = 200 - 30 = 170', s1.monthly_cash === 170, JSON.stringify(s1));
    ok('未来承诺 = 2027 年 100',
      s1.future_commitments.length === 1 && s1.future_commitments[0].year === 2027 &&
      s1.future_commitments[0].amount === 100, JSON.stringify(s1.future_commitments));

    const cnt = await db.one('SELECT COUNT(*) AS c FROM special_budget_schedules');
    ok('只读接口不新增分期行', Number(cnt.c) === 3, `实际 ${cnt.c}`);
  } catch (e) {
    console.error('FAIL', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    try {
      if (approvalId) await db.exec('DELETE FROM special_budget_schedules WHERE approval_id = ?', [approvalId]);
      await db.exec('DELETE FROM special_budget_approvals WHERE username = ?', [USER]);
      await db.exec('DELETE FROM special_budget_schedules');
      await db.exec('DELETE FROM special_budget_approvals');
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
