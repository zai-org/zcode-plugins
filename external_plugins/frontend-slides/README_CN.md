# Frontend Slides

[English](./README.md)

从零创建或从 PowerPoint 转换生成精美、带动画的 HTML 演示文稿。基于 [zarazhangrui/frontend-slides](https://github.com/zarazhangrui/frontend-slides) v2.1.0（MIT 许可），打包为 ZCode 官方插件市场的插件。

## 功能

- **零依赖** — 每份演示文稿都是单个自包含 HTML 文件
- **风格发现** — agent 生成 3 个视觉风格预览，你只需挑选喜欢的
- **12 种安全预设 + 34 套大胆设计系统** — 拒绝千篇一律的"AI 味"设计
- **PPT 转换** — 从 .pptx 提取文字/图片并重建为网页幻灯片
- **导出与分享** — 内置 PDF 导出和 Vercel 部署脚本

## 安装

插件被官方市场收录后，可在 **ZCode → 设置 → 插件市场 → zcode-plugins-official** 中安装。

## 使用

直接在对话中用自然语言提出，或输入 `/frontend-slides`：

- “为我的 AI 创业项目做一个 pitch deck”
- “把我的 presentation.pptx 转换成网页幻灯片”
- “把刚做好的演示文稿导出为 PDF”

该 skill 会询问用途、篇幅和内容密度，展示 3 个风格预览，然后生成 16:9（1920×1080）固定画布、可在任意浏览器运行的演示文稿。

## 依赖与副作用

- **网络访问：** 生成的幻灯片在查看时加载网络字体（Google Fonts / Fontshare）。可选：PPT 转换需要 Python + `python-pptx`（`pip install python-pptx`）；PDF 导出需要 Node.js（Playwright 首次运行时自动安装）；Vercel 部署需要 Vercel 账号。插件本身不发起任何网络请求。
- **文件写入：** 幻灯片写入当前工作区；预览存放在 `.frontend-slides/`，交付后自动清理。
- **命令执行：** 自带脚本仅在你明确要求 PPT 转换、PDF 导出或部署时运行 `python`/`npx`。
- **无钩子、无 MCP 服务器、无遥测。**

## 第三方内容

所有 skill 内容来自 [zarazhangrui/frontend-slides](https://github.com/zarazhangrui/frontend-slides)，依据 MIT 许可包含（见 [LICENSE](./LICENSE)，© Zara Zhang）。ZCode 打包由 [@tahatehran](https://github.com/tahatehran) 完成。