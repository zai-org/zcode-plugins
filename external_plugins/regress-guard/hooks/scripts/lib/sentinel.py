#!/usr/bin/env python3
"""sentinel — 哨兵视图（v1.34 会话作用域）：一屏看清"谁在动什么"。

collar-daemon 启示（淘天文章研判 2026-09-07）：多会话的冲突只在集成点
现形，任何单个会话都看不见别人的活跃清单。本视图不检测不拦截（那是
门禁/边界守卫的活），只提供"谁的开发机都没有的全局视野"——提交/动手
前扫一眼，跨会话文件重叠在变成事故前先对焦。

悬停判定：in-progress/verifying >24h ⚠️（卡死或被遗忘）；planning >48h
（等批准等太久）；blocked 一律 🛑（在等人类）。

用法：sentinel.py [project_dir]（缺省 .）
"""
import glob
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from journal import _find_project_dir  # noqa: E402  项目定位单一来源

_ACTIVE = ("planning", "in-progress", "verifying", "blocked")


def _age_days(path):
    try:
        return (time.time() - os.path.getmtime(path)) / 86400
    except (IOError, OSError):
        return 0.0


def _fm_get(path, key):
    """frontmatter 顶层字段（轻量正则，不拉 YAML 依赖）。"""
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
    except (IOError, OSError):
        return ""
    fm = content.split("---", 2)[1] if content.startswith("---") else ""
    import re
    m = re.search(rf"^{key}:\s*[\"']?([^\s\"'\n#]+)", fm, re.M)
    return m.group(1) if m else ""


def scan(project_dir):
    """返回 [(path, id, status, session, age_days, files_n)]，活跃清单。"""
    mdir = os.path.join(project_dir, ".regress", "manifests")
    out = []
    for p in sorted(glob.glob(os.path.join(mdir, "*.md"))):
        status = _fm_get(p, "status")
        if status not in _ACTIVE:
            continue
        from manifest_parser import get_all_changed_files
        try:
            files_n = len(get_all_changed_files(p))
        except Exception:
            files_n = 0
        out.append((p, _fm_get(p, "id") or os.path.basename(p), status,
                    _fm_get(p, "session"), _age_days(p), files_n))
    return out


def render(project_dir):
    rows = scan(project_dir)
    my_sid = (os.environ.get("CLAUDE_SESSION_ID")
              or os.environ.get("ZCODE_SESSION_ID") or "")
    print("═══ 哨兵视图：活跃清单 × 会话归属 ═══")
    if not rows:
        print("  （无活跃清单——疆域干净）")
        return rows
    for p, mid, status, sid, age, files_n in rows:
        who = "本会话" if (sid and sid == my_sid) else ("共享/无戳" if not sid else f"他会话 {sid[:8]}…")
        hover = ""
        if status == "blocked":
            hover = " 🛑 在等人类"
        elif status in ("in-progress", "verifying") and age > 1:
            hover = f" ⚠️ 悬停 {age:.0f} 天（卡死或被遗忘？）"
        elif status == "planning" and age > 2:
            hover = f" ⚠️ 待批准 {age:.0f} 天"
        print(f"  [{status:<10}] {mid} · {who} · {files_n} 文件 · 改于 {age:.1f} 天前{hover}")
    # 跨会话文件重叠（真正的集成态风险点）：只看带 session 戳的清单
    from manifest_parser import get_all_changed_files
    owners = {}
    for p, mid, _, sid, _, _ in rows:
        if not sid:
            continue
        try:
            for f in get_all_changed_files(p):
                owners.setdefault(f.replace(os.sep, "/"), set()).add(sid[:8])
        except Exception:
            pass
    clash = {f: s for f, s in owners.items() if len(s) > 1}
    if clash:
        print("  🔀 多会话声明了同一文件（提交前先对焦）：")
        for f, s in sorted(clash.items())[:8]:
            print(f"     {f} ← {' & '.join(sorted(s))}")
    return rows


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    start = argv[0] if argv else "."
    project_dir = _find_project_dir(start)
    if not project_dir:
        print("sentinel: 未找到 .regress/（项目未接入）", file=sys.stderr)
        return 1
    render(project_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
