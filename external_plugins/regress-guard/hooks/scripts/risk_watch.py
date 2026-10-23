#!/usr/bin/env python3
"""risk_watch — PostToolUse 探测器（风险动作 + 命令重复普查，用户无感层）。

只写事实，不做判断（判断由 reflection_check 统一完成——探测器哑、评估器独裁）：
  1. 破坏性/不可逆动作 → risk 事件（高精度模式，宁可漏报不误报）
  2. 成功执行的 Bash 命令 → usage 普查（供"原地打转"检测：变体重试硬闯）
  3. 清单编辑 → 审批化石（plan_created/refined/approved/cancelled 入地层）

状态: /tmp/regress-guard-risk-<session>.jsonl   {"ts","tool","sig","detail"}
      /tmp/regress-guard-usage-<session>.jsonl  {"ts","tool","sig"}
"""
import sys
import os
import json
import re
import tempfile
from datetime import datetime, timedelta

# 考古地层（公理三）：风险动作同时埋进项目内地层（/tmp 重启即失）
# 字段读取统一走 lib/manifest_fields（v1.20 单一来源）
_LIB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
from manifest_fields import parse_core  # noqa: E402
try:
    import journal
    from journal import journal_append, load_journal
except ImportError:  # lib 缺失时地层降级关闭
    def journal_append(*a, **k):
        return False

    journal = None
    load_journal = None


def session_id():
    return (
        os.environ.get("CLAUDE_SESSION_ID")
        or os.environ.get("ZCODE_SESSION_ID")
        or "default"
    )


def _state_path(kind):
    return os.path.join(
        tempfile.gettempdir(), f"regress-guard-{kind}-{session_id()}.jsonl"
    )


# 破坏性/不可逆模式（高精度优先：误报会让 AI 学会无视注入）
RISKY_BASH = [
    re.compile(r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f"),      # rm -rf / -fr / -ravf
    re.compile(r"\brm\s+-[a-zA-Z]*f[a-zA-Z]*r"),
    re.compile(r"\bgit\s+push\b.*(--force\b|-f\b)"),
    re.compile(r"\bgit\s+reset\s+--hard"),
    re.compile(r"\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE)\b", re.I),
    re.compile(r"\bchmod\s+-R\s+777"),
    re.compile(r"\bmkfs\b|\bdd\s+if="),
]


def is_risky(tool, tool_input):
    """返回风险明细（命中原因）或 None。"""
    if not isinstance(tool_input, dict):
        return None
    if tool == "Bash":
        cmd = (tool_input.get("command") or "").strip()
        for pat in RISKY_BASH:
            if pat.search(cmd):
                return cmd[:120]
        return None
    fp = str(tool_input.get("file_path") or tool_input.get("path") or "")
    # 秘密文件：仅精确 .env（.env.example 等模板豁免）
    if os.path.basename(fp) == ".env":
        return fp[:120]
    for frag in ("credentials", "id_rsa", ".ssh/"):
        if frag in fp:
            return fp[:120]
    return None


def normalize_sig(tool, tool_input):
    """与 fail_watch 相同的归一化：Bash 取前两段；Edit/Write 取文件路径。"""
    if not isinstance(tool_input, dict):
        return "?"
    if tool == "Bash":
        cmd = (tool_input.get("command") or "").strip()
        parts = cmd.split()
        return " ".join(parts[:2])[:60] if parts else "?"
    fp = tool_input.get("file_path") or tool_input.get("path") or "?"
    return str(fp)[:120]


def _append(path, event):
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except (IOError, OSError):
        pass


def _manifest_event(tool, tool_input):
    """审批化石（v1.13/v1.18）：agent 编辑清单时埋 创建/细化/批准/取消/受阻/临行 事件。

    plan_approve.py 自己埋转写事件（脚本路径不经过本探测器）；这里补 agent 的
    Edit/Write 路径。dedup：同类同清单只埋一次（plan_refined 除外——每次细化
    都是一次真实的计划变更化石；task_blocked 按 episode 尾判）。
    字段读取统一走 lib/manifest_fields（v1.20 单一来源）。
    """
    fp = str(tool_input.get("file_path") or tool_input.get("path") or "")
    norm = fp.replace(os.sep, "/")
    if "/.regress/manifests/" not in norm or not norm.endswith(".md"):
        return
    try:
        with open(fp, encoding="utf-8") as f:
            content = f.read()
    except (IOError, OSError):
        return
    core = parse_core(content)
    if not core:
        return

    mid = core["id"] or os.path.basename(fp)
    status = core["status"] or "in-progress"
    approved_at = core["approved_at"]
    provisional_at = core["provisional_at"]

    start = os.path.dirname(fp)
    seen = set()
    project_dir = None
    if journal is not None:
        project_dir = journal._find_project_dir(start)
        if project_dir:
            seen = {(e.get("kind"), e.get("manifest_id"))
                    for e in load_journal(project_dir)}

    if status == "cancelled":
        if ("plan_cancelled", mid) not in seen:
            journal_append("plan_cancelled", start_dir=start, manifest_id=mid)
    elif status == "blocked":
        # episode 去重：同一清单最近一次 task_blocked 之后没有 task_unblocked 才埋
        # （脚本路径 plan_approve.py 自己埋，这里补 agent 手工编辑路径）
        timeline = [e for e in (load_journal(project_dir) if project_dir else [])
                    if e.get("manifest_id") == mid
                    and e.get("kind") in ("task_blocked", "task_unblocked")]
        if not timeline or timeline[-1].get("kind") != "task_blocked":
            journal_append("task_blocked", start_dir=start, manifest_id=mid,
                           note="agent编辑路径")
    elif approved_at:
        if ("plan_approved", mid) not in seen:
            journal_append("plan_approved", start_dir=start,
                           manifest_id=mid, approved_at=approved_at)
    elif provisional_at and status in ("in-progress", "verifying"):
        # 临行（v1.18 伪全自动）：agent 手工编辑路径的观察（脚本路径 plan_approve 自己埋）
        if ("provisional_start", mid) not in seen:
            journal_append("provisional_start", start_dir=start,
                           manifest_id=mid, note="agent编辑路径")
    elif status == "planning":
        if tool == "Write" and ("plan_created", mid) not in seen:
            journal_append("plan_created", start_dir=start, manifest_id=mid)
        elif tool == "Edit":
            journal_append("plan_refined", start_dir=start, manifest_id=mid)


def main():
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not raw:
        sys.exit(0)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(0)

    tool = data.get("tool_name", "?")
    tool_input = data.get("tool_input", data if isinstance(data, dict) else {})

    if tool in ("Edit", "Write"):
        _manifest_event(tool, tool_input)

    detail = is_risky(tool, tool_input)
    if detail:
        _append(_state_path("risk"), {
            "ts": datetime.now().isoformat(),
            "tool": tool,
            "sig": normalize_sig(tool, tool_input),
            "detail": detail,
        })
        # 化石入地层（usage 普查不入——高频低值，会撑爆地层）
        journal_append("risk_action", tool=tool,
                       sig=normalize_sig(tool, tool_input), detail=detail)

    # usage 普查只记 Bash（Edit/Write 同文件迭代是正常工作流）
    if tool == "Bash":
        _append(_state_path("usage"), {
            "ts": datetime.now().isoformat(),
            "tool": tool,
            "sig": normalize_sig(tool, tool_input),
        })
    sys.exit(0)


def _recent(path, window_min):
    events = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except (IOError, OSError):
        return []
    cutoff = datetime.now() - timedelta(minutes=window_min)
    recent = [e for e in events if _within(e, cutoff)]
    if len(recent) < len(events):  # 顺手截掉过期，防无限增长
        # P2#22：temp+os.replace 原子截断（与 fail_watch 同病同修）
        try:
            tmp = path + ".trim.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                for e in recent:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")
            os.replace(tmp, path)
        except (IOError, OSError):
            pass
    return recent


def _within(event, cutoff):
    """容错比较：统一剥时区（aware/naive 混比会 TypeError，静默杀探测器）。"""
    try:
        dt = datetime.fromisoformat(event["ts"])
        if dt.tzinfo:
            dt = dt.replace(tzinfo=None)
        return dt >= cutoff
    except (ValueError, KeyError, TypeError):
        return False


def recent_risks(window_min=15):
    """近 window_min 分钟的破坏性动作（供 reflection_check 调用）。"""
    return _recent(_state_path("risk"), window_min)


def recent_usage(window_min=15):
    """近 window_min 分钟的 Bash 命令普查（供打转检测）。"""
    return _recent(_state_path("usage"), window_min)


if __name__ == "__main__":
    main()
