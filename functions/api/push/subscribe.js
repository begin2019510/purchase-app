// POST /api/push/subscribe - 注册推送订阅
// DELETE /api/push/subscribe - 取消订阅
// POST body: { subscription: { endpoint, keys: { p256dh, auth } } }

import { json, corsHeaders, verifyPin } from '../../_utils.js';

async function hashEndpoint(endpoint) {
  const data = new TextEncoder().encode(endpoint);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (!verifyPin(request, env)) {
    return json({ error: '未授权' }, 401, headers);
  }

  try {
    if (request.method === 'POST') {
      const { subscription } = await request.json();
      if (!subscription || !subscription.endpoint) {
        return json({ error: 'subscription required' }, 400, headers);
      }

      const key = 'sub:' + await hashEndpoint(subscription.endpoint);
      const record = {
        subscription,
        createdAt: Date.now(),
      };

      await env.PUSH_KV.put(key, JSON.stringify(record), {
        expirationTtl: 60 * 60 * 24 * 180, // 180 天过期
      });

      return json({ ok: true }, 200, headers);
    }

    if (request.method === 'DELETE') {
      const { endpoint } = await request.json();
      if (!endpoint) return json({ error: 'endpoint required' }, 400, headers);

      const key = 'sub:' + await hashEndpoint(endpoint);
      await env.PUSH_KV.delete(key);
      return json({ ok: true }, 200, headers);
    }

    return json({ error: 'Method not allowed' }, 405, headers);
  } catch (e) {
    return json({ error: e.message }, 500, headers);
  }
}
