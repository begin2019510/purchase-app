// claude.js —— 设置 → 和 Claude 对话（含会话管理）
// 链路：App → CF Functions /api/claude（JWT）→ purchase-server → CloudCLI
// 聊天：异步任务 + 轮询（POST 立即拿 taskId，每 1.5s GET 进度）
// 会话：GET ?action=sessions 列表 / history 恢复；POST rename / delete
var _claudeTimer = null;
var _claudeBusy = false;
var _claudeTaskId = '';
var _claudeLiveBubble = null;
var _claudeSessions = null;      // [{id,title,at,project}]
var _claudeSessionsAt = 0;       // 列表缓存时间
var _claudeHistoryFor = '';      // 当前气泡对应的 sessionId（避免重复拉历史）

function openClaudeChat(){
  // 必须用 active class：app.js 的 MutationObserver 靠 .active 锁 body 滚动，
  // 直接改 display 会导致聊天区滚动时背景页一起滚
  document.getElementById('claudeOverlay').classList.add('active');
  hideClaudeSessions();
  var sid=localStorage.getItem('claude_sid')||'';
  var m=document.getElementById('claudeMsgs');
  if(sid && _claudeHistoryFor!==sid){
    // 有会话但气泡未就绪（刚打开/刚切换）→ 拉服务端历史
    m.innerHTML='';
    claudeLoadHistory(sid);
  }else if(!m.children.length){
    claudeAddMsg('ai','你好，我是 Claude，和电脑上 agent 网页版是同一个我：能查服务器、跑命令、改文件。');
  }
  m.scrollTop=m.scrollHeight;
  setTimeout(function(){ try{document.getElementById('claudeInput').focus()}catch(e){} },100);
  // 恢复未完成任务（如误关弹层后重开）
  if(!_claudeTimer && localStorage.getItem('claude_task')){
    _claudeTaskId=localStorage.getItem('claude_task');
    claudeAddMsg('ai','（恢复未完成的任务…）');
    claudePoll();
  }
}
function closeClaudeChat(){ document.getElementById('claudeOverlay').classList.remove('active'); hideClaudeSessions(); }

function newClaudeSession(){
  if(_claudeTimer){ alert('上一条还在生成中，先等它完成'); return; }
  localStorage.removeItem('claude_sid');
  localStorage.removeItem('claude_task');
  _claudeTaskId='';
  _claudeHistoryFor='';
  document.getElementById('claudeMsgs').innerHTML='';
  claudeAddMsg('ai','已开启新会话。');
  hideClaudeSessions();
  claudeRefreshSessions(true);
}

function claudeAddMsg(role, text){
  var m=document.getElementById('claudeMsgs');
  var d=document.createElement('div');
  d.className='chat-bubble '+(role==='user'?'user-bubble':'ai-bubble');
  d.textContent=String(text==null?'':text); // textContent 防注入
  m.appendChild(d);
  m.scrollTop=m.scrollHeight;
  return d;
}

function claudeSetStatus(s){
  var el=document.getElementById('claudeStatus');
  if(el) el.textContent=s||'';
}

async function claudeRequest(action, body, extraQuery){
  var url=API_BASE+'/api/claude?action='+action+(extraQuery||'');
  var doFetch=function(token){
    var headers={'Content-Type':'application/json'};
    if(token) headers['Authorization']='Bearer '+token;
    var init={method:body?'POST':'GET',headers:headers};
    if(body) init.body=JSON.stringify(body);
    return fetch(url,init);
  };
  var r=await doFetch(getPin());
  if(r.status===401){
    var nt=await refreshAccessToken();
    if(nt) r=await doFetch(nt);
  }
  return r;
}

// ===== 会话面板 =====

function toggleClaudeSessions(){
  var p=document.getElementById('claudeSessions');
  if(p.style.display==='none'||!p.style.display){ showClaudeSessions(); }
  else hideClaudeSessions();
}
function showClaudeSessions(){
  document.getElementById('claudeSessions').style.display='block';
  claudeRefreshSessions(false);
}
function hideClaudeSessions(){
  var p=document.getElementById('claudeSessions');
  if(p) p.style.display='none';
}

async function claudeRefreshSessions(force){
  if(!force && _claudeSessions && (Date.now()-_claudeSessionsAt)<30000){ renderClaudeSessions(); return; }
  var body=document.getElementById('claudeSessionsBody');
  body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">加载中…</div>';
  try{
    var r=await claudeRequest('sessions','','&limit=30');
    var d=await r.json().catch(function(){return{}});
    if(!d.sessions){
      body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">❌ '+(d.error||('HTTP '+r.status))+'</div>';
      return;
    }
    _claudeSessions=d.sessions;
    _claudeSessionsAt=Date.now();
    renderClaudeSessions();
  }catch(e){
    body.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">❌ 网络错误</div>';
  }
}

function claudeRelTime(iso){
  if(!iso) return '';
  var t=Date.parse(iso);
  if(isNaN(t)) return '';
  var s=Math.floor((Date.now()-t)/1000);
  if(s<60) return '刚刚';
  if(s<3600) return Math.floor(s/60)+' 分钟前';
  if(s<86400) return Math.floor(s/3600)+' 小时前';
  if(s<86400*7) return Math.floor(s/86400)+' 天前';
  var d=new Date(t);
  return (d.getMonth()+1)+'/'+d.getDate();
}

function renderClaudeSessions(){
  var body=document.getElementById('claudeSessionsBody');
  if(!body) return;
  var cur=localStorage.getItem('claude_sid')||'';
  var list=_claudeSessions||[];
  if(!list.length){
    body.innerHTML='<div style="padding:24px 16px;text-align:center;color:var(--muted);font-size:13px">暂无会话，说第一句就会出现</div>';
    return;
  }
  var html='';
  list.forEach(function(s){
    var active=s.id===cur;
    var title=esc(String(s.title||'（无标题）').slice(0,60));
    var time=esc(claudeRelTime(s.at));
    html+='<div class="claude-sess-row'+(active?' active':'')+'" onclick="pickClaudeSession(\''+escAttr(s.id)+'\')">'
      +'<div style="flex:1;min-width:0">'
      +'<div style="font-size:13px;font-weight:'+(active?'700':'500')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(active?'● ':'')+title+'</div>'
      +'<div style="font-size:11px;color:var(--muted);margin-top:2px">'+time+(s.project&&s.project!=='/'?(' · '+esc(s.project)):'')+'</div>'
      +'</div>'
      +'<div style="display:flex;gap:4px;flex-shrink:0" onclick="event.stopPropagation()">'
      +'<button class="btn btn-secondary" style="font-size:11px;padding:4px 8px" onclick="renameClaudeSession(\''+escAttr(s.id)+'\')">✎</button>'
      +'<button class="btn btn-secondary" style="font-size:11px;padding:4px 8px" onclick="deleteClaudeSession(\''+escAttr(s.id)+'\')">🗑</button>'
      +'</div>'
      +'</div>';
  });
  body.innerHTML=html;
}

async function pickClaudeSession(id){
  if(_claudeTimer){ alert('上一条还在生成中，先等它完成'); return; }
  if(!id) return;
  localStorage.setItem('claude_sid',id);
  localStorage.removeItem('claude_task');
  _claudeTaskId='';
  hideClaudeSessions();
  var m=document.getElementById('claudeMsgs');
  m.innerHTML='';
  await claudeLoadHistory(id);
}

async function claudeLoadHistory(sid){
  var m=document.getElementById('claudeMsgs');
  claudeSetStatus('⏳ 加载历史…');
  try{
    var r=await claudeRequest('history','','&id='+encodeURIComponent(sid)+'&limit=200');
    var d=await r.json().catch(function(){return{}});
    claudeSetStatus('');
    m.innerHTML='';
    if(!d.messages){
      claudeAddMsg('ai','❌ 历史加载失败：'+(d.error||('HTTP '+r.status)));
      _claudeHistoryFor='';
      return;
    }
    if(!d.messages.length){
      claudeAddMsg('ai','（这是一个新会话，还没有消息）');
    }else{
      d.messages.forEach(function(msg){ claudeAddMsg(msg.role==='user'?'user':'ai',msg.text); });
    }
    _claudeHistoryFor=sid;
    m.scrollTop=m.scrollHeight;
  }catch(e){
    claudeSetStatus('');
    claudeAddMsg('ai','❌ 历史加载网络错误');
    _claudeHistoryFor='';
  }
}

async function renameClaudeSession(id){
  var cur=(_claudeSessions||[]).filter(function(s){return s.id===id})[0];
  var old=cur?cur.title:'';
  var title=window.prompt('重命名会话',String(old||'').slice(0,60));
  if(title==null) return;
  title=title.trim();
  if(!title||title.length>200) return;
  try{
    var r=await claudeRequest('rename',{id:id,title:title});
    var d=await r.json().catch(function(){return{}});
    if(!d.ok){ alert(d.error||'重命名失败'); return; }
    claudeRefreshSessions(true);
  }catch(e){ alert('网络错误'); }
}

async function deleteClaudeSession(id){
  if(!window.confirm('删除这个会话？（归档，网页版可恢复）')) return;
  try{
    var r=await claudeRequest('delete',{id:id});
    var d=await r.json().catch(function(){return{}});
    if(!d.ok){ alert(d.error||'删除失败'); return; }
    if((localStorage.getItem('claude_sid')||'')===id){
      localStorage.removeItem('claude_sid');
      _claudeHistoryFor='';
      document.getElementById('claudeMsgs').innerHTML='';
      claudeAddMsg('ai','当前会话已删除，说一句开始新对话。');
    }
    claudeRefreshSessions(true);
  }catch(e){ alert('网络错误'); }
}

// ===== 聊天 =====

async function sendClaudeMsg(){
  if(_claudeBusy) return;
  var input=document.getElementById('claudeInput');
  var msg=input.value.trim();
  if(!msg) return;
  input.value='';
  claudeAddMsg('user',msg);
  _claudeBusy=true;
  document.getElementById('claudeSendBtn').disabled=true;
  claudeSetStatus('⏳ 提交中…');
  try{
    var sid=localStorage.getItem('claude_sid')||'';
    var r=await claudeRequest('chat',{message:msg,sessionId:sid});
    var d=await r.json().catch(function(){return{}});
    if(r.status===409&&d.taskId){
      claudeAddMsg('ai','（上一条还在生成中，已切到它的进度）');
      _claudeTaskId=d.taskId;
      localStorage.setItem('claude_task',d.taskId);
      claudePoll();
      return;
    }
    if(!d.taskId){
      claudeAddMsg('ai','❌ '+(d.error||('发送失败 HTTP '+r.status)));
      claudeSetStatus('');
      _claudeBusy=false;
      document.getElementById('claudeSendBtn').disabled=false;
      return;
    }
    _claudeTaskId=d.taskId;
    localStorage.setItem('claude_task',d.taskId);
    claudePoll();
  }catch(e){
    claudeAddMsg('ai','❌ 网络错误: '+(e&&e.message||e));
    claudeSetStatus('');
    _claudeBusy=false;
    document.getElementById('claudeSendBtn').disabled=false;
  }
}

function claudePoll(){
  if(_claudeTimer) return;
  _claudeLiveBubble=claudeAddMsg('ai','…');
  var lastText='';
  var failCount=0;
  _claudeTimer=setInterval(async function(){
    try{
      var r=await claudeRequest('task','','&id='+encodeURIComponent(_claudeTaskId));
      failCount=0;
      if(r.status===404){
        claudePollFinish('❌ 任务已失效（服务可能重启过），请重新发送');
        return;
      }
      var d=await r.json().catch(function(){return{}});
      if(d.text&&d.text!==lastText){
        lastText=d.text;
        _claudeLiveBubble.textContent=d.text;
        var m=document.getElementById('claudeMsgs'); m.scrollTop=m.scrollHeight;
      }
      if(d.status==='running'){
        var tool=d.tools&&d.tools.length?d.tools[d.tools.length-1]:'';
        claudeSetStatus(tool?('🔧 '+tool+' …'):((_claudeLiveBubble&&_claudeLiveBubble.textContent!=='…')?'⏳ 生成中…':'⏳ 思考中…'));
      }else if(d.status==='done'){
        claudePollFinish(d.text||lastText||'（Claude 没有返回文本）');
        if(d.sessionId){
          var prev=localStorage.getItem('claude_sid')||'';
          localStorage.setItem('claude_sid',d.sessionId);
          if(prev!==d.sessionId) _claudeHistoryFor=d.sessionId; // 新会话首条，气泡已在页面上
          claudeRefreshSessions(true); // 静默刷新列表
        }
      }else{
        claudePollFinish('❌ '+(d.error||'任务异常结束'));
      }
    }catch(e){
      failCount++;
      if(failCount>=8) claudePollFinish('❌ 轮询失败: '+(e&&e.message||e));
    }
  },1500);
}

function claudePollFinish(finalText){
  if(_claudeTimer){ clearInterval(_claudeTimer); _claudeTimer=null; }
  if(_claudeLiveBubble&&finalText!=null) _claudeLiveBubble.textContent=String(finalText);
  _claudeLiveBubble=null;
  _claudeTaskId='';
  localStorage.removeItem('claude_task');
  claudeSetStatus('');
  _claudeBusy=false;
  var b=document.getElementById('claudeSendBtn'); if(b) b.disabled=false;
  var m=document.getElementById('claudeMsgs'); if(m) m.scrollTop=m.scrollHeight;
}
