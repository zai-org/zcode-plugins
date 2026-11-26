# 兑换码批量生成

用一张简单的活动批次表，批量生成不重复的优惠码、礼品码、兑换码和可打印的兑换卡。设定码型（如 XXXX-XXXX）、每批的前缀和不含易混字符的字符集，还可以在末尾加校验位，输错能发现。兑换码由种子生成，同一个活动永远得到同样的码；已经发出的码清单也可以选上，绝不会重复。导出给店铺系统用的 CSV，以及印有面值、兑换码、有效期和二维码（可直达兑换页）的兑换卡 PDF。在本地运行，不用发券服务，无需 API 密钥。

## 功能

- **表格定义批次**：识别 批次、前缀、数量、面值、有效期、说明 以及英文列名。
- **好认的码**：码型如 XXXX-XXXX；字母+数字（去掉 0/O/1/I）、仅字母或仅数字。
- **校验位**：可在末尾加校验位（数字用 Luhn 算法），输错的码能被识别。
- **可复现、不重复**：由种子生成；不同批次之间、与已发码清单之间都不会重复。
- **店铺可用的 CSV**：兑换码、批次、面值、有效期、说明和二维码链接，UTF-8 带 BOM，Excel 直接打开。
- **可打印兑换卡**：A4 一页 10 张带裁切线，印面值、兑换码、有效期、说明和二维码（只放码或兑换页网址）。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `coupon-code-generator/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 campaign.csv 生成兑换码，种子 winter-2026，避开 used-codes.txt 里的码”
- “改成纯数字带校验位”
- “二维码放 https://shop.example/redeem?code={code}，导出兑换卡”

## 工具

| 工具 | 作用 |
|---|---|
| `coupon_open` | 读取活动批次表并生成兑换码，并打开面板 |
| `coupon_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `coupon_status` | 查看当前数据、问题和汇总 |
| `coupon_export` | 导出 codes.csv 和 coupon-cards.pdf |

导出文件写到工作区的 `coupon-code-generator/<项目>/` 文件夹。

## 范围（v0.1）

- 只负责生成，不负责登记——要把 codes.csv 导入店铺或收银系统才能使用。
- 种子决定了所有码，不要公开。
- 超大批量（超过 2 万张）只导出 CSV。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `coupon-code-generator/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/coupon-code-generator/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-coupon-code-generator test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), node-qrcode (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
