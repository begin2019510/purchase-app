// IMAGE_ARCH: 图存Cloudflare KV(IMAGE_STORE), Bitable只存kv:key引用
import { verifyJWT } from './_auth.js';
export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ['https://121212121.top', ].includes(origin) ? origin : 'https://121212121.top',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  }
  async function verifyAuth(req, env) {
    // 1. JWT token from Authorization header
    const authHeader = req.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const payload = await verifyJWT(token, env.JWT_SECRET);
      if (payload) return true;
    }
    // 2. JWT token from query parameter (for <img src> which can't send headers)
    const url = new URL(req.url);
    const qToken = url.searchParams.get('token');
    if (qToken) {
      const payload = await verifyJWT(qToken, env.JWT_SECRET);
      if (payload) return true;
    }
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
    
    // 后端大小校验：base64 解码后不超过 2MB
    const estimatedBytes = Math.ceil(base64.length * 3 / 4);
    if (estimatedBytes > 2 * 1024 * 1024) {
      return json({ error: '图片过大（' + (estimatedBytes / 1024 / 1024).toFixed(1) + 'MB），请压缩后重试' }, 413, corsHeaders);
    }
    
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
    
    let raw = await KV.get(key);
    if (!raw) return json({ error: 'Image not found' }, 404, corsHeaders);
    
    const meta = await KV.getWithMetadata(key);
    let contentType = meta.metadata?.contentType || 'image/jpeg';
    
    let base64 = raw;
    if (raw.startsWith('data:')) {
      const dm = raw.match(/^data:(image\/\w+);base64,(.+)$/);
      if (dm) { contentType = dm[1]; base64 = dm[2]; }
    }

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
