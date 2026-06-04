// app.js - App Init, Core Render, Pull-to-Refresh, Events
let items=[], expenses=[];
let currentStatusFilter='全部',currentCatFilter='全部';
let batchMode=false,selectedIds=new Set();
let currentTab='purchase';
let logDateState=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
let expenseViewMode='week';
let currentWeekFilter=-1;
let calYear, calMonth;
let calSelectedDate=null;

// ===== Auth =====
let isLoadingData=false;

// ===== Card Swipe =====
function setupSwipe(){
  document.addEventListener('touchstart',e=>{
    const card=e.target.closest('.swipe-card')||e.target.closest('.card[data-type]');
    if(!card)return;
    // 不拦截按钮点击
    if(e.target.closest('button')||e.target.closest('.card-checkbox'))return;
    swipeEl=card;
    swipeStartX=e.touches[0].clientX;
    swipeStartY=e.touches[0].clientY;
    isSwiping=false;
    swipeDelta=0;
    card.classList.add('swiping');
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!swipeEl)return;
    const dx=e.touches[0].clientX-swipeStartX;
    const dy=e.touches[0].clientY-swipeStartY;
    // 判断方向，只在水平滑动时拦截
    if(!isSwiping&&Math.abs(dy)>Math.abs(dx)){swipeEl.classList.remove('swiping');swipeEl=null;return}
    isSwiping=true;
    swipeDelta=Math.max(-120,Math.min(80,dx));
    swipeEl.style.transform=`translateX(${swipeDelta}px)`;
  },{passive:true});
  document.addEventListener('touchend',async()=>{
    if(!swipeEl)return;
    swipeEl.classList.remove('swiping');
    const card=swipeEl;
    swipeEl=null;
    if(!isSwiping){return}
    isSwiping=false;
    const id=card.dataset.id;
    const type=card.dataset.type; // 'purchase' or 'expense'
    if(swipeDelta<-80){
      // 左滑 → 删除
      card.style.transform='translateX(-100%)';
      card.style.opacity='0';
      card.style.transition='all .25s ease';
      setTimeout(async()=>{
        if(type==='expense') await delExpense(id);
        else await delItem(id);
      },250);
    }else if(swipeDelta>60){
      // 右滑 → 改状态(采购)
      card.style.transform='translateX(0)';
      if(type==='purchase'){
        const item=items.find(x=>x.id===id);
        if(item){
          const status=item['状态']||'待审批';
          const next=NEXT_STATUS[status];
          if(next){
            await api('PATCH',{ids:[id],status:next});
            toast(`已更新为"${next}"`);
            await loadAll();
          }else{toast('已是终态')}
        }
      }else{
        toast('右滑仅支持采购卡片');
      }
    }else{
      card.style.transform='translateX(0)';
    }
  });
}
function showSkeleton(){
  isLoadingData=true;
  const el=document.getElementById(currentTab==='purchase'?'list':currentTab==='expense'?'expenseContent':'statsContent');
  if(!el)return;
  if(currentTab==='purchase') el.innerHTML=skelCards(5);
  else if(currentTab==='expense') el.innerHTML=skelStats()+skelCards(4);
  else el.innerHTML=skelStats()+skelCards(3);
}
function setupPullToRefresh(){
  const wrapper=document.querySelector('.ptr-wrapper');
  if(!wrapper)return;
  const indicator=wrapper.querySelector('.ptr-indicator');
  const spinner=indicator?.querySelector('.ptr-spinner');
  const text=indicator?.querySelector('.ptr-text');
  if(!indicator)return;
  wrapper.addEventListener('touchstart',e=>{
    if(window.scrollY>0||ptrRefreshing)return;
    ptrStartY=e.touches[0].clientY;
    isPulling=true;
  },{passive:true});
  wrapper.addEventListener('touchmove',e=>{
    if(!isPulling)return;
    ptrDist=Math.max(0,e.touches[0].clientY-ptrStartY);
    if(ptrDist>10){
      const pull=Math.min(ptrDist*0.5,60);
      indicator.style.transform=`translateY(${pull}px)`;
      if(spinner)spinner.style.transform=`rotate(${ptrDist*2}deg)`;
      if(text)text.textContent=pull>50?'松手刷新':'下拉刷新';
    }
  },{passive:true});
  wrapper.addEventListener('touchend',async()=>{
    if(!isPulling)return;
    isPulling=false;
    if(ptrDist>50&&!ptrRefreshing){
      ptrRefreshing=true;
      if(spinner){spinner.classList.add('spinning');spinner.style.transform=''}
      if(text)text.textContent='刷新中...';
      indicator.style.transform='translateY(55px)';
      showSkeleton();
      await loadAll();
      if(spinner)spinner.classList.remove('spinning');
      if(text)text.textContent='已刷新';
      setTimeout(()=>{indicator.style.transform='translateY(0)';ptrRefreshing=false},600);
    }else{
      indicator.style.transform='translateY(0)';
    }
    ptrDist=0;
  });
}
async function cleanupOrphanExpenses(){
  try{
    // Delete ALL purchase-related expense records (purchases tracked via items data now)
    var toDelete=expenses.filter(function(e){
      if(!e['备注'])return false;
      var note=e['备注'];
      return note.includes('[采购]')||note.includes('[采购分期]')||note.includes('[分期]');
    });
    if(toDelete.length>0){
      console.log('CLEANUP: deleting '+toDelete.length+' purchase expense records (budget pool model)');
      for(var i=0;i<toDelete.length;i++){
        await expenseApi('DELETE',null,toDelete[i].id);
      }
      expenses=expenses.filter(function(e){return !toDelete.find(function(o){return o.id===e.id})});
    }
  }catch(e){console.error('cleanupOrphanExpenses error:',e)}
}
async function loadAll(){
  var _dbg=document.getElementById('debugBanner');
  function _log(m){console.log('LOADALL:',m);if(_dbg){_dbg.style.display='block';_dbg.innerHTML+='<div style="border-bottom:1px solid rgba(255,255,255,.3);padding:2px 0">'+m+'</div>'}}
  _log('Starting loadAll, pin='+(getPin()?'YES':'NO'));
  try{await loadBudgetFromServer()}catch(e){_log('budget error: '+e.message)}
  showSkeleton();
  try{
    _log('Fetching data...');
    const [r, e] = await Promise.all([api('GET'),expenseApi('GET')]);
    if(r && !r.error && Array.isArray(r)){items = r;_log('Items loaded: '+r.length)}
    else{_log('Items result: '+JSON.stringify(r).substring(0,200))}
    if(e && !e.error && Array.isArray(e)){expenses = e;_log('Expenses loaded: '+e.length)}
    else{_log('Expenses result: '+JSON.stringify(e).substring(0,200))}
  }catch(e){console.error('loadAll fetch error:', e);_log('FETCH ERROR: '+e.message)}
  isLoadingData=false;
  try{await loadRecurringData()}catch(e){_log('recurring error: '+e.message)}
  try{await checkRecurring()}catch(e){console.error('recurring err',e);_log('checkRecurring: '+e.message)}
  try{await checkInstallments()}catch(e){console.error('install err',e);_log('checkInstallments: '+e.message)}
  try{await cleanupOrphanExpenses()}catch(e){console.error('cleanup err',e);_log('cleanup: '+e.message)}
  _log('Rendering, items='+items.length+', expenses='+expenses.length);
  try{render()}catch(e){_log('RENDER ERROR: '+e.message);console.error('render error:',e)}
  _log('loadAll complete');
  setTimeout(function(){
    try{
      var listEl=document.getElementById('list');
      var expEl=document.getElementById('expenseContent');
      var tabP=document.getElementById('tab-purchase');
      var tabE=document.getElementById('tab-expense');
      var authEl=document.getElementById('authScreen');
      _log('DOM: list='+(listEl?listEl.innerHTML.length+'chars':'NULL')+' display='+(listEl?getComputedStyle(listEl).display:'?'));
      _log('DOM: tab-purchase display='+(tabP?getComputedStyle(tabP).display:'?')+' visibility='+(tabP?getComputedStyle(tabP).visibility:'?'));
      _log('DOM: tab-expense display='+(tabE?getComputedStyle(tabE).display:'?'));
      _log('DOM: authScreen display='+(authEl?authEl.style.display:'?'));
      _log('DOM: body scrollHeight='+document.body.scrollHeight+' clientHeight='+document.body.clientHeight);
      if(listEl&&listEl.innerHTML.length>0){
        _log('LIST sample: '+listEl.innerHTML.substring(0,200));
      }
    }catch(e){_log('DOM check error: '+e.message)}
  },500);
}

function render(){
  if(currentTab==='purchase') renderPurchase();
  else if(currentTab==='expense') renderExpense();
  else if(currentTab==='stats') renderStats();
  updateHeader();
  // DEBUG: 在页面顶部显示状态
  // 延迟检测：3秒后再检查一次
}
function updateHeader(){
  var el=document.getElementById('headerStats');
  if(el) el.innerHTML='';
}
function getMonthInstallmentTotal(ym){return items.filter(function(i){var tp=Number(i['分期期数'])||0;var pd=Number(i['分期已还'])||0;var sm=i['分期开始月']||'';if(!sm&&tp>0){var d=i['日期'];if(d){var dd=new Date(typeof d==='number'?d+8*3600000:d);sm=dd.getUTCFullYear()+'-'+String(dd.getUTCMonth()+1).padStart(2,'0')}}if(tp<=0||pd>=tp||!sm)return false;var parts=sm.split('-').map(Number);var tm=ym.split('-').map(Number);var diff=(tm[0]-parts[0])*12+(tm[1]-parts[1]);return diff>=0&&diff<tp}).reduce(function(s,i){var tp=Number(i['分期期数'])||1;var ia=Number(i['分期金额'])||Math.round((Number(i['单价']||0)*Number(i['数量']||1))/tp);return s+ia},0)}
function getMonthPurchaseTotal(ym){return items.filter(function(i){var s=i['状态']||'';return getMonth(i['日期'])===ym&&(s==='已下单'||s==='已到'||s==='已归档')&&s!=='已退'}).reduce(function(s,i){var tp=Number(i['分期期数'])||0;if(tp>0){var ia=Number(i['分期金额'])||Math.round((Number(i['单价']||0)*Number(i['数量']||1))/tp);return s+ia}return s+(Number(i['单价'])||0)*(Number(i['数量'])||1)},0)}
function renderPurchase(){
  const q=document.getElementById('searchInput').value.toLowerCase();
  let f=items;
  if(q)f=f.filter(i=>(i['商品名称']||'').toLowerCase().includes(q)||(i['备注']||'').toLowerCase().includes(q));
  if(currentStatusFilter!=='全部')f=f.filter(i=>i['状态']===currentStatusFilter);
  if(currentCatFilter!=='全部')f=f.filter(i=>i['分类']===currentCatFilter);
  const sorted=[...f].sort((a,b)=>(b['日期']||0)-(a['日期']||0));
  const statuses=['全部','待评估','待审批','已审批','已下单','已到','已退','已归档','已取消'];
  const cats=['全部',...new Set(items.map(i=>i['分类']).filter(Boolean))];
  document.getElementById('statusChips').innerHTML=statuses.map(s=>{const c=s===currentStatusFilter?'active':'';const n=s==='全部'?items.length:items.filter(i=>i['状态']===s).length;return`<div class="chip ${c}" onclick="currentStatusFilter='${s}';render()">${s} ${n}</div>`}).join('')+'<span style="width:1px;background:var(--border);flex-shrink:0"></span>'+cats.map(c=>{const ac=c===currentCatFilter?'active':'';return`<div class="chip ${ac}" data-cat="${escAttr(c)}">${c}</div>`}).join('');
  const listEl=document.getElementById('list');
  if(batchMode)listEl.classList.add('batch-mode');else listEl.classList.remove('batch-mode');
  if(!sorted.length){listEl.innerHTML='<div class="empty"><div class="icon">📦</div>暂无采购记录<br>点右下角 + 添加</div>';return}
  const groups={};sorted.forEach(i=>{const isEval=i['状态']==='待评估';const m=isEval?'待评估':(getMonth(i['日期'])||'未设置日期');if(!groups[m])groups[m]=[];groups[m].push(i)});
  let html='';
  for(const[month,list]of Object.entries(groups)){
    const mt=totalCost(list);const dm=month==='待评估'?'📋 待评估':(month==='未设置日期'?month:month.replace('-','年')+'月');
    html+=`<div class="section-title"><span>${dm}</span><span>¥${mt.toFixed(2)}</span></div>`;
    const statusColors={'待评估':'#f97316','待审批':'#f59e0b','已审批':'#3b82f6','已下单':'#8b5cf6','已到':'#10b981','已退':'#ef4444','已归档':'#6b7280'};const catColors={'日常护理':'#f472b6','生活用品':'#10b981','食品饮料':'#f59e0b','电子产品':'#8b5cf6','运动装备':'#ef4444'};const catEmoji={'日常护理':'🧴','生活用品':'🏠','食品饮料':'🍕','电子产品':'📱','运动装备':'🏃','其他':'📦'};
    list.forEach(i=>{const qty=i['数量']||1;const price=i['单价']||0;const status=i['状态']||'待审批';const cat=i['分类']||'其他';let ds='';if(i['日期']){try{ds=new Date(i['日期']).toISOString().slice(0,10)}catch(e){console.error('loadAll fetch error:', e)}}const ck=selectedIds.has(i.id);const bc=statusColors[status]||'#94a3b8';
    let tsHtml='';if(i['到货时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">⏰ 到货 ${i['到货时间']}</div>`}else if(i['下单时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">⏰ 下单 ${i['下单时间']}</div>`}else if(i['审批时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">⏰ 审批 ${i['审批时间']}</div>`}else if(i['创建时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">创建 ${i['创建时间']}</div>`}
    // 待评估卡片：显示预算+AI摘要
    if(status==='待评估'){const budgetLine=i['预算区间']?'¥'+i['预算区间']:'预算未知';const summaryLine=i['评估摘要']?i['评估摘要'].slice(0,80)+'...':'';
      html+=`<div class="swipe-container"><div class="swipe-actions swipe-actions-right"><span>→ 下一步</span></div><div class="swipe-actions swipe-actions-left"><span>🗑️ 删除</span></div><div class="card ${ck?'selected':''} swipe-card" style="border-left:5px solid ${catColors[cat]||'#0d9488'}" data-id="${i.id}" data-type="purchase" onclick="${batchMode?`toggleSelect('${i.id}')`:`openEvalModal('${i.id}')`}"><div class="checkbox ${ck?'checked':''}" onclick="event.stopPropagation();toggleSelect('${i.id}')">${ck?'✓':''}</div><div class="actions"><button onclick="event.stopPropagation();editItem('${i.id}')" title="编辑">✏️</button><button onclick="event.stopPropagation();delItem('${i.id}')" title="删除">🗑️</button></div><div class="top"><div class="name">${catEmoji[cat]||'📦'} ${esc(i['商品名称']||'')}</div><div class="price" style="color:#f97316">💰 ${budgetLine}</div></div><div class="meta"><span class="badge badge-${status}">${status}</span><span class="cat-badge">${cat}</span></div>${summaryLine?`<div class="note" style="color:var(--muted)">🤖 ${esc(summaryLine)}</div>`:''}</div></div></div>`}
    else{
      html+=`<div class="swipe-container"><div class="swipe-actions swipe-actions-right"><span>→ 下一步</span></div><div class="swipe-actions swipe-actions-left"><span>🗑️ 删除</span></div><div class="card ${ck?'selected':''} swipe-card" style="border-left:5px solid ${catColors[cat]||'#0d9488'}" data-id="${i.id}" data-type="purchase" onclick="${batchMode?`toggleSelect('${i.id}')`:`openDetailModal('${i.id}')`}"><div class="checkbox ${ck?'checked':''}" onclick="event.stopPropagation();toggleSelect('${i.id}')">${ck?'✓':''}</div><div class="actions"><button onclick="event.stopPropagation();editItem('${i.id}')" title="编辑">✏️</button><button onclick="event.stopPropagation();delItem('${i.id}')" title="删除">🗑️</button></div><div class="top"><div class="name">${catEmoji[cat]||'📦'} ${esc(i['商品名称']||'')}</div>${price?`<div class="price">¥${(price*qty).toFixed(2)}</div>`:''}</div><div class="meta"><span>🏪 ${esc(i['平台']||'')}</span><span class="badge badge-${status}">${status}</span><span class="cat-badge">${cat}</span>${ds?`<span>📅 ${ds}</span>`:''}${qty>1?`<span>×${qty}</span>`:''}${(function(){var tp=Number(i['分期期数'])||0;if(tp<=0)return'';var pd=Number(i['分期已还'])||0;if(pd>=tp)return'<span style="color:#10b981">✅ 已结清</span>';var ia=Number(i['分期金额'])||Math.round(((Number(i['单价'])||0)*(Number(i['数量'])||1))/tp);var pa=ia*pd;var tt=(Number(i['单价'])||0)*(Number(i['数量'])||1);return'<span style="color:var(--pri)">¥'+ia+'/期 · 已付¥'+pa+'/¥'+tt+'</span>'})()}</div>${i['备注']?`<div class="note">💬 ${esc(i['备注'])}</div>`:''}${tsHtml}</div></div></div>`}
    });
  }
  listEl.innerHTML=html;
}
function changeLogDate(delta) {
  const parts = logDateState.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2] + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  logDateState = y + '-' + m + '-' + day;
  loadLogs();
}
async function loadLogs(date) {
  if (date) logDateState = date;
  const el = document.getElementById('logList');
  const dateEl = document.getElementById('logDate');
  el.textContent = '加载中...';
  dateEl.textContent = logDateState;
  try {
    const r = await fetch('/api/auth?action=list-logs&date=' + logDateState, {
      headers: { 'Authorization': 'Bearer ' + getPin() }
    });
    const d = await r.json();
    if (!d.ok) { el.textContent = d.error || '加载失败'; return; }
    if (!d.logs.length) { el.textContent = '暂无日志'; return; }

    const actionLabels = {
      'login': '🟢 登录',
      'register': '🆕 注册',
      'logout': '🔴 退出登录',
      'delete_user': '🔴 删除用户',
      'create_invite': '📧 创建邀请码',
      'status_change': '📋 状态变更',
      'export': '📤 导出',
    };

    // 如果是管理员，显示所有用户的日志；否则只显示自己的
    const isAdmin = d.isAdmin;
    const showUsername = isAdmin;

    el.innerHTML = d.logs.map(function(log) {
      const label = actionLabels[log.action] || log.action;
      const time = log.ts.replace('T', ' ').replace('Z', ' UTC').slice(0, 22);
      const usernameHtml = showUsername ? '<span style="font-size:11px;color:var(--muted);margin-left:8px">' + esc(log.username) + '</span>' : '';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<div>' +
          '<span style="font-size:13px">' + label + '</span>' +
          usernameHtml +
          '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + esc(log.details) + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-size:10px;color:var(--muted)">' + time + '</div>' +
          '<div style="font-size:9px;color:var(--muted)">' + esc(log.ip) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    dateEl.textContent = d.date;
  } catch(e) { el.textContent = '加载失败'; }
}
function openLogsPanel() {
  document.getElementById('logsPanel').style.display = 'block';
  loadLogs();
}
function closeLogsPanel() {
  document.getElementById('logsPanel').style.display = 'none';
}
function updateOnlineStatus(){
    if(!navigator.onLine){
      banner.style.display='block';
      setTimeout(()=>banner.style.transform='translateY(0)',10);
    }else{
      banner.style.transform='translateY(-100%)';
      setTimeout(()=>banner.style.display='none',300);
      // 联网后自动刷新数据
      if(typeof loadAll==='function')loadAll();
    }
  }
function openRecurringModal(){
  var overlay=document.getElementById('recurringOverlay');
  if(!overlay){
    overlay=document.createElement('div');
    overlay.id='recurringOverlay';
    overlay.className='modal-overlay';
    overlay.onclick=function(e){if(e.target===this)closeRecurringModal()};
    overlay.innerHTML='<div class="modal" style="max-width:480px;max-height:85vh;overflow-y:auto;-webkit-overflow-scrolling:touch"><h2>📌 固定支出管理</h2><div id="recurringList"></div><div style="margin-top:12px"><button class="btn btn-primary" style="width:100%" onclick="showAddRecurring()">+ 添加固定支出</button></div><div class="btn-row" style="margin-top:12px"><button class="btn btn-secondary" onclick="closeRecurringModal()">关闭</button></div></div>';
    document.body.appendChild(overlay);
  }
  renderRecurringList();
  overlay.classList.add('active');
}
function closeRecurringModal(){
  var el=document.getElementById('recurringOverlay');
  if(el)el.classList.remove('active');
}
function renderRecurringList(){
  var list=document.getElementById('recurringList');
  if(!list)return;
  var recItems=_recurringData.items||[];
  if(!recItems.length){
    list.innerHTML='<div style="text-align:center;padding:20px;color:var(--muted)"><div style="font-size:32px;margin-bottom:8px">📌</div>还没有固定支出<br>添加房租、水电等每月固定开销</div>';
    return;
  }
  var html='';
  recItems.forEach(function(item,idx){
    var statusIcon=item.active?'🟢':'⏸️';
    html+='<div style="background:var(--bg);border-radius:12px;padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:10px">';
    html+='<div style="flex:1"><div style="font-weight:700;font-size:14px">'+statusIcon+' '+esc(item.name)+'</div>';
    html+='<div style="font-size:12px;color:var(--muted);margin-top:2px">¥'+Number(item.amount).toFixed(0)+' · 每月'+item.dayOfMonth+'号 · '+(item.category||'其他')+'</div>';
    if(item.note)html+='<div style="font-size:11px;color:var(--muted);margin-top:2px">'+esc(item.note)+'</div>';
    html+='</div>';
    html+='<div style="display:flex;gap:4px">';
    html+='<button onclick="toggleRecurringActive('+idx+')" style="padding:6px 10px;border:none;background:var(--card);border-radius:8px;font-size:12px;cursor:pointer">'+(item.active?'⏸':'▶')+'</button>';
    html+='<button onclick="editRecurringItem('+idx+')" style="padding:6px 10px;border:none;background:var(--card);border-radius:8px;font-size:12px;cursor:pointer">✏️</button>';
    html+='<button onclick="deleteRecurringItem('+idx+')" style="padding:6px 10px;border:none;background:var(--card);border-radius:8px;font-size:12px;cursor:pointer;color:var(--red)">🗑</button>';
    html+='</div></div>';
  });
  list.innerHTML=html;
}
function showAddRecurring(){
  var name=prompt('固定支出名称 (如: 房租)');
  if(!name)return;
  var amount=parseFloat(prompt('金额 (元)'));
  if(isNaN(amount)||amount<=0)return alert('请输入有效金额');
  var day=parseInt(prompt('每月几号扣款? (1-28)', '1'));
  if(isNaN(day)||day<1||day>28)day=1;
  var cats=['餐饮','交通','购物','娱乐','居住','医疗','教育','其他'];
  var cat=prompt('分类: '+cats.join(', '), '居住');
  if(!cat)cat='其他';
  var note=prompt('备注 (选填)')||'';
  _recurringData.items=_recurringData.items||[];
  _recurringData.items.push({
    id:'rec_'+Date.now(), name:name, amount:amount, category:cat,
    dayOfMonth:day, note:note, active:true, lastGenerated:''
  });
  saveRecurringData();
  renderRecurringList();
  toast('已添加固定支出: '+name);
}
function editRecurringItem(idx){
  var item=(_recurringData.items||[])[idx];
  if(!item)return;
  var amount=parseFloat(prompt('金额 (元)', item.amount));
  if(isNaN(amount)||amount<=0)return;
  var day=parseInt(prompt('每月几号扣款? (1-28)', item.dayOfMonth));
  if(isNaN(day)||day<1||day>28)day=item.dayOfMonth;
  item.amount=amount;
  item.dayOfMonth=day;
  saveRecurringData();
  renderRecurringList();
  toast('已更新');
}
function deleteRecurringItem(idx){
  if(!confirm('确定删除此固定支出?'))return;
  _recurringData.items.splice(idx,1);
  saveRecurringData();
  renderRecurringList();
  toast('已删除');
}
function toggleRecurringActive(idx){
  var item=(_recurringData.items||[])[idx];
  if(!item)return;
  item.active=!item.active;
  saveRecurringData();
  renderRecurringList();
}
function openSettings(){
  document.getElementById('settingsOverlay').classList.add('active');
}
function closeSettings(){
  document.getElementById('settingsOverlay').classList.remove('active');
}
function settingsAction(action){
  closeSettings();
  switch(action){
    case 'darkMode': toggleDarkMode(); break;
    case 'admin': openAdminPanel(); break;
    case 'logs': openLogsPanel(); break;
    case 'help': window.open('/help','_blank'); break;
    case 'export': 
      if(currentTab==='purchase') exportData();
      else if(currentTab==='expense') exportExpenses();
      break;
    case 'batch': toggleBatch(); break;
    case 'budget': openBudgetModal(); break;
    case 'push': setupPush(); break;
    case 'changelog': openChangelog(); break;
    case 'recurring': openRecurringModal(); break;
    case 'logout': logout(); break;
  }
}

setupPullToRefresh();
setupSwipe();

// === App.app namespace exports ===
App.app.setupSwipe = setupSwipe;
App.app.showSkeleton = showSkeleton;
App.app.setupPullToRefresh = setupPullToRefresh;
App.app.cleanupOrphanExpenses = cleanupOrphanExpenses;
App.app.loadAll = loadAll;
App.app.render = render;
App.app.updateHeader = updateHeader;
App.app.renderPurchase = renderPurchase;
App.app.changeLogDate = changeLogDate;
App.app.loadLogs = loadLogs;
App.app.openLogsPanel = openLogsPanel;
App.app.closeLogsPanel = closeLogsPanel;
App.app.updateOnlineStatus = updateOnlineStatus;
App.app.openRecurringModal = openRecurringModal;
App.app.closeRecurringModal = closeRecurringModal;
App.app.renderRecurringList = renderRecurringList;
App.app.showAddRecurring = showAddRecurring;
App.app.editRecurringItem = editRecurringItem;
App.app.deleteRecurringItem = deleteRecurringItem;
App.app.toggleRecurringActive = toggleRecurringActive;
App.app.openSettings = openSettings;
App.app.closeSettings = closeSettings;
App.app.settingsAction = settingsAction;
