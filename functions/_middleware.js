// 网关级屏蔽：仓库根就是 Pages 发布目录，服务端源码/构建脚本不能被公网直接读取
const BLOCK_PREFIXES = ['/server', '/android', '/cron-worker', '/docs', '/tests', '/functions'];
const BLOCK_FILES = new Set([
  '/db.json', '/package.json', '/package-lock.json', '/schema.sql',
  '/deploy.ps1', '/_debug_build.js', '/patch_dates.js', '/README.md',
  '/IMAGE_ARCH.md', '/SETUP-PUSH.md', '/capacitor.config.json',
  '/push-monthly.bat', '/theme.css.bak',
]);

export async function onRequest(context) {
  const path = new URL(context.request.url).pathname.replace(/\/+$/, '') || '/';
  if (BLOCK_FILES.has(path) || BLOCK_PREFIXES.some(p => path === p || path.startsWith(p + '/'))) {
    return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return context.next();
}
