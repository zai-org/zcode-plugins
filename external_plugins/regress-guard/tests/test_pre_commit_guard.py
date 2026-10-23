"""pre_commit_guard.py 主流程的端到端测试。

历史上 4 个 bug 都出在这个文件（||吞输出、completed终态、monorepo路径、
no_active_manifest不记录），却没有单元测试。本文件把手工验证固化为可回归。
"""
import sys
import os
import json
import subprocess
import pytest

GUARD = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "hooks", "scripts", "pre_commit_guard.py"))


def run_guard(tool_command, project_dir, cwd=None, extra_env=None):
    """运行 guard，返回 (exit_code, stderr, stdout)。

    会话变量默认剥离（v1.34 活体标本：门禁复验在钩子 env 下跑 pytest，
    CLAUDE/ZCODE_SESSION_ID 泄漏进"无会话"用例→共享语义断言翻车）——
    需要会话身份的用例经 extra_env 显式注入，密封由构造保证。"""
    env = dict(os.environ)
    env.pop("CLAUDE_SESSION_ID", None)
    env.pop("ZCODE_SESSION_ID", None)
    env["CLAUDE_PROJECT_DIR"] = str(project_dir)
    env.update(extra_env or {})
    inp = json.dumps({"tool_name": "Bash", "tool_input": {"command": tool_command}})
    proc = subprocess.run(
        ["python3", GUARD],
        input=inp, capture_output=True, text=True,
        env=env, cwd=str(cwd or project_dir), timeout=30
    )
    return proc.returncode, proc.stderr, proc.stdout


@pytest.fixture
def project(tmp_path):
    """标准测试项目：git 仓库 + .regress + 活跃清单。"""
    import subprocess as sp
    p = tmp_path / "proj"
    p.mkdir()
    sp.run(["git", "init", "-q"], cwd=str(p), check=True)
    sp.run(["git", "config", "user.email", "t@t.com"], cwd=str(p), check=True)
    sp.run(["git", "config", "user.name", "t"], cwd=str(p), check=True)
    (p / "src").mkdir()
    (p / "src" / "app.js").write_text("x = 1\n")
    sp.run(["git", "add", "-A"], cwd=str(p), check=True)
    sp.run(["git", "commit", "-q", "-m", "init"], cwd=str(p), check=True)

    rg = p / ".regress"
    (rg / "manifests").mkdir(parents=True)
    (rg / "config.json").write_text('{"strict": true}')
    (rg / "manifests" / "R1.md").write_text(
        "---\nid: R1\nstatus: in-progress\nrollback: git revert 即回滚\n"
        "planned_changes: []\nactual_changes: []\n---\n"
    )
    return p


def read_history(project):
    events = []
    hf = project / ".regress" / "history.jsonl"
    if hf.exists():
        for line in hf.read_text().splitlines():
            if line.strip():
                events.append(json.loads(line))
    return events


# ─── 场景：命令识别 ────────────────────────────────────

def test_non_commit_command_passes(project):
    """非 git commit 命令直接放行，不记录。"""
    code, err, _ = run_guard("ls -la", project)
    assert code == 0
    assert read_history(project) == []


def test_commit_via_npm_version_detected(project):
    """npm version 会自动 commit，必须被识别为提交类命令。"""
    code, err, _ = run_guard("npm version patch", project)
    # 无测试运行器 + 清单非终态 → 阻断（说明被识别到了）
    assert code == 2
    assert "测试运行器" in err or "未检测到" in err


# ─── 场景：fail-safe ──────────────────────────────────

def test_corrupt_config_blocks(project):
    """config.json 损坏 → fail-safe 阻断。"""
    (project / ".regress" / "config.json").write_text("not json")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2
    assert "config.json" in err


def test_corrupt_manifest_blocks(project):
    """清单格式损坏（无 frontmatter）→ fail-safe 阻断。"""
    (project / ".regress" / "manifests" / "R1.md").write_text("不是合法的清单")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2
    assert "清单" in err or "frontmatter" in err


# ─── 场景：F3 拦截与终态放行 ────────────────────────────

def test_untracked_file_blocks_and_records(project):
    """staged 文件不在清单 → 阻断 + 记录 untracked_files。"""
    import subprocess as sp
    (project / "src" / "rogue.js").write_text("y = 2\n")
    sp.run(["git", "add", "-A"], cwd=str(project), check=True)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2
    assert "rogue.js" in err
    events = read_history(project)
    assert any(e["event"] == "commit_blocked"
               and e.get("reason") == "untracked_files" for e in events)


def test_terminal_status_passes_without_runner(project):
    """清单 status=done 且无测试运行器 → 放行 + 记录。"""
    (project / ".regress" / "manifests" / "R1.md").write_text(
        "---\nid: R1\nstatus: done\nplanned_changes: []\n---\n"
    )
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0
    events = read_history(project)
    assert any(e["event"] == "commit_passed" for e in events)


def test_completed_is_terminal(project):
    """completed 与 done 同为终态（历史 bug 回归测试）。"""
    (project / ".regress" / "manifests" / "R1.md").write_text(
        "---\nid: R1\nstatus: completed\nplanned_changes: []\n---\n"
    )
    code, _, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0


# ─── 场景：monorepo 向上查找（历史 bug 回归）────────────

def test_monorepo_finds_parent_regress(project, tmp_path):
    """git 仓库在子目录、.regress 在父目录 → 仍能找到。"""
    parent = tmp_path / "monorepo"
    parent.mkdir()
    rg = parent / ".regress"
    (rg / "manifests").mkdir(parents=True)
    (rg / "config.json").write_text('{"strict": true}')
    (rg / "manifests" / "R1.md").write_text(
        "---\nid: R1\nstatus: in-progress\nplanned_changes: []\n---\n"
    )
    # 把 git 项目移进 monorepo 子目录
    sub = parent / "server"
    sub.mkdir()
    import subprocess as sp, shutil
    for item in os.listdir(project):
        shutil.move(str(project / item), str(sub / item))

    code, err, _ = run_guard("git commit -m 改动（R1）", parent, cwd=sub)
    # 找到了清单（in-progress 无 runner）→ 阻断，证明 monorepo 查找成功
    assert code == 2
    assert read_history(parent), "history 应记录到父目录的 .regress"


def test_no_regress_dir_passes(tmp_path):
    """无 .regress/ 的项目 → 放行（不强制未接入项目）。"""
    code, _, _ = run_guard("git commit -m 改动（R1）", tmp_path)
    assert code == 0


# ─── 场景：证据链锚点 ─────────────────────────────────

def test_commit_event_has_anchors(project):
    """放行事件必须含 session_id 证据锚点。"""
    (project / ".regress" / "manifests" / "R1.md").write_text(
        "---\nid: R1\nstatus: done\nplanned_changes: []\n---\n"
    )
    code, _, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0
    events = read_history(project)
    passed = [e for e in events if e["event"] == "commit_passed"]
    assert passed and "session_id" in passed[0]


def test_invented_status_not_active(project):
    """语义反转回归：AI 自造 status（analysis-done）不算活跃，不卡提交。"""
    (project / ".regress" / "manifests" / "R1.md").write_text(
        "---\nid: R1\nstatus: analysis-done\nplanned_changes: []\n---\n"
    )
    code, _, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0
    events = read_history(project)
    assert any(e.get("note") == "no_active_manifest" for e in events)


def test_active_manifest_blocks_without_runner(project):
    """明确活跃清单 + 无 runner → 阻断（而非旧的终态表误放行/误卡）。"""
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)  # project 清单是 in-progress
    assert code == 2 and ("测试运行器" in err or "未检测到" in err)


# ─── 场景：会话作用域（v1.34）────────────────────────────

FOREIGN_SID = "sess-foreign-0001"
MY_SID = "sess-mine-00002"


def _stamp(project, mid, session):
    """给清单盖 session 戳（模拟 plan_approve 的转写）。"""
    mf = project / ".regress" / "manifests" / f"{mid}.md"
    text = mf.read_text()
    mf.write_text(text.replace("status:", f"session: {session}\nstatus:", 1))


def test_foreign_manifest_does_not_block_my_commit(project):
    """标本1 根治：他人 in-progress 清单不再挡我的提交（不涉文件即放行+警示）。"""
    _stamp(project, "R1", FOREIGN_SID)
    code, err, _ = run_guard("git commit -m 改动（R1）", project,
                             extra_env={"CLAUDE_SESSION_ID": MY_SID})
    assert code == 0
    assert "不涉本次提交文件" in err  # emit_warn：放行但留痕
    assert any(e.get("note") == "foreign_active_manifest_untouched"
               for e in read_history(project))


def test_foreign_manifest_undeclared_files_no_clash(project):
    """他有清单但没声明这些文件（planned 空）→ staged 文件不算撞，放行。"""
    _stamp(project, "R1", FOREIGN_SID)
    (project / "src" / "app.js").write_text("x = 2\n")
    import subprocess as sp
    sp.run(["git", "add", "-A"], cwd=str(project), check=True)
    code, err, _ = run_guard("git commit -m 改动（R1）", project,
                             extra_env={"CLAUDE_SESSION_ID": MY_SID})
    assert code == 0  # 空清单无声明文件 → 不构成集成态冲突


def test_foreign_clash_with_declared_file_blocks(project):
    """他清单显式声明 src/app.js，我 staged 同一文件 → 跨会话冲突拦截。"""
    (project / ".regress" / "manifests" / "R1.md").write_text(
        "---\nid: R1\nstatus: in-progress\nsession: %s\n"
        "planned_changes:\n  - id: F1\n    file: src/app.js\n    type: method-logic\n"
        "actual_changes: []\n---\n" % FOREIGN_SID)
    (project / "src" / "app.js").write_text("x = 2\n")
    import subprocess as sp
    sp.run(["git", "add", "-A"], cwd=str(project), check=True)
    code, err, _ = run_guard("git commit -m 改动（R1）", project,
                             extra_env={"CLAUDE_SESSION_ID": MY_SID})
    assert code == 2 and "跨会话" in err and "src/app.js" in err
    assert any(e.get("reason") == "cross_session_clash"
               for e in read_history(project))


def test_own_manifest_governs_despite_foreign(project):
    """我有清单 + 他有清单：按我的清单走（撞他文件才拦）——选择器不再拿别人清单。"""
    _stamp(project, "R1", FOREIGN_SID)  # R1 是他的
    (project / ".regress" / "manifests" / "R2.md").write_text(
        "---\nid: R2\nstatus: in-progress\nsession: %s\n"
        "rollback: git revert 即回滚\nplanned_changes: []\n"
        "actual_changes: []\n---\n" % MY_SID)
    code, err, _ = run_guard("git commit -m 改动（R1）", project,
                             extra_env={"CLAUDE_SESSION_ID": MY_SID})
    # 选中我的 R2（空清单无脆弱点）→ 走到无 runner 阻断，而不是被 R1 挡
    assert code == 2 and ("测试运行器" in err or "未检测到" in err)


def test_no_session_env_shares_all(project):
    """env 缺失（老钩子环境）：全部视为 mine——fail-safe 老行为不回退。"""
    _stamp(project, "R1", FOREIGN_SID)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)  # 无会话 env
    assert code == 2 and ("测试运行器" in err or "未检测到" in err)


# ─── P0-1：fail-closed 行为锁（评审批次一） ──────────────

def test_non_utf8_manifest_blocks(project):
    """非 UTF-8 清单 → 阻断（不崩溃放行）。

    旧行为：UnicodeDecodeError 穿透无保护循环 → exit 1 = 放行
    （2026-09-08 评审 P0 活体路径）。修复后 errors="replace" 读入：
    替换字符若废掉关键字段 → 解析失败分支阻断；若只是注解位脏 →
    清单照常激活走正常门禁流（本用例 status 行完好 → no runner 阻断）。
    断言锁的是 fail-closed 契约：绝不 exit 0/1。"""
    (project / ".regress" / "manifests" / "R1.md").write_bytes(
        b"---\nid: R1\nstatus: in-progress\nnote: \xff\xfe\n---\nbody")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2, f"非 UTF-8 清单必须阻断（exit 2），得 {code}"


def test_garbage_yaml_manifest_blocks(project):
    """坏 YAML（手写 fallback 也拿不到任何字段）→ 阻断。

    旧行为：fallback 返回 {} 非 None → 判"无活跃清单"静默放行，
    与 fail-safe 注释方向相反。"""
    (project / ".regress" / "manifests" / "R1.md").write_text(
        "---\n: : : 乱写一气\n!@#$ 没有 id 也没有 status\n---\nbody")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2


# ─── P1#5：blocked 推送接线（评审批次二） ─────────────────

def test_blocked_pushes_via_configured_channel(project, tmp_path, monkeypatch):
    """门禁阻断 → notify blocked 事件真发出（评审病例：history 6 个 blocked
    期间 wecom 台账 0 条——record 只留本机痕，通道才是人所在的屏）。
    v1.68 起通道走机器级配置（项目级 channels 受 057 信任门约束，子进程
    测试无法 monkeypatch 模块属性——机器级本就是人写配置设计即信任）。"""
    import stat as _stat
    stub = tmp_path / "stub.sh"
    marker = tmp_path / "blocked-marker"
    stub.write_text("#!/bin/sh\necho \"$@\" >> " + str(marker) + "\n", encoding="utf-8")
    stub.chmod(_stat.S_IRWXU)
    mach = tmp_path / "machine.json"
    mach.write_text(json.dumps(
        {"notify": {"channels": [str(stub) + " {title}"]}}), encoding="utf-8")
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)  # no-runner 阻断路径
    assert code == 2
    out = marker.read_text(encoding="utf-8")
    assert "提交被拦" in out and "R1" in out  # 带清单号的 blocked 推送落标


# ─── v1.40 全貌层两规则（REGRESS-2026-029） ──────────────

_M_FULL = """---
id: R1
status: in-progress
tier: M
rollback: git revert 即回滚
understood_intent:
  复述: "补全貌层"
  边界: "做门禁规则；不做语法解析器"
  判据: "验收第1条"
scan:
  entry: "门禁 main 4.5 节"
  test: "pytest -q"
  card: "钩子拦截链"
planned_changes:
  - id: F1
    file: "src/app.js"
    type: method-logic
actual_changes: []
---
"""


def _write_manifest(project, body):
    (project / ".regress" / "manifests" / "R1.md").write_text(body, encoding="utf-8")


def _stage(project, rel, content=None):
    p = project / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    if content is not None:
        p.write_text(content, encoding="utf-8")
    import subprocess as sp
    sp.run(["git", "add", rel], cwd=str(project), check=True)


def test_ml_missing_scan_blocks(project):
    """规则A：M 档缺 scan 三行 → 拦（对标 spec-first：理解是强制产物）。"""
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)  # 夹具 R1 无 tier/scan
    # 夹具清单无 tier → 规则A 豁免——先验豁免再验真拦
    _write_manifest(project, "---\nid: R1\nstatus: in-progress\ntier: M\n"
                             "planned_changes: []\nactual_changes: []\n---\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "全貌产物" in err and "scan 三行" in err
    assert any(e.get("reason") == "scan_missing" for e in read_history(project))


def test_scan_placeholder_rejected(project):
    """规则A防绕：占位值（{{}}）不算填过（顾问补强）。"""
    body = _M_FULL.replace('entry: "门禁 main 4.5 节"', 'entry: "{{入口}}"')
    _write_manifest(project, body)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "全貌产物" in err


def test_ml_with_scan_passes_rule_a(project):
    """规则A 齐备 → 不因全貌拦（后续无 runner 拦是另一件事）。"""
    _write_manifest(project, _M_FULL)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "全貌产物" not in err  # 规则A 放行


def test_s_tier_exempt_from_rule_a(project):
    """S 档轻量合法：不背全貌仪式（规则A 仅 M/L）。"""
    _write_manifest(project, "---\nid: R1\nstatus: in-progress\ntier: S\n"
                             "planned_changes: []\nactual_changes: []\n---\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "全貌产物" not in err


def test_structural_change_without_card_sync_blocks(project):
    """规则B（028 标本回放）：新增模块文件 + 卡片在盘但未随同 staged → 拦。
    S 档也拦——结构变更本就不是轻量内部（顾问修正）。"""
    _write_manifest(project, "---\nid: R1\nstatus: in-progress\ntier: S\n"
                             "planned_changes: []\nactual_changes: []\n---\n")
    (project / ".regress" / "product-arch.md").write_text("# 卡\n", encoding="utf-8")
    _stage(project, "src/bridge.py", "x = 1\n")  # 结构性新增，卡片未 staged
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "卡片未同步" in err
    assert any(e.get("reason") == "card_stale" for e in read_history(project))


def test_structural_change_with_card_staged_passes_rule_b(project):
    """卡片随同 staged → 规则B 放行（后续拦是别的检查）。"""
    _write_manifest(project, _M_FULL)
    _stage(project, ".regress/product-arch.md", "# 卡\n")
    _stage(project, "src/app.js", "x = 2\n")  # 修改已有文件不触发 AD
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "卡片未同步" not in err


def test_card_sync_false_exempts(project):
    """显式豁免位：scan.card_sync: false + 理由 → 规则B 不拦。"""
    body = _M_FULL.replace('card: "钩子拦截链"',
                           'card: "无"\n  card_sync: false')
    _write_manifest(project, body)
    (project / ".regress" / "product-arch.md").write_text("# 卡\n", encoding="utf-8")
    _stage(project, "src/scaffold.py", "t = 1\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "卡片未同步" not in err


def test_metadata_adds_do_not_trigger_rule_b(project):
    """tests/docs/md 是模块元数据不是模块——新增它们不触发规则B（顾问路径豁免）。"""
    _write_manifest(project, _M_FULL)
    (project / ".regress" / "product-arch.md").write_text("# 卡\n", encoding="utf-8")
    _stage(project, "tests/t.py", "def test_t(): pass\n")
    _stage(project, "docs/guide.md", "# g\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "卡片未同步" not in err


def test_no_card_project_structural_warns(project):
    """无卡片盲区（顾问补强）：结构性变更不拦，但警示留痕建议 init 产品层。"""
    _write_manifest(project, _M_FULL)  # 不写 product-arch.md
    _stage(project, "src/newmod.py", "n = 1\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "卡片未同步" not in err  # 不拦
    assert "无模块卡片" in err       # 但警示（stderr）
    assert any(e.get("note") == "structural_change_without_cards"
               for e in read_history(project))


# ─── v1.41 收官两规则（REGRESS-2026-030：触发表激活，防空转）─────

def test_rollback_missing_blocks_all_tiers(project):
    """rollback 全档必填（能力断言+引信）：清单无 rollback → 拦。"""
    _write_manifest(project, "---\nid: R1\nstatus: in-progress\n"
                             "planned_changes: []\nactual_changes: []\n---\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "缺 rollback" in err
    assert any(e.get("part") == "rollback" and e.get("reason") == "finish_missing"
               for e in read_history(project))


def test_rollback_default_invalid_on_escape_surface(project):
    """触发表收窄：staged 触及迁移路径/破坏性 SQL 而仍是默认 → 拦。"""
    _write_manifest(project, _M_FULL)
    _stage(project, "db/migrations/001.sql", "DROP TABLE users;\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "逃逸面" in err


def test_rollback_specific_answer_passes_escape(project):
    """真回滚路径（提数据怎么回/迁移怎么退）→ 默认失效规则放行。"""
    body = _M_FULL.replace(
        "rollback: git revert 即回滚",
        "rollback: 备份点 2026-09-16 恢复 + 001_down.sql 回退 schema")
    _write_manifest(project, body)
    _stage(project, "db/migrations/001.sql", "DROP TABLE users;\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "逃逸面" not in err


def test_self_review_planned_outside_key_required(project):
    """触发表：actual_changes 非空 → 计划外键必在；补键（值=无）即放行。"""
    body = _M_FULL.replace(
        "actual_changes: []",
        'actual_changes:\n  - id: F3\n    file: "src/extra.py"\n    type: from-diff')
    _write_manifest(project, body)
    _stage(project, "src/app.js", "x = 2\n")  # 修改非 AD，不触规则B
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "计划外" in err and "self_review" in err
    body2 = body.replace("actual_changes:",
                         'self_review:\n  计划外: "无"\nactual_changes:')
    _write_manifest(project, body2)
    code2, err2, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "self_review" not in err2


def test_self_review_debug_residue_key_required(project):
    """触发表：diff 命中调试模式且非 tests/ → 调试残留键必在；补键放行。"""
    _write_manifest(project, _M_FULL)
    _stage(project, "src/app.js", "console.log('probe x=1')\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "调试残留" in err
    body2 = _M_FULL.replace(
        "actual_changes: []",
        'self_review:\n  调试残留: "console.log 是必要输出，已逐处确认"\n'
        "actual_changes: []")
    _write_manifest(project, body2)
    code2, err2, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "调试残留" not in err2


def test_debug_pattern_in_tests_not_triggered(project):
    """tests/ 内的调试模式是测试常态——不触发键（路径豁免防误拦）。"""
    _write_manifest(project, _M_FULL)
    _stage(project, "tests/t.py", "console.log('in test ok')\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "调试残留" not in err


def test_no_trigger_keys_absent_legal(project):
    """无触发 → 键不出现合法（不适用≠无——防空转的根：混装堵死）。"""
    _write_manifest(project, _M_FULL)
    _stage(project, "src/app.js", "x = 2\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "self_review" not in err and "缺 rollback" not in err


# ─── v1.42 供应链层（REGRESS-2026-031：secrets 门禁 + deps 审计）─────

def test_secret_leak_blocks(project):
    """staged 新增行含 AWS key 样串 → 拦（值运行时拼接，源码无完整字面量）。"""
    _write_manifest(project, _M_FULL)
    _stage(project, "src/env.js", "key = '" + "AKIA" + "ABCDEFGHIJKLMNOP" + "'\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "密钥泄漏" in err
    assert any(e.get("reason") == "secret_leak" for e in read_history(project))


def test_secret_clean_passes_rule(project):
    _write_manifest(project, _M_FULL)
    _stage(project, "src/app.js", "const x = 1;\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "密钥泄漏" not in err


def test_deps_vulnerable_blocks_via_stub(project, tmp_path):
    """npm audit 桩报 high → 拦（解析 --json 漏洞计数，不信 exit code）。"""
    import stat as _stat
    _write_manifest(project, _M_FULL)
    bindir = tmp_path / "bin"
    bindir.mkdir()
    npm = bindir / "npm"
    npm.write_text('#!/bin/sh\necho \'{"metadata":{"vulnerabilities":'
                   '{"high":2,"critical":1,"total":3}}}\'\n', encoding="utf-8")
    npm.chmod(_stat.S_IRWXU)
    _stage(project, "package-lock.json", '{"lockfileVersion": 3}\n')
    code, err, _ = run_guard("git commit -m 改动（R1）", project, extra_env={
        "PATH": f"{bindir}:{os.environ['PATH']}"})
    assert code == 2 and "已知漏洞" in err
    assert any(e.get("reason") == "deps_vulnerable" for e in read_history(project))


def test_deps_infra_fail_warns_and_passes_rule(project):
    """工具缺失（RG_NPM_CMD 指向不存在）→ infra fail-open：warn+留痕，不拦。"""
    _write_manifest(project, _M_FULL)
    _stage(project, "package-lock.json", '{"lockfileVersion": 3}\n')
    code, err, _ = run_guard("git commit -m 改动（R1）", project, extra_env={
        "RG_NPM_CMD": "/nonexistent/npm-audit-probe"})
    assert "已知漏洞" not in err
    assert "npm audit 未完成" in err
    assert any(e.get("note") == "deps_audit_infra_fail"
               for e in read_history(project))


def test_supply_chain_secrets_disabled(project):
    """降级通道：config supply_chain.secrets=false → 泄漏串放行本规则。"""
    (project / ".regress" / "config.json").write_text(
        json.dumps({"strict": True, "supply_chain": {"secrets": False}}),
        encoding="utf-8")
    _write_manifest(project, _M_FULL)
    _stage(project, "src/env.js", "key = '" + "AKIA" + "ABCDEFGHIJKLMNOP" + "'\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "密钥泄漏" not in err


# ─── v1.54 拦截现场召回（B2：骨架库接进失败现场） ────────────────

_LEDGER_SIG = {"k1": {"sig": "scan 三行缺失 M 档全貌产物没写", "captured_at": "2026-09-01",
                      "last_hit": "2026-09-10", "hits": 3, "occurrences": 5}}


def _write_ledger(project, data):
    (project / ".regress" / "rules-ledger.json").write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8")


def test_block_recall_shows_history_rules(project):
    """scan_missing 拦截现场附带召回段（≤3 条）+ rule_recall 落账。"""
    _write_manifest(project, "---\nid: R1\nstatus: in-progress\ntier: M\n"
                             "planned_changes: []\nactual_changes: []\n---\n")
    _write_ledger(project, _LEDGER_SIG)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "全貌产物" in err
    assert "📚 相关历史规律" in err and "scan 三行缺失" in err
    assert err.count("命中×") <= 3  # TOP-3 封顶（stderr 防稀释）
    assert any(e.get("event") == "rule_recall" and e.get("reason") == "scan_missing"
               for e in read_history(project))


def test_block_recall_off_switch(project):
    """RG_RECALL=off 一键关：同场景无召回段（召回是增强不是依赖）。"""
    _write_manifest(project, "---\nid: R1\nstatus: in-progress\ntier: M\n"
                             "planned_changes: []\nactual_changes: []\n---\n")
    _write_ledger(project, _LEDGER_SIG)
    code, err, _ = run_guard("git commit -m 改动（R1）", project, extra_env={"RG_RECALL": "off"})
    assert code == 2 and "📚" not in err


def test_block_recall_not_wired_reason(project):
    """未接线拦截点（untracked_files）不召回——选择性接线，不是万物都挂。"""
    _write_ledger(project, {"k2": {"sig": "staged 文件不在回归清单中漏 track",
                                   "captured_at": "2026-09-01",
                                   "last_hit": "2026-09-05", "hits": 2, "occurrences": 3}})
    _stage(project, "src/extra.js", "y = 1\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "不在回归清单" in err and "📚" not in err
    # v1.59：拦截事件盖 guard_version（谁在把关，事后可查——044 病例）
    assert any(e.get("event") == "commit_blocked" and str(e.get("guard_version") or "")
               not in ("", "None") for e in read_history(project))


def test_block_recall_corrupt_ledger_degrades(project):
    """账本坏 JSON：门禁照常拦（召回链路静默降级，不拖垮门禁）。"""
    _write_manifest(project, "---\nid: R1\nstatus: in-progress\ntier: M\n"
                             "planned_changes: []\nactual_changes: []\n---\n")
    (project / ".regress" / "rules-ledger.json").write_text("{不是json", encoding="utf-8")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "全貌产物" in err and "📚" not in err


# ─── v1.55 验收入环（B3：EARS 验收从纸面进环） ────────────────

def _passing_runner(project):
    """给 tmp 项目造 pytest runner + 一个必过用例（reach 6 节 pass 分支）。"""
    (project / "pytest.ini").write_text("[pytest]\n", encoding="utf-8")
    (project / "test_smoke.py").write_text("def test_ok():\n    assert True\n",
                                           encoding="utf-8")


_M_ACC_BODY = "\n## 验收标准（EARS-lite）\n\n- When 发起请求，则 返回 200（验：curl -sf localhost:8000/health）\n"

# 121：公共深查节（M 档 done 盖章走到 6.5b 的用例统一自带；未勾用例在
# acceptance_open 先拦，不受影响）
_DC_OK = ("\n## 深查节\n"
          "- 反问一·验证位错位：门禁与清单读同一文件无错位\n"
          "- 反问二·判据外推：消息措辞可抄性无断言接受\n"
          "- 反问三·心虚探测：解析鲁棒性未穷举接受\n")
_M_ACC_BODY += _DC_OK


def test_acceptance_missing_blocks(project):
    """M 档缺验收标准节：测试全绿也不许盖章（acceptance_missing）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL)  # 有 scan 三件，规则A 过；无验收节
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "验收标准" in err
    assert any(e.get("reason") == "acceptance_missing" for e in read_history(project))


def test_acceptance_open_blocks(project):
    """M 档验收 EARS 行未勾（行尾无 ✅）：拦（acceptance_open）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _M_ACC_BODY)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "验收未勾" in err
    assert any(e.get("reason") == "acceptance_open" for e in read_history(project))


def test_acceptance_placeholder_blocks(project):
    """占位行（{{}}）= 没写：拦。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL +
                    "\n## 验收标准\n\n- When {{例：发起对讲}}，则 {{3s 内建流}}（验：{{human_check}}）\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "验收未勾" in err


def test_acceptance_all_checked_stamps_done(project):
    """M 档验收行全带 ✅ 且测试绿：盖章 done 放行（行尾标记+（验：）双全）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _M_ACC_BODY.replace(
        "（验：curl -sf localhost:8000/health）",
        "（验：python3 -m pytest test_smoke.py -q）✅"))
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err
    body = (project / ".regress" / "manifests" / "R1.md").read_text(encoding="utf-8")
    assert "status: done" in body and "test_verified_by: hook" in body
    # v1.60：通过也落账（拦截/通过频次比 = FP2 决策数据）
    assert any(e.get("event") == "acceptance_passed" and e.get("rows") == 1
               for e in read_history(project))


def test_acceptance_exempt_s_tier(project):
    """S 档轻量合法：无验收节照样盖章（豁免位与规则A 同构）。"""
    _passing_runner(project)
    _write_manifest(project, "---\nid: R1\nstatus: in-progress\ntier: S\n"
                             "rollback: git revert 即回滚\n"
                             "planned_changes: []\nactual_changes: []\n---\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err


def test_acceptance_two_line_bullet_joined(project):
    """两行式判据（- When… + 缩进（验：…）续行）合并成逻辑行再判：
    ✅ 在续行尾=已勾；无标记=未勾。live 清单的真实形态。"""
    _passing_runner(project)
    body = (_M_FULL + "\n## 验收标准\n\n"
            "- When 发起请求，则 返回 200\n"
            "  （验：python3 -m pytest test_smoke.py -q）\n"
            "- When 查健康，则 200\n"
            "  （验：python3 -m pytest test_smoke.py -q）✅\n")
    _write_manifest(project, body)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "验收未勾" in err and "1 行" in err  # 只第一行未勾


# ─── v1.71 待决自动回流（060：同清单过门禁即闭环） ────────────────

_M_ACC_PASS = ("\n## 验收标准（EARS-lite）\n\n"
               "- When 发起请求，则 返回 200（验：curl -sf localhost:8000/health）pass ✅\n")


def test_auto_reflow_pending_on_gate_pass(project, tmp_path, monkeypatch):
    """同清单过门禁 → 该 ref 未决 blocked 自动闭环；异 ref 不动（唯一策略）。"""
    led = tmp_path / "p.jsonl"
    monkeypatch.setenv("RG_PENDING_LEDGER", str(led))
    import importlib.util as ilu
    _L = os.path.abspath(os.path.join(
        os.path.dirname(__file__), "..", "hooks", "scripts", "lib"))
    spec = ilu.spec_from_file_location("pd-ar", os.path.join(_L, "pending.py"))
    pd = ilu.module_from_spec(spec); spec.loader.exec_module(pd)
    pd.add("P", "blocked", "⛔ 提交被拦 R1", ref="R1")
    pd.add("P", "blocked", "⛔ 提交被拦 R9", ref="R9")
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _M_ACC_PASS + _DC_OK)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0 and "自动回流 1 笔" in err
    s = pd.stats()
    assert s["auto_resolved"] == 1 and s["pending"] == 1  # R9 未被动


# ─── v1.73 验收解析宽松化（062：✅ 任意位置计勾） ────────────────

def test_acceptance_mark_anywhere_counts(project):
    """✅ 后拖文字（非行尾）计勾——056 两次被 endswith 咬的狗粮根治。"""
    _passing_runner(project)
    body = _M_FULL + (
        "\n## 验收标准（EARS-lite）\n\n"
        "- When 发起请求，则 返回 200（验：curl -sf localhost:8000/health）"
        "5/5 passed ✅\n" + _DC_OK)
    _write_manifest(project, body)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0  # 宽松化后计勾放行


def test_acceptance_mark_without_verify_still_blocks(project):
    """有 ✅ 但缺（验：命令）= 不完整判据，仍拦（防假勾）。"""
    _passing_runner(project)
    body = _M_FULL + (
        "\n## 验收标准（EARS-lite）\n\n"
        "- When 发起请求，则 返回 200 ✅ 好了\n")
    _write_manifest(project, body)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "验收未勾" in err


# ─── v1.85 测试结果缓存（074）────────────────────────

_ACC_OK = ("\n## 验收标准（EARS-lite）\n\n"
           "- When 发起请求，则 返回 200"
           "（验：python3 -m pytest test_smoke.py -q）✅\n"
           "\n## 深查节\n"  # 121：M 档 done 盖章用例公共自带（6.5b 在场性）
           "- 反问一·验证位错位：门禁与清单读同一文件无错位\n"
           "- 反问二·判据外推：消息措辞可抄性无断言接受\n"
           "- 反问三·心虚探测：解析鲁棒性未穷举接受\n")


def test_cache_hit_on_same_tree(project):
    """同树二次过门禁：跳全量（stderr ♻️）+事件 cached:true+cache_key 留痕。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    c1, e1, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert c1 == 0, e1
    assert "♻️" not in e1  # 首跑必是真跑
    _write_manifest(project, _M_FULL + _ACC_OK)  # 重置 done 戳（.regress 不入键）
    c2, e2, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert c2 == 0, e2
    assert "♻️" in e2
    cp = [e for e in read_history(project) if e.get("event") == "commit_passed"]
    assert cp[-1].get("cached") is True and cp[-1].get("cache_key")
    assert cp[0].get("cached") is not True


def test_cache_miss_after_tree_change(project):
    """树变更（未跟踪测试文件内容变）→ 键变 → 未命中照常全量。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    c1, e1, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert c1 == 0 and "♻️" not in e1
    _write_manifest(project, _M_FULL + _ACC_OK)
    (project / "test_smoke.py").write_text(
        "def test_ok():\n    assert 1 + 1 == 2\n", encoding="utf-8")
    c2, e2, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert c2 == 0 and "♻️" not in e2
    cp = [e for e in read_history(project) if e.get("event") == "commit_passed"]
    assert cp[-1].get("cached") is not True


def test_cache_env_off_bypasses(project, monkeypatch):
    """RG_TEST_CACHE=off：整体旁路，两次都真跑（行为同 v1.84）。"""
    monkeypatch.setenv("RG_TEST_CACHE", "off")
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    c1, e1, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert c1 == 0 and "♻️" not in e1
    _write_manifest(project, _M_FULL + _ACC_OK)
    c2, e2, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert c2 == 0 and "♻️" not in e2


# ─── v1.86.2 归因修复（088：run8 双标本根治）─────────

def _write_manifest_named(project, name, body):
    (project / ".regress" / "manifests" / name).write_text(body, encoding="utf-8")


def test_attribution_picks_intersecting_manifest(project):
    """双活跃清单各声明不同文件：归因落交集者，另一清单不动（旧 mine[0] 必错）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)  # R1 声明 src/app.js，验收全勾
    (project / "src" / "other.js").write_text("y = 1\n", encoding="utf-8")
    _write_manifest_named(project, "R2.md", _M_FULL.replace(
        "id: R1", "id: R2").replace('file: "src/app.js"', 'file: "src/other.js"'))
    _stage(project, "src/app.js", "x = 2\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err
    cp = [e for e in read_history(project) if e.get("event") == "commit_passed"
          and e.get("manifest_id")]
    assert cp[-1]["manifest_id"] == "R1"
    assert "status: done" in (project / ".regress" / "manifests" / "R1.md").read_text(
        encoding="utf-8")
    assert "in-progress" in (project / ".regress" / "manifests" / "R2.md").read_text(
        encoding="utf-8")
    assert any(e.get("event") == "note" and e.get("note") == "co_active"
               for e in read_history(project))


def test_planning_manifest_not_stamped(project):
    """planning（未临行）清单即使被归因也不接 done 盖章（084 标本兜底闸）。"""
    _passing_runner(project)
    body = ("---\nid: RP\nstatus: planning\ntier: S\nmode: quick\n"
            "rollback: git revert\nplanned_changes:\n  - id: F1\n    file: src/app.js\n"
            "actual_changes: []\n---\n")
    _write_manifest(project, body)
    _stage(project, "src/app.js", "x = 3\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err
    m = (project / ".regress" / "manifests" / "R1.md").read_text(encoding="utf-8")
    assert "status: planning" in m and "status: done" not in m
    assert any(e.get("event") == "note" and e.get("note") == "planning_not_stamped"
               for e in read_history(project))


def test_attribution_fallback_prefers_provisional(project):
    """无交集异常态：回退有 provisional 戳者（文件名倒序故意反排防旧序巧合）。"""
    _passing_runner(project)
    body_z = ("---\nid: ZC\nstatus: in-progress\ntier: S\nrollback: git revert\n"
              "planned_changes: []\nactual_changes: []\n---\n")
    body_a = ("---\nid: PD\nstatus: in-progress\ntier: S\n"
              "provisional:\n  at: '2026-09-21T00:00:00'\n  advisor: t\n"
              "rollback: git revert\nplanned_changes: []\n"
              "actual_changes:\n  - id: F1\n    file: src/app.js\n    note: x\n"
              "self_review:\n  计划外: 'src/app.js 计划外已看过'\n  调试残留: 无\n---\n")
    _write_manifest_named(project, "RZ.md", body_z)   # 文件名大=旧序 mine[0]
    _write_manifest_named(project, "RA.md", body_a)   # 有 provisional=新回退目标
    _stage(project, "src/app.js", "x = 9\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err
    cp = [e for e in read_history(project) if e.get("event") == "commit_passed"
          and e.get("manifest_id")]
    assert cp[-1]["manifest_id"] == "PD"


def test_attribution_nested_repo_staging(project, tmp_path):
    """嵌套仓拓扑（088 拓扑补）：子仓暂存可见，交集归因到声明子仓路径的清单。"""
    import subprocess as sp
    _passing_runner(project)
    sub = project / "nested"
    (sub / "src").mkdir(parents=True)
    sp.run(["git", "init", "-q"], cwd=str(sub), check=True)
    sp.run(["git", "config", "user.email", "t@t.com"], cwd=str(sub), check=True)
    sp.run(["git", "config", "user.name", "t"], cwd=str(sub), check=True)
    (sub / "src" / "n.js").write_text("n = 1\n", encoding="utf-8")
    sp.run(["git", "add", "-A"], cwd=str(sub), check=True)
    sp.run(["git", "commit", "-qm", "init"], cwd=str(sub), check=True)
    body = ("---\nid: RN\nstatus: in-progress\ntier: S\nrollback: git revert\n"
            "planned_changes:\n  - id: F1\n    file: src/n.js\n"
            "actual_changes: []\n---\n")
    _write_manifest_named(project, "RN.md", body)
    (sub / "src" / "n.js").write_text("n = 2\n", encoding="utf-8")
    sp.run(["git", "add", "-A"], cwd=str(sub), check=True)  # 子仓暂存（工作区仓无暂存）
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err
    cp = [e for e in read_history(project) if e.get("event") == "commit_passed"
          and e.get("manifest_id")]
    assert cp[-1]["manifest_id"] == "RN"


def test_attribution_generic_names_do_not_anchor(project, tmp_path):
    """103 相关性锚加固（run14 标本回放）：泛型双名（README+.gitignore）存在
    不构成相关——子仓陈旧暂存（src/math.js）不再混进 staged_list 拦工作区提交。"""
    import subprocess as sp
    _passing_runner(project)
    demo = project / "demo-project"
    (demo / "src").mkdir(parents=True)
    sp.run(["git", "init", "-q"], cwd=str(demo), check=True)
    sp.run(["git", "config", "user.email", "t@t.com"], cwd=str(demo), check=True)
    sp.run(["git", "config", "user.name", "t"], cwd=str(demo), check=True)
    (demo / "README.md").write_text("demo\n", encoding="utf-8")
    (demo / ".gitignore").write_text("x\n", encoding="utf-8")
    (demo / "src" / "math.js").write_text("m = 1\n", encoding="utf-8")
    sp.run(["git", "add", "-A"], cwd=str(demo), check=True)
    sp.run(["git", "commit", "-qm", "init"], cwd=str(demo), check=True)
    (demo / "src" / "math.js").write_text("m = 2\n", encoding="utf-8")
    sp.run(["git", "add", "-A"], cwd=str(demo), check=True)  # 陈旧暂存标本
    body = ("---\nid: RGEN\nstatus: in-progress\ntier: S\nrollback: git revert\n"
            "planned_changes:\n  - id: F1\n    file: README.md\n"
            "  - id: F2\n    file: .gitignore\n"
            "actual_changes: []\n---\n")
    _write_manifest_named(project, "RGEN.md", body)
    # 工作区零暂存：唯一可能的污染源=demo 陈旧暂存混入（修复前 math.js 会
    # 以未声明暂存身份拦下提交；修复后 demo 不相关→staged_list 空→放行）
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err


def test_attribution_staged_nongeneric_shallow_anchors(project, tmp_path):
    """103 C 析取：非泛型浅名恰为子仓当前暂存=暂存实配即相关（归因到声明清单）；
    README-only 因 C 护栏致盲是已接受稀有退化（FP1，fallback 兜底）。"""
    import subprocess as sp
    _passing_runner(project)
    sub = project / "tool"
    sub.mkdir(parents=True)
    sp.run(["git", "init", "-q"], cwd=str(sub), check=True)
    sp.run(["git", "config", "user.email", "t@t.com"], cwd=str(sub), check=True)
    sp.run(["git", "config", "user.name", "t"], cwd=str(sub), check=True)
    (sub / "setup.py").write_text("s = 1\n", encoding="utf-8")
    sp.run(["git", "add", "-A"], cwd=str(sub), check=True)
    sp.run(["git", "commit", "-qm", "init"], cwd=str(sub), check=True)
    (sub / "setup.py").write_text("s = 2\n", encoding="utf-8")
    sp.run(["git", "add", "-A"], cwd=str(sub), check=True)  # 恰为声明文件的暂存
    body = ("---\nid: RSH\nstatus: in-progress\ntier: S\nrollback: git revert\n"
            "planned_changes:\n  - id: F1\n    file: setup.py\n"
            "actual_changes: []\n---\n")
    _write_manifest_named(project, "RSH.md", body)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err
    cp = [e for e in read_history(project) if e.get("event") == "commit_passed"
          and e.get("manifest_id")]
    assert cp[-1]["manifest_id"] == "RSH"


# ─── v1.87 复合暂存+提交形态机器拦（091：077/088 标本收口）─────────

def test_compound_stage_commit_blocks(project):
    """同一命令串既暂存又提交：拦（reason=compound_stage_commit）+教学消息。"""
    code, err, _ = run_guard("git add src/app.js && git commit -m 改动（R1）", project)
    assert code == 2 and "复合" in err and "分立" in err
    assert any(e.get("event") == "commit_blocked"
               and e.get("reason") == "compound_stage_commit"
               for e in read_history(project))


def test_pure_commit_not_caught_by_compound_rule(project):
    """纯提交命令：不触发本规则（走正常管线——此处表现为常规放行/常规拦，非复合拦）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    code, err, _ = run_guard("cd somewhere && git commit -m 改动（R1）；1/1", project)
    assert code == 0, err
    assert not any(e.get("reason") == "compound_stage_commit"
                   for e in read_history(project))


def test_heredoc_payload_not_false_positive(project):
    """heredoc 体内的暂存字样是文档文本：不误拦。"""
    cmd = ("cat > note.md <<'EOF'\n文档示例：先 git add 再提交的说明文字\nEOF\n"
           "&& git commit -m 改动（R1）")
    code, err, _ = run_guard(cmd, project)
    assert "复合" not in err


def test_quoted_payload_not_false_positive(project):
    """引号载荷里的暂存字样：不误拦。"""
    code, err, _ = run_guard('echo "run git add first" && git commit -m 改动（R1）', project)
    assert "复合" not in err


def test_commit_am_flag_blocks(project):
    """提交旗标含 a（-am 自动暂存）：同属复合形态，拦。"""
    code, err, _ = run_guard("git commit -am x", project)
    assert code == 2 and "复合" in err


def test_commit_amend_exempt(project):
    """--amend 复用既有暂存非变更：豁免（不触发复合规则）。"""
    code, err, _ = run_guard("git commit --amend -m x", project)
    assert "复合" not in err


def test_split_calls_end_to_end_passes(project):
    """分立两调用端到端：先暂存调用（非提交命令，门禁直接放行）再提交调用走全管线。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    code1, _, _ = run_guard("git add src/app.js", project)
    assert code1 == 0  # 非提交命令：不触发门禁
    _stage(project, "src/app.js", "x = 42\n")  # 真实暂存（独立调用语义）
    code2, err2, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code2 == 0, err2


# ─── v1.87.1 提交信息三查（092：077 反谎报+溯源锚+尖括号）─────────

def test_message_no_ref_m_blocks(project):
    """M 档信息缺清单号（全 ID 与缩写均无）：拦 message_no_manifest_ref。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 2\n")
    code, err, _ = run_guard("git commit -m 改动说明", project)
    assert code == 2 and "清单号" in err
    assert any(e.get("event") == "commit_blocked"
               and e.get("reason") == "message_no_manifest_ref"
               for e in read_history(project))


def test_message_short_ref_passes(project):
    """缩写（R1）形态合法：放行（早查不拦，走全管线过）。
    v1.89.0（105）起 M 档须带行尾计数——「；1/1」=实测（单冒烟用例）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 3\n")
    code, err, _ = run_guard("git commit -m 改动（R1）说明；1/1", project)
    assert code == 0, err


def test_message_ml_no_count_blocks_105(project):
    """105 升硬位：M 档信息无任何 N/N 计数 → 拦 message_no_count_claim
    （沉默通过车道关闭——077 反谎报族的另一半）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 31\n")
    code, err, _ = run_guard("git commit -m 改动（R1）说明", project)
    assert code == 2 and "计数" in err
    assert any(e.get("event") == "commit_blocked"
               and e.get("reason") == "message_no_count_claim"
               for e in read_history(project))


def test_message_s_tier_no_count_passes_105(project):
    """S 档豁免：无计数放行（与清单号 S 豁免同构——轻量合法不破）。"""
    _passing_runner(project)
    body = ("---\nid: R1\nstatus: in-progress\ntier: S\nrollback: git revert\n"
            "planned_changes:\n  - id: F1\n    file: src/app.js\n"
            "actual_changes: []\n---\n")
    _write_manifest(project, body)
    _stage(project, "src/app.js", "x = 32\n")
    code, err, _ = run_guard("git commit -m 改动（R1）说明", project)
    assert code == 0, err


def test_message_revert_exempt_105(project):
    """Revert 前缀豁免：自动生成信息不因缺计数拦。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 33\n")
    code, err, _ = run_guard(
        'git commit -m "Revert 改动（R1）之前的提交"', project)
    assert code == 0, err


# ─── v1.90.1 载荷剥离进提交侦测（107：097 标本族根治）─────────

def test_heredoc_docwrite_not_gate_triggered(project):
    """heredoc 载荷含提交字样的文档写入：不触发门禁全量管线（097 标本
    ——heredoc 写测试代码曾触发全量跑+premature done 盖章）。"""
    code, err, _ = run_guard(
        "cat >> tests/doc.md << 'EOF'\n说明：跑 git commit -m 示例\nEOF",
        project)
    assert code == 0
    assert "正在运行测试" not in err  # 没进测试管线=真没触发


def test_heredoc_then_real_compound_still_caught(project):
    """正例：heredoc 体外真有 add+commit——门禁照触发、091 照拦。"""
    code, err, _ = run_guard(
        "cat >> d.md << 'EOF'\n文档内容 git commit 字样\nEOF\n"
        "git add d.md && git commit -m 改动（R1）", project)
    assert code == 2 and "复合" in err


# ─── v1.90.0 held-out 验收门接入（106：稳定性条件 1 补法）─────────

def test_heldout_skipped_for_docs_only(project):
    """文档批豁免：staged 不触 hooks/scripts → 束不跑（基线文件不出现
    =最硬的没跑证据）。"""
    _passing_runner(project)
    body = ("---\nid: R1\nstatus: in-progress\ntier: S\nrollback: git revert\n"
            "planned_changes:\n  - id: F1\n    file: README.md\n"
            "actual_changes: []\n---\n")
    _write_manifest(project, body)
    _stage(project, "README.md", "docs\n")
    code, err, _ = run_guard("git commit -m 改动（R1）", project)
    assert code == 0, err
    assert not (project / ".regress" / "heldout-baseline.json").exists()


def test_heldout_runs_for_hooks_touch(project):
    """触及 hooks/ 的批：束跑且首冻（基线出现+八场景全过）——真束 ~15s。"""
    _passing_runner(project)
    body = ("---\nid: R1\nstatus: in-progress\ntier: S\nrollback: git revert\n"
            "planned_changes:\n  - id: F1\n    file: hooks/x.py\n"
            "actual_changes: []\n---\n")
    _write_manifest(project, body)
    _stage(project, "hooks/x.py", "h = 1\n")
    code, err, _ = run_guard("git commit -m 改动（R1）", project)
    assert code == 0, err
    bp = project / ".regress" / "heldout-baseline.json"
    assert bp.exists()
    import json as _j
    data = _j.loads(bp.read_text(encoding="utf-8"))
    assert len(data["outcomes"]) == 14
    assert all(v == "pass" for v in data["outcomes"].values())


def test_message_count_mismatch_blocks_077_replay(project):
    """077 回放：行尾「；N/N」与实测不符 → 拦 message_count_mismatch。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 4\n")
    code, err, _ = run_guard("git commit -m 改动（R1）：宣称；5/5", project)
    assert code == 2 and "不符" in err
    assert any(e.get("event") == "commit_blocked"
               and e.get("reason") == "message_count_mismatch"
               for e in read_history(project))


def test_message_count_match_passes(project):
    """行尾「；1/1」与实测相符：放行。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 5\n")
    code, err, _ = run_guard("git commit -m 改动（R1）：x；1/1", project)
    assert code == 0, err


def test_message_unmarked_count_warns_only(project):
    """非行尾 N/N（作用域计数）：告警留痕不拦（090 场景不误伤）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 6\n")
    code, err, _ = run_guard('git commit -m "改动（R1）清单健康 59/59 中部"', project)
    assert code == 0, err
    assert any(e.get("event") == "note"
               and e.get("note") == "message_count_claim"
               for e in read_history(project))


def test_message_angle_bracket_blocks(project):
    """信息含尖括号：全档拦（运营实证：重定向误判+发布风险）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 7\n")
    code, err, _ = run_guard("git commit -m 改动（R1）含<x>形态", project)
    assert code == 2 and "尖括号" in err
    assert any(e.get("event") == "commit_blocked"
               and e.get("reason") == "message_angle_bracket"
               for e in read_history(project))


def test_message_checks_skip_no_manifest_lane(project):
    """无归因清单（done 终态）：三查全不触发——尖括号信息照常放行。"""
    _passing_runner(project)
    _write_manifest(project, "---\nid: R1\nstatus: done\ntier: M\nrollback: r\n"
                    "planned_changes: []\nactual_changes: []\n---\n")
    code, err, _ = run_guard("git commit -m 随便含<x>的信息", project)
    assert code == 0, err


def test_message_ref_with_note_m_passes(project):
    """（R1，附注）前缀形态 M 档放行（097：096 发布道活体的门禁侧同款）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 8\n")
    code, err, _ = run_guard('git commit -m "改动（R1，附注说明）x；1/1"', project)
    assert code == 0, err
    assert not any(e.get("reason") == "message_no_manifest_ref"
                   and e.get("event") == "commit_blocked"
                   for e in read_history(project))


# ─── 4.8 文档交付判据四件套（v1.92.6，117）──────────────

def _stage_final_doc(project, name, body, in_manifest=True):
    """造一个 staged 的定稿类/文档类 md，返回路径。"""
    import subprocess as sp
    d = project / "docs"
    d.mkdir(exist_ok=True)
    f = d / name
    f.write_text(body, encoding="utf-8")
    sp.run(["git", "add", str(f)], cwd=str(project), check=True)
    if in_manifest:
        (project / ".regress" / "manifests" / "R1.md").write_text(
            "---\nid: R1\nstatus: done\n"
            f"planned_changes: ['docs/{name}']\n---\n"
        )
    return f


_PAD = "正文内容行。\n" * 35  # ≥30 行新增


def test_docgate_blocks_final_doc_missing_all(project):
    """定稿类 md 四件全缺 → 拦（docgate_missing）。"""
    _stage_final_doc(project, "物联网卡-需求定稿-v1.md",
                     "# 需求\n" + _PAD)
    code, err, _ = run_guard("git commit -m 文档（R1）", project)
    assert code == 2, f"四件全缺应拦, exit={code}"
    assert "docgate" in err or "交付判据" in err


def test_docgate_passes_four_present(project):
    """f77a 形定稿（四件全有）→ 过 docgate 且整门禁放行。"""
    body = ("# 需求定稿\n" + _PAD
            + "\n## 验收要点\n1. 功能可用\n"
            + "\n## 附录 A：与原始需求稿的差异说明\n改了优先级\n"
            + "\n## 附录 B：厂商接口信息索引\n见接口文档\n"
            + "\n## 边界\n不做的事：存量回填\n")
    _stage_final_doc(project, "物联网卡-需求定稿-v1.md", body)
    code, err, _ = run_guard("git commit -m 文档（R1）", project)
    assert code == 0, f"四件全有应放行, exit={code}, err={err[-300:]}"


def test_docgate_two_present_no_required_blocks(project):
    """在场 2 件但必需件（验证节/一手来源）全缺 → 拦（顾问硬约束）。"""
    body = "# 方案\n" + _PAD + "\n附录：差异说明\n\n边界：不做回填\n"
    _stage_final_doc(project, "接入方案-需求定稿-v1.md", body)
    code, err, _ = run_guard("git commit -m 文档（R1）", project)
    assert code == 2
    assert "必需件" in err or "docgate" in err


def test_docgate_small_change_not_triggered(project):
    """定稿类 md 小改（新增行不足 30）→ 不触发（防错别字修改摩擦）。"""
    d = project / "docs"
    d.mkdir(exist_ok=True)
    f = d / "物联网卡-需求定稿-v1.md"
    # 先入库一版
    import subprocess as sp
    f.write_text("初始化基线\n" + _PAD, encoding="utf-8")
    sp.run(["git", "add", str(f)], cwd=str(project), check=True)
    sp.run(["git", "-c", "user.email=t@t.com", "-c", "user.name=t",
            "commit", "-q", "-m", "基线"], cwd=str(project), check=True)
    f.write_text("初始化基线改\n" + _PAD, encoding="utf-8")  # 新增 1 行
    sp.run(["git", "add", str(f)], cwd=str(project), check=True)
    (project / ".regress" / "manifests" / "R1.md").write_text(
        "---\nid: R1\nstatus: done\n"
        "planned_changes: ['docs/物联网卡-需求定稿-v1.md']\n---\n")
    code, err, _ = run_guard("git commit -m 文档（R1）", project)
    assert code == 0, f"小改不触发, exit={code}, err={err[-200:]}"


def test_docgate_env_escape(project):
    """四件全缺 + REGRESS_DOCGATE=off → 不因 docgate 拦。"""
    _stage_final_doc(project, "物联网卡-需求定稿-v1.md",
                     "# 需求\n" + _PAD)
    code, err, _ = run_guard("git commit -m 文档（R1）", project,
                             extra_env={"REGRESS_DOCGATE": "off"})
    assert "docgate" not in err and "交付判据" not in err


def test_docgate_non_final_outside_docs_not_triggered(project):
    """根目录大改 md（非定稿名且不在 docs/）→ 不触发（零误伤负例）。"""
    import subprocess as sp
    f = project / "NOTES.md"
    f.write_text("# 笔记\n" + _PAD, encoding="utf-8")
    sp.run(["git", "add", str(f)], cwd=str(project), check=True)
    (project / ".regress" / "manifests" / "R1.md").write_text(
        "---\nid: R1\nstatus: done\nplanned_changes: ['NOTES.md']\n---\n")
    code, err, _ = run_guard("git commit -m 笔记（R1）", project)
    assert code == 0, f"非定稿类不触发, exit={code}, err={err[-200:]}"


# ─── 6.5b 深查在场性（v1.93.0，121）──────────────────

_M_ACC_DONE = "\n## 验收标准（EARS-lite）\n\n- When x，则 y（验：echo ok）✅\n"

_DC_BODY = (
    "\n## 深查节\n"
    "- 反问一·验证位错位：门禁跑部署位而清单在项目位，读同一文件无错位\n"
    "- 反问二·判据外推：拦截消息三问原文可抄性靠措辞设计无断言\n"
    "- 反问三·心虚探测：解析对全角标点与黑名单外字符鲁棒性未穷举\n")


def test_deepcheck_missing_blocks(project):
    """M 档 done 盖章：验收全勾但缺深查节 → 拦（deepcheck_missing）。"""
    _passing_runner(project)
    _stage(project, "src/app.js", "x = 2\n")
    _write_manifest(project, _M_FULL + _M_ACC_DONE)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "深查" in err, f"缺深查应拦, exit={code}"
    assert any(e.get("reason") == "deepcheck_missing"
               for e in read_history(project))


def test_deepcheck_placeholder_answer_blocks(project):
    """深查节在场但反问三答案占位（N/A）→ 拦。"""
    _passing_runner(project)
    _stage(project, "src/app.js", "x = 2\n")
    _write_manifest(project, _M_FULL + _M_ACC_DONE + (
        "\n## 深查节\n"
        "- 反问一·验证位错位：门禁读清单同目录一致\n"
        "- 反问二·判据外推：消息措辞已覆盖\n"
        "- 反问三·心虚探测：N/A\n"))
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "占位" in err


def test_deepcheck_full_passes_gate(project):
    """三问各一行实答 → 深查通过（后续流程正常）。"""
    _passing_runner(project)
    _stage(project, "src/app.js", "x = 2\n")
    _write_manifest(project, _M_FULL + _M_ACC_DONE + _DC_BODY)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "深查" not in err, f"深查不应拦: {err[-200:]}"


def test_deepcheck_s_tier_exempt(project):
    """S 档无深查节 → 不拦（分层豁免）。"""
    _passing_runner(project)
    _stage(project, "src/app.js", "x = 2\n")
    _write_manifest(project, _M_FULL.replace("tier: M", "tier: S")
                    + _M_ACC_DONE)
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert "深查" not in err


# ─── v1.94.0（122）：2.9 纠正未处置留痕——record-only 环境级 ───

def _journal_correction(project, ts, kind="user_correction", **extra):
    jd = project / ".regress" / "journal"
    jd.mkdir(parents=True, exist_ok=True)
    ev = {"ts": ts, "kind": kind, "session": "s-test"}
    ev.update(extra)
    with open(jd / "events.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")


def test_correction_unreviewed_records_but_passes(project):
    """pending 纠正>0：history 落 correction_unreviewed + stderr 附注，但 exit 0
    （record-only——后续 held-out/验收/深查检查不得被短路）。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 2\n")
    _journal_correction(project, "2026-09-24T11:12:54", excerpt="每一个文档你都单独审查")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err
    assert any(e.get("event") == "correction_unreviewed"
               for e in read_history(project))
    assert "纠正" in err and "不拦" in err


def test_correction_loop_env_off(project):
    """逃生阀：RG_CORRECTION_LOOP=off 不留痕。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 3\n")
    _journal_correction(project, "2026-09-24T11:12:54", excerpt="x")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project,
                             extra_env={"RG_CORRECTION_LOOP": "off"})
    assert code == 0, err
    assert not any(e.get("event") == "correction_unreviewed"
                   for e in read_history(project))


def test_correction_loop_config_off(project):
    """逃生阀：config correction_loop.enabled=false 不留痕。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 4\n")
    _journal_correction(project, "2026-09-24T11:12:54", excerpt="x")
    cfg = project / ".regress" / "config.json"
    cfg.write_text('{"strict": true, "correction_loop": {"enabled": false}}',
                   encoding="utf-8")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err
    assert not any(e.get("event") == "correction_unreviewed"
                   for e in read_history(project))


def test_correction_acked_not_recorded(project):
    """处置后（高水位盖过纠正）不再留痕——闭环的清零半边。"""
    _passing_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 5\n")
    _journal_correction(project, "2026-09-24T11:12:54", excerpt="x")
    _journal_correction(project, "2026-09-24T11:30:00",
                        kind="correction_disposition",
                        how="advisor", upto="2026-09-24T11:30:00")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 0, err
    assert not any(e.get("event") == "correction_unreviewed"
                   for e in read_history(project))


# ─── v1.95.0（123）：跳过不算通过——分母收编+盖章拦截 ───

def _skipping_runner(project):
    """一个过+一个跳的 pytest 现场（外部评审实证洞的活体形态）。"""
    (project / "pytest.ini").write_text("[pytest]\n", encoding="utf-8")
    (project / "test_smoke.py").write_text(
        "import pytest\n"
        "def test_ok():\n    assert True\n"
        "@pytest.mark.skip(reason='batch123 specimen')\n"
        "def test_skip():\n    assert False\n",
        encoding="utf-8")


def test_skip_claimed_full_blocked_by_count(project):
    """『1 passed, 1 skipped』+ 行尾宣称『；1/1』→ 既有对账拦（实测 1/2）。"""
    _skipping_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 9\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/1", project)
    assert code == 2 and "1/2" in err  # 分母含 skipped 后对账天然拦


def test_done_with_skips_blocks(project):
    """计数诚实（；1/2）但 M 档盖章 done 时有 skipped → 拦（done_with_skips）。"""
    _skipping_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 10\n")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/2", project)
    assert code == 2 and "盖章 done 但套件存在 1 个 skipped" in err
    assert any(e.get("reason") == "done_with_skips" for e in read_history(project))
    assert "跳过不是通过" in err


def test_allow_skips_escape_passes(project):
    """逃生阀：config test_runner.allow_skips=true → 放行且留痕 skipped。"""
    _skipping_runner(project)
    _write_manifest(project, _M_FULL + _ACC_OK)
    _stage(project, "src/app.js", "x = 11\n")
    cfg = project / ".regress" / "config.json"
    cfg.write_text('{"strict": true, "test_runner": {"allow_skips": true}}',
                   encoding="utf-8")
    code, err, _ = run_guard("git commit -m 改动（R1）；1/2", project)
    assert code == 0, err
    assert "1 skipped" in err and "留痕" in err
    assert any(e.get("note") == "test_skipped_present" for e in read_history(project))


def test_s_tier_skip_note_only(project):
    """S 档：无行尾计数（豁免）→ skipped 只留痕不拦。"""
    _skipping_runner(project)
    _write_manifest(project, _M_FULL.replace("tier: M", "tier: S") + _ACC_OK)
    _stage(project, "src/app.js", "x = 12\n")
    code, err, _ = run_guard("git commit -m 改动（R1）", project)
    assert code == 0, err
    assert "skipped" in err  # 可见性注记在场
