# 代码截图美化

把代码做成适合放进幻灯片、文档和帖子的图片：支持 TypeScript/JavaScript、Python、Go、Rust、Java、C/C++、SQL、Shell、CSS、HTML、JSON、YAML 语法高亮，六种主题，带行号、高亮行、macOS 风格窗口和渐变背景。可以从文件里截任意行范围（一个文件可以出多张），自动去掉公共缩进，长行自动折行。分享前会提示代码里的 API 密钥、令牌、私钥、写死的密码和带账号密码的 URL，并可以在图片里打码。每段导出 PNG（默认 2 倍清晰度）和 SVG。在本地运行，不用登录，无需 API 密钥。

## 功能

- **语法高亮**：12 类语言，按扩展名自动识别。
- **主题**：GitHub 深色/浅色、Dracula、Monokai、Nord、Solarized 浅色。
- **截取片段**：任意行范围，一个文件多段，高亮行，自定义窗口标题。
- **版式**：macOS 窗口或简洁标题栏、渐变背景、留白、行号、去缩进、折行。
- **密钥检查**：API 密钥、令牌、私钥、JWT、密码和带账号密码的 URL，可选打码。
- **导出**：PNG（1–4 倍）和 SVG。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `code-snippet-image/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 pay.ts 第 3–17 行做成代码图，高亮 13–16 行，标题 verify.ts”
- “把 API 密钥打码，换 dracula 主题”
- “导出 PNG”

## 工具

| 工具 | 作用 |
|---|---|
| `codeimg_open` | 读取代码文件并排好代码图，并打开面板 |
| `codeimg_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `codeimg_status` | 查看当前数据、问题和汇总 |
| `codeimg_export` | 每段导出 <文件>[-L起-止].png 和 .svg |

导出文件写到工作区的 `code-snippet-image/<项目>/` 文件夹。

## 范围（v0.1）

- 高亮基于规则（关键字、字符串、注释、数字、函数调用），不是完整语法解析。使用系统等宽字体（Menlo / Consolas / DejaVu Sans Mono）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `code-snippet-image/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/code-snippet-image/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-code-snippet-image test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
