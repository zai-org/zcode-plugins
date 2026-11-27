#!/usr/bin/env python3
"""CLI for deterministic Baton assignment verification receipts."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from orchestration.receipt import ReceiptError, seal_receipt, verify_packet  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="baton-receipt")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("verify", "seal"):
        command = sub.add_parser(name)
        command.add_argument("--packet", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = (
            verify_packet(args.packet)
            if args.command == "verify"
            else seal_receipt(args.packet).to_dict()
        )
    except ReceiptError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
