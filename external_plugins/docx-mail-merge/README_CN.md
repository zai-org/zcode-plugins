# Word 批量套打

用表格批量填写 Word 模板里的 {{字段}}，每行生成一份 .docx（录用通知、合同、通知书、证明等），格式、表格、页眉页脚原样保留。检查缺少的列和空值，在面板里改数据、预览第一份文档，导出全部文件和 zip 压缩包。在本地运行，无需 API 密钥。

## 功能

- **模板**：在 Word 里任意位置输入 `{{姓名}}` 这样的占位符——正文、表格、页眉页脚、脚注都可以。即使 Word 把一个占位符拆进了不同格式的几段文字也能识别，替换后的文字沿用占位符第一个字的格式。
- **数据**：.xlsx 或 .csv，列名要和字段名一致。多行内容会变成换行。
- **检查**：模板字段在表格里找不到对应列（会阻止导出）、表格里没用到的列、有空值的行、重复的文件名。
- **文件名**：用 `{姓名}-录用通知书` 这样的规则，`{n}` 是序号。
- **输出**：每行一份 .docx，可选把全部文件打成 zip，另附 CSV 记录每份文件的空字段。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `docx-mail-merge/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 人事/offer-template.docx 和 人事/new-hires.xlsx 给每个人生成一份录用通知书，文件名用姓名”
- “Alex Turner 的上级填王磊”
- “生成 Word 文件并打包成 zip”

## 工具

| 工具 | 作用 |
|---|---|
| `merge_open` | 读取模板里的占位符和表格数据，并打开面板 |
| `merge_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `merge_status` | 查看当前数据、问题和汇总 |
| `merge_export` | 为每行生成 documents/<文件名>.docx，并导出 all-documents.zip 和 merge-log.csv |

导出文件写到工作区的 `docx-mail-merge/<项目>/` 文件夹。

## 范围（v0.1）

- v0.1 只做文字替换：不支持条件段落、重复表格行、图片或 Word 自带的邮件合并域（MERGEFIELD）。
- 输出为 DOCX（需要 PDF 可在 Word 或 WPS 里另存）。旧的 .doc 模板请先另存为 .docx。
- 不会发送邮件。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `docx-mail-merge/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/docx-mail-merge/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-docx-mail-merge test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：fflate (MIT), ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
