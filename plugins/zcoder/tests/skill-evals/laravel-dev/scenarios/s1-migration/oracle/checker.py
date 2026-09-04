#!/usr/bin/env python3
"""Executable oracle for scenario s1-migration. Deterministic, stdlib only.
Usage: checker.py <artifact.php>
Prints 'VERDICT pass|fail' + per-check 'REASON ...' lines. Exit 0 iff pass.

Deterministic rules: text is lowercased and whitespace-collapsed (PHP method
calls are case-insensitive, so this is semantics-preserving); each convention
is a fixed regex. Modifier chains are checked for presence, not adjacency
(documented rule — adjacency would false-fail valid reorderings).
"""
import re
import sys

CHECKS = [
    ("schema::create('products'", r"schema::create\(\s*['\"]products['\"]"),
    ("->id()", r"->id\(\)"),
    ("string sku unique", r"->string\(\s*['\"]sku['\"]\s*\)\s*->unique\(\)"),
    ("string name", r"->string\(\s*['\"]name['\"]"),
    ("text/longtext description nullable",
     r"->(long)?text\(\s*['\"]description['\"]\s*\)\s*->nullable\(\)"),
    ("decimal price 8,2", r"->decimal\(\s*['\"]price['\"]\s*,\s*8\s*,\s*2\s*\)"),
    ("price unsigned", r"->unsigned\(\)"),
    ("price default 0.00", r"->default\(\s*0(\.0+)?\s*\)"),
    ("integer stock default 0", r"->integer\(\s*['\"]stock['\"]"),
    ("boolean active default true", r"->boolean\(\s*['\"]active['\"]"),
    ("default true", r"->default\(\s*true\s*\)"),
    ("foreignid user_id constrained cascadeondelete",
     r"->foreignid\(\s*['\"]user_id['\"]\s*\)\s*->constrained\(\)\s*->cascadeondelete\(\)"),
    ("->timestamps()", r"->timestamps\(\)"),
    ("down: dropifexists products", r"schema::dropifexists\(\s*['\"]products['\"]"),
]


def grade(path):
    text = open(path, errors="replace").read().lower()
    flat = re.sub(r"\s+", " ", text)
    failed = [name for name, pat in CHECKS if not re.search(pat, flat)]
    return (not failed), failed


if __name__ == "__main__":
    ok, failed = grade(sys.argv[1])
    print(f"VERDICT {'pass' if ok else 'fail'}")
    if failed:
        print("REASON failed checks: " + "; ".join(failed))
    else:
        print("REASON all 14 convention checks matched")
    sys.exit(0 if ok else 1)
