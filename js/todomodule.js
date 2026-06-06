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
  var todayStr = new Date(now + 8*3600000).toISOString().slice(0,10);
  filtered.sort(function(a, b) {
    if (a.status === '已完成' && b.status !== '已完成') return 1;
    if (a.status !== '已完成' && b.status === '已完成') return -1;
    var da = a.dueDate ? new Date(a.dueDate).getTime() : 9999999999999;
    var db = b.dueDate ? new Date(b.dueDate).getTime() : 9999999999999;
    if (da !== db) return da - db;
    var pri = { '高': 0, '中': 1, '低': 2 };
    return (pri[a.priority] || 1) - (pri[b.priority] || 1);
  });

  var html = '<div class="chips-wrap">';
  var chips = ['全部', '待办', '进行中', '已完成', '高优先级'];
  chips.forEach(function(c) {
    html += '<span class="chip' + (todoFilter===c ? ' active' : '') + '" onclick="switchTodoFilter(' + "'" + c + "'" + ')">' + c + '</span>';
  });
  html += '</div>';

  // Summary bar
  var total=todoList.length;
  var pending=todoList.filter(function(t){return t.status==='待办'}).length;
  var doing=todoList.filter(function(t){return t.status==='进行中'}).length;
  var done=todoList.filter(function(t){return t.status==='已完成'}).length;
  var overdue=todoList.filter(function(t){return t.dueDate&&getDueClass(t.dueDate,t.status)==='due-overdue'}).length;
  html += '<div class="todo-summary">';
  html += '<div class="todo-summary-item"><div class="todo-summary-num pri">'+total+'</div><div class="todo-summary-label">全部</div></div>';
  html += '<div class="todo-summary-item"><div class="todo-summary-num orange">'+pending+'</div><div class="todo-summary-label">待办</div></div>';
  html += '<div class="todo-summary-item"><div class="todo-summary-num green">'+doing+'</div><div class="todo-summary-label">进行中</div></div>';
  if(overdue>0) html += '<div class="todo-summary-item"><div class="todo-summary-num red">'+overdue+'</div><div class="todo-summary-label">已过期</div></div>';
  // Progress bar
  var completionPct = total > 0 ? Math.round(done / total * 100) : 0;
  var activeCount = pending + doing;
  var progressColor = completionPct >= 80 ? 'done' : completionPct >= 50 ? '' : 'warn';

  html += '<div class="todo-progress-wrap">';
  html += '<div class="todo-progress-header">';
  html += '<span class="todo-progress-label">完成进度</span>';
  html += '<span class="todo-progress-pct" style="color:' + (completionPct >= 80 ? '#16a34a' : completionPct >= 50 ? 'var(--pri)' : '#f59e0b') + '">' + completionPct + '%</span>';
  html += '</div>';
  html += '<div class="todo-progress-bar"><div class="todo-progress-fill ' + progressColor + '" data-width="' + completionPct + '"></div></div>';

  // Segmented bar
  if (total > 0) {
    var doneFlex = done; var pendFlex = pending; var doingFlex = doing; var overFlex = overdue;
    html += '<div class="todo-progress-segments">';
    if (done > 0) html += '<div class="todo-progress-seg" style="flex:' + done + ';background:#16a34a"></div>';
    if (doing > 0) html += '<div class="todo-progress-seg" style="flex:' + doing + ';background:var(--pri)"></div>';
    if (pending > 0) html += '<div class="todo-progress-seg" style="flex:' + pending + ';background:#f59e0b"></div>';
    if (overdue > 0) html += '<div class="todo-progress-seg" style="flex:' + overdue + ';background:#ef4444"></div>';
    html += '</div>';

    // Legend
    html += '<div class="todo-progress-legend">';
    if (done > 0) html += '<div class="todo-legend-item"><span class="todo-legend-dot" style="background:#16a34a"></span>已完成 ' + done + '</div>';
    if (doing > 0) html += '<div class="todo-legend-item"><span class="todo-legend-dot" style="background:var(--pri)"></span>进行中 ' + doing + '</div>';
    if (pending > 0) html += '<div class="todo-legend-item"><span class="todo-legend-dot" style="background:#f59e0b"></span>待办 ' + pending + '</div>';
    if (overdue > 0) html += '<div class="todo-legend-item"><span class="todo-legend-dot" style="background:#ef4444"></span>已过期 ' + overdue + '</div>';
    html += '</div>';
  }

  html += '</div>';
  html += '</div>';

  // Trigger progress bar animation after render
  setTimeout(function() {
    document.querySelectorAll('.todo-progress-fill[data-width]').forEach(function(el) {
      el.style.width = el.getAttribute('data-width') + '%';
    });
  }, 50);

  if (filtered.length === 0) {
    html += '<div style="text-align:center;padding:60px 20px;color:var(--muted)">';
    html += '<div style="font-size:56px;margin-bottom:16px;opacity:0.6">📋</div>';
    html += '<div style="font-size:16px;font-weight:700;margin-bottom:6px">暂无待办</div>';
    html += '<div style="font-size:13px;opacity:0.7">点击右下角 + 新建</div>';
    html += '</div>';
  } else {
    // Group: active first, then completed
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
}

function renderTodoCard(t) {
  var priColor = t.priority === '高' ? '#ef4444' : t.priority === '低' ? '#9ca3af' : '#f59e0b';
  var catIcon = { '采购': '🛒', '记账': '💰', '生活': '🏠', '工作': '💼', '健康': '🏥', '其他': '📌' };
  var statusClass = t.status === '已完成' ? 'todo-done' : t.status === '已取消' ? 'todo-cancelled' : '';

  var h = '<div class="todo-card ' + statusClass + '" onclick="openTodoDetail(' + "'" + t.id + "'" + ')">';
  h += '<div class="todo-card-accent" style="background:' + priColor + '"></div>';
  h += '<div class="todo-card-inner">';
  h += '<div class="todo-card-header">';
  h += '<div class="todo-card-title">';
  if (t.status === '已完成') h += '<span class="todo-check">✅</span>';
  else h += '<span class="todo-dot" style="background:' + priColor + '"></span>';
  h += '<span>' + esc(t.title) + '</span>';
  h += '</div>';
  h += '<div class="todo-card-tags">';
  h += '<span class="todo-tag status-' + t.status + '">' + t.status + '</span>';
  if (t.repeat && t.repeat !== '无') h += '<span class="todo-tag repeat">🔄</span>';
  h += '</div></div>';

  // Meta row
  var hasMeta = false;
  if (t.dueDate) {
    var dueStr = formatDueDate(t.dueDate);
    var dueClass = getDueClass(t.dueDate, t.status);
    h += '<div class="todo-due ' + dueClass + '"><span class="todo-due-icon">📅</span> ' + dueStr + '</div>';
    hasMeta = true;
  }

  var metaHtml = '';
  if (t.subtasks && t.subtasks !== '[]') {
    try {
      var subs = JSON.parse(t.subtasks);
      var doneCount = subs.filter(function(s){ return s.done; }).length;
      var pct = subs.length ? Math.round(doneCount/subs.length*100) : 0;
      var barColor = pct >= 100 ? '#16a34a' : 'var(--pri)';
      metaHtml += '<div class="todo-sub-progress"><div class="todo-sub-bar"><div class="todo-sub-fill" style="width:' + pct + '%;background:' + barColor + '"></div></div><span class="todo-sub-text">' + doneCount + '/' + subs.length + '</span></div>';
    } catch(e) {}
  }
  if (t.linkType && t.linkType !== '无') {
    metaHtml += '<div class="todo-link">🔗 ' + (catIcon[t.linkType]||'') + ' ' + t.linkType + '</div>';
  }
  if (metaHtml) {
    h += '<div class="todo-meta-row">' + metaHtml + '</div>';
  }

  h += '</div></div>';
  return h;
}

function renderTodoCalendar() {
  var el = document.getElementById('todoContent');
  if (!el) return;
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

  el.innerHTML = html;
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

function switchTodoView(v) { todoView = v; if (v === 'calendar') renderTodoCalendar(); else renderTodo(); }
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
    await loadTodos();
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
    html += '<div class="detail-row"><span class="detail-label">关联</span><span class="detail-value">🔗 ' + (catIcon[t.linkType]||'') + ' ' + t.linkType + (t.linkId ? ' #' + t.linkId.slice(0,8) : '') + '</span></div>';
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

function closeTodoDetail() {
  document.getElementById('todoDetailOverlay').classList.remove('active');
}

async function completeTodo(id) {
  var r = await todoApi('PUT', { id: id, status: '已完成' });
  if (r && r.error) { toast('操作失败: ' + r.error); return; }
  if (r.renewed) toast('✅ 已完成，已自动续期');
  else toast('✅ 已完成');
  closeTodoDetail();
  await loadTodos();
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



