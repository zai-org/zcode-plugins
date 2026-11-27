# 拼音标注

给中文加注拼音，做儿童读物、课文和生字卡。打开文本或 Markdown 文件，每个字按词语上下文自动注音，多音字逐个列出上下文和可选读音。“还书”“朝阳”“数星星”“种花”和状语“地”这类拼音库常读错的地方会标出建议读音，确认一下就能改；也可以用自定义词语一次改掉全文同一个词。可选声调符号、数字声调或不标调，正文或田字格版式，导出注音 HTML、A4 PDF、可打印的生字卡和纯拼音文本。在本地运行，不用登录，无需 API 密钥。

## 功能

- **按词注音**（银行行长 → yín háng háng zhǎng），“一”“不”自动变调。
- **多音字核对**：每个多音字附上下文、自动读音和可选读音。
- **易错提示**：拼音库常见错误（还书 huán、朝阳 zhāo、数星星 shǔ、种花 zhòng、状语“地” de）。
- **两种改法**：逐个改，或用自定义词语全文统一；可以写 huan2 这样的数字声调。
- **样式**：声调符号、数字或不标调；正文或田字格；第一行居中作标题。
- **导出**：注音 HTML、A4 PDF、生字卡（每页 12 张，附课文里的组词）和拼音文本。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `pinyin-annotator/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “给 lesson.txt 加拼音”
- “把标出来的多音字改对”
- “给“朝背种数”做生字卡”

## 工具

| 工具 | 作用 |
|---|---|
| `pinyin_open` | 注音并列出多音字，并打开面板 |
| `pinyin_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `pinyin_status` | 查看当前数据、问题和汇总 |
| `pinyin_export` | 导出 pinyin.html、pinyin.pdf、cards.pdf 和 pinyin.txt |

导出文件写到工作区的 `pinyin-annotator/<项目>/` 文件夹。

## 范围（v0.1）

- 易错提示只覆盖常见情况，正式出版前请再校对。
- 只给汉字注音，其他文字原样保留。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `pinyin-annotator/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/pinyin-annotator/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-pinyin-annotator test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：pinyin-pro (MIT), pdf-lib (MIT), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
