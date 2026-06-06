const fs = require('fs');
let code = fs.readFileSync('D:\\OpenClawWorkspace\\purchase-app\\js\\ai.js', 'utf8');

// 1. Add chat history for multi-turn conversation
const insertAfter = "const AI_API='/api/ai';";
const chatHistoryInit = `
let statsChatHistory = []; // Multi-turn chat history for stats AI
`;

code = code.replace(insertAfter, insertAfter + chatHistoryInit);
console.log('1. Added chat history variable');

// 2. Replace queryAI to support multi-turn
const oldQueryFn = `async function queryAI(){
const input=document.getElementById("statsAIInput");
if(!input)return;
const q=input.value.trim();
if(!q)return;
const resultEl=document.getElementById("statsAIResult");
resultEl.innerHTML=\`<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>\u5206\u6790\u4e2d...</span></div>\`;
try{
const allExpenses=expenses||[];
const res=await aiRequest('query',{question:q,expenses:allExpenses});
if(res.ok){resultEl.innerHTML=\`<div class="ai-analysis-content">\${esc(res.data)}</div>\`}
else{resultEl.innerHTML=\`<div style="color:var(--red);font-size:12px">\u5206\u6790\u5931\u8d25</div>\`}
}catch(e){resultEl.innerHTML=\`<div style="color:var(--red);font-size:12px">\${e.message}</div>\`}
}`;

const newQueryFn = `async function queryAI(){
const input=document.getElementById("statsAIInput");
if(!input)return;
const q=input.value.trim();
if(!q)return;
input.value='';
const chatEl=document.getElementById("statsChatArea");
if(!chatEl)return;

// Add user message bubble
chatEl.innerHTML += '<div class="chat-bubble user-bubble">' + esc(q) + '</div>';
chatEl.scrollTop = chatEl.scrollHeight;

// Add loading
chatEl.innerHTML += '<div class="chat-bubble ai-bubble" id="chatLoading"><div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>';
chatEl.scrollTop = chatEl.scrollHeight;

try{
const allExpenses=expenses||[];
const res=await aiRequest('query',{question:q,expenses:allExpenses,messages:statsChatHistory});
const loadingEl=document.getElementById("chatLoading");
if(loadingEl)loadingEl.remove();

const answer = res.ok ? res.data : '\u5206\u6790\u5931\u8d25';
statsChatHistory.push({role:'user',content:q});
statsChatHistory.push({role:'assistant',content:answer});
if(statsChatHistory.length > 40) statsChatHistory = statsChatHistory.slice(-40);

chatEl.innerHTML += '<div class="chat-bubble ai-bubble">' + esc(answer) + '</div>';
chatEl.scrollTop = chatEl.scrollHeight;
}catch(e){
const loadingEl=document.getElementById("chatLoading");
if(loadingEl)loadingEl.remove();
chatEl.innerHTML += '<div class="chat-bubble ai-bubble" style="color:var(--red)">' + esc(e.message) + '</div>';
}
}`;

code = code.replace(oldQueryFn, newQueryFn);
console.log('2. Updated queryAI for multi-turn');

// 3. Update runAIAnalysis to handle structured JSON
const oldAnalyzeFn = `async function runAIAnalysis(){
const resultEl=document.getElementById("statsAIResult");
resultEl.innerHTML=\`<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>\u5206\u6790\u4e2d...</span></div>\`;
try{
const thisMonth=getThisMonth();
const allExpenses=expenses||[];
const allItems=items||[];
if(!allExpenses.length&&!allItems.length){
resultEl.innerHTML='<div style="color:var(--muted);font-size:13px;text-align:center;padding:20px">\ud83d\udca1 \u6682\u65e0\u6570\u636e\uff0c\u8bf7\u5148\u6dfb\u52a0\u8bb0\u8d26\u6216\u91c7\u8d2d\u8bb0\u5f55</div>';
return;
}
const res=await aiRequest('analyze',{expenses:allExpenses,items:allItems,month:thisMonth});
if(res.ok){resultEl.innerHTML='<div class="ai-analysis-content">'+esc(res.data)+'</div>'}
else{resultEl.innerHTML='<div style="color:var(--red);font-size:12px">\u5206\u6790\u5931\u8d25</div>'}
}catch(e){resultEl.innerHTML='<div style="color:var(--red);font-size:12px">'+e.message+'</div>'}
}`;

const newAnalyzeFn = `async function runAIAnalysis(){
const chatEl=document.getElementById("statsChatArea");
if(!chatEl)return;

chatEl.innerHTML += '<div class="chat-bubble ai-bubble">\ud83d\udcca \u6b63\u5728\u5206\u6790\u8d22\u52a1\u6570\u636e...</div>';
chatEl.scrollTop = chatEl.scrollHeight;

try{
const thisMonth=getThisMonth();
const allExpenses=expenses||[];
const allItems=items||[];
if(!allExpenses.length&&!allItems.length){
chatEl.innerHTML += '<div class="chat-bubble ai-bubble">\ud83d\udca1 \u6682\u65e0\u6570\u636e</div>';
return;
}
const res=await aiRequest('analyze',{expenses:allExpenses,items:allItems,month:thisMonth});

if(res.ok && res.structured && typeof res.data === 'object') {
  const d = res.data;
  let html = '<div class="ai-structured">';
  if(d.summary) html += '<div class="ai-summary-card">' + esc(d.summary) + '</div>';
  if(d.highlights && d.highlights.length) {
    html += '<div class="ai-highlights">';
    d.highlights.forEach(h => { html += '<span class="ai-highlight-tag">' + esc(h) + '</span>'; });
    html += '</div>';
  }
  if(d.categories && d.categories.length) {
    html += '<div class="ai-bar-chart">';
    const maxAmt = Math.max(...d.categories.map(c => c.amount));
    d.categories.forEach(c => {
      const pct = maxAmt > 0 ? (c.amount / maxAmt * 100) : 0;
      const trendIcon = c.trend === 'up' ? '\u2191' : c.trend === 'down' ? '\u2193' : '';
      const trendColor = c.trend === 'up' ? '#ef4444' : c.trend === 'down' ? '#16a34a' : 'var(--muted)';
      html += '<div class="ai-bar-row"><span class="ai-bar-label">' + esc(c.name) + '</span>';
      html += '<div class="ai-bar-track"><div class="ai-bar-fill" style="width:' + pct + '%"></div></div>';
      html += '<span class="ai-bar-value">\u00a5' + c.amount + ' <span style="color:' + trendColor + ';font-size:11px">' + trendIcon + '</span></span></div>';
    });
    html += '</div>';
  }
  if(d.suggestions && d.suggestions.length) {
    html += '<div class="ai-suggestions">';
    d.suggestions.forEach(s => { html += '<div class="ai-suggestion-card">\ud83d\udca1 ' + esc(s) + '</div>'; });
    html += '</div>';
  }
  html += '</div>';
  chatEl.innerHTML += '<div class="chat-bubble ai-bubble">' + html + '</div>';
} else {
  chatEl.innerHTML += '<div class="chat-bubble ai-bubble">' + esc(res.data || '\u5206\u6790\u5931\u8d25') + '</div>';
}
chatEl.scrollTop = chatEl.scrollHeight;
}catch(e){chatEl.innerHTML += '<div class="chat-bubble ai-bubble" style="color:var(--red)">' + esc(e.message) + '</div>'}
}`;

code = code.replace(oldAnalyzeFn, newAnalyzeFn);
console.log('3. Updated runAIAnalysis for structured rendering');

// 4. Add generateTodoSuggestions function
const insertBeforeNs = '// === App.ai namespace exports ===';
const genTodoFn = `
// ===== AI \u5f85\u529e\u5efa\u8bae =====
async function generateTodoSuggestions() {
  const resultEl = document.getElementById('statsChatArea');
  if (!resultEl) return;

  resultEl.innerHTML += '<div class="chat-bubble ai-bubble">\ud83e\udd16 \u6b63\u5728\u751f\u6210\u5f85\u529e\u5efa\u8bae...</div>';
  resultEl.scrollTop = resultEl.scrollHeight;

  try {
    const res = await aiRequest('generate-todo', { items: items||[], expenses: expenses||[], month: getThisMonth() });
    if (!res.ok || !res.data?.todos) {
      resultEl.innerHTML += '<div class="chat-bubble ai-bubble">\u751f\u6210\u5931\u8d25: ' + (res.error||'\u672a\u77e5\u9519\u8bef') + '</div>';
      return;
    }

    const todos = res.data.todos;
    if (!todos.length) {
      resultEl.innerHTML += '<div class="chat-bubble ai-bubble">\u6ca1\u6709\u65b0\u7684\u5f85\u529e\u5efa\u8bae \u2728</div>';
      return;
    }

    let html = '<div class="ai-todo-suggestions">';
    html += '<div style="font-weight:700;margin-bottom:10px">\ud83e\udd16 AI\u5f85\u529e\u5efa\u8bae (' + todos.length + '\u6761)</div>';
    todos.forEach(function(t, i) {
      html += '<div class="ai-todo-card" id="aiTodo' + i + '">';
      html += '<div style="font-weight:600">' + esc(t.title) + '</div>';
      html += '<div style="font-size:12px;color:var(--muted);margin-top:4px">';
      if(t.dueDate) html += '\ud83d\udcc5 ' + t.dueDate + ' ';
      html += '\u26a1 ' + (t.priority||'\u4e2d') + ' \ud83d\udccc ' + (t.category||'\u5176\u4ed6');
      if(t.repeat && t.repeat !== '\u65e0') html += ' \ud83d\udd04' + t.repeat;
      html += '</div>';
      html += '<div style="margin-top:8px;display:flex;gap:6px">';
      html += '<button onclick="addSuggestedTodo(' + i + ')" style="padding:4px 12px;background:var(--pri);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">\u2705 \u6dfb\u52a0</button>';
      html += '<button onclick="dismissSuggestedTodo(' + i + ')" style="padding:4px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:12px;cursor:pointer">\u274c \u5ffd\u7565</button>';
      html += '</div></div>';
    });
    html += '<button onclick="addAllSuggestedTodos()" style="margin-top:8px;padding:8px 16px;background:var(--pri);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;width:100%">\u2705 \u5168\u90e8\u6dfb\u52a0</button>';
    html += '</div>';
    resultEl.innerHTML += '<div class="chat-bubble ai-bubble">' + html + '</div>';
    resultEl.scrollTop = resultEl.scrollHeight;

    // Store suggestions globally
    window._todoSuggestions = todos;
  } catch(e) {
    resultEl.innerHTML += '<div class="chat-bubble ai-bubble" style="color:var(--red)">' + esc(e.message) + '</div>';
  }
}

async function addSuggestedTodo(idx) {
  const t = window._todoSuggestions && window._todoSuggestions[idx];
  if (!t) return;
  try {
    await todoApi('POST', {
      title: t.title,
      dueDate: t.dueDate || null,
      priority: t.priority || '\u4e2d',
      category: t.category || '\u5176\u4ed6',
      repeat: t.repeat || '\u65e0',
      linkType: '\u65e0',
      linkId: '',
      subtasks: '[]'
    });
    const card = document.getElementById('aiTodo' + idx);
    if (card) { card.style.opacity = '0.4'; card.style.pointerEvents = 'none'; }
    toast('\u5df2\u6dfb\u52a0: ' + t.title);
    await loadTodos();
  } catch(e) { toast('\u6dfb\u52a0\u5931\u8d25: ' + e.message); }
}

function dismissSuggestedTodo(idx) {
  const card = document.getElementById('aiTodo' + idx);
  if (card) card.style.display = 'none';
}

async function addAllSuggestedTodos() {
  const todos = window._todoSuggestions || [];
  let count = 0;
  for (let i = 0; i < todos.length; i++) {
    const card = document.getElementById('aiTodo' + i);
    if (card && card.style.display !== 'none' && card.style.opacity !== '0.4') {
      await addSuggestedTodo(i);
      count++;
    }
  }
  toast('\u5df2\u6279\u91cf\u6dfb\u52a0 ' + count + '\u6761\u5f85\u529e');
}

function clearChatHistory() {
  statsChatHistory = [];
  const chatEl = document.getElementById('statsChatArea');
  if (chatEl) chatEl.innerHTML = '';
}

`;

code = code.replace(insertBeforeNs, genTodoFn + insertBeforeNs);
console.log('4. Added generateTodoSuggestions');

// 5. Add to namespace
const oldNsEnd = "App.ai.applyAICat = applyAICat;";
const newNsEnd = "App.ai.applyAICat = applyAICat;\nApp.ai.generateTodoSuggestions = generateTodoSuggestions;\nApp.ai.clearChatHistory = clearChatHistory;\nwindow.generateTodoSuggestions = generateTodoSuggestions;\nwindow.clearChatHistory = clearChatHistory;";
code = code.replace(oldNsEnd, newNsEnd);
console.log('5. Added namespace exports');

fs.writeFileSync('D:\\OpenClawWorkspace\\purchase-app\\js\\ai.js', code, 'utf8');
console.log('ai.js frontend updated!');
