// Deploy: 2026-06-01 15:38:48
// 共享认证模块 - 被所有 API 函数引用
export const CORS_ORIGINS = ['https://121212121.top', 'http://121212121.top'];

export function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
    'Access-Control-Allow-Headers': 'Content-Type,X-API-Key,Authorization',
  };
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// 向后兼容别名
export const corsHeaders = getCorsHeaders;
export const json = jsonResponse;

// 密码哈希
export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function generateSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// JWT 创建
export async function createJWT(payload, secret, expiresInHours = 24) {
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

// JWT 验证
export async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sig = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(parts[0] + '.' + parts[1]));
    if (!valid) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// 从请求中提取用户上下文
// 兼容两种认证方式：JWT token (Bearer) 和 旧 PIN (X-API-Key)
export function verifyPin(request, env) {
  const pin = request.headers.get('X-API-Key');
  return pin && pin === env.API_KEY;
}

export async function authenticate(request, env) {
  // 优先尝试 JWT
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (payload) {
      return {
        authenticated: true,
        username: payload.username,
        bitable: payload.bitable, // { purchaseApp, purchaseTable, expenseApp, expenseTable }
        isJWT: true,
      };
    }
  }

  // 回退到旧 PIN 认证
  const pin = request.headers.get('X-API-Key');
  if (pin && pin === env.API_KEY) {
    return {
      authenticated: true,
      username: 'legacy',
      bitable: {
        purchaseApp: env.FEISHU_BITABLE_APP,
        purchaseTable: env.FEISHU_BITABLE_TABLE,
        expenseApp: env.FEISHU_EXPENSE_APP,
        expenseTable: env.FEISHU_EXPENSE_TABLE,
      },
      isJWT: false,
    };
  }

  return { authenticated: false };
}

// 获取 Feishu token
export async function getFeishuToken(env) {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('Feishu auth failed: code=' + data.code + ' msg=' + (data.msg || 'unknown'));
  return data.tenant_access_token;
}


// ===== Refresh Token 管理 =====

// 生成 refresh token (UUID)
export function generateRefreshToken() {
  return crypto.randomUUID();
}

// 存储 refresh token 到 KV
export async function storeRefreshToken(kv, username, token, expiresInDays = 30) {
  const key = 'refresh:' + token;
  await kv.put(key, JSON.stringify({
    username,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
  }), { expirationTtl: expiresInDays * 86400 }); // KV 自动过期
}

// 验证 refresh token
export async function validateRefreshToken(kv, token) {
  const data = await kv.get('refresh:' + token);
  if (!data) return null;
  const parsed = JSON.parse(data);
  // 检查是否过期（KV TTL 兜底，这里做双重检查）
  if (new Date(parsed.expiresAt) < new Date()) return null;
  return parsed;
}

// 删除 refresh token（logout 用）
export async function deleteRefreshToken(kv, token) {
  await kv.delete('refresh:' + token);
}

// 删除用户所有 refresh token（管理员删用户时用）
export async function deleteAllRefreshTokens(kv, username) {
  const list = await kv.list({ prefix: 'refresh:' });
  for (const key of list.keys) {
    const data = await kv.get(key.name);
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed.username === username) {
        await kv.delete(key.name);
      }
    }
  }
}

// ===== 操作日志 =====

// 记录操作日志
export async function logOp(kv, action, username, details, request) {
  const now = new Date();
  const ts = now.toISOString();
  const date = ts.slice(0, 10); // YYYY-MM-DD
  const key = `log:${date}:${now.getTime()}`;
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  await kv.put(key, JSON.stringify({ action, username, details, ip, ts }), { expirationTtl: 2592000 });
}

// 获取指定日期的操作日志
export async function getLogs(kv, date, username) {
  const list = await kv.list({ prefix: `log:${date}` });
  const logs = [];
  for (const item of list.keys) {
    const data = await kv.get(item.name);
    if (data) {
      const log = JSON.parse(data);
      // 如果指定了用户名，只返回该用户的日志
      if (!username || log.username === username) {
        logs.push(log);
      }
    }
  }
  // 按时间倒序
  logs.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return logs;
}
