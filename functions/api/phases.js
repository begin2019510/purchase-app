// 阶段 API：转发到内网 purchase-server /api/phases
import { mysqlMode, proxyToServer } from './_proxy.js';
import { getCorsHeaders, jsonResponse } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  if (!mysqlMode(env)) {
    return jsonResponse({ error: '阶段功能需要 DATA_BACKEND=mysql' }, 501, corsHeaders);
  }
  return proxyToServer(request, env, corsHeaders);
}
