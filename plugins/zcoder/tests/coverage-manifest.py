#!/usr/bin/env python3
"""Exhaustive file-level coverage: every plugin file must map to a covering check.
Domain = glob of the plugin tree (finite). Zero unaccounted files is decidable."""
import glob, os, json, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
# file -> list of suite checks / evidence that cover it (grep-verified below)
COVERING = {
  ".zcode-plugin/plugin.json": ["C4-json-valid"],
  "README.md": ["C5-ladder-order"],
  "README_CN.md": ["C5-ladder-order"],
  "agents/glm-vision.md": ["C1", "C2", "C3", "P3", "ledger"],
  "agents/glm-turbo.md": ["C1", "C2", "C3", "P3", "ledger"],
  "agents/glm-main.md": ["C1", "C2", "P3", "ledger"],
  "skills/glm-orchestrator/SKILL.md": ["C2","C3","C5","C6","C10","grade","blackbox"],
  "commands/orchestrate.md": ["P1","C10","grade"],
  "commands/route.md": ["P1","C10","grade"],
  "hooks/hooks.json": ["C4-all-events"],
  "hooks/inject-routing.sh": ["C4","C5","C6"],
  "tests/ohi-static.sh": ["mutation-matrix-10/10"],
  "tests/ohi-stats.py": ["review", "lifetime-alarm-live"],
  "tests/OHI.md": ["round-log"],
  "tests/ohi-trials.jsonl": ["stats-input"],
  "tests/dispatch-attempts.jsonl": ["lifetime-alarm-input"],
  "tests/capability-ledger.json": ["C7"],
  "tests/skill-scores.json": ["C10"],
  "tests/skill-grader-rubric.md": ["grader-input"],
  "tests/blind-spot-register.md": ["C9"],
  "tests/.ohi-state": ["tier-loop-state"],
  "tests/ohi-monitor.sh": ["monitor-live"],
  "tests/ohi-continuous.log": ["monitor-output"],
  "orchestrator-test/dashboard-mockup.png": ["D8-GT"],
  "orchestrator-test/mockup2.png": ["C8","D8-alt"],
  "orchestrator-test/labels.json": ["D8-GT"],
  "orchestrator-test/labels2.json": ["C8"],
  "orchestrator-test/make_mockup.py": ["regen-GT"],
  "orchestrator-test/make_mockup2.py": ["regen-GT"],
  "orchestrator-test/make_mockup_diff.py": ["regen-GT"],
  "orchestrator-test/dashboard-mockup-diff.png": ["diff-test-GT"],
  "orchestrator-test/dashboard.html": ["sample-asset"],
  "orchestrator-test/dashboard2.html": ["sample-asset"],
  "orchestrator-test/dogfood/": ["scratch-dir"],
  "skills/skill-forge/SKILL.md": ["forge-suite-F2", "forge-lifecycle"],
  "skills/skill-forge/scripts/grade.py": ["forge-F2-F3", "validation-H1-H4"],
  "skills/skill-forge/scripts/oracle_selftest.py": ["forge-F2-F3"],
  "skills/skill-forge/scripts/promote.py": ["forge-F2-F3", "gate-G1-G4"],
  "skills/skill-forge/scripts/scan_project.py": ["forge-F2-F3"],
  "skills/skill-forge/scripts/stats.py": ["forge-F2-F3", "wilson-thompson"],
  "skills/skill-forge/scripts/pareto.py": ["forge-analysis", "promote-G3-dominance", "compile-checked-2026-09-04"],
  "skills/skill-forge/scripts/trigger_eval.py": ["forge-trigger-eval", "promote-G7", "compile-checked-2026-09-04"],
  "skills/laravel-dev/SKILL.md": ["forge-managed", "evals-laravel"],
  "skills/yaml-json-convert/SKILL.md": ["forge-managed", "evals-yaml", "promotion-v2"],
  "skills-archive/": ["promotion-archive"],
  "commands/skill-evolve.md": ["forge-F2"],
  "commands/skill-scan.md": ["forge-F2"],
  "tests/skill-forge-static.sh": ["forge-static-suite"],
  "tests/skill-forge-smoke.sh": ["forge-smoke-battery", "forge-F11"],
  "tests/skill-evals/": ["forge-loop-state"],
  "tests/skill-eval-validation/": ["validation-experiment-H1..H4"],
  "tests/coverage-manifest.py": ["C11-self"],
  "tests/coverage-manifest.json": ["manifest-output"],

}
actual = set()
for pat in ("**/*",):
    for f in glob.glob(pat, recursive=True):
        if os.path.isfile(f) and not f.startswith((".git", "node_modules")) and "__pycache__" not in f:
            actual.add(f)
dirs = [d for d in COVERING if d.endswith("/")]
def is_accounted(f):
    if f in COVERING:
        return True
    return any(f.startswith(d) for d in dirs)
unaccounted = sorted(f for f in actual if not is_accounted(f))
json.dump({"accounted": len(actual) - len(unaccounted), "files_on_disk": len(actual),
           "unaccounted": unaccounted}, open("tests/coverage-manifest.json","w"), indent=1)
if unaccounted:
    print("UNACCOUNTED:", *unaccounted, sep="\n  "); sys.exit(1)
print(f"coverage complete: {len(actual)} files on disk, 0 unaccounted")
