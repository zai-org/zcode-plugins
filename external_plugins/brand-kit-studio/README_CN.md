# 品牌素材套装

输入品牌名、标语和 logo，一次生成风格统一的整套品牌素材：网站图标、App 图标、社媒头像、分享图和各平台横幅。在侧栏预览每一张，逐个调整版式和文字，导出 PNG/ICO 文件和可编辑的 SVG 模板。

## 功能

- **网站图标**：`favicon.ico`（16/32/48）、`favicon-16x16.png`、`favicon-32x32.png`、`apple-touch-icon.png`（180）、安卓/PWA 192 和 512、自适应（maskable）512 图标、`site.webmanifest`，以及可直接粘贴的 `head-snippet.html`。
- **社交媒体**：头像 400×400（圆形裁切安全）、链接分享图（Open Graph）1200×630、X 帖子配图 1200×675、小红书封面 1080×1440。
- **横幅与封面**：公众号封面 900×383、X 主页横幅 1500×500、LinkedIn 横幅 1584×396、YouTube 频道横幅 2560×1440。文字和 logo 都放在各平台的安全区内（例如 YouTube 中间 1546×423，X/LinkedIn 横幅避开头像遮挡的区域）。
- **从 logo 提取品牌色**：没给颜色时，从 logo 推荐主色和辅色；在面板里改颜色，所有素材同步更新。
- **logo 自动摆放**：透明背景的 logo 保留原色；单色 logo 在品牌色上看不清时自动变成白色或深色；没有透明背景（JPG）或对比不足的 logo 放在白色圆角底上。横版文字 logo 不再重复写标题。
- **没有方形标志也能做图标**：优先用方形标志，其次用接近方形的 logo，否则用品牌名首字配品牌色。
- **三种版式**：居中渐变、左文右标、简洁留白。每张图可以单独改标题和副标题；放不下的文字自动缩小，仍然太长会截断并提示。
- **输出**：`brand-kit/favicon/`、`social/`、`covers/`、`templates/<素材>.svg`（可在 Figma、Illustrator、Inkscape 中编辑）、`brand.json`（项目）和 `index.html`（总览页，含色板）。

## 使用

在 ZCode Desktop 中对 Agent 说：

- “用 logo.svg 做一整套品牌素材，品牌名“青禾咖啡”，标语“云南高山新鲜烘焙””
- “用 assets/logo.png 给这个网站生成 favicon 和 webmanifest，并加到 index.html 里”
- “把品牌主色改成 #7a3e1f，重新导出 YouTube 和 X 的横幅”

也可以在会话侧栏打开“品牌素材套装”，填写品牌名和标语，从工作区选择 logo。

## 工具

| 工具 | 作用 |
|---|---|
| `brand_open` | 读取 logo、推荐配色、检查排版并打开面板 |
| `project_save` | 把品牌保存为 `.brandkit.json` |
| `brand_export` | 导出全部（或部分）素材、图标包、SVG 模板和总览页 |

## 范围（v0.1）

- logo 支持 SVG（效果最好）、带透明背景的 PNG、JPG。
- 文字使用系统中文字体（macOS 苹方 / 冬青黑体，Windows 微软雅黑，Linux Noto Sans CJK）；可在插件设置 `fontPath` 中指定其他字体。SVG 模板按名称引用字体，请在装有该字体的电脑上打开。
- v0.1 不包含：从零生成 logo、按素材使用不同品牌字体、动态素材、印刷物料（名片、信纸）。

## 隐私、网络与文件写入

- **全部在本机处理。** 不联网、不上传、不需要 API 密钥或账号。
- 读取所选 logo 文件和系统字体；只在工作区内写文件（默认 `brand-kit/`，以及你指定的 `.brandkit.json`）。不执行命令，没有 hooks。

## 构建与测试（开发者）

源码在 `ui-plugins/brand-kit-studio/`。在仓库根目录运行 `pnpm install --frozen-lockfile && pnpm build`，把 `dist/local-marketplace` 添加为 ZCode 插件商店的本地来源后安装。测试：`pnpm --filter @penova/plugin-brand-kit-studio test`（SVG/PNG/JPG logo 和无 logo 品牌；检查尺寸、ICO 结构、颜色和文字溢出提示）和 `test:e2e`（浏览器面板测试）。

## 第三方组件与许可证

插件采用 MIT 许可证（作者：Penova）。打包的依赖：resvg-wasm（MPL-2.0，未修改；源码：https://github.com/yisibl/resvg-js）、fontkit（MIT）、pngjs（MIT）、jpeg-js（BSD-3-Clause）、MCP SDK 与 ext-apps（MIT）。完整清单随包附带于 `dist/THIRD_PARTY_NOTICES.txt`。测试用 logo 为虚构品牌，专为测试绘制。
