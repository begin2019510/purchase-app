// auth.js - Authentication, Login, Register, Admin
function getPin(){return localStorage.getItem('auth_token')||''}
function setPin(p){localStorage.setItem('auth_token',p)}
function getRefreshToken(){return localStorage.getItem('refresh_token')||''}
function setRefreshToken(t){localStorage.setItem('refresh_token',t)}
function clearTokens(){localStorage.removeItem('auth_token');localStorage.removeItem('refresh_token');localStorage.removeItem('auth_user');clearUserCache();if(typeof claudeSyncAdminVis==='function')claudeSyncAdminVis()}
function clearUserCache(){try{Object.keys(localStorage).forEach(function(k){if(k.indexOf('cache_')===0)localStorage.removeItem(k)})}catch(e){}}
function setAuthLocked(on){
  var s=document.getElementById('authScreen');
  if(!s)return;
  s.style.display=on?'flex':'none';
  try{document.body.classList.toggle('auth-locked',on)}catch(e){}
}
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
      const r = await fetch(API_BASE + '/api/auth?action=refresh', {
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
    const r=await fetch(API_BASE + '/api/auth?action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const d=await r.json();
    if(d.ok&&d.token){setPin(d.token);if(d.refreshToken)setRefreshToken(d.refreshToken);clearUserCache();if(d.username)localStorage.setItem('auth_user',d.username);setAuthLocked(false);if(d.username==='admin'){var _ab=document.getElementById('adminBtn');if(_ab)_ab.style.display='';}if(typeof claudeSyncAdminVis==='function')claudeSyncAdminVis();loadAll();}
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
    const r=await fetch(API_BASE + '/api/auth?action=register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,inviteCode})});
    const d=await r.json();
    if(d.ok&&d.token){setPin(d.token);if(d.refreshToken)setRefreshToken(d.refreshToken);clearUserCache();if(d.username)localStorage.setItem('auth_user',d.username);setAuthLocked(false);loadAll();}
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
    const r=await fetch(API_BASE + '/api/auth?action=list-users',{headers:{'Authorization':'Bearer '+getPin()}});
    const d=await r.json();
    if(!d.ok){el.textContent='加载失败';return}
    if(!d.users.length){el.textContent='暂无用户';return}
    el.innerHTML=d.users.map(u=>{
      const isAdmin=u.username==='admin';
      const badge=isAdmin?'<span style="background:var(--pri);color:#fff;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:6px">管理员</span>':'';
      const del=isAdmin?'':'<button data-u="'+escAttr(u.username)+'" onclick="deleteUser(this.dataset.u)" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:11px">删除</button>';
      return'<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)"><div><b>'+esc(u.username)+'</b>'+badge+'<div style="font-size:10px;color:var(--muted);margin-top:2px">'+esc(String(u.createdAt||'').replace('T',' ').replace('Z','').slice(0,16))+' (UTC) | '+esc(u.inviteType||'')+' '+esc(u.inviteCode||'')+'</div></div>'+del+'</div>';
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
    const r=await fetch(API_BASE + '/api/auth?action=create-invite',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({count})});
    const d=await r.json();
    if(d.ok){el.innerHTML='✅ 已生成:<br>'+d.codes.map(c=>'<b>'+esc(c)+'</b>').join('<br>');loadInviteList();}
    else{el.textContent='❌ '+d.error}
  }catch{el.textContent='❌ 网络错误'}
}
async function loadInviteList(){
  const el=document.getElementById('inviteList');
  try{
    const r=await fetch(API_BASE + '/api/auth?action=list-invites',{headers:{'Authorization':'Bearer '+getPin()}});
    const d=await r.json();
    if(!d.ok||!d.codes.length){el.textContent='暂无动态邀请码';return}
    el.innerHTML=d.codes.map(c=>{
      const status=c.used?'<span style="color:var(--red)">已使用 '+(c.usedAt?esc(String(c.usedAt).replace('T',' ').replace('Z','').slice(0,16))+' (UTC)':'')+'</span>':'<span style="color:var(--green)">可用</span>';
      return'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span style="font-family:monospace">'+esc(c.code)+'</span>'+status+'<span style="font-size:10px;color:var(--muted)">'+esc(String(c.createdAt||'').slice(0,10))+'</span></div>';
    }).join('');
  }catch{el.textContent='加载失败'}
}
async function deleteUser(username){
  if(!confirm('确定删除用户 '+username+' ？\n（数据表会保留，仅删除账号）'))return;
  try{
    const r=await fetch(API_BASE + '/api/auth?action=delete-user',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({username})});
    const d=await r.json();
    if(d.ok){alert(d.message);loadInviteList();loadUserList();}
    else{alert(d.error)}
  }catch{alert('网络错误')}
}
async function debugMyAuth(){
  const el=document.getElementById('debugResult');
  el.textContent='查询中...';
  try{
    const r=await fetch(API_BASE + '/api/items?debug=auth',{headers:{'Authorization':'Bearer '+getPin()}});
    const d=await r.json();
    el.innerHTML='<pre style="margin:0;white-space:pre-wrap">'+esc(JSON.stringify(d,null,2))+'</pre>';
  }catch(e){el.textContent='错误: '+e.message}
}
async function debugMyAuthStats(){
  const el=document.getElementById('debugResultStats');
  el.textContent='查询中...';
  try{
    const r=await fetch(API_BASE + '/api/items?debug=auth',{headers:{'Authorization':'Bearer '+getPin()}});
    const d=await r.json();
    el.innerHTML='<pre style="margin:0;white-space:pre-wrap">'+esc(JSON.stringify(d,null,2))+'</pre>';
  }catch(e){el.textContent='错误: '+e.message}
}
async function verifyAndLoad(){
  try{
    console.log('VERIFY: Quick token check...');
    // Fast check: just verify token validity (1 call), then loadAll
    let r=await fetch(API_BASE + '/api/auth?action=verify',{headers:{'Authorization':'Bearer '+getPin()}});
    if(r.status===401){
      console.log('VERIFY: Token expired, trying refresh...');
      const newToken=await refreshAccessToken();
      if(newToken){
        r=await fetch(API_BASE + '/api/auth?action=verify',{headers:{'Authorization':'Bearer '+newToken}});
      }
    }
    if(!r.ok){
      console.log('VERIFY: Auth failed, showing login');
      clearTokens();
      setAuthLocked(true);
      return;
    }
    const d=await r.json();
    console.log('VERIFY: OK, user='+d.username+', starting loadAll');
    if(d.username)localStorage.setItem('auth_user',d.username);
    setAuthLocked(false);
    if(d.username==='admin'){var _ab=document.getElementById('adminBtn');if(_ab)_ab.style.display='';}
    loadAll();
  }catch(e){
    console.log('VERIFY: EXCEPTION: '+e.message);
    setAuthLocked(true);
  }
}
function logout(){
  if(!confirm('确认退出登录？'))return;
  // 通知后端删除 refresh token（best effort）
  fetch(API_BASE + '/api/auth?action=logout',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({refreshToken:getRefreshToken()}),
  }).catch(()=>{});
  clearTokens();
  var _ab3=document.getElementById('adminBtn');if(_ab3)_ab3.style.display='none';
  setAuthLocked(true);
  document.getElementById('loginUsername').value='';
  document.getElementById('loginPassword').value='';
}


// ===== Service Worker（防循环加载） =====
if('serviceWorker' in navigator && !IS_NATIVE){
  var swLoads=JSON.parse(localStorage.getItem('_sw_loads')||'[]');
  var now=Date.now();
  var recent=swLoads.filter(function(t){return now-t<5000});
  recent.push(now);
  localStorage.setItem('_sw_loads',JSON.stringify(recent));
  if(recent.length>=3){
    localStorage.removeItem('_sw_loads');
    navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})});
    caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k)})});
  }else{
    navigator.serviceWorker.register('/sw.js').then(function(reg){
      reg.addEventListener('updatefound',function(){
        var nw=reg.installing;
        if(nw)nw.addEventListener('statechange',function(){
          if(nw.state==='installed'&&navigator.serviceWorker.controller){
            nw.postMessage({type:'SKIP_WAITING'});
          }
        });
      });
    }).catch(function(){});
    navigator.serviceWorker.addEventListener('controllerchange',function(){location.reload(true)});
    // Listen for SW_RELOAD message - auto reload on update
    navigator.serviceWorker.addEventListener('message',function(e){
      // SW_RELOAD: 静默接管，不再强制刷新（新版下次打开生效）
    });
  }
}
// 5秒后清除检测数据（页面正常加载了）
// ===== 推送 - 飞书机器人（国内可用） =====
// 无需浏览器权限，配置飞书机器人 webhook 即可
// 配置方法：Cloudflare 环境变量 FEISHU_BOT_WEBHOOK
// ===== 系统通知（Web Push / Apple APNs）=====
const WEBPUSH_VAPID_PUBLIC='BL7C5cLuGUMB2jXlRUtpZsKX0ZQxOh9qF6XdK0puPtIJJBMc0cZ7rcIA1CNwPXei5bvOojXhjkdj1CR0EOTh5bE';
function _urlB64ToUint8(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);
  const outputArray=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;++i)outputArray[i]=raw.charCodeAt(i);
  return outputArray;
}
async function setupWebPush(){
  try{
    const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const standalone=(typeof navigator.standalone==='boolean')?navigator.standalone:window.matchMedia('(display-mode: standalone)').matches;
    if(isIOS&&!standalone){
      alert('iPhone 需先添加到主屏幕：\n\nSafari 打开本页 → 分享 → 添加到主屏幕\n再从桌面图标打开本页，回来点这里开启通知');
      return;
    }
    const sup={
      Notification:('Notification' in window),
      serviceWorker:('serviceWorker' in navigator),
      PushManager:('PushManager' in window)
    };
    if(!sup.Notification||!sup.serviceWorker||!sup.PushManager){
      var missing=Object.keys(sup).filter(function(k){return !sup[k]}).join(', ');
      var ua=navigator.userAgent;
      var hint='当前环境不支持系统通知\n\n'
        +'缺少能力: '+missing+'\n'
        +'iOS主屏: '+(typeof navigator.standalone==='boolean'?navigator.standalone:'非Safari')+'\n'
        +'浏览器: '+ua.slice(0,90)+'\n\n'
        +'📌 开启通知请在 iPhone 上操作：\n'
        +'Safari 打开本页 → 分享 → 添加到主屏幕\n'
        +'再从桌面图标打开 → 设置 → 系统通知';
      alert(hint);return;
    }
    let perm=await Notification.requestPermission();
    if(perm!=='granted'){alert('未获得通知权限，请在系统设置中允许');return}
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:_urlB64ToUint8(WEBPUSH_VAPID_PUBLIC)
    });
    let r=await fetch(API_BASE+'/api/push/subscribe',{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},
      body:JSON.stringify({subscription:sub.toJSON()})
    });
    if(r.status===401){
      const nt=await refreshAccessToken();
      if(nt)r=await fetch(API_BASE+'/api/push/subscribe',{
        method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+nt},
        body:JSON.stringify({subscription:sub.toJSON()})
      });
    }
    if(!r.ok)throw new Error('HTTP '+r.status);
    localStorage.setItem('webpush_on','1');
    alert('✅ 系统通知已开启\n\n记账提醒将直接推送到系统通知中心（苹果官方 APNs 通道）');
  }catch(e){
    console.error('setupWebPush',e);
    alert('开启失败：'+(e&&e.message||'未知错误'));
  }
}
async function setupPush(){
  const msg = '推送使用飞书机器人\n\n操作步骤：\n1. 飞书打开一个群聊\n2. 群设置 → 群机器人 → 添加机器人\n3. 选择自定义机器人 → 复制 Webhook 地址\n4. 在 Cloudflare Pages 设置中添加环境变量：\n   FEISHU_BOT_WEBHOOK = 复制的地址\n5. 然后 GitHub Actions 每天 20:00 自动发提醒';
  alert(msg);
}

// ===== Init =====
showVersion();
document.getElementById('searchInput').value='';
  // setTimeout(function(){document.getElementById('searchInput').value='';render()},100); // REMOVED: render() not available at auth.js load time
  // setTimeout(function(){document.getElementById('searchInput').value='';render()},500); // REMOVED: render() not available at auth.js load time
if('serviceWorker' in navigator) var _pb=document.getElementById('pushBtn');if(_pb)_pb.style.display='';

// ===== Startup Bootstrap =====
function _bootstrap(){if(typeof loadAll==='undefined'){setTimeout(_bootstrap,50);return}if(getPin()){verifyAndLoad()}else if(getRefreshToken()){refreshAccessToken().then(function(t){if(t)verifyAndLoad();else{clearTokens();setAuthLocked(true)}})}else{setAuthLocked(true)}}if(document.readyState==='complete'||document.readyState==='interactive'){_bootstrap()}else{document.addEventListener('DOMContentLoaded',_bootstrap)}
// === App.auth namespace exports ===
App.auth.getPin = getPin;
App.auth.setPin = setPin;
App.auth.getRefreshToken = getRefreshToken;
App.auth.setRefreshToken = setRefreshToken;
App.auth.clearTokens = clearTokens;
App.auth.submitPin = submitPin;
App.auth.doLogin = doLogin;
App.auth.refreshAccessToken = refreshAccessToken;
App.auth.doLoginAPI = doLoginAPI;
App.auth.doRegister = doRegister;
App.auth.showLogin = showLogin;
App.auth.showRegister = showRegister;
App.auth.loadUserList = loadUserList;
App.auth.openAdminPanel = openAdminPanel;
App.auth.closeAdminPanel = closeAdminPanel;
App.auth.createInviteCodes = createInviteCodes;
App.auth.loadInviteList = loadInviteList;
App.auth.deleteUser = deleteUser;
App.auth.debugMyAuth = debugMyAuth;
App.auth.debugMyAuthStats = debugMyAuthStats;
App.auth.verifyAndLoad = verifyAndLoad;
App.auth.logout = logout;
App.auth.setupPush = setupPush;
App.auth.setupWebPush = setupWebPush;
