// project.js - 项目模块（P0~P5 阶段通关制，PROJECT-PHASE-DESIGN.md）
var projectList = [];
var projectFilter = "全部";
var selectedPhase = {}; // projectId -> phaseIdx

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
async function phaseItemApi(method, body, id) {
  var path = '/api/phase-items';
  if (method === 'DELETE') {
    if (!id) throw new Error('缺少交付物 ID');
    path += '?id=' + encodeURIComponent(id);
  }
  return pjRequest(method, path, method === 'DELETE' ? null : body);
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
function pjSpendTotal(p) {
  var s = p.spend || { buy: 0, exp: 0 };
  return (Number(s.buy) || 0) + (Number(s.exp) || 0);
}

// ===== 列表 =====
function renderProject() {
  var el = document.getElementById('projectContent');
  if (!el) return;

  var filtered = projectList;
  if (projectFilter !== '全部') filtered = projectList.filter(function(p) { return p.status === projectFilter; });

  var total = projectList.length;
  var active = projectList.filter(function(p) { return p.status === '进行中'; }).length;
  var done = projectList.filter(function(p) { return p.status === '已完成'; }).length;
  var archived = projectList.filter(function(p) { return p.status === '已归档'; }).length;

  var allDone = 0, allDenom = 0;
  projectList.forEach(function(p) {
    if (p.status === '已归档') return;
    var st = pjPhaseStats(p);
    allDone += st.done; allDenom += st.denom;
  });
  var pct = allDenom > 0 ? Math.round(allDone / allDenom * 100) : 0;
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
  html += '<div class="td3-cell"><b>' + total + '</b><span>全部项目</span></div>';
  html += '</div></div>';
  html += '<div class="td3-chips">';
  ['全部','进行中','已完成','已归档'].forEach(function(c) {
    var cnt = c === '全部' ? total : projectList.filter(function(p) { return p.status === c; }).length;
    html += '<span class="chip' + (projectFilter === c ? ' active' : '') + '" onclick="projectFilter=\'' + c + '\';renderProject()">' + c + ' ' + cnt + '</span>';
  });
  html += '</div></div>';

  if (filtered.length === 0) {
    html += '<div class="td3-empty"><div class="ico">📁</div><div class="t">' + (projectFilter === '全部' ? '开始你的第一个项目' : '无' + projectFilter + '的项目') + '</div><div class="s">每个项目有 P0~P5 六个阶段，走完即通关</div></div>';
    el.innerHTML = html;
    return;
  }

  var groups = { '进行中': [], '已完成': [], '已归档': [] };
  filtered.forEach(function(p) { (groups[p.status] || groups['进行中']).push(p); });
  var meta = { '进行中': 'var(--pri)', '已完成': 'var(--green)', '已归档': 'var(--muted)' };
  ['进行中','已完成','已归档'].forEach(function(g) {
    var arr = groups[g];
    if (!arr.length) return;
    html += '<div class="td3-sec"><span class="td3-dot" style="background:' + meta[g] + '"></span>' + g + '<span class="td3-n">' + arr.length + '</span></div>';
    html += '<div class="pj-list">';
    arr.forEach(function(p) { html += renderProjectCard(p); });
    html += '</div>';
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

  var h = '<div class="pj-card' + (isDone ? ' pj-dim' : '') + '" onclick="openProjectDetail(\'' + p.id + '\')">';
  h += '<div class="pj-top">';
  h += '<span class="pj-dot" style="background:' + color + '"></span>';
  h += '<div class="pj-name-wrap"><div class="pj-name">' + esc(p.name) + '</div></div>';
  h += '<span class="pj-status pj-' + (p.status === '已完成' ? 'done' : p.status === '已归档' ? 'arch' : 'act') + '">' + p.status + '</span>';
  h += '</div>';
  if (p.description) h += '<div class="pj-desc">' + esc(p.description) + '</div>';

  h += '<div class="pj-phases">';
  for (var i = 0; i < 6; i++) {
    var ph = phases[i] || { status: 'todo' };
    var cls = ph.status === 'done' ? 'done' : ph.status === 'doing' ? 'doing' : ph.status === 'skipped' ? 'skip' : 'todo';
    h += '<span class="pj-ph ' + cls + (i === cur && ph.status !== 'done' ? ' cur' : '') + '">' + (ph.status === 'done' ? '✓' : ph.status === 'skipped' ? '⏭' : 'P' + i) + '</span>';
  }
  h += '</div>';

  h += '<div class="pj-meta">';
  var _curSt = (phases[cur] || {}).status;
  var _curLabel = (isDone || st.pct >= 100) ? '🏁 通关'
    : _curSt === 'doing' ? 'P' + cur + ' 进行中'
    : _curSt === 'done' ? 'P' + cur + ' 已完成'
    : _curSt === 'skipped' ? '⏭ 已跳过'
    : 'P' + cur + ' 待开始';
  h += '<span class="td2-chip">' + _curLabel + '</span>';
  var _cph = phases[cur];
  if (_cph && _cph.plannedEnd) {
    var _pd = new Date(Number(_cph.plannedEnd));
    h += '<span class="td2-chip">🎯 计划 ' + (_pd.getMonth() + 1) + '/' + _pd.getDate() + '</span>';
  }
  if (p.dueDate) h += '<span class="td2-due ' + getDueClass(p.dueDate, p.status) + '">' + formatDueDate(p.dueDate) + '</span>';
  if (spend > 0) h += '<span class="td2-chip">💰 ' + pjMoney(spend) + '</span>';
  h += '</div>';
  h += '<div class="pj-bar"><i style="width:' + st.pct + '%;background:' + (st.pct >= 100 ? 'var(--green)' : color) + '"></i></div>';
  if (p.status === '已完成') {
    h += '<div class="pj-actions"><button class="td3-mini" onclick="event.stopPropagation();archiveProject(\'' + p.id + '\')">归档</button></div>';
  }
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
    document.getElementById('projectDueDate').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } else document.getElementById('projectDueDate').value = '';
  var _bg = document.getElementById('projectBudget');
  if (_bg) _bg.value = (p && p.budget != null) ? p.budget : '';
  document.getElementById('projectStatus').value = p ? p.status : '进行中';
  var _c = p ? (p.color || '#6366f1') : '#6366f1';
  document.getElementById('projectColor').value = _c;
  renderProjColors(_c);
  overlay.classList.add('active');
}

function closeProjectModal() {
  document.getElementById('projectModalOverlay').classList.remove('active');
}

async function saveProject() {
  var id = document.getElementById('projectId').value;
  var name = document.getElementById('projectName').value.trim();
  if (!name) { toast('请输入项目名称'); return; }
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
    closeProjectModal();
    toast(editing ? '✅ 已更新' : '✅ 已创建，含 P0~P5 六个阶段');
    await loadProjects();
    renderProject();
    if (editing) {
      var dO = document.getElementById('projectDetailOverlay');
      if (dO && dO.classList.contains('active')) openProjectDetail(id);
    }
  } catch (e) {
    toast((editing ? '更新失败: ' : '创建失败: ') + pjErrorText(e));
  }
}

async function deleteProject(id) {
  if (!confirm('确定删除该项目？\n阶段和交付物会一并删除；关联的采购/记账金额保留、待办保留。')) return;
  try {
    await projectApi('DELETE', null, id);
    closeProjectDetail();
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
function openProjectDetail(id) {
  var overlay = document.getElementById('projectDetailOverlay');
  if (!overlay) return;
  var p = projectList.find(function(x) { return x.id === id; });
  if (!p) return;

  var st = pjPhaseStats(p);
  var color = p.color || '#6366f1';
  var phases = p.phases || [];
  var items = p.items || [];
  var cur = Number(p.currentPhase) || 0;
  var sel = (selectedPhase[id] !== undefined) ? selectedPhase[id] : cur;
  if (sel < 0 || sel > 5) sel = 0;
  var CIRC = 2 * Math.PI * 26;
  var dash = (CIRC * st.pct / 100).toFixed(1);
  var spend = p.spend || { buy: 0, exp: 0, phases: {} };

  var html = '';
  html += '<div class="pj-hero">';
  html += '<div class="td3-ring"><svg width="76" height="76"><circle cx="38" cy="38" r="26" fill="none" stroke="var(--border)" stroke-width="7"/><circle cx="38" cy="38" r="26" fill="none" stroke="' + color + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + CIRC.toFixed(1) + '"/></svg><div class="pct">' + st.pct + '%</div></div>';
  html += '<div class="pj-hero-main">';
  html += '<div class="pj-hero-name"><span class="pj-dot" style="background:' + color + '"></span>' + esc(p.name) + '</div>';
  html += '<div class="pj-hero-stats"><span class="pj-status pj-' + (p.status === '已完成' ? 'done' : p.status === '已归档' ? 'arch' : 'act') + '">' + p.status + '</span>' + (p.dueDate ? '<span>📅 ' + formatDueDate(p.dueDate) + '</span>' : '') + '<span>' + st.done + '/' + st.denom + ' 阶段</span></div>';
  html += '</div></div>';
  if (p.description) html += '<div class="pj-detail-desc">' + esc(p.description) + '</div>';

  // 目标预算 vs 已花
  var _budget = (p.budget == null) ? null : Number(p.budget);
  var _spent = (Number(spend.buy) || 0) + (Number(spend.exp) || 0);
  if (_budget && _budget > 0) {
    var _usedPct = Math.min(Math.round(_spent / _budget * 100), 999);
    var _barC = _usedPct > 100 ? 'var(--red)' : _usedPct > 80 ? 'var(--orange)' : 'var(--green)';
    html += '<div class="pj-budget">'
      + '<div class="pj-budget-head"><span>🎯 目标预算 ' + pjMoney(_budget) + '</span><span style="color:' + _barC + '">已用 ' + _usedPct + '%</span></div>'
      + '<div class="pj-budget-bar"><i style="width:' + Math.min(_usedPct, 100) + '%;background:' + _barC + '"></i></div>'
      + '<div class="pj-budget-foot"><span>已花 ' + pjMoney(_spent) + '</span><span>剩余 ' + pjMoney(_budget - _spent) + '</span></div>'
      + '</div>';
  }

  // 阶段条
  html += '<div class="pj-strip">';
  for (var i = 0; i < 6; i++) {
    var ph = phases[i] || { status: 'todo' };
    var cls = ph.status === 'done' ? 'done' : ph.status === 'doing' ? 'doing' : ph.status === 'skipped' ? 'skip' : 'todo';
    html += '<button class="pj-node ' + cls + (i === sel ? ' sel' : '') + (i === cur ? ' cur' : '') + '" onclick="event.stopPropagation();App.project.selectPhase(\'' + id + '\',' + i + ')">'
      + '<span class="pj-node-p">P' + i + '</span>'
      + '<span class="pj-node-ic">' + (ph.status === 'done' ? '✓' : ph.status === 'skipped' ? '⏭' : '') + '</span>'
      + '</button>';
  }
  html += '</div>';

  var sph = phases[sel] || { name: 'P' + sel, status: 'todo' };
  var phItems = items.filter(function(it) { return it.phaseIdx === sel; });
  var phSpend = (spend.phases && spend.phases[sel]) ? ((Number(spend.phases[sel].buy) || 0) + (Number(spend.phases[sel].exp) || 0)) : 0;
  var phName = sph.name || ('P' + sel);
  var phStatus = sph.status || 'todo';

  html += '<div class="pj-phase-card">';
  html += '<div class="pj-phase-head">';
  html += '<span class="pj-phase-name">P' + sel + (phName !== 'P' + sel ? ' · ' + esc(phName) : '') + '</span>';
  html += '<button class="pj-phase-edit" onclick="event.stopPropagation();App.project.renamePhase(\'' + id + '\',' + sel + ')" title="改阶段名">✏️</button>';
  html += '<span class="pj-phase-status ' + phStatus + '">' + ({ todo: '待开始', doing: '进行中', done: '已完成', skipped: '已跳过' }[phStatus] || phStatus) + '</span>';
  html += '</div>';
  if (sph.note) html += '<div class="pj-phase-note">' + esc(sph.note) + '</div>';
  if (phSpend > 0) html += '<div class="pj-phase-spend">💰 本阶段花费 ' + pjMoney(phSpend) + '</div>';

  // 规划时间（里程碑）：可编辑
  var _ds = function(ms) { if (ms == null) return ''; var d = new Date(Number(ms)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var _dt = function(ms) { if (ms == null) return ''; var d = new Date(Number(ms)); return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  html += '<div class="pj-plan">';
  html += '<div class="pj-plan-row"><span class="pj-plan-lbl">📅 规划时间</span>'
    + '<input type="date" id="pjPlanStart" value="' + _ds(sph.plannedStart) + '">'
    + '<span class="pj-plan-sep">→</span>'
    + '<input type="date" id="pjPlanEnd" value="' + _ds(sph.plannedEnd) + '">'
    + '<button class="pj-plan-save" onclick="App.project.savePhasePlan(\'' + id + '\',' + sel + ')">保存</button></div>';
  if (sph.startedAt || sph.finishedAt) {
    html += '<div class="pj-actual">'
      + (sph.startedAt ? '<span>▶ 开始 <b>' + _dt(sph.startedAt) + '</b></span>' : '')
      + (sph.finishedAt ? '<span>' + (phStatus === 'skipped' ? '⏭ 跳过' : '✓ 完成') + ' <b>' + _dt(sph.finishedAt) + '</b></span>' : '')
      + '</div>';
  }
  html += '</div>';

  html += '<div class="pj-items">';
  if (!phItems.length) html += '<div class="pj-empty-line">暂无交付物，可添加（可选）</div>';
  phItems.forEach(function(it) {
    html += '<div class="pj-item' + (it.done ? ' done' : '') + '">';
    html += '<button class="pj-item-check' + (it.done ? ' on' : '') + '" onclick="event.stopPropagation();App.project.togglePhaseItem(\'' + it.id + '\',\'' + id + '\',' + sel + ',' + (!it.done) + ')">' + (it.done ? '✓' : '') + '</button>';
    html += '<span class="pj-item-title">' + esc(it.title) + '</span>';
    html += '<button class="pj-item-del" onclick="event.stopPropagation();App.project.deletePhaseItem(\'' + it.id + '\',\'' + id + '\',' + sel + ')">✕</button>';
    html += '</div>';
  });
  html += '</div>';
  html += '<div class="pj-item-add"><input id="pjItemInput" placeholder="添加交付物…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();App.project.addPhaseItem(\'' + id + '\',' + sel + ')}"><button onclick="App.project.addPhaseItem(\'' + id + '\',' + sel + ')">＋</button></div>';

  // 本阶段已挂的采购/记账明细
  var _phLedger = (p.ledger || []).filter(function(x) { return x.phaseIdx === sel; });
  if (_phLedger.length) {
    html += '<div class="pj-ledger"><div class="pj-ledger-title">💸 本阶段明细 <span>' + _phLedger.length + ' 笔</span></div>';
    _phLedger.forEach(function(x) {
      var _fn = x.kind === 'purchase' ? 'openDetailModal' : 'openExpenseModal';
      html += '<div class="pj-ledger-row" onclick="event.stopPropagation();closeProjectDetail();' + _fn + '(\'' + x.id + '\')">'
        + '<span class="pj-ledger-ico">' + (x.kind === 'purchase' ? '🛒' : '💰') + '</span>'
        + '<span class="pj-ledger-name">' + esc(x.title || (x.kind === 'purchase' ? '采购' : '记账')) + '</span>'
        + '<span class="pj-ledger-amt">' + pjMoney(x.amount) + '</span>'
        + '</div>';
    });
    html += '</div>';
  }
  html += '<div class="pj-quick-actions">'
    + '<button onclick="App.project.quickAddPurchase(\'' + id + '\',' + sel + ')">🛒 记一笔采购</button>'
    + '<button onclick="App.project.quickAddExpense(\'' + id + '\',' + sel + ')">💰 记一笔账</button>'
    + '</div>';

  html += '<div class="pj-phase-actions">';
  if (phStatus === 'todo') html += '<button class="pj-pa pj-pa-ok" onclick="App.project.setPhase(\'' + id + '\',' + sel + ',\'doing\')">▶ 开始本阶段</button>';
  if (phStatus !== 'done') html += '<button class="pj-pa pj-pa-ok" onclick="App.project.setPhase(\'' + id + '\',' + sel + ',\'done\')">✓ 完成本阶段</button>';
  if (phStatus !== 'skipped' && sel !== 5) html += '<button class="pj-pa" onclick="App.project.setPhase(\'' + id + '\',' + sel + ',\'skipped\')">⏭ 跳过</button>';
  if (sel === 5 && phStatus !== 'done') {
    var _pendingPrev = [];
    for (var _pi = 0; _pi < 5; _pi++) {
      var _ps = (phases[_pi] && phases[_pi].status) || 'todo';
      if (_ps !== 'done' && _ps !== 'skipped') _pendingPrev.push('P' + _pi);
    }
    html += '<div class="pj-p5-hint">' + (_pendingPrev.length
      ? '🔒 通关前需先完成或跳过 ' + _pendingPrev.join('、')
      : '🔒 P5 是最终阶段，完成本阶段后项目通关') + '</div>';
  }
  if (phStatus !== 'todo') html += '<button class="pj-pa" onclick="App.project.setPhase(\'' + id + '\',' + sel + ',\'todo\')">↩ 回退</button>';
  html += '</div>';
  html += '</div>';

  // 关联待办
  var linkedTodos = (typeof todoList !== 'undefined' ? todoList : []).filter(function(t) { return t.projectId === id; });
  html += '<div class="pj-sec-title">☑ 关联待办 <span class="td3-n">' + linkedTodos.length + '</span></div>';
  if (!linkedTodos.length) {
    html += '<div class="pj-empty-line">暂无关联待办</div>';
  } else {
    linkedTodos.forEach(function(t) {
      var tDone = t.status === '已完成';
      html += '<div class="pj-todo' + (tDone ? ' pj-todo-done' : '') + '" onclick="closeProjectDetail();openTodoDetail(\'' + t.id + '\')">';
      html += '<span class="pj-todo-dot" style="background:' + (tDone ? 'var(--green)' : 'var(--orange)') + '"></span>';
      html += '<span class="pj-todo-title">' + esc(t.title) + '</span>';
      html += '<span class="pj-todo-status">' + t.status + '</span>';
      html += '</div>';
    });
  }

  var buyTotal = Number(spend.buy) || 0, expTotal = Number(spend.exp) || 0;
  html += '<div class="pj-spend-card">';
  html += '<div class="pj-spend-row"><span>🛒 采购</span><b>' + pjMoney(buyTotal) + '</b></div>';
  html += '<div class="pj-spend-row"><span>💰 记账</span><b>' + pjMoney(expTotal) + '</b></div>';
  html += '<div class="pj-spend-row pj-spend-total"><span>本项目总花费</span><b>' + pjMoney(buyTotal + expTotal) + '</b></div>';
  html += '</div>';

  html += '<div class="pj-actions-grid">';
  html += '<button class="pj-act" onclick="closeProjectDetail();openTodoModalForProject(\'' + id + '\')"><span>☑</span>新建待办</button>';
  html += '<button class="pj-act" onclick="closeProjectDetail();openProjectModal(\'' + id + '\')"><span>✏️</span>编辑项目</button>';
  if (p.status === '已完成') html += '<button class="pj-act" onclick="App.project.archiveProject(\'' + id + '\')"><span>🗄️</span>归档</button>';
  html += '<button class="pj-act pj-act-danger" onclick="deleteProject(\'' + id + '\')"><span>🗑️</span>删除</button>';
  html += '</div>';

  document.getElementById('projectDetailBody').innerHTML = html;
  overlay.classList.add('active');
}

function closeProjectDetail() {
  document.getElementById('projectDetailOverlay').classList.remove('active');
}

async function refreshProjectUI(id, phaseIdx) {
  await loadProjects();
  renderProject();
  if (phaseIdx !== undefined) selectedPhase[id] = phaseIdx;
  var dO = document.getElementById('projectDetailOverlay');
  if (dO && dO.classList.contains('active')) openProjectDetail(id);
}

// 采购/记账写入后刷新项目花费；失败不影响主流程
async function refreshProjectsAfterLinkedMoney() {
  if (typeof loadProjects !== 'function') return;
  try {
    await loadProjects();
    if (typeof currentTab !== 'undefined' && currentTab === 'project' && typeof renderProject === 'function') renderProject();
  } catch (e) {}
}

// ===== 从项目直接记钱 =====
function quickAddPurchase(projectId, phaseIdx) {
  closeProjectDetail();
  openModal(projectId, phaseIdx);
  toast('已关联到该项目，填写后保存即可');
}
function quickAddExpense(projectId, phaseIdx) {
  closeProjectDetail();
  openExpenseModal(null, projectId, phaseIdx);
  toast('已关联到该项目，填写后保存即可');
}

// ===== 阶段交互 =====
function selectPhase(projectId, idx) {
  selectedPhase[projectId] = idx;
  openProjectDetail(projectId);
}

async function setPhase(projectId, idx, status) {
  if (status === 'skipped' && idx === 5) { toast('P5 是最终阶段，必须完成，不能跳过'); return; }
  if (status === 'skipped' && !confirm('跳过 P' + idx + '？\n跳过不参与进度分母，可随时回退')) return;
  if (status === 'done' && idx === 5) {
    var _p = projectList.find(function(x) { return x.id === projectId; });
    var _phs = (_p && _p.phases) || [];
    var _pending = [];
    for (var _i = 0; _i < 5; _i++) {
      var _s = (_phs[_i] && _phs[_i].status) || 'todo';
      if (_s !== 'done' && _s !== 'skipped') _pending.push('P' + _i);
    }
    if (_pending.length) { toast('请先完成或跳过 ' + _pending.join('、')); return; }
  }
  if (status === 'done' && !confirm(idx === 5
    ? '完成 P5？\n项目将自动通关，可归档。'
    : '完成 P' + idx + '？\n下一阶段会自动开始。')) return;
  try {
    var r = await phaseApi({ projectId: projectId, phaseIdx: idx, status: status });
    var msg = status === 'done'
      ? (idx === 5 ? '🏁 项目已通关' : '✅ 阶段完成' + (r && r.currentPhase != null ? '，P' + r.currentPhase + ' 已开始' : ''))
      : status === 'skipped' ? '⏭ 已跳过'
      : status === 'doing' ? '▶ 阶段已开始'
      : '↩ 已回退';
    toast(msg);
    var nextSel = (status === 'done' || status === 'skipped') && r && r.currentPhase != null ? r.currentPhase : idx;
    await refreshProjectUI(projectId, nextSel);
  } catch (e) {
    toast('操作失败: ' + pjErrorText(e));
  }
}

async function savePhasePlan(projectId, idx) {
  var sEl = document.getElementById('pjPlanStart');
  var eEl = document.getElementById('pjPlanEnd');
  var ss = sEl ? sEl.value : '';
  var ee = eEl ? eEl.value : '';
  if (ss && ee && ee < ss) { toast('完成日期不能早于开始日期'); return; }
  try {
    await phaseApi({
      projectId: projectId, phaseIdx: idx,
      plannedStart: ss ? new Date(ss + 'T00:00:00').toISOString() : null,
      plannedEnd: ee ? new Date(ee + 'T23:59:59.999').toISOString() : null
    });
    toast('📅 规划时间已保存');
    await refreshProjectUI(projectId, idx);
  } catch (e) {
    toast('保存失败: ' + pjErrorText(e));
  }
}

async function renamePhase(projectId, idx) {
  var p = projectList.find(function(x) { return x.id === projectId; });
  var ph = (p && p.phases && p.phases[idx]) || {};
  var v = prompt('P' + idx + ' 的显示名（留空恢复默认）', ph.name && ph.name !== 'P' + idx ? ph.name : '');
  if (v === null) return;
  try {
    await phaseApi({ projectId: projectId, phaseIdx: idx, displayName: v.trim() });
    toast(v.trim() ? '已改名为「' + v.trim() + '」' : '已恢复默认名');
    await refreshProjectUI(projectId, idx);
  } catch (e) {
    toast('改名失败: ' + pjErrorText(e));
  }
}

// ===== 交付物 =====
async function addPhaseItem(projectId, idx) {
  var inp = document.getElementById('pjItemInput');
  var title = inp ? inp.value.trim() : '';
  if (!title) { toast('请输入交付物名称'); return; }
  try {
    await phaseItemApi('POST', { projectId: projectId, phaseIdx: idx, title: title });
    if (inp) inp.value = '';
    await refreshProjectUI(projectId, idx);
  } catch (e) {
    toast('添加失败: ' + pjErrorText(e));
  }
}
async function togglePhaseItem(itemId, projectId, idx, done) {
  try {
    await phaseItemApi('PUT', { id: itemId, done: done });
    await refreshProjectUI(projectId, idx);
  } catch (e) {
    toast('更新交付物失败: ' + pjErrorText(e));
  }
}
async function deletePhaseItem(itemId, projectId, idx) {
  if (!confirm('删除该交付物？')) return;
  try {
    await phaseItemApi('DELETE', null, itemId);
    toast('已删除交付物');
    await refreshProjectUI(projectId, idx);
  } catch (e) {
    toast('删除失败: ' + pjErrorText(e));
  }
}

// ===== Todo 联动 =====
function openTodoModalForProject(projectId) {
  window._pendingProjectId = projectId;
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

function getProjectOptions() {
  var html = '<option value="">无</option>';
  projectList.filter(function(p) { return p.status !== '已归档'; }).forEach(function(p) {
    html += '<option value="' + p.id + '">📁 ' + esc(p.name) + '</option>';
  });
  return html;
}

// 采购/记账表单：项目 + 阶段联动下拉
function fillProjectPhaseSelects(projSelId, phaseSelId, projId, phaseIdx) {
  var ps = document.getElementById(projSelId);
  if (!ps) return;
  ps.innerHTML = getProjectOptions();
  ps.value = projId || '';
  var fs = document.getElementById(phaseSelId);
  if (!fs) return;
  function rebuild() {
    var pid = ps.value;
    var p = projectList.find(function(x) { return x.id === pid; });
    var html = '<option value="">不指定阶段</option>';
    if (p && p.phases) {
      p.phases.forEach(function(ph) {
        html += '<option value="' + ph.idx + '">P' + ph.idx + (ph.name && ph.name !== 'P' + ph.idx ? ' · ' + esc(ph.name) : '') + '</option>';
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
  selectPhase: selectPhase,
  setPhase: setPhase,
  renamePhase: renamePhase,
  renderProjColors: renderProjColors,
  pickColor: pickColor,
  savePhasePlan: savePhasePlan,
  quickAddPurchase: quickAddPurchase,
  quickAddExpense: quickAddExpense,
  addPhaseItem: addPhaseItem,
  togglePhaseItem: togglePhaseItem,
  deletePhaseItem: deletePhaseItem,
  getProjectOptions: getProjectOptions,
  fillProjectPhaseSelects: fillProjectPhaseSelects,
};
