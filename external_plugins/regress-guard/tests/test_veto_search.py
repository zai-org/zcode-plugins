"""被拒批缓冲检索测试（109：稳定性条件 5 补法）。"""
import os
import sys

import pytest

LIB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..",
                                   "hooks", "scripts", "lib"))
if LIB not in sys.path:
    sys.path.insert(0, LIB)

from veto_search import search  # noqa: E402


@pytest.fixture
def proj(tmp_path):
    p = tmp_path / "proj"
    (p / ".regress" / "manifests").mkdir(parents=True)
    (p / ".regress" / "journal").mkdir(parents=True)
    return p


def test_decisions_source_hit(proj):
    """decisions 分节：窗口内含关键词的否决条目命中。"""
    from datetime import date
    today = date.today().isoformat()
    (proj / ".regress" / "decisions.md").write_text(
        f"# 决策日志\n\n## {today} 某轮 砍批：向量检索方案\n- 否决：语义检索过重，"
        f"关键词够用\n\n## 2020-01-01 古老条目 前端重构\n- 无关\n",
        encoding="utf-8")
    hits = search(str(proj), "向量检索 砍批")
    assert len(hits) == 1
    assert hits[0]["source"] == "decisions" and hits[0]["date"] == today


def test_cancelled_manifest_hit(proj):
    """cancelled 清单：内容匹配命中且带 cancel_reason 节选。"""
    from datetime import date
    today = date.today().isoformat()
    (proj / ".regress" / "manifests" / "2026-099-x.md").write_text(
        f"---\nid: REGRESS-2026-099\nstatus: cancelled\n"
        f"cancel_reason: 复合拦截重评标本不足\n"
        f"created_at: '{today}'\nrequirement: 复合拦截 机器拦\n---\n",
        encoding="utf-8")
    hits = search(str(proj), "复合拦截")
    assert len(hits) == 1
    assert hits[0]["source"] == "cancelled-manifest"
    assert "标本不足" in hits[0]["excerpt"]


def test_journal_objection_hit(proj):
    """journal 反对语义化石命中。"""
    from datetime import datetime
    ts = datetime.now().isoformat()
    (proj / ".regress" / "journal" / "events.jsonl").write_text(
        f'{{"ts": "{ts}", "kind": "plan_advisor_review", '
        f'"manifest_id": "R1", "verdict": "objection", '
        f'"summary": "否决 图结构 建库方案过重"}}\n',
        encoding="utf-8")
    hits = search(str(proj), "图结构")
    assert len(hits) == 1
    assert hits[0]["source"] == "journal-objection"


def test_window_filters_old_and_no_hit_clean(proj):
    """窗口外旧否决不命中；无记录项目零命中零报错。"""
    (proj / ".regress" / "decisions.md").write_text(
        "## 2020-01-01 砍批：老方案\n- 否决记录\n", encoding="utf-8")
    assert search(str(proj), "老方案") == []
    (proj / ".regress" / "decisions.md").unlink()
    assert search(str(proj), "任何词") == []
