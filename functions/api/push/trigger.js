// GET/POST /api/push/trigger - 触发每日记账提醒
// 通过飞书机器人 webhook 发送推送（国内可用）
// 需要环境变量: CRON_SECRET（调用密钥）, FEISHU_BOT_WEBHOOK

import { json, corsHeaders } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // 验证 cron 密钥
  const authHeader = request.headers.get('Authorization');
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || (authHeader ? authHeader.replace('Bearer ', '') : '');
  if (env.CRON_SECRET && token !== env.CRON_SECRET) {
    return json({ error: '未授权' }, 401, headers);
  }

  if (!env.FEISHU_BOT_WEBHOOK) {
    return json({ error: 'FEISHU_BOT_WEBHOOK 未配置，请在 Cloudflare 环境变量中添加' }, 500, headers);
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // 防止同一天重复发送（用 KV 记录，没有 KV 也跳过）
  let lastSent = null;
  if (env.PUSH_KV) {
    try { lastSent = await env.PUSH_KV.get('last_daily_sent'); } catch {}
  }
  if (lastSent === today) {
    return json({ ok: true, message: '今天已发送过提醒' }, 200, headers);
  }

  // 随机一条提醒文案
  const messages = [
    '今天又花了多少钱？记一笔吧 💰',
    '⏰ 该记账了！打开采购管家记录今天的开销',
    '记得记账哦，不然月底对不上账了 📝',
    '📦 采购管家提醒：今天别忘了记账～',
    '积少成多，每天记账好习惯 ✨',
  ];
  const msg = messages[Math.floor(Math.random() * messages.length)];

  // 通过飞书机器人发送
  const feishuPayload = {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: '📦 该记账了' }, template: 'purple' },
      elements: [
        { tag: 'markdown', content: msg },
        {
          tag: 'action',
          actions: [{
            tag: 'button', text: { tag: 'plain_text', content: '📝 去记账' },
            type: 'primary', url: 'https://121212121.top',
          }],
        },
      ],
    },
  };

  const res = await fetch(env.FEISHU_BOT_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feishuPayload),
  });

  const result = await res.json();

  // 记录已发送
  if (env.PUSH_KV) {
    try { await env.PUSH_KV.put('last_daily_sent', today, { expirationTtl: 86400 * 3 }); } catch {}
  }

  return json({
    ok: true,
    sent: (result.code === 0 || result.StatusCode === 0) ? 1 : 0,
    date: today,
  }, 200, headers);
}
