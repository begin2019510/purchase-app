'use strict';
// 事务封装：所有审批/付款/退款/配置写入必须走这里，保证同提交/同回滚。
const db = require('../../db');

async function withTransaction(fn) {
  const conn = await db.pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    try { await conn.rollback(); } catch (rollbackErr) { /* 保留原始错误 */ }
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { withTransaction };
