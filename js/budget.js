// budget.js - Budget Modal UI, Export
function closeBudgetModal(){document.getElementById('budgetOverlay').classList.remove('active')}
// ===== 导出格式选择弹窗 =====
function showExportDialog(type,callback){let overlay=document.getElementById('exportOverlay');if(!overlay){overlay=document.createElement('div');overlay.id='exportOverlay';overlay.className='modal-overlay';overlay.onclick=function(e){if(e.target===overlay)overlay.classList.remove('active')};overlay.innerHTML=`<div class="modal"><h2>📤 导出${type}</h2><div style="padding:10px 0"><div style="font-size:14px;margin-bottom:12px;color:var(--muted)">选择导出格式</div><div style="display:flex;gap:10px"><button class="btn btn-primary" style="flex:1" id="exportCsvBtn">📄 CSV（逗号分隔）</button><button class="btn btn-primary" style="flex:1" id="exportTsvBtn">📋 TSV（Tab分隔）</button></div></div><div class="btn-row"><button class="btn btn-secondary" onclick="document.getElementById('exportOverlay').classList.remove('active')">取消</button></div></div>`;document.body.appendChild(overlay)}document.getElementById('exportCsvBtn').onclick=function(){overlay.classList.remove('active');callback('csv')};document.getElementById('exportTsvBtn').onclick=function(){overlay.classList.remove('active');callback('tsv')};overlay.classList.add('active')}
function saveBudget(){
  const month=document.getElementById('budgetMonth').value;
  const total=parseFloat(document.getElementById('budgetInput').value)||0;
  if(!month)return alert('请选择月份');
  if(total<0)return alert('预算不能为负数');
  const weeks=getMonthWeeks(month);
  const weekObj={};let weekSum=0;
  for(let i=0;i<weeks.length;i++){
    const el=document.getElementById('weekBudget_'+i);
    const v=el?parseFloat(el.value)||0:0;
    if(v<0){alert('周预算不能为负数');return}
    if(v>0){weekObj[i]=v;weekSum+=v}
  }
  if(total>0&&weekSum>total){alert('周预算总和 ¥'+weekSum+' 超过月预算 ¥'+total);return}
  setWeekBudgets(month,total,0,weekObj);
  const msg=Object.keys(weekObj).length?'月预算'+total+'，'+Object.keys(weekObj).length+'个周预算':'月预算'+total;
  toast('已设置 '+msg);
  closeBudgetModal();
  render();
}

function openBudgetModal(){
  console.log('BUDGET_DEBUG_openBudgetModal');
  const m=getThisMonth();
  document.getElementById('budgetMonth').value=m;
  const b=getBudgets()[m];
  const total=(b&&typeof b==='object')?b.total:(typeof b==='number'?b:0);
  document.getElementById('budgetInput').value=total||'';document.getElementById('budgetInput').min=0;
  // Show fixed expense preview
  var fixedTotal=getFixedExpenseTotal();
  var previewEl=document.getElementById('budgetFixedPreview');
  if(previewEl){
    if(fixedTotal>0){
      previewEl.style.display='block';
      previewEl.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:13px;font-weight:600">📌 固定支出</span><span style="font-size:15px;font-weight:700;color:var(--orange)">¥'+fixedTotal.toFixed(0)+'/月</span></div><div style="font-size:12px;color:var(--muted)">扣除固定支出后可用预算: <b style="color:var(--pri)">¥'+Math.max((total||0)-fixedTotal,0).toFixed(0)+'</b></div>';
    } else {
      previewEl.style.display='none';
    }
  }
  renderWeekBudgetInputs(m,total);
  document.getElementById('budgetOverlay').classList.add('active');
}

// ===== FAB 点击 =====
document.getElementById('fabBtn').addEventListener('click',()=>{
  if(currentTab==='purchase') openModal();
  else if(currentTab==='expense') openExpenseModal();
});

// ===== 导出 =====
function exportData(){exportPurchases()}
function exportPurchases(){showExportDialog('采购',function(format){const sep=format==='csv'?',':'\t';const mime=format==='csv'?'text/csv':'text/tab-separated-values';const ext=format==='csv'?'.csv':'.tsv';const lines=['商品名称'+sep+'平台'+sep+'分类'+sep+'单价'+sep+'数量'+sep+'总价'+sep+'状态'+sep+'日期'+sep+'备注'];items.forEach(i=>{const qty=i['数量']||1;const price=i['单价']||0;let ds='';if(i['日期']){try{ds=new Date(i['日期']).toISOString().slice(0,10)}catch{}}const note=(i['备注']||'').includes(sep)?'"'+(i['备注']||'').replace(/"/g,'""')+'"':(i['备注']||'');lines.push((i['商品名称']||'')+sep+(i['平台']||'')+sep+(i['分类']||'')+sep+'¥'+price+sep+qty+sep+'¥'+(price*qty).toFixed(2)+sep+(i['状态']||'')+sep+ds+sep+note)});const b=new Blob([lines.join('\n')],{type:mime+';charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='采购_'+getThisMonth()+ext;a.click()})}


// === App.budget namespace exports ===
App.budget.closeBudgetModal = closeBudgetModal;
App.budget.showExportDialog = showExportDialog;
App.budget.saveBudget = saveBudget;
App.budget.openBudgetModal = openBudgetModal;
App.budget.exportData = exportData;
App.budget.exportPurchases = exportPurchases;
