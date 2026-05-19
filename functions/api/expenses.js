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
    return json({ error: '未授权' }, 401, corsHeaders);
  }

  const APP = env.FEISHU_EXPENSE_APP;
  const TABLE = env.FEISHU_EXPENSE_TABLE;
  if (!APP || !TABLE) return json({ error: '记账未配置' }, 500, corsHeaders);

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

  // 日期转时间戳（北京时间 00:00:00）
  function dateToTs(dateStr) {
    if (!dateStr) return Date.now();
    const d = new Date(dateStr + 'T00:00:00+08:00');
    return d.getTime();
  }

  const token = await getToken();
  const method = request.method;

  if (method === 'GET') {
    // 读取所有记账记录
    const records = [];
    let pageToken = '';
    do {
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=100${pageToken ? '&page_token=' + pageToken : ''}`;
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      const d = await r.json();
      if (d.data && d.data.items) {
        d.data.items.forEach(rec => {
          const f = rec.fields;
          records.push({
            id: rec.record_id,
            '日期': f['日期'] || null,
            '类型': f['类型'] || '支出',
            '分类': f['分类'] || '其他',
            '金额': f['金额'] || 0,
            '备注': f['备注'] || '',
          });
        });
      }
      pageToken = d.data?.page_token || '';
    } while (pageToken);
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
    const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const d = await r.json();
    return json({ id: d.data?.record?.record_id, ok: true }, 201, corsHeaders);
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

  return json({ error: '方法不允许' }, 405, corsHeaders);
}
