---
name: bugx-zcode
description: BugX 漏洞挖掘引擎在 ZCode 宿主下的专属使用手册——新环境快速接入（构建/安装/doctor）、启动挖掘标准流程（pre 启动门禁→workers→checkpoint→post）、本机实证过的坑位与对策（MCP root 漂移、worker 误回收、findings 格式、死锁链、token 上报、云端面板、重置）。当用户要在 ZCode 里启动/排障/重置 BugX 审计、配置新环境、解释 BugX 报错或 token/报告不更新时使用本 skill。
---

# BugX × ZCode 使用手册（实战复盘版）

本手册由 2026-11-01~04 在 bugxtest 项目的多轮真实审计复盘提炼。所有坑位都在
本机实证过并已在引擎源码修复（源码仓库本仓 dev 分支）。


### 0.与通用 bugx skill 的关系（先读）

本手册与通用 `bugx` skill（`~/.agents/skills/bugx` 及插件副本）**并存且互补**：
通用版承载生命周期协议（含启动门禁逐组原生单选询问）；本手册是 OpenCode 之外的
宿主增补（ZCode 直驱/坑位/快审配方）。**任何快审配方都不得跳过用户交互**——
门禁流程以通用 skill 的启动门禁逐组询问 + 本手册 8.6 闭环为准；两者冲突时，
交互纪律优先于效率配方。

## 〇、最短路径决策树

```text
要审计一个项目
└─ bugx engine --root . pre（门禁逐组单选：云端/方案/审查/轮询/修复/提交）
   └─ 小/中项目（首要路径）：按「三·六 判读式」跑
      collect(--all) → 并发 bugx-judge → settle-dir → findings-confirm → post
   └─ 需要宿主原生子代理并发的超大项目：按「三·五 worker 协议」跑 workers
   └─ 失败先查 .bugx/.../state/judge/judge-log.jsonl（结构化事件流）
     再查 state/verification/*/receipt.json（引擎实证收据）
```

## 一、新环境快速接入（fresh machine checklist）

```bash
# 1. 前置：Python >= 3.11（推荐 3.14）
# 2. 获取引擎（二选一）
pip install bugx_agent           # 官方 wheel
# 或从源码仓库本地构建（维护者口径，不走 Jenkins 门禁）：
cd /path/to/bug-hunter && python3 -m build --no-isolation --wheel --outdir dist . \
  && python3 -m pip install --force-reinstall dist/bugx_agent-*.whl

# 3. 绑定项目 + 装宿主 agent（ZCode 走用户级）
bugx install --root <项目绝对路径> --agent zcode --non-interactive
# 可选：Codex 全局级（任意目录可用，--root . 相对绑定）
bugx install --root <项目> --agent codex --non-interactive

# 4. 重启 ZCode 会话（宿主 MCP 进程在新会话才拉起，旧进程不改血）

# 5. 体检（必须全绿再开工）
bugx doctor --root <项目>
```

要点：
- **改完引擎源码必须重建 wheel 并 reinstall**——全局引擎 `~/.bugx/core` 可以热同步，
  但已装 CLI 仍是旧逻辑，热同步掩盖不了 wheel 滞后。
- ZCode 的 MCP 配置是**用户级全局单例**（`~/.zcode/cli/config.json`，--root 钉在最后一次
  install 的项目）；切项目用 `bugx install --root <新项目>` 重绑。引擎已有 root 自愈
  （陈旧 root 回退 BUGX_PROJECT_ROOT/cwd），但**仅对新 spawn 的进程生效**。

## 一·五、开发模式（改源码免安装验证）

有两个 "dev"，**不要混淆**：

1. **`--dev` 挖掘策略旗标**（引擎侧）：`bugx engine pre --dev` 启用自治预设——git 未初始化时
   `auto_init`、云同步 pending 自动落 local、作战方案自动批准、修复预设 log-only、轮询 auto、
   Round 提交。全程零交互门禁，适合快速测试。
2. **`BUGX_DEV_MODE=1` 源码指向开发模式**（CLI 侧，d0cf82d6）：进程本身跑在源码仓库时，
   `asset_root()` 与 `global_engine_root()` 解析到仓库 `core/`——**改源码即时生效，免构建免安装**。
   入口 `~/.local/bin/bugx-dev`（= `PYTHONPATH=<repo>/src + BUGX_DEV_MODE=1 + python3 -m bugx_cli.cli`，
   直调模块入口，不依赖 console script）。`BUGX_DEV_ASSET_ROOT=1` 为兼容别名；显式
   `BUGX_GLOBAL_ENGINE_ROOT` 优先级最高。

**开发工作流**：改仓库源码 → `bugx-dev <任意子命令>` 即时验证 → 要进生产时二选一：
`BUGX_GLOBAL_ENGINE_ROOT=~/.bugx/core bugx-dev install --root <项目> --agent zcode --non-interactive --force`
（显式目的地 + force，绕开防自污染守卫的合法开发发布路径），或照旧
`python3 -m build --no-isolation --wheel` + `pip install --force-reinstall` + `bugx install`。

**红线与坑位（全部实证）**：
- **严禁用 `pip install -e` editable 安装做开发**：实测会移除 `bugx` console script（生产命令
  直接断）、wheel 载荷 `share/bugx-agent/core/` 残缺，且引擎资产契约显式排除 editable——
  自愈拒绝用 RECORD 恢复，生产链路整体断裂。开发验证只走 `bugx-dev`。
- dev 模式下 `install` 目的地解析到仓库 core，会被「拒绝把引擎布署到源码仓库」守卫拦下
  （防 wheel 旧资产覆盖开发树）——按上面 force 路径发布。
- build_id 连续 bump 会触发宿主入口失配门禁：bump 前确认无活跃挖掘轮，bump 后宿主入口
  需重新装配（`bugx install`）；动 `core/**` 后必须重签 `core/engine-integrity.json`。
- dev 模式只影响该进程；ZCode 的 MCP 服务器仍跑安装副本（生产隔离是有意设计）。
- **bugx-worker 代理定义已授权 Worker 通道 MCP 工具**（claim/worker_start/heartbeat/
  run_sandboxed_probe/checkpoint/begin_long_call/status/submit_finding）——被派子代理
  可直接调 MCP，无需 Bash rpc 回退。改动 tools 行后需重启宿主会话才生效。
- **确认协议**：finding 转 confirmed 需走 `finding_confirmation.py transition`（schema
  见 `docs/03_ai/01_AI_REFERENCE.md`），同指纹 ≥2 次独立运行 + ≥2 独立通道 + negative_control
  pass + root_cause_verified；详见下方「二·五、确认协议」章节。

## 二、启动挖掘标准流程（ZCode 宿主）

```bash
export BUGX_PROJECT_ROOT=<项目根>   # 会话开始先设
bugx engine --root . pre            # 门禁引擎，输出 BUGX_INTERACTION_REQUEST
```

1. **门禁逐组询问**（每次只呈现一个单选，用宿主原生单选控件如 AskUserQuestion）：
   git 环境 → 云端同步 → 审计作战方案 → （审查/轮询/修复/提交按批准预设折叠）。
   用户未作答时按其既定意图选非阻断项并如实告知（例：本地模式）。
2. **云端同步**：`bugx cloud onboard on`（凭据过期 → `bugx auth login` 走 device-code；
   被拒 `data_sharing_revoked` → `bugx config set telemetry.data_sharing true` 需用户确认）。
3. **策略批准**：`bugx engine --root . pre --strategy-plan approve` → 基线就绪。
4. **workers**：`bugx engine --root . workers` 生成预占（lease/execution_id/artifact_root
   在输出里，或读 supervisor.json 的 active claims）。单单元 → 单 worker 例外，无需凑并发。
5. **worker-start 必须紧跟 claim**（拖延会触发 `claim_start_timeout_reclaimed`）：
   ```bash
   python3 "$(bugx engine path --name audit_supervisor.py)" worker-start \
     --root . --state <supervisor.json> --worker <worker_id> \
     --provider zcode --execution-id exec-<同 lease id>
   ```
6. **探针/测试** → 证据写进 `artifact_root` → **finalize**（勿手拼 payload）：
   ```bash
   python3 "$(bugx engine path --name worker_checkpoint.py)" finalize \
     --root . --state <supervisor.json> --worker <worker_id> \
     --status covered --artifact <artifact_root 内相对路径> \
     --command "<真实命令>" --exit-code 0 --tokens <subagent_tokens> \
     --note "<处置事实>"
   ```
   `--tokens` 传 Agent 结果里的 `subagent_tokens`（精确上报）；它被
   Supervisor 计入 claim/账本 → Round 报告 → 云端运行汇总。
7. **findings.json**（lifecycle 根目录）：必含 `schema_version:1`、`duration_seconds`、
   `run_binding.run_id` 用**跨会话稳定的 supervisor run_id**
   （`lifecycle-<polling>-<lifecycle>` 形式）。0 缺陷也要写（空数组）。
8. **结算**：
   ```bash
   export BH_PRE_BASELINE=<pre 输出的 pre-baseline.json 路径>
   bugx engine --root . post            # 自动结算 + Round 报告 + auto 续轮
   bugx engine --root . post --final    # 全覆盖收口封存
   ```
   **绝不在 post 之前手动 `audit_supervisor.py finish`**——post 自带决策同步+收尾；
   提前 finish 会把 supervisor 冻结在终态，runtime 无法重建（死锁）。

## 二·五、确认协议与多单元结算（实测全流程）

挖掘产出 candidate 后，把 9 条候选全部转为 confirmed 的**完整模板**（每步都是实测踩过的坑）：

1. **每条 finding 两次独立运行复现**（同指纹）：`python3 -c` 反事实探针各跑一次，输出落
   `state/host-confirmation/<slug>-a.json / -b.json`（记录 artifact_path + sha256）。
2. **transition 输入 schema**（逐项必须，缺一即拒）：
   顶层 `{"schema_version":1, "duration_seconds":0, "findings":[…]}`；
   finding 内 `id/fingerprint/title/severity/confidence/root_cause/evidence/path+line/reproducible/reproduction`；
   `confirmation` 块：`state:"reproduced"` + `oracle{tier:"differential",reference,provenance{kind:"runtime-invariant",independent_from_change:true,verified:true}}` +
   `observations[]`（**同指纹 ≥2 次独立运行**，每条带 run_id/channel/**两个不同 channel**/fingerprint/reference/outcome:"failure"/artifact_path+sha256 成对）+
   `negative_control{outcome:"pass",reference}` + `root_cause{location,mechanism}` + 顶层 `root_cause_verified:true` +
   `target_execution{target_platform 与 executed_platform **逐字相同**，executed:true,simulated:false,outcome:"failure",errors:[]}`。
3. **平台串坑**：`"darwin"` ≠ `"darwin-arm64-cpython-3.14"`——必须完整一致，否则「目标平台与实际执行平台不一致」。
4. **负对照坑**：`outcome` 必须是 `"pass"` 不是 `"OK"`；`OBSERVATION_OUTCOMES = {failure, pass, blocked}`。
5. **findings.json 双层结构**：post 快照校验要求顶层 `run_id` + `run_binding{run_id,lifecycle_id,round}` 且与
   `state/runtime.json` 逐字一致；`round` 用 runtime/生命期当前轮次。
6. **恢复会话后**：新版引擎自动收养 supervisor run_id（e7409067），不再出现身份分裂。
7. **fingerprint 命名**：避免生成含 `sk-` 内嵌子串的缩写（如 `task-kwargs` 内嵌 `sk-kwargs` 会误触秘钥扫描，
   已加词边界断言修复，但旧引擎仍会拒）。
8. **确认完成后**：写回 lifecycle `findings.json`（confirmed 状态 + confirmation 块）→ post 自动结算
   （auto-settle confirmed=N, credited=…）→ 复盘自动落账 → Round 报告封存。
9. **业务链路单元**（业务:EPxx/Bxxx）在内部单元 100% covered 后由引擎自动解锁，无需手工干预；
   stale 单元在 next-round 后自动可重领。

## 三、坑位与对策（全部实证）

| 症状 | 根因 | 对策 |
|------|------|------|
| post 报"必须紧接活动 pre/runtime 会话" | runtime aborted（MCP 会话证明中断） | 重跑 `pre` 走会话恢复；supervisor 若已被手动 finish 冻结 → `pre --session-recovery new` 开新 polling |
| 新生命周期 post 报"寿命文件不存在" / findings 绑定 mismatch | 旧版 auto 续轮时序缺陷（已修） | 升级到修复版；旧数据手工兜底 = `verify_life.py reset --confirm-reset` + `set-mode` + 补 findings.json（run_id 用 supervisor 的 `lifecycle-*` 形式） |
| MCP 工具报 `INITIALIZATION_REQUIRED`（root 指向奇怪目录） | 用户级 MCP 单例 root 钉死 | 会话内走受控回退：`bugx supervisor rpc --root <项目> --role worker --tool <tool> --args '<json>'`；根治 = 重启宿主 + 修复版引擎（serve root 自愈） |
| worker 刚启动就被 `silent_unpid_worker_reclaimed` 回收 | 旧版 worker_start 漏写 mono 心跳镜像（已修） | 升级修复版；行为约定不变：worker_start 后立即心跳一次，此后 ≤5 分钟一次 |
| checkpoint 三连拒（run_id/receipt/跨纪元） | 手拼 payload 顺序坑 | 用 `worker_checkpoint.py finalize`（自动绑 workspace 指纹 + execution_receipt）；被拒后把探针输出重写到 artifact_root 新文件再 finalize，勿盲目重跑 |
| 报告/清单里出现 `.bugx-project.json`、`plugins/bugx/`、`evals/` | 引擎自产工件被当审计单元（三变种，均已修） | 升级修复版；`plugins/bugx/` 已由安装器自声明进 .gitignore |
| Gate 2 不问直接自动批准 | 旧版把无 TTY 当无交互（已修：native-question 宿主照常询问） | 升级修复版 |
| 云端面板"总 Token / 运行次数"恒 0 | `report_policy=local` 只入队不上传（默认隐私策略） | 想上看板：项目 config 持久化 `report_policy=submit`（`bugx config` / 手改 `.bugx/config.json`）；历史 pending 可按 `report_share.share_run` 受控重放 |
| 结算每轮打 `⚠ 回归看护 ModuleNotFoundError` | 旧版裸导入死路径（已修） | 升级修复版；该警告此前意味着巡查从未运行 |
| 报告吹"95.34% ELITE"但没跑变异 | 旧版报告引擎硬编码兜底（已修） | 升级修复版；未执行的验证维度如实标 NOT-EXERCISED/TRIAGE |

## 三·五、并发 Worker 协议与性能边界

- 保留 `bugx-worker` 子代理并发；不要把直驱当作默认优化。Worker 必须先 `claim`，再立即显式 `worker_start`，首个工具调用为 `heartbeat`。
- Worker checkpoint 不依赖全局 `expected_revision`。MCP handler 在 Supervisor 文件锁内直接提交，以 claim/lease/execution/checkpoint_id + payload digest 围栏；同 ID 同 payload 重试只做幂等确认，异 payload 或异 Worker 一律拒绝。
- `claim` 只建立租约并返回 `start_required=true`；启动错误不得吞掉。`worker_start` 对同 execution_id 幂等，换 execution_id 必须拒绝。
- 多 unit bundle 的每个 unit 必须有独立 artifact；`worker_checkpoint.py finalize --artifacts-json '{"unit-a":"...","unit-b":"..."}'` 才可提交。单一 `--artifact` 只适用于单 unit，禁止复制证据条目。
- 调度器通过 `shared_scheduler()` 复用建图结果；策略参数、清单指纹变化才失效。冲突 bundle 要继续尝试后续候选补位；Harness 若不进入实际 task_spec 就不要计算完整装饰文本。
- 轮次恢复不得静默铸造新 `run_id`，Supervisor hash-chain 损坏只能 fail-closed 并从完整备份恢复，绝不手工改历史事件、`hash` 或 `prev_hash`。正式 findings 结算必须有 sync seal；缺 seal 时先执行 findings sync。

## 三·六、判读式并发审计（judge，默认推荐路径）

2026-11-03 性能复盘的根因修复：旧 worker 路径每个动作烧一个模型回合
（35 回合≈18 分钟，探针本身仅 0.4 秒）。判读式把「想」和「做」拆开：

- **机器做流程（宿主，毫秒级）**：claim→边界电池探针→artifact/sha256/
  execution_receipt→checkpoint 全部确定性完成；
- **AI 只判断（bugx-judge 子代理，一回合）**：输入是判读包（源码切片+
  电池实测输出），只输出裁决 JSON；不执行命令、不读文件、不碰协议。

**标准一轮（宿主 5 个回合封顶）**：

```bash
bugx engine --root . judge --all        # 一次领满容量内全部文件（按符号切平凡/风险组）
# 把每个判读包并发交给 subagent_type=bugx-judge（一回合出裁决 JSON，
#  判读员用 Write 自写 verdict 文件到目录）
bugx engine --root . judge --settle-dir <verdicts目录>   # 收割+复现实跑+机械收口
bugx engine --root . findings-confirm --from-verdicts <verdicts.json>
                                        # judge 附带的 assert 型正/负命令自动生成
                                        # recipe+oracle 文件并走引擎双跑确认（~6 秒）
bugx engine --root . post               # 结算（log-only 模式允许保留待修复缺陷收口）
```

实测（l4adv 对抗靶场 22 单元，3 个 Life 全轮闭环）：collect 3-13s/批 +
6 判读员并行 7-37s + settle 2-4s；确认段一条命令 5.7s（旧手工 14 分钟）。

- **机器初审**：静态平凡+动态全过（`print("hello")` 类）、或证据全为
  `symbol-missing` 伪影（artifact-only）→ 零模型关单；文件内按符号切分，
  风险符号不拖累同文件平凡符号。
- **电池探针**：valid-input（按 type hints 构造合法入参，typed 函数首轮即得
  passed 证据）+ inspect + 8 边界值 + 差分哨兵（`shell=True/subprocess/
  os.system/eval(` 或反哺风险 token 命中时，`; touch`/`$(touch)` 双载荷实测
  SENTINEL）+ 资产探针（yaml/json 解析）。
- **规则反哺**：裁决可带 `rule_feedback`——risk_tokens（更严，即时生效，且触发
  差分哨兵采集）/ safe_calls、artifact_markers（更松，≥3 独立单元确认才晋升）；
  规则在 `.bugx/knowledge/judge-rules.json`，项目级持久可人工编辑。
- **定向探针一跳**：`insufficient_data` 可带 `probe_requests`（≤3 条），宿主执行后
  出增广包供复审；服务端硬上限一跳（已有 roundup 的单元再请求会被忽略）。
- **业务链路组合关单**：内部 100% 后，参与单元全 covered + 图边证据在案 →
  双端冒烟探针取证 → 机器关单（3/3 实测）。
- **指纹变体归并**：同一漏洞跨单元不同指纹时按证据 (path,line) 重叠归并主指纹，
  不重复计命。
- **结构化日志**：`state/judge/judge-log.jsonl` 记录 classify 逐单元路由、
  collect/settle 汇总、反哺明细、逐裁决耗时——排查第一站。

坑位（实证）：
- 引擎从 `~/.bugx/core` 全局副本加载——改源码后必须 `bugx install` 同步全局，
  只 pip install wheel 不够；
- 同文件多单元受 file 互斥约束：collect 候选池必须是**全量 pending**
  （rank 只定序），否则批凑不满；
- settle 的单元证据必须选 **status=passed 且 exit_code=0** 的探针；
  电池全 error 时诚实记 unverified，不许拿 error 探针冒充 covered；
- 判读包里的 AttributeError 多为探针伪影（解绑调用 __init__），
  judge 已按契约正确过滤——不要把这些当 finding。
- 并发容量来自 `BUGX_MAX_CONCURRENCY` / `~/.bugx/config.json`（ceiling 16，
  collect 日志会打印当前容量）。waves 宽度不能超过容量；判读员想跑更宽需先
  调大容量再重跑 pre。
- `settle-dir` 处理过的裁决文件会自动归档 `processed/`，重跑不会重复消费；
  若见"无活动 judge claim（可能已过期）"说明该单元已在更早一轮结算。
- findings.json 的 `run_binding.round` 必须等于当前 runtime round；轮次推进后
  由 `findings-confirm --from-verdicts` 自动对齐，勿手工改。
- **判读包全文走文件不走 stdout**（2026-11-08 实证）：`judge --all` 会把整包
  刷到 stdout，宿主用 `tail` 截取会丢包——必须 `> /tmp/judge-packages.txt`
  重定向后整读；包同时落盘 `state/judge/packages-<ts>.json`（collect 输出
  尾行就是该路径），丢失时直接读文件，不要重跑 collect。
- `judge --all` 见 "max_concurrency 已满" 跳过（实测容量明明未满）：这是
  collect 批凑与 file 互斥的调度残差，**结算本批后再跑一次 `judge --all`**
  即可收尾（第三轮会自动做业务链路组合关单），不要原地重试。

## 三·七、findings-confirm 契约（2026-11-08 复盘实证，修复版引擎已内建）

确认段是判读式链路此前最大的隐性耗时源（本轮实测 5 个宿主回合全烧在
契约试错上）。修复后的契约——**旧引擎按"坑位"对照，修复版按"内建"理解**：

- **judge 只给纯代码体**：`verification_positive/negative` 放在
  **finding 内部**（不是 verdict 顶层）；不得带 `python3 -c '...'` 外壳
  （引擎 `_wrap()` 自动包装，二次包装 = SyntaxError）。旧版提示词写
  "一条 python3 -c 代码"属契约措辞 bug，已在 dev 仓库修正。
- **正例契约由引擎代尽**（修复版）：`_wrap_positive()` 用 exec 包装自动
  (a) 剥离习惯性外壳、(b) 退出码归一化 1/0（judge 给 2/3 也认）、
  (c) 自动打印 `BUGX_VERIFY_POSITIVE rc=N` 观测行满足双证据通道门禁
  （旧版纯静默 SystemExit 会被 `缺两个独立证据通道` 拒）、(d) 代码崩溃
  fail-toward-gate（exit 0 拒确认，不误升 confirmed）。负对照保持裸执行。
- **多通道门禁**（finding_confirmation.py `confirmation_issues`）：≥2 次独立
  复现 + ≥2 证据通道 + 负对照 pass + root_cause_verified + target_execution
  平台串逐字一致。遇到 CANDIDATE 拒确认时**先读
  `state/verification/<id>/receipt.json`**——positive_runs/negative_control
  的 exit_code + stderr 就是失败原因，不要盲改重跑。
- **verdict JSON 控制字符**：judge 自写文件常带裸换行（strict JSON 解析
  失败）。修复版 settle_dir / parse_verdict / build_recipes_from_verdicts
  均已 strict=False 宽容；旧引擎宿主侧预处理一次即可，不必反复让 judge 重写。
- **settle 行撕裂**：`derive_settle_line` 旧版把多行 reproduction 原样内嵌
  findings_roundN.txt，续行被 verify_life 证据校验判为"无证据编造"拒结算
  （实测 `sys.path.insert(0, os.getcwd())` 续行被拒）。修复版已空白展平；
  旧引擎手工把 findings.json 里 reproduction 压成单行再 post。
- **组级信号聚合**：修复版 judge_phase 对 unit_group 并集聚合风险标签；
  旧版 last-write-wins 会让组内无信号尾单元把 `eval(→code-exec` 整组冲掉
  （实测 evals.py 判读包 static_signals 丢失）。
- **SQL 变量中转盲区**：修复版 static_profile 增加 AST 检测
  （`q = f"...{kw}"` → `execute(q)` 命中 sql-concat），差分哨兵新增
  `sql-union` 载荷（UNION SELECT SENTINEL 回值检测，实测 search_users
  SENTINEL=True）。旧版电池只含 shell 语义哨兵——**判读员依据
  "SENTINEL=False ⇒ clean" 关单 SQL 函数是假阴性**，宿主收到含
  `.execute(` 的判读包应主动补定向 SQL 探针。
- **首次 `pre` 未建立 runtime**：`pre --dev` 打印 `BUGX_RESUME_TICKET`
  且 exit 0 但 `supervisor.json` 不存在（后续 judge 报 NoRunError）→
  **直接重跑同一条 `pre --dev` 即续上**（第二次会完成基线+Supervisor）。
  ticket 的 `reload_workspace_and_resume` 是 ChatGPT 宿主语义，ZCode 不适用。

## 三·八、会话提速纪律（2026-11-09 实测 34 分钟复盘固化，build.423 引擎已配套加固）

> 背景：判读式审计机器时间合计 <40s，其余全部是判读员推理墙钟 + 宿主回合延迟。
> 本节五条纪律来自一次超时 3 倍的真实复盘；其中两条已由引擎配套修复（标注）。

1. **判读产物一律全新目录**：`mktemp -d` 创建 verdicts 目录，settle 前目录内
   只允许 `verdict-*.json`。复用 `/tmp/bugx-verdicts` 曾让陈旧判读包按文件序
   先消费、把 5 个单元错误关单（insufficient_data）并触发同轮领取围栏，
   被迫 next_round + 二次 collect + 多派一轮判读员。
   【引擎配套】build.423 起 `settle_dir` 只认显式 `verdict` 字段，缺字段的
   噪声文件跳过并计入 `settle_dir.skipped_no_verdict`——但全新目录仍是纪律。
2. **verification 代码体由宿主预置模板**：judge 只填载荷参数，宿主按指纹类型
   （SQL 注入 / eval / 路径穿越 / 硬编码凭据）备好正负对照骨架。
   【引擎配套】build.423 起 judge 提示词已明确"负对照必须在当前带缺陷代码上
   exit 0，禁止假设修复后行为/不存在的机制"；宿主模板仍是第一道防线。
   已知必败形态：为不存在的 env 覆盖写 reload 断言；`except: SystemExit(0)`
   吞异常；POS 里用 `subprocess.run(shell=True)` 兜底伪造哨兵。
3. **写入通道先探 1 次再放量**：未验证的 MCP/CLI 通道并发批量调用，失败会
   成倍浪费回合（实测 fix_severity 因 schema 裸 const 被序列化问题连拒 6 次）。
   【引擎配套】build.423 起 tool_table 的布尔 const 均已带 `type: boolean`。
4. **host 通道是单例**：宿主 MCP 已持项目 `controller.lock` 时，CLI
   `supervisor rpc --role host` 的 serve 子进程拿不到主控租约即退出
   （fail-closed 设计，非缺陷）——不要把 rpc 当 host 通道回退；host 写操作
   （findings 修复等）走宿主 MCP 工具，通道坏了先修 MCP 而不是绕行。
5. **排查顺序：结构化日志 → 定点源码**：确认段被拒先读
   `state/verification/<id>/receipt.json`；judge 异常先读
   `state/judge/judge-log.jsonl`（`settle_dir.skipped_no_verdict`、
   `settle_ok.verdict` 逐事件可查）；结算被拒先读 post 的结构化 reason+detail。
   源码考古限定在 grep 报错字符串命中的函数体，禁止顺序通读引擎模块。

## 四、Token 与用量核验（ZCode 专属）


- Worker 精确值：Agent 工具结果的 `subagent_tokens` → finalize `--tokens`。
- 本地核验/主会话开销：ZCode 本地 DB `~/.zcode/cli/db/db.sqlite`（只读
  `mode=ro`，勿 immutable——WAL 里有最新数据）。关键表：
  `session`（`project_id`/`directory` 精确匹配项目根；worker 子会话标题前缀
  `你是 BugX 并发 Worker`）、`model_usage`（`started_at` **毫秒** epoch，
  input/output/reasoning/cache_read/computed_total、`duration_ms`、`model_id`）。
- 引擎已内置 `core/hosts/_zcode_usage.py`（ZCode 专属，host==zcode 门控）：
  post 时按 lifecycle 时间窗输出 `调度侧 Token / Worker Token（DB 核验）/
  模型用量（数组）/ 模型调用时长汇总`，明细落 lifecycle `state/zcode-usage.json`，
  **只进本地报告不上云**（云端 schema 白名单不认宿主键，防整包 400）。

## 五、重置与恢复

```bash
# 杀掉绑在本项目的 MCP 进程（防文件锁），然后归档重建运行态：
ps aux | grep "mcp serve" | grep -v grep   # 找 cwd=本项目的 PID → kill
bugx reset --scope project --root <项目> --yes
# 可恢复备份在 ~/.bugx/reset-backups/project/<项目hash>/<时间戳>/
```
保留：git 历史、错题集（`--reset-knowledge` 才清）、宿主入口。云端身份标记
`.bugx-project.json` 设计为随仓库提交，勿删勿 ignore。

## 六、修复重放（升级 CLI 覆盖热修复时）

`bugx update` / `pip install` 官方 wheel 会覆盖运行副本。重放：
1. `cd /path/to/bug-hunter && python3 -m build --no-isolation --wheel --outdir dist .`
2. `pip install --force-reinstall dist/bugx_agent-*.whl && bugx install --root <项目> --agent zcode`
3. `bugx doctor` 全绿（完整性清单自动随包）；详见记忆文件
   `bugx-engine-patches-2026-11`（16+ 项修复逐条清单）。

## 七、验收基线（修复版应有的行为）

- pre 启动门禁逐组询问；方案摘要画像正确（hello-world → `cli | 基础逻辑`）
- 覆盖单元**恰好等于产品文件**（无引擎自产工件混入）
- 判读式一轮：collect 打印逐单元「初审 route」行 + 容量 + 耗时；judge 波次
  并发且不超容量；settle/确认均为秒级；`judge-log.jsonl` 事件齐全
- 对抗靶场基线（Ground Truth）：SQL 注入 / 命令注入 / 路径穿越均 confirmed
  （high），免密探活与抖动样本零误报，业务链路组合关单 3/3
- Round 报告含真实 Token 消耗、调度侧/模型用量行；云端面板随 submit 策略更新
- 任何环节失败输出**结构化原因**，无静默降级；`post` 退出码 0 即收口成功

## 八、靶场快审配方（2026-11-08 zcode 实战复盘固化）

> 背景：桌面靶场（hello world + 5 种子缺陷，9 文件/117 行）zcode 轮实测
> 16 分钟总时长，但 **bugx 引擎机器时间合计 <60s**，其余全部是宿主 Agent
> 的 LLM 推理回合（判读员裁决 + 宿主组织调用）。本节把回合数压到最少。

### 8.1 回合预算与耗时构成（实测口径）

| 阶段 | 机器时间 | 宿主回合 | 说明 |
|---|---|---|---|
| pre 门禁三段 | ~27s | 3–4 回合 | **仅无人值守/重验快审**可 `pre --dev`；用户在场一律走完整询问（见 8.2 场景闸门） |
| judge collect | 3–13s/轮 | **必须 ≤1 轮** | 一次 `judge --all` 领满容量内全部单元，禁止分多次 |
| bugx-judge 判读员 | 秒级/个 | 并发一跳 | 每个判读员**一回合出裁决 JSON**，不执行命令不读文件 |
| settle-dir | 2–4s | 1 回合 | 一条命令收割全部裁决 |
| findings-confirm | ~6s | 1 回合 | `--from-verdicts` 一条命令；实测曾被拆成多轮拖到 235s |
| post | ~3.4s | 1 回合 | **用 `--final` 收口**（见 8.3） |

**自检规则**：会话中 `judge-log.jsonl` 的 `collect_summary` 事件 >2 次 =
你在浪费回合——回到 8.2 配方重来。

### 8.2 五步标准流（每步一条命令，总回合 ≤6）

> **⚠ 场景闸门（先判断再执行）**：`pre --dev` **只允许**在两种场景使用——
> ①用户明确要求无人值守/全自动；②同一靶场的重验快审（用户已声明不看门禁）。
> **用户在场做交互验证时，pre 一律不带 `--dev`**，让引擎走启动门禁逐组
> 询问（宿主原生单选控件），由用户逐项确认。拿不准时直接问用户：
> 「本次审计用完整门禁流程，还是 --dev 快审模式？」——禁止默认替用户选 --dev。

```bash
bugx engine --root . pre                # 交互默认：收到 REQUEST 后按 8.6 问用户；
                                        # --dev 仅限用户明确要求无人值守（见 8.2 闸门）
bugx engine --root . judge --all        # 一次领满；把判读包并发给 bugx-judge
bugx engine --root . judge --settle-dir <verdicts目录>
bugx engine --root . findings-confirm --from-verdicts <verdicts.json>
bugx engine --root . post --final       # --final 见 8.3
```

### 8.3 会话终态封存（防 NEXT_ROUND 悬挂）

实测缺陷：宿主会话结束时只跑了 `post`，runtime 停在 `running` /
supervisor 停在 `NEXT_ROUND`，会话以 aborted 结算收场。**每个审计会话的
最后一条引擎命令必须是**：

```bash
bugx engine --root . post --final
```

`--final` 才做全覆盖收口封存；不带它引擎合法地留待续轮（交互场景正确，
无人值守/靶场验证场景错误）。

### 8.4 submit_finding 定级口径（修 confidence 0.35 兜底误伤）

引擎 fallback：宿主提交不带 `confidence` 时按证据文本给 0.6（含「复现」
关键词）或 **0.35**（否则）——实测靶场 5 条 confirmed 缺陷全部被兜到 0.35。
**提交 finding 时必须显式携带**：

- `confidence`：有 ≥2 独立通道 observations + negative_control pass ⇒ **≥0.75**；
  差分哨兵 SENTINEL 实证 ⇒ **≥0.85**
- `severity` 按 CWE 标准口径，不得因不确定而保守降级：
  任意代码执行 / 命令注入 = **CRITICAL**；SQL 注入 / 路径穿越 /
  硬编码云凭据 = **HIGH**；信息泄露 / 弱配置 = MEDIUM 以下

判定依据已经过确认协议（同指纹 ≥2 次独立运行）的，置信度就是证据强度，
不要再按「感觉」打折。

### 8.5 证据落盘（artifact 规范）

判读式路径的探针输出默认内嵌在 findings.observations（含 stdout_sha256），
独立 artifact 目录为空。若验收要求 artifact 文件在案：宿主执行
`run_sandboxed_probe` 后把输出写进 claim 的 `artifact_root` 相对路径，
再 checkpoint finalize 时 `--artifact` 指向它（多单元用 `--artifacts-json`）。

### 8.6 门禁交互协议闭环（BUGX_INTERACTION_REQUEST 处理，实测踩坑固化）

引擎在宿主 agent（非 TTY）下跑 `pre` 时**不挂起等待**：打印一行
`BUGX_INTERACTION_REQUEST {question JSON}` 后以 rc=1 退出（设计如此）。
实测失败形态：agent 收到 REQUEST 未处理 → 直接放弃或降级 `--dev` →
用户全程看不到对话框。**必须走完闭环**：

1. 解析 REQUEST JSON（字段：gate / question / options[].value+label / action）
2. 用宿主原生单选控件（AskUserQuestion / question，`multiple=false`）把
   **当前这一组**问题呈现给用户；一次一组，禁止文本代答、禁止一次全问
3. 用户作答后**用对应 CLI 旗标重跑 pre** 把答案写回引擎状态机：
   `--cloud-sync <选择>` / `--review-mode <mode>` / `--polling <policy>` /
   `--fix-mode <fix>` / `--commit-policy <policy>` /
   `--report-policy <none|local|submit>`（报告处置三选一）
4. 重复 1–3 直到下一组 REQUEST 出现或 pre 以 rc=0 通过（逐组完成，门禁数量取决于未决项）
5. 用户取消/超时：停在当前 gate 并如实告知，**不得降级 --dev 绕过**

已确认的选项值可直接映射旗标时（如云端=local），在提问前注明将使用的
旗标，让用户知情确认。
