"""history.py 的单元测试（含 Ch9 遗忘、Ch24 指标、Ch21 reason 分布）。"""
import sys
import os
import json
import tempfile
import pytest

LIB = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib")
sys.path.insert(0, LIB)

from history import record, load_history, summarize, _maybe_archive, build_trace, telemetry, block_heatmap, feature_fire_health


@pytest.fixture
def regress_dir(tmp_path):
    rdir = tmp_path / ".regress"
    rdir.mkdir()
    return str(rdir)


def test_record_and_load(regress_dir):
    record(regress_dir, "commit_passed", "R1", runner="jest", passed=3, total=3)
    record(regress_dir, "commit_blocked", "R1", reason="test_failed")
    events = load_history(regress_dir)
    assert len(events) == 2
    assert events[0]["event"] == "commit_passed"
    assert events[1]["event"] == "commit_blocked"


def test_tech_debt(regress_dir):
    record(regress_dir, "bypass_used", "R1")
    record(regress_dir, "bypass_used", "R1")
    record(regress_dir, "commit_passed", "R1", runner="jest", passed=1, total=1)
    s = summarize(regress_dir)
    assert s["tech_debt"] == 1  # 2 bypass - 1 还债


def test_quality_score(regress_dir):
    record(regress_dir, "commit_passed", "R1", runner="jest")
    record(regress_dir, "commit_passed", "R1", runner="jest")
    record(regress_dir, "commit_blocked", "R1", reason="test_failed")
    s = summarize(regress_dir)
    assert s["quality_score"] == round(2/3, 2)  # 2/3 通过


def test_block_reasons(regress_dir):
    record(regress_dir, "commit_blocked", "R1", reason="test_failed")
    record(regress_dir, "commit_blocked", "R1", reason="test_failed")
    record(regress_dir, "commit_blocked", "R1", reason="untracked_files")
    s = summarize(regress_dir)
    assert s["block_reasons"]["test_failed"] == 2
    assert s["block_reasons"]["untracked_files"] == 1


def test_f3_rate(regress_dir):
    record(regress_dir, "commit_blocked", "R1", reason="untracked_files",
           untracked_files=["src/a.js"])
    record(regress_dir, "commit_passed", "R1", runner="jest")
    s = summarize(regress_dir)
    assert s["f3_rate"] == 0.5  # 1 次 F3 / 2 次总 commit


def test_archive(regress_dir):
    """Ch9 遗忘：超过阈值时归档旧事件。"""
    for i in range(10):
        record(regress_dir, "commit_passed", f"R{i}")
    history_path = os.path.join(regress_dir, "history.jsonl")
    # 手动触发归档（阈值设 5）
    _maybe_archive(regress_dir, history_path, max_events=5)
    # 主文件应只剩 5 条
    events = load_history(regress_dir)
    assert len(events) == 5
    # 归档文件应有 5 条
    archive_path = os.path.join(regress_dir, "history-archive.jsonl")
    assert os.path.exists(archive_path)
    with open(archive_path) as f:
        archive_lines = f.readlines()
    assert len(archive_lines) == 5


def test_empty_summary(regress_dir):
    """无数据时 summary 不崩溃。"""
    s = summarize(regress_dir)
    assert s["total_commits"] == 0
    assert s["quality_score"] == 0
    assert s["tech_debt"] == 0


def test_session_id_recorded(regress_dir):
    """证据链：session_id 自动记录。"""
    os.environ["CLAUDE_SESSION_ID"] = "sess-test-abc"
    try:
        record(regress_dir, "commit_passed", "R1", runner="jest")
        events = load_history(regress_dir)
        assert events[0]["session_id"] == "sess-test-abc"
    finally:
        os.environ.pop("CLAUDE_SESSION_ID", None)


def test_noise_filter(regress_dir):
    """噪声过滤：单 session 重复是噪声，跨 session 重复是经验。"""
    for sid in ["sess-A"]:
        os.environ["CLAUDE_SESSION_ID"] = sid
        for _ in range(5):
            record(regress_dir, "commit_blocked", "R1",
                   reason="untracked_files", untracked_files=["noise.js"])
    for sid in ["sess-B", "sess-C"]:
        os.environ["CLAUDE_SESSION_ID"] = sid
        record(regress_dir, "commit_blocked", "R1",
               reason="untracked_files", untracked_files=["real.js"])
    os.environ.pop("CLAUDE_SESSION_ID", None)

    s = summarize(regress_dir)
    # real.js 跨 2 session → 是经验
    assert any(f == "real.js" for f, _ in s["top_f3_files"]), "real.js 应在经验中"
    # noise.js 单 session → 是噪声
    assert any(f == "noise.js" for f, _ in s["top_f3_noise"]), "noise.js 应在噪声中"


def test_build_trace(regress_dir):
    """交付链：按 manifest→session 组织。"""
    os.environ["CLAUDE_SESSION_ID"] = "sess-trace-1"
    record(regress_dir, "commit_blocked", "R1", reason="untracked_files",
           untracked_files=["src/x.js"])
    record(regress_dir, "commit_passed", "R1", runner="jest", base_head="abc123def")
    os.environ.pop("CLAUDE_SESSION_ID", None)

    trace = build_trace(regress_dir)
    assert "R1" in trace
    assert "sess-trace-1"[:12] in trace or "sess-trace-1" in trace
    assert "commit_blocked" in trace
    assert "abc123def" in trace


def test_avg_coverage(regress_dir):
    """平均覆盖率：有数据时输出均值，无数据时 None。"""
    record(regress_dir, "commit_passed", "R1", runner="jest", coverage_pct=80)
    record(regress_dir, "commit_passed", "R1", runner="jest", coverage_pct=100)
    record(regress_dir, "commit_passed", "R2", runner="none")  # 无覆盖率
    s = summarize(regress_dir)
    assert s["avg_coverage_pct"] == 90




def _block(regress_dir, mid, reason, session, ts):
    """直写事件（record 的 timestamp/session 由 env 推断，测试要显式控制）。"""
    with open(os.path.join(regress_dir, "history.jsonl"), "a",
              encoding="utf-8") as f:
        f.write(json.dumps({"timestamp": ts, "event": "commit_blocked",
                            "manifest_id": mid, "session_id": session,
                            "reason": reason}, ensure_ascii=False) + "\n")


def test_nudge_single_block_unflagged(regress_dir):
    """单次拦截无标——影子模式不制造噪音。"""
    from history import nudge_effectiveness
    _block(regress_dir, "R1", "scan_missing", "s1", "2026-09-16T10:00:00")
    rows = nudge_effectiveness(regress_dir)
    assert len(rows) == 1 and rows[0]["flag"] == "" and rows[0]["blocks"] == 1


def test_nudge_repeat_same_session(regress_dir):
    """同会话 ×2 = repeat（告警级，未到无效候选）。"""
    from history import nudge_effectiveness
    for i in range(2):
        _block(regress_dir, "R1", "card_stale", "s1",
               f"2026-09-16T1{i}:00:00")
    rows = nudge_effectiveness(regress_dir)
    assert rows[0]["flag"] == "repeat" and rows[0]["blocks"] == 2


def test_nudge_ineffective_cross_session(regress_dir):
    """≥3 且跨 ≥2 会话 = ineffective_candidate，分母恒带（顾问判据）。"""
    from history import nudge_effectiveness
    _block(regress_dir, "R1", "rollback_missing", "s1", "2026-09-16T10:00:00")
    _block(regress_dir, "R1", "rollback_missing", "s2", "2026-09-16T11:00:00")
    _block(regress_dir, "R1", "rollback_missing", "s3", "2026-09-16T12:00:00")
    rows = nudge_effectiveness(regress_dir)
    r = rows[0]
    assert r["flag"] == "ineffective_candidate"
    assert r["blocks"] == 3 and r["sessions"] == 3  # 分母+会话数都在


# ─── v1.58 召回有效性代理（B3：弱证据三态，干净才计） ────────

def _ev(regress_dir, event, mid, ts, reason=""):
    with open(os.path.join(regress_dir, "history.jsonl"), "a",
              encoding="utf-8") as f:
        f.write(json.dumps({"timestamp": ts, "event": event,
                            "manifest_id": mid, "reason": reason},
                           ensure_ascii=False) + "\n")


def test_recall_clean_shadow_pending(regress_dir):
    """三态：直接放行=clean；间有拦截=shadow；无放行=pending。"""
    from history import recall_effectiveness
    _ev(regress_dir, "rule_recall", "M1", "2026-09-17T10:00:00", "test_failed")
    _ev(regress_dir, "commit_passed", "M1", "2026-09-17T10:05:00")
    _ev(regress_dir, "rule_recall", "M2", "2026-09-17T11:00:00", "scan_missing")
    _ev(regress_dir, "commit_blocked", "M2", "2026-09-17T11:02:00", "untracked_files")
    _ev(regress_dir, "commit_passed", "M2", "2026-09-17T11:09:00")
    _ev(regress_dir, "rule_recall", "M3", "2026-09-17T12:00:00", "test_failed")
    rows = recall_effectiveness(regress_dir)
    by_mid = {r["manifest_id"]: r["outcome"] for r in rows}
    assert by_mid == {"M1": "resolved_clean", "M2": "resolved_shadow", "M3": "pending"}


def test_recall_cross_manifest_events_ignored(regress_dir):
    """跨清单事件不干扰：M4 的拦截不把 M5 的召回判成 shadow。"""
    from history import recall_effectiveness
    _ev(regress_dir, "rule_recall", "M5", "2026-09-17T10:00:00", "test_failed")
    _ev(regress_dir, "commit_blocked", "M4", "2026-09-17T10:01:00", "x")
    _ev(regress_dir, "commit_passed", "M4", "2026-09-17T10:02:00")
    _ev(regress_dir, "commit_passed", "M5", "2026-09-17T10:03:00")
    rows = recall_effectiveness(regress_dir)
    assert rows[0]["manifest_id"] == "M5" and rows[0]["outcome"] == "resolved_clean"


def test_nudge_keys_isolated(regress_dir):
    """不同 reason 不互相污染分母——键=(manifest_id, reason)。"""
    from history import nudge_effectiveness
    _block(regress_dir, "R1", "a", "s1", "2026-09-16T10:00:00")
    _block(regress_dir, "R1", "b", "s1", "2026-09-16T10:30:00")
    rows = nudge_effectiveness(regress_dir)
    assert all(r["blocks"] == 1 for r in rows) and len(rows) == 2


# ─── v1.62 拦截热力图（B7：召回扩点的数据接口） ────────

def test_block_heatmap_ranking(regress_dir):
    """按频次降序，含清单数与最近时间；reason 缺失归 unknown。"""
    from history import block_heatmap
    _block(regress_dir, "R1", "test_failed", "s1", "2026-09-17T10:00:00")
    _block(regress_dir, "R2", "test_failed", "s1", "2026-09-17T11:00:00")
    _block(regress_dir, "R1", "untracked_files", "s1", "2026-09-17T12:00:00")
    rows = block_heatmap(regress_dir)
    assert rows[0]["reason"] == "test_failed" and rows[0]["blocks"] == 2
    assert rows[0]["manifests"] == 2 and rows[0]["last"].startswith("2026-09-17T11")
    assert rows[1]["reason"] == "untracked_files" and rows[1]["blocks"] == 1


def test_block_heatmap_empty(regress_dir):
    """无拦截：空表不炸。"""
    from history import block_heatmap
    assert block_heatmap(regress_dir) == []


# ─── v1.74 遥测双文件统一视图（063） ────────────────

def test_telemetry_both_files(tmp_path):
    rd = tmp_path / ".regress"
    (rd / "journal").mkdir(parents=True)
    (rd / "history.jsonl").write_text(
        '{"timestamp": "2026-09-20T10:00:00", "event": "commit_passed"}\n',
        encoding="utf-8")
    (rd / "journal" / "events.jsonl").write_text(
        '{"ts": "2026-09-20T10:01:00", "kind": "task_done"}\n', encoding="utf-8")
    t = telemetry(str(rd))
    assert t["history"]["events"] == 1 and t["history"]["last"] == "commit_passed"
    assert t["history"]["fields"] == "event/timestamp"
    assert t["journal"]["events"] == 1 and t["journal"]["last"] == "task_done"
    assert t["journal"]["fields"] == "kind/ts"


def test_telemetry_missing_journal(tmp_path):
    rd = tmp_path / ".regress"
    rd.mkdir()
    t = telemetry(str(rd))
    assert t["history"]["missing"] is True and t["journal"]["missing"] is True


# ─── v1.83（072）：热图新键标注 ────────────────

def test_heatmap_newkey_mark(tmp_path):
    """14 天内首现 reason 标 new；>14 天老键不标。"""
    import datetime as dt
    rd = str(tmp_path)
    now = dt.datetime.now()
    fresh = (now - dt.timedelta(days=2)).isoformat()
    old = (now - dt.timedelta(days=40)).isoformat()
    record(rd, "commit_blocked", "R1", reason="new_reason", timestamp=fresh)
    record(rd, "commit_blocked", "R2", reason="old_reason", timestamp=old)
    rows = {r["reason"]: r for r in block_heatmap(rd)}
    assert rows["new_reason"]["new"] is True
    assert rows["new_reason"]["first"].startswith(fresh[:10])
    assert rows["old_reason"]["new"] is False


# ─── v1.85.3（077）：缓存命中遥测 ────────────────

def test_cache_stats_empty(regress_dir):
    """空历史：零除安全，rate=0.0，零节省。"""
    from history import cache_stats
    s = cache_stats(regress_dir)
    assert s == {"total": 0, "hits": 0, "misses": 0,
                 "rate": 0.0, "est_saved_seconds": 0}


def test_cache_stats_all_miss(regress_dir):
    """纯 miss：cached=false + 旧事件无 cached 字段都计 miss；blocked 不进分母。"""
    from history import cache_stats
    record(regress_dir, "commit_passed", "R1", runner="pytest", cached=False)
    record(regress_dir, "commit_blocked", "R1", reason="test_failed")  # 非过门禁，不计
    record(regress_dir, "commit_passed", "R2", runner="pytest")  # 旧事件无 cached 字段
    s = cache_stats(regress_dir)
    assert s["total"] == 2 and s["hits"] == 0 and s["misses"] == 2
    assert s["rate"] == 0.0 and s["est_saved_seconds"] == 0


def test_cache_stats_mixed(regress_dir):
    """1 命中 2 未命中：hits=1 misses=2 rate≈0.333 est≥118（=1×118）。"""
    from history import cache_stats
    record(regress_dir, "commit_passed", "R1", runner="pytest", cached=True)
    record(regress_dir, "commit_passed", "R2", runner="pytest", cached=False)
    record(regress_dir, "commit_passed", "R3", runner="pytest", cached=False)
    s = cache_stats(regress_dir)
    assert s["total"] == 3 and s["hits"] == 1 and s["misses"] == 2
    assert abs(s["rate"] - 1 / 3) < 0.001
    assert s["est_saved_seconds"] >= 118


def test_cache_stats_measured_with_provenance(regress_dir):
    """v1.91.0（108）：实验档在场——报 saved_seconds_measured 带溯源
    （日期/N/中位差），est 保留连续性。"""
    import os as _os
    from history import cache_stats
    record(regress_dir, "commit_passed", "R1", runner="pytest", cached=True)
    record(regress_dir, "commit_passed", "R2", runner="pytest", cached=True)
    ed = _os.path.join(str(regress_dir), "experiments")
    _os.makedirs(ed, exist_ok=True)
    with open(_os.path.join(ed, "cache-paired.json"), "w",
              encoding="utf-8") as f:
        f.write(_json.dumps({"median_delta_s": 160.2, "date": "2026-09-21",
                             "trials": 3, "range_s": [155.0, 168.0]}))
    s = cache_stats(regress_dir)
    assert s["saved_seconds_measured"] == 320.4  # 2 命中 × 实测中位
    mf = s["measured_from"]
    assert mf["date"] == "2026-09-21" and mf["trials"] == 3
    assert mf["median_delta_s"] == 160.2
    assert mf["source"] == "project"  # v1.92.4：第一路径命中标 project
    assert mf["path"].endswith("cache-paired.json")
    assert "est_saved_seconds" in s  # 连续性字段仍在


def test_cache_stats_measured_from_nested_repo(regress_dir, tmp_path):
    """v1.92.4（115）：本位无档而嵌套仓有——回退命中报实测，source/path
    标注实际来源（写入位与消费位错位的修复：门禁遥测在外层 .regress，
    实验档在嵌套仓）。"""
    import os as _os
    from history import cache_stats
    record(regress_dir, "commit_passed", "R1", runner="pytest", cached=True)
    record(regress_dir, "commit_passed", "R2", runner="pytest", cached=True)
    # 本位（tmp_path/.regress/experiments）刻意不建；嵌套仓位建档
    ed = tmp_path / "regress-guard" / ".regress" / "experiments"
    ed.mkdir(parents=True)
    nested = ed / "cache-paired.json"
    nested.write_text(_json.dumps(
        {"median_delta_s": 189.2, "date": "2026-09-21",
         "trials": 3, "range_s": [180.0, 200.0]}), encoding="utf-8")
    s = cache_stats(regress_dir)
    assert s["saved_seconds_measured"] == 378.4  # 2 命中 × 189.2
    mf = s["measured_from"]
    assert mf["source"] == "nested-repo"
    assert mf["path"] == str(nested)  # 实际路径人读可辨（FP1 出口）


def test_cache_stats_local_archive_priority_over_nested(regress_dir, tmp_path):
    """v1.92.4：本位与嵌套位都有档——本位优先（不因并存越过本地读嵌套）。"""
    from history import cache_stats
    record(regress_dir, "commit_passed", "R1", runner="pytest", cached=True)
    import os as _os
    ed = _os.path.join(str(regress_dir), "experiments")
    _os.makedirs(ed, exist_ok=True)
    with open(_os.path.join(ed, "cache-paired.json"), "w",
              encoding="utf-8") as f:
        f.write(_json.dumps({"median_delta_s": 160.2, "date": "2026-09-21",
                             "trials": 3}))
    ned = tmp_path / "regress-guard" / ".regress" / "experiments"
    ned.mkdir(parents=True)
    (ned / "cache-paired.json").write_text(_json.dumps(
        {"median_delta_s": 999.9, "date": "2000-01-01", "trials": 1}),
        encoding="utf-8")
    s = cache_stats(regress_dir)
    assert s["saved_seconds_measured"] == 160.2  # 本位中位生效
    assert s["measured_from"]["source"] == "project"


def test_cache_stats_est_fallback_without_archive(regress_dir):
    """实验档缺场：回 est 旧语义（向后兼容，无 measured 字段）。"""
    from history import cache_stats
    record(regress_dir, "commit_passed", "R1", runner="pytest", cached=True)
    s = cache_stats(regress_dir)
    assert "saved_seconds_measured" not in s
    assert s["est_saved_seconds"] == 118


# ─── v1.87.5 特性零火探测（098：086 Pattern B）─────────

import json as _json
import time as _time


def _seed_registry(regress_dir, feats):
    import os as _os
    with open(_os.path.join(regress_dir, "feature-registry.json"), "w",
              encoding="utf-8") as _f:
        _f.write(_json.dumps(feats))


def test_feature_fire_firing(regress_dir):
    now = _time.time()
    _seed_registry(regress_dir, [{"slug": "cache-hit", "shipped_at": now - 86400,
                                  "window_days": 30,
                                  "fire_marker": {"event": "commit_passed",
                                                  "field": "cached", "value": True}}])
    record(regress_dir, "commit_passed", "R1", runner="pytest", cached=True)
    rows = feature_fire_health(str(regress_dir))["features"]
    assert rows[0]["status"] == "firing" and rows[0]["fires"] == 1


def test_feature_fire_zero_fire(regress_dir):
    now = _time.time()
    _seed_registry(regress_dir, [{"slug": "ghost", "shipped_at": now - 40 * 86400,
                                  "window_days": 30,
                                  "fire_marker": {"event": "commit_passed",
                                                  "field": "cached", "value": True}}])
    record(regress_dir, "commit_passed", "R1", runner="pytest", cached=False)
    rows = feature_fire_health(str(regress_dir))["features"]
    assert rows[0]["status"] == "zero-fire" and rows[0]["fires"] == 0


def test_feature_fire_unmeasurable(regress_dir):
    now = _time.time()
    _seed_registry(regress_dir, [{"slug": "v180-gov-line", "shipped_at": now - 86400,
                                  "window_days": 30,
                                  "fire_marker": {}}])  # 无事件可查（101 补位后仅史例语义）
    rows = feature_fire_health(str(regress_dir))["features"]
    assert rows[0]["status"] == "unmeasurable"


def test_feature_fire_journal_fold(regress_dir):
    """v1.88.2（101）双文件折叠：marker 指向 journal 事件（kind 归一为 event）
    判 firing；不匹配的 journal 事件不计数（FP1 谓词不放宽）；畸形 ts 不炸探针。"""
    from datetime import datetime as _dt
    now = _time.time()
    _seed_registry(regress_dir, [
        {"slug": "plan-bridge-receipt", "shipped_at": now - 86400,
         "window_days": 60, "fire_marker": {"event": "plan_approved"}}])
    import os as _os
    jd = _os.path.join(str(regress_dir), "journal")
    _os.makedirs(jd, exist_ok=True)
    with open(_os.path.join(jd, "events.jsonl"), "w", encoding="utf-8") as f:
        f.write(_json.dumps({"ts": _dt.now().isoformat(), "kind": "plan_approved",
                             "manifest_id": "R1"}) + "\n")
        f.write(_json.dumps({"ts": _dt.now().isoformat(), "kind": "plan_refined"}) + "\n")
        f.write(_json.dumps({"kind": "plan_approved", "ts": "not-a-date"}) + "\n")
    rows = feature_fire_health(str(regress_dir))["features"]
    # 可定时的 plan_approved×1 计数；无法定时的那条不进窗口也不炸（FP1 加固）
    assert rows[0]["status"] == "firing" and rows[0]["fires"] == 1


def test_feature_health_iso_shipped_at(tmp_path):
    """129：registry shipped_at ISO 字符串（批127 手笔曾令命令整崩两日）——
    双格式兼容，不崩且折算正确。"""
    import json as _json, time as _time
    m = _load() if False else None
    import importlib.util as ilu, os as _os
    H = _os.path.join(_os.path.dirname(__file__), "..", "hooks",
                      "scripts", "lib", "history.py")
    spec = ilu.spec_from_file_location("h_iso", H)
    h = ilu.module_from_spec(spec); spec.loader.exec_module(h)
    rg = tmp_path / ".regress"
    rg.mkdir()
    _json.dump([{"slug": "iso-feat",
                 "shipped_at": "2026-09-28T09:23:45",
                 "fire_marker": {"event": "commit_passed"}}],
               open(rg / "feature-registry.json", "w"))
    from datetime import datetime as _dtm
    (rg / "history.jsonl").write_text(_json.dumps(
        {"timestamp": _dtm.now().isoformat(),
         "event": "commit_passed"}) + "\n")
    r = h.feature_fire_health(str(rg))  # regress_dir=.regress 本身（CLI 同参）
    row = [f for f in r["features"] if f["slug"] == "iso-feat"]
    assert row and row[0]["fires"] >= 1  # ISO 行不崩且事件可数
