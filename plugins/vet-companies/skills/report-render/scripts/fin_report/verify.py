"""Verify a built PDF — or DOCX — before anyone reads it.

Everything here is a check that a human reviewer had to do by hand, or that
nobody did at all. The two prior report runs left folders of rendered page
images (``qa/p1.png`` … ``preview/p13.png``) — evidence of a manual
"render and look at every page" loop that was never encoded anywhere.

The highest-value check is font embedding. A reportlab PDF built with a built-in
CID font contains the correct Chinese text in its text layer — extraction looks
perfect — and renders **blank** in any viewer lacking Adobe's CJK packs. The
process that wrote it cannot tell. Inspecting the font resources can.

Layout is measured on **two** axes, because one number cannot see both defects.
Ink share catches a page with almost nothing on it. The foot gap catches a page
that simply stops half way down — a page missing its bottom 40% still renders
about 9% ink, so ink share passes it silently. The foot gap is also the only
layout signal available at all when the visual acceptance gate cannot run
(no vision this session), which is why it reports a measured millimetre figure
per page rather than a verdict: something has to be able to act on it.

    python3 -m fin_report.verify report.pdf --render qa/ --json

**A ``.docx`` argument runs the same gate in two parts.** The structural part
reads the package itself — that every ``[n]`` is a hyperlink whose anchor hits a
real bookmark, that every CJK run names an East Asian font, that the running
furniture and its ``PAGE`` field exist — and the text-layer checks that are about
the document rather than the medium. The layout part needs pagination, which
belongs to Word: with LibreOffice installed the file is converted and every
geometry check above runs on the conversion, and without it the run **exits 3**
and says the layout gate did not happen. Following ``xlsx-author``'s ``recalc.py``,
that is not a pass.

Exit 0 clean, 1 if any check fails, 3 if a DOCX could not be paginated.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from xml.etree import ElementTree

from reportlab.lib.units import mm

from . import cjk, rules, theme
from .refs import BARE_DOMAIN

CJK = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
#: The PDF standard-14 fonts are present in every conforming viewer, so they are
#: not the embedding problem. reportlab puts Helvetica in a page's resources by
#: default whether or not any text uses it; failing on that would make the check
#: fire on every correct document and therefore get ignored.
STANDARD_14 = {
    "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
    "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
    "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
    "Symbol", "ZapfDingbats",
}
#: A page below this share of non-white pixels is suspiciously empty. Tuned to
#: flag a stranded caption or an orphaned heading, not a legitimately airy page.
INK_FLOOR = 0.005
#: A page with text in its layer but essentially no ink rendered is the blank-CJK
#: symptom, and is a hard failure rather than a warning.
BLANK_CEILING = 0.0008
#: Unused column height at the foot of a page, above which the page is reported as
#: ending early. Ink share cannot see this: a page missing its bottom 40% still
#: renders ~9% ink, far above INK_FLOOR, because INK_FLOOR is calibrated for a
#: page holding one stranded line. The two measure different defects and both are
#: needed — "almost nothing on the page" and "the page stops half way down".
#:
#: Re-calibrated on 23 real foot gaps from one run (2026-08-18). Twenty of them
#: fell in a tight 40–57mm band and three stood apart at 79 / 90 / 99mm. That band
#: is the natural ragged bottom of a flowing document, not a defect population —
#: only the outliers carry the signature of a block that was deferred whole.
#:
#: The first calibration put the floor at 40mm on the strength of a *single* page
#: that read as normal at 26mm, and reporting the whole band had a cost that is
#: worse than the gaps: a model chasing the warnings rebuilt one report **12 times
#: (27 verify runs)**, driving the gap down 78→72→54→48→46→44→42→40mm, and paid for
#: it by hoisting a data table onto page 2 ahead of any prose. Tidier pages, a worse
#: document. A warning with no acceptable floor optimises the wrong objective.
FOOT_GAP_FLOOR = 78 * mm
#: 104mm ≈ 40% of the column, the height of a full figure block — the point where a
#: page is visibly missing a chunk rather than merely ending early.
FOOT_GAP_SERIOUS = 104 * mm
#: Share of the column a **final** page may leave unused before it reads as a stub
#: rather than as a document ending. The last page is exempt from FOOT_GAP_FLOOR
#: for a good reason — a document has to stop somewhere and the stopping page is
#: almost always partial — but the exemption was unconditional, which made the
#: check blind to the one defect only a human then caught: a 12-page report whose
#: page 12 held a single Sources entry and the disclaimer, 87% blank, at 2.1% ink
#: (above INK_FLOOR, so the emptiness checks passed too). At 70% the page carries
#: less than a third of a column, i.e. the content on it would have fitted on the
#: page before had anything upstream been willing to give up a few points.
FINAL_PAGE_STUB_SHARE = 0.70
#: Page text containing one of these as a whole line, near the top, marks a section
#: the house style gives its own page — so the page *before* it legitimately ends
#: early. Whole-line matching is required: 来源 also occurs inside every 资料来源
#: note line, and matching those would exempt most of the document.
HARD_BREAK_HEADINGS = ("来源", "Sources")
#: The line where a foot gap's disposition is recorded. Checked by name, so the
#: label has to be stable: the coverage policy names this exact string, and a
#: renamed line reads as "nobody recorded a disposition".
LAYOUT_LINE = "版面自检"
#: Where that disposition lives. It is **build-process QA, not analysis**, so it
#: is written beside the rendered pages and never printed in the deliverable: a
#: reader of an industry primer has no use for "page 5 had a 63mm gap, fixed by
#: shrinking 图3", and shipping it puts internal review chatter on the last page
#: next to the coverage table, where it reads as if it were part of the finding.
#: Accountability is unchanged — the verdict is still mandatory and still
#: checkable, just addressed to the person reviewing the build.
LAYOUT_REVIEW_FILE = "layout-review.md"
#: Build-QA vocabulary that must never reach a deliverable. These describe how
#: the file was made, not what was analysed, and a reader takes anything printed
#: beside 财报披露日 / 覆盖范围 for part of the finding. Shipped examples: a cover
#: meta block carrying 「未经视觉验收（已过数值版式检查）」 between the report type
#: and the KPI strip, and an industry primer closing with 「第5页因图3放不下留下
#: 63mm空隙（缩小图3后消除）」 under its coverage table. Both belong in
#: LAYOUT_REVIEW_FILE. Legal and scope statements — 分析师底稿, 不构成投资建议,
#: 数据截至 — are not QA and are deliberately absent from this list.
QA_VOCABULARY = (
    "未经视觉验收", "数值版式检查", "版面自检", "视觉复核", "视觉验收",
    "逐页复核", "canary", "版面缺陷",
)
#: Pixels per point when rasterising. 1.4 keeps a page around 1150px tall — enough
#: for the foot-gap scan to resolve a single line, cheap enough to run per page.
RENDER_SCALE = 1.4
#: Greyscale value below which a pixel counts as ink. Not 255: anti-aliasing puts
#: near-white pixels along every glyph edge, and counting those would report ink on
#: a blank page.
INK_MAX = 240


@dataclass
class Report:
    path: str
    #: Which backend built the artefact. ``docx`` reports carry the structural
    #: findings and, when LibreOffice was available, the geometry ones too.
    format: str = "pdf"
    #: ``ok`` or ``pagination_unavailable`` — the second is exit 3 and never a pass.
    status: str = "ok"
    pages: int = 0
    cjk_chars: int = 0
    links_internal: int = 0
    links_external: int = 0
    markers: int = 0
    embedded_fonts: list[str] = field(default_factory=list)
    unembedded_fonts: list[str] = field(default_factory=list)
    ink: list[float] = field(default_factory=list)
    #: Characters pypdf extracts from each page. Paired with ``ink`` this separates
    #: "text is there but nothing rendered" (font not embedded) from "the page is
    #: genuinely empty" (a stray break), which one document-wide flag could not.
    page_chars: list[int] = field(default_factory=list)
    #: Unused column height at the foot of each page, in points. ``None`` where the
    #: page is not the house size, so the margins defining the column do not apply.
    foot_gaps: list[float | None] = field(default_factory=list)
    rendered: list[str] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures


def _fonts(reader) -> tuple[list[str], list[str]]:
    """Split the PDF's fonts into embedded and not.

    An embedded TrueType carries FontFile2 in its descriptor. A Type0 font whose
    descendant has no FontFile2/FontFile3 is a reference to a font the viewer is
    expected to already have — which for CJK it usually does not.
    """
    embedded: set[str] = set()
    missing: set[str] = set()
    for page in reader.pages:
        try:
            resources = page["/Resources"].get_object()
            table = resources.get("/Font")
            if table is None:
                continue
            table = table.get_object()
        except (KeyError, AttributeError):
            continue
        for font in table.values():
            try:
                font = font.get_object()
                name = str(font.get("/BaseFont", "?")).lstrip("/")
                descriptors = []
                if "/FontDescriptor" in font:
                    descriptors.append(font["/FontDescriptor"].get_object())
                for descendant in font.get("/DescendantFonts", []) or []:
                    child = descendant.get_object()
                    if "/FontDescriptor" in child:
                        descriptors.append(child["/FontDescriptor"].get_object())
                if descriptors and any(
                    any(k in d for k in ("/FontFile", "/FontFile2", "/FontFile3"))
                    for d in descriptors
                ):
                    embedded.add(name)
                elif name.split("+")[-1] not in STANDARD_14:
                    missing.add(name)
            except (KeyError, AttributeError, TypeError):
                continue
    return sorted(embedded), sorted(missing - embedded)


def _links(reader) -> tuple[int, int]:
    internal = external = 0
    for page in reader.pages:
        for annot in page.get("/Annots", []) or []:
            try:
                obj = annot.get_object()
            except (AttributeError, TypeError):
                continue
            if obj.get("/Subtype") != "/Link":
                continue
            action = obj.get("/A")
            action = action.get_object() if action is not None else {}
            if "/URI" in action:
                external += 1
            elif "/Dest" in obj or "/D" in action or action.get("/S") == "/GoTo":
                internal += 1
    return internal, external


def _foot_gap(grey, page_w: float, page_h: float) -> float | None:
    """Unused column height at the foot of one page, in points.

    Scans the *content box* upward from its bottom edge for the first row holding
    ink. The box is the whole point: the footer rule and page number are drawn
    below ``MARGIN_B``, so a whole-page scan finds ink on every page and reports no
    gap anywhere — which is the shape of a check that always passes.

    Returns ``None`` for a page that is not the house size, because the margins
    defining the column would then be wrong. No number beats an invented one.
    """
    if abs(page_w - theme.PAGE_W) > 1 or abs(page_h - theme.PAGE_H) > 1:
        return None
    width_px, height_px = grey.size
    scale = height_px / page_h
    left = max(0, int(theme.MARGIN_L * scale))
    right = min(width_px, int((page_w - theme.MARGIN_R) * scale))
    top = max(0, int(theme.MARGIN_T * scale))
    bottom = min(height_px, int((page_h - theme.MARGIN_B) * scale))
    if right - left < 2 or bottom - top < 2:
        return None

    column = grey.crop((left, top, right, bottom))
    cols, rows = column.size
    raw = column.tobytes()
    for row in range(rows - 1, -1, -1):
        # min() over a bytes slice runs in C. A per-pixel loop here cost more than
        # the render this piggybacks on.
        if min(raw[row * cols:(row + 1) * cols]) < INK_MAX:
            return (rows - 1 - row) / scale
    return rows / scale


def _ink(pdf_path: Path,
         render_dir: Path | None) -> tuple[list[float], list[float | None], list[str]]:
    """Per-page ink share and foot gap, optionally saving the page images.

    The saved image is the COLOUR render. Ink is measured on a greyscale copy —
    an earlier version saved the greyscale conversion itself, which made every QA
    page look monochrome and would have hidden any palette or contrast defect
    from the human doing the page-by-page review.
    """
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return [], [], []
    shares: list[float] = []
    gaps: list[float | None] = []
    written: list[str] = []
    doc = pdfium.PdfDocument(str(pdf_path))
    try:
        if render_dir:
            render_dir.mkdir(parents=True, exist_ok=True)
        for index in range(len(doc)):
            source = doc[index]
            page = source.render(scale=RENDER_SCALE).to_pil().convert("RGB")
            grey = page.convert("L")
            pixels = grey.getdata()
            total = len(pixels)
            dark = sum(1 for value in pixels if value < INK_MAX)
            shares.append(round(dark / total, 5) if total else 0.0)
            gaps.append(_foot_gap(grey, *source.get_size()))
            if render_dir:
                out = render_dir / f"p{index + 1:02d}.png"
                page.save(out)
                written.append(str(out))
    finally:
        doc.close()
    return shares, gaps, written


def _layout_review_recorded(pdf: Path, render_dir: str | Path | None,
                            text: str) -> bool:
    """Whether a foot-gap disposition exists, wherever it is allowed to live.

    Searched in order:

    1. ``<render_dir>/layout-review.md`` — the intended home. ``render_dir`` is
       the QA directory the build already writes page images into, so the verdict
       sits with the evidence it was formed from.
    2. ``<pdf parent>/layout-review.md`` — for a build that rendered no images.
    3. The PDF text — accepted so an older deliverable that printed the line does
       not suddenly fail, but no longer the way to satisfy this. Printing it puts
       "第5页因图3放不下留下63mm空隙（缩小后消除）" on the last page of a research
       report, beside the coverage table, where a reader reasonably takes it for
       part of the analysis.

    A file that exists but says nothing does not count: the label must appear in
    it, for the same reason the label is checked at all.
    """
    candidates = []
    if render_dir is not None:
        candidates.append(Path(render_dir) / LAYOUT_REVIEW_FILE)
    candidates.append(pdf.parent / LAYOUT_REVIEW_FILE)
    for candidate in candidates:
        try:
            if candidate.is_file() and LAYOUT_LINE in candidate.read_text(
                    encoding="utf-8", errors="replace"):
                return True
        except OSError:
            continue
    return LAYOUT_LINE in text


def _section_start_page(page_texts: list[str]) -> int | None:
    """1-based page a hard-break section heading opens on, or None.

    Whole-line match, and only near the top of the page — the same discipline the
    foot-gap exemption uses, and for the same reason: the running header, footer
    disclaimer and page number occupy the first extracted lines of every page, and
    来源 also appears inside every 资料来源 note line, so matching it anywhere would
    claim the section starts on whichever page holds the first exhibit.
    """
    for index, text in enumerate(page_texts, start=1):
        if any(line.strip() in HARD_BREAK_HEADINGS
               for line in text.splitlines()[:12]):
            return index
    return None


def _last_page_continues_list(page_texts: list[str]) -> bool:
    """True when the final page is a *continuation* of the hard-break section.

    The discriminator behind the last-page check. Three cases have to come out
    differently and all three are real:

    * heading on an earlier page, last page holds the remainder — a reflowable
      list spent a page on a few entries. Reportable.
    * heading *on* the last page — the section simply is short. The break above it
      is house style; nothing to reflow.
    * no such section at all — a body document ending mid-page. Not a defect in
      any sense; prose ends where it ends.
    """
    start = _section_start_page(page_texts)
    return start is not None and start < len(page_texts)


#: A provenance tag in the text layer. The five literal tags and their English
#: aliases — the same set ``theme.CHIP`` accepts, kept as one alternation so a
#: tag added to the policy is added in one place.
TAG = re.compile(r"\[(" + "|".join(re.escape(k) for k in theme.CHIP) + r")\]")
#: Two or more tags with nothing between them **but a citation marker**: the pile.
#: Whether it is a defect depends on the *classes* involved, so the classes are
#: compared below — a repeated same-class tag is redundant but says nothing false.
#:
#: The ``[n]`` tolerance is not cosmetic. Anchored on adjacency alone this
#: reported zero piles on the 2026-08-24 batch while one deliverable carried seven,
#: every one of them written ``[披露][1][测算]`` — the citation marker sits between
#: the two classes because that is the order the author emits them in, and the
#: reader is left with exactly the ambiguity the rule exists to prevent.
TAG_RUN = re.compile(
    TAG.pattern + r"(?:\s*\[\d+(?:\s*[,，]\s*\d+)*\]\s*)*" + TAG.pattern)

#: A tag opening a bullet, e.g. ``• [推断] 控制权高度集中``. In prose a tag
#: qualifies the figure it follows, so one with nothing to its left has nothing to
#: qualify — and in every observed case it had also been typed as plain text
#: rather than emitted through ``theme.chip()``, so it printed at body size in
#: body colour instead of as a 6pt chip.
#:
#: **Anchored on the bullet, not on the line start.** Keying on "a tag beginning
#: an extracted line" looked equivalent and was not: pypdf reports the renderer's
#: wrapped lines, so it flagged every tag that happened to land after a line
#: break — 41 on one compliant deliverable and 25 on another, against 8 real ones
#: on a third. A bullet is an authoring choice; a line break is typesetting.
TAG_LEADS = re.compile(r"(?:^|\n)\s*(?:[•]|[-*]\s)\s*" + TAG.pattern)
#: The legend's opening label. ``theme.legend`` writes 标签图例, but the label is
#: not fixed by policy and the skills' own output templates ship three spellings
#: (标签图例 / 标签口径 / 标注说明) — all three appear in deliverables that carry a
#: correct legend. Matching only the helper's wording would fail those, and a
#: check that fires on compliant work teaches the reader to ignore it.
LEGEND = re.compile(r"标签图例|标签口径|标注说明|Provenance legend")
#: Pages a legend may occupy. provenance.md says "page 1", and the house layout
#: puts a cover there — title, rating, KPI strip, nothing to chip. So the first
#: page carrying body text is page 2 in most deliverables and page 1 in a
#: cover-less one, and both are compliant. Anything later is not: the reader has
#: already met the chips.
LEGEND_MAX_PAGE = 2

#: A line that repeats across pages is the running header/footer, not content.
#: Used to answer "is the legend the first thing on its page, or is it sitting
#: inside a section?" without needing font sizes: everything above a correctly
#: placed legend is chrome.
PAGE_NUMBER = re.compile(r"^(?:第\s*\d+\s*页(?:\s*/\s*\d+)?|Page\s+\d+(?:\s*/\s*\d+)?|\d{1,3})$")

#: An MCP server or tool name. The citation policy asks for the *provider* — the
#: organisation the data came from plus which fields — and bans the interface,
#: because a reader cannot check ``wind-fund`` and it expires when the wiring
#: changes. Both spellings observed in shipped deliverables are here: the server
#: in parentheses after a correct vendor name (``万得基金（wind-fund）``) and the
#: tool inside the 文档或系统名 segment (``天眼查 · 企业基础画像（get_company_basic_profile
#: 实时查询）``).
INTERFACE_NAME = re.compile(
    r"\b(?:hexin|wind|sec)-(?:stock|fund|bond|index|global-stock|economic|docs|search)\b"
    r"|\bfinance-search\b|\bsec-search\b|\btianyancha\b"
    r"|\b(?:get|search|query|list|fetch)_[a-z][a-z_]{3,}\b")
#: A URL with no path: a vendor's front door. `citations.md` gives the URL field
#: two honest forms — the specific page that was accessed, or nothing at all when
#: an interface served the data and no public page exists. A bare domain is the
#: third thing, and it makes the deliverable look better sourced than it is.
BARE_DOMAIN_URL = re.compile(r"https?://[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/?(?=[\s，。；)）\]]|$)")
#: Any URL, for eliding before the interface-name scan — a hostname legitimately
#: carries the vendor's own spelling (``www.tianyancha.com/company/2343820668``).
ANY_URL = re.compile(r"https?://\S+")
#: The numeric literal a chip is bound to, and the sentence it sits in. Used to
#: catch the value printed twice: prose states the figure, then ``tagged()`` is
#: handed the same figure again, so the page reads
#: 「同比+52.95%1,291.31/207.38/180.93亿元[披露]」. ``tagged()`` cannot see this —
#: from inside the call the value is just a string — so it is checked on the file.
CHIP_VALUE = re.compile(r"([\d][\d,]*(?:\.\d+)?(?:\s*[/、]\s*[\d,]+(?:\.\d+)?)*)"
                        r"\s*(?:亿元|万元|亿|万|元|%|pct|倍|个百分点)?\s*$")
SENTENCE_SPLIT = re.compile(r"[。；;\n]")

#: A derived value, and the cue that announces it. Everything this matches is
#: arithmetic over a disclosed figure — a growth rate, a sequential move, a share
#: of a total — so it is `[测算]`, or `[披露]` where the issuer disclosed the ratio
#: itself. Either way a tag is required: `provenance.md` names the variance column
#: among the places a chip is mandatory, and `[测算]` is one of the three classes
#: never left unmarked in any medium.
#:
#: The gap absorbs the connective an author writes between the cue and the number
#: (「环比回落约3.4pct」, 「同比仅+0.7%」) and stops at a clause delimiter, so the cue
#: cannot reach across 「同比增速为披露口径」 into some unrelated figure downstream.
DERIVED_VALUE = re.compile(
    r"(?:同比|环比|较年初|较上年|较上月|较年末|折年|年化|占比|复合增速|CAGR)"
    r"[^\d\n，。；、（）()]{0,6}"
    r"[+\-＋－]?\d[\d,]*(?:\.\d+)?\s*(?:%|pct|个百分点|bp|BP|倍)")
#: An exhibit's own note line. Apparatus, not a claim: it names the source, which
#: is what carries the class for the figures above it, and it routinely *describes*
#: a 口径 in the same words a claim would use (「同比为披露口径」, 「环比为对
#: 2025Q4 单季测算值」).
#:
#: Used as a **cut point inside the sentence**, not as a line filter, and it has to
#: be both of those things at once. A long note wraps and pypdf reports the wrapped
#: lines, so blanking the line the label sits on orphans the remainder — that was
#: the one non-cover false positive the compliant of the two reports behind this
#: check produced (「26H1按销量同比+60%推算约429GWh」, the second line of a 图7
#: note). Cutting at the label instead drops the note *and* its continuation while
#: keeping the exhibit title in front of it in scope, where a title asserting
#: 「同比+8.5%」 belongs.
SOURCE_NOTE = re.compile(r"资料来源|数据来源|Sources?\s*[:：]")

#: The running footer's page label, drawn by ``doc._page_bg`` on every page it
#: owns and by ``_cover_bg`` on none. Both locales, since the label is localised.
PAGE_LABEL = re.compile(r"第\s*\d+\s*页|Page\s+\d+")
#: A line that only a **content** page carries: a numbered section heading, or an
#: exhibit caption. Used to decide whether a page missing the running chrome is a
#: legitimate cover or a body page drawn on the cover template. Matched at the
#: start of a line so 「见表2」 inside a sentence does not make a cover look like
#: content, and kept to the two shapes the house style actually emits.
BODY_PAGE_MARK = re.compile(
    r"^(?:[一二三四五六七八九十]+、|\d{1,2}[.、]\s*\S|(?:表|图|Table|Figure)\s*\d+)")
#: The two halves of a bracketed group cut by a line break. The tail is any line
#: ending on an opener; the head is a line opening with a citation number or a tag
#: name immediately followed by its closing bracket — the remnant of ``[披露]``
#: whose ``[`` stayed behind.
SPLIT_GROUP_TAIL = re.compile(r"[\[［]\s*$")
SPLIT_GROUP_HEAD = re.compile(
    r"^(?:\d{1,3}|" + "|".join(re.escape(k) for k in theme.CHIP) + r")[\]］]")
#: A line holding nothing but CJK punctuation — the tail of a sentence stranded
#: because reportlab hangs one closer and no more.
LONE_PUNCT_LINE = re.compile(r"[。；，、）」』】％%]+")
#: A bullet, whose marker legitimately opens a line with a character the 避头尾
#: scan would otherwise read as leading punctuation.
BULLET_LINE = re.compile(r"^\s*(?:[•·]|[-*]\s)")
#: A bracket group shaped like a provenance tag: two to six CJK characters, in
#: either bracket width. Everything matching is either a real chip (half-width, a
#: legal tag) or a hand-typed one, and ``_check_handtyped_tags`` separates them.
#: Zero false positives across the two 2026-08-26 deliverables (16 pages).
TAG_SHAPED = re.compile(r"[\[［]([一-鿿]{2,6})[\]］]")
#: The coverage scan splits on the full stop alone, not on `SENTENCE_SPLIT`. A run
#: of one class legitimately spans the semicolons of an enumeration —
#: 「营业收入1291.31亿元，同比+52.45%；归母净利润207.38亿元，同比+48.52%[披露][3]」
#: is one run under one trailing tag — and splitting there reported the middle
#: clause of a compliant sentence as untagged.
FULL_STOP = re.compile(r"[。]")


def _chrome(page_texts: list[str]) -> set[str]:
    """Lines appearing on more than one page: the running header and footer."""
    if len(page_texts) < 2:
        return set()
    counts: dict[str, int] = {}
    for text in page_texts:
        for line in {l.strip() for l in text.split("\n") if l.strip()}:
            counts[line] = counts.get(line, 0) + 1
    return {line for line, n in counts.items() if n >= 2}


def _legend_is_page_head(page_texts: list[str], where: int) -> bool:
    """True when nothing but chrome precedes the legend on its own page.

    A legend one line below 「核心观点」 is typographically inside that section, and
    12 of the 14 deliverables in the 2026-08-24 batch printed it exactly there —
    the reading key read as the opening sentence of the executive summary. The
    cover is exempt: legend-at-the-foot-of-the-cover is a legal placement, and the
    whole cover precedes it by design.
    """
    if where <= 1:
        return True
    chrome = _chrome(page_texts)
    if not chrome:
        return True
    for line in page_texts[where - 1].split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if LEGEND.search(stripped):
            return True
        if stripped in chrome or PAGE_NUMBER.match(stripped):
            continue
        return False
    return True


def _echoed_chip_values(page_texts: list[str]) -> list[str]:
    """Chips handed a figure the same sentence already printed."""
    hits: list[str] = []
    for index, page in enumerate(page_texts, start=1):
        flat = re.sub(r"[ \t]+", "", _without_legend(page).replace("\n", ""))
        for tag in TAG.finditer(flat):
            before = flat[max(0, tag.start() - 60):tag.start()]
            value = CHIP_VALUE.search(before)
            if not value:
                continue
            literal = re.sub(r"\s", "", value.group(1))
            if len(literal.rstrip("0").rstrip(".").replace(",", "")) < 3:
                continue
            sentence = SENTENCE_SPLIT.split(before[:value.start(1)])[-1]
            if literal in sentence:
                hits.append(f"page {index}: …{literal}{tag.group(0)}")
    return hits


def _without_legend(page: str) -> str:
    """A page with its legend line blanked, for the tag-placement scans.

    The legend is a key, not a claim: it prints every tag the document uses,
    glossed and separated, which is exactly the shape the placement checks look
    for. Elide rather than skip the page — a real pile elsewhere on the page the
    legend sits on must still fail. (Same technique, and the same reason, as
    ``evals/checks/text.py``'s exempt-context elision.)
    """
    out = []
    for line in page.split("\n"):
        out.append(" " * len(line) if LEGEND.search(line) else line)
    return "\n".join(out)


def _untagged_derivations(page_texts: list[str]) -> list[str]:
    """Sentences that state a derived value and carry no provenance tag at all.

    The coverage half of the tag policy, and the half no gate had. Every check
    above asks whether the tags a document *has* are placed and bound correctly;
    none of them asks whether the figures that need one got one, so a deliverable
    with six chips passed exactly as cleanly as the same deliverable with thirty-
    five. Measured on two 业绩点评 of near-identical length: 134 tags against 64,
    and the thinner one left all thirteen of its 环比 figures — every one of them
    computed off the prior quarter — indistinguishable from a disclosure.

    Scoped to keep the report worth reading, since a coverage check that fires on
    compliant prose teaches its reader to skip it:

    * **The sentence is the unit, and a tag anywhere in it clears it.** One
      trailing tag covering a run of one class is the correct shape, not a defect.
    * **Apparatus is elided** — the legend, the running header and footer, and each
      exhibit's 资料来源 note, which names the source that carries the class and
      states the 口径 in the same words a claim would.
    * **The 来源 section is out of scope.** A Sources entry describes the document
      it points at (「…同比增长48.52%」 inside the title of a cited article); the
      figure is the source's, not ours.

    The cover is deliberately **in** scope. `provenance.md` names the KPI strip
    among the places a chip is mandatory, and the strip is the first place a reader
    meets 同比+11.0% — ahead of the legend that would explain it. Both reports
    behind this check leave it bare.
    """
    chrome = _chrome(page_texts)
    stop = _section_start_page(page_texts) or len(page_texts) + 1
    hits: list[str] = []
    for index, page in enumerate(page_texts, start=1):
        if index >= stop:
            break
        kept = []
        for line in page.split("\n"):
            stripped = line.strip()
            if (not stripped or stripped in chrome or PAGE_NUMBER.match(stripped)
                    or LEGEND.search(line)):
                continue
            kept.append(line)
        flat = re.sub(r"[ \t]+", "", "".join(kept))
        for sentence in FULL_STOP.split(flat):
            claim = SOURCE_NOTE.split(sentence, maxsplit=1)[0]
            found = DERIVED_VALUE.search(claim)
            if found and not TAG.search(claim):
                hits.append(f"page {index}: …{found.group(0)}…")
    return hits


def _check_tag_coverage(report: Report, page_texts: list[str]) -> None:
    """Derived figures shipped with no class on them.

    Separate from ``_check_provenance_tags`` and called unconditionally, because
    that function returns early on a document with no tags at all — which is the
    worst case of this defect, not an exemption from it. ``provenance.md``: "a
    prose deliverable with no chips at all is making an implicit claim that
    everything in it is sourced fact — so if it contains one computed figure, that
    figure is chipped even if nothing else is."
    """
    untagged = _untagged_derivations(page_texts)
    if not untagged:
        return
    report.warnings.append(
        f"{len(untagged)} sentence(s) state a 同比/环比/占比-class figure with no "
        "provenance tag anywhere in them, so a computed value is indistinguishable "
        "from a disclosed one: "
        + "; ".join(untagged[:8]) + ("; …" if len(untagged) > 8 else "")
        + ". A sequential or year-on-year move you computed off a prior period is "
        "`[测算]`; one the issuer printed is `[披露]`. One trailing "
        "rep.chip(标签) covers a run of one class — the fix is one chip per run, "
        "not one per figure"
    )


def _check_provenance_tags(report: Report, page_texts: list[str]) -> None:
    """Provenance-tag rules that only the built file can settle.

    ``provenance.md`` asks for three things a build script cannot check about
    itself: a legend on page 1 listing only the tags that appear, exactly one tag
    per claim, and a chip bound to the figure it qualifies. ``doc.Report`` now
    enforces the first two by construction, but a deliverable can still be
    hand-assembled or built by an older script, and the whole point of this
    module is that the file is the evidence.

    Measured on the 2026-08-24 batch, all fourteen deliverables passing every
    check this file then had: 9 of 14 used 38–171 chips with no legend at all;
    12 clauses stacked mixed classes at their end (one of them printing three
    computed figures under a leading ``[披露]``); 15 bullets opened with a bare
    tag at body size. None of it was visible to any gate.
    """
    text = "\n".join(page_texts)
    used = {m.group(1) for m in TAG.finditer(text)}
    if not used:
        return

    where = next((i for i, t in enumerate(page_texts, start=1)
                  if LEGEND.search(t)), None)
    if where is None:
        report.failures.append(
            f"{len(used)} provenance tag class(es) are used ({', '.join(sorted(used))}) "
            "but the document carries no legend — provenance.md requires one on "
            "page 1 listing only the tags that appear. Build it with rep.legend()"
        )
    elif where > LEGEND_MAX_PAGE:
        report.failures.append(
            f"the provenance legend is on page {where} — a reader meets the chips "
            f"before the key that explains them. It belongs on the first page "
            f"carrying body text (page 1, or page 2 behind a cover)"
        )
    elif not _legend_is_page_head(page_texts, where):
        report.failures.append(
            f"the provenance legend on page {where} has body content above it, so it "
            "reads as the opening line of whatever section it landed in rather than "
            "as the document's reading key. It belongs in its own block at the head "
            "of the first content page, above the first heading, or at the foot of "
            "the cover — rep.legend() places it for you (placement='lead'|'cover'); "
            "do not call it after a heading and expect it to stay there"
        )

    piles: list[str] = []
    for index, page in enumerate(page_texts, start=1):
        for run in TAG_RUN.finditer(_without_legend(page)):
            classes = TAG.findall(run.group(0))
            if len(set(classes)) < 2:
                continue
            piles.append(f"page {index}: {''.join('[%s]' % c for c in classes)}")
    if piles:
        report.failures.append(
            f"{len(piles)} clause(s) stack tags of different classes with no figure "
            "between them, so no reader can tell which number is which class — "
            "provenance.md asks for exactly one tag per claim. Bind each chip to its "
            "own figure with rep.tagged(value, tag): "
            + "; ".join(piles[:6]) + ("; …" if len(piles) > 6 else "")
        )

    leads: list[str] = []
    for index, page in enumerate(page_texts, start=1):
        for hit in TAG_LEADS.finditer(_without_legend(page)):
            leads.append(f"page {index}: [{hit.group(1)}]")
    if leads:
        report.warnings.append(
            f"{len(leads)} tag(s) open a line or bullet with nothing to their left — "
            "a chip qualifies the figure it follows, and a hoisted one is also "
            "typically typed as plain text rather than emitted as a 6pt chip: "
            + "; ".join(leads[:6]) + ("; …" if len(leads) > 6 else "")
        )

    echoes = _echoed_chip_values(page_texts)
    if echoes:
        report.failures.append(
            f"{len(echoes)} chip(s) are bound to a figure the same sentence already "
            "printed, so the number appears twice running: "
            + "; ".join(echoes[:6]) + ("; …" if len(echoes) > 6 else "")
            + ". rep.tagged(value, tag) *renders* the value — pass the figure to it "
            "instead of writing the figure and then tagging a copy of it"
        )


def _check_page_furniture(report: Report, page_texts: list[str]) -> None:
    """A page carrying body content must carry the running header and footer.

    The cheap, reliable signal is the page label: ``_page_bg`` draws 「第 N 页」 on
    every page it owns and ``_cover_bg`` draws none. So a page that holds a
    numbered section heading or a 表n/图n caption and yet has no page label is a
    body page wearing the cover's furniture — which is what the whole document did
    until ``sources()`` when a deliverable did not call ``cover()``, because
    reportlab opens on the first template registered.

    Shipped 2026-08-26: a four-page 晨会纪要 whose pages 1–2 sat under the 66mm
    navy band, with 「表1 池内六标的」 — a NAVY caption — invisible inside it, and no
    page numbers. Every existing check passed: the band *is* ink, and the caption
    *is* in the text layer.

    Anchored on content, not on page number, so a real cover stays exempt: a cover
    carries a title, a meta block and a KPI strip, none of which match. The
    document's own 来源 page is not exempt and does not need to be — it is drawn on
    ``main`` and carries its label.
    """
    offenders = []
    for index, text in enumerate(page_texts, start=1):
        lines = [line.strip() for line in text.splitlines()]
        if not any(BODY_PAGE_MARK.match(line) for line in lines):
            continue
        if PAGE_LABEL.search(text):
            continue
        offenders.append(index)
    if offenders:
        report.failures.append(
            f"page(s) {', '.join(map(str, offenders))} carry body content (a numbered "
            "heading or a 表n/图n exhibit) but no running header, footer or page "
            "number — they are being drawn on the **cover** page template. A "
            "deliverable that does not call rep.cover() must still open on the body "
            "template; if this is a 晨报/盘后/事件提示 built by an older report-render, "
            "rebuild it. Left alone, the cover's navy band prints behind the text and "
            "any NAVY caption inside the band is invisible"
        )


def _check_broken_brackets(report: Report, page_texts: list[str]) -> None:
    """A ``[标签]`` or ``[n]`` cut in half by a line break.

    reportlab's CJK breaker splits between any two characters and never consults
    its own ``ALL_CANNOT_END``, so a line ended ``…固定汇率+4%[`` and the next opened
    ``披露]`` — six times in one 业绩点评. ``fin_report.cjk`` now forbids the break;
    this is the regression net on the built file, and it is a **failure** rather
    than a warning because the same cut inside a citation marker turns ``[12]``
    into ``[1`` / ``2]``, which reads as a different source and is undetectable by
    eye.

    Both halves are checked. A line ending in an opener catches the cut wherever
    it lands; a line opening with a closer catches it again from the other side,
    which is what survives an extractor that reflows differently from the renderer.
    """
    broken: list[str] = []
    for index, text in enumerate(page_texts, start=1):
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if SPLIT_GROUP_TAIL.search(stripped):
                broken.append(f"page {index}: …{stripped[-24:]}")
            elif SPLIT_GROUP_HEAD.match(stripped):
                broken.append(f"page {index}: {stripped[:24]}…")
    if broken:
        report.failures.append(
            f"{len(broken)} bracketed group(s) are split across a line break — a "
            "provenance chip or a [n] citation marker with its opening bracket on one "
            "line and its content on the next: "
            + "; ".join(broken[:6]) + ("; …" if len(broken) > 6 else "")
            + ". fin_report.cjk forbids this break; a file showing it was built "
            "without that module (or by a script bypassing doc.Report)"
        )


def _check_line_breaking(report: Report, page_texts: list[str]) -> None:
    """Chinese 避头尾 on the built page: 行首标点, 孤立标点行, 行尾开括号.

    reportlab's prohibition set is Japanese — ``，；：！？…`` are simply not in it,
    so they were pushed onto the next line and opened it — and its hang rule fires
    for one character only, so a chained closer such as ``）。`` hung the bracket and
    left the full stop alone on a line. Measured on one 业绩点评's own body prose:
    27 defects in 146 lines.

    A **warning**, not a failure, and deliberately so: ``fin_report.cjk`` prevents
    all three, so anything reaching here comes from a style that does not go
    through the CJK path or from an extractor artefact, and neither is worth
    refusing a document over. The count is the signal — one is noise, twenty is a
    renderer that regressed.
    """
    lead: list[str] = []
    alone: list[str] = []
    trail: list[str] = []
    for index, text in enumerate(page_texts, start=1):
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or BULLET_LINE.match(stripped):
                continue
            if LONE_PUNCT_LINE.fullmatch(stripped):
                alone.append(f"page {index}: 「{stripped}」")
            elif cjk.LEADING_PUNCT.match(stripped):
                lead.append(f"page {index}: 「{stripped[:20]}…」")
            if cjk.TRAILING_OPEN.search(stripped):
                trail.append(f"page {index}: 「…{stripped[-20:]}」")
    for found, what in ((alone, "hold nothing but punctuation"),
                        (lead, "open with punctuation that cannot start a line"),
                        (trail, "end on an opening bracket whose content is on the "
                                "next line")):
        if found:
            report.warnings.append(
                f"{len(found)} line(s) {what}: "
                + "; ".join(found[:5]) + ("; …" if len(found) > 5 else "")
                + " — Chinese 避头尾 is handled by fin_report.cjk, so this points at "
                "a style bypassing the CJK path rather than at the prose"
            )


def _check_handtyped_tags(report: Report, page_texts: list[str]) -> None:
    """A tag-shaped bracket group that never went through ``chip()``.

    ``theme.chip()`` accepts five tags and refuses everything else, so an inflected
    or invented one cannot be *emitted* — it can only be typed, and then it prints
    at body size in body colour, carries no colour coding, and is invisible to
    every other check here because ``TAG`` matches the five literals in half-width
    brackets and nothing else.

    Both shapes observed in one 12-page 业绩点评, and both were the same author
    reaching past the helper: ``［媒体转述］`` and ``［公开计算］`` — full-width
    brackets, names that are not tags, sitting in the middle of a sentence where a
    chip belongs. A legal tag in full-width brackets is the third shape and is
    equally not a chip.
    """
    offenders: dict[str, int] = {}
    for index, page in enumerate(page_texts, start=1):
        for hit in TAG_SHAPED.finditer(_without_legend(page)):
            body = hit.group(1)
            if body in theme.CHIP and hit.group(0)[0] == "[":
                continue  # a real chip, rendered by chip()
            offenders.setdefault(f"page {index}: {hit.group(0)}", 0)
            offenders[f"page {index}: {hit.group(0)}"] += 1
    if offenders:
        report.failures.append(
            f"{len(offenders)} hand-typed tag(s) bypass rep.chip(): "
            + "; ".join(list(offenders)[:6]) + ("; …" if len(offenders) > 6 else "")
            + ". Only 披露/测算/预期/推断/媒体 in half-width brackets are provenance "
            "tags, and only rep.chip()/rep.tagged() render them — a typed one prints "
            "at body size in body colour, is missing from the legend, and reads to "
            "every downstream check as untagged prose. An inflected name (媒体转述, "
            "公开计算, 已披露) is not a tag at all: pick the class it actually is"
        )


def _check_source_naming(report: Report, page_texts: list[str]) -> None:
    """The two source-naming rules that only the built file can settle.

    Both live in the citation policy and neither was reaching the model: the
    interface-name ban shipped in ``xlsx-author`` (workbooks) and in the agent
    guardrail, and this harness mounts skills but not agents — so every PDF-only
    task wrote server and tool names into its Sources section while the workbook
    tasks that loaded ``xlsx-author`` got it right. A rule with no check is a
    preference.
    """
    text = "\n".join(page_texts)
    unlinked = ANY_URL.sub(" ", text)
    interfaces = sorted({m.group(0) for m in INTERFACE_NAME.finditer(unlinked)})
    if interfaces:
        report.failures.append(
            f"{len(interfaces)} interface name(s) appear in the deliverable: "
            + ", ".join(interfaces[:8]) + ("…" if len(interfaces) > 8 else "")
            + ". Name the data provider and which fields — 〔一手〕万得 · 基金产品档案"
            "（成立日期/投资类型/业绩比较基准） — never the MCP server or tool that "
            "happened to serve it: the reader cannot check it and it expires when "
            "the wiring changes. Keep the field names; they carry the 口径"
        )

    bare = sorted({m.group(0) for m in BARE_DOMAIN_URL.finditer(text)})
    if bare:
        report.failures.append(
            f"{len(bare)} source URL(s) point at a bare domain: " + ", ".join(bare[:6])
            + ("…" if len(bare) > 6 else "")
            + ". The URL field has two honest forms — the specific page that was "
            "accessed, or **no URL at all** when a vendor interface served the data "
            "and no public page exists. In the second case name the institution and "
            "what was taken and stop there; a front page locates nothing"
        )


def verify(pdf: str | Path, render_dir: str | Path | None = None,
           expect_cjk: bool = True, geometry_only: bool = False) -> Report:
    path = Path(pdf)
    if path.suffix.lower() == ".docx":
        return verify_docx(path, render_dir, expect_cjk=expect_cjk)

    from pypdf import PdfReader

    report = Report(path=str(path))
    if not path.is_file():
        report.failures.append(f"{path} does not exist")
        return report

    reader = PdfReader(str(path))
    report.pages = len(reader.pages)
    page_texts = [(page.extract_text() or "") for page in reader.pages]
    report.page_chars = [len(t.strip()) for t in page_texts]

    # 字体里没有的字形会以 .notdef 落进 PDF，页面上是一个 ⊠ 方框，而提取文本时
    # 是 U+0000。**它不会让渲染报错**，所以只能在这里查。
    # 实测：`severity.md` 用 🔴🟡⚪ 表示分级，中文字体不含 emoji，于是整份信用
    # 报告的「分级发现」每一条都以 ⊠ 开头 —— 交付物已经发出去了才被看出来。
    for i, text in enumerate(page_texts, start=1):
        n = text.count("\x00")
        if n:
            report.failures.append(
                f"page {i}: {n} 个字形缺失（.notdef，页面上显示为 ⊠）——"
                f"正文用了嵌入字体没有的字符，最常见的是 emoji。"
                f"改用字体覆盖的符号，或只保留文字标签")
    text = "\n".join(page_texts)
    report.cjk_chars = len(CJK.findall(text))
    report.markers = len(set(re.findall(r"\[(\d{1,3})\]", text)))
    report.links_internal, report.links_external = _links(reader)
    report.embedded_fonts, report.unembedded_fonts = _fonts(reader)
    report.ink, report.foot_gaps, report.rendered = _ink(
        path, Path(render_dir) if render_dir else None)

    if report.pages == 0:
        report.failures.append("the PDF has no pages")
    if expect_cjk and report.cjk_chars == 0:
        report.failures.append(
            "no CJK characters in the text layer, but a Chinese deliverable was expected"
        )

    # ``geometry_only`` is the DOCX path measuring layout on a LibreOffice
    # conversion. Everything skipped below has already been checked on the .docx
    # itself, where the answer is authoritative: the citation vehicle is a
    # bookmark rather than a /Link annotation, the font is named rather than
    # embedded, and re-reporting the converter's version of either would blame
    # the deliverable for LibreOffice's choices.
    if not geometry_only:
        if report.unembedded_fonts:
            report.failures.append(
                "fonts are referenced but not embedded: "
                + ", ".join(report.unembedded_fonts)
                + " — CJK text will render blank in viewers without the matching font packs"
            )
        if report.markers and report.links_internal == 0:
            report.failures.append(
                f"{report.markers} [n] marker(s) in the text but no internal link "
                "annotations — the markers are plain text, not clickable citations"
            )
        if report.links_internal and report.markers == 0:
            report.warnings.append(
                "internal links exist but no [n] markers were extracted")

        _check_provenance_tags(report, page_texts)
        _check_tag_coverage(report, page_texts)
        _check_handtyped_tags(report, page_texts)
        _check_source_naming(report, page_texts)
        _check_page_furniture(report, page_texts)
        _check_broken_brackets(report, page_texts)
        _check_line_breaking(report, page_texts)

    for index, share in enumerate(report.ink, start=1):
        chars = report.page_chars[index - 1] if index <= len(report.page_chars) else 0
        if share <= BLANK_CEILING:
            # Two different defects reach this threshold, and they need different
            # fixes, so they get different messages. The old check tested the
            # *document's* text layer, so it reported both as a font failure and
            # sent anyone debugging a stray blank page after the wrong cause.
            if chars:
                report.failures.append(
                    f"page {index} carries {chars} character(s) of text but renders "
                    f"essentially blank ({share:.4%} ink) — the classic "
                    "embedded-font failure"
                )
            else:
                report.failures.append(
                    f"page {index} is genuinely empty ({share:.4%} ink, no text) — a "
                    "stray page break, or an exhibit that rendered nothing"
                )
        elif share < INK_FLOOR:
            report.warnings.append(
                f"page {index} is nearly empty ({share:.2%} ink) — check for a "
                "stranded caption or an over-eager page break"
            )

    # Foot gaps. Ink share is blind to these: a page missing its bottom 40% still
    # renders ~9% ink. This is the only automated signal for the defect, and the
    # only one available at all when the visual gate cannot run.
    column = theme.PAGE_H - theme.MARGIN_T - theme.MARGIN_B
    flagged = 0
    for index, gap in enumerate(report.foot_gaps, start=1):
        if gap is None:
            continue
        if index == report.pages and index != 1:
            # A last page that ends early is almost never a defect: a document
            # stops where its content stops, and prose cannot be reflowed to end
            # tidily. The one case that *is* a defect is a **reflowable list**
            # spilling a remainder onto a page of its own — the 来源 section is
            # uniform, atomic entries whose leading the builder controls, so a
            # near-blank continuation page means a page was spent that tightening
            # the list would have saved. Observed 2026-08-19: 33 entries filled
            # pages 10–11 and left the 33rd alone on page 12, 87% blank, at 2.1%
            # ink — above INK_FLOOR, and the last page was then exempt from the
            # foot-gap floor unconditionally, so every automated gate passed it.
            #
            # Hence both conditions: the section exists, and its heading is on an
            # *earlier* page. A report with three sources legitimately has a sparse
            # 来源 page — but its heading is on that page, the break above it is
            # mandated by the house style, and there is nothing to reflow.
            spill = _last_page_continues_list(page_texts)
            if (spill and gap >= FINAL_PAGE_STUB_SHARE * column
                    and report.pages > 1):


                report.warnings.append(
                    f"the last page (page {index}) carries only the tail of the "
                    f"{HARD_BREAK_HEADINGS[0]} list and leaves {gap / mm:.0f}mm of "
                    f"column unused ({gap / column:.0%}) — a page spent on a "
                    "remainder that a tighter list would have absorbed. The entries "
                    "are uniform and reflowable, so close it by setting the list "
                    "tighter (report-render measures this per document), not by "
                    "moving anything. Otherwise record it as a "
                    f"{LAYOUT_LINE} disposition in {LAYOUT_REVIEW_FILE}"
                )
                flagged += 1
            continue
        if gap < FOOT_GAP_FLOOR:
            continue
        if index == 1:
            continue  # the cover ends early by design
        following = page_texts[index] if index < len(page_texts) else ""
        # Whole-line match, and only near the top of the page. `startswith` on the
        # page text cannot work: the running header, footer disclaimer and page
        # number are drawn on the canvas, so they occupy the first four extracted
        # lines of every page. Matching 来源 anywhere would instead exempt most of
        # the document, since every exhibit's note line carries 资料来源.
        if any(line.strip() in HARD_BREAK_HEADINGS
               for line in following.splitlines()[:12]):
            continue  # the next section owns its page, so this one ends early by design
        flagged += 1
        severity = "ends well short" if gap >= FOOT_GAP_SERIOUS else "ends early"
        report.warnings.append(
            f"page {index} {severity}: {gap / mm:.0f}mm of column unused "
            f"({gap / column:.0%}) — a block too tall for the space left was pushed "
            "to the next page, or a page break was forced here. Close it by shrinking the "
            "block or by letting following prose fill the page — **never by moving "
            "an exhibit ahead of the text that first references it** (later than the "
            "callout is normal typesetting; earlier is a defect). Otherwise accept "
            f"the gap on a {LAYOUT_LINE} line in {LAYOUT_REVIEW_FILE} — the build "
            "record, not the deliverable"
        )

    # "Accept it or fix it" needs somewhere to land, or the two are
    # indistinguishable from having looked at neither. A run that read 291 rendered
    # pages still shipped 17 flagged ones, and nothing said whether those gaps were
    # judged. So the disposition is itself checkable — but it lands in the build
    # record, not on the last page of the report: it is QA about how the file was
    # made, and the reader of the analysis is not its audience.
    if flagged and not _layout_review_recorded(path, render_dir, text):
        report.warnings.append(
            f"{flagged} page(s) end early and no `{LAYOUT_LINE}` disposition was "
            f"recorded — write one to {LAYOUT_REVIEW_FILE} beside the rendered "
            "pages, naming each flagged page, its millimetres, and whether it was "
            "accepted or fixed. A gap that was judged acceptable and a gap nobody "
            "looked at read identically (coverage.md). Do not put this in the "
            "deliverable — it is build QA, not analysis"
        )

    if not report.ink:
        report.warnings.append(
            "page rendering unavailable (pypdfium2 not installed), so the blank-page, "
            "nearly-empty-page and foot-gap checks did not run"
        )

    # Build QA must not reach the reader. A failure rather than a warning: unlike
    # a foot gap there is no version of this that is the right call, and it is the
    # one defect whose whole nature is that it looks deliberate — it sits in the
    # cover meta block or under the coverage table, in the document's own voice.
    leaked = sorted({term for term in QA_VOCABULARY if term in text}) if not geometry_only else []
    if leaked:
        report.failures.append(
            f"the deliverable contains build-QA wording {leaked} — this describes "
            f"how the file was made, not what was analysed. Move it to "
            f"{LAYOUT_REVIEW_FILE} beside the rendered pages. (Legal and scope "
            "statements such as 分析师底稿 / 不构成投资建议 / 数据截至 are not QA "
            "and belong exactly where they are.)"
        )
    return report


# --------------------------------------------------------------------------
# docx
# --------------------------------------------------------------------------
#: WordprocessingML and the relationship namespaces, for ElementTree lookups.
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

STATUS_OK = "ok"
#: Word paginates, so a DOCX's layout cannot be measured here without a paginating
#: engine. This status says the layout gate did not run — reported as exit 3 rather
#: than folded into "pass", for the reason ``xlsx-author``'s ``recalc.py`` has the
#: same code: an ``&&`` chain otherwise treats "not checked" and "checked, clean"
#: identically, and an earlier version of that script returned 0 for every outcome
#: while a workbook full of ``#REF!`` passed silently.
STATUS_NO_PAGINATION = "pagination_unavailable"
EXIT_NO_PAGINATION = 3
#: Optional: point this at ISO-29500's ``wml.xsd`` and every generated part is
#: schema-validated. Off by default because the schema is not redistributed with
#: this package — but it is the closest available proxy for "Word will open it",
#: and it caught a real defect on the first document this backend built (a
#: ``w:pageBreakBefore`` inserted ahead of ``w:pStyle``, which Word reports as
#: unreadable content).
SCHEMA_ENV = "FIN_REPORT_WML_XSD"
#: Severity icons. The severity policy allows them in Markdown and terminal output
#: only: a PDF turns them into ``.notdef`` boxes, which this module catches on that
#: path, and a DOCX renders them faithfully — so here the same rule needs its own
#: check or it does not exist.
SEVERITY_ICONS = ("🔴", "🟡", "⚪", "🚩")


def _docx_parts(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as zf:
        return {name: zf.read(name) for name in zf.namelist()}


def _docx_blocks(document: ElementTree.Element) -> list[str]:
    """Body text as page-break-delimited blocks, one line per paragraph or cell.

    Not pages — nothing here knows where Word will break. The blocks are the
    boundaries this package *does* control (the break after the cover and the one
    before the Sources section), which is what the shared text checks need in order
    to find where the Sources section starts and whether the legend leads the body.
    ``_docx_relabel`` then renames "page N" to "block N" in whatever they report, so
    the output never claims a page number it cannot know.
    """
    blocks: list[list[str]] = [[]]
    body = document.find(f"{_W}body")
    for para in (body.iter(f"{_W}p") if body is not None else []):
        props = para.find(f"{_W}pPr")
        if props is not None and props.find(f"{_W}pageBreakBefore") is not None:
            blocks.append([])
        pieces: list[str] = []
        for node in para.iter():
            if node.tag == f"{_W}t":
                pieces.append(node.text or "")
            elif node.tag in (f"{_W}br", f"{_W}tab"):
                pieces.append(" ")
        line = "".join(pieces).strip()
        if line:
            blocks[-1].append(line)
    return ["\n".join(lines) for lines in blocks if lines]


def _docx_relabel(report: Report, first_failure: int, first_warning: int) -> None:
    """Rewrite "page N" to "block N" in the findings the shared checks just added.

    They phrase locations as pages, which is true on the PDF path and would be a
    fabrication here.
    """
    for bucket, start in ((report.failures, first_failure),
                          (report.warnings, first_warning)):
        for index in range(start, len(bucket)):
            bucket[index] = re.sub(r"\bpage\(s\) ", "block(s) ", bucket[index])
            bucket[index] = re.sub(r"\bpage (\d+)", r"block \1", bucket[index])


def _docx_check_citations(report: Report, parts: dict[str, bytes],
                          document: ElementTree.Element, text: str) -> None:
    """``[n]`` must be a link whose anchor resolves, and every URL must leave.

    The DOCX half of the citation policy's clickability requirement. The PDF path
    proves it by counting ``/Link`` annotations; here the evidence is a
    ``w:hyperlink`` carrying ``w:anchor`` plus a ``w:bookmarkStart`` of that name on
    the Sources entry. Both halves are checked because either alone passes a broken
    document: markers with no anchors are plain text, and an anchor with no bookmark
    is a click that goes nowhere.
    """
    anchor_names = {h.get(f"{_W}anchor") for h in document.iter(f"{_W}hyperlink")}
    anchor_names = {name for name in anchor_names if name}
    bookmarks = {b.get(f"{_W}name") for b in document.iter(f"{_W}bookmarkStart")}
    report.markers = len(set(re.findall(r"\[(\d{1,3})\]", text)))
    report.links_internal = len(anchor_names)

    rels_xml = parts.get("word/_rels/document.xml.rels", b"")
    external: dict[str, tuple[str, str | None]] = {}
    if rels_xml:
        for rel in ElementTree.fromstring(rels_xml):
            if rel.get("Type", "").endswith("/hyperlink"):
                external[rel.get("Id")] = (rel.get("Target", ""), rel.get("TargetMode"))
    report.links_external = len(external)

    if report.markers and not anchor_names:
        report.failures.append(
            f"{report.markers} [n] marker(s) in the text but no w:hyperlink carries "
            "an anchor — the markers are plain text, not clickable citations. Mint "
            "them with rep.refs.cite(), which returns the marker and registers the "
            "entry in one call"
        )
    dangling = sorted(anchor_names - {b for b in bookmarks if b})
    if dangling:
        report.failures.append(
            f"{len(dangling)} citation anchor(s) resolve to no bookmark: "
            + ", ".join(dangling[:6])
            + " — the [n] is a link the reader can click and it lands nowhere. The "
            "Sources section carries the bookmarks, so this is what a document that "
            "skipped rep.sources() looks like"
        )
    unmarked = sorted(rid for rid, (_, mode) in external.items() if mode != "External")
    if unmarked:
        report.failures.append(
            f"{len(unmarked)} hyperlink relationship(s) lack "
            'TargetMode="External" — Word reports the package as corrupt rather '
            "than opening it"
        )
    for rid in sorted({h.get(f"{_R}id") for h in document.iter(f"{_W}hyperlink")}
                      - {None}):
        if rid not in external:
            report.failures.append(
                f"hyperlink {rid} has no relationship in "
                "word/_rels/document.xml.rels — a dangling r:id is unreadable content"
            )
    _docx_check_marker_links(report, document)

    bare = sorted({url for url, _ in external.values()
                   if BARE_DOMAIN.match(url.strip())})
    if bare:
        report.failures.append(
            f"{len(bare)} source URL(s) point at a bare domain: " + ", ".join(bare[:6])
            + " — the URL field has two honest forms, the specific page that was "
            "accessed or no URL at all. A front page locates nothing"
        )


def _docx_check_chip_rendering(report: Report, document: ElementTree.Element) -> None:
    """A provenance chip is coloured text. Not a highlight, not a shaded box.

    Observed 2026-08-27 in a deliverable built without this skill: every tag was a
    run carrying ``<w:color w:val="FFFFFF"/>`` over
    ``<w:shd w:fill="E7F3EC"/>`` — white text on a near-white green fill, i.e. a
    tag the reader cannot read at all. The provenance policy fixes each tag's
    colour precisely so that the five classes are distinguishable; painting the
    background instead throws that away twice over, because the fill is not one of
    the policy's colours and the foreground stops being one either.

    ``chip()`` and ``tagged()`` cannot produce this. A run that does is hand-rolled,
    which is the defect this reports — the chip is unreadable *and* invisible to the
    colour convention every other check reads.
    """
    offenders: list[str] = []
    for run in document.iter(f"{_W}r"):
        text = "".join(node.text or "" for node in run.iter(f"{_W}t")).strip()
        if not text or not rules.CELL_TAG.search(f"[{text.strip('[]【】 ')}]"):
            continue
        props = run.find(f"{_W}rPr")
        if props is None:
            continue
        shaded = props.find(f"{_W}shd")
        highlighted = props.find(f"{_W}highlight")
        if shaded is not None or highlighted is not None:
            fill = (shaded.get(f"{_W}fill") if shaded is not None
                    else highlighted.get(f"{_W}val"))
            colour = props.find(f"{_W}color")
            offenders.append(
                f"{text} (文字 {colour.get(f'{_W}val') if colour is not None else '默认'} "
                f"/ 底色 {fill})")
    if offenders:
        report.failures.append(
            f"{len(offenders)} provenance tag(s) are rendered with a background "
            "fill or highlight instead of coloured text: " + "; ".join(offenders[:6])
            + ". A chip is a coloured superscript — rep.chip()/rep.tagged() own the "
            "colour, which the provenance policy fixes per class so the five are "
            "distinguishable. A fill replaces that with a colour the policy does not "
            "define, and pairing it with white text (observed) makes the tag "
            "unreadable on the page"
        )


#: ``w:sz`` / ``w:szCs`` are half-point counts. A fractional value is what a point
#: size that is not a multiple of 0.5 produces when doubled naively (8.8pt → 17.6),
#: and the type's XSD union accepts it while Word writes only integers.
_FRACTIONAL_SZ = re.compile(r'<w:(?:sz|szCs) w:val="(\d*\.\d+)"')


def _docx_check_measures(report: Report, parts: dict[str, bytes]) -> None:
    """Type sizes are whole half-points, everywhere.

    This backend's own ramp holds real point sizes — 8.8pt for a Sources entry, 7.6pt
    for a note, 8.3pt in a table — so doubling them emits ``w:sz w:val="17.6"``. The
    schema lets it pass (``ST_UnsignedDecimalNumber`` is ``xsd:decimal``), which is
    why schema validation was clean on two shipped documents carrying 514 and 534 of
    them. Word writes integers only, and a reader that rejects the attribute repairs
    the document — and a repaired document is where bookmarks and shading go.
    """
    offenders: dict[str, list[str]] = {}
    for name, blob in sorted(parts.items()):
        if not name.startswith("word/") or not name.endswith(".xml"):
            continue
        found = sorted(set(_FRACTIONAL_SZ.findall(blob.decode("utf-8", "ignore"))))
        if found:
            offenders[name] = found
    if offenders:
        total = sum(len(v) for v in offenders.values())
        report.failures.append(
            f"{total} fractional half-point type size(s) across "
            f"{len(offenders)} part(s): "
            + "; ".join(f"{n.split('/')[-1]} {v[:4]}" for n, v in list(offenders.items())[:3])
            + " — w:sz counts half-points and Word writes integers. Emit runs through "
            "fin_report.ooxml.run_props, which rounds; a reader that refuses the "
            "value repairs the file, and repair is where bookmarks and shading go"
        )


def _docx_check_bookmark_structure(report: Report, document: ElementTree.Element) -> None:
    """Bookmarks must be well-formed, or Word silently drops the jump.

    Two shapes seen in one batch of hand-built deliverables, both of which make a
    ``[n]`` that *looks* like a link do nothing when clicked:

    * ``w:bookmarkStart`` emitted **before** ``w:pPr``. ``w:pPr`` must be the first
      child of ``w:p``; anything ahead of it puts the paragraph out of schema, and
      Word's repair pass is where the bookmark goes.
    * duplicate ``w:id`` across ``bookmarkStart`` elements — the id, not the name,
      is what pairs a start with its end, so a repeat makes the pairing ambiguous
      and the later bookmark is discarded.

    Neither is reachable through ``ooxml.bookmark`` + ``ooxml.paragraph``; both are
    reachable by hand, and the symptom the reader reports is "the citation is not
    clickable".
    """
    early: list[str] = []
    for para in document.iter(f"{_W}p"):
        children = list(para)
        for index, child in enumerate(children):
            if child.tag == f"{_W}pPr" and index > 0:
                if any(c.tag == f"{_W}bookmarkStart" for c in children[:index]):
                    name = next(c.get(f"{_W}name") for c in children[:index]
                                if c.tag == f"{_W}bookmarkStart")
                    early.append(name or "?")
                break
    ids = [b.get(f"{_W}id") for b in document.iter(f"{_W}bookmarkStart")]
    duplicated = sorted({i for i in ids if i and ids.count(i) > 1})
    if early:
        report.failures.append(
            f"{len(early)} bookmark(s) are emitted before w:pPr: "
            + ", ".join(early[:6])
            + " — w:pPr must be the first child of w:p, so the paragraph is out of "
            "schema and Word drops the bookmark during repair. The [n] pointing at "
            "it then looks like a link and does nothing"
        )
    if duplicated:
        report.failures.append(
            f"{len(duplicated)} bookmark id(s) are reused: {', '.join(duplicated[:6])}"
            " — the id pairs a bookmarkStart with its bookmarkEnd, so a repeat makes "
            "the pairing ambiguous and the later bookmark is discarded. Ids come from "
            "one document-wide counter (ooxml.Package.ident)"
        )


def _docx_check_cover(report: Report, document: ElementTree.Element,
                      blocks: list[str]) -> None:
    """A research deliverable has a cover unless its own skill says otherwise.

    Reported as a warning, not a failure, because the exemption is real: a
    一页晨会纪要 opens on its first sentence, and the skill that owns it declares
    that. What is not intended is a report arriving with no title page because
    nobody called ``cover()`` — observed in a hand-built batch, where the first page
    opened straight into 核心观点 and the title reached the reader nowhere at all,
    since a DOCX has no cover-band furniture to fall back on.
    """
    has_title_page = any(True for _ in document.iter(f"{_W}titlePg"))
    has_cover_section = any(
        s.find(f"{_W}pgMar") is not None
        and s.find(f"{_W}pgMar").get(f"{_W}left") == "0"
        for s in document.iter(f"{_W}sectPr"))
    if has_title_page or has_cover_section:
        return
    report.warnings.append(
        "no cover page: no zero-margin cover section and no w:titlePg, so there is no "
        "title block and no distinct first page. A research deliverable has a cover — "
        "rep.cover() "
        "builds it and also gives the legend its second legal placement. The one "
        "exemption belongs to a skill that declares it (write-research's "
        "morning-note); if this is that case, ignore this line"
    )


#: A Sources entry opens with its own number as a label — ``<b>[1]</b>`` — which is
#: a bare ``[n]`` by design: the entry is the destination, not a link to itself.
_ENTRY_LABEL = re.compile(r"^\s*\[\d{1,3}\]")
#: A note line stating a 口径 in prose instead of tagging it.
_PROSE_BASIS = re.compile(r"本报告(?:测算|整理|计算)|我们(?:测算|计算)|为测算|经测算|系测算")


def _docx_check_marker_links(report: Report, document: ElementTree.Element) -> None:
    """**Every** ``[n]`` is inside a ``w:hyperlink``, not just some of them.

    The document-wide check above ("markers exist but no anchor does") passes a file
    that links most of its markers and leaves the rest as dead text, and that is not
    a hypothetical: in one hand-built deliverable 24 body paragraphs carried linked
    markers while **all ten figure-and-table note lines** carried plain ones, plus 18
    body paragraphs that were also plain. The reader's experience is that citations
    work in the prose and stop working under every exhibit — which is exactly where a
    figure's only provenance lives, because a chart's numbers are inside the PNG.

    Sources entries are exempt: an entry opens with its own ``[n]`` as a label, and
    a destination does not link to itself.
    """
    plain: list[str] = []
    for para in document.iter(f"{_W}p"):
        if any(True for _ in para.iter(f"{_W}bookmarkStart")):
            continue  # a Sources entry
        whole = "".join(node.text or "" for node in para.iter(f"{_W}t"))
        if not whole.strip() or _ENTRY_LABEL.match(whole):
            continue
        linked = "".join(node.text or ""
                         for link in para.iter(f"{_W}hyperlink")
                         for node in link.iter(f"{_W}t"))
        loose = len(re.findall(r"\[\d{1,3}\]", whole)) - \
            len(re.findall(r"\[\d{1,3}\]", linked))
        if loose > 0:
            plain.append(f"{whole.strip()[:38]}… ×{loose}")
    if plain:
        report.failures.append(
            f"{len(plain)} paragraph(s) carry a [n] marker that is not inside a "
            "w:hyperlink, so those citations are dead text while the rest of the "
            "document's are live: " + "; ".join(plain[:6])
            + ("; …" if len(plain) > 6 else "")
            + ". Note lines under figures and tables are the usual casualty, and the "
            "worst one: a chart's numbers are inside the PNG, so the note is the only "
            "place its provenance exists. Every marker comes from rep.refs.cite(), "
            "which returns a linked marker — a typed [n] is the defect"
        )


def _docx_check_note_prose(report: Report, blocks: list[str]) -> None:
    """A note that states its 口径 in prose where a chip belongs.

    ``provenance.md`` legislates this for table cells — "not a note under the table
    explaining the 口径 in prose. A reader cannot map a sentence onto cells; that is
    what a chip is for." A chart is the case the policy does not spell out, because
    its numbers are inside the image and there is no cell to chip; the note is the
    only surface. Observed: ten figure notes reading 「…；比率均为本报告测算。」 with
    no `[测算]` anywhere, so the reader cannot tell a computed series from a
    disclosed one.

    Reported as a warning, not a failure: the policy has taken a position on cells
    and not on charts, and this module does not get to harden a rule the policy has
    not stated. What it can do is say the ambiguity is there.
    """
    offenders: list[str] = []
    for block in blocks:
        for line in block.split("\n"):
            stripped = line.strip()
            if not stripped.startswith(("资料来源", "注：", "Source", "Note")):
                continue
            if _PROSE_BASIS.search(stripped) and not rules.CELL_TAG.search(stripped):
                offenders.append(stripped[:44])
    if offenders:
        report.warnings.append(
            f"{len(offenders)} exhibit note(s) state the 口径 in prose but carry no "
            "provenance tag: " + "; ".join(offenders[:5])
            + ("; …" if len(offenders) > 5 else "")
            + ". 「为本报告测算」 in a sentence is the thing a chip replaces — for a "
            "chart the note is the only place the class can live, since the numbers "
            "are inside the image. Add rep.chip('测算') to the note beside the figure "
            "it describes"
        )


def _docx_check_fonts(report: Report, document: ElementTree.Element) -> None:
    """Every run holding Chinese must name an East Asian font.

    The counterpart of the PDF embedding check, and the same class of silent defect
    one step milder: Word resolves Chinese through ``w:eastAsia`` and, with nothing
    there, substitutes the theme's East Asian font. Nothing errors and the text is
    legible, so the only symptom is a deliverable set in a face nobody chose —
    which is exactly the kind of failure that ships.
    """
    offenders = 0
    example = ""
    for run in document.iter(f"{_W}r"):
        text = "".join(node.text or "" for node in run.iter(f"{_W}t"))
        if not CJK.search(text):
            continue
        props = run.find(f"{_W}rPr")
        rfonts = props.find(f"{_W}rFonts") if props is not None else None
        if rfonts is None or not rfonts.get(f"{_W}eastAsia"):
            offenders += 1
            example = example or text[:24]
    if offenders:
        report.failures.append(
            f"{offenders} run(s) hold Chinese with no w:eastAsia font set "
            f"(first: 「{example}」) — Word substitutes its theme font for all of "
            "them. Emit runs through fin_report.ooxml.run_props, which always sets "
            "ascii, hAnsi and eastAsia together"
        )
    report.embedded_fonts = sorted({
        rfonts.get(f"{_W}eastAsia")
        for rfonts in document.iter(f"{_W}rFonts")
        if rfonts.get(f"{_W}eastAsia")
    })


def _docx_check_furniture(report: Report, parts: dict[str, bytes],
                          document: ElementTree.Element) -> None:
    """Running header, footer, and a real page-number field.

    A DOCX keeps its furniture in separate parts, so the PDF path's evidence — the
    page label in the extracted text — does not exist here. What is checkable is
    stronger: whether the section references a header and a footer at all, and
    whether the page number is a ``PAGE`` field rather than a typed digit that
    never increments.
    """
    sect = None
    for node in document.iter(f"{_W}sectPr"):
        sect = node
    if sect is None:
        report.failures.append(
            "the body has no w:sectPr — page size, margins and the running "
            "furniture are all unset, so the document takes the reader's defaults"
        )
        return
    headers = [ref.get(f"{_W}type") for ref in sect.iter(f"{_W}headerReference")]
    footers = [ref.get(f"{_W}type") for ref in sect.iter(f"{_W}footerReference")]
    if "default" not in headers:
        report.failures.append(
            "no default header is referenced — body pages lose the running title")
    if "default" not in footers:
        report.failures.append(
            "no default footer is referenced — body pages carry no page number and "
            "no footer note")
    if sect.find(f"{_W}titlePg") is not None and "first" not in footers:
        report.failures.append(
            "w:titlePg asks for a distinct first page but no first-page footer is "
            "referenced, so the cover inherits the default one and prints a page "
            "number under the title block")
    # A cover section is the other legal shape, and the one this backend writes: its
    # own sectPr with zero margins and no furniture at all. Then the body's section
    # carries the header and footer, and nothing has to be suppressed on page 1.
    covers = [s for s in document.iter(f"{_W}sectPr")
              if (s.find(f"{_W}pgMar") is not None
                  and s.find(f"{_W}pgMar").get(f"{_W}left") == "0")]
    for cover in covers:
        if any(True for _ in cover.iter(f"{_W}headerReference")):
            report.failures.append(
                "the cover section references a header — a full-bleed cover has no "
                "running furniture, and a header inside a zero-margin section is "
                "drawn at the paper edge")
    footer_xml = " ".join(
        blob.decode("utf-8", "ignore")
        for name, blob in parts.items() if name.startswith("word/footer")
    )
    if "PAGE" not in footer_xml:
        report.failures.append(
            "no PAGE field in any footer part — a typed page number does not "
            "increment, and a 12-page draft then reads 第 1 页 on every page")


def _docx_check_schema(report: Report, parts: dict[str, bytes]) -> None:
    """Validate every WordprocessingML part, when a schema is configured.

    Off unless ``FIN_REPORT_WML_XSD`` names ISO-29500's ``wml.xsd`` and lxml is
    importable, because neither ships with this package. When it does run it is the
    only check here that speaks to "will Word open this at all" rather than "is the
    content right", which is why it is worth wiring on any machine that has the
    schema to hand.
    """
    import os

    schema_path = os.environ.get(SCHEMA_ENV)
    if not schema_path:
        return
    try:
        from lxml import etree
    except ImportError:
        report.warnings.append(
            f"{SCHEMA_ENV} is set but lxml is not installed, so no part was "
            "schema-validated")
        return
    if not Path(schema_path).is_file():
        report.warnings.append(f"{SCHEMA_ENV}={schema_path} is not a file")
        return
    schema = etree.XMLSchema(etree.parse(schema_path))
    for name, blob in sorted(parts.items()):
        if not name.startswith("word/") or not name.endswith(".xml"):
            continue
        if schema.validate(etree.fromstring(blob)):
            continue
        # Drop the markup-compatibility noise. Every part Word itself writes carries
        # `mc:Ignorable`, which the strict schema rejects while Word obviously
        # accepts — reporting it buries the real defects under one line per part,
        # and a check whose output is mostly noise gets switched off. What is left
        # is element ordering, which is the class Word actually refuses.
        real = [error.message for error in schema.error_log
                if "markup-compatibility" not in error.message]
        if not real:
            continue
        report.failures.append(
            f"{name} is not valid WordprocessingML: {real[0][:220]} — Word reports "
            "this class of defect as 「无法读取的内容」 and repairs or refuses "
            "the file"
        )


def _soffice() -> str | None:
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found
    return None


def _docx_to_pdf(soffice: str, docx: Path, outdir: Path, timeout: float) -> Path:
    """Convert with headless LibreOffice into ``outdir`` and return the PDF.

    A private user profile per run, as ``xlsx-author``'s ``recalc.py`` does: on a
    shared profile two concurrent conversions fight over a lock file and one of
    them silently produces nothing.
    """
    profile = outdir / "profile"
    (profile / "user").mkdir(parents=True, exist_ok=True)
    cmd = [
        soffice, f"-env:UserInstallation=file://{profile}",
        "--headless", "--norestore", "--convert-to", "pdf",
        "--outdir", str(outdir), str(docx),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    converted = outdir / (docx.stem + ".pdf")
    if proc.returncode != 0 or not converted.is_file():
        raise RuntimeError(
            f"LibreOffice conversion failed (rc={proc.returncode}): "
            f"{(proc.stderr or proc.stdout).strip()[:400]}"
        )
    return converted


def verify_docx(path: str | Path, render_dir: str | Path | None = None,
                expect_cjk: bool = True, timeout: float = 120.0) -> Report:
    """Structural checks on the package, then layout on a conversion if one is possible."""
    path = Path(path)
    report = Report(path=str(path), format="docx")
    if not path.is_file():
        report.failures.append(f"{path} does not exist")
        return report
    try:
        parts = _docx_parts(path)
    except zipfile.BadZipFile:
        report.failures.append(
            f"{path} is not a readable .docx (a docx is a ZIP of XML parts)")
        return report
    if "word/document.xml" not in parts:
        report.failures.append("the package has no word/document.xml")
        return report

    document = ElementTree.fromstring(parts["word/document.xml"])
    blocks = _docx_blocks(document)
    text = "\n".join(blocks)
    report.page_chars = [len(b.strip()) for b in blocks]
    report.cjk_chars = len(CJK.findall(text))

    if expect_cjk and report.cjk_chars == 0:
        report.failures.append(
            "no CJK characters in the document, but a Chinese deliverable was expected")

    _docx_check_citations(report, parts, document, text)
    _docx_check_measures(report, parts)
    _docx_check_bookmark_structure(report, document)
    _docx_check_chip_rendering(report, document)
    _docx_check_cover(report, document, blocks)
    _docx_check_fonts(report, document)
    _docx_check_furniture(report, parts, document)
    _docx_check_blank_pages(report, document)
    _docx_check_tables(report, document)
    _docx_check_figure_line_rule(report, document)
    _docx_check_schema(report, parts)

    # The text-layer checks are about the document, not the medium, so they are the
    # PDF path's own — one implementation, both formats. Only their location
    # vocabulary is rewritten, because "page" is a thing this path cannot know.
    failures, warnings = len(report.failures), len(report.warnings)
    _check_provenance_tags(report, blocks)
    _check_tag_coverage(report, blocks)
    _check_handtyped_tags(report, blocks)
    _check_source_naming(report, blocks)
    _docx_relabel(report, failures, warnings)
    # Asserted after the relabel because it speaks in blocks by construction.
    _docx_check_legend_position(report, blocks)
    _docx_check_note_prose(report, blocks)

    # The split-bracket and line-breaking checks are deliberately absent: both exist
    # because reportlab's CJK breaker is Japanese and cuts `[标签]` in half. Word
    # breaks these lines, after the file is handed over, and this package never sees
    # them — a check run on the source text here would always pass and would read as
    # though the defect had been ruled out.

    furniture_text = "\n".join(
        blob.decode("utf-8", "ignore") for name, blob in parts.items()
        if name.startswith(("word/header", "word/footer"))
    )
    leaked = sorted({term for term in QA_VOCABULARY
                     if term in text or term in furniture_text})
    if leaked:
        report.failures.append(
            f"the deliverable contains build-QA wording {leaked} — this describes "
            f"how the file was made, not what was analysed. Move it to "
            f"{LAYOUT_REVIEW_FILE} beside the rendered pages. (Legal and scope "
            "statements such as 分析师底稿 / 不构成投资建议 / 数据截至 are not QA "
            "and belong exactly where they are.)"
        )
    icons = sorted({icon for icon in SEVERITY_ICONS if icon in text})
    if icons:
        report.failures.append(
            f"severity icons {icons} appear in the document — the severity policy "
            "keeps 🔴/🟡/⚪ for Markdown and terminal output and asks a file "
            "deliverable for the word (高 / 中 / 低·信息). A DOCX renders them, so "
            "unlike the PDF path nothing breaks visibly here; two deliverables of "
            "the same finding disagreeing is the defect"
        )

    _docx_layout(report, path, render_dir, timeout)
    return report


def _docx_page_blocks(document: ElementTree.Element) -> list[tuple[int, int, int]]:
    """Per break-delimited block: (text chars, drawings, tables).

    ``_docx_blocks`` drops the blocks that hold no text, which is convenient for the
    text checks and hides the defect below — so the blank-page scan counts content
    itself, and counts drawings and tables as content. A block holding only a figure
    has no text and is not blank.
    """
    body = document.find(f"{_W}body")
    blocks: list[list[int]] = [[0, 0, 0]]
    if body is None:
        return [tuple(blocks[0])]
    for child in body:
        if child.tag == f"{_W}p":
            props = child.find(f"{_W}pPr")
            breaks = props is not None and props.find(f"{_W}pageBreakBefore") is not None
            breaks = breaks or any(
                br.get(f"{_W}type") == "page" for br in child.iter(f"{_W}br"))
            if breaks:
                blocks.append([0, 0, 0])
            # A section break is a page boundary as well — the cover is its own
            # zero-margin section and ends on one instead of on a page break.
            if props is not None and props.find(f"{_W}sectPr") is not None:
                blocks.append([0, 0, 0])
            blocks[-1][0] += sum(len((t.text or "").strip())
                                 for t in child.iter(f"{_W}t"))
            blocks[-1][1] += len(list(child.iter(f"{_W}drawing")))
        elif child.tag == f"{_W}tbl":
            blocks[-1][2] += 1
            blocks[-1][0] += sum(len((t.text or "").strip())
                                 for t in child.iter(f"{_W}t"))
            blocks[-1][1] += len(list(child.iter(f"{_W}drawing")))
    return [tuple(block) for block in blocks]


def _docx_check_blank_pages(report: Report, document: ElementTree.Element) -> None:
    """A page break with nothing between it and the next one is a blank page.

    This is the structural half of the PDF path's ink-share check, and the half that
    needs no pagination: whatever Word does with the flow, a break followed by
    another break with no content in between produces an empty page, and a break on
    the last block produces an empty final page. The other half — a page that is
    *nearly* empty because a block was deferred whole — genuinely needs a paginating
    engine and is measured on the LibreOffice conversion.

    Worth having separately because the two arrive from different directions. Ink
    share catches what the flow did; this catches what the author wrote, and it
    still catches it on a machine with no LibreOffice, which is where the ink checks
    are unavailable.
    """
    blocks = _docx_page_blocks(document)
    empty = [index for index, (chars, drawings, tables) in enumerate(blocks, start=1)
             if not chars and not drawings and not tables]
    if not empty:
        return
    last = len(blocks)
    trailing = [index for index in empty if index == last]
    inner = [index for index in empty if index != last]
    if inner:
        report.failures.append(
            f"block(s) {', '.join(map(str, inner))} hold no text, no figure and no "
            "table between one page break and the next — that is a blank page in the "
            "delivered file. The house policy allows exactly two hard breaks (after "
            "the cover, before the Sources section); anything else is a break "
            "somebody added"
        )
    if trailing:
        report.failures.append(
            "the document ends on a page break with nothing after it, so the last "
            "page of the file is empty — Word will show it, and a reader takes a "
            "trailing blank page for a truncated document"
        )


#: How far a table's grid may miss the text column before it is a defect, in twips.
#: One twip per column of rounding is expected; 2mm is well past that and is the
#: point at which a table is visibly narrow or hanging into the margin.
_TABLE_WIDTH_SLACK = 2 * 20 * 72 / 25.4


def _docx_check_figure_line_rule(report: Report,
                                 document: ElementTree.Element) -> None:
    """A paragraph holding a picture must declare an automatic line height.

    The body's line grid is 15.5pt with ``w:lineRule="exact"``, and it is set in
    ``docDefaults`` — so a paragraph that writes no ``w:spacing`` **inherits** it.
    An inline image inside an exact line box is clipped to that box: the reader gets
    a 15.5pt horizontal slice of a 60mm chart, with the neighbouring text lines
    occupying the space the rest of the image should have had. What that looks like
    is text printed over the figure, which is how it was reported.

    Measured on a shipped deliverable: **12 of 12** figure paragraphs. The builder
    now writes ``w:line="240" w:lineRule="auto"`` on them, and this checks the
    property rather than the call — inheritance is exactly what made the defect
    invisible, so "no spacing element" has to read as a failure, not as a default.
    """
    body = document.find(f"{_W}body")
    if body is None:
        return
    clipped: list[int] = []
    index = 0
    for para in body.iter(f"{_W}p"):
        if not any(True for _ in para.iter(f"{_W}drawing")):
            continue
        index += 1
        props = para.find(f"{_W}pPr")
        spacing = props.find(f"{_W}spacing") if props is not None else None
        rule = spacing.get(f"{_W}lineRule") if spacing is not None else None
        if rule != "auto":
            clipped.append(index)
    if not clipped:
        return
    report.failures.append(
        f"{len(clipped)} figure paragraph(s) do not set w:lineRule=\"auto\" "
        f"(figure {', '.join(str(n) for n in clipped)}), so each inherits the body's "
        "exact 15.5pt line grid and Word crops the image to that line box — the "
        "figure shows as a thin slice with the surrounding text running through it. "
        "Build figures with report-render's rep.figure(), which writes the automatic "
        "line height; a paragraph with no w:spacing at all is the defect, not a "
        "default, because the exact rule is inherited from docDefaults"
    )


def _docx_check_tables(report: Report, document: ElementTree.Element) -> None:
    """Every table fills the text column, and every row fills the grid.

    Both are guaranteed by ``DocxReport.table`` — the widths come from the PDF
    path's own allocator, which normalises to the text column, and short rows are
    padded. Checked anyway on the built file for the same reason the PDF path
    re-checks its own invariants: the deliverable is the evidence, and a table can
    also arrive from a hand-edited package or an older script.

    A row with fewer cells than the grid renders as a row that stops half way
    across; a grid wider than the column hangs the last column into the margin,
    which is where Word puts it rather than shrinking anything.
    """
    # Two widths are legal, and which one depends on the section the table sits in.
    # A body table fills the text column. The cover's table fills the *paper*, because
    # the cover is a zero-margin section — that is what makes its colour block bleed.
    # Comparing everything against the text column reported the cover as 210mm vs
    # 174mm, i.e. flagged the one table that was right.
    column = (theme.PAGE_W - theme.MARGIN_L - theme.MARGIN_R) * 20
    allowed = [column]
    if any(s.find(f"{_W}pgMar") is not None
           and s.find(f"{_W}pgMar").get(f"{_W}left") == "0"
           for s in document.iter(f"{_W}sectPr")):
        allowed.append(theme.PAGE_W * 20)
    expected = column
    narrow: list[str] = []
    ragged: list[str] = []
    for index, table in enumerate(document.iter(f"{_W}tbl"), start=1):
        grid = [int(col.get(f"{_W}w", 0))
                for col in table.iter(f"{_W}gridCol")]
        if not grid:
            continue
        total = sum(grid)
        if all(abs(total - ok) > _TABLE_WIDTH_SLACK for ok in allowed):
            narrow.append(f"表{index}: {total / 20 / 72 * 25.4:.0f}mm "
                          f"vs {expected / 20 / 72 * 25.4:.0f}mm")
        for row_index, row in enumerate(table.iter(f"{_W}tr"), start=1):
            cells = len(list(row.findall(f"{_W}tc")))
            span = sum(int(gs.get(f"{_W}val", 1))
                       for tc in row.findall(f"{_W}tc")
                       for gs in tc.iter(f"{_W}gridSpan")) or 0
            merged = span - len([1 for tc in row.findall(f"{_W}tc")
                                 if tc.find(f"{_W}tcPr") is not None
                                 and tc.find(f"{_W}tcPr").find(f"{_W}gridSpan") is not None])
            if cells + merged != len(grid):
                ragged.append(f"表{index} 第{row_index}行: {cells + merged}/{len(grid)}")
    if narrow:
        report.failures.append(
            f"{len(narrow)} table(s) do not span the text column: "
            + "; ".join(narrow[:4])
            + " — Word does not shrink a table to fit, it hangs the last column into "
            "the margin. Pass relative proportions to rep.table(col_widths=…) and let "
            "it normalise, or leave col_widths out entirely"
        )
    if ragged:
        report.failures.append(
            f"{len(ragged)} table row(s) carry fewer cells than the grid: "
            + "; ".join(ragged[:4])
            + " — the row renders as a row that stops half way across. rep.table() "
            "pads a short row; a row this shape means the package was assembled or "
            "edited by something else"
        )


def _docx_check_legend_position(report: Report, blocks: list[str]) -> None:
    """The legend leads its block, or belongs to the cover.

    The shared check for this (``_legend_is_page_head``) works off *chrome* — the
    lines that repeat on every page — to decide what may legitimately sit above the
    legend. A DOCX keeps its header and footer in separate parts, so there is no
    chrome in the body text and that check returns True for any placement, i.e. it
    is inert on this path. Which is a silent gap of exactly the kind this module
    exists to close, so the same rule is asserted differently here: within the block
    it lands in, the legend must be the first line.

    Block 1 is the cover, where ``placement="cover"`` legitimately puts the legend
    below the title block and the KPI strip, so that block is exempt.
    """
    where = next((i for i, block in enumerate(blocks, start=1)
                  if LEGEND.search(block)), None)
    if where is None or where == 1:
        return
    lines = [line for line in blocks[where - 1].split("\n") if line.strip()]
    if lines and not LEGEND.search(lines[0]):
        report.failures.append(
            f"the provenance legend is not the first thing in its block — "
            f"「{lines[0][:40]}」 sits above it, so it reads as the opening line of "
            "that section rather than as the document's reading key. rep.legend() "
            "places it for you (placement='lead'|'cover'); do not emit it as a "
            "paragraph of your own"
        )


def _font_installed(family: str) -> bool:
    """Is this font family resolvable on *this* machine?

    Asked only before a QA conversion, and only to caveat it. A DOCX names its font
    and the reader's Word resolves it, so a family missing here says nothing about
    the reader — but it says a great deal about the conversion we are about to look
    at, which will render a substituted face. Judging that render as if it were the
    document is the failure this warns about.

    ``fc-list`` where it exists, the package's own font search path otherwise.
    Matching ignores spaces and case, because ``Noto Sans SC`` ships as
    ``NotoSansSC-Regular.ttf``.
    """
    key = family.replace(" ", "").lower()
    fc = shutil.which("fc-list")
    if fc:
        try:
            out = subprocess.run([fc, ":family"], capture_output=True, text=True,
                                 timeout=20).stdout
            if key in out.replace(" ", "").lower():
                return True
        except (subprocess.SubprocessError, OSError):
            pass
    from . import fonts as _fonts

    for root in _fonts.search_dirs():
        try:
            for path in Path(root).rglob("*"):
                if path.suffix.lower() in (".ttf", ".ttc", ".otf") and \
                        key in path.stem.replace(" ", "").lower():
                    return True
        except OSError:
            continue
    return False


def _docx_layout(report: Report, path: Path, render_dir: str | Path | None,
                 timeout: float) -> None:
    """Measure layout on a LibreOffice conversion, or say that it was not measured.

    The conversion is scaffolding: it lands in the QA directory, never beside the
    deliverable, and Step 5 of the skill removes that directory whole. Only geometry
    is taken from it — ink share, blank pages, foot gaps, the final-page stub, and
    the per-page renders the visual gate needs. The citation and font findings stay
    the package's own: those are the deliverable's contract, and the conversion's
    version of them is LibreOffice's.
    """
    soffice = _soffice()
    if soffice is None:
        report.status = STATUS_NO_PAGINATION
        report.warnings.append(
            "LibreOffice (soffice) was not found, so the document was never "
            "paginated: blank pages, nearly-empty pages, foot gaps and the per-page "
            "renders the visual gate needs are all UNCHECKED. This exits "
            f"{EXIT_NO_PAGINATION} and is not a pass. Either install LibreOffice, or "
            f"record 未经视觉验收(已过结构检查) in {LAYOUT_REVIEW_FILE} and say so in "
            "the delivery message"
        )
        return
    target = Path(render_dir) if render_dir else None
    missing = [family for family in report.embedded_fonts
               if family and not _font_installed(family)]
    if missing:
        report.warnings.append(
            f"the document names {missing} and this machine has no such font, so the "
            "conversion below renders a substituted face: line breaks, column fits "
            "and page count are all the substitute's, not the document's. Judge the "
            "per-page renders for structure only, or install the family before "
            "accepting the layout"
        )
    with tempfile.TemporaryDirectory(prefix="docx-verify-") as tmp:
        outdir = target or Path(tmp)
        outdir.mkdir(parents=True, exist_ok=True)
        try:
            converted = _docx_to_pdf(soffice, path, outdir, timeout)
        except subprocess.TimeoutExpired:
            report.status = STATUS_NO_PAGINATION
            report.failures.append(
                f"LibreOffice did not finish converting within {timeout:g}s, so the "
                "layout gate did not run")
            return
        except Exception as exc:  # noqa: BLE001 — the reason belongs in the report
            report.status = STATUS_NO_PAGINATION
            report.failures.append(f"{exc} — the layout gate did not run")
            return
        geometry = verify(converted, render_dir=target, expect_cjk=False,
                          geometry_only=True)
        report.pages = geometry.pages
        report.ink = geometry.ink
        report.foot_gaps = geometry.foot_gaps
        report.rendered = geometry.rendered
        report.failures += geometry.failures
        report.warnings += geometry.warnings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("pdf", metavar="FILE", help="the built .pdf or .docx")
    ap.add_argument("--render", metavar="DIR", help="also save each page as a PNG")
    ap.add_argument("--no-cjk", action="store_true", help="the deliverable is not Chinese")
    ap.add_argument("--json", action="store_true", help="emit the full report as JSON")
    args = ap.parse_args()

    report = verify(args.pdf, args.render, expect_cjk=not args.no_cjk)

    if args.json:
        print(json.dumps(asdict(report), indent=2, ensure_ascii=False))
        return _exit_code(report)

    print(
        f"{report.path}: {report.pages} page(s), {report.cjk_chars} CJK chars, "
        f"{report.markers} marker(s), {report.links_internal} internal + "
        f"{report.links_external} external link(s)"
    )
    if report.format == "docx":
        print("  structural checks ran on the package; "
              + ("layout measured on the LibreOffice conversion"
                 if report.status == STATUS_OK
                 else "LAYOUT NOT MEASURED (see below) — this is not a pass"))
    else:
        print(f"  embedded fonts: {', '.join(report.embedded_fonts) or 'none'}")
    if report.ink:
        print("  ink per page: " + " ".join(f"{s:.1%}" for s in report.ink))
    if any(g for g in report.foot_gaps):
        print("  foot gap per page: " + " ".join(
            "n/a" if g is None else f"{g / mm:.0f}mm" for g in report.foot_gaps))
    for warning in report.warnings:
        print(f"  ! {warning}")
    for failure in report.failures:
        print(f"  x {failure}", file=sys.stderr)
    verdict = ("OK" if report.ok and report.status == STATUS_OK
               else "FAIL" if not report.ok else STATUS_NO_PAGINATION.upper())
    print(verdict, file=sys.stdout if report.ok else sys.stderr)
    return _exit_code(report)


def _exit_code(report: Report) -> int:
    """0 clean, 1 on a failure, 3 when a DOCX could not be paginated.

    Three exists so an ``&&`` chain cannot treat an unmeasured layout as a
    measured one — the same reason ``xlsx-author``'s ``recalc.py`` has it. An
    earlier version of that script returned 0 for every outcome and a workbook
    full of ``#REF!`` passed silently.
    """
    if not report.ok:
        return 1
    return 0 if report.status == STATUS_OK else EXIT_NO_PAGINATION


if __name__ == "__main__":
    sys.exit(main())
