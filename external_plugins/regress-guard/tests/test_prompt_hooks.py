"""prompt_intercept / reflection_check 行为测试。

覆盖三件事：
  1. 纠错检测——"自信地错"没有失败信号，用户纠正词是唯一探测器
  2. 摆渡包自组装——轮内失败 ≥3 时注入失败清单原文 + git diff --stat
  3. 卡死计数与纠错的互不干扰——纠正是实质输入，会重置催促计数
"""
import json
import os
import sys
import tempfile
from datetime import datetime

import pytest

SCRIPTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts"))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import prompt_intercept  # noqa: E402
import reflection_check  # noqa: E402
import fail_watch  # noqa: E402


@pytest.fixture
def isolated_tmp(monkeypatch, tmp_path):
    """把所有 /tmp 状态文件重定向到测试沙箱（hook 路径函数每次动态取 gettempdir）。"""
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    return tmp_path


# ── 1. 纠错检测 ──

def _correction_reminders(text):
    return [r for r in prompt_intercept.analyze_prompt(text) if "纠正" in r]


def test_correction_direction_wrong(isolated_tmp):
    rs = _correction_reminders("不对，你这个方案方向错了，重新想")
    assert len(rs) == 1
    assert "自信地错" in rs[0]
    assert "consult" in rs[0]


def test_correction_understanding_wrong(isolated_tmp):
    assert _correction_reminders("你理解错了，我说的是另一个文件") != []


def test_correction_english(isolated_tmp):
    assert _correction_reminders("wrong direction, try again") != []


def test_error_report_is_not_correction(isolated_tmp):
    """“报错了/出错了”是描述工具报错，不是纠正 AI 方向。"""
    assert _correction_reminders("程序运行报错了，看一下日志排查") == []
    assert _correction_reminders("刚才那条命令出错了") == []


def test_normal_request_no_correction(isolated_tmp):
    assert _correction_reminders("帮我把登录页的按钮改成蓝色，加个圆角") == []


# ── 2. 摆渡包自组装 ──

def _write_fails(n, sig="pnpm test"):
    path = fail_watch.state_path()
    with open(path, "w", encoding="utf-8") as f:
        for _ in range(n):
            f.write(json.dumps({
                "ts": datetime.now().isoformat(),
                "tool": "Bash",
                "sig": sig,
            }, ensure_ascii=False) + "\n")


def test_ferry_package_assembled(isolated_tmp, tmp_path):
    """>=3 次失败 → 注入含失败清单原文 + 摆渡指令，而非口头嘱咐。"""
    project = tmp_path / "proj"
    (project / ".regress").mkdir(parents=True)
    _write_fails(4, "pnpm install")
    reminders = reflection_check.check_context(str(project))
    assert reminders, "应产生摆渡注入"
    ferry = "\n".join(reminders)
    assert "失败清单" in ferry
    assert "pnpm install ×4" in ferry, "失败签名原文必须在场（禁止 AI 二次过滤）"
    assert "禁止原样重试" in ferry
    assert "摆渡" in ferry


def test_ferry_below_threshold_no_trigger(isolated_tmp, tmp_path):
    """2 次失败不触发（容忍偶发失败）。"""
    project = tmp_path / "proj"
    (project / ".regress").mkdir(parents=True)
    _write_fails(2)
    reminders = reflection_check.check_context(str(project))
    assert not reminders, "低于阈值不应有失败注入"


def test_ferry_no_regress_not_connected(isolated_tmp, tmp_path):
    """未接入 .regress 的项目：即使失败也不注入。"""
    _write_fails(5)
    assert reflection_check.check_context(str(tmp_path / "bare")) is None


def test_ferry_in_non_git_dir(isolated_tmp, tmp_path):
    """非 git 目录：diff 为空但不崩，失败清单仍摆渡。"""
    project = tmp_path / "proj"
    (project / ".regress").mkdir(parents=True)
    _write_fails(3)
    reminders = reflection_check.check_context(str(project))
    ferry = "\n".join(reminders)
    assert "失败清单" in ferry
    assert "git diff" not in ferry, "无 diff 时不应输出空的 diff 段"


# ── 3. 卡死计数 × 纠错互不干扰 ──

def test_correction_resets_prod_counter(isolated_tmp):
    """纠正是实质输入：重置催促计数，不会把纠正误判成卡死信号。"""
    assert prompt_intercept.analyze_prompt("继续") == []  # 第 1 次催促：n=1 不触发
    assert prompt_intercept.analyze_prompt("不对，方向错了") != []  # 纠正（含纠错注入）
    assert prompt_intercept.analyze_prompt("继续") == [], "计数被纠正重置，重新累计"


def test_prod_second_time_triggers_scout(isolated_tmp):
    """连续第 2 次无信息催促 → scout 注入（回归保护：本次改动不破坏旧逻辑）。"""
    assert prompt_intercept.analyze_prompt("继续") == []
    rs = prompt_intercept.analyze_prompt("继续")
    assert any("卡死检测" in r for r in rs)


def test_approval_delegation_not_counted_as_prod():
    """v1.29：授权语不算无信息催促（病例：连续"继续，自决策"误报卡死检测）。"""
    import importlib.util as ilu
    import os as _os
    src = _os.path.join(_os.path.dirname(__file__), "..", "hooks", "scripts",
                        "prompt_intercept.py")
    spec = ilu.spec_from_file_location("pi_v129", src)
    pi = ilu.module_from_spec(spec)
    spec.loader.exec_module(pi)
    assert pi.is_content_free_prod("继续，自决策") is False   # 授权语
    assert pi.is_content_free_prod("继续，直接做") is False
    assert pi.is_content_free_prod("继续") is True            # 真空催促仍计
    assert pi.is_content_free_prod("go") is True


# ─── v1.80（069）：UserPromptSubmit 治理上下文前置注入 ────────────────

import importlib.util as _ilu


def _pi():
    spec = _ilu.spec_from_file_location(
        "pi-gov", os.path.join(os.path.dirname(__file__), "..",
                               "hooks", "scripts", "prompt_intercept.py"))
    m = _ilu.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def _run_prompt(pi, monkeypatch, proj, text):
    import io, json as _json
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(proj))
    import pytest as _pytest
    with _pytest.raises(SystemExit) as e:
        pi.main.__globals__["sys"].stdin = io.StringIO(_json.dumps({"prompt": text}))
        import builtins
        real_input = builtins.input
        pi.main()
    return e.value.code


def test_governance_active_manifest_line(tmp_path, monkeypatch, capsys):
    proj = tmp_path / "proj"; (proj / ".regress" / "manifests").mkdir(parents=True)
    (proj / ".regress" / "manifests" / "R1.md").write_text(
        "---\nid: REGRESS-9\nstatus: in-progress\ntier: M\n---\n"
        "planned_changes:\n- id: F1\n- id: F2\n", encoding="utf-8")
    pi = _pi()
    import io, json as _json, pytest
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(proj))
    monkeypatch.setattr("sys.stdin", io.StringIO(_json.dumps({"prompt": "改一下登录逻辑"})))
    with pytest.raises(SystemExit):
        pi.main()
    out = capsys.readouterr().out
    assert "REGRESS-9" in out and "边界 2 文件" in out and "治理上下文" in out


def test_governance_no_manifest_silent(tmp_path, monkeypatch, capsys):
    proj = tmp_path / "proj"; (proj / ".regress").mkdir(parents=True)
    pi = _pi()
    import io, json as _json, pytest
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(proj))
    monkeypatch.setattr("sys.stdin", io.StringIO(_json.dumps({"prompt": "你好"})))
    with pytest.raises(SystemExit):
        pi.main()
    assert capsys.readouterr().out == ""


def test_governance_rule_recall_line(tmp_path):
    pi = _pi()
    (tmp_path / ".regress").mkdir(parents=True)
    (tmp_path / ".regress" / "rules-ledger.json").write_text(json.dumps(
        {"r1": {"id": "R1", "sig": "zsh pipefail 假绿 pytest 管道",
                "hits": 4, "last_hit": "2099-01-01"}}, ensure_ascii=False),
        encoding="utf-8")
    lines = pi._rule_recall_line(str(tmp_path), "zsh 下 pytest 管道假绿 pipefail 教训")
    assert lines and "相似规律" in lines[0]
    assert pi._rule_recall_line(str(tmp_path), "完全无关的天气话题") == []


def test_governance_recall_fires_measurement(tmp_path):
    """v1.88.2（101）量测位：召回命中（hits≥3）落 note rule_recall_fired——
    哨兵巡检二 watch 的首次开火从此有通道（此前 v1.80 结构性盲）。"""
    pi = _pi()
    (tmp_path / ".regress").mkdir(parents=True)
    (tmp_path / ".regress" / "rules-ledger.json").write_text(json.dumps(
        {"r1": {"id": "R1", "sig": "zsh pipefail 假绿 pytest 管道",
                "hits": 4, "last_hit": "2099-01-01"}}, ensure_ascii=False),
        encoding="utf-8")
    lines = pi._rule_recall_line(str(tmp_path), "zsh 下 pytest 管道假绿 pipefail 教训")
    assert lines
    hist = (tmp_path / ".regress" / "history.jsonl").read_text(encoding="utf-8")
    assert "rule_recall_fired" in hist and "zsh pipefail" in hist


def test_governance_recall_measurement_never_breaks(tmp_path, monkeypatch):
    """101 FP2：量测位在每轮热钩子内——record 炸了召回行必须照常返回。"""
    pi = _pi()
    (tmp_path / ".regress").mkdir(parents=True)
    (tmp_path / ".regress" / "rules-ledger.json").write_text(json.dumps(
        {"r1": {"id": "R1", "sig": "zsh pipefail 假绿 pytest 管道",
                "hits": 4, "last_hit": "2099-01-01"}}, ensure_ascii=False),
        encoding="utf-8")
    import history as _h

    def _boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(_h, "record", _boom)
    lines = pi._rule_recall_line(str(tmp_path), "zsh 下 pytest 管道假绿 pipefail 教训")
    assert lines and "相似规律" in lines[0]


def test_governance_off_escape(tmp_path, monkeypatch, capsys):
    proj = tmp_path / "proj"; (proj / ".regress" / "manifests").mkdir(parents=True)
    (proj / ".regress" / "manifests" / "R1.md").write_text(
        "---\nid: REGRESS-9\nstatus: in-progress\n---\n", encoding="utf-8")
    pi = _pi()
    import io, json as _json, pytest
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(proj))
    monkeypatch.setenv("RG_PROMPT_CONTEXT", "off")
    monkeypatch.setattr("sys.stdin", io.StringIO(_json.dumps({"prompt": "改进一下性能"})))
    with pytest.raises(SystemExit):
        pi.main()
    out = capsys.readouterr().out
    assert "治理上下文" not in out  # off 逃生：治理段不出（需求入口检查仍可出）


# ─── v1.94.0（122）：重任务无清单提醒 + 约束检测泛化防线 ───

def _heavy_reminders(rs):
    return [r for r in rs if "重任务" in r]


def _quiet_project(tmp_path):
    """有 .regress 但无活跃清单的项目。"""
    proj = tmp_path / "quiet"
    (proj / ".regress" / "manifests").mkdir(parents=True)
    return proj


def test_heavy_task_no_manifest_reminds_once(isolated_tmp, tmp_path, monkeypatch):
    """开源类重任务（无变更动词！）+无活跃清单 → 一行 M 档建议，同会话只提一次。

    0158a98b 标本原文即此形态——CHANGE_VERBS 门若不并联 HEAVY_TASK_RE，
    "我想把这个项目开源"会整个漏掉（批内修复的对应用例）。"""
    monkeypatch.setenv("ZCODE_PROJECT_DIR", str(_quiet_project(tmp_path)))
    rs = _heavy_reminders(prompt_intercept.analyze_prompt(
        "我想把这个项目开源到github上面，注意数据安全"))
    assert len(rs) == 1 and "M 档" in rs[0]
    rs2 = _heavy_reminders(prompt_intercept.analyze_prompt("好，准备推送到公网"))
    assert rs2 == []  # 同会话冷却，不刷屏


def test_heavy_task_with_active_manifest_quiet(isolated_tmp, tmp_path, monkeypatch):
    proj = _quiet_project(tmp_path)
    (proj / ".regress" / "manifests" / "R1.md").write_text(
        "---\nid: R1\nstatus: in-progress\n---\n", encoding="utf-8")
    monkeypatch.setenv("ZCODE_PROJECT_DIR", str(proj))
    assert _heavy_reminders(prompt_intercept.analyze_prompt(
        "我想把这个项目开源到github上面")) == []


def test_normal_change_request_not_heavy(isolated_tmp, tmp_path, monkeypatch):
    monkeypatch.setenv("ZCODE_PROJECT_DIR", str(_quiet_project(tmp_path)))
    assert _heavy_reminders(prompt_intercept.analyze_prompt(
        "帮我把登录页的按钮改成蓝色，加个圆角")) == []


def test_constraint_re_patterns():
    assert prompt_intercept.CONSTRAINT_RE.search("发布之前一定要人类审查")
    assert prompt_intercept.CONSTRAINT_RE.search("不许跳过测试")
    assert not prompt_intercept.CONSTRAINT_RE.search("这个功能很好用")


def test_constraint_requires_direction_word():
    """约束语式 + 方向词共现才埋——"必须努力"式自述不埋。"""
    t = "必须努力工作才能成功"
    assert not (prompt_intercept.CONSTRAINT_RE.search(t)
                and prompt_intercept.CONSTRAINT_DIRECTION_RE.search(t))
    t2 = "发布到公网之前一定要人类审查，作者是yelisheng"
    assert (prompt_intercept.CONSTRAINT_RE.search(t2)
            and prompt_intercept.CONSTRAINT_DIRECTION_RE.search(t2))
