#!/usr/bin/env python3
"""Executable oracle for scenario s1-yaml-to-json. Deterministic, stdlib only.
Usage: checker.py <artifact.json>
Prints 'VERDICT pass|fail' and 'REASON ...'. Exit 0 iff pass.
Self-test contract: reference_good.json must PASS, reference_bad.json must FAIL."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EXPECTED = os.path.join(HERE, "expected.json")


def type_strict_equal(a, b, path, diffs, limit=5):
    """Deep equality distinguishing bool/int and int/float (Python == treats
    True==1 and 3==3.0 as equal; JSON semantics require type awareness)."""
    if len(diffs) >= limit:
        return
    if type(a) is not type(b):
        diffs.append(f"{path or '<root>'}: type {type(a).__name__} != {type(b).__name__}")
        return
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b), key=str):
            if k not in a:
                diffs.append(f"{path}.{k}: missing in subject")
            elif k not in b:
                diffs.append(f"{path}.{k}: extra in subject")
            else:
                type_strict_equal(a[k], b[k], f"{path}.{k}", diffs, limit)
    elif isinstance(a, list):
        if len(a) != len(b):
            diffs.append(f"{path}: list len {len(a)} != {len(b)}")
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                type_strict_equal(x, y, f"{path}[{i}]", diffs, limit)
    elif a != b:
        diffs.append(f"{path}: {a!r} != {b!r}")


def grade(path):
    with open(EXPECTED) as f:
        expected = json.load(f)
    try:
        got = json.load(open(path))
    except Exception as e:
        return "fail", f"json parse error: {e}"
    diffs = []
    type_strict_equal(got, expected, "", diffs)
    if diffs:
        return "fail", "; ".join(diffs)
    return "pass", "exact type-strict match"


if __name__ == "__main__":
    verdict, reason = grade(sys.argv[1])
    print(f"VERDICT {verdict}")
    print(f"REASON {reason}")
    sys.exit(0 if verdict == "pass" else 1)
