---
description: 选择/查看当前工程 debug 使用的 productFlavor(不会一次编所有渠道)
argument-hint: [渠道名 | --clear]
---

按 android-runner 技能处理 flavor:

$ARGUMENTS

1. cd 到当前 Gradle 工程目录(若当前不在工程内,先向用户确认工程路径)。
2. 若 $ARGUMENTS 是渠道名,执行 `node "${ZCODE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/ar.js" flavor <渠道名>`;`--clear` 则恢复自动。
3. 没有参数时执行 `ar.js flavor`,把当前 flavor、可用列表和构建任务展示给用户。
4. 运行/编译始终是 debug;默认 official,不要一次构建所有渠道。
