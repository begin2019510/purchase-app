// POST /api/notify - 发送飞书机器人消息推送
// POST body: { message: "通知内容" }
// 需要环境变量: FEISHU_BOT_WEBHOOK (飞书自定义机器人 webhook 地址)

import { json, corsHeaders, verifyPin } from '../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, headers);
  }

  if (!verifyPin(request, env)) {
    return json({ error: '未授权' }, 401, headers);
  }

  if (!env.FEISHU_BOT_WEBHOOK) {
    return json({ error: '飞书 Bot Webhook 未配置' }, 500, headers);
  }

  try {
    const { message, title } = await request.json();
    if (!message) return json({ error: 'message required' }, 400, headers);

    // 发送飞书自定义机器人消息
    const webhookBody = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: title || '📦 采购管家' },
          template: 'purple',
        },
        elements: [
          {
            tag: 'markdown',
            content: message,
          },
          {
            tag: 'action',
            actions: [
              {
                tag: 'button',
                text: { tag: 'plain_text', content: '查看采购单' },
                type: 'primary',
                url: 'https://121212121.top',
              },
            ],
          },
        ],
      },
    };

    const res = await fetch(env.FEISHU_BOT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookBody),
    });

    const result = await res.json();

    if (result.code !== 0 && result.StatusCode !== 0) {
      return json({ error: '飞书发送失败', detail: result }, 500, headers);
    }

    return json({ ok: true }, 200, headers);
  } catch (e) {
    return json({ error: e.message }, 500, headers);
  }
}
