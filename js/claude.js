// claude.js —— 「和 Claude 对话」入口
// 聊天界面已改为独立页面 chat.html（/chat.html），不再使用弹窗。
// 这里只保留设置项跳转与管理员入口显隐，旧页面调用保持兼容。
function openClaudeChat(){
  var u='';
  try{ u=localStorage.getItem('auth_user')||''; }catch(e){}
  if(u!=='admin'){
    alert('Claude 对话仅管理员可用');
    return;
  }
  location.href='chat.html';
}

// 设置项：非 admin 隐藏入口（服务端仍有 403 兜底）
function claudeSyncAdminVis(){
  var el=document.getElementById('settingsItemClaude');
  if(!el) return;
  var u='';
  try{ u=localStorage.getItem('auth_user')||''; }catch(e){}
  el.style.display=(u==='admin')?'':'none';
}

(function(){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', claudeSyncAdminVis);
  else claudeSyncAdminVis();
})();
