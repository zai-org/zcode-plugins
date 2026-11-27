# SVG 图标库整理

把来自不同设计师、不同软件的一堆 SVG 图标整理成一套：去掉 Inkscape、Sketch、Figma、Illustrator 留下的多余内容，删除脚本和事件属性，补上缺失的 viewBox、补成正方形，单色图标改成 currentColor，跟随文字颜色。可以改名、改颜色或保留原色，然后导出优化后的 SVG、一个 sprite.svg 雪碧图、React 组件和预览页。在本地运行，不上传，无需 API 密钥。

## 功能

- **清理**：删除注释、metadata、编辑器属性（inkscape:、sodipodi:、sketch:、data-name）、未使用的 id 和空分组；把 style="fill:…" 移成属性；缩短过长的小数。
- **安全**：去掉 <script>、foreignObject、onclick 一类事件属性和 javascript: 链接。
- **viewBox**：缺失时按宽高补上，可把过宽或过高的图标居中补成正方形。
- **颜色**：单色图标改成 currentColor；多色图标（渐变、徽章）保留原色；也可以把任意图标统一改成一种颜色。
- **命名**：文件名转成小写连字符名字（Star Badge.svg → star-badge），导出前提示重名。
- **导出**：优化后的 SVG、id 已加前缀（渐变不会冲突）的 sprite.svg、React 组件（TSX 或 JSX，带 size 属性）和 index，以及可调颜色和尺寸的 index.html 预览页。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `svg-icon-kit/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “整理 icons 文件夹并生成雪碧图”
- “把这些 SVG 做成 React 组件”
- “单色图标都改成 currentColor”

## 工具

| 工具 | 作用 |
|---|---|
| `svgkit_open` | 读取并清理图标，列出颜色和体积，并打开面板 |
| `svgkit_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `svgkit_status` | 查看当前数据、问题和汇总 |
| `svgkit_export` | 导出优化后的 SVG、sprite.svg、React 组件、index.html 和 icons.csv |

导出文件写到工作区的 `svg-icon-kit/<项目>/` 文件夹。

## 范围（v0.1）

- 面向图标级 SVG；复杂插画也会清理，但不做路径合并等深度优化。
- 图标里的文字依赖查看者电脑上的字体，不会转成路径。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `svg-icon-kit/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/svg-icon-kit/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-svg-icon-kit test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
