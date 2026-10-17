// 数据后端切换：DATA_BACKEND=mysql 时把业务请求反代到服务器（内网令牌）
// feishu（缺省）走各端点原有逻辑，随时可秒级回滚
// 鉴权模型：CF 侧先用现有 JWT 逻辑验明身份（不依赖服务器密钥一致性），
// 通过 X-Auth-User 转发用户名；服务器只信任带 X-Service-Token 的请求
import { verifyJWT } from './_auth.js';

export function mysqlMode(env) {
  return env.DATA_BACKEND === 'mysql' && env.SERVER_API_BASE && env.SERVICE_TOKEN;
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
  return p && p.username ? p.username : null;
}

// 转发请求；返回 Response（透传状态码/JSON体）
export async function toServer(request, env, opts = {}) {
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
