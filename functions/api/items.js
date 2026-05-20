const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

async function getToken(env) {
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.tenant_access_token;
}

async function feishuFetch(method, path, body, env) {
  const token = await getToken(env);
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${FEISHU_BASE}${path}`, opts);
  return res.json();
}

// ===== CORS =====
const ALLOWED_ORIGINS = ['https://121212121.top', 'http://121212121.top'];

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  };
}

function json(data, status = 200, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ===== PIN 认证 =====
function verifyPin(request, env) {
  const pin = request.headers.get('X-API-Key');
  if (!pin || pin !== env.API_KEY) return false;
  return true;
}

function nowBjStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
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
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const corsHeaders = getCorsHeaders(request);

  // OPTIONS 放行
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // PIN 校验（所有请求都要）
  if (!verifyPin(request, env)) {
    return json({ error: '未授权：PIN 错误或缺失' }, 401, corsHeaders);
  }

  const APP = env.FEISHU_BITABLE_APP;
  const TABLE = env.FEISHU_BITABLE_TABLE;

  try {
    if (request.method === 'GET') {
      const data = await feishuFetch('GET', `/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=500`, null, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500, corsHeaders);
      const items = (data.data?.items || []).map(recordToItem);
      return json(items, 200, corsHeaders);
    }

    if (request.method === 'POST') {
      const body = await request.json();
      if (!body.name) return json({ error: 'name required' }, 400, corsHeaders);
      const fields = {
        '商品名称': body.name,
        '平台': body.platform || '拼多多',
        '单价': body.price || 0,
        '数量': body.qty || 1,
        '状态': body.status || '待审批',
        '分类': body.category || '其他',
        '备注': body.note || '',
        '创建时间': nowBjStr(),
      };
      if (body.date) fields['日期'] = new Date(body.date).getTime();
      const data = await feishuFetch('POST', `/bitable/v1/apps/${APP}/tables/${TABLE}/records`, { fields }, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500, corsHeaders);
      return json({ id: data.data?.record?.record_id }, 200, corsHeaders);
    }

    if (request.method === 'PUT') {
      const body = await request.json();
      if (!body.id) return json({ error: 'id required' }, 400, corsHeaders);
      const fields = {};
      if (body.name !== undefined) fields['商品名称'] = body.name;
      if (body.platform !== undefined) fields['平台'] = body.platform;
      if (body.price !== undefined) fields['单价'] = body.price;
      if (body.qty !== undefined) fields['数量'] = body.qty;
      if (body.status !== undefined) fields['状态'] = body.status;
      if (body.category !== undefined) fields['分类'] = body.category;
      if (body.note !== undefined) fields['备注'] = body.note;
      if (body.date !== undefined) fields['日期'] = body.date ? new Date(body.date).getTime() : null;
      const data = await feishuFetch('PUT', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${body.id}`, { fields }, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500, corsHeaders);
      return json({ ok: true }, 200, corsHeaders);
    }

    if (request.method === 'PATCH') {
      const body = await request.json();
      if (!body.ids || !body.ids.length || !body.status) return json({ error: 'ids and status required' }, 400, corsHeaders);
      const statusTimeMap = { '已审批': '审批时间', '已下单': '下单时间', '已到': '到货时间' };
      const timeField = statusTimeMap[body.status];
      const results = [];
      for (const id of body.ids) {
        const fields = { '状态': body.status };
        if (timeField) fields[timeField] = nowBjStr();
        const data = await feishuFetch('PUT', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, { fields }, env);
        results.push({ id, ok: data.code === 0 });
      }
      return json({ results, updated: results.filter(r => r.ok).length }, 200, corsHeaders);
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id required' }, 400, corsHeaders);
      const data = await feishuFetch('DELETE', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, null, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500, corsHeaders);
      return json({ ok: true }, 200, corsHeaders);
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  } catch (e) {
    return json({ error: e.message }, 500, corsHeaders);
  }
}
