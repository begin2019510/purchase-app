function skelCards(n){
  let h='';
  for(let i=0;i<n;i++)
    h+=`<div class="skel-card"><div class="skel-row"><div class="skeleton skel-avatar"></div><div class="skel-lines"><div class="skeleton skel-line w60"></div><div class="skeleton skel-line w40 h8"></div></div><div class="skeleton skel-line" style="width:60px;height:20px;border-radius:6px"></div></div></div>`;
  return h;
}
function skelStats(){
  return `<div class="skel-stat-grid"><div class="skeleton skel-stat"></div><div class="skeleton skel-stat"></div><div class="skeleton skel-stat"></div><div class="skeleton skel-stat"></div></div>`;
}
let isLoadingData=false;
function showSkeleton(){
  isLoadingData=true;
  const el=document.getElementById(currentTab==='purchase'?'list':currentTab==='expense'?'expenseContent':'statsContent');
  if(!el)return;
  if(currentTab==='purchase') el.innerHTML=skelCards(5);
  else if(currentTab==='expense') el.innerHTML=skelStats()+skelCards(4);
  else el.innerHTML=skelStats()+skelCards(3);
}
let ptrStartY=0,ptrDist=0,isPulling=false,isRefreshing=false;
function setupPullToRefresh(){
  const wrapper=document.querySelector('.ptr-wrapper');
  if(!wrapper)return;
  const indicator=wrapper.querySelector('.ptr-indicator');
  const spinner=indicator?.querySelector('.ptr-spinner');
  const text=indicator?.querySelector('.ptr-text');
  if(!indicator)return;
  wrapper.addEventListener('touchstart',e=>{
    if(window.scrollY>0||isRefreshing)return;
    ptrStartY=e.touches[0].clientY;
    isPulling=true;
  },{passive:true});
  wrapper.addEventListener('touchmove',e=>{
    if(!isPulling)return;
    ptrDist=Math.max(0,e.touches[0].clientY-ptrStartY);
    if(ptrDist>10){
      const pull=Math.min(ptrDist*0.5,60);
      indicator.style.transform=`translateY(${pull}px)`;
      if(spinner)spinner.style.transform=`rotate(${ptrDist*2}deg)`;
      if(text)text.textContent=pull>50?'松手刷新':'下拉刷新';
    }
  },{passive:true});
  wrapper.addEventListener('touchend',async()=>{
    if(!isPulling)return;
    isPulling=false;
    if(ptrDist>50&&!isRefreshing){
      isRefreshing=true;
      if(spinner){spinner.classList.add('spinning');spinner.style.transform=''}
      if(text)text.textContent='刷新中...';
      indicator.style.transform='translateY(55px)';
      showSkeleton();
      await loadAll();
      if(spinner)spinner.classList.remove('spinning');
      if(text)text.textContent='已刷新';
      setTimeout(()=>{indicator.style.transform='translateY(0)';isRefreshing=false},600);
    }else{
      indicator.style.transform='translateY(0)';
    }
    ptrDist=0;
  });
}
let swipeEl=null,swipeStartX=0,swipeStartY=0,swipeDelta=0,isSwiping=false;
function setupSwipe(){
  document.addEventListener('touchstart',e=>{
    const card=e.target.closest('.swipe-card')||e.target.closest('.card[data-type]');
    if(!card)return;
    // 不拦截按钮点击
    if(e.target.closest('button')||e.target.closest('.card-checkbox'))return;
    swipeEl=card;
    swipeStartX=e.touches[0].clientX;
    swipeStartY=e.touches[0].clientY;
    isSwiping=false;
    swipeDelta=0;
    card.classList.add('swiping');
  },{passive:true});
  document.addEventListener('touchmove',e=>{
    if(!swipeEl)return;
    const dx=e.touches[0].clientX-swipeStartX;
    const dy=e.touches[0].clientY-swipeStartY;
    // 判断方向，只在水平滑动时拦截
    if(!isSwiping&&Math.abs(dy)>Math.abs(dx)){swipeEl.classList.remove('swiping');swipeEl=null;return}
    isSwiping=true;
    swipeDelta=Math.max(-120,Math.min(80,dx));
    swipeEl.style.transform=`translateX(${swipeDelta}px)`;
  },{passive:true});
  document.addEventListener('touchend',async()=>{
    if(!swipeEl)return;
    swipeEl.classList.remove('swiping');
    const card=swipeEl;
    swipeEl=null;
    if(!isSwiping){return}
    isSwiping=false;
    const id=card.dataset.id;
    const type=card.dataset.type; // 'purchase' or 'expense'
    if(swipeDelta<-80){
      // 左滑 → 删除
      card.style.transform='translateX(-100%)';
      card.style.opacity='0';
      card.style.transition='all .25s ease';
      setTimeout(async()=>{
        if(type==='expense') await delExpense(id);
        else await delItem(id);
      },250);
    }else if(swipeDelta>60){
      // 右滑 → 改状态(采购)
      card.style.transform='translateX(0)';
      if(type==='purchase'){
        const item=items.find(x=>x.id===id);
        if(item){
          const status=item['状态']||'待审批';
          const next=NEXT_STATUS[status];
          if(next){
            await api('PATCH',{ids:[id],status:next});
            toast(`已更新为"${next}"`);
            await loadAll();
          }else{toast('已是终态')}
        }
      }else{
        toast('右滑仅支持采购卡片');
      }
    }else{
      card.style.transform='translateX(0)';
    }
  });
}

async function loadAll(){
  showSkeleton();
  try{
    const [r, e] = await Promise.all([
      api('GET'),
      expenseApi('GET')
    ]);
    if(r && !r.error && Array.isArray(r)) items = r;
    if(e && !e.error && Array.isArray(e)) expenses = e;
  }catch{}
  isLoadingData=false;
  render();
}
let catDebounce=null;let lastAICat=null;
function onNoteInput(){
  clearTimeout(catDebounce);
  const note=document.getElementById('eNote').value.trim();
  const suggestEl=document.getElementById('aiCatSuggest');
  if(!note){suggestEl.style.display='none';lastAICat=null;return}
  catDebounce=setTimeout(()=>suggestCategory(note),600);
}
async function suggestCategory(note){
  const suggestEl=document.getElementById('aiCatSuggest');
  const textEl=document.getElementById('aiCatText');
  try{
    const res=await aiRequest('categorize',{note,existingExpenses:expenses});
    if(res.ok&&res.data){
      const d=res.data;
      lastAICat=d;
      const tags=d.tags&&d.tags.length?d.tags.map(t=>`<span style="background:var(--card);padding:1px 6px;border-radius:4px;margin-left:4px;font-size:10px">${t}</span>`).join(''):'';
      textEl.innerHTML=`🤖 建议: <b>${d.category}</b>${tags} <span style="font-size:10px;color:var(--muted);margin-left:4px">${((d.confidence||0)*100).toFixed(0)}% · 点击采纳</span>`;
      suggestEl.style.display='block';
    }
  }catch{suggestEl.style.display='none';lastAICat=null}
}
function applyAICat(){
  if(!lastAICat)return;
  document.getElementById('eCategory').value=lastAICat.category;
  toast(`已切换为「${lastAICat.category}」`);
  document.getElementById('aiCatSuggest').style.display='none';
  lastAICat=null;
}
function openBudgetModal(){const m=getThisMonth();document.getElementById('budgetMonth').value=m;document.getElementById('budgetInput').value=getBudget(m)||'';document.getElementById('budgetOverlay').classList.add('active')}
function closeBudgetModal(){document.getElementById('budgetOverlay').classList.remove('active')}
function saveBudget(){const month=document.getElementById('budgetMonth').value;const val=parseFloat(document.getElementById('budgetInput').value)||0;if(!month)return alert('请选择月份');const b=getBudgets();b[month]=val;setBudgets(b);toast(`已设置 ${month} 预算 ¥${val}`);closeBudgetModal();render()}
function exportData(){const lines=['商品\t平台\t分类\t单价\t数量\t总价\t状态\t日期\t备注'];items.forEach(i=>{const qty=i['数量']||1;const price=i['单价']||0;let ds='';if(i['日期']){try{ds=new Date(i['日期']).toISOString().slice(0,10)}catch{}}lines.push(`${i['商品名称']||''}\t${i['平台']||''}\t${i['分类']||''}\t¥${price}\t${qty}\t¥${(price*qty).toFixed(2)}\t${i['状态']||''}\t${ds}\t${i['备注']||''}`)});const b=new Blob([lines.join('\n')],{type:'text/tab-separated-values;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`采购_${getThisMonth()}.tsv`;a.click()}
