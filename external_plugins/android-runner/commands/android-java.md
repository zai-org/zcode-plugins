---
description: 查看/选择当前工程 Gradle 使用的 JDK
argument-hint: [JDK 路径或大版本,如 17 | --clear]
---

按 android-runner 技能处理 JDK:

$ARGUMENTS

1. cd 到当前 Gradle 工程目录(若当前不在工程内,先向用户确认工程路径)。
2. 若 $ARGUMENTS 给了路径或版本,执行 `node "${ZCODE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/ar.js" java <参数>`;`--clear` 恢复自动。
3. 没有参数时执行 `ar.js java`,列出当前选择、来源、兼容性和本机可用 JDK。
4. 选择必须与 Gradle 版本兼容(老工程 MaxPermSize 只能 Java 8),不兼容时要明确告知用户。
