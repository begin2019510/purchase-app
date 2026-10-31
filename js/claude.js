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
  var u='';
  try{ u=localStorage.getItem('auth_user')||''; }catch(e){}
  if(u!=='admin'){
    alert('Claude 对话仅管理员可用');
    return;
  }
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
  setTimeout(function(){
    try{
      var ta=document.getElementById('claudeInput');
      claudeInputGrow(ta);
      ta.focus();
      claudeSyncKeyboard();
    }catch(e){}
  },100);
  // 恢复未完成任务（如误关弹层后重开）
  if(!_claudeTimer && localStorage.getItem('claude_task')){
    _claudeTaskId=localStorage.getItem('claude_task');
    claudeAddMsg('ai','（恢复未完成的任务…）');
    claudePoll();
  }
}
function closeClaudeChat(){
  document.getElementById('claudeOverlay').classList.remove('active');
  document.getElementById('claudeOverlay').style.paddingBottom='';
  hideClaudeSessions();
  var ta=document.getElementById('claudeInput');
  if(ta){ try{ta.blur()}catch(e){} ta.value=''; claudeInputGrow(ta); }
}

// 登录/退出后同步入口显隐
(function(){
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', claudeSyncAdminVis);
  else claudeSyncAdminVis();
})();

// ===== 输入框：多行自增高 + 键盘弹出时把弹层顶上去 =====

function claudeInputGrow(ta){
  if(!ta) return;
  ta.style.height='auto';
  var max=Math.max(44, Math.round((window.innerHeight||600)*0.18));
  var h=Math.min(ta.scrollHeight, max);
  ta.style.height=h+'px';
  ta.style.overflowY=ta.scrollHeight>max?'auto':'hidden';
}

function claudeInputKey(e){
  if(e.key!=='Enter') return;
  // 中文输入法组字中不发送
  if(e.isComposing||e.keyCode===229) return;
  if(e.shiftKey) return; // Shift+Enter 换行
  e.preventDefault();
  sendClaudeMsg();
}

// iOS/Android 键盘遮住底部输入栏：用 visualViewport 差值给 overlay 加 padding-bottom
function claudeSyncKeyboard(){
  var ov=document.getElementById('claudeOverlay');
  if(!ov||!ov.classList.contains('active')) return;
  var vv=window.visualViewport;
  if(!vv){ ov.style.paddingBottom=''; return; }
  var layoutH=Math.max(document.documentElement.clientHeight||0, window.innerHeight||0);
  // body.modal-open 时用布局视口高度；键盘弹出后 visual 变矮，差值即键盘高度
  var kb=Math.max(0, layoutH - (vv.height + vv.offsetTop));
  // 容错：差值小于 40px 视为无键盘（桌面/缩放噪声）
  if(kb<40) kb=0;
  // 去掉 safe-area 重复：键盘在时 foot 的 env(safe-area) 通常为 0，这里只补键盘高度
  ov.style.paddingBottom=kb?(kb+'px'):'';
  if(kb){
    var ta=document.getElementById('claudeInput');
    if(ta) try{ ta.scrollIntoView({block:'nearest'}) }catch(e){}
    var m=document.getElementById('claudeMsgs');
    if(m) m.scrollTop=m.scrollHeight;
  }
}

(function(){
  var vv=window.visualViewport;
  if(!vv) return;
  vv.addEventListener('resize', claudeSyncKeyboard);
  vv.addEventListener('scroll', claudeSyncKeyboard);
  window.addEventListener('orientationchange', function(){ setTimeout(claudeSyncKeyboard, 80); });
})();

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

// 聊天气泡安全 Markdown：块级结构先摘出（代码块/表格/引用/列表），再 esc + 行内语法。
// 占位符 %%MDn%% 能扛住 esc；不允许任意 HTML。用户气泡仍纯 text。
function claudeRenderMd(text){
  var s=String(text==null?'':text);
  var stash=[];
  function keep(html){ stash.push(html); return '%%MD'+(stash.length-1)+'%%'; }
  function cell(t){
    var x=esc(String(t==null?'':t));
    x=x.replace(/`([^`]+)`/g,'<code class="md-code">$1</code>');
    x=x.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    return x;
  }

  // 1) 围栏代码块（含流式未闭合）
  s=s.replace(/```([^\n`]*)\n([\s\S]*?)```/g,function(_,lang,code){
    return keep('<pre class="md-pre"><code>'+esc(code.replace(/\n$/,''))+'</code></pre>');
  });
  s=s.replace(/```([^\n`]*)\n([\s\S]*)$/,function(_,lang,code){
    return keep('<pre class="md-pre"><code>'+esc(code)+'</code></pre>');
  });

  // 2) GFM 管道表：| head | … | + |---| 分隔行
  s=s.replace(/(?:^|\n)[ \t]*\|[^\n]+\|[ \t]*(?:\n[ \t]*\|[^\n]+\|)*/g,function(block){
    var lines=block.replace(/^\n/,'').replace(/\s+$/,'').split('\n');
    if(lines.length<2) return block;
    function parseRow(line){
      var t=String(line).trim().replace(/^\|/,'').replace(/\|$/,'');
      return t.split('|').map(function(c){ return c.trim(); });
    }
    var head=parseRow(lines[0]);
    var sep=parseRow(lines[1]);
    if(!head.length||!sep||sep.length<head.length) return block;
    for(var k=0;k<head.length;k++){
      if(!/^:?-+:?$/.test(sep[k]||'')) return block;
    }
    var html='<div class="md-table-wrap"><table><thead><tr>';
    head.forEach(function(c){ html+='<th>'+cell(c)+'</th>'; });
    html+='</tr></thead><tbody>';
    for(var i=2;i<lines.length;i++){
      if(!/^\s*\|/.test(lines[i])) continue;
      var row=parseRow(lines[i]);
      html+='<tr>';
      for(var j=0;j<head.length;j++) html+='<td>'+cell(row[j]||'')+'</td>';
      html+='</tr>';
    }
    html+='</tbody></table></div>';
    return '\n'+keep(html)+'\n';
  });

  // 3) 引用块
  s=s.replace(/(?:^|\n)(?:>[ \t]?[^\n]*(?:\n|$))+/g,function(m){
    var body=m.replace(/^\n/,'').replace(/\s+$/,'').split('\n').map(function(l){
      return l.replace(/^>[ \t]?/,'');
    }).join('\n');
    return '\n'+keep('<blockquote>'+esc(body).replace(/\n/g,'<br>')+'</blockquote>')+'\n';
  });

  // 4) 无序 / 有序列表（连续行成组）
  s=s.replace(/(?:^|\n)(?:[ \t]*[-*+][ \t]+[^\n]*(?:\n[ \t]*[-*+][ \t]+[^\n]*)*)/g,function(m){
    var items=m.replace(/^\n/,'').replace(/\s+$/,'').split('\n').filter(Boolean).map(function(line){
      return '<li>'+esc(line.replace(/^[ \t]*[-*+][ \t]+/,''))+'</li>';
    }).join('');
    if(!items) return m;
    return '\n'+keep('<ul>'+items+'</ul>')+'\n';
  });
  s=s.replace(/(?:^|\n)(?:[ \t]*\d+\.[ \t]+[^\n]*(?:\n[ \t]*\d+\.[ \t]+[^\n]*)*)/g,function(m){
    var items=m.replace(/^\n/,'').replace(/\s+$/,'').split('\n').filter(Boolean).map(function(line){
      return '<li>'+esc(line.replace(/^[ \t]*\d+\.[ \t]+/,''))+'</li>';
    }).join('');
    if(!items) return m;
    return '\n'+keep('<ol>'+items+'</ol>')+'\n';
  });

  // 5) 其余文本：esc + 行内语法
  s=esc(s);
  s=s.replace(/`([^`\n]+)`/g,'<code class="md-code">$1</code>');
  s=s.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
  s=s.replace(/__([^_\n]+)__/g,'<strong>$1</strong>');
  s=s.replace(/~~([^~\n]+)~~/g,'<del>$1</del>');
  s=s.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g,'$1<em>$2</em>');
  // 标题（降为粗体行，聊天里不占太大）
  s=s.replace(/(^|\n)[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm,'$1<strong class="md-h">$2</strong>');
  // 分割线
  s=s.replace(/(^|\n)[ \t]*([-*_])[ \t]*(?:\2[ \t]*){2,}[ \t]*$/gm,'$1<hr>');

  // 6) 换行 → <br>，再还回块级
  s=s.replace(/\n+/g,'<br>');
  s=s.replace(/%%MD(\d+)%%/g,function(_,i){ return stash[+i]||''; });
  // 去掉块级前后多余 <br>
  s=s.replace(/<br>(?=<(?:pre\b|ul\b|ol\b|blockquote\b|div class="md-table-wrap"|hr\b|strong class="md-h"))/g,'');
  s=s.replace(/(?:<br>)+(?=<\/(?:pre|ul|ol|blockquote|div|table)>)/g,'');
  s=s.replace(/<br>(?=<hr>)/g,'');
  s=s.replace(/(<hr>)<br>/g,'$1');
  return s;
}

function claudeSetBubble(el, text){
  if(!el) return;
  el.innerHTML=claudeRenderMd(text); // 仅 AI 气泡；内容已 esc
  var m=document.getElementById('claudeMsgs'); if(m) m.scrollTop=m.scrollHeight;
}

function claudeAddMsg(role, text){
  var m=document.getElementById('claudeMsgs');
  var d=document.createElement('div');
  d.className='chat-bubble '+(role==='user'?'user-bubble':'ai-bubble');
  if(role==='user') d.textContent=String(text==null?'':text); // 用户输入纯文本防注入
  else d.innerHTML=claudeRenderMd(text);
  m.appendChild(d);
  m.scrollTop=m.scrollHeight;
  return d;
}

// 设置项：非 admin 隐藏入口（服务端仍有 403 兜底）
function claudeSyncAdminVis(){
  var el=document.getElementById('settingsItemClaude');
  if(!el) return;
  var u='';
  try{ u=localStorage.getItem('auth_user')||''; }catch(e){}
  el.style.display=(u==='admin')?'':'none';
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
  var msg=(input&&input.value||'').trim();
  if(!msg) return;
  if(input){ input.value=''; claudeInputGrow(input); }
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
    if(r.status===403){
      claudeAddMsg('ai','❌ '+(d.error||'仅管理员可使用 Claude 对话'));
      claudeSetStatus('');
      _claudeBusy=false;
      document.getElementById('claudeSendBtn').disabled=false;
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
        claudeSetBubble(_claudeLiveBubble,d.text);
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
  if(_claudeLiveBubble&&finalText!=null) claudeSetBubble(_claudeLiveBubble,String(finalText));
  _claudeLiveBubble=null;
  _claudeTaskId='';
  localStorage.removeItem('claude_task');
  claudeSetStatus('');
  _claudeBusy=false;
  var b=document.getElementById('claudeSendBtn'); if(b) b.disabled=false;
  var m=document.getElementById('claudeMsgs'); if(m) m.scrollTop=m.scrollHeight;
}
