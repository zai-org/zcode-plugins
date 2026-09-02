---
name: prospect-screen
description: Turn a corporate-banking coverage mandate into an executed, reproducible prospect screen — by region, industry, 资质标签, 上榜榜单, or listed status — and return a ranked shortlist with the reason each name is on it. Triggers on "筛选目标客户", "找新客", "拓客名单", "对公获客名单", "帮我筛一批企业", "prospect screen", "目标客户清单".
---

# Prospect Screen

A screen is only as good as the filters that actually ran. This skill turns the user's words into a 天眼查 query, executes it, and then reports the gap between what was asked and what the engine enforced — because 天眼查 screens on few dimensions (region+行业, 资质标签, 榜单, 上市), and most finer criteria the user names become post-filtering or get dropped.

## Workflow

### Step 0: If the screening engine is unavailable, the deliverable changes name

`search_companies_by_industry_region` **is** the universe here. There is no second
MCP source for non-listed companies by 行业+地区, so when 天眼查 cannot be reached
the screen has no engine and web search does not substitute for one: it returns
whatever a few queries surface, in no defined universe, with no way to state what
fraction of the territory was seen.

That is still useful — but it is a different deliverable, and calling it the same
thing is the error. When the engine is unavailable:

- Name the output **线索列表**, not 目标客户清单, in the title and the file name.
- Say in the header that it is **not an engine screen**: no defined universe, no
  denominator, and therefore **not usable as a coverage or penetration statistic**.
- Record `源不可用` against the screening engine in the coverage block, naming the
  conditions it would have enforced (行业+地区 切分, 登记状态 default, paging cap).
- Keep every name's provenance as retrieved — a 线索 from news is `[媒体]` and does
  not become `[披露]` because it appears on a list.

Do not silently produce a shorter 目标客户清单. A banker reading "苏州半导体设备零部件
目标客户清单" reasonably assumes the territory was enumerated; a list assembled from
web search has not enumerated anything, and that gap between the title and the
method is what makes the number misleading rather than merely incomplete.

### Step 1: Pin the mandate

Confirm, asking once and only where genuinely ambiguous: the coverage territory (行政区), the industry (国标行业), whether a 资质标签 (专精特新/高新/单项冠军…) or an 上榜榜单 is the entry point, whether only listed names matter, the hard criteria vs the nice-to-haves, the intended list size, and the purpose (新客拓展 / 存量挖潜 / 产业链批量获客 / 招商). Purpose changes the ranking, so it belongs in the header.

State the mandate back in one line before running anything.

### Step 2: Map the words to a 天眼查 entry point

天眼查 takes a **natural-language query**, not a dictionary code — there is no `list_dict` step. Pick the entry point that matches the mandate's primary cut, and name it:

| The mandate's primary cut | 天眼查 entry point | Feeds |
|---|---|---|
| 地区 + 行业 | `search_companies_by_industry_region` (query = "上海 半导体 企业") | the registry-level universe, incl. **non-listed** companies |
| 资质标签 (专精特新/高新/单项冠军…) | `search_companies_by_tag` | companies carrying that tag |
| 上榜榜单 | `search_companies_by_ranking` | companies on that ranking |
| 仅上市公司 | `search_listed_companies` | listed universe only |

Most mandates are region+行业, so `search_companies_by_industry_region` is the default engine. Record every finer criterion the user named that is **not** a 天眼查 filter (see Step 4): 划型, 评分等级, 注册资本区间, 成立时间区间, 融资轮次, 园区/集群归属, 核心企业角色, 风险项 include/exclude. These are either post-filtered from returned rows, enriched per-company from `get_company_basic_profile`, or dropped — and Step 4 has to say which.

**「产业链批量获客」is a different entry point, not a filter.** There is no upstream/downstream classification field to screen on, and asking for one is the wrong shape. What the mandate actually means in corporate banking is *anchor-and-chain*: name the 核心企业, pull its disclosed trading counterparties with `tianyancha.get_suppliers_and_customers`, and screen **that** list. So when the purpose is 产业链批量获客:

1. Confirm the 核心企业 (one or a few named anchors) — without an anchor there is no chain to work along.
2. Pull each anchor's suppliers and customers; these are `[披露]` edges, not an inferred chain position.
3. Enrich and rank those names by the same criteria as any other screen (划型, 资质, 区域), and state which of them fall inside the coverage territory and which do not.
4. Say the cap you used (`page`/`size`) — a capped counterparty list is not the anchor's full chain, and the note says so.

State plainly that this covers **disclosed trading relationships only**: a firm in the same value chain with no disclosed link to the anchor will not appear.

### Step 3: Execute

Run the chosen entry point with `page` / `size` (upstream caps `size` at 20; the response's `total` / `fetched` say what was left behind). Defaults:

- Default to 存续/在业 names and say that you did — the registry carries a 登记状态 field, so filter on it explicitly; a screen that silently includes 注销 entities is a different screen.
- If the result count is implausibly large or empty, widen or narrow **one** dimension at a time (the region, the 行业 phrasing, or swap to a tag/listed cut) and report the iteration, so the executed screen stays reproducible.

What `search_companies_by_industry_region` returns per row: 名称, 统一社会信用代码, 登记状态, 法定代表人, 注册资本, 成立日期, 企业类型. Deeper attributes a screen usually wants — 划型/规模, 资质标签, 上市/发债, 融资状态, 园区归属, contact-channel-existence flags — are **not** in the list row; they come from `get_company_basic_profile` run per shortlisted name. That is enrichment, not a filter, and it is too expensive to run on every row of a 500-row list — enrich only the finalists.

### Step 4: The enforcement audit — the part that cannot be skipped

Before ranking anything, write out two lists:

1. **引擎实际执行的条件** — the entry point and the query as executed, in plain Chinese, plus the 登记状态 default and the paging cap. This is short, because 天眼查 enforces very little: region+行业, or tag, or ranking, or listed.
2. **未能执行的条件** — every requested condition the engine could not enforce, one line each, each saying what was done instead: dropped, enriched per-company from `get_company_basic_profile`, or hand-filtered from the returned rows. Because the 天眼查 cut is coarse, this list is usually longer than the first — that is the honest shape of a 天眼查 screen, and a reader who does not see it over-trusts the list. Never merge these into a single sentence and never let one disappear because the list "basically" matches.

A condition hand-filtered after retrieval is not an executed filter; label it as post-filtering and give the rule used (e.g. "注册资本 ≥ 5000 万元, from the returned 注册资本 field").

### Step 5: Rank, cap, and give each name a reason

Rank only on fields actually retrieved — for the list rows that is 注册资本, 成立年限, 企业类型, 登记状态; for enriched finalists add 划型, 资质标签, 上市/发债, 园区归属. Any composite score you build is `[测算]` and states its weights inline; there is no vendor-provided prospect score to borrow.

Cap the shortlist (~30 rows in Markdown, ~200 in a workbook) and say what the cap was and how many rows the engine returned in total. "Top 30 of 412 returned" is honest; "412 companies found" with 30 shown is not.

Every row carries a 入选理由 that points at the filter or field that put it there. A row you cannot justify does not belong on the list.

### Step 6: Output

Deliver as Markdown for a shortlist read in-session; route a target list intended for distribution through `xlsx-author` (state the choice in one clause). Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。 That workbook is `xlsx-author`'s **Class B** case — many retrieved rows, few formulas — so its provenance vehicle is the `来源` worksheet plus a `来源编号` column on every data sheet, not a comment per cell, and the `口径与局限` block on the `来源` sheet carries the coverage states. A roster delivered without those has no provenance at all.

```
**对公目标客户筛选 — [执行口径一句话]**（检索于 [date]）
委托用途: [新客拓展 / 产业链批量获客 / 招商 …]  ·  引擎: 天眼查 search_companies_by_industry_region

| # | 企业名称 | 统一社会信用代码 | 地区 | 行业 | 企业类型 | 注册资本(万元) | 成立 | 登记状态 | [enriched: 划型/资质/上市/园区] | 入选理由 | 源 [n] |
|---|---|---|---|---|---|---|---|---|---|---|---|

## 覆盖范围与局限
检索于 [date]  ·  引擎: 天眼查 `search_companies_by_industry_region`  ·  返回 [N] 家,展示前 [M] 家  ·  深度字段(划型/资质/上市/园区)仅对前 [K] 家 finalists 取自 `get_company_basic_profile`

引擎实际执行的条件: [逐项列出 — 入口工具、query 原文、登记状态默认、分页上限]
未能由数据源执行的条件: [逐条一行,说明是丢弃、检索后人工过滤、还是逐家用 get_company_basic_profile 富集;天眼查切分较粗,此列通常较长 — 不合并]
检索后人工过滤: [如有,写明过滤规则;人工过滤不等于引擎执行]
源不可用: [本次调用失败的工具/字段,以及它们本应覆盖的条件。以返回体的 `_coverage.status` 为准,只有它写 `源不可用` 时才算。引擎不支持的条件不写在这里,写在上面两行:天眼查引擎只按 industry/region/tag 切分,发债、评分、风险的 exclude 语义都无引擎参数,但数据按公司可取(get_bonds / get_ipr_score / get_risk_overview、风险标签见基础画像 `标签`),属检索后过滤或逐家富集;若为产业链批量获客,写明锚点企业与上下游名单的截断上限]

本清单为 [date] 时点快照,工商登记、资质与融资状态均会变动。
"检索范围内未发现符合条件的企业"仅指上述引擎在该口径下无返回,不等于该类企业不存在。
本清单不构成对任何企业的授信、准入或风险结论;涉及授信的名字请转 `vet-companies`。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

Provenance: registry fields returned by 天眼查 (名称、统一社会信用代码、地区、行业、注册资本、成立时间、企业类型、登记状态) are `[披露]`; enriched fields from `get_company_basic_profile` (划型、资质标签、上市/发债、园区归属、contact-existence flags) are likewise `[披露]`; any share, density, or composite rank you computed is `[测算]`; a fit judgement ("适配供应链金融") is `[推断]`. A database query with no publication date carries `检索于 [date]` alone. `〔一手|二手〕` is mandatory on every entry, a `二手` entry names what it relays, and the count of distinct `[n]` markers equals the number of entries.

### Step 7: Hand off

Offer, do not auto-run: `park-cluster-map` if the mandate was really about a territory, `opportunity-scan` over the shortlist for a reason to call now, `client-portrait` on the finalists, and `vet-companies` before any name moves toward credit. This screen is a marketing list; it clears nobody.
