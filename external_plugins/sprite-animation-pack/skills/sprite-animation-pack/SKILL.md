---
name: sprite-animation-pack
description: 把角色动作帧（PNG 文件夹或整张精灵图）整理成游戏动作包：按动作分组、脚底对齐、帧时长与循环，导出图集 PNG、Aseprite/Phaser JSON、Godot .tres、Unity 切片说明。用户提到“精灵图 / 动作帧 / 序列帧 / 图集 / Godot SpriteFrames / Phaser 动画”时使用。
---

# 游戏角色动作包

1. 打开素材：
   - 帧文件夹：`sprite_open(frames: "art/hero", fps?)`。
   - 整张图：`sprite_open(sheet: "hero.png", grid: {width, height} 或 {cols, rows}, by: "row"|"column", actions: ["idle","run",…])`。
   - 不知道格子尺寸时先问用户，或者根据报错里给出的图片尺寸推断（常见 16/24/32/48/64）。
2. 读返回的摘要：每个动作的帧数和对齐方式（auto → feet 或 keep）。跳跃、攻击这类带位移的动作如果是裁切过的单帧，建议用户在面板里检查，必要时改为 keep 或微调。
3. 按用户要求改工程，然后 `sprite_save(project)`：
   - 动作名：小写英文最适合引擎。
   - `frames[].duration`（毫秒）、`loop`、`anchor`、`scale`（像素画用 2–4×）。
   - 拆分或合并动作：直接编辑 `actions[].frames`。
4. `sprite_export(project)`，告诉用户输出文件夹里各文件的用途：
   - Phaser：`load.aseprite` + `createFromAseprite`。
   - Godot：把 `.tres` 和 PNG 放进同一文件夹，在 AnimatedSprite2D 上用这个 `.tres`。
   - Unity：照 `.unity.md` 的说明切片。
