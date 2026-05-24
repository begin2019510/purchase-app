// GET /api/push/archive-check?token=***
// 检查已到/已退超过3天未归档的记录，飞书提醒
import { corsHeaders, json, getAllRecords } from './_common.js';

// 解析 "YYYY-MM-DD HH:mm" 格式的时间
function parseTimeStr(str) {
  if (!str) return null;
  try {
    const [datePart, timePart] = str.split(' ');
    if (!datePart) return null;
    const [y, m, d] = datePart.split('-').map(Number);
    const [h, min] = (timePart || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, h, min);
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  // 验证 token
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (env.CRON_SECRET && token !== env.CRON_SECRET) return json({ error: '未授权' }, 401, headers);

  if (!env.FEISHU_BOT_WEBHOOK) return json({ error: 'FEISHU_BOT_WEBHOOK 未配置' }, 500, headers);

  try {
    const now = new Date();
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

    // 读取采购数据
    const records = await getAllRecords(env.FEISHU_BITABLE_APP, env.FEISHU_BITABLE_TABLE, env);

    const needArchive = [];

    for (const r of records) {
      const f = r.fields;
      const status = f['状态'] || '';
      if (status !== '已到' && status !== '已退') continue;

      // 用到货时间判断
      const timeField = f['到货时间'] || '';
      const arriveTime = parseTimeStr(timeField);
      if (!arriveTime) continue;

      const elapsed = now.getTime() - arriveTime.getTime();
      if (elapsed > THREE_DAYS_MS) {
        needArchive.push({
          name: f['商品名称'] || '未知商品',
          status,
          arriveTime: timeField,
          days: Math.floor(elapsed / (24 * 60 * 60 * 1000)),
        });
      }
    }

    if (needArchive.length === 0) {
      return json({ ok: true, count: 0, message: '没有需要归档的记录' }, 200, headers);
    }

    // 构建飞书 interactive card
    const itemLines = needArchive.map(item => {
      const icon = item.status === '已到' ? '📦' : '↩️';
      return `  ${icon} **${item.name}** — ${item.status}，已${item.days}天`;
    }).join('\n');

    const card = {
      header: { title: { tag: 'plain_text', content: '🗄️ 归档提醒' }, template: 'purple' },
      elements: [
        { tag: 'markdown', content: `以下 **${needArchive.length}** 条采购记录已超过3天未归档：` },
        { tag: 'hr' },
        { tag: 'markdown', content: itemLines },
        { tag: 'hr' },
        { tag: 'markdown', content: '请及时归档，保持数据整洁 ✨' },
        {
          tag: 'action',
          actions: [{
            tag: 'button', text: { tag: 'plain_text', content: '去归档' },
            type: 'primary', url: 'https://121212121.top',
          }],
        },
      ],
    };

    // 发送飞书
    const webhookRes = await fetch(env.FEISHU_BOT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', card }),
    });
    const result = await webhookRes.json();

    return json({
      ok: true,
      count: needArchive.length,
      items: needArchive,
      sent: (result.code === 0 || result.StatusCode === 0) ? 1 : 0,
      result,
    }, 200, headers);
  } catch (e) {
    return json({ error: e.message }, 500, headers);
  }
}
