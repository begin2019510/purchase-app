const CAT_ICONS={'餐饮':'🍜','交通':'🚗','购物':'🛍️','娱乐':'🎮','居住':'🏠','医疗':'🏥','教育':'📚','其他':'📌'};
const CAT_COLORS = {'日用':'#6366f1','服饰':'#8b5cf6','饮食':'#10b981','电子':'#3b82f6','交通':'#f59e0b','其他':'#94a3b8','餐饮':'#ef4444','购物':'#ec4899','娱乐':'#8b5cf6','居住':'#10b981','医疗':'#f59e0b','教育':'#3b82f6'};
const WEEKDAYS=['日','一','二','三','四','五','六'];
function 
// ===== 图片显示 =====
// kv:前缀 -> KV key -> /api/images?key=xxx
// 无kv:前缀 -> base64直接显示（旧数据兼容）
const imgSrc=e['图片']&&e['图片'].startsWith('kv:')?'/api/images?key='+encodeURIComponent(e['图片'].slice(3))+'&pin='+getPin():e['图片'];
      const thumbHtml=imgSrc?`<img class="ex-thumb" src="${imgSrc}" onclick="event.stopPropagation();showFullscreenImg(this.src)">`:'';
      html+=`<div class="swipe-container"><div class="swipe-actions swipe-actions-left"><span>🗑️ 删除</span></div><div class="ex-entry swipe-card" style="border-left:4px solid ${cc}" data-id="${e.id}" data-type="expense">${thumbHtml}<div class="ex-entry-icon">${CAT_ICONS[e['分类']||'其他']||'📌'}</div>
        <div class="ex-entry-info"><div class="ex-entry-cat">${esc(e['分类']||'其他')}</div>${e['日期']&&e['日期'].includes('T')?`<div class="ex-entry-note" style="color:var(--pri);font-weight:600;font-size:11px">🕐 ${e['日期'].slice(11,16)}</div>`:''}${e['备注']?`<div class="ex-entry-note">${esc(e['备注'])}</div>`:''}</div>
        <div class="ex-entry-amount ${isOut?'ex-amount-out':'ex-amount-in'}">${isOut?'-':'+'}¥${Number(e['金额']||0).toFixed(2)}</div>
        <button class="ex-entry-del" style="opacity:.25" onclick="openExpenseModal('${e.id}')" title="编辑">✏️</button><button class="ex-entry-del" onclick="delExpense('${e.id}')" title="删除">🗑️</button></div></div>`;
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


formatDay(dayStr) {
  if (!dayStr) return { date: '??', weekday: '?' };
  try { const d = new Date(dayStr); return { date: `${((d.getMonth()+1)+'').padStart(2,'0')}月${(d.getDate()+'').padStart(2,'0')}日`, weekday: '周'+WEEKDAYS[d.getDay()], day: d.getDate() }; } catch { return { date: dayStr.slice(5), weekday: '?', day: 0 }; }
}
function renderExpense(){
  if(expenseViewMode==='calendar'){renderExpenseCalendar();return}
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
function initCalMonth(){
  const now=new Date(Date.now()+8*3600*1000);
  calYear=now.getUTCFullYear(); calMonth=now.getUTCMonth();
  calSelectedDate=null;
}
function switchExpenseView(mode){
  expenseViewMode=mode;
  document.getElementById('viewListBtn').classList.toggle('active',mode==='list');
  document.getElementById('viewCalBtn').classList.toggle('active',mode==='calendar');
  if(mode==='calendar'&&!calYear)initCalMonth();
  if(mode==='list')calSelectedDate=null;
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
      if(e['类型']==='支出')dayMap[ds].out+=amt; else dayMap[ds].in+=amt;
      dayMap[ds].count++;
      dayMap[ds].entries.push(e);
    }catch{}
  });

  // 月份统计
  const totalOut=searched.filter(e=>e['类型']==='支出').reduce((s,e)=>s+Number(e['金额']||0),0);
  const totalIn=searched.filter(e=>e['类型']==='收入').reduce((s,e)=>s+Number(e['金额']||0),0);

  // 日历网格
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const today=new Date(Date.now()+8*3600*1000);
  const todayStr=today.getUTCFullYear()+'-'+String(today.getUTCMonth()+1).padStart(2,'0')+'-'+String(today.getUTCDate()).padStart(2,'0');
  const calMonthStr=calYear+'-'+String(calMonth+1).padStart(2,'0');

  let html='';
  // 顶部统计（精简）
  html+=`<div class="ex-header">
    <div class="ex-total-card ex-out"><div class="ex-total-icon">💸</div><div class="ex-total-info"><div class="ex-total-label">本月支出</div><div class="ex-total-val">¥${totalOut.toFixed(2)}</div></div></div>
    <div class="ex-total-card ex-in"><div class="ex-total-icon">💰</div><div class="ex-total-info"><div class="ex-total-label">本月收入</div><div class="ex-total-val">¥${totalIn.toFixed(2)}</div></div></div>
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
    html+=`<div class="${classes}" onclick="selectCalDay('${ds}')">
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
      <button class="cal-detail-add" onclick="addExpenseForDate('${calSelectedDate}')">+ 记一笔</button>
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
      const imgSrc=e['图片']&&e['图片'].startsWith('kv:')?'/api/images?key='+encodeURIComponent(e['图片'].slice(3))+'&pin='+getPin():e['图片'];
      const thumbHtml=imgSrc?`<img class="ex-thumb" src="${imgSrc}" onclick="event.stopPropagation();showFullscreenImg(this.src)">`:'';
      html+=`<div class="swipe-container"><div class="swipe-actions swipe-actions-left"><span>🗑️ 删除</span></div><div class="ex-entry swipe-card" style="border-left:4px solid ${cc}" data-id="${e.id}" data-type="expense">${thumbHtml}<div class="ex-entry-icon">${CAT_ICONS[e['分类']||'其他']||'📌'}</div>
        <div class="ex-entry-info"><div class="ex-entry-cat">${esc(e['分类']||'其他')}</div>${e['日期']&&e['日期'].includes('T')?`<div class="ex-entry-note" style="color:var(--pri);font-weight:600;font-size:11px">🕐 ${e['日期'].slice(11,16)}</div>`:''}${e['备注']?`<div class="ex-entry-note">${esc(e['备注'])}</div>`:''}</div>
        <div class="ex-entry-amount ${isOut?'ex-amount-out':'ex-amount-in'}">${isOut?'-':'+'}¥${Number(e['金额']||0).toFixed(2)}</div>
        <button class="ex-entry-del" style="opacity:.25" onclick="openExpenseModal('${e.id}')" title="编辑">✏️</button><button class="ex-entry-del" onclick="delExpense('${e.id}')" title="删除">🗑️</button></div></div>`;
    });
    html+=`</div>`;
  } else if(calSelectedDate){
    // 选中了没有数据的天
    const selDate=new Date(calSelectedDate+'T00:00:00+08:00');
    const dateLabel=(selDate.getMonth()+1)+'月'+selDate.getDate()+'日 周'+WEEKDAYS[selDate.getDay()];
    html+=`<div class="cal-day-detail"><div class="cal-detail-header">
      <div class="cal-detail-date">📅 ${dateLabel}</div>
      <button class="cal-detail-add" onclick="addExpenseForDate('${calSelectedDate}')">+ 记一笔</button>
    </div><div class="ex-empty" style="padding:20px"><div class="ex-empty-hint">当天暂无记账</div></div></div>`;
  }

  html+=`</div>`;
  document.getElementById('expenseContent').innerHTML=html;
}
