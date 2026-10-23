"""宣称一致性 lint（126）：安装器/README 的数字宣称与实况对账。

外部评审实证面：install.sh 曾宣称"装 3 个 skill"而仓内无 skills/（实装 0）。
宣称漂移是文档腐化的最阴形态——数字宣称全部机器对账，漂移当场红。
覆盖边界：只对账显式数字宣称与显式路径引用；无数字的软宣称靠 review。
"""
import os
import re
import glob

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CLAIM_FILES = ["install.sh", "uninstall.sh", "README.md"]

# 数字宣称形态：「N 个 skill」「N 个命令」「N 个 hook」（中英数字均认）
_NUM_CLAIM = re.compile(r"(\d+)\s*个\s*(skill|命令|hook)", re.I)


def _repo_files():
    out = {}
    for f in CLAIM_FILES:
        p = os.path.join(ROOT, f)
        out[f] = open(p, encoding="utf-8").read() if os.path.exists(p) else ""
    return out


def _reality(kind):
    if kind.lower().startswith("skill"):
        d = os.path.join(ROOT, "skills")
        return len(glob.glob(os.path.join(d, "*"))) if os.path.isdir(d) else 0
    if kind == "命令" or kind.lower() == "hook":
        # 命令=commands/*.md；hook 脚本=hooks/scripts/*.py（粗粒度实况）
        if kind == "命令":
            return len(glob.glob(os.path.join(ROOT, "commands", "*.md")))
        return len(glob.glob(os.path.join(ROOT, "hooks", "scripts", "*.py")))
    return None


def test_numeric_claims_match_reality():
    """每个数字宣称必须等于实况——宣称装 N 实装 M≠N 当场红。"""
    bad = []
    for fname, text in _repo_files().items():
        for m in _NUM_CLAIM.finditer(text):
            n, kind = int(m.group(1)), m.group(2)
            real = _reality(kind)
            if real is not None and n != real:
                bad.append(f"{fname}: 宣称 {n} 个 {kind}，实况 {real}")
    assert not bad, "宣称漂移：\n  " + "\n  ".join(bad)


def test_referenced_dirs_exist():
    """安装器引用的相对目录必须存在（skills/ 已移除后任何残留引用即红）。"""
    bad = []
    for fname, text in _repo_files().items():
        for m in re.finditer(r"(?:~/.zcode/)?(skills|commands)/[A-Za-z0-9:_\-]", text):
            rel = m.group(1)
            if not os.path.isdir(os.path.join(ROOT, rel)):
                bad.append(f"{fname}: 引用 {rel}/ 但仓内不存在")
    assert not bad, "悬空目录引用：\n  " + "\n  ".join(bad)


def test_requirements_dev_lists_actual_deps():
    """requirements-dev 必须列齐套件真实 import 的三方件（自检基线）。"""
    req = open(os.path.join(ROOT, "requirements-dev.txt"), encoding="utf-8").read()
    for pkg in ("pytest", "anyio", "filelock"):
        assert re.search(rf"^{pkg}\b", req, re.M), f"requirements-dev 缺 {pkg}"
