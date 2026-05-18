const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

async function getToken() {
  const res = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: process.env.FEISHU_APP_ID,
      app_secret: process.env.FEISHU_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error('Auth failed: ' + JSON.stringify(data));
  return data.tenant_access_token;
}

async function feishuFetch(method, path, body) {
  const token = await getToken();
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const APP = process.env.FEISHU_BITABLE_APP;
  const TABLE = process.env.FEISHU_BITABLE_TABLE;

  try {
    if (req.method === 'GET') {
      const data = await feishuFetch('GET', `/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=500`);
      if (data.code !== 0) return res.status(500).json({ error: 'Feishu API error', detail: data });
      const items = (data.data?.items || []).map(r => ({
        id: r.record_id,
        ...r.fields,
      }));
      return res.json(items);
    }

    if (req.method === 'POST') {
      const { name, platform, price, qty, status, date, note } = req.body;
      if (!name) return res.status(400).json({ error: 'name required' });
      const fields = {
        '商品名称': name,
        '平台': platform || '拼多多',
        '单价': price || 0,
        '数量': qty || 1,
        '状态': status || '待买',
        '备注': note || '',
      };
      if (date) fields['日期'] = new Date(date).getTime();
      const data = await feishuFetch('POST', `/bitable/v1/apps/${APP}/tables/${TABLE}/records`, { fields });
      if (data.code !== 0) return res.status(500).json({ error: 'Feishu API error', detail: data });
      return res.json({ id: data.data?.record?.record_id });
    }

    if (req.method === 'PUT') {
      const { id, ...rest } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const fields = {};
      if (rest.name !== undefined) fields['商品名称'] = rest.name;
      if (rest.platform !== undefined) fields['平台'] = rest.platform;
      if (rest.price !== undefined) fields['单价'] = rest.price;
      if (rest.qty !== undefined) fields['数量'] = rest.qty;
      if (rest.status !== undefined) fields['状态'] = rest.status;
      if (rest.note !== undefined) fields['备注'] = rest.note;
      if (rest.date !== undefined) fields['日期'] = rest.date ? new Date(rest.date).getTime() : null;
      const data = await feishuFetch('PUT', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, { fields });
      if (data.code !== 0) return res.status(500).json({ error: 'Feishu API error', detail: data });
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const data = await feishuFetch('DELETE', `/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`);
      if (data.code !== 0) return res.status(500).json({ error: 'Feishu API error', detail: data });
      return res.json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}
