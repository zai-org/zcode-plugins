---
description: 编译并运行当前 Android 工程到设备(编译 → 安装 → 启动)
argument-hint: [serial(可选,目标设备序列号)]
---

按 android-runner 技能的工作流,把当前 Android 工程运行到设备:

$ARGUMENTS

1. cd 到当前 Gradle 工程目录(若当前不在工程内,先向用户确认工程路径)。
2. 用 `node "${ZCODE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/ar.js" run` 执行;若 $ARGUMENTS 给了设备序列号,加 `--serial <序列号>`。
3. 多台设备在线且无偏好时,先列出设备让用户选择,不要擅自挑。
4. 如实汇报每个阶段(编译/安装/启动)的结果与耗时;失败时引用脚本输出的修复建议。
