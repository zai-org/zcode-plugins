---
description: 列出 Android 设备与模拟器,选择目标设备
argument-hint: [serial(可选,要记住的设备序列号)]
---

按 android-runner 技能处理设备管理:

$ARGUMENTS

1. cd 到当前 Gradle 工程目录(若当前不在工程内,先向用户确认工程路径)。
2. 运行 `node "${ZCODE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/ar.js" devices`,把设备(型号/序列号/Android 版本/真机或模拟器)和可用 AVD 整理成表格展示。
3. 若 $ARGUMENTS 给了序列号,执行 `ar use <序列号>` 记住目标设备;多台设备且用户没指明时,列出让用户挑,不要擅自选。
4. 设备不可用(unauthorized/offline)时,引用脚本给出的修复建议。
