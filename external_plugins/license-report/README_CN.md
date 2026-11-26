# 依赖许可证清单

弄清楚你的产品里带了哪些许可证：扫描 Node.js 项目已安装的依赖（直接和间接依赖，npm、yarn、pnpm 都支持），把每个包的许可证规范成 SPDX 名称，并分成宽松、弱 copyleft、强 copyleft、专有和未知几类。GPL/AGPL 和没写许可证的包会被标出，直到你审核过为止；可以手动修正许可证并写备注。导出给法务看的 Excel 报告，以及随产品发布的 THIRD_PARTY_NOTICES.txt。在本地读取 node_modules，不联网查询，无需 API 密钥。

## 功能

- **所有已安装的包**：遍历 node_modules（包括嵌套目录和 pnpm 的 .pnpm 结构），没有时退回读取 package-lock.json；显示直接/间接依赖和生产/开发依赖。
- **找到并规范许可证**：读取 package.json 的 license/licenses，没有就从 LICENSE 文件内容识别；“Apache 2.0”“MIT License”“GPLv3” 以及 SPDX 的 OR/AND 表达式都会规范化。
- **风险分类**：宽松、公有领域、弱 copyleft（LGPL、MPL、EPL）、强 copyleft（GPL、AGPL、SSPL）、专有和未知——有风险的会一直标出，直到标记为已审核。
- **可修正并备注**：给某个包填入正确的许可证并写明原因，“来源”列会显示为手动修改。
- **两种输出**：按类别标色、附许可证汇总的 Excel 报告，以及包含生产依赖版权行和许可证全文的 THIRD_PARTY_NOTICES.txt。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `license-report/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “列出 web-app 所有依赖的许可证”
- “哪些包是 GPL 或者没写许可证？”
- “为发布版生成 THIRD_PARTY_NOTICES.txt”

## 工具

| 工具 | 作用 |
|---|---|
| `licenses_open` | 扫描已安装的依赖并给许可证分类，并打开面板 |
| `licenses_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `licenses_status` | 查看当前数据、问题和汇总 |
| `licenses_export` | 导出 license-report.xlsx 和 THIRD_PARTY_NOTICES.txt |

导出文件写到工作区的 `license-report/<项目>/` 文件夹。

## 范围（v0.1）

- v0.1 只支持 Node.js 项目（Python、Go 等以后再加）。
- 依赖需已安装（或有 package-lock.json），不会从 npm 仓库下载任何内容。
- 这是辅助工具，不构成法律意见——copyleft 相关结论请交给专业人士确认。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `license-report/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/license-report/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-license-report test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
