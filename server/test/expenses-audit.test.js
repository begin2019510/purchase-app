'use strict';
// 支出审计日志端到端测试（只写 purchase_app_test 隔离库）
// 用法: node server/test/expenses-audit.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';

const assert = require('assert');
const express = require('express');
const db = require('../src/db');
const { parseJWT } = require('../src/middleware');

const USER = 'audit_expense_test_' + Date.now();
const IP = '203.0.113.9';

let passed = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(() => {
    passed++;
    console.log('  ok', name);
  });
}

async function req(base, method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Auth-User': USER,
      'CF-Connecting-IP': IP,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch (e) {}
  return { status: r.status, data };
}

async function logs(action) {
  return db.query(
    'SELECT * FROM op_logs WHERE username = ? AND action = ? ORDER BY id',
    [USER, action]);
}

(async () => {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(parseJWT);
  app.use('/api', require('../src/routes/expenses'));
  app.use('/api', require('../src/routes/projects'));
  app.use((err, req, res, next) => {
    console.error('test app error:', err && err.message);
    res.status(500).json({ error: 'internal_error' });
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;

  let uid;
  let projectId;
  let expenseId;
  let expenseId2;
  try {
    const u = await db.query(
      'INSERT INTO users (username,password_hash,salt) VALUES (?,?,?)',
      [USER, 'a'.repeat(64), 'b'.repeat(32)]);
    uid = u.insertId;
    const p = await db.query(
      "INSERT INTO projects (user_id,name,status,current_phase) VALUES (?,?,'进行中',0)",
      [uid, '审计测试项目']);
    projectId = p.insertId;

    await t('创建支出：写业务行 + expense_create 日志', async () => {
      const r = await req(base, 'POST', '/api/expenses', {
        amount: 12.34,
        type: '支出',
        category: '测试分类',
        date: '2026-11-26T10:00',
        note: '审计测试',
        splitWeeks: 2,
        splitStartWeek: '2026-11-23',
        projectId: 'rec_' + projectId,
        phaseIdx: 2,
        image: 'data:image/png;base64,SECRETBASE64TOKEN',
      });
      assert.strictEqual(r.status, 201, JSON.stringify(r.data));
      assert.ok(/^rec_\d+$/.test(r.data.id));
      expenseId = r.data.id;

      const row = await db.one('SELECT * FROM expenses WHERE id = ? AND user_id = ?', [Number(r.data.id.slice(4)), uid]);
      assert.ok(row);
      assert.strictEqual(Number(row.amount), 12.34);
      assert.strictEqual(row.category, '测试分类');
      assert.strictEqual(Number(row.split_weeks), 2);
      assert.strictEqual(row.split_start_week, '2026-11-23');
      assert.strictEqual(Number(row.project_id), projectId);
      assert.strictEqual(Number(row.phase_idx), 2);

      const ls = await logs('expense_create');
      assert.strictEqual(ls.length, 1);
      assert.strictEqual(ls[0].ip, IP);
      assert.ok(ls[0].detail.includes('"amount":12.34'));
      assert.ok(ls[0].detail.includes('"projectId":"rec_' + projectId + '"'));
      assert.ok(ls[0].detail.includes('"phaseIdx":2'));
      assert.ok(ls[0].detail.includes('"images":{"count":1,"refs":["[inline-image:'));
      assert.ok(!ls[0].detail.includes('SECRETBASE64TOKEN'), '日志不得包含图片 base64');
      assert.ok(/"at":"[^"]+\+08:00"/.test(ls[0].detail), 'detail 应带北京时间');
      assert.ok(ls[0].log_date);
    });

    await t('修改支出：记录 before/after 与实际变更字段', async () => {
      const r = await req(base, 'PUT', '/api/expenses', {
        id: expenseId,
        amount: 23.45,
        note: '审计测试-改',
        imageKeys: ['audit-kv-1'],
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));

      const row = await db.one('SELECT * FROM expenses WHERE id = ? AND user_id = ?', [Number(expenseId.slice(4)), uid]);
      assert.strictEqual(Number(row.amount), 23.45);
      assert.strictEqual(row.image_ref, 'kv:audit-kv-1');

      const ls = await logs('expense_update');
      assert.strictEqual(ls.length, 1);
      assert.ok(ls[0].detail.includes('"changed":["amount","note","images"]'));
      assert.ok(ls[0].detail.includes('"before":') && ls[0].detail.includes('"after":'));
      assert.ok(ls[0].detail.includes('"amount":23.45'));
      assert.ok(ls[0].detail.includes('"refs":["kv:audit-kv-1"]'));
      assert.ok(!ls[0].detail.includes('SECRETBASE64TOKEN'));
    });

    await t('原值提交不产生伪变更日志', async () => {
      const before = (await logs('expense_update')).length;
      const r = await req(base, 'PUT', '/api/expenses', { id: expenseId, amount: 23.45 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      const after = (await logs('expense_update')).length;
      assert.strictEqual(after, before);
    });

    await t('非法修改回滚且不留日志', async () => {
      const before = (await logs('expense_update')).length;
      const r = await req(base, 'PUT', '/api/expenses', { id: expenseId, amount: -1 });
      assert.strictEqual(r.status, 400);
      const after = (await logs('expense_update')).length;
      assert.strictEqual(after, before);
    });

    await t('物理删除仍执行，但删除前快照写入 expense_delete', async () => {
      const r = await req(base, 'DELETE', '/api/expenses?id=' + encodeURIComponent(expenseId));
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      const row = await db.one('SELECT * FROM expenses WHERE id = ? AND user_id = ?', [Number(expenseId.slice(4)), uid]);
      assert.strictEqual(row, null);

      const ls = await logs('expense_delete');
      assert.strictEqual(ls.length, 1);
      assert.ok(ls[0].detail.includes('"deleted":true'));
      assert.ok(ls[0].detail.includes('"amount":23.45'));
      assert.ok(ls[0].detail.includes('"note":"审计测试-改"'));
      assert.ok(ls[0].detail.includes('"refs":["kv:audit-kv-1"]'));
    });

    await t('删除项目导致支出解绑：逐条记录 expense_update', async () => {
      const p = await db.query(
        "INSERT INTO projects (user_id,name,status,current_phase) VALUES (?,?,'进行中',0)",
        [uid, '待删除项目']);
      const pid = p.insertId;
      const cr = await req(base, 'POST', '/api/expenses', {
        amount: 5,
        category: '测试分类',
        date: '2026-11-26T11:00',
        projectId: 'rec_' + pid,
        phaseIdx: 3,
      });
      assert.strictEqual(cr.status, 201, JSON.stringify(cr.data));
      expenseId2 = cr.data.id;

      const dr = await req(base, 'DELETE', '/api/projects?id=' + encodeURIComponent('rec_' + pid));
      assert.strictEqual(dr.status, 200, JSON.stringify(dr.data));

      const row = await db.one('SELECT * FROM expenses WHERE id = ? AND user_id = ?', [Number(expenseId2.slice(4)), uid]);
      assert.ok(row, '支出行应保留');
      assert.strictEqual(row.project_id, null);
      assert.strictEqual(row.phase_idx, null);

      const ls = (await logs('expense_update')).filter(x => x.detail.includes('"source":"project_delete"'));
      assert.strictEqual(ls.length, 1);
      assert.ok(ls[0].detail.includes('"changed":["projectId","phaseIdx"]'));
      assert.ok(ls[0].detail.includes('"before":{"id":"' + expenseId2 + '"'));
      assert.ok(ls[0].detail.includes('"projectId":null'));
      const proj = await db.one('SELECT id FROM projects WHERE id = ? AND user_id = ?', [pid, uid]);
      assert.strictEqual(proj, null);
    });

    await t('清理测试数据', async () => {
      const all = await db.query('SELECT action, COUNT(*) n FROM op_logs WHERE username = ? GROUP BY action ORDER BY action', [USER]);
      assert.deepStrictEqual(all.map(x => [x.action, Number(x.n)]), [
        ['expense_create', 2],
        ['expense_delete', 1],
        ['expense_update', 2],
      ]);
    });
  } finally {
    try {
      if (expenseId2) {
        await req(base, 'DELETE', '/api/expenses?id=' + encodeURIComponent(expenseId2)).catch(() => {});
      }
    } catch (e) {}
    await db.query('DELETE FROM op_logs WHERE username = ?', [USER]);
    await db.query('DELETE FROM expenses WHERE user_id = ?', [uid || -1]);
    await db.query('DELETE FROM projects WHERE user_id = ?', [uid || -1]);
    await db.query('DELETE FROM users WHERE id = ?', [uid || -1]);
    await new Promise(resolve => {
      server.close(resolve);
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
    await db.pool.end();
  }

  console.log(`\n${passed} passed`);
})().catch(e => {
  console.error('FAIL', e && e.stack || e);
  process.exitCode = 1;
});
