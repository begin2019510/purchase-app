// GET /api/push/summary?type=weekly|monthly&token=***
// 周度/月度汇总推送飞书
import { corsHeaders, json, getAllRecords } from './_common.js';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  // 验证 token
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'weekly';
  const token = url.searchParams.get('token');
  if (env.CRON_SECRET && token !== env.CRON_SECRET) return json({ error: '未授权' }, 401, headers);

  if (!env.FEISHU_BOT_WEBHOOK) return json({ error: 'FEISHU_BOT_WEBHOOK 未配置' }, 500, headers);

  try {
    const now = new Date();
    const bjNow = new Date(now.getTime() + 8 * 3600 * 1000);
    const todayStr = bjNow.toISOString().slice(0, 10);

    // 读取采购数据
    const itemRecords = await getAllRecords(env.FEISHU_BITABLE_APP, env.FEISHU_BITABLE_TABLE, env);
    const items = itemRecords.map(r => {
      const f = r.fields;
      let dateStr = null;
      if (f['日期']) { try { dateStr = new Date(f['日期']).toISOString().slice(0, 10); } catch {} }
      return { name: f['商品名称'] || '', platform: f['平台'] || '', price: Number(f['单价']) || 0, qty: Number(f['数量']) || 1, status: f['状态'] || '待买', category: f['分类'] || '其他', date: dateStr, note: f['备注'] || '' };
    });

    // 读取记账数据
    const expRecords = await getAllRecords(env.FEISHU_EXPENSE_APP, env.FEISHU_EXPENSE_TABLE, env);
    const expenses = expRecords.map(r => {
      const f = r.fields;
      let dateStr = null;
      if (f['日期']) { try { dateStr = new Date(f['日期']).toISOString().slice(0, 10); } catch {} }
      return { date: dateStr, type: f['类型'] || '支出', category: f['分类'] || '其他', amount: Number(f['金额']) || 0, note: f['备注'] || '' };
    });

    let card;

    if (type === 'weekly') {
      // 最近7天
      const weekAgo = new Date(bjNow.getTime() - 7 * 86400000);
      const weekAgoStr = weekAgo.toISOString().slice(0, 10);

      const weekExpenses = expenses.filter(e => e.date && e.date >= weekAgoStr && e.date <= todayStr);
      const weekOut = weekExpenses.filter(e => e.type === '支出');
      const totalOut = weekOut.reduce((s, e) => s + e.amount, 0);
      const totalIn = weekExpenses.filter(e => e.type === '收入').reduce((s, e) => s + e.amount, 0);

      // 分类统计
      const catMap = {};
      weekOut.forEach(e => { catMap[e.category] = (catMap[e.category] || 0) + e.amount; });
      const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

      // Top5 消费
      const top5 = [...weekOut].sort((a, b) => b.amount - a.amount).slice(0, 5);

      const catLines = catEntries.map(([cat, val]) => `  **${cat}** ¥${val.toFixed(2)}`).join('\n');
      const topLines = top5.map((e, i) => `  ${i + 1}. ${e.category} ${e.note ? '(' + e.note + ')' : ''} **¥${e.amount.toFixed(2)}**`).join('\n');

      const weekItems = items.filter(i => i.date && i.date >= weekAgoStr && i.date <= todayStr);
      const weekItemTotal = weekItems.reduce((s, i) => s + i.price * i.qty, 0);

      card = {
        header: { title: { tag: 'plain_text', content: '📊 周度财务汇总' }, template: 'purple' },
        elements: [
          { tag: 'markdown', content: `**📅 ${weekAgoStr} ~ ${todayStr}**` },
          { tag: 'hr' },
          { tag: 'markdown', content: `💸 支出 **¥${totalOut.toFixed(2)}**  |  💰 收入 **¥${totalIn.toFixed(2)}**  |  📝 ${weekOut.length}笔` },
          { tag: 'markdown', content: `🛒 采购 ${weekItems.length} 件，花费 **¥${weekItemTotal.toFixed(2)}**` },
          ...(catEntries.length ? [
            { tag: 'hr' },
            { tag: 'markdown', content: `**📂 支出分类**\n${catLines}` },
          ] : []),
          ...(top5.length ? [
            { tag: 'hr' },
            { tag: 'markdown', content: `**🔥 Top5 消费**\n${topLines}` },
          ] : []),
          { tag: 'hr' },
          {
            tag: 'action',
            actions: [{
              tag: 'button', text: { tag: 'plain_text', content: '查看详情' },
              type: 'primary', url: 'https://121212121.top',
            }],
          },
        ],
      };
    } else {
      // 月度汇总
      const thisMonth = todayStr.slice(0, 7);
      const monthExpenses = expenses.filter(e => e.date && e.date.startsWith(thisMonth));
      const monthOut = monthExpenses.filter(e => e.type === '支出');
      const monthIn = monthExpenses.filter(e => e.type === '收入');
      const totalOut = monthOut.reduce((s, e) => s + e.amount, 0);
      const totalIn = monthIn.reduce((s, e) => s + e.amount, 0);
      const net = totalIn - totalOut;

      // 分类占比
      const catMap = {};
      monthOut.forEach(e => { catMap[e.category] = (catMap[e.category] || 0) + e.amount; });
      const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
      const catLines = catEntries.map(([cat, val]) => {
        const pct = totalOut > 0 ? (val / totalOut * 100).toFixed(1) : 0;
        return `  **${cat}** ¥${val.toFixed(2)} (${pct}%)`;
      }).join('\n');

      // 采购统计
      const monthItems = items.filter(i => i.date && i.date.startsWith(thisMonth));
      const monthItemTotal = monthItems.reduce((s, i) => s + i.price * i.qty, 0);
      const statusMap = {};
      monthItems.forEach(i => { statusMap[i.status] = (statusMap[i.status] || 0) + 1; });
      const statusLines = Object.entries(statusMap).map(([s, n]) => `  ${s === '待买' ? '⏳' : s === '已买' ? '✅' : s === '已到' ? '📦' : '↩️'} ${s} ${n}件`).join('\n');

      card = {
        header: { title: { tag: 'plain_text', content: '📊 月度财务汇总' }, template: 'purple' },
        elements: [
          { tag: 'markdown', content: `**📅 ${thisMonth}**` },
          { tag: 'hr' },
          { tag: 'markdown', content: `💸 支出 **¥${totalOut.toFixed(2)}**  |  💰 收入 **¥${totalIn.toFixed(2)}**` },
          { tag: 'markdown', content: `📊 净收支 **¥${net.toFixed(2)}** ${net >= 0 ? '✅' : '⚠️'}  |  📝 ${monthOut.length}笔支出` },
          { tag: 'hr' },
          { tag: 'markdown', content: `**📂 支出分类占比**\n${catLines || '  暂无数据'}` },
          { tag: 'hr' },
          { tag: 'markdown', content: `**🛒 采购统计**\n  本月 ${monthItems.length} 件，花费 **¥${monthItemTotal.toFixed(2)}**\n${statusLines}` },
          { tag: 'hr' },
          {
            tag: 'action',
            actions: [{
              tag: 'button', text: { tag: 'plain_text', content: '查看详情' },
              type: 'primary', url: 'https://121212121.top',
            }],
          },
        ],
      };
    }

    // 发送飞书
    const webhookRes = await fetch(env.FEISHU_BOT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'interactive', card }),
    });
    const result = await webhookRes.json();

    return json({
      ok: true,
      type,
      sent: (result.code === 0 || result.StatusCode === 0) ? 1 : 0,
      result,
    }, 200, headers);
  } catch (e) {
    return json({ error: e.message }, 500, headers);
  }
}
