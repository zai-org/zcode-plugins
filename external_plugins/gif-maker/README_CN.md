# 视频转动图

把录屏或视频片段转成体积小的 GIF 或 WebP 动图，放进文档、聊天和问题反馈里。可以裁剪时间、设置帧率、宽度和倍速、倒放，选择颜色数和抖动方式，还能设体积上限：超过了会自动降低参数重新生成。导出前能看到开头、中间和结尾的画面。使用电脑上已安装的免费 ffmpeg，不上传，无需 API 密钥。

## 功能

- **裁剪**：按秒或分:秒；结束留空表示到结尾。
- **尺寸**：帧率、宽度（高度按比例）、0.25–8 倍速、倒放。
- **画质**：GIF 每段单独调色板，2–256 色，Bayer/Sierra/不抖动；WebP 质量 1–100。
- **体积上限**：设定最大 MB，超了就降帧率、再缩小宽度，最多重试 5 次。
- **预览**：生成前显示开头、中间、结尾画面和预计体积。
- **批量**：多个视频或整个文件夹；附带实际大小的 CSV 报告。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `gif-maker/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 demo.mp4 第 2 到 6 秒做成 480 宽的 GIF”
- “把这段录屏做成 2MB 以内的 WebP”
- “两倍速循环播放的动图”

## 工具

| 工具 | 作用 |
|---|---|
| `gif_open` | 读取视频信息并显示开头、中间、结尾画面，并打开面板 |
| `gif_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `gif_status` | 查看当前数据、问题和汇总 |
| `gif_export` | 生成 GIF/WebP 和 gif-report.csv |

导出文件写到工作区的 `gif-maker/<项目>/` 文件夹。

## 范围（v0.1）

- 需要先安装免费的 ffmpeg（macOS：brew install ffmpeg；Windows：winget install ffmpeg）。
- 不加字幕、不在画面上绘制；不保留声音。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `gif-maker/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/gif-maker/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-gif-maker test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：Uses the user's installed ffmpeg (LGPL/GPL, not bundled)、MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
