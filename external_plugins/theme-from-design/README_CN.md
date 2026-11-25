# 设计稿转店铺主题

把店铺设计稿（截图或效果图）做成 **Shopify Online Store 2.0** 主题。插件提供合规的主题骨架，Agent 按设计稿写 section，每次修改都会检查和预览，最后得到可以上传到 Shopify 的 zip。

## 默认设定（v0.1）

- **平台：只支持 Shopify Online Store 2.0**：带 `{% schema %}` 的 Liquid section、JSON 模板，页眉/页脚用 section 组。
- **校验**：内置检查加上 **Shopify 官方 theme-check**（`@shopify/theme-check-node`，即 `shopify theme check` 的检查引擎）。它和文档数据一起打包，离线运行，使用 recommended 配置。
- **预览**：本地近似渲染（liquidjs + 虚构样例数据），不是 Shopify 的渲染器。
- **上传**：不做。zip 由你自己在 Shopify 后台上传。

## 功能

- **骨架**（`theme_new`）：
  - 文件：`layout/theme.liquid`、页眉/页脚 section 组、JSON 模板（首页、商品、商品系列、页面、购物车、搜索、404）、`product-card` 片段。
  - Sections：公告栏、页眉（Logo + 菜单）、页脚、大图横幅、富文本、图文、精选系列、商品详情、带分页的商品列表、页面、购物车、搜索和 404。
  - 主题设置：`settings_schema.json` / `settings_data.json` 里放设计稿的颜色、字体（Shopify 字体名）、圆角和页面宽度。
  - 语言包和样式：英文和简体中文语言包、`base.css`，以及留给设计稿专属样式的空 `custom.css`。
- **编写**（`theme_write`）：Agent 写 section、模板、CSS 和语言包；路径只能在主题目录内，写完马上检查。
- **内置检查**：
  - Liquid 语法，包括 Shopify 标签 `schema`、`style`、`form`、`paginate`、`section(s)`、`render`。
  - schema 是否合法、section 名不超过 25 个字符、设置类型是否在允许范围内（不允许 `liquid`/`html` 类型）。
  - id 是否重复，下拉和滑块的默认值是否有效。
  - `section.settings.*` / `block.settings.*` 引用的设置必须在 schema 里有定义。
  - JSON 模板和 section 组引用的 section、block 类型和设置必须存在。
  - 必需文件是否齐全。
- **Shopify theme-check**（`theme_check`）：检查缺翻译、缺资源/片段、未知过滤器/对象、弃用的过滤器和字体，并按 Shopify 的 JSON schema 校验，等等。问题标明文件和行号。
- **预览**（`theme_preview` 和面板）：用样例商品、系列、菜单和购物车渲染任意模板，在面板里与设计稿并排对照，可切换桌面（1280 px）和手机（390 px）。
- **打包**（`theme_package`）：主题各目录直接放在 zip 根目录，可在后台“在线商店 → 模板 → 添加模板 → 上传 zip 文件”上传；有错误时不打包。
- **面板**：
  - 从设计稿创建主题。
  - 设计稿与预览并排，可切换模板和设备。
  - 完整检查，可打开任意文件查看。
  - 打包。

## 用法

在 ZCode Desktop 里对 Agent 说：

- “按这张首页设计稿做一个 Shopify 主题”
- “照设计稿加一个订阅邮件的 section”
- “检查主题并打包成可上传的 zip”

## 工具

| 工具 | 作用 |
|---|---|
| `theme_new` | 生成 OS 2.0 骨架，写入品牌色/字体，关联设计稿 |
| `theme_write` | 写入或删除主题文件，并运行内置检查 |
| `theme_check` | 内置检查 + Shopify theme-check |
| `theme_preview` | 用样例数据渲染模板 |
| `theme_package` | 打包成可上传的 zip |

## 范围（v0.1）

- 只支持 Shopify；不支持 Shopline、有赞、WooCommerce。
- 不上传到店铺，不登录 Shopify CLI，不运行 `shopify theme dev`。精确渲染、应用和结账效果请上传后用 Shopify 自己的预览查看。
- 预览只支持常用对象和过滤器，未知过滤器原样返回输入。
- section 里的图片来自商家店铺（`image_picker`），预览中显示占位图。
- 除 theme-check 报告的内容外，不检查主题商店的上架要求（无障碍审核、性能分数等）。

## 隐私、网络与文件

- 本地运行：不联网，不需要 API Key。theme-check 用随包的文档数据离线运行，在线更新文档的功能已关闭；它会在用户缓存目录里建一个空的缓存文件夹。
- 写入 `themes/<名称>/`、`themes/<名称>.zip` 和 `.theme-from-design/`（项目文件和预览）；设计稿只读取。没有 hooks。

## 构建与测试（开发者）

- 源码：`ui-plugins/theme-from-design/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-theme-from-design test`；`THEME_SAMPLES` 指向虚构的设计稿和 sections；`test:e2e` 需要 Chrome。

## 第三方组件与许可

MIT 许可（作者：Penova）。打包了 liquidjs（MIT）、@shopify/theme-check-node / theme-check-common / theme-check-docs-updater / liquid-html-parser / theme-graph（MIT，含主题文档数据）、fflate（MIT）、MCP SDK 和 ext-apps（MIT）、zod（MIT），完整清单见 `dist/THIRD_PARTY_NOTICES.txt`。`node-fetch` 只用于在线更新文档，已替换为空模块。
