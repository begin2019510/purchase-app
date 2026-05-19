// POST /api/push/send - 发送 Web Push 通知（带 VAPID 签名 + aes128gcm 加密）
// POST body: { title, body, url?, tag? }
// POST body (internal): { endpoint, keys, payload } - 直接发送给指定订阅

import { json, corsHeaders, verifyPin } from '../../_utils.js';

export async function onRequest(context) {
  const { request, env } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, headers);
  }

  const isInternal = request.headers.get('X-Internal-Call') === 'true';
  if (!isInternal && !verifyPin(request, env)) {
    return json({ error: '未授权' }, 401, headers);
  }

  try {
    const body = await request.json();

    // 内部调用模式：直接发送给指定端点
    if (body.endpoint && body.keys && body.payload) {
      const result = await sendPush(body.endpoint, body.keys, body.payload, env);
      return json(result, result.ok ? 200 : 500, headers);
    }

    // 公开模式：发送给所有订阅者
    const title = body.title || '📦 采购管家';
    const text = body.body || '记得记账哦 💰';
    const url = body.url || '/';
    const tag = body.tag || 'reminder';

    const list = await env.PUSH_KV.list({ prefix: 'sub:' });
    if (!list.keys || list.keys.length === 0) {
      return json({ ok: true, sent: 0, message: '无订阅者' }, 200, headers);
    }

    let sent = 0, expired = 0;
    const toDelete = [];

    for (const key of list.keys) {
      const record = await env.PUSH_KV.get(key.name, { type: 'json' });
      if (!record?.subscription?.keys) {
        toDelete.push(key.name);
        continue;
      }

      const payload = JSON.stringify({ title, body: text, url, tag });
      const result = await sendPush(
        record.subscription.endpoint,
        record.subscription.keys,
        payload,
        env
      );

      if (result.expired) {
        toDelete.push(key.name);
        expired++;
      } else if (result.ok) {
        sent++;
      }
    }

    // 清理过期订阅
    for (const k of toDelete) await env.PUSH_KV.delete(k);

    return json({ ok: true, sent, expired, total: list.keys.length }, 200, headers);
  } catch (e) {
    return json({ error: e.message }, 500, headers);
  }
}

// ===== 核心：发送 Web Push =====

async function sendPush(endpoint, keys, payload, env) {
  try {
    // 1. 获取或生成 VAPID 密钥
    const vapidKeys = await env.PUSH_KV.get('vapid_keys', { type: 'json' });
    if (!vapidKeys) return { error: 'VAPID keys not found' };

    // 2. 创建 VAPID JWT
    const origin = new URL(endpoint).origin;
    const jwt = await createVapidJWT(origin, vapidKeys.privateKey, env);

    // 3. 加密 payload (aes128gcm)
    const encrypted = await encryptPayload(payload, keys);

    // 4. 发送请求
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'TTL': '86400',
        'Urgency': 'high',
        'Authorization': `vapid t=${jwt}, k=${vapidKeys.publicKey}`,
      },
      body: encrypted,
    });

    if (res.status === 410) return { ok: false, expired: true };
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ===== VAPID JWT (ES256) =====

async function createVapidJWT(audience, privateKeyBase64, env) {
  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    aud: audience,
    exp: now + 43200,
    sub: env.VAPID_EMAIL || 'mailto:admin@121212121.top',
  }));

  const toSign = `${header}.${payload}`;
  const data = new TextEncoder().encode(toSign);

  // 导入私钥（PKCS8 DER）
  const privKeyData = base64urlToBytes(privateKeyBase64);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privKeyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data);
  const sigBytes = derToRawSig(new Uint8Array(sig));

  return `${toSign}.${bytesToBase64url(sigBytes)}`;
}

// ===== Payload 加密 (aes128gcm) =====

async function encryptPayload(plainText, keys) {
  const uaInfo = new TextEncoder().encode('WebPush: \n');

  // 导入订阅公钥 (p256dh)
  const userPublicKey = base64urlToBytes(keys.p256dh);
  const userPubKey = await crypto.subtle.importKey(
    'raw', userPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );

  // 生成临时 ECDH 密钥对
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true, ['deriveBits']
  );

  // ECDH 导出共享密钥
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: userPubKey },
    ephemeralKeyPair.privateKey,
    256
  );

  // 生成随机 nonce 和 salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  // 导入 auth secret
  const authSecret = base64urlToBytes(keys.auth);
  const authKey = await crypto.subtle.importKey(
    'raw', authSecret,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );

  // HKDF: auth secret → PRK
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', authKey, sharedSecret));

  // HKDF-Expand: PRK → ikm (info = "WebPush: info" || ua_public || auth_secret)
  const prkKey = await crypto.subtle.importKey(
    'raw', prk,
    { name: 'HKDF', hash: 'SHA-256' },
    false, ['deriveBits']
  );

  const info = new Uint8Array([
    ...new TextEncoder().encode('WebPush: info\x00'),
    ...userPublicKey,
    ...authSecret,
  ]);

  const ikm = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', salt, info, hash: 'SHA-256' },
    prkKey,
    256
  ));

  // 导入 ikm 作为 AES 密钥
  const aesKey = await crypto.subtle.importKey(
    'raw', ikm,
    { name: 'AES-GCM' },
    false, ['encrypt']
  );

  // 计算 content padding（RFC 8291: 2 byte header + plaintext）
  const content = new TextEncoder().encode(plainText);

  // 构建加密输入：记录大小 (2 bytes) + 内容
  const encInput = new Uint8Array(2 + content.length);
  const len = content.length;
  encInput[0] = (len >> 8) & 0xff;
  encInput[1] = len & 0xff;
  encInput.set(content, 2);

  // AES-128-GCM 加密
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    aesKey,
    encInput
  );

  // 构建 aes128gcm 头部
  const ephemeralPub = await crypto.subtle.exportKey('raw', ephemeralKeyPair.publicKey);
  const header = new Uint8Array([
    0x01, // version
    ...salt,
    ...new Uint8Array([
      nonce.length, 0x00, 0x00, 0x00, // rs=0 (no record size), id_length=12
    ]),
    ...nonce,
    ...new Uint8Array([new Uint8Array(ephemeralPub).length]),
    ...new Uint8Array(ephemeralPub),
  ]);

  // 合并 header + ciphertext
  const result = new Uint8Array(header.length + new Uint8Array(encrypted).length);
  result.set(header, 0);
  result.set(new Uint8Array(encrypted), header.length);

  return result;
}

// ===== 工具函数 =====

function base64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  const b64 = pad ? padded + '='.repeat(4 - pad) : padded;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64url(buf) {
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// DER → Raw ECDSA 签名 (32+32 bytes)
function derToRawSig(der) {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Invalid DER');
  offset++; // total length
  if (der[offset++] !== 0x02) throw new Error('Invalid DER');
  let len = der[offset++];
  const r = der.slice(offset, offset + len);
  offset += len;
  if (der[offset++] !== 0x02) throw new Error('Invalid DER');
  len = der[offset++];
  const s = der.slice(offset, offset + len);

  const raw = new Uint8Array(64);
  const rPad = r[0] === 0 ? r.slice(1) : r;
  const sPad = s[0] === 0 ? s.slice(1) : s;
  raw.set(rPad, 32 - rPad.length);
  raw.set(sPad, 64 - sPad.length);
  return raw;
}
