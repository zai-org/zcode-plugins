---
name: sector-overview
description: Create comprehensive industry and sector landscape reports covering market dynamics, competitive positioning, key players, and thematic trends. Use for client requests, sector initiations, thematic research pieces, or internal knowledge building. Triggers on "sector overview", "industry report", "market landscape", "sector analysis", "industry deep dive", or "thematic research". The subject is the **industry**; a deep dive on one company carrying a target price and a rating is `research-report`, which calls this skill for its industry section.
---

# Sector Overview

## 0. Data Sourcing & Provenance — NEVER FABRICATE

This section is the one to get right before any other. Market research lives or dies on credible numbers. A market-size, share, growth, or multiple figure with no traceable source is worse than no figure. **A blank with a note beats an invented number.**

**Provenance has two mechanisms, and they divide the work.** The clickable numbered source marker `[n]` on the figure, jumping to `## 来源` at the end, is the primary one: in flowing sector prose whose claims are all externally sourced, a `[n]` entry that names the firm, the date, and the basis already tells the reader the number is `[披露]` or `[预期]`, so those two chips are **not** required in the narrative. But a citation cannot tell a reader that a number is *ours* or that a report is *unconfirmed*, so three tags are chipped inline **even in prose**:

- `[测算]` — anything we computed or assumed (a CAGR we derived, an implied share, a range midpoint).
- `[推断]` — our analytical read with no corresponding record ("this likely reads across to peers").
- `[媒体]` — reported by media and not corroborated by a disclosed record.

Chips ARE required throughout any table, KPI strip, or valuation summary, where disclosed actuals, our computations, and third-party forecasts sit side by side and the reader cannot otherwise tell them apart. The Chinese forms `[披露]` `[测算]` `[预期]` `[推断]` `[媒体]` in a Chinese deliverable, the English aliases `[Reported] [Est.] [Consensus] [Inferred] [Media]` in an English one; never mixed, and never a paraphrase such as `[已披露]` or `[一致预期]`. `[预期]` always names its provider inline.

**Hard rules — violating any is a serious failure:**
1. **Cite firm + date + basis, via `[n]`, for every market-size / share / CAGR / multiple.** Not "market is $50bn" but "$50bn (Gartner, 2025; vendor-revenue basis)[n]". A TAM/CAGR with no named source is forbidden — **delete the number**. If a table cell must hold something, write `n.d.`; an unsourceable figure is not one we publish.
2. **TAM hype vs. realistic addressable.** Distinguish a vendor's promotional TAM from a defensible SAM/SOM; if you cite a big TAM, state the basis and whether it's realistic.
3. **Conflicting third-party estimates → show the spread, don't cherry-pick.** If Gartner says $50bn and IDC says $38bn, report both with sources and note the definitional difference — never silently pick the flattering one.
4. **Don't pass off a derived number as a hard one.** When you compute a CAGR, infer a share (revenue ÷ TAM), or take a range midpoint, that figure carries `[测算]`, says so in the text ("we estimate", "implied", "midpoint"), and still cites the inputs' source `[n]`. Just don't dress a derivation up as a reported figure.
5. **MCP first, then the finance vertical index, then web.** Pull company financials/multiples from 同花顺/SEC MCPs; where a fact is not in a tool, 先走 `finance-search.finance_search`(金融垂搜,按档位召回并标注来源等级),它没有命中再落通用搜索。**媒体档默认带日期窗口**;官方档(weight>=3)反过来 —— 日期窗口会丢掉 publish_time 为空的记录(该档多数如此),取原始文件时不带窗口。 (web is last resort and must still be cited with publisher + date via `[n]`). Reconcile: segment/share pieces should tie to the stated total.

## Workflow

### Step 1: Define Scope

- **Sector / subsector**: What industry and how narrowly defined?
- **Purpose**: Client report, internal research, pitch material, idea generation
- **Depth**: High-level overview (5-10 pages) or deep dive (20-30 pages)
- **Angle**: Neutral landscape vs. thematic thesis (e.g., "AI infrastructure buildout")
- **Universe**: Public companies only, or include private?

### Step 2: Market Overview

**Market Size & Growth**
- Total addressable market (TAM) with source — name the research firm, date, and basis, linked `[n]`
- Historical growth rate (5-year CAGR) — cite the source `[n]`; if you computed it, say "we estimate" and cite the underlying data
- Forecast growth rate and key assumptions — name the forecasting firm and date, linked `[n]`
- Market segmentation (by product, geography, end market, customer type)

**Industry Structure**
- Fragmented vs. consolidated — top 5 market share
- Value chain map — where does value accrue?
- Business model types (subscription, transaction, licensing, services)
- Barriers to entry (capital, regulatory, technical, network effects)

**Key Trends & Drivers**
- Secular tailwinds (3-5 major trends)
- Headwinds and risks
- Technology disruption vectors
- Regulatory developments
- M&A activity and consolidation trends

### Step 3: Competitive Landscape

**Company Profiles** (for top 5-10 players):

| Company | Revenue | Growth | EBITDA Margin | Market Share | Key Differentiator |
|---------|---------|--------|--------------|-------------|-------------------|
| | | | | | |

This is a mixed-class table: chip every cell (`[披露]` for a filed figure, `[测算]` for a share you divided out, `[预期]` with its named provider for a forward number). A metric we could not source is `n.d.`, never a filled-in guess. Numbers right-aligned, text left-aligned; document-table styling per the house formatting policy (no vertical rules, `#1F3A5F` header fill with white bold text, zebra white/`#F4F7FA`, thin `#E5E9EF` horizontal grid).

For each company, brief profile:
- Business description (2-3 sentences)
- Strategic positioning and moat
- Recent developments (earnings, M&A, product launches)
- Valuation snapshot (P/E, EV/EBITDA, EV/Revenue)

**Competitive Dynamics**
- How do companies compete? (price, product, service, distribution)
- Who is gaining/losing share and why?
- Disruption risk from new entrants or adjacent players

### Step 4: Valuation Context

**Where each number comes from — this step has a real source, use it rather than web-sourcing multiples.**

- **Sector multiples, current**: `hexin-index.sector_data` gives 市盈率(TTM,整体法) / 总市值(合计) / 成份股个数 in one call. The subject must name the classification — `食品饮料板块(申万行业)`, not a bare 行业名 (which returns an empty table that reads as absence, not as a failed lookup). State the 板块名称 the call resolved to.
- **Sector multiples, historical range and percentile**: take them from the sector *index*, not from `sector_data`. Pull the index's **daily PE(TTM) series** with `hexin-index.index_data` (verified: a sector index returns dated daily PE rows), compute the range and percentile yourself, tag `[测算]`, and state the window's start date and sampling frequency. `sector_data` is the **current cross-section only** — verified: given a two-month window it returned a header row with no data and echoed `"交易日期":"最新"` in `indicators_params`, i.e. it answers with the latest point and does not say it dropped your window. So always read `indicators_params` back: a single latest value dressed as a range is the failure mode here. Then compute the range/percentile yourself, `[测算]`, with the window's start date stated. Do **not** use `index_data`'s built-in 分位数 for a multi-year window — it defaults to 52 weeks and asking for 「近5年」 silently narrows it to two days and returns 100.0.
- **Same 简称, different code across calls.** One sector index resolved to its 中证 code in one call and a 深证 code in another, **with a different PE on each**. Record the code each figure came from and never splice two calls' series without checking they are the same index.
- **Sector vs broader market**: pull the broad index (沪深300 / 中证全指) the same way and show both multiples on the same date and 口径. A premium/discount quoted without saying which index and which date is not a number.
- **Premium/discount drivers** (growth, margins, market position) are `[推断]` unless a retrieved figure supports each one.
- **Recent M&A transaction multiples** have no source in this plugin — there is no precedent-transaction database here. Either cite the announcements you actually retrieved (`wind-docs.get_company_announcements`), or say the transaction multiples were not obtained. Do not present a remembered deal multiple.

### Step 5: Investment Implications

- Where are the best risk/reward opportunities?
- What thematic bets can be expressed through this sector?
- Key debates in the sector (bull vs. bear arguments)
- Catalysts that could change the sector narrative

### Step 6: Output

Deliver in **the format the user requested**; don't assume one. If unspecified, a sector primer is long-form, so build it as a PDF via `report-render` and say in one clause that you chose it. Include: 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。
  - Market overview and sizing
  - Competitive landscape map
  - Company comparison table
  - Valuation summary
  - Key charts: market growth, share trends, valuation history
  - A `## 来源` section (numbered, each entry a clickable link), starting on its own page
  - A `## 覆盖范围与局限` block
  - Excel appendix with detailed company data (optional)

**`## 来源` — that exact heading, nothing else.** One entry per distinct `[n]`, and the count of distinct markers must equal the count of entries:

```
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`Primary` is the issuing document itself — the research firm's own report, the filing, the exchange announcement, a database field sourced from those. Everything else is `Secondary`, and **a Secondary entry must name what it relays**: `Secondary · Caixin · relaying IDC "China AI Market Tracker" · 2026-05-12 (published); retrieved 2026-07-25 · https://…`. This is the common failure mode in sector work: a market-size or share number that resolves only to a news article quoting a report is a Secondary entry, and the body must say the underlying report was not obtained. Do not launder a news URL into an authoritative-looking citation.

**`## 覆盖范围与局限` — report it even when everything worked.** State the retrieval timestamp, and for each of the three states — `有记录` / `检索范围内未发现` / `源不可用` — what it applies to:

```
## 覆盖范围与局限
Retrieved: [timestamp] · Universe: [the names and the sector definition used]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| Financials for [names] | 有记录 | 同花顺 / SEC | [date] |
| Financials for [names] | 源不可用 | [system, why] | [date] |
| Consensus (revenue, EBITDA, EPS) | 有记录 for [n of N] names | [named provider] | [date] |
| Primary market-size report | 检索范围内未发现 — sized from a Secondary relay [n] | — | [date] |

本次未能覆盖: [sources that failed, and what they would have shown]
Data lag: [known lag for the sources used; sector overviews age fast]
```

"检索范围内未发现" is a statement about our search, not about the world — never render it as "there is no such data".

**Format-agnostic quality bar — non-negotiable whatever the format** (build it, then render/open it and look at every page/slide). `report-render`'s `references/pitfalls.md` catalogues the silent failure modes behind these; read it rather than rediscovering them:
- **Charts and their source notes never overlap.** Caption "Figure X" above the chart; the `Source:` line below the plot. In matplotlib use a figure-level footnote (`fig.text()` + reserved bottom margin), not `ax.text()` at data coordinates (which collides with axis labels).
- **State each chart's source exactly ONCE.** If the source line is rendered inside the chart image (e.g. via `fig.text()`), do NOT also repeat it as a caption note below the figure — that duplicates the attribution. Pick one place (embedded-in-chart is fine) and don't echo it.
- **Size charts by information density, not a fixed width — never let a chart dominate the page.** A sparse chart (two or three bars) should render small; a dense or multi-panel chart can be wider. Don't hand-tune a width per chart, and don't apply one width to all. `report-render` implements this: it counts the drawn elements into a `_chart_meta.json` sidecar, maps density to a display width, and clamps by a height cap of roughly ⅓ of the text column. Use it rather than re-deriving the sizing.
- **Bind each figure/table to its caption** (e.g. reportlab `KeepTogether([caption, image, note])`) so a title never splits from its figure across a page/slide.
- **Chinese / CJK must render, not blank, and wrap correctly** — embed a real TTF (Regular + Bold) and set CJK word-wrap; built-in CID fonts render blank. `report-render` handles this, and `references/pitfalls.md` explains the several ways it fails silently if you build outside it.
- **Links genuinely clickable** where the format supports it: inline `[n]` jump to the Sources entry, entries open the source (PDF `/Link` annotations; HTML hyperlinks) — not plain blue text.
- **Let content flow; don't force breaks.** No one-section-per-page `PageBreak()` and no scattered `CondPageBreak()` stranding half-empty pages. The only legitimate hard breaks: after the cover, and before `## 来源` (own page). If a full-width chart spills and strands a gap, shrink its width (e.g. 174mm → ~138mm) so the bound caption+image fits the current page.
- **No overflow, orphan, or half-empty pages/slides.**

## Important Notes

- Source ALL market-size/share/growth data — cite the research firm, date, and methodology/basis (see Section 0). No unsourced TAM or CAGR; an unsourceable figure is deleted, not published with a caveat.
- Distinguish between TAM hype and realistic addressable market; show the basis.
- Sector overviews age fast — stamp `Retrieved: [date]`, note it in the coverage block, and flag data that may be stale.
- Charts are essential — market size waterfall, competitive positioning matrix, valuation scatter plot — each with its source.
- If for a client, tailor the "so what" to their specific situation (M&A target identification, competitive positioning, market entry).
