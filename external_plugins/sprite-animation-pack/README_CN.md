# 游戏角色动作包

把角色的动作帧整理成游戏引擎能直接加载的动作包：一张图集，每个动作的帧都对齐到同一个锚点，带帧时长、循环设置，以及 Phaser、Godot、Unity 的导入文件。

## 功能

- **输入**：
  - 一文件夹 PNG 帧：按子文件夹（`run/1.png`）或去掉帧号后的文件名（`hero_run_01.png` → `run`）分成动作，帧按自然顺序排列。
  - 或一整张精灵图：按网格切开（格子尺寸或行列数），每行或每列一个动作，空格子自动跳过。
  - 纯色底（品红、绿幕或左上角颜色）可以去掉。
- **对齐**：所有帧放进统一大小的格子，锚点落在同一位置。
  - **脚底**：取不透明像素的水平重心，贴着最低点。裁切过的帧默认用这种方式。
  - **保持原位**：帧共用一块留有透明边的画布时自动选用，跳跃的高度会保留。
  - 也可以选**中心**对齐。
  - 每帧都能逐像素微调。
- **面板**：
  - 动作列表：名字、fps、循环、对齐方式。
  - 实时预览：可放大，带地面线和洋葱皮，可播放 / 暂停 / 逐帧。
  - 帧条：可改每帧时长、微调位置、调整顺序、删除。
  - 参数设置和图集预览。
- **导出**（到 `sprites/<名字>/`）：
  - `名字.png`：等格图集，每个动作一行；像素画可按整数倍（1–8×）最近邻放大，不会糊。
  - `名字.json`：Aseprite 格式，带每帧时长和动作标签。Phaser 3 用 `load.aseprite` + `anims.createFromAseprite` 加载，普通 atlas 加载方式也能读。
  - `名字.tres`：Godot 4 的 `SpriteFrames`，每个动作有速度、循环和各帧相对时长，引用同一文件夹里的图集。
  - `名字.unity.md`：Unity Sprite Editor 按网格切片的参数、Pivot，以及每帧的矩形。
  - `名字.phaser.js`：可以直接粘贴的代码片段。
  - `名字.sprites.json`：工程文件，可以重新打开修改。

## 使用

在 ZCode Desktop 中对 Agent 说：

- “把 hero.png 按 32×32 切开，三行分别是 idle、run、jump，导出 Godot 和 Phaser 用的动作包”
- “把 art/knight/ 里的帧按脚底对齐，attack 只播一次、15 帧每秒”
- “把 runner 放大 4 倍导出，像素风不要糊”

## 工具

| 工具 | 作用 |
|---|---|
| `sprite_open` | 打开帧文件夹 / 文件列表、精灵图（加网格）或工程；分组、对齐并打开面板 |
| `sprite_save` | 保存名字、顺序、时长、循环、对齐方式、微调和参数 |
| `sprite_export` | 导出图集、Aseprite/Phaser JSON、Godot .tres、Unity 说明和工程 |

## 范围（v0.1）

- 只支持 PNG 帧（透明底，或可以去掉的纯色底）。
- 等格排列，不做紧密打包或旋转。
- 不包含“补全动作”（生成新帧）：先用生图工具生成新帧，再放进文件夹。
- Unity 提供切片说明而不是 `.meta` 文件，因为 GUID 由 Unity 自己分配。

## 隐私、网络与文件

- **全部在本地运行**：不联网、不上传，不需要 API 密钥或账号。
- 只读取你选的图片，只写入工作区的 `sprites/<名字>/`。没有 hooks。

## 构建与测试（开发者）

- 源码位于 `ui-plugins/sprite-animation-pack/`。
- 构建：`pnpm install --frozen-lockfile && pnpm build`，然后把 `dist/local-marketplace` 添加为本地来源。
- 测试：`pnpm --filter @penova/plugin-sprite-animation-pack test` 和 `test:e2e`。
- `E2E_SPRITES` 可以指向真实素材。我们用的是 OpenGameArt 上 Blue Yeti Studios 的 CC0 素材“Runner character”，精灵图和裁切后的单帧两种形式都测了。

## 第三方组件与许可

MIT 许可（作者：Penova）。打包的组件：pngjs（MIT）、jpeg-js（BSD-3-Clause）、MCP SDK 和 ext-apps（MIT）、zod（MIT）；完整清单见 `dist/THIRD_PARTY_NOTICES.txt`。
