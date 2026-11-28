import { mysqlMode, proxyToServer } from '../_proxy.js';
import { getCorsHeaders, jsonResponse } from '../_auth.js';

// /api/special-budget/* —— 特殊预算 v3.2.x 全部读写接口（配置/申请/审批/资金/台账/监控）。
// 可选 catch-all 同时覆盖 /api/special-budget 本体与任意子路径（路径参数路由必须整段转发）。
// 缺了本文件时 Pages SPA 回退会把 /api/special-budget/* 返回 200 text/html，
// 前端拿不到 JSON 也看不到 404，页面会显示空白/“未开启”而不是真实状态。
// 仅 MySQL 后端：新模块没有飞书实现，处于回滚窗口时明确返回 501。
export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  if (!mysqlMode(env)) {
    return jsonResponse({ error: '特殊预算需要 DATA_BACKEND=mysql（飞书后端请回退旧版前端）' }, 501, corsHeaders);
  }
  return proxyToServer(request, env, corsHeaders);
}
