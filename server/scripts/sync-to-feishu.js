'use strict';
// 灾备同步：MySQL → 飞书 Bitable（经 CF 写入，飞书密钥不落本机）
// 用法: sudo node server/scripts/sync-to-feishu.js [--dry]
// 幂等：以 ext_id 为锚点做 增/改/删 三向对齐；budget/recurring/cats 同步回 CF KV
const fs = require('fs');
const cfg = require('../src/config');
const db = require('../src/db');

const CF = process.env.CF_BASE || 'https://121212121.top';
const DRY = process.argv.includes('--dry');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function cfGet(path) {
  const r = await fetch(CF + path, { headers: { 'X-Service-Token': cfg.SERVICE_TOKEN } });
  if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
  return r.json();
}
async function cfPost(body) {
  if (DRY) { log('DRY cfPost', body.action, body.table || body.kind, (body.updates || []).length, '+', (body.creates || []).length, '-', (body.deletes || []).length); return { ok: true, newIds: [] }; }
  const r = await fetch(CF + '/api/mig/sync?token=' + encodeURIComponent(cfg.SERVICE_TOKEN), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!d.ok) throw new Error('sync ' + JSON.stringify(d).slice(0, 200));
  return d;
}
const n = v => (v == null ? '' : (typeof v === 'number' ? v : (Number(v) || 0)));
const s = v => (v == null ? '' : String(v));

// ===== 行 → 飞书中文字段 =====
function purchaseFields(r, pMap) {
  const f = {
    '商品名称': s(r.name), '平台': s(r.platform), '分类': s(r.category),
    '单价': Number(r.price) || 0, '数量': Number(r.qty) || 1,
    '状态': s(r.status), '日期': r.date_ms == null ? undefined : Number(r.date_ms),
    '备注': s(r.note), '图片': s(r.image_ref),
    '创建时间': s(r.created_at_text), '审批时间': s(r.approved_at), '下单时间': s(r.ordered_at),
    '到货时间': s(r.arrived_at), '归档时间': s(r.archived_at),
    '评估摘要': s(r.eval_summary), '购买理由': s(r.buy_reason), '预算区间': s(r.budget_range),
    '取消原因': s(r.cancel_reason),
    '分期期数': String(Number(r.installments) || 0), '分期金额': String(Number(r.installment_amount) || 0),
    '分期开始月': s(r.installment_start), '分期已还': String(Number(r.installment_paid) || 0),
    '极速': r.is_quick ? '1' : '',
  };
  for (const k of Object.keys(f)) if (f[k] === undefined || f[k] === null) delete f[k];
  return f;
}
function expenseFields(r) {
  return {
    '类型': s(r.type) || '支出', '金额': Number(r.amount) || 0, '分类': s(r.category),
    '日期': r.date_ms == null ? undefined : Number(r.date_ms), '备注': s(r.note), '图片': s(r.image_ref),
    '分摊周数': Number(r.split_weeks) || 0, '分摊开始周': s(r.split_start_week),
  };
}
function todoFields(r, pMap, prMap) {
  const f = {
    '标题': s(r.title), '描述': s(r.description),
    '截止日期': r.due_ms == null ? undefined : Number(r.due_ms), '截止日期ISO': s(r.due_iso),
    '优先级': s(r.priority), '分类': s(r.category), '状态': s(r.status), '重复': s(r.repeat),
    '子任务': s(r.subtasks), '图片': s(r.image_ref),
    '关联类型': s(r.link_type), '关联ID': s(r.link_id) ? (pMap[r.link_id] || s(r.link_id)) : '',
    '完成时间': r.completed_ms == null ? undefined : Number(r.completed_ms),
    '项目ID': r.project_id ? (prMap[r.project_id] || s(r.project_id)) : '',
    '标签': s(r.tags), '排序': Number(r.sort_no) || 0, '提醒': s(r.reminders),
  };
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return f;
}
function projectFields(r, prMap) {
  const f = {
    '名称': s(r.name), '描述': s(r.description),
    '截止日期': r.due_ms == null ? undefined : Number(r.due_ms), '截止日期ISO': s(r.due_iso),
    '状态': s(r.status), '颜色': s(r.color), '进度': Number(r.progress) || 0,
    '父项目ID': r.parent_id ? (prMap[r.parent_id] || s(r.parent_id)) : '',
  };
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return f;
}

(async () => {
  log('=== 灾备同步开始', DRY ? '(DRY)' : '', '===');
  const users = await db.query('SELECT id, username, bitable_json FROM users');
  let total = { u: 0, c: 0, d: 0 };
  for (const u of users) {
    // 源侧当前态（Feishu record_id ↔ ext_id）
    const src = await cfGet('/api/mig/export?kind=records&user=' + encodeURIComponent(u.username) + '&token=' + encodeURIComponent(cfg.SERVICE_TOKEN));
    if (!src.records) { log(u.username, '无 bitable，跳过'); continue; }
    const feishuExt = { purchases: new Map(), expenses: new Map(), todos: new Map(), projects: new Map() };
    for (const t of ['purchases', 'expenses', 'todos', 'projects']) {
      for (const r of (src.records[t] || [])) feishuExt[t].set(r.record_id, r);
    }

    // 库侧数据
    const rows = {
      purchases: await db.query('SELECT * FROM purchases WHERE user_id = ? ORDER BY id', [u.id]),
      expenses: await db.query('SELECT * FROM expenses WHERE user_id = ? ORDER BY id', [u.id]),
      todos: await db.query('SELECT * FROM todos WHERE user_id = ? ORDER BY id', [u.id]),
      projects: await db.query('SELECT * FROM projects WHERE user_id = ? ORDER BY id', [u.id]),
    };
    // 反向映射：rec_<n> → ext_id（飞书 record_id）
    const pMap = {}, prMap = {};
    for (const r of rows.purchases) pMap['rec_' + r.id] = r.ext_id;
    for (const r of rows.projects) prMap['rec_' + r.id] = r.ext_id;

    // 逐表差异
    for (const t of ['purchases', 'expenses', 'todos', 'projects']) {
      const extSeen = new Set();
      const updates = [], creates = [], pendingNew = [];
      for (const r of rows[t]) {
        const ext = r.ext_id;
        const fields = t === 'purchases' ? purchaseFields(r, pMap)
          : t === 'expenses' ? expenseFields(r)
            : t === 'todos' ? todoFields(r, pMap, prMap) : projectFields(r, prMap);
        if (ext && feishuExt[t].has(ext)) { extSeen.add(ext); updates.push({ record_id: ext, fields }); }
        else { creates.push(fields); pendingNew.push(r); }
      }
      // 库中已删（飞书还在）→ 删（对上快照比较，不含本次新增）
      const deletes = [];
      for (const recId of feishuExt[t].keys()) if (!extSeen.has(recId)) deletes.push(recId);
      if (!updates.length && !creates.length && !deletes.length) continue;

      const res = await cfPost({ action: 'records', username: u.username, table: t, updates, creates, deletes });
      total.u += res.updated || 0; total.c += res.created || 0; total.d += res.deleted || 0;
      log(u.username, t, 'upd', updates.length, 'new', creates.length, 'del', deletes.length,
        res.failed ? ('FAILED ' + res.failed + ' ' + JSON.stringify((res.errors || []).slice(0, 2))) : '');

      // 新增记录回填 ext_id（下次同步转为更新）
      if (!DRY && res.newIds && res.newIds.length) {
        for (let i = 0; i < res.newIds.length && i < pendingNew.length; i++) {
          await db.exec(`UPDATE ${t} SET ext_id = ? WHERE id = ?`, [res.newIds[i], pendingNew[i].id]);
        }
      }
    }

    // 文档类同步回 CF KV（周报/月报的预算信息仍读 KV）
    for (const [kind, table, empty] of [['budget', 'budgets', {}], ['recurring', 'recurring', { items: [] }], ['cats', 'cats', { list: [] }]]) {
      const row = await db.one(`SELECT data FROM ${table} WHERE user_id = ?`, [u.id]);
      const data = row ? (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) : empty;
      await cfPost({ action: 'kv', kind, username: u.username, data });
    }
  }
  log('=== 同步完成 ===', JSON.stringify(total));
  process.exit(0);
})().catch(e => { console.error('SYNC CRASH:', e.message); process.exit(1); });
