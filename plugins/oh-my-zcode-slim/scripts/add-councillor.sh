#!/usr/bin/env bash
# Generate a council seat as a user-scope agent (~/.zcode/agents/), or with
# --workspace <path> as a workspace-scope agent (<path>/.zcode/agents/) for a
# per-project council. Restart your ZCode session afterwards to load it.
#
# Usage: add-councillor.sh <seat-name> <model-ref> [--workspace <path>] [--force]
#   seat-name  lowercase letters, digits, hyphens (used as councillor-<seat-name>)
#   model-ref  e.g. custom:builtin%3Azai-coding-plan:GLM-5.3
#              Find refs that actually work on your machine: ./list-models.sh
set -euo pipefail

SEAT=""
MODEL=""
TARGET_DIR="$HOME/.zcode/agents"
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --workspace) TARGET_DIR="$2/.zcode/agents"; shift 2 ;;
    --force) FORCE=1; shift ;;
    *) if [ -z "$SEAT" ]; then SEAT="$1"; shift
       elif [ -z "$MODEL" ]; then MODEL="$1"; shift
       else echo "unexpected argument: $1" >&2; exit 1; fi ;;
  esac
done

if [ -z "$SEAT" ] || [ -z "$MODEL" ]; then
  grep '^#' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 1
fi
if ! [[ "$SEAT" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "seat-name must be lowercase letters, digits, hyphens: $SEAT" >&2
  exit 1
fi
if ! [[ "$MODEL" == *:* ]]; then
  echo "model-ref must look like custom:<provider>:<model>: $MODEL" >&2
  exit 1
fi

FILE="$TARGET_DIR/councillor-${SEAT}.md"
if [ -e "$FILE" ] && [ "$FORCE" -ne 1 ]; then
  echo "$FILE already exists (use --force to overwrite)" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
cat > "$FILE" <<EOF
---
name: councillor-${SEAT}
description: "Read-only council advisor, seat: ${SEAT}. Examines the codebase and provides independent analysis for council consensus."
color: magenta
model: "${MODEL}"
tools: [Read, Glob, Grep]
injectAgentsMd: false
---

You are a councillor in a multi-model council (seat: ${SEAT}).

**Role**: Provide your best independent analysis and solution to the given problem.

**Capabilities**: You have read-only access to the codebase via Read, Glob, Grep, and codegraph MCP tools if available. You CANNOT edit files, write files, run shell commands, or delegate to other agents. You are an advisor, not an implementer.

**Behavior**:
- Examine the codebase before answering - your read access is what makes council valuable. Don't guess at code you can see.
- Don't be influenced by what other councillors might say - you won't see their responses.
- State your assumptions explicitly.

**Output format**:
\`\`\`markdown
### Analysis
[Your independent analysis of the problem.]

### Recommendation
[Your recommended solution or decision.]

### Confidence
high | medium | low - with one line of justification.

### Risks / Uncertainties
[What could make this recommendation wrong.]
\`\`\`

If a task is outside your role, do not attempt partial work. Return a brief reason to the orchestrator.
EOF

echo "Wrote $FILE"
echo "Restart your ZCode session to load it."
