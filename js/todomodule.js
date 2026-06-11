// todo.js - Todo module

var TODO_API = API_BASE + '/api/todos';
var todoList = [];
var todoView = 'list';
var todoFilter = '全部';
var todoCalYear, todoCalMonth;
var todoCalSelected = null;
var todoSearch = "";
var ganttExpanded = {};
var ganttViewMode = "week";
var ganttWeekOffset = 0;

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

  var now = Date.now();
  filtered.sort(function(a, b) {
    if (a.status === '已完成' && b.status !== '已完成') return 1;
    if (a.status !== '已完成' && b.status === '已完成') return -1;
    var da = a.dueDate ? new Date(a.dueDate).getTime() : 9999999999999;
    var db = b.dueDate ? new Date(b.dueDate).getTime() : 9999999999999;
    if (da !== db) return da - db;
    var pri = { '高': 0, '中': 1, '低': 2 };
    return (pri[a.priority] || 1) - (pri[b.priority] || 1);
  });

  // Stats
  var total=todoList.filter(function(t){return t.status!=='已删除'}).length, pending=0, doing=0, done=0, overdue=0;
  todoList.forEach(function(t){
    if(t.status==='待办') pending++;
    if(t.status==='进行中') doing++;
    if(t.status==='已完成') done++;
    if(t.dueDate&&getDueClass(t.dueDate,t.status)==='due-overdue') overdue++;
  });
  var activeTotal = pending + doing + done; var pct = activeTotal > 0 ? Math.round(done / activeTotal * 100) : 0;

  var html = '';

  // === Compact header: segmented control + progress ===
  // Search box
  html += '<div style="margin-bottom:10px"><input type="text" placeholder="搜索待办..." value="' + esc(todoSearch) + '" oninput="todoSearch=this.value;renderTodo()" style="width:100%;padding:10px 14px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;background:var(--card);color:var(--text);box-sizing:border-box"></div>';

  html += '<div class="todo-compact-header">';
  
  // View switcher (segmented control)
  html += '<div class="todo-view-switcher">';
  html += '<button class="todo-view-btn' + (todoView==='list'?' active':'') + '" onclick="switchTodoView(\x27list\x27)">📋 列表</button>';
  html += '<button class="todo-view-btn' + (todoView==='calendar'?' active':'') + '" onclick="switchTodoView(\x27calendar\x27)">📅 日历</button>';
  html += '<button class="todo-view-btn' + (todoView==='gantt'?' active':'') + '" onclick="switchTodoView(\x27gantt\x27)">📊 甘特图</button>';
  html += '</div>';

  // Stats row (compact)
  html += '<div class="todo-stats-row">';
  html += '<div class="todo-stat"><span class="todo-stat-num">' + total + '</span><span class="todo-stat-lbl">全部</span></div>';
  html += '<div class="todo-stat"><span class="todo-stat-num" style="color:#f59e0b">' + pending + '</span><span class="todo-stat-lbl">待办</span></div>';
  html += '<div class="todo-stat"><span class="todo-stat-num" style="color:var(--pri)">' + doing + '</span><span class="todo-stat-lbl">进行中</span></div>';
  if(overdue>0) html += '<div class="todo-stat"><span class="todo-stat-num" style="color:#ef4444">' + overdue + '</span><span class="todo-stat-lbl">过期</span></div>';
  html += '<div class="todo-stat" style="margin-left:auto"><span class="todo-stat-num" style="color:'+(pct>=80?'#16a34a':pct>=50?'var(--pri)':'#f59e0b')+';font-size:18px">' + pct + '%</span><span class="todo-stat-lbl">完成</span></div>';
  html += '</div>';

  // Progress bar
  html += '<div class="todo-mini-progress"><div class="todo-mini-fill" data-width="' + pct + '" style="width:0;background:'+(pct>=80?'#16a34a':pct>=50?'var(--pri)':'#f59e0b')+'"></div></div>';
  html += '</div>';

  // Filter chips (smaller)
  html += '<div class="chips-wrap" style="margin:8px 0 10px">';
  var chips = ['全部', '待办', '进行中', '已完成', '高优先级', '已取消', '回收站'];
  chips.forEach(function(c) {
    html += '<span class="chip' + (todoFilter===c ? ' active' : '') + '" onclick="switchTodoFilter(' + "'" + c + "'" + ')" style="padding:4px 10px;font-size:12px">' + c + '</span>';
  });
  html += '</div>';

  // Content based on view
  if (todoView === 'calendar') {
    html += buildCalendarHtml();
    console.log("renderSubtaskRows: rows=" + todoSubtaskRows.length + ", firstText=" + (todoSubtaskRows[0]||{}).text + ", html=" + html.substring(0,300));
  el.innerHTML = html;
    return;
  }
  if (todoView === 'gantt') {
    html += buildGanttHtml();
    el.innerHTML = html;
    return;
  }

  // List view
  if (filtered.length === 0) {
    html += '<div style="text-align:center;padding:60px 20px;color:var(--muted)">';
    html += '<div style="font-size:56px;margin-bottom:16px;opacity:0.6">📋</div>';
    html += '<div style="font-size:16px;font-weight:700;margin-bottom:6px">暂无待办</div>';
    html += '<div style="font-size:13px;opacity:0.7">点击右下角 + 新建</div>';
    html += '</div>';
  } else {
    var active = filtered.filter(function(t){ return t.status !== '已完成' && t.status !== '已取消'; });
    var completed = filtered.filter(function(t){ return t.status === '已完成' || t.status === '已取消'; });
    if (active.length > 0) {
      active.forEach(function(t) { html += renderTodoCard(t); });
    }
    if (completed.length > 0) {
      html += '<div class="todo-section-title">✅ 已完成 <span class="todo-section-count">'+completed.length+'</span></div>';
      completed.forEach(function(t) { html += renderTodoCard(t); });
    }
  }

  el.innerHTML = html;

  // Animate progress bar
  setTimeout(function() {
    document.querySelectorAll('.todo-mini-fill[data-width]').forEach(function(el) {
      el.style.width = el.getAttribute('data-width') + '%';
    });
  }, 50);

  // Init SortableJS drag sort
  if (typeof Sortable !== 'undefined' && todoView === 'list' && todoFilter !== '回收站') {
    var container = el.querySelector('.todo-list-container');
    if (container) {
      Sortable.create(container, {
        animation: 200,
        ghostClass: 'todo-drag-ghost',
        handle: '.todo-card',
        onEnd: function(evt) {
          var cards = container.querySelectorAll('.todo-card');
          var order = 0;
          cards.forEach(function(card) {
            var id = card.getAttribute('data-id');
            var t = todoList.find(function(x){ return x.id === id; });
            if (t) { t.order = order; todoApi('PUT', { id: id, order: order }); order++; }
          });
        }
      });
    }
  }
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
  var priColor = t.priority === '高' ? '#ef4444' : t.priority === '低' ? '#9ca3af' : '#f59e0b';
  var catIcon = { '采购': '🛒', '记账': '💰', '生活': '🏠', '工作': '💼', '健康': '🏥', '其他': '📌' };
  var isDone = t.status === '已完成' || t.status === '已取消';
  var statusClass = t.status === '已完成' ? 'todo-done' : t.status === '已取消' ? 'todo-cancelled' : '';

  var h = '<div class="todo-card ' + statusClass + '" data-id="' + t.id + '" onclick="openTodoDetail(' + "'" + t.id + "'" + ')">';
  h += '<div class="todo-card-accent" style="background:' + priColor + '"></div>';
  h += '<div class="todo-card-inner">';
  h += '<div class="todo-card-main">';

  // Checkbox (quick complete)
  if (isDone) {
    h += '<div class="todo-quick-check done" onclick="event.stopPropagation();cycleTodoStatus(' + "'" + t.id + "'" + ')">✅</div>';
  } else {
    h += '<div class="todo-quick-check" style="border-color:' + priColor + '" onclick="event.stopPropagation();cycleTodoStatus(' + "'" + t.id + "'" + ')"></div>';
  }

  // Content
  h += '<div class="todo-card-content">';
  h += '<div class="todo-card-title' + (isDone ? ' strikethrough' : '') + '">' + esc(t.title) + '</div>';

  // Due date line
  if (t.dueDate) {
    var dueStr = formatDueDate(t.dueDate);
    var dueClass = getDueClass(t.dueDate, t.status);
    h += '<div class="todo-due ' + dueClass + '">📅 ' + dueStr + '</div>';
  }

  // Tags row
  h += '<div class="todo-card-tags">';
  h += '<span class="todo-tag status-' + t.status + '">' + t.status + '</span>';
  h += '<span class="todo-tag cat">' + (catIcon[t.category]||'📌') + t.category + '</span>';
  if (t.repeat && t.repeat !== '无') h += '<span class="todo-tag repeat">🔄 ' + t.repeat + '</span>';
    try {
      var tags = JSON.parse(t.tags || '[]');
      tags.forEach(function(tag) {
        var tagColor = stringHashColor(tag);
        h += '<span class="todo-tag" style="background:' + tagColor.bg + ';color:' + tagColor.text + ';font-size:10px">' + esc(tag) + '</span>';
      });
    } catch(e) {}
  h += '</div>';

  // Subtask progress
  if (t.subtasks && t.subtasks !== '[]') {
    try {
      var subs = JSON.parse(t.subtasks);
      var doneCount = subs.filter(function(s){ return s.done; }).length;
      var subPct = subs.length ? Math.round(doneCount/subs.length*100) : 0;
      h += '<div class="todo-sub-progress"><div class="todo-sub-bar"><div class="todo-sub-fill" style="width:' + subPct + '%;background:' + (subPct>=100?'#16a34a':'var(--pri)') + '"></div></div><span class="todo-sub-text">' + doneCount + '/' + subs.length + '</span></div>';
    } catch(e) {}
  }

  // Link
  // Project link
  if (t.projectId && typeof projectList !== 'undefined') {
    var proj = projectList.find(function(p){ return p.id === t.projectId; });
    if (proj) {
      h += '<div class="detail-row"><span class="detail-label">📁 项目</span><span class="detail-value" style="cursor:pointer;color:var(--pri)" onclick="closeTodoDetail();openProjectDetail(\x27' + t.projectId + '\x27)">' + esc(proj.name) + ' ➤</span></div>';
    }
  }
  if (t.linkType && t.linkType !== '无') {
    var linkDisp = getLinkDisplay(t.linkType, t.linkId);
    if (linkDisp) h += '<div class="todo-link" onclick="event.stopPropagation();showLinkPreview(' + "'" + t.linkType + "'" + ',' + "'" + t.linkId + "'" + ')">' + linkDisp + ' ➡</div>';
  }

  h += '</div>'; // content

  // Priority dot (right side)
  h += '<div class="todo-pri-dot" style="background:' + priColor + '"></div>';

  h += '</div>'; // main
  // Recycle bin actions
  if (t.status === '已删除') {
    h += '<div style="display:flex;gap:8px;padding:8px 18px 12px;border-top:1px solid var(--border)">';
    h += '<button onclick="event.stopPropagation();restoreTodo(\x27' + t.id + '\x27)" style="flex:1;padding:6px;border:1px solid var(--pri);color:var(--pri);border-radius:8px;background:transparent;cursor:pointer;font-size:12px">↩ 恢复</button>';
    h += '<button onclick="event.stopPropagation();purgeTodo(\x27' + t.id + '\x27)" style="flex:1;padding:6px;border:1px solid #ef4444;color:#ef4444;border-radius:8px;background:transparent;cursor:pointer;font-size:12px">🗑️ 彻底删除</button>';
    h += '</div>';
  }
  h += '</div></div>'; // inner + card
  return h;
}

﻿function buildGanttHtml() {
  var now = new Date();
  var todayStr = localDateStr(now);
  var html = '';

  html += '<div class="gantt-wrapper">';
  html += '<div class="gantt-toolbar">';
  html += '<div style="display:flex;align-items:center;gap:8px">';
  html += '<button class="cal-nav-btn" onclick="ganttNav(-1)">&#8592;</button>';
  
  if (ganttViewMode === 'week') {
    var weekStart = getGanttWeekStart();
    var weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    var ws = (weekStart.getMonth()+1)+'/'+weekStart.getDate();
    var we = (weekEnd.getMonth()+1)+'/'+weekEnd.getDate();
    html += '<span class="cal-nav-title" style="font-size:14px;font-weight:700">' + weekStart.getFullYear() + '\u5e74 ' + ws + ' - ' + we + '</span>';
  } else {
    if (!todoCalYear) { todoCalYear = now.getFullYear(); todoCalMonth = now.getMonth(); }
    html += '<span class="cal-nav-title" style="font-size:14px;font-weight:700">' + todoCalYear + '\u5e74' + (todoCalMonth+1) + '\u6708</span>';
  }
  
  html += '<button class="cal-nav-btn" onclick="ganttNav(1)">&#8594;</button>';
  html += '<button class="cal-nav-btn" onclick="ganttNav(0)" style="font-size:11px;padding:3px 8px">\u4eca\u5929</button>';
  html += '</div>';
  html += '<div class="gantt-view-switcher">';
  html += '<button class="gantt-view-btn' + (ganttViewMode==='week'?' active':'') + '" onclick="switchGanttView(\'week\')">\u5468</button>';
  html += '<button class="gantt-view-btn' + (ganttViewMode==='month'?' active':'') + '" onclick="switchGanttView(\'month\')">\u6708</button>';
  html += '</div>';
  html += '</div>';

  if (ganttViewMode === 'week') { html += buildGanttWeekView(); }
  else { html += buildGanttMonthView(); }

  html += '</div>';
  return html;
}

function getGanttWeekStart() {
  var now = new Date();
  var day = now.getDay();
  var diff = day === 0 ? 6 : day - 1;
  var monday = new Date(now);
  monday.setDate(now.getDate() - diff + ganttWeekOffset * 7);
  monday.setHours(0,0,0,0);
  return monday;
}

function ganttNav(dir) {
  if (dir === 0) {
    ganttWeekOffset = 0;
    todoCalYear = null; todoCalMonth = null;
  } else if (ganttViewMode === 'week') {
    ganttWeekOffset += dir;
  } else {
    if (!todoCalYear) { var n = new Date(); todoCalYear = n.getFullYear(); todoCalMonth = n.getMonth(); }
    todoCalMonth += dir;
    if (todoCalMonth > 11) { todoCalMonth = 0; todoCalYear++; }
    if (todoCalMonth < 0) { todoCalMonth = 11; todoCalYear--; }
  }
  renderTodo();
}

function switchGanttView(mode) {
  ganttViewMode = mode;
  renderTodo();
}

function toggleGanttExpand(id) {
  ganttExpanded[id] = !ganttExpanded[id];
  renderTodo();
}

function buildGanttWeekView() {
  var weekStart = getGanttWeekStart();
  var today = new Date();
  var todayStr = localDateStr(today);
  var dayNames = ['\u4e00','\u4e8c','\u4e09','\u56db','\u4e94','\u516d','\u65e5'];
  var weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  
  var weekTodos = todoList.filter(function(t) {
    if (!t.dueDate) return false;
    var d = new Date(t.dueDate);
    return d >= weekStart && d < weekEnd;
  }).sort(function(a,b) { return new Date(a.dueDate) - new Date(b.dueDate); });
  
  var noDueTodos = todoList.filter(function(t) { return !t.dueDate && t.status !== '\u5df2\u5b8c\u6210' && t.status !== '\u5df2\u53d6\u6d88'; });
  var html = '<div class="gantt-container">';
  html += '<div class="gantt-scroll">';
  
  html += '<div class="gantt-header">';
  html += '<div class="gantt-label-header">\u5f85\u529e</div>';
  for (var i = 0; i < 7; i++) {
    var d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    var dateStr = localDateStr(d);
    var isToday = dateStr === todayStr;
    var isWeekend = i >= 5;
    html += '<div class="gantt-day' + (isToday ? ' today gantt-today-col' : '') + (isWeekend ? ' weekend' : '') + '">';
    html += '<div class="gantt-day-name">' + dayNames[i] + '</div>';
    html += '<div class="gantt-day-num">' + d.getDate() + '</div>';
    html += '</div>';
  }
  // Now line position
  var nowDate = new Date();
  var nowDayIdx = (nowDate.getDay() === 0 ? 6 : nowDate.getDay() - 1);
  var nowHourPct = (nowDate.getHours() + nowDate.getMinutes()/60) / 24 * 100;
  var nowLeftPct = (nowDayIdx / 7 * 100) + (nowHourPct / 7);
  
  html += '</div>';
  html += '<div class="gantt-now-line" style="left:calc(80px + ' + nowLeftPct + '% * (1 - 80px/100%))"><div class="gantt-now-dot"></div></div>';
  
  var allTodos = weekTodos.concat(noDueTodos);
  if (allTodos.length === 0) {
    html += '<div style="text-align:center;padding:40px;color:var(--muted)">\u672c\u5468\u65e0\u5f85\u529e</div>';
  }
  
  allTodos.forEach(function(t) {
    var priColor = t.priority === '\u9ad8' ? '#ef4444' : t.priority === '\u4f4e' ? '#9ca3af' : '#f59e0b';
    var isDone = t.status === '\u5df2\u5b8c\u6210' || t.status === '\u5df2\u53d6\u6d88';
    var dueDate = t.dueDate ? new Date(t.dueDate) : null;
    var dueHour = dueDate ? dueDate.getHours() : -1;
    var dueMin = dueDate ? dueDate.getMinutes() : 0;
    var subs = [];
    try { subs = JSON.parse(t.subtasks || '[]'); } catch(e) {}
    var hasSubs = subs.length > 0;
    
    html += '<div class="gantt-row-wrap' + (isDone ? ' gantt-row-done' : '') + '">';
    html += '<div class="gantt-row" onclick="openTodoDetail(\'' + t.id + '\')">';
    html += '<div class="gantt-label">';
    if (hasSubs) {
      html += '<span class="gantt-expand" onclick="event.stopPropagation();toggleGanttExpand(\'' + t.id + '\')">' + (ganttExpanded[t.id] ? '\u25bc' : '\u25b6') + '</span>';
    }
    html += '<span class="gantt-label-text" style="' + (isDone ? 'text-decoration:line-through;opacity:.5' : '') + '">' + esc(t.title.slice(0,12)) + (t.title.length>12?'..':'') + '</span>';
    html += '</div>';
    
    for (var i = 0; i < 7; i++) {
      var d = new Date(weekStart); d.setDate(d.getDate() + i);
      var dateStr = localDateStr(d);
      var isDueDay = dueDate && localDateStr(dueDate) === dateStr;
      var isTodayCol = dateStr === todayStr;
      html += '<div class="gantt-cell' + (isTodayCol ? ' gantt-today-col' : '') + '">';
      if (isDueDay) {
        var barStyle = 'background:' + priColor + ';';
        if (dueHour > 0) {
          var leftPct = Math.round(dueHour / 24 * 100);
          var widthPct = Math.max(8, Math.round((24 - dueHour) / 24 * 50));
          barStyle += 'margin-left:' + leftPct + '%;width:' + widthPct + '%;';
        }
        html += '<div class="gantt-bar' + (isDone ? ' done' : '') + '" style="' + barStyle + '">';
        if (dueHour > 0) {
          html += '<span class="gantt-bar-time">' + String(dueHour).padStart(2,'0') + ':' + String(dueMin).padStart(2,'0') + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    
    if (hasSubs && ganttExpanded[t.id]) {
      subs.forEach(function(sub) {
        var subColor = sub.priority === '\u9ad8' ? '#ef4444' : sub.priority === '\u4f4e' ? '#9ca3af' : '#f59e0b';
        html += '<div class="gantt-sub-row">';
        html += '<div class="gantt-label gantt-sub-label">';
        html += '<span class="gantt-sub-check">' + (sub.done ? '\u2611' : '\u2610') + '</span> ';
        html += '<span style="' + (sub.done ? 'text-decoration:line-through;opacity:.6' : '') + ';font-size:11px">' + esc((sub.text||'').slice(0,10)) + '</span>';
        html += '</div>';
        for (var i = 0; i < 7; i++) {
          var d2 = new Date(weekStart); d2.setDate(d2.getDate() + i);
          html += '<div class="gantt-sub-cell gantt-cell">';
          if (dueDate && localDateStr(dueDate) === localDateStr(d2)) {
            html += '<div style="width:60%;height:10px;border-radius:3px;background:' + subColor + ';opacity:' + (sub.done ? '.3' : '.6') + '"></div>';
          }
          html += '</div>';
        }
        html += '</div>';
      });
    }
    html += '</div>';
  });
  
  html += '</div></div>';
  return html;
}

function buildGanttMonthView() {
  if (!todoCalYear) { var now = new Date(); todoCalYear = now.getFullYear(); todoCalMonth = now.getMonth(); }
  var year = todoCalYear, month = todoCalMonth;
  var daysInMonth = new Date(year, month+1, 0).getDate();
  var today = localDateStr(new Date());
  
  var monthTodos = todoList.filter(function(t) {
    if (!t.dueDate) return false;
    var d = new Date(t.dueDate);
    return d.getFullYear() === year && d.getMonth() === month;
  }).sort(function(a,b) { return new Date(a.dueDate) - new Date(b.dueDate); });
  
  var noDueTodos = todoList.filter(function(t) { return !t.dueDate && t.status !== '\u5df2\u5b8c\u6210' && t.status !== '\u5df2\u53d6\u6d88'; });
  var allTodos = monthTodos.concat(noDueTodos);
  
  var html = '<div class="gantt-container">';
  html += '<div class="gantt-scroll">';
  
  html += '<div class="gantt-header">';
  html += '<div class="gantt-label-header">\u5f85\u529e</div>';
  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday = dateStr === today;
    var dow = new Date(year, month, d).getDay();
    var isWeekend = dow === 0 || dow === 6;
    html += '<div class="gantt-day' + (isToday ? ' today gantt-today-col' : '') + (isWeekend ? ' weekend' : '') + '">' + d + '</div>';
  }
  html += '</div>';
  
  if (allTodos.length === 0) {
    html += '<div style="text-align:center;padding:40px;color:var(--muted)">\u672c\u6708\u65e0\u5f85\u529e</div>';
    html += '</div></div>';
    return html;
  }
  
  allTodos.forEach(function(t) {
    var dueDate = t.dueDate ? new Date(t.dueDate) : null;
    var dueDay = dueDate ? dueDate.getDate() : -1;
    var dueHour = dueDate ? dueDate.getHours() : -1;
    var priColor = t.priority === '\u9ad8' ? '#ef4444' : t.priority === '\u4f4e' ? '#9ca3af' : '#f59e0b';
    var isDone = t.status === '\u5df2\u5b8c\u6210' || t.status === '\u5df2\u53d6\u6d88';
    var subs = [];
    try { subs = JSON.parse(t.subtasks || '[]'); } catch(e) {}
    var hasSubs = subs.length > 0;
    
    html += '<div class="gantt-row-wrap' + (isDone ? ' gantt-row-done' : '') + '">';
    html += '<div class="gantt-row" onclick="openTodoDetail(\'' + t.id + '\')">';
    html += '<div class="gantt-label">';
    if (hasSubs) {
      html += '<span class="gantt-expand" onclick="event.stopPropagation();toggleGanttExpand(\'' + t.id + '\')">' + (ganttExpanded[t.id] ? '\u25bc' : '\u25b6') + '</span>';
    }
    html += '<span class="gantt-label-text">' + esc(t.title.slice(0,10)) + (t.title.length>10?'..':'') + '</span>';
    html += '</div>';
    for (var d = 1; d <= daysInMonth; d++) {
      var isDue = d === dueDay;
      html += '<div class="gantt-cell' + (isDue ? ' gantt-due' : '') + '">';
      if (isDue) {
        html += '<div class="gantt-bar' + (isDone ? ' done' : '') + '" style="background:' + priColor + '">';
        if (dueHour > 0) html += '<span class="gantt-bar-time">' + String(dueHour).padStart(2,'0') + ':00</span>';
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    
    if (hasSubs && ganttExpanded[t.id]) {
      subs.forEach(function(sub) {
        var subColor = sub.priority === '\u9ad8' ? '#ef4444' : sub.priority === '\u4f4e' ? '#9ca3af' : '#f59e0b';
        html += '<div class="gantt-sub-row">';
        html += '<div class="gantt-label gantt-sub-label">';
        html += '<span class="gantt-sub-check">' + (sub.done ? '\u2611' : '\u2610') + '</span> ';
        html += '<span style="' + (sub.done ? 'text-decoration:line-through;opacity:.6' : '') + ';font-size:11px">' + esc((sub.text||'').slice(0,10)) + '</span>';
        html += '</div>';
        for (var d = 1; d <= daysInMonth; d++) {
          html += '<div class="gantt-sub-cell gantt-cell">';
          if (d === dueDay) {
            html += '<div style="width:60%;height:10px;border-radius:3px;background:' + subColor + ';opacity:' + (sub.done ? '.3' : '.6') + '"></div>';
          }
          html += '</div>';
        }
        html += '</div>';
      });
    }
    html += '</div>';
  });
  
  html += '</div></div>';
  return html;
}


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
    try { var subs = JSON.parse(t.subtasks || '[]'); if (subs.some(function(s){ return s.dueDate && localDateStr(new Date(s.dueDate)) === dateStr; })) return true; } catch(e) {}
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
    if (t.dueDate && localDateStr(dueDate) === dateStr) return true;
    try { var subs = JSON.parse(t.subtasks || '[]'); if (subs.some(function(s){ return s.dueDate && localDateStr(new Date(s.dueDate)) === dateStr; })) return true; } catch(e) {}
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
    editingTodoId = id || null;
    var overlay = document.getElementById("todoModalOverlay");
    if (!overlay) { console.log("ERROR: todoModalOverlay not found"); return; }
    var t = null;
    if (id) {
      t = todoList.find(function(x){ return x.id === id; });
      console.log("Found todo: " + (t ? "YES, title=" + t.title + ", subtasks=" + (t.subtasks||"").substring(0,100) : "NOT FOUND, todoList.length=" + todoList.length));
    }
    document.getElementById("todoTitle").value = t ? t.title : "";
    document.getElementById("todoDesc").value = t ? t.description : "";
    document.getElementById("todoPriority").value = t ? t.priority : "\u4e2d";
    document.getElementById("todoCategory").value = t ? t.category : "\u5176\u4ed6";
    document.getElementById("todoRepeat").value = t ? t.repeat : "\u65e0";
    document.getElementById("todoLinkType").value = t ? (t.linkType || "\u65e0") : "\u65e0";
    updateLinkOptions();
    document.getElementById("todoLinkId").value = t ? (t.linkId || "") : "";
    var projSel = document.getElementById("todoProjectId");
    if (projSel && typeof getProjectOptions === "function") {
      projSel.innerHTML = getProjectOptions();
      projSel.value = t ? (t.projectId || "") : "";
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
          todoSubtaskRows = parsed.map(function(s){ return {text:s.text||"",done:!!s.done,priority:s.priority||"\u4e2d"}; });
          console.log("Loaded " + todoSubtaskRows.length + " subtask rows");
        }
      } catch(e) { console.log("Subtask parse error: " + e.message + ", raw=" + (t.subtasks||"").substring(0,100)); }
    }
    renderSubtaskRows();
    var _subEl = document.getElementById("todoSubtaskList");
    console.log("AFTER renderSubtaskRows: el=" + !!_subEl + ", html=" + (_subEl ? _subEl.innerHTML.length : "null") + ", rows=" + todoSubtaskRows.length + ", firstText=" + ((todoSubtaskRows[0]||{}).text||"EMPTY"));
    overlay.classList.add("active");
    console.log("openTodoModal: form populated, title=" + document.getElementById("todoTitle").value);
  } catch(e) {
    console.error("openTodoModal ERROR: " + e.message + " at " + e.stack);
    toast("\u6253\u5f00\u5931\u8d25: " + e.message);
  }
}

function closeTodoModal() {
  document.getElementById("todoModalOverlay").classList.remove("active");console.log("TODO_MODAL: closed");
  editingTodoId = null;
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

    var body = {
      title: title,
      description: document.getElementById('todoDesc').value.trim(),
      dueDate: document.getElementById('todoDueDate').value || null,
      priority: document.getElementById('todoPriority').value,
      category: document.getElementById('todoCategory').value,
      repeat: document.getElementById('todoRepeat').value,
      linkType: document.getElementById('todoLinkType').value,
      projectId: (document.getElementById('todoProjectId')||{}).value || '',
      linkId: document.getElementById('todoLinkId').value || '',
      subtasks: JSON.stringify(todoSubtaskRows.filter(function(s){ return s.text.trim(); })),
      tags: JSON.stringify(todoTags),
      reminders: JSON.stringify(todoReminders)
    };

    console.log('saveTodo: sending', JSON.stringify(body).substring(0,200));
    var r;
    var _editId = editingTodoId;
    // Optimistic: close modal and render first
    if (_editId) {
      var _ti = todoList.findIndex(function(t){return t.id===_editId});
      if (_ti >= 0) { todoList[_ti].title = body.title; todoList[_ti].description = body.description; todoList[_ti].dueDate = body.dueDate; todoList[_ti].priority = body.priority; todoList[_ti].category = body.category; todoList[_ti].repeat = body.repeat; todoList[_ti].subtasks = body.subtasks; todoList[_ti].linkType = body.linkType; todoList[_ti].linkId = body.linkId; }
    }
    closeTodoModal();
    render();
    if (_editId) {
      body.id = _editId;
      r = await todoApi('PUT', body);
    } else {
      var _tmpTodo = {id:'tmpT_'+Date.now(),title:body.title,description:body.description,dueDate:body.dueDate,priority:body.priority,category:body.category,status:'待办',repeat:body.repeat,linkType:body.linkType,linkId:body.linkId,subtasks:body.subtasks,completedAt:null};
      todoList.unshift(_tmpTodo);
      render();
      r = await todoApi('POST', body);
      if (r && r.id) _tmpTodo.id = r.id;
    }
    console.log('saveTodo: response', JSON.stringify(r));

    if (!r) { toast('保存失败: 服务器无响应'); return; }
    if (r.error) { toast('保存失败: ' + (r.error || '') + (r.detail ? ' ' + JSON.stringify(r.detail).substring(0,100) : '')); todoList=todoList.filter(function(t){return t.id!==_tmpTodo.id}); render(); return; }
    toast(_editId ? '已更新' : '已创建');
    render();
  } catch(e) {
    console.error('saveTodo error:', e);
    toast('保存失败: ' + e.message);
  }
}

function openTodoDetail(id) {
  var t = todoList.find(function(x){ return x.id === id; });
  if (!t) return;
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
  html += '<div class="detail-row"><span class="detail-label">分类</span><span class="detail-value">' + (catIcon[t.category]||'📌') + ' ' + t.category + '</span></div>';
  if (t.dueDate) html += '<div class="detail-row"><span class="detail-label">截止日期</span><span class="detail-value ' + getDueClass(t.dueDate, t.status) + '">📅 ' + formatDueDate(t.dueDate) + '</span></div>';
  if (t.repeat && t.repeat !== '无') html += '<div class="detail-row"><span class="detail-label">重复</span><span class="detail-value">🔄 ' + t.repeat + '</span></div>';

  if (t.description) html += '<div class="detail-desc">' + esc(t.description) + '</div>';

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

function cycleTodoStatus(id) {
  var t = todoList.find(function(x){ return x.id === id; });
  if (!t) return;
  var oldStatus = t.status;
  var nextStatus = oldStatus === '待办' ? '进行中' : oldStatus === '进行中' ? '已完成' : '待办';
  var completedAt = nextStatus === '已完成' ? Date.now() : null;
  t.status = nextStatus;
  if (completedAt) t.completedAt = completedAt;
  render();
  var detailOverlay = document.getElementById('todoDetailOverlay');
  if (detailOverlay && detailOverlay.classList.contains('active')) openTodoDetail(id);
  (async function() {
    try {
      var r = await todoApi('PUT', { id: id, status: nextStatus, completedAt: completedAt });
      if (r && r.error) { toast('操作失败: ' + r.error); t.status = oldStatus; render(); return; }
      if (r.renewed) { toast('✅ 已完成，已自动创建下一期'); loadTodos().then(function(){renderTodo();}); }
      else toast(nextStatus === '已完成' ? '✅ 已完成' : nextStatus === '进行中' ? '▶ 进行中' : '↩ 已恢复待办');
      if (t.projectId) checkProjectAutoStatus(t.projectId);
      if (nextStatus === '已完成' || nextStatus === '已取消') cancelLocalNotification(t);
      else if (t.reminders) scheduleLocalNotification(t);
    } catch(e) { t.status = oldStatus; render(); toast('操作失败: ' + e.message); }
  })();
}

async function deleteTodo(id) {
  if (!confirm('确定删除？')) return;
  closeTodoDetail();
  var t = todoList.find(function(x){ return x.id === id; });
  var oldStatus = t ? t.status : null;
  if (t) { t.status = '已删除'; }
  render();
  var r = await todoApi('DELETE', null, id);
  if (r && r.error) { toast('删除失败: ' + r.error); if(t) t.status = oldStatus; render(); return; }
  toast('已移入回收站');
}
async function toggleTodoSubtask(todoId, index) {
  var t = todoList.find(function(x){ return x.id === todoId; });
  if (!t) return;
  try {
    var subs = JSON.parse(t.subtasks || '[]');
    if (subs[index]) subs[index].done = !subs[index].done;
    var newSubs = JSON.stringify(subs);
    t.subtasks = newSubs;
    render();
    await todoApi('PUT', { id: todoId, subtasks: newSubs });
    // Auto status: all done -> complete, undo -> back to doing
    var allDone = subs.length > 0 && subs.every(function(s){ return s.done; });
    var anyUndone = subs.some(function(s){ return !s.done; });
    if (allDone && t.status !== '已完成') {
      cycleTodoStatus(todoId);
    } else if (anyUndone && t.status === '已完成') {
      t.status = '进行中';
      render();
      await todoApi('PUT', { id: todoId, status: '进行中' });
    }
    // Refresh detail if open
    var detailOverlay = document.getElementById('todoDetailOverlay');
    if (detailOverlay && detailOverlay.classList.contains('active')) openTodoDetail(todoId);
  } catch(e) {}
}
// Project auto-status check
function checkProjectAutoStatus(projectId) {
  if (!projectId || typeof projectList === 'undefined') return;
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
  var html = '';
  var options = [{v:'10',l:'提前10分钟'},{v:'30',l:'提前30分钟'},{v:'60',l:'提前1小时'},{v:'1440',l:'提前1天'}];
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
  el.innerHTML = html;
}

function scheduleLocalNotification(todo) {
  if (!todo.dueDate || !todo.reminders) return;
  if (typeof Capacitor === 'undefined' || !Capacitor.Plugins || !Capacitor.Plugins.LocalNotifications) return;
  try {
    var reminders = JSON.parse(todo.reminders || '[]');
    var dueTime = new Date(todo.dueDate).getTime();
    var ids = [];
    reminders.forEach(function(minutesBefore, i) {
      var fireTime = dueTime - minutesBefore * 60000;
      if (fireTime > Date.now()) {
        var notifId = parseInt(todo.id.replace(/\D/g,'').slice(-8)) * 10 + i;
        ids.push(notifId);
        Capacitor.Plugins.LocalNotifications.schedule({ notifications: [{
          id: notifId,
          title: '\ud83d\udcc5 ' + todo.title,
          body: minutesBefore >= 60 ? '\u8fd8有' + Math.round(minutesBefore/60) + '\u5c0f\u65f6\u5230\u622a\u6b62\u65e5\u671f' : '\u8fd8\u6709' + minutesBefore + '\u5206\u949f\u5230\u622a\u6b62\u65e5\u671f',
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
  var timeMatch = text.match(/(上午|下午|晚上)?(d{1,2})[点时:](d{1,2})?[分钟]?/);
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
          if (data.dueDate) { document.getElementById('todoDueDate').value = data.dueDate.slice(0,16); }
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
