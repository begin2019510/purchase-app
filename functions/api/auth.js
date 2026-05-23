// 多用户认证系统
// 存储: Cloudflare KV (IMAGE_STORE)
// 密码: SHA-256 + salt
// 会话: JWT (HS256)

const CORS_ORIGINS = ['https://121212121.top', 'http://121212121.top'];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-API-Key,Authorization',
  };
}

// ===== 密码哈希 =====
async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ===== JWT =====
async function createJWT(payload, secret, expiresInHours = 24) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = { ...payload, iat: now, exp: now + expiresInHours * 3600 };

  const enc = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '');
  const token = enc(header) + '.' + enc(tokenPayload);

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return token + '.' + sigStr;
}

async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const sig = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!valid) return null;

  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ===== Feishu API =====
async function getFeishuToken(appId, appSecret) {
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

async function createBitableField(token, appToken, tableId, fieldName, fieldType, options) {
  const body = { field_name: fieldName, type: fieldType };
  if (options) body.property = options;
  const res = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
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
  const feishuToken = await getFeishuToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);

  // 创建采购表
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

  // 创建记账表
  const expenseApp = await createBitable(feishuToken, `[${username}] 记账管理`);
  const expenseTable = await createTable(feishuToken, expenseApp, '记账记录', [
    { field_name: '类型', type: 3, property: { options: [{ name: '支出' }, { name: '收入' }] } },
    { field_name: '金额', type: 2 },
    { field_name: '分类', type: 3, property: { options: [{ name: '餐饮' }, { name: '交通' }, { name: '购物' }, { name: '娱乐' }, { name: '居住' }, { name: '医疗' }, { name: '教育' }, { name: '其他' }] } },
    { field_name: '日期', type: 5, property: { date_formatter: 'yyyy/MM/dd HH:mm' } },
    { field_name: '备注', type: 1 },
    { field_name: '图片', type: 1 },
  ]);

  return {
    purchaseApp, purchaseTable,
    expenseApp, expenseTable,
  };
}

// ===== KV 用户存储 =====
async function getUser(kv, username) {
  const data = await kv.get('user:' + username);
  return data ? JSON.parse(data) : null;
}

async function saveUser(kv, username, userData) {
  await kv.put('user:' + username, JSON.stringify(userData));
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
      return await handleCreateInvite(request, env, KV, cors);
    } else {
      return json({ error: 'Unknown action. Use: register, login, verify' }, 400, cors);
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

  // 验证邀请码
  const inviteCodesStr = (env.INVITE_CODES || '').replace(/\r|\n|\s/g, ' ').trim();
  const validCodes = inviteCodesStr.split(',').map(c => c.trim()).filter(Boolean);
  // debug: 返回到错误信息里帮助排查
  const codeMatch = validCodes.includes(inviteCode);
  if (!codeMatch && validCodes.length === 0) {
    return json({ error: '邀请码系统未配置（INVITE_CODES环境变量为空）' }, 400, cors);
  }
  if (!validCodes.includes(inviteCode)) {
    return json({ error: '邀请码无效' }, 400, cors);
  }

  // 检查用户是否已存在
  const existing = await getUser(KV, username);
  if (existing) {
    return json({ error: '用户名已存在' }, 400, cors);
  }

  // 创建 Bitable 表（admin 用户使用原有共享表，不创建新表）
  let tables;
  if (username === 'admin') {
    tables = {
      purchaseApp: env.FEISHU_BITABLE_APP,
      purchaseTable: env.FEISHU_BITABLE_TABLE,
      expenseApp: env.FEISHU_EXPENSE_APP,
      expenseTable: env.FEISHU_EXPENSE_TABLE,
    };
  } else {
    try {
      tables = await createUserTables(env, username);
    } catch (e) {
      return json({ error: '创建数据表失败: ' + e.message }, 500, cors);
    }
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
  };
  await saveUser(KV, username, userData);

  // 生成 token
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
async function handleCreateInvite(request, env, KV, cors) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401, cors);

  const token = authHeader.replace('Bearer ', '');
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload || payload.username !== 'admin') {
    return json({ error: '仅管理员可创建邀请码' }, 403, cors);
  }

  // 生成随机邀请码
  const code = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  // 存到 KV
  const inviteData = await KV.get('invites') || '[]';
  const invites = JSON.parse(inviteData);
  invites.push({ code, createdBy: payload.username, createdAt: new Date().toISOString() });
  await KV.put('invites', JSON.stringify(invites));

  return json({ ok: true, code }, 200, cors);
}
