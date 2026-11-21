#!/usr/bin/env bash
# Remove a council seat agent (renames it to .removed.bak rather than deleting).
# Usage: remove-councillor.sh <seat-name> [--workspace <path>]
set -euo pipefail

SEAT=""
TARGET_DIR="$HOME/.zcode/agents"
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) TARGET_DIR="$2/.zcode/agents"; shift 2 ;;
    *) SEAT="$1"; shift ;;
  esac
done

if [ -z "$SEAT" ]; then
  echo "usage: remove-councillor.sh <seat-name> [--workspace <path>]" >&2
  exit 1
fi

FILE="$TARGET_DIR/councillor-${SEAT}.md"
if [ ! -e "$FILE" ]; then
  echo "not found: $FILE" >&2
  exit 1
fi

mv "$FILE" "$FILE.removed.bak"
echo "Removed (backed up): $FILE.removed.bak"
echo "Restart your ZCode session for the change to take effect."
