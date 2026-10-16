'use strict';
const cfg = require('./config');
const { verifyJWT } = require('./jwt');

// JWT 鉴权：镜像 CF _auth.js authenticate()，payload 取 username
function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: '未登录' });
  const payload = verifyJWT(h.replace('Bearer ', ''), cfg.JWT_SECRET);
  if (!payload) return res.status(401).json({ error: 'Token无效或已过期' });
  req.user = payload;
  req.username = payload.username;
  next();
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.username !== 'admin') return res.status(403).json({ error: '仅管理员' });
  next();
}

// 真实用户 IP（CF 透传；限流用）
function clientIP(req) {
  return req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

module.exports = { authMiddleware, adminOnly, clientIP };
