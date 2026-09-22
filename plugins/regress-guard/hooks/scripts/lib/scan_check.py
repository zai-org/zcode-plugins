#!/usr/bin/env python3
"""scan_check — 全貌新鲜度判定（v1.40：理解是强制产物，不是气氛）。

对标 spec-first（Kiro/spec-kit）：理解本身是可检查的产物。本脚本回答
「模块卡片落后代码多少」——卡片最后提交 vs 期间代码提交量 / 结构性增删文件。
plan 步骤 2a 消费（--json）；人读直接跑。

判定（阈值：<3 次代码提交且无结构性增删 = fresh）：
  fresh   卡片与代码同步
  stale   期间代码提交 >=3 或有结构性增删（ADR 事件，tests/docs/md 豁免）→ 重扫受影响卡
  absent  无卡片 → M/L 先 init 产品层或声明纯库项目（命令纪律位，门禁另有警示）

已知边界（FP2）：双仓项目（卡片在外仓、代码在内仓）以治理仓活动为代理——
代码大动而治理仓零提交时会误报 fresh；门禁规则B 看 staged 实况，不受此影响。

用法：
  scan_check.py .            # 人读一行判定
  scan_check.py . --json     # 机器读（plan 2a）
"""
import argparse
import json
import os
import subprocess
import sys


def _git(repo, *args):
    try:
        r = subprocess.run(["git", "-C", repo, *args], capture_output=True,
                           text=True, timeout=10)
        return r.stdout.strip() if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _structural(path):
    """结构性路径判据（与门禁规则B 同口径：tests/docs/md 是模块的元数据不是模块）。"""
    p = path.replace(os.sep, "/")
    return not (p.startswith("tests/") or p.startswith("docs/")
                or p.endswith(".md") or p.startswith(".regress/"))


def check(project_dir):
    """返回判定 dict。卡片从未提交（刚 init）视为 fresh——时间锚取当天。"""
    card_rel = ".regress/product-arch.md"
    card = os.path.join(project_dir, card_rel)
    if not os.path.exists(card):
        return {"verdict": "absent", "card": card_rel,
                "note": "无模块卡片——M/L 先 init 产品层，或纯库项目声明无产品面"}
    sha = _git(project_dir, "log", "-1", "--format=%H", "--", card_rel)
    iso = _git(project_dir, "log", "-1", "--format=%cI", "--", card_rel)
    commits, structural = 0, []
    if sha:
        # 用 sha 区间而非 --since：同秒提交会让时间戳粒度把卡片提交之前的
        # init 也圈进来（测试实测），区间无此歧义且天然排除卡片提交自身
        rng = f"{sha}..HEAD"
        log = _git(project_dir, "log", "--oneline", rng, "--", ".",
                   ":(exclude).regress")
        commits = len([l for l in log.splitlines() if l.strip()])
        ad = _git(project_dir, "log", "--diff-filter=ADR", "--name-only",
                  "--format=", rng, "--", ":(exclude).regress",
                  ":(exclude)tests", ":(exclude)docs", ":(exclude)*.md")
        structural = sorted({l for l in ad.splitlines()
                             if l.strip() and _structural(l)})
    verdict = "stale" if (commits >= 3 or structural) else "fresh"
    return {"verdict": verdict, "card": card_rel,
            "card_last_commit": iso or "未提交",
            "code_commits_since": commits, "structural_changes": structural[:8]}


def main(argv=None):
    ap = argparse.ArgumentParser(description="全貌新鲜度判定（v1.40）")
    ap.add_argument("project_dir", help="项目目录（. 通常够用）")
    ap.add_argument("--json", action="store_true", help="机器读")
    args = ap.parse_args(argv)
    project_dir = os.path.abspath(args.project_dir)
    r = check(project_dir)
    if args.json:
        print(json.dumps(r, ensure_ascii=False))
        return 0
    zh = {"fresh": "✅ fresh 卡片与代码同步", "stale": "🧊 stale 卡片落后代码",
          "absent": "⚠️ absent 无模块卡片"}
    print(zh[r["verdict"]])
    if r["verdict"] == "stale":
        print(f"  卡片最后提交：{r['card_last_commit']}")
        print(f"  期间代码提交：{r['code_commits_since']} 次")
        if r["structural_changes"]:
            print(f"  结构性增删：{', '.join(r['structural_changes'])}")
        print("  → plan 步骤 2a：重扫受影响模块卡再继续（看不全就对不准）")
    elif r["verdict"] == "absent":
        print(f"  {r['note']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
