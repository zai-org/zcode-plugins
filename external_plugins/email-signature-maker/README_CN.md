# 邮件签名批量

让全公司用上统一、好看的邮件签名。选上员工名单，填好公司名、网址和 logo 地址，挑一个模板和主题色，就会给每个人生成一份签名文件，能干净地粘贴到 Gmail、Outlook 或 Apple Mail——用表格和内联样式写成，符合邮件的要求。每人还有一份纯文本版本，另有一个汇总页列出所有签名和设置步骤。在本地运行，不用签名服务，无需 API 密钥。

## 功能

- **直接用员工表**：识别 姓名、英文名、职位、英文职位、部门、手机、电话、邮箱、微信 以及英文列名。
- **适配邮箱的 HTML**：只用表格和内联样式，不含 CSS 类和脚本；电话、邮箱、网址都能点击。
- **三种模板**：经典、logo 在左带分隔线、紧凑两行。
- **logo**：推荐用网上的 https 地址；也可以选本地图片嵌入（会提示兼容性）。
- **纯文本版本**：每人一份；汇总页列出所有签名，附 Gmail、Outlook、Apple Mail 设置步骤。
- **更多**：文字社交链接、免责声明、每人附加一行、中英双语。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `email-signature-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 team.csv 给青禾科技每个人做邮件签名”
- “用 logo 在左的模板，logo 地址是 https://qinghe.example/logo.png”
- “加一段免责声明和博客链接”

## 工具

| 工具 | 作用 |
|---|---|
| `sig_open` | 读取员工名单并预览签名，并打开面板 |
| `sig_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `sig_status` | 查看当前数据、问题和汇总 |
| `sig_export` | 导出 signatures/<名字>.html、.txt 和 index.html |

导出文件写到工作区的 `email-signature-maker/<项目>/` 文件夹。

## 范围（v0.1）

- 社交链接是文字链接，不带品牌图标。
- 在各个邮箱里设置签名需要复制粘贴（附有步骤）。
- 嵌入的 logo 会被部分邮箱拦截，建议用网上的地址。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `email-signature-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/email-signature-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-email-signature-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
