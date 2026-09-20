---
description: 查看 Command Code 额度用量（5 小时窗口 / 每周窗口 / 余额）
argument-hint: "[--md | --compact | --json | --demo hot]"
---

```bash
CC_SCRIPT="@@CC_USAGE_SCRIPT@@"
[ -f "$CC_SCRIPT" ] || CC_SCRIPT=$(find "$HOME/.zcode" "$HOME/.claude" "$HOME/.agents" "$HOME/.codex" -type f -name cc-usage.mjs -print -quit 2>/dev/null)
node "$CC_SCRIPT" $ARGUMENTS
```

面板已经在上面了。**不要再重复输出一遍**——用 1 到 3 行给出结论即可：
最紧的是哪个窗口、还剩多少、什么时候重置。出现 `⚠` 告警时才多说一句风险。
