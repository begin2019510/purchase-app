// items.js - Purchase CRUD, Batch, Approval, Detail Modal
const STEPPER_STEPS=['待评估','待审批','已审批','已下单'];
const STEPPER_ICONS={'待评估':'🤔','待审批':'📋','已审批':'✅','已下单':'🛒','已到':'📦','已退':'↩️','已归档':'🗄️'};
const STEP_TIME_FIELDS={'待评估':'创建时间','待审批':'创建时间','已审批':'审批时间','已下单':'下单时间','已到':'到货时间','已退':'到货时间','已归档':'归档时间'};
const STEP_BTN_CONFIG={
  '待评估':{color:'var(--green)',label:'📋 提交审批',next:'待审批'},
  '待审批':{color:'var(--green)',label:'✅ 审批通过',next:'已审批'},
  '已审批':{color:'var(--blue)',label:'🛒 确认下单',next:'已下单'}
};
const CANCELABLE_STATUSES = ['待评估','待审批','已审批'];
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
  ${item['图片']?`<div style="margin-top:8px"><img src="${item['图片'].startsWith('kv:')?'/api/images?key='+encodeURIComponent(item['图片'].slice(3))+'&token='+encodeURIComponent(getPin()):item['图片']}" style="max-width:100%;max-height:300px;border-radius:10px;cursor:pointer" onclick="showFullscreenImg(this.src)"></div>`:''}
  ${item['评估摘要']?`<div style="background:var(--bg);border-radius:10px;padding:12px;margin-top:10px;font-size:13px;line-height:1.7;border-left:3px solid var(--pri)"><div style="font-weight:600;margin-bottom:4px">🤖 AI评估摘要</div><div style="color:var(--muted)">${stripMd(esc(item['评估摘要']))}</div></div>`:''}
  ${item['购买理由']?`<div style="background:var(--bg);border-radius:10px;padding:10px;margin-top:8px;font-size:13px;border-left:3px solid var(--orange)"><div style="font-weight:600;margin-bottom:2px">💡 购买理由</div><div style="color:var(--muted)">${esc(item['购买理由'])}</div></div>`:''}
  ${item['预算区间']?`<div style="font-size:12px;color:var(--muted);margin-top:6px">💰 预算: ¥${esc(item['预算区间'])}</div>`:''}
  ${item['取消原因']?`<div style="background:var(--bg);border-radius:10px;padding:10px;margin-top:8px;font-size:13px;border-left:3px solid var(--red)"><div style="font-weight:600;margin-bottom:2px">❌ 取消理由</div><div style="color:var(--muted)">${esc(item['取消原因'])}</div></div>`:''}
  ${(function(){var tp=Number(item['分期期数'])||0;if(tp<=0)return'';var pd=getEffectivePaid(item);var ia=Number(item['分期金额'])||Math.round((Number(item['单价']||0)*Number(item['数量']||1))/tp);var pa=ia*pd;var tt=Number(item['单价']||0)*Number(item['数量']||1);var pct=Math.min(pa/tt*100,100);var bc=pct>90?'var(--red)':pct>60?'var(--orange)':'var(--green)';return '<div style="background:var(--bg);border-radius:10px;padding:12px;margin-top:8px;font-size:13px;border-left:3px solid var(--pri)"><div style="font-weight:600;margin-bottom:6px">📦 分期购买</div><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>¥'+ia+'/期 · 共'+tp+'期</span><span>已付'+pd+'期</span></div><div style="font-size:18px;font-weight:700;margin-bottom:8px">¥'+pa+' <span style="font-size:12px;color:var(--muted);font-weight:400">/ ¥'+tt+'</span></div><div style="height:6px;background:var(--card);border-radius:3px;overflow:hidden"><div style="width:'+pct+'%;height:100%;background:'+bc+';border-radius:3px;transition:width .5s"></div></div></div>'})()}
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
  if(CANCELABLE_STATUSES.includes(status)){
    const btnCfg=STEP_BTN_CONFIG[status];
    html+=`<div style="margin-top:16px;display:flex;gap:10px"><button class="detail-action-btn" style="background:${btnCfg.color};flex:1" onclick="doDetailModalAction(\x27${id}\x27,\x27${btnCfg.next}\x27)">${btnCfg.label}</button><button class="detail-action-btn" style="background:var(--muted);flex:0 0 auto" onclick="cancelPurchase('${id}')">❌ 取消</button></div>`;
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
// Purchases no longer create expense records - budget pool tracks them independently
async function createPurchaseExpense(item) { /* disabled: shared budget pool model */ }
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
    // Purchase expense no longer auto-created (shared budget pool model)
    toast(`已更新为"${nextStatus}"`);
    closeDetailModal();
    render();
  }
  // Fire PATCH in background, don't block UI
  api('PATCH',{ids:[id],status:nextStatus}).then(r=>{
    if(r&&r.error){toast('同步失败，请刷新');loadAll();}
  }).catch(()=>{toast('网络错误，请刷新');loadAll();});
}



// ============================================================
function switchTab(t){
  currentTab=t;
  // 电脑端标签高亮
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  var tabIndex=t==='purchase'?1:t==='expense'?2:3;
  var desktopTab=document.querySelector('.tabs .tab:nth-child('+tabIndex+')');
  if(desktopTab)desktopTab.classList.add('active');
  // 手机端底部导航高亮
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
  var navItem=document.querySelector('.nav-item[data-tab="'+t+'"]');
  if(navItem)navItem.classList.add('active');
  document.getElementById('tab-purchase').style.display=t==='purchase'?'':'none';
  document.getElementById('tab-expense').style.display=t==='expense'?'':'none';
  document.getElementById('tab-stats').style.display=t==='stats'?'':'none';
  document.getElementById('fabBtn').style.display=(t==='purchase'||t==='expense')?'':'none';
  var ap=document.getElementById('actionPurchase');if(ap)ap.className=t==='purchase'?'desktop-only':'desktop-only hidden';
  var ae=document.getElementById('actionExpense');if(ae)ae.className=t==='expense'?'desktop-only':'desktop-only hidden';
  var as=document.getElementById('actionStats');if(as)as.className=t==='stats'?'desktop-only':'desktop-only hidden';
  if(t!=='expense'){var ec=document.getElementById('expenseChips');if(ec)ec.innerHTML='';}
  if(t==='expense'&&!calYear)initCalMonth();
  render();
}

// ===== 采购操作 =====
function toggleBatch(){batchMode=!batchMode;selectedIds.clear();document.getElementById('batchBar').classList.toggle('show',batchMode);document.getElementById('batchInfo').textContent='已选 0 项';render()}
function toggleSelect(id){if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);document.getElementById('batchInfo').textContent=`已选 ${selectedIds.size} 项`;render()}
async function batchUpdate(){if(!selectedIds.size)return toast('请先选择商品');const status=document.getElementById('batchStatus').value;const ids=[...selectedIds];toast('正在更新 '+ids.length+' 项...');const r=await api('PATCH',{ids,status});if(r&&r.error){alert('批量更新失败: '+r.error);return}toast('已更新 '+ids.length+' 项为"'+status+'"');selectedIds.clear();toggleBatch();await loadAll()}
async function batchDelete(){if(!selectedIds.size)return;if(!confirm('确定删除选中的 '+selectedIds.size+' 项？'))return;const ids=[...selectedIds];for(const id of ids){var item=items.find(x=>x.id===id);if(item)await deletePurchaseExpenses(item['商品名称']||'')}items=items.filter(x=>!ids.includes(x.id));selectedIds.clear();toggleBatch();render();let ok=0;for(const id of ids){try{await api('DELETE',null,id);ok++}catch{}}toast('已删除 '+ok+' 项');await loadAll()}

// ============================================================
// 采购 Modal
// ============================================================
function openModal(){document.getElementById('editId').value='';document.getElementById('modalTitle').textContent='新增采购';document.getElementById('fName').value='';document.getElementById('fReason').value='';document.getElementById('fName').style.display='';document.getElementById('aiEvalResult').style.display='none';document.getElementById('aiEvalResult').textContent='';document.getElementById('chatArea').style.display='none';document.getElementById('chatMessages').innerHTML='';purchaseChatHistory=[];purchaseEvalContext='';if(typeof purchaseImageData!=='undefined'){purchaseImageData={};var evW=document.getElementById('evImageWrap');if(evW)evW.style.display='none'}document.getElementById('evalPhase').style.display='';document.getElementById('detailPhase').style.display='none';document.getElementById('editPhase').style.display='none';var peW=document.getElementById('peImageWrap');var peP=document.getElementById('peImagePreview');if(typeof purchaseImageData!=='undefined')purchaseImageData['pe']='';if(peW)peW.style.display='none';if(i['图片']&&i['图片'].startsWith('kv:')){if(peP)peP.src='/api/images?key='+encodeURIComponent(i['图片'].slice(3))+'&token='+encodeURIComponent(getPin());if(peW)peW.style.display='block'}else if(i['图片']){if(peP)peP.src=i['图片'];if(peW)peW.style.display='block'}document.getElementById('overlay').classList.add('active')}
function editItem(id){const i=items.find(x=>x.id===id);if(!i)return;document.getElementById('editId').value=id;document.getElementById('modalTitle').textContent='编辑采购';document.getElementById('evalPhase').style.display='none';document.getElementById('detailPhase').style.display='none';document.getElementById('editPhase').style.display='';document.getElementById('fNameEdit').value=i['商品名称']||'';document.getElementById('fPlatformEdit').value=i['平台']||'拼多多';document.getElementById('fCategoryEdit').value=i['分类']||'日用';document.getElementById('fPriceEdit').value=i['单价']||'';document.getElementById('fQtyEdit').value=i['数量']||1;document.getElementById('fStatusEdit').value=i['状态']||'待审批';const d=i['日期'];document.getElementById('fDateEdit').value=d?new Date(d).toISOString().slice(0,10):'';document.getElementById('fNoteEdit').value=i['备注']||'';var ig=document.getElementById('installmentGroup');var ii=document.getElementById('fInstallments');var ip=document.getElementById('installmentPreview');var iv=i['分期期数']||0;if(ig)ig.style.display='block';if(ii){ii.value=iv||'';ii.oninput=function(){var p=parseInt(this.value)||0;var pr=parseFloat(document.getElementById('fPriceEdit').value)||0;var q=parseInt(document.getElementById('fQtyEdit').value)||1;var t=pr*q;if(ip)ip.textContent=p>0?'每期 \u00a5'+(t/p).toFixed(2):'';if(ig)ig.style.display=p>0?'block':'none';}}if(ip)ip.textContent=iv>0?'每期 \u00a5'+(((i['单价']||0)*(i['数量']||1))/iv).toFixed(2):'';document.getElementById('overlay').classList.add('active')}
function closeModal(){document.getElementById('overlay').classList.remove('active')}
async function save(){const name=document.getElementById('fNameEdit').value.trim();if(!name){alert('请输入商品名称');return}const editId=document.getElementById('editId').value;const data={name,platform:document.getElementById('fPlatformEdit').value,category:document.getElementById('fCategoryEdit').value,price:parseFloat(document.getElementById('fPriceEdit').value)||0,qty:parseInt(document.getElementById('fQtyEdit').value)||1,status:document.getElementById('fStatusEdit').value,date:document.getElementById('fDateEdit').value||null,note:document.getElementById('fNoteEdit').value.trim()||null,image:(typeof purchaseImageData!=='undefined'?purchaseImageData['pe']:null)||null,installments:parseInt(document.getElementById('fInstallments')&&document.getElementById('fInstallments').value)||0,installmentAmount:0,installmentStart:getThisMonth()};if(editId){const r=await api('PUT',{id:editId,...data});if(r&&r.error){alert('更新失败: '+r.error+(r.detail?JSON.stringify(r.detail):''));return}toast('已更新')}else{const r=await api('POST',data);if(r&&r.error){alert('添加失败: '+r.error+(r.detail?JSON.stringify(r.detail):''));return}toast('已添加')}closeModal();await loadAll()}

async function deletePurchaseExpenses(itemName) {
  try {
    const related = expenses.filter(function(e) {
      return e['备注'] && (e['备注'].includes('[采购]') || e['备注'].includes('[采购分期]')) && e['备注'].includes(itemName);
    });
    for (var i = 0; i < related.length; i++) {
      await expenseApi('DELETE', null, related[i].id);
    }
    if (related.length > 0) {
      expenses = expenses.filter(function(e) { return !related.find(function(r) { return r.id === e.id; }); });
    }
  } catch(e) { console.error('deletePurchaseExpenses error:', e); }
}

async function delItem(id){if(!confirm('确定删除？'))return;var item=items.find(x=>x.id===id);var itemName=item?item['商品名称']||'':'';if(itemName)await deletePurchaseExpenses(itemName);items=items.filter(x=>x.id!==id);render();const r=await api('DELETE',null,id);if(r&&r.error){alert('删除失败: '+r.error);await loadAll();return}toast('已删除');await loadAll()}

// ===== 审批流操作 =====
const NEXT_STATUS={'待评估':'待审批','待审批':'已审批','已审批':'已下单','已下单':'已到'};
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

// ============================================================
// 记账 Modal
// ============================================================

// === App.items namespace exports ===
App.items.openDetailModal = openDetailModal;
App.items.closeDetailModal = closeDetailModal;
App.items.createPurchaseExpense = createPurchaseExpense;
App.items.doDetailModalAction = doDetailModalAction;
App.items.switchTab = switchTab;
App.items.toggleBatch = toggleBatch;
App.items.toggleSelect = toggleSelect;
App.items.batchUpdate = batchUpdate;
App.items.batchDelete = batchDelete;
function clearPurchaseEditImage(){if(typeof purchaseImageData!=='undefined')purchaseImageData['pe']='';var w=document.getElementById('peImageWrap');if(w)w.style.display='none'}
App.items.openModal = openModal;
App.items.editItem = editItem;
App.items.closeModal = closeModal;
App.items.save = save;
App.items.deletePurchaseExpenses = deletePurchaseExpenses;
App.items.clearPurchaseEditImage = clearPurchaseEditImage;
App.items.delItem = delItem;
App.items.showApprovalModal = showApprovalModal;
App.items.closeApprovalModal = closeApprovalModal;
