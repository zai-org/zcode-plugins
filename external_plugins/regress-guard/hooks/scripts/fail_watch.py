#!/usr/bin/env python3
"""fail_watch — PostToolUseFailure 探测器（轮内卡死信号，用户无感层）。

只写事实，不做判断：每次工具失败追加一条事件到会话状态文件。
判断由 reflection_check（Stop hook）统一完成——探测器哑、评估器独裁。

事件: {"ts": ISO, "tool": 名, "sig": 归一化签名（命令首token+子命令 或 文件路径）}
状态: /tmp/regress-guard-fails-<session>.jsonl
"""
import sys
import os
import json
import re
import tempfile
from datetime import datetime, timedelta

# 考古地层（公理三）：失败事件同时埋进项目内 append-only 地层（/tmp 重启即失）
_LIB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)
try:
    from journal import journal_append
except ImportError:  # lib 缺失时地层降级关闭，不影响 /tmp 探测
    def journal_append(*a, **k):
        return False


def session_id():
    return (
        os.environ.get("CLAUDE_SESSION_ID")
        or os.environ.get("ZCODE_SESSION_ID")
        or "default"
    )


def state_path():
    return os.path.join(tempfile.gettempdir(), f"regress-guard-fails-{session_id()}.jsonl")


def normalize_sig(tool, tool_input):
    """归一化签名：Bash 取命令前两段；Edit/Write 取文件路径。"""
    if not isinstance(tool_input, dict):
        return "?"
    if tool == "Bash":
        cmd = (tool_input.get("command") or "").strip()
        parts = cmd.split()
        return " ".join(parts[:2])[:60] if parts else "?"
    fp = tool_input.get("file_path") or tool_input.get("path") or "?"
    return str(fp)[:120]


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
    event = {
        "ts": datetime.now().isoformat(),
        "tool": tool,
        "sig": normalize_sig(tool, tool_input),
    }
    try:
        with open(state_path(), "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except (IOError, OSError):
        pass
    journal_append("tool_fail", tool=tool, sig=event["sig"])  # 化石入地层
    sys.exit(0)


def _parse_ts(val):
    """容错解析时间戳：统一剥时区（aware/naive 混比会 TypeError，静默杀探测器）。"""
    try:
        dt = datetime.fromisoformat(val)
        return dt.replace(tzinfo=None) if dt.tzinfo else dt
    except (ValueError, TypeError, AttributeError):
        return None


def recent_failures(window_min=10):
    """读近 window_min 分钟的失败事件（供 reflection_check 调用）。"""
    path = state_path()
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
    recent = []
    for e in events:
        ts = _parse_ts(e.get("ts"))
        if ts is not None and ts >= cutoff:
            recent.append(e)
    # 顺手清理过期文件内容（超过窗口的截掉，防无限增长）
    # P2#22：temp+os.replace 原子截断——旧 open("w") 与并发 append 交错时
    # 新失败事件被静默删掉，反思层低估失败数、卡死检测漏报
    if len(recent) < len(events):
        try:
            tmp = path + ".trim.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                for e in recent:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")
            os.replace(tmp, path)
        except (IOError, OSError):
            pass
    return recent


if __name__ == "__main__":
    main()
