// POST /api/push/subscribe - 注册推送订阅
// DELETE /api/push/subscribe - 取消订阅

import { json, corsHeaders, verifyPin } from '../../_utils.js';

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
      const subscription = await request.json();
      if (!subscription || !subscription.endpoint) {
        return json({ error: 'subscription required' }, 400, headers);
      }

      // 用 endpoint 的 hash 作为 key（避免存储过长的 endpoint URL）
      const key = 'sub:' + await hashEndpoint(subscription.endpoint);

      // 存储订阅 + 过期时间
      const record = {
        subscription,
        createdAt: Date.now(),
        userAgent: request.headers.get('User-Agent') || '',
      };

      await env.PUSH_KV.put(key, JSON.stringify(record), {
        expirationTtl: 60 * 60 * 24 * 90, // 90 天过期
      });

      return json({ ok: true, message: '订阅成功' }, 200, headers);
    }

    if (request.method === 'DELETE') {
      const { endpoint } = await request.json();
      if (!endpoint) return json({ error: 'endpoint required' }, 400, headers);

      const key = 'sub:' + await hashEndpoint(endpoint);
      await env.PUSH_KV.delete(key);

      return json({ ok: true, message: '已取消订阅' }, 200, headers);
    }

    return json({ error: 'Method not allowed' }, 405, headers);
  } catch (e) {
    return json({ error: e.message }, 500, headers);
  }
}

async function hashEndpoint(endpoint) {
  const encoder = new TextEncoder();
  const data = encoder.encode(endpoint);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
