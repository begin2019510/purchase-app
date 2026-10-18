// budget.js - Budget Modal UI, Export
function closeBudgetModal(){document.getElementById('budgetOverlay').classList.remove('active')}
// ===== 导出格式选择弹窗 =====
function showExportDialog(type,callback){let overlay=document.getElementById('exportOverlay');if(!overlay){overlay=document.createElement('div');overlay.id='exportOverlay';overlay.className='modal-overlay';overlay.onclick=function(e){if(e.target===overlay)overlay.classList.remove('active')};overlay.innerHTML=`<div class="modal"><h2>📤 导出${type}</h2><div style="padding:10px 0"><div style="font-size:14px;margin-bottom:12px;color:var(--muted)">选择导出格式</div><div style="display:flex;gap:10px"><button class="btn btn-primary" style="flex:1" id="exportCsvBtn">📄 CSV（逗号分隔）</button><button class="btn btn-primary" style="flex:1" id="exportTsvBtn">📋 TSV（Tab分隔）</button></div></div><div class="btn-row"><button class="btn btn-secondary" onclick="document.getElementById('exportOverlay').classList.remove('active')">取消</button></div></div>`;document.body.appendChild(overlay)}document.getElementById('exportCsvBtn').onclick=function(){overlay.classList.remove('active');callback('csv')};document.getElementById('exportTsvBtn').onclick=function(){overlay.classList.remove('active');callback('tsv')};overlay.classList.add('active')}
function saveBudget(){
  const month=document.getElementById('budgetMonth').value;
  const total=parseFloat(document.getElementById('budgetInput').value)||0;
  if(!month)return alert('请选择月份');
  if(total<0)return alert('预算不能为负数');
  setWeekBudgets(month,total,0,{});
  toast('已设置 月预算'+total);
  closeBudgetModal();
  render();
}

function openBudgetModal(){
  const m=getThisMonth();
  document.getElementById('budgetMonth').value=m;
  const b=getBudgets()[m];
  const total=(b&&typeof b==='object')?b.total:(typeof b==='number'?b:0);
  document.getElementById('budgetInput').value=total||'';document.getElementById('budgetInput').min=0;
  var pool=getBudgetPool(m);
  var previewEl=document.getElementById('budgetFixedPreview');
  if(previewEl){
    if(pool.totalDeduction>0&&total>0){
      previewEl.style.display='block';
      var html='';
      if(pool.fixedDeduction>0) html+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>📌 固定支出</span><span style="color:var(--orange);font-weight:700">-¥'+pool.fixedDeduction.toFixed(0)+'</span></div>';
      if(pool.installmentDeduction>0) html+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>📦 分期还款</span><span style="color:#8b5cf6;font-weight:700">-¥'+pool.installmentDeduction.toFixed(0)+'</span></div>';
      html+='<div style="border-top:1px dashed var(--border);padding-top:6px;margin-top:6px;display:flex;justify-content:space-between"><span style="font-weight:700">💰 可用预算</span><span style="font-size:16px;font-weight:800;color:var(--pri)">¥'+pool.available.toFixed(0)+'</span></div>';
      previewEl.innerHTML=html;
    } else {
      previewEl.style.display='none';
    }
  }
  var _src=document.getElementById('budgetAppendSource');if(_src)_src.value='工资结余';
  var _cus=document.getElementById('budgetAppendCustom');if(_cus){_cus.value='';_cus.style.display='none'}
  var _note=document.getElementById('budgetAppendNote');if(_note)_note.value='';
  var _api=document.getElementById('budgetAppendInput');if(_api)_api.value='';
  renderBudgetAdditions(m);
  document.getElementById('budgetOverlay').classList.add('active');
}


// ===== 导出 =====
function exportData(){exportPurchases()}
function exportPurchases(){showExportDialog('采购',function(format){const sep=format==='csv'?',':'\t';const mime=format==='csv'?'text/csv':'text/tab-separated-values';const ext=format==='csv'?'.csv':'.tsv';const lines=['商品名称'+sep+'平台'+sep+'分类'+sep+'单价'+sep+'数量'+sep+'总价'+sep+'状态'+sep+'日期'+sep+'备注'];items.forEach(i=>{const qty=i['数量']||1;const price=i['单价']||0;let ds='';if(i['日期']){try{ds=new Date(i['日期']).toISOString().slice(0,10)}catch{}}const note=(i['备注']||'').includes(sep)?'"'+(i['备注']||'').replace(/"/g,'""')+'"':(i['备注']||'');lines.push((i['商品名称']||'')+sep+(i['平台']||'')+sep+(i['分类']||'')+sep+'¥'+price+sep+qty+sep+'¥'+(price*qty).toFixed(2)+sep+(i['状态']||'')+sep+ds+sep+note)});const b=new Blob([lines.join('\n')],{type:mime+';charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='采购_'+getThisMonth()+ext;a.click()})}


// === App.budget namespace exports ===
function renderBudgetAdditions(month){
  var el=document.getElementById('budgetAdditionsList');
  if(!el)return;
  var b=getBudgets()[month];
  var adds=(b&&typeof b==='object'&&Array.isArray(b.additions))?b.additions:[];
  if(!adds.length){el.innerHTML='<div style="color:var(--muted);font-size:11px">暂无追加记录</div>';return}
  var total=adds.reduce(function(s,a){return s+(Number(a.amt)||0)},0);
  var escFn=(typeof esc==='function')?esc:function(x){return String(x||'')};
  el.innerHTML='<div style="font-size:11px;color:var(--muted);margin-bottom:4px">追加记录 '+adds.length+' 笔 · 合计 ¥'+total.toFixed(0)+'</div>'
    +adds.slice().reverse().map(function(a){
      var d=new Date(a.ts||Date.now());
      var ds=(d.getMonth()+1)+'-'+String(d.getDate()).padStart(2,'0');
      return '<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-top:1px dashed var(--border)">'
        +'<span style="color:var(--muted);flex-shrink:0">'+ds+'</span>'
        +'<span style="font-weight:800;color:var(--green);flex-shrink:0">+¥'+Number(a.amt||0).toFixed(0)+'</span>'
        +'<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escFn(a.src||'其他')+(a.note?' · '+escFn(a.note):'')+'</span>'
        +'<button onclick="App.budget.removeBudgetAddition(\''+a.id+'\')" style="border:none;background:none;color:var(--red);font-size:13px;cursor:pointer;flex-shrink:0;padding:2px 4px">✕</button>'
        +'</div>';
    }).join('');
}

function appendBudget(){
  var month=document.getElementById('budgetMonth').value;
  var appendVal=parseFloat(document.getElementById('budgetAppendInput').value)||0;
  if(!month)return alert('请选择月份');
  if(appendVal<=0)return alert('追加金额必须大于0');
  var sel=document.getElementById('budgetAppendSource');
  var src=sel?sel.value:'其他';
  if(src==='自定义'){
    var c=document.getElementById('budgetAppendCustom');
    src=(c&&c.value.trim())||'';
    if(!src)return alert('请填写自定义来源');
  }
  if(!src)src='其他';
  var noteEl=document.getElementById('budgetAppendNote');
  var note=noteEl?noteEl.value.trim():'';
  var current=getBudgetNum(month);
  var newTotal=current+appendVal;
  if(!confirm('确认追加预算？\n\n来源：'+src+(note?'（'+note+'）':'')+'\n当前预算：¥'+current.toFixed(0)+'\n追加金额：¥'+appendVal.toFixed(0)+'\n追加后总预算：¥'+newTotal.toFixed(0)))return;
  var b=getBudgets();
  var cur=(b[month]&&typeof b[month]==='object')?b[month]:{total:(typeof b[month]==='number'?b[month]:0),perWeek:0,weeks:{}};
  cur.total=newTotal;
  cur.additions=(Array.isArray(cur.additions)?cur.additions:[]).concat([{id:'a'+Date.now()+Math.random().toString(36).slice(2,6),amt:appendVal,src:src,note:note,ts:Date.now()}]);
  b[month]=cur;
  setBudgets(b);
  toast('已追加 ¥'+appendVal.toFixed(0)+'（'+src+'），总预算 ¥'+current.toFixed(0)+' → ¥'+newTotal.toFixed(0));
  document.getElementById('budgetAppendInput').value='';
  if(noteEl)noteEl.value='';
  var c2=document.getElementById('budgetAppendCustom');if(c2){c2.value='';c2.style.display='none'}
  if(sel)sel.value='工资结余';
  document.getElementById('budgetInput').value=newTotal;
  renderBudgetAdditions(month);
  var pool=getBudgetPool(month);
  var previewEl=document.getElementById('budgetFixedPreview');
  if(previewEl&&pool.totalDeduction>0){
    previewEl.style.display='block';
    var html='';
    if(pool.fixedDeduction>0)html+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>📌 固定支出</span><span style="color:var(--orange);font-weight:700">-¥'+pool.fixedDeduction.toFixed(0)+'</span></div>';
    if(pool.installmentDeduction>0)html+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>📦 分期还款</span><span style="color:#8b5cf6;font-weight:700">-¥'+pool.installmentDeduction.toFixed(0)+'</span></div>';
    html+='<div style="border-top:1px dashed var(--border);padding-top:6px;margin-top:6px;display:flex;justify-content:space-between"><span style="font-weight:700">💰 可用预算</span><span style="font-size:16px;font-weight:800;color:var(--pri)">¥'+pool.available.toFixed(0)+'</span></div>';
    previewEl.innerHTML=html;
  }
  render();
}

function removeBudgetAddition(id){
  var month=document.getElementById('budgetMonth').value;
  if(!month)return;
  var b=getBudgets();
  var cur=b[month];
  if(!cur||typeof cur!=='object')return;
  var adds=Array.isArray(cur.additions)?cur.additions:[];
  var idx=-1;
  for(var i=0;i<adds.length;i++){if(adds[i].id===id){idx=i;break}}
  if(idx<0)return;
  var a=adds[idx];
  if(!confirm('删除这笔追加预算？\n\n来源：'+(a.src||'其他')+(a.note?'（'+a.note+'）':'')+'\n金额：¥'+Number(a.amt||0).toFixed(0)+'\n总预算将扣减对应金额'))return;
  cur.total=Math.max(0,(Number(cur.total)||0)-Number(a.amt||0));
  cur.additions=adds.filter(function(x){return x.id!==id});
  b[month]=cur;
  setBudgets(b);
  document.getElementById('budgetInput').value=cur.total;
  renderBudgetAdditions(month);
  render();
  toast('已删除该笔追加（总预算扣减 ¥'+Number(a.amt||0).toFixed(0)+'）');
}

App.budget.renderBudgetAdditions = renderBudgetAdditions;
App.budget.removeBudgetAddition = removeBudgetAddition;
App.budget.closeBudgetModal = closeBudgetModal;
App.budget.showExportDialog = showExportDialog;
App.budget.saveBudget = saveBudget;
App.budget.openBudgetModal = openBudgetModal;
App.budget.exportData = exportData;
App.budget.exportPurchases = exportPurchases;
App.budget.appendBudget = appendBudget;
