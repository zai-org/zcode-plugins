# 中文文本排版清洗

清理 Markdown 和纯文本中的中文、中英混排：中文句子里的半角标点、全角字母数字、省略号和破折号、直引号、中英文和数字之间的空格、标点前后多余的空格、连续空格和多余空行。代码块、行内代码、链接地址和 front matter 不会改动。每一处修改都能对照查看，可以跳过或手动改，然后导出清洗后的文件副本、diff 和修改清单，原文件保持不变。在本地运行，不上传，无需 API 密钥。

## 功能

- **标点**：中文里的半角 , . ! ? : ; ( ) 改为全角；… 和 -- 改为 …… 和 ——；中文句子里的直引号改为 “ ”。
- **空格**：中文与英文、数字、行内代码之间加空格；全角标点前后不留空格；连续空格合并。
- **全半角**：全角字母数字（ＡＢＣ１２３）改为半角。
- **行**：删除行尾空格和多余空行；可选把“！！！”合并为“！”。
- **不破坏 Markdown**：代码块、行内代码、链接地址、图片、HTML 标签、公式和 front matter 不动；纯英文行不改。
- **先审阅**：每处修改前后对照高亮，可以跳过或手动改；切换规则后选择仍保留。
- **导出副本不覆盖**：清洗后的文件单独存放，另附 diff 和修改清单 CSV。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `text-cleanup/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “整理 draft.md 的标点”
- “给 docs 文件夹加中英文空格”
- “先给我看会改哪些地方”

## 工具

| 工具 | 作用 |
|---|---|
| `cleanup_open` | 读取文件并列出所有要修改的行，并打开面板 |
| `cleanup_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `cleanup_status` | 查看当前数据、问题和汇总 |
| `cleanup_export` | 导出清洗后的副本、changes.diff 和 changes.csv |

导出文件写到工作区的 `text-cleanup/<项目>/` 文件夹。

## 范围（v0.1）

- UTF-8 编码的 .md、.txt；不修改 Word 文档。
- 只做排版，不做错别字和语法检查。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `text-cleanup/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/text-cleanup/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-text-cleanup test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：jsdiff (BSD-3-Clause)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
