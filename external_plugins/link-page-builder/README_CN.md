# 个人链接主页

几分钟做好自己的“个人链接主页”：名字、一句简介、圆形头像和一列链接按钮，有六种主题可选。所有内容都在一个 index.html 里——没有脚本、没有追踪、不引用外部文件——可以上传到任何空间或放在自己的域名下，还会生成指向主页的二维码。在表格里编辑链接，重要的可以突出显示，旧的可以隐藏。在本地运行，不用注册链接主页服务，无需 API 密钥。

## 功能

- **一个文件搞定**：头像裁成圆形并嵌入，样式内联，没有 JavaScript，也不请求任何外部资源——又快又保护隐私。
- **六种主题、三种按钮**：简洁白、深色、日落、森林、海洋、黑白；圆角、胶囊或方角按钮；手机上显示良好。
- **表格编辑链接**：表情图标、按钮文字、链接、小字说明、突出显示和显示/隐藏；可以新增行。
- **链接安全规范**：缺 https:// 会自动补上，邮箱变成 mailto:，电话变成 tel:，javascript: 链接会被拒绝。
- **二维码**：生成主页地址的 PNG 和 SVG 二维码，也可以显示在页面底部；带 Open Graph 标签，分享时预览好看。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `link-page-builder/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “用 links.yaml 做我的链接主页，主题用日落”
- “突出网店链接，隐藏 2025 年的活动页”
- “给 https://lin.example 生成二维码”

## 工具

| 工具 | 作用 |
|---|---|
| `linkpage_open` | 读取链接清单并预览主页，并打开面板 |
| `linkpage_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `linkpage_status` | 查看当前数据、问题和汇总 |
| `linkpage_export` | 导出 index.html、qr.png 和 qr.svg |

导出文件写到工作区的 `link-page-builder/<项目>/` 文件夹。

## 范围（v0.1）

- 只生成页面文件，放到哪里由你决定（任何静态空间都可以）。
- 没有点击统计——页面本身就不带任何追踪。
- 不内置品牌图标，请用表情符号作图标。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `link-page-builder/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/link-page-builder/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-link-page-builder test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：yaml (ISC), node-qrcode (MIT), pngjs (MIT), jpeg-js (BSD-3-Clause)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
