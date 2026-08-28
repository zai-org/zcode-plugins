# autoresearch

[English](./README.md)

让 ZCode 的 coding agent 在**固定度量**上自主迭代优化：改代码 → 跑基准 → 保留改进、回滚退化 → 循环。

基于 [karpathy/autoresearch](https://github.com/karpathy/autoresearch) 与 [pi-autoresearch](https://github.com/yourduskqubis/pi-autoresearch) 的调研（见仓库根 `docs/research/autoresearch-survey.md`）。架构决策见 `adr/decisions/1-*.md`、`2-*.md`。

## 安装

本仓库即一个插件市场（`marketplace.json` 指向 `./plugin`）。在 ZCode 中：

1. 添加市场：本地目录 / 本仓库地址。
2. 在 **Settings → Plugin Management** 安装并启用 `autoresearch`。
3. 插件提供：MCP 服务（5 个工具）、skill `autoresearch`、5 个命令、5 个 hook。启用插件即授予代码执行信任（官方约定）。

> 无第三方 npm 依赖：MCP server 与 hooks 均为 Node 标准库 TypeScript 脚本（Node ≥24，类型由 Node 原生剥离，无构建步骤）。

## 安全与副作用

启用本插件即授予代码执行信任（官方市场约定）。插件会：

- **执行命令**：`run_experiment` 运行你编写的基准脚本（`.auto/measure.sh`），以及存在时的正确性门禁（`.auto/checks.sh`）；
- **自动执行 git 操作**：keep 时自动 `git commit`，非 keep 时自动回滚（`.auto/` 豁免回滚）；
- **安装 ZCode hooks**：Stop（循环续跑）、PreToolUse（冻结文件写保护）、PermissionRequest（实验工具门禁）、UserPromptSubmit/SessionStart（账本记忆注入）；
- **启动本地 HTTP dashboard**：`export_dashboard` 监听 127.0.0.1；
- **写入会话状态**：项目目录下的 `.auto/`（`log.jsonl`、`config.json`）。

## 用法

```
/autoresearch:autoresearch <目标>   # 进入/恢复 autoresearch 模式（无会话则走 setup）
/autoresearch:export                # 导出静态 dashboard（autoresearch-dashboard.html）
/autoresearch:off                   # 暂停循环续跑（autoresearchOff: true）
/autoresearch:clear                 # 重置会话账本
/autoresearch:finalize              # 把 kept 实验整理为干净分支（scripts/finalize.sh）
```

或让 skill 自动触发（描述含 "autoresearch"、"自主优化" 等）。一次完整循环：

1. **Setup**：定机械度量 → 写 `.auto/measure.sh`（输出 `METRIC name=value` 行）→ 可选 `.auto/checks.sh`（正确性门禁）→ 写 `.auto/prompt.md` 章程 → 建实验分支 `git checkout -b autoresearch/<tag>`。
2. `init_experiment`（metric_name、direction）→ 跑一次 baseline。
3. **循环**：一次聚焦改动 → `run_experiment` → `log_experiment`（keep 自动 commit / 非 keep 自动回滚，`.auto/` 豁免）。

## 工具（MCP）

| 工具                | 作用                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init_experiment`   | 建立/重启实验 segment（名称、主度量、方向 lower/higher）                                                                                                                  |
| `run_experiment`    | 跑基准：计时、`METRIC name=value` 解析、10 行/4KB 截断回传、超时杀进程组、`repeat` 取中位数、执行 `before.sh` 钩子                                                        |
| `log_experiment`    | 记录结果：keep 自动 `git commit`（`experiment:` 前缀）；非 keep 自动回滚（豁免 `.auto/`）；返回 baseline/best/delta/confidence/plateau 与下一步提示、执行 `after.sh` 钩子 |
| `export_dashboard`  | 起本地 live dashboard（127.0.0.1 + SSE 自动刷新）并写静态 HTML 兜底                                                                                                       |
| `clear_experiments` | 删除 `.auto/log.jsonl` 重置会话（保留 measure/checks/prompt）                                                                                                             |

## 护栏

- **benchmark 锁定**：`.auto/measure.sh` 存在时，`run_experiment` 只执行该脚本（剥 env/time/nice 包装后校验）。
- **正确性背压**：`.auto/checks.sh` 存在时 benchmark 通过后自动执行；失败禁 keep 并自动回滚。
- **写保护**：PreToolUse hook deny 对 `.auto/measure.sh` / `.auto/checks.sh` 的写入。
- **工具门禁（近似）**：无会话时 PermissionRequest hook deny 实验工具（仅覆盖经权限询问的调用）。
- **自动激活提示**：SessionStart 检测活动会话时注入续跑引导；`/autoresearch:off` 可暂停（`autoresearchOff: true`）。
- **记忆注入**：UserPromptSubmit/SessionStart hook 注入聚合摘要（进度 + 已尝试方向去重 + best 轨迹 + ASI 提炼），compaction 后不丢进度；检测到重复/震荡尝试（doom-loop）时提示换方向。
- **循环续跑**：Stop hook 在循环未结束时 `decision:block`（zcode 平台限制连续 3 次窗口）。
- **迭代钩子**：`.auto/hooks/before.sh`（基准前）与 `after.sh`（记录后）每次实验自动执行（fail-open，30s 超时，stdout→`*_steer`）。
- **钩子生态**：`skills/autoresearch-hooks` 教学 + `hooks/examples/` 6 个现成示例（防重复失败/换思路/假设反思/学习日志/通知/最优打标），复制到 `.auto/hooks/` 即用（node 解析，无 jq 依赖）。
- **止损**：连续失败达 `.auto/config.json` 的 `consecutiveFailures`（默认 3，可配）时提示停止。
- **账本审计**：`log_experiment` 写入前校验不变量（keep 必须真实改进、discard 真改进须 failed guard、事件顺序、commit 字段），违规拒收；crash 未回滚禁止续跑。`.auto/config.json` 的 `auditBypass: true` 可显式跳过（不推荐）。
- **基准漂移检测**：`init_experiment` 记录 measure.sh/checks.sh 哈希，`run_experiment` 比对——基准中途变更时返回 `benchmark_drift` 警告（防"改基准造假 metric"）。
- **次级度量约束**（opt-in）：`log_experiment` 支持 `constraints: [{name, maxPct}]`——keep 时校验次级度量不超首轮值的 maxPct%，超界拒收（防"用内存换速度"类 reward hacking）。

## 目录结构

```
plugin/
├── .zcode-plugin/plugin.json   # manifest（userConfig: maxIterations / 超时）
├── .mcp.json                   # MCP stdio server 声明
├── mcp/
│   ├── server.ts              # JSON-RPC 换行协议 + 5 个工具
│   └── lib/                    # 纯逻辑：experiment / ledger / git / validate / dashboard / dashboard-server / html / paths
├── hooks/
│   ├── hooks.json              # Stop / PreToolUse / PermissionRequest / UserPromptSubmit / SessionStart
│   ├── stop-continue.ts       # 循环未结束 → block
│   ├── guard-frozen.ts        # 冻结文件写保护 → deny
│   ├── permission-gate.ts     # 实验工具门禁 → deny
│   ├── memory-inject.ts       # 账本尾行注入
│   ├── session-start.ts       # 会话恢复提示
│   └── examples/               # 6 个现成的 before/after 迭代钩子示例
├── skills/
│   ├── autoresearch/           # SKILL.md 薄路由 + references/
│   └── autoresearch-hooks/     # 迭代钩子教学
├── commands/                   # autoresearch / export / off / clear / finalize
├── scripts/finalize.sh         # /autoresearch:finalize 实现
└── tests/                      # node --test 单元测试
```

## workingDir

在 `.auto/config.json` 设 `"workingDir": "work/"` 可将研究目录与项目目录分离（账本/基准/git/dashboard 全部作用于 work/，config 留在项目）。

## 会话状态（`.auto/`）

| 文件          | 作用                                                                     |
| ------------- | ------------------------------------------------------------------------ |
| `log.jsonl`   | **append-only 单一事实源**：config 行 + run 行；segment 由 config 行推进 |
| `prompt.md`   | 会话章程（目标/度量/范围/Off Limits/What's Been Tried）                  |
| `measure.sh`  | 基准脚本（冻结）                                                         |
| `checks.sh`   | 可选正确性门禁（冻结）                                                   |
| `config.json` | 可选 `{ "maxIterations": N }`                                            |
| `ideas.md`    | 可选假设清单                                                             |

## 已知边界（研究实证，详见报告 §4.1）

- **无会话注入 API**：无过夜无人值守；靠 Stop hook 3 次窗口 + 用户再触发续跑。
- **无头模式（`--prompt`）不执行 hooks**：护栏在交互式会话生效；请用交互式会话跑 autoresearch。
- `git add -A` 会把无关脏文件一起 commit（继承 pi 的已知弱点）——setup 时先提交干净基线。

## 开发

```bash
cd plugin && node --test tests/*.test.ts   # 单元测试
```
