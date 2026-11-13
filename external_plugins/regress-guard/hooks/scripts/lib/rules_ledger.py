#!/usr/bin/env python3
"""规律账本：沉淀 / 命中 / 衰变——带证据律的自改进的记账侧（v1.24）。

代谢链：地层是脂肪（原始病例），规律是肌肉（跨会话≥2 沉淀），skill 是骨骼
（命中≥3 经人批准固化）。账本只记账和提示，**永不自动删 AGENTS.md**（人类文件红线），
**固化建议只出卡片，批准权在人**（自动固化的错误经验会以技能的形式高速复发）。

用法：
  rules_ledger.py . record --sig "<失败签名>" --occurrences 5   # learn 沉淀/再检出时
  rules_ledger.py . health                                       # 衰变候选 + 固化候选 + shadow 队列
  rules_ledger.py . match --query "<拦截原因/报错关键词>"         # 召回：失败现场读路径（v1.53）
  rules_ledger.py . match --query "..." --json --top 3           # 机器读
  rules_ledger.py . case                                         # 批150：shadow 晋升证据卡（度量自动）
  rules_ledger.py . sweep                                        # 批150：饿死退役（幂等留档）
  rules_ledger.py . promote --sig "<签名>"                       # 批150：人裁晋升/复活（curated）

数据：.regress/rules-ledger.json（随 git 入库）。命中定义：learn 再检出同一签名
（真实"被咨询"无法自动探测，再检出是务实代理——诚实边界，记录在案）。

生命周期（批150 curation）：shadow（新录默认——照常召回/计 fires，差别只在
策展簿记）→ curated（人裁 promote 盖章）| retired（sweep 饿死或人工退役，留档
不删、退出版本召回、promote 可复活）。curated 永不自动退役。饿死线=超 TTL
（config rules_ledger.shadow_ttl_days，默认 60 天）且 hits<2——低频项目调大。
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
DEFAULT_SHADOW_TTL_DAYS = 60


def ledger_path(project_dir):
    return os.path.join(project_dir, ".regress", "rules-ledger.json")


def load(project_dir):
    try:
        with open(ledger_path(project_dir), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (IOError, OSError, json.JSONDecodeError):
        return {}


def _ledger_lock(project_dir):
    """读改写临界区（v1.108 批160 §17）：锁覆盖 load→mutate→_save 全程——
    只锁 _save 锁不住「两个进程都读旧账、各写各的」丢更新（并发测试实测
    逮住）。filelock 缺席平台降级无锁（v1.95.1 语义：锁是增强不是依赖）。
    makedirs 前置：裸项目首跑 record 时 .regress/ 尚不存在，锁文件 open
    会 FileNotFoundError（旧 _save 的 makedirs 在锁后，时序倒了）。"""
    try:
        from filelock import file_lock
        path = ledger_path(project_dir)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return file_lock(path)
    except ImportError:
        from contextlib import nullcontext
        return nullcontext()


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
    with _ledger_lock(project_dir):  # §17：读改写全程（含近重复自检的读）
        data = load(project_dir)
        key = hashlib.sha1(sig.encode("utf-8")).hexdigest()[:12]
        today = date.today().isoformat()
        entry = data.get(key)
        if entry is None:
            # 批150：新录默认 shadow——知识先影子服役攒证据，晋升是人裁（材料包 A
            # 病理根治：度量自动、人只守晋升）
            data[key] = {"sig": sig, "captured_at": today, "last_hit": today,
                         "hits": 1, "occurrences": occurrences,
                         "lifecycle": "shadow", "shadow_since": today}
            action = "新沉淀（shadow）"
        else:
            entry["sig"] = sig
            entry["hits"] = int(entry.get("hits", 1)) + 1
            entry["last_hit"] = today
            entry["occurrences"] = max(int(entry.get("occurrences", 0)), occurrences)
            action = f"命中（第 {entry['hits']} 次）"
            if entry.get("lifecycle") == "retired":
                # 再检出=生命证据：饿死误杀的复活通道（回 shadow 重新攒证据）
                entry["lifecycle"] = "shadow"
                entry["shadow_since"] = today
                entry.pop("retire_reason", None)
                action += "（retired 复活→shadow）"
        _save(project_dir, data)
        print(f"📒 {action}: 「{sig[:60]}」 occurrences={data[key]['occurrences']}")
    if action.startswith("新沉淀"):
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


def _shadow_ttl_days(project_dir):
    """批150：shadow 饿死线（config 可调，坏值回默认——低频项目调大）。"""
    try:
        with open(os.path.join(project_dir, ".regress", "config.json"),
                  encoding="utf-8") as f:
            cfg = json.load(f)
        v = (cfg.get("rules_ledger") or {}).get("shadow_ttl_days")
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
            return int(v)
    except Exception:
        pass
    return DEFAULT_SHADOW_TTL_DAYS


def supersede(project_dir, old_sig, new_sig):
    """版本链接（v1.48，B3 迷你 Pareto 记忆）：learn 重写规律时把旧版链到新版。

    旧规律过气是**预期**不是病——被取代条目从降级候选摘出、health 单列。
    回滚信号判据（影子，账本有货前不启用）：新条目衰变 ≥2 周期 且 旧条目
    曾稳定 ≥2 周期 且 总命中下降，才提示回滚（顾问三条件防早停误回滚）。"""
    with _ledger_lock(project_dir):  # §17：读改写全程
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
               if not str(k).startswith("_") and isinstance(e, dict)
               and e.get("sig") and e.get("lifecycle") != "retired"]
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
                        "last_hit": e.get("last_hit", ""), "score": shared,
                        "lifecycle": e.get("lifecycle") or "curated"})
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
    ttl = _shadow_ttl_days(project_dir)
    shadow_q = [e for e in entries if e.get("lifecycle") == "shadow"]
    starved = [e for e in shadow_q
               if _days_since(e.get("captured_at", "")) > ttl
               and int(e.get("hits", 0)) < 2]
    stale = [e for e in entries
             if _days_since(e.get("last_hit", "")) > decay_days
             and e["sig"] not in sup_sigs]  # 被取代规律过气=预期，非降级候选
    stale_keys = {id(e) for e in stale}
    promotable = [e for e in entries
                  if id(e) not in stale_keys and int(e.get("hits", 0)) >= promote_hits]
    print(f"规律总数 {len(entries)}｜命中≥{promote_hits}（固化候选）{len(promotable)}｜"
          f">{decay_days}天零命中（降级候选）{len(stale)}｜"
          f"shadow 队列 {len(shadow_q)}（饿死候选 {len(starved)}，TTL {ttl} 天）")
    for e in promotable:
        print(f"  🦴 固化候选 hits={e['hits']} 「{e['sig'][:50]}」"
              f"（建议经人批准用 skill-creator 固化）")
    for e in stale:
        print(f"  🍂 降级候选 last_hit={e.get('last_hit')} 「{e['sig'][:50]}」"
              f"（提示人工修剪——本工具永不自动删）")
    if shadow_q:
        print("  🔬 shadow 队列（批150 晋升管线——case 看证据卡，sweep 清饿死）：")
        for e in shadow_q[:5]:
            mark = " 🥀饿死候选" if e in starved else ""
            print(f"    🔬 hits={e.get('hits')} 服役{_days_since(e.get('captured_at', ''))}天"
                  f" 「{e['sig'][:46]}」{mark}")
    if sup_map:
        for v in list(sup_map.values())[:5]:
            print(f"  🔗 已取代 {v.get('ts')} 「{str(v.get('old_sig', ''))[:40]}」"
                  f"→ 新版（过气=预期，不算降级候选）")
    if not entries:
        print("  （空账本——learn 沉淀规律时自动记账）")
    return {"total": len(entries), "promotable": promotable, "stale": stale,
            "shadow": shadow_q, "starved": starved}


def _candidates_fp(res):
    """固化候选集合指纹（v1.108 批160，PHILOSOPHY §17 幂等键）：
    sig 排序后哈希——集合不变则键不变（hits 增长不改键，日频 health 重跑
    不重推不重记账），sig 增减=新决策点新开待决。"""
    sigs = sorted(str(e.get("sig", "")) for e in (res or {}).get("promotable", []))
    return hashlib.sha1("|".join(sigs).encode("utf-8")).hexdigest()[:8]


def case(project_dir, top=5):
    """批150：shadow 条目晋升证据卡——度量自动，人只守晋升（材料包 A 病理根治）。

    证据=账本 fires（hits/occurrences/服役天数）+history 召回开火联查
    （rule_recall 事件 sigs 计数）。建议三态：hits≥PROMOTE_HITS=晋升（与
    health 固化候选同源阈值）；超 TTL 且 hits<2=退役；否则 hold。
    """
    ttl = _shadow_ttl_days(project_dir)
    data = load(project_dir)
    shadow = sorted((e for k, e in data.items()
                     if not str(k).startswith("_") and isinstance(e, dict)
                     and e.get("sig") and e.get("lifecycle") == "shadow"),
                    key=lambda e: -int(e.get("hits", 0)))
    fires = {}
    try:
        with open(os.path.join(project_dir, ".regress", "history.jsonl"),
                  encoding="utf-8") as f:
            for line in f:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                # 两处开火源都计（批151 验收修）：门禁现场（event=rule_recall，
                # sigs 列表）+开工前（note=rule_recall_fired，sig 单值）；
                # 事件侧签名截断到 60 字符——联查键同截断对齐防失配
                if ev.get("event") == "rule_recall":
                    for s in ev.get("sigs") or []:
                        fires[str(s)[:60]] = fires.get(str(s)[:60], 0) + 1
                elif ev.get("note") == "rule_recall_fired":
                    s = str(ev.get("sig") or "")[:60]
                    if s:
                        fires[s] = fires.get(s, 0) + 1
    except OSError:
        pass  # 无 history=零开火，证据卡照出
    cards = []
    for e in shadow[:top]:
        age = _days_since(e.get("captured_at", ""))
        f_n = fires.get(str(e["sig"])[:60], 0)
        hits = int(e.get("hits", 0))
        verdict = ("晋升" if hits >= PROMOTE_HITS
                   else "退役" if (age > ttl and hits < 2) else "hold")
        cards.append({"sig": e["sig"], "hits": hits,
                      "occurrences": int(e.get("occurrences", 0)),
                      "age_days": age, "fires": f_n, "verdict": verdict})
        print(f"🔬 「{e['sig'][:60]}」 hits={hits} occ={e.get('occurrences', 0)}"
              f"｜服役 {age} 天（TTL {ttl}）｜召回开火 {f_n} 次｜建议：{verdict}")
    if not shadow:
        print("（无 shadow 条目——新规律 record 后进入影子服役攒证据）")
    return cards


def sweep(project_dir):
    """批150：饿死退役——超 TTL 且 hits<2 的 shadow 条目（幂等，留档不删）。

    retired 退出 match 召回但条目保留；promote 可复活（误杀防线）。
    curated 永不自动退役（人裁过的知识只有人能退）。
    """
    ttl = _shadow_ttl_days(project_dir)
    with _ledger_lock(project_dir):  # §17：读改写全程
        data = load(project_dir)
        today = date.today().isoformat()
        retired = 0
        for k, e in data.items():
            if str(k).startswith("_") or not isinstance(e, dict):
                continue
            if e.get("lifecycle") != "shadow":
                continue
            if _days_since(e.get("captured_at", "")) > ttl \
                    and int(e.get("hits", 0)) < 2:
                e["lifecycle"] = "retired"
                e["retired_at"] = today
                e["retire_reason"] = "starved"
                retired += 1
                print(f"🍂 已退役：「{str(e.get('sig'))[:60]}」"
                      f"（超 TTL {ttl} 天且 hits<2——留档，promote 可复活）")
        if retired:
            _save(project_dir, data)
        else:
            print(f"（零饿死条目——shadow 队列健康或未超 TTL {ttl} 天）")
        return retired


def promote(project_dir, sig):
    """批150：人裁晋升盖章（shadow|retired → curated）。evidence 自动捕获。"""
    with _ledger_lock(project_dir):  # §17：读改写全程
        data = load(project_dir)
        key = hashlib.sha1(sig.encode("utf-8")).hexdigest()[:12]
        e = data.get(key)
        if not (isinstance(e, dict) and e.get("sig")):
            cands = [x for x in data.values() if isinstance(x, dict)
                     and str(x.get("sig", "")).startswith(sig)]
            if len(cands) == 1:
                e = cands[0]
            else:
                print(f"promote: 未找到条目「{sig[:40]}」（前缀歧义或不存在）",
                      file=sys.stderr)
                return False
        today = date.today().isoformat()
        age = _days_since(e.get("captured_at", ""))
        e["lifecycle"] = "curated"
        e["promoted_at"] = today
        e["evidence"] = (f"hits={e.get('hits')} occ={e.get('occurrences')}"
                         f" 服役{age}天 @{today}")
        _save(project_dir, data)
        print(f"🏅 已晋升 curated：「{str(e['sig'])[:60]}」（{e['evidence']}）")
        return True


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
    h = sub.add_parser("health", help="规律健康：降级候选 + 固化候选 + shadow 队列")
    h.add_argument("--decay-days", type=int, default=DEFAULT_DECAY_DAYS)
    h.add_argument("--promote-hits", type=int, default=PROMOTE_HITS)
    c = sub.add_parser("case", help="批150：shadow 晋升证据卡（度量自动，人只守晋升）")
    c.add_argument("--top", type=int, default=5)
    sub.add_parser("sweep", help="批150：饿死退役（超 TTL 且 hits<2，幂等留档）")
    pm = sub.add_parser("promote", help="批150：人裁晋升/复活（shadow|retired→curated）")
    pm.add_argument("--sig", required=True, help="失败签名（完整或唯一前缀）")
    args = ap.parse_args(argv)
    project_dir = _find_project_dir(args.project_dir)
    if not project_dir:
        print("rules_ledger: 未找到 .regress/（项目未接入）", file=sys.stderr)
        return 1
    if args.cmd == "record":
        record(project_dir, args.sig, args.occurrences)
    elif args.cmd == "supersede":
        supersede(project_dir, args.old, args.new)
    elif args.cmd == "case":
        case(project_dir, args.top)
    elif args.cmd == "sweep":
        sweep(project_dir)
    elif args.cmd == "promote":
        if not promote(project_dir, args.sig):
            return 2
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
                mark = "🔬 " if r.get("lifecycle") == "shadow" else ""
                print(f"  {i}. {mark}「{r['sig'][:60]}」 命中×{r['hits']}（最近 {r['last_hit']}）")
    else:
        import io as _io
        import contextlib as _cb
        with _cb.redirect_stdout(_io.StringIO()) as buf:
            res = health(project_dir, args.decay_days, args.promote_hits)
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
                # v1.108（§17 幂等律）：同候选集合=同决策点，30 分钟窗内折叠
                # 不重发不重记账（每次 health 运行都新增待决+推送的病灶就此
                # 闭）；集合变化=新决策点；人 resolve 后同集合再现=新待决
                _notify(project_dir, "plan_approval",
                        f"🦴 固化候选 ×{n}",
                        "规律命中≥3 可固化为 skill——需要你批准（/regress-stats 查看详情）",
                        source_id="rules-ledger-candidates",
                        coalesce_key=_candidates_fp(res))
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
