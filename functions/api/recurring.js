import { getCorsHeaders, jsonResponse, authenticate } from './_auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  function json(data, status = 200) { return jsonResponse(data, status, corsHeaders); }

  const user = await authenticate(request, env);
  if (!user.authenticated) return json({ error: 'Unauthorized' }, 401);

  const KV = env.IMAGE_STORE;
  if (!KV) return json({ error: 'KV not available' }, 500);
  const key = 'recurring:' + user.username;

  try {
    if (request.method === 'GET') {
      const data = await KV.get(key, 'json');
      return json({ ok: true, data: data || { items: [] } });
    }

    if (request.method === 'POST' || request.method === 'PUT') {
      const body = await request.json();
      await KV.put(key, JSON.stringify(body.data || body), { expirationTtl: 365 * 86400 });
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}