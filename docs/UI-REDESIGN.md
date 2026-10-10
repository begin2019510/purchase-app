# UI 改版记录（v4.0.0 · 2026-10-10）

## 基调
**Apple 风精简**：大留白、hairline 分隔、克制阴影、系统字体、SF 色板；**背景可调**。

## 已完成

### T1 拆弹
- 删除 `theme.css` 粉色贴纸风图层（原 422-559 行，含暗色补丁，`f0d0d8/f0c0cc` 清零）
- 建立设计 Token：`--r-*` 圆角 / `--sp-*` 间距 / `--fs-*` 字号 / `--shadow-*` / iOS 语义色
- 暗色改走 token 覆盖（纯黑 `#000` 系统分组背景风）

### T1b 背景可调
- 设置 → 「背景主题」：默认/纯白/纸感/雾灰/淡紫/薄荷/蜜桃/岩灰 8 色
- `body[data-bg=x]` + localStorage `bg_theme`；暗色模式自动覆盖为纯黑

### T2 组件库（theme.css `a-*` 前缀）
- `.a-group/.a-row` iOS 分组列表、`.a-seg` 分段控件、`.a-badge-*` 语义徽章
- `.a-btn`、`.a-card`、`.a-hero`、`.a-empty`、`.a-skel`、`.a-hair`
- 触控目标 ≥44px；`prefers-reduced-motion` 支持；金额 `tabular-nums`

### T3 模块
- **记账**：三格统计头、预算卡、列表行去色条、徽章统一、**月份切换 ‹ ›**（历史可查）
- **统计**：同款月份切换（历史数据可看）
- **待办**：去左侧色条、状态徽章 a-badge、高优先小点、按钮统一
- **项目**：状态徽章、归档按钮统一
- **采购**：状态徽章映射 a-badge

### 版本
- APP_VERSION / index.html / 全部 `?v=` / SW cache → **4.0.0 / purchase-cache-v62**
- changelog 已追加

## 未做（后续）
- emoji 操作图标全面 SVG 化
- 全部内联 style 清除（仍约 200+ 处）
- 双导航（顶 tabs + 底 nav）精简
- 项目模块主体随「阶段模型」重做
