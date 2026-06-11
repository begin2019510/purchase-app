// project.js - Project management module

var PROJECT_API = API_BASE + '/api/projects';
var projectList = [];
var projectFilter = "全部";

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
  
  var filtered = projectList;
  if (projectFilter !== '全部') {
    filtered = projectList.filter(function(p){ return p.status === projectFilter; });
  }

  var html = '';
  
  html += '<div class="chips">';
  ['全部','进行中','已完成','已归档'].forEach(function(c) {
    var cnt = c === '全部' ? projectList.length : projectList.filter(function(p){ return p.status === c; }).length;
    html += '<span class="chip' + (projectFilter === c ? ' active' : '') + '" onclick="projectFilter=' + "'" + c + "'" + ';renderProject()" style="font-size:12px">' + c + ' ' + cnt + '</span>';
  });
  html += '</div>';

  html += '<div class="todo-compact-header"><div class="todo-stats-row">';
  var active = projectList.filter(function(p){ return p.status === '进行中'; }).length;
  var done = projectList.filter(function(p){ return p.status === '已完成'; }).length;
  html += '<div class="todo-stat"><span class="todo-stat-num">' + projectList.length + '</span><span class="todo-stat-lbl">全部</span></div>';
  html += '<div class="todo-stat"><span class="todo-stat-num" style="color:var(--pri)">' + active + '</span><span class="todo-stat-lbl">进行中</span></div>';
  html += '<div class="todo-stat"><span class="todo-stat-num" style="color:#16a34a">' + done + '</span><span class="todo-stat-lbl">完成</span></div>';
  html += '</div></div>';

  if (filtered.length === 0) {
    html += '<div class="todo-empty"><div class="todo-empty-icon">📁</div>';
    html += '<div class="todo-empty-text">' + (projectFilter === '全部' ? '暂无项目' : '无' + projectFilter + '的项目') + '</div></div>';
    el.innerHTML = html;
    return;
  }

  // Build hierarchy: parent projects first, then children
  var parents = filtered.filter(function(p){ return !p.parentId; });
  var children = filtered.filter(function(p){ return p.parentId; });
  
  parents.forEach(function(p) {
    html += renderProjectCard(p, false);
    // Render children indented
    var kids = children.filter(function(c){ return c.parentId === p.id; });
    kids.forEach(function(k) {
      html += renderProjectCard(k, true, p.name);
    });
  });
  
  // Orphan children (parent not in filtered)
  var orphanKids = children.filter(function(c){ return !parents.some(function(p){ return p.id === c.parentId; }); });
  orphanKids.forEach(function(k) {
    html += renderProjectCard(k, false);
  });

  el.innerHTML = html;
}

function renderProjectCard(p, isChild, parentName) {
  var linkedTodos = todoList.filter(function(t){ return t.projectId === p.id && t.status !== '已取消'; });
  var totalTodos = linkedTodos.length;
  var doneTodos = linkedTodos.filter(function(t){ return t.status === '已完成'; }).length;
  var pct = totalTodos > 0 ? Math.round(doneTodos / totalTodos * 100) : 0;
  var priColor = p.color || '#6366f1';
  var isDone = p.status === '已完成' || p.status === '已归档';

  var h = '<div class="todo-card' + (isDone ? ' todo-done' : '') + (isChild ? ' project-child-card' : '') + '" onclick="openProjectDetail(\'' + p.id + '\')">';
  h += '<div class="todo-card-accent" style="background:' + priColor + '"></div>';
  h += '<div class="todo-card-inner"><div class="todo-card-main"><div class="todo-card-content">';
  if (isChild && parentName) {
    h += '<div style="font-size:10px;color:var(--muted);margin-bottom:2px">' + esc(parentName) + ' ›</div>';
  }
  h += '<div class="todo-card-title' + (isDone ? ' strikethrough' : '') + '">' + (isChild ? '📋 ' : '📁 ') + esc(p.name) + '</div>';
  if (p.description) h += '<div style="font-size:12px;color:var(--muted);margin:4px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:250px">' + esc(p.description) + '</div>';
  h += '<div class="todo-card-meta">';
  h += '<span class="todo-tag status-' + p.status + '">' + p.status + '</span>';
  if (p.dueDate) h += '<span class="todo-card-due">📅 ' + formatDueDate(p.dueDate) + '</span>';
  h += '<span class="todo-card-progress">📋 ' + doneTodos + '/' + totalTodos + '</span>';
  h += '</div>';
  h += '<div class="todo-card-progress-bar"><div class="todo-card-progress-fill" style="width:' + pct + '%;background:' + (pct>=100?'#16a34a':priColor) + '"></div></div>';
  if (p.status === '已完成') {
    h += '<button onclick="event.stopPropagation();archiveProject(\'' + p.id + '\')" style="margin-top:6px;font-size:11px;padding:3px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card);cursor:pointer">📦 归档</button>';
  }
  h += '</div></div></div></div>';
  return h;
}
function openProjectModal(id) {
  var overlay = document.getElementById('projectModalOverlay');
  if (!overlay) return;

  var p = id ? projectList.find(function(x){ return x.id === id; }) : null;
  document.getElementById('projectModalTitle').textContent = p ? '\u7f16\u8f91\u9879\u76ee' : '\u65b0\u5efa\u9879\u76ee';
  document.getElementById('projectId').value = p ? p.id : '';
  document.getElementById('projectName').value = p ? p.name : '';
  document.getElementById('projectDesc').value = p ? p.description : '';
  if (p && p.dueDate) { var d = new Date(p.dueDate); document.getElementById('projectDueDate').value = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+'T'+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); } else { document.getElementById('projectDueDate').value = ''; }
  document.getElementById('projectStatus').value = p ? p.status : '\u8fdb\u884c\u4e2d';
  document.getElementById('projectColor').value = p ? p.color : '#6366f1';

  // Read pending parentId (Bug #3 fix)
  if (!id && window._pendingParentId) {
    var pSel = document.getElementById('projectParentId');
    if (pSel) pSel.value = window._pendingParentId;
    window._pendingParentId = '';
  }
  // Read pending projectId for todo modal
  if (window._pendingProjectId) {
    var todoSel = document.getElementById('todoProjectId');
    if (todoSel) todoSel.value = window._pendingProjectId;
    window._pendingProjectId = '';
  }

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
    dueDate: (function(){ var v = document.getElementById('projectDueDate').value; return v ? new Date(v).toISOString() : null; })(),
    status: document.getElementById('projectStatus').value,
    color: document.getElementById('projectColor').value,
      parentId: (document.getElementById('projectParentId') || {}).value || '',
  };

  closeProjectModal();

  if (id) {
    data.id = id;
    var p = projectList.find(function(x){ return x.id === id; });
    if (p) { Object.assign(p, data); }
    renderProject();
    var r = await projectApi('PUT', data);
    if (r && r.error) { toast('\u66f4\u65b0\u5931\u8d25: ' + r.error); loadProjects().then(function(){ renderProject(); /* Refresh detail if open */ var dO = document.getElementById('projectDetailOverlay'); if (dO && dO.classList.contains('active')) { var pid = document.getElementById('projectId').value; if (pid) openProjectDetail(pid); } }); }
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
      loadProjects().then(function(){ renderProject(); /* Refresh detail if open */ var dO = document.getElementById('projectDetailOverlay'); if (dO && dO.classList.contains('active')) { var pid = document.getElementById('projectId').value; if (pid) openProjectDetail(pid); } });
    }
  }
}

async function deleteProject(id) {
  if (!confirm('\u786e\u5b9a\u5220\u9664\u8be5\u9879\u76ee\uff1f\u5173\u8054\u7684\u5f85\u529e\u4e0d\u4f1a\u88ab\u5220\u9664\u3002')) return;
  closeProjectDetail();
  projectList = projectList.filter(function(p){ return p.id !== id; });
  renderProject();
  var r = await projectApi('DELETE', null, id);
  if (r && r.error) { toast('\u5220\u9664\u5931\u8d25: ' + r.error); loadProjects().then(function(){ renderProject(); /* Refresh detail if open */ var dO = document.getElementById('projectDetailOverlay'); if (dO && dO.classList.contains('active')) { var pid = document.getElementById('projectId').value; if (pid) openProjectDetail(pid); } }); }
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

  // Sub-projects
  var subProjects = projectList.filter(function(sp){ return sp.parentId === id; });
  if (subProjects.length > 0) {
    html += '<h4 style="margin:0 0 10px;font-size:14px">\ud83d\udcc1 \u5b50\u9879\u76ee</h4>';
    subProjects.forEach(function(sp) {
      var spTodos = todoList.filter(function(t){ return t.projectId === sp.id && t.status !== '\u5df2\u53d6\u6d88'; });
      var spDone = spTodos.filter(function(t){ return t.status === '\u5df2\u5b8c\u6210'; }).length;
      var spPct = spTodos.length > 0 ? Math.round(spDone / spTodos.length * 100) : 0;
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:10px;margin-bottom:6px;cursor:pointer" onclick="closeProjectDetail();openProjectDetail(\'' + sp.id + '\')">';
      html += '<div style="width:10px;height:10px;border-radius:50%;background:' + (sp.color || priColor) + '"></div>';
      html += '<span style="flex:1;font-size:13px">\ud83d\udccb ' + esc(sp.name) + '</span>';
      html += '<span style="font-size:11px;color:var(--muted)">' + spDone + '/' + spTodos.length + '</span>';
      html += '</div>';
    });
  }

  // Linked todos
  html += '<h4 style="margin:12px 0 10px;font-size:14px">\u5173\u8054\u5f85\u529e</h4>';
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
  html += '<button class="btn-action btn-complete" onclick="closeProjectDetail();openProjectModalForParent(\'' + id + '\')">\u2795 \u65b0\u5efa\u5b50\u9879\u76ee</button>';
  html += '<button class="btn-action btn-complete" onclick="closeProjectDetail();openTodoModalForProject(\'' + id + '\')">\u2795 \u65b0\u5efa\u5f85\u529e</button>';
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
  var parents = projectList.filter(function(p){ return !p.parentId && p.status !== '已归档'; });
  var children = projectList.filter(function(p){ return p.parentId && p.status !== '已归档'; });
  var html = '<option value="">无</option>';
  parents.forEach(function(p) {
    // Parent always selectable (Bug #3 fix)
    html += '<option value="' + p.id + '">' + '📁 ' + esc(p.name) + '</option>';
    var kids = children.filter(function(c){ return c.parentId === p.id; });
    kids.forEach(function(k) {
      html += '<option value="' + k.id + '">&nbsp;&nbsp;└ ' + '📋 ' + esc(k.name) + '</option>';
    });
  });
  // Orphan children (parent archived/missing)
  children.filter(function(c){ return !parents.some(function(p){ return p.id === c.parentId; }); }).forEach(function(k) {
    html += '<option value="' + k.id + '">' + '📋 ' + esc(k.name) + '</option>';
  });
  return html;
}

async function archiveProject(id) {
  var p = projectList.find(function(x){ return x.id === id; });
  if (!p) return;
  p.status = '已归档';
  renderProject();
  var r = await projectApi('PUT', { id: id, status: '已归档' });
  if (r && r.error) { toast('归档失败'); loadProjects().then(function(){ renderProject(); /* Refresh detail if open */ var dO = document.getElementById('projectDetailOverlay'); if (dO && dO.classList.contains('active')) { var pid = document.getElementById('projectId').value; if (pid) openProjectDetail(pid); } }); }
  else toast('已归档');
}

function openTodoModalForProject(projectId) {
  window._pendingProjectId = projectId;
  openTodoModal();
}

async function unlinkTodoFromProject(todoId) {
  var t = todoList.find(function(x){ return x.id === todoId; });
  if (!t) return;
  t.projectId = '';
  render();
  await todoApi('PUT', { id: todoId, projectId: '' });
  // Refresh project detail
  var detailOverlay = document.getElementById('projectDetailOverlay');
  if (detailOverlay && detailOverlay.classList.contains('active')) {
    var body = document.getElementById('projectDetailBody');
    if (body) { var h3 = body.querySelector('h3'); if (h3) { var pName = h3.textContent; var p = projectList.find(function(x){ return x.name === pName; }); if (p) openProjectDetail(p.id); } }
  }
  toast('已解除关联');
}

function openProjectModalForParent(parentId) {
  window._pendingParentId = parentId;
  openProjectModal();
}
