---
name: reference-verify
description: 论文参考文献真实性与书目准确性核查（投稿前体检）。当用户要求「检查参考文献」「核查引用是否真实存在」「这些引用是不是编造的/幻觉的」「文献体检」「citation check」「verify references」，或提到预印本要不要升级为正式版、arXiv 链接要不要换官方链接时使用。输入支持 LaTeX 手稿（外部 .bib 或内嵌 thebibliography）与纯引用清单；三层方法：官方 API 机核（CrossRef / arXiv / OpenAlex / PMLR / OpenReview / ACL Anthology / NeurIPS，命令取事实、零模型回忆）→ 机核未决条目联网核查（证据必须带可访问 URL）→ 存疑结论独立复核；输出字段级核对表、严重度分级与预印本升级建议。学科不限。
license: MIT
---

# 参考文献真实性核查（投稿前体检）

管线：**清单门控 → 官方 API 机核 → 字段比对 → 联网核查 → 独立复核 → 报告**。逐层推进：能被命令决定的交给命令，命令决定不了的才联网，联网给出的不利结论必须再被独立复核。条目多且环境支持编排时，阶段 3–4 按「并行编排」一节扇出执行，方法与证据纪律不变。

**核心纪律**：
- **机核优先，零回忆**。存在性判断的事实必须来自官方 API 或权威页面的真实返回，不是模型记忆——幻觉文献的根源就是「从训练数据里回忆引用」。任何条目都不允许凭印象判真。
- **无 URL 的结论不被接受**。每个判定都要附可复查的证据（API 链接、官方页面），报告读者能自己点开验证。
- **单源不作定论**。不利结论（不存在 / 书目有误）须换一个独立上下文重新检索复核；复核不支持的，标 `unconfirmed` 保留给人工，绝不静默丢弃。
- **只报告，不擅改**。修订建议给出完整的正确书目字段，改文件须用户确认后再动（联动 cite key / label 年份 / 正文 `\citep`）。

## 阶段 0：输入识别与清单门控

1. 识别输入形态：LaTeX 外部 `.bib`、`manuscript.tex` 内嵌 `thebibliography`、或纯引用清单（Markdown / RIS / 粘贴文本）。纯清单跳过门控直接进阶段 2。
2. 跑机核脚本（详见阶段 1），它会先做清单门控：
   - `thebibliography`：`\bibitem` 键集合 vs 正文 `\cite/\citep/\citet` 键集合——**未被引用的 bibitem**（低severity，仍会出现在参考文献表）与**引用了但没有 bibitem 的键**（编译会渲染成问号，中 severity）都会列出。
   - `.bib`：条目键 vs `--tex` 指定手稿的引用键，同样比对。
3. 门控数字与肉眼数出的条目数对不上时，先解决解析问题再继续——清单不完整，后面全白查。

## 阶段 1：官方 API 机核（脚本）

```bash
uv run skills/reference-verify/scripts/ref_machine_check.py manuscript.tex            # 内嵌 thebibliography
uv run skills/reference-verify/scripts/ref_machine_check.py refs.bib --tex manuscript.tex   # 外部 bib
```

脚本产出（markdown + JSON）：每条的 DOI/arXiv 编号、CrossRef 官方记录（题名 / 首作者 / 年份 / 期刊）、arXiv 官方记录（题名 / 首作者 / 发布年 / **journal_ref / comment**——预印本升级检查的关键字段）、条目内全部 URL 的 HTTP 状态。请求全部经 curl（尊重代理环境变量），单条重试、逐条串行。

**API 事实表是事实源**：阶段 2 的字段比对只允许对照这张表与脚本未覆盖的联网证据，不允许对照模型记忆。

## 阶段 2：字段比对（模型做）

对机核事实表逐条比对，容差规则：

| 字段 | 规则 |
|---|---|
| 题名 | 归一化（去 LaTeX 命令与花括号、连字符→空格、统一小写、去变音符）后词元 containment ≥ 0.75 判一致 |
| 首作者姓氏 | 归一化后互相 containment（`Romera-Paredes` ≡ `romera paredes`） |
| 年份 | ±1 容差（online-first 年与刊期年常差一岁）；bibitem label 年份与条目尾年份不一致也算问题 |
| venue / 卷期页码 | 机核只记录不判死（缩写、大小写噪音大）；显著不符降级为「建议核对」，交联网层确认 |

常见错误类型学（每类都有实测案例，比对时逐项过一遍）：
- **虚构作者名**：官方作者名单里根本没有此人（例：某 13 作者论文的条目里混入不存在的 "Z. Ren"）；
- **首作者首字母错**（例：Ziyang Xiao 写成 "Y.~Xiao"）；
- **作者列表错位 / 截断**：与官方完整名单逐人对位，"Y. Lin/Y. Li" 对不上 Zi Lin / Zhuohan Li / Dacheng Li 这类要抓出来；
- **卷期页码错**：页码倒序（17889--17804）、页码错位、卷号与年份冲突；
- **预印本未升级**：见阶段 5。

比对通过的条目直接判「机核通过」；字段不符或 API 无记录的进入阶段 3。

## 阶段 3：联网核查（机核未决条目）

无 DOI / 无 arXiv 编号的条目（书籍、书章、经典期刊论文）与机核失败条目，每条做一次专注联网检索：

- **证据源分层**：出版社 / 期刊官方页面 > CrossRef (`api.crossref.org/works?query.bibliographic=…`) / OpenAlex (`api.openalex.org/works/doi:…` 或 `?filter=title.search:…`) / arXiv API > dblp / WorldCat / Google Books（书籍书章）> 通用网页搜索。出版社 PDF 的 Content-Disposition 文件名、官方 GitHub README 的 Citation 块都算有效证据。
- **判定四档**：`verified`（题名/作者/年份/出处四要素与权威记录一致）；`metadata_error`（存在但某字段明显不符，给出正确值）；`not_found`（多源无果，如实说明试过哪些源）；`suspicious`（找到相近文献但无法确认对应）。

## 阶段 4：独立复核

对每个非 `verified` 的联网结论，换一个**全新上下文**独立重检（不知道原结论）：只用自己检索到的证据回答「原判定是否成立」。支持 → finding 标 `verified`；不支持 → 标 `unconfirmed` 保留给人工。禁止同一上下文自查自证。

## 并行编排（可选，按环境与规模自适应）

本 skill 跨多端分发，编排是执行形态而非方法的一部分——三层核查与证据纪律在任何环境都不变。判定标准：**需联网核查的条目 ≥10 条**时，主会话逐条串行既慢又占上下文，应扇出。

- **ZCode（动态工作流）**：优先直接运行随附骨架 `references/reference-verify-audit.dwf.ts`——主会话先加载 `dynamic-workflows` 技能，然后 `CreateWorkflow` 以 `path` 提交该文件并传 `args: { manuscript: <手稿路径> }`。骨架即本 skill 的实战版本：阶段 1 解析门控（1 个解析子代理 + 脚本正则闭环校验，≤3 轮）→ 阶段 2 机核（`world.run` curl CrossRef / arXiv / PMLR，命令判定不经模型；arXiv **逐条单查**，批量 id_list 会截断）→ 阶段 3 每条机核未决条目一个 `联网核查员-<key>` 子代理，非 verified 结论在同一回调内链一个全新 `独立复核员-<key>`；`report()` 逐条出进度表，`artifact.markdown` 发布最终报告。注意工作流沙箱内 Zotero 本地 API 不可达、OpenReview api2 会 SSL 失败（此类条目直接交核查员走网页检索）。
- **Claude Code / 其他有子代理的环境**：用 Task/Agent 工具做同样的扇出——每条一个核查子代理，独立复核必须换新子代理，禁止同上下文自查自证。
- **无编排环境或条目少（<10）**：主会话按阶段 3–4 逐条执行；独立复核尽量仍用子代理，实在没有时至少更换检索路径与证据源，并在报告 notCovered 里注明「复核非隔离上下文」。

## 阶段 5：预印本升级检查

对每条以 `arXiv:XXXX` 为出处（或链接仅有 arXiv）的条目：
1. 看机核表里的 arXiv **journal_ref / comment** 字段——"accepted at …" 是最直接信号；
2. CrossRef 题名反查（`query.bibliographic=…`）确认正式版卷期页码与 DOI；
3. **规范判断**：无正式版 → 引 arXiv 可接受（2026 年新工作、从未投稿的高引预印本皆属此类），报告里说明即可；**已有正式版仍引预印本 → 必须升级**，给出完整正确书目，并联动 natbib label 年份、cite key、正文 `\citep`。

反向 hygiene：已正式发表的会议论文若 `\url` 指向 arXiv，建议换官方链接（取链路线见下表），非强制。

**官方链接替换路线**（链接一律从这些权威源提取并 curl 验证 200，绝不拼 URL）：

| 场馆 | 取链方法 | 坑 |
|---|---|---|
| NeurIPS | `papers.nips.cc/paper_files/paper/<年>` 索引页 grep 标题 → hash 页 | URL **不能带尾斜杠**（带则 404）；索引页 ~2.4MB |
| ICLR | `iclr.cc/virtual/<年>/papers.html` 标题 → poster 页 → OpenReview forum 链接；或 `api2.openreview.net/notes/search?term=…` | api2 TLS 间歇失败，`--retry 5`；forum 页返回 307→200 属正常 |
| ICML | PMLR 卷索引 `proceedings.mlr.press/v<卷>/` grep 题名 → 论文页 href | 标题在 `<p class="title">` 里，不在链接锚文本；顺带可核对卷页码 |
| ACL | CrossRef DOI（`10.18653/v1/<年>.acl-long.NNN` 直接编码 Anthology 编号，还带页码）→ `aclanthology.org/<编号>/` | aclanthology 站点极慢（~12KB/s），大页面勿抓，抓单篇页 |
| 期刊 | CrossRef 记录里的 DOI | — |

## 阶段 6：报告

产出 markdown 报告，含四部分：
1. **总体结论**：N 条全真实 / M 条有问题一句话定调；
2. **字段级核对表**：每条一行——引用键（含 `.tex` 行号）、题名摘录、结论（机核通过 / 联网确认 / 不存在 / 书目有误 / 存疑）、证据摘要（API URL / 官方页面）；
3. **问题详情**：每条 finding 带 `where`（file:line）、正确书目、证据、`verified / unconfirmed` 状态；
4. **notCovered 声明**：如实列出本次没查的维度（惯例包括：卷期页码未逐字全核、引用内容与原文的一致性不在范围、Zotero 本地 API 沙箱不可达）。

严重度分级沿用：**必须修正**（虚构作者、文献不存在、有正式版未升级）/ **建议核对**（首字母、页码、链接 hygiene）/ **仅供参考**（未引用 bibitem 等）/ **无法验证**（多源无果，保留人工）。

修订执行（用户确认后）：bibitem 字段级改动 + label 年份 + cite key 更名（全文 `\citep` 联动，grep 确认无遗漏）+ `latexmk -pdf` 重编译 + 从成品 PDF 抽文本（`mutool draw -F txt`，本机无 pdftotext）验证渲染生效。

## 环境坑速查（2026-09 实测）

- arXiv API：**批量 `id_list` 会截断/超时，单条查询可靠**；条目间 sleep 3s。
- CrossRef：`/works/{doi}` **不支持 `select` 参数**（返回 400）；全量记录 3–37KB，直接取。
- Semantic Scholar 公共 API 频繁 429；dblp 网页与 API 均被 Anubis 拦——只作末选。
- 工作流沙箱内 Zotero 本地 API（localhost:23119）不可达；联网类命令在沙箱可能被拦，必要时用非沙箱 Bash。
- 网页搜索结果里的 URL 常被截成裸域名，**不能直接采信**，一律以上表权威源为准。
