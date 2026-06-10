// project.js - Project management module

var PROJECT_API = API_BASE + '/api/projects';
var projectList = [];

async function projectApi(method, body, id) {
  var url = PROJECT_API;
  var opts = { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin() } };
  if (method === 'DELETE') url += '?id=' + id;
  else if (body) opts.body = JSON.stringify(body);
  var r = await fetch(url, opts);
  if (r.status === 401) {
    var nt = await refreshAccessToken();
    if (nt) { opts.headers['Authorization'] = 'Bearer ' + nt; r = await fetch(url, opts); }
  }
  return r.json();
}

async function loadProjects() {
  try {
    var r = await projectApi('GET');
    if (Array.isArray(r)) projectList = r;
    else { console.warn('loadProjects: expected array, got:', r); }
  } catch(e) { console.error('loadProjects error:', e); }
}

function renderProject() {
  var el = document.getElementById('projectContent');
  if (!el) return;

  var html = '';

  // Header
  html += '<div class="todo-compact-header">';
  html += '<div class="todo-stats-row">';
  var active = projectList.filter(function(p){ return p.status === '\u8fdb\u884c\u4e2d'; }).length;
  var done = projectList.filter(function(p){ return p.status === '\u5df2\u5b8c\u6210'; }).length;
  html += '<div class="todo-stat"><span class="todo-stat-num">' + projectList.length + '</span><span class="todo-stat-lbl">\u5168\u90e8</span></div>';
  html += '<div class="todo-stat"><span class="todo-stat-num" style="color:var(--pri)">' + active + '</span><span class="todo-stat-lbl">\u8fdb\u884c\u4e2d</span></div>';
  html += '<div class="todo-stat"><span class="todo-stat-num" style="color:#16a34a">' + done + '</span><span class="todo-stat-lbl">\u5b8c\u6210</span></div>';
  html += '</div>';
  html += '</div>';

  if (projectList.length === 0) {
    html += '<div class="todo-empty">';
    html += '<div class="todo-empty-icon">\ud83d\udcc1</div>';
    html += '<div class="todo-empty-text">\u6682\u65e0\u9879\u76ee</div>';
    html += '<div class="todo-empty-hint">\u70b9\u53f3\u4e0b\u89d2 + \u521b\u5efa\u7b2c\u4e00\u4e2a\u9879\u76ee</div>';
    html += '</div>';
    el.innerHTML = html;
    return;
  }

  // Project cards
  projectList.forEach(function(p) {
    var linkedTodos = todoList.filter(function(t){ return t.projectId === p.id; });
    var totalTodos = linkedTodos.length;
    var doneTodos = linkedTodos.filter(function(t){ return t.status === '\u5df2\u5b8c\u6210'; }).length;
    var pct = totalTodos > 0 ? Math.round(doneTodos / totalTodos * 100) : 0;
    var priColor = p.color || '#6366f1';
    var isDone = p.status === '\u5df2\u5b8c\u6210' || p.status === '\u5df2\u5f52\u6863';

    html += '<div class="todo-card' + (isDone ? ' todo-done' : '') + '" onclick="openProjectDetail(\'' + p.id + '\')">';
    html += '<div class="todo-card-accent" style="background:' + priColor + '"></div>';
    html += '<div class="todo-card-inner">';
    html += '<div class="todo-card-main">';
    html += '<div class="todo-card-content">';
    html += '<div class="todo-card-title' + (isDone ? ' strikethrough' : '') + '">' + esc(p.name) + '</div>';

    if (p.description) {
      html += '<div style="font-size:12px;color:var(--muted);margin:4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:250px">' + esc(p.description) + '</div>';
    }

    // Meta row
    html += '<div class="todo-card-meta">';
    html += '<span class="todo-tag status-' + p.status + '">' + p.status + '</span>';
    if (p.dueDate) {
      var dueStr = formatDueDate(p.dueDate);
      var dueClass = getDueClass(p.dueDate, p.status === '\u5df2\u5b8c\u6210' ? '\u5df2\u5b8c\u6210' : '');
      html += '<span class="todo-card-due ' + dueClass + '">\ud83d\udcc5 ' + dueStr + '</span>';
    }
    html += '<span class="todo-card-progress">\ud83d\udccb ' + doneTodos + '/' + totalTodos + '</span>';
    html += '</div>';

    // Progress bar
    html += '<div class="todo-card-progress-bar"><div class="todo-card-progress-fill" style="width:' + pct + '%;background:' + (pct>=100?'#16a34a':priColor) + '"></div></div>';

    html += '</div>';
    html += '</div>';
    html += '</div></div>';
  });

  el.innerHTML = html;
}

function openProjectModal(id) {
  var overlay = document.getElementById('projectModalOverlay');
  if (!overlay) return;

  var p = id ? projectList.find(function(x){ return x.id === id; }) : null;
  document.getElementById('projectModalTitle').textContent = p ? '\u7f16\u8f91\u9879\u76ee' : '\u65b0\u5efa\u9879\u76ee';
  document.getElementById('projectId').value = p ? p.id : '';
  document.getElementById('projectName').value = p ? p.name : '';
  document.getElementById('projectDesc').value = p ? p.description : '';
  document.getElementById('projectDueDate').value = p && p.dueDate ? new Date(p.dueDate).toISOString().slice(0,16) : '';
  document.getElementById('projectStatus').value = p ? p.status : '\u8fdb\u884c\u4e2d';
  document.getElementById('projectColor').value = p ? p.color : '#6366f1';

  overlay.classList.add('active');
}

function closeProjectModal() {
  document.getElementById('projectModalOverlay').classList.remove('active');
}

async function saveProject() {
  var id = document.getElementById('projectId').value;
  var name = document.getElementById('projectName').value.trim();
  if (!name) { toast('\u8bf7\u8f93\u5165\u9879\u76ee\u540d\u79f0'); return; }

  var data = {
    name: name,
    description: document.getElementById('projectDesc').value.trim(),
    dueDate: document.getElementById('projectDueDate').value || null,
    status: document.getElementById('projectStatus').value,
    color: document.getElementById('projectColor').value,
  };

  closeProjectModal();

  if (id) {
    data.id = id;
    var p = projectList.find(function(x){ return x.id === id; });
    if (p) { Object.assign(p, data); }
    renderProject();
    var r = await projectApi('PUT', data);
    if (r && r.error) { toast('\u66f4\u65b0\u5931\u8d25: ' + r.error); loadProjects().then(function(){ renderProject(); }); }
    else toast('\u2705 \u5df2\u66f4\u65b0');
  } else {
    var r = await projectApi('POST', data);
    if (r && r.ok) {
      data.id = r.id;
      data.progress = 0;
      projectList.unshift(data);
      renderProject();
      toast('\u2705 \u5df2\u521b\u5efa');
    } else {
      toast('\u521b\u5efa\u5931\u8d25: ' + (r.error || '\u672a\u77e5\u9519\u8bef'));
      loadProjects().then(function(){ renderProject(); });
    }
  }
}

async function deleteProject(id) {
  if (!confirm('\u786e\u5b9a\u5220\u9664\u8be5\u9879\u76ee\uff1f\u5173\u8054\u7684\u5f85\u529e\u4e0d\u4f1a\u88ab\u5220\u9664\u3002')) return;
  closeProjectDetail();
  projectList = projectList.filter(function(p){ return p.id !== id; });
  renderProject();
  var r = await projectApi('DELETE', null, id);
  if (r && r.error) { toast('\u5220\u9664\u5931\u8d25: ' + r.error); loadProjects().then(function(){ renderProject(); }); }
  else toast('\u5df2\u5220\u9664');
}

function openProjectDetail(id) {
  var overlay = document.getElementById('projectDetailOverlay');
  if (!overlay) return;

  var p = projectList.find(function(x){ return x.id === id; });
  if (!p) return;

  var linkedTodos = todoList.filter(function(t){ return t.projectId === id; });
  var totalTodos = linkedTodos.length;
  var doneTodos = linkedTodos.filter(function(t){ return t.status === '\u5df2\u5b8c\u6210'; }).length;
  var pct = totalTodos > 0 ? Math.round(doneTodos / totalTodos * 100) : 0;
  var priColor = p.color || '#6366f1';

  var html = '';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">';
  html += '<div style="width:16px;height:16px;border-radius:50%;background:' + priColor + '"></div>';
  html += '<h3 style="margin:0;font-size:18px">' + esc(p.name) + '</h3>';
  html += '</div>';

  if (p.description) {
    html += '<div style="color:var(--muted);font-size:13px;margin-bottom:12px">' + esc(p.description) + '</div>';
  }

  // Stats
  html += '<div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">';
  html += '<div style="background:var(--bg);padding:8px 14px;border-radius:10px;font-size:13px"><span style="font-weight:700;color:' + priColor + '">' + pct + '%</span> \u5b8c\u6210</div>';
  html += '<div style="background:var(--bg);padding:8px 14px;border-radius:10px;font-size:13px"><span style="font-weight:700">' + totalTodos + '</span> \u5f85\u529e</div>';
  html += '<div style="background:var(--bg);padding:8px 14px;border-radius:10px;font-size:13px"><span style="font-weight:700;color:#16a34a">' + doneTodos + '</span> \u5b8c\u6210</div>';
  if (p.dueDate) {
    html += '<div style="background:var(--bg);padding:8px 14px;border-radius:10px;font-size:13px">\ud83d\udcc5 ' + formatDueDate(p.dueDate) + '</div>';
  }
  html += '</div>';

  // Progress bar
  html += '<div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden;margin-bottom:20px"><div style="height:100%;width:' + pct + '%;background:' + (pct>=100?'#16a34a':priColor) + ';border-radius:4px;transition:width .3s"></div></div>';

  // Linked todos
  html += '<h4 style="margin:0 0 10px;font-size:14px">\u5173\u8054\u5f85\u529e</h4>';
  if (linkedTodos.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:var(--muted);font-size:13px">\u6682\u65e0\u5173\u8054\u5f85\u529e</div>';
  } else {
    linkedTodos.forEach(function(t) {
      var tPriColor = t.priority === '\u9ad8' ? '#ef4444' : t.priority === '\u4f4e' ? '#9ca3af' : '#f59e0b';
      var tDone = t.status === '\u5df2\u5b8c\u6210';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border);cursor:pointer" onclick="closeProjectDetail();openTodoDetail(\'' + t.id + '\')">';
      html += '<div style="width:8px;height:8px;border-radius:50%;background:' + tPriColor + ';flex-shrink:0"></div>';
      html += '<span style="flex:1;font-size:13px;' + (tDone ? 'text-decoration:line-through;opacity:.5' : '') + '">' + esc(t.title) + '</span>';
      html += '<span style="font-size:11px;color:var(--muted)">' + t.status + '</span>';
      html += '</div>';
    });
  }

  // Actions
  html += '<div class="detail-actions" style="margin-top:16px">';
  html += '<button class="btn-action btn-edit" onclick="closeProjectDetail();openProjectModal(\'' + id + '\')">\u270f\ufe0f \u7f16\u8f91</button>';
  html += '<button class="btn-action btn-delete" onclick="deleteProject(\'' + id + '\')">\ud83d\uddd1\ufe0f \u5220\u9664</button>';
  html += '</div>';

  document.getElementById('projectDetailBody').innerHTML = html;
  overlay.classList.add('active');
}

function closeProjectDetail() {
  document.getElementById('projectDetailOverlay').classList.remove('active');
}

function getProjectOptions() {
  return projectList.filter(function(p){ return p.status !== '\u5df2\u5f52\u6863'; }).map(function(p) {
    return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
  }).join('');
}
