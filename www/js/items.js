// items.js - 采购页壳：tab 切换 / 需求表单 / 极速采购 / 兼容导出
// 新采购模型（需求/供应商/子单）见 js/needs.js；本文件不再含详情渲染与审批流。

// ============================================================
function switchTab(t){
  console.log("DBG_SWITCHTAB t="+t+" proj="+document.getElementById("tab-project")?.style.display);
  var _prevTab=currentTab;
  currentTab=t;
  try{localStorage.setItem('activeTab',t)}catch(e){}
  // 电脑端标签高亮
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  var tabIndex=t==='purchase'?1:t==='expense'?2:t==='stats'?3:t==='todo'?4:5;
  var desktopTab=document.querySelector('.tabs .tab:nth-child('+tabIndex+')');
  if(desktopTab)desktopTab.classList.add('active');
  // 手机端底部导航高亮
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));
  var navItem=document.querySelector('.nav-item[data-tab="'+t+'"]');
  if(navItem)navItem.classList.add('active');
  document.getElementById('tab-purchase').style.display=t==='purchase'?'':'none';
  document.getElementById('tab-expense').style.display=t==='expense'?'':'none';
  document.getElementById('tab-stats').style.display=t==='stats'?'':'none';
    var todoTab=document.getElementById('tab-todo');if(todoTab)todoTab.style.display=t==='todo'?'':'none';
  var projTab=document.getElementById('tab-project');if(projTab)projTab.style.display=t==='project'?'':'none';
  // Phase 1: 切 tab 入场 fade（CSS .anim-fade）
  var pane=document.getElementById('tab-'+t);
  if(pane){pane.classList.remove('anim-fade');void pane.offsetWidth;pane.classList.add('anim-fade');}
  // 采购列表：仅切到本 tab 时播一次 stagger；状态更新等 render 不重放
  if(t==='purchase'){
    var _pl=document.getElementById('list');
    // 仅：真正切到采购 tab，或列表尚未播过首次入场（首屏）
    if(_pl&&(_prevTab!==t||_pl.dataset.entered!=='1'))_pl.dataset.enter='1';
  }
  document.getElementById('fabBtn').style.display=(t==='purchase'||t==='expense'||t==='todo'||t==='project')?'':'none';
  var ap=document.getElementById('actionPurchase');if(ap)ap.className=t==='purchase'?'desktop-only':'desktop-only hidden';
  var ae=document.getElementById('actionExpense');if(ae)ae.className=t==='expense'?'desktop-only':'desktop-only hidden';
  var as=document.getElementById('actionStats');if(as)as.className=t==='stats'?'desktop-only':'desktop-only hidden';
    var at=document.getElementById('actionTodo');if(at)at.className=t==='todo'?'desktop-only':'desktop-only hidden';
  var ap2=document.getElementById('actionProject');if(ap2)ap2.className=t==='project'?'desktop-only':'desktop-only hidden';
  if(t!=='expense'){var ec=document.getElementById('expenseChips');if(ec)ec.innerHTML='';}
  if(t==='expense'&&!calYear)initCalMonth();
  render();
  // Update FAB onclick for todo
  var fab=document.getElementById('fabBtn');
  if(fab){
    if(t==='todo'){fab.onclick=function(){openTodoModal()}}
    else if(t==='project'){fab.onclick=function(){openProjectModal()}}
    else if(t==='purchase'){fab.onclick=function(){openModal()}}
    else{fab.onclick=function(){openExpenseModal()}}
  }
}

// ===== 采购操作（新版无批量；保留入口避免旧快捷键/调用报错）=====
function toggleBatch(){toast('新版采购无批量模式，可在需求详情内操作子单')}

// ============================================================
// 需求表单（#overlay）：提交需求 / 编辑需求
// ============================================================
function openModal(projectId, phaseIdx){
  document.getElementById('editId').value='';
  document.getElementById('modalTitle').textContent='提交需求';
  document.getElementById('fName').value='';
  document.getElementById('fBudgetMin').value='';
  document.getElementById('fBudgetMax').value='';
  var catSel=document.getElementById('fCategory');
  if(catSel)catSel.value='日用';
  var fv=document.getElementById('fVirtual');if(fv)fv.checked=false;
  // 从项目详情进入时预选项目/阶段；普通新建则清空
  if(typeof fillProjectPhaseSelects==='function' && document.getElementById('fProject')){
    try{ fillProjectPhaseSelects('fProject','fPhase',projectId||'',(phaseIdx===undefined?null:phaseIdx)); }catch(e){}
  }
  document.getElementById('overlay').classList.add('active');
  setTimeout(function(){var el=document.getElementById('fName');if(el)el.focus()},60);
}
function openNeedEdit(id){
  const n=typeof findNeed==='function'?findNeed(id):null;
  if(!n){toast('未找到该需求');return}
  document.getElementById('editId').value=id;
  document.getElementById('modalTitle').textContent='编辑需求';
  document.getElementById('fName').value=n['名称']||'';
  const catSel=document.getElementById('fCategory');
  if(catSel){
    const c=n['分类']||'其他';
    catSel.value=c;
    if(catSel.value!==c){const o=document.createElement('option');o.value=c;o.textContent=c;catSel.appendChild(o);catSel.value=c}
  }
  document.getElementById('fBudgetMin').value=n['预算下限']!=null?n['预算下限']:'';
  document.getElementById('fBudgetMax').value=n['预算上限']!=null?n['预算上限']:'';
  var fv=document.getElementById('fVirtual');if(fv)fv.checked=(n['虚拟']==='1');
  try{if(typeof fillProjectPhaseSelects==='function')fillProjectPhaseSelects('fProject','fPhase',n['项目ID']||'',n['阶段'])}catch(e){}
  document.getElementById('overlay').classList.add('active');
}
function closeModal(){document.getElementById('overlay').classList.remove('active')}
async function saveNeed(){
  const name=(document.getElementById('fName').value||'').trim();
  if(!name){alert('请输入需求名称');return}
  const minRaw=document.getElementById('fBudgetMin').value.trim();
  const maxRaw=document.getElementById('fBudgetMax').value.trim();
  const budgetMin=minRaw===''?null:(isFinite(parseFloat(minRaw))?parseFloat(minRaw):null);
  const budgetMax=maxRaw===''?null:(isFinite(parseFloat(maxRaw))?parseFloat(maxRaw):null);
  if(budgetMin==null&&minRaw!==''){alert('预算下限格式不对');return}
  if(budgetMax==null&&maxRaw!==''){alert('预算上限格式不对');return}
  if(budgetMin!=null&&budgetMax!=null&&budgetMin>budgetMax){alert('预算下限不能大于上限');return}
  const data={
    name:name,
    category:document.getElementById('fCategory').value||'其他',
    budgetMin:budgetMin, budgetMax:budgetMax,
    virtual:!!(document.getElementById('fVirtual')&&document.getElementById('fVirtual').checked),
    projectId:(document.getElementById('fProject')||{}).value||'',
    phaseIdx:(function(){var ph=document.getElementById('fPhase');return ph&&ph.value!==''?Number(ph.value):null})()
  };
  const editId=document.getElementById('editId').value;
  const r=editId?await needsApi('PUT','/needs/'+editId,data):await needsApi('POST','/needs',data);
  if(r&&r.error){toast((editId?'更新':'提交')+'失败: '+r.error);return} // 失败保留表单，便于修正
  closeModal();
  toast(editId?'已更新':'需求已提交');
  // 新建后直接进详情继续加供应商；编辑后回到详情
  await needRefresh((r&&r.id)||editId||null, true);
}

// ============================================================
// 极速采购（免审直通，走 /api/needs/quick；旧 server 时回退 /api/items）
// ============================================================
function getQuickPrefs(){try{return JSON.parse(localStorage.getItem('quick_purchase_prefs')||'{}')}catch(e){return{}}}
function saveQuickPrefs(p){try{localStorage.setItem('quick_purchase_prefs',JSON.stringify(p))}catch(e){}}
function openQuickPurchaseModal(){
  const d=new Date(Date.now()+8*3600000);
  const pad=n=>String(n).padStart(2,'0');
  const el=id=>document.getElementById(id);
  if(!el('qName'))return;
  const prefs=getQuickPrefs();
  el('qName').value='';el('qPrice').value='';el('qQty').value='1';
  el('qPlatform').value=prefs.platform||'京东';
  el('qCategory').value=prefs.category||'日用';
  el('qNote').value='';
  el('qDate').value=d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate());
  if(el('qVirtual'))el('qVirtual').checked=false;
  try{ if(typeof fillProjectPhaseSelects==='function') fillProjectPhaseSelects('qProject','qPhase','',null); }catch(e){}
  el('quickOverlay').classList.add('active');
  // 移动端：自动聚焦 + 回车即保存
  ['qName','qPrice','qQty','qNote'].forEach(function(id){
    const e2=el(id);
    if(e2)e2.onkeydown=function(ev){if(ev.key==='Enter'){ev.preventDefault();saveQuickPurchase()}};
  });
  setTimeout(function(){el('qName').focus()},60);
}
function closeQuickPurchase(){document.getElementById('quickOverlay').classList.remove('active')}
function qPlatformChanged(){
  try{
    var v=document.getElementById('qPlatform').value;
    var ai=['阿里云','腾讯云','OpenAI','DeepSeek','MiMo','AWS'];
    var cb=document.getElementById('qVirtual');
    if(cb&&ai.indexOf(v)>=0)cb.checked=true;
    var cat=document.getElementById('qCategory');
    if(cat&&ai.indexOf(v)>=0&&['云服务','API'].indexOf(cat.value)<0)cat.value=(v==='阿里云'||v==='腾讯云'||v==='AWS')?'云服务':'API';
  }catch(e){}
}
async function saveQuickPurchase(){
  const el=id=>document.getElementById(id);
  const name=(el('qName').value||'').trim();
  const price=parseFloat(el('qPrice').value)||0;
  const qty=parseInt(el('qQty').value)||1;
  if(!name){alert('请输入商品名称');return}
  if(price<=0){alert('请输入金额');return}
  const total=price*qty;
  if(total>50){
    alert('⚡ 极速免审仅限 ¥50 以内小额\n\n本单合计 ¥'+total.toFixed(2)+'，超过限额\n请点右下角 + 走完整采购流程');
    return;
  }
  const data={
    name:name, price:price, qty:qty,
    platform:el('qPlatform').value, category:el('qCategory').value,
    note:(el('qNote').value||'').trim()||null, date:el('qDate').value||null,
    virtual:!!(el('qVirtual')&&el('qVirtual').checked),
    projectId:(el('qProject')||{}).value||'',
    phaseIdx:(function(){var ph=el('qPhase');return ph&&ph.value!==''?Number(ph.value):null})()
  };
  saveQuickPrefs({platform:data.platform,category:data.category});
  closeQuickPurchase();
  const r=await needsApi('POST','/needs/quick',data);
  if(needEndpointMissing(r)){
    // 旧 server / 飞书后端：回退旧 /api/items 快速路径（status=已到 + quick）
    const legacy=await api('POST',Object.assign({},data,{status:'已到',quick:true}));
    if(legacy&&legacy.error){toast('添加失败: '+legacy.error);return}
  }else if(r&&r.error){toast('添加失败: '+r.error);return}
  toast('已记入采购（免审）');
  if(el('qVirtual'))el('qVirtual').checked=false;
  await loadAll();
}

// ============================================================
// 兼容导出 / 旧调用点
// ============================================================
// 采购不再产生记账行（预算池独立口径）；保留函数供删除流程清理旧数据
async function createPurchaseExpense(item) { /* disabled: shared budget pool model */ }

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

// app.js 键盘快捷键 → 需求删除
function delItem(id){deleteNeed(id)}

// === App.items namespace exports ===
App.items.openModal = openModal;
App.items.openNeedEdit = openNeedEdit;
App.items.closeModal = closeModal;
App.items.saveNeed = saveNeed;
App.items.switchTab = switchTab;
App.items.toggleBatch = toggleBatch;
App.items.createPurchaseExpense = createPurchaseExpense;
App.items.deletePurchaseExpenses = deletePurchaseExpenses;
App.items.openQuickPurchaseModal = openQuickPurchaseModal;
App.items.closeQuickPurchase = closeQuickPurchase;
App.items.qPlatformChanged = qPlatformChanged;
App.items.saveQuickPurchase = saveQuickPurchase;
App.items.delItem = delItem;
