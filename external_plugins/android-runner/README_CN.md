# Android Device Runner

在 ZCode 里运行 Android 工程:侧栏面板看设备、编译、安装、启动、看日志。

## 能做什么

**侧栏面板**

- 设备卡片:型号、序列号、Android 版本、真机/模拟器;点击切换目标设备
- 模拟器:列出 AVD,一键启动并等待就绪(最多 180 秒)
- 应用:包名、模块/变体、APK 大小与构建时间
- 环境:SDK / adb / JDK / Gradle 实时探测结果
- 操作:运行(编译→安装→启动)、编译、安装、启动、停止、重启、日志、环境自检、卸载、清数据
- 控制台:编译/安装/启动的实时流式输出;日志标签页是实时 logcat

**命令行**(`scripts/ar.js`,零依赖)

```bash
node scripts/ar.js doctor          # 环境自检
node scripts/ar.js devices         # 设备与模拟器
node scripts/ar.js use <serial>    # 记住目标设备
node scripts/ar.js run             # 编译 → 安装 → 启动
node scripts/ar.js logcat          # 只看本应用进程的日志
```

完整命令:`ar.js --help`。

## 零配置探测

| 项 | 探测顺序 |
|---|---|
| 工程根目录 | 当前窗口工作区内找 `gradlew`(向上 6 层 / 向下扫描) |
| adb | `local.properties` → `ANDROID_HOME` → 常见 SDK 目录 → `PATH` |
| JDK | `.idea/gradle.xml` 的 `gradleJvm` → `JAVA_HOME` → 平台默认 |
| 包名 | `output-metadata.json` → 模块 `build.gradle` 的 `applicationId` |
| APK | `build/outputs/apk/<variant>/` 下最新的产物 |

探测不到时可显式指定:`--module`、`--variant`、`--apk`、`--package`、`--adb`、`--java-home`。

## 副作用与安全

- **命令执行**:在本机运行工程自己的 `gradlew` 和 `adb`,插件自身不联网。
- **文件写入**:缺少 `local.properties` 时可能自动创建(写入 `sdk.dir`);在 `~/.android-runner/` 记住设备与工程选择。
- **破坏性**:签名不一致或版本回退时,安装会**自动卸载重装**,并清空该应用的本地数据。可用 `--no-reinstall` 关闭。
- `uninstall` / `clear-data` 属破坏性操作:面板里会二次确认,命令行需要显式 `--yes`。
- **MCP 服务器**:本地 stdio 服务(`scripts/mcp-server.mjs`),承载面板并执行命令,不监听任何端口。

## 要求

- ZCode Desktop(支持 `ui.surfaces` 面板的版本)
- Node.js 18+,且在 `PATH` 中(用于启动 MCP 服务器)
- Android SDK(含 `platform-tools/adb`)
- 工程自带 Gradle Wrapper(`gradlew`)

## 目录结构

```
.zcode-plugin/plugin.json   # 清单:ui.surfaces + MCP 服务器
assets/panel.html           # 侧栏面板 UI
scripts/mcp-server.mjs      # MCP 服务器:工具、资源、后台作业
scripts/ar.js               # 命令行核心:探测、设备、编译、安装、启动、日志
scripts/project-info.js     # 模块 / APK / 包名探测
skills/android-runner/      # 技能说明
commands/                   # /android-run, /android-doctor, /android-devices, /android-panel
```

## License

MIT。探测与执行逻辑移植自 [menggod/android-runner](https://github.com/menggod/android-runner),
原项目 `LICENSE` 保留在本目录。
