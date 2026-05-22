# 采购管理工具 - 图片存储架构说明

## 存储位置

**Cloudflare KV**（namespace: `IMAGE_STORE`）

- KV 只存 base64 字符串，key 格式：`img_{timestamp}_{random}.{ext}`
- 飞书 Bitable 的「图片」字段只存引用，格式：`kv:img_xxx.jpg`
- 旧数据（直接存 base64 的）没有 `kv:` 前缀，向前兼容

## 数据流

```
拍照/选图
  ↓
前端压缩（max 800px, quality 0.7, 上限 500KB）
  ↓
POST /api/images  { image: "data:image/jpeg;base64,..." }
  ↓
Cloudflare Worker 解析 data URL → 提取 base64 → 存入 KV
  ↓
返回 { key: "img_xxx.jpg" }
  ↓
前端保存记录 → Bitable「图片」字段 = "kv:img_xxx.jpg"
```

## 读取流程

```
加载记账列表
  ↓
读 Bitable「图片」字段
  ↓
以 "kv:" 开头？ → 构造 URL: /api/images?key=xxx&pin=密码
  ↓
Worker 从 KV 取 base64 → 解码为二进制 → 返回图片数据（Content-Type: image/jpeg）
  ↓
<img src 直接显示

不以 "kv:" 开头？ → 旧数据，直接当 base64 显示
```

## 关键文件

| 文件 | 作用 |
|------|------|
| `functions/api/images.js` | POST 上传图片到 KV / GET 取图返回二进制 / DELETE 删除 |
| `functions/api/expenses.js` | POST/PUT 写 Bitable 时，图片字段加 `kv:` 前缀 |
| `index.html` | 前端：压缩、上传、显示、编辑回显 |

## 认证

- 所有 API 需要 `X-API-Key` 头或 `?pin=xxx` 查询参数
- `img.src` 无法发送自定义 HTTP 头，所以图片 GET 必须用 `?pin=` 参数
- API Key 存在 Cloudflare Pages 环境变量 `API_KEY` 中

## 注意事项

1. **不要新建 Bitable 字段**：图片引用存在已有的「图片」字段，用 `kv:` 前缀区分新旧数据
2. **edit 工具不可靠**：修改含中文的 JS 文件时，edit 工具可能损坏编码，用 Python 脚本处理
3. **Cloudflare KV 限制**：单个 value 最大 25MB（base64），足够存压缩后的图片
4. **SW 缓存**：修改后如果页面不更新，可能是 Service Worker 缓存了旧版本，需要 Unregister SW 后刷新
