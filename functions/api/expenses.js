export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ['https://121212121.top', 'http://121212121.top'].includes(origin) ? origin : 'https://121212121.top',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-API-Key',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }
  function verifyPin(req, env) {
    const pin = req.headers.get('X-API-Key');
    if (!pin || pin !== env.API_KEY) return false;
    return true;
  }
  if (!verifyPin(request, env)) {
    return json({ error: '未授�? }, 401, corsHeaders);
  }

  const APP = env.FEISHU_EXPENSE_APP;
  const TABLE = env.FEISHU_EXPENSE_TABLE;
  if (!APP || !TABLE) return json({ error: '记账未配�? }, 500, corsHeaders);

  // 获取飞书 tenant_access_token
  async function getToken() {
    const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
    });
    const d = await r.json();
    return d.tenant_access_token;
  }

  // 日期转时间戳（北京时�?00:00:00�?  function dateToTs(dateStr) {
    if (!dateStr) return Date.now();
    const d = new Date(dateStr + 'T00:00:00+08:00');
    return d.getTime();
  }

  const token = await getToken();
  const method = request.method;

  if (method === 'GET') {
    // Cache for expenses
    const cacheKey = new Request(request.url, request);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    const fetchFresh = async () => {
      const records = [];
      let pageToken = '';
      do {
        const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=100${pageToken ? '&page_token=' + pageToken : ''}`;
        const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
        const d = await r.json();
        if (d.data && d.data.items) {
          d.data.items.forEach(rec => {
            const f = rec.fields;
            let dateStr = null;
            if (f['日期']) {
              try { dateStr = new Date(f['日期']).toISOString().slice(0, 10); } catch {}
            }
            records.push({
              id: rec.record_id,
              '日期': dateStr,
              '类型': f['类型'] || '支出',
              '分类': f['分类'] || '其他',
              '金额': Number(f['金额']) || 0,
              '备注': f['备注'] || '',
              '图片': f['图片'] || '',
            });
          });
        }
        pageToken = d.data?.page_token || '';
      } while (pageToken);
      return records;
    };
    if (cached) {
      const freshPromise = fetchFresh().then(records => {
        const resp = new Response(JSON.stringify(records), { headers: { 'Content-Type': 'application/json' } });
        context.waitUntil(cache.put(cacheKey, resp.clone()));
      }).catch(() => {});
      context.waitUntil(freshPromise);
      return cached;
    }
    const records = await fetchFresh();
    const resp = new Response(JSON.stringify(records), { headers: { 'Content-Type': 'application/json' } });
    context.waitUntil(cache.put(cacheKey, resp.clone()));
    return json(records, 200, corsHeaders);
  }

  if (method === 'POST') {
    // 新增记账
    const body = await request.json();
    const fields = {
      '日期': dateToTs(body.date),
      '类型': body.type || '支出',
      '分类': body.category || '其他',
      '金额': body.amount || 0,
      '备注': body.note || '',
    };
    if (body.image && body.image.length <= 30000) fields['图片'] = body.image;
    const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const d = await r.json();
    return json({ id: d.data?.record?.record_id, ok: true }, 201, corsHeaders);
  }

  if (method === 'PUT') {
    const body = await request.json();
    if (!body.id) return json({ error: '缺少 id' }, 400, corsHeaders);
    const fields = {};
    if (body.type !== undefined) fields['类型'] = body.type;
    if (body.category !== undefined) fields['分类'] = body.category;
    if (body.amount !== undefined) fields['金额'] = body.amount;
    if (body.note !== undefined) fields['备注'] = body.note;
    if (body.date !== undefined) fields['日期'] = dateToTs(body.date);
    if (body.image !== undefined) { if (body.image && body.image.length <= 30000) fields['图片'] = body.image; else if (!body.image) fields['图片'] = ''; }
    const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${body.id}`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const d = await r.json();
    return json({ ok: true }, 200, corsHeaders);
  }

  if (method === 'DELETE') {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ error: '缺少 id' }, 400, corsHeaders);
    await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
    });
    return json({ ok: true }, 200, corsHeaders);
  }

  return json({ error: '方法不允�? }, 405, corsHeaders);
}
