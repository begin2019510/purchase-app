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

router.get('/images', async (req, res) => {
  try {
    const key = String(req.query.key || '').replace(/^kv:/, '');
    if (!key) return res.status(400).json({ error: 'Missing key' });
    const uid = await H.resolveUserId(req.username);
    // 用户隔离：file_key 归属校验
    const meta = await db.one('SELECT user_id FROM images WHERE file_key = ?', [key]);
    if (!meta || (uid && meta.user_id !== uid)) return res.status(404).json({ error: 'Image not found' });
    const img = IMG.readImage(req.username, key);
    if (!img) return res.status(404).json({ error: 'Image not found' });   // CF 层回退 KV
    res.setHeader('Content-Type', img.mime);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(img.buf);
  } catch (e) { res.status(500).json({ error: 'internal_error' }); }
});

router.delete('/images', async (req, res, next) => {
  try {
    const key = String(req.query.key || '').replace(/^kv:/, '');
    if (!key) return res.status(400).json({ error: 'Missing key' });
    await IMG.deleteImage(req.username, key);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
