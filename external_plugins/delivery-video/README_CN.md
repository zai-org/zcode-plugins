# delivery-video

把**真实运行**的功能做成可信交付演示视频的 skill 插件——真实录屏、合成旁白、逐字对齐字幕，加一道拒绝放过造假或残次演示的确定性质量闸。

大多数「AI 演示视频」是静态截图、mock 页面或旧录屏拼出来的。这个插件强制相反的纪律：每个镜头必须指向一段真实录屏和可追溯的时间区间，最后一镜必须落在已回读验证的结果状态上，成片必须先过硬检查（分辨率/帧率/编码、音轨、响度、黑帧、冻结帧）才允许外发。码率密度会作为信息项保留，关键页面仍需按 1:1 目检。贴出去的文件永远是过闸的那一个文件，用 SHA256 绑定。

在 DeepSeek Harness 中，该 Skill 会同时注册到 Host 与每个 Agent 作用域。因此即使 Agent preset 在更近的文件系统层加载了 Skill，已安装插件仍会优先于 `~/.agents/skills` 里的旧同名副本。

## 它做什么

1. **先验真，再录**——工作流要求先有当前版本真实跑通的版本证据（git SHA、工单、请求 ID），才允许录制。
2. **按用例组织（推荐）**——多 case 交付时，建议先拆一张用例清单，再一个 case 一次真实运行录制，最后按执行顺序拼镜头，每个 case 以自己的结果回读收尾。属使用建议，不做强制校验。
3. **episode.json 配方**——每个镜头绑定一段真实原片 + 时间区间 + 一句旁白 + 可选裁切/case 徽标。
   写 `intent: "feedback"` 并添加 `issue` 块即可产出问题反馈视频：严重级别与阶段徽标、
   复现步骤浮层、复现/现象镜头，以及 `feedback.json` 和可直接贴工单的
   `feedback.generated.md`。闸报告同时绑定成片 SHA256、`feedback.json` 字段的归一化哈希
   与 markdown 原始字节哈希，渲染后改动报告内容或删除/篡改 markdown 都会被
   `verify_delivery.py` 拒绝；质量闸规则不变。可从 `examples/feedback-episode.example.json` 复制起步。
4. **自包含渲染器**——`render.py` 用 edge-tts 合成旁白（逐字时间钟），按旁白时长配速每个镜头（0.3x–3x 变速硬校验，超范围直接失败，绝不自动钳制），绘制标签徽标与逐字同步字幕，拼接、响度归一到 −14 LUFS，并自动跑内置质量闸。输出：`screen_demo.mp4`（1920×1080、30fps、h264，音轨为 AAC——非 AAC 只会得到闸警告 `E102`，不算失败）、`timeline.json`、封面/预览帧、`quality_gate/report.json`。
5. **Fail-loud 检查**——`preflight.py` 渲染前校验配方（结构、区间、裁切、浏览器录屏证据、TTS 缓存契约、旁白红线）；`verify_delivery.py` 渲染后核验成片、闸绑定与可选的独立视觉复核。
6. **附件闸**——`render.py gate` 对任意 mp4 跑同一套硬检查，贴进工单、群聊或客户渠道之前必须过。

## 前置依赖

- `python3` 3.9+
- PATH 里有 `ffmpeg` 和 `ffprobe`
- `pip install "edge-tts>=7.3.1" Pillow`

`edge-tts` 7.2.8 及更早版本会从上游端点收到 HTTP 403。请使用 7.3.1 或更新版本；版本过低时渲染器会直接失败并给出升级命令。
`preflight.py`、`render.py` 和 `verify_delivery.py` 要用同一个 Python 解释器运行。预检会在 ffmpeg/ffprobe、Pillow、edge-tts 版本或中文字体不满足要求时直接失败。

不同系统的准备方式：

- macOS：`brew install ffmpeg`，然后执行 `python3 -m pip install "edge-tts>=7.3.1" Pillow`
- Windows：用 `winget install --id Gyan.FFmpeg -e`（或 `choco install ffmpeg`）安装 FFmpeg；如果没有 `python3`，统一改用 `py -3`，并执行 `py -3 -m pip install "edge-tts>=7.3.1" Pillow`
- Linux：用包管理器安装 `ffmpeg` 和中文字体（例如 `fonts-noto-cjk`），再安装 Python 包

渲染器需要中文字体来绘制标签和字幕。macOS 和 Windows 通常自带；精简 Linux 镜像可能没有，预检会在渲染前直接报告字体缺失。

## 副作用披露（审核要求如实说明）

- **网络**：旁白合成调用公共 edge-tts（Microsoft 认知服务）端点；无其他网络访问。
- **文件**：只在你传入的构建目录内写入（`tts/` 缓存、逐镜头片段、成片、闸报告）。
- **命令**：本地执行 `ffmpeg`/`ffprobe`；本 skill 自身不上传、不发布、不删除任何东西。

## 快速开始

安装：`dsh plugin add /path/to/delivery-video-plugin`（DSH bundle），会暴露 `skills/delivery-video/` 下的 skill。

1. 用你惯用的工具录真实原片（macOS `Cmd+Shift+5`、OBS，或脚本化浏览器录屏——见 skill 内录制指引）。覆盖两条以上验收用例时，先按 `examples/cases.example.md` 拆清单，再一个 case 录一次真实运行。
2. 创建 `build/screen_demo-<slug>/episode.json`（可复制 `examples/episode.example.json`）。
3. 依次跑三个脚本（Windows 没有 `python3` 时改用 `py -3`）：

```bash
python3 <skill>/scripts/preflight.py build/screen_demo-myfeature
python3 <skill>/scripts/render.py render build/screen_demo-myfeature
python3 <skill>/scripts/verify_delivery.py build/screen_demo-myfeature
```

单测命令：

```bash
python3 -m unittest discover -s tests -v
```

安装后的试用 prompt：*"用 delivery-video 把这个项目刚完成的功能录成一段 90 秒交付演示视频"*——skill 会带你走完验真、分镜、录制指引、配方组装、渲染与过闸。

## 同名 Skill 副本

ZCode 0.17.x 允许用户级 Skill 和插件 Skill 同名共存。如果本机还保留旧的 `~/.agents/skills/delivery-video`，直接输入 `/skill delivery-video` 可能选中旧副本。请在输入框选择 `delivery-video:delivery-video`，或使用 `/skill delivery-video:delivery-video <任务>` 调用已安装插件。

## 许可

MIT © Lumos-789
