# 小栖桌宠（Xiaoqi Desk Pet）

一个 ZCode 插件：把一只小栖放到桌面上。它漂浮在所有窗口之上，实时展示 ZCode 会话正在做什么——思考、执行工具、等你确认、还是已完成——配有多会话任务看板、彩色抽屉卡、单任务气泡、桌面通知，肚子上还挂着今日用量 / 套餐余量胶囊。

移植自 [dsh-xiaoqi-pet](https://github.com/white-source/dsh-xiaoqi-pet) 1.5.2（DeepSeek Harness 桌面伙伴）。HTTP bridge 与页内 overlay 被替换为「ZCode 插件 hooks → 本地事件文件」，不再需要端口、token；桌宠本体有两种：**macOS 原生 Swift 应用**和 **Windows / Linux / macOS 通用的 Electron 应用**，读同一套事件文件。

## 组成

| 部件 | 作用 |
| --- | --- |
| **Hooks**（7 个事件） | `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop`——每次触发把 stdin JSON 包装成一个原子事件文件。macOS/Linux 走 `feed-event.sh`，没有 bash 的 Windows 自动落到 `feed-event.ps1`。插件自带 hooks，ZCode 会自动启用 hook runner。 |
| **Skill** `xiaoqi-pet` | agent 写互动事件文件，让小栖开口说话。 |
| **命令** `/pet-say <文本>` | 让小栖说一句话的快捷方式。 |
| **macOS 原生应用** `desktop/` | 菜单栏小程序（`LSUIElement`），SwiftUI 渲染，推荐 macOS 使用。 |
| **Electron 应用** `desktop/electron/` | Windows / Linux 的桌宠（macOS 也能跑，但原生在运行时会自动退出避免出现两只）。 |

## 小栖会展示什么

- 一只可拖动的漂浮小栖，按状态呼吸（进行中 / 等待 / 完成），带任务数角标；说明文字跟随最活跃的会话。
- **肚子胶囊**：默认显示 **今日 token 用量**（来自 ZCode 本地用量库，零配置）；配置了 `balance.json` 后改显示 **套餐余量**。悬停看明细（输入 / 输出 / 推理 / 轮次 / 工具调用 / 近 7 天）。每分钟刷新，菜单可手动刷新。
- **单会话** → 宠物下方一个紧凑气泡：任务名、当前动作、耗时。
- **多会话** → 气泡让位给彩色抽屉卡（每个会话固定专属颜色），显示当前清单项 / 动作、耗时和最近几步；最多 16 个会话。
- **任务看板**（点击小栖）→ 「需要你 / 进行中 / 刚完成」分组，每个任务一张带边框的彩色卡片。
- **通知** → 会话开始等你确认、或在后台完成时，弹出非阻塞桌面气泡（Electron 版用系统通知）。
- 点击任务卡把 ZCode 调到前台。拖到任意位置、图钉固定（原生版）。中英文、深浅色自适应。

## 安装（两步：插件 + 桌宠本体）

### 1. 在 ZCode 里装插件（所有平台）

**插件市场 → 添加 → 添加插件市场**，填入 `white-source/zcode-xiaoqi-pet`，然后安装 **小栖桌宠 / Xiaoqi Desk Pet**。这一步激活 hooks、skill 和 `/pet-say` 命令。

不装桌宠本体时插件也不会报错，只是事件文件会一直堆积（hook 每小时清掉超过一天的残留）。

### 2a. macOS：下载原生桌宠

到 [Releases](https://github.com/white-source/zcode-xiaoqi-pet/releases/latest) 下载 `ZCode-Xiaoqi-Pet-*-macos-arm64.zip`，解压后把 `ZCode Xiaoqi Pet.app` 拖进「应用程序」。未签名版本首次打开请右键 → 打开，或：

```sh
xattr -dr com.apple.quarantine "/Applications/ZCode Xiaoqi Pet.app"
open -a "ZCode Xiaoqi Pet.app"
```

需要 macOS 13+。菜单栏爪印图标：显示 / 隐藏、看板、固定、重扫、刷新用量、退出。

想自己从源码构建：

```sh
cd xiaoqi-pet/desktop
./build.sh --install
```

需要 Xcode 命令行工具。

### 2b. Windows / Linux：下载 Electron 桌宠

到 [Releases](https://github.com/white-source/zcode-xiaoqi-pet/releases/latest) 下载 `*-win-x64.zip`（或 `-win-arm64.zip`）解压运行，或下载 `*.AppImage` 后 `chmod +x` 运行。Linux 需要支持合成的窗口管理器才能透明。

从源码运行 / 自行打包需要 Node.js 22+：

```sh
cd xiaoqi-pet/desktop/electron
npm install
npm start               # 直接运行
npm run dist:win        # Windows zip（x64 + arm64）
npm run dist:linux      # Linux AppImage（x64）
```

详见 [desktop/electron/README.md](desktop/electron/README.md)。

### 3. 试用

随便跑一个 ZCode 会话，一秒内小栖就会醒来。`/pet-say 你好` 让它说话。

## 套餐余量：怎么配

ZCode 的套餐额度接口需要 ZCode 内部加密保存的登录凭据，插件不去碰它；所以胶囊默认显示本地用量。如果你有任何能返回 JSON 的额度接口（BigModel 开放平台的账单接口、new-api / one-api 之类的中转、或自己写的小代理），在状态目录放一个 `balance.json`：

```json
{
  "url": "https://example.com/api/quota",
  "headers": { "Authorization": "Bearer xxx" },
  "valuePath": "data.remaining",
  "label": "套餐余量",
  "prefix": "¥",
  "suffix": ""
}
```

`valuePath` 用点号路径取值（支持数组下标，如 `data.balances.0.balance`）。拉取失败会沿用上一次的值并在明细里标「过期」。状态目录：

| 平台 | 目录 |
| --- | --- |
| macOS | `~/Library/Application Support/XiaoqiPet/` |
| Windows | `%APPDATA%\XiaoqiPet\` |
| Linux | `$XDG_CONFIG_HOME/xiaoqi-pet/`（默认 `~/.config/xiaoqi-pet/`） |

下面有 `feed/`（hook 事件）、`emote/`（互动）、`balance.json`（可选）。

## 事件文件约定

`hooks/feed-event.sh`（或 `.ps1`）每次 hook 触发落一个 JSON 文件到 `feed/`：

```json
{"v":1,"event":"PreToolUse","at":1769600000,"cwd":"/path/to/project","payload":{ …hook stdin 原文… }}
```

桌宠每秒扫描 `feed/`，把事件折叠进内存中的每会话状态机（原 dsh Host 侧进度逻辑的移植，Swift 与 JS 各一份、语义一致），消费后立即删除文件。超时会话自动清理：running 60 分钟、waiting 12 小时、done 10 分钟无事件即移除。

**隐私**：会话标题就是项目文件夹名——不展示任何 prompt 或回复内容。hook 载荷（`UserPromptSubmit` 含 prompt 文本、`Stop` 含回复预览）只写入用户专属的本地文件，桌宠消费后立即删除；桌宠不在线时，hook 内的每小时清扫会删掉超过一天的残留。用量统计只读 `~/.zcode/cli/db/db.sqlite`，不写、不联网。

## 排查

```sh
~/Applications/ZCode\ Xiaoqi\ Pet.app/Contents/MacOS/XiaoqiPet --diagnose
```

输出 feed 目录、待处理文件数、应用当前渲染的会话状态、今日 / 近 7 天用量和是否配置了远端余量。`pendingFeedFiles > 0` 说明桌宠没在运行或没在消费。Windows / Linux 看 Electron 控制台输出。

## 副作用、权限与第三方素材

- **hooks 在 7 个事件上起一次短暂进程。** ZCode 执行 `bash "<插件>/hooks/feed-event.sh" <事件>`（没有 bash 时用 `powershell -File …feed-event.ps1`）。每次运行只在状态目录写一个不超过 64 KB 的 JSON 文件、退出码 0、超时上限 5 秒；不阻塞、不改动会话，事件文件留给桌宠消费。
- **写入的文件：** `<状态目录>/feed/*.json` 与 `<状态目录>/emote/*.json`。状态目录：macOS `~/Library/Application Support/XiaoqiPet/`，Linux `${XDG_CONFIG_HOME:-~/.config}/xiaoqi-pet/`，Windows `%APPDATA%\XiaoqiPet\`。桌宠读取后删除对应事件文件；hook 会清掉超过一天的残留。
- **网络：** 插件本身不发任何网络请求。桌宠只读本地 ZCode 用量库（`~/.zcode/cli/db/db.sqlite`）显示今日 token；只有用户自己创建可选 `balance.json` 指向其额度接口时才会联网。
- **凭据：** 不涉及。插件不读取、不保存、不传输 ZCode 的凭据或 API Key。
- **桌宠本体需单独下载。** 桌宠程序不随插件分发，插件也不会下载或启动它；用户从项目的 GitHub Releases 自行安装。没装桌宠时插件不产生可见行为，也不会报错。
- **第三方素材：** 小栖形象与界面结构来自 [dsh-xiaoqi-pet](https://github.com/white-source/dsh-xiaoqi-pet)（MIT，© 2026 Xiaoqi Desk Pet contributors）。

## 兼容性与验证状态

- ZCode Desktop（支持 7 个标准 hook 事件）；macOS 13+（原生）；Windows 10+ / 主流 Linux 发行版（Electron 45）。
- 在本机（macOS）已验证：Swift 编译、模拟 hook 事件的状态机输出、用量读取、Electron 全部 JS 语法。**Windows 与 Linux 未在真机运行**——Electron 打包与 PowerShell 兜底脚本已写好但需要在目标系统上实际验证透明窗口、托盘和 hook 落盘。
- 无运行时依赖（Electron 版除 Electron 本体外无 npm 依赖）、无安装脚本。

## 许可

MIT。小栖形象与界面结构均来自 dsh-xiaoqi-pet（MIT，© white-source）。
