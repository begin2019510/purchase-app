// GET/POST /api/push/trigger - 触发每日提醒推送
// 调用此接口会向所有订阅者发送每日提醒
// 可被外部 cron 服务调用（如 cron-job.org）
// 需要环境变量: CRON_SECRET（调用密钥）

import { json, corsHeaders } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // 验证 cron 密钥（防止被别人调用）
  const authHeader = request.headers.get('Authorization');
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || (authHeader ? authHeader.replace('Bearer ', '') : '');

  if (env.CRON_SECRET && token !== env.CRON_SECRET) {
    return json({ error: '未授权' }, 401, headers);
  }

  const now = new Date();

  // 可选：限制只在特定时间段发送（防止重复）
  // 从 KV 读取上次发送日期
  const lastSent = await env.PUSH_KV.get('last_daily_sent');
  const today = now.toISOString().slice(0, 10);
  if (lastSent === today) {
    return json({ ok: true, message: '今天已发送过提醒' }, 200, headers);
  }

  // 获取所有推送订阅
  const list = await env.PUSH_KV.list({ prefix: 'sub:' });
  if (!list.keys || list.keys.length === 0) {
    return json({ ok: true, sent: 0, message: '无订阅者' }, 200, headers);
  }

  let sent = 0;
  let expired = 0;
  const toDelete = [];

  for (const key of list.keys) {
    const record = await env.PUSH_KV.get(key.name, { type: 'json' });
    if (!record?.subscription?.keys) {
      toDelete.push(key.name);
      continue;
    }

    // 构建推送 payload
    const payloads = [
      {
        title: '📦 该记账了',
        body: '今天买了什么？花了几块钱？记一下吧 💰',
        tag: 'daily-reminder',
        url: '/',
      },
      {
        title: '💰 采购管家提醒',
        body: '别忘了记账哦，积少成多 ✨',
        tag: 'daily-reminder',
        url: '/',
      },
      {
        title: '📝 今日消费记录',
        body: '打开采购管家，记录今天的开销',
        tag: 'daily-reminder',
        url: '/',
      },
    ];

    const payload = payloads[Math.floor(Math.random() * payloads.length)];

    try {
      // 调用 send 接口发送
      const sendRes = await fetch(`${new URL(request.url).origin}/api/push/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Call': 'true',
        },
        body: JSON.stringify({
          endpoint: record.subscription.endpoint,
          keys: record.subscription.keys,
          payload: JSON.stringify(payload),
        }),
      });

      const result = await sendRes.json();
      if (result.expired) {
        toDelete.push(key.name);
        expired++;
      } else if (result.ok) {
        sent++;
      }
    } catch (e) {
      console.error('Push send error:', e);
    }
  }

  // 清理过期订阅
  for (const k of toDelete) await env.PUSH_KV.delete(k);

  // 记录已发送
  await env.PUSH_KV.put('last_daily_sent', today, { expirationTtl: 86400 * 2 });

  return json({
    ok: true,
    sent,
    expired,
    total: list.keys.length,
    date: today,
  }, 200, headers);
}
