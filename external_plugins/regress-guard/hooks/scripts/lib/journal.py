#!/usr/bin/env python3
"""journal — 考古地层（公理三：时间熵 → 地质资产）。

/tmp 状态是易挥发的认知介质（重启即失）；地层把失败/风险/纠正事件
append-only 地埋进项目 .regress/journal/events.jsonl，随 git 入库。

与 history.py 的分工：
  history.jsonl = 门禁决策史（commit 放行/阻断，由 pre_commit_guard 写）
  journal/events.jsonl = 执行现场化石（工具失败/风险动作/用户纠正，由探测器写）

未来维护者不靠回忆，像考古学家一样挖地层：
  /regress:learn 聚类跨会话重复失败 → 回写为规则。
"""
import os
import json
from datetime import datetime

# 单字段截断上限（防一条超大报错撑爆地层）
_FIELD_CAP = 400


def _find_project_dir(start_dir=None):
    """从 start_dir（默认 env 或 cwd）向上找含 .regress/ 的目录。"""
    d = start_dir or (
        os.environ.get("CLAUDE_PROJECT_DIR")
        or os.environ.get("ZCODE_PROJECT_DIR")
        or os.getcwd()
    )
    d = os.path.abspath(d)
    for _ in range(10):
        if os.path.isdir(os.path.join(d, ".regress")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent
    return None


def journal_path(project_dir):
    return os.path.join(project_dir, ".regress", "journal", "events.jsonl")


def journal_append(kind, start_dir=None, **fields):
    """埋一条化石。无 .regress/（未接入）或被关闭时静默跳过——地层是增强，不是依赖。

    kind: tool_fail / risk_action / user_correction / decision 等
    """
    if os.environ.get("REGRESS_JOURNAL", "").lower() in ("off", "0", "false"):
        return False
    project_dir = _find_project_dir(start_dir)
    if not project_dir:
        return False
    event = {
        "ts": datetime.now().isoformat(),
        "kind": kind,
        "session": (
            os.environ.get("CLAUDE_SESSION_ID")
            or os.environ.get("ZCODE_SESSION_ID")
            or "default"
        ),
    }
    for k, v in fields.items():
        if isinstance(v, str):
            v = v[:_FIELD_CAP]
        event[k] = v
    try:
        os.makedirs(os.path.dirname(journal_path(project_dir)), exist_ok=True)
        with open(journal_path(project_dir), "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except (IOError, OSError):
        return False
    return True


def load_journal(project_dir):
    """读取全部地层事件（供 /regress:learn 考古挖掘）。"""
    path = journal_path(project_dir)
    events = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except (IOError, OSError):
        pass
    return events


def journal_digest(project_dir, top=8):
    """简单聚合（顾问降级建议：不做聚类算法，按签名计数 + 跨会话过滤）。

    返回跨会话出现 ≥2 次的重复签名——单会话高频是重试噪声，
    跨会话重复才是稳定经验（与 history.py 的噪声过滤哲学一致）。
    v1.94.0 起纳入 user_correction（纠正聚类，kind 字段区分来源）：
    同主题纠正跨会话 ≥2 次 = 用户反复踩同一类误解，规律候选。
    """
    from collections import Counter

    def _sig_of(e):
        if e.get("kind") == "user_correction":
            return "correction:" + str(e.get("excerpt") or "?")[:16]
        return e.get("sig") or "?"

    events = [e for e in load_journal(project_dir)
              if e.get("kind") in ("tool_fail", "user_correction")]
    sig_sessions = {}
    sig_kind = {}
    for e in events:
        sig = _sig_of(e)
        sig_sessions.setdefault(sig, set()).add(e.get("session", "?"))
        sig_kind[sig] = e.get("kind")
    stable = {s: len(sess) for s, sess in sig_sessions.items() if len(sess) >= 2}
    total = Counter(_sig_of(e) for e in events)
    return [
        {"sig": sig, "kind": sig_kind.get(sig), "sessions": n,
         "total": total.get(sig, 0)}
        for sig, n in sorted(stable.items(), key=lambda x: -x[1])[:top]
    ]


def pending_corrections(project_dir, scan_cap=200):
    """处置高水位（v1.94.0，122）：晚于最近一条 correction_disposition 的
    user_correction 即 pending。

    高水位语义（顾问裁决的 A 变体）：ack 只需一行命令（PD 教训——ack 贵了
    就没人确认），但游标安全——disposition 的 upto 字段由 Stop 提醒内嵌
    （最新 pending 的 ts），只清"已展示"的；展示之后新到的纠正仍 pending。
    ISO 时间串字典序即时间序；缺 ts 的坏事件按"最早"处理（不误报 pending）。
    scan_cap 只扫尾部，长寿地层 O(cap)。
    """
    events = load_journal(project_dir)[-scan_cap:]
    high = ""
    for e in events:
        if e.get("kind") == "correction_disposition":
            mark = str(e.get("upto") or e.get("ts") or "")
            if mark > high:
                high = mark
    return [
        e for e in events
        if e.get("kind") == "user_correction" and str(e.get("ts") or "") > high
    ]


def journal_stats(project_dir):
    """规模测量仪器（v1.50，B6——先测 n 再谈 O(n) 优化，顾问纪律）。

    决策规则：digest_ms > 500 或 events > 50000 才立项滚动索引；
    读数不过线不优化——YAGNI 用数据说。"""
    import time
    from collections import Counter
    t0 = time.perf_counter()
    events = load_journal(project_dir)
    journal_digest(project_dir)
    ms = round((time.perf_counter() - t0) * 1000, 1)
    path = journal_path(project_dir)
    size = os.path.getsize(path) if os.path.exists(path) else 0
    return {"events": len(events), "by_kind": dict(Counter(
                str(e.get("kind")) for e in events)),
            "file_bytes": size, "digest_ms": ms,
            "optimize_threshold": "digest_ms>500 或 events>50000 才立项"}


def advisor_adoption(project_dir):
    """顾问采纳率（v1.49，B4——给裁判装评分器，GEPA 精神：judge 也要被评分）。

    数据源=advisor_adoption 事件（finish 代谢位落，与回复中的标注义务同源
    ——回复里写「已咨询第二意见：采纳/部分采纳/不采纳」，台账里也要有同条）。
    前向采集：历史批次未落此事件不计入分母。"""
    from collections import Counter
    evs = [e for e in load_journal(project_dir)
           if e.get("kind") == "advisor_adoption"]
    by = Counter(str(e.get("adoption") or "?") for e in evs)
    n = sum(by.values())
    adopted = by.get("adopted", 0) + by.get("partial", 0)
    return {"total": n, "adopted": adopted,
            "rate": round(adopted / n, 2) if n else None,
            "by": dict(by)}


if __name__ == "__main__":
    import sys
    _d = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
    _cmd = sys.argv[2] if len(sys.argv) > 2 else "digest"
    if _cmd == "raw":
        for _e in load_journal(_d):
            print(json.dumps(_e, ensure_ascii=False))
    elif _cmd == "add":
        # journal.py <dir> add <kind> '<json字段>' —— 命令层埋化石的统一出口
        # 例：journal.py . add assumption_broken '{"manifest_id":"R1","vid":"V5","was":"..."}'
        if len(sys.argv) < 4:
            print("用法: journal.py <dir> add <kind> '<json>'", file=sys.stderr)
            sys.exit(2)
        try:
            _fields = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
        except json.JSONDecodeError as _e:
            print(f"json 字段解析失败: {_e}", file=sys.stderr)
            sys.exit(2)
        print(json.dumps({"ok": journal_append(sys.argv[3], start_dir=_d, **_fields)},
                         ensure_ascii=False))
    elif _cmd == "ack-corrections":
        # journal.py <dir> ack-corrections '{"how":"advisor|self|not_correction","upto":"...","note":"..."}'
        # 批量确认（v1.94.0，122）：一行打完。how 语义：advisor=已对质顾问 /
        # self=自行判断处置（含标注未获第二意见）/ not_correction=判定非纠正（FP 出口）。
        # upto 缺省=now；抄 Stop 提醒里内嵌的游标值则只清已展示的同批（顾问安全变体）。
        try:
            _fields = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        except json.JSONDecodeError as _e:
            print(f"json 解析失败: {_e}", file=sys.stderr)
            sys.exit(2)
        if not isinstance(_fields, dict):
            print("用法: journal.py <dir> ack-corrections '<json对象>'", file=sys.stderr)
            sys.exit(2)
        _fields.setdefault("how", "self")
        _fields.setdefault("upto", datetime.now().isoformat())
        print(json.dumps({
            "ok": journal_append("correction_disposition", start_dir=_d, **_fields),
            "cleared_after": _fields["upto"],
            "still_pending": len(pending_corrections(_d)),
        }, ensure_ascii=False))
    elif _cmd == "stats":
        print(json.dumps(journal_stats(_d), ensure_ascii=False, indent=2))
    elif _cmd == "adoption":
        print(json.dumps(advisor_adoption(_d), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(journal_digest(_d), ensure_ascii=False, indent=2))
