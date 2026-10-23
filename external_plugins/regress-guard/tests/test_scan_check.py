"""scan_check — 全貌新鲜度判定（v1.40，REGRESS-2026-029）。

三态判定：fresh（卡片与代码同步）/ stale（提交>=3 或结构性增删 → 重扫）/
absent（无卡片 → M/L 先建卡或声明纯库）。
"""
import json
import os
import subprocess
import sys

LIB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hooks",
                                   "scripts", "lib"))
SCAN = os.path.join(LIB, "scan_check.py")


def _load():
    import importlib.util as ilu
    spec = ilu.spec_from_file_location("sc_test", SCAN)
    m = ilu.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _git(repo, *args):
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                       text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def _mk_repo(tmp_path):
    proj = tmp_path / "proj"
    (proj / ".regress" / "manifests").mkdir(parents=True)
    (proj / "src").mkdir()
    _git(proj, "init", "-q")
    _git(proj, "config", "user.email", "t@t")
    _git(proj, "config", "user.name", "t")
    (proj / "src" / "a.py").write_text("a = 1\n", encoding="utf-8")
    _git(proj, "add", "-A")
    _git(proj, "commit", "-qm", "init")
    return proj


def _commit_card(proj):
    (proj / ".regress" / "product-arch.md").write_text(
        "# 产品·架构地图\n\n## 模块：核心\n- **完成度**：骨架可用\n",
        encoding="utf-8")
    _git(proj, "add", "-A")
    _git(proj, "commit", "-qm", "card")


def test_absent_when_no_card(tmp_path):
    proj = _mk_repo(tmp_path)
    sc = _load()
    r = sc.check(str(proj))
    assert r["verdict"] == "absent" and "纯库" in r["note"]


def test_fresh_right_after_card(tmp_path):
    proj = _mk_repo(tmp_path)
    _commit_card(proj)
    sc = _load()
    assert sc.check(str(proj))["verdict"] == "fresh"


def test_stale_on_structural_add(tmp_path):
    """结构性新增（非 tests/docs/md）→ stale——028 标本的判定侧。"""
    proj = _mk_repo(tmp_path)
    _commit_card(proj)
    (proj / "src" / "new_module.py").write_text("x = 1\n", encoding="utf-8")
    _git(proj, "add", "-A")
    _git(proj, "commit", "-qm", "add module")
    sc = _load()
    r = sc.check(str(proj))
    assert r["verdict"] == "stale"
    assert any("new_module.py" in s for s in r["structural_changes"])


def test_not_stale_on_metadata_only(tmp_path):
    """tests/docs/md 是模块元数据不是模块——只动它们不判 stale（顾问路径豁免）。"""
    proj = _mk_repo(tmp_path)
    _commit_card(proj)
    (proj / "tests").mkdir()
    (proj / "tests" / "t.py").write_text("def test_x(): pass\n", encoding="utf-8")
    (proj / "docs").mkdir()
    (proj / "docs" / "x.md").write_text("doc\n", encoding="utf-8")
    _git(proj, "add", "-A")
    _git(proj, "commit", "-qm", "meta only")
    sc = _load()
    r = sc.check(str(proj))
    assert r["structural_changes"] == []
    assert r["verdict"] == "fresh"  # 1 次提交 <3 且无结构性增删


def test_stale_on_commit_volume(tmp_path):
    """无结构变更但代码提交堆到 3 次 → stale（活动量代理）。"""
    proj = _mk_repo(tmp_path)
    _commit_card(proj)
    for i in range(3):
        (proj / "src" / "a.py").write_text(f"a = {i}\n", encoding="utf-8")
        _git(proj, "add", "-A")
        _git(proj, "commit", "-qm", f"tweak {i}")
    sc = _load()
    r = sc.check(str(proj))
    assert r["verdict"] == "stale" and r["code_commits_since"] >= 3


def test_json_cli(tmp_path, capsys):
    proj = _mk_repo(tmp_path)
    _commit_card(proj)
    sc = _load()
    sc.main([str(proj), "--json"])
    r = json.loads(capsys.readouterr().out)
    assert r["verdict"] == "fresh" and r["card"] == ".regress/product-arch.md"
