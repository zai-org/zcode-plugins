# Usage Report（用量统计）

ZCode 插件：在每次模型回复的末尾自动附上一行真实测量的用量统计：

```
📊 用量统计｜上轮 ↑1.2k ↓100 ⏱2s/2m01s｜累计 ↑3.6k ↓300 ⏱6s/5m01s
```

- `↑` 输入 tokens（含缓存读）　`↓` 输出 tokens
- `⏱` 纯算耗时 / 墙钟跨度（跨度包含轮与轮之间的空闲时间）
- 上轮 = 上一轮对话　累计 = 本会话至今全部

## 工作机制

- `UserPromptSubmit` 钩子在每条用户消息时运行 `scripts/report_usage.py`。
- 脚本解析本会话的本地 ZCode 会话日志（`~/.zcode/cli/rollout/model-io-<会话id>.jsonl`），只读取每条模型请求记录的 `response.usage` 字段（`inputTokens`、`outputTokens`、`cacheReadTokens`）、`durationMs` 和 `completedAt`；不读取、不处理、不存储任何对话内容。
- 以 `additionalContext` 注入测量结果，并要求模型在回复末尾原样附上该行。
- **零额外回合**：不使用 Stop 延续，不会出现独立的统计回合。代价是数据截至上一轮，本次回复自身的消耗在下一轮计入。
- 会话第一条消息（尚无记录）静默跳过。
- 记账状态存于 `~/.zcode/usage-report-plugin/state/`，插件升级不会重置。

## 副作用与依赖

| 方面 | 说明 |
| --- | --- |
| 钩子 | `UserPromptSubmit` → 执行 `scripts/report_usage.py`（本地 `python3`，无网络） |
| 文件读取 | `~/.zcode/cli/rollout/model-io-*.jsonl`（仅用量字段） |
| 文件写入 | `~/.zcode/usage-report-plugin/state/*.json`（小型计数文件） |
| 网络访问 | 无 |
| 第三方代码/素材/服务 | 无，仅 Python 标准库 |
| 凭据 | 不访问任何凭据 |
| 运行时 | `python3`（macOS / Linux 自带） |

说明：

- 统计口径为 token；各平台通常不提供本地 "credits" API，因此不报告 credits 数值。
- 插件源码中不含凭据、机器专属路径、缓存或构建产物。

## 安装

在 ZCode 中：**插件市场 → Add → Add Plugin Marketplace** 添加 `zai-org/zcode-plugins` 市场（收录后官方市场内直接可见），然后 **Usage Report → Install**。新开会话，从第二次回复起即可看到统计行。

## 许可证

MIT
