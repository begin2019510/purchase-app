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

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(), 'Content-Type': 'application/json' },
  });
}

function recordToItem(r) {
  const f = r.fields;
  return {
    id: r.record_id,
    '商品名称': f['商品名称'] || '',
    '平台': f['平台'] || '',
    '单价': f['单价'] || 0,
    '数量': f['数量'] || 1,
    '状态': f['状态'] || '待买',
    '分类': f['分类'] || '其他',
    '日期': f['日期'] || null,
    '备注': f['备注'] || '',
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const APP = env.FEISHU_BITABLE_APP;
  const TABLE = env.FEISHU_BITABLE_TABLE;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  try {
    if (request.method === 'GET') {
      const data = await feishuFetch('GET', `/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=500`, null, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500);
      const items = (data.data?.items || []).map(recordToItem);
      return json(items);
    }

    if (request.method === 'POST') {
      const body = await request.json();
      if (!body.name) return json({ error: 'name required' }, 400);
      const fields = {
        '商品名称': body.name,
        '平台': body.platform || '拼多多',
        '单价': body.price || 0,
        '数量': body.qty || 1,
        '状态': body.status || '待买',
        '分类': body.category || '其他',
        '备注': body.note || '',
      };
      if (body.date) fields['日期'] = new Date(body.date).getTime();
      const data = await feishuFetch('POST', `/bitable/v1/apps/${APP}/tables/${TABLE}/records`, { fields }, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500);
      return json({ id: data.data?.record?.record_id });
    }

    if (request.method === 'PUT') {
      const body = await request.json();
      if (!body.id) return json({ error: 'id required' }, 400);
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
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500);
      return json({ ok: true });
    }

    if (request.method === 'PATCH') {
      const body = await request.json();
      if (!body.ids || !body.ids.length || !body.status) return json({ error: 'ids and status required' }, 400);
      const results = [];
      for (const id of body.ids) {
        const data = await feishuFetch('PUT', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, {
          fields: { '状态': body.status }
        }, env);
        results.push({ id, ok: data.code === 0 });
      }
      return json({ results, updated: results.filter(r => r.ok).length });
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'id required' }, 400);
      const data = await feishuFetch('DELETE', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, null, env);
      if (data.code !== 0) return json({ error: 'Feishu API error', detail: data }, 500);
      return json({ ok: true });
    }

    return new Response('Method not allowed', { status: 405, headers: cors() });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
