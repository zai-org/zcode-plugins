# 应用安装包制作

用 **Electron + electron-builder** 把现有的**网站或 Node 项目**包装成桌面应用。插件会识别项目，在项目旁生成 `desktop/` 目录，显示本机能打哪些安装包，并带着实时日志完成打包。

## 默认设定（v0.1）

- **工具**：electron-builder（MIT）打包 Electron 外壳。两者在第一次打包时通过 `npm install` 装进 `desktop/`，会下载 Electron（约 150 MB）。
- **目标**：默认是 macOS **dmg** 和 Windows **nsis**；另外可选 Linux AppImage 和本机免安装目录（dir，测试用）。
  - dmg 只能在 macOS 上打。
  - nsis 需要 Windows，或者在 macOS/Linux 上装 Wine。
  - 面板会显示本机能打哪些目标。生成的配置可以拿到对应的电脑上，按 README 里的命令运行。
- **签名**：可选，**只使用你自己提供的证书**。
  - macOS：填钥匙串里的证书名称（“Developer ID Application: …”）。
  - Windows：填 `.pfx` 证书文件路径。密码从环境变量 `WIN_CSC_KEY_PASSWORD` 读取，插件不保存。
  - 没有证书就**不签名**。README 会写明用户第一次打开时会看到什么（macOS：右键 → 打开；Windows：SmartScreen → 仍要运行）。
  - 不做 Apple 公证。

## 功能

- **识别项目**（`app_scan`）：
  - 静态网站：含 `index.html` 的目录，例如 dist/、build/、out/。
  - Node 服务：start 脚本或入口文件调用了 `listen()`。同时检查它是否读取 `process.env.PORT`。
  - 从 package.json 读取名称、版本和作者，并找出可用作图标的正方形 PNG。
- **生成配置**（`app_setup`）：在项目里生成 `desktop/`，包括：
  - `main.cjs`：
    - 静态网站通过 `app://local/` 加载，绝对路径 `/assets/…` 和前端路由都能用（找不到的路径回退到 index.html）。
    - Node 服务用 Electron 自带的 Node 在空闲端口启动，不需要另装 Node；数据目录通过 `APP_DATA_DIR` 传入，日志写到 `server.log`。
    - 只允许运行一个实例；外部链接用浏览器打开；渲染进程开启沙箱。
  - `package.json`：固定 electron 和 electron-builder 的版本。
  - `electron-builder.yml`：appId、产品名、dmg、nsis（可选安装目录，创建快捷方式）、AppImage，网站或服务代码作为附加资源打进安装包。
  - `build/icon.png`：你的 PNG（至少 512 px 的正方形），或自动生成的图标。
  - `README.md`：打包命令和签名状态。
- **检查**（`app_check`）：校验配置，并显示每个目标能否在本机打包。
  - 校验内容：appId 必须是反向域名格式；版本必须是 semver；网页目录或入口文件要存在；图标尺寸；使用固定端口时给出提醒；证书文件要存在。
- **打包**（`app_build` / `app_status`）：第一次先 `npm install`，然后运行 `electron-builder --publish never`。面板实时显示日志，并列出 `desktop/release/` 里的产物。

## 用法

在 ZCode Desktop 里对 Agent 说：

- “把这个网站做成 Mac 和 Windows 桌面应用”
- “把我的 Node 服务打包成桌面应用”
- “这台电脑能打哪些安装包？”

## 工具

| 工具 | 作用 |
|---|---|
| `app_scan` | 识别项目类型、入口、端口和图标 |
| `app_setup` | 生成或更新 `desktop/`（外壳、electron-builder.yml、图标、README） |
| `app_check` | 校验配置，查看本机能打哪些目标 |
| `app_build` | 运行 electron-builder 打包一个目标 |
| `app_status` | 查看打包进度和日志 |

## 范围（v0.1）

- 不做自动更新服务器、应用商店上架和 Apple 公证（公证需要 Apple 账号）。
- 不支持 Next/Nuxt 服务端渲染，请改用静态导出。Node 服务必须能用 `node <入口>` 启动。
- Node 服务会把整个项目目录（包括 `node_modules`）打进安装包。

## 隐私、网络和文件

- 不需要 API 密钥，也不需要账号。只有第一次打包时会在 `desktop/` 里运行 `npm install`，从 npm 和 GitHub 下载 Electron 和 electron-builder。
- 只写 `<项目>/desktop/` 和 `.app-installer/state.json`。证书密码不会写入磁盘。
