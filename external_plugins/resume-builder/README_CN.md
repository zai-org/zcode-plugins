# 简历排版

用普通 Markdown 写简历，得到排版整洁的 PDF、Word 和网页版，并做一遍招聘方会做的检查。板块、经历和要点变成可编辑的表格（调整顺序、隐藏、改写），三种模板（彩色抬头、经典黑白、紧凑），A4 或 Letter。会提示缺少邮箱或电话、结束日期早于开始日期、两段工作之间超过半年的空档、日期格式不统一、以“负责 / 参与 / Responsible for”开头的要点、工作要点里完全没有数字、要点过长、身份证号和年龄婚姻等信息，以及 PDF 超出页数上限。导出 PDF、DOCX、HTML 和整理后的 Markdown。在本地运行，不用登录，无需 API 密钥。

## 功能

- **Markdown 输入**：`# 姓名`、联系方式行、`## 板块`、`### 单位 · 职位 | 时间`、`-` 要点。
- **模板**：彩色抬头、经典黑白、紧凑；主题色；A4/Letter；页数上限。
- **检查**：联系方式、时间先后、超过半年的空档、日期格式、弱动词开头、没有数字的要点、过长要点、身份证号/年龄/婚姻、页数。
- **导出**：PDF（嵌入中文字体）、DOCX、HTML、Markdown。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `resume-builder/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 林小满-简历.md 排成简历”
- “把写错的时间改好，删掉身份证号”
- “导出 PDF 和 Word”

## 工具

| 工具 | 作用 |
|---|---|
| `resume_open` | 读取简历 Markdown，排版并检查，并打开面板 |
| `resume_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `resume_status` | 查看当前数据、问题和汇总 |
| `resume_export` | 导出 resume.pdf、resume.docx、resume.html 和 resume.md |

导出文件写到工作区的 `resume-builder/<项目>/` 文件夹。

## 范围（v0.1）

- 只检查结构和措辞模式，不会替你改写内容，也不对照职位要求打分。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `resume-builder/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/resume-builder/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-resume-builder test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
