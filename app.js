
// ============================================================
// 版本 & 更新日志
// ============================================================
const APP_VERSION='2.8.1';
function showVersion(){document.getElementById('versionBadge').textContent='v'+APP_VERSION}
const CHANGELOG=[
  {v:'2.8.0',date:'2026-05-25',items:['AI 需求评估：输入商品名AI分析历史采购数据+预算+价格趋势给购买建议']},
  {v:'2.7.0',date:'2026-05-24',items:['记账/采购导出增强：支持CSV/TSV格式选择','采购统计增强：分类饼图、平台分布、6个月趋势','离线体验优化：断网检测+黄色横幅提示','在线帮助文档页面']},
  {v:'2.6.0',date:'2026-05-23',items:['代码重构：JS提取为独立app.js文件','CSS已外置为style.css','版本号更新']},
  {v:'2.5.9',date:'2026-05-23',items:['AI智能分类：备注输入时自动推荐分类+标签','AI批量标签提炼：一键分析本月备注生成标签','分类基于历史数据学习用户习惯']},
  {v:'2.5.8',date:'2026-05-23',items:['AI自然语言记账：说句话自动解析金额/分类/时间','AI财务分析报告：消费异常/省钱建议/趋势洞察','AI代理后端：DeepSeek API + Cloudflare Pages Function']},
  {v:'2.5.7',date:'2026-05-23',items:['骨架屏加载动画，告别白屏等待','下拉刷新手势支持','卡片左滑删除、右滑改状态']},
  {v:'2.5.6',date:'2026-05-23',items:['统计页新增每日支出折线趋势图','每周支出柱状对比图','收入vs支出双线对比','支出分类排行柱状图']},
  {v:'2.5.5',date:'2026-05-23',items:['新增记账月历视图：日历网格展示每日收支','点击日期查看当天记账明细','支持月份切换导航','空日期可快捷记一笔','列表/日历视图自由切换']},
  {v:'2.5.4',date:'2026-05-22',items:['图片API返回二进制数据+pin认证','采购统计getMonth时间戳修复','退货金额减法修复','审批流已到打钩修复','记账删图功能','Cron Worker部署']},
  {v:'2.5.3',date:'2026-05-21',items:['图片上传分为拍照+相册两个按钮','拍照用capture=environment，相册无限制','兼容所有手机浏览器']},
  {v:'2.5.2',date:'2026-05-21',items:['图片存储升级：改用Cloudflare KV，告别32KB限制','图片压缩上限提升至800px/500KB','旧图片自动兼容，新图片存KV']},
  {v:'2.5.1',date:'2026-05-21',items:['记账精确时间戳：新建/编辑均支持选择具体时间','导出CSV增加独立时间列','卡片时间显示优化：🕐前缀+正常可见','点击版本号查看更新日志']},
  {v:'2.5.0',date:'2026-05-20',items:['归档功能：已到/已退3天后自动提醒归档','审批流完整流程：待审批→已审批→已下单→已到/已退→已归档','新增archive-check定时任务','Bitable新增归档时间字段']},
  {v:'2.4.2',date:'2026-05-20',items:['审批流分支结构修复：已到和已退是分支而非线性','详情弹窗改版：stepper流程展示+操作按钮','已到/已退终态显示归档按钮']},
  {v:'2.4.1',date:'2026-05-20',items:['详情弹窗重做：飞书审批流风格','竖向stepper时间线','卡片只显示状态+最新时间']},
  {v:'2.4.0',date:'2026-05-20',items:['采购审批流：5步状态管理','自动记录状态变更时间','暗色模式','记账图片附件支持','周度/月度汇总飞书推送']},
  {v:'2.3.0',date:'2026-05-20',items:['暗色模式（跟随系统+手动切换）','记账图片附件（拍照+压缩+全屏预览）','周度/月度汇总飞书推送']},
];
function openChangelog(){const c=document.getElementById('changelogContent');let html='';CHANGELOG.forEach(r=>{html+=`<div class='changelog-ver'>v${r.v}<span class='changelog-date'>${r.date}</span></div><ul class='changelog-list'>`;r.items.forEach(i=>{html+=`<li>${i}</li>`});html+='</ul>'});c.innerHTML=html;document.getElementById('changelogOverlay').classList.add('active')}
function closeChangelog(){document.getElementById('changelogOverlay').classList.remove('active')}
document.getElementById('versionBadge').addEventListener('click',openChangelog);
let currentImageData='';let currentImageKey='';
function toggleDarkMode(){const isDark=document.body.classList.toggle('dark');localStorage.setItem('dark_mode',isDark?'1':'0');document.getElementById('darkModeBtn').textContent=isDark?'☀️':'🌙'}
(function(){if(localStorage.getItem('dark_mode')==='1'){document.body.classList.add('dark');document.getElementById('darkModeBtn').textContent='☀️'}})();
function handleImageUpload(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=function(e){const img=new Image();img.onload=function(){const canvas=document.createElement("canvas");const MAX=800;let w=img.width,h=img.height;if(w>MAX){h=h*MAX/w;w=MAX}if(h>MAX){w=w*MAX/h;h=MAX}canvas.width=w;canvas.height=h;const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,w,h);let q=0.7;let dataUrl=canvas.toDataURL("image/jpeg",q);while(dataUrl.length>500000&&q>0.2){q-=0.1;dataUrl=canvas.toDataURL("image/jpeg",q)}currentImageData=dataUrl;currentImageKey="";const preview=document.getElementById("eImagePreview");preview.src=dataUrl;preview.style.display="block";const info=document.getElementById("imageSizeInfo");info.textContent="[Compressed: "+String((dataUrl.length/1024).toFixed(0))+"KB]";info.style.display="block";};img.src=e.target.result;};reader.readAsDataURL(file)}
function showFullscreenImg(src){document.getElementById('imgFullscreenImg').src=src;document.getElementById('imgFullscreen').classList.add('active')}
const API='/api/items';
const EXPENSE_API='/api/expenses';
let items=[], expenses=[];
let currentStatusFilter='全部',currentCatFilter='全部';
let batchMode=false,selectedIds=new Set();
let currentTab='purchase';
let expenseViewMode='list'; // 'list' | 'calendar'
let calYear, calMonth; // 0-indexed month
let calSelectedDate=null; // 'YYYY-MM-DD'

// ===== Auth =====
function getPin(){return localStorage.getItem('auth_token')||''}
function setPin(p){localStorage.setItem('auth_token',p)}
function getRefreshToken(){return localStorage.getItem('refresh_token')||''}
function setRefreshToken(t){localStorage.setItem('refresh_token',t)}
function clearTokens(){localStorage.removeItem('auth_token');localStorage.removeItem('refresh_token')}
function submitPin(){const username=document.getElementById('loginUsername').value.trim();const password=document.getElementById('loginPassword').value;if(!username||!password){document.getElementById('authError').textContent='请输入用户名和密码';return}doLoginAPI(username,password)}
function doLogin(){const username=document.getElementById('loginUsername').value.trim();const password=document.getElementById('loginPassword').value;if(!username||!password){document.getElementById('authError').textContent='请输入用户名和密码';return}doLoginAPI(username,password)}

let isRefreshing = false;
let refreshPromise = null;

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  if (isRefreshing) return refreshPromise;

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const r = await fetch('/api/auth?action=refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      const d = await r.json();
      if (d.ok && d.token) {
        setPin(d.token);
        setRefreshToken(d.refreshToken);
        return d.token;
      }
      return null;
    } catch {
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function doLoginAPI(username,password){
  document.getElementById('authError').textContent='登录中...';
  try{
    const r=await fetch('/api/auth?action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const d=await r.json();
    if(d.ok&&d.token){setPin(d.token);if(d.refreshToken)setRefreshToken(d.refreshToken);document.getElementById('authScreen').style.display='none';if(d.username==='admin')document.getElementById('adminBtn').style.display='';loadAll();}
    else{document.getElementById('authError').textContent=d.error||'登录失败'}
  }catch(e){document.getElementById('authError').textContent='网络错误'}
}
async function doRegister(){
  const username=document.getElementById('regUsername').value.trim();
  const password=document.getElementById('regPassword').value;
  const inviteCode=document.getElementById('regInviteCode').value.trim();
  if(!username||!password||!inviteCode){document.getElementById('regError').textContent='请填写所有字段';return}
  document.getElementById('regError').textContent='注册中...';
  try{
    const r=await fetch('/api/auth?action=register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,inviteCode})});
    const d=await r.json();
    if(d.ok&&d.token){setPin(d.token);if(d.refreshToken)setRefreshToken(d.refreshToken);document.getElementById('authScreen').style.display='none';loadAll();}
    else{document.getElementById('regError').textContent=d.error||'注册失败'}
  }catch(e){document.getElementById('regError').textContent='网络错误'}
}
function showLogin(){document.getElementById('loginForm').style.display='';document.getElementById('registerForm').style.display='none';document.getElementById('authSubtitle').textContent='请登录';document.getElementById('authError').textContent=''}
function showRegister(){document.getElementById('loginForm').style.display='none';document.getElementById('registerForm').style.display='';document.getElementById('authSubtitle').textContent='邀请码注册';document.getElementById('regError').textContent=''}
document.getElementById('loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
document.getElementById('regInviteCode').addEventListener('keydown',e=>{if(e.key==='Enter')doRegister()});

// ===== 管理员功能 =====

async function loadUserList(){
  const el=document.getElementById('userList');
  try{
    const r=await fetch('/api/auth?action=list-users',{headers:{'Authorization':'Bearer '+getPin()}});
    const d=await r.json();
    if(!d.ok){el.textContent='加载失败';return}
    if(!d.users.length){el.textContent='暂无用户';return}
    el.innerHTML=d.users.map(u=>{
      const isAdmin=u.username==='admin';
      const badge=isAdmin?'<span style="background:var(--pri);color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:6px">管理员</span>':'';
      const del=isAdmin?'':'<button onclick="deleteUser(\''+u.username+'\')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:11px">删除</button>';
      return'<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><div><b>'+u.username+'</b>'+badge+'<div style="font-size:10px;color:var(--muted);margin-top:2px">'+u.createdAt.replace('T',' ').replace('Z','').slice(0,16)+' (UTC) | '+u.inviteType+' '+u.inviteCode+'</div></div>'+del+'</div>';
    }).join('');
  }catch{el.textContent='加载失败'}
}

// ============================================================
// 管理面板
// ============================================================
function openAdminPanel(){document.getElementById('adminPanel').style.display='block';loadInviteList();loadUserList()}
function closeAdminPanel(){document.getElementById('adminPanel').style.display='none'}
async function createInviteCodes(){
  const count=parseInt(document.getElementById('inviteCount').value)||1;
  const el=document.getElementById('newInviteCodes');
  el.textContent='生成中...';
  try{
    const r=await fetch('/api/auth?action=create-invite',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({count})});
    const d=await r.json();
    if(d.ok){el.innerHTML='✅ 已生成:<br>'+d.codes.map(c=>'<b>'+c+'</b>').join('<br>');loadInviteList();}
    else{el.textContent='❌ '+d.error}
  }catch{el.textContent='❌ 网络错误'}
}
async function loadInviteList(){
  const el=document.getElementById('inviteList');
  try{
    const r=await fetch('/api/auth?action=list-invites',{headers:{'Authorization':'Bearer '+getPin()}});
    const d=await r.json();
    if(!d.ok||!d.codes.length){el.textContent='暂无动态邀请码';return}
    el.innerHTML=d.codes.map(c=>{
      const status=c.used?'<span style="color:var(--red)">已使用 '+(c.usedAt?c.usedAt.replace('T',' ').replace('Z','').slice(0,16)+' (UTC)':'')+'</span>':'<span style="color:var(--green)">可用</span>';
      return'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span style="font-family:monospace">'+c.code+'</span>'+status+'<span style="font-size:10px;color:var(--muted)">'+c.createdAt.slice(0,10)+'</span></div>';
    }).join('');
  }catch{el.textContent='加载失败'}
}
async function deleteUser(username){
  if(!confirm('确定删除用户 '+username+' ？\n（数据表会保留，仅删除账号）'))return;
  try{
    const r=await fetch('/api/auth?action=delete-user',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({username})});
    const d=await r.json();
    if(d.ok){alert(d.message);loadInviteList();loadUserList();}
    else{alert(d.error)}
  }catch{alert('网络错误')}
}
async function debugMyAuth(){
  const el=document.getElementById('debugResult');
  el.textContent='查询中...';
  try{
    const r=await fetch('/api/items?debug=auth',{headers:{'Authorization':'Bearer '+getPin()}});
    const d=await r.json();
    el.innerHTML='<pre style="margin:0;white-space:pre-wrap">'+JSON.stringify(d,null,2)+'</pre>';
  }catch(e){el.textContent='错误: '+e.message}
}
async function debugMyAuthStats(){
  const el=document.getElementById('debugResultStats');
  el.textContent='查询中...';
  try{
    const r=await fetch('/api/items?debug=auth',{headers:{'Authorization':'Bearer '+getPin()}});
    const d=await r.json();
    el.innerHTML='<pre style="margin:0;white-space:pre-wrap">'+JSON.stringify(d,null,2)+'</pre>';
  }catch(e){el.textContent='错误: '+e.message}
}

// ============================================================
// 启动 & 认证
// ============================================================
async function verifyAndLoad(){
  try{
    let r=await fetch('/api/auth?action=verify',{headers:{'Authorization':'Bearer '+getPin()}});
    if(r.status===401){
      // access token 过期，尝试用 refresh token 续期
      const newToken=await refreshAccessToken();
      if(newToken){
        r=await fetch('/api/auth?action=verify',{headers:{'Authorization':'Bearer '+newToken}});
      }
    }
    if(!r.ok){
      clearTokens();
      document.getElementById('authScreen').style.display='flex';
      return;
    }
    const d=await r.json();
    document.getElementById('authScreen').style.display='none';
    if(d.ok&&d.username==='admin')document.getElementById('adminBtn').style.display='';
    loadAll();
  }catch{
    document.getElementById('authScreen').style.display='flex';
  }
}
function logout(){
  if(!confirm('确认退出登录？'))return;
  // 通知后端删除 refresh token（best effort）
  fetch('/api/auth?action=logout',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({refreshToken:getRefreshToken()}),
  }).catch(()=>{});
  clearTokens();
  document.getElementById('adminBtn').style.display='none';
  document.getElementById('authScreen').style.display='flex';
  document.getElementById('loginUsername').value='';
  document.getElementById('loginPassword').value='';
}


// ============================================================
// Service Worker & 启动
// ============================================================
// ===== Service Worker =====
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}
// ===== 推送 - 飞书机器人（国内可用） =====
// 无需浏览器权限，配置飞书机器人 webhook 即可
// 配置方法：Cloudflare 环境变量 FEISHU_BOT_WEBHOOK
async function setupPush(){
  const msg = '推送使用飞书机器人\n\n操作步骤：\n1. 飞书打开一个群聊\n2. 群设置 → 群机器人 → 添加机器人\n3. 选择自定义机器人 → 复制 Webhook 地址\n4. 在 Cloudflare Pages 设置中添加环境变量：\n   FEISHU_BOT_WEBHOOK = 复制的地址\n5. 然后 GitHub Actions 每天 20:00 自动发提醒';
  alert(msg);
}

function getBudgets(){try{return JSON.parse(localStorage.getItem('purchase_budgets')||'{}')}catch{return{}}}
function setBudgets(b){localStorage.setItem('purchase_budgets',JSON.stringify(b))}
function getBudget(m){return getBudgets()[m]||0}

// ===== API =====
async function api(method,body,id){
  let url=API;
  const opts={method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()}};
  if(method==='DELETE')url+='?id='+id;
  else if(body)opts.body=JSON.stringify(body);
  let r=await fetch(url,opts);
  if(r.status===401){
    const newToken=await refreshAccessToken();
    if(newToken){
      opts.headers['Authorization']='Bearer '+newToken;
      r=await fetch(url,opts);
    }
    if(r.status===401){clearTokens();document.getElementById('authScreen').style.display='flex';return{error:'unauthorized'}}
  }
  return r.json();
}
async function expenseApi(method,body,id){
  let url=EXPENSE_API;
  const opts={method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()}};
  if(method==='DELETE')url+='?id='+id;
  else if(body)opts.body=JSON.stringify(body);
  let r=await fetch(url,opts);
  if(r.status===401){
    const newToken=await refreshAccessToken();
    if(newToken){
      opts.headers['Authorization']='Bearer '+newToken;
      r=await fetch(url,opts);
    }
    if(r.status===401){clearTokens();document.getElementById('authScreen').style.display='flex';return{error:'unauthorized'}}
  }
  return r.json();
}

// ===== 启动 =====
showVersion();
// 清空可能被浏览器自动填充的搜索框（延迟清空对抗Chrome autofill）
document.getElementById('searchInput').value='';
setTimeout(()=>{document.getElementById('searchInput').value='';render()},100);
setTimeout(()=>{document.getElementById('searchInput').value='';render()},500);
if('serviceWorker' in navigator) document.getElementById('pushBtn').style.display='';
if(getPin()){verifyAndLoad()}else if(getRefreshToken()){refreshAccessToken().then(t=>{if(t)verifyAndLoad();else{clearTokens();document.getElementById('authScreen').style.display='flex';loadAll()}})}else{document.getElementById('authScreen').style.display='flex';loadAll()}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}
function toast(m){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);setTimeout(()=>t.remove(),2200)}
function getMonth(d){if(!d)return null;try{const ts=typeof d==='number'?d:Date.parse(d);return new Date(ts+8*3600*1000).toISOString().slice(0,7)}catch{return null}}
function getThisMonth(){return new Date(Date.now()+8*3600*1000).toISOString().slice(0,7)}
function totalCost(l){return l.reduce((s,i)=>s+(i['单价']||0)*(i['数量']||1),0)}

// ===== 骨架屏 =====
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

// ===== 下拉刷新 =====
let ptrStartY=0,ptrDist=0,isPulling=false,ptrRefreshing=false;

// ============================================================
// 手势 & 交互
// ============================================================
function setupPullToRefresh(){
  const wrapper=document.querySelector('.ptr-wrapper');
  if(!wrapper)return;
  const indicator=wrapper.querySelector('.ptr-indicator');
  const spinner=indicator?.querySelector('.ptr-spinner');
  const text=indicator?.querySelector('.ptr-text');
  if(!indicator)return;
  wrapper.addEventListener('touchstart',e=>{
    if(window.scrollY>0||ptrRefreshing)return;
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
    if(ptrDist>50&&!ptrRefreshing){
      ptrRefreshing=true;
      if(spinner){spinner.classList.add('spinning');spinner.style.transform=''}
      if(text)text.textContent='刷新中...';
      indicator.style.transform='translateY(55px)';
      showSkeleton();
      await loadAll();
      if(spinner)spinner.classList.remove('spinning');
      if(text)text.textContent='已刷新';
      setTimeout(()=>{indicator.style.transform='translateY(0)';ptrRefreshing=false},600);
    }else{
      indicator.style.transform='translateY(0)';
    }
    ptrDist=0;
  });
}

// ===== 卡片滑动 =====
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


// ============================================================
// 数据加载
// ============================================================
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

// ===== 采购渲染 =====

// ============================================================
// 渲染
// ============================================================
function render(){
  if(currentTab==='purchase') renderPurchase();
  else if(currentTab==='expense') renderExpense();
  else if(currentTab==='stats') renderStats();
  updateHeader();
  // DEBUG: 在页面顶部显示状态
  // 延迟检测：3秒后再检查一次
}
function updateHeader(){
  const total=totalCost(items);
  const thisMonth=getThisMonth();
  const monthItems=items.filter(i=>getMonth(i['日期'])===thisMonth);
  const returnedCost=monthItems.filter(i=>i['状态']==='已退').reduce((s,i)=>s+(i['单价']||0)*(i['数量']||1),0);
  const monthTotal=totalCost(monthItems)-returnedCost;
  const expThisMonth=expenses.filter(e=>{
    if(!e['日期'])return false;
    try{return new Date(e['日期']).toISOString().slice(0,7)===thisMonth}catch{return false}
  });
  const expTotal=expThisMonth.filter(e=>e['类型']==='支出').reduce((s,e)=>s+Number(e['金额']||0),0);
  const incTotal=expThisMonth.filter(e=>e['类型']==='收入').reduce((s,e)=>s+Number(e['金额']||0),0);
  document.getElementById('headerStats').innerHTML=`
    <div class="stat"><span class="stat-val">${items.length}</span><span class="stat-lbl">采购</span></div>
    <div class="stat"><span class="stat-val">¥${monthTotal.toFixed(0)}</span><span class="stat-lbl">本月采购</span></div>
    <div class="stat"><span class="stat-val" style="color:#fca5a5">¥${expTotal.toFixed(0)}</span><span class="stat-lbl">本月支出</span></div>
    <div class="stat"><span class="stat-val" style="color:#86efac">¥${incTotal.toFixed(0)}</span><span class="stat-lbl">本月收入</span></div>
  `;
}
function renderPurchase(){
  const q=document.getElementById('searchInput').value.toLowerCase();
  let f=items;
  if(q)f=f.filter(i=>(i['商品名称']||'').toLowerCase().includes(q)||(i['备注']||'').toLowerCase().includes(q));
  if(currentStatusFilter!=='全部')f=f.filter(i=>i['状态']===currentStatusFilter);
  if(currentCatFilter!=='全部')f=f.filter(i=>i['分类']===currentCatFilter);
  const sorted=[...f].sort((a,b)=>(b['日期']||0)-(a['日期']||0));
  const statuses=['全部','待审批','已审批','已下单','已到','已退','已归档'];
  const cats=['全部',...new Set(items.map(i=>i['分类']).filter(Boolean))];
  document.getElementById('statusChips').innerHTML=statuses.map(s=>{const c=s===currentStatusFilter?'active':'';const n=s==='全部'?items.length:items.filter(i=>i['状态']===s).length;return`<div class="chip ${c}" onclick="currentStatusFilter='${s}';render()">${s} ${n}</div>`}).join('')+'<span style="width:1px;background:var(--border);flex-shrink:0"></span>'+cats.map(c=>{const ac=c===currentCatFilter?'active':'';return`<div class="chip ${ac}" onclick="currentCatFilter='${c}';render()">${c}</div>`}).join('');
  const listEl=document.getElementById('list');
  if(batchMode)listEl.classList.add('batch-mode');else listEl.classList.remove('batch-mode');
  if(!sorted.length){listEl.innerHTML='<div class="empty"><div class="icon">📦</div>暂无采购记录<br>点右下角 + 添加</div>';return}
  const groups={};sorted.forEach(i=>{const m=getMonth(i['日期'])||'未设置日期';if(!groups[m])groups[m]=[];groups[m].push(i)});
  let html='';
  for(const[month,list]of Object.entries(groups)){
    const mt=totalCost(list);const dm=month==='未设置日期'?month:month.replace('-','年')+'月';
    html+=`<div class="section-title"><span>${dm}</span><span>¥${mt.toFixed(2)}</span></div>`;
    const statusColors={'待审批':'#f59e0b','已审批':'#3b82f6','已下单':'#8b5cf6','已到':'#10b981','已退':'#ef4444','已归档':'#6b7280'};
    list.forEach(i=>{const qty=i['数量']||1;const price=i['单价']||0;const status=i['状态']||'待审批';const cat=i['分类']||'其他';let ds='';if(i['日期']){try{ds=new Date(i['日期']).toISOString().slice(0,10)}catch{}}const ck=selectedIds.has(i.id);const bc=statusColors[status]||'#94a3b8';
    let tsHtml='';if(i['到货时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">⏰ 到货 ${i['到货时间']}</div>`}else if(i['下单时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">⏰ 下单 ${i['下单时间']}</div>`}else if(i['审批时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">⏰ 审批 ${i['审批时间']}</div>`}else if(i['创建时间']){tsHtml=`<div style="font-size:10px;color:var(--muted);margin-top:4px;opacity:.7">创建 ${i['创建时间']}</div>`}
    html+=`<div class="swipe-container"><div class="swipe-actions swipe-actions-right"><span>→ 下一步</span></div><div class="swipe-actions swipe-actions-left"><span>🗑️ 删除</span></div><div class="card ${ck?'selected':''} swipe-card" style="border-left:4px solid ${bc}" data-id="${i.id}" data-type="purchase" onclick="${batchMode?`toggleSelect('${i.id}')`:`openDetailModal('${i.id}')`}"><div class="checkbox ${ck?'checked':''}" onclick="event.stopPropagation();toggleSelect('${i.id}')">${ck?'✓':''}</div><div class="actions"><button onclick="event.stopPropagation();editItem('${i.id}')" title="编辑">✏️</button><button onclick="event.stopPropagation();delItem('${i.id}')" title="删除">🗑️</button></div><div class="top"><div class="name">${esc(i['商品名称']||'')}</div>${price?`<div class="price">¥${(price*qty).toFixed(2)}</div>`:''}</div><div class="meta"><span>🏪 ${esc(i['平台']||'')}</span><span class="badge badge-${status}">${status}</span><span class="cat-badge">${cat}</span>${ds?`<span>📅 ${ds}</span>`:''}${qty>1?`<span>×${qty}</span>`:''}</div>${i['备注']?`<div class="note">💬 ${esc(i['备注'])}</div>`:''}${tsHtml}</div></div></div>`});
  }
  listEl.innerHTML=html;
}

// ===== 记账渲染 =====
const CAT_ICONS={'餐饮':'🍜','交通':'🚗','购物':'🛍️','娱乐':'🎮','居住':'🏠','医疗':'🏥','教育':'📚','其他':'📌'};
const CAT_COLORS = {'日用':'#6366f1','服饰':'#8b5cf6','饮食':'#10b981','电子':'#3b82f6','交通':'#f59e0b','其他':'#94a3b8','餐饮':'#ef4444','购物':'#ec4899','娱乐':'#8b5cf6','居住':'#10b981','医疗':'#f59e0b','教育':'#3b82f6'};
const WEEKDAYS=['日','一','二','三','四','五','六'];
function formatDay(dayStr) {
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

// ===== SVG 趋势图 =====
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

// ===== 月历视图 =====
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
function renderStats() {
  const thisMonth = getThisMonth();
  const budget = getBudget(thisMonth);
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
  const totalOut = monthExpenses.filter(e => e['类型'] === '支出').reduce((s, e) => s + Number(e['金额'] || 0), 0);
  const totalIn = monthExpenses.filter(e => e['类型'] === '收入').reduce((s, e) => s + Number(e['金额'] || 0), 0);
  const balance = totalIn - totalOut;

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

  // Tab 切换
  html += `<div class="stats-tabs">
    <div class="stats-tab active" id="statsTabPurchase" onclick="switchStatsTab('purchase')">🛒 采购</div>
    <div class="stats-tab" id="statsTabExpense" onclick="switchStatsTab('expense')">💰 记账</div>
  </div>`;

  // ===== 采购 =====
  html += `<div id="statsSectionPurchase">`;

  // 本月采购总额 - hero number
  html += `<div class="stats-hero">
    <div class="stats-hero-label">${monthName}采购总额</div>
    <div class="stats-hero-num">¥${monthTotal.toFixed(0)}</div>
    <div class="stats-hero-sub">${monthItems.length}件商品 · 累计 ¥${totalAll.toFixed(0)}</div>
  </div>`;

  // 预算进度
  if (budget) {
    const pct = Math.min(monthTotal / budget * 100, 100);
    const color = monthTotal > budget ? 'var(--red)' : monthTotal > budget * 0.8 ? 'var(--orange)' : 'var(--green)';
    html += `<div class="stats-section">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:8px"><span>预算</span><span style="color:${color}">¥${monthTotal.toFixed(0)} / ¥${budget}</span></div>
      <div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${color};border-radius:4px"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:6px"><span>${pct.toFixed(0)}% 已用</span><span>剩余 ¥${Math.max(budget - monthTotal, 0).toFixed(0)}</span></div>
    </div>`;
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

  // 结余 - hero number
  html += `<div class="stats-hero">
    <div class="stats-hero-label">${monthName}结余</div>
    <div class="stats-hero-num" style="color:${balance>=0?'var(--green)':'var(--red)'}">¥${balance.toFixed(0)}</div>
    <div class="stats-hero-sub"><span style="color:var(--red)">支出 ¥${totalOut.toFixed(0)}</span> · <span style="color:var(--green)">收入 ¥${totalIn.toFixed(0)}</span></div>
  </div>`;

  // 每日趋势
  const dailyData = getMonthDailyData(expenses, thisMonth, '支出');
  if (dailyData.some(d => d.value > 0)) {
    const dayMax = Math.max(...dailyData.map(d => d.value));
    const dayAvg = dailyData.reduce((s, d) => s + d.value, 0) / Math.max(dailyData.filter(d => d.value > 0).length, 1);
    html += `<div class="stats-section">
      <div class="stats-section-title">📉 每日支出 <span style="float:right;font-weight:400;font-size:11px">最高 ¥${dayMax.toFixed(0)} · 日均 ¥${dayAvg.toFixed(0)}</span></div>
      ${lineChart(dailyData, { color: '#ef4444', height: 140 })}
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
      html += `<div class="stats-section"><div class="stats-section-title">📊 每周</div>${barChartV(weekData.map((d, i) => ({ ...d, label: 'W' + (i + 1), color: `hsl(${220 + i * 30}, 70%, 60%)` })), { height: 120 })}</div>`;
    }
    html += `</div>`;
  }
  html += '</div>';

  document.getElementById('statsContent').innerHTML = html;
}

function switchStatsTab(tab) {
  document.getElementById('statsSectionPurchase').style.display = tab === 'purchase' ? '' : 'none';
  document.getElementById('statsSectionExpense').style.display = tab === 'expense' ? '' : 'none';
  document.getElementById('statsTabPurchase').className = tab === 'purchase' ? 'chip active' : 'chip';
  document.getElementById('statsTabExpense').className = tab === 'expense' ? 'chip active' : 'chip';
}

// ===== Tab 切换 =====

// ============================================================
// Tab 切换
// ============================================================
function switchTab(t){
  currentTab=t;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelector(`.tab:nth-child(${t==='purchase'?1:t==='expense'?2:3})`).classList.add('active');
  document.getElementById('tab-purchase').style.display=t==='purchase'?'':'none';
  document.getElementById('tab-expense').style.display=t==='expense'?'':'none';
  document.getElementById('tab-stats').style.display=t==='stats'?'':'none';
  document.getElementById('fabBtn').style.display=(t==='purchase'||t==='expense')?'':'none';
  document.getElementById('actionPurchase').style.display=t==='purchase'?'':'none';
    document.getElementById('actionExpense').style.display=t==='expense'?'':'none';
    document.getElementById('actionStats').style.display=t==='stats'?'':'none';
  if(t==='expense'&&!calYear)initCalMonth();
  render();
}

// ===== 采购操作 =====
function toggleBatch(){batchMode=!batchMode;selectedIds.clear();document.getElementById('batchBar').classList.toggle('show',batchMode);document.getElementById('batchInfo').textContent='已选 0 项';render()}
function toggleSelect(id){if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);document.getElementById('batchInfo').textContent=`已选 ${selectedIds.size} 项`;render()}
async function batchUpdate(){if(!selectedIds.size)return toast('请先选择商品');const status=document.getElementById('batchStatus').value;const ids=[...selectedIds];toast(`正在更新 ${ids.length} 项...`);const r=await api('PATCH',{ids,status});if(r&&r.error){alert('批量更新失败: '+r.error);return}toast(`已更新 ${ids.length} 项为“${status}”`);selectedIds.clear();toggleBatch();await loadAll()}
async function batchDelete(){if(!selectedIds.size)return;if(!confirm(`确定删除选中的 ${selectedIds.size} 项？`))return;const ids=[...selectedIds];let ok=0;for(const id of ids){try{await api('DELETE',null,id);ok++}catch{}}toast(`已删除 ${ok} 项`);selectedIds.clear();toggleBatch();await loadAll()}

// ============================================================
// 采购 Modal
// ============================================================
function openModal(){document.getElementById('editId').value='';document.getElementById('modalTitle').textContent='新增采购';document.getElementById('fName').value='';document.getElementById('fName').style.display='';document.getElementById('aiEvalResult').style.display='none';document.getElementById('aiEvalResult').textContent='';document.getElementById('chatArea').style.display='none';document.getElementById('chatMessages').innerHTML='';purchaseChatHistory=[];purchaseEvalContext='';document.getElementById('evalPhase').style.display='';document.getElementById('detailPhase').style.display='none';document.getElementById('editPhase').style.display='none';document.getElementById('overlay').classList.add('active')}
function editItem(id){const i=items.find(x=>x.id===id);if(!i)return;document.getElementById('editId').value=id;document.getElementById('modalTitle').textContent='编辑采购';document.getElementById('evalPhase').style.display='none';document.getElementById('detailPhase').style.display='none';document.getElementById('editPhase').style.display='';document.getElementById('fNameEdit').value=i['商品名称']||'';document.getElementById('fPlatformEdit').value=i['平台']||'拼多多';document.getElementById('fCategoryEdit').value=i['分类']||'日用';document.getElementById('fPriceEdit').value=i['单价']||'';document.getElementById('fQtyEdit').value=i['数量']||1;document.getElementById('fStatusEdit').value=i['状态']||'待审批';const d=i['日期'];document.getElementById('fDateEdit').value=d?new Date(d).toISOString().slice(0,10):'';document.getElementById('fNoteEdit').value=i['备注']||'';document.getElementById('overlay').classList.add('active')}
function closeModal(){document.getElementById('overlay').classList.remove('active')}
async function save(){const name=document.getElementById('fNameEdit').value.trim();if(!name){alert('请输入商品名称');return}const data={name,platform:document.getElementById('fPlatformEdit').value,category:document.getElementById('fCategoryEdit').value,price:parseFloat(document.getElementById('fPriceEdit').value)||0,qty:parseInt(document.getElementById('fQtyEdit').value)||1,status:document.getElementById('fStatusEdit').value,date:document.getElementById('fDateEdit').value||null,note:document.getElementById('fNoteEdit').value.trim()||null};const editId=document.getElementById('editId').value;if(editId){const r=await api('PUT',{id:editId,...data});if(r&&r.error){alert('更新失败: '+r.error);return}toast('已更新')}else{const r=await api('POST',data);if(r&&r.error){alert('添加失败: '+r.error);return}toast('已添加')}closeModal();await loadAll()}

async function delItem(id){if(!confirm('确定删除？'))return;const r=await api('DELETE',null,id);if(r&&r.error){alert('删除失败: '+r.error);return}toast('已删除');await loadAll()}

// ===== 审批流操作 =====
const NEXT_STATUS={'待审批':'已审批','已审批':'已下单','已下单':'已到'};
const APPROVAL_TITLES={'待审批':'✅ 审批确认','已审批':'🛒 确认下单','已下单':'📦 确认收货'};
const APPROVAL_TEXTS={'待审批':'确认审批通过？通过后状态变为“已审批”','已审批':'确认下单？通过后状态变为“已下单”','已下单':'确认收货？通过后状态变为“已到”'};
function showApprovalModal(id){
  const item=items.find(x=>x.id===id);
  if(!item)return;
  const status=item['状态']||'待审批';
  const next=NEXT_STATUS[status];
  if(!next)return;
  const qty=Number(item['数量'])||1;
  const price=Number(item['单价'])||0;
  const total=price*qty;
  document.getElementById('approvalTitle').textContent=APPROVAL_TITLES[status]||'确认操作';
  document.getElementById('approvalContent').innerHTML=`
    <div style="font-size:15px;font-weight:700;margin-bottom:12px">${esc(item['商品名称']||'')}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:4px">单价 ¥${price.toFixed(2)} × ${qty}</div>
    <div style="font-size:20px;font-weight:800;color:var(--pri);margin-bottom:16px">总价 ¥${total.toFixed(2)}</div>
    <div style="font-size:14px;font-weight:600;color:var(--orange)">${APPROVAL_TEXTS[status]}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:6px">${status} → ${next}</div>
  `;
  const btn=document.getElementById('approvalConfirmBtn');
  btn.onclick=async function(){
    await api('PATCH',{ids:[id],status:next});
    toast(`已更新为“${next}”`);
    closeApprovalModal();
    await loadAll();
  };
  document.getElementById('approvalOverlay').classList.add('active');
}
function closeApprovalModal(){document.getElementById('approvalOverlay').classList.remove('active')}

// ===== 记账操作 =====

// ============================================================
// 记账 Modal
// ============================================================
function openExpenseModal(id){const m=document.getElementById('expenseModalTitle');const eid=document.getElementById('eEditId');currentImageData='';const preview=document.getElementById('eImagePreview');if(id){const e=expenses.find(x=>x.id===id);if(!e)return;m.textContent='✏️ 编辑记账';eid.value=id;document.getElementById('eAmount').value=Number(e['金额']||0);document.getElementById('eNote').value=e['备注']||'';document.getElementById('eType').value=e['类型']||'支出';document.getElementById('eCategory').value=e['分类']||'餐饮';let d='';if(e['日期']){try{const dt=new Date(e['日期'].includes('T')?e['日期']:e['日期']+'T00:00:00+08:00');const pad=n=>String(n).padStart(2,'0');d=dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate())+'T'+pad(dt.getHours())+':'+pad(dt.getMinutes())}catch{}}document.getElementById('eDate').value=d;if(e['图片']&&e['图片'].startsWith('kv:')){const k=e['图片'].slice(3);currentImageKey=k;currentImageData='';document.getElementById('eImageWrap').style.display='block';preview.src='/api/images?key='+encodeURIComponent(k)+'&pin='+getPin()}else if(e['图片']){currentImageData=e['图片'];currentImageKey='';document.getElementById('eImageWrap').style.display='block';preview.src=e['图片']}else{preview.src='';document.getElementById('eImageWrap').style.display='none';const info=document.getElementById('imageSizeInfo');info.textContent='';info.style.display='none'}}else{m.textContent='💰 记一笔';eid.value='';document.getElementById('eAmount').value='';document.getElementById('eNote').value='';document.getElementById('eType').value='支出';document.getElementById('eCategory').value='餐饮';const now=new Date(Date.now()+8*3600*1000);const pad=n=>String(n).padStart(2,'0');document.getElementById('eDate').value=now.getUTCFullYear()+'-'+pad(now.getUTCMonth()+1)+'-'+pad(now.getUTCDate())+'T'+pad(now.getUTCHours())+':'+pad(now.getUTCMinutes());preview.src='';document.getElementById('eImageWrap').style.display='none';const info=document.getElementById('imageSizeInfo');info.textContent='';info.style.display='none'}document.getElementById('eCameraInput').value='';document.getElementById('eGalleryInput').value='';document.getElementById('expenseOverlay').classList.add('active')}
function closeExpenseModal(){document.getElementById('expenseOverlay').classList.remove('active')}
function exportExpenses(){showExportDialog('记账',function(format){const sep=format==='csv'?',':'\t';const mime=format==='csv'?'text/csv':'text/tab-separated-values';const ext=format==='csv'?'.csv':'.tsv';const lines=['日期'+sep+'时间'+sep+'类型'+sep+'分类'+sep+'金额'+sep+'备注'];expenses.forEach(e=>{const ds=e['日期']||'';const datePart=ds.slice(0,10);const timePart=ds.includes('T')?ds.slice(11,16):'';const amt=Number(e['金额']||0).toFixed(2);const note=(e['备注']||'').includes(sep)?'"'+(e['备注']||'').replace(/"/g,'""')+'"':(e['备注']||'');lines.push(datePart+sep+timePart+sep+(e['类型']||'')+sep+(e['分类']||'')+sep+'¥'+amt+sep+note)});const b=new Blob([lines.join('\n')],{type:mime+';charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='记账_'+getThisMonth()+ext;a.click()})}
// 图片: kv:前缀=KV key存飞书图片字段; 无前缀=base64（回退）
async function deleteExpenseImage(){const eid=document.getElementById('eEditId').value;if(!eid)return;if(!confirm('确定删除图片？'))return;const e=expenses.find(x=>x.id===eid);if(!e)return;if(e['图片']&&e['图片'].startsWith('kv:')){const k=e['图片'].slice(3);try{await fetch('/api/images?key='+encodeURIComponent(k)+'&pin='+getPin(),{method:'DELETE'})}catch{}}await expenseApi('PUT',{id:eid,image:''});currentImageData='';currentImageKey='';document.getElementById('eImageWrap').style.display='none';toast('图片已删除');await loadAll()}
async function saveExpense(){const amount=parseFloat(document.getElementById('eAmount').value);if(!amount||amount<=0){alert('请输入金额');return}const data={type:document.getElementById('eType').value,category:document.getElementById('eCategory').value,amount,date:document.getElementById('eDate').value,note:document.getElementById('eNote').value.trim()};if(currentImageData){try{toast('正在上传图片...');const uploadRes=await fetch('/api/images',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({image:currentImageData})});const uploadData=await uploadRes.json();if(uploadData.key){data.imageKey=uploadData.key;data.image=currentImageData}else{data.image=currentImageData;}}catch(e){data.image=currentImageData;}}else if(currentImageKey){data.imageKey=currentImageKey;}const eid=document.getElementById('eEditId').value;let res;if(eid){res=await expenseApi('PUT',{id:eid,...data});if(res&&res.error){alert('更新失败: '+res.error);return}toast('已更新')}else{res=await expenseApi('POST',data);if(res&&res.error){alert('记录失败: '+res.error);return}toast('已记录')}currentImageData='';currentImageKey='';closeExpenseModal();await loadAll()}
async function delExpense(id){if(!confirm('确定删除？'))return;const r=await expenseApi('DELETE',null,id);if(r&&r.error){alert('删除失败: '+r.error);return}toast('已删除');await loadAll()}

// ===== AI 助手 =====

// ============================================================
// AI 功能
// ============================================================
const AI_API='/api/ai';
async function aiRequest(action,data){
  const r=await fetch(AI_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({action,data})});
  const res=await r.json().catch(()=>({error:'Response not JSON'}));
  if(!r.ok||res.error)throw new Error(res.error||res.hint||'AI request failed: '+r.status);
  return res;
}

// --- 自然语言记账 ---
let pendingAI=null;
async function sendAI(){
  const input=document.getElementById('aiInput');
  const text=input.value.trim();
  if(!text)return;
  const btn=document.getElementById('aiSendBtn');
  const resultEl=document.getElementById('aiResult');
  btn.disabled=true;
  btn.textContent='⏳';
  resultEl.innerHTML=`<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>解析中...</span></div>`;
  try{
    const now=new Date(Date.now()+8*3600*1000);
    const currentDate=now.toISOString().slice(0,10);
    const res=await aiRequest('parse',{text,currentDate});
    if(res.ok&&res.data&&res.data.amount>0){
      pendingAI=res.data;
      const d=res.data;
      resultEl.innerHTML=`<div class="ai-result">
        <div class="ai-result-header"><span class="ai-result-tag">🤖 AI 解析</span><span style="font-size:10px;color:var(--muted)">置信度 ${((d.confidence||0)*100).toFixed(0)}%</span></div>
        <div style="font-size:13px;margin-bottom:6px"><b>${d.type}</b> ¥${d.amount.toFixed(2)} · ${d.category}${d.note?' · '+d.note:''}</div>
        <div style="display:flex;gap:6px">
          <button class="ai-confirm-btn primary" onclick="confirmAI()">✓ 记一笔</button>
          <button class="ai-confirm-btn secondary" onclick="editAI()">✏️ 修改</button>
          <button class="ai-confirm-btn secondary" onclick="cancelAI()">✕ 取消</button>
        </div>
      </div>`;
    }else{
      resultEl.innerHTML=`<div class="ai-result"><div class="ai-result-header"><span class="ai-result-tag">🤔 没听清</span></div><div style="font-size:12px;color:var(--muted)">没识别到金额，试试: 午饭35、打车28去公司</div></div>`;
    }
  }catch(e){
    resultEl.innerHTML=`<div class="ai-result"><div style="color:var(--red);font-size:12px">⚠️ ${e.message||'未知错误'}</div></div>`;
  }
  btn.disabled=false;
  btn.textContent='✨';
  input.value='';
}

function confirmAI(){
  if(!pendingAI)return;
  const d=pendingAI;
  const now=new Date(Date.now()+8*3600*1000);
  const pad=n=>String(n).padStart(2,'0');
  const dateStr=d.date||(now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())+'T'+pad(now.getHours())+':'+pad(now.getMinutes()));
  openExpenseModal();
  document.getElementById('eType').value=d.type||'支出';
  document.getElementById('eAmount').value=d.amount||'';
  document.getElementById('eCategory').value=d.category||'其他';
  document.getElementById('eDate').value=dateStr;
  document.getElementById('eNote').value=d.note||'';
  document.getElementById('aiResult').innerHTML='';
  pendingAI=null;
}
function editAI(){
  if(!pendingAI)return;
  document.getElementById('aiInput').value=`${pendingAI.type} ${pendingAI.amount} ${pendingAI.category} ${pendingAI.note||''}`;
  document.getElementById('aiResult').innerHTML='';
  pendingAI=null;
}
function cancelAI(){
  document.getElementById('aiResult').innerHTML='';
  pendingAI=null;
}





// --- AI 需求评估（嵌入采购创建流程） ---
async function runPurchaseEval() {
  const name = document.getElementById('fName').value.trim();
  if (!name) { alert('请先输入商品名称'); return; }
  
  const resultEl = document.getElementById('aiEvalResult');
  const btn = document.getElementById('aiEvalBtn');
  resultEl.style.display = 'block';
  resultEl.textContent = '🤖 AI 分析中...';
  btn.disabled = true;
  btn.textContent = '分析中...';
  
  try {
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin() },
      body: JSON.stringify({ action: 'evaluate', data: { productName: name } }),
    });
    const d = await r.json();
    if (!d.ok) { resultEl.textContent = '❌ ' + (d.error || '评估失败'); return; }
    
    resultEl.innerHTML = '<div style="white-space:pre-wrap;margin-bottom:10px">' + esc(d.data) + '</div>'
      + '<button class="ai-confirm-btn primary" onclick="switchToDetailPhase(\''+name.replace(/'/g,"\\'")+'\', null)">✔ 确认填写详情</button>'
      + '<button class="ai-confirm-btn secondary" onclick="cancelPurchaseEval()">✖ 取消</button>';
    // 记录评估上下文，显示对话区域
    purchaseEvalContext = d.data;
    purchaseChatHistory = [{role:'assistant', content:d.data}];
    document.getElementById('chatArea').style.display = 'block';
    renderChatMessages();
  } catch(e) { resultEl.textContent = '❌ 网络错误'; }
  finally { btn.disabled = false; btn.textContent = '🤖 AI需求评估'; }
}
function switchToDetailPhase(name, aiData) {
  document.getElementById('evalPhase').style.display = 'none';
  document.getElementById('chatArea').style.display = 'none';
  document.getElementById('detailPhase').style.display = '';
  document.getElementById('fNameDisplay').value = name;
  document.getElementById('fPrice').value = '';
  document.getElementById('fQty').value = '1';
  document.getElementById('fNote').value = '';
  document.getElementById('fPlatform').value = '拼多多';
  document.getElementById('fCategory').value = '日用';
}

let purchaseEvalContext = '';
let purchaseChatHistory = [];

function renderChatMessages() {
  const el = document.getElementById('chatMessages');
  el.innerHTML = purchaseChatHistory.map(m => {
    if (m.role === 'user') return '<div style="text-align:right;margin-bottom:6px"><span style="display:inline-block;background:var(--pri);color:#fff;padding:6px 10px;border-radius:10px 10px 2px 10px;max-width:85%">' + esc(m.content) + '</span></div>';
    return '<div style="text-align:left;margin-bottom:6px"><span style="display:inline-block;background:var(--card);border:1px solid var(--border);padding:6px 10px;border-radius:10px 10px 10px 2px;max-width:85%">' + esc(m.content) + '</span></div>';
  }).join('');
  el.scrollTop = el.scrollHeight;
}

async function sendPurchaseChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const name = document.getElementById('fName').value.trim();

  purchaseChatHistory.push({role: 'user', content: text});
  renderChatMessages();

  const btn = document.getElementById('chatSendBtn');
  btn.disabled = true; btn.textContent = '...';

  try {
    const r = await fetch('/api/ai', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin()},
      body: JSON.stringify({
        action: 'purchase-chat',
        data: {
          productName: name,
          messages: purchaseChatHistory,
          evalContext: purchaseEvalContext
        }
      })
    });
    const d = await r.json();
    if (d.ok) {
      purchaseChatHistory.push({role: 'assistant', content: d.data});
      renderChatMessages();
    } else {
      purchaseChatHistory.push({role: 'assistant', content: '❌ ' + (d.error || '回复失败')});
      renderChatMessages();
    }
  } catch(e) {
    purchaseChatHistory.push({role: 'assistant', content: '❌ 网络错误'});
    renderChatMessages();
  } finally {
    btn.disabled = false; btn.textContent = '发送';
  }
}

function sendQuickChat(text) {
  document.getElementById('chatInput').value = text;
  sendPurchaseChat();
}

function cancelPurchaseEval() {
  document.getElementById('aiEvalResult').style.display = 'none';
  document.getElementById('chatArea').style.display = 'none';
  document.getElementById('fName').value = '';
  purchaseChatHistory = [];
  purchaseEvalContext = '';
}

function backToEval() {
  document.getElementById('evalPhase').style.display = '';
  document.getElementById('detailPhase').style.display = 'none';
  document.getElementById('aiEvalResult').style.display = 'block';
  document.getElementById('chatArea').style.display = 'block';
}


async function submitPurchase() {
  const name = document.getElementById('fNameDisplay').value.trim();
  if (!name) { alert('商品名称丢失'); return; }
  const data = {
    name,
    platform: document.getElementById('fPlatform').value,
    category: document.getElementById('fCategory').value,
    price: parseFloat(document.getElementById('fPrice').value) || 0,
    qty: parseInt(document.getElementById('fQty').value) || 1,
    status: '待审批',
    date: null,
    note: document.getElementById('fNote').value.trim() || null
  };
  const r = await api('POST', data);
  if (r && r.error) { alert('添加失败: ' + r.error); return; }
  toast('已添加');
  closeModal();
  await loadAll();
}
// --- AI 分析 ---
// --- AI 自然语言查询 ---
async function queryAI(){
  const input=document.getElementById('statsAIInput');
  const q=input.value.trim();
  if(!q)return;
  const resultEl=document.getElementById('statsAIResult');
  resultEl.innerHTML=`<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
  input.value='';
  try{
    const thisMonth=getThisMonth();
    const monthExpenses=expenses.filter(e=>{if(!e['日期'])return false;try{return getMonth(e['日期'])===thisMonth}catch{return false}});
    const res=await aiRequest('query',{question:q,expenses:monthExpenses});
    if(res.ok){resultEl.innerHTML=`<div class="ai-result"><div class="ai-result-header"><span class="ai-result-tag">🤖 回答</span></div><div>${esc(res.data)}</div></div>`}
    else{resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">分析失败</div>`}
  }catch(e){resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">${e.message}</div>`}
}

// --- 财务分析 ---
async function runAIAnalysis(){
  const resultEl=document.getElementById('statsAIResult');
  resultEl.innerHTML=`<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>分析中...</span></div>`;
  try{
    const thisMonth=getThisMonth();
    const monthExpenses=expenses.filter(e=>{if(!e['日期'])return false;try{return getMonth(e['日期'])===thisMonth}catch{return false}});
    const monthItems=items.filter(i=>getMonth(i['日期'])===thisMonth);
    const res=await aiRequest('analyze',{expenses:monthExpenses,items:monthItems,month:thisMonth});
    if(res.ok){resultEl.innerHTML=`<div class="ai-analysis-content">${esc(res.data)}</div>`}
    else{resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">分析失败</div>`}
  }catch(e){resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">${e.message}</div>`}
}

// --- 消费画像 ---
async function runAIProfile(){
  const resultEl=document.getElementById('statsAIResult');
  resultEl.innerHTML=`<div class="ai-loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div><span>深度分析中...</span></div>`;
  try{
    const thisMonth=getThisMonth();
    const monthExpenses=expenses.filter(e=>{if(!e['日期'])return false;try{return getMonth(e['日期'])===thisMonth}catch{return false}});
    const res=await aiRequest('profile',{expenses:monthExpenses});
    if(res.ok&&res.data){
      const d=res.data;
      let html='';
      // 总结
      if(d.summary) html+=`<div style="margin-bottom:12px;padding:10px;background:var(--pri-light);border-radius:10px;font-size:13px;line-height:1.7">${esc(d.summary)}</div>`;
      // 画像
      if(d.profile){
        const p=d.profile;
        html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">`;
        if(p.diningStyle) html+=`<div style="background:var(--bg);padding:8px 10px;border-radius:8px;font-size:11px"><div style="font-weight:700;margin-bottom:2px">🍜 饮食风格</div>${esc(p.diningStyle)}</div>`;
        if(p.lifestyle) html+=`<div style="background:var(--bg);padding:8px 10px;border-radius:8px;font-size:11px"><div style="font-weight:700;margin-bottom:2px">🎭 生活方式</div>${esc(p.lifestyle)}</div>`;
        if(p.spendingPattern) html+=`<div style="background:var(--bg);padding:8px 10px;border-radius:8px;font-size:11px"><div style="font-weight:700;margin-bottom:2px">💡 消费模式</div>${esc(p.spendingPattern)}</div>`;
        if(p.topItems&&p.topItems.length) html+=`<div style="background:var(--bg);padding:8px 10px;border-radius:8px;font-size:11px"><div style="font-weight:700;margin-bottom:2px">🏆 主要开销</div>${p.topItems.map(i=>esc(i)).join('、')}</div>`;
        html+=`</div>`;
      }
      // 习惯
      if(d.habits&&d.habits.length){
        html+=`<div style="font-size:12px;font-weight:700;margin-bottom:6px">📊 消费习惯</div>`;
        d.habits.forEach(h=>{html+=`<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;line-height:1.6"><b>${h.emoji||'📌'} ${esc(h.title)}</b><br>${esc(h.detail)}</div>`});
      }
      // 洞察
      if(d.insights&&d.insights.length){
        html+=`<div style="font-size:12px;font-weight:700;margin:10px 0 6px">💡 深度洞察</div>`;
        d.insights.forEach(i=>{html+=`<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;line-height:1.6"><b>${i.emoji||'💡'} ${esc(i.title)}</b><br>${esc(i.detail)}</div>`});
      }
      resultEl.innerHTML=`<div class="ai-result"><div class="ai-result-header"><span class="ai-result-tag">🧠 消费画像</span></div>${html}</div>`;
    }else{resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">生成失败</div>`}
  }catch(e){resultEl.innerHTML=`<div style="color:var(--red);font-size:12px">${e.message}</div>`}
}

// ===== 预算 =====
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



// ===== 预算 =====
function openBudgetModal(){const m=getThisMonth();document.getElementById('budgetMonth').value=m;document.getElementById('budgetInput').value=getBudget(m)||'';document.getElementById('budgetOverlay').classList.add('active')}
function closeBudgetModal(){document.getElementById('budgetOverlay').classList.remove('active')}
// ===== 导出格式选择弹窗 =====
function showExportDialog(type,callback){let overlay=document.getElementById('exportOverlay');if(!overlay){overlay=document.createElement('div');overlay.id='exportOverlay';overlay.className='modal-overlay';overlay.onclick=function(e){if(e.target===overlay)overlay.classList.remove('active')};overlay.innerHTML=`<div class="modal"><h2>📤 导出${type}</h2><div style="padding:10px 0"><div style="font-size:14px;margin-bottom:12px;color:var(--muted)">选择导出格式</div><div style="display:flex;gap:10px"><button class="btn btn-primary" style="flex:1" id="exportCsvBtn">📄 CSV（逗号分隔）</button><button class="btn btn-primary" style="flex:1" id="exportTsvBtn">📋 TSV（Tab分隔）</button></div></div><div class="btn-row"><button class="btn btn-secondary" onclick="document.getElementById('exportOverlay').classList.remove('active')">取消</button></div></div>`;document.body.appendChild(overlay)}document.getElementById('exportCsvBtn').onclick=function(){overlay.classList.remove('active');callback('csv')};document.getElementById('exportTsvBtn').onclick=function(){overlay.classList.remove('active');callback('tsv')};overlay.classList.add('active')}
function saveBudget(){const month=document.getElementById('budgetMonth').value;const val=parseFloat(document.getElementById('budgetInput').value)||0;if(!month)return alert('请选择月份');const b=getBudgets();b[month]=val;setBudgets(b);toast(`已设置 ${month} 预算 ¥${val}`);closeBudgetModal();render()}

// ===== FAB 点击 =====
document.getElementById('fabBtn').addEventListener('click',()=>{
  if(currentTab==='purchase') openModal();
  else if(currentTab==='expense') openExpenseModal();
});

// ===== 导出 =====
function exportData(){exportPurchases()}
function exportPurchases(){showExportDialog('采购',function(format){const sep=format==='csv'?',':'\t';const mime=format==='csv'?'text/csv':'text/tab-separated-values';const ext=format==='csv'?'.csv':'.tsv';const lines=['商品名称'+sep+'平台'+sep+'分类'+sep+'单价'+sep+'数量'+sep+'总价'+sep+'状态'+sep+'日期'+sep+'备注'];items.forEach(i=>{const qty=i['数量']||1;const price=i['单价']||0;let ds='';if(i['日期']){try{ds=new Date(i['日期']).toISOString().slice(0,10)}catch{}}const note=(i['备注']||'').includes(sep)?'"'+(i['备注']||'').replace(/"/g,'""')+'"':(i['备注']||'');lines.push((i['商品名称']||'')+sep+(i['平台']||'')+sep+(i['分类']||'')+sep+'¥'+price+sep+qty+sep+'¥'+(price*qty).toFixed(2)+sep+(i['状态']||'')+sep+ds+sep+note)});const b=new Blob([lines.join('\n')],{type:mime+';charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='采购_'+getThisMonth()+ext;a.click()})}

// ===== 详情弹窗 =====
const STEPPER_STEPS=['待审批','已审批','已下单'];
const STEPPER_ICONS={'待审批':'📋','已审批':'✅','已下单':'🛒','已到':'📦','已退':'↩️','已归档':'🗄️'};
const STEP_TIME_FIELDS={'待审批':'创建时间','已审批':'审批时间','已下单':'下单时间','已到':'到货时间','已退':'到货时间','已归档':'归档时间'};
const STEP_BTN_CONFIG={
  '待审批':{color:'var(--green)',label:'✅ 审批通过',next:'已审批'},
  '已审批':{color:'var(--blue)',label:'🛒 确认下单',next:'已下单'}
};
function openDetailModal(id){
  const item=items.find(x=>x.id===id);
  if(!item)return;
  const qty=Number(item['数量'])||1;
  const price=Number(item['单价'])||0;
  const total=price*qty;
  const status=item['状态']||'待审批';
  const statusIdx=STEPPER_STEPS.indexOf(status);
  let ds='';
  if(item['日期']){try{ds=new Date(item['日期']).toISOString().slice(0,10)}catch{}}

  let html=`<div class="detail-header">
    <div class="detail-title">${esc(item['商品名称']||'')}</div>
    <div class="detail-price">¥${price.toFixed(2)}${qty>1?` × ${qty} = ¥${total.toFixed(2)}`:''}</div>
    <div class="detail-meta">
      <span>🏪 ${esc(item['平台']||'')}</span>
      <span class="badge badge-${status}">${status}</span>
      <span class="cat-badge">${item['分类']||'其他'}</span>
      ${ds?`<span>📅 ${ds}</span>`:''}
    </div>
    ${item['备注']?`<div style="font-size:13px;color:var(--muted);margin-top:8px">💬 ${esc(item['备注'])}</div>`:''}
  </div>`;

  // Stepper: always show full flow 待审批→已审批→已下单→已到/已退→已归档
  const branchLabel = status==='已退' ? '已退' : '已到';
  const mainSteps = ['待审批','已审批','已下单'];
  const branchDone = status==='已到' || status==='已退' || status==='已归档';
  const archiveDone = status==='已归档';

  // Build full step list
  const allSteps = [];
  mainSteps.forEach(s => {
    const isDone = status==='已到'||status==='已退'||status==='已归档' || mainSteps.indexOf(s) < mainSteps.indexOf(status);
    const isCur = s===status;
    allSteps.push({ key:s, done:isDone, active:isCur });
  });
  // Branch step
  allSteps.push({ key:branchLabel, done:branchDone, active:status===branchLabel });
  // Archive step
  allSteps.push({ key:'已归档', done:archiveDone, active:status==='已归档' });

  html+=`<div class="detail-section-title">📋 审批流程</div><div class="stepper">`;
  allSteps.forEach((s, idx) => {
    const isLast = idx === allSteps.length - 1;
    let stepClass = 'step-pending';
    let dotContent = '⚪';
    let timeText = '—';
    if (s.done) {
      stepClass = 'step-done';
      dotContent = '✓';
      const tf = STEP_TIME_FIELDS[s.key];
      if (tf && item[tf]) timeText = item[tf];
      else if (s.key==='待审批' && item['创建时间']) timeText = item['创建时间'];
    } else if (s.active) {
      stepClass = 'step-active';
      dotContent = STEPPER_ICONS[s.key] || '🔵';
      const tf = STEP_TIME_FIELDS[s.key];
      if (tf && item[tf]) timeText = item[tf];
      else if (s.key==='待审批' && item['创建时间']) timeText = item['创建时间'];
      else timeText = '进行中...';
    }
    html+=`<div class="step-item ${stepClass}">
      <div class="step-dot-wrap">
        <div class="step-dot">${dotContent}</div>
        ${!isLast?'<div class="step-line"></div>':''}
      </div>
      <div class="step-info">
        <div class="step-name">${s.key}</div>
        <div class="step-time">${timeText}</div>
      </div>
    </div>`;
  });
  html+='</div>';

  // 操作按钮
  if(status==='待审批'||status==='已审批'){
    const btnCfg=STEP_BTN_CONFIG[status];
    html+=`<div style="margin-top:16px"><button class="detail-action-btn" style="background:${btnCfg.color}" onclick="doDetailModalAction('${id}','${btnCfg.next}')">${btnCfg.label}</button></div>`;
  }else if(status==='已下单'){
    html+=`<div style="margin-top:16px;display:flex;gap:10px">
      <button class="detail-action-btn" style="background:var(--green);flex:1" onclick="doDetailModalAction('${id}','已到')">📦 确认收货</button>
      <button class="detail-action-btn" style="background:var(--red);flex:1" onclick="doDetailModalAction('${id}','已退')">↩️ 退货归档</button>
    </div>`;
  }else if(status==='已到'||status==='已退'){
    html+=`<div style="margin-top:16px"><button class="detail-action-btn" style="background:var(--pri)" onclick="doDetailModalAction('${id}','已归档')">🗄️ 确认归档</button></div>`;
  }

  document.getElementById('detailContent').innerHTML=html;
  document.getElementById('detailOverlay').classList.add('active');
}
function closeDetailModal(){document.getElementById('detailOverlay').classList.remove('active')}
function doDetailModalAction(id,nextStatus){
  if(!confirm('确认执行此操作？'))return;
  // Optimistic update: update local state immediately
  const item=items.find(x=>x.id===id);
  if(item){
    item['状态']=nextStatus;
    const now=new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'}).slice(0,16).replace('T',' ');
    if(nextStatus==='已审批')item['审批时间']=now;
    else if(nextStatus==='已下单')item['下单时间']=now;
    else if(nextStatus==='已到'||nextStatus==='已退')item['到货时间']=now;
    else if(nextStatus==='已归档')item['归档时间']=now;
    toast(`已更新为"${nextStatus}"`);
    closeDetailModal();
    render();
  }
  // Fire PATCH in background, don't block UI
  api('PATCH',{ids:[id],status:nextStatus}).then(r=>{
    if(r&&r.error){toast('同步失败，请刷新');loadAll();}
  }).catch(()=>{toast('网络错误，请刷新');loadAll();});
}

setupPullToRefresh();
setupSwipe();


// ===== 操作日志 =====
let logDateState = new Date().toISOString().slice(0, 10);

function changeLogDate(delta) {
  const parts = logDateState.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2] + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  logDateState = y + '-' + m + '-' + day;
  loadLogs();
}

async function loadLogs(date) {
  if (date) logDateState = date;
  const el = document.getElementById('logList');
  const dateEl = document.getElementById('logDate');
  el.textContent = '加载中...';
  dateEl.textContent = logDateState;
  try {
    const r = await fetch('/api/auth?action=list-logs&date=' + logDateState, {
      headers: { 'Authorization': 'Bearer ' + getPin() }
    });
    const d = await r.json();
    if (!d.ok) { el.textContent = d.error || '加载失败'; return; }
    if (!d.logs.length) { el.textContent = '暂无日志'; return; }

    const actionLabels = {
      'login': '🟢 登录',
      'register': '🆕 注册',
      'logout': '🔴 退出登录',
      'delete_user': '🔴 删除用户',
      'create_invite': '📧 创建邀请码',
      'status_change': '📋 状态变更',
      'export': '📤 导出',
    };

    // 如果是管理员，显示所有用户的日志；否则只显示自己的
    const isAdmin = d.isAdmin;
    const showUsername = isAdmin;

    el.innerHTML = d.logs.map(function(log) {
      const label = actionLabels[log.action] || log.action;
      const time = log.ts.replace('T', ' ').replace('Z', ' UTC').slice(0, 22);
      const usernameHtml = showUsername ? '<span style="font-size:11px;color:var(--muted);margin-left:8px">' + esc(log.username) + '</span>' : '';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">' +
        '<div>' +
          '<span style="font-size:13px">' + label + '</span>' +
          usernameHtml +
          '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + esc(log.details) + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-size:10px;color:var(--muted)">' + time + '</div>' +
          '<div style="font-size:9px;color:var(--muted)">' + esc(log.ip) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    dateEl.textContent = d.date;
  } catch(e) { el.textContent = '加载失败'; }
}

function openLogsPanel() {
  document.getElementById('logsPanel').style.display = 'block';
  loadLogs();
}

function closeLogsPanel() {
  document.getElementById('logsPanel').style.display = 'none';
}

// ===== 离线检测横幅 =====
(function(){
  const banner=document.createElement('div');
  banner.id='offlineBanner';
  banner.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px 16px;background:#f59e0b;color:#000;text-align:center;font-size:13px;font-weight:700;display:none;transition:transform .3s ease;transform:translateY(-100%)';
  banner.textContent='📡 离线模式 - 数据将在联网后同步';
  document.body.appendChild(banner);
  function updateOnlineStatus(){
    if(!navigator.onLine){
      banner.style.display='block';
      setTimeout(()=>banner.style.transform='translateY(0)',10);
    }else{
      banner.style.transform='translateY(-100%)';
      setTimeout(()=>banner.style.display='none',300);
      // 联网后自动刷新数据
      if(typeof loadAll==='function')loadAll();
    }
  }
  window.addEventListener('online',updateOnlineStatus);
  window.addEventListener('offline',updateOnlineStatus);
  if(!navigator.onLine)updateOnlineStatus();
})();
