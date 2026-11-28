'use strict';
// 追加式审计：事件只增不改不删；与业务写入同一事务，写日志失败则整笔回滚。
const db = require('../../db');
const T = require('./time');

async function appendEvent(conn, ev) {
  if (!conn || typeof conn.query !== 'function') throw new Error('appendEvent 需要事务连接');
  const at = T.bjDateTime(ev.at instanceof Date ? ev.at : new Date(), true);
  const [r] = await conn.query(
    `INSERT INTO special_budget_events
       (approval_id, order_id, schedule_id, event_type, amount, actor, at, ip, reason,
        before_json, after_json, rule_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ev.approvalId == null ? null : ev.approvalId,
      ev.orderId == null ? null : ev.orderId,
      ev.scheduleId == null ? null : ev.scheduleId,
      String(ev.eventType || '').slice(0, 20),
      ev.amount == null ? null : Number(ev.amount),
      String(ev.actor || 'unknown').slice(0, 64),
      at,
      ev.ip ? String(ev.ip).slice(0, 45) : null,
      ev.reason ? String(ev.reason).slice(0, 500) : null,
      ev.before == null ? null : JSON.stringify(ev.before),
      ev.after == null ? null : JSON.stringify(ev.after),
      ev.ruleVersion ? String(ev.ruleVersion).slice(0, 20) : null,
    ]);
  return Number(r.insertId);
}

function parseJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { return v; }
  }
  return v;
}

function eventView(r) {
  return {
    id: Number(r.id),
    approval_id: r.approval_id == null ? null : Number(r.approval_id),
    order_id: r.order_id == null ? null : Number(r.order_id),
    schedule_id: r.schedule_id == null ? null : Number(r.schedule_id),
    event_type: r.event_type,
    amount: r.amount == null ? null : Number(r.amount),
    actor: r.actor,
    at: T.bjDateTime(r.at, true),
    ip: r.ip,
    reason: r.reason,
    before: parseJson(r.before_json),
    after: parseJson(r.after_json),
    rule_version: r.rule_version,
  };
}

async function listEvents(approvalId) {
  const rows = await db.query(
    'SELECT * FROM special_budget_events WHERE approval_id = ? ORDER BY at ASC, id ASC',
    [approvalId]);
  return rows.map(eventView);
}

module.exports = { appendEvent, listEvents, eventView };
