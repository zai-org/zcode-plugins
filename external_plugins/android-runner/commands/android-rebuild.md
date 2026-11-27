---
description: 清理构建缓存并重新编译（清理重建），可选清理范围
argument-hint: [stale | intermediates | gradle]
---

按 android-runner 技能清理构建缓存并重新编译：

$ARGUMENTS

1. cd 到当前 Gradle 工程目录（若当前不在工程内，先向用户确认工程路径）。
2. 执行 `node "${ZCODE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/ar.js" rebuild`；$ARGUMENTS 是 `stale` / `intermediates` / `gradle` 时加 `--scope <值>`。
   - `stale`（默认）：只清 transform/dex 缓存，最快，通常用于修 `defined multiple times` / `Duplicate class`。
   - `intermediates`：清整个 `build/intermediates`。
   - `gradle`：执行 `gradlew :<module>:clean`。
3. 汇报清理了哪些目录、释放空间，以及随后编译是否成功。
