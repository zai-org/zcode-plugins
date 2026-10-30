# project-rules

[English](./README.md)

为 ZCode 补上 `CLAUDE.md` 与按路径生效的规则文件. ZCode 只从项目根目录读取 `AGENTS.md`, 从 Claude Code 或 Cursor 迁移过来的项目会丢失 `CLAUDE.md` 和按路径划分的规则. 本插件通过两个 Hook 把它们重新注入为模型上下文, 不会阻止, 修改或改写任何工具调用.

## 功能

| Hook | Matcher | 注入内容 |
| --- | --- | --- |
| `SessionStart` | 所有来源 (startup, resume, clear, compact) | 项目根目录的 `CLAUDE.md` (仅当同级没有 `AGENTS.md` 时), 以及 `.zcode/rules/*.md` 中所有没有 `paths:` 的规则 |
| `PreToolUse` | `Read\|Edit\|Write` | `paths:` glob 与工具 `file_path` 匹配的规则, 以及本会话中尚未送达的无路径规则 (例如内容有变化, 或超出 SessionStart 预算而被推迟的规则) |

每条规则在每个会话中只送达一次. 只有当规则文件内容发生变化, 或者发生新的 SessionStart (resume, clear, 上下文压缩) 时才会再次送达, 因为此时模型上下文已重新开始.

项目根目录即该会话的 ZCode 工作目录.

## 规则文件

把 Markdown 文件直接放在项目根目录的 `.zcode/rules/` 下. frontmatter 可选.

没有 `paths:` 的规则始终生效, 在会话开始时注入:

```markdown
完成任务前运行 `pnpm test`.
不要提交 dist/ 下的生成文件.
```

带 `paths:` 的规则在 Agent 读取, 编辑或写入匹配文件时生效. 例如 `.zcode/rules/typescript.md`:

```markdown
---
paths: src/**/*.ts, src/**/*.tsx
---
优先使用 `type` 别名而不是 `interface`.
使用 src/lib/log.ts 中的 logger, 不要用 console.log.
```

`paths:` 支持以下任意写法. Cursor 的 `globs:` 键可作为别名, 行尾的 `# 注释` 会被忽略.

```yaml
paths: src/**/*.{ts,tsx}, *.proto
paths: ["src/api/**", "docs/api/"]
paths:
  - src/db/**/*.sql
  - migrations/
globs: *.sql
```

### Glob 语法

| 模式 | 匹配 |
| --- | --- |
| `*` | 除 `/` 以外的任意字符 |
| `?` | 除 `/` 以外的单个字符 |
| `**` | 任意层目录, 包括零层: `src/**/*.ts` 同时匹配 `src/a.ts` 和 `src/x/y/a.ts` |
| `{a,b}` | 任选其一: `*.{ts,tsx}` |
| 模式中没有 `/` | 任意深度的文件名: `*.proto` 等同于 `**/*.proto` |
| 以 `/` 或 `./` 开头 | 锚定到项目根目录: `/README.md` |
| 以 `/` 结尾 | 该目录下的所有文件: `docs/` |

工具的 `file_path` 会先转换为相对项目根目录的路径 (绝对路径和相对路径都可以), 再以 `/` 作为分隔符匹配, 区分大小写. 无论按原样还是解析符号链接后都位于项目之外的 `file_path` 永远不会匹配. 不支持字符类 (`[abc]`) 和取反 (`!`). 每条规则只使用前 32 个 glob, 超过 256 个字符的 glob 会被忽略.

## 安装

GitHub 仓库本身就是一个独立的插件市场:

```shell
zcode plugins marketplace add https://github.com/dominiclafleur/zcode-project-rules
zcode plugins install project-rules@project-rules-marketplace
zcode plugins enable project-rules@project-rules-marketplace
```

在桌面端, 打开 **插件市场 -> 新建**, 粘贴同一个 URL, 然后安装并启用 `project-rules`.

如果插件已收录到官方插件市场, 可在 **设置 -> 插件** 中搜索 `project-rules` 安装.

安装或启用后请 **新建会话**. ZCode 在会话开始时为 Hook 配置建立快照.

环境要求: `PATH` 中有 16 或更高版本的 `node`. 插件没有 npm 依赖, 也不发起任何网络请求.

## 从 Claude Code 或 Cursor 迁移

- **CLAUDE.md**: 项目根目录没有 `AGENTS.md` 时可直接使用. 如果两者同时存在, ZCode 读取 `AGENTS.md`, 本插件跳过 `CLAUDE.md`, 以免同一份指令被加载两次. 请把 `CLAUDE.md` 中仍需要的内容合并到 `AGENTS.md`.
- **Claude Code 规则** (`.claude/rules/*.md`): 直接复制即可, 其中的 `paths:` frontmatter 可原样读取.

  ```shell
  mkdir -p .zcode/rules && cp .claude/rules/*.md .zcode/rules/
  ```

- **Cursor 规则** (`.cursor/rules/*.mdc`): 复制时把扩展名改为 `.md`. `globs:` 会被当作 `paths:` 读取. 没有 globs 的规则会变成始终生效, Cursor 的 `alwaysApply` 和 `description` 字段会被忽略.
- **不会迁移**: `CLAUDE.md` 中的 `@path` 导入 (保留为普通文本), `CLAUDE.local.md`, `~/.claude/CLAUDE.md`, `.claude/CLAUDE.md`, 子目录中的 `CLAUDE.md`, 以及 `.zcode/rules/` 的子目录.

## 限制

- **大小**: 每条规则截断为前 4000 个字符, `CLAUDE.md` 截断为前 8000 个字符. 被截断的内容末尾附有提示, 告诉模型 Read 原文件获取剩余内容. 单次注入上限为 12000 个字符, Hook 输出上限为 30000 字节, 低于 ZCode 32 KiB 的 Hook stdout 限制. 放不下的规则会推迟到之后适用于它们的 Read/Edit/Write 结果中送达, 并附有列出其中最多 5 条规则的提示.
- **时机**: PreToolUse 的上下文与工具结果一起送达模型. 在常见的先 Read 后 Edit 流程中, 模型会在编辑文件之前看到该文件的规则. 但新建文件的 `Write` 会在模型看到规则之前执行, 规则从后续编辑开始生效.
- **触发**: 只有带 `file_path` 的 `Read`, `Edit`, `Write` 调用会触发路径规则. Bash, Grep, Glob 和补丁式编辑不会触发. Hook 输入超过 1 MiB 的调用 (例如写入超大文件的 `Write`) 会被跳过.
- **发现**: 只读取 `.zcode/rules/` 目录下直接存放的 `*.md` 文件, 最多 200 个, 每个最大 1 MiB, 合计最多 2 MiB, 超出合计上限的文件会被跳过. 每次 Read/Edit/Write 调用都会重新读取规则文件, 因此修改无需重启即可生效.
- **根目录**: 只在 ZCode 工作目录中查找 `CLAUDE.md` 和 `.zcode/rules/`, 不会向上查找父目录.
- **开销**: 每次 Read/Edit/Write 调用都会启动一个短生命周期的 Node 进程, 通常耗时几十毫秒.

## 数据与副作用

- **读取**: 项目中的 `CLAUDE.md`, `AGENTS.md` 是否存在, 以及 `.zcode/rules/*.md`. 解析后指向项目之外的 `CLAUDE.md` 或规则文件符号链接会被跳过.
- **写入**: `${ZCODE_PLUGIN_DATA}/state.json` (未设置 `ZCODE_PLUGIN_DATA` 时为 `~/.zcode/project-rules/state.json`) 以及短暂存在的 `state.lock`. 状态文件保存会话 ID, 规则文件路径和内容哈希, 只有当前用户可以读取. 会话在最后一次写入状态 7 天后被清理, 写入发生在 SessionStart 时以及每次注入规则时. 不会向项目目录或插件目录写入任何内容.
- **没有** 网络访问, MCP 服务, 命令或技能. 除 `node` 进程本身外不执行任何程序.
- Hook 从不返回 deny, ask 或改写后的输入, 并且始终以 0 退出, 工具调用始终照常进行. 出现意外错误时不输出内容. 如果无法写入状态文件, SessionStart 的上下文仍会注入, 但 PreToolUse 不会注入任何内容.

## 故障排查

- **没有注入内容**: 启用插件后请新建会话. 确认 **设置 -> 钩子** 中列出了两个 `project-rules` Hook, 规则文件以 `.md` 结尾, 并且 frontmatter 之后的正文不为空.
- **诊断信息**: 在 ZCode 的启动环境中设置 `PROJECT_RULES_DEBUG=1`, Hook 会把诊断信息写到 stderr.
- **手动运行**: 在项目目录中执行以下命令, `<plugin-dir>` 为插件安装路径:

  ```shell
  printf '%s\n' '{"hookEventName":"PreToolUse","sessionId":"manual","cwd":"'"$PWD"'","toolName":"Read","toolInput":{"file_path":"src/index.ts"}}' \
    | ZCODE_PLUGIN_DATA=/tmp/project-rules-manual node <plugin-dir>/hooks/rules.js
  ```

## 开发

```shell
node test/test.mjs
```

自测不需要安装 ZCode, 也不需要插件市场. 它用 SessionStart 和 PreToolUse 负载启动 `hooks/rules.js`, 并检查以下场景的输出: 匹配与不匹配的路径, 去重, 内容变化后重新注入, 大小与读取预算, 恶意构造的 glob, 指向项目之外的符号链接, 并发调用, 过期或卡住的锁, 损坏或结构异常的状态文件, 过期会话清理, 超大的 stdin, 以及不可写或未设置的数据目录.

## 许可证

MIT. 见 [LICENSE](./LICENSE).
