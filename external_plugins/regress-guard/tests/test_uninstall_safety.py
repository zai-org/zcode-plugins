"""卸载安全（v1.95.1，124）：skill 所有权检查——宁可不删也不错删。

外部评审实证面：uninstall 曾按名 rm -rf 6 个 skill 无所有权检查，
用户自建同名 skill 会被误删。真脚本沙箱跑（ZCODE_HOME 覆写），非逻辑复刻。
"""
import os
import subprocess
import pytest

UNINSTALL = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "uninstall.sh"))

_LEGACY_SKILLS = ["regression-planning", "characterization-testing",
                  "change-impact-analysis", "requirement-parsing",
                  "adaptive-thinking", "adaptive-learning"]


def _sandbox(tmp_path, marker=False, foreign=True):
    """搭 ~/.zcode 沙箱：1 个带标记旧 skill + 1 个用户自建同名 skill。"""
    zhome = tmp_path / "zhome"
    ours = zhome / "skills" / "regression-planning"
    ours.mkdir(parents=True)
    (ours / "SKILL.md").write_text("legacy ours", encoding="utf-8")
    if marker:
        (ours / ".regress-guard-skill").write_text("1", encoding="utf-8")
    if foreign:
        mine = zhome / "skills" / "adaptive-thinking"
        mine.mkdir(parents=True)
        (mine / "SKILL.md").write_text("user's own skill", encoding="utf-8")
    return zhome


def _run_uninstall(zhome):
    env = {**os.environ, "REGRESS_ZCODE_HOME": str(zhome)}
    return subprocess.run(["bash", UNINSTALL], capture_output=True,
                          text=True, env=env, timeout=60)


def test_unmarked_skill_kept_with_hint(tmp_path):
    zhome = _sandbox(tmp_path, marker=False)
    r = _run_uninstall(zhome)
    assert r.returncode == 0
    kept = zhome / "skills" / "regression-planning" / "SKILL.md"
    assert kept.exists()  # 无标记 → 不删
    assert "所有权标记" in r.stdout  # 有人工确认指引
    assert "rm -rf" in r.stdout


def test_marked_skill_removed(tmp_path):
    zhome = _sandbox(tmp_path, marker=True)
    r = _run_uninstall(zhome)
    assert r.returncode == 0
    assert not (zhome / "skills" / "regression-planning").exists()  # 带标记 → 自动删


def test_user_owned_skill_never_touched(tmp_path):
    """用户自建同名 skill（无标记）必须原样幸存——评审指控的核心场景。"""
    zhome = _sandbox(tmp_path, marker=True)
    r = _run_uninstall(zhome)
    assert r.returncode == 0
    mine = zhome / "skills" / "adaptive-thinking" / "SKILL.md"
    assert mine.exists() and mine.read_text(encoding="utf-8") == "user's own skill"
