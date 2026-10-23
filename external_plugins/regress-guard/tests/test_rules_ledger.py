"""规律账本（v1.24 代谢链）：正负路径——从未失败过的守卫等于未验证的守卫。"""
import json
import os
import subprocess
import sys
from datetime import date, timedelta

import pytest

LIB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib"))
LEDGER = os.path.join(LIB, "rules_ledger.py")


def _mk(tmp_path):
    proj = tmp_path / "proj"
    (proj / ".regress").mkdir(parents=True)
    return proj


def _run(proj, *args):
    return subprocess.run(
        [sys.executable, LEDGER, str(proj), *(str(a) for a in args)],
        capture_output=True, text=True, timeout=15)


def test_record_first_time_then_hit(tmp_path):
    """首记 hits=1；同签名再记 = 命中 hits+1 且 last_hit 刷新；不同签名分行。"""
    proj = _mk(tmp_path)
    r1 = _run(proj, "record", "--sig", "taos UnsatisfiedLinkError", "--occurrences", 3)
    assert r1.returncode == 0 and "新沉淀" in r1.stdout
    r2 = _run(proj, "record", "--sig", "taos UnsatisfiedLinkError", "--occurrences", 5)
    assert "命中（第 2 次）" in r2.stdout
    _run(proj, "record", "--sig", "port 18801 occupied", "--occurrences", 1)
    data = json.load(open(proj / ".regress" / "rules-ledger.json", encoding="utf-8"))
    assert len(data) == 2
    e = next(e for e in data.values() if e["sig"] == "taos UnsatisfiedLinkError")
    assert e["hits"] == 2 and e["occurrences"] == 5  # occurrences 取 max
    assert e["captured_at"] and e["last_hit"]


def test_health_decay_and_promote(tmp_path, capsys):
    """降级候选（>180 天零命中）与固化候选（hits≥3 且未腐化）分列；腐化者不固化。"""
    import importlib.util as ilu
    spec = ilu.spec_from_file_location("rl", LEDGER)
    rl = ilu.module_from_spec(spec)
    spec.loader.exec_module(rl)
    proj = _mk(tmp_path)
    old = (date.today() - timedelta(days=200)).isoformat()
    data = {
        "a": {"sig": "老规律没人用了", "captured_at": old, "last_hit": old, "hits": 5, "occurrences": 9},
        "b": {"sig": "高频稳定规律", "captured_at": old, "last_hit": date.today().isoformat(), "hits": 4, "occurrences": 7},
        "c": {"sig": "新规律", "captured_at": date.today().isoformat(), "last_hit": date.today().isoformat(), "hits": 1, "occurrences": 1},
    }
    (proj / ".regress" / "rules-ledger.json").write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8")
    out = rl.health(str(proj))
    assert [e["sig"] for e in out["promotable"]] == ["高频稳定规律"]
    assert [e["sig"] for e in out["stale"]] == ["老规律没人用了"]
    printed = capsys.readouterr().out
    assert "永不自动删" in printed and "固化候选" in printed


def test_corrupt_ledger_tolerated(tmp_path):
    """坏 JSON 容错：load 返回空表，record 从零重建（地层是增强不是依赖）。"""
    proj = _mk(tmp_path)
    (proj / ".regress" / "rules-ledger.json").write_text("{不是json", encoding="utf-8")
    r = _run(proj, "record", "--sig", "x", "--occurrences", 1)
    assert r.returncode == 0
    data = json.load(open(proj / ".regress" / "rules-ledger.json", encoding="utf-8"))
    assert len(data) == 1


# ─── v1.57 近重复自检（B2：源头去重） ────────────────

def test_record_near_dup_hint(tmp_path, capsys):
    """新沉淀与既有共享 ≥6 bigram → 提示近重复+supersede 建议（print-only）。"""
    rl = _load_rl()
    rl.record(str(tmp_path), "f-string 字面量大括号写成单层导致 KeyError 定位模板", 2)
    rl.record(str(tmp_path), "f-string 字面量大括号单层导致 KeyError 的另一说法", 1)
    out = capsys.readouterr().out
    assert "近重复候选" in out and "supersede" in out and "f-string" in out
    # 提示不阻断：两条账目都在
    assert len([k for k, e in rl.load(str(tmp_path)).items()
                if not str(k).startswith("_")]) == 2


def test_record_distinct_no_hint(tmp_path, capsys):
    """无关新沉淀：无近重复提示。"""
    rl = _load_rl()
    rl.record(str(tmp_path), "端口占用 18801 启动失败", 1)
    rl.record(str(tmp_path), "git rebase 冲突未解决", 1)
    assert "近重复候选" not in capsys.readouterr().out


def test_record_same_sig_rehit_no_hint(tmp_path, capsys):
    """同 sig 再检出（命中路径）：精确去重已在，不打近重复提示。"""
    rl = _load_rl()
    rl.record(str(tmp_path), "f-string 字面量大括号写成单层导致 KeyError", 1)
    capsys.readouterr()
    rl.record(str(tmp_path), "f-string 字面量大括号写成单层导致 KeyError", 2)
    out = capsys.readouterr().out
    assert "命中" in out and "近重复候选" not in out


def test_not_initialized_project(tmp_path):
    """未接入项目：exit 1 + stderr 提示，不炸。"""
    r = _run(tmp_path / "nope", "health")
    assert r.returncode == 1 and "未找到" in r.stderr


# ─── v1.48 版本链接（B3 迷你 Pareto 记忆） ────────────────

def test_superseded_rule_not_decay_candidate(tmp_path, capsys):
    """被取代规律过气=预期：不进降级候选，单列已取代节。"""
    import sys as _sys
    _sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..",
                                     "hooks", "scripts", "lib"))
    from rules_ledger import record, supersede, health
    record(str(tmp_path), "旧规律签名A", 3)
    supersede(str(tmp_path), "旧规律签名A", "新规律签名B")
    r = health(str(tmp_path), decay_days=-1)  # -1 → 当天也算超期
    out = capsys.readouterr().out
    assert r["stale"] == [] or all("旧规律签名A" not in str(e.get("sig", ""))
                                   for e in r["stale"])
    assert "已取代" in out and "旧规律签名A"[:20] in out.replace("「", "")


def test_unlinked_rule_decay_unchanged(tmp_path):
    """无链接的规律照旧参与衰变（行为不变）。"""
    import sys as _sys
    _sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..",
                                     "hooks", "scripts", "lib"))
    from rules_ledger import record, health
    record(str(tmp_path), "独立规律C", 1)
    r = health(str(tmp_path), decay_days=-1)
    assert any("独立规律C" in str(e.get("sig", "")) for e in r["stale"])


# ─── v1.53 召回（B1 骨架库读路径） ────────────────

def _load_rl():
    import importlib.util as ilu
    spec = ilu.spec_from_file_location("rl", LEDGER)
    rl = ilu.module_from_spec(spec)
    spec.loader.exec_module(rl)
    return rl


def test_match_ranks_relevant_first(tmp_path):
    """相关规律排最前，无关条目不因偶发 bigram 混入。"""
    rl = _load_rl()
    rl.record(str(tmp_path), "f-string 字面量大括号写成单层导致 KeyError", 2)
    rl.record(str(tmp_path), "gen_reference 派生区过期被门禁拦", 1)
    res = rl.match(str(tmp_path), "f-string 大括号 KeyError 测试失败")
    assert res and "f-string" in res[0]["sig"]
    assert all("gen_reference" not in r["sig"] for r in res)


def test_match_empty_ledger_and_no_overlap(tmp_path):
    """空账本/无共享：返回空列表不抛错（召回是增强不是依赖）。"""
    rl = _load_rl()
    assert rl.match(str(tmp_path / "never"), "任何查询") == []
    rl.record(str(tmp_path), "端口占用 18801", 1)
    assert rl.match(str(tmp_path), "zz qq xx") == []


def test_match_stopbigram_filters_boilerplate(tmp_path):
    """≥5 条共享样板词（定位/归因）→ 样板 bigram 停用；带区分词仍召回。"""
    rl = _load_rl()
    for i in range(5):
        rl.record(str(tmp_path), f"规律{i} 定位 xx{i} 归因 yy{i}", 1)
    assert rl.match(str(tmp_path), "定位 归因") == []
    assert any("规律2" in r["sig"] for r in rl.match(str(tmp_path), "规律2 xx2 yy2 失败"))


def test_match_superseded_not_recalled(tmp_path):
    """被取代的旧签名不进召回（过气经验不该再教人）。"""
    rl = _load_rl()
    rl.record(str(tmp_path), "旧方案安装脚本路径写死", 3)
    rl.record(str(tmp_path), "另一条无关规律词语", 1)
    rl.supersede(str(tmp_path), "旧方案安装脚本路径写死", "新方案安装自动探测")
    res = rl.match(str(tmp_path), "安装脚本路径写死失败")
    assert all("旧方案" not in r["sig"] for r in res)


def test_match_min_shared_threshold(tmp_path):
    """共享数低于噪声地板（3）不召回；min_shared 参数可调。"""
    rl = _load_rl()
    rl.record(str(tmp_path), "ab cd ef", 1)
    assert rl.match(str(tmp_path), "ab zz qq") == []          # 只共享 1 个 bigram
    assert rl.match(str(tmp_path), "ab cd zz", min_shared=2)  # 降到 2 则召回
    assert rl.match(str(tmp_path), "ab cd zz", min_shared=2) != []


def test_match_cli_json(tmp_path):
    """CLI 人读/机器读双通道：--json 可解析，无召回给明确文案。"""
    proj = _mk(tmp_path)
    _run(proj, "record", "--sig", "f-string 大括号错误", "--occurrences", "2")
    r = _run(proj, "match", "--query", "f-string 大括号报错", "--json")
    assert r.returncode == 0
    data = json.loads(r.stdout)
    assert isinstance(data, list) and data and "f-string" in data[0]["sig"]
    r2 = _run(proj, "match", "--query", "毫无关联的查询词语组")
    assert r2.returncode == 0 and "无相关规律" in r2.stdout


# ─── v1.61 结构化查询面（B6：召回从拦截至扩到开工前） ────────

_MF = """---
id: R9
status: planning
planned_changes:
- id: F1
  file: hooks/scripts/lib/rules_ledger.py
  type: internal
fragile_points:
- id: FP1
  kind: machine
  description: 派生查询稀释召回
  verify: pytest
  status: open
scan:
  card: 知识层
---\n
"""


def test_query_from_manifest_terms(tmp_path):
    """派生查询含 planned 文件名与脆弱点描述词。"""
    rl = _load_rl()
    mf = tmp_path / "m.md"
    mf.write_text(_MF, encoding="utf-8")
    q = rl.query_from_manifest(str(mf))
    assert "rules_ledger.py" in q and "派生查询稀释召回" in q and "知识层" in q


def test_match_from_manifest_cli(tmp_path):
    """CLI --from-manifest：先打印派生查询再召回按文件名种的规律。"""
    proj = _mk(tmp_path)
    _run(proj, "record", "--sig", "rules_ledger.py 账本膨胀双胞胎重复条目", "--occurrences", "2")
    mf = proj / "regress" / "manifests" / "R9.md"
    mf.parent.mkdir(parents=True, exist_ok=True)
    mf.write_text(_MF, encoding="utf-8")
    r = _run(proj, "match", "--from-manifest", str(mf))
    assert r.returncode == 0
    assert "派生查询" in r.stdout and "rules_ledger.py" in r.stdout
    assert "账本膨胀" in r.stdout


def test_query_from_manifest_bad_path(tmp_path):
    """坏路径/无 frontmatter：返空不炸。"""
    rl = _load_rl()
    assert rl.query_from_manifest(str(tmp_path / "nope.md")) == ""
    empty = tmp_path / "empty.md"
    empty.write_text("没有frontmatter", encoding="utf-8")
    assert isinstance(rl.query_from_manifest(str(empty)), str)
