"""Minimal KiCad s-expression parser.

``parse("(a (b \"c d\") e)")`` -> ``[["a", ["b", "c d"], "e"]]`` ... (top level returns the first expression).
Atoms and quoted strings are both returned as ``str``. Helpers navigate nodes by head symbol.
"""
from __future__ import annotations

import re
from typing import Iterator

_TOKEN = re.compile(r'\(|\)|"((?:[^"\\]|\\.)*)"|[^\s()"]+')
_UNESC = re.compile(r"\\(.)")


def _unescape(s: str) -> str:
    if "\\" not in s:
        return s
    return _UNESC.sub(lambda m: "\n" if m.group(1) == "n" else m.group(1), s)


def parse(text: str) -> list:
    """Parse ``text`` and return the first top-level expression as nested lists."""
    stack: list[list] = [[]]
    for m in _TOKEN.finditer(text):
        t = m.group(0)
        if t == "(":
            new: list = []
            stack[-1].append(new)
            stack.append(new)
        elif t == ")":
            if len(stack) > 1:
                stack.pop()
        elif t[0] == '"':
            stack[-1].append(_unescape(m.group(1)))
        else:
            stack[-1].append(t)
    top = stack[0]
    return top[0] if top else []


def children(node: list, head: str) -> Iterator[list]:
    for c in node:
        if isinstance(c, list) and c and c[0] == head:
            yield c


def find(node: list, head: str) -> list | None:
    for c in children(node, head):
        return c
    return None


def value(node: list, head: str, default=None):
    """First scalar after ``(head ...)`` among direct children."""
    c = find(node, head)
    if c is None or len(c) < 2:
        return default
    return c[1]


def numbers(node: list | None, start: int = 1) -> list[float]:
    if not node:
        return []
    out = []
    for v in node[start:]:
        if isinstance(v, str):
            try:
                out.append(float(v))
            except ValueError:
                break
    return out


def flag(node: list, head: str) -> bool:
    """True for ``(head)``/``(head yes)``; False for ``(head no)`` or absent. Also handles a bare ``head`` atom."""
    for c in node:
        if isinstance(c, list) and c and c[0] == head:
            return len(c) < 2 or c[1] not in ("no", "false")
        if isinstance(c, str) and c == head:
            return True
    return False
