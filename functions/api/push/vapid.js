// GET /api/push/vapid - 获取 VAPID 公钥
// 用于客户端订阅 Web Push

import { json, corsHeaders } from '../../_utils.js';

export async function onRequest(context) {
  const { env } = context;
  const request = context.request;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // VAPID 公钥存储在环境变量中
  if (!env.VAPID_PUBLIC_KEY) {
    return json({ error: 'VAPID keys not configured' }, 500, headers);
  }

  return json({
    publicKey: env.VAPID_PUBLIC_KEY,
    // 也可以返回 email（用于 VAPID 声明）
  }, 200, headers);
}
