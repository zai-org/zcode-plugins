#!/usr/bin/env python3
"""规律账本：沉淀 / 命中 / 衰变——带证据律的自改进的记账侧（v1.24）。

代谢链：地层是脂肪（原始病例），规律是肌肉（跨会话≥2 沉淀），skill 是骨骼
（命中≥3 经人批准固化）。账本只记账和提示，**永不自动删 AGENTS.md**（人类文件红线），
**固化建议只出卡片，批准权在人**（自动固化的错误经验会以技能的形式高速复发）。

用法：
  rules_ledger.py . record --sig "<失败签名>" --occurrences 5   # learn 沉淀/再检出时
  rules_ledger.py . health                                       # 衰变候选 + 固化候选
  rules_ledger.py . match --query "<拦截原因/报错关键词>"         # 召回：失败现场读路径（v1.53）
  rules_ledger.py . match --query "..." --json --top 3           # 机器读

数据：.regress/rules-ledger.json（随 git 入库）。命中定义：learn 再检出同一签名
（真实"被咨询"无法自动探测，再检出是务实代理——诚实边界，记录在案）。
"""
import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from journal import _find_project_dir  # noqa: E402  项目定位单一来源

DEFAULT_DECAY_DAYS = 180
PROMOTE_HITS = 3


def ledger_path(project_dir):
    return os.path.join(project_dir, ".regress", "rules-ledger.json")


def load(project_dir):
    try:
        with open(ledger_path(project_dir), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (IOError, OSError, json.JSONDecodeError):
        return {}


def _save(project_dir, data):
    os.makedirs(os.path.dirname(ledger_path(project_dir)), exist_ok=True)
    with open(ledger_path(project_dir), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)


NEAR_DUP_MIN = 6  # 近重复门槛：高于召回地板 3——误报提示比漏报更烦人


def record(project_dir, sig, occurrences=0):
    """记账：首次沉淀 hits=1；同签名再检出 = 命中一次（hits+1，last_hit 刷新）。

    新沉淀时自检近重复（v1.57 源头去重）：同一规律换个说法就成两条新账目是
    账本膨胀的主路径（实测：真实项目 3 周 18 节）。提示 print-only——
    自动合并的错误比膨胀更贵，人看一眼再决定 supersede。
    """
    data = load(project_dir)
    key = hashlib.sha1(sig.encode("utf-8")).hexdigest()[:12]
    today = date.today().isoformat()
    entry = data.get(key)
    if entry is None:
        data[key] = {"sig": sig, "captured_at": today, "last_hit": today,
                     "hits": 1, "occurrences": occurrences}
        action = "新沉淀"
    else:
        entry["sig"] = sig
        entry["hits"] = int(entry.get("hits", 1)) + 1
        entry["last_hit"] = today
        entry["occurrences"] = max(int(entry.get("occurrences", 0)), occurrences)
        action = f"命中（第 {entry['hits']} 次）"
    _save(project_dir, data)
    print(f"📒 {action}: 「{sig[:60]}」 occurrences={data[key]['occurrences']}")
    if action == "新沉淀":
        try:
            near = [r for r in match(project_dir, sig, top=2, min_shared=NEAR_DUP_MIN)
                    if r["sig"] != sig]
            for r in near:
                print(f"⚠️ 近重复候选: 「{r['sig'][:60]}」（hits={r['hits']}）——"
                      f"若是同一规律的改写，优先 supersede 旧版而非新增：\n"
                      f"   rules_ledger.py . supersede --old \"{r['sig'][:40]}…\" --new \"{sig[:40]}…\"")
        except Exception:
            pass  # 自检是增强：任何异常不碍记账
    return data[key]


def _days_since(iso):
    try:
        return (date.today() - date.fromisoformat(iso)).days
    except (ValueError, TypeError):
        return 0


def supersede(project_dir, old_sig, new_sig):
    """版本链接（v1.48，B3 迷你 Pareto 记忆）：learn 重写规律时把旧版链到新版。

    旧规律过气是**预期**不是病——被取代条目从降级候选摘出、health 单列。
    回滚信号判据（影子，账本有货前不启用）：新条目衰变 ≥2 周期 且 旧条目
    曾稳定 ≥2 周期 且 总命中下降，才提示回滚（顾问三条件防早停误回滚）。"""
    data = load(project_dir)
    ok = hashlib.sha1(old_sig.encode("utf-8")).hexdigest()[:12]
    nk = hashlib.sha1(new_sig.encode("utf-8")).hexdigest()[:12]
    sup = data.get("_superseded")
    if not isinstance(sup, dict):
        sup = {}
    sup[ok] = {"by": nk, "ts": date.today().isoformat(),
               "old_sig": old_sig[:60]}
    data["_superseded"] = sup
    _save(project_dir, data)
    print(f"🔗 已链接：旧「{old_sig[:40]}」→ 新「{new_sig[:40]}」")
    return True


MATCH_MIN_SHARED = 3    # 噪声地板：共享 bigram 少于此数不算相关
MATCH_STOP_RATIO = 0.6  # IDF-lite：bigram 出现在超过此比例的签名中 → 样板停用


def _bigrams(text):
    """字符 bigram（去空白、小写）——无分词依赖的中英混排召回基础。"""
    t = re.sub(r"\s+", "", str(text or "")).lower()
    return {t[i:i + 2] for i in range(len(t) - 1)}


def query_from_manifest(manifest_path):
    """从清单派生召回查询（v1.61 结构化查询面）：planned files + 脆弱点描述
    （前3条）+ scan.card 卡名——清单本身就是"动哪里/怕什么"的结构化自述。

    plan 步骤 2b 前召回/learn 沉淀前查重用；召回从"拦截至"扩到"开工前"。
    cap 300 字符防稀释；读不到返空串（查询是增强不是依赖）。
    """
    try:
        from manifest_parser import get_all_changed_files, get_fragile_points, parse_frontmatter
        terms = [f.replace(os.sep, "/") for f in get_all_changed_files(manifest_path)]
        for fp in get_fragile_points(manifest_path)[:3]:
            terms.append(str(fp.get("description") or "")[:60])
        fm = parse_frontmatter(manifest_path) or {}
        terms.append(str((fm.get("scan") or {}).get("card") or ""))
        return " ".join(t for t in terms if t)[:300]
    except Exception:
        return ""


def match(project_dir, query, top=3, min_shared=MATCH_MIN_SHARED):
    """召回（v1.53 读路径）：按 bigram 重叠数排序历史规律——骨架库不只回流，还能供给。

    排序 = 共享 bigram 数降序，同分先比 hits（历史命中）再比 last_hit（新鲜度）
    ——相关性优先，频率只作断路器（顾问：乘子会把"高频"伪装成"相关"）。
    样板停用（IDF-lite）：≥5 条时，出现在 >60% 签名里的 bigram（"定位/归因"这类
    格式样板词）不参与匹配，否则万物皆相关。被取代的旧签名不召回。
    """
    top = max(0, int(top))
    query = str(query or "").strip()
    if top <= 0 or not query:
        return []
    data = load(project_dir)
    entries = [e for k, e in data.items()
               if not str(k).startswith("_") and isinstance(e, dict) and e.get("sig")]
    if not entries:
        return []
    sup_map = data.get("_superseded") if isinstance(data.get("_superseded"), dict) else {}
    sup_sigs = {str(v.get("old_sig", "")) for v in sup_map.values()}
    sig_bgs = [(_bigrams(e["sig"]), e) for e in entries if e["sig"] not in sup_sigs]
    if not sig_bgs:
        return []
    q = _bigrams(query)
    stop = set()
    if len(sig_bgs) >= 5:  # 太小的账本停用过滤反而失真
        df = Counter(b for bgs, _ in sig_bgs for b in bgs)
        stop = {b for b, n in df.items() if n > len(sig_bgs) * MATCH_STOP_RATIO}
    q -= stop
    out = []
    for bgs, e in sig_bgs:
        shared = len(q & (bgs - stop))
        if shared >= min_shared:
            out.append({"sig": e["sig"], "hits": int(e.get("hits", 1)),
                        "last_hit": e.get("last_hit", ""), "score": shared})
    out.sort(key=lambda h: str(h["last_hit"]), reverse=True)   # 稳定预排：新鲜度断路
    out.sort(key=lambda h: (-h["score"], -h["hits"]))          # 主排序保持断路序
    return out[:top]


def health(project_dir, decay_days=DEFAULT_DECAY_DAYS, promote_hits=PROMOTE_HITS):
    """规律健康：降级候选（>decay_days 零命中）+ 固化候选（hits≥promote_hits 且未腐化）。

    降级候选只提示人工修剪；固化候选只建议（人批准后经 skill-creator 固化为宿主 skill）。
    """
    data = load(project_dir)
    entries = sorted((e for k, e in data.items()
                      if k != "_superseded" and isinstance(e, dict)
                      and e.get("sig")), key=lambda e: -int(e.get("hits", 0)))
    sup_map = data.get("_superseded") if isinstance(data.get("_superseded"), dict) else {}
    sup_sigs = {str(v.get("old_sig", "")) for v in sup_map.values()}
    stale = [e for e in entries
             if _days_since(e.get("last_hit", "")) > decay_days
             and e["sig"] not in sup_sigs]  # 被取代规律过气=预期，非降级候选
    stale_keys = {id(e) for e in stale}
    promotable = [e for e in entries
                  if id(e) not in stale_keys and int(e.get("hits", 0)) >= promote_hits]
    print(f"规律总数 {len(entries)}｜命中≥{promote_hits}（固化候选）{len(promotable)}｜"
          f">{decay_days}天零命中（降级候选）{len(stale)}")
    for e in promotable:
        print(f"  🦴 固化候选 hits={e['hits']} 「{e['sig'][:50]}」"
              f"（建议经人批准用 skill-creator 固化）")
    for e in stale:
        print(f"  🍂 降级候选 last_hit={e.get('last_hit')} 「{e['sig'][:50]}」"
              f"（提示人工修剪——本工具永不自动删）")
    if sup_map:
        for v in list(sup_map.values())[:5]:
            print(f"  🔗 已取代 {v.get('ts')} 「{str(v.get('old_sig', ''))[:40]}」"
                  f"→ 新版（过气=预期，不算降级候选）")
    if not entries:
        print("  （空账本——learn 沉淀规律时自动记账）")
    return {"total": len(entries), "promotable": promotable, "stale": stale}


def main(argv=None):
    ap = argparse.ArgumentParser(description="规律账本（代谢链记账侧）")
    ap.add_argument("project_dir", help="项目目录（. 通常够用）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record", help="沉淀/再检出记账")
    r.add_argument("--sig", required=True, help="失败签名（规律的唯一键）")
    r.add_argument("--occurrences", type=int, default=0, help="累计出现次数（跨会话）")
    su = sub.add_parser("supersede", help="版本链接：旧规律被新版取代")
    su.add_argument("--old", required=True)
    su.add_argument("--new", required=True)
    m = sub.add_parser("match", help="召回：按关键词匹配历史规律（失败现场读路径）")
    m.add_argument("--query", default="", help="查询文本（拦截原因/报错关键词）")
    m.add_argument("--from-manifest", default="",
                   help="从清单派生查询（结构化：文件+脆弱点+卡名；与 --query 互斥）")
    m.add_argument("--top", type=int, default=3, help="召回条数上限")
    m.add_argument("--json", action="store_true", help="机器读（B2 门禁消费）")
    h = sub.add_parser("health", help="规律健康：降级候选 + 固化候选")
    h.add_argument("--decay-days", type=int, default=DEFAULT_DECAY_DAYS)
    h.add_argument("--promote-hits", type=int, default=PROMOTE_HITS)
    args = ap.parse_args(argv)
    project_dir = _find_project_dir(args.project_dir)
    if not project_dir:
        print("rules_ledger: 未找到 .regress/（项目未接入）", file=sys.stderr)
        return 1
    if args.cmd == "record":
        record(project_dir, args.sig, args.occurrences)
    elif args.cmd == "supersede":
        supersede(project_dir, args.old, args.new)
    elif args.cmd == "match":
        query = args.query or query_from_manifest(args.from_manifest)
        if args.from_manifest and not args.json:
            print(f"🔍 派生查询（from {os.path.basename(args.from_manifest)}）: {query[:120]}")
        res = match(project_dir, query, top=args.top)
        if args.json:
            print(json.dumps(res, ensure_ascii=False))
        elif not res:
            print("📚 无相关规律（账本空或共享 bigram 未达阈值）")
        else:
            print(f"📚 相关规律 TOP-{len(res)}（骨架库召回——提示不是行动，采纳前先对照本次现场）：")
            for i, r in enumerate(res, 1):
                print(f"  {i}. 「{r['sig'][:60]}」 命中×{r['hits']}（最近 {r['last_hit']}）")
    else:
        import io as _io, contextlib as _cb
        with _cb.redirect_stdout(_io.StringIO()) as buf:
            health(project_dir, args.decay_days, args.promote_hits)
        out = buf.getvalue()
        print(out, end="")
        # 固化候选=需要人类批准的决策点（v1.33 企业级）：出现即推送，
        # 不再只躺在报表里等人跑 stats（conftest 以 RG_NO_NOTIFY 隔离测试）
        if "固化候选" in out and "固化候选）0" not in out and \
                not os.environ.get("RG_NO_NOTIFY"):
            try:
                sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
                from notify import notify as _notify
                n = out.count("🦴 固化候选")
                _notify(project_dir, "plan_approval",
                        f"🦴 固化候选 ×{n}",
                        "规律命中≥3 可固化为 skill——需要你批准（/regress:stats 查看详情）")
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
