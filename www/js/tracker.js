// tracker.js - 长期跟踪项目：目标 → 里程碑 → 记录 → 周/月汇总 → 结项
// 视图：全局项目看板卡片、详情 表格 / 看板 / 仪表盘；图表只用 CSS + inline SVG。
(function() {
  'use strict';

  var TYPES = [
    ['text', '单行文本'], ['longtext', '多行文本'], ['number', '数字'],
    ['select', '选项'], ['date', '日期'], ['checkbox', '勾选']
  ];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function todayBj() {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function nf(v) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Number(v);
    if (!isFinite(n)) return esc(v);
    return String(Math.round(n * 100) / 100);
  }
  function pctOf(v) {
    var n = Number(v);
    return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
  }
  function typeLabel(t) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i][0] === t) return TYPES[i][1];
    return '文本';
  }
  function fieldByKey(fields, key) {
    for (var i = 0; i < fields.length; i++) if (fields[i].key === key) return fields[i];
    return null;
  }
  function fieldName(fields, key) {
    var f = fieldByKey(fields, key);
    return f ? f.name : (key || '');
  }
  function metricFieldName(label) {
    return label || '';
  }
  function metricText(metric, fields) {
    if (!metric || metric.agg === 'count') return '记录数';
    var name = fieldName(fields, metric.field);
    if (metric.agg === 'countValue') return name + ' = ' + (metric.value || '?') + ' 的次数';
    if (metric.agg === 'countTrue') return name + ' 勾选次数';
    if (metric.agg === 'sum') return name + ' 合计';
    if (metric.agg === 'latest') return name + ' 最新值';
    if (metric.agg === 'max') return name + ' 最大值';
    return '记录数';
  }
  function metricUnit(metric, fields) {
    if (!metric || !metric.field) return '';
    var f = fieldByKey(fields, metric.field);
    return (f && f.unit) ? f.unit : '';
  }

  // ===== 模板 =====
  var TEMPLATES = {
    job: {
      icon: '💼', name: '求职', desc: '投递 → 面试 → Offer',
      fields: [
        { key: 'date', name: '日期', type: 'date', required: true },
        { key: 'company', name: '公司', type: 'text', required: true },
        { key: 'role', name: '岗位', type: 'text' },
        { key: 'event', name: '事件', type: 'select', required: true, options: ['投递', '一面', '二面', '三面', 'Offer', '已结束'] },
        { key: 'channel', name: '渠道', type: 'select', options: ['BOSS', '猎聘', '内推', '官网', '其他'] },
        { key: 'next', name: '下一步', type: 'text' },
        { key: 'note', name: '备注', type: 'longtext' }
      ],
      goal: { text: '拿到 Offer', kind: 'number', metric: { agg: 'countValue', field: 'event', value: 'Offer' }, target: 1, unit: '个', direction: 'up' },
      week: { target: 5, unit: '份', metric: { agg: 'countValue', field: 'event', value: '投递' } },
      milestones: [
        { name: '简历定稿' }, { name: '投满 20 份' }, { name: '第一次面试' },
        { name: '进入二面' }, { name: '拿到 Offer' }
      ],
      titleField: 'company', kanbanField: 'event'
    },
    fitness: {
      icon: '🏃', name: '健身减重', desc: '体重 / 训练 / 围度',
      fields: [
        { key: 'date', name: '日期', type: 'date', required: true },
        { key: 'content', name: '训练内容', type: 'text', required: true },
        { key: 'part', name: '部位', type: 'select', required: true, options: ['胸', '背', '腿', '肩', '手臂', '核心', '有氧', '休息'] },
        { key: 'minutes', name: '时长', type: 'number', unit: '分钟' },
        { key: 'weight', name: '体重', type: 'number', unit: 'kg' },
        { key: 'intensity', name: '强度', type: 'select', options: ['低', '中', '高'] },
        { key: 'note', name: '备注', type: 'longtext' }
      ],
      goal: { text: '减到 65kg', kind: 'number', metric: { agg: 'latest', field: 'weight' }, target: 65, unit: 'kg', direction: 'down' },
      week: { target: 3, unit: '次', metric: { agg: 'count' } },
      milestones: [
        { name: '减 2kg' }, { name: '减 5kg' }, { name: '连续 4 周每周 3 练' }, { name: '达到目标体重' }
      ],
      titleField: 'content', kanbanField: 'part'
    },
    reading: {
      icon: '📚', name: '读书', desc: '一本一本读完',
      fields: [
        { key: 'date', name: '日期', type: 'date', required: true },
        { key: 'book', name: '书名', type: 'text', required: true },
        { key: 'pages', name: '页数', type: 'number', unit: '页' },
        { key: 'minutes', name: '时长', type: 'number', unit: '分钟' },
        { key: 'status', name: '状态', type: 'select', required: true, options: ['在读', '读完', '暂停'] },
        { key: 'note', name: '摘记', type: 'longtext' }
      ],
      goal: { text: '读完 12 本书', kind: 'number', metric: { agg: 'countValue', field: 'status', value: '读完' }, target: 12, unit: '本', direction: 'up' },
      week: { target: 3, unit: '次', metric: { agg: 'count' } },
      milestones: [{ name: '读完第 1 本' }, { name: '读完第 6 本' }, { name: '读完 12 本' }],
      titleField: 'book', kanbanField: 'status'
    },
    study: {
      icon: '🎓', name: '学习备考', desc: '复习 → 模拟 → 通过',
      fields: [
        { key: 'date', name: '日期', type: 'date', required: true },
        { key: 'subject', name: '科目', type: 'text', required: true },
        { key: 'content', name: '内容', type: 'longtext' },
        { key: 'minutes', name: '时长', type: 'number', unit: '分钟' },
        { key: 'score', name: '得分', type: 'number', unit: '分' },
        { key: 'status', name: '状态', type: 'select', required: true, options: ['学习中', '已完成', '暂停'] },
        { key: 'note', name: '备注', type: 'longtext' }
      ],
      goal: { text: '通过考试', kind: 'milestone', metric: { agg: 'count' }, target: null, unit: '', direction: 'up' },
      week: { target: 5, unit: '次', metric: { agg: 'count' } },
      milestones: [{ name: '完成第一轮复习' }, { name: '模拟考达到 80 分' }, { name: '通过考试' }],
      titleField: 'subject', kanbanField: 'status'
    },
    habit: {
      icon: '🔁', name: '习惯养成', desc: '每天 / 每周坚持',
      fields: [
        { key: 'date', name: '日期', type: 'date', required: true },
        { key: 'habit', name: '习惯', type: 'text', required: true },
        { key: 'done', name: '完成', type: 'checkbox' },
        { key: 'period', name: '时段', type: 'select', options: ['早', '午', '晚'] },
        { key: 'minutes', name: '时长', type: 'number', unit: '分钟' },
        { key: 'feeling', name: '感受', type: 'longtext' }
      ],
      goal: { text: '坚持 60 次', kind: 'number', metric: { agg: 'countTrue', field: 'done' }, target: 60, unit: '次', direction: 'up' },
      week: { target: 5, unit: '次', metric: { agg: 'countTrue', field: 'done' } },
      milestones: [{ name: '连续 7 天' }, { name: '连续 14 天' }, { name: '连续 30 天' }],
      titleField: 'habit', kanbanField: 'period'
    },
    custom: {
      icon: '✨', name: '自定义', desc: '从空白开始',
      fields: [
        { key: 'date', name: '日期', type: 'date' },
        { key: 'title', name: '标题', type: 'text', required: true },
        { key: 'detail', name: '详情', type: 'longtext' },
        { key: 'value', name: '数值', type: 'number' },
        { key: 'status', name: '状态', type: 'select', options: ['进行中', '已完成'] }
      ],
      goal: { text: '', kind: 'number', metric: { agg: 'count' }, target: null, unit: '', direction: 'up' },
      week: { target: 3, unit: '次', metric: { agg: 'count' } },
      milestones: [],
      titleField: 'title', kanbanField: 'status'
    }
  };

  function templateConfig(key) {
    var t = TEMPLATES[key] || TEMPLATES.custom;
    var ms = (t.milestones || []).map(function(m, i) {
      return { id: 'm' + (i + 1), name: m.name, targetDate: '', targetValue: null, done: false, doneDate: '' };
    });
    return {
      template: key,
      startDate: todayBj(),
      targetDate: '',
      goal: clone(t.goal),
      week: clone(t.week),
      milestones: ms,
      dateField: 'date',
      titleField: t.titleField || '',
      kanbanField: t.kanbanField || '',
      closed: null
    };
  }
  function templateFields(key) {
    var t = TEMPLATES[key] || TEMPLATES.custom;
    return clone(t.fields);
  }

  // ===== 新建表单（嵌在项目弹窗里）=====
  var _createKey = 'job';
  var _createDraft = null;

  function renderTemplateChips() {
    var box = document.getElementById('pjTemplateChips');
    if (!box) return;
    box.innerHTML = Object.keys(TEMPLATES).map(function(k) {
      var t = TEMPLATES[k];
      return '<button type="button" class="trk-tpl-chip' + (k === _createKey ? ' active' : '') + '" onclick="App.tracker.pickTemplate(\'' + k + '\')">'
        + '<b>' + t.icon + ' ' + esc(t.name) + '</b><span>' + esc(t.desc) + '</span></button>';
    }).join('');
  }

  function renderCreatePreview() {
    var box = document.getElementById('pjTrackFieldsPreview');
    if (!box || !_createDraft) return;
    var fs = _createDraft.fields;
    box.innerHTML = '<div class="trk-fields-preview-head">记录字段 <em>' + fs.length + ' 个 · 创建后可改</em></div>'
      + '<div class="trk-field-chips">' + fs.map(function(f) {
        return '<span class="trk-field-chip">' + esc(f.name) + (f.required ? '<i>*</i>' : '')
          + '<em>' + esc(typeLabel(f.type)) + (f.unit ? ' · ' + esc(f.unit) : '') + '</em></span>';
      }).join('') + '</div>';

    var hint = document.getElementById('pjTrackMetricHint');
    if (hint) {
      var c = _createDraft.config;
      var parts = [];
      parts.push('统计口径：' + metricText(c.goal.metric, fs) + (c.goal.kind === 'milestone' ? '（目标按里程碑计算）' : ''));
      if (c.week.target > 0) parts.push('每周目标：' + c.week.target + ' ' + c.week.unit + '（' + metricText(c.week.metric, fs) + '）');
      parts.push('周汇总：北京时间周一 ~ 周日');
      hint.innerHTML = esc(parts.join(' · '));
    }
  }

  function applyTemplateToInputs() {
    if (!_createDraft) return;
    var c = _createDraft.config;
    var map = {
      projectGoalText: c.goal.text || '',
      projectGoalTarget: c.goal.target == null ? '' : c.goal.target,
      projectGoalUnit: c.goal.unit || '',
      projectWeekTarget: c.week.target || '',
      projectWeekUnit: c.week.unit || '',
      projectStartDate: c.startDate || todayBj(),
      projectTargetDate: c.targetDate || ''
    };
    Object.keys(map).forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.value = map[id];
    });
    var dir = document.getElementById('projectGoalDirection');
    if (dir) dir.value = c.goal.direction === 'down' ? 'down' : 'up';
  }

  function pickTemplate(key) {
    if (!TEMPLATES[key]) key = 'custom';
    _createKey = key;
    _createDraft = { fields: templateFields(key), config: templateConfig(key) };
    renderTemplateChips();
    applyTemplateToInputs();
    renderCreatePreview();
    var hint = document.getElementById('pjTemplateHint');
    if (hint) hint.textContent = TEMPLATES[key].icon + ' ' + TEMPLATES[key].name + '：' + TEMPLATES[key].desc + '。字段和统计口径创建后还能改。';
  }

  function setupCreateForm() {
    if (!_createDraft) pickTemplate(_createKey || 'job');
    else {
      renderTemplateChips();
      applyTemplateToInputs();
      renderCreatePreview();
    }
  }

  function buildCreatePayload() {
    if (!_createDraft) pickTemplate(_createKey || 'job');
    var fields = clone(_createDraft.fields);
    var config = clone(_createDraft.config);
    var goalText = (document.getElementById('projectGoalText') || {}).value;
    goalText = String(goalText || '').trim();
    if (!goalText) throw new Error('请填写项目目标');
    config.goal.text = goalText;
    var gv = (document.getElementById('projectGoalTarget') || {}).value;
    config.goal.target = gv === '' || gv == null ? null : Number(gv);
    config.goal.unit = String((document.getElementById('projectGoalUnit') || {}).value || '').trim();
    config.goal.direction = ((document.getElementById('projectGoalDirection') || {}).value === 'down') ? 'down' : 'up';
    var wv = (document.getElementById('projectWeekTarget') || {}).value;
    config.week.target = wv === '' || wv == null ? 0 : Number(wv);
    config.week.unit = String((document.getElementById('projectWeekUnit') || {}).value || '').trim();
    config.startDate = String((document.getElementById('projectStartDate') || {}).value || '').trim() || todayBj();
    config.targetDate = String((document.getElementById('projectTargetDate') || {}).value || '').trim();
    if (config.targetDate && config.targetDate < config.startDate) throw new Error('目标日期不能早于开始日期');
    if (config.goal.kind === 'number' && config.goal.target != null && !isFinite(config.goal.target)) throw new Error('目标值格式不正确');
    if (config.week.target != null && !isFinite(config.week.target)) throw new Error('每周目标格式不正确');
    return { trackFields: fields, trackConfig: config };
  }

  // ===== 列表 / 总览卡片 =====
  function statsOf(p) { return p.trackStats || null; }
  function goalTextOf(p) {
    return (p.trackConfig && p.trackConfig.goal && p.trackConfig.goal.text) || p.description || '还没有填写目标';
  }
  function goalShort(p) {
    var st = statsOf(p);
    if (!st || !st.goal) return '';
    var g = st.goal;
    if (g.kind === 'milestone') return '里程碑 ' + (g.done || 0) + '/' + (g.total || 0);
    if (g.current == null) return '已完成录入，等待数据';
    var s = nf(g.current) + (g.unit ? ' ' + g.unit : '');
    if (g.target != null) s += ' / ' + nf(g.target) + (g.unit ? ' ' + g.unit : '');
    return s;
  }
  function renderListCard(p) {
    var st = statsOf(p);
    var color = p.color || '#6366f1';
    var isDone = p.status === '已完成' || p.status === '已归档';
    var pct = st && st.goal && st.goal.pct != null ? st.goal.pct : 0;
    var h = '<article class="pj2-card trk-listcard' + (isDone ? ' pj2-dim' : '') + (p.status === '进行中' ? ' now' : '') + '" style="--pc:' + escAttr(color) + '" role="button" tabindex="0" aria-label="打开项目 ' + escAttr(p.name) + '" onclick="openProjectDetail(\'' + p.id + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openProjectDetail(\'' + p.id + '\')}">';
    h += '<div class="pj2-card-top"><span class="pj2-dot' + (p.status === '进行中' ? ' live' : '') + '" style="background:' + escAttr(color) + '"></span>';
    h += '<div class="pj2-card-name">' + esc(p.name) + '</div><span class="pj2-state ' + (p.status === '已完成' ? 'done' : p.status === '已归档' ? 'arch' : 'act') + '">' + p.status + '</span></div>';
    h += '<div class="trk-goal-line">🎯 ' + esc(goalTextOf(p)) + '</div>';
    if (st) {
      h += '<div class="pj2-meta">';
      if (st.week && st.week.target > 0) h += '<span class="' + (st.week.met ? 'trk-met' : '') + '">本周 ' + nf(st.week.value) + '/' + nf(st.week.target) + ' ' + esc(st.week.unit || '') + (st.week.met ? ' ✅' : '') + '</span>';
      if (st.milestoneTotal) h += '<span>里程碑 ' + st.milestoneDone + '/' + st.milestoneTotal + '</span>';
      if (st.streak > 1) h += '<span>🔥 连续 ' + st.streak + ' 周</span>';
      if (st.overdueDays > 0) h += '<span class="pj2-tag late">超期 ' + st.overdueDays + ' 天</span>';
      else if (st.daysLeft != null) h += '<span>' + (st.daysLeft >= 0 ? '还剩 ' + st.daysLeft + ' 天' : '目标日期已过') + '</span>';
      h += '</div>';
      h += '<div class="pj2-progress"><div class="bar"><i style="width:' + pctOf(pct) + '%;background:' + (pct >= 100 ? 'var(--green)' : escAttr(color)) + '"></i></div><span class="num">' + (st.goal && st.goal.kind === 'milestone' ? (st.milestoneDone + '/' + st.milestoneTotal + ' 个') : pctOf(pct) + '%') + '</span></div>';
    } else {
      h += '<div class="pj2-meta"><span>加载统计中…</span></div>';
    }
    h += '</article>';
    return h;
  }

  function renderBoardCard(p) {
    var st = statsOf(p);
    var color = p.color || '#6366f1';
    var pct = st && st.goal && st.goal.pct != null ? st.goal.pct : 0;
    var h = '<article class="trk-bcard' + (p.status !== '进行中' ? ' dim' : '') + '" style="--pc:' + escAttr(color) + '" role="button" tabindex="0" onclick="openProjectDetail(\'' + p.id + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();openProjectDetail(\'' + p.id + '\')}">';
    h += '<div class="trk-bcard-top"><span class="pj2-dot" style="background:' + escAttr(color) + '"></span><b>' + esc(p.name) + '</b>';
    if (p.status === '进行中' && !(st && st.closed)) h += '<button type="button" class="trk-quickadd" title="记一笔" onclick="event.stopPropagation();App.tracker.quickAdd(\'' + p.id + '\')">＋</button>';
    h += '</div>';
    h += '<div class="trk-bcard-goal">🎯 ' + esc(goalTextOf(p)) + '</div>';
    if (st) {
      h += '<div class="trk-bcard-prog"><i style="width:' + pctOf(pct) + '%;background:' + (pct >= 100 ? 'var(--green)' : escAttr(color)) + '"></i></div>';
      h += '<div class="trk-bcard-meta">';
      h += '<span>' + (st.goal && st.goal.kind === 'milestone' ? '🎖 ' + st.milestoneDone + '/' + st.milestoneTotal : '目标 ' + pctOf(pct) + '%') + '</span>';
      if (st.week && st.week.target > 0) h += '<span class="' + (st.week.met ? 'trk-met' : '') + '">本周 ' + nf(st.week.value) + '/' + nf(st.week.target) + '</span>';
      if (st.streak > 1) h += '<span>🔥' + st.streak + '</span>';
      if (st.overdueDays > 0) h += '<span class="trk-late">超期 ' + st.overdueDays + ' 天</span>';
      h += '</div>';
      if (st.nextMilestone) h += '<div class="trk-bcard-next">下一个：' + esc(st.nextMilestone.name) + '</div>';
    } else {
      h += '<div class="trk-bcard-meta"><span>统计加载中…</span></div>';
    }
    h += '</article>';
    return h;
  }

  // ===== 详情：状态与加载 =====
  var _detail = null;
  var _tabByProject = {};
  var _period = 'week';
  var _tableSearch = '';

  function ovOf(projectId) {
    return (_detail && _detail.projectId === projectId) ? _detail.overview : null;
  }

  function openDetail(p) {
    var overlay = document.getElementById('projectDetailOverlay');
    if (!overlay) return;
    var tab = _tabByProject[p.id] || 'table';
    _detail = { projectId: p.id, tab: tab, overview: null, records: [], loading: true, error: '' };
    _tabByProject[p.id] = tab;
    _tableSearch = '';
    document.getElementById('projectDetailBody').innerHTML = detailShell(p.name);
    overlay.classList.add('active');
    overlay.classList.add('trk-open');
    loadDetail();
  }

  function onDetailClosed() {
    _detail = null;
    var overlay = document.getElementById('projectDetailOverlay');
    if (overlay) overlay.classList.remove('trk-open');
  }

  function detailProject() {
    if (!_detail) return null;
    if (_detail.overview && _detail.overview.project) return _detail.overview.project;
    return projectList.find(function(x) { return x.id === _detail.projectId; }) || null;
  }

  function detailShell(name, error) {
    var h = '<div class="pj2-sheet-head">';
    h += '<div class="pj2-sheet-name"><span class="trk-head-ico">🎯</span><span class="pj2-name-text">' + esc(name || '长期跟踪') + '</span></div>';
    h += '<button class="pj2-icon-btn" onclick="App.project.closeProjectDetail()" aria-label="关闭">✕</button></div>';
    h += '<div id="trkDetailMain" class="trk-detail-main">';
    if (error) {
      h += '<div class="trk-error"><b>加载失败</b><span>' + esc(error) + '</span><button type="button" onclick="App.tracker.reload()">重试</button></div>';
    } else {
      h += '<div class="trk-loading"><i></i><span>正在加载项目数据…</span></div>';
    }
    h += '</div>';
    return h;
  }

  function loadDetail() {
    if (!_detail) return;
    var pid = _detail.projectId;
    var main = document.getElementById('trkDetailMain');
    if (main) main.innerHTML = '<div class="trk-loading"><i></i><span>正在加载项目数据…</span></div>';
    Promise.all([
      pjRequest('GET', '/api/tracker/overview?projectId=' + encodeURIComponent(pid)),
      pjRequest('GET', '/api/tracker/records?projectId=' + encodeURIComponent(pid) + '&limit=1000')
    ]).then(function(res) {
      if (!_detail || _detail.projectId !== pid) return;
      _detail.overview = res[0];
      _detail.records = Array.isArray(res[1]) ? res[1] : [];
      _detail.loading = false;
      _detail.error = '';
      renderDetail();
    }).catch(function(e) {
      if (!_detail || _detail.projectId !== pid) return;
      _detail.loading = false;
      _detail.error = pjErrorText(e);
      renderDetail();
    });
  }

  function renderDetail() {
    if (!_detail) return;
    var main = document.getElementById('trkDetailMain');
    if (!main) return;
    if (_detail.error) {
      main.innerHTML = '<div class="trk-error"><b>加载失败</b><span>' + esc(_detail.error) + '</span><button type="button" onclick="App.tracker.reload()">重试</button></div>';
      return;
    }
    var ov = _detail.overview;
    if (!ov) return;
    var cfg = ov.config || {};
    var closed = !!cfg.closed;
    var project = ov.project || detailProject() || {};
    var h = '';

    if (closed) {
      h += '<div class="trk-closed-banner"><span>🏁 已结项 · ' + esc((ov.report && ov.report.resultText) || '') + '</span><button type="button" onclick="App.tracker.reopen()">重新打开</button></div>';
    }

    h += '<div class="trk-subline">🎯 ' + esc(cfg.goal && cfg.goal.text || '') + '</div>';
    h += '<div class="pj2-summary">';
    h += '<span class="pj2-state ' + (project.status === '已完成' ? 'done' : project.status === '已归档' ? 'arch' : 'act') + '">' + esc(project.status || (closed ? '已完成' : '进行中')) + '</span>';
    if (ov.startDate) h += '<span class="pj2-pill">' + esc(ov.startDate) + (cfg.targetDate ? ' → ' + esc(cfg.targetDate) : ' 起') + '</span>';
    if (ov.daysLeft != null && !closed) h += '<span class="pj2-pill' + (ov.overdueDays > 0 ? ' trk-pill-late' : '') + '">' + (ov.overdueDays > 0 ? '超期 ' + ov.overdueDays + ' 天' : '还剩 ' + ov.daysLeft + ' 天') + '</span>';
    h += '<span class="pj2-pill">记录 ' + (ov.records ? ov.records.total : 0) + '</span>';
    if (ov.goal && ov.goal.kind === 'milestone') h += '<span class="pj2-pill">里程碑 ' + (ov.goal.done || 0) + '/' + (ov.goal.total || 0) + '</span>';
    else if (ov.goal && ov.goal.pct != null) h += '<span class="pj2-pill">目标 ' + pctOf(ov.goal.pct) + '%</span>';
    h += '</div>';

    h += '<div class="trk-toolbar">';
    if (!closed) {
      h += '<button type="button" class="trk-btn primary" onclick="App.tracker.openRecordForDetail()">＋ 记一笔</button>';
      h += '<button type="button" class="trk-btn" onclick="App.tracker.openSettings()">⚙️ 设置</button>';
      h += '<button type="button" class="trk-btn" onclick="App.tracker.openClose()">🏁 结项</button>';
    } else {
      h += '<button type="button" class="trk-btn" onclick="App.tracker.openEditInfo()">✏️ 编辑信息</button>';
      h += '<button type="button" class="trk-btn primary" onclick="App.tracker.reopen()">↩️ 重新打开</button>';
    }
    h += '</div>';

    h += '<div class="pj2-tabs trk-tabs">';
    h += '<button type="button" class="pj2-tab' + (_detail.tab === 'table' ? ' active' : '') + '" onclick="App.tracker.setTab(\'table\')">表格<em>' + _detail.records.length + '</em></button>';
    h += '<button type="button" class="pj2-tab' + (_detail.tab === 'kanban' ? ' active' : '') + '" onclick="App.tracker.setTab(\'kanban\')">看板</button>';
    h += '<button type="button" class="pj2-tab' + (_detail.tab === 'dashboard' ? ' active' : '') + '" onclick="App.tracker.setTab(\'dashboard\')">仪表盘</button>';
    h += '</div>';
    h += '<div class="pj2-tabbody trk-tabbody">';
    if (_detail.tab === 'kanban') h += renderKanban(ov);
    else if (_detail.tab === 'dashboard') h += renderDashboard(ov);
    else h += renderTable(ov);
    h += '</div>';

    main.innerHTML = h;
  }

  function setTab(tab) {
    if (!_detail) return;
    if (['table', 'kanban', 'dashboard'].indexOf(tab) < 0) tab = 'table';
    _detail.tab = tab;
    _tabByProject[_detail.projectId] = tab;
    renderDetail();
  }

  function setPeriod(p) {
    if (['week', 'month', 'all'].indexOf(p) < 0) p = 'week';
    _period = p;
    if (_detail && _detail.tab === 'dashboard') renderDetail();
  }

  function setTableSearch(v) {
    _tableSearch = String(v || '').trim();
    if (!_detail || !_detail.overview) return;
    var ov = _detail.overview;
    var titleF = titleFieldOf(ov);
    var cols = displayCols(ov, titleF);
    var closed = !!(ov.config && ov.config.closed);
    var rows = filteredRecords(ov).slice(0, 500);
    var box = document.getElementById('trkTableRows');
    if (box) box.innerHTML = tableRowsHtml(ov, rows, titleF, cols, closed);
    var mbox = document.getElementById('trkMobileRows');
    if (mbox) mbox.innerHTML = mobileRowsHtml(ov, rows, titleF, cols, closed);
    var hint = document.getElementById('trkNoMatch');
    if (hint) hint.remove();
    if (!rows.length) {
      var wrap = document.getElementById('trkMobileRows');
      if (wrap) wrap.insertAdjacentHTML('afterend', '<div class="trk-empty trk-empty-sm" id="trkNoMatch"><div class="t">没有匹配的记录</div><div class="s">试试别的关键词</div></div>');
    }
  }

  // ===== 表格 =====
  function titleFieldOf(ov) {
    var fields = ov.fields || [];
    var f = fieldByKey(fields, ov.config.titleField);
    if (f) return f;
    for (var i = 0; i < fields.length; i++) {
      if (fields[i].key === ov.config.dateField) continue;
      if (fields[i].type === 'text') return fields[i];
    }
    return null;
  }

  function displayCols(ov, titleField) {
    var fields = ov.fields || [];
    var df = ov.config.dateField;
    var out = [];
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (f.key === df || (titleField && f.key === titleField.key)) continue;
      out.push(f);
      if (out.length >= 4) break;
    }
    return out;
  }

  function valText(f, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (f.type === 'checkbox') return v ? '✅' : '—';
    if (f.type === 'number') return nf(v) + (f.unit ? ' ' + f.unit : '');
    if (f.type === 'date') return String(v);
    return String(v);
  }

  function filteredRecords(ov) {
    var rs = _detail ? _detail.records : [];
    if (!_tableSearch) return rs;
    var q = _tableSearch.toLowerCase();
    return rs.filter(function(r) {
      var d = r.data || {};
      for (var k in d) {
        if (d.hasOwnProperty(k) && String(d[k] == null ? '' : d[k]).toLowerCase().indexOf(q) >= 0) return true;
      }
      return false;
    });
  }

  function renderTable(ov) {
    var closed = !!(ov.config && ov.config.closed);
    var titleF = titleFieldOf(ov);
    var cols = displayCols(ov, titleF);
    var total = _detail.records.length;
    var h = '<div class="trk-table-tools"><div class="trk-search"><input id="trkTableSearch" value="' + escAttr(_tableSearch) + '" placeholder="搜索记录内容" oninput="App.tracker.setTableSearch(this.value)"></div>';
    if (!closed) h += '<button type="button" class="trk-btn primary trk-btn-sm" onclick="App.tracker.openRecordForDetail()">＋ 记一笔</button>';
    h += '</div>';
    if (!total) {
      h += '<div class="trk-empty"><div class="ico">📝</div><div class="t">还没有记录</div><div class="s">一次事件一行：一次投递、一次训练、一次阅读都单独记。</div>';
      if (!closed) h += '<button type="button" onclick="App.tracker.openRecordForDetail()">＋ 记第一笔</button>';
      h += '</div>';
      return h;
    }

    var rows = filteredRecords(ov);
    var shown = rows.slice(0, 500);

    h += '<div class="trk-tablewrap"><table class="trk-table"><thead><tr><th>日期</th>';
    if (titleF) h += '<th>' + esc(titleF.name) + '</th>';
    cols.forEach(function(f) { h += '<th>' + esc(f.name) + '</th>'; });
    h += '<th class="trk-th-act"></th></tr></thead><tbody id="trkTableRows">';
    h += tableRowsHtml(ov, shown, titleF, cols, closed);
    h += '</tbody></table></div>';

    h += '<div class="trk-mobile-list" id="trkMobileRows">' + mobileRowsHtml(ov, shown, titleF, cols, closed) + '</div>';

    if (!rows.length) h += '<div class="trk-empty trk-empty-sm" id="trkNoMatch"><div class="t">没有匹配的记录</div><div class="s">试试别的关键词</div></div>';
    if (rows.length > shown.length) h += '<div class="trk-more-hint">仅显示最近 500 条；用搜索缩小范围。</div>';
    return h;
  }

  function tableRowsHtml(ov, rows, titleF, cols, closed) {
    if (!rows.length) return '<tr><td colspan="' + (2 + cols.length + (titleF ? 1 : 0)) + '" class="trk-td-empty">没有匹配的记录</td></tr>';
    return rows.map(function(r) {
      var d = r.data || {};
      var h = '<tr onclick="App.tracker.openRecordForDetail(\'' + r.id + '\')">';
      h += '<td class="trk-td-date">' + esc(r.recordDate || '—') + '</td>';
      if (titleF) h += '<td class="trk-td-title">' + esc(valText(titleF, d[titleF.key])) + '</td>';
      cols.forEach(function(f) { h += '<td>' + esc(valText(f, d[f.key])) + '</td>'; });
      h += '<td class="trk-td-act">' + (closed ? '' : '<button type="button" class="trk-iconbtn" title="删除" onclick="event.stopPropagation();App.tracker.deleteRecord(\'' + r.id + '\')">✕</button>') + '</td>';
      return h + '</tr>';
    }).join('');
  }

  function mobileRowsHtml(ov, rows, titleF, cols, closed) {
    if (!rows.length) return '';
    return rows.map(function(r) {
      var d = r.data || {};
      var h = '<div class="trk-mcard" onclick="App.tracker.openRecordForDetail(\'' + r.id + '\')">';
      h += '<div class="trk-mcard-top"><span>' + esc(r.recordDate || '—') + '</span>';
      if (titleF) h += '<b>' + esc(valText(titleF, d[titleF.key])) + '</b>';
      h += '</div><div class="trk-mcard-fields">';
      cols.slice(0, 3).forEach(function(f) {
        var v = valText(f, d[f.key]);
        if (v === '—') return;
        h += '<span>' + esc(f.name) + '：' + esc(v) + '</span>';
      });
      h += '</div></div>';
      return h;
    }).join('');
  }

  function deleteRecord(id) {
    if (!_detail) return;
    if (!confirm('删除这条记录？删除后周/月汇总会一起变化。')) return;
    var pid = _detail.projectId;
    pjRequest('DELETE', '/api/tracker/records?id=' + encodeURIComponent(id))
      .then(function() { toast('已删除'); afterChange(pid); })
      .catch(function(e) { toast('删除失败：' + pjErrorText(e)); });
  }

  // ===== 看板 =====
  function kanbanColumns(ov) {
    var key = ov.config.kanbanField;
    var f = fieldByKey(ov.fields || [], key);
    if (!f) return null;
    var opts = (f.options || []).slice();
    var cols = opts.map(function(o) { return { name: o, records: [] }; });
    var map = {};
    cols.forEach(function(c) { map[c.name] = c; });
    var other = { name: '其他', records: [] };
    var empty = { name: '未填', records: [] };
    (_detail.records || []).forEach(function(r) {
      var v = (r.data || {})[key];
      var s = v == null ? '' : String(v);
      if (!s) { empty.records.push(r); return; }
      if (map[s]) map[s].records.push(r);
      else other.records.push(r);
    });
    if (other.records.length) cols.push(other);
    cols.push(empty);
    return { field: f, cols: cols };
  }

  function renderKanban(ov) {
    var kb = kanbanColumns(ov);
    var closed = !!(ov.config && ov.config.closed);
    if (!kb) {
      return '<div class="trk-empty"><div class="ico">▦</div><div class="t">还没有看板分组字段</div><div class="s">在「设置」里选一个选项字段作为看板列。</div>'
        + (closed ? '' : '<button type="button" onclick="App.tracker.openSettings()">去设置</button>') + '</div>';
    }
    var titleF = titleFieldOf(ov);
    var h = '<div class="trk-kanban-head"><span>按「' + esc(kb.field.name) + '」分组</span><em>' + _detail.records.length + ' 条记录</em></div>';
    h += '<div class="trk-kanban">';
    kb.cols.forEach(function(c) {
      h += '<section class="trk-kcol"><div class="trk-kcolhead"><span>' + esc(c.name) + '</span><b>' + c.records.length + '</b>';
      if (!closed) h += '<button type="button" class="trk-kadd" title="在此列记一笔" data-f="' + escAttr(kb.field.key) + '" data-v="' + escAttr(c.name === '其他' || c.name === '未填' ? '' : c.name) + '" onclick="App.tracker.openPreset(this)">＋</button>';
      h += '</div><div class="trk-kbody">';
      if (!c.records.length) h += '<div class="trk-kempty">暂无</div>';
      c.records.forEach(function(r) {
        var d = r.data || {};
        h += '<div class="trk-kcard" onclick="App.tracker.openRecordForDetail(\'' + r.id + '\')">';
        h += '<div class="trk-kcard-date">' + esc(r.recordDate || '—') + '</div>';
        if (titleF) h += '<div class="trk-kcard-title">' + esc(valText(titleF, d[titleF.key])) + '</div>';
        var extra = 0;
        (ov.fields || []).forEach(function(f) {
          if (extra >= 2) return;
          if (f.key === kb.field.key || (titleF && f.key === titleF.key) || f.key === ov.config.dateField) return;
          var v = valText(f, d[f.key]);
          if (v === '—') return;
          h += '<div class="trk-kcard-meta">' + esc(f.name) + '：' + esc(v) + '</div>';
          extra++;
        });
        h += '</div>';
      });
      h += '</div></section>';
    });
    h += '</div>';
    return h;
  }

  // ===== 仪表盘 =====
  function renderDashboard(ov) {
    var cfg = ov.config || {};
    var g = ov.goal || {};
    var per = _period === 'all' ? ov.all : ov[_period];
    var periodName = _period === 'week' ? '本周' : _period === 'month' ? '本月' : '全部';
    var closed = !!cfg.closed;
    var h = '';

    if (closed && ov.report) h += renderReport(ov);

    // 周期切换
    h += '<div class="trk-period">';
    [['week', '本周'], ['month', '本月'], ['all', '全部']].forEach(function(x) {
      h += '<button type="button" class="' + (_period === x[0] ? 'active' : '') + '" onclick="App.tracker.setPeriod(\'' + x[0] + '\')">' + x[1] + '</button>';
    });
    h += '</div>';

    // KPI 卡片
    h += '<div class="trk-kpis">';
    h += '<div class="trk-kpi trk-kpi-goal"><div class="trk-kpi-label">目标进度</div>' + goalRing(ov) + '<div class="trk-kpi-sub">' + esc(goalSub(ov)) + '</div></div>';
    h += '<div class="trk-kpi"><div class="trk-kpi-label">本周目标</div>' + weekGauge(ov) + '<div class="trk-kpi-sub">' + esc(weekSub(ov)) + '</div></div>';
    h += '<div class="trk-kpi"><div class="trk-kpi-label">' + periodName + '记录</div><div class="trk-kpi-num">' + (per ? per.count : 0) + '</div><div class="trk-kpi-sub">活跃 ' + (per ? per.activeDays : 0) + ' 天</div></div>';
    h += '<div class="trk-kpi"><div class="trk-kpi-label">连续达标</div><div class="trk-kpi-num">' + (ov.streak || 0) + '<small>周</small></div><div class="trk-kpi-sub">' + (ov.streak ? '本周未达标也不打断' : '从达标的一周开始累计') + '</div></div>';
    h += '<div class="trk-kpi"><div class="trk-kpi-label">里程碑</div><div class="trk-kpi-num">' + (ov.milestones ? ov.milestones.filter(function(m) { return m.done; }).length : 0) + '<small>/' + (ov.milestones ? ov.milestones.length : 0) + '</small></div><div class="trk-kpi-sub">' + esc(ov.nextMilestone ? '下一个：' + ov.nextMilestone.name : (ov.milestones && ov.milestones.length ? '全部完成 🎉' : '还没有里程碑')) + '</div></div>';
    h += '<div class="trk-kpi' + (ov.overdueDays > 0 ? ' warn' : '') + '"><div class="trk-kpi-label">' + (closed ? '项目周期' : '时间') + '</div><div class="trk-kpi-num">' + (closed && ov.report ? ov.report.days : (ov.daysElapsed == null ? '—' : ov.daysElapsed)) + '<small>天</small></div><div class="trk-kpi-sub">' + esc(timeSub(ov)) + '</div></div>';
    h += '</div>';

    // 自动汇总句
    if (per && per.summary) h += '<div class="trk-summary"><span>📝</span><p>' + esc(per.summary) + '</p></div>';

    // 活动柱状图 + 指标折线
    h += '<div class="trk-charts">';
    h += '<section class="trk-panel"><div class="trk-panel-head"><b>记录活跃度</b><em>' + periodName + ' · 按' + (_period === 'week' ? '天' : _period === 'month' ? '周' : '月') + '</em></div>' + barChart(ov.series && ov.series[_period] || []) + '</section>';
    h += '<section class="trk-panel"><div class="trk-panel-head"><b>目标指标走势</b><em>' + esc(metricText(cfg.goal && cfg.goal.metric, ov.fields)) + '</em></div>' + metricChart(ov.series && ov.series[_period] || [], g, ov.fields) + '</section>';
    h += '</div>';

    // 状态分布 + 里程碑
    h += '<div class="trk-charts">';
    h += '<section class="trk-panel"><div class="trk-panel-head"><b>状态分布</b><em>' + periodName + '</em></div>' + distributionChart(per ? per.distribution : [], per ? per.count : 0) + '</section>';
    h += '<section class="trk-panel"><div class="trk-panel-head"><b>里程碑时间线</b><em>' + (ov.milestones ? ov.milestones.filter(function(m) { return m.done; }).length + '/' + ov.milestones.length : '0/0') + '</em></div>' + milestoneTimeline(ov) + '</section>';
    h += '</div>';

    return h;
  }

  function goalRing(ov) {
    var g = ov.goal || {};
    var p = g.pct == null ? 0 : pctOf(g.pct);
    var center = g.kind === 'milestone' ? ((g.done || 0) + '/' + (g.total || 0)) : (g.pct == null ? '—' : p + '%');
    var small = g.kind === 'milestone' ? '里程碑' : '完成';
    return '<div class="trk-ring" style="--p:' + p + '"><div class="trk-ring-in"><b>' + center + '</b><span>' + small + '</span></div></div>';
  }
  function goalSub(ov) {
    var g = ov.goal || {};
    var cfg = ov.config || {};
    if (g.kind === 'milestone') {
      if (!g.total) return '还没有设置里程碑';
      return '已完成 ' + (g.done || 0) + ' / ' + g.total + ' 个';
    }
    if (g.kind !== 'number' || !g.metric) return g.text || '按里程碑推进';
    var s = '';
    if (g.current != null) s = '当前 ' + nf(g.current) + (g.unit ? ' ' + g.unit : '');
    if (g.target != null) s += (s ? ' / ' : '目标 ') + nf(g.target) + (g.unit ? ' ' + g.unit : '');
    if (g.achieved) s += ' · 已达成';
    else if (g.remaining != null) s += ' · 还差 ' + nf(g.remaining) + (g.unit ? ' ' + g.unit : '');
    if (g.direction === 'down' && g.baseline != null) s += ' · 基线 ' + nf(g.baseline);
    return s || '等待记录';
  }
  function weekGauge(ov) {
    var w = ov.week || {};
    var p = w.pct == null ? 0 : pctOf(w.pct);
    return '<div class="trk-gauge"><div class="trk-gauge-num"><b>' + nf(w.value) + '</b><span>/ ' + (w.target > 0 ? nf(w.target) : '—') + ' ' + esc(w.unit || '') + '</span></div>'
      + '<div class="trk-gauge-bar"><i style="width:' + p + '%"></i></div>'
      + '<div class="trk-gauge-mark' + (w.met ? ' met' : '') + '">' + (w.target > 0 ? (w.met ? '已达标 🎉' : '还差 ' + nf(Math.max(0, (w.target || 0) - (w.value || 0))) + ' ' + esc(w.unit || '')) : '未设置每周目标') + '</div></div>';
  }
  function weekSub(ov) {
    var w = ov.week || {};
    return w.start && w.end ? w.start.slice(5) + ' ~ ' + w.end.slice(5) + ' · ' + (w.metricLabel || '') : '';
  }
  function timeSub(ov) {
    var cfg = ov.config || {};
    if (ov.report) return '结项于 ' + ov.report.endDate;
    if (ov.overdueDays > 0) return '已超期 ' + ov.overdueDays + ' 天';
    if (ov.daysLeft != null) return '还剩 ' + ov.daysLeft + ' 天' + (cfg.targetDate ? '（目标 ' + cfg.targetDate + '）' : '');
    return '还没设目标日期';
  }

  function barChart(series) {
    if (!series || !series.length) return '<div class="trk-chart-empty">还没有数据</div>';
    var max = 1;
    series.forEach(function(b) { if (b.count > max) max = b.count; });
    var h = '<div class="trk-bars">';
    series.forEach(function(b) {
      var p = b.count ? Math.max(4, Math.round(b.count / max * 100)) : 2;
      h += '<div class="trk-barcol" title="' + escAttr(b.label + '：' + b.count + ' 条') + '">';
      h += '<span class="trk-barcount">' + (b.count ? b.count : '') + '</span>';
      h += '<div class="trk-bartrack"><i style="height:' + p + '%"></i></div>';
      h += '<span class="trk-barlabel">' + esc(String(b.label || '').replace(/^20(\d\d)-(\d\d)$/, '$2月')) + '</span>';
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function metricChart(series, goal, fields) {
    if (!goal || goal.kind !== 'number' || !series || series.length < 2) return '<div class="trk-chart-empty">这个目标按里程碑推进，没有数值曲线</div>';
    var pts = [];
    series.forEach(function(b, i) {
      if (b.value != null && isFinite(Number(b.value))) pts.push({ v: Number(b.value), i: i, label: b.label });
    });
    if (pts.length < 2) return '<div class="trk-chart-empty">数值记录还不够，至少需要 2 个周期</div>';
    var min = pts[0].v, max = pts[0].v;
    pts.forEach(function(p) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; });
    var span = max - min || 1;
    var n = series.length;
    var coords = pts.map(function(p) {
      var x = 12 + (p.i / (n - 1)) * 296;
      var y = 74 - ((p.v - min) / span) * 56;
      return { x: x, y: y, v: p.v, label: p.label };
    });
    var line = coords.map(function(c) { return c.x + ',' + c.y; }).join(' ');
    var h = '<div class="trk-line-head"><span>最低 ' + nf(min) + '</span><span>最高 ' + nf(max) + '</span><span>最新 ' + nf(coords[coords.length - 1].v) + '</span></div>';
    h += '<svg class="trk-line" viewBox="0 0 320 90" preserveAspectRatio="none" role="img" aria-label="目标指标走势">';
    h += '<line x1="12" y1="74" x2="308" y2="74" class="trk-line-axis"></line>';
    h += '<polyline points="' + line + '" class="trk-line-path"></polyline>';
    coords.forEach(function(c) {
      h += '<circle cx="' + c.x.toFixed(1) + '" cy="' + c.y.toFixed(1) + '" r="3" class="trk-line-dot"><title>' + esc(c.label + '：' + c.v) + '</title></circle>';
    });
    h += '</svg>';
    h += '<div class="trk-line-labels"><span>' + esc(String(series[0].label || '')) + '</span><span>' + esc(String(series[series.length - 1].label || '')) + '</span></div>';
    return h;
  }

  function distributionChart(dist, total) {
    if (!dist || !dist.length) return '<div class="trk-chart-empty">这个周期还没有记录</div>';
    var max = 1;
    dist.forEach(function(x) { if (x.count > max) max = x.count; });
    return '<div class="trk-dist">' + dist.map(function(x) {
      var w = Math.max(3, Math.round(x.count / max * 100));
      return '<div class="trk-dist-row"><span class="trk-dist-name">' + esc(x.name) + '</span>'
        + '<div class="trk-dist-bar"><i style="width:' + w + '%"></i></div>'
        + '<b>' + x.count + '</b><em>' + (total ? Math.round(x.count / total * 100) : 0) + '%</em></div>';
    }).join('') + '</div>';
  }

  function milestoneTimeline(ov) {
    var ms = ov.milestones || [];
    if (!ms.length) return '<div class="trk-chart-empty">还没有里程碑，去「设置」里加几个检查点</div>';
    var closed = !!(ov.config && ov.config.closed);
    var h = '<div class="trk-timeline">';
    ms.forEach(function(m) {
      h += '<div class="trk-ms' + (m.done ? ' done' : '') + '">';
      h += '<button type="button" class="trk-ms-check" aria-label="' + (m.done ? '取消完成' : '标记完成') + '"' + (closed ? ' disabled' : ' onclick="App.tracker.toggleMilestone(\'' + escAttr(m.id) + '\',' + (m.done ? 'false' : 'true') + ')"') + '>' + (m.done ? '✓' : '') + '</button>';
      h += '<div class="trk-ms-body"><b>' + esc(m.name) + '</b><span>';
      if (m.done && m.doneDate) h += '完成于 ' + esc(m.doneDate);
      else if (m.targetDate) h += '目标 ' + esc(m.targetDate);
      else h += '未设日期';
      if (m.targetValue != null && m.targetValue !== '') h += ' · 目标值 ' + nf(m.targetValue);
      h += '</span></div></div>';
    });
    h += '</div>';
    return h;
  }

  function renderReport(ov) {
    var r = ov.report || {};
    var h = '<div class="trk-report">';
    h += '<div class="trk-report-head"><b>🏁 结项报告</b><span class="trk-report-badge' + (r.result === 'ended' ? ' ended' : '') + '">' + esc(r.resultText || '已结项') + '</span></div>';
    h += '<div class="trk-report-summary">' + esc(r.summary || '') + '</div>';
    if (r.note) h += '<div class="trk-report-note"><span>结项总结</span><p>' + esc(r.note) + '</p></div>';
    h += '<div class="trk-report-grid">';
    h += '<div><b>' + (r.days == null ? '—' : r.days) + '</b><span>共几天</span></div>';
    h += '<div><b>' + (r.records == null ? 0 : r.records) + '</b><span>条记录</span></div>';
    h += '<div><b>' + (r.activeDays == null ? 0 : r.activeDays) + '</b><span>活跃天</span></div>';
    h += '<div><b>' + (r.milestonesDone || 0) + '/' + (r.milestonesTotal || 0) + '</b><span>里程碑</span></div>';
    h += '</div>';
    if (r.goal && r.goal.kind === 'number' && r.goal.current != null) {
      h += '<div class="trk-report-goal">最终目标：' + esc(nf(r.goal.current)) + (r.goal.unit ? ' ' + esc(r.goal.unit) : '') + (r.goal.target != null ? ' / ' + esc(nf(r.goal.target)) + (r.goal.unit ? ' ' + esc(r.goal.unit) : '') : '') + '</div>';
    }
    h += '</div>';
    return h;
  }

  // ===== 记录弹窗 =====
  function ensureRecordModal() {
    if (document.getElementById('trkRecordOverlay')) return;
    var el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'trkRecordOverlay';
    el.innerHTML = '<div class="modal trk-modal" role="dialog" aria-modal="true">'
      + '<div class="modal-header"><h3 id="trkRecTitle">记一笔</h3><button type="button" class="close-btn" onclick="App.tracker.closeRecord()">✕</button></div>'
      + '<div class="modal-body" id="trkRecBody"></div>'
      + '<div class="btn-row"><button type="button" class="btn btn-secondary" onclick="App.tracker.closeRecord()">取消</button>'
      + '<button type="button" class="btn btn-primary" id="trkRecSave" onclick="App.tracker.saveRecord()">保存</button></div></div>';
    el.addEventListener('click', function(e) { if (e.target === el) closeRecord(); });
    document.body.appendChild(el);
  }

  function fieldInput(f, value, presets) {
    var id = 'trkf_' + f.key;
    var v = value;
    if (v === undefined && presets && presets[f.key] !== undefined) v = presets[f.key];
    var h = '<label class="trk-form-field' + (f.type === 'checkbox' ? ' trk-checkfield' : '') + '">';
    if (f.type === 'checkbox') {
      h += '<span class="trk-checkbox-wrap"><input type="checkbox" id="' + id + '" data-tf="' + escAttr(f.key) + '"' + (v ? ' checked' : '') + '><span>' + esc(f.name) + '</span></span>';
      return h + '</label>';
    }
    h += '<span class="trk-form-label">' + esc(f.name) + (f.required ? '<i>*</i>' : '') + (f.unit ? ' <em>' + esc(f.unit) + '</em>' : '') + '</span>';
    if (f.type === 'longtext') {
      h += '<textarea id="' + id + '" data-tf="' + escAttr(f.key) + '" rows="3" placeholder="' + escAttr(f.name) + '">' + esc(v == null ? '' : v) + '</textarea>';
    } else if (f.type === 'select') {
      h += '<select id="' + id + '" data-tf="' + escAttr(f.key) + '"><option value="">请选择</option>';
      (f.options || []).forEach(function(o) {
        h += '<option value="' + escAttr(o) + '"' + (String(v) === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>';
      });
      h += '</select>';
    } else if (f.type === 'number') {
      h += '<input type="number" step="any" inputmode="decimal" id="' + id + '" data-tf="' + escAttr(f.key) + '" value="' + escAttr(v == null ? '' : v) + '" placeholder="' + escAttr(f.unit || f.name) + '">';
    } else if (f.type === 'date') {
      h += '<input type="date" id="' + id + '" data-tf="' + escAttr(f.key) + '" value="' + escAttr(v || '') + '">';
    } else {
      h += '<input type="text" id="' + id + '" data-tf="' + escAttr(f.key) + '" value="' + escAttr(v == null ? '' : v) + '" maxlength="2000" placeholder="' + escAttr(f.name) + '">';
    }
    return h + '</label>';
  }

  function openRecordModal(projectId, fields, config, record, presets, projectName) {
    ensureRecordModal();
    var overlay = document.getElementById('trkRecordOverlay');
    if (!overlay) return;
    _rec = { projectId: projectId, fields: fields, config: config, record: record || null, saving: false };
    var d = record && record.data ? record.data : {};
    var dateField = fieldByKey(fields, config.dateField);
    if (!record && dateField && !d[dateField.key] && !(presets && presets[dateField.key])) d[dateField.key] = todayBj();
    var body = '';
    if (record) body += '<div class="trk-rec-edit-hint">正在编辑 ' + esc(record.recordDate || '') + ' 的记录</div>';
    fields.forEach(function(f) { body += fieldInput(f, d[f.key], presets || {}); });
    document.getElementById('trkRecTitle').textContent = (record ? '编辑记录' : '记一笔') + (projectName ? ' · ' + projectName : '');
    document.getElementById('trkRecBody').innerHTML = body;
    document.getElementById('trkRecSave').disabled = false;
    overlay.classList.add('active');
    setTimeout(function() { var first = document.querySelector('#trkRecBody input,#trkRecBody select,#trkRecBody textarea'); if (first && first.type !== 'date' && first.type !== 'checkbox') first.focus(); }, 30);
  }

  var _rec = null;
  var _quickOv = null;

  function openRecordForDetail(recordId, presets) {
    if (!_detail || !_detail.overview) return;
    var ov = _detail.overview;
    if (ov.config.closed) { toast('项目已结项，记录只读；如需继续记录请先重新打开'); return; }
    var rec = null;
    if (recordId) rec = (_detail.records || []).filter(function(r) { return r.id === recordId; })[0] || null;
    var pname = (ov.project && ov.project.name) || '';
    openRecordModal(_detail.projectId, ov.fields, ov.config, rec, presets || null, pname);
  }

  function quickAdd(projectId) {
    var p = projectList.find(function(x) { return x.id === projectId; });
    if (!p) return;
    if (p.status !== '进行中') { toast('这个项目已经结束，重新打开后才能记录'); return; }
    if (_detail && _detail.projectId === projectId && _detail.overview) {
      openRecordForDetail();
      return;
    }
    pjRequest('GET', '/api/tracker/overview?projectId=' + encodeURIComponent(projectId))
      .then(function(ov) {
        if (ov.config && ov.config.closed) { toast('项目已结项，如需继续记录请先重新打开'); return; }
        _quickOv = { projectId: projectId, overview: ov };
        openRecordModal(projectId, ov.fields, ov.config, null, null, p.name);
      }).catch(function(e) { toast('加载失败：' + pjErrorText(e)); });
  }

  function closeRecord() {
    var overlay = document.getElementById('trkRecordOverlay');
    if (overlay) overlay.classList.remove('active');
    _rec = null;
  }

  function collectRecord() {
    if (!_rec) return null;
    var data = {};
    var miss = [];
    for (var i = 0; i < _rec.fields.length; i++) {
      var f = _rec.fields[i];
      var el = document.getElementById('trkf_' + f.key);
      if (!el) continue;
      var v;
      if (f.type === 'checkbox') v = !!el.checked;
      else {
        v = String(el.value == null ? '' : el.value).trim();
        if (f.type === 'number') v = v === '' ? null : Number(v);
        if (v === '') v = null;
      }
      if (v !== null && v !== undefined && v !== '') data[f.key] = v;
      else if (f.type === 'checkbox') data[f.key] = false;
      if (f.required) {
        var empty = v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v));
        if (empty) miss.push(f.name);
      }
    }
    if (miss.length) { toast('请填写：' + miss.join('、')); return null; }
    return data;
  }

  function saveRecord() {
    if (!_rec || _rec.saving) return;
    var data = collectRecord();
    if (!data) return;
    _rec.saving = true;
    var btn = document.getElementById('trkRecSave');
    if (btn) btn.disabled = true;
    var pid = _rec.projectId;
    var editId = _rec.record ? _rec.record.id : null;
    var req = editId
      ? pjRequest('PUT', '/api/tracker/records', { id: editId, data: data })
      : pjRequest('POST', '/api/tracker/records', { projectId: pid, data: data });
    req.then(function() {
      toast(editId ? '✅ 已更新' : '✅ 已记录');
      closeRecord();
      _quickOv = null;
      afterChange(pid);
      if (_detail && _detail.overview) _detail.tab = _tabByProject[pid] || _detail.tab;
    }).catch(function(e) {
      if (_rec) _rec.saving = false;
      if (btn) btn.disabled = false;
      toast((editId ? '更新失败：' : '记录失败：') + pjErrorText(e));
    });
  }

  function afterChange(pid) {
    if (_detail && _detail.projectId === pid) loadDetail();
    if (typeof loadProjects === 'function') {
      loadProjects().then(function() {
        if (typeof renderProject === 'function' && document.getElementById('projectContent')) renderProject();
      });
    }
  }

  // ===== 结项 / 重开 =====
  var _closing = false;
  function ensureCloseModal() {
    if (document.getElementById('trkCloseOverlay')) return;
    var el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'trkCloseOverlay';
    el.innerHTML = '<div class="modal trk-modal" role="dialog" aria-modal="true">'
      + '<div class="modal-header"><h3>🏁 结项</h3><button type="button" class="close-btn" onclick="App.tracker.closeClose()">✕</button></div>'
      + '<div class="modal-body" id="trkCloseBody"></div>'
      + '<div class="btn-row"><button type="button" class="btn btn-secondary" onclick="App.tracker.closeClose()">再想想</button>'
      + '<button type="button" class="btn btn-primary" id="trkCloseSave" onclick="App.tracker.confirmClose()">确认结项</button></div></div>';
    el.addEventListener('click', function(e) { if (e.target === el) closeClose(); });
    document.body.appendChild(el);
  }

  function openClose() {
    if (!_detail || !_detail.overview) return;
    var ov = _detail.overview;
    if (ov.config.closed) return;
    ensureCloseModal();
    _closing = false;
    var body = '<div class="trk-close-summary">';
    body += '<div>🎯 ' + esc(ov.config.goal && ov.config.goal.text || '') + '</div>';
    body += '<div class="trk-close-stats"><span>' + (ov.all ? ov.all.count : 0) + ' 条记录</span><span>' + (ov.all ? ov.all.activeDays : 0) + ' 个活跃天</span><span>里程碑 ' + (ov.milestones ? ov.milestones.filter(function(m) { return m.done; }).length : 0) + '/' + (ov.milestones ? ov.milestones.length : 0) + '</span></div></div>';
    body += '<div class="trk-close-result"><label class="trk-radio' + (ov.goal && ov.goal.achieved ? ' rec' : '') + '"><input type="radio" name="trkCloseResult" value="achieved"' + (ov.goal && ov.goal.achieved ? ' checked' : '') + '><b>达成目标</b><span>目标已经实现，做一次总结</span></label>';
    body += '<label class="trk-radio' + (ov.goal && ov.goal.achieved ? '' : ' rec') + '"><input type="radio" name="trkCloseResult" value="ended"' + (ov.goal && ov.goal.achieved ? '' : ' checked') + '><b>提前结束</b><span>目标没完全达成，但这件事到此为止</span></label></div>';
    body += '<label class="trk-form-field"><span class="trk-form-label">结项总结（可选）</span><textarea id="trkCloseNote" rows="4" maxlength="2000" placeholder="这段时间做得怎么样？有什么收获、遗憾或下一步？"></textarea></label>';
    body += '<div class="trk-close-hint">结项后项目变为只读，记录和里程碑不能再改；之后可以重新打开。</div>';
    document.getElementById('trkCloseBody').innerHTML = body;
    document.getElementById('trkCloseSave').disabled = false;
    document.getElementById('trkCloseOverlay').classList.add('active');
  }

  function closeClose() {
    var el = document.getElementById('trkCloseOverlay');
    if (el) el.classList.remove('active');
  }

  function confirmClose() {
    if (!_detail || _closing) return;
    var result = document.querySelector('input[name="trkCloseResult"]:checked');
    var note = document.getElementById('trkCloseNote');
    if (!result) { toast('请选择结项结果'); return; }
    _closing = true;
    var btn = document.getElementById('trkCloseSave');
    if (btn) btn.disabled = true;
    var pid = _detail.projectId;
    pjRequest('POST', '/api/tracker/close', { projectId: pid, result: result.value, note: note ? note.value : '' })
      .then(function() {
        _closing = false;
        closeClose();
        toast('🏁 已结项');
        _tabByProject[pid] = 'dashboard';
        afterChange(pid);
        if (_detail) _detail.tab = 'dashboard';
        if (typeof loadProjects === 'function') loadProjects().then(function() { if (document.getElementById('projectContent')) renderProject(); });
      }).catch(function(e) {
        _closing = false;
        if (btn) btn.disabled = false;
        toast('结项失败：' + pjErrorText(e));
      });
  }

  function reopen() {
    if (!_detail) return;
    if (!confirm('重新打开这个跟踪项目？结项总结会清空，历史记录保留。')) return;
    var pid = _detail.projectId;
    pjRequest('POST', '/api/tracker/reopen', { projectId: pid }).then(function() {
      toast('已重新打开');
      _tabByProject[pid] = 'dashboard';
      afterChange(pid);
      if (typeof loadProjects === 'function') loadProjects().then(function() { if (document.getElementById('projectContent')) renderProject(); });
    }).catch(function(e) { toast('重新打开失败：' + pjErrorText(e)); });
  }

  // ===== 设置弹窗 =====
  var _set = null;
  function ensureSettingsModal() {
    if (document.getElementById('trkSetOverlay')) return;
    var el = document.createElement('div');
    el.className = 'modal-overlay';
    el.id = 'trkSetOverlay';
    el.innerHTML = '<div class="modal trk-modal trk-modal-wide" role="dialog" aria-modal="true">'
      + '<div class="modal-header"><h3>⚙️ 跟踪设置</h3><button type="button" class="close-btn" onclick="App.tracker.closeSettings()">✕</button></div>'
      + '<div class="modal-body" id="trkSetBody"></div>'
      + '<div class="btn-row"><button type="button" class="btn btn-secondary" onclick="App.tracker.closeSettings()">取消</button>'
      + '<button type="button" class="btn btn-primary" id="trkSetSave" onclick="App.tracker.saveSettings()">保存设置</button></div></div>';
    el.addEventListener('click', function(e) { if (e.target === el) closeSettings(); });
    document.body.appendChild(el);
  }

  function aggOptions() {
    return [['count', '记录数'], ['countValue', '某个选项的次数'], ['countTrue', '勾选次数'], ['sum', '数值合计'], ['latest', '最新数值'], ['max', '最大数值']];
  }
  function fieldOptionsHtml(fields, selected) {
    return '<option value="">选择字段</option>' + fields.map(function(f) {
      return '<option value="' + escAttr(f.key) + '"' + (f.key === selected ? ' selected' : '') + '>' + esc(f.name) + '（' + typeLabel(f.type) + '）</option>';
    }).join('');
  }
  function valueOptionsHtml(f, selected) {
    if (!f || f.type !== 'select') return '<option value="">先选一个选项字段</option>';
    return '<option value="">选择选项值</option>' + (f.options || []).map(function(o) {
      return '<option value="' + escAttr(o) + '"' + (o === selected ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');
  }
  function metricEditor(prefix, metric, fields) {
    metric = metric || { agg: 'count' };
    var agg = metric.agg || 'count';
    var f = fieldByKey(fields, metric.field);
    return '<div class="trk-metric">'
      + '<select id="' + prefix + 'Agg" onchange="App.tracker.syncMetric(\'' + prefix + '\')">'
      + aggOptions().map(function(x) { return '<option value="' + x[0] + '"' + (x[0] === agg ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('')
      + '</select>'
      + '<select id="' + prefix + 'Field" onchange="App.tracker.syncMetric(\'' + prefix + '\')"' + (agg === 'count' ? ' disabled' : '') + '>' + fieldOptionsHtml(fields, metric.field) + '</select>'
      + '<select id="' + prefix + 'Value" class="' + (agg === 'countValue' ? '' : 'trk-hide') + '"' + (agg === 'countValue' ? '' : ' disabled') + '>' + valueOptionsHtml(f, metric.value) + '</select>'
      + '</div>';
  }
  function syncMetric(prefix) {
    var aggEl = document.getElementById(prefix + 'Agg');
    var fieldEl = document.getElementById(prefix + 'Field');
    var valEl = document.getElementById(prefix + 'Value');
    if (!aggEl || !fieldEl || !valEl) return;
    var agg = aggEl.value;
    fieldEl.disabled = agg === 'count';
    var f = fieldByKey((_set ? _set.fields : []), fieldEl.value);
    if (agg === 'countValue') {
      var keep = valEl.value;
      valEl.innerHTML = valueOptionsHtml(f, keep);
      valEl.classList.remove('trk-hide');
      valEl.disabled = false;
    } else {
      valEl.classList.add('trk-hide');
      valEl.disabled = true;
    }
  }
  function readMetric(prefix) {
    var agg = (document.getElementById(prefix + 'Agg') || {}).value || 'count';
    if (agg === 'count') return { agg: 'count' };
    var field = (document.getElementById(prefix + 'Field') || {}).value || '';
    var m = { agg: agg, field: field };
    if (agg === 'countValue') m.value = (document.getElementById(prefix + 'Value') || {}).value || '';
    if (!field) return { agg: 'count' };
    if (agg === 'countValue' && !m.value) return { agg: 'count' };
    return m;
  }

  function fieldRowHtml(f) {
    return '<div class="trk-set-row" data-key="' + escAttr(f.key) + '">'
      + '<input class="trk-set-name" value="' + escAttr(f.name) + '" maxlength="20" placeholder="字段名">'
      + '<select class="trk-set-type">' + TYPES.map(function(t) { return '<option value="' + t[0] + '"' + (f.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select>'
      + '<input class="trk-set-options" value="' + escAttr((f.options || []).join('，')) + '" placeholder="选项，逗号分隔">'
      + '<input class="trk-set-unit" value="' + escAttr(f.unit || '') + '" maxlength="8" placeholder="单位">'
      + '<label class="trk-set-req"><input type="checkbox"' + (f.required ? ' checked' : '') + '>必填</label>'
      + '<button type="button" class="trk-set-del" title="删除字段" onclick="App.tracker.removeSetField(this)">✕</button></div>';
  }

  function setFieldOptions(fields, selected) {
    return '<option value="">无</option>' + fields.map(function(f) {
      return '<option value="' + escAttr(f.key) + '"' + (f.key === selected ? ' selected' : '') + '>' + esc(f.name) + '</option>';
    }).join('');
  }

  function milestoneRowHtml(m) {
    return '<div class="trk-ms-row" data-id="' + escAttr(m.id) + '">'
      + '<input class="trk-ms-name" value="' + escAttr(m.name) + '" maxlength="60" placeholder="里程碑名称，例如：读完一本书">'
      + '<input class="trk-ms-date" type="date" value="' + escAttr(m.targetDate || '') + '">'
      + '<input class="trk-ms-target" type="number" step="any" value="' + escAttr(m.targetValue == null ? '' : m.targetValue) + '" placeholder="目标值">'
      + '<label class="trk-set-req"><input class="trk-ms-done" type="checkbox"' + (m.done ? ' checked' : '') + '>完成</label>'
      + '<button type="button" class="trk-set-del" title="删除里程碑" onclick="App.tracker.removeSetMilestone(this)">✕</button></div>';
  }

  function openSettings() {
    if (!_detail || !_detail.overview) return;
    var ov = _detail.overview;
    if (ov.config.closed) { toast('项目已结项，先重新打开才能修改设置'); return; }
    ensureSettingsModal();
    var fields = clone(ov.fields || []);
    var config = clone(ov.config || {});
    _set = { projectId: _detail.projectId, fields: fields, config: config };
    var h = '<div class="trk-set-sec"><div class="trk-set-sec-head"><b>记录字段</b><span>最多 24 个；改字段不会删除历史数据</span></div>';
    h += '<div class="trk-set-fields" id="trkSetFields">' + fields.map(fieldRowHtml).join('') + '</div>';
    h += '<button type="button" class="trk-btn trk-btn-sm" onclick="App.tracker.addSetField()">＋ 加字段</button></div>';

    h += '<div class="trk-set-sec"><div class="trk-set-sec-head"><b>项目目标</b><span>目标文案必填</span></div>';
    h += '<label class="trk-form-field"><span class="trk-form-label">目标 *</span><input id="trkSetGoalText" type="text" maxlength="200" value="' + escAttr(config.goal && config.goal.text || '') + '"></label>';
    h += '<div class="trk-set-grid2"><label class="trk-form-field"><span class="trk-form-label">目标类型</span><select id="trkSetGoalKind" onchange="App.tracker.syncGoalKind()">'
      + '<option value="number"' + (config.goal.kind === 'number' ? ' selected' : '') + '>数值目标</option>'
      + '<option value="milestone"' + (config.goal.kind === 'milestone' ? ' selected' : '') + '>按里程碑完成</option>'
      + '<option value="none"' + (config.goal.kind === 'none' ? ' selected' : '') + '>只记录，不算进度</option>'
      + '</select></label>';
    h += '<label class="trk-form-field"><span class="trk-form-label">目标方向</span><select id="trkSetGoalDirection">'
      + '<option value="up"' + (config.goal.direction !== 'down' ? ' selected' : '') + '>向上 / 增加</option>'
      + '<option value="down"' + (config.goal.direction === 'down' ? ' selected' : '') + '>向下 / 减少</option>'
      + '</select></label></div>';
    h += '<div id="trkGoalNumBox">';
    h += '<div class="trk-form-field"><span class="trk-form-label">目标统计口径</span>' + metricEditor('trkSetGoal', config.goal && config.goal.metric, fields) + '</div>';
    h += '<div class="trk-set-grid3"><label class="trk-form-field"><span class="trk-form-label">目标值</span><input id="trkSetGoalTarget" type="number" step="any" value="' + escAttr(config.goal && config.goal.target != null ? config.goal.target : '') + '" placeholder="例如 65 / 12"></label>';
    h += '<label class="trk-form-field"><span class="trk-form-label">单位</span><input id="trkSetGoalUnit" maxlength="8" value="' + escAttr(config.goal && config.goal.unit || '') + '" placeholder="kg / 本"></label>';
    h += '<label class="trk-form-field"><span class="trk-form-label">基线（反向目标）</span><input id="trkSetGoalBaseline" type="number" step="any" value="' + escAttr(config.goal && config.goal.baseline != null ? config.goal.baseline : '') + '" placeholder="留空自动取最早记录"></label></div>';
    h += '</div></div>';

    h += '<div class="trk-set-sec"><div class="trk-set-sec-head"><b>每周目标</b><span>北京时间周一 ~ 周日</span></div>';
    h += '<div class="trk-form-field"><span class="trk-form-label">统计口径</span>' + metricEditor('trkSetWeek', config.week && config.week.metric, fields) + '</div>';
    h += '<div class="trk-set-grid2"><label class="trk-form-field"><span class="trk-form-label">每周目标值</span><input id="trkSetWeekTarget" type="number" step="any" value="' + escAttr(config.week && config.week.target != null ? config.week.target : '') + '" placeholder="例如 3"></label>';
    h += '<label class="trk-form-field"><span class="trk-form-label">单位</span><input id="trkSetWeekUnit" maxlength="8" value="' + escAttr(config.week && config.week.unit || '') + '" placeholder="次 / 份"></label></div></div>';

    h += '<div class="trk-set-sec"><div class="trk-set-sec-head"><b>日期</b><span>开始日期必填；目标日期可后补</span></div>';
    h += '<div class="trk-set-grid2"><label class="trk-form-field"><span class="trk-form-label">开始日期 *</span><input id="trkSetStart" type="date" value="' + escAttr(config.startDate || '') + '"></label>';
    h += '<label class="trk-form-field"><span class="trk-form-label">目标日期</span><input id="trkSetTarget" type="date" value="' + escAttr(config.targetDate || '') + '"></label></div>';
    h += '<div class="trk-set-grid2"><label class="trk-form-field"><span class="trk-form-label">记录日期字段</span><select id="trkSetDateField">' + setFieldOptions(fields, config.dateField) + '</select></label>';
    h += '<label class="trk-form-field"><span class="trk-form-label">看板列字段</span><select id="trkSetKanbanField">' + setFieldOptions(fields, config.kanbanField) + '</select></label></div>';
    h += '<label class="trk-form-field"><span class="trk-form-label">表格标题字段</span><select id="trkSetTitleField">' + setFieldOptions(fields, config.titleField) + '</select></label></div>';

    h += '<div class="trk-set-sec"><div class="trk-set-sec-head"><b>里程碑</b><span>手动勾选完成；周/月汇总会列出本期完成的里程碑</span></div>';
    h += '<div class="trk-ms-list" id="trkSetMilestones">' + (config.milestones || []).map(milestoneRowHtml).join('') + '</div>';
    h += '<button type="button" class="trk-btn trk-btn-sm" onclick="App.tracker.addSetMilestone()">＋ 加里程碑</button></div>';

    h += '<div class="trk-set-hint">字段 key 会保留；改名不影响历史记录。删掉字段后历史数据仍在库里，重新加回同名字段会显示旧值。</div>';

    document.getElementById('trkSetBody').innerHTML = h;
    document.getElementById('trkSetSave').disabled = false;
    document.getElementById('trkSetOverlay').classList.add('active');
    syncGoalKind();
  }

  function syncGoalKind() {
    var kindEl = document.getElementById('trkSetGoalKind');
    var box = document.getElementById('trkGoalNumBox');
    if (!kindEl || !box) return;
    box.style.display = kindEl.value === 'number' ? '' : 'none';
  }

  function addSetField() {
    var box = document.getElementById('trkSetFields');
    if (!box) return;
    if (box.children.length >= 24) { toast('最多 24 个字段'); return; }
    var n = box.children.length + 1;
    var key = 'f' + Date.now().toString(36) + n;
    box.insertAdjacentHTML('beforeend', fieldRowHtml({ key: key, name: '', type: 'text', options: [], unit: '', required: false }));
  }
  function removeSetField(btn) {
    var row = btn.closest('.trk-set-row');
    var box = document.getElementById('trkSetFields');
    if (row && box && box.children.length <= 1) { toast('至少保留一个字段'); return; }
    if (row) row.remove();
  }
  function addSetMilestone() {
    var box = document.getElementById('trkSetMilestones');
    if (!box) return;
    if (box.children.length >= 40) { toast('里程碑最多 40 个'); return; }
    var id = 'm' + Date.now().toString(36) + box.children.length;
    box.insertAdjacentHTML('beforeend', milestoneRowHtml({ id: id, name: '', targetDate: '', targetValue: null, done: false }));
  }
  function removeSetMilestone(btn) {
    var row = btn.closest('.trk-ms-row');
    if (row) row.remove();
  }

  function collectSetFields() {
    var rows = document.querySelectorAll('#trkSetFields .trk-set-row');
    var out = [];
    Array.prototype.forEach.call(rows, function(row) {
      var name = row.querySelector('.trk-set-name').value.trim();
      if (!name) return;
      var type = row.querySelector('.trk-set-type').value;
      var options = row.querySelector('.trk-set-options').value.split(/[,，]/).map(function(x) { return x.trim(); }).filter(Boolean);
      out.push({
        key: row.getAttribute('data-key'),
        name: name,
        type: type,
        options: type === 'select' ? options : undefined,
        unit: row.querySelector('.trk-set-unit').value.trim(),
        required: row.querySelector('.trk-set-req input').checked
      });
    });
    return out;
  }

  function collectSetMilestones(oldMs) {
    var rows = document.querySelectorAll('#trkSetMilestones .trk-ms-row');
    var byId = {};
    (oldMs || []).forEach(function(m) { byId[m.id] = m; });
    var out = [];
    Array.prototype.forEach.call(rows, function(row) {
      var name = row.querySelector('.trk-ms-name').value.trim();
      if (!name) return;
      var id = row.getAttribute('data-id');
      var old = byId[id];
      var done = row.querySelector('.trk-ms-done').checked;
      var tv = row.querySelector('.trk-ms-target').value;
      out.push({
        id: id,
        name: name,
        targetDate: row.querySelector('.trk-ms-date').value || '',
        targetValue: tv === '' ? null : Number(tv),
        done: done,
        doneDate: done ? ((old && old.doneDate) || todayBj()) : ''
      });
    });
    return out;
  }

  function closeSettings() {
    var el = document.getElementById('trkSetOverlay');
    if (el) el.classList.remove('active');
    _set = null;
  }

  function saveSettings() {
    if (!_set || !_detail) return;
    var fields = collectSetFields();
    if (!fields.length) { toast('至少保留一个有名字的字段'); return; }
    var goalText = (document.getElementById('trkSetGoalText') || {}).value || '';
    goalText = String(goalText).trim();
    if (!goalText) { toast('请填写项目目标'); return; }
    var kind = (document.getElementById('trkSetGoalKind') || {}).value || 'number';
    var gt = (document.getElementById('trkSetGoalTarget') || {}).value;
    var gb = (document.getElementById('trkSetGoalBaseline') || {}).value;
    var wt = (document.getElementById('trkSetWeekTarget') || {}).value;
    var config = clone(_set.config || {});
    config.startDate = (document.getElementById('trkSetStart') || {}).value || '';
    config.targetDate = (document.getElementById('trkSetTarget') || {}).value || '';
    if (config.targetDate && config.startDate && config.targetDate < config.startDate) { toast('目标日期不能早于开始日期'); return; }
    config.goal = {
      text: goalText,
      kind: kind,
      metric: readMetric('trkSetGoal'),
      target: gt === '' || gt == null ? null : Number(gt),
      unit: ((document.getElementById('trkSetGoalUnit') || {}).value || '').trim(),
      direction: ((document.getElementById('trkSetGoalDirection') || {}).value === 'down') ? 'down' : 'up',
      baseline: gb === '' || gb == null ? null : Number(gb)
    };
    config.week = {
      target: wt === '' || wt == null ? 0 : Number(wt),
      unit: ((document.getElementById('trkSetWeekUnit') || {}).value || '').trim(),
      metric: readMetric('trkSetWeek')
    };
    config.dateField = (document.getElementById('trkSetDateField') || {}).value || '';
    config.titleField = (document.getElementById('trkSetTitleField') || {}).value || '';
    config.kanbanField = (document.getElementById('trkSetKanbanField') || {}).value || '';
    config.milestones = collectSetMilestones(config.milestones);
    config.closed = _set.config.closed || null;

    var btn = document.getElementById('trkSetSave');
    if (btn) btn.disabled = true;
    var pid = _set.projectId;
    pjRequest('PUT', '/api/tracker/fields', { projectId: pid, fields: fields, config: config })
      .then(function() {
        toast('✅ 设置已保存');
        closeSettings();
        afterChange(pid);
      }).catch(function(e) {
        if (btn) btn.disabled = false;
        toast('保存失败：' + pjErrorText(e));
      });
  }

  function toggleMilestone(id, done) {
    if (!_detail) return;
    var pid = _detail.projectId;
    pjRequest('POST', '/api/tracker/milestone', { projectId: pid, id: id, done: !!done })
      .then(function() {
        toast(done ? '✅ 里程碑完成' : '已取消完成');
        loadDetail();
        if (typeof loadProjects === 'function') loadProjects().then(function() { if (document.getElementById('projectContent')) renderProject(); });
      }).catch(function(e) { toast('更新失败：' + pjErrorText(e)); });
  }

  function openPreset(btn) {
    if (!btn) return;
    var o = {};
    var f = btn.getAttribute('data-f');
    var v = btn.getAttribute('data-v');
    if (f) o[f] = v;
    openRecordForDetail(null, o);
  }

  function openRecordForDetailExport(id, presets) { openRecordForDetail(id, presets); }

  function openEditInfoSafe() {
    var pid = _detail && _detail.projectId;
    if (!pid) return;
    if (typeof closeProjectDetail === 'function') closeProjectDetail();
    if (typeof openProjectModal === 'function') openProjectModal(pid);
  }

  App.tracker = {
    pickTemplate: pickTemplate,
    setupCreateForm: setupCreateForm,
    buildCreatePayload: buildCreatePayload,
    renderListCard: renderListCard,
    renderBoardCard: renderBoardCard,
    openDetail: openDetail,
    onDetailClosed: onDetailClosed,
    reload: loadDetail,
    setTab: setTab,
    setPeriod: setPeriod,
    setTableSearch: setTableSearch,
    openRecordForDetail: openRecordForDetail,
    openPreset: openPreset,
    quickAdd: quickAdd,
    closeRecord: closeRecord,
    saveRecord: saveRecord,
    deleteRecord: deleteRecord,
    openClose: openClose,
    closeClose: closeClose,
    confirmClose: confirmClose,
    reopen: reopen,
    openSettings: openSettings,
    closeSettings: closeSettings,
    saveSettings: saveSettings,
    addSetField: addSetField,
    removeSetField: removeSetField,
    addSetMilestone: addSetMilestone,
    removeSetMilestone: removeSetMilestone,
    syncMetric: syncMetric,
    syncGoalKind: syncGoalKind,
    toggleMilestone: toggleMilestone,
    openEditInfo: openEditInfoSafe,
    openRecord: openRecordForDetailExport
  };
})();
