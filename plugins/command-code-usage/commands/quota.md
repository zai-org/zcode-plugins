---
description: 查看 Command Code 额度用量（5 小时窗口 / 每周窗口 / 余额）
argument-hint: "[--md | --compact | --json | --demo hot]"
---

```bash
ROOT="${ZCODE_PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}"
CC="$ROOT/scripts/cc-usage.mjs"
if [ ! -f "$CC" ]; then
  for d in "$HOME/.zcode" "$HOME/.claude" "$HOME/.codex" "$HOME/.grok" "$HOME/.dsh"; do
    CC=$(find "$d" -maxdepth 6 -type f -name cc-usage.mjs \( -path '*commandcode*' -o -path '*command-code*' \) -print -quit 2>/dev/null)
    [ -n "$CC" ] && break
  done
fi
[ -f "$CC" ] || { echo "找不到 cc-usage.mjs，插件可能未正确安装。"; exit 2; }
node "$CC" $ARGUMENTS
```

面板已经在上面了。**不要再重复输出一遍**——用 1 到 3 行给出结论即可：
最紧的是哪个窗口、还剩多少、什么时候重置。出现 `⚠` 告警时才多说一句风险。
