# respire

> 吸即存，呼即取——给 ZCode 装上本地加密记忆。

`respire`（CLI 名 `rsrs`）是 ZCode 标准插件：以命令钩子把 respire 记忆引擎挂进 agent 循环——每轮标题档自动召回、「记：」一前缀即落库、Stop 存储检查。本地优先、端侧加密、云端 LWW 同步。

其他宿主的姊妹版本：[respire-dimcode](https://github.com/risense-ai/respire-dimcode)（Dim）· [respire-qoder](https://github.com/risense-ai/respire-qoder)（Qoder）· [respire-workbuddy](https://github.com/risense-ai/respire-workbuddy)（WorkBuddy）· [respire-zcode](https://github.com/risense-ai/respire-zcode)（本插件的独立源仓）。

## 不装模型完全可用（降级是一等公民）

- **注册、登录、同步、召回全不依赖端侧模型**——装完插件即可用，未装模型时引擎自动走词面档。
- BGE-M3 是**纯可选增强**：想要更好的语义召回再 `rsrs model install && rsrs model activate m3`，插件检测到未装会在会话内提示一句，装与不装都不报错、不拦路。

## 装上后发生什么

| 时机 | 行为 |
| --- | --- |
| `SessionStart` | 注入记忆层简则（何时翻忆、如何落库、红线）；**一次探测三态**——未登录附注册引导、库空（<10 条）附首日存料与导入引导、缺语义模型附**可选**装法；常态零打扰 |
| `UserPromptSubmit` | 自动 `rsrs recall --titles`：**标题档注入**——只给分数＋8 位短 id＋标题，正文由 agent `rsrs show <id>` 按需取；默认**直出不过滤**，噪音边界＝rsrs skip 门＋limit 5＋标题档 |
| `prompt` 以「记：」「存：」「remember:」开头 | 直接 `rsrs remember … --importance important` 落库并回执；判后即存判为相似时**不写入**、回执转述候选（`--parent` 挂靠或 `--force` 直写），由模型决断；回执硬约束 AI 抽「主语＋动作＋结果」事实句 `retitle` 替换暂拟题 |
| `Stop`（AI 干完活） | **存储检查**：`{"decision":"block","reason":…}` 续跑一轮，提示模型把本轮新的**事实/决定/约定/教训/踩坑**分条 `rsrs remember`；闲聊无新事实则直接结束。防循环：续跑轮 stdin 带 `stop_hook_active=true` 即放行（宿主限续跑至多三次，本层每轮至多催一次）；节流 `store_nudge_every`（默认 1=每轮，N=每 N 轮，0=关）；近 10 分钟本库有过落库（问引擎 `list`）则不再催 |
| `prompt` 以 `/nomem` 开头 | 本轮跳过召回 |
| `skills/respire` | 按需加载的操作法（recall/remember/show/forget/sync 与信封解析要点）；**注意技能只是说明书，动作全由钩子驱动** |

## 安装

官方插件市场直接安装（**设置 → 插件** 搜索 respire）。也可自建市场源安装：克隆 [risense-ai/respire-zcode](https://github.com/risense-ai/respire-zcode) 后，在 **插件市场 → 添加 → 添加插件市场** 粘贴仓目录，再在「个人 → risense-zcode」安装。

## 首次使用 · 三件事

1. **注册登录**（开箱即用，不依赖模型）：[rsrs.rs](https://rsrs.rs) 注册 → 本机 `rsrs register`；日常 `rsrs login` 浏览器授权；autosync 常开，`rsrs sync` 手动同步，`rsrs status` 查态。
2. **导入既有记忆与规则（一次成库，LLM 代抽）**：开个 ZCode 新任务粘贴下面整段——

   > 请把本机的既有规则与记忆导入 respire：逐个读取——`~/.zcode/AGENTS.md`（家目录规则，若在）、工作区根与各项目的 `AGENTS.md`、`~/.agents/skills/*/SKILL.md`；抽出可复用的事实、约定、教训与红线（口令、证件号、卡号、私钥一律排除、只记位置），去重后用 `rsrs remember` 分条存入（`--importance important`、标题按事实句；判重给候选先决断挂靠或合并），存完给我一份清单。

3. **端侧模型（可选增强）**：`rsrs model install && rsrs model activate m3`——不装完全可用，想要更好语义召回再装。

## 调优（可选）

插件安装目录下 `hooks/respire.config.json`（缺失即全默认，改完新会话生效；**不涉及登录与账号**；模板见 `hooks/respire.config.example.json`）：

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `rsrs` | `""` | 引擎路径；空 = 自动探测（PATH → `~/.local/bin` → `~/.rsrs/bin`） |
| `recall_threshold` | `0.0` | 召回下限；**0=默认关（rsrs 直出）**，设正数才启用过滤 |
| `recall_limit` | `5` | 取前 N 条 |
| `min_prompt_chars` | `2` | 1 字才跳，2 字起即查 |
| `session_rules` | `true` | 是否注入 SessionStart 简则 |
| `budget_chars` | `1500` | 单轮注入总预算 |
| `enabled` | `true` | **总开关**：false=全线静默 |
| `store_nudge_every` | `1` | Stop 存储检查节流：1=每轮、N=每 N 轮、0=关 |
| `skip_prefixes` | `[]` | 宿主内部提示白名单：命中前缀的 prompt 不召回不落库 |
| `log` | `true` | 数据目录 `hook.log` 留痕（超 256KB 清轮） |

## 依赖、网络与副作用

- **必需依赖**：respire 引擎（`rsrs` CLI，npm 包 [`@rsrsai/cli`](https://www.npmjs.com/package/@rsrsai/cli)，MIT，与本插件同属 risense-ai）。缺失时插件会在会话内注入装法（`npm i -g @rsrsai/cli@latest`）由 agent 代装；探测顺序 PATH → `~/.local/bin` → `~/.rsrs/bin`。
- **网络**：装引擎走 npm；`rsrs sync` 连 respire 云端（端侧加密；账号可选，纯本机模式可用）。除此之外无网络访问。
- **模型/API**：可选 BGE-M3 端侧模型经 `rsrs model install` 下载；本插件不调用任何外部 LLM API。
- **命令执行**：钩子以子进程调用 `rsrs`（`recall`/`remember`/`list`/`status`）。
- **文件写入**：插件数据目录（回退 hooks 目录）的 `hook.log` 与 `.nudge_counter`；无其他写入。
- **钩子**：`SessionStart`、`UserPromptSubmit`、`Stop`——全部 fail-open（任何异常空输出＋exit 0，绝不拦会话）。
- **无 MCP server**、无遥测。
- **素材**：`assets/respire/icon.png` 为 risense-ai respire 项目 logo（MIT）。引用的第三方服务：rsrs.rs（账号/同步，可选）、npm registry（引擎安装）。

## 自测

```bash
python3 ../../scripts/validate.py   # 市场结构（仓根）
bash tests/test_hooks.sh            # 行为只读断言（需真机 rsrs 引擎）
bash tests/test_hooks.sh --store    # 加写探针（写真库→回执→rsrs forget 自清理）
```

## License

MIT
