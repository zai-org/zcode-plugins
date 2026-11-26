# 餐厅菜单制作

菜单放在表格里维护，就能生成好看的打印菜单和适合手机看的电子菜单。分类、带虚线引导的价格、招牌推荐、辣度、素食和过敏原标记、中英文菜名并排——经典单栏、双栏或紧凑版式，A4、A5 或 Letter 纸张。填上电子菜单的网址，打印菜单上会印出二维码给客人扫。改价格、标记售罄后重新导出即可。在本地运行，不用菜单服务，无需 API 密钥。

## 功能

- **直接用你的表格**：识别 分类、菜名、英文名、价格、描述、过敏原、辣度、推荐、素食 以及英文列名；分类留空时沿用上一行。
- **可直接打印的 PDF**：经典、双栏或紧凑版式；A4、A5 或 Letter；价格虚线引导、推荐角标、辣度圆点、素食和过敏原标记、页码和页脚说明。
- **电子菜单**：一个 menu.html，分类标签吸顶，任何手机都能看，不含脚本。
- **二维码**：填写电子菜单网址后，印在最后一页并另存为 qr.png。
- **价格写法灵活**：数字自动加货币符号；“12/18”“时价”这样的写法原样保留。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `menu-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 菜单.xlsx 做菜单，店名叫青禾小馆”
- “A4 双栏，把麻婆豆腐设成推荐”
- “加一个指向 https://tea.example/menu 的二维码”

## 工具

| 工具 | 作用 |
|---|---|
| `menu_open` | 读取菜品表并预览菜单，并打开面板 |
| `menu_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `menu_status` | 查看当前数据、问题和汇总 |
| `menu_export` | 导出 menu.pdf、menu.html 和 qr.png |

导出文件写到工作区的 `menu-maker/<项目>/` 文件夹。

## 范围（v0.1）

- v0.1 不支持菜品图片。
- 电子菜单是一个文件，需要自己放到网上（任何静态空间都行），二维码才能打开。
- 中文需要电脑上有中文字体（会自动查找）。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `menu-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/menu-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-menu-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：ExcelJS (MIT), pdf-lib (MIT), fontkit (MIT), node-qrcode (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
