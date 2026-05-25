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
      case 'evaluate': return await handleEvaluate(apiKey, data, user, env, corsHeaders);
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

// ===== 飞书 Token 获取 =====
async function getFeishuTokenForAI(env) {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('Feishu auth failed');
  return data.tenant_access_token;
}

// ===== AI 需求评估 =====
async function searchWebPrices(productName, tavilyApiKey) {
  if (!tavilyApiKey) return null;
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query: productName + ' 价格 京东 淘宝 拼多多',
        search_depth: 'basic',
        max_results: 5,
        include_answer: true,
      }),
    });
    const data = await res.json();
    if (data.answer) return data.answer;
    if (data.results && data.results.length > 0) {
      return data.results.map(r => r.title + ': ' + (r.content || '').slice(0, 150)).join('\n');
    }
    return null;
  } catch { return null; }
}

async function handleEvaluate(apiKey, data, user, env, corsHeaders) {
  const json = (d, s = 200) => jsonResponse(d, s, corsHeaders);
  const { productName, expectedPrice, platform, category } = data;
  if (!productName) return json({ ok: false, error: '请输入商品名称' }, 400, corsHeaders);

  // 1. 获取用户的采购历史
  let purchaseHistory = [];
  try {
    const bitable = user.bitable;
    if (bitable && bitable.purchaseApp && bitable.purchaseTable) {
      const feishuToken = await getFeishuTokenForAI(env);
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${bitable.purchaseApp}/tables/${bitable.purchaseTable}/records?page_size=200`;
      const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + feishuToken } });
      const result = await res.json();
      if (result.data && result.data.items) {
        purchaseHistory = result.data.items.map(r => ({
          '商品名称': r.fields['商品名称'] || '',
          '平台': r.fields['平台'] || '',
          '分类': r.fields['分类'] || '',
          '单价': Number(r.fields['单价'] || 0),
          '数量': Number(r.fields['数量'] || 1),
          '状态': r.fields['状态'] || '',
          '日期': r.fields['日期'] || '',
          '备注': r.fields['备注'] || '',
        }));
      }
    }
  } catch (e) {
    // 获取历史失败不影响评估，只是没有历史参考
  }

  // 2. 搜索同类商品
  const similarItems = purchaseHistory.filter(item => {
    const name = (item['商品名称'] || '').toLowerCase();
    const search = productName.toLowerCase();
    return name.includes(search) || search.includes(name);
  });

  // 3. 计算本月采购总额
  const thisMonth = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
  const monthlyTotal = purchaseHistory
    .filter(item => {
      if (!item['日期']) return false;
      try {
        const ts = typeof item['日期'] === 'number' ? item['日期'] : Date.parse(item['日期']);
        return new Date(ts + 8 * 3600000).toISOString().slice(0, 7) === thisMonth;
      } catch { return false; }
    })
    .reduce((sum, item) => sum + (item['单价'] || 0) * (item['数量'] || 1), 0);

  // 4. 获取预算
  let budget = 0;
  try {
    const budgetData = await env.IMAGE_STORE.get(`budget:${user.username}:${thisMonth}`);
    if (budgetData) budget = Number(budgetData);
  } catch {}

  // 5. 构建历史数据摘要
  const historyLines = similarItems.length > 0
    ? similarItems.map(i => `${i['日期'] ? (typeof i['日期'] === 'number' ? new Date(i['日期'] + 8*3600000).toISOString().slice(0,10) : String(i['日期']).slice(0,10)) : '未知'} | ${i['商品名称']} | ¥${i['单价']}×${i['数量']} | ${i['平台']} | ${i['状态']}`).join('\n')
    : '无同类商品购买记录';

  const recentItems = purchaseHistory.slice(-20).map(i =>
    `${i['商品名称']} | ¥${i['单价']} | ${i['平台']} | ${i['分类']}`
  ).join('\n');

  // 6. 全网比价（Tavily 搜索）
  const webPrices = await searchWebPrices(productName, env.TAVILY_API_KEY);

  const systemPrompt = `你是个人采购顾问 AI。用户想买一个商品，你需要给出评估报告帮助判断是否需要购买。

用户想买: ${productName}
${expectedPrice ? '预期价格: ¥' + expectedPrice : ''}
${platform ? '目标平台: ' + platform : ''}
${category ? '分类: ' + category : ''}

=== 同类商品历史购买记录 ===
${historyLines}

=== 近期采购记录（最近20条）===
${recentItems || '暂无'}

=== 本月采购概况 ===
本月已采购总额: ¥${monthlyTotal.toFixed(2)}
${budget > 0 ? '本月采购预算: ¥' + budget + '\n预算剩余: ¥' + (budget - monthlyTotal).toFixed(2) : '未设置采购预算'}
${webPrices ? '\n=== 全网比价结果 ===\n' + webPrices : ''}

请输出评估报告，格式要求:
1. 用 emoji + 标题分段
2. 每段简洁直接，引用具体数据
3. 最后给出明确建议（买/不买/等一等/换个平台）
4. 如果有历史价格，对比分析价格趋势
5. 如果本月预算紧张，提醒预算情况
6. 如果最近买过类似商品，提醒是否重复
7. 如果有全网比价结果，分析哪里买最便宜，给出具体平台和价格
8. 语气轻松直接，像朋友给建议
9. 不要用markdown标题符号(#)，用emoji做段落标记
10. 总长度控制在400字以内`;

  const result = await callAI(apiKey, systemPrompt, `我想买${productName}${expectedPrice ? '，预算大概' + expectedPrice + '元' : ''}`, 800);
  return json({ ok: true, data: result, similarCount: similarItems.length, monthlyTotal, budget }, 200, corsHeaders);
}

// ===== 自然语言记账 =====
async function handleParse(apiKey, data, corsHeaders) {
  const json = (d, s = 200) => jsonResponse(d, s, corsHeaders);
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
  const json = (d, s = 200) => jsonResponse(d, s, corsHeaders);
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
  const json = (d, s = 200) => jsonResponse(d, s, corsHeaders);
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
  const json = (d, s = 200) => jsonResponse(d, s, corsHeaders);
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
  const json = (d, s = 200) => jsonResponse(d, s, corsHeaders);
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
