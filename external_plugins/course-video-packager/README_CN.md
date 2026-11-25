# 课程视频整理

把一整段课程录像整理成可以直接上传的发布包：章节视频、每章字幕、每章封面、课程目录和 zip。

## 功能

- **规划章节**：打开录像时，插件找出较长的停顿（ffmpeg 静音检测）和字幕空隙，并把字幕整理成带时间戳的文字稿交给 Agent；Agent 按内容提出章节（标题 + 开始时间 + 简介），你在面板里调整。
- **面板**：彩色章节时间轴（含停顿标记和字幕分布）、可编辑的章节表（开始时间、标题、简介）、任意时间的画面预览、“在这里开新章”。
- **发布包**（默认 `course-package/`）：
  - `chapters/NN-标题.mp4`：精确切分（重新编码 H.264/AAC）或快速切分（不重编码，切点落在关键帧）；
  - `chapters/NN-标题.srt / .vtt`：从整段字幕中切出并把时间平移到从 0 开始，跨章的字幕会裁开；
  - `covers/NN-标题.jpg` 每章封面（章节画面 + 编号 + 标题），`cover.jpg` 课程封面；
  - `index.md` 课程目录（时长、文件链接、简介，以及可直接贴到视频平台简介的章节时间列表）、`chapters.json`、`chapters.csv`；
  - `<课程名>.zip` 打包以上全部；`course.json` 保存章节方案，可以重新打开修改再生成。

## 使用

在 ZCode Desktop 中对 Agent 说：

- “把 第3讲.mp4 按讲的内容分成章节，做成发布包”
- “按我给的章节时间和标题切分，字幕也按章切开”
- “用快速切分重新生成课程包，封面换成红色”

## 工具

| 工具 | 作用 |
|---|---|
| `course_open` | 打开录像（自动带上同名字幕），返回停顿、文字稿，打开面板 |
| `course_save` | 校验并保存章节方案 |
| `course_build` | 生成章节视频、字幕、封面、目录和 zip |

## 需要 ffmpeg

使用你电脑上已安装的 ffmpeg（不随插件分发）。macOS：`brew install ffmpeg`；Windows：`winget install ffmpeg`。不在 PATH 里时在插件设置中填写路径。

## 范围（v0.1）

- 输入：MP4、MOV、WebM、MKV、M4V；字幕 SRT / VTT。
- 不包含语音识别：没有字幕时仍可按时间分章（没有每章字幕）；需要字幕可先用 video-agent-kit 等工具生成。
- 不包含：课件 PPT 提取、上传到视频平台。

## 隐私、网络与文件写入

- **全部在本机处理。** 不联网、不上传、不需要 API 密钥或账号。
- 只读取你选的录像、字幕和系统字体；只在工作区的输出文件夹里写文件。ffmpeg 以参数数组方式调用（不经过 shell），没有 hooks。

## 构建与测试（开发者）

源码在 `ui-plugins/course-video-packager/`。`pnpm install --frozen-lockfile && pnpm build` 后把 `dist/local-marketplace` 添加为本地来源。测试（需要 ffmpeg）：`pnpm --filter @penova/plugin-course-video-packager test` 和 `test:e2e`（`E2E_COURSE` 可指向真实课程录像，测试时用的是 Wikimedia Commons 上 MITx 6.002x 的 11 分钟课程介绍，CC BY 2.0）。

## 第三方组件与许可证

插件采用 MIT 许可证（作者：Penova）。打包的依赖：resvg-wasm（MPL-2.0，未修改，源码 https://github.com/yisibl/resvg-js）、fontkit（MIT）、fflate（MIT）、pngjs（MIT）、jpeg-js（BSD-3-Clause）、MCP SDK 与 ext-apps（MIT）。完整清单见 `dist/THIRD_PARTY_NOTICES.txt`。ffmpeg 不随插件分发。
