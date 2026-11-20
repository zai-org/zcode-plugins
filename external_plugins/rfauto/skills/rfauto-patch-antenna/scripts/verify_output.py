"""Deterministic output verifier for the rfauto patch skill package.

Structural checks only — zero physics claims (rfauto rule 7: numbers come
from the rfauto kernel or the card files in references/, never from this
script or from model memory):

  1. every --json file parses as JSON and contains no non-finite floats
     (NaN/Infinity anywhere in the document);
  2. each --expect KEY=VALUE: KEY exists in the JSON, is a finite number,
     and abs(value - VALUE) <= --tol (default 1e-3).

Pass KEY/VALUE pairs only from rfauto kernel output or from the card files
in references/. Exit codes: 0 = all checks pass; 1 = any check fails.
Report FAIL as FAIL (rfauto rule #122); never retry a FAIL into green.
"""
from __future__ import annotations

import argparse
import json
import math
import sys


def _non_finite_paths(node, prefix="$"):
    bad = []
    if isinstance(node, float) and not math.isfinite(node):
        bad.append(prefix)
    elif isinstance(node, dict):
        for key, value in node.items():
            bad += _non_finite_paths(value, prefix + "." + str(key))
    elif isinstance(node, list):
        for i, value in enumerate(node):
            bad += _non_finite_paths(value, prefix + "[" + str(i) + "]")
    return bad


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Structural verifier for saved rfauto JSON output.")
    parser.add_argument("--json", action="append", required=True,
                        help="saved rfauto kernel JSON (repeatable)")
    parser.add_argument("--expect", action="append", default=[],
                        help="KEY=VALUE numeric cross-check (repeatable)")
    parser.add_argument("--tol", type=float, default=1e-3)
    args = parser.parse_args(argv)

    failures = []
    for path in args.json:
        try:
            with open(path, encoding="utf-8") as handle:
                raw = handle.read()
        except OSError as exc:
            failures.append(path + ": unreadable (" + str(exc) + ")")
            continue
        try:
            data = json.loads(raw)
        except ValueError as exc:
            failures.append(path + ": not JSON (" + str(exc) + ")")
            continue
        for where in _non_finite_paths(data):
            failures.append(path + ": non-finite float at " + where)
        if not isinstance(data, dict):
            failures.append(path + ": top-level JSON is not an object")
            continue
        for spec in args.expect:
            key, sep, value = spec.partition("=")
            if not sep:
                failures.append(
                    path + ": bad --expect " + repr(spec) + " (want KEY=VALUE)")
                continue
            if key not in data:
                failures.append(path + ": missing key " + repr(key))
                continue
            try:
                got = float(data[key])
            except (TypeError, ValueError):
                failures.append(path + ": key " + repr(key) + " not numeric")
                continue
            if not math.isfinite(got):
                failures.append(path + ": key " + repr(key) + " non-finite")
                continue
            want = float(value)
            if abs(got - want) > args.tol:
                failures.append(
                    path + ": " + key + "=" + repr(got) + " vs expected "
                    + repr(want) + " (tol " + repr(args.tol) + ")")
    if failures:
        for line in failures:
            print("FAIL " + line)
        return 1
    print("PASS " + str(len(args.json)) + " file(s), "
          + str(len(args.expect)) + " expectation(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
