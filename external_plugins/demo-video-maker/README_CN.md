# 产品演示视频制作

把产品录屏做成可以直接发布的演示视频：剪掉多余部分、在正在操作的地方平滑放大、加说明文字、字幕和片头。产品更新后只换其中一段录屏，其余部分不动、也不用重新渲染。

## 功能

- **分段时间线**：一段 = 一个演示步骤（录屏文件 + 入点/出点）。可调整顺序、删除、添加；同一个录屏可以切成多段。
- **放大**：在面板画面上拖一个框，就在当前时间加一个放大（0.45 秒缓入缓出，默认 2.5 秒）。放大框自动保持画面比例；重叠的放大会自动缩短。
- **说明文字**：圆角说明条（上方或下方），带品牌强调色，淡入淡出；中文自动换行。
- **字幕**：烧录到画面，同时导出全片 `.srt`（时间已按片头和前面各段偏移）。
- **片头**：标题 + 副标题，品牌渐变背景。
- **输出**：1920×1080、1280×720、竖屏 1080×1920 或方形 1080×1080；H.264 + AAC 的 MP4（`+faststart`，网页可直接播放）。录屏没有声音时自动补静音轨。
- **只重渲染改动的段**：每段按内容和录屏文件的修改时间缓存（`.demo-cache/`）。`demo_replace_segment` 换录屏后，只有这一段重新渲染，其余段直接复用再拼接。
- 工程保存为 `.demovideo.json`，可以继续修改。

## 使用

在 ZCode Desktop 中对 Agent 说：

- “用 录屏 文件夹里的几段录屏做一个产品演示视频：每一步放大到我点的按钮，再加一句说明”
- “注册页改版了，把‘注册’这一段换成 signup-v2.mov，重新生成”
- “给演示视频加一个片头‘三步生成月度报表’，再配上中文字幕”

也可以在会话侧栏打开“产品演示视频制作”：左边是段列表、片头和画面设置；右边是当前段的画面（拖动时间条看任意一帧、拖框加放大）和放大/说明/字幕列表。点“渲染视频”生成成片，下方显示成片的关键帧。

## 工具

| 工具 | 作用 |
|---|---|
| `demo_open` | 用录屏新建草稿（每个录屏一段），或打开已有工程；打开面板 |
| `demo_save` | 校验并保存工程（时间夹到录屏长度内，说明哪些地方被修正） |
| `demo_replace_segment` | 替换某一段的录屏（保留或清空该段的放大、说明、字幕） |
| `demo_render` | 渲染 MP4 和 SRT，只重渲染改动过的段 |

## 需要 ffmpeg

插件使用你电脑上已安装的 ffmpeg（不随插件分发）。macOS：`brew install ffmpeg`；Windows：`winget install ffmpeg`；Linux：用系统包管理器。不在 PATH 里时，在插件设置中填写 ffmpeg 路径。

## 范围（v0.1）

- 输入：MP4、MOV、WebM、MKV、M4V 录屏。
- 不包含：自动识别鼠标点击位置、配音/语音识别、转场特效、背景音乐（可以用 video-agent-kit 等插件补充）。

## 隐私、网络与文件写入

- **全部在本机处理。** 不联网、不上传、不需要 API 密钥或账号。
- 只读取你选的录屏和系统字体；只在工作区内写文件：工程 `.demovideo.json`、成片 MP4/SRT、以及成片旁边的 `.demo-cache/`（段缓存，可随时删除）。插件只以参数数组方式调用 ffmpeg / ffprobe（不经过 shell），没有 hooks。

## 构建与测试（开发者）

源码在 `ui-plugins/demo-video-maker/`。在仓库根目录运行 `pnpm install --frozen-lockfile && pnpm build`，把 `dist/local-marketplace` 添加为 ZCode 插件商店的本地来源后安装。测试（需要 ffmpeg）：`pnpm --filter @penova/plugin-demo-video-maker test`（工程校验、SRT 偏移、渲染、缓存复用、替换段只重渲染一段）和 `test:e2e`（浏览器面板测试；`E2E_RECORDINGS` 可指向真实录屏）。

## 第三方组件与许可证

插件采用 MIT 许可证（作者：Penova）。打包的依赖：resvg-wasm（MPL-2.0，未修改，源码 https://github.com/yisibl/resvg-js）、fontkit（MIT）、pngjs（MIT）、jpeg-js（BSD-3-Clause）、MCP SDK 与 ext-apps（MIT）。完整清单见 `dist/THIRD_PARTY_NOTICES.txt`。ffmpeg 不随插件分发。
