'use strict';
// Cloudflare Pages Functions 接线测试（无需线上环境）
// 覆盖：特殊预算 catch-all 路由存在、CORS 放行 Idempotency-Key、
//       代理透传 Idempotency-Key/Authorization/X-Auth-User、OPTIONS 204、非 MySQL 501。
// 做法：把 functions/ 复制到临时目录并标记 "type":"module"，用动态 import 加载真实源码。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok', name); }
  else { console.error('  FAIL', name, detail === undefined ? '' : '→ ' + detail); process.exitCode = 1; }
}

async function main() {
  const root = path.join(__dirname, '..', '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-fn-'));
  fs.cpSync(path.join(root, 'functions'), path.join(tmp, 'functions'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module' }));

  const auth = await import(pathToFileURL(path.join(tmp, 'functions/api/_auth.js')).href);
  const proxy = await import(pathToFileURL(path.join(tmp, 'functions/api/_proxy.js')).href);
  const route = await import(pathToFileURL(path.join(tmp, 'functions/api/special-budget/[[route]].js')).href);

  // 1. CORS 预检
  const cors = auth.getCorsHeaders(new Request('https://121212121.top/api/special-budget/approvals', {
    headers: { Origin: 'https://121212121.top' },
  }));
  ok('CORS 放行 Idempotency-Key', /(^|,)\s*Idempotency-Key\s*(,|$)/.test(cors['Access-Control-Allow-Headers']), cors['Access-Control-Allow-Headers']);
  ok('CORS 保留 Authorization', cors['Access-Control-Allow-Headers'].includes('Authorization'));

  // 2. toServer 透传请求头（含幂等键）
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const req = new Request('https://example.com/api/special-budget/approvals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test.jwt.token',
        'Idempotency-Key': 'idem-abc-12345678',
      },
      body: JSON.stringify({ type: 'normal', amount: 100 }),
    });
    const res = await proxy.toServer(req, { SERVER_API_BASE: 'http://127.0.0.1:3500', SERVICE_TOKEN: 'svc' }, { username: 'alice' });
    ok('toServer 返回上游状态码', res.status === 200);
    ok('toServer 转发路径与查询', captured && captured.url === 'http://127.0.0.1:3500/api/special-budget/approvals', captured && captured.url);
    ok('toServer 透传 Idempotency-Key', captured.init.headers['Idempotency-Key'] === 'idem-abc-12345678');
    ok('toServer 透传 Authorization', captured.init.headers.Authorization === 'Bearer test.jwt.token');
    ok('toServer 注入 X-Auth-User', captured.init.headers['X-Auth-User'] === 'alice');
    ok('toServer 注入 X-Service-Token', captured.init.headers['X-Service-Token'] === 'svc');
    ok('toServer 转发请求体', Buffer.from(captured.init.body).toString() === '{"type":"normal","amount":100}');

    // 无幂等键时不伪造空头
    const req2 = new Request('https://example.com/api/special-budget/summary', { method: 'GET' });
    await proxy.toServer(req2, { SERVER_API_BASE: 'http://127.0.0.1:3500', SERVICE_TOKEN: 'svc' }, { username: 'alice' });
    ok('GET 不伪造 Idempotency-Key', !('Idempotency-Key' in captured.init.headers));
  } finally {
    globalThis.fetch = realFetch;
  }

  // 3. 路由本体
  const env = {
    DATA_BACKEND: 'mysql',
    SERVER_API_BASE: 'http://127.0.0.1:3500',
    SERVICE_TOKEN: 'svc',
    JWT_SECRET: 'test-secret',
    IMAGE_STORE: { get: async () => null },
  };

  const opt = await route.onRequest({
    request: new Request('https://121212121.top/api/special-budget/approvals', { method: 'OPTIONS' }),
    env,
  });
  ok('OPTIONS 返回 204', opt.status === 204, opt.status);
  ok('OPTIONS 放行 Idempotency-Key', /Idempotency-Key/.test(opt.headers.get('Access-Control-Allow-Headers') || ''));

  const noMysql = await route.onRequest({
    request: new Request('https://example.com/api/special-budget/summary', { method: 'GET' }),
    env: Object.assign({}, env, { DATA_BACKEND: 'feishu' }),
  });
  ok('非 MySQL 后端返回 501 JSON', noMysql.status === 501 && /json/.test(noMysql.headers.get('Content-Type') || ''), noMysql.status);

  const token = await auth.createJWT({ username: 'alice' }, env.JWT_SECRET, 1);
  let seen = null;
  const realFetch2 = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen = { url, init };
    return new Response('{"ok":true,"summary":{}}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const forwarded = await route.onRequest({
      request: new Request('https://121212121.top/api/special-budget/approvals', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': 'idem-route-1234' },
        body: '{}',
      }),
      env,
    });
    ok('路由把特殊预算请求反代到内网', forwarded.status === 200 && seen && seen.url === 'http://127.0.0.1:3500/api/special-budget/approvals', seen && seen.url);
    ok('路由全链路保留 Idempotency-Key', seen.init.headers['Idempotency-Key'] === 'idem-route-1234');
    ok('路由用 JWT 用户名覆盖 X-Auth-User', seen.init.headers['X-Auth-User'] === 'alice');
  } finally {
    globalThis.fetch = realFetch2;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 4. 防止未来删掉路由文件（SPA 回退会静默返回 HTML）
  ok('特殊预算 catch-all 路由文件存在', fs.existsSync(path.join(root, 'functions/api/special-budget/[[route]].js')));

  console.log(`\ncloudflare-special-budget-proxy: ${passed} passed`);
}

main().catch(e => { console.error('FAIL', e); process.exit(1); });
