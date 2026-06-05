// todo.js - Todo module
(function(){

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
    if (Array.isArray(r)) todoList = r;
  } catch(e) { console.error('loadTodos:', e); }
}

function renderTodo() {
  var el = document.getElementById('todoContent');
  if (!el) return;

  var filtered = todoList;
  if (todoFilter !== '全部') {
    if (todoFilter === '高优先级') filtered = todoList.filter(function(t){ return t.priority === '高' && t.status !== '已完成' && t.status !== '已取消'; });
    else filtered = todoList.filter(function(t){ return t.status === todoFilter; });
  }

  // Sort: overdue first, then by due date, then by priority
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

  if (filtered.length === 0) {
    html += '<div style="text-align:center;padding:60px 20px;color:var(--muted)"><div style="font-size:48px;margin-bottom:12px">📋</div><div>暂无待办</div><div style="font-size:13px;margin-top:8px">点击右下角 + 新建</div></div>';
  } else {
    filtered.forEach(function(t) {
      var priColor = t.priority === '高' ? '#ef4444' : t.priority === '低' ? '#9ca3af' : '#f59e0b';
      var priIcon = t.priority === '高' ? '🔴' : t.priority === '低' ? '⚪' : '🟡';
      var catIcon = { '采购': '🛒', '记账': '💰', '生活': '🏠', '工作': '💼', '健康': '🏥', '其他': '📌' };
      var statusClass = t.status === '已完成' ? 'todo-done' : t.status === '已取消' ? 'todo-cancelled' : '';

      html += '<div class="todo-card ' + statusClass + '" onclick="openTodoDetail(' + "'" + t.id + "'" + ')">';
      html += '<div class="todo-card-header">';
      html += '<div class="todo-card-title">';
      if (t.status === '已完成') html += '<span class="todo-check">✅</span>';
      else html += '<span class="todo-dot" style="background:' + priColor + '"></span>';
      html += '<span>' + esc(t.title) + '</span>';
      html += '</div>';
      html += '<div class="todo-card-tags">';
      html += '<span class="todo-tag pri-' + t.priority + '">' + priIcon + t.priority + '</span>';
      html += '<span class="todo-tag cat">' + (catIcon[t.category] || '📌') + t.category + '</span>';
      if (t.repeat && t.repeat !== '无') html += '<span class="todo-tag repeat">🔄' + t.repeat + '</span>';
      html += '</div></div>';

      if (t.dueDate) {
        var dueStr = formatDueDate(t.dueDate);
        var dueClass = getDueClass(t.dueDate, t.status);
        html += '<div class="todo-due ' + dueClass + '">📅 ' + dueStr + '</div>';
      }

      if (t.subtasks && t.subtasks !== '[]') {
        try {
          var subs = JSON.parse(t.subtasks);
          var doneCount = subs.filter(function(s){ return s.done; }).length;
          html += '<div class="todo-sub-progress"><div class="todo-sub-bar"><div class="todo-sub-fill" style="width:' + (subs.length ? Math.round(doneCount/subs.length*100) : 0) + '%"></div></div><span class="todo-sub-text">' + doneCount + '/' + subs.length + '</span></div>';
        } catch(e) {}
      }

      if (t.linkType && t.linkType !== '无') {
        html += '<div class="todo-link">🔗 ' + t.linkType + '</div>';
      }

      html += '</div>';
    });
  }

  el.innerHTML = html;
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
    linkId: document.getElementById('todoLinkId').value.trim(),
    subtasks: JSON.stringify(todoSubtaskRows.filter(function(s){ return s.text.trim(); }))
  };

  var r;
  if (editingTodoId) {
    body.id = editingTodoId;
    r = await todoApi('PUT', body);
  } else {
    r = await todoApi('POST', body);
  }

  if (r && r.error) { toast('保存失败: ' + r.error); return; }
  toast(editingTodoId ? '已更新' : '已创建');
  closeTodoModal();
  await loadTodos();
  render();
}

function openTodoDetail(id) {
  var t = todoList.find(function(x){ return x.id === id; });
  if (!t) return;
  var overlay = document.getElementById('todoDetailOverlay');
  if (!overlay) return;

  var html = '';
  var priIcon = t.priority === '高' ? '🔴' : t.priority === '低' ? '⚪' : '🟡';
  var catIcon = { '采购': '🛒', '记账': '💰', '生活': '🏠', '工作': '💼', '健康': '🏥', '其他': '📌' };

  html += '<div class="detail-header">';
  html += '<h2>' + esc(t.title) + '</h2>';
  html += '<button class="close-btn" onclick="closeTodoDetail()">✕</button>';
  html += '</div>';

  html += '<div class="detail-body">';

  html += '<div class="detail-row"><span class="detail-label">状态</span><span class="todo-tag status-' + t.status + '">' + t.status + '</span></div>';
  html += '<div class="detail-row"><span class="detail-label">优先级</span><span>' + priIcon + ' ' + t.priority + '</span></div>';
  html += '<div class="detail-row"><span class="detail-label">分类</span><span>' + (catIcon[t.category]||'📌') + ' ' + t.category + '</span></div>';
  if (t.dueDate) html += '<div class="detail-row"><span class="detail-label">截止日期</span><span class="' + getDueClass(t.dueDate, t.status) + '">' + formatDueDate(t.dueDate) + '</span></div>';
  if (t.repeat && t.repeat !== '无') html += '<div class="detail-row"><span class="detail-label">重复</span><span>🔄 ' + t.repeat + '</span></div>';
  if (t.description) html += '<div class="detail-desc">' + esc(t.description) + '</div>';

  if (t.subtasks && t.subtasks !== '[]') {
    try {
      var subs = JSON.parse(t.subtasks);
      html += '<div class="detail-subtasks">';
      html += '<div class="detail-label">子任务</div>';
      subs.forEach(function(s, i) {
        var ck = s.done ? 'checked' : '';
        html += '<label class="subtask-check"><input type="checkbox" ' + ck + ' onchange="toggleTodoSubtask(' + "'" + id + "'," + i + ')"><span>' + esc(s.text) + '</span></label>';
      });
      html += '</div>';
    } catch(e) {}
  }

  if (t.linkType && t.linkType !== '无') {
    html += '<div class="detail-row"><span class="detail-label">关联</span><span>🔗 ' + t.linkType + (t.linkId ? ' #' + t.linkId.slice(0,8) : '') + '</span></div>';
  }

  if (t.completedAt) {
    var cd = new Date(t.completedAt);
    html += '<div class="detail-row"><span class="detail-label">完成时间</span><span>✅ ' + cd.toISOString().slice(0,10) + '</span></div>';
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

App.todo = {
  loadTodos: loadTodos,
  renderTodo: renderTodo,
  renderTodoCalendar: renderTodoCalendar,
  openTodoModal: openTodoModal,
  closeTodoModal: closeTodoModal,
  saveTodo: saveTodo,
  openTodoDetail: openTodoDetail,
  closeTodoDetail: closeTodoDetail,
  completeTodo: completeTodo,
  deleteTodo: deleteTodo,
  toggleTodoSubtask: toggleTodoSubtask,
  switchTodoView: switchTodoView,
  switchTodoFilter: switchTodoFilter,
  addSubtask: addSubtask,
  removeSubtask: removeSubtask,
  updateSubtaskText: updateSubtaskText,
  onTodoFab: onTodoFab
};

window.loadTodos = loadTodos;
window.renderTodo = renderTodo;
window.renderTodoCalendar = renderTodoCalendar;
window.openTodoModal = openTodoModal;
window.closeTodoModal = closeTodoModal;
window.saveTodo = saveTodo;
window.openTodoDetail = openTodoDetail;
window.closeTodoDetail = closeTodoDetail;
window.completeTodo = completeTodo;
window.deleteTodo = deleteTodo;
window.toggleTodoSubtask = toggleTodoSubtask;
window.switchTodoView = switchTodoView;
window.switchTodoFilter = switchTodoFilter;
window.addSubtask = addSubtask;
window.removeSubtask = removeSubtask;
window.updateSubtaskText = updateSubtaskText;
window.todoCalPrev = todoCalPrev;
window.todoCalNext = todoCalNext;
window.selectTodoCalDay = selectTodoCalDay;
window.onTodoFab = onTodoFab;

})();
