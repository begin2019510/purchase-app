import { mysqlMode, proxyToServer } from '../_proxy.js';
import { getCorsHeaders, jsonResponse } from '../_auth.js';

// /api/needs/* —— 两级模型：需求 CRUD、供应商挂载、子单创建、定点/回退/取消、快速采购。
// 可选 catch-all 同时覆盖 /api/needs 本体与任意子路径（路径参数路由必须整段转发）。
// 仅 MySQL 后端：新模块没有飞书实现（旧 /api/items 飞书路径仍在，供回滚窗口）。
export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  if (!mysqlMode(env)) {
    return jsonResponse({ error: '采购新模块需要 DATA_BACKEND=mysql（飞书后端请回退旧版前端）' }, 501, corsHeaders);
  }
  return proxyToServer(request, env, corsHeaders);
}
