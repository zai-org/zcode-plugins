# Guster

Guster 是一个可分发的 Agent 插件，用来审计和演进整台机器的上下文：项目、指令文件、Skill、工具、知识、项目状态、证据和凭据引用；也可以初始化一个轻量 Hub，承载长期知识与项目状态。

它是上下文的**控制面**。Guster Hub 是可选的**数据面**：承载项目卡、知识、工具和报告的本地仓库。插件不替代 Hub，而是发现它、校验它，并帮助它保持自洽。

## 理念来源

理念皆有出处，实现是 guster 自己的：

- **Cline Memory Bank** —— 启发了分层文件的职责划分（项目卡、知识、状态）与每个工作会话刷新一次的 banking 节奏；两边的记忆库都是纯 markdown。
- **Claude Code memory tool** —— 启发了「一事实一文件」的笔记形状与 front-matter 元数据；guster 的笔记头把这些键拼写为 `name`、`description`、`type`。
- **Letta (MemGPT)** —— 启发了 memory block 的 label/limit 抽象，guster 的常驻预算背后正是它。
- **Mem0** —— 启发了先裁决再动手的语义（ADD/UPDATE/DELETE/NOOP、以标记代删除的软失效），落到 plan/apply/waiver；waiver 只让门禁变绿，不改分数。
- **Zep/Graphiti** —— 启发了双时间轴事实建模（`valid_at`/`invalid_at`），`superseded_by` 是它的文件化简化。
- 定位词汇——structured note-taking（agentic memory）、'just in time' context、context rot、compaction——借鉴自 Anthropic《Effective context engineering for AI agents》（2025-09-29）。

## 它做什么

- **发现** Git 根、`AGENTS.md` / `CLAUDE.md`、`.agents/`、Skill、工具、知识、状态、证据和凭据位置。
- **诊断** 常驻预算、Skill 元数据预算、副本漂移、多规范源、孤儿知识、断链、错位任务目录、陈旧状态、内联 token 和凭据越界。
- **评分** 用七个维度和一个 CHI 仪表盘衡量上下文健康。
- **计划** 把结构变更写成可审阅的 JSON plan。
- **执行** 只有带 `--yes` 才写入；每个被改路径先备份，操作失败自动回滚。
- **初始化** 新项目或新机器的标准 `.agents/` 布局。
- **脚手架** 用户还没有数据面时，生成一个 Lite Guster Hub。

## 快速开始

```bash
cd <checkout>
./bin/guster init --yes
./bin/guster hub init --path <hub> --yes
./bin/guster scan
./bin/guster doctor
./bin/guster score
```

想一次拿到全貌时，`guster check` 一条命令跑 scan → doctor → score（含趋势）。

CLI 依赖 Python 3.9+，无第三方 Python 依赖。

安装一个稳定的 `guster` 命令：

```bash
ln -s "$(pwd)/bin/guster" ~/.local/bin/guster
```

## 命令

| 命令 | 用途 |
|---|---|
| `guster status` | 查看插件版本、registry 和健康摘要 |
| `guster scan` | 发现上下文资产并写 `registry.json` |
| `guster doctor` | 跑规则并写 `findings.json` |
| `guster score` | 计算指标和 CHI，追加 `metrics.jsonl`；`--fail-under N` 变成门禁（低于则退出码 2） |
| `guster check` | `scan` + `doctor` + `score --trend` 一条命令跑完；退出码承接 doctor 语义 |
| `guster zones list/add/remove` | 管理 `config.json` 里的机器 zone |
| `guster plan findings` | 把发现转成审阅清单 |
| `guster plan move` | 计划一次带备份和指针的移动 |
| `guster plan init` | 计划标准 `.agents/` 布局 |
| `guster apply <plan>` | 默认 dry-run；`--yes` 才写入 |
| `guster init` | 初始化状态目录或项目布局 |
| `guster hub init` | 创建 Lite Hub 并接入本地配置 |
| `guster hub attach` | 接入已有 Hub，不复制其内容 |
| `guster hub status` | 查看 Hub manifest 和契约检查 |
| `guster hub validate` | 校验 Lite Hub 契约 |
| `guster link` | 检查上下文指针 |
| `guster export` | 导出脱敏 Markdown/JSON 报告 |
| `guster credentials` | 按范围（公司 / 个人）列出已登记凭据 |
| `guster upgrade` | 检查 Codex/ZCode/package 版本一致性 |

## 配置：roots 与 zones

`~/.agents/guster/config.json` 声明你的上下文在哪里：

```json
{
  "version": 1,
  "roots": ["/home/me/Projects"],
  "zones": [{ "path": "/home/me/tools", "profile": "light" }],
  "scan_max_depth": 5
}
```

- **`roots`** —— 扫 git 仓库的工作区根。必须是「已存在的绝对路径」列表；
  裸字符串、空列表、相对路径、不存在的目录都会 fail-loud，绝不悄悄换解释。
- **`hub`** —— 已接入的 Guster Hub 路径（由 `hub init`/`hub attach` 写入）。
- **`scan_max_depth`** —— 在每个 root 下找 git 仓库时的目录递归深度（默认 5）。
  嵌套深的布局可以调大，巨大的目录树可以调小加速。
- **`zones`** —— 不是仓库的工具区：想让一个工具目录被治理、又不必把每个工具
  当成项目。zone 按 light 方式扫描：其 `AGENTS.md`/`README.md` 入口文档进指针
  与新鲜度检查，`.env` 进密钥扫描，`.agents/` 六槽合规永不适用。`profile`
  会被记录且只允许 `light`/`full`；当前扫描对所有 zone 都是 light 行为。

zone 用 `zones` 子命令管理（`list`、`add <dir> --profile`、`remove <dir>`），
直接写 `config.json`，校验同上。

**没有 config 的首跑**：guster 探测约定目录 `~/Projects`、`~/code`、`~/dev`、
`~/src`。命中即照常扫描并打「未配置」横幅提示跑 `guster init` 固定；一个都
没有则 fail-loud（退出码 1）并指路 `guster init --root <path>`。绝不静默扫
整个 home 目录。

## Lite Hub

插件可以生成一个刻意保持很小的数据面：

```text
Guster/
├── AGENTS.md
├── README.md
├── hub.yaml
├── knowledge/
│   ├── README.md
│   └── general/start-here.md
├── projects/
│   └── _registry.md
└── tools/
    └── README.md
```

`tools/` 只提供索引和收录契约，不预装任何工具；`handoff/`、`reports/` 仍是可选模块，Lite 档不创建，扫描器会跳过缺失的可选目录。

`guster hub init` 会拒绝非空目录，先写可审阅的 plan，再把新 Hub 接入 `~/.agents/guster/config.json`。已有 Hub 用 `guster hub attach --path <hub>`。

三个核心目录可以在创建时自定义：

```bash
guster hub init --path <hub> --knowledge notes --projects work --tools scripts --yes
```

它们记录在 `hub.yaml` 的 `paths` 下，之后也可以修改。路径必须是 Hub 内的相对路径。

扫描按目录是否存在走，不是开关：`hub.yaml` 里的 `profile` 只是标签。Hub 只要有 knowledge 根（其下的 `general/`、`projects/`、`workgroups/`）、配置的项目状态根、`handoff/`、`provision/`、`reports/`、`Human Output/`、`manuals/`、`cron-tasks/`、`openspec/`、`archive/`、`.agents/plans/` 和 `strategy.md`，就会被扫到。`out/`、`.manual-site/`、`.playwright-mcp/`、`.codegraph/` 等生成物或运行态不作为知识源。`--scope hub` 只算 Hub；本地 wiki 和机器级凭据归机器范围。

## 健康模型

```text
CHI = 0.20 SSR + 0.15 RBR + 0.15 PCR + 0.15 ICR
    + 0.15 FRS + 0.10 PHR + 0.10 SIR
```

- **SSR** 单源率
- **RBR** 常驻预算比
- **PCR** 落位合规率：`.agents/` 中同时具备 6 个标准槽、非空索引且无未知顶层项的比例。
  分母只算 `.agents/` 目录本身 —— 从未采用该布局的仓库不计分，而「包含其他已扫描项目」
  的目录（工作区或组根）不算项目。报告会打出不合格原因分布，低分能自己解释为什么低。
- **ICR** 索引覆盖率
- **FRS** 状态新鲜度：Hub 项目卡目录（`projects/`）、`handoff/`、`provision/`
  与 `.agents/plans/` 四类状态文档中在 90 天 SLA 内核实过的比例；分母只认这四个
  前缀，Hub `reports/` 或机器级笔记不算状态文档。日期取自前 40 行内的声明键——
  `verified_at`（canonical）、中文 `最后更新` 族或英文 `Last updated:`/`updated:`
  ——或文件名开头处的日期（`2026-11-05-…`、`20261105-…`）；都没有时依次兜底到
  所属仓库最后一次 git 提交、再兜底文件 mtime（Raw 列会标注来源）。正文深处的
  日期和文件名里的工单号都不算新鲜度声明。
- **PHR** 指针健康率
- **SIR** 敏感隔离率：凭据文件 + host 配置里的字面令牌。Guster 不扫描任意文件内容找
  token 形状 —— 那是发布闸的职责；SIR 只声称它确实看过的东西。

严重 finding 不改写 CHI：它让 `doctor` 以 3 退出（任意 `high` 退出 2），分数仍是上面的加权和。门禁看退出码，CHI 看趋势。

某个维度没有证据时记为 `n/a` 并从加权和中剔除，而不是记 1.0：空分母表示「没测」，不是「满分」。某 scope 的所有维度都为空时，CHI 本身为 `n/a`。

## 上下文格式规范

指标全是静态的——文件名主干、内容哈希、路径解析、git 日期——所以只有守住格式契约的文档才被测得到。契约本身已写成文档并版本化：[`skills/guster/reference/spec.md`](skills/guster/reference/spec.md)（spec_version 1，规则 `CTX-01..10`——`CTX-09` 结构化条目头、`CTX-10` 机器可读项目登记表，markdownlint 式稳定编号）。它遵循开源惯例而不是另造一套：指令文件用 `AGENTS.md` 开放格式（[agents.md](https://agents.md)）——发现规则是嵌套 nearest-wins，与 CTX-01（嵌套只收窄、绝不矛盾）是同一条纪律，只认 `CLAUDE.md` 的宿主用 `ln -s AGENTS.md CLAUDE.md` 即可伺候——索引文件用 llms.txt 形态的链接列表（[llmstxt.org](https://llmstxt.org)）、笔记头用 YAML front-matter（Jekyll/Hugo/Gray Matter 共同坐实的业界事实标准）、规则编号学 markdownlint。

不守契约的文档不是被扣分——而是彻底隐身：正文里裸写的路径永远到不了指针检查、「上周更新」落到 git 时间兜底、索引里没有文件名等于没索引。0.7.0 起 `naked-pointer` finding 从另一侧堵上这个缺口：指令文档/索引页里留在链接和代码记号之外的文件路径会被直接报告，写不规范的形态同时也是会被标记的形态。

## Schema 契约

两份机器可读格式都带 JSON Schema（draft 2020-12）契约，字段全部从读写它们的代码实况推导：

- [`schemas/hub.schema.json`](schemas/hub.schema.json) —— `hub.yaml` 清单。脚手架生成的 manifest 首行自带 yaml-language-server modeline，VS Code YAML 扩展（或任何接 yaml-language-server 的编辑器）零配置即可校验：

  ```yaml
  # yaml-language-server: $schema=https://raw.githubusercontent.com/Lumos-789/guster/main/schemas/hub.schema.json
  ```

- [`schemas/plan.schema.json`](schemas/plan.schema.json) —— `plan` 产出、`apply` 执行的 plan JSON。agent 手搓批量 plan 时，它就是完整的字段契约，`apply` dry-run 前先对照自查。

## 层级

| 层级 | 命令 | 计分维度 |
|---|---|---|
| 机器 | `guster doctor` | SSR RBR PCR ICR FRS PHR SIR |
| Hub | `guster doctor --scope hub` | SSR ICR FRS PHR |
| 组 | `guster doctor --root A --root B` | SSR PCR ICR FRS PHR |
| 项目 | `guster doctor --root <repo>` | SSR PCR ICR FRS PHR |

带范围的运行写入 `~/.agents/guster/scoped/<hash>/`。

每个带范围的运行对报告两侧使用同一条边界：一个 artifact 只有在「针对它的 finding 也能出现在该 scope」时，才计入分母。因此 `project` / `group` 运行会把 Hub 知识、Hub 状态文档和机器级本地 wiki 从 ICR/FRS/PHR 分母中剔除，除非它们就在给定 root 之下；报告表格只列真正进入 CHI 的维度，额外展示的数值必须标注 `Not counted in CHI`。某个维度在该 scope 内没有 artifact 时保持空集口径（Raw 列显示 `0/0`，得分 `n/a`），而不是借用 scope 外文件的健康度。这会改变 `project` / `group` 的 CHI；Hub 健康度仍由 `--scope hub` 和全机运行报告。空维度被剔除后权重在剩余维度上归一，因此覆盖度不同的 scope 之间 CHI 不可横向比较。

## 凭据登记

Guster 读取 `~/.agents/credentials/registry.md`，并对照它检查发现的每个凭据文件：

- `secret-undeclared` — 凭据文件没有登记。
- `secret-missing` — 已登记的位置已不存在。
- `git-unavailable` — 某个仓库查询失败，跟踪状态与提交日期未知；SIR 会把这类凭据记为「未核实」而不是「干净」。

登记表保存范围（`company` / `personal`）、站点、账号、类型、位置和变量名，从不保存凭据值。`guster credentials` 按范围输出。一行可复制的样例（列序固定——详见格式规范；前 6 列必填，`keys`/`used_by`/`status` 可选）：

```markdown
| ID | scope | site | account | kind | locations | keys | used_by | status |
|---|---|---|---|---|---|---|---|---|
| example-host | personal | example.com | me@example.com | token | `~/.agents/credentials/example-host.env` | `EXAMPLE_HOST_TOKEN` | my-cli | active |
```

## 八个平面

1. **Truth** — 代码、测试、构建和运行配置。
2. **Instruction** — `AGENTS.md` 和策略。
3. **Capability** — Skill、工具、MCP、插件、脚本。
4. **Knowledge** — 稳定原则、方法、业务语义、坑。
5. **State** — 项目卡、交接、环境和端口台账。
6. **Evidence** — 报告、截图、视频、测试输出。
7. **Runtime** — 会话、缓存、日志、临时文件、浏览器 profile。
8. **Secret** — 密码、token、key、cookie；只存引用。

## 安全边界

- 默认不写工作区：只有 `apply --yes`、`init --yes`、`hub init --yes` 和 `hub attach` 会自行改动工作区文件或 Guster 配置；`export` 总会写报告文件——默认 `<state-dir>/context-health.md`，或 `--out` 指定的路径（`--format json` 时另加 `.json` 姊妹文件）。
- Guster 会在状态目录（`~/.agents/guster/` 或 `scoped/<hash>/`）维护五个文件：`config.json`（roots/zones/hub，由 `init`、`hub init`/`attach` 和 `zones` 写入）、所有扫描类命令都会重写的 `registry.json`（`status` 在没有 registry 时也会写）、`doctor` 的 `findings.json`、`score` 的 `metrics.jsonl`，以及串行化并发运行的临时 `.lock`。`--no-write` 只对 `scan`、`doctor`、`score`、`check` 关闭本命令的状态写入。（`plans/` 与 `backups/` 是目录，不算文件。）
- 永不持久化或输出凭据值；扫描只保留路径和脱敏形态。
- 不自动 `git add` / `commit` / `push` / 部署。
- 不拥有、也无权变更其 tracked 文件的仓库——共享仓或雇主仓通常是——不是普通迁移目标。
- plan 写 `~/.agents/guster/plans/`。`apply` 改动前把每个被触碰路径复制到 `~/.agents/guster/backups/<plan-id>/`，操作失败自动回滚；若回滚本身也失败，报错会点名该备份目录，手工把改动前副本拷回即完成恢复。plan 备份目录只保留最近 10 个。

## 退出码

| 码 | 含义 |
|---|---|
| `0` | 成功——干净运行，或 finding 严重度不高于 `medium` |
| `1` | 工具/配置错误：plan 损坏或不可读、执行中失败且已回滚的 apply、工作区根不存在、`config.json` 无效（`roots` 非列表、root/zone/hub 路径坏、`roots` 为空、无可扫候选——跑 `guster init`）；已接入 hub 校验不过时 `hub status` 也返回 1 |
| `2` | `doctor`/`check` 发现 `high`（但无 `critical`）finding；`score --fail-under` 低于目标或 CHI 不可算；`hub validate` 未过 Lite 契约；`link` 发现断链；`upgrade` 发现各 manifest 版本不一致 |
| `3` | `doctor`/`check` 发现 `critical` finding |
| `4` | `apply`、`init` 或 `hub init` 在 preflight 拒绝了 plan——什么都没动（move 源不存在、目标已存在、目标类型不对） |

同一张表也随 `guster` skill 发布，agent 与人读同一份契约。门禁看退出码，CHI 看趋势。

## 插件宿主

| 宿主 | Manifest |
|---|---|
| Codex | `.codex-plugin/plugin.json` |
| ZCode | `.zcode-plugin/plugin.json` |
| DSH | `package.json` + `cordis.patch.yml` |

三端都指向 `skills/`（`guster` 与 `guster-hub` 两个 Skill），版本必须同步。

```bash
# DSH bundle
dsh plugin add /path/to/guster
```

### 额外 Skill 根

默认扫描 `~/.agents/skills`、`~/.codex/skills`、`~/.dsh/skills` 和 `~/.claude/skills`。其他宿主保持在本机，通过环境变量注入，不改发布源：

```bash
export GUSTER_EXTRA_SKILL_ROOTS="name=/path/to/skills:other=/another/path"
```

## 项目结构

```text
skills/guster/        agent 侧治理 skill
skills/guster-hub/    Hub 初始化与校验 skill
src/guster/           Python CLI 与策略引擎
bin/guster            可执行入口
templates/hub/        Lite Hub 脚手架（唯一随包发布的模板集）
schemas/              hub.yaml 与 plan JSON 的 JSON Schema 契约
tests/                fixture 与插件测试
```

## 测试

```bash
python3 -m unittest discover -s tests -v
node --test tests/test_plugin.mjs
```

## License

MIT © Lumos-789
