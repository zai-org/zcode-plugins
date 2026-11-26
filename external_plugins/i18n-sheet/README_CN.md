# 多语言文案表

把应用的所有语言文案放在一起看：打开各语言的文案文件（JSON 或 YAML），每个键一行、每种语言一列。缺失和空着的文案、对不上的占位符（{name}、%s、{{count}}……）、改动了的 HTML 标签、还没翻译的文字都会标出来。直接在表格里修改，导出 Excel 交给翻译，翻译好的表格再导回来，最后按原格式写回文案文件。在本地运行，不用翻译服务，无需 API 密钥。

## 功能

- **所有语言一张表**：支持 JSON 和 YAML，嵌套或扁平键、数组、Rails 风格的 `ja:` 根节点；语言代码取自文件名或文件夹名（zh-CN.json、fr/common.json）。
- **占位符检查**：{name}、{{name}}、%s、%1$s、%{name}、${name} 和 ICU {count, plural…} 必须和基准语言一致，不一致时不能导出。
- **缺漏与偏差**：缺失或空的文案、只在其他语言里有的键、HTML 标签不同、和基准语言一模一样的文字。
- **和翻译来回交接**：导出 translations.xlsx（缺失单元格标黄、列出占位符），翻译填好后和语言文件一起打开即可导入（也支持 CSV）。
- **原样写回**：保持原格式、嵌套结构、键的顺序和缩进；缺失的文案可以不写、用基准语言填充或写空字符串。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `i18n-sheet/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “打开 locales 里的 en.json、zh.json、ja.yml，看看缺哪些翻译”
- “导出一份给翻译的 Excel”
- “导入翻译好的 ja-done.xlsx，再写回语言文件”

## 工具

| 工具 | 作用 |
|---|---|
| `i18n_open` | 把各语言文件读成一张表并检查，并打开面板 |
| `i18n_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `i18n_status` | 查看当前数据、问题和汇总 |
| `i18n_export` | 写回各语言文件，并导出 translations.xlsx |

导出文件写到工作区的 `i18n-sheet/<项目>/` 文件夹。

## 范围（v0.1）

- 一次处理一个命名空间（比如各语言的 common.json），其他命名空间请分开建项目。
- 本身不做翻译，不调用机器翻译服务。
- 写回 YAML 时不保留注释和锚点。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `i18n-sheet/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/i18n-sheet/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-i18n-sheet test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), yaml (ISC)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
