---
description: 打开 Android Runner 侧栏面板(设备/编译/安装/启动/日志)
---

打开 Android Runner 的 ZCode 侧栏面板。

1. 调用本插件提供的 `open_panel` 工具(工具名形如 `mcp__plugin_android_runner_android_runner__open_panel`)。
   - 如果用户当前在一个具体的 Android 工程目录下,把该目录作为 `project` 参数传入。
2. 面板打开后,简要告诉用户能点什么:设备卡片可切换目标设备、模拟器可一键启动、「运行到设备」是编译+安装+启动、日志标签页是实时 logcat。
3. 如果 `open_panel` 工具不可用(面板未注册/MCP 未启动),回退到命令行兜底:
   `node "${ZCODE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/ar.js" dashboard --open`,
   并说明这是浏览器面板,不是 ZCode 内嵌面板。
