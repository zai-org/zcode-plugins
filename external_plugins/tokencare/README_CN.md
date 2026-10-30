# TokenCare

面向 [ZCode](https://z.ai) 的分层上下文压缩与省 token 优化插件。将 [billion-context](https://github.com/ranxianglei/billion-context)（增量、可逆的上下文压缩）与 [dsh-token-optimizer](https://github.com/Zoria-Lind/dsh-token-optimizer)（工具输出分级、重复读取消除、用量监控）的理念统一为一个插件——重叠部分合并，不做重复造轮子。

长会话会积累巨大的工具输出、反复读取同一文件、撑爆上下文窗口。TokenCare 用三层策略削减浪费，并通过磁盘上的"保险库（vault）"保证**一切皆可恢复**。

## 工作原理

| 层 | 作用 | 来源 |
|---|---|---|
| **L0 — 观测**（自动） | PostToolUse 钩子把每次工具结果的大小、哈希、文件路径记入会话账本；超过 3 万字符的输出会收到一行提示，引导使用 `/digest`；ZCode 压缩会话后，SessionStart(compact) 钩子提示通过保险库找回细节，绝不凭空猜测。 | dsh `monitor` + billion-context 会话统计与增长提示，合并为单一账本 |
| **L1 — 无损外存与去重** | `/digest` 将原文逐字存入保险库并生成结构感知摘要：错误 → 300 字符摘录，JSON → 结构概要，CSV → 表头 + 行数 + 首末行，文本 → 头尾截取。账本自动检测"同一文件未变更却重复读取"并按 token 估算量化浪费。 | dsh `outputLadder` + `fileDiff`，按 billion-context 思路做成可逆 |
| **L2 — 模型驱动压缩** | `/compress` 把会话中已稳定的部分写成结构化摘要存入保险库并登记索引，再以它为锚点配合 ZCode 内置 `/compact`。建议在约 45% 上下文压力时执行，而非等到 80% 以上才应急。 | billion-context `compress`/`decompress` + dsh `compactionDriver`，统一 |
| **恢复** | `/context-search` 在保险库的原文与摘要中检索；原文可完整取回。 | billion-context `search_context` |
| **统计** | `/token-status` 输出按工具的 token 估算、最大输出、重复读取、可回收空间、保险库总量，以及 MCP 服务裁剪建议。 | dsh `/token-status` + `monitor` + billion-context `acp_status`，统一 |

## 命令

- `/token-status` — token 统计与节省机会
- `/digest <文件 | "last output">` — 大输出外存，仅保留摘要
- `/compress [范围]` — 将已稳定的会话历史压缩为可逆摘要
- `/context-search <关键词>` — 从保险库找回细节

## GLM-5.3 Max / Flash Max 调优

token 估算针对 GLM 系分词器做了中英双语感知（中日韩 ≈ 每字符 1 token，ASCII ≈ 4 字符/token），中文密集会话不再被低估。策略按模型档位自动切换：`TOKENCARE_PROFILE=flash|balanced|max`（也可通过 `TOKENCARE_MODEL` / `ZCODE_MODEL` / `ANTHROPIC_MODEL` 或钩子载荷自动识别）：Flash 档 2 万字符即提示、约 35–40% 压力即压缩；balanced（默认）3 万 / 约 45%；Max 档 4 万才提示、约 55% 再压缩，优先消除重复读取与超大输出。`/token-status` 会显示当前档位与建议。

## 安装与依赖

- 启用插件功能的 ZCode。从收录本插件的插件市场安装。
- 钩子与保险库 CLI 需要 **PATH 中有 Node.js ≥ 16**（零 npm 依赖，仅标准库）。缺少 Node 时优雅降级：仅自动记账与 CLI 停止工作，任何会话都不会因此中断。

数据保存在 `<项目>/.zcode/tokencare/`（账本 + 保险库），目录自动自 gitignore。

权限与副作用说明：插件只读写项目内的 `.zcode/tokencare/` 目录；钩子在每次工具调用后本地执行一次 Node 脚本（无网络请求、无外部依赖）；不会删除或改写保险库中的任何原文。

## 设计决策

- **不做代理。** billion-context 以流改写代理方式工作；市场插件无法也不应拦截模型流量，TokenCare 改用钩子 + 技能 + 命令达成同样节省，并与 ZCode 内置压缩协作而非取代。
- **一个状态出口、一份账本。** 两个上游项目各有重叠的压缩驱动与监控，这里合并为单一账本与单一 `/token-status`。
- **未移植 text2img（dsh）。** 文本转图片省 token 需要视觉模型、API 密钥与各平台文字渲染，而 `/digest` 以零依赖、无损方式达到同样节省。
- **toolTrim 仅作建议。** 插件无法从请求中移除 MCP 工具 schema，`/token-status` 呈现 MCP 使用情况并建议在设置中停用闲置服务。

## 致谢与许可

MIT。设计受 [billion-context](https://github.com/ranxianglei/billion-context)（MIT + 署名条款）与 [dsh-token-optimizer](https://github.com/Zoria-Lind/dsh-token-optimizer)（MIT）启发并致谢；未复制任何代码，两个项目本身值得一读。
