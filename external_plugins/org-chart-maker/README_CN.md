# 组织架构图

把一份员工名单变成清晰的组织架构图。每人只需要姓名、职位、部门和直属上级，自动排版，按部门或层级配色，人数多的小组会整齐竖排。可以折叠某个分支显示“+N”、限制显示的层数，在“上级”列里改汇报关系——找不到的上级、循环汇报和重名都会标出来。导出 SVG、高清 PNG 和一页 PDF。在本地运行，不用登录，无需 API 密钥。

## 功能

- **只需一列“上级”**：按每人的上级姓名自动建树；没有上级的人放在最上层。
- **整齐排版**：居中的树形结构，不重叠；独立成员超过 N 人的小组竖排，图不会太宽。
- **折叠与层数**：把某个分支折叠成“+N”，或只显示前几层。
- **配色**：按部门（职位下方显示部门）或按层级。
- **自动检查**：上级不在名单里、循环汇报、重名；显示每个人带的团队总人数。
- **导出**：SVG、2 倍 PNG，以及排在一页 A4（大图用 A3）横向的 PDF。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `org-chart-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 staff.csv 画一张组织架构图”
- “马克的上级应该是陈总，改一下，再把赵磊的团队折叠起来”
- “导出 PNG 和 PDF”

## 工具

| 工具 | 作用 |
|---|---|
| `orgchart_open` | 读取员工名单并建立汇报关系树，并打开面板 |
| `orgchart_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `orgchart_status` | 查看当前数据、问题和汇总 |
| `orgchart_export` | 导出 org-chart.svg、org-chart.png 和 org-chart.pdf |

导出文件写到工作区的 `org-chart-maker/<项目>/` 文件夹。

## 范围（v0.1）

- v0.1 不在方框里放照片。
- 每人只有一个直属上级（不支持虚线汇报）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `org-chart-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/org-chart-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-org-chart-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), pdf-lib (MIT), resvg-wasm (MPL-2.0), fontkit (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
