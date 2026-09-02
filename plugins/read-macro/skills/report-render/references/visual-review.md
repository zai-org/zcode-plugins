# Visual Acceptance Review

The protocol behind report-render Step 4. Step 3 (`verify.py`) passes on
visibly-wrong documents — six classes of defect in `pitfalls.md` survived
every automated check and were caught only by looking at the rendered page.
This is that look, made structured and honest.

## Step 0 — The canary (run before any page review)

Read `references/canary.png`. State the exact text you see.

- If you read **`VISUAL-CHECK-7Q2X`** → vision is available → proceed to
  Step 1.
- If you cannot read it, or the text is wrong/garbled → vision is
  unavailable this session → go to **Step 1N** instead. Do **not** skip the
  gate wholesale: part of it is numeric and runs without eyes.

The canary is deterministic: the string is known, the match is exact. There
is no judgement call in this step — either you read it or you don't.

**Never fabricate a pass verdict on a page you cannot see.** A scoped pass and
an honest `Unverified` are both fine; a hallucinated pass is the worst outcome
this gate can produce.

## Step 1N — Numeric review (vision unavailable)

`verify.py` measures part of what Step 1 looks for. Run it, read the per-page
numbers, and issue verdicts **only** on what they cover — everything else is
`Unverified`, not `pass`.

```bash
python3 -m fin_report.verify "$DELIVER/报告.pdf" --render "$BUILD/qa" --json
```

What the numbers decide, and how:

| Criterion | Signal | Verdict |
|---|---|---|
| Page renders blank | `ink[i] ≤ 0.08%` with page text present | `fail` — font not embedded |
| Page genuinely empty | `ink[i] ≤ 0.08%`, no page text | `fail` — stray page break |
| Page nearly empty | `ink[i] < 0.5%` | `fail` — stranded caption or heading |
| **Page ends early** | `foot_gaps[i] ≥ 78mm` (104mm+ is a deferred exhibit) | `fail` unless accepted **in `<BUILD>/qa/layout-review.md` on a `版面自检` line**, with the mm figure as evidence (build record, never printed in the deliverable) |
| **Last page is a list remainder** | last page ≥ 70% of column unused **and** the `来源` heading is on an earlier page | `fail` — a page spent on a few entries a tighter list absorbs |
| CJK reached the text layer | `cjk_chars > 0` | `fail` at zero |
| `[n]` are real annotations | `markers > 0, links_internal == 0` | `fail` |

What the numbers **cannot** decide — mark these `Unverified` on every page:

- whether a chart shows what the surrounding text claims;
- a title or source line printed twice (both copies are correct text in
  correct positions — this is the canonical check-proof defect);
- modules overlapping, or content past its container. **Text drawn over text
  *inside a figure* is now measured** — `charts.save` refuses it — so what is left
  here is overlap between page-level blocks, which nothing measures;
- a table that lost its header across a break;
- a figure separated from its caption;
- vertical rules in a document table; palette coherence;
- tofu — `cjk_chars > 0` says CJK is in the *text layer*, not that glyphs drew.

The foot gap is the one that matters most here, because it is the **only**
automated signal for a half-empty page: a page missing its bottom 40% still
renders about 9% ink, so ink share passes it in silence. Treat a gap over 78mm
as a defect to fix or to accept **in writing** — "an exhibit did not fit" is a
reason, not an exemption. **Do not chase gaps below it**: 40–57mm is the natural
ragged bottom of a flowing document, and reporting that band once drove a model
to rebuild one report twelve times and hoist a data table ahead of the body prose
to close it. Tidier pages, a worse document.

The cover and the page before a section that owns its own page are exempt already
and never reported. The final page is exempt from the 78mm floor — a document
stops where its content stops — **except** when it is a remainder of the `来源`
list, which is uniform and reflowable and therefore should have been absorbed.

Then record **`未经视觉验收(已过数值版式检查)`** in `<BUILD>/qa/layout-review.md`
— not the bare `未经视觉验收`, which would understate what was actually checked —
and go to Step 5 of the render workflow. It goes in the build record, **never in
the deliverable**: which gate ran is a fact about the file, not about the subject
of the analysis, and a cover meta block listing it beside 财报披露日 and 报告撰写日
presents it as though it were the same kind of fact.

## Step 1 — Review every page in `$BUILD/qa/`

`p01.png`, `p02.png`, … one verdict per page, in order. For each page check
all three dimensions. Finance is a strict domain — judge accordingly.

### Visual — what is drawn

Every chart, table, and image is correct and cleanly rendered:

- A chart shows exactly what the surrounding text claims (right type, right
  values, right series). A bar chart the text calls "revenue by segment"
  must show revenue by segment, not growth rates.
- Axes, legends, labels are sharp and unclipped; no `□` tofu, no watermarks,
  no crude improvised graphics.
- No title printed twice (pitfalls.md §Figures: "the same title printed
  twice" — survives every check).
- No source line printed twice (same section — "only caught by looking").
- Stylised treatments (colour palettes, chart styles) are design choices,
  not defects — but palette coherence across the document is.

### Layout — how it is composed

The page reads as finished work:

- No modules overlapping or stacked behind each other.
- No content spilling past the page margin or its container.
- No half-empty page (pitfalls.md: "half-empty pages" — a blank-bottom page
  where keepWithNext failed, or a figure deferred off the foot of a page).
  **Read `verify.py`'s foot-gap figure for the page rather than estimating it**:
  it reports the unused column in millimetres, so "page 4 ends 92mm early (36%)"
  is evidence and "the bottom looks a bit empty" is not. Your job on this
  criterion is to decide whether the measured gap is acceptable, not to detect it —
  **and to write the decision to `<BUILD>/qa/layout-review.md` on a `版面自检` line**, page by page. It is build QA, not analysis — it does not go in the deliverable.
  A gap you accepted and a gap you never opened look the same in the file otherwise.
- A figure narrower than a sibling of similar density is **not** a defect by
  itself: `_FittedFigure` scales a figure down — bounded by a 7pt floor on the
  text inside it — to keep it on the page it belongs to rather than stranding
  the foot of that page. Judge the text in the figure, not the width: illegible
  labels are the defect, a 10% width difference is the intended trade.
- No table crossing a page break and losing its header (pitfalls.md: "a
  table crossing a page break loses its header").
- No heading orphaned at a page bottom, separated from its content.
- No figure separated from its caption by a page break.
- No vertical rules in a document table (pitfalls.md: house style forbids
  them; verify.py does not check).

### Content — what it says

- No mojibake; CJK renders correctly in the body and in charts.
- Formulas render properly (no `#NAME?`, no `####` in a rendered xlsx view).
- Nothing truncated mid-sentence.
- Specific figures agree with the source data the skill pulled — a revenue
  number on the page must match the figure in the data tab or the cited
  filing. This is the finance-strict check: if the page says ¥12.4亿 and the
  source says ¥21.4亿, that is a Content fail, not a rounding difference.
- `[n]` citation markers on the page correspond to real entries in the
  Sources section.

## Step 2 — Output: one JSON line per page

```
{"page": 1, "verdict": "pass"}
{"page": 2, "verdict": "fail", "issues": [{"category": "Layout", "problem": "table header lost at page break", "evidence": "p02 bottom rows have no header repeat; the table started on p01"}]}
{"page": 3, "verdict": "pass"}
```

- One line per page, in page order, passing pages included.
- `category`: `Visual` | `Layout` | `Content` | `Spec` | `Unverified`.
- `Spec` = a violated item from the user's request (quote the item); use
  only if a spec was given.
- Any criterion violated → `fail`. Any criterion you cannot confirm (vision
  edge case, reference not provided) → `Unverified`, not `fail`.
- One issue, one category, one entry. If one root cause shows several
  symptoms, report it once under the dominant category.
- Concrete evidence always: what you saw, or the source quote. No invented
  pixel values, no generic beautification advice.

## Step 3 — Repair loop

Any `fail` page: go back to the reportlab/build step, fix the cause,
re-render, re-review that page only (pages already passing need not be
re-reviewed unless the fix changed them). Repeat until every page is `pass`
or honestly `Unverified`.

`Unverified` does not block delivery — but it must be visible in the
deliverable, not buried. The reader needs to know what was not checked.
