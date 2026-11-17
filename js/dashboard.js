// dashboard.js - 飞书式仪表盘（统计页入口 · 全屏独立页）
// KPI 四联固定 + 预设图卡可改/隐藏/排序；布局存 localStorage（按账号）。
// 数据复用 expenses / orderRows() / getBudgetPool / pivot 事件口径，不新增接口。
(function () {
  'use strict';

  var RANGES = ['本月', '今年', '近6月', '近30天', '全部'];
  var CHARTS = ['柱状', '条形', '折线', '环形'];
  var DIMS = ['分类', '平台', '来源', '商品组', '月份', '日'];
  var METRICS = ['金额', '笔数'];
  var LOCKED_DIM = { 环形: '分类' };

  var DEFAULT_CARDS = [
    { id: 'cat', title: '分类占比', chart: '环形', range: '本月', dim: '分类', metric: '金额', hidden: false },
    { id: 'trend', title: '月度趋势', chart: '折线', range: '近6月', dim: '月份', metric: '金额', hidden: false },
    { id: 'daily', title: '每日支出', chart: '柱状', range: '本月', dim: '日', metric: '金额', hidden: false },
    { id: 'rank', title: '分类排行', chart: '条形', range: '本月', dim: '分类', metric: '金额', hidden: false }
  ];

  var layout = null;
  var editingId = '';
  var showManage = false;
  var cachedEvents = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function bjNow() { return new Date(Date.now() + 8 * 3600000); }
  function userKey() {
    try { return String(localStorage.getItem('auth_user') || 'guest').replace(/[^\w.-]/g, '_'); }
    catch (e) { return 'guest'; }
  }
  function layoutKey() { return 'purchase_dash_layout_v1_' + userKey(); }

  // ---- 布局持久化 ----
  function defaultLayout() {
    return { v: 1, cards: clone(DEFAULT_CARDS) };
  }

  function mergeLayout(stored, defaults) {
    var defs = (defaults || DEFAULT_CARDS).map(function (c) { return clone(c); });
    if (!stored || typeof stored !== 'object' || !Array.isArray(stored.cards)) {
      return { v: 1, cards: defs };
    }
    var byId = {};
    stored.cards.forEach(function (c) {
      if (c && typeof c.id === 'string') byId[c.id] = c;
    });
    // 按存储顺序保留已知卡；再补缺失默认卡
    var out = [];
    stored.cards.forEach(function (c) {
      if (!c || typeof c.id !== 'string') return;
      var def = null;
      for (var i = 0; i < defs.length; i++) if (defs[i].id === c.id) def = defs[i];
      if (!def) return;
      var card = clone(def);
      if (CHARTS.indexOf(c.chart) >= 0) card.chart = c.chart;
      if (RANGES.indexOf(c.range) >= 0) card.range = c.range;
      if (DIMS.indexOf(c.dim) >= 0) card.dim = c.dim;
      if (METRICS.indexOf(c.metric) >= 0) card.metric = c.metric;
      card.hidden = !!c.hidden;
      if (typeof c.title === 'string' && c.title) card.title = c.title.slice(0, 24);
      // 环形锁单维
      if (card.chart === '环形' && LOCKED_DIM[card.chart]) card.dim = LOCKED_DIM[card.chart];
      out.push(card);
    });
    defs.forEach(function (d) {
      var found = false;
      out.forEach(function (o) { if (o.id === d.id) found = true; });
      if (!found) out.push(d);
    });
    return { v: 1, cards: out };
  }

  function loadLayout() {
    var raw = null;
    try { raw = localStorage.getItem(layoutKey()); } catch (e) {}
    var stored = null;
    if (raw) {
      try { stored = JSON.parse(raw); } catch (e) { stored = null; }
    }
    layout = mergeLayout(stored, DEFAULT_CARDS);
    return layout;
  }

  function saveLayout() {
    try { localStorage.setItem(layoutKey(), JSON.stringify(layout)); } catch (e) {}
  }

  function resetLayout() {
    layout = defaultLayout();
    editingId = '';
    try { localStorage.removeItem(layoutKey()); } catch (e) {}
    saveLayout();
  }

  // ---- KPI（纯函数，便于单测）----
  function prevMonthStr(m) {
    var y = Number(String(m).slice(0, 4));
    var mo = Number(String(m).slice(5, 7));
    if (!y || !mo) return '';
    mo -= 1;
    if (mo < 1) { mo = 12; y -= 1; }
    return y + '-' + pad2(mo);
  }

  function deltaInfo(cur, prev) {
    cur = Number(cur) || 0;
    prev = Number(prev) || 0;
    if (prev <= 0 && cur <= 0) return { deltaText: '持平', deltaGood: null, pct: 0 };
    if (prev <= 0 && cur > 0) return { deltaText: '新增', deltaGood: false, pct: null };
    if (prev > 0 && cur <= 0) return { deltaText: '↓100%', deltaGood: true, pct: -100 };
    var d = (cur - prev) / prev * 100;
    var rounded = Math.round(Math.abs(d) * 10) / 10;
    var text = d > 0 ? '↑' + rounded + '%' : d < 0 ? '↓' + rounded + '%' : '持平';
    // 支出变多为差
    return { deltaText: text, deltaGood: d > 0 ? false : d < 0 ? true : null, pct: d };
  }

  // inputs: { monthSpend, prevMonthSpend, buy, exp, fixed, totalBudget, available, yearSpend, yearCount }
  function computeKpis(inputs) {
    var i = inputs || {};
    var monthSpend = Number(i.monthSpend) || 0;
    var prevMonthSpend = Number(i.prevMonthSpend) || 0;
    var d = deltaInfo(monthSpend, prevMonthSpend);
    var totalBudget = Number(i.totalBudget) || 0;
    var available = Number(i.available) || 0;
    var buy = Number(i.buy) || 0;
    var exp = Number(i.exp) || 0;
    var budgetSet = totalBudget > 0;
    var usagePct = 0;
    var usageLevel = 'green';
    if (budgetSet && available > 0) {
      usagePct = Math.min((buy + exp) / available * 100, 100);
      usageLevel = usagePct > 90 ? 'red' : usagePct > 70 ? 'orange' : 'green';
    } else if (budgetSet && available <= 0) {
      // 预算全被固定/分期扣光：已用视为 100%
      usagePct = (buy + exp) > 0 ? 100 : 0;
      usageLevel = (buy + exp) > 0 ? 'red' : 'green';
    }
    return {
      monthSpend: monthSpend,
      prevMonthSpend: prevMonthSpend,
      deltaText: d.deltaText,
      deltaGood: d.deltaGood,
      yearSpend: Number(i.yearSpend) || 0,
      yearCount: Number(i.yearCount) || 0,
      buy: buy,
      exp: exp,
      fixed: Number(i.fixed) || 0,
      totalBudget: totalBudget,
      available: available,
      usagePct: budgetSet ? usagePct : null,
      usageLevel: usageLevel,
      budgetSet: budgetSet
    };
  }

  // 从全局数据组装 KPI（浏览器侧）
  function buildKpiInputs() {
    var thisMonth = typeof getThisMonth === 'function' ? getThisMonth() : (function () {
      var d = bjNow(); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1);
    })();
    var prevM = prevMonthStr(thisMonth);
    var poolCur = typeof getBudgetPool === 'function' ? getBudgetPool(thisMonth) : null;
    var poolPrev = (prevM && typeof getBudgetPool === 'function') ? getBudgetPool(prevM) : null;
    var yearEvents = filterRange(allEvents(), '今年');
    var yearSpend = 0, yearCount = 0;
    yearEvents.forEach(function (ev) { yearSpend += Number(ev.amount) || 0; yearCount += 1; });
    return {
      monthSpend: poolCur ? poolCur.totalSpend : 0,
      prevMonthSpend: poolPrev ? poolPrev.totalSpend : 0,
      buy: poolCur ? poolCur.directPurchaseSpend : 0,
      exp: poolCur ? poolCur.expenseSpend : 0,
      fixed: poolCur ? poolCur.fixedDeduction : 0,
      totalBudget: poolCur ? poolCur.totalBudget : 0,
      available: poolCur ? poolCur.available : 0,
      yearSpend: yearSpend,
      yearCount: yearCount
    };
  }

  // ---- 事件（复用 pivot 口径，全量构建后按卡过滤）----
  function allEvents() {
    if (cachedEvents) return cachedEvents;
    var out = [];
    var P = (typeof App !== 'undefined' && App.pivot) ? App.pivot : null;
    if (!P || typeof P._rangeBounds !== 'function') { cachedEvents = out; return out; }
    var b = P._rangeBounds({ range: '全部' });
    var expRows = (typeof expenses !== 'undefined' && expenses) ? expenses : [];
    var orderList = (typeof orderRows === 'function') ? orderRows() : [];
    out = out.concat(P._buildExpenseEvents(expRows, b));
    out = out.concat(P._buildPurchaseEvents(orderList, b));
    var gs = (typeof P._getGroups === 'function') ? P._getGroups() : [];
    out.forEach(function (ev) {
      ev.group = (typeof P._matchGroup === 'function') ? P._matchGroup(ev, gs) : (ev.group || '未分组');
    });
    cachedEvents = out;
    return out;
  }

  function invalidateEvents() { cachedEvents = null; }

  function filterRange(events, range, nowMs) {
    if (!Array.isArray(events)) return [];
    if (!range || range === '全部') return events.slice();
    var now = nowMs != null ? nowMs : Date.now();
    var d = new Date(now + 8 * 3600000);
    var y = d.getUTCFullYear(), m = d.getUTCMonth();
    if (range === '本月') {
      var cur = y + '-' + pad2(m + 1);
      return events.filter(function (e) { return e.month === cur; });
    }
    if (range === '今年') {
      var ys = String(y);
      return events.filter(function (e) { return String(e.month || '').slice(0, 4) === ys; });
    }
    if (range === '近6月') {
      var months = [];
      for (var i = 0; i < 6; i++) {
        var mm = m - i, yy = y;
        while (mm < 0) { mm += 12; yy -= 1; }
        months.push(yy + '-' + pad2(mm + 1));
      }
      return events.filter(function (e) { return months.indexOf(e.month) >= 0; });
    }
    if (range === '近30天') {
      var start = now - 30 * 86400000;
      return events.filter(function (e) { return Number(e.ts) >= start; });
    }
    return events.slice();
  }

  function dimValue(ev, dim) {
    if (dim === '分类') return ev.category || '未分类';
    if (dim === '平台') return ev.platform || '—';
    if (dim === '来源') return ev.source || '其他';
    if (dim === '商品组') return ev.group || '未分组';
    if (dim === '月份') {
      var mm = String(ev.month || '');
      if (/^\d{4}-\d{2}$/.test(mm)) return Number(mm.slice(5, 7)) + '月';
      return mm || '未知';
    }
    if (dim === '日') {
      var dd = String(ev.day || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(dd)) return String(Number(dd.slice(8, 10)));
      return dd || '未知';
    }
    return ev.category || '其他';
  }

  function aggregate(events, dim, metric) {
    var map = {};
    (events || []).forEach(function (ev) {
      var k = dimValue(ev, dim);
      if (!map[k]) map[k] = { amount: 0, count: 0 };
      map[k].amount += Number(ev.amount) || 0;
      map[k].count += 1;
    });
    var entries = Object.keys(map).map(function (k) {
      return [k, metric === '笔数' ? map[k].count : map[k].amount];
    });
    if (dim === '月份' || dim === '日') {
      entries.sort(function (a, b) {
        var na = parseFloat(a[0]), nb = parseFloat(b[0]);
        if (isFinite(na) && isFinite(nb)) return na - nb;
        return String(a[0]).localeCompare(String(b[0]));
      });
    } else {
      entries.sort(function (a, b) { return b[1] - a[1]; });
    }
    return entries;
  }

  function safeCard(card) {
    var c = clone(card);
    if (CHARTS.indexOf(c.chart) < 0) c.chart = '柱状';
    if (RANGES.indexOf(c.range) < 0) c.range = '本月';
    if (DIMS.indexOf(c.dim) < 0) c.dim = '分类';
    if (METRICS.indexOf(c.metric) < 0) c.metric = '金额';
    if (c.chart === '环形') c.dim = LOCKED_DIM.环形 || '分类';
    return c;
  }

  function fmtMoney(n) {
    n = Number(n) || 0;
    return '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }

  // ---- 渲染 ----
  function usageRing(pct, level) {
    var color = level === 'red' ? 'var(--red)' : level === 'orange' ? 'var(--orange)' : 'var(--green)';
    if (pct == null) {
      return '<div class="dash-usage dash-usage-empty"><div class="dash-usage-pct">—</div><div class="dash-usage-cap">未设预算</div></div>';
    }
    var r = 34, c = 2 * Math.PI * r;
    var filled = c * Math.min(Math.max(pct, 0), 100) / 100;
    return '<div class="dash-usage">'
      + '<svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">'
      + '<circle cx="44" cy="44" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="10"/>'
      + '<circle cx="44" cy="44" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="10"'
      + ' stroke-dasharray="' + filled.toFixed(1) + ' ' + (c - filled).toFixed(1) + '"'
      + ' stroke-linecap="round" transform="rotate(-90 44 44)"/>'
      + '<text x="44" y="48" text-anchor="middle" font-size="18" font-weight="800" fill="var(--text)">'
      + Math.round(pct) + '%</text></svg>'
      + '<div class="dash-usage-cap">预算使用率</div></div>';
  }

  function kpiHtml(k) {
    var dc = k.deltaGood === true ? 'var(--green)' : k.deltaGood === false ? 'var(--red)' : 'var(--muted)';
    return '<section class="dash-kpi" aria-label="关键指标">'
      + '<div class="dash-kpi-card">'
      + '<div class="dash-kpi-label">本月支出</div>'
      + '<div class="dash-kpi-num a-num">' + fmtMoney(k.monthSpend) + '</div>'
      + '<div class="dash-kpi-sub" style="color:' + dc + '">较上月 ' + esc(k.deltaText || '持平') + '</div>'
      + '</div>'
      + '<div class="dash-kpi-card">'
      + '<div class="dash-kpi-label">今年支出</div>'
      + '<div class="dash-kpi-num a-num">' + fmtMoney(k.yearSpend) + '</div>'
      + '<div class="dash-kpi-sub">' + k.yearCount + ' 笔</div>'
      + '</div>'
      + '<div class="dash-kpi-card">'
      + '<div class="dash-kpi-label">本月构成</div>'
      + '<div class="dash-kpi-split">'
      + '<div><span>采购</span><b class="a-num">' + fmtMoney(k.buy) + '</b></div>'
      + '<div><span>记账</span><b class="a-num">' + fmtMoney(k.exp) + '</b></div>'
      + '<div><span>固定</span><b class="a-num">' + fmtMoney(k.fixed) + '</b></div>'
      + '</div></div>'
      + '<div class="dash-kpi-card dash-kpi-usage">'
      + usageRing(k.usagePct, k.usageLevel)
      + '</div>'
      + '</section>';
  }

  function chartBodyHtml(card, events) {
    var scoped = filterRange(events, card.range);
    var entries = aggregate(scoped, card.dim, card.metric);
    var hasVal = entries.some(function (e) { return Number(e[1]) > 0; });
    if (!entries.length || !hasVal) {
      return '<div class="empty-chart">暂无数据</div>';
    }
    var chart = card.chart;
    try {
      if (chart === '环形') {
        var total = entries.reduce(function (s, e) { return s + Number(e[1] || 0); }, 0);
        return donutChart(entries, 150, card.metric === '笔数' ? '笔数' : '合计')
          + donutLegend(entries, total);
      }
      if (chart === '折线') {
        return lineChart(entries.map(function (e) {
          return { label: e[0], value: Number(e[1]) || 0 };
        }));
      }
      if (chart === '条形') {
        return barChart(entries);
      }
      return barChartV(entries.map(function (e) {
        return { label: e[0], value: Number(e[1]) || 0 };
      }));
    } catch (err) {
      return '<div class="empty-chart">图表渲染失败</div>';
    }
  }

  function optList(list, current) {
    return list.map(function (x) {
      return '<option value="' + escAttr(x) + '"' + (x === current ? ' selected' : '') + '>' + esc(x) + '</option>';
    }).join('');
  }

  function editPanelHtml(card) {
    var idx = layout.cards.findIndex(function (c) { return c.id === card.id; });
    return '<div class="dash-edit" data-dash-edit="' + escAttr(card.id) + '">'
      + '<div class="dash-edit-row">'
      + '<label>范围<select data-dash-field="range">' + optList(RANGES, card.range) + '</select></label>'
      + '<label>图型<select data-dash-field="chart">' + optList(CHARTS, card.chart) + '</select></label>'
      + '</div>'
      + '<div class="dash-edit-row">'
      + '<label>维度<select data-dash-field="dim">' + optList(DIMS, card.dim) + '</select></label>'
      + '<label>指标<select data-dash-field="metric">' + optList(METRICS, card.metric) + '</select></label>'
      + '</div>'
      + '<div class="dash-edit-actions">'
      + '<button type="button" class="btn btn-secondary" data-dash-move="-1"' + (idx <= 0 ? ' disabled' : '') + '>↑ 上移</button>'
      + '<button type="button" class="btn btn-secondary" data-dash-move="1"' + (idx >= layout.cards.length - 1 ? ' disabled' : '') + '>↓ 下移</button>'
      + '<button type="button" class="btn btn-secondary" data-dash-hide>隐藏此卡</button>'
      + '<button type="button" class="btn btn-primary" data-dash-done>完成</button>'
      + '</div></div>';
  }

  function cardHtml(card, events) {
    var c = safeCard(card);
    var editing = editingId === c.id;
    return '<article class="dash-card' + (editing ? ' editing' : '') + '" data-dash-card="' + escAttr(c.id) + '">'
      + '<header class="dash-card-head">'
      + '<div class="dash-card-titles">'
      + '<h3>' + esc(c.title) + '</h3>'
      + '<span class="dash-card-meta">' + esc(c.range) + ' · ' + esc(c.dim) + ' · ' + esc(c.metric) + ' · ' + esc(c.chart) + '</span>'
      + '</div>'
      + '<div class="dash-card-tools">'
      + '<button type="button" class="dash-icon-btn" data-dash-edit-toggle="' + escAttr(c.id) + '" aria-label="编辑卡片" title="编辑">✎</button>'
      + '<button type="button" class="dash-icon-btn" data-dash-hide-id="' + escAttr(c.id) + '" aria-label="隐藏卡片" title="隐藏">✕</button>'
      + '</div></header>'
      + (editing ? editPanelHtml(c) : '')
      + '<div class="dash-card-body">' + chartBodyHtml(c, events) + '</div>'
      + '</article>';
  }

  function manageHtml() {
    var rows = layout.cards.map(function (c, i) {
      return '<div class="dash-manage-row">'
        + '<span class="dash-manage-title">' + esc(c.title) + '</span>'
        + '<span class="dash-manage-state">' + (c.hidden ? '已隐藏' : '显示中') + '</span>'
        + '<div class="dash-manage-btns">'
        + '<button type="button" class="btn btn-secondary" data-dash-toggle="' + escAttr(c.id) + '">' + (c.hidden ? '显示' : '隐藏') + '</button>'
        + '<button type="button" class="btn btn-secondary" data-dash-mmove="-1" data-dash-id="' + escAttr(c.id) + '"' + (i <= 0 ? ' disabled' : '') + '>↑</button>'
        + '<button type="button" class="btn btn-secondary" data-dash-mmove="1" data-dash-id="' + escAttr(c.id) + '"' + (i >= layout.cards.length - 1 ? ' disabled' : '') + '>↓</button>'
        + '</div></div>';
    }).join('');
    return '<section class="dash-manage" ' + (showManage ? '' : 'hidden') + ' aria-label="管理卡片">'
      + '<div class="dash-manage-head"><span>管理卡片</span>'
      + '<button type="button" class="btn btn-secondary" data-dash-reset>恢复默认布局</button></div>'
      + rows
      + '</section>';
  }

  function render() {
    var body = document.getElementById('dashBody');
    if (!body) return;
    if (!layout) loadLayout();
    invalidateEvents();
    var events = allEvents();
    var k = computeKpis(buildKpiInputs());
    var visible = layout.cards.filter(function (c) { return !c.hidden; });
    var cardsHtml = visible.length
      ? visible.map(function (c) { return cardHtml(c, events); }).join('')
      : '<div class="dash-empty">所有图卡已隐藏，可在下方「管理卡片」恢复</div>';
    body.innerHTML = kpiHtml(k)
      + '<div class="dash-cards">' + cardsHtml + '</div>'
      + manageHtml();
  }

  function findCard(id) {
    for (var i = 0; i < layout.cards.length; i++) if (layout.cards[i].id === id) return layout.cards[i];
    return null;
  }

  function moveCard(id, dir) {
    var idx = -1;
    for (var i = 0; i < layout.cards.length; i++) if (layout.cards[i].id === id) idx = i;
    if (idx < 0) return;
    var j = idx + dir;
    if (j < 0 || j >= layout.cards.length) return;
    var t = layout.cards[idx];
    layout.cards[idx] = layout.cards[j];
    layout.cards[j] = t;
    saveLayout();
    render();
  }

  function applyEdit(id, field, value) {
    var card = findCard(id);
    if (!card) return;
    if (field === 'range' && RANGES.indexOf(value) >= 0) card.range = value;
    else if (field === 'chart' && CHARTS.indexOf(value) >= 0) {
      card.chart = value;
      if (LOCKED_DIM[value]) card.dim = LOCKED_DIM[value];
    } else if (field === 'dim' && DIMS.indexOf(value) >= 0) {
      card.dim = value;
      if (card.chart === '环形') card.chart = '柱状'; // 环形锁分类，改维度则回柱状
    } else if (field === 'metric' && METRICS.indexOf(value) >= 0) card.metric = value;
    saveLayout();
    render();
  }

  // ---- 开关 ----
  function openDashboard() {
    try {
      var ov = document.getElementById('dashOverlay');
      if (!ov) return;
      loadLayout();
      editingId = '';
      // 打开时若统计 tab 不是当前也无所谓：入口只在统计页
      render();
      ov.classList.add('active');
      document.body.classList.add('dash-open');
    } catch (e) {
      console.error('openDashboard', e);
      if (typeof toast === 'function') toast('仪表盘打开失败');
    }
  }

  function closeDashboard() {
    var ov = document.getElementById('dashOverlay');
    if (ov) ov.classList.remove('active');
    document.body.classList.remove('dash-open');
    editingId = '';
    showManage = false;
    invalidateEvents();
    // 回统计页时让数据视图刷新一次（已有数据则仅重绘）
    try {
      if (typeof currentTab !== 'undefined' && currentTab === 'stats' && typeof renderStats === 'function') {
        renderStats();
      }
    } catch (e) {}
  }

  function onBodyClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var el;

    el = t.closest('[data-dash-edit-toggle]');
    if (el) {
      var id = el.getAttribute('data-dash-edit-toggle');
      editingId = (editingId === id) ? '' : id;
      render();
      return;
    }
    el = t.closest('[data-dash-done]');
    if (el) { editingId = ''; render(); return; }

    el = t.closest('[data-dash-hide-id]');
    if (el) {
      var hid = el.getAttribute('data-dash-hide-id');
      var hc = findCard(hid);
      if (hc) { hc.hidden = true; saveLayout(); editingId = ''; render(); }
      return;
    }
    el = t.closest('[data-dash-hide]');
    if (el) {
      var wrap = el.closest('[data-dash-edit]');
      var eid = wrap ? wrap.getAttribute('data-dash-edit') : editingId;
      var ec = findCard(eid);
      if (ec) { ec.hidden = true; saveLayout(); editingId = ''; render(); }
      return;
    }
    el = t.closest('[data-dash-move]');
    if (el) {
      var mwrap = el.closest('[data-dash-edit]');
      var mid = mwrap ? mwrap.getAttribute('data-dash-edit') : editingId;
      moveCard(mid, Number(el.getAttribute('data-dash-move')) || 0);
      return;
    }
    el = t.closest('[data-dash-toggle]');
    if (el) {
      var tid = el.getAttribute('data-dash-toggle');
      var tc = findCard(tid);
      if (tc) { tc.hidden = !tc.hidden; saveLayout(); render(); }
      return;
    }
    el = t.closest('[data-dash-mmove]');
    if (el) {
      moveCard(el.getAttribute('data-dash-id'), Number(el.getAttribute('data-dash-mmove')) || 0);
      return;
    }
    el = t.closest('[data-dash-reset]');
    if (el) {
      if (typeof confirm === 'function' && !confirm('恢复默认 4 张图卡布局？')) return;
      resetLayout();
      showManage = false;
      render();
      if (typeof toast === 'function') toast('已恢复默认布局');
      return;
    }
    el = t.closest('[data-dash-manage-toggle]');
    if (el) { showManage = !showManage; render(); return; }
  }

  function onChange(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var field = t.getAttribute('data-dash-field');
    if (!field) return;
    var wrap = t.closest('[data-dash-edit]');
    if (!wrap) return;
    applyEdit(wrap.getAttribute('data-dash-edit'), field, t.value);
  }

  function init() {
    var body = document.getElementById('dashBody');
    if (!body || body.__dashBound) return;
    body.__dashBound = true;
    body.addEventListener('click', onBodyClick);
    body.addEventListener('change', onChange);
    // 管理面板开关放在 KPI 下方工具条
    var header = document.querySelector('#dashOverlay .dash-header');
    if (header && !header.__dashBound) {
      header.__dashBound = true;
      header.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.closest && t.closest('[data-dash-manage-toggle]')) {
          showManage = !showManage;
          render();
        } else if (t && t.closest && t.closest('[data-dash-reset-top]')) {
          if (typeof confirm === 'function' && !confirm('恢复默认 4 张图卡布局？')) return;
          resetLayout();
          showManage = false;
          render();
          if (typeof toast === 'function') toast('已恢复默认布局');
        }
      });
    }
  }

  App.dashboard = {
    open: openDashboard,
    close: closeDashboard,
    reset: resetLayout,
    render: render,
    init: init,
    _kpi: computeKpis,
    _deltaInfo: deltaInfo,
    _prevMonthStr: prevMonthStr,
    _mergeLayout: mergeLayout,
    _defaultLayout: defaultLayout,
    _loadLayout: loadLayout,
    _saveLayout: saveLayout,
    _filterRange: filterRange,
    _aggregate: aggregate,
    _dimValue: dimValue,
    _safeCard: safeCard,
    _buildKpiInputs: buildKpiInputs,
    _invalidateEvents: invalidateEvents,
    _DEFAULT_CARDS: DEFAULT_CARDS,
    _RANGES: RANGES,
    _CHARTS: CHARTS,
    _DIMS: DIMS,
    _METRICS: METRICS
  };
  window.openDashboard = openDashboard;
  window.closeDashboard = closeDashboard;

  // DOM 就绪后绑定（index.html 预置壳）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
