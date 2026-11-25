# 访谈纪要

把用户访谈录音和转写整理成需求清单。每条需求都附上受访者原话，每句原话都能从录音对应位置播放。

## 功能

- **导入转写**：
  - 支持的格式：SRT、WebVTT（`<v 名字>`），以及带时间戳的文字导出，例如飞书妙记、腾讯会议的“名字 00:01:02”段落，或 `[00:01:02] 名字: 内容` 这样的行。
  - 以“名字:”开头的行会设定说话人，后面没写名字的行沿用这个说话人。
- **由 Agent 提炼需求**：
  - Agent 读带行号的文字稿（`[u12 01:05 名字]`），提交需求：标题、说明、分类、优先级和原话引用。
  - 每条引用必须指向真实存在的一句话，引用的文字也必须出现在那句话里；不符合的会被丢弃或换成整句，并给出提示。
- **面板**：
  - 左边是需求清单，可设优先级、分类和状态（待确认 / 确认 / 不采纳），点原话前的 ▶ 播放那一段。
  - 右边是按说话人着色的文字稿：可以给说话人改名，两个说话人改成同一个名字会合并；也可以单独纠正某一句的说话人，或用“+ 引用”把一句加到当前选中的需求。
- **导出**（到 `interviews/`）：
  - `名字.md`：需求和原话，后面附完整文字稿。
  - `名字.csv`：每条引用一行，带 UTF-8 BOM，Excel 直接打开不乱码。
  - `名字.html`：独立页面，点原话就从录音对应位置播放，录音按相对路径引用。
  - 工作文件 `名字.interview.json` 用来重新打开、接着整理。重新提炼时，标题相同的需求会保留你设过的状态。

## 使用

在 ZCode Desktop 中对 Agent 说：

- “整理 访谈-0412.m4a 里用户提到的需求，每条附上原话”
- “说话人1是我，说话人2是李女士，改一下名字再整理一遍”
- “把确认过的需求导出成 CSV 和能发给团队的 HTML”

## 工具

| 工具 | 作用 |
|---|---|
| `interview_open` | 打开录音和转写（同名文件自动带上），返回带行号的文字稿并打开面板 |
| `interview_submit` | 保存提炼出的需求和原话（按文字稿校验），可同时给说话人改名 |
| `interview_export` | 导出 Markdown、CSV 和可点击播放的 HTML |

## 需要 ffmpeg

面板中的播放使用电脑上已安装的 ffmpeg，插件不附带。安装方法：macOS 用 `brew install ffmpeg`，Windows 用 `winget install ffmpeg`。如果不在 PATH 中，可在插件设置里填写路径。

## 范围（v0.1）

- 输入：MP3、M4A、WAV、OGG/Opus、AAC、FLAC，或 MP4/MOV/WebM/MKV 里的音频，都要配一份转写。
- **不做语音识别**：请用会议工具或转写工具先导出文字稿。
- 暂不包含：把多场访谈合并成亲和图，或同步到 Jira / 飞书。

## 隐私、网络与文件

- **全部在本地运行**：不联网、不上传，不需要 API 密钥或账号。需求由你在 ZCode 里正在用的 Agent 提炼。
- 只读取录音和转写，只写入工作区的 `interviews/`。
- ffmpeg 以参数数组调用，不经过 shell。没有 hooks。

## 构建与测试（开发者）

- 源码位于 `ui-plugins/interview-notes/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试（需要 ffmpeg）：`pnpm --filter @penova/plugin-interview-notes test` 和 `test:e2e`。
- `E2E_INTERVIEW` 可以指向真实访谈。我们用的是 Wikimedia Commons 上一段 5 分钟的访谈（Rupika Sharma 访谈 Abhinava Srivastava，CC BY 3.0），附 105 条英文字幕。

## 第三方组件与许可

MIT 许可（作者：Penova）。打包的组件：MCP SDK 和 ext-apps（MIT）、zod（MIT）；完整清单见 `dist/THIRD_PARTY_NOTICES.txt`。ffmpeg 不随插件分发。
