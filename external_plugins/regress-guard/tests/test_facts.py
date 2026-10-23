"""机器事实卡 v1.32 三层结构：薄索引+references/<域>.md、机械重建、同键刷新、health。"""
import datetime
import importlib.util as ilu
import os

LIB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib"))


def _load(tmp_path, monkeypatch):
    card = tmp_path / "facts" / "SKILL.md"
    monkeypatch.setenv("RG_FACTS_CARD", str(card))
    spec = ilu.spec_from_file_location("facts", os.path.join(LIB, "facts.py"))
    m = ilu.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m, card


def test_record_creates_thin_card_with_index(tmp_path, monkeypatch):
    m, card = _load(tmp_path, monkeypatch)
    assert m.record("SSH直连", "ssh tencent-cloud", "server") == "appended"
    text = card.read_text(encoding="utf-8")
    assert "name: machine-facts" in text and "先读" in text          # 路由层常驻
    assert "- " in text and "SSH直连" in text and "references/server.md" in text  # 索引行
    assert "ssh tencent-cloud" not in text                            # 正文不放事实本体
    ref = tmp_path / "facts" / "references" / "server.md"
    assert "### " in ref.read_text(encoding="utf-8") and "ssh tencent-cloud" in ref.read_text(encoding="utf-8")


def test_rehit_refreshes_date_not_duplicating(tmp_path, monkeypatch):
    m, card = _load(tmp_path, monkeypatch)
    assert m.record("SSH直连", "旧表述", "server", when=datetime.date(2026, 1, 1)) == "appended"
    assert m.record("SSH直连", "新表述", "server", when=datetime.date(2026, 9, 5)) == "refreshed"
    ref = (tmp_path / "facts" / "references" / "server.md").read_text(encoding="utf-8")
    assert ref.count("### 2026-") == 1
    assert "### 2026-09-05 · SSH直连" in ref
    assert "新表述" in ref and "旧表述" not in ref
    idx = card.read_text(encoding="utf-8")
    assert "2026-09-05 · [server] SSH直连" in idx and "2026-01-01" not in idx  # 索引跟新


def test_index_orders_by_date_desc_and_covers_domains(tmp_path, monkeypatch):
    m, card = _load(tmp_path, monkeypatch)
    m.record("老", "a", "zsh", when=datetime.date(2026, 1, 1))
    m.record("新", "b", "server", when=datetime.date(2026, 9, 5))
    m.record("中", "c", "server", when=datetime.date(2026, 6, 1))
    lines = [l for l in card.read_text(encoding="utf-8").split("\n") if l.startswith("- ")]
    dates = [l[2:].split(" ")[0] for l in lines]
    assert dates[0] == "2026-09-05" and dates[-1] == "2026-01-01"
    assert m.health()["count"] == 3
    assert (tmp_path / "facts" / "references" / "zsh.md").exists()


def test_health_reports_oldest_and_stale(tmp_path, monkeypatch):
    m, _ = _load(tmp_path, monkeypatch)
    m.record("老事实", "x", "server", when=datetime.date(2025, 1, 1))
    m.record("新事实", "y", "server")
    h = m.health()
    assert h["count"] == 2 and h["oldest_days"] > 180
    # 2025-01-01 距今 >270 天 → 直接进退场档（B9：stale 与 retire 互斥分层）
    assert [s[2] for s in h["retire"]] == ["老事实"]
    assert h["stale"] == []


def test_health_retire_threshold(tmp_path, monkeypatch):
    """三档分层：<180 正常｜180-270 stale｜>270 退场候选（机制代谢）。"""
    m, _ = _load(tmp_path, monkeypatch)
    today = datetime.date.today()
    m.record("正常", "a", "env", when=today)
    m.record("陈旧", "b", "env", when=today - datetime.timedelta(days=200))
    m.record("超龄", "c", "env", when=today - datetime.timedelta(days=300))
    h = m.health()
    assert [s[2] for s in h["stale"]] == ["陈旧"]
    assert [s[2] for s in h["retire"]] == ["超龄"]


def test_cli_health_smoke(tmp_path, monkeypatch, capsys):
    m, _ = _load(tmp_path, monkeypatch)
    m.record("CLI冒烟", "z", "env")
    assert m.main(["health"]) == 0
    out = capsys.readouterr().out
    assert "机器事实卡" in out and "1 条" in out
