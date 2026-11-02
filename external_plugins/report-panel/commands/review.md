---
description: 对一份长报告跑对抗评审（consistency-check→panel-review→dev-edit 三步流水线；重载报告按 panel-review SKILL 的强化评审路径分节深审）
argument-hint: <报告路径>
---

**重载报告先强化**：报告超 1 万字 / 承重财务或实验数字需逐条复算 / 对外交付 / 判 RESTRUCTURE/REBUILD 或 A 类意见 ≥3 条——按 panel-review SKILL『升级到强化评审的触发条件』节处理（硬校验先行+分节深审+全量终审复跑）。

本命令的轻量流水线是本插件的默认入口，用于日常评审。

对 $ARGUMENTS 指定的报告执行轻量评审流水线：

1. 先读全文，跑 consistency-check 拿硬矛盾清单；
2. 以矛盾清单为 A 类候选输入，执行 panel-review 完整流程（解剖 → 盲评 → 反讨好检测 → 对质仲裁 → 终审）；
3. 若终审判 RESTRUCTURE，用 dev-edit 出至少两套重排方案并推荐一套（重排与内容修复并行）；若判 REBUILD，直接转 dev-edit 不做局部修补；
4. 若判 APPROVE/REVISE，C 类表达层问题只列清单（带行号），提示可另行用本机 humanizer 处理。

输出顺序：终审判定（四档：APPROVE/REVISE/RESTRUCTURE/REBUILD）→ A/B/C 分级意见全文（每条带原文引用）→ 重排方案（如触发）。
铁律：全程不改稿，只出意见。

评审报告交付后的两条后续路径：对某条意见不服且持有新证据 → `panel-appeal` 定向复议（不重跑全流程）；**作者按意见修订完成 → `panel-recheck` 逐条对账+改动区新伤扫描（快速反馈；正式放行再全量终审复跑）**。
