// todo.js - Todo module

var TODO_API = '/api/todos';
var todoList = [];
var todoView = 'list';
var todoFilter = '全部';
var todoCalYear, todoCalMonth;
var todoCalSelected = null;

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
    if (todoFilter === '高优先级') filtered = todoList.filter(function(t){ return t.priority === '高' && t.status !== '已完成' && t.status !== '已取消'; });
    else filtered = todoList.filter(function(t){ return t.status === todoFilter; });
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
  var total=todoList.length, pending=0, doing=0, done=0, overdue=0;
  todoList.forEach(function(t){
    if(t.status==='待办') pending++;
    if(t.status==='进行中') doing++;
    if(t.status==='已完成') done++;
    if(t.dueDate&&getDueClass(t.dueDate,t.status)==='due-overdue') overdue++;
  });
  var pct = total > 0 ? Math.round(done / total * 100) : 0;

  var html = '';

  // === Compact header: segmented control + progress ===
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
  var chips = ['全部', '待办', '进行中', '已完成', '高优先级'];
  chips.forEach(function(c) {
    html += '<span class="chip' + (todoFilter===c ? ' active' : '') + '" onclick="switchTodoFilter(' + "'" + c + "'" + ')" style="padding:4px 10px;font-size:12px">' + c + '</span>';
  });
  html += '</div>';

  // Content based on view
  if (todoView === 'calendar') {
    html += buildCalendarHtml();
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

  var h = '<div class="todo-card ' + statusClass + '" onclick="openTodoDetail(' + "'" + t.id + "'" + ')">';
  h += '<div class="todo-card-accent" style="background:' + priColor + '"></div>';
  h += '<div class="todo-card-inner">';
  h += '<div class="todo-card-main">';

  // Checkbox (quick complete)
  if (isDone) {
    h += '<div class="todo-quick-check done" onclick="event.stopPropagation()">✅</div>';
  } else {
    h += '<div class="todo-quick-check" style="border-color:' + priColor + '" onclick="event.stopPropagation();completeTodo(' + "'" + t.id + "'" + ')"></div>';
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
  if (t.linkType && t.linkType !== '无') {
    var linkDisp = getLinkDisplay(t.linkType, t.linkId);
    if (linkDisp) h += '<div class="todo-link" onclick="event.stopPropagation();showLinkPreview(' + "'" + t.linkType + "'" + ',' + "'" + t.linkId + "'" + ')">' + linkDisp + ' ➡</div>';
  }

  h += '</div>'; // content

  // Priority dot (right side)
  h += '<div class="todo-pri-dot" style="background:' + priColor + '"></div>';

  h += '</div>'; // main
  h += '</div></div>'; // inner + card
  return h;
}

function buildGanttHtml() {
  

  // Use same month as calendar
  if (!todoCalYear) { var now = new Date(Date.now()+8*3600000); todoCalYear = now.getUTCFullYear(); todoCalMonth = now.getUTCMonth(); }

  var year = todoCalYear, month = todoCalMonth;
  var daysInMonth = new Date(year, month+1, 0).getDate();
  var today = new Date(Date.now()+8*3600000).toISOString().slice(0,10);

  // Get todos with due dates in this month
  var monthTodos = todoList.filter(function(t) {
    if (!t.dueDate) return false;
    var d = new Date(t.dueDate);
    return d.getUTCFullYear() === year && d.getUTCMonth() === month;
  }).sort(function(a,b) { return new Date(a.dueDate) - new Date(b.dueDate); });

  var html = '';

  // Month nav
  html += '<div class="gantt-nav">';
  html += '<button class="cal-nav-btn" onclick="todoCalPrev();renderTodoGantt()">←</button>';
  html += '<span class="cal-nav-title">' + year + '年' + (month+1) + '月</span>';
  html += '<button class="cal-nav-btn" onclick="todoCalNext();renderTodoGantt()">→</button>';
  html += '</div>';

  if (monthTodos.length === 0) {
    html += '<div style="text-align:center;padding:40px;color:var(--muted)">本月无待办</div>';
    return html;
    return;
  }

  // Gantt chart
  html += '<div class="gantt-container">';
  html += '<div class="gantt-scroll">';

  // Header row (days)
  html += '<div class="gantt-header">';
  html += '<div class="gantt-label-header">待办</div>';
  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday = dateStr === today;
    var isWeekend = new Date(year, month, d).getDay() === 0 || new Date(year, month, d).getDay() === 6;
    html += '<div class="gantt-day' + (isToday ? ' today' : '') + (isWeekend ? ' weekend' : '') + '">' + d + '</div>';
  }
  html += '</div>';

  // Rows
  monthTodos.forEach(function(t) {
    var dueDate = new Date(t.dueDate);
    var dueDay = dueDate.getUTCDate();
    var priColor = t.priority === '高' ? '#ef4444' : t.priority === '低' ? '#9ca3af' : '#f59e0b';
    var isDone = t.status === '已完成';

    html += '<div class="gantt-row" onclick="openTodoDetail(' + "'" + t.id + "'" + ')">';
    html += '<div class="gantt-label">' + esc(t.title.slice(0,10)) + (t.title.length>10?'..':'') + '</div>';
    for (var d = 1; d <= daysInMonth; d++) {
      var isDue = d === dueDay;
      html += '<div class="gantt-cell' + (isDue ? ' gantt-due' : '') + '">';
      if (isDue) html += '<div class="gantt-bar' + (isDone ? ' done' : '') + '" style="background:' + priColor + '"></div>';
      html += '</div>';
    }
    html += '</div>';
  });

  html += '</div></div>';
  return html;
}

function buildCalendarHtml() {
  
  if (!todoCalYear) {
    var now = new Date(Date.now() + 8*3600000);
    todoCalYear = now.getUTCFullYear();
    todoCalMonth = now.getUTCMonth();
  }

  var html = '';
  html += '<div class="cal-nav">';
  html += '<button class="cal-nav-btn" onclick="todoCalPrev()">◀</button>';
  html += '<span class="cal-nav-title">' + todoCalYear + '年' + (todoCalMonth+1) + '月</span>';
  html += '<button class="cal-nav-btn" onclick="todoCalNext()">▶</button>';
  html += '</div>';

  html += '<div class="cal-grid">';
  var weekDays = ['一','二','三','四','五','六','日'];
  weekDays.forEach(function(d) { html += '<div class="cal-header">' + d + '</div>'; });

  var firstDay = new Date(todoCalYear, todoCalMonth, 1).getDay();
  if (firstDay === 0) firstDay = 7;
  var daysInMonth = new Date(todoCalYear, todoCalMonth + 1, 0).getDate();
  var todayStr = new Date(Date.now() + 8*3600000).toISOString().slice(0,10);

  for (var i = 1; i < firstDay; i++) html += '<div class="cal-day empty"></div>';

  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = todoCalYear + '-' + String(todoCalMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday = dateStr === todayStr;
    var dayTodos = todoList.filter(function(t) {
      if (!t.dueDate) return false;
      var td = new Date(t.dueDate);
      var ts = td.getUTCFullYear() + '-' + String(td.getUTCMonth()+1).padStart(2,'0') + '-' + String(td.getUTCDate()).padStart(2,'0');
      return ts === dateStr;
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
      if (!t.dueDate) return false;
      var td = new Date(t.dueDate);
      var ts = td.getUTCFullYear() + '-' + String(td.getUTCMonth()+1).padStart(2,'0') + '-' + String(td.getUTCDate()).padStart(2,'0');
      return ts === todoCalSelected;
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
function selectTodoCalDay(dateStr) { todoCalSelected = todoCalSelected === dateStr ? null : dateStr; renderTodoCalendar(); }

function formatDueDate(dueDate) {
  if (!dueDate) return '';
  var d = new Date(dueDate);
  var now = new Date(Date.now() + 8*3600000);
  var ds = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
  var ns = now.toISOString().slice(0,10);
  if (ds === ns) return '今天';
  var tm = new Date(now.getTime() + 86400000);
  var ts = tm.toISOString().slice(0,10);
  if (ds === ts) return '明天';
  var diff = Math.floor((new Date(ds) - new Date(ns)) / 86400000);
  if (diff < 0) return '已过期 ' + Math.abs(diff) + '天';
  if (diff <= 7) return diff + '天后';
  return (d.getUTCMonth()+1) + '月' + d.getUTCDate() + '日';
}

function getDueClass(dueDate, status) {
  if (status === '已完成' || status === '已取消') return '';
  if (!dueDate) return '';
  var d = new Date(dueDate);
  var now = new Date(Date.now() + 8*3600000);
  var ds = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
  var ns = now.toISOString().slice(0,10);
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
  editingTodoId = id || null;
  var overlay = document.getElementById('todoModalOverlay');
  if (!overlay) return;

  var t = null;
  if (id) t = todoList.find(function(x){ return x.id === id; });

  document.getElementById('todoTitle').value = t ? t.title : '';
  document.getElementById('todoDesc').value = t ? t.description : '';
  document.getElementById('todoPriority').value = t ? t.priority : '中';
  document.getElementById('todoCategory').value = t ? t.category : '其他';
  document.getElementById('todoRepeat').value = t ? t.repeat : '无';
  document.getElementById('todoLinkType').value = t ? (t.linkType || '无') : '无';
  updateLinkOptions();
  document.getElementById('todoLinkId').value = t ? (t.linkId || '') : '';

  if (t && t.dueDate) {
    var d = new Date(t.dueDate);
    document.getElementById('todoDueDate').value = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
  } else {
    document.getElementById('todoDueDate').value = '';
  }

  // Subtasks
  todoSubtaskRows = [];
  if (t && t.subtasks && t.subtasks !== '[]') {
    try { todoSubtaskRows = JSON.parse(t.subtasks); } catch(e) {}
  }
  renderSubtaskRows();

  overlay.classList.add('active');
}

function closeTodoModal() {
  document.getElementById('todoModalOverlay').classList.remove('active');
  editingTodoId = null;
}

function renderSubtaskRows() {
  var el = document.getElementById('todoSubtaskList');
  if (!el) return;
  var html = '';
  todoSubtaskRows.forEach(function(s, i) {
    html += '<div class="subtask-row">';
    html += '<input type="text" class="subtask-input" value="' + esc(s.text || '') + '" onchange="updateSubtaskText(' + i + ', this.value)">' ;
    html += '<button class="subtask-del" onclick="removeSubtask(' + i + ')">✕</button>';
    html += '</div>';
  });
  el.innerHTML = html;
}

function addSubtask() { if (todoSubtaskRows.length >= 20) return; todoSubtaskRows.push({text: "", done: false}); renderSubtaskRows(); }
function removeSubtask(i) { todoSubtaskRows.splice(i, 1); renderSubtaskRows(); }
function updateSubtaskText(i, v) { if (todoSubtaskRows[i]) todoSubtaskRows[i].text = v; }

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
      linkId: document.getElementById('todoLinkId').value || '',
      subtasks: JSON.stringify(todoSubtaskRows.filter(function(s){ return s.text.trim(); }))
    };

    console.log('saveTodo: sending', JSON.stringify(body).substring(0,200));
    var r;
    if (editingTodoId) {
      body.id = editingTodoId;
      r = await todoApi('PUT', body);
    } else {
      r = await todoApi('POST', body);
    }
    console.log('saveTodo: response', JSON.stringify(r));

    if (!r) { toast('保存失败: 服务器无响应'); return; }
    if (r.error) { toast('保存失败: ' + (r.error || '') + (r.detail ? ' ' + JSON.stringify(r.detail).substring(0,100) : '')); return; }
    toast(editingTodoId ? '已更新' : '已创建');
    closeTodoModal();
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
    html += '<div class="detail-row"><span class="detail-label">完成时间</span><span class="detail-value">✅ ' + cd.toISOString().slice(0,10) + '</span></div>';
  }

  html += '</div>';

  html += '<div class="detail-actions">';
  if (t.status !== '已完成' && t.status !== '已取消') {
    html += '<button class="btn-action btn-complete" onclick="completeTodo(' + "'" + id + "'" + ')">✅ 完成</button>';
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

async function completeTodo(id) {
  var r = await todoApi('PUT', { id: id, status: '已完成' });
  if (r && r.error) { toast('操作失败: ' + r.error); return; }
  if (r.renewed) toast('✅ 已完成，已自动续期');
  else toast('✅ 已完成');
  closeTodoDetail();
  render();
}

async function deleteTodo(id) {
  if (!confirm('确定删除？')) return;
  var r = await todoApi('DELETE', null, id);
  if (r && r.error) { toast('删除失败: ' + r.error); return; }
  toast('已删除');
  closeTodoDetail();
  todoList = todoList.filter(function(t){ return t.id !== id; });
  render();
}

async function toggleTodoSubtask(todoId, index) {
  var t = todoList.find(function(x){ return x.id === todoId; });
  if (!t) return;
  try {
    var subs = JSON.parse(t.subtasks || '[]');
    if (subs[index]) subs[index].done = !subs[index].done;
    var newSubs = JSON.stringify(subs);
    t.subtasks = newSubs;
    await todoApi('PUT', { id: todoId, subtasks: newSubs });
  } catch(e) {}
  openTodoDetail(todoId);
}

function onTodoFab() { openTodoModal(); }



