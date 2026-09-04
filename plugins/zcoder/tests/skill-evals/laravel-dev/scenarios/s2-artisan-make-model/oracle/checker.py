#!/usr/bin/env python3
"""Executable oracle for scenario s2-artisan-make-model. Deterministic.
Accepted: 'php artisan make:model <Name> (-a|--all)' with the flag before OR
after the model name (both are valid CLI orderings — the original
position-fixed set false-failed 'make:model -a Product'; audited 2026-09-03).
Self-test contract: reference_good passes, reference_bad fails."""
import re
import sys

PAT = re.compile(
    r"^php\s+artisan\s+make:model\s+(?P<name>[\w\\\\:]+)\s+(?P<flag>-a|--all)$"
    r"|^php\s+artisan\s+make:model\s+(?P<flag2>-a|--all)\s+(?P<name2>[\w\\\\:]+)$"
)


def grade(path):
    flat = re.sub(r"\s+", " ", open(path, errors="replace").read().strip()).lower()
    m = PAT.match(flat)
    return bool(m), flat


if __name__ == "__main__":
    ok, got = grade(sys.argv[1])
    print(f"VERDICT {'pass' if ok else 'fail'}")
    print(f"REASON {'accepted make:model with -a/--all (any flag position)' if ok else 'not an accepted form: ' + got[:120]}")
    sys.exit(0 if ok else 1)
