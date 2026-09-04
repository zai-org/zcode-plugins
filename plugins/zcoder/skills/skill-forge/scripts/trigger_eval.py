#!/usr/bin/env python3
"""Trigger-surface evaluation for skill-forge. stdlib only.

Hermes port (Phase 2, tool-description evolution, MIT): in hermes, tool
descriptions are evolved and evaluated by whether the agent PICKS THE RIGHT
TOOL — a classification problem — with the cross-tool rule that improving one
description must not steal selections from another. A ZCode skill's
description is exactly that surface: it is what the router matches a request
against. So description changes are evolution of trigger behavior and get
their own eval, separate from task oracles:

  trigger-cases.jsonl   golden routing set: {id, utterance, expected, note}
                        where expected = a skill name or "none".
                        Expected verdicts are PRE-REGISTERED (committed) before
                        any dispatch — the run is scored against the frozen
                        table, never the reverse.
  trigger-evals.jsonl   run ledger written by --score; one row per router
                        probe. promote.py G7 reads it: a candidate that
                        changes the description must have a recorded run with
                        effective accuracy >= 0.75 and NO cross-skill
                        regressions.

The router probe itself needs a fresh LLM subject (metadata-only view: the
subject sees skill name+description frontmatter, never skill bodies, never
this script) — dispatch protocol lives in commands/skill-evolve.md. Scoring
consumes zero tokens and is byte-deterministic on fixed answers.

Usage:
  trigger_eval.py --check [cases.jsonl]        validate + print registration sha
  trigger_eval.py --score <answers.txt> --cases <f> --run-id <id> --variant <id>
                  [--agent A] [--tokens N] [--baseline-run <id>]
                  [--ok <case-id>]... [--bad <case-id>]... [--note "..."]
                  [--skill-meta <dir>]         (default: skills/ — for --check)
  trigger_eval.py --show
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
# SKILL_FORGE_EVALS / SKILL_FORGE_SKILLS let the smoke suite point this tool
# at /tmp fixtures; unset in production the paths are the plugin's real ones.
EVALS = os.environ.get("SKILL_FORGE_EVALS") or os.path.join(PLUGIN_ROOT, "tests", "skill-evals")
CASES = os.path.join(EVALS, "trigger-cases.jsonl")
LEDGER = os.path.join(EVALS, "trigger-evals.jsonl")
SKILLS_DIR = os.environ.get("SKILL_FORGE_SKILLS") or os.path.join(PLUGIN_ROOT, "skills")
TRIGGER_MIN_ACC = 0.75


def installed_skills():
    """Valid routing targets: frontmatter name of every skills/*/SKILL.md."""
    names = set()
    if os.path.isdir(SKILLS_DIR):
        for sk in sorted(os.listdir(SKILLS_DIR)):
            p = os.path.join(SKILLS_DIR, sk, "SKILL.md")
            if not os.path.exists(p):
                continue
            m = re.match(r"^---\n(.*?)\n---", open(p).read(), re.S)
            name = sk
            if m:
                for line in m.group(1).splitlines():
                    if line.strip().startswith("name:"):
                        name = line.split(":", 1)[1].strip().strip("'\"")
            names.add(name)
    return names


def cases_sha(path):
    """Pre-registration hash: content of the frozen expected table."""
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:12]


def check(path):
    rows = [json.loads(l) for l in open(path) if l.strip()]
    skills = installed_skills()
    problems = []
    seen = set()
    for r in rows:
        cid = r.get("id", "")
        if not cid:
            problems.append("row missing id")
        if cid in seen:
            problems.append(f"{cid}: duplicate id")
        seen.add(cid)
        if not r.get("utterance", "").strip():
            problems.append(f"{cid}: empty utterance")
        exp = r.get("expected", "")
        if exp != "none" and exp not in skills:
            problems.append(f"{cid}: expected {exp!r} is not an installed skill or 'none'")
        if not r.get("note", "").strip():
            problems.append(f"{cid}: missing note (each case must say why it expects what it expects)")
    dist = {}
    for r in rows:
        dist[r["expected"]] = dist.get(r["expected"], 0) + 1
    if problems:
        for p in problems:
            print(f"PROBLEM {p}")
        sys.exit(f"TRIGGER CASES INVALID: {len(problems)} problem(s)")
    print(f"TRIGGER CASES OK: {len(rows)} cases over targets {sorted(dist)}")
    print(f"PRE-REGISTRATION SHA {cases_sha(path)} — freeze this table BEFORE any dispatch")
    return 0


def parse_answers(path, rows):
    """Parse 'N: verdict' lines (1-based case order in the cases file).
    Tolerates trailing annotations like '(match)' or '— because ...'.
    Duplicate case numbers are a protocol violation, not a silent overwrite."""
    answers, seen = {}, set()
    for line in open(path):
        m = re.match(r"^\s*(\d+)\s*[:.]\s*([A-Za-z0-9_-]+)", line)
        if not m:
            continue
        n, verdict = int(m.group(1)), m.group(2)
        if not (1 <= n <= len(rows)):
            sys.exit(f"answer line out of range: {line.strip()!r} (1..{len(rows)})")
        cid = rows[n - 1]["id"]
        if n in seen:
            sys.exit(f"case {n} ({cid}) answered more than once — protocol violation")
        seen.add(n)
        answers[cid] = verdict
    return answers


def resolve_baseline(a_baseline, case_path):
    """Explicit --baseline-run wins; otherwise auto-baseline = the most recent
    prior run over the SAME cases table that is itself regression-free and at
    threshold (a regressed run is a broken reference — measuring against it
    would let a candidate pass by being less bad). G7 requires a baseline: a
    run without one cannot claim 'no regressions' (loophole closed 2026-09-04)."""
    runs = [json.loads(l) for l in open(LEDGER)] if os.path.exists(LEDGER) else []
    sha = cases_sha(case_path)
    if a_baseline:
        base = next((r for r in runs if r.get("run_id") == a_baseline), None)
        if not base:
            sys.exit(f"baseline run {a_baseline!r} not in {LEDGER}")
        return base, a_baseline
    clean = [r for r in runs
             if r.get("cases_sha") == sha
             and not (r.get("regressions") or [])
             and r.get("effective", 0.0) >= TRIGGER_MIN_ACC]
    return (clean[-1], clean[-1]["run_id"]) if clean else (None, None)


def per_skill_rates(rows, answers):
    """expected-skill -> [correct, total]; includes 'none' (unwanted-load check).
    Casefolded comparison — must match the verdict loop exactly (bug
    2026-09-04: raw equality here made case-variant answers count as fails in
    rates but passes in accuracy, silently neutralizing regression checks)."""
    rates = {}
    for r in rows:
        exp = r["expected"]
        got = answers.get(r["id"], "")
        k, n = rates.setdefault(exp, [0, 0])
        rates[exp][1] = n + 1
        rates[exp][0] = k + (1 if got.casefold() == exp.casefold() else 0)
    return rates


def cross_regressions(base_rates, new_rates):
    """Hermes cross-tool rule: no target's correct-selection rate may drop.
    A drop with evidence on both sides is a REGRESSION."""
    regs = []
    for t, (k2, n2) in sorted(new_rates.items()):
        if t not in base_rates:
            continue
        k1, n1 = base_rates[t]
        if n1 == 0 or n2 == 0:
            continue
        if k2 / n2 < k1 / n1:
            regs.append(f"{t}: {k1}/{n1} -> {k2}/{n2}")
    return regs


def score(a):
    case_path = a.cases or CASES
    rows = [json.loads(l) for l in open(case_path) if l.strip()]
    ids = [r["id"] for r in rows]
    if len(ids) != len(set(ids)):
        sys.exit("cases table has duplicate ids — run --check first")
    by_num = {i + 1: r["id"] for i, r in enumerate(rows)}
    answers = parse_answers(a.score, rows)
    if len(answers) < len(rows):
        missing = [cid for cid in (r["id"] for r in rows) if cid not in answers]
        sys.exit(f"subject answered {len(answers)}/{len(rows)} cases — unanswered: {missing}")

    adjudicate = {cid: True for cid in a.ok}
    adjudicate.update({cid: False for cid in a.bad})
    unknown = set(adjudicate) - set(ids)
    if unknown:
        sys.exit(f"--ok/--bad case ids not in cases file: {sorted(unknown)}")

    confusions, literal_ok, effective_ok = [], 0, 0
    for r in rows:
        got, exp = answers[r["id"]], r["expected"]
        match = got.casefold() == exp.casefold()
        literal_ok += match
        if r["id"] in adjudicate:
            match = adjudicate[r["id"]]
            confusions.append({"case": r["id"], "expected": exp, "got": got,
                               "adjudicated": match})
        else:
            if not match:
                confusions.append({"case": r["id"], "expected": exp, "got": got})
        effective_ok += match
    literal, effective = literal_ok / len(rows), effective_ok / len(rows)

    rates = per_skill_rates(rows, answers)
    base, base_id = resolve_baseline(a.baseline_run, case_path)
    regressions = []
    if base is None:
        print("NOTE: no clean prior run over this cases table — recorded WITHOUT a "
              "baseline; a later G7 promotion needs a baseline-referenced run")
    else:
        if base.get("cases_sha") != cases_sha(case_path):
            print("WARNING: baseline run used a DIFFERENT cases table — "
                  "per-skill regression check skipped (rates not comparable)")
        else:
            regressions = cross_regressions(base.get("per_skill", {}), rates)

    row = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "run_id": a.run_id, "variant": a.variant,
           "cases_sha": cases_sha(case_path), "cases": len(rows),
           "answers": answers, "literal": round(literal, 4),
           "effective": round(effective, 4),
           "baseline_run": base_id,
           "confusions": confusions, "per_skill": rates,
           "regressions": regressions,
           "threshold": TRIGGER_MIN_ACC,
           "agent": a.agent, "tokens": a.tokens, "note": a.note or ""}
    os.makedirs(EVALS, exist_ok=True)
    with open(LEDGER, "a") as f:
        f.write(json.dumps(row) + "\n")

    for r in rows:
        got, exp = answers[r["id"]], r["expected"]
        mark = "match" if got.casefold() == exp.casefold() else ("divergence, adjudicated correct" if adjudicate.get(r["id"]) else "MISMATCH")
        print(f"{r['id']}: {got:<24} expected {exp:<24} [{mark}]")
    print(f"LITERAL {literal_ok}/{len(rows)}  EFFECTIVE {effective_ok}/{len(rows)} ({effective:.2f}, gate >= {TRIGGER_MIN_ACC})")
    if confusions:
        print(f"confusions: {[(c['case'], c['expected'], c['got']) for c in confusions]}")
    if base_id:
        print(f"baseline: {base_id}")
    if regressions:
        print(f"REGRESSIONS vs {base_id}: {regressions} — G7 will reject promotion on this run")
    else:
        print(f"no cross-skill regressions{' vs ' + base_id if base_id else ''}")
    print(f"RECORDED run {a.run_id} (variant {a.variant}) -> {LEDGER}")


def show():
    if not os.path.exists(LEDGER):
        sys.exit(f"no trigger ledger at {LEDGER}")
    runs = [json.loads(l) for l in open(LEDGER) if l.strip()]
    print(f"trigger ledger: {len(runs)} runs")
    for r in runs:
        regs = f"  REGRESSIONS {r['regressions']}" if r.get("regressions") else ""
        print(f"  {r['run_id']:<28} variant={r.get('variant', '?'):<28} "
              f"literal {r['literal']:.2f}  effective {r['effective']:.2f}{regs}")


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    p.add_argument("--check", nargs="?", const=CASES, metavar="CASES")
    p.add_argument("--score", metavar="ANSWERS")
    p.add_argument("--cases", default=None)
    p.add_argument("--run-id", required=False)
    p.add_argument("--variant", default=None, help="candidate id this run evidences (G7)")
    p.add_argument("--agent", default=None)
    p.add_argument("--tokens", type=int, default=None)
    p.add_argument("--baseline-run", default=None)
    p.add_argument("--ok", action="append", default=[], help="case adjudicated as correct despite divergence")
    p.add_argument("--bad", action="append", default=[], help="case adjudicated as wrong despite literal match")
    p.add_argument("--note", default="")
    p.add_argument("--show", action="store_true")
    a = p.parse_args()

    if a.show:
        show()
    elif a.check:
        check(a.check)
    elif a.score:
        for req in ("--run-id", "--variant"):
            if getattr(a, req.strip("--").replace("-", "_")) is None:
                sys.exit(f"--score requires {req} (runs must name their variant for G7)")
        score(a)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
