---
name: client-portrait
description: Assemble one company for a coverage conversation — registry basics, supply-chain and equity relationships, recent opportunity signals and news — ending with what to ask the client and a hand-off to vet-companies for anything credit-bound. Triggers on "企业画像", "客户画像", "拜访前给我看看这家", "这家公司是做什么的", "全景画像", "client portrait", "见客户前的准备".
---

# Client Portrait

Everything an RM needs to walk into the room, and nothing that pretends to be a credit view. The portrait ends with questions and a hand-off, never with a verdict.

## Workflow

### Step 1: Resolve the entity

天眼查 `tianyancha.search_companies` (or `tianyancha.search_companies_by_industry_region` when only a region+行业 hint is given) to anchor the exact legal entity and take its **full legal name**. Group vs listed vehicle vs operating subsidiary are different companies with different bankers and different balance sheets.

If several entities match, list them with region, 成立时间 and 企业类型 and ask which one. Do not proceed on a guess, and do not merge two matches into one portrait.

### Step 2: 登记与基础画像

天眼查 `tianyancha.get_company_basic_profile` (with that name as `company`) returns the portrait. Report only fields the tool actually returned: 名称, 统一社会信用代码 where exposed, 地区, 行业 (国标), 企业类型, 成立时间, 注册资本(万元), 登记状态, 规模/划型, 曾用名, 资质标签, 上市市场, 园区与地址(登记地址及园区, where on the record), and contact-channel-existence flags (电话/邮箱/网址/地址 presence — flags only).

A field the record does not carry stays `n.d.（未披露）`. Never fill a registry field from memory. Contact completeness is a flag that a channel exists — this skill emits no phone number, no email, and no personal data.

**Scores exist, but not as letter grades.** There is no 综合评分等级 (A–E) or 科创评分等级 (S–E) source here, so never print one. What is available per company is `get_ipr_score`, which returns **component scores** (研发能力评分, 创新能力评分, 成长能力评分, 行业潜力评分) alongside patent and software-copyright counts, and `get_credit_evaluation`, which returns 税务评级 and 企业信用评级. Report the fields the call actually returned, each with its own name, and do **not** roll them into a letter grade the source never issued. `源不可用` belongs here only when the call itself failed — the response's own `_coverage.status` says which of the three it was, so read it rather than inferring from an empty list. An empty result carries `检索范围内未发现`, which is a finding about this company, not a missing source.

### Step 2.5: 决策链 — 谁是这次拜访的对接口

天眼查 `get_company_people` returns 姓名 + 职务, aggregating 主要人员 / 上市公司董监高 / 核心团队. On a listed subject this typically comes back as a dozen-odd rows spanning 董事长, 总经理, 财务负责人, 董事会秘书 and 副总经理.

**This is the step that makes the portrait answer the plugin's own question.** A brief that profiles the company but names nobody leaves the caller with no entry point.

- **Report 姓名 + 职务 only.** That pairing is a disclosed registry and filing fact, not personal data — it is what a public company's 董监高 disclosure and the 工商登记 already publish. The privacy boundary from Step 2 is unchanged: **no phone, no email, no personal identifiers, no non-work information about any individual.**
- **Lead with the roles a corporate banker actually calls**: 法定代表人, 董事长, 总经理, **财务负责人**, **董事会秘书**. The finance and IR roles are the working contacts for a credit or cash-management conversation; the chairman usually is not.
- **Personnel data lags.** 工商登记 and 董监高 disclosure both update after the fact, so a名字 here may already have moved on. Stamp `检索于` and treat any name as "as recorded", never as confirmed-current. Where a role is not on the record, `n.d.（未披露）` — do not infer who holds it.
- One person appearing in several roles (`董事长；总经理`) is reported as returned, not split.

### Step 3: 产业链定位

**No structured source** for the chain *node* a company occupies (上游/中游/下游 — there
is no upstream/downstream classification field to read or screen on) or the local
government's plan for that node. Its **neighbours are a different matter and do have a
source**: Step 4 pulls named suppliers and customers from 天眼查
`get_suppliers_and_customers`, so do not report the neighbours as unavailable here —
that understates coverage in the direction that reads as clearance. Options for the
node itself, each labelled honestly:

- Infer the node from the company's 国标行业 + the user's / your own knowledge of the chain, and label it `[推断]` with the reasoning — never present it as a database fact.
- Pull a published plan — **`finance-search.finance_search` first** (`weight=4` 取发布机构原文,`weight=2` 取解读), web search as the fallback (政府产业规划/园区 notice), capture publisher, date, URL, and cite it `[披露]` if primary, `二手` if relayed.

Where neither is available, state `源不可用` **for the node and the plan** rather than
guessing a node — never for the supplier/customer list, which Step 4 either retrieved
or reports as failed on its own terms.

### Step 4: 关系网 — where the next three clients are

天眼查's supply-chain and equity dimensions each have their own tool — call the one you need: `tianyancha.get_suppliers_and_customers`, `tianyancha.get_shareholder_info`, `tianyancha.get_relation_graph`, `tianyancha.get_company_group_profile`. Pass the company's full legal name as `company`, and `page` / `size` on list tools (upstream caps `size` at 20). Where the name could resolve to several entities, anchor it first with `tianyancha.search_companies`. **Each new subject the map uncovers is its own subject** — a `检索范围内未发现` on the anchor says nothing about its controller or group members.

The dimensions that map to this skill:

| Dimension | 天眼查 tool (dynamic; verbatim name from capabilities) |
|---|---|
| 供应链-供应商 / 客户 | `get_suppliers_and_customers` |
| 集团 / 关联方 / 兄弟公司 | `get_company_group_profile` |
| 股权关系图 | `get_relation_graph` |

State the cap you used (page/size), because a capped graph is not a complete graph. Report each dimension separately with its data vintage, and say what each one is worth commercially — 上下游 for 供应链金融 and batch acquisition, 兄弟公司 and 对外投资 for group-account and cash-management coverage, 股东 for the sponsor relationship. Those commercial reads are `[推断]`; the edges themselves are `[披露]`.

This is a **one-hop marketing map**. It is not ownership penetration and not related-party analysis — `related-party-map` in `vet-companies` does that, with the depth a credit file needs.

### Step 5: 近期动态

There is **no clock tool** — take today's date from the session context or the user. Set an explicit `[start_date]` / `[end_date]` (default trailing 3 months, stated).

- **万得 `wind-docs.get_company_announcements`** (no date parameters (only `query` / `top_k`) — put the window in the `query` text and filter after retrieval) — the issuer's own announcements and regulatory filings, for listed or bond-issuing names. The only source here that can make a signal `[披露]`.
- **万得 `wind-docs.get_financial_news`** — media and business-opportunity reporting over the same window.
- For a non-listed subject with no公告 feed, news is the only channel — say so.

Signals traced to a filing or official notice are `[披露]`; news-only items are `[媒体]` and stay `[媒体]`. Grade the two or three that matter with 🔴 高 / 🟡 中 / ⚪ 低·信息 by whether the RM should act now, track, or just know — grading the signal, never the company.

### Step 6: Output

Short pre-meeting brief: Markdown. A full portrait for circulation: PDF via `report-render`. State the choice in one clause. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

```
**企业画像 — [公司全称]**（检索于 [date]）
用途: 对公客户拜访准备(营销用途,非尽调)  ·  统一社会信用代码: [code | n.d.（未披露）]

**一、登记与基础**
| 字段 | 值 | 源 [n] |
|---|---|---|
| 地区 / 行业(国标) / 企业类型 |  |  |
| 成立时间 / 注册资本(万元) / 登记状态 |  |  |
| 划型 / 曾用名 / 资质标签 |  |  |
| 上市市场 / 园区与地址 |  |  |
| 评分(分项) | 研发/创新/成长/行业潜力 各自得分 [n];无 A–E / S–E 等级 | 天眼查 get_ipr_score |
| 联系渠道完备度 | 有无电话/邮箱/网址/地址(仅标记,不输出内容) |  |

**二、决策链**（检索于 [date];姓名+职务,不含联系方式）
| 职务 | 姓名 | 说明 | 源 [n] |
|---|---|---|---|
| 法定代表人 / 董事长 / 总经理 |  | [披露] |  |
| 财务负责人 / 董事会秘书 |  | 对公业务的实际对接口 [披露] |  |
| 其他主要人员 | [n] 人,见附表 | [披露] |  |
人员数据滞后于实际变动,以上为登记与公告口径的「截至检索时记录」。

**三、产业链定位**
所处节点: [n] [推断](无上下游分类字段可筛,据国标行业与链条知识推断)　上下游名单: 供应商 [n] 家 / 客户 [n] 家 [披露](天眼查 `get_suppliers_and_customers`,上限 [size])　地方规划契合度: [n] [披露]/[推断]/源不可用

**四、关系网(一跳,每维度上限 [size] 条)**
| 关系维度 | 对手方 | 数据时点 | 营销含义 | 源 [n] |
|---|---|---|---|---|
| 供应链-供应商 / 客户 (get_suppliers_and_customers) |  |  | [推断] |  |
| 集团/关联方 (get_company_group_profile) |  |  | [推断] |  |
| 股权关系图 (get_relation_graph) |  |  | [推断] |  |

**五、近期动态**（窗口 [start_date] 至 [end_date]）
| 级别 | 信号 | 信号日期 | 依据 | 源 [n] |
|---|---|---|---|---|
| 🔴 高 / 🟡 中 / ⚪ 低·信息 |  |  | [披露]/[媒体] |  |

**六、交接:建议提问与下一步**
建议向客户求证: [3–5 条,每条对应上面一处记录空白、时点存疑或需客户确认的事实]
本画像未回答的问题: [记录未覆盖、只能由客户或尽调解答的部分]
下一步: 涉及授信、准入或风险判断的,转 `vet-companies` — `risk-scan`(失信/涉诉/处罚/质押/担保快筛)、
`related-party-map`(股权穿透与关联方)、`dd-report`(完整尽调)。
本画像为营销准备材料,不构成、也不隐含对该企业的授信、准入、合规或信用结论;
其中任何内容都不表示该企业已通过审查。

## 覆盖范围与局限
检索于 [date]  ·  口径/委托用途: 对公营销拜访准备  ·  关系图深度: 一跳,每维度上限 [N] 条

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 工商与画像字段 | 有记录 [n] / 检索范围内未发现 / 源不可用 | 天眼查 get_company_basic_profile | [date] |
| 评分(分项) | 研发/创新/成长/行业潜力 各自得分 [n] / 检索范围内未发现 / 源不可用(调用失败) | 天眼查 企业科创分(分项得分) | [date] |
| 产业链节点 |  | 引擎无上下游分类字段可筛(仅行业/地区/标签),故 [推断] / web 取规划文本;上下游名单另见关系网一行 | [date] |
| 地方产业规划 |  | web / 源不可用 | [date] |
| 供应链关系 |  | 天眼查 get_suppliers_and_customers (动态工具) | [date] |
| 集团/关联方 |  | 天眼查 get_company_group_profile (动态工具) | [date] |
| 股权关系图 |  | 天眼查 get_relation_graph (动态工具) | [date] |
| 公告 |  | 万得 wind-docs.get_company_announcements | [date] |
| 舆情 |  | 万得 wind-docs.get_financial_news | [date] |

本次未能覆盖: [失败或不适用的源(如非上市主体无公告),以及它们本应覆盖的内容]
数据滞后性: [工商变更公示、供应链/关系数据时点、事件采集与新闻收录的已知滞后]
未覆盖数据类别: 本插件无 CRM、无行内客户与账户数据、无钱包份额或收入数据、无个人联系信息。
"检索范围内未发现"仅指上述源在本次范围内无记录,不等于不存在;本画像亦未检索风险记录。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

`〔一手|二手〕` is mandatory on every entry; a registry field or an announcement is `一手`, a media item is `二手` and names what it relays; a live query with no publication date carries `检索于 [date]` alone; the count of distinct `[n]` markers equals the number of entries.

### Step 7: The line this skill does not cross

If the user asks whether the company is creditworthy, safe, clean, approved, or worth lending to — stop. Say that this portrait was assembled for coverage, that it did not run risk-record checks, and route to `vet-companies`. Do not answer the question from portrait data, and do not soften it into an implied answer.
