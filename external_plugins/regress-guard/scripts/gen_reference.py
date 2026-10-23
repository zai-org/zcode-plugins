#!/usr/bin/env python3
"""gen_reference — reference 型文档段落生成器（v1.22：派生优于断言）。

病例驱动（2026-08-27 文档时效性审计）：
  - README 命令表手写曾漏至过期（"7 个命令"注释、命令表缺新命令）
  - 计数（命令/hook/测试数）写下即腐烂（小白指南"9 个命令"实为 13）
解法（顾问修正案 A'）：标记区内的 reference 事实由本脚本从系统实况**生成**，
手写只允许在标记区之外——没有手写数字，就没有可绕过的检查（Goodhart 面消失）。

用法：
  python3 scripts/gen_reference.py           # 就地重写 README 生成区
  python3 scripts/gen_reference.py --check   # 仅校验，不一致退出 1（validate 用）
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BEGIN = "<!-- generated: reference start · 本区由 scripts/gen_reference.py 生成，勿手改 -->"
END = "<!-- generated: reference end -->"


def _commands():
    cdir = os.path.join(ROOT, "commands")
    out = []
    for f in sorted(os.listdir(cdir)):
        if not f.endswith(".md"):
            continue
        name = f[:-3]
        desc = ""
        try:
            head = open(os.path.join(cdir, f), encoding="utf-8").read(500)
            m = re.search(r"^description:\s*(.+)$", head, re.M)
            if m:
                desc = m.group(1).strip()
        except (IOError, OSError):
            pass
        out.append((name, desc))
    return out


def _hook_registrations():
    """P2#32 真派生：从 hooks.json 数事件条目（插件模式单一来源；旧实现
    grep install.sh 的 matcher 关键字把 e.get("matcher") 比较语句也计入，
    README 带错误数字还被 check_docs 背书）。"""
    try:
        import json as _json
        h = _json.load(open(os.path.join(ROOT, "hooks", "hooks.json"),
                            encoding="utf-8"))
        ev = h.get("hooks") or h
        return sum(len(entries) for entries in ev.values())
    except (IOError, OSError, ValueError):
        return 0


def _test_count():
    total = 0
    tdir = os.path.join(ROOT, "tests")
    for f in os.listdir(tdir):
        if f.startswith("test_") and f.endswith(".py"):
            try:
                total += len(re.findall(r"^def test_", 
                           open(os.path.join(tdir, f), encoding="utf-8").read(), re.M))
            except (IOError, OSError):
                pass
    return total


def render():
    cmds = _commands()
    lines = [BEGIN, "", "**实况（由 gen_reference.py 生成，勿手改本区）**", "",
             f"- 命令：{len(cmds)} 个 · hook 注册：{_hook_registrations()} 个事件条目 · "
             f"测试函数：{_test_count()} 个", "", "| 命令 | 说明 |", "|---|---|"]
    for name, desc in cmds:
        lines.append(f"| `/{name}` | {desc or '—'} |")
    lines += ["", END]
    return "\n".join(lines)


def apply(readme_path=None, check=False):
    path = readme_path or os.path.join(ROOT, "README.md")
    content = open(path, encoding="utf-8").read()
    expected = render()
    pattern = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.DOTALL)
    if not pattern.search(content):
        new = content.rstrip() + "\n\n" + expected + "\n"
        if check:
            print("gen_reference: README 缺生成区（先跑不带 --check 的本脚本）", file=sys.stderr)
            return 1
        open(path, "w", encoding="utf-8").write(new)
        print(f"gen_reference: 生成区已插入（{len(_commands())} 命令）")
        return 0
    if check:
        current = pattern.search(content).group(0)
        if current != expected:
            print("gen_reference: 生成区与实况不一致——跑 python3 scripts/gen_reference.py 更新",
                  file=sys.stderr)
            return 1
        print("gen_reference: 生成区一致 ✓")
        return 0
    new = pattern.sub(lambda _: expected, content, count=1)
    open(path, "w", encoding="utf-8").write(new)
    print(f"gen_reference: 生成区已刷新（{len(_commands())} 命令）")
    return 0


if __name__ == "__main__":
    sys.exit(apply(check="--check" in sys.argv))
