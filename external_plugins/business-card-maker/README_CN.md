# 名片批量制作

一张员工表就能给全公司批量做名片。选上员工名单和公司 logo，填好公司名和网址，就能得到给印刷厂的 PDF（每面一页，带出血、裁切线和成品框）和办公室自己打印用的 A4 拼版。名片上可以印二维码，手机一扫就存进通讯录；每个人还会单独导出一份 .vcf 电子名片。三种正面版式，90×54、85×55 或美式尺寸，中英双语。在本地运行，不用设计服务，无需 API 密钥。

## 功能

- **直接用员工表**：识别 姓名、英文名、职位、英文职位、部门、手机、电话、邮箱、地址 以及英文列名。
- **印刷厂 PDF**：每面一页，带出血、裁切线、TrimBox 和 BleedBox，正反面齐全。
- **办公室 A4 拼版**：一页 10 张，带裁切线；背面左右镜像，双面打印能对齐。
- **名片二维码**：背面或正面印 vCard 二维码，手机一扫就存进通讯录。
- **电子名片文件**：一个包含所有人的 contacts.vcf，外加每人一份 .vcf；欧阳、司马等复姓能正确拆分。
- **三种版式**：左对齐、居中、侧边色条，用你的主题色和 logo。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `business-card-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 team.xlsx 和 logo.png 给青禾科技做名片”
- “换成居中版式，二维码印在正面”
- “导出印刷 PDF 和每个人的电子名片”

## 工具

| 工具 | 作用 |
|---|---|
| `card_open` | 读取员工名单（和 logo）并预览名片，并打开面板 |
| `card_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `card_status` | 查看当前数据、问题和汇总 |
| `card_export` | 导出 cards-print.pdf、cards-a4.pdf 和 vCard 文件 |

导出文件写到工作区的 `business-card-maker/<项目>/` 文件夹。

## 范围（v0.1）

- logo 需为 PNG 或 JPG（v0.1 不读 SVG）。
- 颜色为 RGB；如果印刷厂要求 CMYK，请先确认。
- 中文需要电脑上有中文字体（会自动查找）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `business-card-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/business-card-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-business-card-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), node-qrcode (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
