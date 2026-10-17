'use strict';
// 配置加载：/etc/purchase-app/db.env（复用旧骨架凭据）+ /etc/purchase-app/server.env（本服务）
// 密钥只进内存，绝不打印
const fs = require('fs');

function parseEnvFile(path) {
  const env = {};
  try {
    for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch (e) {
    console.error('config load failed:', path, e.message);
    process.exit(1);
  }
  return env;
}

const dbEnv = parseEnvFile('/etc/purchase-app/db.env');
const srvEnv = parseEnvFile('/etc/purchase-app/server.env');

module.exports = {
  DB: {
    host: dbEnv.DB_HOST || '127.0.0.1',
    port: Number(dbEnv.DB_PORT || 3306),
    user: dbEnv.DB_USER,
    password: dbEnv.DB_PASS,
    database: dbEnv.DB_NAME || 'purchase_app',
  },
  JWT_SECRET: srvEnv.JWT_SECRET,        // 与 Cloudflare 同一密钥，token 互认
  SERVICE_TOKEN: srvEnv.SERVICE_TOKEN,  // CF Functions → 本服务内网鉴权
  PORT: Number(srvEnv.API_PORT || 3500),
  INVITE_CODES: srvEnv.INVITE_CODES || '',
  WIDGET_SECRET: srvEnv.WIDGET_SECRET || '',
  HOST: srvEnv.API_HOST || '127.0.0.1',
  IMG_DIR: srvEnv.IMG_DIR || '/var/lib/purchase-app/images',
  IMG_MAX_BYTES: 5 * 1024 * 1024,
};
