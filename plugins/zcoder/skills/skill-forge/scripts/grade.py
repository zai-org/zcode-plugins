#!/usr/bin/env python3
"""Deterministic grading + trials-ledger recorder for skill-forge. stdlib only.

Two modes:
  grade.py --record <evals-root> <skill> <scenario> <variant> <run> <rawfile> \
           [--tokens N] [--agent ID]
      Extract the subject payload (between OUTPUT_BEGIN/OUTPUT_END; strict —
      markers missing => protocol_fail verdict), write the artifact under
      artifacts/, run the scenario oracle, append one row to trials.jsonl.
      Duplicate rows (same scenario+variant+run+sha256) are skipped.
  grade.py --grade <artifact> <scenario-dir>
      One-off verdict via the scenario's oracle.

Grading consumes zero LLM tokens and is byte-deterministic on fixed artifacts
(validated 2026-09-03: three runs, identical sha256).
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone


def extract_payload(raw_text):
    if "OUTPUT_BEGIN" not in raw_text or "OUTPUT_END" not in raw_text:
        return None
    body = raw_text.split("OUTPUT_BEGIN", 1)[1]
    body = body.split("OUTPUT_END", 1)[0]
    body = body.strip("\n")
    # Deterministic fence stripping: subjects may wrap output in ``` fences
    # INSIDE the markers (observed live with PHP artifacts 2026-09-03). A
    # fenced JSON artifact would otherwise false-fail json parsing.
    lines = body.split("\n")
    if len(lines) >= 2 and lines[0].lstrip().startswith("```"):
        lines = lines[1:]
        if lines and lines[-1].lstrip().startswith("```"):
            lines = lines[:-1]
        body = "\n".join(lines).strip("\n")
    return body


def output_ext(scenario_dir):
    """Artifact extension is declared in task.md frontmatter (output_ext:)."""
    meta = {}
    task = os.path.join(scenario_dir, "task.md")
    if os.path.exists(task):
        text = open(task).read()
        m = re.match(r"^---\n(.*?)\n---", text, re.S)
        if m:
            for line in m.group(1).splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip()
    return meta.get("output_ext", "txt")


def run_oracle(scenario_dir, artifact):
    checker = os.path.join(scenario_dir, "oracle", "checker.py")
    r = subprocess.run([sys.executable, checker, artifact],
                       capture_output=True, text=True, timeout=60)
    m = re.search(r"VERDICT (pass|fail)", r.stdout)
    reason_m = re.search(r"REASON (.*)", r.stdout)
    if not m:
        return "fail", f"oracle produced no verdict: {r.stdout.strip()[:150]} {r.stderr.strip()[:150]}"
    verdict = m.group(1)
    # protocol_fail outranks oracle verdict: missing markers = no artifact
    reason = reason_m.group(1).strip() if reason_m else ""
    return verdict, reason


def cmd_record(a):
    evals_root = os.path.abspath(a.evals_root)
    skill_dir = os.path.join(evals_root, a.skill)
    scenario_dir = os.path.join(skill_dir, "scenarios", a.scenario)
    if not os.path.isdir(scenario_dir):
        sys.exit(f"no such scenario dir: {scenario_dir}")
    raw = open(a.rawfile).read()
    payload = extract_payload(raw)
    ext = output_ext(scenario_dir)
    art_name = f"{a.scenario}__{a.variant}__{a.run}.{ext}"
    art_dir = os.path.join(skill_dir, "artifacts")
    os.makedirs(art_dir, exist_ok=True)
    art = os.path.join(art_dir, art_name)
    if payload is None:
        verdict, reason = "fail", "protocol_fail: OUTPUT markers missing"
        open(art + ".protocolfail.txt", "w").write(raw)
    else:
        with open(art, "w") as f:
            f.write(payload + "\n")
        verdict, reason = run_oracle(scenario_dir, art)
    sha = hashlib.sha256(open(art if payload is not None else a.rawfile, "rb").read()).hexdigest()[:12]
    oracle_sha = hashlib.sha256(open(os.path.join(scenario_dir, "oracle", "checker.py"), "rb").read()).hexdigest()[:12]
    task_sha = hashlib.sha256(open(os.path.join(scenario_dir, "task.md"), "rb").read()).hexdigest()[:12]
    row = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "skill": a.skill, "scenario": a.scenario, "variant": a.variant,
           "run": a.run, "verdict": verdict, "reason": reason, "sha256": sha,
           "oracle": oracle_sha, "task": task_sha,
           "session": a.session or "unlabeled",
           "tokens": a.tokens, "agent": a.agent}
    ledger = os.path.join(skill_dir, "trials.jsonl")
    rows = [json.loads(l) for l in open(ledger) if l.strip()] if os.path.exists(ledger) else []
    dup = any(r["scenario"] == a.scenario and r["variant"] == a.variant
              and r["run"] == a.run and r["sha256"] == sha for r in rows)
    if dup:
        print("DUPLICATE trial (same scenario/variant/run/sha) — not recorded")
    else:
        rows.append(row)
        with open(ledger, "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    print(f"TRIAL {a.scenario} {a.variant} {a.run}: {verdict} — {reason[:120]}")
    print(f"ARTIFACT {art_name} sha256:{sha}")


def cmd_grade(a):
    verdict, reason = run_oracle(os.path.abspath(a.scenario_dir), a.artifact)
    print(f"VERDICT {verdict}")
    print(f"REASON {reason}")


def main():
    if "--record" in sys.argv:
        p = argparse.ArgumentParser()
        p.add_argument("--record", action="store_true")
        p.add_argument("evals_root")
        p.add_argument("skill")
        p.add_argument("scenario")
        p.add_argument("variant")
        p.add_argument("run")
        p.add_argument("rawfile")
        p.add_argument("--tokens", type=int, default=None)
        p.add_argument("--agent", default=None)
        p.add_argument("--session", default=None)
        cmd_record(p.parse_args())
    elif "--grade" in sys.argv:
        p = argparse.ArgumentParser()
        p.add_argument("--grade", action="store_true")
        p.add_argument("artifact")
        p.add_argument("scenario_dir")
        cmd_grade(p.parse_args())
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
