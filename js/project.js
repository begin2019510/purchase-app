// project.js - 项目模块（清单优先：清单 / 阶段 / 账本，PROJECT-PHASE-DESIGN.md）
var projectList = [];
var projectFilter = "全部";
var selectedPhase = {}; // projectId -> phaseIdx
var projectDetailTab = 'list'; // list | phases | money
var _pjDetailId = null;

function pjErrorText(e) {
  return (e && e.message) ? e.message : '网络错误';
}

// 统一请求：401 自动刷新一次；非 JSON/非 2xx 都转成带原因的异常
async function pjRequest(method, path, body) {
  var url = API_BASE + path;
  var headers = { 'Content-Type': 'application/json' };
  var opts = { method: method, headers: headers };
  if (body !== undefined && body !== null) opts.body = JSON.stringify(body);

  async function send(token) {
    token = token || getPin();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    else delete headers['Authorization'];
    return fetch(url, opts);
  }

  var r;
  try { r = await send(); }
  catch (e) { throw new Error('网络连接失败，请检查网络后重试'); }

  if (r.status === 401) {
    var nt = null;
    try { nt = await refreshAccessToken(); } catch (e) {}
    if (nt) {
      try { r = await send(nt); }
      catch (e) { throw new Error('网络连接失败，请检查网络后重试'); }
    }
    if (r.status === 401) throw new Error('登录已过期，请重新登录');
  }

  var text = await r.text();
  var data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch (e) {
      throw new Error(r.ok
        ? '接口 ' + path.split('?')[0] + ' 返回了网页而不是 JSON（可能尚未部署）'
        : '服务器异常（HTTP ' + r.status + '）');
    }
  }
  if (!r.ok) throw new Error((data && (data.error || data.message)) || ('请求失败（HTTP ' + r.status + '）'));
  if (data && data.error) throw new Error(data.error);
  return data || { ok: true };
}

async function projectApi(method, body, id) {
  var path = '/api/projects';
  if (method === 'DELETE') {
    if (!id) throw new Error('缺少项目 ID');
    path += '?id=' + encodeURIComponent(id);
  }
  return pjRequest(method, path, method === 'DELETE' ? null : body);
}

async function phaseApi(body) {
  return pjRequest('PUT', '/api/phases', body);
}
var _pjLoadErrAt = 0;
async function loadProjects() {
  try {
    var r = await projectApi('GET');
    if (!Array.isArray(r)) throw new Error('项目数据格式异常');
    projectList = r;
    if (typeof setCachedData === 'function') setCachedData('projects', r);
    return true;
  } catch (e) {
    console.error('loadProjects error:', e);
    if (typeof toast === 'function' && Date.now() - _pjLoadErrAt > 60000) {
      _pjLoadErrAt = Date.now();
      toast('项目加载失败: ' + pjErrorText(e));
    }
    return false;
  }
}

// ===== 工具 =====
function pjPhaseStats(p) {
  var phases = p.phases || [];
  var skipped = phases.filter(function(x) { return x.status === 'skipped'; }).length;
  var done = phases.filter(function(x) { return x.status === 'done'; }).length;
  var denom = Math.max(6 - skipped, 1);
  var pct = Math.round(done / denom * 100);
  return { done: done, skipped: skipped, pct: Math.min(pct, 100), denom: denom };
}
function pjMoney(n) {
  n = Number(n) || 0;
  return '¥' + (n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toFixed(0));
}
function pjFocus(el) {
  if (!el) return;
  try { if (typeof el.focus === 'function') el.focus(); } catch (e) {}
}
function pjSpendTotal(p) {
  var s = p.spend || { buy: 0, exp: 0 };
  return (Number(s.buy) || 0) + (Number(s.exp) || 0);
}

function pjPad(n) { return String(n).padStart(2, '0'); }
function pjDateShort(ms) {
  if (ms == null) return '';
  var d = new Date(Number(ms));
  return (d.getMonth() + 1) + '/' + d.getDate();
}
function pjDateTimeShort(ms) {
  if (ms == null) return '';
  var d = new Date(Number(ms));
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pjPad(d.getHours()) + ':' + pjPad(d.getMinutes());
}
function pjDateInput(ms) {
  if (ms == null) return '';
  var d = new Date(Number(ms));
  return d.getFullYear() + '-' + pjPad(d.getMonth() + 1) + '-' + pjPad(d.getDate());
}
// 阶段计划时间精确到分钟（datetime-local 的值）
function pjDateTimeInput(ms) {
  if (ms == null) return '';
  var d = new Date(Number(ms));
  return d.getFullYear() + '-' + pjPad(d.getMonth() + 1) + '-' + pjPad(d.getDate())
    + 'T' + pjPad(d.getHours()) + ':' + pjPad(d.getMinutes());
}
function pjPlanRange(ph) {
  if (!ph) return '';
  if (ph.plannedStart != null && ph.plannedEnd != null) return pjDateTimeShort(ph.plannedStart) + '–' + pjDateTimeShort(ph.plannedEnd);
  if (ph.plannedStart != null) return pjDateTimeShort(ph.plannedStart) + ' 起';
  if (ph.plannedEnd != null) return pjDateTimeShort(ph.plannedEnd) + ' 前';
  return '';
}

var PJ_TODO_CATEGORIES = [
  ['工作', '💼 工作'], ['生活', '🏠 生活'], ['采购', '🛒 采购'],
  ['记账', '💰 记账'], ['健康', '🏥 健康'], ['其他', '📌 其他']
];
function pjLastTodoCategory() {
  try { return localStorage.getItem('pj_todo_category') || '工作'; } catch (e) { return '工作'; }
}
function pjRememberTodoCategory(v) {
  try { localStorage.setItem('pj_todo_category', v); } catch (e) {}
}
function pjCategoryOptions(selected) {
  selected = selected || pjLastTodoCategory();
  return PJ_TODO_CATEGORIES.map(function(c) {
    return '<option value="' + c[0] + '"' + (c[0] === selected ? ' selected' : '') + '>' + c[1] + '</option>';
  }).join('');
}
function pjPhaseOptions(p, selected) {
  var html = '<option value="">不指定步骤</option>';
  var phases = (p && p.phases) || [];
  for (var i = 0; i < 6; i++) {
    var ph = phases[i];
    html += '<option value="' + i + '"' + (selected === i ? ' selected' : '') + '>' + esc(pjStepTitle(ph, i)) + '</option>';
  }
  return html;
}
// 项目内新增待办默认归到“当前这一步”，但用户始终能在下拉里改
function pjDefaultPhase(p) {
  var sel = selectedPhase[p.id];
  if (sel !== undefined && sel !== null && sel >= 0 && sel <= 5) return sel;
  var cur = Number(p.currentPhase) || 0;
  return (cur >= 0 && cur <= 5) ? cur : 0;
}
function pjPhaseTodos(p, idx) {
  return pjLinkedTodos(p).filter(function(t) { return t.phaseIdx != null && Number(t.phaseIdx) === idx; });
}
function pjPhaseTodoStats(p, idx) {
  var arr = pjPhaseTodos(p, idx);
  return { total: arr.length, done: arr.filter(function(t) { return t.status === '已完成'; }).length };
}
function pjDueHtml(ms, status) {
  if (!ms) return '';
  var text = (typeof formatDueDate === 'function') ? formatDueDate(ms) : pjDateShort(ms);
  var cls = (typeof getDueClass === 'function') ? getDueClass(ms, status) : '';
  return '<span class="td2-due ' + cls + '">📅 ' + esc(text) + '</span>';
}

function pjPhaseName(ph, idx) {
  var n = ph && ph.name ? String(ph.name) : '';
  return (n && n !== 'P' + idx) ? n : '';
}
function pjStepTitle(ph, idx) {
  var n = pjPhaseName(ph, idx);
  return '第' + (idx + 1) + '步' + (n ? ' · ' + n : '');
}
function pjStepTitleHtml(ph, idx) {
  var n = pjPhaseName(ph, idx);
  return '第' + (idx + 1) + '步' + (n ? ' · ' + esc(n) : '');
}
function pjPhaseStatusText(st) {
  return ({ todo: '待开始', doing: '进行中', done: '已完成', skipped: '已跳过' }[st] || '待开始');
}

function pjLinkedTodos(p) {
  if (typeof todoList === 'undefined' || !Array.isArray(todoList)) return [];
  return todoList.filter(function(t) {
    return t.projectId === p.id && t.status !== '已删除' && t.status !== '已取消';
  });
}
function pjOpenTodos(p) {
  return pjLinkedTodos(p).filter(function(t) { return t.status !== '已完成'; });
}

// 卡片上的“下一步”：优先取未完成待办，其次当前阶段
function pjNextInfo(p) {
  if (p.status === '已完成') return { label: '进展', text: '🏁 已通关' };
  if (p.status === '已归档') return { label: '状态', text: '已归档' };
  var open = pjOpenTodos(p);
  if (open.length) return { label: '下一步', text: open[0].title };
  var phases = p.phases || [];
  var cur = Number(p.currentPhase) || 0;
  var ph = phases[cur];
  if (ph && ph.status !== 'done' && ph.status !== 'skipped') {
    return { label: '当前步骤', text: pjStepTitle(ph, cur) + (ph.status === 'doing' ? ' · 进行中' : ' · 待开始') };
  }
  for (var i = 0; i < 6; i++) {
    var x = phases[i];
    if (x && x.status !== 'done' && x.status !== 'skipped') {
      return { label: '当前步骤', text: pjStepTitle(x, i) + ' · 待开始' };
    }
  }
  return { label: '提示', text: '到「阶段」里推进，或添加待办' };
}

function pjSortProjects(arr) {
  return arr.slice().sort(function(a, b) {
    var ad = a.dueDate ? Number(a.dueDate) : null;
    var bd = b.dueDate ? Number(b.dueDate) : null;
    if (ad && bd && ad !== bd) return ad - bd;
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
  });
}

// ===== 列表 =====
function renderProject() {
  var el = document.getElementById('projectContent');
  if (!el) return;

  var total = projectList.length;
  var active = projectList.filter(function(p) { return p.status === '进行中'; }).length;
  var done = projectList.filter(function(p) { return p.status === '已完成'; }).length;
  var archived = projectList.filter(function(p) { return p.status === '已归档'; }).length;

  var html = '';
  html += '<div class="pj2-pagehead">';
  html += '<div><div class="pj2-pagetitle">项目</div><div class="pj2-pagesub">' + total + ' 个项目 · ' + active + ' 个进行中</div></div>';
  html += '<button class="pj2-newbtn" onclick="openProjectModal()">＋ 新建</button>';
  html += '</div>';

  html += '<div class="pj2-filters">';
  [['全部', total], ['进行中', active], ['已完成', done], ['已归档', archived]].forEach(function(x) {
    html += '<span class="pj2-filter' + (projectFilter === x[0] ? ' active' : '') + '" onclick="projectFilter=\'' + x[0] + '\';renderProject()">' + x[0] + '<b>' + x[1] + '</b></span>';
  });
  html += '</div>';

  var filtered = projectFilter === '全部' ? projectList : projectList.filter(function(p) { return p.status === projectFilter; });

  if (filtered.length === 0) {
    html += '<div class="pj2-empty"><div class="ico">📁</div><div class="t">' + (total ? '没有' + projectFilter + '的项目' : '还没有项目') + '</div>';
    html += '<div class="s">把出差、装修、学习这类事放进来，<br>待办、阶段和花费都能挂在一起</div>';
    if (!total) html += '<button onclick="openProjectModal()">＋ 新建第一个项目</button>';
    html += '</div>';
    el.innerHTML = html;
    return;
  }

  var groups = { '进行中': [], '已完成': [], '已归档': [] };
  filtered.forEach(function(p) { (groups[p.status] || groups['进行中']).push(p); });
  var meta = { '进行中': 'var(--pri)', '已完成': 'var(--green)', '已归档': 'var(--muted)' };
  ['进行中', '已完成', '已归档'].forEach(function(g) {
    var arr = pjSortProjects(groups[g]);
    if (!arr.length) return;
    html += '<div class="pj2-sec"><span class="pj2-sec-dot" style="background:' + meta[g] + '"></span>' + g + '<span class="pj2-sec-n">' + arr.length + '</span></div>';
    arr.forEach(function(p) { html += renderProjectCard(p); });
  });

  el.innerHTML = html;
}

function renderProjectCard(p) {
  var st = pjPhaseStats(p);
  var color = p.color || '#6366f1';
  var isDone = p.status === '已完成' || p.status === '已归档';
  var phases = p.phases || [];
  var cur = Number(p.currentPhase) || 0;
  var spend = pjSpendTotal(p);
  var next = pjNextInfo(p);
  var openTodos = pjOpenTodos(p).length;
  var cph = phases[cur] || { status: 'todo' };
  var stateCls = p.status === '已完成' ? 'done' : p.status === '已归档' ? 'arch' : 'act';

  var h = '<div class="pj2-card' + (isDone ? ' pj2-dim' : '') + '" style="--pc:' + color + '" onclick="openProjectDetail(\'' + p.id + '\')">';
  h += '<div class="pj2-card-top">';
  h += '<span class="pj2-dot" style="background:' + color + '"></span>';
  h += '<div class="pj2-card-name">' + esc(p.name) + '</div>';
  h += '<span class="pj2-state ' + stateCls + '">' + p.status + '</span>';
  h += '</div>';

  h += '<div class="pj2-next"><span class="pj2-next-label">' + next.label + '</span><span class="pj2-next-text">' + esc(next.text) + '</span></div>';

  h += '<div class="pj2-meta">';
  h += '<span>' + esc(pjStepTitle(cph, cur)) + ' · ' + pjPhaseStatusText(cph.status) + '</span>';
  h += pjDueHtml(p.dueDate, p.status);
  if (spend > 0) h += '<span>💰 ' + pjMoney(spend) + '</span>';
  if (openTodos > 0) h += '<span>☑ ' + openTodos + ' 待办</span>';
  h += '</div>';

  h += '<div class="pj2-progress"><div class="bar"><i style="width:' + st.pct + '%;background:' + (st.pct >= 100 ? 'var(--green)' : color) + '"></i></div><span class="num">' + st.done + '/' + st.denom + ' 步</span></div>';
  h += '</div>';
  return h;
}

// ===== 主题色板 =====
function renderProjColors(selected) {
  var el = document.getElementById('pjfColors');
  if (!el) return;
  var colors = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];
  el.innerHTML = colors.map(function(c) {
    return '<button type="button" class="pjf-color' + (c === selected ? ' sel' : '') + '" style="background:' + c + '" onclick="App.project.pickColor(\'' + c + '\')"></button>';
  }).join('');
}
function pickColor(c) {
  var inp = document.getElementById('projectColor');
  if (inp) inp.value = c;
  renderProjColors(c);
}

// ===== 新建 / 编辑 =====
function openProjectModal(id) {
  var overlay = document.getElementById('projectModalOverlay');
  if (!overlay) return;
  var p = id ? projectList.find(function(x) { return x.id === id; }) : null;
  document.getElementById('projectModalTitle').textContent = p ? '编辑项目' : '新建项目';
  document.getElementById('projectId').value = p ? p.id : '';
  document.getElementById('projectName').value = p ? p.name : '';
  document.getElementById('projectDesc').value = p ? p.description : '';
  if (p && p.dueDate) {
    var d = new Date(p.dueDate);
    document.getElementById('projectDueDate').value = d.getFullYear() + '-' + pjPad(d.getMonth() + 1) + '-' + pjPad(d.getDate()) + 'T' + pjPad(d.getHours()) + ':' + pjPad(d.getMinutes());
  } else document.getElementById('projectDueDate').value = '';
  var _bg = document.getElementById('projectBudget');
  if (_bg) _bg.value = (p && p.budget != null) ? p.budget : '';
  document.getElementById('projectStatus').value = p ? p.status : '进行中';
  var statusGroup = document.getElementById('projectStatusGroup');
  if (statusGroup) statusGroup.style.display = p ? '' : 'none';
  var _c = p ? (p.color || '#6366f1') : '#6366f1';
  document.getElementById('projectColor').value = _c;
  renderProjColors(_c);
  overlay.classList.add('active');
}

function closeProjectModal() {
  var overlay = document.getElementById('projectModalOverlay');
  if (overlay) overlay.classList.remove('active');
  _pjReopenAfterEdit = null;
  _pjReopenTab = 'list';
}

var _pjReopenAfterEdit = null;
var _pjReopenTab = 'list';

async function saveProject() {
  var id = document.getElementById('projectId').value;
  var name = document.getElementById('projectName').value.trim();
  if (!name) { toast('请输入项目名称'); return; }
  var reopenId = _pjReopenAfterEdit;
  var reopenTab = _pjReopenTab || 'list';
  var data = {
    name: name,
    description: document.getElementById('projectDesc').value.trim(),
    dueDate: (function() { var v = document.getElementById('projectDueDate').value; return v ? new Date(v).toISOString() : null; })(),
    status: document.getElementById('projectStatus').value,
    color: document.getElementById('projectColor').value,
    budget: (function() { var el = document.getElementById('projectBudget'); var v = el ? el.value.trim() : ''; return v === '' ? null : Number(v); })(),
  };
  var editing = !!id;
  if (editing) data.id = id;
  try {
    var r = editing ? await projectApi('PUT', data) : await projectApi('POST', data);
    if (!editing && !(r && r.ok && r.id)) throw new Error('服务端未返回项目 ID');
    _pjReopenAfterEdit = null;
    _pjReopenTab = 'list';
    closeProjectModal();
    toast(editing ? '✅ 已更新' : '✅ 项目已创建');
    await loadProjects();
    renderProject();
    if (!editing && r && r.id) {
      projectDetailTab = 'list';
      openProjectDetail(r.id);
    } else if (editing && reopenId) {
      projectDetailTab = reopenTab;
      openProjectDetail(reopenId, { keepTab: true });
    } else if (editing) {
      var dO = document.getElementById('projectDetailOverlay');
      if (dO && dO.classList.contains('active')) openProjectDetail(id);
    }
  } catch (e) {
    toast((editing ? '更新失败: ' : '创建失败: ') + pjErrorText(e));
  }
}

// 从详情里编辑：编辑完成后再回到原来的页签
function editProjectFromDetail(id) {
  _pjReopenAfterEdit = id;
  _pjReopenTab = projectDetailTab;
  closeProjectDetail();
  openProjectModal(id);
}

async function deleteProject(id) {
  if (!confirm('确定删除该项目？\n阶段和清单会一并删除；关联的采购/记账金额保留、待办保留并解除关联。')) return;
  try {
    await projectApi('DELETE', null, id);
    closeProjectDetail();
    // 服务端已解除关联，本地同样清掉，避免待办/采购/记账的编辑表单短暂显示旧项目
    if (typeof todoList !== 'undefined') todoList.forEach(function(t) { if (t.projectId === id) t.projectId = ''; });
    if (typeof items !== 'undefined') items.forEach(function(i) { if (i['项目ID'] === id) { i['项目ID'] = ''; i['阶段'] = null; } });
    if (typeof expenses !== 'undefined') expenses.forEach(function(e) { if (e['项目ID'] === id) { e['项目ID'] = ''; e['阶段'] = null; } });
    toast('已删除');
    await loadProjects();
    renderProject();
  } catch (e) {
    toast('删除失败: ' + pjErrorText(e));
  }
}

async function archiveProject(id) {
  try {
    await projectApi('PUT', { id: id, status: '已归档' });
    closeProjectDetail();
    toast('已归档');
    await loadProjects();
    renderProject();
  } catch (e) {
    toast('归档失败: ' + pjErrorText(e));
  }
}

// ===== 详情 =====
function openProjectDetail(id, opts) {
  var overlay = document.getElementById('projectDetailOverlay');
  if (!overlay) return;
  var p = projectList.find(function(x) { return x.id === id; });
  if (!p) return;
  opts = opts || {};
  if (_pjDetailId !== id && !opts.keepTab) projectDetailTab = 'list';
  _pjDetailId = id;
  if (selectedPhase[id] === undefined) selectedPhase[id] = Number(p.currentPhase) || 0;
  if (['list', 'phases', 'money'].indexOf(projectDetailTab) < 0) projectDetailTab = 'list';

  var st = pjPhaseStats(p);
  var color = p.color || '#6366f1';
  var spend = p.spend || { buy: 0, exp: 0, phases: {} };
  var openTodos = pjOpenTodos(p).length;
  var totalSpend = (Number(spend.buy) || 0) + (Number(spend.exp) || 0);

  var html = '';
  html += '<div class="pj2-sheet-head">';
  html += '<div class="pj2-sheet-name"><span class="pj2-dot" style="background:' + color + '"></span><span class="pj2-name-text">' + esc(p.name) + '</span></div>';
  html += '<button class="pj2-icon-btn" onclick="closeProjectDetail()" aria-label="关闭">✕</button>';
  html += '</div>';

  html += '<div class="pj2-summary">';
  html += '<span class="pj2-state ' + (p.status === '已完成' ? 'done' : p.status === '已归档' ? 'arch' : 'act') + '">' + p.status + '</span>';
  html += '<span class="pj2-pill">' + st.done + '/' + st.denom + ' 步</span>';
  if (openTodos) html += '<span class="pj2-pill">☑ ' + openTodos + ' 待办</span>';
  html += '<span class="pj2-pill money">💰 ' + pjMoney(totalSpend) + '</span>';
  if (p.dueDate) html += pjDueHtml(p.dueDate, p.status);
  html += '</div>';

  html += '<div class="pj2-tabs">';
  html += '<button class="pj2-tab' + (projectDetailTab === 'list' ? ' active' : '') + '" onclick="App.project.setTab(\'list\')">清单' + (openTodos ? '<em>' + openTodos + '</em>' : '') + '</button>';
  html += '<button class="pj2-tab' + (projectDetailTab === 'phases' ? ' active' : '') + '" onclick="App.project.setTab(\'phases\')">阶段<em>' + st.done + '/' + st.denom + '</em></button>';
  html += '<button class="pj2-tab' + (projectDetailTab === 'money' ? ' active' : '') + '" onclick="App.project.setTab(\'money\')">账本<em>' + pjMoney(totalSpend) + '</em></button>';
  html += '</div>';

  html += '<div class="pj2-tabbody">' + renderProjectTabContent(p, projectDetailTab) + '</div>';

  document.getElementById('projectDetailBody').innerHTML = html;
  overlay.classList.add('active');
}

function closeProjectDetail() {
  var overlay = document.getElementById('projectDetailOverlay');
  if (overlay) overlay.classList.remove('active');
  _pjDetailId = null;
}

function setProjectTab(tab) {
  if (['list', 'phases', 'money'].indexOf(tab) < 0) tab = 'list';
  projectDetailTab = tab;
  if (_pjDetailId) openProjectDetail(_pjDetailId);
}

function renderProjectTabContent(p, tab) {
  if (tab === 'phases') return renderProjectPhasesTab(p);
  if (tab === 'money') return renderProjectMoneyTab(p);
  return renderProjectListTab(p);
}

// ---- 清单页 ----
function renderProjectListTab(p) {
  var id = p.id;
  var todos = pjLinkedTodos(p);
  var open = todos.filter(function(t) { return t.status !== '已完成'; });
  var done = todos.filter(function(t) { return t.status === '已完成'; });

  var defPhase = pjDefaultPhase(p);
  var html = '';
  html += '<div class="pj2-quick"><input id="pjQuickTodo" maxlength="200" placeholder="下一件要做的事…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();App.project.quickAddTodo(\'' + id + '\')}"><button onclick="App.project.quickAddTodo(\'' + id + '\')">添加</button></div>';
  html += '<div class="pj2-quick-opts">'
    + '<label>分类<select id="pjQuickCat" onchange="App.project.rememberTodoCategory(this.value)">' + pjCategoryOptions(pjLastTodoCategory()) + '</select></label>'
    + '<label>步骤<select id="pjQuickPhase">' + pjPhaseOptions(p, defPhase) + '</select></label>'
    + '</div>';
  html += '<div class="pj2-quick-sub"><span>清单是全部待办；选了「第几步」后，阶段页会自动汇总</span><button onclick="App.project.openTodoModalForProject(\'' + id + '\',null,null)">更多设置</button></div>';

  if (!open.length && !done.length) {
    html += '<div class="pj2-emptybox"><div class="ico">☑</div><div class="t">还没有待办</div><div class="s">先加一件最想推进的事</div><button onclick="App.project.focusQuickAdd()">＋ 添加第一件</button></div>';
  }

  open.forEach(function(t) { html += renderProjectTodoRow(t, id, false); });

  if (done.length) {
    html += '<div class="pj2-subhead">已完成 <span>' + done.length + '</span></div>';
    done.forEach(function(t) { html += renderProjectTodoRow(t, id, true); });
  }

  if (p.description) html += '<div class="pj2-note"><b>项目备注</b><span>' + esc(p.description) + '</span></div>';

  html += '<div class="pj2-manage">';
  html += '<button onclick="App.project.editFromDetail(\'' + id + '\')">✏️ 编辑项目</button>';
  if (p.status === '已完成') html += '<button onclick="App.project.archiveProject(\'' + id + '\')">🗄️ 归档</button>';
  html += '<button class="danger" onclick="App.project.deleteProject(\'' + id + '\')">删除项目</button>';
  html += '</div>';
  return html;
}

function renderProjectTodoRow(t, projectId, done) {
  var meta = [];
  if (t.phaseIdx != null && Number(t.phaseIdx) >= 0 && Number(t.phaseIdx) <= 5) {
    var _p = projectList.find(function(x) { return x.id === projectId; });
    var _ph = _p && (_p.phases || [])[Number(t.phaseIdx)];
    meta.push('<span class="pj2-step-tag">' + esc(pjStepTitle(_ph, Number(t.phaseIdx))) + '</span>');
  }
  if (t.dueDate) {
    var dt = (typeof formatDueDate === 'function') ? formatDueDate(t.dueDate) : pjDateShort(t.dueDate);
    meta.push(esc(dt));
  }
  if (t.priority && t.priority !== '中') meta.push('优先级 ' + esc(t.priority));
  if (t.category) meta.push(esc(t.category));
  var metaHtml = meta.join('<span class="sep">·</span>');
  // 项目详情保持在下面，待办详情层叠在上方，关闭后仍回到项目
  return '<div class="pj2-todo' + (done ? ' done' : '') + '" onclick="openTodoDetail(\'' + t.id + '\')">'
    + '<button class="pj2-todo-check' + (done ? ' on' : '') + '" onclick="event.stopPropagation();App.project.toggleTodo(\'' + t.id + '\',' + (!done) + ',\'' + projectId + '\')">' + (done ? '✓' : '') + '</button>'
    + '<div class="pj2-todo-main"><div class="pj2-todo-title">' + esc(t.title) + '</div>'
    + (metaHtml ? '<div class="pj2-todo-meta">' + metaHtml + '</div>' : '')
    + '</div><span class="pj2-chev">›</span></div>';
}

// ---- 阶段页 ----
function renderProjectPhasesTab(p) {
  var id = p.id;
  var phases = p.phases || [];
  var cur = Number(p.currentPhase) || 0;
  var sel = selectedPhase[id];
  if (sel === undefined || sel === null || sel < -1 || sel > 5) sel = cur;

  var html = '<div class="pj2-phase-hint">清单里的每条待办都能标记「第几步」；阶段页会自动汇总本步待办与花费。第 1 步和第 6 步必须完成，不能跳过。</div>';
  html += '<div class="pj2-timeline">';
  for (var i = 0; i < 6; i++) {
    var ph = phases[i] || { idx: i, name: 'P' + i, status: 'todo' };
    var st = ph.status || 'todo';
    var expanded = (i === sel);
    var tstat = pjPhaseTodoStats(p, i);
    var phSpendMap = (p.spend && p.spend.phases && p.spend.phases[i]) || {};
    var phSpend = (Number(phSpendMap.buy) || 0) + (Number(phSpendMap.exp) || 0);
    var planned = pjPlanRange(ph);

    html += '<div class="pj2-step ' + st + (expanded ? ' expanded' : '') + '">';
    html += '<button class="pj2-step-head" aria-expanded="' + (expanded ? 'true' : 'false') + '" onclick="App.project.selectPhase(\'' + id + '\',' + i + ')">';
    html += '<span class="pj2-step-idx">' + (st === 'done' ? '✓' : st === 'skipped' ? '⏭' : (i + 1)) + '</span>';
    html += '<span class="pj2-step-main"><span class="pj2-step-name">' + pjStepTitleHtml(ph, i) + (i === cur ? '<i class="pj2-cur">当前</i>' : '') + '</span>';
    html += '<span class="pj2-step-sub">' + pjPhaseStatusText(st)
      + (planned ? ' · 📅 ' + planned : '')
      + (tstat.total ? ' · 待办 ' + tstat.done + '/' + tstat.total : '')
      + (phSpend ? ' · 💰 ' + pjMoney(phSpend) : '')
      + '</span></span>';
    html += '<span class="pj2-chev' + (expanded ? ' open' : '') + '">›</span>';
    html += '</button>';
    if (expanded) html += renderPhaseBody(p, i, ph);
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderPhaseBody(p, idx, ph) {
  var id = p.id;
  var st = ph.status || 'todo';
  var nameVal = pjPhaseName(ph, idx);
  var phTodos = pjPhaseTodos(p, idx);
  var phDone = phTodos.filter(function(t) { return t.status === '已完成'; }).length;
  var spendMap = (p.spend && p.spend.phases && p.spend.phases[idx]) || {};
  var phSpend = (Number(spendMap.buy) || 0) + (Number(spendMap.exp) || 0);
  var phLedger = (p.ledger || []).filter(function(x) { return x.phaseIdx === idx; });

  var html = '<div class="pj2-step-body">';

  // 名称 + 计划时间：一个保存按钮全部写入，时间精确到分钟
  html += '<div class="pj2-editor">';
  html += '<label class="pj2-editor-label">这一步叫什么</label>';
  html += '<input class="pj2-editor-input" id="pjPhaseName" maxlength="50" value="' + esc(nameVal) + '" placeholder="例如：订票 / 客户资料（可选）">';
  html += '<div class="pj2-editor-sub">计划时间（可精确到分钟）</div>'
    + '<div class="pj2-plan-row"><span class="pj2-plan-label">开始</span>'
    + '<input type="datetime-local" id="pjPlanStart" value="' + pjDateTimeInput(ph.plannedStart) + '"></div>'
    + '<div class="pj2-plan-row"><span class="pj2-plan-label">结束</span>'
    + '<input type="datetime-local" id="pjPlanEnd" value="' + pjDateTimeInput(ph.plannedEnd) + '"></div>';
  var actual = [];
  if (ph.startedAt) actual.push('开始 ' + pjDateTimeShort(ph.startedAt));
  if (ph.finishedAt) actual.push((st === 'skipped' ? '跳过 ' : '完成 ') + pjDateTimeShort(ph.finishedAt));
  html += '<div class="pj2-editor-hint">' + (actual.length ? '实际：' + actual.join(' · ') : '可留空；开始/完成时会自动记录实际时间') + '</div>';
  html += '<button class="pj2-save pj2-save-block" onclick="App.project.savePhasePlan(\'' + id + '\',' + idx + ')">保存名称与计划</button>';
  html += '</div>';

  // 本步待办：与项目清单是同一份数据，只是用阶段标签筛选
  html += '<div class="pj2-block-title">本步待办 <span>' + (phTodos.length ? phDone + '/' + phTodos.length : '暂无') + '</span></div>';
  if (!phTodos.length) html += '<div class="pj2-empty-line">还没有待办标记为这一步，可在下面添加，或到「清单」里选择步骤</div>';
  phTodos.forEach(function(t) { html += renderProjectTodoRow(t, id, t.status === '已完成'); });
  html += '<div class="pj2-item-add pj2-phase-add">'
    + '<input id="pjPhaseTodoInput" maxlength="200" placeholder="给这一步加一条待办…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();App.project.addPhaseTodo(\'' + id + '\',' + idx + ')}">'
    + '<select id="pjPhaseTodoCat">' + pjCategoryOptions(pjLastTodoCategory()) + '</select>'
    + '<button onclick="App.project.addPhaseTodo(\'' + id + '\',' + idx + ')">＋</button></div>';

  // 本步花费：逐笔显示明细
  if (phSpend > 0 || phLedger.length) {
    html += '<div class="pj2-block-title">本步花费 <span>' + pjMoney(phSpend) + '</span></div>';
    phLedger.forEach(function(x) { html += renderLedgerMiniRow(x); });
    html += '<button class="pj2-see-all" onclick="App.project.setTab(\'money\')">到账本查看 ' + phLedger.length + ' 笔明细</button>';
  }

  html += '<div class="pj2-money-actions">'
    + '<button onclick="App.project.quickAddPurchase(\'' + id + '\',' + idx + ')">🛒 记采购</button>'
    + '<button onclick="App.project.quickAddExpense(\'' + id + '\',' + idx + ')">💰 记账</button>'
    + '</div>';

  // 状态操作：完成/跳过；第 1、6 步不提供跳过
  html += '<div class="pj2-step-actions">';
  var canSkip = idx !== 0 && idx !== 5;
  if (st === 'todo') {
    if (!canSkip) html += '<button class="pj2-action ghost" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'doing\')">开始</button>';
    html += '<button class="pj2-action primary" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'done\')">完成这一步</button>';
    if (canSkip) html += '<button class="pj2-action ghost" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'skipped\')">跳过</button>';
  } else if (st === 'doing') {
    html += '<button class="pj2-action primary" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'done\')">完成这一步</button>';
    if (canSkip) html += '<button class="pj2-action ghost" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'skipped\')">跳过</button>';
  } else if (st === 'done') {
    html += '<button class="pj2-action ghost" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'todo\')">撤销完成</button>';
  } else if (st === 'skipped') {
    html += '<button class="pj2-action ghost" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'todo\')">恢复这一步</button>';
  }
  if (!canSkip && st !== 'done' && st !== 'skipped') {
    html += '<div class="pj2-p5-hint">🔒 ' + (idx === 0 ? '第 1 步' : '第 6 步') + '必须完成，不能跳过</div>';
  }
  if (idx === 5 && st !== 'done') {
    var pending = [];
    for (var i = 0; i < 5; i++) {
      var s = (p.phases[i] && p.phases[i].status) || 'todo';
      if (s !== 'done' && s !== 'skipped') pending.push('第' + (i + 1) + '步');
    }
    html += '<div class="pj2-p5-hint">' + (pending.length
      ? '🔒 通关前需先完成或跳过 ' + pending.join('、')
      : '🔒 完成这一步后项目自动通关') + '</div>';
  }
  html += '</div>';

  html += '</div>';
  return html;
}

function renderLedgerMiniRow(x) {
  var fn = x.kind === 'purchase' ? 'openDetailModal' : 'openExpenseModal';
  return '<div class="pj2-ledger-mini" onclick="' + fn + '(\'' + x.id + '\')">'
    + '<span>' + (x.kind === 'purchase' ? '🛒' : '💰') + '</span>'
    + '<span class="pj2-lm-name">' + esc(x.title || (x.kind === 'purchase' ? '采购' : '记账')) + '</span>'
    + (x.dateMs ? '<span class="pj2-lm-date">' + pjDateTimeShort(x.dateMs) + '</span>' : '')
    + '<b>' + pjMoney(x.amount) + '</b></div>';
}

// ---- 账本页 ----
function renderProjectMoneyTab(p) {
  var id = p.id;
  var spend = p.spend || { buy: 0, exp: 0 };
  var buy = Number(spend.buy) || 0;
  var exp = Number(spend.exp) || 0;
  var total = buy + exp;
  var budget = (p.budget == null) ? null : Number(p.budget);

  var html = '';
  if (budget && budget > 0) {
    var usedPct = Math.min(Math.round(total / budget * 100), 999);
    var barC = usedPct > 100 ? 'var(--red)' : usedPct > 80 ? 'var(--orange)' : 'var(--green)';
    html += '<div class="pj2-budget">'
      + '<div class="pj2-budget-head"><span>🎯 目标预算 ' + pjMoney(budget) + '</span><button onclick="App.project.editFromDetail(\'' + id + '\')">调整</button></div>'
      + '<div class="pj2-budget-bar"><i style="width:' + Math.min(usedPct, 100) + '%;background:' + barC + '"></i></div>'
      + '<div class="pj2-budget-foot"><span>已花 ' + pjMoney(total) + ' · ' + usedPct + '%</span><span>剩余 ' + pjMoney(budget - total) + '</span></div>'
      + '</div>';
  } else {
    html += '<div class="pj2-budget pj2-budget-empty"><span>还没有目标预算，设一个更好控花费</span><button onclick="App.project.editFromDetail(\'' + id + '\')">设置预算</button></div>';
  }

  html += '<div class="pj2-money-grid">'
    + '<div class="pj2-money-cell"><span>🛒 采购</span><b>' + pjMoney(buy) + '</b></div>'
    + '<div class="pj2-money-cell"><span>💰 记账</span><b>' + pjMoney(exp) + '</b></div>'
    + '<div class="pj2-money-cell accent"><span>合计</span><b>' + pjMoney(total) + '</b></div>'
    + '</div>';

  var defPhase = pjDefaultPhase(p);
  html += '<div class="pj2-money-actions">'
    + '<button onclick="App.project.quickAddPurchase(\'' + id + '\',' + defPhase + ')">🛒 记一笔采购</button>'
    + '<button onclick="App.project.quickAddExpense(\'' + id + '\',' + defPhase + ')">💰 记一笔账</button>'
    + '</div>';

  var ledger = p.ledger || [];
  if (!ledger.length) {
    html += '<div class="pj2-ledger-empty">还没有挂到项目上的采购或记账<br><span>从上方记一笔，或到采购/记账里选择这个项目</span></div>';
  } else {
    html += '<div class="pj2-subhead">全部明细 <span>' + ledger.length + '</span></div>';
    ledger.forEach(function(x) { html += renderLedgerRow(p, x); });
  }
  return html;
}

function pjPhaseLabelFor(p, idx) {
  var ph = (p.phases || [])[idx];
  return ph ? pjStepTitle(ph, idx) : ('第' + (idx + 1) + '步');
}

function renderLedgerRow(p, x) {
  var fn = x.kind === 'purchase' ? 'openDetailModal' : 'openExpenseModal';
  var meta = [];
  meta.push(x.phaseIdx == null || x.phaseIdx < 0 ? '未指定步骤' : pjPhaseLabelFor(p, x.phaseIdx));
  if (x.dateMs) meta.push(pjDateShort(x.dateMs));
  return '<div class="pj2-ledger" onclick="' + fn + '(\'' + x.id + '\')">'
    + '<span class="ico">' + (x.kind === 'purchase' ? '🛒' : '💰') + '</span>'
    + '<div class="main"><div class="name">' + esc(x.title || (x.kind === 'purchase' ? '采购' : '记账')) + '</div><div class="meta">' + esc(meta.join(' · ')) + '</div></div>'
    + '<b>' + pjMoney(x.amount) + '</b>'
    + '</div>';
}

function pjRerenderDetail(id, resetScroll) {
  var body = (typeof document.querySelector === 'function') ? document.querySelector('.pj2-tabbody') : null;
  var top = body ? body.scrollTop : 0;
  openProjectDetail(id);
  var nb = (typeof document.querySelector === 'function') ? document.querySelector('.pj2-tabbody') : null;
  if (nb) nb.scrollTop = resetScroll ? 0 : top;
}

async function refreshProjectUI(id, phaseIdx) {
  await loadProjects();
  renderProject();
  if (phaseIdx !== undefined) selectedPhase[id] = phaseIdx;
  var dO = document.getElementById('projectDetailOverlay');
  if (dO && dO.classList.contains('active')) openProjectDetail(id);
}

// 采购/记账写入后刷新项目花费；失败不影响主流程。
// 若项目详情仍开着，保存后直接留在项目里，并跳到「账本」显示完整明细。
async function refreshProjectsAfterLinkedMoney() {
  if (typeof loadProjects !== 'function') return;
  try {
    await loadProjects();
    if (typeof currentTab !== 'undefined' && currentTab === 'project' && typeof renderProject === 'function') renderProject();
    var dO = document.getElementById('projectDetailOverlay');
    if (_pjDetailId && dO && dO.classList.contains('active')) {
      projectDetailTab = 'money';
      pjRerenderDetail(_pjDetailId, true);
    }
  } catch (e) {}
}

// ===== 从项目直接记钱 =====
// 不关闭项目详情：采购/记账弹层叠在上面，保存后原地刷新账本，取消则回到项目
function quickAddPurchase(projectId, phaseIdx) {
  openModal(projectId, phaseIdx);
  toast('已关联到该项目，保存后回到账本');
}
function quickAddExpense(projectId, phaseIdx) {
  openExpenseModal(null, projectId, phaseIdx);
  toast('已关联到该项目，保存后回到账本');
}

// ===== 清单交互 =====
function focusQuickAdd() {
  pjFocus(document.getElementById('pjQuickTodo'));
}

function rememberTodoCategory(v) {
  if (v) pjRememberTodoCategory(v);
}

async function pjCreateProjectTodo(projectId, phaseIdx, title, category, inputEl, focusId) {
  title = (title || '').trim();
  if (!title) { pjFocus(inputEl); toast('请输入待办内容'); return; }
  if (typeof todoList === 'undefined') return;
  category = category || pjLastTodoCategory();
  pjRememberTodoCategory(category);
  if (phaseIdx === '' || phaseIdx === undefined || phaseIdx === null) phaseIdx = null;
  else phaseIdx = Number(phaseIdx);
  var tmp = {
    id: 'tmpPJ_' + Date.now(), title: title, status: '待办', priority: '中',
    category: category, repeat: '无', projectId: projectId, phaseIdx: phaseIdx, subtasks: '[]', tags: '[]'
  };
  todoList.unshift(tmp);
  if (inputEl) inputEl.value = '';
  renderProject();
  if (_pjDetailId === projectId) pjRerenderDetail(projectId);
  var r;
  try {
    r = await todoApi('POST', {
      title: title, priority: '中', category: category, repeat: '无',
      projectId: projectId, phaseIdx: phaseIdx, status: '待办'
    });
    if (r && r.error) throw new Error(r.error || '保存失败');
    if (r && r.id) tmp.id = r.id;
  } catch (e) {
    // 只有保存失败才回滚；保存成功后的界面刷新错误不能把已入库的待办删掉
    todoList = todoList.filter(function(t) { return t !== tmp; });
    renderProject();
    if (_pjDetailId === projectId) pjRerenderDetail(projectId);
    toast('添加失败: ' + pjErrorText(e));
    return;
  }
  try {
    if (typeof currentTab !== 'undefined' && currentTab === 'todo' && typeof renderTodo === 'function') renderTodo();
  } catch (e) {}
  if (focusId) pjFocus(document.getElementById(focusId));
}

async function quickAddTodo(projectId) {
  var inp = document.getElementById('pjQuickTodo');
  var catEl = document.getElementById('pjQuickCat');
  var phEl = document.getElementById('pjQuickPhase');
  await pjCreateProjectTodo(
    projectId,
    phEl ? phEl.value : null,
    inp ? inp.value : '',
    catEl ? catEl.value : pjLastTodoCategory(),
    inp,
    'pjQuickTodo'
  );
}

async function addPhaseTodo(projectId, idx) {
  var inp = document.getElementById('pjPhaseTodoInput');
  var catEl = document.getElementById('pjPhaseTodoCat');
  await pjCreateProjectTodo(
    projectId, idx,
    inp ? inp.value : '',
    catEl ? catEl.value : pjLastTodoCategory(),
    inp,
    'pjPhaseTodoInput'
  );
}

async function toggleProjectTodo(todoId, done, projectId) {
  if (typeof todoList === 'undefined') return;
  var t = todoList.find(function(x) { return x.id === todoId; });
  if (!t) return;
  var oldStatus = t.status, oldCompleted = t.completedAt;
  t.status = done ? '已完成' : '待办';
  t.completedAt = done ? Date.now() : null;
  renderProject();
  pjRerenderDetail(projectId);
  try {
    var r = await todoApi('PUT', { id: todoId, status: t.status, completedAt: t.completedAt });
    if (r && r.error) throw new Error(r.error);
    if (typeof currentTab !== 'undefined' && currentTab === 'todo' && typeof renderTodo === 'function') renderTodo();
  } catch (e) {
    t.status = oldStatus;
    t.completedAt = oldCompleted;
    renderProject();
    pjRerenderDetail(projectId);
    toast('更新失败: ' + pjErrorText(e));
  }
}

// ===== 阶段交互 =====
// 再点一次已展开步骤的箭头即可收起
function selectPhase(projectId, idx) {
  selectedPhase[projectId] = (selectedPhase[projectId] === idx) ? -1 : idx;
  projectDetailTab = 'phases';
  openProjectDetail(projectId);
}

async function setPhase(projectId, idx, status) {
  if (status === 'skipped' && (idx === 0 || idx === 5)) {
    toast(idx === 0 ? '第 1 步必须完成，不能跳过' : '第 6 步是最终阶段，必须完成，不能跳过');
    return;
  }
  if (status === 'skipped' && !confirm('跳过第 ' + (idx + 1) + ' 步？\n之后可在同一位置恢复。')) return;
  if (status === 'done' && idx === 5) {
    var _p = projectList.find(function(x) { return x.id === projectId; });
    var _phs = (_p && _p.phases) || [];
    var _pending = [];
    for (var _i = 0; _i < 5; _i++) {
      var _s = (_phs[_i] && _phs[_i].status) || 'todo';
      if (_s !== 'done' && _s !== 'skipped') _pending.push('第' + (_i + 1) + '步');
    }
    if (_pending.length) { toast('请先完成或跳过 ' + _pending.join('、')); return; }
    if (!confirm('完成第 6 步？\n项目将自动通关，可归档。')) return;
  }
  try {
    var r = await phaseApi({ projectId: projectId, phaseIdx: idx, status: status });
    var nextIdx = (status === 'done' || status === 'skipped') && r && r.currentPhase != null ? Number(r.currentPhase) : idx;
    var msg;
    if (status === 'done') {
      if (idx === 5) msg = '🏁 项目已通关';
      else if (nextIdx !== idx && nextIdx >= 0 && nextIdx <= 5) {
        var p = projectList.find(function(x) { return x.id === projectId; });
        var np = (p && p.phases) || [];
        msg = '✅ 已完成，下一步：' + (np[nextIdx] ? pjStepTitle(np[nextIdx], nextIdx) : ('第' + (nextIdx + 1) + '步'));
      } else msg = '✅ 已完成';
    } else if (status === 'skipped') msg = '⏭ 已跳过';
    else if (status === 'doing') msg = '▶ 这一步已开始';
    else msg = '↩ 已撤销';
    toast(msg);
    projectDetailTab = 'phases';
    await refreshProjectUI(projectId, nextIdx);
  } catch (e) {
    toast('操作失败: ' + pjErrorText(e));
  }
}

async function savePhasePlan(projectId, idx) {
  var sEl = document.getElementById('pjPlanStart');
  var eEl = document.getElementById('pjPlanEnd');
  var nEl = document.getElementById('pjPhaseName');
  var ss = sEl ? sEl.value : '';
  var ee = eEl ? eEl.value : '';
  if (ss && ee && new Date(ee).getTime() < new Date(ss).getTime()) { toast('完成时间不能早于开始时间'); return; }
  var body = {
    projectId: projectId, phaseIdx: idx,
    plannedStart: ss ? new Date(ss).toISOString() : null,
    plannedEnd: ee ? new Date(ee).toISOString() : null
  };
  if (nEl) body.displayName = nEl.value.trim().slice(0, 50);
  try {
    await phaseApi(body);
    toast('✅ 已保存');
    await refreshProjectUI(projectId, idx);
  } catch (e) {
    toast('保存失败: ' + pjErrorText(e));
  }
}

async function renamePhase(projectId, idx) {
  var p = projectList.find(function(x) { return x.id === projectId; });
  var ph = (p && p.phases && p.phases[idx]) || {};
  var v = prompt('第 ' + (idx + 1) + ' 步的显示名（留空恢复默认）', pjPhaseName(ph, idx));
  if (v === null) return;
  try {
    await phaseApi({ projectId: projectId, phaseIdx: idx, displayName: v.trim() });
    toast(v.trim() ? '已改名为「' + v.trim() + '」' : '已恢复默认名');
    await refreshProjectUI(projectId, idx);
  } catch (e) {
    toast('改名失败: ' + pjErrorText(e));
  }
}

// ===== Todo 联动 =====
function openTodoModalForProject(projectId, phaseIdx, category) {
  var p = projectList.find(function(x) { return x.id === projectId; });
  window._pendingProjectId = projectId;
  window._pendingPhaseIdx = (phaseIdx === null || phaseIdx === undefined)
    ? (p ? pjDefaultPhase(p) : null)
    : Number(phaseIdx);
  window._pendingTodoCategory = category || pjLastTodoCategory();
  // 不关闭项目详情：待办弹层叠在上面，保存后回到项目
  openTodoModal();
}

async function unlinkTodoFromProject(todoId) {
  var t = todoList.find(function(x) { return x.id === todoId; });
  if (!t) return;
  t.projectId = '';
  render();
  await todoApi('PUT', { id: todoId, projectId: '' });
  toast('已解除关联');
}

function openProjectModalForParent(parentId) {
  openProjectModal();
}

// selectedId：编辑已关联记录时，即使项目已归档也要保留在选项里，
// 否则 select 的值会被重置为空，保存时静默把记录从项目上解绑。
function getProjectOptions(selectedId) {
  var html = '<option value="">无</option>';
  projectList.filter(function(p) {
    return p.status !== '已归档' || (selectedId && p.id === selectedId);
  }).forEach(function(p) {
    html += '<option value="' + p.id + '">📁 ' + esc(p.name) + (p.status === '已归档' ? '（已归档）' : '') + '</option>';
  });
  return html;
}

// 采购/记账表单：项目 + 阶段联动下拉
function fillProjectPhaseSelects(projSelId, phaseSelId, projId, phaseIdx) {
  var ps = document.getElementById(projSelId);
  if (!ps) return;
  ps.innerHTML = getProjectOptions(projId);
  ps.value = projId || '';
  var fs = document.getElementById(phaseSelId);
  if (!fs) return;
  function rebuild() {
    var pid = ps.value;
    var p = projectList.find(function(x) { return x.id === pid; });
    var html = '<option value="">不指定阶段</option>';
    if (p && p.phases) {
      p.phases.forEach(function(ph) {
        html += '<option value="' + ph.idx + '">' + esc(pjStepTitle(ph, ph.idx)) + '</option>';
      });
    }
    fs.innerHTML = html;
    fs.value = (phaseIdx === null || phaseIdx === undefined) ? '' : String(phaseIdx);
  }
  ps.onchange = rebuild;
  rebuild();
}

App.project = {
  loadProjects: loadProjects,
  renderProject: renderProject,
  openProjectDetail: openProjectDetail,
  closeProjectDetail: closeProjectDetail,
  openProjectModal: openProjectModal,
  closeProjectModal: closeProjectModal,
  saveProject: saveProject,
  deleteProject: deleteProject,
  archiveProject: archiveProject,
  editFromDetail: editProjectFromDetail,
  selectPhase: selectPhase,
  setTab: setProjectTab,
  setPhase: setPhase,
  renamePhase: renamePhase,
  renderProjColors: renderProjColors,
  pickColor: pickColor,
  savePhasePlan: savePhasePlan,
  quickAddPurchase: quickAddPurchase,
  quickAddExpense: quickAddExpense,
  quickAddTodo: quickAddTodo,
  addPhaseTodo: addPhaseTodo,
  rememberTodoCategory: rememberTodoCategory,
  toggleTodo: toggleProjectTodo,
  focusQuickAdd: focusQuickAdd,
  openTodoModalForProject: openTodoModalForProject,
  getProjectOptions: getProjectOptions,
  fillProjectPhaseSelects: fillProjectPhaseSelects,
};
