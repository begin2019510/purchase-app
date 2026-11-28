'use strict';
// 幂等：同 username + scope + key 只落一次成功响应；键被换 payload 复用则 409。
// 只缓存成功响应；失败（校验/权限/二次确认）不落幂等行，客户端可改参数重试。
const crypto = require('crypto');
const db = require('../../db');
const tx = require('./tx');
const { BizError } = require('./errors');

function canonical(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonical);
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (v[k] !== undefined) out[k] = canonical(v[k]);
  }
  return out;
}

function hash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

function validateKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,64}$/.test(key)) {
    throw new BizError('IDEMPOTENCY_KEY_REQUIRED', '必须提供 8~64 位幂等键（Idempotency-Key）', 400);
  }
  return key;
}

async function find(username, scope, key) {
  return db.one(
    'SELECT * FROM special_budget_idempotency WHERE username = ? AND scope = ? AND idem_key = ?',
    [username, scope, key]);
}

function replay(row, requestHash) {
  if (row.request_hash !== requestHash) {
    throw new BizError('IDEMPOTENCY_CONFLICT', '同一幂等键被用于不同请求参数', 409);
  }
  return {
    status: Number(row.status_code),
    body: JSON.parse(row.response_json),
    replayed: true,
    resourceId: row.resource_id == null ? null : Number(row.resource_id),
  };
}

// fn(conn) -> { status, body, resourceId? }；事务内先占幂等键，成功后写回响应。
async function run(opts, fn, attempt) {
  const o = opts || {};
  const tries = Number(attempt) || 0;
  if (!o.key) return tx.withTransaction(fn);
  validateKey(o.key);
  const existing = await find(o.username, o.scope, o.key);
  if (existing) return replay(existing, o.requestHash);

  try {
    return await tx.withTransaction(async conn => {
      let id;
      try {
        const [r] = await conn.query(
          `INSERT INTO special_budget_idempotency
             (username, scope, idem_key, request_hash, status_code, response_json, resource_id)
           VALUES (?,?,?,?,?,?,?)`,
          [o.username, o.scope, o.key, o.requestHash, 0, 'null', null]);
        id = Number(r.insertId);
      } catch (e) {
        if (e && e.code === 'ER_DUP_ENTRY') {
          const dup = new Error('idempotency duplicate');
          dup.idemDup = true;
          throw dup;
        }
        throw e;
      }
      const out = await fn(conn);
      if (!out || !Number.isInteger(out.status) || out.body === undefined) {
        throw new Error('幂等处理函数必须返回 { status, body }');
      }
      await conn.query(
        'UPDATE special_budget_idempotency SET status_code = ?, response_json = ?, resource_id = ? WHERE id = ?',
        [out.status, JSON.stringify(out.body), out.resourceId == null ? null : out.resourceId, id]);
      return out;
    });
  } catch (e) {
    if (e && e.idemDup) {
      // 并发同键：等赢家提交后读取其结果；若赢家回滚则重试一次
      const row = await find(o.username, o.scope, o.key);
      if (row) return replay(row, o.requestHash);
      if (tries < 1) return run(o, fn, tries + 1);
      throw new BizError('IDEMPOTENCY_RACE', '并发幂等键处理失败，请重试', 409);
    }
    throw e;
  }
}

module.exports = { hash, validateKey, find, run };
