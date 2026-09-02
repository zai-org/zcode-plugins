"""The report document: page furniture, content blocks, and the build gate.

Assembled from the two hand-built generations, taking the better half of each and
fixing three defects that survived in both or regressed between them:

* images are centred under their centred captions — via the **cell's**
  ``ALIGN=CENTER``, not ``Image.hAlign``. Setting `hAlign` was the earlier fix and
  it does nothing once the image is a flowable inside a table cell, so the claim
  sat here as documentation while the page still showed the image flush left
  (340pt wide at the left margin, 204pt of空白 on the right);
* multi-page tables repeat their header row (``repeatRows=1``) — present in the
  earlier generation, lost in the later one, so a table crossing a page break
  showed a headerless continuation;
* the chart sidecar is read defensively — one generation did a bare ``json.load``
  and hard-crashed when a chart had not been rendered yet.

Page-break policy (the house formatting policy): the only hard breaks are after
the cover and before the Sources section. A break before every heading is the
main cause of half-empty pages.

**The cover is optional, and a document without one is not a degraded document.**
It is also not a licence: a research deliverable has a cover, and "this one is
short" is no reason to drop it. The exception belongs to the skill that owns the
deliverable and has to be declared there — today that is ``write-research``'s
``morning-note``, whose 晨会纪要 opens on its first sentence because a title page on
a one-page note is a third of the document. ``_templates`` orders the page
templates by whether ``cover()`` was called; see its docstring for what the other
order shipped.
"""
from __future__ import annotations

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.units import inch, mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    BaseDocTemplate, Frame, Image, KeepTogether, NextPageTemplate, PageBreak,
    PageTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.platypus.flowables import HRFlowable

from . import charts, cjk, fonts, inline, rules, theme
from .refs import Refs
from .theme import CONTENT_W, MARGIN_B, MARGIN_L, MARGIN_R, MARGIN_T, PAGE_H, PAGE_W

#: Zero-padding style for the one-cell grouping tables (_atomic, _FittedFigure).
#: Shared so the two cannot drift into padding one exhibit differently.
_FLUSH_CELL = TableStyle([
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
])

#: 图片块专用：在 `_FLUSH_CELL` 之上加 `ALIGN=CENTER`。
#:
#: 图片是作为 flowable 放进单元格的，此时 `Image.hAlign="CENTER"` **不生效**
#: ——决定水平位置的是单元格自己的 ALIGN，默认 LEFT。实测一张 340pt 宽的
#: 关联方图谱贴在左边距上（左 51pt / 右 204pt），而它上方的图注是居中的。
#:
#: **必须与 `_FLUSH_CELL` 分开。** 那个样式还被 `_atomic()` 用着——一个把标题
#: 与后续内容绑在一起的通用包装，callout 也走它。给它加居中会把任意内容都居中，
#: 而且实测让「超过一页的 callout」这条用例直接构建失败。
_FIGURE_CELL = TableStyle([
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
])


#: Left+right cell padding used by `table()`, in points. Needed when measuring
#: natural column widths, so the measurement and the style cannot drift apart.
_CELL_PAD = 10
#: Narrowest a column may become when a table genuinely exceeds the text column.
#: Roughly four CJK glyphs plus padding — below this a header like 同比 breaks.
_COL_MIN = 16 * mm
#: The derived-column scan and the tag pattern live in ``rules.py``: the DOCX
#: backend refuses the same exhibit for the same reason, and a second copy of
#: either pattern is a second rule.
_DERIVED_HEADER = rules.DERIVED_HEADER
_CELL_TAG = rules.CELL_TAG


def _plain(value: object) -> str:
    """Cell text with reportlab inline markup stripped, for measurement.

    Provenance chips arrive as `<font color=…>[披露]</font>`, so measuring the raw
    string counts the tag and overstates the column by more than the chip itself.

    Delegates to `inline.plain`, which is the same parser the DOCX backend renders
    with — one reading of the markup, so a tag the measurement ignores cannot be a
    tag the other backend styles. It also resolves entity references, so a
    query-string URL in a cell measures as the `&` reportlab prints rather than as
    the five characters `&amp;` occupies.
    """
    if isinstance(value, Paragraph):
        value = getattr(value, "text", "")
    return inline.plain(value)


def _column_widths(rows: list[list], font_size: float) -> list[float]:
    """Distribute the text column in proportion to what each column must hold.

    The old default was `CONTENT_W / ncol` — equal shares regardless of content —
    and it wrecked exactly the tables this repo produces most. Measured on a real
    6-column 财务速览: the label column needed 34.2mm and got 25.5mm, so
    「经营活动现金流净额(亿元)」 wrapped to three lines, while each数值 column got
    25.5mm for 17–19mm of content. The table's natural width was **153mm against
    174mm available** — it fitted; the shares were simply wrong. Worse, a starved
    numeric column let `wordWrap='CJK'` break *inside a number*, and `1,406.30`
    printed as `1,40` / `6.30`, which a reader can misread as a different figure.

    Proportional allocation fixes both directions at once: with room to spare every
    column grows (so numbers stop breaking), and when a table really is too wide
    every column shrinks together instead of one column absorbing it all.
    """
    ncol = max(len(r) for r in rows)
    natural = []
    for c in range(ncol):
        widest = 0.0
        for row in rows:
            if c >= len(row):
                continue
            text = _plain(row[c])
            try:
                widest = max(widest, stringWidth(text, fonts.REGULAR, font_size))
            except Exception:  # noqa: BLE001 — an unregistered font must not break layout
                widest = max(widest, len(text) * font_size * 0.6)
        natural.append(widest + _CELL_PAD)

    total = sum(natural) or 1.0
    scaled = [CONTENT_W * n / total for n in natural]

    # Proportional scaling can starve a narrow column when one column dominates,
    # so lift anything under the floor and take it back from the widest columns.
    deficit = sum(max(0.0, _COL_MIN - w) for w in scaled)
    if deficit and ncol > 1:
        scaled = [max(w, _COL_MIN) for w in scaled]
        donors = sorted(range(ncol), key=lambda i: scaled[i], reverse=True)
        for i in donors:
            if deficit <= 0:
                break
            spare = max(0.0, scaled[i] - _COL_MIN)
            take = min(spare, deficit)
            scaled[i] -= take
            deficit -= take
    return scaled


def _fit_widths(widths: list[float]) -> list[float]:
    """Normalise caller-supplied column widths to exactly the text column.

    Scales in **both** directions, keeping the caller's proportions. Overflow was
    always handled; under-fill was not, and that is the more damaging half.

    `col_widths` is in **points**, because that is what reportlab consumes — but
    the natural thing to write is millimetres, and nothing in the signature said
    otherwise. A real 8-column 持仓明细 arrived as
    `col_widths=[30, 19, 17, 17, 20, 24, 20, 19]`: it sums to 166, which reads as
    "166mm out of 174mm available" and is plainly what the caller meant. Read as
    points it is **58.6mm — 34% of the text column**. Every column was then far
    below `_COL_MIN`, `wordWrap='CJK'` broke inside the values, and `-1.45%`
    printed down five lines as `-` `1.` `4` `5` `%`. An 8-row table filled a page.

    Scaling up removes the whole class: whether the caller wrote mm, points, or
    relative weights like `[3, 2, 2, 2]`, the proportions are honoured and the
    table occupies the column it is supposed to. `_column_widths` (the default
    path) already allocates exactly `CONTENT_W`, so full width is the norm here,
    not a special case — a table narrower than the text column is a defect, never
    an intent.
    """
    total = sum(widths)
    if total <= 0:
        return widths
    return [w * CONTENT_W / total for w in widths]


def _pack_pages(heights: list[float], first_avail: float, later_avail: float,
                tail: float = 0.0) -> int:
    """Pages a run of indivisible blocks occupies, first-fit down the column.

    This is only a faithful model because every Sources entry is atomic — the
    blocks cannot be split, so "does it fit, else next page" is the whole of
    reportlab's decision and the count is arithmetic rather than a guess. Used to
    choose the list's metrics before anything is laid out (see
    ``Report._ref_metrics``); ``tail`` is the disclaimer block, which has to land
    somewhere and can push the count by one on its own.
    """
    pages = 1
    avail = first_avail
    for height in list(heights) + ([tail] if tail else []):
        if height > avail:
            pages += 1
            avail = later_avail
        avail -= height
    return pages


class _FittedFigure(Table):
    """A caption+image+note group that shrinks into the space left on the page
    instead of jumping off it.

    platypus has no float mechanism — a story is strictly linear — so when an
    unsplittable figure group does not fit the foot of a page, the group moves to
    the next page and nothing flows back to fill what it left behind. The group
    runs to about 103mm (the 88mm height cap plus caption, note and spacing)
    against a 259mm column, so the hole reaches **40% of a page**. ``verify.py``
    cannot see it: such a page still renders ~9% ink, far above ``INK_FLOOR``,
    which is tuned to catch a stranded caption. So it has to be prevented here.

    Three properties matter, and each is a bug avoided rather than a preference:

    * **Measured from natural size on every wrap.** reportlab calls ``wrap`` more
      than once per flowable — keepWithNext measurement, then the frame, then
      again on the next page if it moved. Scaling from the *current* size would
      compound across those calls, so the figure would shrink a little further on
      each pass and the built size would depend on how many times it was asked.
    * **Never scaled past the legibility floor.** Below ``min_width`` the chart's
      own labels fall under ``theme.FIG_MIN_TEXT_PT`` on paper. The figure then
      keeps its natural size and takes the page break after all — an illegible
      exhibit is worse than a gap, and the policy says so explicitly.
    * **Natural size still fits a full page**, guaranteed by ``FIG_H_CAP``. This
      is load-bearing: ``references/pitfalls.md`` records that an atomic Table
      which fits nowhere makes reportlab loop rather than split or raise.

    Subclassing ``Table`` rather than wrapping one is equally deliberate. An
    ``_ktAllow``-admitted class is what lets a preceding heading bind to the
    figure, which is the entire reason ``_atomic`` is a Table — see its docstring
    and ``selftest.orphan_heading_sweep``.
    """

    def __init__(self, parts: list, image: Image, min_width: float):
        super().__init__([[parts]], colWidths=[CONTENT_W])
        self.setStyle(_FIGURE_CELL)
        self._image = image
        self._natural_w = float(image.drawWidth)
        self._natural_h = float(image.drawHeight)
        self._min_width = float(min_width)

    @property
    def shrunk(self) -> bool:
        """Whether the last ``wrap`` scaled the image down. For tests and QA."""
        return self._image.drawWidth < self._natural_w - 0.01

    @property
    def image_width(self) -> float:
        """The image's current on-page width. For tests and QA."""
        return float(self._image.drawWidth)

    def _set_width(self, width: float) -> None:
        self._image.drawWidth = width
        self._image.drawHeight = width * self._natural_h / self._natural_w

    def wrap(self, availWidth, availHeight):
        self._set_width(self._natural_w)
        width, height = super().wrap(availWidth, availHeight)
        if height <= availHeight or self._natural_w <= self._min_width:
            return width, height

        # Caption and note wrap to the cell width, never to the image width, so
        # everything except the image is a constant here and the target follows
        # by subtraction.
        target_h = availHeight - (height - self._image.drawHeight)
        candidate = target_h * self._natural_w / self._natural_h
        if candidate <= 0 or candidate < self._min_width:
            return width, height

        self._set_width(min(candidate, self._natural_w))
        width, height = super().wrap(availWidth, availHeight)
        if height > availHeight:
            # Rounding landed on the wrong side of the frame. Restore rather than
            # iterate: one more pass could oscillate, and moving the figure is a
            # correct outcome.
            self._set_width(self._natural_w)
            return super().wrap(availWidth, availHeight)
        return width, height


class Report:
    """Build a paginated research deliverable.

    Every string parameter that used to be a literal buried in a one-off script
    — title, header, footer disclaimer, cutoff date, output path — is a
    parameter here. That is the whole difference between a report and a template.
    """

    def __init__(
        self,
        out: str | Path,
        title: str,
        *,
        subtitle: str = "",
        header_right: str = "",
        footer_note: str = "",
        author: str = "",
        charts_dir: str | Path = "charts",
        locale: str = "zh-CN",
    ):
        self.out = Path(out)
        if self.out.suffix.lower() == ".docx":
            raise ValueError(
                f"Report builds a PDF, so it cannot write {self.out.name!r}. Use "
                "fin_report.DocxReport — it takes the same calls. The switch is "
                "explicit rather than inferred from the suffix because the two "
                "backends do not verify to the same depth: pagination, foot gaps "
                "and per-page renders exist on this path and, on the DOCX path, "
                "only where LibreOffice is installed."
            )
        self.title = title
        self.subtitle = subtitle
        self.header_right = header_right
        self.footer_note = footer_note
        self.author = author
        self.charts_dir = Path(charts_dir)
        self.locale = locale

        fonts.register_reportlab()
        cjk.install()
        self.s = theme.styles()
        self.refs = Refs(locale=locale)
        self.story: list = []
        self._meta = charts.read_meta(self.charts_dir)
        self._sources_started = False
        #: Provenance tags emitted through ``tagged()``. The page-1 legend is
        #: rendered from this set at build time rather than from a list the author
        #: retypes, so it cannot list a tag the document does not use or omit one
        #: it does (``provenance.md``: "listing only the tags that actually appear").
        self._tags_used: set[str] = set()
        #: Where ``legend()`` asked to be placed — ``None`` until it is called,
        #: then ``"lead"`` or ``"cover"``. The author does not choose a *story
        #: position*: both landing sites are computed in ``cover()``, because an
        #: author-positioned legend lands wherever the call happened to sit and in
        #: the 2026-08-24 batch that was directly under the first section heading
        #: in 12 of 14 documents — the legend read as the opening line of 核心观点.
        self._legend_placement: str | None = None
        self._legend_extra = ""
        #: Story index for the legend's two legal sites, set by ``cover()``:
        #: the foot of the cover, and the head of the first content page. Both
        #: stay ``None`` when there is no cover, and ``_resolve_legend()`` then
        #: falls back to index 0 — still ahead of the first heading.
        self._legend_cover_at: int | None = None
        self._legend_lead_at: int | None = None
        #: Captions of tables that name a derived column and carry no provenance
        #: tag in any cell. Collected here and raised in ``build()`` rather than in
        #: ``table()`` so an author sees every offending exhibit at once instead of
        #: fixing them one traceback at a time.
        self._untagged_tables: list[str] = []
        #: (leading, spaceAfter) the Sources list was actually set at, chosen by
        #: measurement in sources(). Exposed so a test can assert that the common
        #: case keeps the loosest setting rather than silently tightening.
        self.ref_metrics: tuple[float, float] = theme.REF_STEPS[0]
        #: Height of the cover's navy band, measured from the title block in
        #: cover(). A fixed height silently clipped a two-line title or let the
        #: subtitle straddle the band's edge — which is what a 66mm constant did.
        self._cover_band = 66 * mm
        #: Whether ``cover()`` was called. Read by ``_templates`` to decide which
        #: page template the document *opens* on — not a cosmetic flag: with the
        #: cover template registered first unconditionally, a cover-less
        #: deliverable drew its body pages inside the cover's navy band.
        self._has_cover = False

    # ------------------------------------------------------------ furniture
    def _cover_bg(self, canvas, doc) -> None:
        band = self._cover_band
        canvas.saveState()
        canvas.setFillColor(theme.hex_to_color(theme.NAVY))
        canvas.rect(0, PAGE_H - band, PAGE_W, band, fill=1, stroke=0)
        canvas.setFillColor(theme.hex_to_color(theme.GOLD))
        canvas.rect(0, PAGE_H - band - 3 * mm, PAGE_W, 3 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#F4F6F8"))
        canvas.rect(0, 0, PAGE_W, 42 * mm, fill=1, stroke=0)
        canvas.restoreState()

    def _page_bg(self, canvas, doc) -> None:
        grey = theme.hex_to_color(theme.GREY)
        canvas.saveState()
        canvas.setStrokeColor(theme.hex_to_color(theme.GRID))
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN_L, PAGE_H - 13 * mm, PAGE_W - MARGIN_R, PAGE_H - 13 * mm)
        canvas.setFont(fonts.REGULAR, 7.6)
        canvas.setFillColor(grey)
        canvas.drawString(MARGIN_L, PAGE_H - 11.5 * mm, self.title)
        if self.header_right:
            canvas.drawRightString(PAGE_W - MARGIN_R, PAGE_H - 11.5 * mm, self.header_right)
        canvas.line(MARGIN_L, MARGIN_B - 4 * mm, PAGE_W - MARGIN_R, MARGIN_B - 4 * mm)
        if self.footer_note:
            canvas.drawString(MARGIN_L, MARGIN_B - 8 * mm, self.footer_note)
        label = "第 %d 页" if self.locale.startswith("zh") else "Page %d"
        canvas.drawRightString(PAGE_W - MARGIN_R, MARGIN_B - 8 * mm, label % doc.page)
        canvas.restoreState()

    def _templates(self, doc: BaseDocTemplate) -> None:
        """Register the page templates, **cover first only if there is a cover.**

        reportlab starts a document on the *first* template registered, and the
        only thing that ever switches to ``main`` is ``cover()`` (and
        ``sources()``, which emits its own). So with ``cover`` registered first
        unconditionally, a deliverable that does not call ``cover()`` drew its
        **body pages with the cover's furniture**: the 66mm navy band and the 42mm
        grey foot behind the text, and no running header, footer or page number,
        until ``sources()`` finally switched templates.

        Shipped 2026-08-26 in a four-page 晨会纪要: pages 1–2 carried the band,
        page 3 onward did not, and 「表1 池内六标的」 — a caption in ``theme.NAVY``,
        by style — landed *inside* the navy band and was **invisible**. The page-1
        legend, grey on navy, was close behind. Nothing caught it: ``verify.py``
        passed the file, because a band is ink and the caption is present in the
        text layer.

        Ordering by ``_has_cover`` fixes it without touching the cover path: with
        a cover the registration order is unchanged, so a report that calls
        ``cover()`` builds byte-for-byte as before.
        """
        frame_kw = dict(leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        height = PAGE_H - MARGIN_T - MARGIN_B
        cover = PageTemplate(
            id="cover", onPage=self._cover_bg,
            frames=[Frame(MARGIN_L, MARGIN_B, CONTENT_W, height, id="cover", **frame_kw)])
        main = PageTemplate(
            id="main", onPage=self._page_bg,
            frames=[Frame(MARGIN_L, MARGIN_B, CONTENT_W, height, id="main", **frame_kw)])
        doc.addPageTemplates([cover, main] if self._has_cover else [main, cover])

    # ------------------------------------------------------------ content
    def cover(self, *, meta_lines: list[str] | None = None,
              kpis: list[tuple[str, str]] | None = None) -> None:
        """The cover, then a hard break onto the main template.

        The navy band is sized to the title block it has to contain, measured by
        wrapping the paragraphs. Anything else clips or straddles as soon as a
        title runs to two lines.

        **Optional, but not by default.** A research deliverable has a cover. The
        exception is a note whose owning skill declares that it opens on its first
        sentence — ``write-research``'s ``morning-note`` — and it then simply does
        not call this; the title still reaches the reader, in the running header
        ``_page_bg`` draws on every page. Neither direction is a free choice: do
        not add a cover to that note "for consistency", and do not drop one from a
        report because the report came out short.
        """
        top_gap, title_gap, band_pad = 20 * mm, 8 * mm, 10 * mm
        self._has_cover = True

        title = Paragraph(self.title, self.s["cover_title"])
        _, title_h = title.wrap(CONTENT_W, PAGE_H)
        band = MARGIN_T + top_gap + title_h

        self.story += [Spacer(1, top_gap), title]
        if self.subtitle:
            subtitle = Paragraph(self.subtitle, self.s["cover_sub"])
            _, subtitle_h = subtitle.wrap(CONTENT_W, PAGE_H)
            band += title_gap + subtitle_h
            self.story += [Spacer(1, title_gap), subtitle]
        self._cover_band = band + band_pad

        self.story.append(Spacer(1, 40 * mm))
        for line in meta_lines or []:
            self.story.append(Paragraph(line, self.s["cover_meta"]))
        if kpis:
            self.story += [Spacer(1, 8 * mm), self._kpi_strip(kpis)]
        self._legend_cover_at = len(self.story)
        self.story += [NextPageTemplate("main"), PageBreak()]
        self._legend_lead_at = len(self.story)

    def _kpi_strip(self, kpis: list[tuple[str, str]]) -> Table:
        values = [Paragraph(v, self.s["kpi"]) for v, _ in kpis]
        labels = [Paragraph(l, self.s["kpi_label"]) for _, l in kpis]
        table = Table([values, labels], colWidths=[CONTENT_W / len(kpis)] * len(kpis))
        table.setStyle(TableStyle([
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, 0), 4),
            ("BOTTOMPADDING", (0, 1), (-1, 1), 6),
            ("LINEABOVE", (0, 0), (-1, 0), 1.2, theme.hex_to_color(theme.GOLD)),
            ("LINEBELOW", (0, 1), (-1, 1), 0.5, theme.hex_to_color(theme.GRID)),
        ]))
        return table

    def h1(self, text: str, rule: bool = True) -> None:
        self.story.append(Paragraph(text, self.s["h1"]))
        if rule:
            divider = HRFlowable(width="100%", thickness=1.2,
                                 color=theme.hex_to_color(theme.GOLD), spaceAfter=8)
            # The h1 style carries keepWithNext, but its "next" flowable is this
            # rule — so without the rule also carrying it the chain stops here
            # and heading+rule strand together, one line above the content.
            divider.keepWithNext = 1
            self.story.append(divider)

    def h2(self, text: str) -> None:
        self.story.append(Paragraph(text, self.s["h2"]))

    def p(self, text: str, align_left: bool = False) -> None:
        self.story.append(Paragraph(text, self.s["body_left" if align_left else "body"]))

    def bullets(self, items: list[str]) -> None:
        for item in items:
            self.story.append(Paragraph(f"• {item}", self.s["bullet"]))

    def note(self, text: str) -> None:
        self.story.append(Paragraph(text, self.s["note"]))

    def chip(self, tag: str, size: float = theme.CHIP_PT) -> str:
        """A provenance chip, ready to concatenate into any text this class takes.

        Forwards to ``theme.chip`` so a report script never has to import
        ``theme`` just to tag a number, and so there is exactly one place the
        colour and the size are decided. Use it everywhere a tag appears —
        paragraphs, bullets, table cells, figure notes, callout items:

            rep.p(f"毛利率 24.82%{rep.chip('披露')}{cite}，环比 -3.39pct{rep.chip('测算')}。")
            rows.append(["单位净利", f"0.104 元/Wh{rep.chip('测算')}"])

        Never hand-write the markup. Not because the renderer cannot cope —
        ``_plain`` strips inline tags before measuring, so a hand-rolled chip
        measures the same — but because the colour, the size and the set of
        legal tags then live in as many places as there are report scripts,
        which is how one batch shipped three different renderings of the same
        five tags.

        **In prose, prefer ``tagged()``.** Both examples above bind each chip to
        its own figure, which is the point; ``chip()`` alone cannot express that
        binding, and the two ways of writing around it — stacking every class at
        the end of a clause, or hoisting a bare tag to the front of a bullet —
        are the defects ``tagged()`` exists to make unwritable.

        This records the tag, which is why it is no longer a ``staticmethod``:
        the page-1 legend is built from the tags the document actually used, and
        a gate only ``tagged()`` fed would be satisfied by writing ``chip()``
        instead. Both funnel here; ``theme.chip()`` called directly bypasses the
        record, and ``verify.py`` catches that on the built file.
        """
        self._tags_used.add(rules.normalise_tag(tag))
        return theme.chip(tag, size)

    def tagged(self, value: str, tag: str, size: float = theme.CHIP_PT) -> str:
        """One figure with its own chip bound to it — see ``theme.tagged``.

        Recording the tag here is what lets ``legend()`` be built from what the
        document actually used and ``build()`` refuse a tagged deliverable with
        no legend.
        """
        markup = theme.tagged(value, tag, size)
        self._tags_used.add(rules.normalise_tag(tag))
        return markup

    def legend(self, extra: str = "", placement: str = "lead") -> None:
        """Request the provenance legend; ``build()`` places and fills it in.

        Call it once, anywhere before ``build()`` — the call site does **not**
        decide where the legend appears. That is the whole point of the signature.
        Written as a story append it landed wherever the author happened to call
        it, and every author calls it right after the first heading, which is how
        12 of 14 documents in the 2026-08-24 batch printed the 标签口径 line as the
        opening sentence of 核心观点 / 执行摘要 / 摘要. A reading key is not content;
        the two places it can be read as document apparatus rather than as prose
        are the foot of the cover and the head of the first content page, above
        the first heading. Both are computed in ``cover()``:

        - ``placement="lead"`` (default) — head of the first content page, in its
          own ruled block, before the first heading.
        - ``placement="cover"`` — foot of the cover, under the KPI strip, with the
          rest of the document's apparatus (dates, rating, disclaimer).

        The text cannot be composed yet — it lists only the tags the document
        turns out to use — so ``build()`` renders it against the final tag set.
        ``provenance.md`` requires the legend; ``build()`` enforces it and
        ``verify.py`` re-checks placement and content on the built file.
        """
        if self._legend_placement is not None:
            raise ValueError("legend() was already called — one legend per document")
        problem = rules.legend_placement_problem(
            placement, has_cover=self._legend_cover_at is not None)
        if problem:
            raise ValueError(problem)
        self._legend_placement = placement
        self._legend_extra = extra

    def _legend_block(self, text: str) -> Table:
        """The legend as its own ruled block, so it cannot read as body prose.

        A bare ``Paragraph`` in the ``note`` style is what let the legend blend
        into the section it was mistakenly placed inside. Hairlines above and
        below mark it as apparatus at a glance, at the cost of two rules.
        """
        block = Table([[Paragraph(text, self.s["note"])]], colWidths=[CONTENT_W])
        block.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LINEABOVE", (0, 0), (-1, 0), 0.5, theme.hex_to_color(theme.GRID)),
            ("LINEBELOW", (0, -1), (-1, -1), 0.5, theme.hex_to_color(theme.GRID)),
        ]))
        return block

    def _resolve_legend(self) -> None:
        """Render the legend over the tags actually used, at its computed site."""
        tags = set(self._tags_used)
        problem = rules.legend_problem(tags, self._legend_placement)
        if problem:
            raise ValueError(problem)
        if self._legend_placement is None:
            return
        text = theme.legend(tags, self.locale, extra=self._legend_extra)
        if self._legend_placement == "cover":
            index = self._legend_cover_at
        else:
            index = self._legend_lead_at if self._legend_lead_at is not None else 0
        self.story.insert(index, self._legend_block(text))

    def _pop_pending_heading(self) -> list:
        """Detach a just-emitted heading so a ``KeepTogether`` block can carry it.

        ``keepWithNext`` only extends a heading's group to the next flowable if
        reportlab's ``_ktAllow`` admits that flowable, and ``_ktAllow`` rejects
        ``KeepTogether``. ``figure()`` escapes this by being a ``Table`` subclass
        (see ``_atomic``), but ``table()`` and ``callout()`` must stay splittable
        — an unbounded flowable made atomic makes reportlab loop rather than
        split (``references/pitfalls.md``). So for those two the only way to keep
        the heading with its content is to move the heading *inside* the group,
        which is what ``table(heading=...)`` has always done by hand.

        Doing it by hand only works when the author remembers. Written the
        natural way — ``rep.h2("…")`` then ``rep.table(…)`` — the heading is a
        separate flowable that cannot bind, and lands alone at the foot of a
        page. Measured 2026-08-18 with a 15-length filler sweep: **1/15 for
        ``table`` and 1/15 for ``callout``**, while ``p`` and ``bullets``, which
        are ``_ktAllow``-admitted, were 0/15. Intermittent by construction — it
        depends on exactly how much column is left — which is why it survives
        casual review and why the sweep, not an eyeball, is the regression test.

        Returns the detached flowables (heading, plus ``h1``'s rule) in order, or
        an empty list when the story does not end in a heading.
        """
        if not self.story:
            return []
        end = len(self.story)
        # h1 emits Paragraph + HRFlowable; the rule travels with its heading.
        if isinstance(self.story[-1], HRFlowable):
            end -= 1
        if end == 0:
            return []
        candidate = self.story[end - 1]
        heading_styles = {self.s[name].name for name in ("h1", "h2") if name in self.s}
        if not (isinstance(candidate, Paragraph)
                and getattr(candidate.style, "name", None) in heading_styles):
            return []
        detached = self.story[end - 1:]
        del self.story[end - 1:]
        return detached

    # ------------------------------------------------------------ grouping
    def _atomic(self, parts: list):
        """Group flowables so they cannot be split, AND so a heading can bind.

        The obvious tool is ``KeepTogether``, and that is what this used to be —
        but reportlab's ``handle_keepWithNext`` only extends a heading's group to
        the next flowable if ``_ktAllow`` admits it, and ``_ktAllow`` rejects
        ``_ContainerSpace``, of which ``KeepTogether`` is a subclass. So a
        heading with ``keepWithNext`` followed by a ``KeepTogether`` silently got
        a group containing only itself, and headings stranded at page feet with
        no error. Verified against reportlab 4.5.1.

        A one-cell borderless Table groups identically and *is* admitted, so the
        heading binds. Use it only for content that always fits on a page:
        wrapping an oversized flowable this way makes reportlab loop rather than
        split or raise. Long tables therefore keep KeepTogether — see table().
        """
        cell = Table([[parts]], colWidths=[CONTENT_W])
        cell.setStyle(_FLUSH_CELL)
        return cell

    # ------------------------------------------------------------ figures
    def figure_width(self, name: str) -> tuple[float, float]:
        """Display size for a chart: density picks the width, a cap bounds height."""
        meta = self._meta.get(name) or {}
        elements = int(meta.get("elements", 8))
        panels = int(meta.get("panels", 1))
        aspect = float(meta.get("aspect_wh") or 0) or 1.6

        width = theme.FIG_W_TIERS[-1][1]
        for ceiling, tier_width in theme.FIG_W_TIERS:
            if elements <= ceiling:
                width = tier_width
                break
        if panels >= 2:
            width = max(width, theme.FIG_W_MULTIPANEL_MIN)
        width = min(width, CONTENT_W)

        height = width / aspect
        if height > theme.FIG_H_CAP:
            height = theme.FIG_H_CAP
            width = height * aspect
        return width, height

    def min_figure_width(self, name: str) -> float:
        """The narrowest this figure may be drawn before its own labels drop below
        ``theme.FIG_MIN_TEXT_PT`` on the page.

        Display sizing scales the whole canvas, labels included: a label drawn at
        ``base_pt`` on a canvas ``fig_w_in`` wide prints at
        ``base_pt * display_width / fig_w_in``. Solving that for the floor gives
        this width. Both inputs come from the chart's own sidecar, so a chart
        drawn at a different size or font size gets a different floor instead of
        one hard-coded here.

        Returns ``inf`` when the sidecar cannot supply them: an unidentified
        figure gets **no** shrink budget rather than an assumed one. Note this is
        routinely above the density tier width for sparse charts — a two-bar chart
        shown at 92mm is already under the floor — and those figures therefore do
        not shrink at all. That is the intended reading of the policy, not an
        oversight: the fix for them is to author the canvas smaller, not to scale
        a wide canvas down further.
        """
        meta = self._meta.get(name) or {}
        authored = float(meta.get("fig_w_in") or 0) * inch
        base_pt = float(meta.get("base_pt") or 0) or theme.CHART_BASE_PT
        if authored <= 0 or base_pt <= 0:
            return float("inf")
        return authored * (theme.FIG_MIN_TEXT_PT / base_pt)

    def figure(self, name: str, caption: str, note: str | None = None,
               allow_duplicate_title: bool = False) -> None:
        """Caption above, image centred beneath it, the whole thing unbreakable.

        The source is stated exactly once, and ``note`` is where it goes. Do not
        also call ``charts.source`` on the figure: that bakes the attribution
        into the PNG, where it cannot be selected, corrected, or made clickable,
        and the exhibit then prints 资料来源 twice. ``charts.source`` is for a
        chart delivered standalone, with no note line to carry it
        (the house formatting policy).

        The title is likewise stated once. If the chart already carries an
        in-canvas matplotlib title, passing a caption here would print the same
        sentence twice; that raises rather than shipping a duplicate.
        """
        path = self.charts_dir / name
        if not path.is_file():
            raise FileNotFoundError(
                f"{path} does not exist — render the charts before building the PDF"
            )
        meta = self._meta.get(name) or {}
        if caption and meta.get("titled") and not allow_duplicate_title:
            raise ValueError(
                f"{name} already has an in-canvas title, so adding the caption "
                f"{caption!r} would print the title twice. Drop the "
                "charts.title(...) call and let the caption be the title, or pass "
                "allow_duplicate_title=True if you really want both."
            )
        width, height = self.figure_width(name)
        image = Image(str(path), width=width, height=height)
        image.hAlign = "CENTER"
        block = [Paragraph(caption, self.s["caption"]), image]
        if note:
            block.append(Paragraph(note, self.s["note"]))
        # A Table subclass rather than KeepTogether so a preceding heading binds
        # (see _atomic), and a *fitted* one so the group shrinks into the space
        # left on the page instead of stranding it (see _FittedFigure).
        figure = _FittedFigure(block, image, self.min_figure_width(name))
        # Spacing deliberately sits OUTSIDE the group. Space held inside an
        # unbreakable block is counted when deciding whether the block fits and is
        # then printed even against a page boundary; frame-level space collapses
        # there instead. It also returns ~9pt to the fit budget, which is often
        # the entire shortfall.
        figure.spaceBefore = 2
        figure.spaceAfter = 7
        self.story.append(figure)

    # ------------------------------------------------------------ tables
    def table(
        self,
        rows: list[list],
        *,
        caption: str = "",
        note: str = "",
        heading: str | None = None,
        col_widths: list[float] | None = None,   # 相对比例即可，会归一到文本列宽
        header: bool = True,
        align_center: tuple[int, int] | None = None,
        font_size: float = 8.3,
    ) -> None:
        """A document table: header fill, zebra rows, thin grid, no vertical rules.

        Cells may be strings or Paragraphs. Strings are wrapped in Paragraphs —
        a bare string in a reportlab Table does not wrap, does not honour
        wordWrap='CJK', and does not render ``[n]`` links, so a long Chinese cell
        overflows its column silently.

        **A table naming a derived column must carry a tag somewhere in it.** The
        finding is recorded here and raised by ``build()``; see ``_DERIVED_HEADER``
        for why the built-file verifier cannot settle it.
        """
        self._record_table_provenance(rows, caption=caption, note=note,
                                      heading=heading, header=header)
        navy = theme.hex_to_color(theme.NAVY)
        data = []
        for r, row in enumerate(rows):
            out_row = []
            for c, value in enumerate(row):
                if isinstance(value, str):
                    is_header = header and r == 0
                    centred = is_header or (align_center and align_center[0] <= c <= align_center[1])
                    value = Paragraph(value, theme.cell_style(
                        size=font_size,
                        align=TA_CENTER if centred else TA_LEFT,
                        bold=is_header,
                        color="#FFFFFF" if is_header else theme.INK,
                    ))
                out_row.append(value)
            data.append(out_row)

        table = Table(
            data,
            colWidths=_fit_widths(col_widths) if col_widths
            else _column_widths(rows, font_size),
            # A table crossing a page break must not lose its header.
            repeatRows=1 if header else 0,
        )
        style = [
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            # Horizontal rules only. the house formatting policy: document tables
            # carry no vertical rules — that is a spreadsheet convention, and
            # reportlab's GRID draws both.
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, theme.hex_to_color(theme.GRID)),
        ]
        if header:
            style += [
                ("BACKGROUND", (0, 0), (-1, 0), navy),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1),
                 [colors.white, theme.hex_to_color(theme.ZEBRA)]),
            ]
        table.setStyle(TableStyle(style))

        block = []
        # A heading emitted just before this call cannot bind to a KeepTogether
        # from outside it; carry it inside instead (see _pop_pending_heading).
        block.extend(self._pop_pending_heading())
        if heading:
            # A long table must stay splittable, so its group has to remain a
            # KeepTogether — which means a preceding heading cannot bind to it
            # (see _atomic). Passing the heading in puts it inside the group
            # instead, which is the only way to keep the two together here.
            block.append(Paragraph(heading, self.s["h2"]))
        if caption:
            block.append(Paragraph(caption, self.s["caption"]))
        block.append(table)
        if note:
            block.append(Paragraph(note, self.s["note"]))
        block.append(Spacer(1, 6))
        self.story.append(KeepTogether(block))

    def _record_table_provenance(self, rows: list[list], *, caption: str,
                                 note: str, heading: str | None,
                                 header: bool) -> None:
        """Note a derived column, or a derived row, that tags nothing.

        The scan itself is ``rules.untagged_columns`` — the DOCX backend refuses
        the same exhibit, and its docstring holds the 分部 case that set the
        per-column scope.

        Not raised here. An author fixing exhibits one traceback at a time re-runs
        the whole build per table; ``build()`` reports them together.
        """
        offenders = rules.untagged_columns(rows, header=header)
        if offenders:
            self._untagged_tables.append(
                f"{rules.where(rows, caption, heading)} → {' / '.join(offenders[:4])}"
            )

    def callout(self, heading: str, items: list[str]) -> None:
        """A boxed key-judgements panel.

        Grouped with ``KeepTogether`` and given ``repeatRows=1``, **not**
        ``_atomic`` — a callout's height grows with ``items`` and is therefore
        unbounded, which is exactly the case ``_atomic``'s docstring and
        ``references/pitfalls.md`` rule out: an oversized flowable in a one-cell
        table makes reportlab loop instead of splitting or raising. A long panel
        that cannot fit the space left now splits across the break with its
        heading repeated, and a panel taller than a whole page still renders
        instead of hanging.

        This also removes a foot-gap source. As an atomic block, a panel one line
        too tall for the remaining column moved wholesale to the next page and
        stranded everything above it; splitting keeps the page full.
        """
        navy = theme.hex_to_color(theme.NAVY)
        rows = [[Paragraph(heading, theme.cell_style(10, TA_LEFT, True, "#FFFFFF"))]]
        rows += [[Paragraph(f"• {item}", theme.cell_style(8.4, TA_LEFT))] for item in items]
        table = Table(rows, colWidths=[CONTENT_W], repeatRows=1)
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, 0), navy),
            ("ROWBACKGROUNDS", (0, 1), (0, -1),
             [theme.hex_to_color(theme.ZEBRA), colors.HexColor("#FAFBFC")]),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("BOX", (0, 0), (-1, -1), 0.5, theme.hex_to_color(theme.GRID)),
        ]))
        self.story.append(KeepTogether(self._pop_pending_heading()
                                       + [table, Spacer(1, 7)]))

    # ------------------------------------------------------------ sources
    def _placed_markers(self) -> set[int]:
        """Entry numbers whose ``[n]`` marker actually appears in the story.

        ``refs.marker()`` renders every marker as ``href="#ref<n>"``, so the
        anchor is the reliable thing to count — it survives the ``<super>``
        wrapper and cannot be confused with a bracketed number that is part of
        the prose. Walks the containers this module builds (``KeepTogether``,
        ``Table`` and its subclasses) so a marker cited only inside a table cell,
        a figure note, or a callout still counts.
        """
        seen: set[int] = set()

        def walk(node) -> None:
            if isinstance(node, Paragraph):
                seen.update(int(n) for n in
                            re.findall(r"#ref(\d+)", getattr(node, "text", "") or ""))
            elif isinstance(node, (list, tuple)):
                for item in node:
                    walk(item)
            elif isinstance(node, Table):
                walk(getattr(node, "_cellvalues", []))
            elif isinstance(node, KeepTogether):
                walk(getattr(node, "_content", []))

        walk(self.story)
        return seen

    def sources(self, heading: str | None = None, preamble: str = "",
                disclaimer: str = "") -> None:
        """The Sources section, on its own page. Raises on a policy violation.

        The list's leading is **measured, not fixed**. Every entry is an
        indivisible block here (see ``_ref_blocks``), which makes the section's
        pagination arithmetic rather than a guess, so the loosest metrics that
        yield the fewest pages can be chosen instead of assumed. Nothing changes
        for a report whose sources already end cleanly; a report whose last
        entry would otherwise sit alone on a near-blank page pays a little
        density and loses the page. See ``theme.REF_STEPS``.
        """
        problems = self.refs.problems(placed=self._placed_markers())
        if problems:
            raise ValueError(
                "the citation registry violates the citation policy:\n  - "
                + "\n  - ".join(problems)
            )
        if not len(self.refs):
            raise ValueError(rules.NO_SOURCES)
        heading = heading or ("来源" if self.locale.startswith("zh") else "Sources")
        self.story += [NextPageTemplate("main"), PageBreak()]
        self.h1(heading)

        head = self._pending_height()
        if preamble:
            head += self._block_height(Paragraph(preamble, self.s["small"])) + 4
        leading, space_after = self._ref_metrics(head,
                                                self._disclaimer_height(disclaimer))
        self.ref_metrics = (leading, space_after)

        if preamble:
            self.story.append(Paragraph(preamble, self.s["small"]))
            self.story.append(Spacer(1, 4))
        self.story += self._ref_blocks(theme.ref_style(leading, space_after))
        if disclaimer:
            self.story += [
                Spacer(1, 6),
                HRFlowable(width="100%", thickness=0.5,
                           color=theme.hex_to_color(theme.GRID), spaceAfter=5),
                Paragraph(disclaimer, self.s["note"]),
            ]
        self._sources_started = True

    # -------------------------------------------------- sources pagination
    #: Column height available to the Sources list on a page that carries nothing
    #: else. The section always starts on a fresh page, so its first page is the
    #: only one that loses height to the heading.
    _COLUMN_H = PAGE_H - MARGIN_T - MARGIN_B

    def _block_height(self, flowable) -> float:
        """A flowable's height in the text column, including its spaceAfter.

        ``spaceAfter`` lives in two different places: on the instance for
        ``HRFlowable``, on ``.style`` for ``Paragraph`` (which carries no instance
        attribute at all — verified against reportlab 4.x, where reading the
        instance silently yields nothing and would drop 5pt per entry).

        Counting it is deliberately conservative: reportlab collapses trailing
        space at a frame boundary, so a page's true capacity is a hair more than
        this says. Over-estimating can only make the chooser keep a looser
        setting, never ship a tighter one that did not pay for itself.
        """
        _, h = flowable.wrap(CONTENT_W, self._COLUMN_H)
        after = getattr(flowable, "spaceAfter", None)
        if after is None:
            after = getattr(getattr(flowable, "style", None), "spaceAfter", 0)
        return h + (after or 0)

    def _pending_height(self) -> float:
        """Height of the heading block ``h1`` just appended — paragraph *and* its
        gold rule, which carries its own 8pt spaceAfter."""
        total = 0.0
        for node in self.story[-2:]:
            if isinstance(node, (NextPageTemplate, PageBreak)):
                continue
            style = getattr(node, "style", None)
            total += self._block_height(node) + getattr(style, "spaceBefore", 0)
        return total

    def _disclaimer_height(self, disclaimer: str) -> float:
        if not disclaimer:
            return 0.0
        return 6 + 0.5 + 5 + self._block_height(
            Paragraph(disclaimer, self.s["note"]))

    def _ref_metrics(self, head: float, tail: float) -> tuple[float, float]:
        """Pick (leading, spaceAfter) for the Sources list.

        Objective: **fewest pages, and among ties the loosest setting.** Not
        "tightest that fits" — a report whose sources already end mid-page gains
        nothing from a denser list and would only be harder to read, which is why
        this is measured per document instead of set once in the type ramp.

        Keeping the loosest on a tie is right twice over. It makes the common case
        byte-identical to what the loose metrics alone produced, and — less
        obviously — at a fixed page count the loosest setting also leaves the
        *fullest* last page: tightening packs more entries onto the earlier pages,
        so it drains the final one. Tightening only ever helps by removing a page
        outright.

        Measured across 1–69 synthetic entries: 16 counts change setting, all of
        them sitting just past a page boundary (22–25, 45–54, 68–69); the other 53
        keep the default. A defect that appears in a narrow band is exactly what a
        per-document measurement is for.
        """
        best: tuple[int, int] | None = None
        choice = theme.REF_STEPS[0]
        for rank, (leading, space_after) in enumerate(theme.REF_STEPS):
            style = theme.ref_style(leading, space_after)
            heights = [self._block_height(Paragraph(line, style))
                       for line in self.refs.lines()]
            pages = _pack_pages(heights, self._COLUMN_H - head,
                                self._COLUMN_H, tail)
            if best is None or pages < best[0]:
                best = (pages, rank)
                choice = (leading, space_after)
        return choice

    def _ref_blocks(self, style) -> list:
        """One indivisible flowable per entry.

        A bare ``Paragraph`` splits at line boundaries, so an entry's URL line —
        appended with ``<br/>`` inside the same paragraph — can be left alone at
        the top of the next page while the entry it belongs to sits on the
        previous one. Observed 2026-08-19: entry [32]'s text ended page 11 and
        its URL opened page 12, reading as an orphaned link with no source.

        Guarded on height rather than trusted: an entry taller than the column
        must stay splittable or the frame can never accept it.
        """
        out: list = []
        for line in self.refs.lines():
            para = Paragraph(line, style)
            fits = self._block_height(para) <= self._COLUMN_H
            out.append(KeepTogether([para]) if fits else para)
        return out

    # ------------------------------------------------------------ build
    def build(self) -> Path:
        if not self._sources_started and len(self.refs):
            raise ValueError(rules.SOURCES_MISSING)
        if self._untagged_tables:
            raise ValueError(rules.untagged_tables_error(self._untagged_tables))
        self._resolve_legend()
        self.out.parent.mkdir(parents=True, exist_ok=True)
        doc = BaseDocTemplate(
            str(self.out), pagesize=(PAGE_W, PAGE_H),
            leftMargin=MARGIN_L, rightMargin=MARGIN_R,
            topMargin=MARGIN_T, bottomMargin=MARGIN_B,
            title=self.title, author=self.author or "",
        )
        self._templates(doc)
        doc.build(self.story)
        return self.out
