// POST /api/push/register - 保存 JPush Registration ID
// POST /api/push/send - 发送 JPush 推送通知
import { corsHeaders, json, authenticate } from '../_auth.js';

// 保存 registration ID
async function handleRegister(request, env) {
  const user = await authenticate(request, env);
  if (!user.authenticated) return json({ error: '未授权' }, 401, corsHeaders(request));
  
  const { registrationId } = await request.json();
  if (!registrationId) return json({ error: 'registrationId required' }, 400, corsHeaders(request));
  
  // 保存到 KV，key 为 jpush:username
  await env.KV.put(`jpush:${user.username}`, JSON.stringify({
    registrationId,
    updatedAt: new Date().toISOString()
  }));
  
  return json({ ok: true }, 200, corsHeaders(request));
}

// 发送 JPush 推送
export async function handleSend(env, username, title, content, extras = {}) {
  const key = env.JPUSH_APP_KEY;
  const secret = env.JPUSH_MASTER_SECRET;
  
  if (!key || !secret) {
    console.log('JPush credentials not configured');
    return { ok: false, error: 'JPush not configured' };
  }
  
  // 获取用户的 registration ID
  const regData = await env.KV.get(`jpush:${username}`);
  if (!regData) {
    console.log('No JPush registration for user:', username);
    return { ok: false, error: 'No registration ID' };
  }
  
  const { registrationId } = JSON.parse(regData);
  
  // JPush REST API
  const authHeader = 'Basic ' + btoa(key + ':' + secret);
  
  const payload = {
    platform: 'android',
    audience: { registration_id: [registrationId] },
    notification: {
      android: {
        alert: content,
        title: title,
        builder_id: 1,
        extras
      }
    },
    message: {
      msg_content: content,
      content_type: 'text',
      title: title,
      extras
    }
  };
  
  try {
    const res = await fetch('https://api.jpush.cn/v3/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      body: JSON.stringify(payload)
    });
    
    const result = await res.json();
    console.log('JPush send result:', JSON.stringify(result));
    return { ok: res.ok, result };
  } catch (e) {
    console.log('JPush send error:', e.message);
    return { ok: false, error: e.message };
  }
}

// API handler
export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);
  
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);
  
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  
  if (action === 'register') {
    return handleRegister(request, env);
  }
  
  if (action === 'send') {
    const user = await authenticate(request, env);
    if (!user.authenticated) return json({ error: '未授权' }, 401, headers);
    
    const { title, content, extras } = await request.json();
    const result = await handleSend(env, user.username, title || '个人管家', content, extras);
    return json(result, result.ok ? 200 : 500, headers);
  }
  
  return json({ error: 'Unknown action' }, 400, headers);
}