// 灾备同步写入口：服务器 → CF → 飞书 Bitable / KV（SERVICE_TOKEN 鉴权）
// POST {action:'records', username, table, updates:[{record_id,fields}], creates:[fields], deletes:[record_id]}
// POST {action:'kv', kind:'budget'|'recurring'|'cats', username, data}
import { json } from '../push/_common.js';
import { getFeishuToken } from '../_auth.js';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const TABLE_KEY = { purchases: ['purchaseApp', 'purchaseTable'], expenses: ['expenseApp', 'expenseTable'], todos: ['todoApp', 'todoTable'], projects: ['projectApp', 'projectTable'] };

// 各表需要确保存在的字段（缺失则按需创建，与运行期 ensure*Fields 一致）
const NEED_FIELDS = {
  purchases: [
    { name: '评估摘要', type: 1 }, { name: '购买理由', type: 1 }, { name: '预算区间', type: 1 },
    { name: '取消原因', type: 1 }, { name: '分期期数', type: 1 }, { name: '分期金额', type: 1 },
    { name: '分期开始月', type: 1 }, { name: '分期已还', type: 1 }, { name: '极速', type: 1 }, { name: '虚拟', type: 1 }, { name: '图片', type: 1 },
  ],
  expenses: [{ name: '分摊周数', type: 2 }, { name: '分摊开始周', type: 2 }],
  todos: [
    { name: '描述', type: 1 }, { name: '标签', type: 1 }, { name: '排序', type: 2 },
    { name: '提醒', type: 1 }, { name: '截止日期ISO', type: 1 }, { name: '项目ID', type: 1 }, { name: '图片', type: 1 },
  ],
  projects: [{ name: '父项目ID', type: 1 }, { name: '截止日期ISO', type: 1 }],
};

async function ensureFields(app, table, kind, H) {
  const need = NEED_FIELDS[kind] || [];
  if (!need.length) return;
  try {
    const r = await fetch(`${FEISHU_BASE}/bitable/v1/apps/${app}/tables/${table}/fields?page_size=100`, { headers: H });
    const d = await r.json();
    if (d.code !== 0) return;
    const names = (d.data?.items || []).map(f => f.field_name);
    for (const f of need) {
      if (names.includes(f.name)) continue;
      await fetch(`${FEISHU_BASE}/bitable/v1/apps/${app}/tables/${table}/fields`, {
        method: 'POST', headers: H, body: JSON.stringify({ field_name: f.name, type: f.type }),
      });
    }
  } catch (e) { /* 尽力而为，失败让后续写入报错暴露 */ }
}

export async function onRequest(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (request.method !== 'POST') return json({ error: 'method' }, 405, headers);
  const url = new URL(request.url);
  const svc = url.searchParams.get('token') || '';
  if (!env.SERVICE_TOKEN || svc !== env.SERVICE_TOKEN) return json({ error: 'forbidden' }, 403, headers);
  const KV = env.IMAGE_STORE;

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, headers); }

  try {
    if (body.action === 'kv') {
      const kind = body.kind;
      if (!['budget', 'recurring', 'cats'].includes(kind)) return json({ error: 'bad kind' }, 400, headers);
      await KV.put(kind + ':' + body.username, JSON.stringify(body.data || {}), { expirationTtl: 365 * 86400 });
      return json({ ok: true }, 200, headers);
    }

    if (body.action === 'records') {
      const userRaw = await KV.get('user:' + body.username, 'json');
      if (!userRaw || !userRaw.bitable) return json({ error: 'no bitable' }, 404, headers);
      const key = TABLE_KEY[body.table];
      if (!key) return json({ error: 'bad table' }, 400, headers);
      const app = userRaw.bitable[key[0]], table = userRaw.bitable[key[1]];
      if (!app || !table) return json({ error: 'table missing' }, 404, headers);

      const token = await getFeishuToken(env);
      const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
      const out = { updated: 0, created: 0, deleted: 0, newIds: [] };

      // 缺失字段按需补齐（老用户表可能没有后来新增的字段）
      await ensureFields(app, table, body.table, H);

      // 批量更新（≤500/批）；整批失败降级逐条，单条坏数据不拖垮整轮
      const updates = body.updates || [];
      for (let i = 0; i < updates.length; i += 500) {
        const chunk = updates.slice(i, i + 500);
        const r = await fetch(`${FEISHU_BASE}/bitable/v1/apps/${app}/tables/${table}/records/batch_update`, {
          method: 'POST', headers: H, body: JSON.stringify({ records: chunk }),
        });
        const d = await r.json();
        if (d.code === 0) { out.updated += chunk.length; continue; }
        out.failed = out.failed || 0;
        for (const rec of chunk) {
          const rr = await fetch(`${FEISHU_BASE}/bitable/v1/apps/${app}/tables/${table}/records/${rec.record_id}`, {
            method: 'PUT', headers: H, body: JSON.stringify({ fields: rec.fields }),
          });
          const dd = await rr.json();
          if (dd.code === 0) out.updated++; else { out.failed++; (out.errors = out.errors || []).push((dd.msg || dd.code) + '#' + rec.record_id); }
        }
      }
      // 批量新增（≤500/批）→ 回传新 record_id
      const creates = body.creates || [];
      for (let i = 0; i < creates.length; i += 500) {
        const chunk = creates.slice(i, i + 500);
        const r = await fetch(`${FEISHU_BASE}/bitable/v1/apps/${app}/tables/${table}/records/batch_create`, {
          method: 'POST', headers: H, body: JSON.stringify({ records: chunk.map(f => ({ fields: f })) }),
        });
        const d = await r.json();
        if (d.code !== 0) throw new Error('batch_create: ' + (d.msg || d.code));
        out.created += chunk.length;
        for (const rec of (d.data?.records || [])) out.newIds.push(rec.record_id);
      }
      // 批量删除（≤500/批）
      const deletes = body.deletes || [];
      for (let i = 0; i < deletes.length; i += 500) {
        const chunk = deletes.slice(i, i + 500);
        const r = await fetch(`${FEISHU_BASE}/bitable/v1/apps/${app}/tables/${table}/records/batch_delete`, {
          method: 'POST', headers: H, body: JSON.stringify({ records: chunk }),
        });
        const d = await r.json();
        if (d.code !== 0) throw new Error('batch_delete: ' + (d.msg || d.code));
        out.deleted += chunk.length;
      }
      return json({ ok: true, ...out }, 200, headers);
    }

    return json({ error: 'unknown action' }, 400, headers);
  } catch (e) {
    return json({ error: e.message }, 500, headers);
  }
}
