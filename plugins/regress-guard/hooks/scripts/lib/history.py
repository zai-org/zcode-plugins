#!/usr/bin/env python3
"""记录和查询 regress-guard 的运行历史（越用越聪明的数据层）。

历史格式：.regress/history.jsonl（每行一个 JSON 事件）

事件类型：
  - commit_blocked: commit 被阻断（原因：untracked_files / test_failed / no_test_runner）
  - commit_passed: commit 放行
  - bypass_used: bypass 模式使用
  - f3_discovered: track 发现计划外文件
  - test_failed: 测试失败（记录失败用例）

每条事件含：
  timestamp, event, manifest_id, session_id, details{}, files[]
"""
import os
import json
from datetime import datetime


def _current_session_id():
    """从环境变量推断当前 ZCode 会话 ID（证据链的过程锚点）。"""
    return (
        os.environ.get("CLAUDE_SESSION_ID")
        or os.environ.get("ZCODE_SESSION_ID")
        or ""
    )


def record(regress_dir, event, manifest_id="", **details):
    """记录一条历史事件。

    证据链设计（借鉴 Harness Inspector 的 Intent→Process→Output）：
      manifest_id  = 意图锚点（哪个需求）
      session_id   = 过程锚点（哪次会话）
      commit_sha   = 产出锚点（哪个提交，commit 事件才有）

    Args:
        regress_dir: .regress/ 目录路径
        event: 事件类型（commit_blocked/commit_passed/bypass_used/f3_discovered/test_failed）
        manifest_id: 关联的清单 ID
        **details: 额外字段（如 files, reason, test_name, runner 等）
    """
    history_path = os.path.join(regress_dir, "history.jsonl")
    entry = {
        "timestamp": datetime.now().isoformat(),
        "event": event,
        "manifest_id": manifest_id,
        # 证据链锚点：自动从环境推断（不依赖调用方传）
        "session_id": _current_session_id(),
    }
    entry.update(details)

    try:
        with open(history_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass  # 历史记录不阻断主流程

    # 遗忘机制（Ch9）：超过阈值时自动归档旧事件
    _maybe_archive(regress_dir, history_path)


def _maybe_archive(regress_dir, history_path, max_events=500):
    """history 超过 max_events 时，把旧事件移到 archive 文件。

    P2#18：先按大小短路（≈80B/行估）——旧实现每次 record() 都全量
    readlines 判归档，门禁热路径 O(n²)；不足阈值一行都不读。
    """
    try:
        if os.path.getsize(history_path) < max_events * 80:
            return  # 快路径：体积远未到阈值，不可能超条数
        with open(history_path, encoding="utf-8") as f:
            lines = f.readlines()
        if len(lines) <= max_events:
            return
        # 保留最近 max_events 条，旧的归档
        keep = lines[-max_events:]
        archive = lines[:-max_events]
        archive_path = os.path.join(regress_dir, "history-archive.jsonl")
        with open(archive_path, "a", encoding="utf-8") as f:
            f.writelines(archive)
        with open(history_path, "w", encoding="utf-8") as f:
            f.writelines(keep)
    except Exception:
        pass  # 归档失败不阻断


def load_history(regress_dir):
    """加载所有历史事件，返回 list[dict]。"""
    history_path = os.path.join(regress_dir, "history.jsonl")
    events = []
    if not os.path.exists(history_path):
        return events
    try:
        with open(history_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
    except Exception:
        pass
    return events


def summarize(regress_dir):
    """分析历史，输出项目级洞察（供 /regress:learn 使用）。

    Returns:
        {
            "total_commits": int,
            "blocked_count": int,
            "bypass_count": int,
            "top_f3_files": [(file, count)],   # 最常被遗漏的文件
            "top_f3_patterns": [(pattern, count)],  # 最常被遗漏的目录/模式
            "frequent_failures": [(test_name, count)],  # 最常失败的测试
            "test_runner": str,  # 项目主要用的测试运行器
            "bypass_rate": float,  # bypass 使用率
            "block_rate": float,  # 阻断率
        }
    """
    events = load_history(regress_dir)

    total_commits = sum(1 for e in events if e.get("event") in ("commit_passed", "commit_blocked"))
    blocked = [e for e in events if e.get("event") == "commit_blocked"]
    bypassed = [e for e in events if e.get("event") == "bypass_used"]

    # F3 统计（含噪声过滤，借鉴 Harness Inspector：频次≠经验）
    # 同一 session 内的重复 F3 = 重试噪声（AI 反复尝试同一提交）
    # 跨 session 的重复 F3 = 稳定经验（真正值得沉淀的规律）
    f3_all = {}       # 原始计数
    f3_sessions = {}  # 每个 F3 文件出现在几个不同 session
    for e in events:
        if e.get("event") in ("f3_discovered", "commit_blocked") and e.get("untracked_files"):
            sid = e.get("session_id", "")
            for f in e["untracked_files"]:
                f3_all[f] = f3_all.get(f, 0) + 1
                f3_sessions.setdefault(f, set()).add(sid)

    # 只保留跨 session 出现 ≥2 次的（单 session 的高频是噪声）
    f3_files = {}
    f3_noise = {}
    for f, count in f3_all.items():
        session_count = len(f3_sessions.get(f, {""}))
        if session_count >= 2:
            f3_files[f] = session_count  # 用跨session次数作为稳定度
        else:
            f3_noise[f] = count  # 记为噪声（不进经验）

    # 按目录模式聚合
    f3_patterns = {}
    for fpath, count in f3_files.items():
        parts = fpath.split("/")
        if len(parts) > 1:
            pattern = parts[0] + "/**"
            f3_patterns[pattern] = f3_patterns.get(pattern, 0) + count

    # 测试失败统计
    test_failures = {}
    runners = {}
    for e in events:
        if e.get("event") == "test_failed" and e.get("test_name"):
            name = e["test_name"]
            test_failures[name] = test_failures.get(name, 0) + 1
        if e.get("runner"):
            runners[e["runner"]] = runners.get(e["runner"], 0) + 1

    top_f3 = sorted(f3_files.items(), key=lambda x: -x[1])[:10]
    top_patterns = sorted(f3_patterns.items(), key=lambda x: -x[1])[:5]
    top_failures = sorted(test_failures.items(), key=lambda x: -x[1])[:10]

    bypass_rate = (len(bypassed) / total_commits) if total_commits else 0
    block_rate = (len(blocked) / total_commits) if total_commits else 0
    main_runner = max(runners, key=runners.get) if runners else "unknown"

    # 债务追踪：bypass 后是否有对应的 verify（还债）
    # 简单逻辑：每次 bypass_used = 欠 1 笔债；之后每次 commit_passed（测试通过）= 还 1 笔
    debt = 0
    for e in events:
        if e.get("event") == "bypass_used":
            debt += 1
        elif e.get("event") == "commit_passed" and debt > 0:
            debt -= 1  # 测试通过的提交 = 还了一笔债

    # Ch24 生产指标：质量 / 安全 / 效率 / 成本
    passed_commits = sum(1 for e in events if e.get("event") == "commit_passed")
    quality_score = round(passed_commits / total_commits, 2) if total_commits else 0  # 质量：通过率
    f3_discoveries = sum(1 for e in events if e.get("event") == "commit_blocked"
                         and e.get("reason") == "untracked_files")
    f3_rate = round(f3_discoveries / total_commits, 2) if total_commits else 0  # F3 发现率

    # 效率：一次通过率
    test_interactions = sum(1 for e in events if e.get("event") in ("commit_passed", "test_failed"))
    efficiency = round(total_commits / max(test_interactions, 1), 2)

    # 覆盖率信号：历次放行提交的平均行覆盖率（有 jest coverage 时才有值）
    covs = [e.get("coverage_pct") for e in events
            if e.get("event") == "commit_passed" and e.get("coverage_pct") is not None]
    avg_coverage = round(sum(covs) / len(covs)) if covs else None

    # （v1.75：外部提交观测消费段已删——写端模板早删，真机 252 事件零发射，
    #  恒零计数是死码；观测器复活条件=install 接线 post-commit 观测+攻击面评估）

    # Ch21 阻断原因分布
    block_reasons = {}
    for e in blocked:
        r = e.get("reason", "unknown")
        block_reasons[r] = block_reasons.get(r, 0) + 1

    return {
        "total_commits": total_commits,
        "blocked_count": len(blocked),
        "bypass_count": len(bypassed),
        "top_f3_files": top_f3,
        "top_f3_patterns": top_patterns,
        "top_f3_noise": sorted(f3_noise.items(), key=lambda x: -x[1])[:5],  # 已过滤的噪声
        "avg_coverage_pct": avg_coverage,  # 平均行覆盖率（None=无覆盖率数据）
        "frequent_failures": top_failures,
        "test_runner": main_runner,
        "bypass_rate": round(bypass_rate, 2),
        "block_rate": round(block_rate, 2),
        "tech_debt": debt,
        # Ch24 四维指标
        "quality_score": quality_score,    # 质量：commit 通过率（越高越好）
        "f3_rate": f3_rate,                # 安全：计划外改动发现率
        "efficiency": efficiency,          # 效率：一次通过率
        "bypass_rate_pct": round(bypass_rate * 100),  # 安全：绕过百分比
        # Ch21 阻断原因分布
        "block_reasons": block_reasons,
    }


def nudge_effectiveness(regress_dir):
    """块消息有效性（v1.47，B2 影子采集——只测不拦，阈值先影子）。

    GEPA 评分环落地：拦截消息本身就是提示词（steer agent 下一动作），
    同清单同原因反复被拦 = 消息没把 agent 教会的直接信号。
    判据（顾问定，影子期只标注不拦截）：
      ≥2 次 → repeat（告警级）
      ≥3 次 且（跨 ≥2 会话 或 时间跨 ≥7 天）→ ineffective_candidate
    分母恒带（该键总拦截数）——小样本噪声的第一道防线。
    """
    from collections import defaultdict
    events = load_history(regress_dir)
    groups = defaultdict(list)
    for e in events:
        if e.get("event") == "commit_blocked":
            groups[(str(e.get("manifest_id") or ""),
                    str(e.get("reason") or "unknown"))].append(e)
    rows = []
    for (mid, reason), es in sorted(groups.items(),
                                    key=lambda kv: -len(kv[1])):
        sessions = {str(e.get("session_id") or "") for e in es}
        ts = sorted(str(e.get("timestamp") or "") for e in es)
        try:
            from datetime import datetime as _dt
            span_days = (_dt.fromisoformat(ts[-1]) - _dt.fromisoformat(ts[0])
                         ).days if len(ts) > 1 else 0
        except ValueError:
            span_days = 0
        flag = ""
        if len(es) >= 3 and (len(sessions) >= 2 or span_days >= 7):
            flag = "ineffective_candidate"
        elif len(es) >= 2:
            flag = "repeat"
        rows.append({"manifest_id": mid, "reason": reason,
                     "blocks": len(es),            # 分母恒带
                     "sessions": len(sessions), "span_days": span_days,
                     "flag": flag})
    return rows


def recall_effectiveness(regress_dir):
    """召回有效性代理（v1.58，B3——弱证据，只排序不回流）。

    对每条 rule_recall 沿事件序找同 manifest 的下一个 commit_passed：
      其间无同 manifest 的 commit_blocked → resolved_clean（顾问"干净才计"）
      有 → resolved_shadow（解决时另有干预，召回贡献未知——单列不加总）
      无放行 → pending
    诚实边界：事件序代理非因果（GEPA 6.3 同防线）；真值仍靠人读与
    advisor_adoption 同族的前向采集。
    """
    events = load_history(regress_dir)
    rows = []
    for i, e in enumerate(events):
        if e.get("event") != "rule_recall":
            continue
        mid = str(e.get("manifest_id") or "")
        outcome = "pending"
        for e2 in events[i + 1:]:
            if str(e2.get("manifest_id") or "") != mid:
                continue  # 跨清单事件不干扰
            ev = e2.get("event")
            if ev == "commit_blocked":
                outcome = "resolved_shadow"
                break
            if ev == "commit_passed":
                outcome = "resolved_clean"
                break
        rows.append({"manifest_id": mid, "reason": str(e.get("reason") or ""),
                     "n": e.get("n"), "outcome": outcome})
    return rows


def block_heatmap(regress_dir):
    """拦截热力图（v1.62，B7）：commit_blocked 按 reason 聚合频次。

    用途：召回接线扩点判据的数据接口（v1.54 只挂高频3点——"扩点看数据"，
    高频 reason 即下一个该接召回的拦截点）。reason 缺失归 unknown 桶。
    v1.83（072）新键标注：每 reason 附首现时间，14 天内首现标 new=True——
    "老病复发"与"新病露头"一眼分开（顾问降级版：先量测可见性，淹没活体
    出现再谈冻结）。"""
    from collections import defaultdict
    import datetime as _dt
    groups = defaultdict(list)
    for e in load_history(regress_dir):
        if e.get("event") == "commit_blocked":
            groups[str(e.get("reason") or "unknown")].append(e)
    now = _dt.datetime.now()
    rows = []
    for reason, es in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        first = min((str(e.get("timestamp") or "") for e in es), default="")
        is_new = False
        if first:
            try:
                is_new = (now - _dt.datetime.fromisoformat(first)).days <= 14
            except ValueError:
                pass
        rows.append({"reason": reason, "blocks": len(es),
                     "manifests": len({str(e.get("manifest_id") or "") for e in es}),
                     "last": max((str(e.get("timestamp") or "") for e in es), default=""),
                     "first": first, "new": is_new})
    return rows


def build_trace(regress_dir):
    """构建交付链视图（借鉴 Harness Inspector 的 Intent→Process→Output）。

    把 history.jsonl 按 意图(manifest) → 过程(session) → 产出(commit) 组织。
    输出人类可读的文本交付链，供 /regress:trace 展示。
    """
    events = load_history(regress_dir)

    # 按 manifest 分组（意图锚点）
    by_manifest = {}
    for e in events:
        mid = e.get("manifest_id") or "(无清单)"
        by_manifest.setdefault(mid, []).append(e)

    lines = []
    for mid, evts in sorted(by_manifest.items()):
        evts.sort(key=lambda x: x.get("timestamp", ""))

        # 意图
        first = evts[0]
        lines.append(f"📌 {mid}  ({first.get('timestamp', '?')[:19]})")

        # 按 session 分组（过程锚点）
        by_session = {}
        for e in evts:
            sid = e.get("session_id") or "?"
            by_session.setdefault(sid, []).append(e)

        for sid, sevts in by_session.items():
            sid_label = sid[:12] if sid and sid != "?" else "未知会话"
            lines.append(f"   └─ 会话 {sid_label}")

            for e in sevts:
                ev = e.get("event", "?")
                ts = e.get("timestamp", "")[11:19]
                icon = {"commit_passed": "✅", "commit_blocked": "🚫",
                        "bypass_used": "⚡", "test_failed": "❌",
                        "f3_discovered": "🔍", "error": "⚠️"}.get(ev, "·")
                detail = ""
                if ev == "commit_blocked":
                    reason = e.get("reason", "?")
                    files = e.get("untracked_files", [])
                    detail = f" {reason}" + (f" → {files[0]}" if files else "")
                elif ev == "commit_passed":
                    runner = e.get("runner", "?")
                    head = e.get("base_head", "")
                    detail = f" ({runner})" + (f" @{head}" if head else "")
                elif ev == "bypass_used":
                    detail = f" 到期 {e.get('expires', '?')[:19]}"
                lines.append(f"       {icon} {ts} {ev}{detail}")

        # 产出锚点
        passed = [e for e in evts if e.get("event") == "commit_passed"]
        if passed:
            lines.append(f"   📦 产出: {len(passed)} 次放行提交")
        lines.append("")

    return "\n".join(lines) if lines else "（暂无历史事件）"


def telemetry(regress_dir):
    """遥测双文件统一视图（v1.74，063）：一屏看两套并行账本。

    history.jsonl = guard record() 所写（字段 event/timestamp——门禁拦截/通过/
    自检类）；journal/events.jsonl = journal.py 所写（字段 kind/ts——生命周期/
    顾问/哨兵类）。grep 前先认对文件（2026-09-20 哨兵误切文件烧四刀的教训）。
    """
    import glob
    out = {}
    hp = os.path.join(regress_dir, "history.jsonl")
    try:
        evs = [json.loads(l) for l in
               open(hp, encoding="utf-8").read().splitlines() if l.strip()]
        out["history"] = {"file": "history.jsonl", "fields": "event/timestamp",
                          "events": len(evs),
                          "last": evs[-1].get("event") if evs else None,
                          "last_ts": evs[-1].get("timestamp") if evs else None}
    except FileNotFoundError:
        out["history"] = {"file": "history.jsonl", "missing": True}
    jp = os.path.join(regress_dir, "journal", "events.jsonl")
    try:
        evs = [json.loads(l) for l in
               open(jp, encoding="utf-8").read().splitlines() if l.strip()]
        out["journal"] = {"file": "journal/events.jsonl", "fields": "kind/ts",
                          "events": len(evs),
                          "last": evs[-1].get("kind") if evs else None,
                          "last_ts": evs[-1].get("ts") if evs else None}
    except FileNotFoundError:
        out["journal"] = {"file": "journal/events.jsonl", "missing": True}
    arch = sorted(os.path.basename(a) for a in
                  glob.glob(os.path.join(regress_dir, "history-archive*.jsonl")))
    if arch:
        out["history"]["archives"] = arch
    return out


def feature_fire_health(regress_dir, registry_path=None):
    """特性零火探测（v1.87.5，098：086 Pattern B 探针打捞）。

    特性注册表（工作区 .regress/feature-registry.json，本仓播种）× history
    折叠 → 每特性 {slug, shipped_at, days_since, fires, status}：
    firing（窗口内有 marker 命中）/ zero-fire（超窗零命中）/ unmeasurable
    （marker 无法映射到 history——如 v1.80 治理行不写事件，不可测性本身
    即发现：要么补量测位要么承认永远盲）。marker 语法：{"event": 名} 或
    {"event": 名, "field": k, "value": v}。"""
    import time as _time
    if registry_path is None:
        registry_path = os.path.join(regress_dir, "feature-registry.json")
    try:
        with open(registry_path, encoding="utf-8") as f:
            registry = json.load(f)
    except (IOError, OSError, json.JSONDecodeError):
        return {"error": "registry missing or corrupt", "features": []}
    events = load_history(regress_dir)
    now = _time.time()
    rows = []
    for feat in registry if isinstance(registry, list) else []:
        slug = str(feat.get("slug") or "?")
        marker = feat.get("fire_marker") or {}
        ev_name = marker.get("event")
        window = float(feat.get("window_days") or 30)
        shipped = float(feat.get("shipped_at") or 0)
        days_since = (now - shipped) / 86400 if shipped else None
        if not ev_name:
            fires, status = 0, "unmeasurable"
        else:
            hits = [e for e in events if e.get("event") == ev_name and (
                not marker.get("field")
                or e.get(marker["field"]) == marker.get("value"))]
            recent = [e for e in hits if not shipped or
                      _time.mktime(_time.strptime(
                          str(e.get("timestamp") or "1970-01-01")[:19],
                          "%Y-%m-%dT%H:%M:%S")) >= shipped]
            fires = len(recent)
            status = "firing" if fires > 0 else (
                "zero-fire" if (days_since or 0) > window else "warmup")
        rows.append({"slug": slug, "shipped_at": feat.get("shipped_at"),
                     "days_since": round(days_since, 1) if days_since else None,
                     "fires": fires, "status": status})
    return {"features": rows}


def cache_stats(regress_dir):
    """缓存命中遥测（v1.85.3，077）：commit_passed 的 cached 字段聚合。

    v1.85 测试缓存上线但无观测面——命中几次/省了多少秒从这里查。
    est_saved_seconds = hits × 118：118s 是本仓全量套件均时常数（估算常数，
    不自欺——字段名带 est 即此意；真实节省要等未命中事件带实测时长才可替换）。
    cached 字段缺位的旧事件计 miss（当时确实全量跑了，诚实计数）。
    """
    events = load_history(regress_dir)
    passed = [e for e in events if e.get("event") == "commit_passed"]
    hits = sum(1 for e in passed if e.get("cached"))
    misses = len(passed) - hits
    return {
        "total": len(passed),
        "hits": hits,
        "misses": misses,
        "rate": round(hits / len(passed), 3) if passed else 0.0,
        "est_saved_seconds": hits * 118,
    }


if __name__ == "__main__":
    import sys
    regress_dir = sys.argv[1] if len(sys.argv) > 1 else ".regress"
    cmd = sys.argv[2] if len(sys.argv) > 2 else "summary"
    if cmd == "summary":
        s = summarize(regress_dir)
        print(json.dumps(s, ensure_ascii=False, indent=2))
    elif cmd == "telemetry":
        print(json.dumps(telemetry(regress_dir), ensure_ascii=False, indent=2))
    elif cmd == "raw":
        for e in load_history(regress_dir):
            print(json.dumps(e, ensure_ascii=False))
    elif cmd == "trace":
        print(build_trace(regress_dir))
    elif cmd == "nudge":
        rows = nudge_effectiveness(regress_dir)
        if not rows:
            print("（无拦截记录——块消息有效性暂无可测）")
        else:
            print(f"块消息有效性（影子采集）：{len(rows)} 键｜"
                  f"repeat {sum(1 for r in rows if r['flag'] == 'repeat')}"
                  f"｜无效候选 {sum(1 for r in rows if r['flag'] == 'ineffective_candidate')}")
            for r in rows[:10]:
                mark = {"repeat": "⚠️ ", "ineffective_candidate": "🚨"}.get(r["flag"], "  ")
                print(f"  {mark}{r['manifest_id'] or '-'} [{r['reason']}] ×{r['blocks']}"
                      f"（{r['sessions']} 会话/{r['span_days']} 天）")
    elif cmd == "recall":
        rows = recall_effectiveness(regress_dir)
        if not rows:
            print("（无 rule_recall 记录——召回有效性暂无可测）")
        else:
            from collections import Counter
            c = Counter(r["outcome"] for r in rows)
            print(f"召回有效性（事件序代理·弱证据只排序）：{len(rows)} 次｜"
                  f"干净解决 {c.get('resolved_clean', 0)}｜"
                  f"带干预解决 {c.get('resolved_shadow', 0)}｜未决 {c.get('pending', 0)}")
            for r in rows[:10]:
                mark = {"resolved_clean": "✅", "resolved_shadow": "◐",
                        "pending": "⏳"}.get(r["outcome"], " ")
                print(f"  {mark}{r['manifest_id'] or '-'} [{r['reason']}] n={r.get('n', '?')}")
    elif cmd == "heatmap":
        rows = block_heatmap(regress_dir)
        if not rows:
            print("（无拦截记录——热力图空）")
        else:
            print(f"拦截热力图（reason×频次，召回扩点看这里）：{len(rows)} 种原因")
            for r in rows[:10]:
                new_mark = " 🆕" if r.get("new") else ""
                first = str(r.get("first") or "")[:10]
                print(f"  🔥 {r['reason']} ×{r['blocks']}"
                      f"（{r['manifests']} 清单，最近 {r['last'][:16]}"
                      f"，首现 {first or '?'}{new_mark}）")
    elif cmd == "cache":
        s = cache_stats(regress_dir)
        print(f"缓存命中：{s['total']} 次过门禁｜命中 {s['hits']}"
              f"（{s['rate']:.1%}）｜未命中 {s['misses']}"
              f"｜估算节省 {s['est_saved_seconds']}s（hits×118s 估算常数）")
    elif cmd == "features":
        r = feature_fire_health(regress_dir)
        if r.get("error"):
            print(f"特性探测：注册表缺失/损坏——{r['error']}")
        else:
            for f in r["features"]:
                d = f"{f['days_since']}天" if f["days_since"] is not None else "?"
                print(f"  {f['status']:>13}  {f['slug']}（出厂 {d}，火 {f['fires']} 次）")
