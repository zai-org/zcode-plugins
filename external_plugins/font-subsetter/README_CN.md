# 网页字体瘦身

把网页字体裁到只剩网站真正用到的字——一个 10–20 MB 的中文字体通常只剩几十 KB。选择网站或项目文件夹：自动找到字体（.ttf、.otf、.ttc、.woff、.woff2）和页面文件（HTML、Vue/Svelte、JS/TS、CSS、Markdown、JSON、YAML、字幕等），收集真正会显示的字（代码注释和 HTML 标记不算），用 HarfBuzz 裁剪每个字体，保留 OpenType 特性和可变字体轴。标题字体可以只保留标题里的字。会提示字体里缺的字（带文件和行号）、许可标记禁止嵌入的字体、裁完仍然偏大的字体。导出 WOFF2/WOFF（可选 TTF/OTF）、可直接引用的 fonts.css、chars.txt、体积报告，以及用裁好的字体本身画出的预览图。在本地运行，不用登录，无需 API 密钥。

## 功能

- **只收会显示的字**：HTML 正文和 alt/title/placeholder、JS/TS/Vue 里的字符串、Markdown、JSON、YAML、CSS content、字幕；注释和标记不算。
- **真正的子集化**：HarfBuzz hb-subset，保留 OpenType 特性，支持 CFF 和 TrueType 轮廓、可变字体轴和 .ttc 字体集。
- **每个字体单独设定用途**：全部文字、只用于标题（展示字体），或只保留指定的字。
- **检查**：缺字（带文件:行号）、许可嵌入标记（OS/2 fsType）、可变字体、裁完仍偏大、输出重名。
- **导出**：WOFF2、WOFF、TTF/OTF、带 @font-face 的 fonts.css（可选 unicode-range）、chars.txt、report.md，以及用子集字形画的预览图。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `font-subsetter/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 官网 文件夹里的字体按网站用到的字裁小”
- “宋体只用于标题”
- “导出 WOFF2 和 CSS”

## 工具

| 工具 | 作用 |
|---|---|
| `fontsub_open` | 找到字体和页面，收集用到的字并裁剪每个字体，并打开面板 |
| `fontsub_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `fontsub_status` | 查看当前数据、问题和汇总 |
| `fontsub_export` | 导出 <名称>.woff2/.woff、fonts.css、chars.txt、report.md 和 preview.png |

导出文件写到工作区的 `font-subsetter/<项目>/` 文件夹。

## 范围（v0.1）

- 只读取文件里的文字，不运行网站：运行时才出现的字（接口数据、用户输入）看不到，需要的话填到“额外字符”。HTML/JS 识别基于规则，不是完整解析。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `font-subsetter/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/font-subsetter/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-font-subsetter test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：Bundles HarfBuzz hb-subset WebAssembly from harfbuzzjs (MIT; HarfBuzz is under the Old MIT license) and Google's woff2 encoder via wawoff2 (MIT; woff2 and Brotli are MIT). The sample fonts are small subsets of Noto Sans/Serif CJK SC under the SIL Open Font License 1.1 (license file next to them).、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
