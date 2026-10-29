---
name: xiaoqi-pet
description: 让 ZCode 桌宠「小栖」说话或互动时使用。当用户提到桌宠、小栖、桌面宠物（pet），或要求当前任务进度在桌宠上露出的场景；也包含 xiaoqi-pet 插件的事件文件约定与排查方法。
---

# 小栖桌宠（xiaoqi-pet）

小栖是一个桌面宠物（macOS 原生应用，或 Windows / Linux 的 Electron 版），漂浮在所有窗口之上，实时显示 ZCode 会话的进行状态（思考/执行工具/等待确认/完成）。会话状态由插件 hooks 自动投递，你不需要为状态展示做任何事。

## 让小栖说话

写一个互动事件文件，小栖桌面端会在 1 秒内弹出一个临时气泡，展示 `speech` 文本：

```bash
# macOS
dir="$HOME/Library/Application Support/XiaoqiPet/emote"
# Linux：dir="${XDG_CONFIG_HOME:-$HOME/.config}/xiaoqi-pet/emote"
# Windows(Git-Bash)：dir="${APPDATA}/XiaoqiPet/emote"
mkdir -p "$dir"
tmp=$(mktemp "$dir/.emote.XXXXXX")
printf '{"v":1,"type":"emote","speech":"%s","seconds":6}' "说的话" > "$tmp"
mv -f "$tmp" "$dir/$(date +%s)-$$.json"
```

字段说明：

- `speech`：必填，气泡文本，UTF-8，建议不超过 60 个字符，最长 200（超长会被截断）。只放一句话，不放列表和代码。
- `seconds`：可选，展示时长 3–30 秒，默认 6。

## 使用分寸

- 只在用户明确要求（"让小栖说……"）、阶段性里程碑（重大检查点通过）或等待用户输入需要提醒时使用；每个回合至多一次，不刷屏。
- `speech` 不要包含敏感信息、长路径、代码片段；语气简短可爱即可。
- 文件必须先写临时文件再 `mv` 原子改名，避免读到半截内容。

## 排查

- 用户说小栖没反应：先确认状态目录是否存在（macOS `~/Library/Application Support/XiaoqiPet/`，Linux `~/.config/xiaoqi-pet/`，Windows `%APPDATA%\XiaoqiPet\`；hook 已在投递则存在）；再确认桌宠是否在运行（macOS 是「ZCode Xiaoqi Pet.app」，菜单栏爪印图标）。应用未运行时事件文件会安全留存，应用启动后会自动补上最近状态。
- 状态长时间不动：运行 `~/Applications/ZCode Xiaoqi Pet.app/Contents/MacOS/XiaoqiPet --diagnose`（或 dist 路径）查看解析出的会话状态；`pendingFeedFiles` 大于 0 说明应用没在消费事件。
