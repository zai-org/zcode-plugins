# PNG & Sprite Tools PNG 与精灵图工具

[English](./README.md)

面向游戏与界面 PNG 素材的浏览器工具：裁掉单张或批量 PNG 的透明边并加精确留白，或把规则排列的精灵图切成单帧 PNG。随后由 Agent 把导出的文件接入你的项目。

## 包含的组件

| 组件 | 内容 |
| --- | --- |
| MCP 服务器 `png-trim` | 远程 Streamable HTTP 服务器 `https://transparent-padding-trimmer.chajian.workers.dev/mcp`，无需授权。工具 `prepare_png_trim`。 |
| MCP 服务器 `png-batch-trim` | 远程 Streamable HTTP 服务器 `https://batch-transparent-png-trim.chajian.workers.dev/mcp`，无需授权。工具 `prepare_batch_png_trim`。 |
| MCP 服务器 `sprite-slicer` | 远程 Streamable HTTP 服务器 `https://sprite-sheet-slicer.chajian.workers.dev/mcp`，无需授权。工具 `prepare_sprite_grid`。 |
| Skill `game-and-ui-png-assets` | 选择合适的工具并用预设打开，经你确认后把导出文件接入项目。 |
| 命令 `/png-sprite-tools:png-assets` | 手动启动同一流程。 |

### 工具

| 工具 | 参数 | 浏览器中的输出 |
| --- | --- | --- |
| `prepare_png_trim` | `padding` 0–512（默认 0）、`threshold` 0–254（默认 0）、`sample` | 一张裁好的 PNG |
| `prepare_batch_png_trim` | `padding` 0–512、`threshold` 0–254、`sample` | 逐张 PNG，或包含全部 PNG 与逐文件 CSV 的 ZIP |
| `prepare_sprite_grid` | `width`、`height` 1–4096（必填）；`gapX`、`gapY`、`x`、`y` 0–4096；`prefix`（小写，最长 32，默认 `sprite`）；`skipEmpty`；`sample` | 按行列命名的单帧 PNG 的 ZIP |

`threshold` 决定确定内容边界时哪些透明度算作空白。裁剪会原样复制边界内的像素，不做重采样。每个工具只返回带预设参数的链接（例如 `https://transparent-padding-trimmer.chajian.workers.dev/#padding=8&threshold=10&sample=0`）和规范化后的设置，不接收任何图片或文件。无效参数会被拒绝。

## 怎么用

安装并启用插件后，直接描述需求即可，例如：

- 把这张 16×16、间隔 1 像素的精灵图切成单帧，文件名前缀 hero
- 批量裁掉图标 PNG 的透明边，四周保留 8 像素
- 把这张角色 PNG 周围的空白透明区域裁掉

也可以在输入框输入 `/`，手动选用 `game-and-ui-png-assets` 技能或 `png-assets` 命令。

1. Agent 调用对应工具并给你链接。
2. 在桌面浏览器中打开，选择本地文件（裁边需静态 PNG；精灵图支持 PNG、WebP 或 JPEG），检查预览。
3. 下载结果并保存到工作区。
4. Agent 建议使用新文件的引擎、CSS 或组件改动，经你确认后写入。

## 依赖、网络访问与副作用

- **网络**：MCP 调用发往上面三个 `*.chajian.workers.dev/mcp` 地址，每个工具页面与其 MCP 服务器同域，均托管在 Cloudflare Workers；作为托管方，Cloudflare 会处理 IP 地址等常规请求数据。
- **隐私**：图片在你的浏览器本地解码和处理，不会上传。MCP 工具只接收上面的设置。
- **账号与计费**：无。不需要 API Key、登录或付费。
- **文件写入**：插件本体不写任何文件。Skill 只会在你确认后修改项目文件。
- **命令执行与 Hook**：无。
- **遥测**：插件本体不含遥测。

## 来源与许可

- 插件本体：MIT，© 2026 Penova（[LICENSE](./LICENSE)）。
- 三个网页工具和 MCP 服务器由 Penova 运营，部署在 `chajian.workers.dev`。网页工具使用的第三方库（如 [fast-png](https://github.com/image-js/fast-png)、[fflate](https://github.com/101arrowz/fflate)，均为 MIT）与示例素材署名列在各工具的帮助页；本插件不包含这些内容。
