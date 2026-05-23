// AI 代理 - 自然语言记账 & 消费分析
// 环境变量: DEEPSEEK_API_KEY (或 OPENAI_API_KEY 作为备选)

const AI_API_BASE = 'https://api.deepseek.com';

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ['https://121212121.top', 'http://121212121.top'].includes(origin) ? origin : 'https://121212121.top',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-API-Key',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }

  // 验证 PIN
  const pin = request.headers.get('X-API-Key');
  if (!pin || pin !== env.API_KEY) {
    return json({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  // 检查 API Key
  const apiKey = env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({ error: 'AI API key not configured. Set DEEPSEEK_API_KEY in Cloudflare Pages.', hint: 'https://dash.deepseek.com → API Keys → Create' }, 500, corsHeaders);
  }

  try {
    const body = await request.json();
    const { action, data } = body;

    if (action === 'parse') {
      // 自然语言记账 → 结构化数据
      return await handleParse(apiKey, data, corsHeaders);
    } else if (action === 'analyze') {
      // 消费分析
      return await handleAnalyze(apiKey, data, corsHeaders);
    } else if (action === 'chat') {
      // 通用对话
      return await handleChat(apiKey, data, corsHeaders);
    } else {
      return json({ error: 'Unknown action. Use: parse, analyze, chat' }, 400, corsHeaders);
    }
  } catch (e) {
    return json({ error: e.message || 'AI request failed' }, 500, corsHeaders);
  }
}

async function callAI(apiKey, systemPrompt, userMessage, maxTokens = 800) {
  const res = await fetch(`${AI_API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.1,
    }),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`AI API ${res.status}: ${text.slice(0, 200)}`);
  }

  try {
    const result = JSON.parse(text);
    return result.choices?.[0]?.message?.content || '';
  } catch {
    throw new Error('AI response parse failed: ' + text.slice(0, 200));
  }
}

// ===== 自然语言记账 =====
async function handleParse(apiKey, data, corsHeaders) {
  const { text, currentDate } = data;

  const systemPrompt = `你是一个记账助手。用户会用自然语言描述一笔消费或收入，你需要解析成结构化JSON。

当前日期: ${currentDate || new Date().toISOString().slice(0, 10)}

输出格式（严格JSON，不要markdown）:
{
  "type": "支出" 或 "收入",
  "amount": 数字（必填）,
  "category": "餐饮|交通|购物|娱乐|居住|医疗|教育|其他",
  "date": "YYYY-MM-DDTHH:mm" (可选，如果用户提到了时间),
  "note": "备注（用户原始输入的摘要）",
  "confidence": 0-1之间的数字
}

规则:
- 没提金额就返回 amount=0, confidence=0
- "午饭""早餐""晚餐"→餐饮, "打车""地铁""公交"→交通, "淘宝""拼多多"→购物
- 语气词如"了""吧""啊"去掉，保留关键信息
- 今天是 ${currentDate || new Date().toISOString().slice(0, 10)}
- 如果是"收到工资""红包"等 → type=收入, category=其他`;

  const result = await callAI(apiKey, systemPrompt, text);
  // 尝试提取JSON
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return json({ ok: true, data: parsed }, 200, corsHeaders);
    } catch {}
  }
  return json({ ok: false, error: 'Failed to parse AI response', raw: result }, 200, corsHeaders);
}

// ===== 消费分析 =====
async function handleAnalyze(apiKey, data, corsHeaders) {
  const { expenses, items, month, question } = data;

  // 构建上下文
  const expenseSummary = (expenses || []).map(e =>
    `${e['日期']?.slice(0,10) || '?'} | ${e['类型']} | ${e['分类']} | ¥${e['金额']} | ${e['备注'] || ''}`
  ).join('\n');

  const itemSummary = (items || []).map(i =>
    `${i['商品名称']} | ${i['平台']} | ¥${i['单价']}×${i['数量']} | ${i['状态']} | ${i['分类']}`
  ).join('\n');

  const systemPrompt = `你是一个个人财务分析师。根据用户的采购和记账数据，给出简洁实用的分析建议。

当前月份: ${month || new Date().toISOString().slice(0,7)}

记账数据:
${expenseSummary || '暂无数据'}

采购数据:
${itemSummary || '暂无数据'}

要求:
1. 用 emoji + 简短标题格式输出
2. 每条建议不超过2句话
3. 重点说: 消费异常、省钱机会、预算建议
4. 数据少就说数据不足，别编造
5. 语气轻松直接，像朋友聊天`;

  const userMsg = question || '分析我的消费情况，给几个建议';
  const result = await callAI(apiKey, systemPrompt, userMsg, 600);
  return json({ ok: true, data: result }, 200, corsHeaders);
}

// ===== 通用对话 =====
async function handleChat(apiKey, data, corsHeaders) {
  const { message, context: ctx } = data;
  const systemPrompt = `你是个人管家助手，帮用户管理采购和记账。
当前页面有: 采购管理（审批流）、记账管理（月历视图）、统计分析（趋势图）。
回答简洁，每次不超过3句话。${ctx ? '\n页面上下文: ' + ctx : ''}`;

  const result = await callAI(apiKey, systemPrompt, message, 400);
  return json({ ok: true, data: result }, 200, corsHeaders);
}
