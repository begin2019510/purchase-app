// auth.js - Authentication, Login, Register, Admin
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
    if(d.ok&&d.token){setPin(d.token);if(d.refreshToken)setRefreshToken(d.refreshToken);document.getElementById('authScreen').style.display='none';if(d.username==='admin'){var _ab=document.getElementById('adminBtn');if(_ab)_ab.style.display='';}loadAll();}
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
async function verifyAndLoad(){
  var _vs=document.getElementById('debugBanner');
  function _vl(m){console.log('VERIFY:',m);if(_vs){_vs.style.display='block';_vs.innerHTML+='<div style="border-bottom:1px solid rgba(255,255,255,.3);padding:2px 0">'+m+'</div>'}}
  try{
    _vl('Verifying token...');
    let r=await fetch('/api/auth?action=verify',{headers:{'Authorization':'Bearer '+getPin()}});
    _vl('Verify status: '+r.status);
    if(r.status===401){
      _vl('Token expired, trying refresh...');
      const newToken=await refreshAccessToken();
      _vl('Refresh: '+(newToken?'OK':'FAILED'));
      if(newToken){
        r=await fetch('/api/auth?action=verify',{headers:{'Authorization':'Bearer '+newToken}});
        _vl('Re-verify status: '+r.status);
      }
    }
    if(!r.ok){
      _vl('Auth FAILED, clearing tokens');
      clearTokens();
      document.getElementById('authScreen').style.display='flex';
      return;
    }
    const d=await r.json();
    _vl('Auth OK, user='+d.username);
    document.getElementById('authScreen').style.display='none';
    if(d.ok&&d.username==='admin'){var _ab2=document.getElementById('adminBtn');if(_ab2)_ab2.style.display='';}
    loadAll();
  }catch(e){
    _vl('EXCEPTION: '+e.message);
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
  var _ab3=document.getElementById('adminBtn');if(_ab3)_ab3.style.display='none';
  document.getElementById('authScreen').style.display='flex';
  document.getElementById('loginUsername').value='';
  document.getElementById('loginPassword').value='';
}


// ===== Service Worker（防循环加载） =====
if('serviceWorker' in navigator){
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
      if(e.data&&e.data.type==='SW_RELOAD'){location.reload(true)}
    });
  }
}
// 5秒后清除检测数据（页面正常加载了）
// ===== 推送 - 飞书机器人（国内可用） =====
// 无需浏览器权限，配置飞书机器人 webhook 即可
// 配置方法：Cloudflare 环境变量 FEISHU_BOT_WEBHOOK
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
if(getPin()){verifyAndLoad()}else if(getRefreshToken()){refreshAccessToken().then(function(t){if(t)verifyAndLoad();else{clearTokens();document.getElementById('authScreen').style.display='flex';loadAll()}})}else{document.getElementById('authScreen').style.display='flex';loadAll()}
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
