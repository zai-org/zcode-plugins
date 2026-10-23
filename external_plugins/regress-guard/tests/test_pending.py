"""决策推送待决台账（v1.34 推送闭环）：add/resolve/list/stats + notify 决策事件落账。"""
import json
import os
import stat

LIB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib"))
PENDING = os.path.join(LIB, "pending.py")
NOTIFY = os.path.join(LIB, "notify.py")


def _load(path, name):
    import importlib.util as ilu
    spec = ilu.spec_from_file_location(name, path)
    m = ilu.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _stub_channel(tmp_path, marker):
    stub = tmp_path / "stub.sh"
    stub.write_text("#!/bin/sh\necho \"$@\" >> %s\n" % marker, encoding="utf-8")
    stub.chmod(stat.S_IRWXU)
    return str(stub)


def _mk_proj(tmp_path, channels):
    proj = tmp_path / "proj"
    (proj / ".regress").mkdir(parents=True, exist_ok=True)
    (proj / ".regress" / "config.json").write_text(
        json.dumps({"notify": {"channels": channels}}, ensure_ascii=False), encoding="utf-8")
    return proj


# ─── 台账本体 ────────────────────────────────────────────

def _trusted(nt, tmp_path, proj):
    """v1.68（057）+v1.72（061）：表+边车双写（钉 09:30 晚于表 09:00——钉发生在授信后的首次使用）。"""
    import pathlib
    rp = str(pathlib.Path(proj).resolve())
    tp = tmp_path / "trust.json"
    tp.write_text(json.dumps({rp: "2026-09-20T09:00:00"}), encoding="utf-8")
    nt._TRUST_TABLE_PATH = str(tp)
    conf = pathlib.Path(proj) / ".regress" / "config.json"
    try:
        nb = json.loads(conf.read_text(encoding="utf-8")).get("notify") or {}
    except Exception:
        nb = {}
    fpr = tmp_path / "trust-fpr.json"
    fpr.write_text(json.dumps({rp: {"ts": "2026-09-20T09:30:00", "notify": nb}},
                              ensure_ascii=False), encoding="utf-8")
    nt._TRUST_FPR_PATH = str(fpr)


def test_add_returns_incrementing_ids(tmp_path, monkeypatch):
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    pd = _load(PENDING, "pd")
    assert pd.add("P", "blocked", "t1") == 1
    assert pd.add("P", "blocked", "t2") == 2
    assert len(pd.pending_records()) == 2


def test_resolve_filters_pending_and_feeds_fp_rate(tmp_path, monkeypatch):
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    pd = _load(PENDING, "pd")
    a, b, c = pd.add("P", "blocked", "t"), pd.add("P", "sensory", "t"), pd.add("P", "blocked", "t")
    pd.resolve(a, "useful")
    pd.resolve(b, "fp")
    s = pd.stats()
    assert s["pending"] == 1 and s["resolved"] == {"useful": 1, "fp": 1, "ignored": 0}
    assert s["fp_rate"] == 0.5  # 1 误报 / 2 已决


def test_resolve_rejects_unknown_outcome(tmp_path, monkeypatch):
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    pd = _load(PENDING, "pd")
    pid = pd.add("P", "blocked", "t")
    try:
        pd.resolve(pid, "meow")
        assert False, "未知 outcome 必须拒绝"
    except ValueError:
        pass


def test_bad_lines_skipped(tmp_path, monkeypatch):
    """坏行跳过（台账是增强不是依赖）——重放不炸、好行不丢。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    with open(tmp_path / "p.jsonl", "w", encoding="utf-8") as f:
        f.write('{"id": 1, "ts": "2026-09-07T00:00:00", "project": "P", '
                '"event": "blocked", "title": "t"}\n')
        f.write('not json\n')
    pd = _load(PENDING, "pd")
    assert pd.add("P", "blocked", "t2") == 2  # max(id)+1，坏行不影响


# ─── notify 集成 ─────────────────────────────────────────

def test_decision_push_creates_pending_with_id_in_body(tmp_path, monkeypatch):
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    nt = _load(NOTIFY, "nt2")
    marker = tmp_path / "m"
    proj = _mk_proj(tmp_path, [_stub_channel(tmp_path, marker) + " {title} {body}"])
    _trusted(nt, tmp_path, proj)
    assert nt.notify(str(proj), "plan_approval", "📋 待批准", "x") == 1
    out = marker.read_text(encoding="utf-8")
    assert "〔待决#1〕" in out and "有用/误报/忽略" in out
    pd = _load(PENDING, "pd2")
    recs = pd.pending_records()
    assert list(recs) == [1] and recs[1]["event"] == "plan_approval"


def test_info_push_creates_no_pending(tmp_path, monkeypatch):
    """done/progress/test 是信息型推送——不产生待决（广播≠决策）。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    nt = _load(NOTIFY, "nt3")
    marker = tmp_path / "m"
    proj = _mk_proj(tmp_path, [_stub_channel(tmp_path, marker) + " {title} {body}"])
    _trusted(nt, tmp_path, proj)
    nt.notify(str(proj), "done", "🏁 完成", "y")
    nt.notify(str(proj), "progress", "⏳ 进度", "z")
    out = marker.read_text(encoding="utf-8")
    assert "〔待决#" not in out
    pd = _load(PENDING, "pd3")
    assert pd.pending_records() == {}


def test_stats_dashboard_parses_ledger(tmp_path, monkeypatch, capsys):
    """观察仪表盘：送达率 + event 维度（含旧格式归桶）+ 待决聚合。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    monkeypatch.setenv("RG_SEND_LEDGER", str(tmp_path / "send.log"))
    with open(tmp_path / "send.log", "w", encoding="utf-8") as f:
        f.write("09-07 12:00:00 errcode=0 event=done agent=2 【X】t1\n"
                "09-07 12:01:00 errcode=0 event=blocked agent=2 【X】t2\n"
                "09-07 12:02:00 errcode=40056 event=test agent=2 【X】t3\n"
                "09-07 12:03:00 errcode=0 agent=2 【X】t4\n")
    nt = _load(NOTIFY, "nt4")
    pd = _load(PENDING, "pd4")
    pd.add("X", "sensory", "👀 感官终验")
    nt._stats()
    out = capsys.readouterr().out
    assert "4 条" in out and "75%" in out
    assert "done" in out and "旧格式" in out
    assert "未决 1" in out and "感官终验" in out


# ─── P0-3：结构化 ref 回流（评审批次一） ─────────────────

def test_resolve_by_ref_exact_and_legacy_fallback(tmp_path, monkeypatch):
    """ref 精确匹配必中；无 ref 的旧记录按标题词边界唯一命中才兜底。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    pd = _load(PENDING, "pd5")
    pd.add("X", "plan_approval", "📋 待批准 REGRESS-2026-099", ref="REGRESS-2026-099")
    pd.add("X", "plan_approval", "📋 待批准 REGRESS-2026-100", ref="REGRESS-2026-100")
    pd.add("X", "blocked", "🛑 受阻 REGRESS-9")  # 旧格式无 ref，标题含 REGRESS-9
    assert pd.resolve_by_ref("REGRESS-2026-099") == 1
    s = pd.stats()
    assert s["pending"] == 2  # 只回流了精确那条
    # 词边界：REGRESS-9 不误吃 REGRESS-2026-099（已决的不在未决池）
    assert pd.resolve_by_ref("REGRESS-9") == 1
    s = pd.stats()
    assert s["pending"] == 1 and s["resolved"]["useful"] == 2


def test_resolve_by_ref_no_ambig_no_hit(tmp_path, monkeypatch):
    """空 ref 不动；多条标题都含目标 id 时不兜底（防误匹配）。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    pd = _load(PENDING, "pd6")
    assert pd.resolve_by_ref("") == 0
    pd.add("X", "blocked", "🛑 受阻 R1 复查")
    pd.add("X", "blocked", "🛑 受阻 R1 再看")
    assert pd.resolve_by_ref("R1") == 0  # 两条都命中标题=多义，不动
    assert pd.stats()["pending"] == 2


def test_notify_source_id_flows_into_ref(tmp_path, monkeypatch):
    """notify(--ref/source_id) → 待决记录带 ref 字段（plan_approve 自动回流的数据前提）。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    nt = _load(NOTIFY, "nt5")
    proj = _mk_proj(tmp_path, [_stub_channel(tmp_path, tmp_path / "m") + " {title}"])
    nt.notify(str(proj), "plan_approval", "📋 待批准", "x",
              source_id="REGRESS-2026-024")
    pd = _load(PENDING, "pd7")
    recs = pd._load()[0]
    assert recs[1]["ref"] == "REGRESS-2026-024"
    assert pd.resolve_by_ref("REGRESS-2026-024") == 1


# ─── P2#20：坏通道模板只跳过自身（批次三） ─────────────────

def test_bad_channel_template_isolated(tmp_path):
    """模板含 awk 花括号（format 抛 KeyError）不再废掉后续通道。"""
    nt = _load(NOTIFY, "nt-iso")
    import stat as _stat
    stub = tmp_path / "stub.sh"
    marker = tmp_path / "iso-marker"
    stub.write_text("#!/bin/sh\necho ok >> " + str(marker) + "\n", encoding="utf-8")
    stub.chmod(_stat.S_IRWXU)
    proj = tmp_path / "proj"
    (proj / ".regress").mkdir(parents=True)
    (proj / ".regress" / "config.json").write_text(json.dumps(
        {"notify": {"channels": [
            "awk '{print}' /nope",               # 坏模板：花括号炸 format
            str(stub) + " {title} {body}",       # 好通道必须仍然跑到
        ]}}, ensure_ascii=False), encoding="utf-8")
    _trusted(nt, tmp_path, proj)
    ran = nt.notify(str(proj), "done", "隔离验证", "x")
    assert ran >= 1
    assert marker.exists()


# ─── v1.38：blocked 合并（同键窗口折叠）+ list 结局显示 ──────

def test_blocked_coalesces_same_key_within_window(tmp_path, monkeypatch):
    """四象限①：同项目+ref+指纹，窗口内第二次 → 不发不重记，折叠旁路行+1。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    nt = _load(NOTIFY, "nt-c1")
    marker = tmp_path / "m"
    proj = _mk_proj(tmp_path, [_stub_channel(tmp_path, marker) + " {title} {body}"])
    _trusted(nt, tmp_path, proj)
    assert nt.notify(str(proj), "blocked", "⛔ 拦 R1", "同因甲", source_id="R1") == 1
    assert nt.notify(str(proj), "blocked", "⛔ 拦 R1", "同因甲", source_id="R1") == 0
    pd = _load(PENDING, "pd-c1")
    assert len(pd._load()[0]) == 1          # 没有第二条待决
    assert pd.count_merged() == 1           # 折叠量被旁路记账（校准数据）
    out = marker.read_text(encoding="utf-8")
    assert out.count("〔待决#") == 1        # 通道只跑了一次


def test_blocked_different_cause_or_ref_pushes(tmp_path, monkeypatch):
    """四象限②：指纹或 ref 任一不同 → 不同决策点，照常推（顾问修正：
    同清单不同原因的拦截不能互相折叠丢信息）。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    nt = _load(NOTIFY, "nt-c2")
    marker = tmp_path / "m"
    proj = _mk_proj(tmp_path, [_stub_channel(tmp_path, marker) + " {title}"])
    nt.notify(str(proj), "blocked", "拦 R1", "因甲", source_id="R1")
    nt.notify(str(proj), "blocked", "拦 R1", "因乙", source_id="R1")  # 同清单不同因
    nt.notify(str(proj), "blocked", "拦 R2", "因甲", source_id="R2")  # 不同清单
    pd = _load(PENDING, "pd-c2")
    assert len(pd._load()[0]) == 3 and pd.count_merged() == 0


def test_blocked_repush_after_resolve_or_expiry(tmp_path, monkeypatch):
    """四象限③④：裁决回流=窗口重置；锚点超窗=重推（「该推没推」对称病）。"""
    import datetime
    import hashlib
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    nt = _load(NOTIFY, "nt-c3")
    marker = tmp_path / "m"
    proj = _mk_proj(tmp_path, [_stub_channel(tmp_path, marker) + " {title}"])
    nt.notify(str(proj), "blocked", "拦 R1", "因甲", source_id="R1")
    pd = _load(PENDING, "pd-c3")
    pd.resolve(1, "useful")
    nt.notify(str(proj), "blocked", "拦 R1", "因甲", source_id="R1")  # 已决→重推
    assert len(pd._load()[0]) == 2
    # 锚点过期：手写 40 分钟前的锚点（fp=body sha1 前 8 位，钉住指纹契约）→ 重推
    fp = hashlib.sha1("因乙".encode("utf-8")).hexdigest()[:8]
    old = (datetime.datetime.now() - datetime.timedelta(minutes=40)
           ).isoformat(timespec="seconds")
    with open(tmp_path / "p.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"id": 99, "ts": old, "project": "proj",
                            "event": "blocked", "title": "x", "ref": "R2",
                            "fp": fp}, ensure_ascii=False) + "\n")
    nt.notify(str(proj), "blocked", "拦 R2", "因乙", source_id="R2")
    # 行1已决 + 行2 + 过期锚99 + 新推100——过期锚点不折叠（新行落地=真推了）
    assert len(pd._load()[0]) == 4 and pd.count_merged() == 0


def test_list_shows_outcomes_and_caps_resolved(tmp_path, monkeypatch, capsys):
    """结局可见（v1.38 病例：18 行全 ⏳ 因为判定查错对象）：未决在前带 ⏳、
    已决带 ✔有用/误报/忽略；已决只列最近 5 条防刷屏。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    pd = _load(PENDING, "pd-l")
    for i in range(7):
        pd.add("P", "blocked", f"t{i}")
    for i in range(1, 6):
        pd.resolve(i, "useful")
    pd.resolve(6, "fp")
    pd.main(["list"])
    out = capsys.readouterr().out
    assert "#7 ⏳" in out and "#6 ✔误报" in out and "#5 ✔有用" in out
    assert "另有 1 笔已裁决" in out          # 已决 6 条只列 5，第 1 条收进省略行
    pd.main(["list", "--pending"])
    out2 = capsys.readouterr().out
    assert "#7" in out2 and "✔" not in out2  # --pending 只看未决


def test_newest_open_matches_triple_key(tmp_path, monkeypatch):
    """newest_open 三维键：project+ref+fp 缺一不可；已决不参与。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    pd = _load(PENDING, "pd-no")
    pd.add("P", "blocked", "t", ref="R1", fp="aa")
    assert pd.newest_open("P", "R1", "aa")["id"] == 1
    assert pd.newest_open("P", "R1", "bb") is None       # 指纹不同
    assert pd.newest_open("P", "R2", "aa") is None       # ref 不同
    assert pd.newest_open("Q", "R1", "aa") is None       # 项目不同
    pd.resolve(1, "ignored")
    assert pd.newest_open("P", "R1", "aa") is None       # 已决=窗口重置


def test_resolved_outcome_single_bucket(tmp_path, monkeypatch):
    """v1.71（060）：resolved 自动闭环单列计数，不入误报率分母。"""
    monkeypatch.setenv("RG_PENDING_LEDGER", str(tmp_path / "p.jsonl"))
    pd = _load(PENDING, "pd-rs")
    pd.add("P", "blocked", "⛔ 拦 R1", ref="R1")
    assert pd.resolve_by_ref("R1", outcome="resolved") == 1
    s = pd.stats()
    assert s["auto_resolved"] == 1 and s["pending"] == 0
    assert s["fp_rate"] is None  # human 裁决为零 → 分母空（口径不变）
