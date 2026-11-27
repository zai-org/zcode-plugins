---
description: Android 运行环境自检(工程/SDK/JDK/adb/设备/模拟器/APK/包名)
---

执行 Android 运行环境自检:

1. cd 到当前 Gradle 工程目录(若当前不在工程内,先向用户确认工程路径)。
2. 运行 `node "${ZCODE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/ar.js" doctor`。
3. 把自检报告完整呈现给用户;对每个 ❌ 项,附上脚本给出的修复建议;若全部通过,明确告知环境就绪。
