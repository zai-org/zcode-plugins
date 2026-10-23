"""安装后自检（v1.76，065）：三查合同——好树绿、缺件/错版本/坏语法红。"""
import importlib.util as ilu
import json
import os
import sys

CHECK = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "scripts", "post_install_check.py"))


def _load():
    spec = ilu.spec_from_file_location("pic", CHECK)
    m = ilu.module_from_spec(spec); spec.loader.exec_module(m)
    return m


def _good_tree(tmp_path):
    """最小源仓+已装目录对：hooks.json 引用一个脚本，戳=源版本。"""
    src = tmp_path / "src"; ins = tmp_path / "ins"
    (src / "hooks").mkdir(parents=True); (src / ".zcode-plugin").mkdir()
    (ins).mkdir()
    (src / "hooks" / "hooks.json").write_text(json.dumps({"hooks": {"PreToolUse": [
        {"hooks": [{"type": "command",
                    "command": "python3 \"${ZCODE_PLUGIN_ROOT}/hooks/scripts/guard.py\""}]}]}}),
        encoding="utf-8")
    (src / ".zcode-plugin" / "plugin.json").write_text(
        json.dumps({"version": "9.9.9"}), encoding="utf-8")
    (ins / "guard.py").write_text("x = 1\n", encoding="utf-8")
    (ins / ".source").write_text(
        "source_path=/x\nsource_version=9.9.9\n", encoding="utf-8")
    return str(src), str(ins)


def test_good_tree_passes(tmp_path, capsys):
    m = _load()
    src, ins = _good_tree(tmp_path)
    assert m.main(src, ins) == 0
    out = capsys.readouterr().out
    assert "三查全绿" in out and "guard.py" not in out


def test_missing_script_fails(tmp_path, capsys):
    m = _load()
    src, ins = _good_tree(tmp_path)
    os.remove(os.path.join(ins, "guard.py"))
    assert m.main(src, ins) == 1
    assert "注册面" in capsys.readouterr().out


def test_version_mismatch_fails(tmp_path, capsys):
    m = _load()
    src, ins = _good_tree(tmp_path)
    (tmp_path / "ins" / ".source").write_text(
        "source_path=/x\nsource_version=0.0.1\n", encoding="utf-8")
    assert m.main(src, ins) == 1
    assert "版本面" in capsys.readouterr().out


def test_syntax_error_fails(tmp_path, capsys):
    m = _load()
    src, ins = _good_tree(tmp_path)
    (tmp_path / "ins" / "guard.py").write_text("def broken(:\n", encoding="utf-8")
    assert m.main(src, ins) == 1
    assert "语法面" in capsys.readouterr().out


def test_plugin_form_version_pass(tmp_path, capsys):
    """插件形态（无戳+已装 plugin.json）版本一致 → 绿。"""
    m = _load()
    src, ins = _good_tree(tmp_path)
    os.remove(os.path.join(ins, ".source"))
    (tmp_path / "ins" / ".zcode-plugin").mkdir()
    (tmp_path / "ins" / ".zcode-plugin" / "plugin.json").write_text(
        json.dumps({"version": "9.9.9"}), encoding="utf-8")
    assert m.main(src, ins) == 0
    assert "plugin.json" in capsys.readouterr().out


def test_plugin_form_version_mismatch(tmp_path, capsys):
    """插件形态版本不一致 → 版本面红。"""
    m = _load()
    src, ins = _good_tree(tmp_path)
    os.remove(os.path.join(ins, ".source"))
    (tmp_path / "ins" / ".zcode-plugin").mkdir()
    (tmp_path / "ins" / ".zcode-plugin" / "plugin.json").write_text(
        json.dumps({"version": "0.0.1"}), encoding="utf-8")
    assert m.main(src, ins) == 1
    assert "版本面" in capsys.readouterr().out


def test_relocated_script_in_lib_passes(tmp_path, capsys):
    """v1.94.0：部署布局合法搬位（如 self_heal.py 进 lib/）不再假红——
    注册面按 basename 全树搜（120 搬位后根目录假设误报过一次）。"""
    m = _load()
    src, ins = _good_tree(tmp_path)
    os.makedirs(os.path.join(ins, "lib"))
    os.rename(os.path.join(ins, "guard.py"), os.path.join(ins, "lib", "guard.py"))
    assert m.main(src, ins) == 0
    assert "三查全绿" in capsys.readouterr().out
