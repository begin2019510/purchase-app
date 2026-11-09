// GET /api/push/archive-check?token=***
// 检查已到/已退超过3天未归档的记录，飞书提醒
// DATA_BACKEND=mysql → 反代到服务器查 purchase_orders（单一数据源，不再有飞书副本滞后）；
// feishu 回退分支原样保留（DATA_BACKEND 非 mysql 时走旧 KV→bitable 逻辑）
import { corsHeaders, json, getAllRecords } from './_common.js';
import { mysqlMode, toServer } from '../_proxy.js';

// 获取所有用户的采购记录（多用户支持 + 旧版兼容，仅 DATA_BACKEND=feishu 回退用）
async function getAllArchiveRecords(env) {
  const kv = env.IMAGE_STORE;
  const allRecords = [];
  try {
    const keys = await kv.list({ prefix: 'user:' });
    for (const key of keys.keys) {
      const data = await kv.get(key.name);
      if (!data) continue;
      const user = JSON.parse(data);
      if (!user.bitable || !user.bitable.purchaseApp || !user.bitable.purchaseTable) continue;
      try {
        const recs = await getAllRecords(user.bitable.purchaseApp, user.bitable.purchaseTable, env);
        allRecords.push(...recs);
      } catch (e) { console.error('Load user records failed:', user.username, e.message); }
    }
  } catch {}
  if (allRecords.length === 0 && env.FEISHU_BITABLE_APP) {
    try { const recs = await getAllRecords(env.FEISHU_BITABLE_APP, env.FEISHU_BITABLE_TABLE, env); allRecords.push(...recs); } catch {}
  }
  return allRecords;
}

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
  if (!env.CRON_SECRET) return json({ error: 'CRON_SECRET 未配置' }, 503, headers);
  if (token !== env.CRON_SECRET) return json({ error: '未授权' }, 401, headers);

  if (!env.FEISHU_BOT_WEBHOOK) return json({ error: 'FEISHU_BOT_WEBHOOK 未配置' }, 500, headers);

  try {
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    let needArchive = [];

    if (mysqlMode(env)) {
      // 服务器端已完成筛选（状态∈{已到,已退} 且 arrived_at 超 3 天），直接取清单
      const sr = await toServer(request, env);
      const data = await sr.json().catch(() => null);
      if (!sr.ok || !data || data.ok !== true) {
        return json({ error: (data && data.error) || ('server HTTP ' + sr.status) },
          sr.status >= 400 && sr.status < 600 ? sr.status : 502, headers);
      }
      needArchive = Array.isArray(data.items) ? data.items : [];
    } else {
      // feishu 回退：读 KV 用户配置 → 飞书 bitable
      const now = new Date();
      const records = await getAllArchiveRecords(env);
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
