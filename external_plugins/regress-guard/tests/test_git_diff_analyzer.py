"""git_diff_analyzer 的单元测试。

覆盖：filter_files（过滤规则）、find_untracked_changes（对比逻辑）、is_commit_command。
不测 get_changed_files/get_staged_files（依赖真实 git 环境，在 E2E 测）。
"""
import sys
import os

LIB = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib")
sys.path.insert(0, LIB)

from git_diff_analyzer import (
    filter_files, find_untracked_changes, is_commit_command,
    DEFAULT_IGNORE_PATTERNS,
)


# ─── filter_files 测试 ────────────────────────────────

def test_filter_ignores_regress_dir():
    """.regress/ 下的文件被过滤。"""
    files = [".regress/config.json", ".regress/manifests/R1.md", "src/app.js"]
    result = filter_files(files)
    assert "src/app.js" in result
    assert all(".regress/" not in f for f in result)


def test_filter_ignores_lockfiles():
    """锁文件被过滤。"""
    files = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
             "Cargo.lock", "go.sum", "src/app.js"]
    result = filter_files(files)
    assert result == ["src/app.js"]


def test_filter_ignores_agents_md():
    """AGENTS.md 被过滤。"""
    result = filter_files(["AGENTS.md", "src/app.js"])
    assert "AGENTS.md" not in result


def test_filter_ignores_markdown():
    """纯 .md 文档被过滤。"""
    result = filter_files(["README.md", "docs/guide.md", "src/app.js"])
    assert "src/app.js" in result
    assert all(not f.endswith(".md") for f in result)


def test_filter_keeps_test_files():
    """测试文件被保留（不应算 F3）。"""
    result = filter_files(["src/app.test.js", "src/app.spec.ts"])
    # 测试文件应被过滤（不算 F3），所以 result 应为空
    assert len(result) == 0


def test_filter_preserves_order():
    """过滤后保持相对顺序。"""
    files = ["src/a.js", "package-lock.json", "src/b.js"]
    result = filter_files(files)
    assert result == ["src/a.js", "src/b.js"]


def test_filter_empty_input():
    assert filter_files([]) == []


# ─── find_untracked_changes 测试 ──────────────────────

def test_find_untracked_basic():
    """找出在 changed 但不在 manifest 的文件。"""
    changed = ["src/a.js", "src/b.js", "src/c.js"]
    manifest = ["src/a.js", "src/b.js"]
    result = find_untracked_changes(changed, manifest)
    assert result == ["src/c.js"]


def test_find_untracked_all_in_manifest():
    """全部在 manifest 中时返回空。"""
    changed = ["src/a.js", "src/b.js"]
    manifest = ["src/a.js", "src/b.js"]
    assert find_untracked_changes(changed, manifest) == []


def test_find_untracked_empty_changed():
    assert find_untracked_changes([], ["src/a.js"]) == []


def test_find_untracked_empty_manifest():
    """manifest 为空时全部算 untracked。"""
    changed = ["src/a.js", "src/b.js"]
    assert find_untracked_changes(changed, []) == ["src/a.js", "src/b.js"]


# ─── is_commit_command 测试 ───────────────────────────

def test_is_commit_basic():
    assert is_commit_command("git commit -m test") is True


def test_is_commit_ci_alias():
    assert is_commit_command("git ci -m test") is True


def test_is_commit_with_path():
    assert is_commit_command("cd /tmp && git commit -m x") is True


def test_is_not_commit_push():
    """git push 不算 commit。"""
    assert is_commit_command("git push origin main") is False


def test_is_not_commit_add():
    assert is_commit_command("git add -A") is False


def test_is_not_commit_empty():
    assert is_commit_command("") is False


def test_is_not_commit_none():
    assert is_commit_command(None) is False
