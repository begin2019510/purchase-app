// needs.js - 采购两级模型前端（需求 / 供应商 / 子采购单）PURCHASE-REDESIGN §4
// 加载顺序：expense.js 之后、items.js 之前。
// openDetailModal / closeDetailModal 是 project.js、todomodule.js 的对外入口，函数名不可改。
let needsList = [];
// 记账口径（全站唯一）：仅这三种状态的子单计入预算/统计/项目花费
const ACTIVE_BUY_STATUS = ['已下单', '已到', '已归档'];
const NEED_DEFAULT_DIMS = [
  { key: 'price', label: '价格', weight: 3 },
  { key: 'feature', label: '功能', weight: 2 },
  { key: 'design', label: '颜值', weight: 1 },
  { key: 'quality', label: '质量口碑', weight: 2 },
  { key: 'service', label: '售后', weight: 1 },
];
// 子单状态 → 可执行动作（与服务端 ORDER_TRANSITIONS 一致）
const NEED_ORDER_FLOW = {
  '待下单': [{ to: '已下单', label: '🛒 提交下单', cls: 'g' }, { to: '已取消', label: '✗ 取消单', cls: 'r' }],
  '已下单': [{ to: '已到', label: '📦 确认收货', cls: 'g' }, { to: '已退', label: '↩️ 退货', cls: 'r' }, { to: '已取消', label: '✗ 取消', cls: 'm' }],
  '已到': [{ to: '已归档', label: '🗄️ 归档', cls: 'p' }, { to: '已退', label: '↩️ 退货', cls: 'r' }, { to: '已取消', label: '✗ 取消', cls: 'm' }],
  '已退': [{ to: '已归档', label: '🗄️ 归档', cls: 'p' }],
  '已归档': [], '已取消': [],
};

function isActiveBuy(s) { return ACTIVE_BUY_STATUS.indexOf(String(s || '')) >= 0; }
function findNeed(id) { id = String(id || ''); return (needsList || []).find(n => String(n.id) === id) || null; }
function fmtY(n) { return '¥' + (Number(n) || 0).toFixed(2); }
function todayBJ() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function thisMonthBJ() { try { return getThisMonth(); } catch (e) { return todayBJ().slice(0, 7); } }
// kv: 引用 → 可展示 URL
function needImgSrc(ref) {
  if (!ref || String(ref).startsWith('{')) return '';
  if (String(ref).startsWith('kv:')) return API_BASE + '/api/images?key=' + encodeURIComponent(String(ref).slice(3)) + '&token=' + encodeURIComponent(getPin());
  return String(ref);
}
function needBudgetText(n) {
  const a = n['预算下限'], b = n['预算上限'];
  // 3.0.43：迁移前的老记录本来就没有预算字段，不显示「预算待定」以免像出问题
  if (a == null && b == null) return n && n['历史'] === '1' ? '历史记录' : '预算待定';
  if (a != null && b != null) return a === b ? '¥' + Number(a) : '¥' + Number(a) + '-' + Number(b);
  return '¥' + Number(a != null ? a : b);
}
// 需求入账合计（ACTIVE_BUY 子单：实付 × 数量）
function needSpend(n) {
  return (n.orders || []).reduce(function (s, o) {
    if (!isActiveBuy(o['状态'])) return s;
    return s + (Number(o['实付']) || 0) * (Number(o['数量']) || 1);
  }, 0);
}
// 加权总分（与服务端 weightedTotal 同口径）：未打分维度分子按 0、权重仍进分母
function supplierWeightedTotal(dims, scores) {
  const d = Array.isArray(dims) && dims.length ? dims : NEED_DEFAULT_DIMS;
  const s = scores && typeof scores === 'object' ? scores : {};
  let num = 0, den = 0;
  for (const dim of d) {
    const w = Number(dim.weight) || 0;
    if (w <= 0) continue;
    den += w;
    const sc = Number(s[dim.key]);
    if (Number.isFinite(sc) && sc >= 1 && sc <= 5) num += sc * w;
  }
  if (den <= 0) return 0;
  return Math.round((num / den) * 100) / 100;
}
function needDims(n) {
  const d = n && Array.isArray(n['维度']) && n['维度'].length ? n['维度'] : NEED_DEFAULT_DIMS;
  return d;
}

// ===== /api/needs 专用请求（路径参数路由；非 JSON 响应标记 _http 供时序兜底判断）=====
async function needsApi(method, path, body) {
  const url = API_BASE + '/api' + path;
  const opts = { method: method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getPin() } };
  if (body !== undefined && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    let r = await fetch(url, opts);
    if (r.status === 401) {
      const newToken = await refreshAccessToken();
      if (newToken) { opts.headers['Authorization'] = 'Bearer ' + newToken; r = await fetch(url, opts); }
      if (r.status === 401) {
        if (typeof clearTokens === 'function') clearTokens();
        if (typeof setAuthLocked === 'function') setAuthLocked(true);
        return { error: '会话已过期，请重新登录', _http: 401 };
      }
    }
    let data = null;
    try { data = await r.json(); } catch (e) { data = null; }
    if (data === null || typeof data !== 'object') return { error: '服务响应异常（HTTP ' + r.status + '）', _http: r.status };
    if (!Array.isArray(data)) data._http = r.status;
    return data;
  } catch (e) {
    return { error: '网络错误，请重试', _net: 1 };
  }
}
// 该端点是否「不存在」（旧 server 未部署 / 飞书后端 501 / 后端 502）→ 调用方走旧接口兜底
function needEndpointMissing(r) {
  return !r || (r.error && (r._http === 404 || r._http === 405 || r._http === 501 || r._http === 502));
}

async function loadNeeds() {
  const r = await needsApi('GET', '/needs');
  return Array.isArray(r) ? r : null;
}

// ===== 旧 /api/items 行 → 伪需求（新前端 + 旧 server 的部署时序兜底）=====
// 状态映射与服务端 legacyToNeedStatus 一致；有一条正式子单使 orderRows 口径正确
function needsFromItems(rows) {
  const out = [];
  (rows || []).forEach(function (it, i) {
    const st = it['状态'] || '待评估';
    const needStatus = st === '待评估' ? '对比中' : st === '已取消' ? '已取消' : st === '已归档' ? '已完成' : '已定点';
    let bmin = null, bmax = null;
    const br = String(it['预算区间'] || '').trim();
    const m = /^(\d+(?:\.\d+)?)\s*[-~～—]\s*(\d+(?:\.\d+)?)$/.exec(br);
    if (m) { bmin = Number(m[1]); bmax = Number(m[2]); }
    else if (br) { const n = Number(br); if (Number.isFinite(n)) { bmin = n; bmax = n; } }
    const id = String(it.id || ('rec_fb' + i));
    const num = String(id).replace(/^rec_/, '') || String(i);
    const price = Number(it['单价']) || 0;
    const platform = it['平台'] || '';
    const suppliers = [], orders = [];
    if (platform || price > 0) {
      suppliers.push({
        id: 'rec_s' + num, needId: id,
        '谁': platform || '商家', '平台': platform, '报价': price, '图片': '',
        '优点': '', '缺点': '', '备注': '', '打分': {}, '排序': 0,
      });
    }
    if (st !== '待评估') {
      const os = (st === '待审批' || st === '已审批') ? '待下单' : st;
      orders.push({
        id: 'rec_o' + num, needId: id, supplierId: suppliers.length ? ('rec_s' + num) : '', role: 'formal',
        '数量': Number(it['数量']) || 1, '实付': price, '状态': os,
        '分期期数': Number(it['分期期数']) || 0, '分期金额': Number(it['分期金额']) || 0,
        '分期开始月': it['分期开始月'] || '', '分期已还': Number(it['分期已还']) || 0,
        '日期': it['日期'] != null && it['日期'] !== '' ? Number(it['日期']) : null,
        '图片': it['图片'] || '', '备注': it['备注'] || '', '极速': it['极速'] || '',
        '创建时间': it['创建时间'] || '', '审批时间': it['审批时间'] || '', '下单时间': it['下单时间'] || '',
        '到货时间': it['到货时间'] || '', '归档时间': it['归档时间'] || '',
      });
    }
    const winner = (needStatus === '对比中') ? '' : (suppliers.length ? suppliers[0].id : '');
    out.push({
      id: id,
      '名称': it['商品名称'] || '', '分类': it['分类'] || '其他',
      '预算下限': bmin, '预算上限': bmax,
      '状态': needStatus,
      '维度': NEED_DEFAULT_DIMS.map(d => ({ key: d.key, label: d.label, weight: d.weight })),
      '定点供应商ID': winner,
      '项目ID': it['项目ID'] || '', '阶段': it['阶段'] != null && it['阶段'] !== '' ? Number(it['阶段']) : null,
      '虚拟': it['虚拟'] === '1' ? '1' : '', '极速': it['极速'] === '1' ? '1' : '',
      '取消原因': it['取消原因'] || '', '定点时间': '',
      '创建时间': it['创建时间'] || '',
      suppliers: suppliers, orders: orders,
    });
  });
  return out;
}

// ===== needsList → 旧 item 形态行（预算/统计复用；全部子单，由调用方按 ACTIVE_BUY 过滤）=====
function orderRows() {
  const out = [];
  (needsList || []).forEach(function (n) {
    const supMap = {};
    (n.suppliers || []).forEach(function (s) { supMap[s.id] = s; });
    (n.orders || []).forEach(function (o) {
      const s = supMap[o.supplierId];
      out.push({
        id: o.id, _needId: n.id, _order: o, _role: o.role,
        '商品名称': n['名称'], '分类': n['分类'], '平台': s ? (s['平台'] || s['谁']) : '',
        '单价': Number(o['实付']) || 0, '数量': Number(o['数量']) || 1, '状态': o['状态'],
        '日期': o['日期'], '备注': o['备注'], '图片': o['图片'],
        '分期期数': o['分期期数'], '分期金额': o['分期金额'],
        '分期开始月': o['分期开始月'], '分期已还': o['分期已还'],
        '项目ID': n['项目ID'], '阶段': n['阶段'], '虚拟': n['虚拟'],
        '极速': o['极速'] || n['极速'], '创建时间': o['创建时间'] || n['创建时间'],
      });
    });
  });
  return out;
}

// 刷新 needs+items（+待办/项目账），可选重开需求详情
async function needRefresh(detailId) {
  try {
    const r = await loadNeeds();
    if (Array.isArray(r)) { needsList = r; setCachedData('needs', r); }
  } catch (e) { /* 保持现值 */ }
  try {
    const its = await api('GET');
    if (Array.isArray(its)) { items = its; setCachedData('items', its); }
  } catch (e) { /* items 兼容行可缺失 */ }
  try { if (typeof loadTodos === 'function') loadTodos().then(function () { try { renderTodo(); } catch (e) {} }).catch(function () {}); } catch (e) {}
  try { if (typeof refreshProjectsAfterLinkedMoney === 'function') refreshProjectsAfterLinkedMoney(); } catch (e) {}
  try { render(); } catch (e) {}
  if (detailId) {
    const n = findNeed(detailId);
    if (n) openDetailModal(detailId);
    else { closeDetailModal(); toast('需求已删除'); }
  }
}

// ============================================================
// 需求详情（#detailOverlay）
// ============================================================
function openDetailModal(id) {
  const n = findNeed(id);
  if (!n) { toast('未找到该需求'); return; }
  const needId = String(n.id);
  const st = n['状态'] || '对比中';
  const dims = needDims(n);
  const sups = n.suppliers || [];
  const ords = n.orders || [];
  const winnerId = n['定点供应商ID'] || '';
  const isCompare = st === '对比中';
  const winner = winnerId ? (sups.find(s => s.id === winnerId) || null) : null;
  const formal = ords.find(o => o.role === 'formal') || null;
  const trials = ords.filter(o => o.role === 'trial');

  let html = '<div class="detail-header">';
  html += '<div class="detail-title">' + (n['极速'] === '1' ? '<span class="quick-badge" style="position:static;display:inline-block;margin-right:6px;vertical-align:2px">极速免审</span>' : '')
    + (n['虚拟'] === '1' ? '<span class="virtual-badge" style="position:static;display:inline-block;margin-right:6px;vertical-align:2px">虚拟商品</span>' : '')
    + esc(n['名称'] || '') + '</div>';
  html += '<div class="detail-price">' + esc(needBudgetText(n)) + (formal && isActiveBuy(formal['状态']) ? ' <span style="font-size:13px;color:var(--muted);font-weight:400">已入账 ' + fmtY((Number(formal['实付']) || 0) * (Number(formal['数量']) || 1)) + '</span>' : '') + '</div>';
  html += '<div class="detail-meta"><span class="badge badge-' + escAttr(st) + '">' + esc(st) + '</span>'
    + '<span class="cat-badge">' + esc(n['分类'] || '其他') + '</span>'
    + (n['历史'] === '1' ? '<span class="cat-badge">历史</span>' : '')
    + (n['创建时间'] ? '<span>📅 ' + esc(n['创建时间']) + '</span>' : '')
    + (n['项目ID'] ? '<span>📁 已关联项目</span>' : '') + '</div>';
  if (st === '已取消' && n['取消原因']) {
    html += '<div style="background:var(--bg);border-radius:10px;padding:10px;margin-top:8px;font-size:13px;border-left:3px solid var(--red)"><div style="font-weight:600;margin-bottom:2px">❌ 取消原因</div><div style="color:var(--muted)">' + esc(n['取消原因']) + '</div></div>';
  }
  html += '</div>';

  // ===== ① 对比：矩阵 + 供应商卡（已定点且只有一家时折叠成一行）=====
  const collapseCompare = !isCompare && sups.length <= 1;
  html += '<div class="detail-section-title">🔍 供应商对比 <span style="font-weight:400;color:var(--muted);font-size:12px">' + sups.length + ' 家</span></div>';
  if (sups.length === 0) {
    if (isCompare) html += '<div class="nd-hint">还没有供应商，点下方「＋ 添加供应商」开始对比</div>';
  } else if (collapseCompare) {
    const w = winner || sups[0];
    html += '<div class="nd-winner">🎯 已定点 <b>' + esc(w['谁'] || '') + '</b>' + (w['平台'] ? ' · ' + esc(w['平台']) : '') + ' · 报价 ' + fmtY(w['报价'])
      + ' · 总分 ' + supplierWeightedTotal(dims, w['打分']).toFixed(2) + '</div>';
  } else {
    if (sups.length >= 2) {
      html += '<div class="nd-matrix-wrap"><table class="nd-matrix"><tr><th></th>'
        + sups.map(s => '<th' + (s.id === winnerId ? ' class="win"' : '') + '>' + esc(s['谁'] || '') + '</th>').join('') + '</tr>';
      html += '<tr><td>报价</td>' + sups.map(s => '<td>' + (s['报价'] != null ? fmtY(s['报价']) : '–') + '</td>').join('') + '</tr>';
      dims.forEach(function (d) {
        html += '<tr><td>' + esc(d.label) + ' <em>' + (Number(d.weight) || 1) + '</em></td>'
          + sups.map(s => { const v = Number((s['打分'] || {})[d.key]); return '<td>' + (v >= 1 && v <= 5 ? v : '–') + '</td>'; }).join('') + '</tr>';
      });
      html += '<tr class="nd-total"><td>加权总分</td>'
        + sups.map(s => '<td>' + supplierWeightedTotal(dims, s['打分']).toFixed(2) + '</td>').join('') + '</tr></table></div>';
    }
    sups.forEach(function (s) {
      const sid = String(s.id);
      const scores = s['打分'] || {};
      const activeTrial = trials.find(o => o.supplierId === sid && ['待下单', '已下单', '已到'].indexOf(o['状态']) >= 0);
      html += '<div class="nd-sup' + (sid === winnerId ? ' win' : '') + '">';
      html += '<div class="nd-sup-head"><span class="nd-sup-name">' + esc(s['谁'] || '') + (s.id === winnerId ? ' <span class="badge badge-已定点">定点</span>' : '') + '</span>'
        + '<span class="nd-sup-meta">' + (s['平台'] ? esc(s['平台']) + ' · ' : '') + (s['报价'] != null ? fmtY(s['报价']) : '') + '</span></div>';
      const img = needImgSrc(s['图片']);
      if (img) html += '<img class="nd-sup-img" src="' + escAttr(img) + '" onclick="showFullscreenImg(this.src)" alt="">';
      if (s['优点']) html += '<div class="nd-sup-line"><b style="color:var(--green)">👍</b> ' + esc(s['优点']) + '</div>';
      if (s['缺点']) html += '<div class="nd-sup-line"><b style="color:var(--red)">👎</b> ' + esc(s['缺点']) + '</div>';
      if (s['备注']) html += '<div class="nd-sup-line" style="color:var(--muted)">💬 ' + esc(s['备注']) + '</div>';
      // 打分（定点后仍可微调）
      html += '<div class="nd-scores">';
      dims.forEach(function (d) {
        const cur = Number(scores[d.key]);
        html += '<div class="nd-score-row"><span class="nd-score-label">' + esc(d.label) + '<em>' + (Number(d.weight) || 1) + '</em></span><span class="nd-score-btns">'
          + [1, 2, 3, 4, 5].map(v => '<button type="button" class="nd-score' + (cur === v ? ' on' : '') + '" onclick="needSetScore(\'' + escAttr(needId) + '\',\'' + escAttr(sid) + '\',\'' + escAttr(d.key) + '\',' + v + ')" aria-label="' + escAttr(d.label) + v + '分">' + v + '</button>').join('')
          + '</span></div>';
      });
      html += '<div class="nd-score-total">加权总分 <b>' + supplierWeightedTotal(dims, scores).toFixed(2) + '</b></div></div>';
      // 操作
      if (isCompare) {
        html += '<div class="nd-actions">';
        if (!activeTrial) html += '<button type="button" class="nd-btn g" onclick="needTrialCreate(\'' + escAttr(needId) + '\',\'' + escAttr(sid) + '\')">📦 下单试用</button>';
        else html += '<span class="nd-chip">试用中 · ' + esc(activeTrial['状态']) + '</span>';
        html += '<button type="button" class="nd-btn p" onclick="needDecidePick(\'' + escAttr(needId) + '\',\'' + escAttr(sid) + '\')">🎯 定点这家</button>';
        html += '<button type="button" class="nd-btn r" onclick="needSupplierDelete(\'' + escAttr(needId) + '\',\'' + escAttr(sid) + '\')">🗑️</button>';
        html += '</div>';
      }
      html += '</div>';
    });
    // 添加供应商 / 维度编辑（仅对比中）
    if (isCompare) {
      html += '<div class="nd-actions" style="margin-top:10px">'
        + '<button type="button" class="nd-btn m" onclick="needSupplierFormToggle()">＋ 添加供应商</button>'
        + '<button type="button" class="nd-btn m" onclick="needDimsFormToggle()">⚙️ 对比维度</button></div>';
      html += '<div class="nd-form" id="ndSupForm" style="display:none">'
        + '<div class="form-row"><div class="form-group" style="flex:1"><label>谁 *</label><input id="ndSupName" placeholder="如：官方旗舰店"></div>'
        + '<div class="form-group" style="flex:1"><label>平台</label><input id="ndSupPlatform" placeholder="如：京东"></div></div>'
        + '<div class="form-row"><div class="form-group" style="flex:1"><label>报价（元）</label><input id="ndSupPrice" type="number" step="0.01" min="0"></div>'
        + '<div class="form-group" style="flex:1"><label>图片</label><div style="display:flex;gap:8px">'
        + '<button type="button" class="nd-btn m" style="flex:1" onclick="document.getElementById(\'ndSupCam\').click()">📷 拍照</button>'
        + '<button type="button" class="nd-btn m" style="flex:1" onclick="document.getElementById(\'ndSupGal\').click()">🖼️ 相册</button></div>'
        + '<input type="file" id="ndSupCam" accept="image/*" capture="environment" style="display:none" onchange="handlePurchaseImage(this,\'ns\')">'
        + '<input type="file" id="ndSupGal" accept="image/*" style="display:none" onchange="handlePurchaseImage(this,\'ns\')">'
        + '<div id="nsImageWrap" style="display:none;margin-top:6px"><img id="nsImagePreview" style="max-width:100%;max-height:140px;border-radius:8px"></div></div></div>'
        + '<div class="form-group"><label>优点</label><textarea id="ndSupPros" rows="2" style="resize:none"></textarea></div>'
        + '<div class="form-group"><label>缺点</label><textarea id="ndSupCons" rows="2" style="resize:none"></textarea></div>'
        + '<div class="form-group"><label>备注</label><textarea id="ndSupNote" rows="1" style="resize:none"></textarea></div>'
        + '<div class="nd-actions"><button type="button" class="nd-btn m" onclick="needSupplierFormToggle()">收起</button>'
        + '<button type="button" class="nd-btn p" onclick="needSupplierAdd(\'' + escAttr(needId) + '\')">✅ 添加</button></div></div>';
      html += buildDimsForm(needId, dims);
    }
  }

  // ===== ② 试用子单 =====
  if (trials.length) {
    html += '<div class="detail-section-title">📦 试用单 <span style="font-weight:400;color:var(--muted);font-size:12px">不与正式单冲突，可同时入账</span></div>';
    trials.forEach(function (o) { html += buildOrderCard(n, o, sups); });
  }

  // ===== ③ 定点 / 正式 =====
  html += '<div class="detail-section-title">🎯 定点与正式采购</div>';
  if (st === '对比中') {
    if (!sups.length) {
      html += '<div class="nd-hint">先添加供应商，再来定点</div>';
    } else {
      // 默认选总分最高者
      let best = sups[0], bestScore = -1;
      sups.forEach(function (s) { const t = supplierWeightedTotal(dims, s['打分']); if (t > bestScore) { bestScore = t; best = s; } });
      const bestPromote = trials.find(o => o.supplierId === best.id && ['已下单', '已到'].indexOf(o['状态']) >= 0);
      html += '<div class="nd-form" id="ndDecideForm" data-need-id="' + escAttr(needId) + '">';
      html += '<div class="nd-radio-list">' + sups.map(function (s) {
        return '<label class="nd-radio"><input type="radio" name="decideSup" value="' + escAttr(s.id) + '"' + (s.id === best.id ? ' checked' : '') + ' onchange="needDecideChanged()">'
          + '<span>' + esc(s['谁'] || '') + (s['平台'] ? ' · ' + esc(s['平台']) : '') + ' · ' + fmtY(s['报价'])
          + ' <em>' + supplierWeightedTotal(dims, s['打分']).toFixed(2) + '分</em></span></label>';
      }).join('') + '</div>';
      html += '<div class="form-group"><label>定点方式</label><select id="decideMode" onchange="needDecideModeChanged()">' + buildDecideModeOptions(bestPromote) + '</select></div>';
      html += '<div id="decideNewFields">'
        + '<div class="form-row">'
        + '<div class="form-group" style="flex:1"><label>数量</label><input id="decideQty" type="number" min="1" value="1"></div>'
        + '<div class="form-group" style="flex:1"><label>实付单价（元）</label><input id="decidePrice" type="number" step="0.01" min="0" value="' + (best['报价'] != null ? Number(best['报价']) : '') + '"></div>'
        + '</div>'
        + '<div class="form-row">'
        + '<div class="form-group" style="flex:1"><label>日期</label><input id="decideDate" type="date" value="' + todayBJ() + '"></div>'
        + '<div class="form-group" style="flex:1"><label>📦 分期期数</label><input id="decideInst" type="number" min="0" max="120" placeholder="0=不分期"></div>'
        + '</div>'
        + '<div class="form-group"><label>备注</label><input id="decideNote" placeholder="选填"></div>'
        + '</div>';
      html += '<label class="nd-check"><input type="checkbox" id="decideRetire" checked> 落选的试用单自动退货</label>';
      html += '<div class="nd-actions"><button type="button" class="nd-btn p" onclick="needDecide(\'' + escAttr(needId) + '\')">🎯 确认定点</button></div>';
      html += '</div>';
    }
  } else if (st === '已定点') {
    if (winner) {
      html += '<div class="nd-winner">🎯 <b>' + esc(winner['谁'] || '') + '</b>' + (winner['平台'] ? ' · ' + esc(winner['平台']) : '') + ' · 报价 ' + fmtY(winner['报价'])
        + (n['定点时间'] ? ' · <span style="color:var(--muted)">' + esc(n['定点时间']) + '</span>' : '') + '</div>';
    }
    if (formal) {
      html += buildOrderCard(n, formal, sups, true);
    } else {
      // 正式单缺失（回退定点边缘态）→ 补建
      html += '<div class="nd-form">'
        + '<div class="form-row">'
        + '<div class="form-group" style="flex:1"><label>数量</label><input id="fcQty" type="number" min="1" value="1"></div>'
        + '<div class="form-group" style="flex:1"><label>实付单价（元）</label><input id="fcPrice" type="number" step="0.01" min="0" value="' + (winner && winner['报价'] != null ? Number(winner['报价']) : '') + '"></div>'
        + '</div>'
        + '<div class="form-group"><label>日期</label><input id="fcDate" type="date" value="' + todayBJ() + '"></div>'
        + '<div class="nd-actions"><button type="button" class="nd-btn p" onclick="needFormalCreate(\'' + escAttr(needId) + '\')">🛒 创建正式单</button>'
        + '<button type="button" class="nd-btn m" onclick="needUndecided(\'' + escAttr(needId) + '\')">↩️ 回退定点</button></div></div>';
    }
  } else if (st === '已完成') {
    html += '<div class="nd-winner done">✅ 需求已完成' + (formal ? ' · ' + esc(formal['状态']) + ' ' + fmtY((Number(formal['实付']) || 0) * (Number(formal['数量']) || 1)) : '') + '</div>';
  } else if (st === '已取消') {
    html += '<div class="nd-winner cancelled">🚫 需求已取消</div>';
  }

  // ===== footer =====
  html += '<div class="nd-actions" style="margin-top:16px">';
  if (st === '对比中' || st === '已定点') {
    html += '<button type="button" class="nd-btn m" onclick="closeDetailModal();openNeedEdit(\'' + escAttr(needId) + '\')">✏️ 编辑需求</button>';
    html += '<button type="button" class="nd-btn r" onclick="needCancel(\'' + escAttr(needId) + '\')">❌ 取消需求</button>';
  }
  html += '<button type="button" class="nd-btn r" onclick="deleteNeed(\'' + escAttr(needId) + '\')">🗑️ 删除</button>';
  html += '</div>';

  document.getElementById('detailContent').innerHTML = html;
  document.getElementById('detailOverlay').classList.add('active');
}
function closeDetailModal() { const el = document.getElementById('detailOverlay'); if (el) el.classList.remove('active'); }

function buildDecideModeOptions(promotableTrial) {
  let h = '<option value="new">新建正式单</option>';
  if (promotableTrial) h = '<option value="promote">试用转正（不重复记账）</option>' + h;
  return h;
}
// 换定点候选时联动模式选项与默认报价
function needDecideChanged() {
  const n = findNeed(_decideNeedId()); if (!n) return;
  const sid = (document.querySelector('input[name="decideSup"]:checked') || {}).value;
  const s = (n.suppliers || []).find(x => x.id === sid);
  const promo = (n.orders || []).find(o => o.role === 'trial' && o.supplierId === sid && ['已下单', '已到'].indexOf(o['状态']) >= 0);
  const sel = document.getElementById('decideMode');
  if (sel) sel.innerHTML = buildDecideModeOptions(promo);
  const priceEl = document.getElementById('decidePrice');
  if (priceEl && s && s['报价'] != null) priceEl.value = Number(s['报价']);
  needDecideModeChanged();
}
function needDecideModeChanged() {
  const sel = document.getElementById('decideMode');
  const nf = document.getElementById('decideNewFields');
  if (sel && nf) nf.style.display = sel.value === 'promote' ? 'none' : '';
}
function _decideNeedId() {
  const el = document.getElementById('ndDecideForm');
  if (el && el.dataset.needId) return el.dataset.needId;
  return '';
}
// 「定点这家」快捷入口：勾选对应 radio 并滚动到定点区
function needDecidePick(needId, supId) {
  const radio = document.querySelector('input[name="decideSup"][value="' + supId + '"]');
  if (radio) { radio.checked = true; needDecideChanged(); }
  const form = document.getElementById('ndDecideForm');
  if (form) form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 子单卡片（试用/正式通用）：状态 + 分期 + 流转按钮
function buildOrderCard(n, o, sups, isFormal) {
  const sup = (sups || []).find(s => s.id === o.supplierId);
  const qty = Number(o['数量']) || 1;
  const price = Number(o['实付']) || 0;
  const total = Math.round(price * qty * 100) / 100;
  const st = o['状态'] || '待下单';
  let h = '<div class="nd-order' + (isFormal ? ' formal' : '') + '">';
  h += '<div class="nd-order-head"><span>' + (isFormal ? '🛒 正式单' : '🧪 试用单') + ' · ' + esc(sup ? (sup['谁'] || '') : '未指定供应商') + '</span>'
    + '<span class="badge badge-' + escAttr(st) + '">' + esc(st) + '</span></div>';
  h += '<div class="nd-order-money">' + fmtY(price) + (qty > 1 ? ' × ' + qty + ' = <b>' + fmtY(total) + '</b>' : '')
    + (o['日期'] ? ' <span style="color:var(--muted)">📅 ' + (function (d) { try { return new Date(d).toISOString().slice(0, 10); } catch (e) { return ''; } })(o['日期']) + '</span>' : '') + '</div>';
  if (o['备注']) h += '<div style="font-size:12px;color:var(--muted)">💬 ' + esc(o['备注']) + '</div>';
  // 分期进度
  const tp = Number(o['分期期数']) || 0;
  if (tp > 0) {
    const pd = getEffectivePaid(o);
    const ia = Number(o['分期金额']) || Math.round(total / tp * 100) / 100;
    const paidAmt = ia * pd;
    const pct = Math.min(total > 0 ? paidAmt / total * 100 : 0, 100);
    h += '<div class="nd-inst"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span>¥' + ia + '/期 · 共' + tp + '期</span><span>已付 ' + pd + ' 期</span></div>'
      + '<div class="nd-inst-bar"><i style="width:' + pct + '%"></i></div></div>';
  }
  // 正式单待下单：可改数量/实付/日期/分期
  if (isFormal && st === '待下单') {
    h += '<div class="nd-form" style="margin-top:8px"><div class="form-row">'
      + '<div class="form-group" style="flex:1"><label>数量</label><input id="foQty" type="number" min="1" value="' + qty + '"></div>'
      + '<div class="form-group" style="flex:1"><label>实付单价</label><input id="foPrice" type="number" step="0.01" min="0" value="' + price + '"></div></div>'
      + '<div class="form-row">'
      + '<div class="form-group" style="flex:1"><label>日期</label><input id="foDate" type="date" value="' + (o['日期'] ? new Date(o['日期']).toISOString().slice(0, 10) : todayBJ()) + '"></div>'
      + '<div class="form-group" style="flex:1"><label>分期期数</label><input id="foInst" type="number" min="0" max="120" value="' + (tp || '') + '"></div></div>'
      + '<div class="nd-actions"><button type="button" class="nd-btn m" onclick="needOrderSave(\'' + escAttr(String(o.id)) + '\',\'' + escAttr(String(n.id)) + '\')">💾 保存修改</button></div></div>';
  }
  // 流转按钮
  const actions = NEED_ORDER_FLOW[st] || [];
  if (actions.length) {
    h += '<div class="nd-actions">' + actions.map(function (a) {
      return '<button type="button" class="nd-btn ' + a.cls + '" onclick="needOrderTransition(\'' + escAttr(String(o.id)) + '\',\'' + escAttr(String(n.id)) + '\',\'' + escAttr(a.to) + '\')">' + a.label + '</button>';
    }).join('') + '</div>';
  }
  h += '</div>';
  return h;
}

// ===== 维度编辑面板（仅对比中）=====
function buildDimsForm(needId, dims) {
  let h = '<div class="nd-form" id="ndDimsForm" style="display:none"><div style="font-size:13px;font-weight:600;margin-bottom:6px">⚖️ 对比维度（权重 1-9，总分 = Σ分×权 ÷ Σ权）</div>';
  h += '<div id="ndDimsRows">' + dims.map((d, i) => dimRowHtml(d, i)).join('') + '</div>';
  h += '<div class="nd-actions"><button type="button" class="nd-btn m" onclick="needDimsAddRow()">＋ 加一维</button>'
    + '<button type="button" class="nd-btn m" onclick="needDimsFormToggle()">收起</button>'
    + '<button type="button" class="nd-btn p" onclick="needDimsSave(\'' + escAttr(needId) + '\')">✅ 保存维度</button></div></div>';
  return h;
}
function dimRowHtml(d, i) {
  const key = d && d.key ? d.key : ('k' + i + Date.now().toString(36));
  return '<div class="nd-dim-row" data-key="' + escAttr(key) + '">'
    + '<input class="nd-dim-label" placeholder="名称" value="' + escAttr((d && d.label) || '') + '" maxlength="30">'
    + '<input class="nd-dim-weight" type="number" min="1" max="9" value="' + (d && Number(d.weight) ? Number(d.weight) : 1) + '">'
    + '<button type="button" class="nd-btn r" style="padding:6px 9px" onclick="this.parentNode.remove()" aria-label="删除维度">✕</button></div>';
}
function needSupplierFormToggle() {
  const f = document.getElementById('ndSupForm'); if (!f) return;
  f.style.display = f.style.display === 'none' ? '' : 'none';
  if (f.style.display === '') setTimeout(function () { const el = document.getElementById('ndSupName'); if (el) el.focus(); }, 50);
}
function needDimsFormToggle() {
  const f = document.getElementById('ndDimsForm'); if (!f) return;
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

// ============================================================
// 详情内动作
// ============================================================
async function needSetScore(needId, supId, key, val) {
  const n = findNeed(needId); if (!n) return;
  const s = (n.suppliers || []).find(x => x.id === supId); if (!s) return;
  const scores = Object.assign({}, s['打分'] || {});
  scores[key] = val;
  s['打分'] = scores; // 乐观更新
  openDetailModal(needId);
  const r = await needsApi('PUT', '/suppliers/' + supId + '/scores', { scores: scores });
  if (r && r.error) { toast('打分保存失败: ' + r.error); needRefresh(needId); }
}

async function needSupplierAdd(needId) {
  const el = id => document.getElementById(id);
  const name = (el('ndSupName').value || '').trim();
  if (!name) { toast('请填写供应商名称'); return; }
  const body = {
    name: name,
    platform: (el('ndSupPlatform').value || '').trim(),
    price: el('ndSupPrice').value === '' ? null : parseFloat(el('ndSupPrice').value),
    pros: (el('ndSupPros').value || '').trim(),
    cons: (el('ndSupCons').value || '').trim(),
    note: (el('ndSupNote').value || '').trim(),
  };
  if (typeof purchaseImageData !== 'undefined' && purchaseImageData['ns']) body.image = purchaseImageData['ns'];
  const r = await needsApi('POST', '/needs/' + needId + '/suppliers', body);
  if (r && r.error) { toast('添加失败: ' + r.error); return; }
  if (typeof purchaseImageData !== 'undefined') purchaseImageData['ns'] = '';
  toast('已添加供应商');
  await needRefresh(needId);
}

async function needSupplierDelete(needId, supId) {
  const n = findNeed(needId); if (!n) return;
  if ((n.orders || []).some(o => o.supplierId === supId)) { toast('该供应商已有子单，不可删除'); return; }
  if (!confirm('删除该供应商？')) return;
  const r = await needsApi('DELETE', '/suppliers/' + supId);
  if (r && r.error) { toast('删除失败: ' + r.error); return; }
  toast('已删除');
  await needRefresh(needId);
}

async function needDimsAddRow() {
  const box = document.getElementById('ndDimsRows'); if (!box) return;
  if (box.children.length >= 20) { toast('最多 20 个维度'); return; }
  const div = document.createElement('div');
  div.innerHTML = dimRowHtml(null, box.children.length);
  box.appendChild(div.firstChild);
}
async function needDimsSave(needId) {
  const box = document.getElementById('ndDimsRows'); if (!box) return;
  const dims = [];
  for (const row of box.querySelectorAll('.nd-dim-row')) {
    const label = (row.querySelector('.nd-dim-label').value || '').trim();
    const weight = parseInt(row.querySelector('.nd-dim-weight').value, 10);
    if (!label) { toast('维度名称不能为空'); return; }
    if (!(weight >= 1 && weight <= 9)) { toast('权重需为 1~9'); return; }
    dims.push({ key: row.dataset.key || ('k' + dims.length), label: label.slice(0, 30), weight: weight });
  }
  if (!dims.length) { toast('至少保留一个维度'); return; }
  const r = await needsApi('PUT', '/needs/' + needId, { dimensions: dims });
  if (r && r.error) { toast('保存失败: ' + r.error); return; }
  toast('维度已保存');
  await needRefresh(needId);
}

async function needTrialCreate(needId, supId) {
  const n = findNeed(needId); if (!n) return;
  const s = (n.suppliers || []).find(x => x.id === supId);
  const price = s && s['报价'] != null ? Number(s['报价']) : 0;
  if (!confirm('以 ' + fmtY(price) + ' × 1 下单试用「' + (s ? s['谁'] : '') + '」？')) return;
  const r = await needsApi('POST', '/needs/' + needId + '/orders', {
    role: 'trial', supplierId: supId, qty: 1, pricePaid: price, date: todayBJ(),
  });
  if (r && r.error) { toast('创建失败: ' + r.error); return; }
  toast('试用单已创建（待下单）');
  await needRefresh(needId);
}

async function needOrderTransition(orderId, needId, to) {
  const tips = {
    '已下单': '确认提交下单？', '已到': '确认收货？', '已退': '确认退货？退货后不再计入预算',
    '已归档': '确认归档？', '已取消': '确认取消该子单？',
  };
  if (!confirm(tips[to] || ('确认流转到「' + to + '」？'))) return;
  const r = await needsApi('POST', '/orders/' + orderId + '/transition', { to: to });
  if (r && r.error) { toast('流转失败: ' + r.error); return; }
  toast('已更新为「' + to + '」');
  await needRefresh(needId);
}

async function needOrderSave(orderId, needId) {
  const el = id => document.getElementById(id);
  const body = {};
  if (el('foQty')) body.qty = parseInt(el('foQty').value, 10) || 1;
  if (el('foPrice')) body.pricePaid = parseFloat(el('foPrice').value) || 0;
  if (el('foDate')) body.date = el('foDate').value || null;
  if (el('foInst')) {
    const tp = parseInt(el('foInst').value, 10) || 0;
    body.installments = tp;
    if (tp > 0) {
      const n = findNeed(needId);
      const o = n && (n.orders || []).find(x => x.id === orderId);
      const total = (body.pricePaid != null ? body.pricePaid : (o ? Number(o['实付']) : 0)) * (body.qty || (o ? Number(o['数量']) : 1));
      body.installmentAmount = Math.round(total / tp * 100) / 100;
      body.installmentStart = thisMonthBJ();
    } else { body.installmentAmount = 0; body.installmentStart = ''; }
  }
  const r = await needsApi('PUT', '/orders/' + orderId, body);
  if (r && r.error) { toast('保存失败: ' + r.error); return; }
  toast('已保存');
  await needRefresh(needId);
}

async function needDecide(needId) {
  const radio = document.querySelector('input[name="decideSup"]:checked');
  if (!radio) { toast('请选择供应商'); return; }
  const mode = (document.getElementById('decideMode') || {}).value || 'new';
  const body = { supplierId: radio.value, mode: mode, retireLosers: !!(document.getElementById('decideRetire') || {}).checked };
  if (mode === 'new') {
    const el = id => document.getElementById(id);
    body.qty = parseInt((el('decideQty') || {}).value, 10) || 1;
    body.pricePaid = parseFloat((el('decidePrice') || {}).value) || 0;
    body.date = (el('decideDate') || {}).value || todayBJ();
    body.note = ((el('decideNote') || {}).value || '').trim();
    const tp = parseInt((el('decideInst') || {}).value, 10) || 0;
    if (tp > 0) {
      body.installments = tp;
      body.installmentAmount = Math.round(body.pricePaid * body.qty / tp * 100) / 100;
      body.installmentStart = thisMonthBJ();
    }
  }
  const r = await needsApi('POST', '/needs/' + needId + '/decide', body);
  if (r && r.error) { toast('定点失败: ' + r.error); return; }
  toast(r && r.promoted ? '已定点（试用转正）' : '已定点');
  await needRefresh(needId);
}

async function needUndecided(needId) {
  if (!confirm('回退定点？正式单若未下单将一并移除')) return;
  const r = await needsApi('POST', '/needs/' + needId + '/undecided', {});
  if (r && r.error) { toast('回退失败: ' + r.error); return; }
  toast('已回到对比中');
  await needRefresh(needId);
}

async function needFormalCreate(needId) {
  const el = id => document.getElementById(id);
  const body = {
    role: 'formal',
    qty: parseInt((el('fcQty') || {}).value, 10) || 1,
    pricePaid: parseFloat((el('fcPrice') || {}).value) || 0,
    date: (el('fcDate') || {}).value || todayBJ(),
  };
  const r = await needsApi('POST', '/needs/' + needId + '/orders', body);
  if (r && r.error) { toast('创建失败: ' + r.error); return; }
  toast('正式单已创建');
  await needRefresh(needId);
}

async function needCancel(needId) {
  const n = findNeed(needId); if (!n) return;
  const reason = prompt('取消原因（可空）：', '') || '';
  if (reason === null) return;
  const r = await needsApi('POST', '/needs/' + needId + '/cancel', { reason: reason });
  if (r && r.error) { toast('取消失败: ' + r.error); return; }
  toast('需求已取消');
  await needRefresh(needId);
}

async function deleteNeed(id) {
  const n = findNeed(id);
  if (!n) return;
  if (!confirm('确定删除需求「' + (n['名称'] || '') + '」及其供应商/子单？')) return;
  if (typeof deletePurchaseExpenses === 'function' && n['名称']) await deletePurchaseExpenses(n['名称']);
  const r = await needsApi('DELETE', '/needs/' + id);
  if (r && r.error) { toast('删除失败: ' + r.error); return; }
  toast('已删除');
  closeDetailModal();
  await needRefresh();
}

// === App.needs namespace exports ===
App.needs = {
  needsList: function () { return needsList; },
  loadNeeds: loadNeeds, needsFromItems: needsFromItems, orderRows: orderRows,
  needsApi: needsApi, needEndpointMissing: needEndpointMissing, needRefresh: needRefresh,
  openDetailModal: openDetailModal, closeDetailModal: closeDetailModal,
  deleteNeed: deleteNeed, needSpend: needSpend, needBudgetText: needBudgetText,
  isActiveBuy: isActiveBuy, supplierWeightedTotal: supplierWeightedTotal, needDims: needDims,
  findNeed: findNeed, needImgSrc: needImgSrc,
};
