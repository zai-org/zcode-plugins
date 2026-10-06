#!/bin/sh
set -eu

ORCHESTRATION_ACTION=${1:-install}
ORCHESTRATION_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
ORCHESTRATION_ROOT=$(CDPATH= cd -- "$ORCHESTRATION_SCRIPT_DIR/.." && pwd -P)
ORCHESTRATION_USER_HOME=${ORCHESTRATION_HOME:-${HOME:?HOME is not set}}
ORCHESTRATION_STATE_DIR="$ORCHESTRATION_USER_HOME/.config/iaa"
ORCHESTRATION_DEPTH_STATE="$ORCHESTRATION_STATE_DIR/claude-depth.state"

MANAGED_BEGIN='<!-- BEGIN managed: iaa -->'
MANAGED_END='<!-- END managed: iaa -->'

# LEGACY: pre-rename identity (multi-agent-orchestration), recognized only so old
# installs can be migrated/cleaned. New installs never create these.
LEGACY_MANAGED_BEGIN='<!-- BEGIN managed: multi-agent-orchestration -->'
LEGACY_MANAGED_END='<!-- END managed: multi-agent-orchestration -->'
LEGACY_STATE_DIR="$ORCHESTRATION_USER_HOME/.config/ai-agent-orchestration"
LEGACY_SKILL_NAME='multi-agent-orchestration'

orchestration_backup_name() {
  orchestration_source=$1
  orchestration_stamp=$(date +%Y%m%dT%H%M%S%z)
  orchestration_candidate="$orchestration_source.iaa-backup-$orchestration_stamp"
  orchestration_index=1
  while [ -e "$orchestration_candidate" ] || [ -L "$orchestration_candidate" ]; do
    orchestration_candidate="$orchestration_source.iaa-backup-$orchestration_stamp-$orchestration_index"
    orchestration_index=$((orchestration_index + 1))
  done
  printf '%s\n' "$orchestration_candidate"
}

orchestration_backup_copy() {
  orchestration_source=$1
  if [ -e "$orchestration_source" ] || [ -L "$orchestration_source" ]; then
    orchestration_backup=$(orchestration_backup_name "$orchestration_source")
    cp -a -- "$orchestration_source" "$orchestration_backup"
    printf 'backup: %s\n' "$orchestration_backup"
  fi
}

orchestration_validate_markers() {
  orchestration_file=$1
  [ -f "$orchestration_file" ] || return 0
  orchestration_begin_count=$(grep -Fxc "$MANAGED_BEGIN" "$orchestration_file" || true)
  orchestration_end_count=$(grep -Fxc "$MANAGED_END" "$orchestration_file" || true)
  if [ "$orchestration_begin_count" -gt 1 ] || [ "$orchestration_end_count" -gt 1 ] || [ "$orchestration_begin_count" -ne "$orchestration_end_count" ]; then
    printf 'refusing malformed managed markers in %s\n' "$orchestration_file" >&2
    return 1
  fi
  if [ "$orchestration_begin_count" -eq 1 ]; then
    orchestration_begin_line=$(grep -nF "$MANAGED_BEGIN" "$orchestration_file" | cut -d: -f1)
    orchestration_end_line=$(grep -nF "$MANAGED_END" "$orchestration_file" | cut -d: -f1)
    if [ "$orchestration_end_line" -le "$orchestration_begin_line" ]; then
      printf 'refusing reversed managed markers in %s\n' "$orchestration_file" >&2
      return 1
    fi
  fi
}

orchestration_without_managed_block() {
  orchestration_file=$1
  awk -v begin="$MANAGED_BEGIN" -v end="$MANAGED_END" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  ' "$orchestration_file" | awk '
    /^[[:space:]]*$/ { blanks++; next }
    {
      while (blanks > 0) { print ""; blanks-- }
      print
    }
  '
}

orchestration_write_shim() {
  orchestration_file=$1
  mkdir -p -- "$(dirname -- "$orchestration_file")"
  orchestration_file_existed=0
  if [ -e "$orchestration_file" ]; then
    orchestration_file_existed=1
  else
    : > "$orchestration_file"
  fi
  orchestration_validate_markers "$orchestration_file"
  orchestration_temp=$(mktemp "$orchestration_file.orchestration.XXXXXX")
  orchestration_without_managed_block "$orchestration_file" > "$orchestration_temp"
  if [ -s "$orchestration_temp" ]; then
    printf '\n\n' >> "$orchestration_temp"
  fi
  printf '%s\n' \
    "$MANAGED_BEGIN" \
    '## İAA orchestration' \
    '' \
    'For non-trivial tasks, evaluate whether delegation offers concrete parallelism, bounded-context isolation, specialization, context offloading, or independent verification. When the user requests subagents, delegation, or parallel agents—or delegation is materially useful—load and follow the installed `iaa` skill before spawning.' \
    '' \
    'Interpret "use subagents" as permission for only beneficial, bounded delegation, not a requirement to maximize agent count. The primary agent owns decomposition, disjoint write ownership, shared contracts, integration, and final validation. This skill is the sole orchestration authority in its mode: do not combine it with other orchestration workflow skills such as superpowers:subagent-driven-development; a native workflow like that one applies only when the user explicitly requests it by name.' \
    "$MANAGED_END" >> "$orchestration_temp"
  if cmp -s "$orchestration_file" "$orchestration_temp"; then
    rm -f -- "$orchestration_temp"
    printf 'unchanged: %s\n' "$orchestration_file"
    return 0
  fi
  if [ "$orchestration_file_existed" -eq 1 ]; then
    orchestration_backup_copy "$orchestration_file"
  fi
  chmod --reference="$orchestration_file" "$orchestration_temp" 2>/dev/null || chmod 0644 "$orchestration_temp"
  mv -f -- "$orchestration_temp" "$orchestration_file"
  printf 'updated: %s\n' "$orchestration_file"
}

orchestration_remove_shim() {
  orchestration_file=$1
  [ -f "$orchestration_file" ] || return 0
  orchestration_validate_markers "$orchestration_file"
  if ! grep -Fqx "$MANAGED_BEGIN" "$orchestration_file"; then
    return 0
  fi
  orchestration_temp=$(mktemp "$orchestration_file.orchestration.XXXXXX")
  orchestration_without_managed_block "$orchestration_file" > "$orchestration_temp"
  orchestration_backup_copy "$orchestration_file"
  chmod --reference="$orchestration_file" "$orchestration_temp" 2>/dev/null || chmod 0644 "$orchestration_temp"
  mv -f -- "$orchestration_temp" "$orchestration_file"
  printf 'removed managed shim: %s\n' "$orchestration_file"
}

orchestration_ensure_link() {
  orchestration_destination=$1
  mkdir -p -- "$(dirname -- "$orchestration_destination")"
  orchestration_resolved=$(readlink -f -- "$orchestration_destination" 2>/dev/null || true)
  if [ "$orchestration_resolved" = "$ORCHESTRATION_ROOT" ]; then
    printf 'unchanged: %s -> %s\n' "$orchestration_destination" "$ORCHESTRATION_ROOT"
    return 0
  fi
  if [ -e "$orchestration_destination" ] || [ -L "$orchestration_destination" ]; then
    orchestration_backup=$(orchestration_backup_name "$orchestration_destination")
    mv -- "$orchestration_destination" "$orchestration_backup"
    printf 'backup: %s\n' "$orchestration_backup"
  fi
  if realpath --relative-to="$(dirname -- "$orchestration_destination")" "$ORCHESTRATION_ROOT" >/dev/null 2>&1; then
    orchestration_target=$(realpath --relative-to="$(dirname -- "$orchestration_destination")" "$ORCHESTRATION_ROOT")
  else
    orchestration_target=$ORCHESTRATION_ROOT
  fi
  ln -s -- "$orchestration_target" "$orchestration_destination"
  printf 'linked: %s -> %s\n' "$orchestration_destination" "$orchestration_target"
}

orchestration_remove_link() {
  orchestration_destination=$1
  [ -L "$orchestration_destination" ] || return 0
  orchestration_resolved=$(readlink -f -- "$orchestration_destination" 2>/dev/null || true)
  if [ "$orchestration_resolved" = "$ORCHESTRATION_ROOT" ]; then
    unlink -- "$orchestration_destination"
    printf 'unlinked: %s\n' "$orchestration_destination"
  else
    printf 'preserved unrelated symlink: %s\n' "$orchestration_destination"
  fi
}

orchestration_without_legacy_block() {
  orchestration_file=$1
  awk -v begin="$LEGACY_MANAGED_BEGIN" -v end="$LEGACY_MANAGED_END" '
    $0 == begin { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  ' "$orchestration_file" | awk '
    /^[[:space:]]*$/ { blanks++; next }
    {
      while (blanks > 0) { print ""; blanks-- }
      print
    }
  '
}

orchestration_remove_legacy_shim() {
  # LEGACY: strip a pre-rename managed block so the current marker set can replace it.
  orchestration_file=$1
  [ -f "$orchestration_file" ] || return 0
  if ! grep -Fqx "$LEGACY_MANAGED_BEGIN" "$orchestration_file"; then
    return 0
  fi
  orchestration_temp=$(mktemp "$orchestration_file.orchestration.XXXXXX")
  orchestration_without_legacy_block "$orchestration_file" > "$orchestration_temp"
  orchestration_backup_copy "$orchestration_file"
  chmod --reference="$orchestration_file" "$orchestration_temp" 2>/dev/null || chmod 0644 "$orchestration_temp"
  mv -f -- "$orchestration_temp" "$orchestration_file"
  printf 'removed legacy managed shim (pre-rename) from: %s\n' "$orchestration_file"
}

orchestration_remove_legacy_links() {
  # LEGACY: unlink pre-rename skill-link names when they point at this source (by
  # resolution OR by literal legacy target — the target dangles once the source has
  # moved to its renamed location), so only one active copy can trigger.
  for orchestration_destination in \
    "$ORCHESTRATION_USER_HOME/.agents/skills/$LEGACY_SKILL_NAME" \
    "$ORCHESTRATION_USER_HOME/.claude/skills/$LEGACY_SKILL_NAME" \
    "$ORCHESTRATION_USER_HOME/.zcode/skills/$LEGACY_SKILL_NAME"
  do
    [ -L "$orchestration_destination" ] || continue
    orchestration_literal_target=$(readlink -- "$orchestration_destination")
    orchestration_resolved=$(readlink -f -- "$orchestration_destination" 2>/dev/null || true)
    if [ "$orchestration_resolved" = "$ORCHESTRATION_ROOT" ] || \
       [ "${orchestration_literal_target#*ai-agent-orchestration/}" != "$orchestration_literal_target" ]; then
      unlink -- "$orchestration_destination"
      printf 'unlinked legacy skill link (pre-rename): %s\n' "$orchestration_destination"
    else
      printf 'preserved unrelated symlink: %s\n' "$orchestration_destination"
    fi
  done
}

orchestration_migrate_legacy_state() {
  # LEGACY: adopt the pre-rename state dir so uninstall semantics survive upgrades.
  [ -d "$LEGACY_STATE_DIR" ] || return 0
  if [ -e "$ORCHESTRATION_DEPTH_STATE" ]; then
    printf 'legacy state present; current state already exists: %s\n' "$ORCHESTRATION_DEPTH_STATE"
    return 0
  fi
  mkdir -p -- "$ORCHESTRATION_STATE_DIR"
  if [ -f "$LEGACY_STATE_DIR/claude-depth.state" ]; then
    mv -- "$LEGACY_STATE_DIR/claude-depth.state" "$ORCHESTRATION_DEPTH_STATE"
    printf 'migrated legacy state (pre-rename): %s\n' "$ORCHESTRATION_DEPTH_STATE"
  fi
  rmdir -- "$LEGACY_STATE_DIR" 2>/dev/null || \
    printf 'legacy state dir not empty; retained: %s\n' "$LEGACY_STATE_DIR"
}

orchestration_set_claude_depth() {
  orchestration_settings="$ORCHESTRATION_USER_HOME/.claude/settings.json"
  mkdir -p -- "$ORCHESTRATION_USER_HOME/.claude" "$ORCHESTRATION_STATE_DIR"
  command -v jq >/dev/null 2>&1 || { printf 'jq is required to preserve Claude settings safely\n' >&2; return 1; }
  orchestration_settings_existed=1
  if [ ! -f "$orchestration_settings" ]; then
    orchestration_settings_existed=0
    printf '%s\n' '{}' > "$orchestration_settings"
  fi
  jq empty "$orchestration_settings"
  if [ ! -f "$ORCHESTRATION_DEPTH_STATE" ]; then
    orchestration_existing=$(jq -r 'if (.env // {}) | has("CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH") then .env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH else "__ABSENT__" end' "$orchestration_settings")
    if [ "$orchestration_existing" = '__ABSENT__' ]; then
      printf '%s\n' 'managed-absent' > "$ORCHESTRATION_DEPTH_STATE"
    else
      printf '%s\n' 'preserve-existing' > "$ORCHESTRATION_DEPTH_STATE"
      printf 'preserved existing Claude spawn-depth value: %s\n' "$orchestration_existing"
      return 0
    fi
  fi
  orchestration_depth_state=$(sed -n '1p' "$ORCHESTRATION_DEPTH_STATE")
  [ "$orchestration_depth_state" = 'managed-absent' ] || return 0
  orchestration_current=$(jq -r '.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH // ""' "$orchestration_settings")
  if [ "$orchestration_current" = '1' ]; then
    printf 'unchanged: Claude subagent spawn depth = 1\n'
    return 0
  fi
  orchestration_temp=$(mktemp "$orchestration_settings.orchestration.XXXXXX")
  jq '.env = (.env // {}) | .env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH = "1"' "$orchestration_settings" > "$orchestration_temp"
  if [ "$orchestration_settings_existed" -eq 1 ]; then
    orchestration_backup_copy "$orchestration_settings"
  fi
  chmod --reference="$orchestration_settings" "$orchestration_temp" 2>/dev/null || chmod 0600 "$orchestration_temp"
  mv -f -- "$orchestration_temp" "$orchestration_settings"
  printf 'updated: Claude subagent spawn depth = 1\n'
}

orchestration_restore_claude_depth() {
  orchestration_settings="$ORCHESTRATION_USER_HOME/.claude/settings.json"
  [ -f "$ORCHESTRATION_DEPTH_STATE" ] || return 0
  command -v jq >/dev/null 2>&1 || { printf 'jq is required to restore Claude settings safely\n' >&2; return 1; }
  if [ -f "$orchestration_settings" ]; then
    jq empty "$orchestration_settings"
  fi
  orchestration_depth_state=$(sed -n '1p' "$ORCHESTRATION_DEPTH_STATE")
  if [ "$orchestration_depth_state" = 'managed-absent' ] && [ -f "$orchestration_settings" ]; then
    orchestration_current=$(jq -r '.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH // ""' "$orchestration_settings")
    if [ "$orchestration_current" = '1' ]; then
      orchestration_temp=$(mktemp "$orchestration_settings.orchestration.XXXXXX")
      jq 'del(.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH) | if .env == {} then del(.env) else . end' "$orchestration_settings" > "$orchestration_temp"
      orchestration_backup_copy "$orchestration_settings"
      chmod --reference="$orchestration_settings" "$orchestration_temp" 2>/dev/null || chmod 0600 "$orchestration_temp"
      mv -f -- "$orchestration_temp" "$orchestration_settings"
      printf 'restored: removed managed Claude spawn-depth value\n'
    else
      printf 'preserved user-changed Claude spawn-depth value: %s\n' "$orchestration_current"
    fi
  fi
  rm -f -- "$ORCHESTRATION_DEPTH_STATE"
}

orchestration_verify() {
  orchestration_fail=0
  if [ ! -f "$ORCHESTRATION_ROOT/SKILL.md" ]; then
    printf 'missing: %s/SKILL.md\n' "$ORCHESTRATION_ROOT" >&2
    orchestration_fail=1
  fi
  for orchestration_destination in \
    "$ORCHESTRATION_USER_HOME/.agents/skills/iaa" \
    "$ORCHESTRATION_USER_HOME/.claude/skills/iaa" \
    "$ORCHESTRATION_USER_HOME/.zcode/skills/iaa"
  do
    orchestration_resolved=$(readlink -f -- "$orchestration_destination" 2>/dev/null || true)
    if [ "$orchestration_resolved" = "$ORCHESTRATION_ROOT" ]; then
      printf 'ok link: %s\n' "$orchestration_destination"
    else
      printf 'bad link: %s -> %s\n' "$orchestration_destination" "$orchestration_resolved" >&2
      orchestration_fail=1
    fi
  done
  for orchestration_file in \
    "$ORCHESTRATION_USER_HOME/.codex/AGENTS.md" \
    "$ORCHESTRATION_USER_HOME/.claude/CLAUDE.md" \
    "$ORCHESTRATION_USER_HOME/.zcode/AGENTS.md"
  do
    if ! orchestration_validate_markers "$orchestration_file"; then
      orchestration_fail=1
      continue
    fi
    orchestration_begin_count=$(grep -Fxc "$MANAGED_BEGIN" "$orchestration_file" 2>/dev/null || true)
    orchestration_end_count=$(grep -Fxc "$MANAGED_END" "$orchestration_file" 2>/dev/null || true)
    if [ "$orchestration_begin_count" -eq 1 ] && [ "$orchestration_end_count" -eq 1 ]; then
      printf 'ok shim: %s\n' "$orchestration_file"
    else
      printf 'bad shim: %s\n' "$orchestration_file" >&2
      orchestration_fail=1
    fi
  done
  orchestration_settings="$ORCHESTRATION_USER_HOME/.claude/settings.json"
  orchestration_depth=$(jq -r '.env.CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH // ""' "$orchestration_settings" 2>/dev/null || true)
  if [ "$orchestration_depth" = '1' ]; then
    printf 'ok Claude spawn depth: 1\n'
  else
    printf 'Claude spawn depth is not managed at 1: %s\n' "$orchestration_depth" >&2
    orchestration_fail=1
  fi
  orchestration_description_bytes=$(awk 'BEGIN {front=0} /^---$/ {front++; next} front==1 && /^description:/ {sub(/^description:[[:space:]]*/, ""); print length($0); exit}' "$ORCHESTRATION_ROOT/SKILL.md")
  if [ -n "$orchestration_description_bytes" ] && [ "$orchestration_description_bytes" -le 1024 ]; then
    printf 'ok skill description length: %s\n' "$orchestration_description_bytes"
  else
    printf 'bad skill description length\n' >&2
    orchestration_fail=1
  fi
  [ "$orchestration_fail" -eq 0 ]
}

orchestration_install() {
  orchestration_migrate_legacy_state
  orchestration_ensure_link "$ORCHESTRATION_USER_HOME/.agents/skills/iaa"
  orchestration_ensure_link "$ORCHESTRATION_USER_HOME/.claude/skills/iaa"
  orchestration_ensure_link "$ORCHESTRATION_USER_HOME/.zcode/skills/iaa"
  orchestration_remove_legacy_links
  orchestration_remove_legacy_shim "$ORCHESTRATION_USER_HOME/.codex/AGENTS.md"
  orchestration_remove_legacy_shim "$ORCHESTRATION_USER_HOME/.claude/CLAUDE.md"
  orchestration_remove_legacy_shim "$ORCHESTRATION_USER_HOME/.zcode/AGENTS.md"
  orchestration_write_shim "$ORCHESTRATION_USER_HOME/.codex/AGENTS.md"
  orchestration_write_shim "$ORCHESTRATION_USER_HOME/.claude/CLAUDE.md"
  orchestration_write_shim "$ORCHESTRATION_USER_HOME/.zcode/AGENTS.md"
  orchestration_set_claude_depth
  orchestration_verify
}

orchestration_uninstall() {
  for orchestration_file in \
    "$ORCHESTRATION_USER_HOME/.codex/AGENTS.md" \
    "$ORCHESTRATION_USER_HOME/.claude/CLAUDE.md" \
    "$ORCHESTRATION_USER_HOME/.zcode/AGENTS.md"
  do
    orchestration_validate_markers "$orchestration_file"
  done
  if [ -f "$ORCHESTRATION_DEPTH_STATE" ]; then
    command -v jq >/dev/null 2>&1 || { printf 'jq is required to restore Claude settings safely\n' >&2; return 1; }
    orchestration_settings="$ORCHESTRATION_USER_HOME/.claude/settings.json"
    if [ -f "$orchestration_settings" ]; then
      jq empty "$orchestration_settings"
    fi
  fi
  orchestration_restore_claude_depth
  orchestration_remove_shim "$ORCHESTRATION_USER_HOME/.codex/AGENTS.md"
  orchestration_remove_shim "$ORCHESTRATION_USER_HOME/.claude/CLAUDE.md"
  orchestration_remove_shim "$ORCHESTRATION_USER_HOME/.zcode/AGENTS.md"
  orchestration_remove_legacy_shim "$ORCHESTRATION_USER_HOME/.codex/AGENTS.md"
  orchestration_remove_legacy_shim "$ORCHESTRATION_USER_HOME/.claude/CLAUDE.md"
  orchestration_remove_legacy_shim "$ORCHESTRATION_USER_HOME/.zcode/AGENTS.md"
  orchestration_remove_link "$ORCHESTRATION_USER_HOME/.agents/skills/iaa"
  orchestration_remove_link "$ORCHESTRATION_USER_HOME/.claude/skills/iaa"
  orchestration_remove_link "$ORCHESTRATION_USER_HOME/.zcode/skills/iaa"
  orchestration_remove_legacy_links
  printf 'source retained: %s\n' "$ORCHESTRATION_ROOT"
}

case "$ORCHESTRATION_ACTION" in
  install) orchestration_install ;;
  verify) orchestration_verify ;;
  uninstall) orchestration_uninstall ;;
  *) printf 'usage: %s [install|verify|uninstall]\n' "$0" >&2; exit 2 ;;
esac
