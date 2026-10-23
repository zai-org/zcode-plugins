#!/usr/bin/env python3
"""read_before_edit_guard.py — "先读后改"门禁。

通过命令行参数区分模式：
  python3 read_before_edit_guard.py post   → PostToolUse 模式（记录 Read）
  python3 read_before_edit_guard.py pre    → PreToolUse 模式（拦截 Edit/Write）

PostToolUse(Read)  → 每次读文件，计数 +1
PreToolUse(Edit/Write) → 检查本轮 Read 次数是否足够

状态文件：系统临时目录 regress-guard-read-counter.json（按 sessionId 隔离）

规则（v1.92.0 判据链，野外报告#1 F1 重构）：
  - per-file 正门：改 X 前须读过 X（公理对齐）
  - 会话头防盲潜地板：首改前至少 min(ratio,3) 次读（旧 read_before_edit_ratio
    键向后兼容映射为地板值；旧全局累计比已废——39 改后要 80 读的死亡螺旋
    在野外被迫置 0，实证失效）
  - 地板满足后改未读文件：放行 + 软提示（广度退为提示不设硬比例）
  - 指纹哨兵不动：读后被外部改过仍硬拦
  - ratio=0 关闭，但降级 journal 留痕（每会话一次）
  - 新文件创建（Write 不存在的文件）豁免；.regress/ 与配置文件修改豁免

退出码：0=放行，2=阻断
"""
import sys
import os
import json
import time
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
    116：稳定读——双 stat 一致才认（防 post 补戳窗口读到写入中间态），
    不一致短等后三读，仍不一致返回 None（放弃补戳=退化为保守拦截）。
    """
    def _stat():
        st = os.stat(fp)
        return [st.st_mtime_ns, st.st_size]
    try:
        first = _stat()
        second = _stat()
        if first == second:
            return first
        time.sleep(0.05)
        third = _stat()
        return third if third == second else None
    except OSError:
        return None


# ─── v1.92.1（112）状态锁 + append-only 判据 ───
# 活标本：连续第二发 Edit 必被指纹拦——裸 load-modify-save 在并发钩子进程
# 下丢失更新（SELF_EDITED 戳被晚到的旧状态快照覆盖）。所有状态变更周期
# 必须持锁（顾问：所有写路径共用同一锁文件+锁内读改写）。
def _state_lock():
    sys.path.insert(0, os.path.join(SCRIPT_DIR, "lib"))
    from filelock import file_lock
    return file_lock(get_state_path() + ".lock")


# 自declare append-only 的治理文件（文件头有律文；律要机器执行）
APPEND_ONLY_BASENAMES = ("decisions.md", "frontier-protocol.md")


def _append_only_violation(tool_name, tool_input, fp, enforce=True):
    """文件级行集判据（112，顾问收紧版）：旧行多重集 ⊆ 新行多重集。

    pre 模式下 Edit 的改后全文可用 replace 模拟（old→new 恰一次），故判据
    精确到整个文件而非片段——子串判据只保被换片段，行集保全文零删除。
    返回违例描述或 None。
    """
    if not enforce or os.path.basename(fp or "") not in APPEND_ONLY_BASENAMES:
        return None
    try:
        with open(fp, encoding="utf-8") as f:
            cur = f.read()
    except (IOError, OSError):
        return None  # 无旧内容（新建）=纯增
    if tool_name == "Write":
        new_content = str(tool_input.get("content") or "")
    else:
        old_s = str(tool_input.get("old_string") or "")
        new_s = str(tool_input.get("new_string") or "")
        new_content = cur.replace(old_s, new_s, 1) if old_s else cur
    from collections import Counter
    lost = Counter(cur.splitlines()) - Counter(new_content.splitlines())
    if lost:
        sample = "；".join(list(lost.elements())[:2])[:80]
        return (f"append-only 违例：{os.path.basename(fp)} 是 append-only 治理文件"
                f"（文件头律文），本次改写删改了既有行（如：{sample}）。"
                f"只许追加；确要修订历史条目 → config 设 append_only_enforce: false"
                f" 并在批内说明")


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

    # ratio=0 → 关闭此门禁（v1.92.0 起降级必须留痕——一行配置整体禁用
    # 太容易，野外标本：置 0 后门禁静默消失无人知道）
    if ratio <= 0:
        with _state_lock():
            state = load_state()
            sess0 = state.get(session_id, {})
            if not sess0.get("disabled_noted"):
                try:
                    sys.path.insert(0, os.path.join(SCRIPT_DIR, "lib"))
                    from journal import journal_append
                    journal_append("note", start_dir=project_dir,
                                   note="read_guard_disabled",
                                   session=session_id[:16])
                except Exception:
                    pass  # 地层是增强不是依赖
                state[session_id] = {**sess0, "disabled_noted": True}
                save_state(state)
        sys.exit(0)

    # append-only 执行开关（112）：默认开；只对 APPEND_ONLY_BASENAMES 生效
    append_enforce = True
    if config_path:
        try:
            with open(config_path, encoding="utf-8") as f:
                append_enforce = json.load(
                    f).get("append_only_enforce", True)
        except (IOError, json.JSONDecodeError):
            pass

    # ─── Post 模式：记录 Read / Bash 写后补戳（112）─────────
    if mode == "post":
        with _state_lock():
            state = load_state()
            sess = state.get(session_id, {
                "read_count": 0, "edit_count": 0,
                "read_files": [], "last_reset": datetime.now().isoformat()
            })
            if tool_name == "Read":
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
            elif tool_name == "Bash":
                # 112（野外 msg124）：Bash 写过的目标补戳——记**写后实况指纹**
                # （顾问收紧版，非盲 SELF_EDITED）：后续 Edit 复核若再有变动
                # 照样拦——哨兵牙齿保住，TOCTOU 自愈。
                try:
                    sys.path.insert(0, SCRIPT_DIR)
                    from boundary_guard import extract_write_targets
                    for t in extract_write_targets(
                            tool_input.get("command", ""), project_dir):
                        ap = t if os.path.isabs(t) else os.path.normpath(
                            os.path.join(project_dir, t))
                        fp_val = _fingerprint(ap)
                        if fp_val:
                            sess.setdefault("read_fps", {})[ap] = fp_val
                            if ap not in sess["read_files"]:
                                sess["read_files"].append(ap)
                except Exception:
                    pass  # 补戳是增强：解析失败回退原语义（Read 才记录）
            elif tool_name in ("Edit", "Write", "ApplyPatch"):
                # 116（标本：Edit→Edit 连写被指纹哨兵误拦三例）：写后实况补戳。
                # 根因=豁免路径放行不盖戳+post 缺 Edit 分支，合法写后 state
                # 停留旧指纹，下一次 Edit 必被"外部修改"误拦（重读即解故断续）。
                # 语义同 112 Bash 补戳：记写后实况，后续再有变动照样拦。
                fp = tool_input.get("file_path", "")
                if fp:
                    fp_val = _fingerprint(fp)
                    if fp_val:
                        sess.setdefault("read_fps", {})[fp] = fp_val
                        if fp not in sess["read_files"]:
                            sess["read_files"].append(fp)
            state[session_id] = sess
            save_state(state)
        sys.exit(0)

    # ─── Pre 模式：拦截 Edit/Write ────────────────────
    if mode == "pre" and tool_name in ("Edit", "Write", "ApplyPatch"):
        fp = tool_input.get("file_path", "")

        # append-only 执行（112，野外 msg521）——治理文件内容律。置于 .regress
        # 豁免**之前**（decisions.md/frontier-protocol.md 都住在 .regress/ 里）。
        viol = _append_only_violation(tool_name, tool_input, fp, append_enforce)
        if viol:
            print(f"REGRESS-GUARD: 🚫 {viol}", file=sys.stderr)
            sys.exit(2)

        with _state_lock():
            state = load_state()
            sess = state.get(session_id, {
                "read_count": 0, "edit_count": 0,
                "read_files": [], "last_reset": datetime.now().isoformat()
            })

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
                # 116：新建文件也挂 SELF_EDITED——写过的内容自己知道，
                # 后续 Edit 不因指纹缺记录走保守路径。
                if fp:
                    sess.setdefault("read_fps", {})[fp] = SELF_EDITED
                state[session_id] = sess
                save_state(state)
                sys.exit(0)

            # 豁免：框架自身文件
            if ".regress/" in fp or fp.endswith("AGENTS.md") or "regress-guard" in fp:
                # 116（标本根因半）：豁免放行也须盖 SELF_EDITED——指纹哨兵在
                # 本豁免之前执行，不盖戳则本工具链自己的合法写入会让下一次
                # Edit 被误拦（Edit→Edit 标本）。post 补实况指纹为第二保险。
                if fp:
                    sess.setdefault("read_fps", {})[fp] = SELF_EDITED
                    if fp not in sess.get("read_files", []):
                        sess["read_files"].append(fp)
                state[session_id] = sess
                save_state(state)
                sys.exit(0)

            def _allow_edit():
                sess["edit_count"] += 1
                if fp:
                    # 自己改的：挂起指纹校验直到下次 Read（改后 mtime 必然变化）
                    sess.setdefault("read_fps", {})[fp] = SELF_EDITED
                state[session_id] = sess
                save_state(state)
                sys.exit(0)

            # ─── v1.92.0（111，野外报告#1 F1）判据链重排 ───
            # 公理是 per-file（改 X 前读过 X），旧实现的全局累计比
            # required=(edit_count+1)*ratio 把重复编辑计入惩罚——39 改后要 80 读，
            # 长会话数学必死（野外被迫置 0 实证）。新链：
            #   ①目标 ∈ read_files → 放（per-file 正门）
            #   ②开局盲潜 → 拦（bootstrap 地板 N=min(ratio,3)，旧配置键兼容映射）
            #   ③中间带（读了别的、改这个未读的）→ 放 + 软提示
            #   ④指纹哨兵链不动（读后被外部改过仍硬拦——盲改的主体防线）
            BOOTSTRAP = min(int(ratio), 3)
            if fp and fp in sess.get("read_files", []):
                _allow_edit()

            if sess["read_count"] < BOOTSTRAP:
                print(
                    f"REGRESS-GUARD: ⚠️ 先读后改门禁（开局盲潜）\n"
                    f"  本轮已读 {sess['read_count']} 个文件（防盲潜地板 {BOOTSTRAP}）。\n"
                    f"  目标文件 {fp} 本轮尚未读取——请先 Read 再改。\n"
                    f"  （per-file 为正门：改过的文件读过即放；关闭：config 设 "
                    f"read_before_edit_ratio: 0，降级会留痕）",
                    file=sys.stderr
                )
                sys.exit(2)

            print(
                f"REGRESS-GUARD (hint): {fp} 本轮未读过即改——盲改风险，"
                f"建议先 Read（per-file 地板已满足故放行）。",
                file=sys.stderr
            )
            _allow_edit()

    sys.exit(0)


if __name__ == "__main__":
    main()
