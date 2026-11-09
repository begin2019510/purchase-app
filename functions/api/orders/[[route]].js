import { mysqlMode, proxyToServer } from '../_proxy.js';
import { getCorsHeaders, jsonResponse } from '../_auth.js';

// /api/orders/* —— 子单更新、状态流转、批量流转。
export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  if (!mysqlMode(env)) {
    return jsonResponse({ error: '采购新模块需要 DATA_BACKEND=mysql（飞书后端请回退旧版前端）' }, 501, corsHeaders);
  }
  return proxyToServer(request, env, corsHeaders);
}
