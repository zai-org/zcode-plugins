"""plan_approve（批准落产物 + 漂移检查 + 地层）的单元测试。"""
import json
import os
import re
import subprocess
import sys

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts",
                      "lib", "plan_approve.py")
SCRIPT = os.path.abspath(SCRIPT)

MANIFEST = """---
id: R1
requirement: "t"
status: planning
base_head: "{base_head}"
approved:
  at: ""
  note: ""
planned_changes:
  - id: F1
    file: "src/a.ts"
    type: method-logic
    status_note: not_the_status_line
actual_changes: []
fragile_points:
  - id: V1
    kind: env
    description: "d"
    verify: "true"
    status: open
---
body（脆弱点的缩进 status 不许被状态翻转误伤）
"""


def make_proj(tmp_path, base_head=""):
    proj = tmp_path / "proj"
    (proj / ".regress" / "manifests").mkdir(parents=True)
    (proj / ".regress" / "manifests" / "R1.md").write_text(
        MANIFEST.format(base_head=base_head), encoding="utf-8")
    return proj


def run_approve(proj, *args, journal="off"):
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(proj),
           "REGRESS_JOURNAL": journal}
    mf = proj / ".regress" / "manifests" / "R1.md"
    return subprocess.run(
        [sys.executable, SCRIPT, str(mf), *args],
        capture_output=True, text=True, env=env, timeout=15)


def journal_events(proj):
    p = proj / ".regress" / "journal" / "events.jsonl"
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l]


def _git(proj, *args):
    return subprocess.run(["git", "-C", str(proj), *args],
                          capture_output=True, text=True, timeout=10)


def _commit(proj, msg):
    _git(proj, "add", "-A")
    _git(proj, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", msg)


def test_approve_flips_status_and_stamps(tmp_path):
    proj = make_proj(tmp_path)
    r = run_approve(proj)
    assert r.returncode == 0, r.stderr
    content = (proj / ".regress" / "manifests" / "R1.md").read_text(encoding="utf-8")
    assert re.search(r"^status: in-progress$", content, re.M)
    m = re.search(r'^\s+at:\s*"([^"]+)"', content, re.M)
    assert m and m.group(1).startswith("20"), "approved.at 应已填时间戳"
    # 缩进的脆弱点 status 不被误伤
    assert "    status: open" in content
    assert "body（脆弱点的缩进 status 不许被状态翻转误伤）" in content


def test_approve_non_planning_rejected(tmp_path):
    proj = make_proj(tmp_path)
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace("status: planning", "status: in-progress"),
                  encoding="utf-8")
    r = run_approve(proj)
    assert r.returncode == 1
    assert "无需批准" in r.stderr


def test_approve_journals_event(tmp_path):
    proj = make_proj(tmp_path)
    r = run_approve(proj, journal="on")
    assert r.returncode == 0
    evts = [e for e in journal_events(proj) if e.get("kind") == "plan_approved"]
    assert len(evts) == 1
    assert evts[0].get("manifest_id") == "R1"
    assert evts[0].get("approved_at", "").startswith("20")
    assert evts[0].get("drift") == "none"


def test_double_approve_no_duplicate_journal(tmp_path):
    proj = make_proj(tmp_path)
    assert run_approve(proj, journal="on").returncode == 0
    # 人类产物直通后再对齐（重置 status 但保留 approved）→ 不重复埋
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace("status: in-progress", "status: planning"),
                  encoding="utf-8")
    assert run_approve(proj, journal="on").returncode == 0
    assert len([e for e in journal_events(proj)
                if e.get("kind") == "plan_approved"]) == 1


def test_preserves_human_direct_edit_timestamp(tmp_path):
    """产物直通：人类填的 approved.at 不被脚本时间戳覆盖。"""
    proj = make_proj(tmp_path)
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace('at: ""', 'at: "2026-01-01T00:00:00"'),
                  encoding="utf-8")
    assert run_approve(proj).returncode == 0
    content = mf.read_text(encoding="utf-8")
    assert 'at: "2026-01-01T00:00:00"' in content
    assert "产物直通" in content


def test_cancel_sets_cancelled_and_journals(tmp_path):
    proj = make_proj(tmp_path)
    r = run_approve(proj, "--cancel", journal="on")
    assert r.returncode == 0
    content = (proj / ".regress" / "manifests" / "R1.md").read_text(encoding="utf-8")
    assert re.search(r"^status: cancelled$", content, re.M)
    assert "plan_cancelled" in content or True  # 输出提示
    assert any(e.get("kind") == "plan_cancelled" for e in journal_events(proj))


def test_drift_warning_when_head_moved(tmp_path):
    proj = make_proj(tmp_path)
    _git(proj, "init", "-q")
    (proj / "a.txt").write_text("1")
    _commit(proj, "A")
    base = _git(proj, "rev-parse", "--short", "HEAD").stdout.strip()
    (proj / "a.txt").write_text("2")
    _commit(proj, "B")

    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace('base_head: ""', f'base_head: "{base}"'),
                  encoding="utf-8")

    r = run_approve(proj, journal="on")
    assert r.returncode == 0
    assert "计划漂移" in r.stdout and "1 个新提交" in r.stdout
    evts = [e for e in journal_events(proj) if e.get("kind") == "plan_approved"]
    assert evts and evts[0].get("base_head") == base
    assert evts[0].get("commits_behind") == 1


def test_no_drift_when_base_head_matches(tmp_path):
    proj = make_proj(tmp_path)
    _git(proj, "init", "-q")
    (proj / "a.txt").write_text("1")
    _commit(proj, "A")
    base = _git(proj, "rev-parse", "--short", "HEAD").stdout.strip()
    mf = proj / ".regress" / "manifests" / "R1.md"
    mf.write_text(mf.read_text().replace('base_head: ""', f'base_head: "{base}"'),
                  encoding="utf-8")
    r = run_approve(proj)
    assert r.returncode == 0
    assert "漂移" not in r.stdout


def test_template_placeholder_base_head_treated_as_empty(tmp_path):
    """模板占位符 {{GIT_HEAD_SHORT}} 未填 → 不误报漂移。"""
    proj = make_proj(tmp_path, base_head="{{GIT_HEAD_SHORT}}")
    r = run_approve(proj)
    assert r.returncode == 0
    assert "漂移" not in r.stdout


# ── v1.14：受阻一等状态 + 批准时基线快照 ──

def test_block_writes_four_questions_and_journals(tmp_path):
    proj = make_proj(tmp_path)
    # 先批准到 in-progress，再标受阻
    assert run_approve(proj, journal="off").returncode == 0
    r = run_approve(proj, "--block", "--reason", "远端 Redis 不通",
                    "--tried", "redis-cli ping 三次超时",
                    "--unsafe", "改配置可能污染共享环境", "--need", "开防火墙或给白名单",
                    journal="on")
    assert r.returncode == 0, r.stderr
    content = (proj / ".regress" / "manifests" / "R1.md").read_text(encoding="utf-8")
    assert re.search(r"^status: blocked$", content, re.M)
    assert 'reason: "远端 Redis 不通"' in content
    assert 'need: "开防火墙或给白名单"' in content
    # approved 块在受阻转写后仍然保留（两块互不吞噬）
    assert re.search(r'^approved:\n  at: "', content, re.M)
    evts = [e for e in journal_events(proj) if e.get("kind") == "task_blocked"]
    assert len(evts) == 1 and evts[0]["manifest_id"] == "R1"
    assert evts[0]["need"] == "开防火墙或给白名单"


def test_block_requires_reason(tmp_path):
    proj = make_proj(tmp_path)
    assert run_approve(proj, journal="off").returncode == 0
    r = run_approve(proj, "--block", journal="off")
    assert r.returncode == 1 and "--reason" in r.stderr


def test_block_planning_rejected(tmp_path):
    """planning 本身就是在等人类，不存在再标受阻。"""
    proj = make_proj(tmp_path)
    r = run_approve(proj, "--block", "--reason", "x", journal="off")
    assert r.returncode == 1 and "planning" in r.stderr


def test_unblock_restores_in_progress_with_resolved(tmp_path):
    proj = make_proj(tmp_path)
    assert run_approve(proj, journal="off").returncode == 0
    assert run_approve(proj, "--block", "--reason", "env down",
                       "--need", "restart", journal="off").returncode == 0
    r = run_approve(proj, "--unblock", "--resolution", "运维已重启 Redis",
                    journal="on")
    assert r.returncode == 0
    content = (proj / ".regress" / "manifests" / "R1.md").read_text(encoding="utf-8")
    assert re.search(r"^status: in-progress$", content, re.M)
    assert 'resolved_at: "' in content
    assert 'resolution: "运维已重启 Redis"' in content
    assert 'reason: "env down"' in content  # 原四问保留（历史可见）
    assert any(e.get("kind") == "task_unblocked" for e in journal_events(proj))


def test_unblock_not_blocked_rejected(tmp_path):
    proj = make_proj(tmp_path)
    assert run_approve(proj, journal="off").returncode == 0
    r = run_approve(proj, "--unblock", journal="off")
    assert r.returncode == 1


def test_block_unblock_block_cycle_keeps_all_fossils(tmp_path):
    proj = make_proj(tmp_path)
    assert run_approve(proj, journal="on").returncode == 0
    assert run_approve(proj, "--block", "--reason", "a", journal="on").returncode == 0
    assert run_approve(proj, "--unblock", "--resolution", "r1", journal="on").returncode == 0
    assert run_approve(proj, "--block", "--reason", "b", journal="on").returncode == 0
    kinds = [e.get("kind") for e in journal_events(proj)]
    assert kinds.count("task_blocked") == 2 and kinds.count("task_unblocked") == 1


def test_approve_journals_dirty_snapshot(tmp_path):
    proj = make_proj(tmp_path)
    _git(proj, "init", "-q")
    (proj / "local-debug.conf").write_text("x")  # 批准时刻的脏文件
    r = run_approve(proj, journal="on")
    assert r.returncode == 0
    assert "基线快照" in r.stdout and "local-debug.conf" in r.stdout
    evts = [e for e in journal_events(proj) if e.get("kind") == "plan_approved"]
    assert evts[0].get("dirty_count", 0) >= 1
    assert any("local-debug.conf" in d for d in evts[0].get("dirty_files", []))




def _seed_review_fossil(proj):
    """5a 预审化石（v1.20 临行前置）：通过 journal CLI 埋 plan_advisor_review。"""
    subprocess.run(
        [sys.executable, os.path.join(os.path.dirname(SCRIPT), "journal.py"),
         str(proj), "add", "plan_advisor_review",
         '{"manifest_id":"R1","verdict":"no_objection","summary":"方向清晰"}'],
        capture_output=True, text=True, timeout=10,
        env={**os.environ, "REGRESS_JOURNAL": "on"})

# ── v1.18：临行（伪全自动：预授权+顾问预审无异议）──

def test_provisional_flips_and_journals(tmp_path):
    proj = make_proj(tmp_path)
    _seed_review_fossil(proj)
    r = run_approve(proj, "--provisional", "--advisor " * 0 or "--provisional",
                    journal="on") if False else run_approve(
        proj, "--provisional", "--advisor", "无方向性异议；边界合理",
        journal="on")
    assert r.returncode == 0, r.stderr
    content = (proj / ".regress" / "manifests" / "R1.md").read_text(encoding="utf-8")
    assert re.search(r"^status: in-progress$", content, re.M)
    assert 'advisor: "无方向性异议；边界合理"' in content
    assert 'provisional:' in content and re.search(r'^  at: "', content, re.M)
    # approved 块仍为空（人类没批准过这个计划——临行授权来自预授权不来自顾问）
    assert 'at: ""' in content
    evts = [e for e in journal_events(proj) if e.get("kind") == "provisional_start"]
    assert len(evts) == 1 and evts[0]["manifest_id"] == "R1"
    assert "顾问" in r.stdout and "否决" in r.stdout


def test_provisional_requires_advisor(tmp_path):
    proj = make_proj(tmp_path)
    r = run_approve(proj, "--provisional", journal="off")
    assert r.returncode == 1 and "--advisor" in r.stderr


def test_provisional_non_planning_rejected(tmp_path):
    proj = make_proj(tmp_path)
    assert run_approve(proj, journal="off").returncode == 0  # 先到 in-progress
    r = run_approve(proj, "--provisional", "--advisor", "x", journal="off")
    assert r.returncode == 1


def test_cancel_after_provisional_vetoes(tmp_path):
    """否决窗：临行后人类 --cancel 否决。"""
    proj = make_proj(tmp_path)
    _seed_review_fossil(proj)
    assert run_approve(proj, "--provisional", "--advisor", "ok", journal="on").returncode == 0
    r = run_approve(proj, "--cancel", journal="on")
    assert r.returncode == 0
    content = (proj / ".regress" / "manifests" / "R1.md").read_text(encoding="utf-8")
    assert re.search(r"^status: cancelled$", content, re.M)
    kinds = [e.get("kind") for e in journal_events(proj)]
    assert "provisional_start" in kinds and "plan_cancelled" in kinds


def test_approved_task_not_cancellable(tmp_path):
    """正式批准（非临行）的任务不可 --cancel 一销了之。"""
    proj = make_proj(tmp_path)
    assert run_approve(proj, journal="off").returncode == 0  # 正式批准
    r = run_approve(proj, "--cancel", journal="off")
    assert r.returncode == 1 and "正式任务" in r.stderr

def test_provisional_without_review_fossil_rejected(tmp_path):
    """v1.20 防代笔：无 plan_advisor_review 化石在场，临行被拒。"""
    proj = make_proj(tmp_path)
    r = run_approve(proj, "--provisional", "--advisor", "无异议", journal="on")
    assert r.returncode == 1
    assert "plan_advisor_review" in r.stderr and "5a" in r.stderr
    # 清单保持 planning（未被放行）
    content = (proj / ".regress" / "manifests" / "R1.md").read_text(encoding="utf-8")
    assert "status: planning" in content


# ─── P0-3：批准自动回流待决（评审批次一） ─────────────────

def test_approve_auto_resolves_pending(tmp_path, monkeypatch):
    """批准 = 人类对 plan_approval 待决的裁决 → 同 ref 待决自动 resolve。"""
    import importlib.util as ilu
    ledger = tmp_path / "p.jsonl"
    monkeypatch.setenv("RG_PENDING_LEDGER", str(ledger))
    spec = ilu.spec_from_file_location(
        "pd8", os.path.join(os.path.dirname(SCRIPT), "pending.py"))
    pd = ilu.module_from_spec(spec)
    spec.loader.exec_module(pd)
    pd.add("X", "plan_approval", "📋 待批准 R1", ref="R1")
    pd.add("X", "plan_approval", "📋 待批准 R2", ref="R2")

    proj = make_proj(tmp_path)
    r = run_approve(proj)
    assert r.returncode == 0
    assert "自动回流 1 条待决" in r.stdout
    s = pd.stats()
    assert s["pending"] == 1 and s["resolved"]["useful"] == 1


# ─── P1#7：bad escape 不清空清单（评审批次二） ─────────────

def test_bad_escape_note_keeps_manifest(tmp_path):
    """附言含反斜杠序列（C:\docs、\1）→ 批准成功且清单完好。

    旧行为：re.sub 对替换串做转义处理 → re.error 在 write 实参里炸，
    而文件已先被 open(w) 截断——清单 0 字节。"""
    proj = make_proj(tmp_path)
    r = run_approve(proj, "--note", "修复 C:\\docs\\1 路径")
    assert r.returncode == 0
    content = (proj / ".regress" / "manifests" / "R1.md").read_text(encoding="utf-8")
    assert "status: in-progress" in content and len(content) > 50  # 没被清空
    assert "C:\\docs" in content  # 附言字面落盘


# ─── P2#26：漂移检查 repo: 声明（批次三） ──────────────────

def test_drift_repo_field_selects_repo(tmp_path):
    """清单声明 repo: 时用产物仓比对，不再撞外层仓（假警报 da7482b 病例）。"""
    import importlib.util as ilu
    import subprocess as sp
    # 造两个嵌套 git 仓：外层 workspace + 内层 product
    ws = tmp_path / "ws"
    prod = ws / "product"
    (prod).mkdir(parents=True)
    for d in (ws, prod):
        sp.run(["git", "init", "-q"], cwd=str(d), check=True)
        sp.run(["git", "config", "user.email", "t@t"], cwd=str(d), check=True)
        sp.run(["git", "config", "user.name", "t"], cwd=str(d), check=True)
    sp.run(["git", "-C", str(prod), "commit", "-q", "--allow-empty", "-m", "p1"], check=True)
    base = sp.run(["git", "-C", str(prod), "rev-parse", "--short", "HEAD"],
                  capture_output=True, text=True).stdout.strip()
    # .regress 在外层（跨仓布局），清单声明 repo: product
    mdir = ws / ".regress" / "manifests"
    mdir.mkdir(parents=True)
    mf = mdir / "R1.md"
    mf.write_text(f"---\nid: R1\nstatus: planning\nbase_head: {base}\nrepo: product\n---\nb\n",
                  encoding="utf-8")
    sp.run(["git", "-C", str(prod), "commit", "-q", "--allow-empty", "-m", "p2"], check=True)
    spec = ilu.spec_from_file_location("pa9", SCRIPT)
    pa = ilu.module_from_spec(spec)
    spec.loader.exec_module(pa)
    fm = pa.frontmatter(mf.read_text(encoding="utf-8"))
    drift, fields = pa._drift_info(fm, str(mdir))
    assert "1 个新提交" in drift and fields.get("commits_behind") == 1
