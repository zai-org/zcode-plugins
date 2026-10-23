"""会话身份层（v1.34）：中继原子写/读取 + plan_approve 盖戳的归属语义。"""
import os
import tempfile


def test_relay_roundtrip_last_writer_wins(tmp_path, monkeypatch):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    import session_relay as sr
    assert sr.write_relay(str(tmp_path), "s1") is True
    assert sr.read_relay(str(tmp_path))["sid"] == "s1"
    sr.write_relay(str(tmp_path), "s2")
    assert sr.read_relay(str(tmp_path))["sid"] == "s2"  # last-writer-wins


def test_relay_atomic_no_litter(tmp_path, monkeypatch):
    """顾问补强点：原子写（tmp+rename）不留半行/残片。"""
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    import session_relay as sr
    for i in range(5):
        sr.write_relay(str(tmp_path), f"s{i}")
    leftovers = [f for f in os.listdir(str(tmp_path))
                 if f.startswith("regress-guard-session-") and ".tmp" in f]
    assert leftovers == []


def test_relay_isolated_per_project(tmp_path, monkeypatch):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    import session_relay as sr
    a, b = str(tmp_path / "projA"), str(tmp_path / "projB")
    os.makedirs(a, exist_ok=True)
    os.makedirs(b, exist_ok=True)
    sr.write_relay(a, "sid-a")
    assert sr.read_relay(b) == {}  # 项目隔离：B 没中继不串读 A 的


def test_sid_env_priority(monkeypatch):
    import session_relay as sr
    monkeypatch.delenv("CLAUDE_SESSION_ID", raising=False)
    monkeypatch.delenv("ZCODE_SESSION_ID", raising=False)
    assert sr.sid_from_env() == ""
    monkeypatch.setenv("ZCODE_SESSION_ID", "z1")
    assert sr.sid_from_env() == "z1"
    monkeypatch.setenv("CLAUDE_SESSION_ID", "c1")
    assert sr.sid_from_env() == "c1"  # CLAUDE 优先


def test_stamp_session_env_fallback(tmp_path, monkeypatch):
    """无中继时 env 兜底；已有戳则替换不重复。"""
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    monkeypatch.setenv("CLAUDE_SESSION_ID", "s9")
    import plan_approve as pa
    content = "---\nid: X\nstatus: planning\n---\nbody"
    out = pa._stamp_session(content, "/nonexistent-dir")
    assert "\nsession: s9\n" in out and out.index("session:") < out.index("---\nbody")
    assert pa._stamp_session(out, "/nonexistent-dir").count("session: ") == 1


def test_stamp_session_relay_beats_env(tmp_path, monkeypatch):
    """中继优先于 env：盖章读「最近在本项目说话的会话」。"""
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    import session_relay as sr
    sr.write_relay(str(tmp_path), "relay-sid")
    monkeypatch.setenv("CLAUDE_SESSION_ID", "env-sid")
    import plan_approve as pa
    out = pa._stamp_session("---\nstatus: planning\n---\nb", str(tmp_path))
    assert "session: relay-sid" in out


def test_stamp_session_no_identity_unchanged(tmp_path, monkeypatch):
    """无中继无 env → 原样返回（不盖空戳）。"""
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    monkeypatch.delenv("CLAUDE_SESSION_ID", raising=False)
    monkeypatch.delenv("ZCODE_SESSION_ID", raising=False)
    import plan_approve as pa
    content = "---\nstatus: planning\n---\nb"
    assert pa._stamp_session(content, str(tmp_path)) == content
