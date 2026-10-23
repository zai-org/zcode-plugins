"""health_probe（131：巡检探针机器位）——崩/漏可见性，不做语义解读。"""
import importlib.util as ilu
import os
import sys

import pytest

SCRIPT = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "scripts", "health_probe.py"))


def _load():
    spec = ilu.spec_from_file_location("hp", SCRIPT)
    m = ilu.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def _probe(script_body, name="p.sh"):
    import tempfile, stat
    d = tempfile.mkdtemp()
    p = os.path.join(d, name)
    open(p, "w").write("#!/bin/sh\n" + script_body)
    os.chmod(p, 0o755)
    return p


def test_all_pass(tmp_path):
    hp = _load()
    probes = [("ok1", [_probe("echo hello")]),
              ("ok2", [_probe("echo world")])]
    rows, ok = hp.run_probes(str(tmp_path), probes=probes)
    assert ok and all(r[1] for r in rows)


def test_crash_marks_fail_and_overall_nonzero(tmp_path):
    """崩失察根治位：子命令 exit≠0 → ❌ + 整体 False（features 崩两日标本）。"""
    hp = _load()
    probes = [("good", [_probe("echo fine")]),
              ("crash", [_probe("echo boom 1>&2; exit 3")])]
    rows, ok = hp.run_probes(str(tmp_path), probes=probes)
    assert not ok
    crash = [r for r in rows if r[0] == "crash"][0]
    assert not crash[1] and "boom" in crash[2] and "3" in crash[2]


def test_timeout_is_fail(tmp_path):
    """顾问增补：超时也是 ❌ 不是挂起。"""
    hp = _load()
    probes = [("slow", [_probe("sleep 5")])]
    rows, ok = hp.run_probes(str(tmp_path), probes=probes, timeout=1)
    assert not ok and "timeout" in rows[0][2]


def test_silent_zero_output_is_fail(tmp_path):
    """零输出探针=静默层（心虚探测位机器化）：exit 0 但无 stdout 也 ❌。"""
    hp = _load()
    probes = [("mute", [_probe("exit 0")])]
    rows, ok = hp.run_probes(str(tmp_path), probes=probes)
    assert not ok and not rows[0][1]


def test_builtin_probe_list_nonempty_and_anchored():
    """清单单一事实源锚：非空+含 v2.12 两条追加探针与仓洁净度。"""
    hp = _load()
    labels = [p[0] for p in hp.PROBES]
    assert len(labels) >= 10
    assert "history.features" in labels and "history.cache" in labels
    assert "repo.clean" in labels


def test_empty_ok_probe_passes_when_silent(tmp_path):
    """132：'空输出=健康'语义探针（仓洁净）零输出→✓；数据探针仍红。"""
    hp = _load()
    probes = [("clean", [_probe("exit 0")], True),   # 空=好
              ("data", [_probe("exit 0")], False)]   # 空=静默层
    rows, ok = hp.run_probes(str(tmp_path), probes=probes)
    assert rows[0][1] and not rows[1][1] and not ok
