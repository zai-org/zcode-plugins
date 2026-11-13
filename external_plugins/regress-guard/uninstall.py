#!/usr/bin/env python3
"""regress-guard 卸载器（批191 Python 化：Windows 10+ 原生可用）。

用法：python uninstall.py   （POSIX 也可 bash uninstall.sh——薄委托本脚本）

清理：
  1. 清理 ~/.zcode/skills/ 下的旧版 skill（v1.95.1 起带所有权检查：
     仅删含 .regress-guard-skill 标记的目录，其余只提示人工确认）
  2. 删除 ~/.zcode/commands/ 下的 regress-* 命令（命名空间专属，安全）
  3. 删除 ~/.zcode/regress-guard-hooks/
  4. 从 config.json 移除 hook 注册（批191 修正：走 REGRESS_ZCODE_HOME
     覆写——install.sh 时代 heredoc 硬编码 ~/.zcode，沙箱测试清不到覆写路径）
  5. 从 AGENTS.md 移除回归契约块

安全：不会删除用户的其他 skill/命令/config 字段。
"""
import json
import os
import re
import shutil

ZCODE_HOME = os.environ.get("REGRESS_ZCODE_HOME") or os.path.join(os.path.expanduser("~"), ".zcode")
HOOK_HOME = os.path.join(ZCODE_HOME, "regress-guard-hooks")
CONFIG_FILE = os.path.join(ZCODE_HOME, "cli", "config.json")
AGENTS_FILE = os.path.join(ZCODE_HOME, "AGENTS.md")

# 与 self_heal REQUIRED_COMMANDS 同源（P1#6）
COMMANDS = [
    "regress-init", "regress-plan", "regress-track", "regress-verify",
    "regress-quick", "regress-bypass", "regress-learn", "regress-evolve",
    "regress-trace", "regress-resume", "regress-finish", "regress-stats",
    "regress-characterize", "regress-install", "regress-uninstall",
    "regress-update",
]


def info(msg: str) -> None:
    print("✅ " + msg)


def warn(msg: str) -> None:
    print("⚠️  " + msg)


def clean_legacy_skills() -> None:
    """旧版 skills 清理（v1.95.1，124：所有权检查）。

    现版本已不装 skill；这 6 个名字是旧版遗产。判定：skill 目录内含
    .regress-guard-skill 标记文件才自动删；否则只提示人工确认
    （宁可不删也不错删）。"""
    for skill in ("regression-planning", "characterization-testing",
                  "change-impact-analysis", "requirement-parsing",
                  "adaptive-thinking", "adaptive-learning"):
        d = os.path.join(ZCODE_HOME, "skills", skill)
        if os.path.isdir(d):
            if os.path.exists(os.path.join(d, ".regress-guard-skill")):
                shutil.rmtree(d)
                info(f"清理旧 skill（含所有权标记）: {skill}")
            else:
                warn(f"跳过 {skill}：无所有权标记（可能是用户自建同名 skill）——")
                print(f"      确认非自建后手动删除：rm -rf {d}")


def remove_commands() -> None:
    for cmd in COMMANDS:
        f = os.path.join(ZCODE_HOME, "commands", f"{cmd}.md")
        if os.path.exists(f):
            os.remove(f)
            info(f"删除命令: {cmd}")
    # 批192：清扫旧冒号命名残留（改名前的死文件不在 COMMANDS 清单内）
    import glob
    for legacy in glob.glob(os.path.join(ZCODE_HOME, "commands", "regress:*.md")):
        try:
            os.remove(legacy)
            info(f"回收旧命名残留: {os.path.basename(legacy)}")
        except OSError:
            pass


def remove_hook_home() -> None:
    if os.path.isdir(HOOK_HOME):
        shutil.rmtree(HOOK_HOME)
        info(f"删除 hook 脚本: {HOOK_HOME}")


def unregister_hooks() -> None:
    """P1#6 统一清理：所有事件、所有条目——凡 command/args 里带 regress-guard
    痕迹的 hook 一律摘除（旧实现按脚本名逐事件过滤漏 6 条死钩子）。"""
    if not os.path.exists(CONFIG_FILE):
        return
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            config = json.load(f)
    except Exception:
        return

    hooks = config.get("hooks", {})
    events = hooks.get("events", {})

    def _is_ours(h):
        blob = str(h.get("command", "")) + " " + str(h.get("args", []))
        return ("regress-guard" in blob or "launcher.js" in blob
                or any(s in blob for s in (
                    "read_before_edit", "prompt_intercept", "reflection_check",
                    "self_heal", "boundary_guard", "execution_valve",
                    "fail_watch", "risk_watch", "compact_notice", "stop_notify",
                    "pre_commit_guard", "plan_bridge")))

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
    config["hooks"] = hooks

    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    info("hook 注册已移除")


def clean_agents() -> None:
    if not os.path.exists(AGENTS_FILE):
        return
    with open(AGENTS_FILE, encoding="utf-8") as f:
        content = f.read()
    pattern = r"<!-- regress-guard start -->.*?<!-- regress-guard end -->\n*"
    new = re.sub(pattern, "", content, flags=re.DOTALL).rstrip() + "\n"
    with open(AGENTS_FILE, "w", encoding="utf-8") as f:
        f.write(new)
    info("AGENTS.md 回归契约已移除")


def remove_docs() -> None:
    d = os.path.join(ZCODE_HOME, "regress-guard-docs")
    if os.path.isdir(d):
        shutil.rmtree(d)
        info("删除文档")


def main() -> None:
    print("════════════════════════════════════════════")
    print("  regress-guard 卸载")
    print("════════════════════════════════════════════")
    print()
    clean_legacy_skills()
    remove_commands()
    remove_hook_home()
    unregister_hooks()
    clean_agents()
    remove_docs()
    print()
    print("════════════════════════════════════════════")
    print("  ✅ regress-guard 已卸载")
    print("════════════════════════════════════════════")
    print()
    print("项目的 .regress/ 目录未删除（保留历史数据）。")
    print("如需彻底清理项目，手动删除项目中的 .regress/ 文件夹。")


if __name__ == "__main__":
    main()
