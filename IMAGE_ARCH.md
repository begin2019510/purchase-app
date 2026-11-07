# 图片存储架构

## 生产存储

生产图片文件保存在服务器配置的 `IMG_DIR`，默认 `/var/lib/purchase-app/images/{username}/`；MySQL `images` 表记录 `user_id`、文件 key、MIME 和大小。业务记录的 `image_ref` 仍使用 `kv:<file_key>` 兼容既有前端与历史数据格式，这个前缀不是生产新图存入 Cloudflare KV 的意思。

Cloudflare Pages Functions 认证请求后，将授权用户名和服务令牌转发到 Express。Express 通过用户名目录隔离图片；读取和删除时校验安全字符、限制在用户目录内，删除元数据时同时要求匹配 `user_id`。

```text
拍照/选图 → 前端缩小图片 → Pages Functions 验证 JWT
          → Express 校验服务令牌/用户身份 → 写入 IMG_DIR
          → MySQL images 元数据 + 业务记录中的 kv:<key>
```

服务端图片上限为 5 MiB。前端上传请求经过 Express JSON body parser；需保证代理层允许的请求体大小与应用限制相容。生产磁盘和数据库是两种独立介质，备份时应同时纳入并验证恢复点一致。

## 兼容路径

Functions 中保留旧版 Feishu/Cloudflare KV 图片处理代码。只有在相应后端配置选择旧路径时才会走该实现；生产基准是 MySQL + 服务器磁盘。`kv:` 引用的旧文件可能仍需通过兼容读取逻辑访问，切换后端前应核对用户数据和图片的同步状态。

## 关键代码

| 文件 | 作用 |
|------|------|
| `functions/api/_proxy.js` | 验证用户 JWT 后将业务请求送到 Express |
| `server/src/routes/images.js` | 图片上传、读取、删除 HTTP 路由 |
| `server/src/lib/images.js` | 用户目录路径校验和磁盘 I/O |
| `schema.sql` | MySQL 图片元数据表 |
| `functions/api/images.js` | Feishu/Cloudflare KV 兼容图片处理路径 |

## 运维事项

1. 保护 `/etc/purchase-app/server.env`、`db.env` 中的密钥；不要提交生产值。
2. 备份 MySQL 与 `IMG_DIR`，并定期演练联合恢复。
3. 监控磁盘容量，并对比 `IMG_DIR` 文件与 MySQL `images` 元数据，清理失败写入留下的孤儿文件。
4. 图片 URL 使用 JWT 查询参数以兼容 `<img src>`；避免把完整图片 URL 或 token 写入可公开日志。
5. Feishu/KV 回退不是项目阶段等功能的完全等价副本，回切前先验证数据与功能范围。
