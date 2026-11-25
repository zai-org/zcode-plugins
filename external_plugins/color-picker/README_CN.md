# Color Picker 取色器

[English](./README.md)

在浏览器取色器中从图片或屏幕任意位置精确取色，再由 Agent 把色板写成项目里的 CSS 变量、Tailwind 主题色或设计 Token。

## 包含的组件

| 组件 | 内容 |
| --- | --- |
| MCP 服务器 `color-picker` | 远程 Streamable HTTP 服务器 `https://browser-color-picker.pages.dev/zcode/mcp`，无需授权。提供一个工具 `prepare_color_picker`。 |
| Skill `color-palette-to-code` | 按需求打开取色器，读取导出的色板，经你确认后写入项目的主题文件。 |
| 命令 `/color-picker:pick-colors` | 手动启动同一流程。 |

### 工具 `prepare_color_picker`

| 参数 | 取值 | 默认 | 含义 |
| --- | --- | --- | --- |
| `format` | `css`、`json` | `css` | 色板下载格式 |
| `size` | `1`、`3`、`5`、`11`（必须是 JSON 数字，不要写成字符串） | `1` | 取单个像素，或取 3×3、5×5、11×11 区域的平均色 |
| `example` | `true`、`false` | `false` | 载入内置示例图片 |

该工具只返回一个带预设参数的浏览器取色器链接（例如 `https://browser-color-picker.pages.dev/?format=json&size=5&example=0`）和规范化后的设置，不接收任何图片、文件或屏幕数据。`size` 必须传 JSON 数字（`5`），不要传字符串（`"5"`）。无效参数会被拒绝。

## 怎么用

安装并启用插件后，直接描述需求即可，例如：

- 从我的 logo 取色，加到 Tailwind 主题色里
- 从这张截图里取品牌色，生成 CSS 变量
- 打开取色器，用 JSON 导出、5×5 区域平均取色

也可以在输入框输入 `/`，手动选用 `color-palette-to-code` 技能或 `pick-colors` 命令。

1. Agent 调用 `prepare_color_picker` 并给你一个链接。
2. 用 Chrome、Edge 等 Chromium 内核浏览器打开。选择本地 PNG、JPEG、WebP、GIF 或 AVIF 图片，或启动屏幕吸管（需要浏览器支持 EyeDropper API）。
3. 把颜色加入色板，下载 `color-palette.css` / `color-palette.json`，或直接复制色值。
4. 把色板粘贴回对话（或把文件保存到工作区）。Agent 会建议语义化命名、展示改动，确认后写入主题文件，也可以检查文字与背景配色的 WCAG 对比度。

CSS 导出为 `:root { --color-1: #RRGGBB; ... }` 代码块；JSON 导出为 `{ hex, rgb, hsl, rgba }` 对象数组。带透明度的颜色会保留 alpha。

## 依赖、网络访问与副作用

- **网络**：MCP 调用发往 `https://browser-color-picker.pages.dev/zcode/mcp`，取色器页面来自同一域名，均托管在 Cloudflare Pages；作为托管方，Cloudflare 会处理 IP 地址等常规请求数据。
- **隐私**：图片和屏幕像素都在你的浏览器本地处理，不会上传。MCP 工具只接收上面三个设置。
- **账号与计费**：无。不需要 API Key、登录或付费。
- **文件写入**：插件本体不写任何文件。Skill 只会在你确认后修改项目里的主题文件。
- **命令执行与 Hook**：无。
- **遥测**：插件本体不含遥测。

## 来源与许可

- 插件本体：MIT，© 2026 Penova（[LICENSE](./LICENSE)）。
- Color Picker 网页工具和 MCP 服务器由 Penova 运营，地址为 `browser-color-picker.pages.dev`。
