import { corsHeaders, json } from './_common.js';
import { authenticate } from '../_auth.js';

// Web Push 订阅存储（KV: webpush:{username}）
// GET  ?export=1&token=XX        -> 服务器拉取全部订阅（SERVICE_TOKEN 鉴权）
// GET                              -> 我的订阅
// POST {subscription}              -> 保存我的订阅（JWT）
// DELETE ?username=u&token=XX      -> 服务器按用户删除（410 过期清理）
// DELETE                            -> 删除我的订阅（JWT）
export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const KV = env.IMAGE_STORE;
  if (!KV) return json({ error: 'KV not available' }, 500, headers);
  const url = new URL(request.url);
  const svcToken = url.searchParams.get('token') || '';
  const isSvc = env.SERVICE_TOKEN && svcToken && svcToken === env.SERVICE_TOKEN;

  // 服务器导出全部订阅
  if (request.method === 'GET' && url.searchParams.get('export') === '1') {
    if (!isSvc) return json({ error: 'forbidden' }, 403, headers);
    try {
      const out = [];
      let cursor;
      do {
        const page = await KV.list({ prefix: 'webpush:', cursor });
        for (const k of page.keys) {
          try {
            const sub = await KV.get(k.name, 'json');
            if (sub) out.push({ username: k.name.slice(8), subscription: sub });
          } catch (e) {}
        }
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return json({ ok: true, subs: out }, 200, headers);
    } catch (e) { return json({ error: e.message }, 500, headers); }
  }

  // 服务器删除过期订阅
  if (request.method === 'DELETE' && isSvc) {
    const u = url.searchParams.get('username');
    if (!u) return json({ error: 'username required' }, 400, headers);
    await KV.delete('webpush:' + u);
    return json({ ok: true }, 200, headers);
  }

  const user = await authenticate(request, env);
  if (!user.authenticated) return json({ error: 'Unauthorized' }, 401, headers);
  const key = 'webpush:' + user.username;

  if (request.method === 'GET') {
    const sub = await KV.get(key, 'json');
    return json({ ok: true, subscription: sub || null }, 200, headers);
  }
  if (request.method === 'POST') {
    const body = await request.json();
    const sub = body && body.subscription;
    if (!sub || !sub.endpoint) return json({ error: 'subscription required' }, 400, headers);
    await KV.put(key, JSON.stringify(sub));
    return json({ ok: true }, 200, headers);
  }
  if (request.method === 'DELETE') {
    await KV.delete(key);
    return json({ ok: true }, 200, headers);
  }
  return json({ error: 'Method not allowed' }, 405, headers);
}
