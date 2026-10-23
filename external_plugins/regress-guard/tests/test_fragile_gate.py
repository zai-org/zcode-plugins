"""pre_commit_guard 的脆弱点挂牌门禁（公理一）+ .regress staged 豁免测试。"""
import os
import sys
import json
import subprocess

LIB = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts")
GUARD = os.path.abspath(os.path.join(LIB, "pre_commit_guard.py"))

MANIFEST_TMPL = """---
id: REGRESS-2026-001
requirement: "test req"
status: in-progress
rollback: git revert 即回滚
self_review:
  调试残留: "console.log(1) 是夹具内容，非残留"
planned_changes:
  - id: F1
    file: "src/app.js"
    type: method-logic
fragile_points:
{fps}
actual_changes: []
created_at: 2026-08-21
---
# body
"""

FPS_OPEN = (
    '  - id: V1\n    kind: env\n    description: "CUDA 由 module 加载"\n'
    '    verify: "python3 -c \\"import torch\\""\n    status: open'
)
FPS_FLAGGED = (
    '  - id: V1\n    kind: env\n    description: "已知悉，下季度修"\n'
    '    verify: "echo ok"\n    status: flagged'
)
FPS_LOCKED = (
    '  - id: V1\n    kind: env\n    description: "CUDA"\n'
    '    verify: "echo ok"\n    status: locked'
)
# locked 但 verify 命令失败（门禁复验应拦/警告——自封不算数）
FPS_LOCKED_FAIL = (
    '  - id: V1\n    kind: env\n    description: "CUDA"\n'
    '    verify: "exit 3"\n    status: locked'
)
# locked 但无 verify 命令（证据链缺环）
FPS_LOCKED_NOVERIFY = (
    '  - id: V1\n    kind: env\n    description: "CUDA"\n    status: locked'
)


def make_project(tmp_path, fps_yaml, strict=True, stage_journal=False):
    proj = tmp_path / "proj"
    proj.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=proj, check=True, timeout=10)
    rdir = proj / ".regress"
    (rdir / "manifests").mkdir(parents=True)
    (rdir / "config.json").write_text(json.dumps({"strict": strict}))
    (rdir / "manifests" / "REGRESS-2026-001.md").write_text(
        MANIFEST_TMPL.format(fps=fps_yaml))
    src = proj / "src"
    src.mkdir()
    (src / "app.js").write_text("console.log(1)\n")
    subprocess.run(["git", "add", "src/app.js"], cwd=proj, check=True, timeout=10)
    if stage_journal:
        jdir = rdir / "journal"
        jdir.mkdir()
        (jdir / "events.jsonl").write_text('{"kind":"tool_fail","sig":"x"}\n')
        subprocess.run(["git", "add", ".regress/journal/events.jsonl"],
                       cwd=proj, check=True, timeout=10)
    return proj


def run_guard(proj, extra_env=None):
    env = {**os.environ,
           "CLAUDE_PROJECT_DIR": str(proj),
           "CLAUDE_SESSION_ID": "test-fragile"}
    env.update(extra_env or {})
    inp = json.dumps({"tool_name": "Bash",
                      "tool_input": {"command": "git commit -m 改动（001）"}})
    proc = subprocess.run(
        ["python3", GUARD], input=inp, capture_output=True, text=True,
        env=env, timeout=30,
    )
    return proc.returncode, proc.stderr


def test_open_fragile_point_blocks_commit(tmp_path):
    proj = make_project(tmp_path, FPS_OPEN, strict=True)
    code, err = run_guard(proj)
    assert code == 2, f"open 脆弱点应阻断提交, exit={code}\n{err}"
    assert "脆弱点" in err and "V1" in err
    # 阻断事件入历史（审计可追溯）
    history = (proj / ".regress" / "history.jsonl").read_text()
    assert "fragile_point_open" in history


def test_open_fragile_point_warns_when_not_strict(tmp_path):
    proj = make_project(tmp_path, FPS_OPEN, strict=False)
    code, err = run_guard(proj)
    # 非严格模式：脆弱点警告放行 → 走到无测试运行器的 warn（也放行）
    assert code == 0
    assert "脆弱点" in err


def test_flagged_allows_with_notice(tmp_path):
    proj = make_project(tmp_path, FPS_FLAGGED, strict=False)
    code, err = run_guard(proj)
    assert code == 0
    assert "带病挂牌" in err
    assert "V1" in err


def test_locked_silent(tmp_path):
    proj = make_project(tmp_path, FPS_LOCKED, strict=False)
    code, err = run_guard(proj)
    assert code == 0
    assert "脆弱点未挂牌" not in err
    assert "带病挂牌" not in err
    assert "复验失败" not in err          # echo ok 在门禁处真实跑过且通过


def test_locked_verify_fails_blocks(tmp_path):
    """证据律：locked = verify 此刻能过——门禁机器复验，自封不算数。"""
    proj = make_project(tmp_path, FPS_LOCKED_FAIL, strict=True)
    code, err = run_guard(proj)
    assert code == 2, f"locked 复验失败应阻断, exit={code}\n{err}"
    assert "复验失败" in err and "V1" in err
    history = (proj / ".regress" / "history.jsonl").read_text()
    assert "fragile_verify" in history


def test_locked_verify_fails_warns_when_not_strict(tmp_path):
    proj = make_project(tmp_path, FPS_LOCKED_FAIL, strict=False)
    code, err = run_guard(proj)
    assert code == 0
    assert "复验失败" in err


def test_locked_without_verify_warns_evidence_gap(tmp_path):
    """locked 无 verify 命令 = 证据链缺环 → 警告（不阻断）。"""
    proj = make_project(tmp_path, FPS_LOCKED_NOVERIFY, strict=False)
    code, err = run_guard(proj)
    assert code == 0
    assert "自称 locked" in err and "V1" in err


def test_no_fragile_section_passes(tmp_path):
    proj = make_project(tmp_path, "", strict=False)
    code, _ = run_guard(proj)
    assert code == 0


def test_staged_regress_journal_exempt_from_f3(tmp_path):
    """考古地层文件 staged 不算 F3（治理数据不是业务改动）。"""
    proj = make_project(tmp_path, FPS_LOCKED, strict=True, stage_journal=True)
    code, err = run_guard(proj)
    # 不应因 journal 文件不在清单而被拦（strict=true 下若拦了会是 untracked 消息）
    assert "不在回归清单" not in err
    assert ".regress/journal" not in err


def test_parser_extracts_fragile_points(tmp_path):
    sys.path.insert(0, os.path.abspath(os.path.join(LIB, "lib")))
    from manifest_parser import get_fragile_points
    proj = make_project(tmp_path, FPS_OPEN)
    fps = get_fragile_points(str(proj / ".regress" / "manifests" / "REGRESS-2026-001.md"))
    assert len(fps) == 1
    assert fps[0]["id"] == "V1"
    assert fps[0]["status"] == "open"
    assert fps[0]["kind"] == "env"


# ── v1.19：感官分支（AVS 公理三：human_check 化石存在性，不复跑感官）──

FPS_SENSORY_LOCKED = (
    '  - id: V1\n    kind: sensory\n    description: "对讲声音清晰无断续"\n'
    '    verify: "human_check:V1"\n    status: locked'
)


def _write_fossil(proj, lines):
    jdir = proj / ".regress" / "journal"
    jdir.mkdir(parents=True, exist_ok=True)
    (jdir / "events.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_sensory_locked_with_fossil_passes(tmp_path):
    """人的感官读数入档即证据——门禁验化石存在，不复跑感官。"""
    proj = make_project(tmp_path, FPS_SENSORY_LOCKED, strict=False)
    _write_fossil(proj, [
        '{"kind":"tool_fail","sig":"x"}',
        '{"kind":"human_check","manifest_id":"REGRESS-2026-001","vid":"V1",'
        '"question":"对讲声音清晰无断续？","result":"pass"}',
    ])
    code, err = run_guard(proj)
    assert code == 0, err
    assert "复验失败" not in err


def test_sensory_locked_without_fossil_blocks(tmp_path):
    """感官 locked 但无 human_check 化石 = 人工确认未落产物 → 拦并给补化石命令。"""
    proj = make_project(tmp_path, FPS_SENSORY_LOCKED, strict=True)
    code, err = run_guard(proj)
    assert code == 2, err
    assert "human_check" in err and "V1" in err


def test_sensory_fossil_wrong_vid_still_blocks(tmp_path):
    """化石 vid 对不上 → 不算证据（防拿别的确认充数）。"""
    proj = make_project(tmp_path, FPS_SENSORY_LOCKED, strict=True)
    _write_fossil(proj, [
        '{"kind":"human_check","manifest_id":"REGRESS-2026-001","vid":"V9","result":"pass"}',
    ])
    code, err = run_guard(proj)
    assert code == 2
    assert "human_check" in err
