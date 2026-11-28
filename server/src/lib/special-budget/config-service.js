'use strict';
// 特殊预算 v3.2.1：年度上限修改（唯一可配置项）
// 规则：只能改年度上限；调低不得低于已占用/未来承诺；历史年份只读；必须同账号二次确认 + 理由；
//       每次修改新增一条规则版本（旧行只写 effective_to，不删除），并写 config_update 审计事件。
const db = require('../../db');
const R = require('./rules');
const T = require('./time');
const audit = require('./audit');
const idem = require('./idempotency');
const { BizError } = require('./errors');
const A = require('./approvals');

function qall(conn, sql, params) { return conn.query(sql, params).then(r => r[0]); }
function qone(conn, sql, params) { return qall(conn, sql, params).then(r => r[0] || null); }

function historyView(r) {
  const base = R.configView(r);
  if (!base) return null;
  return Object.assign(base, {
    id: Number(r.id),
    changed_by: r.changed_by,
    change_reason: r.change_reason,
    created_at: T.bjDateTime(r.created_at),
  });
}

function maxVersion(rows, year) {
  let max = 0;
  for (const r of rows) {
    const m = /-v(\d+)$/.exec(String(r.rule_version || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max || rows.length;
}

async function getHistory(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2026 || y > 2100) {
    throw new BizError('INVALID_YEAR', 'year 需为 2026..2100 的整数', 400);
  }
  const rows = await db.query(
    'SELECT * FROM special_budget_rules WHERE year = ? ORDER BY effective_from ASC, id ASC', [y]);
  return rows.map(historyView);
}

async function updateConfig(opts) {
  const o = opts || {};
  const username = String(o.username == null ? '' : o.username).trim();
  if (!username || username.length > 64) throw new BizError('INVALID_USER', '用户无效', 400);
  const now = o.now instanceof Date ? o.now : new Date();
  const bj = R.beijingParts(now);
  const year = Number(o.year);
  const newCap = Number(o.annualCap);
  const reason = o.reason == null ? '' : String(o.reason).trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new BizError('INVALID_REASON', '修改理由必填且不超过 500 字', 400);
  }

  // 先用零占用做年份/金额校验，保证错误码稳定（实际占用在事务内加锁后重算）
  const early = R.validateConfigChange({ year, newCap: newCap, currentYear: bj.year });
  if (!early.ok) throw new BizError(early.code, early.message, 400, early);
  if (o.secondConfirm !== true) {
    throw new BizError('SECOND_CONFIRM_REQUIRED', '修改年度上限需要同一账号二次确认', 428);
  }

  const requestHash = idem.hash({ year, newCap: R.round2(newCap), reason, secondConfirm: true });
  return idem.run({ username, scope: 'config.update', key: o.idemKey, requestHash }, async conn => {
    await qall(conn, 'SELECT id FROM special_budget_rules WHERE year = ? ORDER BY id FOR UPDATE', [year]);
    const rows = await qall(conn,
      'SELECT * FROM special_budget_rules WHERE year = ? ORDER BY effective_from ASC, id ASC', [year]);
    const current = rows[rows.length - 1] || null;
    const committed = await A.committedForYear(conn, year);

    const checked = R.validateConfigChange({
      year, newCap, currentYear: bj.year,
      paid: 0, approvedUnpaid: 0,
      installmentPlan: committed, futureCommitments: committed,
      config: current ? R.configView(current) : { saturday_rate: 0.10 },
    });
    if (!checked.ok) throw new BizError(checked.code, checked.message, 400, checked);

    const nowStr = T.bjDateTime(now);
    // 试运行前（如 11 月）改 12 月配置时，now 早于现有生效日：
    // 新区间从两者较晚者开始，避免出现 effective_to < effective_from 的倒挂区间。
    const oldFromStr = current ? T.bjDateTime(current.effective_from) : null;
    const startStr = oldFromStr && oldFromStr > nowStr ? oldFromStr : nowStr;
    const version = `${year}-v${maxVersion(rows, year) + 1}`;
    let inserted;
    if (current) {
      await conn.query('UPDATE special_budget_rules SET effective_to = ? WHERE id = ?', [startStr, current.id]);
      const [r] = await conn.query(
        `INSERT INTO special_budget_rules
           (year, annual_cap, monthly_regular_cap, saturday_rate, large_threshold, cross_year_allowed,
            effective_from, effective_to, rule_version, changed_by, change_reason)
         VALUES (?,?,?,?,?,?,?,NULL,?,?,?)`,
        [year, R.round2(newCap), current.monthly_regular_cap, current.saturday_rate,
          current.large_threshold, current.cross_year_allowed, startStr, version, username, reason]);
      inserted = Number(r.insertId);
    } else {
      const crossYear = year >= 2027 ? 1 : 0;
      const [r] = await conn.query(
        `INSERT INTO special_budget_rules
           (year, annual_cap, monthly_regular_cap, saturday_rate, large_threshold, cross_year_allowed,
            effective_from, effective_to, rule_version, changed_by, change_reason)
         VALUES (?,?,800.00,0.1000,800.00,?,?,NULL,?,?,?)`,
        [year, R.round2(newCap), crossYear, startStr, version, username, reason]);
      inserted = Number(r.insertId);
    }

    const row = await qone(conn, 'SELECT * FROM special_budget_rules WHERE id = ?', [inserted]);
    const all = await qall(conn,
      'SELECT * FROM special_budget_rules WHERE year = ? ORDER BY effective_from ASC, id ASC', [year]);
    await audit.appendEvent(conn, {
      approvalId: null, eventType: 'config_update', amount: R.round2(newCap),
      actor: username, at: now, ip: o.ip, reason,
      before: current ? historyView(current) : null,
      after: { year, config: historyView(row), floor: checked.floor, occupied: checked.occupied },
      ruleVersion: version,
    });
    return {
      status: 200,
      body: {
        ok: true,
        year,
        config: historyView(row),
        history: all.map(historyView),
        calculation: {
          floor: checked.floor,
          occupied: checked.occupied,
          future_commitments: checked.future_commitments,
          saturday_cap: checked.saturday_cap,
          rule_version: version,
        },
      },
      resourceId: inserted,
    };
  });
}

module.exports = { updateConfig, getHistory, historyView };
