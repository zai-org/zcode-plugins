# Rendering pitfalls

Every entry here is a **silent** failure: the code raises no exception, the file
is produced, and the process that wrote it cannot tell anything is wrong. All of
them were hit at least once — several were hit twice, independently, by two
report runs that could not learn from each other.

`fin_report` already handles most of these. They are documented because you will
meet them again the moment you step outside it.

## Fonts and CJK

**「有 CJK 字体」不等于「字体覆盖了你要的字符」。** 找到一份 NotoSansSC 并不
保证它有你正文里的每个字形。实测这台机器上 `_fonts/NotoSansSC-Regular.ttf`
**没有 U+2022 `•`**（glyph id 0），而 callout 与表格内的项目符号正是用它
（`doc.py` 两处 `f"• {item}"`）。用那份字体渲染，每个 callout 项都以 ⊠ 开头，
且 `a callout longer than a page still builds` 这条用例会直接失败——
看起来像排版逻辑坏了，其实是字体缺字形。换一份带 `•` 的同名字体后
selftest 全绿。

缺字形**不会让渲染报错**：它以 `.notdef` 落进 PDF，页面上是 ⊠，提取文本时是
U+0000。`verify()` 现在专门查这个并判失败，所以这类问题到不了交付物——
但换字体目录时值得先确认 `•` 在不在，否则整份报告的项目符号会一起变成方框。

```python
import fitz; f = fitz.Font(fontfile="…/NotoSansSC-Regular.ttf")
assert f.has_glyph(ord("•")), "这份字体没有项目符号"
```

**Blank Chinese PDF.** reportlab's built-in CID fonts (`STSong-Light`) put the
correct text in the text layer — extraction looks perfect — and render **blank**
in any viewer without Adobe's CJK packs. Embed a real TTF. `verify` catches this
by inspecting font resources for `FontFile2`, which is the only reliable signal.

**`<b>` silently renders regular.** Registering Regular and Bold is not enough;
without `registerFontFamily` plus `addMapping`, reportlab has no idea the two are
related, so `<b>text</b>` falls back to the regular face. Nothing warns you.

**Bold does not resolve in matplotlib.** `fontweight="bold"` is resolved through
the font's *metadata*, not its outlines. A static weight instantiated from a
variable font keeps the source's name table, so a genuine 700-weight file can
still report subfamily "Regular", PostScript name "…-Thin", and a clear macStyle
bold bit. Two such files both claim to be the same font and matplotlib picks
whichever it indexed first. Fix the name table (`fonts._retag`), or pass explicit
`FontProperties` objects everywhere.

**Variable fonts and OTFs.** reportlab cannot use a variable font and rejects
PostScript-outline OTFs outright. Instantiate static weights with fontTools.

**A CJK family name breaks `registerFont`.** PostScript names (nameID 6) are
spec-bound to printable ASCII, and reportlab enforces it, raising
`TTFError: psName=b'\xe9\xbb\x91\xe4\xbd\x93-Regular' contains invalid character`
— an ASCII-escaped byte string, so the name is not even readable as 黑体 in the
message. This bites precisely the fonts most likely to be *found* on a
Chinese-configured machine (黑体, 宋体, 微软雅黑), and `_retag` used to build the
PostScript name from the family name verbatim, so repairing a font did not fix it.
`fonts._ps_safe` now keeps only ASCII alphanumerics for nameID 6 and leaves the
Unicode family name intact for matplotlib, which wants it.

**`fontTools.instancer` moved.** The instancer's real home is
`fontTools.varLib.instancer`; the `fontTools.instancer` alias is gone as of 4.59,
so the documented "drop a variable `NotoSansSC.ttf` on the search path" route died
with a raw `ImportError` instead of this module's guided `FontError`.
`fonts._instancer` tries the real location first and keeps the alias as fallback.

**A font can pass reportlab and still fail matplotlib.** They use different
loaders, so "the font works" is not one question. A `wght`-instanced Source Han
Sans SC VF registers fine in reportlab and is rejected by matplotlib's FreeType
with `Can not load face (broken table; error code 0x8)`. When a font misbehaves,
test both before concluding anything about the file.

**Tofu in charts.** matplotlib without a CJK font draws □□□. Also set
`axes.unicode_minus = False`, or a minus sign becomes tofu on its own. If no CJK
font can be registered, keep axis labels in English/numerals and carry the
Chinese in the body text — an English label beats a box.

## Text and wrapping

**Chinese wraps early, leaving a ragged margin.** A run of Chinese contains no
spaces, so reportlab treats it as one unbreakable word. Set `wordWrap="CJK"` on
**every** style that can hold Chinese. Pair with `TA_JUSTIFY` for clean edges.

**A bare string in a table cell does not wrap.** It also ignores `wordWrap` and
does not render `[n]` link markup. A long Chinese cell silently overflows its
column. Wrap every cell in a `Paragraph`.

**`%` in a `%`-formatted string.** If you build text with the `%` operator, a
literal percent must be `%%` — and `%%` does *not* collapse in a plain string
that never goes through `%`, so it ships as a visible double percent. Prefer
f-strings and the problem disappears.

**`&` in a URL prints as an entity.** reportlab's paragraph parser reads a bare
`&` as the start of an XML entity and *repairs* the unterminated one by inserting
a semicolon, so a query-string URL interpolated into markup comes out as
`…?code=25025B700173&lan;=zh&device;=pc` — three characters that were never in
the source, in the one field whose whole job is to be copied. The `/Link`
annotation is built from the same attribute and survives (reportlab unescapes
it), so the citation is still clickable and only the visible text is wrong:
every automated gate passes it, and only a reader copying the address finds out.
Measured 2026-08-24: 108 mangled URLs across 5 of 14 deliverables.

`refs.lines()` now escapes every author-supplied field, so citations built
through `refs.cite()` are safe. Anything you interpolate into a `Paragraph`
yourself needs the same treatment:

```python
from xml.sax.saxutils import escape
rep.p(f'<a href="{escape(url)}">{escape(url)}</a>')
```

**ASCII quotes inside Chinese text.** A `"` inside a double-quoted Python string
holding Chinese is a syntax error waiting to happen during editing; Chinese
copy wants 「」or "" anyway.

**reportlab's CJK line breaker is Japanese, and it cuts a `[标签]` in half.** Two
separate defects out of one function, and neither errors:

* `cjkFragSplit` imports `ALL_CANNOT_END` and **never uses it**. `[` is in that
  set, so a line ended `…固定汇率+4%[` and the next opened `披露]` — six times in
  one 12-page 业绩点评. The same cut in a citation marker turns `[12]` into `[1` /
  `2]`, which reads as a different source.
* Its prohibition set is `ALL_CANNOT_START`, which is Japanese: `、。）」` are in it,
  the **Chinese** `，；：！？…` are not, so those get pushed onto the next line and
  open it. And the hang rule fires for one character only — "we won't do two or
  more though", says the source — so a chained closer like `）。` hangs the bracket
  and leaves the full stop alone on a line of its own.

Measured by reflowing one shipped report's own body prose: **27 defects in 146
lines.** `fin_report.cjk` replaces both breakers with one rule — a break is legal
unless it opens a line with a character that cannot start one, closes a line with
one that cannot end one, or falls inside a bracketed group — and walks illegal
candidates backwards. Cost: 146 lines becomes 147.

**Both** CJK paths need patching, which neither name suggests:
`Paragraph.breakLinesCJK` sends a **single-fragment** paragraph (plain prose, no
chips) to `wordSplit` and only a multi-fragment one to `cjkFragSplit`. Fix one and
half the document is still wrong — and which half depends on whether the author
happened to tag a figure in that paragraph.

## Figures

**Caption centred, image left.** reportlab's `Flowable.hAlign` defaults to
`LEFT`, so an image sits left under a centred caption unless you set
`image.hAlign = "CENTER"`. Visible, and easy to stare past.

**The same title printed twice.** A matplotlib title inside the PNG plus a PDF
caption above it. Pick one: the caption, because it flows with the text, is
styled by the document, and can carry `[n]` links.

**The same source printed twice.** A source note inside the figure *and* as a
note line under it — or, on a table, a 来源 row inside it *and* a note beneath.
State it once, and **the note line is the one place**: it is selectable text, it
can carry a clickable `[n]`, and it reflows. So pass the source to
`rep.figure(..., note=...)` / `rep.table(..., note=...)` and do not call
`charts.source()` on a figure bound for the PDF (that helper is for a chart
delivered standalone). This one survives every automated check — both copies are
correct text in correct positions — so it is only caught by looking at the page.

**Figure separated from its caption by a page break.** Wrap
`[caption, image, note]` in a single `KeepTogether`.

**Everything sized the same.** A two-bar chart at full column width looks like a
mistake; a nineteen-series chart at 92mm is unreadable. Size by information
density, then clamp height to ~⅓ of the text column (88mm on A4). Count the
drawn elements by introspecting the figure rather than by hand — hand-fed counts
drift the first time the chart is edited.

**Sidecar field names that mean opposite things.** Both earlier generations wrote
a field called `aspect`: one meant width/height, the other height/width. Merging
them naively transposes every figure. Hence `aspect_wh`, named for what it is.

**A missing sidecar crashes the build.** Read it defensively; a missing sidecar
should degrade sizing to a default, not stop the report.

## Pages and tables

**A table crossing a page break loses its header.** Set `repeatRows=1`.

**`keepWithNext` silently does nothing before a `KeepTogether`.** This is the
subtlest one here. reportlab's `handle_keepWithNext` extends a heading's group to
the following flowable only if `_ktAllow` admits it, and `_ktAllow` rejects
`_ContainerSpace` — of which `KeepTogether` is a subclass. So a heading with
`keepWithNext=1` followed by `KeepTogether([caption, image, note])` gets a group
containing *only the heading*, and strands at the foot of a page. Nothing errors,
and it only shows at some content lengths: a sweep measured 4 of 15 filler
lengths stranded. Verified against reportlab 4.5.1.

Fix: group content that always fits in a **one-cell borderless `Table`** instead
— it groups identically and `_ktAllow` admits it, so the heading binds. Do **not**
do this to something that can overflow a page: reportlab then loops instead of
splitting or raising (a 45-row table wrapped this way hung, with `splitInRow=1`
making no difference). Long tables therefore keep `KeepTogether` and take the
heading *inside* the group instead. `fin_report` does exactly this — `_atomic()`
for figures and callouts, `KeepTogether` plus an optional `heading=` for tables —
and `selftest.py`'s `orphan_heading_sweep` is the regression test.

**…and "take the heading inside the group" only works if the author remembers
to.** `table(heading=…)` is the documented escape, but nothing makes it the
default, and the natural way to write a section is `rep.h2("…")` followed by
`rep.table(…)` — two separate calls, with the heading left outside as a flowable
that has nothing bindable to attach to. Same for `callout()`, which takes no
`heading=` at all. Measured 2026-08-18 over a 15-length filler sweep: **table
1/15, callout 1/15 stranded**, while `p` and `bullets` were 0/15 because both are
`_ktAllow`-admitted and bind normally.

One in fifteen is the whole problem. The document that strands is the one where
the heading happens to land near a page foot, so any single report looks correct
and the defect surfaces only in the batch — this is a silent failure in the same
sense as the rest of this file: the process that wrote it cannot see it.

Fix: `_pop_pending_heading()` — `table()` and `callout()` take back a heading
that was just emitted and put it inside their own `KeepTogether`, which is what
`heading=` did by hand. The API is unchanged; `heading=` still works and now has
the same effect whichever way it is written. `selftest.orphan_block_sweep` sweeps
all four block kinds (`para` / `table` / `callout` / `bullets`) and is the
regression test — 0/15 on every path after the fix.

**A rule between a heading and its content breaks the chain.** `h1` emits a
heading then an `HRFlowable`; the heading's `keepWithNext` binds to the *rule*, so
without the rule also carrying `keepWithNext` the pair strands together one line
above the content.

**Half-empty pages.** Caused by a `PageBreak()` before every section heading.
The only legitimate hard breaks are after the cover and before the Sources
section.

**A figure that does not fit strands up to 40% of a page.** The second cause of
half-empty pages, and the one that survives every check. `_atomic()` makes
caption+image+note unsplittable, and platypus has no float mechanism — a story is
strictly linear — so when the space left on the page is smaller than the group,
the whole group moves to the next page and *nothing flows back into the hole*.
This is where platypus and LaTeX part company: LaTeX defers the float but keeps
filling the current page with body text, which is why papers read as compact.
Measured: the group reaches ~103mm (88mm cap + ~15mm of caption, note and
spacing) against a 259mm column, so the gap runs to **40% of a page**. `verify.py`
does not catch it — such a page still renders ~8.8% ink, far above `INK_FLOOR`,
which is tuned for a stranded caption (one line, ~0.5%).

Fix: `_FittedFigure` asks how much room is left and scales the image into it,
down to the point where the chart's own labels would fall below
`theme.FIG_MIN_TEXT_PT` (7pt on the page, the publisher artwork minimum). Below
that it keeps natural size and takes the break after all, because an illegible
exhibit is worse than a gap. Three things about it are load-bearing:

* It re-measures from natural size on **every** `wrap`. reportlab wraps a
  flowable more than once (keepWithNext, then the frame, then again on the next
  page if it moved); scaling from the current size compounds, and the built size
  would then depend on how many times reportlab happened to ask.
* The floor is derived from `fig_w_in` and `base_pt` in the chart sidecar, not
  from a flat percentage — a chart is authored at some width and displayed
  narrower, so every label in it is already scaled by that ratio. **The two
  sparse density tiers sit below the floor** (a two-bar chart at 92mm off a 6.4in
  canvas prints 10.5pt labels at 5.9pt), so those figures have no shrink budget
  at all. That is intended: the fix for them is a smaller canvas, not more
  scaling.
* Natural size must still fit a full page, which `FIG_H_CAP` guarantees. Without
  that the "keep natural size and move" branch would hand reportlab a block that
  fits nowhere — see the looping failure two entries up.

Spacing around the group belongs **outside** it (`spaceBefore` / `spaceAfter` on
the flowable), not as `Spacer`s inside. Space inside an unbreakable block counts
toward whether the block fits and prints even against a page boundary; frame-level
space collapses there. Moving the two spacers out also returned ~9pt to the fit
budget, which is frequently the entire shortfall.

**Vertical rules in a document table.** reportlab's `GRID` draws both axes.
Document tables take horizontal rules only (`LINEBELOW`); vertical rules are a
spreadsheet convention.

**A fixed-height cover band.** It clips or straddles the moment the title runs
to two lines. Measure the title block by wrapping it and size the band to fit.

**A document with no cover inherits the cover's furniture.** reportlab opens on
the **first page template registered**, and the only call that switches to `main`
is `cover()`. So a deliverable that skips the cover — the shape a skill declares
when its note opens on its first sentence, as `write-research`'s `morning-note`
does — drew its body pages inside the cover's 66mm navy band and 42mm grey foot,
with no running header, footer or page number, until `sources()` finally switched
templates.

Note which way this cuts: the defect is the **mismatch**, not the missing cover. A
research deliverable still gets a cover, and "this one is short" is not a reason to
drop it.

Shipped 2026-08-26 in a four-page 晨会纪要: pages 1–2 under the band, page 3 onward
clean, and 「表1 池内六标的」 — a caption in `NAVY`, by style — **invisible** inside a
`NAVY` band. Every gate passed it: a band is ink, and the caption is present in the
text layer. Register the templates in an order that depends on whether there is a
cover; `verify.py` now fails a page that carries a numbered heading or a 表n/图n
exhibit and no page label.

## Verification

**Greyscale QA renders.** If you convert a page to greyscale to measure ink, save
the *colour* image — otherwise every QA page looks monochrome and hides any
palette or contrast defect from the person reviewing it.

**Standard-14 fonts are not an embedding failure.** reportlab puts Helvetica in
page resources whether or not any text uses it. Failing on that makes the check
fire on every correct document, and a check that always fires gets ignored.

**`[n]` markers as plain text.** Blue text is not a link. In PDF they must be
real `/Link` annotations: internal `GoTo` for marker → entry, external `URI` for
the entry's URL. Verify by counting them in the built file.

**Ink share cannot see a half-empty page, and never could.** `INK_FLOOR` (0.5%)
is calibrated for a page holding roughly one line, so it catches a stranded
caption. A page that simply stops half way down still renders ~9% ink and passes
in silence — measured, not assumed: 92mm of unused column reported as 7.4% ink.
The two are different defects on different axes, and one threshold cannot serve
both. `_foot_gap` measures the second directly, by scanning the **content box**
upward for the first inked row. It must be the content box, not the page: the
footer rule and page number sit below `MARGIN_B`, so a whole-page scan finds ink
on every page and reports no gap anywhere.

**A document-wide flag cannot diagnose a per-page defect.** The blank-page check
used to test whether *the document* had a text layer, then blamed every blank page
on font embedding. A stray `PageBreak` leaving one empty page in an otherwise
normal report therefore produced "the classic embedded-font failure" and sent
anyone debugging it after a font that was fine. Per-page character counts split
the two: text present but no ink is a font problem, neither present is a stray
break.

**A warning is the right severity for a defect the builder is allowed to cause.**
The foot gap is a warning, not a failure, because `_FittedFigure` legitimately
leaves one when a figure cannot reach the remaining space without dropping below
the legibility floor. Failing the build there would make correct behaviour
unshippable; reporting the millimetres makes someone decide. Failures are for
things that are never intentional.

**"It built" is not "it is correct".** The automated checks pass on documents
that are visibly wrong. Render the pages and look at them.
