// 数据后端切换：DATA_BACKEND=mysql 时把业务请求反代到服务器（内网令牌）
// feishu（缺省）走各端点原有逻辑，随时可秒级回滚
export function mysqlMode(env) {
  return env.DATA_BACKEND === 'mysql' && env.SERVER_API_BASE && env.SERVICE_TOKEN;
}

// 转发请求；返回 Response（透传状态码/JSON体）。fetch 失败抛错由调用方兜底
export async function toServer(request, env, opts = {}) {
  const url = new URL(request.url);
  const base = env.SERVER_API_BASE.replace(/\/+$/, '');
  let path = url.pathname; // /api/items -> 服务器 /api/items
  const target = base + path + url.search;
  const headers = {
    'X-Service-Token': env.SERVICE_TOKEN,
    'Content-Type': request.headers.get('Content-Type') || 'application/json',
    'CF-Connecting-IP': request.headers.get('CF-Connecting-IP') || '',
  };
  const auth = request.headers.get('Authorization');
  if (auth) headers['Authorization'] = auth;
  const init = { method: request.method, headers };
  if (opts.keepBody !== false && request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }
  const res = await fetch(target, init);
  return res; // 调用方按需 .json() / 透传
}
