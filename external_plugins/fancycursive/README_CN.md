# FancyCursive 花体字与连笔字标

[English](./README.md)

在 ZCode 中直接将文本转换为可复制粘贴的 Unicode 花体与花式样式、检索精选 Unicode 符号、按平台规则装饰昵称，并生成透明 PNG 与真轮廓连笔 SVG 字标。

## 包含组件

- **MCP 服务器（`fancycursive`）**：无状态、只读的远程 Streamable HTTP MCP 服务（`https://mcp.fancycursive.com/mcp?source=zcode`），提供 5 个工具：
  1. `convert_cursive` — 将文本（最多 500 字符）转换为 Unicode 数学花体与粗体花体，保留重音符号并报告未转换字符。
  2. `fancy_text` — 按 `elegant`、`cute`、`aesthetic`、`bold` 主题生成最多 10 种花式装饰样式，并返回可见字符长度。
  3. `find_symbols` — 按关键词或分组检索可复制粘贴的 Unicode 符号，附带跨设备兼容性提示。
  4. `decorate_name` — 为昵称添加装饰边框，并校验 Instagram、TikTok、Discord、X、YouTube、Roblox 的昵称长度与符号规则。
  5. `render_lettering` — 使用 HarfBuzz 与 8 款 SIL OFL 1.1 连笔字体（Alex Brush、Allura、Dancing Script、Great Vibes、Italianno、Parisienne、Pinyon Script、Sacramento）生成透明 PNG 和不依赖本机字体的真轮廓 `<path>` SVG 字标。
- **技能（`fancy-text`）**：引导 Agent 选择合适的工具并遵守准确的文案边界。

## 网络访问、权限与副作用说明

- **网络请求**：仅通过 HTTPS 向 `https://mcp.fancycursive.com/mcp?source=zcode` 发送 MCP JSON-RPC 请求。无需登录或 API Key，单 IP 限流为 60 次/分钟。
- **隐私策略**：完全无状态，输入文本仅在内存中即时处理后立即丢弃，不落盘、不记录日志、不用于训练。详见 [fancycursive.com/privacy#ai-apps](https://fancycursive.com/privacy#ai-apps)。
- **本地副作用**：无。本插件不执行任何本地命令、不注册 Hook，也不向本地写入文件。

## 示例提示词

- `把 "Hello José!" 转成可复制粘贴的花体和粗花体文字。`
- `给 Instagram 昵称 "Amelia" 生成带装饰框的花体方案，并检查长度限制。`
- `用 Alex Brush 字体把 "Amelia Rose" 渲染成连笔透明 PNG 和真轮廓 SVG。`

## 许可与来源

- 插件清单、技能与文档：MIT © Nurul Widad（[fancycursive.com](https://fancycursive.com/?utm_source=zcode&utm_medium=plugin)）。
- 服务端 `render_lettering` 渲染所使用的 8 款连笔字体均采用 **SIL Open Font License 1.1** 开源字体许可。
- 支持邮箱：`support@fancycursive.com`
