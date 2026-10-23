#!/usr/bin/env python3
"""分析 git diff，返回实际改动的文件列表。

负责：
1. 调用 git 获取改动文件
2. 应用过滤规则（忽略 .regress/、锁文件、文档等）
3. 输出 JSON 格式的改动文件列表
"""
import sys
import os
import re
import json
import subprocess


# 默认忽略的文件模式（不算计划外改动）
DEFAULT_IGNORE_PATTERNS = [
    ".regress/",          # 框架自身产物
    "AGENTS.md",          # 框架注入的契约文件（由 /regress:init 管理）
    "package-lock.json",  # npm 锁文件
    "yarn.lock",          # yarn 锁文件
    "pnpm-lock.yaml",     # pnpm 锁文件
    "poetry.lock",        # poetry 锁文件
    "Cargo.lock",         # cargo 锁文件
    "go.sum",             # go 锁文件
    ".gitignore",
    ".gitattributes",
    "LICENSE",
    ".DS_Store",
]


def get_changed_files(git_dir="."):
    """获取所有改动的文件（tracked 改动 + untracked 新增）。

    Returns:
        list of file path strings (relative to git root)
    """
    try:
        # 先获取 git 根目录
        root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, cwd=git_dir, timeout=10
        ).stdout.strip()
        if not root:
            return []
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return []  # git 不可用或超时 → 无改动文件

    changed = set()

    # 1. 已跟踪文件的改动（staged + unstaged，相对于 HEAD）
    try:
        out = subprocess.run(
            ["git", "diff", "--name-only", "HEAD"],
            capture_output=True, text=True, cwd=root, timeout=10
        ).stdout.strip()
        if out:
            changed.update(out.split("\n"))
    except (subprocess.TimeoutExpired, OSError):
        pass  # git diff 失败 → 跳过，继续其他方式

    # 2. 如果上面为空，单独看 staged 和 unstaged
    if not changed:
        for args in (["git", "diff", "--name-only", "--staged"],
                      ["git", "diff", "--name-only"]):
            try:
                out = subprocess.run(
                    args, capture_output=True, text=True, cwd=root, timeout=10
                ).stdout.strip()
                if out:
                    changed.update(out.split("\n"))
            except (subprocess.TimeoutExpired, OSError):
                pass

    # 3. 新增的未跟踪文件
    try:
        out = subprocess.run(
            ["git", "ls-files", "--others", "--exclude-standard"],
            capture_output=True, text=True, cwd=root, timeout=10
        ).stdout.strip()
        if out:
            changed.update(out.split("\n"))
    except (subprocess.TimeoutExpired, OSError):
        pass

    return sorted([f for f in changed if f])


def get_staged_files(git_dir="."):
    """只获取 staged（已 git add）的文件。"""
    try:
        root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, cwd=git_dir, timeout=10
        ).stdout.strip()
        if not root:
            return []
        out = subprocess.run(
            ["git", "diff", "--name-only", "--staged"],
            capture_output=True, text=True, cwd=root, timeout=10
        ).stdout.strip()
        return [f for f in out.split("\n") if f] if out else []
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return []


def is_commit_command(command_str):
    """判断一个 shell 命令字符串是否是 git commit。

    用于 PreToolUse hook 中匹配 Bash 工具的 command。
    """
    if not command_str:
        return False
    # 匹配各种形式：git commit, git ci (alias), hub commit, gh ...
    commit_patterns = [
        r"\bgit\s+commit\b",
        r"\bgit\s+ci\b",
        r"\bhub\s+commit\b",
    ]
    for p in commit_patterns:
        if __import__("re").search(p, command_str):
            return True
    return False


def filter_files(files, ignore_patterns=None):
    """过滤掉应忽略的文件。"""
    patterns = ignore_patterns or DEFAULT_IGNORE_PATTERNS
    result = []
    for f in files:
        if any(f.startswith(p) or f.endswith(p) or p in f for p in patterns):
            continue
        # 忽略纯 .md 文档（AGENTS.md 已在 DEFAULT_IGNORE_PATTERNS 中）
        if f.endswith(".md"):
            continue
        # 测试文件不算 F3（是改动的配套产物，不是业务改动）
        if re.search(r'(test|spec|__tests__)', f):
            continue
        result.append(f)
    return result


def find_untracked_changes(changed_files, manifest_files):
    """找出在清单中没有的改动文件（即 F3/F4）。

    Args:
        changed_files: git diff 中的文件列表
        manifest_files: 清单中记录的文件列表
    Returns:
        在 changed_files 中但不在 manifest_files 中的文件列表
    """
    manifest_set = set(manifest_files)
    return [f for f in changed_files if f not in manifest_set]


if __name__ == "__main__":
    # CLI 用法：
    #   python3 git_diff_analyzer.py changed          → 所有改动文件（过滤后）
    #   python3 git_diff_analyzer.py staged           → staged 文件
    #   python3 git_diff_analyzer.py diff <manifest>  → 清单外的改动文件
    cmd = sys.argv[1] if len(sys.argv) > 1 else "changed"

    if cmd == "changed":
        files = get_changed_files()
        print(json.dumps({"files": filter_files(files)}))
    elif cmd == "staged":
        files = get_staged_files()
        print(json.dumps({"files": filter_files(files)}))
    elif cmd == "diff":
        # 对比清单，需要 manifest_files 作为 JSON 数组从 stdin 或参数
        if len(sys.argv) < 3:
            print(json.dumps({"error": "usage: diff <manifest_files_json>"}))
            sys.exit(1)
        manifest_files = json.loads(sys.argv[2])
        changed = filter_files(get_changed_files())
        untracked = find_untracked_changes(changed, manifest_files)
        print(json.dumps({"untracked": untracked, "total_changed": len(changed)}))
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))
        sys.exit(1)
