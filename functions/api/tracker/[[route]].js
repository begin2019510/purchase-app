import { mysqlMode, proxyToServer } from '../_proxy.js';
import { getCorsHeaders, jsonResponse } from '../_auth.js';

// /api/tracker/* —— 长期跟踪项目：记录 CRUD、仪表盘汇总、里程碑勾选、结项/重开。
// 仅 MySQL 后端；catch-all 覆盖 /api/tracker 本体与任意子路径（路径参数路由必须整段转发）。
export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  if (!mysqlMode(env)) {
    return jsonResponse({ error: '跟踪项目需要 DATA_BACKEND=mysql' }, 501, corsHeaders);
  }
  return proxyToServer(request, env, corsHeaders);
}
