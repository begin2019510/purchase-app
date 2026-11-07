// 数据后端切换：DATA_BACKEND=mysql 时把业务请求反代到服务器（内网令牌）
// feishu（缺省）走各端点原有逻辑，随时可秒级回滚
// 鉴权模型：CF 侧先用现有 JWT 逻辑验明身份（不依赖服务器密钥一致性），
// 通过 X-Auth-User 转发用户名；服务器只信任带 X-Service-Token 的请求
import { verifyJWT, jsonResponse } from './_auth.js';

export function mysqlMode(env) {
  // 大小写/首尾空格不敏感：MYSQL、mysql 、Mysql 都算选中 MySQL，
  // 避免运维写 MYSQL 时被当成 feishu 静默分叉写入（审计发现②）。
  const v = String(env.DATA_BACKEND == null ? '' : env.DATA_BACKEND).trim().toLowerCase();
  if (v !== 'mysql') return false;
  // 一旦选中 MySQL 就绝不回落飞书 handler（fail-closed）。
  // 凭证不全时不在此处 throw（throw 会逃出各端点 onRequest 的 try，
  // 变成无 CORS 的 HTML 500），改由 toServer()/serverAuth() 返回 JSON 配置错误。
  return true;
}

// CF 侧验 token（支持 Header 与 ?token=，后者用于 <img src>）
export async function authUser(request, env) {
  let token = '';
  const h = request.headers.get('Authorization');
  if (h && h.startsWith('Bearer ')) token = h.replace('Bearer ', '');
  if (!token) {
    try { token = new URL(request.url).searchParams.get('token') || ''; } catch (e) {}
  }
  if (!token) return null;
  const p = await verifyJWT(token, env.JWT_SECRET);
  if (!p || !p.username) return null;
  // 改密后旧 access JWT 立刻作废（与 auth.js 同一 KV 键）
  try {
    const pc = await env.IMAGE_STORE.get('pwd_changed:' + p.username);
    if (pc && Number(p.iat || 0) < Number(pc)) return null;
  } catch (e) { /* KV 故障不挡主路径 */ }
  return p.username;
}

// 转发请求；返回 Response（透传状态码/JSON体）
export async function toServer(request, env, opts = {}) {
  // fail-closed：选了 mysql 但凭证不全 → JSON 500（由调用方补 CORS），绝不静默走飞书
  if (!env.SERVER_API_BASE || !env.SERVICE_TOKEN) {
    return jsonResponse({ error: 'DATA_BACKEND=mysql 需要配置 SERVER_API_BASE 和 SERVICE_TOKEN' }, 500, {
      'Access-Control-Allow-Origin': '*',
    });
  }
  const url = new URL(request.url);
  const base = env.SERVER_API_BASE.replace(/\/+$/, '');
  const target = base + url.pathname + url.search;
  const headers = {
    'X-Service-Token': env.SERVICE_TOKEN,
    'Content-Type': request.headers.get('Content-Type') || 'application/json',
    'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '',
  };
  const auth = request.headers.get('Authorization');
  if (auth) headers['Authorization'] = auth;
  if (opts.username) headers['X-Auth-User'] = opts.username;
  const init = { method: request.method, headers };
  if (opts.keepBody !== false && request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }
  return fetch(target, init);
}

// CF 侧验 JWT 后转发到内网；后端不可用时也返回 JSON，避免前端收到 SPA HTML
export async function proxyToServer(request, env, corsHeaders) {
  const uname = await authUser(request, env);
  if (!uname) return jsonResponse({ error: '未授权：请登录' }, 401, corsHeaders);
  let sr;
  try {
    sr = await toServer(request, env, { username: uname });
  } catch (e) {
    console.error('proxyToServer:', e && e.message);
    return jsonResponse({ error: '数据服务暂时不可用，请稍后重试' }, 502, corsHeaders);
  }
  return new Response(sr.body, {
    status: sr.status,
    headers: {
      'Access-Control-Allow-Origin': (corsHeaders && corsHeaders['Access-Control-Allow-Origin']) || '*',
      'Content-Type': sr.headers.get('Content-Type') || 'application/json',
    },
  });
}
