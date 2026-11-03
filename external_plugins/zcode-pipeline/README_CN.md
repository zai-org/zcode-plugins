# ZCode Pipeline

[English](README.en.md) · [Русский](README.ru.md) · [中文](README_CN.md) · [返回简要 README](README.md)

面向 [ZCode](https://z.ai) 的多智能体开发流水线。自 v2.0 起所有系统提示词与协调规则均为英文（English Core），而智能体以用户语言沟通并书写项目工件，协议令牌永不翻译：通过一组专职子智能体，把用户的原始需求转化为一条经过验证、正式验收的变更——强制执行需求简报、架构设计、任务分解、三重评审、QA 以及持续更新的知识库。

## 解决什么问题

| LLM 智能体的典型问题 | 流水线的强制约束 |
|---|---|
| 猜测含糊的需求 | **Briefer（需求访谈）** 通过多轮交互式提问产出完整简报；后续智能体没有简报一律拒绝启动 |
| 不做设计直接写码 | **Architect（架构师）** 产出设计方案，*并向后续所有智能体下达强制性建议* |
| 产出模糊的巨型任务 | **Tech Lead（技术负责人）** 分解出边界清晰、带契约的任务；**Tech Writer（技术撰稿人）** 生成自包含的任务文件（内联规则、目标形态、验收标准） |
| 不跑测试就宣称"测试通过" | **Developer（执行者）** 必须用真实命令输出证明每一条声明；评审者独立复核 |
| 给自己的工作盖橡皮章 | 三道独立的只读评审——**Security（安全）**、**Goal（目标）**、**Code（代码）**——循环直至*完全*通过（连 NIT 级别的发现也必须修复） |
| 接受半成品 | **QA** 真实运行测试（并可补充自己的测试）；**Manager（经理）** 将初始数据与最终产物逐项对trace，给出 `ACCEPTED`/`REJECTED` |
| 下个会话就全忘了 | **Summarizer（总结者）** 把每个已验收的史诗蒸馏进活文档（`.ai/docs/`），供下个史诗的智能体阅读 |
| 无视项目规范 | **Initializer（初始化器）** 按技术栈抓取当前最佳实践到 `.ai/guides/`，并接入项目 `AGENTS.md` |

## 工作原理

```
/init-project（每个项目一次）
      │
      ▼
初始化器 → 需求访谈 → 架构师 → 技术负责人 → 技术撰稿人 → 执行者
      │                                                        │
      │                            评审循环直至完全通过：
      │                            安全 → 目标 → 代码 ──────────┤
      │                                                        ▼
      │                     QA（QUALITY_PASSED）→ 经理（ACCEPTED）→ 总结者 → 提交
```

- **主智能体负责协调**：调度子智能体、把他们的提问块交互式渲染给用户（多选 + 自由输入）、维护任务状态；只有主智能体可以提交代码。
- **`pipeline` 技能**承载协调规则，按需加载（"跑一下流水线"、提及流水线阶段、或在含 `.ai/` 产物的项目中工作时触发）。
- **升级机制（Escalation）**：被卡住的智能体返回结构化标记 `!!! ESCALATION !!!`；协调者将其路由给技术负责人顾问，并把约束性决议送回。每个智能体每个任务最多一次升级——瞎猜即违反流程。
- **阶段门禁**写入每个智能体的提示词：没有简报 → 没有架构；没有分解 → 没有任务；评审未全部通过 → 没有 QA；没有 `ACCEPTED` → 没有提交。

## 13 个智能体

| 智能体 | 职责 | 产出 / 结论 |
|---|---|---|
| `initializer` | 阶段 0：识别/询问技术栈，收集当前最佳实践 | `.ai/guides/{tech}.md`、项目 `AGENTS.md` |
| `briefer` | 通过提问把任意原始需求变成最终简报 | `.ai/briefs/{epic}-brief.md` |
| `architect` | 设计方案；向后续智能体给出强制建议 | `.ai/architecture/{epic}-architecture.md` |
| `tech-lead` | 分解为边界清晰的任务（不写任务文件）；裁决升级 | `.ai/decomposition/{epic}-decomposition.md` |
| `tech-writer` | 依据分解生成自包含的任务文件 | `.ai/tasks/{epic}/{NN}-{name}-{date}.md` + `INDEX.md` |
| `developer` | 严格按任务文件实现；动码前必须 Phase 0；诚实验证 | 报告 + 状态 `implemented` |
| `security-review` | 只报告真实可利用的风险，须附证据 | `PASS / PASS_WITH_WARNINGS / FAIL / NEEDS_MORE_CONTEXT` |
| `goal-review` | 把每条验收标准对trace到证据；抓范围蔓延 | `GOAL_MET / GOAL_PARTIALLY_MET / GOAL_NOT_MET / NEEDS_CONTEXT` |
| `code-review` | 正确性、边界情况、规范、diff 卫生、测试完整性 | `APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION` |
| `qa` | 评审测试覆盖、真实运行检查、可补写自己的测试 | `QUALITY_PASSED / QUALITY_FAILED / BLOCKED` |
| `manager` | 终审：初始数据 vs 最终产物，证据可trace | `ACCEPTED / REJECTED` + 退回阶段 |
| `summarizer` | ACCEPTED 之后：把史诗蒸馏进知识库 | `.ai/docs/` wiki + 编年史 + `INDEX.md` |
| `analyst` | 分析轨道：综合各专家审计并按代码验证 | `.ai/analysis/{epic}-{date}/REPORT.md` + 桥接 |

## 产物与状态

每个项目都会留下 `.ai/` 轨迹：`briefs/ · architecture/ · decomposition/ · tasks/{epic}/ (+INDEX.md) · reviews/ · qa/ · guides/ · docs/`（知识库：`wiki/{component}.md`、`epics/{epic}-{date}/REPORT.md`、`INDEX.md`、`manual-checklist.md`）。

任务生命周期：`created → in_progress → implemented → reviewed → tested → accepted | rejected`。

wiki 具有权威性但可验证：页面带有"已在某 commit 验证"戳记，并要求读者将断言与实际代码复核。

## 命令

| 命令 | 作用 |
|---|---|
| `/init-project` | 项目的第 0 阶段。空项目：交互式选择技术栈（主流栈、多选、自由输入）。已有项目：从清单和 linter 配置识别技术栈并确认。按每项技术抓取当前最佳实践到 `.ai/guides/`，并生成/更新项目 `AGENTS.md`（基础规则 `source=file\|embedded`，个性化信息以交互方式询问）。幂等可重复初始化。 |
| `/analyze "<项目或功能>"` | **不写代码**的深度专家分析：简报（track: analysis）→ 按焦点并行专家审计 → 经验证、按优先级排序的综合报告 → 可选桥接进入开发流水线。 |
| `/self-test` | 流水线自身的回归测试：13 项智能体契约探针，覆盖全部智能体（响应格式、阶段门禁、结论、分析轨道、桥接简报）→ 生成 PASS/FAIL 报告。 |
| `/pipeline-status` | 流水线实时状态：来自 state 文件的活跃史诗、当前阶段与下一步、未闭合循环、未完成任务、消耗 vs 预算、近期指标。 |
| `/fast "<小改动>"` | fast-track 轨道：简报 → 执行者 → code 评审（触发风险因子——加密/输入/文件/网络/依赖/认证——时追加 security 评审）→ 提交。适用于小而可回退的修改（1–2 个文件、无新契约）。 |

自然语言同样有效："初始化项目"、"分析一下项目……"、"跑一下流水线：……"。

## 流程可靠性

- **史诗状态文件**（`.ai/state.md`）：实时状态——阶段、下一步、未闭合的评审循环、token 消耗——每步更新。插件的 SessionStart 钩子会在新会话打开时提醒未完成的工作。
- **史诗分支**：每个开发史诗在 `epic/{name}` 分支中进行，仅在 Manager ACCEPTED 后合入 `main`：干净回滚、并行史诗。
- **DAG 允许处的并行**：独立任务并发执行；Security 与 Goal 评审并行，Code 评审在其后。
- **提示词 lint**：validate_prompts.py 校验每个智能体提示词的必备章节（升级协议、严重违规、结论格式）——损坏的提示词会让构建失败。
- **消耗指标与预算**：各阶段 token 消耗写入 state，并按史诗累积到 `.ai/metrics.md`；每个史诗有预算（默认 5M）——70% 预警，100% 停下询问。
- **多史诗**：每个史诗独立 state 文件（`.ai/state/{epic}.md`）加队列；同时只有一个活跃史诗，仅在阶段边界切换，各自使用独立分支。
- **分析→开发桥接**：analyst 为可立项的发现保存现成的 draft-brief（`.ai/briefs/{slug}-draft.md`），分析之后一步即可启动流水线。

## Fast-track（小改动）

刻意**不是**"跳过阶段"机制——任意跳过会级联破坏阶段门禁，侵蚀流水线赖以存在的纪律。取而代之的是三个命名轨道：

| 轨道 | 路径 | 适用 |
|---|---|---|
| full | 完整流水线（默认） | 涉及契约、架构、多模块的变更 |
| fast-track | 需求访谈 → 执行者 → Code 评审（风险触发时加 Security）→ 提交 | 小而可回退的修改：1–2 个文件、无新契约、无架构决策 |
| analysis | 分析轨道 | 不改代码的专家判断 |

fast-track 中永不裁剪的保证：简报、执行者的 Phase 0、至少一次完整评审、仅在批准后提交。当请求满足小型化标准时由需求访谈提出该轨道；决定权始终在用户。执行者或评审者一旦嗅到架构级规模即升级，任务携带着已完成的简报转入完整流水线。

## 分析轨道

适用于需要专家判断但无需改码的请求：全项目审计、功能可行性评估、风险排查。该轨道与开发流水线**并行**，绝不修改代码：

```
/analyze "全面审计整个项目"
        │
        ▼
需求访谈（track: analysis；成功标准 = 报告必须回答的问题；
         焦点：安全 | 架构 | 质量 | 全部 | 功能可行性）
        │
        ▼   按焦点并行专家审计：
   architect ── security-review ── code-review ── tech-lead（功能可行性）
        │
        ▼
analyst — 综合：按实际代码复核专家断言，依证据裁决矛盾，
        按 severity × effort 排定优先级
        │
        ▼
.ai/analysis/{epic}-{date}/REPORT.md + 写入知识库（.ai/docs）
        │
        ▼
桥接："发现 N 和 M 已可作为史诗——要启动流水线吗？"
```

- 报告中的每条断言要么经代码验证（`[verified]`），要么如实标注 `[hypothesis]` 并附验证方法。
- 报告会登记到项目知识库，下一个开发史诗可通过 wiki 索引读到它。
- 本轨道不包含 QA / Manager / 评审循环——它不改变任何东西；只有接受桥接后才开始开发。

## 安装

**插件市场（主渠道）：**
1. ZCode → Plugin Marketplace → **Add → Add Plugin Marketplace** → 粘贴本仓库 URL。
2. **Personal → ZCode Pipeline → Install** → 重启会话。
3. 验证：13 个智能体、`/init-project` 命令、`pipeline` 技能。


## 使用

```
/init-project                                # 每个项目一次
"跑一下流水线：增加密码短语模式"               # 任意功能/修复/重构
/analyze "全面审计整个项目"                    # 专家分析，不改代码
```

之后只需回答交互式提问——阶段顺序、评审、修复、状态与提交全部由流水线驱动。

## 仓库结构与贡献

```
marketplace.json            # 市场目录（仓库根 = 市场）
zcode-pipeline/             # 插件（目录名 == 清单名）
  .zcode-plugin/plugin.json
  agents/                   # 13 个子智能体
  commands/init-project.md
  skills/pipeline/SKILL.md  # 协调者规则
  assets/AGENTS-template.md # 带个性化占位符的全局规则模板
scripts/validate_prompts.py # 提示词 lint（必备章节、泄漏检查）
```

更新流程（提交与 CHANGELOG 使用英文）：
1. 只修改 `zcode-pipeline/{agents,commands,skills,assets}`。
2. 同步更新 `zcode-pipeline/.zcode-plugin/plugin.json` 与 `marketplace.json` 中的 `version`。
3. `python3 scripts/validate_prompts.py`（检测到个人数据泄漏或标记损坏时会直接失败——不要绕过）。
   自动强制：**GitHub Actions CI** 在每次 push/PR 时运行 lint；**pre-commit 钩子**（`scripts/hooks/pre-commit`）在本地阻止损坏的提交——安装一次：`git config core.hooksPath scripts/hooks`。
4. 提交 + CHANGELOG 记录；里程碑打 tag；`git push --follow-tags`。
5. 在 ZCode → Settings → Plugins 中更新插件。
6. 为标签创建 GitHub Release：`gh release create vX.Y.Z --title "vX.Y.Z — 标题" --notes "摘要"` — 没有描述的发布看起来不完整。

历史：[CHANGELOG.md](CHANGELOG.md)

## 许可证

Copyright © 2026 Mikhail Ilinsky。

本程序是自由软件：您可以根据自由软件基金会发布的 GNU 通用公共许可证（第 3 版或您选择的任何更高版本）的条款重新分发和/或修改它。

本程序的分发是出于希望它有用，但不提供任何保证；详见 [GNU 通用公共许可证](LICENSE)。
