'use strict';
// 特殊预算 v3.2.1 服务层测试（只操作 purchase_app_test 隔离库）
// 覆盖：申请窗口/月度 800/周六追加/年度上限/大额分期与跨年/二次确认/并发超额/
//       配置修改（二次确认+理由+不低于占用+历史只读+版本+审计）/幂等/关联采购单/审计失败回滚/过期
// 用法: PURCHASE_DB_NAME=purchase_app_test node server/test/special-budget-approvals.test.js
process.env.PURCHASE_DB_NAME = 'purchase_app_test';
process.env.PURCHASE_SPECIAL_BUDGET = '1';

const path = require('path');
const { spawnSync } = require('child_process');
const cfg = require('../src/config');
const db = require('../src/db');
const tx = require('../src/lib/special-budget/tx');
const audit = require('../src/lib/special-budget/audit');
const A = require('../src/lib/special-budget/approvals');
const C = require('../src/lib/special-budget/config-service');
const S = require('../src/lib/special-budget/summary');

const U = 'sb_svc_test';
const U2 = 'sb_svc_other';
const ROOT = path.join(__dirname, '..');

let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok', name); }
  else { console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); process.exitCode = 1; }
}
function at(s) { return new Date(s + (s.length === 16 ? ':00+08:00' : '+08:00')); }

async function err(fn) {
  try { await fn(); return { none: true }; }
  catch (e) { return { code: e.code, status: e.status, message: e.message }; }
}
function isErr(r, code) {
  return !r.none && (code === undefined || r.code === code);
}

function migrateApply() {
  const r = spawnSync(process.execPath, ['scripts/migrate-special-budget.js', '--apply'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PURCHASE_DB_NAME: 'purchase_app_test' }),
    encoding: 'utf8',
    timeout: 60000,
  });
  if (r.status !== 0) throw new Error('migrate failed: ' + ((r.stdout || '') + (r.stderr || '')));
}

async function fresh() {
  for (const t of ['special_budget_idempotency', 'special_budget_events', 'special_budget_schedules',
    'special_budget_links', 'special_budget_approvals', 'special_budget_snapshots', 'special_budget_rules']) {
    await db.exec(`DELETE FROM ${t}`);
  }
  migrateApply();
}

async function committed(year) {
  return tx.withTransaction(conn => A.committedForYear(conn, year));
}
async function addYearConfig(year, cap, extra) {
  const e = extra || {};
  await db.exec(
    `INSERT INTO special_budget_rules
       (year, annual_cap, monthly_regular_cap, saturday_rate, large_threshold, cross_year_allowed,
        effective_from, rule_version, changed_by, change_reason)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [year, cap, e.monthly || 800, e.rate == null ? 0.1 : e.rate, e.threshold || 800,
      e.crossYear == null ? 1 : e.crossYear, `${year}-01-01 00:00:00`, `${year}-v1`,
      'test:seed', '测试年度配置']);
}
async function submit(type, amount, when, extra) {
  return A.submit(Object.assign({
    username: U, type, amount, purpose: '单测用途', installments: 1,
    now: at(when), idemKey: `k-${Math.random().toString(36).slice(2, 12)}`,
  }, extra || {}));
}
async function approve(id, when, extra) {
  return A.approve(Object.assign({
    username: U, id, now: at(when),
    idemKey: `k-${Math.random().toString(36).slice(2, 12)}`,
  }, extra || {}));
}
async function count(table) {
  const r = await db.one(`SELECT COUNT(*) AS c FROM ${table}`);
  return Number(r.c);
}

(async () => {
  if (!cfg.SERVICE_TOKEN) {
    console.error('FAIL 缺少 SERVICE_TOKEN');
    process.exit(1);
  }
  let createdUsers = [];
  try {
    // ================= 1. 普通申请：提交→幂等→批准→单期计划→汇总→审计 =================
    await fresh();
    const sub = await submit('normal', 300, '2026-12-01T10:00');
    ok('普通申请 300 → 201 pending', sub.status === 201 && sub.body.approval.status === 'pending' &&
      sub.body.approval.requested_amount === 300, JSON.stringify(sub.body));
    ok('申请当月有效（到期=2026-12-31 23:59:59）',
      sub.body.approval.expires_at === '2026-12-31 23:59:59', sub.body.approval.expires_at);
    ok('普通申请 installments=1 / first 2026-12', sub.body.approval.installments === 1 &&
      sub.body.approval.first_year === 2026 && sub.body.approval.first_month === 12);

    const replayKey = 'idem-normal-300';
    const s1 = await submit('normal', 300, '2026-12-01T10:00', { idemKey: replayKey });
    const s2 = await submit('normal', 300, '2026-12-01T10:00', { idemKey: replayKey });
    ok('同键同参 → 重放同一审批单', s2.replayed === true && s2.status === 201 &&
      s2.body.approval.id === s1.body.approval.id, JSON.stringify(s2.body));
    const conflict = await err(() => submit('normal', 301, '2026-12-01T10:00', { idemKey: replayKey }));
    ok('同键换参数 → 409 IDEMPOTENCY_CONFLICT', isErr(conflict, 'IDEMPOTENCY_CONFLICT') && conflict.status === 409,
      JSON.stringify(conflict));
    ok('幂等重放不产生重复审批', await count('special_budget_approvals') === 2, `实际 ${await count('special_budget_approvals')}`);

    const id = sub.body.approval.id;
    const appr = await approve(id, '2026-12-01T10:05', { idemKey: 'idem-appr-1' });
    ok('批准 300 → 200 approved', appr.status === 200 && appr.body.approval.status === 'approved' &&
      appr.body.approval.approved_amount === 300, JSON.stringify(appr.body));
    ok('批准即生成 1 期计划（2026-12-31 / 300 / planned）',
      appr.body.schedules.length === 1 && appr.body.schedules[0].due_date === '2026-12-31' &&
      appr.body.schedules[0].amount === 300 && appr.body.schedules[0].status === 'planned',
      JSON.stringify(appr.body.schedules));
    ok('普通类型无需二次确认', appr.body.second_confirmed === false);
    ok('年度占用 = 300', await committed(2026) === 300, String(await committed(2026)));

    const again = await err(() => approve(id, '2026-12-01T10:06'));
    ok('重复批准 → NOT_PENDING 409', isErr(again, 'NOT_PENDING') && again.status === 409, JSON.stringify(again));

    const detail = await A.getApproval(U, id);
    ok('详情归属正确且含计划/计算', detail.approval.id === id && detail.schedules.length === 1 &&
      detail.calculation && detail.calculation.annual_cap === 1000, JSON.stringify(detail.calculation));
    const otherGet = await err(() => A.getApproval(U2, id));
    ok('他人查看 → 404', isErr(otherGet, 'APPROVAL_NOT_FOUND') && otherGet.status === 404);

    const evs = await A.getAudit(U, id);
    ok('审计事件 submit + approve', evs.events.map(e => e.event_type).join(',') === 'submit,approve',
      JSON.stringify(evs.events.map(e => e.event_type)));

    const sum = await S.getSummary(2026, 12);
    ok('汇总联动：月度常规已批 300 / 可批 500',
      sum.summary.monthly_regular_approved === 300 && sum.summary.monthly_regular_available === 500,
      JSON.stringify(sum.summary));
    ok('汇总联动：年度占用 300 / 剩余 700，审批 1 已批',
      sum.summary.annual_committed === 300 && sum.summary.annual_remaining === 700 &&
      sum.summary.approvals.approved === 1, JSON.stringify(sum.summary));

    // ================= 2. 月度 800 / 窗口 / 部分批准 =================
    await fresh();
    const big0 = await err(() => submit('normal', 801, '2026-12-01T09:00'));
    ok('单笔 >800 普通 → LARGE_REQUIRED', isErr(big0, 'LARGE_REQUIRED'), JSON.stringify(big0));
    let a = await submit('normal', 500, '2026-12-01T10:00');
    let ap = await approve(a.body.approval.id, '2026-12-01T10:05', { approvedAmount: 400 });
    ok('部分批准：申请 500 批准 400', ap.body.approval.approved_amount === 400 &&
      ap.body.schedules[0].amount === 400, JSON.stringify(ap.body.schedules));
    let b = await submit('normal', 400, '2026-12-01T10:10');
    await approve(b.body.approval.id, '2026-12-01T10:15');
    ok('本月常规累计 800', await committed(2026) === 800, String(await committed(2026)));
    const over = await err(() => submit('normal', 1, '2026-12-01T10:20'));
    ok('超过月度 800 → MONTHLY_CAP_EXCEEDED 400', isErr(over, 'MONTHLY_CAP_EXCEEDED') && over.status === 400,
      JSON.stringify(over));
    const win = await err(() => submit('normal', 10, '2026-12-02T10:00'));
    ok('非 1/15 号普通申请 → NOT_IN_WINDOW', isErr(win, 'NOT_IN_WINDOW'), JSON.stringify(win));
    const dec = await err(() => submit('normal', 10.001, '2026-12-15T10:00'));
    ok('三位小数 → INVALID_AMOUNT', isErr(dec, 'INVALID_AMOUNT'), JSON.stringify(dec));
    const inst = await err(() => submit('normal', 10, '2026-12-15T10:00', { installments: 2 }));
    ok('普通申请分期 → INVALID_INSTALLMENTS', isErr(inst, 'INVALID_INSTALLMENTS'), JSON.stringify(inst));

    // ================= 3. 周六追加：前置/单日上限/不占 800 =================
    await fresh();
    const early = await err(() => submit('additional', 50, '2026-12-05T10:00'));
    ok('800 未批完先申请周六追加 → MONTHLY_NOT_FULLY_APPROVED',
      isErr(early, 'MONTHLY_NOT_FULLY_APPROVED'), JSON.stringify(early));
    for (const [amt, t] of [[500, '2026-12-01T09:00'], [300, '2026-12-01T09:10']]) {
      const x = await submit('normal', amt, t);
      await approve(x.body.approval.id, t);
    }
    const add1 = await submit('additional', 50, '2026-12-05T10:00');
    ok('周六追加 50 提交成功', add1.status === 201 && add1.body.approval.type === 'additional');
    await approve(add1.body.approval.id, '2026-12-05T10:05');
    const addOver = await err(() => submit('additional', 51, '2026-12-05T10:10'));
    ok('周六单日超 100（2026 上限×10%）→ SATURDAY_CAP_EXCEEDED',
      isErr(addOver, 'SATURDAY_CAP_EXCEEDED'), JSON.stringify(addOver));
    const sunday = await err(() => submit('additional', 10, '2026-12-06T10:00'));
    ok('周日追加 → NOT_IN_WINDOW', isErr(sunday, 'NOT_IN_WINDOW'), JSON.stringify(sunday));
    ok('周六追加不占月度 800（年度 = 850）', await committed(2026) === 850, String(await committed(2026)));
    const sum3 = await S.getSummary(2026, 12);
    ok('汇总：月度常规仍 800 / 周六追加 50',
      sum3.summary.monthly_regular_approved === 800 && sum3.summary.monthly_additional_approved === 50,
      JSON.stringify(sum3.summary));

    // ================= 4. 大额 2026：阈值/不跨年/二次确认 =================
    await fresh();
    const small = await err(() => submit('large', 800, '2026-12-15T10:00'));
    ok('大额 800（未超过阈值）→ LARGE_THRESHOLD_NOT_MET', isErr(small, 'LARGE_THRESHOLD_NOT_MET'),
      JSON.stringify(small));
    const cross = await err(() => submit('large', 900, '2026-12-15T10:00', { installments: 2 }));
    ok('2026 大额分期 2 期 → CROSS_YEAR_NOT_ALLOWED', isErr(cross, 'CROSS_YEAR_NOT_ALLOWED'),
      JSON.stringify(cross));
    const badWin = await err(() => submit('large', 900, '2026-12-14T10:00'));
    ok('大额非窗口日 → NOT_IN_WINDOW', isErr(badWin, 'NOT_IN_WINDOW'), JSON.stringify(badWin));

    const l1 = await submit('large', 900, '2026-12-15T10:00');
    const noConfirm = await err(() => approve(l1.body.approval.id, '2026-12-15T10:05'));
    ok('大额未二次确认 → 428 SECOND_CONFIRM_REQUIRED',
      isErr(noConfirm, 'SECOND_CONFIRM_REQUIRED') && noConfirm.status === 428, JSON.stringify(noConfirm));
    ok('二次确认失败不落计划，审批仍 pending',
      await count('special_budget_schedules') === 0 &&
      (await A.getApproval(U, l1.body.approval.id)).approval.status === 'pending');
    const l1ok = await approve(l1.body.approval.id, '2026-12-15T10:06', { secondConfirm: true });
    ok('大额 900 二次确认后批准', l1ok.status === 200 && l1ok.body.second_confirmed === true &&
      l1ok.body.approval.second_confirmed_by === U && l1ok.body.schedules.length === 1,
      JSON.stringify(l1ok.body.approval));
    ok('大额占用年度 900', await committed(2026) === 900, String(await committed(2026)));

    // ================= 5. 2027 大额 8000/24：7/12/5 分段、跨年、不占 800 =================
    await fresh();
    await addYearConfig(2028, 10000);
    await addYearConfig(2029, 10000);
    const big1 = await submit('large', 8000, '2027-06-15T10:00', { installments: 24 });
    const segs = big1.body.calculation.schedule.segments;
    ok('8000/24 分段 = 7/12/5（2027/2028/2029）',
      segs.length === 3 && segs.map(s => `${s.year}:${s.count}`).join(',') === '2027:7,2028:12,2029:5',
      JSON.stringify(segs));
    ok('分段金额合计 = 8000',
      Math.round(segs.reduce((s, x) => s + x.amount, 0) * 100) === 800000, JSON.stringify(segs));
    const bigAp = await approve(big1.body.approval.id, '2027-06-15T10:05', { secondConfirm: true });
    ok('2027 跨年分期批准 → 24 期计划', bigAp.status === 200 && bigAp.body.schedules.length === 24);
    ok('首期 2027-06-30 / 末期 2029-05-31，尾期吸收尾差',
      bigAp.body.schedules[0].due_date === '2027-06-30' &&
      bigAp.body.schedules[23].due_date === '2029-05-31' &&
      bigAp.body.schedules[23].amount === 333.41, JSON.stringify(bigAp.body.schedules.slice(-1)));
    ok('按年占用 2027=2333.31 / 2028=3999.96 / 2029=1666.73',
      await committed(2027) === 2333.31 && await committed(2028) === 3999.96 &&
      await committed(2029) === 1666.73,
      `${await committed(2027)}/${await committed(2028)}/${await committed(2029)}`);
    const n1 = await submit('normal', 100, '2027-07-15T10:00');
    const n1ap = await approve(n1.body.approval.id, '2027-07-15T10:05');
    ok('大额不占月度 800：同月普通 100 可批', n1ap.status === 200, JSON.stringify(n1ap.body.calculation));
    const yearOver = await err(() => submit('large', 8000, '2027-07-01T10:00', { installments: 6 }));
    ok('2027 再加大额挤爆年度 → ANNUAL_EXCEEDED',
      isErr(yearOver, 'ANNUAL_EXCEEDED'), JSON.stringify(yearOver));

    // ================= 6. 未来年度未配置 → YEAR_CONFIG_MISSING =================
    await fresh();
    const noCfg = await err(() => submit('large', 900, '2027-12-15T10:00', { installments: 2 }));
    ok('跨到未配置的 2028 → YEAR_CONFIG_MISSING', isErr(noCfg, 'YEAR_CONFIG_MISSING'), JSON.stringify(noCfg));

    // ================= 7. 并发批准同一新年度：只能成功一笔 =================
    await fresh();
    await addYearConfig(2030, 10000);
    const p1 = await submit('large', 6000, '2030-01-01T10:00');
    const p2 = await submit('large', 6000, '2030-01-01T10:01');
    const results = await Promise.allSettled([
      approve(p1.body.approval.id, '2030-01-01T10:05', { secondConfirm: true }),
      approve(p2.body.approval.id, '2030-01-01T10:06', { secondConfirm: true }),
    ]);
    const okCount = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.find(r => r.status === 'rejected');
    ok('并发 6000+6000（上限 10000）只成功一笔', okCount === 1, JSON.stringify(results.map(r => r.status)));
    ok('另一笔 ANNUAL_EXCEEDED', fail && fail.reason && fail.reason.code === 'ANNUAL_EXCEEDED',
      fail && fail.reason && fail.reason.message);
    ok('年度占用 6000，计划只有 1 条', await committed(2030) === 6000 &&
      await count('special_budget_schedules') === 1, String(await committed(2030)));

    // ================= 8. 配置修改：二次确认/理由/下限/版本/审计/历史只读 =================
    await fresh();
    const noSec = await err(() => C.updateConfig({
      username: U, year: 2026, annualCap: 1200, reason: '上调', now: at('2026-12-02T10:00'),
    }));
    ok('改年度上限未二次确认 → 428', isErr(noSec, 'SECOND_CONFIRM_REQUIRED') && noSec.status === 428,
      JSON.stringify(noSec));
    const noReason = await err(() => C.updateConfig({
      username: U, year: 2026, annualCap: 1200, reason: ' ', secondConfirm: true, now: at('2026-12-02T10:00'),
    }));
    ok('缺理由 → INVALID_REASON', isErr(noReason, 'INVALID_REASON'), JSON.stringify(noReason));

    // 先占用 300，验证调低下限
    const occ = await submit('normal', 300, '2026-12-01T10:00');
    await approve(occ.body.approval.id, '2026-12-01T10:05');
    const tooLow = await err(() => C.updateConfig({
      username: U, year: 2026, annualCap: 299.99, reason: '调低', secondConfirm: true, now: at('2026-12-02T10:00'),
    }));
    ok('调低到 299.99 < 占用 300 → CONFIG_TOO_LOW', isErr(tooLow, 'CONFIG_TOO_LOW'), JSON.stringify(tooLow));
    const atFloor = await C.updateConfig({
      username: U, year: 2026, annualCap: 300, reason: '调到占用下限', secondConfirm: true, now: at('2026-12-02T10:00'),
    });
    ok('调到占用下限 300 允许', atFloor.status === 200 && atFloor.body.config.annual_cap === 300 &&
      atFloor.body.config.rule_version === '2026-v2', JSON.stringify(atFloor.body.config));
    const up = await C.updateConfig({
      username: U, year: 2026, annualCap: 1200, reason: '试运行上调', secondConfirm: true,
      now: at('2026-12-03T10:00'), idemKey: 'cfg-up-1',
    });
    ok('上调 1200 → 200 / 版本 2026-v3 / 周六上限 120',
      up.status === 200 && up.body.config.annual_cap === 1200 &&
      up.body.config.rule_version === '2026-v3' && up.body.calculation.saturday_cap === 120,
      JSON.stringify(up.body));
    const upReplay = await C.updateConfig({
      username: U, year: 2026, annualCap: 1200, reason: '试运行上调', secondConfirm: true,
      now: at('2026-12-03T10:00'), idemKey: 'cfg-up-1',
    });
    ok('配置修改幂等重放', upReplay.replayed === true && upReplay.body.config.rule_version === '2026-v3');
    const cfgConflict = await err(() => C.updateConfig({
      username: U, year: 2026, annualCap: 1300, reason: '试运行上调', secondConfirm: true,
      now: at('2026-12-03T10:00'), idemKey: 'cfg-up-1',
    }));
    ok('配置幂等键换参数 → 409', isErr(cfgConflict, 'IDEMPOTENCY_CONFLICT'), JSON.stringify(cfgConflict));

    const hist = await C.getHistory(2026);
    ok('历史：3 条版本，最新 effective_to 为空，旧版本已截止',
      hist.length === 3 && hist[2].annual_cap === 1200 && !hist[2].effective_to &&
      hist[1].annual_cap === 300 && !!hist[1].effective_to, JSON.stringify(hist));
    const cfgEv = await count("special_budget_events WHERE event_type = 'config_update'");
    ok('配置修改写审计事件（2 条）', cfgEv === 2, `实际 ${cfgEv}`);

    const readonly = await err(() => C.updateConfig({
      username: U, year: 2026, annualCap: 1500, reason: '回改历史', secondConfirm: true, now: at('2027-01-05T10:00'),
    }));
    ok('历史年份只读 → HISTORY_READONLY', isErr(readonly, 'HISTORY_READONLY'), JSON.stringify(readonly));
    const future = await C.updateConfig({
      username: U, year: 2028, annualCap: 5500, reason: '预置未来年度', secondConfirm: true, now: at('2027-01-05T10:00'),
    });
    ok('未来年度首次配置 → 2028-v1 / 5500 / 可跨年',
      future.status === 200 && future.body.config.rule_version === '2028-v1' &&
      future.body.config.annual_cap === 5500 && future.body.config.cross_year_allowed === 1,
      JSON.stringify(future.body.config));

    // ================= 9. 关联采购单 =================
    await fresh();
    const uRow = await db.one('SELECT id FROM users WHERE username = ?', [U]);
    let userId = uRow && uRow.id;
    if (!userId) {
      const ins = await db.exec(
        'INSERT INTO users (username, password_hash, salt, hash_version, is_admin) VALUES (?,?,?,1,0)',
        [U, '0'.repeat(64), '0'.repeat(32)]);
      userId = ins.insertId;
      createdUsers.push(U);
    }
    const u2Row = await db.one('SELECT id FROM users WHERE username = ?', [U2]);
    let user2Id = u2Row && u2Row.id;
    if (!user2Id) {
      const ins = await db.exec(
        'INSERT INTO users (username, password_hash, salt, hash_version, is_admin) VALUES (?,?,?,1,0)',
        [U2, '0'.repeat(64), '0'.repeat(32)]);
      user2Id = ins.insertId;
      createdUsers.push(U2);
    }
    const need = await db.exec(
      "INSERT INTO purchase_needs (user_id, name, status) VALUES (?,?,?)", [userId, '单测关联采购', '已定点']);
    const needId = need.insertId;
    async function addOrder(uid, price, status) {
      const r = await db.exec(
        `INSERT INTO purchase_orders
           (user_id, need_id, role, qty, price_paid, status, installments, installment_paid,
            is_quick, budget_type)
         VALUES (?,?, 'main', 1, ?, ?, 1, 0, 0, 'general')`,
        [uid, needId, price, status || '已到']);
      return r.insertId;
    }
    const oA = await addOrder(userId, 300);
    const oB = await addOrder(userId, 100);
    const oC = await addOrder(userId, 300);
    const oD = await addOrder(userId, 50);
    const oArch = await addOrder(userId, 50, '已归档');
    const oOther = await addOrder(user2Id, 50);

    const nsub = await submit('normal', 300, '2026-12-01T10:00');
    const napp = await approve(nsub.body.approval.id, '2026-12-01T10:05');
    const good = await A.linkOrder({
      username: U, id: napp.body.approval.id, orderId: oA, now: at('2026-12-02T10:00'),
      idemKey: 'link-good-1',
    });
    ok('关联采购单成功，剩余 0', good.status === 200 && good.body.linked_total === 300 &&
      good.body.remaining === 0, JSON.stringify(good.body));
    const orderRow = await db.one('SELECT budget_type, special_approval_id FROM purchase_orders WHERE id = ?', [oA]);
    ok('采购单标记 special + 审批 ID', orderRow.budget_type === 'special' &&
      Number(orderRow.special_approval_id) === napp.body.approval.id, JSON.stringify(orderRow));

    const exceed = await err(() => A.linkOrder({
      username: U, id: napp.body.approval.id, orderId: oB, now: at('2026-12-02T10:01'),
    }));
    ok('超出批准金额 → LINK_EXCEEDS_APPROVED 409',
      isErr(exceed, 'LINK_EXCEEDS_APPROVED') && exceed.status === 409, JSON.stringify(exceed));
    const dup = await err(() => A.linkOrder({
      username: U, id: napp.body.approval.id, orderId: oA, now: at('2026-12-02T10:02'),
    }));
    ok('同一单重复关联 → ORDER_ALREADY_SPECIAL', isErr(dup, 'ORDER_ALREADY_SPECIAL'), JSON.stringify(dup));
    const mismatch = await err(() => A.linkOrder({
      username: U, id: napp.body.approval.id, orderId: oC, amount: 200, now: at('2026-12-02T10:03'),
    }));
    ok('关联金额≠订单总额 → LINK_AMOUNT_MISMATCH', isErr(mismatch, 'LINK_AMOUNT_MISMATCH'), JSON.stringify(mismatch));
    const archived = await err(() => A.linkOrder({
      username: U, id: napp.body.approval.id, orderId: oArch, now: at('2026-12-02T10:04'),
    }));
    ok('已归档单 → ORDER_NOT_LINKABLE', isErr(archived, 'ORDER_NOT_LINKABLE'), JSON.stringify(archived));
    const others = await err(() => A.linkOrder({
      username: U, id: napp.body.approval.id, orderId: oOther, now: at('2026-12-02T10:05'),
    }));
    ok('他人采购单 → ORDER_NOT_FOUND', isErr(others, 'ORDER_NOT_FOUND'), JSON.stringify(others));
    const pendingSub = await submit('normal', 100, '2026-12-15T10:00');
    const pendingLink = await err(() => A.linkOrder({
      username: U, id: pendingSub.body.approval.id, orderId: oD, now: at('2026-12-15T10:05'),
    }));
    ok('pending 审批 → APPROVAL_NOT_APPROVED', isErr(pendingLink, 'APPROVAL_NOT_APPROVED'), JSON.stringify(pendingLink));
    const expiredLink = await err(() => A.linkOrder({
      username: U, id: napp.body.approval.id, orderId: oD, now: at('2027-01-01T00:00:01'),
    }));
    ok('审批过期后关联 → APPROVAL_EXPIRED', isErr(expiredLink, 'APPROVAL_EXPIRED'), JSON.stringify(expiredLink));
    const linkEvents = await count("special_budget_events WHERE event_type = 'link'");
    ok('关联写审计事件', linkEvents === 1, `实际 ${linkEvents}`);

    // ================= 10. 审计失败 → 整笔回滚 =================
    await fresh();
    const origAppend = audit.appendEvent;
    audit.appendEvent = async () => { throw new Error('audit down'); };
    const failed = await err(() => submit('normal', 300, '2026-12-01T10:00', { idemKey: 'rollback-submit' }));
    audit.appendEvent = origAppend;
    ok('审计写入失败 → submit 抛错且不落审批/幂等行',
      !failed.none && await count('special_budget_approvals') === 0 &&
      await count('special_budget_idempotency') === 0,
      JSON.stringify(failed));

    const okSub = await submit('normal', 300, '2026-12-01T10:00');
    audit.appendEvent = async () => { throw new Error('audit down'); };
    const failedAp = await err(() => approve(okSub.body.approval.id, '2026-12-01T10:05', { idemKey: 'rollback-appr' }));
    audit.appendEvent = origAppend;
    const afterFail = await A.getApproval(U, okSub.body.approval.id);
    ok('审计失败 → approve 回滚：仍 pending / 无计划 / 无幂等行',
      !failedAp.none && afterFail.approval.status === 'pending' &&
      afterFail.schedules.length === 0 &&
      await count("special_budget_idempotency WHERE idem_key = 'rollback-appr'") === 0,
      JSON.stringify({ failedAp, status: afterFail.approval.status }));
    const retry = await approve(okSub.body.approval.id, '2026-12-01T10:06');
    ok('恢复后可用原业务参数重新批准', retry.status === 200 && retry.body.approval.status === 'approved');

    // ================= 11. 过期处理 =================
    await fresh();
    const pend = await submit('normal', 300, '2026-12-01T10:00');
    const expired = await err(() => approve(pend.body.approval.id, '2027-01-01T00:00:01'));
    ok('跨月未批 → APPROVAL_EXPIRED 409', isErr(expired, 'APPROVAL_EXPIRED') && expired.status === 409,
      JSON.stringify(expired));
    const expDetail = await A.getApproval(U, pend.body.approval.id);
    const expAudit = await A.getAudit(U, pend.body.approval.id);
    ok('状态置 expired 且写 expire 事件',
      expDetail.approval.status === 'expired' &&
      expAudit.events.some(e => e.event_type === 'expire'), JSON.stringify(expAudit.events.map(e => e.event_type)));
    ok('过期不占年度', await committed(2026) === 0, String(await committed(2026)));

    // ================= 12. 驳回 / 取消 / 归属 =================
    await fresh();
    const rj = await submit('normal', 100, '2026-12-01T10:00');
    const rejectNoReason = await err(() => A.reject({ username: U, id: rj.body.approval.id, now: at('2026-12-01T10:05') }));
    ok('驳回缺理由 → INVALID_REASON', isErr(rejectNoReason, 'INVALID_REASON'), JSON.stringify(rejectNoReason));
    const rjOther = await err(() => A.reject({
      username: U2, id: rj.body.approval.id, reason: '不是我的', now: at('2026-12-01T10:05'),
    }));
    ok('他人驳回 → 404', isErr(rjOther, 'APPROVAL_NOT_FOUND') && rjOther.status === 404);
    const rjOk = await A.reject({
      username: U, id: rj.body.approval.id, reason: '预算不合规', now: at('2026-12-01T10:06'),
    });
    ok('驳回成功 → rejected', rjOk.status === 200 && rjOk.body.approval.status === 'rejected');
    const rjApprove = await err(() => approve(rj.body.approval.id, '2026-12-01T10:07'));
    ok('已驳回不能再批 → NOT_PENDING', isErr(rjApprove, 'NOT_PENDING'));

    const cn = await submit('normal', 100, '2026-12-01T10:00');
    const cnOk = await A.cancel({ username: U, id: cn.body.approval.id, now: at('2026-12-01T10:05') });
    ok('取消成功 → cancelled', cnOk.status === 200 && cnOk.body.approval.status === 'cancelled');
    const cnAudit = await A.getAudit(U, cn.body.approval.id);
    ok('取消事件含默认理由', cnAudit.events.some(e => e.event_type === 'cancel' && e.reason === '申请人取消'),
      JSON.stringify(cnAudit.events));

    // ================= 13. 列表 =================
    await fresh();
    await submit('normal', 100, '2026-12-01T10:00');
    await submit('normal', 100, '2026-12-15T10:00');
    const otherSub = await submit('normal', 100, '2026-12-01T10:00', { username: U2 });
    ok('他人申请存在', otherSub.status === 201);
    const list = await A.listApprovals(U, { year: 2026, month: 12 });
    ok('列表只返回本人且按时间倒序', list.approvals.length === 2 &&
      list.approvals.every(x => x.username === U) &&
      list.approvals[0].applied_at.indexOf('2026-12-15') === 0, JSON.stringify(list.approvals));
    const inv = await err(() => A.listApprovals(U, { year: 2026, month: 13 }));
    ok('非法月份 → INVALID_MONTH', isErr(inv, 'INVALID_MONTH'), JSON.stringify(inv));
  } catch (e) {
    console.error('FAIL', e && e.stack || e);
    process.exitCode = 1;
  } finally {
    try {
      for (const u of createdUsers) await db.exec('DELETE FROM users WHERE username = ?', [u]);
      if (createdUsers.length) {
        await db.exec('DELETE po FROM purchase_orders po LEFT JOIN users u ON u.id = po.user_id WHERE u.id IS NULL');
        await db.exec('DELETE pn FROM purchase_needs pn LEFT JOIN users u ON u.id = pn.user_id WHERE u.id IS NULL');
      }
      for (const t of ['special_budget_idempotency', 'special_budget_events', 'special_budget_schedules',
        'special_budget_links', 'special_budget_approvals', 'special_budget_snapshots', 'special_budget_rules']) {
        await db.exec(`DELETE FROM ${t}`);
      }
      migrateApply();
      await db.exec("UPDATE purchase_orders SET budget_type = 'general', special_approval_id = NULL WHERE budget_type <> 'general'");
    } catch (e) {
      console.error('cleanup failed:', e.message);
    }
    await db.pool.end();
  }

  console.log(`\n${passed} passed${process.exitCode ? '（有失败）' : ''}`);
})();
