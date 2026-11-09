// project.js - 项目模块（阶段 / 账本；待办挂在阶段里）
var projectList = [];
var projectFilter = "全部";
var selectedPhase = {}; // projectId -> phaseIdx
var projectDetailTab = 'phases'; // phases | money
var _pjDetailId = null;
var _pjSettingsOpen = {}; // "projectId:phaseIdx" -> true（本步设置折叠态）

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

// 步骤逾期：计划结束时间已过且未完成/跳过（仅进行中项目）
function pjIsOverduePhase(p, ph, idx) {
  if (!p || !ph) return false;
  if (p.status !== '进行中') return false;
  var st = ph.status || 'todo';
  if (st === 'done' || st === 'skipped') return false;
  if (ph.plannedEnd == null) return false;
  return Date.now() > Number(ph.plannedEnd);
}
// 统一：逾期 N 天（不足一天也算第 1 天）
function pjOverdueLabel(ms) {
  var d = Math.max(1, Math.ceil((Date.now() - Number(ms)) / 86400000));
  return '逾期 ' + d + ' 天';
}
function pjOverduePhases(p) {
  var out = [];
  if (!p || p.status !== '进行中') return out;
  (p.phases || []).forEach(function(ph, i) {
    if (pjIsOverduePhase(p, ph, i)) out.push({ idx: Number(ph.idx != null ? ph.idx : i), phase: ph, endMs: Number(ph.plannedEnd) });
  });
  return out.sort(function(a, b) { return a.endMs - b.endMs; });
}
// 预算水位：超支 over / ≥80% warn / 正常 ok / 未设 null
function pjBudgetLevel(spend, budget) {
  var b = budget == null ? null : Number(budget);
  if (b == null || !isFinite(b) || b <= 0) return null;
  var s = Number(spend) || 0;
  if (s > b) return 'over';
  if (s / b >= 0.8) return 'warn';
  return 'ok';
}
function pjDayStart(ms) {
  var d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function pjIsToday(ms) {
  if (ms == null) return false;
  var n = pjDayStart(Date.now());
  var t = pjDayStart(Number(ms));
  return t >= n && t < n + 86400000;
}
function pjIsOverdueTodo(t) {
  if (!t || t.status === '已完成' || t.status === '已删除' || t.status === '已取消') return false;
  if (t.dueDate == null) return false;
  return Date.now() > Number(t.dueDate) && !pjIsToday(t.dueDate);
}

// 今日推进：逾期步骤 → 今日到期待办 → 当前步未完成待办（进行中项目）
function pjFocusItems() {
  var out = [];
  projectList.forEach(function(p) {
    if (!p || p.status !== '进行中') return;
    pjOverduePhases(p).forEach(function(o) {
      out.push({
        kind: 'overdue',
        projectId: p.id,
        phaseIdx: o.idx,
        projectName: p.name,
        color: p.color || '#6366f1',
        text: pjStepTitle(o.phase, o.idx) + ' · ' + pjOverdueLabel(o.endMs),
        rank: 0,
      });
    });
    pjLinkedTodos(p).forEach(function(t) {
      if (t.status === '已完成' || t.status === '已删除' || t.status === '已取消') return;
      if (t.dueDate == null) return;
      if (pjIsToday(t.dueDate)) {
        out.push({
          kind: 'todo-today',
          projectId: p.id,
          phaseIdx: (t.phaseIdx == null || t.phaseIdx === '') ? null : Number(t.phaseIdx),
          todoId: t.id,
          projectName: p.name,
          color: p.color || '#6366f1',
          text: t.title,
          rank: 1,
        });
      } else if (pjIsOverdueTodo(t)) {
        out.push({
          kind: 'todo-late',
          projectId: p.id,
          phaseIdx: (t.phaseIdx == null || t.phaseIdx === '') ? null : Number(t.phaseIdx),
          todoId: t.id,
          projectName: p.name,
          color: p.color || '#6366f1',
          text: t.title + ' · 已过期',
          rank: 0.5,
        });
      }
    });
    var phases = p.phases || [];
    var cur = Number(p.currentPhase) || 0;
    var cph = phases[cur];
    if (cph && (cph.status === 'doing' || cph.status === 'todo')) {
      var open = pjPhaseTodos(p, cur).filter(function(t) {
        return t.status !== '已完成' && t.status !== '已删除' && t.status !== '已取消' && t.dueDate == null;
      });
      if (open.length) {
        out.push({
          kind: 'phase-open',
          projectId: p.id,
          phaseIdx: cur,
          projectName: p.name,
          color: p.color || '#6366f1',
          text: pjStepTitle(cph, cur) + ' · ' + open[0].title,
          rank: 2,
        });
      }
    }
  });
  out.sort(function(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return String(b.projectId).localeCompare(String(a.projectId), undefined, { numeric: true });
  });
  var seen = {};
  var dedup = [];
  out.forEach(function(x) {
    var k = (x.kind === 'todo-today' || x.kind === 'todo-late') ? ('t:' + x.todoId) : (x.projectId + ':' + (x.phaseIdx == null ? '' : x.phaseIdx));
    if (seen[k]) return;
    seen[k] = 1;
    dedup.push(x);
  });
  return dedup.slice(0, 8);
}

function pjOpenFocus(projectId, phaseIdx, todoId) {
  if (phaseIdx != null && !isNaN(Number(phaseIdx))) selectedPhase[projectId] = Number(phaseIdx);
  projectDetailTab = 'phases';
  openProjectDetail(projectId);
  if (todoId && typeof openTodoDetail === 'function') {
    try { openTodoDetail(todoId); } catch (e) {}
  }
}

function pjSortProjects(arr) {
  return arr.slice().sort(function(a, b) {
    function rank(p) {
      if (p.status !== '进行中') return 3;
      if (pjOverduePhases(p).length) return 0;
      if (pjIsToday(p.dueDate) || (p.dueDate && Date.now() > Number(p.dueDate))) return 1;
      if (p.dueDate) return 2;
      return 3;
    }
    var ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    var ad = a.dueDate ? Number(a.dueDate) : null;
    var bd = b.dueDate ? Number(b.dueDate) : null;
    if (ad && bd && ad !== bd) return ad - bd;
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return String(b.id).localeCompare(String(a.id), undefined, { numeric: true });
  });
}

function pjRenderFocusBar() {
  if (projectFilter !== '全部' && projectFilter !== '进行中') return '';
  var items = pjFocusItems();
  if (!items.length) return '';
  var html = '<div class="pj2-focus">';
  html += '<div class="pj2-focus-head"><span>今日推进</span><b>' + items.length + '</b></div>';
  items.forEach(function(x) {
    var badge = x.kind === 'overdue' ? '逾期' : x.kind === 'todo-today' ? '今天' : x.kind === 'todo-late' ? '过期' : '当前';
    var cls = (x.kind === 'overdue' || x.kind === 'todo-late') ? ' late' : (x.kind === 'todo-today' ? ' today' : '');
    html += '<button type="button" class="pj2-focus-item' + cls + '" '
      + 'onclick="App.project.openFocus(\'' + x.projectId + '\',' + (x.phaseIdx == null ? 'null' : x.phaseIdx) + ',' + (x.todoId ? '\'' + x.todoId + '\'' : 'null') + ')">'
      + '<span class="pj2-focus-dot" style="background:' + escAttr(x.color) + '"></span>'
      + '<span class="pj2-focus-badge' + cls + '">' + badge + '</span>'
      + '<span class="pj2-focus-main"><span class="pj2-focus-proj">' + esc(x.projectName) + '</span>'
      + '<span class="pj2-focus-text">' + esc(x.text) + '</span></span>'
      + '<span class="pj2-focus-chev">›</span>'
      + '</button>';
  });
  html += '</div>';
  return html;
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
    var selected = projectFilter === x[0];
    html += '<button type="button" class="pj2-filter' + (selected ? ' active' : '') + '" aria-pressed="' + selected + '" onclick="projectFilter=\'' + x[0] + '\';renderProject()">' + x[0] + '<b>' + x[1] + '</b></button>';
  });
  html += '</div>';

  html += pjRenderFocusBar();

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

  var isLive = !isDone && p.status === '进行中';
  var h = '<article class="pj2-card' + (isDone ? ' pj2-dim' : '') + (isLive ? ' now' : '') + '" style="--pc:' + escAttr(color) + '" role="button" tabindex="0" aria-label="打开项目 ' + escAttr(p.name) + '" onclick="openProjectDetail(\'' + p.id + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openProjectDetail(\'' + p.id + '\')}">';
  h += '<div class="pj2-card-top">';
  h += '<span class="pj2-dot' + (isLive ? ' live' : '') + '" style="background:' + escAttr(color) + '"></span>';
  h += '<div class="pj2-card-name">' + esc(p.name) + '</div>';
  h += '<span class="pj2-state ' + stateCls + '">' + p.status + '</span>';
  h += '</div>';

  h += '<div class="pj2-next' + (isLive ? ' live' : '') + '"><span class="pj2-next-label' + (isLive ? ' live' : '') + '">' + next.label + '</span><span class="pj2-next-text">' + esc(next.text) + '</span></div>';

  var overdue = pjOverduePhases(p);
  var budgetLv = pjBudgetLevel(spend, p.budget);
  h += '<div class="pj2-meta">';
  h += '<span>' + esc(pjStepTitle(cph, cur)) + ' · ' + pjPhaseStatusText(cph.status) + '</span>';
  h += pjDueHtml(p.dueDate, p.status);
  if (spend > 0) h += '<span>💰 ' + pjMoney(spend) + '</span>';
  if (openTodos > 0) h += '<span>☑ ' + openTodos + ' 待办</span>';
  if (overdue.length) {
    h += '<span class="pj2-tag late">逾期 ' + overdue.length + ' 步</span>';
  }
  if (budgetLv === 'over') h += '<span class="pj2-tag over">超预算</span>';
  else if (budgetLv === 'warn') h += '<span class="pj2-tag warn">预算 ' + Math.round((Number(spend) / Number(p.budget)) * 100) + '%</span>';
  h += '</div>';

  h += '<div class="pj2-progress"><div class="bar"><i style="width:' + st.pct + '%;background:' + (st.pct >= 100 ? 'var(--green)' : escAttr(color)) + '"></i></div><span class="num">' + st.done + '/' + st.denom + ' 步</span></div>';
  h += '</article>';
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
var _pjStructuredSteps = []; // [{name, budget, plannedDays}]，新建时由 AI 拆解或手动维护

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
    var d = s.plannedDays == null ? '' : s.plannedDays;
    html += '<div class="pjf-step-row">'
      + '<span class="pjf-step-idx">' + (i + 1) + '</span>'
      + '<input class="pjf-input" maxlength="50" placeholder="步骤名称" data-pj-step-i="' + i + '" data-pj-step-k="name" value="' + escAttr(s.name || '') + '" oninput="App.project.stepField(this)">'
      + '<input class="pjf-input pjf-step-budget" type="number" step="1" min="0" placeholder="预算" data-pj-step-i="' + i + '" data-pj-step-k="budget" value="' + escAttr(b) + '" oninput="App.project.stepField(this)">'
      + '<input class="pjf-input pjf-step-days" type="number" step="1" min="1" max="30" placeholder="天" title="计划天数" data-pj-step-i="' + i + '" data-pj-step-k="plannedDays" value="' + escAttr(d) + '" oninput="App.project.stepField(this)">'
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
    pjUpdateBudgetSumWarn();
  } else if (k === 'plannedDays') {
    var dv = inp.value.trim();
    _pjStructuredSteps[i].plannedDays = dv === '' ? null : Math.round(Number(dv));
    if (!isFinite(_pjStructuredSteps[i].plannedDays) || _pjStructuredSteps[i].plannedDays < 1) _pjStructuredSteps[i].plannedDays = null;
    else if (_pjStructuredSteps[i].plannedDays > 30) _pjStructuredSteps[i].plannedDays = 30;
  } else {
    _pjStructuredSteps[i].name = inp.value;
  }
}

// ===== C2：分步预算合计 vs 总预算 =====
function pjSumStepBudgets(steps) {
  var sum = 0, n = 0;
  (steps || []).forEach(function(s) {
    if (s && s.budget != null && isFinite(Number(s.budget)) && Number(s.budget) > 0) {
      sum += Number(s.budget);
      n++;
    }
  });
  return { sum: sum, n: n };
}
function pjSumPhaseBudgets(p) {
  var sum = 0, n = 0;
  pjActivePhaseIdxs(p).forEach(function(i) {
    var ph = ((p && p.phases) || [])[i] || {};
    var b = ph.budget == null ? null : Number(ph.budget);
    if (b != null && isFinite(b) && b > 0) { sum += b; n++; }
  });
  return { sum: sum, n: n };
}
function pjReadTotalBudgetInput() {
  var el = document.getElementById('projectBudget');
  if (!el) return null;
  var v = el.value.trim();
  if (v === '') return null;
  var n = Number(v);
  if (!isFinite(n) || n < 0) return null;
  return n;
}
function pjUpdateBudgetSumWarn() {
  var box = document.getElementById('pjBudgetSumWarn');
  if (!box) return;
  var steps = pjCollectSteps();
  var st = pjSumStepBudgets(steps);
  var total = pjReadTotalBudgetInput();
  if (!st.n || total == null || total <= 0) {
    box.style.display = 'none';
    box.hidden = true;
    box.textContent = '';
    box.className = 'pjf-budget-sum';
    return;
  }
  box.hidden = false;
  box.style.display = '';
  if (st.sum > total) {
    box.className = 'pjf-budget-sum warn';
    box.textContent = '⚠️ 分步预算合计 ' + pjMoney(st.sum) + ' 超过总预算 ' + pjMoney(total) + '（超出 ' + pjMoney(st.sum - total) + '）';
  } else {
    box.className = 'pjf-budget-sum ok';
    box.textContent = '分步预算合计 ' + pjMoney(st.sum) + ' / 总预算 ' + pjMoney(total) + '（剩 ' + pjMoney(total - st.sum) + '）';
  }
}
// 新建保存前：合计超总预算 → 二次确认（不阻断）
function pjConfirmStepBudgetOver(steps, total) {
  if (total == null || total <= 0) return true;
  var st = pjSumStepBudgets(steps);
  if (!st.n || st.sum <= total) return true;
  return confirm('分步预算合计 ' + pjMoney(st.sum) + ' 超过总预算 ' + pjMoney(total) + '。\n仍要保存吗？');
}

function pjAddStepRow() {
  if (_pjStructuredSteps.length >= 6) { toast('最多 6 步'); return; }
  _pjStructuredSteps.push({ name: '', budget: null, plannedDays: null });
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
      var pd = s.plannedDays;
      if (pd == null || pd === '' || !isFinite(Number(pd)) || Number(pd) < 1) pd = null;
      else pd = Math.min(30, Math.max(1, Math.round(Number(pd))));
      return {
        name: String(s.name || '').trim().slice(0, 50),
        budget: (s.budget == null || s.budget === '' || !isFinite(Number(s.budget)) || Number(s.budget) < 0) ? null : Number(s.budget),
        plannedDays: pd,
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
    var daysEl = document.querySelector('[data-pj-step-i="' + i + '"][data-pj-step-k="plannedDays"]');
    var name = String((nameEl ? nameEl.value : s.name) || '').trim().slice(0, 50);
    var budget = null;
    if (budgetEl && budgetEl.value.trim() !== '') {
      budget = Number(budgetEl.value.trim());
      if (!isFinite(budget) || budget < 0) budget = null;
    }
    var plannedDays = null;
    if (daysEl && daysEl.value.trim() !== '') {
      plannedDays = Math.round(Number(daysEl.value.trim()));
      if (!isFinite(plannedDays) || plannedDays < 1) plannedDays = null;
      else if (plannedDays > 30) plannedDays = 30;
    } else if (s.plannedDays != null) {
      plannedDays = s.plannedDays;
    }
    if (name) out.push({ name: name, budget: budget, plannedDays: plannedDays });
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
  pjUpdateBudgetSumWarn();
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
  if (!editing && steps.length && !pjConfirmStepBudgetOver(steps, data.budget)) return;
  if (editing) data.id = id;
  else if (steps.length) data.steps = steps.map(function(s) {
    return { name: s.name, budget: s.budget, plannedDays: s.plannedDays };
  });
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

  // v3.0.13 加 now-pill 时漏了 cur 声明 → ReferenceError，点卡片无反应
  var cur = Number(p.currentPhase) || 0;
  var _cph = (p.phases || [])[cur] || {};
  var _live = p.status === '进行中';
  html += '<div class="pj2-summary">';
  html += '<span class="pj2-state ' + (p.status === '已完成' ? 'done' : p.status === '已归档' ? 'arch' : 'act') + '">' + p.status + '</span>';
  if (_live) html += '<span class="pj2-pill now-pill">▶ 当前 · ' + esc(pjStepTitle(_cph, cur)) + '</span>';
  html += '<span class="pj2-pill">' + st.done + '/' + st.denom + ' 步</span>';
  if (openTodos) html += '<span class="pj2-pill">待办 ' + openTodos + '</span>';
  html += '<span class="pj2-pill money">' + pjMoney(totalSpend) + '</span>';
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

// ---- C3：通关总结页 ----
function pjClearDays(p) {
  var starts = [], ends = [];
  (p.phases || []).forEach(function(ph) {
    if (ph.startedAt) starts.push(Number(ph.startedAt));
    if (ph.finishedAt) ends.push(Number(ph.finishedAt));
  });
  if (!ends.length) return null;
  var end = Math.max.apply(null, ends);
  // 没有真实开始时间就不算用时（截止日期是目标完成日，不是开始日）
  if (!starts.length) return { days: null, endMs: end };
  var start = Math.min.apply(null, starts);
  if (!(end > start)) return { days: null, endMs: end };
  var days = Math.max(1, Math.ceil((end - start) / 86400000));
  return { days: days, endMs: end };
}
function renderClearSummary(p) {
  if (p.status !== '已完成') return '';
  var st = pjPhaseStats(p);
  var spend = p.spend || { buy: 0, exp: 0, phases: {} };
  var buy = Number(spend.buy) || 0;
  var exp = Number(spend.exp) || 0;
  var total = buy + exp;
  var budget = (p.budget == null) ? null : Number(p.budget);
  var todos = pjLinkedTodos(p);
  var todoDone = todos.filter(function(t) { return t.status === '已完成'; }).length;
  var dur = pjClearDays(p);
  var phaseSum = pjSumPhaseBudgets(p);

  var html = '<div class="pj2-clear">';
  html += '<div class="pj2-clear-head"><span class="pj2-clear-flag">🏁</span><div><b>通关总结</b><span>' + esc(p.name) + '</span></div></div>';
  html += '<div class="pj2-clear-grid">';
  html += '<div class="pj2-clear-cell"><span>步骤</span><b>' + st.done + ' 完成</b>' + (st.skipped ? '<em>' + st.skipped + ' 跳过</em>' : '') + '</div>';
  html += '<div class="pj2-clear-cell"><span>花费</span><b>' + pjMoney(total) + '</b>'
    + (budget != null && budget > 0
      ? '<em class="' + (total > budget ? 'over' : 'ok') + '">' + (total > budget ? '超 ' + pjMoney(total - budget) : '剩 ' + pjMoney(budget - total)) + ' / 预算 ' + pjMoney(budget) + '</em>'
      : '<em>未设总预算</em>') + '</div>';
  html += '<div class="pj2-clear-cell"><span>采购 / 记账</span><b>' + pjMoney(buy) + ' + ' + pjMoney(exp) + '</b></div>';
  if (phaseSum.n > 0) {
    html += '<div class="pj2-clear-cell"><span>分步预算</span><b>' + pjMoney(phaseSum.sum) + '</b>'
      + (budget != null && budget > 0 && phaseSum.sum > budget
        ? '<em class="over">超总预算 ' + pjMoney(phaseSum.sum - budget) + '</em>'
        : '<em>' + phaseSum.n + ' 步已设</em>') + '</div>';
  }
  if (todos.length) {
    html += '<div class="pj2-clear-cell"><span>待办</span><b>' + todoDone + '/' + todos.length + '</b><em>' + (todos.length - todoDone) + ' 条未勾</em></div>';
  }
  if (dur && dur.days) {
    html += '<div class="pj2-clear-cell"><span>用时</span><b>' + dur.days + ' 天</b><em>完成于 ' + pjDateShort(dur.endMs) + '</em></div>';
  } else if (dur && dur.endMs) {
    html += '<div class="pj2-clear-cell"><span>完成</span><b>' + pjDateShort(dur.endMs) + '</b></div>';
  }
  html += '</div>';

  // 分步一览
  var rows = [];
  pjActivePhaseIdxs(p).forEach(function(i) {
    var ph = (p.phases || [])[i] || {};
    var psMap = (spend.phases && spend.phases[i]) || {};
    var ps = (Number(psMap.buy) || 0) + (Number(psMap.exp) || 0);
    var pb = ph.budget == null ? null : Number(ph.budget);
    rows.push({ i: i, ph: ph, spend: ps, budget: pb, status: ph.status || 'todo' });
  });
  if (rows.length) {
    html += '<div class="pj2-clear-steps">';
    rows.forEach(function(r) {
      var mark = r.status === 'done' ? '✓' : r.status === 'skipped' ? '⏭' : '·';
      html += '<div class="pj2-clear-step"><span class="m">' + mark + '</span>'
        + '<span class="n">' + pjStepTitleHtml(r.ph, r.i) + '</span>'
        + '<span class="v">' + pjMoney(r.spend) + (r.budget != null ? '/' + pjMoney(r.budget) : '') + '</span></div>';
    });
    html += '</div>';
  }

  html += '<div class="pj2-clear-actions">'
    + '<button class="pj-btn pj-btn-secondary" type="button" onclick="App.project.setTab(\'money\')">看账本</button>'
    + '<button class="pj-btn pj-btn-secondary" type="button" onclick="App.project.archiveProject(\'' + p.id + '\')">🗄️ 归档</button>'
    + '</div>';
  html += '</div>';
  return html;
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

  var html = renderClearSummary(p);
  if (p.status !== '已完成') html += '<div class="pj2-hint-one">待办挂在每一步；完成本步会勾掉未完成待办</div>';
  else html += '<div class="pj2-hint-one">项目已通关；下面保留各步记录，可归档</div>';
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

    var isCur = (i === cur && p.status !== '已完成' && p.status !== '已归档');
    var phOverdue = pjIsOverduePhase(p, ph, i);
    var phBudLv = pjBudgetLevel(phSpend, phBudget);
    html += '<div class="pj2-step ' + st + (expanded ? ' expanded' : '') + (isCur ? ' is-current' : '') + (phOverdue ? ' is-overdue' : '') + '">';
    html += '<button class="pj2-step-head" aria-expanded="' + (expanded ? 'true' : 'false') + '" onclick="App.project.selectPhase(\'' + id + '\',' + i + ')">';
    html += '<span class="pj2-step-idx">' + (st === 'done' ? '✓' : st === 'skipped' ? '⏭' : (i + 1)) + '</span>';
    html += '<span class="pj2-step-main"><span class="pj2-step-name">' + pjStepTitleHtml(ph, i) + (isCur ? '<i class="pj2-cur live">当前</i>' : '') + (phOpen ? '<i class="pj2-cur todo">☑' + phOpen + '</i>' : '') + (phOverdue ? '<i class="pj2-cur late">' + pjOverdueLabel(ph.plannedEnd) + '</i>' : '') + '</span>';
    html += '<span class="pj2-step-sub">' + pjPhaseStatusText(st)
      + (planned ? ' · 📅 ' + planned : '')
      + ((phSpend || phBudget != null) ? ' · 💰 ' + pjMoney(phSpend) + (phBudget != null ? '/' + pjMoney(phBudget) : '') : '')
      + ((phBudLv === 'over' || phBudLv === 'warn') ? '<em class="pj2-tag ' + (phBudLv === 'over' ? 'over' : 'warn') + '">' + (phBudLv === 'over' ? '超预算' : '预算紧张') + '</em>' : '')
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

function pjSettingsKey(projectId, idx) {
  return projectId + ':' + idx;
}

function togglePhaseSettings(projectId, idx) {
  var k = pjSettingsKey(projectId, idx);
  _pjSettingsOpen[k] = !_pjSettingsOpen[k];
  pjRerenderDetail(projectId);
}

function renderPhaseBody(p, idx, ph) {
  var id = p.id;
  var st = ph.status || 'todo';
  var nameVal = pjPhaseName(ph, idx);
  var spendMap = (p.spend && p.spend.phases && p.spend.phases[idx]) || {};
  var phSpend = (Number(spendMap.buy) || 0) + (Number(spendMap.exp) || 0);
  var phBudget = (ph.budget == null) ? null : Number(ph.budget);
  var phBudLv = pjBudgetLevel(phSpend, phBudget);
  var phLedger = (p.ledger || []).filter(function(x) { return x.phaseIdx === idx; });
  var settingsOpen = !!_pjSettingsOpen[pjSettingsKey(id, idx)];
  var hasCustom = !!(ph.displayName || phBudget != null || ph.plannedStart || ph.plannedEnd);

  var html = '<div class="pj2-step-body">';

  // 1) 待办（主任务）
  var todosHere = pjPhaseTodos(p, idx);
  var openHere = todosHere.filter(function(t) { return t.status !== '已完成'; });
  var doneHere = todosHere.filter(function(t) { return t.status === '已完成'; });
  html += '<div class="pj2-sec">本步待办 <span>' + openHere.length + '/' + (openHere.length + doneHere.length) + '</span></div>';
  html += '<div class="pj2-quick">'
    + '<input id="pjQuickTodo_' + idx + '" maxlength="200" placeholder="要做的事…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();App.project.quickAddTodo(\'' + id + '\',' + idx + ')}">'
    + '<button class="pj-btn pj-btn-primary pj-btn-inline" onclick="App.project.quickAddTodo(\'' + id + '\',' + idx + ')">添加</button>'
    + '</div>';
  html += '<div class="pj2-quick-sub">'
    + '<span>分类：' + esc(pjLastTodoCategory() || '其他') + '</span>'
    + '<button type="button" onclick="App.project.openTodoModalForProject(\'' + id + '\',' + idx + ')">更多设置</button>'
    + '</div>';
  if (!openHere.length && !doneHere.length) {
    html += '<div class="pj2-emptybox"><div class="ico">☑</div><div class="t">这一步还没有待办</div><div class="s">加一件最想推进的事</div></div>';
  }
  openHere.forEach(function(t) { html += renderProjectTodoRow(t, id, false); });
  if (doneHere.length) {
    html += '<div class="pj2-subhead">已完成 <span>' + doneHere.length + '</span></div>';
    doneHere.forEach(function(t) { html += renderProjectTodoRow(t, id, true); });
  }

  // 2) 花费
  html += '<div class="pj2-sec">本步花费</div>';
  html += '<div class="pj2-budget-line' + (phBudLv ? ' ' + phBudLv : '') + '">';
  html += '<div class="pj2-budget-text"><b>' + pjMoney(phSpend) + '</b>';
  if (phBudget != null) html += ' <span>/ 预算 ' + pjMoney(phBudget)
    + (phBudget > 0 ? '（' + Math.min(Math.round(phSpend / phBudget * 100), 999) + '%）' : '')
    + '</span>';
  else html += ' <span>未设本步预算</span>';
  html += '</div>';
  if (phBudget != null && phBudget > 0) {
    var pct = Math.min(Math.round(phSpend / phBudget * 100), 100);
    var barC = phSpend > phBudget ? 'var(--red)' : pct > 80 ? 'var(--orange)' : 'var(--green)';
    html += '<div class="pj2-budget-bar"><i style="width:' + pct + '%;background:' + barC + '"></i></div>';
  }
  html += '</div>';
  phLedger.forEach(function(x) { html += renderLedgerMiniRow(x); });
  if (phLedger.length) html += '<button class="pj2-see-all" type="button" onclick="App.project.setTab(\'money\')">到账本查看 ' + phLedger.length + ' 笔明细</button>';
  html += '<div class="pj2-money-actions">'
    + '<button class="pj-btn pj-btn-secondary" type="button" onclick="App.project.quickAddPurchase(\'' + id + '\',' + idx + ')">记采购</button>'
    + '<button class="pj-btn pj-btn-secondary" type="button" onclick="App.project.quickAddExpense(\'' + id + '\',' + idx + ')">记账</button>'
    + '</div>';

  // 3) 操作
  html += '<div class="pj2-sec">推进这一步</div>';
  html += '<div class="pj2-step-actions">';
  var canSkip = idx !== 0 && idx !== 5;
  if (st === 'todo') {
    html += '<button class="pj-btn pj-btn-secondary" type="button" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'doing\')">开始</button>';
    html += '<button class="pj-btn pj-btn-done" type="button" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'done\')">完成这一步</button>';
    if (canSkip) html += '<button class="pj-btn pj-btn-ghost" type="button" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'skipped\')">跳过</button>';
  } else if (st === 'doing') {
    html += '<button class="pj-btn pj-btn-done" type="button" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'done\')">完成这一步</button>';
    if (canSkip) html += '<button class="pj-btn pj-btn-ghost" type="button" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'skipped\')">跳过</button>';
  } else if (st === 'done') {
    html += '<button class="pj-btn pj-btn-ghost" type="button" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'todo\')">撤销完成</button>';
  } else if (st === 'skipped') {
    html += '<button class="pj-btn pj-btn-ghost" type="button" onclick="App.project.setPhase(\'' + id + '\',' + idx + ',\'todo\')">恢复这一步</button>';
  }
  html += '</div>';
  html += '<div class="pj2-ai-next">';
  html += '<button class="pj-btn pj-btn-ghost pj2-ai-next-btn" type="button" onclick="App.project.suggestNext(\'' + id + '\',' + idx + ')">✨ AI 建议下一步</button>';
  var sugKey = id + ':' + idx;
  var sug = _pjSuggestions[sugKey];
  if (sug && sug.length) {
    html += '<div class="pj2-ai-next-list">';
    sug.forEach(function(s, si) {
      html += '<button type="button" class="pj2-ai-next-item" onclick="App.project.suggestToTodo(\'' + id + '\',' + idx + ',' + si + ')">'
        + '<b>' + esc(s.title) + '</b>'
        + (s.detail ? '<span>' + esc(s.detail) + '</span>' : '')
        + '<i>加入待办</i>'
        + '</button>';
    });
    html += '</div>';
  }
  html += '</div>';
  if (!canSkip && st !== 'done' && st !== 'skipped') {
    html += '<div class="pj2-p5-hint">' + (idx === 0 ? '第 1 步' : '第 6 步') + '必须完成，不能跳过</div>';
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
      ? '通关前需先完成 ' + pending.join('、')
      : '完成这一步后项目自动通关') + '</div>';
  }

  // 4) 本步设置（默认折叠）
  html += '<div class="pj2-sec pj2-settings-head">'
    + '<button type="button" class="pj2-settings-toggle" onclick="App.project.togglePhaseSettings(\'' + id + '\',' + idx + ')" aria-expanded="' + (settingsOpen ? 'true' : 'false') + '">'
    + '<span>本步设置</span>'
    + (hasCustom ? '<i class="pj2-settings-tag">已自定义</i>' : '<i class="pj2-settings-tag muted">名称 · 预算 · 时间</i>')
    + '<span class="pj2-chev' + (settingsOpen ? ' open' : '') + '">›</span>'
    + '</button>'
    + '</div>';
  if (settingsOpen) {
    html += '<div class="pj2-settings">';
    html += '<div class="pj-form-field"><label class="pj-form-label" for="pjPhaseName">步骤名称</label>'
      + '<input class="pj-form-input" id="pjPhaseName" maxlength="50" value="' + esc(nameVal) + '" placeholder="例如：订票 / 聚餐"></div>';
    html += '<div class="pj-form-field"><label class="pj-form-label" for="pjPhaseBudget">本步预算（可选）</label>'
      + '<input class="pj-form-input" type="number" id="pjPhaseBudget" step="0.01" min="0" value="' + (phBudget == null ? '' : phBudget) + '" placeholder="例如：800"></div>';
    html += '<div class="pj-form-row">'
      + '<div class="pj-form-field"><label class="pj-form-label" for="pjPlanStart">开始时间</label>'
      + '<input class="pj-form-input" type="datetime-local" id="pjPlanStart" value="' + pjDateTimeInput(ph.plannedStart) + '"></div>'
      + '<div class="pj-form-field"><label class="pj-form-label" for="pjPlanEnd">结束时间</label>'
      + '<input class="pj-form-input" type="datetime-local" id="pjPlanEnd" value="' + pjDateTimeInput(ph.plannedEnd) + '"></div>'
      + '</div>';
    var actual = [];
    if (ph.startedAt) actual.push('开始 ' + pjDateTimeShort(ph.startedAt));
    if (ph.finishedAt) actual.push((st === 'skipped' ? '跳过 ' : '完成 ') + pjDateTimeShort(ph.finishedAt));
    html += '<div class="pj-form-hint">' + (actual.length ? '实际：' + actual.join(' · ') : '时间可留空；开始/完成时会自动记录') + '</div>';
    html += '<button class="pj-btn pj-btn-primary" type="button" onclick="App.project.savePhasePlan(\'' + id + '\',' + idx + ')">保存</button>';
    html += '</div>';
  }

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

  // C2：分步预算合计 vs 总预算
  var _psum = pjSumPhaseBudgets(p);
  if (_psum.n > 0) {
    if (budget != null && budget > 0) {
      if (_psum.sum > budget) {
        html += '<div class="pj2-budget-sum warn">⚠️ 分步预算合计 ' + pjMoney(_psum.sum) + ' 超过总预算 ' + pjMoney(budget) + '（超出 ' + pjMoney(_psum.sum - budget) + '）</div>';
      } else {
        html += '<div class="pj2-budget-sum">分步预算合计 ' + pjMoney(_psum.sum) + ' / 总预算 ' + pjMoney(budget) + '（剩 ' + pjMoney(budget - _psum.sum) + '）</div>';
      }
    } else {
      html += '<div class="pj2-budget-sum muted">分步预算合计 ' + pjMoney(_psum.sum) + '（未设总预算）</div>';
    }
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
    + '<button class="pj-btn pj-btn-secondary" type="button" onclick="App.project.quickAddPurchase(\'' + id + '\',' + defPhase + ')">记一笔采购</button>'
    + '<button class="pj-btn pj-btn-secondary" type="button" onclick="App.project.quickAddExpense(\'' + id + '\',' + defPhase + ')">记一笔账</button>'
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
  // 提交中防双击；乐观插入，但 DOM 里的 id 必须在拿到服务端 id 后重绘一次
  if (inputEl) inputEl.disabled = true;
  var tmp = {
    id: 'tmpPJ_' + Date.now(), title: title, status: '待办', priority: '中',
    category: category, repeat: '无', projectId: projectId, phaseIdx: pidx, subtasks: '[]', tags: '[]'
  };
  todoList.unshift(tmp);
  window._pjPendingTodoTitle = title;
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
    else throw new Error('服务端未返回 id');
  } catch (e) {
    // 只有保存失败才回滚；保存成功后的界面刷新错误不能把已入库的待办删掉
    todoList = todoList.filter(function(t) { return t !== tmp; });
    renderProject();
    if (_pjDetailId === projectId) pjRerenderDetail(projectId);
    toast('添加失败: ' + pjErrorText(e));
    return;
  } finally {
    if (inputEl) { try { inputEl.disabled = false; } catch (e) {} }
  }
  // 关键：POST 后内存里已是真实 id，但 DOM onclick 仍是 tmpPJ_*
  // 不重绘则点详情/编辑找不到待办（标题丢失、无法立即编辑）
  try {
    renderProject();
    if (_pjDetailId === projectId) pjRerenderDetail(projectId);
    if (typeof currentTab !== 'undefined' && currentTab === 'todo' && typeof renderTodo === 'function') renderTodo();
    try { setCachedData('todos', todoList); } catch (e) {}
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
  if (!t) { toast('这条待办还在同步，请稍后再试'); return; }
  if (String(t.id).indexOf('tmp') === 0) { toast('保存中，请稍候'); return; }
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
    // C2：刷新后若分步合计已超总预算，补一条提示（不阻断）
    var _p2 = projectList.find(function(x) { return x.id === projectId; });
    if (_p2 && phaseBudget != null && phaseBudget > 0) {
      var _tb = _p2.budget == null ? null : Number(_p2.budget);
      if (_tb != null && _tb > 0) {
        var _ps = pjSumPhaseBudgets(_p2);
        if (_ps.sum > _tb) toast('⚠️ 分步预算合计 ' + pjMoney(_ps.sum) + ' 已超总预算 ' + pjMoney(_tb));
      }
    }
  } catch (e) {
    toast('保存失败: ' + pjErrorText(e));
  }
}

// 账本里点分步预算 → 跳到阶段页并展开该步（顺带打开本步设置）
function jumpToPhaseBudget(projectId, idx) {
  selectedPhase[projectId] = idx;
  projectDetailTab = 'phases';
  _pjSettingsOpen[pjSettingsKey(projectId, idx)] = true;
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
  var pidx = (phaseIdx === null || phaseIdx === undefined) ? null : Number(phaseIdx);
  window._pendingPhaseIdx = pidx;
  window._pendingTodoCategory = category || pjLastTodoCategory();
  // 把快速输入框里刚打的标题带进弹窗（用户：输入后点「更多设置」标题不能丢）
  var inp = document.getElementById('pjQuickTodo_' + pidx);
  window._pendingTodoTitle = inp ? String(inp.value || '').trim() : '';
  window._pendingQuickInputId = inp ? inp.id : '';
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

// AI 建议下一步（按 project:phase 缓存）
var _pjSuggestions = {};
async function pjSuggestNext(projectId, phaseIdx) {
  var p = projectList.find(function(x) { return x.id === projectId; });
  if (!p) return;
  var phases = p.phases || [];
  var ph = phases[phaseIdx] || {};
  var key = projectId + ':' + phaseIdx;
  try {
    toast('AI 正在想下一步…');
    var openTodos = pjPhaseTodos(p, phaseIdx)
      .filter(function(t) { return t.status !== '已完成' && t.status !== '已删除' && t.status !== '已取消'; })
      .map(function(t) { return t.title; });
    var donePhases = phases.filter(function(x) { return x && x.status === 'done'; })
      .map(function(x) { return pjStepTitle(x, Number(x.idx) || 0); });
    var res = await aiRequest('suggest-next', {
      projectName: p.name,
      description: p.description || '',
      phaseName: pjStepTitle(ph, phaseIdx),
      openTodos: openTodos,
      donePhases: donePhases,
    });
    if (!res || !res.ok || !res.data || !Array.isArray(res.data.suggestions) || !res.data.suggestions.length) {
      throw new Error((res && res.error) || '没有建议');
    }
    _pjSuggestions[key] = res.data.suggestions.slice(0, 3);
    pjRerenderDetail(projectId);
  } catch (e) {
    toast('建议失败: ' + pjErrorText(e));
  }
}

function pjSuggestToTodo(projectId, phaseIdx, sugIdx) {
  var list = _pjSuggestions[projectId + ':' + phaseIdx] || [];
  var s = list[Number(sugIdx)];
  if (!s || !s.title) return;
  var title = String(s.title).trim();
  var input = document.getElementById('pjQuickTodo_' + phaseIdx);
  if (input) {
    input.value = title;
    pjCreateProjectTodo(projectId, title, null, input, null, phaseIdx);
  } else {
    pjCreateProjectTodo(projectId, title, null, null, null, phaseIdx);
  }
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
  updateBudgetSumWarn: pjUpdateBudgetSumWarn,
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
  suggestNext: pjSuggestNext,
  suggestToTodo: pjSuggestToTodo,
  rememberTodoCategory: rememberTodoCategory,
  togglePhaseSettings: togglePhaseSettings,
  toggleTodo: toggleProjectTodo,
  openTodoModalForProject: openTodoModalForProject,
  getProjectOptions: getProjectOptions,
  fillProjectPhaseSelects: fillProjectPhaseSelects,
  openFocus: pjOpenFocus,
  focusItems: pjFocusItems,
};
