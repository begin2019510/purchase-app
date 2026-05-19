// GET /api/push/vapid - 获取 VAPID 公钥（供客户端订阅用）
// VAPID 密钥对在首次调用时自动生成，存储在 KV 中

import { json, corsHeaders } from '../../_utils.js';

export async function onRequest(context) {
  const { env, request } = context;
  const headers = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  try {
    // 检查是否已有密钥
    let keyPair = await env.PUSH_KV.get('vapid_keys', { type: 'json' });

    if (!keyPair) {
      // 生成新的 ECDSA P-256 密钥对
      const rawKey = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify']
      );

      // 导出公钥（未压缩点格式，Web Push 需要）
      const pubBuf = await crypto.subtle.exportKey('raw', rawKey.publicKey);
      const pubBytes = new Uint8Array(pubBuf);
      // 转成 base64url（无填充）
      const publicKey = bufToBase64url(pubBytes);

      // 导出私钥（PKCS8 DER）
      const privBuf = await crypto.subtle.exportKey('pkcs8', rawKey.privateKey);
      const privateKey = bufToBase64url(new Uint8Array(privBuf));

      keyPair = { publicKey, privateKey };
      await env.PUSH_KV.put('vapid_keys', JSON.stringify(keyPair));
    }

    return json({ publicKey: keyPair.publicKey }, 200, headers);
  } catch (e) {
    return json({ error: e.message }, 500, headers);
  }
}

function bufToBase64url(buf) {
  let binary = '';
  for (const b of buf) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
