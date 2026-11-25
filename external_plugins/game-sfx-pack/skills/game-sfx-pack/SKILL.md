---
name: game-sfx-pack
description: 按游戏事件清单程序合成音效（跳跃、金币、受击、爆炸、按钮等），整理已有声音（去静音、统一响度、无缝循环），按分类导出 WAV/OGG 和清单。用户提到“游戏音效 / sfx / 音效素材包 / 循环音效 / 统一音量”时使用。
---

# 游戏音效素材包

1. 打开：
   - 新建：`sfx_open(events: ["跳跃", "拾取金币", …] 或 [{name, category, preset}], files?: [已有声音], name?)`。
   - 已有工程：`sfx_open(project: "sfx/xx.sfx.json")`。
   - 事件名会自动匹配预设：pickup、coin、laser、explosion、powerup、hit、jump、blip、confirm、error、step、whoosh。
2. 告诉用户可以在面板里试听、点 🎲 换变体。按用户的描述修改后调用 `sfx_save(project)`：
   - “高一点”：`params.freq` 调大约 20–40%。
   - “长一点”：`params.decay` 调大。
   - “往下滑”：`params.slide` 设成负数。
   - 换一个声音：改 `seed`。
   - 音量：改 `gain`（dB）。
   - 循环环境声：`loop: true`，可以设置 `crossfade`（秒）。
3. `sfx_export(project)`。格式可选 `format: "wav" | "ogg" | "both"`，OGG 需要 ffmpeg。告诉用户输出文件夹的结构和 `manifest.csv` 的位置。
