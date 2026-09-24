#!/usr/bin/env python3
"""read_before_edit_guard.py — "先读后改"门禁。

通过命令行参数区分模式：
  python3 read_before_edit_guard.py post   → PostToolUse 模式（记录 Read）
  python3 read_before_edit_guard.py pre    → PreToolUse 模式（拦截 Edit/Write）

PostToolUse(Read)  → 每次读文件，计数 +1
PreToolUse(Edit/Write) → 检查本轮 Read 次数是否足够

状态文件：系统临时目录 regress-guard-read-counter.json（按 sessionId 隔离）

规则：
  - 默认比例 3:1（每改 1 个文件前至少读 3 个）
  - 可在 .regress/config.json 用 read_before_edit_ratio 调整
  - 新文件创建（Write 不存在的文件）豁免
  - .regress/ 和配置文件修改豁免

退出码：0=放行，2=阻断
"""
import sys
import os
import json
import tempfile

DEFAULT_RATIO = 3
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# 指纹哨兵：本会话自己刚改过的文件（改后到下次 Read 之间挂起指纹校验）
SELF_EDITED = -1


def _fingerprint(fp):
    """文件指纹 [mtime_ns, size]——"每一粒灰尘都必须对得上"（公理二）。

    Read 时采集，Edit/Write 前复核；不一致 = 读后被外部修改（另一会话、
    git checkout、格式化进程……），盲改会基于过期认知，必须强制重读。
    """
    try:
        st = os.stat(fp)
        return [st.st_mtime_ns, st.st_size]
    except OSError:
        return None


def get_state_path():
    # P2#17：按会话分文件——全会话共享单文件在并行钩子/两会话下互相丢计数
    # （既有误锁也有漏拦），旧全局文件留给兼容读取
    sid = (os.environ.get("CLAUDE_SESSION_ID")
           or os.environ.get("ZCODE_SESSION_ID") or "default")
    import hashlib as _h
    key = _h.md5(sid.encode()).hexdigest()[:8]
    return os.path.join(tempfile.gettempdir(),
                        f"regress-guard-read-counter-{key}.json")


def load_state():
    try:
        with open(get_state_path(), encoding="utf-8") as f:
            return json.load(f)
    except (IOError, json.JSONDecodeError):
        return {}


def save_state(state):
    try:
        with open(get_state_path(), "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
    except (IOError, OSError):
        pass


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "pre"

    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    if not raw:
        sys.exit(0)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", data) if isinstance(data, dict) else {}
    if not isinstance(tool_input, dict):
        tool_input = {}

    session_id = (
        os.environ.get("CLAUDE_SESSION_ID")
        or os.environ.get("ZCODE_SESSION_ID")
        or "default"
    )

    # 读配置（支持 monorepo：从多个位置查找 .regress/）
    project_dir = (
        os.environ.get("CLAUDE_PROJECT_DIR")
        or os.environ.get("ZCODE_PROJECT_DIR")
        or os.getcwd()
    )
    # 向上查找 .regress/config.json
    config_path = None
    search_dir = project_dir
    for _ in range(10):  # 最多向上 10 级
        candidate = os.path.join(search_dir, ".regress", "config.json")
        if os.path.exists(candidate):
            config_path = candidate
            break
        parent = os.path.dirname(search_dir)
        if parent == search_dir:
            break
        search_dir = parent

    ratio = DEFAULT_RATIO  # P2#25：单一常量（旧代码无 config 缺省 2、有 config 缺省 3、docstring 写 3——三处打架）
    if config_path:
        try:
            with open(config_path, encoding="utf-8") as f:
                ratio = json.load(f).get("read_before_edit_ratio", DEFAULT_RATIO)
        except (IOError, json.JSONDecodeError):
            pass

    # ratio=0 → 关闭此门禁
    if ratio <= 0:
        sys.exit(0)

    state = load_state()
    sess = state.get(session_id, {
        "read_count": 0, "edit_count": 0,
        "read_files": [], "last_reset": datetime.now().isoformat()
    })

    # ─── Post 模式：记录 Read ─────────────────────────
    if mode == "post" and tool_name == "Read":
        fp = tool_input.get("file_path", "")
        if fp:
            if fp not in sess["read_files"]:
                sess["read_files"].append(fp)
            fps = sess.get("read_fps") or {}
            fp_val = _fingerprint(fp)
            if fp_val:
                fps[fp] = fp_val
            sess["read_fps"] = fps
        sess["read_count"] += 1
        state[session_id] = sess
        save_state(state)
        sys.exit(0)

    # ─── Pre 模式：拦截 Edit/Write ────────────────────
    if mode == "pre" and tool_name in ("Edit", "Write", "ApplyPatch"):
        fp = tool_input.get("file_path", "")

        # 指纹复核（公理二）：读后文件被外部改过 → 禁止盲改，强制重读
        fps = sess.get("read_fps") or {}
        recorded = fps.get(fp)
        if recorded not in (None, SELF_EDITED):
            current = _fingerprint(fp)
            if current is not None and current != recorded:
                print(
                    f"REGRESS-GUARD: 🪞 文件指纹不匹配\n"
                    f"  {fp}\n"
                    f"  最后一次读取后文件被外部修改（另一会话/git/格式化进程）。\n"
                    f"  你记忆里的内容已过期，禁止基于过期认知盲改。\n"
                    f"  → 先重新 Read 该文件，确认现状后再改。",
                    file=sys.stderr
                )
                sys.exit(2)

        # 豁免：新文件创建
        if tool_name == "Write" and fp and not os.path.exists(fp):
            sess["edit_count"] += 1
            state[session_id] = sess
            save_state(state)
            sys.exit(0)

        # 豁免：框架自身文件
        if ".regress/" in fp or fp.endswith("AGENTS.md") or "regress-guard" in fp:
            sys.exit(0)

        def _allow_edit():
            sess["edit_count"] += 1
            if fp:
                # 自己改的：挂起指纹校验直到下次 Read（改后 mtime 必然变化）
                sess.setdefault("read_fps", {})[fp] = SELF_EDITED
            state[session_id] = sess
            save_state(state)
            sys.exit(0)

        # 豁免：目标文件本轮已读过（允许迭代修改同一文件）
        if fp and fp in sess.get("read_files", []):
            _allow_edit()

        # 检查：读次数 >= (改次数+1) * ratio
        required = (sess["edit_count"] + 1) * ratio
        if sess["read_count"] < required:
            deficit = required - sess["read_count"]
            print(
                f"REGRESS-GUARD: ⚠️ 先读后改门禁\n"
                f"  本轮已读 {sess['read_count']} 个文件，已改 {sess['edit_count']} 个。\n"
                f"  规则：每改 1 个文件前至少读 {ratio} 个（当前需 {required}，还差 {deficit}）。\n"
                f"  目标文件 {fp} 本轮尚未读取。\n\n"
                f"  请先用 Read 读取目标文件及其依赖，理解上下文后再改。\n"
                f"  （关闭此门禁：.regress/config.json 设 read_before_edit_ratio: 0）",
                file=sys.stderr
            )
            sys.exit(2)
        else:
            _allow_edit()

    sys.exit(0)


if __name__ == "__main__":
    main()
