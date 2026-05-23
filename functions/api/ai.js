// AI 代理 - 深度备注解析 + 消费画像 + 智能分析
// 环境变量: DEEPSEEK_API_KEY

import { getCorsHeaders, jsonResponse, authenticate } from './_auth.js';

const AI_API_BASE = 'https://api.deepseek.com';

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  // 认证（JWT 或 旧 PIN）
  const user = await authenticate(request, env);
  if (!user.authenticated) return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);

  const json = (data, status = 200) => jsonResponse(data, status, corsHeaders);

  const apiKey = env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({ error: 'AI API key not configured. Set DEEPSEEK_API_KEY in Cloudflare Pages.' }, 500, corsHeaders);
  }

  try {
    const body = await request.json();
    const { action, data } = body;

    switch (action) {
      case 'parse': return await handleParse(apiKey, data, corsHeaders);
      case 'analyze': return await handleAnalyze(apiKey, data, corsHeaders);
      case 'categorize': return await handleCategorize(apiKey, data, corsHeaders);
      case 'profile': return await handleProfile(apiKey, data, corsHeaders);
      case 'query': return await handleQuery(apiKey, data, corsHeaders);
      default: return json({ error: 'Unknown action' }, 400, corsHeaders);
    }
  } catch (e) {
    return json({ error: e.message || 'AI request failed' }, 500, corsHeaders);
  }
}

async function callAI(apiKey, systemPrompt, userMessage, maxTokens = 800) {
  const res = await fetch(`${AI_API_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
  if (!res.ok) throw new Error(`AI API ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text).choices?.[0]?.message?.content || '';
  } catch {
    throw new Error('AI parse failed: ' + text.slice(0, 200));
  }
}

// ===== 自然语言记账 =====
async function handleParse(apiKey, data, corsHeaders) {
  const { text, currentDate } = data;
  const systemPrompt = `你是一个记账助手。用户用自然语言描述消费，解析成JSON。

当前日期: ${currentDate || new Date().toISOString().slice(0, 10)}

输出严格JSON:
{"type":"支出或收入","amount":数字,"category":"餐饮|交通|购物|娱乐|居住|医疗|教育|其他","date":"YYYY-MM-DDTHH:mm","note":"润色后的备注","confidence":0-1}

note字段规则:
- 从用户描述中提取核心消费信息，润色为一句简洁完整的记录
- 保留关键细节：商品/服务名、数量、地点（如有）
- 去掉流水账、闲聊、无关内容
- 长段落要浓缩，不是照抄原文
- 例: "午饭35" → "午餐 ¥35"; "今天中午和同事去公司附近湘菜馆吃了剁椒鱼头" → "湘菜馆午餐 剁椒鱼头 ¥128"; "刚才打车从家到公司花了28块" → "打车 家→公司 ¥28"

其他规则: 没提金额返回amount=0。"午饭"→餐饮,"打车"→交通。`;

  const result = await callAI(apiKey, systemPrompt, text);
  const m = result.match(/\{[\s\S]*\}/);
  if (m) { try { return json({ ok: true, data: JSON.parse(m[0]) }, 200, corsHeaders); } catch {} }
  return json({ ok: false, error: 'Parse failed' }, 200, corsHeaders);
}

// ===== AI 自动分类（从备注推断） =====
async function handleCategorize(apiKey, data, corsHeaders) {
  const { note, existingExpenses } = data;
  if (!note) return json({ ok: true, data: { category: '其他', confidence: 0, tags: [] } }, 200, corsHeaders);

  let historyHint = '';
  if (existingExpenses && existingExpenses.length > 0) {
    const recent = existingExpenses.slice(-50);
    const noteCatMap = {};
    recent.forEach(e => { if (e['备注'] && e['分类']) noteCatMap[e['备注'].slice(0, 6)] = e['分类']; });
    historyHint = '\n历史分类: ' + Object.entries(noteCatMap).slice(0, 10).map(([k, v]) => `「${k}」→${v}`).join(', ');
  }

  const systemPrompt = `根据备注判断分类。
分类: 餐饮、交通、购物、娱乐、居住、医疗、教育、其他
输出JSON: {"category":"分类","confidence":0-1,"tags":["标签1","标签2"]}
标签从备注提取有意义的关键词，最多3个。${historyHint}`;

  const result = await callAI(apiKey, systemPrompt, note, 200);
  const m = result.match(/\{[\s\S]*\}/);
  if (m) { try { return json({ ok: true, data: JSON.parse(m[0]) }, 200, corsHeaders); } catch {} }
  return json({ ok: true, data: { category: '其他', confidence: 0.2, tags: [] } }, 200, corsHeaders);
}

// ===== 深度备注解析 → 消费画像 =====
async function handleProfile(apiKey, data, corsHeaders) {
  const { expenses } = data;
  if (!expenses || !expenses.length) return json({ ok: true, data: { summary: '暂无数据', habits: [], insights: [] } }, 200, corsHeaders);

  // 构建完整数据上下文
  const lines = expenses.map(e => {
    const date = e['日期']?.slice(0, 10) || '?';
    const type = e['类型'] || '支出';
    const cat = e['分类'] || '其他';
    const amt = e['金额'] || 0;
    const note = e['备注'] || '(无备注)';
    return `${date} | ${type} | ${cat} | ¥${amt} | ${note}`;
  }).join('\n');

  const totalOut = expenses.filter(e => e['类型'] === '支出').reduce((s, e) => s + Number(e['金额'] || 0), 0);
  const totalIn = expenses.filter(e => e['类型'] === '收入').reduce((s, e) => s + Number(e['金额'] || 0), 0);

  const systemPrompt = `你是一个深度消费分析师。根据用户的完整记账数据（含备注），做深度解析。

本月数据:
${lines}

总支出: ¥${totalOut.toFixed(2)}
总收入: ¥${totalIn.toFixed(2)}

请输出严格JSON:
{
  "summary": "一段话总结这个月的消费全貌（2-3句）",
  "habits": [
    {"title":"习惯标题","detail":"具体描述，引用实际数据","emoji":"📊"}
  ],
  "insights": [
    {"title":"洞察标题","detail":"基于数据的发现","emoji":"💡"}
  ],
  "profile": {
    "diningStyle": "饮食风格描述（简餐为主/经常外食/做饭多等）",
    "lifestyle": "生活方式关键词（如：游戏宅/户外运动/社交达人等）",
    "spendingPattern": "消费模式（稳定型/冲动型/计划型等）",
    "topItems": ["消费最多的3样东西的描述"]
  }
}

要求:
- 从备注中读出具体细节: 吃了什么、去了哪、买了什么
- 不要泛泛而谈，要引用具体备注内容
- habits和insights各3-5条
- profile要从数据中推断，不要编造`;

  const result = await callAI(apiKey, systemPrompt, '分析我的消费画像', 1200);
  const m = result.match(/\{[\s\S]*\}/);
  if (m) { try { return json({ ok: true, data: JSON.parse(m[0]) }, 200, corsHeaders); } catch {} }
  return json({ ok: true, data: { summary: result, habits: [], insights: [], profile: {} } }, 200, corsHeaders);
}

// ===== 自然语言查询 =====
async function handleQuery(apiKey, data, corsHeaders) {
  const { question, expenses } = data;
  if (!expenses || !expenses.length) return json({ ok: true, data: '暂无记账数据' }, 200, corsHeaders);

  const lines = expenses.map(e => {
    const date = e['日期']?.slice(0, 10) || '?';
    return `${date} | ${e['类型']||'支出'} | ${e['分类']||'其他'} | ¥${e['金额']||0} | ${e['备注']||''}`;
  }).join('\n');

  const totalOut = expenses.filter(e => e['类型'] === '支出').reduce((s, e) => s + Number(e['金额'] || 0), 0);
  const totalIn = expenses.filter(e => e['类型'] === '收入').reduce((s, e) => s + Number(e['金额'] || 0), 0);

  const systemPrompt = `你是个人财务助手。用户会问关于消费数据的问题，你从数据中直接回答。

本月数据:
${lines}

总支出: ¥${totalOut.toFixed(2)} | 总收入: ¥${totalIn.toFixed(2)} | 共${expenses.length}笔

规则:
- 回答要基于数据，给出具体数字
- 简洁直接，1-3句话
- 如果数据不够就说"数据不足，无法判断"
- 用emoji让回答更生动`;

  const result = await callAI(apiKey, systemPrompt, question, 400);
  return json({ ok: true, data: result }, 200, corsHeaders);
}

// ===== 消费分析（统计页） =====
async function handleAnalyze(apiKey, data, corsHeaders) {
  const { expenses, items, month } = data;

  const expenseSummary = (expenses || []).map(e =>
    `${e['日期']?.slice(0,10) || '?'} | ${e['分类']} | ¥${e['金额']} | ${e['备注'] || ''}`
  ).join('\n');

  const itemSummary = (items || []).map(i =>
    `${i['商品名称']} | ¥${i['单价']}×${i['数量']} | ${i['状态']}`
  ).join('\n');

  const systemPrompt = `你是个人财务分析师。

记账数据:
${expenseSummary || '暂无'}

采购数据:
${itemSummary || '暂无'}

输出3-5条分析，每条格式:
emoji 标题
具体描述（引用数据）

重点: 消费异常、省钱机会、模式发现。语气轻松直接。`;

  const result = await callAI(apiKey, systemPrompt, '分析消费情况', 600);
  return json({ ok: true, data: result }, 200, corsHeaders);
}
