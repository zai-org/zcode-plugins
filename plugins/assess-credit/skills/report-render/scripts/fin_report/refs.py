"""Citation registry: ``[n]`` markers and the Sources section, as one object.

the citation policy requires that the count of distinct ``[n]`` markers
equal the number of Sources entries, that every entry declare 一手/二手, and that
a 二手 entry name its relay chain. Those are easy rules to state and easy to
break by hand — a marker added late, an entry left behind after an edit.

So the marker and the entry are produced by the same call. ``cite()`` returns the
markup to drop in the prose *and* registers the entry; the Sources section is
rendered from the registry. The invariant holds by construction rather than by
discipline, and ``problems()`` catches what construction cannot.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from xml.sax.saxutils import escape

from reportlab.platypus import Paragraph

from .theme import BLUE, GREY

PRIMARY = {"一手", "primary", "Primary", "PRIMARY"}
SECONDARY = {"二手", "secondary", "Secondary", "SECONDARY"}

#: An MCP server or tool name in a field that is supposed to carry the provider.
#: The citation policy asks for the organisation plus the fields taken, because a
#: reader can check 万得 · 基金产品档案 and cannot check ``wind-fund``, and the
#: wiring outlives no rename. Rejected at ``cite()`` rather than reported at
#: verify time: by verify the deliverable is built, and the author who typed
#: ``万得基金（wind-fund）`` did so in one place and will fix it in one place.
INTERFACE_NAME = re.compile(
    r"(?:hexin|wind|sec)-(?:stock|fund|bond|index|global-stock|economic|docs|search)\b"
    r"|finance-search|sec-search|\btianyancha\b"
    r"|\b(?:get|search|query|list|fetch)_[a-z][a-z_]{3,}\b")
#: A URL that stops at the host: the vendor's or the ministry's front door. The
#: policy gives the field two forms — the page that was actually accessed, or
#: nothing — and this is the third one, which locates nothing while making the
#: deliverable look better sourced than it is.
BARE_DOMAIN = re.compile(r"^https?://[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/?$")

LABELS = {
    "zh-CN": {"primary": "一手", "secondary": "二手", "relay": "转引", "retrieved": "检索于", "published": "发布"},
    "en": {"primary": "Primary", "secondary": "Secondary", "relay": "relaying", "retrieved": "retrieved", "published": "published"},
}


@dataclass(frozen=True)
class Source:
    publisher: str
    document: str
    tier: str = "一手"
    published: str | None = None
    retrieved: str | None = None
    url: str | None = None
    #: What a secondary source relays, e.g. "IDC《中国AI市场追踪》". Required for 二手.
    relays: str | None = None

    @property
    def is_primary(self) -> bool:
        return self.tier in PRIMARY

    def key(self) -> tuple:
        return (self.publisher, self.document, self.published, self.url)


@dataclass
class Refs:
    """Ordered, de-duplicated citation registry."""

    locale: str = "zh-CN"
    _sources: list[Source] = field(default_factory=list)
    _index: dict[tuple, int] = field(default_factory=dict)
    _cited: set[int] = field(default_factory=set)

    def cite(self, publisher: str, document: str, *, tier: str = "一手",
             published: str | None = None, retrieved: str | None = None,
             url: str | None = None, relays: str | None = None) -> str:
        """Register a source (or reuse it) and return the inline ``[n]`` markup."""
        for field_name, value in (("publisher", publisher), ("document", document)):
            hit = INTERFACE_NAME.search(value or "")
            if hit:
                raise ValueError(
                    f"{field_name}={value!r} carries an interface name "
                    f"({hit.group(0)!r}). Name the organisation the data came from "
                    "and which fields — publisher='万得', "
                    "document='基金产品档案（成立日期/投资类型/业绩比较基准）' — never the "
                    "MCP server or tool that happened to serve it: the reader cannot "
                    "check it and it expires when the wiring changes. Keep the field "
                    "names; they carry the 口径."
                )
        if url and BARE_DOMAIN.match(url.strip()):
            raise ValueError(
                f"url={url!r} is a bare domain, which locates nothing. The field has "
                "two honest forms: the specific page that was accessed, or no url at "
                "all when an institution's interface served the data and there is no "
                "public page for it — then name the institution and what was taken "
                f"and stop there (url=''). A series reached through Wind EDB has no "
                "page at its original publisher that you visited, so it gets no URL."
            )
        source = Source(publisher, document, tier, published, retrieved, url, relays)
        key = source.key()
        if key in self._index:
            number = self._index[key]
        else:
            self._sources.append(source)
            number = len(self._sources)
            self._index[key] = number
        self._cited.add(number)
        return self.marker(number)

    def marker(self, number: int) -> str:
        """An internal link to the Sources entry, as a real PDF /Link annotation."""
        return (
            f'<a href="#ref{number}" color="{BLUE}">'
            f'<super rise="3" size="7">[{number}]</super></a>'
        )

    def repeat(self, publisher: str, document: str, **kw) -> str:
        """Cite an already-registered source without re-declaring its metadata."""
        for number, source in enumerate(self._sources, start=1):
            if source.publisher == publisher and source.document == document:
                self._cited.add(number)
                return self.marker(number)
        return self.cite(publisher, document, **kw)

    # ----------------------------------------------------------------- checks
    def problems(self, placed: set[int] | None = None) -> list[str]:
        """Policy violations. Empty means the Sources section is well formed.

        ``placed`` is the set of entry numbers whose marker was found in the
        built story. Pass it and the citation policy's count rule — distinct
        ``[n]`` markers == Sources entries — is checked against the document
        that will actually print. Omit it and the check falls back to
        ``_cited``, which records only that a marker was *minted*.

        That fallback is why this needed the parameter. ``cite()`` adds to
        ``_cited`` and returns the markup in the same breath, so an author who
        registers a source and drops the returned string — a paragraph rewritten,
        a claim cut in an edit — leaves an entry nothing points to, and the
        registry cannot tell. Observed 2026-08-19: a deliverable shipped with
        Sources numbered to [26] while the body cited 14 distinct markers. The
        check existed and could not fire, which is worse than not having it.
        """
        out: list[str] = []
        cited = self._cited if placed is None else placed
        for number, source in enumerate(self._sources, start=1):
            where = f"[{number}] {source.publisher} · {source.document}"
            if source.tier not in PRIMARY | SECONDARY:
                out.append(f"{where}: tier must be 一手/二手 (got {source.tier!r})")
            if not source.is_primary and not source.relays:
                out.append(
                    f"{where}: a 二手 entry must name what it relays — writing 二手 "
                    "without the relay chain hides the chain it was meant to expose"
                )
            if not source.published and not source.retrieved:
                out.append(f"{where}: needs a publication date, a retrieval date, or both")
            if number not in cited:
                out.append(
                    f"{where}: registered but its [{number}] marker appears nowhere in "
                    "the body — the citation policy requires one marker per entry. "
                    "Cite it where the claim it supports is made, or drop the entry; "
                    "a source consulted but not relied on does not belong in 来源"
                )
        return out

    def __len__(self) -> int:
        return len(self._sources)

    # ---------------------------------------------------------------- render
    def lines(self) -> list[str]:
        """Sources entries as markup, in the schema from policy/citations.md.

        **Every author-supplied field is XML-escaped before it reaches reportlab.**
        These strings are interpolated into paragraph markup, and reportlab's
        paraparser reads a bare ``&`` as the start of an entity — then *repairs*
        the unterminated one by inserting a semicolon. So a query-string URL
        printed verbatim comes out as
        ``…?code=25025B700173&lan;=zh&device;=pc``: three characters that were
        never in the source, in the one field whose entire job is to be copied.
        The ``/Link`` annotation is built from the same attribute and survives
        (reportlab unescapes it), which is why this shipped — the citation is
        clickable and only the visible text is wrong, so every automated gate
        passed it. Measured on the 2026-08-24 batch: 108 mangled URLs across 5 of
        14 deliverables. A 文档名 carrying ``&`` corrupts the same way.
        """
        label = LABELS.get(self.locale, LABELS["zh-CN"])
        out: list[str] = []
        for number, s in enumerate(self._sources, start=1):
            tier = label["primary"] if s.is_primary else label["secondary"]
            parts = [f"〔{tier}〕{escape(s.publisher)}", escape(s.document)]
            if s.relays:
                parts.append(f"{label['relay']} {escape(s.relays)}")
            dates = []
            if s.published:
                dates.append(f"{escape(s.published)}({label['published']})")
            if s.retrieved:
                dates.append(f"{label['retrieved']} {escape(s.retrieved)}")
            if dates:
                parts.append("; ".join(dates))
            text = " · ".join(parts)
            anchor = f'<a name="ref{number}"/>'
            href = escape(s.url) if s.url else ""
            url = (
                f'<br/><font size="7.6" color="{GREY}">'
                f'<a href="{href}" color="{BLUE}">{href}</a></font>'
                if s.url else ""
            )
            out.append(f"{anchor}<b>[{number}]</b> {text}{url}")
        return out

    def flowables(self, style) -> list:
        """Entries as plain paragraphs, one per entry.

        **Splittable.** A reportlab Paragraph breaks at line boundaries, so an
        entry laid out with these can leave its URL line — appended inside the
        same paragraph with ``<br/>`` — alone at the top of the next page. The
        Sources section in ``doc.Report`` therefore builds its own atomic blocks
        (``_ref_blocks``) and chooses the list's leading by measuring them; use
        this only for a context with no pagination, such as a Markdown export.
        """
        return [Paragraph(line, style) for line in self.lines()]
