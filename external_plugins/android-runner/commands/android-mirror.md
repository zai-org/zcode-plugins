---
description: 用 scrcpy 把 Android 设备画面投到电脑（外部窗口，可鼠标键盘操作）
argument-hint: [serial(可选)]
---

按 android-runner 技能投屏：

$ARGUMENTS

1. cd 到当前 Gradle 工程目录（若当前不在工程内，先让用户确认，或直接传设备序列号）。
2. 执行 `node "${ZCODE_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/ar.js" mirror`；$ARGUMENTS 给了序列号就加 `--serial <序列号>`。
3. 若提示未安装 scrcpy，把对应的安装命令给用户：macOS `brew install scrcpy` / Windows `winget install --id Genymobile.scrcpy -e` / Ubuntu `sudo apt install scrcpy`。
4. 投屏是外部 scrcpy 窗口，关闭窗口即结束；需要关闭时执行 `ar.js mirror --stop`。
