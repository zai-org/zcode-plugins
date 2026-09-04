#!/usr/bin/env bash
# skill-forge smoke battery — adversarial fixtures against every script CLI,
# zero tokens, all state in a mktemp sandbox (SKILL_FORGE_EVALS/SKILL_FORGE_SKILLS).
# Born 2026-09-04 from an e2e audit that found 3 real gate blind spots
# (cross-session fix claims, candidate-only scenario fails, baseline-free
# trigger runs). Each probe here is a regression lock on a confirmed hole.
# Usage: bash tests/skill-forge-smoke.sh   (exit 0 iff all checks pass)
cd "$(dirname "$0")/.." || exit 1
pass=0; fail=0
ok()  { pass=$((pass+1)); echo "PASS  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }
PROMOTE="skills/skill-forge/scripts/promote.py"
PARETO="skills/skill-forge/scripts/pareto.py"
TRIGGER="skills/skill-forge/scripts/trigger_eval.py"
GRADE="skills/skill-forge/scripts/grade.py"
SELFTEST="skills/skill-forge/scripts/oracle_selftest.py"

T=$(mktemp -d /tmp/forge-smoke.XXXXXX)
trap 'rm -rf "$T"' EXIT
export SKILL_FORGE_EVALS="$T/evals"
export SKILL_FORGE_SKILLS="$T/skills"
mkdir -p "$T/skills/demofix" "$T/evals/demofix/candidates" "$T/evals/demofix/scenarios/s1/oracle"

# ---- fixtures ----
cat > "$T/skills/demofix/SKILL.md" <<'EOF'
---
name: demofix
description: Demo fixture skill for gate probes with a description long enough.
---

Body line one.
Body line two.
EOF
cat > "$T/evals/demofix/scenarios/s1/task.md" <<'EOF'
---
output_ext: txt
---
Say PASS.
{{SKILL_GUIDANCE}}
OUTPUT_BEGIN
OUTPUT_END
EOF
cat > "$T/evals/demofix/scenarios/s1/oracle/checker.py" <<'EOF'
#!/usr/bin/env python3
import sys
ok = open(sys.argv[1]).read().strip() == "PASS"
print(f"VERDICT {'pass' if ok else 'fail'}")
print("REASON demo")
sys.exit(0 if ok else 1)
EOF
echo PASS > "$T/evals/demofix/scenarios/s1/oracle/reference_good.txt"
echo NOPE > "$T/evals/demofix/scenarios/s1/oracle/reference_bad.txt"

mkcand() { # mkcand <name> <description> [extra-body-bytes]
  local d="$T/evals/demofix/candidates/$1"
  mkdir -p "$d"
  python3 - "$d" "$2" "${3:-0}" <<'PYEOF'
import sys
d, desc, pad = sys.argv[1], sys.argv[2], int(sys.argv[3])
body = "Body line one.\nBody line two.\n" + ("B" * pad)
open(f"{d}/SKILL.md", "w").write(f"---\nname: demofix\ndescription: {desc}\n---\n\n{body}\n")
PYEOF
  printf 'Cites s1__v1__r1 as the failing trial.\n' > "$d/MUTATION.md"
}
ledrow() { # ledrow <scen> <variant> <run> <verdict> <session>
  printf '{"ts":"2026-09-04T00:00:00+00:00","skill":"demofix","scenario":"%s","variant":"%s","run":"%s","verdict":"%s","reason":"x","sha256":"a","oracle":"o","task":"t","session":"%s"}\n' "$1" "$2" "$3" "$4" "$5"
}
writetrials() { : > "$T/evals/demofix/trials.jsonl"; }

# ================= pareto.py =================
writetrials
python3 "$PARETO" "$T/evals/demofix/trials.jsonl" >/dev/null 2>&1
[ $? -ne 0 ] && ok "S1 pareto: empty ledger rejected" || bad "S1 pareto: empty ledger not rejected"

{ ledrow s1 v1 r1 fail sessA; ledrow s1 v1 r2 fail sessA
  ledrow s1 v2 r1 pass sessA; ledrow s1 v2 r2 pass sessA; } > "$T/evals/demofix/trials.jsonl"
python3 "$PARETO" "$T/evals/demofix/trials.jsonl" | grep -q "v1 .*dominated" \
  && ok "S2 pareto: all-pass variant dominates failing variant" || bad "S2 pareto dominance"

{ ledrow s1 v1 r1 pass sessA; ledrow s2 v2 r1 pass sessB; } > "$T/evals/demofix/trials.jsonl"
F=$(python3 "$PARETO" "$T/evals/demofix/trials.jsonl" | grep "^frontier")
echo "$F" | grep -q "v1" && echo "$F" | grep -q "v2" \
  && ok "S3 pareto: coverage gap => no dominance (both frontier)" || bad "S3 pareto coverage gap ($F)"

{ ledrow s1 v1 r1 pass sessA; ledrow s1 v2 r1 pass sessB; } > "$T/evals/demofix/trials.jsonl"
python3 "$PARETO" "$T/evals/demofix/trials.jsonl" --json | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['frontier']==['v1','v2']; assert 'variant' in d['target']" \
  && ok "S4 pareto: equal profiles share frontier; --json target present" || bad "S4 pareto equal/json"

# point-in-time plateau: promo ts BEFORE the trials that made its variant win => off-frontier at its time
writetrials
{ ledrow s1 v1 r1 fail sessA; ledrow s1 v1 r2 fail sessA; } >> "$T/evals/demofix/trials.jsonl"   # ts 00:00
sed -i '' 's/2026-09-04T00:00:00/2026-09-04T01:00:00/' "$T/evals/demofix/trials.jsonl" 2>/dev/null || true
# rebuild with explicit timestamps: v2 trials at 03:00, promos at 02:00 (both promos pre-date v2 evidence)
{ printf '{"ts":"2026-09-04T02:00:00+00:00","skill":"demofix","scenario":"s1","variant":"v1","run":"r1","verdict":"fail","reason":"x","sha256":"a","oracle":"o","task":"t","session":"sessA"}\n'
  printf '{"ts":"2026-09-04T03:00:00+00:00","skill":"demofix","scenario":"s1","variant":"v2","run":"r1","verdict":"pass","reason":"x","sha256":"b","oracle":"o","task":"t","session":"sessA"}\n'
  printf '{"ts":"2026-09-04T03:00:00+00:00","skill":"demofix","scenario":"s1","variant":"v2","run":"r2","verdict":"pass","reason":"x","sha256":"b","oracle":"o","task":"t","session":"sessA"}\n'; } > "$T/evals/demofix/trials.jsonl"
printf '{"ts":"20260904T020000Z","skill":"demofix","from_variant":"v0","to_variant":"c1"}\n' > "$T/evals/demofix/promotions.jsonl"
printf '{"ts":"20260904T021000Z","skill":"demofix","from_variant":"c1","to_variant":"c2"}\n' >> "$T/evals/demofix/promotions.jsonl"
python3 "$PARETO" "$T/evals/demofix/trials.jsonl" --plateau "$T/evals/demofix/promotions.jsonl" | grep -q "PLATEAU CHECK \[PLATEAU\]" \
  && ok "S5 pareto: point-in-time plateau detects stalled promos" || bad "S5 pareto point-in-time plateau"
printf '{"ts":"20260904T040000Z","skill":"demofix","from_variant":"x","to_variant":"v2"}\n' >> "$T/evals/demofix/promotions.jsonl"
python3 "$PARETO" "$T/evals/demofix/trials.jsonl" --plateau "$T/evals/demofix/promotions.jsonl" | grep -q "PLATEAU CHECK \[ALIVE\]" \
  && ok "S6 pareto: frontier-entering promo keeps loop ALIVE" || bad "S6 pareto ALIVE"

# ================= trigger_eval.py =================
CASES="$T/evals/trigger-cases.jsonl"
{ printf '{"id":"t1","utterance":"do the demo fix thing","expected":"demofix","note":"core domain"}\n'
  printf '{"id":"t2","utterance":"say hi","expected":"none","note":"smalltalk tripwire"}\n'; } > "$CASES"
python3 "$TRIGGER" --check >/dev/null 2>&1 \
  && ok "S7 trigger --check: valid fixture accepted" || bad "S7 trigger --check valid"

printf '{"id":"t1","utterance":"a","expected":"demofix","note":"n"}\n{"id":"t1","utterance":"b","expected":"none","note":"n"}\n' > "$CASES"
python3 "$TRIGGER" --check >/dev/null 2>&1 && bad "S8 trigger: duplicate id accepted" || ok "S8 trigger: duplicate id rejected"
printf '{"id":"t1","utterance":"a","expected":"ghostskill","note":"n"}\n' > "$CASES"
python3 "$TRIGGER" --check >/dev/null 2>&1 && bad "S9 trigger: unknown expected accepted" || ok "S9 trigger: unknown expected rejected"
printf '{"id":"t1","utterance":"a","expected":"demofix"}\n' > "$CASES"
python3 "$TRIGGER" --check >/dev/null 2>&1 && bad "S10 trigger: missing note accepted" || ok "S10 trigger: missing note rejected"
{ printf '{"id":"t1","utterance":"do the demo fix thing","expected":"demofix","note":"core domain"}\n'
  printf '{"id":"t2","utterance":"say hi","expected":"none","note":"smalltalk tripwire"}\n'; } > "$CASES"

printf '1: demofix\n' > "$T/ans-partial.txt"
python3 "$TRIGGER" --score "$T/ans-partial.txt" --run-id r --variant v >/dev/null 2>&1 \
  && bad "S11 trigger: partial answers accepted" || ok "S11 trigger: partial answers refused"
printf '1: demofix\n1: none\n2: none\n' > "$T/ans-dup.txt"
python3 "$TRIGGER" --score "$T/ans-dup.txt" --run-id r --variant v >/dev/null 2>&1 \
  && bad "S12 trigger: duplicate answers accepted" || ok "S12 trigger: duplicate answers refused"
printf '1: demofix\n2: none\n' > "$T/ans-ok.txt"
python3 "$TRIGGER" --score "$T/ans-ok.txt" --run-id r --variant v --ok ghost >/dev/null 2>&1 \
  && bad "S13 trigger: unknown --ok id accepted" || ok "S13 trigger: unknown --ok id refused"
printf '1: DEMOFIX (because reasons)\n2: NONE\n' > "$T/ans-case.txt"
python3 "$TRIGGER" --score "$T/ans-case.txt" --run-id smoke-r1 --variant inc --note casefold >/dev/null 2>&1 \
  && ok "S14 trigger: annotations + case-insensitive verdicts scored" || bad "S14 trigger score failed"
python3 -c "import json,sys; r=[json.loads(l) for l in open('$T/evals/trigger-evals.jsonl')][-1]; assert r['run_id']=='smoke-r1' and r['baseline_run'] is None, r" \
  && ok "S15 trigger: first run stamped baseline_run=null" || bad "S15 trigger baseline stamp"
# regressing run: t1 wrong -> demofix rate drops vs baseline -> REGRESSION flagged
printf '1: none\n2: none\n' > "$T/ans-reg.txt"
python3 "$TRIGGER" --score "$T/ans-reg.txt" --run-id smoke-r2 --variant cand --ok t1 --note "adjudicated, but rate drop must still flag" >/dev/null 2>&1
python3 -c "import json; r=[json.loads(l) for l in open('$T/evals/trigger-evals.jsonl')][-1]; assert r['baseline_run']=='smoke-r1' and r['regressions'], r" \
  && ok "S16 trigger: auto-baseline + cross-skill regression flagged" || bad "S16 trigger regression detection"
# clean candidate run over same table: auto-baseline to smoke-r1, no regressions => G7-eligible
printf '1: demofix\n2: none\n' > "$T/ans-clean.txt"
python3 "$TRIGGER" --score "$T/ans-clean.txt" --run-id smoke-r3 --variant candclean >/dev/null 2>&1
python3 -c "import json; r=[json.loads(l) for l in open('$T/evals/trigger-evals.jsonl')][-1]; assert r['baseline_run']=='smoke-r1' and not r['regressions'] and r['effective']>=0.75, r" \
  && ok "S17 trigger: clean run is G7-eligible (baseline + no regressions)" || bad "S17 trigger clean run"

# ================= promote.py gates =================
PR() { python3 "$PROMOTE" --skill demofix --candidate "$1" --incumbent-variant v1 2>/dev/null; }
writetrials
{ ledrow s1 v1 r1 fail sessA; ledrow s1 v1 r2 fail sessA
  ledrow s1 cand r1 pass sessA; ledrow s1 cand r2 pass sessA; } >> "$T/evals/demofix/trials.jsonl"
mkcand cand "Demo fixture skill for gate probes with a description long enough."

mkcand short "tiny"
PR short | grep -q "FAIL  G1" && ok "S18 G1: short description rejected" || bad "S18 G1 short desc"
mkcand holder "Demo fixture skill for gate probes with a description long enough but holding a TODO marker inside."
PR holder | grep -q "FAIL  G1" && ok "S19 G1: placeholder marker rejected" || bad "S19 G1 placeholder"
mkcand nocite "Demo fixture skill for gate probes with a description long enough."
printf 'no citations here at all\n' > "$T/evals/demofix/candidates/nocite/MUTATION.md"
PR nocite | grep -q "FAIL  G4" && ok "S20 G4: mutation without trial citation rejected" || bad "S20 G4 citation"
mkcand grow "Demo fixture skill for gate probes with a description long enough." 1200
PR grow | grep -q "FAIL  G6" && ok "S21 G6: overgrowth rejected" || bad "S21 G6 overgrowth"
mkcand growok "Demo fixture skill for gate probes with a description long enough." 400
PR growok | grep -q "PASS  G6" && ok "S22 G6: growth within allowance passes" || bad "S22 G6 within allowance"

# G7 sequence on desc-changing candidates (clean fixture ledger from above)
mkcand nodata "A completely different unmeasured description for the demo fixture skill."
PR nodata | grep -q "FAIL  G7" && ok "S23 G7: desc change with no trigger run rejected" || bad "S23 G7 no run"
: > "$T/evals/trigger-evals.jsonl"
printf '{"ts":"t","run_id":"vacuous","variant":"nodata","cases_sha":"x","cases":2,"answers":{},"literal":1.0,"effective":1.0,"confusions":[],"per_skill":{},"regressions":[],"threshold":0.75,"agent":"x","tokens":1,"note":"no baseline"}\n' >> "$T/evals/trigger-evals.jsonl"
PR nodata | grep -q "FAIL  G7" && ok "S24 G7: baseline-free run rejected (loophole stays closed)" || bad "S24 G7 vacuous run"
mkcand candclean "A genuinely re-measured description for the demo fixture skill, evolved."
# S24's truncation wiped the ledger — re-establish: incumbent run first (no
# baseline available), then the candidate run auto-baselines to it
python3 "$TRIGGER" --score "$T/ans-clean.txt" --run-id smoke-r4 --variant inc --note reseed >/dev/null 2>&1
python3 "$TRIGGER" --score "$T/ans-clean.txt" --run-id smoke-r5 --variant candclean >/dev/null 2>&1
PR candclean | grep -q "PASS  G7" && ok "S25 G7: baseline-referenced clean run passes" || bad "S25 G7 eligible run"
# G3 regression locks (the 3 confirmed blind spots + legit path)
writetrials
{ ledrow s1 v1 r1 fail sessA; ledrow s1 v1 r2 fail sessA
  ledrow s1 cand r1 pass sessB; ledrow s1 cand r2 pass sessB; } >> "$T/evals/demofix/trials.jsonl"
mkcand cand "Demo fixture skill for gate probes with a description long enough."
PR cand | grep -q "FAIL  G3" && ok "S26 G3: cross-session fix claim rejected" || bad "S26 G3 cross-session"
writetrials
{ ledrow s1 v1 r1 fail sessA; ledrow s1 v1 r2 fail sessA
  ledrow s1 cand r1 pass sessA; ledrow s1 cand r2 pass sessA
  ledrow s2 cand r1 fail sessA; } >> "$T/evals/demofix/trials.jsonl"
PR cand | grep -q "FAIL  G3" && ok "S27 G3: candidate-only scenario fail rejected" || bad "S27 G3 candidate-only"
writetrials
{ ledrow s1 v1 r1 fail sessA; ledrow s1 v1 r2 fail sessA
  ledrow s1 cand r1 pass sessA; ledrow s1 cand r2 pass sessA
  ledrow s2 v1 r1 pass sessA; ledrow s2 v1 r2 pass sessA
  ledrow s2 cand r1 pass sessA; ledrow s2 cand r2 pass sessA; } >> "$T/evals/demofix/trials.jsonl"
PR cand | grep -q "PASS  G3" && ok "S28 G3: same-session paired evidence passes" || bad "S28 G3 legit path"

# ================= grade.py =================
writetrials
python3 - "$T/raw-nomarkers.txt" <<'PYEOF'
import sys; open(sys.argv[1], "w").write("junk without markers\n")
PYEOF
python3 "$GRADE" --record "$T/evals" demofix s1 cand nr1 "$T/raw-nomarkers.txt" --session smoke >/dev/null 2>&1
python3 -c "import json; r=[json.loads(l) for l in open('$T/evals/demofix/trials.jsonl')][-1]; assert r['verdict']=='fail' and 'protocol_fail' in r['reason'], r" \
  && ok "S29 grade: missing OUTPUT markers => protocol_fail" || bad "S29 grade protocol_fail"
python3 - "$T/raw-fenced.txt" <<'PYEOF'
import sys; open(sys.argv[1], "w").write("OUTPUT_BEGIN\n```\nPASS\n```\nOUTPUT_END\n")
PYEOF
python3 "$GRADE" --record "$T/evals" demofix s1 cand fr1 "$T/raw-fenced.txt" --session smoke >/dev/null 2>&1
python3 -c "import json; r=[json.loads(l) for l in open('$T/evals/demofix/trials.jsonl')][-1]; assert r['verdict']=='pass', r" \
  && ok "S30 grade: fenced payload inside markers stripped and passes" || bad "S30 grade fence strip"
python3 "$GRADE" --record "$T/evals" demofix s1 cand fr1 "$T/raw-fenced.txt" --session smoke 2>/dev/null | grep -q "DUPLICATE" \
  && ok "S31 grade: identical re-record deduplicated" || bad "S31 grade dedup"

# ================= selftest on fixture =================
python3 "$SELFTEST" "$T/evals/demofix" 2>/dev/null | grep -q "GREEN" \
  && ok "S32 selftest: fixture scenario green" || bad "S32 selftest fixture"

echo "----"
echo "skill-forge smoke: $pass pass, $fail fail"
[ "$fail" -eq 0 ]
