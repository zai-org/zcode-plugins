#!/usr/bin/env bash
# finalize.sh — split kept autoresearch experiments into clean topic branches.
#
# Usage: bash finalize.sh <projectCwd> <groups.json>
#
# groups.json: { "base": "<trunk branch>", "goal": "<slug>",
#                "groups": [ { "title": "...", "body": "...",
#                              "last_commit": "<full kept hash>", "slug": "..." } ] }
#
# Each group becomes autoresearch/<goal>/NN-<slug>, created from the merge-base
# of the trunk with the kept commits; each branch carries only its own group's
# incremental file set (prev group's last_commit → this group's last_commit);
# group file sets must not overlap; the union of all group branches must equal
# the original branch's changes (minus session files). On any failure —
# including mid-construction errors and branch-name conflicts — everything is
# rolled back (original branch restored, created branches deleted) so a fixed
# invocation can be rerun immediately.
set -euo pipefail

PROJECT="${1:?projectCwd required}"
GJSON="${2:?groups.json required}"

# Normalize groups.json to an absolute path BEFORE cd: relative paths resolve
# against the caller's cwd, not the project dir.
case "$GJSON" in
  /*) ;;
  *) GJSON="$(cd "$(dirname "$GJSON")" && pwd)/$(basename "$GJSON")" ;;
esac

cd "$PROJECT"

# Pass GJSON via argv (never string-interpolated): readFileSync+JSON.parse has
# no require() relative-path rules, no quote injection, no extension dispatch.
jq_or_node() { node -e "$1" "$GJSON"; }
GJSON_READ='const g=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));'

ORIG_BRANCH="$(git branch --show-current)"
if [[ -z "$ORIG_BRANCH" || "$ORIG_BRANCH" == "HEAD" ]]; then
  echo "FATAL: must be on a feature branch (not detached)" >&2; exit 2
fi

BASE="$(jq_or_node "${GJSON_READ}process.stdout.write(g.base||'main')")"
GOAL="$(jq_or_node "${GJSON_READ}process.stdout.write(g.goal||'experiment')")"
MB="$(git merge-base "$BASE" HEAD)"

# Collect per-group incremental file sets; reject overlaps and session files.
# GROUPS_FILES[$i] holds newline-delimited "STATUS<TAB>path" entries (from
# `git diff --name-status -z --no-renames`); the SAME sets are reused when
# constructing branches below, so what is validated is what is built.
declare -a GROUPS_TITLES GROUPS_BODIES GROUPS_COMMITS GROUPS_SLUGS GROUPS_FILES
ALL_FILES_SET=""  # newline-delimited set for overlap checks (bash 3.2 safe)
GROUP_COUNT="$(jq_or_node "${GJSON_READ}process.stdout.write(String(g.groups.length))")"
[[ "$GROUP_COUNT" -gt 0 ]] || { echo "FATAL: no groups" >&2; exit 2; }

PREV="$MB"
i=0
while [[ $i -lt $GROUP_COUNT ]]; do
  LAST="$(jq_or_node "${GJSON_READ}process.stdout.write(g.groups[$i].last_commit)")"
  SLUG="$(jq_or_node "${GJSON_READ}process.stdout.write(g.groups[$i].slug||String($i))")"
  TITLE="$(jq_or_node "${GJSON_READ}process.stdout.write(g.groups[$i].title||'experiment')")"
  BODY="$(jq_or_node "${GJSON_READ}process.stdout.write(g.groups[$i].body||'')")"
  # NUL-separated enumeration: status\0path\0 pairs; safe for spaced filenames.
  ENTRIES=""
  while IFS= read -r -d '' STATUS && IFS= read -r -d '' FP; do
    case "$FP" in
      .auto/* | */.auto/* | autoresearch-dashboard.html | */autoresearch-dashboard.html) continue ;;
    esac
    if printf '%s\n' "$ALL_FILES_SET" | grep -Fxq -- "$FP"; then
      echo "FATAL: file '$FP' appears in multiple groups (merge groups or re-split)" >&2; exit 2
    fi
    ALL_FILES_SET="${ALL_FILES_SET}${FP}"$'\n'
    ENTRIES="${ENTRIES}${STATUS}"$'\t'"${FP}"$'\n'
  done < <(git diff --name-status -z --no-renames "$PREV" "$LAST")
  if [[ -z "$ENTRIES" ]]; then
    echo "FATAL: group $i has no non-session files" >&2; exit 2
  fi
  GROUPS_TITLES[$i]="$TITLE"; GROUPS_BODIES[$i]="$BODY"
  GROUPS_COMMITS[$i]="$LAST"; GROUPS_SLUGS[$i]="$SLUG"
  GROUPS_FILES[$i]="$ENTRIES"
  PREV="$LAST"
  i=$((i+1))
done

# Original branch's full change set (for union verification).
ORIG_CHANGES="$(git diff --name-only "$MB" HEAD | grep -v -E '(^|/)\.auto/|autoresearch-dashboard\.html$' || true)"

CREATED=()
rollback() {
  echo "FAILED — rolling back" >&2
  # Restore the original branch FIRST (-f: staged/worktree state here is
  # mid-construction content already safe in git objects); only then can the
  # created branches be deleted (deleting the checked-out branch would fail).
  git checkout -q -f "$ORIG_BRANCH" 2>/dev/null || true
  for br in "${CREATED[@]:-}"; do git branch -D "$br" >/dev/null 2>&1 || true; done
  exit 1
}
trap rollback ERR

i=0
while [[ $i -lt $GROUP_COUNT ]]; do
  NAME="autoresearch/$GOAL/$(printf '%02d' $((i+1)))-${GROUPS_SLUGS[$i]}"
  if git rev-parse --verify "refs/heads/$NAME" >/dev/null 2>&1; then
    echo "FATAL: branch $NAME already exists" >&2
    rollback
  fi
  git checkout -q --detach "$MB"
  git checkout -q -b "$NAME"
  CREATED+=("$NAME")  # enlist immediately so mid-construction failures roll back too
  while IFS=$'\t' read -r STATUS FP; do
    [[ -n "$STATUS" ]] || continue
    if [[ "$STATUS" == "D" ]]; then
      # Deleted in this group; --ignore-unmatch covers add-then-delete within
      # the same group (file absent from the merge-base tree).
      git rm -q --ignore-unmatch -- "$FP" </dev/null
    else
      git checkout -q "${GROUPS_COMMITS[$i]}" -- "$FP" </dev/null
    fi
  done <<< "${GROUPS_FILES[$i]}"
  if ! git diff --cached --quiet; then
    if [[ -n "${GROUPS_BODIES[$i]}" ]]; then
      git commit -q -m "${GROUPS_TITLES[$i]}" -m "${GROUPS_BODIES[$i]}"
    else
      git commit -q -m "${GROUPS_TITLES[$i]}"
    fi
  fi
  i=$((i+1))
done

# Verify: union of group branches == original branch's changes (minus session files).
UNION=""
for br in "${CREATED[@]:-}"; do
  U="$(git diff --name-only "$MB" "$br" | grep -v -E '(^|/)\.auto/|autoresearch-dashboard\.html$' || true)"
  UNION="$UNION"$'\n'"$U"
done
UNION="$(printf '%s' "$UNION" | sed '/^$/d' | sort -u)"
ORIG_SORTED="$(printf '%s' "$ORIG_CHANGES" | sed '/^$/d' | sort -u)"
if [[ "$UNION" != "$ORIG_SORTED" ]]; then
  echo "VERIFY FAILED: union of branches != original changes" >&2
  diff <(printf '%s' "$UNION") <(printf '%s' "$ORIG_SORTED") >&2 || true
  rollback
fi

trap - ERR
git checkout -q "$ORIG_BRANCH"
echo "OK — created ${#CREATED[@]} branch(es):"
for br in "${CREATED[@]:-}"; do echo "  $br"; done
