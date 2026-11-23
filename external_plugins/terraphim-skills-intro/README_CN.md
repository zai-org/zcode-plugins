# Terraphim Skills Introduction

[English](./README.md)

本插件为 ZCode 提供三个 Community 技能：本地代码搜索、操作经验记录和智能体记忆。

## 安装

1. 安装命令依赖：

   ```shell
   brew tap terraphim/terraphim
   brew install terraphim-grep terraphim-agent
   ```

2. 验证已安装的命令：

   ```shell
   terraphim-grep --version
   terraphim-agent --version
   terraphim-agent learn --help
   terraphim-agent memory --help
   ```

3. 打开 **设置 → 插件管理 → 发现**，添加
   [Terraphim v0.2.4 个人市场](https://raw.githubusercontent.com/terraphim/terraphim-cursor-plugin/v0.2.4/marketplaces/zcode.json)，
   选择 **Terraphim Skills Introduction** 并安装。官方目录收录进度见
   [现有提交](https://github.com/zai-org/zcode-plugins/pull/13)。
4. 新建一个 ZCode 会话，使三个技能可以被智能体发现。

插件不会自动安装软件。没有 Homebrew 时，请按照
[Terraphim 安装指南](https://terraphim-skills.md/docs/non-technical/)
下载适合平台的发布归档，并用该版本的 `SHA256SUMS` 验证。

## 技能

| 技能 | 用途 | 示例请求 |
| --- | --- | --- |
| `terraphim-grep` | 在指定的本地代码和文档中搜索，默认离线。 | “使用 Terraphim Grep 查找授权回调并显示两行上下文。” |
| `terraphim-agent-learn` | 检查失败并记录经过验证的操作修正。 | “把这次部署失败的经验记录下来，供下次会话使用。” |
| `terraphim-agent-memory` | 保存明确提供的记忆，并读取实际 ID、内容和来源标签。 | “保存这条部署经验，再显示已保存的文本和 ID。” |

智能体在依赖可能变化的命令接口前会先检查 `--help`。搜索是只读操作。只有用户明确要求时，
学习和记忆技能才会写入数据。记忆捕获使用当前用户的操作系统本地存储，与工作目录无关；
项目目录或搜索图谱不会隔离该记忆存储。

## 试用两个命令行工具

[随附工作流](skills/terraphim-grep/references/workflows.md) 包含可复制命令、编辑器实际导出的
JSON 图谱，以及使用 [Clients 1.21.20](https://github.com/terraphim/terraphim-clients/releases/tag/v1.21.20)
验证的输出检查。请核对发布文件校验和及两个已安装版本；Homebrew 可能提供不同版本。
两个命令行工具需要单独安装。

概念笔记采用兼容 Logseq 的 Markdown 语法：

```markdown
# Risk
synonyms:: concern
```

按照[编辑器演示](https://terraphim.ai/how-tos/synonym-search/)创建替代词并导出图谱。
`--thesaurus` 读取导出的 JSON，不读取 Markdown 笔记。将工作流中的三段 Risk 文本放入
`corpus/` 后进行比较：

```shell
terraphim-grep Concern --search-only --haystack all --paths ./corpus --json -n 3
terraphim-grep Concern --search-only --haystack all --paths ./corpus \
  --thesaurus ./risk-concern.knowledge-graph.json --json -n 3
```

基线返回零段文本；共享图谱返回三段 Risk 文本。两次运行都关闭模型综合。
检查 `chunks` 中的来源路径和行号。

保存经验时，请明确提供内容：

```shell
terraphim-agent --format json memory capture \
  --content 'Risk requires a Decision: approve a second supplier as the mitigation.' \
  --provenance-tag 'public-project-brief' > captured-memory.json
memory_id="$(python3 -c 'import json; print(json.load(open("captured-memory.json"))["memory_id"])')"
terraphim-agent memory show "$memory_id" --json > saved-memory.json
```

在输出文件中核对返回的 ID、完整内容和 `provenance:public-project-brief` 标签。
另见[记忆演示](https://terraphim.ai/posts/cold-start-tax-agentic-memory/)
及[经过审核的命令修正钩子](https://terraphim.ai/posts/native-hook-support/)。图谱与记忆存储是独立输出。

## 权限与副作用

- 本插件不包含凭据、可执行文件、Hooks、后台任务或遥测。
- `terraphim-grep` 只读取用户为搜索指定的路径。
- `terraphim-agent learn` 写入项目已有的 `.terraphim` 学习存储，否则使用用户的全局存储。
  记忆捕获写入当前用户的操作系统本地存储。两者都只在用户明确要求后写入。
- 可选的模型综合功能可能把选定内容发送到用户配置的模型提供商，并可能产生该提供商的费用；
  除非用户明确要求，否则技能保持该功能关闭。
- 本插件只包含 Apache-2.0 Community 技能，不包含也不会解锁专有的 Core 或 Premium 指令。

可在 [Community、Core 和 Premium 技能目录](https://terraphim-skills.md/skills/)
中了解其他工作流。打开目录不会启动结账或付款。

隐私政策：<https://terraphim-skills.md/legal/privacy/>

服务条款：<https://terraphim-skills.md/legal/terms/>

产品信息：<https://terraphim-skills.md/>。
本插件适用随附的 [LICENSE](./LICENSE) 和 [NOTICE](./NOTICE)。
