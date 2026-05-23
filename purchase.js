function render(){
  if(currentTab==='purchase') renderPurchase();
  else if(currentTab==='expense') renderExpense();
  else if(currentTab==='stats') renderStats();
  updateHeader();
}
function updateHeader(){
  const total=totalCost(items);
  const thisMonth=getThisMonth();
  const monthItems=items.filter(i=>getMonth(i['日期'])===thisMonth);
  const returnedCost=monthItems.filter(i=>i['状态']==='已退').reduce((s,i)=>s+(i['单价']||0)*(i['数量']||1),0);
  const monthTotal=totalCost(monthItems)-returnedCost;
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
    html+=`<div class="swipe-container"><div class="swipe-actions swipe-actions-right"><span>→ 下一步</span></div><div class="swipe-actions swipe-actions-left"><span>🗑️ 删除</span></div><div class="card ${ck?'selected':''} swipe-card" style="border-left:4px solid ${bc}" data-id="${i.id}" data-type="purchase" onclick="${batchMode?`toggleSelect('${i.id}')`:`openDetailModal('${i.id}')`}"><div class="checkbox ${ck?'checked':''}" onclick="event.stopPropagation();toggleSelect('${i.id}')">${ck?'✓':''}</div><div class="actions"><button onclick="event.stopPropagation();editItem('${i.id}')" title="编辑">✏️</button><button onclick="event.stopPropagation();delItem('${i.id}')" title="删除">🗑️</button></div><div class="top"><div class="name">${esc(i['商品名称']||'')}</div>${price?`<div class="price">¥${(price*qty).toFixed(2)}</div>`:''}</div><div class="meta"><span>🏪 ${esc(i['平台']||'')}</span><span class="badge badge-${status}">${status}</span><span class="cat-badge">${cat}</span>${ds?`<span>📅 ${ds}</span>`:''}${qty>1?`<span>×${qty}</span>`:''}</div>${i['备注']?`<div class="note">💬 ${esc(i['备注'])}</div>`:''}${tsHtml}</div></div></div>`});
  }
  listEl.innerHTML=html;
}
function toggleBatch(){batchMode=!batchMode;selectedIds.clear();document.getElementById('batchBar').classList.toggle('show',batchMode);document.getElementById('batchInfo').textContent='已选 0 项';render()}
function toggleSelect(id){if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);document.getElementById('batchInfo').textContent=`已选 ${selectedIds.size} 项`;render()}
async function batchUpdate(){if(!selectedIds.size)return toast('请先选择商品');const status=document.getElementById('batchStatus').value;const ids=[...selectedIds];toast(`正在更新 ${ids.length} 项...`);await api('PATCH',{ids,status});toast(`已更新 ${ids.length} 项为"${status}"`);selectedIds.clear();toggleBatch();await loadAll()}
async function batchDelete(){if(!selectedIds.size)return;if(!confirm(`确定删除选中的 ${selectedIds.size} 项？`))return;const ids=[...selectedIds];let ok=0;for(const id of ids){try{await api('DELETE',null,id);ok++}catch{}}toast(`已删除 ${ok} 项`);selectedIds.clear();toggleBatch();await loadAll()}
function openModal(){document.getElementById('editId').value='';document.getElementById('modalTitle').textContent='新增采购';['fName','fPrice','fQty','fNote','fDate'].forEach(x=>document.getElementById(x).value='');document.getElementById('fPlatform').value='拼多多';document.getElementById('fCategory').value='日用';document.getElementById('fStatus').value='待审批';document.getElementById('fQty').value='1';document.getElementById('overlay').classList.add('active')}
function editItem(id){const i=items.find(x=>x.id===id);if(!i)return;document.getElementById('editId').value=id;document.getElementById('modalTitle').textContent='编辑采购';document.getElementById('fName').value=i['商品名称']||'';document.getElementById('fPlatform').value=i['平台']||'拼多多';document.getElementById('fCategory').value=i['分类']||'日用';document.getElementById('fPrice').value=i['单价']||'';document.getElementById('fQty').value=i['数量']||1;document.getElementById('fStatus').value=i['状态']||'待审批';const d=i['日期'];document.getElementById('fDate').value=d?new Date(d).toISOString().slice(0,10):'';document.getElementById('fNote').value=i['备注']||'';document.getElementById('overlay').classList.add('active')}
function closeModal(){document.getElementById('overlay').classList.remove('active')}
async function save(){const name=document.getElementById('fName').value.trim();if(!name){alert('请输入商品名称');return}const data={name,platform:document.getElementById('fPlatform').value,category:document.getElementById('fCategory').value,price:parseFloat(document.getElementById('fPrice').value)||0,qty:parseInt(document.getElementById('fQty').value)||1,status:document.getElementById('fStatus').value,date:document.getElementById('fDate').value||null,note:document.getElementById('fNote').value.trim()||null};const editId=document.getElementById('editId').value;if(editId){await api('PUT',{id:editId,...data});toast('已更新')}else{await api('POST',data);toast('已添加')}closeModal();await loadAll()}
async function delItem(id){if(!confirm('确定删除？'))return;await api('DELETE',null,id);toast('已删除');await loadAll()}
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
  const branchDone = status==='已到' || status==='已退' || status==='已归档';
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
setupPullToRefresh();
setupSwipe();
