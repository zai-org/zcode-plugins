#!/usr/bin/env python3
"""Upsert a literature note record into a JSONL file, keyed by item_key.

Keeps `literature.jsonl` idempotent: re-reading the same paper updates that
paper's line instead of appending a duplicate.

Usage:
    echo '{"item_key":"ABC123",...}' | python upsert_note.py literature.jsonl
    python upsert_note.py literature.jsonl --json '{"item_key":"ABC123",...}'
    python upsert_note.py literature.jsonl --file record.json

The record must contain an `item_key` string field (the Zotero item key),
which is used as the primary key for deduplication. A `updated_at` ISO-8601
timestamp is added automatically if missing.
"""
import argparse
import json
import sys
from datetime import datetime
from pathlib import Path


def upsert(jsonl_path: Path, record: dict) -> tuple[str, bool]:
    """Insert or replace the record matching record['item_key'].

    Returns (item_key, was_new). Exits with an error message on bad input.
    """
    key = record.get("item_key")
    if not key or not isinstance(key, str):
        sys.exit("ERROR: record missing required string field 'item_key'")

    records: list[dict] = []
    was_new = True

    if jsonl_path.exists():
        for i, raw in enumerate(
            jsonl_path.read_text(encoding="utf-8").splitlines(), 1
        ):
            line = raw.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as e:
                sys.exit(
                    f"ERROR: invalid JSON on line {i} of {jsonl_path}: {e}"
                )
            if rec.get("item_key") == key:
                was_new = False  # drop old copy; will be replaced below
                continue
            records.append(rec)

    record.setdefault(
        "updated_at",
        datetime.now().isoformat(timespec="seconds"),
    )
    records.append(record)

    jsonl_path.parent.mkdir(parents=True, exist_ok=True)
    with jsonl_path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    return key, was_new


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Upsert a literature note record into a JSONL file by item_key.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("jsonl_path", type=Path, help="path to the .jsonl file")
    src = ap.add_mutually_exclusive_group(required=False)
    src.add_argument("--json", help="JSON record string")
    src.add_argument("--file", type=Path, help="path to a .json record file")
    args = ap.parse_args()

    if args.json:
        try:
            record = json.loads(args.json)
        except json.JSONDecodeError as e:
            sys.exit(f"ERROR: invalid --json value: {e}")
    elif args.file:
        try:
            record = json.loads(args.file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            sys.exit(f"ERROR: invalid JSON in {args.file}: {e}")
    elif not sys.stdin.isatty():
        # Read a JSON record from a piped stdin: echo '...' | upsert_note.py f.jsonl
        try:
            record = json.loads(sys.stdin.read())
        except json.JSONDecodeError as e:
            sys.exit(f"ERROR: invalid JSON on stdin: {e}")
    else:
        ap.error("provide a record via --json, --file, or piped stdin")

    key, was_new = upsert(args.jsonl_path, record)
    action = "Added" if was_new else "Updated"
    total = sum(
        1
        for _ in args.jsonl_path.read_text(encoding="utf-8").splitlines()
        if _.strip()
    )
    print(f"{action} item_key={key} in {args.jsonl_path} (now {total} records)")


if __name__ == "__main__":
    main()
