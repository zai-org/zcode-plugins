"""critic_pass（127：A 批评臂）测试——管道与解析，批评质量归试点双指标。"""
import importlib.util as ilu
import json
import os
import sys

import pytest

SCRIPT = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "scripts", "critic_pass.py"))


def _load():
    spec = ilu.spec_from_file_location("cp", SCRIPT)
    m = ilu.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def _mk_repo(tmp_path):
    import subprocess as sp
    repo = tmp_path / "proj"
    repo.mkdir()
    sp.run(["git", "init", "-q"], cwd=str(repo), check=True)
    sp.run(["git", "config", "user.email", "t@t.com"], cwd=str(repo), check=True)
    sp.run(["git", "config", "user.name", "t"], cwd=str(repo), check=True)
    (repo / "a.txt").write_text("1\n", encoding="utf-8")
    sp.run(["git", "add", "-A"], cwd=str(repo), check=True)
    sp.run(["git", "commit", "-qm", "init"], cwd=str(repo), check=True)
    return repo


def test_assemble_carries_artifacts(tmp_path, monkeypatch):
    """摆渡包含清单全文+diff+提交主题——工件齐，未引作者润色叙事。"""
    cp = _load()
    repo = _mk_repo(tmp_path)
    mf = tmp_path / "R1.md"
    mf.write_text("---\nid: REGRESS-2026-127\nstatus: done\n---\n正文判据",
                  encoding="utf-8")
    monkeypatch.setenv("REGRESS_JOURNAL", "off")
    monkeypatch.chdir(repo)  # 仓定位走 cwd 顶层（127：清单路径反推不可靠）
    path = cp.assemble(str(mf), out_dir=str(tmp_path / "c"))
    body = open(path, encoding="utf-8").read()
    assert "REGRESS-2026-127" in body and "最近提交 diff" in body
    assert "近三条提交" in body and "init" in body


def test_parse_findings_lenient():
    cp = _load()
    good = ('前置噪音 {"p1": [{"claim": "越界", "evidence": "L4", '
            '"confidence": "high"}], "p2": [], "p3": []} 后置噪音')
    r = cp.parse_findings(good)
    assert r and r["p1"][0]["claim"] == "越界"
    assert cp.parse_findings("完全不是 JSON") is None
    assert cp.parse_findings('{"别的": 1}') is None


def test_run_normal_mode(monkeypatch, tmp_path):
    """顾问可达且格式合规：findings 落盘+journal critic_findings(mode=normal)。"""
    cp = _load()
    ferry = tmp_path / "ferry-X.md"
    ferry.write_text("# 摆渡包内容", encoding="utf-8")
    monkeypatch.setenv("ADVISOR_DSH_TOKEN", "stub")
    monkeypatch.setattr(cp, "_post_critic",
                        lambda url, tok, text: cp.CRITIC_PROMPT_TMPL.format(  # noqa: E731
                            ferry="")[:0] or '{"p1":[{"claim":"c","evidence":"e","confidence":"mid"}],"p2":[],"p3":[]}')
    events = []
    monkeypatch.setattr(cp, "journal_append",
                        lambda kind, **f: events.append((kind, f)) or True)
    r = cp.run_critic(str(ferry))
    assert r["mode"] == "normal" and r["findings"]["p1"][0]["claim"] == "c"
    assert any(k == "critic_findings" and f.get("mode") == "normal"
               for k, f in events)
    assert os.path.exists(r["path"])


def test_run_degrades_when_unreachable(monkeypatch, tmp_path):
    """顾问不可达：降级打标 degraded+prompt 落盘手动派发，退出不炸（臂不死）。"""
    cp = _load()
    ferry = tmp_path / "ferry-Y.md"
    ferry.write_text("# 摆渡包", encoding="utf-8")
    monkeypatch.setenv("ADVISOR_DSH_TOKEN", "stub")
    monkeypatch.setattr(cp, "_post_critic",
                        lambda *a: (_ for _ in ()).throw(OSError("down")))
    events = []
    monkeypatch.setattr(cp, "journal_append",
                        lambda kind, **f: events.append((kind, f)) or True)
    r = cp.run_critic(str(ferry))
    assert r["mode"] == "degraded" and r["findings"] is None
    assert os.path.exists(r["manual_dispatch"])
    assert any(k == "critic_findings" and f.get("mode") == "degraded"
               for k, f in events)  # 分段统计：降级不得与正常混同


def test_canary_defect_embedded(monkeypatch, tmp_path):
    """canary 种子进摆渡包：发现率测试有真 oracle。"""
    cp = _load()
    ferry = tmp_path / "ferry-Z.md"
    ferry.write_text("# 摆渡包", encoding="utf-8")
    seen = {}
    def fake_post(url, tok, text):
        seen["canary_in_ferry"] = "process(items)" in text  # 种子本体在场（128 去标签）
        return '{"p1":[],"p2":[],"p3":[]}'
    monkeypatch.setenv("ADVISOR_DSH_TOKEN", "stub")
    monkeypatch.setattr(cp, "_post_critic", fake_post)
    r = cp.run_critic(str(ferry), canary=True)
    assert r["mode"] == "normal" and seen["canary_in_ferry"]


def test_rebuttal_cli(monkeypatch):
    cp = _load()
    got = {}
    monkeypatch.setattr(cp, "journal_append",
                        lambda kind, **f: got.update(f) or True)
    r = cp.rebuttal('{"p1_0": "已修：边界补丁", "verdict": "confirmed"}')
    assert r["ok"] and got["p1_0"] == "已修：边界补丁"


# ─── v1.97.1（128）：首射发现全回收的回归锚 ───

def test_truncation_marked():
    """① 截断即标记：批评家必须知道段不完整（首射 P1-1）。"""
    cp = _load()
    t = cp._clip("x" * 100, 10)
    assert "截断：原 100 字符取前 10" in t
    assert cp._clip("short", 100) == "short"  # 不截断无标记


def test_canary_clean_ferry_and_hash_event(monkeypatch, tmp_path):
    """② 种子去标签：摆渡包零提示；哈希进事件（机器侧可追溯）。"""
    cp = _load()
    ferry = tmp_path / "ferry-C.md"
    ferry.write_text("# 摆渡包", encoding="utf-8")
    seen = {}
    def fake_post(url, tok, text):
        seen["ferry_text"] = text
        return '{"p1":[],"p2":[],"p3":[]}'
    monkeypatch.setenv("ADVISOR_DSH_TOKEN", "stub")
    monkeypatch.setattr(cp, "_post_critic", fake_post)
    events = []
    monkeypatch.setattr(cp, "journal_append",
                        lambda kind, **f: events.append(f) or True)
    r = cp.run_critic(str(ferry), canary=True)
    assert r["mode"] == "normal"
    assert "已知缺陷种子" not in seen["ferry_text"]  # 自标已除（首射 P1-2）
    assert "process(items)" in seen["ferry_text"]     # 种子本体仍在
    assert any(e.get("canary_sha") for e in events)


def test_diff_edges_first_commit_and_staged(monkeypatch, tmp_path):
    """③ 首提交仓（无 HEAD~1）不炸且带空段标记；staged 非空单独成段。"""
    import subprocess as sp
    cp = _load()
    repo = tmp_path / "fresh"
    repo.mkdir()
    sp.run(["git", "init", "-q"], cwd=str(repo), check=True)
    sp.run(["git", "config", "user.email", "t@t"], cwd=str(repo), check=True)
    sp.run(["git", "config", "user.name", "t"], cwd=str(repo), check=True)
    (repo / "b.txt").write_text("2\n", encoding="utf-8")
    sp.run(["git", "add", "-A"], cwd=str(repo), check=True)  # staged 未提交
    mf = tmp_path / "R2.md"
    mf.write_text("---\nid: R2\n---\nbody", encoding="utf-8")
    monkeypatch.setenv("REGRESS_JOURNAL", "off")
    monkeypatch.chdir(repo)
    path = cp.assemble(str(mf), out_dir=str(tmp_path / "c2"))
    body = open(path, encoding="utf-8").read()
    assert "取不到——单历史仓" in body      # 首提交兜底标记
    assert "未提交改动 diff（staged）" in body  # staged 段在场


def test_audit_location_asserted(tmp_path, monkeypatch):
    """顾问增补：审计档位置=工作区 .regress/critic/ 成断言（防漂移复发）。"""
    cp = _load()
    repo = _mk_repo(tmp_path)
    mf = tmp_path / "R3.md"
    mf.write_text("---\nid: R3\n---\nx", encoding="utf-8")
    monkeypatch.setenv("REGRESS_JOURNAL", "off")
    monkeypatch.chdir(repo)
    out_default = cp.assemble(str(mf))  # 不传 out_dir → 默认仓外 .regress/critic
    assert os.path.basename(os.path.dirname(out_default)) == "critic"
    assert out_default.endswith(os.path.join(".regress", "critic",
                                              "ferry-R3.md"))


# ─── v1.97.2（129）：run2 回收+历史批审计 ───

def test_staged_empty_has_presence_line(monkeypatch, tmp_path):
    """staged 为空也要有存在性行（run2 验收缺口：if staged: 才 append）。"""
    cp = _load()
    repo = _mk_repo(tmp_path)
    mf = tmp_path / "R4.md"
    mf.write_text("---\nid: R4\n---\nx", encoding="utf-8")
    monkeypatch.setenv("REGRESS_JOURNAL", "off")
    monkeypatch.chdir(repo)
    body = open(cp.assemble(str(mf), out_dir=str(tmp_path / "c4")),
                encoding="utf-8").read()
    assert "未提交改动 diff（staged）" in body
    assert "（无未提交改动）" in body  # 空也留行


def test_rev_range_diff(monkeypatch, tmp_path):
    """历史批审计：--rev-range 取指定区间 diff（真 canary 测量的钥匙）。"""
    import subprocess as sp
    cp = _load()
    repo = _mk_repo(tmp_path)
    (repo / "c.txt").write_text("3\n", encoding="utf-8")
    sp.run(["git", "add", "-A"], cwd=str(repo), check=True)
    sp.run(["git", "commit", "-qm", "second"], cwd=str(repo), check=True)
    two = sp.run(["git", "rev-parse", "HEAD~1", "HEAD"], cwd=str(repo),
                 capture_output=True, text=True).stdout.split()
    rng = f"{two[0]}..{two[1]}"  # A..B 形态（rev-parse 区间形态是两行 sha）
    mf = tmp_path / "R5.md"
    mf.write_text("---\nid: R5\n---\nx", encoding="utf-8")
    monkeypatch.setenv("REGRESS_JOURNAL", "off")
    monkeypatch.chdir(repo)
    path = cp.assemble(str(mf), out_dir=str(tmp_path / "c5"), rev_range=rng)
    body = open(path, encoding="utf-8").read()
    assert "+3" in body  # 区间 diff 在场（c.txt 新增行）


def test_empty_head_diff_diagnosis_in_ferry(monkeypatch, tmp_path):
    """诊断标记进 ferry 正文（run2 受众错位：stderr 批评家看不见）。"""
    import subprocess as sp
    cp = _load()
    repo = tmp_path / "solo"
    repo.mkdir()
    sp.run(["git", "init", "-q"], cwd=str(repo), check=True)
    sp.run(["git", "config", "user.email", "t@t"], cwd=str(repo), check=True)
    sp.run(["git", "config", "user.name", "t"], cwd=str(repo), check=True)
    (repo / "d.txt").write_text("1\n", encoding="utf-8")
    sp.run(["git", "add", "-A"], cwd=str(repo), check=True)
    mf = tmp_path / "R6.md"
    mf.write_text("---\nid: R6\n---\nx", encoding="utf-8")
    monkeypatch.setenv("REGRESS_JOURNAL", "off")
    monkeypatch.chdir(repo)
    body = open(cp.assemble(str(mf), out_dir=str(tmp_path / "c6")),
                encoding="utf-8").read()
    assert "取不到" in body  # 诊断在 ferry 里（不是只有 stderr）


def test_report_segment_not_clipped(monkeypatch, tmp_path):
    """报告段不截（run2：被告知未到可审——关键证据整段进）。"""
    cp = _load()
    repo = _mk_repo(tmp_path)
    rep = tmp_path / "report.md"
    rep.write_text("关键证据行\n" * 5000, encoding="utf-8")
    mf = tmp_path / "R7.md"
    mf.write_text("---\nid: R7\n---\nx", encoding="utf-8")
    monkeypatch.setenv("REGRESS_JOURNAL", "off")
    monkeypatch.chdir(repo)
    path = cp.assemble(str(mf), report_path=str(rep), out_dir=str(tmp_path / "c7"))
    body = open(path, encoding="utf-8").read()
    assert "截断：原" not in body.split("批报告原文")[1]  # 报告段无截断标记
