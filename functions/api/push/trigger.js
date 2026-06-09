// GET/POST /api/push/trigger - 触发每日记账提醒（飞书 + JPush）
import { corsHeaders, json } from './_common.js';
import { handleSend } from './jpush.js';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  // 验证 cron 密钥
  const authHeader = request.headers.get('Authorization');
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || (authHeader ? authHeader.replace('Bearer ', '') : '');
  if (env.CRON_SECRET && token !== env.CRON_SECRET) return json({ error: '未授权' }, 401, headers);

  // 根据 UTC 时间推算北京时间，选文案
  const now = new Date();
  const bjHour = (now.getUTCHours() + 8) % 24;

  let messages;
  if (bjHour >= 11 && bjHour < 14) {
    messages = [
      '中午该记账了！上午买了什么？记一笔吧',
      '午饭时间到，顺便记一下今天的开支',
      '中午提醒：别忘了记账哦',
    ];
  } else if (bjHour >= 17 && bjHour < 20) {
    messages = [
      '下班时间到！今天花了多少钱，记一下吧',
      '今日消费总结：打开采购管家记录一下',
      '一天过去了，别忘了记账哦',
    ];
  } else {
    messages = ['该记账了！记得记录今天的开支'];
  }

  const msg = messages[Math.floor(Math.random() * messages.length)];
  const title = '📝 该记账了';

  // 1. 飞书机器人推送（如果有配置）
  let feishuSent = 0;
  if (env.FEISHU_BOT_WEBHOOK) {
    try {
      const feishuPayload = {
        msg_type: 'interactive',
        card: {
          header: { title: { tag: 'plain_text', content: title }, template: 'purple' },
          elements: [
            { tag: 'markdown', content: msg },
            {
              tag: 'action',
              actions: [{
                tag: 'button', text: { tag: 'plain_text', content: '去记账' },
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
      feishuSent = (result.code === 0 || result.StatusCode === 0) ? 1 : 0;
    } catch(e) {
      console.log('Feishu push error:', e.message);
    }
  }

  // 2. JPush 推送（发送给所有已注册用户）
  let jpushSent = 0;
  try {
    // 获取所有已注册的 JPush 用户
    const list = await env.KV.list({ prefix: 'jpush:' });
    for (const key of list.keys) {
      const username = key.name.replace('jpush:', '');
      const result = await handleSend(env, username, title, msg, { type: 'reminder' });
      if (result.ok) jpushSent++;
    }
  } catch(e) {
    console.log('JPush push error:', e.message);
  }

  return json({
    ok: true,
    feishuSent,
    jpushSent,
    message: msg
  }, 200, headers);
}