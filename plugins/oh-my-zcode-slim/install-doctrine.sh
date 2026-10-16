#!/usr/bin/env bash
# Installs the orchestrator doctrine to ~/.zcode/AGENTS.md.
# Plugins cannot contribute AGENTS.md files, so this one file is installed
# outside the plugin system. Run after enabling the oh-my-zcode-slim plugin.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/doctrine/AGENTS.md"
DST="$HOME/.zcode/AGENTS.md"

mkdir -p "$HOME/.zcode"

if [ -f "$DST" ] && ! cmp -s "$SRC" "$DST"; then
  cp "$DST" "$DST.bak"
  echo "Backed up existing doctrine to $DST.bak"
fi

cp "$SRC" "$DST"
echo "Installed doctrine to $DST"
echo "Restart your ZCode session for it to take effect."
