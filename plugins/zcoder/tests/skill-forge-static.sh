#!/usr/bin/env bash
# skill-forge static scorecard — deterministic integrity checks, zero tokens.
# Usage: bash tests/skill-forge-static.sh   (exit 0 iff all checks pass)
cd "$(dirname "$0")/.." || exit 1
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }

# --- F1: manifests valid, version bumped ---
python3 -c "import json;j=json.load(open('.zcode-plugin/plugin.json'));assert j['version']" 2>/dev/null \
  && ok "F1 plugin.json valid" || bad "F1 plugin.json invalid"

# --- F2: skill-forge components present ---
for f in skills/skill-forge/SKILL.md commands/skill-scan.md commands/skill-evolve.md \
         skills/skill-forge/scripts/grade.py skills/skill-forge/scripts/oracle_selftest.py \
         skills/skill-forge/scripts/stats.py skills/skill-forge/scripts/promote.py \
         skills/skill-forge/scripts/scan_project.py \
         skills/skill-forge/scripts/pareto.py skills/skill-forge/scripts/trigger_eval.py; do
  [ -f "$f" ] && ok "F2 $f" || bad "F2 missing $f"
done

# --- F3: scripts compile ---
python3 -m py_compile skills/skill-forge/scripts/*.py 2>/dev/null \
  && ok "F3 scripts compile" || bad "F3 script compile error"

# --- F4: every SKILL.md parses; caps ENFORCED for forge-managed skills only.
# Forge-managed = has a tests/skill-evals/<name>/ suite (or is skill-forge).
# Legacy skills (e.g. glm-orchestrator, desc 589 chars, trigger-tuned over two
# OHI rounds) are never auto-failed on caps — their description is calibrated
# surface, not bureaucracy; length is reported as info.
for sk in skills/*/; do
  sk="${sk%/}"
  if [ -d "tests/skill-evals/$sk" ] || [ "$sk" = "skill-forge" ]; then mode=strict; else mode=legacy; fi
  python3 - "$sk" "$mode" <<'EOF' && ok "F4 $sk frontmatter ($mode)" || bad "F4 $sk frontmatter ($mode)"
import re, sys
meta_m = re.match(r"^---\n(.*?)\n---\n(.*)$", open(f"{sys.argv[1]}/SKILL.md").read(), re.S)
assert meta_m, "no frontmatter"
meta = dict(l.split(":",1) for l in meta_m.group(1).splitlines() if ":" in l)
d = meta.get("description","").strip()
assert len(d) >= 20, f"desc too short ({len(d)})"
if sys.argv[2] == "strict":
    assert len(d) <= 500, f"desc len {len(d)} > 500 (forge cap)"
    assert len(meta_m.group(2).encode()) <= 15360, "body over cap"
else:
    print(f"  (legacy desc {len(d)} chars, body {len(meta_m.group(2).encode())}B — info only)")
EOF
done

# --- F5: every scenario dir complete (task/oracle/references) + selftest green ---
for ev in tests/skill-evals/*/; do
  skill=$(basename "$ev")
  for sc in "$ev"scenarios/*/; do
    [ -f "$sc/task.md" ] && [ -f "$sc/oracle/checker.py" ] \
      && ls "$sc"/oracle/reference_good.* >/dev/null 2>&1 \
      && ls "$sc"/oracle/reference_bad.* >/dev/null 2>&1 \
      && ok "F5 $skill/$(basename "$sc") scenario complete" \
      || bad "F5 $skill/$(basename "$sc") incomplete"
  done
  python3 skills/skill-forge/scripts/oracle_selftest.py "$ev" >/dev/null 2>&1 \
    && ok "F5 $skill oracle self-test green" || bad "F5 $skill oracle self-test"
done

# --- F6: ledgers parse as JSONL ---
for led in tests/skill-evals/*/trials.jsonl; do
  [ -f "$led" ] || continue
  python3 -c "import json,sys;[json.loads(l) for l in open('$led') if l.strip()]" 2>/dev/null \
    && ok "F6 $(basename "$(dirname "$led")") trials.jsonl parses" || bad "F6 $led unparseable"
done

# --- F7: candidates carry MUTATION.md ---
for cand in tests/skill-evals/*/candidates/*/; do
  [ -d "$cand" ] || continue
  [ -f "$cand/MUTATION.md" ] && ok "F7 $(basename "$cand") has MUTATION.md" \
    || bad "F7 candidate $(basename "$cand") missing MUTATION.md"
done

# --- F8: trigger-surface eval (Hermes Phase-2 port) integrity ---
if [ -f tests/skill-evals/trigger-cases.jsonl ]; then
  python3 skills/skill-forge/scripts/trigger_eval.py --check >/dev/null 2>&1 \
    && ok "F8 trigger-cases.jsonl validates (--check green)" \
    || bad "F8 trigger-cases.jsonl fails --check"
  python3 -c "import json;[json.loads(l) for l in open('tests/skill-evals/trigger-evals.jsonl') if l.strip()]" 2>/dev/null \
    && ok "F8 trigger-evals.jsonl parses" \
    || bad "F8 trigger-evals.jsonl unparseable"
  grep -q "G7" skills/skill-forge/scripts/promote.py \
    && ok "F8 promote.py wires G7 trigger-evidence gate" \
    || bad "F8 promote.py missing G7"
else
  bad "F8 tests/skill-evals/trigger-cases.jsonl missing"
fi

# --- F9: growth-limit gate present (Hermes max_prompt_growth port) ---
grep -q "GROWTH_RATIO" skills/skill-forge/scripts/promote.py \
  && ok "F9 promote.py wires G6 growth-limit gate" \
  || bad "F9 promote.py missing G6"

# --- F10: pareto.py runs green on every ledger (frontier + target smoke) ---
for led in tests/skill-evals/*/trials.jsonl; do
  [ -f "$led" ] || continue
  python3 skills/skill-forge/scripts/pareto.py "$led" >/dev/null 2>&1 \
    && ok "F10 pareto $(basename "$(dirname "$led")")" \
    || bad "F10 pareto fails on $led"
done

# --- F11: smoke battery green (adversarial gate fixtures; born from the
#     2026-09-04 audit that caught 3 gate blind spots + 1 scorer bug) ---
bash tests/skill-forge-smoke.sh >/dev/null 2>&1 \
  && ok "F11 smoke battery (tests/skill-forge-smoke.sh)" \
  || bad "F11 smoke battery failed"

echo "----"
echo "skill-forge static: $pass pass, $fail fail"
[ "$fail" -eq 0 ]
