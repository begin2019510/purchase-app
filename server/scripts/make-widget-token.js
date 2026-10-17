'use strict';
// 生成桌面小组件 Token：sudo node /opt/purchase-server/scripts/make-widget-token.js <username> [有效期天数，默认180]
const crypto = require('crypto');
const cfg = require('../src/config');

const username = process.argv[2];
const days = Number(process.argv[3]) || 180;
if (!username) { console.error('用法: make-widget-token.js <username> [days]'); process.exit(1); }
if (!cfg.WIDGET_SECRET) { console.error('WIDGET_SECRET 未配置'); process.exit(1); }

const payload = { username, exp: Date.now() + days * 86400000 };
const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.createHmac('sha256', cfg.WIDGET_SECRET).update(b64).digest('base64url');
console.log(b64 + '.' + sig);
