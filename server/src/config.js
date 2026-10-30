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
    // PURCHASE_DB_NAME 仅供隔离测试使用，生产不设置
    database: process.env.PURCHASE_DB_NAME || dbEnv.DB_NAME || 'purchase_app',
  },
  // 注意：本服务与 Cloudflare Functions 各自签发/校验 JWT，密钥并不相同；
  // 线上由 CF 验 token 后用 X-Auth-User + X-Service-Token 转发到本服务。
  JWT_SECRET: srvEnv.JWT_SECRET,
  SERVICE_TOKEN: srvEnv.SERVICE_TOKEN,  // CF Functions → 本服务内网鉴权
  PORT: Number(process.env.PURCHASE_PORT || srvEnv.API_PORT || 3500),
  INVITE_CODES: srvEnv.INVITE_CODES || '',
  WIDGET_SECRET: srvEnv.WIDGET_SECRET || '',
  HOST: srvEnv.API_HOST || '127.0.0.1',
  IMG_DIR: process.env.PURCHASE_IMG_DIR || srvEnv.IMG_DIR || '/var/lib/purchase-app/images',
  IMG_MAX_BYTES: 5 * 1024 * 1024,
  // 手机端「和 Claude 对话」桥接 CloudCLI（127.0.0.1:3001）
  CLOUDCLI_API_KEY: srvEnv.CLOUDCLI_API_KEY || '',
  CLOUDCLI_BASE: process.env.CLOUDCLI_BASE || srvEnv.CLOUDCLI_BASE || 'http://127.0.0.1:3001',
  // 对话使用的上游模型：claude-* 别名当前会落到 DeepSeek(欠费)/千问(超套餐) 而失败，
  // mimo-v2.6-flash 实测可用；上游再变时改 server.env 的 CLOUDCLI_MODEL 即可
  CLOUDCLI_MODEL: srvEnv.CLOUDCLI_MODEL || 'mimo-v2.6-flash',
};
