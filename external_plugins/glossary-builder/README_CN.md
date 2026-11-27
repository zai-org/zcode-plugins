# 术语表整理

把一堆资料整理成双语术语表。打开文本、Markdown 文件或文件夹（中文、英文都行），自动找出反复出现的术语和复合词，每个附一句例句，并把被长词包含的碎片合并掉。资料里“会员积分（Loyalty Points）”这种带括号译名的写法会直接拿来当译文；如果一起选了旧术语表，也会合并进来，旧表和资料译法不一致时会提醒。去掉无关词、补全或修改译文、手动添加术语，然后导出 Excel、CSV、Markdown，以及 Trados、memoQ 等翻译软件用的 TBX。在本地运行，不用登录，无需 API 密钥。

## 功能

- **中英文术语提取**：反复出现的 1-4 词短语和复合词，按频次、长度和跨文件分布排序，去掉被包含的碎片。
- **从正文取译名**：识别“中文（English）”和“English（中文）”写法。
- **合并旧术语表**：选入 CSV/XLSX，译文和备注自动带入，与资料不一致时提示。
- **每个术语附例句**。
- **编辑**：保留/去掉、填写译文、加备注和新术语；重新扫描后修改仍保留。
- **导出**：XLSX（缺译文的标黄）、CSV、Markdown 和 TBX-Basic。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `glossary-builder/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 docs 文件夹整理一份术语表”
- “储值卡统一译成 Stored Value Card，再加一条 满减 = Spend-and-save”
- “导出 TBX 给翻译软件用”

## 工具

| 工具 | 作用 |
|---|---|
| `glossary_open` | 读取资料并提取候选术语，并打开面板 |
| `glossary_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `glossary_status` | 查看当前数据、问题和汇总 |
| `glossary_export` | 导出 glossary.xlsx、glossary.csv、glossary.tbx 和 glossary.md |

导出文件写到工作区的 `glossary-builder/<项目>/` 文件夹。

## 范围（v0.1）

- 候选词基于统计，发布前请人工过一遍。
- 不做机器翻译：译文来自资料、旧术语表或手动填写。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `glossary-builder/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/glossary-builder/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-glossary-builder test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：exceljs (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
