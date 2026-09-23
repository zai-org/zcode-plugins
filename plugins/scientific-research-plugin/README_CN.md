# Scientific Research Plugin

[English](README.md) | **简体中文**

任何任务都是一次科学研究，论文只是最完整的实例。`research-before-build` 纪律层把先例调研带到一切项目；论文管线——文献获取 → 结构化阅读 → 论文出图 → 写作润色 → 参考文献核查 → 投稿前评审 → 审稿回复 → 会议汇报——是它的完整落地。面向 OR / ML+OR / 供应链研究者。

一份 `skills/` 事实源，多端分发：Claude Code / ZCode / Codex 插件、原生读取 `~/.agents/skills` 的助手（Gemini CLI、Goose、opencode、Kimi Code、pi），以及由 `install.sh` 扇出到各自专属目录的 Harness（Cursor、Crush、Copilot、Amp、Grok Build、Qwen Code、Droid、Kiro）。

## 科研流水线

| 阶段 | Skill / Agent | 形态 | 一句话 |
|---|---|---|---|
| ⓪ 调研 | `research-before-build` | skill | 纪律层，适用于**任何**非琐碎任务：L0–L3 分级触发，动手前先查人类先例（官方文档 / 成熟开源 / GitHub issues / 文献）；决定"是否调研、调研什么" |
| ① 检索 | `zotero-paper-fetch` | skill | 文献清单 → CrossRef 补全 → Zotero 入库 → 分层下载 PDF（OA 直链 / 仓库反爬 / 校园 VPN 付费墙）|
| ② 阅读 | `zotero-paper-note` | skill | Zotero 条目 → 深度阅读 → 结构化笔记回写 Zotero + `literature.jsonl` |
| ③ 实验 | `figure-plot` | skill | 图契约 → Times New Roman / 色盲安全 → 矢量 PDF 嵌字体验证；数据图 + 示意图 |
| ④ 写作 | `paper-polish` | skill | LaTeX 语言润色，保留全部标记；附术语审计 follow-up |
| ④ 写作 | `jargon-check` | **subagent** | 隔离上下文 + 独立模型的黑话审计——陌生审稿人视角，避免同模型自我盲区 |
| ⑤ 投稿前 | `paper-review` | skill | 三盲审对抗评审团：3 名相互隔离的审稿人（方法严谨 / 领域贡献 / 对抗攻击）→ 作者辩护仲裁 → 交叉综合；主张-证据锚定、期刊画像评分轴，C/M/N 意见清单直供 `rebuttal`。引擎领域无关，领域 gate 按稿检测、自由组合（内置：OR 各族、ML+OR、LLM/agent；可扩展） |
| ⑤ 投稿前 | `reference-verify` | skill | 参考文献体检：官方 API 机核（CrossRef / arXiv / PMLR / OpenReview / ACL Anthology / NeurIPS，命令取事实、零模型回忆）→ 机核未决条目联网核查（证据必须带可访问 URL）→ 存疑结论独立复核；字段级核对表 + 严重度分级 + 预印本升级建议 |
| ⑥ 回复 | `rebuttal` | skill | 逐条定位审稿意见 → 修改方案确认 → `\changed{}` 标注 → 编译 PDF → 更新回复信 |
| ⑦ 汇报 | `academic-ppt` | skill | 论文（LaTeX/PDF）→ Beamer + 视觉设计系统（官方模板提取或自建）→ 按时长写讲稿 → 合规 pptx 包装与演讲者备注 |

### 纪律层与管线层

- **纪律层（⓪）**：`research-before-build` 作用于任何非琐碎任务——写代码、部署、架构选型皆然，不限于论文。它是整个技能包的世界观：动手前先查先例、按风险分级检索、按信任层级采信、以决策影响验收。
- **管线层（①–⑦）**：论文生命周期，是这套纪律最完整的实例化——从一份参考文献清单到会议演讲。

⓪ → ① 是上下游而非包含：`research-before-build` 决定"是否调研、调研什么"；`zotero-paper-fetch` 把确定的文献清单获取入库。

### Skill 与 Subagent 的分界

- **skill**：描述自动触发，主对话内运行——适合流程编排（检索、润色、审稿、回复）。
- **subagent**：显式点名调用，隔离会话——适合需要"局外人视角"的审计（`jargon-check` 的核心价值正在于此：换模型、换上下文，专查写作模型的用词盲区）。

## 安装

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
- `academic-paper-review` 已退役归档至 `attic/`（上游：academic-research-skills）；其有效机制（致命缺陷四标准、实验红线、Devil's Advocate 攻击维度）已并入 `paper-review`。完整来源谱系见 `skills/paper-review/references/source-basis.md`。
- 本仓库为 v5：v1 只含 4 个写作技能；v2 扩展为科研全流程；v3 加入纪律层 `research-before-build`（⓪）与汇报层 `academic-ppt`（⑦）并将 `scientific-review` 更名为 `paper-review`；v4 将 `paper-review` 重构为三盲审对抗评审团（nature-reviewer 式架构、OR/ML+OR 领域 gate、作者辩护仲裁），并退役 `academic-paper-review`；v5 新增 `reference-verify`（⑤ 投稿前参考文献体检，从一次全稿引用核查实战凝练的三层核查法）——共 9 skill + 1 subagent。

## License

MIT
