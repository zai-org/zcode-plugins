#!/usr/bin/env bash
# Wire MCP servers into an agent at user scope (~/.zcode/agents/), or with
# --workspace <path> at project scope. If the agent is one of the plugin's
# shipped agents, the plugin file is copied out first (user/workspace copies
# take precedence over plugin agents); an existing user file is edited in
# place (backed up once to .pre-mcp.bak).
#
# Every listed server becomes a HARD spawn requirement: the agent refuses to
# start while any listed server is disconnected. Only list servers you trust
# to be up.
#
# Usage: enable-mcp.sh [--workspace <path>] <agent> <server> [<server> ...]
#   e.g.: enable-mcp.sh explorer Terraform codegraph Azure "MS Learn" Skills
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../oh-my-zcode-slim/agents"
TARGET_DIR="$HOME/.zcode/agents"

ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) TARGET_DIR="$2/.zcode/agents"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- "${ARGS[@]+${ARGS[@]}}"

if [ $# -lt 2 ]; then
  grep '^#' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 1
fi

AGENT="$1"; shift
FILE="$TARGET_DIR/${AGENT}.md"

mkdir -p "$TARGET_DIR"
if [ ! -e "$FILE" ]; then
  if [ -e "$SRC_DIR/${AGENT}.md" ]; then
    cp "$SRC_DIR/${AGENT}.md" "$FILE"
    echo "Copied plugin agent out to $FILE"
  else
    echo "No such agent: not at $FILE and not shipped as $SRC_DIR/${AGENT}.md" >&2
    exit 1
  fi
else
  [ -e "$FILE.pre-mcp.bak" ] || cp "$FILE" "$FILE.pre-mcp.bak"
fi

LIST=""
for s in "$@"; do
  item="$s"
  case "$s" in *" "*) item="\"$s\"" ;; esac
  if [ -z "$LIST" ]; then LIST="$item"; else LIST="$LIST, $item"; fi
done
LINE="mcpServers: [$LIST]"

if grep -q '^mcpServers:' "$FILE"; then
  sed -i "s|^mcpServers:.*|$LINE|" "$FILE"
else
  sed -i "/^tools:/a $LINE" "$FILE"
fi

echo "Set $LINE in $FILE"
echo "Restart your ZCode session for the change to take effect."
