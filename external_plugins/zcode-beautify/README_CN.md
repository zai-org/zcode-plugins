# zcode-beautify（fork）

[English](README.md) | [中文](README.zh-CN.md)

[Logocceai/zcode-beautify](https://github.com/Logocceai/zcode-beautify) 的 fork，由 [Mc-GrowlR](https://github.com/Mc-GrowlR) 持续维护——功能开发在本仓库进行（完整演进史见 [CHANGES.md](CHANGES.md)，0.3.0 → 6.1.x）。

美化 **ZCode 桌面客户端**：任意图片——或任意**视频 / Wallpaper Engine 场景壁纸**——一键设为背景壁纸，并用 Material Design 3（莫奈取色）动态配色适配整个 UI；还能美化聊天区（消息气泡、对话列宽度与拖拽调宽、大会会话流畅模式、会话底部加载图标、输入框透明度）——并附带实时悬浮设置面板。在上游基础上，本 fork 新增：动态壁纸（WE 场景 / 视频导入与无缝循环）、本机 Wallpaper Engine 壁纸库浏览器、定时轮播方案、聊天区全套改样式、ZCode 3.18 适配，以及双客户端支持（ZCode + WorkBuddy）。

> 🧩 **0.5.0 起同时支持 WorkBuddy 桌面客户端**：加 `--target workbuddy`（或使用仓库内 `.codebuddy-plugin` 清单，已内置 `BEAUTIFY_TARGET=workbuddy`）即可把壁纸与莫奈配色注入 WorkBuddy。两个客户端的 CDP 端口（9222 / 9333）、控制 API 端口（9223 / 9334）、数据目录、启动项全部隔离，可同时开着互不干扰。WorkBuddy 使用其 `--wb-*` 设计变量族取色；气泡 / 消息流宽度 / 运行中图标这些聊天区增强仍为 ZCode 专属（绑定 ZCode 的 DOM），WorkBuddy 上面板会自动隐藏对应页签。

> 📷 欢迎贡献截图——向 `docs/screenshot.png` 提 PR 即可。

## 功能

### 壁纸与配色

- **动态壁纸**——导入 Wallpaper Engine **场景**（`.pkg` 或工坊目录）或普通**视频**（`.mp4`/`.webm`）：场景在专属 WE 窗口中渲染，经 Desktop Duplication 捕获后处理成完美无缝循环（首帧 == 末帧）；长视频自动截取中段。循环以内容寻址缓存（LRU）并通过本地 HTTP 流式注入渲染器——只有动画，没有交互和声音。
- **Wallpaper Engine 壁纸库浏览器**——在面板内直接浏览本机 WE 壁纸（Steam 创意工坊订阅 + 自建项目，支持多 Steam 库扫描）：类型 / 文件夹两种视图、搜索、多选批量导入（带进度）、悬停预览（视频壁纸播放自己的源片，场景按需真渲染预览）、已导入角标、显示 WE 真实标题。
- **定时播放（轮播）**——多个命名播放方案，每个方案独立的顺序模式（**顺序 / 随机不连播同张 / 每日定点**）、切换特效（fade / slide / zoom / blur / none）与可选时段（支持跨夜）。serve 重启后自动续播并从上次位置继续；手动切换壁纸时自动暂停。
- **静态壁纸**——任意本地图片作为固定背景层铺在 UI 之下，三种取景模式：`cover`（填满裁剪）、`contain`（完整显示，背后是同图模糊放大底）、`smart`（本地 AI 式分析画面主体，自动选择最佳取景与焦点位置）。图片切换可选 Ken Burns 缓动。
- **莫奈配色**——用 Google 官方 MD3 算法从壁纸提取 source color，生成 light/dark 双套调色板，映射覆盖 ZCode 的 35+ 个语义 CSS 变量。功能色（success/warning/destructive）刻意保持不动。

### 聊天区美化

- **聊天气泡**——你发出的消息气泡五种预设（`accent` 主题色染色、`glass` 毛玻璃、`outline` 描边、`flat` 扁平、`default` 原生），加上染色强度、圆角、宽度、左右对齐滑杆，气泡样式编辑器与个人样式库，以及自定义 CSS 支持。颜色全部引用实时主题 token，莫奈换主题时气泡自动跟随。
- **气泡工坊**（Bubble Studio，ZCode 3.16+）——基于 ZCode MCP Apps 的交互画廊页：智能体改气泡样式后，工具结果直接在对话内展开工坊页，所有配方并排预览；点卡片即可"试穿"（真实聊天区即时换装），滑杆微调染色 / 圆角 / 宽度 / 对齐 / 自定义 CSS，还能保存自己的命名配方（存于 `bubble-recipes.json`，上限 50 个）。侧栏也有常驻入口；不支持 UI 插件的旧宿主自动回落为普通文字卡。
- **消息流宽度**——加宽或收窄对话列：原生 / 宽档位 / 三档窄宽度 / 完全自定义（rem 上限 + 留白）。注入的是**公式**（rem 上限 + `calc()` 留白）而非定值宽度，随窗口缩放与原生同机制跟随，永不溢出、不破坏输入栏。
- **两侧拖拽调宽**（默认关）——对话列左右边缘的隐形竖条：悬停浮现 3px 主题色竖线，拖动对称加宽/收窄对话列（DeepSeek 式交互），双击竖条恢复档位设置，Esc 取消本次拖动。拖拽宽度存本地、优先于档位；未拖拽时布局与原生逐像素一致。
- **大会话流畅模式**（默认关）——对远屏外的消息行先量真实高度再跳过布局与绘制（`content-visibility:auto` + 精确 `contain-intrinsic-size`）。51MB 会话实测打开耗时 **-41%**、滚动条零失真；长会话滚动更顺。
- **耗时秒数去小数**（默认关）——对话下方"工作中"耗时的秒数隐藏小数位（53.4 秒 → 53 秒），实时改写、关闭即恢复原生。
- **会话底部加载图标**——3.18 把对话底部"工作中"行首的加载图标换成了品牌色粒子；可一键换回**旧版 3×3 波浪点阵**（纯 CSS 重建，颜色跟壁纸取色），或换成**自定义图片 / GIF 动图**（可选旋转、10-28px）。
- **输入框透明度**——把聊天输入框底色在 0（不透明实底）到 100（全透明）间调节，50 ≈ ZCode 原生；壁纸从输入框底下透出；文字、边框、焦点环不受影响，明暗主题与莫奈取色继续生效。

### 面板与服务

- **实时设置面板**——ZCode 窗口内可拖拽的悬浮面板，三个标签页：**壁纸**（分组壁纸库、带进度与依赖引导的导入、当前外观）、**定时播放**（播放方案）、**设置**——blur/dim 滑块、取景模式、Monet 与壁纸透显开关、聊天界面遮罩（整体压暗 / 渐变蒙版 / 白纱）、昼夜护眼、录制分辨率、配置导出/导入、最近使用记录、一键还原。所有调整即时预览并自动保存。
- **零操作服务**——MCP server 在 ZCode 启动时自动拉起后台 serve，面板无需手动启动，开箱即有。
- **启动项自修复**——`serve` 运行期间，所有 ZCode 启动项（桌面 / 开始菜单 / 任务栏快捷方式——含 OneDrive 重定向目录——以及 `zcode://` 协议处理器、资源管理器右键菜单）自动保持携带 `--remote-debugging-port`，主题因此能在 ZCode 重启甚至更新器重建快捷方式后依然存活；`repair-launchers` 可随时按需扫描修复并输出结构化报告（机器级条目只报告不修改）。主题本身在渲染器刷新后自动恢复，上次外观还会缓存到 `localStorage` 作为兜底。
- **对话控制**——内置斜杠命令 `/beautify` 与 `/bubble`，加上 MCP 工具（`set_background`、`import_scene_wallpaper`、`apply_options`、`repair_launchers` 等），让 ZCode 智能体代你设壁纸、调主题，或用一句自然语言改气泡样式；改气泡还会在 ZCode 3.16+ 对话内打开气泡工坊交互画廊。

## 原理

ZCode 是 Electron 应用，UI 主题由 Tailwind v4 的 `--color-*` CSS 自定义属性驱动，且 production 版**默认不带调试端口**。本插件：

1. 以 `--remote-debugging-port=9222` 启动 ZCode（仅需一次 `launch`；此后启动项由插件自动保持修复）；
2. 通过 Chrome DevTools Protocol 向 renderer 注入 CSS/JS：
   - 固定定位的壁纸层（图片以 data URI 嵌入，视频循环经本地 HTTP 流式加载），
   - 背景类变量改为半透明，让壁纸透出，
   - MD3 light/dark 调色板覆盖 ZCode 的语义 token，
   - 可选的聊天区样式层：气泡样式、消息流宽度公式、屏外消息行跳过渲染；
3. `serve` 模式保持注入会话不关闭，主题、设置面板与定时轮播在渲染器刷新后自动存活。

不修改任何安装文件，升级不受影响。

### WorkBuddy 适配说明

WorkBuddy 与 ZCode 同为 Electron 客户端，但配色体系不同：它由一套 `--wb-*` 设计变量驱动（`--wb-bg-primary`、`--wb-bg-content`、`--wb-color-text-*`、`--wb-palette-brand-1..10` 等，渲染层引用约 2.8 万次）。插件对 WorkBuddy 的注入内容相应替换为：

1. 壁纸层挂到 `documentElement`，`html / body / #root` 背景置透明；
2. 表面类变量按壁纸透显分级（`bg-primary` 完全透明，`bg-content/secondary` 半透，`card/elevated/popover` 更实），文字与边框取 MD3 的 on-surface / outline；
3. 用壁纸的 MD3 primary 色阶整条重建 `--wb-palette-brand-1..10`，按钮、链接、选中态、焦点环一次跟随；
4. 选择器写成 `html[data-theme=light|dark]`（特异性 0,1,1），稳压应用自身 `[data-theme=dark]`（0,1,0），React 水合重渲染也不会被盖回。

气泡、消息流宽度、运行中图标、耗时去小数、队列遮罩这些依赖 ZCode 具体 DOM 的增强不会注入 WorkBuddy（面板自动隐藏对应页签）；反过来，「组件」页签只在 WorkBuddy 出现。

### 组件精修（WorkBuddy 专属）

实测（asar 解包 + 运行中 CDP）发现 WorkBuddy 有几处壳层容器写死了颜色：侧栏与输入框背景 `rgb(31,31,31)`、输入框边框 `#333`、菜单栏文字 `rgba(228,228,228,.37)`——`--wb-*` 令牌改不到它们；消息渲染层另有一套 `--cr-*` 文字令牌，不跟随设计系统。面板的「组件」页把这些差异收敛成一组显式开关：

- **壳层**：侧栏底色浓度、菜单栏文字浓度；
- **输入框**：圆角（原生 24px）、底色浓度、描边浓度；
- **消息与工具**：工具卡圆角（原生 8px）、会话文字跟随主题（把 `--cr-*` 接到 `--wb-*`）；
- **通用组件**：控件圆角（`--wb-radius-md/lg`）、弹层圆角（`--wb-modal-radius`）。

总开关默认关闭，关闭时零注入；所有颜色都用 `color-mix(in srgb, var(--wb-*) N%, transparent)` 从令牌派生，明暗主题与壁纸配色都会跟随，不引入新的固定色。

## 环境要求

- Node.js ≥ 20，已加入 PATH。
- **ZCode 或 WorkBuddy** 桌面客户端（Windows / macOS / Linux）。用 `--target workbuddy` 切换到 WorkBuddy；不传时默认 ZCode。
- 动态壁纸（可选）：**Wallpaper Engine**（Steam）与 **ffmpeg ≥ 5.0**（PATH）——两者均自动检测，缺失时面板会给出安装引导。捕获依赖 Desktop Duplication API，动态导入仅限 **Windows**；静态图片壁纸全平台可用。

## 两种包，都可以直接把链接扔给 AI 安装

只需把 <https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine> 交给你的 AI 智能体——它会 clone 仓库并按其中的说明执行。选对包：

| | **插件包**（`INSTALL-FOR-AI.md`） | **技能包**（`skill-pack/SKILL.md`） |
|---|---|---|
| 目标 | **ZCode 桌面客户端** | **任意** Electron 应用 |
| AI 角色 | 安装器——装好现成插件 | 开发者——从零构建工具 |
| 你说 | "给我的 ZCode 装这个美化插件" | "给我的 XX 应用做壁纸/取色美化" |
| 产物 | 可用的 `/beautify` + `/bubble` 命令与 MCP 工具 | 一个新的本地美化工具 |

插件包复制即用的提示词：

```text
https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine
把这个美化插件安装到我的 ZCode 桌面客户端，按仓库中的 INSTALL-FOR-AI.md 执行。
```

离线环境？两种包都在 [Releases 页面](https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine/releases) 附有 zip。

## 安装（手动路径）

### 方式 A —— ZCode 插件市场（推荐）

1. 打开 ZCode → **设置 → 插件管理 → 发现**。
2. 点 **+**，添加本仓库（GitHub URL 或本地 clone 路径）。
3. 在 *zcode-beautify* 卡片上点 **获取**。`/beautify`、`/bubble` 命令与 MCP 工具立即可用。

仓库内已附带 `dist/` 预构建单文件产物，无需本地构建。（市场安装包内同样的产物放在 `bundle/` —— 市场打包契约把 `dist/` 留给仓库内构建。）

### 方式 C —— WorkBuddy 插件市场

1. 打开 WorkBuddy → **设置 → 插件管理 → 发现**。
2. 点 **+**，把本仓库目录（或 GitHub URL）添加为插件市场——WorkBuddy 读取的是仓库内的 `.codebuddy-plugin/marketplace.json`。
3. 安装 *zcode-beautify-workbuddy*。清单会把 MCP 服务指向 `bundle/mcp/server.js` 并带上 `BEAUTIFY_TARGET=workbuddy`，`/beautify` 命令与 MCP 工具随之可用。

WorkBuddy 首次使用仍需带调试端口重启一次（见下），`launch --target workbuddy` 会自动补全其快捷方式与 `workbuddy://` 深链。

### 方式 B —— clone 直接运行

```bash
git clone https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine.git
cd zcode-beautify-for-wallpaper-engine
node bundle/cli.js --help        # 预构建产物，零安装
```

## 快速开始

```bash
# 1) 显式开启实验性 CDP 注入（默认关闭 — 暴露面与回滚方式见下节）
node bundle/cli.js enable

# 2) 完全退出 ZCode 后执行一次，以 CDP 调试端口重启 ZCode
node bundle/cli.js launch

# 3) 设置壁纸并自动适配配色
node bundle/cli.js apply "D:\pictures\wallpaper.jpg" --blur 6 --dim 30

# 4) （推荐）守护模式 + 实时设置面板
#    --detach 让服务转入后台，启动它的终端（或智能体会话）结束后面板依然可用
node bundle/cli.js serve --detach
```

`serve` 运行时，ZCode 右下角出现 🎨 按钮。面板有三个标签页——**壁纸**（壁纸库、导入、当前外观）、**定时播放**（播放方案）、**设置**——以及聊天区分区：气泡预设与滑杆、消息流宽度档位、大会话流畅模式开关。所有调整即时预览、自动保存。服务未运行时，面板会明确显示 ⚠ 离线提示，而不是装作配置全为 0。

也可以直接在 ZCode 里输入 `/beautify <图片路径>` 让智能体操作，之后说"模糊调高一点"即可；或输入 `/bubble 玻璃质感 圆角大一点`，用一句话改气泡样式。

### 给 WorkBuddy 用

```bash
# 1) 完全退出 WorkBuddy 后执行一次：带 CDP 端口(9333)重启，并修复快捷方式
node bundle/cli.js launch --target workbuddy

# 2) 设壁纸 + 莫奈配色 + 面板（控制 API 端口 9334）
node bundle/cli.js serve --detach --target workbuddy
node bundle/cli.js apply "D:\pictures\wallpaper.jpg" --target workbuddy --dim 25
```

也可以直接用环境变量固定目标，省掉每条命令的 `--target`：

```bash
set BEAUTIFY_TARGET=workbuddy        # PowerShell: $env:BEAUTIFY_TARGET="workbuddy"
```

## CLI 命令

| 命令 | 用途 |
|---|---|
| `--target zcode\|workbuddy\|auto` | 全局参数：选择要美化的客户端（默认 zcode；`auto` 按已安装的客户端推断），等价于环境变量 `BEAUTIFY_TARGET` |
| `enable` | 显式开启实验性 CDP 注入：记录同意、为启动项补上 CDP flag、启动本地服务 |
| `disable [--keep-launchers]` | 关闭并回滚：清除注入外观（含渲染器本地缓存）、停止服务、从启动项剥离 flag（`--keep-launchers` 保留 flag） |
| `launch [--port N]` | 以调试端口启动客户端（需先完全退出）；ZCode 默认 9222，WorkBuddy 默认 9333 |
| `apply <image> [--blur] [--dim] [--fit] [--no-monet]` | 设壁纸并适配配色（`--fit cover\|contain\|smart`） |
| `apply-scene <pkg-or-dir>` | 端到端导入 Wallpaper Engine 场景 / 视频壁纸 |
| `colors` | 不换图，重新应用已存主题 |
| `serve [--detach] [--api-port M]` | 守护模式 + 设置面板 + 本地控制 API（默认 API 端口 9223）；`--detach` 使其脱离启动它的终端存活 |
| `watch` | 无面板守护模式：ZCode 重启后自动重注入 |
| `repair-launchers [--dry-run] [--remove]` | 扫描/修复所有启动项，确保 ZCode 总是带 CDP 端口启动；`--remove` 改为从所有启动项剥离该 flag（回滚用） |
| `reset` | 移除壁纸与配色覆盖 |
| `status` | 查看 CDP 可达性与渲染器目标 |

## MCP 工具

| 工具 | 用途 |
|---|---|
| `set_background` | 设壁纸（图片或场景）+ 莫奈配色 |
| `import_scene_wallpaper` | 端到端导入 WE 场景 / 视频壁纸 |
| `apply_options` | 不重传图片，单独调 blur/dim/monet/透显/取景、消息流宽度、气泡样式；改气泡时会在 ZCode 3.16+ 打开气泡工坊画廊 |
| `bubble_studio_state` | 气泡工坊页面数据源：当前样式、匹配配方 id、内置预设、已保存配方 |
| `save_bubble_recipe` | 保存（或更新）命名气泡配方——缺省保存当前生效样式 |
| `delete_bubble_recipe` | 按 id 删除已保存配方（内置预设受保护） |
| `refresh_theme` | 重启后重注入已存主题 |
| `reset_appearance` | 移除壁纸与覆盖，还原默认 |
| `beautify_status` | 查看已存配置 |
| `enable_experimental` | 显式开启实验性 CDP 注入（记录同意、修复启动项、启动服务） |
| `disable_experimental` | 关闭并回滚：实时清理注入 + 从启动项剥离 flag（`clean_launchers=false` 保留） |
| `repair_launchers` | 扫描/修复启动项（`action: "add"` 默认补 flag，`"remove"` 剥离；结构化报告） |

## 项目结构

```
├─ src/
│  ├─ cli.ts                 # CLI 入口：launch / apply / apply-scene / colors / reset / status / watch / serve / repair-launchers
│  ├─ core/
│  │  ├─ cdp.ts              # 精简 Chrome DevTools Protocol 客户端 + 注入脚本
│  │  ├─ inject.ts           # 装配注入载荷（壁纸层 + token 覆盖 + 聊天区样式）
│  │  ├─ launch.ts           # 配置持久化 + ZCode 启动器（感知单实例锁）
│  │  ├─ launchers.ts        # 启动项修复：快捷方式 + 注册表处理器保持携带 CDP 端口
│  │  ├─ monet.ts            # 图片解码、MD3 取色、智能适配（smart fit）分析
│  │  ├─ tokens.ts           # MD3 调色板 → ZCode 的 Tailwind v4 --color-* 变量映射
│  │  ├─ session.ts          # CLI 与 MCP 共用的应用/还原操作
│  │  ├─ wallpaperType.ts    # 输入类型检测（image / scene / video / web）
│  │  ├─ dependencyCheck.ts  # Wallpaper Engine + ffmpeg 检测与安装引导
│  │  ├─ weLauncher.ts       # WE 窗口控制（专属窗口打开/关闭壁纸）
│  │  ├─ weLibrary.ts        # 本机 WE 壁纸库浏览（创意工坊 + 自建项目）
│  │  ├─ recorder.ts         # WE 窗口的 Desktop Duplication 捕获
│  │  ├─ loopProcessor.ts    # 无缝循环构造（首帧 == 末帧）
│  │  ├─ scenePipeline.ts    # 端到端导入流水线（检测 → 依赖 → 录制 → 循环 → 缓存）
│  │  ├─ cacheManager.ts     # 内容寻址场景缓存（LRU）
│  │  ├─ media.ts            # 场景循环的 HTTP 媒体端点（Range 请求）
│  │  ├─ bubbleRecipes.ts    # 聊天气泡预设样式
│  │  └─ server.ts           # serve 模式：控制 API + 轮播调度 + 持久注入会话
│  ├─ panel/panelScript.ts   # 注入式设置面板（三标签：壁纸 / 定时播放 / 设置）
│  └─ mcp/server.ts          # 向 ZCode 智能体暴露工具的 MCP 服务
├─ commands/beautify.md      # /beautify 斜杠命令
├─ commands/bubble.md        # /bubble 斜杠命令（按描述改气泡样式）
├─ skills/beautify/SKILL.md  # 面向智能体的工作流文档
├─ .zcode-plugin/plugin.json # ZCode 插件清单（命令、技能、MCP 服务）
├─ marketplace.json          # 市场索引，让仓库可在 ZCode 插件市场被发现
├─ scripts/                  # bundle（dist/ 产物）、package（发布 zip）、record-install
└─ dist/                     # 预构建 cli.js + mcp/server.js —— 用户零构建
```

用户数据位于 `~/.zcode/cli/plugins/data/zcode-beautify/`：`config.json`（当前配置）、`config.backup.json`（还原时记住的备份）、`wallpaper.*`（壁纸副本，原图移动或删除后主题依然有效）、`scenes/`（内容寻址的动态壁纸缓存，LRU 上限）。

## 开发

```bash
npm install
npm run build    # 类型检查 + 编译到 dist/
npm run bundle   # 预构建单文件产物（仓库随附）
```

`dist/` 已提交入库，用户无需构建。修改 `src/` 后请运行 `npm run bundle` 并提交更新后的产物。

## 技能包（`skill-pack/`）

`skill-pack/` 是一份自包含、平台无关的 AI 编码智能体技能包（Claude、DeepSeek、Codex、豆包……均可）：把文件夹交给任意智能体，它就能为**任意** Electron 应用重建这套美化能力——CDP 通道、MD3 取色、注入模板、实时调参 API，以及来自实战的踩坑清单。与本仓库同步版本。可从 [Releases 页面](https://github.com/Mc-GrowlR/zcode-beautify-for-wallpaper-engine/releases)下载 zip，或直接阅读 [`skill-pack/SKILL.md`](skill-pack/SKILL.md)。

## 实验性 opt-in（CDP 注入）

注入机制属**实验性**能力，**默认关闭**（0.6.0 起）：未显式开启前，插件不启动后台服务、不改任何启动项、智能体侧工具只返回指引而不执行。它本质上是绕过插件 UI API 直接操作渲染器 —— 桌面端目前没有受支持的扩展点，这正是它必须藏在显式开关之后的原因。

**开启会做什么**（`enable_experimental`，或 `zcode-beautify enable`）：

- 为客户端的启动项（桌面 / 开始菜单 / 任务栏快捷方式、`zcode://` 协议、资源管理器右键菜单）加上 `--remote-debugging-port=9222`，使 ZCode 打开本地 CDP 端口。需要管理员权限的机器级条目只报告、绝不修改。
- 启动本地服务，并恢复"自愈"——在客户端更新重建快捷方式后自动补回 flag。
- 在插件配置中记录同意（时间戳 + 插件版本）。0.6.0 之前的老安装自动沿用开启状态（标记为 migrated）；面板会显示该状态并提供一键停用。

**会暴露什么：** CDP 端口只绑定 `127.0.0.1`（仅本机回环），但**无鉴权** —— 端口开着期间，本机以当前用户运行的任意进程都可以附加到渲染器。插件自己的控制 API 额外有随机 token 保护，但 CDP 端口本身是 Chromium 的行为，插件无法控制。本机存在不可信用户/软件时请不要开启。

**恢复 / 卸载：**

- `disable_experimental`（MCP）或 `zcode-beautify disable`：停止服务、清除注入外观（含渲染器本地缓存）、从启动项剥离 flag（`--keep-launchers` 保留）。之后请完全重启 ZCode。壁纸设置会保留，重新开启即可恢复。
- `zcode-beautify repair-launchers --remove`：只剥离 flag，不动其它任何东西 —— 用于回滚 0.6.0 之前版本自动写入的启动项。
- 卸载插件：先执行 `node <插件目录>/bundle/cli.js disable`（或 `repair-launchers --remove`），再移除插件。
- 升级注意：ZCode 更新器重建的开始菜单快捷方式不带 flag；开启状态下自愈会在下次启动 ZCode 时补回 —— 关闭状态下任何东西都不会再被写回。

## 风险与限制

- 注入通过 CDP（Chrome DevTools 协议）实现，属**非官方**手段，且为**实验性、需显式 opt-in**（见上节）。ZCode 更新可能使其失效；`reset` 可随时还原默认外观。
- `launch` 需要重启一次 ZCode。若 `serve`/`watch` 未运行，每次 ZCode 重启主题都会丢失（CDP 会话随连接关闭）。无需手动修改：实验模式开启时，插件会自动为所有 ZCode 启动项（快捷方式、协议处理器、右键菜单）补上 ` --remote-debugging-port=9222`，只要 `serve` 在运行，重启也会自动恢复。请用 `serve --detach` 启动：前台 `serve` 会随启动它的终端（或智能体会话）一起退出，面板随即显示离线。
- 聊天区样式的选择器（`[data-v4-user-input-bubble]`、`conversation:max-w-*` 容器查询）绑定 ZCode 当前 DOM 结构；ZCode 改版后可能需要更新选择器。
- 控制 API 仅绑定 `127.0.0.1`，并使用每次启动随机生成的 token 鉴权；媒体 URL 以查询参数携带 token。CDP 端口本身无鉴权 —— 见上节 opt-in 说明。
- 动态导入（场景捕获）仅限 Windows（Desktop Duplication API）；其余功能跨平台。

## 许可证

MIT
