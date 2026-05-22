// IMAGE_ARCH: 图存Cloudflare KV(IMAGE_STORE), Bitable只存kv:key引用
export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ['https://121212121.top', 'http://121212121.top'].includes(origin) ? origin : 'https://121212121.top',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-API-Key',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }
  function verifyPin(req, env) {
    const pin = req.headers.get('X-API-Key');
    if (!pin || pin !== env.API_KEY) return false;
    return true;
  }
  if (!verifyPin(request, env)) {
    return json({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  const KV = env.IMAGE_STORE;
  if (!KV) return json({ error: 'KV not configured' }, 500, corsHeaders);

  // POST: Upload image to KV
  if (request.method === 'POST') {
    const body = await request.json();
    if (!body.image) return json({ error: 'No image data' }, 400, corsHeaders);
    
    const dataUrl = body.image;
    // Extract mime and base64
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return json({ error: 'Invalid image format' }, 400, corsHeaders);
    
    const ext = match[1].split('/')[1] || 'jpg';
    const base64 = match[2];
    const key = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    
    // Store in KV (base64 string)
    await KV.put(key, base64, {
      metadata: { contentType: match[1], uploadedAt: new Date().toISOString() },
    });
    
    return json({ key, ok: true }, 201, corsHeaders);
  }

  // GET: Retrieve image
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (!key) return json({ error: 'Missing key' }, 400, corsHeaders);
    
    const base64 = await KV.get(key);
    if (!base64) return json({ error: 'Image not found' }, 404, corsHeaders);
    
    const meta = await KV.getWithMetadata(key);
    const contentType = meta.metadata?.contentType || 'image/jpeg';
    
    // Return data URL directly for <img src> usage
    return new Response(`data:${contentType};base64,${base64}`,
      { status: 200, headers: { 'Content-Type': 'text/plain', ...corsHeaders } }
    );
  }

  // DELETE
  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    if (!key) return json({ error: 'Missing key' }, 400, corsHeaders);
    await KV.delete(key);
    return json({ ok: true }, 200, corsHeaders);
  }

  return json({ error: 'Method not allowed' }, 405, corsHeaders);
}
