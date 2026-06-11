// Todo API
import { getCorsHeaders, jsonResponse, authenticate, getFeishuToken } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  function json(data, status = 200, headers = {}) { return jsonResponse(data, status, { ...corsHeaders, ...headers }); }

  const user = await authenticate(request, env);
  if (!user.authenticated) return json({ error: 'Unauthorized' }, 401);

  const APP = user.bitable.todoApp;
  const TABLE = user.bitable.todoTable;
  if (!APP || !TABLE) return json({ error: 'Todo table not configured. Please re-login.' }, 500);

  const feishuToken = await getFeishuToken(env);

  async function ensureTodoFields() {
    try {
      const listUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/fields?page_size=100`;
      const r = await fetch(listUrl, { headers: { Authorization: `Bearer ${feishuToken}` } });
      const d = await r.json();
      const names = (d.data?.items || []).map(f => f.field_name);
      const needed = [
        {name:'标题', type:1}, {name:'描述', type:1}, {name:'截止日期', type:5},
        {name:'优先级', type:3, property:{options:[{name:'高'},{name:'中'},{name:'低'}]}},
        {name:'分类', type:3, property:{options:[{name:'采购'},{name:'记账'},{name:'生活'},{name:'工作'},{name:'健康'},{name:'其他'}]}},
        {name:'状态', type:3, property:{options:[{name:'待办'},{name:'进行中'},{name:'已完成'},{name:'已取消'}]}},
        {name:'重复', type:3, property:{options:[{name:'无'},{name:'每天'},{name:'每周'},{name:'每月'}]}},
        {name:'子任务', type:1}, {name:'图片', type:1},
        {name:'关联类型', type:3, property:{options:[{name:'无'},{name:'采购'},{name:'记账'}]}},
        {name:'关联ID', type:1}, {name:'完成时间', type:5},
        {name:'项目ID', type:1},
        {name:'标签', type:1},
        {name:'排序', type:2},
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
    } catch (e) { console.error('ensureTodoFields:', e.message); }
  }
  await ensureTodoFields();

  function feishuStr(v) { return v ? String(v) : ''; }
  function feishuNum(v) { return Number(v) || 0; }

  function recordToTodo(rec) {
    const f = rec.fields;
    return {
      id: rec.record_id,
      title: feishuStr(f['标题']),
      description: feishuStr(f['描述']),
      dueDate: f['截止日期'] || null,
      priority: feishuStr(f['优先级']) || '中',
      category: feishuStr(f['分类']) || '其他',
      status: feishuStr(f['状态']) || '待办',
      repeat: feishuStr(f['重复']) || '无',
      subtasks: feishuStr(f['子任务']),
      image: feishuStr(f['图片']),
      linkType: feishuStr(f['关联类型']) || '无',
      linkId: feishuStr(f['关联ID']),
      completedAt: f['完成时间'] || null,
      projectId: feishuStr(f['项目ID']),
      tags: feishuStr(f['标签']),
      order: Number(f['排序']) || 0,
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
      if (d.data && d.data.items) d.data.items.forEach(rec => records.push(recordToTodo(rec)));
      pageToken = d.data?.page_token || '';
    } while (pageToken);
    return json(records);
  }

  if (method === 'POST') {
    const body = await request.json();
    if (!body.title) return json({ error: 'Title required' }, 400);
    const fields = {
      '标题': body.title.slice(0, 200),
      '描述': (body.description || '').slice(0, 2000),
      '优先级': body.priority || '中',
      '分类': body.category || '其他',
      '状态': body.status || '待办',
      '重复': body.repeat || '无',
      '子任务': body.subtasks || '[]',
      '关联类型': body.linkType || '无',
      '关联ID': body.linkId || '',
      '项目ID': body.projectId || '',
    };
    if (body.dueDate) fields['截止日期'] = new Date(body.dueDate).getTime();
    if (body.image && body.image.startsWith('data:')) {
      const KV = env.IMAGE_STORE;
      if (KV) {
        const key = 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const imgMatch = body.image.match(/^data:(image\/\w+);base64,(.+)$/);
        const imgBase64 = imgMatch ? imgMatch[2] : body.image;
        const imgMeta = imgMatch ? { contentType: imgMatch[1] } : { contentType: 'image/jpeg' };
        await KV.put(key, imgBase64, { expirationTtl: 86400 * 365, metadata: imgMeta });
        fields['图片'] = 'kv:' + key;
      }
    } else if (body.image) {
      fields['图片'] = body.image;
    }
    const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + feishuToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const d = await r.json();
    if (d.code !== 0) return json({ error: d.msg || 'Create failed', detail: d }, 500);
    
      // Send JPush notification for new todo
      if (user.username && body.dueDate) {
        try {
          const { handleSend } = await import('./push/jpush.js');
          const dueStr = new Date(body.dueDate).toLocaleDateString('zh-CN');
          await handleSend(env, user.username, '📋 新待办', body.title + ' (截止: ' + dueStr + ')', { type: 'todo' });
        } catch(e) { console.log('JPush todo notification error:', e.message); }
      }
return json({ id: d.data?.record?.record_id, ok: true }, 201);
  }

  if (method === 'PUT') {
    const body = await request.json();
    if (!body.id) return json({ error: 'Missing id' }, 400);
    const fields = {};

    let existingRecord = null;
    if (body.status === '已完成') {
      try {
        const er = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${body.id}`, {
          headers: { Authorization: 'Bearer ' + feishuToken }
        });
        const ed = await er.json();
        if (ed.code === 0 && ed.data?.record) existingRecord = recordToTodo(ed.data.record);
      } catch(e) {}
    }

    if (body.title !== undefined) fields['标题'] = body.title;
    if (body.description !== undefined) fields['描述'] = body.description;
    if (body.dueDate !== undefined) fields['截止日期'] = body.dueDate ? new Date(body.dueDate).getTime() : null;
    if (body.priority !== undefined) fields['优先级'] = body.priority;
    if (body.category !== undefined) fields['分类'] = body.category;
    if (body.status !== undefined) {
      fields['状态'] = body.status;
      if (body.status === '已完成') fields['完成时间'] = Date.now();
    }
    if (body.repeat !== undefined) fields['重复'] = body.repeat;
    if (body.subtasks !== undefined) fields['子任务'] = body.subtasks;
    if (body.linkType !== undefined) fields['关联类型'] = body.linkType;
    if (body.linkId !== undefined) fields['关联ID'] = body.linkId;
    if (body.projectId !== undefined) fields['项目ID'] = body.projectId;
    if (body.tags !== undefined) fields['标签'] = body.tags;
    if (body.order !== undefined) fields['排序'] = body.order;
    if (body.image !== undefined) {
      if (body.image && body.image.startsWith('data:')) {
        const KV = env.IMAGE_STORE;
        if (KV) {
          const key = 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          const imgMatch = body.image.match(/^data:(image\/\w+);base64,(.+)$/);
          const imgBase64 = imgMatch ? imgMatch[2] : body.image;
          const imgMeta = imgMatch ? { contentType: imgMatch[1] } : { contentType: 'image/jpeg' };
          await KV.put(key, imgBase64, { expirationTtl: 86400 * 365, metadata: imgMeta });
          fields['图片'] = 'kv:' + key;
        }
      } else {
        fields['图片'] = body.image || '';
      }
    }

    const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${body.id}`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + feishuToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });
    const d = await r.json();
    if (d.code !== 0) return json({ error: d.msg || 'Update failed' }, 500);

    let renewed = false;
    if (body.status === '已完成' && existingRecord && existingRecord.repeat && existingRecord.repeat !== '无' && existingRecord.dueDate) {
      try {
        const oldDue = new Date(existingRecord.dueDate);
        if (existingRecord.repeat === '每天') oldDue.setDate(oldDue.getDate() + 1);
        else if (existingRecord.repeat === '每周') oldDue.setDate(oldDue.getDate() + 7);
        else if (existingRecord.repeat === '每月') oldDue.setMonth(oldDue.getMonth() + 1);
        let resetSubs = '[]';
        try {
          const subs = JSON.parse(existingRecord.subtasks || '[]');
          resetSubs = JSON.stringify(subs.map(s => ({text: s.text, done: false})));
        } catch(e) {}
        const renewFields = {
          '标题': existingRecord.title,
          '描述': existingRecord.description,
          '截止日期': oldDue.getTime(),
          '优先级': existingRecord.priority,
          '分类': existingRecord.category,
          '状态': '待办',
          '重复': existingRecord.repeat,
          '子任务': resetSubs,
          '关联类型': existingRecord.linkType || '无',
          '关联ID': existingRecord.linkId || '',
        };
        await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + feishuToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: renewFields }),
        });
        renewed = true;
      } catch(e) { console.error('Auto-renew failed:', e.message); }
    }
    return json({ ok: true, renewed });
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

  if (method === 'PATCH') {
    const body = await request.json();
    if (!body.ids || !body.ids.length) return json({ error: 'ids required' }, 400);
    const results = [];
    for (const id of body.ids) {
      const fields = {};
      if (body.status) {
        fields['状态'] = body.status;
        if (body.status === '已完成') fields['完成时间'] = Date.now();
      }
      const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${id}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + feishuToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      const d = await r.json();
      results.push({ id, ok: d.code === 0 });
    }
    return json({ ok: true, results });
  }

  return json({ error: 'Method not allowed' }, 405);
}
