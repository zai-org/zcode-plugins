#!/bin/sh
# regress-guard 链外看门狗（v1.33 企业级）——不依赖 ZCode 钩子链存活。
# 病例背景：2026-08-28 config 空 matcher 掀翻整机钩子（hookCount:0 全天静默）——
# 治理系统自身死亡时，靠治理系统自身通知是不可能的。本脚本由 systemd timer 拉起，
# 与 ZCode 完全解耦：check_docs 失败 → notify.py（blocked 事件）→ 企微+本机声。
REPO="${REGRESS_GUARD_REPO:-$HOME/.zcode/workspace/default/regress-guard}"
LOG="$HOME/.zcode/watchdog.log"
ts() { date '+%m-%d %H:%M:%S'; }
if (cd "$REPO" && python3 scripts/check_docs.py >/dev/null 2>&1); then
  echo "$(ts) ok" >> "$LOG"
else
  echo "$(ts) FAIL check_docs rc=$?" >> "$LOG"
  cd "$REPO/.." || exit 1
  python3 "$REPO/hooks/scripts/lib/notify.py" . blocked \
    --title "🛑 治理链异常" \
    --body "check_docs 失败——钩子链可能已死（config 损坏/漂移）。诊断：check_docs.py 直跑 + 看门狗日志 $HOME/.zcode/watchdog.log" \
    >/dev/null 2>&1
fi
