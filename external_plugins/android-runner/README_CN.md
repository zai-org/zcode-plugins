# Android Device Runner

在 ZCode 里运行 Android 工程:侧栏面板看设备、编译、安装、启动、看日志。

## 能做什么

**侧栏面板**

- 设备卡片:型号、序列号、Android 版本、真机/模拟器;点击切换目标设备
- 模拟器:列出 AVD,一键启动并等待就绪(最多 180 秒)
- 应用:包名、模块/变体、Flavor(可下拉/输入)、**构建任务与实际模式(单渠道 debug / 普通 debug)**、APK 大小/时间和完整路径
- 环境:SDK / adb / JDK / Gradle 实时探测结果
- 操作:运行(编译→安装→启动)、编译、**清理重建**、安装、启动、停止、重启、**投屏(scrcpy)**、日志、环境自检、卸载、清数据
- 控制台:编译/安装/启动的实时流式输出;日志标签页是实时 logcat

**命令行**(`scripts/ar.js`,零依赖)

```bash
node scripts/ar.js doctor          # 环境自检
node scripts/ar.js devices         # 设备与模拟器
node scripts/ar.js use <serial>    # 记住目标设备
node scripts/ar.js run             # 编译 → 安装 → 启动
node scripts/ar.js rebuild         # 清理 transform/dex 缓存后重新编译
node scripts/ar.js logcat          # 只看本应用进程的日志
node scripts/ar.js mirror          # 投屏到电脑(scrcpy 外部窗口)
```

完整命令:`ar.js --help`。

## 零配置探测

| 项 | 探测顺序 |
|---|---|
| 工程根目录 | 当前窗口工作区内找 `gradlew`(向上 6 层 / 向下扫描) |
| adb | `local.properties` → `ANDROID_HOME` → 常见 SDK 目录 → `PATH` |
| JDK | 本工程记住的选择 → `gradle.properties` 的 `org.gradle.java.home` → `.idea/gradle.xml` 的 `gradleJvm` → `JAVA_HOME` → Android Studio JBR → 系统 `java` → 本机 JDK 目录(自动挑与 Gradle 版本兼容的) |
| Flavor | 模块 `build.gradle` 的 `productFlavors`;默认 `official`(没有则唯一 flavor / `dev`) |
| 包名 | `output-metadata.json` → 模块 `build.gradle` 的 `applicationId` |
| APK | `build/outputs/apk/<flavor>/<variant>/`(AGP 3.x 兼容 `output.json`) |

探测不到时可显式指定:`--module`、`--variant`、`--flavor`、`--apk`、`--package`、`--adb`、`--java-home`。

### JDK 与 Flavor

- **JDK 必须和 Gradle 版本匹配**。插件会读 `gradle-wrapper.properties` 与 `gradle.properties`(例如老工程的 `-XX:MaxPermSize` 只能用 Java 8),自动挑选兼容的 JDK;工程里配置的 JDK 优先。
- 想固定用某个 JDK:`ar java <路径 或 17 / corretto-17>`(按工程记住);`ar java --clear` 恢复自动;单次可用 `--java-home` 或环境变量 `AR_JAVA_HOME`。面板「环境」区也能切换。 也可以用 `/android-java` 快捷命令。
- 多渠道工程(`channel.txt` + `productFlavors`)默认打 `official` 的 debug 包,**运行/编译始终是 debug**,不会切 release,也不会一次编所有渠道;需要某渠道时加 `--flavor <名字>`(仍然只编该渠道的 debug)。多 flavor 且没有 `official`/`dev` 时自动取第一个(面板可切换);**多维度** flavor 组合名无法静态确定,按普通 debug 构建并放宽 APK 匹配;完全解析不到 flavor 名称时也默认普通 debug。
- 想固定某个渠道:`ar flavor <名字>`(按工程记住,`ar flavor --clear` 恢复自动),或面板「应用」区的 Flavor 下拉、`/android-flavor` 命令;单次用 `--flavor <名字>`。
- 面板「应用」区的 Flavor 支持**下拉选择 + 直接输入**:静态解析不到动态 flavor 时,输入名字点「应用」即可(也支持 `/android-flavor 名字`)。

## 权限

- 面板的**状态、任务输出、logcat 刷新走 MCP resource**(`ui://android-runner/state.json` 等),不经过工具审批,所以定时刷新不会反复弹权限。
- 只有**点击操作按钮**才会调用 MCP 工具(编译/安装/运行/切换设备/JDK/Flavor、启停 logcat),ZCode 会按当前权限模式请求一次确认;这是真实副作用,属于预期。
- ZCode 当前会把所有 MCP 工具标为需要审批(即使 `readOnlyHint`),所以不要用工具轮询状态。
- 聊天里让 agent 直接跑 `ar.js` 仍可能触发 Bash 审批;优先用面板,或切换到完全访问模式。
- 插件**默认不修改工程文件**(不再自动写 `local.properties`),构建通过 `ANDROID_HOME` 传给 Gradle。

## 清理重建

- `node ar.js rebuild`（面板「清理重建」）先清构建缓存再编译；`node ar.js clean` 只清理。
- `--scope stale`（默认）只清 `transforms`/`dex` 等缓存，最快；`intermediates` 清整个中间产物；`gradle` 执行 `:module:clean`。
- 编译失败命中 `defined multiple times` / `Duplicate class` / `DexArchiveMergerException` 时,会直接提示清理重建(通常是增量缓存残留)。
- 清理后会打印实际删除的目录和释放空间。

## 投屏

- 面板「投屏」按钮或 `node ar.js mirror [--serial <序列号>]`,用 [scrcpy](https://github.com/Genymobile/scrcpy) 在电脑上打开手机画面,可鼠标键盘操作。
- 需要本机安装 scrcpy:macOS `brew install scrcpy`、Windows `winget install --id Genymobile.scrcpy -e`、Ubuntu `sudo apt install scrcpy`;装在非常规位置用 `--scrcpy <路径>` 或 `AR_SCRCPY`。
- 每台设备一个窗口;关闭窗口即结束,也可 `node ar.js mirror --stop`。默认附带 `--stay-awake`,可用 `--scrcpy-arg` 追加参数。
- 内嵌到 ZCode 面板的投屏是上游 1.5 的实验特性(WebCodecs + 自带 server),本期未移植;外部 scrcpy 窗口体验更稳。

## 副作用与安全

- **命令执行**:在本机运行工程自己的 `gradlew` 和 `adb`,插件自身不联网。
- **文件写入**:**默认不改工程文件**(不再自动创建 `local.properties`;构建通过 `ANDROID_HOME` 传给 Gradle)。需要时可加 `--local-properties`。偏好记在 `~/.android-runner/`,构建产物在 `build/`。
- **破坏性**:签名不一致或版本回退时,安装会**自动卸载重装**,并清空该应用的本地数据。可用 `--no-reinstall` 关闭,`--reinstall` 显式允许(优先于 `--no-reinstall`)。卸载前会核对设备上实际安装的包名,兼容 `applicationIdSuffix`。
- `uninstall` / `clear-data` 属破坏性操作:面板里会二次确认,命令行需要显式 `--yes`。
- **多设备**:同时连接多台设备且未选择目标时,面板会提示先「设为当前」,安装/启动类操作暂不可用;`build` 不受影响,无需选择设备。
- **MCP 服务器**:本地 stdio 服务(`scripts/mcp-server.mjs`),承载面板并执行命令,不监听任何端口。

## 要求

- ZCode Desktop(支持 `ui.surfaces` 面板的版本)
- Node.js 18+,且在 `PATH` 中(用于启动 MCP 服务器)
- Android SDK(含 `platform-tools/adb`)
- 工程自带 Gradle Wrapper(`gradlew`)
- 投屏需要本机安装 [scrcpy](https://github.com/Genymobile/scrcpy)(可选)

## 目录结构

```
.zcode-plugin/plugin.json   # 清单:ui.surfaces + MCP 服务器
assets/panel.html           # 侧栏面板 UI
scripts/mcp-server.mjs      # MCP 服务器:工具、资源、后台作业
scripts/ar.js               # 命令行核心:探测、设备、编译、安装、启动、日志
scripts/project-info.js     # 模块 / APK / 包名探测
skills/android-runner/      # 技能说明
commands/                   # /android-run, /android-doctor, /android-devices, /android-panel, /android-flavor, /android-java, /android-mirror
```

## License

MIT。探测与执行逻辑移植自 [menggod/android-runner](https://github.com/menggod/android-runner),
原项目 `LICENSE` 保留在本目录。
