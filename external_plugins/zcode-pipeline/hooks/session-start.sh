#!/bin/sh
# zcode-pipeline SessionStart hook: remind about unfinished conveyor work.
# No side effects; output goes to the session context only.
states=""
[ -f ".ai/state.md" ] && states=".ai/state.md"
if [ -d ".ai/state" ]; then
  for f in .ai/state/*.md; do
    [ -f "$f" ] && states="$states
$f"
  done
fi
[ -f ".ai/state/QUEUE.md" ] && states="$states
.ai/state/QUEUE.md"
if [ -n "$states" ]; then
  echo "[zcode-pipeline] Незавершённая работа конвейера (state/очередь):"
  echo "$states"
  echo "$states" | while IFS= read -r f; do
    [ -f "$f" ] && echo "--- $f" && sed -n '1,10p' "$f"
  done
  echo "[zcode-pipeline] Уточни у пользователя, продолжать ли работу по скиллу pipeline; сводка — /pipeline-status."
  exit 0
fi
if [ -d ".ai/tasks" ]; then
  hits=$(grep -l -E '^\*\*Статус:\*\* (created|in_progress|implemented|reviewed|tested)' .ai/tasks/*/*.md 2>/dev/null | head -n 3)
  if [ -n "$hits" ]; then
    echo "[zcode-pipeline] Незакрытые задачи конвейера:"
    echo "$hits"
    echo "[zcode-pipeline] Уточни у пользователя, продолжать ли работу по скиллу pipeline."
  fi
fi
exit 0
