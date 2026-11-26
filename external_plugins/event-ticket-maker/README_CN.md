# 活动门票签到

用一张表格给活动发二维码门票、做签到。选上嘉宾名单，填好活动名称、时间和地点，每位嘉宾都会拿到一个唯一、难以猜到的票号。可以 A4 一页打印 3 张带撕线存根的门票，也可以每人导出一份 PDF 电子票发出去，另附一份带签名栏的签到表。活动当天，把扫码枪导出的记录和名单一起选上，就能看到谁已经到场——不在名单上的、输错的、重复扫的都会标出来。重新打开名单时票号保持不变。在本地运行，不用票务服务，无需 API 密钥。

## 功能

- **直接用嘉宾名单**：识别 姓名、票种、座位、手机、邮箱 以及英文列名；表里已有的票号会保留。
- **安全的票号**：前缀-XXXX-XXXX，带校验位，不用 0/O、1/I 等易混字符，输错能发现。
- **票号不变**：同一份名单重新打开时沿用已发出的票号和手动签到记录。
- **门票**：A4 一页 3 张，带可撕下的二维码存根；也可一页一张用于发送，并给每人单独导出 PDF。
- **签到**：把扫码记录（CSV、XLSX 或 TXT）和名单一起选上；陌生票号、输错的票号、重复扫码都会标出。
- **签到表**：按姓名排列，含签到时间和签名栏，另有按票种的汇总。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `event-ticket-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 guests.csv 给青禾产品发布会做门票，时间 2026-11-28 14:00”
- “每位嘉宾导出一张电子票”
- “这是门口的扫码记录 scans.csv，还有谁没到？”

## 工具

| 工具 | 作用 |
|---|---|
| `ticket_open` | 读取嘉宾名单（和扫码记录）并分配票号，并打开面板 |
| `ticket_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `ticket_status` | 查看当前数据、问题和汇总 |
| `ticket_export` | 导出 tickets.pdf、每人一份电子票和 checkin.xlsx |

导出文件写到工作区的 `event-ticket-maker/<项目>/` 文件夹。

## 范围（v0.1）

- 扫码用任意能导出列表的扫码枪或手机应用，本插件读取导出的记录。
- 不会替你发邮件，每人一份的电子票需要自己发送。
- 票号记录在 event-ticket-maker/ticket-codes.json，保留这个文件票号才能保持不变。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `event-ticket-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/event-ticket-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-event-ticket-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), node-qrcode (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
