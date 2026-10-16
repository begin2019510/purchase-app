'use strict';
// /api/auth?action=... 全量镜像 CF functions/api/auth.js 的请求/响应契约
const crypto = require('crypto');
const express = require('express');
const cfg = require('../config');
const db = require('../db');
const { createJWT, verifyJWT } = require('../jwt');
const H = require('../lib/helpers');

const router = express.Router();

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function genSalt() { return crypto.randomBytes(16).toString('hex'); }
async function hashPwd(password, salt, ver) {
  if (ver === 2) return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return sha256(salt + password);
}
function newInviteCode() {
  return 'inv_' + Array.from(crypto.randomBytes(6)).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

async function getUser(username) {
  return db.one('SELECT * FROM users WHERE username = ?', [username]);
}
async function validateInvite(code) {
  const envCodes = (cfg.INVITE_CODES || '').split(',').map(c => c.trim()).filter(Boolean);
  if (envCodes.includes(code)) return { valid: true, type: 'env' };
  const row = await db.one('SELECT * FROM invites WHERE code = ? AND used = 0', [code]);
  if (row) {
    await db.exec('UPDATE invites SET used = 1, used_at = NOW() WHERE id = ?', [row.id]);
    return { valid: true, type: 'dynamic' };
  }
  return { valid: false };
}
async function issueTokens(userId, username) {
  const token = createJWT({ username }, cfg.JWT_SECRET, 24);
  const refreshToken = crypto.randomUUID();
  await db.exec('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?,?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
    [userId, sha256(refreshToken)]);
  return { token, refreshToken };
}

// ---- 登录限流（15 分钟 5 次，镜像 CF）----
async function rateCheck(ip) {
  const row = await db.one('SELECT times FROM login_fails WHERE ip = ?', [ip]);
  const now = Date.now();
  const recent = row ? (JSON.parse(row.times || '[]')).filter(t => now - t < 900000) : [];
  if (recent.length >= 5) {
    const waitSec = Math.ceil((Math.min(...recent) + 900000 - now) / 1000);
    return { blocked: true, waitSec, recent };
  }
  return { blocked: false, recent };
}
async function rateRecord(ip, recent) {
  const next = [...(recent || []), Date.now()].filter(t => Date.now() - t < 900000);
  await db.exec('INSERT INTO login_fails (ip, times) VALUES (?,?) ON DUPLICATE KEY UPDATE times = VALUES(times)',
    [ip, JSON.stringify(next)]);
}

// 局部解析 JWT（不强制）：verify/管理员动作使用
router.use('/auth', (req, res, next) => {
  req.user = null;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) {
    const p = verifyJWT(h.replace('Bearer ', ''), cfg.JWT_SECRET);
    if (p) req.user = p;
  }
  next();
});

// CF 原实现接受任意 method（verify/list-* 走 GET，register/login 走 POST）
router.all('/auth', async (req, res, next) => {
  try {
    const action = req.query.action;
    const body = req.body || {};
    const ip = (req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown');

    if (action === 'register') {
      const { username, password, inviteCode } = body;
      if (!username || !password || !inviteCode) return res.json({ error: '请填写用户名、密码和邀请码' });
      if (username.length < 3 || username.length > 20) return res.json({ error: '用户名3-20个字符' });
      if (password.length < 6) return res.json({ error: '密码至少6位' });
      if (username === 'admin') return res.json({ error: '不能使用保留用户名' });
      const inv = await validateInvite(inviteCode);
      if (!inv.valid) return res.json({ error: '邀请码无效或已被使用' });
      if (await getUser(username)) return res.json({ error: '用户名已存在' });
      const salt = genSalt();
      const hash = await hashPwd(password, salt, 1);   // 与 CF register 一致：v1
      const r = await db.exec('INSERT INTO users (username, password_hash, salt, hash_version, invite_code, invite_type) VALUES (?,?,?,?,?,?)',
        [username, hash, salt, 1, inviteCode, inv.type]);
      const t = await issueTokens(r.insertId, username);
      await H.logOp(username, 'register', '注册成功（邀请码: ' + inv.type + '）', ip);
      return res.json({ ok: true, token: t.token, refreshToken: t.refreshToken, username });
    }

    if (action === 'login') {
      const { username, password } = body;
      if (!username || !password) return res.json({ error: '请输入用户名和密码' });
      const rl = await rateCheck(ip);
      if (rl.blocked) {
        await H.logOp(username, 'login_blocked', '登录限流触发（IP: ' + ip + '）', ip);
        return res.status(429).json({ error: `登录尝试过多，请 ${rl.waitSec} 秒后重试` });
      }
      const user = await getUser(username);
      if (!user) { await rateRecord(ip, rl.recent); return res.status(401).json({ error: '用户名或密码错误' }); }
      const hash = await hashPwd(password, user.salt, user.hash_version);
      if (hash !== user.password_hash) { await rateRecord(ip, rl.recent); return res.status(401).json({ error: '用户名或密码错误' }); }
      await db.exec('DELETE FROM login_fails WHERE ip = ?', [ip]);
      const t = await issueTokens(user.id, username);
      await H.logOp(username, 'login', '登录成功', ip);
      return res.json({ ok: true, token: t.token, refreshToken: t.refreshToken, username });
    }

    if (action === 'verify') {
      const payload = req.user || {};
      if (!payload.username) return res.status(401).json({ error: '未登录' });
      return res.json({ ok: true, username: payload.username });
    }

    if (action === 'refresh') {
      const { refreshToken } = body;
      if (!refreshToken) return res.json({ error: '缺少 refreshToken' });
      const row = await db.one(
        'SELECT rt.*, u.username FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id WHERE rt.token_hash = ? AND rt.revoked = 0',
        [sha256(refreshToken)]);
      if (!row || new Date(row.expires_at) < new Date()) return res.status(401).json({ error: 'Refresh token 无效或已过期' });
      await db.exec('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [row.id]);
      const t = await issueTokens(row.user_id, row.username);
      return res.json({ ok: true, token: t.token, refreshToken: t.refreshToken });
    }

    if (action === 'logout') {
      if (body.refreshToken) await db.exec('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', [sha256(body.refreshToken)]);
      await H.logOp(req.user ? req.user.username : 'unknown', 'logout', '退出登录', ip);
      return res.json({ ok: true });
    }

    // ===== 管理员动作 =====
    const needAdmin = ['create-invite', 'list-invites', 'delete-user', 'list-users', 'admin-op-verify', 'debug-env'];
    if (needAdmin.includes(action)) {
      if (!req.user || req.user.username !== 'admin') return res.status(403).json({ error: '仅管理员' });
    }

    if (action === 'create-invite') {
      const count = Math.min(Math.max(parseInt(body.count) || 1, 1), 10);
      const codes = [];
      for (let i = 0; i < count; i++) {
        const code = newInviteCode();
        codes.push(code);
        await db.exec('INSERT INTO invites (code, created_by) VALUES (?,?)', [code, req.user.username]);
      }
      await H.logOp(req.user.username, 'create_invite', '创建 ' + count + ' 个邀请码', ip);
      return res.json({ ok: true, codes });
    }

    if (action === 'list-invites') {
      const rows = await db.query('SELECT code, created_by AS createdBy, created_at AS createdAt, used, used_at AS usedAt FROM invites ORDER BY id DESC');
      return res.json({ ok: true, codes: rows });
    }

    if (action === 'list-users') {
      const rows = await db.query('SELECT username, created_at AS createdAt, invite_code AS inviteCode, invite_type AS inviteType FROM users ORDER BY id');
      return res.json({ ok: true, users: rows });
    }

    if (action === 'delete-user') {
      const { username } = body;
      if (!username) return res.json({ error: '请指定要删除的用户名' });
      if (username === 'admin') return res.json({ error: '不能删除管理员账号' });
      const user = await getUser(username);
      if (!user) return res.status(404).json({ error: '用户不存在' });
      for (const t of ['purchases', 'expenses', 'todos', 'projects']) {
        await db.exec(`DELETE FROM ${t} WHERE user_id = ?`, [user.id]);
      }
      for (const t of ['budgets', 'recurring', 'cats', 'push_subs', 'refresh_tokens']) {
        await db.exec(`DELETE FROM ${t} ${t === 'refresh_tokens' ? 'WHERE user_id' : 'WHERE user_id'} = ?`, [user.id]);
      }
      await db.exec('DELETE FROM users WHERE id = ?', [user.id]);
      try { require('../lib/images').deleteUserDir(username); } catch (e) {}
      await H.logOp(req.user.username, 'delete_user', '删除用户: ' + username, ip);
      return res.json({ ok: true, message: `用户 ${username} 及其数据已全部删除` });
    }

    if (action === 'list-logs') {
      const date = req.query.date || new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const isAdmin = req.user.username === 'admin';
      const targetUser = isAdmin ? (req.query.username || null) : req.user.username;
      const sql = targetUser
        ? 'SELECT action, username, detail AS details, ip, created_at AS ts FROM op_logs WHERE log_date = ? AND username = ? ORDER BY id DESC'
        : 'SELECT action, username, detail AS details, ip, created_at AS ts FROM op_logs WHERE log_date = ? ORDER BY id DESC';
      const rows = await db.query(sql, targetUser ? [date, targetUser] : [date]);
      return res.json({ ok: true, logs: rows, date, isAdmin, currentUser: req.user.username });
    }

    if (action === 'admin-op-verify') {
      const admin = await getUser('admin');
      if (!admin) return res.json({ error: '管理员账号异常' });
      const hash = await hashPwd(body.opPassword || '', admin.salt, admin.hash_version);
      if (hash !== admin.password_hash) return res.status(401).json({ error: '操作密码错误' });
      const opToken = createJWT({ username: 'admin', op: true }, cfg.JWT_SECRET, 0.083);
      return res.json({ ok: true, opToken });
    }

    if (action === 'debug-env') {
      const codes = cfg.INVITE_CODES || '';
      return res.json({
        ok: true,
        INVITE_CODES_SET: !!codes,
        INVITE_CODES_LENGTH: codes.length,
        INVITE_CODES_PREVIEW: codes.slice(0, 3) + (codes.length > 3 ? '***' : ''),
        JWT_SECRET_SET: !!cfg.JWT_SECRET,
        API_KEY_SET: false,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) { next(e); }
});

module.exports = router;
