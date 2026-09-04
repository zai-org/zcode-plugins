#!/usr/bin/env python3
"""Validate the validators. For every scenario under a skill's eval dir,
reference_good* MUST pass and reference_bad* MUST fail. Exit 1 on any
violation. This gate exists because an unvalidated oracle is an assumption:
on 2026-09-03 the self-test caught a checker that counted silent False as a
pass — every wrong answer would have graded as correct.

Usage: oracle_selftest.py <skill-eval-dir>   (e.g. tests/skill-evals/yaml-json-convert)
"""
import glob
import os
import subprocess
import sys


def verdict_of(scenario_dir, artifact):
    checker = os.path.join(scenario_dir, "oracle", "checker.py")
    r = subprocess.run([sys.executable, checker, artifact],
                       capture_output=True, text=True, timeout=60)
    out = r.stdout
    if "VERDICT pass" in out:
        return "pass"
    if "VERDICT fail" in out:
        return "fail"
    return "broken"


def main():
    root = sys.argv[1]
    scenarios = sorted(glob.glob(os.path.join(root, "scenarios", "*")))
    if not scenarios:
        sys.exit(f"no scenarios under {root}")
    bad = 0
    for sc in scenarios:
        name = os.path.basename(sc)
        goods = sorted(glob.glob(os.path.join(sc, "oracle", "reference_good.*")))
        bads = sorted(glob.glob(os.path.join(sc, "oracle", "reference_bad.*")))
        if not goods or not bads:
            print(f"FAIL {name}: missing reference_good/reference_bad")
            bad += 1
            continue
        for g in goods:
            v = verdict_of(sc, g)
            if v != "pass":
                print(f"FAIL {name}: reference_good {os.path.basename(g)} -> {v} (must pass)")
                bad += 1
            else:
                print(f"PASS {name}: reference_good passes")
        for b in bads:
            v = verdict_of(sc, b)
            if v != "fail":
                print(f"FAIL {name}: reference_bad {os.path.basename(b)} -> {v} (must fail)")
                bad += 1
            else:
                print(f"PASS {name}: reference_bad fails")
    if bad:
        sys.exit(f"ORACLE SELF-TEST FAILED ({bad} violations)")
    print("ORACLE SELF-TEST GREEN")


if __name__ == "__main__":
    main()
