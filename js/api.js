// api.js - API Layer, Budget, Recurring
const API='/api/items';
const EXPENSE_API='/api/expenses';
var _budgetCache=null;
function getBudgets(){if(_budgetCache)return _budgetCache;try{_budgetCache=JSON.parse(localStorage.getItem('purchase_budgets')||'{}')}catch{_budgetCache={}}return _budgetCache}
function setBudgets(b){_budgetCache=b;localStorage.setItem('purchase_budgets',JSON.stringify(b));syncBudgetToServer(b)}
function getBudget(m){return getBudgets()[m]||0}
async function syncBudgetToServer(b){
  try{
    var token=getPin();
    var r=await fetch('/api/budgets',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({data:b})});
    if(r.status===401){var nt=await refreshAccessToken();if(nt){await fetch('/api/budgets',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+nt},body:JSON.stringify({data:b})})}}
  }catch(e){}
}
async function loadBudgetFromServer(){
  try{
    var token=getPin();
    var r=await fetch('/api/budgets',{headers:{'Authorization':'Bearer '+token}});
    if(r.status===401){var nt=await refreshAccessToken();if(nt){r=await fetch('/api/budgets',{headers:{'Authorization':'Bearer '+nt}})}}
    if(!r.ok)return getBudgets();
    var d=await r.json();
    if(d&&d.data){_budgetCache=d.data;localStorage.setItem('purchase_budgets',JSON.stringify(d.data));return d.data}
    return getBudgets();
  }catch(e){return getBudgets()}
}
function getBudgetNum(m){var b=getBudget(m);return(b&&typeof b==='object')?(b.total||0):(typeof b==='number'?b:0)}
// === 周预算系统 ===
function getMonthWeeks(ym){
  var parts=ym.split('-');var y=Number(parts[0]);var m=Number(parts[1]);
  var ld=new Date(y,m,0).getDate();
  var base=Math.floor(ld/4);var rem=ld%4;
  var w=[];var s=1;
  for(var i=0;i<4;i++){
    var days=base+(i<rem?1:0);
    w.push({num:i+1,start:s,end:s+days-1,startDate:ym+'-'+String(s).padStart(2,'0')});
    s+=days;
  }
  return w;
}
function getWeekForDate(ds,ym){
  if(!ds)return -1;
  if(typeof ds==="number"){var _d=new Date(ds+8*3600000);ds=_d.getUTCFullYear()+"-"+String(_d.getUTCMonth()+1).padStart(2,"0")+"-"+String(_d.getUTCDate()).padStart(2,"0")}
  var d=parseInt(ds.slice(8,10));
  var w=getMonthWeeks(ym);
  for(var i=0;i<w.length;i++){if(d>=w[i].start&&d<=w[i].end)return i}
  return -1;
}
function getWeekBudgets(m){const b=getBudgets();if(!b[m])return{total:0,perWeek:0,weeks:{}};if(typeof b[m]==='number')return{total:b[m],perWeek:0,weeks:{}};return{total:b[m].total||0,perWeek:b[m].perWeek||0,weeks:b[m].weeks||{}}}
function getWeekBudget(m,i){const wb=getWeekBudgets(m);if(wb.weeks[i]!==undefined)return wb.weeks[i];if(wb.perWeek>0)return wb.perWeek;return 0}
function setWeekBudgets(m,total,pw,wo){const b=getBudgets();b[m]={total:total,perWeek:pw||0,weeks:wo||{}};setBudgets(b)}
function renderWeekBudgetInputs(m,total){
  const weeks=getMonthWeeks(m);
  const wb=getWeekBudgets(m);
  const container=document.getElementById('weekBudgetCards');
  if(!container)return;
  container.innerHTML='';
  weeks.forEach((w,i)=>{
    const card=document.createElement('div');
    card.style.cssText='background:var(--bg);border-radius:12px;padding:10px 12px;margin-bottom:8px';
    const header=document.createElement('div');
    header.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:6px';
    header.innerHTML='<span style="font-size:12px;font-weight:600">第'+w.num+'周 <span style="color:var(--muted)">'+w.start+'-'+w.end+'日</span></span>';
    card.appendChild(header);
    const input=document.createElement('input');
    input.id='weekBudget_'+i;
    input.type='number';
    input.min='0';
    input.step='1';
    input.placeholder='¥0';
    input.value=wb.weeks[i]||'';
    input.style.cssText='width:100%;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:14px';
    card.appendChild(input);
    container.appendChild(card);
  });
}

async function analyzeBudget(){
  const m=document.getElementById('budgetMonth').value||getThisMonth();
  const total=parseFloat(document.getElementById('budgetInput').value)||0;
  const weeks=getMonthWeeks(m);
  const wo={};
  weeks.forEach((w,i)=>{const el=document.getElementById('weekBudget_'+i);wo[i]=el?parseFloat(el.value)||0:0});
  const monthExpenses=expenses.filter(e=>{if(!e['日期'])return false;try{return getMonth(e['日期'])===m}catch{return false}});
  const totalOut=monthExpenses.filter(e=>e['类型']==='支出').reduce((s,e)=>s+Number(e['金额']||0),0);
  const catMap={};
  monthExpenses.filter(e=>e['类型']==='支出').forEach(e=>{const c=e['分类']||'其他';catMap[c]=(catMap[c]||0)+Number(e['金额']||0)});
  const catStr=Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+':'+v.toFixed(0)+'元').join(', ');
  let histStr='';
  for(let off=1;off<=3;off++){
    const d=new Date();d.setMonth(d.getMonth()-off);
    const hm=d.toISOString().slice(0,7);
    const he=expenses.filter(e=>{if(!e['日期'])return false;try{return getMonth(e['日期'])===hm}catch{return false}});
    const ht=he.filter(e=>e['类型']==='支出').reduce((s,e)=>s+Number(e['金额']||0),0);
    if(ht>0)histStr+=hm+':'+ht.toFixed(0)+'元 ';
  }
  const weekStr=weeks.map((w,i)=>'第'+w.num+'周('+w.start+'-'+w.end+'日):'+(wo[i]||0)+'元').join(', ');
  const prompt='请分析我的预算并给出建议。\n\n【月份】'+m+'\n【月总预算】'+total+'元\n【每周预算】'+weekStr+'\n【本月已支出】'+totalOut.toFixed(0)+'元\n【支出分类】'+(catStr||'无')+'\n【历史数据】'+(histStr||'无')+'\n\n必须包含以下格式（严格遵守）：\n建议月预算：XXXX元\n第1周：XXX元\n第2周：XXX元\n第3周：XXX元\n第4周：XXX元\n\n其他分析和建议。';
  const el=document.getElementById('budgetAiResult');
  el.style.display='block';
  el.innerHTML='<div style="color:var(--muted)">AI 分析中...</div>';
  try{
    const r=await (await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({action:'budget-analyze',data:{prompt,month:m,totalBudget:total,weekBudgets:wo,expenses:expenses}})})).json();
    if(r&&(r.reply||r.data||r.ok)){
      const reply=r.data||r.reply||r.result||'';el.innerHTML='<div style="white-space:pre-wrap;line-height:1.6">'+esc(reply)+'</div>';
      const btn=document.createElement('button');
      btn.textContent='一键采用建议预算';
      btn.style.cssText='width:100%;margin-top:12px;padding:10px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer';
      btn.onclick=function(){
        const mMatch=reply.match(/月预算[：:]\s*(\d[\d,.]*)/);
        if(mMatch){document.getElementById('budgetInput').value=parseFloat(mMatch[1].replace(/,/g,''))}
        const wMatches=[...reply.matchAll(/第(\d)周[：:]\s*(\d[\d,.]*)/g)];
        wMatches.forEach(function(wm){const idx=parseInt(wm[1])-1;const el=document.getElementById('weekBudget_'+idx);if(el)el.value=parseFloat(wm[2].replace(/,/g,''))});
        toast('已采用建议预算');
      };
      el.appendChild(btn);
    }else{el.innerHTML='<div style="color:var(--red)">分析失败</div>'}
  }catch(e){el.innerHTML='<div style="color:var(--red)">请求失败: '+e.message+'</div>'}
}





// ===== API =====
async function api(method,body,id){
  let url=API;
  const opts={method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()}};
  if(method==='DELETE')url+='?id='+id;
  else if(body)opts.body=JSON.stringify(body);
  let r=await fetch(url,opts);
  if(r.status===401){
    const newToken=await refreshAccessToken();
    if(newToken){
      opts.headers['Authorization']='Bearer '+newToken;
      r=await fetch(url,opts);
    }
    if(r.status===401){clearTokens();document.getElementById('authScreen').style.display='flex';return{error:'unauthorized'}}
  }
  return r.json();
}
async function expenseApi(method,body,id){
  let url=EXPENSE_API;
  const opts={method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()}};
  if(method==='DELETE')url+='?id='+id;
  else if(body)opts.body=JSON.stringify(body);
  let r=await fetch(url,opts);
  if(r.status===401){
    const newToken=await refreshAccessToken();
    if(newToken){
      opts.headers['Authorization']='Bearer '+newToken;
      r=await fetch(url,opts);
    }
    if(r.status===401){clearTokens();document.getElementById('authScreen').style.display='flex';return{error:'unauthorized'}}
  }
  return r.json();
}

// ===== 固定支出 API =====
const RECURRING_API = '/api/recurring';
async function recurringApi(method, data) {
  const opts = { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin() } };
  if (data && method !== 'GET') opts.body = JSON.stringify(data);
  let r = await fetch(RECURRING_API, opts);
  if (r.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) { opts.headers['Authorization'] = 'Bearer ' + newToken; r = await fetch(RECURRING_API, opts); }
  }
  return r.json();
}

// ===== 固定支出自动记账 =====
async function checkRecurring() {
  try {
    const pin = getPin();
    if (!pin) return;
    const res = await fetch(RECURRING_API, { headers: { 'Authorization': 'Bearer ' + pin } });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.data || !data.data.items) return;
    const now = new Date(Date.now() + 8 * 3600000);
    const thisMonth = now.toISOString().slice(0, 7);
    let changed = false;
    for (const item of data.data.items) {
      if (!item.active) continue;
      if (item.lastGenerated >= thisMonth) continue;
      const day = String(item.dayOfMonth || 1).padStart(2, '0');
      const dateStr = thisMonth + '-' + day;
      const dateTs = new Date(dateStr + 'T12:00:00+08:00').getTime();
      const dup = expenses.find(e => e['备注'] && e['备注'].includes('[固定]') && e['备注'].includes(item.name) && getMonth(e['日期']) === thisMonth);
      if (dup) { item.lastGenerated = thisMonth; changed = true; continue; }
      await expenseApi('POST', {
        amount: item.amount, category: item.category || '其他',
        note: '[固定] ' + item.name + (item.note ? ' - ' + item.note : ''),
        date: dateStr + 'T09:00:00'
      });
      item.lastGenerated = thisMonth;
      changed = true;
    }
    if (changed) {
      await fetch(RECURRING_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pin },
        body: JSON.stringify({ data: data.data })
      });
      try { var fresh = await expenseApi('GET'); if(fresh && Array.isArray(fresh)) expenses = fresh; } catch(e) {}
    }
  } catch (e) { console.error('checkRecurring error:', e); }
}

// ===== 分期自动生成 =====
// Installments tracked via items data in getPurchaseDeduction(), no expense records needed
async function checkInstallments() { /* disabled: shared budget pool model */ }
async function checkInstallments_DISABLED() {
  try {
    const pin = getPin();
    if (!pin) return;
    const now = new Date(Date.now() + 8 * 3600000);
    const thisMonth = now.toISOString().slice(0, 7);
    let changed = false;
    for (const item of items) {
      const totalPeriods = Number(item['分期期数']) || 0;
      const paid = Number(item['分期已还']) || 0;
      const startMonth = item['分期开始月'] || '';
      if (totalPeriods <= 0 || paid >= totalPeriods || !startMonth) continue;
      const sm = startMonth.split('-').map(Number);
      const tm = thisMonth.split('-').map(Number);
      const monthsDiff = (tm[0] - sm[0]) * 12 + (tm[1] - sm[1]);
      if (monthsDiff < paid || monthsDiff >= totalPeriods) continue;
      const amount = Number(item['分期金额']) || 0;
      console.log('INSTALLMENT_CHECK', { item: item['商品名称'], totalPeriods, paid, startMonth, monthsDiff, amount });
      if (amount <= 0) continue;
      const dup = expenses.find(e => e['备注'] && e['备注'].includes('[采购分期]') && e['备注'].includes(item['商品名称'] || '') && getMonth(e['日期']) === thisMonth);
      if (dup) { await api('PUT', { id: item.id, installmentPaid: monthsDiff + 1 }); item['分期已还'] = monthsDiff + 1; changed = true; continue; }
      const periodNum = monthsDiff + 1;
      const isLast = periodNum >= totalPeriods;
      const finalAmount = isLast ? (Number(item['单价'] || 0) * Number(item['数量'] || 1)) - amount * (totalPeriods - 1) : amount;
      await expenseApi('POST', {
        amount: finalAmount, type: '采购', category: item['分类'] || '其他',
        note: '[采购分期] ' + (item['商品名称'] || '') + ' (' + periodNum + '/' + totalPeriods + ')',
        date: thisMonth + '-01T09:00:00'
      });
      item['分期已还'] = periodNum;
      changed = true;
    }
    if (changed) { expenses = (await expenseApi('GET')) || expenses; }
  } catch (e) { console.error('checkInstallments error:', e); }
}

// ===== 固定支出管理 =====
let _recurringData = { items: [] };
async function loadRecurringData() {
  try {
    const pin = getPin();
    if (!pin) return;
    const res = await fetch(RECURRING_API, { headers: { 'Authorization': 'Bearer ' + pin } });
    if (res.ok) { const d = await res.json(); if (d.ok && d.data) _recurringData = d.data; }
  } catch {}
}
async function saveRecurringData() {
  try {
    const pin = getPin();
    if (!pin) return;
    await fetch(RECURRING_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + pin },
      body: JSON.stringify({ data: _recurringData })
    });
  } catch (e) { console.error('saveRecurring error:', e); }
}
function getFixedExpenseTotal() {
  return (_recurringData.items || []).filter(i => i.active).reduce((s, i) => s + (Number(i.amount) || 0), 0);
}


let currentImageData='';let currentImageKey='';
function toggleDarkMode(){const isDark=document.body.classList.toggle('dark');localStorage.setItem('dark_mode',isDark?'1':'0');if(isDark){document.documentElement.classList.remove('light')}else{document.documentElement.classList.add('light')}document.getElementById('darkModeBtn').textContent=isDark?'\u2600\ufe0f':'\ud83c\udf19'}
(function(){if(localStorage.getItem('dark_mode')==='1'){document.body.classList.add('dark');document.getElementById('darkModeBtn').textContent='\u2600\ufe0f'}else if(!localStorage.getItem('dark_mode')&&window.innerWidth>768){}else if(localStorage.getItem('dark_mode')==='0'){document.documentElement.classList.add('light')}})();
function handleImageUpload(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=function(e){const img=new Image();img.onload=function(){const canvas=document.createElement("canvas");const MAX=1600;let w=img.width,h=img.height;if(w>MAX){h=h*MAX/w;w=MAX}if(h>MAX){w=w*MAX/h;h=MAX}canvas.width=w;canvas.height=h;const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,w,h);let q=0.92;let dataUrl=canvas.toDataURL("image/jpeg",q);while(dataUrl.length>2000000&&q>0.3){q-=0.1;dataUrl=canvas.toDataURL("image/jpeg",q)}currentImageData=dataUrl;currentImageKey="";const preview=document.getElementById("eImagePreview");preview.src=dataUrl;preview.style.display="block";const info=document.getElementById("imageSizeInfo");info.textContent="[Compressed: "+String((dataUrl.length/1024).toFixed(0))+"KB]";info.style.display="block";};img.src=e.target.result;};reader.readAsDataURL(file)}
function showFullscreenImg(src){document.getElementById('imgFullscreenImg').src=src;document.getElementById('imgFullscreen').classList.add('active')}

// === App.api namespace exports ===
App.api.api = api;
App.api.expenseApi = expenseApi;
App.api.recurringApi = recurringApi;
App.api.getBudgets = getBudgets;
App.api.setBudgets = setBudgets;
App.api.getBudget = getBudget;
App.api.syncBudgetToServer = syncBudgetToServer;
App.api.loadBudgetFromServer = loadBudgetFromServer;
App.api.getBudgetNum = getBudgetNum;
App.api.getMonthWeeks = getMonthWeeks;
App.api.getWeekForDate = getWeekForDate;
App.api.getWeekBudgets = getWeekBudgets;
App.api.getWeekBudget = getWeekBudget;
App.api.setWeekBudgets = setWeekBudgets;
App.api.renderWeekBudgetInputs = renderWeekBudgetInputs;
App.api.analyzeBudget = analyzeBudget;
App.api.checkRecurring = checkRecurring;
App.api.checkInstallments = checkInstallments;
App.api.loadRecurringData = loadRecurringData;
App.api.saveRecurringData = saveRecurringData;
App.api.getFixedExpenseTotal = getFixedExpenseTotal;

// 计算当月非分期采购支出
function getDirectPurchaseSpend(month) {
  return (items || []).filter(function(i) {
    var s = i['状态'] || '';
    if (s === '已退' || s === '已取消' || s === '待评估' || s === '待审批') return false;
    if (getMonth(i['日期']) !== month) return false;
    return (Number(i['分期期数']) || 0) <= 1;
  }).reduce(function(s, i) {
    return s + (Number(i['单价']) || 0) * (Number(i['数量']) || 1);
  }, 0);
}

// 共享预算池计算（修复：分期扣减使用getMonthInstallmentTotal处理跨月）
function getBudgetPool(month) {
  var totalBudget = getBudgetNum(month);
  var fixedDeduction = getFixedExpenseTotal();
  var installmentDeduction = typeof getMonthInstallmentTotal === "function" ? getMonthInstallmentTotal(month) : 0;
  var directPurchaseSpend = getDirectPurchaseSpend(month);
  var totalDeduction = fixedDeduction + installmentDeduction;
  var available = Math.max(totalBudget - totalDeduction, 0);
  var expenseSpend = (expenses || [])
    .filter(function(e) {
      if (e['类型'] !== '支出' || getMonth(e['日期']) !== month) return false;
      var note = e['备注'] || '';
      if (note.includes('[采购]') || note.includes('[采购分期]')) return false;
      return true;
    })
    .reduce(function(s, e) { return s + Number(e['金额'] || 0); }, 0);
  var remaining = available - directPurchaseSpend - expenseSpend;
  var totalSpend = directPurchaseSpend + expenseSpend;
  return {
    totalBudget: totalBudget,
    fixedDeduction: fixedDeduction,
    installmentDeduction: installmentDeduction,
    directPurchaseSpend: directPurchaseSpend,
    totalDeduction: totalDeduction,
    available: available,
    expenseSpend: expenseSpend,
    totalSpend: totalSpend,
    remaining: remaining
  };
}

App.api.getDirectPurchaseSpend = getDirectPurchaseSpend;

// 计算某周的总支出（记账分搙支持）
function getWeekSpending(month, weekIndex) {
  return (expenses || []).filter(function(e) {
    if (e['类型'] !== '支出' || getMonth(e['日期']) !== month) return false;
    var note = e['备注'] || '';
    if (note.includes('[固定]') || note.includes('[采购]') || note.includes('[采购分期]')) return false;
    return true;
  }).reduce(function(s, e) {
    var splitWeeks = Number(e['分搙周数']) || 0;
    if (splitWeeks > 0) {
      var startWeek = Number(e['分搙开始周']) || 0;
      var offset = weekIndex - startWeek;
      if (offset < 0 || offset >= splitWeeks) return s;
      return s + Number(e['金额'] || 0) / splitWeeks;
    }
    if (getWeekForDate(e['日期'], month) !== weekIndex) return s;
    return s + Number(e['金额'] || 0);
  }, 0);
}

// 动态周预算：从当前周视角计算，所有未来周共享同一额度
function getDynamicWeekBudget(month, weekIndex) {
  var pool = getBudgetPool(month);
  if (pool.available <= 0) return 0;
  var weeks = getMonthWeeks(month);
  var totalWeeks = weeks.length;
  var now = new Date(Date.now() + 8*3600000);
  var today = now.toISOString().slice(0, 10);
  var currentWeek = getWeekForDate(today, month);
  if (currentWeek < 0) currentWeek = 0;
  if (weekIndex < currentWeek) return 0;

  // Spending from weeks before current week
  var priorSpent = 0;
  for (var i = 0; i < currentWeek; i++) {
    priorSpent += getWeekSpending(month, i);
  }

  var remainingWeeks = totalWeeks - currentWeek;
  if (remainingWeeks <= 0) return 0;

  if (weekIndex === currentWeek) {
    // Current week: stable, dont subtract own spending
    return Math.max(pool.available - priorSpent, 0) / remainingWeeks;
  } else {
    // Future weeks: also subtract current week spending
    var currentWeekSpent = getWeekSpending(month, currentWeek);
    return Math.max(pool.available - priorSpent - currentWeekSpent, 0) / remainingWeeks;
  }
}

App.api.getWeekSpending = getWeekSpending;
App.api.getDynamicWeekBudget = getDynamicWeekBudget;
App.api.getBudgetPool = getBudgetPool;
App.api.toggleDarkMode = toggleDarkMode;
App.api.handleImageUpload = handleImageUpload;
App.api.showFullscreenImg = showFullscreenImg;
