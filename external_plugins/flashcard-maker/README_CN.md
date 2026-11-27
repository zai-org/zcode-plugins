# 单词卡制作

把词表变成可以双面打印的单词卡，以及可以导入背诵软件的文件。可以用表格（单词、音标/拼音、释义、例句、标签），也可以用纯文本词表。每页 8、9、10、12、18 或 24 张，背面自动镜像排版，双面打印（长边或短边翻转）后正反面对齐。文字自动缩放，带裁切虚线和卡片编号；也可以反向制作（看释义想单词）。可以修改或跳过个别卡片，然后导出打印 PDF、带标签的 Anki 导入文件和通用 CSV（Quizlet 等）。在本地运行，不用登录任何 App，无需 API 密钥。

## 功能

- **任何词表**：表格列 单词、音标/拼音、释义、例句、标签；或每行“单词<Tab>释义”“单词 - 释义”的纯文本。
- **双面打印对得齐**：按长边或短边翻转自动镜像背面；也可以正面、背面分开打印。
- **每页张数**：A4 或 Letter 上 2×4、2×5、3×3、3×4、3×6、4×6，带裁切虚线和编号。
- **文字自动适应卡片**：单词和释义自动缩小到放得下；仍然放不下的会提示。
- **反向模式**：释义在正面，单词在背面。
- **Anki 导入**：anki.tsv 含正面、背面（含音标和例句）、标签和卡组名；cards.csv 可导入 Quizlet 等。
- **检查**：单词重复、正面或背面为空。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `flashcard-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 words.xlsx 做单词卡，每页 9 张”
- “音标放在背面”
- “导出 Anki 导入文件”

## 工具

| 工具 | 作用 |
|---|---|
| `flashcards_open` | 读取词表并排版单词卡，并打开面板 |
| `flashcards_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `flashcards_status` | 查看当前数据、问题和汇总 |
| `flashcards_export` | 导出 flashcards.pdf、anki.tsv 和 cards.csv |

导出文件写到工作区的 `flashcard-maker/<项目>/` 文件夹。

## 范围（v0.1）

- 只做文字卡，不含图片和音频。
- Anki 文件导入为基础笔记类型，不会同步到 AnkiWeb。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `flashcard-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/flashcard-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-flashcard-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
