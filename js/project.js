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

  var total = projectList.length;
  var active = projectList.filter(function(p){ return p.status === '进行中'; }).length;
  var done = projectList.filter(function(p){ return p.status === '已完成'; }).length;
  var archived = projectList.filter(function(p){ return p.status === '已归档'; }).length;

  // 整体完成度：所有未归档项目的关联待办
  var allTodos = (typeof todoList !== 'undefined' ? todoList : []).filter(function(t){
    if (t.status === '已取消') return false;
    var p = projectList.find(function(x){ return x.id === t.projectId; });
    return !!p && p.status !== '已归档';
  });
  var doneTodos = allTodos.filter(function(t){ return t.status === '已完成'; }).length;
  var pct = allTodos.length > 0 ? Math.round(doneTodos / allTodos.length * 100) : 0;
  var CIRC = 2 * Math.PI * 26;
  var dash = (CIRC * pct / 100).toFixed(1);

  var html = '';
  html += '<div class="td3-header">';
  html += '<div class="td3-titlebar"><div><div class="td3-title">项目</div><div class="td3-date">' + total + ' 个项目 · ' + active + ' 个进行中</div></div></div>';
  html += '<div class="td3-hero">';
  html += '<div class="td3-ring"><svg width="76" height="76"><circle cx="38" cy="38" r="26" fill="none" stroke="var(--border)" stroke-width="7"/><circle cx="38" cy="38" r="26" fill="none" stroke="var(--pri)" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + CIRC.toFixed(1) + '"/></svg><div class="pct">' + pct + '%</div></div>';
  html += '<div class="td3-grid">';
  html += '<div class="td3-cell"><b style="color:var(--pri)">' + active + '</b><span>进行中</span></div>';
  html += '<div class="td3-cell"><b style="color:var(--green)">' + done + '</b><span>已完成</span></div>';
  html += '<div class="td3-cell"><b style="color:var(--muted)">' + archived + '</b><span>已归档</span></div>';
  html += '<div class="td3-cell"><b>' + allTodos.length + '</b><span>关联待办</span></div>';
  html += '</div></div>';
  html += '<div class="td3-chips">';
  ['全部','进行中','已完成','已归档'].forEach(function(c) {
    var cnt = c === '全部' ? total : projectList.filter(function(p){ return p.status === c; }).length;
    html += '<span class="chip' + (projectFilter === c ? ' active' : '') + '" onclick="projectFilter=\'' + c + '\';renderProject()">' + c + ' ' + cnt + '</span>';
  });
  html += '</div></div>';

  if (filtered.length === 0) {
    html += '<div class="td3-empty"><div class="ico">📁</div><div class="t">' + (projectFilter === '全部' ? '还没有项目' : '无' + projectFilter + '的项目') + '</div><div class="s">点右上角 + 新建一个项目</div></div>';
    el.innerHTML = html;
    return;
  }

  // 分组渲染（进行中 / 已完成 / 已归档）
  var groups = { '进行中': [], '已完成': [], '已归档': [] };
  filtered.forEach(function(p){
    var g = groups[p.status] ? p.status : '进行中';
    groups[g].push(p);
  });
  var meta = { '进行中': { dot: 'var(--pri)' }, '已完成': { dot: 'var(--green)' }, '已归档': { dot: 'var(--muted)' } };

  ['进行中','已完成','已归档'].forEach(function(g){
    var arr = groups[g];
    if (!arr.length) return;
    html += '<div class="td3-sec"><span class="td3-dot" style="background:' + meta[g].dot + '"></span>' + g + '<span class="td3-n">' + arr.length + '</span></div>';
    html += '<div class="pj-list">';
    var parents = arr.filter(function(p){ return !p.parentId; });
    var kids = arr.filter(function(p){ return p.parentId; });
    parents.forEach(function(p) {
      html += renderProjectCard(p, false);
      kids.filter(function(k){ return k.parentId === p.id; }).forEach(function(k) {
        html += renderProjectCard(k, true, p.name);
      });
    });
    kids.filter(function(c){ return !parents.some(function(p){ return p.id === c.parentId; }); }).forEach(function(k) {
      html += renderProjectCard(k, false);
    });
    html += '</div>';
  });

  el.innerHTML = html;
}

function renderProjectCard(p, isChild, parentName) {
  var linkedTodos = (typeof todoList !== 'undefined' ? todoList : []).filter(function(t){ return t.projectId === p.id && t.status !== '已取消'; });
  var totalTodos = linkedTodos.length;
  var doneTodos = linkedTodos.filter(function(t){ return t.status === '已完成'; }).length;
  var pct = totalTodos > 0 ? Math.round(doneTodos / totalTodos * 100) : 0;
  var color = p.color || '#6366f1';
  var isDone = p.status === '已完成' || p.status === '已归档';
  var kidsN = projectList.filter(function(x){ return x.parentId === p.id; }).length;

  var h = '<div class="pj-card' + (isDone ? ' pj-dim' : '') + (isChild ? ' pj-child' : '') + '" onclick="openProjectDetail(\'' + p.id + '\')">';
  h += '<div class="pj-top">';
  h += '<span class="pj-dot" style="background:' + color + '"></span>';
  h += '<div class="pj-name-wrap">';
  if (isChild && parentName) h += '<div class="pj-parent">' + esc(parentName) + ' ›</div>';
  h += '<div class="pj-name">' + esc(p.name) + '</div>';
  h += '</div>';
  h += '<span class="pj-status pj-' + (p.status==='已完成'?'done':p.status==='已归档'?'arch':'act') + '">' + p.status + '</span>';
  h += '<svg class="td3-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  h += '</div>';
  if (p.description) h += '<div class="pj-desc">' + esc(p.description) + '</div>';
  h += '<div class="pj-meta">';
  if (p.dueDate) h += '<span class="td2-due ' + getDueClass(p.dueDate, p.status) + '">' + formatDueDate(p.dueDate) + '</span>';
  h += '<span class="td2-chip">☑ ' + doneTodos + '/' + totalTodos + '</span>';
  if (kidsN) h += '<span class="td2-chip">📁 子项目 ' + kidsN + '</span>';
  h += '</div>';
  h += '<div class="pj-bar"><i style="width:' + pct + '%;background:' + (pct>=100?'var(--green)':color) + '"></i></div>';
  if (p.status === '已完成') {
    h += '<div class="pj-actions"><button class="td3-mini" onclick="event.stopPropagation();archiveProject(\'' + p.id + '\')">归档</button></div>';
  }
  h += '</div>';
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

  var linkedTodos = (typeof todoList !== 'undefined' ? todoList : []).filter(function(t){ return t.projectId === id; });
  var totalTodos = linkedTodos.length;
  var doneTodos = linkedTodos.filter(function(t){ return t.status === '已完成'; }).length;
  var pct = totalTodos > 0 ? Math.round(doneTodos / totalTodos * 100) : 0;
  var color = p.color || '#6366f1';
  var CIRC = 2 * Math.PI * 26;
  var dash = (CIRC * pct / 100).toFixed(1);

  var html = '';
  html += '<div class="pj-hero">';
  html += '<div class="td3-ring"><svg width="76" height="76"><circle cx="38" cy="38" r="26" fill="none" stroke="var(--border)" stroke-width="7"/><circle cx="38" cy="38" r="26" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + CIRC.toFixed(1) + '"/></svg><div class="pct">' + pct + '%</div></div>';
  html += '<div class="pj-hero-main">';
  html += '<div class="pj-hero-name"><span class="pj-dot" style="background:' + color + '"></span>' + esc(p.name) + '</div>';
  html += '<div class="pj-hero-stats"><span>☑ ' + doneTodos + '/' + totalTodos + ' 待办</span>' + (p.dueDate ? '<span>📅 ' + formatDueDate(p.dueDate) + '</span>' : '') + '<span class="pj-status pj-' + (p.status==='已完成'?'done':p.status==='已归档'?'arch':'act') + '">' + p.status + '</span></div>';
  html += '</div></div>';
  if (p.description) html += '<div class="pj-detail-desc">' + esc(p.description) + '</div>';

  // 子项目
  var subProjects = projectList.filter(function(sp){ return sp.parentId === id; });
  if (subProjects.length > 0) {
    html += '<div class="pj-sec-title">📁 子项目</div>';
    subProjects.forEach(function(sp) {
      var spTodos = (typeof todoList !== 'undefined' ? todoList : []).filter(function(t){ return t.projectId === sp.id && t.status !== '已取消'; });
      var spDone = spTodos.filter(function(t){ return t.status === '已完成'; }).length;
      var spPct = spTodos.length > 0 ? Math.round(spDone / spTodos.length * 100) : 0;
      html += '<div class="pj-sub" onclick="closeProjectDetail();openProjectDetail(\'' + sp.id + '\')">';
      html += '<span class="pj-dot" style="background:' + (sp.color || color) + '"></span>';
      html += '<span class="pj-sub-name">' + esc(sp.name) + '</span>';
      html += '<span class="pj-sub-prog">' + spDone + '/' + spTodos.length + '</span>';
      html += '<span class="pj-sub-bar"><i style="width:' + spPct + '%;background:' + (sp.color || color) + '"></i></span>';
      html += '</div>';
    });
  }

  // 关联待办
  html += '<div class="pj-sec-title">☑ 关联待办 <span class="td3-n">' + linkedTodos.length + '</span></div>';
  if (linkedTodos.length === 0) {
    html += '<div class="pj-empty-line">暂无关联待办，点下方「新建待办」添加</div>';
  } else {
    linkedTodos.forEach(function(t) {
      var tDone = t.status === '已完成';
      var priColor = t.priority === '高' ? 'var(--red)' : t.priority === '低' ? 'var(--muted)' : 'var(--orange)';
      html += '<div class="pj-todo' + (tDone ? ' pj-todo-done' : '') + '" onclick="closeProjectDetail();openTodoDetail(\'' + t.id + '\')">';
      html += '<span class="pj-todo-dot" style="background:' + (tDone ? 'var(--green)' : priColor) + '"></span>';
      html += '<span class="pj-todo-title">' + esc(t.title) + '</span>';
      html += '<span class="pj-todo-status">' + t.status + '</span>';
      html += '</div>';
    });
  }

  // 操作区
  html += '<div class="pj-actions-grid">';
  html += '<button class="pj-act" onclick="closeProjectDetail();openProjectModalForParent(\'' + id + '\')"><span>📁</span>新建子项目</button>';
  html += '<button class="pj-act" onclick="closeProjectDetail();openTodoModalForProject(\'' + id + '\')"><span>☑</span>新建待办</button>';
  html += '<button class="pj-act" onclick="closeProjectDetail();openProjectModal(\'' + id + '\')"><span>✏️</span>编辑</button>';
  if (p.status === '已完成') html += '<button class="pj-act" onclick="archiveProject(\'' + id + '\');closeProjectDetail()"><span>🗄️</span>归档</button>';
  html += '<button class="pj-act pj-act-danger" onclick="deleteProject(\'' + id + '\')"><span>🗑️</span>删除</button>';
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
