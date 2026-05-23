const AI_API='/api/ai';
async function aiRequest(action,data){
  const r=await fetch(AI_API,{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':getPin()},body:JSON.stringify({action,data})});
  const res=await r.json().catch(()=>({error:'Response not JSON'}));
  if(!r.ok||res.error)throw new Error(res.error||res.hint||'AI request failed: '+r.status);
  return res;
}

// --- 自然语言记账 ---
let pendingAI=null;
async function sendAI(){
  const input=document.getElementById('aiInput');
  const text=input.value.trim();
  if(!text)return;
  const btn=document.getElementById('aiSendBtn');
  const resultEl=document.getElementById('aiResult');
  btn.disabled=true;
  btn.textContent='⏳';
  resultEl.innerHTML=`<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>解析中...</span></div>`;
  try{
    const now=new Date(Date.now()+8*3600*1000);
    const currentDate=now.toISOString().slice(0,10);
    const res=await aiRequest('parse',{text,currentDate});
    if(res.ok&&res.data&&res.data.amount>0){
      pendingAI=res.data;
      const d=res.data;
      resultEl.innerHTML=`<div class="ai-result">
        <div class="ai-result-header"><span class="ai-result-tag">🤖 AI 解析</span><span style="font-size:10px;color:var(--muted)">置信度 ${((d.confidence||0)*100).toFixed(0)}%</span></div>
        <div style="font-size:13px;margin-bottom:6px"><b>${d.type}</b> ¥${d.amount.toFixed(2)} · ${d.category}${d.note?' · '+d.note:''}</div>
        <div style="display:flex;gap:6px">
          <button class="ai-confirm-btn primary" onclick="confirmAI()">✓ 记一笔</button>
          <button class="ai-confirm-btn secondary" onclick="editAI()">✏️ 修改</button>
          <button class="ai-confirm-btn secondary" onclick="cancelAI()">✕ 取消</button>
        </div>
      </div>`;
    }else{
      resultEl.innerHTML=`<div class="ai-result"><div class="ai-result-header"><span class="ai-result-tag">🤔 没听清</span></div><div style="font-size:12px;color:var(--muted)">没识别到金额，试试: 午饭35、打车28去公司</div></div>`;
    }
  }catch(e){
    resultEl.innerHTML=`<div class="ai-result"><div style="color:var(--red);font-size:12px">⚠️ ${e.message||'未知错误'}</div></div>`;
  }
  btn.disabled=false;
  btn.textContent='✨';
  input.value='';
}

function confirmAI(){
  if(!pendingAI)return;
  const d=pendingAI;
  const now=new Date(Date.now()+8*3600*1000);
  const pad=n=>String(n).padStart(2,'0');
  const dateStr=d.date||(now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())+'T'+pad(now.getHours())+':'+pad(now.getMinutes()));
  openExpenseModal();
  document.getElementById('eType').value=d.type||'支出';
  document.getElementById('eAmount').value=d.amount||'';
  document.getElementById('eCategory').value=d.category||'其他';
  document.getElementById('eDate').value=dateStr;
  document.getElementById('eNote').value=d.note||'';
  document.getElementById('aiResult').innerHTML='';
  pendingAI=null;
}
function editAI(){
  if(!pendingAI)return;
  document.getElementById('aiInput').value=`${pendingAI.type} ${pendingAI.amount} ${pendingAI.category} ${pendingAI.note||''}`;
  document.getElementById('aiResult').innerHTML='';
  pendingAI=null;
}
function cancelAI(){
  document.getElementById('aiResult').innerHTML='';
  pendingAI=null;
}

// --- AI 分析 ---
// --- AI 自然语言查询 ---
async function queryAI(){
  const input=document.getElementById('statsAIInput');
  const q=input.value.trim();
  if(!q)return;
  const resultEl=document.getElementById('statsAIResult');
  resultEl.innerHTML=`<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
  input.value='';
  try{
    const thisMonth=getThisMonth();
    const monthExpenses=expenses.filter(e=>{if(!e['日期'])return false;try{return getMonth(e['日期'])===thisMonth}catch{return false}});
    const res=await aiRequest('query',{question:q,expenses:monthExpenses});
    if(res.ok){resultEl.innerHTML=`<div class="ai-result"><div class="ai-result-header"><span class="ai-result-tag">🤖 回答</span></div><div>${esc(res.data)}</div></div>`}
    else{resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">分析失败</div>`}
  }catch(e){resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">${e.message}</div>`}
}

// --- 财务分析 ---
async function runAIAnalysis(){
  const resultEl=document.getElementById('statsAIResult');
  resultEl.innerHTML=`<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>分析中...</span></div>`;
  try{
    const thisMonth=getThisMonth();
    const monthExpenses=expenses.filter(e=>{if(!e['日期'])return false;try{return getMonth(e['日期'])===thisMonth}catch{return false}});
    const monthItems=items.filter(i=>getMonth(i['日期'])===thisMonth);
    const res=await aiRequest('analyze',{expenses:monthExpenses,items:monthItems,month:thisMonth});
    if(res.ok){resultEl.innerHTML=`<div class="ai-analysis-content">${esc(res.data)}</div>`}
    else{resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">分析失败</div>`}
  }catch(e){resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">${e.message}</div>`}
}

// --- 消费画像 ---
async function runAIProfile(){
  const resultEl=document.getElementById('statsAIResult');
  resultEl.innerHTML=`<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>深度分析中...</span></div>`;
  try{
    const thisMonth=getThisMonth();
    const monthExpenses=expenses.filter(e=>{if(!e['日期'])return false;try{return getMonth(e['日期'])===thisMonth}catch{return false}});
    const res=await aiRequest('profile',{expenses:monthExpenses});
    if(res.ok&&res.data){
      const d=res.data;
      let html='';
      // 总结
      if(d.summary) html+=`<div style="margin-bottom:12px;padding:10px;background:var(--pri-light);border-radius:10px;font-size:13px;line-height:1.7">${esc(d.summary)}</div>`;
      // 画像
      if(d.profile){
        const p=d.profile;
        html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">`;
        if(p.diningStyle) html+=`<div style="background:var(--bg);padding:8px 10px;border-radius:8px;font-size:11px"><div style="font-weight:700;margin-bottom:2px">🍜 饮食风格</div>${esc(p.diningStyle)}</div>`;
        if(p.lifestyle) html+=`<div style="background:var(--bg);padding:8px 10px;border-radius:8px;font-size:11px"><div style="font-weight:700;margin-bottom:2px">🎭 生活方式</div>${esc(p.lifestyle)}</div>`;
        if(p.spendingPattern) html+=`<div style="background:var(--bg);padding:8px 10px;border-radius:8px;font-size:11px"><div style="font-weight:700;margin-bottom:2px">💡 消费模式</div>${esc(p.spendingPattern)}</div>`;
        if(p.topItems&&p.topItems.length) html+=`<div style="background:var(--bg);padding:8px 10px;border-radius:8px;font-size:11px"><div style="font-weight:700;margin-bottom:2px">🏆 主要开销</div>${p.topItems.map(i=>esc(i)).join('、')}</div>`;
        html+=`</div>`;
      }
      // 习惯
      if(d.habits&&d.habits.length){
        html+=`<div style="font-size:12px;font-weight:700;margin-bottom:6px">📊 消费习惯</div>`;
        d.habits.forEach(h=>{html+=`<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;line-height:1.6"><b>${h.emoji||'📌'} ${esc(h.title)}</b><br>${esc(h.detail)}</div>`});
      }
      // 洞察
      if(d.insights&&d.insights.length){
        html+=`<div style="font-size:12px;font-weight:700;margin:10px 0 6px">💡 深度洞察</div>`;
        d.insights.forEach(i=>{html+=`<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;line-height:1.6"><b>${i.emoji||'💡'} ${esc(i.title)}</b><br>${esc(i.detail)}</div>`});
      }
      resultEl.innerHTML=`<div class="ai-result"><div class="ai-result-header"><span class="ai-result-tag">🧠 消费画像</span></div>${html}</div>`;
    }else{resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">生成失败</div>`}
  }catch(e){resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">${e.message}</div>`}
}
