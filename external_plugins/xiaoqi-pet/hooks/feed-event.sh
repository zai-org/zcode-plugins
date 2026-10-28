#!/bin/bash
# 小栖桌宠事件投递：把 ZCode hook 的 stdin JSON 原样包装成一个事件文件。
# 目录：macOS ~/Library/Application Support/XiaoqiPet/feed/
#       Linux  $XDG_CONFIG_HOME/xiaoqi-pet/feed/（默认 ~/.config/xiaoqi-pet/feed/）
#       Windows(Git-Bash) %APPDATA%\XiaoqiPet\feed\
# 每个事件一个文件，先写临时文件再原子改名；任何情况下都退出 0，不影响会话。

event="$1"
case "$event" in
  SessionStart|UserPromptSubmit|PreToolUse|PermissionRequest|PostToolUse|PostToolUseFailure|Stop) ;;
  *) exit 0 ;;
esac

case "$(uname -s)" in
  Darwin)
    base="$HOME/Library/Application Support/XiaoqiPet"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    appdata="${APPDATA:-$HOME/AppData/Roaming}"
    appdata="$(cygpath -u "$appdata" 2>/dev/null || printf '%s' "$appdata")"
    base="$appdata/XiaoqiPet"
    ;;
  *)
    base="${XDG_CONFIG_HOME:-$HOME/.config}/xiaoqi-pet"
    ;;
esac

dir="$base/feed"
mkdir -p "$dir" 2>/dev/null || exit 0
chmod 700 "$base" "$dir" 2>/dev/null

tmp=$(mktemp "$dir/.feed.XXXXXX") 2>/dev/null || exit 0
cwd_escaped=$(pwd | sed 's/\\/\\\\/g; s/"/\\"/g')
{
  printf '{"v":1,"event":"%s","at":%s,"cwd":"%s","payload":' "$event" "$(date +%s)" "$cwd_escaped"
  head -c 65536
  printf '}'
} > "$tmp" 2>/dev/null

if [ -s "$tmp" ] && mv -f "$tmp" "$dir/$(date +%s)-$$-$RANDOM.json" 2>/dev/null; then
  :
else
  rm -f "$tmp" 2>/dev/null
fi

# 桌宠应用不在线时避免目录无限增长：每小时顺带清理超过一天的残留事件文件。
marker="$dir/.cleaned"
now=$(date +%s)
marker_mtime=0
if [ -f "$marker" ]; then
  marker_mtime=$(stat -f %m "$marker" 2>/dev/null || stat -c %Y "$marker" 2>/dev/null || echo 0)
fi
if [ $((now - marker_mtime)) -gt 3600 ]; then
  find "$dir" -name '*.json' -mtime +1 -delete 2>/dev/null
  touch "$marker" 2>/dev/null
fi

exit 0
