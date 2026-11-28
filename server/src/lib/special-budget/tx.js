'use strict';
// 事务封装：所有审批/付款/退款/配置写入必须走这里，保证同提交/同回滚。
const db = require('../../db');

// 死锁/锁等待超时自动重试：不同写路径的历史锁顺序不完全一致
// （审批：年度规则 → 审批单；资金：审批单 → 年度规则），高并发下可能互相等待。
// 统一顺序风险较大，这里按 MySQL 官方建议整笔回滚后重试，重试只在事务内生效。
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const MAX_TRIES = 3;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withTransaction(fn) {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const conn = await db.pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (e) {
      lastErr = e;
      try { await conn.rollback(); } catch (rollbackErr) { /* 保留原始错误 */ }
      if (!(e && RETRYABLE.has(e.code)) || attempt === MAX_TRIES - 1) throw e;
      // 指数退避 + 抖动，避免重试同时撞车
      await sleep(20 * Math.pow(2, attempt) + Math.floor(Math.random() * 20));
    } finally {
      conn.release();
    }
  }
  throw lastErr;
}

module.exports = { withTransaction };
