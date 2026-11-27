'use strict';
// /api/budgets /api/recurring /api/cats —— KV 单文档语义平移到 MySQL JSON 列
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const B = require('../lib/budget-audit');
const { guard, clientIP } = require('../middleware');

const router = express.Router();
router.use(guard(['budgets', 'recurring', 'cats']));

function docEndpoint(path, table, empty) {
  router.get(path, async (req, res, next) => {
    try {
      const uid = await H.resolveUserId(req.username);
      if (!uid) return res.json({ ok: true, data: empty });
      const row = await db.one('SELECT data FROM ' + table + ' WHERE user_id = ?', [uid]);
      if (!row) return res.json({ ok: true, data: empty });
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      res.json({ ok: true, data });
    } catch (e) { next(e); }
  });
  const write = async (req, res, next) => {
    try {
      const uid = await H.resolveUserId(req.username);
      if (!uid) return res.status(401).json({ error: '用户不存在' });
      const payload = req.body && req.body.data !== undefined ? req.body.data : (req.body || empty);
      await db.exec('INSERT INTO ' + table + ' (user_id, data) VALUES (?,?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
        [uid, JSON.stringify(payload)]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  };
  router.post(path, write);
  router.put(path, write);
}

// 预算：先锁行读旧文档 → 只写真正变化的月份 → 同事务写 op_logs。
// 整份 JSON 全量覆盖的写法保留（前端/MCP 均如此），但每笔变更都能回答
// “哪个历史月、从多少变到多少、基础预算/追加怎么变、谁在什么时间/ IP 改的”。
function budgetEndpoint() {
  const read = async (req, res, next) => {
    try {
      const uid = await H.resolveUserId(req.username);
      if (!uid) return res.json({ ok: true, data: {} });
      const row = await db.one('SELECT data FROM budgets WHERE user_id = ?', [uid]);
      res.json({ ok: true, data: B.parseDoc(row && row.data) });
    } catch (e) { next(e); }
  };

  const write = async (req, res, next) => {
    try {
      const uid = await H.resolveUserId(req.username);
      if (!uid) return res.status(401).json({ error: '用户不存在' });

      const raw = req.body && req.body.data !== undefined ? req.body.data : (req.body || {});
      const after = B.normalizePayload(raw);
      if (!after) return res.status(400).json({ error: '预算数据必须是对象' });
      const serialized = JSON.stringify(after);
      if (serialized.length > 256 * 1024) {
        return res.status(413).json({ error: '预算数据过大' });
      }

      const conn = await db.pool.getConnection();
      try {
        await conn.beginTransaction();
        const [rows] = await conn.query('SELECT data FROM budgets WHERE user_id = ? FOR UPDATE', [uid]);
        const before = rows[0] ? B.parseDoc(rows[0].data) : {};
        const changed = B.changedKeys(before, after);

        if (changed.length) {
          await conn.query(
            'INSERT INTO budgets (user_id, data) VALUES (?,?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
            [uid, serialized]);
          await H.logOpTx(conn, req.username, B.actionFor(before, after),
            B.buildDetail('api', before, after, changed), clientIP(req));
        }
        await conn.commit();
        res.json({ ok: true, changed: changed.length });
      } catch (e) {
        try { await conn.rollback(); } catch (x) { /* 已断开的连接 */ }
        throw e;
      } finally {
        conn.release();
      }
    } catch (e) { next(e); }
  };

  router.get('/budgets', read);
  router.post('/budgets', write);
  router.put('/budgets', write);
}

budgetEndpoint();
docEndpoint('/recurring', 'recurring', { items: [] });
docEndpoint('/cats', 'cats', { list: [] });

module.exports = router;
