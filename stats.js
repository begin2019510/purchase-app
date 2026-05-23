
function renderStats() {
  const thisMonth = getThisMonth();
  const budget = getBudget(thisMonth);
function openExpenseModal(id){const m=document.getElementById('expenseModalTitle');const eid=document.getElementById('eEditId');currentImageData='';const preview=document.getElementById('eImagePreview');if(id){const e=expenses.find(x=>x.id===id);if(!e)return;m.textContent='✏️ 编辑记账';eid.value=id;document.getElementById('eAmount').value=Number(e['金额']||0);document.getElementById('eNote').value=e['备注']||'';document.getElementById('eType').value=e['类型']||'支出';document.getElementById('eCategory').value=e['分类']||'餐饮';let d='';if(e['日期']){try{const dt=new Date(e['日期'].includes('T')?e['日期']:e['日期']+'T00:00:00+08:00');const pad=n=>String(n).padStart(2,'0');d=dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate())+'T'+pad(dt.getHours())+':'+pad(dt.getMinutes())}catch{}}document.getElementById('eDate').value=d;if(e['图片']&&e['图片'].startsWith('kv:')){const k=e['图片'].slice(3);currentImageKey=k;currentImageData='';document.getElementById('eImageWrap').style.display='block';preview.src='/api/images?key='+encodeURIComponent(k)+'&pin='+getPin()}else if(e['图片']){currentImageData=e['图片'];currentImageKey='';document.getElementById('eImageWrap').style.display='block';preview.src=e['图片']}else{preview.src='';document.getElementById('eImageWrap').style.display='none';const info=document.getElementById('imageSizeInfo');info.textContent='';info.style.display='none'}}else{m.textContent='💰 记一笔';eid.value='';document.getElementById('eAmount').value='';document.getElementById('eNote').value='';document.getElementById('eType').value='支出';document.getElementById('eCategory').value='餐饮';const now=new Date(Date.now()+8*3600*1000);const pad=n=>String(n).padStart(2,'0');document.getElementById('eDate').value=now.getUTCFullYear()+'-'+pad(now.getUTCMonth()+1)+'-'+pad(now.getUTCDate())+'T'+pad(now.getUTCHours())+':'+pad(now.getUTCMinutes());preview.src='';document.getElementById('eImageWrap').style.display='none';const info=document.getElementById('imageSizeInfo');info.textContent='';info.style.display='none'}document.getElementById('eCameraInput').value='';document.getElementById('eGalleryInput').value='';document.getElementById('expenseOverlay').classList.add('active')}
function closeExpenseModal(){document.getElementById('expenseOverlay').classList.remove('active')}
function exportExpenses(){const lines=['日期\t时间\t类型\t分类\t金额\t备注'];expenses.forEach(e=>{const ds=e['日期']||'';const datePart=ds.slice(0,10);const timePart=ds.includes('T')?ds.slice(11,16):'';lines.push(datePart+'\t'+timePart+'\t'+(e['类型']||'')+'\t'+(e['分类']||'')+'\t¥'+(Number(e['金额']||0).toFixed(2))+'\t'+(e['备注']||''))});const b=new Blob([lines.join('\n')],{type:'text/tab-separated-values;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='记账_'+getThisMonth()+'.tsv';a.click()}
// 图片: kv:前缀=KV key存飞书图片字段; 无前缀=base64（回退）
async function deleteExpenseImage(){const eid=document.getElementById('eEditId').value;if(!eid)return;if(!confirm('确定删除图片？'))return;const e=expenses.find(x=>x.id===eid);if(!e)return;if(e['图片']&&e['图片'].startsWith('kv:')){const k=e['图片'].slice(3);try{await fetch('/api/images?key='+encodeURIComponent(k)+'&pin='+getPin(),{method:'DELETE'})}catch{}}await expenseApi('PUT',{id:eid,image:''});currentImageData='';currentImageKey='';document.getElementById('eImageWrap').style.display='none';toast('图片已删除');await loadAll()}
async function saveExpense(){const amount=parseFloat(document.getElementById('eAmount').value);if(!amount||amount<=0){alert('请输入金额');return}const data={type:document.getElementById('eType').value,category:document.getElementById('eCategory').value,amount,date:document.getElementById('eDate').value,note:document.getElementById('eNote').value.trim()};if(currentImageData){try{toast('正在上传图片...');const uploadRes=await fetch('/api/images',{method:'POST',headers:{'Content-Type':'application/json','X-API-Key':getPin()},body:JSON.stringify({image:currentImageData})});const uploadData=await uploadRes.json();if(uploadData.key){data.imageKey=uploadData.key;data.image=currentImageData}else{data.image=currentImageData;}}catch(e){data.image=currentImageData;}}else if(currentImageKey){data.imageKey=currentImageKey;}const eid=document.getElementById('eEditId').value;let res;if(eid){res=await expenseApi('PUT',{id:eid,...data});if(res&&res.error){alert('更新失败: '+res.error);return}toast('已更新')}else{res=await expenseApi('POST',data);if(res&&res.error){alert('记录失败: '+res.error);return}toast('已记录')}currentImageData='';currentImageKey='';closeExpenseModal();await loadAll()}
async function delExpense(id){if(!confirm('确定删除？'))return;await expenseApi('DELETE',null,id);toast('已删除');await loadAll()}
function lineChart(data, opts={}){
  // data: [{label, value, color?}]
  const W=opts.width||340, H=opts.height||140, pad={t:20,r:12,b:24,l:36};
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
  const W=opts.width||340, H=opts.height||130, pad={t:16,r:8,b:28,l:8};
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
const monthItems = items.filter(i => getMonth(i['日期']) === thisMonth);
  const monthReturned = monthItems.filter(i => i['状态'] === '已退');
  const monthTotal = monthItems.reduce((s, i) => s + (i['单价'] || 0) * (i['数量'] || 1), 0) - monthReturned.reduce((s, i) => s + (i['单价'] || 0) * (i['数量'] || 1), 0);
  const totalAll = items.reduce((s, i) => s + (i['单价'] || 0) * (i['数量'] || 1), 0) - items.filter(i => i['状态'] === '已退').reduce((s, i) => s + (i['单价'] || 0) * (i['数量'] || 1), 0);
  const pCatMap = {};
  monthItems.forEach(i => { const c = i['分类'] || '其他'; pCatMap[c] = (pCatMap[c] || 0) + (i['单价'] || 0) * (i['数量'] || 1); });
  const pCatEntries = Object.entries(pCatMap).sort((a, b) => b[1] - a[1]);
  const pPlatMap = {};
  monthItems.forEach(i => { const p = i['平台'] || '其他'; pPlatMap[p] = (pPlatMap[p] || 0) + (i['单价'] || 0) * (i['数量'] || 1); });
  const pPlatEntries = Object.entries(pPlatMap).sort((a, b) => b[1] - a[1]);
  const statusMap = {};
  items.forEach(i => { const s = i['状态'] || '待审批'; statusMap[s] = (statusMap[s] || 0) + 1; });
const monthExpenses = expenses.filter(e => {
    if (!e['日期']) return false;
    try { return getMonth(e['日期']) === thisMonth } catch { return false }
  });
  // 统计不受搜索过滤，直接用月度全量数据
  const searched = monthExpenses;
  const totalOut = searched.filter(e => e['类型'] === '支出').reduce((s, e) => s + Number(e['金额'] || 0), 0);
  const totalIn = searched.filter(e => e['类型'] === '收入').reduce((s, e) => s + Number(e['金额'] || 0), 0);
  const eCatMap = {};
  searched.filter(e => e['类型'] === '支出').forEach(e => { const c = e['分类'] || '其他'; eCatMap[c] = (eCatMap[c] || 0) + Number(e['金额'] || 0); });
  const eCatEntries = Object.entries(eCatMap).sort((a, b) => b[1] - a[1]);
let html = '';
  // --- 总览卡片 ---
  html += `<div class="stat-card" style="background:var(--pri-g);color:#fff;border:none">
    <h3 style="color:#fff">📊 本月总览</h3>
    ${miniCards([
      ['🛒', '采购', '¥' + monthTotal.toFixed(0), 'var(--pri)'],
      ['💸', '支出', '¥' + totalOut.toFixed(0), '#fca5a5'],
      ['💰', '收入', '¥' + totalIn.toFixed(0), '#86efac'],
      ['📈', '结余', '¥' + (totalIn - totalOut - monthTotal).toFixed(0), '#fde68a']
    ])}
  </div>`;
  // --- 采购统计 ---
  html += `<div class="stat-card"><h3>🛒 采购统计</h3>`;
  html += miniCards([
    ['📦', '本月', monthItems.length + '件', ''],
    ['💵', '本月花费', '¥' + monthTotal.toFixed(0), 'var(--pri)'],
    ['📊', '总花费', '¥' + totalAll.toFixed(0), 'var(--muted)'],
    ['🗄️', '已归档', (statusMap['已归档'] || 0) + '件', 'var(--muted)']
  ]);
  if (budget) {
    const pct = Math.min(monthTotal / budget * 100, 100);
    const color = monthTotal > budget ? 'var(--red)' : monthTotal > budget * 0.8 ? 'var(--orange)' : 'var(--green)';
    html += `<div style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;margin-bottom:4px"><span>💰 预算</span><span>¥${monthTotal.toFixed(0)} / ¥${budget}</span></div>
      <div class="budget-bar"><div class="budget-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="budget-label"><span>${pct.toFixed(0)}% 已用</span><span>剩余 ¥${Math.max(budget - monthTotal, 0).toFixed(0)}</span></div>
    </div>`;
  }
  if (pCatEntries.length) {
    html += `<div style="margin-top:14px"><div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px">📂 分类</div>${barChart(pCatEntries, null, l => CAT_COLORS[l] || '#94a3b8')}</div>`;
  }
  if (pPlatEntries.length) {
    html += `<div style="margin-top:14px"><div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:8px">🏪 平台</div>${barChart(pPlatEntries, null, () => 'var(--pri)')}</div>`;
  }
  html += '</div>';
  // --- 记账统计 ---
  html += `<div class="stat-card"><h3>💰 记账统计</h3>`;
  html += miniCards([
    ['💸', '本月支出', '¥' + totalOut.toFixed(0), 'var(--red)'],
    ['💰', '本月收入', '¥' + totalIn.toFixed(0), 'var(--green)'],
    ['📊', '净收支', '¥' + (totalIn - totalOut).toFixed(0), totalIn - totalOut >= 0 ? 'var(--green)' : 'var(--red)'],
    ['📝', '笔数', searched.length + '笔', '']
  ]);
  if (eCatEntries.length) {
    html += `<div class="stat-card"><h3>💰 记账分类</h3><div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;justify-content:center">
      ${donutChart(eCatEntries, 180, '支出')}${donutLegend(eCatEntries, totalOut)}
    </div></div>`;
  }
  html += '</div>';
  // --- 采购明细 ---
  if (items.length) {
    html += `<div class="stat-card"><h3>📈 采购明细</h3><div style="font-size:12px;color:var(--muted);margin-bottom:10px">各状态占比</div>`;
    const totalItems = items.length;
    Object.entries(statusMap).forEach(([s, n]) => {
      const pct = (n / totalItems * 100).toFixed(0);
      const cls = 'badge-' + s;
      html += `<div class="cat-row"><span class="badge ${cls}" style="min-width:40px">${s}</span><div class="cat-bar"><div class="cat-bar-fill" style="width:${pct}%;background:${s === '待审批' ? 'var(--orange)' : s === '已审批' ? 'var(--blue)' : s === '已下单' ? '#8b5cf6' : s === '已到' ? 'var(--green)' : s === '已归档' ? '#6b7280' : 'var(--red)'}"></div></div><span style="min-width:50px;text-align:right;font-weight:700">${n}件 (${pct}%)</span></div>`;
    });
    html += '</div>';
  }
  // --- 每日支出趋势 ---
  const dailyData = getMonthDailyData(expenses, thisMonth, '支出');
  if (dailyData.some(d => d.value > 0)) {
    const dayMax = Math.max(...dailyData.map(d => d.value));
    const dayAvg = dailyData.reduce((s, d) => s + d.value, 0) / dailyData.filter(d => d.value > 0).length || 0;
    const dayActive = dailyData.filter(d => d.value > 0).length;
    html += `<div class="stat-card"><h3>📉 每日支出趋势</h3>`;
    html += `<div style="display:flex;gap:12px;margin-bottom:4px;font-size:11px;color:var(--muted)">`;
    html += `<span>最高 <b style="color:var(--text)">¥${dayMax.toFixed(0)}</b></span>`;
    html += `<span>日均 <b style="color:var(--text)">¥${dayAvg.toFixed(0)}</b></span>`;
    html += `<span>记账 <b style="color:var(--text)">${dayActive}天</b></span>`;
    html += `</div>`;
    html += lineChart(dailyData, { color: '#ef4444', height: 130 });
    html += `</div>`;
  }
  // --- 每周支出对比 ---
  const weekData = getWeekData(expenses, thisMonth, '支出');
  if (weekData.some(d => d.value > 0)) {
    const weekMax = Math.max(...weekData.map(d => d.value));
    html += `<div class="stat-card"><h3>📊 每周支出对比</h3>`;
    html += barChartV(weekData.map((d, i) => ({ ...d, label: 'W' + (i + 1), color: `hsl(${220 + i * 30}, 70%, 60%)` })), { height: 120 });
    html += `</div>`;
  }
  // --- 收入vs支出趋势 ---
  const outDaily = getMonthDailyData(expenses, thisMonth, '支出');
  const inDaily = getMonthDailyData(expenses, thisMonth, '收入');
  const hasIncome = inDaily.some(d => d.value > 0);
  if (hasIncome) {
    html += `<div class="stat-card"><h3>💹 收入 vs 支出</h3>`;
    const W = 340, H = 140, pad = { t: 20, r: 12, b: 24, l: 36 };
    const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    const days = outDaily.length;
    const allVals = [...outDaily.map(d => d.value), ...inDaily.map(d => d.value)];
    const maxV = Math.max(...allVals, 1);
    const stepX = days > 1 ? cw / (days - 1) : cw;
    const mkPath = (data) => data.map((d, i) => {
      const x = pad.l + (days > 1 ? i * stepX : cw / 2);
      const y = pad.t + ch - d.value / maxV * ch;
      return (i === 0 ? 'M' : 'L') + x + ',' + y;
    }).join(' ');
    const outPath = mkPath(outDaily);
    const inPath = mkPath(inDaily);
    // grid
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + ch * i / 3;
      const v = maxV - maxV * i / 3;
      grid += `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" class="trend-grid"/>`;
      grid += `<text x="${pad.l - 4}" y="${y + 3}" class="trend-val" style="text-anchor:end;font-size:8px">¥${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)}</text>`;
    }
    const labelStep = days <= 7 ? 1 : days <= 14 ? 2 : Math.ceil(days / 7);
    let xLabels = '';
    outDaily.forEach((d, i) => {
      if (i % labelStep === 0 || i === outDaily.length - 1) {
        const x = pad.l + (days > 1 ? i * stepX : cw / 2);
        xLabels += `<text x="${x}" y="${H - 4}" class="trend-label">${d.label}</text>`;
      }
    });
    html += `<div class="trend-chart"><svg class="trend-svg" viewBox="0 0 ${W} ${H}">
      ${grid}
      <path d="${inPath}" stroke="#10b981" class="trend-line"/>
      <path d="${outPath}" stroke="#ef4444" class="trend-line"/>
      ${xLabels}
    </svg></div>`;
    html += `<div class="trend-summary">
      <div class="trend-summary-item"><span class="trend-summary-dot" style="background:#ef4444"></span>支出</div>
      <div class="trend-summary-item"><span class="trend-summary-dot" style="background:#10b981"></span>收入</div>
    </div>`;
    html += `</div>`;
  }
  // --- 分类支出排行 ---
  if (eCatEntries.length) {
    const topCats = eCatEntries.slice(0, 6);
    const catMax = topCats[0][1] || 1;
    html += `<div class="stat-card"><h3>🏆 支出分类排行</h3>`;
    html += barChartV(topCats.map(([l, v]) => ({ label: l, value: v, color: CAT_COLORS[l] || '#94a3b8' })), { height: 120 });
    html += `</div>`;
  }
  document.getElementById('statsContent').innerHTML = html;
}
