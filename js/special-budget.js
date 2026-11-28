// special-budget.js — 特殊预算前端（v3.2.5）
// 依赖：utils.js（esc/toast）、auth.js（getPin/refreshAccessToken）、api.js（API_BASE）、needs.js（needsList/loadNeeds/needRefresh）
// 功能：汇总、申请、审批、关联采购单、分期付款/改期/提前还款、退款、年度上限设置（实时预览）。
// 所有写操作都带 Idempotency-Key；异常展示服务端中文 message。
var SB = {
  year: null, month: null, tab: 'overview', busy: false, off: false,
  data: null, config: null, configHistory: [], approvals: [], error: null, isAdmin: false,
  detail: null, detailId: null, linkPickerFor: null, applyError: null,
  ledger: null, ledgerLoading: false, ledgerError: null,
  audit: null, snapshots: null, auditLoading: false, auditError: null,
  monitor: null, monitorLoading: false, monitorError: null, monitorForbidden: false,
  form: { type: 'normal', amount: '', purpose: '', installments: 12, note: '' },
};
var SB_TYPE_LABEL = { normal: '普通申请', additional: '周六追加', large: '大额采购' };
var SB_TYPE_SHORT = { normal: '普通', additional: '周六追加', large: '大额' };
var SB_STATUS_LABEL = {
  pending: '待审批', approved: '已批准', rejected: '已驳回',
  cancelled: '已取消', expired: '已过期', closed: '已关闭',
};
var SB_SCHED_LABEL = {
  planned: '待付', paid: '已付', refunded: '已退', released: '已释放', overdue: '逾期',
};
var SB_ERR = {
  NOT_IN_WINDOW: '当前不在申请窗口（普通每月 1/15；周六追加仅周六；大额 1/15 或周六）',
  MONTHLY_CAP_EXCEEDED: '本月 800 常规额度不足',
  ANNUAL_EXCEEDED: '年度额度不足',
  LARGE_REQUIRED: '超过 800 需走大额采购',
  LARGE_THRESHOLD_NOT_MET: '大额采购金额必须超过 800',
  MONTHLY_NOT_FULLY_APPROVED: '当月 800 尚未全部批完，不能申请周六追加',
  SATURDAY_CAP_EXCEEDED: '本周六追加额度不足（年度上限 × 10%）',
  SECOND_CONFIRM_REQUIRED: '需要同一账号二次确认',
  IDEMPOTENCY_KEY_REQUIRED: '缺少幂等键，请重试',
  CONFIG_MISSING: '该年度未配置特殊预算',
  APPROVAL_EXPIRED: '审批单已过期',
  NOT_PENDING: '审批单当前状态不允许此操作',
  PAY_OUT_OF_ORDER: '请先支付更早的分期',
  SCHEDULE_NOT_PAYABLE: '该分期当前不能付款',
  NO_PAID_AMOUNT: '该订单没有可退金额',
  REFUND_EXCEEDS_PAID: '退款金额超过已付未退金额',
  NOT_FUTURE_YEAR: '只有未来年度分期可以提前还款',
  SAME_PERIOD: '改期目标与当前分期相同',
  '2026_ONLY_DECEMBER': '2026 年仅 12 月试运行',
  CROSS_YEAR_NOT_ALLOWED: '2026 年分期不允许跨年',
  LINK_AMOUNT_MISMATCH: '关联金额必须等于采购单总额',
  LINK_EXCEEDS_APPROVED: '超出批准金额',
  ORDER_ALREADY_SPECIAL: '采购单已属于特殊预算',
  ORDER_ALREADY_LINKED: '采购单已被其它特殊审批占用',
  ORDER_NOT_LINKABLE: '采购单当前状态不能关联',
  HISTORY_READONLY: '历史年份只读',
  CONFIG_TOO_LOW: '调低被拒绝：不能低于已占用/未来承诺',
};

function sbNum(n) { return Number(n) || 0; }
function sbY(n) { return '¥' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
function sbY0(n) { return '¥' + (Math.round(Number(n) || 0)).toLocaleString('zh-CN'); }
function sbRound2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function sbBjParts() {
  var d = new Date(Date.now() + 8 * 3600000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay(), hour: d.getUTCHours() };
}
function sbPad(n) { return String(n).padStart(2, '0'); }
function sbToday() { var p = sbBjParts(); return p.year + '-' + sbPad(p.month) + '-' + sbPad(p.day); }
function sbNowText() { var p = sbBjParts(); return sbToday() + ' ' + sbPad(p.hour) + ':' + sbPad(new Date().getUTCMinutes()); }
function sbDefaultYM() {
  var p = sbBjParts();
  if (p.year === 2026 && p.month < 12) return { year: 2026, month: 12 }; // 试运行前默认看 12 月
  return { year: p.year, month: p.month };
}
function sbCurrentYM() { var p = sbBjParts(); return { year: p.year, month: p.month }; }
function sbIsCurrentPeriod() { var p = sbCurrentYM(); return SB.year === p.year && SB.month === p.month; }
function sbNewKey(scope) { return 'sb-' + scope + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
function sbErrMsg(r) {
  if (!r) return '操作失败';
  if (r.code && SB_ERR[r.code]) return SB_ERR[r.code] + (r.message ? '（' + r.message + '）' : '');
  return r.message || r.code || ('HTTP ' + (r.status || '错误'));
}
function sbStatusChip(st) {
  var cls = st === 'approved' ? 'green' : (st === 'pending' ? 'amber' : (st === 'rejected' || st === 'cancelled' || st === 'expired' ? 'gray' : ''));
  return '<span class="sb-chip ' + cls + '">' + esc(SB_STATUS_LABEL[st] || st) + '</span>';
}
function sbTypeChip(t) { return '<span class="sb-chip">' + esc(SB_TYPE_LABEL[t] || t) + '</span>'; }
function sbFindOrder(orderId) {
  var v = String(orderId).replace(/^rec_/, '');
  for (var i = 0; i < (needsList || []).length; i++) {
    var n = needsList[i], os = n.orders || [];
    for (var j = 0; j < os.length; j++) {
      if (String(os[j].id).replace(/^rec_/, '') === v) return { need: n, order: os[j] };
    }
  }
  return null;
}
function sbOrderLabel(orderId) {
  var hit = sbFindOrder(orderId);
  if (!hit) return '采购单 #' + orderId;
  var o = hit.order, amt = sbNum(o['实付']) * sbNum(o['数量'] || 1);
  return hit.need['名称'] + ' · ' + sbY(amt) + ' · ' + (o['状态'] || '');
}

// ---------------- API ----------------
async function sbApi(method, path, body, idemKey) {
  var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin() };
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  var opts = { method: method, headers: headers, cache: 'no-store' };
  if (body !== undefined && method !== 'GET') opts.body = JSON.stringify(body);
  var url = API_BASE + '/api/special-budget' + path;
  try {
    var r = await fetch(url, opts);
    if (r.status === 401) {
      var nt = await refreshAccessToken();
      if (nt) { headers['Authorization'] = 'Bearer ' + nt; r = await fetch(url, opts); }
    }
    var data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (r.status === 404 && (!data || data.error === 'not_found')) return { ok: false, off: true, status: 404 };
    if (!r.ok) {
      return { ok: false, status: r.status, code: data && data.error, message: data && (data.message || data.error), detail: data && data.detail, data: data };
    }
    return { ok: true, status: r.status, data: data };
  } catch (e) {
    return { ok: false, status: 0, code: 'NETWORK', message: '网络错误，请重试' };
  }
}

// ---------------- 页面骨架 ----------------
function sbEnsure() {
  if (document.getElementById('sbOverlay')) return;
  var years = '';
  for (var y = 2026; y <= Math.max(2030, sbBjParts().year + 2); y++) years += '<option value="' + y + '">' + y + ' 年</option>';
  var months = '';
  for (var m = 1; m <= 12; m++) months += '<option value="' + m + '">' + m + ' 月</option>';
  var html = '<div class="sb-overlay" id="sbOverlay">'
    + '<div class="sb-shell"><div class="sb-top">'
    + '<div class="sb-top-row">'
    + '<div class="sb-title">🧾 特殊预算<small id="sbAsOf">加载中…</small></div>'
    + '<select id="sbYear" class="sb-select" onchange="sbPeriodChanged()">' + years + '</select>'
    + '<select id="sbMonth" class="sb-select" onchange="sbPeriodChanged()">' + months + '</select>'
    + '<button type="button" class="sb-icon-btn" onclick="sbReload()" title="刷新">↻</button>'
    + '<button type="button" class="sb-icon-btn" onclick="sbClose()" title="关闭">✕</button>'
    + '</div><div class="sb-tabs" id="sbTabs"></div></div>'
    + '<div class="sb-body" id="sbBody"></div></div></div>'
    + '<div class="sb-detail-overlay" id="sbDetailOverlay" onclick="if(event.target===this)sbCloseDetail()">'
    + '<div class="sb-detail" id="sbDetail"></div></div>';
  var wrap = document.createElement('div');
  wrap.innerHTML = html;
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
}
function sbSyncSelectors() {
  var yEl = document.getElementById('sbYear'), mEl = document.getElementById('sbMonth');
  if (!yEl || !mEl) return;
  if (!SB.year) { var d = sbDefaultYM(); SB.year = d.year; SB.month = d.month; }
  if (!yEl.querySelector('option[value="' + SB.year + '"]')) {
    var op = document.createElement('option'); op.value = SB.year; op.textContent = SB.year + ' 年'; yEl.appendChild(op);
  }
  yEl.value = String(SB.year);
  mEl.value = String(SB.month);
}
function openSpecialBudget(approvalId) {
  sbEnsure();
  var d = sbDefaultYM();
  SB.year = d.year; SB.month = d.month; SB.tab = 'overview'; SB.off = false; SB.error = null; SB.isAdmin = false;
  sbSyncSelectors();
  var el = document.getElementById('sbOverlay');
  if (el) el.classList.add('active');
  document.body.style.overflow = 'hidden';
  sbLoad(approvalId || null);
}
function sbClose() {
  var el = document.getElementById('sbOverlay');
  if (el) el.classList.remove('active');
  sbCloseDetail();
  document.body.style.overflow = '';
}
function sbPeriodChanged() {
  var yEl = document.getElementById('sbYear'), mEl = document.getElementById('sbMonth');
  if (!yEl || !mEl) return;
  SB.year = Number(yEl.value) || SB.year;
  SB.month = Number(mEl.value) || SB.month;
  SB.linkPickerFor = null; SB.applyError = null;
  SB.ledger = null; SB.audit = null; SB.snapshots = null;
  SB.monitor = null; SB.monitorError = null; SB.monitorForbidden = false;
  sbLoad(null);
}
function sbSetTab(t) {
  if (t === 'settings' && !SB.isAdmin) return;
  SB.tab = t; SB.applyError = null;
  sbRender();
  if (t === 'ledger') sbLoadLedger();
  if (t === 'audit') sbLoadAudit();
}
function sbGoCurrent() {
  var p = sbCurrentYM();
  SB.year = p.year; SB.month = p.month;
  sbSyncSelectors();
  sbLoad(null);
}
async function sbReload() { await sbLoad(SB.detailId || null); }

// ---------------- 加载 ----------------
async function sbLoad(focusId) {
  sbEnsure();
  SB.busy = true;
  SB.error = null; SB.off = false;
  var y = SB.year, m = SB.month;
  var sres = await sbApi('GET', '/summary?year=' + y + '&month=' + m);
  if (sres.off) {
    SB.off = true; SB.busy = false; SB.data = null; SB.config = null; SB.approvals = [];
    sbRender(); return;
  }
  var results = await Promise.all([
    sbApi('GET', '/config?year=' + y),
    sbApi('GET', '/approvals?year=' + y + '&month=' + m),
  ]);
  var cres = results[0], lres = results[1];
  SB.data = sres.ok ? sres.data : null;
  SB.isAdmin = !!(sres.ok && sres.data && sres.data.is_admin);
  if (!SB.isAdmin && SB.tab === 'settings') SB.tab = 'overview';
  SB.config = cres.ok ? cres.data.config : null;
  SB.configHistory = cres.ok ? (cres.data.history || []) : [];
  SB.approvals = lres.ok ? (lres.data.approvals || []) : [];
  if (!sres.ok) {
    SB.error = { code: sres.code, message: sbErrMsg(sres) };
  } else if (!cres.ok && !cres.off) {
    SB.error = { code: cres.code, message: sbErrMsg(cres) };
  }
  SB.busy = false;
  sbSyncSelectors();
  sbRender();
  if (focusId) sbOpenApproval(focusId);
  if (SB.tab === 'ledger') sbLoadLedger();
  else if (SB.tab === 'audit') sbLoadAudit();
}
function sbRender() {
  var asOf = document.getElementById('sbAsOf');
  if (asOf) {
    var s = SB.data && SB.data.summary;
    asOf.textContent = SB.off ? '功能未开启' : (s ? ('截至 ' + (SB.data.as_of || sbNowText()) + ' · 全局额度') : '加载中…');
  }
  var tabs = document.getElementById('sbTabs');
  if (tabs) {
    var defs = [['overview', '📊 概览'], ['apply', '📝 申请'], ['records', '📋 记录' + (SB.approvals.length ? '（' + SB.approvals.length + '）' : '')], ['ledger', '📒 台账'], ['audit', '🔍 审计']];
    // 年度上限是全局配置，仅管理员可改；非管理员不显示入口（服务端 PUT 仍会 403 兜底）。
    if (SB.isAdmin) defs.push(['settings', '⚙️ 年度设置']);
    tabs.innerHTML = defs.map(function (d) {
      return '<button type="button" class="sb-tab' + (SB.tab === d[0] ? ' active' : '') + '" onclick="sbSetTab(\'' + d[0] + '\')">' + d[1] + '</button>';
    }).join('');
  }
  var body = document.getElementById('sbBody');
  if (!body) return;
  if (SB.off) {
    body.innerHTML = '<div class="sb-card"><div class="sb-empty">特殊预算未开启。<br>服务端需设置 <code>SPECIAL_BUDGET_ENABLED=1</code> 并重启后可用。</div></div>';
    return;
  }
  if (SB.tab === 'apply') body.innerHTML = sbRenderApply();
  else if (SB.tab === 'records') body.innerHTML = sbRenderRecords();
  else if (SB.tab === 'ledger') body.innerHTML = sbRenderLedger();
  else if (SB.tab === 'audit') body.innerHTML = sbRenderAudit();
  else if (SB.tab === 'settings') body.innerHTML = sbRenderSettings();
  else body.innerHTML = sbRenderOverview();
}

// ---------------- 概览 ----------------
function sbRenderOverview() {
  if (!SB.data || !SB.data.summary) {
    var msg = SB.error ? sbErrMsg(SB.error) : '加载失败';
    return '<div class="sb-card"><div class="sb-warn">' + esc(msg) + '</div>'
      + (SB.isAdmin ? '<div class="sb-note">可切换到「年度设置」创建该年度上限（需理由 + 同一账号二次确认）。</div>' : '')
      + '</div>';
  }
  var d = SB.data, s = d.summary, c = d.config;
  var cap = sbNum(s.annual_cap), used = sbNum(s.annual_committed);
  var pct = cap > 0 ? Math.max(0, Math.min(100, used / cap * 100)) : 0;
  var future = (s.future_commitments || []).map(function (f) { return f.year + ' 年 ' + sbY(f.amount); }).join('、') || '无';
  var trial = (c && c.year === 2026) ? '<div class="sb-warn" style="margin-top:10px">2026 年为试运行：仅 12 月，年度上限 ' + sbY(c.annual_cap) + '，不允许跨年分期。</div>' : '';
  var h = '<div class="sb-card sb-hero">'
    + '<div class="sb-hero-label">' + d.year + ' 年年度剩余</div>'
    + '<div class="sb-hero-amount">' + sbY(s.annual_remaining) + '</div>'
    + '<div class="sb-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>'
    + '<div class="sb-hero-sub">已占用 ' + sbY(used) + ' / 上限 ' + sbY(cap) + ' · 已付 ' + sbY(s.annual_paid) + ' · 已退 ' + sbY(s.annual_refunded) + '</div>'
    + '</div>';
  h += '<div class="sb-grid">'
    + sbMetric('本月常规 800', sbY(s.monthly_regular_available), '已批 ' + sbY(s.monthly_regular_approved) + ' / 上限 ' + sbY(s.monthly_regular_cap))
    + sbMetric('本月分期应还', sbY(s.monthly_installment_due), (d.month) + ' 月待付/逾期计划')
    + sbMetric('本月特殊现金流', sbY(s.monthly_cash), '已付 − 已退（' + d.month + ' 月）')
    + sbMetric('待审批', String(s.approvals.pending) + ' 单', '已批准 ' + s.approvals.approved + ' 单')
    + sbMetric('周六追加已批', sbY(s.monthly_additional_approved), '不占月度 800')
    + sbMetric('未来年度承诺', future, '含提前还款/分期跨年')
    + '</div>';
  h += trial;
  h += '<div class="sb-section-title">计算口径</div><div class="sb-card">'
    + '<div class="sb-note">年度已占用 = 计划总额 − 已释放 − 已退款（含未付款的计划期）。</div>'
    + '<div class="sb-note" style="margin-top:4px">月度常规可用 = max(0, 800 − 本月已批普通申请)。大额、周六追加不占月度 800。</div>'
    + '<div class="sb-note" style="margin-top:4px">申请窗口：普通=每月 1/15；周六追加=每周六且当月 800 已全部批完；大额=1/15 或周六。</div>'
    + '<div class="sb-note" style="margin-top:4px">规则版本：' + esc((c && c.rule_version) || '—') + '（全局额度，所有账号共用）</div>'
    + '</div>';
  h += '<div class="sb-actions"><button type="button" class="sb-btn pri" onclick="sbSetTab(\'apply\')">＋ 发起申请</button><button type="button" class="sb-btn" onclick="sbSetTab(\'records\')">查看记录</button></div>';
  return h;
}
function sbMetric(k, v, s) {
  return '<div class="sb-metric"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s || '') + '</div></div>';
}

// ---------------- 申请 ----------------
function sbWindowState(type) {
  var p = sbBjParts(), reasons = [];
  var c = SB.config;
  if (!c) return { ok: false, reasons: ['该年度未配置特殊预算'] };
  if (c.effective_from) {
    var eff = String(c.effective_from).slice(0, 10);
    if (sbToday() < eff) reasons.push('试运行自 ' + eff + ' 开始');
  }
  if (type === 'normal') {
    if (!(p.day === 1 || p.day === 15)) reasons.push('普通仅每月 1 日、15 日可申请');
  }
  if (type === 'large') {
    if (!(p.day === 1 || p.day === 15 || p.weekday === 6)) reasons.push('仅每月 1 日、15 日或周六');
  }
  if (type === 'additional') {
    if (p.weekday !== 6) reasons.push('周六追加仅周六可申请');
    if (SB.data && sbNum(SB.data.summary.monthly_regular_approved) + 0.005 < sbNum(SB.data.summary.monthly_regular_cap)) {
      reasons.push('当月 800 尚未全部批完');
    }
  }
  if (type === 'large' && c.cross_year_allowed !== 1 && (Number(SB.form.installments) || 1) > 1) {
    reasons.push('该年度不允许跨年分期，大额只能 1 期');
  }
  return { ok: reasons.length === 0, reasons: reasons };
}
function sbRenderApply() {
  var h = '';
  if (!SB.config || !SB.data) {
    return '<div class="sb-card"><div class="sb-warn">' + esc(SB.error ? sbErrMsg(SB.error) : '当前年度无配置，无法申请') + '</div></div>';
  }
  if (!sbIsCurrentPeriod()) {
    h += '<div class="sb-warn">申请始终按「当前北京时间」提交，不是所选 ' + SB.year + ' 年 ' + SB.month + ' 月。'
      + '<button type="button" class="sb-btn" style="margin-top:8px;padding:7px 10px" onclick="sbGoCurrent()">切到当前月份</button></div>';
  }
  var st = sbWindowState(SB.form.type);
  h += st.ok
    ? '<div class="sb-ok">当前在申请窗口内（' + esc(SB_TYPE_LABEL[SB.form.type]) + '）。</div>'
    : '<div class="sb-warn"><b>当前不能提交：</b>' + esc(st.reasons.join('；')) + '</div>';
  var typeBtns = [['normal', '普通', '≤ 800/月'], ['additional', '周六追加', '占用上限×10%'], ['large', '大额', '> 800，可分期']];
  h += '<div class="sb-type-row">' + typeBtns.map(function (t) {
    return '<button type="button" class="sb-type' + (SB.form.type === t[0] ? ' active' : '') + '" onclick="sbSetType(\'' + t[0] + '\')">'
      + esc(t[1]) + '<small>' + esc(t[2]) + '</small></button>';
  }).join('') + '</div>';
  h += '<div class="sb-card">';
  h += '<div class="sb-field"><label>金额（元）</label><input id="sbAmount" type="number" min="0.01" step="0.01" inputmode="decimal" value="' + escAttr(SB.form.amount) + '" placeholder="0.00" oninput="sbFormInput(\'amount\',this.value)"></div>';
  h += '<div class="sb-field"><label>用途 *</label><input id="sbPurpose" type="text" maxlength="200" value="' + escAttr(SB.form.purpose) + '" placeholder="如：换洗衣机" oninput="sbFormInput(\'purpose\',this.value)"></div>';
  if (SB.form.type === 'large') {
    h += '<div class="sb-field"><label>分期期数（1~120）</label><input id="sbInstallments" type="number" min="1" max="120" value="' + escAttr(SB.form.installments) + '" oninput="sbFormInput(\'installments\',this.value)"></div>';
  }
  h += '<div class="sb-field"><label>备注（可选）</label><textarea id="sbNote" maxlength="500" oninput="sbFormInput(\'note\',this.value)" placeholder="补充说明">' + esc(SB.form.note) + '</textarea></div>';
  h += '<div id="sbPreview">' + sbApplyPreview() + '</div>';
  if (SB.applyError) h += '<div class="sb-err" style="margin-top:10px">' + esc(SB.applyError) + '</div>';
  var disabled = !st.ok || SB.busy || !sbIsCurrentPeriod();
  h += '<button type="button" class="sb-btn pri" style="width:100%;margin-top:10px" ' + (disabled ? 'disabled' : '') + ' onclick="sbSubmitApplication()">提交申请</button>';
  h += '<div class="sb-note" style="margin-top:8px">提交后为「待审批」，本人在记录里批准；大额必须同一账号二次确认。</div>';
  h += '</div>';
  return h;
}
function sbSetType(t) {
  SB.form.type = t;
  SB.applyError = null;
  sbRender();
}
function sbFormInput(key, val) {
  SB.form[key] = val;
  var el = document.getElementById('sbPreview');
  if (el) el.innerHTML = sbApplyPreview();
}
function sbInstallmentPreview(total, installments) {
  var p = sbBjParts();
  var n = Math.max(1, Math.min(120, Math.floor(Number(installments) || 1)));
  var t = sbRound2(total);
  if (!(t > 0) || n < 1) return '';
  var base = sbRound2(t / n);
  var last = sbRound2(t - base * (n - 1));
  var seg = {}, order = [];
  for (var i = 0; i < n; i++) {
    var idx = p.year * 12 + (p.month - 1) + i;
    var yy = Math.floor(idx / 12), mm = (idx % 12) + 1;
    if (!seg[yy]) { seg[yy] = { amount: 0, count: 0, first: mm, last: mm }; order.push(yy); }
    seg[yy].amount = sbRound2(seg[yy].amount + (i === n - 1 ? last : base));
    seg[yy].count++; seg[yy].last = mm;
  }
  var parts = order.map(function (y) { return y + ' 年 ' + seg[y].count + ' 期 ' + sbY(seg[y].amount); }).join('；');
  return '每期约 ' + sbY(base) + (last !== base ? '（末期 ' + sbY(last) + '）' : '') + '，共 ' + n + ' 期。<br>按年占用：' + parts + '<br><span style="font-size:11px">最终以服务端年度上限校验为准。</span>';
}
function sbApplyPreview() {
  var c = SB.config;
  if (!c || !SB.data) return '';
  var s = SB.data.summary;
  var amt = sbRound2(Number(SB.form.amount) || 0);
  var h = '<div class="sb-preview">';
  if (SB.form.type === 'normal') {
    h += '本月常规可用 <b>' + sbY(s.monthly_regular_available) + '</b>，年度剩余 <b>' + sbY(s.annual_remaining) + '</b>。';
    if (amt > 800 + 0.005) h += '<br><span style="color:#b91c1c">超过 800，请改走大额采购。</span>';
    else if (amt > sbNum(s.monthly_regular_available) + 0.005) h += '<br><span style="color:#b91c1c">超出本月常规可用。</span>';
    else if (amt > sbNum(s.annual_remaining) + 0.005) h += '<br><span style="color:#b91c1c">超出年度剩余。</span>';
  } else if (SB.form.type === 'additional') {
    h += '周六追加不占 800，单日上限为年度上限 × 10% = <b>' + sbY(c.saturday_cap) + '</b>。';
    if (amt > sbNum(c.saturday_cap) + 0.005) h += '<br><span style="color:#b91c1c">超过周六单日上限。</span>';
    if (amt > sbNum(s.annual_remaining) + 0.005) h += '<br><span style="color:#b91c1c">超出年度剩余。</span>';
  } else {
    h += '大额不占 800 / 周六 10%，按分期分段占年度上限。当前年度剩余 <b>' + sbY(s.annual_remaining) + '</b>。';
    if (amt > 0 && amt <= 800.005) h += '<br><span style="color:#b91c1c">大额金额必须大于 800。</span>';
    if (amt > 0) h += '<br>' + sbInstallmentPreview(amt, SB.form.installments);
    if (!c.cross_year_allowed) h += '<br><span style="color:#b91c1c">' + c.year + ' 年不允许跨年分期。</span>';
  }
  h += '</div>';
  return h;
}
async function sbSubmitApplication() {
  if (SB.busy) return;
  var f = SB.form;
  var amt = Number(f.amount);
  var purpose = String(f.purpose || '').trim();
  if (!(amt > 0)) { SB.applyError = '请输入大于 0 的金额'; sbRender(); return; }
  if (!purpose) { SB.applyError = '请填写用途'; sbRender(); return; }
  if (!sbWindowState(f.type).ok) { SB.applyError = '当前不在申请窗口'; sbRender(); return; }
  if (!sbIsCurrentPeriod()) { SB.applyError = '请先切到当前月份'; sbRender(); return; }
  // 前端预校验与服务端同口径（服务端仍会再次强校验，防止绕过）
  var sum = SB.data && SB.data.summary;
  if (sum) {
    if (amt > sbNum(sum.annual_remaining) + 0.005) { SB.applyError = '超出年度剩余 ' + sbY(sum.annual_remaining); sbRender(); return; }
    if (f.type === 'normal') {
      if (amt > 800 + 0.005) { SB.applyError = '超过 800，请改走大额采购'; sbRender(); return; }
      if (amt > sbNum(sum.monthly_regular_available) + 0.005) { SB.applyError = '超出本月常规可用 ' + sbY(sum.monthly_regular_available); sbRender(); return; }
    }
    if (f.type === 'additional' && SB.config && amt > sbNum(SB.config.saturday_cap) + 0.005) {
      SB.applyError = '超过周六单日上限 ' + sbY(SB.config.saturday_cap); sbRender(); return;
    }
    if (f.type === 'large' && amt <= 800.005) { SB.applyError = '大额金额必须大于 800'; sbRender(); return; }
  }
  SB.busy = true; SB.applyError = null;
  var body = { type: f.type, amount: amt, purpose: purpose, note: f.note || undefined };
  if (f.type === 'large') body.installments = Number(f.installments) || 1;
  var r = await sbApi('POST', '/approvals', body, sbNewKey('submit'));
  SB.busy = false;
  if (!r.ok) { SB.applyError = sbErrMsg(r); sbRender(); return; }
  toast('申请已提交：' + (r.data.approval.approval_no || ''));
  SB.form = { type: f.type, amount: '', purpose: '', installments: f.installments, note: '' };
  SB.tab = 'records';
  await sbAfterWrite(null);
}

// ---------------- 记录 ----------------
function sbRenderRecords() {
  var h = '';
  if (SB.error && !SB.data) h += '<div class="sb-warn">' + esc(SB.error.message) + '</div>';
  h += '<div class="sb-note" style="margin-bottom:10px">仅显示 ' + SB.year + ' 年 ' + SB.month + ' 月提交的申请；点「详情」查看分期与资金操作。</div>';
  if (!SB.approvals.length) {
    h += '<div class="sb-card"><div class="sb-empty">本月暂无申请<br><button type="button" class="sb-btn pri" style="margin-top:10px" onclick="sbSetTab(\'apply\')">＋ 发起申请</button></div></div>';
    return h;
  }
  h += SB.approvals.map(function (a) {
    var cls = a.status === 'pending' ? 'pending' : (a.status === 'approved' ? 'approved' : a.status);
    var money = '申请 ' + sbY(a.requested_amount) + (a.approved_amount != null ? ' · 批准 ' + sbY(a.approved_amount) : '');
    var acts = '<button type="button" class="sb-btn" onclick="sbOpenApproval(' + a.id + ')">详情</button>';
    if (a.status === 'pending') {
      acts += '<button type="button" class="sb-btn pri" onclick="sbApprove(' + a.id + ')">批准</button>'
        + '<button type="button" class="sb-btn ghost" onclick="sbReject(' + a.id + ')">驳回</button>';
    }
    if (a.status === 'approved') {
      acts += '<button type="button" class="sb-btn pri" onclick="sbOpenApproval(' + a.id + ')">付款 / 退款</button>';
    }
    return '<div class="sb-approval ' + cls + '" data-approval="' + a.id + '">'
      + '<div class="sb-approval-head"><div class="t">' + esc(a.purpose || SB_TYPE_LABEL[a.type]) + '</div>'
      + sbTypeChip(a.type) + sbStatusChip(a.status) + '</div>'
      + '<div class="sb-approval-money">' + esc(money) + '</div>'
      + '<div class="sb-approval-meta">' + esc(a.approval_no || '') + ' · 申请 ' + esc(a.applied_at || '') + (a.status !== 'pending' && a.approved_at ? ' · 批准 ' + esc(a.approved_at) : '') + '</div>'
      + (a.note ? '<div class="sb-approval-meta">💬 ' + esc(a.note) + '</div>' : '')
      + '<div class="sb-actions" style="margin-top:9px">' + acts + '</div></div>';
  }).join('');
  return h;
}
async function sbApprove(id) {
  var a = null;
  for (var i = 0; i < SB.approvals.length; i++) if (SB.approvals[i].id === id) a = SB.approvals[i];
  if (!a) { var d = await sbApi('GET', '/approvals/' + id); if (!d.ok) { toast(sbErrMsg(d)); return; } a = d.data.approval; }
  var amtStr = prompt('批准金额（申请 ' + sbY(a.requested_amount) + '，不能超过申请金额）', String(a.requested_amount));
  if (amtStr === null) return;
  var amount = Number(amtStr);
  if (!(amount > 0)) { toast('批准金额无效'); return; }
  var body = { approvedAmount: amount };
  if (a.type === 'large') {
    var instStr = prompt('分期期数（1~120）', String(a.installments || 12));
    if (instStr === null) return;
    var inst = Number(instStr);
    if (!(inst >= 1 && inst <= 120)) { toast('分期期数无效'); return; }
    body.installments = Math.floor(inst);
    if (!confirm('大额采购需同一账号二次确认：批准 ' + sbY(amount) + '，' + body.installments + ' 期。确认批准？')) return;
    body.secondConfirm = true;
  }
  var reason = prompt('批准备注（可选）', '') || '';
  if (reason) body.reason = reason;
  await sbWrite('approval-' + id, sbApi('POST', '/approvals/' + id + '/approve', body, sbNewKey('approve')), '已批准');
}
async function sbReject(id) {
  var reason = prompt('驳回原因（必填）', '');
  if (reason === null) return;
  if (!String(reason).trim()) { toast('驳回原因必填'); return; }
  await sbWrite('reject-' + id, sbApi('POST', '/approvals/' + id + '/reject', { reason: String(reason).trim() }, sbNewKey('reject')), '已驳回');
}
async function sbCancel(id) {
  var reason = prompt('取消原因（选填）', '') || '申请人取消';
  await sbWrite('cancel-' + id, sbApi('POST', '/approvals/' + id + '/cancel', { reason: reason }, sbNewKey('cancel')), '已取消');
}
async function sbWrite(scope, p, okText, keepId) {
  if (SB.busy) return;
  SB.busy = true;
  var r = await p;
  SB.busy = false;
  if (!r.ok) { toast(sbErrMsg(r)); return false; }
  toast(okText);
  await sbAfterWrite(keepId === undefined ? (SB.detailId || null) : keepId);
  return true;
}
async function sbAfterWrite(detailId) {
  if (typeof needRefresh === 'function') { try { await needRefresh(); } catch (e) {} }
  await sbLoad(detailId || null);
}

// ---------------- 详情 ----------------
async function sbOpenApproval(id) {
  sbEnsure();
  SB.detailId = Number(String(id).replace(/^rec_/, ''));
  SB.linkPickerFor = null;
  var ov = document.getElementById('sbDetailOverlay'), box = document.getElementById('sbDetail');
  if (ov) ov.classList.add('active');
  if (box) box.innerHTML = '<div class="sb-empty">加载中…</div>';
  var r = await sbApi('GET', '/approvals/' + SB.detailId);
  if (!r.ok) { if (box) box.innerHTML = '<div class="sb-warn">' + esc(sbErrMsg(r)) + '</div>'; return; }
  SB.detail = r.data;
  sbRenderDetail();
}
function sbCloseDetail() {
  var ov = document.getElementById('sbDetailOverlay');
  if (ov) ov.classList.remove('active');
  SB.detailId = null; SB.linkPickerFor = null;
}
function sbRenderDetail() {
  var box = document.getElementById('sbDetail');
  if (!box) return;
  var d = SB.detail;
  if (!d) { box.innerHTML = '<div class="sb-empty">无数据</div>'; return; }
  var a = d.approval, scheds = d.schedules || [], links = d.links || [];
  var paidRemaining = 0;
  scheds.forEach(function (s) { if (s.paid_at) paidRemaining += Math.max(0, sbNum(s.amount) - sbNum(s.refund_amount)); });
  paidRemaining = sbRound2(paidRemaining);
  var activeLinks = links.filter(function (l) { return l.status === 'active'; });
  var linkedTotal = activeLinks.reduce(function (sum, l) { return sum + sbNum(l.linked_amount); }, 0);
  // 退款按采购单分别计算：退款接口按订单分摊，用审批单总额去退第一张单会超退或退错单。
  // 已释放的关联也要保留入口——部分退款会立即释放关联，但剩余已付款仍可继续按订单退。
  var refundByOrder = [];
  var seenRefundOrder = {};
  links.forEach(function (l) {
    var oid = Number(l.order_id);
    if (!oid || seenRefundOrder[oid]) return;
    seenRefundOrder[oid] = true;
    var rem = 0;
    scheds.forEach(function (s) {
      if (Number(s.order_id) !== oid || !s.paid_at) return;
      rem += Math.max(0, sbNum(s.amount) - sbNum(s.refund_amount));
    });
    rem = sbRound2(rem);
    if (rem > 0.005) refundByOrder.push({ order_id: oid, amount: rem, active: l.status === 'active' });
  });
  // 未绑定采购单的已付分期：服务端仅在“没有其他生效关联”时允许随订单一起退。
  var unboundPaid = 0;
  scheds.forEach(function (s) {
    if (s.paid_at && !s.order_id) unboundPaid += Math.max(0, sbNum(s.amount) - sbNum(s.refund_amount));
  });
  unboundPaid = sbRound2(unboundPaid);
  if (unboundPaid > 0.005 && !activeLinks.length && links.length) {
    refundByOrder.push({ order_id: Number(links[0].order_id), amount: unboundPaid, active: false, unbound: true });
  }
  var approved = a.approved_amount == null ? 0 : sbNum(a.approved_amount);
  var h = '<div class="sb-detail-head"><div class="t">' + esc(a.purpose || SB_TYPE_LABEL[a.type]) + '</div>' + sbStatusChip(a.status) + '<button type="button" class="sb-icon-btn" onclick="sbCloseDetail()">✕</button></div>';
  h += '<div class="sb-kv">'
    + '<div class="k">编号</div><div class="v">' + esc(a.approval_no || '') + '</div>'
    + '<div class="k">类型</div><div class="v">' + esc(SB_TYPE_LABEL[a.type] || a.type) + (a.installments > 1 ? ' · ' + a.installments + ' 期' : '') + '</div>'
    + '<div class="k">金额</div><div class="v">申请 ' + sbY(a.requested_amount) + (a.approved_amount != null ? ' · 批准 ' + sbY(a.approved_amount) : '') + '</div>'
    + '<div class="k">申请时间</div><div class="v">' + esc(a.applied_at || '') + '</div>'
    + '<div class="k">有效期至</div><div class="v">' + esc(a.expires_at || '—') + '</div>'
    + (a.approved_at ? '<div class="k">批准时间</div><div class="v">' + esc(a.approved_at) + '</div>' : '')
    + (a.second_confirmed_at ? '<div class="k">二次确认</div><div class="v">' + esc(a.second_confirmed_by || '') + ' · ' + esc(a.second_confirmed_at) + '</div>' : '')
    + (a.note ? '<div class="k">备注</div><div class="v">' + esc(a.note) + '</div>' : '')
    + '</div>';
  // 审批操作
  if (a.status === 'pending') {
    h += '<div class="sb-actions">'
      + '<button type="button" class="sb-btn pri" onclick="sbApprove(' + a.id + ')">批准</button>'
      + '<button type="button" class="sb-btn" onclick="sbReject(' + a.id + ')">驳回</button>'
      + '<button type="button" class="sb-btn ghost" onclick="sbCancel(' + a.id + ')">取消申请</button>'
      + '</div>';
  }
  // 关联采购单
  if (a.status === 'approved') {
    h += '<div class="sb-sub">关联采购单</div>';
    if (links.length) {
      h += '<table class="sb-table"><thead><tr><th>采购单</th><th>关联金额</th><th>状态</th><th>时间</th></tr></thead><tbody>'
        + links.map(function (l) {
          return '<tr><td>' + esc(sbOrderLabel(l.order_id)) + '</td><td class="n">' + sbY(l.linked_amount) + '</td><td>' + (l.status === 'active' ? '生效' : '已释放') + '</td><td>' + esc(l.linked_at || '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    h += '<div class="sb-note" style="margin-top:6px">已关联 ' + sbY(linkedTotal) + ' / 批准 ' + sbY(approved) + '，剩余可关联 ' + sbY(Math.max(0, approved - linkedTotal)) + '。</div>';
    if (SB.linkPickerFor === a.id) {
      h += '<div class="sb-card" style="margin-top:8px;padding:10px"><div id="sbLinkBox">' + sbLinkPickerInner(a) + '</div></div>';
    } else if (approved - linkedTotal > 0.005) {
      h += '<div class="sb-actions" style="margin-top:8px"><button type="button" class="sb-btn" onclick="sbShowLinkPicker(' + a.id + ')">＋ 关联采购单</button></div>';
    }
    if (refundByOrder.length) {
      h += '<div class="sb-actions" style="margin-top:8px;flex-wrap:wrap">'
        + refundByOrder.map(function (r) {
          return '<button type="button" class="sb-btn red" onclick="sbRefund(' + r.order_id + ',' + r.amount + ')">'
            + (r.unbound ? '退款未关联分期' : '退款 ' + esc(sbOrderLabel(r.order_id)))
            + '（可退 ' + sbY(r.amount) + '）</button>';
        }).join('') + '</div>';
    } else if (paidRemaining > 0.005) {
      h += '<div class="sb-note" style="margin-top:8px">已付款但未绑定采购单，需先重新关联采购单才能退款。</div>';
    }
  }
  // 分期计划
  h += '<div class="sb-sub">分期计划</div>';
  if (!scheds.length) {
    h += '<div class="sb-note">尚无分期计划（批准后生成）。</div>';
  } else {
    var curYear = sbBjParts().year;
    h += '<table class="sb-table"><thead><tr><th>期</th><th>所属</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>'
      + scheds.map(function (s) {
        var ops = '';
        if (a.status === 'approved' && (s.status === 'planned' || s.status === 'overdue')) {
          if (Number(s.year) > curYear) {
            ops += '<button type="button" class="sb-sched-btn pri" onclick="sbPrepay(' + s.id + ',' + s.amount + ',\'' + escAttr(s.due_date) + '\')">提前还款</button>';
          } else if (activeLinks.length > 1) {
            // 多张关联单时逐单付款：付款会把分期绑定到订单，绑错单会导致退款时金额对不上。
            ops += activeLinks.map(function (l) {
              return '<button type="button" class="sb-sched-btn pri" title="' + escAttr(sbOrderLabel(l.order_id)) + '" onclick="sbPaySchedule(' + s.id + ',' + s.seq + ',' + s.amount + ',' + l.order_id + ')">付单#' + l.order_id + '</button>';
            }).join(' ');
          } else {
            var payOrderId = activeLinks.length ? (',' + activeLinks[0].order_id) : '';
            ops += '<button type="button" class="sb-sched-btn pri" onclick="sbPaySchedule(' + s.id + ',' + s.seq + ',' + s.amount + payOrderId + ')">付款</button>';
          }
          ops += '<button type="button" class="sb-sched-btn" onclick="sbReschedule(' + s.id + ',' + s.year + ',' + (s.month || 1) + ')">改期</button>';
        }
        return '<tr><td>' + s.seq + '</td><td>' + s.year + (s.month ? '-' + sbPad(s.month) : '') + '<br><span style="font-size:10px;color:var(--muted)">' + esc(s.due_date || '') + '</span></td>'
          + '<td class="n">' + sbY(s.amount) + (sbNum(s.refund_amount) > 0 ? '<br><span style="font-size:10px;color:#dc2626">退 ' + sbY(s.refund_amount) + '</span>' : '') + '</td>'
          + '<td>' + esc(SB_SCHED_LABEL[s.status] || s.status) + (s.paid_at ? '<br><span style="font-size:10px;color:var(--muted)">' + esc(String(s.paid_at).slice(0, 10)) + '</span>' : '') + '</td>'
          + '<td>' + (ops || '<span style="color:var(--muted);font-size:10px">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  if (d.calculation) {
    h += '<div class="sb-sub">审批时计算</div>' + sbCalcBlock(d.calculation);
  }
  box.innerHTML = h;
}
function sbLinkPickerInner(a) {
  if (!needsList.length) {
    return '<div class="sb-note">采购数据未加载。<button type="button" class="sb-btn" onclick="sbLoadNeedsForLink(' + a.id + ')">加载采购数据</button></div>';
  }
  var linked = ((SB.detail && SB.detail.links) || []).filter(function (l) { return l.status === 'active'; })
    .reduce(function (sum, l) { return sum + sbNum(l.linked_amount); }, 0);
  var remaining = Math.max(0, sbNum(a.approved_amount) - linked);
  var opts = [];
  (needsList || []).forEach(function (n) {
    (n.orders || []).forEach(function (o) {
      var st = o['状态'];
      if (o['特殊预算'] === '1') return;
      if (['已归档', '已取消', '已退'].indexOf(st) >= 0) return;
      var amt = sbRound2(sbNum(o['实付']) * sbNum(o['数量'] || 1));
      if (!(amt > 0)) return;
      if (amt > remaining + 0.005) return; // 超出剩余批准金额的订单关联必失败
      opts.push({ id: o.id, need: n, order: o, amount: amt });
    });
  });
  if (!opts.length) return '<div class="sb-note">没有可关联的普通采购单（需为待下单/已下单/已到、金额 &gt; 0 且不超过剩余可关联 ' + sbY(remaining) + '）。</div>';
  return '<div class="sb-field" style="margin-bottom:8px"><label>选择采购单（关联金额必须等于订单总额）</label>'
    + '<select id="sbLinkSelect" class="sb-select" style="width:100%">'
    + opts.map(function (x) {
      return '<option value="' + escAttr(String(x.id)) + '">' + esc((x.need['名称'] || '') + ' · ' + sbY(x.amount) + ' · ' + (x.order['状态'] || '')) + '</option>';
    }).join('') + '</select></div>'
    + '<div class="sb-actions"><button type="button" class="sb-btn" onclick="sbHideLinkPicker()">取消</button>'
    + '<button type="button" class="sb-btn pri" onclick="sbLinkSelected(' + a.id + ')">确认关联</button></div>';
}
async function sbShowLinkPicker(id) {
  SB.linkPickerFor = id;
  if (!needsList.length) { try { var r = await loadNeeds(); if (Array.isArray(r)) needsList = r; } catch (e) {} }
  sbRenderDetail();
}
async function sbLoadNeedsForLink(id) {
  try { var r = await loadNeeds(); if (Array.isArray(r)) needsList = r; } catch (e) {}
  sbRenderDetail();
}
function sbHideLinkPicker() { SB.linkPickerFor = null; sbRenderDetail(); }
async function sbLinkSelected(approvalId) {
  var sel = document.getElementById('sbLinkSelect');
  if (!sel) return;
  var oid = sel.value;
  var hit = sbFindOrder(oid);
  if (!hit) { toast('采购单已变化，请刷新'); return; }
  var amt = sbRound2(sbNum(hit.order['实付']) * sbNum(hit.order['数量'] || 1));
  if (!confirm('关联「' + (hit.need['名称'] || '') + '」到本审批单，关联金额 ' + sbY(amt) + '？')) return;
  var r = await sbApi('POST', '/approvals/' + approvalId + '/link-order', { orderId: oid }, sbNewKey('link'));
  if (!r.ok) { toast(sbErrMsg(r)); return; }
  toast('已关联采购单，剩余可关联 ' + sbY(r.data.remaining));
  SB.linkPickerFor = null;
  await sbAfterWrite(approvalId);
}

// ---------------- 资金操作 ----------------
async function sbPaySchedule(sid, seq, amount, orderId) {
  if (!confirm('确认支付第 ' + seq + ' 期 ' + sbY(amount) + '？')) return;
  var body = {};
  if (orderId) body.orderId = 'rec_' + String(orderId).replace(/^rec_/, '');
  await sbWrite('pay-' + sid, sbApi('POST', '/schedules/' + sid + '/pay', body, sbNewKey('schedpay')), '第 ' + seq + ' 期已支付');
}
async function sbPrepay(sid, amount, due) {
  if (!confirm('提前还款：将 ' + due + ' 的未来分期改为今年支付 ' + sbY(amount) + '，并释放未来年度承诺。确认？')) return;
  await sbWrite('prepay-' + sid, sbApi('POST', '/schedules/' + sid + '/prepay', {}, sbNewKey('prepay')), '已提前还款');
}
async function sbReschedule(sid, curYear, curMonth) {
  var ys = prompt('改期到年份（YYYY）', String(curYear));
  if (ys === null) return;
  var ms = prompt('改期到月份（1-12）', String(curMonth));
  if (ms === null) return;
  var y = Number(ys), m = Number(ms);
  if (!(y >= 2026 && y <= 2100) || !(m >= 1 && m <= 12)) { toast('改期年月无效'); return; }
  var reason = prompt('改期原因（必填）', '');
  if (reason === null) return;
  if (!String(reason).trim()) { toast('改期原因必填'); return; }
  if (!confirm('改期需同一账号二次确认：' + curYear + '-' + sbPad(curMonth) + ' → ' + y + '-' + sbPad(m) + '。确认？')) return;
  var r = await sbApi('POST', '/schedules/' + sid + '/reschedule', { year: y, month: m, reason: String(reason).trim(), secondConfirm: true }, sbNewKey('reschedule'));
  if (!r.ok) { toast(sbErrMsg(r)); return; }
  toast('已改期至 ' + r.data.scheduled.due_date);
  await sbAfterWrite(SB.detailId);
}
async function sbRefund(orderId, remaining) {
  var amtStr = prompt('退款金额（可退 ' + sbY(remaining) + '）', String(remaining));
  if (amtStr === null) return;
  var amount = Number(amtStr);
  if (!(amount > 0)) { toast('退款金额无效'); return; }
  var reason = prompt('退款原因（必填）', '');
  if (reason === null) return;
  if (!String(reason).trim()) { toast('退款原因必填'); return; }
  var release = confirm('同时释放未到期分期 / 未来年度承诺？\n确定=释放（推荐）；取消=保留后续分期');
  var r = await sbApi('POST', '/orders/' + orderId + '/refund', {
    amount: amount, reason: String(reason).trim(), releaseFuture: release,
  }, sbNewKey('refund'));
  if (!r.ok) { toast(sbErrMsg(r)); return; }
  toast('已退款 ' + sbY(r.data.refund_amount) + (r.data.released_future ? '，并释放未到期分期' : ''));
  await sbAfterWrite(SB.detailId);
}

// ---------------- 计算过程展示（明细可见，原始 JSON 可展开） ----------------
var SB_RECON_LABEL = {
  pay_events_vs_schedules: '付款事件 vs 分期已付',
  refund_events_vs_schedules: '退款事件 vs 分期已退',
  release_events_vs_schedules: '释放事件 vs 分期已释放',
  annual_committed_identity: '年度占用恒等式',
  annual_remaining_identity: '年度剩余恒等式',
};
var SB_CALC_LABEL = {
  rule_version: '规则版本', type: '申请类型', amount: '申请金额', approved_amount: '批准金额',
  annual_cap: '年度上限', annual_committed: '年度已占用', annual_remaining: '年度剩余',
  schedule_total: '分期计划总额', monthly_regular_cap: '月度常规上限', monthly_regular_approved: '本月常规已批',
  monthly_regular_available: '本月常规可用', monthly_installment_due: '本月分期应还',
  monthly_cash: '本月特殊现金流', expected_monthly_installment: '月度分期参考值', floor: '取整后金额',
  saturday_rate: '周六追加比例', saturday_cap: '周六追加上限', saturday_amount: '周六追加可批',
  large_threshold: '大额阈值', installments: '期数', first_year: '首期年', first_month: '首期月',
  future_commitments: '未来年度承诺', monthly: '按月分期', note: '说明', window: '时间窗口',
};
function sbCalcLabel(k) { return SB_CALC_LABEL[k] || String(k); }
function sbCalcMoneyKey(k) {
  if (/rate|count|installments|year|month|seq|days/i.test(k)) return false;
  return /(amount|cap|remaining|paid|refund|releas|total|floor|due|cash|commit|available|approved|price)/i.test(k);
}
function sbCalcValue(k, v) {
  if (typeof v === 'number' && sbCalcMoneyKey(k)) return sbY(v);
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return esc(JSON.stringify(v));
  return esc(String(v));
}
function sbCalcRows(obj, depth) {
  var h = '';
  Object.keys(obj || {}).forEach(function (k) {
    var v = obj[k];
    if (v === null || v === undefined) return;
    if (typeof v === 'object' && !Array.isArray(v) && depth < 2) {
      var inner = sbCalcRows(v, depth + 1);
      if (inner) h += '<div class="sb-calc-sub">' + esc(sbCalcLabel(k)) + '</div>' + inner;
    } else if (Array.isArray(v) && v.length && typeof v[0] === 'object' && depth < 2) {
      h += '<div class="sb-calc-sub">' + esc(sbCalcLabel(k)) + '</div>';
      v.forEach(function (item, i) {
        var txt = Object.keys(item || {}).map(function (ik) {
          return sbCalcLabel(ik) + ' ' + sbCalcValue(ik, item[ik]);
        }).join(' · ');
        h += '<div class="sb-calc-row"><span>#' + (i + 1) + '</span><b>' + txt + '</b></div>';
      });
    } else {
      h += '<div class="sb-calc-row"><span>' + esc(sbCalcLabel(k)) + '</span><b>' + sbCalcValue(k, v) + '</b></div>';
    }
  });
  return h;
}
function sbCalcBlock(c) {
  if (!c || !Object.keys(c).length) return '<div class="sb-note">无计算明细</div>';
  return '<div class="sb-calc">' + sbCalcRows(c, 0)
    + '<details class="sb-raw"><summary>原始计算 JSON（可核对）</summary><pre class="sb-code">'
    + esc(JSON.stringify(c, null, 2)) + '</pre></details></div>';
}

// ---------------- 台账（v3.2.4） ----------------
function sbScopeText(scope) { return scope === 'global' ? '全局（审计）' : '本人'; }
function sbPctText(v, cap) { return (cap > 0 ? (Number(v) / cap * 100) : 0).toFixed(1) + '%'; }
async function sbLoadLedger() {
  if (SB.ledgerLoading) return;
  SB.ledgerLoading = true; SB.ledgerError = null;
  var r = await sbApi('GET', '/ledger?year=' + SB.year + '&month=' + SB.month);
  SB.ledgerLoading = false;
  if (!r.ok) SB.ledgerError = sbErrMsg(r);
  else SB.ledger = r.data;
  if (SB.tab === 'ledger') sbRender();
}
function sbRenderLedger() {
  var h = '';
  if (SB.ledgerLoading && !SB.ledger) return '<div class="sb-card"><div class="sb-empty">台账加载中…</div></div>';
  if (SB.ledgerError) h += '<div class="sb-warn">' + esc(SB.ledgerError) + '</div>';
  var d = SB.ledger;
  if (!d) return h || '<div class="sb-card"><div class="sb-empty">台账暂无数据</div></div>';
  var a = d.annual, rec = d.reconciliation;
  h += '<div class="sb-readonly">🔒 只读台账 · ' + esc(sbScopeText(d.scope)) + '口径 · 截至 ' + esc(d.as_of || '') + '</div>';
  h += '<div class="sb-actions" style="margin-bottom:10px">'
    + '<button type="button" class="sb-btn pri" onclick="sbExport(\'ledger\')">⬇ 导出台账 CSV</button>'
    + '<button type="button" class="sb-btn" onclick="sbLoadLedger()">↻ 重新计算</button></div>';
  h += '<div class="sb-grid">'
    + sbMetric('年度已占用', sbY(a.annual_committed), '计划 ' + sbY(a.schedule_total) + ' − 释放 ' + sbY(a.annual_released) + ' − 退款 ' + sbY(a.annual_refunded))
    + sbMetric('年度剩余', sbY(a.annual_remaining), '上限 ' + sbY(a.annual_cap) + ' · 使用率 ' + sbPctText(a.annual_committed, a.annual_cap))
    + sbMetric('年度已付', sbY(a.annual_paid), '已退 ' + sbY(a.annual_refunded))
    + sbMetric('本月净现金流', sbY((d.monthly[d.month - 1] || {}).net_cash || 0), (d.monthly[d.month - 1] || {}).paid_count + ' 笔付款 / ' + (d.monthly[d.month - 1] || {}).refund_count + ' 笔退款')
    + '</div>';
  if (rec) {
    h += rec.reconciled
      ? '<div class="sb-ok" style="margin-top:10px">✓ 对账通过：计划 / 付款事件 / 退款事件 / 释放事件差异为 ' + sbY(rec.difference) + '</div>'
      : '<div class="sb-err" style="margin-top:10px">⚠ 对账差异 ' + sbY(rec.difference) + '，请查看下方检查项并停止付款操作。</div>';
  }
  var fingerprint = d.fingerprint || '';
  h += '<div class="sb-section-title">审计指纹</div><div class="sb-card"><div class="sb-fingerprint">' + esc(fingerprint) + '</div>'
    + '<div class="sb-note">该指纹由台账数字确定性计算；导出 CSV 含同一指纹，可用于核对页面与导出是否一致。</div></div>';

  h += '<div class="sb-section-title">月度台账</div><div class="sb-card" style="overflow-x:auto"><table class="sb-table">'
    + '<thead><tr><th>月份</th><th>申请</th><th>批准</th><th>付款</th><th>退款</th><th>释放</th><th>净现金流</th></tr></thead><tbody>'
    + d.monthly.map(function (r) {
      var strong = Number(r.month) === Number(d.month) ? ' style="background:rgba(99,102,241,.06)"' : '';
      return '<tr' + strong + '><td>' + d.year + '-' + sbPad(r.month) + '</td>'
        + '<td class="n">' + (r.applied_count ? sbY(r.applied_amount) + '<br><span class="sb-mini">' + r.applied_count + ' 笔</span>' : '—') + '</td>'
        + '<td class="n">' + (r.approved_count ? sbY(r.approved_amount) + '<br><span class="sb-mini">' + r.approved_count + ' 笔</span>' : '—') + '</td>'
        + '<td class="n">' + (r.paid_count ? sbY(r.paid_amount) + '<br><span class="sb-mini">' + r.paid_count + ' 笔</span>' : '—') + '</td>'
        + '<td class="n">' + (r.refund_count ? sbY(r.refunded_amount) + '<br><span class="sb-mini">' + r.refund_count + ' 笔</span>' : '—') + '</td>'
        + '<td class="n">' + (r.release_count ? sbY(r.released_amount) + '<br><span class="sb-mini">' + r.release_count + ' 笔</span>' : '—') + '</td>'
        + '<td class="n">' + sbY(r.net_cash) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  h += '<div class="sb-section-title">年度分段占用</div><div class="sb-card" style="overflow-x:auto"><table class="sb-table">'
    + '<thead><tr><th>年度</th><th>计划</th><th>已付</th><th>已退</th><th>已释放</th><th>已占用</th><th>待付</th></tr></thead><tbody>'
    + d.schedule_years.map(function (r) {
      return '<tr><td>' + r.year + '<br><span class="sb-mini">' + r.count + ' 期</span></td><td class="n">' + sbY(r.schedule_total)
        + '</td><td class="n">' + sbY(r.paid_amount) + '</td><td class="n">' + sbY(r.refunded_amount)
        + '</td><td class="n">' + sbY(r.released_amount) + '</td><td class="n"><b>' + sbY(r.committed)
        + '</b></td><td class="n">' + sbY(r.planned_amount) + '</td></tr>';
    }).join('') + '</tbody></table>'
    + '<div class="sb-mini" style="margin-top:6px">已占用 = 计划 − 已释放 − 已退款；跨年分期按所属年度归集。</div></div>';

  h += '<div class="sb-section-title">审批追溯</div>';
  if (!d.approvals.length) {
    h += '<div class="sb-card"><div class="sb-empty">本年度暂无可追溯审批。</div></div>';
  } else {
    h += '<div class="sb-card" style="overflow-x:auto"><table class="sb-table"><thead><tr><th>编号 / 用途</th><th>状态</th><th>批准</th><th>已付</th><th>已退</th><th>已释放</th><th>事件</th></tr></thead><tbody>'
      + d.approvals.map(function (x) {
        return '<tr><td><b>' + esc(x.approval_no) + '</b><br><span class="sb-mini">' + esc(x.purpose || '') + '</span></td>'
          + '<td>' + sbStatusChip(x.status) + '<br><span class="sb-mini">' + esc(x.type_label) + '</span></td>'
          + '<td class="n">' + (x.approved_amount == null ? '—' : sbY(x.approved_amount)) + '</td>'
          + '<td class="n">' + sbY(x.paid_amount) + '</td><td class="n">' + sbY(x.refunded_amount) + '</td>'
          + '<td class="n">' + sbY(x.released_amount) + '</td>'
          + '<td class="n">' + x.event_count + '<br><button type="button" class="sb-sched-btn" onclick="sbOpenApproval(' + x.id + ')">详情</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  h += '<div class="sb-section-title">计算过程（非黑盒）</div><div class="sb-card">'
    + d.formulas.map(function (f) {
      return '<div class="sb-formula"><div class="t">' + esc(f.label) + '</div>'
        + '<div class="f">' + esc(f.formula) + '</div>'
        + '<div class="v">= <b>' + sbY(f.result) + '</b></div>'
        + (f.values && Object.keys(f.values).length
          ? '<div class="sb-mini">' + Object.keys(f.values).map(function (k) { return esc(k) + ' ' + sbY(f.values[k]); }).join(' · ') + '</div>'
          : '') + '</div>';
    }).join('') + '</div>';

  if (rec && rec.checks && rec.checks.length) {
    h += '<div class="sb-section-title">对账检查项</div><div class="sb-card"><table class="sb-table"><thead><tr><th>检查</th><th>应有</th><th>实际</th><th>差异</th></tr></thead><tbody>'
      + rec.checks.map(function (c) {
        return '<tr><td>' + esc(SB_RECON_LABEL[c.name] || c.name) + '</td><td class="n">' + sbY(c.expected) + '</td><td class="n">' + sbY(c.actual)
          + '</td><td class="n" style="color:' + (Number(c.difference) > 0.005 ? '#dc2626' : '#059669') + '">' + sbY(c.difference) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  return h;
}

// ---------------- 审计（v3.2.4） ----------------
async function sbLoadAudit() {
  if (SB.auditLoading) return;
  SB.auditLoading = true; SB.auditError = null;
  SB.monitorLoading = true; SB.monitorError = null;
  var rs = await Promise.all([
    sbApi('GET', '/timeline?year=' + SB.year + '&limit=200'),
    sbApi('GET', '/snapshots?year=' + SB.year),
    sbApi('GET', '/monitor?year=' + SB.year + '&month=' + SB.month),
  ]);
  SB.auditLoading = false; SB.monitorLoading = false;
  if (rs[0].ok) SB.audit = rs[0].data; else SB.auditError = sbErrMsg(rs[0]);
  SB.snapshots = rs[1].ok ? rs[1].data : null;
  SB.monitorForbidden = !rs[2].ok && rs[2].status === 403;
  if (rs[2].ok) SB.monitor = rs[2].data;
  else if (!SB.monitorForbidden) SB.monitorError = sbErrMsg(rs[2]);
  if (SB.tab === 'audit') sbRender();
}
function sbMonitorBadge(v) {
  var cls = v === 'PASS' ? 'green' : (v === 'WARN' ? 'amber' : 'red');
  return '<span class="sb-chip ' + cls + '">' + esc(v || '—') + '</span>';
}
function sbRenderMonitor() {
  var h = '<div class="sb-section-title">试运行监控（管理员只读）</div>';
  if (SB.monitorForbidden) {
    return h + '<div class="sb-card"><div class="sb-note">仅管理员可查看全局限额监控；当前为普通账号，可在上方查看本人台账与审计。</div></div>';
  }
  if (SB.monitorLoading && !SB.monitor) {
    return h + '<div class="sb-card"><div class="sb-empty">监控数据加载中…</div></div>';
  }
  if (SB.monitorError) {
    return h + '<div class="sb-card"><div class="sb-warn">监控加载失败：' + esc(SB.monitorError) + '</div></div>';
  }
  var m = SB.monitor;
  if (!m) return h + '<div class="sb-card"><div class="sb-empty">监控数据暂不可用。</div></div>';
  var s = m.summary, c = m.counts;
  h += '<div class="sb-card sb-monitor">';
  h += '<div class="sb-monitor-head"><div><b>' + m.year + '-' + sbPad(m.month) + ' 试运行健康度</b> ' + sbMonitorBadge(m.verdict)
    + '</div><span class="sb-mini">截至 ' + esc(m.as_of || '') + ' · 全局口径 · 只读</span></div>';
  h += '<div class="sb-monitor-grid">'
    + '<div><span class="sb-mini">年度占用</span><b>' + sbY(s.annual_committed) + '</b><span class="sb-mini"> / ' + sbY(s.annual_cap) + '</span></div>'
    + '<div><span class="sb-mini">年度剩余</span><b>' + sbY(s.annual_remaining) + '</b></div>'
    + '<div><span class="sb-mini">本月常规 800</span><b>' + sbY(s.monthly_regular_approved) + '</b><span class="sb-mini"> / ' + sbY(s.monthly_regular_cap) + '</span></div>'
    + '<div><span class="sb-mini">本月周六追加</span><b>' + sbY(s.monthly_additional_approved) + '</b></div>'
    + '<div><span class="sb-mini">本月净现金</span><b>' + sbY(s.monthly_cash) + '</b></div>'
    + '<div><span class="sb-mini">对账差异</span><b class="' + (m.reconciliation.reconciled ? '' : 'sb-bad') + '">' + sbY(m.reconciliation.difference) + '</b></div>'
    + '<div><span class="sb-mini">逾期分期</span><b class="' + (c.overdue_count ? 'sb-bad' : '') + '">' + c.overdue_count + ' 笔</b></div>'
    + '<div><span class="sb-mini">缺失快照</span><b class="' + (c.missing_snapshots ? 'sb-bad' : '') + '">' + c.missing_snapshots + ' 个</b></div>'
    + '</div>';
  var fails = m.checks.filter(function (x) { return x.status === 'fail'; });
  var warns = m.checks.filter(function (x) { return x.status === 'warn'; });
  h += '<div class="sb-monitor-checks">';
  m.checks.forEach(function (x) {
    var cls = x.status === 'pass' ? 'ok' : (x.status === 'warn' ? 'warn' : 'fail');
    var mark = x.status === 'pass' ? '✓' : (x.status === 'warn' ? '!' : '✕');
    h += '<span class="sb-monitor-pill ' + cls + '" title="' + esc(JSON.stringify(x.detail || '')) + '">' + mark + ' ' + esc(x.label) + '</span>';
  });
  h += '</div>';
  if (fails.length || warns.length) {
    h += '<div class="sb-note" style="margin-top:8px">未通过：'
      + (fails.map(function (x) { return '✕ ' + esc(x.label); }).join('、') || '无')
      + (warns.length ? '；需关注：' + warns.map(function (x) { return '! ' + esc(x.label); }).join('、') : '')
      + '</div>';
  }
  h += '</div>';
  return h;
}
function sbRenderAudit() {
  var h = '';
  if (SB.auditLoading && !SB.audit) return '<div class="sb-card"><div class="sb-empty">审计数据加载中…</div></div>';
  if (SB.auditError) h += '<div class="sb-warn">' + esc(SB.auditError) + '</div>';
  var d = SB.audit, snaps = SB.snapshots;
  h += '<div class="sb-readonly">🔒 审计只读 · ' + esc(d ? sbScopeText(d.scope) : '本人') + '口径 · 不可在此页面修改任何金额</div>';
  h += '<div class="sb-actions" style="margin-bottom:10px">'
    + '<button type="button" class="sb-btn pri" onclick="sbExport(\'audit\')">⬇ 导出审计 CSV</button>'
    + '<button type="button" class="sb-btn" onclick="sbLoadAudit()">↻ 刷新</button></div>';

  h += sbRenderMonitor();

  h += '<div class="sb-section-title">月度快照</div><div class="sb-card">';
  if (!snaps) {
    h += '<div class="sb-note">快照数据暂不可用。</div>';
  } else {
    h += '<div class="sb-note">应有快照 ' + snaps.expected_months.length + ' 个；缺失 ' + snaps.missing_months.length + ' 个。</div>';
    if (snaps.missing_months.length) {
      h += '<div class="sb-warn" style="margin-top:8px">缺失月份：' + snaps.missing_months.map(function (m) { return SB.year + '-' + sbPad(m); }).join('、') + '</div>'
        + '<button type="button" class="sb-btn pri" style="margin-bottom:8px" onclick="sbGenerateMissingSnapshots()">补齐缺失快照</button>';
    }
    h += '<button type="button" class="sb-btn" style="margin-bottom:8px" onclick="sbGenerateSnapshot(' + SB.month + ')">为 ' + SB.year + '-' + sbPad(SB.month) + ' 生成/刷新快照</button>';
    if (snaps.snapshots.length) {
      h += '<table class="sb-table"><thead><tr><th>月份</th><th>年度占用</th><th>剩余</th><th>本月现金流</th><th>生成时间</th></tr></thead><tbody>'
        + snaps.snapshots.map(function (s) {
          return '<tr><td>' + s.year + '-' + sbPad(s.month) + '</td><td class="n">' + sbY(s.annual_committed)
            + '</td><td class="n">' + sbY(s.annual_remaining) + '</td><td class="n">' + sbY(s.monthly_cash)
            + '</td><td><span class="sb-mini">' + esc(s.generated_at || '') + '</span><br><span class="sb-mini">' + esc(String(s.fingerprint || '').slice(0, 12)) + '…</span></td></tr>';
        }).join('') + '</tbody></table>';
    } else {
      h += '<div class="sb-empty">尚无快照。</div>';
    }
  }
  h += '</div>';

  h += '<div class="sb-section-title">事件时间线</div>';
  var evs = d ? d.events : [];
  if (!evs.length) {
    h += '<div class="sb-card"><div class="sb-empty">本年度暂无审计事件。</div></div>';
  } else {
    h += '<div class="sb-note" style="margin-bottom:8px">共 ' + d.total + ' 条，显示最近 ' + evs.length + ' 条（倒序）。</div>';
    h += evs.map(function (e) {
      var cls = e.event_type === 'config_update' || e.event_type === 'refund' ? 'warn' : (e.event_type === 'pay' ? 'ok' : '');
      var amount = e.amount == null ? '' : sbY(e.amount);
      var detail = '<details><summary>查看变更前 / 后</summary><pre class="sb-code">'
        + esc(JSON.stringify({ before: e.before, after: e.after }, null, 2)) + '</pre></details>';
      return '<div class="sb-event ' + cls + '">'
        + '<div class="sb-event-head"><b>' + esc(e.event_label || e.event_type) + '</b><span class="sb-event-amount">' + amount + '</span></div>'
        + '<div class="sb-event-meta">' + esc(e.at || '') + ' · ' + esc(e.actor || '') + ' · ' + esc(e.rule_version || '—') + (e.ip ? ' · IP ' + esc(e.ip) : '') + '</div>'
        + (e.approval_no ? '<div class="sb-event-meta">' + esc(e.approval_no) + (e.purpose ? ' · ' + esc(e.purpose) : '') + (e.approval_id ? ' <button type="button" class="sb-sched-btn" onclick="sbOpenApproval(' + e.approval_id + ')">审批详情</button>' : '') + '</div>' : '')
        + (e.reason ? '<div class="sb-event-meta">原因：' + esc(e.reason) + '</div>' : '')
        + detail + '</div>';
    }).join('');
    if (d.has_more) h += '<div class="sb-note">还有更早事件未显示，请导出 CSV 查看。</div>';
  }

  h += '<div class="sb-section-title">配置变更历史（只读）</div><div class="sb-card">';
  var hist = (d && d.config_history) || (snaps && snaps.config_history) || [];
  if (!hist.length) h += '<div class="sb-empty">暂无配置历史。</div>';
  else h += '<div class="sb-history">' + hist.slice().reverse().map(function (x) {
    return '<div><b>' + esc(x.rule_version) + '</b> · 上限 ' + sbY(x.annual_cap) + ' · ' + esc(x.changed_by || 'seed') + ' · ' + esc(x.created_at || '')
      + (x.change_reason ? '<br>' + esc(x.change_reason) : '') + '</div>';
  }).join('') + '</div>';
  h += '</div>';
  return h;
}
async function sbGenerateSnapshot(month, quiet) {
  if (SB.busy) return false;
  SB.busy = true;
  var r = await sbApi('POST', '/snapshots', { year: SB.year, month: Number(month) }, sbNewKey('snapshot'));
  SB.busy = false;
  if (!r.ok) { if (!quiet) toast(sbErrMsg(r)); return false; }
  if (!quiet) toast(SB.year + '-' + sbPad(month) + ' 快照已生成');
  return true;
}
async function sbGenerateMissingSnapshots() {
  var snaps = SB.snapshots;
  if (!snaps || !snaps.missing_months.length) { toast('没有缺失快照'); return; }
  var okCount = 0;
  for (var i = 0; i < snaps.missing_months.length; i++) {
    if (await sbGenerateSnapshot(snaps.missing_months[i], true)) okCount++;
  }
  toast('已生成 ' + okCount + ' / ' + snaps.missing_months.length + ' 个快照');
  await sbLoadAudit();
}
async function sbExport(kind) {
  var path = '/export?type=' + (kind === 'audit' ? 'audit' : 'ledger') + '&year=' + SB.year
    + (kind === 'ledger' ? '&month=' + SB.month : '');
  var headers = { 'Authorization': 'Bearer ' + getPin() };
  var url = API_BASE + '/api/special-budget' + path;
  var r;
  try {
    r = await fetch(url, { headers: headers, cache: 'no-store' });
    if (r.status === 401) {
      var nt = await refreshAccessToken();
      if (nt) { headers['Authorization'] = 'Bearer ' + nt; r = await fetch(url, { headers: headers, cache: 'no-store' }); }
    }
  } catch (e) { toast('网络错误，导出失败'); return; }
  if (!r.ok) {
    var j = null; try { j = await r.json(); } catch (e) {}
    toast((j && (j.message || j.error)) || ('导出失败 HTTP ' + r.status));
    return;
  }
  var blob = await r.blob();
  var name = 'special-budget-' + kind + '-' + SB.year + '.csv';
  var cd = r.headers.get('Content-Disposition') || '';
  var m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (m) { try { name = decodeURIComponent(m[1]); } catch (e) {} }
  var a = document.createElement('a');
  var obj = URL.createObjectURL(blob);
  a.href = obj; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(obj); if (a.parentNode) a.parentNode.removeChild(a); }, 500);
  toast('已导出 ' + name);
}

// ---------------- 年度设置 ----------------
function sbRenderSettings() {
  if (!SB.isAdmin) return '<div class="sb-card"><div class="sb-warn">仅管理员可修改年度设置。</div></div>';
  var s = SB.data && SB.data.summary;
  var c = SB.config;
  var h = '';
  if (!c) {
    h += '<div class="sb-warn">' + SB.year + ' 年尚未配置特殊预算。可在下方创建（默认月度 800 / 周六 10% / 大额阈值 800）。</div>';
  } else {
    h += '<div class="sb-card"><div class="sb-sub" style="margin-top:0">' + SB.year + ' 年当前配置</div>'
      + '<div class="sb-kv">'
      + '<div class="k">年度上限</div><div class="v">' + sbY(c.annual_cap) + '</div>'
      + '<div class="k">月度常规</div><div class="v">' + sbY(c.monthly_regular_cap) + '</div>'
      + '<div class="k">周六上限</div><div class="v">' + sbY(c.saturday_cap) + '（年度 × ' + (sbNum(c.saturday_rate) * 100) + '%）</div>'
      + '<div class="k">大额阈值</div><div class="v">&gt; ' + sbY(c.large_threshold) + '</div>'
      + '<div class="k">跨年分期</div><div class="v">' + (c.cross_year_allowed ? '允许' : '不允许') + '</div>'
      + '<div class="k">规则版本</div><div class="v">' + esc(c.rule_version) + ' · 生效 ' + esc(c.effective_from || '') + (c.effective_to ? ' 至 ' + esc(c.effective_to) : '') + '</div>'
      + '</div></div>';
  }
  var occupied = s ? sbNum(s.annual_committed) : 0;
  var cur = sbBjParts().year;
  var readonly = SB.year < cur;
  h += '<div class="sb-card"><div class="sb-sub" style="margin-top:0">修改年度上限</div>';
  if (readonly) h += '<div class="sb-warn">历史年份只读，不能修改。</div>';
  h += '<div class="sb-field"><label>新的年度上限（元）</label><input id="sbCfgCap" type="number" min="0" step="0.01" inputmode="decimal" value="' + escAttr(c ? c.annual_cap : '') + '" oninput="sbCfgPreview()" ' + (readonly ? 'disabled' : '') + '></div>';
  h += '<div id="sbCfgPreviewBox">' + sbCfgPreviewHTML(occupied, c ? c.annual_cap : 0) + '</div>';
  h += '<div class="sb-note" style="margin-top:6px">修改需填写理由并同一账号二次确认；每次修改生成新规则版本，不删除历史。</div>';
  h += '<button type="button" class="sb-btn pri" style="width:100%;margin-top:10px" ' + (readonly ? 'disabled' : '') + ' onclick="sbUpdateConfig()">保存年度上限</button>';
  h += '</div>';
  if (SB.configHistory && SB.configHistory.length) {
    h += '<div class="sb-sub">配置历史</div><div class="sb-card"><div class="sb-history">'
      + SB.configHistory.slice().reverse().map(function (x) {
        return '<div><b>' + esc(x.rule_version) + '</b> · 上限 ' + sbY(x.annual_cap) + ' · ' + esc(x.changed_by || 'seed') + ' · ' + esc(x.created_at || '') + (x.change_reason ? '<br>' + esc(x.change_reason) : '') + '</div>';
      }).join('') + '</div></div>';
  }
  return h;
}
function sbCfgPreviewHTML(occupied, capValue) {
  var capEl = document.getElementById('sbCfgCap');
  var raw = capEl ? Number(capEl.value) : Number(capValue || 0);
  var cap = sbRound2(Number(raw) || 0);
  var floor = sbRound2(Number(occupied) || 0);
  var after = sbRound2(cap - floor);
  var sat = sbRound2(cap * 0.10);
  var bad = cap < floor - 0.005;
  return '<div class="sb-preview">'
    + '实时预览：周六单日上限 <b>' + sbY(sat) + '</b>（按 10%）<br>'
    + '当前已占用 / 最低可设 <b>' + sbY(floor) + '</b><br>'
    + '调整后年度剩余 <b style="' + (bad ? 'color:#b91c1c' : '') + '">' + sbY(after) + '</b>'
    + (bad ? '<br><span style="color:#b91c1c">低于已占用，无法保存。</span>' : '')
    + '</div>';
}
function sbCfgPreview() {
  var box = document.getElementById('sbCfgPreviewBox');
  if (!box) return;
  var occupied = SB.data && SB.data.summary ? sbNum(SB.data.summary.annual_committed) : 0;
  box.innerHTML = sbCfgPreviewHTML(occupied, 0);
}
async function sbUpdateConfig() {
  if (SB.busy) return;
  var el = document.getElementById('sbCfgCap');
  if (!el) return;
  var cap = Number(el.value);
  if (!(cap >= 0)) { toast('年度上限无效'); return; }
  var occupied = SB.data && SB.data.summary ? sbNum(SB.data.summary.annual_committed) : 0;
  if (cap < occupied - 0.005) { toast('不能低于已占用 ' + sbY(occupied)); return; }
  var reason = prompt('修改理由（必填）', '');
  if (reason === null) return;
  if (!String(reason).trim()) { toast('修改理由必填'); return; }
  if (!confirm('修改 ' + SB.year + ' 年年度上限为 ' + sbY(cap) + '，需同一账号二次确认。确认？')) return;
  SB.busy = true;
  var r = await sbApi('PUT', '/config', { year: SB.year, annualCap: cap, reason: String(reason).trim(), secondConfirm: true }, sbNewKey('config'));
  SB.busy = false;
  if (!r.ok) { toast(sbErrMsg(r)); return; }
  toast('年度上限已更新为 ' + sbY(r.data.config.annual_cap));
  await sbLoad(null);
}

// 对其它模块暴露的只读入口
window.isSpecialOrder = window.isSpecialOrder || function (o) {
  return !!o && (o['特殊预算'] === '1' || o['特殊预算'] === 1 || o.budget_type === 'special');
};
