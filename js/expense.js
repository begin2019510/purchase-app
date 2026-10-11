// expense.js - Expense Rendering, Calendar, Week, CRUD
// ===== 记账渲染 =====
const CAT_ICONS={'餐饮':'🍜','交通':'🚗','购物':'🛍️','娱乐':'🎮','居住':'🏠','医疗':'🏥','教育':'📚','其他':'📌'};
const CAT_COLORS = {'日用':'#6366f1','服饰':'#8b5cf6','饮食':'#10b981','电子':'#3b82f6','交通':'#f59e0b','其他':'#94a3b8','餐饮':'#ef4444','购物':'#ec4899','娱乐':'#8b5cf6','居住':'#10b981','医疗':'#f59e0b','教育':'#3b82f6'};
const WEEKDAYS=['日','一','二','三','四','五','六'];
let expenseTypeFilter='all';
// ===== 记账分类（默认 + 自定义）=====
const DEFAULT_EXPENSE_CATS=['餐饮','交通','购物','娱乐','居住','医疗','教育','其他'];
let customExpenseCats=[]; // [{n:'咖啡',e:'☕'}]
function getExpenseCatMap(){var m={};customExpenseCats.forEach(function(c){if(c&&c.n)m[c.n]=c.e||''});return m}
function getExpenseCats(){
  const set=[];const add=c=>{if(c&&!set.includes(c))set.push(c)};
  DEFAULT_EXPENSE_CATS.filter(c=>c!=='其他').forEach(add);
  customExpenseCats.forEach(c=>add(c&&c.n));
  add('其他');return set;
}
const _catPalette=['#6366f1','#10b981','#f59e0b','#ec4899','#3b82f6','#8b5cf6','#14b8a6','#f43f5e','#84cc16','#f97316','#0ea5e9','#a855f7'];
function catColor(name){
  name=name||'其他';
  if(CAT_COLORS[name])return CAT_COLORS[name];
  let h=0;for(let i=0;i<name.length;i++)h=(h*33+name.charCodeAt(i))>>>0;
  return _catPalette[h%_catPalette.length];
}
function catIcon(name){
  name=name||'其他';
  if(CAT_ICONS[name])return CAT_ICONS[name];
  const c=customExpenseCats.find(x=>x&&x.n===name);
  if(c&&c.img&&typeof c.img==='string'&&c.img.startsWith('data:image/')){
    return '<img class="cat-img-icon" src="'+c.img+'" alt="">';
  }
  return (c&&c.e)||'🏷️';
}
// 图片 → 96x96 图标 dataURL
function catImgToIconDataUrl(file,cb){
  if(!file||!file.type.startsWith('image/')){cb(null);return}
  const reader=new FileReader();
  reader.onload=function(ev){
    const img=new Image();
    img.onload=function(){
      const S=96;
      const canvas=document.createElement('canvas');
      canvas.width=S;canvas.height=S;
      const ctx=canvas.getContext('2d');
      // cover 裁剪成方形
      const s=Math.min(img.width,img.height);
      ctx.drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,S,S);
      cb(canvas.toDataURL('image/jpeg',0.85));
    };
    img.onerror=function(){cb(null)};
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
}
// 图标上传目标：null=新分类草稿；数字=已有自定义分类下标
let _catIconTarget=null;
let _catIconDraft='';
function pickCatIconFile(target){
  _catIconTarget=target;
  const f=document.getElementById('catIconFile');
  if(f){f.value='';f.click();}
}
function onCatIconFile(input){
  const file=input.files&&input.files[0];
  if(!file)return;
  catImgToIconDataUrl(file,function(url){
    if(!url){toast('图片读取失败');return}
    if(_catIconTarget===null||_catIconTarget==='new'){
      _catIconDraft=url;
      const pv=document.getElementById('catNewIconPreview');
      if(pv){pv.src=url;pv.style.display='inline-block'}
      const ei=document.getElementById('catEmojiInput');
      if(ei)ei.value='';
    }else{
      const idx=Number(_catIconTarget);
      if(customExpenseCats[idx]){
        customExpenseCats[idx].img=url;
        saveExpenseCats().then(function(ok){
          if(ok){renderCatManager();toast('图标已更新')}
          else customExpenseCats[idx].img='';
        });
      }
    }
  });
}
async function loadExpenseCats(){
  try{
    let r=await fetch(API_BASE+'/api/cats',{headers:{'Authorization':'Bearer '+getPin()}});
    if(r.status===401){const nt=await refreshAccessToken();if(nt)r=await fetch(API_BASE+'/api/cats',{headers:{'Authorization':'Bearer '+nt}})}
    const j=await r.json();
    customExpenseCats=(j&&j.data&&j.data.list)||[];
  }catch(e){console.log('loadExpenseCats:',e.message)}
}
async function saveExpenseCats(){
  try{
    const body=JSON.stringify({data:{list:customExpenseCats}});
    let r=await fetch(API_BASE+'/api/cats',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:body});
    if(r.status===401){const nt=await refreshAccessToken();if(nt)await fetch(API_BASE+'/api/cats',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+nt},body:body})}
    return true;
  }catch(e){toast('保存失败');return false}
}
function fillExpenseCatSelect(prefer){
  const el=document.getElementById('eCategory');if(!el)return;
  const cur=prefer||el.value||'餐饮';
  const cats=getExpenseCats();
  if(cur&&!cats.includes(cur))cats.splice(Math.max(cats.length-1,0),0,cur);
  const imap=getExpenseCatMap();
  el.innerHTML=cats.map(c=>'<option value="'+escAttr(c)+'">'+(imap[c]?esc(imap[c])+' ':'')+esc(c)+'</option>').join('')
    +'<option value="__new__">➕ 新分类…</option>';
  if(cats.includes(cur))el.value=cur;
}
function onExpenseCatChange(sel){
  if(sel.value==='__new__'){
    const prev=sel.dataset.prev||'餐饮';
    addCustomCatFlow(function(){ fillExpenseCatSelect(prev); sel.value=prev; });
    sel.value=prev;
  }else{ sel.dataset.prev=sel.value; }
}
// ===== 分类管理 =====
const CAT_EMOJI_PICKS=['☕','🧋','🍰','🍜','💊','✈️','📦','🎬','🐾','🎮','🏋️','📶','🍼','💇','🔧','🌱','🎓','🎁'];
function openCatManager(){ renderCatManager(); document.getElementById('catOverlay').classList.add('active'); }
function closeCatManager(){ document.getElementById('catOverlay').classList.remove('active'); }
function renderCatManager(){
  const box=document.getElementById('catMgrList');if(!box)return;
  const imap=getExpenseCatMap();
  let html='<div class="wd-brief" style="margin-bottom:10px">默认分类不可删（历史记录不受影响）</div>';
  DEFAULT_EXPENSE_CATS.forEach(function(c){
    html+='<div class="wd-row" style="cursor:default"><span class="wd-dot" style="background:'+catColor(c)+'"></span>'
      +'<span class="wd-main">'+(CAT_ICONS[c]?CAT_ICONS[c]+' ':'')+esc(c)+'</span>'
      +'<span style="font-size:11px;color:var(--muted-2)">默认</span></div>';
  });
  if(customExpenseCats.length){
    html+='<div style="font-size:11px;font-weight:700;color:var(--muted);margin:10px 0 4px">自定义分类</div>';
    customExpenseCats.forEach(function(c,idx){
      const iconHtml=(c.img&&c.img.startsWith('data:image/'))
        ?'<img class="cat-img-icon" style="width:18px;height:18px" src="'+c.img+'" onclick="event.stopPropagation();pickCatIconFile('+idx+')" title="点击更换图片图标">'
        :'<span onclick="pickCatIconFile('+idx+')" title="点击上传图片图标" style="cursor:pointer">'+(c.e?esc(c.e):'🏷️')+'</span>';
      html+='<div class="wd-row"><span class="wd-dot" style="background:'+catColor(c.n)+'"></span>'
        +iconHtml
        +'<span class="wd-main">'+esc(c.n)+'</span>'
        +'<button class="ex-entry-del" onclick="delCustomCat('+idx+')" title="删除" style="font-size:14px;min-width:32px;min-height:32px">🗑️</button></div>';
    });
  }
  box.innerHTML=html;
  const ep=document.getElementById('catEmojiPick');
  if(ep&&!ep.dataset.ready){
    ep.innerHTML=CAT_EMOJI_PICKS.map(e=>'<span class="cat-emo" onclick="pickCatEmoji(\''+e+'\')" style="cursor:pointer;font-size:18px;padding:4px 6px;border-radius:8px">'+e+'</span>').join('')
      +'<span class="cat-emo" onclick="pickCatEmoji(\'\')" style="cursor:pointer;font-size:14px;padding:4px 6px;border-radius:8px;color:var(--muted)">无</span>';
    ep.dataset.ready='1';
  }
}
function pickCatEmoji(e){
  const i=document.getElementById('catEmojiInput');if(i)i.value=e;
  document.querySelectorAll('#catEmojiPick .cat-emo').forEach(el=>el.style.background='');
  if(e&&event&&event.target)event.target.style.background='var(--pri-light)';
}
async function addCustomCat(){
  const ni=document.getElementById('catNameInput');const ei=document.getElementById('catEmojiInput');
  const name=(ni.value||'').trim();const emo=(ei&&ei.value)||'';
  if(!name){toast('请输入分类名');return}
  if(getExpenseCats().includes(name)){toast('分类已存在');return}
  const item={n:name,e:emo};
  if(_catIconDraft){item.img=_catIconDraft}
  customExpenseCats.push(item);
  if(await saveExpenseCats()){
    ni.value='';if(ei)ei.value='';_catIconDraft='';
    const pv=document.getElementById('catNewIconPreview');if(pv){pv.src='';pv.style.display='none'}
    renderCatManager();toast('已添加：'+name);
  } else customExpenseCats.pop();
}
async function delCustomCat(idx){
  const removed=customExpenseCats.splice(idx,1)[0];
  if(await saveExpenseCats()){renderCatManager();toast('已删除：'+(removed&&removed.n))}
  else if(removed)customExpenseCats.splice(idx,0,removed);
}
// 记一笔里快速新建分类
function addCustomCatFlow(after){
  const name=prompt('新分类名称（如：咖啡、宠物、通讯）');if(!name||!name.trim())return;
  const emo=prompt('配个 emoji 图标（可留空）','🏷️')||'';
  customExpenseCats.push({n:name.trim(),e:emo.trim()});
  saveExpenseCats().then(function(ok){ if(ok){toast('已添加：'+name.trim());if(after)after();} else customExpenseCats.pop(); });
}
let expandedWeek=-1; // 周视图内联展开的周序号
let weekDetailFull=false; // 展开区是否显示全部明细（默认简报：最多5条）
function formatDay(dayStr) {
  if (!dayStr) return { date: '??', weekday: '?' };
  try { const d = new Date(dayStr); return { date: `${((d.getMonth()+1)+'').padStart(2,'0')}月${(d.getDate()+'').padStart(2,'0')}日`, weekday: '周'+WEEKDAYS[d.getDay()], day: d.getDate() }; } catch { return { date: dayStr.slice(5), weekday: '?', day: 0 }; }
}

function renderExpense(){
  if(expenseViewMode==='calendar'){renderExpenseCalendar();return}
  if(expenseViewMode==='week'){renderExpenseWeek();return}
  const thisMonth=getViewMonth();
  const isCur=thisMonth===getThisMonth();
  const monthWeeks=getMonthWeeks(thisMonth);
  const chipsEl=document.getElementById('expenseChips');
  if(chipsEl){
    let ch='<div class="chip" onclick="shiftViewMonth(-1)" style="padding:6px 10px">‹</div>'
      +'<div class="chip '+(isCur?'active':'')+'" onclick="shiftViewMonth(0);viewMonth=null;render()" style="min-width:88px;text-align:center">'+monthLabel(thisMonth)+'</div>'
      +'<div class="chip" onclick="shiftViewMonth(1)" style="padding:6px 10px'+(isCur?';opacity:.35;pointer-events:none':'')+'">›</div>'
      +'<span style="width:1px;background:var(--border);flex-shrink:0;margin:0 2px"></span>'
      +'<div class="chip '+(currentWeekFilter===-1&&!isCur?'active':'')+'" onclick="currentWeekFilter=-1;render()">'+(isCur?'本月':'全月')+'</div>';
    monthWeeks.forEach((w,i)=>{ch+='<div class="chip '+(currentWeekFilter===i?'active':'')+'" onclick="currentWeekFilter='+i+';render()">第'+w.num+'周</div>'});
    ch+='<span style="width:1px;background:var(--border);flex-shrink:0"></span>';
    ch+='<div class="chip '+(expenseTypeFilter==='all'?'active':'')+'" onclick="expenseTypeFilter='+'\'all\''+';render()">全部</div>';
    ch+='<div class="chip '+(expenseTypeFilter==='支出'?'active':'')+'" onclick="expenseTypeFilter='+'\'支出\''+';render()">日常</div>';
    ch+='<div class="chip '+(expenseTypeFilter==='采购'?'active':'')+'" onclick="expenseTypeFilter='+'\'采购\''+';render()">采购</div>';
    chipsEl.innerHTML=ch;
  }
  let monthExpenses=expenses.filter(e=>{
    if(!e['日期'])return false;
    var note=e['备注']||'';
    if(note.includes('[固定]')||note.includes('[采购]')||note.includes('[采购分期]'))return false;
    try{return getMonth(e['日期'])===thisMonth}catch{return false}
  }).sort((a,b)=>(b['日期']||'')>(a['日期']||'')?1:-1);
  if(currentWeekFilter>=0){monthExpenses=monthExpenses.filter(e=>getWeekForDate(e['日期'],thisMonth)===currentWeekFilter)}
const sq=document.getElementById('expenseSearch')?document.getElementById('expenseSearch').value.toLowerCase():'';
let searched=sq?monthExpenses.filter(e=>(e['备注']||'').toLowerCase().includes(sq)||(e['分类']||'').toLowerCase().includes(sq)):monthExpenses;
  if(expenseTypeFilter!=='all'){searched=searched.filter(e=>e['类型']===expenseTypeFilter)}
  const totalOut=searched.filter(e=>e['类型']==='支出').reduce((s,e)=>s+Number(e['金额']||0),0);
  // 统一口径：月视图与统计模块同用 getBudgetPool（总预算−固定−分期−已花 = 剩余）
  const isMonthView=currentWeekFilter<0;
  const _pool=isMonthView?getBudgetPool(thisMonth):null;
  const purchaseOut=isMonthView?_pool.directPurchaseSpend:0;
  const budgetTotalOut=isMonthView?_pool.totalSpend:totalOut;
  const totalIn=0;
  const net=-totalOut;
  const count=searched.length;
  const periodLabel=currentWeekFilter>=0?'本周':'本月';
  const catMap={};
  searched.filter(e=>e['类型']==='支出').forEach(e=>{const c=e['分类']||'其他';catMap[c]=(catMap[c]||0)+Number(e['金额']||0);});
  const catEntries=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
  let html='';
  const pl=currentWeekFilter>=0?'本周':'本月';
  const wb=isMonthView?_pool.totalBudget:getWeekBudget(thisMonth,currentWeekFilter);
  const budgetUsed=isMonthView?(_pool.totalDeduction+_pool.totalSpend):totalOut;
  const br=isMonthView?_pool.remaining:Math.max(wb-totalOut,0);
  html+=`<div class="ex-header" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
    <div class="a-card" style="padding:12px 10px;text-align:center"><div style="font-size:var(--fs-xs,11px);color:var(--muted)">${pl}支出</div><div class="a-num" style="font-size:22px;font-weight:800;letter-spacing:-.5px;margin-top:2px">¥${budgetTotalOut.toFixed(0)}</div><div style="font-size:10px;color:var(--muted-2);margin-top:2px">采¥${purchaseOut.toFixed(0)} 记¥${(isMonthView?_pool.expenseSpend:totalOut).toFixed(0)}</div></div>
    ${wb>0?`<div class="a-card" style="padding:12px 10px;text-align:center"><div style="font-size:11px;color:var(--muted)">${pl}预算</div><div class="a-num" style="font-size:22px;font-weight:800;letter-spacing:-.5px;margin-top:2px">¥${wb.toFixed(0)}</div>${isMonthView&&_pool.totalDeduction>0?`<div style="font-size:10px;color:var(--muted-2);margin-top:2px">扣固定+分期 ¥${_pool.totalDeduction.toFixed(0)}</div>`:''}</div><div class="a-card" style="padding:12px 10px;text-align:center"><div style="font-size:11px;color:var(--muted)">剩余</div><div class="a-num" style="font-size:22px;font-weight:800;letter-spacing:-.5px;margin-top:2px;color:${br>0?'var(--green)':'var(--red)'}">¥${br.toFixed(0)}</div></div>`:`<div class="a-card" style="padding:12px 10px;text-align:center"><div style="font-size:11px;color:var(--muted)">笔数</div><div class="a-num" style="font-size:22px;font-weight:800;margin-top:2px">${count}</div></div><div class="a-card" style="padding:12px 10px;text-align:center;grid-column:span 2"><div style="font-size:11px;color:var(--muted)">记账支出</div><div class="a-num" style="font-size:22px;font-weight:800;margin-top:2px">¥${totalOut.toFixed(0)}</div></div>`}
  </div>`;
  // Budget dashboard
  if(wb>0){
    const pct=Math.min(budgetUsed/wb*100,100);
    const bc=pct>90?'var(--red)':pct>70?'var(--orange)':'var(--green)';
    const rem=br;
    html+=`<div class="a-card" style="margin:0 0 10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:var(--fs-md);font-weight:700;color:var(--muted)">${pl}预算</span>
        <span style="font-size:var(--fs-md);color:var(--muted)">剩余 <b style="color:${bc}" class="a-num">¥${rem.toFixed(0)}</b></span>
      </div>
      <div style="display:flex;align-items:baseline;gap:8px">
        <span style="font-size:32px;font-weight:800;letter-spacing:-1px" class="a-num">¥${wb.toFixed(0)}</span>
        <span style="font-size:var(--fs-sm);color:var(--muted)" class="a-num">已用 ¥${budgetUsed.toFixed(0)}</span>
        ${isMonthView&&_pool.totalDeduction>0?`<span style="font-size:var(--fs-xs);color:var(--muted-2)" class="a-num">含固定+分期 ¥${_pool.totalDeduction.toFixed(0)}</span>`:''}
      </div>
      <div style="height:6px;background:rgba(120,120,128,.16);border-radius:3px;overflow:hidden;margin:10px 0 6px">
        <div style="width:${pct}%;height:100%;background:${bc};border-radius:3px;transition:width .5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:var(--fs-xs);color:var(--muted)">
        <span>${pct.toFixed(0)}% 已用</span>
        <span>${currentWeekFilter>=0?(function(){var ws=getMonthWeeks(thisMonth);return '第'+ws[currentWeekFilter].num+'周('+ws[currentWeekFilter].start+'-'+ws[currentWeekFilter].end+'日)'})():'剩余 = 总预算 − 固定 − 分期 − 支出'}</span>
      </div>
    </div>`;
  } else {
    html+=`<div class="a-card" style="text-align:center;padding:14px;margin:0 0 10px">
      <div style="font-size:var(--fs-md);color:var(--muted);margin-bottom:10px">设置本月预算，掌控开销</div>
      <button class="a-btn a-btn-secondary" onclick="openBudgetModal()" style="min-height:36px;font-size:var(--fs-md);display:inline-flex">设置预算</button>
    </div>`;
  }
  
  if(catEntries.length){
    html+=`<div class="ex-section" style="background:var(--card);border-radius:var(--r-lg,16px);box-shadow:var(--shadow-1)"><div class="ex-section-title" style="font-size:var(--fs-sm);color:var(--muted);font-weight:600;text-transform:none;letter-spacing:.2px">支出分类</div><div class="ex-chart-area">${donutChart(catEntries,170,'支出')}${donutLegend(catEntries,totalOut)}</div></div>`;
  }
  const dayGroups={};
  searched.forEach(e=>{let day='未知日期';if(e['日期']){try{day=e['日期'].slice(0,10)}catch{}}if(!dayGroups[day])dayGroups[day]=[];dayGroups[day].push(e);});
  html+=`<div class="ex-section" style="background:var(--card);border-radius:var(--r-lg,16px);box-shadow:var(--shadow-1)"><div class="ex-section-title" style="font-size:var(--fs-sm);color:var(--muted);font-weight:600">消费记录</div><div class="ex-timeline">`;
  if(!searched.length) html+=`<div class="a-empty"><div class="a-empty-icon">💰</div><div class="a-empty-title">该月暂无记账</div><div class="a-empty-sub">点右下角 + 记一笔</div></div>`;
  for(const[day,list]of Object.entries(dayGroups)){
    const dayTotal=list.filter(e=>(e['类型']==='支出'||e['类型']==='采购')).reduce((s,e)=>s+Number(e['金额']||0),0);
    const {date,weekday,day:dayNum}=formatDay(day);
    html+=`<div class="ex-day"><div class="ex-day-marker"><div class="ex-day-circle">${dayNum||'?'}</div><div class="ex-day-line"></div></div>
      <div class="ex-day-content"><div class="ex-day-header"><span class="ex-day-date">${date} ${weekday}</span><span class="ex-day-total">-¥${dayTotal.toFixed(2)}</span></div>`;
    list.forEach(e=>{
      const isOut=e['类型']==='支出'||e['类型']==='采购';
      const typeBadge=e['类型']==='采购'?'<span class="a-badge a-badge-purple" style="margin-left:6px">采购</span>':'';const splitBadge=Number(e['分摊周数'])>0?'<span class="a-badge a-badge-orange" style="margin-left:4px">'+e['分摊周数']+'周</span>':'';
      const cc=catColor(e['分类']||'其他');
      // ===== 图片显示 =====
// kv:前缀 -> KV key -> /api/images?key=xxx
// 无kv:前缀 -> base64直接显示（旧数据兼容）
const imgSrc=e['图片']&&e['图片'].startsWith('kv:')?API_BASE + '/api/images?key='+encodeURIComponent(e['图片'].slice(3))+'&token='+encodeURIComponent(getPin()):e['图片'];
      const thumbHtml=imgSrc?`<img class="ex-thumb" src="${imgSrc}" onclick="event.stopPropagation();showFullscreenImg(this.src)">`:'';
      html+=`<div class="swipe-container"><div class="swipe-actions swipe-actions-left"><span>删除</span></div><div class="ex-entry swipe-card" data-id="${e.id}" data-type="expense" style="border-left:none;background:transparent;border-radius:0;padding:10px 4px;box-shadow:none">${thumbHtml}<div class="ex-entry-icon" style="background:${cc}22;color:${cc}">${catIcon(e['分类']||'其他')}</div>
        <div class="ex-entry-info"><div class="ex-entry-cat" style="font-size:var(--fs-lg);font-weight:500">${esc(e['分类']||'其他')}${typeBadge}${splitBadge}</div>${e['日期']&&e['日期'].includes('T')?`<div class="ex-entry-note" style="color:var(--pri);font-weight:600;font-size:11px">${e['日期'].slice(11,16)}</div>`:''}${e['备注']?`<div class="ex-entry-note">${esc(e['备注'])}</div>`:''}</div>
        <div class="ex-entry-amount a-num ${isOut?'ex-amount-out':'ex-amount-in'}" style="font-size:var(--fs-lg);font-weight:600;${isOut?'color:var(--text)':'color:var(--green)'}">${isOut?'-':'+'}¥${Number(e['金额']||0).toFixed(2)}</div>
        <button class="ex-entry-del" data-expense-edit="${e.id}" title="编辑" style="font-size:15px;padding:8px;min-width:36px;min-height:36px">⋯</button></div></div>`;
    });
    html+=`</div></div>`;
  }
  html+=`</div></div>`;
  document.getElementById('expenseContent').innerHTML=html;
}
;
function renderExpenseWeek(){
  const thisMonth=getThisMonth();
  const monthWeeks=getMonthWeeks(thisMonth);
  const pool=getBudgetPool(thisMonth);
  const budget=pool.totalBudget;
  const fixedTotal=pool.fixedDeduction;
  const installmentTotal=pool.installmentDeduction;
  const monthExpenses=expenses.filter(e=>{
    if(!e['日期'])return false;
    var note=e['备注']||'';
    if(note.includes('[固定]')||note.includes('[采购]')||note.includes('[采购分期]'))return false;
    try{return getMonth(e['日期'])===thisMonth}catch{return false}
  });
  const pureExpenseOut=pool.expenseSpend;
  const purchaseOut=pool.directPurchaseSpend;
  const totalOut=pureExpenseOut+purchaseOut;
  const container=document.getElementById('expenseContent');
  if(!container)return;
  let html='';
  // 简洁进度条
  if(budget>0){
    const pool=getBudgetPool(thisMonth);
    const pct=Math.min(pureExpenseOut/pool.available*100,100);
    const bc=pct>90?'var(--red)':pct>70?'var(--orange)':'var(--green)';
    html+='<div class="ex-budget" style="margin:0 0 12px;border-radius:14px;padding:14px">';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
    html+='<span style="font-size:13px;font-weight:700">可用池 ¥'+pool.available.toFixed(0)+'</span>';
    html+='<span style="font-size:12px;color:var(--muted)">已用 '+pct.toFixed(0)+'%</span>';
    html+='</div>';
    html+='<div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden;margin-bottom:6px">';
    html+='<div style="width:'+pct+'%;height:100%;background:'+bc+';border-radius:4px;transition:width .5s"></div>';
    html+='</div>';
    html+='<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)">';
    html+='<span>已用 ¥'+pureExpenseOut.toFixed(0)+' / 可用池 ¥'+pool.available.toFixed(0)+'</span>';
    html+='<span>总预算 ¥'+pool.totalBudget.toFixed(0)+'</span>';
    html+='</div>';
    if(pool.totalDeduction>0){
      html+='<div style="font-size:10px;color:var(--muted);margin-top:4px">扣除固定+分期 ¥'+pool.totalDeduction.toFixed(0)+'</div>';
    }
    html+='</div>';
  } else {
    html+='<div style="text-align:center;padding:12px;margin:0 0 12px;background:var(--card);border-radius:14px;border:1.5px dashed var(--border)">';
    html+='<div style="font-size:13px;color:var(--muted);margin-bottom:8px">💡 未设置预算</div>';
    html+='<button onclick="openBudgetModal()" style="padding:8px 20px;border:none;background:var(--pri-g);color:#fff;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer">🎯 设置预算</button>';
    html+='</div>';
  }

  // 每周卡片（动态预算）
  monthWeeks.forEach(function(w, i){
    const weekExpenses=monthExpenses.filter(function(e){
      var note=e['备注']||'';
      if(note.includes('[固定]')||note.includes('[采购]')||note.includes('[采购分期]'))return false;
      var wi=getWeekForDate(e['日期'],thisMonth);
      if(wi===i)return true;
      var sw=Number(e['分摊周数'])||0;
      if(sw<=0)return false;
      var startW=Number(e['分摊开始周'])||0;
      var offset=i-startW;
      return offset>=0&&offset<sw;
    });
    const weekOut=getWeekSpending(thisMonth,i);
    const weekBudget=getDynamicWeekBudget(thisMonth,i);
    const catMap={};
    weekExpenses.filter(function(e){return e['类型']==='支出'}).forEach(function(e){var c=e['分类']||'其他';catMap[c]=(catMap[c]||0)+getExpenseWeekAmount(e,w.startDate,thisMonth,i)});
    const catEntries=Object.entries(catMap).sort(function(a,b){return b[1]-a[1]});
    html+='<div class="week-card'+(expandedWeek===i?' week-card-open':'')+'" onclick="toggleWeekDetail('+i+',event)">';
    html+='<div class="week-card-header">';
    html+='<div><span class="week-card-title">第'+w.num+'周</span><span class="week-card-dates">'+w.start+'-'+w.end+'日</span></div>';
    html+='<span style="display:flex;align-items:center;gap:6px"><span class="week-card-amount">¥'+weekOut.toFixed(0)+'</span><span style="color:var(--muted-2);font-size:13px;transform:rotate('+(expandedWeek===i?'90deg':'0deg')+');transition:transform .15s;display:inline-block">›</span></span>';
    html+='</div>';
    if(weekBudget>0){
      const wpct=Math.min(weekOut/weekBudget*100,100);
      const wbc=wpct>90?'var(--red)':wpct>70?'var(--orange)':'var(--green)';
      html+='<div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden;margin:8px 0"><div style="width:'+wpct+'%;height:100%;background:'+wbc+';border-radius:3px"></div></div>';
      html+='<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>动态额度 ¥'+weekBudget.toFixed(0)+'</span><span>剩余 ¥'+Math.max(weekBudget-weekOut,0).toFixed(0)+'</span></div>';
    } else if(budget>0) {
      html+='<div style="font-size:11px;color:var(--muted);margin-top:4px">💡 可用池已用完</div>';
    }
    if(catEntries.length>0){
      html+='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">';
      catEntries.slice(0,4).forEach(function(ce){
        html+='<span class="cat-mini-badge">'+esc(ce[0])+' ¥'+ce[1].toFixed(0)+'</span>';
      });
      html+='</div>';
    }
    // ===== 内联展开：简报模式（不离开周视图）=====
    if(expandedWeek===i){
      const inWeek=weekExpenses.filter(e=>{try{return getWeekForDate(e['日期'],thisMonth)===i}catch{return false}});
      const splitIn=weekExpenses.filter(e=>{try{return getWeekForDate(e['日期'],thisMonth)!==i}catch{return false}});
      html+='<div class="week-detail">';
      if(!inWeek.length&&!splitIn.length){
        html+='<div style="text-align:center;padding:10px 0;color:var(--muted);font-size:12px">本周暂无记账</div>';
      } else {
        const allRows=inWeek.slice().sort((a,b)=>(b['日期']||'')<(a['日期']||'')?-1:1);
        const n=allRows.length+splitIn.length;
        const sumWeek=weekOut;
        const dayAvg=sumWeek/Math.max(w.end-w.start+1,1);
        // 简报行
        html+='<div class="wd-brief">'+n+'笔 · 日均 ¥'+dayAvg.toFixed(0);
        const topCat=catEntries.length?catEntries[0]:null;
        if(topCat)html+=' · 最大 '+esc(topCat[0])+' ¥'+topCat[1].toFixed(0);
        html+='</div>';
        // 每日迷你条形
        const daily=[];
        for(let d=w.start;d<=w.end;d++){
          const ds=thisMonth+'-'+String(d).padStart(2,'0');
          const v=inWeek.filter(e=>(e['日期']||'').slice(0,10)===ds&&e['类型']!=='收入').reduce((s,e)=>s+Number(e['金额']||0),0);
          daily.push({d:d,v:v});
        }
        const maxV=Math.max.apply(null,daily.map(x=>x.v).concat([1]));
        html+='<div class="wd-bars">';
        daily.forEach(function(x){
          const h=x.v>0?Math.max(4,Math.round(x.v/maxV*30)):2;
          html+='<div class="wd-bar-col" title="'+x.d+'日 ¥'+x.v.toFixed(0)+'"><div class="wd-bar'+(x.v>0?' has':'')+'" style="height:'+h+'px"></div><span>'+x.d+'</span></div>';
        });
        html+='</div>';
        // 明细：默认最多5条
        const limit=weekDetailFull?999:5;
        const shown=allRows.slice(0,limit);
        shown.forEach(function(e){
          const cc=catColor(e['分类']||'其他');
          const isOut=e['类型']==='支出'||e['类型']==='采购';
          const dd=(e['日期']||'').slice(5,10).replace('-','/');
          html+='<div class="wd-row" data-expense-edit="'+e.id+'" title="点击编辑">'
            +'<span class="wd-dot" style="background:'+cc+'"></span>'
            +'<span class="wd-date">'+dd+'</span>'
            +'<span class="wd-main">'+esc(e['分类']||'其他')+(e['备注']?' · '+esc(e['备注']):'')+'</span>'
            +'<span class="wd-amt a-num'+(isOut?'':' in')+'">'+(isOut?'-':'+')+Number(e['金额']||0).toFixed(0)+'</span>'
            +'</div>';
        });
        // 分摊行（少量展示）
        if(weekDetailFull||splitIn.length<=2){
          splitIn.forEach(function(e){
            const amt=getExpenseWeekAmount(e,w.startDate,thisMonth,i);
            if(amt<=0)return;
            const cc=catColor(e['分类']||'其他');
            html+='<div class="wd-row" data-expense-edit="'+e.id+'" title="点击编辑">'
              +'<span class="wd-dot" style="background:'+cc+'"></span>'
              +'<span class="wd-date">分摊</span>'
              +'<span class="wd-main">'+esc(e['分类']||'其他')+'</span>'
              +'<span class="wd-amt a-num">-'+amt.toFixed(0)+'</span>'
              +'</div>';
          });
        }
        // 折叠/展开其余
        const rest=allRows.length-shown.length+(weekDetailFull?0:0);
        if(allRows.length>5||splitIn.length>2){
          if(!weekDetailFull){
            html+='<div class="wd-more" onclick="event.stopPropagation();weekDetailFull=true;renderExpenseWeek()">展开全部 '+n+' 笔</div>';
          } else {
            html+='<div class="wd-more" onclick="event.stopPropagation();weekDetailFull=false;renderExpenseWeek()">收起</div>';
          }
        }
      }
      html+='</div>';
    }
    html+='</div>';
  });
  container.innerHTML=html;
}

// ===== 月历视图 =====
function initCalMonth(){
  const now=new Date(Date.now()+8*3600*1000);
  calYear=now.getUTCFullYear(); calMonth=now.getUTCMonth();
  calSelectedDate=null;
}
function toggleWeekDetail(i,e){
  // 点击明细行内部（编辑等）不折叠
  if(e&&e.target&&e.target.closest&&e.target.closest('.week-detail')&&!(e.target.closest('.week-card-header')))return;
  if(expandedWeek===i){expandedWeek=-1;}
  else{expandedWeek=i;weekDetailFull=false;}
  if(expenseViewMode==='week')renderExpenseWeek();
  else render();
}
function switchExpenseView(mode){
  expenseViewMode=mode;
  var weekBtn=document.getElementById('viewWeekBtn');
  var listBtn=document.getElementById('viewListBtn');
  var calBtn=document.getElementById('viewCalBtn');
  if(weekBtn)weekBtn.classList.toggle('active',mode==='week');
  if(listBtn)listBtn.classList.toggle('active',mode==='day');
  if(calBtn)calBtn.classList.toggle('active',mode==='calendar');
  if(mode==='calendar'&&!calYear)initCalMonth();
  if(mode==='day'){calSelectedDate=null;currentWeekFilter=-1;}
  render();
}
function calNav(delta){
  calMonth+=delta;
  if(calMonth<0){calMonth=11;calYear--}
  if(calMonth>11){calMonth=0;calYear++}
  calSelectedDate=null;
  renderExpense();
}
function selectCalDay(dateStr){
  calSelectedDate=calSelectedDate===dateStr?null:dateStr;
  renderExpense();
}
function addExpenseForDate(dateStr){
  openExpenseModal();
  // 预填日期
  document.getElementById('eDate').value=dateStr+'T'+new Date(Date.now()+8*3600*1000).toISOString().slice(11,16);
}
function renderExpenseCalendar(){
  const thisMonth=getThisMonth();
  const monthExpenses=expenses.filter(e=>{
    if(!e['日期'])return false;
    var note=e['备注']||'';
    if(note.includes('[固定]')||note.includes('[采购]')||note.includes('[采购分期]'))return false;
    try{return getMonth(e['日期'])===thisMonth}catch{return false}
  });
  const sq=document.getElementById('expenseSearch')?document.getElementById('expenseSearch').value.toLowerCase():'';
  const searched=sq?monthExpenses.filter(e=>(e['备注']||'').toLowerCase().includes(sq)||(e['分类']||'').toLowerCase().includes(sq)):monthExpenses;

  // 按天聚合
  const dayMap={};
  searched.forEach(e=>{
    if(!e['日期'])return;
    try{
      const ds=e['日期'].slice(0,10);
      if(!dayMap[ds])dayMap[ds]={out:0,in:0,count:0,entries:[]};
      const amt=Number(e['金额']||0);
      if((e['类型']==='支出'||e['类型']==='采购'))dayMap[ds].out+=amt; else dayMap[ds].in+=amt;
      dayMap[ds].count++;
      dayMap[ds].entries.push(e);
    }catch{}
  });

  // 月份统计
  const totalOut=searched.filter(e=>(e['类型']==='支出'||e['类型']==='采购')).reduce((s,e)=>s+Number(e['金额']||0),0);
  const totalIn=searched.filter(e=>e['类型']==='收入').reduce((s,e)=>s+Number(e['金额']||0),0);

  // 日历网格
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const today=new Date(Date.now()+8*3600*1000);
  const todayStr=today.getUTCFullYear()+'-'+String(today.getUTCMonth()+1).padStart(2,'0')+'-'+String(today.getUTCDate()).padStart(2,'0');
  const calMonthStr=calYear+'-'+String(calMonth+1).padStart(2,'0');
  const periodLabel2=currentWeekFilter>=0?'本周':'本月';

  let html='';
  // 顶部统计（精简）
  html+=`<div class="ex-header">
    <div class="ex-total-card ex-out"><div class="ex-total-icon">💸</div><div class="ex-total-info"><div class="ex-total-label">${periodLabel2}支出</div><div class="ex-total-val">¥${totalOut.toFixed(2)}</div></div></div>
    <div class="ex-total-card ex-in"><div class="ex-total-icon">💰</div><div class="ex-total-info"><div class="ex-total-label">${periodLabel2}收入</div><div class="ex-total-val">¥${totalIn.toFixed(2)}</div></div></div>
  </div>`;

  // 日历头部
  const monthNames=['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  html+=`<div class="ex-section"><div class="cal-header">
    <div class="cal-nav"><button onclick="calNav(-1)">◀</button></div>
    <div class="cal-title">${calYear}年 ${monthNames[calMonth]}</div>
    <div class="cal-nav"><button onclick="calNav(1)">▶</button></div>
  </div>`;

  // 星期头
  html+=`<div class="cal-weekdays">`;
  ['日','一','二','三','四','五','六'].forEach(d=>{html+=`<div class="cal-weekday">${d}</div>`});
  html+=`</div><div class="cal-grid">`;

  // 空白格
  for(let i=0;i<firstDay;i++) html+=`<div class="cal-day empty"></div>`;

  // 日期格
  for(let d=1;d<=daysInMonth;d++){
    const ds=calMonthStr+'-'+String(d).padStart(2,'0');
    const isToday=ds===todayStr;
    const isSelected=ds===calSelectedDate;
    const dayData=dayMap[ds];
    const hasData=!!dayData;
    let classes='cal-day';
    if(isToday)classes+=' today';
    if(isSelected)classes+=' selected';
    if(hasData)classes+=' has-data';
    let amtHtml='';
    if(dayData){
      const net=dayData.in-dayData.out;
      if(dayData.out>0)amtHtml+=`<div class="cal-day-amt">-¥${dayData.out.toFixed(0)}</div>`;
      if(dayData.in>0)amtHtml+=`<div class="cal-day-amt cal-day-in">+¥${dayData.in.toFixed(0)}</div>`;
    }
    html+=`<div class="${classes}" data-cal-day="${ds}">
      <div class="cal-day-num">${d}</div>${amtHtml}${dayData?`<div class="cal-day-count">${dayData.count}笔</div>`:''}</div>`;
  }
  html+=`</div>`;

  // 选中日明细
  if(calSelectedDate && dayMap[calSelectedDate]){
    const dd=dayMap[calSelectedDate];
    const selDate=new Date(calSelectedDate+'T00:00:00+08:00');
    const dateLabel=(selDate.getMonth()+1)+'月'+selDate.getDate()+'日 周'+WEEKDAYS[selDate.getDay()];
    html+=`<div class="cal-day-detail"><div class="cal-detail-header">
      <div class="cal-detail-date">📅 ${dateLabel}</div>
      <button class="cal-detail-add" data-add-expense="${calSelectedDate}">+ 记一笔</button>
    </div>`;
    if(dd.out>0||dd.in>0){
      html+=`<div style="display:flex;gap:12px;margin-bottom:8px;font-size:13px;font-weight:700">`;
      if(dd.out>0)html+=`<span style="color:var(--red)">💸 支出 ¥${dd.out.toFixed(2)}</span>`;
      if(dd.in>0)html+=`<span style="color:var(--green)">💰 收入 ¥${dd.in.toFixed(2)}</span>`;
      html+=`</div>`;
    }
    dd.entries.forEach(e=>{
      const isOut=e['类型']==='支出';
      const cc=catColor(e['分类']||'其他');
      const imgSrc=e['图片']&&e['图片'].startsWith('kv:')?API_BASE + '/api/images?key='+encodeURIComponent(e['图片'].slice(3))+'&token='+encodeURIComponent(getPin()):e['图片'];
      const thumbHtml=imgSrc?`<img class="ex-thumb" src="${imgSrc}" onclick="event.stopPropagation();showFullscreenImg(this.src)">`:'';
      html+=`<div class="swipe-container"><div class="swipe-actions swipe-actions-left"><span>🗑️ 删除</span></div><div class="ex-entry swipe-card" style="border-left:4px solid ${cc}" data-id="${e.id}" data-type="expense">${thumbHtml}<div class="ex-entry-icon">${catIcon(e['分类']||'其他')}</div>
        <div class="ex-entry-info"><div class="ex-entry-cat">${esc(e['分类']||'其他')}</div>${e['日期']&&e['日期'].includes('T')?`<div class="ex-entry-note" style="color:var(--pri);font-weight:600;font-size:11px">🕐 ${e['日期'].slice(11,16)}</div>`:''}${e['备注']?`<div class="ex-entry-note">${esc(e['备注'])}</div>`:''}</div>
        <div class="ex-entry-amount ${isOut?'ex-amount-out':'ex-amount-in'}">${isOut?'-':'+'}¥${Number(e['金额']||0).toFixed(2)}</div>
        <button class="ex-entry-del" style="opacity:.25" data-expense-edit="${e.id}" title="编辑">✏️</button><button class="ex-entry-del" data-expense-del="${e.id}" title="删除">🗑️</button></div></div>`;
    });
    html+=`</div>`;
  } else if(calSelectedDate){
    // 选中了没有数据的天
    const selDate=new Date(calSelectedDate+'T00:00:00+08:00');
    const dateLabel=(selDate.getMonth()+1)+'月'+selDate.getDate()+'日 周'+WEEKDAYS[selDate.getDay()];
    html+=`<div class="cal-day-detail"><div class="cal-detail-header">
      <div class="cal-detail-date">📅 ${dateLabel}</div>
      <button class="cal-detail-add" data-add-expense="${calSelectedDate}">+ 记一笔</button>
    </div><div class="ex-empty" style="padding:20px"><div class="ex-empty-hint">当天暂无记账</div></div></div>`;
  }

  html+=`</div>`;
  document.getElementById('expenseContent').innerHTML=html;
}
function openExpenseModal(id){
  const m=document.getElementById('expenseModalTitle');
  const eid=document.getElementById('eEditId');
  currentImageData='';
  const preview=document.getElementById('eImagePreview');
  const _sg=document.getElementById('splitGroup');
  const _sb=document.getElementById('splitBtn');
  const _si=document.getElementById('eSplitWeeks');
  function resetSplit(){
    if(_sg)_sg.style.display='none';
    if(_sb){_sb.style.background='var(--bg)';_sb.style.color='var(--text)'}
    if(_si)_si.value='';
  }
  function applySplit(sw){
    if(sw>0){
      if(_sg)_sg.style.display='';
      if(_sb){_sb.style.background='var(--pri)';_sb.style.color='#fff'}
    }else{resetSplit()}
    if(_si)_si.value=sw||'';
    updateSplitPreview();
  }
  fillExpenseCatSelect();
  const _catSel=document.getElementById('eCategory');
  if(_catSel){_catSel.dataset.prev=_catSel.value||'餐饮';_catSel.onchange=function(){onExpenseCatChange(_catSel)}}
  if(id){
    const e=expenses.find(x=>x.id===id);
    if(!e)return;
    m.textContent='\u270f\ufe0f 编辑记账';
    eid.value=id;
    document.getElementById('eAmount').value=Number(e['金额']||0);
    document.getElementById('eNote').value=e['备注']||'';
    document.getElementById('eType').value=e['类型']||'支出';
    fillExpenseCatSelect(e['分类']||'餐饮');
    let d='';
    if(e['日期']){
      try{
        const dt=new Date(e['日期'].includes('T')?e['日期']:e['日期']+'T00:00:00+08:00');
        const pad=n=>String(n).padStart(2,'0');
        d=dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate())+'T'+pad(dt.getHours())+':'+pad(dt.getMinutes());
      }catch{}
    }
    document.getElementById('eDate').value=d;
    if(e['图片']&&e['图片'].startsWith('kv:')){
      const k=e['图片'].slice(3);
      currentImageKey=k;
      currentImageData='';
      document.getElementById('eImageWrap').style.display='block';
      preview.src=API_BASE + '/api/images?key='+encodeURIComponent(k)+'&token='+encodeURIComponent(getPin());
    }else if(e['图片']){
      currentImageData=e['图片'];
      currentImageKey='';
      document.getElementById('eImageWrap').style.display='block';
      preview.src=e['图片'];
    }else{
      preview.src='';
      document.getElementById('eImageWrap').style.display='none';
      const info=document.getElementById('imageSizeInfo');
      info.textContent='';
      info.style.display='none';
    }
    applySplit(Number(e['分摊周数'])||0);
  }else{
    m.textContent='\ud83d\udcb0 记一笔';
    eid.value='';
    document.getElementById('eAmount').value='';
    document.getElementById('eNote').value='';
    document.getElementById('eType').value='支出';
    fillExpenseCatSelect('餐饮');
    resetSplit();
    const now=new Date(Date.now()+8*3600*1000);
    const pad=n=>String(n).padStart(2,'0');
    document.getElementById('eDate').value=now.getUTCFullYear()+'-'+pad(now.getUTCMonth()+1)+'-'+pad(now.getUTCDate())+'T'+pad(now.getUTCHours())+':'+pad(now.getUTCMinutes());
    preview.src='';
    document.getElementById('eImageWrap').style.display='none';
    const info=document.getElementById('imageSizeInfo');
    info.textContent='';
    info.style.display='none';
  }
  document.getElementById('eCameraInput').value='';
  document.getElementById('eGalleryInput').value='';
  document.getElementById('expenseOverlay').classList.add('active');
}
function closeExpenseModal(){document.getElementById('expenseOverlay').classList.remove('active')}
function exportExpenses(){showExportDialog('记账',function(format){const sep=format==='csv'?',':'\t';const mime=format==='csv'?'text/csv':'text/tab-separated-values';const ext=format==='csv'?'.csv':'.tsv';const lines=['日期'+sep+'时间'+sep+'类型'+sep+'分类'+sep+'金额'+sep+'备注'];expenses.forEach(e=>{const ds=e['日期']||'';const datePart=ds.slice(0,10);const timePart=ds.includes('T')?ds.slice(11,16):'';const amt=Number(e['金额']||0).toFixed(2);const note=(e['备注']||'').includes(sep)?'"'+(e['备注']||'').replace(/"/g,'""')+'"':(e['备注']||'');lines.push(datePart+sep+timePart+sep+(e['类型']||'')+sep+(e['分类']||'')+sep+'¥'+amt+sep+note)});const b=new Blob([lines.join('\n')],{type:mime+';charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='记账_'+getThisMonth()+ext;a.click()})}
// 图片: kv:前缀=KV key存飞书图片字段; 无前缀=base64（回退）
async function deleteExpenseImage(){const eid=document.getElementById('eEditId').value;if(!eid)return;if(!confirm('确定删除图片？'))return;const e=expenses.find(x=>x.id===eid);if(!e)return;if(e['图片']&&e['图片'].startsWith('kv:')){const k=e['图片'].slice(3);try{await fetch(API_BASE + API_BASE + '/api/images?key='+encodeURIComponent(k)+'&token='+encodeURIComponent(getPin()),{method:'DELETE'})}catch{}}await expenseApi('PUT',{id:eid,image:''});currentImageData='';currentImageKey='';document.getElementById('eImageWrap').style.display='none';toast('图片已删除');render()}
async function saveExpense(){const amount=parseFloat(document.getElementById('eAmount').value);if(!amount||amount<=0){alert('请输入金额');return}const data={type:document.getElementById('eType').value,category:document.getElementById('eCategory').value,amount,date:document.getElementById('eDate').value,note:document.getElementById('eNote').value.trim()};var _sw=parseInt(document.getElementById('eSplitWeeks').value)||0;if(_sw>0){data.splitWeeks=_sw;data.splitStartWeek=getWeekForDate(document.getElementById('eDate').value, getThisMonth())}if(currentImageData){try{toast('正在上传图片...');const uploadRes=await fetch(API_BASE + '/api/images',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({image:currentImageData})});const uploadData=await uploadRes.json();if(uploadData.key){data.imageKey=uploadData.key;data.image=currentImageData}else{data.image=currentImageData;}}catch(e){data.image=currentImageData;}}else if(currentImageKey){data.imageKey=currentImageKey;}closeExpenseModal();render();const eid=document.getElementById('eEditId').value;let res;if(eid){res=await expenseApi('PUT',{id:eid,...data});if(res&&res.error){alert('更新失败: '+res.error);return}toast('已更新')}else{var _tmpE={id:'tmpE_'+Date.now(),'类型':data.type||'支出','分类':data.category||'其他','金额':data.amount,'日期':data.date,'备注':data.note||'','图片':'','分摊周数':data.splitWeeks||0,'分摊开始周':data.splitStartWeek||''};expenses.unshift(_tmpE);render();res=await expenseApi('POST',data);if(res&&res.error){toast('记录失败');expenses=expenses.filter(function(x){return x.id!==_tmpE.id});render();return}_tmpE.id=res.id||_tmpE.id;toast('已记录')}currentImageData='';currentImageKey='';}
async function delExpense(id){if(!confirm('确定删除？'))return;expenses=expenses.filter(function(x){return x.id!==id});render();const r=await expenseApi('DELETE',null,id);if(r&&r.error){toast('删除失败: '+r.error);loadAll();return}toast('已删除')}


function toggleSplit(){
  var group=document.getElementById('splitGroup');
  var btn=document.getElementById('splitBtn');
  var showing=group.style.display==='none';
  group.style.display=showing?'':'none';
  btn.style.background=showing?'var(--pri)':'var(--bg)';
  btn.style.color=showing?'#fff':'var(--text)';
  if(showing)updateSplitPreview();
}
function updateSplitPreview(){
  var weeks=parseInt(document.getElementById('eSplitWeeks').value)||0;
  var amount=parseFloat(document.getElementById('eAmount').value)||0;
  var preview=document.getElementById('splitPreview');
  if(preview)preview.textContent=weeks>0&&amount>0?'每期 \u00a5'+(amount/weeks).toFixed(2):'';
}
function getWeekStart(dateStr){
  var d=new Date(dateStr);
  var day=d.getDay();
  var diff=d.getDate()-day+(day===0?-6:1);
  var monday=new Date(d.setDate(diff));
  return monday.getFullYear()+'-'+String(monday.getMonth()+1).padStart(2,'0')+'-'+String(monday.getDate()).padStart(2,'0');
}
function getExpenseWeekAmount(e, targetWeekStart, ym, weekIndex){
  var splitWeeks=Number(e['分摊周数'])||0;
  if(splitWeeks<=0)return Number(e['金额']||0);
  var startWeek=Number(e['分摊开始周'])||0;
  var offset=weekIndex-startWeek;
  if(offset<0||offset>=splitWeeks)return 0;
  return Number(e['金额']||0)/splitWeeks;
}
function getWeekDiff(week1,week2){
  var d1=new Date(week1);
  var d2=new Date(week2);
  return Math.round((d2-d1)/(7*24*3600*1000));
}
// ===== AI 助手 =====

// ============================================================
// AI 功能
// ============================================================

// Expense button event delegation
document.addEventListener('click', function(e) {
  var editBtn = e.target.closest('[data-expense-edit]');
  if (editBtn) { openExpenseModal(editBtn.getAttribute('data-expense-edit')); return; }
  var delBtn = e.target.closest('[data-expense-del]');
  if (delBtn) { delExpense(delBtn.getAttribute('data-expense-del')); return; }
});
// === App.expense namespace exports ===
App.expense.formatDay = formatDay;
App.expense.renderExpense = renderExpense;
App.expense.renderExpenseWeek = renderExpenseWeek;
App.expense.initCalMonth = initCalMonth;
App.expense.switchExpenseView = switchExpenseView;
App.expense.toggleWeekDetail = toggleWeekDetail;
App.expense.calNav = calNav;
App.expense.selectCalDay = selectCalDay;
App.expense.addExpenseForDate = addExpenseForDate;
App.expense.renderExpenseCalendar = renderExpenseCalendar;
App.expense.openExpenseModal = openExpenseModal;
App.expense.getExpenseCats = getExpenseCats;
App.expense.loadExpenseCats = loadExpenseCats;
App.expense.catColor = catColor;
App.expense.catIcon = catIcon;
App.expense.openCatManager = openCatManager;
App.expense.closeCatManager = closeCatManager;
App.expense.renderCatManager = renderCatManager;
App.expense.addCustomCat = addCustomCat;
App.expense.delCustomCat = delCustomCat;
App.expense.pickCatEmoji = pickCatEmoji;
App.expense.onExpenseCatChange = onExpenseCatChange;
App.expense.fillExpenseCatSelect = fillExpenseCatSelect;
App.expense.pickCatIconFile = pickCatIconFile;
App.expense.onCatIconFile = onCatIconFile;
App.expense.catImgToIconDataUrl = catImgToIconDataUrl;
App.expense.closeExpenseModal = closeExpenseModal;
App.expense.exportExpenses = exportExpenses;
App.expense.deleteExpenseImage = deleteExpenseImage;
App.expense.saveExpense = saveExpense;
App.expense.delExpense = delExpense;
App.expense.toggleSplit = toggleSplit;
App.expense.updateSplitPreview = updateSplitPreview;
App.expense.getWeekStart = getWeekStart;
App.expense.getExpenseWeekAmount = getExpenseWeekAmount;
App.expense.getWeekDiff = getWeekDiff;
