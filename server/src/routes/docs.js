'use strict';
// /api/budgets /api/recurring /api/cats —— KV 单文档语义平移到 MySQL JSON 列
const express = require('express');
const db = require('../db');
const H = require('../lib/helpers');
const { requireAuth, guard } = require('../middleware');

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

docEndpoint('/budgets', 'budgets', {});
docEndpoint('/recurring', 'recurring', { items: [] });
docEndpoint('/cats', 'cats', { list: [] });

module.exports = router;
