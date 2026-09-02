---
name: earnings-preview
description: Build pre-earnings analysis with estimate models, scenario frameworks, and key metrics to watch. Use before a company reports quarterly earnings to prepare positioning notes, set up bull/bear scenarios, and identify what will move the stock. Triggers on "earnings preview", "what to watch for [company] earnings", "pre-earnings", "earnings setup", or "preview Q[X] for [company]".
---

# Earnings Preview

## Workflow

### Step 1: Gather Context

- Identify the company and reporting quarter
- Pull consensus estimates (revenue, EPS, key segment metrics): use the structured MCP sources first — 同花顺 一致预期 via `hexin-stock.get_stock_financials` (预测每股收益平均值, 目标价(综合值), 评级机构家数 — ask with the forecast year inline, and it returns multiple annual rows) for A/H/US listed names, sec-search filings for US disclosure (filter `form_types` and the date window explicitly; a 10-K request answered with a 10-Q is a period error that surfaces as a wrong number, not as an error) — and fall back to web search only for what they don't cover (name the firm, e.g. LSEG/Visible Alpha). Note the provider and retrieval time for every estimate; never invent consensus. Record which line items consensus covered and which it did not — that goes straight into the coverage block.
- Find the earnings date and time (pre-market vs. after-hours)
- Review the company's prior quarter earnings call for any guidance or commentary

### Step 2: Key Metrics Framework

Build a "what to watch" framework specific to the company:

**Financial Metrics:**
- Revenue vs. consensus (total and by segment)
- EPS vs. consensus
- Margins (gross, operating, net) — expanding or contracting?
- Free cash flow
- Forward guidance vs. consensus

**Operational Metrics** (sector-specific):
- Tech/SaaS: ARR, net retention, RPO, customer count
- Retail: Same-store sales, traffic, basket size
- Industrials: Backlog, book-to-bill, price vs. volume
- Financials: NIM, credit quality, loan growth, fee income
- Healthcare: Scripts, patient volumes, pipeline updates

### Step 3: Scenario Analysis

Build 3 scenarios with stock price implications:

| Scenario | Revenue | EPS | Key Driver | Stock Reaction |
|----------|---------|-----|------------|----------------|
| Bull | | | | |
| Base | | | | |
| Bear | | | | |

For each scenario:
- What would need to happen operationally
- What management commentary would signal this
- Historical context — how has the stock moved on similar prints?

### Step 4: Catalyst Checklist

Identify the 3-5 things that will determine the stock's reaction:

1. [Metric] vs. [consensus/whisper number] — why it matters
2. [Guidance item] — what the buy-side expects to hear
3. [Narrative shift] — any strategic changes, M&A, restructuring

### Step 5: Output

One-page earnings preview with:
- Company, quarter, earnings date
- Consensus estimates table
- Key metrics to watch (ranked by importance)
- Bull/base/bear scenario table
- Catalyst checklist
- Trading setup: recent stock performance, implied move from options
- A tag legend on page 1 listing only the tags that actually appear, in the deliverable's language: `标签口径: [披露] 已披露 · [测算] 本文推算 · [预期] 第三方具名 · [推断] 本文推论 · [媒体] 未获记录佐证`
- `## 覆盖范围与局限`, then `## 来源`

Short-form and unspecified format means Markdown in-session; say so in a clause. If the user asks for a PDF, `report-render` builds it. 用户要 Word 时同样走 `report-render`（`DocxReport`，与 `Report` 同一套调用）——**要出 Word 就先载入 `report-render` 技能，再动手建**；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

### Step 6: Provenance, Sources, and Coverage

A preview mixes disclosed history, our scenarios, and the Street's numbers in the same tables, so every figure carries exactly one chip. Both forms of each tag are given because the deliverable's language decides which one is written — **cite the literal string, never a paraphrase of it**:

- `[披露]` / `[Reported]` — prior-quarter actuals, guidance the company actually issued, the confirmed earnings date.
- `[测算]` / `[Est.]` — our scenario revenue/EPS, the implied move we computed, any margin we divided out.
- `[预期]` / `[Consensus]` — a third-party estimate **with the provider named inline** (LSEG, 同花顺 一致预期, Visible Alpha — a data vendor's aggregated consensus). An unattributed consensus number does not exist. **Not a named peer 券商's own estimate**: this is sell-side research, so engage with a competitor's reasoning and redo the arithmetic yourself as `[测算]` (the provenance policy).
- `[推断]` / `[Inferred]` — a read-across from a peer's print, an attribution hypothesis about what drove last quarter's reaction.
- `[媒体]` / `[Media]` — a whisper number or setup reported by media and not corroborated by a record. It stays `[媒体]` until a record confirms it.

`[测算]`, `[推断]`, and `[媒体]` are never optional — a reader cannot otherwise tell our scenario from the Street's estimate. **One tag style per document**: the Chinese forms in a Chinese preview, the English aliases in an English one, never mixed. The literal string is the whole point — `[已披露]`, `[一致预期]`, and `[已测算]` are **not** tags, they are paraphrases, and every downstream check reads them as untagged.

Inline `[n]` markers map to a `## 来源` section. Heading exactly `## 来源` (`## Sources` in an English preview); one entry per marker:

```
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`〔一手|二手〕` is mandatory. Prior filings, transcripts, guidance releases, and database fields sourced from them are `一手`; a `〔二手〕` entry must name what it relays. The count of distinct `[n]` markers must equal the number of entries.

Close with the coverage block — required even when everything was retrieved, because a reader cannot otherwise tell a source that returned nothing from one that never ran:

```
## 覆盖范围与局限
检索于: <YYYY-MM-DD HH:MM TZ>  ·  口径: <公司>(<代码>) FY<YY> Q<N> 中报/季报前瞻

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 一致预期 营收+EPS | 有记录 [n] | <provider> | <date> |
| 一致预期 分部口径 | 检索范围内未发现 | <provider> | <date> |
| 上季度业绩说明会记录 | 有记录 [n] | <publisher> | <date> |
| 期权隐含波动 | 源不可用 | <source, and why> | <date> |

本次未能覆盖: <what failed, and what it would have covered>
数据滞后性: <known lag for the sources used>
```

The three states are `有记录` / `检索范围内未发现` / `源不可用` (`On record` / `Not found within the search scope` / `Source unavailable` in an English preview). Never render the second as "there is no consensus" — it is a statement about our search, not about the world. Where consensus exists only for revenue and EPS, leave the segment rows of the estimates table blank and account for them here.

## Important Notes

- Consensus estimates change — always name the provider and the retrieval time (`检索于 2026-07-24 16:00 收盘` for a pre-earnings snapshot)
- "Whisper numbers" from buy-side surveys are often more relevant than published consensus, and are `[媒体]` unless a named provider publishes them
- Historical earnings reactions help calibrate expectations (search for "[company] earnings reaction history")
- Options-implied move tells you what the market expects — compare to your scenarios
