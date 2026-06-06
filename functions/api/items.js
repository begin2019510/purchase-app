import { getCorsHeaders, jsonResponse, authenticate, getFeishuToken, verifyJWT, logOp } from './_auth.js';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

function nowBjStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

// Ensure new fields exist in Bitable (cached per request)
let _fieldsEnsured = false;
async function ensureEvalFields(APP, TABLE, env) {
  if (_fieldsEnsured) return;
  try {
    const existing = await feishuFetch('GET', `/bitable/v1/apps/${APP}/tables/${TABLE}/fields?page_size=100`, null, env);
    if (existing.code !== 0) return;
    const names = (existing.data?.items || []).map(f => f.field_name);
    const needed = [
      {name:'评估摘要', type:1}, {name:'购买理由', type:1}, {name:'预算区间', type:1}, {name:'取消原因', type:1},
      {name:'分期期数', type:1}, {name:'分期金额', type:1}, {name:'分期开始月', type:1}, {name:'分期已还', type:1}, {name:'图片', type:1}
    ];
    for (const f of needed) {
      if (!names.includes(f.name)) {
        await feishuFetch('POST', `/bitable/v1/apps/${APP}/tables/${TABLE}/fields`, {
          field_name: f.name, type: f.type
        }, env);
      }
    }
    _fieldsEnsured = true;
  } catch (e) {
    console.error('ensureEvalFields error:', e.message);
  }
}

// Extract number from Feishu field (handles rich text arrays)
function feishuNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v) || 0;
  if (Array.isArray(v) && v.length > 0) {
    var text = v.map(function(seg) { return seg.text || seg.content || ''; }).join('');
    return Number(text) || 0;
  }
  return Number(v) || 0;
}
// Extract string from Feishu field (handles rich text arrays)
function feishuStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) {
    return v.map(function(seg) { return seg.text || seg.content || ''; }).join('');
  }
  return String(v);
}

function recordToItem(r) {
  const f = r.fields;
  return {
    id: r.record_id,
    '商品名称': f['商品名称'] || '',
    '平台': f['平台'] || '',
    '单价': f['单价'] || 0,
    '数量': f['数量'] || 1,
    '状态': f['状态'] || '待审批',
    '分类': f['分类'] || '其他',
    '日期': f['日期'] || null,
    '备注': f['备注'] || '',
    '创建时间': f['创建时间'] || '',
    '审批时间': f['审批时间'] || '',
    '下单时间': f['下单时间'] || '',
    '到货时间': f['到货时间'] || '',
    '归档时间': f['归档时间'] || '',
    '评估摘要': f['评估摘要'] || '',
    '购买理由': f['购买理由'] || '',
    '预算区间': f['预算区间'] || '',
    '取消原因': f['取消原因'] || '',
    '图片': feishuStr(f['图片']),
    '附件': (function(){var v=feishuStr(f['图片']);try{return v?JSON.parse(v):{}}catch(e){return v?{legacy:v}:{}}}()),
    '分期期数': feishuNum(f['分期期数']),
    '分期金额': feishuNum(f['分期金额']),
    '分期开始月': feishuStr(f['分期开始月']),
    '分期已还': feishuNum(f['分期已还']),
  };
}

async function feishuFetch(method, path, body, env) {
  const token = await getFeishuToken(env);
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${FEISHU_BASE}${path}`, opts);
  return res.json();
}


// ===== Todo linking helpers =====
async function getFeishuTokenForItems(env) {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  return data.tenant_access_token;
}

async function createLinkedTodo(env, todoApp, todoTable, item, title, dueDate, priority) {
  try {
    const token = await getFeishuTokenForItems(env);
    const fields = {
      '标题': title.slice(0, 200),
      '优先级': priority || '中',
      '分类': '采购',
      '状态': '待办',
      '重复': '无',
      '子任务': '[]',
      '关联类型': '采购',
      '关联ID': item.id || '',
    };
    if (dueDate) fields['截止日期'] = new Date(dueDate).getTime();
    await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${todoApp}/tables/${todoTable}/records`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
  } catch (e) { console.error('createLinkedTodo error:', e.message); }
}

async function deleteLinkedTodos(env, todoApp, todoTable, itemId) {
  try {
    const token = await getFeishuTokenForItems(env);
    // Search for todos linked to this item
    const searchUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${todoApp}/tables/${todoTable}/records/search`;
    const res = await fetch(searchUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: { conjunction: 'and', conditions: [{ field_name: '关联ID', operator: 'is', value: [itemId] }] },
        page_size: 50,
      }),
    });
    const data = await res.json();
    if (data.data?.items) {
      for (const rec of data.data.items) {
        await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${todoApp}/tables/${todoTable}/records/${rec.record_id}`, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token },
        });
      }
    }
  } catch (e) { console.error('deleteLinkedTodos error:', e.message); }
}

async function completeLinkedTodos(env, todoApp, todoTable, itemId, titlePrefix) {
  try {
    const token = await getFeishuTokenForItems(env);
    const searchUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${todoApp}/tables/${todoTable}/records/search`;
    const res = await fetch(searchUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filter: { conjunction: 'and', conditions: [
          { field_name: '关联ID', operator: 'is', value: [itemId] },
          { field_name: '标题', operator: 'contains', value: [titlePrefix] },
        ]},
        page_size: 10,
      }),
    });
    const data = await res.json();
    if (data.data?.items) {
      for (const rec of data.data.items) {
        await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${todoApp}/tables/${todoTable}/records/${rec.record_id}`, {
          method: 'PUT',
          headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { '状态': '已完成', '完成时间': Date.now() } }),
        });
      }
    }
  } catch (e) { console.error('completeLinkedTodos error:', e.message); }
}

function calcInstallmentDate(baseDate, period) {
  const d = new Date(baseDate);
  d.setMonth(d.getMonth() + period);
  d.setDate(15); // 15th of each month
  return d.toISOString().slice(0, 10);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const corsHeaders = getCorsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // 认证（JWT 或 旧 PIN）
  const user = await authenticate(request, env);
  if (!user.authenticated) {
    return jsonResponse({ error: '未授权：请登录' }, 401, corsHeaders);
  }

  // 调试: 查看当前用户的认证和表信息（仅管理员）
  const APP = user.bitable.purchaseApp;
  const TABLE = user.bitable.purchaseTable;

  const json = (data, status = 200) => jsonResponse(data, status, corsHeaders);

  try {
    if (request.method === 'GET') {
      const cacheSuffix = user.username ? `_${user.username}` : '';
      const cacheKey = new Request(url.origin + url.pathname + cacheSuffix);
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) {
        const freshPromise = feishuFetch('GET', `/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=500`, null, env)
          .then(data => {
            if (data.code === 0) {
              const items = (data.data?.items || []).map(recordToItem);
              const resp = new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
              context.waitUntil(cache.put(cacheKey, resp.clone()));
            }
          }).catch(() => {});
        context.waitUntil(freshPromise);
        return cached;
      }
      // DEBUG: log raw fields for first item with installments
      const rawItems = data.data?.items || [];
      for (const ri of rawItems) {
        const rf = ri.fields;
        if (rf['分期期数']) {
          console.log('DEBUG_INSTALLMENT', JSON.stringify({
            name: rf['商品名称'],
            分期期数: rf['分期期数'],
            分期金额: rf['分期金额'],
            分期开始月: rf['分期开始月'],
            分期已还: rf['分期已还'],
            typeof_分期期数: typeof rf['分期期数'],
            isArray: Array.isArray(rf['分期期数'])
          }));
        }
      }
      const items = rawItems.map(recordToItem);
      const resp = new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private', 'Vary': 'Authorization' } });
      context.waitUntil(cache.put(cacheKey, resp.clone()));
      return json(items);
    }

    if (request.method === 'POST') {
      await ensureEvalFields(APP, TABLE, env);
      const body = await request.json();
      if (!body.name) return json({ error: 'name required' }, 400);
      const fields = {
        '商品名称': body.name,
        '平台': body.platform || '拼多多',
        '单价': body.price || 0,
        '数量': body.qty || 1,
        '状态': body.status || '待审批',
        '分类': body.category || '其他',
        '备注': body.note || '',
        '创建时间': nowBjStr(),
        '日期': Date.now(),
        '评估摘要': body.evalSummary || '',
        '购买理由': body.buyReason || '',
        '预算区间': body.budgetRange || '',
        '取消原因': '',
        '分期期数': String(body.installments || 0),
        '分期金额': String(body.installmentAmount || 0),
        '分期开始月': body.installmentStart || '',
        '分期已还': '1',
      };
            // Image upload to KV
      let imageRef = '';
      if (body.image && body.image.startsWith('data:')) {
        const KV = env.IMAGE_STORE;
        if (KV) {
          const key = 'purchase_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          const imgMatch = body.image.match(/^data:(image\/\w+);base64,(.+)$/); const imgBase64 = imgMatch ? imgMatch[2] : body.image; const imgMeta = imgMatch ? { contentType: imgMatch[1] } : { contentType: 'image/jpeg' }; await KV.put(key, imgBase64, { expirationTtl: 86400 * 365, metadata: imgMeta });
          imageRef = 'kv:' + key;
        }
      } else if (body.image && body.image.startsWith('kv:')) {
        imageRef = body.image;
      }
      // Stage image handling
      if (body.stageImage && body.stageName) {
        try {
          var existing = {};
          try { existing = JSON.parse(existingImage || '{}'); } catch(e) {}
          if (typeof existing !== 'object') existing = {};
          existing[body.stageName] = imageRef;
          fields['图片'] = JSON.stringify(existing);
        } catch(e) { fields['图片'] = imageRef; }
      } else {
        fields['图片'] = imageRef;
      }
      if (body.date) fields['日期'] = new Date(body.date).getTime();
      const data = await feishuFetch('POST', `/bitable/v1/apps/${APP}/tables/${TABLE}/records`, { fields }, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500);
      // 清除缓存，下次GET读最新数据
      const cacheSuffix = user.username ? `_${user.username}` : '';
      const cacheKey = new Request(url.origin + url.pathname + cacheSuffix);
      context.waitUntil(caches.default.delete(cacheKey));
      return json({ id: data.data?.record?.record_id });
    }

    if (request.method === 'PUT') {
      await ensureEvalFields(APP, TABLE, env);
      const body = await request.json();
      if (!body.id) return json({ error: 'id required' }, 400);

      // 获取旧状态用于日志记录
      // 获取已有记录（用于日志 + 图片合并）
      let oldStatus = null;
      let oldName = '';
      let existingImage = '';
      try {
        const existingData = await feishuFetch('GET', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${body.id}`, null, env);
        if (existingData.code === 0 && existingData.data?.record) {
          const ef = existingData.data.record.fields;
          oldStatus = ef['状态'] || '未知';
          oldName = ef['商品名称'] || '';
          existingImage = ef['图片'] || '';
        }
      } catch(e) {}

      const fields = {};
      if (body.name !== undefined) fields['商品名称'] = body.name;
      if (body.platform !== undefined) fields['平台'] = body.platform;
      if (body.price !== undefined) fields['单价'] = body.price;
      if (body.qty !== undefined) fields['数量'] = body.qty;
      if (body.status !== undefined) fields['状态'] = body.status;
      if (body.category !== undefined) fields['分类'] = body.category;
      if (body.note !== undefined) fields['备注'] = body.note;
      if (body.date !== undefined) fields['日期'] = body.date ? new Date(body.date).getTime() : null;
      if (body.evalSummary !== undefined) fields['评估摘要'] = body.evalSummary;
      if (body.buyReason !== undefined) fields['购买理由'] = body.buyReason;
      if (body.budgetRange !== undefined) fields['预算区间'] = body.budgetRange;
      if (body.cancelReason !== undefined) fields['取消原因'] = body.cancelReason;
      if (body.installments !== undefined) fields['分期期数'] = String(body.installments);
      if (body.installmentAmount !== undefined) fields['分期金额'] = String(body.installmentAmount);
      if (body.installmentStart !== undefined) fields['分期开始月'] = body.installmentStart;
      if (body.installmentPaid !== undefined) fields['分期已还'] = String(body.installmentPaid);
            // Image upload to KV for PUT
      if (body.image !== undefined) {
        if (body.image && body.image.startsWith('data:')) {
          const KV = env.IMAGE_STORE;
          if (KV) {
            const key = 'purchase_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
            const imgMatch = body.image.match(/^data:(image\/\w+);base64,(.+)$/); const imgBase64 = imgMatch ? imgMatch[2] : body.image; const imgMeta = imgMatch ? { contentType: imgMatch[1] } : { contentType: 'image/jpeg' }; await KV.put(key, imgBase64, { expirationTtl: 86400 * 365, metadata: imgMeta });
            var _imgRef = 'kv:' + key;
            if (body.stageImage && body.stageName) {
              try {
                var _existing = {};
                try { _existing = JSON.parse(existingImage || '{}'); } catch(e) {}
                if (typeof _existing !== 'object') _existing = {};
                _existing[body.stageName] = _imgRef;
                fields['图片'] = JSON.stringify(_existing);
              } catch(e) { fields['图片'] = _imgRef; }
            } else {
              fields['图片'] = _imgRef;
            }
          }
        } else if (body.image && body.image.startsWith('kv:')) {
          if (body.stageImage && body.stageName) {
            try {
              var _ex4 = {};
              try { _ex4 = JSON.parse(existingImage || '{}'); } catch(e) {}
              if (typeof _ex4 !== 'object') _ex4 = {};
              _ex4[body.stageName] = body.image;
              fields['图片'] = JSON.stringify(_ex4);
            } catch(e) { fields['图片'] = body.image; }
          } else {
            fields['图片'] = body.image;
          }
        } else if (!body.image) {
          if (body.stageImage && body.stageName) {
              try {
                var _ex3 = {};
                try { _ex3 = JSON.parse(existingImage || '{}'); } catch(e) {}
                if (typeof _ex3 === 'object') { delete _ex3[body.stageName]; fields['图片'] = JSON.stringify(_ex3); }
                else { fields['图片'] = ''; }
              } catch(e) { fields['图片'] = ''; }
            } else {
              fields['图片'] = '';
            }
        }
      }
      if (body.setDate && !fields['日期']) fields['日期'] = Date.now();
      const data = await feishuFetch('PUT', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${body.id}`, { fields }, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500);

      // 记录状态变更日志
      if (body.status !== undefined && oldStatus && body.status !== oldStatus) {
        await logOp(env.IMAGE_STORE, 'status_change', user.username, oldStatus + ' → ' + body.status + '（' + (body.name || oldName) + '）', request).catch(() => {});
      }

      const cacheSuffix = user.username ? `_${user.username}` : '';
      const cacheKey = new Request(url.origin + url.pathname + cacheSuffix);
      context.waitUntil(caches.default.delete(cacheKey));
      return json({ ok: true });
    }

    if (request.method === 'PATCH') {
      const body = await request.json();
      if (!body.ids || !body.ids.length) return json({ error: 'ids required' }, 400);
      const statusTimeMap = { '待评估': '创建时间', '待审批': '创建时间', '已审批': '审批时间', '已下单': '下单时间', '已到': '到货时间', '已退': '到货时间', '已归档': '归档时间', '已取消': '归档时间' };
      const timeField = body.status ? statusTimeMap[body.status] : null;
      const results = [];
      for (const id of body.ids) {
        const fields = {};
        if (body.status) fields['状态'] = body.status;
        if (timeField) fields[timeField] = nowBjStr();
        if (body.note !== undefined) fields['备注'] = body.note;
        if (body.cancelReason !== undefined) fields['取消原因'] = body.cancelReason;
        const data = await feishuFetch('PUT', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, { fields }, env);
        results.push({ id, ok: data.code === 0 });

        // Todo linking: auto-create/delete/complete todos on status change
        if (body.status && user.bitable?.todoApp && user.bitable?.todoTable) {
          const todoApp = user.bitable.todoApp;
          const todoTable = user.bitable.todoTable;
          // Get item details for todo creation
          if (body.status === '已审批' || body.status === '已下单' || body.status === '已到' || body.status === '已退' || body.status === '已取消') {
            try {
              const itemRes = await feishuFetch('GET', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, null, env);
              const item = itemRes.data?.record?.fields || {};
              const itemName = item['商品名称'] || '商品';
              const instPeriods = Number(item['分期期数']) || 0;
              const instAmount = Number(item['分期金额']) || 0;

              if (body.status === '已审批') {
                await createLinkedTodo(env, todoApp, todoTable, {id}, '下单：' + itemName, null, '高');
              }
              if (body.status === '已下单' && instPeriods > 1) {
                for (let p = 1; p <= instPeriods; p++) {
                  const due = calcInstallmentDate(item['日期'] || Date.now(), p);
                  await createLinkedTodo(env, todoApp, todoTable, {id}, `第${p}期还款 ¥${instAmount}`, due, '中');
                }
              }
              if (body.status === '已到') {
                await completeLinkedTodos(env, todoApp, todoTable, id, '下单');
              }
              if (body.status === '已退' || body.status === '已取消') {
                await deleteLinkedTodos(env, todoApp, todoTable, id);
              }
            } catch (e) { console.error('Todo linking error:', e.message); }
          }
        }
      }
      const patchCacheSuffix = user.username ? `_${user.username}` : '';
      const patchCacheKey = new Request(url.origin + url.pathname + patchCacheSuffix);
      context.waitUntil(caches.default.delete(patchCacheKey));
      return json({ results, updated: results.filter(r => r.ok).length });
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id required' }, 400);
      const data = await feishuFetch('DELETE', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, null, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500);
      // 删除关联待办
      try {
        const tb = user.bitable || {};
        if (tb.todoApp && tb.todoTable) {
          await deleteLinkedTodos(env, tb.todoApp, tb.todoTable, id);
        }
      } catch (e) { console.error("delete linked todos on DELETE:", e.message); }
      // 清除缓存
      const cacheSuffix = user.username ? `_${user.username}` : '';
      const cacheKey = new Request(url.origin + url.pathname + cacheSuffix);
      context.waitUntil(caches.default.delete(cacheKey));
      return json({ ok: true });
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
