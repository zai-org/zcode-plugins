"""boundary_guard（开发边界守卫）的单元测试。"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

GUARD = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts",
                     "boundary_guard.py")
GUARD = os.path.abspath(GUARD)

MANIFEST_TMPL = """---
id: {mid}
requirement: "t"
status: {status}
planned_changes:
  - id: F1
    file: "src/auth/login.ts"
    type: method-logic
{boundary}actual_changes: []
---
body
"""

BOUNDARY_BLOCK = """boundary:
  include:
    - "src/auth/**"
    - "tests/auth/**"
"""


def make_project(tmp_path, with_boundary=True, status="in-progress",
                 extra_actual=""):
    proj = tmp_path / "proj"
    (proj / ".regress" / "manifests").mkdir(parents=True)
    for d in ("src/auth", "src/other", "tests/auth"):
        (proj / d).mkdir(parents=True)
    (proj / ".regress" / "manifests" / "R1.md").write_text(
        MANIFEST_TMPL.format(mid="R1", status=status,
                             boundary=BOUNDARY_BLOCK if with_boundary else "")
        + extra_actual)
    return proj


def run_guard(proj, file_path, tool="Edit", extra_env=None):
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(proj)}
    env.update(extra_env or {})
    return subprocess.run(
        ["python3", GUARD],
        input=json.dumps({"tool_name": tool, "tool_input": {"file_path": str(file_path)}}),
        capture_output=True, text=True, env=env, timeout=10,
    )


def test_inside_boundary_planned_file(tmp_path):
    proj = make_project(tmp_path)
    assert run_guard(proj, proj / "src/auth/login.ts").returncode == 0


def test_inside_boundary_new_file_in_scope_dir(tmp_path):
    proj = make_project(tmp_path)
    assert run_guard(proj, proj / "src/auth/new-helper.ts").returncode == 0


def test_inside_boundary_tests_glob(tmp_path):
    proj = make_project(tmp_path)
    assert run_guard(proj, proj / "tests/auth/x.test.ts").returncode == 0


def test_outside_boundary_blocked(tmp_path):
    proj = make_project(tmp_path)
    r = run_guard(proj, proj / "src/other/db.ts")
    assert r.returncode == 2
    assert "开发边界" in r.stderr and "/regress:track" in r.stderr


def test_exempt_regress_and_agents(tmp_path):
    proj = make_project(tmp_path)
    assert run_guard(proj, proj / ".regress/config.json").returncode == 0
    assert run_guard(proj, proj / "AGENTS.md").returncode == 0


def test_outside_project_blocked(tmp_path):
    proj = make_project(tmp_path)
    outside = tmp_path / "elsewhere" / "x.ts"
    outside.parent.mkdir(exist_ok=True)
    assert run_guard(proj, outside).returncode == 2


def test_exact_set_mode_without_explicit_boundary(tmp_path):
    """无显式 boundary → planned+actual 精确集模式：界内放行、界外拦。"""
    proj = make_project(tmp_path, with_boundary=False)
    assert run_guard(proj, proj / "src/auth/login.ts").returncode == 0
    # planned 之外的目录（即便同清单没写通配）拦截
    assert run_guard(proj, proj / "src/other/db.ts").returncode == 2


def test_track_write_extends_boundary(tmp_path):
    """逃逸出口：actual_changes 回写后，同文件从拦变放（扩界留痕语义）。"""
    proj = make_project(tmp_path)
    target = proj / "src/shared.ts"
    assert run_guard(proj, target).returncode == 2
    # 模拟 /regress:track 回写
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace(
        "actual_changes: []",
        'actual_changes:\n  - id: F3\n    file: "src/shared.ts"\n    type: new-file'))
    assert run_guard(proj, target).returncode == 0


def test_no_active_manifest_passes(tmp_path):
    proj = make_project(tmp_path, status="done")
    assert run_guard(proj, proj / "src/other/db.ts").returncode == 0


def test_no_regress_dir_passes(tmp_path):
    assert run_guard(tmp_path, tmp_path / "x.ts").returncode == 0


def test_config_disable(tmp_path):
    proj = make_project(tmp_path)
    (proj / ".regress" / "config.json").write_text('{"boundary_enforced": false}')
    assert run_guard(proj, proj / "src/other/db.ts").returncode == 0


def test_non_edit_tools_pass(tmp_path):
    proj = make_project(tmp_path)
    r = subprocess.run(
        ["python3", GUARD],
        input=json.dumps({"tool_name": "Read", "tool_input": {"file_path": str(proj / "x.ts")}}),
        capture_output=True, text=True,
        env={**os.environ, "CLAUDE_PROJECT_DIR": str(proj)}, timeout=10)
    assert r.returncode == 0


def test_union_of_active_manifests(tmp_path):
    """多个活跃清单取并集：任一任务边界内即放行（子任务不互锁）。"""
    proj = make_project(tmp_path)  # R1: src/auth/**, tests/auth/**
    (proj / ".regress" / "manifests" / "R2.md").write_text(
        MANIFEST_TMPL.format(mid="R2", status="in-progress", boundary="").replace(
            'file: "src/auth/login.ts"', 'file: "src/other/db.ts"'))
    assert run_guard(proj, proj / "src/other/db.ts").returncode == 0  # R2 界内
    assert run_guard(proj, proj / "src/db2.ts").returncode == 2        # 两界之外


# ── 计划审批的机器强制（v1.12：planning 状态拦编辑，批准后放行）──

def test_planning_blocks_even_inside_boundary(tmp_path):
    """待批准清单：边界内文件也拦——批准前只读探索。"""
    proj = make_project(tmp_path, status="planning")
    r = run_guard(proj, proj / "src/auth/login.ts")
    assert r.returncode == 2
    assert "计划待批准" in r.stderr


def test_planning_read_tools_not_affected(tmp_path):
    """Read 工具不经此守卫（计划阶段只读探索不受影响）。"""
    proj = make_project(tmp_path, status="planning")
    r = subprocess.run(
        ["python3", GUARD],
        input=json.dumps({"tool_name": "Read", "tool_input": {"file_path": str(proj / "src/auth/login.ts")}}),
        capture_output=True, text=True,
        env={**os.environ, "CLAUDE_PROJECT_DIR": str(proj)}, timeout=10)
    assert r.returncode == 0


def test_approval_flips_to_allow(tmp_path):
    """批准 = status 回写 in-progress → 同文件从拦变放。"""
    proj = make_project(tmp_path, status="planning")
    assert run_guard(proj, proj / "src/auth/login.ts").returncode == 2
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace("status: planning", "status: in-progress"))
    assert run_guard(proj, proj / "src/auth/login.ts").returncode == 0


def test_approved_sibling_allows_while_other_planning(tmp_path):
    """并行任务：文件命中已批准清单边界 → 放行，即便另有 planning 清单存在。"""
    proj = make_project(tmp_path, status="planning")     # R1 planning
    (proj / ".regress" / "manifests" / "R2.md").write_text(
        MANIFEST_TMPL.format(mid="R2", status="in-progress", boundary="").replace(
            'file: "src/auth/login.ts"', 'file: "src/other/db.ts"'))
    assert run_guard(proj, proj / "src/other/db.ts").returncode == 0  # R2 已批准
    assert run_guard(proj, proj / "src/auth/login.ts").returncode == 2  # 仅 R1(planning) 命中


# ── 产物直通 + cancelled（v1.13：approved.at = 人类直接编辑清单批准）──

def test_planning_with_approved_at_allows(tmp_path):
    """产物直通：人类直接填 approved.at → 边界守卫视同已批准（不经过对话）。"""
    proj = make_project(tmp_path, status="planning")
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace(
        "status: planning",
        'status: planning\napproved:\n  at: "2026-08-26T10:00:00"\n  note: ""'))
    assert run_guard(proj, proj / "src/auth/login.ts").returncode == 0


def test_planning_with_empty_approved_still_blocks(tmp_path):
    """approved.at 为空串 = 未批准，照样拦（空值不误放行）。"""
    proj = make_project(tmp_path, status="planning")
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace(
        "status: planning",
        'status: planning\napproved:\n  at: ""\n  note: ""'))
    r = run_guard(proj, proj / "src/auth/login.ts")
    assert r.returncode == 2
    assert "计划待批准" in r.stderr


def test_cancelled_manifest_not_active(tmp_path):
    """cancelled 清单不再是活跃边界（取消即解界，不残留拦截）。"""
    proj = make_project(tmp_path, status="cancelled")
    assert run_guard(proj, proj / "src/other/db.ts").returncode == 0


# ── 受阻机器强制（v1.14：blocked 边界内拦编辑，解阻放行）──

def test_blocked_blocks_inside_boundary_with_reason(tmp_path):
    proj = make_project(tmp_path, status="blocked")
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace(
        "status: blocked",
        'status: blocked\nblocked:\n  reason: "远端 Redis 不通"\n  need: "开白名单"'))
    r = run_guard(proj, proj / "src/auth/login.ts")
    assert r.returncode == 2
    assert "任务受阻" in r.stderr and "远端 Redis 不通" in r.stderr
    assert "--unblock" in r.stderr


def test_unblocked_allows_again(tmp_path):
    proj = make_project(tmp_path, status="blocked")
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace("status: blocked", "status: in-progress"))
    assert run_guard(proj, proj / "src/auth/login.ts").returncode == 0


def test_blocked_sibling_still_blocks_but_inprogress_allows(tmp_path):
    """受阻清单拦自己边界；文件命中另一个 in-progress 清单 → 放行（不互锁）。"""
    proj = make_project(tmp_path, status="blocked")  # R1 blocked: src/auth/**
    (proj / ".regress" / "manifests" / "R2.md").write_text(
        MANIFEST_TMPL.format(mid="R2", status="in-progress", boundary="").replace(
            'file: "src/auth/login.ts"', 'file: "src/other/db.ts"'))
    assert run_guard(proj, proj / "src/other/db.ts").returncode == 0   # R2 界内放行
    assert run_guard(proj, proj / "src/auth/login.ts").returncode == 2  # 仅 R1(blocked) 命中


def test_approved_then_blocked_still_blocks(tmp_path):
    """live 冒烟抓到的回归：先批准后受阻——approved.at 不得短路 blocked 拦截。"""
    proj = make_project(tmp_path, status="planning")
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace(
        "status: planning",
        'status: blocked\napproved:\n  at: "2026-08-26T10:00:00"\n  note: "d"'
        '\nblocked:\n  reason: "Redis 不通"\n  need: "开白名单"'))
    r = run_guard(proj, proj / "src/auth/login.ts")
    assert r.returncode == 2
    assert "任务受阻" in r.stderr and "Redis 不通" in r.stderr


# ── v1.20：项目级禁改区 + 赦免权普适化 ──

def _set_config(proj, cfg):
    (proj / ".regress" / "config.json").write_text(
        __import__("json").dumps(cfg), encoding="utf-8")


def test_forbidden_zone_blocks_regardless_of_task(tmp_path):
    """禁改区与任务边界无关：无活跃清单也拦。"""
    proj = make_project(tmp_path, status="done")  # 无活跃清单
    _set_config(proj, {"boundary": {"forbidden": ["legacy/**"]}})
    (proj / "legacy").mkdir()
    r = run_guard(proj, proj / "legacy" / "old.ts")
    assert r.returncode == 2
    assert "禁改区" in r.stderr and "/regress:bypass" in r.stderr


def test_forbidden_escape_via_bypass(tmp_path):
    """赦免权普适化：bypass_until 未过期 → 禁改区放行（赦后记债）。"""
    from datetime import datetime, timedelta
    proj = make_project(tmp_path, status="done")
    (proj / "legacy").mkdir()
    _set_config(proj, {"boundary": {"forbidden": ["legacy/**"]},
                       "bypass_until": (datetime.now() + timedelta(minutes=10)).isoformat()})
    assert run_guard(proj, proj / "legacy" / "old.ts").returncode == 0


def test_expired_bypass_does_not_escape(tmp_path):
    from datetime import datetime, timedelta
    proj = make_project(tmp_path, status="done")
    (proj / "legacy").mkdir()
    _set_config(proj, {"boundary": {"forbidden": ["legacy/**"]},
                       "bypass_until": (datetime.now() - timedelta(minutes=1)).isoformat()})
    assert run_guard(proj, proj / "legacy" / "old.ts").returncode == 2


def test_bypass_also_pardons_task_boundary(tmp_path):
    """bypass 对任务边界同样生效（与 commit 门禁同源的唯一逃生口）。"""
    from datetime import datetime, timedelta
    proj = make_project(tmp_path, status="planning")
    _set_config(proj, {"bypass_until": (datetime.now() + timedelta(minutes=10)).isoformat()})
    assert run_guard(proj, proj / "src/auth/login.ts").returncode == 0


def test_forbidden_wrong_shape_warns_not_bricks(tmp_path):
    """形状错误 fail-loud 警告但不砖（返回放行）。"""
    proj = make_project(tmp_path, status="done")
    (proj / "legacy").mkdir()
    _set_config(proj, {"boundary": {"forbidden": "legacy/**"}})  # 字符串=错形
    r = run_guard(proj, proj / "legacy" / "old.ts")
    assert r.returncode == 0
    assert "形状错误" in r.stderr


def test_done_manifest_body_status_quote_passes(tmp_path):
    """v1.23.2 长寿回归：done 清单正文引用状态词（如报错自救备注里写 status: in-progress）
    不得诈尸回 active——旧实现 ACTIVE_STATUS_RE.search(全文) 会中招，导致神秘禁编。"""
    proj = make_project(tmp_path, status="done")
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text() + "\n> 复盘备注：当时卡在 status: in-progress 的误判上\n")
    r = run_guard(proj, proj / "src" / "auth" / "login.ts")
    assert r.returncode == 0, f"done 清单被正文引用诈尸: {r.stdout}"


def test_long_body_manifest_still_detected(tmp_path):
    """对照：正文极长的真活跃清单仍被识别（head 读只截正文，不吞 frontmatter）。"""
    proj = make_project(tmp_path, status="in-progress")
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text() + ("填充行\n" * 800))
    r = run_guard(proj, proj / "src" / "other" / "x.ts")
    assert r.returncode == 2


# ── v1.29：Bash 写目标旁路收口（病例：rm 删边界内文件零拦截）──

def run_bash_guard(proj, command):
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(proj)}
    return subprocess.run(
        ["python3", GUARD],
        input=json.dumps({"tool_name": "Bash", "tool_input": {"command": command}}),
        capture_output=True, text=True, env=env, timeout=10)


def test_bash_rm_inside_planning_boundary_blocked(tmp_path):
    """planning 边界内 rm → 拦（活体实验中此形态曾零拦截——v1.29 收口）。"""
    proj = make_project(tmp_path, status="planning")
    r = run_bash_guard(proj, "rm -f src/auth/login.ts")
    assert r.returncode == 2 and "计划待批准" in r.stderr


def test_bash_redirection_write_blocked(tmp_path):
    proj = make_project(tmp_path, status="planning")
    assert run_bash_guard(proj, "echo hello > src/auth/login.ts").returncode == 2
    assert run_bash_guard(proj, "cat x >> src/auth/login.ts").returncode == 2


def test_bash_mv_sed_dd_blocked(tmp_path):
    proj = make_project(tmp_path, status="planning")
    assert run_bash_guard(proj, "mv a src/auth/login.ts").returncode == 2
    assert run_bash_guard(proj, "sed -i 's/a/b/' src/auth/login.ts").returncode == 2
    assert run_bash_guard(proj, "%s if=x of=src/auth/login.ts" % ("d" * 2)).returncode == 2


def test_bash_readonly_sed_not_write_target(tmp_path):
    """v1.90.1（107，×3 标本）：只读 sed（无 -i）不是写向量——地址/文件名
    不再被解析成写目标（活体：sed -n '742,748p' 拦只读探查）。"""
    proj = make_project(tmp_path, status="in-progress")
    assert run_bash_guard(
        proj, "sed -n '742,748p' src/auth/login.ts").returncode == 0
    assert run_bash_guard(
        proj, "sed -n '3,9p;12,20p' src/auth/login.ts").returncode == 0


def test_stderr_redirect_relative_target_is_write(tmp_path):
    """v1.92.2（113，野外 F4）：2>相对路径真文件=写目标，参与边界判定。"""
    proj = make_project(tmp_path, status="planning")
    assert run_bash_guard(
        proj, "python3 tool.py 2> src/auth/login.ts").returncode == 2
    assert run_bash_guard(
        proj, "npm run build 2>> build_out.log").returncode == 2


def test_stderr_redirect_absolute_and_fd_dup_not_targets(tmp_path):
    """绝对路径 stderr 日志不提取（F3 摩擦权衡）；2>&1 无文件目标。"""
    proj = make_project(tmp_path, status="in-progress")
    assert run_bash_guard(
        proj, "python3 tool.py 2> /tmp/err.log").returncode == 0
    assert run_bash_guard(
        proj, "python3 tool.py 2>&1 | grep x").returncode == 0


def test_bash_harmless_and_devnull_pass(tmp_path):
    """无写目标的命令与 /dev/null 重定向放行（fail-open 防误拦）。"""
    proj = make_project(tmp_path, status="in-progress")
    assert run_bash_guard(proj, "python3 -m pytest tests/ -q").returncode == 0
    assert run_bash_guard(proj, "ls src/auth && echo done").returncode == 0
    assert run_bash_guard(proj, "pytest 2>/dev/null").returncode == 0


def test_bash_in_progress_boundary_write_allowed(tmp_path):
    """in-progress 已批准：边界内 Bash 写放行（正常开发流不打断）。"""
    proj = make_project(tmp_path, status="in-progress")
    assert run_bash_guard(proj, "rm src/auth/login.ts").returncode == 0


def test_bash_outside_boundary_blocked_when_active(tmp_path):
    proj = make_project(tmp_path, status="in-progress")
    assert run_bash_guard(proj, "rm src/other/x.ts").returncode == 2


# ── v1.30：cd 链跟踪（病例：cd 子目录后相对写目标曾被解析到项目根，首例活体误拦）──

def test_bash_cd_chain_relative_target_resolved(tmp_path):
    """cd 子目录后的相对写目标按链上目录解析——不再误拦。"""
    proj = make_project(tmp_path, status="in-progress")
    assert run_bash_guard(proj, "cd src && rm auth/login.ts").returncode == 0
    assert run_bash_guard(proj, "cd src && rm other/x.ts").returncode == 2


def test_bash_cd_variable_fail_open(tmp_path):
    proj = make_project(tmp_path, status="planning")
    assert run_bash_guard(proj, "cd $D && rm x.ts").returncode == 0


def test_bash_absolute_target_unaffected(tmp_path):
    proj = make_project(tmp_path, status="in-progress")
    assert run_bash_guard(proj, "rm src/auth/login.ts").returncode == 0


# ─── v1.34：config 常设白名单（020 装机债对称修复）+ 跨会话编辑守卫 ────

def test_config_standing_include_whitelists_machine_paths(tmp_path):
    """config boundary.include：装机类机级绝对路径的合法出口——不再逼 bypass。

    病例（2026-09-05 020 装机）：boundary.forbidden 一直被读而 include 从不被读，
    /etc/systemd 装机只能走 5 分钟 bypass 赦免记债。"""
    proj = make_project(tmp_path)
    (proj / ".regress" / "config.json").write_text(
        json.dumps({"boundary": {"include": ["/etc/systemd/system/**"]}}))
    r = run_guard(proj, "/etc/systemd/system/regress-watchdog.service")
    assert r.returncode == 0


def test_outside_project_without_include_still_blocks(tmp_path):
    """白名单是出口不是默认：无 config include 时项目外路径照拦（老语义）。"""
    proj = make_project(tmp_path)
    r = run_guard(proj, "/etc/systemd/system/x.service")
    assert r.returncode == 2 and "开发边界" in r.stderr


def test_forbidden_wins_over_include(tmp_path):
    """deny 优先于 allow：同一路径既在 forbidden 又在 include → 拦。"""
    proj = make_project(tmp_path)
    (proj / ".regress" / "config.json").write_text(
        json.dumps({"boundary": {"include": ["/etc/**"],
                                 "forbidden": ["/etc/shadow"]}}))
    assert run_guard(proj, "/etc/systemd/x.service").returncode == 0
    assert run_guard(proj, "/etc/shadow").returncode == 2


def _stamp_manifest(proj, mid, session):
    mf = proj / ".regress" / "manifests" / f"{mid}.md"
    mf.write_text(mf.read_text().replace(
        "status:", f"session: {session}\nstatus:", 1))


def test_cross_session_edit_blocked(tmp_path):
    """标本5 活体编辑竞态：文件在他会话活跃清单边界内 → 拦+对焦提示。"""
    proj = make_project(tmp_path)  # R1 in-progress 覆盖 src/auth/**
    _stamp_manifest(proj, "R1", "sess-foreign-0001")
    r = run_guard(proj, proj / "src/auth/login.ts",
                  extra_env={"CLAUDE_SESSION_ID": "sess-mine-00002"})
    assert r.returncode == 2 and "跨会话" in r.stderr and "sentinel" in r.stderr


def test_own_session_edit_unaffected(tmp_path):
    """戳==本会话：老行为不变（in-progress 边界内放行）。"""
    proj = make_project(tmp_path)
    _stamp_manifest(proj, "R1", "sess-mine-00002")
    r = run_guard(proj, proj / "src/auth/login.ts",
                  extra_env={"CLAUDE_SESSION_ID": "sess-mine-00002"})
    assert r.returncode == 0


def test_unstamped_manifest_stays_shared(tmp_path):
    """无戳清单=共享语义（老清单不受会话作用域影响）。"""
    proj = make_project(tmp_path)
    r = run_guard(proj, proj / "src/auth/login.ts",
                  extra_env={"CLAUDE_SESSION_ID": "sess-mine-00002"})
    assert r.returncode == 0


# ─── v1.77（066）：写目标提取误判根治——引号内容/heredoc 体 ────────

def _bg():
    import importlib.util as ilu
    spec = ilu.spec_from_file_location("bg-unit", GUARD)
    m = ilu.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def test_dequoted_payload_command_word_not_target():
    """活体回放：载荷引号内英文命令词（install…）不再把后续文本当写目标。"""
    m = _bg()
    payload = '\'{"summary":"B9 install smoke 按顾问提醒保留 无新决策点"}\''
    cmd = "python3 tool.py . add r " + payload
    assert m.extract_write_targets(cmd, "/tmp/p") == []


def test_heredoc_body_not_targets_but_redir_is():
    """heredoc 体内的 rm/重定向样文本不收；cat 的重定向本体仍收。"""
    m = _bg()
    cmd = ("cat > /tmp-decoy/out.sh <<'EOF'\n"
           "cd /x && rm -rf important\n"
           "echo hi > inner.txt\n"
           "EOF\n"
           "echo done")
    ts = m.extract_write_targets(cmd, "/tmp/p")
    assert any(t.endswith("out.sh") for t in ts)
    assert not any("important" in t or "inner.txt" in t for t in ts)


def test_redirect_dequoted_comparison_not_target():
    """第四标本回放（071）：载荷引号内比较符 >=3 不再成写目标。"""
    m = _bg()
    payload = '\'{"summary":"hits 大于等于 3 即 >=3"}\''
    assert m.extract_write_targets(
        "python3 tool.py . add r " + payload, "/tmp/p") == []


def test_redirect_herestring_and_real_writes():
    """herestring 不中；裸目标与引号目标双形态真写仍收（不漏真写）。"""
    m = _bg()
    assert m.extract_write_targets("grep foo <<< 'word'", "/tmp/p") == []
    ts = m.extract_write_targets("echo x > /tmp/out.txt", "/tmp/p")
    assert any(t.endswith("/tmp/out.txt") for t in ts)
    ts = m.extract_write_targets("echo x > 'my file.txt'", "/tmp/p")
    assert any(t.endswith("my file.txt") for t in ts)


def test_quoted_redirection_target_still_caught():
    """真写不漏：引号目标形态仍被收。"""
    m = _bg()
    ts = m.extract_write_targets("echo x > 'my file.txt'", "/tmp/p")
    assert any(t.endswith("my file.txt") for t in ts)
    ts = m.extract_write_targets('echo x > "另一档.txt"', "/tmp/p")
    assert any(t.endswith("另一档.txt") for t in ts)
