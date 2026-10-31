# delivery-video

把**真实运行**的功能做成可信交付演示视频的 skill 插件——真实录屏、合成旁白、逐字对齐字幕，加一道拒绝放过造假或残次演示的确定性质量闸。

大多数「AI 演示视频」是静态截图、mock 页面或旧录屏拼出来的。这个插件强制相反的纪律：每个镜头必须指向一段真实录屏和可追溯的时间区间，最后一镜必须落在已回读验证的结果状态上，成片必须先过硬闸（分辨率/帧率/编码、音轨、响度、黑帧、冻结帧、码率密度）才允许外发。贴出去的文件永远是过闸的那一个文件，用 SHA256 绑定。

## 它做什么

1. **先验真，再录**——工作流要求先有当前版本真实跑通的版本证据（git SHA、工单、请求 ID），才允许录制。
2. **episode.json 配方**——每个镜头绑定一段真实原片 + 时间区间 + 一句旁白 + 可选裁切/case 徽标。
3. **自包含渲染器**——`render.py` 用 edge-tts 合成旁白（逐字时间钟），按旁白时长配速每个镜头（0.3x–3x 变速钳制），绘制标签徽标与逐字同步字幕，拼接、响度归一到 −14 LUFS，并自动跑内置质量闸。输出：`screen_demo.mp4`（1920×1080、30fps、h264+AAC）、`timeline.json`、封面/预览帧、`quality_gate/report.json`。
4. **Fail-loud 检查**——`preflight.py` 渲染前校验配方（结构、区间、裁切、浏览器录屏证据、TTS 缓存契约、旁白红线）；`verify_delivery.py` 渲染后核验成片、闸绑定与可选的独立视觉复核。
5. **附件闸**——`render.py gate` 对任意 mp4 跑同一套硬检查，贴进工单、群聊或客户渠道之前必须过。

## 前置依赖

- `python3` 3.9+
- PATH 里有 `ffmpeg` 和 `ffprobe`
- `pip install edge-tts Pillow`

## 副作用披露（审核要求如实说明）

- **网络**：旁白合成调用公共 edge-tts（Microsoft 认知服务）端点；无其他网络访问。
- **文件**：只在你传入的构建目录内写入（`tts/` 缓存、逐镜头片段、成片、闸报告）。
- **命令**：本地执行 `ffmpeg`/`ffprobe`；本 skill 自身不上传、不发布、不删除任何东西。

## 快速开始

1. 用你惯用的工具录真实原片（macOS `Cmd+Shift+5`、OBS，或脚本化浏览器录屏——见 skill 内录制指引）。
2. 创建 `build/screen_demo-<slug>/episode.json`（可复制 `examples/episode.example.json`）。
3. 依次跑三个脚本：

```bash
python3 <skill>/scripts/preflight.py build/screen_demo-myfeature
python3 <skill>/scripts/render.py render build/screen_demo-myfeature
python3 <skill>/scripts/verify_delivery.py build/screen_demo-myfeature
```

安装后的试用 prompt：*"用 delivery-video 把这个项目刚完成的功能录成一段 90 秒交付演示视频"*——skill 会带你走完验真、分镜、录制指引、配方组装、渲染与过闸。

## 许可

MIT © Lumos-789
