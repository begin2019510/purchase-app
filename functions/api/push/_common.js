// push 公共模块 - 被所有 push 函数共享

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

export const CORS_ORIGINS = ['https://121212121.top', 'http://121212121.top'];

export function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

export async function getToken(env) {
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('Feishu auth failed');
  return data.tenant_access_token;
}

export async function feishuFetch(method, path, body, env) {
  const token = await getToken(env);
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${FEISHU_BASE}${path}`, opts);
  return res.json();
}

export async function getAllRecords(app, table, env) {
  const records = [];
  let pageToken = '';
  do {
    const url = `/bitable/v1/apps/${app}/tables/${table}/records?page_size=500${pageToken ? '&page_token=' + pageToken : ''}`;
    const data = await feishuFetch('GET', url, null, env);
    if (data.code !== 0) throw new Error('Feishu API error: ' + JSON.stringify(data));
    if (data.data?.items) records.push(...data.data.items);
    pageToken = data.data?.page_token || '';
  } while (pageToken);
  return records;
}
