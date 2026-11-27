#!/usr/bin/env python3
"""Fail-loud preflight for a delivery-video screen_demo build directory.

Usage: preflight.py <build-dir>

Reports the same episode validation render.py enforces: structure, recordings,
intervals, crops, browser recording evidence, TTS cache contracts and narration
lints. This script additionally holds the build-directory naming convention.
FAIL means fix the material, not the thresholds.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import argparse

from dv_core import BUILD_NAME
from dv_episode import validate


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build", type=Path, help="screen_demo[-<slug>] build directory")
    args = parser.parse_args()

    build_path = args.build.expanduser()
    report = validate(build_path.resolve())
    if build_path.is_dir() and not BUILD_NAME.fullmatch(build_path.name):
        report.errors.append(
            f"build directory {build_path.name!r} is rejected by preflight "
            "(render.py itself accepts any directory name); "
            "use screen_demo or screen_demo-<slug>"
        )
    for note in report.notes:
        print(f"OK {note}")
    for warning in report.warnings:
        print(f"WARN: {warning}")
    if report.errors:
        for error in report.errors:
            print(f"FAIL: {error}")
        print(f"PREFLIGHT=FAIL issues={len(report.errors)}")
        return 1
    print(f"PREFLIGHT=PASS warnings={len(report.warnings)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
