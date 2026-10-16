// 迁移专用只读导出端点：GET /api/mig/export?kind=...&token=SERVICE_TOKEN
// kind=users|docs|records&user=X|img&key=K|refreshes|invites|logs
// 迁移完成后此文件随 PR5 移除
import { json } from '../push/_common.js';
import { getFeishuToken } from '../_auth.js';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

async function kvListAll(KV, prefix) {
  const out = []; let cursor;
  do {
    const page = await KV.list({ prefix, cursor });
    out.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
async function bitableList(app, table, token) {
  const out = []; let pt = '';
  do {
    const url = `${FEISHU_BASE}/bitable/v1/apps/${app}/tables/${table}/records?page_size=500${pt ? '&page_token=' + pt : ''}`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    const d = await r.json();
    if (d.code !== 0) throw new Error('Feishu list: ' + (d.msg || d.code));
    out.push(...(d.data?.items || []));
    pt = d.data?.page_token || '';
  } while (pt);
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  if (request.method !== 'GET') return json({ error: 'method' }, 405, headers);
  const svc = url.searchParams.get('token') || '';
  if (!env.SERVICE_TOKEN || svc !== env.SERVICE_TOKEN) return json({ error: 'forbidden' }, 403, headers);
  const KV = env.IMAGE_STORE;
  const kind = url.searchParams.get('kind');

  try {
    if (kind === 'users') {
      const keys = await kvListAll(KV, 'user:');
      const users = [];
      for (const k of keys) {
        const raw = await KV.get(k.name, 'json');
        if (raw) users.push({ username: k.name.slice(5), data: raw });
      }
      return json({ ok: true, users }, 200, headers);
    }

    if (kind === 'docs') {
      const keys = await kvListAll(KV, 'user:');
      const out = { budget: {}, recurring: {}, cats: {}, webpush: {}, reports: {} };
      for (const k of keys) {
        const u = k.name.slice(5);
        for (const [field, prefix] of [['budget', 'budget:'], ['recurring', 'recurring:'], ['cats', 'cats:'], ['webpush', 'webpush:'], ['reports', 'report:latest:']]) {
          const v = await KV.get(prefix + u, 'json');
          if (v !== null && v !== undefined) out[field][u] = v;
        }
      }
      return json({ ok: true, docs: out }, 200, headers);
    }

    if (kind === 'records') {
      const username = url.searchParams.get('user');
      if (!username) return json({ error: 'user required' }, 400, headers);
      const userRaw = await KV.get('user:' + username, 'json');
      if (!userRaw || !userRaw.bitable) return json({ ok: true, records: null });
      const bt = userRaw.bitable;
      const token = await getFeishuToken(env);
      const [purchases, expenses, todos, projects] = await Promise.all([
        bt.purchaseApp && bt.purchaseTable ? bitableList(bt.purchaseApp, bt.purchaseTable, token) : Promise.resolve([]),
        bt.expenseApp && bt.expenseTable ? bitableList(bt.expenseApp, bt.expenseTable, token) : Promise.resolve([]),
        bt.todoApp && bt.todoTable ? bitableList(bt.todoApp, bt.todoTable, token) : Promise.resolve([]),
        bt.projectApp && bt.projectTable ? bitableList(bt.projectApp, bt.projectTable, token) : Promise.resolve([]),
      ]);
      return json({ ok: true, records: { purchases, expenses, todos, projects } }, 200, headers);
    }

    if (kind === 'img') {
      const key = url.searchParams.get('key');
      if (!key) return json({ error: 'key required' }, 400, headers);
      const raw = await KV.get(key);
      if (raw === null) return json({ ok: false, error: 'not_found' }, 404, headers);
      const meta = await KV.getWithMetadata(key);
      let b64 = raw, contentType = (meta && meta.metadata && meta.metadata.contentType) || 'image/jpeg';
      if (typeof raw === 'string' && raw.startsWith('data:')) {
        const m = raw.match(/^data:(image\/\w+);base64,(.*)$/);
        if (m) { contentType = m[1]; b64 = m[2]; }
      }
      return json({ ok: true, key, contentType, base64: b64 }, 200, headers);
    }

    if (kind === 'refreshes') {
      const keys = await kvListAll(KV, 'refresh:');
      const rows = [];
      for (const k of keys) {
        const v = await KV.get(k.name, 'json');
        if (v) rows.push({ token: k.name.slice(8), username: v.username, expiresAt: v.expiresAt });
      }
      return json({ ok: true, rows }, 200, headers);
    }

    if (kind === 'invites') {
      const dyn = await KV.get('dynamic_invites', 'json');
      return json({ ok: true, codes: dyn || [] }, 200, headers);
    }

    if (kind === 'logs') {
      const keys = await kvListAll(KV, 'log:');
      const rows = [];
      for (const k of keys.slice(-5000)) {
        const v = await KV.get(k.name, 'json');
        if (v) rows.push(v);
      }
      return json({ ok: true, rows }, 200, headers);
    }

    return json({ error: 'unknown kind' }, 400, headers);
  } catch (e) {
    return json({ error: e.message }, 500, headers);
  }
}
