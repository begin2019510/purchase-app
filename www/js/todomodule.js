// todo.js - Todo module

var TODO_API = API_BASE + '/api/todos';
var todoList = [];
var todoView = 'list';
var todoFilter = '全部';
var todoCalYear, todoCalMonth;
var todoCalSelected = null;
var todoSearch = "";
var ganttExpanded = {};
var ganttViewMode = "week"; // day | week | month
var ganttWeekOffset = 0;
var ganttDayOffset = 0;
var ganttMonthOffset = 0;
var ganttNoDateOpen = false;

function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

async function todoApi(method, body, id) {
  var url = TODO_API;
  var opts = { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin() } };
  if (method === 'DELETE') url += '?id=' + id;
  else if (body) opts.body = JSON.stringify(body);
  var r = await fetch(url, opts);
  if (r.status === 401) {
    var nt = await refreshAccessToken();
    if (nt) {
      opts.headers['Authorization'] = 'Bearer ' + nt;
      r = await fetch(url, opts);
    }
  }
  return r.json();
}

async function loadTodos() {
  try {
    var r = await todoApi('GET');
    console.log('loadTodos response:', Array.isArray(r) ? r.length + ' items' : JSON.stringify(r).substring(0,200));
    if (Array.isArray(r)) todoList = r;
    else { console.warn('loadTodos: expected array, got:', r); }
  } catch(e) { console.error('loadTodos error:', e); }
}

// === Refresh Todos (Bug #1 fix) ===
async function refreshTodos() {
  try {
    var result = await todoApi('GET');
    if (result && Array.isArray(result)) {
      todoList = result;
      setCachedData('todos', result);
      render();
      toast('已刷新');
    }
  } catch(e) {
    console.error('refreshTodos error:', e);
    toast('刷新失败');
  }
}

// === Persistent search (Bug #4) ===
function initTodoSearch() {
  var area = document.getElementById('todoSearchArea');
  if (!area || area.children.length > 0) return;
  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '搜索待办...';
  input.value = todoSearch || '';
  input.style.cssText = 'width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;background:var(--card);color:var(--text);box-sizing:border-box';
  input.oninput = function() {
    todoSearch = this.value;
    renderTodo();
  };
  area.appendChild(input);
}


function todoDueBucket(t) {
  if (!t.dueDate) return 'nodate';
  var ts = new Date(t.dueDate).getTime();
  if (isNaN(ts)) return 'nodate';
  var n = new Date();
  var start = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  var diff = ts - start;
  if (diff < 0) return 'overdue';
  if (diff < 86400000) return 'today';
  if (diff < 172800000) return 'tomorrow';
  if (diff < 604800000) return 'week';
  return 'later';
}

function renderTodo() {
  var el = document.getElementById('todoContent');
  if (!el) return;

  var filtered = todoList;
  if (todoFilter !== '全部') {
    if (todoFilter === '高优先级') filtered = todoList.filter(function(t){ return t.priority === '高' && t.status !== '已完成' && t.status !== '已取消' && t.status !== '已删除'; });
    else if (todoFilter === '回收站') filtered = todoList.filter(function(t){ return t.status === '已删除'; });
    else filtered = todoList.filter(function(t){ return t.status === todoFilter; });
  } else {
    filtered = todoList.filter(function(t){ return t.status !== '已删除'; });
  }
  if (todoSearch && todoSearch.trim()) {
    var q = todoSearch.trim().toLowerCase();
    filtered = filtered.filter(function(t) {
      if (t.title && t.title.toLowerCase().indexOf(q) >= 0) return true;
      if (t.description && t.description.toLowerCase().indexOf(q) >= 0) return true;
      if (t.subtasks) {
        try {
          var subs = typeof t.subtasks === "string" ? JSON.parse(t.subtasks) : t.subtasks;
          for (var i = 0; i < subs.length; i++) {
            if (subs[i].text && subs[i].text.toLowerCase().indexOf(q) >= 0) return true;
          }
        } catch(e) {}
      }
      return false;
    });
  }

  filtered.sort(function(a, b) {
    if (a.status === '已完成' && b.status !== '已完成') return 1;
    if (a.status !== '已完成' && b.status === '已完成') return -1;
    var da = a.dueDate ? new Date(a.dueDate).getTime() : 9999999999999;
    var db = b.dueDate ? new Date(b.dueDate).getTime() : 9999999999999;
    if (da !== db) return da - db;
    var pri = { '高': 0, '中': 1, '低': 2 };
    return (pri[a.priority] || 1) - (pri[b.priority] || 1);
  });

  var pending = 0, doing = 0, done = 0, overdue = 0;
  todoList.forEach(function(t){
    if (t.status === '已删除') return;
    if (t.status === '待办') pending++;
    if (t.status === '进行中') doing++;
    if (t.status === '已完成') done++;
    if (t.dueDate && getDueClass(t.dueDate, t.status) === 'due-overdue') overdue++;
  });
  var activeTotal = pending + doing + done;
  var pct = activeTotal > 0 ? Math.round(done / activeTotal * 100) : 0;

  var now = new Date();
  var weekdays = ['日','一','二','三','四','五','六'];
  var dateStr = (now.getMonth()+1) + '月' + now.getDate() + '日 周' + weekdays[now.getDay()];

  var CIRC = 2 * Math.PI * 26;
  var dash = (CIRC * pct / 100).toFixed(1);

  var html = '';
  html += '<div class="td3-header">';
  html += '<div class="td3-titlebar">';
  html += '<div><div class="td3-title">待办</div><div class="td3-date">' + dateStr + '</div></div>';
  html += '<div class="td2-seg">';
  html += '<button class="' + (todoView==='list'?'on':'') + '" onclick="switchTodoView(\x27list\x27)">列表</button>';
  html += '<button class="' + (todoView==='calendar'?'on':'') + '" onclick="switchTodoView(\x27calendar\x27)">日历</button>';
  html += '<button class="' + (todoView==='gantt'?'on':'') + '" onclick="switchTodoView(\x27gantt\x27)">甘特</button>';
  html += '</div></div>';

  html += '<div class="td3-hero">';
  html += '<div class="td3-ring"><svg width="76" height="76"><circle cx="38" cy="38" r="26" fill="none" stroke="var(--border)" stroke-width="7"/><circle cx="38" cy="38" r="26" fill="none" stroke="var(--pri)" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + CIRC.toFixed(1) + '"/></svg><div class="pct">' + pct + '%</div></div>';
  html += '<div class="td3-grid">';
  html += '<div class="td3-cell"><b class="metric-pending">' + pending + '</b><span>待办</span></div>';
  html += '<div class="td3-cell"><b class="metric-doing">' + doing + '</b><span>进行中</span></div>';
  html += '<div class="td3-cell"><b class="metric-overdue' + (overdue?' has-overdue':'') + '">' + overdue + '</b><span>已过期</span></div>';
  html += '<div class="td3-cell"><b class="metric-done">' + done + '</b><span>已完成</span></div>';
  html += '</div></div>';

  html += '<div class="td3-chips">';
  ['全部','待办','进行中','已完成','高优先级','已取消','回收站'].forEach(function(c) {
    var active = todoFilter === c;
    html += '<button type="button" class="chip' + (active?' active':'') + '" aria-pressed="' + active + '" onclick="switchTodoFilter(\x27' + c + '\x27)">' + c + '</button>';
  });
  html += '</div></div>';

  if (todoView === 'calendar') {
    html += buildCalendarHtml();
    el.innerHTML = html;
    return;
  }
  if (todoView === 'gantt') {
    html += buildGanttHtml(filtered);
    el.innerHTML = html;
    return;
  }

  if (filtered.length === 0) {
    html += '<div class="td3-empty"><div class="ico">🌿</div><div class="t">没有待办</div><div class="s">' + (todoFilter==='全部' ? '轻松一下，或点右下角 + 新建' : '该筛选下暂无内容') + '</div></div>';
    el.innerHTML = html;
    return;
  }

  var groups = { overdue: [], today: [], tomorrow: [], week: [], later: [], nodate: [], done: [] };
  filtered.forEach(function(t) {
    if (t.status === '已完成' || t.status === '已取消') groups.done.push(t);
    else groups[todoDueBucket(t)].push(t);
  });
  var meta = {
    overdue: { label: '已过期', dot: 'var(--red)' }, today: { label: '今天', dot: 'var(--orange)' },
    tomorrow: { label: '明天', dot: 'var(--pri)' }, week: { label: '本周', dot: 'var(--pri)' },
    later: { label: '以后', dot: 'var(--muted)' }, nodate: { label: '无日期', dot: 'var(--muted)' },
    done: { label: '已完成 / 已取消', dot: 'var(--green)' }
  };
  ['overdue','today','tomorrow','week','later','nodate','done'].forEach(function(key){
    var arr = groups[key];
    if (!arr.length) return;
    html += '<div class="td3-sec"><span class="td3-dot" style="background:' + meta[key].dot + '"></span>' + meta[key].label + '<span class="td3-n">' + arr.length + '</span></div>';
    html += '<div class="td3-group">';
    arr.forEach(function(t){ html += renderTodoCard(t); });
    html += '</div>';
  });

  el.innerHTML = html;
}

function getLinkDisplay(linkType, linkId) {
  if (!linkType || linkType === '无' || !linkId) return '';
  if (linkType === '采购' && typeof items !== 'undefined') {
    var it = items.find(function(x){ return x.id === linkId; });
    if (it) {
      var name = it['商品名称'] || it['名称'] || '';
      var price = (Number(it['单价']||0) * Number(it['数量']||1)).toFixed(0);
      return '🛒 ' + name + ' (¥' + price + ')';
    }
  } else if (linkType === '记账' && typeof expenses !== 'undefined') {
    var ex = expenses.find(function(x){ return x.id === linkId; });
    if (ex) {
      var name = ex['备注'] || ex['分类'] || '';
      var amount = Number(ex['金额']||0).toFixed(0);
      return '💰 ' + name + ' (¥' + amount + ')';
    }
  }
  return '🔗 ' + linkType;
}

function renderTodoCard(t) {
  var catIcon = { '采购': '🛒', '记账': '💰', '生活': '🏠', '工作': '💼', '健康': '🏥', '其他': '📌' };
  var isDone = t.status === '已完成';
  var isCancel = t.status === '已取消';
  var finished = isDone || isCancel;
  var priColor = t.priority === '高' ? 'var(--red)' : t.priority === '低' ? 'var(--muted)' : 'var(--orange)';
  var idAttr = t.id;

  var rowClass = 'td3-row' + (isDone ? ' td3-done' : '') + (isCancel ? ' td3-cancelled' : '');
  var h = '<article class="' + rowClass + '" data-id="' + escAttr(idAttr) + '">';
  h += '<button type="button" class="td3-check' + (finished ? ' on' : '') + ' priority-' + String(t.priority || '中') + '"' + (!finished ? ' style="--todo-priority:' + priColor + '"' : '') + ' onclick="cycleTodoStatus(\x27' + idAttr + '\x27)" aria-label="' + (finished ? '重新打开' : '完成') + '待办 ' + escAttr(t.title) + '" aria-pressed="' + finished + '">';
  if (finished) h += '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
  h += '</button>';
  h += '<button type="button" class="td3-main" onclick="openTodoDetail(\x27' + idAttr + '\x27)" aria-label="查看待办 ' + escAttr(t.title) + '">';
  h += '<span class="td3-row-title">' + esc(t.title) + '</span>';
  h += '<span class="td3-row-meta">';
  if (t.dueDate) h += '<span class="td2-due ' + getDueClass(t.dueDate, t.status) + '">' + formatDueDate(t.dueDate) + '</span>';
  h += '<span class="td2-chip">' + (catIcon[t.category] || '📌') + ' ' + esc(t.category) + '</span>';
  if (t.repeat && t.repeat !== '无') h += '<span class="td2-chip">🔄 ' + t.repeat + '</span>';
  try {
    JSON.parse(t.tags || '[]').forEach(function(tag) {
      h += '<span class="td2-chip td2-tag">' + esc(tag) + '</span>';
    });
  } catch(e) {}
  if (t.subtasks && t.subtasks !== '[]') {
    try {
      var subs = JSON.parse(t.subtasks);
      var dn = subs.filter(function(s){ return s.done; }).length;
      if (subs.length) h += '<span class="td2-chip">☑ ' + dn + '/' + subs.length + '</span>';
    } catch(e) {}
  }
  if (t.image) h += '<span class="td2-chip">🖼</span>';
  h += '</div></button>';
  h += '<div class="td3-right">';
  if (t.status === '已删除') {
    h += '<button class="td3-mini" onclick="event.stopPropagation();restoreTodo(\x27' + idAttr + '\x27)">恢复</button>';
    h += '<button class="td3-mini danger" onclick="event.stopPropagation();purgeTodo(\x27' + idAttr + '\x27)">删除</button>';
  } else {
    if (t.status === '进行中') h += '<span class="td3-doing">进行中</span>';
    else if (!finished && t.priority === '高') h += '<span class="td3-pri">高</span>';
    h += '<svg class="td3-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="cursor:pointer" onclick="openTodoDetail(\x27' + idAttr + '\x27)"><path d="M9 6l6 6-6 6"/></svg>';
  }
  h += '</div></article>';
  return h;
}

function buildGanttHtml(filtered) {
  var now = new Date();
  var info = ganttRangeInfo();
  var list = Array.isArray(filtered) ? filtered : todoList.slice();
  var html = '';

  // toolbar
  html += '<div class="gantt-wrapper">';
  html += '<div class="gantt-toolbar">';
  html += '<div class="gantt-nav-group">';
  html += '<button class="cal-nav-btn" onclick="ganttNav(-1)" aria-label="上一档">&#8592;</button>';
  html += '<span class="cal-nav-title gantt-title">' + esc(info.label) + '</span>';
  html += '<button class="cal-nav-btn" onclick="ganttNav(1)" aria-label="下一档">&#8594;</button>';
  html += '<button class="cal-nav-btn gantt-today-btn" onclick="ganttNav(0)">今天</button>';
  html += '</div>';
  html += '<div class="gantt-view-switcher" role="tablist">';
  ['day','week','month'].forEach(function(m) {
    var label = m === 'day' ? '天' : m === 'week' ? '周' : '月';
    html += '<button class="gantt-view-btn' + (ganttViewMode===m?' active':'') + '" role="tab" aria-selected="' + (ganttViewMode===m) + '" onclick="switchGanttView(\'' + m + '\')">' + label + '</button>';
  });
  html += '</div>';
  html += '</div>';

  // overdue top red bar (approved): incomplete + past-today
  var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var overdue = list.filter(function(t) {
    if (!t.dueDate) return false;
    if (t.status === '已完成' || t.status === '已取消' || t.status === '已删除') return false;
    return new Date(t.dueDate).getTime() < todayStart;
  }).sort(function(a,b) { return new Date(a.dueDate) - new Date(b.dueDate); });

  if (overdue.length) {
    html += '<div class="gantt-overdue-bar" role="status">';
    html += '<span class="gantt-overdue-ico">⚠</span>';
    html += '<span class="gantt-overdue-count">' + overdue.length + ' 项已过期</span>';
    html += '<span class="gantt-overdue-hint">点条目查看</span>';
    html += '</div>';
    html += '<div class="gantt-overdue-list">';
    overdue.forEach(function(t) {
      var d = new Date(t.dueDate);
      var when = (d.getMonth()+1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
      html += '<div class="gantt-overdue-item" onclick="openTodoDetail(\'' + t.id + '\')">';
      html += '<span class="gantt-overdue-dot"></span>';
      html += '<span class="gantt-overdue-title">' + esc(t.title) + '</span>';
      html += '<span class="gantt-overdue-when">' + when + '</span>';
      html += '</div>';
    });
    html += '</div>';
  }

  html += ganttGridHtml(list, info);

  // no-date footer (collapsible)
  var noDate = list.filter(function(t) {
    return !t.dueDate && t.status !== '已完成' && t.status !== '已取消' && t.status !== '已删除';
  });
  if (noDate.length) {
    html += '<div class="gantt-nodate">';
    html += '<button class="gantt-nodate-toggle" onclick="toggleGanttNoDate()" aria-expanded="' + ganttNoDateOpen + '">';
    html += '<span class="gantt-nodate-caret">' + (ganttNoDateOpen ? '▾' : '▸') + '</span>';
    html += '<span>无日期</span><span class="gantt-nodate-n">' + noDate.length + '</span>';
    html += '</button>';
    if (ganttNoDateOpen) {
      html += '<div class="gantt-nodate-list">';
      noDate.forEach(function(t) {
        var pri = t.priority === '高' ? '高' : t.priority === '低' ? '低' : '中';
        html += '<div class="gantt-nodate-item" onclick="openTodoDetail(\'' + t.id + '\')">';
        html += '<span class="gantt-pri-dot pri-' + pri + '"></span>';
        html += '<span class="gantt-nodate-title">' + esc(t.title) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function ganttRangeInfo() {
  var now = new Date();
  var mode = ganttViewMode || 'week';
  if (mode === 'day') {
    var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d0.setDate(d0.getDate() + ganttDayOffset);
    var end = new Date(d0); end.setDate(end.getDate() + 1);
    var wd = '日一二三四五六'[d0.getDay()];
    return {
      mode: 'day', start: d0, end: end, days: 1, cols: 24,
      label: d0.getFullYear() + '年' + (d0.getMonth()+1) + '月' + d0.getDate() + '日 周' + wd
    };
  }
  if (mode === 'month') {
    var n = new Date(now.getFullYear(), now.getMonth(), 1);
    n.setMonth(n.getMonth() + ganttMonthOffset);
    var y = n.getFullYear(), mo = n.getMonth();
    var dim = new Date(y, mo + 1, 0).getDate();
    var mend = new Date(y, mo + 1, 1);
    return {
      mode: 'month', start: n, end: mend, days: dim, cols: dim, year: y, month: mo,
      label: y + '年' + (mo + 1) + '月'
    };
  }
  // week (Monday-based)
  var day = now.getDay();
  var diff = day === 0 ? 6 : day - 1;
  var mon = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  mon.setDate(mon.getDate() - diff + ganttWeekOffset * 7);
  var wend = new Date(mon); wend.setDate(wend.getDate() + 7);
  var last = new Date(wend); last.setDate(last.getDate() - 1);
  return {
    mode: 'week', start: mon, end: wend, days: 7, cols: 7,
    label: mon.getFullYear() + '年 ' + (mon.getMonth()+1) + '/' + mon.getDate() + ' – ' + (last.getMonth()+1) + '/' + last.getDate()
  };
}

function ganttDateAt(info, i) {
  var d = new Date(info.start);
  d.setDate(d.getDate() + i);
  return d;
}

function ganttBarColor(t, isOverdue) {
  if (isOverdue) return 'var(--red)';
  if (t.priority === '高') return '#ef4444';
  if (t.priority === '低') return '#9ca3af';
  return '#f59e0b';
}

function ganttIsDone(t) {
  return t.status === '已完成' || t.status === '已取消';
}

function ganttInScope(t, info) {
  if (!t.dueDate) return false;
  var ms = new Date(t.dueDate).getTime();
  return ms >= info.start.getTime() && ms < info.end.getTime();
}

function ganttGridHtml(list, info) {
  var now = new Date();
  var todayStr = localDateStr(now);
  var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  var n = info.cols || info.days; // day mode: 24 hour columns; week/month: day columns
  var mode = info.mode;

  var inRange = list.filter(function(t) { return ganttInScope(t, info); })
    .sort(function(a, b) { return new Date(a.dueDate) - new Date(b.dueDate); });

  var html = '<div class="gantt-container mode-' + mode + '">';
  html += '<div class="gantt-scroll">';

  // header
  html += '<div class="gantt-header">';
  html += '<div class="gantt-label-header">待办</div>';
  for (var i = 0; i < n; i++) {
    var d = mode === 'day' ? new Date(info.start) : ganttDateAt(info, i);
    var dateStr = localDateStr(d);
    var isToday = dateStr === todayStr;
    var dow = d.getDay();
    var isWeekend = dow === 0 || dow === 6;
    var hourCls = (mode === 'day' && isToday && i === now.getHours()) ? ' gantt-today-col' : '';
    html += '<div class="gantt-day' + (isToday && mode !== 'day' ? ' today gantt-today-col' : '') + (mode === 'day' ? hourCls : '') + (isWeekend && mode !== 'day' ? ' weekend' : '') + '">';
    if (mode === 'day') {
      html += '<div class="gantt-day-name">' + (i < 10 ? '0' : '') + i + '时</div>';
    } else if (mode === 'month') {
      html += '<div class="gantt-day-name">' + '日一二三四五六'[dow] + '</div>';
      html += '<div class="gantt-day-num">' + d.getDate() + '</div>';
    } else {
      html += '<div class="gantt-day-name">' + '一二三四五六日'[(dow + 6) % 7] + '</div>';
      html += '<div class="gantt-day-num">' + d.getDate() + '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  // now line: only when range contains today
  var nowFrac = null;
  var dayFrac = (now.getHours() + now.getMinutes() / 60) / 24;
  if (mode === 'day' && localDateStr(now) === localDateStr(info.start)) {
    // 24 hour columns: frac across full track = (h + m/60) / 24
    nowFrac = dayFrac;
  } else if (mode === 'week') {
    var dayIdx = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - info.start) / 86400000);
    if (dayIdx >= 0 && dayIdx < n) nowFrac = (dayIdx + dayFrac) / n;
  }
  // month: no vertical now-line (too dense); today cell already highlighted

  if (nowFrac != null) {
    html += '<div class="gantt-now-line" style="--gantt-now-frac:' + nowFrac.toFixed(4) + '"></div>';
  }

  if (inRange.length === 0) {
    html += '<div class="gantt-empty">该时段无待办</div>';
  }

  inRange.forEach(function(t) {
    html += ganttRowHtml(t, info, { todayStr: todayStr, todayStart: todayStart, now: now });
  });

  html += '</div></div>';
  return html;
}

function ganttRowHtml(t, info, ctx) {
  var n = info.cols || info.days;
  var mode = info.mode;
  var due = t.dueDate ? new Date(t.dueDate) : null;
  var isDone = ganttIsDone(t);
  var isOverdue = !isDone && due && due.getTime() < ctx.todayStart;
  var priColor = ganttBarColor(t, isOverdue);
  var subs = [];
  try { subs = JSON.parse(t.subtasks || '[]'); } catch (e) {}
  var hasSubs = subs.length > 0;
  var title = t.title || '';
  var short = title.length > 14 ? title.slice(0, 14) + '…' : title;

  var html = '<div class="gantt-row-wrap' + (isDone ? ' gantt-row-done' : '') + (isOverdue ? ' gantt-row-overdue' : '') + '">';
  html += '<div class="gantt-row" onclick="openTodoDetail(\'' + t.id + '\')">';

  // sticky label + quick complete
  html += '<div class="gantt-label">';
  if (hasSubs) {
    html += '<span class="gantt-expand" onclick="event.stopPropagation();toggleGanttExpand(\'' + t.id + '\')" title="展开子任务">' + (ganttExpanded[t.id] ? '▾' : '▸') + '</span>';
  }
  html += '<button class="gantt-check' + (isDone ? ' on' : '') + '" title="切换状态" onclick="event.stopPropagation();cycleTodoStatus(\'' + t.id + '\')">' + (isDone ? '✓' : '') + '</button>';
  html += '<span class="gantt-label-text" title="' + escAttr(title) + '">' + esc(short) + '</span>';
  html += '</div>';

  // cells: day → 24 hour columns; week/month → day columns
  var dayDateStr = mode === 'day' ? localDateStr(info.start) : null;
  for (var i = 0; i < n; i++) {
    var d, dateStr, isTodayCol, cellCls;
    if (mode === 'day') {
      dateStr = dayDateStr;
      isTodayCol = dateStr === ctx.todayStr && i === ctx.now.getHours();
      cellCls = 'gantt-cell' + (isTodayCol ? ' gantt-today-col' : '');
    } else {
      d = ganttDateAt(info, i);
      dateStr = localDateStr(d);
      isTodayCol = dateStr === ctx.todayStr;
      cellCls = 'gantt-cell' + (isTodayCol ? ' gantt-today-col' : '');
    }
    html += '<div class="' + cellCls + '">';

    var showBar = false;
    if (due) {
      if (mode === 'day') {
        showBar = localDateStr(due) === dayDateStr && due.getHours() === i;
      } else {
        showBar = localDateStr(due) === dateStr;
      }
    }

    if (showBar) {
      var barStyle = 'background:' + priColor + ';';
      var timeTxt = '';
      if (mode === 'day' || mode === 'week') {
        timeTxt = String(due.getHours()).padStart(2, '0') + ':' + String(due.getMinutes()).padStart(2, '0');
      } else if (due.getHours() > 0 || due.getMinutes() > 0) {
        timeTxt = String(due.getHours()).padStart(2, '0') + ':' + String(due.getMinutes()).padStart(2, '0');
      }
      if (mode === 'day') {
        // bar sits inside its hour column; offset by minutes within the hour
        var minFrac = due.getMinutes() / 60;
        var remain = 1 - minFrac;
        barStyle += 'position:absolute;left:' + (minFrac * 100) + '%;width:' + Math.max(14, remain * 96) + '%;top:50%;transform:translateY(-50%);';
      } else if (mode === 'week') {
        var hourFrac = (due.getHours() + due.getMinutes() / 60) / 24;
        barStyle += 'position:absolute;left:' + (hourFrac * 100) + '%;width:' + Math.max(18, (1 - hourFrac) * 100 * 0.92) + '%;top:50%;transform:translateY(-50%);';
      }
      html += '<div class="gantt-bar' + (isDone ? ' done' : '') + (isOverdue ? ' overdue' : '') + '" style="' + barStyle + '">';
      if (timeTxt && !isDone) html += '<span class="gantt-bar-time">' + timeTxt + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>'; // row

  // subtask rows
  if (hasSubs && ganttExpanded[t.id]) {
    subs.forEach(function(sub, si) {
      var subDone = !!sub.done;
      var subPri = sub.priority || '中';
      var subColor = subPri === '高' ? '#ef4444' : subPri === '低' ? '#9ca3af' : '#f59e0b';
      var subDue = sub.dueDate ? new Date(sub.dueDate) : (due || null);
      html += '<div class="gantt-sub-row">';
      html += '<div class="gantt-label gantt-sub-label">';
      html += '<span class="gantt-sub-check">' + (subDone ? '☑' : '☐') + '</span>';
      html += '<span class="gantt-label-text" style="' + (subDone ? 'text-decoration:line-through;opacity:.6' : '') + '">' + esc((sub.text || '').slice(0, 12)) + '</span>';
      html += '</div>';
      for (var i = 0; i < n; i++) {
        var dateStr, isTodayCol;
        if (mode === 'day') {
          dateStr = dayDateStr;
          isTodayCol = dateStr === ctx.todayStr && i === ctx.now.getHours();
        } else {
          dateStr = localDateStr(ganttDateAt(info, i));
          isTodayCol = dateStr === ctx.todayStr;
        }
        html += '<div class="gantt-cell gantt-sub-cell' + (isTodayCol ? ' gantt-today-col' : '') + '">';
        var mark = false;
        if (subDue) {
          if (mode === 'day') {
            mark = localDateStr(subDue) === dayDateStr && subDue.getHours() === i;
          } else {
            mark = localDateStr(subDue) === dateStr;
          }
        }
        if (mark) {
          html += '<div class="gantt-sub-bar" style="background:' + subColor + ';opacity:' + (subDone ? '.3' : '.7') + '"></div>';
        }
        html += '</div>';
      }
      html += '</div>';
    });
  }

  html += '</div>'; // wrap
  return html;
}

function getGanttWeekStart() {
  return ganttRangeInfo().start; // kept for any external callers
}

function ganttNav(dir) {
  if (dir === 0) {
    ganttWeekOffset = 0;
    ganttDayOffset = 0;
    ganttMonthOffset = 0;
  } else if (ganttViewMode === 'day') {
    ganttDayOffset += dir;
  } else if (ganttViewMode === 'month') {
    ganttMonthOffset += dir;
  } else {
    ganttWeekOffset += dir;
  }
  renderTodo();
}

function switchGanttView(mode) {
  ganttViewMode = mode || 'week';
  try { localStorage.setItem('ganttViewMode', ganttViewMode); } catch (e) {}
  renderTodo();
}

function toggleGanttExpand(id) {
  ganttExpanded[id] = !ganttExpanded[id];
  renderTodo();
}

function toggleGanttNoDate() {
  ganttNoDateOpen = !ganttNoDateOpen;
  renderTodo();
}

try {
  var _gm = localStorage.getItem('ganttViewMode');
  if (_gm === 'day' || _gm === 'week' || _gm === 'month') ganttViewMode = _gm;
} catch (e) {}

function buildCalendarHtml() {
  
  if (!todoCalYear) {
    var now = new Date();
    todoCalYear = now.getFullYear();
    todoCalMonth = now.getMonth();
  }

  var html = '';
  html += '<div class="cal-nav">';
  html += '<button class="cal-nav-btn" onclick="todoCalPrev()">◀</button>';
  html += '<span class="cal-nav-title">' + todoCalYear + '年' + (todoCalMonth+1) + '月</span>';
  html += '<button class="cal-nav-btn" onclick="todoCalNext()">▶</button>';
  html += '<button class="cal-nav-btn" onclick="todoCalToday()" style="font-size:11px;padding:3px 8px">今天</button>';
  html += '</div>';

  html += '<div class="cal-grid">';
  var weekDays = ['一','二','三','四','五','六','日'];
  weekDays.forEach(function(d) { html += '<div class="cal-header">' + d + '</div>'; });

  var firstDay = new Date(todoCalYear, todoCalMonth, 1).getDay();
  if (firstDay === 0) firstDay = 7;
  var daysInMonth = new Date(todoCalYear, todoCalMonth + 1, 0).getDate();
  var todayStr = localDateStr(new Date());

  for (var i = 1; i < firstDay; i++) html += '<div class="cal-day empty"></div>';

  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = todoCalYear + '-' + String(todoCalMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday = dateStr === todayStr;
    var dayTodos = todoList.filter(function(t) {
    if (t.dueDate) { var dd = localDateStr(new Date(t.dueDate)); if (dd === dateStr) return true; }
    // Also check subtasks with independent dates
    try { var subs = JSON.parse(t.subtasks || '[]'); if (subs.some(function(s){ return s.dueDate && localDateStr(new Date(s.dueDate)) === todoCalSelected; })) return true; } catch(e) {}
    return false;
  });

    html += '<div class="cal-day' + (isToday ? ' today' : '') + (dayTodos.length ? ' has-todo' : '') + (todoCalSelected === dateStr ? ' selected' : '') + '" onclick="selectTodoCalDay(' + "'" + dateStr + "'" + ')">';
    html += '<div class="cal-day-num">' + d + '</div>';
    if (dayTodos.length) {
      html += '<div class="cal-dots">';
      dayTodos.slice(0, 3).forEach(function(t) {
        var dc = t.priority === '高' ? '#ef4444' : t.priority === '低' ? '#9ca3af' : '#f59e0b';
        html += '<span class="cal-dot" style="background:' + dc + '"></span>';
      });
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';

  // Selected day detail
  if (todoCalSelected) {
    var selTodos = todoList.filter(function(t) {
    if (t.dueDate && localDateStr(new Date(t.dueDate)) === todoCalSelected) return true;
    try { var subs = JSON.parse(t.subtasks || '[]'); if (subs.some(function(s){ return s.dueDate && localDateStr(new Date(s.dueDate)) === todoCalSelected; })) return true; } catch(e) {}
    return false;
  });
    html += '<div class="cal-detail">';
    html += '<div class="cal-detail-title">' + todoCalSelected + ' 的待办</div>';
    if (selTodos.length === 0) {
      html += '<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px">暂无待办</div>';
    } else {
      selTodos.forEach(function(t) {
        var priIcon = t.priority === '高' ? '🔴' : t.priority === '低' ? '⚪' : '🟡';
        var doneMark = t.status === '已完成' ? '✅' : '⬜';
        html += '<div class="cal-todo-item" onclick="openTodoDetail(' + "'" + t.id + "'" + ')">' + doneMark + ' ' + priIcon + ' ' + esc(t.title) + '</div>';
      });
    }
    html += '</div>';
  }

  return html;
}

function renderTodoCalendar() { renderTodo(); }
function todoCalPrev() { todoCalMonth--; if (todoCalMonth < 0) { todoCalMonth = 11; todoCalYear--; } todoCalSelected = null; renderTodoCalendar(); }
function todoCalNext() { todoCalMonth++; if (todoCalMonth > 11) { todoCalMonth = 0; todoCalYear++; } todoCalSelected = null; renderTodoCalendar(); }
function todoCalToday() { var n = new Date(); todoCalYear = n.getFullYear(); todoCalMonth = n.getMonth(); todoCalSelected = localDateStr(n); renderTodo(); }

function selectTodoCalDay(dateStr) { todoCalSelected = todoCalSelected === dateStr ? null : dateStr; renderTodoCalendar(); }

function formatDueDate(d) {
  if (!d) return "";
  var dt = new Date(d);
  var now = new Date();
  var today = localDateStr(now);
  var tomorrow = localDateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  var ds = localDateStr(dt);
  var dateStr = ds;
  var h = dt.getHours(), m = dt.getMinutes();
  var timeStr = (h > 0 || m > 0) ? " " + String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0") : "";
  if (dateStr === today) return "今天" + timeStr;
  if (dateStr === tomorrow) return "明天" + timeStr;
  var md = (dt.getMonth()+1) + "月" + dt.getDate() + "日";
  if (dt.getFullYear() !== now.getFullYear()) md = dt.getFullYear() + "年" + md;
  return md + timeStr;
}

function getDueClass(dueDate, status) {
  if (status === '已完成' || status === '已取消') return '';
  if (!dueDate) return '';
  var d = new Date(dueDate);
  var now = new Date();
  var ds = localDateStr(d);
  var ns = localDateStr(now);
  if (ds < ns) return 'due-overdue';
  if (ds === ns) return 'due-today';
  var diff = Math.floor((new Date(ds) - new Date(ns)) / 86400000);
  if (diff <= 3) return 'due-soon';
  return '';
}

function switchTodoView(v) { todoView = v; renderTodo(); }
function switchTodoFilter(f) { todoFilter = f; renderTodo(); }

var editingTodoId = null;
var todoSubtaskRows = [];
// 必须声明：saveTodo / renderTagChips / renderReminderUI / NLP 都会读它们。
// 此前只「用」不「声明」，iOS Safari 直接 ReferenceError: Can't find variable: todoTags
var todoTags = [];
var todoReminders = [];
// 每日固定提醒时刻 ["09:00","18:00"]（3.0.42）：与截止提醒并存，完成/删除即停
var todoDailyTimes = [];
var todoImage = '';

// Populate link dropdown based on selected link type
function updateLinkOptions() {
  var linkType = document.getElementById('todoLinkType').value;
  var sel = document.getElementById('todoLinkId');
  sel.innerHTML = '<option value="">无</option>';
  if (linkType === '采购' && typeof items !== 'undefined') {
    items.forEach(function(it) {
      var label = (it['商品名称'] || it['名称'] || it.id) + ' (¥' + (Number(it['单价']||0)*Number(it['数量']||1)).toFixed(0) + ')';
      sel.innerHTML += '<option value="' + it.id + '">' + esc(label) + '</option>';
    });
  } else if (linkType === '记账' && typeof expenses !== 'undefined') {
    expenses.forEach(function(ex) {
      var label = (ex['备注'] || ex['分类'] || ex.id) + ' (¥' + Number(ex['金额']||0).toFixed(0) + ')';
      sel.innerHTML += '<option value="' + ex.id + '">' + esc(label) + '</option>';
    });
  }
}

function openTodoModal(id) {
  try {
    console.log("openTodoModal called, id=" + id);
    var overlay = document.getElementById("todoModalOverlay");
    if (!overlay) { console.log("ERROR: todoModalOverlay not found"); return; }
    var t = null;
    if (id) {
      t = todoList.find(function(x){ return x.id === id; });
      // \u4e50\u89c2\u63d2\u5165\u540e DOM \u53ef\u80fd\u4ecd\u662f tmp id\u3001\u5185\u5b58\u5df2\u662f\u771f\u5b9e id\uff1a\u6309 title \u56de\u9000\u4e00\u6b21
      if (!t && String(id).indexOf('tmp') === 0) {
        var _hint = window._pjPendingTodoTitle || "";
        if (_hint) t = todoList.find(function(x){ return x.title === _hint; });
      }
      if (!t) {
        toast('\u8fd9\u6761\u5f85\u529e\u8fd8\u5728\u540c\u6b65\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5');
        return;
      }
      // \u56de\u9000\u547d\u4e2d\u540e\u4e5f\u8981\u7528\u771f\u5b9e id\uff0c\u5426\u5219\u4fdd\u5b58\u4f1a\u6253\u5230\u4e0d\u5b58\u5728\u7684 tmp \u8bb0\u5f55
      id = t.id;
    }
    editingTodoId = t ? t.id : null;
    // \u4ece\u9879\u76ee\u9875\u9762\u5e26\u5165\u7684\u9879\u76ee / \u5206\u7c7b / \u6807\u9898\u8349\u7a3f\uff08\u4ec5\u65b0\u5efa\u65f6\uff09
    var pendingPid = !id ? (window._pendingProjectId || "") : "";
    var pendingCat = !id ? window._pendingTodoCategory : undefined;
    var pendingTitle = !id ? (window._pendingTodoTitle || "") : "";
    // \u6253\u5f00\u65f6\u91cd\u7f6e\u8349\u7a3f\u6001\uff0c\u907f\u514d\u4e0a\u4e00\u6b21\u7684 tags/reminders \u4e32\u5230\u8fd9\u4e00\u6761
    todoTags = [];
    todoReminders = [];
    todoDailyTimes = [];
    todoImage = '';
    if (t) {
      try {
        var _tags0 = JSON.parse(t.tags || '[]');
        if (Array.isArray(_tags0)) todoTags = _tags0.filter(function(x){ return x != null && String(x) !== ''; }).map(String);
      } catch (e) {}
      try {
        var _rem0 = JSON.parse(t.reminders || '[]');
        if (Array.isArray(_rem0)) todoReminders = _rem0.map(Number).filter(function(n){ return isFinite(n); });
      } catch (e) {}
      try {
        var _dt0 = JSON.parse(t.dailyTimes || t.daily_times || '[]');
        if (Array.isArray(_dt0)) todoDailyTimes = _dt0.map(String).filter(function(s){ return /^([01]?\d|2[0-3]):[0-5]\d$/.test(s); });
      } catch (e) {}
      todoImage = t.image || '';
    }
    document.getElementById("todoTitle").value = (t && t.title) ? t.title : pendingTitle;
    document.getElementById("todoDesc").value = (t && t.description) ? t.description : "";
    document.getElementById("todoPriority").value = (t && t.priority) ? t.priority : "\u4e2d";
    var defaultCat = t ? (t.category || "\u5176\u4ed6") : (pendingCat || (pendingPid ? (function(){ try { return localStorage.getItem("pj_todo_category") || "\u5de5\u4f5c"; } catch(e) { return "\u5de5\u4f5c"; } })() : "\u5176\u4ed6"));
    document.getElementById("todoCategory").value = defaultCat;
    document.getElementById("todoRepeat").value = (t && t.repeat) ? t.repeat : "\u65e0";
    document.getElementById("todoLinkType").value = (t && t.linkType) ? t.linkType : "\u65e0";
    updateLinkOptions();
    document.getElementById("todoLinkId").value = (t && t.linkId) ? t.linkId : "";
    var projSel = document.getElementById("todoProjectId");
    if (projSel && typeof getProjectOptions === "function") {
      var pid = t ? (t.projectId || "") : pendingPid;
      projSel.innerHTML = getProjectOptions(pid);
      projSel.value = pid;
      if (window._pendingProjectId) window._pendingProjectId = "";
      var pendingPhase = (t && t.phaseIdx != null && t.phaseIdx !== "")
        ? t.phaseIdx
        : window._pendingPhaseIdx;
      window._pendingPhaseIdx = null;
      window._pendingTodoCategory = null;
      rebuildTodoPhaseSelect(pid, pendingPhase);
    }
    if (t && t.dueDate) {
      var d = new Date(t.dueDate);
      var h = d.getHours(), mi = d.getMinutes();
      document.getElementById("todoDueDate").value = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0") + "T" + String(h).padStart(2,"0") + ":" + String(mi).padStart(2,"0");
    } else {
      document.getElementById("todoDueDate").value = "";
    }
    todoSubtaskRows = [];
    if (t && t.subtasks && t.subtasks !== "[]") {
      try {
        var parsed = JSON.parse(t.subtasks);
        if (Array.isArray(parsed)) {
          todoSubtaskRows = parsed.map(function(s){ return {text:s.text||"",done:!!s.done,priority:s.priority||"\u4e2d",dueDate:s.dueDate||null}; });
          console.log("Loaded " + todoSubtaskRows.length + " subtask rows");
        }
      } catch(e) { console.log("Subtask parse error: " + e.message + ", raw=" + (t.subtasks||"").substring(0,100)); }
    }
    renderSubtaskRows();
    // 标签/提醒区：有容器才画；没有也安全（iOS 表单目前只有 reminder 容器）
    try { if (typeof renderTagChips === 'function') renderTagChips(); } catch (e) {}
    try { if (typeof renderReminderUI === 'function') renderReminderUI(); } catch (e) {}
    var _subEl = document.getElementById("todoSubtaskList");
    console.log("AFTER renderSubtaskRows: el=" + !!_subEl + ", html=" + (_subEl ? _subEl.innerHTML.length : "null") + ", rows=" + todoSubtaskRows.length + ", firstText=" + ((todoSubtaskRows[0]||{}).text||"EMPTY"));
    overlay.classList.add("active");
    // \u5e26\u8349\u7a3f\u6253\u5f00\u65f6\u628a\u5149\u6807\u653e\u5230\u6807\u9898\u672b\u5c3e\uff0c\u65b9\u4fbf\u7ee7\u7eed\u8865\u5168
    if (!t && pendingTitle) {
      setTimeout(function () {
        try {
          var el = document.getElementById("todoTitle");
          if (el && overlay.classList.contains("active")) {
            el.focus();
            if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length);
          }
        } catch (e) {}
      }, 80);
    }
    console.log("openTodoModal: form populated, title=" + document.getElementById("todoTitle").value);
  } catch(e) {
    console.error("openTodoModal ERROR: " + e.message + " at " + e.stack);
    toast("\u6253\u5f00\u5931\u8d25: " + e.message);
  }
}

function closeTodoModal() {
  document.getElementById("todoModalOverlay").classList.remove("active");console.log("TODO_MODAL: closed");
  editingTodoId = null;
  // \u8349\u7a3f\u5df2\u590d\u5236\u8fdb\u8868\u5355\uff1b\u5173\u95ed\u540e\u6e05\u6389\u6682\u5b58\uff0c\u907f\u514d\u4e0b\u6b21\u8bef\u5e26\u5165
  window._pendingTodoTitle = "";
  window._pendingQuickInputId = "";
  todoTags = [];
  todoReminders = [];
  todoDailyTimes = [];
  todoImage = '';
}

// 项目 → 步骤下拉：选了项目才有步骤；未使用的空槽不出现
function rebuildTodoPhaseSelect(projectId, selectedPhaseIdx) {
  var sel = document.getElementById('todoPhaseIdx');
  if (!sel) return;
  var pid = projectId !== undefined ? projectId : ((document.getElementById('todoProjectId') || {}).value || '');
  if (!pid) {
    sel.innerHTML = '<option value="">先选项目</option>';
    sel.value = '';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  var p = (typeof projectList !== 'undefined' && Array.isArray(projectList))
    ? projectList.find(function(x) { return x.id === pid; })
    : null;
  var html = '<option value="">无</option>';
  if (p && p.phases) {
    p.phases.forEach(function(ph) {
      if (typeof pjIsUnusedPhase === 'function' && pjIsUnusedPhase(ph, ph.idx)) return;
      html += '<option value="' + ph.idx + '">' + esc(typeof pjStepTitle === 'function' ? pjStepTitle(ph, ph.idx) : ('第' + (Number(ph.idx) + 1) + '步')) + '</option>';
    });
  }
  sel.innerHTML = html;
  if (selectedPhaseIdx === null || selectedPhaseIdx === undefined || selectedPhaseIdx === '') sel.value = '';
  else sel.value = String(selectedPhaseIdx);
}

function renderSubtaskRows() {
  var el = document.getElementById("todoSubtaskList");
  if (!el) return;
  el.innerHTML = "";
  todoSubtaskRows.forEach(function(s, i) {
    var row = document.createElement("div");
    row.className = "subtask-row";
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;align-items:center;width:100%";
    
    var input = document.createElement("input");
    input.type = "text";
    input.className = "subtask-input";
    input.style.cssText = "flex:1;min-width:0;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--bg);color:var(--text);box-sizing:border-box";
    input.value = s.text || "";
    input.onchange = function() { updateSubtaskText(i, this.value); };
    row.appendChild(input);
    
    var dateBtn = document.createElement("button");
    dateBtn.textContent = "\ud83d\udcc5";
    dateBtn.style.cssText = "width:28px;height:28px;border:none;background:" + (s.dueDate ? "color-mix(in srgb,var(--pri) 20%,var(--card))" : "var(--bg)") + ";border-radius:6px;cursor:pointer;font-size:12px;flex-shrink:0";
    dateBtn.title = s.dueDate || "\u8bbe\u7f6e\u65e5\u671f";
    dateBtn.onclick = function(e) {
      e.stopPropagation();
      var existing = row.querySelector(".subtask-date-row");
      if (existing) { existing.remove(); return; }
      var dateRow = document.createElement("div");
      dateRow.className = "subtask-date-row";
      dateRow.style.cssText = "display:flex;align-items:center;gap:4px;width:100%;padding:2px 0";
      var di = document.createElement("input");
      di.type = "date";
      di.value = s.dueDate || "";
      di.style.cssText = "flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--bg);color:var(--text)";
      di.onchange = function() { todoSubtaskRows[i].dueDate = this.value || null; renderSubtaskRows(); };
      dateRow.appendChild(di);
      if (s.dueDate) {
        var clr = document.createElement("button");
        clr.textContent = "\u2715";
        clr.style.cssText = "border:none;background:#fef2f2;color:#ef4444;border-radius:4px;cursor:pointer;font-size:11px;padding:2px 6px";
        clr.onclick = function() { todoSubtaskRows[i].dueDate = null; renderSubtaskRows(); };
        dateRow.appendChild(clr);
      }
      row.appendChild(dateRow);
    };
    row.appendChild(dateBtn);
    
    var sel = document.createElement("select");
    sel.className = "subtask-pri-select";
    sel.onchange = function() { updateSubtaskPriority(i, this.value); };
    ["\u9ad8","\u4e2d","\u4f4e"].forEach(function(p) {
      var opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      if ((s.priority || "\u4e2d") === p) opt.selected = true;
      sel.appendChild(opt);
    });
    row.appendChild(sel);
    
    var btn = document.createElement("button");
    btn.className = "subtask-del";
    btn.textContent = "\u2715";
    btn.onclick = function() { removeSubtask(i); };
    row.appendChild(btn);
    
    el.appendChild(row);
  });
}

function addSubtask() { if (todoSubtaskRows.length >= 20) return; todoSubtaskRows.push({text: "", done: false, priority: "中", dueDate: null}); renderSubtaskRows(); }
function removeSubtask(i) { todoSubtaskRows.splice(i, 1); renderSubtaskRows(); }
function updateSubtaskText(i, v) { if (todoSubtaskRows[i]) todoSubtaskRows[i].text = v; }
function updateSubtaskPriority(i, val) { if(todoSubtaskRows[i]) todoSubtaskRows[i].priority = val; }
function sortSubtasks(arr) {
  var pri = {"高":0,"中":1,"低":2};
  return arr.slice().sort(function(a,b){
    if(a.done!==b.done) return a.done?1:-1;
    return (pri[a.priority||"中"]||1)-(pri[b.priority||"中"]||1);
  });
}
function getSubtaskProgress(subtasks) {
  if(!subtasks||subtasks==="[]")return null;
  try{var arr=typeof subtasks==="string"?JSON.parse(subtasks):subtasks;if(!Array.isArray(arr)||arr.length===0)return null;var done=arr.filter(function(s){return s.done}).length;return{done:done,total:arr.length,pct:Math.round(done/arr.length*100)}}catch(e){return null}
}


async function saveTodo() {
  try {
    var title = document.getElementById('todoTitle').value.trim();
    if (!title) return toast('请输入标题');

    var _projId = (document.getElementById('todoProjectId')||{}).value || '';
    var _phaseRaw = (document.getElementById('todoPhaseIdx')||{}).value;
    var _phaseIdx = (!_projId || _phaseRaw === '' || _phaseRaw == null) ? null : Number(_phaseRaw);
    if (_phaseIdx != null && (!Number.isInteger(_phaseIdx) || _phaseIdx < 0 || _phaseIdx > 5)) _phaseIdx = null;
    // 先算 dueDate / reminders 局部变量：对象字面量里读 body.dueDate 会在 body 赋值完成前抛错（不选提醒时保存失败）
    var dueDateIso = (function(){
      var v = document.getElementById('todoDueDate').value;
      if (!v) return null;
      var d = new Date(v);
      if (!isFinite(d.getTime())) {
        d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00' : v);
      }
      return isFinite(d.getTime()) ? d.toISOString() : null;
    })();
    var remsArr = Array.isArray(todoReminders) ? todoReminders.map(Number).filter(function(n){return isFinite(n)&&n>0;}) : [];
    if (!remsArr.length && dueDateIso) {
      var _dR = new Date(dueDateIso);
      if (isFinite(_dR.getTime()) && (_dR.getHours() || _dR.getMinutes())) remsArr = [10, 20];
    }
    var dailyArr = Array.isArray(todoDailyTimes)
      ? todoDailyTimes.map(String).filter(function(s){ return /^([01]?\d|2[0-3]):[0-5]\d$/.test(s); })
      : [];
    var body = {
      title: title,
      description: document.getElementById('todoDesc').value.trim(),
      dueDate: dueDateIso,
      priority: document.getElementById('todoPriority').value,
      category: document.getElementById('todoCategory').value,
      repeat: document.getElementById('todoRepeat').value,
      linkType: document.getElementById('todoLinkType').value,
      projectId: _projId,
      phaseIdx: _phaseIdx,
      linkId: document.getElementById('todoLinkId').value || '',
      subtasks: JSON.stringify(todoSubtaskRows.filter(function(s){ return s && s.text && s.text.trim(); })),
      tags: JSON.stringify(Array.isArray(todoTags) ? todoTags : []),
      reminders: JSON.stringify(remsArr),
      dailyTimes: JSON.stringify(dailyArr),
      image: (typeof todoImage !== 'undefined' && todoImage) || ''
    };
    try {
      localStorage.setItem('todo_last_category', body.category);
      if (_projId) localStorage.setItem('pj_todo_category', body.category);
    } catch (e) {}

    console.log('saveTodo: sending', JSON.stringify(body).substring(0,200));
    var r;
    var _editId = editingTodoId;
    // 关弹窗会清掉 pending：先记下快速输入框，保存成功后若标题一致则清空，避免再点「添加」重复
    var _quickInputId = window._pendingQuickInputId || '';
    // Optimistic: close modal and render first
    if (_editId) {
      var _ti = todoList.findIndex(function(t){return t.id===_editId});
      if (_ti >= 0) { todoList[_ti].title = body.title; todoList[_ti].description = body.description; todoList[_ti].dueDate = body.dueDate; todoList[_ti].priority = body.priority; todoList[_ti].category = body.category; todoList[_ti].repeat = body.repeat; todoList[_ti].subtasks = body.subtasks; todoList[_ti].linkType = body.linkType; todoList[_ti].linkId = body.linkId; todoList[_ti].projectId = body.projectId; todoList[_ti].phaseIdx = body.phaseIdx; todoList[_ti].dailyTimes = body.dailyTimes; todoList[_ti].reminders = body.reminders; }
    }
    closeTodoModal();
    render();
    if (_editId) {
      body.id = _editId;
      r = await todoApi('PUT', body);
    } else {
      var _tmpTodo = {id:'tmpT_'+Date.now(),title:body.title,description:body.description,dueDate:body.dueDate,priority:body.priority,category:body.category,status:'待办',repeat:body.repeat,linkType:body.linkType,linkId:body.linkId,projectId:body.projectId,phaseIdx:body.phaseIdx,subtasks:body.subtasks,completedAt:null};
      todoList.unshift(_tmpTodo);
      render();
      r = await todoApi('POST', body);
      if (r && r.id) _tmpTodo.id = r.id;
    }
    console.log('saveTodo: response', JSON.stringify(r));

    if (!r) { toast('保存失败: 服务器无响应'); return; }
    if (r.error) { toast('保存失败: ' + (r.error || '') + (r.detail ? ' ' + JSON.stringify(r.detail).substring(0,100) : '')); if(_tmpTodo)todoList=todoList.filter(function(t){return t.id!==_tmpTodo.id});else loadTodos().then(render).catch(function(){}); render(); return; }
    toast(_editId ? '已更新' : '已创建');
    // 新建成功且快速框仍是同一标题 → 清掉，防止重复添加
    if (!_editId && _quickInputId) {
      try {
        var _qi = document.getElementById(_quickInputId);
        if (_qi && String(_qi.value || '').trim() === body.title) _qi.value = '';
      } catch (e) {}
    }
    // 必须在拿到真实 id 后再重绘，否则列表 onclick 仍是 tmpT_*，点开编辑会空标题
    try { window._pjPendingTodoTitle = body.title; } catch (e) {}
    render();
    // 项目详情若还开着，立即刷新步骤标签/本步待办
    try {
      if (typeof refreshProjectUI === 'function' && typeof _pjDetailId !== 'undefined' && _pjDetailId) {
        await refreshProjectUI(_pjDetailId);
      }
    } catch (e) {}
  } catch(e) {
    console.error('saveTodo error:', e);
    toast('保存失败: ' + e.message);
  }
}

function openTodoDetail(id) {
  var t = todoList.find(function(x){ return x.id === id; });
  if (!t) {
    // tmp id 残留：用最近乐观插入的标题兜底
    if (String(id).indexOf('tmp') === 0) {
      var _hint = window._pjPendingTodoTitle || '';
      if (_hint) t = todoList.find(function(x){ return x.title === _hint; });
    }
  }
  if (!t) { toast('这条待办还在同步，请稍后再试'); return; }
  // 后续按钮一律用解析后的真实 id，避免再点到 tmpPJ_*
  id = t.id;
  if (String(id).indexOf('tmp') !== 0) window._pjPendingTodoTitle = '';
  var overlay = document.getElementById('todoDetailOverlay');
  if (!overlay) return;

  var priColor = t.priority === '高' ? '#ef4444' : t.priority === '低' ? '#9ca3af' : '#f59e0b';
  var catIcon = { '采购': '🛒', '记账': '💰', '生活': '🏠', '工作': '💼', '健康': '🏥', '其他': '📌' };

  var html = '';
  // Priority color bar at top
  html += '<div class="detail-priority-bar" style="background:' + priColor + '"></div>';

  html += '<div class="detail-header">';
  html += '<h2>' + esc(t.title) + '</h2>';
  html += '<button class="close-btn" onclick="closeTodoDetail()">✕</button>';
  html += '</div>';

  html += '<div class="detail-body">';

  html += '<div class="detail-row"><span class="detail-label">状态</span><span class="todo-tag status-' + t.status + '">' + t.status + '</span></div>';
  html += '<div class="detail-row"><span class="detail-label">优先级</span><span class="detail-value" style="color:' + priColor + '">' + t.priority + '</span></div>';
  html += '<div class="detail-row"><span class="detail-label">分类</span><span class="detail-value">' + (catIcon[t.category]||'📌') + ' ' + esc(t.category) + '</span></div>';
  if (t.projectId && typeof projectList !== 'undefined' && Array.isArray(projectList)) {
    var _dp = projectList.find(function(x){ return x.id === t.projectId; });
    if (_dp) {
      var _phLabel = '';
      if (t.phaseIdx != null && t.phaseIdx !== '' && _dp.phases && _dp.phases[Number(t.phaseIdx)]) {
        _phLabel = ' · ' + (typeof pjStepTitle === 'function' ? pjStepTitle(_dp.phases[Number(t.phaseIdx)], Number(t.phaseIdx)) : ('第' + (Number(t.phaseIdx) + 1) + '步'));
      }
      html += '<div class="detail-row"><span class="detail-label">项目</span><span class="detail-value">📁 ' + esc(_dp.name) + esc(_phLabel) + '</span></div>';
    }
  }
  if (t.dueDate) html += '<div class="detail-row"><span class="detail-label">截止日期</span><span class="detail-value ' + getDueClass(t.dueDate, t.status) + '">📅 ' + formatDueDate(t.dueDate) + '</span></div>';
  if (t.repeat && t.repeat !== '无') html += '<div class="detail-row"><span class="detail-label">重复</span><span class="detail-value">🔄 ' + t.repeat + '</span></div>';
  try {
    var _dd = JSON.parse(t.dailyTimes || t.daily_times || '[]');
    if (Array.isArray(_dd) && _dd.length) {
      html += '<div class="detail-row"><span class="detail-label">每日提醒</span><span class="detail-value">⏰ ' + _dd.join('、') + '</span></div>';
    }
  } catch (e) {}
  try {
    var _rr = JSON.parse(t.reminders || '[]');
    if (Array.isArray(_rr) && _rr.length) {
      var _rl = _rr.map(function(n){ return n >= 60 ? (n / 60) + ' 小时' : n + ' 分钟'; }).join('、');
      html += '<div class="detail-row"><span class="detail-label">截止前提醒</span><span class="detail-value">🔔 ' + _rl + '</span></div>';
    }
  } catch (e) {}

  if (t.description) html += '<div class="detail-desc">' + esc(t.description) + '</div>';
  // Tags display (Bug #7)
  if (t.tags) {
    try {
      var tags = typeof t.tags === 'string' ? JSON.parse(t.tags) : t.tags;
      if (Array.isArray(tags) && tags.length > 0) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">';
        tags.forEach(function(tag) {
          html += '<span style="display:inline-block;padding:3px 10px;background:var(--pri-bg,#eef2ff);color:var(--pri,#6366f1);border-radius:20px;font-size:12px;font-weight:600">' + esc(tag) + '</span>';
        });
        html += '</div>';
      }
    } catch(e) {}
  }

  // Image preview
  if (t.image) {
    html += '<div style="margin:10px 0"><img src="' + (t.image.startsWith('http') ? t.image : t.image) + '" style="max-width:100%;max-height:200px;border-radius:10px;cursor:pointer" onclick="showFullImage(this.src)" onerror="this.style.display=\'none\'"/></div>';
  }

  if (t.subtasks && t.subtasks !== '[]') {
    try {
      var subs = JSON.parse(t.subtasks);
      var doneCount = subs.filter(function(s){ return s.done; }).length;
      html += '<div class="detail-subtasks">';
      html += '<div class="detail-subtasks-title">子任务 · ' + doneCount + '/' + subs.length + '</div>';
      subs.forEach(function(s, i) {
        var ck = s.done ? 'checked' : '';
        var txtCls = s.done ? ' class="done-text"' : '';
        html += '<label class="subtask-check"><input type="checkbox" ' + ck + ' onchange="toggleTodoSubtask(' + "'" + id + "'," + i + ')"><span' + txtCls + '>' + esc(s.text) + '</span></label>';
      });
      html += '</div>';
    } catch(e) {}
  }

  if (t.linkType && t.linkType !== '无') {
    var linkDisp = getLinkDisplay(t.linkType, t.linkId);
  if (linkDisp) html += '<div class="detail-row"><span class="detail-label">关联</span><span class="detail-value" style="cursor:pointer" onclick="showLinkPreview(\'' + t.linkType + '\',\'' + t.linkId + '\')">' + linkDisp + ' ➡</span></div>';
  }

  if (t.completedAt) {
    var cd = new Date(t.completedAt);
    html += '<div class="detail-row"><span class="detail-label">完成时间</span><span class="detail-value">✅ ' + localDateStr(new Date(cd)) + '</span></div>';
  }

  html += '</div>';

  html += '<div class="detail-actions">';
  if (t.status !== '已完成' && t.status !== '已取消') {
    html += '<button class="btn-action btn-complete" onclick="cycleTodoStatus(' + "'" + id + "'" + ')">✅ 完成</button>';
    html += '<button class="btn-action btn-edit" onclick="closeTodoDetail();openTodoModal(' + "'" + id + "'" + ')">✏️ 编辑</button>';
  }
  html += '<button class="btn-action btn-delete" onclick="deleteTodo(' + "'" + id + "'" + ')">🗑️ 删除</button>';
  html += '</div>';

  document.getElementById('todoDetailBody').innerHTML = html;
  overlay.classList.add('active');
}

function showLinkPreview(type, id) {
  // Remove existing preview
  var old = document.getElementById('linkPreviewPopover');
  if (old) { old.remove(); return; }

  var html = '';
  var jumpFn = '';
  if (type === '采购' && typeof items !== 'undefined') {
    var it = items.find(function(x){ return x.id === id; });
    if (!it) return;
    var name = it['商品名称'] || it['名称'] || '';
    var price = (Number(it['单价']||0) * Number(it['数量']||1)).toFixed(0);
    var status = it['状态'] || '';
    html = '<div style="font-weight:700;font-size:15px;margin-bottom:6px">🛒 ' + esc(name) + '</div>';
    html += '<div style="color:var(--pri);font-weight:800;font-size:18px;margin-bottom:4px">¥' + price + '</div>';
    html += '<div style="font-size:12px;color:var(--muted)">状态: ' + status + '</div>';
    jumpFn = "switchTab('purchase');closeTodoDetail();";
  } else if (type === '记账' && typeof expenses !== 'undefined') {
    var ex = expenses.find(function(x){ return x.id === id; });
    if (!ex) return;
    var name = ex['备注'] || ex['分类'] || '';
    var amount = Number(ex['金额']||0).toFixed(0);
    html = '<div style="font-weight:700;font-size:15px;margin-bottom:6px">💰 ' + esc(name) + '</div>';
    html += '<div style="color:var(--pri);font-weight:800;font-size:18px;margin-bottom:4px">¥' + amount + '</div>';
    jumpFn = "switchTab('expense');closeTodoDetail();";
  }
  if (!html) return;

  var pop = document.createElement('div');
  pop.id = 'linkPreviewPopover';
  pop.className = 'link-preview-popover';
  pop.innerHTML = html + '<button onclick="' + jumpFn + 'this.closest(\x22#linkPreviewPopover\x22).remove()" style="margin-top:10px;width:100%;padding:8px;background:var(--pri);color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">查看详情 ➡</button>';
  document.body.appendChild(pop);

  // Close on click outside
  setTimeout(function() {
    document.addEventListener('click', function handler(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', handler); }
    });
  }, 10);
}

function jumpToLink(type, id) {
  if (type === '采购') {
    switchTab('purchase');
    setTimeout(function(){ openDetailModal(id); }, 300);
  } else if (type === '记账') {
    switchTab('expense');
  }
}

function closeTodoDetail() {
  document.getElementById('todoDetailOverlay').classList.remove('active');
}

// 待办在项目详情里被完成/删除/改状态时：render() 只重画列表页签，
// 打开的 #projectDetailBody 不会动 → 步骤下卡片永远不更新。必须连详情一起刷。
function syncTodoProjectUI() {
  try { if (typeof render === 'function') render(); } catch (e) {}
  try {
    if (typeof _pjDetailId !== 'undefined' && _pjDetailId && typeof pjRerenderDetail === 'function') {
      var dO = document.getElementById('projectDetailOverlay');
      if (dO && dO.classList.contains('active')) pjRerenderDetail(_pjDetailId);
    }
  } catch (e) {}
}

function cycleTodoStatus(id) {
  var t = todoList.find(function(x){ return x.id === id; });
  if (!t) { toast('这条待办还在同步，请稍后再试'); return; }
  // 未拿到服务端 id 时禁止 PUT，避免用 tmp id 写库失败后把界面状态改乱
  if (String(t.id).indexOf('tmp') === 0) { toast('保存中，请稍候'); return; }
  var oldStatus = t.status;
  var nextStatus = oldStatus === '待办' ? '进行中' : oldStatus === '进行中' ? '已完成' : '待办';
  var completedAt = nextStatus === '已完成' ? Date.now() : null;
  t.status = nextStatus;
  if (completedAt) t.completedAt = completedAt;
  syncTodoProjectUI();
  var detailOverlay = document.getElementById('todoDetailOverlay');
  if (detailOverlay && detailOverlay.classList.contains('active')) openTodoDetail(id);
  (async function() {
    try {
      var r = await todoApi('PUT', { id: id, status: nextStatus, completedAt: completedAt });
      if (r && r.error) { toast('操作失败: ' + r.error); t.status = oldStatus; syncTodoProjectUI(); return; }
      if (r.renewed) { toast('✅ 已完成，已自动创建下一期'); loadTodos().then(function(){ syncTodoProjectUI(); if (typeof renderTodo === 'function') renderTodo(); }); }
      else toast(nextStatus === '已完成' ? '✅ 已完成' : nextStatus === '进行中' ? '▶ 进行中' : '↩ 已恢复待办');
      if (nextStatus === '已完成' || nextStatus === '已取消') cancelLocalNotification(t);
      else if (t.reminders) scheduleLocalNotification(t);
    } catch(e) { t.status = oldStatus; syncTodoProjectUI(); toast('操作失败: ' + e.message); }
  })();
}

async function deleteTodo(id) {
  if (String(id).indexOf('tmp') === 0) { toast('保存完成后再删除'); return; }
  if (!confirm('确定删除？')) return;
  closeTodoDetail();
  var t = todoList.find(function(x){ return x.id === id; });
  if (!t) { toast('这条待办还在同步，请稍后再试'); return; }
  var oldStatus = t ? t.status : null;
  if (t) { t.status = '已删除'; }
  syncTodoProjectUI();
  var r = await todoApi('DELETE', null, id);
  if (r && r.error) { toast('删除失败: ' + r.error); if(t) t.status = oldStatus; syncTodoProjectUI(); return; }
  toast('已移入回收站');
}
async function toggleTodoSubtask(todoId, index) {
  var t = todoList.find(function(x){ return x.id === todoId; });
  if (!t) return;
  try {
    var subs = JSON.parse(t.subtasks || '[]');
    if (subs[index]) subs[index].done = !subs[index].done;
    var newSubs = JSON.stringify(subs);
    // Check auto-status BEFORE render (Bug #2 fix)
    var allDone = subs.length > 0 && subs.every(function(s){ return s.done; });
    var anyUndone = subs.some(function(s){ return !s.done; });
    t.subtasks = newSubs;
    if (allDone && t.status !== '已完成') {
      t.status = '已完成';
      t.completedAt = new Date().toISOString();
    } else if (anyUndone && t.status === '已完成') {
      t.status = '进行中';
      t.completedAt = null;
    }
    syncTodoProjectUI();
    await todoApi('PUT', { id: todoId, subtasks: newSubs });
    if (allDone) {
      await todoApi('PUT', { id: todoId, status: '已完成', completedAt: t.completedAt });
    } else if (anyUndone) {
      await todoApi('PUT', { id: todoId, status: '进行中' });
    }
    // Refresh detail if open
    var detailOverlay = document.getElementById('todoDetailOverlay');
    if (detailOverlay && detailOverlay.classList.contains('active')) openTodoDetail(todoId);
  } catch(e) {}
}
// Project auto-status check
// 已按 PROJECT-PHASE-DESIGN 废除：Todo 完成度不再驱动项目状态（阶段说了算）
function checkProjectAutoStatus(projectId) {
  return; // no-op
  var linked = todoList.filter(function(t){ return t.projectId === projectId; });
  if (linked.length === 0) return;
  var allDone = linked.every(function(t){ return t.status === '已完成'; });
  var p = projectList.find(function(x){ return x.id === projectId; });
  if (!p) return;
  if (allDone && p.status !== '已完成') {
    p.status = '已完成';
    projectApi('PUT', { id: projectId, status: '已完成' });
  } else if (!allDone && p.status === '已完成') {
    p.status = '进行中';
    projectApi('PUT', { id: projectId, status: '进行中' });
  }
}

function restoreTodo(id) {
  var t = todoList.find(function(x){ return x.id === id; });
  if (t) { t.status = '待办'; }
  render();
  todoApi('PUT', { id: id, status: '待办' });
  toast('已恢复');
}


async function purgeTodo(id) {
  if (!confirm('彻底删除后无法恢复，确定？')) return;
  todoList = todoList.filter(function(t){ return t.id !== id; });
  render();
  try {
    var url = TODO_API + '?id=' + id + '&action=purge';
    var opts = { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin() } };
    var r = await fetch(url, opts);
    var d = await r.json();
    if (d && d.error) { toast('彻底删除失败'); loadTodos(); }
    else toast('已彻底删除');
  } catch(e) { toast('彻底删除失败'); loadTodos(); }
}

function stringHashColor(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  var h = Math.abs(hash) % 360;
  return { bg: 'hsl(' + h + ',60%,92%)', text: 'hsl(' + h + ',60%,35%)' };
}

function getAllTags() {
  var tagSet = {};
  todoList.forEach(function(t) {
    try {
      var tags = JSON.parse(t.tags || '[]');
      tags.forEach(function(tag) { tagSet[tag] = true; });
    } catch(e) {}
  });
  return Object.keys(tagSet);
}

function renderTagChips() {
  var el = document.getElementById('todoTagChips');
  if (!el) return;
  if (!Array.isArray(todoTags)) todoTags = [];
  var html = '';
  todoTags.forEach(function(tag, i) {
    var c = stringHashColor(tag);
    html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:11px;background:' + c.bg + ';color:' + c.text + ';margin:2px">' + esc(tag) + '<span onclick="todoTags.splice(' + i + ',1);renderTagChips()" style="cursor:pointer;font-weight:700">×</span></span>';
  });
  // Quick add from existing tags
  var allTags = getAllTags();
  var unused = allTags.filter(function(t){ return todoTags.indexOf(t) < 0; });
  if (unused.length > 0) {
    html += '<div style="margin-top:4px">';
    unused.forEach(function(tag) {
      html += '<span onclick="todoTags.push(\'' + tag + '\');renderTagChips()" style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;background:var(--bg);color:var(--muted);cursor:pointer;margin:2px">+ ' + esc(tag) + '</span>';
    });
    html += '</div>';
  }
  el.innerHTML = html;
}

function addTagFromInput() {
  var input = document.getElementById('todoTagInput');
  if (!input) return;
  var val = input.value.trim();
  if (val && todoTags.indexOf(val) < 0) {
    todoTags.push(val);
    renderTagChips();
  }
  input.value = '';
}

function showFullImage(src) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.9);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer';
  overlay.onclick = function() { overlay.remove(); };
  var img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:95%;max-height:95%;border-radius:8px';
  overlay.appendChild(img);
  document.body.appendChild(overlay);
}

function renderReminderUI() {
  var el = document.getElementById('todoReminderChips');
  if (!el) return;
  if (!Array.isArray(todoReminders)) todoReminders = [];
  if (!Array.isArray(todoDailyTimes)) todoDailyTimes = [];
  var html = '';
  // —— 截止前提醒档位 ——
  var options = [{v:'10',l:'提前10分钟'},{v:'20',l:'提前20分钟'},{v:'30',l:'提前30分钟'},{v:'60',l:'提前1小时'},{v:'1440',l:'提前1天'}];
  todoReminders.forEach(function(r, i) {
    var opt = options.find(function(o){ return o.v === String(r); });
    html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:11px;background:color-mix(in srgb,var(--pri) 12%,var(--card));color:var(--pri);margin:2px">' + (opt ? opt.l : r + '分钟') + '<span onclick="todoReminders.splice(' + i + ',1);renderReminderUI()" style="cursor:pointer;font-weight:700">×</span></span>';
  });
  var unused = options.filter(function(o){ return todoReminders.indexOf(parseInt(o.v)) < 0; });
  if (unused.length > 0) {
    html += '<div style="margin-top:4px">';
    unused.forEach(function(o) {
      html += '<span onclick="todoReminders.push(' + o.v + ');renderReminderUI()" style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;background:var(--bg);color:var(--muted);cursor:pointer;margin:2px">+ ' + o.l + '</span>';
    });
    html += '</div>';
  }
  // 空选不是必填：设了具体时间时默认提前 10/20 分钟（与服务端 notify-todos 一致）
  html += '<div style="margin-top:6px;font-size:10px;line-height:1.4;color:var(--muted)">不选也可以保存 · 设了具体时间默认提前 10/20 分钟推送</div>';

  // —— 每日固定提醒时刻（3.0.42，与截止提醒并存）——
  html += '<div style="margin-top:8px;padding-top:6px;border-top:1px dashed color-mix(in srgb,var(--muted) 30%,transparent)">';
  html += '<div style="font-size:11px;font-weight:600;margin-bottom:2px">⏰ 每日固定提醒</div>';
  var dayOpts = ['09:00','12:00','18:00','21:00'];
  todoDailyTimes.forEach(function(s, i) {
    html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:12px;font-size:11px;background:color-mix(in srgb,#f59e0b 18%,var(--card));color:#b45309;margin:2px">' + s + '<span onclick="todoDailyTimes.splice(' + i + ',1);renderReminderUI()" style="cursor:pointer;font-weight:700">×</span></span>';
  });
  var dayUnused = dayOpts.filter(function(o){ return todoDailyTimes.indexOf(o) < 0; });
  if (dayUnused.length) {
    html += '<div style="margin-top:4px">';
    dayUnused.forEach(function(o) {
      html += '<span onclick="todoDailyTimes.push(\'' + o + '\');renderReminderUI()" style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;background:var(--bg);color:var(--muted);cursor:pointer;margin:2px">+ ' + o + '</span>';
    });
    html += '</div>';
  }
  html += '<div style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
  html += '<input type="time" id="todoDailyCustom" style="font-size:11px;padding:2px 4px;border-radius:6px;border:1px solid color-mix(in srgb,var(--muted) 40%,transparent);background:var(--bg);color:var(--text,#111)">';
  html += '<button type="button" onclick="todoAddDailyTime()" style="padding:2px 8px;border-radius:10px;font-size:10px;border:none;background:var(--pri);color:#fff;cursor:pointer">＋ 自定义</button>';
  html += '</div>';
  html += '<div style="margin-top:4px;font-size:10px;line-height:1.4;color:var(--muted)">每天到点各推一次（不依赖截止/重复）；完成或删除即停</div>';
  html += '</div>';
  el.innerHTML = html;
}

function todoAddDailyTime() {
  var inp = document.getElementById('todoDailyCustom');
  if (!inp || !inp.value) { toast('先选一个时刻'); return; }
  var v = String(inp.value);
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(v)) { toast('时刻格式不正确'); return; }
  var hh = String(Number(v.split(':')[0])).padStart(2, '0');
  var mm = v.split(':')[1];
  var s = hh + ':' + mm;
  if (!Array.isArray(todoDailyTimes)) todoDailyTimes = [];
  if (todoDailyTimes.indexOf(s) >= 0) { toast('已有该时刻'); return; }
  if (todoDailyTimes.length >= 8) { toast('最多 8 个每日时刻'); return; }
  todoDailyTimes.push(s);
  todoDailyTimes.sort();
  renderReminderUI();
}

/** 项目待办通知前缀/正文：与服务端 notify-todos 一致 */
function todoNotifyStyle(todo) {
  var isPj = !!(todo && todo.projectId);
  var pjName = '';
  if (isPj && typeof projectList !== 'undefined' && Array.isArray(projectList)) {
    var p = projectList.find(function(x){ return x.id === todo.projectId; });
    if (p) pjName = p.name || '';
  }
  return {
    isProject: isPj,
    titlePrefix: isPj ? '📁 项目' : '⏰ 待办',
    bodyPrefix: isPj && pjName ? ('📁 ' + pjName) : '',
  };
}

function scheduleLocalNotification(todo) {
  if (!todo.dueDate || !todo.reminders) return;
  if (typeof Capacitor === 'undefined' || !Capacitor.Plugins || !Capacitor.Plugins.LocalNotifications) return;
  try {
    var reminders = JSON.parse(todo.reminders || '[]');
    if (!Array.isArray(reminders) || !reminders.length) reminders = [10, 20];
    reminders = reminders.map(Number).filter(function(n){ return isFinite(n) && n > 0; });
    var dueTime = new Date(todo.dueDate).getTime();
    var style = todoNotifyStyle(todo);
    var ids = [];
    reminders.forEach(function(minutesBefore, i) {
      var fireTime = dueTime - minutesBefore * 60000;
      if (fireTime > Date.now()) {
        var notifId = parseInt(todo.id.replace(/\D/g,'').slice(-8)) * 10 + i;
        ids.push(notifId);
        var when = minutesBefore >= 60 ? ('还有' + Math.round(minutesBefore/60) + '小时到截止') : ('还有' + minutesBefore + '分钟到截止');
        var body = style.isProject
          ? ((style.bodyPrefix ? style.bodyPrefix + ' · ' : '') + todo.title + ' · ' + when)
          : (todo.title + ' · ' + when);
        Capacitor.Plugins.LocalNotifications.schedule({ notifications: [{
          id: notifId,
          title: style.titlePrefix,
          body: body,
          schedule: { at: new Date(fireTime) }
        }]});
      }
    });
    todo._notifIds = ids;
  } catch(e) { console.log('scheduleLocalNotification error:', e); }
}

function cancelLocalNotification(todo) {
  if (!todo._notifIds || typeof Capacitor === 'undefined') return;
  try {
    Capacitor.Plugins.LocalNotifications.cancel({ notifications: todo._notifIds.map(function(id){ return {id:id}; }) });
  } catch(e) {}
}

function parseNaturalInput(text) {
  var result = { title: text, dueDate: null, priority: null, repeat: null, tags: [], needAI: false };
  
  // Extract tags: #tagname
  var tagMatch = text.match(/#([一-龥a-zA-Z0-9_]+)/g);
  if (tagMatch) {
    tagMatch.forEach(function(m) { result.tags.push(m.slice(1)); });
    result.title = result.title.replace(/#[一-龥a-zA-Z0-9_]+/g, '').trim();
  }
  
  // Extract priority
  var priMatch = text.match(/[!]([高中低])/);
  if (priMatch) { result.priority = priMatch[1]; result.title = result.title.replace(/[!][高中低]/, '').trim(); }
  if (text.indexOf('高优先级') >= 0) { result.priority = '高'; result.title = result.title.replace('高优先级', '').trim(); }
  
  // Extract repeat
  if (text.indexOf('每天') >= 0) { result.repeat = '每天'; result.title = result.title.replace('每天', '').trim(); }
  else if (text.indexOf('每周') >= 0) { result.repeat = '每周'; result.title = result.title.replace('每周', '').trim(); }
  else if (text.indexOf('每月') >= 0) { result.repeat = '每月'; result.title = result.title.replace('每月', '').trim(); }
  
  // Extract date/time
  var now = new Date();
  var dateSet = false;
  var h = -1, mi = 0;
  
  // Time patterns
  var timeMatch = text.match(/(上午|下午|晚上)?(\\d{1,2})[点时:](\\d{1,2})?[分钟]?/);
  if (timeMatch) {
    h = parseInt(timeMatch[2]);
    mi = timeMatch[3] ? parseInt(timeMatch[3]) : 0;
    if (timeMatch[1] === '下午' && h < 12) h += 12;
    if (timeMatch[1] === '晚上' && h < 12) h += 12;
    result.title = result.title.replace(timeMatch[0], '').trim();
  }
  
  // Date patterns
  if (text.indexOf('今天') >= 0 || text.indexOf('今儿') >= 0) {
    result.dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    dateSet = true; result.title = result.title.replace(/今天|今儿/, '').trim();
  } else if (text.indexOf('明天') >= 0 || text.indexOf('明儿') >= 0) {
    result.dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    dateSet = true; result.title = result.title.replace(/明天|明儿/, '').trim();
  } else if (text.indexOf('后天') >= 0) {
    result.dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    dateSet = true; result.title = result.title.replace('后天', '').trim();
  } else if (text.indexOf('大后天') >= 0) {
    result.dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3);
    dateSet = true; result.title = result.title.replace('大后天', '').trim();
  } else {
    var weekMatch = text.match(/下周([一二三四五六日天])/);
    if (weekMatch) {
      var dayMap = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'日':0,'天':0};
      var targetDay = dayMap[weekMatch[1]];
      var diff = (targetDay - now.getDay() + 7) % 7 + 7;
      result.dueDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
      dateSet = true; result.title = result.title.replace(weekMatch[0], '').trim();
    }
  }
  
  // If date was set, apply time
  if (dateSet && result.dueDate && h >= 0) {
    result.dueDate.setHours(h, mi, 0, 0);
  }
  
  // Check if AI is needed (fuzzy expressions)
  var fuzzyWords = ['左右', '大概', '月底', '年前', '过几天', '近几天', '改天', '有空'];
  if (fuzzyWords.some(function(w){ return text.indexOf(w) >= 0; })) {
    result.needAI = true;
  }
  
  return result;
}

var _nlpTimer = null;
function onTodoTitleInput(value) {
  if (_nlpTimer) clearTimeout(_nlpTimer);
  _nlpTimer = setTimeout(function() {
    var parsed = parseNaturalInput(value);
    var chipEl = document.getElementById('nlpChips');
    if (!chipEl) return;
    var chips = '';
    if (parsed.dueDate) {
      chips += '<span class="nlp-chip" onclick="document.getElementById(\'todoDueDate\').value=\'\';this.remove()">📅 ' + formatDueDate(parsed.dueDate.toISOString()) + '</span>';
      var dt = parsed.dueDate;
      var ds = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0') + 'T' + String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');
      document.getElementById('todoDueDate').value = ds;
    }
    if (parsed.priority) {
      chips += '<span class="nlp-chip" onclick="document.getElementById(\'todoPriority\').value=\'中\';this.remove()">' + (parsed.priority==='高'?'🔴':'⚪') + ' ' + parsed.priority + '</span>';
      document.getElementById('todoPriority').value = parsed.priority;
    }
    if (parsed.repeat) {
      chips += '<span class="nlp-chip" onclick="document.getElementById(\'todoRepeat\').value=\'无\';this.remove()">🔄 ' + parsed.repeat + '</span>';
      document.getElementById('todoRepeat').value = parsed.repeat;
    }
    parsed.tags.forEach(function(tag) {
      if (todoTags.indexOf(tag) < 0) { todoTags.push(tag); renderTagChips(); }
    });
    chipEl.innerHTML = chips;
    // AI fallback for fuzzy expressions
    if (parsed.needAI && typeof todoApi !== 'undefined') {
      var aiBody = { action: 'parse-todo', text: value };
      fetch(API_BASE + '/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (typeof getPin === 'function' ? getPin() : '') }, body: JSON.stringify(aiBody) })
        .then(function(r){ return r.json(); })
        .then(function(data) {
          if (data.dueDate) { var _d = new Date(data.dueDate + 'T00:00:00'); document.getElementById('todoDueDate').value = _d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0')+'-'+String(_d.getDate()).padStart(2,'0')+'T00:00'; }
          if (data.priority) { document.getElementById('todoPriority').value = data.priority; }
          if (data.repeat) { document.getElementById('todoRepeat').value = data.repeat; }
          if (data.tags) { data.tags.forEach(function(tag){ if (todoTags.indexOf(tag)<0) { todoTags.push(tag); renderTagChips(); } }); }
          // Update NLP chips
          var ce = document.getElementById('nlpChips'); if (ce) ce.innerHTML += '<span class="nlp-chip">🤖 AI解析</span>';
        })
        .catch(function(){})
    }
  }, 500);
}

// === Todo Notifications (Bug #8) ===
function checkTodoNotifications() {
  if (!todoList || !Array.isArray(todoList)) return;
  var now = Date.now();
  todoList.forEach(function(t) {
    if (t.status === '已完成' || t.status === '已取消' || t.status === '已删除') return;
    var style = todoNotifyStyle(t);
    // Check overdue
    if (t.dueDate) {
      var due = new Date(t.dueDate).getTime();
      if (due < now && !t._notifiedOverdue) {
        t._notifiedOverdue = true;
        if (style.isProject) {
          showTodoNotification('📁 项目待办已过期', (style.bodyPrefix ? style.bodyPrefix + ' · ' : '') + t.title);
        } else {
          showTodoNotification('⚠️ 待办已过期', t.title);
        }
      }
    }
    // Check reminders — 分钟数组逐档各触发一次（如 [20,10] → 14:40 与 14:50）
    if (t.dueDate) {
      try {
        var rems = [];
        if (t.reminders) {
          var _r0 = typeof t.reminders === 'string' ? JSON.parse(t.reminders) : t.reminders;
          if (Array.isArray(_r0)) rems = _r0.map(Number).filter(function(n){ return isFinite(n) && n > 0; });
        }
        if (!rems.length) {
          var _dd = new Date(t.dueDate);
          if (isFinite(_dd.getTime()) && (_dd.getHours() || _dd.getMinutes())) rems = [10, 20];
        }
        if (!Array.isArray(t._notifiedRems)) t._notifiedRems = [];
        if (rems.length) {
          var dueMs2 = new Date(t.dueDate).getTime();
          rems.forEach(function(min) {
            if (t._notifiedRems.indexOf(min) >= 0) return;
            var fire = dueMs2 - min * 60000;
            if (now >= fire && now < dueMs2 + 25 * 60000) {
              t._notifiedRems.push(min);
              var when = min >= 60 ? ('还有' + Math.round(min/60) + '小时') : ('还有' + min + '分钟');
              if (style.isProject) {
                showTodoNotification('📁 项目待办提醒', (style.bodyPrefix ? style.bodyPrefix + ' · ' : '') + t.title + ' · ' + when);
              } else {
                showTodoNotification('🔔 待办提醒', t.title + ' · ' + when);
              }
            }
          });
        }
      } catch(e) {}
    }
    // 每日固定时刻：页面开着时本地补一条（服务端 Web Push 是主通道）
    try {
      var _dts = [];
      var _dtRaw = t.dailyTimes || t.daily_times;
      if (_dtRaw) {
        var _dta = typeof _dtRaw === 'string' ? JSON.parse(_dtRaw) : _dtRaw;
        if (Array.isArray(_dta)) _dts = _dta.map(String);
      }
      if (_dts.length) {
        if (!t._notifiedDaily) t._notifiedDaily = { date: '', times: [] };
        var _now = new Date();
        var _today = _now.getFullYear() + '-' + String(_now.getMonth()+1).padStart(2,'0') + '-' + String(_now.getDate()).padStart(2,'0');
        if (t._notifiedDaily.date !== _today) t._notifiedDaily = { date: _today, times: [] };
        var _hh = String(_now.getHours()).padStart(2,'0');
        var _mm = String(_now.getMinutes()).padStart(2,'0');
        _dts.forEach(function(hhmm) {
          if (t._notifiedDaily.times.indexOf(hhmm) >= 0) return;
          var _p = hhmm.split(':');
          var _target = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate(), Number(_p[0]), Number(_p[1]), 0, 0).getTime();
          if (now >= _target && now < _target + 6 * 60000) {
            t._notifiedDaily.times.push(hhmm);
            if (style.isProject) {
              showTodoNotification('📁 项目 · 每日提醒', (style.bodyPrefix ? style.bodyPrefix + ' · ' : '') + t.title + ' · ' + hhmm);
            } else {
              showTodoNotification('⏰ 每日提醒', t.title + ' · ' + hhmm);
            }
          }
        });
      }
    } catch(e) {}
  });
}

function showTodoNotification(title, body) {
  try {
    if (Notification && Notification.permission === 'granted') {
      new Notification(title, { body: body, icon: 'icon-192.png' });
    }
  } catch(e) {}
  toast(title + ': ' + body);
}

function requestNotificationPermission() {
  try {
    if (Notification && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch(e) {}
}

// ===== iOS 待办弹层 helpers（v4.0.49）=====
function syncTodoPriSeg(){
  var s=document.getElementById('todoPriority');
  var bs=document.querySelectorAll('#tsPriSeg button');
  for(var i=0;i<bs.length;i++){
    bs[i].classList.toggle('on', !!(s && bs[i].getAttribute('data-v')===s.value));
  }
}
function setTodoPriority(v){
  var s=document.getElementById('todoPriority');
  if(s)s.value=v;
  syncTodoPriSeg();
}
(function(){
  var _open=openTodoModal;
  openTodoModal=function(id){
    _open.apply(this,arguments);
    try{
      var tt=document.getElementById('todoModalTitle');
      if(tt)tt.textContent=id?'编辑待办':'新建待办';
      setTimeout(function(){
        syncTodoPriSeg();
        try{renderReminderUI()}catch(e){}
      },0);
      var d=document.getElementById('todoDueDate');
      if(d&&!d._tsBound){d._tsBound=1;d.addEventListener('change',function(){try{renderReminderUI()}catch(e){}});}
    }catch(e){}
  };
})();
