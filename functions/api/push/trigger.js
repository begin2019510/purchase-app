// GET/POST /api/push/trigger - 触发每日记账提醒
// 通过飞书机器人 webhook 发送推送（国内可用）
// 需要环境变量: CRON_SECRET（调用密钥）, FEISHU_BOT_WEBHOOK
import { corsHeaders, json } from './_common.js';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  // 验证 cron 密钥
  const authHeader = request.headers.get('Authorization');
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || (authHeader ? authHeader.replace('Bearer ', '') : '');
  if (env.CRON_SECRET && token !== env.CRON_SECRET) return json({ error: '未授权' }, 401, headers);

  if (!env.FEISHU_BOT_WEBHOOK) return json({ error: 'FEISHU_BOT_WEBHOOK 未配置' }, 500, headers);

  // 根据 UTC 时间推算北京时间，选文案
  const now = new Date();
  const bjHour = (now.getUTCHours() + 8) % 24;

  let messages;
  if (bjHour >= 11 && bjHour < 14) {
    messages = [
      '🌤️ 中午了！上午买了什么？记一笔吧',
      '🥢 午饭时间到，顺便记一下今天的开销',
      '⏰ 中午提醒：别忘了记账哦',
    ];
  } else if (bjHour >= 17 && bjHour < 20) {
    messages = [
      '🌆 下班时间到！今天花了多少钱，记一下吧',
      '📝 今日消费总结：打开采购管家记录一下',
      '💰 一天过去了，别忘了记账哦',
    ];
  } else {
    messages = ['⏰ 该记账了！记得记录今天的开销'];
  }

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

  return json({
    ok: true,
    sent: (result.code === 0 || result.StatusCode === 0) ? 1 : 0,
  }, 200, headers);
}
