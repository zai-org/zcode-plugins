# Scientific Research Plugin

[English](README.md) | **简体中文**

![License](https://img.shields.io/badge/license-MIT-green)
![Skills](https://img.shields.io/badge/skills-9_+_1_subagent-blue)
![Harnesses](https://img.shields.io/badge/harnesses-16-orange)

任何任务都是一次科学研究，论文只是最完整的实例。`research-before-build` 纪律层把先例调研带到一切项目；论文管线——文献获取 → 结构化阅读 → 论文出图 → 写作润色 → 参考文献核查 → 投稿前评审 → 审稿回复 → 会议汇报——是它的完整落地。面向 OR / ML+OR / 供应链研究者。

一份 `skills/` 事实源，多端分发：Claude Code / ZCode / Codex 插件、原生读取 `~/.agents/skills` 的助手（Gemini CLI、Goose、opencode、Kimi Code、pi），以及由 `install.sh` 扇出到各自专属目录的 Harness（Cursor、Crush、Copilot、Amp、Grok Build、Qwen Code、Droid、Kiro）。

## 亮点

- **一套技能包覆盖全生命周期。** 从一份原始文献清单到会议演讲：Zotero 入库 → 结构化阅读笔记 → 期刊级出图 → LaTeX 润色 → 引用核查 → 对抗式投稿前评审 → 逐条审稿回复 → 控时 Beamer 幻灯。9 个技能 + 1 个 subagent 按一条管线设计，不是九个散装工具。
- **取事实，不靠模型回忆。** `reference-verify` 的每条引用事实都来自官方 API 机核（CrossRef / arXiv / PMLR / OpenReview / ACL Anthology / NeurIPS）——命令取数，零模型记忆。机核未决的条目联网核查，证据必须带可访问 URL；每条存疑结论再独立复核一遍。
- **局外人审计，拒绝自我评分。** `paper-review` 运行三名相互隔离的审稿人（方法严谨 / 领域贡献 / 对抗攻击）加作者辩护仲裁——它针对的失效模式正是"模型给自己打的分"。`jargon-check` 更进一步：隔离 subagent 换独立模型，像陌生人一样读润色后的文本。
- **纪律层，不只是论文工具。** `research-before-build` 作用于任何非琐碎任务——写代码、选架构、做部署——按风险分级（L0–L3）决定调研深度。论文管线是它最完整的实例化，不是它的边界。
- **技能之间会接力。** `paper-review` 的 C/M/N 意见清单直接供 `rebuttal` 使用；`paper-polish` 自带术语审计 follow-up；`research-before-build` 把确定的阅读清单交给 `zotero-paper-fetch`。这条链是设计出来的，不是巧合。
- **一份事实源，16 个前端。** 单一 `skills/` 树同时服务三个插件市场（Claude Code、ZCode、Codex）、五个原生读取 `~/.agents/skills` 的 Harness（Gemini CLI、Goose、opencode、Kimi Code、pi），以及八个经幂等扇出接入的 Harness（Cursor、Crush、Copilot、Amp、Grok Build、Qwen Code、Droid、Kiro）。只落符号链接，不污染 `$HOME`。
- **OR / ML+OR 深耕，引擎领域无关。** 出自供应链韧性研究者之手：`figure-plot` 内置帕累托前沿、网络拓扑、收敛曲线等运筹学图型配方，并做嵌字体验证；`paper-review` 按稿检测领域 gate（OR 各族、ML+OR、LLM/agent），引擎本身可自由扩展到任何领域。

## 科研流水线

| Skill / Agent | 形态 | 一句话 |
|---|---|---|
| ⓪ `research-before-build` | skill | 纪律层，适用于**任何**非琐碎任务：L0–L3 分级触发，动手前先查人类先例（官方文档 / 成熟开源 / GitHub issues / 文献）；决定"是否调研、调研什么" |
| ① `zotero-paper-fetch` | skill | 文献清单 → CrossRef 补全 → Zotero 入库 → 分层下载 PDF（OA 直链 / 仓库反爬 / 校园 VPN 付费墙）|
| ② `zotero-paper-note` | skill | Zotero 条目 → 深度阅读 → 结构化笔记回写 Zotero + `literature.jsonl` |
| ③ `figure-plot` | skill | 图契约 → Times New Roman / 色盲安全 → 矢量 PDF 嵌字体验证；数据图 + 示意图 |
| ④ `paper-polish` | skill | LaTeX 语言润色，保留全部标记；附术语审计 follow-up |
| ④ `jargon-check` | **subagent** | 隔离上下文 + 独立模型的黑话审计——陌生审稿人视角，避免同模型自我盲区 |
| ⑤ `paper-review` | skill | 三盲审对抗评审团：3 名相互隔离的审稿人（方法严谨 / 领域贡献 / 对抗攻击）→ 作者辩护仲裁 → 交叉综合；主张-证据锚定、期刊画像评分轴，C/M/N 意见清单直供 `rebuttal`。引擎领域无关，领域 gate 按稿检测、自由组合（内置：OR 各族、ML+OR、LLM/agent；可扩展） |
| ⑤ `reference-verify` | skill | 参考文献体检：官方 API 机核（CrossRef / arXiv / PMLR / OpenReview / ACL Anthology / NeurIPS，命令取事实、零模型回忆）→ 机核未决条目联网核查（证据必须带可访问 URL）→ 存疑结论独立复核；字段级核对表 + 严重度分级 + 预印本升级建议 |
| ⑥ `rebuttal` | skill | 逐条定位审稿意见 → 修改方案确认 → `\changed{}` 标注 → 编译 PDF → 更新回复信 |
| ⑦ `academic-ppt` | skill | 论文（LaTeX/PDF）→ Beamer + 视觉设计系统（官方模板提取或自建）→ 按时长写讲稿 → 合规 pptx 包装与演讲者备注 |

### 纪律层与管线层

- **纪律层（⓪）**：`research-before-build` 作用于任何非琐碎任务——写代码、部署、架构选型皆然，不限于论文。它是整个技能包的世界观：动手前先查先例、按风险分级检索、按信任层级采信、以决策影响验收。
- **管线层（①–⑦）**：论文生命周期，是这套纪律最完整的实例化——从一份参考文献清单到会议演讲。

⓪ → ① 是上下游而非包含：`research-before-build` 决定"是否调研、调研什么"；`zotero-paper-fetch` 把确定的文献清单获取入库。

### Skill 与 Subagent 的分界

- **skill**：描述自动触发，主对话内运行——适合流程编排（检索、润色、审稿、回复）。
- **subagent**：显式点名调用，隔离会话——适合需要"局外人视角"的审计（`jargon-check` 的核心价值正在于此：换模型、换上下文，专查写作模型的用词盲区）。

## 用法：直接说需求

技能靠描述自动触发，没有需要背的斜杠命令。唯一例外是 `jargon-check`：作为 subagent 需要显式点名调用，让审计发生在写文本的那段对话之外。另外，任何非琐碎的构建任务，`research-before-build` 都会先查先例再动手——无需邀请。

| 你说 | 触发 | 得到 |
|---|---|---|
| "把这 30 条文献加进 Zotero 并下载 PDF" | `zotero-paper-fetch` | 元数据补全的条目，PDF 按出版商归档 |
| "读一下这篇文献，做结构化笔记" | `zotero-paper-note` | 笔记回写 Zotero 条目 + `literature.jsonl` |
| "画这张帕累托前沿 / 供应链网络拓扑图" | `figure-plot` | 矢量 PDF，Times New Roman，字体已嵌入 |
| "润色一下 Introduction" | `paper-polish` | 修改后的 LaTeX，标记原样保留 |
| "审一遍用词"（润色之后） | `jargon-check`（点名调用） | 陌生审稿人视角的黑话审计 |
| "投稿前把参考文献全查一遍" | `reference-verify` | 字段级核对表 + 严重度分级 |
| "像审稿人一样审这篇稿子" | `paper-review` | 三审稿人评审报告 + C/M/N 意见清单 |
| "按审稿意见逐条写回复" | `rebuttal` | `\changed{}` 标注、编译后的 PDF、更新的回复信 |
| "把这篇论文改成 15 分钟的报告" | `academic-ppt` | Beamer 幻灯、控时讲稿、演讲者备注 |

## 安装

**按你使用的工具选路径：**

- 用 **Claude Code / Codex / ZCode** → 方式一，插件——安装与更新由插件客户端管理。
- 用**其他任何兼容 Agent Skills 的 Harness**，或同时用多个 → 方式二，`install.sh`——一个符号链接汇聚点加按 Harness 扇出，不污染 `$HOME`。
- **Gemini CLI、Goose、opencode、Kimi Code、pi** 原生读取 `~/.agents/skills`，方式二即可全覆盖。

### 方式一：插件（Claude Code / Codex / ZCode）

Claude Code——本仓库自带市场清单，先添加市场再安装：

```bash
claude plugin marketplace add pengkangzhen/scientific-research-plugin
claude plugin install scientific-research-plugin@scientific-research-plugin
```

Codex——先添加市场，再在 `~/.codex/config.toml` 启用：

```bash
codex plugin marketplace add pengkangzhen/scientific-research-plugin
```

```toml
[plugins."scientific-research-plugin@scientific-research-plugin"]
enabled = true
```

ZCode——本仓库自带插件市场清单（`.claude-plugin/marketplace.json`，source 解析到仓库根）：

1. 克隆仓库到本地，取其根目录路径。
2. 插件市场 → 添加 → 添加插件市场，粘贴仓库根目录。
3. 个人 → scientific-research-plugin → 科研流水线插件 → 安装。

`jargon-check` subagent 不随 ZCode 插件包分发（ZCode 插件清单目前只声明 skills / commands / hooks / MCP servers，不含 subagent）——需要时执行 `./install.sh` 安装。

### 方式二：技能直装（任何兼容 Agent Skills 的 Harness）

```bash
git clone https://github.com/pengkangzhen/scientific-research-plugin.git
cd scientific-research-plugin
./install.sh          # 幂等：~/.agents/{skills,agents} + 按已装 Harness 扇出
```

验证：

```bash
ls ~/.agents/skills    # 9 个技能
ls ~/.agents/agents    # jargon-check subagent
```

`install.sh` 先把全部内容落链到 `~/.agents/skills`——Agent Skills 开放标准位置（Anthropic 于 2025 年 12 月开源该格式，已有 40+ 工具采纳）——再扇出到使用自有目录的 Harness。扇出只作用于检测到已安装的 Harness，不会污染 `$HOME`；新装某个 Harness 后重跑一次 `./install.sh` 即可。

| Harness | 技能目录 | 接入方式 |
|---|---|---|
| Gemini CLI | `~/.agents/skills`（`~/.gemini/skills` 的别名） | 原生；或 `gemini skills install <repo> --path skills` |
| Goose | `~/.agents/skills` | 原生 |
| opencode | `~/.agents/skills`（也读 `~/.claude/skills`） | 原生 |
| Kimi Code | `~/.agents/skills` 或 `~/.config/agents/skills`（还读 `~/.kimi`、`~/.claude`、`~/.codex`） | 原生 |
| pi | `~/.agents/skills`（项目级 `.agents/skills`） | 原生 |
| Cursor | `~/.cursor/skills` | 扇出 |
| Crush | `~/.config/crush/skills` | 扇出 |
| GitHub Copilot CLI | `~/.copilot/skills` | 扇出；也可用 `gh skill`（预览版）从 GitHub 安装 |
| Amp | `~/.config/agents/skills`（项目级 `.agents/skills`） | 扇出，以 `~/.config/amp` 判定已安装 |
| Grok Build | `~/.grok/skills`（项目级 `.grok/skills`） | 扇出 |
| Qwen Code | `~/.qwen/skills` | 扇出 |
| Droid | `~/.factory/skills`（项目级 `.factory/skills`） | 扇出 |
| Kiro | `~/.kiro/skills`（工作区级 `.kiro/skills`） | 扇出 |

未覆盖：iFlow CLI（项目级 `.iflow/` 自有布局 + 技能市场体系，无用户级技能目录可扇出）。

清单之外的助手仍可用 `halter sync --apply` 分发。`jargon-check` subagent 在扇出目标中没有对应机制（它们没有 subagent 概念）——经 `~/.agents/agents` 到达 Claude 系 Harness。

## 目录结构

```
├── skills/                      # 9 个自动触发技能（唯一事实源）
│   ├── research-before-build/
│   ├── zotero-paper-fetch/
│   ├── zotero-paper-note/
│   ├── figure-plot/
│   ├── paper-polish/
│   ├── paper-review/
│   ├── reference-verify/
│   ├── rebuttal/
│   └── academic-ppt/
├── attic/                       # 退役技能，保留溯源
│   └── academic-paper-review/   # 7-agent 期刊评审模拟（上游：academic-research-skills）
├── agents/
│   └── jargon-check.md          # 隔离审计 subagent
├── .claude-plugin/
│   ├── plugin.json              # Claude Code 插件清单
│   └── marketplace.json         # Claude Code / ZCode 市场清单（source 指向仓库根）
├── .zcode-plugin/plugin.json    # ZCode 插件清单
├── .codex-plugin/plugin.json    # Codex 插件清单
├── .agents/plugins/marketplace.json  # Codex（~/.agents）市场清单
└── install.sh                   # 裸装：~/.agents 汇聚 + 按已装 Harness 扇出
```

## 维护约定

- 修改任何 skill 一律改本仓库，`install.sh` 是 symlink——本机即时生效，推送即发布。
- 版本号变更需同步四处并保持一致：三个插件清单（`.claude-plugin/`、`.zcode-plugin/`、`.codex-plugin/`）与 `.claude-plugin/marketplace.json` 条目。
- 每次发版需向官方 ZCode 市场（zai-org/zcode-plugins 的 `plugins/scientific-research-plugin/`）提同步 PR，`version` 与 `description_i18n` 必须逐字一致（官方 `validate.py` 强制校验）；公告发布前先确认对方 `marketplace.json` 确实列出了新版本。
- `academic-paper-review` 已退役归档至 `attic/`（上游：academic-research-skills）；其有效机制（致命缺陷四标准、实验红线、Devil's Advocate 攻击维度）已并入 `paper-review`。完整来源谱系见 `skills/paper-review/references/source-basis.md`。
- 本仓库为 v5：v1 只含 4 个写作技能；v2 扩展为科研全流程；v3 加入纪律层 `research-before-build`（⓪）与汇报层 `academic-ppt`（⑦）并将 `scientific-review` 更名为 `paper-review`；v4 将 `paper-review` 重构为三盲审对抗评审团（nature-reviewer 式架构、OR/ML+OR 领域 gate、作者辩护仲裁），并退役 `academic-paper-review`；v5 新增 `reference-verify`（⑤ 投稿前参考文献体检，从一次全稿引用核查实战凝练的三层核查法）——共 9 skill + 1 subagent。

## License

MIT
