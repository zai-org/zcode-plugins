#!/usr/bin/env python3
"""Preview and apply repository secrets from a constrained dotenv file.

The preview and apply paths intentionally share one parser so the confirmed
secret-name set cannot differ from the set submitted to GitHub.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import stat
import subprocess
import sys
from pathlib import Path


KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


class DotenvError(ValueError):
    pass


def content_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def read_regular_file(path_text: str) -> tuple[Path, str]:
    path = Path(path_text)
    try:
        if path.is_symlink():
            raise DotenvError("secret file must not be a symbolic link")
    except OSError as exc:
        raise DotenvError(f"cannot inspect secret file safely: {exc}") from exc

    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise DotenvError(f"cannot open secret file safely: {exc}") from exc

    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise DotenvError("secret file must be a regular file")
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
            descriptor = -1
            return path.resolve(strict=True), handle.read()
    except (OSError, UnicodeError) as exc:
        raise DotenvError(f"cannot read secret file as UTF-8: {exc}") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def split_unquoted_value(raw: str) -> str:
    for index, char in enumerate(raw):
        if char == "#" and index > 0 and raw[index - 1].isspace():
            return raw[:index].rstrip()
    return raw.rstrip()


def parse_quoted_value(raw: str, quote: str, line_number: int) -> str:
    escaped = False
    chars: list[str] = []
    closing_index = None
    for index, char in enumerate(raw[1:], start=1):
        if quote == '"' and escaped:
            escapes = {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", '"': '"'}
            chars.append(escapes.get(char, char))
            escaped = False
            continue
        if quote == '"' and char == "\\":
            escaped = True
            continue
        if char == quote:
            closing_index = index
            break
        chars.append(char)

    if escaped or closing_index is None:
        raise DotenvError(
            f"line {line_number}: multiline or unterminated quoted values are not supported"
        )

    trailing = raw[closing_index + 1 :].strip()
    if trailing and not trailing.startswith("#"):
        raise DotenvError(f"line {line_number}: unexpected text after quoted value")
    return "".join(chars)


def parse_dotenv(text: str) -> list[tuple[str, str]]:
    entries: list[tuple[str, str]] = []
    # GitHub stores secret names as uppercase and treats lookups as
    # case-insensitive. Track that canonical form so a dotenv file cannot
    # submit the same remote secret twice under differently-cased names.
    seen: set[str] = set()

    for line_number, source_line in enumerate(text.splitlines(), start=1):
        line = source_line.lstrip("\ufeff") if line_number == 1 else source_line
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        candidate = line.lstrip()
        if candidate.startswith("export "):
            candidate = candidate[7:].lstrip()
        if "=" not in candidate:
            raise DotenvError(f"line {line_number}: expected KEY=VALUE")

        key_text, raw_value = candidate.split("=", 1)
        key = key_text.strip()
        if KEY.fullmatch(key) is None:
            raise DotenvError(f"line {line_number}: invalid secret name")
        if key.upper().startswith("GITHUB_"):
            raise DotenvError(f"line {line_number}: GITHUB_ names are reserved")
        canonical_key = key.upper()
        if canonical_key in seen:
            raise DotenvError(f"line {line_number}: duplicate secret name {key}")

        raw_value = raw_value.lstrip()
        if raw_value.startswith(("'", '"')):
            value = parse_quoted_value(raw_value, raw_value[0], line_number)
        else:
            value = split_unquoted_value(raw_value)

        entries.append((key, value))
        seen.add(canonical_key)

    if not entries:
        raise DotenvError("secret file contains no KEY=VALUE entries")
    return entries


def preview(entries: list[tuple[str, str]]) -> None:
    for name, _value in entries:
        print(name)


def apply(entries: list[tuple[str, str]], repo: str) -> None:
    environment = os.environ.copy()
    environment["GH_PROMPT_DISABLED"] = "1"

    for name, value in entries:
        command = ["gh", "secret", "set", name]
        command.extend(["--repo", repo])
        subprocess.run(
            command,
            input=value,
            text=True,
            env=environment,
            check=True,
        )
        print(f"SET {name}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="action", required=True)

    for action in ("preview", "apply"):
        command = subparsers.add_parser(action)
        command.add_argument("--file", required=True)
        if action == "apply":
            command.add_argument("--repo", required=True)
            command.add_argument("--expect-sha256", required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        path, text = read_regular_file(args.file)
        entries = parse_dotenv(text)
        digest = content_sha256(text)
        if args.action == "preview":
            preview(entries)
            print(f"SHA256 {digest}", file=sys.stderr)
        else:
            if digest != args.expect_sha256:
                raise DotenvError(
                    "secret file changed after preview; preview and confirm it again"
                )
            apply(entries, args.repo)
    except DotenvError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    except subprocess.CalledProcessError as exc:
        print(
            f"Error: gh secret set failed with exit code {exc.returncode}",
            file=sys.stderr,
        )
        return exc.returncode or 1

    print(
        f"{args.action.capitalize()} complete for {len(entries)} secret(s) from {path}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
