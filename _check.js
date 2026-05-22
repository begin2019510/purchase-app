
const APP_VERSION='2.5.3';
function showVersion(){document.getElementById('versionBadge').textContent='v'+APP_VERSION}
const CHANGELOG=[
  {v:'2.5.3',date:'2026-05-21',items:['图片上传分为拍照+相册两个按钮','拍照用capture=environment，相册无限制','兼容所有手机浏览器']},
  {v:'2.5.2',date:'2026-05-21',items:['图片存储升级：改用Cloudflare KV，告别32KB限制','图片压缩上限提升至800px/500KB','旧图片自动兼容，新图片存KV']},
  {v:'2.5.1',date:'2026-05-21',items:['记账精确时间戳：新建/编辑均支持选择具体时间','导出CSV增加独立时间列','卡片时间显示优化：🕐前缀+正常可见','点击版本号查看更新日志']},
  {v:'2.5.0',date:'2026-05-20',items:['归档功能：已到/已退3天后自动提醒归档','审批流完整流程：待审批→已审批→已下单→已到/已退→已归档','新增archive-check定时任务','Bitable新增归档时间字段']},
  {v:'2.4.2',date:'2026-05-20',items:['审批流分支结构修复：已到和已退是分支而非线性','详情弹窗改版：stepper流程展示+操作按钮','已到/已退终态显示归档按钮']},
  {v:'2.4.1',date:'2026-05-20',items:['详情弹窗重做：飞书审批流风格','竖向stepper时间线','卡片只显示状态+最新时间']},
  {v:'2.4.0',date:'2026-05-20',items:['采购审批流：5步状态管理','自动记录状态变更时间','暗色模式','记账图片附件支持','周度/月度汇总飞书推送']},
  {v:'2.3.0',date:'2026-05-20',items:['暗色模式（跟随系统+手动切换）','记账图片附件（拍照+压缩+全屏预览）','周度/月度汇总飞书推送']},
];
function openChangelog(){const c=document.getElementById('changelogContent');let html='';CHANGELOG.forEach(r=>{html+=`<div class='changelog-ver'>v${r.v}<span class='changelog-date'>${r.date}</span></div><ul class='changelog-list'>`;r.items.forEach(i=>{html+=`<li>${i}</li>`});html+='</ul>'});c.innerHTML=html;document.getElementById('changelogOverlay').classList.add('active')}
function closeChangelog(){document.getElementById('changelogOverlay').classList.remove('active')}
document.getElementById('versionBadge').addEventListener('click',openChangelog);
let currentImageData='';let currentImageKey='';
function toggleDarkMode(){const isDark=document.body.classList.toggle('dark');localStorage.setItem('dark_mode',isDark?'1':'0');document.getElementById('darkModeBtn').textContent=isDark?'☀️':'🌙'}
(function(){if(localStorage.getItem('dark_mode')==='1'){document.body.classList.add('dark');document.getElementById('darkModeBtn').textContent='☀️'}})();
function handleImageUpload(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=function(e){const img=new Image();img.onload=function(){const canvas=document.createElement("canvas");const MAX=800;let w=img.width,h=img.height;if(w>MAX){h=h*MAX/w;w=MAX}if(h>MAX){w=w*MAX/h;h=MAX}canvas.width=w;canvas.height=h;const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,w,h);let q=0.7;let dataUrl=canvas.toDataURL("image/jpeg",q);while(dataUrl.length>500000&&q>0.2){q-=0.1;dataUrl=canvas.toDataURL("image/jpeg",q)}currentImageData=dataUrl;currentImageKey="";const preview=document.getElementById("eImagePreview");preview.src=dataUrl;preview.style.display="block";const info=document.getElementById("imageSizeInfo");info.textContent="[Compressed: "+String((dataUrl.length/1024).toFixed(0))+"KB]";info.style.display="block";};img.src=e.target.result;};reader.readAsDataURL(file)}
function showFullscreenImg(src){document.getElementById('imgFullscreenImg').src=src;document.getElementById('imgFullscreen').classList.add('active')}
const API='/api/items';
const EXPENSE_API='/api/expenses';
let items=[], expenses=[];
let currentStatusFilter='全部',currentCatFilter='全部';
let batchMode=false,selectedIds=new Set();
let currentTab='purchase';

// ===== PIN =====
function getPin(){return localStorage.getItem('purchase_pin')||''}
function setPin(p){localStorage.setItem('purchase_pin',p)}
function submitPin(){const pin=document.getElementById('pinInput').value.trim();if(!pin){document.getElementById('pinError').textContent='请输入密码';return}setPin(pin);verifyAndLoad()}
async function verifyAndLoad(){try{const r=await fetch(API,{headers:{'X-API-Key':getPin()}});if(r.status===401){document.getElementById('pinError').textContent='密码错误';document.getElementById('pinInput').value='';return}if(!r.ok)throw new Error();document.getElementById('pinScreen').style.display='none';loadAll()}catch{document.getElementById('pinError').textContent='连接失败'}}
document.getElementById('pinInput').addEventListener('keydown',e=>{if(e.key==='Enter')submitPin()});

// ===== Service Worker =====
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}
// ===== 推送 - 飞书机器人（国内可用） =====
// 无需浏览器权限，配置飞书机器人 webhook 即可
// 配置方法：Cloudflare 环境变量 FEISHU_BOT_WEBHOOK
async function setupPush(){
  const msg = '推送使用飞书机器人\n\n操作步骤：\n1. 飞书打开一个群聊\n2. 群设置 → 群机器人 → 添加机器人\n3. 选择自定义机器人 → 复制 Webhook 地址\n4. 在 Cloudflare Pages 设置中添加环境变量：\n   FEISHU_BOT_WEBHOOK = 复制的地址\n5. 然后 GitHub Actions 每天 20:00 自动发提醒';
  alert(msg);
}

function getBudgets(){try{return JSON.parse(localStorage.getItem('purchase_budgets')||'{}')}catch{return{}}}
function setBudgets(b){localStorage.setItem('purchase_budgets',JSON.stringify(b))}
function getBudget(m){return getBudgets()[m]||0}

// ===== API =====
async function api(method,body,id){
  let url=API;
  const opts={method,headers:{'Content-Type':'application/json','X-API-Key':getPin()}};
  if(method==='DELETE')url+='?id='+id;
  else if(body)opts.body=JSON.stringify(body);
  const r=await fetch(url,opts);
  if(r.status===401){document.getElementById('pinScreen').style.display='flex';document.getElementById('pinError').textContent='会话过期';return{error:'unauthorized'}}
  return r.json();
}
async function expenseApi(method,body,id){
  let url=EXPENSE_API;
  const opts={method,headers:{'Content-Type':'application/json','X-API-Key':getPin()}};
  if(method==='DELETE')url+='?id='+id;
  else if(body)opts.body=JSON.stringify(body);
  const r=await fetch(url,opts);
  if(r.status===401)return{error:'unauthorized'};
  return r.json();
}

// ===== 启动 =====
showVersion();
if('serviceWorker' in navigator) document.getElementById('pushBtn').style.display='';
if(getPin()){verifyAndLoad()}else{document.getElementById('pinScreen').style.display='flex'}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function toast(m){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2200)}
function getMonth(d){if(!d)return null;try{return new Date(Date.parse(d)+8*3600*1000).toISOString().slice(0,7)}catch{return null}}
function getThisMonth(){return new Date(Date.now()+8*3600*1000).toISOString().slice(0,7)}
function totalCost(l){return l.reduce((s,i)=>s+(i['单价']||0)*(i['数量']||1),0)}

async function loadAll(){
  try{
    const [r, e] = await Promise.all([
      api('GET'),
      expenseApi('GET')
    ]);
    if(r && !r.error && Array.isArray(r)) items = r;
    if(e && !e.error && Array.isArray(e)) expenses = e;
  }catch{}
  render();
}

// ===== 采购渲染 =====
function render(){
  if(currentTab==='purchase') renderPurchase();
  else if(currentTab==='expense') renderExpense();
  else if(currentTab==='stats') renderStats();
  updateHeader();
}
function updateHeader(){
  const total=totalCost(items);
  const thisMonth=getThisMonth();
  const monthItems=items.filter(i=>getMonth(i['日期'])===thisMonth&&i['状态']!=='已退');
  const monthTotal=totalCost(monthItems);
  const expThisMonth=expenses.filter(e=>{
    if(!e['日期'])return false;
    try{return new Date(e['日期']).toISOString().slice(0,7)===thisMonth}catch{return false}
  });
  const expTotal=expThisMonth.filter(e=>e['类型']==='支出').reduce((s,e)=>s+Number(e['金额']||0),0);
  const incTotal=expThisMonth.filter(e=>e['类型']==='收入').reduce((s,e)=>s+Number(e['金额']||0),0);
  document.getElementById('headerStats').innerHTML=`
    <div class="stat"><span class="stat-val">${items.length}</span><span class="stat-lbl">采购</span></div>
    <div class="stat"><span class="stat-val">¥${monthTotal.toFixed(0)}</span><span class="stat-lbl">本月采购</span></div>
    <div class="stat"><span class="stat-val" style="color:#fca5a5">¥${expTotal.toFixed(0)}</span><span class="stat-lbl">本月支出</span></div>
    <div class="stat"><span class="stat-val" style="color:#86efac">¥${incTotal.toFixed(0)}</span><span class="stat-lbl">本月收入</span></div>
  `;
}
function renderPurchase(){
  const q=document.getElementById('searchInput').value.toLowerCase();
  let f=items;
  if(q)f=f.filter(i=>(i['商品名称']||'').toLowerCase().includes(q)||(i['备注']||'').toLowerCase().includes(q));
  if(currentStatusFilter!=='全部')f=f.filter(i=>i['状态']===currentStatusFilter);
  if(currentCatFilter!=='全部')f=f.filter(i=>i['分类']===currentCatFilter);
  const sorted=[...f].sort((a,b)=>(b['日期']||0)-(a['日期']||0));
  const statuses=['全部','待审批','已审批','已下单','已到','已退','已归档'];
  const cats=['全部',...new Set(items.map(i=>i['分类']).filter(Boolean))];
  document.getElementById('statusChips').innerHTML=statuses.map(s=>{const c=s===currentStatusFilter?'active':'';const n=s==='全部'?items.length:items.filter(i=>i['状态']===s).length;return`<div class="chip ${c}" onclick="currentStatusFilter='${s}';render()">${s} ${n}</div>`}).join('')+'<span style="width:1px;background:var(--border);flex-shrink:0"></span>'+cats.map(c=>{const ac=c===currentCatFilter?'active':'';return`<div class="chip ${ac}" onclick="currentCatFilter='${c}';render()">${c}</div>`}).join('');
  const listEl=document.getElementById('list');
  if(batchMode)listEl.classList.add('batch-mode');else listEl.classList.remove('batch-mode');
  if(!sorted.length){listEl.innerHTML='<div class="empty"><div class="icon">📦</div>暂无采购记录<br>点右下角 + 添加</div>';return}
  const groups={};sorted.forEach(i=>{const m=getMonth(i['日期'])||'未设置日期';if(!groups[m])groups[m]=[];groups[m].push(i)});
  let html='';
  for(const[month,list]of Object.entries(groups)){
    const mt=totalCost(list);const dm=month==='未设置日期'?month:month.replace('-','年')+'月';
    html+=`<div class="section-title"><span>${dm}</span><span>¥${mt.toFixed(2)}</span></div>`;
    const statusColors={'待审批':'#f59e0b','已审批':'#3b82f6','已下单':'#8b5cf6','已到':'#10b981','已退':'#ef4444','已归档':'#6b7280'};
    list.forEach(i=>{const qty=i['数量']||1;const price=i['单价']||0;const status=i['状态']||'待审批';const cat=i['分类']||'其他';let ds='';if(i['日期']){try{ds=new Date(i['日期']).toISOString().slice(0,10)}catch{}}const ck=selectedIds.has(i.id);const bc=statusColors[status]||'#94a3b8';
    let tsHtml='';if(i['到货时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">⏰ 到货 ${i['到货时间']}</div>`}else if(i['下单时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">⏰ 下单 ${i['下单时间']}</div>`}else if(i['审批时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">⏰ 审批 ${i['审批时间']}</div>`}else if(i['创建时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">创建 ${i['创建时间']}</div>`}
    html+=`<div class="card ${ck?'selected':''}" style="border-left:4px solid ${bc}" onclick="${batchMode?`toggleSelect('${i.id}')`:`openDetailModal('${i.id}')`}"><div class="checkbox ${ck?'checked':''}" onclick="event.stopPropagation();toggleSelect('${i.id}')">${ck?'✓':''}</div><div class="actions"><button onclick="event.stopPropagation();editItem('${i.id}')" title="编辑">✏️</button><button onclick="event.stopPropagation();delItem('${i.id}')" title="删除">🗑️</button></div><div class="top"><div class="name">${esc(i['商品名称']||'')}</div>${price?`<div class="price">¥${(price*qty).toFixed(2)}</div>`:''}</div><div class="meta"><span>🏪 ${esc(i['平台']||'')}</span><span class="badge badge-${status}">${status}</span><span class="cat-badge">${cat}</span>${ds?`<span>📅 ${ds}</span>`:''}${qty>1?`<span>×${qty}</span>`:''}</div>${i['备注']?`<div class="note">💬 ${esc(i['备注'])}</div>`:''}${tsHtml}</div>`});
  }
  listEl.innerHTML=html;
}

// ===== 记账渲染 =====
const CAT_ICONS={'餐饮':'🍜','交通':'🚗','购物':'🛍️','娱乐':'🎮','居住':'🏠','医疗':'🏥','教育':'📚','其他':'📌'};
const CAT_COLORS = {'日用':'#6366f1','服饰':'#8b5cf6','饮食':'#10b981','电子':'#3b82f6','交通':'#f59e0b','其他':'#94a3b8','餐饮':'#ef4444','购物':'#ec4899','娱乐':'#8b5cf6','居住':'#10b981','医疗':'#f59e0b','教育':'#3b82f6'};
const WEEKDAYS=['日','一','二','三','四','五','六'];
function formatDay(dayStr) {
  if (!dayStr) return { date: '??', weekday: '?' };
  try { const d = new Date(dayStr); return { date: `${((d.getMonth()+1)+'').padStart(2,'0')}月${(d.getDate()+'').padStart(2,'0')}日`, weekday: '周'+WEEKDAYS[d.getDay()], day: d.getDate() }; } catch { return { date: dayStr.slice(5), weekday: '?', day: 0 }; }
}
function renderExpense(){
  const thisMonth=getThisMonth();
  const monthExpenses=expenses.filter(e=>{
    if(!e['日期'])return false;
    try{return getMonth(e['日期'])===thisMonth}catch{return false}
  }).sort((a,b)=>(b['日期']||'')>(a['日期']||'')?1:-1);
const sq=document.getElementById('expenseSearch')?document.getElementById('expenseSearch').value.toLowerCase():'';
const searched=sq?monthExpenses.filter(e=>(e['备注']||'').toLowerCase().includes(sq)||(e['分类']||'').toLowerCase().includes(sq)):monthExpenses;
  const totalOut=searched.filter(e=>e['类型']==='支出').reduce((s,e)=>s+Number(e['金额']||0),0);
  const totalIn=searched.filter(e=>e['类型']==='收入').reduce((s,e)=>s+Number(e['金额']||0),0);
  const net=totalIn-totalOut;
  const budget=getBudget(thisMonth);
  const count=searched.length;
  const catMap={};
  searched.filter(e=>e['类型']==='支出').forEach(e=>{const c=e['分类']||'其他';catMap[c]=(catMap[c]||0)+Number(e['金额']||0);});
  const catEntries=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
  let html='';
  html+=`<div class="ex-header">
    <div class="ex-total-card ex-out"><div class="ex-total-icon">💸</div><div class="ex-total-info"><div class="ex-total-label">本月支出</div><div class="ex-total-val">¥${totalOut.toFixed(2)}</div></div></div>
    <div class="ex-total-card ex-in"><div class="ex-total-icon">💰</div><div class="ex-total-info"><div class="ex-total-label">本月收入</div><div class="ex-total-val">¥${totalIn.toFixed(2)}</div></div></div>
    <div class="ex-total-card ex-net ${net>=0?'ex-surplus':'ex-deficit'}"><div class="ex-total-icon">📊</div><div class="ex-total-info"><div class="ex-total-label">净收支</div><div class="ex-total-val">¥${net.toFixed(2)}</div></div></div>
    <div class="ex-total-card ex-count"><div class="ex-total-icon">📝</div><div class="ex-total-info"><div class="ex-total-label">笔数</div><div class="ex-total-val">${count}笔</div></div></div>
  </div>`;
  if(budget){
    const used=totalOut;const pct=Math.min(used/budget*100,100);
    const color=used>budget?'var(--red)':used>budget*0.8?'var(--orange)':'var(--green)';
    html+=`<div class="ex-section"><div class="ex-section-title">💰 预算</div>
      <div class="ex-budget"><div class="ex-budget-header"><span>已用 ¥${used.toFixed(0)}</span><span>预算 ¥${budget}</span></div>
      <div class="ex-budget-bar"><div class="ex-budget-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="ex-budget-footer"><span>${pct.toFixed(0)}%</span><span style="color:${color}">剩余 ¥${Math.max(budget-used,0).toFixed(0)}</span></div></div></div>`;
  }
  if(catEntries.length){
    html+=`<div class="ex-section"><div class="ex-section-title">📂 支出分类</div><div class="ex-chart-area">${donutChart(catEntries,170,'支出')}${donutLegend(catEntries,totalOut)}</div></div>`;
  }
  const dayGroups={};
  searched.forEach(e=>{let day='未知日期';if(e['日期']){try{day=e['日期'].slice(0,10)}catch{}}if(!dayGroups[day])dayGroups[day]=[];dayGroups[day].push(e);});
  html+=`<div class="ex-section"><div class="ex-section-title">📅 消费记录</div><div class="ex-timeline">`;
  if(!searched.length) html+=`<div class="ex-empty"><div class="ex-empty-icon">💰</div><div class="ex-empty-text">本月暂无记账</div><div class="ex-empty-hint">点右下角 + 记一笔</div></div>`;
  for(const[day,list]of Object.entries(dayGroups)){
    const dayTotal=list.filter(e=>e['类型']==='支出').reduce((s,e)=>s+Number(e['金额']||0),0);
    const {date,weekday,day:dayNum}=formatDay(day);
    html+=`<div class="ex-day"><div class="ex-day-marker"><div class="ex-day-circle">${dayNum||'?'}</div><div class="ex-day-line"></div></div>
      <div class="ex-day-content"><div class="ex-day-header"><span class="ex-day-date">${date} ${weekday}</span><span class="ex-day-total">-¥${dayTotal.toFixed(2)}</span></div>`;
    list.forEach(e=>{
      const isOut=e['类型']==='支出';
      const cc=CAT_COLORS[e['分类']||'其他']||'#94a3b8';
      // ===== 图片显示 =====
// kv:前缀 -> KV key -> /api/images?key=xxx
// 无kv:前缀 -> base64直接显示（旧数据兼容）
const imgSrc=e['图片']&&e['图片'].startsWith('kv:')?'/api/images?key='+encodeURIComponent(e['图片'].slice(3)):e['图片'];
      const thumbHtml=imgSrc?`<img class="ex-thumb" src="${imgSrc}" onclick="event.stopPropagation();showFullscreenImg(this.src)">`:'';
      html+=`<div class="ex-entry" style="border-left:4px solid ${cc}">${thumbHtml}<div class="ex-entry-icon">${CAT_ICONS[e['分类']||'其他']||'📌'}</div>
        <div class="ex-entry-info"><div class="ex-entry-cat">${esc(e['分类']||'其他')}</div>${e['日期']&&e['日期'].includes('T')?`<div class="ex-entry-note" style="color:var(--pri);font-weight:600;font-size:11px">🕐 ${e['日期'].slice(11,16)}</div>`:''}${e['备注']?`<div class="ex-entry-note">${esc(e['备注'])}</div>`:''}</div>
        <div class="ex-entry-amount ${isOut?'ex-amount-out':'ex-amount-in'}">${isOut?'-':'+'}¥${Number(e['金额']||0).toFixed(2)}</div>
        <button class="ex-entry-del" style="opacity:.25" onclick="openExpenseModal('${e.id}')" title="编辑">✏️</button><button class="ex-entry-del" onclick="delExpense('${e.id}')" title="删除">🗑️</button></div>`;
    });
    html+=`</div></div>`;
  }
  html+=`</div></div>`;
  document.getElementById('expenseContent').innerHTML=html;
}
;
function barChart(entries, maxVal, colorFn) {
  if (!entries.length) return '';
  const max = maxVal || Math.max(...entries.map(e => e[1]));
  return entries.map(([label, val]) => {
    const pct = max > 0 ? (val / max * 100) : 0;
    const color = colorFn ? colorFn(label) : 'var(--pri)';
    return `<div class="chart-row"><span class="chart-label">${label}</span><div class="chart-bar-bg"><div class="chart-bar-fill" style="width:${pct}%;background:${color}"></div></div><span class="chart-val">¥${val.toFixed(0)}</span></div>`;
  }).join('');
}
function donutChart(entries, size, label) {
  if (!entries.length) return '<div class="empty-chart">暂无数据</div>';
  const total = entries.reduce((s, e) => s + e[1], 0);
  const cx = size / 2, cy = size / 2;
  const t = Math.max(size * 0.14, 14);
  const r = (size - t) / 2;
  const C = 2 * Math.PI * r;
  let segs = '', cum = 0;
  entries.forEach(([l, v]) => {
    if (v <= 0) return;
    const pct = v / total;
    const L = pct * C;
    const color = CAT_COLORS[l] || '#94a3b8';
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${t}"
      stroke-dasharray="${L} ${C - L}" stroke-dashoffset="${-cum}"
      transform="rotate(-90 ${cx} ${cy})" class="donut-seg"/>`;
    cum += L;
  });
  return `<div class="donut-wrap"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${t}"/>
    ${segs}
    <text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="${size*0.12}" font-weight="800" fill="var(--text)">¥${total.toFixed(0)}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="var(--muted)">${label||'总计'}</text>
  </svg></div>`;
}
function donutLegend(entries, total) {
  return `<div class="donut-legend">${entries.map(([l, v]) => {
    const pct = total ? (v / total * 100).toFixed(1) : 0;
    return `<div class="dl-item"><span class="dl-dot" style="background:${CAT_COLORS[l]||'#94a3b8'}"></span><span class="dl-label">${l}</span><span class="dl-bar"><span class="dl-fill" style="width:${pct}%;background:${CAT_COLORS[l]||'#94a3b8'}"></span></span><span class="dl-val">¥${v.toFixed(0)}</span><span class="dl-pct">${pct}%</span></div>`;
  }).join('')}</div>`;
}
function miniCards(items) {
  return `<div class="mini-grid">${items.map(([icon, label, val, color]) => 
    `<div class="mini-card"><div class="mini-icon">${icon}</div><div class="mini-val" style="color:${color||'var(--text)'}">${val}</div><div class="mini-lbl">${label}</div></div>`
  ).join('')}</div>`;
}
function renderStats() {
  const thisMonth = getThisMonth();
  const budget = getBudget(thisMonth);
  // ===== 采购数据 =====
  const monthItems = items.filter(i => getMonth(i['日期']) === thisMonth && i['状态'] !== '已退');
  const monthTotal = monthItems.reduce((s, i) => s + (i['单价'] || 0) * (i['数量'] || 1), 0);
  const totalAll = items.filter(i => i['状态'] !== '已退').reduce((s, i) => s + (i['单价'] || 0) * (i['数量'] || 1), 0);
  const pCatMap = {};
  monthItems.forEach(i => { const c = i['分类'] || '其他'; pCatMap[c] = (pCatMap[c] || 0) + (i['单价'] || 0) * (i['数量'] || 1); });
  const pCatEntries = Object.entries(pCatMap).sort((a, b) => b[1] - a[1]);
  const pPlatMap = {};
  monthItems.forEach(i => { const p = i['平台'] || '其他'; pPlatMap[p] = (pPlatMap[p] || 0) + (i['单价'] || 0) * (i['数量'] || 1); });
  const pPlatEntries = Object.entries(pPlatMap).sort((a, b) => b[1] - a[1]);
  const statusMap = {};
  items.forEach(i => { const s = i['状态'] || '待审批'; statusMap[s] = (statusMap[s] || 0) + 1; });
  // ===== 记账数据 =====
  const monthExpenses = expenses.filter(e => {
    if (!e['日期']) return false;
    try { return getMonth(e['日期']) === thisMonth } catch { return false }
  });
  // 统计不受搜索过滤，直接用月度全量数据
  const searched = monthExpenses;
  const totalOut = searched.filter(e => e['类型'] === '支出').reduce((s, e) => s + Number(e['金额'] || 0), 0);
  const totalIn = searched.filter(e => e['类型'] === '收入').reduce((s, e) => s + Number(e['金额'] || 0), 0);
  const eCatMap = {};
  searched.filter(e => e['类型'] === '支出').forEach(e => { const c = e['分类'] || '其他'; eCatMap[c] = (eCatMap[c] || 0) + Number(e['金额'] || 0); });
  const eCatEntries = Object.entries(eCatMap).sort((a, b) => b[1] - a[1]);
  // ===== 总览 =====
  let html = '';
  // --- 总览卡片 ---
  html += `<div class="stat-card" style="background:var(--pri-g);color:#fff;border:none">
    <h3 style="color:#fff">📊 本月总览</h3>
    ${miniCards([
      ['🛒', '采购', '¥' + monthTotal.toFixed(0), 'var(--pri)'],
      ['💸', '支出', '¥' + totalOut.toFixed(0), '#fca5a5'],
      ['💰', '收入', '¥' + totalIn.toFixed(0), '#86efac'],
      ['📈', '结余', '¥' + (totalIn - totalOut - monthTotal).toFixed(0), '#fde68a']
    ])}
  </div>`;
  // --- 采购统计 ---
  html += `<div class="stat-card"><h3>🛒 采购统计</h3>`;
  html += miniCards([
    ['📦', '本月', monthItems.length + '件', ''],
    ['💵', '本月花费', '¥' + monthTotal.toFixed(0), 'var(--pri)'],
    ['📊', '总花费', '¥' + totalAll.toFixed(0), 'var(--muted)'],
    ['🗄️', '已归档', (statusMap['已归档'] || 0) + '件', 'var(--muted)']
  ]);
  if (budget) {
    const pct = Math.min(monthTotal / budget * 100, 100);
    const color = monthTotal > budget ? 'var(--red)' : monthTotal > budget * 0.8 ? 'var(--orange)' : 'var(--green)';
    html += `<div style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:4px"><span>💰 预算</span><span>¥${monthTotal.toFixed(0)} / ¥${budget}</span></div>
      <div class="budget-bar"><div class="budget-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="budget-label"><span>${pct.toFixed(0)}% 已用</span><span>剩余 ¥${Math.max(budget - monthTotal, 0).toFixed(0)}</span></div>
    </div>`;
  }
  if (pCatEntries.length) {
    html += `<div style="margin-top:14px"><div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px">📂 分类</div>${barChart(pCatEntries, null, l => CAT_COLORS[l] || '#94a3b8')}</div>`;
  }
  if (pPlatEntries.length) {
    html += `<div style="margin-top:14px"><div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px">🏪 平台</div>${barChart(pPlatEntries, null, () => 'var(--pri)')}</div>`;
  }
  html += '</div>';
  // --- 记账统计 ---
  html += `<div class="stat-card"><h3>💰 记账统计</h3>`;
  html += miniCards([
    ['💸', '本月支出', '¥' + totalOut.toFixed(0), 'var(--red)'],
    ['💰', '本月收入', '¥' + totalIn.toFixed(0), 'var(--green)'],
    ['📊', '净收支', '¥' + (totalIn - totalOut).toFixed(0), totalIn - totalOut >= 0 ? 'var(--green)' : 'var(--red)'],
    ['📝', '笔数', searched.length + '笔', '']
  ]);
  if (eCatEntries.length) {
    html += `<div class="stat-card"><h3>💰 记账分类</h3><div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;justify-content:center">
      ${donutChart(eCatEntries, 180, '支出')}${donutLegend(eCatEntries, totalOut)}
    </div></div>`;
  }
  html += '</div>';
  // --- 采购明细 ---
  if (items.length) {
    html += `<div class="stat-card"><h3>📈 采购明细</h3><div style="font-size:12px;color:var(--muted);margin-bottom:10px">各状态占比</div>`;
    const totalItems = items.length;
    Object.entries(statusMap).forEach(([s, n]) => {
      const pct = (n / totalItems * 100).toFixed(0);
      const cls = 'badge-' + s;
      html += `<div class="cat-row"><span class="badge ${cls}" style="min-width:40px">${s}</span><div class="cat-bar"><div class="cat-bar-fill" style="width:${pct}%;background:${s === '待审批' ? 'var(--orange)' : s === '已审批' ? 'var(--blue)' : s === '已下单' ? '#8b5cf6' : s === '已到' ? 'var(--green)' : s === '已归档' ? '#6b7280' : 'var(--red)'}"></div></div><span style="min-width:50px;text-align:right;font-weight:700">${n}件 (${pct}%)</span></div>`;
    });
    html += '</div>';
  }
  document.getElementById('statsContent').innerHTML = html;
}

// ===== Tab 切换 =====
function switchTab(t){
  currentTab=t;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelector(`.tab:nth-child(${t==='purchase'?1:t==='expense'?2:3})`).classList.add('active');
  document.getElementById('tab-purchase').style.display=t==='purchase'?'':'none';
  document.getElementById('tab-expense').style.display=t==='expense'?'':'none';
  document.getElementById('tab-stats').style.display=t==='stats'?'':'none';
  document.getElementById('fabBtn').style.display=(t==='purchase'||t==='expense')?'':'none';
  document.getElementById('headerActions').style.display=t==='purchase'?'':'none';
  render();
}

// ===== 采购操作 =====
function toggleBatch(){batchMode=!batchMode;selectedIds.clear();document.getElementById('batchBar').classList.toggle('show',batchMode);document.getElementById('batchInfo').textContent='已选 0 项';render()}
function toggleSelect(id){if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);document.getElementById('batchInfo').textContent=`已选 ${selectedIds.size} 项`;render()}
async function batchUpdate(){if(!selectedIds.size)return toast('请先选择商品');const status=document.getElementById('batchStatus').value;const ids=[...selectedIds];toast(`正在更新 ${ids.length} 项...`);await api('PATCH',{ids,status});toast(`已更新 ${ids.length} 项为"${status}"`);selectedIds.clear();toggleBatch();await loadAll()}
async function batchDelete(){if(!selectedIds.size)return;if(!confirm(`确定删除选中的 ${selectedIds.size} 项？`))return;const ids=[...selectedIds];let ok=0;for(const id of ids){try{await api('DELETE',null,id);ok++}catch{}}toast(`已删除 ${ok} 项`);selectedIds.clear();toggleBatch();await loadAll()}
function openModal(){document.getElementById('editId').value='';document.getElementById('modalTitle').textContent='新增采购';['fName','fPrice','fQty','fNote','fDate'].forEach(x=>document.getElementById(x).value='');document.getElementById('fPlatform').value='拼多多';document.getElementById('fCategory').value='日用';document.getElementById('fStatus').value='待审批';document.getElementById('fQty').value='1';document.getElementById('overlay').classList.add('active')}
function editItem(id){const i=items.find(x=>x.id===id);if(!i)return;document.getElementById('editId').value=id;document.getElementById('modalTitle').textContent='编辑采购';document.getElementById('fName').value=i['商品名称']||'';document.getElementById('fPlatform').value=i['平台']||'拼多多';document.getElementById('fCategory').value=i['分类']||'日用';document.getElementById('fPrice').value=i['单价']||'';document.getElementById('fQty').value=i['数量']||1;document.getElementById('fStatus').value=i['状态']||'待审批';const d=i['日期'];document.getElementById('fDate').value=d?new Date(d).toISOString().slice(0,10):'';document.getElementById('fNote').value=i['备注']||'';document.getElementById('overlay').classList.add('active')}
function closeModal(){document.getElementById('overlay').classList.remove('active')}
async function save(){const name=document.getElementById('fName').value.trim();if(!name){alert('请输入商品名称');return}const data={name,platform:document.getElementById('fPlatform').value,category:document.getElementById('fCategory').value,price:parseFloat(document.getElementById('fPrice').value)||0,qty:parseInt(document.getElementById('fQty').value)||1,status:document.getElementById('fStatus').value,date:document.getElementById('fDate').value||null,note:document.getElementById('fNote').value.trim()||null};const editId=document.getElementById('editId').value;if(editId){await api('PUT',{id:editId,...data});toast('已更新')}else{await api('POST',data);toast('已添加')}closeModal();await loadAll()}
async function delItem(id){if(!confirm('确定删除？'))return;await api('DELETE',null,id);toast('已删除');await loadAll()}

// ===== 审批流操作 =====
const NEXT_STATUS={'待审批':'已审批','已审批':'已下单','已下单':'已到'};
const APPROVAL_TITLES={'待审批':'✅ 审批确认','已审批':'🛒 确认下单','已下单':'📦 确认收货'};
const APPROVAL_TEXTS={'待审批':'确认审批通过？通过后状态变为“已审批”','已审批':'确认下单？通过后状态变为“已下单”','已下单':'确认收货？通过后状态变为“已到”'};
function showApprovalModal(id){
  const item=items.find(x=>x.id===id);
  if(!item)return;
  const status=item['状态']||'待审批';
  const next=NEXT_STATUS[status];
  if(!next)return;
  const qty=Number(item['数量'])||1;
  const price=Number(item['单价'])||0;
  const total=price*qty;
  document.getElementById('approvalTitle').textContent=APPROVAL_TITLES[status]||'确认操作';
  document.getElementById('approvalContent').innerHTML=`
    <div style="font-size:15px;font-weight:700;margin-bottom:12px">${esc(item['商品名称']||'')}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:4px">单价 ¥${price.toFixed(2)} × ${qty}</div>
    <div style="font-size:20px;font-weight:800;color:var(--pri);margin-bottom:16px">总价 ¥${total.toFixed(2)}</div>
    <div style="font-size:14px;font-weight:600;color:var(--orange)">${APPROVAL_TEXTS[status]}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:6px">${status} → ${next}</div>
  `;
  const btn=document.getElementById('approvalConfirmBtn');
  btn.onclick=async function(){
    await api('PATCH',{ids:[id],status:next});
    toast(`已更新为“${next}”`);
    closeApprovalModal();
    await loadAll();
  };
  document.getElementById('approvalOverlay').classList.add('active');
}
function closeApprovalModal(){document.getElementById('approvalOverlay').classList.remove('active')}

// ===== 记账操作 =====
function openExpenseModal(id){const m=document.getElementById('expenseModalTitle');const eid=document.getElementById('eEditId');currentImageData='';const preview=document.getElementById('eImagePreview');if(id){const e=expenses.find(x=>x.id===id);if(!e)return;m.textContent='✏️ 编辑记账';eid.value=id;document.getElementById('eAmount').value=Number(e['金额']||0);document.getElementById('eNote').value=e['备注']||'';document.getElementById('eType').value=e['类型']||'支出';document.getElementById('eCategory').value=e['分类']||'餐饮';let d='';if(e['日期']){try{const dt=new Date(e['日期'].includes('T')?e['日期']:e['日期']+'T00:00:00+08:00');const pad=n=>String(n).padStart(2,'0');d=dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate())+'T'+pad(dt.getHours())+':'+pad(dt.getMinutes())}catch{}}document.getElementById('eDate').value=d;if(e['图片']&&e['图片'].startsWith('kv:')){const k=e['图片'].slice(3);currentImageKey=k;currentImageData='';preview.src='/api/images?key='+encodeURIComponent(k);preview.style.display='block'}else if(e['图片']){currentImageData=e['图片'];currentImageKey='';preview.src=e['图片'];preview.style.display='block'}else{preview.src='';preview.style.display='none';const info=document.getElementById('imageSizeInfo');info.textContent='';info.style.display='none'}}else{m.textContent='💰 记一笔';eid.value='';document.getElementById('eAmount').value='';document.getElementById('eNote').value='';document.getElementById('eType').value='支出';document.getElementById('eCategory').value='餐饮';const now=new Date(Date.now()+8*3600*1000);const pad=n=>String(n).padStart(2,'0');document.getElementById('eDate').value=now.getUTCFullYear()+'-'+pad(now.getUTCMonth()+1)+'-'+pad(now.getUTCDate())+'T'+pad(now.getUTCHours())+':'+pad(now.getUTCMinutes());preview.src='';preview.style.display='none';const info=document.getElementById('imageSizeInfo');info.textContent='';info.style.display='none'}document.getElementById('eCameraInput').value='';document.getElementById('eGalleryInput').value='';document.getElementById('expenseOverlay').classList.add('active')}
function closeExpenseModal(){document.getElementById('expenseOverlay').classList.remove('active')}
function exportExpenses(){const lines=['日期\t时间\t类型\t分类\t金额\t备注'];expenses.forEach(e=>{const ds=e['日期']||'';const datePart=ds.slice(0,10);const timePart=ds.includes('T')?ds.slice(11,16):'';lines.push(datePart+'\t'+timePart+'\t'+(e['类型']||'')+'\t'+(e['分类']||'')+'\t¥'+(Number(e['金额']||0).toFixed(2))+'\t'+(e['备注']||''))});const b=new Blob([lines.join('\n')],{type:'text/tab-separated-values;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='记账_'+getThisMonth()+'.tsv';a.click()}
// 图片: kv:前缀=KV key存飞书图片字段; 无前缀=base64（回退）
async function saveExpense(){const amount=parseFloat(document.getElementById('eAmount').value);if(!amount||amount<=0){alert('请输入金额');return}const data={type:document.getElementById('eType').value,category:document.getElementById('eCategory').value,amount,date:document.getElementById('eDate').value,note:document.getElementById('eNote').value.trim()};if(currentImageData){try{toast('正在上传图片...');const uploadRes=await fetch('/api/images',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':getPin()},body:JSON.stringify({image:currentImageData})});const uploadData=await uploadRes.json();if(uploadData.key){data.imageKey=uploadData.key;data.image=currentImageData}else{data.image=currentImageData;}}catch(e){data.image=currentImageData;}}else if(currentImageKey){data.imageKey=currentImageKey;}const eid=document.getElementById('eEditId').value;let res;if(eid){res=await expenseApi('PUT',{id:eid,...data});if(res&&res.error){alert('更新失败: '+res.error);return}toast('已更新')}else{res=await expenseApi('POST',data);if(res&&res.error){alert('记录失败: '+res.error);return}toast('已记录')}currentImageData='';currentImageKey='';closeExpenseModal();await loadAll()}
async function delExpense(id){if(!confirm('确定删除？'))return;await expenseApi('DELETE',null,id);toast('已删除');await loadAll()}

// ===== 预算 =====
function openBudgetModal(){const m=getThisMonth();document.getElementById('budgetMonth').value=m;document.getElementById('budgetInput').value=getBudget(m)||'';document.getElementById('budgetOverlay').classList.add('active')}
function closeBudgetModal(){document.getElementById('budgetOverlay').classList.remove('active')}
function saveBudget(){const month=document.getElementById('budgetMonth').value;const val=parseFloat(document.getElementById('budgetInput').value)||0;if(!month)return alert('请选择月份');const b=getBudgets();b[month]=val;setBudgets(b);toast(`已设置 ${month} 预算 ¥${val}`);closeBudgetModal();render()}

// ===== FAB 点击 =====
document.getElementById('fabBtn').addEventListener('click',()=>{
  if(currentTab==='purchase') openModal();
  else if(currentTab==='expense') openExpenseModal();
});

// ===== 导出 =====
function exportData(){const lines=['商品\t平台\t分类\t单价\t数量\t总价\t状态\t日期\t备注'];items.forEach(i=>{const qty=i['数量']||1;const price=i['单价']||0;let ds='';if(i['日期']){try{ds=new Date(i['日期']).toISOString().slice(0,10)}catch{}}lines.push(`${i['商品名称']||''}\t${i['平台']||''}\t${i['分类']||''}\t¥${price}\t${qty}\t¥${(price*qty).toFixed(2)}\t${i['状态']||''}\t${ds}\t${i['备注']||''}`)});const b=new Blob([lines.join('\n')],{type:'text/tab-separated-values;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`采购_${getThisMonth()}.tsv`;a.click()}

// ===== 详情弹窗 =====
const STEPPER_STEPS=['待审批','已审批','已下单'];
const STEPPER_ICONS={'待审批':'📋','已审批':'✅','已下单':'🛒','已到':'📦','已退':'↩️','已归档':'🗄️'};
const STEP_TIME_FIELDS={'待审批':'创建时间','已审批':'审批时间','已下单':'下单时间','已到':'到货时间','已退':'到货时间','已归档':'归档时间'};
const STEP_BTN_CONFIG={
  '待审批':{color:'var(--green)',label:'✅ 审批通过',next:'已审批'},
  '已审批':{color:'var(--blue)',label:'🛒 确认下单',next:'已下单'}
};
function openDetailModal(id){
  const item=items.find(x=>x.id===id);
  if(!item)return;
  const qty=Number(item['数量'])||1;
  const price=Number(item['单价'])||0;
  const total=price*qty;
  const status=item['状态']||'待审批';
  const statusIdx=STEPPER_STEPS.indexOf(status);
  let ds='';
  if(item['日期']){try{ds=new Date(item['日期']).toISOString().slice(0,10)}catch{}}

  let html=`<div class="detail-header">
    <div class="detail-title">${esc(item['商品名称']||'')}</div>
    <div class="detail-price">¥${price.toFixed(2)}${qty>1?` × ${qty} = ¥${total.toFixed(2)}`:''}</div>
    <div class="detail-meta">
      <span>🏪 ${esc(item['平台']||'')}</span>
      <span class="badge badge-${status}">${status}</span>
      <span class="cat-badge">${item['分类']||'其他'}</span>
      ${ds?`<span>📅 ${ds}</span>`:''}
    </div>
    ${item['备注']?`<div style="font-size:13px;color:var(--muted);margin-top:8px">💬 ${esc(item['备注'])}</div>`:''}
  </div>`;

  // Stepper: always show full flow 待审批→已审批→已下单→已到/已退→已归档
  const branchLabel = status==='已退' ? '已退' : '已到';
  const mainSteps = ['待审批','已审批','已下单'];
  const branchDone = status==='已到' || status==='已退';
  const archiveDone = status==='已归档';

  // Build full step list
  const allSteps = [];
  mainSteps.forEach(s => {
    const isDone = status==='已到'||status==='已退'||status==='已归档' || mainSteps.indexOf(s) < mainSteps.indexOf(status);
    const isCur = s===status;
    allSteps.push({ key:s, done:isDone, active:isCur });
  });
  // Branch step
  allSteps.push({ key:branchLabel, done:branchDone, active:status===branchLabel });
  // Archive step
  allSteps.push({ key:'已归档', done:archiveDone, active:status==='已归档' });

  html+=`<div class="detail-section-title">📋 审批流程</div><div class="stepper">`;
  allSteps.forEach((s, idx) => {
    const isLast = idx === allSteps.length - 1;
    let stepClass = 'step-pending';
    let dotContent = '⚪';
    let timeText = '—';
    if (s.done) {
      stepClass = 'step-done';
      dotContent = '✓';
      const tf = STEP_TIME_FIELDS[s.key];
      if (tf && item[tf]) timeText = item[tf];
      else if (s.key==='待审批' && item['创建时间']) timeText = item['创建时间'];
    } else if (s.active) {
      stepClass = 'step-active';
      dotContent = STEPPER_ICONS[s.key] || '🔵';
      const tf = STEP_TIME_FIELDS[s.key];
      if (tf && item[tf]) timeText = item[tf];
      else if (s.key==='待审批' && item['创建时间']) timeText = item['创建时间'];
      else timeText = '进行中...';
    }
    html+=`<div class="step-item ${stepClass}">
      <div class="step-dot-wrap">
        <div class="step-dot">${dotContent}</div>
        ${!isLast?'<div class="step-line"></div>':''}
      </div>
      <div class="step-info">
        <div class="step-name">${s.key}</div>
        <div class="step-time">${timeText}</div>
      </div>
    </div>`;
  });
  html+='</div>';

  // 操作按钮
  if(status==='待审批'||status==='已审批'){
    const btnCfg=STEP_BTN_CONFIG[status];
    html+=`<div style="margin-top:16px"><button class="detail-action-btn" style="background:${btnCfg.color}" onclick="doDetailModalAction('${id}','${btnCfg.next}')">${btnCfg.label}</button></div>`;
  }else if(status==='已下单'){
    html+=`<div style="margin-top:16px;display:flex;gap:10px">
      <button class="detail-action-btn" style="background:var(--green);flex:1" onclick="doDetailModalAction('${id}','已到')">📦 确认收货</button>
      <button class="detail-action-btn" style="background:var(--red);flex:1" onclick="doDetailModalAction('${id}','已退')">↩️ 退货归档</button>
    </div>`;
  }else if(status==='已到'||status==='已退'){
    html+=`<div style="margin-top:16px"><button class="detail-action-btn" style="background:var(--pri)" onclick="doDetailModalAction('${id}','已归档')">🗄️ 确认归档</button></div>`;
  }

  document.getElementById('detailContent').innerHTML=html;
  document.getElementById('detailOverlay').classList.add('active');
}
function closeDetailModal(){document.getElementById('detailOverlay').classList.remove('active')}
function doDetailModalAction(id,nextStatus){
  if(!confirm('确认执行此操作？'))return;
  // Optimistic update: update local state immediately
  const item=items.find(x=>x.id===id);
  if(item){
    item['状态']=nextStatus;
    const now=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,16).replace('T',' ');
    if(nextStatus==='已审批')item['审批时间']=now;
    else if(nextStatus==='已下单')item['下单时间']=now;
    else if(nextStatus==='已到'||nextStatus==='已退')item['到货时间']=now;
    else if(nextStatus==='已归档')item['归档时间']=now;
    toast(`已更新为"${nextStatus}"`);
    closeDetailModal();
    render();
  }
  // Fire PATCH in background, don't block UI
  api('PATCH',{ids:[id],status:nextStatus}).then(r=>{
    if(r&&r.error){toast('同步失败，请刷新');loadAll();}
  }).catch(()=>{toast('网络错误，请刷新');loadAll();});
}

loadAll();
