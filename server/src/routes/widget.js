'use strict';
// /api/widget/todos —— 桌面小组件只读接口（Scriptable / Widgy 等调用）
// 鉴权：Widget Token = base64url(username|expMs|sig)，HMAC-SHA256 签名，长期有效可随时吊销(换密钥)
// 注意：此路由挂载在 X-Service-Token 闸门之前，属于公网接口，只返回最小字段
const crypto = require('crypto');
const express = require('express');
const cfg = require('../config');
const db = require('../db');

const router = express.Router();
const TZ = 8 * 3600000;

function verifyWidgetToken(token) {
  if (!token || !cfg.WIDGET_SECRET) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', cfg.WIDGET_SECRET).update(parts[0]).digest('base64url');
  const a = Buffer.from(expected), b = Buffer.from(parts[1]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload.username || !payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

router.get('/widget/todos', async (req, res, next) => {
  try {
    const payload = verifyWidgetToken(req.query.token);
    if (!payload) return res.status(401).json({ error: 'invalid widget token' });
    const u = await db.one('SELECT id, username FROM users WHERE username = ?', [payload.username]);
    if (!u) return res.status(404).json({ error: 'user not found' });

    const rows = await db.query(
      "SELECT id, title, due_ms, priority, status, completed_ms, project_id FROM todos WHERE user_id = ? AND status IN ('待办','进行中') AND due_ms IS NOT NULL AND due_ms > 0 ORDER BY due_ms",
      [u.id]);

    const now = Date.now();
    const bj = new Date(now + TZ);
    const dayStart = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - TZ;
    const dayEnd = dayStart + 86400000;
    const fmt = ts => {
      const p = new Date(ts + TZ);
      const hh = p.getUTCHours(), mm = p.getUTCMinutes();
      return (hh === 0 && mm === 0) ? '' : String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    };

    const today = [], upcoming = [];
    for (const r of rows) {
      const item = { title: r.title, time: fmt(r.due_ms), p: r.priority || '中', ms: Number(r.due_ms) };
      if (r.due_ms >= dayStart && r.due_ms < dayEnd) today.push(item);
      else if (r.due_ms >= dayEnd) upcoming.push(item);
    }
    // 今日已完成数
    const doneRow = await db.one(
      "SELECT COUNT(*) AS n FROM todos WHERE user_id = ? AND status = '已完成' AND completed_ms >= ? AND completed_ms < ?",
      [u.id, dayStart, dayEnd]);

    res.json({
      ok: true,
      updatedAt: now,
      today: { count: today.length, done: Number(doneRow ? doneRow.n : 0), items: today.slice(0, 6) },
      upcoming: upcoming.slice(0, 5).map(x => ({ title: x.title, time: x.time, p: x.p })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
