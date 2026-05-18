const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

async function getToken(env) {
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.tenant_access_token;
}

async function feishuFetch(method, path, body, env) {
  const token = await getToken(env);
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${FEISHU_BASE}${path}`, opts);
  return res.json();
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const APP = env.FEISHU_BITABLE_APP;
  const TABLE = env.FEISHU_BITABLE_TABLE;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (request.method === 'GET') {
      const data = await feishuFetch('GET', `/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=500`, null, env);
      if (data.code !== 0) return new Response(JSON.stringify({ error: 'Feishu API error', detail: data }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const items = (data.data?.items || []).map(r => ({
        id: r.record_id,
        ...r.fields,
      }));
      return new Response(JSON.stringify(items), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const { name, platform, price, qty, status, date, note } = body;
      if (!name) return new Response(JSON.stringify({ error: 'name required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const fields = {
        '商品名称': name,
        '平台': platform || '拼多多',
        '单价': price || 0,
        '数量': qty || 1,
        '状态': status || '待买',
        '备注': note || '',
      };
      if (date) fields['日期'] = new Date(date).getTime();
      const data = await feishuFetch('POST', `/bitable/v1/apps/${APP}/tables/${TABLE}/records`, { fields }, env);
      if (data.code !== 0) return new Response(JSON.stringify({ error: 'Feishu API error', detail: data }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ id: data.data?.record?.record_id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (request.method === 'PUT') {
      const body = await request.json();
      const { id, ...rest } = body;
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const fields = {};
      if (rest.name !== undefined) fields['商品名称'] = rest.name;
      if (rest.platform !== undefined) fields['平台'] = rest.platform;
      if (rest.price !== undefined) fields['单价'] = rest.price;
      if (rest.qty !== undefined) fields['数量'] = rest.qty;
      if (rest.status !== undefined) fields['状态'] = rest.status;
      if (rest.note !== undefined) fields['备注'] = rest.note;
      if (rest.date !== undefined) fields['日期'] = rest.date ? new Date(rest.date).getTime() : null;
      const data = await feishuFetch('PUT', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, { fields }, env);
      if (data.code !== 0) return new Response(JSON.stringify({ error: 'Feishu API error', detail: data }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (request.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const data = await feishuFetch('DELETE', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, null, env);
      if (data.code !== 0) return new Response(JSON.stringify({ error: 'Feishu API error', detail: data }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}
