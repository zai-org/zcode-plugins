#!/usr/bin/env bash
# SessionStart hook: print a compact inventory of locally defined subagents.
# Runs at every session start; stdout is injected as context. Keep it short and
# fail-safe: any error must never block session start.
set -uo pipefail

print_dir() {
  local dir="$1" scope="$2"
  [ -d "$dir" ] || return 0
  local f base name desc
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    base=$(basename "$f" .md)
    name=$(grep -m1 '^name:' "$f" 2>/dev/null | sed -e 's/^name:[[:space:]]*//' -e 's/^"//' -e 's/"[[:space:]]*$//')
    desc=$(grep -m1 '^description:' "$f" 2>/dev/null | sed -e 's/^description:[[:space:]]*//' -e 's/^"//' -e 's/"[[:space:]]*$//')
    [ -n "$name" ] || name="$base"
    [ ${#desc} -gt 60 ] && desc="${desc:0:60}…"
    echo "- $name [$scope] ${desc:+— $desc}"
  done
}

echo "本地智能体定义(agent-manager 盘点):"
n=$(print_dir "$HOME/.zcode/agents" "用户级" | wc -l)
print_dir "$HOME/.zcode/agents" "用户级"
print_dir "$PWD/.zcode/agents" "工作区级"
[ "$n" = "0" ] && [ ! -d "$PWD/.zcode/agents" ] && echo "- (无本地定义文件,仅运行时内置智能体可用)"
exit 0
