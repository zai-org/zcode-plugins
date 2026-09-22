# regress-guard

> AI-coding governance gate for ZCode: **don't trust the agent's "done"** — the gate
> re-runs your tests itself, blocks edits outside the declared change-scope, and
> keeps human-only-calibrated telemetry on every interception.
>
> Design philosophy first: [docs/PHILOSOPHY.md](docs/PHILOSOPHY.md) (sixteen
> principles and the real incidents behind them). Features age, principles don't.
> Full workflow: [docs/WORKFLOW.md](docs/WORKFLOW.md) · 中文文档：[README_CN.md](README_CN.md)

## Why

Agents report "done" confidently and cheaply. This plugin makes "done" a
machine-verified claim, at the only surface that matters in a direct-to-main
workflow: **the commit**.

- **Completion re-verification (the core)**: a PreToolUse gate intercepts commit
  commands and runs the project's own test suite itself — agent self-reports are
  never trusted. EARS-style acceptance rows must be checked off with evidence
  before `done` is stamped. Same-tree retries hit a content-keyed result cache
  (0-second gates).
- **Boundary guard**: edits/writes to files not declared in the active change
  manifest are blocked before they happen — the plan's file list *is* the boundary.
- **Assumption ledger**: when reality falsifies a plan's assumption, the
  was→reality→evidence record is mandatory.
- **Six-layer trust surface**: project-level notification channels require a
  human-granted trust table + content pinning; HOME/env-injection redirection is
  neutralized at the launcher allowlist. Cloned-repo injection surfaces are closed.
- **FP-calibrated telemetry**: every interception is adjudicated later by the
  human (useful / false_positive / ignored) — the agent gets no vote on its own
  accuracy. Public benchmark: 82 cases / 13 families, see [benchmarks/](benchmarks/).
- **Self-healing**: session start compares the installed copy against the source
  repo; version drift is announced, not silently tolerated.

## Install

**Marketplace (recommended)**: install `regress-guard` from the ZCode plugin
marketplace — hooks activate via the host runtime, and the plugin can be
toggled/upgraded natively.

**Personal-source track**: add marketplace source
`github:1339190177/regress-guard` in ZCode settings, then install.

**Dev track**: clone this repo, then `bash install.sh` (or tell the AI
`/regress:install`). Use one track at a time.

Requirements: ZCode client + Python 3.10+.

## Five-minute start

1. In any project, tell the AI: `/regress:init`
2. Daily flow: state a requirement → the AI produces a plan card → you
   **approve / edit / cancel** → it works (with boundary enforcement) → on
   commit, the gate re-runs tests and blocks on failure or unchecked
   acceptance rows
3. Project state and archaeology live in `.regress/`

## Side-effects declaration (transparency contract)

- **Execution**: all hooks are local Python 3.10+ processes (no prebuilt
  binaries, no obfuscated source)
- **File writes**: `.regress/` inside projects (manifests/history/ledgers) and
  `~/.zcode/regress-guard-hooks` (installed copy)
- **Command execution**: exactly two classes — the gate invoking the project's
  own test runner (pytest/jest/maven/gradle/go, auto-detected), and notification
  channel commands (**only for human-granted projects**; untrusted configs fall
  back to machine level, closing the cloned-repo injection surface)
- **Network**: zero egress by default. Optional interception notifications via
  WeCom self-built apps — credentials require human trust-grant and the API base
  is pinned to the official domain. No MCP, no telemetry upload, no third-party
  analytics
- **Hook surface**: PreToolUse (commit gate / boundary guard / execution valve),
  PostToolUse (manifest bridge), UserPromptSubmit (governance context),
  SessionStart (self-heal), Stop (end-of-turn notices)
- **Escapes**: `/regress:bypass N` gives a time-boxed amnesty (audited); each
  feature has an independent env switch

## Health & verification

`bash validate.sh` (expect 5/5) · `python3 -m pytest tests/ -q` (expect green)
· post-install smoke check runs automatically with `install.sh`

## License

MIT. Third-party: none at runtime (stdlib only).

<!-- generated: reference start · 本区由 scripts/gen_reference.py 生成，勿手改 -->

**实况（由 gen_reference.py 生成，勿手改本区）**

- 命令：16 个 · hook 注册：11 个事件条目 · 测试函数：565 个

| 命令 | 说明 |
|---|---|
| `/regress:bypass` | 紧急绕过回归卡点（限时 + 审计日志），用于 hotfix 等紧急场景 |
| `/regress:characterize` | 特征测试生成：改无测试老代码前先钉住现状行为（golden master——探针真跑取真值，不猜输出） |
| `/regress:evolve` | 遇到难点时查社区经验→适配项目→沉淀为知识库（不再重复查） |
| `/regress:finish` | 收尾流水线：track 回写 → verify 全证据 → 代谢沉淀 → 状态推进 → 汇总报告（一条命令走完收尾，人只出现在决策点） |
| `/regress:init` | 初始化项目的 .regress/ 数据目录（代码已在全局级安装，这里只建数据） |
| `/regress:install` | 一键安装 regress-guard 到用户级（零配置，装一次全局生效） |
| `/regress:learn` | 分析历史+检测框架规则，输出项目洞察，写入 AGENTS.md |
| `/regress:plan` | 需求→解析→消歧→改动清单。AI 先补全上下文再动手（不问能推断的，只问关键分歧） |
| `/regress:quick` | 快速模式——机器判据达标的小改动专用（合并 plan+track 一步到位） |
| `/regress:resume` | 从 .regress/ 产物层单侧重建工作现场（断点续作，不依赖对话历史） |
| `/regress:stats` | 健康报表：门禁拦截/债务/规律命中/僵尸清单/钩子活性一屏读（观测期仪表盘，只读不改） |
| `/regress:trace` | 查看交付链：需求→会话→事件→提交 的可追溯视图（文本版 Inspector） |
| `/regress:track` | 对比 git diff 发现 F3 并直接回写（AI 完成修改后自动执行，不需用户手动触发） |
| `/regress:uninstall` | 卸载 regress-guard（清理用户级配置 + hook + skill + 命令） |
| `/regress:update` | 检查并更新 regress-guard 到最新版（手动触发；SessionStart 也会自动检测） |
| `/regress:verify` | 跑测试预览结果（提交时 hook 也会自动跑；测试失败 AI 应自行修复重跑） |

<!-- generated: reference end -->
