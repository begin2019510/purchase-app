// ===== PIN =====
function getPin(){return localStorage.getItem('auth_token')||''}
function setPin(p){localStorage.setItem('auth_token',p)}
function doLogin(){const username=document.getElementById('loginUsername').value.trim();const password=document.getElementById('loginPassword').value;if(!username||!password){document.getElementById('authError').textContent='请输入用户名和密码';return}doLoginAPI(username,password)}
async function doLoginAPI(username,password){
  document.getElementById('authError').textContent='登录中...';
  try{
    const r=await fetch('/api/auth?action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const d=await r.json();
    if(d.ok&&d.token){setPin(d.token);document.getElementById('authScreen').style.display='none';if(d.username==='admin')document.getElementById('adminBtn').style.display='';loadAll();}
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
    if(d.ok&&d.token){setPin(d.token);document.getElementById('authScreen').style.display='none';loadAll();}
    else{document.getElementById('regError').textContent=d.error||'注册失败'}
  }catch(e){document.getElementById('regError').textContent='网络错误'}
}
function showLogin(){document.getElementById('loginForm').style.display='';document.getElementById('registerForm').style.display='none';document.getElementById('authSubtitle').textContent='请登录';document.getElementById('authError').textContent=''}
function showRegister(){document.getElementById('loginForm').style.display='none';document.getElementById('registerForm').style.display='';document.getElementById('authSubtitle').textContent='邀请码注册';document.getElementById('regError').textContent=''}
document.getElementById('loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
document.getElementById('regInviteCode').addEventListener('keydown',e=>{if(e.key==='Enter')doRegister()});
// ===== 管理员功能 =====
function openAdminPanel(){document.getElementById('adminPanel').style.display='block';loadInviteList()}
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
      const status=c.used?'<span style="color:var(--red)">已使用 '+c.usedAt+'</span>':'<span style="color:var(--green)">可用</span>';
      return'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span style="font-family:monospace">'+c.code+'</span>'+status+'<span style="font-size:10px;color:var(--muted)">'+c.createdAt.slice(0,10)+'</span></div>';
    }).join('');
  }catch{el.textContent='加载失败'}
}
async function deleteUser(username){
  if(!confirm('确定删除用户 '+username+' ？\n（数据表会保留，仅删除账号）'))return;
  try{
    const r=await fetch('/api/auth?action=delete-user',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({username})});
    const d=await r.json();
    if(d.ok){alert(d.message);loadInviteList();}
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
async function verifyAndLoad(){try{const r=await fetch('/api/auth?action=verify',{headers:{'Authorization':'Bearer '+getPin()}});if(r.status===401){document.getElementById('authScreen').style.display='flex';return}if(!r.ok)throw new Error();const d=await r.json();document.getElementById('authScreen').style.display='none';if(d.ok&&d.username==='admin')document.getElementById('adminBtn').style.display='';loadAll()}catch{document.getElementById('authScreen').style.display='flex'}}
function logout(){
  if(!confirm('确认退出登录？'))return;
  setPin('');
  document.getElementById('adminBtn').style.display='none';
  document.getElementById('authScreen').style.display='flex';
  document.getElementById('loginUsername').value='';
  document.getElementById('loginPassword').value='';
}

// ===== 管理员功能 =====
function openAdminPanel(){document.getElementById('adminPanel').style.display='block';loadInviteList()}
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
      const status=c.used?'<span style="color:var(--red)">已使用 '+c.usedAt+'</span>':'<span style="color:var(--green)">可用</span>';
      return'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)"><span style="font-family:monospace">'+c.code+'</span>'+status+'<span style="font-size:10px;color:var(--muted)">'+c.createdAt.slice(0,10)+'</span></div>';
    }).join('');
  }catch{el.textContent='加载失败'}
}
async function deleteUser(username){
  if(!confirm('确定删除用户 '+username+' ？\n（数据表会保留，仅删除账号）'))return;
  try{
    const r=await fetch('/api/auth?action=delete-user',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+getPin()},body:JSON.stringify({username})});
    const d=await r.json();
    if(d.ok){alert(d.message);loadInviteList();}
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
async function verifyAndLoad(){try{const r=await fetch('/api/auth?action=verify',{headers:{'Authorization':'Bearer '+getPin()}});if(r.status===401){document.getElementById('authScreen').style.display='flex';return}if(!r.ok)throw new Error();const d=await r.json();document.getElementById('authScreen').style.display='none';if(d.ok&&d.username==='admin')document.getElementById('adminBtn').style.display='';loadAll()}catch{document.getElementById('authScreen').style.display='flex'}}
function logout(){
  if(!confirm('确认退出登录？'))return;
  setPin('');
  document.getElementById('adminBtn').style.display='none';
  document.getElementById('authScreen').style.display='flex';
  document.getElementById('loginUsername').value='';
  document.getElementById('loginPassword').value='';
}