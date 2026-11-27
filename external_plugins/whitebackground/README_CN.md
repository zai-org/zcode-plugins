# 白底图（WhiteBackground）

生成纯白 #FFFFFF 的 PNG 画布，或打开 WhiteBackground 免费本机编辑器：白底图、透明抠图、透明 PNG 铺白底、不裁切的正方形、Shopify 尺寸、本地放大。照片由你在官方编辑器里选择，本插件不会上传，也不会消耗积分。无需 WhiteBackground 账号或 API 密钥。

这与[电商商品图助手](https://github.com/zai-org/zcode-plugins/blob/main/external_plugins/product-photo-studio)（`product-photo-studio`）不同：那个插件完全离线，只适合去掉纯色或浅色棚拍背景，再批量导出各平台尺寸。背景是真实场景、需要官方 AI 抠图时，请用本插件。

## 功能

- **纯白画布**：指定尺寸（每边 1–8192 px，总像素不超过 3200 万）。插件调用官方公开画布接口，把 PNG 存到工作区（默认 `whitebackground/white-{宽}x{高}.png`），并在侧栏预览。已有文件不会被覆盖。
- **六种官方本机编辑器**：白底图、透明 PNG、已有透明 PNG 铺白底、不裁切的正方形、Shopify 尺寸、本地 2×/4× 放大。面板或助手会打开官方页面；由你选图、检查 Original / Result 并下载。
- **只提供定价链接**：单张本机处理保持免费。Pro、批量、4K 导出和高质量云端积分见[定价页](https://whitebackground.app/pricing)。本插件不会代为购买套餐，也不会自动扣费。

## 使用方法

在 ZCode 桌面端对助手说：

- “生成一张 2048 × 2048 的纯白 PNG”
- “打开 WhiteBackground 编辑器，我要把商品照做成白底图”
- “打开正方形编辑器，我要保留整张照片、不要裁切”

也可以打开侧栏「白底图 / WhiteBackground」，填写画布尺寸，或在某个流程上点「打开编辑器」。

## 工具

| 工具 | 作用 |
|---|---|
| `canvas_create` | 从官方公开接口获取纯白 PNG，保存到工作区，并打开面板 |
| `editor_open` | 打开一种官方本机编辑器（`white`、`transparent`、`png_to_white`、`square`、`shopify`、`enhance`）并给出网址 |
| `panel_open` | 打开侧栏面板 |

## 支持范围（v0.1）

- 免费路径**不接受**聊天附件、工作区路径或 base64 图片。必须在官方编辑器里选图。
- 免费背景编辑导出最长边 2200 px，不会放大主体。独立增强器对符合条件的输入支持 2× 最长边 2200 px 或 4× 最长边 4096 px；使用前请检查文字和 logo。
- 本版不含 Cloud / OAuth 高质量处理。
- 插件不重新实现抠图，也不打包约 220 MB 的本机模型；模型仍由官方浏览器编辑器下载。

## 隐私、网络与文件写入

- **网络**：生成空白画布时访问 `https://whitebackground.app` 的 `/api/mcp/canvas`，打开编辑器时访问官方页面。不发送 API 密钥。
- **照片**：免费路径下，照片留在官方编辑器的浏览器里，本插件不会上传。
- **写入**：只在当前工作区、你指定的路径写入画布 PNG（默认目录 `whitebackground/`）。不修改原图。没有 Hook，不执行命令。
- 若你之后在网站上自行使用付费 Cloud，遵循 WhiteBackground 自己的隐私政策（需你确认后才上传；存储与服务商保留期限见官网）。

## 构建与测试（开发者）

源码在 `ui-plugins/whitebackground/`。仓库根目录执行 `pnpm install --frozen-lockfile && pnpm build`，再把 `dist/local-marketplace` 加为本地来源。测试：`pnpm --filter @penova/plugin-whitebackground test` 与 `test:e2e`（需要 Chrome）。单元测试会模拟画布接口；有一项测试可能请求官方 16×16 公开画布（无账号、无积分），网络不可用时跳过。

## 第三方组件与许可证

插件以 MIT 许可证发布（作者 Penova）。产品站点为 [WhiteBackground.app](https://whitebackground.app)。安装包内含 MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整清单见 `dist/THIRD_PARTY_NOTICES.txt`。官方本机抠图模型（BEN2 / Transformers.js）不打进本插件。
