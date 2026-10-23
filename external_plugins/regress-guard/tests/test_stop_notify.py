"""授权门控轮末推送（v1.32）：授权词推送/非授权静音/冷却防双响。"""
import json
import os
import stat
import sys

import pytest

HERE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts"))
LIB = os.path.join(HERE, "lib")

sys.path.insert(0, HERE)
sys.path.insert(0, LIB)

import importlib.util as ilu

_sn_spec = ilu.spec_from_file_location("stop_notify", os.path.join(HERE, "stop_notify.py"))
sn = ilu.module_from_spec(_sn_spec)
_sn_spec.loader.exec_module(sn)


def _run_main():
    with pytest.raises(SystemExit) as e:
        sn.main()
    assert e.value.code in (0, None)


def _channel_stub(tmp_path, marker):
    stub = tmp_path / "stub.sh"
    stub.write_text("#!/bin/sh\necho \"$@\" >> %s\n" % marker, encoding="utf-8")
    stub.chmod(stat.S_IRWXU)
    return str(stub)


def _mk_proj(tmp_path, mach_channels):
    proj = tmp_path / "proj"
    (proj / ".regress").mkdir(parents=True, exist_ok=True)
    mach = tmp_path / "machine.json"
    mach.write_text(json.dumps({"notify": {"channels": mach_channels}}), encoding="utf-8")
    return proj, mach


def test_autonomy_word_pushes(tmp_path, monkeypatch):
    proj, mach = _mk_proj(tmp_path, [_channel_stub(tmp_path, tmp_path / "m1") + " {title} {body}"])
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    monkeypatch.setenv("ZCODE_PROJECT_DIR", str(proj))
    monkeypatch.setenv("TMPDIR", str(tmp_path))  # 标记文件隔离（否则污染真机 /tmp）
    from prompt_intercept import save_prompt, _state_path
    save_prompt("继续，自决策。开启长程任务推演")
    _run_main()
    out = (tmp_path / "m1").read_text(encoding="utf-8")
    assert "阶段完成" in out and "自决策" in out


def test_normal_chat_also_pushes(tmp_path, monkeypatch):
    """v1.32.2 用户令：正常对话轮末也推（💬 回复完成形态），静音设计废弃。"""
    proj, mach = _mk_proj(tmp_path, [_channel_stub(tmp_path, tmp_path / "m2") + " {title} {body}"])
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    monkeypatch.setenv("ZCODE_PROJECT_DIR", str(proj))
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    from prompt_intercept import save_prompt
    save_prompt("正常的对话结束，也要发送给人类，通过企业微信")
    _run_main()
    out = (tmp_path / "m2").read_text(encoding="utf-8")
    assert "回复完成" in out and "正常的对话结束" in out
    assert "阶段完成" not in out  # 普通轮与授权轮形态可分辨


def test_empty_prompt_turn_still_pushes(tmp_path, monkeypatch):
    """v1.32.4 根治：图片/空文本轮也推（占位标题），决策与文本解耦。"""
    import tempfile
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))  # gettempdir 有进程级缓存
    proj, mach = _mk_proj(tmp_path, [_channel_stub(tmp_path, tmp_path / "m4") + " {title} {body}"])
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    monkeypatch.setenv("ZCODE_PROJECT_DIR", str(proj))
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    assert sn.should_notify("", cooled=True) is True
    from prompt_intercept import save_prompt
    save_prompt("有意义的前一条")
    save_prompt("")  # 空文本不覆写全局（摘要保留前一条语义由全局守护，占位由标题兜底）
    _run_main()
    out = (tmp_path / "m4").read_text(encoding="utf-8")
    assert "回复完成" in out and "[图片或无文本消息]" in out


def test_cooldown_prevents_double_buzz(tmp_path, monkeypatch):
    proj, mach = _mk_proj(tmp_path, [_channel_stub(tmp_path, tmp_path / "m3") + " {title}"])
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    monkeypatch.setenv("ZCODE_PROJECT_DIR", str(proj))
    from prompt_intercept import save_prompt
    save_prompt("继续，放手做")
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    assert sn.should_notify("继续，放手做", cooled=True)
    sn._mark()  # 模拟刚推过（finish 仪式后 90s 内）
    _run_main()
    assert not (tmp_path / "m3").exists()  # 冷却期内不双响
    assert sn.should_notify("继续，放手做", cooled=False) is False


def test_round_push_uses_chat_event_not_done(tmp_path, monkeypatch):
    """v1.38：轮末提醒是独立 chat 事件——不再冒充 done 污染发送台账统计
    （病例：done×375 几乎全是轮末提醒，真 done 仅 3 次）。"""
    stub = tmp_path / "env-stub.sh"
    marker = tmp_path / "mev"
    stub.write_text("#!/bin/sh\necho \"$RG_NOTIFY_EVENT\" >> %s\n" % marker,
                    encoding="utf-8")
    stub.chmod(stat.S_IRWXU)
    proj, mach = _mk_proj(tmp_path, [str(stub)])
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    monkeypatch.setenv("ZCODE_PROJECT_DIR", str(proj))
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    from prompt_intercept import save_prompt
    save_prompt("普通一轮")
    _run_main()
    assert (tmp_path / "mev").read_text(encoding="utf-8").strip() == "chat"


def test_chat_event_togglable_without_touching_done(tmp_path, monkeypatch):
    """chat 是独立事件开关——关轮末提醒不影响 done/progress（治冒充的善后：
    用户此前想只关轮末提醒只能连 done 一起关）。"""
    marker = tmp_path / "mchat"
    mach = tmp_path / "machine.json"
    mach.write_text(json.dumps({"notify": {
        "channels": [_channel_stub(tmp_path, marker) + " {title}"],
        "events": {"chat": False, "done": True}}}), encoding="utf-8")
    proj = tmp_path / "proj"
    (proj / ".regress").mkdir(parents=True)
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    monkeypatch.setenv("ZCODE_PROJECT_DIR", str(proj))
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    from prompt_intercept import save_prompt
    save_prompt("安静些")
    _run_main()
    assert not marker.exists()  # chat 关 → 轮末不响


# ─── v1.78（067）：Stop 级版本漂移警示——每对版本只警一次 ────────────────

def _drift_env(tmp_path, monkeypatch, pair):
    import self_heal as sh
    import tempfile
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(tmp_path))
    monkeypatch.setattr(sh, "_drift_pair", lambda: pair)
    return sh


def test_drift_new_pair_warns_once(tmp_path, monkeypatch, capsys):
    proj, mach = _mk_proj(tmp_path, [_channel_stub(tmp_path, tmp_path / "m1") + " {title} {body}"])
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(proj))
    _drift_env(tmp_path, monkeypatch, ("1.0.0", "1.1.0"))
    _run_main()
    err = capsys.readouterr().err
    assert "版本漂移" in err and "install.sh" in err
    assert (tmp_path / "regress-drift-noticed.json").exists()
    assert "版本漂移" in (tmp_path / "m1").read_text(encoding="utf-8")  # chat 落标
    _run_main()  # 同对第二轮：静默
    err2 = capsys.readouterr().err
    assert "版本漂移" not in err2
    assert (tmp_path / "m1").read_text(encoding="utf-8").count("版本漂移") == 1


def test_drift_equal_or_none_silent(tmp_path, monkeypatch, capsys):
    proj, mach = _mk_proj(tmp_path, [_channel_stub(tmp_path, tmp_path / "m2") + " {title} {body}"])
    monkeypatch.setenv("RG_MACHINE_NOTIFY", str(mach))
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(proj))
    _drift_env(tmp_path, monkeypatch, ("1.78.0", "1.78"))
    _run_main()
    _drift_env(tmp_path, monkeypatch, None)
    _run_main()
    assert "版本漂移" not in capsys.readouterr().err
    assert not (tmp_path / "regress-drift-noticed.json").exists()
