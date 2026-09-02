"""WordprocessingML, written by hand: parts, relationships, and ordered elements.

A ``.docx`` is a ZIP of XML parts. This module writes them with ``zipfile`` and
string templates and takes **no third-party dependency** — the same interpreter
that already has reportlab, matplotlib and pypdfium2 for the PDF path can build a
DOCX with nothing added, which is the difference between a backend that runs
where this package runs and one that runs where someone remembered to
``pip install``.

**Why a builder rather than free-form strings at the call site.** Word validates
child order inside ``w:pPr``, ``w:rPr``, ``w:tblPr``, ``w:tcPr`` and ``w:sectPr``
against the schema's sequence, and it does not degrade gracefully: an out-of-order
child produces "Word found unreadable content", i.e. a file that opens for nobody.
The order is not memorable and it is not guessable, so every element that has one
is assembled by a function here that knows it, and callers pass keyword arguments
instead of markup. The orders encoded below are from ECMA-376 Part 1:

* ``w:pPr``   — pStyle, keepNext, keepLines, pageBreakBefore, widowControl, pBdr,
  shd, spacing, ind, jc, outlineLvl, rPr, sectPr
* ``w:rPr``   — rStyle, rFonts, b, i, color, sz, szCs, u, vertAlign, lang
* ``w:tblPr`` — tblStyle, tblW, jc, tblInd, tblBorders, shd, tblLayout, tblCellMar, tblLook
* ``w:tcPr``  — tcW, gridSpan, tcBorders, shd, tcMar, vAlign
* ``w:sectPr`` — headerReference, footerReference, type, pgSz, pgMar, cols, titlePg, docGrid

Units, because three coexist: **twips** (1/20 pt) for page and table geometry,
**half-points** for type size, **EMU** (1/12700 pt) for image extents. Every
conversion rounds rather than truncates: A4 is 11906 x 16838 twips, and truncating
595.276pt gives 11905 — half a twip short, invisible on the page but enough to make
a document that does not compare equal to the canonical page size.
"""
from __future__ import annotations

import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

TWIP = 20            # twips per point
EMU = 12700          # EMU per point
HALF_PT = 2          # half-points per point

_NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
)
_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_STYLES = f"{_REL}/styles"
REL_SETTINGS = f"{_REL}/settings"
REL_HEADER = f"{_REL}/header"
REL_FOOTER = f"{_REL}/footer"
REL_IMAGE = f"{_REL}/image"
REL_HYPERLINK = f"{_REL}/hyperlink"
REL_DOCUMENT = f"{_REL}/officeDocument"
REL_CORE = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"
REL_APP = f"{_REL}/extended-properties"


def hexcolor(value: str | None) -> str | None:
    """``#1F3A5F`` → ``1F3A5F``. OOXML takes bare hex, uppercase by convention."""
    if not value:
        return None
    return value.lstrip("#").upper()


def attr(**kw) -> str:
    """Attributes, skipping the ones whose value is ``None``."""
    return "".join(f" {k.replace('__', ':')}={quoteattr(str(v))}"
                   for k, v in kw.items() if v is not None)


# --------------------------------------------------------------------------
# runs
# --------------------------------------------------------------------------
def run_props(*, font: str, size_pt: float | None = None, color: str | None = None,
              bold: bool = False, italic: bool = False, underline: bool = False,
              superscript: bool = False, subscript: bool = False,
              style: str | None = None) -> str:
    """``w:rPr`` in schema order.

    ``w:rFonts`` always carries **``w:eastAsia``** alongside ``w:ascii`` and
    ``w:hAnsi``. Setting only the Latin attributes is the DOCX analogue of not
    embedding a CJK font in a PDF: Word resolves Chinese through ``w:eastAsia``
    and, finding nothing there, falls back to the document theme's East Asian
    font. The text still renders — this is a substitution, not the blank page
    reportlab produces — so nothing fails, and the deliverable simply arrives in
    a font nobody chose, usually a serif in a house style that is a sans.
    """
    parts = []
    if style:
        parts.append(f'<w:rStyle w:val="{style}"/>')
    parts.append(
        f'<w:rFonts w:ascii="{escape(font)}" w:hAnsi="{escape(font)}" '
        f'w:eastAsia="{escape(font)}" w:cs="{escape(font)}"/>'
    )
    if bold:
        parts.append("<w:b/><w:bCs/>")
    if italic:
        parts.append("<w:i/><w:iCs/>")
    if color:
        parts.append(f'<w:color w:val="{hexcolor(color)}"/>')
    if size_pt:
        # **Integer half-points, always.** `w:sz` is ST_HpsMeasure — a *half-point*
        # count — and the ramp holds real point sizes (8.8pt for a Sources entry,
        # 7.6pt for a note), so a bare multiplication emits `w:val="17.6"`. The XSD
        # lets it through (ST_UnsignedDecimalNumber is xsd:decimal) but Word writes
        # only integers and readers parse it as one: measured 514 such values in one
        # shipped document. Rounding costs a quarter of a point and removes a whole
        # class of "the reader repaired the file" from the table.
        half = round(size_pt * HALF_PT)
        parts.append(f'<w:sz w:val="{half}"/><w:szCs w:val="{half}"/>')
    if underline:
        parts.append('<w:u w:val="single"/>')
    if superscript:
        parts.append('<w:vertAlign w:val="superscript"/>')
    elif subscript:
        parts.append('<w:vertAlign w:val="subscript"/>')
    parts.append('<w:lang w:val="en-US" w:eastAsia="zh-CN"/>')
    return "<w:rPr>" + "".join(parts) + "</w:rPr>"


def run(text: str, **props) -> str:
    """One ``w:r``. ``xml:space="preserve"`` is not optional: without it Word
    drops the leading space of ``" 〔一手〕IDC · …"`` and every Sources entry
    closes up against its own ``[n]``.

    **A newline in the text becomes a real ``w:br``.** OOXML has no line-break
    character: a literal ``\n`` inside ``w:t`` is not a break, and Word shows it as
    a box or swallows it. The PDF path takes ``"2025E 算力市场\n(亿美元)"`` happily —
    that string is in this skill's own KPI example — so a DOCX that passed it through
    verbatim printed 「26H1归母净利润□同比-1.95%」 on the cover of a shipped
    deliverable.
    """
    segments = str(text).split("\n")
    props_xml = run_props(**props)
    body = f'<w:br/>'.join(
        f'<w:t xml:space="preserve">{escape(s)}</w:t>' for s in segments)
    return f"<w:r>{props_xml}{body}</w:r>"


def line_break(**props) -> str:
    return f"<w:r>{run_props(**props)}<w:br/></w:r>"


#: The page-number field instruction. **Not a bare ``PAGE``**: WPS Office — which is
#: what a large share of the intended readership opens a Word file in — ignores the
#: section's ``w:pgNumType`` format and prints a bare instruction as the raw field
#: code, so the footer reads ``PAGE \* arabic \* MERGEFORMAT`` instead of a number.
#: Writing the format switch explicitly is what Word itself emits and what WPS
#: needs, and it costs nothing in Word or LibreOffice.
PAGE_FIELD = r" PAGE \* arabic \* MERGEFORMAT "


def field_run(instr: str, placeholder: str, **props) -> str:
    """A simple field — ``PAGE`` in the footer; see ``PAGE_FIELD`` for the switches.

    ``w:fldSimple`` carries a cached result so a viewer that does not evaluate
    fields still shows a number; Word and LibreOffice both recompute it on load.
    """
    return (f'<w:fldSimple w:instr={quoteattr(instr)}>'
            f"{run(placeholder, **props)}</w:fldSimple>")


def hyperlink(inner: str, *, rid: str | None = None, anchor: str | None = None) -> str:
    """``w:hyperlink`` — external through a relationship id, internal by anchor.

    These are the two halves of the citation contract the PDF path gets from
    ``/Link`` annotations: ``[n]`` jumps to its Sources entry (anchor), and the
    entry's URL leaves the document (rid). ``verify.py`` checks both.

    ``w:history="1"`` is what Word itself writes on every hyperlink it creates. The
    spec does not require it for the link to work, and a document without it was
    reported as "the citation is not clickable" — so the cheap move is to stop
    differing from Word's own output in a place we gain nothing by differing.
    """
    return (f"<w:hyperlink{attr(**{'r__id': rid, 'w__anchor': anchor})}"
            f' w:history="1">{inner}</w:hyperlink>')


def bookmark(name: str, ident: int) -> str:
    """The destination half. Emitted as a start/end pair around nothing: it marks
    a position, and Word requires the pair to be balanced."""
    return (f'<w:bookmarkStart w:id="{ident}" w:name={quoteattr(name)}/>'
            f'<w:bookmarkEnd w:id="{ident}"/>')


# --------------------------------------------------------------------------
# paragraphs
# --------------------------------------------------------------------------
def paragraph(inner: str, *, style: str | None = None, align: str | None = None,
              space_before: float | None = None, space_after: float | None = None,
              line: float | None = None, shade: str | None = None,
              border_bottom: tuple[str, float] | None = None,
              border_top: tuple[str, float] | None = None,
              tab_right_pt: float | None = None,
              tabs: list[tuple[str, float]] | None = None,
              indent_left: float | None = None, indent_right: float | None = None,
              hanging: float | None = None,
              auto_line: bool = False,
              keep_next: bool = False, page_break_before: bool = False,
              outline_level: int | None = None, sect: str | None = None,
              run_defaults: dict | None = None) -> str:
    """``w:p`` with its ``w:pPr`` children in schema order.

    ``space_before`` / ``space_after`` / ``line`` are points; ``w:spacing`` wants
    twips, and ``w:line`` additionally wants ``w:lineRule="exact"`` to mean
    "this many twips" rather than "multiply the font's leading".

    ``tab_right_pt`` places a single right-aligned tab stop at that offset, which
    is how the header and footer put one string at the left margin and another at
    the right on one line — the running furniture the PDF path draws with
    ``drawString`` / ``drawRightString``.
    """
    props: list[str] = []
    if style:
        props.append(f'<w:pStyle w:val="{style}"/>')
    if keep_next:
        props.append("<w:keepNext/><w:keepLines/>")
    if page_break_before:
        props.append("<w:pageBreakBefore/>")
    borders = []
    if border_top:
        colour, pt = border_top
        borders.append(f'<w:top w:val="single" w:sz="{max(2, round(pt * 8))}" '
                       f'w:space="1" w:color="{hexcolor(colour)}"/>')
    if border_bottom:
        colour, pt = border_bottom
        borders.append(f'<w:bottom w:val="single" w:sz="{max(2, round(pt * 8))}" '
                       f'w:space="1" w:color="{hexcolor(colour)}"/>')
    if borders:
        props.append("<w:pBdr>" + "".join(borders) + "</w:pBdr>")
    if shade:
        props.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{hexcolor(shade)}"/>')
    stops = list(tabs or [])
    if tab_right_pt is not None:
        stops.append(("right", tab_right_pt))
    if stops:
        props.append("<w:tabs>" + "".join(
            f'<w:tab w:val="{kind}" w:pos="{round(pos * TWIP)}"/>'
            for kind, pos in stops) + "</w:tabs>")
    if line is not None and not auto_line:
        # **Exact line height and the document grid are in conflict, and the grid
        # wins.** ``w:docGrid`` on the section makes Word snap every line to the grid
        # pitch unless the paragraph opts out, which would quietly reset the heights
        # the cover's arithmetic depends on — the same arithmetic that keeps it on one
        # page and stops it drifting to the top.
        #
        # The slot matters: ``snapToGrid`` sits *after* ``tabs`` in CT_PPrBase, and
        # putting it before produced "Element tabs: This element is not expected" —
        # the second time an ordering slip in this function was caught by schema
        # validation rather than by reading the sequence.
        props.append('<w:snapToGrid w:val="0"/>')
    if auto_line:
        # **A paragraph holding a picture must not inherit an exact line height.**
        # ``docDefaults`` sets the body's 15.5pt line grid with ``lineRule="exact"``,
        # and an inline image in an exact line box is *clipped to it*: a 60mm chart
        # shows as a 15.5pt sliver with the neighbouring text lines running through
        # what is left, which reads as "the text is covering the figure". Shipped
        # that way — 12 figures in one deliverable. Nothing in the picture element
        # resists it; the paragraph has to opt out, and opting out means writing
        # ``lineRule="auto"`` rather than omitting ``w:spacing`` (an omitted value
        # inherits, which is how the defect arose). ``w:line="240"`` is auto's own
        # unit — 240ths of a line, so single spacing — not twips.
        spacing = attr(**{
            "w__before": None if space_before is None else round(space_before * TWIP),
            "w__after": None if space_after is None else round(space_after * TWIP),
            "w__line": 240, "w__lineRule": "auto",
        })
    else:
        spacing = attr(**{
            "w__before": None if space_before is None else round(space_before * TWIP),
            "w__after": None if space_after is None else round(space_after * TWIP),
            "w__line": None if line is None else round(line * TWIP),
            "w__lineRule": None if line is None else "exact",
        })
    if spacing:
        props.append(f"<w:spacing{spacing}/>")
    ind = attr(**{
        "w__left": None if indent_left is None else round(indent_left * TWIP),
        "w__right": None if indent_right is None else round(indent_right * TWIP),
        "w__hanging": None if hanging is None else round(hanging * TWIP),
    })
    if ind:
        props.append(f"<w:ind{ind}/>")
    if align:
        props.append(f'<w:jc w:val="{align}"/>')
    if outline_level is not None:
        props.append(f'<w:outlineLvl w:val="{outline_level}"/>')
    if run_defaults:
        props.append(run_props(**run_defaults))
    if sect:
        props.append(sect)
    prefix = f"<w:pPr>{''.join(props)}</w:pPr>" if props else ""
    return f"<w:p>{prefix}{inner}</w:p>"


def page_break_before(block: str) -> str:
    """Add ``w:pageBreakBefore`` to an already-built paragraph, in the legal slot.

    ``w:pPr`` orders pStyle → keepNext → keepLines → pageBreakBefore, so inserting
    the break at the front of an existing ``w:pPr`` puts ``pStyle`` after it and
    the file stops being WordprocessingML. Caught by schema validation on the
    first document this package built: *"Element pStyle: This element is not
    expected"* — which is what Word reports as unreadable content.

    A block that is not a paragraph (a table) cannot carry the attribute at all;
    an empty paragraph in front of it can, and collapses to nothing visible at the
    head of the page.
    """
    if not block.startswith("<w:p>"):
        return paragraph("", style="Note", space_after=0,
                         page_break_before=True) + block
    if "<w:pageBreakBefore/>" in block.split("</w:pPr>", 1)[0]:
        return block
    if block.startswith("<w:p><w:pPr>"):
        head = "<w:p><w:pPr>"
        rest = block[len(head):]
        prefix = ""
        for element in ("<w:pStyle ", "<w:keepNext/><w:keepLines/>"):
            if rest.startswith(element):
                end = rest.index("/>") + 2 if element.endswith(" ") else len(element)
                prefix += rest[:end]
                rest = rest[end:]
        return head + prefix + "<w:pageBreakBefore/>" + rest
    return block.replace("<w:p>", "<w:p><w:pPr><w:pageBreakBefore/></w:pPr>", 1)


# --------------------------------------------------------------------------
# tables
# --------------------------------------------------------------------------
def cell(inner: str, *, width_twips: int, shade: str | None = None,
         valign: str = "center", margins_pt: tuple[float, float] = (5, 4),
         span: int | None = None) -> str:
    """``w:tc``. Cell margins are per-cell here rather than table-wide because the
    KPI strip, the callout and a data table want different padding."""
    lr, tb = margins_pt
    props = [f'<w:tcW w:w="{width_twips}" w:type="dxa"/>']
    if span and span > 1:
        props.append(f'<w:gridSpan w:val="{span}"/>')
    if shade:
        props.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{hexcolor(shade)}"/>')
    props.append(
        f'<w:tcMar><w:top w:w="{round(tb * TWIP)}" w:type="dxa"/>'
        f'<w:left w:w="{round(lr * TWIP)}" w:type="dxa"/>'
        f'<w:bottom w:w="{round(tb * TWIP)}" w:type="dxa"/>'
        f'<w:right w:w="{round(lr * TWIP)}" w:type="dxa"/></w:tcMar>'
    )
    props.append(f'<w:vAlign w:val="{valign}"/>')
    return f"<w:tc><w:tcPr>{''.join(props)}</w:tcPr>{inner}</w:tc>"


def row(cells: list[str], *, header: bool = False,
        height_twips: int | None = None) -> str:
    """``w:tr``. ``w:tblHeader`` is what repeats the header row on every page a
    table spans — the DOCX counterpart of reportlab's ``repeatRows=1``, and the
    same defect if it is missing: a table crossing a page shows a headerless
    continuation."""
    # A data row that splits across a page break shows half its cells' height on one
    # page and half on the next, which reads as a rendering fault rather than as
    # pagination. reportlab keeps rows whole by construction; Word needs telling.
    inner = "<w:cantSplit/>"
    if height_twips:
        # ``exact``, never ``atLeast``: a colour block whose height is allowed to grow
        # is a colour block that can push the cover onto a second page.
        inner += f'<w:trHeight w:val="{height_twips}" w:hRule="exact"/>'
    if header:
        inner += "<w:tblHeader/>"
    props = f"<w:trPr>{inner}</w:trPr>" if inner else ""
    return f"<w:tr>{props}{''.join(cells)}</w:tr>"


def table(rows: list[str], widths_twips: list[int], *,
          rules: str | None = None, box: str | None = None,
          top: tuple[str, float] | None = None,
          bottom: tuple[str, float] | None = None,
          indent_twips: int | None = None) -> str:
    """``w:tbl`` with horizontal rules only, unless an edge is overridden.

    ``rules`` draws the inside horizontal lines and the two outer horizontals;
    ``box`` adds the verticals; ``top`` / ``bottom`` replace one outer horizontal
    with its own colour and weight, which is how the KPI strip gets a 1.2pt gold
    rule above and a hairline below.

    The house formatting policy gives document tables no vertical rules — that is
    a spreadsheet convention — so the verticals are explicitly ``none`` rather
    than merely unset, and a table with no rules at all still writes a full
    ``w:tblBorders`` of ``none``: leaving the element out inherits whatever the
    reader's default table style draws.
    """
    total = sum(widths_twips)

    def edge(name: str, spec: tuple[str, float] | None) -> str:
        if not spec:
            return f'<w:{name} w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
        colour, pt = spec
        return (f'<w:{name} w:val="single" w:sz="{max(2, round(pt * 8))}" '
                f'w:space="0" w:color="{hexcolor(colour)}"/>')

    horizontal = (rules, 0.4) if rules else None
    vertical = (box, 0.5) if box else None
    borders = (
        "<w:tblBorders>"
        + edge("top", top or horizontal or vertical)
        + edge("left", vertical)
        + edge("bottom", bottom or horizontal or vertical)
        + edge("right", vertical)
        + edge("insideH", horizontal)
        + edge("insideV", None)
        + "</w:tblBorders>"
    )
    grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths_twips)
    return (
        "<w:tbl><w:tblPr>"
        f'<w:tblW w:w="{total}" w:type="dxa"/>'
        '<w:jc w:val="center"/>'
        + (f'<w:tblInd w:w="{indent_twips}" w:type="dxa"/>'
           if indent_twips is not None else "")
        + f"{borders}"
        '<w:tblLayout w:type="fixed"/>'
        '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" '
        'w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
        "</w:tblPr>"
        f"<w:tblGrid>{grid}</w:tblGrid>"
        f"{''.join(rows)}</w:tbl>"
    )


# --------------------------------------------------------------------------
# images
# --------------------------------------------------------------------------
def picture(rid: str, *, width_pt: float, height_pt: float, ident: int,
            name: str, alt: str = "") -> str:
    """An inline ``w:drawing``.

    ``wp:docPr`` ids must be unique across the document; a duplicate makes Word
    repair the file. ``a:ext`` and ``wp:extent`` must agree, and both are EMU.
    """
    cx, cy = round(width_pt * EMU), round(height_pt * EMU)
    return (
        "<w:r><w:drawing>"
        f'<wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{cx}" cy="{cy}"/>'
        f'<wp:docPr id="{ident}" name={quoteattr(name)} descr={quoteattr(alt)}/>'
        "<a:graphic><a:graphicData "
        'uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        "<pic:pic><pic:nvPicPr>"
        f'<pic:cNvPr id="{ident}" name={quoteattr(name)}/><pic:cNvPicPr/>'
        "</pic:nvPicPr>"
        f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/>'
        "</a:stretch></pic:blipFill>"
        "<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/>"
        f'<a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        "</pic:pic></a:graphicData></a:graphic></wp:inline>"
        "</w:drawing></w:r>"
    )


# --------------------------------------------------------------------------
# section, header, footer
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class Page:
    """Page geometry in points, converted to twips on the way out.

    Built from ``theme``'s constants by the caller, so the DOCX and the PDF are
    the same A4 with the same margins rather than two documents that happen to
    look similar.
    """

    width_pt: float
    height_pt: float
    margin_left_pt: float
    margin_right_pt: float
    margin_top_pt: float
    margin_bottom_pt: float
    header_pt: float = 34.0
    footer_pt: float = 28.0

    @property
    def content_width_pt(self) -> float:
        return self.width_pt - self.margin_left_pt - self.margin_right_pt

    def cover_sect_pr(self) -> str:
        """``w:sectPr`` for a cover of its own: **page margins zero**, no furniture.

        This is the only way a DOCX gets a full-bleed colour band. Paragraph shading
        fills "left indent to right indent", and in a section with margins that stops
        at the text column — a navy block with white gutters, which reads as a small
        panel rather than a banner (「背景还是只有一小块」). A *section* can have zero
        margins, and then that same shading reaches the paper edge.

        The text inside the band is inset with a **tab stop**, never ``w:ind``: an
        indent moves the shading with the text and the bleed is lost again.

        A section break starts the next page by itself, so a cover built this way
        needs no page break of its own. The body section that follows restores the
        real margins and carries the running header and footer.
        """
        return (
            "<w:sectPr>"
            '<w:type w:val="nextPage"/>'
            f'<w:pgSz w:w="{round(self.width_pt * TWIP)}" '
            f'w:h="{round(self.height_pt * TWIP)}"/>'
            '<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" '
            'w:header="0" w:footer="0" w:gutter="0"/>'
            '<w:cols w:space="425"/>'
            '<w:docGrid w:linePitch="312"/>'
            "</w:sectPr>"
        )

    def sect_pr(self, *, header_rid: str | None, footer_rid: str | None,
                first_header_rid: str | None = None,
                first_footer_rid: str | None = None,
                title_page: bool = False) -> str:
        """``w:sectPr`` — references first, then type, size, margins, columns.

        ``w:titlePg`` plus a *first-page* header and footer is how the cover gets
        no running header and no page number, which is the PDF path's cover
        template expressed in the only vocabulary DOCX has for it.
        """
        refs = []
        if first_header_rid:
            refs.append(f'<w:headerReference w:type="first" r:id="{first_header_rid}"/>')
        if header_rid:
            refs.append(f'<w:headerReference w:type="default" r:id="{header_rid}"/>')
        if first_footer_rid:
            refs.append(f'<w:footerReference w:type="first" r:id="{first_footer_rid}"/>')
        if footer_rid:
            refs.append(f'<w:footerReference w:type="default" r:id="{footer_rid}"/>')
        return (
            "<w:sectPr>"
            + "".join(refs)
            + '<w:type w:val="nextPage"/>'
            + f'<w:pgSz w:w="{round(self.width_pt * TWIP)}" '
              f'w:h="{round(self.height_pt * TWIP)}"/>'
            + f'<w:pgMar w:top="{round(self.margin_top_pt * TWIP)}" '
              f'w:right="{round(self.margin_right_pt * TWIP)}" '
              f'w:bottom="{round(self.margin_bottom_pt * TWIP)}" '
              f'w:left="{round(self.margin_left_pt * TWIP)}" '
              f'w:header="{round(self.header_pt * TWIP)}" '
              f'w:footer="{round(self.footer_pt * TWIP)}" w:gutter="0"/>'
            + '<w:cols w:space="425"/>'
            + ("<w:titlePg/>" if title_page else "")
            + '<w:docGrid w:linePitch="312"/>'
            "</w:sectPr>"
        )


# --------------------------------------------------------------------------
# package
# --------------------------------------------------------------------------
@dataclass
class _Rel:
    rid: str
    type: str
    target: str
    mode: str | None = None


@dataclass
class Package:
    """The parts of one document, and the writer that zips them.

    Relationship ids are handed out in one sequence for the document part, which
    is the only part that gets images and hyperlinks. Header and footer parts
    carry no relationships of their own here — their content is text and fields.
    """

    title: str = ""
    author: str = ""
    subject: str = ""
    _rels: list[_Rel] = field(default_factory=list)
    _media: dict[str, bytes] = field(default_factory=dict)
    _parts: dict[str, str] = field(default_factory=dict)
    _next_rid: int = 1
    _next_ident: int = 1

    # ---------------------------------------------------------------- ids
    def _rid(self) -> str:
        rid = f"rId{self._next_rid}"
        self._next_rid += 1
        return rid

    def ident(self) -> int:
        """A document-unique integer for a bookmark or a drawing."""
        value = self._next_ident
        self._next_ident += 1
        return value

    def relate(self, type_: str, target: str, mode: str | None = None) -> str:
        rid = self._rid()
        self._rels.append(_Rel(rid, type_, target, mode))
        return rid

    def external(self, url: str) -> str:
        """A hyperlink relationship. ``TargetMode="External"`` is what makes it a
        link out rather than a reference to a part inside the package — omit it
        and Word reports the document as corrupt."""
        return self.relate(REL_HYPERLINK, url, mode="External")

    def image(self, path: Path) -> str:
        """Copy a PNG into ``word/media`` and return its relationship id."""
        path = Path(path)
        name = f"image{len(self._media) + 1}{path.suffix.lower()}"
        self._media[name] = path.read_bytes()
        return self.relate(REL_IMAGE, f"media/{name}")

    def part(self, name: str, xml: str) -> None:
        """Register an extra part (header, footer) already wrapped in its root."""
        self._parts[name] = xml

    # ---------------------------------------------------------------- write
    def save(self, out: Path, body: str) -> Path:
        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        document = (
            f"{_DECL}<w:document {_NS}><w:body>{body}</w:body></w:document>"
        )
        files: dict[str, bytes] = {
            "[Content_Types].xml": self._content_types().encode("utf-8"),
            "_rels/.rels": self._package_rels().encode("utf-8"),
            "docProps/core.xml": self._core().encode("utf-8"),
            "docProps/app.xml": self._app().encode("utf-8"),
            "word/document.xml": document.encode("utf-8"),
            "word/_rels/document.xml.rels": self._document_rels().encode("utf-8"),
        }
        for name, xml in self._parts.items():
            files[f"word/{name}"] = xml.encode("utf-8")
        for name, blob in self._media.items():
            files[f"word/media/{name}"] = blob

        # Deterministic: fixed order, fixed timestamp. Two runs of the same build
        # script produce byte-identical files, which is what lets a test diff them.
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            for name in sorted(files):
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(info, files[name])
        return out

    def _content_types(self) -> str:
        overrides = [
            ("/word/document.xml",
             "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"),
            ("/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"),
            ("/docProps/app.xml",
             "application/vnd.openxmlformats-officedocument.extended-properties+xml"),
        ]
        kinds = {
            "styles.xml": "styles",
            "settings.xml": "settings",
        }
        for name in self._parts:
            if name in kinds:
                overrides.append((
                    f"/word/{name}",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml."
                    f"{kinds[name]}+xml",
                ))
            elif name.startswith("header"):
                overrides.append((
                    f"/word/{name}",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"))
            elif name.startswith("footer"):
                overrides.append((
                    f"/word/{name}",
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"))
        defaults = {"rels": "application/vnd.openxmlformats-package.relationships+xml",
                    "xml": "application/xml"}
        for name in self._media:
            ext = name.rsplit(".", 1)[-1]
            defaults.setdefault(ext, f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}")
        return (
            f'{_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/'
            'content-types">'
            + "".join(f'<Default Extension="{e}" ContentType="{c}"/>'
                      for e, c in sorted(defaults.items()))
            + "".join(f'<Override PartName="{p}" ContentType="{c}"/>'
                      for p, c in overrides)
            + "</Types>"
        )

    def _package_rels(self) -> str:
        rels = [
            ("rId1", REL_DOCUMENT, "word/document.xml"),
            ("rId2", REL_CORE, "docProps/core.xml"),
            ("rId3", REL_APP, "docProps/app.xml"),
        ]
        return self._rels_xml([_Rel(*r) for r in rels])

    def _document_rels(self) -> str:
        return self._rels_xml(self._rels)

    @staticmethod
    def _rels_xml(rels: list[_Rel]) -> str:
        body = "".join(
            f'<Relationship Id="{r.rid}" Type="{r.type}" Target={quoteattr(r.target)}'
            + (f' TargetMode="{r.mode}"' if r.mode else "")
            + "/>"
            for r in rels
        )
        return (f'{_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/'
                f'package/2006/relationships">{body}</Relationships>')

    def _core(self) -> str:
        return (
            f'{_DECL}<cp:coreProperties '
            'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/'
            'core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" '
            'xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f"<dc:title>{escape(self.title)}</dc:title>"
            f"<dc:creator>{escape(self.author)}</dc:creator>"
            f"<cp:lastModifiedBy>{escape(self.author)}</cp:lastModifiedBy>"
            f"<dc:subject>{escape(self.subject)}</dc:subject>"
            "</cp:coreProperties>"
        )

    def _app(self) -> str:
        return (
            f'{_DECL}<Properties xmlns="http://schemas.openxmlformats.org/'
            'officeDocument/2006/extended-properties" '
            'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/'
            'docPropsVTypes"><Application>fin_report</Application>'
            "</Properties>"
        )


@dataclass(frozen=True)
class Style:
    #: ``paragraph`` or ``character``. A hyperlink's run style must be a character
    #: style; declaring it as a paragraph style makes Word ignore the reference.
    """One named paragraph style, as the reader's Word will list it.

    Named styles are the point of shipping DOCX at all: the recipient's next
    action is to edit the file, and an editable draft whose headings are direct
    formatting cannot be restyled, renumbered, or navigated. ``name`` carries
    Word's own style name where one exists (``heading 1``), so 「样式」 lists the
    localised 标题 1 the reader expects rather than a private label.
    """

    id: str
    name: str
    ppr: str = ""
    rpr: str = ""
    based_on: str | None = None
    next_id: str | None = None
    outline: int | None = None
    kind: str = "paragraph"


def styles_part(styles: list[Style], *, default_rpr: str, default_ppr: str = "") -> str:
    """``w:styles`` — docDefaults first, then each style with its children ordered.

    ``w:style`` orders as name, basedOn, next, uiPriority, qFormat, pPr, rPr; a
    ``w:pPr`` after a ``w:rPr`` is one of the orderings Word refuses to open.
    """
    out = [
        f"{_DECL}<w:styles {_NS}><w:docDefaults>",
        f"<w:rPrDefault>{default_rpr}</w:rPrDefault>",
        f"<w:pPrDefault>{default_ppr}</w:pPrDefault>",
        "</w:docDefaults>",
    ]
    for style in styles:
        parts = [f"<w:name w:val={quoteattr(style.name)}/>"]
        if style.based_on:
            parts.append(f'<w:basedOn w:val="{style.based_on}"/>')
        if style.next_id:
            parts.append(f'<w:next w:val="{style.next_id}"/>')
        parts.append("<w:qFormat/>")
        if style.ppr or style.outline is not None:
            inner = style.ppr
            if style.outline is not None:
                inner += f'<w:outlineLvl w:val="{style.outline}"/>'
            parts.append(f"<w:pPr>{inner}</w:pPr>")
        if style.rpr:
            parts.append(style.rpr)
        default = ' w:default="1"' if style.id == "Normal" else ""
        out.append(
            f'<w:style w:type="{style.kind}"{default} w:styleId="{style.id}">'
            + "".join(parts)
            + "</w:style>"
        )
    out.append("</w:styles>")
    return "".join(out)


def header_part(inner: str) -> str:
    return f"{_DECL}<w:hdr {_NS}>{inner}</w:hdr>"


def footer_part(inner: str) -> str:
    return f"{_DECL}<w:ftr {_NS}>{inner}</w:ftr>"


def settings_part() -> str:
    """Minimal ``w:settings``, in schema order.

    ``compressPunctuation`` and the East Asian typography defaults are what make
    Word set Chinese the way the house style expects — punctuation compression and
    kinsoku (line-breaking) are Word's job on this path, which is why
    ``fin_report.cjk`` has no part in it.
    """
    return (
        f"{_DECL}<w:settings {_NS}>"
        '<w:zoom w:percent="100"/>'
        '<w:defaultTabStop w:val="420"/>'
        '<w:characterSpacingControl w:val="compressPunctuation"/>'
        "<w:compat>"
        '<w:compatSetting w:name="compatibilityMode" '
        'w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>'
        "</w:compat>"
        "</w:settings>"
    )
