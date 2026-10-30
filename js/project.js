// project.js - 项目模块（阶段 / 账本；待办挂在阶段里）
var projectList = [];
var projectFilter = "全部";
var selectedPhase = {}; // projectId -> phaseIdx
var projectDetailTab = 'phases'; // phases | money
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
// 仍在使用的步骤：状态不是 skipped 的槽位（“未使用”的末尾槽位不算）
function pjActivePhaseIdxs(p) {
  var out = [];
  ((p && p.phases) || []).forEach(function(ph, i) {
    if (ph && (ph.status || 'todo') !== 'skipped') out.push(Number(ph.idx != null ? ph.idx : i));
  });
  return out.sort(function(a, b) { return a - b; });
}
// 自动补足、从未命名、且被标记为 skipped 的槽位 → 显示在“未使用”里
function pjIsUnusedPhase(ph, idx) {
  return !!ph && ph.status === 'skipped' && !pjPhaseName(ph, idx);
}
// 记账/采购默认步骤：当前指针若已停用，则落到第一个未完成的在用步骤
function pjDefaultPhase(p) {
  var active = pjActivePhaseIdxs(p);
  if (!active.length) return 0;
  var sel = selectedPhase[p.id];
  if (sel !== undefined && sel !== null && active.indexOf(Number(sel)) >= 0) return Number(sel);
  var cur = Number(p.currentPhase) || 0;
  if (active.indexOf(cur) >= 0) return cur;
  var phases = p.phases || [];
  for (var j = 0; j < active.length; j++) {
    var st = (phases[active[j]] || {}).status;
    if (st !== 'done' && st !== 'skipped') return active[j];
  }
  return active[0];
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
// 某一步里的待办：phaseIdx 精确匹配；未挂阶段的历史待办不计入步骤
function pjPhaseTodos(p, idx) {
  return pjLinkedTodos(p).filter(function(t) {
    return Number(t.phaseIdx) === Number(idx);
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

  var h = '<div class="pj2-card' + (isDone ? ' pj2-dim' : '') + '" style="--pc:' + escAttr(color) + '" onclick="openProjectDetail(\'' + p.id + '\')">';
  h += '<div class="pj2-card-top">';
  h += '<span class="pj2-dot" style="background:' + escAttr(color) + '"></span>';
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

  h += '<div class="pj2-progress"><div class="bar"><i style="width:' + st.pct + '%;background:' + (st.pct >= 100 ? 'var(--green)' : escAttr(color)) + '"></i></div><span class="num">' + st.done + '/' + st.denom + ' 步</span></div>';
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

// ===== 步骤规划：自然语言 → 结构（可编辑预览）=====
var _pjStructuredSteps = []; // [{name, budget}]，新建时由 AI 拆解或手动维护

function pjRenderStepsPreview() {
  var box = document.getElementById('pjStepsPreview');
  if (!box) return;
  if (!_pjStructuredSteps.length) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = '';
  var html = '<div class="pj-steps-head"><span>已整理成 ' + _pjStructuredSteps.length + ' 步（可改）</span></div>';
  _pjStructuredSteps.forEach(function(s, i) {
    var b = s.budget == null ? '' : s.budget;
    html += '<div class="pjf-step-row">'
      + '<span class="pjf-step-idx">' + (i + 1) + '</span>'
      + '<input class="pjf-input" maxlength="50" placeholder="步骤名称" data-pj-step-i="' + i + '" data-pj-step-k="name" value="' + escAttr(s.name || '') + '" oninput="App.project.stepField(this)">'
      + '<input class="pjf-input pjf-step-budget" type="number" step="1" min="0" placeholder="预算" data-pj-step-i="' + i + '" data-pj-step-k="budget" value="' + escAttr(b) + '" oninput="App.project.stepField(this)">'
      + '<button type="button" class="pjf-step-del" title="删除" onclick="App.project.removeStepRow(' + i + ')">×</button>'
      + '</div>';
  });
  html += '<div class="pjf-step-actions">'
    + '<button type="button" class="btn btn-secondary pjf-step-btn" onclick="App.project.addStepRow()">＋ 加一步</button>'
    + '<button type="button" class="btn btn-secondary pjf-step-btn" onclick="App.project.clearSteps()">清空步骤</button>'
    + '</div>';
  box.innerHTML = html;
}

function pjStepField(inp) {
  var i = Number(inp.getAttribute('data-pj-step-i'));
  var k = inp.getAttribute('data-pj-step-k');
  if (!_pjStructuredSteps[i]) return;
  if (k === 'budget') {
    var v = inp.value.trim();
    _pjStructuredSteps[i].budget = v === '' ? null : Number(v);
    if (!isFinite(_pjStructuredSteps[i].budget) || _pjStructuredSteps[i].budget < 0) _pjStructuredSteps[i].budget = null;
  } else {
    _pjStructuredSteps[i].name = inp.value;
  }
}

function pjAddStepRow() {
  if (_pjStructuredSteps.length >= 6) { toast('最多 6 步'); return; }
  _pjStructuredSteps.push({ name: '', budget: null });
  pjRenderStepsPreview();
}

function pjRemoveStepRow(i) {
  _pjStructuredSteps.splice(i, 1);
  pjRenderStepsPreview();
}

function pjClearSteps() {
  _pjStructuredSteps = [];
  pjRenderStepsPreview();
  var el = document.getElementById('projectSteps');
  if (el) el.value = '';
}

async function pjParseSteps(opts) {
  opts = opts || {};
  var btn = document.getElementById('pjParseStepsBtn');
  var raw = (document.getElementById('projectSteps') || {}).value || '';
  raw = raw.trim();
  var name = (document.getElementById('projectName') || {}).value || '';
  if (!raw) { if (!opts.silent) toast('先写一段规划描述，再点 AI 拆解'); return null; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 拆解中…'; }
  try {
    var res = await aiRequest('parse-steps', { text: raw, projectName: name.trim() });
    if (!res || !res.ok || !res.data || !Array.isArray(res.data.steps) || !res.data.steps.length) {
      throw new Error((res && res.error) || '没能拆出步骤');
    }
    _pjStructuredSteps = res.data.steps.slice(0, 6).map(function(s) {
      return {
        name: String(s.name || '').trim().slice(0, 50),
        budget: (s.budget == null || s.budget === '' || !isFinite(Number(s.budget)) || Number(s.budget) < 0) ? null : Number(s.budget),
      };
    }).filter(function(s) { return !!s.name; });
    if (!_pjStructuredSteps.length) throw new Error('没能拆出步骤');
    pjRenderStepsPreview();
    if (!opts.silent) toast('已拆成 ' + _pjStructuredSteps.length + ' 步，可改后保存');
    return _pjStructuredSteps.slice();
  } catch (e) {
    if (!opts.silent) toast('拆解失败: ' + pjErrorText(e));
    throw e;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 AI 拆成步骤'; }
  }
}

function pjCollectSteps() {
  // 以预览输入框当前值为准
  var out = [];
  _pjStructuredSteps.forEach(function(s, i) {
    var nameEl = document.querySelector('[data-pj-step-i="' + i + '"][data-pj-step-k="name"]');
    var budgetEl = document.querySelector('[data-pj-step-i="' + i + '"][data-pj-step-k="budget"]');
    var name = String((nameEl ? nameEl.value : s.name) || '').trim().slice(0, 50);
    var budget = null;
    if (budgetEl && budgetEl.value.trim() !== '') {
      budget = Number(budgetEl.value.trim());
      if (!isFinite(budget) || budget < 0) budget = null;
    }
    if (name) out.push({ name: name, budget: budget });
  });
  return out.slice(0, 6);
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
  var _stepsGroup = document.getElementById('projectStepsGroup');
  if (_stepsGroup) _stepsGroup.style.display = p ? 'none' : '';
  var _stepsEl = document.getElementById('projectSteps');
  if (_stepsEl) _stepsEl.value = '';
  _pjStructuredSteps = [];
  pjRenderStepsPreview();
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
  _pjReopenTab = 'phases';
}

var _pjReopenAfterEdit = null;
var _pjReopenTab = 'phases';

async function saveProject() {
  var id = document.getElementById('projectId').value;
  var name = document.getElementById('projectName').value.trim();
  if (!name) { toast('请输入项目名称'); return; }
  var editing = !!id;
  var reopenId = _pjReopenAfterEdit;
  var reopenTab = _pjReopenTab || 'phases';

  // 步骤：优先用预览里的结构化结果；只写了自然语言则先 AI 拆成结构，拆不动不让静默丢掉。
  var steps = [];
  if (!editing) {
    steps = pjCollectSteps();
    if (!steps.length) {
      var stepsEl = document.getElementById('projectSteps');
      var raw = stepsEl ? stepsEl.value.trim() : '';
      if (raw) {
        try {
          await pjParseSteps({ silent: true });
          steps = pjCollectSteps();
        } catch (e) {
          toast('步骤规划还没整理成结构。请点「AI 拆成步骤」，或手动加一步、清空规划描述后再保存');
          return;
        }
        if (!steps.length) { toast('步骤规划里没有有效步骤，请检查名称'); return; }
      }
    }
    if (steps.length > 6) { toast('最多规划 6 步'); return; }
  }

  var data = {
    name: name,
    description: document.getElementById('projectDesc').value.trim(),
    dueDate: (function() { var v = document.getElementById('projectDueDate').value; return v ? new Date(v).toISOString() : null; })(),
    status: document.getElementById('projectStatus').value,
    color: document.getElementById('projectColor').value,
    budget: (function() { var el = document.getElementById('projectBudget'); var v = el ? el.value.trim() : ''; return v === '' ? null : Number(v); })(),
  };
  if (editing) data.id = id;
  else if (steps.length) data.steps = steps.map(function(s) { return { name: s.name, budget: s.budget }; });
  try {
    var r = editing ? await projectApi('PUT', data) : await projectApi('POST', data);
    if (!editing && !(r && r.ok && r.id)) throw new Error('服务端未返回项目 ID');
    _pjReopenAfterEdit = null;
    _pjReopenTab = 'phases';
    closeProjectModal();
    toast(editing ? '✅ 已更新' : (steps.length ? '✅ 已创建，规划了 ' + steps.length + ' 步' : '✅ 项目已创建'));
    await loadProjects();
    renderProject();
    if (!editing && r && r.id) {
      projectDetailTab = 'phases';
      selectedPhase[r.id] = 0;
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
  if (!confirm('确定删除该项目？\n阶段会一并删除；关联的采购/记账金额保留、待办保留并解除项目关联。')) return;
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
  if (_pjDetailId !== id && !opts.keepTab) projectDetailTab = 'phases';
  _pjDetailId = id;
  if (selectedPhase[id] === undefined) selectedPhase[id] = pjDefaultPhase(p);
  else if (selectedPhase[id] >= 0 && pjActivePhaseIdxs(p).indexOf(selectedPhase[id]) < 0) selectedPhase[id] = pjDefaultPhase(p);
  if (['phases', 'money'].indexOf(projectDetailTab) < 0) projectDetailTab = 'phases';

  var st = pjPhaseStats(p);
  var color = p.color || '#6366f1';
  var spend = p.spend || { buy: 0, exp: 0, phases: {} };
  var openTodos = pjOpenTodos(p).length;
  var totalSpend = (Number(spend.buy) || 0) + (Number(spend.exp) || 0);

  var html = '';
  html += '<div class="pj2-sheet-head">';
  html += '<div class="pj2-sheet-name"><span class="pj2-dot" style="background:' + escAttr(color) + '"></span><span class="pj2-name-text">' + esc(p.name) + '</span></div>';
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
  html += '<button class="pj2-tab' + (projectDetailTab === 'phases' ? ' active' : '') + '" onclick="App.project.setTab(\'phases\')">阶段<em>' + st.done + '/' + st.denom + (openTodos ? ' · ☑' + openTodos : '') + '</em></button>';
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
  if (['phases', 'money'].indexOf(tab) < 0) tab = 'phases';
  projectDetailTab = tab;
  if (_pjDetailId) openProjectDetail(_pjDetailId);
}

function renderProjectTabContent(p, tab) {
  if (tab === 'money') return renderProjectMoneyTab(p);
  return renderProjectPhasesTab(p);
}

function renderProjectTodoRow(t, projectId, done) {
  var meta = [];
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
  var active = pjActivePhaseIdxs(p);
  var sel = selectedPhase[id];
  if (sel === undefined || sel === null || sel < -1 || sel > 5) sel = pjDefaultPhase(p);
  else if (sel >= 0 && active.indexOf(sel) < 0) sel = pjDefaultPhase(p);

  var html = '<div class="pj2-phase-hint">待办挂在每一步里；完成本步会自动勾掉该步未完成的待办。第 1 步和第 6 步必须完成，中间步骤可跳过；未使用的空槽不占进度。</div>';
  html += '<div class="pj2-timeline">';
  for (var i = 0; i < 6; i++) {
    var ph = phases[i] || { idx: i, name: 'P' + i, status: 'todo' };
    if (pjIsUnusedPhase(ph, i)) continue;
    var st = ph.status || 'todo';
    var expanded = (i === sel);
    var phSpendMap = (p.spend && p.spend.phases && p.spend.phases[i]) || {};
    var phSpend = (Number(phSpendMap.buy) || 0) + (Number(phSpendMap.exp) || 0);
    var phBudget = (ph.budget == null) ? null : Number(ph.budget);
    var planned = pjPlanRange(ph);
    var phOpen = pjPhaseTodos(p, i).filter(function(t) { return t.status !== '已完成'; }).length;

    html += '<div class="pj2-step ' + st + (expanded ? ' expanded' : '') + '">';
    html += '<button class="pj2-step-head" aria-expanded="' + (expanded ? 'true' : 'false') + '" onclick="App.project.selectPhase(\'' + id + '\',' + i + ')">';
    html += '<span class="pj2-step-idx">' + (st === 'done' ? '✓' : st === 'skipped' ? '⏭' : (i + 1)) + '</span>';
    html += '<span class="pj2-step-main"><span class="pj2-step-name">' + pjStepTitleHtml(ph, i) + (i === cur ? '<i class="pj2-cur">当前</i>' : '') + (phOpen ? '<i class="pj2-cur todo">☑' + phOpen + '</i>' : '') + '</span>';
    html += '<span class="pj2-step-sub">' + pjPhaseStatusText(st)
      + (planned ? ' · 📅 ' + planned : '')
      + ((phSpend || phBudget != null) ? ' · 💰 ' + pjMoney(phSpend) + (phBudget != null ? '/' + pjMoney(phBudget) : '') : '')
      + '</span></span>';
    html += '<span class="pj2-chev' + (expanded ? ' open' : '') + '">›</span>';
    html += '</button>';
    if (expanded) html += renderPhaseBody(p, i, ph);
    html += '</div>';
  }
  html += '</div>';

  var unused = [];
  for (var j = 0; j < 6; j++) {
    if (pjIsUnusedPhase(phases[j], j)) unused.push(j);
  }
  if (unused.length) {
    html += '<div class="pj2-unused">';
    html += '<div class="pj2-unused-title">未使用的步骤 <span>' + unused.length + '</span></div>';
    html += '<div class="pj2-unused-hint">最后一步固定在第 6 步，中间空位标记为未使用、不占进度；需要时再启用。</div>';
    unused.forEach(function(k) {
      html += '<div class="pj2-unused-row"><span>第' + (k + 1) + '步 · 未使用</span>'
        + '<button onclick="App.project.setPhase(\'' + id + '\',' + k + ',\'todo\')">启用</button></div>';
    });
    html += '</div>';
  }

  if (p.description) html += '<div class="pj2-note"><b>项目备注</b><span>' + esc(p.description) + '</span></div>';
  html += '<div class="pj2-manage">';
  html += '<button onclick="App.project.editFromDetail(\'' + id + '\')">✏️ 编辑项目</button>';
  if (p.status === '已完成') html += '<button onclick="App.project.archiveProject(\'' + id + '\')">🗄️ 归档</button>';
  html += '<button class="danger" onclick="App.project.deleteProject(\'' + id + '\')">删除项目</button>';
  html += '</div>';
  return html;
}

function renderPhaseBody(p, idx, ph) {
  var id = p.id;
  var st = ph.status || 'todo';
  var nameVal = pjPhaseName(ph, idx);
  var spendMap = (p.spend && p.spend.phases && p.spend.phases[idx]) || {};
  var phSpend = (Number(spendMap.buy) || 0) + (Number(spendMap.exp) || 0);
  var phBudget = (ph.budget == null) ? null : Number(ph.budget);
  var phLedger = (p.ledger || []).filter(function(x) { return x.phaseIdx === idx; });

  var html = '<div class="pj2-step-body">';

  // 名称 + 预算 + 计划时间：一个保存按钮全部写入，时间精确到分钟
  html += '<div class="pj2-editor">';
  html += '<label class="pj2-editor-label">这一步叫什么</label>';
  html += '<input class="pj2-editor-input" id="pjPhaseName" maxlength="50" value="' + esc(nameVal) + '" placeholder="例如：订票 / 客户资料（可选）">';
  html += '<div class="pj2-editor-sub">本步预算（可选，与项目总预算独立）</div>';
  html += '<div class="pj2-plan-row"><span class="pj2-plan-label">预算</span>'
    + '<input type="number" id="pjPhaseBudget" step="0.01" min="0" value="' + (phBudget == null ? '' : phBudget) + '" placeholder="例如：800"></div>';
  if (phBudget != null || phSpend > 0) {
    var overCls = (phBudget != null && phSpend > phBudget) ? ' style="color:var(--red)"' : '';
    html += '<div class="pj2-editor-hint"' + overCls + '>已花 ' + pjMoney(phSpend)
      + (phBudget != null ? ' / 预算 ' + pjMoney(phBudget)
        + (phBudget > 0 ? '（' + Math.min(Math.round(phSpend / phBudget * 100), 999) + '%）' : '')
        : '')
      + '</div>';
  }
  html += '<div class="pj2-editor-sub">计划时间（可精确到分钟）</div>'
    + '<div class="pj2-plan-row"><span class="pj2-plan-label">开始</span>'
    + '<input type="datetime-local" id="pjPlanStart" value="' + pjDateTimeInput(ph.plannedStart) + '"></div>'
    + '<div class="pj2-plan-row"><span class="pj2-plan-label">结束</span>'
    + '<input type="datetime-local" id="pjPlanEnd" value="' + pjDateTimeInput(ph.plannedEnd) + '"></div>';
  var actual = [];
  if (ph.startedAt) actual.push('开始 ' + pjDateTimeShort(ph.startedAt));
  if (ph.finishedAt) actual.push((st === 'skipped' ? '跳过 ' : '完成 ') + pjDateTimeShort(ph.finishedAt));
  html += '<div class="pj2-editor-hint">' + (actual.length ? '实际：' + actual.join(' · ') : '可留空；开始/完成时会自动记录实际时间') + '</div>';
  html += '<button class="pj2-save pj2-save-block" onclick="App.project.savePhasePlan(\'' + id + '\',' + idx + ')">保存名称、预算与计划</button>';
  html += '</div>';

  // 本步待办：与全局待办同一份数据，勾选互相同步
  var todosHere = pjPhaseTodos(p, idx);
  var openHere = todosHere.filter(function(t) { return t.status !== '已完成'; });
  var doneHere = todosHere.filter(function(t) { return t.status === '已完成'; });
  html += '<div class="pj2-block-title">本步待办 <span>' + openHere.length + '/' + (openHere.length + doneHere.length) + '</span></div>';
  html += '<div class="pj2-quick"><input id="pjQuickTodo_' + idx + '" maxlength="200" placeholder="这一步要做的事…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();App.project.quickAddTodo(\'' + id + '\',' + idx + ')}"><button onclick="App.project.quickAddTodo(\'' + id + '\',' + idx + ')">添加</button></div>';
  html += '<div class="pj2-quick-opts">'
    + '<label>分类<select id="pjQuickCat_' + idx + '" onchange="App.project.rememberTodoCategory(this.value)">' + pjCategoryOptions(pjLastTodoCategory()) + '</select></label>'
    + '<button class="pj2-quick-more" onclick="App.project.openTodoModalForProject(\'' + id + '\',' + idx + ')">更多</button>'
    + '</div>';
  if (!openHere.length && !doneHere.length) {
    html += '<div class="pj2-emptybox"><div class="ico">☑</div><div class="t">这一步还没有待办</div><div class="s">加一件最想推进的事；完成本步会自动勾掉它们</div></div>';
  }
  openHere.forEach(function(t) { html += renderProjectTodoRow(t, id, false); });
  if (doneHere.length) {
    html += '<div class="pj2-subhead">已完成 <span>' + doneHere.length + '</span></div>';
    doneHere.forEach(function(t) { html += renderProjectTodoRow(t, id, true); });
  }

  // 本步花费：逐笔显示明细
  if (phSpend > 0 || phLedger.length || phBudget != null) {
    html += '<div class="pj2-block-title">本步花费 <span>' + pjMoney(phSpend)
      + (phBudget != null ? ' / ' + pjMoney(phBudget) : '')
      + '</span></div>';
    phLedger.forEach(function(x) { html += renderLedgerMiniRow(x); });
    if (phLedger.length) html += '<button class="pj2-see-all" onclick="App.project.setTab(\'money\')">到账本查看 ' + phLedger.length + ' 笔明细</button>';
  }

  html += '<div class="pj2-money-actions">'
    + '<button onclick="App.project.quickAddPurchase(\'' + id + '\',' + idx + ')">🛒 记采购</button>'
    + '<button onclick="App.project.quickAddExpense(\'' + id + '\',' + idx + ')">💰 记账</button>'
    + '</div>';

  // 状态操作：第 1 步和第 6 步必须完成，中间步骤可跳过
  html += '<div class="pj2-step-actions">';
  var canSkip = idx !== 0 && idx !== 5;
  if (st === 'todo') {
    html += '<button class="pj2-action ghost" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'doing\')">开始</button>';
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
  if (idx === 5 && st !== 'done' && st !== 'skipped') {
    var pending = [];
    pjActivePhaseIdxs(p).forEach(function(i) {
      if (i === 5) return;
      var _aph = (p.phases || [])[i];
      var s = (_aph && _aph.status) || 'todo';
      if (s !== 'done') pending.push('第' + (i + 1) + '步');
    });
    html += '<div class="pj2-p5-hint">' + (pending.length
      ? '🔒 通关前需先完成 ' + pending.join('、')
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

  // 每步预算对照：只列仍在使用的步骤
  var activePhases = pjActivePhaseIdxs(p);
  var phaseBudgetRows = [];
  activePhases.forEach(function(i) {
    var ph = (p.phases || [])[i] || {};
    var pb = (ph.budget == null) ? null : Number(ph.budget);
    var psMap = (spend.phases && spend.phases[i]) || {};
    var ps = (Number(psMap.buy) || 0) + (Number(psMap.exp) || 0);
    if (pb == null && !(ps > 0)) return;
    phaseBudgetRows.push({ i: i, ph: ph, spend: ps, budget: pb });
  });
  if (phaseBudgetRows.length) {
    html += '<div class="pj2-subhead">分步预算 <span>' + phaseBudgetRows.length + '</span></div>';
    phaseBudgetRows.forEach(function(row) {
      var pctTxt = '';
      var over = false;
      if (row.budget != null && row.budget > 0) {
        var pct = Math.min(Math.round(row.spend / row.budget * 100), 999);
        pctTxt = ' · ' + pct + '%';
        over = row.spend > row.budget;
      }
      html += '<div class="pj2-ledger" onclick="App.project.jumpToPhaseBudget(\'' + id + '\',' + row.i + ')">'
        + '<span class="ico">📍</span>'
        + '<div class="main"><div class="name">' + esc(pjStepTitle(row.ph, row.i)) + '</div>'
        + '<div class="meta">已花 ' + pjMoney(row.spend)
        + (row.budget != null ? ' / 预算 ' + pjMoney(row.budget) + pctTxt : ' · 未设本步预算')
        + (over ? ' · 超支' : '')
        + '</div></div>'
        + '<span class="pj2-chev">›</span>'
        + '</div>';
    });
  }

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
  // 阶段完成/跳过会批量勾待办，本地 todoList 必须重拉，否则步骤里仍显示未完成
  try {
    if (typeof loadTodos === 'function') await loadTodos();
    if (typeof currentTab !== 'undefined' && currentTab === 'todo' && typeof renderTodo === 'function') renderTodo();
  } catch (e) {}
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

function rememberTodoCategory(v) {
  if (v) pjRememberTodoCategory(v);
}

async function pjCreateProjectTodo(projectId, title, category, inputEl, focusId, phaseIdx) {
  title = (title || '').trim();
  if (!title) { pjFocus(inputEl); toast('请输入待办内容'); return; }
  if (typeof todoList === 'undefined') return;
  category = category || pjLastTodoCategory();
  pjRememberTodoCategory(category);
  var pidx = (phaseIdx === null || phaseIdx === undefined || phaseIdx === '') ? null : Number(phaseIdx);
  if (pidx != null && !Number.isInteger(pidx)) pidx = null;
  var tmp = {
    id: 'tmpPJ_' + Date.now(), title: title, status: '待办', priority: '中',
    category: category, repeat: '无', projectId: projectId, phaseIdx: pidx, subtasks: '[]', tags: '[]'
  };
  todoList.unshift(tmp);
  if (inputEl) inputEl.value = '';
  renderProject();
  if (_pjDetailId === projectId) pjRerenderDetail(projectId);
  var r;
  try {
    r = await todoApi('POST', {
      title: title, priority: '中', category: category, repeat: '无',
      projectId: projectId, phaseIdx: pidx, status: '待办'
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

async function quickAddTodo(projectId, phaseIdx) {
  var pidx = (phaseIdx === null || phaseIdx === undefined) ? selectedPhase[projectId] : phaseIdx;
  if (pidx == null || pidx < 0) pidx = pjDefaultPhase(projectList.find(function(x) { return x.id === projectId; }) || {});
  var inp = document.getElementById('pjQuickTodo_' + pidx);
  var catEl = document.getElementById('pjQuickCat_' + pidx);
  await pjCreateProjectTodo(
    projectId,
    inp ? inp.value : '',
    catEl ? catEl.value : pjLastTodoCategory(),
    inp,
    'pjQuickTodo_' + pidx,
    pidx
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
  var p = projectList.find(function(x) { return x.id === projectId; });
  var phases = (p && p.phases) || [];
  var ph = phases[idx] || {};
  var oldStatus = ph.status || 'todo';
  if (status === 'skipped') {
    if (idx === 0) { toast('第 1 步必须完成，不能跳过'); return; }
    if (idx === 5) { toast('第 6 步必须完成，不能跳过'); return; }
    if (!confirm('跳过第 ' + (idx + 1) + ' 步？\n该步未完成的待办会一并完成；之后可在同一位置恢复步骤（待办不会自动恢复）。')) return;
  }
  if (status === 'done' && idx === 5) {
    var pending = [];
    pjActivePhaseIdxs(p).forEach(function(i) {
      if (i === 5) return;
      var s = (phases[i] && phases[i].status) || 'todo';
      if (s !== 'done') pending.push('第' + (i + 1) + '步');
    });
    if (pending.length) { toast('请先完成 ' + pending.join('、')); return; }
    if (!confirm('完成第 ' + (idx + 1) + ' 步？\n项目将自动通关，可归档。')) return;
  }
  if (status === 'done' && idx !== 5) {
    var _openN = pjPhaseTodos(p, idx).filter(function(t) { return t.status !== '已完成'; }).length;
    if (_openN && !confirm('完成第 ' + (idx + 1) + ' 步？\n该步还有 ' + _openN + ' 条未完成待办，会一并勾为已完成。')) return;
  }
  try {
    var r = await phaseApi({ projectId: projectId, phaseIdx: idx, status: status });
    var nextIdx = (status === 'done' || status === 'skipped') && r && r.currentPhase != null ? Number(r.currentPhase) : idx;
    var msg;
    if (status === 'done') {
      if (r && r.projectStatus === '已完成') msg = '🏁 项目已通关';
      else if (nextIdx !== idx && nextIdx >= 0 && nextIdx <= 5) {
        var np = (p && p.phases) || [];
        msg = '✅ 已完成，下一步：' + (np[nextIdx] ? pjStepTitle(np[nextIdx], nextIdx) : ('第' + (nextIdx + 1) + '步'));
      } else msg = '✅ 已完成';
    } else if (status === 'skipped') msg = '⏭ 已跳过';
    else if (status === 'doing') msg = '▶ 这一步已开始';
    else if (oldStatus === 'done') msg = '↩ 已撤销完成';
    else if (oldStatus === 'skipped') msg = '↩ 已恢复这一步';
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
  var bEl = document.getElementById('pjPhaseBudget');
  var ss = sEl ? sEl.value : '';
  var ee = eEl ? eEl.value : '';
  if (ss && ee && new Date(ee).getTime() < new Date(ss).getTime()) { toast('完成时间不能早于开始时间'); return; }
  var phaseBudget = null;
  if (bEl) {
    var bv = bEl.value.trim();
    if (bv !== '') {
      phaseBudget = Number(bv);
      if (!isFinite(phaseBudget) || phaseBudget < 0) { toast('预算请填 0 或正数，或留空'); return; }
    }
  }
  var body = {
    projectId: projectId, phaseIdx: idx,
    plannedStart: ss ? new Date(ss).toISOString() : null,
    plannedEnd: ee ? new Date(ee).toISOString() : null
  };
  if (nEl) body.displayName = nEl.value.trim().slice(0, 50);
  if (bEl) body.budget = phaseBudget;
  try {
    await phaseApi(body);
    toast('✅ 已保存');
    await refreshProjectUI(projectId, idx);
  } catch (e) {
    toast('保存失败: ' + pjErrorText(e));
  }
}

// 账本里点分步预算 → 跳到阶段页并展开该步
function jumpToPhaseBudget(projectId, idx) {
  selectedPhase[projectId] = idx;
  projectDetailTab = 'phases';
  openProjectDetail(projectId);
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
  window._pendingProjectId = projectId;
  window._pendingPhaseIdx = (phaseIdx === null || phaseIdx === undefined) ? null : Number(phaseIdx);
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
        // 未使用的空槽位不出现在记账/采购的步骤选项里；编辑旧记录时保留已选中的项
        if (pjIsUnusedPhase(ph, ph.idx) && String(ph.idx) !== String(phaseIdx)) return;
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
  parseSteps: pjParseSteps,
  addStepRow: pjAddStepRow,
  removeStepRow: pjRemoveStepRow,
  clearSteps: pjClearSteps,
  stepField: pjStepField,
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
  jumpToPhaseBudget: jumpToPhaseBudget,
  quickAddPurchase: quickAddPurchase,
  quickAddExpense: quickAddExpense,
  quickAddTodo: quickAddTodo,
  rememberTodoCategory: rememberTodoCategory,
  toggleTodo: toggleProjectTodo,
  openTodoModalForProject: openTodoModalForProject,
  getProjectOptions: getProjectOptions,
  fillProjectPhaseSelects: fillProjectPhaseSelects,
};
