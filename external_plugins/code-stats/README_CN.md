# 代码统计报告

统计一个项目的代码量：40 多种语言的代码行、注释行、空行，按文件夹汇总，并列出最大的文件。遵守项目的 .gitignore，跳过 node_modules、.git 和构建目录，并提示压缩或自动生成的文件，避免把数字撑大。可以排除文件夹或规则、取消单个文件，然后导出带柱状图的 HTML 报告、Excel 明细和 CSV 汇总。在本地运行，不上传，无需 API 密钥。

## 功能

- **40 多种语言**：按扩展名识别，并按各语言自己的注释写法（//、#、--、/* */、<!-- -->、Python 文档字符串）区分注释行。
- **遵守 .gitignore**：支持常见写法（目录、*、**、以 / 开头）；node_modules、.git、dist、build 等目录始终跳过。
- **生成代码提示**：超长行的文件（压缩包、第三方库）会被标出并默认不计入。
- **排除规则**：如 `tests/, *.min.js, vendor/**`，也可以在表格里取消单个文件。
- **导出**：带柱状图、语言表、文件夹表和最大文件列表的 HTML 报告；Excel 明细（语言、文件夹、文件三张表）；CSV 语言汇总。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `code-stats/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “统计一下 tea-shop 项目每种语言有多少行代码”
- “不要算 scripts 文件夹和 vendor 里的文件”
- “导出 HTML 报告和 Excel”

## 工具

| 工具 | 作用 |
|---|---|
| `codestats_open` | 扫描项目文件夹，按文件和语言统计行数，并打开面板 |
| `codestats_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `codestats_status` | 查看当前数据、问题和汇总 |
| `codestats_export` | 导出 code-stats.html、code-stats.xlsx 和 languages.csv |

导出文件写到工作区的 `code-stats/<项目>/` 文件夹。

## 范围（v0.1）

- 按行用简单规则分类；字符串里出现的注释符号可能被算作注释。
- 不支持 .gitignore 里以“!”开头的反向规则（会给出提醒）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `code-stats/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/code-stats/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-code-stats test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
