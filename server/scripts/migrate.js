'use strict';
// 数据迁移：CF(飞书Bitable+KV) → 本机 MySQL + 磁盘图片
// 用法: sudo node server/scripts/migrate.js [--dry]   （幂等，可反复跑做增量）
// 只读访问 CF；写入仅本机 MySQL 与图片目录
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../src/config');
const db = require('../src/db');
const IMG = require('../src/lib/images');

const CF = process.env.CF_BASE || 'https://121212121.top';
const SVC = { 'X-Service-Token': cfg.SERVICE_TOKEN };
const DRY = process.argv.includes('--dry');

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJSON(u) {
  const r = await fetch(CF + u, { headers: SVC });
  if (!r.ok) throw new Error(u + ' → HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160));
  return r.json();
}

// ---- 飞书字段归一化（镜像 CF feishuStr/feishuNum/select 拆数组）----
function fstr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length) return v.map(x => x.text || x.content || (typeof x === 'string' ? x : '')).join('');
  return String(v);
}
function fnum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length) v = v[0];
  const n = Number(typeof v === 'string' ? fstr(v) : v);
  return isNaN(n) ? 0 : n;
}
function parseWhen(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v);
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) { const t = Date.parse(s); return isNaN(t) ? null : t; }
  if (s.includes('T')) return Date.parse(s + '+08:00') || null;
  return Date.parse(s + 'T00:00:00+08:00') || null;
}

function collectImgRefs(refStr) {
  // 返回该记录引用的所有 kv key
  const out = [];
  if (!refStr) return out;
  const s = String(refStr);
  if (s.startsWith('kv:')) out.push(s.slice(3));
  else if (s.startsWith('{')) {
    try { for (const v of Object.values(JSON.parse(s))) if (typeof v === 'string' && v.startsWith('kv:')) out.push(v.slice(3)); } catch (e) {}
  }
  return out;
}

async function upsert(table, cols, rows, uniqueKey) {
  if (!rows.length) return;
  const updates = cols.filter(c => c !== uniqueKey).map(c => '`' + c + '`=VALUES(`' + c + '`)').join(',');
  const sql = `INSERT INTO ${table} (${cols.map(c => '`' + c + '`').join(',')}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updates}`;
  // 批量 200 行
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    if (!DRY) {
      const flat = chunk.reduce((acc, r) => acc.concat(r), []);
      const nCols = cols.length;
      const one = '(' + Array(nCols).fill('?').join(',') + ')';
      await db.pool.query(
        `INSERT INTO ${table} (${cols.map(c => '`' + c + '`').join(',')}) VALUES ` + chunk.map(() => one).join(',') + ' ON DUPLICATE KEY UPDATE ' + updates,
        flat);
    } else {
      log('DRY', table, chunk.length, 'rows');
    }
  }
  log('upsert', table, rows.length);
}

(async () => {
  log('=== 迁移开始', DRY ? '(DRY-RUN)' : '', '===');
  const stats = { users: 0, purchases: 0, expenses: 0, todos: 0, projects: 0, images: 0, imgBytes: 0, imgFail: 0, docs: 0, logs: 0, refresh: 0, invites: 0, reports: 0 };

  // 1) 用户
  const usersResp = await getJSON('/api/mig/export?kind=users&token=' + encodeURIComponent(cfg.SERVICE_TOKEN));
  const users = usersResp.users || [];
  log('CF 用户数:', users.length);
  const userMap = {}; // username -> db id
  for (const u of users) {
    const d = u.data || {};
    if (!DRY) {
      await db.pool.query(
        `INSERT INTO users (username,password_hash,salt,hash_version,is_admin,invite_code,invite_type,bitable_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),salt=VALUES(salt),hash_version=VALUES(hash_version),bitable_json=VALUES(bitable_json)`,
        [u.username, d.passwordHash || '', d.salt || '', d.hashVersion || 1, u.username === 'admin' ? 1 : 0,
          d.inviteCode || null, d.inviteType || null, JSON.stringify(d.bitable || null),
          d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 19).replace('T', ' ') : null]);
      const row = await db.one('SELECT id FROM users WHERE username = ?', [u.username]);
      userMap[u.username] = row.id;
    } else userMap[u.username] = 0;
    stats.users++;
  }

  // 2) 邀请码 / refresh / 日志
  const invitesResp = await getJSON('/api/mig/export?kind=invites&token=' + encodeURIComponent(cfg.SERVICE_TOKEN));
  const invRows = (invitesResp.codes || []).map(c => [c.code, c.createdBy || 'admin', c.used ? 1 : 0,
    c.usedAt ? new Date(c.usedAt).toISOString().slice(0, 19).replace('T', ' ') : null]);
  if (invRows.length) await upsert('invites', ['code', 'created_by', 'used', 'used_at'], invRows, 'code');
  stats.invites = invRows.length;

  const refResp = await getJSON('/api/mig/export?kind=refreshes&token=' + encodeURIComponent(cfg.SERVICE_TOKEN));
  for (const r of refResp.rows || []) {
    const uid = userMap[r.username];
    if (!uid) continue;
    if (!DRY) await db.pool.query(
      `INSERT INTO refresh_tokens (user_id,token_hash,expires_at) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at)`,
      [uid, sha256(r.token), new Date(r.expiresAt).toISOString().slice(0, 19).replace('T', ' ')]);
    stats.refresh++;
  }

  const logsResp = await getJSON('/api/mig/export?kind=logs&token=' + encodeURIComponent(cfg.SERVICE_TOKEN));
  const logRows = (logsResp.rows || []).map(v => [
    (v.ts || '').slice(0, 10), v.username || '', v.action || '', v.details || '', v.ip || '',
    v.ts ? new Date(v.ts).toISOString().slice(0, 19).replace('T', ' ') : null]);
  if (logRows.length) await upsert('op_logs', ['log_date', 'username', 'action', 'detail', 'ip', 'created_at'], logRows, 'id');
  stats.logs = logRows.length;

  // 3) 每用户：记录 + 关联重映射 + 图片
  for (const u of users) {
    const username = u.username, uid = userMap[username];
    if (!uid) continue;
    const recResp = await getJSON('/api/mig/export?kind=records&user=' + encodeURIComponent(username) + '&token=' + encodeURIComponent(cfg.SERVICE_TOKEN));
    const rec = recResp.records;
    if (!rec) { log(username, '无 bitable，跳过'); continue; }

    const imgKeys = new Map(); // key -> source table label
    const purchaseMap = {}, projectMap = {};

    // purchases
    const pRows = (rec.purchases || []).map(r => {
      const f = r.fields || {};
      for (const k of collectImgRefs(fstr(f['图片']))) imgKeys.set(k, 'purchase');
      return [fstr(f['商品名称']) || '（无名）', fstr(f['平台']) || null, fstr(f['分类']) || null,
        fnum(f['单价']), fnum(f['数量']) || 1, fstr(f['状态']) || '待审批',
        fnum(f['日期']) || parseWhen(f['日期']), fstr(f['备注']) || null, fstr(f['图片']) || null,
        fstr(f['创建时间']) || null, fstr(f['审批时间']) || null, fstr(f['下单时间']) || null,
        fstr(f['到货时间']) || null, fstr(f['归档时间']) || null, fstr(f['评估摘要']) || null,
        fstr(f['购买理由']) || null, fstr(f['预算区间']) || null, fstr(f['取消原因']) || null,
        fstr(f['分期期数']) || '0', fnum(f['分期金额']), fstr(f['分期开始月']) || null,
        String(fnum(f['分期已还'])), fstr(f['极速']) === '1' ? 1 : 0, r.record_id];
    });
    if (pRows.length) {
      await upsert('purchases',
        ['name', 'platform', 'category', 'price', 'qty', 'status', 'date_ms', 'note', 'image_ref',
          'created_at_text', 'approved_at', 'ordered_at', 'arrived_at', 'archived_at', 'eval_summary',
          'buy_reason', 'budget_range', 'cancel_reason', 'installments', 'installment_amount',
          'installment_start', 'installment_paid', 'is_quick', 'ext_id', 'user_id'],
        pRows.map(r => r.concat(uid)), 'ext_id');
    }
    // 记录 ext_id→新 id 映射
    if (!DRY && pRows.length) {
      const rows2 = await db.query('SELECT id, ext_id FROM purchases WHERE user_id = ?', [uid]);
      for (const r of rows2) purchaseMap[r.ext_id] = 'rec_' + r.id;
    }
    stats.purchases += pRows.length;

    // projects
    const prRows = (rec.projects || []).map(r => {
      const f = r.fields || {};
      return [fstr(f['名称']) || '（无名）', fstr(f['描述']) || null,
        fnum(f['截止日期']) || parseWhen(f['截止日期']), fstr(f['截止日期ISO']) || null,
        fstr(f['状态']) || '进行中', fstr(f['颜色']) || null, fnum(f['进度']), fstr(f['父项目ID']) || null, r.record_id];
    });
    if (prRows.length) {
      await upsert('projects', ['name', 'description', 'due_ms', 'due_iso', 'status', 'color', 'progress', 'parent_id', 'ext_id', 'user_id'],
        prRows.map(r => r.concat(uid)), 'ext_id');
      const rows2 = await db.query('SELECT id, ext_id FROM projects WHERE user_id = ?', [uid]);
      for (const r of rows2) projectMap[r.ext_id] = 'rec_' + r.id;
    }
    stats.projects += prRows.length;
    // 父项目重映射
    for (const r of prRows) if (r[7] && projectMap[r[7]]) {
      if (!DRY) await db.exec('UPDATE projects SET parent_id = ? WHERE user_id = ? AND ext_id = ?', [projectMap[r[7]], uid, r[8]]);
    }

    // expenses
    const eRows = (rec.expenses || []).map(r => {
      const f = r.fields || {};
      for (const k of collectImgRefs(fstr(f['图片']))) imgKeys.set(k, 'expense');
      const img = fstr(f['图片']);
      return [fstr(f['类型']) || '支出', fnum(f['金额']), fstr(f['分类']) || null,
        fnum(f['日期']) || parseWhen(f['日期']), fstr(f['备注']) || null, img || null,
        fnum(f['分摊周数']) || null, fstr(f['分摊开始周']) || null, r.record_id];
    });
    if (eRows.length) await upsert('expenses',
      ['type', 'amount', 'category', 'date_ms', 'note', 'image_ref', 'split_weeks', 'split_start_week', 'ext_id', 'user_id'],
      eRows.map(r => r.concat(uid)), 'ext_id');
    stats.expenses += eRows.length;

    // todos（最后：需要 purchaseMap/projectMap 已建好）
    const tRows = (rec.todos || []).map(r => {
      const f = r.fields || {};
      for (const k of collectImgRefs(fstr(f['图片']))) imgKeys.set(k, 'todo');
      const linkId = fstr(f['关联ID']);
      return [fstr(f['标题']) || '（无标题）', fstr(f['描述']) || null,
        fnum(f['截止日期']) || parseWhen(f['截止日期']), fstr(f['截止日期ISO']) || null,
        fstr(f['优先级']) || '中', fstr(f['分类']) || '其他', fstr(f['状态']) || '待办',
        fstr(f['重复']) || '无', fstr(f['子任务']) || '[]', fstr(f['图片']) || null,
        fstr(f['关联类型']) || '无', linkId || null, fnum(f['完成时间']) || null,
        fstr(f['项目ID']) || null, fstr(f['标签']) || null, fnum(f['排序']), fstr(f['提醒']) || null, r.record_id];
    });
    if (tRows.length) await upsert('todos',
      ['title', 'description', 'due_ms', 'due_iso', 'priority', 'category', 'status', 'repeat', 'subtasks', 'image_ref', 'link_type', 'link_id', 'completed_ms', 'project_id', 'tags', 'sort_no', 'reminders', 'ext_id', 'user_id'],
      tRows.map(r => r.concat(uid)), 'ext_id');
    // 关联重映射
    for (const r of tRows) {
      if (!DRY) {
        const oldLink = r[11], newLink = oldLink && purchaseMap[oldLink];
        if (newLink) await db.exec('UPDATE todos SET link_id = ? WHERE user_id = ? AND ext_id = ?', [newLink, uid, r[17]]);
        const oldPr = r[13], newPr = oldPr && projectMap[oldPr];
        if (newPr) await db.exec('UPDATE todos SET project_id = ? WHERE user_id = ? AND ext_id = ?', [newPr, uid, r[17]]);
      }
    }
    stats.todos += tRows.length;

    // 图片落盘
    for (const [key] of imgKeys) {
      try {
        const img = await getJSON('/api/mig/export?kind=img&key=' + encodeURIComponent(key) + '&token=' + encodeURIComponent(cfg.SERVICE_TOKEN));
        if (!img.ok) { stats.imgFail++; continue; }
        const buf = Buffer.from(img.base64, 'base64');
        if (!DRY) {
          const dir = IMG.safeUserDir(username);
          fs.mkdirSync(dir, { recursive: true });
          await fs.promises.writeFile(path.join(dir, key), buf);
          await db.pool.query(
            'INSERT INTO images (user_id,file_key,mime,size_bytes) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE size_bytes=VALUES(size_bytes),mime=VALUES(mime)',
            [uid, key, img.contentType || 'image/jpeg', buf.length]);
        }
        stats.images++; stats.imgBytes += buf.length;
      } catch (e) { stats.imgFail++; log('IMG FAIL', username, key, e.message); }
    }
    log(username, ': p', pRows.length, 'e', eRows.length, 't', tRows.length, 'pr', prRows.length, 'img', imgKeys.size);
  }

  // 4) 文档类：budgets/recurring/cats/webpush/reports
  const docsResp = await getJSON('/api/mig/export?kind=docs&token=' + encodeURIComponent(cfg.SERVICE_TOKEN));
  const docs = docsResp.docs || {};
  for (const [field, table, empty] of [['budget', 'budgets', '{}'], ['recurring', 'recurring', '{"items":[]}'], ['cats', 'cats', '{"list":[]}']]) {
    for (const [username, data] of Object.entries(docs[field] || {})) {
      const uid = userMap[username]; if (!uid) continue;
      if (!DRY) await db.pool.query(
        `INSERT INTO ${table} (user_id,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)`,
        [uid, JSON.stringify(data || JSON.parse(empty))]);
      stats.docs++;
    }
  }
  for (const [username, sub] of Object.entries(docs.webpush || {})) {
    const uid = userMap[username]; if (!uid) continue;
    const endpoint = sub && sub.subscription && sub.subscription.endpoint;
    if (!DRY && endpoint) await db.pool.query(
      'INSERT INTO push_subs (user_id,endpoint,data) VALUES (?,?,?) ON DUPLICATE KEY UPDATE endpoint=VALUES(endpoint),data=VALUES(data)',
      [uid, endpoint, JSON.stringify(sub)]);
  }
  for (const [username, rep] of Object.entries(docs.reports || {})) {
    const uid = userMap[username]; if (!uid || !rep) continue;
    if (!DRY) {
      const ga = new Date(rep.generatedAt || Date.now()).toISOString().slice(0, 19).replace('T', ' ');
      await db.pool.query(
        `INSERT INTO reports (user_id,period,rtype,data,generated_at) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE data=VALUES(data), generated_at=VALUES(generated_at)`,
        [uid, rep.period || 'weekly', rep.period === 'monthly' ? 'month' : 'week', JSON.stringify(rep), ga]);
    }
    stats.reports++;
  }

  // 5) 对账汇总
  log('=== 迁移统计 ===');
  log(JSON.stringify(stats, null, 2));
  if (!DRY) {
    const dbStats = await db.query(`SELECT
      (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM purchases) purchases,
      (SELECT COUNT(*) FROM expenses) expenses,(SELECT COUNT(*) FROM todos) todos,
      (SELECT COUNT(*) FROM projects) projects,(SELECT COUNT(*) FROM images) images,
      (SELECT COALESCE(SUM(price*qty),0) FROM purchases) buy_total,
      (SELECT COALESCE(SUM(CASE WHEN type='支出' THEN amount ELSE 0 END),0) FROM expenses) exp_total`);
    log('DB 汇总:', JSON.stringify(dbStats[0]));
    // 抽样金额对比（CF 侧在 records 里已拉全，简单核对行数即可）
    const diff = (['purchases', 'expenses', 'todos', 'projects']).map(t => t + ':' + stats[t]).join(' ');
    log('源侧行数:', diff);
  }
  log('=== 完成 ===');
  process.exit(0);
})().catch(e => { console.error('MIGRATE CRASH:', e); process.exit(1); });
