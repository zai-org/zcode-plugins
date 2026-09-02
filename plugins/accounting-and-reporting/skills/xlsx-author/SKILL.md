---
name: xlsx-author
description: Produce a professional .xlsx workbook on disk with openpyxl — formula construction rules, colour conventions, and the mandatory recalc/error-check step before delivery. Use for any tabular deliverable that belongs in a file — valuation models, comps spreads, screen shortlists, batch risk tables, holdings breakdowns.
---

# xlsx-author

Use this skill whenever the deliverable is an Excel workbook. Workbooks are built
with Python/openpyxl and validated with the bundled recalc script; there is no
live Office application in this environment.

Conventions here follow the house formatting policy, which is the arbiter when
another skill's formatting instruction disagrees.

## Output language

Sheet names, headers, labels, cell comments, the `来源` worksheet and the delivery
message all follow **the user's language of address**, not the template's — a
question in Chinese produces a Chinese workbook, a question in English an English
one. Where the request does not settle it, use the market profile's
`default_locale` (`cn` → `zh-CN`). **One language per workbook**: do not mix
Chinese sheet names with English column headers.

Provenance tags in cell comments follow the workbook, not the market:
`[披露]` `[测算]` `[预期]` `[推断]` `[媒体]` in a Chinese workbook, the English
aliases `[Reported]` `[Est.]` `[Consensus]` `[Inferred]` `[Media]` in an English
one. Those literal strings only — a paraphrase such as `[已披露]` or `[一致预期]`
reads as untagged to every downstream check. Terms of art keep their source
language either way (口径, 归母, 报告期).

## Output contract

- **Write the workbook where the caller collects deliverables from.** Do not assume a
  fixed directory name: use the path the user gave, else the delivery directory this
  session already establishes (one is usually present in the working directory and is
  where uploaded inputs and previous outputs live — look before guessing), else the
  working directory itself. A workbook written somewhere the caller does not read is
  the same outcome as no workbook: the analysis is done and the deliverable is lost.
- **The filename follows the same language as the workbook.** A Chinese request gets
  a Chinese filename; `002594_DCF_Model_2026-08-11.xlsx` answering 「帮我给比亚迪搭一个
  DCF」 is half-translated output even when every sheet name inside is correct, and
  the filename is the first thing the user sees. Ticker, date and other identifiers
  stay as they are (`比亚迪_002594_DCF模型_20260811.xlsx`).
- **Before finishing, list that directory and confirm the file is in it.** Build
  scaffolding — the generator script, temp copies, recalc artifacts — goes in a
  subdirectory you then remove, never beside the deliverable. The script that built
  the workbook is the one that gets left behind most often (`build_byd_dcf.py` shipped
  next to the model in an observed run): it is scaffolding even though it is small and
  even though it documents what you did, because a reader opening the directory cannot
  tell which of the two files is the deliverable.
- Cite the final workbook exactly once in the final message with
  `::zcode-file-citation{path="..." purpose="output"}` inline in prose, and say in
  one clause why that is the delivery location. Do not add a separate raw path,
  Markdown link, trailing citation list, or citation for the build script, temp
  copy, recalc artifact, or other scaffolding.

## How to build the workbook

Write a short Python script and run it with Bash. Use `openpyxl`:

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill

wb = Workbook()
ws = wb.active; ws.title = "Inputs"
ws["B2"] = "Revenue"; ws["C2"] = 1_250_000_000
ws["C2"].font = Font(color="0000FF")           # blue = hardcoded input
calc = wb.create_sheet("DCF")
calc["C5"] = "=Inputs!C2*(1+Inputs!C3)"        # black = formula
wb.save(f"{DELIVER}/model.xlsx")   # DELIVER = the caller's delivery directory
```

## Conventions (mirror `audit-xls`)

- **Font colour carries meaning — four colours, not three.** Blue `#0000FF` =
  hardcoded input. Black = formula. Green `#008000` = link to another sheet.
  Purple `#800080` = a link on the **same** sheet with no calculation (`=B9`).
  The fourth was in use by one model skill and unknown to the audit rules meant
  to verify it, so audits could not see it.
- **Fills**: `#1F4E79` header (white bold text), `#BDD7EE` grouping band,
  `#D9E1F2` input block, `#F2F2F2` neutral. That is the whole palette.
- **Borders are mandatory** in a workbook and carry meaning: 1.5pt above section
  headers, 1.0pt under subtotals, 0.5pt interior grid, double rule under grand
  totals, thin vertical rule between the last historical and first projected
  column. (Documents are the opposite — see `formatting.md`.)
- **Numbers right-aligned, text left-aligned.** Headers align with their column.
- **No hardcodes in calc cells.** Every calculation cell is a formula; every input lives on an Inputs tab.
- **A number typed *inside* a formula is still a hardcode — being in a formula does
  not launder it.** `=6173.8194+1.1194` looks compliant and is not: the two figures
  are retrieved values with no cell of their own, so neither can be coloured blue,
  neither can carry its own source comment, and a reader cannot change one and see
  the model move. This is the loophole in the rule above, and it reads as satisfying
  it — "the cell *is* a formula". Put each retrieved figure in its own input cell
  with its own comment, then have the formula reference those cells:
  `=Inputs!B12+Inputs!B13`.
  - The only literals a formula may carry are **structural constants a reader would
    never want to change**: a unit conversion (`/10000`), a period count (`/12`,
    `/4.33`), a percentage-to-decimal (`/100`). If a literal has a source, a date,
    or a 口径, it is an input, not a constant.
  - The tell is a **multi-decimal literal in a formula** — `6173.8194`, `0.0865`.
    Structural constants are short and round.
- **A value you derived from other cells in this workbook is a calc cell, whatever
  it is a value *of*.** The exemption for retrieved inputs covers what you fetched,
  not what you worked out from it: a 毛利润 that is 收入−成本, a 下行情景 that is
  基准×0.7, a 净利率 you divided out, a subtotal, a YoY. If a reader changes the
  cell it came from and your number does not move, the model is decoration.
  **The tell is a full-precision float in an uncommented cell** —
  `722.4499999999998`, `0.09799999999999999`, `0.0271925445165585`. Read the raw
  value, not the display: every observed instance sat behind a `#,##0.0` or `0.0%`
  format, which is exactly why none was ever caught. A *commented* cell at that
  precision is different and fine — vendor APIs return their fields that way, and a
  retrieved 涨跌幅 of `3.357724446617073` is faithful rather than computed.
- **Every hardcoded input carries a source comment**: `Source: <System or
  Document>, <Date>, <Reference>, <URL>`. A calculated cell carries a formula,
  which is its own provenance — a source comment on a calculated cell means a
  hardcode is hiding in it. In a screen or roster workbook the per-row `来源编号`
  column carries this instead — see "Two classes of workbook" below.
- **Named ranges** for any value referenced from a deck or memo.
- **Balance checks.** Include a Checks tab that ties (BS balances, CF ties to cash, etc.) and surfaces TRUE/FALSE.
- **One model per file.** Do not append to an existing workbook unless explicitly asked.

## Two classes of workbook, two provenance vehicles

The per-cell source comment above was written for a **model** — a few dozen
judged or retrieved inputs, each worth its own comment. It does not scale to the
other thing this skill builds, and pretending otherwise is why screen results
were shipping with no provenance at all: a 1,200-cell screen result cannot carry
1,200 comments, so in practice it carried none.

Decide which class you are building, and use that class's vehicle. Both are
mandatory; neither is optional because the other was used.

**Class A — model or measurement workbook.** A DCF, an LBO, an accretion/dilution
run, a 三表联动 model, a sources-and-uses table, a cash forecast, a variance
bridge. Few inputs, many formulas. Vehicle: **the per-cell `Source:` comment**
on every blue hardcoded input, exactly as above, plus the Inputs and Checks tabs.

**Class B — screen, roster, or snapshot workbook.** A fund screen, a prospect
list, a park roster, a batch risk scan, a spread-segmentation table, an intraday
snapshot, a multi-index percentile table. Many retrieved rows, few or no
formulas. Per-cell comments are unworkable and are **not** required here.
Vehicle instead:

1. **A `来源` worksheet, that exact sheet name** — last tab in the book. One row
   per distinct source, numbered so data rows can point at it:

   | 编号 | 一手/二手 | 发布主体 · 文档或系统名 | 指标/字段 | 日期(发布日) | 检索于 | URL |
   |---|---|---|---|---|---|---|
   | 1 | 一手 | 同花顺 iFinD · 债券静态档案 | 债券简称/发行人/到期日([债券代码]) | — | 2026-08-12 | … |

   **「发布主体 · 文档或系统名」填数据来源方,不填接口名** —— 写机构
   （同花顺 iFinD / 万得 / 万得基金 / 天眼查）加上取的是什么数据,像上表那样
   「同花顺 iFinD · 债券静态档案」、「天眼查 · 企业基础画像」；**不要写 MCP 的
   server 名或工具名**,那是本系统这次恰好走了哪个接口的实现细节,读者无从核对,
   接线一改就失效。机构名必须是**实际调用的那一家**。字段名要留着,它说明取的是
   哪个口径。同一条规则适用于 `Source:` 单元格批注。

   **「URL」只有两种诚实的填法。** 访问过某个具体页面（公告、招股书、新闻、
   政府页面）就填那一页的地址；**机构的接口供数、没有对应公开页面时就留空
   （填 `—`）**。不要拿 `https://www.wind.com.cn`、`https://www.pbc.gov.cn`
   这种只到域名的首页去补 —— 读者点进去是首页,找不到那条数据,而这一列看起来
   却像有出处。经 Wind EDB 取到的人民银行序列同样如此:一手口径归属人民银行,
   但那一页你没访问过,所以没有 URL。这条规则也管 `Source:` 批注里的 `<URL>`
   段:没有具体页面时整段省掉,不要写机构首页。

2. **A `来源编号` column on every data sheet**, carrying the `编号` its row came
   from. A row assembled from two sources carries both (`1,3`). This is what
   replaces the per-cell comment: the mapping from value to source survives, at
   one column instead of one comment per cell.

3. **A `口径与局限` block** at the top or bottom of the `来源` sheet: the executed
   screen criteria (which may differ from what the user asked — say so), the
   criteria the engine could not enforce, the 报告期 of any lagging field, and the
   three states from the coverage policy for anything that did not
   resolve. This is the coverage block; a workbook has nowhere else to put it.

A **judged** input inside a Class B book — an allocation driver you chose, a
threshold you set, a weight — is still a Class A cell: give it a `Source:`
comment and `[测算]`, because it is yours rather than retrieved.

**The four font colours are scoped the same way, and for the same reason.** Blue
is not decoration: it is what a reviewer follows to find the cells that owe a
`Source:` comment. So Class A colours **every** hardcoded input blue — a model
with commented inputs and no blue has hidden its own index — while Class B does
not colour cell by cell, because the `来源编号` column already carries the
mapping. A judged cell inside a Class B book is blue, like any other Class A cell.

## Recalculate before delivery (MANDATORY)

openpyxl writes formula strings without evaluating them. Before delivering any workbook, run the bundled recalc script (it lives at `scripts/recalc.py` inside this skill's directory):

```bash
python3 <this-skill-dir>/scripts/recalc.py "$DELIVER/model.xlsx" 30
```

The script copies the workbook to a temp directory, recalculates every formula
there via headless LibreOffice, and scans for Excel errors (`#REF!`, `#DIV/0!`,
`#VALUE!`, `#NAME?`, `#NULL!`, `#NUM!`, `#N/A`). **Your file is not modified** —
LibreOffice's OOXML round-trip is lossy and can drop the cell comments that carry
your source citations. Pass `--write-back` only if you want the recalculated file,
and a `.bak` is written first.

```json
{"status": "success", "total_errors": 0, "total_formulas": 42}
```

Exit codes are meaningful, so `&&` chains behave: `0` success, `2` errors_found,
`3` recalc_unavailable, `1` hard failure.

- `"status": "errors_found"` → fix every location listed in `error_summary` and re-run until `"success"`.
- `"status": "recalc_unavailable"` → LibreOffice is not installed, so **no formula was actually evaluated**; the script only ran a static lint (broken cross-sheet references). This status is NOT a pass. Fix any `BROKEN_SHEET_REF` findings, then run the independent check below before delivering.

### When recalc is unavailable (MANDATORY substitute)

A clean static lint proves nothing about whether the formulas compute the intended values. Do not treat `recalc_unavailable` as verification. Instead, re-open the workbook with openpyxl and verify in Python:

1. **Reference check** — for every formula cell, assert the formula string points at the cells you intended (e.g. row `r`'s margin must read `=F{r}/C{r}`, not a neighbouring row). Off-by-one references are the most common openpyxl bug and a static lint cannot see them.
2. **Recompute** — independently compute each derived value from the raw inputs in Python and confirm the arithmetic is sensible (no divide-by-zero, no unit mismatch, results within a plausible range).
3. **Identity checks** — assert the relationships that must hold by definition for the model type (gross margin > operating margin > net margin; balance sheet balances; sources = uses; sum of parts = total). `audit-xls` lists these per model type.

Then state the limitation explicitly in the delivery message: which checks were run, and that the formulas were not evaluated by a spreadsheet engine so the user should confirm on open. Never describe a workbook as "verified" or "audited" on the strength of a static lint alone.
