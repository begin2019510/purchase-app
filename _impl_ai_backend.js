const fs = require('fs');
let code = fs.readFileSync('D:\\OpenClawWorkspace\\purchase-app\\functions\\api\\ai.js', 'utf8');

// 1. Add generate-todo to the switch statement
code = code.replace(
  "case 'budget-analyze': return await handleBudgetAnalyze(apiKey, data, corsHeaders);",
  "case 'budget-analyze': return await handleBudgetAnalyze(apiKey, data, corsHeaders);\n      case 'generate-todo': return await handleGenerateTodo(apiKey, data, corsHeaders);"
);
console.log('1. Added generate-todo action');

// 2. Modify handleQuery to support multi-turn conversation
const oldQuery = `async function handleQuery(apiKey, data, corsHeaders) {
  const json = (d, s = 200) => jsonResponse(d, s, corsHeaders);
  const { question, expenses } = data;
  if (!expenses || !expenses.length) return json({ ok: true, data: '\u6682\u65e0\u8bb0\u8d26\u6570\u636e' }, 200, corsHeaders);

  const lines = expenses.map(e => {
    const date = e['\u65e5\u671f']?.slice(0, 10) || '?';
    return \`\${date} | \${e['\u7c7b\u578b']||'\u652f\u51fa'} | \${e['\u5206\u7c7b']||'\u5176\u4ed6'} | \u00a5\${e['\u91d1\u989d']||0} | \${e['\u5907\u6ce8']||''}\`;
  }).join('\\n');

  const totalOut = expenses.filter(e => e['\u7c7b\u578b'] === '\u652f\u51fa').reduce((s, e) => s + Number(e['\u91d1\u989d'] || 0), 0);
  const totalIn = expenses.filter(e => e['\u7c7b\u578b'] === '\u6536\u5165').reduce((s, e) => s + Number(e['\u91d1\u989d'] || 0), 0);

  const systemPrompt = \`\u4f60\u662f\u4e2a\u4eba\u8d22\u52a1\u52a9\u624b\u3002\u7528\u6237\u4f1a\u95ee\u5173\u4e8e\u6d88\u8d39\u6570\u636e\u7684\u95ee\u9898\uff0c\u4f60\u4ece\u6570\u636e\u4e2d\u76f4\u63a5\u56de\u7b54\u3002

\u672c\u6708\u6570\u636e:
\${lines}

\u603b\u652f\u51fa: \u00a5\${totalOut.toFixed(2)} | \u603b\u6536\u5165: \u00a5\${totalIn.toFixed(2)} | \u5171\${expenses.length}\u7b14

\u89c4\u5219:
- \u56de\u7b54\u8981\u57fa\u4e8e\u6570\u636e\uff0c\u7ed9\u51fa\u5177\u4f53\u6570\u5b57
- \u7b80\u6d01\u76f4\u63a5\uff0c1-3\u53e5\u8bdd
- \u5982\u679c\u6570\u636e\u4e0d\u591f\u5c31\u8bf4"\u6570\u636e\u4e0d\u8db3\uff0c\u65e0\u6cd5\u5224\u65ad"
- \u7528emoji\u8ba9\u56de\u7b54\u66f4\u751f\u52a8\`;

  const result = await callAI(apiKey, systemPrompt, question, 400);
  return json({ ok: true, data: result }, 200, corsHeaders);
}`;

const newQuery = `async function handleQuery(apiKey, data, corsHeaders) {
  const json = (d, s = 200) => jsonResponse(d, s, corsHeaders);
  const { question, expenses, messages } = data;
  if (!expenses || !expenses.length) return json({ ok: true, data: '\u6682\u65e0\u8bb0\u8d26\u6570\u636e' }, 200, corsHeaders);

  const lines = expenses.map(e => {
    const date = e['\u65e5\u671f']?.slice(0, 10) || '?';
    return \`\${date} | \${e['\u7c7b\u578b']||'\u652f\u51fa'} | \${e['\u5206\u7c7b']||'\u5176\u4ed6'} | \u00a5\${e['\u91d1\u989d']||0} | \${e['\u5907\u6ce8']||''}\`;
  }).join('\\n');

  const totalOut = expenses.filter(e => e['\u7c7b\u578b'] === '\u652f\u51fa').reduce((s, e) => s + Number(e['\u91d1\u989d'] || 0), 0);
  const totalIn = expenses.filter(e => e['\u7c7b\u578b'] === '\u6536\u5165').reduce((s, e) => s + Number(e['\u91d1\u989d'] || 0), 0);

  const systemPrompt = \`\u4f60\u662f\u4e2a\u4eba\u8d22\u52a1\u52a9\u624b\u3002\u7528\u6237\u4f1a\u95ee\u5173\u4e8e\u6d88\u8d39\u6570\u636e\u7684\u95ee\u9898\uff0c\u4f60\u4ece\u6570\u636e\u4e2d\u76f4\u63a5\u56de\u7b54\u3002\u652f\u6301\u8ffd\u95ee\uff0c\u8bb0\u4f4f\u4e0a\u4e0b\u6587\u3002

\u672c\u6708\u6570\u636e:
\${lines}

\u603b\u652f\u51fa: \u00a5\${totalOut.toFixed(2)} | \u603b\u6536\u5165: \u00a5\${totalIn.toFixed(2)} | \u5171\${expenses.length}\u7b14

\u89c4\u5219:
- \u56de\u7b54\u8981\u57fa\u4e8e\u6570\u636e\uff0c\u7ed9\u51fa\u5177\u4f53\u6570\u5b57
- \u7b80\u6d01\u76f4\u63a5\uff0c1-3\u53e5\u8bdd
- \u5982\u679c\u6570\u636e\u4e0d\u591f\u5c31\u8bf4"\u6570\u636e\u4e0d\u8db3\uff0c\u65e0\u6cd5\u5224\u65ad"
- \u7528emoji\u8ba9\u56de\u7b54\u66f4\u751f\u52a8\`;

  // Build messages array for multi-turn
  const aiMessages = [{ role: 'system', content: systemPrompt }];
  if (messages && Array.isArray(messages)) {
    messages.slice(-20).forEach(m => aiMessages.push({ role: m.role, content: m.content }));
  }
  aiMessages.push({ role: 'user', content: question });

  const body = {
    model: 'mimo-v2.5',
    messages: aiMessages,
    max_completion_tokens: 400,
    temperature: 1.0,
    top_p: 0.95,
    stream: false,
  };
  const AI_API_BASE = 'https://api.xiaomimimo.com';
  const res = await fetch(\`\${AI_API_BASE}/v1/chat/completions\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(body),
  });
  const parsed = await res.json();
  const result = parsed.choices?.[0]?.message?.content || '\u65e0\u56de\u590d';
  return json({ ok: true, data: result }, 200, corsHeaders);
}`;

code = code.replace(oldQuery, newQuery);
console.log('2. Updated handleQuery for multi-turn');

// 3. Modify handleAnalyze to return structured JSON
const oldAnalyze = `  const systemPrompt = \`\u4f60\u662f\u4e2a\u4eba\u8d22\u52a1\u5206\u6790\u5e08\u3002

\u8bb0\u8d26\u6570\u636e:
\${expenseSummary || '\u6682\u65e0'}

\u91c7\u8d2d\u6570\u636e:
\${itemSummary || '\u6682\u65e0'}

\u8f93\u51fa3-5\u6761\u5206\u6790\uff0c\u6bcf\u6761\u683c\u5f0f:
emoji \u6807\u9898
\u5177\u4f53\u63cf\u8ff0\uff08\u5f15\u7528\u6570\u636e\uff09

\u91cd\u70b9: \u6d88\u8d39\u5f02\u5e38\u3001\u7701\u94b1\u673a\u4f1a\u3001\u6a21\u5f0f\u53d1\u73b0\u3002\u8bed\u6c14\u8f7b\u677e\u76f4\u63a5\u3002\`;

  const result = await callAI(apiKey, systemPrompt, '\u5206\u6790\u6d88\u8d39\u60c5\u51b5', 600);
  return json({ ok: true, data: result }, 200, corsHeaders);`;

const newAnalyze = `  const systemPrompt = \`\u4f60\u662f\u4e2a\u4eba\u8d22\u52a1\u5206\u6790\u5e08\u3002\u8bf7\u5206\u6790\u6d88\u8d39\u6570\u636e\u5e76\u8fd4\u56deJSON\u3002

\u8bb0\u8d26\u6570\u636e:
\${expenseSummary || '\u6682\u65e0'}

\u91c7\u8d2d\u6570\u636e:
\${itemSummary || '\u6682\u65e0'}

\u8fd4\u56de\u4e25\u683cJSON\u683c\u5f0f\uff08\u4e0d\u8981\u52a0markdown\u4ee3\u7801\u5757\uff09:
{
  "summary": "\u4e00\u53e5\u8bdd\u603b\u7ed3",
  "highlights": ["\u4eae\u70b91", "\u4eae\u70b92"],
  "categories": [{"name":"\u5206\u7c7b\u540d","amount":100,"pct":50,"trend":"up/down/same"}],
  "suggestions": ["\u5efa\u8bae1", "\u5efa\u8bae2"]
}
\u5982\u679c\u6570\u636e\u4e3a\u7a7a\uff0c\u8fd4\u56de {"summary":"\u6682\u65e0\u6570\u636e","highlights":[],"categories":[],"suggestions":[]}\`;

  const result = await callAI(apiKey, systemPrompt, '\u5206\u6790\u6d88\u8d39\u60c5\u51b5', 800);
  // Try to parse as JSON, fallback to plain text
  let parsed;
  try { parsed = JSON.parse(result); } catch(e) { parsed = null; }
  if (parsed && parsed.summary) {
    return json({ ok: true, data: parsed, structured: true }, 200, corsHeaders);
  }
  return json({ ok: true, data: result, structured: false }, 200, corsHeaders);`;

code = code.replace(oldAnalyze, newAnalyze);
console.log('3. Updated handleAnalyze for structured output');

// 4. Add handleGenerateTodo function at the end
const generateTodoFn = `

// ===== AI 待办建议 =====
async function handleGenerateTodo(apiKey, data, corsHeaders) {
  const json = (d, s = 200) => jsonResponse(d, s, corsHeaders);
  const { items, expenses, month } = data;

  const expenseSummary = (expenses || []).slice(-50).map(e =>
    \`\${e['\u65e5\u671f']?.slice(0,10) || '?'} | \${e['\u5206\u7c7b']} | \u00a5\${e['\u91d1\u989d']} | \${e['\u5907\u6ce8'] || ''}\`
  ).join('\\n');

  const itemSummary = (items || []).map(i =>
    \`\${i['\u5546\u54c1\u540d\u79f0']} | \u00a5\${i['\u5355\u4ef7']} | \${i['\u72b6\u6001']} | \u5206\u671f:\${i['\u5206\u671f\u671f\u6570']||0}\`
  ).join('\\n');

  const today = new Date(Date.now() + 8*3600000).toISOString().slice(0,10);

  const systemPrompt = \`\u4f60\u662f\u4e2a\u4eba\u5f85\u529e\u52a9\u624b\u3002\u6839\u636e\u7528\u6237\u7684\u6d88\u8d39\u548c\u91c7\u8d2d\u6570\u636e\uff0c\u751f\u6210\u667a\u80fd\u5f85\u529e\u5efa\u8bae\u3002

\u4eca\u5929: \${today}

\u8bb0\u8d26\u6570\u636e:
\${expenseSummary || '\u6682\u65e0'}

\u91c7\u8d2d\u6570\u636e:
\${itemSummary || '\u6682\u65e0'}

\u8fd4\u56deJSON\uff08\u4e0d\u8981markdown\u4ee3\u7801\u5757\uff09:
{"todos":[{"title":"\u5f85\u529e\u6807\u9898","dueDate":"YYYY-MM-DD\u6216null","priority":"\u9ad8/\u4e2d/\u4f4e","category":"\u751f\u6d3b/\u5de5\u4f5c/\u91c7\u8d2d/\u5176\u4ed6","repeat":"\u65e0/\u6bcf\u5929/\u6bcf\u5468/\u6bcf\u6708"}]}

\u89c4\u5219:
- \u53ea\u751f\u6210\u6709\u4ef7\u503c\u7684\u5f85\u529e\uff0c\u4e0d\u8981\u5145\u6570\u91cf
- \u5e38\u89c1\u573a\u666f\uff1a\u7eed\u8d39\u63d0\u9192\u3001\u8fd8\u6b3e\u63d0\u9192\u3001\u6d88\u8d39\u63a7\u5236\u5efa\u8bae\u3001\u5468\u671f\u6027\u4efb\u52a1
- \u57fa\u4e8e\u6570\u636e\u4e2d\u7684\u6a21\u5f0f\uff08\u5982\u6bcf\u6708\u8bdd\u8d39\u3001\u5206\u671f\u8fd8\u6b3e\uff09\`;

  const result = await callAI(apiKey, systemPrompt, '\u751f\u6210\u5f85\u529e\u5efa\u8bae', 600);
  let parsed;
  try { parsed = JSON.parse(result); } catch(e) { parsed = null; }
  if (parsed && parsed.todos) {
    return json({ ok: true, data: parsed }, 200, corsHeaders);
  }
  return json({ ok: false, error: 'AI\u8fd4\u56de\u683c\u5f0f\u9519\u8bef', raw: result }, 200, corsHeaders);
}
`;

code = code + generateTodoFn;
console.log('4. Added handleGenerateTodo');

fs.writeFileSync('D:\\OpenClawWorkspace\\purchase-app\\functions\\api\\ai.js', code, 'utf8');
console.log('ai.js backend updated!');
