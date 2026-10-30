# code-review-kit

[English](./README.md)

面向 ZCode 的结构化代码评审、提交信息与 PR 描述生成——完全由 agent 在本地 git diff 上完成。无需 API 密钥、无需外部服务、无运行时依赖：所有能力都以技能或斜杠命令的形式指导 agent 工作，因此任何能运行 ZCode 的机器都可以使用。

## 功能一览

| 能力 | 调用方式 | 输出 |
| --- | --- | --- |
| 代码评审 | `/review` 命令，或直接说"帮我评审改动" | 按严重程度分组的发现（`file:line — 问题 — 影响 — 建议修复`）与合并结论 |
| 约定式提交 | `/commit` 命令 | 基于暂存 diff 生成的 Conventional Commits 提交信息，提交前检查密钥泄露与调试残留 |
| PR 描述 | `/pr` 命令 | 可直接复制的 PR 标题与正文：摘要、按模块分组的变更、测试步骤、风险说明 |

当你让 ZCode 评审 diff、检查最近的改动或在提交前审计代码时，`code-review` 技能也会自动触发。

## 工作原理

评审者就是 agent 本身。命令与技能教会它一套方法：

1. **确定变更集** —— 暂存 diff、未暂存 diff，或显式指定的 `base..head` 区间 / 分支 / 文件。
2. **读上下文，而不是只看 diff** —— 读取每个 hunk 周围的完整文件；签名或行为变化时检查所有调用方。
3. **按严重程度排序的检查清单** —— 🔴 正确性与安全性（阻塞发布）、🟡 可靠性、性能与测试覆盖、🔵 可维护性。
4. **可执行的报告** —— 每个发现一行，每个严重级别明确说明"无发现"，最后给出合并前必须修复的结论。

评审是只读的：除非你要求修复，否则不会修改任何文件。如果 diff 中出现密钥，报告会将其脱敏并建议轮换该凭据。

## 目录结构

```text
code-review-kit/
├── .zcode-plugin/
│   └── plugin.json                  # 清单（必需）
├── commands/
│   ├── review.md                    # /review —— 按严重程度分组的 diff 评审
│   ├── commit.md                    # /commit —— 基于暂存 diff 的约定式提交
│   └── pr.md                        # /pr —— PR 标题与描述
├── skills/
│   ├── code-review/
│   │   └── SKILL.md                 # 完整评审方法（按上下文触发）
│   └── conventional-commits/
│       └── SKILL.md                 # 提交信息格式参考
├── README.md
└── README_CN.md
```

清单中的组件字段（`commands` / `skills`）为显式声明，指向上述标准路径。

## 使用示例

```text
/review                          # 评审暂存改动（若为空则评审未暂存改动）
/review main..HEAD               # 对照 main 评审整个分支
/review src/auth/                # 评审指定路径
/commit                          # 感知暂存状态的约定式提交
/pr                              # 针对仓库默认分支生成 PR 描述
/pr develop                      # 针对指定基础分支生成 PR 描述
```

报告语言跟随对话语言；提交信息本身保持 Conventional Commits 形式（英文类型与主题），以便工具链解析。

## 隐私

本插件不向任何地方发送数据。diff 通过 git 在本地读取，评审输出在会话内生成。对话内容是否会离开你的机器由你的 ZCode / 模型服务方设置决定，与本插件无关。
