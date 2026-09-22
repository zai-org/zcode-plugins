#!/usr/bin/env python3
"""pending — 决策推送待决台账（v1.34 推送闭环）。

告警三段位的第二三段：可达（不沉默）已打赢，本层补「可度量+可校准」——
决策型推送（plan_approval/blocked/sensory/finish_open）送出即落一条待决
记录，人类的 outcome（useful/fp/ignored）回流后形成误报率——推送策略的
校准指标（防 alert fatigue：噪音推送腐蚀信任；「推送了但没用」与「该推没推」
是对称的病，都要可见）。

账本：~/.zcode/regress-pending.jsonl（机器级 append-only：add/resolve 各一行，
重放重建状态；RG_PENDING_LEDGER 可注入测试）。**台账记决策不记送达**——
决策点真实存在（计划在等批准、任务在受阻），推送失败也留账。

v1.38 blocked 合并（降噪）：同「项目+ref+拦截原因指纹」的未决记录在窗口内
被 notify 层折叠——折叠不重发不重记账，只追加 merge_into 旁路行（折叠量
本身是校准数据：治了多少 alert fatigue 要看得见）。

用法：
  pending.py add --project X --event blocked --title "🛑 受阻 REGRESS-x"
  pending.py list [--pending]
  pending.py resolve 3 useful      # useful=有用 fp=误报 ignored=忽略
  pending.py stats
"""
import argparse
import datetime
import json
import os
import sys

OUTCOMES = ("useful", "fp", "ignored")


def _path():
    return os.environ.get("RG_PENDING_LEDGER") or os.path.join(
        os.path.expanduser("~/.zcode"), "regress-pending.jsonl")


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _append(rec):
    os.makedirs(os.path.dirname(_path()), exist_ok=True)
    with open(_path(), "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _load():
    """重放账本：返回 (待决 dict, 已决 dict)。坏行跳过（台账是增强不是依赖）。"""
    adds, resolves = {}, {}
    try:
        with open(_path(), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if "resolve_id" in e:
                    resolves[int(e["resolve_id"])] = e
                elif "id" in e:
                    adds[int(e["id"])] = e
    except (IOError, OSError):
        pass
    return adds, resolves


def add(project, event, title, ref="", fp=""):
    """落一条待决记录，返回分配的 id（notify 层预分配进推送正文〔待决#N〕）。

    ref（P0-3 回流接线，评审批次一）：结构化来源标识（清单 id）——
    plan_approve 批准/取消时按它精确 resolve，不靠标题猜。
    fp（v1.38）：拦截原因指纹——blocked 合并键第三维（顾问修正：同清单
    不同原因的拦截是不同决策点，不能互相折叠）。
    P2#21：max+1 分配加 flock——两会话同推不再拿到同 id（重放去重吞记录）。"""
    from filelock import file_lock
    with file_lock(_path()):
        adds = _load()[0]
        nid = (max(adds) if adds else 0) + 1
        _append({"id": nid, "ts": _now(), "project": str(project)[:60],
                 "event": str(event)[:20], "title": str(title)[:80],
                 "ref": str(ref)[:60], "fp": str(fp)[:16]})
    return nid


def resolve(pid, outcome):
    """回流人类裁决。outcome ∈ useful/fp/ignored；重复 resolve 以最后为准。"""
    if outcome not in OUTCOMES:
        raise ValueError(f"outcome 必须是 {'/'.join(OUTCOMES)}")
    _append({"resolve_id": int(pid), "ts": _now(), "outcome": outcome})
    return True


def resolve_by_ref(ref, outcome="useful"):
    """按结构化 ref 精确回流（P0-3）：resolve 该 ref 的全部未决记录，
    返回条数。兜底：无 ref 字段的旧记录按标题词边界唯一命中才处理
    （顾问补强：标题匹配只作唯一命中兜底，防误匹配）。"""
    import re as _re
    if not ref:
        return 0
    adds, resolves = _load()
    open_ids = [k for k in sorted(adds) if k not in resolves]
    hit_ref = [k for k in open_ids if adds[k].get("ref") == ref]
    legacy = [k for k in open_ids if not adds[k].get("ref")]
    pat = _re.compile(r"(?<![A-Za-z0-9-])" + _re.escape(ref) + r"(?![A-Za-z0-9-])")
    title_hits = [k for k in legacy if pat.search(adds[k].get("title", ""))]
    if len(title_hits) == 1:  # 唯一命中才兜底，多义不动
        hit_ref.append(title_hits[0])
    for k in hit_ref:
        _append({"resolve_id": int(k), "ts": _now(), "outcome": outcome,
                 "via": "auto(ref)"})
    return len(hit_ref)


def newest_open(project, ref="", fp=""):
    """最近一条同键（项目+ref+指纹）未决记录，无则 None——blocked 合并的
    窗口锚点。ref 空时仍按指纹折叠（顾问兜底：无清单的拦截，同项目同因
    也是同一决策点）。旧记录无 fp 字段按 "" 参与 match。"""
    adds, resolves = _load()
    best = None
    for k, e in adds.items():
        if k in resolves:
            continue
        if (e.get("project") != project or e.get("ref", "") != ref
                or e.get("fp", "") != fp):
            continue
        if best is None or e.get("ts", "") > best.get("ts", ""):
            best = e
    return best


def merge_note(nid):
    """折叠旁路行：不带 id/resolve_id，重放自然忽略，stats 单独计数。"""
    _append({"merge_into": int(nid), "ts": _now()})


def count_merged():
    try:
        with open(_path(), encoding="utf-8") as f:
            return sum(1 for line in f if '"merge_into"' in line)
    except (IOError, OSError):
        return 0


def pending_records():
    adds, resolves = _load()
    return {k: v for k, v in adds.items() if k not in resolves}


def stats():
    adds, resolves = _load()
    open_p = [e for k, e in sorted(adds.items()) if k not in resolves]
    res = list(resolves.values())
    by = {o: sum(1 for e in res if e.get("outcome") == o) for o in OUTCOMES}
    oldest = ""
    if open_p:
        ages = [(datetime.datetime.now() - datetime.datetime.fromisoformat(
                    e["ts"])).total_seconds() / 86400 for e in open_p]
        oldest = f"{max(ages):.1f}天"
    decided = by["useful"] + by["fp"] + by["ignored"]
    auto = sum(1 for e in res if e.get("outcome") == "resolved")
    return {"total": len(adds), "pending": len(open_p), "oldest_pending": oldest,
            "resolved": by, "auto_resolved": auto,
            "fp_rate": (by["fp"] / decided) if decided else None,
            "merged": count_merged(), "open": open_p}


def _fmt_row(e, mark):
    return f"  #{e['id']} {mark} {e['ts'][:16]} [{e['event']}] {e['title'][:50]}"


def main(argv=None):
    ap = argparse.ArgumentParser(description="决策推送待决台账")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add", help="落待决（通常由 notify 层自动调用）")
    a.add_argument("--project", required=True)
    a.add_argument("--event", required=True)
    a.add_argument("--title", required=True)
    l = sub.add_parser("list", help="列出记录（未决在前，已决只列最近 5 条）")
    l.add_argument("--pending", action="store_true", help="只看未决")
    r = sub.add_parser("resolve", help="回流人类裁决")
    r.add_argument("pid", type=int)
    r.add_argument("outcome", choices=OUTCOMES)
    sub.add_parser("stats", help="聚合：未决/裁决分布/误报率/折叠数")
    args = ap.parse_args(argv)

    if args.cmd == "add":
        print(f"〔待决#{add(args.project, args.event, args.title)}〕")
    elif args.cmd == "list":
        # v1.38：旧版判定查 adds 记录里的 resolve_id（永远不存在）→ 全显 ⏳，
        # 已决结局不可见（病例：18 行全 ⏳、stats 未决 14 对不上）
        adds, resolves = _load()
        _zh = {"useful": "有用", "fp": "误报", "ignored": "忽略",
               "resolved": "闭环(自动)"}
        open_ids = sorted(k for k in adds if k not in resolves)
        for k in open_ids:
            print(_fmt_row(adds[k], "⏳"))
        if args.pending:
            if not open_ids:
                print("  （空）")
        else:
            recent = sorted(resolves.values(),
                            key=lambda e: (e.get("ts", ""),
                                           int(e.get("resolve_id", 0))),
                            reverse=True)  # 同秒按 resolve_id 决胜：后裁决优先
            for e in recent[:5]:
                r = adds.get(int(e["resolve_id"]))
                if not r:
                    continue
                print(_fmt_row(r, f"✔{_zh.get(e.get('outcome'), '?')}"))
            if len(recent) > 5:
                print(f"  …另有 {len(recent) - 5} 笔已裁决（--pending 只看未决）")
            if not adds:
                print("  （空）")
    elif args.cmd == "resolve":
        resolve(args.pid, args.outcome)
        print(f"✔ #{args.pid} → {args.outcome}")
    else:
        s = stats()
        fp = "—" if s["fp_rate"] is None else f"{s['fp_rate']:.0%}"
        merged = f"｜blocked 折叠 {s['merged']} 次" if s["merged"] else ""
        print(f"待决台账：共 {s['total']} 条｜未决 {s['pending']}"
              f"（最老 {s['oldest_pending'] or '—'}）｜"
              f"裁决 有用{s['resolved']['useful']}/误报{s['resolved']['fp']}/"
              f"忽略{s['resolved']['ignored']}｜误报率 {fp}{merged}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
