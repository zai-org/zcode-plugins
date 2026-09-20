---
description: 查看 Command Code 额度用到什么程度（5 小时窗口 / 每周窗口 / 余额）
argument-hint: "[--md | --compact | --json | --verbose | --demo hot]"
---

查看 Command Code 额度用量。

执行下面整段（已包含脚本定位，直接整段运行即可）：

```bash
CC_SCRIPT="@@CC_USAGE_SCRIPT@@"
if [ ! -f "$CC_SCRIPT" ]; then
  for d in "$HOME/.zcode" "$HOME/.claude" "$HOME/.agents" "$HOME/.codex"; do
    CC_SCRIPT=$(find "$d" -type f -name cc-usage.mjs -print -quit 2>/dev/null)
    [ -n "$CC_SCRIPT" ] && break
  done
fi
[ -f "$CC_SCRIPT" ] || { echo "找不到 cc-usage.mjs，插件可能未正确安装或已被移动。"; exit 2; }
node "$CC_SCRIPT" $ARGUMENTS
```

然后把输出**原样放进代码块**给用户：数字、进度条、重置倒计时都不要改写，也不要把面板重排成你自己画的表格。

面板本身已经把结论说完了，正常情况下**不要再加解释**。只有两种情况各补一句：

- 出现 `⚠` 告警行时，说清是哪个窗口、大概什么时候耗尽；
- 用户问「够不够跑完某个任务」时，引用面板里的「还能跑约 N 次」结合任务规模判断，并提醒该估算基于他本周期实际的模型组合。

若命令报错，把报错原文给用户，并按提示排查（凭证来源见 README）。

用户明确想要图形化大图时才用 `--html --open` 或 `--serve`；不要主动建议打开网页，面板在对话里就能看完。
