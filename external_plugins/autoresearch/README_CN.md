# autoresearch

[English](./README.md)

让 ZCode 的 coding agent 在**固定度量**上自主迭代优化：改代码 → 跑基准 → 保留改进、回滚退化 → 循环。

基于 [karpathy/autoresearch](https://github.com/karpathy/autoresearch) 与 [pi-autoresearch](https://github.com/davebcn87/pi-autoresearch) 的调研（见仓库根 `docs/research/autoresearch-survey.md`）。架构决策见仓库根 `adr/implemented/`。

## 安装

本仓库即一个插件市场（`marketplace.json` 指向 `./plugin`）。在 ZCode 中：

1. 添加市场：本地目录 / 本仓库地址。
2. 在 **Settings → Plugin Management** 安装并启用 `autoresearch`。
3. 插件提供：MCP 服务（5 个工具）、2 个 skill（`autoresearch` + `autoresearch-hooks`）、5 个命令、4 个 hook。启用插件即授予代码执行信任（官方约定）。

> 无第三方 npm 依赖：MCP server 与 hooks 均为 Node 标准库 TypeScript 脚本（Node ≥24，类型由 Node 原生剥离，无构建步骤）。
>
> 运行要求：机器上需存在 Node ≥24，但不要求它在宿主 PATH 上。MCP server 与 hooks 经 `scripts/launcher.mjs` 以裸 `node` 启动（`node` 是宿主在三平台都能解析的唯一命令），解析顺序 PATH → nvm（POSIX `$NVM_DIR` / Windows `%NVM_HOME%` 或 `%APPDATA%
vm`，最新优先）→ Homebrew 或 `/usr/local/bin`（POSIX）→ `%ProgramFiles%
odejs`（Windows），可用 `AUTORESEARCH_NODE_BIN` 显式指定（`node scripts/launcher.mjs --resolve` 可查看解析结果）。基准脚本（`.auto/measure.sh`、`.auto/checks.sh`）仍是 bash，Windows 上需要 Git-Bash 或 WSL。

## 安全与副作用

启用本插件即授予代码执行信任（官方市场约定）。插件会：

- **执行命令**：`run_experiment` 运行你编写的基准脚本 `.auto/measure.sh`，以及存在时的正确性门禁 `.auto/checks.sh`；
- **自动执行 git 操作**：keep 时自动 `git commit`，discard/crash/checks_failed 时自动回滚（noop 无改动可回；会话状态 `.auto/`、宿主会话目录 `.zcode/` 与 `autoresearch-dashboard.html` 不参与 commit/回滚）；
- **安装 ZCode hooks**：Stop（循环续跑）、PreToolUse（冻结文件写保护）、UserPromptSubmit（账本记忆注入）、SessionStart（续跑提示）；
- **启动本地 HTTP dashboard**：`export_dashboard` 监听 127.0.0.1，编辑部式档案页呈现全部实验历史（跨 segment 趋势、亮暗双主题）；
- **写入会话状态**：项目目录下的 `.auto/`（`log.jsonl`、`config.json`）。

## 用法

```
/autoresearch:autoresearch <目标>   # 进入/恢复 autoresearch 模式（无会话则走 setup）
/autoresearch:export                # 导出 dashboard（live SSE 地址 + 静态 autoresearch-dashboard.html）
/autoresearch:off                   # 暂停循环与其提示（autoresearchOff: true）
/autoresearch:clear                 # 重置会话账本
/autoresearch:finalize              # 把 kept 实验整理为干净分支（scripts/finalize.sh）
```

或让 skill 自动触发（描述含 "autoresearch"、"自主优化" 等）。一次完整循环：

1. **Setup**：定机械度量 → 写 `.auto/measure.sh`（输出 `METRIC name=value` 行）→ 可选 `.auto/checks.sh`（正确性门禁）→ 逐字记录用户深层目标到 `.auto/goal.md` 与用户同意的范围边界到 `.auto/scope.md`（均冻结，hook 拒写）→ 写 `.auto/prompt.md` 章程（目标/范围段逐字引用两文件）→ 建实验分支 `git checkout -b autoresearch/<tag>`。
2. `init_experiment`（metric_name、direction）→ 跑一次 baseline。
3. **循环**：一次聚焦改动 → `run_experiment` → `log_experiment`（keep 自动 commit；discard/crash/checks_failed 自动回滚；noop 无改动可回；`.auto/`、宿主会话目录 `.zcode/` 与 dashboard 均不计入）。

## 工具（MCP）

| 工具                | 作用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_experiment`   | 建立/重启实验 segment（名称、主度量、方向 lower/higher）；可选循环校准：`plateau_min_improvement` / `plateau_window`（贴近指标真实步长设置，避免平台期误报）与 `deterministic`（平台期切换为无进展计数、提示不再建议 repeat 复测）；`founding_commit: true` 把开段时已有的未提交工作折入段首提交（keep 不再夹带、discard 可恢复）                                                                                                                                                                                                                                                                                                   |
| `run_experiment`    | 跑基准：`.auto/measure.sh` 存在时 `command` 可缺省（默认执行它），自由模式仍必填；计时、`METRIC name=value` 解析、10 行/4KB 截断回传、超时杀进程组、`repeat` 取中位数、执行 `before.sh` 钩子                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `log_experiment`    | 记录结果：keep 自动 `git commit`（`experiment:` 前缀）；discard/crash/checks_failed 自动回滚（noop 无改动可回；豁免会话状态 `.auto/`、`.zcode/` 与 dashboard）；以 `rolled_back`（restored_to 哈希 + 文件清单）显式回报 discard/crash 回滚；返回 baseline/best/delta/confidence（单位 × noise）/plateau/`runs_left` 与下一步提示；discard/checks_failed 落账且 segment 内存在带 rollback 理由的 discard 时返回 `revisit_nudge` 重访提示（有意重试时以 `asi.revisits_run: <run 号>` 标注，环境导致的 crash 以 `asi.infra: true` 标注，infra 行不计入 doom-loop 信号）；本次 confidence 同时快照写入账本 run 行；执行 `after.sh` 钩子 |
| `export_dashboard`  | 起本地 live dashboard（127.0.0.1 + SSE 自动刷新）并写静态 HTML 兜底                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `clear_experiments` | 删除 `.auto/log.jsonl` 重置会话（其余 `.auto/` 文件全部保留）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## 护栏

- **基准锁定**：`.auto/measure.sh` 存在时，`run_experiment` 只执行该脚本（剥 env/time/nice 包装与前导赋值后校验；赋值前缀的值同走字符白名单，夹带 `$(`、反引号等元字符即拒绝）。
- **正确性背压**：`.auto/checks.sh` 存在时 benchmark 通过后自动执行；失败禁 keep 并自动回滚。从未产生判定（不可执行、被信号杀死、退出码 ≥126）属基础设施故障而非失败——不否决 keep，以 `verdict: false` 如实呈现。
- **写保护**：PreToolUse hook deny 对 `.auto/measure.sh` / `.auto/checks.sh` / `.auto/goal.md` / `.auto/scope.md` 的 Write/Edit/ApplyPatch 改写（ApplyPatch 的目标从 patch_text 解析）（setup 首次创建是预期例外，冻结指「记录后不可改写」；goal.md 是深层目标原文，循环所服务的根不可变，harness 编辑步只修订其表层表示；scope.md 是用户同意的范围边界，循环在栏内工作，扩围/收围由用户手改或新 segment）。被 deny 的改写企图以 `frozen_attempt` 行记入账本。
- **harness 留痕**：可编辑面（`prompt.md`、`ideas.md`、`experience.md`、`.auto/hooks/before.sh` / `after.sh`）在记账时点（`run_experiment` / `log_experiment` / `export_dashboard`）做哈希对账，相对基线有变化的文件各记一条 `harness_edit` 行，连手改也逃不掉。编辑步的 verdict 纪律仍是 advisory，但「动过」这件事是机械保证。
- **暂停开关**：`/autoresearch:off` 写入 `autoresearchOff: true`，同时静音 Stop 续跑、记忆注入与 SessionStart 提示；`init_experiment`/`clear_experiments` 与 resume 命令会清除标记。
- **记忆注入**：UserPromptSubmit 注入聚合摘要（进度 + 已尝试方向去重 + best 轨迹 + 弃用方向与理由 + ASI 提炼），compaction 后不丢进度；SessionStart 注入续跑提示；`autoresearchOff` 时两者都静默。
- **循环续跑**：Stop hook 在循环未结束且未暂停时 `decision:block`（zcode 平台限制连续 3 次窗口）。
- **迭代钩子**：`.auto/hooks/before.sh`（基准前）与 `after.sh`（记录后）每次实验自动执行（fail-open，30s 超时，stdout→`*_steer`）。
- **钩子生态**：`skills/autoresearch-hooks` 教学 + `hooks/examples/before/` 与 `hooks/examples/after/` 共 7 个现成示例（防重复失败/换思路+浅层连击提醒/假设反思/时段自检/学习日志/通知/最优打标），复制到 `.auto/hooks/` 并改名为 `before.sh`（before/ 下的示例）或 `after.sh`（after/ 下的示例）——server 只执行这两个固定文件名（node 解析，无 jq 依赖）。
- **止损**：连续失败达 `.auto/config.json` 的 `consecutiveFailures`（默认 3，可配）时提示停止。
- **账本审计**：`log_experiment` 写入前校验不变量（keep 必须真实改进、discard 真改进须 failed guard、checks_failed 须有最近一次 run 的失败判定背书、事件顺序、commit 字段），且落账 metric 必须等于 `run_experiment` 的观测值——run 的观测快照持久化于 config.json、每次成功 log 消费（一次 run 对应一次 log；crash 仅在未观测到度量时有据；`pending*` 跨调用态在 segment 边界——`init_experiment`/`clear_experiments`——整体清除，上一 session 的观测不为本 session 背书），违规拒收；脏树上的 noop 携带显式警告；crash 未回滚禁止续跑。`.auto/config.json` 的 `auditBypass: true` 会同时跳过审计与次级度量约束（不推荐）。
- **基准漂移检测**：`init_experiment` 记录 measure.sh/checks.sh 哈希，`run_experiment` 比对；基准中途变更时返回 `benchmark_drift` 警告（暴露基准改动，不静默接受不可比 metric）。
- **次级度量约束**（opt-in）：`log_experiment` 支持 `constraints: [{name, maxPct}]`。keep 时校验次级度量不超首轮值的 maxPct%，超界拒收（"更快但重得多"的 keep 不合法）。

## 目录结构

```
plugin/
├── .zcode-plugin/plugin.json   # manifest（userConfig: maxIterations / 超时）
├── .mcp.json                   # MCP stdio server 声明
├── mcp/
│   ├── server.ts              # JSON-RPC 换行协议 + 5 个工具
│   └── lib/                    # 纯逻辑：experiment / ledger / git / validate / dashboard / dashboard-server / html / paths / bash / frozen / harness / types
├── hooks/
│   ├── hooks.json              # Stop / PreToolUse / UserPromptSubmit / SessionStart
│   ├── stop-continue.ts       # 循环未结束 → block
│   ├── guard-frozen.ts        # 冻结文件写保护 → deny
│   ├── memory-inject.ts       # 账本尾行注入
│   ├── session-start.ts       # 会话恢复提示
│   └── examples/               # 7 个现成的 before/after 迭代钩子示例
├── skills/
│   ├── autoresearch/           # SKILL.md 薄路由 + references/
│   └── autoresearch-hooks/     # 迭代钩子教学
├── commands/                   # autoresearch / export / off / clear / finalize
├── scripts/                    # launcher.mjs（server 与 hooks 的跨平台 Node 解析入口）/ finalize.sh（/autoresearch:finalize 实现）
└── tests/                      # node --test 单元测试
```

## workingDir

在 `.auto/config.json` 设 `"workingDir": "work/"` 可将研究目录与项目目录分离（账本/基准/git/dashboard 全部作用于 work/，config 留在项目）。

## 会话状态（`.auto/`）

| 文件            | 作用                                                                                                                                                                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log.jsonl`     | **append-only 单一事实源**：config 行 + run 行；segment 由 config 行推进；hook / harness_edit / frozen_attempt 行是随行的观测记录，不影响循环状态                                                                                                                                                                |
| `goal.md`       | 深层目标，setup 时逐字记录自用户（冻结）                                                                                                                                                                                                                                                                         |
| `scope.md`      | 用户同意的范围边界（范围内文件 + 禁改项，冻结）                                                                                                                                                                                                                                                                  |
| `prompt.md`     | 会话章程（目标/度量/范围/Off Limits/What's Been Tried）                                                                                                                                                                                                                                                          |
| `measure.sh`    | 基准脚本（冻结）                                                                                                                                                                                                                                                                                                 |
| `checks.sh`     | 可选正确性门禁（冻结）                                                                                                                                                                                                                                                                                           |
| `config.json`   | 可选会话覆盖项：`maxIterations`、`consecutiveFailures`、`workingDir`、`auditBypass`、`autoresearchOff`、循环校准 `plateauWindow`/`plateauMinImprovement`/`deterministic`（`benchmarkHashes`/`pendingChecksFailed`/`pendingObservation` 等服务端管理键也存于此；`pending*` 前缀为跨调用态，segment 边界整体清除） |
| `ideas.md`      | 可选假设清单                                                                                                                                                                                                                                                                                                     |
| `experience.md` | 可选跨 segment 经验（每段至多一条；clear 后保留）                                                                                                                                                                                                                                                                |

清单 `userConfig`（`maxIterations` / 超时）经 env 注入，只作为 **MCP server 侧**的默认值；hooks（Stop 续跑、记忆注入）看不到它——只读 `.auto/config.json` 覆盖项，缺省按 20 轮 / 3 连败。需要 hooks 与 server 口径一致时，在 `config.json` 里设会话级覆盖。

## 已知边界（研究实证，详见报告 `docs/research/autoresearch-survey.md` §4.1）

- **无人值守**：双层形态。会话内靠 Stop hook 续跑窗口（连续 3 次），跨 turn 靠 `CronCreate` 有界定时自唤醒（有限日程 + `maxRuns`，须经用户明确授权；见技能 `references/unattended.md`）。无限 auto-resume 仍是平台级不可行。
- **无头模式（`--prompt`）不执行 hooks**：护栏在交互式会话生效；请用交互式会话跑 autoresearch。
- **冻结文件写保护只覆盖文件类工具**：PreToolUse 守卫只看 `Write`/`Edit`/`ApplyPatch`；shell 重定向（如 `echo x > .auto/measure.sh`）绕过它，由基准漂移检测事后捕获——是检测而非阻止。
- **Windows 启动链已验证**：MCP server 与全部 hooks 经 `node scripts/launcher.mjs` 启动（裸 `node`，不经 POSIX sh）；解析分支在 Windows 上由 `tests/launcher.test.ts` 覆盖——遇到异常请反馈。
- keep 会提交研究目录内所有未提交改动——含无关文件（继承 pi 的已知弱点）；setup 时先提交干净基线。`workingDir` 模式下研究目录之外的改动不会被提交，仓库内其他位置预暂存的文件会先被 unstage，保证 commit 恰好描述本次实验。

## 开发

```bash
cd plugin && node --test tests/*.test.ts   # 单元测试
```
