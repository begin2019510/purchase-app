// ===== 数据透视（统计页）=====
// 纯前端聚合：记账 expenses + 采购 orderRows()，不新增任何接口。
// 关键词组保存在 localStorage（按登录用户名隔离），用于把「喜茶/蜜雪/茶百道」归成「奶茶」。
(function () {
  'use strict';

  var DIMS = ['分类', '商品组', '商品或备注', '平台', '月份', '来源', '类型'];
  var COLS = ['无', '月份', '分类', '平台', '来源', '商品组'];
  var METRICS = ['金额', '笔数', '平均'];
  var RANGES = ['全部', '今年', '本月', '自定义'];
  var SOURCES = ['全部', '记账', '采购', '固定'];
  var VIEWS = ['表格', '图表'];
  var CHARTS = ['柱状', '条形', '折线', '环形', '堆叠', '热力'];

  var DEFAULT_GROUPS = [
    { id: 'g_tea', name: '奶茶', keywords: ['奶茶', '喜茶', '奈雪', '奈雪的茶', '蜜雪', '蜜雪冰城', '茶百道', '古茗', '一点点', '霸王茶姬', '沪上阿姨', '益禾堂', '书亦', 'coco', '都可', '茶颜悦色'] },
    { id: 'g_api', name: 'API', keywords: ['API', 'api', '接口', 'token', '额度', 'OpenAI', 'Claude', 'DeepSeek', '千问', '通义', '硅基流动', 'OpenRouter', '中转', '调用费'] },
    { id: 'g_daily', name: '日用品', keywords: ['牙膏', '牙刷', '纸巾', '抽纸', '卷纸', '洗衣液', '柔顺剂', '洗发水', '护发素', '沐浴露', '香皂', '洗洁精', '垃圾袋', '拖把', '抹布', '日用品', '日用', '清洁'] },
    { id: 'g_cloth', name: '衣服', keywords: ['衣服', 'T恤', 't恤', '衬衫', '裤', '裙', '外套', '卫衣', '毛衣', '羽绒服', '大衣', '鞋', '袜', '内衣', '优衣库', '帽子', '围巾'] }
  ];

  var cfg = { range: '全部', source: '全部', row: '分类', col: '月份', metric: '金额', keyword: '', from: '', to: '', view: '表格', chart: '柱状' };
  var groups = [];
  var last = null;
  var editingGroupId = '';
  var showAllRows = false;
  var kwTimer = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function bjNow() { return new Date(Date.now() + 8 * 3600000); }
  function todayStr() { var d = bjNow(); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function userKey() { try { return String(localStorage.getItem('auth_user') || 'guest').replace(/[^\w.-]/g, '_'); } catch (e) { return 'guest'; } }
  function cfgKey() { return 'purchase_pivot_cfg_v1_' + userKey(); }
  function groupsKey() { return 'purchase_pivot_groups_v1_' + userKey(); }

  // ---- 配置与关键词组 ----
  function loadCfg() {
    cfg = { range: '全部', source: '全部', row: '分类', col: '月份', metric: '金额', keyword: '', from: '', to: '', view: '表格', chart: '柱状' };
    try {
      var raw = localStorage.getItem(cfgKey());
      if (raw) {
        var v = JSON.parse(raw);
        if (v && typeof v === 'object') {
          if (RANGES.indexOf(v.range) >= 0) cfg.range = v.range;
          if (SOURCES.indexOf(v.source) >= 0) cfg.source = v.source;
          if (DIMS.indexOf(v.row) >= 0) cfg.row = v.row;
          if (COLS.indexOf(v.col) >= 0) cfg.col = v.col;
          if (METRICS.indexOf(v.metric) >= 0) cfg.metric = v.metric;
          if (VIEWS.indexOf(v.view) >= 0) cfg.view = v.view;
          if (CHARTS.indexOf(v.chart) >= 0) cfg.chart = v.chart;
          if (typeof v.keyword === 'string') cfg.keyword = v.keyword.slice(0, 100);
          if (/^\d{4}-\d{2}-\d{2}$/.test(v.from || '')) cfg.from = v.from;
          if (/^\d{4}-\d{2}-\d{2}$/.test(v.to || '')) cfg.to = v.to;
        }
      }
    } catch (e) {}
    if (cfg.row === cfg.col) cfg.col = '无';
  }
  function saveCfg() { try { localStorage.setItem(cfgKey(), JSON.stringify(cfg)); } catch (e) {} }

  function loadGroups() {
    groups = [];
    var hasStored = false;
    try {
      var raw = localStorage.getItem(groupsKey());
      if (raw !== null) {
        hasStored = true;
        var v = JSON.parse(raw);
        if (Array.isArray(v)) {
          groups = v.filter(function (g) { return g && typeof g.name === 'string' && Array.isArray(g.keywords); })
            .map(function (g) {
              return {
                id: String(g.id || ('g_' + Math.random().toString(36).slice(2))),
                name: String(g.name).slice(0, 20),
                keywords: normalizeKeywords(g.keywords.join(','))
              };
            }).filter(function (g) { return g.name; });
        }
      }
    } catch (e) {}
    if (!hasStored) groups = clone(DEFAULT_GROUPS);
  }
  function saveGroups() { try { localStorage.setItem(groupsKey(), JSON.stringify(groups)); } catch (e) {} }

  function normalizeKeywords(s) {
    var out = [];
    String(s || '').split(/[,，、;；\s]+/).forEach(function (x) {
      x = x.trim();
      if (x && out.indexOf(x) < 0) out.push(x);
    });
    return out.slice(0, 60);
  }

  function eventText(ev) { return [ev.category, ev.title, ev.note, ev.platform].join(' ').toLowerCase(); }
  function matchGroup(ev, gs) {
    var h = eventText(ev);
    for (var i = 0; i < (gs || []).length; i++) {
      var kws = gs[i].keywords || [];
      for (var j = 0; j < kws.length; j++) {
        var k = String(kws[j] || '').toLowerCase();
        if (k && h.indexOf(k) >= 0) return gs[i].name;
      }
    }
    return '未分组';
  }
  function assignGroups(events) { events.forEach(function (ev) { ev.group = matchGroup(ev, groups); }); }

  // ---- 日期与事件口径 ----
  function dayStartMs(dayStr) {
    var p = String(dayStr || '').split('-').map(Number);
    if (p.length < 3 || !p[0] || !p[1] || !p[2]) return 0;
    return Date.UTC(p[0], p[1] - 1, p[2]) - 8 * 3600000;
  }
  function expTs(d) {
    if (typeof rangeExpDayMs === 'function') return rangeExpDayMs(d);
    var s = String(d || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return dayStartMs(s.slice(0, 10));
    var t = Date.parse(s);
    return isFinite(t) ? t : 0;
  }
  function itemTs(d) {
    if (typeof rangeItemDayMs === 'function') return rangeItemDayMs(d);
    if (typeof d === 'number' && isFinite(d)) return d;
    var s = String(d || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return dayStartMs(s.slice(0, 10));
    var t = Date.parse(s);
    return isFinite(t) ? t : 0;
  }
  function tsMonth(ts) { if (!ts) return ''; var d = new Date(ts + 8 * 3600000); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1); }
  function tsDay(ts) { if (!ts) return ''; var d = new Date(ts + 8 * 3600000); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function activeStatus(s) {
    if (typeof isActiveBuy === 'function') return isActiveBuy(s);
    return ['已下单', '已到', '已归档'].indexOf(s) >= 0;
  }

  function rangeBounds(c) {
    var now = bjNow();
    var y = now.getUTCFullYear(), m = now.getUTCMonth();
    var start = 0, end = Infinity, label = '全部时间';
    if (c.range === '本月') {
      start = Date.UTC(y, m, 1) - 8 * 3600000;
      end = Date.UTC(y, m + 1, 1) - 8 * 3600000;
      label = y + '-' + pad2(m + 1);
    } else if (c.range === '今年') {
      start = Date.UTC(y, 0, 1) - 8 * 3600000;
      end = Date.UTC(y + 1, 0, 1) - 8 * 3600000;
      label = y + '年';
    } else if (c.range === '自定义') {
      var f = /^\d{4}-\d{2}-\d{2}$/.test(c.from || '') ? c.from : (y + '-' + pad2(m + 1) + '-01');
      var t = /^\d{4}-\d{2}-\d{2}$/.test(c.to || '') ? c.to : todayStr();
      if (f > t) { var tmp = f; f = t; t = tmp; }
      start = dayStartMs(f);
      end = dayStartMs(t) + 86400000;
      label = f + ' ~ ' + t;
    }
    return { start: start, end: end, label: label };
  }

  // 记账：只取「支出」；[采购]/[采购分期] 是旧版采购镜像，排除避免重复；[固定] 单独标记但计入。
  function buildExpenseEvents(rows, bounds) {
    var out = [];
    (rows || []).forEach(function (e) {
      if ((e['类型'] || '支出') !== '支出') return;
      var note = String(e['备注'] || '');
      if (note.indexOf('[采购]') >= 0 || note.indexOf('[采购分期]') >= 0) return;
      var ts = expTs(e['日期']);
      if (!ts || ts < bounds.start || ts >= bounds.end) return;
      var amount = Number(e['金额']) || 0;
      if (!(amount > 0)) return;
      var fixed = note.indexOf('[固定]') >= 0;
      var cleanNote = note.replace(/\[(固定|采购|采购分期)\]\s*/g, '').trim();
      var cat = e['分类'] || '其他';
      out.push({
        ts: ts, month: tsMonth(ts), day: tsDay(ts), kind: 'expense',
        source: fixed ? '固定' : '记账', category: cat,
        title: cleanNote || (cat + '支出'), note: note, platform: '记账',
        amount: amount, how: fixed ? '固定支出' : '记账', group: ''
      });
    });
    return out;
  }

  // 采购：只取 已下单/已到/已归档；分期按月拆成一条事件，且不产生未来月份。
  function buildPurchaseEvents(rows, bounds) {
    var out = [];
    var now = bjNow();
    var nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth();
    (rows || []).forEach(function (i) {
      if (!activeStatus(i['状态'] || '')) return;
      var tp = Number(i['分期期数']) || 0;
      var ts = itemTs(i['日期']);
      var cat = i['分类'] || '其他';
      var title = i['商品名称'] || '未命名';
      var platform = i['平台'] || '—';
      var note = String(i['备注'] || '');
      if (tp > 1) {
        if (!ts) return;
        var sm = '';
        if (typeof getItemInstallmentStartMonth === 'function') sm = getItemInstallmentStartMonth(i);
        if (!/^\d{4}-\d{2}$/.test(sm)) {
          var d0 = new Date(ts + 8 * 3600000);
          sm = d0.getUTCFullYear() + '-' + pad2(d0.getUTCMonth() + 1);
        }
        var parts = sm.split('-').map(Number);
        if (!parts[0] || !parts[1] || parts[1] < 1 || parts[1] > 12) return;
        var amount = typeof getItemInstallmentAmount === 'function'
          ? getItemInstallmentAmount(i)
          : (Number(i['分期金额']) || Math.round(((Number(i['单价']) || 0) * (Number(i['数量']) || 1)) / tp));
        if (!(amount > 0)) return;
        var pd = new Date(ts + 8 * 3600000);
        var payDay = pd.getUTCDate() || 1;
        for (var k = 0; k < tp; k++) {
          var yy = parts[0] + Math.floor((parts[1] - 1 + k) / 12);
          var mm0 = (parts[1] - 1 + k) % 12;
          if (yy * 12 + mm0 > nowIdx) continue; // 未来期供不计
          var dim = new Date(Date.UTC(yy, mm0 + 1, 0)).getUTCDate();
          var evTs = Date.UTC(yy, mm0, Math.min(payDay, dim)) - 8 * 3600000;
          if (evTs < bounds.start || evTs >= bounds.end) continue;
          out.push({
            ts: evTs, month: tsMonth(evTs), day: tsDay(evTs), kind: 'purchase',
            source: '分期', category: cat, title: title, note: note, platform: platform,
            amount: amount, how: '分期 · 第' + (k + 1) + '/' + tp + '期', group: ''
          });
        }
      } else {
        if (!ts || ts < bounds.start || ts >= bounds.end) return;
        var amt = (Number(i['单价']) || 0) * (Number(i['数量']) || 1);
        if (!(amt > 0)) return;
        out.push({
          ts: ts, month: tsMonth(ts), day: tsDay(ts), kind: 'purchase',
          source: '采购', category: cat, title: title, note: note, platform: platform,
          amount: amt, how: '直接购买', group: ''
        });
      }
    });
    return out;
  }

  function buildEvents() {
    var bounds = rangeBounds(cfg);
    var events = [];
    if (cfg.source === '全部' || cfg.source === '记账' || cfg.source === '固定') {
      var exp = buildExpenseEvents(typeof expenses !== 'undefined' ? expenses : [], bounds);
      if (cfg.source === '固定') exp = exp.filter(function (e) { return e.source === '固定'; });
      else if (cfg.source === '记账') exp = exp.filter(function (e) { return e.source === '记账'; });
      events = events.concat(exp);
    }
    if (cfg.source === '全部' || cfg.source === '采购') {
      var orders = typeof orderRows === 'function' ? orderRows() : [];
      events = events.concat(buildPurchaseEvents(orders, bounds));
    }
    assignGroups(events);
    var kws = normalizeKeywords(cfg.keyword);
    if (kws.length) {
      events = events.filter(function (ev) {
        var h = eventText(ev) + ' ' + (ev.group || '');
        for (var i = 0; i < kws.length; i++) {
          if (h.indexOf(kws[i].toLowerCase()) >= 0) return true;
        }
        return false;
      });
    }
    return { events: events, bounds: bounds };
  }

  function dimValue(ev, dim) {
    if (dim === '分类') return ev.category || '未分类';
    if (dim === '商品组') return ev.group || '未分组';
    if (dim === '商品或备注') return ev.title || '未命名';
    if (dim === '平台') return ev.platform || '—';
    if (dim === '月份') return ev.month || '未知';
    if (dim === '来源') return ev.source || '其他';
    if (dim === '类型') return ev.kind === 'expense' ? '记账' : '采购';
    return '全部';
  }

  function metricValue(cell, metric) {
    if (metric === '笔数') return cell.count || 0;
    if (metric === '平均') return cell.count ? cell.amount / cell.count : 0;
    return cell.amount || 0;
  }

  function computePivot(events, c) {
    var rowDim = c.row, colDim = c.col, metric = c.metric;
    var map = {}, colTotals = {}, grand = { amount: 0, count: 0 };
    events.forEach(function (ev) {
      var r = dimValue(ev, rowDim);
      var col = colDim === '无' ? '合计' : dimValue(ev, colDim);
      if (!map[r]) map[r] = {};
      if (!map[r][col]) map[r][col] = { amount: 0, count: 0, events: [] };
      map[r][col].amount += ev.amount;
      map[r][col].count += 1;
      map[r][col].events.push(ev);
      if (!colTotals[col]) colTotals[col] = { amount: 0, count: 0 };
      colTotals[col].amount += ev.amount;
      colTotals[col].count += 1;
      grand.amount += ev.amount;
      grand.count += 1;
    });

    var rows = Object.keys(map).map(function (r) {
      var cells = {}, amount = 0, count = 0;
      Object.keys(map[r]).forEach(function (col) {
        var cell = map[r][col];
        cells[col] = { value: metricValue(cell, metric), amount: cell.amount, count: cell.count, events: cell.events };
        amount += cell.amount;
        count += cell.count;
      });
      return {
        label: r, cells: cells, amount: amount, count: count,
        value: metricValue({ amount: amount, count: count }, metric)
      };
    });

    var cols = colDim === '无' ? ['合计'] : Object.keys(colTotals);
    if (colDim === '月份') cols.sort();
    else cols.sort(function (a, b) {
      return (metric === '笔数' ? (colTotals[b].count - colTotals[a].count) : (colTotals[b].amount - colTotals[a].amount)) ||
        String(a).localeCompare(String(b), 'zh');
    });
    if (rowDim === '月份') rows.sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });
    else rows.sort(function (a, b) {
      return (metric === '笔数' ? (b.count - a.count) : (b.amount - a.amount)) ||
        String(a.label).localeCompare(String(b.label), 'zh');
    });

    return { rows: rows, cols: cols, colTotals: colTotals, grand: grand, metric: metric };
  }

  // ---- 格式化 ----
  function money(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
  function fmtCell(v, metric) {
    if (metric === '笔数') return String(Math.round(Number(v) || 0));
    return money(v);
  }
  function dimLabel(dim) { return dim === '无' ? '合计' : dim; }

  // ---- 图表（可视化）----
  // 系列色：固定顺序，不随筛选重排；超过 8 段折成「其他」灰。
  var SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  var SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
  var SEQ_LIGHT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#104281'];
  var SEQ_DARK = ['#104281', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4', '#cde2fb'];
  var OTHER_GRAY = '#94a3b8';

  function isDark() {
    try {
      return document.body && document.body.classList.contains('dark');
    } catch (e) { return false; }
  }
  function seriesColor(i) {
    var pal = isDark() ? SERIES_DARK : SERIES_LIGHT;
    return pal[i % pal.length];
  }
  function seqColor(t) {
    var pal = isDark() ? SEQ_DARK : SEQ_LIGHT;
    if (!(t > 0)) return pal[0];
    var idx = Math.min(pal.length - 1, Math.floor(t * pal.length));
    return pal[idx];
  }

  // 按标签稳定取色：先按标签排序再分配槽位，筛选后同实体保持同色
  function buildColorMap(labels) {
    var uniq = [];
    var seen = {};
    labels.forEach(function (l) {
      var k = String(l);
      if (seen[k]) return;
      seen[k] = 1;
      uniq.push(k);
    });
    uniq.sort(function (a, b) { return a.localeCompare(b, 'zh'); });
    var map = {};
    uniq.forEach(function (l, i) {
      map[l] = i < 8 ? seriesColor(i) : OTHER_GRAY;
    });
    return map;
  }

  function foldRowsForChart(rows, maxN) {
    maxN = maxN || 12;
    if (rows.length <= maxN) return { list: rows.slice(), other: null };
    var head = rows.slice(0, maxN - 1);
    var tail = rows.slice(maxN - 1);
    var other = {
      label: '其他 (' + tail.length + ')',
      isOther: true,
      amount: 0, count: 0, value: 0, cells: {}
    };
    tail.forEach(function (r) {
      other.amount += r.amount || 0;
      other.count += r.count || 0;
      other.value += r.value || 0;
      Object.keys(r.cells || {}).forEach(function (c) {
        if (!other.cells[c]) other.cells[c] = { value: 0, amount: 0, count: 0, events: [] };
        var src = r.cells[c];
        other.cells[c].value += src.value || 0;
        other.cells[c].amount += src.amount || 0;
        other.cells[c].count += src.count || 0;
        other.cells[c].events = other.cells[c].events.concat(src.events || []);
      });
    });
    return { list: head.concat([other]), other: other };
  }

  function fmtAxis(n, metric) {
    if (metric === '笔数') return String(Math.round(n));
    if (Math.abs(n) >= 10000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(Math.round(n * 100) / 100);
  }

  function chartHint(html) {
    return '<div class="pivot-empty">' + html + '</div>';
  }

  function legendHtml(pairs) {
    if (!pairs || pairs.length < 2) return '';
    return '<div class="pv-legend">' + pairs.map(function (p) {
      return '<span class="pv-legend-item" title="' + escAttr(p.label + ' ' + fmtCell(p.value, cfg.metric)) + '">'
        + '<i style="background:' + p.color + '"></i>' + esc(p.label) + '</span>';
    }).join('') + '</div>';
  }

  function svgOpen(w, h, label) {
    return '<svg class="pv-svg" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + escAttr(label || '图表') + '">';
  }

  function gridY(w, h, pad, maxV, metric) {
    var lines = 4, g = '';
    for (var i = 0; i <= lines; i++) {
      var y = pad.t + (h - pad.t - pad.b) * i / lines;
      var v = maxV * (1 - i / lines);
      g += '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (w - pad.r) + '" y2="' + y + '" class="pv-grid"/>';
      g += '<text x="' + (pad.l - 6) + '" y="' + (y + 3) + '" class="pv-tick" text-anchor="end">' + esc(fmtAxis(v, metric)) + '</text>';
    }
    return g;
  }

  // 柱状（纵）：行合计单序列
  function chartColumn(res) {
    var folded = foldRowsForChart(res.rows, 12);
    var rows = folded.list;
    var isDesk = typeof window !== 'undefined' && window.innerWidth > 768;
    var W = isDesk ? 860 : 360;
    var H = isDesk ? 300 : 220;
    var pad = { t: 18, r: 10, b: 48, l: 44 };
    var cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    var maxV = Math.max.apply(null, rows.map(function (r) { return r.value || 0; }).concat([1]));
    var gap = cw / rows.length;
    var barW = Math.max(6, Math.min(gap * 0.55, 36));
    var body = gridY(W, H, pad, maxV, res.metric);
    rows.forEach(function (r, i) {
      var bh = Math.max(r.value > 0 ? (r.value / maxV) * ch : 0, r.value > 0 ? 2 : 0);
      var x = pad.l + i * gap + (gap - barW) / 2;
      var y = pad.t + ch - bh;
      var tip = r.label + '：' + fmtCell(r.value, res.metric);
      body += '<rect class="pv-bar" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="3" fill="var(--pri)"><title>' + escAttr(tip) + '</title></rect>';
      var short = r.label.length > (isDesk ? 6 : 4) ? r.label.slice(0, isDesk ? 6 : 4) + '…' : r.label;
      body += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - pad.b + 14) + '" class="pv-xlabel"><title>' + escAttr(r.label) + '</title>' + esc(short) + '</text>';
    });
    return svgOpen(W, H, cfg.row + ' 柱状图') + body + '</svg>'
      + (folded.other ? '<div class="pv-fold-note">已折叠为「' + esc(folded.other.label) + '」，完整数据见表格</div>' : '');
  }

  // 条形（横）：长标签更易读
  function chartBar(res) {
    var folded = foldRowsForChart(res.rows, 12);
    var rows = folded.list;
    var isDesk = typeof window !== 'undefined' && window.innerWidth > 768;
    var W = isDesk ? 860 : 360;
    var rowH = isDesk ? 28 : 30;
    var pad = { t: 8, r: isDesk ? 72 : 56, b: 8, l: isDesk ? 110 : 78 };
    var H = pad.t + pad.b + rows.length * rowH;
    var cw = W - pad.l - pad.r;
    var maxV = Math.max.apply(null, rows.map(function (r) { return r.value || 0; }).concat([1]));
    var body = '';
    rows.forEach(function (r, i) {
      var bw = Math.max(r.value > 0 ? (r.value / maxV) * cw : 0, r.value > 0 ? 3 : 0);
      var y = pad.t + i * rowH + 4;
      var bh = rowH - 12;
      var tip = r.label + '：' + fmtCell(r.value, res.metric);
      body += '<rect x="' + pad.l + '" y="' + y + '" width="' + cw + '" height="' + bh + '" rx="4" class="pv-bar-track"/>';
      body += '<rect class="pv-bar" x="' + pad.l + '" y="' + y + '" width="' + bw.toFixed(1) + '" height="' + bh + '" rx="4" fill="var(--pri)"><title>' + escAttr(tip) + '</title></rect>';
      var short = r.label.length > (isDesk ? 8 : 5) ? r.label.slice(0, isDesk ? 8 : 5) + '…' : r.label;
      body += '<text x="' + (pad.l - 8) + '" y="' + (y + bh / 2 + 3) + '" class="pv-xlabel" text-anchor="end"><title>' + escAttr(r.label) + '</title>' + esc(short) + '</text>';
      body += '<text x="' + (pad.l + bw + 6) + '" y="' + (y + bh / 2 + 3) + '" class="pv-val">' + esc(fmtCell(r.value, res.metric)) + '</text>';
    });
    return svgOpen(W, H, cfg.row + ' 条形图') + body + '</svg>'
      + (folded.other ? '<div class="pv-fold-note">已折叠为「' + esc(folded.other.label) + '」，完整数据见表格</div>' : '');
  }

  // 折线：行或列为月份时按时间
  function chartLine(res) {
    var points = [];
    var xTitle = '';
    if (cfg.row === '月份') {
      points = res.rows.map(function (r) { return { label: r.label, value: r.value }; });
      xTitle = '月份（行）';
    } else if (cfg.col === '月份') {
      points = res.cols.filter(function (c) { return c !== '合计'; }).map(function (c) {
        var ct = res.colTotals[c] || { amount: 0, count: 0 };
        return { label: c, value: metricValue(ct, res.metric) };
      });
      xTitle = '月份（列）';
    } else {
      return chartHint('折线图需要时间维度<br><span style="font-size:12px">把「行」或「列」设为「月份」后再试</span>');
    }
    if (points.length < 2) {
      return chartHint('时间点不足，至少需要 2 个月<br><span style="font-size:12px">试试范围改成「今年」或「全部」</span>');
    }
    var isDesk = typeof window !== 'undefined' && window.innerWidth > 768;
    var W = isDesk ? 860 : 360;
    var H = isDesk ? 280 : 200;
    var pad = { t: 18, r: 14, b: 36, l: 44 };
    var cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    var maxV = Math.max.apply(null, points.map(function (p) { return p.value; }).concat([1]));
    var stepX = points.length > 1 ? cw / (points.length - 1) : cw;
    var pts = points.map(function (p, i) {
      return {
        x: pad.l + (points.length > 1 ? i * stepX : cw / 2),
        y: pad.t + ch - (p.value / maxV) * ch,
        v: p.value, label: p.label
      };
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1].x.toFixed(1) + ',' + (pad.t + ch) + ' L' + pts[0].x.toFixed(1) + ',' + (pad.t + ch) + ' Z';
    var body = gridY(W, H, pad, maxV, res.metric);
    body += '<path d="' + area + '" class="pv-line-area" fill="var(--pri)"/>';
    body += '<path d="' + line + '" class="pv-line" stroke="var(--pri)"/>';
    var labelStep = points.length <= 8 ? 1 : Math.ceil(points.length / 8);
    pts.forEach(function (p, i) {
      body += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.5" class="pv-dot" fill="var(--card)" stroke="var(--pri)" stroke-width="2"><title>' + escAttr(p.label + '：' + fmtCell(p.v, res.metric)) + '</title></circle>';
      if (i % labelStep === 0 || i === pts.length - 1) {
        body += '<text x="' + p.x.toFixed(1) + '" y="' + (H - 10) + '" class="pv-xlabel">' + esc(p.label) + '</text>';
      }
    });
    return '<div class="pv-chart-note">' + esc(xTitle) + ' · 指标 ' + esc(res.metric) + '</div>'
      + svgOpen(W, H, '折线图') + body + '</svg>';
  }

  // 环形：行合计占比，≤6 段
  function chartDonut(res) {
    var folded = foldRowsForChart(res.rows, 6);
    var rows = folded.list.filter(function (r) { return (r.value || 0) > 0; });
    if (!rows.length) return chartHint('没有可绘制的数据');
    if (rows.length < 2) {
      return chartHint('只有 1 个分类，用柱状或条形更合适<br><span style="font-size:12px">或把行维度改成更细的分类</span>');
    }
    var total = rows.reduce(function (s, r) { return s + (r.value || 0); }, 0);
    if (!(total > 0)) return chartHint('合计为 0，无法画占比');
    var size = typeof window !== 'undefined' && window.innerWidth > 768 ? 220 : 180;
    var cx = size / 2, cy = size / 2;
    var t = Math.max(size * 0.14, 16);
    var r = (size - t) / 2;
    var C = 2 * Math.PI * r;
    var colorMap = buildColorMap(rows.map(function (x) { return x.label; }));
    var cum = 0, segs = '';
    rows.forEach(function (row) {
      if (row.value <= 0) return;
      var pct = row.value / total;
      var L = pct * C;
      var color = colorMap[row.label];
      segs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + t + '" stroke-dasharray="' + L.toFixed(2) + ' ' + (C - L).toFixed(2) + '" stroke-dashoffset="' + (-cum).toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"><title>' + escAttr(row.label + '：' + fmtCell(row.value, res.metric) + '（' + (pct * 100).toFixed(1) + '%）') + '</title></circle>';
      cum += L;
    });
    var pairs = rows.map(function (row) {
      return { label: row.label, value: row.value, color: colorMap[row.label] };
    });
    var centerVal = fmtCell(total, res.metric);
    var svg = svgOpen(size, size, '环形图')
      + '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--border)" stroke-width="' + t + '"/>'
      + segs
      + '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="15" font-weight="800" fill="var(--text)">' + esc(centerVal) + '</text>'
      + '<text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" font-size="11" fill="var(--muted)">合计</text>'
      + '</svg>';
    return '<div class="pv-donut-wrap">' + svg
      + '<div class="pv-donut-side">'
      + pairs.map(function (p) {
        var pct = total ? (p.value / total * 100).toFixed(1) : '0';
        return '<div class="pv-dl-item"><i style="background:' + p.color + '"></i>'
          + '<span class="pv-dl-label" title="' + escAttr(p.label) + '">' + esc(p.label) + '</span>'
          + '<span class="pv-dl-val">' + esc(fmtCell(p.value, res.metric)) + '</span>'
          + '<span class="pv-dl-pct">' + pct + '%</span></div>';
      }).join('')
      + '</div></div>'
      + (folded.other ? '<div class="pv-fold-note">超过 6 段已折叠，完整数据见表格</div>' : '');
  }

  // 堆叠：列作为系列（需列≠无）
  function chartStack(res) {
    if (cfg.col === '无') {
      return chartHint('堆叠图需要「列」维度<br><span style="font-size:12px">把列设为月份、分类、平台…</span>');
    }
    var cols = res.cols.filter(function (c) { return c !== '合计'; });
    if (!cols.length) return chartHint('没有列数据');
    var folded = foldRowsForChart(res.rows, 10);
    var rows = folded.list;
    var colorMap = buildColorMap(cols);
    var isDesk = typeof window !== 'undefined' && window.innerWidth > 768;
    var W = isDesk ? 860 : 360;
    var H = isDesk ? 300 : 230;
    var pad = { t: 16, r: 10, b: 48, l: 44 };
    var cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
    var totals = rows.map(function (r) {
      return cols.reduce(function (s, c) {
        var cell = r.cells[c];
        return s + (cell ? cell.value : 0);
      }, 0);
    });
    var maxV = Math.max.apply(null, totals.concat([1]));
    var gap = cw / rows.length;
    var barW = Math.max(6, Math.min(gap * 0.55, 34));
    var body = gridY(W, H, pad, maxV, res.metric);
    rows.forEach(function (row, i) {
      var x = pad.l + i * gap + (gap - barW) / 2;
      var acc = 0;
      var tipParts = [];
      cols.forEach(function (c) {
        var cell = row.cells[c];
        var v = cell ? cell.value : 0;
        if (v <= 0) return;
        tipParts.push(c + ' ' + fmtCell(v, res.metric));
        var segH = (v / maxV) * ch;
        var y = pad.t + ch - acc - segH;
        // 2px 表面缝：高度略减
        var drawH = Math.max(segH - (segH > 4 ? 2 : 0), 1);
        body += '<rect class="pv-bar" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + drawH.toFixed(1) + '" rx="2" fill="' + colorMap[c] + '"><title>' + escAttr(row.label + ' · ' + c + '：' + fmtCell(v, res.metric)) + '</title></rect>';
        acc += segH;
      });
      var short = row.label.length > (isDesk ? 6 : 4) ? row.label.slice(0, isDesk ? 6 : 4) + '…' : row.label;
      body += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - pad.b + 14) + '" class="pv-xlabel"><title>' + escAttr(row.label) + '</title>' + esc(short) + '</text>';
    });
    var legend = legendHtml(cols.map(function (c) {
      return { label: c, value: metricValue(res.colTotals[c] || { amount: 0, count: 0 }, res.metric), color: colorMap[c] };
    }));
    return legend + svgOpen(W, H, '堆叠柱状图') + body + '</svg>'
      + (folded.other ? '<div class="pv-fold-note">行已折叠为「' + esc(folded.other.label) + '」，完整数据见表格</div>' : '');
  }

  // 热力：行×列 单色深浅
  function chartHeat(res) {
    if (cfg.col === '无') {
      return chartHint('热力图需要「列」维度<br><span style="font-size:12px">把列设为月份、分类、平台…</span>');
    }
    var cols = res.cols.filter(function (c) { return c !== '合计'; });
    var folded = foldRowsForChart(res.rows, 14);
    var rows = folded.list;
    if (!rows.length || !cols.length) return chartHint('没有可绘制的数据');
    var maxV = 0;
    rows.forEach(function (r) {
      cols.forEach(function (c) {
        var cell = r.cells[c];
        var v = cell ? cell.value : 0;
        if (v > maxV) maxV = v;
      });
    });
    if (!(maxV > 0)) return chartHint('所有单元格为 0');
    var html = '<div class="pv-heat" role="table" aria-label="热力图">';
    html += '<div class="pv-heat-row pv-heat-head" role="row"><div class="pv-heat-corner" role="columnheader">' + esc(cfg.row) + ' ╲ ' + esc(dimLabel(cfg.col)) + '</div>';
    cols.forEach(function (c) {
      html += '<div class="pv-heat-col" role="columnheader" title="' + escAttr(c) + '">' + esc(c) + '</div>';
    });
    html += '</div>';
    rows.forEach(function (row, ri) {
      html += '<div class="pv-heat-row" role="row">';
      html += '<div class="pv-heat-rowlab" role="rowheader" title="' + escAttr(row.label) + '">' + esc(row.label) + '</div>';
      cols.forEach(function (c, ci) {
        var cell = row.cells[c];
        var v = cell ? cell.value : 0;
        var t = maxV > 0 ? v / maxV : 0;
        var bg = v > 0 ? seqColor(t) : (isDark() ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.03)');
        var fg = v > 0 && t > 0.55 ? '#fff' : 'var(--text)';
        html += '<div class="pv-heat-cell" role="cell" style="background:' + bg + ';color:' + fg + '" '
          + 'title="' + escAttr(row.label + ' · ' + c + '：' + fmtCell(v, res.metric)) + '" '
          + 'onclick="pivotShowDetail(' + ri + ',' + ci + ')">'
          + esc(v > 0 ? fmtCell(v, res.metric) : '·') + '</div>';
      });
      html += '</div>';
    });
    html += '</div>';
    html += '<div class="pv-heat-scale"><span>低</span><i class="pv-heat-ramp"></i><span>高（' + esc(fmtCell(maxV, res.metric)) + '）</span></div>';
    if (folded.other) html += '<div class="pv-fold-note">行已折叠为「' + esc(folded.other.label) + '」，完整数据见表格</div>';
    return html;
  }

  function renderChart(res, wrap) {
    var type = cfg.chart;
    var html = '';
    if (type === '柱状') html = chartColumn(res);
    else if (type === '条形') html = chartBar(res);
    else if (type === '折线') html = chartLine(res);
    else if (type === '环形') html = chartDonut(res);
    else if (type === '堆叠') html = chartStack(res);
    else if (type === '热力') html = chartHeat(res);
    else html = chartColumn(res);
    html += '<div class="pv-chart-foot">图表类型：' + esc(type) + ' · 点热力格可看明细 · 切到「表格」查看全部数字</div>';
    wrap.innerHTML = html;
  }

  // ---- 面板骨架 ----
  function chipRow(group, options, current) {
    return '<div class="pivot-chips">' + options.map(function (o) {
      var active = current === o;
      return '<button type="button" class="chip' + (active ? ' active' : '') + '" data-pivot-group="' + group + '" data-pivot-value="' + escAttr(o) + '" aria-pressed="' + active + '" onclick="pivotSet(\'' + group + '\',\'' + escAttr(o) + '\')">' + esc(o) + '</button>';
    }).join('') + '</div>';
  }

  function buildShell() {
    var html = '';
    html += '<div class="pivot-config">';
    html += '<div class="pivot-config-row"><span class="pivot-config-label">范围</span>' + chipRow('range', RANGES, cfg.range) + '</div>';
    html += '<div class="pivot-custom" id="pivotCustomRange"><input type="date" id="pivotFrom" value="' + escAttr(cfg.from) + '" onchange="pivotCustomChanged()"><span style="color:var(--muted)">~</span><input type="date" id="pivotTo" value="' + escAttr(cfg.to) + '" onchange="pivotCustomChanged()"></div>';
    html += '<div class="pivot-config-row"><span class="pivot-config-label">数据</span>' + chipRow('source', SOURCES, cfg.source) + '</div>';
    html += '<div class="pivot-config-row"><span class="pivot-config-label">行</span>' + chipRow('row', DIMS, cfg.row) + '</div>';
    html += '<div class="pivot-config-row"><span class="pivot-config-label">列</span>' + chipRow('col', COLS, cfg.col) + '</div>';
    html += '<div class="pivot-config-row"><span class="pivot-config-label">指标</span>' + chipRow('metric', METRICS, cfg.metric) + '</div>';
    html += '<div class="pivot-config-row"><span class="pivot-config-label">视图</span>' + chipRow('view', VIEWS, cfg.view) + '</div>';
    html += '<div class="pivot-config-row pivot-chart-row" id="pivotChartRow"><span class="pivot-config-label">图表</span>' + chipRow('chart', CHARTS, cfg.chart) + '</div>';
    html += '<input class="search-input pivot-keyword" id="pivotKeyword" type="search" placeholder="关键词过滤，逗号分隔：喜茶,蜜雪（匹配商品/备注/分类/平台）" value="' + escAttr(cfg.keyword) + '" oninput="pivotKeywordInput(this.value)">';
    html += '</div>';
    html += '<div class="pivot-summary" id="pivotSummary"></div>';
    html += '<div class="pivot-table-wrap" id="pivotTableWrap"></div>';
    html += '<div id="pivotDetail"></div>';
    html += '<div class="pivot-export"><button type="button" class="chip" onclick="pivotExport()">⬇️ 导出当前透视 CSV</button></div>';
    html += '<details class="pivot-groups" id="pivotGroupsBox"><summary>🏷️ 关键词组 <span id="pivotGroupCount" style="color:var(--muted);font-weight:400"></span></summary>';
    html += '<div class="pivot-group-hint">把品牌/商品词归成一组，例如：奶茶 = 喜茶、蜜雪、茶百道；API = Claude、OpenAI、token。透视行选「商品组」即可按组汇总。</div>';
    html += '<div id="pivotGroupList"></div>';
    html += '<div class="pivot-group-editor" id="pivotGroupEditor">';
    html += '<input id="pivotGroupName" maxlength="20" placeholder="组名，如 奶茶">';
    html += '<textarea id="pivotGroupKeywords" rows="2" placeholder="关键词，逗号分隔：喜茶,蜜雪,茶百道"></textarea>';
    html += '<div class="pivot-group-actions"><button type="button" class="pivot-btn-primary" onclick="pivotSaveGroup()">保存组</button><button type="button" class="pivot-btn-ghost" onclick="pivotCancelGroup()">取消</button></div>';
    html += '</div>';
    html += '<div class="pivot-group-tools"><button type="button" class="chip" onclick="pivotNewGroup()">＋ 新建组</button><button type="button" class="chip" onclick="pivotResetGroups()">恢复默认组</button></div>';
    html += '</details>';
    return html;
  }

  function syncControls() {
    var els = document.querySelectorAll('#pivotBody [data-pivot-group]');
    for (var i = 0; i < els.length; i++) {
      var g = els[i].getAttribute('data-pivot-group');
      var v = els[i].getAttribute('data-pivot-value');
      var active = String(cfg[g]) === v;
      els[i].classList.toggle('active', active);
      els[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    var box = document.getElementById('pivotCustomRange');
    if (box) {
      box.style.display = cfg.range === '自定义' ? 'flex' : 'none';
      var f = document.getElementById('pivotFrom');
      var t = document.getElementById('pivotTo');
      if (f) f.value = cfg.from || '';
      if (t) t.value = cfg.to || '';
    }
    var kw = document.getElementById('pivotKeyword');
    if (kw && document.activeElement !== kw) kw.value = cfg.keyword || '';
    var chartRow = document.getElementById('pivotChartRow');
    if (chartRow) chartRow.style.display = cfg.view === '图表' ? 'flex' : 'none';
  }

  // ---- 渲染 ----
  function renderGroups() {
    var list = document.getElementById('pivotGroupList');
    var count = document.getElementById('pivotGroupCount');
    if (count) count.textContent = '· ' + groups.length + ' 组';
    if (!list) return;
    if (!groups.length) {
      list.innerHTML = '<div class="pivot-group-hint">还没有关键词组，点「新建组」添加；也可以点「恢复默认组」。</div>';
      return;
    }
    list.innerHTML = groups.map(function (g) {
      var kw = (g.keywords || []).join('、');
      return '<div class="pivot-group-item">'
        + '<span class="pivot-group-name">' + esc(g.name) + '</span>'
        + '<span class="pivot-group-kws" title="' + escAttr(kw) + '">' + esc(kw || '（无关键词）') + '</span>'
        + '<button type="button" onclick="pivotEditGroup(\'' + escAttr(g.id) + '\')">编辑</button>'
        + '<button type="button" onclick="pivotDeleteGroup(\'' + escAttr(g.id) + '\')">删除</button>'
        + '</div>';
    }).join('');
  }

  function summaryHtml(built) {
    var res = last ? last.res : null;
    var total = built.events.reduce(function (s, e) { return s + e.amount; }, 0);
    var text = '共 <b>' + built.events.length + '</b> 笔 · 合计 <b>' + money(total) + '</b> · 范围 ' + esc(built.bounds.label);
    if (cfg.keyword) text += ' · 关键词「' + esc(cfg.keyword) + '」';
    if (res && cfg.row === '商品组') text += ' · 已匹配关键词组';
    return text;
  }

  function renderTable() {
    var wrap = document.getElementById('pivotTableWrap');
    var sumEl = document.getElementById('pivotSummary');
    if (!wrap) return;
    var built = buildEvents();
    var res = computePivot(built.events, cfg);
    last = { events: built.events, res: res, cfg: clone(cfg), bounds: built.bounds };
    if (sumEl) sumEl.innerHTML = summaryHtml(built);
    if (!built.events.length) {
      wrap.innerHTML = '<div class="pivot-empty">没有符合条件的流水<br><span style="font-size:12px">试试把范围改成「全部」，或清空关键词</span></div>';
      return;
    }

    if (cfg.view === '图表') {
      renderChart(res, wrap);
      return;
    }

    var cols = res.cols;
    var rows = res.rows;
    var hidden = 0;
    if (!showAllRows && rows.length > 30) { hidden = rows.length - 30; rows = rows.slice(0, 30); }

    var html = '<table class="pivot-table"><thead><tr>';
    html += '<th class="pivot-corner">' + esc(cfg.row) + ' ╲ ' + esc(dimLabel(cfg.col)) + '</th>';
    cols.forEach(function (col) { html += '<th>' + esc(col) + '</th>'; });
    if (cfg.col !== '无') html += '<th class="pivot-total">合计</th>';
    html += '</tr></thead><tbody>';

    rows.forEach(function (row, ri) {
      html += '<tr>';
      html += '<td class="pivot-rowlabel" title="' + escAttr(row.label) + '" onclick="pivotShowDetail(' + ri + ',-1)">' + esc(row.label) + '</td>';
      cols.forEach(function (col, ci) {
        var cell = row.cells[col];
        var v = cell ? cell.value : 0;
        html += '<td class="pivot-cell" onclick="pivotShowDetail(' + ri + ',' + ci + ')">' + fmtCell(v, cfg.metric) + '</td>';
      });
      if (cfg.col !== '无') html += '<td class="pivot-total">' + fmtCell(row.value, cfg.metric) + '</td>';
      html += '</tr>';
    });
    html += '</tbody><tfoot><tr><th>合计</th>';
    cols.forEach(function (col) {
      var ct = res.colTotals[col] || { amount: 0, count: 0 };
      html += '<td>' + fmtCell(metricValue(ct, cfg.metric), cfg.metric) + '</td>';
    });
    if (cfg.col !== '无') html += '<td class="pivot-total">' + fmtCell(metricValue(res.grand, cfg.metric), cfg.metric) + '</td>';
    html += '</tr></tfoot></table>';

    if (hidden > 0) {
      html += '<div class="pivot-more"><button type="button" class="chip" onclick="pivotToggleAll()">显示全部 ' + res.rows.length + ' 行（还有 ' + hidden + ' 行）</button></div>';
    } else if (showAllRows && res.rows.length > 30) {
      html += '<div class="pivot-more"><button type="button" class="chip" onclick="pivotToggleAll()">收起，只看前 30 行</button></div>';
    }
    wrap.innerHTML = html;
  }

  function showDetail(rowIdx, colIdx) {
    var box = document.getElementById('pivotDetail');
    if (!box || !last) return;
    var row = last.res.rows[rowIdx];
    if (!row) return;
    var colLabel = colIdx >= 0 ? last.res.cols[colIdx] : '';
    var colDim = last.cfg.col;
    var evs = last.events.filter(function (ev) {
      if (dimValue(ev, last.cfg.row) !== row.label) return false;
      if (colLabel && colDim !== '无' && dimValue(ev, colDim) !== colLabel) return false;
      return true;
    });
    evs.sort(function (a, b) { return b.ts - a.ts || b.amount - a.amount; });
    var total = evs.reduce(function (s, e) { return s + e.amount; }, 0);
    var title = esc(row.label) + (colLabel ? ' × ' + esc(colLabel) : '');
    var shown = evs.slice(0, 200);
    var list = shown.map(function (ev) {
      var badge = ev.kind === 'expense'
        ? '<span class="pivot-badge">' + esc(ev.source) + '</span>'
        : '<span class="pivot-badge">' + esc(ev.source === '分期' ? '分期' : '采购') + '</span>';
      return '<li class="pivot-detail-item">'
        + '<div class="pivot-detail-main"><div class="pivot-detail-name">' + esc(ev.title) + badge + '</div>'
        + '<div class="pivot-detail-meta">' + esc(ev.day || '日期未知') + ' · ' + esc(ev.category) + ' · ' + esc(ev.platform) + ' · ' + esc(ev.how) + '</div>'
        + (ev.group && ev.group !== '未分组' ? '<div class="pivot-detail-meta">组：' + esc(ev.group) + '</div>' : '')
        + '</div><div class="pivot-detail-amt">' + money(ev.amount) + '</div></li>';
    }).join('');
    box.innerHTML = '<div class="pivot-detail">'
      + '<div class="pivot-detail-head"><div><div class="pivot-detail-title">' + title + '</div>'
      + '<div class="pivot-detail-sub">' + evs.length + ' 笔 · 合计 ' + money(total) + (evs.length > 200 ? ' · 仅显示最近 200 笔' : '') + '</div></div>'
      + '<button type="button" class="pivot-detail-close" aria-label="关闭明细" onclick="pivotCloseDetail()">✕</button></div>'
      + '<ul class="pivot-detail-list">' + list + '</ul></div>';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closeDetail() { var box = document.getElementById('pivotDetail'); if (box) box.innerHTML = ''; }

  // ---- 配置交互 ----
  function setCfg(key, val) {
    if (key === 'col' && val !== '无' && val === cfg.row) { if (typeof toast === 'function') toast('行和列不能选同一个维度'); return; }
    cfg[key] = val;
    if (key === 'range' && val === '自定义') {
      if (!cfg.from || !cfg.to) {
        var d = bjNow();
        cfg.from = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-01';
        cfg.to = todayStr();
      }
    }
    if (key === 'row' && cfg.col === val) cfg.col = '无';
    showAllRows = false;
    closeDetail();
    saveCfg(); syncControls(); renderTable();
  }

  function customChanged() {
    var f = document.getElementById('pivotFrom');
    var t = document.getElementById('pivotTo');
    cfg.from = f ? f.value : '';
    cfg.to = t ? t.value : '';
    if (cfg.from && cfg.to && cfg.from > cfg.to) { var tmp = cfg.from; cfg.from = cfg.to; cfg.to = tmp; }
    cfg.range = '自定义';
    showAllRows = false;
    closeDetail();
    saveCfg(); syncControls(); renderTable();
  }

  function keywordInput(v) {
    cfg.keyword = String(v || '').slice(0, 100);
    if (kwTimer) clearTimeout(kwTimer);
    kwTimer = setTimeout(function () { closeDetail(); saveCfg(); renderTable(); }, 220);
  }

  function toggleAll() { showAllRows = !showAllRows; closeDetail(); renderTable(); }

  // ---- 关键词组编辑 ----
  function showGroupEditor(g) {
    var box = document.getElementById('pivotGroupEditor');
    var nameEl = document.getElementById('pivotGroupName');
    var kwEl = document.getElementById('pivotGroupKeywords');
    if (!box || !nameEl || !kwEl) return;
    editingGroupId = g ? g.id : '';
    nameEl.value = g ? g.name : '';
    kwEl.value = g ? (g.keywords || []).join(',') : '';
    box.style.display = 'block';
    nameEl.focus();
  }
  function newGroup() { showGroupEditor(null); }
  function editGroup(id) {
    var g = groups.filter(function (x) { return x.id === id; })[0];
    if (g) showGroupEditor(g);
  }
  function cancelGroup() {
    var box = document.getElementById('pivotGroupEditor');
    if (box) box.style.display = 'none';
    editingGroupId = '';
  }
  function saveGroup() {
    var nameEl = document.getElementById('pivotGroupName');
    var kwEl = document.getElementById('pivotGroupKeywords');
    var name = nameEl ? String(nameEl.value || '').trim().slice(0, 20) : '';
    if (!name) { if (typeof toast === 'function') toast('请填写组名'); return; }
    var kws = normalizeKeywords(kwEl ? kwEl.value : '');
    if (!kws.length) { if (typeof toast === 'function') toast('请填写至少一个关键词'); return; }
    var dup = groups.filter(function (g) { return g.name === name && g.id !== editingGroupId; })[0];
    if (dup) { if (typeof toast === 'function') toast('已有同名组'); return; }
    if (editingGroupId) {
      var g = groups.filter(function (x) { return x.id === editingGroupId; })[0];
      if (g) { g.name = name; g.keywords = kws; }
    } else {
      groups.push({ id: 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name, keywords: kws });
    }
    saveGroups(); cancelGroup(); renderGroups(); renderTable();
    if (typeof toast === 'function') toast('关键词组已保存');
  }
  function deleteGroup(id) {
    var g = groups.filter(function (x) { return x.id === id; })[0];
    if (!g) return;
    if (typeof confirm === 'function' && !confirm('删除关键词组「' + g.name + '」？')) return;
    groups = groups.filter(function (x) { return x.id !== id; });
    saveGroups(); renderGroups(); renderTable();
  }
  function resetGroups() {
    if (typeof confirm === 'function' && !confirm('恢复默认关键词组？当前自定义组会被覆盖。')) return;
    groups = clone(DEFAULT_GROUPS);
    saveGroups(); renderGroups(); renderTable();
  }

  // ---- CSV 导出 ----
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csvNum(v, metric) {
    if (metric === '笔数') return String(Math.round(Number(v) || 0));
    return String(Math.round((Number(v) || 0) * 100) / 100);
  }
  function exportCsv() {
    if (!last) return;
    var res = last.res, metric = last.cfg.metric;
    var lines = [];
    var head = ['行＼列'].concat(res.cols);
    if (last.cfg.col !== '无') head.push('合计');
    lines.push(head.map(csvCell).join(','));
    res.rows.forEach(function (row) {
      var line = [row.label];
      res.cols.forEach(function (col) { var cell = row.cells[col]; line.push(csvNum(cell ? cell.value : 0, metric)); });
      if (last.cfg.col !== '无') line.push(csvNum(row.value, metric));
      lines.push(line.map(csvCell).join(','));
    });
    var foot = ['合计'];
    res.cols.forEach(function (col) { foot.push(csvNum(metricValue(res.colTotals[col] || { amount: 0, count: 0 }, metric), metric)); });
    if (last.cfg.col !== '无') foot.push(csvNum(metricValue(res.grand, metric), metric));
    lines.push(foot.map(csvCell).join(','));
    var d = bjNow();
    var stamp = d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + '_' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes());
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '数据透视_' + stamp + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---- 打开 / 关闭 ----
  function openPivot() {
    try {
      loadCfg(); loadGroups();
      var ov = document.getElementById('pivotOverlay');
      var body = document.getElementById('pivotBody');
      if (!ov || !body) return;
      if (!body.getAttribute('data-built')) {
        body.innerHTML = buildShell();
        body.setAttribute('data-built', '1');
      }
      showAllRows = false;
      closeDetail(); cancelGroup();
      if (!cfg.from || !cfg.to) {
        var d = bjNow();
        cfg.from = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-01';
        cfg.to = todayStr();
      }
      syncControls(); renderGroups(); renderTable();
      ov.classList.add('active');
    } catch (e) {
      console.error('openPivot', e);
      if (typeof toast === 'function') toast('打开透视失败');
    }
  }
  function closePivot() {
    var ov = document.getElementById('pivotOverlay');
    if (ov) ov.classList.remove('active');
    if (kwTimer) { clearTimeout(kwTimer); kwTimer = null; }
    saveCfg();
  }

  App.pivot = {
    open: openPivot,
    close: closePivot,
    set: setCfg,
    customChanged: customChanged,
    keywordInput: keywordInput,
    renderTable: renderTable,
    showDetail: showDetail,
    closeDetail: closeDetail,
    exportCsv: exportCsv,
    toggleAll: toggleAll,
    newGroup: newGroup,
    editGroup: editGroup,
    saveGroup: saveGroup,
    cancelGroup: cancelGroup,
    deleteGroup: deleteGroup,
    resetGroups: resetGroups,
    _buildEvents: buildEvents,
    _buildExpenseEvents: buildExpenseEvents,
    _buildPurchaseEvents: buildPurchaseEvents,
    _computePivot: computePivot,
    _matchGroup: matchGroup,
    _normalizeKeywords: normalizeKeywords,
    _rangeBounds: rangeBounds,
    _dimValue: dimValue,
    _foldRowsForChart: foldRowsForChart,
    _buildColorMap: buildColorMap,
    _renderChart: renderChart,
    _setGroups: function (gs) { groups = (gs || []).slice(); },
    _getGroups: function () { return groups.slice(); },
    _getCfg: function () { return clone(cfg); },
    _setCfg: function (c) { Object.keys(c || {}).forEach(function (k) { cfg[k] = c[k]; }); }
  };
  window.openPivot = openPivot;
  window.closePivot = closePivot;
  window.pivotSet = setCfg;
  window.pivotCustomChanged = customChanged;
  window.pivotKeywordInput = keywordInput;
  window.pivotShowDetail = showDetail;
  window.pivotCloseDetail = closeDetail;
  window.pivotExport = exportCsv;
  window.pivotToggleAll = toggleAll;
  window.pivotNewGroup = newGroup;
  window.pivotEditGroup = editGroup;
  window.pivotSaveGroup = saveGroup;
  window.pivotCancelGroup = cancelGroup;
  window.pivotDeleteGroup = deleteGroup;
  window.pivotResetGroups = resetGroups;
})();
