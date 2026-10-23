"""journal（公理三：考古地层）的单元测试——lib 层 + 探测器接入。"""
import sys
import os
import json
import subprocess

LIB = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts")
LIB = os.path.abspath(LIB)
sys.path.insert(0, LIB)
sys.path.insert(0, os.path.join(LIB, "lib"))

from journal import journal_append, load_journal, journal_digest  # noqa: E402

FAIL_WATCH = os.path.join(LIB, "fail_watch.py")
RISK_WATCH = os.path.join(LIB, "risk_watch.py")
PROMPT_HOOK = os.path.join(LIB, "prompt_intercept.py")


def _feed(script, payload, project_dir, tmp_dir, extra_env=None):
    """喂 stdin 给 hook 脚本；项目指向 tmp project，/tmp 指向 tmp_dir。"""
    env = {**os.environ, "ZCODE_PROJECT_DIR": str(project_dir),
           "TMPDIR": str(tmp_dir), "REGRESS_JOURNAL": "on"}
    env.update(extra_env or {})
    return subprocess.run(
        ["python3", script], input=json.dumps(payload),
        capture_output=True, text=True, env=env, timeout=10,
    )


# ── lib 层 ───────────────────────────────────────────────
# 注意：conftest autouse 夹具默认 REGRESS_JOURNAL=off（保护其他测试），
# 进程内用例须显式覆写为 on，才能走到真实分支


def test_append_and_load(tmp_path, monkeypatch):
    monkeypatch.setenv("REGRESS_JOURNAL", "on")
    (tmp_path / ".regress").mkdir()
    assert journal_append("tool_fail", start_dir=str(tmp_path), tool="Bash", sig="npm test")
    events = load_journal(str(tmp_path))
    assert len(events) == 1
    assert events[0]["kind"] == "tool_fail"
    assert events[0]["sig"] == "npm test"
    assert "ts" in events[0] and "session" in events[0]


def test_no_regress_dir_skips(tmp_path, monkeypatch):
    monkeypatch.setenv("REGRESS_JOURNAL", "on")
    assert not journal_append("tool_fail", start_dir=str(tmp_path))
    assert load_journal(str(tmp_path)) == []


def test_kill_switch(tmp_path, monkeypatch):
    (tmp_path / ".regress").mkdir()
    monkeypatch.setenv("REGRESS_JOURNAL", "off")
    assert not journal_append("tool_fail", start_dir=str(tmp_path))


def test_field_cap(tmp_path, monkeypatch):
    monkeypatch.setenv("REGRESS_JOURNAL", "on")
    (tmp_path / ".regress").mkdir()
    journal_append("risk_action", start_dir=str(tmp_path), detail="x" * 5000)
    events = load_journal(str(tmp_path))
    assert len(events[0]["detail"]) == 400


def test_digest_cross_session_filter(tmp_path, monkeypatch):
    """单会话高频=噪声不进经验；跨会话 ≥2 次才是稳定经验。"""
    monkeypatch.setenv("REGRESS_JOURNAL", "on")
    (tmp_path / ".regress").mkdir()
    for sess in ("s1", "s1", "s1", "s2"):
        journal_append("tool_fail", start_dir=str(tmp_path), sig="npm install", session=sess)
    journal_append("tool_fail", start_dir=str(tmp_path), sig="unique-once", session="s9")
    digest = journal_digest(str(tmp_path))
    sigs = [d["sig"] for d in digest]
    assert "npm install" in sigs
    assert "unique-once" not in sigs
    entry = next(d for d in digest if d["sig"] == "npm install")
    assert entry["sessions"] == 2 and entry["total"] == 4


# ── 探测器接入（子进程端到端）────────────────────────────

def test_fail_watch_journals(tmp_path):
    proj, tmpdir = tmp_path / "proj", tmp_path / "tmp"
    (proj / ".regress").mkdir(parents=True)
    tmpdir.mkdir()
    _feed(FAIL_WATCH, {"tool_name": "Bash", "tool_input": {"command": "npm test --json"}},
          proj, tmpdir)
    events = load_journal(str(proj))
    assert any(e["kind"] == "tool_fail" and e["sig"] == "npm test" for e in events)


def test_risk_watch_journals_risk_not_usage(tmp_path):
    proj, tmpdir = tmp_path / "proj", tmp_path / "tmp"
    (proj / ".regress").mkdir(parents=True)
    tmpdir.mkdir()
    _feed(RISK_WATCH, {"tool_name": "Bash", "tool_input": {"command": "git reset --hard"}},
          proj, tmpdir)
    _feed(RISK_WATCH, {"tool_name": "Bash", "tool_input": {"command": "ls -la"}},
          proj, tmpdir)
    events = load_journal(str(proj))
    kinds = [e["kind"] for e in events]
    assert kinds.count("risk_action") == 1  # git reset --hard
    assert "usage" not in kinds  # 普查不入地层


def test_prompt_correction_journals(tmp_path):
    proj, tmpdir = tmp_path / "proj", tmp_path / "tmp"
    (proj / ".regress").mkdir(parents=True)
    tmpdir.mkdir()
    _feed(PROMPT_HOOK, {"prompt": "你这样理解不对，方向反了"}, proj, tmpdir)
    events = load_journal(str(proj))
    assert any(e["kind"] == "user_correction" for e in events)


def test_descriptive_error_not_journaled(tmp_path):
    """“报错了”是描述不是纠正——不得入地层。"""
    proj, tmpdir = tmp_path / "proj", tmp_path / "tmp"
    (proj / ".regress").mkdir(parents=True)
    tmpdir.mkdir()
    _feed(PROMPT_HOOK, {"prompt": "我这边终端报错了，你看看日志输出报错了什么"}, proj, tmpdir)
    events = load_journal(str(proj))
    assert not any(e["kind"] == "user_correction" for e in events)


# ── v1.14：CLI add——命令层埋化石的统一出口 ──

def test_cli_add_buries_assumption_fossil(tmp_path):
    proj = tmp_path / "proj"
    (proj / ".regress").mkdir(parents=True)
    r = subprocess.run(
        [sys.executable, os.path.join(LIB, "lib", "journal.py"),
         str(proj), "add", "assumption_broken",
         '{"manifest_id":"R1","vid":"V5","was":"按1601推测","reality":"Ack=1","evidence":"mock --self-test"}'],
        capture_output=True, text=True, timeout=10,
        env={**os.environ, "REGRESS_JOURNAL": "on"})
    assert r.returncode == 0, r.stderr
    assert '"ok": true' in r.stdout
    evts = [e for e in load_journal(str(proj)) if e.get("kind") == "assumption_broken"]
    assert len(evts) == 1
    assert evts[0]["vid"] == "V5" and evts[0]["reality"] == "Ack=1"


def test_cli_add_rejects_bad_json(tmp_path):
    proj = tmp_path / "proj"
    (proj / ".regress").mkdir(parents=True)
    r = subprocess.run(
        [sys.executable, os.path.join(LIB, "lib", "journal.py"),
         str(proj), "add", "assumption_broken", "not-json"],
        capture_output=True, text=True, timeout=10,
        env={**os.environ, "REGRESS_JOURNAL": "on"})
    assert r.returncode == 2
    assert "json" in r.stderr


# ─── v1.49 顾问采纳率（B4：给裁判装评分器） ────────────────

def _adoption_proj(tmp_path, events):
    import json as _json
    proj = tmp_path / "proj"
    (proj / ".regress" / "journal").mkdir(parents=True, exist_ok=True)
    with open(proj / ".regress" / "journal" / "events.jsonl", "w",
              encoding="utf-8") as f:
        for ev in events:
            f.write(_json.dumps(ev, ensure_ascii=False) + "\n")
    return str(proj)


def test_advisor_adoption_rate(tmp_path):
    import sys as _sys
    _sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..",
                                     "hooks", "scripts", "lib"))
    from journal import advisor_adoption
    proj = _adoption_proj(tmp_path, [
        {"kind": "advisor_adoption", "adoption": "adopted"},
        {"kind": "advisor_adoption", "adoption": "adopted"},
        {"kind": "advisor_adoption", "adoption": "rejected"},
        {"kind": "task_done"},  # 无关事件不入分母
    ])
    r = advisor_adoption(proj)
    assert r["total"] == 3 and r["adopted"] == 2 and abs(r["rate"] - 0.67) < 0.01


def test_advisor_adoption_empty(tmp_path):
    import sys as _sys
    _sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..",
                                     "hooks", "scripts", "lib"))
    from journal import advisor_adoption
    proj = _adoption_proj(tmp_path, [])
    r = advisor_adoption(proj)
    assert r["total"] == 0 and r["rate"] is None


def test_journal_stats_fields(tmp_path):
    """B6 测量仪器：字段齐全，空账本不炸。"""
    import sys as _sys
    _sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..",
                                     "hooks", "scripts", "lib"))
    from journal import journal_stats
    proj = _adoption_proj(tmp_path, [{"kind": "tool_fail", "sig": "x"}])
    r = journal_stats(proj)
    assert r["events"] == 1 and r["by_kind"].get("tool_fail") == 1
    assert "digest_ms" in r and "file_bytes" in r
    empty = _adoption_proj(tmp_path / "e2", [])
    r2 = journal_stats(empty)
    assert r2["events"] == 0 and r2["file_bytes"] == 0


# ─── v1.94.0（122）：pending 高水位 + ack CLI + digest 纠正聚类 ───

def _corr_proj(tmp_path, events):
    proj = tmp_path / "corr"
    (proj / ".regress" / "journal").mkdir(parents=True)
    with open(proj / ".regress" / "journal" / "events.jsonl", "w",
              encoding="utf-8") as f:
        for ev in events:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    return str(proj)


def test_pending_no_disposition_all_pending(tmp_path):
    from journal import pending_corrections
    proj = _corr_proj(tmp_path, [
        {"ts": "2026-09-24T10:00:00", "kind": "user_correction",
         "excerpt": "每一个文档你都单独审查，不对经", "session": "s1"},
        {"ts": "2026-09-24T15:04:00", "kind": "tool_fail", "sig": "x"},
    ])
    assert len(pending_corrections(proj)) == 1  # 无 ack → 全部 pending


def test_pending_high_water_clears(tmp_path):
    from journal import pending_corrections
    proj = _corr_proj(tmp_path, [
        {"ts": "2026-09-24T10:00:00", "kind": "user_correction", "excerpt": "a"},
        {"ts": "2026-09-24T11:00:00", "kind": "correction_disposition",
         "how": "advisor", "upto": "2026-09-24T11:00:00"},
    ])
    assert pending_corrections(proj) == []


def test_pending_cursor_safety(tmp_path):
    """游标安全（顾问安全变体）：ack 只清 upto 之前已展示的，之后新到的仍 pending。"""
    from journal import pending_corrections
    proj = _corr_proj(tmp_path, [
        {"ts": "2026-09-24T10:00:00", "kind": "user_correction", "excerpt": "a"},
        {"ts": "2026-09-24T10:30:00", "kind": "correction_disposition",
         "how": "advisor", "upto": "2026-09-24T10:05:00"},  # 游标只盖到 10:05
        {"ts": "2026-09-24T10:20:00", "kind": "user_correction", "excerpt": "b"},
    ])
    pend = pending_corrections(proj)
    assert len(pend) == 1 and pend[0]["excerpt"] == "b"


def test_ack_corrections_cli(tmp_path):
    proj = tmp_path / "ack"
    (proj / ".regress").mkdir(parents=True)
    r = subprocess.run(
        [sys.executable, os.path.join(LIB, "lib", "journal.py"),
         str(proj), "ack-corrections",
         '{"how":"advisor","upto":"2026-09-24T12:00:00","note":"已对质"}'],
        capture_output=True, text=True, timeout=10,
        env={**os.environ, "REGRESS_JOURNAL": "on"})
    assert r.returncode == 0, r.stderr
    assert '"ok": true' in r.stdout and '"cleared_after"' in r.stdout
    evts = [e for e in load_journal(str(proj))
            if e.get("kind") == "correction_disposition"]
    assert len(evts) == 1 and evts[0]["upto"] == "2026-09-24T12:00:00"


def test_ack_corrections_rejects_bad_json(tmp_path):
    proj = tmp_path / "ack2"
    (proj / ".regress").mkdir(parents=True)
    r = subprocess.run(
        [sys.executable, os.path.join(LIB, "lib", "journal.py"),
         str(proj), "ack-corrections", "not-json"],
        capture_output=True, text=True, timeout=10,
        env={**os.environ, "REGRESS_JOURNAL": "on"})
    assert r.returncode == 2


def test_digest_clusters_corrections_cross_session(tmp_path):
    """纠正聚类：同主题纠正跨会话 ≥2 次 = 规律候选（与 tool_fail 同场，kind 区分）。"""
    proj = _corr_proj(tmp_path, [
        {"ts": "2026-09-24T10:00:00", "kind": "user_correction",
         "excerpt": "方案方向错了，重新设计接口部分再来", "session": "s1"},
        {"ts": "2026-09-25T10:00:00", "kind": "user_correction",
         "excerpt": "方案方向错了，重新设计接口部分再来一遍", "session": "s2"},
        {"ts": "2026-09-26T10:00:00", "kind": "tool_fail", "sig": "npm test",
         "session": "s1"},
        {"ts": "2026-09-27T10:00:00", "kind": "tool_fail", "sig": "npm test",
         "session": "s3"},
    ])
    rows = journal_digest(proj)
    by_sig = {r["sig"]: r for r in rows}
    corr_sig = "correction:方案方向错了，重新设计接口部分再"
    assert corr_sig in by_sig
    assert by_sig[corr_sig]["kind"] == "user_correction"
    assert by_sig[corr_sig]["sessions"] == 2
    assert by_sig["npm test"]["kind"] == "tool_fail"


def test_prompt_constraint_journals(tmp_path):
    """硬约束埋点（122）：约束语式+方向词 → user_constraint 化石。"""
    proj, tmpdir = tmp_path / "proj", tmp_path / "tmp"
    (proj / ".regress").mkdir(parents=True)
    tmpdir.mkdir()
    _feed(PROMPT_HOOK, {"prompt": "发布到公网之前 一定要人类审查，作者是yelisheng"},
          proj, tmpdir)
    events = load_journal(str(proj))
    assert any(e["kind"] == "user_constraint" for e in events)


def test_prompt_constraint_no_direction_not_journaled(tmp_path):
    """无方向词的自述（"必须努力"）不埋——泛化防线。"""
    proj, tmpdir = tmp_path / "proj", tmp_path / "tmp"
    (proj / ".regress").mkdir(parents=True)
    tmpdir.mkdir()
    _feed(PROMPT_HOOK, {"prompt": "必须努力工作才能成功"}, proj, tmpdir)
    events = load_journal(str(proj))
    assert not any(e["kind"] == "user_constraint" for e in events)
