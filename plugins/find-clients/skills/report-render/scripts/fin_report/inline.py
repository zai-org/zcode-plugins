"""The inline markup both backends read: reportlab's tag subset, parsed into runs.

``theme.chip()``, ``theme.swatch()``, ``theme.tagged()``, ``theme.legend()`` and
``refs.marker()`` / ``refs.lines()`` all return **strings of reportlab inline
markup**, and a report script concatenates them into f-strings::

    rep.p(f"毛利率{rep.tagged('23.15%','披露')}，环比{rep.tagged('-1.67pct','测算')}{n1}。")

reportlab parses that markup itself. DOCX has no inline markup language — every
change of colour, size or link is a separate ``w:r`` element — so the DOCX
backend needs the same strings taken apart into styled runs. That is this module.

**Why parse the PDF backend's markup instead of giving DOCX its own API.** The
alternative is a second set of helpers (``rep.chip_runs()`` …) and therefore a
second way to write every sentence in this repo's deliverables. The five
provenance tags already shipped in three different renderings from one batch
because the policy named a helper that did not exist (``theme.chip``'s
docstring). Two author-facing call surfaces for the same five tags is that
failure with a second surface added on purpose. Parsing keeps one: the same
script builds either format, and every rule the markup carries — the tag
colours, the ``[n]`` marker shape, the Sources entry schema — stays in the one
place that already owns it.

The grammar is closed, because only ``theme`` and ``refs`` produce it:

===========================================  ==============================
``<font color="#2E6DA4" size="7.6">``        colour and/or size
``<super rise="2" size="6">``                superscript register
``<b>``                                      bold
``<a href="#ref3" color="#2E6DA4">``         internal link to a Sources entry
``<a href="https://…" color="#2E6DA4">``     external link
``<a name="ref3"/>``                         the entry's own anchor
``<br/>``                                    line break inside a paragraph
===========================================  ==============================

Anything else raises. A silently ignored tag would print its content unstyled —
a chip in body colour, which reads as untagged to every downstream check — and
that is the defect class this repo spends the most prose on.

``plain()`` replaces the ``_MARKUP.sub("", …)`` that ``doc.py`` used for column
measurement. It differs in one way, deliberately: entity references are resolved,
so ``a&amp;b`` measures as the three characters reportlab actually prints rather
than as five. Sources entries escape every author-supplied field (``refs.lines``),
and a query-string URL in a table cell was therefore measured 4 points wider per
``&`` than it prints.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from html.parser import HTMLParser

#: The sentinel text of a ``<br/>`` run. A real newline never survives reportlab's
#: paragraph parser, so it cannot collide with author text.
BREAK = "\n"

_ALLOWED = {"font", "super", "b", "i", "a", "br", "sub"}


@dataclass(frozen=True)
class Run:
    """One stretch of text with a single set of inline attributes.

    ``anchor`` and ``href`` are the two halves of the citation contract:
    ``anchor`` is an internal jump target (``<a href="#ref3">`` → ``anchor="ref3"``),
    ``href`` an external URL. ``bookmark`` is the *destination* side
    (``<a name="ref3"/>``) and always arrives on an empty run — a mark, not text.
    """

    text: str
    color: str | None = None
    size: float | None = None
    superscript: bool = False
    subscript: bool = False
    bold: bool = False
    italic: bool = False
    href: str | None = None
    anchor: str | None = None
    bookmark: str | None = None

    @property
    def is_break(self) -> bool:
        return self.text == BREAK and not self.bookmark

    @property
    def is_mark(self) -> bool:
        """A destination anchor with no text of its own."""
        return self.bookmark is not None and not self.text


class _Parser(HTMLParser):
    """Flatten nested inline markup into a run list.

    Attributes nest and merge — ``<font color=…><super size=…>`` yields one run
    carrying both — so the state is a stack of merged frames rather than a single
    current style.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.runs: list[Run] = []
        self._stack: list[Run] = [Run(text="")]

    # ------------------------------------------------------------------ frames
    def _frame(self) -> Run:
        return self._stack[-1]

    def _push(self, **kw) -> None:
        self._stack.append(replace(self._frame(), **kw))

    def _reject(self, tag: str) -> None:
        raise ValueError(
            f"<{tag}> is not part of the inline markup this package emits "
            f"(allowed: {', '.join(sorted(_ALLOWED))}). A tag that is merely "
            "ignored prints its content unstyled — a provenance chip in body "
            "colour reads as untagged to every check downstream."
        )

    def handle_starttag(self, tag: str, attrs) -> None:
        attr = {k: v for k, v in attrs}
        if tag not in _ALLOWED:
            self._reject(tag)
        if tag == "font":
            kw = {}
            if attr.get("color"):
                kw["color"] = attr["color"]
            if attr.get("size"):
                kw["size"] = float(attr["size"])
            self._push(**kw)
        elif tag == "super":
            kw = {"superscript": True}
            if attr.get("size"):
                kw["size"] = float(attr["size"])
            self._push(**kw)
        elif tag == "sub":
            kw = {"subscript": True}
            if attr.get("size"):
                kw["size"] = float(attr["size"])
            self._push(**kw)
        elif tag == "b":
            self._push(bold=True)
        elif tag == "i":
            self._push(italic=True)
        elif tag == "a":
            self._anchor_or_link(attr)
        elif tag == "br":
            # No frame is pushed. ``<br>`` never closes, so pushing one would
            # leave the stack unbalanced and the next ``</font>`` would pop the
            # break's frame instead of the font's — every run after it losing its
            # colour, which on a chip means printing it as body text.
            self.runs.append(replace(self._frame(), text=BREAK))

    def _anchor_or_link(self, attr: dict) -> None:
        """``<a>`` is three different things depending on which attribute it has."""
        kw: dict = {}
        if attr.get("color"):
            kw["color"] = attr["color"]
        href = attr.get("href") or ""
        if href.startswith("#"):
            kw["anchor"] = href[1:]
        elif href:
            kw["href"] = href
        if attr.get("name"):
            # A destination mark. Emitted immediately: it carries no text, and
            # attaching it to the next run would lose it when that run is a
            # different frame (``<a name="ref1"/><b>[1]</b>``).
            self.runs.append(replace(self._frame(), text="", bookmark=attr["name"]))
        self._push(**kw)

    def handle_startendtag(self, tag: str, attrs) -> None:
        if tag == "br":
            self.runs.append(replace(self._frame(), text=BREAK))
            return
        if tag not in _ALLOWED:
            self._reject(tag)
        attr = {k: v for k, v in attrs}
        if tag == "a" and attr.get("name"):
            self.runs.append(replace(self._frame(), text="", bookmark=attr["name"]))
            return
        # A self-closing form of a styling tag styles nothing; ignore it rather
        # than unbalancing the stack.

    def handle_endtag(self, tag: str) -> None:
        if len(self._stack) > 1:
            self._stack.pop()

    def handle_data(self, data: str) -> None:
        if data:
            self.runs.append(replace(self._frame(), text=data))


def parse(markup: object) -> list[Run]:
    """Inline markup → runs, in document order.

    Adjacent runs sharing every attribute are merged, so a paragraph built from
    three concatenated f-string pieces does not become three ``w:r`` elements
    with identical formatting.
    """
    text = "" if markup is None else str(markup)
    parser = _Parser()
    parser.feed(text)
    parser.close()

    merged: list[Run] = []
    for run in parser.runs:
        if not run.text and not run.bookmark:
            continue
        if merged and not run.is_break and not merged[-1].is_break:
            last = merged[-1]
            if (
                not run.bookmark
                and not last.bookmark
                and replace(last, text="") == replace(run, text="")
            ):
                merged[-1] = replace(last, text=last.text + run.text)
                continue
        merged.append(run)
    return merged


def plain(markup: object) -> str:
    """The text a reader sees, with markup removed — for measurement and checks.

    Line breaks vanish rather than becoming newlines, which is what the regex
    this replaces did: a ``<br/>`` inside a Sources entry is a wrap, not a
    character, and counting one would widen every measured column carrying an
    entry.
    """
    return "".join(r.text for r in parse(markup) if not r.is_break)


def links(markup: object) -> tuple[list[str], list[str], list[str]]:
    """(external hrefs, internal anchors, bookmark names) in a markup string.

    ``verify.py`` uses this on the DOCX side to check the citation contract the
    PDF side checks with ``/Link`` annotations: every ``[n]`` jumps somewhere, and
    every somewhere exists.
    """
    runs = parse(markup)
    return (
        [r.href for r in runs if r.href],
        [r.anchor for r in runs if r.anchor],
        [r.bookmark for r in runs if r.bookmark],
    )
