#!/usr/bin/env bash
# OHI static scorecard — deterministic config/doc checks. Zero tokens, instant.
# Usage: bash tests/ohi-static.sh   (exit 0 iff all checks pass)
cd "$(dirname "$0")/.." || exit 1
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }

# --- C1: agent frontmatter (model, effort) pairs match the verified matrix ---
check_agent() { # <name> <model> <effort>
  local f="agents/$1.md" m e
  m=$(grep '^model:' "$f" | awk '{print $2}')
  e=$(grep '^thoughtLevel:' "$f" | awk '{print $2}')
  if [ "$m" = "$2" ] && [ "$e" = "$3" ]; then ok "C1 $1 = $2 @ $3"; else bad "C1 $1 got $m @ $e, want $2 @ $3"; fi
}
check_agent glm-vision glm-5.3-flash max
check_agent glm-turbo  glm-5.3-flash low
check_agent glm-main   glm-5.3       max

# --- C2: SKILL.md engine table parity with agent files ---
S=skills/glm-orchestrator/SKILL.md
grep -q 'GLM-5.3-Flash | max' "$S" && ok "C2 vision table row" || bad "C2 vision table row"
grep -q 'GLM-5.3-Flash | low'     "$S" && ok "C2 turbo table row"  || bad "C2 turbo table row"
grep -q 'GLM-5.3 | max'          "$S" && ok "C2 main table row"   || bad "C2 main table row"

# --- C3: no stale routing references ---
grep -q 'model: glm-5v-turbo' agents/*.md 2>/dev/null && bad "C3 stale vision model: line" || ok "C3 no stale model: ref"
grep -q 'thoughtLevel: medium' agents/*.md 2>/dev/null && bad "C3 rejected medium effort pinned" || ok "C3 no rejected effort pin"
grep -q 'verified PASS this session' "$S" && echo '{}' | bash hooks/inject-routing.sh | grep -q 'verified PASS this session' \
  && ok "C6 no routing to unverified engine (conditional lane in skill+hook)" || bad "C6 routing hard-depends on unverified lane"

# --- C7: capability ground truth — every engine in exactly one explicit state (no zombie lanes) ---
python3 - <<'PYEOF' && ok "C7 capability ledger: states valid, coverage complete, VERIFIED fresh" || bad "C7 capability ledger invalid/stale/zombie"
import json, sys, datetime, glob, os
led = json.load(open('tests/capability-ledger.json'))
engines = led['engines']
agent_files = {os.path.basename(f)[:-3] for f in glob.glob('agents/*.md')}
ledger_names = set(engines)
today = datetime.date.today()
for name, e in engines.items():
    st = e.get('state')
    if st not in ('VERIFIED','CONDITIONAL','REMOVED'):
        sys.exit(f'bad state {st} for {name}')
    if st == 'VERIFIED':
        ls = datetime.date.fromisoformat(e['last_success'])
        if (today - ls).days > 7:
            sys.exit(f'{name} VERIFIED but last success {ls} is stale')
        if e['lifetime']['success'] < 1:
            sys.exit(f'{name} VERIFIED with zero lifetime successes')
    if st == 'CONDITIONAL' and e['lifetime']['success'] >= 1 and e.get('routing') != 'excluded-until-verified':
        sys.exit(f'{name} CONDITIONAL but has successes and is not routing-excluded')
    if st == 'REMOVED' and name in agent_files:
        sys.exit(f'{name} REMOVED but agent file still exists')
for f in agent_files:
    if f not in ledger_names:
        sys.exit(f'agent {f} missing from capability ledger')
hr = led.get('hooks_runtime', {})
if hr.get('state') not in ('VERIFIED','UNVERIFIED'):
    sys.exit('hooks_runtime bad state')
PYEOF

# --- C8: perception anti-monoculture — two distinct mockups with ground truth ---
[ -f orchestrator-test/dashboard-mockup.png ] && [ -f orchestrator-test/mockup2.png ] && [ -f orchestrator-test/labels2.json ] \
  && ok "C8 perception corpus diversity (2 mockups + GT)" || bad "C8 perception monoculture"

# --- C9: blind-spot register — every claim tracked, no status-less rows ---
REG=tests/blind-spot-register.md
REGROWS=$(grep -c '^| ' "$REG" 2>/dev/null || echo 0)
REGENUM=$(grep '^| ' "$REG" 2>/dev/null | grep -cv 'LIVE\|GATED\|SCOPED-OUT\|STATIC\|Claim\|---')
REGENUM=${REGENUM:-0}
[ -f "$REG" ] && [ "$REGROWS" -ge 20 ] && [ "$REGENUM" -eq 0 ] \
  && ok "C9 blind-spot register: all rows dispositioned (LIVE/GATED/SCOPED-OUT/STATIC)" || bad "C9 register rows missing or undispositioned ($REGENUM)"

# --- C10: skill-grade gate — graded files must match the graded hash (no ungraded skill edits ship) ---
CURSS=$(shasum skills/glm-orchestrator/SKILL.md commands/orchestrate.md commands/route.md | shasum | awk '{print $1}')
REC=$(python3 -c "import json;print(json.load(open('tests/skill-scores.json'))['target_hash'])" 2>/dev/null)
python3 -c "import json,sys; s=json.load(open('tests/skill-scores.json')); r=s['rounds'][-1]; sys.exit(0 if len(r['scores'])==3 else 1)" 2>/dev/null \
  && [ "$CURSS" = "$REC" ] && ok "C10 skill grades current (hash-matched, 3 targets)" || bad "C10 stale/ungraded skill files — re-grade via tests/skill-grader-rubric.md"
grep -q 'model default' "$S" && bad "C3 unpinned effort in skill table" || ok "C3 all efforts pinned in table"

# --- C4: manifests valid, hook injects correct models, kill switch silences ---
python3 -c "import json;json.load(open('.zcode-plugin/plugin.json'));json.load(open('hooks/hooks.json'))" 2>/dev/null \
  && ok "C4 plugin/hooks JSON valid" || bad "C4 JSON invalid"
echo '{}' | bash hooks/inject-routing.sh | grep -q 'glm-vision = GLM-5.3-Flash' && ok "C4 hook vision model" || bad "C4 hook vision model"
echo '{}' | bash hooks/inject-routing.sh | grep -q 'GLM-5V-Turbo' && bad "C4 hook stale model" || ok "C4 hook model-clean"
[ -z "$(echo '{}' | GLM_ORCHESTRATOR_DISABLE=1 bash hooks/inject-routing.sh)" ] && ok "C4 kill switch silent" || bad "C4 kill switch emits output"
C4OUT=$(CLAUDE_PLUGIN_ROOT="$PWD" bash -c 'echo "{}" | bash "${CLAUDE_PLUGIN_ROOT}/hooks/inject-routing.sh"')
echo "$C4OUT" | grep -q 'zcoder-routing' && ok "C4 hook manifest-shape invocation" || bad "C4 hook manifest-shape invocation"
grep -q '"SessionStart"' hooks/hooks.json && grep -q '"PreToolUse"' hooks/hooks.json && grep -q '"UserPromptSubmit"' hooks/hooks.json \
  && ok "C4 all three hook events registered" || bad "C4 hook events missing"
echo '{"hook_event_name":"SessionStart","source":"startup"}' | bash hooks/inject-routing.sh | grep -q 'zcoder-routing' \
  && ok "C4 SessionStart anchors routing" || bad "C4 SessionStart silent"
echo '{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"glm-main","prompt":"x"}}' \
  | bash hooks/inject-routing.sh | grep -q 'zcoder-dispatch-check' && ok "C4 PreToolUse glm dispatch-check" || bad "C4 PreToolUse glm missing check"
[ -z "$(echo '{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"Explore","prompt":"x"}}' | bash hooks/inject-routing.sh)" ] \
  && ok "C4 PreToolUse non-glm silent" || bad "C4 PreToolUse non-glm noisy"
[ -z "$(echo '{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"glm-main","prompt":"x"}}' | GLM_ORCHESTRATOR_DISABLE=1 bash hooks/inject-routing.sh)" ] \
  && ok "C4 kill switch silences dispatch-check" || bad "C4 kill switch leak"

# --- C5: fallback order consistent everywhere (main thread BEFORE glm-main) ---
grep -q 'main thread first' README.md && ok "C5 README ladder order" || bad "C5 README ladder order"
grep -q 'degrades to the main thread first' hooks/inject-routing.sh && ok "C5 hook ladder order" || bad "C5 hook ladder order"
grep -q 'read the image on the main thread and apply the vision grounding rules yourself' "$S" \
  && ok "C5 SKILL ladder order" || bad "C5 SKILL ladder order"

# --- P1: commands coherent with protocol ---
grep -qi 'preflight' commands/orchestrate.md && ok "P1 /orchestrate has preflight" || bad "P1 /orchestrate missing preflight"
grep -q 'do NOT execute' commands/route.md && ok "P1 /route read-only" || bad "P1 /route not read-only"

# --- P3: every engine in the skill exists as an agent file ---
for e in glm-vision glm-turbo glm-main; do
  [ -f "agents/$e.md" ] && ok "P3 agents/$e.md present" || bad "P3 agents/$e.md missing"
done


# --- C11: exhaustive file coverage + sister suite (skill-forge) green ---
python3 tests/coverage-manifest.py >/dev/null 2>&1 && ok "C11 file coverage complete (0 unaccounted)" || bad "C11 unaccounted plugin files"
bash tests/skill-forge-static.sh >/dev/null 2>&1 && ok "C11 skill-forge suite green" || bad "C11 skill-forge suite failing"

echo "----------------------------------------------------------------"
echo "OHI static: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
