---
description: 查看 Command Code 额度用量（5 小时窗口 / 每周窗口 / 余额）
argument-hint: "[--md | --compact | --json | --demo hot]"
---

运行下面这段，把面板留在工具输出里即可：

```bash
CC_SCRIPT="@@CC_USAGE_SCRIPT@@"
[ -f "$CC_SCRIPT" ] || CC_SCRIPT=$(find "$HOME/.zcode" "$HOME/.claude" "$HOME/.agents" "$HOME/.codex" -type f -name cc-usage.mjs -print -quit 2>/dev/null)
node "$CC_SCRIPT" $ARGUMENTS
```

**不要重复输出面板**——它在工具输出里已经完整可见。用 1 到 3 行给出结论：最紧的是哪个窗口、
还剩多少、什么时候重置。只有出现 `⚠` 告警时才多补一句风险。
