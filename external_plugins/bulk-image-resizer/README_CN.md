# Bulk Image Resizer 批量图片缩放

[English](./README.md)

在浏览器中把一批本地图片批量缩放到同一精确像素尺寸，再由 Agent 把结果接入项目，用作网站图标、App 图标、Open Graph 分享图或商品图、头像组。

## 包含的组件

| 组件 | 内容 |
| --- | --- |
| MCP 服务器 `bulk-image-resizer` | 远程 Streamable HTTP 服务器 `https://bulk-image-resizer.pages.dev/zcode/mcp`，无需授权。提供一个工具 `prepare_bulk_image_resize`。 |
| Skill `resize-images-for-web` | 选定合适尺寸，用预设打开缩放工具；你保存文件后，经确认更新图标、manifest 或 meta 标签。 |
| 命令 `/bulk-image-resizer:resize-images` | 手动启动同一流程。 |

### 工具 `prepare_bulk_image_resize`

| 参数 | 取值 | 默认 | 含义 |
| --- | --- | --- | --- |
| `width` | 16–4096 | `1200` | 目标宽度（像素） |
| `height` | 16–4096 | `1200` | 目标高度（像素） |
| `mode` | `fit`、`crop` | `fit` | 完整保留图片并留边适配，或居中裁剪铺满 |
| `format` | `png`、`jpeg` | `png` | PNG 保留透明；JPEG 用白色填充 |
| `example` | `true`、`false` | `false` | 载入内置示例图片 |

该工具只返回一个带预设参数的浏览器缩放工具链接（例如 `https://bulk-image-resizer.pages.dev/#width=512&height=512&mode=fit&format=png&example=0`）和规范化后的设置，不接收任何图片或文件。无效参数会被拒绝。

## 怎么用

安装并启用插件后，直接描述需求即可，例如：

- 把我的商品图批量缩放成 1200×1200 的透明底 PNG
- 把这些截图裁成 1200×630 的 Open Graph 分享图
- 把 logo 文件做成 512×512 的 App 图标

也可以在输入框输入 `/`，手动选用 `resize-images-for-web` 技能或 `resize-images` 命令。

1. Agent 调用 `prepare_bulk_image_resize` 并给你链接（每个目标尺寸一个）。
2. 在桌面浏览器中打开，选择本地 JPEG、PNG 或 WebP 文件。
3. 逐张下载，或下载 ZIP `resized-<宽>x<高>.zip`；无法读取的文件会单独报错并跳过。
4. 把文件保存到工作区。Agent 会建议对应的 `<link rel="icon">`、manifest `icons`、`og:image` 或框架元数据改动，经你确认后写入。

## 依赖、网络访问与副作用

- **网络**：MCP 调用发往 `https://bulk-image-resizer.pages.dev/zcode/mcp`，缩放工具页面来自同一域名，均托管在 Cloudflare Pages；作为托管方，Cloudflare 会处理 IP 地址等常规请求数据。
- **隐私**：图片在你的浏览器本地解码、缩放和编码，不会上传。MCP 工具只接收上面的设置。
- **账号与计费**：无。不需要 API Key、登录或付费。
- **文件写入**：插件本体不写任何文件。Skill 只会在你确认后修改项目文件。
- **命令执行与 Hook**：无。
- **遥测**：插件本体不含遥测。

## 来源与许可

- 插件本体：MIT，© 2026 Penova（[LICENSE](./LICENSE)）。
- Bulk Image Resizer 网页工具和 MCP 服务器由 Penova 运营，地址为 `bulk-image-resizer.pages.dev`。其 ZIP 导出使用 [fflate](https://github.com/101arrowz/fflate)（MIT），由网页工具加载，不包含在本插件中。
