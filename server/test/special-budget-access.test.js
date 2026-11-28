'use strict';
// 特殊预算 v3.2.5 修复回归：删除用户清理 + 活跃用户校验 + 管理员闸门（只操作 purchase_app_test）
// 覆盖：
//   - 已删除/不存在账号的旧 JWT（X-Auth-User）访问特殊预算 → 401；
//   - 删除用户时清掉 username 维度的审批/分期/关联/事件/幂等键，但保留全局规则/快照；
//   - 非管理员不能改年度配置 / 生成快照（403），管理员可正常生成。
// 用法: PURCHASE_DB_NAME=purchase_app_test PURCHASE_SPECIAL_BUDGET=1 node server/test/special-budget-access.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';
process.env.PURCHASE_SPECIAL_BUDGET = '1';

const path = require('path');
const { spawnSync } = require('child_process');
const express = require('express');
const cfg = require('../src/config');
const db = require('../src/db');
const { parseJWT } = require('../src/middleware');

const U = 'sb_del_u';
const KEEP = 'sb_keep_u';
const ADMIN = 'sb_access_admin';
let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok', name); }
  else { console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); process.exitCode = 1; }
}

function migrate(script) {
  const r = spawnSync(process.execPath, [script, '--apply'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PURCHASE_DB_NAME: 'purchase_app_test' }),
    encoding: 'utf8', timeout: 60000,
  });
  if (r.status !== 0) throw new Error(script + ' failed: ' + ((r.stdout || '') + (r.stderr || '')));
}
async function count(table, where, params) {
  const row = await db.one(`SELECT COUNT(*) AS c FROM ${table}${where ? ' WHERE ' + where : ''}`, params || []);
  return Number(row && row.c);
}
async function ensureUser(name, isAdmin) {
  const row = await db.one('SELECT id FROM users WHERE username = ?', [name]);
  if (row) {
    if (isAdmin) await db.exec('UPDATE users SET is_admin = 1 WHERE username = ?', [name]);
    return row.id;
  }
  const ins = await db.exec(
    'INSERT INTO users (username, password_hash, salt, hash_version, is_admin) VALUES (?,?,?,1,?)',
    [name, '0'.repeat(64), '0'.repeat(32), isAdmin ? 1 : 0]);
  return ins.insertId;
}
async function seedApproval(username, amount) {
  const stamp = Date.now() + Math.random().toString(36).slice(2, 7);
  const r = await db.exec(
    `INSERT INTO special_budget_approvals
       (approval_no, username, type, purpose, requested_amount, approved_amount, status, rule_version, applied_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ['SBDEL' + stamp.slice(-12), username, 'normal', '删除清理测试', amount, amount, 'approved', '2026-v1',
      '2026-12-01 10:00:00']);
  const id = Number(r.insertId);
  const s = await db.exec(
    `INSERT INTO special_budget_schedules (approval_id, seq, due_date, year, month, amount, status, paid_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, 1, '2026-12-31', 2026, 12, amount, 'paid', '2026-12-10 12:00:00']);
  await db.exec(
    `INSERT INTO special_budget_events (approval_id, schedule_id, event_type, amount, actor, at)
     VALUES (?,?,?,?,?,?)`,
    [id, s.insertId, 'pay', amount, username, '2026-12-10 12:00:00']);
  await db.exec(
    `INSERT INTO special_budget_idempotency
       (username, scope, idem_key, request_hash, status_code, response_json)
     VALUES (?,?,?,?,?,?)`,
    [username, 'test.scope', 'key-' + stamp.slice(-12), 'a'.repeat(64), 200, '{"ok":true}']);
  return { approvalId: id, scheduleId: Number(s.insertId) };
}

(async () => {
  if (!cfg.SERVICE_TOKEN) { console.error('FAIL 缺少 SERVICE_TOKEN'); process.exit(1); }
  let server = null;
  try {
    migrate('scripts/migrate-special-budget.js');
    migrate('scripts/migrate-special-budget-v321.js');
    for (const t of ['special_budget_idempotency', 'special_budget_events', 'special_budget_schedules',
      'special_budget_links', 'special_budget_approvals', 'special_budget_snapshots']) {
      await db.exec(`DELETE FROM ${t}`);
    }
    await db.exec('DELETE FROM users WHERE username IN (?,?,?)', [U, KEEP, ADMIN]);
    const uid = await ensureUser(U, false);
    const keepId = await ensureUser(KEEP, false);
    await ensureUser(ADMIN, true);

    const target = await seedApproval(U, 300);
    const kept = await seedApproval(KEEP, 200);

    // 目标用户的采购单/需求/关联（验证按 order_id 的兜底清理）
    const need = await db.exec(
      'INSERT INTO purchase_needs (user_id, name, status, category) VALUES (?,?,?,?)',
      [uid, '删除清理需求', '已定点', '其他']);
    const order = await db.exec(
      `INSERT INTO purchase_orders
         (user_id, need_id, role, qty, price_paid, status, date_ms, budget_type, special_approval_id)
       VALUES (?,?, 'formal', 1, 300, '已下单', ?, 'special', ?)`,
      [uid, need.insertId, Date.parse('2026-12-10T10:00:00+08:00'), target.approvalId]);
    await db.exec(
      `INSERT INTO special_budget_links
         (approval_id, order_id, link_type, linked_amount, status, linked_at)
       VALUES (?,?,?,?, 'active', ?)`,
      [target.approvalId, order.insertId, 'order', 300, '2026-12-10 10:00:00']);

    const rulesBefore = await count('special_budget_rules');
    const snapBefore = await count('special_budget_snapshots');

    const app = express();
    app.use('/api', (req, res, next) => {
      if (req.headers['x-service-token'] !== cfg.SERVICE_TOKEN) return res.status(403).json({ error: 'forbidden' });
      next();
    });
    app.use(express.json({ limit: '8mb' }));
    app.use(parseJWT);
    app.use('/api', require('../src/routes/auth'));
    app.use('/api', require('../src/routes/special-budget'));
    app.use((req, res) => res.status(404).json({ error: 'not_found' }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;

    async function req(method, p, opts) {
      const o = opts || {};
      const headers = { 'Content-Type': 'application/json', 'X-Service-Token': cfg.SERVICE_TOKEN };
      if (o.auth !== false) headers['X-Auth-User'] = o.user || U;
      if (o.key) headers['Idempotency-Key'] = o.key;
      const r = await fetch(base + p, {
        method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body),
      });
      let data = null;
      try { data = await r.json(); } catch (e) {}
      return { status: r.status, data };
    }

    // ---- 活跃用户校验 ----
    let r = await req('GET', '/api/special-budget/summary?year=2026&month=12');
    ok('活跃用户可正常读汇总', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));
    ok('普通用户 summary.is_admin=false', r.data.is_admin === false, String(r.data.is_admin));
    r = await req('GET', '/api/special-budget/summary?year=2026&month=12', { user: 'sb_ghost_user' });
    ok('不存在账号（旧 JWT 场景）→ 401', r.status === 401, JSON.stringify(r.data));
    r = await req('POST', '/api/special-budget/approvals', {
      user: 'sb_ghost_user', key: 'ghost-write-1', body: { type: 'normal', amount: 100, purpose: 'x' },
    });
    ok('不存在账号不能提交申请 → 401', r.status === 401, JSON.stringify(r.data));

    // ---- 管理员闸门 ----
    r = await req('PUT', '/api/special-budget/config', {
      key: 'acc-cfg-nonadmin', body: { year: 2026, annualCap: 1200, reason: '非管理员', secondConfirm: true },
    });
    ok('非管理员改配置 → 403 FORBIDDEN', r.status === 403 && r.data.error === 'FORBIDDEN', JSON.stringify(r.data));
    r = await req('POST', '/api/special-budget/snapshots', {
      key: 'acc-snap-nonadmin', body: { year: 2026, month: 12 },
    });
    ok('非管理员生成快照 → 403 FORBIDDEN', r.status === 403 && r.data.error === 'FORBIDDEN', JSON.stringify(r.data));
    r = await req('POST', '/api/special-budget/snapshots', {
      user: ADMIN, key: 'acc-snap-admin', body: { year: 2026, month: 11 },
    });
    ok('管理员生成快照 → 200', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));

    // ---- 删除用户 ----
    // 既有管理动作仍按字面用户名 'admin' 鉴权（本次不改历史契约）
    r = await req('POST', '/api/auth?action=delete-user', {
      user: 'admin', body: { username: U },
    });
    ok('管理员删除用户 → 200', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));

    ok('目标用户审批单已清理', await count('special_budget_approvals', 'username = ?', [U]) === 0);
    ok('目标用户分期已清理', await count('special_budget_schedules', 'approval_id = ?', [target.approvalId]) === 0);
    ok('目标用户关联已清理', await count('special_budget_links', 'approval_id = ?', [target.approvalId]) === 0);
    ok('目标用户事件已清理', await count('special_budget_events', 'approval_id = ?', [target.approvalId]) === 0);
    ok('目标用户幂等键已清理', await count('special_budget_idempotency', 'username = ?', [U]) === 0);
    ok('目标用户采购单已清理', await count('purchase_orders', 'user_id = ?', [uid]) === 0);
    ok('目标用户需求已清理', await count('purchase_needs', 'user_id = ?', [uid]) === 0);

    ok('其他用户审批保留', await count('special_budget_approvals', 'username = ?', [KEEP]) === 1);
    ok('其他用户分期保留', await count('special_budget_schedules', 'approval_id = ?', [kept.approvalId]) === 1);
    ok('全局年度规则保留', await count('special_budget_rules') === rulesBefore);
    ok('全局快照保留（删除用户不删快照）', await count('special_budget_snapshots') === snapBefore + 1,
      `before=${snapBefore}`);

    r = await req('GET', '/api/special-budget/summary?year=2026&month=12');
    ok('删除后旧身份访问 → 401', r.status === 401, JSON.stringify(r.data));
    r = await req('GET', '/api/special-budget/summary?year=2026&month=12', { user: KEEP });
    ok('其他用户不受影响', r.status === 200 && r.data.ok === true, JSON.stringify(r.data));

    await db.exec('DELETE FROM purchase_orders WHERE user_id = ?', [keepId]);
  } catch (e) {
    console.error('FAIL', e && (e.stack || e.message));
    process.exitCode = 1;
  } finally {
    try {
      for (const name of [U, KEEP]) {
        const rows = await db.query('SELECT id FROM special_budget_approvals WHERE username = ?', [name]);
        for (const row of rows) {
          await db.exec('DELETE FROM special_budget_events WHERE approval_id = ?', [row.id]);
          await db.exec('DELETE FROM special_budget_schedules WHERE approval_id = ?', [row.id]);
          await db.exec('DELETE FROM special_budget_links WHERE approval_id = ?', [row.id]);
        }
        await db.exec('DELETE FROM special_budget_approvals WHERE username = ?', [name]);
        await db.exec('DELETE FROM special_budget_idempotency WHERE username = ?', [name]);
      }
      await db.exec('DELETE FROM special_budget_snapshots');
      await db.exec('DELETE FROM users WHERE username IN (?,?,?)', [U, KEEP, ADMIN]);
    } catch (e) { console.error('cleanup failed:', e.message); }
    if (server) await new Promise(resolve => server.close(resolve));
    await db.pool.end().catch(() => {});
  }
  console.log('\n' + (process.exitCode ? 'FAILED' : 'PASSED') + ' · ' + passed + ' assertions');
})();
