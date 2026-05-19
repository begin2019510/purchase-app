# 📲 手机使用 + 每日推送提醒

## 手机访问

1. 手机浏览器打开 **http://121212121.top**
2. **iPhone Safari**：底部「分享」→「添加到主屏幕」
3. **Android Chrome**：菜单 →「添加到主屏幕」
4. 添加后像一个 App 一样用

## 每日推送提醒

推送使用**飞书自定义机器人**，依赖飞书 App 的推送通道（国内可用）。

### 配置方法

#### 1. 获取飞书机器人 webhook 地址

1. 打开飞书 → 进入一个群聊（或新建一个单人群）
2. 点群设置 → **群机器人** → **添加机器人**
3. 选 **自定义机器人**，起个名字（如「采购管家」）
4. 复制 **Webhook 地址**（格式：`https://open.feishu.cn/open-apis/bot/v2/hook/xxx`）

#### 2. 配置 Cloudflare 环境变量

1. https://dash.cloudflare.com → Pages → purchase-app → Settings → **Environment variables**
2. 添加两个变量：

| 变量名 | 值 |
|--------|-----|
| `CRON_SECRET` | `daily-reminder-2026` |
| `FEISHU_BOT_WEBHOOK` | 上面复制的飞书 Webhook 地址 |

3. 保存，等待重新部署

#### 3. 配置 GitHub 密钥

https://github.com/begin2019510/purchase-app/settings/secrets/actions

点 **New repository secret**：
- Name: `CRON_SECRET`
- Value: `daily-reminder-2026`
- 保存

### 配置完成后

每天 **北京时间 20:00**，你的飞书会收到一条记账提醒，点击按钮直接打开采购管家。
