# 视频截帧

从视频里截取画面并做成小样图。可以按场景变化截取（每次换镜头或换幻灯片取一张，拍摄素材、幻灯片和录屏都能调），也可以每隔 N 秒截一张，或者平均截 N 张。每一帧是一行，改时间就能挪位置，可以加标签、取消勾选，或者在指定时间点加一帧。淡入淡出时的黑帧、几乎重复的帧、超出视频结尾的时间都会提示。导出 JPG 或 PNG 图片（按视频名、序号、时间和标签命名）、带时间码的小样图 PNG，以及 CSV 帧列表。在本地用 ffmpeg 运行，不用登录，无需 API 密钥。

## 功能

- **场景检测**：每次换镜头或换幻灯片后截一张，可设最小间隔，幻灯片可调灵敏度。
- **间隔 / 张数**模式，可跳过开头和结尾。
- **可编辑列表**：改时间挪位置、加标签、取消勾选或指定时间加帧。
- **检查**：黑帧（淡入淡出）、几乎重复、超出结尾、场景太少时给出建议。
- **导出**：JPG/PNG 图片（可限制宽度）、带时间码的小样图 PNG、CSV。
- **面板**：在 ZCode 侧栏里选择输入文件、调整设置、查看问题、直接修改表格里的任意单元格、预览成品并导出。修改保存在 `video-frame-grabber/<项目>.project.json`，重新打开输入文件前一直保留。

## 使用方法

在 ZCode 桌面端对助手说：

- “把 茶课第3讲.mp4 每次换幻灯片截一张”
- “第一张标成“封面”，再在 00:40 加一张”
- “导出帧图片和小样图”

## 工具

| 工具 | 作用 |
|---|---|
| `frames_open` | 读取视频并找出要截的画面，并打开面板 |
| `frames_edit` | 修改设置、按行修改单元格、新增或删除行 |
| `frames_status` | 查看当前数据、问题和汇总 |
| `frames_export` | 导出 frames/、contact-sheet.png 和 frames.csv |

导出文件写到工作区的 `video-frame-grabber/<项目>/` 文件夹。

## 范围（v0.1）

- 需要安装 ffmpeg（免费；macOS：brew install ffmpeg；Windows：winget install ffmpeg）。
- 每个项目最多 200 帧。v0.1 面板里不能播放视频。

## 隐私、网络与文件

- **全部在本地运行。** 不联网、不上传，不需要 API 密钥或账号。
- 只读取你选择的文件，只写入工作区的 `video-frame-grabber/` 文件夹。没有 Hook。

## 构建与测试（开发者）

- 源码：`ui-plugins/video-frame-grabber/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-video-frame-grabber test` 和 `test:e2e`（需要 Chrome；样例文件在 `test/samples/`）。

## 第三方组件与许可证

MIT 许可（作者：Penova）。打包的组件：MCP SDK 与 ext-apps（MIT）、zod（MIT）；完整列表见 `dist/THIRD_PARTY_NOTICES.txt`。
