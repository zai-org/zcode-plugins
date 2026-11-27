---
name: android-runner
description: Android 开发运行辅助:ZCode 侧栏图形面板(设备/编译/安装/启动/日志),以及命令行式的编译安装启动、设备管理、logcat、环境自检。当用户要求打开 Android 面板、运行/调试 Android 工程、把 App 装到手机、看设备日志、启动模拟器、gradle 编译打包、检查 adb/SDK/JDK 环境时使用。
---

# Android Runner

本插件有两种用法:**侧栏图形面板**(推荐,对标 VSCode 扩展的侧边栏)和 **ar.js 命令行**。

## 1. 图形面板(优先)

插件自带 MCP 服务器,提供 ZCode 原生侧栏面板:

- **打开方式**:调用本插件的 `open_panel` 工具(工具名类似 `mcp__plugin_android_runner_android_runner__open_panel`)。用户也可以用 `/android-panel` 命令。
- 面板里能做的事全部是按钮操作:**运行 / 编译 / 安装 / 启动 / 停止 / 重启 / 日志 / 环境自检 / 卸载 / 清数据**,设备卡片切换目标设备,模拟器一键启动,实时输出控制台。
- 面板自己会调插件工具(`panel_status` / `panel_action` / `panel_job` / `panel_logcat`),这些是 **app-only** 工具,模型不需要直接调用 —— 你的职责是**打开面板并引导用户点按钮**,而不是替他跑命令。
- 自动定位工程:当前工作区只有一个 Gradle 工程时直接选中;多个时面板顶部出现工程下拉框。

**什么时候用面板、什么时候用命令行:** 用户说"打开面板/图形界面/我要看设备"→ `open_panel`。用户说"帮我把 App 装到手机上"这类**一句话指令**→ 直接用下面的 ar.js,结果更好写进对话。

## 2. 命令行 ar.js

零依赖脚本,自动探测:工程根(向上 6 层找 gradlew)、adb(local.properties → ANDROID_HOME → 常见 SDK 目录 → PATH)、JDK(.idea/gradle.xml 的 gradleJvm → JAVA_HOME → 系统默认)、模块、包名(applicationId)、APK 路径(output-metadata.json)。

```bash
node "${ZCODE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/ar.js" <命令> [参数]
```

在 Android 工程目录(或其子目录)下运行 —— 脚本会向上找 gradlew。

| 命令 | 作用 |
|---|---|
| `devices [--json]` | 设备(型号/序列号/Android 版本/真机或模拟器)与 AVD |
| `use <serial>` / `use --emulator <名>` | 记住目标设备 / 启动 AVD(最多等 180s)并选中 |
| `run` | 编译 → 安装 → 启动 |
| `build` | 仅编译(无设备也可) |
| `clean [--scope stale\|intermediates\|gradle]` | 清理构建缓存 |
| `rebuild [--scope ...]` | 清理缓存后重新编译(清理重建) |
| `install` | 仅安装(Android 11+ 先 `--fastdeploy`,失败回退全量;**签名不一致自动卸载重装**) |
| `launch` / `stop` / `restart` | 启动 / 强停 / 重启(resolve-activity,失败回退 monkey) |
| `uninstall` / `clear-data` | 卸载 / 清数据(**破坏性**) |
| `logcat` | 持续输出,优先只看本应用进程 |
| `mirror [--serial]` | 用 scrcpy 投屏到电脑(外部窗口;`--stop` 关闭) |
| `java [路径\|版本]` | 查看/记住本工程使用的 JDK(`--clear` 恢复自动) |
| `flavor [名字]` | 查看/记住本工程的 productFlavor(`--clear` 恢复自动,默认 official) |
| `doctor` | 环境自检报告 |
| `info [--json]` | 工程探测结果 |
| `dashboard [--open]` | 生成静态 HTML 面板(面板不可用时的浏览器兜底) |

通用参数:`--module`(默认 app)、`--variant`(默认 debug)、`--flavor`(productFlavor,默认 official / 唯一 flavor)、`--task`、`--apk`、`--package`、`--serial`、`--adb`、`--java-home`、`--reinstall`、`--no-reinstall`;`--` 之后透传给 Gradle(如 `ar build -- --info`)。

- `build` **不需要设备**:没设备、设备未授权、多设备未选择时都能正常编译,不要为了编译先让用户选设备。
- 安装/启动/停止/日志需要唯一目标设备:多台在线且无偏好时会报错,先 `ar use <serial>` 或让用户点面板「设为当前」。
- **JDK**:插件按 Gradle 版本自动选(读 wrapper / `org.gradle.java.home` / `.idea` / `JAVA_HOME`);用户想换时用 `ar java <路径|17>` 记住、`ar java --clear` 恢复自动,或单次 `--java-home`。编译失败先看 `ar doctor` 的 JDK 行。
- **多渠道/Flavor**:像 `channel.txt` + `productFlavors` 的工程,默认只打 `official` 的 debug 包;运行/编译**始终 debug**,不会切 release,也绝不一次编所有渠道。需要特定渠道用 `--flavor <名字>`(仍是该渠道 debug)。APK 在 `outputs/apk/<flavor>/<variant>/`。**明确识别到多个 flavor 且没选**时才要求选择;完全识别不到 flavor 名称时默认按普通 debug 构建(不要拦着用户),面板里可直接输入名字。
- **快捷指定**:面板「应用」区有 Flavor 下拉、「环境」区有 JDK 下拉;命令行用 `ar flavor <名字>` / `ar java <路径|版本>` 按工程记住;斜杠命令 `/android-flavor`、`/android-java`、`/android-run flavor=baidu`。
- **权限**:面板状态/任务/日志走 MCP resource,不走工具审批;不要把轮询改回 tools/call。点按钮的动作会按当前模式请求一次;聊天里直接跑 CLI 可能触发 Bash 审批。
- flavor 名称是动态生成、静态解析不到时,面板 Flavor 行仍可**直接输入**名字点「应用」;不要只提示用户去敲命令。

退出码:0 成功;1 操作失败;2 环境问题;3 需要用户确认;130 被中断。

## 3. 工作流

**运行到设备**:优先让用户点面板的「运行到设备」;若走命令行则 `ar run`。自动选设备顺序:--serial > 工程记住的偏好 > 恰好一台在线设备。多台且无偏好时脚本退出码 2 并列出设备 —— 和用户确认后 `ar use <serial>` 记住,或用面板点「设为当前」。

**日志**:面板的「日志」标签页是实时流;命令行 `ar logcat` 用 Bash 的 `run_in_background`,只把关键行(崩溃/ANR)读给用户。

**投屏**:用户说投屏/看手机画面时,优先让用户点面板「投屏」;命令行 `ar mirror` 需要本机安装 scrcpy(未安装时把 brew/winget/apt 命令给用户)。外部 scrcpy 窗口关闭即结束,`ar mirror --stop` 可统一关闭。

**清理重建**:编译失败若出现 `defined multiple times` / `Duplicate class` / `DexArchiveMergerException`,先建议 `ar rebuild`(面板「清理重建」),默认只清 transform/dex 缓存;必要时用 `--scope intermediates` 或 `--scope gradle`。

**排查**:先面板里点「环境自检」或 `ar doctor`,把 ❌ 项和修复建议直接给用户。

## 4. 安全政策(必须遵守)

- **安装会自动替换**:`install` / `run` 遇到签名不一致或版本回退时,会**自动卸载重装**,并清空该应用在设备上的本地数据(登录态等)。这是默认行为 —— **执行后必须主动告知用户"已自动卸载重装,本地数据被清空"**,不要静默略过。需要临时关闭时加 `--no-reinstall`(此时以退出码 3 报错);`--reinstall` 显式允许,优先于 `--no-reinstall`。卸载前脚本会核对设备上实际安装的包名(兼容 `applicationIdSuffix`,如 `com.foo.debug`)。
- `uninstall` / `clear-data` 仍属高破坏性操作:**先说明后果并征得用户同意**;面板里点这些按钮会弹确认框,你代为执行命令行时必须在用户同意后加 `--yes`。
- 多台设备时不要替用户选,列出清单让用户挑(或在面板里让他点)。
- logcat 可能含隐私信息,汇报时只摘录相关行。

## 5. 故障排查

| 现象 | 处理 |
|---|---|
| 面板打不开 | 确认插件已启用;看「设置 → 插件」详情里 MCP 服务器是否报错。MCP 服务器由 `node` 启动,需要 Node.js 18+ 在 PATH 中 |
| 面板显示"未选择 Gradle 工程" | 工作区里没有或有多含 gradlew 的工程 → 用面板顶部下拉框选,或调用 `open_panel` 时传 `project` |
| 设备 unauthorized | 手机上点「允许 USB 调试」 |
| 设备 offline | 拔插 USB 或 `adb kill-server` |
| 安装被拒(exit 3) | 签名不一致/版本回退;征得同意后 `ar install --reinstall` |
| 找不到 APK | 先编译;或 `--apk`;或检查 `--module`/`--variant` |
| 未识别包名 | 模块 build.gradle 里确认 applicationId;或 `--package` |
| 模拟器 180s 未就绪 | `ar doctor` 看环境;AVD 损坏时在 Android Studio 里重建 |
| 编译失败 | 看 Gradle 第一条 error;常见是 JDK 版本不匹配 —— `ar doctor` 看 JAVA_HOME 来源 |
