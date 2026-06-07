// 多用户认证系统 v2
// 存储: Cloudflare KV (IMAGE_STORE)
// 密码: SHA-256 + salt
// 会话: JWT (HS256)
// 邀请码: 环境变量(可重复) + KV动态码(一次性)

import { CORS_ORIGINS, getCorsHeaders, jsonResponse, json as jsonFn, verifyJWT, createJWT, hashPassword, hashPasswordNew, generateSalt, getFeishuToken, generateRefreshToken, storeRefreshToken, validateRefreshToken, deleteRefreshToken, deleteAllRefreshTokens, logOp, getLogs } from './_auth.js';

const json = jsonFn;
const corsHeaders = getCorsHeaders;

// ===== Feishu API =====
async function getFeishuTokenDirect(appId, appSecret) {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('Feishu auth failed: ' + JSON.stringify(data));
  return data.tenant_access_token;
}

async function createBitable(token, name) {
  const res = await fetch('https://open.feishu.cn/open-apis/bitable/v1/apps', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('Create Bitable failed: ' + data.msg);
  return data.data.app.app_token;
}

async function createTable(token, appToken, name, fields) {
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ table: { name, default_view_name: '默认视图', fields } }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('Create table failed: ' + data.msg);
  return data.data.table_id;
}

// ===== 创建用户 Bitable 表 =====
async function createUserTables(env, username) {
  const feishuToken = await getFeishuTokenDirect(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);

  const purchaseApp = await createBitable(feishuToken, `[${username}] 采购管理`);
  const purchaseTable = await createTable(feishuToken, purchaseApp, '采购记录', [
    { field_name: '商品名称', type: 1 },
    { field_name: '平台', type: 3, property: { options: [{ name: '拼多多' }, { name: '淘宝' }, { name: '京东' }, { name: '抖音' }, { name: '其他' }] } },
    { field_name: '分类', type: 3, property: { options: [{ name: '日用' }, { name: '服饰' }, { name: '饮食' }, { name: '电子' }, { name: '交通' }, { name: '其他' }] } },
    { field_name: '单价', type: 2 },
    { field_name: '数量', type: 2 },
    { field_name: '状态', type: 3, property: { options: [{ name: '待审批' }, { name: '已审批' }, { name: '已下单' }, { name: '已到' }, { name: '已退' }, { name: '已归档' }] } },
    { field_name: '日期', type: 5, property: { date_formatter: 'yyyy/MM/dd' } },
    { field_name: '备注', type: 1 },
    { field_name: '图片', type: 1 },
    { field_name: '创建时间', type: 1 },
    { field_name: '审批时间', type: 1 },
    { field_name: '下单时间', type: 1 },
    { field_name: '到货时间', type: 1 },
    { field_name: '归档时间', type: 1 },
  ]);

  const expenseApp = await createBitable(feishuToken, `[${username}] 记账管理`);
  const expenseTable = await createTable(feishuToken, expenseApp, '记账记录', [
    { field_name: '类型', type: 3, property: { options: [{ name: '支出' }, { name: '收入' }] } },
    { field_name: '金额', type: 2 },
    { field_name: '分类', type: 3, property: { options: [{ name: '餐饮' }, { name: '交通' }, { name: '购物' }, { name: '娱乐' }, { name: '居住' }, { name: '医疗' }, { name: '教育' }, { name: '其他' }] } },
    { field_name: '日期', type: 5, property: { date_formatter: 'yyyy/MM/dd HH:mm' } },
    { field_name: '备注', type: 1 },
    { field_name: '图片', type: 1 },
  ]);

    const todoApp = await createBitable(feishuToken, `[${username}] Todo`);
  const todoTable = await createTable(feishuToken, todoApp, 'Todo', [
    { field_name: '标题', type: 1 },
    { field_name: '描述', type: 1 },
    { field_name: '截止日期', type: 5 },
    { field_name: '优先级', type: 3, property: { options: [{ name: '高' }, { name: '中' }, { name: '低' }] } },
    { field_name: '分类', type: 3, property: { options: [{ name: '采购' }, { name: '记账' }, { name: '生活' }, { name: '工作' }, { name: '健康' }, { name: '其他' }] } },
    { field_name: '状态', type: 3, property: { options: [{ name: '待办' }, { name: '进行中' }, { name: '已完成' }, { name: '已取消' }] } },
    { field_name: '重复', type: 3, property: { options: [{ name: '无' }, { name: '每天' }, { name: '每周' }, { name: '每月' }] } },
    { field_name: '子任务', type: 1 },
    { field_name: '图片', type: 1 },
    { field_name: '关联类型', type: 3, property: { options: [{ name: '无' }, { name: '采购' }, { name: '记账' }] } },
    { field_name: '关联ID', type: 1 },
    { field_name: '完成时间', type: 5 },
  ]);
  return { purchaseApp, purchaseTable, expenseApp, expenseTable, todoApp, todoTable };
}

// ===== KV 存储 =====
async function getUser(kv, username) {
  const data = await kv.get('user:' + username);
  return data ? JSON.parse(data) : null;
}

async function saveUser(kv, username, userData) {
  await kv.put('user:' + username, JSON.stringify(userData));
}

async function deleteUser(kv, username) {
  await kv.delete('user:' + username);
}

// ===== 邀请码验证（环境变量 + KV动态码） =====
async function validateInviteCode(env, KV, code) {
  // 1. 检查环境变量（可重复使用的码）
  const envCodes = (env.INVITE_CODES || '').replace(/\r|\n/g, '').split(',').map(c => c.trim()).filter(Boolean);
  if (envCodes.includes(code)) {
    return { valid: true, type: 'env' };
  }

  // 2. 检查KV动态码（一次性）
  const dynamicData = await KV.get('dynamic_invites') || '[]';
  const dynamicCodes = JSON.parse(dynamicData);
  const idx = dynamicCodes.findIndex(c => c.code === code && !c.used);
  if (idx !== -1) {
    // 标记为已使用
    dynamicCodes[idx].used = true;
    dynamicCodes[idx].usedAt = new Date().toISOString();
    await KV.put('dynamic_invites', JSON.stringify(dynamicCodes));
    return { valid: true, type: 'dynamic' };
  }

  return { valid: false };
}

// ===== 主处理 =====
export async function onRequest(context) {
  const { request, env } = context;
  const cors = corsHeaders(request);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const KV = env.IMAGE_STORE;
  const JWT_SECRET = env.JWT_SECRET;

  if (!JWT_SECRET) return json({ error: 'JWT_SECRET not configured' }, 500, cors);
  if (!KV) return json({ error: 'KV store not configured' }, 500, cors);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    const body = request.method === 'POST' ? await request.json() : {};

    if (action === 'register') {
      return await handleRegister(request, body, env, KV, JWT_SECRET, cors);
    } else if (action === 'login') {
      return await handleLogin(request, body, KV, JWT_SECRET, cors, env);
    } else if (action === 'verify') {
      return await handleVerify(request, KV, JWT_SECRET, cors);
    } else if (action === 'create-invite') {
      return await handleCreateInvite(request, body, env, KV, cors);
    } else if (action === 'list-invites') {
      return await handleListInvites(request, env, KV, cors);
    } else if (action === 'delete-user') {
      return await handleDeleteUser(request, body, env, KV, cors);
    } else if (action === 'list-users') {
      return await handleListUsers(request, env, KV, cors);
    } else if (action === 'refresh') {
      return await handleRefresh(body, KV, JWT_SECRET, cors);
    } else if (action === 'logout') {
      return await handleLogout(request, body, KV, cors);
    } else if (action === 'list-logs') {
      return await handleListLogs(request, env, KV, cors);
    } else if (action === 'debug-env') {
      // 仅管理员可查看
      const debugAuth = request.headers.get('Authorization');
      if (!debugAuth) return json({ error: 'Unauthorized' }, 401, cors);
      const debugToken = debugAuth.replace('Bearer ', '');
      const debugPayload = await verifyJWT(debugToken, env.JWT_SECRET);
      if (!debugPayload || debugPayload.username !== 'admin') return json({ error: '仅管理员可查看' }, 403, cors);
      const codes = env.INVITE_CODES || '';
      return json({
        ok: true,
        INVITE_CODES_SET: !!codes,
        INVITE_CODES_LENGTH: codes.length,
        INVITE_CODES_PREVIEW: codes.slice(0, 3) + (codes.length > 3 ? '***' : ''),
        JWT_SECRET_SET: !!env.JWT_SECRET,
        API_KEY_SET: !!env.API_KEY,
      }, 200, cors);
    } else if (action === 'admin-op-verify') {
      // 管理员操作二次验证（操作密码）
      const aovAuth = request.headers.get('Authorization');
      if (!aovAuth) return json({ error: 'Unauthorized' }, 401, cors);
      const aovToken = aovAuth.replace('Bearer ', '');
      const aovPayload = await verifyJWT(aovToken, env.JWT_SECRET);
      if (!aovPayload || aovPayload.username !== 'admin') return json({ error: '仅管理员' }, 403, cors);
      const { opPassword } = body;
      if (!opPassword) return json({ error: '请输入操作密码' }, 400, cors);
      const adminUser = await getUser(KV, 'admin');
      if (!adminUser) return json({ error: '管理员账号异常' }, 500, cors);
      const opHash = await hashPassword(opPassword, adminUser.salt, adminUser.hashVersion);
      if (opHash !== adminUser.passwordHash) return json({ error: '操作密码错误' }, 401, cors);
      // 签发短期操作 token（5分钟）
      const opToken = await createJWT({ username: 'admin', op: true }, JWT_SECRET, 0.083);
      return json({ ok: true, opToken }, 200, cors);
    } else {
      return json({ error: 'Unknown action' }, 400, cors);
    }
  } catch (e) {
    return json({ error: e.message || 'Auth failed' }, 500, cors);
  }
}

// ===== 注册 =====
async function handleRegister(request, body, env, KV, JWT_SECRET, cors) {
  const { username, password, inviteCode } = body;
  if (!username || !password || !inviteCode) {
    return json({ error: '请填写用户名、密码和邀请码' }, 400, cors);
  }
  if (username.length < 3 || username.length > 20) {
    return json({ error: '用户名3-20个字符' }, 400, cors);
  }
  if (password.length < 6) {
    return json({ error: '密码至少6位' }, 400, cors);
  }
  if (username === 'admin') {
    return json({ error: '不能使用保留用户名' }, 400, cors);
  }

  // 验证邀请码（环境变量 + KV动态码）
  const inviteResult = await validateInviteCode(env, KV, inviteCode);
  if (!inviteResult.valid) {
    return json({ error: '邀请码无效或已被使用' }, 400, cors);
  }

  // 检查用户是否已存在
  const existing = await getUser(KV, username);
  if (existing) {
    return json({ error: '用户名已存在' }, 400, cors);
  }

  // 创建 Bitable 表
  let tables;
  try {
    tables = await createUserTables(env, username);
  } catch (e) {
    return json({ error: '创建数据表失败: ' + e.message }, 500, cors);
  }

  // 哈希密码
  const salt = generateSalt();
  const hash = await hashPassword(password, salt);

  // 保存用户
  const userData = {
    username,
    passwordHash: hash,
    salt,
    createdAt: new Date().toISOString(),
    bitable: tables,
    inviteCode,
    inviteType: inviteResult.type,
  };
  await saveUser(KV, username, userData);

  const token = await createJWT({ username, bitable: tables }, JWT_SECRET, 24); // 24小时 access token
  const refreshToken = generateRefreshToken();
  await storeRefreshToken(KV, username, refreshToken);
  await logOp(KV, 'register', username, '注册成功（邀请码: ' + inviteResult.type + '）', request).catch(() => {});
  return json({ ok: true, token, refreshToken, username }, 200, cors);
}

// ===== 登录限流 =====
async function checkLoginRateLimit(kv, ip) {
  const key = 'login_fail:' + ip;
  const data = await kv.get(key);
  if (!data) return { blocked: false, remaining: 5 };
  const parsed = JSON.parse(data);
  const now = Date.now();
  // 清理15分钟前的记录
  const recent = parsed.filter(t => now - t < 15 * 60 * 1000);
  if (recent.length >= 5) {
    const oldest = Math.min(...recent);
    const waitSec = Math.ceil((oldest + 15 * 60 * 1000 - now) / 1000);
    return { blocked: true, waitSec, remaining: 0 };
  }
  return { blocked: false, remaining: 5 - recent.length, recent };
}

async function recordLoginFail(kv, ip, recent) {
  const key = 'login_fail:' + ip;
  const now = Date.now();
  const entries = recent || [];
  entries.push(now);
  await kv.put(key, JSON.stringify(entries), { expirationTtl: 900 });
}

async function clearLoginRateLimit(kv, ip) {
  await kv.delete('login_fail:' + ip);
}

// ===== 登录 =====
async function handleLogin(request, body, KV, JWT_SECRET, cors, env) {
  const { username, password } = body;
  if (!username || !password) {
    return json({ error: '请输入用户名和密码' }, 400, cors);
  }

  // 限流检查
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const rateLimit = await checkLoginRateLimit(KV, ip);
  if (rateLimit.blocked) {
    await logOp(KV, 'login_blocked', username, '登录限流触发（IP: ' + ip + '）', request).catch(() => {});
    return json({ error: `登录尝试过多，请 ${rateLimit.waitSec} 秒后重试` }, 429, cors);
  }

  const user = await getUser(KV, username);
  if (!user) {
    await recordLoginFail(KV, ip, rateLimit.recent);
    return json({ error: '用户名或密码错误' }, 401, cors);
  }

  const hash = await hashPassword(password, user.salt, user.hashVersion);
  if (hash !== user.passwordHash) {
    await recordLoginFail(KV, ip, rateLimit.recent);
    return json({ error: '用户名或密码错误' }, 401, cors);
  }

  // 登录成功，清除限流
  await clearLoginRateLimit(KV, ip);

  // Auto-migrate: create todo table if missing
  if (user.bitable && !user.bitable.todoApp) {
    try {
      const feishuToken = await getFeishuTokenDirect(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
      const todoApp = await createBitable(feishuToken, `[${username}] Todo`);
      const todoTable = await createTable(feishuToken, todoApp, 'Todo', [
        { field_name: '标题', type: 1 },
        { field_name: '描述', type: 1 },
        { field_name: '截止日期', type: 5 },
        { field_name: '优先级', type: 3, property: { options: [{ name: '高' }, { name: '中' }, { name: '低' }] } },
        { field_name: '分类', type: 3, property: { options: [{ name: '采购' }, { name: '记账' }, { name: '生活' }, { name: '工作' }, { name: '健康' }, { name: '其他' }] } },
        { field_name: '状态', type: 3, property: { options: [{ name: '待办' }, { name: '进行中' }, { name: '已完成' }, { name: '已取消' }] } },
        { field_name: '重复', type: 3, property: { options: [{ name: '无' }, { name: '每天' }, { name: '每周' }, { name: '每月' }] } },
        { field_name: '子任务', type: 1 },
        { field_name: '图片', type: 1 },
        { field_name: '关联类型', type: 3, property: { options: [{ name: '无' }, { name: '采购' }, { name: '记账' }] } },
        { field_name: '关联ID', type: 1 },
        { field_name: '完成时间', type: 5 },
      ]);
      user.bitable.todoApp = todoApp;
      user.bitable.todoTable = todoTable;
      await saveUser(KV, username, user);
    } catch (e) { console.error('Todo migration failed:', e.message); }
  }
  const token = await createJWT({ username, bitable: user.bitable }, JWT_SECRET, 24); // 24小时 access token
  const refreshToken = generateRefreshToken();
  await storeRefreshToken(KV, username, refreshToken);
  await logOp(KV, 'login', username, '登录成功', request).catch(() => {});
  return json({ ok: true, token, refreshToken, username }, 200, cors);
}

// ===== 验证 token =====
async function handleVerify(request, KV, JWT_SECRET, cors) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: '未登录' }, 401, cors);
  }

  const token = authHeader.replace('Bearer ', '');
  const payload = await verifyJWT(token, JWT_SECRET);
  if (!payload) {
    return json({ error: 'Token无效或已过期' }, 401, cors);
  }

  return json({ ok: true, username: payload.username }, 200, cors);
}

// ===== 创建邀请码（仅管理员） =====
async function handleCreateInvite(request, body, env, KV, cors) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401, cors);

  const token = authHeader.replace('Bearer ', '');
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || payload.username !== 'admin') {
    return json({ error: '仅管理员可创建邀请码' }, 403, cors);
  }
  const count = Math.min(Math.max(parseInt(body.count) || 1, 1), 10);

  const newCodes = [];
  for (let i = 0; i < count; i++) {
    const code = 'inv_' + Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
    newCodes.push({
      code,
      createdBy: payload.username,
      createdAt: new Date().toISOString(),
      used: false,
    });
  }

  // 追加到 KV
  const existing = JSON.parse(await KV.get('dynamic_invites') || '[]');
  existing.push(...newCodes);
  await KV.put('dynamic_invites', JSON.stringify(existing));
  await logOp(KV, 'create_invite', payload.username, '创建 ' + count + ' 个邀请码', request).catch(() => {});
  return json({ ok: true, codes: newCodes.map(c => c.code) }, 200, cors);
}

// ===== 查看邀请码列表（仅管理员） =====
async function handleListInvites(request, env, KV, cors) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401, cors);

  const token = authHeader.replace('Bearer ', '');
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || payload.username !== 'admin') {
    return json({ error: '仅管理员可查看' }, 403, cors);
  }

  const codes = JSON.parse(await KV.get('dynamic_invites') || '[]');
  return json({ ok: true, codes }, 200, cors);
}

// ===== 删除用户（仅管理员，不能删自己） =====
async function handleDeleteUser(request, body, env, KV, cors) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401, cors);

  const token = authHeader.replace('Bearer ', '');
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || payload.username !== 'admin') {
    return json({ error: '仅管理员可删除用户' }, 403, cors);
  }

  const { username } = body;
  if (!username) {
    return json({ error: '请指定要删除的用户名' }, 400, cors);
  }
  if (username === 'admin') {
    return json({ error: '不能删除管理员账号' }, 400, cors);
  }

  const user = await getUser(KV, username);
  if (!user) {
    return json({ error: '用户不存在' }, 404, cors);
  }

  // 删除飞书 Bitable 数据表
  const deleteErrors = [];
  if (user.bitable) {
    const feishuToken = await getFeishuTokenDirect(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
    for (const appToken of [user.bitable.purchaseApp, user.bitable.expenseApp, user.bitable.todoApp]) {
      if (!appToken) continue;
      try {
        const res = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${appToken}?type=bitable`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + feishuToken },
        });
        const d = await res.json();
        if (d.code !== 0) deleteErrors.push(`${appToken}: ${d.msg}`);
      } catch (e) {
        deleteErrors.push(`${appToken}: ${e.message}`);
      }
    }
  }

  // 删除用户所有 refresh token
  await deleteAllRefreshTokens(KV, username);
  await deleteUser(KV, username);

  await logOp(KV, 'delete_user', payload.username, '删除用户: ' + username, request).catch(() => {});
  if (deleteErrors.length) {
    return json({ ok: true, message: `用户 ${username} 已删除，但部分数据表删除失败`, errors: deleteErrors }, 200, cors);
  }
  return json({ ok: true, message: `用户 ${username} 及其数据已全部删除` }, 200, cors);
}

// ===== 用户列表（仅管理员） =====
async function handleListUsers(request, env, KV, cors) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401, cors);

  const token = authHeader.replace('Bearer ', '');
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || payload.username !== 'admin') {
    return json({ error: '仅管理员可查看' }, 403, cors);
  }

  const keys = await KV.list({ prefix: 'user:' });
  const users = [];
  for (const key of keys.keys) {
    const data = await KV.get(key.name);
    if (data) {
      const u = JSON.parse(data);
      users.push({
        username: u.username,
        createdAt: u.createdAt,
        inviteCode: u.inviteCode,
        inviteType: u.inviteType,
      });
    }
  }
  return json({ ok: true, users }, 200, cors);
}


// ===== Refresh Token 续期 =====
async function handleRefresh(body, KV, JWT_SECRET, cors) {
  const { refreshToken } = body;
  if (!refreshToken) return json({ error: '缺少 refreshToken' }, 400, cors);

  const tokenData = await validateRefreshToken(KV, refreshToken);
  if (!tokenData) return json({ error: 'Refresh token 无效或已过期' }, 401, cors);

  const user = await getUser(KV, tokenData.username);
  if (!user) return json({ error: '用户不存在' }, 401, cors);

  // 删除旧 refresh token（rotation）
  await deleteRefreshToken(KV, refreshToken);

  // 签发新 access token (1小时)
  const accessToken = await createJWT({ username: tokenData.username, bitable: user.bitable }, JWT_SECRET, 24);

  // 签发新 refresh token
  const newRefreshToken = generateRefreshToken();
  await storeRefreshToken(KV, tokenData.username, newRefreshToken);

  return json({ ok: true, token: accessToken, refreshToken: newRefreshToken }, 200, cors);
}

// ===== Logout =====
async function handleLogout(request, body, KV, cors) {
  const { refreshToken } = body;
  const authHeader = request.headers.get('Authorization');
  let username = 'unknown';
  if (authHeader) {
    try { const p = JSON.parse(atob(authHeader.replace('Bearer ', '').split('.')[1])); username = p.username; } catch {}
  }
  if (refreshToken) await deleteRefreshToken(KV, refreshToken);
  await logOp(KV, 'logout', username, '退出登录', request).catch(() => {});
  return json({ ok: true }, 200, cors);
}

// ===== 查看操作日志（仅管理员） =====
async function handleListLogs(request, env, KV, cors) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401, cors);
  const token = authHeader.replace('Bearer ', '');
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return json({ error: 'Token无效或已过期' }, 401, cors);

  const isAdmin = payload.username === 'admin';
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
  const filterUser = url.searchParams.get('username');

  // 管理员可以查看所有日志或指定用户日志，普通用户只能查看自己的
  const targetUser = isAdmin ? (filterUser || null) : payload.username;
  const logs = await getLogs(KV, date, targetUser);
  return json({ ok: true, logs, date, isAdmin, currentUser: payload.username }, 200, cors);
}
