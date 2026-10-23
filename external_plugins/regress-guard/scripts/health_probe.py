#!/usr/bin/env python3
"""health_probe — 巡检二探针聚合器（v1.98.0，131：v2.14 勘误伴生）。

两类实战失败的根治：①漏跑（run26 漏 v2.12 探针——软惯例）②崩失察（批127
ISO 注册行令 features 崩两日无面叫红）。哨兵轮改跑这一条命令：

    python3 scripts/health_probe.py [workspace_dir]

逐条 ✓/❌（退出码+stderr 尾行），任一崩/超时/零输出 → 整体 exit 1。
只治「崩与漏的可见性」，数字语义解读（阈值判断）仍归哨兵——退出码≠业务异常
（顾问硬条件：不承诺病可见，只承诺崩可见）。

探针清单=本文件 PROBES（单一事实源，协议 v2.14 勘误锚）：协议新增探针时
必须同步此清单（漂移史两轮后复盘是否需要解析协议文本生成）。
"""
import os
import subprocess
import sys

HOOKS = os.path.expanduser("~/.zcode/regress-guard-hooks")
_LIB = os.path.join(HOOKS, "lib")
PER_PROBE_TIMEOUT = 30  # 每条独立超时（顾问：超时也是 ❌ 不是挂起）

# 探针清单（单一事实源）——协议 v2 巡检二命令 + v2.12 追加两条 + 仓洁净度。
# (标签, 命令)——cwd 为工作区根（含 .regress）。
PROBES = [
    ("notify.stats", [sys.executable, f"{_LIB}/notify.py", "stats"]),
    ("history.heatmap", [sys.executable, f"{_LIB}/history.py", ".regress", "heatmap"]),
    ("history.recall", [sys.executable, f"{_LIB}/history.py", ".regress", "recall"]),
    ("history.nudge", [sys.executable, f"{_LIB}/history.py", ".regress", "nudge"]),
    ("journal.adoption", [sys.executable, f"{_LIB}/journal.py", ".", "adoption"]),
    ("facts.health", [sys.executable, f"{_LIB}/facts.py", "health"]),
    ("rules_ledger.health", [sys.executable, f"{_LIB}/rules_ledger.py", ".", "health"]),
    ("history.features", [sys.executable, f"{_LIB}/history.py", ".regress", "features"]),
    ("history.cache", [sys.executable, f"{_LIB}/history.py", ".regress", "cache"]),
    # empty_ok 语义（132）：只给"空输出=健康"的探针——仓洁净 status 空=✓。
    # 数据探针默认零输出=❌（防真静默被掩盖）——新增探针勿随手加 empty_ok。
    ("repo.clean", ["git", "-C",
                    os.path.join(os.path.dirname(os.path.dirname(
                        os.path.abspath(__file__))), "..", "regress-guard"),
                    "status", "--short"], True),
]


def _tail(text, n=120):
    return (text or "").strip().splitlines()[-1][:n] if (text or "").strip() else ""


def run_probes(workspace=None, probes=None, timeout=PER_PROBE_TIMEOUT):
    """跑全部探针，返回 (rows, overall_ok)。rows=[(标签, ok, detail)]。

    崩/超时/零输出都是 ❌——零输出探针=静默层（131 心虚探测位的机器化）。
    """
    workspace = workspace or os.getcwd()
    rows, ok_all = [], True
    for entry in (probes or PROBES):
        label, cmd = entry[0], entry[1]
        empty_ok = entry[2] if len(entry) > 2 else False
        try:
            p = subprocess.run(cmd, capture_output=True, text=True,
                               cwd=workspace, timeout=timeout)
            out = (p.stdout or "") + (p.stderr or "")
            ok = (p.returncode == 0
                  and (bool((p.stdout or "").strip()) or empty_ok))
            if not ok:
                why = _tail(p.stderr) or _tail(p.stdout)
                detail = f"exit {p.returncode}: {why}" if p.returncode else (
                    "zero stdout: " + why)
            else:
                detail = ""
        except subprocess.TimeoutExpired:
            ok, detail = False, f"timeout >{timeout}s"
        except (OSError, ValueError) as e:
            ok, detail = False, f"spawn fail: {e}"
        rows.append((label, ok, detail))
        ok_all = ok_all and ok
    return rows, ok_all


def main():
    ws = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    try:
        rows, ok = run_probes(ws)
    except Exception as e:  # 自崩大声（顾问：脚本静默失败=新的失察层）
        print(f"❌ health_probe 自身异常: {e}", file=sys.stderr)
        sys.exit(2)
    for label, ok, detail in rows:
        mark = "✓" if ok else "❌"
        suffix = f"  ← {detail}" if detail else ""
        print(f"  {mark} {label}{suffix}")
    if not ok:
        print("❌ 巡检探针有崩/超时/零输出——红要自己叫出来（131）", file=sys.stderr)
        sys.exit(1)
    print("  探针全绿（数字语义解读仍归哨兵——退出码≠业务异常）")


if __name__ == "__main__":
    main()
