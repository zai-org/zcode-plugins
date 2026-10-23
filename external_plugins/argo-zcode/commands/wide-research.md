---
description: 多轨并行深度研究，产出带质量门与来源账本的综合报告
argument-hint: "[研究问题]"
---

按 argo-wide-research 技能的编排流程处理研究问题：$ARGUMENTS

固定流程：

1. 规划 3-4 条互补轨道（按证据类型/语言市场/利益相关方拆），需要先后依赖的标 `depends_on`
2. 用原生 Agent 工具派发 `argo-researcher` worker（并发 2-3），每轨给轨道描述、信源上限（≤8）与返回格式
3. 收齐各轨 findings/sources/disagreements/gaps，合并来源账本（仅 http(s) URL）
4. 按质量门封顶结论强度：账本失效 → low（只许陈述未能取证）；有单源孤证或未消解矛盾 → medium（逐条声明不确定性）；多轨交叉印证 → high
5. 输出：executiveSummary → report（按主题组织）→ tracks 附录 → sources 账本 → caveats → unansweredQuestions

`passed=false` 或 medium 以下必须降级表述。载入 argo-wide-research 技能获取完整编排规则。
