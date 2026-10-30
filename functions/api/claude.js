// 手机端「和 Claude 对话」桥接：CF 侧只做 JWT 鉴权 + 原样转发到 purchase-server。
// 前端契约：POST /api/claude?action=chat（发起任务，立即返回 taskId）
//           GET  /api/claude?action=task&id=xxx（轮询进度）
// 所有请求都是短请求（异步任务+轮询），普通 fetch 转发即可。
import { mysqlMode, authUser, toServer } from './_proxy.js';
import { getCorsHeaders, jsonResponse } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  function json(data, status = 200) { return jsonResponse(data, status, corsHeaders); }

  if (!mysqlMode(env)) return json({ error: '服务未配置' }, 503);

  const uname = await authUser(request, env);
  if (!uname) return json({ error: '未授权：请登录' }, 401);

  let sr;
  try {
    sr = await toServer(request, env, { username: uname });
  } catch (e) {
    console.error('claude proxy:', e && e.message);
    return json({ error: '数据服务暂时不可用，请稍后重试' }, 502);
  }
  return new Response(sr.body, {
    status: sr.status,
    headers: {
      'Access-Control-Allow-Origin': (corsHeaders && corsHeaders['Access-Control-Allow-Origin']) || '*',
      'Content-Type': sr.headers.get('Content-Type') || 'application/json',
    },
  });
}
