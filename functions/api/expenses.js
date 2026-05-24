// IMAGE_ARCH: kv:前缀+KV key存'图片'字段, 见index.html显示逻辑
import { getCorsHeaders, jsonResponse, authenticate, getFeishuToken } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  function json(data, status = 200, headers = {}) { return jsonResponse(data, status, { ...corsHeaders, ...headers }); }

  // 认证（JWT 或 旧 PIN）
  const user = await authenticate(request, env);
  if (!user.authenticated) return json({ error: 'Unauthorized' }, 401);

  const APP = user.bitable.expenseApp;
  const TABLE = user.bitable.expenseTable;
  if (!APP || !TABLE) return json({ error: 'Expense table not configured' }, 500);

  function dateToTs(dateStr) {
    if (!dateStr) return Date.now();
    if (dateStr.includes('T')) return new Date(dateStr + '+08:00').getTime();
    return new Date(dateStr + 'T00:00:00+08:00').getTime();
  }

  const feishuToken = await getFeishuToken(env);
  const method = request.method;

  if (method === 'GET') {
    const records = [];
    let pageToken = '';
    do {
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=100${pageToken ? '&page_token=' + pageToken : ''}`;
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + feishuToken } });
      const d = await r.json();
      if (d.data && d.data.items) {
        d.data.items.forEach(rec => {
          const f = rec.fields;
          let dateStr = null;
          if (f['日期']) {
            try {
              const ts = f['日期'];
              const dt = new Date(typeof ts === 'number' ? ts + 8 * 3600 * 1000 : ts);
              const pad = n => String(n).padStart(2, '0');
              dateStr = dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()) + 'T' + pad(dt.getUTCHours()) + ':' + pad(dt.getUTCMinutes());
            } catch {}
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
    return json(records);
  }

  if (method === 'POST') {
    const body = await request.json();
    const fields = {
      '日期': dateToTs(body.date),
      '类型': body.type || '支出',
      '分类': body.category || '其他',
      '金额': body.amount || 0,
      '备注': body.note || '',
    };
    if (body.imageKey) fields['图片'] = 'kv:' + body.imageKey;
    else if (body.image && body.image.length <= 30000) fields['图片'] = body.image;
    let r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + feishuToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    let d = await r.json();
    if (d.code !== 0 || !d.data?.record?.record_id) {
      // 首次失败，尝试用base64图片重试
      if (body.image && body.image.length <= 30000) {
        fields['图片'] = body.image;
        r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + feishuToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields }),
        });
        d = await r.json();
      }
      if (d.code !== 0) return json({ error: d.msg || 'Create failed' }, 500);
    }
    return json({ id: d.data?.record?.record_id, ok: true }, 201);
  }

  if (method === 'PUT') {
    const body = await request.json();
    if (!body.id) return json({ error: 'Missing id' }, 400);
    const fields = {};
    if (body.type !== undefined) fields['类型'] = body.type;
    if (body.category !== undefined) fields['分类'] = body.category;
    if (body.amount !== undefined) fields['金额'] = body.amount;
    if (body.note !== undefined) fields['备注'] = body.note;
    if (body.date !== undefined) fields['日期'] = dateToTs(body.date);
    if (body.imageKey !== undefined) fields['图片'] = body.imageKey ? 'kv:' + body.imageKey : '';
    else if (body.image !== undefined) { if (body.image && body.image.length <= 30000) fields['图片'] = body.image; else if (!body.image) fields['图片'] = ''; }
    const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${body.id}`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + feishuToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const d = await r.json();
    if (d.code !== 0) return json({ error: d.msg || 'Update failed' }, 500);
    return json({ ok: true });
  }

  if (method === 'DELETE') {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, 400);
    const dr = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, {
      method: 'DELETE', headers: { Authorization: 'Bearer ' + feishuToken },
    });
    const dd = await dr.json();
    if (dd.code !== 0) return json({ error: dd.msg || 'Delete failed' }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
