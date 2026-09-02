"""Chinese line breaking: 避头尾, and a `[标签]` that cannot be cut in half.

reportlab's ``wordWrap='CJK'`` cuts "like a knife" between characters, and its one
concession to typography is a **Japanese** prohibition set. Two consequences, both
of which shipped:

* **A provenance chip split across a line break.** ``cjkFragSplit`` consults
  ``ALL_CANNOT_START`` and never ``ALL_CANNOT_END`` — ``[`` is in the latter, which
  the module imports and does not use. So a line ended ``…固定汇率+4%[`` and the next
  opened ``披露]``. Six of these in one 12-page 业绩点评 (pages 2, 3, 5). The same
  cut lands in a citation marker: ``[12]`` broken as ``[1`` / ``2]`` reads as a
  different source, and nothing downstream can tell.
* **Chinese punctuation at the head of a line.** ``，；：！？…`` are absent from
  reportlab's set (Japanese uses ``、。``, which are present), so they are pushed to
  the next line and open it. And because the hang rule fires for **one** character
  only — "we won't do two or more though", says the source — a chained closer such
  as ``）。`` hangs the bracket and leaves the full stop alone on a line of its own.
  Measured on that report's own body prose: **27 such defects in 146 lines.**

So the rule here is one rule, with no exceptions: **a break is legal unless it
would open a line with a character that cannot start one, close a line with a
character that cannot end one, or fall inside a bracketed group.** Illegal
candidates walk backwards until one is legal.

This deliberately **drops reportlab's hanging punctuation**. Hanging one closer in
the right margin is respectable Chinese setting and costs no lines, but it only
works for a run of one — and the run of two is where the ugliest defect was. One
rule that always holds beats two rules with a seam. The cost, measured by reflowing
that report's own body prose: 146 lines becomes 147, page count unchanged. On a
synthetic sweep of 184 short paragraphs written to land breaks in the worst place
(``selftest.break_sweep``) all four defect classes go to zero, 304 lines become
308, and the page count is unchanged.

reportlab's back-scan for a Latin word inside CJK text is **kept verbatim**. It is
the reason ``Non-IFRS`` does not print as ``Non-IF`` / ``RS``, and it runs before
this module's walk, whose result it then constrains.

Both code paths need patching, which is not obvious from either name:
``Paragraph.breakLinesCJK`` sends a single-fragment paragraph — plain prose, no
chips — to ``wordSplit``, and only a multi-fragment one to ``cjkFragSplit``. Fixing
one leaves half the document unfixed, and which half depends on whether the author
happened to tag a figure in that paragraph.

Patching another package's internals is a real cost, taken because there is no
seam: the prohibition sets are module-level string constants and the algorithm is
inline in two functions. So the patch is **guarded** — if the internals it needs
are not importable, it warns and leaves reportlab alone rather than failing the
build. A document set slightly worse than intended beats no document.
"""
from __future__ import annotations

import re
import warnings

#: Characters that may not open a line. reportlab's Japanese set, plus the Chinese
#: punctuation it omits. Kept as the union rather than a replacement so a value
#: reportlab adds later is inherited instead of dropped.
CHINESE_CANNOT_START = "，；：！？…、。”’》〉」』】）］％%‰℃·〕"
#: Characters that may not close a line — an opening bracket or quote left dangling
#: at the right margin, with its content on the next line. reportlab defines this
#: set (``ALL_CANNOT_END``) and never consults it.
CHINESE_CANNOT_END = "（〔【「『《〈“‘［[〒＄＠｛{£¥#$@"
#: A bracketed group that must survive as one unit: a provenance chip (``[披露]``),
#: a citation marker (``[12]``), or the full-width form of either. The length bound
#: is what keeps this from matching a bracketed *clause* — those may break, and
#: forbidding it would leave nowhere legal to break at all.
MAX_GROUP_LEN = 8
_OPENERS = "[［"
_CLOSERS = "]］"
#: How far back the walk may look for a legal break before giving up and taking
#: reportlab's original decision. A chip (4) preceded by a closer run (`」）。`, 3)
#: is the realistic worst case; 10 clears it with room, and the bound is what
#: guarantees the walk cannot empty a line and hang the frame.
MAX_BACKTRACK = 10

_INSTALLED = False


def cannot_start(char: str, base: str) -> bool:
    return bool(char) and (char in base or char in CHINESE_CANNOT_START)


def cannot_end(char: str) -> bool:
    return bool(char) and char in CHINESE_CANNOT_END


def group_interior(units: list[str]) -> set[int]:
    """Indices a break may not fall on because they sit inside a bracketed group.

    Scans the **unit list**, not a joined string. reportlab appends a unit whose
    text is empty for a fragment carrying no characters, so unit indices and
    string offsets drift apart, and a set computed on the joined text would
    protect the wrong positions in exactly the documents that have chips in them.

    An index in the returned set is one whose character must stay on the same line
    as the ``[`` before it — the group's content and its closing bracket. The
    opening bracket itself is a legal break point: ``[披露]`` moving to the next
    line whole is the correct outcome.
    """
    interior: set[int] = set()
    opened: int | None = None
    length = 0
    for index, char in enumerate(units):
        if char in _OPENERS:
            opened, length = index, 0
            continue
        if opened is None:
            continue
        if char in _CLOSERS:
            interior.update(range(opened + 1, index + 1))
            opened = None
            continue
        length += 1
        if length > MAX_GROUP_LEN or char == "\n":
            opened = None
    return interior


def _illegal(units: list[str], interior: set[int], index: int, base: str) -> bool:
    """Whether a line break *before* ``units[index]`` is forbidden."""
    if index <= 0 or index >= len(units):
        return False
    return (index in interior
            or cannot_start(units[index], base)
            or cannot_end(units[index - 1]))


def _walk_back(units: list[str], interior: set[int], index: int, floor: int,
               base: str) -> int:
    """The nearest legal break at or before ``index``, or ``index`` unchanged.

    ``floor`` is ``lineStartPos + 1``: a break at or below it would emit an empty
    line, and reportlab then loops rather than progressing. Returning the original
    index on failure is the whole fallback story — a document with reportlab's
    break is the status quo, and the status quo is not a hang.
    """
    candidate = index
    for _ in range(MAX_BACKTRACK):
        if not _illegal(units, interior, candidate, base):
            return candidate
        if candidate <= floor:
            break
        candidate -= 1
    return candidate if not _illegal(units, interior, candidate, base) else index


def install() -> bool:
    """Replace reportlab's two CJK line-breakers. Idempotent; returns success.

    Patches the names as ``reportlab.platypus.paragraph`` resolves them, because
    that is where ``breakLinesCJK`` looks them up — rebinding
    ``reportlab.lib.textsplit.wordSplit`` would leave the paragraph module holding
    its own reference to the original.
    """
    global _INSTALLED
    if _INSTALLED:
        return True
    try:
        from reportlab.platypus import paragraph as _para
        from reportlab.platypus.paragraph import (
            ParaLines, cjkU, makeCJKParaLine)
        from reportlab.lib.textsplit import getCharWidths
        from reportlab.lib.utils import isBytes, isUnicode
        from reportlab.rl_config import _FUZZ
        from unicodedata import category
    except ImportError as exc:  # noqa: BLE001 — a changed internal must not fail a build
        warnings.warn(
            f"fin_report.cjk: reportlab internals unavailable ({exc}) — leaving its "
            "CJK line breaker in place. Provenance chips and [n] markers may split "
            "across lines and Chinese punctuation may open a line.",
            stacklevel=2)
        return False

    base_cannot_start = _para.ALL_CANNOT_START

    def _resolved(width, max_width):
        """A unit's width, resolving reportlab's proportional-width objects."""
        if hasattr(width, "normalizedValue"):
            width._normalizer = max_width
            width = width.normalizedValue(max_width)
        return width

    def cjkFragSplit(frags, maxWidths, calcBounds, encoding="utf8"):
        """reportlab's multi-fragment CJK splitter, with legal breaks only."""
        U = []
        for frag in frags:
            text = frag.text
            if isBytes(text):
                text = text.decode(encoding)
            if text:
                U.extend([cjkU(char, frag, encoding) for char in text])
            else:
                U.append(cjkU(text, frag, encoding))
        units = [str(u) for u in U]
        interior = group_interior(units)

        lines = []
        i = widthUsed = lineStartPos = 0
        maxWidth = maxWidths[0]
        nU = len(U)
        while i < nU:
            u = U[i]
            i += 1
            w = _resolved(u.width, maxWidth)
            widthUsed += w
            lineBreak = hasattr(u.frag, "lineBreak")
            endLine = (widthUsed > maxWidth + _FUZZ and widthUsed > 0) or lineBreak
            if endLine:
                extraSpace = maxWidth - widthUsed
                if not lineBreak:
                    if ord(u) < 0x3000:
                        # reportlab's own back-scan, verbatim: a Latin word inside
                        # CJK text is broken at its start, not through its middle.
                        limitCheck = (lineStartPos + i) >> 1
                        for j in range(i - 1, limitCheck, -1):
                            uj = U[j]
                            if uj and category(uj) == "Zs" or ord(uj) >= 0x3000:
                                k = j + 1
                                if k < i:
                                    j = k + 1
                                    extraSpace += sum(
                                        _resolved(U[ii].width, maxWidth)
                                        for ii in range(j, i))
                                    w = _resolved(U[k].width, maxWidth)
                                    u = U[k]
                                    i = j
                                    break
                    if i > lineStartPos + 1:
                        i -= 1
                        extraSpace += w
                    moved = _walk_back(units, interior, i, lineStartPos + 1,
                                       base_cannot_start)
                    if moved < i:
                        extraSpace += sum(_resolved(U[k].width, maxWidth)
                                          for k in range(moved, i))
                        i = moved
                lines.append(makeCJKParaLine(U[lineStartPos:i], maxWidth, widthUsed,
                                             extraSpace, lineBreak, calcBounds))
                try:
                    maxWidth = maxWidths[len(lines)]
                except IndexError:
                    maxWidth = maxWidths[-1]
                lineStartPos = i
                widthUsed = 0

        if widthUsed > 0:
            lines.append(makeCJKParaLine(U[lineStartPos:], maxWidth, widthUsed,
                                         maxWidth - widthUsed, False, calcBounds))
        return ParaLines(kind=1, lines=lines)

    def wordSplit(word, maxWidths, fontName, fontSize, encoding="utf8"):
        """The single-fragment path: plain CJK prose with no inline markup.

        Same rule, different data — here the characters are a plain string and the
        widths a plain list, so there is no fragment structure to carry. Returns
        ``[[extraSpace, text], …]``, which is what ``breakLinesCJK`` unpacks.
        """
        uword = word if isUnicode(word) else word.decode(encoding)
        if not isinstance(maxWidths, (list, tuple)):
            maxWidths = [maxWidths]
        widths = getCharWidths(uword, fontName, fontSize)
        units = list(uword)
        interior = group_interior(units)

        lines: list[list] = []
        i = widthUsed = lineStartPos = 0
        maxWidth = maxWidths[0]
        n = len(units)
        while i < n:
            w = widths[i]
            char = units[i]
            i += 1
            widthUsed += w
            if widthUsed > maxWidth + _FUZZ and widthUsed > 0:
                extraSpace = maxWidth - widthUsed
                if ord(char) < 0x3000:
                    limitCheck = (lineStartPos + i) >> 1
                    for j in range(i - 1, limitCheck, -1):
                        cj = units[j]
                        if category(cj) == "Zs" or ord(cj) >= 0x3000:
                            k = j + 1
                            if k < i:
                                j = k + 1
                                extraSpace += sum(widths[j:i])
                                w = widths[k]
                                i = j
                                break
                if i > lineStartPos + 1:
                    i -= 1
                    extraSpace += w
                moved = _walk_back(units, interior, i, lineStartPos + 1,
                                   base_cannot_start)
                if moved < i:
                    extraSpace += sum(widths[moved:i])
                    i = moved
                lines.append([extraSpace,
                              "".join(units[lineStartPos:i]).strip()])
                try:
                    maxWidth = maxWidths[len(lines)]
                except IndexError:
                    maxWidth = maxWidths[-1]
                lineStartPos = i
                widthUsed = 0

        if widthUsed > 0:
            lines.append([maxWidth - widthUsed, "".join(units[lineStartPos:])])
        return lines

    _para.cjkFragSplit = cjkFragSplit
    _para.wordSplit = wordSplit
    _INSTALLED = True
    return True


#: A line that opens with a character that cannot start one, or closes with one
#: that cannot end one. Exported so ``verify.py`` and ``selftest.py`` scan the
#: built file against the same definition this module enforces, rather than each
#: keeping its own list of punctuation.
LEADING_PUNCT = re.compile(r"^\s*[" + re.escape(CHINESE_CANNOT_START) + r"]")
TRAILING_OPEN = re.compile(r"[" + re.escape("（〔【「『《〈［[") + r"]\s*$")
