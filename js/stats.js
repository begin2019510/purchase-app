// stats.js - Chart Functions & Statistics
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

// ===== SVG 趋势图 =====
function lineChart(data, opts={}){
  // data: [{label, value, color?}]
  const isDesktop=typeof window!=='undefined'&&window.innerWidth>768;const W=opts.width||(isDesktop?600:340), H=opts.height||(isDesktop?280:140), pad={t:20,r:12,b:24,l:36};
  const cw=W-pad.l-pad.r, ch=H-pad.t-pad.b;
  if(!data.length)return '<div class="empty-chart">暂无数据</div>';
  const vals=data.map(d=>d.value);
  const maxV=Math.max(...vals,1);
  const minV=0;
  const range=maxV-minV||1;
  const stepX=data.length>1?cw/(data.length-1):cw;
  const color=opts.color||'var(--pri)';
  // 生成点坐标
  const pts=data.map((d,i)=>({
    x:pad.l+(data.length>1?i*stepX:cw/2),
    y:pad.t+ch-(d.value-minV)/range*ch,
    v:d.value, label:d.label, color:d.color||color
  }));
  // 折线path
  const linePath=pts.map((p,i)=>(i===0?'M':'L')+p.x+','+p.y).join(' ');
  // 面积path
  const areaPath=linePath+` L${pts[pts.length-1].x},${pad.t+ch} L${pts[0].x},${pad.t+ch} Z`;
  // 网格线
  const gridLines=4;
  let grid='';
  for(let i=0;i<=gridLines;i++){
    const y=pad.t+ch*i/gridLines;
    const v=maxV-range*i/gridLines;
    grid+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" class="trend-grid"/>`;
    grid+=`<text x="${pad.l-4}" y="${y+3}" class="trend-val" style="text-anchor:end;font-size:8px">¥${v>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0)}</text>`;
  }
  // X轴标签（每隔几个显示）
  const labelStep=data.length<=7?1:data.length<=14?2:Math.ceil(data.length/7);
  let xLabels='';
  pts.forEach((p,i)=>{
    if(i%labelStep===0||i===pts.length-1){
      xLabels+=`<text x="${p.x}" y="${H-4}" class="trend-label">${p.label}</text>`;
    }
  });
  // 圆点
  let dots='';
  pts.forEach(p=>{
    if(p.v>0){
      dots+=`<circle cx="${p.x}" cy="${p.y}" r="3" fill="var(--card)" stroke="${p.color}" stroke-width="2" class="trend-dot"/>`;
    }
  });
  return `<div class="trend-chart"><svg class="trend-svg" viewBox="0 0 ${W} ${H}">
    ${grid}
    <path d="${areaPath}" fill="${color}" class="trend-area"/>
    <path d="${linePath}" stroke="${color}" class="trend-line"/>
    ${dots}${xLabels}
  </svg></div>`;
}

function barChartV(data, opts={}){
  // data: [{label, value, color?}]
  const isDesktop=typeof window!=='undefined'&&window.innerWidth>768;const W=opts.width||(isDesktop?600:340), H=opts.height||(isDesktop?260:130), pad={t:16,r:8,b:28,l:8};
  const cw=W-pad.l-pad.r, ch=H-pad.t-pad.b;
  if(!data.length)return '<div class="empty-chart">暂无数据</div>';
  const maxV=Math.max(...data.map(d=>d.value),1);
  const barW=Math.min(cw/data.length*0.6,36);
  const gap=cw/data.length;
  const color=opts.color||'var(--pri)';
  // 网格
  const gridLines=3;
  let grid='';
  for(let i=0;i<=gridLines;i++){
    const y=pad.t+ch*i/gridLines;
    const v=maxV-maxV*i/gridLines;
    grid+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" class="trend-grid"/>`;
    grid+=`<text x="${pad.l}" y="${y-3}" class="trend-val" style="font-size:8px">¥${v>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0)}</text>`;
  }
  let bars='';
  data.forEach((d,i)=>{
    const x=pad.l+i*gap+(gap-barW)/2;
    const bh=Math.max(d.value/maxV*ch,2);
    const y=pad.t+ch-bh;
    const c=d.color||color;
    bars+=`<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="3" fill="${c}" opacity="0.85">
      <animate attributeName="height" from="0" to="${bh}" dur="0.5s" fill="freeze"/>
      <animate attributeName="y" from="${pad.t+ch}" to="${y}" dur="0.5s" fill="freeze"/>
    </rect>`;
    bars+=`<text x="${x+barW/2}" y="${H-8}" class="trend-label">${d.label}</text>`;
    if(d.value>0){
      bars+=`<text x="${x+barW/2}" y="${y-4}" class="trend-tooltip">¥${d.value>=1000?(d.value/1000).toFixed(1)+'k':d.value.toFixed(0)}</text>`;
    }
  });
  return `<div class="trend-chart"><svg class="trend-svg" viewBox="0 0 ${W} ${H}">
    ${grid}${bars}
  </svg></div>`;
}

function getMonthDailyData(expenses, monthStr, type='支出'){
  // 按天聚合某月数据
  const days=new Date(parseInt(monthStr.slice(0,4)),parseInt(monthStr.slice(5,7)),0).getDate();
  const result=[];
  for(let d=1;d<=days;d++){
    const ds=monthStr+'-'+String(d).padStart(2,'0');
    const dayTotal=expenses.filter(e=>{
      if(!e['日期']||e['类型']!==type)return false;
      try{return e['日期'].slice(0,10)===ds}catch{return false}
    }).reduce((s,e)=>s+Number(e['金额']||0),0);
    result.push({label:d+'',value:dayTotal});
  }
  return result;
}

function getWeekData(expenses, monthStr, type='支出'){
  // 按周聚合某月数据
  const days=new Date(parseInt(monthStr.slice(0,4)),parseInt(monthStr.slice(5,7)),0).getDate();
  const weeks=[];
  let weekStart=1;
  while(weekStart<=days){
    const weekEnd=Math.min(weekStart+6,days);
    let total=0;
    for(let d=weekStart;d<=weekEnd;d++){
      const ds=monthStr+'-'+String(d).padStart(2,'0');
      total+=expenses.filter(e=>{
        if(!e['日期']||e['类型']!==type)return false;
        try{return e['日期'].slice(0,10)===ds}catch{return false}
      }).reduce((s,e)=>s+Number(e['金额']||0),0);
    }
    weeks.push({label:`${weekStart}-${weekEnd}`,value:total});
    weekStart=weekEnd+1;
  }
  return weeks;
}


// ===== 周视图 =====
function animateNumber(el, target, duration) {
  var start = performance.now();
  function tick(now) {
    var progress = Math.min((now - start) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = '\u00a5' + Math.round(target * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderStats() { console.log('renderStats START');
  const thisMonth = getThisMonth();
  const pool = getBudgetPool(thisMonth);
  const monthName = thisMonth.slice(5).replace(/^0/, '') + '月';

  // 数据
  const monthItems = items.filter(i => getMonth(i['日期']) === thisMonth);
  const monthReturned = monthItems.filter(i => i['状态'] === '已退');
  const monthTotal = monthItems.reduce((s, i) => s + (i['单价'] || 0) * (i['数量'] || 1), 0) - monthReturned.reduce((s, i) => s + (i['单价'] || 0) * (i['数量'] || 1), 0);
  const totalAll = items.reduce((s, i) => s + (i['单价'] || 0) * (i['数量'] || 1), 0) - items.filter(i => i['状态'] === '已退').reduce((s, i) => s + (i['单价'] || 0) * (i['数量'] || 1), 0);
  const statusMap = {};
  items.forEach(i => { const s = i['状态'] || '待审批'; statusMap[s] = (statusMap[s] || 0) + 1; });
  const monthExpenses = expenses.filter(e => {
    if (!e['日期']) return false;
    try { return getMonth(e['日期']) === thisMonth } catch { return false }
  });
  const totalOut = monthExpenses.filter(e => {
    if (e['类型'] !== '支出') return false;
    var note = e['备注'] || '';
    if (note.includes('[采购]') || note.includes('[采购分期]')) return false;
    return true;
  }).reduce((s, e) => s + Number(e['金额'] || 0), 0);

  // 分类/平台数据
  const pCatMap = {};
  monthItems.forEach(i => { const c = i['分类'] || '其他'; pCatMap[c] = (pCatMap[c] || 0) + (i['单价'] || 0) * (i['数量'] || 1); });
  const pCatEntries = Object.entries(pCatMap).sort((a, b) => b[1] - a[1]);
  const pPlatMap = {};
  monthItems.forEach(i => { const p = i['平台'] || '其他'; pPlatMap[p] = (pPlatMap[p] || 0) + (i['单价'] || 0) * (i['数量'] || 1); });
  const pPlatEntries = Object.entries(pPlatMap).sort((a, b) => b[1] - a[1]);
  const eCatMap = {};
  monthExpenses.filter(e => e['类型'] === '支出').forEach(e => { const c = e['分类'] || '其他'; eCatMap[c] = (eCatMap[c] || 0) + Number(e['金额'] || 0); });
  const eCatEntries = Object.entries(eCatMap).sort((a, b) => b[1] - a[1]);

  let html = '';

  // ===== 预算池瀑布流 =====
  if (pool.totalBudget > 0) {
    const usagePct = pool.available > 0 ? Math.min((pool.directPurchaseSpend + pool.expenseSpend) / pool.available * 100, 100) : 0;
    const barColor = usagePct > 90 ? "var(--red)" : usagePct > 70 ? "var(--orange)" : "var(--green)";
    html += '<div class="budget-waterfall">';
    // Header: total budget
    html += '<div class="budget-waterfall-header">';
    html += '<div class="budget-waterfall-title">' + monthName + '预算总池</div>';
    html += '<div class="budget-waterfall-big" data-animate-num="' + pool.totalBudget + '">\u00a50</div>';
    html += '</div>';
    // Deduction rows
    html += '<div class="budget-deductions">';
    if (pool.fixedDeduction > 0) {
      html += '<div class="budget-deduction-row"><span>📌 固定支出</span><span style="color:var(--orange);font-weight:700">-\u00a5' + pool.fixedDeduction.toFixed(0) + '</span></div>';
    }
    if (pool.installmentDeduction > 0) {
      html += '<div class="budget-deduction-row"><span>📦 分期还款</span><span style="color:#8b5cf6;font-weight:700">-\u00a5' + pool.installmentDeduction.toFixed(0) + '</span></div>';
    }
    html += '</div>';
    // Divider
    html += '<hr class="budget-waterfall-divider">';
    // Available pool
    html += '<div class="budget-available">';
    html += '<div class="budget-available-label">可用预算池</div>';
    html += '<div class="budget-available-num" data-animate-num="' + pool.available + '" data-animate-delay="500">\u00a50</div>';
    html += '</div>';
    // Progress bar
    const dedPct = pool.totalBudget > 0 ? Math.min((pool.fixedDeduction + pool.installmentDeduction) / pool.totalBudget * 100, 100) : 0;
    const usePct = pool.available > 0 ? Math.min((pool.directPurchaseSpend + pool.expenseSpend) / pool.available * 100, 100) : 0;
    html += '<div class="budget-progress-bar">';
    html += '<div class="budget-progress-fill" id="budgetPoolFill" data-width="' + usePct.toFixed(1) + '" style="background:' + barColor + '"></div>';
    html += '</div>';
    html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)">';
    html += '<span>' + usePct.toFixed(0) + '% 已用</span>';
    html += '<span>\u00a5' + (pool.directPurchaseSpend + pool.expenseSpend).toFixed(0) + ' / \u00a5' + pool.available.toFixed(0) + '</span>';
    html += '</div>';
    // Detail cards
    html += '<div class="budget-detail-cards">';
    html += '<div class="budget-detail-card"><div style="font-size:11px;color:var(--muted)">🛒 采购</div><div style="font-size:18px;font-weight:800;margin-top:4px">\u00a5' + pool.directPurchaseSpend.toFixed(0) + '</div></div>';
    html += '<div class="budget-detail-card"><div style="font-size:11px;color:var(--muted)">💰 记账</div><div style="font-size:18px;font-weight:800;margin-top:4px">\u00a5' + pool.expenseSpend.toFixed(0) + '</div></div>';
    const remColor = pool.remaining >= 0 ? "var(--green)" : "var(--red)";
    html += '<div class="budget-detail-card"><div style="font-size:11px;color:var(--muted)">🏷️ 剩余</div><div style="font-size:18px;font-weight:800;margin-top:4px;color:' + remColor + '">\u00a5' + pool.remaining.toFixed(0) + '</div></div>';
    html += '</div>';
    html += '</div>';
  }
  // Tab 切换
  html += `<div class="stats-tabs">
    <div class="stats-tab active" id="statsTabPurchase" onclick="switchStatsTab('purchase')">🛒 采购</div>
    <div class="stats-tab" id="statsTabExpense" onclick="switchStatsTab('expense')">💰 记账</div>
  </div>`;

  // ===== 采购 =====
  html += `<div id="statsSectionPurchase">`;

  // 本月采购扣减 - hero number
  html += `<div class="stats-hero">
    <div class="stats-hero-label">${monthName}采购消耗</div>
    <div class="stats-hero-num">¥${(pool.directPurchaseSpend + pool.installmentDeduction).toFixed(0)}</div>
    <div class="stats-hero-sub">${monthItems.length}件商品${pool.directPurchaseSpend > 0 ? ' · 直接 ¥' + pool.directPurchaseSpend.toFixed(0) : ''}${pool.installmentDeduction > 0 ? ' · 分期 ¥' + pool.installmentDeduction.toFixed(0) : ''}</div>
  </div>`;

  // 分期概况
  const installmentItems = monthItems.filter(i => (Number(i['分期期数']) || 0) > 1);
  if (installmentItems.length > 0) {
    const instTotalPrice = installmentItems.reduce((s, i) => s + (Number(i['单价']) || 0) * (Number(i['数量']) || 1), 0);
    const instMonthly = installmentItems.reduce((s, i) => {
      var tp = Number(i['分期期数']) || 1;
      return s + (Number(i['分期金额']) || Math.round(((Number(i['单价']) || 0) * (Number(i['数量']) || 1)) / tp));
    }, 0);
    html += '<div class="stats-section" style="margin-bottom:12px"><div class="stats-section-title">📦 分期采购</div>';
    html += '<div style="display:flex;gap:12px;margin-bottom:10px">';
    html += '<div style="flex:1;text-align:center;padding:10px;background:var(--bg);border-radius:10px"><div style="font-size:11px;color:var(--muted)">分期商品</div><div style="font-size:20px;font-weight:800;margin-top:4px">' + installmentItems.length + '件</div></div>';
    html += '<div style="flex:1;text-align:center;padding:10px;background:var(--bg);border-radius:10px"><div style="font-size:11px;color:var(--muted)">总价</div><div style="font-size:20px;font-weight:800;margin-top:4px">¥' + instTotalPrice.toFixed(0) + '</div></div>';
    html += '<div style="flex:1;text-align:center;padding:10px;background:var(--bg);border-radius:10px"><div style="font-size:11px;color:var(--muted)">每月还款</div><div style="font-size:20px;font-weight:800;margin-top:4px;color:var(--pri)">¥' + instMonthly.toFixed(0) + '</div></div>';
    html += '</div>';
    installmentItems.forEach(function(i) {
      var tp = Number(i['分期期数']) || 1;
      var pd = Number(i['分期已还']) || 0;
      var ia = Number(i['分期金额']) || Math.round(((Number(i['单价']) || 0) * (Number(i['数量']) || 1)) / tp);
      var pct = tp > 0 ? (pd / tp * 100) : 0;
      html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--border)">';
      html += '<div style="flex:1"><div style="font-size:13px;font-weight:600">' + (i['商品名称'] || '未命名') + '</div>';
      html += '<div style="font-size:11px;color:var(--muted)">' + pd + '/' + tp + '期 · ¥' + ia + '/期</div></div>';
      html += '<div style="width:80px;height:6px;background:var(--bg);border-radius:3px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:var(--pri);border-radius:3px"></div></div>';
      html += '</div>';
    });
    html += '</div>';
  }

  // 分类 + 平台并排
  if (pCatEntries.length || pPlatEntries.length) {
    html += `<div class="stats-row">`;
    if (pCatEntries.length) {
      html += `<div class="stats-section"><div class="stats-section-title">📂 分类</div>`;
      const maxVal = pCatEntries[0][1];
      pCatEntries.slice(0, 5).forEach(([l, v]) => {
        const pct = (v / maxVal * 100).toFixed(0);
        html += `<div class="stats-bar-row"><span class="stats-bar-label">${l}</span><div class="stats-bar-track"><div class="stats-bar-fill" style="width:${pct}%;background:${CAT_COLORS[l]||'#94a3b8'}"></div></div><span class="stats-bar-val">¥${v>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0)}</span></div>`;
      });
      html += `</div>`;
    }
    if (pPlatEntries.length) {
      html += `<div class="stats-section"><div class="stats-section-title">🏪 平台</div>`;
      const maxVal = pPlatEntries[0][1];
      pPlatEntries.slice(0, 5).forEach(([l, v]) => {
        const pct = (v / maxVal * 100).toFixed(0);
        html += `<div class="stats-bar-row"><span class="stats-bar-label">${l}</span><div class="stats-bar-track"><div class="stats-bar-fill" style="width:${pct}%;background:var(--pri)"></div></div><span class="stats-bar-val">¥${v>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0)}</span></div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  // 状态分布
  if (items.length) {
    const colors = { '待审批': 'var(--orange)', '已审批': 'var(--blue)', '已下单': '#8b5cf6', '已到': 'var(--green)', '已退': 'var(--red)', '已归档': '#6b7280' };
    const totalItems = items.length;
    html += `<div class="stats-section"><div class="stats-section-title">📋 状态分布</div>`;
    html += `<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:10px">`;
    Object.entries(statusMap).forEach(([s, n]) => {
      html += `<div style="width:${(n/totalItems*100).toFixed(1)}%;background:${colors[s]||'var(--muted)'}" title="${s}: ${n}件"></div>`;
    });
    html += `</div><div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;color:var(--muted)">`;
    Object.entries(statusMap).forEach(([s, n]) => {
      html += `<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${colors[s]||'var(--muted)'};margin-right:4px;vertical-align:middle"></span>${s} ${n}</span>`;
    });
    html += `</div></div>`;
  }
  html += '</div>';

  // ===== 记账 =====
  html += `<div id="statsSectionExpense" style="display:none">`;

  // 记账消耗 - hero number
  html += `<div class="stats-hero">
    <div class="stats-hero-label">${monthName}记账消耗</div>
    <div class="stats-hero-num">¥${pool.expenseSpend.toFixed(0)}</div>
    <div class="stats-hero-sub">可用池 ¥${pool.available.toFixed(0)} · 采购 ¥${pool.directPurchaseSpend.toFixed(0)} · 记账 ¥${pool.expenseSpend.toFixed(0)} · 剩余 <span style="color:${pool.remaining>=0?'var(--green)':'var(--red)'}">¥${pool.remaining.toFixed(0)}</span></div>
  </div>`;

  // 每日趋势
  const dailyData = getMonthDailyData(expenses, thisMonth, '支出');
  if (dailyData.some(d => d.value > 0)) {
    const dayMax = Math.max(...dailyData.map(d => d.value));
    const dayAvg = dailyData.reduce((s, d) => s + d.value, 0) / Math.max(dailyData.filter(d => d.value > 0).length, 1);
    html += `<div class="stats-section">
      <div class="stats-section-title">📉 每日支出 <span style="float:right;font-weight:400;font-size:11px">最高 ¥${dayMax.toFixed(0)} · 日均 ¥${dayAvg.toFixed(0)}</span></div>
      ${lineChart(dailyData, { color: '#ef4444', height: (window.innerWidth > 768) ? 280 : 140 })}
    </div>`;
  }

  // 分类 + 每周并排
  const weekData = getWeekData(expenses, thisMonth, '支出');
  if (eCatEntries.length || weekData.some(d => d.value > 0)) {
    html += `<div class="stats-row">`;
    if (eCatEntries.length) {
      html += `<div class="stats-section"><div class="stats-section-title">📂 支出分类</div>`;
      const maxCat = eCatEntries[0][1];
      eCatEntries.slice(0, 5).forEach(([l, v]) => {
        const pct = (v / maxCat * 100).toFixed(0);
        html += `<div class="stats-bar-row"><span class="stats-bar-label">${l}</span><div class="stats-bar-track"><div class="stats-bar-fill" style="width:${pct}%;background:${CAT_COLORS[l]||'#94a3b8'}"></div></div><span class="stats-bar-val">¥${v>=1000?(v/1000).toFixed(1)+'k':v.toFixed(0)}</span></div>`;
      });
      html += `</div>`;
    }
    if (weekData.some(d => d.value > 0)) {
      html += `<div class="stats-section"><div class="stats-section-title">📊 每周</div>${barChartV(weekData.map((d, i) => ({ ...d, label: 'W' + (i + 1), color: `hsl(${220 + i * 30}, 70%, 60%)` })), { height: (window.innerWidth > 768) ? 260 : 120 })}</div>`;
    }
    html += `</div>`;
  }
  html += '</div>';

  document.getElementById('statsContent').innerHTML = html;
  // Trigger animations
  setTimeout(function(){
    document.querySelectorAll('[data-animate-num]').forEach(function(el){
      var delay = Number(el.dataset.animateDelay) || 0;
      var duration = 800;
      if(delay > 0){
        setTimeout(function(){ animateNumber(el, Number(el.dataset.animateNum), duration); }, delay);
      } else {
        animateNumber(el, Number(el.dataset.animateNum), duration);
      }
    });
    var fill=document.getElementById('budgetPoolFill');
    if(fill){
      setTimeout(function(){ fill.style.width = fill.dataset.width + '%'; }, 800);
    }
  }, 100);
  console.log('renderStats DONE html_len='+html.length);
}

function switchStatsTab(tab) {
  document.getElementById('statsSectionPurchase').style.display = tab === 'purchase' ? '' : 'none';
  document.getElementById('statsSectionExpense').style.display = tab === 'expense' ? '' : 'none';
  document.getElementById('statsTabPurchase').className = tab === 'purchase' ? 'stats-tab active' : 'stats-tab';
  document.getElementById('statsTabExpense').className = tab === 'expense' ? 'stats-tab active' : 'stats-tab';
}


// === App.stats namespace exports ===
App.stats.barChart = barChart;
App.stats.donutChart = donutChart;
App.stats.donutLegend = donutLegend;
App.stats.miniCards = miniCards;
App.stats.lineChart = lineChart;
App.stats.barChartV = barChartV;
App.stats.getMonthDailyData = getMonthDailyData;
App.stats.getWeekData = getWeekData;
App.stats.renderStats = renderStats;
App.stats.switchStatsTab = switchStatsTab;
