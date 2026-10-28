'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../config');
const db = require('../db');

function safeUserDir(username) {
  // 用户名进路径前强校验，防穿越
  if (!/^[A-Za-z0-9_一-龥.-]{1,50}$/.test(String(username || ''))) throw new Error('bad username');
  return path.join(cfg.IMG_DIR, username);
}

function genKey(prefix, mime) {
  const ext = (String(mime || 'image/jpeg').split('/')[1] || 'jpg').replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg';
  return prefix + '_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
}

// dataURL 或纯 base64 → 磁盘，返回 'kv:'+key（与旧 CF 引用格式一致）
async function saveDataImage(username, userId, dataUrl, prefix) {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  const m = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  const mime = m ? m[1] : 'image/jpeg';
  const base64 = m ? m[2] : dataUrl;
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > cfg.IMG_MAX_BYTES) { const err = new Error('图片过大（' + (buf.length / 1048576).toFixed(1) + 'MB）'); err.status = 413; throw err; }
  const key = genKey(prefix, mime);
  const dir = safeUserDir(username);
  fs.mkdirSync(dir, { recursive: true });
  await fs.promises.writeFile(path.join(dir, key), buf);
  try { await db.exec('INSERT INTO images (user_id, file_key, mime, size_bytes) VALUES (?,?,?,?)', [userId, key, mime, buf.length]); } catch (e) { console.error('images meta:', e.message); }
  return 'kv:' + key;
}

function readImage(username, key) {
  // key 只允许安全字符，防 ../ 穿越
  if (!/^[\w.-]+$/.test(String(key || ''))) return null;
  const root = path.resolve(cfg.IMG_DIR);
  const p = path.resolve(safeUserDir(username), key);
  if (!p.startsWith(root + path.sep)) return null;
  try {
    if (!fs.existsSync(p)) return null;
    return { buf: fs.readFileSync(p), mime: mimeFor(p) };
  } catch { return null; }
}
function mimeFor(p) {
  const e = path.extname(p).toLowerCase();
  return ({ '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.heic': 'image/heic' })[e] || 'image/jpeg';
}

async function deleteImage(username, key, userId) {
  if (!/^[\w.-]+$/.test(String(key || ''))) return false;
  const root = path.resolve(cfg.IMG_DIR);
  const p = path.resolve(safeUserDir(username), key);
  if (!p.startsWith(root + path.sep)) return false;
  try { fs.unlinkSync(p); } catch (e) {}
  // 元数据必须带 user_id 限定，避免任何路径删掉别人的 images 行
  try {
    if (userId != null) await db.exec('DELETE FROM images WHERE file_key = ? AND user_id = ?', [key, userId]);
  } catch (e) {}
  return true;
}

async function deleteUserDir(username) {
  try {
    const dir = safeUserDir(username);
    if (fs.existsSync(dir)) await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (e) { console.error('deleteUserDir:', e.message); }
}

module.exports = { saveDataImage, readImage, deleteImage, safeUserDir, deleteUserDir };
