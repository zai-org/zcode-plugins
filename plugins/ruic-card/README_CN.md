# ✦ RuiC Card Skill

> 一个 **Codex Skill**：把小时候文具店门口那种会闪的全息卡**复刻**到浏览器里。
> 说一句话，就得到一张会随视角流光、带层次景深的 3D 闪卡网页，外加一个可以随便改的 Blender 工程。

小时候买不起的闪卡，现在你想印谁就印谁。这是你的私人卡牌工坊。

**两条路线，同一张卡**：

- **画出来**（`ruic-card` 技能）：给一句话或一张参考图，四层图由 agent 画。
- **拍出来**（`photo-card` 技能）：你给一张已有照片，用 rembg 把四层从照片里抠出来，可先去水印，再渲出动画与 MP4 / 微信规格 GIF。

**它是一台全自动闪卡生产线**：你给一句话或一张参考图，剩下全交给 Codex——

1. **画四层图**：主体、背景、线稿、文字，画在同一块画布、同一套坐标里
2. **搭 3D 场景**：Blender 建卡牌几何，把四层图按景深在空间里"撑开"——主体前凸、背景后缩
3. **铺全息材质**：镭射彩虹的相位跟着视角走，转到哪闪到哪；烫金 / 银箔 / 珠光 / 原画四种质感
4. **组装网页**：Three.js 查看器打包成单文件，起本地服务，打开页面实测拖拽、翻面、滑块、手机布局
5. **交付**：网页链接 + `card.blend` 源工程 + 四层透明 PNG + `card-config.json` 配置 + 渲染图

技术栈就三样：**Blender**（官方便携版自动安装，不碰系统环境）+ **Three.js**（按同一套 UV 公式重建材质）+ **Python 流水线**（画完图之后一步到位）。skill 本体只有代码和文字，装上就能用；你生成的画作、工程、模型全部待在你自己的项目目录里。

---

## 🎬 演示

### 调整前 · 图层分散

初版层距：主体、特效、文字隔得较开，转动时明显"散开"：

![调整前效果](assets/demo-before.gif)

[▶ 观看调整前完整视频](assets/demo-before.mp4)

### 调整后 · 层距收紧（现默认）

调整后：各层收近一档，卡片整体更紧凑，仍保留层次景深——这是当前出厂默认效果：

![调整后效果](assets/demo-after.gif)

[▶ 观看调整后完整视频](assets/demo-after.mp4)

---

## ✨ 特性

- **一句话出卡**：描述或参考图 → 分层图 → 配置 → 流水线 → 网页，全程自动，你只负责想
- **真 3D 层次景深**：主体前凸、背景后缩，层与层随视角错开，不是一张平面贴图
- **视点流光**：镭射彩虹的相位跟着视角走，转到哪闪到哪；烫金 / 银箔 / 珠光 / 原画四种卡面质感
- **浏览器里随便玩**：拖拽旋转、翻面、景深/光泽/画面比例滑块，手机横竖屏都适配
- **出厂自带验收**：`node scripts/verify_web.mjs <项目>` 自己拉起无头浏览器和本地服务，把拖拽、翻面、缩放、键盘、五个滑块、四种质感、截图下载、390px 窄屏、减动效逐项跑完，并且比对**真实画面帧**（不是只看滑杆读数变没变），报告和截图落进 `verification/`
- **免装 Blender**：官方便携版自动下载、SHA-256 校验后装进项目目录，不污染系统环境
- **网页零依赖请求**：查看器打包成单文件（three + 图标全部内联），广告拦截插件无从下手；即使浏览器关了硬件加速，也有 CSS-3D 分层兜底，绝不会白屏
- **可编辑交付**：`card.blend` 真工程 + 透明分层 PNG + `card-config.json`，想改哪层改哪层
- **纯文本 skill**：本体只有代码和文字，一键打包 ZIP 交付，无二进制、无凭据、无缓存

---

## 🚀 快速开始

### 安装

在 ZCode 插件市场搜索 `ruic-card` 安装并启用；插件内的两个技能会随插件一起加载——
`ruic-card`（画出来）与 `photo-card`（拍出来），无需手工拷贝目录。

### 环境

- Python 3 + Pillow
- Node.js + npm
- Blender **不用自己装**——流水线自动把官方便携版放到 `<project>/tools/`，校验 SHA-256

### 开口

> "用 ruic-card 给我做一张水墨风的锦鲤闪卡，文字用书法体，编号 No.001"

或者上传参考图：

> "照这张图做一张闪卡，保留人物和构图，背景换成星空"

Agent 会先把卡片规格说给你听，然后开工：画四层图 → 生成文字层 → 写配置 → 跑流水线 → 起本地服务 → 打开页面实测拖拽、翻面、滑块和手机布局 → 交付。

### 你会收到

| 东西 | 用来干嘛 |
|---|---|
| 本地网页链接（`127.0.0.1:4173`） | 拖、转、翻、拉滑块 |
| `card.blend` | 在 Blender 里继续调材质、换灯光、出渲染 |
| `assets/` 分层图 | 想换哪层换哪层，重跑流水线即可 |
| `card-config.json` | 改名字、编号、稀有度 |
| 渲染图 | 直接发 |
| `verification/` | 自动化验收报告 + 各视角截图，证明这卡真的能拖能翻 |

---

## 🎬 可以拿它做什么

- **猫主子的传说卡**：上传照片加一句"传说稀有度、金边框"，拖一拖，猫往前凸、背景往后退
- **独立游戏卡组**：一个角色一句描述，战士、法师、盗贼、Boss 批量出货，每张卡一个配置
- **团队纪念卡**：头像当主体、部门色当背景、Slogan 当文字层，网页链接一发大家翻一下午
- **节日仪式感**：背面写一句话，对方翻到背面的那一刻，闪光效果拉满
- **发布会彩蛋**：产品卡一个链接"扫码看会闪的那种"，观众当场转起来
- **材质实验场**：`card.blend` 里镭射、星光、线稿发光都是独立可调节点，想学怎么"闪"就打开它

---

## ⚙️ 工作原理

一句话进去，一张会闪的卡出来，中间是一条全自动流水线：

```mermaid
flowchart LR
    A[一句话 / 参考图] -->|"分层提示词<br>art-direction"| B[四层图<br>subject·background·lineart·text]
    B --> C[card-config.json<br>卡片规格]
    C --> D[run_pipeline.py<br>一键流水线]
    D -->|"validate_assets<br>透明/对齐体检"| E{体检通过?}
    E -->|"否，重新生成"| B
    E -->|是| F[Blender 便携版<br>自动安装 + SHA-256 校验]
    F --> G[card.blend<br>可编辑视差场景]
    G --> H[card.glb<br>几何 + 材质名契约]
    H --> I[web-template<br>Three.js 查看器单文件打包]
    I --> J[本地网页 4173<br>拖转/翻面/滑块/手机布局]
```

核心链路要点：

- **四层图共用一套 UV 公式**：主体、背景、线稿、文字在 Blender 和网页里按同一公式合成，所见即所得
- **视差不是简单贴图**：把视角方向变换进卡面坐标系、除以有界法向分量，再按带符号景深偏移 UV，才有真正的"层与层错开"
- **全息镭射相位跟着视角走**：转到哪闪到哪，而不是只随时间循环
- **glTF 搬不动节点图**：Blender 的自定义材质图没法经 glTF 直传，网页端用同一套公式重建 shader，并打包成单文件——多个小模块请求会被广告拦截插件误伤，单文件无懈可击
- **Blender 装进项目里**：官方便携版按 SHA-256 校验后解压到 `<project>/tools/`，项目自带环境、互不干扰

---

## 🔧 可以调的旋钮

流水线出厂就是一套顺手的参数，也都留了口子：

- **视差强度**：主体默认 scale 1.25 / depth 0.4，背景 depth -0.25，想更"跳"就往上加
- **特效层**：`assets/effects.png` 可选，独立景深（`effectsDepth`，网页里就是「特效景深」滑块），叠在人物之上、文字之下，适合花瓣/火星/藤刺这类装饰
- **卡框与文字**：都放 `text.png`。网页对文字层不做视差，所以边框会稳稳钉在卡边
- **镭射条纹**：条纹密度、扭曲度、角度，以及粉-黄-蓝-白的渐变
- **线稿发光**：强度和遮罩密度，从"淡淡勾边"到"霓虹描边"
- **星光**：Voronoi 尺度 + 动画噪声，从零星几颗到满天星
- **Blender 界面语言**：默认简体中文，存在项目本地配置里，一句话可换

---

## 📸 照片路线（`photo-card` 技能）

"把这张照片做成全息闪卡"——照片不用先画，直接切成四层：

1. `ocr_boxes.ps1 -img <照片>` 用 Windows OCR 定位水印（其他平台自己给坐标），`remove_watermark.py <照片> x0 y0 x1 y1 <out.jpg>` 只填那一块。
2. `prepare_card_layers.py <照片> <输出目录> [x0 y0 x1 y1] [--native]` 抠出 `subject/background/lineart/text.png`，共用一块画布——**主体用的是照片自己的像素**，被擦掉的区域作为 alpha。
3. 交给 `ruic-card` 技能的流水线建 `card.blend`、导 GLB、组装查看器。
4. `render_anim.py`（走 Blender）渲 240 帧；`encode_mp4.py` 出原生尺寸 MP4，`encode_wx_gif.py` 出微信能直接发的 GIF + 小 MP4。

验收用数值，不靠肉眼：合成图与原图在水印框外一致、渲染帧与原图亮度差在几级内、水印区高亮像素归零、GIF 体积 <10MB 且宽 ≤1000px。细节见 `skills/photo-card/references/photo-card.md`。

---

## 📁 目录一览

```
plugins/ruic-card/                 # 插件根：清单、许可、双语文档、演示媒体
├── .zcode-plugin/plugin.json
├── assets/                        # README 用的演示 GIF / MP4
└── skills/
    ├── ruic-card/                 # 路线一：画出来（SKILL.md 所在目录即技能名）
    │   ├── SKILL.md               # Agent 读的"操作手册"
    │   ├── references/
    │   │   ├── art-direction.md   # 分层画图的提示词写法、参考图处理
    │   │   ├── config.example.json# 卡片配置示例
    │   │   └── verification.md    # 交付前的验收清单
    │   ├── scripts/               # 建卡流水线（ensure_blender / build_card / export_web /
    │   │                          #   generate_typography / validate_assets /
    │   │                          #   checkerboard_to_alpha / run_pipeline / package_skill）
    │   └── assets/web-template/   # 响应式 Three.js 查看器
    └── photo-card/                # 路线二：拍出来（照片 → 四层 → 动画 → 视频）
        ├── SKILL.md
        ├── references/photo-card.md
        └── scripts/
            ├── prepare_card_layers.py  # rembg 抠四层（滞后生长蒙版、板图恒等擦除）
            ├── remove_watermark.py     # 水印框逐列梯度填充
            ├── ocr_boxes.ps1           # Windows OCR 定位水印框
            ├── render_anim.py          # 240 帧动画渲染（native / clean / still）
            └── encode_mp4.py / encode_wx_gif.py   # 原生 MP4 / 微信规格 GIF+MP4
```

技能本体只有代码和文字，轻得很。你生成的画作、`.blend`、模型都待在你自己的输出项目里。

查看器随包提供 `skills/ruic-card/assets/web-template/app.bundle.js`（约 1.3 MB，**未压缩、可读**的打包结果）：
查看器按单文件加载，这样逐模块 URL 不会被广告拦截插件拦掉；没有 bun/esbuild 的机器也能直接跑。
改了 `app.js` 后用同目录 `bundle.sh` 重新打包即可。

---

## 📦 打包分享

想把技能单独发给朋友：

```bash
python skills/ruic-card/scripts/package_skill.py skills/ruic-card --out ~/Desktop/ruic-card-skill.zip
```

按白名单只打包文本文件，打出来的 ZIP 干干净净，拿走就能用。

---

## 📦 安装要求与副作用声明

- **可执行文件**：Python 3（含 Pillow；照片路线另需 numpy、scipy、rembg）、Node.js（含 npm），动画渲染需要 Blender。Blender 无需预装——首次运行时流水线会把官方便携版下载到**输出项目的** `tools/` 目录，不碰系统安装。
- **网络访问**：首次运行的 Blender 下载（blender.org）、查看器 npm 依赖安装、验证脚本的无头 Chromium 获取，以及 **rembg 首次使用时下载的分割模型**（来自 rembg 的 release 附件，约 180 MB）。除此之外不访问任何主机。
- **API 密钥**：无需任何密钥。画出来的路线上，四层图用宿主 agent 已有的图像能力生成或手绘；照片路线除模型下载外全程离线。
- **文件写入**：只写入你指定的输出项目目录，以及你在照片路线脚本里传入的路径；插件本体运行时只读。
- **命令执行**：Python 流水线、`blender`（便携副本）、`node`（查看器服务与验证）、`powershell`（仅 Windows 的水印定位）。
- **平台差异**：水印定位脚本 `skills/photo-card/scripts/ocr_boxes.ps1` 用的是 Windows OCR；macOS / Linux 上请自行给出水印框坐标，或跳过这一步。
- **无遥测、无 Hook、无 MCP 服务。**

## 📄 第三方代码、素材与服务来源

- **RuiC-card-skill**（上游原作）— <https://github.com/HRuiCcc/RuiC-card-skill>，MIT License，Copyright (c) 2026 HRuiCcc。
  "画出来"这条路线的技能工作流、Blender 场景脚本、Three.js 查看器模板与 `references/` 文档均源自该项目（含少量适配补丁），
  `LICENSE` 保留原作者版权声明；`assets/demo-before.*` 与 `assets/demo-after.*` 四个演示文件同样来自上游仓库。
- **rembg** — MIT License，照片路线用它做主体分割；其模型权重在运行时从 rembg 的 release 附件下载，遵循各自上游项目（U²-Net / IS-Net）的条款。
- **imageio** 与 **imageio-ffmpeg** — BSD-2-Clause 包；`imageio-ffmpeg` 安装的 FFmpeg 可执行文件按其自身许可（GPL）分发。二者都不随本插件打包。
- **Blender** — 运行时从 blender.org 获取（GPL 程序；本插件不打包任何 Blender 代码）。
- **Three.js** — MIT License，随网页模板打包（已内联进 `app.bundle.js`）。
- 其余内容为原创代码与文字（MIT，见 `LICENSE`）。生成的画作永远留在你自己的项目目录，绝不随插件打包。
