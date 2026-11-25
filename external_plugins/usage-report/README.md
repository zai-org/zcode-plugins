# Usage Report

A ZCode plugin that appends one measured usage line to the end of every model reply:

```
📊 用量统计｜上轮 ↑1.2k ↓100 ⏱2s/2m01s｜累计 ↑3.6k ↓300 ⏱6s/5m01s
```

- `↑` input tokens (including cache reads) · `↓` output tokens
- `⏱` pure compute time / wall-clock span (span includes idle time between turns)
- 上轮 = last turn · 累计 = the whole session so far

## How it works

- A `UserPromptSubmit` hook runs `scripts/report_usage.py` on every user message.
- The script parses this session's local ZCode rollout log (`~/.zcode/cli/rollout/model-io-<session>.jsonl`) and reads only the `response.usage` fields (`inputTokens`, `outputTokens`, `cacheReadTokens`), `durationMs` and `completedAt` of each recorded model request. Message contents are not read, processed, or stored.
- It injects the measured numbers as `additionalContext` with an instruction to append the line verbatim at the end of the reply.
- **Zero extra turns**: no Stop-continuation is used, so no separate stats-only turn appears. Trade-off: the numbers cover everything up to the previous turn; the current reply's own usage is counted on the next turn.
- The first message of a session (no records yet) is silently skipped.
- Bookkeeping state lives in `~/.zcode/usage-report-plugin/state/` and survives plugin upgrades.

## Side effects and requirements

| Aspect | Detail |
| --- | --- |
| Hooks | `UserPromptSubmit` → executes `scripts/report_usage.py` (local `python3`, no network) |
| File reads | `~/.zcode/cli/rollout/model-io-*.jsonl` (usage fields only) |
| File writes | `~/.zcode/usage-report-plugin/state/*.json` (small counters) |
| Network access | None |
| Third-party code/assets/services | None, stdlib Python only |
| Credentials | None accessed |
| Runtime | `python3` (bundled on macOS/Linux) |

Notes:

- Stats are token-based; most platforms do not expose a local "credits" API, so credits are not reported.
- No credentials, machine-specific paths, caches, or build artifacts are included in the plugin source.

## Install

In ZCode: **Plugin Marketplace → Add → Add Plugin Marketplace** and add the `zai-org/zcode-plugins` market (or install from the built-in official market once published), then **Usage Report → Install**. Open a new session and the stats line appears from the second reply onward.

## License

MIT
