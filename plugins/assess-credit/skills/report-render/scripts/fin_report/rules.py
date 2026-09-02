"""The refusals that belong to the deliverable, not to the renderer.

Three of the gates in this package are statements about the *document* — its
provenance tags, its legend, its citations — and are equally true whether the
file is a PDF or a DOCX. They started in ``doc.py`` because that was the only
backend; ``word.py`` needs the same three, and a second copy is how a rule
becomes two rules. The evidence is in this repo's own history: the five
provenance tags shipped in three different renderings from one batch because the
policy stated the rule in prose and left the rendering to each script
(``theme.chip``'s docstring). The fix was one helper. This is the same fix one
level up — one refusal, two renderers.

What stays with each backend is *placement*: which flowable the legend becomes
and where it is inserted is reportlab's business in ``doc.py`` and OOXML's in
``word.py``. What lives here is which document is refused and with what words,
because that is the part a reader of either format experiences identically.
"""
from __future__ import annotations

import re

from . import inline, theme

#: A column header that announces a derived quantity. `provenance.md` names the
#: variance column among the places a chip is mandatory, and these headers are how
#: one gets announced: whatever sits under them is arithmetic over a disclosed
#: figure, or a ratio the issuer disclosed — `[测算]` or `[披露]`, never nothing.
#:
#: Matched on the header text, which is the one place the intent is unambiguous.
#: The built file cannot settle this: pypdf flattens a table to 「同比环比毛利」
#: followed by bare cells, so the cue and its figure never end up adjacent and
#: `verify.py`'s coverage scan cannot see a table at all. A 7-column × 6-row 分部
#: table carrying exactly one tag shipped through every gate on 2026-08-25.
DERIVED_HEADER = re.compile(
    r"同比|环比|占比|变动|增速|涨跌|pct|个百分点|vs\s*预期|YoY|QoQ")
#: A provenance tag anywhere in a cell — from `chip()`, from `tagged()`, or
#: hand-typed. Hand-typed is its own defect and `verify.py` reports it; for
#: coverage it still tells the reader which class the column is.
CELL_TAG = re.compile(
    r"\[(?:" + "|".join(re.escape(k) for k in theme.CHIP) + r")\]")


def normalise_tag(tag: object) -> str:
    """A tag name as ``CHIP`` keys it, with brackets and whitespace removed.

    Three call sites need this and each wrote it inline; they must agree, because
    the set recorded here is the set the legend is built from and the set
    ``build()`` refuses an untagged document against.
    """
    return str(tag).strip().strip("[]【】").strip()


def untagged_columns(rows: list[list], *, header: bool = True) -> list[str]:
    """Labels of derived columns — and derived rows — that tag nothing.

    Scoped **per column**, not per table, and that is the whole precision of the
    check. A tag on the header cell or on any one body cell clears the column,
    because a uniform column carries its class once — the same run rule prose
    follows. What does not clear it is a tag somewhere else in the table: the 分部
    exhibit behind this check mixed disclosed revenue with computed margin deltas
    across seven columns, tagged none of them, and explained the 口径 in its note
    — 「注：全部为公司披露口径；毛利率及其变动为披露值按分部收入计算[测算]」. A
    reader cannot map that sentence onto cells, which is what a chip is for, so a
    caption or a note does not discharge a column.

    Rows are checked the same way where the exhibit is transposed and column 0
    holds the labels.
    """
    if not rows or not header or len(rows) < 2:
        return []
    head, body = rows[0], rows[1:]
    offenders: list[str] = []

    for index, cell in enumerate(head):
        label = inline.plain(cell)
        if not DERIVED_HEADER.search(label):
            continue
        column = [str(cell)] + [str(r[index]) for r in body if index < len(r)]
        if not any(CELL_TAG.search(v) for v in column):
            offenders.append(label.strip() or f"col {index + 1}")

    for row in body:
        if not row:
            continue
        label = inline.plain(row[0])
        if not DERIVED_HEADER.search(label):
            continue
        if not any(CELL_TAG.search(str(c)) for c in row):
            offenders.append(label.strip())

    return offenders


def where(rows: list[list], caption: str, heading: str | None) -> str:
    """How an offending exhibit is named in the build error: caption, else heading,
    else the head row itself — an author has to be able to find the table."""
    head = rows[0] if rows else []
    return caption or heading or inline.plain(" ".join(str(c) for c in head))[:40]


def untagged_tables_error(offenders: list[str]) -> str:
    """The message ``build()`` raises. Collected across the document and raised
    once: an author fixing exhibits one traceback at a time re-runs the whole
    build per table."""
    return (
        f"{len(offenders)} 同比/环比/占比-class column(s) or row(s) "
        "carry no provenance tag in the header cell or in any cell under it: "
        + "; ".join(f"「{t}」" for t in offenders[:6])
        + ("; …" if len(offenders) > 6 else "")
        + ". provenance.md makes a chip mandatory in any table or variance "
        "column: a sequential move you computed is [测算], one the issuer "
        "printed is [披露], and untagged they read the same. One "
        "rep.chip(标签) on the header cell covers a uniform column; "
        "rep.tagged(value, tag) per cell where the column mixes classes. A "
        "note explaining the 口径 does not discharge it — the reader cannot "
        "map a sentence onto cells"
    )


def legend_problem(tags: set[str], placement: str | None) -> str | None:
    """Why this document's legend is wrong, or ``None``.

    Both directions are refusals: a tagged document with no legend leaves the
    reader no key (9 of 14 deliverables in the 2026-08-24 batch, using 38–171
    chips each), and a legend over tags the document never emits misdescribes it.
    """
    if placement is None:
        if tags:
            return (
                f"the deliverable uses provenance tags ({', '.join(sorted(tags))}) "
                "but has no legend — provenance.md requires one, listing only the "
                "tags that appear. Call rep.legend() anywhere before build(); it "
                "is placed and filled in for you."
            )
        return None
    if not tags:
        return (
            "legend() was called but no tag was ever emitted through tagged() — "
            "a legend for tags the document does not use misdescribes it. Either "
            "tag the figures (rep.tagged(value, tag)) or drop the legend."
        )
    return None


#: ``sources()`` was never called on a document that minted markers. The markers
#: would point at anchors that do not exist — a dangling ``/Link`` in a PDF, a
#: dangling ``w:anchor`` in a DOCX, and in both a ``[n]`` the reader cannot follow.
SOURCES_MISSING = (
    "sources were cited but sources() was never called — the [n] markers "
    "would point at anchors that do not exist"
)

NO_SOURCES = (
    "no sources registered — a deliverable making sourced claims needs "
    "a Sources section (refs.cite(...) as you write each claim)"
)


def legend_placement_problem(placement: str, has_cover: bool) -> str | None:
    """Why this ``legend(placement=…)`` cannot be honoured, or ``None``.

    The two legal sites are the foot of the cover and the head of the first
    content page — the only two places a reading key reads as document apparatus
    rather than as the opening sentence of 核心观点, which is where 12 of 14
    documents in one batch put it.
    """
    if placement not in ("lead", "cover"):
        return (
            f"placement={placement!r} is not a legend site — use 'lead' (head of "
            "the first content page, above the first heading) or 'cover' (foot of "
            "the cover). A legend inside a section reads as that section's text."
        )
    if placement == "cover" and not has_cover:
        return (
            "placement='cover' needs a cover — call cover() before legend(), or "
            "use the default placement='lead'."
        )
    return None
