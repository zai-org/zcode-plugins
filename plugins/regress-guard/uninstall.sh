#!/usr/bin/env bash
# regress-guard 卸载器
#
# 用法：bash uninstall.sh
#
# 清理：
#   1. 删除 ~/.zcode/skills/ 下的 3 个 skill
#   2. 删除 ~/.zcode/commands/ 下的 7 个命令
#   3. 删除 ~/.zcode/regress-guard-hooks/
#   4. 从 config.json 移除 hook 注册
#   5. 从 AGENTS.md 移除回归契约块
#
# 安全：不会删除用户的其他 skill/命令/config 字段。

set -euo pipefail

ZCODE_HOME="${HOME}/.zcode"
HOOK_HOME="${ZCODE_HOME}/regress-guard-hooks"
CONFIG_FILE="${ZCODE_HOME}/cli/config.json"
AGENTS_FILE="${ZCODE_HOME}/AGENTS.md"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
info()  { echo -e "${GREEN}✅${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠️${NC} $1"; }

echo "════════════════════════════════════════════"
echo "  regress-guard 卸载"
echo "════════════════════════════════════════════"
echo ""

# ─── 1. 删除旧版 skills（兼容清理）──────────────────
for skill in regression-planning characterization-testing change-impact-analysis requirement-parsing adaptive-thinking adaptive-learning; do
    if [ -d "${ZCODE_HOME}/skills/${skill}" ]; then
        rm -rf "${ZCODE_HOME}/skills/${skill}"
        info "清理旧 skill: ${skill}"
    fi
done

# ─── 2. 删除 commands（与 self_heal REQUIRED_COMMANDS 同源，P1#6 补 resume/finish/stats）───
for cmd in regress:init regress:plan regress:track regress:verify regress:quick regress:bypass regress:learn regress:evolve regress:trace regress:resume regress:finish regress:stats regress:characterize regress:install regress:uninstall regress:update; do
    f="${ZCODE_HOME}/commands/${cmd}.md"
    if [ -f "$f" ]; then
        rm "$f"
        info "删除命令: ${cmd}"
    fi
done

# ─── 3. 删除 hook 脚本 ────────────────────────────────
if [ -d "${HOOK_HOME}" ]; then
    rm -rf "${HOOK_HOME}"
    info "删除 hook 脚本: ${HOOK_HOME}"
fi

# ─── 4. 从 config.json 移除 hook ──────────────────────
if [ -f "${CONFIG_FILE}" ]; then
    python3 << 'PYEOF'
import json, os, re

config_path = os.path.expanduser("~/.zcode/cli/config.json")
try:
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)
except Exception:
    exit(0)

hooks = config.get("hooks", {})
events = hooks.get("events", {})

# P1#6 统一清理：所有事件、所有条目——凡 command/args 里带 regress-guard 痕迹的
# hook 一律摘除（旧实现按脚本名逐事件过滤：Stop 只滤 reflection_check 漏掉
# stop_notify、PreToolUse 漏 boundary_guard/execution_valve、PostToolUseFailure
# 与 SessionStart(compact) 完全不清——卸载后 6 条死钩子指已删目录，每次工具调用报错）
def _is_ours(h):
    blob = str(h.get("command", "")) + " " + str(h.get("args", []))
    return ("regress-guard" in blob or "launcher.js" in blob
            or any(s in blob for s in (
                "read_before_edit", "prompt_intercept", "reflection_check",
                "self_heal", "boundary_guard", "execution_valve",
                "fail_watch", "risk_watch", "compact_notice", "stop_notify",
                "pre_commit_guard", "plan_bridge"))

for ev in list(events):
    cleaned = []
    for entry in events[ev]:
        filtered = [h for h in entry.get("hooks", []) if not _is_ours(h)]
        if filtered:
            cleaned.append({**entry, "hooks": filtered})
    if cleaned:
        events[ev] = cleaned
    else:
        events.pop(ev, None)

if not events:
    hooks.pop("events", None)
    # 如果 hooks 空了，保留 enabled（不影响其他东西）
config["hooks"] = hooks

with open(config_path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2, ensure_ascii=False)

print("已从 config.json 移除 hook 注册")
PYEOF
    info "hook 注册已移除"
fi

# ─── 5. 从 AGENTS.md 移除回归契约 ────────────────────
if [ -f "${AGENTS_FILE}" ]; then
    python3 << 'PYEOF'
import re, os
path = os.path.expanduser("~/.zcode/AGENTS.md")
content = open(path, encoding="utf-8").read()
pattern = r'<!-- regress-guard start -->.*?<!-- regress-guard end -->\n*'
new = re.sub(pattern, '', content, flags=re.DOTALL).rstrip() + '\n'
open(path, "w", encoding="utf-8").write(new)
print("已从 AGENTS.md 移除回归契约")
PYEOF
    info "AGENTS.md 回归契约已移除"
fi

# ─── 6. 清理文档（可选）──────────────────────────────
if [ -d "${ZCODE_HOME}/regress-guard-docs" ]; then
    rm -rf "${ZCODE_HOME}/regress-guard-docs"
    info "删除文档"
fi

echo ""
echo "════════════════════════════════════════════"
echo -e "${GREEN}  ✅ regress-guard 已卸载${NC}"
echo "════════════════════════════════════════════"
echo ""
echo "项目的 .regress/ 目录未删除（保留历史数据）。"
echo "如需彻底清理项目，手动删除项目中的 .regress/ 文件夹。"
