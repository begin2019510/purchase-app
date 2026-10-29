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
// 只校验、不消费；动态邀请码的 used 置位放在注册事务里原子完成
async function validateInvite(code) {
  const envCodes = (cfg.INVITE_CODES || '').split(',').map(c => c.trim()).filter(Boolean);
  if (envCodes.includes(code)) return { valid: true, type: 'env' };
  const row = await db.one('SELECT * FROM invites WHERE code = ? AND used = 0', [code]);
  if (row) return { valid: true, type: 'dynamic', rowId: row.id };
  return { valid: false };
}
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
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
  const raw = row && row.times;
  // mysql2 会把 JSON 列直接解析成数组；字符串则是旧数据/兼容路径
  let parsed = [];
  if (Array.isArray(raw)) parsed = raw;
  else if (typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch (e) {} }
  const recent = Array.isArray(parsed) ? parsed.filter(t => Number(t) && now - Number(t) < 900000) : [];
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
  // 本路由在 X-Service-Token 闸之后挂载：CF 已验过 JWT，用 X-Auth-User 转发身份（管理员动作依赖它）
  const xu = req.headers['x-auth-user'];
  if (xu) { req.user = { username: String(xu) }; return next(); }
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
      if (typeof username !== 'string' || typeof password !== 'string' || typeof inviteCode !== 'string' ||
          !username || !password || !inviteCode) return res.json({ error: '请填写用户名、密码和邀请码' });
      if (username.length < 3 || username.length > 20) return res.json({ error: '用户名3-20个字符' });
      // 用户名会进图片目录名，限制为安全字符，避免注册成功后上传图片报 500
      if (!/^[A-Za-z0-9_一-龥.-]{3,20}$/.test(username)) return res.json({ error: '用户名只能包含中文、字母、数字、下划线、点和短横线' });
      if (password.length < 6 || password.length > 128) return res.json({ error: '密码需为6-128位' });
      if (username.toLowerCase() === 'admin') return res.json({ error: '不能使用保留用户名' });
      if (await getUser(username)) return res.json({ error: '用户名已存在' });
      const inv = await validateInvite(inviteCode);
      if (!inv.valid) return res.json({ error: '邀请码无效或已被使用' });
      const salt = genSalt();
      const hash = await hashPwd(password, salt, 1);   // 与 CF register 一致：v1
      const conn = await db.pool.getConnection();
      let uid;
      try {
        await conn.beginTransaction();
        if (inv.type === 'dynamic') {
          // 原子消费邀请码：并发下只有一个请求能 affectedRows=1
          const [up] = await conn.query('UPDATE invites SET used = 1, used_at = NOW() WHERE id = ? AND used = 0', [inv.rowId]);
          if (!up.affectedRows) { await conn.rollback(); return res.json({ error: '邀请码无效或已被使用' }); }
        }
        const [r] = await conn.query('INSERT INTO users (username, password_hash, salt, hash_version, invite_code, invite_type) VALUES (?,?,?,?,?,?)',
          [username, hash, salt, 1, inviteCode, inv.type]);
        await conn.commit();
        uid = r.insertId;
      } catch (e) {
        try { await conn.rollback(); } catch (x) {}
        if (e && e.code === 'ER_DUP_ENTRY') return res.json({ error: '用户名已存在' });
        throw e;
      } finally { conn.release(); }
      const t = await issueTokens(uid, username);
      await H.logOp(username, 'register', '注册成功（邀请码: ' + inv.type + '）', ip);
      return res.json({ ok: true, token: t.token, refreshToken: t.refreshToken, username });
    }

    if (action === 'login') {
      const { username, password } = body;
      if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) return res.json({ error: '请输入用户名和密码' });
      const rl = await rateCheck(ip);
      if (rl.blocked) {
        await H.logOp(username, 'login_blocked', '登录限流触发（IP: ' + ip + '）', ip);
        return res.status(429).json({ error: `登录尝试过多，请 ${rl.waitSec} 秒后重试` });
      }
      const user = await getUser(username);
      if (!user) { await rateRecord(ip, rl.recent); return res.status(401).json({ error: '用户名或密码错误' }); }
      const hash = await hashPwd(password, user.salt, user.hash_version);
      if (!safeEqual(hash, user.password_hash)) { await rateRecord(ip, rl.recent); return res.status(401).json({ error: '用户名或密码错误' }); }
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

    // ===== Agent 一次性安装链接 =====
    // 生成：必须已登录；只返回明文票据一次，DB 只存哈希，10 分钟有效。
    if (action === 'agent-ticket') {
      const payload = req.user || {};
      if (!payload.username) return res.status(401).json({ error: '未登录' });
      const user = await getUser(payload.username);
      if (!user) return res.status(401).json({ error: '账号不存在' });
      const ticket = crypto.randomBytes(32).toString('base64url');
      const hash = sha256(ticket);
      // 同一账号只保留最新一条未使用的链接，避免旧链接继续有效
      await db.exec('UPDATE agent_tickets SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);
      await db.exec(
        'INSERT INTO agent_tickets (user_id, ticket_hash, expires_at, ip) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 10 MINUTE),?)',
        [user.id, hash, ip]);
      const row = await db.one('SELECT expires_at FROM agent_tickets WHERE ticket_hash = ?', [hash]);
      await H.logOp(user.username, 'agent_ticket', '生成一次性 Agent 安装链接', ip);
      return res.json({ ok: true, ticket, expiresAt: row ? new Date(row.expires_at).toISOString() : null });
    }

    // 兑换：无需密码，凭一次性票据换取该安装实例独立的 refresh token。
    // 更新语句原子消费票据，并发请求只有一个能成功。
    if (action === 'agent-exchange') {
      const ticket = body.ticket;
      if (typeof ticket !== 'string' || ticket.length < 20 || ticket.length > 200) {
        return res.status(400).json({ error: '安装链接无效' });
      }
      const hash = sha256(ticket);
      const up = await db.exec(
        'UPDATE agent_tickets SET used_at = NOW(), ip = ? WHERE ticket_hash = ? AND used_at IS NULL AND expires_at > NOW()',
        [ip, hash]);
      if (!up.affectedRows) return res.status(401).json({ error: '安装链接无效、已过期或已被使用' });
      const row = await db.one(
        'SELECT t.user_id, u.username FROM agent_tickets t JOIN users u ON u.id = t.user_id WHERE t.ticket_hash = ?',
        [hash]);
      if (!row) return res.status(401).json({ error: '账号不存在或已删除' });
      const t = await issueTokens(row.user_id, row.username);
      await H.logOp(row.username, 'agent_install', '通过一次性安装链接授权 Agent', ip);
      return res.json({ ok: true, token: t.token, refreshToken: t.refreshToken, username: row.username });
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
      return res.json({ ok: true, token: t.token, refreshToken: t.refreshToken, username: row.username });
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
      // 表名来自固定白名单，不拼接任何用户输入
      const TABLES = ['purchases', 'expenses', 'todos', 'reports', 'images', 'budgets', 'recurring', 'cats', 'push_subs', 'refresh_tokens', 'agent_tickets'];
      const conn = await db.pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM phase_items WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)', [user.id]);
        await conn.query('DELETE FROM project_phases WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)', [user.id]);
        for (const t of TABLES) await conn.query(`DELETE FROM ${t} WHERE user_id = ?`, [user.id]);
        await conn.query('DELETE FROM projects WHERE user_id = ?', [user.id]);
        await conn.query('DELETE FROM op_logs WHERE username = ?', [username]);
        await conn.query('DELETE FROM users WHERE id = ?', [user.id]);
        await conn.commit();
      } catch (e) {
        try { await conn.rollback(); } catch (x) {}
        throw e;
      } finally { conn.release(); }
      // 数据库提交成功后再删磁盘图片目录；失败只记录，不回滚数据
      try { require('../lib/images').deleteUserDir(username); } catch (e) {}
      await H.logOp(req.user.username, 'delete_user', '删除用户: ' + username, ip);
      return res.json({ ok: true, message: `用户 ${username} 及其数据已全部删除` });
    }

    if (action === 'list-logs') {
      if (!req.user || !req.user.username) return res.status(401).json({ error: '未登录' });
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
      const hash = await hashPwd(String(body.opPassword || ''), admin.salt, admin.hash_version);
      if (!safeEqual(hash, admin.password_hash)) return res.status(401).json({ error: '操作密码错误' });
      const opToken = createJWT({ username: 'admin', op: true }, cfg.JWT_SECRET, 0.083);
      return res.json({ ok: true, opToken });
    }

    if (action === 'debug-env') {
      const codes = cfg.INVITE_CODES || '';
      // 不再返回任何邀请码片段，只说明是否配置及数量
      return res.json({
        ok: true,
        INVITE_CODES_SET: !!codes,
        INVITE_CODES_COUNT: codes.split(',').map(c => c.trim()).filter(Boolean).length,
        JWT_SECRET_SET: !!cfg.JWT_SECRET,
        API_KEY_SET: false,
      });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) { next(e); }
});

module.exports = router;
