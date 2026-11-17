---
description: 显示会话统计（轮次/步数/耗时/TTFT/TPS/token/缓存命中）
---

请调用 session-stats MCP 服务器的 get_stats 工具查询会话统计。scope 取值：当参数含「今日」「today」时用 `today`，否则用 `current`。

拿到 structuredContent 后，**严格按数据输出**下面的中文统计卡片（不要编造/估算任何数据里没有的数值，缺失显示「—」）：

```
⏱ {turns} 轮 {steps} 步 · {tps} tok/s
Σ {tokens.total} tok · 缓存命中 {cache_hit_pct}%
────────────────────────
模型用时        {model_ms 格式化为 时/分/秒}
工具调用用时    {tool_ms}
首 token 平均   {ttft_ms_avg}
输出速度(TPS)   {tps} tok/s
输入(含缓存)    {tokens.input}（缓存读 {tokens.cache_read} / 缓存写 {tokens.cache_write}）
输出            {tokens.output}（含推理 {tokens.reasoning}）
总计            {tokens.total}
```

- `today` 口径：开头注明「今日 {sessions} 个会话汇总」。
- `current` 口径：结尾注明「会话 {session_id} · 含子代理 {subagent_count} 个」。
- 若返回 isError 或 error 字段，如实转述错误并提示检查插件 server 日志。

参数：$ARGUMENTS
