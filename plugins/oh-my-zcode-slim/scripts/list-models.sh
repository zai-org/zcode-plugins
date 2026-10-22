#!/usr/bin/env bash
# List model refs you can pin in agent frontmatter, from ZCode's own usage
# records — these are refs that have ACTUALLY executed on this machine, which
# is the only reliable source (provider display names and model self-reports
# are not; see docs/LESSONS.md).
set -euo pipefail

DB="$HOME/.zcode/cli/db/db.sqlite"

echo "== Builtin refs (available to z.ai-authenticated sessions) =="
printf '  custom:builtin%%3Azai-coding-plan:GLM-5.3\n'
printf '  custom:builtin%%3Azai-coding-plan:GLM-5.3-Flash\n'
echo

if [ -f "$DB" ] && command -v sqlite3 >/dev/null 2>&1; then
  echo "== Provider/model pairs proven on this machine (model_usage) =="
  sqlite3 "$DB" "SELECT DISTINCT provider_id, model_id FROM model_usage WHERE status='completed' ORDER BY provider_id, model_id" \
    | while IFS='|' read -r provider model; do
        provider="${provider//:/%3A}"
        printf '  custom:%s:%s\n' "$provider" "$model"
      done
  echo
  echo "Notes:"
  echo "  - Pin format is custom:<provider_id>:<model_id>, exactly as printed."
  echo "  - In remote-attached sessions, custom providers materialize under UUID"
  echo "    provider ids, not their display names — use the UUID form printed above."
else
  echo "(!) sqlite3 or $DB not found — only builtin refs can be listed."
fi
