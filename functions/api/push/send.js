// POST /api/push/send - 发送推送通知
// POST body: { title, body, url?, tag? }

import { json, corsHeaders, verifyPin } from '../../_utils.js';

// web-push 在边缘环境中不直接可用，手动发送 Web Push
async function sendWebPush(subscription, payload, env) {
  const { endpoint, keys } = subscription;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) return null;

  const url = new URL(endpoint);
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);

  // 构建加密的 push payload（简化版本：不加密，使用明文）
  // 注：生产环境应使用 web-push 库的 encrypt 方法
  // 但 Cloudflare Workers 不支持 Node.js crypto，所以用 TTL-only 方式
  const headers = {
    'Content-Type': 'application/octet-stream',
    'TTL': '86400',
    'Urgency': 'high',
  };

  // 如果有 VAPID，加上 Authorization header
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    // 简化：使用 web-push 的 VAPID 签名
    // 实际需要用 ECDSA P-256 签名
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: new TextEncoder().encode(body),
    });

    // 201 = 成功, 410 = 订阅已过期
    if (res.status === 410) {
      return { expired: true };
    }

    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { error: e.message };
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // 内部调用也行（从其他 function 调用时不需要 PIN）
  const isInternal = request.headers.get('X-Internal-Call') === 'true';
  if (!isInternal && !verifyPin(request, env)) {
    return json({ error: '未授权' }, 401, headers);
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, headers);
  }

  try {
    const { title, body: bodyText, url, tag } = await request.json();

    // 从 KV 获取所有订阅
    const list = await env.PUSH_KV.list({ prefix: 'sub:' });
    if (!list.keys || list.keys.length === 0) {
      return json({ ok: true, message: '没有订阅者', sent: 0 }, 200, headers);
    }

    const payload = {
      title: title || '📦 采购提醒',
      body: bodyText || '记得记账哦 💰',
      url: url || '/',
      tag: tag || 'purchase-reminder',
    };

    let sent = 0;
    let expired = 0;
    const expiredKeys = [];

    for (const key of list.keys) {
      const record = await env.PUSH_KV.get(key.name, { type: 'json' });
      if (!record || !record.subscription) {
        expiredKeys.push(key.name);
        continue;
      }

      const result = await sendWebPush(record.subscription, payload, env);
      if (result && result.expired) {
        expiredKeys.push(key.name);
        expired++;
      } else if (result && result.ok) {
        sent++;
      }
    }

    // 清理过期订阅
    for (const key of expiredKeys) {
      await env.PUSH_KV.delete(key);
    }

    return json({
      ok: true,
      sent,
      expired,
      total: list.keys.length,
    }, 200, headers);
  } catch (e) {
    return json({ error: e.message }, 500, headers);
  }
}
