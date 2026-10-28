'use strict';
// /api/images 镜像 CF images.js：<img src> 走 ?token=（无法带 Header），上传返回 {key}
// 引用格式保持 'kv:'+key 与历史数据一致；磁盘未命中的旧图由 CF 层回退 KV（PR4）
const express = require('express');
const cfg = require('../config');
const H = require('../lib/helpers');
const IMG = require('../lib/images');
const db = require('../db');
const { verifyJWT } = require('../jwt');

const router = express.Router();

router.use('/images', (req, res, next) => {
  // CF 反代已验明身份（X-Auth-User，经 X-Service-Token 闸）
  if (req.user && req.user.username) { req.username = req.user.username; return next(); }
  let payload = null;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) payload = verifyJWT(h.replace('Bearer ', ''), cfg.JWT_SECRET);
  if (!payload && req.query.token) payload = verifyJWT(String(req.query.token), cfg.JWT_SECRET);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  req.username = payload.username;
  next();
});

router.post('/images', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.image) return res.status(400).json({ error: 'No image data' });
    const match = String(b.image).match(/^data:(image\/\w+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Invalid image format' });
    const uid = await H.resolveUserId(req.username);
    if (!uid) return res.status(401).json({ error: '用户不存在' });
    const buf = Buffer.from(match[2], 'base64');
    if (buf.length > cfg.IMG_MAX_BYTES) {
      return res.status(413).json({ error: '图片过大（' + (buf.length / 1048576).toFixed(1) + 'MB），请压缩后重试' });
    }
    const ref = await IMG.saveDataImage(req.username, uid, b.image, 'img');   // 'kv:xxx.jpg'
    res.status(201).json({ key: ref.replace('kv:', ''), ok: true });
  } catch (e) { next(e); }
});

// 存量图片仍在 KV（无 images 元数据）：只有该 key 确实被当前用户自己的数据引用时才允许 CF 回退 KV，
// 否则任意登录用户都能拿别人的旧 key 读图。
async function legacyKeyOwnedBy(uid, key) {
  const ref = 'kv:' + key;
  const direct = await db.one(
    'SELECT 1 AS x FROM expenses WHERE user_id = ? AND image_ref = ? UNION ALL SELECT 1 AS x FROM todos WHERE user_id = ? AND image_ref = ? LIMIT 1',
    [uid, ref, uid, ref]);
  if (direct) return true;
  // purchases.image_ref 可能是 'kv:xxx' 或阶段图片 JSON；LIKE 只用来缩小范围，最终按解析后的值精确比较
  const rows = await db.query('SELECT image_ref FROM purchases WHERE user_id = ? AND image_ref LIKE ?', [uid, '%' + ref + '%']);
  for (const row of rows) {
    const v = row.image_ref;
    if (v === ref) return true;
    try {
      const o = JSON.parse(v);
      if (o && typeof o === 'object') {
        for (const k of Object.keys(o)) if (o[k] === ref) return true;
      }
    } catch (e) {}
  }
  return false;
}

router.get('/images', async (req, res) => {
  try {
    const key = String(req.query.key || '').replace(/^kv:/, '');
    if (!key) return res.status(400).json({ error: 'Missing key' });
    const uid = await H.resolveUserId(req.username);
    const meta = await db.one('SELECT user_id FROM images WHERE file_key = ?', [key]);
    if (!uid) return res.status(404).json({ error: 'Image not found' });
    if (meta) {
      // 元数据归属别的用户：直接 404，且不允许回退 KV
      if (meta.user_id !== uid) return res.status(404).json({ error: 'Image not found' });
      const img = IMG.readImage(req.username, key);
      if (img) {
        res.setHeader('Content-Type', img.mime);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.end(img.buf);
      }
      // 自己的元数据但磁盘缺失：允许 CF 回退 KV 恢复
      res.setHeader('X-Image-Fallback', '1');
      return res.status(404).json({ error: 'Image not found' });
    }
    // 无元数据：仅当 key 被当前用户自己的数据引用（历史 KV 图）才允许回退
    if (await legacyKeyOwnedBy(uid, key)) {
      res.setHeader('X-Image-Fallback', '1');
      return res.status(404).json({ error: 'Image not found' });
    }
    return res.status(404).json({ error: 'Image not found' });
  } catch (e) { res.status(500).json({ error: 'internal_error' }); }
});

router.delete('/images', async (req, res, next) => {
  try {
    const key = String(req.query.key || '').replace(/^kv:/, '');
    if (!key) return res.status(400).json({ error: 'Missing key' });
    const uid = await H.resolveUserId(req.username);
    const meta = await db.one('SELECT user_id FROM images WHERE file_key = ?', [key]);
    if (!uid || !meta || meta.user_id !== uid) return res.status(404).json({ error: 'Image not found' });
    await IMG.deleteImage(req.username, key, uid);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
