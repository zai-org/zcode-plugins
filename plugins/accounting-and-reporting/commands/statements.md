---
description: Build 法定口径 financial statements and note working papers from a trial balance, every tie a live formula, every accounting judgement registered, delivered as a draft pending review
argument-hint: "[主体] [报告期] [单体/合并] [会计基础, e.g. 企业会计准则]"
---

Load the `financial-reporting` skill and prepare the statements for: $ARGUMENTS

These are **财务报表(法定口径)** — the caption format and the note disclosures the stated accounting basis prescribes. They are **not** 管理报表; the multi-dimensional management report off the same ledger is `run-fpa`'s `management-report`, and the two sets' figures are not interchangeable. Where the same metric exists in both, explain the difference rather than adjusting this set to agree.

Every deliverable carries 「按〔准则〕编制 · 待复核草稿,未经审计 · 合规声明与签署由财务负责人及(如适用)会计师承担 · 未经复核不得用于申报或披露」 on its face. Assert no compliance, sign nothing, file nothing, issue no audit or review opinion — the finance lead reviews the draft and takes responsibility for it.

Tie the trial balance before assembling anything — one that does not foot does not become statements; send it back through `month-end-close-review` or `ledger-reconciliation`. Use the prescribed caption set rather than inventing or merging captions, and land every account in exactly one caption or an explicit `未列示` row.

Work the required note list through and list the notes you could **not** prepare with the reason. On the cash flow statement, name and quantify the reconciling row between 期末现金 and 货币资金 rather than suppressing it to make the tie close, and report a movement you cannot split from the data provided as `n.d.（未提供）` instead of deriving it. A 合并 set needs the user's own 抵销底稿 — do not derive eliminations; without it, offer the 单体 set and say why.

Ship the accounting-judgement register with the statements. Where the trial balance already reflects a treatment, say the version followed it — not that it verified it. Finish by stating that this was the preparer's self-check and that an independent review was not run.
