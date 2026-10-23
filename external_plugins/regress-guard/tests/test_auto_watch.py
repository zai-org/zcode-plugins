"""全自动无感层测试：risk_watch（破坏性动作/命令普查）+ reflection 三段评估。

核心命题：这些检测器不需要人类对话触发——纯机器信号。
"""
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import pytest

SCRIPTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts"))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import risk_watch  # noqa: E402
import reflection_check  # noqa: E402


@pytest.fixture(autouse=True)
def _no_session_env(monkeypatch):
    """密封（评审批次一活体标本×3）：门禁复验在钩子 env 下跑 pytest，
    CLAUDE/ZCODE_SESSION_ID 让被测代码去找 env 会话名的 fails 文件——
    而本文件 _mk_fails 按老约定写 "default" 名。剥掉会话 env，
    测试与 standalone 跑法同构。"""
    monkeypatch.delenv("CLAUDE_SESSION_ID", raising=False)
    monkeypatch.delenv("ZCODE_SESSION_ID", raising=False)


@pytest.fixture
def isolated_tmp(monkeypatch, tmp_path):
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    return tmp_path


# ── risk_watch 探测 ──

def _bash(cmd):
    return risk_watch.is_risky("Bash", {"command": cmd})


def test_risky_rm_rf_detected(isolated_tmp):
    assert _bash("rm -rf node_modules") is not None
    assert _bash("rm -fr /tmp/x") is not None


def test_risky_force_push_and_drop(isolated_tmp):
    assert _bash("git push --force origin main") is not None
    assert _bash("psql -c 'DROP TABLE users'") is not None


def test_benign_commands_not_risky(isolated_tmp):
    assert _bash("rm single-file.txt") is None            # 无 -rf
    assert _bash("git push origin main") is None          # 正常推送
    assert _bash("git reset --soft HEAD~1") is None       # 软重置可恢复
    assert _bash("npm install") is None                   # 依赖安装可回滚
    assert _bash("echo 'truncate this word'") is None


def test_risky_env_file_write(isolated_tmp, tmp_path):
    assert risk_watch.is_risky("Write", {"file_path": "/proj/.env"}) is not None
    assert risk_watch.is_risky("Write", {"file_path": "/proj/.env.example"}) is None


def _feed(script, payload, tmp_dir):
    """子进程喂 stdin——TMPDIR 指向沙箱，与 monkeypatch 的 gettempdir 对齐。"""
    subprocess.run(
        [sys.executable, os.path.join(SCRIPTS, script)],
        input=json.dumps(payload), capture_output=True, text=True, timeout=10,
        env={**os.environ, "TMPDIR": str(tmp_dir)},
    )


def test_risk_watch_records_via_stdin(isolated_tmp, tmp_path):
    _feed("risk_watch.py", {"tool_name": "Bash", "tool_input": {"command": "rm -rf build"}}, tmp_path)
    risks = risk_watch.recent_risks(15)
    assert len(risks) == 1 and "rm -rf build" in risks[0]["detail"]
    usage = risk_watch.recent_usage(15)
    assert len(usage) == 1 and usage[0]["sig"].startswith("rm")


def test_usage_only_counts_bash(isolated_tmp, tmp_path):
    _feed("risk_watch.py", {"tool_name": "Write", "tool_input": {"file_path": "/p/x.py"}}, tmp_path)
    assert risk_watch.recent_usage(15) == []  # Write 不进普查（同文件迭代是正常流）


# ── reflection：高风险动作未过审 ──

def _mk_proj(tmp_path, manifest_body=None):
    project = tmp_path / "watch-proj"
    (project / ".regress" / "manifests").mkdir(parents=True)
    if manifest_body:
        (project / ".regress" / "manifests" / "REGRESS-2026-001.md").write_text(
            manifest_body, encoding="utf-8")
    return str(project)


def _add_audit(monkeypatch, tmp_path, minutes_ago=0):
    audit = tmp_path / "audit.jsonl"
    ts = datetime.now().isoformat()
    audit.write_text(json.dumps({"ts": ts, "ok": True}) + "\n", encoding="utf-8")
    monkeypatch.setenv("ADVISOR_AUDIT_PATH", str(audit))
    return audit


def test_risky_without_consult_injects(isolated_tmp, monkeypatch, tmp_path):
    """破坏性动作 + 零咨询 → 注入补审。全程无人类输入。"""
    monkeypatch.setenv("ADVISOR_AUDIT_PATH", str(tmp_path / "no-such-audit.jsonl"))
    project = _mk_proj(tmp_path)
    _feed("risk_watch.py", {"tool_name": "Bash", "tool_input": {"command": "git reset --hard"}}, tmp_path)
    rs = reflection_check.check_context(project)
    joined = "\n".join(rs or [])
    assert "高风险动作未过审" in joined
    assert "git reset --hard" in joined


def test_risky_with_recent_consult_no_inject(isolated_tmp, monkeypatch, tmp_path):
    """刚咨询过顾问 → 不打扰。"""
    _add_audit(monkeypatch, tmp_path)
    project = _mk_proj(tmp_path)
    _feed("risk_watch.py", {"tool_name": "Bash", "tool_input": {"command": "git reset --hard"}}, tmp_path)
    rs = reflection_check.check_context(project)
    assert "高风险动作未过审" not in "\n".join(rs or [])


# ── reflection：方向漂移（清单外改动）──

DRIFT_MANIFEST = """---
id: REGRESS-2026-001
status: in-progress
planned_changes:
  - id: F1
    file: "src/auth/login.ts"
    type: method-logic
---
# 正文
"""


def test_drift_detected_for_unplanned_change(isolated_tmp, tmp_path):
    """改了清单外的文件 → 注入方向漂移警告（无需人类开口）。"""
    project = _mk_proj(tmp_path, DRIFT_MANIFEST)
    subprocess.run(["git", "init", "-q"], cwd=project, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=project, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=project, check=True)
    (tmp_path / "watch-proj" / "src" / "db").mkdir(parents=True)
    (tmp_path / "watch-proj" / "src" / "db" / "pool.ts").write_text("x", encoding="utf-8")
    rs = reflection_check.check_context(project)
    joined = "\n".join(rs or [])
    assert "方向漂移" in joined
    assert "pool.ts" in joined


def test_planned_change_no_drift(isolated_tmp, tmp_path):
    """改动在清单内 → 无漂移注入。"""
    project = _mk_proj(tmp_path, DRIFT_MANIFEST)
    subprocess.run(["git", "init", "-q"], cwd=project, check=True)
    (tmp_path / "watch-proj" / "src" / "auth").mkdir(parents=True)
    (tmp_path / "watch-proj" / "src" / "auth" / "login.ts").write_text("x", encoding="utf-8")
    rs = reflection_check.check_context(project)
    assert "方向漂移" not in "\n".join(rs or [])


def test_verifying_status_counts_active(isolated_tmp, tmp_path):
    """verifying 属封闭活跃集——旧代码漏掉它，导致 verifying 阶段失去全部反思保护。"""
    project = _mk_proj(tmp_path, DRIFT_MANIFEST.replace("in-progress", "verifying"))
    rs = reflection_check.check_context(project)
    assert any("活跃的回归清单" in r for r in (rs or []))


# ── compact_notice ──

def test_compact_notice_emits_warning():
    proc = subprocess.run(
        [sys.executable, os.path.join(SCRIPTS, "compact_notice.py")],
        capture_output=True, text=True, timeout=10,
    )
    assert proc.returncode == 0
    ctx = json.loads(proc.stdout)["additionalContext"]
    assert "压缩" in ctx and "/handoff" in ctx


# ── 机器层自动第二意见（钩子直连本地顾问，不经主AI）──

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


class _StubAdvisor(BaseHTTPRequestHandler):
    bodies = []
    # 剧本响应（可选）：每项 {"content","finish"} 按请求顺序消耗；耗尽用默认完整答
    script = []

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        _StubAdvisor.bodies.append(self.rfile.read(n).decode())
        if _StubAdvisor.script:
            item = _StubAdvisor.script.pop(0)
            content, finish = item["content"], item.get("finish", "stop")
        else:
            content = ("根因：依赖版本与锁文件冲突。建议：删锁重装并锁定 x.y 版本。确定程度：中。")
            finish = None  # 旧默认：不回 finish_reason（视为完整）
        resp = json.dumps({"choices": [
            {"message": {"content": content},
             **({"finish_reason": finish} if finish else {})}
        ]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(resp)))
        self.end_headers()
        self.wfile.write(resp)

    def log_message(self, *a):
        pass


@pytest.fixture
def stub_advisor(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), _StubAdvisor)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    _StubAdvisor.bodies = []
    _StubAdvisor.script = []
    monkeypatch.setenv("ADVISOR_DSH_URL", f"http://127.0.0.1:{srv.server_port}/x")
    monkeypatch.setenv("ADVISOR_DSH_TOKEN", "stub-token")
    monkeypatch.setenv("REGRESS_AUTO_CONSULT", "on")
    yield _StubAdvisor.bodies
    srv.shutdown()


def _mk_fails(tmp_path, n=3, sig="pnpm install"):
    from datetime import datetime as _dt
    p = tmp_path / "regress-guard-fails-default.jsonl"
    p.write_text("\n".join(json.dumps({"ts": _dt.now().isoformat(), "tool": "Bash", "sig": sig})
                           for _ in range(n)) + "\n", encoding="utf-8")


def _mk_usage(tmp_path, sigs=("npm test",), n=1):
    """窗口内成功执行的 Bash 普查（迭代中信号）。"""
    from datetime import datetime as _dt
    p = tmp_path / "regress-guard-usage-default.jsonl"
    p.write_text("\n".join(json.dumps({"ts": _dt.now().isoformat(), "tool": "Bash", "sig": s})
                           for s in sigs for _ in range(n)) + "\n", encoding="utf-8")


def _mk_journal_chronic(project_dir, sig="npm run flaky"):
    """考古地层：同一签名跨两个会话的慢性失败（稳定经验信号）。"""
    from datetime import datetime as _dt
    jdir = os.path.join(project_dir, ".regress", "journal")
    os.makedirs(jdir, exist_ok=True)
    with open(os.path.join(jdir, "events.jsonl"), "w", encoding="utf-8") as f:
        for sess in ("s1", "s2"):
            f.write(json.dumps({"ts": _dt.now().isoformat(), "kind": "tool_fail",
                                "session": sess, "sig": sig}) + "\n")


# ── 决策落盘提醒（v1.11：纠错与顾问采纳的 durable 半边）──

def _mk_journal_correction(project_dir, minutes_ago=0):
    from datetime import datetime as _dt, timedelta as _td
    jdir = os.path.join(project_dir, ".regress", "journal")
    os.makedirs(jdir, exist_ok=True)
    ts = (_dt.now() - _td(minutes=minutes_ago)).isoformat()
    with open(os.path.join(jdir, "events.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"ts": ts, "kind": "user_correction",
                            "session": "s1", "excerpt": "方向不对"}) + "\n")


def test_decision_reminder_on_correction(isolated_tmp, tmp_path):
    """地层里有近期用户纠正 → 提醒把否决方向 append 进 decisions.md。"""
    project = _mk_proj(tmp_path)
    _mk_journal_correction(project, minutes_ago=1)
    rs = reflection_check.check_context(project)
    joined = "\n".join(rs or [])
    assert "未处置用户纠正" in joined          # v1.94 高水位提醒（新文案）
    assert "decisions.md" in joined and "否决" in joined


def test_decision_reminder_on_consult(isolated_tmp, monkeypatch, tmp_path):
    """audit 近期有咨询 → 提醒落采纳标注（durable 半边）。"""
    project = _mk_proj(tmp_path)
    _add_audit(monkeypatch, tmp_path)          # 近期顾问咨询
    rs = reflection_check.check_context(project)
    joined = "\n".join(rs or [])
    assert "决策落盘（顾问意见）" in joined
    assert "采纳" in joined and "decisions.md" in joined


def test_decision_reminder_cooldown(isolated_tmp, monkeypatch, tmp_path):
    """同类 20 分钟冷却：第二次触发不再重复提醒。"""
    project = _mk_proj(tmp_path)
    _mk_journal_correction(project, minutes_ago=1)
    _add_audit(monkeypatch, tmp_path)
    r1 = "\n".join(reflection_check.check_context(project) or [])
    assert "未处置用户纠正" in r1 and "决策落盘（顾问意见）" in r1
    r2 = "\n".join(reflection_check.check_context(project) or [])
    assert "未处置用户纠正" not in r2 and "决策落盘" not in r2  # 两类都已冷却


def test_decision_reminder_stale_correction_skipped(isolated_tmp, tmp_path):
    """v1.94 契约翻转：旧纠正（>10 分钟）但未处置 → 仍提醒（高水位窗取代
    墙钟窗——0158a98b 标本 11:12 纠正 vs 11:32 轮末恰好逃逸的修复锚）。"""
    project = _mk_proj(tmp_path)
    _mk_journal_correction(project, minutes_ago=30)
    rs = reflection_check.check_context(project)
    assert "未处置用户纠正" in "\n".join(rs or [])


def test_auto_consult_success(isolated_tmp, stub_advisor, tmp_path):
    """失败风暴 → 钩子直连本地顾问，机器摆渡包未经主AI筛选。"""
    _mk_fails(tmp_path)
    project = _mk_proj(tmp_path)
    rs = reflection_check.check_context(project)
    joined = "\n".join(rs or [])
    assert "自动第二意见" in joined
    assert "依赖版本与锁文件冲突" in joined          # 顾问意见原文注入
    assert "仅供参考" in joined and "决策权在你" in joined
    assert len(stub_advisor) == 1
    sent = json.loads(stub_advisor[0])["messages"][0]["content"]
    assert "pnpm install" in sent                    # 摆渡包含失败签名
    assert "客观数据" in sent
    assert "低把握" in sent                           # 诚实性条款随行


def test_auto_consult_cooldown(isolated_tmp, stub_advisor, tmp_path):
    """5 分钟冷却：第二次触发不再烧顾问。"""
    _mk_fails(tmp_path)
    project = _mk_proj(tmp_path)
    reflection_check.check_context(project)
    reflection_check.check_context(project)
    assert len(stub_advisor) == 1


def test_auto_consult_dead_port_falls_back(isolated_tmp, monkeypatch, tmp_path):
    """本地端点挂了 → 不崩，降级为指示主AI自行 consult。"""
    monkeypatch.setenv("ADVISOR_DSH_URL", "http://127.0.0.1:1/x")
    monkeypatch.setenv("ADVISOR_DSH_TOKEN", "stub-token")
    monkeypatch.setenv("REGRESS_AUTO_CONSULT", "on")
    _mk_fails(tmp_path)
    rs = reflection_check.check_context(_mk_proj(tmp_path))
    joined = "\n".join(rs or [])
    assert "自动第二意见" not in joined               # 没拿到意见
    assert "失败清单" in joined                        # 摆渡数据仍在
    assert "mcp__advisor__consult" in joined           # 降级指令在场


def test_auto_consult_kill_switch(isolated_tmp, stub_advisor, tmp_path):
    """REGRESS_AUTO_CONSULT=off 一票关闭（不碰网络）。"""
    import os
    os.environ["REGRESS_AUTO_CONSULT"] = "off"
    try:
        _mk_fails(tmp_path)
        rs = reflection_check.check_context(_mk_proj(tmp_path))
        assert "自动第二意见" not in "\n".join(rs or [])
        assert len(stub_advisor) == 0
    finally:
        os.environ["REGRESS_AUTO_CONSULT"] = "on"


# ── 单次调用（v2.2：服务端持有唯一权威超时，客户端无梯子）──

# ── 信号融合：3 次失败 ≠ 一定卡死（迭代中/慢性已知 → 软提示，不烧顾问）──

def test_storm_suppressed_when_success_interleaved(isolated_tmp, stub_advisor, tmp_path):
    """TDD 红绿循环：失败签名窗口内也有成功执行 → 非急性，不注入风暴指令不烧顾问。"""
    _mk_fails(tmp_path, n=4, sig="npm test")
    _mk_usage(tmp_path, sigs=("npm test",), n=2)  # 也在成功跑
    project = _mk_proj(tmp_path)
    rs = reflection_check.check_context(project)
    joined = "\n".join(rs or [])
    assert "当前方法大概率错误" not in joined       # 不触发急性风暴
    assert "自动第二意见" not in joined              # 不烧顾问
    assert "非急性" in joined and "迭代" in joined    # 软提示在场
    assert len(stub_advisor) == 0


def test_storm_downgrades_to_chronic_journal(isolated_tmp, stub_advisor, tmp_path):
    """慢性已知：失败签名在考古地层跨会话重复 → 软提示指向 /regress:learn，不烧顾问。"""
    project = _mk_proj(tmp_path)
    _mk_journal_chronic(project, sig="npm run flaky")
    _mk_fails(tmp_path, n=3, sig="npm run flaky")
    rs = reflection_check.check_context(project)
    joined = "\n".join(rs or [])
    assert "当前方法大概率错误" not in joined
    assert "自动第二意见" not in joined
    assert "慢性" in joined and "/regress:learn" in joined
    assert len(stub_advisor) == 0


def test_storm_still_fires_for_acute_new_failures(isolated_tmp, stub_advisor, tmp_path):
    """急性卡死不受融合影响：全新签名 + 零成功 + ≥3 → 风暴注入 + 机器摆渡咨询。"""
    _mk_fails(tmp_path, n=3, sig="pnpm install")   # 无 usage、无地层 = 全新+零成功
    project = _mk_proj(tmp_path)
    rs = reflection_check.check_context(project)
    joined = "\n".join(rs or [])
    assert "当前方法大概率错误" in joined
    assert "自动第二意见" in joined                 # stub 默认完整答 → 注入意见
    assert len(stub_advisor) == 1


def test_auto_consult_single_truncated_annotates(isolated_tmp, stub_advisor, tmp_path):
    """单次返回被截断（finish=length）→ 注入已得内容并标注疑似截断。"""
    _StubAdvisor.script = [
        {"content": "根因：依赖版本与锁文件冲突。建议：删锁重装。", "finish": "length"},
    ]
    _mk_fails(tmp_path)
    rs = reflection_check.check_context(_mk_proj(tmp_path))
    joined = "\n".join(rs or [])
    assert len(stub_advisor) == 1                     # 单次，无重试梯子
    import json as _j
    body1 = _j.loads(stub_advisor[0])
    assert "max_tokens" not in body1                  # 不限思考
    assert "model" not in body1                       # 不指定 model（服务端默认官方）
    assert "自动第二意见" in joined
    assert "疑似被 max_tokens 截断" in joined


def test_auto_consult_single_empty_gives_up(isolated_tmp, stub_advisor, tmp_path):
    """单次空答 → 不注入意见，降级为指示主AI自行 consult。"""
    _StubAdvisor.script = [{"content": "", "finish": "length"}]
    _mk_fails(tmp_path)
    rs = reflection_check.check_context(_mk_proj(tmp_path))
    joined = "\n".join(rs or [])
    assert len(stub_advisor) == 1
    assert "自动第二意见" not in joined
    assert "mcp__advisor__consult" in joined           # 降级指令在场




# ── 意图复述主动提示（半无感层）──

def test_intent_restate_fires_on_new_manifest(isolated_tmp, tmp_path):
    """新活跃清单 → 注入三行复述块指令（人类无需说话）。"""
    project = _mk_proj(tmp_path, DRIFT_MANIFEST)
    rs = reflection_check.check_context(project)
    joined = "\n".join(rs or [])
    assert "意图复述" in joined
    assert "当前理解" in joined and "下一步" in joined
    assert "不对" in joined  # 与纠错链的衔接说明在场


def test_intent_restate_cooldown(isolated_tmp, tmp_path):
    """10 分钟内同一清单不重复提示（防刷屏）。"""
    project = _mk_proj(tmp_path, DRIFT_MANIFEST)
    reflection_check.check_context(project)
    rs = reflection_check.check_context(project)
    assert "意图复述" not in "\n".join(rs or [])


def test_intent_restate_refires_after_interval(isolated_tmp, tmp_path, monkeypatch):
    """超过间隔后重新提示。"""
    project = _mk_proj(tmp_path, DRIFT_MANIFEST)
    reflection_check.check_context(project)
    # 把状态文件的 ts 改到 700 秒前
    import glob as _g
    for p in _g.glob(str(tmp_path / "regress-guard-lastrestate-*.txt")):
        parts = open(p).read().strip().split("|")
        open(p, "w").write(f"{parts[0]}|{float(parts[1]) - 700}")
    rs = reflection_check.check_context(project)
    assert "意图复述" in "\n".join(rs or [])


def test_intent_restate_off_switch(isolated_tmp, tmp_path, monkeypatch):
    """REGRESS_RESTATE_INTERVAL_S=0 → 关闭。"""
    monkeypatch.setenv("REGRESS_RESTATE_INTERVAL_S", "0")
    project = _mk_proj(tmp_path, DRIFT_MANIFEST)
    rs = reflection_check.check_context(project)
    assert "意图复述" not in "\n".join(rs or [])


def test_intent_restate_no_manifest_no_prompt(isolated_tmp, tmp_path):
    """未接入项目不提示（活跃清单是复述的锚点）。"""
    project = _mk_proj(tmp_path)  # 无清单
    assert "意图复述" not in "\n".join(reflection_check.check_context(project) or [])


# ── risk_watch：审批化石（v1.13，agent 编辑清单的路径）──

_MF_TMPL = """---
id: R1
status: {status}
approved:
  at: "{approved_at}"
  note: ""
planned_changes: []
---
body
"""


def _feed_mf(payload, proj, tmp_dir):
    """喂 risk_watch 子进程：TMPDIR 沙箱 + REGRESS_JOURNAL=on + 项目锚点。"""
    subprocess.run(
        [sys.executable, os.path.join(SCRIPTS, "risk_watch.py")],
        input=json.dumps(payload), capture_output=True, text=True, timeout=10,
        env={**os.environ, "TMPDIR": str(tmp_dir), "REGRESS_JOURNAL": "on",
             "CLAUDE_PROJECT_DIR": str(proj)},
    )


def _mf_events(proj):
    p = Path(proj) / ".regress" / "journal" / "events.jsonl"
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l]


def _write_manifest(proj, status="planning", approved_at=""):
    mf = Path(proj) / ".regress" / "manifests" / "R1.md"
    mf.write_text(_MF_TMPL.format(status=status, approved_at=approved_at),
                  encoding="utf-8")
    return mf


def test_manifest_write_journals_plan_created(tmp_path):
    proj = _mk_proj(tmp_path)  # 复用本文件的项目工厂（建 .regress/manifests）
    mf = _write_manifest(proj)
    _feed_mf({"tool_name": "Write", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    evts = [e for e in _mf_events(proj) if e.get("kind") == "plan_created"]
    assert len(evts) == 1 and evts[0]["manifest_id"] == "R1"
    # dedup：再 Write 一次不重复埋
    _feed_mf({"tool_name": "Write", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    assert len([e for e in _mf_events(proj) if e.get("kind") == "plan_created"]) == 1


def test_manifest_edit_journals_plan_refined(tmp_path):
    proj = _mk_proj(tmp_path)
    mf = _write_manifest(proj)
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    # 每次细化都是真实化石，不去重
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    assert len([e for e in _mf_events(proj) if e.get("kind") == "plan_refined"]) == 2


def test_manifest_approved_via_edit_journals_once(tmp_path):
    """agent 转写批准（Edit 填 approved.at）→ plan_approved 埋一次，重复 dedup。"""
    proj = _mk_proj(tmp_path)
    mf = _write_manifest(proj, approved_at="2026-08-26T10:00:00")
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    assert len([e for e in _mf_events(proj) if e.get("kind") == "plan_approved"]) == 1


def test_manifest_cancelled_journals_once(tmp_path):
    proj = _mk_proj(tmp_path)
    mf = _write_manifest(proj, status="cancelled")
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    assert len([e for e in _mf_events(proj) if e.get("kind") == "plan_cancelled"]) == 1


def test_non_manifest_edits_not_journaled(tmp_path):
    """普通文件的 Edit/Write 不触发审批化石。"""
    proj = _mk_proj(tmp_path)
    _feed_mf({"tool_name": "Edit",
              "tool_input": {"file_path": str(Path(proj) / "src" / "a.ts")}},
             proj, tmp_path)
    assert _mf_events(proj) == []


# ── risk_watch：受阻化石（v1.14，episode 去重）──

def _write_blocked_manifest(proj, status="blocked"):
    mf = Path(proj) / ".regress" / "manifests" / "R1.md"
    mf.parent.mkdir(parents=True, exist_ok=True)
    mf.write_text(_MF_TMPL.format(status=status, approved_at=""), encoding="utf-8")
    return mf


def test_blocked_observation_episode_dedup(tmp_path):
    proj = _mk_proj(tmp_path)
    mf = _write_blocked_manifest(proj)
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    assert len([e for e in _mf_events(proj)
                if e.get("kind") == "task_blocked"]) == 1  # 同一 episode 不重复埋


def test_new_episode_after_unblock_journaled(tmp_path):
    proj = _mk_proj(tmp_path)
    mf = _write_blocked_manifest(proj)
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    # 模拟脚本路径埋了 task_unblocked（episode 关闭）——子进程埋，绕开测试环境的 JOURNAL=off
    subprocess.run(
        [sys.executable, os.path.join(SCRIPTS, "lib", "journal.py"),
         str(proj), "add", "task_unblocked", '{"manifest_id":"R1"}'],
        capture_output=True, text=True, timeout=10,
        env={**os.environ, "REGRESS_JOURNAL": "on"})
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    assert len([e for e in _mf_events(proj)
                if e.get("kind") == "task_blocked"]) == 2  # 第二次受阻=新 episode


def test_provisional_observation_dedup(tmp_path):
    """agent 手写 provisional 块 → provisional_start 埋一次（dedup）。"""
    proj = _mk_proj(tmp_path)
    mf = Path(proj) / ".regress" / "manifests" / "R1.md"
    mf.parent.mkdir(parents=True, exist_ok=True)
    mf.write_text(_MF_TMPL.format(status="in-progress", approved_at="").replace(
        "planned_changes: []",
        'provisional:\n  at: "2026-08-26T11:00:00"\n  advisor: "无异议"\nplanned_changes: []'),
        encoding="utf-8")
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    _feed_mf({"tool_name": "Edit", "tool_input": {"file_path": str(mf)}}, proj, tmp_path)
    assert len([e for e in _mf_events(proj)
                if e.get("kind") == "provisional_start"]) == 1
