'use strict';
// 与 Cloudflare Functions _auth.js 的自研 JWT 逐字节兼容：
// header/payload = 标准 base64 去 padding（非 base64url），signature = base64url 去 padding
const crypto = require('crypto');

function enc(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '');
}
function dec(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function signPart(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createJWT(payload, secret, expiresInHours = 24) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + Math.round(expiresInHours * 3600) };
  const token = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc(body);
  return token + '.' + signPart(token, secret);
}

function verifyJWT(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = signPart(parts[0] + '.' + parts[1], secret);
  const a = Buffer.from(expected), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(dec(parts[1])); } catch { return null; }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

module.exports = { createJWT, verifyJWT };
