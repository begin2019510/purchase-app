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
    const needed = ['评估摘要', '购买理由', '预算区间', '取消原因'];
    for (const name of needed) {
      if (!names.includes(name)) {
        await feishuFetch('POST', `/bitable/v1/apps/${APP}/tables/${TABLE}/fields`, {
          field_name: name, type: 1
        }, env);
      }
    }
    _fieldsEnsured = true;
  } catch (e) {
    console.error('ensureEvalFields error:', e.message);
  }
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
  if (url.searchParams.get('debug') === 'auth') {
    if (user.username !== 'admin') return json({ error: '仅管理员可查看' }, 403);
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return jsonResponse({ error: 'no token', authHeader }, 200, corsHeaders);
    try {
      const payload = await verifyJWT(token, env.JWT_SECRET);
      if (!payload) return jsonResponse({ error: 'JWT verify failed', tokenLen: token.length }, 200, corsHeaders);
      return jsonResponse({
        ok: true,
        username: payload.username,
        hasBitable: !!payload.bitable,
        purchaseApp: payload.bitable?.purchaseApp || null,
        purchaseTable: payload.bitable?.purchaseTable || null,
        expenseApp: payload.bitable?.expenseApp || null,
        expenseTable: payload.bitable?.expenseTable || null,
        exp: payload.exp,
        now: Math.floor(Date.now() / 1000),
      }, 200, corsHeaders);
    } catch (e) {
      return jsonResponse({ error: 'verify error: ' + e.message }, 200, corsHeaders);
    }
  }

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
      const data = await feishuFetch('GET', `/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=500`, null, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500);
      const items = (data.data?.items || []).map(recordToItem);
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
      };
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
      let oldStatus = null;
      let oldName = '';
      if (body.status !== undefined) {
        try {
          const existingData = await feishuFetch('GET', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${body.id}`, null, env);
          if (existingData.code === 0 && existingData.data?.record) {
            oldStatus = existingData.data.record.fields['状态'] || '未知';
            oldName = existingData.data.record.fields['商品名称'] || '';
          }
        } catch {}
      }

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
