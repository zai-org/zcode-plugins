---
name: risk-scan
description: Fast risk-record screen for one company or a batch — 失信被执行, 终本案件, 限制高消费, 司法涉诉, 行政处罚, 股权质押与冻结, 对外担保, 破产重整与司法拍卖, plus adverse media — with severity ranking. Triggers on "风险排查", "有没有失信", "涉诉情况", "被限高了吗", "有没有破产重整", "黑名单筛查", "risk screen", "批量排查供应商".
---

# Company Risk Scan

The fast screen: disclosed risk records + adverse media, ranked. Use standalone or as Step 5 of `dd-report`.

## Workflow

### Step 1: Scope

One company or a batch list. For batches, run identical checks per company and output one ranked table; note that depth per name is shallower than a full DD. Each name is its own subject on 天眼查 — run the checks per company and never carry one company's verdict over to the next.

### Step 2: Record checks (per company)

Query in this order, recording per check exactly one of `有记录` / `检索范围内未发现` / `源不可用`, plus the source and `检索于` date. These rows become the coverage table in Step 4. A retrieved record is `[披露]`; a ratio you computed from one (质押比例、担保/净资产) is `[测算]`.

天眼查 的每个维度都是 `tools/list` 里的一个工具,直接调:主体传 `company`(**全称**),列表型传 `page` / `size`(上限 20)。名称可能歧义时先用 `tianyancha.search_companies` 锚定,取候选表里的 `name`。

**每个检查的判定读返回体的 `_coverage.status`,不要自己推断。** 三态由服务给出:`有记录` / `检索范围内未发现` / `源不可用`。参数写错会直接报错而不是返回空,所以空结果就真的是「这家公司在这个维度没有记录」。返回体还带 `total` 与 `fetched`,`total > fetched` 时 `_notes` 写明还差多少条 —— **一页不是完整清单**,对 `noExecMoney` 这类要求和的字段尤其致命。

**每个要写进覆盖表的检查都必须真调一次。** `检索范围内未发现` 只能来自一次真实调用的返回 —— 少调一个维度就没有那一行的依据,`tianyancha.get_risk_overview` 的计数替代不了它。

`tianyancha.get_risk_overview` 一次给出 自身 / 周边 / 历史 / 预警 四档,每档拆成若干子档并带 `tag`(高风险/警示)与 `total`。用它**排序**:先看哪些子档条数大、标了高风险,把那几个维度提到前面查。

**但它有两条边界,两条都实测过,越过任一条都会出错:**

- **「总览里没有」不等于「没有记录」。** 总览只覆盖它自己那套子档。实测恒大地产:自身风险 18 个子档里**没有**担保、也没有行政许可,而专项工具返回 对外担保 **39** 条、行政许可 **114** 条。所以覆盖表里每一行的 `检索范围内未发现` 只能来自该维度专项工具的一次真实调用,不能从总览的缺席推出来。
- **总览的条数与专项工具的条数口径不总是一致,报数只报专项工具的。** 实测 8 个维度里 6 个逐值相等(失信 389、被执行 330、裁判文书 1751、行政处罚 4、司法拍卖 6、欠税 2),另 2 个不等:终本 总览 2217 / 工具 **2793**,股权出质 总览 10 / 工具 **46** —— 后者是角色口径不同(总览记的是「本公司股权被出质」,工具记的是本公司作为出质人的登记)。两个数不一致时以专项工具为准,并且不要把两个数并列写进报告。

1. **失信被执行 / 被执行人** — `tianyancha.get_default_event_info`(covers 失信被执行人 与 被执行人 及各自历史, with 执行案号/法院/标的). The single most decisive record; a hit is always `🔴 高`.
2. **终本案件** — `tianyancha.get_terminated_cases` — `caseCode`, `execCourtName`, `caseCreateTime` / `caseFinalTime`, `execMoney`(执行标的), and **`noExecMoney`(未履行金额)**. 终本 means the court closed this round of enforcement having found no executable property, so it is strictly stronger evidence than an open 被执行 record, and 未履行金额 is the balance that went unpaid. Report the record count and the summed `noExecMoney` (`[测算]`, state how many rows the sum covers and whether you paged through all of them — verified on a distressed property issuer: `total` was 2793, so a silent first page of 20 understates by two orders of magnitude; the response's `_notes` names the shortfall). A material 未履行金额 is `🔴 高`.
3. **限制高消费** — `tianyancha.get_high_consumption_restriction`(也覆盖**限制出境**) — `caseCode`, `applicant`, `publishDate` / `caseCreateTime`, `amountInvolved`, and `xname`, the natural person restricted. Read `xname` back and tie it to Step 3 of `dd-report`: it is usually the 法定代表人 or an 实际控制人, which links a company record to a named individual. A live 限高 on the current legal representative is `🔴 高`.
4. **司法涉诉** — `tianyancha.get_case_filing_info`(未结立案) + `tianyancha.get_judicial_documents`(裁判文书;全文用 `tianyancha.get_lawsuit_detail`,吃列表回的 `uuid`) — case counts, roles (原告/被告), amounts and status where exposed. `tianyancha.get_judicial_case` 是**案件级聚合口径**,`total` 通常最大(康得新实测 918 条 vs 裁判文书 8 条)—— 两者数量差不代表漏数,是不同口径,要报就说清用的是哪个。 Repeated 被告 in 借款/买卖合同纠纷 is a credit signal `[推断]`.
5. **行政处罚** — `tianyancha.get_administrative_penalty`(含历史处罚) — regulator, ground, amount, date. Do not substitute `tianyancha.get_administrative_license`, which is 行政许可, not 处罚.
6. **股权质押与冻结** — two different encumbrances, both reported on this row. `tianyancha.get_equity_pledge_info`(工商登记出质,含历史) or `tianyancha.get_stock_pledge_info`(上市主体的股票质押,非上市主体为 `检索范围内未发现`) gives pledge ratio on the company's shares or its holders' stakes; >50% controller pledge is `🟡 中`, near-full pledge `🔴 高`. `tianyancha.get_judicial_assistance` gives **股权冻结** —— 冻结记录归在司法协助这一维度下。字段:`executiveCourt`, `stockExecutedCompany`(被冻结股权所属公司), `equityAmount`, `publicityDate`, 以及 `typeState`(形如 `股权冻结 | 冻结`,也可能是 解除冻结 / 续行冻结)。只要冻结记录传 `only_freeze=true`。 A freeze is a court act on the way to disposal, not a financing choice like a pledge; report the two separately and never merge their counts. An active 冻结 on a material holding is `🔴 高`.
7. **对外担保** — `tianyancha.get_guarantee_info` — `grnt_corp_name`(担保方), `secured_org_name`(被担保方), `grnt_type`(担保方式), `grnt_amt`(担保金额), `grnt_sd` / `grnt_ed`(起止日), `is_fulfillment`(是否履行完毕), `announcement_date`. Two reads that are easy to get wrong and were both observed on the verification run:
   - **Check `grnt_ed` against today before counting anything as outstanding.** The tool returns the historical record, not the live book: on one verification run a distressed issuer's rows all carried 到期日 several years in the past with `is_fulfillment=否`, i.e. already expired as of retrieval. Summing them yields a current exposure that does not exist. State the 到期日 per row and total only what is still live, saying how many rows you excluded as expired.
   - **Check whether 担保方 and 被担保方 are the same entity.** Where they are, the row is the entity's guarantee of its own obligation (typically a bond), not third-party exposure — a different fact, and it does not belong in a 对外担保 total.
   - 担保/净资产 is `[测算]`: state the denominator and its 报告期. 上游把这个端点归在「上市信息」类目下,但它**不限于上市主体** —— 实测对非上市发债主体(恒大地产)返回 39 条,所以不要凭类目名记 `不适用`。
8. **舆情** — 万得 `wind-docs.get_financial_news` (公司名 + 违约/被查/纠纷/爆雷 keywords, trailing 12-24 months; no date parameters (only `query` / `top_k`) — put the window in the `query` text and filter after retrieval). Findings with no corroborating record are `[媒体]` and stay `[媒体]` until a record confirms them.

### Step 2.5: 破产重整与司法拍卖 — dedicated dimensions first, `search_bids` only for what they miss

These are counterparty-risk records that none of the Step 2 checks return, and each has its **own tool**. Use those; keyword-searching the tender tool for them finds less and cannot support a clean `检索范围内未发现`.

1. **破产重整** — `tianyancha.get_bankruptcy_reorganization` — 案号, 申请人, 被申请人, 案件类型 (破产案件 / 破产审查案件), 状态, 提交时间. Verified against a subject that had entered 重整 — it returned multiple records. **Read 申请人 vs 被申请人**: the entity as 被申请人 is its own distress; the entity as 申请人 is it petitioning against someone else, which is a different fact.
2. **司法拍卖** — `tianyancha.get_judicial_auction`(也覆盖**询价评估**,它通常先于拍卖出现) — 拍卖标题, 起拍价, 评估价, 拍卖时间, 处置单位, plus the 拍卖公告 URL. Verified against a distressed property issuer — it returned multiple records. The title states what is being sold; a **债权** auction means someone is selling a claim *against* this entity, which is distress, while an asset auction is its property being disposed of.

两项都要**真调一次**才能填覆盖表 —— 返回体的 `_coverage.status` 是那一行的依据。

**A 破产重整 or 司法拍卖 record on the entity, its controller, or a material guarantor is a 🔴 finding**, graded on the finding, never as a rating of the entity. Every hit is a record, so `[披露]` with the 公告链接 — not `[媒体]`.

`tianyancha.search_bids`(跨公司垂搜;单主体自己的招投标清单是 `tianyancha.get_bidding_info`)still covers what the two tools above do not: **重整投资人招募公告、重整投资人资格、管理人公告、资产处置公告**, and 中标 records. Run it as a supplementary channel with `start` / `end`(YYYY-MM-DD)、`role`(`2` 采购人 / `3` 供应商)、`bid_type`(`4` 中标结果)and the vendor's documented terms (`重整` / `招募` / `竞买` / `投资人资格` / `资产处置`), and record it as its own line in the coverage table — a miss here is `检索范围内未发现` **for that channel**, which is not the same statement as the two dedicated dimensions returning nothing. Distinguish the entity's **role** here too: subject of the 重整/拍卖 versus 竞买人/投资人 buying distressed assets, which is not a red flag by itself. Say which.

### Step 3: Severity

Grade findings, never the entity — this skill issues no rating. Cap the front of the list at three `🔴`.

- `🔴 高`(决策前须澄清): 失信记录、被执行大额、终本案件未履行金额大、现任法定代表人被限高、破产重整/清算、司法拍卖、重大股权冻结、立案调查、控制人近全额质押、违约
- `🟡 中`(记录并跟踪): 多起未决涉诉、高质押、局部或已解除的股权冻结、大额在保担保、近期处罚、密集负面舆情
- `⚪ 低·信息`: 少量历史小额记录、已结案且无后续、已到期的历史担保

### Step 4: Output

Single company — short report with the check-by-check coverage table below. Batch:

```
| 公司 | 结果 | 失信 | 终本·限高 | 涉诉 | 处罚 | 质押·冻结 | 担保 | 破产·拍卖 | 舆情 | 备注 |
|      | 🔴 高/🟡 中/⚪ 低·信息 | ... 每格: 记录数 [n]、未发现、或 源不可用 |
```

Short-form stays Markdown in-session. If the user asked for a file: a batch scan goes to `.xlsx` via `xlsx-author` (the roster is tabular and the reader will filter it — it is that skill's **Class B** case, so the `来源` worksheet plus a `来源编号` column per row carries the provenance, not a comment per cell); a single-subject written scan goes to PDF via the `report-render` skill — never hand-rolled with weasyprint, wkhtmltopdf, pandoc, or a bare reportlab script, because those do not emit `[n]` as PDF link annotations and the citations arrive unclickable. Word is the answer only when the user asks for it or the reader will edit the file — `report-render`'s `DocxReport` builds it with the same calls; unspecified long-form stays PDF (the house formatting policy). **要出 Word 就先载入 `report-render` 技能，再动手建。** `DocxReport` 与 `Report` 同一套调用；手搓 python-docx / docx-js 会丢掉标签配色、`[n]` 跳转与封面页，机制与实测记录在那个技能里，不在这里重述。

Both forms close with:

```
## 覆盖范围与局限
检索于: [timestamp] · 口径/委托用途: [用途,如供应商准入/授信]

| 检查项 | 结论 | 源 | 检索于 |
|---|---|---|---|
| 失信被执行 | 有记录(N 项) [n] / 检索范围内未发现 / 源不可用 | [系统名] | [date] |
| 终本案件 | 有记录(N 项,未履行合计 X) |  |  |
| 限制高消费 | 有记录(N 项,被限高人 …) |  |  |
| 司法涉诉 |  |  |  |
| 行政处罚 |  |  |  |
| 股权质押 |  |  |  |
| 股权冻结 |  |  |  |
| 对外担保 | 有记录(N 项,其中在保 M 项) |  |  |
| 破产重整 |  |  |  |
| 司法拍卖 |  |  |  |
| 招募/资产处置公告 |  |  |  |
| 舆情 |  |  |  |

本次未能覆盖: [本次不可用的源,以及它们本应覆盖的检查项]
数据滞后性: [判决上网、处罚传输、登记公示的已知滞后]
"检索范围内未发现"仅指上述源在本次检索范围内无记录,不构成无风险、无此事或通过的结论。

## 来源
[n] 〔一手|二手〕发布主体 · 文档或系统名 · 日期(发布日; 检索于) · URL
```

For a batch, the coverage table is per-source rather than per-company (the matrix above already carries the per-company detail), and the batch header states that depth per name is shallower than a full DD. A source that failed for only some names says which. Every `[n]` marker maps to exactly one entry — a database query with no publication date carries `检索于 [date]` alone, e.g. `[3] 一手 · 天眼查 · 股权质押登记 · [date](登记); 检索于 [date]`.
