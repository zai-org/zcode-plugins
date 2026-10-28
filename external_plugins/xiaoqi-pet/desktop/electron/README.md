# Xiaoqi Pet — Windows / Linux（跨平台 Electron 版）

xiaoqi-pet 插件的跨平台桌宠，用 Electron 实现。读的是插件 hooks 落盘的本地事件文件（不是 HTTP 桥），和 macOS 原生版共享同一套目录契约与状态语义。

macOS 优先用 `desktop/` 里的原生 Swift 版；本 Electron 版主要面向 Windows 和 Linux。在 macOS 上如果检测到原生版正在运行，会弹窗后自动退出，避免桌面上同时出现两只小栖。

## 从源码运行

需要 Node.js 22+（用到内置的 `node:sqlite` 读 ZCode 用量库）。

```sh
cd desktop/electron
npm install
npm start
```

## 打包

```sh
npm run dist:win     # Windows zip（x64 + arm64）
npm run dist:linux   # Linux AppImage（x64 + arm64）
```

产物在 `desktop/electron/dist/`，未签名。Windows SmartScreen 首次运行会提示；Linux 需要支持合成的窗口管理器才能透明。

## 行为

- 透明、无边框、置顶的宠物窗口；拖动移动，位置记忆。
- 单会话：宠物下方任务气泡。多会话：彩色抽屉任务卡面板（每会话固定颜色）。
- 点击任务卡尝试通过 `zcode://workspace` 把 ZCode 调到前台。
- 托盘菜单：显示 / 隐藏、任务面板、刷新用量 / 余量、退出。
- 肚子胶囊：默认今日 token 用量（只读 `~/.zcode/cli/db/db.sqlite`，Windows/Linux 路径相同，可用 `ZCODE_DATA_BASE_DIR` 覆盖根目录）；配置 `balance.json` 后显示远端套餐余量，60 秒刷新。
- 等待确认、后台完成、agent 说话（emote）都会冒泡或走系统通知。
- 事件目录：
  - macOS：`~/Library/Application Support/XiaoqiPet/{feed,emote}/`
  - Windows：`%APPDATA%\XiaoqiPet\{feed,emote}\`
  - Linux：`$XDG_CONFIG_HOME/xiaoqi-pet/{feed,emote}/`（默认 `~/.config/xiaoqi-pet/`）

## Windows hook 兜底

插件安装后，没有 bash 的 Windows 机器上 hooks 会自动落到 `hooks/feed-event.ps1`（Windows PowerShell 5.1 兼容），把事件写到 `%APPDATA%\XiaoqiPet\feed\`。装了 Git-Bash 的机器直接走 sh 脚本，同样落到这个目录。

## 验证状态

本仓库在 macOS 上开发：全部 JS 通过 `node --check`，状态机与 macOS Swift 版同语义并有模拟事件冒烟。**Windows 与 Linux 未在真机运行过**——请在目标系统上构建并验证透明窗口、托盘、通知、hook 落盘和 DPI 缩放后再宣布可用。
