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
  document.getElementById('budgetOverlay').classList.add('active');
}


// ===== 导出 =====
function exportData(){exportPurchases()}
function exportPurchases(){showExportDialog('采购',function(format){const sep=format==='csv'?',':'\t';const mime=format==='csv'?'text/csv':'text/tab-separated-values';const ext=format==='csv'?'.csv':'.tsv';const lines=['商品名称'+sep+'平台'+sep+'分类'+sep+'单价'+sep+'数量'+sep+'总价'+sep+'状态'+sep+'日期'+sep+'备注'];items.forEach(i=>{const qty=i['数量']||1;const price=i['单价']||0;let ds='';if(i['日期']){try{ds=new Date(i['日期']).toISOString().slice(0,10)}catch{}}const note=(i['备注']||'').includes(sep)?'"'+(i['备注']||'').replace(/"/g,'""')+'"':(i['备注']||'');lines.push((i['商品名称']||'')+sep+(i['平台']||'')+sep+(i['分类']||'')+sep+'¥'+price+sep+qty+sep+'¥'+(price*qty).toFixed(2)+sep+(i['状态']||'')+sep+ds+sep+note)});const b=new Blob([lines.join('\n')],{type:mime+';charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='采购_'+getThisMonth()+ext;a.click()})}


// === App.budget namespace exports ===
function appendBudget(){var month=document.getElementById("budgetMonth").value;var appendVal=parseFloat(document.getElementById("budgetAppendInput").value)||0;if(!month)return alert("请选择月份");if(appendVal<=0)return alert("追加金额必须大于0");var current=getBudgetNum(month);var newTotal=current+appendVal;if(!confirm("确认追加预算？\n\n当前预算：¥"+current.toFixed(0)+"\n追加金额：¥"+appendVal.toFixed(0)+"\n追加后总预算：¥"+newTotal.toFixed(0)))return;setWeekBudgets(month,newTotal,0,{});toast("已追加 ¥"+appendVal.toFixed(0)+"，总预算 ¥"+current.toFixed(0)+" → ¥"+newTotal.toFixed(0));document.getElementById("budgetAppendInput").value="";document.getElementById("budgetInput").value=newTotal;var pool=getBudgetPool(month);var previewEl=document.getElementById("budgetFixedPreview");if(previewEl&&pool.totalDeduction>0){previewEl.style.display="block";var html="";if(pool.fixedDeduction>0)html+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>📌 固定支出</span><span style="color:var(--orange);font-weight:700">-¥'+pool.fixedDeduction.toFixed(0)+'</span></div>';if(pool.installmentDeduction>0)html+='<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>📦 分期还款</span><span style="color:#8b5cf6;font-weight:700">-¥'+pool.installmentDeduction.toFixed(0)+'</span></div>';html+='<div style="border-top:1px dashed var(--border);padding-top:6px;margin-top:6px;display:flex;justify-content:space-between"><span style="font-weight:700">💰 可用预算</span><span style="font-size:16px;font-weight:800;color:var(--pri)">¥'+pool.available.toFixed(0)+'</span></div>';previewEl.innerHTML=html}render()}
App.budget.closeBudgetModal = closeBudgetModal;
App.budget.showExportDialog = showExportDialog;
App.budget.saveBudget = saveBudget;
App.budget.openBudgetModal = openBudgetModal;
App.budget.exportData = exportData;
App.budget.exportPurchases = exportPurchases;
App.budget.appendBudget = appendBudget;
