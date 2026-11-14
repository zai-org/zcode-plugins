#!/usr/bin/env python3
"""被拒批缓冲（v1.91.1，批 109：稳定性条件 5 补法）。

SkillOpt 的 rejected-edit buffer：被拒编辑进缓冲区，优化器不再重提。本仓的
"被拒"有三源——decisions.md 的否决/砍批条目、清单 status: cancelled、journal
里 verdict 含反对语义的预审化石。预审 5a 步 0 先跑本检索：命中不是禁止
（新证据下重提合法），是**强制对照**——预审问句必须含"与已否决方案有何差异"。

用法：python3 veto_search.py <project_dir> "机制 关键词" [--days 90]
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta

_OBJECTION_WORDS = ("objection", "否决", "反对", "砍批", "不建", "不采纳",
                    "cancelled")


def _within_window(date_str, days):
    try:
        d = datetime.strptime(str(date_str)[:10], "%Y-%m-%d")
    except ValueError:
        return False
    return d >= datetime.now() - timedelta(days=days)


def _match(text, terms):
    return all(t.lower() in text.lower() for t in terms)


def search(project_dir, query, days=90):
    """三源检索近 N 天被拒/否决记录。query 空格分词=AND 匹配。"""
    terms = [t for t in query.split() if t]
    if not terms:
        return []
    hits = []
    regress = os.path.join(project_dir, ".regress")

    # 源一：decisions.md 按 ## 日期分节（须含否决语义——命中的分节可能只是
    # "做了 X"而非"否决了 X"，纯关键词会 FP）
    dp = os.path.join(regress, "decisions.md")
    try:
        with open(dp, encoding="utf-8") as f:
            sections = re.split(r"\n(?=## )", f.read())
        for sec in sections:
            m = re.match(r"## (\d{4}-\d{2}-\d{2})", sec)
            if not m or not _within_window(m.group(1), days):
                continue
            if not any(w in sec for w in ("否决", "砍批", "不采纳", "不建")):
                continue
            if _match(sec, terms):
                first = sec.strip().splitlines()[0][:80]
                hits.append({"source": "decisions", "date": m.group(1),
                             "excerpt": first})
    except (IOError, OSError):
        pass

    # 源二：cancelled 清单（含 cancel_reason）
    mdir = os.path.join(regress, "manifests")
    try:
        for name in sorted(os.listdir(mdir)):
            p = os.path.join(mdir, name)
            if not os.path.isfile(p):
                continue
            try:
                with open(p, encoding="utf-8") as f:
                    body = f.read()
            except (IOError, OSError):
                continue
            if "status: cancelled" not in body:
                continue
            dm = re.search(r"created_at: '?(\d{4}-\d{2}-\d{2})", body)
            if dm and not _within_window(dm.group(1), days):
                continue
            if _match(body, terms):
                cm = re.search(r"cancel_reason: '?([^'\n]{0,100})", body)
                hits.append({
                    "source": "cancelled-manifest", "date":
                        dm.group(1) if dm else "?", "name": name,
                    "excerpt": (cm.group(1) if cm
                                else body.strip().splitlines()[0][:80])})
    except (IOError, OSError):
        pass

    # 源三：journal 反对语义预审化石
    jp = os.path.join(regress, "journal", "events.jsonl")
    try:
        with open(jp, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    j = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if j.get("kind") != "plan_advisor_review":
                    continue
                blob = json.dumps(j, ensure_ascii=False)
                if not any(w in blob for w in _OBJECTION_WORDS):
                    continue
                if not _match(blob, terms):
                    continue
                ts = str(j.get("ts") or "")[:10]
                if ts and not _within_window(ts, days):
                    continue
                hits.append({"source": "journal-objection", "date": ts or "?",
                             "excerpt": str(
                                 j.get("summary") or j.get("verdict")
                                 or "")[:80]})
    except (IOError, OSError):
        pass
    return hits


def main():
    if len(sys.argv) < 3:
        print("用法：veto_search.py <project_dir> '机制 关键词' [--days 90]",
              file=sys.stderr)
        sys.exit(1)
    project_dir = sys.argv[1]
    query = sys.argv[2]
    days = 90
    if "--days" in sys.argv:
        try:
            days = int(sys.argv[sys.argv.index("--days") + 1])
        except (ValueError, IndexError):
            pass
    hits = search(project_dir, query, days)
    if not hits:
        print(f"被拒缓冲：无命中（{days} 天内，terms={query.split()}）——"
              "无已否决方案对照义务")
        return
    print(f"被拒缓冲：{len(hits)} 命中（{days} 天）——预审必须问「与已否决"
          "方案有何差异」，清单注已否决对照：")
    for h in hits:
        print(f"  [{h['source']} {h['date']}] {h['excerpt']}")


if __name__ == "__main__":
    main()
