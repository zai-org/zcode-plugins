"""gen_reference（v1.22 派生优于断言）的单元测试。"""
import os
import shutil
import subprocess
import sys

GEN = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "scripts",
                                   "gen_reference.py"))


def _run(args, cwd):
    return subprocess.run([sys.executable, GEN, *args], capture_output=True,
                          text=True, cwd=cwd, timeout=60)


def test_check_passes_on_fresh_generation(tmp_path):
    """生成区与实况一致 → --check 通过。"""
    r = _run(["--check"], os.path.dirname(os.path.dirname(GEN)))
    assert r.returncode == 0, r.stderr + r.stdout


def test_tampered_region_fails_check(tmp_path, monkeypatch):
    """篡改生成区计数 → --check 必须红（病例：手写数字腐烂）。"""
    repo = os.path.dirname(os.path.dirname(GEN))
    readme = tmp_path / "README.md"
    src = open(os.path.join(repo, "README.md"), encoding="utf-8").read()
    readme.write_text(src.replace("个 · hook 注册", "X · hook 注册"), encoding="utf-8")
    import importlib.util
    spec = importlib.util.spec_from_file_location("gen_reference", GEN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.apply(readme_path=str(readme), check=True) == 1
