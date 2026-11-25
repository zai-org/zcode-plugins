# 应用商店截图制作

把 App 原始截图做成 App Store 和 Google Play 的宣传截图：在屏幕上方或下方加主副标题，套上设备边框，配纯色或渐变背景——多语言、所有商店尺寸一次完成。在侧栏预览并逐张编辑。

## 功能

- **精确的商店尺寸**：iPhone 6.9″ 1320×2868、6.5″ 1284×2778、5.5″ 1242×2208，iPad 13″ 2064×2752，Google Play 手机 1080×1920 和 10″ 平板 1600×2560。导出为**不带透明通道的 RGB PNG**（商店不接受透明图）。
- **设备边框**：iPhone（灵动岛）、安卓（挖孔摄像头）、iPad/平板边框，或无边框加柔和阴影；机身颜色可选。边框按截图比例自动适配，不裁切内容。
- **文字**：粗体主标题和可选副标题，放在上方或下方；自动选择黑/白文字保证对比度，自动缩小到两行内；仍然太长会截断并提示。
- **多语言**：任意数量的商店语言（`zh-Hans`、`en-US`、`ja`…），每张截图按语言分别保存标题。缺少翻译时使用第一种语言的文字并提示。
- **平板截图**：每张可单独指定平板截图用于 iPad / 平板尺寸；只有手机截图时会提示。
- **检查**：标题过长、缺少翻译、截图分辨率不足（会模糊）、超过 10 张（App Store）或 8 张（Google Play）。
- **输出**：`store-screenshots/<语言>/<尺寸>/<序号>-<名称>.png`；设置保存在可复用的 `.storeshots.json`。

## 使用

在 ZCode Desktop 中对 Agent 说：

- “用 screenshots 文件夹里的截图做 App Store 宣传图，每张帮我写一句中英文标题”
- “用深色渐变背景导出 iPhone 6.9″、iPad 和 Google Play 尺寸”
- “把第三张的英文标题改成“Track every order”，只重新导出这一张”

也可以在会话侧栏打开“应用商店截图制作”，按想要的顺序勾选截图。

## 工具

| 工具 | 作用 |
|---|---|
| `shots_open` | 打开截图（路径、文件夹或已保存项目），设置语言、文案和尺寸，检查并打开面板 |
| `project_save` | 保存为 `.storeshots.json` |
| `shots_export` | 导出全部，或按语言、尺寸、截图筛选导出 |

## 范围（v0.1）

- 输入：PNG 和 JPG 截图（模拟器、真机或设计工具导出）。
- v0.1 不包含：上传到 App Store Connect / Google Play Console（请自行上传或用 fastlane）、跨多张的全景背景、倾斜的 3D 设备样机、App 预览视频、Google Play 置顶大图（feature graphic）。
- 设备边框是通用绘制，不是 Apple/Google 的官方营销素材。

## 隐私、网络与文件写入

- **全部在本机处理。** 不联网、不上传、不需要 API 密钥或账号。
- 读取所选截图和系统字体；只在工作区内写文件（默认 `store-screenshots/`，以及你指定的 `.storeshots.json`）。不执行命令，没有 hooks。

## 构建与测试（开发者）

源码在 `ui-plugins/store-screenshot-studio/`。在仓库根目录运行 `pnpm install --frozen-lockfile && pnpm build`，把 `dist/local-marketplace` 添加为 ZCode 插件商店的本地来源后安装。测试：`pnpm --filter @penova/plugin-store-screenshot-studio test`（精确尺寸、无透明通道、颜色、文字、平板截图、警告、项目保存与读取）和 `test:e2e`（浏览器面板测试；可用 `E2E_SCREENS` 指向真实 App 截图）。

## 第三方组件与许可证

插件采用 MIT 许可证（作者：Penova）。打包的依赖：resvg-wasm（MPL-2.0，未修改；源码：https://github.com/yisibl/resvg-js）、fontkit（MIT）、pngjs（MIT）、jpeg-js（BSD-3-Clause）、MCP SDK 与 ext-apps（MIT）。完整清单随包附带于 `dist/THIRD_PARTY_NOTICES.txt`。测试截图为虚构 App 的合成样图。App Store 是 Apple Inc. 的商标，Google Play 是 Google LLC 的商标；本插件与二者无关。
