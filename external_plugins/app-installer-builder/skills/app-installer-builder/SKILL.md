---
name: app-installer-builder
description: 用 Electron + electron-builder 把现有网站或 Node 项目打包成桌面应用（macOS dmg、Windows nsis、Linux AppImage）：识别项目、生成 desktop/ 外壳与 electron-builder.yml、显示本机能打哪些安装包、实际打包。用户提到“做成桌面应用 / 安装包 / exe / dmg / Electron 打包”时使用。签名只用用户自己提供的证书。
---

# 应用安装包制作（electron-builder）

1. 先用 `app_scan(dir)` 识别项目：
   - 静态网站：需要有构建好的 index.html。没有的话，先让用户运行 `npm run build`，或者由你来运行。
   - Node 服务：最好读取 `process.env.PORT`。如果用的是固定端口，提醒用户改成读取 `process.env.PORT`。
   - Next/Nuxt 服务端渲染不支持，请改用静态导出。
2. 用 `app_setup(dir, name, appId, version, targets)` 生成配置：
   - appId 用反向域名，例如 `com.公司.应用`，不要保留 `com.example`。
   - 默认目标是 `["dmg","nsis"]`。
   - 图标用正方形 PNG，至少 512 px；没有的话插件会自动生成。
3. 签名：只有用户明确提供了证书才填。
   - macOS：`macIdentity` 填钥匙串里的证书名称。
   - Windows：`winCertificateFile` 填 .pfx 证书路径。
   - **不要索取、也不要传入证书密码**。请用户自己把密码设到环境变量 `WIN_CSC_KEY_PASSWORD`。
   - 没有证书就不签名，并告诉用户首次打开时会出现的提示。
4. 用 `app_check()` 查看本机能打哪些安装包：dmg 只能在 Mac 上打；nsis 需要 Windows，或者安装了 Wine。
5. 用 `app_build(target)` 打包：
   - 第一次打包会下载 Electron（约 150 MB）。
   - 如果返回时还在打包，就继续调用 `app_status()`，直到完成。
   - 本机不能打的目标：告诉用户把项目带到对应的电脑上，在 desktop/ 里运行 README 中的命令。
6. 完成后告诉用户：安装包在 `desktop/release/` 里，以及是否已签名。
