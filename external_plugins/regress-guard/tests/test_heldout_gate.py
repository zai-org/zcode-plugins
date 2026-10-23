"""held-out 验收门测试（106：稳定性条件 1 补法）。

四路生命周期（冻结/退化/哈希锁/重冻）用本地快桩场景进程内驱动；
一条真束集成测（~15s）验证八场景对真实钩子脚本全过。
"""
import json
import os
import subprocess
import sys

import pytest

SCRIPTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts"))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import heldout_gate as hg  # noqa: E402


def _stub_scenarios():
    """快桩：本地定义的场景束（与真实 H1 同型）——测试可自由改期望不触真束。"""
    def build(root):
        p = hg._mk_project(root, "s1")
        return hg.GUARD, "git add src/app.js && git commit -m 改动（R1）", p

    return [{"id": "S1-compound", "build": build, "code": 2, "has": "复合"}]


@pytest.fixture
def proj(tmp_path, monkeypatch):
    p = tmp_path / "proj"
    (p / ".regress" / "manifests").mkdir(parents=True)
    monkeypatch.setattr(hg, "SCENARIOS", _stub_scenarios())
    monkeypatch.setattr(sys, "argv", ["heldout_gate.py", "--project", str(p)])
    return p


def _run_main():
    return hg.main()


def test_first_run_freezes_baseline(proj, capsys):
    """首跑无基线：自动冻结 exit 0，基线落 .regress（树键排除面）。"""
    assert _run_main() == 0
    bp = proj / ".regress" / "heldout-baseline.json"
    assert bp.exists()
    data = json.loads(bp.read_text(encoding="utf-8"))
    assert data["outcomes"] == {"S1-compound": "pass"}
    assert data["digest"] == hg.scenarios_digest(hg.SCENARIOS)


def test_regression_blocks(proj, monkeypatch):
    """行为退化（期望不变、实况变了）→ exit 3。"""
    assert _run_main() == 0
    _real_sh = hg._sh

    def _broken_sh(script, command, project, **kw):
        return 0, ""  # 行为漂移：本该拦的不拦了

    monkeypatch.setattr(hg, "_sh", _broken_sh)
    assert _run_main() == 3


def test_hash_lock_requires_refreeze(proj, monkeypatch):
    """场景期望被改（摘要变）→ exit 4，不跑束——Goodhart 锁。"""
    assert _run_main() == 0
    monkeypatch.setattr(hg, "SCENARIOS", [{
        "id": "S1-compound", "build": _stub_scenarios()[0]["build"],
        "code": 0, "has": ""}])  # 削弱期望=摘要变
    called = []
    monkeypatch.setattr(hg, "run_battery",
                        lambda *a, **k: called.append(1) or {})
    assert _run_main() == 4
    assert not called  # 摘要不符先拦，束根本不跑


def test_refreeze_adopts(proj, monkeypatch):
    """--refreeze：显式重冻收编当前实况，exit 0。"""
    assert _run_main() == 0
    monkeypatch.setattr(sys, "argv", ["heldout_gate.py", "--project",
                                      str(proj), "--refreeze"])
    assert _run_main() == 0


def test_improvement_noted_not_blocked(proj, monkeypatch):
    """fail→pass 只报不拦：exit 0 + 建议重冻。"""
    real_sh = hg._sh
    monkeypatch.setattr(hg, "_sh", lambda *a, **k: (0, ""))  # 偏离实况→fail 冻结
    assert _run_main() == 0
    bp = proj / ".regress" / "heldout-baseline.json"
    assert json.loads(bp.read_text(encoding="utf-8"))["outcomes"][
        "S1-compound"] == "fail"
    monkeypatch.setattr(hg, "_sh", real_sh)  # 实况恢复→改善：放行
    assert _run_main() == 0


def test_real_battery_integration(tmp_path):
    """真束集成：十四场景对真实钩子脚本全过（~15s，首冻即验夹具）。"""
    p = tmp_path / "proj"
    (p / ".regress").mkdir(parents=True)
    r = subprocess.run(
        ["python3", os.path.join(SCRIPTS, "heldout_gate.py"),
         "--project", str(p)],
        capture_output=True, text=True, timeout=180, cwd=SCRIPTS)
    assert r.returncode == 0, r.stderr
    data = json.loads((p / ".regress" / "heldout-baseline.json")
                      .read_text(encoding="utf-8"))
    assert len(data["outcomes"]) == 14
    assert all(v == "pass" for v in data["outcomes"].values()), data["outcomes"]
    # v1.92.7（118）：写后补戳链两场景必须在束且过（116 回归点）
    assert data["outcomes"].get("H13-post-stamp-no-block") == "pass"
    assert data["outcomes"].get("H14-post-stamp-teeth") == "pass"


def test_deploy_flat_layout_resolution(tmp_path):
    """v1.92.8（119）：部署平铺布局——heldout_gate 与钩子同目录时解析到平铺
    副本（部署态恰测线上钩子；此前固定 ../hooks/scripts 在部署布局落空）。
    """
    import shutil
    deploy = tmp_path / "deploy"
    deploy.mkdir()
    # 平铺布局：heldout_gate.py + 钩子 + lib 同目录（install.sh 形态）
    src_hooks = os.path.join(os.path.dirname(SCRIPTS), "hooks", "scripts")
    for f in ("pre_commit_guard.py", "read_before_edit_guard.py", "execution_valve.py"):
        shutil.copy(os.path.join(src_hooks, f), deploy / f)
    shutil.copytree(os.path.join(src_hooks, "lib"), deploy / "lib",
                    dirs_exist_ok=True)
    shutil.copy(os.path.join(SCRIPTS, "heldout_gate.py"),
                deploy / "heldout_gate.py")
    # 从平铺位置导入并验证解析
    sys.path.insert(0, str(deploy))
    try:
        for m in [k for k in list(sys.modules) if k == "heldout_gate"]:
            del sys.modules[m]
        import heldout_gate as flat
        assert os.path.dirname(flat.GUARD) == str(deploy), \
            f"平铺布局应解析到部署目录: {flat.GUARD}"
        assert os.path.exists(flat.GUARD) and os.path.exists(flat.RGUARD)
        assert os.path.dirname(flat.VALVE) == str(deploy), \
            f"VALVE 也须走 _HOOKS（119 漏网标本）: {flat.VALVE}"
        assert os.path.exists(flat.VALVE)
    finally:
        sys.path.remove(str(deploy))
        for m in [k for k in list(sys.modules) if k == "heldout_gate"]:
            del sys.modules[m]
