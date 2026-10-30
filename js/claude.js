// claude.js —— 设置 → 和 Claude 对话
// 链路：App → CF Functions /api/claude（JWT）→ purchase-server → CloudCLI /api/agent
// 模式：异步任务 + 轮询（POST 立即拿 taskId，每 1.5s GET 进度），避免 CF 边缘 100s TTFB 掐断长任务。
var _claudeTimer = null;
var _claudeBusy = false;
var _claudeTaskId = '';
var _claudeLiveBubble = null;

function openClaudeChat(){
  document.getElementById('claudeOverlay').style.display='flex';
  var m=document.getElementById('claudeMsgs');
  if(!m.children.length) claudeAddMsg('ai','你好，我是 Claude，和电脑上 agent 网页版是同一个我：能查服务器、跑命令、改文件。');
  m.scrollTop=m.scrollHeight;
  setTimeout(function(){ try{document.getElementById('claudeInput').focus()}catch(e){} },100);
  // 恢复未完成任务（如误关弹层后重开）
  if(!_claudeTimer && localStorage.getItem('claude_task')){
    _claudeTaskId=localStorage.getItem('claude_task');
    claudeAddMsg('ai','（恢复未完成的任务…）');
    claudePoll();
  }
}
function closeClaudeChat(){ document.getElementById('claudeOverlay').style.display='none'; }

function newClaudeSession(){
  if(_claudeTimer){ alert('上一条还在生成中，先等它完成'); return; }
  localStorage.removeItem('claude_sid');
  localStorage.removeItem('claude_task');
  _claudeTaskId='';
  document.getElementById('claudeMsgs').innerHTML='';
  claudeAddMsg('ai','已开启新会话。');
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
        if(d.sessionId) localStorage.setItem('claude_sid',d.sessionId);
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
