"""read_before_edit_guard 的单元测试。"""
import sys
import os
import json
import subprocess
import tempfile

LIB = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts")
sys.path.insert(0, LIB)

GUARD = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts",
                     "read_before_edit_guard.py")
GUARD = os.path.abspath(GUARD)
import read_before_edit_guard  # noqa: E402  状态路径单一来源


def _state_file_for(session_id):
    """按目标会话算状态文件路径（P2#17 后路径含会话哈希——pytest 进程自身
    没有会话 env，直接调 get_state_path 会算到 default 的文件=清错对象）。"""
    old = os.environ.get("CLAUDE_SESSION_ID")
    os.environ["CLAUDE_SESSION_ID"] = session_id
    try:
        return read_before_edit_guard.get_state_path()
    finally:
        if old is None:
            os.environ.pop("CLAUDE_SESSION_ID", None)
        else:
            os.environ["CLAUDE_SESSION_ID"] = old


def run_guard(mode, tool_name, file_path, session_id="test-unit", project_dir=None):
    """运行 guard 脚本，返回 (exit_code, stderr)。"""
    env = dict(os.environ)
    env["CLAUDE_SESSION_ID"] = session_id
    if project_dir:
        env["CLAUDE_PROJECT_DIR"] = project_dir
    inp = json.dumps({"tool_name": tool_name, "tool_input": {"file_path": file_path}})
    proc = subprocess.run(
        ["python3", GUARD, mode],
        input=inp, capture_output=True, text=True, env=env, timeout=10
    )
    return proc.returncode, proc.stderr


def run_full(mode, tool_name, tool_input, session_id="test-unit",
             project_dir=None):
    """完整 tool_input 版（Bash 命令/Edit 新旧串/Write content）。"""
    env = dict(os.environ)
    env["CLAUDE_SESSION_ID"] = session_id
    if project_dir:
        env["CLAUDE_PROJECT_DIR"] = project_dir
    inp = json.dumps({"tool_name": tool_name, "tool_input": tool_input})
    proc = subprocess.run(
        ["python3", GUARD, mode],
        input=inp, capture_output=True, text=True, env=env, timeout=10
    )
    return proc.returncode, proc.stderr


def cleanup(session_id="test-unit"):
    """清理测试状态（按目标会话的文件清，不再是旧全局文件）。"""
    state_file = _state_file_for(session_id)
    try:
        with open(state_file, encoding="utf-8") as f:
            state = json.load(f)
        state.pop(session_id, None)
        with open(state_file, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except (IOError, json.JSONDecodeError):
        pass


def test_blind_edit_blocked():
    """直接改（0 读）应被拦。"""
    cleanup()
    code, err = run_guard("pre", "Edit", "src/app.js")
    assert code == 2, f"盲改应被拦，exit={code}"
    assert "先读后改" in err
    cleanup()


def test_read_then_edit_allowed():
    """读 2 次后改 1 次应放行（ratio 默认 2）。"""
    cleanup()
    for f in ["src/a.js", "src/b.js"]:
        run_guard("post", "Read", f)
    code, _ = run_guard("pre", "Edit", "src/app.js")
    assert code == 0, f"读够后应放行，exit={code}"
    cleanup()


def test_partial_read_blocked():
    """只读 1 次（差 1 次）应被拦。"""
    cleanup()
    run_guard("post", "Read", "src/a.js")
    code, err = run_guard("pre", "Edit", "src/app.js")
    assert code == 2, f"读不够应拦截，exit={code}"
    cleanup()


def test_new_file_exempt():
    """Write 不存在的文件应豁免。"""
    cleanup()
    code, _ = run_guard("pre", "Write", "/nonexistent/path/new.js")
    assert code == 0, f"新文件应豁免，exit={code}"
    cleanup()


def test_regress_files_exempt():
    """写 .regress/ 下的文件应豁免。"""
    cleanup()
    code, _ = run_guard("pre", "Write", ".regress/config.json")
    assert code == 0, f".regress/ 应豁免，exit={code}"
    cleanup()


def test_ratio_zero_disables(tmp_path):
    """ratio=0 时关闭门禁。"""
    cleanup()
    rdir = tmp_path / ".regress"
    rdir.mkdir()
    (rdir / "config.json").write_text('{"read_before_edit_ratio": 0}')
    code, _ = run_guard("pre", "Edit", "src/app.js",
                        project_dir=str(tmp_path),
                        session_id="test-ratio0")
    assert code == 0, f"ratio=0 应放行，exit={code}"
    cleanup("test-ratio0")


def test_no_spiral_v1120():
    """v1.92.0（111，野外 F1）无螺旋证明：改 1 次后改第 2 个未读文件——
    旧语义 required=(1+1)*2=4>3 会拦（死亡螺旋第一格）；新语义 bootstrap
    已满足（3 读 ≥ N=2）→ 放行+软提示，需求不随编辑数增长。"""
    cleanup()
    for f in ["a", "b", "c"]:
        run_guard("post", "Read", f"src/{f}.js")
    run_guard("pre", "Edit", "src/app.js")  # 第 1 次改通过
    code, err = run_guard("pre", "Edit", "src/other.js")  # 第 2 次改（未读）
    assert code == 0, f"第 2 次改不应再被累计比例拦，exit={code}"
    assert "hint" in err or "建议先 Read" in err  # 软提示在场
    cleanup()


def test_long_session_no_growth():
    """百次重复编辑后改新文件：需求仍只有 bootstrap（无螺旋的极限证明）。"""
    cleanup()
    for f in ["src/a.js", "src/b.js"]:
        run_guard("post", "Read", f)
    for i in range(100):
        run_guard("pre", "Edit", "src/a.js")  # 已读文件迭代改 ×100
    code, err = run_guard("pre", "Edit", "src/brand-new.js")
    assert code == 0, f"百次编辑后改新文件不应需求增长，exit={code}"
    cleanup()


def test_edit_already_read_file_exempt():
    """改一个已读过的文件应豁免（允许迭代修改同一文件）。"""
    cleanup()
    # 读 src/app.js + 2 个依赖
    for f in ["src/app.js", "src/utils.js", "src/config.js"]:
        run_guard("post", "Read", f)
    # 第 1 次改 app.js 通过
    code1, _ = run_guard("pre", "Edit", "src/app.js")
    assert code1 == 0, f"第 1 次改应通过，exit={code1}"
    # 第 2 次改同一个 app.js → 应豁免（已读过）
    code2, _ = run_guard("pre", "Edit", "src/app.js")
    assert code2 == 0, f"同文件已读应豁免，exit={code2}"
    # 第 3 次改还是 app.js → 仍豁免
    code3, _ = run_guard("pre", "Edit", "src/app.js")
    assert code3 == 0, f"同文件多次改应豁免，exit={code3}"
    cleanup()


def test_edit_unread_after_bootstrap_soft_hint():
    """v1.92.0：读了 a/b/c（bootstrap 满）改未读的 d → 放行+软提示不拦
    （旧语义此处 required=(1+1)*2=4>3 拦——判据链已换，per-file 为主）。"""
    cleanup()
    for f in ["src/a.js", "src/b.js", "src/c.js"]:
        run_guard("post", "Read", f)
    run_guard("pre", "Edit", "src/a.js")  # 第 1 次改通过（a 已读豁免）
    code, err = run_guard("pre", "Edit", "src/d.js")  # 改未读的 d
    assert code == 0, f"bootstrap 满足后改未读文件应放行，exit={code}"
    assert "src/d.js" in err and "建议先 Read" in err  # 软提示点名目标
    cleanup()


def test_bootstrap_floor_blocks_blind_dive():
    """开局盲潜：读了 1 个（< N=2）改另一个未读文件 → 拦（防盲潜地板）。"""
    cleanup()
    run_guard("post", "Read", "src/a.js")  # 仅 1 读
    code, err = run_guard("pre", "Edit", "src/d.js")  # 改未读的 d
    assert code == 2, f"开局盲潜应拦，exit={code}"
    assert "盲潜" in err
    cleanup()


# ── 文件指纹（公理二：每一粒灰尘都必须对得上）──────────

def _bump_mtime_ns(path, delta_ns=2 * 10**9):
    """确定性改 mtime（避免同纳秒竞态）：读现值 +delta 写回。"""
    st = os.stat(path)
    os.utime(path, ns=(st.st_atime_ns + delta_ns, st.st_mtime_ns + delta_ns))


def test_fingerprint_blocks_external_change(tmp_path):
    """读后被外部修改（另一会话/git/格式化）→ 禁止盲改。"""
    cleanup()
    f = tmp_path / "app.js"
    f.write_text("let a = 1\n")
    fp = str(f)
    run_guard("post", "Read", fp)          # 采集指纹
    _bump_mtime_ns(fp)                      # 模拟外部修改
    code, err = run_guard("pre", "Edit", fp)
    assert code == 2, f"指纹不匹配应阻断, exit={code}"
    assert "指纹" in err
    cleanup()


def test_fingerprint_reread_restores(tmp_path):
    """被拦后重新 Read（刷新指纹）→ 放行。"""
    cleanup()
    f = tmp_path / "app.js"
    f.write_text("let a = 1\n")
    fp = str(f)
    run_guard("post", "Read", fp)
    _bump_mtime_ns(fp)
    assert run_guard("pre", "Edit", fp)[0] == 2   # 拦
    run_guard("post", "Read", fp)                  # 重读刷新
    assert run_guard("pre", "Edit", fp)[0] == 0    # 放行
    cleanup()


def test_fingerprint_unchanged_allows(tmp_path):
    """读后没动过 → 指纹一致 → 放行。"""
    cleanup()
    f = tmp_path / "app.js"
    f.write_text("let a = 1\n")
    fp = str(f)
    run_guard("post", "Read", fp)
    assert run_guard("pre", "Edit", fp)[0] == 0
    cleanup()


def test_self_edit_suspends_fingerprint(tmp_path):
    """自己改完再改（未重读）→ 哨兵挂起校验，不误拦。"""
    cleanup()
    f = tmp_path / "app.js"
    f.write_text("let a = 1\n")
    fp = str(f)
    run_guard("post", "Read", fp)
    run_guard("pre", "Edit", fp)           # 自己改 → sentinel
    f.write_text("let a = 2\n")            # 内容变了（mtime 变）
    # 未重读但已在本会话 read_files 里 → 豁免路径 + sentinel 挂起 → 放行
    assert run_guard("pre", "Edit", fp)[0] == 0
    cleanup()


# ─── v1.92.5（116）：Edit→Edit 连写误拦根治（豁免盖戳+post 写后实况） ───

def test_exempt_path_edit_then_edit_not_blocked(tmp_path):
    """116 标本回放：.regress/ 路径（框架豁免）Read→Edit→再 Edit 不被指纹拦。

    修前根因：豁免分支 exit(0) 不盖戳 + post 无 Edit 分支 → 合法 Edit 后
    state 停留 Read 时指纹 → 第二次 Edit 必被"外部修改"误拦。
    """
    cleanup()
    d = tmp_path / ".regress" / "manifests"
    d.mkdir(parents=True)
    f = d / "REGRESS-X.md"
    f.write_text("body v1\n")
    fp = str(f)
    run_guard("post", "Read", fp)
    # Edit#1：pre 放行 → 宿主写入（内容+mtime 变）→ post 补戳（完整宿主序列）
    assert run_guard("pre", "Edit", fp)[0] == 0
    f.write_text("body v2\n")
    _bump_mtime_ns(fp)
    run_guard("post", "Edit", fp)
    # Edit#2：修前此处 exit=2（指纹不匹配）；修后放行
    code, err = run_guard("pre", "Edit", fp)
    assert code == 0, f"Edit→Edit 连写误拦（标本复发）, exit={code}, err={err}"
    cleanup()


def test_exempt_path_pre_stamp_alone_suffices(tmp_path):
    """116 双保险的 A 层独立生效：豁免放行盖 SELF_EDITED（post 未跑也不误拦）。"""
    cleanup()
    d = tmp_path / ".regress"
    d.mkdir()
    f = d / "decisions.md"
    f.write_text("a\n")
    fp = str(f)
    run_guard("post", "Read", fp)
    assert run_guard("pre", "Edit", fp)[0] == 0   # 豁免放行（此时盖 SELF_EDITED）
    f.write_text("a\nb\n")
    _bump_mtime_ns(fp)                              # post 钩子未发生（单保险）
    assert run_guard("pre", "Edit", fp)[0] == 0   # SELF_EDITED 挂起 → 放行
    cleanup()


def test_post_edit_stamps_actual_fingerprint(tmp_path):
    """116 B 层：post(Edit) 记写后实况——state 指纹=新内容指纹，Edit 放行。"""
    cleanup()
    f = tmp_path / "app.js"
    f.write_text("let a = 1\n")
    fp = str(f)
    run_guard("post", "Read", fp)          # 旧指纹
    f.write_text("let a = 2\n")            # 写后实况
    _bump_mtime_ns(fp)
    run_full("post", "Edit", {"file_path": fp, "old_string": "1",
                              "new_string": "2"})
    # state 里应已是写后实况指纹（而非 Read 时的旧值）
    state = json.load(open(_state_file_for("test-unit"), encoding="utf-8"))
    sess = state.get("test-unit", {})
    stamped = (sess.get("read_fps") or {}).get(fp)
    assert stamped not in (None, read_before_edit_guard.SELF_EDITED), \
        "post(Edit) 未补写后实况指纹"
    assert run_guard("pre", "Edit", fp)[0] == 0
    cleanup()


def test_post_stamp_then_external_change_still_blocks(tmp_path):
    """116 牙齿保留：post 补戳后文件又被第三方改 → 下一次 Edit 仍拦。"""
    cleanup()
    f = tmp_path / "app.js"
    f.write_text("let a = 1\n")
    fp = str(f)
    run_guard("post", "Read", fp)
    f.write_text("let a = 2\n")
    _bump_mtime_ns(fp)
    run_full("post", "Edit", {"file_path": fp, "old_string": "1",
                              "new_string": "2"})   # 补写后实况
    _bump_mtime_ns(fp)                                # 第三方又改
    f.write_text("let a = 3\n")
    assert run_guard("pre", "Edit", fp)[0] == 2, "post 补戳后外部改应仍拦"
    cleanup()


def test_fingerprint_only_checked_for_real_files(tmp_path):
    """指纹校验对从未 Read 过的文件不生效（走 ratio 门禁，互不干扰）。"""
    cleanup()
    # 0 读直接改 → 走先读后改门禁（不是指纹拦截）
    code, err = run_guard("pre", "Edit", str(tmp_path / "never-read.js"))
    assert code == 2
    assert "先读后改" in err
    cleanup()


# ─── v1.92.1（112：Bash 补戳+append-only 执行）──────────

def test_bash_stamp_prevents_false_external(tmp_path):
    """Bash 写过的目标补戳（野外 msg124）：Read 后 Bash 改动 → 补戳记写后
    实况指纹 → Edit 不再误报"外部修改"。"""
    cleanup("test-bashstamp")
    f = tmp_path / "src_app.js"
    f.write_text("a = 1\n")
    fp = str(f)
    run_guard("post", "Read", fp, session_id="test-bashstamp")
    f.write_text("a = 2\n")  # 模拟本会话 Bash 改写（无补戳时=外部修改假象）
    code, _ = run_full("post", "Bash", {"command": f"echo x > {fp}"},
                       session_id="test-bashstamp")
    assert code == 0
    code2, err2 = run_guard("pre", "Edit", fp, session_id="test-bashstamp")
    assert code2 == 0, f"Bash 补戳后 Edit 不应误报外部修改：{err2}"
    cleanup("test-bashstamp")


def test_bash_stamp_detects_post_change(tmp_path):
    """补戳=写后实况指纹（非盲豁免）：补戳后文件再被改 → Edit 仍拦。"""
    cleanup("test-bashstamp2")
    f = tmp_path / "src_app.js"
    f.write_text("a = 1\n")
    fp = str(f)
    run_full("post", "Bash", {"command": f"echo x > {fp}"},
             session_id="test-bashstamp2")
    _bump_mtime_ns(fp)  # 补戳之后再变（真正的外部修改）
    code, err = run_guard("pre", "Edit", fp, session_id="test-bashstamp2")
    assert code == 2 and "指纹" in err  # 哨兵牙齿保住
    cleanup("test-bashstamp2")


def test_append_only_delete_blocked(tmp_path):
    """decisions.md 删既有行 → 拦（行集判据：旧行多重集 ⊄ 新行）。"""
    cleanup("test-append")
    d = tmp_path / "decisions.md"
    d.write_text("# 决策日志\n\n## 2026-09-01 旧条目\n- 内容甲\n", encoding="utf-8")
    code, err = run_full("pre", "Edit", {
        "file_path": str(d), "old_string": "## 2026-09-01 旧条目\n- 内容甲\n",
        "new_string": "## 2026-09-01 旧条目\n"}, session_id="test-append")
    assert code == 2 and "append-only" in err
    cleanup("test-append")


def test_append_only_append_allowed(tmp_path):
    """纯追加（旧行全保留）→ 放行。"""
    cleanup("test-append2")
    d = tmp_path / "decisions.md"
    d.write_text("# 决策日志\n\n## 旧\n- 甲\n", encoding="utf-8")
    run_guard("post", "Read", str(d), session_id="test-append2")  # per-file 正门
    code, err = run_full("pre", "Edit", {
        "file_path": str(d), "old_string": "- 甲\n",
        "new_string": "- 甲\n- 乙（新追加）\n"}, session_id="test-append2")
    assert code == 0, err
    cleanup("test-append2")


def test_append_only_write_nonprefix_blocked(tmp_path):
    """Write 覆盖且旧内容非前缀（丢行）→ 拦。"""
    cleanup("test-append3")
    d = tmp_path / "frontier-protocol.md"
    d.write_text("# 协议\n正文甲\n正文乙\n", encoding="utf-8")
    code, err = run_full("pre", "Write", {
        "file_path": str(d),
        "content": "# 协议\n正文甲（改写）\n"}, session_id="test-append3")
    assert code == 2 and "append-only" in err
    cleanup("test-append3")
