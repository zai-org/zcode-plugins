#!/usr/bin/env python3
"""Gated candidate promotion for skill-forge. stdlib only.

promote.py --skill <name> --candidate <id> --incumbent-variant <v> [--approved-by NAME]

Gates (all must pass before installation; without --approved-by this is a
dry-run that reports gate status only — idle automation NEVER gets approval
authority):
  G1 static integrity  — candidate SKILL.md parses; frontmatter name matches
       the skill dir; description 20-500 chars (Hermes port: hard size caps);
       body <= 15360 bytes; no TODO/FIXME/XXX/TBD placeholders.
  G2 oracle self-test  — the skill's eval suite self-tests green
       (reference_good passes, reference_bad fails, every scenario).
  G3 evidence         — discriminative gate (tripwire philosophy; statistical
       significance needs ~300 items/arm which is uneconomical — OHI power
       analysis 2026-09-03):
         for every scenario where the incumbent has >=1 trial:
           - candidate must have >=1 trial on it
           - if the incumbent failed it in ALL its trials, the candidate must
             pass it in ALL its trials (the claimed fix is confirmed)
           - if the incumbent passed it in ALL its trials, the candidate must
             not fail it in ANY trial (no regression)
       Mutations that do not target a failing trial cannot pass G3.
  G4 mutation citation — candidate dir must contain MUTATION.md citing at
       least one failing trial id (reflective mutation contract, Hermes port).
  G5 differs-from-incumbent — a byte-identical 'improvement' is a no-op.
  G6 growth limit (Hermes port: constraints.max_prompt_growth) — candidate
       body may not exceed the incumbent body by more than 20%, with a 768B
       absolute floor so young skills aren't dead-ended (evolutionary bloat
       guard: verbose solutions must EARN their bytes, not drift into them).
  G7 trigger evidence (Hermes port: tool-description rules) — the skill
       description is trigger surface (what the router matches on), the
       analog of a tool description. If the candidate changes it, the
       change must be measured first: a run recorded for this candidate in
       tests/skill-evals/trigger-evals.jsonl (by trigger_eval.py --score
       --variant) with effective accuracy >= 0.75 and zero cross-skill
       regressions. Unmeasured description changes are rejected — the
       schema-text split hermes enforces for tool schemas, applied here.

On approval: archive incumbent -> skills-archive/<skill>/<UTC-ts>/SKILL.md,
install candidate -> skills/<skill>/SKILL.md, append promotions.jsonl.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))            # .../skills/skill-forge/scripts
PLUGIN_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
# SKILL_FORGE_EVALS lets the smoke suite point gates at /tmp fixtures; unset
# in production, where EVALS is always the plugin's real ledger tree.
EVALS = os.environ.get("SKILL_FORGE_EVALS") or os.path.join(PLUGIN_ROOT, "tests", "skill-evals")
SELFTEST = os.path.join(HERE, "oracle_selftest.py")

BODY_CAP = 15360
DESC_MIN, DESC_MAX = 20, 500
PLACEHOLDERS = ("TODO", "FIXME", "XXX", "TBD")
GROWTH_RATIO = 0.2        # Hermes port: max_prompt_growth
GROWTH_FLOOR_B = 768      # absolute allowance so young skills aren't dead-ended
TRIGGER_LEDGER = os.path.join(EVALS, "trigger-evals.jsonl")
TRIGGER_MIN_ACC = 0.75
SKILLS_DIR = os.environ.get("SKILL_FORGE_SKILLS") or os.path.join(PLUGIN_ROOT, "skills")


def live_skill_path(skill):
    return os.path.join(SKILLS_DIR, skill, "SKILL.md")


def parse_frontmatter(path):
    text = open(path).read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return None, None, None
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, m.group(2), text


def gate_static(skill, cand_dir):
    path = os.path.join(cand_dir, "SKILL.md")
    if not os.path.exists(path):
        return False, "candidate SKILL.md missing"
    meta, body, raw = parse_frontmatter(path)
    if meta is None:
        return False, "frontmatter missing/unparsable"
    if meta.get("name") != skill:
        return False, f"frontmatter name {meta.get('name')!r} != skill {skill!r}"
    desc = meta.get("description", "")
    if not (DESC_MIN <= len(desc) <= DESC_MAX):
        return False, f"description length {len(desc)} outside [{DESC_MIN},{DESC_MAX}]"
    if len(body.encode()) > BODY_CAP:
        return False, f"body {len(body.encode())} bytes > cap {BODY_CAP}"
    hits = [p for p in PLACEHOLDERS if p in body]
    if hits:
        return False, f"placeholder markers present: {hits}"
    # 2026-09-04 smoke audit: the scan covered the body only — a TODO in the
    # description (shipped trigger text) sailed through. Raw scan now.
    hits = [p for p in PLACEHOLDERS if p in raw]
    if hits:
        return False, f"placeholder markers in frontmatter/description: {hits}"
    return True, f"frontmatter ok, desc {len(desc)} chars, body {len(body.encode())} bytes <= {BODY_CAP}"


def gate_selftest(skill):
    r = subprocess.run([sys.executable, SELFTEST, os.path.join(EVALS, skill)],
                       capture_output=True, text=True)
    ok = "ORACLE SELF-TEST GREEN" in r.stdout
    return ok, (r.stdout.strip().splitlines() or ["?"])[-1]


def gate_evidence(skill, cand_variant, inc_variant):
    """Strictly-better rule, paired-session edition (audited 2026-09-04: two
    blind spots confirmed by adversarial fixtures —
      (a) a 'fix' assembled from DISJOINT sessions passed (incumbent fails in
          session A + candidate passes in session B = the exact session
          confound that downgraded the yaml-json-convert v2 claim 2026-09-03), and
      (b) a candidate FAILING a scenario the incumbent never tried passed,
          because only incumbent-covered scenarios were checked).
    Rules now:
      - For every scenario S the incumbent tried: consider only sessions where
        BOTH variants were tried on S. No such session => problem (the staged
        protocol exists to create one: interleaved dispatches under one
        --session label). Within paired sessions: candidate pass rate >=
        incumbent's, never fewer.
      - Strict improvement: some S where the incumbent had >=1 fail and the
        candidate is all-pass within paired sessions.
      - Candidate-only scenarios (incumbent untried): candidate must be
        ALL-PASS there — a fail on untried ground is an unmeasured regression
        surface, not neutral novelty.
      - Candidate fails in unpaired sessions are flagged, not scored (they can
        neither support nor refute the paired comparison)."""
    ledger = os.path.join(EVALS, skill, "trials.jsonl")
    rows = [json.loads(l) for l in open(ledger) if l.strip()] if os.path.exists(ledger) else []
    problems, notes = [], []
    inc = [r for r in rows if r["variant"] == inc_variant]
    cand = [r for r in rows if r["variant"] == cand_variant]
    if not cand:
        return False, ["candidate has zero trials"]
    if not inc:
        return False, [f"incumbent variant {inc_variant!r} has zero trials"]
    sess = lambda r: r.get("session", "legacy")
    strict_improvement = False
    for scen in sorted({r["scenario"] for r in inc}):
        i_rows = [r for r in inc if r["scenario"] == scen]
        c_rows = [r for r in cand if r["scenario"] == scen]
        if not c_rows:
            problems.append(f"{scen}: candidate untried")
            continue
        paired = {sess(r) for r in i_rows} & {sess(r) for r in c_rows}
        if not paired:
            problems.append(f"{scen}: no same-session comparison (dispatch incumbent+candidate interleaved under one --session)")
            continue
        i_p = [r for r in i_rows if sess(r) in paired]
        c_p = [r for r in c_rows if sess(r) in paired]
        i_pass = sum(1 for r in i_p if r["verdict"] == "pass")
        c_pass = sum(1 for r in c_p if r["verdict"] == "pass")
        if c_pass < i_pass:
            problems.append(f"{scen}: REGRESSION in paired sessions (candidate {c_pass}/{len(c_p)} < incumbent {i_pass}/{len(i_p)})")
        elif any(r["verdict"] != "pass" for r in i_p) and c_pass == len(c_p):
            strict_improvement = True
            notes.append(f"{scen}: strict improvement, same-session (incumbent {i_pass}/{len(i_p)} -> candidate {c_pass}/{len(c_p)} all-pass)")
        else:
            notes.append(f"{scen}: no regression, same-session (incumbent {i_pass}/{len(i_p)}, candidate {c_pass}/{len(c_p)})")
        for r in c_rows:
            if sess(r) not in paired and r["verdict"] != "pass":
                notes.append(f"{scen}: candidate fail in unpaired session {sess(r)!r} — not scored, investigate")
    for scen in sorted({r["scenario"] for r in cand} - {r["scenario"] for r in inc}):
        c_rows = [r for r in cand if r["scenario"] == scen]
        if any(r["verdict"] != "pass" for r in c_rows):
            n_fail = sum(1 for r in c_rows if r["verdict"] != "pass")
            problems.append(f"{scen}: candidate-only scenario FAILS {n_fail}/{len(c_rows)} — unmeasured regression surface")
        else:
            notes.append(f"{scen}: candidate-only scenario all-pass ({len(c_rows)}/{len(c_rows)}) — extension evidence")
    if not strict_improvement:
        problems.append("NO strict improvement proven (no scenario where incumbent had fails and candidate is all-pass, same-session)")
    return (not problems), (problems or notes)


def gate_differ(skill, cand_dir):
    """G5: the candidate must actually differ from the installed incumbent —
    a byte-identical 'improvement' is a no-op promotion."""
    live = live_skill_path(skill)
    cand = os.path.join(cand_dir, "SKILL.md")
    if not os.path.exists(live) or not os.path.exists(cand):
        return False, "incumbent or candidate SKILL.md missing"
    same = open(live, "rb").read() == open(cand, "rb").read()
    return (not same), "identical to incumbent (no-op)" if same else "differs from incumbent"


def gate_mutation(cand_dir):
    path = os.path.join(cand_dir, "MUTATION.md")
    if not os.path.exists(path):
        return False, "MUTATION.md missing"
    text = open(path).read()
    ids = re.findall(r"\b(run\w*|[a-z0-9-]+__\w+__\w+)\b", text)
    cited = [i for i in ids if i.startswith("run") or "__" in i]
    if not cited:
        return False, "MUTATION.md cites no failing trial id"
    return True, f"cites {sorted(set(cited))[:3]}"


def _frontmatter_body(path):
    meta, body, _ = parse_frontmatter(path)
    return meta or {}, body or ""


def gate_growth(skill, cand_dir):
    """G6 (Hermes port): candidate body <= incumbent body + max(20%, 768B)."""
    live = live_skill_path(skill)
    cand = os.path.join(cand_dir, "SKILL.md")
    if not os.path.exists(live) or not os.path.exists(cand):
        return False, "incumbent or candidate SKILL.md missing"
    inc_b = len(_frontmatter_body(live)[1].encode())
    cand_b = len(_frontmatter_body(cand)[1].encode())
    allowance = max(int(GROWTH_RATIO * inc_b), GROWTH_FLOOR_B)
    if cand_b > inc_b + allowance:
        return False, (f"body growth {inc_b} -> {cand_b} bytes (+{cand_b - inc_b}) "
                       f"exceeds allowance +{allowance} (max {GROWTH_RATIO:.0%}, floor {GROWTH_FLOOR_B}B)")
    return True, f"body growth {inc_b} -> {cand_b} bytes within allowance +{allowance}"


def gate_trigger(skill, cand_dir):
    """G7 (Hermes port): a changed description must carry trigger evidence."""
    live = live_skill_path(skill)
    cand = os.path.join(cand_dir, "SKILL.md")
    if not os.path.exists(live) or not os.path.exists(cand):
        return False, "incumbent or candidate SKILL.md missing"
    desc_c = _frontmatter_body(cand)[0].get("description", "")
    desc_i = _frontmatter_body(live)[0].get("description", "")
    if desc_c == desc_i:
        return True, "description unchanged — trigger surface untouched"
    if not os.path.exists(TRIGGER_LEDGER):
        return False, ("description changed but no trigger ledger exists "
                       f"({TRIGGER_LEDGER}) — run trigger_eval.py first")
    runs = [json.loads(l) for l in open(TRIGGER_LEDGER) if l.strip()]
    mine = [r for r in runs if r.get("variant") == os.path.basename(cand_dir.rstrip("/"))]
    if not mine:
        return False, ("description changed but no trigger run recorded for this "
                       "candidate — run trigger_eval.py --score --variant <candidate>")
    r = mine[-1]
    if not r.get("baseline_run"):
        return False, (f"trigger run {r.get('run_id')} recorded WITHOUT a baseline "
                       "comparison — its 'no regressions' is vacuous; re-score with "
                       "--baseline-run (or let trigger_eval auto-baseline)")
    regs = r.get("regressions") or []
    eff = r.get("effective", 0.0)
    if regs or eff < TRIGGER_MIN_ACC:
        return False, (f"trigger run {r.get('run_id')} vs baseline {r.get('baseline_run')}: "
                       f"effective {eff:.2f} < {TRIGGER_MIN_ACC} or regressions {regs} — "
                       "description change rejected")
    return True, (f"trigger run {r.get('run_id')} vs baseline {r.get('baseline_run')}: "
                  f"effective {eff:.2f}, no cross-skill regressions")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--skill", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--incumbent-variant", required=True)
    p.add_argument("--approved-by", default=None)
    a = p.parse_args()

    cand_dir = os.path.join(EVALS, a.skill, "candidates", a.candidate)
    gates = [
        ("G1 static", gate_static(a.skill, cand_dir)),
        ("G2 selftest", gate_selftest(a.skill)),
        ("G3 evidence", gate_evidence(a.skill, a.candidate, a.incumbent_variant)),
        ("G4 mutation-citation", gate_mutation(cand_dir)),
        ("G5 differs-from-incumbent", gate_differ(a.skill, cand_dir)),
        ("G6 growth-limit", gate_growth(a.skill, cand_dir)),
        ("G7 trigger-evidence", gate_trigger(a.skill, cand_dir)),
    ]
    all_ok = True
    for name, (ok, detail) in gates:
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")
        all_ok &= ok
    if not all_ok:
        sys.exit("PROMOTION BLOCKED — gates failed")
    if not a.approved_by:
        print("All gates green — dry-run only. Pass --approved-by <name> to install.")
        return

    skill_dir = os.path.join(PLUGIN_ROOT, "skills", a.skill)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    # Full-dir archive (true rollback) and full-dir install (bundled
    # references/scripts/assets survive promotion; MUTATION.md stays behind —
    # it is ledger metadata, not skill content).
    arch = os.path.join(PLUGIN_ROOT, "skills-archive", a.skill, ts)
    os.makedirs(arch, exist_ok=True)
    shutil.copytree(skill_dir, arch, dirs_exist_ok=True)
    for item in os.listdir(cand_dir):
        if item == "MUTATION.md":
            continue
        src = os.path.join(cand_dir, item)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(skill_dir, item), dirs_exist_ok=True)
        else:
            shutil.copy2(src, os.path.join(skill_dir, item))
    row = {"ts": ts, "skill": a.skill, "from_variant": a.incumbent_variant,
           "to_variant": a.candidate, "approved_by": a.approved_by,
           "evidence": [n for _, (ok, d) in gates if ok and isinstance(d, list) for n in d]}
    with open(os.path.join(EVALS, a.skill, "promotions.jsonl"), "a") as f:
        f.write(json.dumps(row) + "\n")
    print(f"PROMOTED {a.skill}: {a.incumbent_variant} -> {a.candidate} "
          f"(archived {arch}, approved_by {a.approved_by})")


if __name__ == "__main__":
    main()
