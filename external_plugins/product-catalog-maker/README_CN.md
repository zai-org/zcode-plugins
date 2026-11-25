# 商品目录制作

用商品表格和图片文件夹生成可直接打印的 A4 产品目录 PDF 和可编辑的网页版。表格一改就重新生成，并告诉你新增、下架和改价了哪些商品。

## 功能

- **读取表格**（CSV、TSV、XLSX；中文 Excel 导出的 GBK 编码 CSV 也能读），自动识别常见中英文列名：编号/货号/SKU、名称、规格、卖点/描述、价格/售价、原价/划线价、图片、分类、单位。任何列都可以手动对应。
- **自动找图**：按图片列（文件名，不区分大小写，可带或不带扩展名），或用编号当文件名，在图片文件夹（含子文件夹）里查找。支持 JPG 和 PNG；大图会自动缩小，PDF 体积更小。
- **A4 目录 PDF**：封面（logo、标题、副标题、商品数量、日期）和带页码的目录页；按分类分节；每页 2×2、2×3、3×3 或 3×4 个商品；页眉有 logo 和分类名，页脚有联系方式和页码；价格用品牌色突出，原价加删除线，显示编号和规格；缺图显示“暂无图片”占位。**文字是真正的文字**（中文字体以子集方式嵌入），PDF 可搜索、可复制。
- **可编辑网页版**：一个自包含的 `catalog.html`（图片内嵌）——点击任意文字即可修改，用浏览器打印成 PDF。
- **检查**：缺名称、价格不是数字、缺价格、编号重复、缺图或图片找不到、图片分辨率太低、名称太长放不下。
- **变更清单**：每次生成都会保存 `catalog.json`；下次生成时对比并写出 `changes.md` / `changes.csv`（新增、下架、价格/名称/分类/图片变化）。

## 使用

在 ZCode Desktop 中对 Agent 说：

- “用 products.xlsx 和 images 文件夹里的图片做一本产品目录 PDF，每行 3 个，封面放我们的 logo”
- “表格里改了几个价格，重新生成目录并告诉我改了哪些”
- “目录里哪些商品缺图片或价格？”

也可以在会话侧栏打开“商品目录制作”，选择表格和图片文件夹。左边是样式和列对应，右边是问题列表和实时页面预览。

## 工具

| 工具 | 作用 |
|---|---|
| `catalog_open` | 读表格、对应列、匹配图片、检查、规划页面并打开面板 |
| `project_save` | 把设置保存为 `.catalogmaker.json` |
| `catalog_build` | 生成 `catalog.pdf`、`catalog.html`、`catalog.json` 和变更清单 |

## 范围（v0.1）

- A4 纵向、每页网格排版；每本目录一种语言。
- logo 支持 PNG 或 JPG（SVG logo 请先导出为 PNG）。
- v0.1 不包含：InDesign/Word 导出、自由排版、多语言并排、印刷出血 / CMYK、二维码。

## 隐私、网络与文件写入

- **全部在本机处理。** 不联网、不上传、不需要 API 密钥或账号。
- 读取所选表格、图片、logo 和系统字体；只在工作区内写文件（默认 `catalog/`，以及你指定的 `.catalogmaker.json`）。不会修改表格和图片。不执行命令，没有 hooks。

## 构建与测试（开发者）

源码在 `ui-plugins/product-catalog-maker/`。在仓库根目录运行 `pnpm install --frozen-lockfile && pnpm build`，把 `dist/local-marketplace` 添加为 ZCode 插件商店的本地来源后安装。测试：`pnpm --filter @penova/plugin-product-catalog-maker test`（列识别、图片匹配、问题检查、PDF/HTML 输出、变更清单）和 `test:e2e`（浏览器面板测试；可用 `E2E_CATALOG` 指向含 `products.csv` 和图片的文件夹）。

## 第三方组件与许可证

插件采用 MIT 许可证（作者：Penova）。打包的依赖：pdf-lib（MIT）、fontkit（MIT）、ExcelJS（MIT）、pngjs（MIT）、jpeg-js（BSD-3-Clause）、pdf.js（Apache-2.0，面板预览）、MCP SDK 与 ext-apps（MIT）。完整清单随包附带于 `dist/THIRD_PARTY_NOTICES.txt`。测试图片来自 Wikimedia Commons（CC0 / 公有领域，见 `ui-plugins/product-catalog-maker/test/fixtures/SOURCES.md`），不包含在安装包中。
