#!/usr/bin/env python3
"""fail_watch — PostToolUseFailure 探测器（轮内卡死信号，用户无感层）。

只写事实，不做判断：每次工具失败追加一条事件到会话状态文件。
判断由 reflection_check（Stop hook）统一完成——探测器哑、评估器独裁。

事件: {"ts": ISO, "tool": 名, "sig": 归一化签名（命令首token+子命令 或 文件路径）}
状态: /tmp/regress-guard-fails-<session>.jsonl
"""
import sys

try:
    import sys as _sys
    import os as _os
    _ld = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "lib")
    if _ld not in _sys.path:
        _sys.path.insert(0, _ld)
    from host_env import sandbox_aware_state_dir as _state_dir
    from host_env import ensure_utf8_stdio
except ImportError:
    import tempfile as _tf
    def _state_dir():
        return _tf.gettempdir()
    def ensure_utf8_stdio() -> None:
        pass  # lib 缺席兜底：no-op（既有降级语义）
import os
import json
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
    return os.path.join(_state_dir(), f"regress-guard-fails-{session_id()}.jsonl")


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
    ensure_utf8_stdio()  # 批191：cp936 流垫片（emoji/中文输出根治）
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not raw:
        sys.exit(0)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(0)
    if not isinstance(data, dict):
        # 批135：形态破坏不记事件（观测钩子，非阻断）——防 .get AttributeError
        sys.exit(0)

    # 批167 补：会话身份同吸收（dsh 桥无 env——否则观测状态落 default 键跨会话合并）
    try:
        from host_env import absorb_session
        absorb_session(data)
    except ImportError:
        pass

    # 批166（dsh 桥）：工具名规范化（dsh 小写名→CC 形态，观测不漏采）
    try:
        from host_env import canonicalize_tool_names, materialize_tool_input
        canonicalize_tool_names(data)
        materialize_tool_input(data)
    except ImportError:
        pass

    # 批167（dsh 补位）：ZCode 靠宿主只在失败时调本钩（PostToolUseFailure
    # 事件）；dsh 无此桥点，hooks.cc 生成时把本钩复挂到 PostToolUse——
    # 载荷带 tool_response 时自筛失败（dsh 归一化契约：bash 非零=文本含
    # [exit code: N]（N>0）；fs/工具错误=Error: 前缀）。无 tool_response
    # 键=宿主已筛（ZCode 语义）直通。
    resp = data.get("tool_response")
    if isinstance(resp, str):
        import re as _re
        failed = bool(_re.search(r"\[exit code: [1-9]\d*\]", resp)) \
            or resp.lstrip().startswith("Error:")
        if not failed:
            sys.exit(0)

    tool = data.get("tool_name", "?")
    tool_input = data.get("tool_input", data)
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
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        # 观测面兜底（批135）：失败信号采集是增强不是依赖——崩了干净跳过
        print(f"fail_watch: 采集异常（跳过本轮）{type(e).__name__}: {e}",
              file=sys.stderr)
        sys.exit(0)
