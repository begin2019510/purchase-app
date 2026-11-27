'use strict';
// 预算审计日志端到端测试（只写 purchase_app_test 隔离库）
// 用法: node server/test/budgets-audit.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';

const assert = require('assert');
const express = require('express');
const db = require('../src/db');
const H = require('../src/lib/helpers');
const { parseJWT } = require('../src/middleware');

const USER = 'audit_budget_test_' + Date.now();
const IP = '203.0.113.17';

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

async function budgetRow(uid) {
  const row = await db.one('SELECT data FROM budgets WHERE user_id = ?', [uid]);
  if (!row) return null;
  return { data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data };
}

function docBody(doc) {
  return JSON.parse(JSON.stringify(doc));
}

const addition = (id, amt, src, ts) => ({ id, amt, src, note: '', ts });

(async () => {
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use(parseJWT);
  app.use('/api', require('../src/routes/docs'));
  app.use((err, req, res, next) => {
    console.error('test app error:', err && err.message);
    res.status(500).json({ error: 'internal_error' });
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;

  let uid;
  const originalLogOpTx = H.logOpTx;
  try {
    const u = await db.query(
      'INSERT INTO users (username,password_hash,salt) VALUES (?,?,?)',
      [USER, 'a'.repeat(64), 'b'.repeat(32)]);
    uid = u.insertId;

    const initial = {
      '2026-10': {
        total: 3200,
        perWeek: 0,
        weeks: {},
        additions: [
          addition('a1', 500, '国庆特别资金', 1760786328000),
          addition('a2', 200, '生日月特别资金', 1761059552000),
          addition('a3', 500, '大连旅游特别资金', 1761495114000),
        ],
      },
      '2026-11': { total: 2000, perWeek: 0, weeks: {}, additions: [] },
    };

    await t('空文档读取不报错', async () => {
      const r = await req(base, 'GET', '/api/budgets');
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.data.data, {});
    });

    await t('首次写入：budget_create 记录历史月、基础预算与 3 笔追加', async () => {
      const r = await req(base, 'POST', '/api/budgets', { data: initial });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      assert.strictEqual(r.data.changed, 2);

      const row = await budgetRow(uid);
      assert.ok(row);
      assert.strictEqual(row.data['2026-10'].total, 3200);

      const ls = await logs('budget_create');
      assert.strictEqual(ls.length, 1);
      assert.strictEqual(ls[0].ip, IP);
      const d = JSON.parse(ls[0].detail);
      assert.deepStrictEqual(d.changedMonths, ['2026-10', '2026-11']);
      assert.strictEqual(d.source, 'api');
      assert.ok(/\+08:00$/.test(d.at), 'at 应带北京时间偏移');
      const oct = d.summary.find(x => x.month === '2026-10');
      assert.strictEqual(oct.totalBefore, 0);
      assert.strictEqual(oct.totalAfter, 3200);
      assert.strictEqual(oct.baseAfter, 2000);
      assert.strictEqual(oct.additionsAfter, 3);
      assert.strictEqual(d.after['2026-10'].additions[0].src, '国庆特别资金');
      assert.ok(ls[0].log_date);
    });

    await t('原样重复提交不产生伪变更日志', async () => {
      const before = (await logs('budget_create')).length + (await logs('budget_update')).length;
      const r = await req(base, 'POST', '/api/budgets', { data: docBody(initial) });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      assert.strictEqual(r.data.changed, 0);
      const after = (await logs('budget_create')).length + (await logs('budget_update')).length;
      assert.strictEqual(after, before);
    });

    await t('新增追加：记录 additionsAdded 且基础预算不变', async () => {
      const doc = docBody(initial);
      doc['2026-10'].total = 3400;
      doc['2026-10'].additions.push(addition('a4', 200, '退款回收', 1762000000000));
      const r = await req(base, 'POST', '/api/budgets', { data: doc });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      assert.strictEqual(r.data.changed, 1);

      const ls = await logs('budget_update');
      assert.strictEqual(ls.length, 1);
      const d = JSON.parse(ls[0].detail);
      assert.deepStrictEqual(d.changedMonths, ['2026-10']);
      const s = d.summary[0];
      assert.strictEqual(s.totalBefore, 3200);
      assert.strictEqual(s.totalAfter, 3400);
      assert.strictEqual(s.baseBefore, 2000);
      assert.strictEqual(s.baseAfter, 2000);
      assert.strictEqual(s.additionsAdded.length, 1);
      assert.strictEqual(s.additionsAdded[0].src, '退款回收');
      assert.strictEqual(s.additionsRemoved.length, 0);
      assert.ok(!Object.prototype.hasOwnProperty.call(d.before, '2026-11'), '未变化月份不进入 before/after');
    });

    await t('删除追加：记录 additionsRemoved', async () => {
      const doc = docBody(initial);
      doc['2026-10'].additions = doc['2026-10'].additions.filter(a => a.id !== 'a4');
      doc['2026-10'].total = 3200;
      const r = await req(base, 'POST', '/api/budgets', { data: doc });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));

      const ls = await logs('budget_update');
      assert.strictEqual(ls.length, 2);
      const s = JSON.parse(ls[1].detail).summary[0];
      assert.strictEqual(s.totalBefore, 3400);
      assert.strictEqual(s.totalAfter, 3200);
      assert.strictEqual(s.additionsRemoved.length, 1);
      assert.strictEqual(s.additionsRemoved[0].id, 'a4');
      assert.strictEqual(s.baseAfter, 2000);
    });

    await t('只改总额：基础预算差异可审计', async () => {
      const doc = docBody(initial);
      doc['2026-10'].total = 3000;
      const r = await req(base, 'POST', '/api/budgets', { data: doc });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));

      const ls = await logs('budget_update');
      assert.strictEqual(ls.length, 3);
      const s = JSON.parse(ls[2].detail).summary[0];
      assert.strictEqual(s.totalBefore, 3200);
      assert.strictEqual(s.totalAfter, 3000);
      assert.strictEqual(s.baseBefore, 2000);
      assert.strictEqual(s.baseAfter, 1800);
      assert.strictEqual(s.additionsBefore, 3);
      assert.strictEqual(s.additionsAfter, 3);
    });

    await t('日志写入失败时预算写入回滚，不产生无日志修改', async () => {
      const beforeLogs = (await logs('budget_update')).length;
      H.logOpTx = async function () { throw new Error('forced audit failure'); };
      let r;
      try {
        const doc = docBody(initial);
        doc['2026-10'].total = 3500;
        r = await req(base, 'POST', '/api/budgets', { data: doc });
      } finally {
        H.logOpTx = originalLogOpTx;
      }
      assert.strictEqual(r.status, 500);
      const row = await budgetRow(uid);
      assert.strictEqual(row.data['2026-10'].total, 3000, '预算应保持失败前的值');
      assert.strictEqual((await logs('budget_update')).length, beforeLogs);
    });

    await t('非法数组载荷返回 400，不写日志', async () => {
      const beforeLogs = (await logs('budget_update')).length;
      const r = await req(base, 'POST', '/api/budgets', { data: [1, 2, 3] });
      assert.strictEqual(r.status, 400);
      assert.strictEqual((await logs('budget_update')).length, beforeLogs);
    });

    await t('清空全部月份：budget_delete 保留删除前月份清单', async () => {
      const r = await req(base, 'POST', '/api/budgets', { data: {} });
      assert.strictEqual(r.status, 200, JSON.stringify(r.data));
      assert.strictEqual(r.data.changed, 2);
      const row = await budgetRow(uid);
      assert.deepStrictEqual(row.data, {});

      const ls = await logs('budget_delete');
      assert.strictEqual(ls.length, 1);
      const d = JSON.parse(ls[0].detail);
      assert.deepStrictEqual(d.changedMonths, ['2026-10', '2026-11']);
      assert.strictEqual(d.before['2026-10'].total, 3000);
      assert.deepStrictEqual(d.after, {});
    });

    await t('日志动作与次数汇总', async () => {
      const all = await db.query(
        'SELECT action, COUNT(*) n FROM op_logs WHERE username = ? GROUP BY action ORDER BY action',
        [USER]);
      assert.deepStrictEqual(all.map(x => [x.action, Number(x.n)]), [
        ['budget_create', 1],
        ['budget_delete', 1],
        ['budget_update', 3],
      ]);
    });
  } finally {
    H.logOpTx = originalLogOpTx;
    await db.query('DELETE FROM op_logs WHERE username = ?', [USER]);
    await db.query('DELETE FROM budgets WHERE user_id = ?', [uid || -1]);
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
