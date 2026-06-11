// Projects API
import { getCorsHeaders, jsonResponse, authenticate, getFeishuToken } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  function json(data, status = 200, headers = {}) { return jsonResponse(data, status, { ...corsHeaders, ...headers }); }

  const user = await authenticate(request, env);
  if (!user.authenticated) return json({ error: 'Unauthorized' }, 401);

  const APP = user.bitable.projectApp;
  const TABLE = user.bitable.projectTable;
  if (!APP || !TABLE) return json({ error: 'Project table not configured. Please re-login.' }, 500);

  const feishuToken = await getFeishuToken(env);

  async function ensureProjectFields() {
    try {
      const listUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/fields?page_size=100`;
      const r = await fetch(listUrl, { headers: { Authorization: `Bearer ${feishuToken}` } });
      const d = await r.json();
      const names = (d.data?.items || []).map(f => f.field_name);
      const needed = [
        {name:'\u540d\u79f0', type:1},
        {name:'\u63cf\u8ff0', type:1},
        {name:'\u622a\u6b62\u65e5\u671f', type:5},
        {name:'\u622a\u6b62\u65e5\u671fISO', type:1},
        {name:'\u72b6\u6001', type:3, property:{options:[{name:'\u8fdb\u884c\u4e2d'},{name:'\u5df2\u5b8c\u6210'},{name:'\u5df2\u5f52\u6863'}]}},
        {name:'\u989c\u8272', type:1},
        {name:'\u8fdb\u5ea6', type:2},
        {name:'\u7236\u9879\u76eeID', type:1},
      ];
      for (const f of needed) {
        if (!names.includes(f.name)) {
          const createUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/fields`;
          await fetch(createUrl, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + feishuToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ field_name: f.name, type: f.type, property: f.property }),
          });
        }
      }
    } catch (e) { console.error('ensureProjectFields:', e.message); }
  }
  await ensureProjectFields();

  function feishuStr(v) { return v ? String(v) : ''; }

  function recordToProject(rec) {
    const f = rec.fields;
    return {
      id: rec.record_id,
      name: feishuStr(f['\u540d\u79f0']),
      description: feishuStr(f['\u63cf\u8ff0']),
      dueDate: feishuStr(f['\u622a\u6b62\u65e5\u671fISO']) || f['\u622a\u6b62\u65e5\u671f'] || null,
      status: feishuStr(f['\u72b6\u6001']) || '\u8fdb\u884c\u4e2d',
      color: feishuStr(f['\u989c\u8272']) || '#6366f1',
      progress: Number(f['\u8fdb\u5ea6']) || 0,
      parentId: feishuStr(f['\u7236\u9879\u76eeID']),
    };
  }

  const method = request.method;

  if (method === 'GET') {
    const records = [];
    let pageToken = '';
    do {
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=100${pageToken ? '&page_token=' + pageToken : ''}`;
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + feishuToken } });
      const d = await r.json();
      if (d.data && d.data.items) d.data.items.forEach(rec => records.push(recordToProject(rec)));
      pageToken = d.data?.page_token || '';
    } while (pageToken);
    return json(records);
  }

  if (method === 'POST') {
    const body = await request.json();
    if (!body.name) return json({ error: 'Name required' }, 400);
    const fields = {
      '\u540d\u79f0': body.name.slice(0, 200),
      '\u63cf\u8ff0': (body.description || '').slice(0, 2000),
      '\u72b6\u6001': body.status || '\u8fdb\u884c\u4e2d',
      '\u989c\u8272': body.color || '#6366f1',
      '\u8fdb\u5ea6': 0,
    };
    if (body.dueDate) { fields['\u622a\u6b62\u65e5\u671f'] = new Date(body.dueDate).getTime(); fields['\u622a\u6b62\u65e5\u671fISO'] = body.dueDate; }
    if (body.parentId) fields['\u7236\u9879\u76eeID'] = body.parentId;
    const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + feishuToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const d = await r.json();
    if (d.code !== 0) return json({ error: d.msg || 'Create failed' }, 500);
    return json({ id: d.data?.record?.record_id, ok: true });
  }

  if (method === 'PUT') {
    const body = await request.json();
    if (!body.id) return json({ error: 'Missing id' }, 400);
    const fields = {};
    if (body.name !== undefined) fields['\u540d\u79f0'] = body.name.slice(0, 200);
    if (body.description !== undefined) fields['\u63cf\u8ff0'] = body.description.slice(0, 2000);
    if (body.dueDate !== undefined) { fields['\u622a\u6b62\u65e5\u671f'] = body.dueDate ? new Date(body.dueDate).getTime() : null; fields['\u622a\u6b62\u65e5\u671fISO'] = body.dueDate || ''; }
    if (body.status !== undefined) fields['\u72b6\u6001'] = body.status;
    if (body.color !== undefined) fields['\u989c\u8272'] = body.color;
    if (body.progress !== undefined) fields['\u8fdb\u5ea6'] = body.progress;
    if (body.parentId !== undefined) fields['\u7236\u9879\u76eeID'] = body.parentId || '';
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
    const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + feishuToken },
    });
    const d = await r.json();
    if (d.code !== 0) return json({ error: d.msg || 'Delete failed' }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
