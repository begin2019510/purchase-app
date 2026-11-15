// chat.js —— 「和 Claude 对话」独立页面
// 链路：chat.html → CF Functions /api/claude（JWT）→ purchase-server → CloudCLI
// 聊天：POST ?action=chat 立即拿 taskId，GET ?action=task 轮询（约 0.75s，接近流式）
// 停止：POST ?action=cancel，保留已生成文本
// 会话：sessions / history / rename / delete，与 agent 网页版（CloudCLI）互通
var API_BASE = (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
  ? 'https://121212121.top' : '';

var CC = {
  sid: '', historyFor: '', taskId: '', timer: null, pollBusy: false,
  live: null, lastText: '', lastTools: [], busy: false, stopping: false,
  sessions: null, sessionsAt: 0, stick: true, pollFails: 0, booted: false,
  resuming: false
};

function $(id) { return document.getElementById(id); }
function esc(s) {
  var d = document.createElement('div');
  d.textContent = (s == null || s === 'undefined') ? '' : String(s);
  return d.innerHTML;
}
function escAttr(s) {
  return String((s == null || s === 'undefined') ? '' : s)
    .replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ccToken() { try { return localStorage.getItem('auth_token') || ''; } catch (e) { return ''; } }
function ccRefresh() { try { return localStorage.getItem('refresh_token') || ''; } catch (e) { return ''; } }
function ccUser() { try { return localStorage.getItem('auth_user') || ''; } catch (e) { return ''; } }

// ===== 鉴权 =====
async function ccRefreshAccessToken() {
  var rt = ccRefresh();
  if (!rt) return null;
  try {
    var r = await fetch(API_BASE + '/api/auth?action=refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt })
    });
    var d = await r.json().catch(function () { return {}; });
    if (d.ok && d.token) {
      localStorage.setItem('auth_token', d.token);
      if (d.refreshToken) localStorage.setItem('refresh_token', d.refreshToken);
      return d.token;
    }
  } catch (e) { /* 网络错误交给调用方 */ }
  return null;
}

async function ccApi(action, body, extra) {
  var url = API_BASE + '/api/claude?action=' + action + (extra || '');
  function go(token) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var init = { method: body ? 'POST' : 'GET', headers: headers };
    if (body) init.body = JSON.stringify(body);
    return fetch(url, init);
  }
  var r = await go(ccToken());
  if (r.status === 401) {
    var nt = await ccRefreshAccessToken();
    if (nt) r = await go(nt);
  }
  return r;
}

function ccShowGate(title, text, icon) {
  $('ccGateTitle').textContent = title;
  $('ccGateText').textContent = text;
  $('ccGateIcon').textContent = icon || '🔒';
  $('ccGateRetry').style.display = (ccToken() || ccRefresh()) ? '' : 'none';
  $('ccGate').classList.add('show');
}
function ccHideGate() { $('ccGate').classList.remove('show'); }

function ccHandleAuth(r, d) {
  if (r.status === 401) {
    ccShowGate('登录已失效', '请回到 App 重新登录，再打开 Claude 对话。', '🔑');
    return true;
  }
  if (r.status === 403) {
    ccShowGate('仅管理员可用', (d && d.error) || '请回到 App，用管理员账号登录后再打开。', '🔒');
    return true;
  }
  return false;
}

// ===== 小工具 =====
function ccToast(msg) {
  var el = $('ccToast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(ccToast._t);
  ccToast._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
}

function ccTime(iso) {
  var d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  function p(n) { return n < 10 ? '0' + n : '' + n; }
  return p(d.getHours()) + ':' + p(d.getMinutes());
}
function ccRelTime(iso) {
  if (!iso) return '';
  var t = Date.parse(iso);
  if (isNaN(t)) return '';
  var s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' 天前';
  var d = new Date(t);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function ccCopy(text) {
  var done = function () { ccToast('已复制'); };
  var fail = function () {
    try {
      var ta = document.createElement('textarea');
      ta.value = String(text || '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      ccToast('已复制');
    } catch (e) { ccToast('复制失败，请长按选择'); }
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(String(text || '')).then(done).catch(fail);
      return;
    }
  } catch (e) { /* 走降级 */ }
  fail();
}

// ===== Markdown 渲染（安全：先 esc，仅生成白名单标签）=====
function ccCodeBlock(lang, code) {
  var l = String(lang || '').trim().split(/\s+/)[0].slice(0, 16);
  return '<div class="cc-code">'
    + '<div class="cc-code-bar"><span class="cc-code-lang">' + esc(l || 'code') + '</span>'
    + '<button type="button" class="cc-code-copy" data-copy-code>复制</button></div>'
    + '<pre><code>' + esc(String(code || '').replace(/\n$/, '')) + '</code></pre>'
    + '</div>';
}

function ccRenderMd(text) {
  var s = String(text == null ? '' : text);
  var stash = [];
  function keep(html) { stash.push(html); return '\n%%CCMD' + (stash.length - 1) + '%%\n'; }

  function inline(t) {
    var x = esc(String(t == null ? '' : t));
    // 链接：只允许 http(s)/mailto，仍然先 esc，不会注入标签
    x = x.replace(/\[([^\]\n]{1,300})\]\((https?:\/\/[^\s)]{1,2000}|mailto:[^\s)]{1,300})\)/g,
      function (m, label, url) {
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
      });
    x = x.replace(/`([^`\n]+)`/g, '<code class="cc-inline">$1</code>');
    x = x.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    x = x.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    x = x.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    x = x.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>');
    return x;
  }

  // 1) 围栏代码块（含流式未闭合）
  s = s.replace(/```([^\n`]*)\n([\s\S]*?)```/g, function (_, lang, code) {
    return keep(ccCodeBlock(lang, code));
  });
  s = s.replace(/```([^\n`]*)\n([\s\S]*)$/, function (_, lang, code) {
    return keep(ccCodeBlock(lang, code));
  });

  // 2) GFM 管道表
  s = s.replace(/(?:^|\n)[ \t]*\|[^\n]+\|[ \t]*(?:\n[ \t]*\|[^\n]+\|)*/g, function (block) {
    var lines = block.replace(/^\n/, '').replace(/\s+$/, '').split('\n');
    if (lines.length < 2) return block;
    function parseRow(line) {
      var t = String(line).trim().replace(/^\|/, '').replace(/\|$/, '');
      var out = [], cur = '', escaped = false;
      for (var n = 0; n < t.length; n++) {
        var ch = t[n];
        if (escaped) { cur += ch; escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '|') { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      if (escaped) cur += '\\';
      out.push(cur.trim());
      return out;
    }
    var head = parseRow(lines[0]);
    var sep = parseRow(lines[1]);
    if (!head.length || !sep || sep.length < head.length) return block;
    for (var k = 0; k < head.length; k++) {
      if (!/^:?-+:?$/.test(sep[k] || '')) return block;
    }
    var html = '<div class="cc-table-wrap"><table><thead><tr>';
    head.forEach(function (c) { html += '<th>' + inline(c) + '</th>'; });
    html += '</tr></thead><tbody>';
    for (var i = 2; i < lines.length; i++) {
      if (!/^\s*\|/.test(lines[i])) continue;
      var row = parseRow(lines[i]);
      html += '<tr>';
      for (var j = 0; j < head.length; j++) html += '<td>' + inline(row[j] || '') + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    return keep(html);
  });

  // 3) 引用
  s = s.replace(/(?:^|\n)(?:>[ \t]?[^\n]*(?:\n|$))+/g, function (m) {
    var body = m.replace(/^\n/, '').replace(/\s+$/, '').split('\n').map(function (l) {
      return l.replace(/^>[ \t]?/, '');
    }).join('\n');
    return keep('<blockquote>' + body.split('\n').map(inline).join('<br>') + '</blockquote>');
  });

  // 4) 列表
  s = s.replace(/(?:^|\n)(?:[ \t]*[-*+][ \t]+[^\n]*(?:\n[ \t]*[-*+][ \t]+[^\n]*)*)/g, function (m) {
    var items = m.replace(/^\n/, '').replace(/\s+$/, '').split('\n').filter(Boolean).map(function (line) {
      return '<li>' + inline(line.replace(/^[ \t]*[-*+][ \t]+/, '')) + '</li>';
    }).join('');
    if (!items) return m;
    return keep('<ul>' + items + '</ul>');
  });
  s = s.replace(/(?:^|\n)(?:[ \t]*\d+\.[ \t]+[^\n]*(?:\n[ \t]*\d+\.[ \t]+[^\n]*)*)/g, function (m) {
    var items = m.replace(/^\n/, '').replace(/\s+$/, '').split('\n').filter(Boolean).map(function (line) {
      return '<li>' + inline(line.replace(/^[ \t]*\d+\.[ \t]+/, '')) + '</li>';
    }).join('');
    if (!items) return m;
    return keep('<ol>' + items + '</ol>');
  });

  // 5) 剩下的普通文本
  s = inline(s);
  s = s.replace(/(^|\n)[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, '$1<span class="cc-h">$2</span>');
  s = s.replace(/(^|\n)[ \t]*([-*_])[ \t]*(?:\2[ \t]*){2,}[ \t]*$/gm, '$1<hr>');

  // 6) 换行与块级还原
  s = s.replace(/\n+/g, '<br>');
  s = s.replace(/%%CCMD(\d+)%%/g, function (_, i) { return stash[+i] || ''; });
  s = s.replace(/<br>(?=<(?:div class="cc-code"|div class="cc-table-wrap"|pre\b|ul\b|ol\b|blockquote\b|hr\b|span class="cc-h"))/g, '');
  s = s.replace(/(?:<br>)+(?=<\/(?:pre|ul|ol|blockquote|table)>)/g, '');
  s = s.replace(/<br>(?=<hr>)/g, '');
  s = s.replace(/(<hr>)<br>/g, '$1');
  return s;
}

function ccSetBubble(b, text, live) {
  if (!b || !b.body) return;
  b.rawText = text == null ? '' : String(text);
  if (b.row) b.row._ccText = b.rawText;
  if (!text) {
    b.body.innerHTML = live ? '<span class="cc-typing"><i></i><i></i><i></i></span>' : '';
  } else {
    b.body.innerHTML = ccRenderMd(text) + (live ? '<span class="cc-cursor"></span>' : '');
  }
  if (CC.stick) ccScrollBottom(false, true);
  else ccShowJump(true);
}

function ccAddMsg(role, text, bulk) {
  var inner = $('ccThreadInner');
  var welcome = inner.querySelector('.cc-welcome');
  if (welcome) welcome.remove();
  var row = document.createElement('div');

  if (role === 'user') {
    row.className = 'cc-row user' + (bulk ? ' no-anim' : '');
    var ub = document.createElement('div');
    ub.className = 'cc-user-bubble';
    ub.textContent = String(text == null ? '' : text);
    row.appendChild(ub);
    inner.appendChild(row);
    if (!bulk) ccScrollBottom(false, true);
    return { row: row, body: ub, role: 'user' };
  }

  row.className = 'cc-row' + (bulk ? ' no-anim' : '');
  row.innerHTML = '<div class="cc-msg">'
    + '<div class="cc-avatar">✳</div>'
    + '<div class="cc-msg-main">'
    + '<div class="cc-meta"><span class="cc-name">Claude</span><span class="cc-time">' + ccTime() + '</span>'
    + '<span class="cc-msg-actions"><button class="cc-copy-msg" type="button" data-copy-msg>复制</button></span></div>'
    + '<div class="cc-body"></div>'
    + '</div></div>';
  inner.appendChild(row);
  var body = row.querySelector('.cc-body');
  var b = { row: row, body: body, role: 'ai' };
  ccSetBubble(b, text, false);
  if (!bulk) ccScrollBottom(false, true);
  return b;
}

// 恢复任务时用于去重：历史接口可能已经存下了同一条回复，
// 如果此时再为任务新建 live 气泡，同一条回复会出现两遍。
// 只比较「最后一条用户消息之后」的 AI 行，避免误伤之前轮次的相同回答。
function ccNormText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}
function ccTrailingAiRows() {
  var inner = $('ccThreadInner');
  if (!inner) return [];
  var rows = inner.querySelectorAll('.cc-row');
  var lastUser = -1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].classList.contains('user')) lastUser = i;
  }
  var out = [];
  for (var j = lastUser + 1; j < rows.length; j++) {
    if (!rows[j].classList.contains('user')) out.push(rows[j]);
  }
  return out;
}
function ccRowRawText(row) {
  // 优先用原始文本比较；渲染后的 textContent 会混入代码块语言标签和“复制”按钮。
  if (row._ccText != null) return ccNormText(row._ccText);
  var body = row.querySelector('.cc-body');
  return ccNormText(body && body.textContent);
}
function ccTextContains(big, small) {
  return big.length >= 40 && small.length >= 40 && big.indexOf(small) >= 0;
}
// 历史里是否已有完整的这段回复（相等，或历史文本更长且包含它）。
function ccHistoryHasCompleteAi(text) {
  var target = ccNormText(text);
  if (!target) return false;
  var rows = ccTrailingAiRows();
  for (var i = 0; i < rows.length; i++) {
    var t = ccRowRawText(rows[i]);
    if (!t) continue;
    if (t === target || ccTextContains(t, target)) return true;
  }
  return false;
}
// 历史里若只有这段回复的旧片段，补全前先移除片段，避免新回复旁边留着半截重复。
function ccRemovePartialAiHistory(text) {
  var target = ccNormText(text);
  if (!target) return;
  var rows = ccTrailingAiRows();
  for (var i = 0; i < rows.length; i++) {
    var t = ccRowRawText(rows[i]);
    if (!t || t === target) continue;
    if (ccTextContains(target, t)) rows[i].remove();
  }
}
// 收尾时对齐历史与 live：历史已有完整/更长的回复则删掉 live；
// 若历史只是片段而 live 更完整，则删片段、保留 live。
function ccDedupeLive(bubble, text) {
  var target = ccNormText(text);
  if (!bubble || !bubble.row || !target) return false;
  var rows = ccTrailingAiRows();
  var i, t, partials = [];
  for (i = 0; i < rows.length; i++) {
    if (rows[i] === bubble.row) continue;
    t = ccRowRawText(rows[i]);
    if (!t) continue;
    if (t === target || ccTextContains(t, target)) {
      if (bubble.row.parentNode) bubble.row.parentNode.removeChild(bubble.row);
      return true;
    }
    if (ccTextContains(target, t)) partials.push(rows[i]);
  }
  for (i = 0; i < partials.length; i++) {
    if (partials[i].parentNode) partials[i].parentNode.removeChild(partials[i]);
  }
  return false;
}

function ccAppendTools(b) {
  if (!b || !CC.lastTools || !CC.lastTools.length) return;
  var wrap = document.createElement('div');
  wrap.className = 'cc-tool-row';
  var seen = {};
  CC.lastTools.forEach(function (name) {
    var n = String(name || '').trim();
    if (!n || seen[n]) return;
    seen[n] = 1;
    var s = document.createElement('span');
    s.className = 'cc-tool';
    s.textContent = n;
    wrap.appendChild(s);
  });
  if (wrap.children.length) b.body.appendChild(wrap);
}

// ===== 滚动 / 视口 / 输入框 =====
function ccShowJump(on) {
  var el = $('ccJump');
  if (el) el.classList.toggle('show', !!on);
}
function ccScrollBottom(smooth, force) {
  var t = $('ccThread');
  if (!t) return;
  if (force) CC.stick = true;
  if (!CC.stick) { ccShowJump(true); return; }
  if (smooth && t.scrollTo) t.scrollTo({ top: t.scrollHeight, behavior: 'smooth' });
  else t.scrollTop = t.scrollHeight;
  ccShowJump(false);
}
function ccOnThreadScroll() {
  var t = $('ccThread');
  if (!t) return;
  CC.stick = (t.scrollHeight - t.scrollTop - t.clientHeight) < 110;
  ccShowJump(!CC.stick);
}

function ccSyncViewport() {
  var vv = window.visualViewport;
  var h = vv ? vv.height : (window.innerHeight || document.documentElement.clientHeight);
  var top = vv ? vv.offsetTop : 0;
  document.documentElement.style.setProperty('--cc-vh', Math.round(h) + 'px');
  document.documentElement.style.setProperty('--cc-vtop', Math.round(top) + 'px');
  if (CC.stick) ccScrollBottom(false, true);
}

function ccAutosize() {
  var ta = $('ccInput');
  if (!ta) return;
  ta.style.height = 'auto';
  var max = Math.max(44, Math.round((window.innerHeight || 600) * 0.36));
  var h = Math.min(ta.scrollHeight, max);
  ta.style.height = h + 'px';
  ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
}

function ccFocusInput() {
  var ta = $('ccInput');
  if (!ta) return;
  if (window.innerWidth >= 900) {
    try { ta.focus({ preventScroll: true }); } catch (e) { try { ta.focus(); } catch (x) { /* ignore */ } }
  }
}

// ===== 状态 / 头部 / 侧栏 =====
function ccSetActivity(text, busy) {
  var el = $('ccActivity');
  if (!el) return;
  el.innerHTML = '';
  el.classList.toggle('busy', !!busy && !!text);
  if (!text) return;
  var dot = document.createElement('span');
  dot.className = 'cc-dot';
  var span = document.createElement('span');
  span.textContent = text;
  el.appendChild(dot);
  el.appendChild(span);
  if (busy && CC.taskId) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '停止';
    btn.onclick = ccStop;
    el.appendChild(btn);
  }
}

function ccUpdateComposer() {
  var b = $('ccSend');
  if (!b) return;
  b.classList.toggle('stop', !!CC.busy);
  b.setAttribute('aria-label', CC.busy ? '停止生成' : '发送');
  b.title = CC.busy ? '停止生成' : '发送';
  b.disabled = false;
}

function ccUpdateHeader() {
  var title = 'Claude';
  if (CC.sid) {
    var found = null;
    (CC.sessions || []).forEach(function (s) { if (s.id === CC.sid) found = s; });
    title = found && found.title ? found.title : (CC.titleFromHistory || '会话');
  }
  $('ccTitle').textContent = title || 'Claude';
  $('ccSubtitle').innerHTML = '<span class="cc-dot ' + (CC.busy ? '' : 'online') + '"></span>'
    + (CC.busy ? '正在对话…' : (CC.sid ? 'CloudCLI 通道 · 会话互通' : 'CloudCLI 通道'));
}

function ccOpenSidebar() { $('ccApp').classList.add('sidebar-open'); }
function ccCloseSidebar() { $('ccApp').classList.remove('sidebar-open'); }
function ccGoBack() {
  ccCloseSidebar();
  try {
    if (window.history.length > 1) { window.history.back(); return; }
  } catch (e) { /* ignore */ }
  location.href = '/';
}

// ===== 会话列表 =====
function ccSessionSkeleton() {
  var box = $('ccSessionList');
  if (!box) return;
  box.innerHTML = '<div class="cc-skel-row"></div><div class="cc-skel-row"></div><div class="cc-skel-row"></div>';
}

function ccFindSession(id) {
  var found = null;
  (CC.sessions || []).forEach(function (s) { if (s.id === id) found = s; });
  return found;
}

async function ccRefreshSessions(force) {
  if (!force && CC.sessions && (Date.now() - CC.sessionsAt) < 30000) {
    ccRenderSessions();
    return;
  }
  if (!CC.sessions) ccSessionSkeleton();
  try {
    var r = await ccApi('sessions', '', '&limit=50');
    var d = await r.json().catch(function () { return {}; });
    if (ccHandleAuth(r, d)) return;
    if (!d.sessions) {
      $('ccSessionList').innerHTML = '<div class="cc-sess-empty">会话列表加载失败<br>'
        + esc(d.error || ('HTTP ' + r.status))
        + '</div><div class="cc-sess-empty"><button class="cc-retry" onclick="ccRefreshSessions(true)">重试</button></div>';
      return;
    }
    CC.sessions = d.sessions;
    CC.sessionsAt = Date.now();
    ccRenderSessions();
    ccUpdateHeader();
  } catch (e) {
    $('ccSessionList').innerHTML = '<div class="cc-sess-empty">网络错误，无法加载会话</div>'
      + '<div class="cc-sess-empty"><button class="cc-retry" onclick="ccRefreshSessions(true)">重试</button></div>';
  }
}

function ccRenderSessions() {
  var box = $('ccSessionList');
  if (!box) return;
  var list = CC.sessions || [];
  if (!list.length) {
    box.innerHTML = '<div class="cc-sess-empty">暂无会话<br>说第一句就会出现</div>';
    return;
  }
  var html = '';
  list.forEach(function (s) {
    var active = s.id === CC.sid;
    var title = esc(String(s.title || '（无标题）').slice(0, 64));
    var sub = ccRelTime(s.at);
    if (s.project && s.project !== '/') sub += (sub ? ' · ' : '') + esc(String(s.project).slice(0, 30));
    html += '<div class="cc-sess' + (active ? ' active' : '') + '" data-id="' + escAttr(s.id) + '" role="button" tabindex="0">'
      + '<div class="cc-sess-main"><div class="cc-sess-title">' + title + '</div>'
      + '<div class="cc-sess-sub">' + (sub || '') + '</div></div>'
      + '<div class="cc-sess-actions">'
      + '<button class="cc-sess-act" type="button" data-act="rename" title="重命名" aria-label="重命名">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>'
      + '<button class="cc-sess-act" type="button" data-act="delete" title="删除" aria-label="删除">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg></button>'
      + '</div></div>';
  });
  box.innerHTML = html;
}

async function ccPickSession(id) {
  if (!id) return;
  if (CC.busy) { ccToast('当前任务还在生成中，先停止或等它完成'); return; }
  if (id === CC.sid && CC.historyFor === id) { ccCloseSidebar(); return; }
  CC.sid = id;
  CC.historyFor = '';
  CC.titleFromHistory = '';
  CC.taskId = '';
  localStorage.setItem('claude_sid', id);
  localStorage.removeItem('claude_task');
  $('ccThreadInner').innerHTML = '';
  CC.live = null;
  CC.stick = true;
  ccRenderSessions();
  ccUpdateHeader();
  ccCloseSidebar();
  await ccLoadHistory(id);
}

async function ccLoadHistory(sid) {
  var inner = $('ccThreadInner');
  inner.innerHTML = '<div class="cc-loading-line"><span class="cc-typing"><i></i><i></i><i></i></span>正在加载会话…</div>';
  try {
    var r = await ccApi('history', '', '&id=' + encodeURIComponent(sid) + '&limit=200');
    var d = await r.json().catch(function () { return {}; });
    if (ccHandleAuth(r, d)) return;
    inner.innerHTML = '';
    if (!d.messages) {
      var err = document.createElement('div');
      err.className = 'cc-error';
      err.textContent = '历史加载失败：' + (d.error || ('HTTP ' + r.status));
      inner.appendChild(err);
      var retry = document.createElement('button');
      retry.className = 'cc-retry';
      retry.textContent = '重试';
      retry.onclick = function () { ccLoadHistory(sid); };
      inner.appendChild(retry);
      CC.historyFor = '';
      return;
    }
    var firstUser = '';
    CC.stick = false; // 批量渲染历史时不要每条都滚到底
    if (!d.messages.length) {
      ccAddMsg('ai', '这是一个新会话，说点什么开始吧。', true);
    } else {
      d.messages.forEach(function (m) {
        if (!firstUser && m.role === 'user') firstUser = String(m.text || '');
        ccAddMsg(m.role === 'user' ? 'user' : 'ai', m.text, true);
      });
    }
    CC.stick = true;
    CC.historyFor = sid;
    if (firstUser) CC.titleFromHistory = firstUser.replace(/\s+/g, ' ').slice(0, 40);
    ccScrollBottom(false, true);
    ccUpdateHeader();
  } catch (e) {
    inner.innerHTML = '';
    var e2 = document.createElement('div');
    e2.className = 'cc-error';
    e2.textContent = '历史加载网络错误';
    inner.appendChild(e2);
    var r2 = document.createElement('button');
    r2.className = 'cc-retry';
    r2.textContent = '重试';
    r2.onclick = function () { ccLoadHistory(sid); };
    inner.appendChild(r2);
    CC.historyFor = '';
  }
}

// ===== 发消息 / 停止 / 轮询 =====
function ccPrimaryAction() {
  if (CC.busy) { ccStop(); return; }
  ccSend();
}

async function ccSend() {
  if (CC.busy) return;
  var ta = $('ccInput');
  var msg = (ta && ta.value || '').trim();
  if (!msg) return;
  ta.value = '';
  ccAutosize();
  ccAddMsg('user', msg);

  CC.busy = true;
  CC.stopping = false;
  CC.lastText = '';
  CC.lastTools = [];
  CC.taskId = '';
  CC.live = null;
  ccUpdateComposer();
  ccUpdateHeader();
  ccSetActivity('提交中…', true);
  CC.stick = true;
  ccScrollBottom(false, true);

  try {
    var r = await ccApi('chat', { message: msg, sessionId: CC.sid });
    var d = await r.json().catch(function () { return {}; });
    if (ccHandleAuth(r, d)) { ccUnlock(); return; }
    if (r.status === 409 && d.taskId) {
      ccToast('已切换到正在进行的任务');
      CC.taskId = d.taskId;
      localStorage.setItem('claude_task', d.taskId);
      ccStartPoll();
      return;
    }
    if (!d.taskId) {
      ccAddMsg('ai', '❌ ' + (d.error || ('发送失败 HTTP ' + r.status)));
      ccUnlock();
      return;
    }
    CC.taskId = d.taskId;
    localStorage.setItem('claude_task', d.taskId);
    ccStartPoll();
  } catch (e) {
    ccAddMsg('ai', '');
    var last = $('ccThreadInner').lastElementChild;
    if (last) {
      var body = last.querySelector('.cc-body');
      if (body) body.innerHTML = '<div class="cc-error">' + esc('网络错误：' + (e && e.message || e)) + '</div>';
    }
    ccUnlock();
  }
}

function ccUnlock() {
  CC.busy = false;
  CC.stopping = false;
  CC.resuming = false;
  CC.live = null;
  CC.lastText = '';
  ccUpdateComposer();
  ccUpdateHeader();
  ccSetActivity('');
}

async function ccStop() {
  if (!CC.taskId) {
    if (CC.busy) ccToast('正在提交，请稍候…');
    return;
  }
  if (CC.stopping) return;
  CC.stopping = true;
  ccSetActivity('正在停止…', true);
  var ok = false;
  try {
    var r = await ccApi('cancel', { id: CC.taskId });
    var d = await r.json().catch(function () { return {}; });
    ok = !!d.ok || r.status === 404; // 404 说明任务已经结束/过期，交给轮询收尾
  } catch (e) { /* 下一轮轮询兜底 */ }
  if (!ok) {
    CC.stopping = false;
    ccToast('停止失败，任务可能仍在运行');
  }
  if (CC.timer) clearTimeout(CC.timer);
  CC.timer = setTimeout(ccPollOnce, ok ? 120 : 800);
}

function ccStartPoll() {
  CC.busy = true;
  ccUpdateComposer();
  ccUpdateHeader();
  if (!CC.live) CC.live = ccAddMsg('ai', '');
  CC.lastText = CC.lastText || '';
  ccSetActivity('正在思考…', true);
  if (CC.timer) clearTimeout(CC.timer);
  CC.timer = setTimeout(ccPollOnce, 120);
}

function ccSchedulePoll(delay) {
  if (CC.timer) clearTimeout(CC.timer);
  CC.timer = setTimeout(ccPollOnce, delay);
}

async function ccPollOnce() {
  if (CC.pollBusy) return;
  CC.pollBusy = true;
  CC.timer = null;
  try {
    if (!CC.taskId) { ccStopTimers(); return; }
    var r = await ccApi('task', '', '&id=' + encodeURIComponent(CC.taskId));
    if (r.status === 404) { ccFinishError('任务已失效（服务可能重启过），请重新发送'); return; }
    var d = await r.json().catch(function () { return {}; });
    if (ccHandleAuth(r, d)) { ccStopTimers(); return; }

    var text = typeof d.text === 'string' ? d.text : '';
    if (Array.isArray(d.tools)) CC.lastTools = d.tools;
    if (text && text !== CC.lastText) {
      CC.lastText = text;
      ccSetBubble(CC.live, text, true);
    }

    CC.pollFails = 0;
    if (d.status === 'running') {
      var tool = d.tools && d.tools.length ? String(d.tools[d.tools.length - 1]) : '';
      ccSetActivity(CC.stopping ? '正在停止…' : (tool ? ('正在使用 ' + tool + '…') : (text ? '正在生成回复…' : '正在思考…')), true);
      if (!CC.stopping) ccSchedulePoll(750);
      else ccSchedulePoll(400);
      return;
    }

    if (d.status === 'done') {
      ccFinish(text || CC.lastText || '（Claude 没有返回文本）', true);
      if (d.sessionId && d.sessionId !== CC.sid) {
        CC.sid = d.sessionId;
        CC.historyFor = d.sessionId;
        localStorage.setItem('claude_sid', d.sessionId);
      }
      CC.titleFromHistory = '';
      CC.sessionsAt = 0;
      ccUpdateHeader();
      ccRefreshSessions(true);
      return;
    }

    if (d.status === 'cancelled') {
      var base = text || CC.lastText || '（还没有输出内容）';
      ccFinish(base + '\n\n> 已停止生成', true);
      return;
    }

    var err = d.error || '任务异常结束';
    if (text) {
      ccFinish(text, true);
      var eb = ccAddMsg('ai', '');
      eb.body.innerHTML = '<div class="cc-error">' + esc('⚠️ ' + err) + '</div>';
    } else {
      ccFinishError(err);
    }
  } catch (e) {
    CC.pollFails++;
    if (CC.pollFails >= 8) ccFinishError('轮询失败：' + (e && e.message || e));
    else ccSchedulePoll(1200);
  } finally {
    CC.pollBusy = false;
  }
}

function ccStopTimers() {
  if (CC.timer) { clearTimeout(CC.timer); CC.timer = null; }
  localStorage.removeItem('claude_task');
  CC.taskId = '';
  CC.busy = false;
  CC.stopping = false;
  CC.resuming = false;
  CC.pollFails = 0;
  ccUpdateComposer();
  ccUpdateHeader();
  ccSetActivity('');
}

function ccFinish(text, withTools) {
  var bubble = CC.live;
  // 恢复任务时，历史里可能已经有同一条回复：此时不再保留 live 气泡。
  var dup = !!(bubble && CC.resuming && ccDedupeLive(bubble, text));
  ccStopTimers();
  if (bubble && !dup) {
    ccSetBubble(bubble, text, false);
    if (withTools) ccAppendTools(bubble);
  }
  CC.live = null;
  CC.lastText = '';
  CC.stick = CC.stick !== false;
  ccScrollBottom(false, CC.stick);
}

function ccFinishError(msg) {
  var bubble = CC.live;
  var text = CC.lastText;
  var dup = !!(bubble && CC.resuming && text && ccDedupeLive(bubble, text));
  ccStopTimers();
  if (bubble) {
    if (dup) {
      var eb = ccAddMsg('ai', '');
      eb.body.innerHTML = '<div class="cc-error">' + esc(msg) + '</div>';
    } else {
      ccSetBubble(bubble, text, false);
      var e = document.createElement('div');
      e.className = 'cc-error';
      e.textContent = msg;
      bubble.body.appendChild(e);
    }
  } else {
    var b = ccAddMsg('ai', '');
    b.body.innerHTML = '<div class="cc-error">' + esc(msg) + '</div>';
  }
  CC.live = null;
  CC.lastText = '';
  ccScrollBottom(false, CC.stick);
}

async function ccResumeTask(id) {
  if (!id) return;
  CC.taskId = id;
  var r = null, d = {};
  try {
    r = await ccApi('task', '', '&id=' + encodeURIComponent(id));
    d = await r.json().catch(function () { return {}; });
  } catch (e) { /* 网络异常时退回原来的轮询恢复方式 */ }

  if (r && ccHandleAuth(r, d)) {
    CC.taskId = '';
    localStorage.removeItem('claude_task');
    return;
  }
  if (r && r.status === 404) {
    // 服务重启或任务过期：历史已经加载过，清掉过期标记即可。
    CC.taskId = '';
    localStorage.removeItem('claude_task');
    ccUpdateHeader();
    return;
  }
  if (r && d && d.status && d.status !== 'running') {
    // 任务在页面关闭期间已经结束。历史通常已包含回复，绝不能再新建 live 气泡，
    // 否则同一段回复会显示两遍。只有历史确实缺这条回复时才补上。
    var text = typeof d.text === 'string' ? d.text : '';
    CC.taskId = '';
    localStorage.removeItem('claude_task');
    if (d.sessionId && d.sessionId !== CC.sid) {
      CC.sid = d.sessionId;
      CC.historyFor = d.sessionId;
      localStorage.setItem('claude_sid', d.sessionId);
    }
    if (d.status === 'done') {
      if (text && !ccHistoryHasCompleteAi(text)) {
        ccRemovePartialAiHistory(text);
        ccAddMsg('ai', text, true);
      }
    } else if (d.status === 'cancelled') {
      if (text && !ccHistoryHasCompleteAi(text)) {
        ccRemovePartialAiHistory(text);
        ccAddMsg('ai', text + '\n\n> 已停止生成', true);
      }
    } else if (text) {
      if (!ccHistoryHasCompleteAi(text)) {
        ccRemovePartialAiHistory(text);
        var tb = ccAddMsg('ai', text, true);
        var te = document.createElement('div');
        te.className = 'cc-error';
        te.textContent = '⚠️ ' + (d.error || '任务异常结束');
        tb.body.appendChild(te);
      }
    } else {
      var xb = ccAddMsg('ai', '');
      xb.body.innerHTML = '<div class="cc-error">' + esc('⚠️ ' + (d.error || '任务异常结束')) + '</div>';
    }
    CC.busy = false;
    CC.resuming = false;
    CC.lastText = '';
    ccUpdateComposer();
    ccUpdateHeader();
    ccSetActivity('');
    CC.sessionsAt = 0;
    ccRefreshSessions(true);
    ccScrollBottom(false, true);
    return;
  }

  // 任务仍在运行（或状态查询暂时失败）：恢复轮询。
  CC.busy = true;
  CC.resuming = true;
  CC.live = ccAddMsg('ai', '');
  CC.lastText = '';
  CC.lastTools = [];
  ccUpdateComposer();
  ccUpdateHeader();
  ccSetActivity('正在恢复未完成的任务…', true);
  CC.stick = true;
  ccScrollBottom(false, true);
  ccStartPoll();
}

// ===== 新对话 / 欢迎页 =====
function ccRenderWelcome() {
  var inner = $('ccThreadInner');
  if (!inner) return;
  inner.innerHTML = '<div class="cc-welcome">'
    + '<div class="cc-welcome-mark">✳</div>'
    + '<div class="cc-welcome-title">今天想做什么？</div>'
    + '<div class="cc-welcome-text">我是电脑上那个 Claude：可以查服务器、跑命令、改文件，也能接着 CloudCLI 网页版的会话继续聊。</div>'
    + '<div class="cc-suggests">'
    + '<button class="cc-suggest" type="button" data-q="看看服务器现在的整体状态，有没有异常">检查服务器状态</button>'
    + '<button class="cc-suggest" type="button" data-q="帮我梳理一下今天最值得推进的待办">梳理今日待办</button>'
    + '<button class="cc-suggest" type="button" data-q="看一下最近的采购和记账，有没有值得注意的地方">复盘最近开销</button>'
    + '</div></div>';
}

function ccNewSession() {
  if (CC.busy) { ccToast('当前任务还在生成中，先停止或等它完成'); return; }
  ccStopTimers();
  CC.sid = '';
  CC.historyFor = '';
  CC.titleFromHistory = '';
  CC.live = null;
  CC.lastText = '';
  CC.lastTools = [];
  CC.stick = true;
  localStorage.removeItem('claude_sid');
  localStorage.removeItem('claude_task');
  $('ccThreadInner').innerHTML = '';
  ccRenderWelcome();
  ccRenderSessions();
  ccUpdateHeader();
  ccCloseSidebar();
  ccFocusInput();
}

// ===== 会话改名 / 删除 =====
var _dialogResolve = null;

function ccDialog(opts) {
  return new Promise(function (resolve) {
    _dialogResolve = resolve;
    $('ccDialogTitle').textContent = opts.title || '';
    $('ccDialogText').textContent = opts.text || '';
    var inp = $('ccDialogInput');
    if (opts.input) {
      inp.classList.add('show');
      inp.value = opts.value || '';
      setTimeout(function () { try { inp.focus(); inp.select(); } catch (e) { /* ignore */ } }, 80);
    } else {
      inp.classList.remove('show');
      inp.value = '';
    }
    var ok = $('ccDialogOk');
    ok.textContent = opts.ok || '确定';
    ok.classList.toggle('danger', !!opts.danger);
    $('ccDialogCancel').textContent = opts.cancel || '取消';
    $('ccDialogOverlay').classList.add('show');
  });
}

function ccDialogClose(value) {
  $('ccDialogOverlay').classList.remove('show');
  var r = _dialogResolve;
  _dialogResolve = null;
  if (r) r(value);
}

async function ccRenameSession(id) {
  var cur = ccFindSession(id);
  var title = await ccDialog({
    title: '重命名会话',
    input: true,
    value: cur ? String(cur.title || '') : '',
    ok: '保存'
  });
  if (title == null) return;
  title = String(title).trim();
  if (!title) { ccToast('标题不能为空'); return; }
  if (title.length > 200) { ccToast('标题太长'); return; }
  try {
    var r = await ccApi('rename', { id: id, title: title });
    var d = await r.json().catch(function () { return {}; });
    if (!d.ok) { ccToast(d.error || '重命名失败'); return; }
    if (cur) cur.title = title;
    CC.sessionsAt = 0;
    ccRenderSessions();
    ccUpdateHeader();
    ccRefreshSessions(true);
  } catch (e) { ccToast('网络错误'); }
}

async function ccDeleteSession(id) {
  var ok = await ccDialog({
    title: '删除这个会话？',
    text: '会话会归档，之后仍可在 CloudCLI 网页版恢复。',
    ok: '删除',
    danger: true
  });
  if (!ok) return;
  try {
    var r = await ccApi('delete', { id: id });
    var d = await r.json().catch(function () { return {}; });
    if (!d.ok) { ccToast(d.error || '删除失败'); return; }
    ccToast('已删除');
    if (id === CC.sid) {
      CC.sid = '';
      CC.historyFor = '';
      CC.titleFromHistory = '';
      localStorage.removeItem('claude_sid');
      $('ccThreadInner').innerHTML = '';
      ccRenderWelcome();
      ccUpdateHeader();
    }
    CC.sessionsAt = 0;
    ccRefreshSessions(true);
  } catch (e) { ccToast('网络错误'); }
}

// ===== 事件绑定 / 启动 =====
function ccBind() {
  var ta = $('ccInput');
  ta.addEventListener('input', ccAutosize);
  ta.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229) return; // 中文输入法组字中
    if (e.shiftKey) return;
    e.preventDefault();
    if (CC.busy) return;
    ccSend();
  });

  $('ccThread').addEventListener('scroll', ccOnThreadScroll);
  $('ccThread').addEventListener('click', function (e) {
    var sug = e.target.closest && e.target.closest('.cc-suggest');
    if (sug) {
      ta.value = sug.getAttribute('data-q') || sug.textContent || '';
      ccAutosize();
      ccSend();
      return;
    }
    var codeBtn = e.target.closest && e.target.closest('[data-copy-code]');
    if (codeBtn) {
      var codeEl = codeBtn.closest('.cc-code');
      var code = codeEl && codeEl.querySelector('code');
      if (code) ccCopy(code.textContent);
      return;
    }
    var msgBtn = e.target.closest && e.target.closest('[data-copy-msg]');
    if (msgBtn) {
      var row = msgBtn.closest('.cc-msg');
      var body = row && row.querySelector('.cc-body');
      if (body) ccCopy(body.innerText || body.textContent || '');
    }
  });

  $('ccSessionList').addEventListener('click', function (e) {
    var row = e.target.closest && e.target.closest('.cc-sess');
    if (!row) return;
    var id = row.getAttribute('data-id');
    var act = e.target.closest && e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      if (act.getAttribute('data-act') === 'rename') ccRenameSession(id);
      else ccDeleteSession(id);
      return;
    }
    ccPickSession(id);
  });
  $('ccSessionList').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var row = e.target.closest && e.target.closest('.cc-sess');
    if (!row) return;
    e.preventDefault();
    ccPickSession(row.getAttribute('data-id'));
  });

  $('ccDialogCancel').addEventListener('click', function () { ccDialogClose(null); });
  $('ccDialogOk').addEventListener('click', function () {
    var inp = $('ccDialogInput');
    ccDialogClose(inp.classList.contains('show') ? inp.value : true);
  });
  $('ccDialogInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $('ccDialogOk').click(); }
    else if (e.key === 'Escape') { e.preventDefault(); ccDialogClose(null); }
  });
  $('ccDialogOverlay').addEventListener('click', function (e) {
    if (e.target === this) ccDialogClose(null);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if ($('ccDialogOverlay').classList.contains('show')) { ccDialogClose(null); return; }
    if ($('ccApp').classList.contains('sidebar-open')) ccCloseSidebar();
  });

  window.addEventListener('resize', ccSyncViewport);
  window.addEventListener('orientationchange', function () { setTimeout(ccSyncViewport, 120); });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', ccSyncViewport);
    window.visualViewport.addEventListener('scroll', ccSyncViewport);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && CC.taskId && !CC.pollBusy) ccSchedulePoll(200);
  });

  // Android 实体返回键：先关抽屉，再返回 App
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener('backButton', function () {
        if ($('ccApp').classList.contains('sidebar-open')) { ccCloseSidebar(); return; }
        ccGoBack();
      });
    }
  } catch (e) { /* 非原生环境 */ }
}

async function ccBoot() {
  CC.booted = true;
  ccSyncViewport();
  ccAutosize();
  ccHideGate();
  var u = ccUser();
  $('ccSideUser').textContent = u || '管理员';
  if (u && u !== 'admin') {
    ccShowGate('仅管理员可用', 'Claude 对话会共享同一个 CloudCLI 身份，因此只对管理员开放。', '🔒');
    return;
  }
  if (!ccToken() && !ccRefresh()) {
    ccShowGate('请先登录', '登录状态已失效，请回到 App 用管理员账号登录后再打开。', '🔑');
    return;
  }

  var sid = '';
  try { sid = localStorage.getItem('claude_sid') || ''; } catch (e) { /* ignore */ }
  var task = '';
  try { task = localStorage.getItem('claude_task') || ''; } catch (e) { /* ignore */ }

  if (sid) {
    CC.sid = sid;
    ccUpdateHeader();
    await ccLoadHistory(sid);
  } else {
    ccRenderWelcome();
  }
  ccUpdateHeader();
  ccRefreshSessions(false);
  if (task) ccResumeTask(task);
  ccFocusInput();
}

(function () {
  function start() {
    if (CC.booted) return;
    // 主题：与 App 的 dark_mode 保持一致
    try {
      if (localStorage.getItem('dark_mode') === '1') document.body.classList.add('dark');
    } catch (e) { /* ignore */ }
    ccBind();
    ccBoot();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
