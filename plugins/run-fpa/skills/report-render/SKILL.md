---
name: report-render
description: Build paginated research deliverables (PDF, or DOCX where the reader edits the file) with correct CJK rendering, density-sized charts, clickable [n] citations, and a mandatory render-and-inspect gate. Use when a report, industry primer, earnings update, diligence report, working paper, memo, or any multi-page analyst deliverable must be produced as a file rather than chat text. Triggers on "出一份PDF", "导出报告", "生成研报", "报告存成文件", "导出Word", "存成docx", "给个可编辑版本", "export as PDF", "as a Word document", "build the report", "把报告存到".
---

# Report Render

Builds the file. Everything about turning analysis into a document a
professional would put their name on — page furniture, CJK fonts, figure
sizing, citation links — and then proves it worked by rendering every page.

Use this skill whenever the deliverable is a **file**. For short-form output
that lives in the conversation, Markdown is the right answer and this skill is
not needed.

## Which format

**The house formatting policy decides, not this skill.** The one question that
settles it is what happens to the file next: someone *reads* it as it stands, or
someone *edits* it. A report for circulation, a rated view, a client deliverable
— PDF. A working paper, a memo, a discussion draft, a notes package pending
review — DOCX, because the recipient's next act is to write in it. Short-form
stays Markdown in the conversation. An explicit request always wins.

Both formats are built by the same calls: `Report` writes the PDF, `DocxReport`
writes the DOCX, and every method below exists on both. The two do **not** verify
to the same depth, which is why the switch is a class name rather than a file
extension — see Step 2b.

## Output language — decided before the first heading is written

The document follows **the user's language of address**, not the template's.
A question in Chinese produces a Chinese document; a question in English an
English one. Where the request does not settle it — a bare ticker, a re-run of a
saved command, a scheduled job — use the market profile's `default_locale`, which
for `cn` is `zh-CN`.

**One language per document.** Do not mix a Chinese narrative with English
section headings, or English prose with Chinese table headers. This is the trap
worth naming, because it does not look like an error while you are writing it:
a skill whose template is in one language, answering a request in the other,
half-translates. What survived in observed output was English headings over
Chinese prose, and provenance tags in the template's language rather than the
document's.

So, per document, pick one column and stay in it:

| | Chinese document | English document |
|---|---|---|
| Sources heading | `## 来源` | `## Sources` |
| Coverage heading | `## 覆盖范围与局限` | `## Coverage and Limitations` |
| Source tier | `〔一手〕` / `〔二手〕` | `〔Primary〕` / `〔Secondary〕` |
| Coverage states | `有记录` / `检索范围内未发现` / `源不可用` | `On record` / `Not found within the search scope` / `Source unavailable` |
| Provenance tags | `[披露]` `[测算]` `[预期]` `[推断]` `[媒体]` | `[Reported]` `[Est.]` `[Consensus]` `[Inferred]` `[Media]` |

Tags are the literal strings in that table. A paraphrase — `[已披露]`,
`[一致预期]`, `[已测算]` — is not a tag, and every downstream check reads it as
untagged. Terms of art keep their source language in either document
(口径, 归母, 解禁, 统一社会信用代码 — the language policy).

Authoring prose — this file, the skills, the agent prompts — is English
regardless. That is the repo's authoring convention and says nothing about what
the document emits.

## Where the file goes

Two directories, and the code samples below refer to them by name rather than
hardcoding either — because the one that matters is not the same everywhere.

- **`DELIVER`** — the directory the caller collects deliverables from. Use the path
  the user gave; else the delivery directory this session already establishes (one
  is usually present in the working directory, and it is where uploaded inputs and
  earlier outputs live — **look before guessing**); else the working directory
  itself. Do not assume a fixed name. A report written where the caller does not
  read is the same outcome as no report: the work is done and the deliverable is
  lost, silently, with a confident final message describing a file nobody receives.
- **`BUILD`** — a scaffolding subdirectory you create and then delete (Step 5).
  Charts, the sizing sidecar, QA page renders and the generator script live here,
  never beside the deliverable.

Before finishing, **list `DELIVER` and confirm the file is in it**, then say in one
clause where you put it and why that is the delivery location.

## Why this exists

The knowledge here was reconstructed from scratch, twice, by two earlier report
runs whose architecture was ~80% identical and whose literal shared code was 12
lines of imports. Both hit the same traps. Both left defects the other had
fixed. The traps are in `references/pitfalls.md` and every one of them is a
silent failure — the process that writes the broken file cannot tell.

## Workflow

### Step 1: Charts first, document second

The document build reads a sidecar the chart step writes, so charts always come
first — for either format. One script per stage keeps a failed chart from
producing a half-built file.

```python
import sys; sys.path.insert(0, "<this-skill-dir>/scripts")
from fin_report import charts, theme

fig, ax = charts.new(7.4, 4.0)                       # styled figure: no top/right spines
ax.bar(["2024", "2025E"], [190, 259], color=theme.BLUE)
ax.set_ylabel("市场规模（亿美元）")
charts.save(fig, "c1_market.png", f"{BUILD}/charts")
charts.write_meta(f"{BUILD}/charts")                 # flush the sizing sidecar, once
```

**Do not set an in-canvas chart title** when the figure will appear in the PDF —
the caption is the title. `Report.figure` refuses a caption for a chart that
already has one, because printing the same sentence twice is never intended.
`charts.title()` is for standalone charts.

**`charts.source()` follows the same rule, and for the same reason.** A figure
going into the PDF states its source **once, in the note line** — so pass it to
`rep.figure(..., note=...)` and do **not** call `charts.source()` on that figure.
`charts.source()` exists for a chart delivered on its own, with no note line to
carry the attribution. Calling both prints 资料来源 twice under one exhibit: once
baked into the PNG where it cannot be selected, corrected, or made clickable, and
once as real text. Tables follow it too — the source is the note beneath the
table, never a final row inside it and never a 来源 column
(the house formatting policy).

**`charts.save` refuses a figure that prints text over text.** It measures every
rendered text box — axis titles, chart titles, tick labels, legend entries, data
labels — and raises naming the pair and the overlap. A shared x-axis drawn twice by
`twinx` is not a collision and is excused; two labels a point apart is.

Where it can fix the figure itself it does: a panel-spacing shortfall gets one
`tight_layout()` pass, because that is a computation the author never had to make.
What it cannot fix is an authoring choice, and there are two common ones:

```python
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(7.4, 3.4))
ax1.twinx().set_ylabel("归母净利润（亿元）")   # sits in the gutter, right of ax1
ax2.set_ylabel("市盈率（倍）")                 # sits in the gutter, left of ax2
```

A **twin y-axis beside another panel** puts two axis titles in one gutter — widen
the figure or the panel gap, or shorten a title. And **two series' data labels on
the same points** overprint into one wrong-looking number: label one series, not
both. `charts.save(..., allow_overlap=True)` records the overlap in the sidecar
instead of raising, for the rare case where it is genuinely intended.

### Step 2: Build the document

```python
from fin_report import Report

rep = Report(
    f"{DELIVER}/中国GPU芯片产业行业分析报告.pdf",
    "中国 GPU 芯片产业行业分析报告",
    subtitle="国产替代浪潮下的算力自主",
    header_right="行业深度 · 2026年7月",
    footer_note="数据截至 2026-07-25。供人工审阅的分析师底稿，不构成投资建议。",
    charts_dir=f"{BUILD}/charts",
)

n1 = rep.refs.cite("IDC", "《中国人工智能计算力发展评估报告 2025》",
                   tier="一手", published="2025-03-31", retrieved="2026-07-25",
                   url="https://…")
n2 = rep.refs.cite("某财经媒体", "关于行业规模的报道", tier="二手",
                   relays="弗若斯特沙利文《AI芯片市场预测》",
                   published="2026-05-12", retrieved="2026-07-25", url="https://…")

rep.cover(meta_lines=["行业深度 · Sector Overview", "检索于：2026-07-25"],
          kpis=[("259", "2025E 算力市场\n(亿美元)"), ("41%", "2025 国产出货份额")])
rep.legend()                    # 位置由 build() 决定，不受调用点影响；见下rep.h1("执行摘要")
rep.p(f"2025 年市场规模预计达 259 亿美元{rep.chip('披露')}{n1}；"
      f"2026 年增速为本文测算{rep.chip('测算')}。")
rep.p(f"Q2 单季毛利率{rep.tagged('23.15%', '披露')}，"
      f"环比{rep.tagged('-1.67pct', '测算')}{n1}。")   # 跨类别的一句：各带各的
rep.callout("核心判断", ["需求侧刚性" + n1, "格局:国产份额首破 40%" + n1])
rep.h1("一、市场概览")
rep.figure("c1_market.png", "图1  中国人工智能算力市场规模（IDC 口径）",
           note=f"资料来源：IDC，2025-03。单位：亿美元。{n1}")   # source here, not in the PNG
rep.table(rows, caption="表1  主要厂商对比", note=f"注：口径不一，以最新披露为准。{n1}",
          col_widths=[3, 2, 2, 2], align_center=(1, 4))   # 相对比例即可，会归一到文本列宽
rep.sources(preamble="以下来源按正文标注序号排列。",
            disclaimer="免责声明：……")
rep.build()
```

**`rep.cover()` 的默认答案是"调"，例外由拥有交付物的那个 skill 说。** 研究交付物——
深度报告、行业研究、业绩点评、信用报告、尽调报告——都有封面，不要因为某一篇短就省掉。
唯一明确开篇即正文的是 `write-research` 的 `morning-note`：晨会纪要一页，给它一张标题页
就是三分之一的篇幅花在家具上。别的 skill 想这么做，得先在它自己的 SKILL.md 里写明，
不能拿"篇幅短"当理由。不调 `cover()` 时标题并不会丢——每一页的页眉都在印它。

**这里真正修掉的不是"封面可选"，是背景与正文不匹配。** reportlab 从**注册的第一个页面
模板**开始排版，而唯一会切到 `main` 的调用就是 `cover()`。于是 2026-08-26 那份晨会纪要的
第 1–2 页顶着封面的 66mm 深蓝带和 42mm 灰脚排正文，没有页眉页脚页码，直到 `sources()`
才切回来——`表1 池内六标的` 的标题是 `NAVY` 色，正好落在 `NAVY` 色带里，**整条看不见**。
模板注册顺序现在按"有没有封面"决定，`verify()` 也会拒收"有编号标题或表n/图n、却没有页码"
的页面。**不要反过来手搓一个标题块**去补那个位置：那次运行里模型伸手调了不存在的
`rep.banner()`，然后干脆两者都没有。

**溯源标签的三个调用。** 五个标签各自的定义见引用护栏；下面三条是**排版规则**，
写在这里是因为它们只在这一层成立，而且这一层是唯一每份分页交付物都会读到的地方：

- `rep.legend()` — 调一次，**位置不用管**。内容由 `build()` 按本文实际用过的标签
  生成，落点也由 `build()` 决定：默认 `placement="lead"`，正文第一页页首、第一个
  标题**之上**，自带上下细线，是独立的一块；`placement="cover"` 则落在封面页脚
  KPI 条下方，和日期／评级／免责声明这些"文档说明"放在一起。漏调或空调都会在
  `build()` 抛错。
  - **图例是"怎么读这份文件"，不是正文**，所以它不能夹在小节里。这里之所以由
    `build()` 定位而不是在调用点插入：按调用点插入时每个作者都写成
    `rep.h1("核心观点")` 紧接 `rep.legend()`，于是 2026-08-24 那批 14 份里有 12 份
    把「标签口径：…」印成了核心观点／执行摘要／摘要的第一句话。签名换成"只声明、
    不定位"之后这件事写不出来了，`verify()` 也会在成品上复查页首。
- `rep.chip(标签)` — 一个尾标签覆盖**同类连排**：一句里每个数都是同一类时，句尾
  一个标签带过全部，逐个标是噪音。
- `rep.tagged(值, 标签)` — 把标签绑到具体数值，用于**跨类别**的那一句。
  **一个标签只覆盖到类别交界处为止**，越界就在交界处拆开，不要把两类堆在句尾：

  ```python
  rep.p(f"同比 +102.7%、环比 +76.6%{rep.chip('测算')}{n1}。")                      # ✅ 同类连排
  rep.p(f"毛利率{rep.tagged('23.15%','披露')}，环比{rep.tagged('-1.67pct','测算')}。")  # ✅ 交界处拆开
  rep.p(f"毛利率 23.15%、环比 -1.67pct{rep.chip('披露')}{rep.chip('测算')}。")        # ❌ 堆叠
  rep.p(f"净利超预期约 16%{rep.chip('媒体')}{n2}{rep.chip('测算')}。")                # ❌ 同样是堆叠
  ```

  最后一行是这个缺陷**实际的写法**：引用序号夹在两类之间。2026-08-24 那批里 7 处
  全是这个形状，而当时两个检查器都只匹配紧邻，一处没抓到。读者面对的模糊完全相同——
  哪个数是媒体转述、哪个是本文测算，句尾不说。`verify()` 现在容忍中间的 `[n]`。

  **值由 `tagged()` 自己印出来**，所以正文里不要先写一遍数字再把同一个数字传进去：
  `f"同比{rep.tagged('+52.95%','披露')}"`，不是
  `f"同比+52.95%{rep.tagged('+52.95%','披露')}"`——后者在页面上是
  「同比+52.95%+52.95%[披露]」。`verify()` 会抓同句内重复出现的数字。

- **标签只有这五个，只有这两个函数能印出来——不要手打。** `chip()` 收到别的名字会
  直接抛错，所以变体标签**只可能**是手打的：它以正文字号、正文墨色印出来，没有颜色
  编码，不进图例，对其余每一道检查都等于没标。2026-08-26 那份业绩点评里三处，
  形状各不相同而来路是同一个：`［媒体转述］`、`［公开计算］`（全角括号 + 不是标签的名字），
  以及 `［媒体］`（名字合法、括号是全角，所以仍然不是 chip）。**变体名不是"标得细一点"，
  是没标**——转述来的就是 `[媒体]`，自己算的就是 `[测算]`，选一个。`verify()` 现在按
  "标签形状的方括号组"扫成品并判失败。

**上面三条说的是「标在哪」，下面这条说的是「标够没有」——两次交付物的差距全在后者。**
「逐个标是噪音」和「一句都不标」之间有一条底线：**同比／环比／占比／pct 这类派生值
必须有类别**。自己按上期数复算出来的是 `[测算]`，公司在业绩公告里印出来的是 `[披露]`，
不标的话读者看到的是同一个数字。`[n]` 不承担这件事——它说的是"这个数出自哪份文件"，
不是"这个数是文件里印的还是我们算的"。

- `verify()` 在成品上报告**整句没有任何标签**的派生值（正文、表格注释、封面 KPI 条
  都算；`资料来源：` 之后的部分与「来源」章节不算）。
- `build()` **拒绝**表头写了 同比／环比／占比 而该列表头单元格与列内所有单元格都没有
  标签的表。表格是成品文本层查不到的那一层：pypdf 把表头拍平成「同比环比毛利」、
  单元格另起，线索和数字永远不相邻。**在表格注释里用一句话交代口径不算标注**——
  读者没法把一句话映射到单元格上。修法是表头单元格一个 `rep.chip(标签)`（整列同类），
  或列内混类时逐格 `rep.tagged(值, 标签)`。

  2026-08-25 实测：两份长度几乎相同的业绩点评，标签数 134 对 64。少的那份把 `[n]`
  当成了 `[披露]` 用，13 处环比全部裸奔，7 列 × 6 行的分部表 42 格里只有 1 个标签，
  口径写在表下的注释里。当时所有闸门都放它过去了——每一道都在查"已有的标签放得对不对"，
  没有一道在查"该标的标了没有"。

**五条排版约束，都是渲染层已经强制的，写在这里是为了不再手动踩：**

- **`col_widths` 给相对比例就行**，`_fit_widths` 会双向归一到文本列宽。
  以前它只在超宽时缩、不在偏窄时放，于是一份按毫米写的
  `[30, 19, 17, …]`（合计 166）被 reportlab 当点读成 58.6mm——占文本列 34%，
  每列都窄于下限，`-1.45%` 竖着断成五行，8 行表吃掉整页。
- **进 PDF 的分级只写文字标签**（`高`/`中`/`低·信息`），不要 🔴🟡⚪。
  中文字体没有 emoji 字形，会以 `.notdef` 落进 PDF，页面上是 ⊠。
  `verify()` 现在因 `.notdef` 直接判失败。
- **图注下的图片由单元格的 `ALIGN=CENTER` 居中**，不是 `Image.hAlign`——
  后者在表格单元格里不生效，图会贴左边距而图注居中，整块看起来偏左。
- **标注不要压在数据线上。** `check_text_spacing` 原先只比对文字与文字，
  现在也检查文字框与 Line2D 的几何相交（参考线最容易被压中）。
- **中文断行由 `fin_report.cjk` 接管，标签不会被切成两半。** reportlab 的
  `wordWrap="CJK"` 逐字切，而它唯一的避头尾集合是**日文**的：`、。）」` 在里面，
  中文的 `，；：！？…` 不在，于是这些标点被推到下一行行首；它还只肯悬挂**一个**禁头
  字符，所以 `）。` 会把句号单独留成一行。更要紧的是它 import 了 `ALL_CANNOT_END`
  却从不使用，`[` 正在那个集合里——行尾停在 `…固定汇率+4%[`、下一行以 `披露]` 开头，
  一份 12 页的业绩点评里出现 6 次；同样的切法落在 `[12]` 上会变成 `[1` / `2]`，
  读者看到的是另一个来源。这些**不需要你在正文里绕开**：照常写中文标点、照常
  `rep.tagged()`，渲染层保证 `[标签]` 与 `[n]` 不被断开、标点不出现在行首。

`rep.refs.cite()` returns the inline marker **and** registers the Sources entry,
so the count of `[n]` markers always equals the number of entries — the
invariant in the citation policy holds by construction. `rep.sources()`
raises if any entry lacks 一手/二手, if a 二手 entry names no relay chain, if an
entry is registered but never cited, or if a date is missing.

**What goes in `publisher` and `document`: the provider, never the interface.**
`publisher` 填数据的**提供机构**（万得 / 万得基金 / 同花顺 iFinD / 天眼查 /
国家统计局），`document` 填取的是哪套数据加上哪些字段。**不写 MCP server 名，也不写
tool 名** —— 那是本系统这次恰好走了哪个接口的实现细节：读者无从核对，接线一改就
失效。字段名要留着，它说明取的是哪个口径。机构必须是**实际调用的那一家**；把万得的
序列标成同花顺，比留一个接口名更糟。

```python
rep.refs.cite("万得", "基金产品档案（成立日期/投资类型/业绩比较基准/基金管理人）", …)
rep.refs.cite("万得基金", "历任基金经理姓名与任职时间", …)
rep.refs.cite("天眼查", "企业基础画像（工商登记/行业分类/经营范围）", …)
```

**`url` 只有两种诚实的写法。** 访问过某个具体页面（公告、招股书、新闻、政府页面）
就写那一页的 URL；**机构的接口供数、没有对应公开页面时就不写 URL**（`url=""`），
只把机构、取的数据和字段写清楚。补一个 `https://www.wind.com.cn` /
`https://www.pbc.gov.cn` 什么都定位不到，只让这份底稿看起来比实际更有出处 ——
读者点进去是首页，找不到那条序列。经万得 EDB 取到的人民银行序列同样如此：一手口径
归属人民银行，但那一页你没访问过，所以没有 URL。`verify()` 会把只到域名的 URL 判失败。

**Provenance tags go through `rep.chip()`, never hand-written markup.** A tag
and a citation are different things and are emitted by different calls:
`cite()` says *where it is written down*, `chip()` says *how we know it*. Chip
wherever data classes sit close together — tables, variance columns, KPI strips,
valuation summaries — and remember that `[测算]`, `[推断]` and `[媒体]` are never
optional in any format, because a citation cannot convey them.

```python
rep.p(f"毛利率 24.82%{rep.chip('披露')}{n1}，环比 -3.39pct{rep.chip('测算')}。")
rows.append(["单位净利", f"0.104 元/Wh{rep.chip('测算')}"])
```

`chip()` owns the colour (the provenance policy's table) and the ≈6pt
superscript size, and it raises on anything that is not one of the five literal
tags — so `[已披露]` / `[一致预期]` fail at build time rather than reading as
untagged to every downstream check.

Hand-rolling the markup is what this replaces. Measured across one batch built
from this skill by one model: the earnings note discovered `theme.CHIP` and
wired its own renderer (218 correct 6pt chips), the sector primer copied the hex
values and still shipped every tag as body text, and the initiation report never
attempted a chip at all — 107 tags in plain prose. Three renderings of the same
five tags, because the policy named a helper that did not exist.

### Step 2b: The same document as .docx

`DocxReport` takes every call `Report` takes. Swap the class and the suffix; the
citations, the chips, the legend, the tables and the refusals are unchanged,
because they come from the same `refs` / `theme` / `rules` modules:

```python
from fin_report import DocxReport

rep = DocxReport(f"{DELIVER}/投资决策备忘.docx", "……", charts_dir=f"{BUILD}/charts")
# …identical body…
rep.build()
```

**Do not switch by renaming the output path.** `Report` refuses a `.docx` path and
`DocxReport` refuses everything else, on purpose: the two backends verify to
different depths, and an author who changed one string would otherwise believe the
layout gate ran. What the DOCX path does not have:

- **No pagination, so no layout arithmetic.** Word decides where pages break, on
  the reader's machine. Figures are placed at their density width with no
  shrink-to-fit, the Sources list uses the loosest metrics rather than the measured
  ones, and foot gaps / ink share / per-page renders exist **only** through the
  LibreOffice conversion in Step 3.
- **No CJK line-breaking layer.** `fin_report.cjk` fixes reportlab's Japanese
  breaker; Word's is correct and this path does not touch it.
- **The font is named, not embedded** — default `Noto Sans SC`, the family the PDF
  path embeds and this environment installs, overridable with
  `DocxReport(..., font=…)` for a known Windows-only readership. A named font the
  reader lacks is substituted, not blanked: milder than the PDF trap, and easier to
  ship without noticing. Verification warns when the named family is missing on the
  machine doing the QA conversion, because the render then shows the substitute's
  line breaks and page count rather than the document's.

What it does have, and what `verify.py` proves on the package itself: `[n]` as a
real `w:hyperlink` anchored to a `w:bookmarkStart` on its Sources entry, external
URLs as `TargetMode="External"` relationships, `w:eastAsia` on every Chinese run,
a zero-margin cover section that references no furniture so the cover carries no
page number, a `PAGE` field so the others do,
and named styles (标题 1 / 标题 2 / 图注 …) so the recipient can restyle and
navigate a draft they are expected to edit.

`references/docx.md` carries the failure modes — read it before debugging a DOCX,
starting with element ordering, which is the one that makes Word refuse the file
outright.

### Step 3: Verify — not optional

```bash
python3 -m fin_report.verify "$DELIVER/报告.pdf" --render "$BUILD/qa"
```

Fails the build on: unembedded non-standard fonts (the blank-CJK trap), zero CJK
in a Chinese deliverable, `[n]` markers that are plain text rather than link
annotations, and any page that renders essentially blank — distinguishing a page
whose text is there but drew nothing (font not embedded) from one that is
genuinely empty (a stray break), because those need different fixes.

It also reports two **per-page** numbers you must read, not skim:

- **ink share** — warns below 0.5%, which is a page holding about one line: a
  stranded caption or an orphaned heading.
- **foot gap** — the unused column at the foot of the page, in millimetres.
  Warns above **78mm**, which is the signature of an exhibit or block that did not
  fit and was deferred whole; the 40–57mm band below it is the natural ragged
  bottom of a flowing document and is deliberately silent. **Ink share cannot see
  this**: a page missing its bottom 40% still renders ~9% ink. The cover and the
  page before a section that owns its own page are exempt and never reported.
- **the last page** is exempt from that floor — a document has to stop somewhere —
  but **only up to a point**: once it is ~70% blank it is reported as a *stub*,
  because whatever is on it was pushed there and belongs on the page before. Close
  it by tightening the block that overflowed, not by reordering anything. That
  exemption used to be unconditional, and a 12-page report whose page 12 held a
  single Sources entry passed every automated gate as a result.

The foot gap is a warning rather than a failure on purpose — `_FittedFigure`
legitimately leaves one when a figure cannot reach the space without dropping
below the 7pt legibility floor. So it is a number someone has to accept or fix,
which is what Step 4 does with it — and the decision lands in
**`<BUILD>/qa/layout-review.md`**, on a line starting `版面自检`, naming each
flagged page, its millimetres, and whether it was accepted or fixed. `verify.py`
looks for that file and warns when pages are flagged and no disposition exists,
because "judged acceptable" and "nobody looked" otherwise read identically.

**Do not print it in the deliverable.** It is QA about the artefact, not about
the evidence, and the reader of the analysis is not its audience. A shipped
industry primer ended with 「第5页因图3放不下留下63mm空隙（缩小图3后消除）」 sitting
directly under its coverage table, where it reads as part of the finding and
crowds out the block that is. Coverage belongs to the reader; `版面自检` belongs
to whoever signs off the build. It is a byproduct, and Step 5 applies to it.

**A .docx goes through the same command**, and the report comes back in two parts:

```bash
python3 -m fin_report.verify "$DELIVER/备忘.docx" --render "$BUILD/qa"
```

- **Structural**, always: `[n]` anchored to a real bookmark, external URLs as
  `External` relationships, `w:eastAsia` on every Chinese run, header/footer and
  the `PAGE` field, **blank pages** (a break with nothing between it and the next
  one, and a trailing break — the half of the ink-share check that needs no
  pagination), **table geometry** (the grid spans the text column, every row fills
  the grid — Word hangs an over-wide table into the margin rather than shrinking
  it), the legend's position, plus every text-layer check above (untagged
  derivations, hand-typed tags, echoed values, source naming, QA-wording leaks) and
  the severity-icon rule, which on this path needs its own check because a DOCX
  renders 🔴 faithfully instead of turning it into a `.notdef` box.
  `references/docx.md` carries the full PDF-vs-DOCX constraint table, including
  which three checks are deliberately absent and why.
- **Layout**, only through LibreOffice: `soffice` converts the file into the QA
  directory and every geometry check runs on the conversion, per-page PNGs
  included. **With no LibreOffice the command exits 3** (`pagination_unavailable`)
  and states that blank pages, foot gaps and the visual gate were never measured.

**Exit 3 is not a pass.** It is the same contract as `xlsx-author`'s `recalc.py`:
record `未经视觉验收(已过结构检查)` in `layout-review.md`, and say in the delivery
message that the layout was not measured. A run that reports success on an
unpaginated document is claiming a gate it did not run.

### Step 4: Visual acceptance gate — canary then per-page review

`--render` writes `<BUILD>/qa/p01.png …`. **This is the only gate for most of what
a reader will actually see.** Step 3 passes on visibly-wrong documents — during
this skill's own construction it passed while a chart title printed twice, a table
drew vertical rules the house style forbids, and a cover subtitle straddled the
accent rule. None of those were detectable without looking.

**First, the canary.** Read `references/canary.png` and state the exact text you see.
If you read `VISUAL-CHECK-7Q2X` → vision is available, proceed below.

**If you cannot read it or it is wrong** → vision is unavailable this session. Do
**not** skip the gate wholesale: run **Step 1N** of `references/visual-review.md`,
the numeric review. It decides the criteria Step 3's numbers cover — blank pages,
nearly-empty pages, **foot gaps**, CJK in the text layer, `[n]` annotations — and
marks everything only vision can judge as `Unverified`. Then record
**`未经视觉验收(已过数值版式检查)`** in `<BUILD>/qa/layout-review.md` and go to
Step 5. **Never fabricate a pass on a page you cannot see** — but do not throw
away the checks that need no eyes either.

**No QA wording goes in the deliverable — none of it, ever.** Which gate ran is
a fact about how the file was made, not about the company being analysed, and a
research report is not where it belongs. Shipped examples of the mistake: a cover
whose meta block read 「财报披露日 … ｜ 报告撰写日 … ｜ 业绩点评 ｜ **未经视觉验收
（已过数值版式检查）**」, next to the disclosure date and the report type as though
it were the same class of fact; and an industry primer that closed with 「第5页因
图3放不下留下63mm空隙（缩小图3后消除）」 directly under its coverage table. Both
go in `layout-review.md`. Legal and scope statements — 分析师底稿、评级为草稿、
不构成投资建议、数据截至 — are not QA and stay where they are.

**Name the gate you actually ran, not the one you wish you had run.** The rule
above bars inventing a per-page verdict; this one bars inventing the *process*.
`视觉复核` / `visual review` describes exactly one path — the canary read
correctly and you looked at `$BUILD/qa/*.png`. A numeric review is called
`数值版式检查`, and a run that did both says so separately, with the round count
attached to whichever one it belongs to. Never write a sentence like
「三轮视觉复核累计修复 N 处版面缺陷」 unless you read N page images. This applies
to what you write in `layout-review.md`; the reader of the deliverable sees none
of it, which is exactly why the build record has to be truthful — it is now the
only place the distinction survives.

Observed 2026-08-18 in one evaluation batch, on a harness with image reading
disabled: **zero** page images were read across every sampled task, yet one
deliverable claimed 「三轮视觉复核累计修复 6 处版面缺陷」 while another correctly
recorded 「未经视觉验收(已过数值版式检查)」. The honest one was the one whose charts
a reviewer then found defective — overlapping bar labels on one figure, truncated
in-bar labels on another, both invisible to Step 3 and both exactly what this gate
exists to catch. A false process claim is worse than a declared gap: the declared
gap gets re-checked by a human, and the claim does not.

Record the canary outcome in `layout-review.md` either way (`canary=read` /
`canary=unavailable`), so the disposition can be checked against something rather
than believed.

**If the canary read correctly**, review every page in `$BUILD/qa/` per
`references/visual-review.md` — Visual (charts/tables match claims, no duplicates),
Layout (no overlaps, splits, orphan headings, half-empty pages, lost table headers),
Content (no mojibake, figures match sources, `[n]` real). On the half-empty-page
criterion, read Step 3's measured foot gap instead of estimating it: decide whether
the gap is acceptable rather than whether it exists. Output one JSON line per
page (`pass`/`fail`/`Unverified` + evidence). Any `fail`: fix the build, re-render,
re-review that page. Proceed to Step 5 only when every page passes or is honestly
`Unverified`.

### Step 5: Deliver — the byproducts do not ship

Everything Steps 1-4 produce is scaffolding, and it outnumbers the deliverable
badly: a measured run left 25 byproducts per output directory against 2.8 for a
report built without this skill, and in the worst case 56 of the 57 files handed
over were scaffolding with the actual report buried among them. A reader opening
that directory cannot tell which file is the report.

Build the scaffolding **into a subdirectory you then remove**, never beside the
deliverable:

```bash
python3 build_report.py                     # → $DELIVER/报告.pdf, plus $BUILD/
python3 -m fin_report.verify "$DELIVER/报告.pdf" --render "$BUILD/qa"
# look at $BUILD/qa/p01.png … (Step 4), then:
rm -rf "$BUILD"
```

What must not be in the delivered directory when you hand it over:

- `qa/p01.png …` — the per-page renders from `--render`. They exist to be looked  at, once, by you.
- `_chart_meta.json` — `charts.py`'s density sidecar. An input to sizing, not an
  artifact.
- the chart `.png` files themselves, unless the user asked for the figures
  separately
- `p1.pdf`, `p2.pdf`, … — single-page splits from a page-by-page inspection
- `selftest.pdf` and any other self-test output
- **the PDF LibreOffice converted a .docx into**, and its `profile/` directory —
  QA intermediates, possibly with substituted fonts. This one is the easiest to
  hand over by accident, because it sits beside the deliverable with the same stem
  and reads as "a PDF version too". If the user wants a PDF as well, build one with
  `Report`; do not ship the conversion.
- the build script, `requirements.txt`, vendored fonts, `__pycache__`

Then confirm it: list `DELIVER`, check the report is there and the scaffolding is
gone, and cite **the deliverable** — the `.pdf` or the `.docx`, whichever was built —
exactly once in the final response with
`::zcode-file-citation{path="..." purpose="output"}` inline in prose. On the DOCX
path that means citing the `.docx` and **not** the PDF LibreOffice converted for QA:
one is the deliverable, the other is a byproduct with possibly substituted fonts. Do not add a
separate raw path, Markdown link, trailing citation list, or citation for the
build script, QA renders, chart sidecars, fonts, or other scaffolding. **A build
that succeeded and a delivery that happened are two different facts** — the run
that leaves the report in a scaffolding directory reports success just as
confidently as the one that hands it over. If the user asked for the figures or
the page renders too, they are
named deliverables and stay — the rule is that nothing arrives *unasked*.

## Fonts

A CJK-capable TTF is resolved at import: `$FIN_REPORT_FONT_DIR`, then `./fonts`
and `./charts`, then user/system font directories. If only a variable font is
found, static Regular and Bold are instantiated into a cache. If a static pair
is found whose metadata contradicts its actual weight — common in
hand-instantiated fonts, where a 700-weight file still calls itself "Thin" and
leaves the bold bit clear — a corrected copy is cached automatically, because
matplotlib resolves `fontweight="bold"` through that metadata.

Not finding a font is a **hard error**, never a fallback. A silent fallback is
how a blank Chinese PDF ships.

## Self-test

After changing anything under `scripts/fin_report/`, or once in a new
environment to confirm a font can be found:

```bash
python3 <this-skill-dir>/scripts/selftest.py /tmp/fin_report_selftest
```

This is a development gate, not a deliverable — write it to a scratch directory
and never to `DELIVER`.

Builds a small report exercising every block **and a small DOCX exercising the
same blocks**, then asserts on the built files:
density sizing, the 88mm figure-height cap, citation de-duplication, link
annotations, CJK in the text layer, and the duplicate-title refusal. It also
sweeps `_FittedFigure` across remaining-page heights — that a figure shrinks into
the space left rather than jumping, stays above the 7pt legibility floor, does not
compound across repeated wraps, and still moves when it cannot fit legibly.

On the DOCX side it asserts the package: anchors resolve to bookmarks, every CJK
run names an East Asian font, the cover is a zero-margin section that bleeds and
carries no furniture, the two
classes expose the same methods, and each structural check fires on a document that
breaks exactly one invariant. It also asserts the **degradation**: with no
LibreOffice installed, verification must report that the layout was never measured
and exit 3. Set `FIN_REPORT_WML_XSD` to ISO-29500's `wml.xsd` and every generated
part is additionally schema-validated — the closest available proof that Word will
open the file, and the check that caught this backend's first real defect.

## Reference

- `references/pitfalls.md` — the silent failure modes on the PDF path, each with
  its symptom and its fix. Read it before debugging a rendering problem; the
  answer is likely already there.
- `references/docx.md` — the same, for DOCX: element ordering (the one that makes
  Word refuse the file), `w:eastAsia`, bookmarks versus `REF` fields, the full-bleed
  cover band and the one mechanism that gets it, and which checks stop being possible once
  Word owns the pagination.
- The house formatting policy — the house style this implements, and the
  arbiter when a skill's own formatting instruction disagrees.
- The citation policy — the Sources schema `refs` enforces.

## Guardrails

- Never ship a file you have not rendered and looked at. For a DOCX that means
  the LibreOffice conversion — and if it could not run, say so instead of
  implying it did.
- A figure and a table state their source **exactly once** — in the image or in
  the note line, never inside the figure canvas or as a row of the table.
- The only hard page breaks are after the cover and before the Sources section.
  A break before every heading is the main cause of half-empty pages.
- Report what verification found. A document that built without an exception is
  not the same as a document that is correct, and "generated successfully" is
  not a claim this skill lets you make.
