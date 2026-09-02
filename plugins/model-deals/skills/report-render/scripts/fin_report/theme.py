"""One palette, one type ramp, one set of page dimensions.

The two hand-built report generations this replaces each declared their own
palette twice — once in the chart script and once in the PDF builder — so four
copies drifted in case and in value (``#2e6da4`` vs ``#2E6DB4``, AMBER
``#d98c2b`` vs GOLD ``#C9912A``). Charts and pages now read the same constants.

Values are fixed by the house formatting policy. Provenance chip colours come
from the provenance policy and are deliberately NOT available as
decoration — a gold accent that happens to match the [测算] chip teaches the
reader a false association.
"""
from __future__ import annotations

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm

from . import fonts

# --------------------------------------------------------------------------
# palette (hex strings; matplotlib wants these, reportlab wants HexColor)
# --------------------------------------------------------------------------
NAVY = "#1F3A5F"      # headings, chart titles, table header fill
BLUE = "#2E6DA4"      # primary series, subheadings, link colour
TEAL = "#2A9D8F"      # second series
GOLD = "#C9912A"      # accent rule, third series
RED = "#C0392B"       # negative / risk
GREEN = "#1E8449"     # positive
GREY = "#6B7280"      # source notes, secondary text
ZEBRA = "#F4F7FA"     # table row banding
GRID = "#E5E9EF"      # table grid, chart gridlines
INK = "#1C1C1C"       # body text

#: Ordered series palette for charts. Six is the ceiling: beyond that, split the
#: chart or use a table (a seventh colour is not distinguishable in print).
SERIES = (BLUE, TEAL, GOLD, NAVY, RED, GREY)

#: Provenance chips — fixed by policy, not part of SERIES.
CHIP = {
    "披露": GREEN, "Reported": GREEN,
    "测算": GOLD, "Est.": GOLD,
    "预期": "#1155CC", "Consensus": "#1155CC",
    "推断": "#E67E22", "Inferred": "#E67E22",
    "媒体": GREY, "Media": GREY,
}

#: Chip type size in points. The provenance policy asks for ≈6pt in a
#: superscript register: small enough to annotate a number without competing
#: with it, large enough to stay legible in print.
CHIP_PT = 6.0


def chip(tag: str, size: float = CHIP_PT) -> str:
    """Render one provenance tag as inline markup. **The only way to emit one.**

    The provenance policy says to define a single helper and route every tag
    through it, because hand-typed tags drift inside one document — that is how
    ``(测算)`` reaches page 3 and ``[测算]`` page 7. This module has carried the
    colour table since the first version; what it never carried was this
    function, so the policy's "one helper" had a data half and no callable half.

    The consequence was per-report reinvention, measured across one batch of
    deliverables built from the same skill by the same model:

    * 业绩点评 — found ``theme.CHIP`` and wired its own renderer: 6.0pt chips in
      the policy colours, 218 of them. Correct.
    * 行业研究 — copied the hex values into its own script and still shipped
      every tag as ``#1c1c1c`` body text.
    * 深度报告 — never attempted a chip; 107 tags printed as plain prose.

    Three shapes from one policy is the exact failure the shared layer exists to
    prevent, one level below where it was fixed: the wording was unified, the
    rendering was not.

    Accepts the five literal tags and their English aliases and nothing else —
    an inflected form (``[已披露]``, ``[一致预期]``) raises here, which is earlier
    and cheaper than the convention lint catching it in a built file.
    """
    key = tag.strip().strip("[]【】").strip()
    colour = CHIP.get(key)
    if colour is None:
        raise ValueError(
            f"{tag!r} is not a provenance tag. Use one of "
            f"{sorted(k for k in CHIP if not k.isascii())} "
            f"(or the English aliases) — inflected forms such as 已披露 / 一致预期 "
            "read as untagged to every downstream check."
        )
    return (f'<font color="{colour}">'
            f'<super rise="2" size="{size:g}">[{key}]</super></font>')


def swatch(tag: str) -> str:
    """A provenance tag in the **legend's** register: colour kept, superscript dropped.

    ``chip()`` is the body form and is deliberately small and raised — it annotates
    a number without competing with it. A legend is the opposite situation: there
    the tag is the subject of the line, and the prose beside it is the caption.
    Reusing ``chip()`` there printed the key at 6pt raised against 7.6pt
    explanatory text, so the swatch was *smaller and harder to read than its own
    explanation*, and the raised register made it read as a footnote marker rather
    than a specimen of what the reader will meet in the body.

    Emits no size, so the tag inherits whatever style the legend sits in and
    matches the surrounding text automatically — nothing to keep in step with the
    note style. Colour still comes from ``CHIP``, so the legend and the body can
    never disagree about what green means.
    """
    key = tag.strip().strip("[]【】").strip()
    if key not in CHIP:
        raise ValueError(f"{tag!r} is not a provenance tag")
    return f'<font color="{CHIP[key]}"><b>[{key}]</b></font>'


#: One-line gloss per tag, for the legend. Wording follows the provenance
#: policy's own tag table verbatim, so the legend cannot describe a tag
#: differently from the rule that defines it.
CHIP_GLOSS = {
    "zh-CN": {
        "披露": "公司公告、交易所/监管/登记机关记录，或源自这些文件的数据库字段",
        "测算": "本报告基于披露数据的计算与假设",
        "预期": "第三方具名预期（数据商一致预期）",
        "推断": "本报告的分析判断，无对应记录",
        "媒体": "媒体报道，未经披露记录佐证",
    },
    "en": {
        "Reported": "A primary record: the entity disclosed it, or a registry/exchange/regulator recorded it",
        "Est.": "Computed or assumed by this report from reported inputs",
        "Consensus": "A named third party's estimate (a data vendor's aggregated consensus)",
        "Inferred": "This report's analytical inference, with no corresponding record",
        "Media": "Reported by media, not corroborated by a disclosed record",
    },
}
#: Canonical order for the legend, so two reports never list the tags differently.
CHIP_ORDER = ("披露", "测算", "预期", "推断", "媒体",
              "Reported", "Est.", "Consensus", "Inferred", "Media")


def tagged(value: str, tag: str, size: float = CHIP_PT) -> str:
    """One figure with its own chip bound to it. **Use this where classes mix.**

    ``chip()`` renders a tag; it cannot say *which number* the tag is about, and
    in flowing prose there is no column to carry that binding the way a table
    header does. That only matters at a **class boundary**: a run of figures that
    are all one class takes a single trailing ``chip()`` and needs nothing else —

        rep.p(f"同比 +102.7%、环比 +76.6%{rep.chip('测算')}{cite}。")

    — and tagging each of those individually is noise, not rigour. Where a clause
    crosses classes, the mapping has to be carried, and the two ways of writing
    around it are both defects:

    * **The pile** — every class present stacked at the clause's end::

          同期碳酸锂季度均价15.38万元/吨,同比+102.7%、环比+76.6%[披露][测算][5]

      Three figures, two classes, no mapping. Shipped 2026-08-24: all three were
      in fact ``[测算]`` (the quarterly average was derived from a monthly
      series), and ``[披露]`` referred to a series the sentence never prints — so
      the pile advertised a disclosure that was not there and hid that everything
      in the clause was ours. That one was a uniform run written as a mixed pile.
    * **The lead** — the tag hoisted to the front of a bullet as plain text
      (``• [推断] 控制权高度集中……``), which bypasses ``chip()`` entirely and
      prints at body size in body colour. 15 of these in the same batch.

    Both disappear when binding a tag to a figure is the shortest thing to write::

        rep.p(f"Q2 单季毛利率{rep.tagged('23.15%', '披露')}，"
              f"环比{rep.tagged('−1.67pct', '测算')}{cite}。")

    ``value`` must be non-empty: a chip with nothing to its left is the lead
    defect, and this is where it is cheapest to catch.
    """
    text = str(value)
    if not text.strip():
        raise ValueError(
            f"tagged() needs the figure the {tag!r} chip is about — a chip with "
            "nothing bound to it is the 「句首裸标签」 defect, and it also loses "
            "the chip rendering. Put the tag after its own number: "
            "tagged('24.82%', '披露')"
        )
    return f"{text}{chip(tag, size)}"


def legend(tags, locale: str = "zh-CN", extra: str = "") -> str:
    """The page-1 provenance legend, built from the tags a document actually used.

    ``provenance.md`` requires a legend on page 1 of any paginated deliverable,
    "listing only the tags that actually appear in that document". Hand-writing
    it satisfies neither half reliably: 9 of 14 deliverables in the 2026-08-24
    batch carried no legend at all while using 38–171 chips each, and the rule
    lived only in the policy — not in the guardrail vendored into the agents, not
    in 28 of the 38 prose skills' output templates, and not in ``verify.py``.
    Every rule this repo actually holds is held by a helper plus a check.

    So the argument is the *used* set, not a list the author retypes — the same
    rail ``refs.cite()`` gives ``[n]``, where the marker and the entry come from
    one call and cannot drift apart.
    """
    keys = {str(t).strip().strip("[]【】").strip() for t in tags}
    unknown = sorted(k for k in keys if k not in CHIP)
    if unknown:
        raise ValueError(f"not provenance tags: {unknown}")
    if not keys:
        raise ValueError(
            "legend() was called with no tags — a legend listing tags the "
            "document does not use is as wrong as a missing one. Tag the "
            "deliverable first (tagged()/chip()), then build the legend from "
            "what was used."
        )
    gloss = CHIP_GLOSS["en" if locale.startswith("en") else "zh-CN"]
    head = "标签口径：" if not locale.startswith("en") else "Provenance legend: "
    items = [f"{swatch(k)} {gloss[k]}" for k in CHIP_ORDER if k in keys and k in gloss]
    joiner = "；" if not locale.startswith("en") else "; "
    return head + joiner.join(items) + ("。" + extra if extra else "。")


def hex_to_color(value: str) -> colors.Color:
    return colors.HexColor(value)


# --------------------------------------------------------------------------
# page geometry
# --------------------------------------------------------------------------
PAGE_W, PAGE_H = A4
MARGIN_L = MARGIN_R = 18 * mm
MARGIN_T = 20 * mm
MARGIN_B = 18 * mm
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R

#: Hard ceiling on a rendered figure's height — roughly one third of the text
#: column. This is the one constant that survived verbatim across both hand-built
#: generations, which is decent evidence it is the right value.
FIG_H_CAP = 88 * mm
#: Density-tiered display widths. A two-bar chart at full column width looks
#: like a mistake; a 19-series chart at 92mm is unreadable.
FIG_W_TIERS = ((4, 92 * mm), (8, 120 * mm), (14, 150 * mm), (10**6, 164 * mm))
FIG_W_MULTIPANEL_MIN = 150 * mm

#: Default matplotlib ``font.size`` for charts. ``charts.save`` records the value
#: actually in force per figure, so this is only the fallback for a sidecar
#: written before that field existed.
CHART_BASE_PT = 10.5
#: Floor on the on-page size of text drawn *inside* a figure, in points. A chart
#: is authored at some width in inches and displayed narrower, so every label it
#: contains is scaled by ``display_width / authored_width`` — a 10.5pt axis label
#: on a 7.4in canvas shown at 92mm is 5.1pt on paper. Publisher artwork guidance
#: puts normal figure lettering at 7pt minimum (Elsevier; Nature's range bottoms
#: out at 5pt, and 8pt is the safe working default), so 7pt is the lowest
#: defensible value rather than a taste setting.
#:
#: This bounds shrink-to-fit only. It is deliberately NOT a lower bound on
#: FIG_W_TIERS: the two sparse tiers already sit below it, and widening them to
#: satisfy it would undo density sizing. The consequence is stated where it
#: matters — a figure already at or under the floor has no shrink budget.
FIG_MIN_TEXT_PT = 7.0

#: Sources-list metrics as (leading, spaceAfter) at REF_PT, **loosest first**.
#: A reference list is conventionally set tighter than body text, but tightening
#: every report to buy a page some reports do not need is a cost with no benefit,
#: so `Report.sources` measures the list and picks the loosest set that yields
#: the fewest pages — ties keep the first entry, i.e. nothing changes unless a
#: page is actually saved. Observed 2026-08-19: 33 entries at (13, 5) filled two
#: columns and left the 33rd alone on a third page, 87% blank.
#:
#: The floor is 11.0 = 1.25x REF_PT. Below about 1.2x, ascenders and descenders of
#: adjacent lines start to touch in a list this dense with Latin URLs, so this is a
#: legibility floor rather than a taste setting — the same shape of bound as
#: FIG_MIN_TEXT_PT.
REF_PT = 8.8
REF_STEPS: tuple[tuple[float, float], ...] = ((13.0, 5.0), (12.0, 4.2), (11.0, 3.5))


def _para(name: str, **kw) -> ParagraphStyle:
    """One paragraph style over the house base. Module level so `ref_style` and
    `styles` cannot drift into two different bases for the same list."""
    base = dict(
        fontName=fonts.REGULAR,
        fontSize=10,
        leading=15.5,
        textColor=hex_to_color(INK),
        wordWrap="CJK",
        alignment=TA_JUSTIFY,
        spaceAfter=6,
    )
    base.update(kw)
    return ParagraphStyle(name, **base)


def ref_style(leading: float, space_after: float) -> ParagraphStyle:
    """A Sources-entry style at the given metrics. See REF_STEPS."""
    return _para(f"ref{leading}_{space_after}", fontSize=REF_PT, leading=leading,
                 alignment=TA_LEFT, spaceAfter=space_after)


def styles() -> dict[str, ParagraphStyle]:
    """The type ramp. Every style that can hold Chinese sets wordWrap='CJK'.

    Without wordWrap='CJK', reportlab treats a run of Chinese — which contains no
    spaces — as one unbreakable word and wraps the line early, leaving a ragged
    right margin that looks like a layout bug because it is one.
    """
    mk = _para

    return {
        "body": mk("body"),
        "body_left": mk("body_left", alignment=TA_LEFT),
        "h1": mk("h1", fontName=fonts.BOLD, fontSize=16, leading=21,
                 textColor=hex_to_color(NAVY), spaceBefore=8, spaceAfter=8,
                 alignment=TA_LEFT, keepWithNext=1),
        "h2": mk("h2", fontName=fonts.BOLD, fontSize=12.5, leading=17,
                 textColor=hex_to_color(BLUE), spaceBefore=10, spaceAfter=5,
                 alignment=TA_LEFT, keepWithNext=1),
        # Captions are CENTRED, and so are the figures under them. The later of
        # the two hand-built generations centred the caption but left the image
        # at reportlab's LEFT default, which is visibly wrong and was the
        # remaining half of a reported layout complaint.
        "caption": mk("caption", fontName=fonts.BOLD, fontSize=9.5, leading=13,
                      textColor=hex_to_color(NAVY), alignment=TA_CENTER,
                      spaceBefore=2, spaceAfter=3),
        "note": mk("note", fontSize=7.6, leading=10.5,
                   textColor=hex_to_color(GREY), alignment=TA_LEFT, spaceAfter=4),
        "small": mk("small", fontSize=8.6, leading=12),
        "bullet": mk("bullet", alignment=TA_LEFT, spaceAfter=4, leftIndent=10, bulletIndent=0),
        "ref": ref_style(*REF_STEPS[0]),
        "kpi": mk("kpi", fontName=fonts.BOLD, fontSize=18, leading=20,
                  textColor=hex_to_color(NAVY), alignment=TA_CENTER, spaceAfter=0),
        "kpi_label": mk("kpi_label", fontSize=7.8, leading=10,
                        textColor=hex_to_color(GREY), alignment=TA_CENTER, spaceAfter=0),
        "cover_title": mk("cover_title", fontName=fonts.BOLD, fontSize=27, leading=35,
                          textColor=colors.white, alignment=TA_LEFT, spaceAfter=4),
        "cover_sub": mk("cover_sub", fontName=fonts.BOLD, fontSize=14, leading=20,
                        textColor=hex_to_color("#D6E2F0"), alignment=TA_LEFT, spaceAfter=4),
        "cover_meta": mk("cover_meta", fontSize=10.5, leading=16,
                         textColor=hex_to_color(GREY), alignment=TA_LEFT),
    }


def cell_style(size: float = 8.3, align: int = TA_LEFT, bold: bool = False,
               color: str = INK) -> ParagraphStyle:
    """A table cell must be a Paragraph, not a bare string.

    Bare strings in a reportlab Table do not wrap, do not render ``[n]`` links,
    and do not honour wordWrap='CJK' — so a long Chinese cell overflows its
    column silently.
    """
    return ParagraphStyle(
        f"cell{size}{align}{bold}",
        fontName=fonts.BOLD if bold else fonts.REGULAR,
        fontSize=size,
        leading=size + 3,
        wordWrap="CJK",
        alignment=align,
        textColor=hex_to_color(color),
    )
