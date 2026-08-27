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
# of the trunk with the kept commits; group file sets must not overlap; the
# union of all group branches must equal the original branch's changes (minus
# session files). On any failure everything is rolled back.
set -euo pipefail

PROJECT="${1:?projectCwd required}"
GJSON="${2:?groups.json required}"
cd "$PROJECT"

jq_or_node() { node -e "$1"; }

ORIG_BRANCH="$(git branch --show-current)"
if [[ -z "$ORIG_BRANCH" || "$ORIG_BRANCH" == "HEAD" ]]; then
  echo "FATAL: must be on a feature branch (not detached)" >&2; exit 2
fi

BASE="$(jq_or_node "const g=require('$GJSON');process.stdout.write(g.base||'main')")"
GOAL="$(jq_or_node "const g=require('$GJSON');process.stdout.write(g.goal||'experiment')")"
MB="$(git merge-base "$BASE" HEAD)"

# Collect per-group file sets; reject overlaps and session files.
declare -a GROUPS_TITLES GROUPS_COMMITS GROUPS_SLUGS
declare -a ALL_FILES=()
ALL_FILES_SET=" "  # space-delimited set for overlap checks (bash 3.2 safe)
GROUP_COUNT="$(jq_or_node "const g=require('$GJSON');process.stdout.write(String(g.groups.length))")"
[[ "$GROUP_COUNT" -gt 0 ]] || { echo "FATAL: no groups" >&2; exit 2; }

PREV="$MB"
i=0
while [[ $i -lt $GROUP_COUNT ]]; do
  LAST="$(jq_or_node "const g=require('$GJSON');process.stdout.write(g.groups[$i].last_commit)")"
  SLUG="$(jq_or_node "const g=require('$GJSON');process.stdout.write(g.groups[$i].slug||String($i))")"
  TITLE="$(jq_or_node "const g=require('$GJSON');process.stdout.write(g.groups[$i].title||'experiment')")"
  BODY="$(jq_or_node "const g=require('$GJSON');process.stdout.write(g.groups[$i].body||'')")"
  FILES="$(git diff --name-only "$PREV" "$LAST" | grep -v -E '(^|/)\.auto/|autoresearch-dashboard\.html$' || true)"
  if [[ -z "$FILES" ]]; then
    echo "FATAL: group $i has no non-session files" >&2; exit 2
  fi
  for f in $FILES; do
    if [[ "$ALL_FILES_SET" == *" $f "* ]]; then
      echo "FATAL: file '$f' appears in multiple groups (merge groups or re-split)" >&2; exit 2
    fi
    ALL_FILES+=("$f")
    ALL_FILES_SET="$ALL_FILES_SET$f "
  done
  GROUPS_TITLES[$i]="$TITLE"; GROUPS_BODIES[$i]="$BODY"; GROUPS_COMMITS[$i]="$LAST"; GROUPS_SLUGS[$i]="$SLUG"
  PREV="$LAST"
  i=$((i+1))
done

# Original branch's full change set (for union verification).
ORIG_CHANGES="$(git diff --name-only "$MB" HEAD | grep -v -E '(^|/)\.auto/|autoresearch-dashboard\.html$' || true)"

CREATED=()
rollback() {
  echo "FAILED — rolling back" >&2
  for br in "${CREATED[@]:-}"; do git branch -D "$br" >/dev/null 2>&1 || true; done
  git checkout -q "$ORIG_BRANCH" 2>/dev/null || true
  exit 1
}
trap rollback ERR

i=0
while [[ $i -lt $GROUP_COUNT ]]; do
  NAME="autoresearch/$GOAL/$(printf '%02d' $((i+1)))-${GROUPS_SLUGS[$i]}"
  if git rev-parse --verify "refs/heads/$NAME" >/dev/null 2>&1; then
    echo "FATAL: branch $NAME already exists" >&2; exit 2
  fi
  FILES="$(git diff --name-only "$MB" "${GROUPS_COMMITS[$i]}" | grep -v -E '(^|/)\.auto/|autoresearch-dashboard\.html$' || true)"
  git checkout -q --detach "$MB"
  git checkout -q -b "$NAME"
  for f in $FILES; do git checkout -q "${GROUPS_COMMITS[$i]}" -- "$f"; done
  if ! git diff --cached --quiet; then
    if [[ -n "${GROUPS_BODIES[$i]}" ]]; then
      git commit -q -m "${GROUPS_TITLES[$i]}" -m "${GROUPS_BODIES[$i]}"
    else
      git commit -q -m "${GROUPS_TITLES[$i]}"
    fi
  fi
  CREATED+=("$NAME")
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
  exit 1
fi

trap - ERR
git checkout -q "$ORIG_BRANCH"
echo "OK — created ${#CREATED[@]} branch(es):"
for br in "${CREATED[@]:-}"; do echo "  $br"; done
