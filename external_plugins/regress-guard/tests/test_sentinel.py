"""哨兵视图（v1.34）：活跃清单 × 会话归属 × 跨会话文件重叠检测。"""
import os

R1 = """---
id: R1
status: in-progress
session: sess-aaaa-0001
planned_changes:
  - id: F1
    file: "src/x.js"
    type: method-logic
actual_changes: []
---
b
"""

R2 = """---
id: R2
status: in-progress
session: sess-bbbb-0002
planned_changes:
  - id: F1
    file: "src/x.js"
    type: method-logic
  - id: F2
    file: "src/y.js"
    type: new-file
actual_changes: []
---
b
"""

R3_DONE = """---
id: R3
status: done
planned_changes: []
actual_changes: []
---
b
"""


def test_sentinel_lists_active_with_session_and_clash(tmp_path, capsys):
    proj = tmp_path / "proj"
    mdir = proj / ".regress" / "manifests"
    mdir.mkdir(parents=True)
    (mdir / "a.md").write_text(R1, encoding="utf-8")
    (mdir / "b.md").write_text(R2, encoding="utf-8")
    (mdir / "c.md").write_text(R3_DONE, encoding="utf-8")  # done 不列
    import sentinel
    rows = sentinel.render(str(proj))
    assert {r[1] for r in rows} == {"R1", "R2"}
    out = capsys.readouterr().out
    assert "他会话" in out  # 无本会话 env → 两张清单都是他会话
    assert "多会话声明了同一文件" in out and "src/x.js" in out


def test_sentinel_marks_blocked_waiting_human(tmp_path, capsys):
    proj = tmp_path / "proj"
    mdir = proj / ".regress" / "manifests"
    mdir.mkdir(parents=True)
    (mdir / "a.md").write_text(
        R1.replace("in-progress", "blocked"), encoding="utf-8")
    import sentinel
    sentinel.render(str(proj))
    out = capsys.readouterr().out
    assert "在等人类" in out


def test_sentinel_empty_is_clean(tmp_path, capsys):
    proj = tmp_path / "proj"
    (proj / ".regress" / "manifests").mkdir(parents=True)
    import sentinel
    assert sentinel.render(str(proj)) == []
    assert "无活跃清单" in capsys.readouterr().out
