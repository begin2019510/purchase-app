// ai.js - AI Assistant, Evaluation, Analysis
function parseEvalNote(note) {
  if (!note || !note.includes('===BUDGET===')) return null;
  try {
    const reasonMatch = note.match(/===REASON===([\s\S]*?)===BUDGET===/);
    const budgetMatch = note.match(/===BUDGET===([\s\S]*?)===AI_SUMMARY===/);
    const summaryMatch = note.match(/===AI_SUMMARY===([\s\S]*?)===CHAT===/);
    const chatMatch = note.match(/===CHAT===([\s\S]*)$/);
    return {
      reason: reasonMatch ? reasonMatch[1].trim() : '',
      budget: budgetMatch ? budgetMatch[1].trim() : '未设置',
      summary: summaryMatch ? summaryMatch[1].trim() : '',
      chat: chatMatch ? JSON.parse(chatMatch[1]) : []
    };
  } catch { return null; }
}

const AI_API='/api/ai';
async function aiRequest(action,data){
  const r=await fetch(AI_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({action,data})});
  const res=await r.json().catch(()=>({error:'Response not JSON'}));
  if(!r.ok||res.error)throw new Error(res.error||res.hint||'AI request failed: '+r.status);
  return res;
}

// --- 自然语言记账 ---
let pendingAI=null;
async function sendAI(){
  const input=document.getElementById("aiInput");
  const text=input.value.trim();
  if(!text)return;
  const btn=document.getElementById("aiSendBtn");
  const resultEl=document.getElementById("aiResult");
  btn.disabled=true;
  btn.textContent="⏳";
  resultEl.innerHTML='<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>解析中...</span></div>';
  try{
    const now=new Date(Date.now()+8*3600*1000);
    const currentDate=now.toISOString().slice(0,10);
    const res=await aiRequest("parse",{text,currentDate});
    if(res.ok&&res.data&&res.data.length>0){
      pendingAI=res.data;
      let html='<div class="ai-result"><div class="ai-result-header"><span class="ai-result-tag">🤖 AI 解析</span><span style="font-size:10px;color:var(--muted)">识别到 '+res.data.length+' 笔</span></div>';
      res.data.forEach(function(d){
        html+='<div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)"><b>'+d.type+'</b> ¥'+d.amount.toFixed(2)+' · '+(d.category||"其他")+(d.note?" · "+d.note:"")+'</div>';
      });
      html+='<div style="display:flex;gap:6px;margin-top:8px">';
      html+='<button class="ai-confirm-btn primary" onclick="confirmAI()">✓ 全部记账</button>';
      html+='<button class="ai-confirm-btn secondary" onclick="cancelAI()">✕ 取消</button>';
      html+='</div></div>';
      resultEl.innerHTML=html;
    }else{
      resultEl.innerHTML='<div class="ai-result"><div class="ai-result-header"><span class="ai-result-tag">🤔 没听清</span></div><div style="font-size:12px;color:var(--muted)">没识别到金额，试试: 午饭35、打车28去公司</div></div>';
    }
  }catch(e){
    resultEl.innerHTML='<div class="ai-result"><div style="color:var(--red);font-size:12px">⚠️ '+(e.message||"未知错误")+'</div></div>';
  }
  btn.disabled=false;
  btn.textContent="✨";
  input.value="";
}
async function confirmAI(){
  if(!pendingAI)return;
  const arr=Array.isArray(pendingAI)?pendingAI:[pendingAI];
  const now=new Date(Date.now()+8*3600*1000);
  const pad=function(n){return String(n).padStart(2,"0")};
  const defaultDate=now.getFullYear()+"-"+pad(now.getMonth()+1)+"-"+pad(now.getDate())+"T"+pad(now.getHours())+":"+pad(now.getMinutes());
  let ok=0;
  for(var i=0;i<arr.length;i++){
    var d=arr[i];
    if(!d.amount||d.amount<=0)continue;
    var dateStr=d.date||defaultDate;
    try{
      var r=await expenseApi("POST",{amount:d.amount,type:d.type||"支出",category:d.category||"其他",date:dateStr,note:d.note||""});
      if(r&&!r.error)ok++;
    }catch(e){console.error("confirmAI item error:",e)}
  }
  toast("已记账 "+ok+" 笔");
  pendingAI=null;
  document.getElementById("aiResult").innerHTML="";
  await loadAll();
}
function cancelAI(){
  document.getElementById("aiResult").innerHTML="";
  pendingAI=null;
}





// 跳过评估，直接进入需求填写
function skipToDetail() {
  const name = document.getElementById('fName').value.trim();
  if (!name) { alert('请先输入商品名称'); return; }
  document.getElementById('evalPhase').style.display = 'none';
  document.getElementById('chatArea').style.display = 'none';
  document.getElementById('detailPhase').style.display = '';
  document.getElementById('fNameDisplay').value = name;
  document.getElementById('fPrice').value = '';
  document.getElementById('fQty').value = '1';
  document.getElementById('fNote').value = '';
  document.getElementById('fPlatform').value = '拼多多';
  document.getElementById('fCategory').value = '日用';
  var dig=document.getElementById('detailInstallmentGroup');if(dig)dig.style.display='none';
  var dib=document.getElementById('detailInstBtn');if(dib){dib.style.background='var(--bg)';dib.style.color='var(--text)';}
  var dip=document.getElementById('installmentPreviewDetail');if(dip)dip.textContent='';
  var did=document.getElementById('fInstallmentsDetail');if(did)did.value='';
  document.getElementById('fBudgetDisplay').textContent='未设置';
}
function toggleDetailInstallment(){
  var group=document.getElementById('detailInstallmentGroup');
  var btn=document.getElementById('detailInstBtn');
  var showing=group.style.display==='none';
  group.style.display=showing?'':'none';
  btn.style.background=showing?'var(--pri)':'var(--bg)';
  btn.style.color=showing?'#fff':'var(--text)';
  if(showing)updateDetailInstallmentPreview();
}
function updateDetailInstallmentPreview(){
  var periods=parseInt(document.getElementById('fInstallmentsDetail').value)||0;
  var price=parseFloat(document.getElementById('fPrice').value)||0;
  var qty=parseInt(document.getElementById('fQty').value)||1;
  var total=price*qty;
  var preview=document.getElementById('installmentPreviewDetail');
  if(preview)preview.textContent=periods>0?'每期 \u00a5'+(total/periods).toFixed(2):'';
}
// --- AI 需求评估（嵌入采购创建流程） ---
async function runPurchaseEval() {
  const name = document.getElementById('fName').value.trim();
  if (!name) { alert('请先输入商品名称'); return; }
  const budgetMin = parseFloat(document.getElementById('fBudgetMin').value) || 0;
  const budgetMax = parseFloat(document.getElementById('fBudgetMax').value) || 0;
  
  const resultEl = document.getElementById('aiEvalResult');
  const btn = document.getElementById('aiEvalBtn');
  resultEl.style.display = 'block';
  resultEl.textContent = '🤖 AI 分析中...';
  btn.disabled = true;
  btn.textContent = '分析中...';
  
  // 获取购买理由
  const reason = (document.getElementById('fReason') ? document.getElementById('fReason').value : '').trim();
  
  try {
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin() },
      body: JSON.stringify({ action: 'evaluate', data: { productName: name, expectedPrice: null, platform: null, category: null, budgetMin, budgetMax, reason: reason || null } }),
    });
    const d = await r.json();
    if (!d.ok) { resultEl.textContent = '❌ ' + (d.error || '评估失败'); return; }
    
    // 提取摘要：第一段+建议行
    const lines = d.data.split('\n').filter(l => l.trim());
    const summary = lines.slice(0, 3).join(' ').replace(/[\*#]/g, '').slice(0, 150);
    resultEl.innerHTML = '<div style="margin-bottom:10px;line-height:1.6">' + stripMd(esc(summary)) + '</div>'
      + '<button class="ai-confirm-btn primary" onclick="submitEvaluation()">✔ 提交评估</button>'
      + '<button class="ai-confirm-btn secondary" onclick="cancelPurchaseEval()">✖ 取消</button>';
    purchaseEvalContext = d.data;
    purchaseChatHistory = [{role:'assistant', content:d.data}];
    document.getElementById('chatArea').style.display = 'block';
    renderChatMessages();
  } catch(e) { resultEl.textContent = '❌ 网络错误'; }
  finally { btn.disabled = false; btn.textContent = '🤖 AI需求评估'; }
}
function switchToDetailPhase(name, aiData) {
  document.getElementById('evalPhase').style.display = 'none';
  document.getElementById('chatArea').style.display = 'none';
  document.getElementById('detailPhase').style.display = '';
  document.getElementById('fNameDisplay').value = name;
  document.getElementById('fPrice').value = '';
  document.getElementById('fQty').value = '1';
  document.getElementById('fNote').value = '';
  document.getElementById('fPlatform').value = '拼多多';
  document.getElementById('fCategory').value = '日用';
}

let purchaseEvalContext = '';
let purchaseChatHistory = [];

function renderChatMessages() {
  const el = document.getElementById('chatMessages');
  el.innerHTML = purchaseChatHistory.map(m => {
    if (m.role === 'user') return '<div style="text-align:right;margin-bottom:6px"><span style="display:inline-block;background:var(--pri);color:#fff;padding:6px 10px;border-radius:10px 10px 2px 10px;max-width:85%">' + stripMd(esc(m.content)) + '</span></div>';
    return '<div style="text-align:left;margin-bottom:6px"><span style="display:inline-block;background:var(--card);border:1px solid var(--border);padding:6px 10px;border-radius:10px 10px 10px 2px;max-width:85%">' + stripMd(esc(m.content)) + '</span></div>';
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function sendPurchaseChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const name = document.getElementById('fName').value.trim();

  purchaseChatHistory.push({role: 'user', content: text});
  renderChatMessages();

  const btn = document.getElementById('chatSendBtn');
  btn.disabled = true; btn.textContent = '...';

  try {
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin()},
      body: JSON.stringify({
        action: 'purchase-chat',
        data: {
          productName: name,
          messages: purchaseChatHistory,
          evalContext: purchaseEvalContext
        }
      })
    });
    const d = await r.json();
    if (d.ok) {
      purchaseChatHistory.push({role: 'assistant', content: d.data});
      renderChatMessages();
    } else {
      purchaseChatHistory.push({role: 'assistant', content: '❌ ' + (d.error || '回复失败')});
      renderChatMessages();
    }
  } catch(e) {
    purchaseChatHistory.push({role: 'assistant', content: '❌ 网络错误'});
    renderChatMessages();
  } finally {
    btn.disabled = false; btn.textContent = '发送';
  }
}

function sendQuickChat(text) {
  document.getElementById('chatInput').value = text;
  sendPurchaseChat();
}

function cancelPurchaseEval() {
  document.getElementById('aiEvalResult').style.display = 'none';
  document.getElementById('chatArea').style.display = 'none';
  document.getElementById('fName').value = '';
  document.getElementById('fReason').value = '';
  document.getElementById('fBudgetMin').value = '';
  document.getElementById('fBudgetMax').value = '';
  purchaseChatHistory = [];
  purchaseEvalContext = '';
}

// ===== 取消采购（归档） =====
async function cancelPurchase(id) {
  const item = items.find(x => x.id === id);
  if (!item) return;
  const reason = prompt('取消理由（选填）：');
  if (reason === null) return; // 用户点了取消
  
  // 在备注中追加取消理由
  let note = item['备注'] || '';
  if (reason) note += '\n===CANCEL_REASON===' + reason;
  
  const r = await api('PATCH', { ids: [id], status: '已取消', note: note });
  if (r && r.error) { alert('操作失败: ' + r.error); return; }
  toast('已取消采购');
  await loadAll();
}

// 提交评估：切换到详情页，显示预算区间和AI摘要
async function submitEvaluation() {
  const name = document.getElementById('fName').value.trim();
  if (!name) { alert('商品名称丢失'); return; }
  if (purchaseChatHistory.length < 1) { alert('请先进行AI评估'); return; }

  const reason = (document.getElementById('fReason').value || '').trim();
  const aiSummary = purchaseChatHistory
    .filter(m => m.role === 'assistant')
    .map(m => m.content.replace(/\n+/g, ' ').slice(0, 200))
    .join(' | ');
  const budgetMin = parseFloat(document.getElementById('fBudgetMin').value) || 0;
  const budgetMax = parseFloat(document.getElementById('fBudgetMax').value) || 0;
  let budgetText = '';
  if (budgetMin > 0 && budgetMax > 0) budgetText = budgetMin + '~' + budgetMax;
  else if (budgetMin > 0) budgetText = budgetMin + '+';
  else if (budgetMax > 0) budgetText = budgetMax + '-';

  // Switch to detailPhase with AI data pre-filled
  document.getElementById('evalPhase').style.display = 'none';
  document.getElementById('chatArea').style.display = 'none';
  document.getElementById('detailPhase').style.display = '';
  document.getElementById('fNameDisplay').value = name;
  document.getElementById('fPrice').value = '';
  document.getElementById('fQty').value = '1';
  document.getElementById('fNote').value = reason || '';
  document.getElementById('fPlatform').value = '拼多多';
  document.getElementById('fCategory').value = '日用';
  document.getElementById('fBudgetDisplay').textContent = budgetText || '未设置';
  // Reset installment state
  var dig=document.getElementById('detailInstallmentGroup');if(dig)dig.style.display='none';
  var dib=document.getElementById('detailInstBtn');if(dib){dib.style.background='var(--bg)';dib.style.color='var(--text)';}
  var dip=document.getElementById('installmentPreviewDetail');if(dip)dip.textContent='';
  var did=document.getElementById('fInstallmentsDetail');if(did)did.value='';
  // Store AI context for submitPurchase to use
  purchaseEvalContext = aiSummary;
  toast('AI评估完成，请填写采购详情');
}

function backToEval() {
  document.getElementById('evalPhase').style.display = '';
  document.getElementById('detailPhase').style.display = 'none';
  document.getElementById('aiEvalResult').style.display = 'block';
  document.getElementById('chatArea').style.display = 'block';
}

// ===== 评估续聊弹窗 =====
let evalModalChatHistory = [];
let evalModalItemId = '';
let evalModalItem = null;

function openEvalModal(id) {
  const item = items.find(x => x.id === id);
  if (!item) return;
  evalModalItemId = id;
  evalModalItem = item;
  const ev = parseEvalNote(item['备注']);
  evalModalChatHistory = ev && ev.chat ? ev.chat : [];
  if (evalModalChatHistory.length === 0) {
    // fallback: 只有摘要
    const summary = ev ? ev.summary : (item['备注'] || '暂无评估记录');
    evalModalChatHistory = [{ role: 'assistant', content: summary }];
  }
  renderEvalModal();
  document.getElementById('evalOverlay').classList.add('active');
}

function closeEvalModal() {
  document.getElementById('evalOverlay').classList.remove('active');
}

async function cancelFromEval() {
  const reason = document.getElementById('evalReasonInput') ? document.getElementById('evalReasonInput').value.trim() : '';
  if (!confirm(reason ? '确定不买了？' + String.fromCharCode(10) + '理由: ' + reason : '确定不买了？')) return;
  try {
    const r = await api('PUT', { id: evalModalItemId, status: '已取消', cancelReason: reason || '', setDate: true });
    if (r && r.error) { alert('操作失败: ' + r.error); return; }
    toast('已取消采购');
    document.getElementById('evalOverlay').classList.remove('active');
    await loadAll();
  } catch (e) { toast('操作失败'); }
}

function renderEvalModal() {
  const item = evalModalItem;
  if (!item) return;
  const ev = parseEvalNote(item['备注']);
  const budget = item['预算区间'] || (ev ? ev.budget : '未设置');
  const summary = item['评估摘要'] || (ev ? ev.summary : '');
  const reason = item['购买理由'] || (ev ? ev.reason : '');
  const cancelText = item['取消原因'] || '';
  
  let html = `<div style="margin-bottom:12px">
    <div style="font-size:16px;font-weight:700;margin-bottom:4px">${esc(item['商品名称']||'')}</div>
  </div>`;
  
  // 购买理由
  if (reason) {
    html += `<div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:10px;font-size:13px;line-height:1.7;border-left:3px solid var(--orange)">
      <div style="font-weight:600;margin-bottom:4px">💡 购买理由</div>
      <div style="color:var(--muted)">${esc(reason)}</div>
    </div>`;
  }
  
  // 取消理由（如果有）
  if (cancelText) {
    html += `<div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:10px;font-size:13px;line-height:1.7;border-left:3px solid var(--red)">
      <div style="font-weight:600;margin-bottom:4px">❌ 取消理由</div>
      <div style="color:var(--muted)">${esc(cancelText)}</div>
    </div>`;
  }
  
  // AI 摘要
  if (summary) {
    html += `<div style="background:var(--bg);border-radius:10px;padding:12px;margin-bottom:10px;font-size:13px;line-height:1.7;border-left:3px solid var(--pri)">
      <div style="font-weight:600;margin-bottom:4px">🤖 AI 评估摘要</div>
      <div style="color:var(--muted)">${stripMd(esc(summary))}</div>
    </div>`;
  }
  
  // 预算区间（可编辑）
  const budgetParts = budget.includes('~') ? budget.split('~') : [budget, ''];
  const bMin = budgetParts[0].replace(/[^\d.]/g, '');
  const bMax = (budgetParts[1] || '').replace(/[^\d.]/g, '');
  html += `<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
    <span style="font-weight:600;font-size:13px">💰 预算区间：</span>
    <input id="evalBudgetMin" type="number" value="${bMin}" placeholder="最低" min="0" style="width:80px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:13px">
    <span style="color:var(--muted)">~</span>
    <input id="evalBudgetMax" type="number" value="${bMax}" placeholder="最高" min="0" style="width:80px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:13px">
    <span style="font-size:12px;color:var(--muted)">元</span>
  </div>`;
  
  // 对话记录
  html += `<div id="evalModalChat" style="max-height:300px;overflow-y:auto;background:var(--bg);border-radius:10px;padding:10px;margin-bottom:10px;font-size:13px;line-height:1.6">`;
  evalModalChatHistory.forEach(m => {
    if (m.role === 'user') {
      html += `<div style="text-align:right;margin-bottom:6px"><span style="display:inline-block;background:var(--pri);color:#fff;padding:6px 10px;border-radius:10px 10px 2px 10px;max-width:85%">${stripMd(esc(m.content))}</span></div>`;
    } else {
      html += `<div style="text-align:left;margin-bottom:6px"><span style="display:inline-block;background:var(--card);border:1px solid var(--border);padding:6px 10px;border-radius:10px 10px 10px 2px;max-width:85%">${stripMd(esc(m.content))}</span></div>`;
    }
  });
  html += '</div>';
  
  // 输入区
  html += `<div style="display:flex;gap:6px;margin-bottom:10px">
    <input id="evalModalInput" placeholder="继续评估，如：换个平台呢？" onkeydown="if(event.key==='Enter'&&!this.disabled)sendEvalChat()" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font-size:13px">
    <button id="evalModalSendBtn" onclick="sendEvalChat()" style="padding:10px 16px;background:var(--pri);color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px">发送</button>
  </div>`;
  
  // 快捷问题
  html += `<div style="display:flex;gap:6px;margin-bottom:12px">
    <button onclick="sendEvalQuickChat('有没有更便宜的平台？')" style="flex:1;padding:8px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:11px;cursor:pointer">💰 更便宜的</button>
    <button onclick="sendEvalQuickChat('换个品牌推荐？')" style="flex:1;padding:8px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:11px;cursor:pointer">🔄 换推荐</button>
    <button onclick="sendEvalQuickChat('等等再买可以吗？')" style="flex:1;padding:8px;background:var(--card);border:1px solid var(--border);border-radius:6px;font-size:11px;cursor:pointer">⏳ 等等</button>
  </div>`;
  
  // reason input
  html += `<div style="margin-bottom:10px">
    <div style="font-weight:600;font-size:13px;margin-bottom:4px">购买理由（可选）</div>
    <textarea id="evalReasonInput" rows="2" placeholder="为什么想买这个？" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);font-size:13px;resize:vertical;box-sizing:border-box">${esc(reason)}</textarea>
  </div>`;

  // action buttons
  html += `<div style="display:flex;gap:8px;flex-wrap:wrap">
    <button onclick="closeEvalModal()" style="flex:1;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:10px;font-weight:600;cursor:pointer">关闭</button>
    <button onclick="submitEvalToDetail()" style="flex:1;padding:12px;background:var(--green);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer">📝 继续采购</button>
    <button onclick="cancelFromEval()" style="flex:1;padding:12px;background:var(--red);color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer">不买了</button>
  </div>`;
  document.getElementById('evalContent').innerHTML = html;
  // 滚动到底部
  const chatEl = document.getElementById('evalModalChat');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
}

async function sendEvalChat() {
  const input = document.getElementById('evalModalInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  evalModalChatHistory.push({ role: 'user', content: text });
  renderEvalModal();
  const btn = document.getElementById('evalModalSendBtn');
  btn.disabled = true; btn.textContent = '...';
  try {
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin()},
      body: JSON.stringify({
        action: 'purchase-chat',
        data: {
          productName: evalModalItem['商品名称'],
          messages: evalModalChatHistory,
          evalContext: evalModalChatHistory[0]?.content || ''
        }
      })
    });
    const d = await r.json();
    if (d.ok) {
      evalModalChatHistory.push({ role: 'assistant', content: d.data });
    } else {
      evalModalChatHistory.push({ role: 'assistant', content: '❌ ' + (d.error || '回复失败') });
    }
  } catch(e) {
    evalModalChatHistory.push({ role: 'assistant', content: '❌ 网络错误' });
  } finally {
    btn.disabled = false; btn.textContent = '发送';
    renderEvalModal();
  }
}

function sendEvalQuickChat(text) {
  document.getElementById('evalModalInput').value = text;
  sendEvalChat();
}

// 保存评估进度（更新备注，保留对话记录）
async function saveEvalProgress() {
  if (!evalModalItemId) return;
  const bMin = document.getElementById('evalBudgetMin') ? document.getElementById('evalBudgetMin').value : '';
  const bMax = document.getElementById('evalBudgetMax') ? document.getElementById('evalBudgetMax').value : '';
  const budgetText = (bMin && bMax) ? bMin + '~' + bMax : (bMin || bMax || '');
  const aiSummary = evalModalChatHistory.filter(m => m.role === 'assistant').map(m => m.content.replace(/\\n+/g, ' ').slice(0, 200)).join(' | ');
  const reason = document.getElementById('evalReasonInput') ? document.getElementById('evalReasonInput').value.trim() : '';
  try {
    const r = await api('PUT', { id: evalModalItemId, evalSummary: aiSummary, buyReason: reason, budgetRange: budgetText });
    if (r && r.error) { alert('保存失败: ' + r.error); return; }
    toast('评估已保存');
    await loadAll();
  } catch (e) { toast('保存失败'); }
}

// 进入需求填写：关闭评估弹窗，打开详情编辑（先保存预算修改）
async function submitEvalToDetail() {
  if (!evalModalItem) return;
  const bMin = document.getElementById('evalBudgetMin') ? document.getElementById('evalBudgetMin').value : '';
  const bMax = document.getElementById('evalBudgetMax') ? document.getElementById('evalBudgetMax').value : '';
  const budgetText = (bMin && bMax) ? bMin + '~' + bMax : (bMin || bMax || '');
  const aiSummary = evalModalChatHistory.filter(m => m.role === 'assistant').map(m => m.content.replace(/\\n+/g, ' ').slice(0, 200)).join(' | ');
  const reason = document.getElementById('evalReasonInput') ? document.getElementById('evalReasonInput').value.trim() : '';
  try { await api('PUT', { id: evalModalItemId, evalSummary: aiSummary, buyReason: reason, budgetRange: budgetText }); } catch {}
  switchToDetailPhase(evalModalItem['商品名称'], '');
  document.getElementById('evalOverlay').classList.remove('active');
}


// ===== Purchase Image Upload =====
var purchaseImageData = {};
function handlePurchaseImage(input, prefix) {
  var file = input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var MAX = 800;
      var w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      purchaseImageData[prefix] = canvas.toDataURL('image/jpeg', 0.8);
      var preview = document.getElementById(prefix + 'ImagePreview');
      var wrap = document.getElementById(prefix + 'ImageWrap');
      var sizeInfo = document.getElementById(prefix + 'ImageSize');
      if (preview) preview.src = purchaseImageData[prefix];
      if (wrap) wrap.style.display = 'block';
      if (sizeInfo) { var kb = Math.round(purchaseImageData[prefix].length * 0.75 / 1024); sizeInfo.textContent = kb + 'KB'; }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function submitPurchase() {
  const name = document.getElementById('fNameDisplay').value.trim();
  if (!name) { alert('商品名称丢失'); return; }
  const price = parseFloat(document.getElementById('fPrice').value) || 0;
  const qty = parseInt(document.getElementById('fQty').value) || 1;
  const total = price * qty;
  const instVal = parseInt(document.getElementById('fInstallmentsDetail')?.value) || 0;
  const instAmount = instVal > 0 ? Math.round((total / instVal) * 100) / 100 : 0;
  const data = {
    name,
    platform: document.getElementById('fPlatform').value,
    category: document.getElementById('fCategory').value,
    price: price,
    qty: qty,
    status: '待审批',
    date: new Date().toISOString().slice(0, 10),
    note: document.getElementById('fNote').value.trim() || null,
    image: purchaseImageData['p'] || null,
    installments: instVal,
    installmentAmount: instAmount,
    installmentStart: getThisMonth()
  };
  const r = await api('POST', data);
  if (r && r.error) { alert('添加失败: ' + r.error + (r.detail ? JSON.stringify(r.detail) : '')); return; }
  toast('采购单已提交，进入待审批状态');
  closeModal();
  await loadAll();
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

// ===== 预算 =====
let catDebounce=null;let lastAICat=null;
function onNoteInput(){
  clearTimeout(catDebounce);
  const note=document.getElementById('eNote').value.trim();
  const suggestEl=document.getElementById('aiCatSuggest');
  if(!note){suggestEl.style.display='none';lastAICat=null;return}
  catDebounce=setTimeout(()=>suggestCategory(note),600);
}
async function suggestCategory(note){
  const suggestEl=document.getElementById('aiCatSuggest');
  const textEl=document.getElementById('aiCatText');
  try{
    const res=await aiRequest('categorize',{note,existingExpenses:expenses});
    if(res.ok&&res.data){
      const d=res.data;
      lastAICat=d;
      const tags=d.tags&&d.tags.length?d.tags.map(t=>`<span style="background:var(--card);padding:1px 6px;border-radius:4px;margin-left:4px;font-size:10px">${t}</span>`).join(''):'';
      textEl.innerHTML=`🤖 建议: <b>${d.category}</b>${tags} <span style="font-size:10px;color:var(--muted);margin-left:4px">${((d.confidence||0)*100).toFixed(0)}% · 点击采纳</span>`;
      suggestEl.style.display='block';
    }
  }catch{suggestEl.style.display='none';lastAICat=null}
}
function applyAICat(){
  if(!lastAICat)return;
  document.getElementById('eCategory').value=lastAICat.category;
  toast(`已切换为「${lastAICat.category}」`);
  document.getElementById('aiCatSuggest').style.display='none';
  lastAICat=null;
}




// === App.ai namespace exports ===
App.ai.parseEvalNote = parseEvalNote;
App.ai.aiRequest = aiRequest;
App.ai.sendAI = sendAI;
App.ai.confirmAI = confirmAI;
App.ai.cancelAI = cancelAI;
App.ai.skipToDetail = skipToDetail;
App.ai.toggleDetailInstallment = toggleDetailInstallment;
App.ai.updateDetailInstallmentPreview = updateDetailInstallmentPreview;
App.ai.runPurchaseEval = runPurchaseEval;
App.ai.switchToDetailPhase = switchToDetailPhase;
App.ai.renderChatMessages = renderChatMessages;
App.ai.sendPurchaseChat = sendPurchaseChat;
App.ai.sendQuickChat = sendQuickChat;
App.ai.cancelPurchaseEval = cancelPurchaseEval;
App.ai.cancelPurchase = cancelPurchase;
App.ai.submitEvaluation = submitEvaluation;
App.ai.backToEval = backToEval;
App.ai.openEvalModal = openEvalModal;
App.ai.closeEvalModal = closeEvalModal;
App.ai.cancelFromEval = cancelFromEval;
App.ai.renderEvalModal = renderEvalModal;
App.ai.sendEvalChat = sendEvalChat;
App.ai.sendEvalQuickChat = sendEvalQuickChat;
App.ai.saveEvalProgress = saveEvalProgress;
App.ai.submitEvalToDetail = submitEvalToDetail;
App.ai.submitPurchase = submitPurchase;
App.ai.queryAI = queryAI;
App.ai.runAIAnalysis = runAIAnalysis;
App.ai.runAIProfile = runAIProfile;
App.ai.onNoteInput = onNoteInput;
App.ai.suggestCategory = suggestCategory;
App.ai.applyAICat = applyAICat;
