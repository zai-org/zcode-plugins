"""manifest_fields（v1.20 单一来源）的单元测试。"""
import os
import sys

sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib")))

import manifest_fields as mf  # noqa: E402

SAMPLE = """---
id: R9
status: {status}
base_head: "abc1234"
approved:
  at: "{approved_at}"
  note: ""
blocked:
  reason: "Redis 不通"
  need: "开白名单"
  at: ""
provisional:
  at: "{provisional_at}"
  advisor: ""
planned_changes:
  - id: F1
    file: "src/a.ts"
    type: method-logic
fragile_points:
  - id: V1
    kind: env
    description: "d"
    verify: "true"
    status: {fp_status}
actual_changes: []
---
body
"""


def _mk(status="in-progress", approved_at="", provisional_at="", fp_status="open"):
    return SAMPLE.format(status=status, approved_at=approved_at,
                         provisional_at=provisional_at, fp_status=fp_status)


def test_parse_core_full():
    core = mf.parse_core(_mk())
    assert core["id"] == "R9"
    assert core["status"] == "in-progress"
    assert core["approved_at"] == ""  # 未填
    assert core["blocked_reason"] == "Redis 不通"
    assert core["blocked_need"] == "开白名单"
    assert core["open_fragiles"] == 1


def test_parse_core_non_manifest():
    assert mf.parse_core("just text") == {}


def test_editable_matrix():
    assert mf.editable("in-progress", "") is True
    assert mf.editable("verifying", "") is True
    assert mf.editable("planning", "") is False              # 待批准
    assert mf.editable("planning", "2026-08-27T10:00:00") is True   # 产物直通
    assert mf.editable("blocked", "2026-08-27T10:00:00") is False    # 批准不越过受阻
    assert mf.editable("done", "") is False


def test_block_value_and_filled():
    c = _mk(approved_at="2026-08-27T10:00:00")
    fm = mf.frontmatter(c)
    assert mf.block_value(fm, "approved", "at") == "2026-08-27T10:00:00"
    assert mf.filled(fm, "approved", "at") is True
    assert mf.filled(fm, "provisional", "at") is False
    assert mf.filled(fm, "blocked", "reason") is True  # 非空 reason


def test_open_fragile_count_variants():
    assert mf.parse_core(_mk(fp_status="locked"))["open_fragiles"] == 0
    two = _mk().replace(
        '    status: open', '    status: open\n  - id: V2\n    kind: env\n'
        '    description: "d2"\n    verify: "true"\n    status: open')
    assert mf.parse_core(two)["open_fragiles"] == 2


# ─── P1#12：open 检测容忍行尾注释（评审批次二） ────────────

def test_open_fp_regex_tolerates_trailing_comment():
    """旧模板的行内注释（status: open # ...）不再让 open 检测恒不中。"""
    import sys as _sys
    LIB = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib"))
    if LIB not in _sys.path:
        _sys.path.insert(0, LIB)
    from manifest_fields import _OPEN_FP_RE
    assert _OPEN_FP_RE.search("    status: open\n")
    assert _OPEN_FP_RE.search("    status: open       # open=未挂牌(禁提交)\n")
    assert not _OPEN_FP_RE.search("    status: locked\n")
