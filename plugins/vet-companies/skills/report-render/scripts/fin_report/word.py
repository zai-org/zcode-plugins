"""The DOCX backend: the same document, in the format the reader can edit.

``doc.Report`` and ``DocxReport`` take **the same calls** — cover, legend, h1, p,
chip, tagged, figure, table, callout, sources, build — and a build script switches
format by changing one class name and one file extension. That is deliberate and
it is the reason this backend parses ``theme``'s inline markup (``inline.py``)
instead of introducing a second way to tag a number: the five provenance tags
already shipped in three renderings from one batch when the rule had two homes,
and two author-facing APIs for them would be that failure by construction.

What is *not* the same, and is not pretended to be:

* **Pagination belongs to Word.** No shrink-to-fit figure, no measured Sources
  leading, no foot-gap arithmetic — the reader's Word decides where pages break,
  so those computations would describe a layout nobody sees. ``verify.py``'s
  geometry checks therefore run on a LibreOffice-converted PDF, and say so when
  LibreOffice is absent rather than reporting a pass.
* **Line breaking belongs to Word.** ``fin_report.cjk`` exists because reportlab's
  CJK breaker is Japanese and cuts ``[标签]`` in half; Word's is correct, so this
  path does not install a breaker at all.
* **The font is named, not embedded.** A PDF without an embedded CJK font renders
  blank; a DOCX naming a font the reader lacks renders in a substitute. The
  failure is cosmetic rather than fatal, and the default is the family the PDF
  path embeds and this environment installs. See ``DEFAULT_FONT``.

Everything else — the tag vocabulary and its colours, the legend text and its two
legal sites, the Sources schema, the per-column provenance refusal, the
marker/entry parity invariant — comes from ``theme``, ``refs`` and ``rules``, so
neither format can drift from the policy without the other following.
"""
from __future__ import annotations

import re
from pathlib import Path

from reportlab.lib.units import inch, mm

from . import charts, inline, ooxml, rules, theme
from .doc import _column_widths, _fit_widths
from .ooxml import TWIP
from .refs import Refs
from .theme import CONTENT_W

#: The East Asian font named in every run — the same family the PDF path embeds, so
#: a report and the same report as a Word draft are set in one typeface.
#:
#: This is **named, not embedded**: a DOCX carries a font name and the reader's Word
#: resolves it. The first version of this backend defaulted to 微软雅黑 on the
#: reasoning that a Windows Word is the likeliest reader, and that was wrong on the
#: evidence — the environment these plugins run in installs Noto Sans SC / Noto
#: Serif SC under ``/usr/share/fonts/truetype/chinese/`` and carries no 微软雅黑, so
#: naming it meant (a) diverging from the PDF, and (b) a QA conversion rendering a
#: substituted face, i.e. a visual gate judging a document nobody authored.
#: ``verify.py`` warns when the named family is absent before a conversion, for
#: exactly that reason.
#:
#: Where the readers' machines are known — a Windows-only distribution list —
#: override with ``DocxReport(..., font="微软雅黑")``. Embedding the font instead
#: (``w:embedRegular``) would settle it for every reader and is deliberately not
#: done: one CJK static weight is ~10MB, so a two-weight ten-page memo becomes a
#: 20MB Word file.
DEFAULT_FONT = "Noto Sans SC"

#: Body type, from the PDF ramp so the two formats read the same size.
_BODY_PT = 10.0
_BODY_LINE = 15.5
#: Chip size on this path. The PDF uses ``theme.CHIP_PT`` (6.0pt), which is right on
#: paper: a printed page holds fine detail and the chip must not compete with the
#: number it annotates. A DOCX is read on screen at 100% in Word, where 6pt
#: superscript is reported as unreadable — and it is also *editable*, so a reader
#: who cannot see the tag deletes or retypes the figure without it. 7.5pt keeps the
#: chip subordinate and legible; the colour still carries the class.
DOCX_CHIP_PT = 7.5


class DocxReport:
    """Build a research deliverable as ``.docx``. Call-compatible with ``Report``.

    The constructor takes ``Report``'s parameters plus ``font``. A path that does
    not end in ``.docx`` raises, and ``Report`` raises on one that does: the two
    backends do not verify to the same depth, and a silent switch on the file
    extension would leave an author believing the layout gates ran.
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
        font: str = DEFAULT_FONT,
    ):
        self.out = Path(out)
        if self.out.suffix.lower() != ".docx":
            raise ValueError(
                f"DocxReport writes WordprocessingML, so {self.out.name!r} needs a "
                ".docx suffix. For a PDF use fin_report.Report — the two are "
                "call-compatible and differ in which verification gates exist."
            )
        self.title = title
        self.subtitle = subtitle
        self.header_right = header_right
        self.footer_note = footer_note
        self.author = author
        self.charts_dir = Path(charts_dir)
        self.locale = locale
        self.font = font

        self.refs = Refs(locale=locale)
        #: Body XML chunks, in document order — this backend's ``story``.
        self.body: list[str] = []
        self._meta = charts.read_meta(self.charts_dir)
        self._pkg = ooxml.Package(title=title, author=author, subject=subtitle)
        self._page = ooxml.Page(
            width_pt=theme.PAGE_W, height_pt=theme.PAGE_H,
            margin_left_pt=theme.MARGIN_L, margin_right_pt=theme.MARGIN_R,
            margin_top_pt=theme.MARGIN_T, margin_bottom_pt=theme.MARGIN_B,
        )
        self._sources_started = False
        self._tags_used: set[str] = set()
        self._legend_placement: str | None = None
        self._legend_extra = ""
        self._legend_cover_at: int | None = None
        self._legend_lead_at: int | None = None
        self._untagged_tables: list[str] = []
        #: Kept for surface parity with ``Report``. The PDF path *measures* the
        #: Sources list and picks the loosest metrics that save a page; here Word
        #: paginates, so the loosest is simply used and nothing is measured.
        self.ref_metrics: tuple[float, float] = theme.REF_STEPS[0]
        self._has_cover = False

    # ------------------------------------------------------------ inline
    def _runs(self, markup: object, *, size_pt: float = _BODY_PT,
              color: str = theme.INK, bold: bool = False,
              font: str | None = None) -> str:
        """Inline markup → ``w:r`` elements, links and bookmarks included.

        Size and colour arriving from the markup win over the block's defaults:
        that is what makes a 6pt green chip inside 10pt ink-coloured prose one
        call rather than two.
        """
        out: list[str] = []
        pending_bookmark: str | None = None
        for piece in inline.parse(markup):
            # Superscripts get a floor on this path. `theme` sizes chips at 6pt and
            # `refs.marker` sets `[n]` at 7pt — right on paper, too small on a screen
            # at 100%, which is where a Word draft is read and edited. The floor
            # applies to the DOCX backend only; the PDF ramp is untouched.
            raised = piece.superscript or piece.subscript
            size = piece.size or size_pt
            props = dict(
                font=font or self.font,
                size_pt=max(size, DOCX_CHIP_PT) if raised else size,
                color=piece.color or color,
                bold=bold or piece.bold,
                italic=piece.italic,
                superscript=piece.superscript,
                subscript=piece.subscript,
            )
            if piece.bookmark:
                # Held, not emitted: the bookmark wraps the *next* run so it has
                # content. A zero-length bookmark is legal and is what this backend
                # wrote first, but Word's own cross-reference targets always contain
                # their text, and a reader that discards an empty one leaves the
                # citation looking like a link that does nothing.
                pending_bookmark = piece.bookmark
                continue
            if piece.is_break:
                out.append(ooxml.line_break(**props))
                continue
            if piece.anchor:
                body = ooxml.hyperlink(
                    ooxml.run(piece.text,
                              **{**props, "underline": False, "style": "Hyperlink"}),
                    anchor=piece.anchor)
            elif piece.href:
                rid = self._pkg.external(piece.href)
                body = ooxml.hyperlink(
                    ooxml.run(piece.text, **{**props, "style": "Hyperlink"}), rid=rid)
            else:
                body = ooxml.run(piece.text, **props)
            if pending_bookmark:
                ident = self._pkg.ident()
                body = (f'<w:bookmarkStart w:id="{ident}" '
                        f'w:name="{pending_bookmark}"/>{body}'
                        f'<w:bookmarkEnd w:id="{ident}"/>')
                pending_bookmark = None
            out.append(body)
        if pending_bookmark:  # a mark with nothing after it in this block
            out.append(ooxml.bookmark(pending_bookmark, self._pkg.ident()))
        return "".join(out)

    # ------------------------------------------------------------ furniture
    def _furniture(self) -> tuple[str, str, str | None, str | None]:
        """Register the running-furniture parts; return their relationship ids.

        One header and one footer, both on the *body* section. The cover is its own
        zero-margin section and simply references neither, so nothing has to be
        suppressed on page 1 — no ``w:titlePg``, no deliberately empty first-page
        pair. (A header inside a zero-margin section would be drawn at the paper
        edge, which is why the cover section must not reference one; ``verify.py``
        checks exactly that.)
        """
        grey = theme.GREY
        width = self._page.content_width_pt
        small = dict(font=self.font, size_pt=7.6, color=grey)

        header = ooxml.paragraph(
            ooxml.run(self.title, **small)
            + (f"<w:r>{ooxml.run_props(**small)}<w:tab/></w:r>"
               + ooxml.run(self.header_right, **small) if self.header_right else ""),
            tab_right_pt=width, border_bottom=(theme.GRID, 0.5),
            space_after=2, style="Note",
        )
        label = "第 %s 页" if self.locale.startswith("zh") else "Page %s"
        head, tail = label.split("%s")
        footer_runs = ooxml.run(self.footer_note, **small) if self.footer_note else ""
        footer_runs += f"<w:r>{ooxml.run_props(**small)}<w:tab/></w:r>"
        if head:
            footer_runs += ooxml.run(head, **small)
        footer_runs += ooxml.field_run(ooxml.PAGE_FIELD, "1", **small)
        if tail:
            footer_runs += ooxml.run(tail, **small)
        footer = ooxml.paragraph(
            footer_runs, tab_right_pt=width, border_top=(theme.GRID, 0.5),
            space_before=2, style="Note",
        )
        self._pkg.part("header1.xml", ooxml.header_part(header))
        self._pkg.part("footer1.xml", ooxml.footer_part(footer))
        return (
            self._pkg.relate(ooxml.REL_HEADER, "header1.xml"),
            self._pkg.relate(ooxml.REL_FOOTER, "footer1.xml"),
            None, None,
        )

    def _styles(self) -> str:
        """The type ramp as named styles, from ``theme``'s values.

        Named rather than direct formatting because the recipient of a DOCX edits
        it: 标题 1 has to be a style they can restyle and navigate by, not 16pt
        navy bold applied by hand. The values are the PDF ramp's, so a report and
        the same report as a Word draft are the same document.
        """
        def rpr(size: float, *, bold: bool = False, color: str = theme.INK) -> str:
            return ooxml.run_props(font=self.font, size_pt=size, bold=bold, color=color)

        def ppr(*, align: str | None = None, before: float = 0, after: float = 6,
                line: float | None = None, keep: bool = False,
                indent: float | None = None) -> str:
            inner = ""
            if keep:
                inner += "<w:keepNext/><w:keepLines/>"
            spacing = ooxml.attr(**{
                "w__before": round(before * TWIP), "w__after": round(after * TWIP),
                "w__line": None if line is None else round(line * TWIP),
                "w__lineRule": None if line is None else "exact",
            })
            inner += f"<w:spacing{spacing}/>"
            if indent:
                inner += f'<w:ind w:left="{round(indent * TWIP)}" w:hanging="{round(indent * TWIP)}"/>'
            if align:
                inner += f'<w:jc w:val="{align}"/>'
            return inner

        styles = [
            ooxml.Style("Normal", "Normal",
                        ppr=ppr(align="both", line=_BODY_LINE), rpr=rpr(_BODY_PT)),
            ooxml.Style("Heading1", "heading 1", based_on="Normal", next_id="Normal",
                        ppr=ppr(align="left", before=8, after=8, line=21, keep=True),
                        rpr=rpr(16, bold=True, color=theme.NAVY), outline=0),
            ooxml.Style("Heading2", "heading 2", based_on="Normal", next_id="Normal",
                        ppr=ppr(align="left", before=10, after=5, line=17, keep=True),
                        rpr=rpr(12.5, bold=True, color=theme.BLUE), outline=1),
            ooxml.Style("Caption", "caption", based_on="Normal", next_id="Normal",
                        ppr=ppr(align="center", before=2, after=3, line=13, keep=True),
                        rpr=rpr(9.5, bold=True, color=theme.NAVY)),
            ooxml.Style("Note", "Note", based_on="Normal",
                        ppr=ppr(align="left", after=4, line=10.5),
                        rpr=rpr(7.6, color=theme.GREY)),
            ooxml.Style("Bullet", "List Paragraph", based_on="Normal",
                        ppr=ppr(align="left", after=4, indent=10),
                        rpr=rpr(_BODY_PT)),
            # Hanging indent: an entry's second line aligns under its text, not under
            # its own [n]. The PDF path gets this from the number being inside the
            # paragraph's first line and the block being narrow; a Word entry runs the
            # full column and without the hang the wrap slides back under the marker,
            # so a fifteen-entry list reads as one paragraph.
            ooxml.Style("Ref", "Bibliography", based_on="Normal",
                        ppr=ppr(align="left", after=theme.REF_STEPS[0][1],
                                line=theme.REF_STEPS[0][0], indent=22),
                        rpr=rpr(theme.REF_PT)),
            ooxml.Style("CoverTitle", "Title", based_on="Normal",
                        ppr=ppr(align="left", after=4, line=35),
                        rpr=rpr(27, bold=True, color="#FFFFFF")),
            ooxml.Style("CoverSub", "Subtitle", based_on="Normal",
                        ppr=ppr(align="left", after=4, line=20),
                        rpr=rpr(14, bold=True, color="#D6E2F0")),
            ooxml.Style("Hyperlink", "Hyperlink", kind="character",
                        rpr=ooxml.run_props(font=self.font, color=theme.BLUE)),
            ooxml.Style("CoverMeta", "Cover Meta", based_on="Normal",
                        ppr=ppr(align="left", after=2, line=16),
                        rpr=rpr(10.5, color=theme.GREY)),
        ]
        return ooxml.styles_part(styles, default_rpr=rpr(_BODY_PT),
                                default_ppr=f"<w:pPr>{ppr(align='both', line=_BODY_LINE)}</w:pPr>")

    # ------------------------------------------------------------ content
    #: Cover geometry, and deliberately little of it. An earlier version measured the
    #: title, computed the colour block's depth, placed the tail at a fraction of the
    #: sheet and refused a cover that would not fit one page. That machinery was
    #: rolled back on request: this cover is the PDF's layout expressed in the
    #: simplest DOCX that can carry it, and the constraints it dropped are recorded in
    #: ``references/docx.md`` for whoever wants them again.
    #:
    #: What is *not* negotiable here is the citation vehicle — bookmarks, anchors,
    #: integer half-points — because that is correctness, not layout.
    _TITLE_PT = 27.0
    _SUBTITLE_PT = 13.5
    #: Navy above the title and below the subtitle. Paragraph shading covers the
    #: **line box** and not ``spaceBefore``, so padding inside the band has to be an
    #: empty shaded paragraph with an exact line height — a ``space_before`` on the
    #: title would print as an unshaded white gap instead. Without the top pad the
    #: band starts at the title's own ascent and reads as a sliver: 「标题上面只有
    #: 一小块」. Together with the title and subtitle lines these make a band of
    #: roughly 67mm for a one-line title, against the 77.6mm of the cover this
    #: follows — which spent 38.8mm of its height on empty navy under the subtitle,
    #: and that is what 「整个排版往上压缩」 was describing.
    _BAND_TOP_PAD = 96.0
    _BAND_BOTTOM_PAD = 40.0
    _COVER_GAP = 40 * mm
    _KPI_VALUE_PT = 18.0
    _KPI_LABEL_PT = 8.5

    def cover(self, *, meta_lines: list[str] | None = None,
              kpis: list[tuple[str, str]] | None = None) -> None:
        """Full-bleed title band, meta lines, KPI strip, then the body's own section.

        The PDF draws its navy band with the canvas, edge to edge. A DOCX has no
        canvas: ``w:shd`` fills "left indent to right indent", which in a section with
        margins stops at the text column and leaves white gutters — a panel rather
        than a banner (「背景还是只有一小块」). So **the cover is its own section with
        zero page margins** (`Page.cover_sect_pr`), where a block filling that section
        reaches the paper edge.

        **The band is a one-cell table, not a shaded paragraph**, and the reason is the
        right-hand edge. A tab stop insets text from the left without moving the fill,
        but nothing insets it from the *right* except ``w:ind``, which drags the fill
        in with it and loses the bleed — so a paragraph band sets the title against the
        paper edge. A cell's ``w:tcMar`` insets text on both sides while the fill still
        spans the cell. Word draws non-printing dashed gridlines around borderless
        cells, but not where a cell is filled: navy hides them.

        The section break ends the cover, so there is no page break here — a section
        of type ``nextPage`` starts page 2 by itself.

        Deliberately unmeasured: the title is 27pt whether or not it wraps, the drop
        to the meta block is a constant, and nothing checks that the whole cover fits
        one page. `references/docx.md` records what those checks were and what they
        caught, for whoever wants them back.
        """
        self._has_cover = True
        inset = theme.MARGIN_L
        sheet = round(self._page.width_pt * TWIP)
        pad = dict(style="Note", space_before=0, space_after=0)
        band = ooxml.cell(
            ooxml.paragraph("", line=self._BAND_TOP_PAD, **pad)
            + ooxml.paragraph(
                self._runs(self.title, size_pt=self._TITLE_PT, bold=True,
                           color="#FFFFFF"),
                style="CoverTitle", space_before=0, space_after=0)
            + ooxml.paragraph(
                self._runs(self.subtitle, size_pt=self._SUBTITLE_PT, bold=True,
                           color="#D6E2F0") if self.subtitle else "",
                style="CoverSub", space_before=0, space_after=0)
            + ooxml.paragraph("", line=self._BAND_BOTTOM_PAD, **pad),
            width_twips=sheet, shade=theme.NAVY, valign="top",
            margins_pt=(inset, 0))
        self.body.append(ooxml.table([ooxml.row([band])], [sheet],
                                     bottom=(theme.GOLD, 1.5)))
        self.body.append(ooxml.paragraph("", style="Note",
                                        space_after=self._COVER_GAP))
        for line in meta_lines or []:
            self.body.append(ooxml.paragraph(
                self._runs(line, size_pt=10.5, color=theme.GREY), style="CoverMeta",
                indent_left=inset, indent_right=inset))
        if kpis:
            #: No spacer before the strip: it belongs to the meta block it summarises,
            #: and a drop between them reads as two unrelated panels.
            self.body.append(self._kpi_strip(kpis))
        #: A cover-placed legend goes inside this section, so its slot is *before* the
        #: paragraph carrying the section break; the lead placement belongs to the
        #: first content page and goes after it.
        self._legend_cover_at = len(self.body)
        self.body.append(ooxml.paragraph(
            "", style="Note", space_before=0, space_after=0, line=1,
            sect=self._page.cover_sect_pr()))
        self._legend_lead_at = len(self.body)

    def _kpi_strip(self, kpis: list[tuple[str, str]]) -> str:
        """The cover's KPI row: values over labels, gold rule above, hairline below."""
        width = round(self._page.content_width_pt * TWIP / len(kpis))
        values = [
            ooxml.cell(ooxml.paragraph(
                self._runs(value, size_pt=self._KPI_VALUE_PT, bold=True,
                           color=theme.NAVY),
                align="center", space_after=0, line=20),
                width_twips=width, margins_pt=(4, 4))
            for value, _ in kpis
        ]
        labels = [
            ooxml.cell(ooxml.paragraph(
                self._runs(label, size_pt=self._KPI_LABEL_PT, color=theme.GREY),
                align="center", space_after=0, line=12),
                width_twips=width, margins_pt=(4, 6))
            for _, label in kpis
        ]
        return ooxml.table(
            [ooxml.row(values), ooxml.row(labels)], [width] * len(kpis),
            top=(theme.GOLD, 1.2), bottom=(theme.GRID, 0.5),
            indent_twips=round(theme.MARGIN_L * TWIP))

    def h1(self, text: str, rule: bool = True) -> None:
        self.body.append(ooxml.paragraph(
            self._runs(text, size_pt=16, bold=True, color=theme.NAVY),
            style="Heading1", keep_next=True,
            border_bottom=(theme.GOLD, 1.2) if rule else None,
        ))

    def h2(self, text: str) -> None:
        self.body.append(ooxml.paragraph(
            self._runs(text, size_pt=12.5, bold=True, color=theme.BLUE),
            style="Heading2", keep_next=True))

    def p(self, text: str, align_left: bool = False) -> None:
        self.body.append(ooxml.paragraph(
            self._runs(text), style="Normal",
            align="left" if align_left else "both"))

    def bullets(self, items: list[str]) -> None:
        for item in items:
            self.body.append(ooxml.paragraph(
                self._runs(f"• {item}"), style="Bullet", align="left"))

    def note(self, text: str) -> None:
        self.body.append(ooxml.paragraph(
            self._runs(text, size_pt=7.6, color=theme.GREY), style="Note"))

    # ------------------------------------------------------------ tags
    def chip(self, tag: str, size: float = DOCX_CHIP_PT) -> str:
        """A provenance chip — identical markup to the PDF path, rendered as runs.

        Recording the tag here is what lets ``legend()`` be built from the tags the
        document actually used; ``theme.chip()`` called directly bypasses the
        record, in either format.
        """
        self._tags_used.add(rules.normalise_tag(tag))
        return theme.chip(tag, size)

    def tagged(self, value: str, tag: str, size: float = DOCX_CHIP_PT) -> str:
        markup = theme.tagged(value, tag, size)
        self._tags_used.add(rules.normalise_tag(tag))
        return markup

    def legend(self, extra: str = "", placement: str = "lead") -> None:
        """Request the provenance legend; ``build()`` places and fills it in.

        Same contract as the PDF path, including that the call site does not
        decide where it lands: the two legal sites are the foot of the cover and
        the head of the first content page, because everywhere else it reads as
        the opening sentence of 核心观点.
        """
        if self._legend_placement is not None:
            raise ValueError("legend() was already called — one legend per document")
        problem = rules.legend_placement_problem(
            placement, has_cover=self._legend_cover_at is not None)
        if problem:
            raise ValueError(problem)
        self._legend_placement = placement
        self._legend_extra = extra

    def _resolve_legend(self) -> None:
        tags = set(self._tags_used)
        problem = rules.legend_problem(tags, self._legend_placement)
        if problem:
            raise ValueError(problem)
        if self._legend_placement is None:
            return
        text = theme.legend(tags, self.locale, extra=self._legend_extra)
        block = ooxml.paragraph(
            self._runs(text, size_pt=7.6, color=theme.GREY), style="Note",
            border_top=(theme.GRID, 0.5), border_bottom=(theme.GRID, 0.5),
            space_before=3, space_after=6,
        )
        index = (self._legend_cover_at if self._legend_placement == "cover"
                 else self._legend_lead_at)
        self.body.insert(index if index is not None else 0, block)

    # ------------------------------------------------------------ figures
    def figure_width(self, name: str) -> tuple[float, float]:
        """Display size for a chart: density picks the width, a cap bounds height.

        The same tiers as the PDF path, so an exhibit is the same size in either
        format. What is absent is the shrink-to-fit wrap: nothing here knows how
        much column is left on the page, because Word decides that after the file
        is handed over.
        """
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
        """The narrowest this figure may be drawn before its own labels fall below
        ``theme.FIG_MIN_TEXT_PT`` on the page.

        Reported for parity and for the QA record; nothing on this path shrinks a
        figure, so it bounds nothing here.
        """
        meta = self._meta.get(name) or {}
        authored = float(meta.get("fig_w_in") or 0) * inch
        base_pt = float(meta.get("base_pt") or 0) or theme.CHART_BASE_PT
        if authored <= 0 or base_pt <= 0:
            return float("inf")
        return authored * (theme.FIG_MIN_TEXT_PT / base_pt)

    def figure(self, name: str, caption: str, note: str | None = None,
               allow_duplicate_title: bool = False) -> None:
        """Caption above, image centred beneath it, source stated once in ``note``.

        The refusals are the PDF path's, for the reasons stated there: a missing
        chart file is a build ordering error, and a caption over a chart that
        already carries an in-canvas title prints the same sentence twice.
        """
        path = self.charts_dir / name
        if not path.is_file():
            raise FileNotFoundError(
                f"{path} does not exist — render the charts before building the document"
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
        rid = self._pkg.image(path)
        ident = self._pkg.ident()
        self.body.append(ooxml.paragraph(
            self._runs(caption, size_pt=9.5, bold=True, color=theme.NAVY),
            style="Caption", align="center", keep_next=True, space_before=2))
        self.body.append(ooxml.paragraph(
            ooxml.picture(rid, width_pt=width, height_pt=height, ident=ident,
                          name=name, alt=inline.plain(caption)),
            align="center", space_after=3, keep_next=bool(note),
            #: **Auto line height, or Word clips the picture.** The body's line grid is
            #: 15.5pt with ``lineRule="exact"`` and it lives in ``docDefaults``, so a
            #: paragraph that sets no ``w:spacing`` inherits it — and an inline image
            #: in an exact line box is cut down to that box. The reader sees a 15.5pt
            #: sliver of the chart with the surrounding text lines running across the
            #: rest, which reads as 「文字盖住了图」. Shipped that way: 12 figures in
            #: one deliverable, every one of them. Omitting the spacing is what caused
            #: it, so the fix is to write the rule out rather than leave it unset.
            auto_line=True))
        if note:
            self.body.append(ooxml.paragraph(
                self._runs(note, size_pt=7.6, color=theme.GREY),
                style="Note", space_after=7))

    # ------------------------------------------------------------ tables
    def table(
        self,
        rows: list[list],
        *,
        caption: str = "",
        note: str = "",
        heading: str | None = None,
        col_widths: list[float] | None = None,
        header: bool = True,
        align_center: tuple[int, int] | None = None,
        font_size: float = 8.3,
    ) -> None:
        """A document table: header fill, zebra rows, horizontal rules only.

        Column widths come from the PDF path's own allocator
        (``doc._column_widths`` / ``doc._fit_widths``), so a table is proportioned
        identically in both formats and `col_widths` keeps meaning relative
        proportions normalised to the text column.

        **A table naming a derived column must carry a tag somewhere in it** — the
        finding is recorded here and raised by ``build()``, exactly as on the PDF
        path (``rules.untagged_columns``).
        """
        offenders = rules.untagged_columns(rows, header=header)
        if offenders:
            self._untagged_tables.append(
                f"{rules.where(rows, caption, heading)} → {' / '.join(offenders[:4])}"
            )

        widths_pt = _fit_widths(col_widths) if col_widths else _column_widths(rows, font_size)
        widths = [round(w * TWIP) for w in widths_pt]

        out_rows: list[str] = []
        columns = len(widths)
        for r, row in enumerate(rows):
            is_header = header and r == 0
            cells: list[str] = []
            # Pad a short row to the grid. reportlab pads ragged rows with empty
            # cells and neither path refuses them, so leaving the cells out here
            # would make the same input render as a row that stops half way across
            # in Word and a complete row in the PDF.
            padded = list(row) + [""] * (columns - len(row))
            for c, value in enumerate(padded[:columns]):
                centred = is_header or (align_center and align_center[0] <= c <= align_center[1])
                inner = ooxml.paragraph(
                    self._runs(value, size_pt=font_size, bold=is_header,
                               color="#FFFFFF" if is_header else theme.INK),
                    align="center" if centred else "left",
                    space_after=0, line=font_size + 3,
                )
                shade = theme.NAVY if is_header else (
                    theme.ZEBRA if (r - (1 if header else 0)) % 2 == 1 else None)
                cells.append(ooxml.cell(
                    inner, width_twips=widths[c], shade=shade, margins_pt=(5, 4)))
            out_rows.append(ooxml.row(cells, header=is_header))

        if heading:
            self.h2(heading)
        if caption:
            self.body.append(ooxml.paragraph(
                self._runs(caption, size_pt=9.5, bold=True, color=theme.NAVY),
                style="Caption", align="center", keep_next=True))
        self.body.append(ooxml.table(out_rows, widths, rules=theme.GRID))
        if note:
            self.body.append(ooxml.paragraph(
                self._runs(note, size_pt=7.6, color=theme.GREY),
                style="Note", space_before=3, space_after=6))
        else:
            self.body.append(ooxml.paragraph("", style="Note", space_after=6))

    def callout(self, heading: str, items: list[str]) -> None:
        """A boxed key-judgements panel: navy heading row, banded items."""
        width = round(self._page.content_width_pt * TWIP)
        rows = [ooxml.row([ooxml.cell(
            ooxml.paragraph(
                self._runs(heading, size_pt=10, bold=True, color="#FFFFFF"),
                align="left", space_after=0, line=13),
            width_twips=width, shade=theme.NAVY, margins_pt=(8, 5))], header=True)]
        for index, item in enumerate(items):
            rows.append(ooxml.row([ooxml.cell(
                ooxml.paragraph(
                    self._runs(f"• {item}", size_pt=8.4),
                    align="left", space_after=0, line=11.4),
                width_twips=width,
                shade=theme.ZEBRA if index % 2 == 0 else "#FAFBFC",
                margins_pt=(8, 5))]))
        self.body.append(ooxml.table(rows, [width], rules=theme.GRID, box=theme.GRID))
        self.body.append(ooxml.paragraph("", style="Note", space_after=7))

    # ------------------------------------------------------------ sources
    def _placed_markers(self) -> set[int]:
        """Entry numbers whose ``[n]`` marker actually appears in the document.

        Read off the emitted XML rather than from ``refs``' own record: an anchor
        in ``w:hyperlink w:anchor="ref3"`` is a marker that will be in the file the
        reader opens, which is the thing the citation policy's count rule is about.
        """
        joined = "".join(self.body)
        return {int(n) for n in re.findall(r'w:anchor="ref(\d+)"', joined)}

    def sources(self, heading: str | None = None, preamble: str = "",
                disclaimer: str = "") -> None:
        """The Sources section, on its own page. Raises on a policy violation.

        Entries come from ``refs.lines()`` — the same schema, escaping, tier and
        relay-chain rules as the PDF — so the only difference is the vehicle: the
        entry's ``<a name="refN"/>`` becomes a real bookmark, and its URL a
        hyperlink relationship.
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

        self.body.append(ooxml.paragraph(
            self._runs(heading, size_pt=16, bold=True, color=theme.NAVY),
            style="Heading1", keep_next=True, page_break_before=True,
            border_bottom=(theme.GOLD, 1.2)))
        if preamble:
            self.body.append(ooxml.paragraph(
                self._runs(preamble, size_pt=8.6), style="Normal", align="left"))
        leading, space_after = self.ref_metrics
        for line in self.refs.lines():
            self.body.append(ooxml.paragraph(
                self._runs(line, size_pt=theme.REF_PT), style="Ref", align="left",
                line=leading, space_after=space_after))
        if disclaimer:
            self.body.append(ooxml.paragraph(
                self._runs(disclaimer, size_pt=7.6, color=theme.GREY),
                style="Note", border_top=(theme.GRID, 0.5), space_before=6))
        self._sources_started = True

    # ------------------------------------------------------------ build
    def build(self) -> Path:
        if not self._sources_started and len(self.refs):
            raise ValueError(rules.SOURCES_MISSING)
        if self._untagged_tables:
            raise ValueError(rules.untagged_tables_error(self._untagged_tables))
        self._resolve_legend()

        self._pkg.relate(ooxml.REL_STYLES, "styles.xml")
        self._pkg.part("styles.xml", self._styles())
        self._pkg.relate(ooxml.REL_SETTINGS, "settings.xml")
        self._pkg.part("settings.xml", ooxml.settings_part())
        header, footer, first_header, first_footer = self._furniture()

        body = "".join(self.body) + self._page.sect_pr(
            header_rid=header, footer_rid=footer,
            first_header_rid=first_header, first_footer_rid=first_footer,
        )
        return self._pkg.save(self.out, body)
