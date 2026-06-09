// Shared auth module - imported by all API functions
export const CORS_ORIGINS = ['https://121212121.top', 'capacitor://localhost', 'https://localhost', 'http://localhost'];

export function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export const corsHeaders = getCorsHeaders;
export const json = jsonResponse;

// ===== Password Hashing =====

// Legacy SHA-256 (for migration only)
async function hashPasswordV1(password, salt) {
  const data = new TextEncoder().encode(salt + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// PBKDF2 with 100k iterations (v2)
async function hashPasswordV2(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Unified hash function with version migration
export async function hashPassword(password, salt, hashVersion) {
  if (hashVersion === 2) return hashPasswordV2(password, salt);
  return hashPasswordV1(password, salt);
}

// Export V2 for new registrations
export async function hashPasswordNew(password, salt) {
  return hashPasswordV2(password, salt);
}

export function generateSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ===== JWT =====

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

// ===== Authentication (JWT only, PIN removed) =====

export async function authenticate(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (payload) {
      return {
        authenticated: true,
        username: payload.username,
        bitable: payload.bitable,
        isJWT: true,
      };
    }
  }
  return { authenticated: false };
}

// ===== Feishu Token =====

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

// ===== Refresh Token =====

export function generateRefreshToken() {
  return crypto.randomUUID();
}

export async function storeRefreshToken(kv, username, token, expiresInDays = 30) {
  const key = 'refresh:' + token;
  await kv.put(key, JSON.stringify({
    username,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInDays * 86400000).toISOString(),
  }), { expirationTtl: expiresInDays * 86400 });
}

export async function validateRefreshToken(kv, token) {
  const data = await kv.get('refresh:' + token);
  if (!data) return null;
  const parsed = JSON.parse(data);
  if (new Date(parsed.expiresAt) < new Date()) return null;
  return parsed;
}

export async function deleteRefreshToken(kv, token) {
  await kv.delete('refresh:' + token);
}

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

// ===== Audit Log =====

export async function logOp(kv, action, username, details, request) {
  const now = new Date();
  const ts = now.toISOString();
  const date = ts.slice(0, 10);
  const key = `log:${date}:${now.getTime()}`;
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  await kv.put(key, JSON.stringify({ action, username, details, ip, ts }), { expirationTtl: 2592000 });
}

export async function getLogs(kv, date, username) {
  const list = await kv.list({ prefix: `log:${date}` });
  const logs = [];
  for (const item of list.keys) {
    const data = await kv.get(item.name);
    if (data) {
      const log = JSON.parse(data);
      if (!username || log.username === username) {
        logs.push(log);
      }
    }
  }
  logs.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return logs;
}
