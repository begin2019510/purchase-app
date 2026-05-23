// IMAGE_ARCH: 图存Cloudflare KV(IMAGE_STORE), Bitable只存kv:key引用
import { verifyJWT } from './_auth.js';
export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ['https://121212121.top', 'http://121212121.top'].includes(origin) ? origin : 'https://121212121.top',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }
  async function verifyAuth(req, env) {
    // 1. JWT token
    const authHeader = req.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const payload = await verifyJWT(token, env.JWT_SECRET);
      if (payload) return true;
    }
    // 2. 旧 PIN (img src can't send headers, accept query param)
    const url = new URL(req.url);
    const qKey = url.searchParams.get('pin');
    const pin = req.headers.get('X-API-Key') || qKey;
    if (pin && pin === env.API_KEY) return true;
    return false;
  }
  if (!(await verifyAuth(request, env))) {
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
    
    // Return actual image binary so <img src> works directly
    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return new Response(binary,
      { status: 200, headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400', ...corsHeaders } }
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
