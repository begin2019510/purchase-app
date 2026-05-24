// 多用户认证系统 v2
// 存储: Cloudflare KV (IMAGE_STORE)
// 密码: SHA-256 + salt
// 会话: JWT (HS256)
// 邀请码: 环境变量(可重复) + KV动态码(一次性)

import { CORS_ORIGINS, getCorsHeaders, jsonResponse, json as jsonFn, verifyJWT, createJWT, hashPassword, generateSalt, getFeishuToken } from './_auth.js';

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

  return { purchaseApp, purchaseTable, expenseApp, expenseTable };
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
      return await handleRegister(body, env, KV, JWT_SECRET, cors);
    } else if (action === 'login') {
      return await handleLogin(body, KV, JWT_SECRET, cors);
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
    } else if (action === 'debug-env') {
      const codes = env.INVITE_CODES || '';
      return json({
        ok: true,
        INVITE_CODES_SET: !!codes,
        INVITE_CODES_LENGTH: codes.length,
        INVITE_CODES_PREVIEW: codes.slice(0, 3) + (codes.length > 3 ? '***' : ''),
        JWT_SECRET_SET: !!env.JWT_SECRET,
        API_KEY_SET: !!env.API_KEY,
      }, 200, cors);
    } else {
      return json({ error: 'Unknown action' }, 400, cors);
    }
  } catch (e) {
    return json({ error: e.message || 'Auth failed' }, 500, cors);
  }
}

// ===== 注册 =====
async function handleRegister(body, env, KV, JWT_SECRET, cors) {
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

  const token = await createJWT({ username, bitable: tables }, JWT_SECRET);
  return json({ ok: true, token, username }, 200, cors);
}

// ===== 登录 =====
async function handleLogin(body, KV, JWT_SECRET, cors) {
  const { username, password } = body;
  if (!username || !password) {
    return json({ error: '请输入用户名和密码' }, 400, cors);
  }

  const user = await getUser(KV, username);
  if (!user) {
    return json({ error: '用户名或密码错误' }, 401, cors);
  }

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) {
    return json({ error: '用户名或密码错误' }, 401, cors);
  }

  const token = await createJWT({ username, bitable: user.bitable }, JWT_SECRET);
  return json({ ok: true, token, username }, 200, cors);
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

  await deleteUser(KV, username);

  // 注意: 不删除飞书 Bitable 表（数据保留，防止误删）
  return json({ ok: true, message: `用户 ${username} 已删除（数据表已保留）` }, 200, cors);
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
