---
name: park-cluster-map
description: Map the enterprise population of a territory rather than a company — an administrative region (and, loosely, a 园区 or 产业集群), with counts, 划型 distribution, 资质 density, and listed or bond-issuing presence, for a branch planning coverage or a 招商 team. Triggers on "园区企业分布", "产业集群有哪些企业", "这个区的企业画像", "支行片区摸底", "招商地图", "park map", "cluster map".
---

# Park / Cluster / Region Map

The unit of analysis is a place, not a company. The deliverable answers: how many enterprises sit here, of what size, how dense is the bankable layer, and what is the local government pushing.

**A concept worth keeping, honestly re-scoped.** A 园区 (a delimited property), a 产业集群 (a recognised cluster of firms in a chain), and an 行政区 (an administrative region) are different units. The limit is the **screening engine, not the data**: `search_companies_by_industry_region` accepts only `industry` (GB/T 4754) and `region` (areaCode), and `search_companies_by_tag` only a tag — there is no park parameter, so 天眼查 cannot answer "张江园区里有哪些企业" as a structured filter, and there is no cluster roster to enumerate a chain. Verified 2026-08-17 against the tool schemas. What it *can* do is screen by **行政区 + 行业**, which is broader than a park boundary and not the same as cluster membership, but covers the same prospects and is the workable cut. State this re-scope in the output header: a region+行业 map stands in for a park/cluster map, and the boundary is the administrative region, not the park fence.

**Park membership is readable per company, just not screenable.** `get_company_basic_profile` carries an `所在园区` section, so once a name is in hand its park can be looked up and reported. It can also come back `空结果：未发现该维度记录`, which is `检索范围内未发现` — the dimension was queried and held nothing for that subject. **That is not `源不可用`**, and the two must not be merged: one says the source has no record, the other says the source was never reached.

## Workflow

### Step 1: Resolve the territory

- **行政区** — the primary, structured cut. Take the region name into a 天眼查 `search_companies_by_industry_region` query (with the 行业).
- **园区 / 集群** — there is **no precise park/cluster resolution**. Take the park or cluster name, find the 行政区 it sits in (from the user or web search), and screen by that region + the relevant 行业. Note explicitly that this is a region-bounded proxy, not the park roster: it includes firms in the same district but outside the park, and may miss firms registered elsewhere but operating in the park.

If several regions could hold the named park, list them and confirm which one the user means. Silently taking the first match produces a map of the wrong place.

### Step 2: Declare the address basis before you count — and what is not available

天眼查 carries the **registered** address on the record and offers no operating-address alternative, so every count here is a **registered-address** count. State that in the header, and note the known bias: registered-address counts inflate with shell and holding registrations; operating-on-site firms registered elsewhere are missed. There is no second basis, so there is no delta to report — say that rather than implying one.

### Step 3: Pull the population and cut it

天眼查 `tianyancha.search_companies_by_industry_region` (`query` = 行政区 + 行业, plus `industry` / `region` to收窄), paginated with `page` / `size` (上限 20). **登记状态不是引擎参数** —— 存续/在业 只能取回后自筛,所以那是检索后过滤而不是引擎切分,输出里按此标注。The returned `total` is the base count; `total=5000` 是上游封顶值而非真实命中数,出现时收窄条件。

Then cut the population. 天眼查 exposes very few of these as engine filters, so most cuts are **assembled** by running a different entry point over the same region, or by enriching a sample per-company — be explicit about which:

| Cut | How it is obtained | Honest label |
|---|---|---|
| 规模结构(大/中/小/微) | per-company `get_company_basic_profile` on a sample; not an engine filter | 抽样富集,非引擎切分 |
| 行业构成 | re-run `search_companies_by_industry_region` per sub-行业 | 引擎切分 |
| 资质密度(高新/专精特新/单项冠军…) | `search_companies_by_tag` per tag, same region | 引擎切分 |
| 上榜榜单密度 | `search_companies_by_ranking`, same region | 引擎切分 |
| 资本市场存在(A股/港股/新三板/发债) | `search_listed_companies` for listed; 发债 per-company via `get_bonds` | 引擎切分(listed)/ 抽样富集(发债) |
| 综合评分/科创评分分层 | 无 A–E / S–E 等级源;`get_ipr_score` 给**分项评分**(研发能力/创新能力/成长能力/行业潜力),`get_credit_evaluation` 给税务评级与企业信用评级 | 抽样富集,非引擎切分 |
| 年龄与体量(成立年限/注册资本 bands) | post-filter from returned rows | 检索后人工过滤 |
| 可触达性(电话/邮箱/网址/地址 existence) | per-company `get_company_basic_profile` flags on a sample | 抽样富集,非引擎切分 |

Counting discipline: every count is a returned total or a stated sample size, never a hand-tally of displayed rows. Shares and densities are `[测算]` and state the denominator and the basis (engine cut vs sample). Reconcile the buckets against the base — where tags overlap (a company can hold several 资质) or rows are unclassified, the buckets will not sum to the base, and the note says so rather than forcing them to tie.

### Step 4: Policy context

Pull the published 产业规划 / 园区 notice — **`finance-search.finance_search` first** (`weight=4` for the issuing body's own file, `weight=2` for coverage of it), web search as the fallback — capture publisher, date, URL, and cite `[披露]` (primary) or `二手` (relayed). A published plan is `[披露]`; the read-across from a plan to a coverage priority is `[推断]`. Where the 行业 cut makes the local population's position in a value chain worth a sentence, say it as prose labelled `[推断]` — it is a read of the industry mix, not a retrieved attribute, so it never becomes a row in the counts table.

### Step 5: Where the bankable density is

Name two or three coverage priorities, each as a hypothesis labelled `[推断]` with the counts that triggered it — a 资质 cluster with no listed names, a sub-行业 dense in 中型 firms, a segment the plan targets but the population does not yet cover. Do not rank the companies here; that is `prospect-screen`.

**Anchor-and-chain, where the territory has an anchor.** A region map gets more actionable when the local 龙头 is traced outward: pick the one or two anchors the counts surface (listed, 上榜, or the largest 资质 holders), and pull their disclosed counterparties with `tianyancha.get_suppliers_and_customers`. Those edges are `[披露]` and show where the territory's bankable flow actually runs — which upstream suppliers and downstream customers sit inside the region (immediate coverage targets, and 供应链金融 candidates against the anchor) and which sit outside it (out-of-territory, hand to the owning branch). Cap it per anchor, state the cap, and never present a capped counterparty list as the anchor's whole chain. Do this for anchors only, not for the population — it is a per-company call, not an engine cut.

### Step 6: Output

Short-form territory read: Markdown. A full territory study: PDF via `report-render`. The enterprise roster behind the counts: `.xlsx` via `xlsx-author`. State the choice in one clause. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。 That workbook is `xlsx-author`'s **Class B** case — many retrieved rows, few formulas — so its provenance vehicle is the `来源` worksheet plus a `来源编号` column on every data sheet, not a comment per cell, and the `口径与局限` block on the `来源` sheet carries the coverage states. A roster delivered without those has no provenance at all.

```
**[园区/集群/行政区名称] 企业分布图谱**（检索于 [date]）
territory: [resolved entity name]  ·  切分: 行政区 + 行业(引擎无园区/集群筛选参数,以行政区为边界 — 见局限)
地址口径: 注册地址(基础画像不返回经营地址,实测 2026-08-17)  ·  企业总数(存续/在业): [N] 家 [披露] [n]

| 维度 | 分组 | 家数 | 占比 | 切分方式 | 源 [n] |
|---|---|---|---|---|---|
| 划型 | 大/中/小/微型 |  | [测算] | 抽样富集 |  |
| 行业构成 | 各 sub-行业 |  | [测算] | 引擎切分 |  |
| 资质 | 高新/专精特新/单项冠军… |  | [测算] | 引擎切分(tag) |  |
| 资本市场 | A股/港股/新三板 |  | [测算] | 引擎切分 |  |
| 发债 |  |  | [测算] | 抽样富集(`get_bonds`) |  |
| 评分等级 | 研发/创新/成长/行业潜力 分项 |  | [测算] | 抽样富集(`get_ipr_score`) |  |

地方产业规划: [plan / 口号 / 十五五 formulation] [披露]/[推断] [n]
锚点与上下游（若有锚点; 每锚点上限 [size]）: [锚点企业] → 区域内供应商/客户 [N] 家、区域外 [M] 家 [披露] [n]
覆盖优先级: [2–3 条,每条 [推断] 并附触发它的计数]

## 覆盖范围与局限
检索于 [date]  ·  切分: 行政区 + 行业(引擎无园区/集群筛选参数;园区归属按公司可查,不能反查名单)  ·  地址口径: 注册地址  ·  存续状态口径: [默认 存续、在业]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 企业总量 | 有记录([N] 家) [n] / 检索范围内未发现 / 源不可用 | 天眼查 search_companies_by_industry_region | [date] |
| 划型分布 |  | 天眼查 get_company_basic_profile(抽样) |  |
| 行业构成 |  | 天眼查 search_companies_by_industry_region(分行业) |  |
| 资质密度 |  | 天眼查 search_companies_by_tag |  |
| 上市/发债 |  | 天眼查 search_listed_companies / get_bonds(抽样) |  |
| 地方产业规划 |  | web / 源不可用 |  |
| 锚点上下游（供应商/客户） | 有记录([N] 家, 上限 [size]) / 不适用(无锚点) / 源不可用 | 天眼查 供应商与客户（公告披露口径） | [date] |
| 园区精确归属 | 有记录 [n] / 检索范围内未发现(抽样内无园区记录) | 天眼查 get_company_basic_profile `所在园区`(按公司,非引擎切分) | [date] |
| 集群名录(产业链成员枚举) | 检索范围内未获得可引用名录 | 已查:天眼查引擎筛选参数(仅行业/地区/标签)、金融垂搜、web;完整名录须另接数据源 | [date] |

分桶与总数不等的原因: [标签可重叠 / 存在未分类记录 / 部分维度为抽样 — 据实说明,不强行配平]
本次未能覆盖: [失败或未覆盖的工具/维度(园区精确归属、评分分层、发债),以及它们本应揭示的内容]
数据滞后性: [工商变更公示滞后;园区实际入驻与注册地不一致]
本图谱为 [date] 时点快照。"检索范围内未发现"仅指上述源在该口径下无返回,不等于该区域无此类企业。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`〔一手|二手〕` is mandatory on every entry; a `二手` entry names what it relays; a live query with no publication date carries `检索于 [date]` alone; distinct `[n]` markers equal the entry count.

### Step 7: Hand off

Offer: `prospect-screen` to turn a dense segment into a ranked target list, `opportunity-scan` scoped to the territory for what moved recently, `client-portrait` on the anchor names. Nothing here is a credit view — that is `vet-companies`.
