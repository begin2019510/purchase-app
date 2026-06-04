// expense.js - Expense Rendering, Calendar, Week, CRUD
// ===== 记账渲染 =====
const CAT_ICONS={'餐饮':'🍜','交通':'🚗','购物':'🛍️','娱乐':'🎮','居住':'🏠','医疗':'🏥','教育':'📚','其他':'📌'};
const CAT_COLORS = {'日用':'#6366f1','服饰':'#8b5cf6','饮食':'#10b981','电子':'#3b82f6','交通':'#f59e0b','其他':'#94a3b8','餐饮':'#ef4444','购物':'#ec4899','娱乐':'#8b5cf6','居住':'#10b981','医疗':'#f59e0b','教育':'#3b82f6'};
const WEEKDAYS=['日','一','二','三','四','五','六'];
let expenseTypeFilter='all';
function formatDay(dayStr) {
  if (!dayStr) return { date: '??', weekday: '?' };
  try { const d = new Date(dayStr); return { date: `${((d.getMonth()+1)+'').padStart(2,'0')}月${(d.getDate()+'').padStart(2,'0')}日`, weekday: '周'+WEEKDAYS[d.getDay()], day: d.getDate() }; } catch { return { date: dayStr.slice(5), weekday: '?', day: 0 }; }
}

function renderExpense(){
  if(expenseViewMode==='calendar'){renderExpenseCalendar();return}
  if(expenseViewMode==='week'){renderExpenseWeek();return}
  const thisMonth=getThisMonth();
  const monthWeeks=getMonthWeeks(thisMonth);
  const chipsEl=document.getElementById('expenseChips');
  if(chipsEl){
    let ch='<div class="chip '+(currentWeekFilter===-1?'active':'')+'" onclick="currentWeekFilter=-1;render()">本月</div>';
    monthWeeks.forEach((w,i)=>{ch+='<div class="chip '+(currentWeekFilter===i?'active':'')+'" onclick="currentWeekFilter='+i+';render()">第'+w.num+'周</div>'});
    ch+='<span style="width:1px;background:var(--border);flex-shrink:0"></span>';
    ch+='<div class="chip '+(expenseTypeFilter==='all'?'active':'')+'" onclick="expenseTypeFilter='+'\'all\''+';render()">全部</div>';
    ch+='<div class="chip '+(expenseTypeFilter==='支出'?'active':'')+'" onclick="expenseTypeFilter='+'\'支出\''+';render()">日常</div>';
    ch+='<div class="chip '+(expenseTypeFilter==='采购'?'active':'')+'" onclick="expenseTypeFilter='+'\'采购\''+';render()">采购</div>';
    chipsEl.innerHTML=ch;
  }
  let monthExpenses=expenses.filter(e=>{
    if(!e['日期'])return false;
    try{return getMonth(e['日期'])===thisMonth}catch{return false}
  }).sort((a,b)=>(b['日期']||'')>(a['日期']||'')?1:-1);
  if(currentWeekFilter>=0){monthExpenses=monthExpenses.filter(e=>getWeekForDate(e['日期'],thisMonth)===currentWeekFilter)}
const sq=document.getElementById('expenseSearch')?document.getElementById('expenseSearch').value.toLowerCase():'';
let searched=sq?monthExpenses.filter(e=>(e['备注']||'').toLowerCase().includes(sq)||(e['分类']||'').toLowerCase().includes(sq)):monthExpenses;
  if(expenseTypeFilter!=='all'){searched=searched.filter(e=>e['类型']===expenseTypeFilter)}
  const totalOut=searched.filter(e=>(e['类型']==='支出'||e['类型']==='采购')).reduce((s,e)=>s+Number(e['金额']||0),0);
  const totalIn=0;
  const net=-totalOut;
  const budget=getBudgetNum(thisMonth);
  const count=searched.length;
  const periodLabel=currentWeekFilter>=0?'本周':'本月';
  const catMap={};
  searched.filter(e=>(e['类型']==='支出'||e['类型']==='采购')).forEach(e=>{const c=e['分类']||'其他';catMap[c]=(catMap[c]||0)+Number(e['金额']||0);});
  const catEntries=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
  let html='';
  const pl=currentWeekFilter>=0?'本周':'本月';
  const wb=currentWeekFilter>=0?getWeekBudget(thisMonth,currentWeekFilter):getBudgetNum(thisMonth);
  const br=Math.max(wb-totalOut,0);
  html+=`<div class="ex-header">
    <div class="ex-total-card ex-out"><div class="ex-total-icon">💸</div><div class="ex-total-info"><div class="ex-total-label">${pl}支出</div><div class="ex-total-val">¥${totalOut.toFixed(2)}</div></div></div>
    ${wb>0?`<div class="ex-total-card ex-net"><div class="ex-total-icon">🎯</div><div class="ex-total-info"><div class="ex-total-label">${pl}预算</div><div class="ex-total-val">¥${wb.toFixed(0)}</div></div></div><div class="ex-total-card ${br>0?'ex-in':'ex-out'}"><div class="ex-total-icon">${br>0?'✅':'⚠️'}</div><div class="ex-total-info"><div class="ex-total-label">剩余</div><div class="ex-total-val">¥${br.toFixed(0)}</div></div></div>`:`<div class="ex-total-card ex-count"><div class="ex-total-icon">📝</div><div class="ex-total-info"><div class="ex-total-label">笔数</div><div class="ex-total-val">${count}笔</div></div></div>`}
  </div>`;
  // Budget dashboard
  if(wb>0){
    const pct=Math.min(totalOut/wb*100,100);
    const bc=pct>90?'var(--red)':pct>70?'var(--orange)':'var(--green)';
    const rem=Math.max(wb-totalOut,0);
    html+=`<div class="ex-budget" style="margin:0 0 10px;border-radius:14px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:13px;font-weight:700">${pl}预算</span>
        <span style="font-size:12px;color:var(--muted)">剩余 <b style="color:${bc}">¥${rem.toFixed(0)}</b></span>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:4px">
        <span style="font-size:28px;font-weight:900;color:var(--pri)">¥${wb.toFixed(0)}</span>
        <span style="font-size:12px;color:var(--muted)">已用 ¥${totalOut.toFixed(0)}</span>
      </div>
      <div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden;margin-bottom:6px">
        <div style="width:${pct}%;height:100%;background:${bc};border-radius:4px;transition:width .5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)">
        <span>${pct.toFixed(0)}% 已用</span>
        <span>${currentWeekFilter>=0?(function(){var ws=getMonthWeeks(thisMonth);return '第'+ws[currentWeekFilter].num+'周('+ws[currentWeekFilter].start+'-'+ws[currentWeekFilter].end+'日)'})():'月度预算'}</span>
      </div>
    </div>`;
  } else {
    html+=`<div style="text-align:center;padding:12px;margin:0 0 10px;background:var(--card);border-radius:14px;border:1.5px dashed var(--border)">
      <div style="font-size:13px;color:var(--muted);margin-bottom:8px">💡 未设置预算</div>
      <button onclick="openBudgetModal()" style="padding:8px 20px;border:none;background:var(--pri-g);color:#fff;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer">🎯 设置预算</button>
    </div>`;
  }
  
  if(catEntries.length){
    html+=`<div class="ex-section"><div class="ex-section-title">📂 支出分类</div><div class="ex-chart-area">${donutChart(catEntries,170,'支出')}${donutLegend(catEntries,totalOut)}</div></div>`;
  }
  const dayGroups={};
  searched.forEach(e=>{let day='未知日期';if(e['日期']){try{day=e['日期'].slice(0,10)}catch{}}if(!dayGroups[day])dayGroups[day]=[];dayGroups[day].push(e);});
  html+=`<div class="ex-section"><div class="ex-section-title">📅 消费记录</div><div class="ex-timeline">`;
  if(!searched.length) html+=`<div class="ex-empty"><div class="ex-empty-icon">💰</div><div class="ex-empty-text">本月暂无记账</div><div class="ex-empty-hint">点右下角 + 记一笔</div></div>`;
  for(const[day,list]of Object.entries(dayGroups)){
    const dayTotal=list.filter(e=>(e['类型']==='支出'||e['类型']==='采购')).reduce((s,e)=>s+Number(e['金额']||0),0);
    const {date,weekday,day:dayNum}=formatDay(day);
    html+=`<div class="ex-day"><div class="ex-day-marker"><div class="ex-day-circle">${dayNum||'?'}</div><div class="ex-day-line"></div></div>
      <div class="ex-day-content"><div class="ex-day-header"><span class="ex-day-date">${date} ${weekday}</span><span class="ex-day-total">-¥${dayTotal.toFixed(2)}</span></div>`;
    list.forEach(e=>{
      const isOut=e['类型']==='支出'||e['类型']==='采购';
      const typeBadge=e['类型']==='采购'?'<span style="display:inline-block;padding:1px 5px;border-radius:4px;font-size:10px;background:rgba(99,102,241,.15);color:#6366f1;margin-left:4px">采购</span>':'';const splitBadge=Number(e['分摊周数'])>0?'<span style="display:inline-block;padding:1px 5px;border-radius:4px;font-size:10px;background:rgba(245,158,11,.15);color:#f59e0b;margin-left:4px">📊 '+e['分摊周数']+'周</span>':'';
      const cc=CAT_COLORS[e['分类']||'其他']||'#94a3b8';
      // ===== 图片显示 =====
// kv:前缀 -> KV key -> /api/images?key=xxx
// 无kv:前缀 -> base64直接显示（旧数据兼容）
const imgSrc=e['图片']&&e['图片'].startsWith('kv:')?'/api/images?key='+encodeURIComponent(e['图片'].slice(3))+'&token='+encodeURIComponent(getPin()):e['图片'];
      const thumbHtml=imgSrc?`<img class="ex-thumb" src="${imgSrc}" onclick="event.stopPropagation();showFullscreenImg(this.src)">`:'';
      html+=`<div class="swipe-container"><div class="swipe-actions swipe-actions-left"><span>🗑️ 删除</span></div><div class="ex-entry swipe-card" style="border-left:4px solid ${cc}" data-id="${e.id}" data-type="expense">${thumbHtml}<div class="ex-entry-icon">${CAT_ICONS[e['分类']||'其他']||'📌'}</div>
        <div class="ex-entry-info"><div class="ex-entry-cat">${esc(e['分类']||'其他')}${typeBadge}${splitBadge}</div>${e['日期']&&e['日期'].includes('T')?`<div class="ex-entry-note" style="color:var(--pri);font-weight:600;font-size:11px">🕐 ${e['日期'].slice(11,16)}</div>`:''}${e['备注']?`<div class="ex-entry-note">${esc(e['备注'])}</div>`:''}</div>
        <div class="ex-entry-amount ${isOut?'ex-amount-out':'ex-amount-in'}">${isOut?'-':'+'}¥${Number(e['金额']||0).toFixed(2)}</div>
        <button class="ex-entry-del" style="opacity:.25" data-expense-edit="${e.id}" title="编辑">✏️</button><button class="ex-entry-del" data-expense-del="${e.id}" title="删除">🗑️</button></div></div>`;
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
  const budget=getBudgetNum(thisMonth);
  const fixedTotal=getFixedExpenseTotal();
  const monthExpenses=expenses.filter(e=>{
    if(!e['日期'])return false;
    try{return getMonth(e['日期'])===thisMonth}catch{return false}
  });
  const totalOut=monthExpenses.filter(e=>(e['类型']==='支出'||e['类型']==='采购')).reduce((s,e)=>s+Number(e['金额']||0),0);
  const container=document.getElementById('expenseContent');
  if(!container)return;
  let html='';
  // 月度总览
  html+='<div class="ex-header">';
  html+='<div class="ex-total-card ex-out"><div class="ex-total-icon">💸</div><div class="ex-total-info"><div class="ex-total-label">本月支出</div><div class="ex-total-val">¥'+totalOut.toFixed(2)+'</div></div></div>';
  if(budget>0){
    const br=Math.max(budget-totalOut,0);
    html+='<div class="ex-total-card ex-net"><div class="ex-total-icon">🎯</div><div class="ex-total-info"><div class="ex-total-label">月预算</div><div class="ex-total-val">¥'+budget.toFixed(0)+'</div></div></div>';
    html+='<div class="ex-total-card '+(br>0?'ex-in':'ex-out')+'"><div class="ex-total-icon">'+(br>0?'✅':'⚠️')+'</div><div class="ex-total-info"><div class="ex-total-label">剩余</div><div class="ex-total-val">¥'+br.toFixed(0)+'</div></div></div>';
  }
  if(fixedTotal>0){
    html+='<div class="ex-total-card ex-count"><div class="ex-total-icon">📌</div><div class="ex-total-info"><div class="ex-total-label">固定支出</div><div class="ex-total-val">¥'+fixedTotal.toFixed(0)+'</div></div></div>';
  }
  html+='</div>';
  // 月度预算进度条
  if(budget>0){
    const pct=Math.min(totalOut/budget*100,100);
    const bc=pct>90?'var(--red)':pct>70?'var(--orange)':'var(--green)';
    html+='<div class="ex-budget" style="margin:0 0 12px">';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:13px;font-weight:700">月度预算</span><span style="font-size:12px;color:var(--muted)">剩余 <b style="color:'+bc+'">¥'+Math.max(budget-totalOut,0).toFixed(0)+'</b></span></div>';
    html+='<div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden;margin-bottom:4px"><div style="width:'+pct+'%;height:100%;background:'+bc+';border-radius:4px;transition:width .5s"></div></div>';
    html+='<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>'+pct.toFixed(0)+'% 已用</span><span>¥'+totalOut.toFixed(0)+' / ¥'+budget.toFixed(0)+'</span></div>';
    html+='</div>';
  }
  // 每周卡片
  monthWeeks.forEach(function(w, i){
    const weekExpenses=monthExpenses.filter(function(e){
      var wi=getWeekForDate(e['日期'],thisMonth);
      if(wi===i)return true;
      var sw=Number(e['分摊周数'])||0;
      if(sw<=0)return false;
      var startW=Number(e['分摊开始周'])||0;
      var offset=i-startW;
      return offset>=0&&offset<sw;
    });
    const weekOut=weekExpenses.filter(function(e){return (e['类型']==='支出'||e['类型']==='采购')}).reduce(function(s,e){return s+getExpenseWeekAmount(e,w.startDate,thisMonth,i)},0);
    const weekBudget=getWeekBudget(thisMonth,i);
    const catMap={};
    weekExpenses.filter(function(e){return (e['类型']==='支出'||e['类型']==='采购')}).forEach(function(e){var c=e['分类']||'其他';catMap[c]=(catMap[c]||0)+getExpenseWeekAmount(e,w.startDate,thisMonth,i)});
    const catEntries=Object.entries(catMap).sort(function(a,b){return b[1]-a[1]});
    html+='<div class="week-card">';
    html+='<div class="week-card-header">';
    html+='<div><span class="week-card-title">第'+w.num+'周</span><span class="week-card-dates">'+w.start+'-'+w.end+'日</span></div>';
    html+='<span class="week-card-amount">¥'+weekOut.toFixed(0)+'</span>';
    html+='</div>';
    if(weekBudget>0){
      const wpct=Math.min(weekOut/weekBudget*100,100);
      const wbc=wpct>90?'var(--red)':wpct>70?'var(--orange)':'var(--green)';
      html+='<div style="height:6px;background:var(--bg);border-radius:3px;overflow:hidden;margin:8px 0"><div style="width:'+wpct+'%;height:100%;background:'+wbc+';border-radius:3px"></div></div>';
      html+='<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)"><span>预算 ¥'+weekBudget.toFixed(0)+'</span><span>剩余 ¥'+Math.max(weekBudget-weekOut,0).toFixed(0)+'</span></div>';
    } else {
      html+='<div style="font-size:11px;color:var(--muted);margin-top:4px">未设置周预算</div>';
    }
    if(catEntries.length>0){
      html+='<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">';
      catEntries.slice(0,4).forEach(function(ce){
        html+='<span class="cat-mini-badge">'+esc(ce[0])+' ¥'+ce[1].toFixed(0)+'</span>';
      });
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
      const cc=CAT_COLORS[e['分类']||'其他']||'#94a3b8';
      const imgSrc=e['图片']&&e['图片'].startsWith('kv:')?'/api/images?key='+encodeURIComponent(e['图片'].slice(3))+'&token='+encodeURIComponent(getPin()):e['图片'];
      const thumbHtml=imgSrc?`<img class="ex-thumb" src="${imgSrc}" onclick="event.stopPropagation();showFullscreenImg(this.src)">`:'';
      html+=`<div class="swipe-container"><div class="swipe-actions swipe-actions-left"><span>🗑️ 删除</span></div><div class="ex-entry swipe-card" style="border-left:4px solid ${cc}" data-id="${e.id}" data-type="expense">${thumbHtml}<div class="ex-entry-icon">${CAT_ICONS[e['分类']||'其他']||'📌'}</div>
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
  if(id){
    const e=expenses.find(x=>x.id===id);
    if(!e)return;
    m.textContent='\u270f\ufe0f 编辑记账';
    eid.value=id;
    document.getElementById('eAmount').value=Number(e['金额']||0);
    document.getElementById('eNote').value=e['备注']||'';
    document.getElementById('eType').value=e['类型']||'支出';
    document.getElementById('eCategory').value=e['分类']||'餐饮';
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
      preview.src='/api/images?key='+encodeURIComponent(k)+'&token='+encodeURIComponent(getPin());
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
    document.getElementById('eCategory').value='餐饮';
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
async function deleteExpenseImage(){const eid=document.getElementById('eEditId').value;if(!eid)return;if(!confirm('确定删除图片？'))return;const e=expenses.find(x=>x.id===eid);if(!e)return;if(e['图片']&&e['图片'].startsWith('kv:')){const k=e['图片'].slice(3);try{await fetch('/api/images?key='+encodeURIComponent(k)+'&token='+encodeURIComponent(getPin()),{method:'DELETE'})}catch{}}await expenseApi('PUT',{id:eid,image:''});currentImageData='';currentImageKey='';document.getElementById('eImageWrap').style.display='none';toast('图片已删除');await loadAll()}
async function saveExpense(){const amount=parseFloat(document.getElementById('eAmount').value);if(!amount||amount<=0){alert('请输入金额');return}const data={type:document.getElementById('eType').value,category:document.getElementById('eCategory').value,amount,date:document.getElementById('eDate').value,note:document.getElementById('eNote').value.trim()};var _sw=parseInt(document.getElementById('eSplitWeeks').value)||0;if(_sw>0){data.splitWeeks=_sw;data.splitStartWeek=getWeekForDate(document.getElementById('eDate').value, getThisMonth())}if(currentImageData){try{toast('正在上传图片...');const uploadRes=await fetch('/api/images',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({image:currentImageData})});const uploadData=await uploadRes.json();if(uploadData.key){data.imageKey=uploadData.key;data.image=currentImageData}else{data.image=currentImageData;}}catch(e){data.image=currentImageData;}}else if(currentImageKey){data.imageKey=currentImageKey;}const eid=document.getElementById('eEditId').value;let res;if(eid){res=await expenseApi('PUT',{id:eid,...data});if(res&&res.error){alert('更新失败: '+res.error);return}toast('已更新')}else{res=await expenseApi('POST',data);if(res&&res.error){alert('记录失败: '+res.error);return}toast('已记录')}currentImageData='';currentImageKey='';closeExpenseModal();await loadAll()}
async function delExpense(id){if(!confirm('确定删除？'))return;const r=await expenseApi('DELETE',null,id);if(r&&r.error){alert('删除失败: '+r.error);return}toast('已删除');await loadAll()}


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
App.expense.calNav = calNav;
App.expense.selectCalDay = selectCalDay;
App.expense.addExpenseForDate = addExpenseForDate;
App.expense.renderExpenseCalendar = renderExpenseCalendar;
App.expense.openExpenseModal = openExpenseModal;
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
