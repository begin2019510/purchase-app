'use strict';
// 个人管家 API 服务器：仅监听 127.0.0.1，由 Nginx(api.121212121.top) TLS 暴露
// 鉴权：CF Functions 转发时携带 X-Service-Token + 原始 Authorization(JWT)
const express = require('express');
const cfg = require('./config');
const db = require('./db');
const { authMiddleware } = require('./middleware');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// ---- 健康检查（不依赖令牌，无数据）----
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'purchase-server', status: 'healthy', time: new Date().toISOString() });
});

// ---- 内网令牌：所有业务路由必须经 CF 反代进来 ----
app.use('/api', (req, res, next) => {
  if (req.headers['x-service-token'] !== cfg.SERVICE_TOKEN) {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
});

// ---- 业务路由（PR2 逐个挂载）----
// app.use('/api', require('./routes/auth'));
// app.use('/api', require('./routes/items'));
// app.use('/api', require('./routes/expenses'));
// ...

// ---- DB 健康（带令牌，仅调试）----
app.get('/api/db/health', async (req, res) => {
  try {
    const row = await db.one('SELECT COUNT(*) AS tables_cnt FROM information_schema.tables WHERE table_schema = ?', [cfg.DB.database]);
    res.json({ ok: true, database: cfg.DB.database, tables: Number(row.tables_cnt) });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'db_unavailable', detail: e.code || e.message });
  }
});

app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.use((err, req, res, next) => {
  console.error('unhandled:', err.message);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(cfg.PORT, cfg.HOST, () => {
  console.log(`purchase-server listening http://${cfg.HOST}:${cfg.PORT}`);
});
