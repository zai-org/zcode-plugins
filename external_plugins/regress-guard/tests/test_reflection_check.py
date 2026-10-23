"""reflection_check 节 9 测试（v1.94.0，122：纠正闭环的 Stop 升级位）。

PD 式生命周期在 Stop 钩子的消费端：pending 高水位（10 分钟墙钟窗作废——
0158a98b 标本 11:12 纠正 vs 11:32 轮末恰好逃逸）+ 带游标的一行处置命令
+ user_constraint 红线落盘提醒。
"""
import json
import os
import sys
import tempfile
from datetime import datetime

import pytest

SCRIPTS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..",
                                       "hooks", "scripts"))
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)

import reflection_check  # noqa: E402


@pytest.fixture
def sandbox(monkeypatch, tmp_path):
    """冷却/计数状态文件全部重定向到测试沙箱，会话身份固定。"""
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setenv("ZCODE_SESSION_ID", "test-reflection")
    monkeypatch.delenv("CLAUDE_SESSION_ID", raising=False)
    return tmp_path


def _proj_with_journal(tmp_path, events):
    proj = tmp_path / "proj"
    (proj / ".regress" / "journal").mkdir(parents=True)
    with open(proj / ".regress" / "journal" / "events.jsonl", "w",
              encoding="utf-8") as f:
        for e in events:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    return str(proj)


def _now_iso():
    return datetime.now().isoformat()


def test_pending_correction_reminder_carries_command(sandbox, tmp_path):
    """pending 纠正在场：提醒含数量+excerpt+带游标的一行 ack 命令（可抄性）。"""
    proj = _proj_with_journal(tmp_path, [
        {"ts": _now_iso(), "kind": "user_correction",
         "excerpt": "每一个文档你都单独审查，不对经！", "session": "s1"},
    ])
    reminders = reflection_check.check_context(proj) or []
    joined = "\n".join(reminders)
    assert "未处置用户纠正 1 条" in joined
    assert "ack-corrections" in joined and "upto" in joined  # 处置命令+游标
    assert "不对经" in joined  # excerpt 摆渡（不经 AI 过滤）


def test_pending_survives_long_turn(sandbox, tmp_path):
    """高水位窗：早于 10 分钟的纠正仍 pending——长轮次逃逸修复的回归锚。"""
    proj = _proj_with_journal(tmp_path, [
        {"ts": "2026-09-24T03:12:54", "kind": "user_correction",
         "excerpt": "旧纠正但从未处置", "session": "s1"},
    ])
    joined = "\n".join(reflection_check.check_context(proj) or [])
    assert "未处置用户纠正" in joined  # 20 分钟前？仍要处置


def test_disposition_silences_pending(sandbox, tmp_path):
    proj = _proj_with_journal(tmp_path, [
        {"ts": "2026-09-24T10:00:00", "kind": "user_correction", "excerpt": "x"},
        {"ts": "2026-09-24T11:00:00", "kind": "correction_disposition",
         "how": "advisor", "upto": "2026-09-24T11:00:00"},
    ])
    joined = "\n".join(reflection_check.check_context(proj) or [])
    assert "未处置用户纠正" not in joined


def test_constraint_fossil_reminds_durable(sandbox, tmp_path):
    """user_constraint 化石在场 → 红线落盘提醒（decisions.md）。"""
    proj = _proj_with_journal(tmp_path, [
        {"ts": _now_iso(), "kind": "user_constraint",
         "excerpt": "发布到公网之前一定要人类审查", "session": "s1"},
    ])
    joined = "\n".join(reflection_check.check_context(proj) or [])
    assert "硬约束" in joined and "decisions.md" in joined


def test_no_journal_no_correction_reminder(sandbox, tmp_path):
    proj = tmp_path / "empty"
    (proj / ".regress").mkdir(parents=True)
    joined = "\n".join(reflection_check.check_context(str(proj)) or [])
    assert "未处置用户纠正" not in joined and "硬约束" not in joined
