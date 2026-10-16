'use strict';
const cfg = require('./config');
const { verifyJWT } = require('./jwt');

// 全局：有 Bearer 就解析（不强制）
function parseJWT(req, res, next) {
  req.user = null;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) {
    const p = verifyJWT(h.replace('Bearer ', ''), cfg.JWT_SECRET);
    if (p) req.user = p;
  }
  next();
}

// 强制登录：业务路由挂载前调用
function requireAuth(req, res, next) {
  if (!req.user || !req.user.username) return res.status(401).json({ error: '未授权：请登录' });
  req.username = req.user.username;
  next();
}

// 路径守卫：仅对本模块的路径强制登录，其他请求直接跳过本 router
function guard(paths) {
  const re = new RegExp('^/(' + paths.join('|') + ')(/|$)');
  return function (req, res, next) {
    if (!re.test(req.path)) return next('router');
    requireAuth(req, res, next);
  };
}

function clientIP(req) {
  return req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

module.exports = { parseJWT, requireAuth, guard, clientIP };
