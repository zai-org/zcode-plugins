# -*- coding: utf-8 -*-
"""ZCode token 用量查询（只读访问 ~/.zcode/cli/db/db.sqlite）。

既可作 CLI（python zusage.py [now|today|days N|sessions [N]|models [days]|workspace 关键词|session id前缀|watch [sec]]），
也可被 usage_mcp.py import 为查询库。
"""
import hashlib
import fnmatch
import json
import os
import re
import shlex
import sqlite3
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = Path.home() / ".zcode" / "cli" / "db" / "db.sqlite"
CONFIG_PATH = Path(__file__).parent / "config.json"


def load_config():
    cfg = {"context_window": 128000, "poll_ms": 2000}
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    return cfg


def connect():
    """只读连接优先；WAL shm 不可用时退回普通连接（全程只 SELECT）。
    fallback 前先确认文件存在：sqlite3.connect 对不存在的路径会新建空库，
    可能与尚未初始化数据库的 ZCode 产生交互（v32 审查修复）。"""
    try:
        con = sqlite3.connect(f"file:{DB_PATH.as_posix()}?mode=ro", uri=True, timeout=3)
        con.execute("select 1 from model_usage limit 1").fetchone()
    except sqlite3.OperationalError:
        if not DB_PATH.exists():
            raise
        con = sqlite3.connect(str(DB_PATH), timeout=3)
    con.row_factory = sqlite3.Row
    return con


def _ts(ms):
    return datetime.fromtimestamp(ms / 1000) if ms else None


def _day_start(d=None):
    d = d or datetime.now()
    return d.replace(hour=0, minute=0, second=0, microsecond=0)


def _epoch_ms(dt):
    return int(dt.timestamp() * 1000)


def _load_lang():
    """CLI/MCP 输出语言：config.json 的 "lang"（zh/en，缺省 zh）——与安装器/监控窗口同源。
    查找顺序：脚本目录（--dev/仓库直跑）→ 标准数据目录（标准安装的 config 不在脚本目录）。"""
    for base in (CONFIG_PATH,
                 Path.home() / ".zcode" / "zcode-token-usage-statusbar" / "config.json"):
        try:
            lang = json.loads(base.read_text(encoding="utf-8")).get("lang")
            if lang in ("zh", "en"):
                return lang
        except (OSError, ValueError):
            pass
    return "zh"


_LANG = _load_lang()


def L(zh, en):
    """双语输出（与 install.py / overlay.js 的 L 同款约定）。"""
    return en if _LANG == "en" else zh


def fmt(n):
    n = n or 0
    if n >= 1_000_000_000:
        return f"{n / 1e9:.2f}B"
    if n >= 1_000_000:
        return f"{n / 1e6:.2f}M"
    if n >= 1_000:
        return f"{n / 1e3:.1f}K"
    return str(n)


SESSION_TIMEOUT_MS = 30 * 60 * 1000  # 最近30分钟有请求视为活跃会话
_TPS_MIN_GEN_MS = 200          # 有效样本下限，同 token_rate.MIN_GEN_MS
_TPS_MAX_GEN_MS = 3_600_000    # 有效样本上限（1h），同 token_rate.MAX_GEN_MS
_TPS_LOOKBACK = 20             # first_token_at 缺失时向前找有效请求的扫描条数上限


_AGG_TTL_MS = 2000   # 聚合短缓存：今日合计/会话池是慢变量，2s 陈旧无感；泵 1.5s 拉一次省约一半全表聚合
_AGG_CACHE = {}


def _cached_agg(key, fn):
    now = int(time.time() * 1000)
    hit = _AGG_CACHE.get(key)
    if hit and now - hit[0] < _AGG_TTL_MS:
        return hit[1]
    val = fn()
    if len(_AGG_CACHE) > 8:
        _AGG_CACHE.clear()   # 键固定只有几个，正常到不了；保险防膨胀
    _AGG_CACHE[key] = (now, val)
    return val


def _scan_session_ids(con):
    """全库 session_id → max(completed_at) 一次分组扫描（731MB 库 ~55ms）。
    最新会话与 recent 池原先各自独立做同样的全表 group by（3 次 118ms），
    合并为一次扫描并挂 2s TTL。"""
    def run():
        return con.execute(
            """select session_id, max(completed_at) as m
               from model_usage group by session_id""").fetchall()
    return _cached_agg("scan", run)


def session_usage(con, sid):
    # last_request_input 取最近一次 completed 请求的 input_tokens（= 当前上下文容量）。
    # 不能用 max(input_tokens)：会话压缩后 input 骤降，峰值永远不回落（v28 修复）。
    r = con.execute(
        """select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                  coalesce(sum(reasoning_tokens),0), coalesce(sum(cache_read_input_tokens),0),
                  coalesce(sum(cache_creation_input_tokens),0), coalesce(sum(computed_total_tokens),0),
                  coalesce(sum(tool_call_count),0),
                  (select m2.input_tokens from model_usage m2
                    where m2.session_id = m.session_id and m2.status = 'completed'
                    order by m2.completed_at desc, m2.id desc limit 1),
                  count(distinct turn_id), coalesce(sum(retry_count),0)
           from model_usage m where m.session_id=? and status='completed'""",
        (sid,),
    ).fetchone()
    return {
        "requests": r[0], "input": r[1], "output": r[2], "reasoning": r[3],
        "cache_read": r[4], "cache_write": r[5], "total": r[6], "tool_calls": r[7],
        "last_request_input": r[8] or 0, "turns": r[9], "retries": r[10],
    }


def range_usage(con, start_ms, end_ms):
    # 末尾三列（reasoning/retry/cache_write）是 v30/v31 追加，CLI 老代码按索引 0-4 取值不受影响
    return con.execute(
        """select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                  coalesce(sum(cache_read_input_tokens),0), coalesce(sum(computed_total_tokens),0),
                  coalesce(sum(duration_ms),0), coalesce(sum(reasoning_tokens),0),
                  coalesce(sum(retry_count),0), coalesce(sum(cache_creation_input_tokens),0)
           from model_usage where status='completed' and completed_at between ? and ?""",
        (start_ms, end_ms),
    ).fetchone()


def _today_usage(con, start_ms, end_ms):
    return con.execute(
        """select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                  coalesce(sum(cache_read_input_tokens),0), coalesce(sum(computed_total_tokens),0),
                  coalesce(sum(duration_ms),0), coalesce(sum(reasoning_tokens),0),
                  coalesce(sum(retry_count),0), coalesce(sum(cache_creation_input_tokens),0),
                  min(started_at), max(completed_at)
           from model_usage where status='completed' and completed_at between ? and ?""",
        (start_ms, end_ms),
    ).fetchone()


def daily_usage(con, days):
    """近 N 天（含今天），按本地日聚合。返回 [(date, row), ...] 旧→新。"""
    out = []
    for i in range(days - 1, -1, -1):
        d0 = _day_start(datetime.now() - timedelta(days=i))
        r = range_usage(con, _epoch_ms(d0), _epoch_ms(d0 + timedelta(days=1)))
        out.append((d0.strftime("%m-%d %a"), r))
    return out


def recent_sessions(con, limit=10):
    return con.execute(
        """select s.id, coalesce(s.title,'(无标题)'), coalesce(s.directory,''),
                  count(m.id), coalesce(sum(m.input_tokens),0), coalesce(sum(m.output_tokens),0),
                  coalesce(sum(m.computed_total_tokens),0), max(m.completed_at)
           from model_usage m left join session s on s.id = m.session_id
           where m.status='completed'
           group by m.session_id order by max(m.completed_at) desc limit ?""",
        (limit,),
    ).fetchall()


def model_usage(con, days=7):
    since = _epoch_ms(datetime.now() - timedelta(days=days))
    return con.execute(
        """select provider_id, model_id, count(*), coalesce(sum(input_tokens),0),
                  coalesce(sum(output_tokens),0), coalesce(sum(computed_total_tokens),0)
           from model_usage where status='completed' and completed_at >= ?
           group by provider_id, model_id order by sum(computed_total_tokens) desc""",
        (since,),
    ).fetchall()


# ---------- 展示 ----------

def render_current(con):
    """当前会话 = _scan_session_ids 最近活跃的会话（子代理会话也在候选内）。"""
    rows = _scan_session_ids(con)
    sess, last_at = None, 0
    if rows:
        sid, last_at = max(rows, key=lambda r: r[1])
        sess = con.execute("select * from session where id=?", (sid,)).fetchone()
    lines = []
    if sess is not None:
        u = session_usage(con, sess["id"])
        active = last_at and (int(time.time() * 1000) - last_at) < SESSION_TIMEOUT_MS
        mark = L("🟢 活跃", "🟢 active") if active else L("⚪ 闲置", "⚪ idle")
        lines.append(L(f"■ 当前会话 [{mark}]  ", f"■ Current session [{mark}]  ") + sess["title"])
        if sess["directory"]:
            lines.append(L(f"  目录: {sess['directory']}", f"  dir: {sess['directory']}"))
        lines.append(
            L(f"  {u['turns']} 轮 / {u['requests']} 次请求 / {u['tool_calls']} 次工具调用",
              f"  {u['turns']} turns / {u['requests']} requests / {u['tool_calls']} tool calls")
        )
        lines.append(
            L(f"  input {fmt(u['input'])} (其中 cache read {fmt(u['cache_read'])})  "
              f"output {fmt(u['output'])}  合计 {fmt(u['total'])}",
              f"  input {fmt(u['input'])} (incl. cache read {fmt(u['cache_read'])})  "
              f"output {fmt(u['output'])}  total {fmt(u['total'])}")
        )
        lines.append(L(f"  上下文容量 ≈ {fmt(u['last_request_input'])} tokens (最近一次请求输入)",
                       f"  context capacity ≈ {fmt(u['last_request_input'])} tokens (latest request input)"))
        if last_at:
            la = _ts(last_at)
            lines.append(L(f"  最后活动: {la:%H:%M:%S}",
                           f"  last activity: {la:%H:%M:%S}"))
        lines.append("")
    today = range_usage(con, _epoch_ms(_day_start()), _epoch_ms(_day_start() + timedelta(days=1)))
    lines.append(L(f"■ 今日 ({datetime.now():%Y-%m-%d %a})", f"■ Today ({datetime.now():%Y-%m-%d %a})"))
    lines.append(
        L(f"  {today[0]} 次请求  input {fmt(today[1])} (cache read {fmt(today[3])})  "
          f"output {fmt(today[2])}  合计 {fmt(today[4])}",
          f"  {today[0]} requests  input {fmt(today[1])} (cache read {fmt(today[3])})  "
          f"output {fmt(today[2])}  total {fmt(today[4])}")
    )
    return "\n".join(lines)


def render_days(con, days):
    lines = [L(f"■ 近 {days} 天每日用量 (合计=input+output)", f"■ Last {days} days (total=input+output)")]
    for label, r in daily_usage(con, days):
        bar = "█" * max(0, min(30, int(r[4] / 200_000)))
        lines.append(
            L(f"  {label}  {r[0]:>4} 次  in {fmt(r[1]):>8}  out {fmt(r[2]):>7}  合计 {fmt(r[4]):>8}  {bar}",
              f"  {label}  {r[0]:>4} req  in {fmt(r[1]):>8}  out {fmt(r[2]):>7}  total {fmt(r[4]):>8}  {bar}")
        )
    return "\n".join(lines)


def render_sessions(con, limit=10):
    lines = [L(f"■ 最近 {limit} 个会话", f"■ Last {limit} sessions")]
    for sid, title, d, n, inp, outp, total, last in recent_sessions(con, limit):
        t = _ts(last)
        if _LANG == "en" and title == "(无标题)":
            title = "(untitled)"
        dname = d.replace("\\", "/").rsplit("/", 1)[-1] if d else "?"
        lines.append(
            L(f"  {t:%m-%d %H:%M}  {fmt(total):>8}  ({fmt(inp)} in / {fmt(outp)} out, {n} 请求)  ",
              f"  {t:%m-%d %H:%M}  {fmt(total):>8}  ({fmt(inp)} in / {fmt(outp)} out, {n} requests)  ")
            + f"[{dname}]  {title[:32]}  [{sid[:13]}]"
        )
    return "\n".join(lines)


def render_models(con, days=7):
    lines = [L(f"■ 近 {days} 天按模型", f"■ Last {days} days by model")]
    for prov, model, n, inp, outp, total in model_usage(con, days):
        lines.append(
            L(f"  {model:<22} {n:>5} 次  in {fmt(inp):>8}  out {fmt(outp):>7}  合计 {fmt(total):>8}  ({prov})",
              f"  {model:<22} {n:>5} req  in {fmt(inp):>8}  out {fmt(outp):>7}  total {fmt(total):>8}  ({prov})")
        )
    return "\n".join(lines)


# ---------- 工作区报表 ----------
# 口径：主会话 = directory 命中且无父且非 sess_subagent 前缀；子代理按 parent_id 归并去重。
# 子代理会话（sess_subagent_*）的 directory 字段也等于工作区目录，直接按 directory 聚合会把
# 主/子重复计数，必须走 parent_id 归并。报表单连接一次算齐——库实时写入，分次查询之间对不上账。
# 会话迁移过工作区时历史用量全部记在当前目录名下（model_usage 无工作区维度）。

_SUB_PREFIX_LEN = 13   # len("sess_subagent")


def _usage_rows(con, sids):
    """一批会话的 completed 用量（口径与 session_usage 一致），返回 session_id → row。"""
    qm = ",".join("?" * len(sids))
    per = {}
    for r in con.execute(
        f"""select session_id, count(*) n,
                   coalesce(sum(input_tokens),0) inp, coalesce(sum(output_tokens),0) outp,
                   coalesce(sum(reasoning_tokens),0) reas,
                   coalesce(sum(cache_read_input_tokens),0) crd,
                   coalesce(sum(computed_total_tokens),0) tot,
                   min(completed_at) first_at, max(completed_at) last_at
            from model_usage where status='completed' and session_id in ({qm})
            group by session_id""", sids):
        per[r["session_id"]] = r
    return per


def _match_workspaces(con, pattern):
    """工作区目录匹配：子串（SQLite LIKE 对 ASCII 大小写不敏感）或单词首字母缩写
    （abc → **A**pple **B**anana **C**herry）。用户对工作区的称呼常是缩写而非子串。
    返回 [(directory, 会话数)]，按会话数降序。"""
    pat = pattern.lower()
    out = []
    for d, n in con.execute(
            "select directory, count(*) n from session group by directory order by n desc"):
        if pat in d.lower():
            out.append((d, n))
            continue
        initials = "".join(w[0] for w in re.split(r"[^A-Za-z0-9]+", d) if w).lower()
        if len(pat) >= 2 and pat in initials:
            out.append((d, n))
    return out


def render_workspace(con, pattern, top=15):
    """workspace:<目录关键词>：按工作区聚合主会话+子代理，含按会话与按模型两张明细。"""
    pattern = (pattern or "").strip()
    dirs = _match_workspaces(con, pattern) if pattern else []
    if not dirs:
        lines = [L(f"未找到目录含 {pattern!r} 的工作区。现有工作区（按会话数前 10）：",
                   f"No workspace with directory matching {pattern!r}. Existing workspaces (top 10 by sessions):")]
        for d, n in con.execute(
                "select directory, count(*) n from session group by directory order by n desc limit 10"):
            lines.append(f"  {n:>4}  {d}")
        return "\n".join(lines)

    dir_names = [d for d, _ in dirs]
    qd = ",".join("?" * len(dir_names))
    mains = con.execute(
        f"""select id, title, time_created from session
           where directory in ({qd}) and parent_id is null and substr(id,1,{_SUB_PREFIX_LEN})!='sess_subagent'
           order by time_created""", dir_names).fetchall()
    main_ids = [r["id"] for r in mains]
    subs = []
    if main_ids:
        qm = ",".join("?" * len(main_ids))
        subs = con.execute(
            f"select id, title, parent_id from session where parent_id in ({qm})", main_ids).fetchall()
    all_ids = list(dict.fromkeys(main_ids + [r["id"] for r in subs]))
    per = _usage_rows(con, all_ids) if all_ids else {}
    qm = ",".join("?" * len(all_ids))
    models = con.execute(
        f"""select model_id, count(*) n,
                   coalesce(sum(input_tokens),0) inp, coalesce(sum(output_tokens),0) outp,
                   coalesce(sum(computed_total_tokens),0) tot
            from model_usage where status='completed' and session_id in ({qm})
            group by model_id order by tot desc""", all_ids).fetchall() if all_ids else []

    def agg(ids):
        rows = [per[i] for i in ids if i in per]
        return {k: sum(r[k] for r in rows)
                for k in ("n", "inp", "outp", "reas", "crd", "tot")}

    sub_of = {}
    for s in subs:
        sub_of.setdefault(s["parent_id"], []).append(s["id"])
    sub_ids = [i for ids in sub_of.values() for i in ids]
    tm, ts, ta = agg(main_ids), agg(sub_ids), agg(all_ids)

    if len(dirs) == 1:
        lines = [L(f"■ 工作区 {dirs[0][0]}", f"■ Workspace {dirs[0][0]}")]
    else:
        lines = [L(f"■ 工作区（匹配 {pattern!r}，命中 {len(dirs)} 个）",
                   f"■ Workspaces matching {pattern!r} ({len(dirs)} dirs)")]
        for d, n in dirs[:5]:
            lines.append(f"  {n:>4}  {d}")
    if not per:
        lines.append(L("该工作区暂无 completed 请求。", "No completed requests in this workspace yet."))
        return "\n".join(lines)
    firsts = [r["first_at"] for r in per.values() if r["first_at"]]
    lasts = [r["last_at"] for r in per.values() if r["last_at"]]
    lines.append(L(
        f"主会话 {len(main_ids)} 个（其中无请求 {len(main_ids) - len([i for i in main_ids if i in per])} 个）"
        f" + 子代理 {len(subs)} 个 ｜ "
        f"{_ts(min(firsts)):%m-%d %H:%M} ~ {_ts(max(lasts)):%m-%d %H:%M}",
        f"{len(main_ids)} main sessions ({len(main_ids) - len([i for i in main_ids if i in per])} without requests)"
        f" + {len(subs)} subagents ｜ {_ts(min(firsts)):%m-%d %H:%M} ~ {_ts(max(lasts)):%m-%d %H:%M}"))
    lines.append(L(
        f"请求 {ta['n']:,}（主 {tm['n']:,} / 子 {ts['n']:,}）  "
        f"input {ta['inp']:,}（缓存读 {ta['crd']:,}）  "
        f"output {ta['outp']:,}（含 reasoning {ta['reas']:,}）",
        f"{ta['n']:,} requests (main {tm['n']:,} / sub {ts['n']:,})  "
        f"input {ta['inp']:,} (cache-read {ta['crd']:,})  "
        f"output {ta['outp']:,} (incl. reasoning {ta['reas']:,})"))
    lines.append(L(
        f"合计（=input+output，缓存读已含在 input 内） {ta['tot']:,}",
        f"Total (=input+output; cache-read already inside input) {ta['tot']:,}"))

    ranked = []
    for m in mains:
        if m["id"] in per:
            su = agg(sub_of.get(m["id"], []))
            ranked.append((m, per[m["id"]], su))
    ranked.sort(key=lambda x: -(x[1]["tot"] + x[2]["tot"]))
    lines.append(L(f"■ 按会话（含其子代理，按含子合计降序，前 {top}）",
                   f"■ By session (incl. subagents, top {top} by combined total)"))
    for m, u, su in ranked[:top]:
        nsub = len(sub_of.get(m["id"], []))
        subtxt = (L(f" +子{nsub}个 {su['tot']:,}", f" +{nsub} sub {su['tot']:,}") if nsub else "")
        t = (m["title"] or L("(无标题)", "(untitled)")).replace("\n", " ")
        lines.append(
            f"  {_ts(u['last_at']):%m-%d %H:%M}  {u['n']:,}req  in {u['inp']:,}  out {u['outp']:,}  "
            f"{L('合计', 'total')} {u['tot']:,}{subtxt}  {t[:26]}")
    if len(ranked) > top:
        rest = agg([m["id"] for m, _, _ in ranked[top:]])
        lines.append(L(f"  （另有 {len(ranked) - top} 个会话 合计 {rest['tot']:,}）",
                       f"  (…plus {len(ranked) - top} sessions totalling {rest['tot']:,})"))

    lines.append(L("■ 按模型", "■ By model"))
    for r in models:
        lines.append(
            f"  {r['model_id']:<24} {r['n']:,}req  in {r['inp']:,}  out {r['outp']:,}  "
            f"{L('合计', 'total')} {r['tot']:,}")
    return "\n".join(lines)


# ---------- 机器可读快照（悬浮条数据源） ----------

CATALOG_PATH = Path(r"D:\ZCode\resources\model-providers\models_catalog_china_llm_zcode_2026-06-03.json")


_CTX_WINDOW_CACHE = {}


def lookup_context_window(model_id):
    """按模型 id 在客户端自带模型目录里查 contextWindow；查不到返回 None。带缓存。"""
    want = (model_id or "").strip().lower()
    if not want:
        return None
    if want in _CTX_WINDOW_CACHE:
        return _CTX_WINDOW_CACHE[want]
    result = None
    try:
        cat = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    for p in cat.get("providers", []):
        for m in p.get("models", []):
            if str(m.get("id", "")).lower() == want:
                cw = m.get("contextWindow")
                result = int(cw) if cw else None
                break
    _CTX_WINDOW_CACHE[want] = result
    return result


def _prompt_matches(title, prompt):
    """子会话 title 是否为 Agent part prompt 的截断头（ZCode 规则：prompt 前 57 字符 + "..."）。"""
    t = (title or "").strip()
    if not t or not prompt:
        return False
    if t.endswith("..."):
        base = t[:-3]
        return len(base) >= 15 and prompt.startswith(base)
    return prompt.startswith(t)


# 任务名解析缓存（serve 常驻进程内）：like 扫描父会话全部 part 的 data（本会话可达
# 2456 行大 JSON，实测 29ms/次，泵 1.5s 拉一次全付）。失效键 = 父会话 part 的
# 行数+最新 time_updated（索引聚合，<1ms）；普通消息 part 新增也会失效，宁多算不漏算。
_TASK_CACHE = {}


def _sub_agent_tasks(con, sid):
    stamp = con.execute(
        "select count(*), coalesce(max(time_updated),0) from part where session_id=?", (sid,)
    ).fetchone()
    key = (stamp[0], stamp[1])
    hit = _TASK_CACHE.get(sid)
    if hit and hit[0] == key:
        return hit[1]
    sub_rows_titles = {r[0]: r[1] for r in con.execute(
        "select id, title from session where parent_id=?", (sid,))}
    agent_parts = []
    for prow in con.execute(
        """select data, time_created from part
           where session_id=? and data like '%"tool":"Agent"%' order by time_created""",
        (sid,),
    ):
        try:
            o = json.loads(prow[0])
            st = o.get("state") or {}
            inp = st.get("input") or {}
            desc = str(inp.get("description") or "").strip()
            if desc:
                agent_parts.append((desc, str(inp.get("prompt") or "").strip(),
                                    str(st.get("output") or "")))
        except Exception:
            continue   # part.data 解析失败跳过该条，不影响其余
    tasks = {}
    for desc, _prompt, out in agent_parts:
        m = re.search(r"(?:^|\n)agentId:\s*([^\s(]+)", out)
        if m:
            tasks["sess_subagent_" + m.group(1)] = desc
    used = set(tasks)
    for desc, prompt, out in agent_parts:
        if re.search(r"(?:^|\n)agentId:\s*([^\s(]+)", out):
            continue   # 已走回执关联
        cands = [s for s, t in sub_rows_titles.items()
                 if s not in used and _prompt_matches(t, prompt)]
        if len(cands) == 1:
            tasks[cands[0]] = desc
            used.add(cands[0])
    if len(_TASK_CACHE) > 32:   # 防长驻膨胀：会话数有限，正常到不了；超了整表清掉
        _TASK_CACHE.clear()
    _TASK_CACHE[sid] = (key, tasks)
    return tasks


def render_session_detail(con, prefix):
    """session:<id前缀>：会话总量 + 按模型 + 子代理明细（任务名与状态条"子智能体目录"同源）。"""
    rows = con.execute("select id from session where id like ?", (prefix + "%",)).fetchall()
    if not rows:
        rows = con.execute(
            "select distinct session_id from model_usage where session_id like ?",
            (prefix + "%",)).fetchall()
    if not rows:
        return L(f"未找到 id 前缀为 {prefix!r} 的会话",
                 f"No session found with id prefix {prefix!r}")
    sid = rows[0][0]
    sess = con.execute("select * from session where id=?", (sid,)).fetchone()
    u = session_usage(con, sid)
    head = L(f"■ 会话 {sid}", f"■ Session {sid}")
    if sess is not None:
        head += f"  {sess['title']}"
        if sess["directory"]:
            head += L(f"\n  目录: {sess['directory']}", f"\n  dir: {sess['directory']}")
    body = L(
        f"  {u['turns']} 轮 / {u['requests']} 次请求\n"
        f"  input {fmt(u['input'])} (其中 cache read {fmt(u['cache_read'])})  "
        f"output {fmt(u['output'])}  合计 {fmt(u['total'])}（合计=input+output，缓存读已含在 input 内）\n"
        f"  上下文容量 ≈ {fmt(u['last_request_input'])} tokens",
        f"  {u['turns']} turns / {u['requests']} requests\n"
        f"  input {fmt(u['input'])} (incl. cache read {fmt(u['cache_read'])})  "
        f"output {fmt(u['output'])}  total {fmt(u['total'])} (total=input+output; cache-read already inside input)\n"
        f"  context capacity ≈ {fmt(u['last_request_input'])} tokens")
    lines = [head, body]
    last = con.execute(
        "select max(completed_at) from model_usage where session_id=?", (sid,)).fetchone()[0]
    if last:
        lines.append(L(f"  最后活动: {_ts(last):%m-%d %H:%M}",
                       f"  last activity: {_ts(last):%m-%d %H:%M}"))
    mrows = con.execute(
        """select model_id, count(*) n, coalesce(sum(input_tokens),0),
                  coalesce(sum(output_tokens),0), coalesce(sum(computed_total_tokens),0)
           from model_usage where session_id=? and status='completed'
           group by model_id order by sum(computed_total_tokens) desc limit 6""",
        (sid,)).fetchall()
    if mrows:
        lines.append(L("  按模型:", "  By model:"))
        for r in mrows:
            lines.append(
                f"    {r['model_id']:<24} {r['n']:,}req  in {fmt(r[2])}  out {fmt(r[3])}  "
                f"{L('合计', 'total')} {fmt(r[4])}")
    sub_rows = con.execute(
        """select m.session_id, coalesce(s2.title,''), count(*),
                  coalesce(sum(m.computed_total_tokens),0), max(m.completed_at)
           from model_usage m join session s2 on m.session_id = s2.id
           where m.query_source='subagent' and s2.parent_id=? and m.status='completed'
           group by m.session_id order by max(m.completed_at) desc""", (sid,)).fetchall()
    if sub_rows:
        tasks = _sub_agent_tasks(con, sid)
        lines.append(L(
            f"  子代理: {len(sub_rows)} 个 / {sum(r[2] for r in sub_rows):,}req / "
            f"合计 {sum(r[3] for r in sub_rows):,}",
            f"  Subagents: {len(sub_rows)} / {sum(r[2] for r in sub_rows):,}req / "
            f"total {sum(r[3] for r in sub_rows):,}"))
        for r in sub_rows[:8]:
            name = tasks.get(r[0]) or r[1] or r[0]
            lines.append(
                f"    {fmt(r[3]):>8}  {r[2]:>3}req  {str(name).replace(chr(10), ' ')[:30]}  [{r[0][-6:]}]")
        if len(sub_rows) > 8:
            lines.append(L(f"    （另有 {len(sub_rows) - 8} 个）", f"    (…plus {len(sub_rows) - 8} more)"))
    return "\n".join(lines)


def _session_start_ms(con, sid, srow=None):
    """会话起点：首个已完成请求的 started_at；无请求（纯新建/纯问答）回退会话创建时间。
    供悬浮条「会话累计」tooltip 的起始时间展示用。"""
    r = con.execute(
        "select min(started_at) from model_usage where session_id=? and status='completed'",
        (sid,),
    ).fetchone()
    if r and r[0]:
        return int(r[0])
    if srow is None:
        srow = con.execute("select time_created from session where id=?", (sid,)).fetchone()
    return int(srow["time_created"]) if srow and srow["time_created"] else 0


def _light_snapshot(con, sid, cfg):
    """recent 池轻量行（v8 瘦身）：两条聚合 SQL 出齐顶层计数，明细字段给空结构。
    状态条只渲染 1 个会话，recent 长尾行仅作会话切换兜底；兜底候选（force + latest +
    最近活跃前 2）恒为完整快照，轻量行只在极端长尾被兜底选中时降级显示（缺明细不缺计数）。
    sub.list 聚合数字置 0 而非缺失：overlay 的子代理面板/汇总按字段渲染，结构必须完整。"""
    u = session_usage(con, sid)
    srow = con.execute(
        "select title, summary_additions, summary_deletions, summary_files, parent_id, time_created from session where id=?",
        (sid,),
    ).fetchone()
    lr = con.execute("select max(completed_at) from model_usage where session_id=?", (sid,)).fetchone()
    now_ms = int(time.time() * 1000)
    return {
        "sid": sid,
        "title": (srow["title"] if srow is not None else "") or "",
        "active": bool(lr[0] and now_ms - lr[0] < SESSION_TIMEOUT_MS),
        "turns": u["turns"], "requests": u["requests"], "input": u["input"],
        "output": u["output"], "reasoning": u["reasoning"], "cache_read": u["cache_read"],
        "cache_write": u["cache_write"], "total": u["total"], "tool_calls": u["tool_calls"],
        "retries": u["retries"], "ctx": u["last_request_input"],
        "updated": (_ts(lr[0]).strftime("%H:%M:%S") if lr[0] else ""),
        "started": _session_start_ms(con, sid, srow),
        "sub": {"requests": 0, "total": 0, "input": 0, "output": 0, "cache_read": 0,
                "reasoning": 0, "cache_write": 0, "active": False, "rate_avg": 0, "list": []},
        "tools": {"total": u["tool_calls"], "errors": 0, "list": []},
        "last_turn": dict(_EMPTY_TURN),
        "last": {"duration_ms": 0, "ttft_ms": 0, "model": "", "provider_id": "", "tps": 0, "startedAt": 0, "endedAt": 0},
        "code": {"add": (srow["summary_additions"] if srow is not None else None),
                 "del": (srow["summary_deletions"] if srow is not None else None),
                 "files": (srow["summary_files"] if srow is not None else None)},
        "ctx_exc": 0,
        "context_window": cfg["context_window"], "context_auto": False,
        "last_at": con.execute(
            "select max(completed_at) from model_usage where session_id=? and status='completed'", (sid,),
        ).fetchone()[0] or 0,
        "is_sub": sid.startswith("sess_subagent"),
        "parent": (srow["parent_id"] if srow is not None else None),
    }


def hides_reasoning(model_id):
    """Claude 系列不单独上报思考 token：reasoning_tokens 恒为 0，output_tokens 却已含思考，
    且思考在 first_token_at 之前流出。按首字窗口计时会把思考期漏出分母（2026-10-15 真库：
    claude-opus-5-5 有 35% 请求按首字窗口超过 300 tok/s），须同含思考段一样从 started_at 起算。
    与 token_rate.hides_reasoning 同一规则。"""
    return "claude" in (model_id or "").lower()


def _row_gen_ms(r):
    """按 token_rate.py 同款口径算一行 model_usage 的生成时长；first_token_at 缺失
    或窗口非正则不可信，返回 None（该请求不参与 last.tps 计算）。"""
    ft, ct, st = r["first_token_at"], r["completed_at"], r["started_at"]
    if not ft or not ct or ct <= ft:
        return None
    gen_ms = ct - ft
    if (r["reasoning_tokens"] or hides_reasoning(r["model_id"])) and st and ct > st:
        gen_ms = ct - st   # 含思考段/Claude 系列：窗口前移到 started_at
    return gen_ms


def _rate_sample(row):
    if row and (row["output_tokens"] or 0) > 0:
        gen_ms = _row_gen_ms(row)
        if gen_ms and _TPS_MIN_GEN_MS <= gen_ms < _TPS_MAX_GEN_MS:
            return {"tps": round(row["output_tokens"] / (gen_ms / 1000), 1),
                    "startedAt": row["started_at"] or 0, "endedAt": row["completed_at"] or 0}
    return None


def _last_valid_rate(con, sid, last):
    """最近有效生成速度及同一请求的起止；最多回查 20 条，缺有效样本时隐藏。"""
    sample = _rate_sample(last)
    if sample is not None:
        return sample
    rows = con.execute(
        """select output_tokens, first_token_at, completed_at, started_at, reasoning_tokens, model_id
           from model_usage where session_id=? and status='completed'
           order by completed_at desc limit ?""",
        (sid, _TPS_LOOKBACK),
    ).fetchall()
    for row in rows:
        sample = _rate_sample(row)
        if sample is not None:
            return sample
    return {"tps": 0, "startedAt": 0, "endedAt": 0}


def _turn_rate(rows):
    output, unrated, duration = 0, 0, 0
    for row in rows:
        tokens = row["output_tokens"] or 0
        gen_ms = _row_gen_ms(row)
        if tokens > 0 and gen_ms and _TPS_MIN_GEN_MS <= gen_ms < _TPS_MAX_GEN_MS:
            output += tokens
            duration += gen_ms
        else:
            unrated += tokens
    return {"tps": round(output / (duration / 1000), 1) if duration else 0,
            "rated_output": output, "unrated_output": unrated, "gen_ms": duration}


def _rated_tps(tokens, gen_ms):
    """加权平均 t/s：Σ有效 output ÷ Σ有效生成窗口；窗口为 0（无有效样本）时返回 0。"""
    return round(tokens / (gen_ms / 1000), 1) if gen_ms else 0


def _session_snapshot(con, sid, cfg):
    """单个会话的完整快照（最新会话与 recent 列表共用一份结构）。"""
    srow = con.execute("select * from session where id=?", (sid,)).fetchone()
    u = session_usage(con, sid)
    last = con.execute(
        """select duration_ms, coalesce(time_to_first_token_ms,0), completed_at, turn_id, model_id,
                  output_tokens, first_token_at, started_at, reasoning_tokens, provider_id
           from model_usage where session_id=? and status='completed'
             and (query_source is null or query_source='main_turn')
           order by completed_at desc limit 1""",
        (sid,),
    ).fetchone()
    # 本轮数据源 = turn_usage 表的每轮完整聚合（v30 起，替代从 model_usage 手工按轮求和）：
    # 自带请求/重试/工具/工具错误计数与 reasoning 拆分，一轮一行。
    lt = {"requests": 0, "retries": 0, "tool_calls": 0, "tool_errors": 0, "input": 0,
          "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0,
          "total": 0, "duration_ms": 0, "ttft_ms": 0, "started": 0, "ended": 0,
          "tps": 0, "rated_output": 0, "unrated_output": 0, "gen_ms": 0}
    if last and last["turn_id"]:
        t = con.execute(
            """select coalesce(model_request_count,0), coalesce(model_retry_count,0),
                      coalesce(tool_call_count,0), coalesce(tool_error_count,0),
                      coalesce(input_tokens,0), coalesce(output_tokens,0), coalesce(reasoning_tokens,0),
                      coalesce(cache_read_input_tokens,0), coalesce(cache_creation_input_tokens,0),
                      coalesce(computed_total_tokens,0),
                      coalesce(duration_ms,0), coalesce(time_to_first_token_ms,0)
               from turn_usage where session_id=? and turn_id=? and status='completed'""",
            (sid, last["turn_id"]),
        ).fetchone()
        # 本轮起止：首个请求的 started_at / 最后完成请求的 completed_at（tooltip 时间范围用）
        ts_row = con.execute(
            """select min(started_at), max(completed_at) from model_usage
               where session_id=? and turn_id=? and status='completed'""",
            (sid, last["turn_id"]),
        ).fetchone()
        turn_started = (ts_row[0] or 0) if ts_row else 0
        turn_ended = (ts_row[1] or 0) if ts_row else 0
        if t:
            lt = {"requests": t[0], "retries": t[1], "tool_calls": t[2], "tool_errors": t[3],
                  "input": t[4], "output": t[5], "reasoning": t[6], "cache_read": t[7],
                  "cache_write": t[8], "total": t[9], "duration_ms": t[10], "ttft_ms": t[11],
                  "started": turn_started, "ended": turn_ended}
        else:
            # 轮进行中 turn_usage 还没落 completed 行：回退 model_usage 现场聚合，保持实时显示
            r = con.execute(
                """select count(*), coalesce(sum(input_tokens),0), coalesce(sum(output_tokens),0),
                          coalesce(sum(computed_total_tokens),0), coalesce(sum(duration_ms),0),
                          coalesce(sum(cache_read_input_tokens),0), coalesce(sum(reasoning_tokens),0),
                          coalesce(sum(cache_creation_input_tokens),0)
                   from model_usage where session_id=? and turn_id=? and status='completed'""",
                (sid, last["turn_id"]),
            ).fetchone()
            lt = {"requests": r[0], "retries": 0, "tool_calls": 0, "tool_errors": 0,
                  "input": r[1], "output": r[2], "reasoning": r[6], "cache_read": r[5],
                  "cache_write": r[7], "total": r[3], "duration_ms": r[4], "ttft_ms": 0,
                  "started": turn_started, "ended": turn_ended}
        lt.update(_turn_rate(con.execute(
            """select output_tokens, first_token_at, completed_at, started_at, reasoning_tokens, model_id
               from model_usage where session_id=? and turn_id=? and status='completed'""",
            (sid, last["turn_id"]),
        ).fetchall()))
    lr = con.execute("select max(completed_at) from model_usage where session_id=?", (sid,)).fetchone()
    active = bool(lr and lr[0] and int(time.time() * 1000) - lr[0] < SESSION_TIMEOUT_MS)
    ctx_auto = lookup_context_window(last["model_id"]) if last else None
    rate = _last_valid_rate(con, sid, last)
    sub_rows = con.execute(
        """select m.session_id, coalesce(m.agent,''), coalesce(s2.title,''), count(*),
                  coalesce(sum(m.computed_total_tokens),0),
                  coalesce(sum(m.input_tokens),0), coalesce(sum(m.output_tokens),0),
                  coalesce(sum(m.cache_read_input_tokens),0), coalesce(sum(m.reasoning_tokens),0),
                  coalesce(sum(m.cache_creation_input_tokens),0), max(m.completed_at), s2.time_created
           from model_usage m join session s2 on m.session_id = s2.id
           where m.query_source='subagent' and s2.parent_id=? and m.status='completed'
           group by m.session_id order by max(m.completed_at) desc""",
        (sid,),
    ).fetchall()
    # 子代理任务名：Agent 工具调用 part 的 input.description（与右侧"子智能体目录"面板同源）。
    # 主关联用官方回执：完成后 part.state.output 尾部带 "agentId: agent_xxx" 行，
    # 子会话 id 即 "sess_subagent_"+agentId（客户端自己的硬关联，无歧义）。
    # 兜底只给运行中尚未出现回执的条目：prompt 前缀匹配且候选唯一才绑（同前缀多候选宁可
    # 无名，不做时间猜测——历史 part 不带 childSessionId，时间最近邻存在错位风险）。
    sub_tasks = _sub_agent_tasks(con, sid) if sub_rows else {}
    # 子代理已完成段速率（v97）：每子会话 Σ有效 output / Σ有效生成窗口的加权平均，
    # 口径与 _turn_rate 完全一致（first_token_at 缺失即无窗、含思考段窗口用 started_at）；
    # 无效段不进分母。运行中的请求未入库，这里只有已完成段。
    sub_gen = {}
    if sub_rows:
        for r in con.execute(
            """select m.session_id, m.output_tokens, m.first_token_at, m.completed_at,
                      m.started_at, m.reasoning_tokens, m.model_id
               from model_usage m join session s2 on m.session_id = s2.id
               where m.query_source='subagent' and s2.parent_id=? and m.status='completed'""",
            (sid,),
        ):
            g = sub_gen.setdefault(r["session_id"], [0, 0])
            tokens = r["output_tokens"] or 0
            gen_ms = _row_gen_ms(r)
            if tokens > 0 and gen_ms and _TPS_MIN_GEN_MS <= gen_ms < _TPS_MAX_GEN_MS:
                g[0] += tokens
                g[1] += gen_ms
    now_ms = int(time.time() * 1000)
    sub = {
        "requests": sum(r[3] for r in sub_rows),
        "total": sum(r[4] for r in sub_rows),
        "input": sum(r[5] for r in sub_rows),
        "output": sum(r[6] for r in sub_rows),
        "cache_read": sum(r[7] for r in sub_rows),
        "reasoning": sum(r[8] for r in sub_rows),
        "cache_write": sum(r[9] for r in sub_rows),
        "active": any(r[10] and now_ms - r[10] < 30000 for r in sub_rows),
        "rate_avg": _rated_tps(sum(g[0] for g in sub_gen.values()),
                               sum(g[1] for g in sub_gen.values())),
        "list": [
            {"sid": r[0], "agent": r[1], "title": r[2], "task": sub_tasks.get(r[0], ""),
             "requests": r[3], "total": r[4],
             "input": r[5], "output": r[6], "cache_read": r[7], "reasoning": r[8],
             "cache_write": r[9], "last": (r[10] or 0),
             "tps_avg": _rated_tps(*sub_gen.get(r[0], [0, 0])),
             "active": bool(r[10] and now_ms - r[10] < 30000)}
            for r in sub_rows
        ],
    }
    # 工具调用明细（tool_usage 表，本会话按工具分组；status=running 的行不计入）
    tool_rows = con.execute(
        """select tool_name, count(*), coalesce(sum(duration_ms),0),
                  sum(case when status='error' then 1 else 0 end)
           from tool_usage where session_id=? and status in ('completed','error')
           group by tool_name order by count(*) desc, tool_name""",
        (sid,),
    ).fetchall()
    tools = {
        "total": sum(r[1] for r in tool_rows),
        "errors": sum(r[3] or 0 for r in tool_rows),
        "list": [
            {"name": r[0], "count": r[1], "duration_ms": r[2], "errors": r[3] or 0}
            for r in tool_rows
        ],
    }
    return {
        "sid": sid,
        "title": srow["title"] if srow is not None else "",
        "active": active,
        "turns": u["turns"] if u else 0,
        "requests": u["requests"] if u else 0,
        "input": u["input"] if u else 0,
        "output": u["output"] if u else 0,
        "reasoning": u["reasoning"] if u else 0,
        "cache_read": u["cache_read"] if u else 0,
        "cache_write": u["cache_write"] if u else 0,
        "total": u["total"] if u else 0,
        "tool_calls": u["tool_calls"] if u else 0,
        "retries": u["retries"] if u else 0,
        "ctx": u["last_request_input"] if u else 0,
        "updated": (_ts(lr[0]).strftime("%H:%M:%S") if lr and lr[0] else ""),
        "started": _session_start_ms(con, sid, srow),
        "sub": sub,
        "tools": tools,
        "last_turn": lt,
        "last": {
            "duration_ms": last["duration_ms"] if last else 0,
            "ttft_ms": last[1] if last else 0,
            "model": last["model_id"] if last else "",
            # v94：当前模型归属（额度 chip 按 provider 段选数据源）。可选字段——远端
            # 旧版 zusage.py 不返回它，消费端按缺省 "" 容错（last.startedAt 同款先例）。
            "provider_id": (last["provider_id"] or "") if last else "",
            **rate,
        },
        # 代码变更统计（session 表 summary_* 列，ZCode 目前未填充、全库为 NULL，有值才会显示）
        "code": {
            "add": (srow["summary_additions"] if srow is not None else None),
            "del": (srow["summary_deletions"] if srow is not None else None),
            "files": (srow["summary_files"] if srow is not None else None),
        },
        # 最近一次"上下文超限被拒"的时刻（该请求 status=error，不会进 completed 统计）；
        # 晚于最近成功请求 = 仍处于超限状态，进度条亮红告警
        "ctx_exc": con.execute(
            """select coalesce(max(coalesce(completed_at, started_at)),0)
               from model_usage where session_id=? and context_exceeded=1""",
            (sid,),
        ).fetchone()[0],
        "context_window": ctx_auto or cfg["context_window"],
        "context_auto": ctx_auto is not None,
        "last_at": con.execute(
            "select max(completed_at) from model_usage where session_id=? and status='completed'", (sid,),
        ).fetchone()[0] or 0,
        "is_sub": sid.startswith("sess_subagent"),
        "parent": (srow["parent_id"] if srow is not None else None),
    }


# ---------- SCNet 超算互联网（阶段 3：外部快照优先，缺失时按官方 Credits 抵扣表本地估算） ----------
# 抵扣表转写自 dsh-cost-meter（MIT，lib/coding-plans.js SCNET_CREDIT_RATES）；
# 单位 = Credits / 百万 tokens，数值可能随官方调整，执行/发版前按官方最新核对。
SCNET_CREDIT_RATES = {
    "GLM-5.2": (7543, 189, 26400), "GLM-5.1": (8743, 175, 32057), "GLM-5": (8743, 175, 32057),
    "DeepSeek-V4-Pro": (10286, 86, 20571), "DeepSeek-V4-Flash": (1200, 24, 2400),
    "DeepSeek-V4-Flash-0731": (1543, 31, 3086),
    "Kimi-K3": (34286, 343, 171429), "Kimi-K2.7-Code": (8357, 167, 34714),
    "Kimi-K2.6": (8357, 167, 34714), "Kimi-K2.5": (5143, 103, 27000),
    "MiniMax-M3": (3600, 72, 14400), "MiniMax-M2.7": (3600, 72, 14400),
    "MiniMax-M2.5": (2520, 50, 10080), "Qwen3.8-max": (18514, 231, 49371),
}


def _scnet_source_cfg():
    """quota-secrets.json 的 scnet 段（与 config.json 同目录）。未启用/未配 planCredits 返回 None。"""
    try:
        d = json.loads((Path(__file__).parent / "quota-secrets.json").read_text(encoding="utf-8"))
        src = ((d.get("sources") or {}).get("scnet") or {})
    except Exception:
        return None
    credits = src.get("planCredits")
    if src.get("enabled") is not True or not isinstance(credits, (int, float)) or credits <= 0:
        return None
    return src


def _scnet_period(src):
    """计费周期 [start_ms, end_ms)：planStart(YYYY-MM-DD) 锚日每月同日；缺省自然月。
    月末锚日（29/30/31）在短月按当月最后一天收敛（2 月不抛 ValueError、不早移周期）。"""
    import calendar
    from datetime import datetime

    tz = datetime.now().astimezone()
    anchor = None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
        try:
            anchor = datetime.strptime(str(src.get("planStart") or ""), fmt)
            break
        except Exception:
            continue

    def clamp_day(year, month, day):
        return min(day, calendar.monthrange(year, month)[1])

    def add_months(year, month, n):
        idx = (year * 12 + (month - 1)) + n
        return idx // 12, idx % 12 + 1

    now_local = tz.replace(tzinfo=None)
    if anchor is None:
        y, m = now_local.year, now_local.month
        sd = 1
    else:
        sd = anchor.day
        y, m = now_local.year, now_local.month
    # 从当前月往回找：第一个"锚日（或短月收敛日）"不晚于 now 的月即周期起始月
    while True:
        d = clamp_day(y, m, sd)
        cand = datetime(y, m, d)
        if cand <= now_local or (anchor is None and m == now_local.month and y == now_local.year):
            start = cand
            break
        y, m = add_months(y, m, -1)
    ny, nm = add_months(start.year, start.month, 1)
    end = datetime(ny, nm, clamp_day(ny, nm, sd))
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def _scnet_snapshot(src):
    """外部控制台额度快照：scnet_official.json（≤16KB、24h 内有效；resetsAt 缺省须落在本周期内）。"""
    path = Path(__file__).parent / "scnet_official.json"
    try:
        if path.stat().st_size > 16 * 1024:
            return None
        d = json.loads(path.read_text(encoding="utf-8"))
        used, total = d.get("used"), d.get("total")
        fetched = d.get("fetchedAt") or d.get("at")
        if not all(isinstance(v, (int, float)) and v > 0 for v in (used, total)):
            return None
        if not isinstance(fetched, (int, float)) or fetched < 1000 or time.time() * 1000 - fetched > 24 * 3600 * 1000:
            return None
        resets = d.get("resetsAt")
        if resets is None:
            s_ms, e_ms = _scnet_period(src)
            if not (s_ms <= fetched < e_ms):
                return None
        return {"used": used, "total": total, "resetsAt": resets}
    except Exception:
        return None


def _scnet_estimate(con):
    """快照优先；无快照按抵扣表 × 本地账本估算（main_turn 的 input/cacheRead/output 分费率求和）。"""
    if con is None:
        return None
    src = _scnet_source_cfg()
    if src is None:
        return None
    plan_credits = float(src["planCredits"])
    snap = _scnet_snapshot(src)
    s_ms, e_ms = _scnet_period(src)
    if snap is not None and snap["total"] > 0:
        return {"source": "snapshot", "credits_used": round(float(snap["used"]), 2),
                "plan_credits": round(float(snap["total"]), 2), "resets_at": snap["resetsAt"]}
    patterns = src.get("modelPatterns") or {}
    if not isinstance(patterns, dict) or not patterns:
        return None
    compiled = []
    for pat, key in patterns.items():
        rate = SCNET_CREDIT_RATES.get(str(key))
        if rate:
            compiled.append((re.compile(fnmatch.translate(str(pat)), re.IGNORECASE), rate))
    if not compiled:
        return None
    credits = 0.0
    try:
        rows = con.execute(
            """select model_id, coalesce(input_tokens,0), coalesce(cache_read_input_tokens,0),
                      coalesce(cache_creation_input_tokens,0), coalesce(output_tokens,0)
               from model_usage
               where status='completed' and (query_source is null or query_source='main_turn')
                 and completed_at>=? and completed_at<?""",
            (s_ms, e_ms)).fetchall()
    except Exception:
        rows = []
    for model_id, tin, tcache_r, tcache_w, tout in rows:
        for rx, (r_in, r_cached, r_out) in compiled:
            if rx.match(str(model_id or "")):
                credits += ((tin + tcache_w) * r_in + tcache_r * r_cached + tout * r_out) / 1e6
                break
    return {"source": "estimate", "credits_used": round(credits, 2),
            "plan_credits": round(plan_credits, 2), "resets_at": e_ms - 1}


_EMPTY_TURN = {"requests": 0, "retries": 0, "tool_calls": 0, "tool_errors": 0, "input": 0,
               "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0,
               "total": 0, "duration_ms": 0, "ttft_ms": 0, "started": 0, "ended": 0,
               "tps": 0, "rated_output": 0, "unrated_output": 0, "gen_ms": 0}


# ---------- 远端数据源：identity 路由与目标隔离 ----------

_REMOTE_NEG = {}                        # (sid, 目标键) -> [查询时刻ms, 生效TTLms]
_REMOTE_NEG_TTL_OK = 2 * 60 * 1000      # 远端确认"无此会话"后多久内不再问（远端新会话极少数竞态下最迟 2 分钟自愈）
_REMOTE_NEG_TTL_ERR = 60 * 1000         # ssh 失败/超时：短退避，尽快自愈
_REMOTE_TARGET_KEY_RE = re.compile(r"[a-z][a-z0-9]{0,31}")
_REMOTE_SID_RE = re.compile(r"[A-Za-z0-9_-]{1,80}")

_DESKTOP_SETTING_SUBPATH = (".zcode", "v2", "setting.json")
_CLIENT_STATE_CACHE = {"sig": None, "entries": []}


def _desktop_home():
    """客户端 setting.json 的 HOME 基准：dev 实例可用 ZCODE_DESKTOP_HOME_DIR 改写
    （与客户端 packages/services/src/setting 的解析顺序对齐），否则当前用户家目录。"""
    return (os.environ.get("ZCODE_DESKTOP_HOME_DIR", "").strip()
            or os.environ.get("HOME", "").strip()
            or os.environ.get("USERPROFILE", "").strip() or str(Path.home()))


def _desktop_setting_path():
    return Path(_desktop_home()).joinpath(*_DESKTOP_SETTING_SUBPATH)


def _read_client_remote_entries():
    """客户端持久化的远程工作区条目（lastWorkspaceSession，兼容旧键 remoteWorkspaceHistory）。
    带 mtime 缓存（文件每次变更整写一遍，stat 开销可忽略）；解析失败一律返回 []，只读不写。"""
    sig = None
    try:
        p = _desktop_setting_path()
        sig = (str(p), p.stat().st_mtime_ns)
    except OSError:
        pass
    if sig is None:
        _CLIENT_STATE_CACHE["sig"] = None
        _CLIENT_STATE_CACHE["entries"] = []
        return []
    if _CLIENT_STATE_CACHE["sig"] == sig:
        return _CLIENT_STATE_CACHE["entries"]
    entries = []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return []
        raw = data.get("lastWorkspaceSession")
        legacy = data.get("remoteWorkspaceHistory")
        legacy = legacy if isinstance(legacy, list) else []
        if isinstance(raw, list):
            by_id = {e.get("id"): e for e in legacy if isinstance(e, dict)}
            raw = [by_id.get(e.get("historyId"), e) if isinstance(e, dict) else e for e in raw]
        else:
            raw = legacy
        if isinstance(raw, list):
            entries = [e for e in raw if isinstance(e, dict)]
    except (OSError, ValueError):
        entries = []
    _CLIENT_STATE_CACHE["sig"] = sig
    _CLIENT_STATE_CACHE["entries"] = entries
    return entries


def _read_client_server_history():
    """3.16 起客户端把会话握手升级出的 remote:server:<serverId>:/路径 存活身份单独记在
    sourceServerWorkspaceHistory，lastWorkspaceSession 持久化的仍是传输级 legacy 身份，
    两者只共享 workspacePath。与 _read_client_remote_entries 同文件同 mtime 缓存模式；
    解析失败返回 []，只读不写。"""
    sig = None
    try:
        p = _desktop_setting_path()
        sig = (str(p), p.stat().st_mtime_ns)
    except OSError:
        pass
    if sig is None:
        _CLIENT_STATE_CACHE["server_sig"] = None
        _CLIENT_STATE_CACHE["server_hist"] = []
        return []
    if _CLIENT_STATE_CACHE.get("server_sig") == sig:
        return _CLIENT_STATE_CACHE["server_hist"]
    hist = []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        raw = data.get("sourceServerWorkspaceHistory") if isinstance(data, dict) else None
        if isinstance(raw, list):
            hist = [e for e in raw if isinstance(e, dict)]
    except (OSError, ValueError):
        hist = []
    _CLIENT_STATE_CACHE["server_sig"] = sig
    _CLIENT_STATE_CACHE["server_hist"] = hist
    return hist


def _server_idents_by_path():
    """归一路径 → 握手升级身份列表。只采 remote:server: 前缀且带 sourceServerId 的条目；
    同一路径混入多个 sourceServerId 时无法唯一归属服务器，整路径放弃（fail-closed）。"""
    by_path, owners = {}, {}
    for e in _read_client_server_history():
        ident = str(e.get("workspaceIdentity") or "").strip()
        server = str(e.get("sourceServerId") or "").strip()
        if not ident.startswith("remote:server:") or not server:
            continue
        # 缺 workspacePath 的条目无法按路径与传输条目关联（客户端字段 optional），
        # 跳过，避免与同样缺路径的传输条目在归一 "/" 上跨条目碰撞。
        if not str(e.get("workspacePath") or "").strip():
            continue
        path = _normalize_identity_path(e.get("workspacePath"))
        idents = by_path.setdefault(path, [])
        if ident not in idents:
            idents.append(ident)
        owners.setdefault(path, set()).add(server)
    return {p: idents for p, idents in by_path.items() if len(owners[p]) == 1}


def _normalize_identity_path(p):
    """客户端 normalizeWorkspacePathForIdentity 同款：反斜杠归一、折叠重复斜杠、去尾补头。"""
    s = str(p or "").replace("\\", "/")
    while "//" in s:
        s = s.replace("//", "/")
    s = s.rstrip("/") or "/"
    return s if s.startswith("/") else "/" + s


def _ssh_identity(host, port, username, path):
    """客户端 workspaceIdentity 构造算法（remote-workspace-identity.ts）的 Python 版：
    remote:ssh:<host小写>:<port>:<username>:<归一路径>。重连换代（remoteSessionId 变）不影响它，
    是 sid→目标路由的稳定键。"""
    try:
        port = int(port or 22)
    except (TypeError, ValueError):
        port = 22
    return "remote:ssh:{}:{}:{}:{}".format(
        str(host).strip().lower(), port, str(username).strip(), _normalize_identity_path(path))


def _wsl_identity(distro, user, path):
    """客户端 buildRemoteWorkspaceIdentity wsl 分支同款：
    remote:wsl:<distro>[:<user>]:<归一路径>。user 段可选（旧版客户端无 user 格式，靠
    路径必以 / 开头区分）；v3.16 起握手后客户端会把会话身份升级为 remote:server:，
    但持久化条目里拿到的就是当时身份，优先原样采用，这里只兜底构造。
    客户端固有歧义：缺省 distro 与字面 "default" 构造出同一身份（bss 的 ||"default"），
    两者对应不同通道时路由随条目顺序漂移，客户端自身无法区分，接受。"""
    d = str(distro or "").strip() or "default"
    u = str(user or "").strip()
    if u:
        return "remote:wsl:{}:{}:{}".format(d, u, _normalize_identity_path(path))
    return "remote:wsl:{}:{}".format(d, _normalize_identity_path(path))


def _docker_identity(container, path):
    """客户端 buildRemoteWorkspaceIdentity docker 分支同款：remote:docker:<container>:<归一路径>。"""
    return "remote:docker:{}:{}".format(str(container or "").strip(), _normalize_identity_path(path))


def _auto_targets(cfg):
    """客户端 setting.json → 自动远端目标列表。auto:false 或递归子查询（ZUSAGE_REMOTE_CHILD=1）
    时返回 []。ssh 按连接（别名/密钥+主机+端口+用户）合并；wsl 按（发行版+用户）、docker 按
    容器合并为一条通道，多工作区聚合 identities；纯密码凭据（passwordCredentialKey 且无密钥/
    别名）的 ssh 无法免交互，跳过。workspaceIdentity 一律原样采用（客户端会透传到 DOM/IPC，
    路由按整串相等），缺失时才按同款算法兜底构造。server 类型没有免交互 exec 通道，不生成。
    3.16 起存活会话身份握手后升级为 remote:server:<serverId>:/路径，记在
    sourceServerWorkspaceHistory，与 lastWorkspaceSession 只共享 workspacePath：按归一路径
    把 server 身份并进路径匹配的传输通道，使 3.15/3.16 两种身份形态都能路由；同一路径命中
    多条通道或多个服务器视为歧义，不并（fail-closed）。"""
    r = cfg.get("remote")
    if isinstance(r, dict) and r.get("auto") is False:
        return []
    if os.environ.get("ZUSAGE_REMOTE_CHILD") == "1":
        return []
    # wsl --exec / docker exec 不经登录 shell，进程 CWD 不可靠，自动通道的默认脚本
    # 必须带 ~ 前缀（exec 端 runpy bootstrap 展开）；用户显式 remote.script 优先。
    explicit_script = isinstance(r, dict) and bool(r.get("script"))
    server_idents = _server_idents_by_path()
    path_channels = {}
    merged = {}
    for e in _read_client_remote_entries():
        t = e.get("target")
        if not isinstance(t, dict):
            continue
        ident = str(e.get("workspaceIdentity") or "").strip()
        kind = t.get("kind")
        if kind == "ssh":
            host = str(t.get("host") or "").strip()
            username = str(t.get("username") or "").strip()
            if not host or not username:
                continue
            alias = str(t.get("sshConfigAlias") or "").strip()
            key_path = str(t.get("privateKeyPath") or "").strip()
            if not alias and not key_path and t.get("passwordCredentialKey"):
                continue   # 密码认证拿不到明文，ssh 也无法免交互
            try:
                port = int(t.get("port") or 22)
            except (TypeError, ValueError):
                port = 22
            ident = ident or _ssh_identity(host, port, username, e.get("workspacePath"))
            ck = (kind, alias, host.lower(), port, username, key_path)
            ent = merged.get(ck)
            if ent is None:
                argv = ["ssh", "-o", "BatchMode=yes"]
                if alias:
                    argv.append(alias)   # 别名交给用户 ssh_config 解析 host/port/密钥
                else:
                    if port != 22:
                        argv += ["-p", str(port)]
                    if key_path:
                        argv += ["-i", key_path, "-o", "IdentitiesOnly=yes"]
                    argv.append(f"{username}@{host}")
                ent = {"ssh_argv": argv, "host_label": alias or host, "identities": []}
                merged[ck] = ent
        elif kind == "wsl":
            distro = str(t.get("distro") or "").strip()
            user = str(t.get("user") or "").strip()
            ident = ident or _wsl_identity(distro, user, e.get("workspacePath"))
            # distro 匹配大小写不敏感能并通道；user 是 Linux 用户名、大小写敏感不能并。
            ck = (kind, distro.lower(), user)
            ent = merged.get(ck)
            if ent is None:
                # --exec 对齐客户端 v3.16.1 buildWslArgs：绕过发行版默认 shell 的
                # 变量/管道展开，argv（含 runpy bootstrap 的分号引号）原样到达；
                # -d/-u 仅在真值时附加（distro 缺省走默认发行版，客户端同款）。
                argv = ["wsl.exe"]
                if distro:
                    argv += ["-d", distro]
                if user:
                    argv += ["-u", user]
                argv.append("--exec")
                ent = {"ssh_argv": argv, "host_label": f"wsl:{distro or 'default'}", "identities": []}
                if not explicit_script:
                    ent["script"] = "~/.zcode/zcode-token-usage-statusbar/zusage.py"
                merged[ck] = ent
        elif kind == "docker":
            container = str(t.get("container") or "").strip()
            if not container:
                continue
            ident = ident or _docker_identity(container, e.get("workspacePath"))
            # Docker 容器名大小写敏感（与 ssh host 不同），原样作键避免不同容器误并。
            ck = (kind, container)
            ent = merged.get(ck)
            if ent is None:
                ent = {"ssh_argv": ["docker", "exec", "-i", container],
                       "host_label": f"docker:{container}", "identities": []}
                if not explicit_script:
                    ent["script"] = "~/.zcode/zcode-token-usage-statusbar/zusage.py"
                merged[ck] = ent
        else:
            continue
        if ident not in ent["identities"]:
            ent["identities"].append(ident)
        path_key = _normalize_identity_path(e.get("workspacePath"))
        if path_key in server_idents:
            # 先只登记路径→通道归属，循环结束后统一并入：同一路径命中多条通道
            # 时无法唯一归属，整路径放弃（fail-closed），不按条目顺序猜首条。
            path_channels.setdefault(path_key, set()).add(ck)
    for path_key, cks in path_channels.items():
        if len(cks) != 1:
            continue
        ent = merged[next(iter(cks))]
        for idn in server_idents[path_key]:
            if idn not in ent["identities"]:
                ent["identities"].append(idn)
    return sorted(merged.values(), key=lambda x: (x["host_label"], x["identities"]))


def _normalize_remote_entry(ent):
    """单目标条目 → 归一化 rcfg 或 None。字段同旧 _remote_cfg，另收 identities[]（路由键）。"""
    if not isinstance(ent, dict):
        return None
    ssh = ent.get("ssh")
    if ssh is None:
        ssh = ent.get("ssh_argv") or []
    if isinstance(ssh, list):
        ssh_argv = [str(x) for x in ssh]
    else:
        try:
            ssh_argv = shlex.split(str(ssh))
        except ValueError:
            ssh_argv = str(ssh).split()
    if not ssh_argv:
        return None
    idents = ent.get("identities")
    if not isinstance(idents, list):
        idents = [ent.get("identity")] if ent.get("identity") else []
    return {
        "ssh_argv": ssh_argv,
        "script": str(ent.get("script") or ".zcode/zcode-token-usage-statusbar/zusage.py"),
        "python": str(ent.get("python") or "python3"),
        "timeout_s": min(6.0, max(1.0, float(ent.get("timeout_s") or 6))),
        "host_label": str(ent.get("host_label") or (ssh_argv[-1] if len(ssh_argv) > 1 else "remote")),
        "identities": [str(x).strip() for x in idents if str(x).strip()],
    }


def _remote_setup(cfg):
    """自动目标只接受 identity 路由；enabled:true 保留旧单通道兜底。"""
    if os.environ.get("ZUSAGE_REMOTE_CHILD") == "1":
        return None
    r = cfg.get("remote")
    r = r if isinstance(r, dict) else {}
    if r.get("auto") is False and r.get("enabled") is not True:
        return None
    targets, identities = {}, {}
    default = None

    def add(ent):
        defaults = {k: r[k] for k in ("script", "python", "timeout_s") if k in r}
        try:
            rc = _normalize_remote_entry({**defaults, **ent})
        except (TypeError, ValueError):
            return None
        if not rc:
            return None
        fingerprint = json.dumps([rc["ssh_argv"], rc["python"], rc["script"]], ensure_ascii=True)
        key = "t" + hashlib.sha256(fingerprint.encode()).hexdigest()[:16]
        if key in targets:
            rc["identities"] = list(dict.fromkeys(targets[key]["identities"] + rc["identities"]))
        targets[key] = rc
        for ident in rc["identities"]:
            identities[ident] = key
        return key

    if r.get("auto") is not False:
        for ent in _auto_targets(cfg):
            add(ent)
    # 后加入的手动 identity 覆盖自动连接参数，不依赖目标列表顺序。
    for ent in (r.get("targets") or []):
        if isinstance(ent, dict):
            key = add(ent)
            if r.get("enabled") is True and default is None:
                default = key
    if r.get("enabled") is True and r.get("ssh"):
        default = add({"ssh": r["ssh"], "identities": [], "host_label": r.get("host_label")})
    if not targets:
        return None
    return {"targets": targets, "default": default, "identities": identities,
            "auto": r.get("auto") is not False}


def _parse_routes(s):
    """路由段 'sid@key,sid2@key2' → {sid: key}。逐 token 白名单校验（泵侧同款），脏 token 忽略。"""
    routes = {}
    for tok in str(s or "").split(","):
        if "@" not in tok:
            continue
        sid, key = tok.split("@", 1)
        sid, key = sid.strip(), key.strip()
        if _REMOTE_SID_RE.fullmatch(sid) and _REMOTE_TARGET_KEY_RE.fullmatch(key):
            routes[sid] = key
    return routes


def _parse_query(line):
    """兼容旧逗号协议与携带 workspaceIdentity 的 JSON 请求。"""
    if line.lstrip().startswith("{"):
        data = json.loads(line)
        if not isinstance(data, dict):
            raise ValueError("query must be an object")
        sids = data.get("sids") or []
        if not isinstance(sids, list):
            raise ValueError("sids must be an array")
        return ",".join(str(s) for s in sids), data.get("scopes") or []
    if "|" in line:
        sids, rstr = line.split("|", 1)
        return sids.strip(), _parse_routes(rstr)
    return line.strip(), {}


def _remote_exec(sids, rcfg, key):
    """执行通道返回 (by_sid, today, error)，远端子查询禁止再次访问远端。"""
    argv = ["env", "ZUSAGE_REMOTE_CHILD=1", rcfg["python"], rcfg["script"], "json", ",".join(sids)]
    channel = rcfg["ssh_argv"]
    if Path(channel[0]).stem.lower() == "ssh":
        # OpenSSH 将参数重新拼成 shell 文本，必须在远端边界引用，而非依赖本地 argv。
        def quote(arg):
            if arg.startswith("~/"):
                return '"$HOME"/' + shlex.quote(arg[2:])
            return shlex.quote(arg)
        cmd = channel + [" ".join(quote(arg) for arg in argv)]
    else:
        # docker/wsl/kubectl 的 exec 接口直接接收 argv，不解析 shell assignment。
        script = rcfg["script"]
        if script.startswith("~/"):
            bootstrap = "import os,runpy,sys;p=os.path.expanduser(sys.argv[1]);sys.argv=sys.argv[1:];runpy.run_path(p,run_name='__main__')"
            argv = ["env", "ZUSAGE_REMOTE_CHILD=1", rcfg["python"], "-c", bootstrap, script, "json", ",".join(sids)]
        cmd = channel + argv
    err = None
    payload = None
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=rcfg["timeout_s"])
        out = p.stdout.decode("utf-8", "replace")
        if p.returncode != 0:
            err = f"ssh rc={p.returncode}: {p.stderr.decode('utf-8', 'replace').strip()[:160]}"
        else:
            # 取最后一行能解析的 JSON 对象：容忍远端登录 banner 混进 stdout
            for line in reversed(out.splitlines()):
                line = line.strip()
                if line.startswith("{"):
                    try:
                        payload = json.loads(line)
                        break
                    except ValueError:
                        continue
            if payload is None:
                err = "remote returned no JSON payload"
    except subprocess.TimeoutExpired:
        err = f"ssh timeout after {rcfg['timeout_s']:g}s"
    except OSError as e:
        err = f"ssh spawn failed: {e}"
    if payload is None:
        return {}, None, err or "remote query failed"
    if payload.get("error") or payload.get("local_error"):
        return {}, None, "remote query failed: " + str(payload.get("error") or payload["local_error"])[:160]
    # known_sids = 远端库里真实存在的 force 会话（session 行或任一 usage 行）。
    # 远端对未知 sid 也会产出零值快照，不按它过滤的话"确无此会话"永远判不了，
    # 负缓存失效 → 本地新会话每轮都白跑一次 ssh。缺 known_sids 字段 = 远端是旧版
    # 脚本：退化为按活跃度识别（零值快照 requests/last_at 恒为 0）。
    known = payload.get("known_sids")
    legacy = not isinstance(known, list)
    known = set(known or [])
    by = {}
    for rec in payload.get("recent") or []:
        if not isinstance(rec, dict) or rec.get("sid") not in sids:
            continue
        # 远端旧版脚本（无 known_sids）退化为按活跃度识别：零值快照 requests/last_at 恒为 0
        found = (rec["sid"] in known) if not legacy else (
            (rec.get("requests") or 0) > 0 or (rec.get("last_at") or 0) > 0)
        if found:
            rec["remote"] = True
            rec["remote_host"] = rcfg["host_label"]
            rec["remote_target"] = key
            by[rec["sid"]] = rec
    return by, payload.get("today"), err


def _remote_fetch(force_sids, have_local, setup, routes=None, scopes=None):
    """按 identity 查目标；旧请求仅手动默认兜底，负缓存按 (sid, target) 隔离。"""
    now_ms = int(time.time() * 1000)
    routes = routes or {}
    default = setup.get("default")

    def resolve(s):
        key = routes.get(s)
        return key if key in setup["targets"] else default   # 未知/过期目标键回退默认通道

    missing = []
    for s in force_sids:
        if s in have_local:
            continue
        ent = _REMOTE_NEG.get((s, resolve(s)))
        if ent and now_ms - ent[0] < ent[1]:
            continue
        missing.append(s)
    if not missing and scopes is None:
        errs = {resolve(s): _REMOTE_NEG[(s, resolve(s))][2] for s in force_sids
                if (s, resolve(s)) in _REMOTE_NEG and len(_REMOTE_NEG[(s, resolve(s))]) > 2
                and _REMOTE_NEG[(s, resolve(s))][2]}
        return {}, {}, errs
    groups = {}
    scoped_keys = {}
    if scopes is not None:
        for sid, ident in scopes:
            if not ident.startswith("remote:"):
                continue
            key = setup["identities"].get(ident)
            scoped_keys[(sid, ident)] = key
            if key and (not _REMOTE_NEG.get((sid, key)) or
                        now_ms - _REMOTE_NEG[(sid, key)][0] >= _REMOTE_NEG[(sid, key)][1]):
                bucket = groups.setdefault(key, [])
                if sid not in bucket:
                    bucket.append(sid)
    else:
        for s in missing:
            key = resolve(s)
            if key in setup["targets"]:
                groups.setdefault(key, []).append(s)
    by, today, errs = {}, {}, {}
    per_target = {}
    selected = {(sid, key) for (sid, _), key in scoped_keys.items()} if scopes is not None else {
        (sid, resolve(sid)) for sid in force_sids}
    for sid, key in selected:
        cached = _REMOTE_NEG.get((sid, key))
        if cached and now_ms - cached[0] < cached[1] and len(cached) > 2 and cached[2]:
            errs[key] = cached[2]
    # 各目标独立执行；总预算6秒，排队目标不再启动，避免超过桌面15秒看门狗。
    deadline = time.monotonic() + 6.0
    def bounded_query(item):
        key, sids = item
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return key, sids, ({}, None, "remote query budget exhausted")
        rc = dict(setup["targets"][key], timeout_s=min(setup["targets"][key]["timeout_s"], remaining))
        try:
            result = _remote_exec(sids, rc, key)
        except Exception as exc:
            result = ({}, None, "remote query failed: " + str(exc)[:160])
        return key, sids, result

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(bounded_query, groups.items()))
    for key, sids, (by_sid, t, err) in results:
        per_target[key] = by_sid
        by.update(by_sid)
        if isinstance(t, dict):
            today[key] = t
        if err:
            errs[key] = err
        for s in sids:
            if s in by_sid:
                _REMOTE_NEG.pop((s, key), None)
            else:
                _REMOTE_NEG[(s, key)] = (int(time.time() * 1000), _REMOTE_NEG_TTL_ERR if err else _REMOTE_NEG_TTL_OK, err)
    if scopes is not None:
        by = {}
        for (sid, ident), key in scoped_keys.items():
            rec = dict(per_target.get(key, {}).get(sid) or {})
            rec.update(sid=sid, workspace_identity=ident, remote=True,
                       remote_target=key or "", remote_host=setup["targets"].get(key, {}).get("host_label", ""))
            if not per_target.get(key, {}).get(sid):
                error = (errs.get(key) or "remote session not found") if key else "remote target not configured"
                rec.update(remote_missing=True, remote_error=error)
            by[(sid, ident)] = rec
    if len(_REMOTE_NEG) > 512:
        _REMOTE_NEG.clear()   # 防长驻膨胀（多目标下键数翻倍，上限同步放宽）
    return by, today, errs


def _empty_snapshot(sid, cfg):
    return {"sid": sid, "title": "", "active": False, "turns": 0, "requests": 0,
            "input": 0, "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0,
            "total": 0, "tool_calls": 0, "retries": 0, "ctx": 0, "updated": "", "last_at": 0, "started": 0,
            "last_turn": dict(_EMPTY_TURN), "last": {"duration_ms": 0, "ttft_ms": 0, "model": "", "tps": 0, "startedAt": 0, "endedAt": 0},
            "code": {"add": None, "del": None, "files": None}, "ctx_exc": 0,
            "tools": {"total": 0, "errors": 0, "list": []},
            "sub": {"requests": 0, "total": 0, "input": 0, "output": 0, "cache_read": 0,
                    "reasoning": 0, "cache_write": 0, "active": False, "rate_avg": 0, "list": []},
            "context_window": cfg["context_window"], "context_auto": False}


def snapshot(force_sid="", routes=None):
    """单次快照：最新会话 + 最近 6+6 会话池 + 今日。
    force_sid：各窗口当前会话 id，逗号分隔（泵按窗口汇总上报：主进程 IPC 映射的焦点会话 +
    overlay localStorage 键兜底），全部强制纳入快照——不在 6+6 池里的会话（新开的、久远的）
    也能被各窗口找到自己的会话并显示（v32 起；v34 改为多窗口多 sid）。
    routes：sid→目标键（泵按窗口 workspaceIdentity 路由）；未路由会话走默认目标。"""
    cfg = load_config()
    scopes = None
    if isinstance(routes, list):
        scopes = []
        for scope in routes:
            if not isinstance(scope, dict):
                continue
            sid, ident = str(scope.get("sid") or ""), str(scope.get("workspaceIdentity") or "").strip()
            if _REMOTE_SID_RE.fullmatch(sid) and ident and (sid, ident) not in scopes:
                scopes.append((sid, ident))
        force_sid = ",".join([str(force_sid)] + [s for s, _ in scopes])
        routes = {}
    con = None
    local_error = None
    try:
        con = connect()
    except sqlite3.Error as exc:
        local_error = str(exc)[:200]
    try:
        force_sids = []
        for fs in str(force_sid).split(","):
            fs = fs.strip()
            if fs and re.fullmatch(r"[A-Za-z0-9_-]+", fs) and fs not in force_sids:
                force_sids.append(fs)
        try:
            day = _day_start()
            start_ms, end_ms = _epoch_ms(day), _epoch_ms(day + timedelta(days=1))
            today = _cached_agg(("today", start_ms), lambda: _today_usage(
                con, start_ms, end_ms)) if con else (0,) * 11
            rows = _scan_session_ids(con) if con else []
            have_local = set()
            if con and force_sids:
                qmarks = ",".join("?" * len(force_sids))
                have_local = {r[0] for r in con.execute(
                    f"select id from session where id in ({qmarks})", force_sids)}
                have_local |= {r[0] for r in con.execute(
                    f"select distinct session_id from model_usage where session_id in ({qmarks})", force_sids)}
        except sqlite3.Error as exc:
            local_error = str(exc)[:200]
            con.close()
            con = None
            today, rows, have_local = (0,) * 11, [], set()
        known_sids = [s for s in force_sids if s in have_local]
        # 远端补齐（v12）：本地不存在的 force 会话按路由分组查各自远端库
        setup = _remote_setup(cfg)
        remote_by, remote_today, remote_errs = {}, {}, {}
        if force_sids and (setup or scopes is not None):
            remote_by, remote_today, remote_errs = _remote_fetch(
                force_sids, have_local, setup or {"targets": {}, "identities": {}, "default": None}, routes, scopes)
        remote_err = next(iter(remote_errs.values()), None)   # 兼容旧单错误字段（第一个目标）
        # 本地库里没有的 force 会话（远端/他机会话，或数据还没落库）。渲染端据此给提示：
        # 零值不再只能靠用户猜"插件坏了"（issue #14），也区分"远端也没查到"（issue #10）。
        not_local = [s for s in force_sids if s not in have_local] if force_sids else []
        def local_snapshot(sid, light=False):
            nonlocal local_error
            if con is None:
                return _empty_snapshot(sid, cfg)
            try:
                return (_light_snapshot if light else _session_snapshot)(con, sid, cfg)
            except sqlite3.Error as exc:
                # 本地明细表缺失不能丢弃已成功的远端分片，失败行单独降级。
                local_error = str(exc)[:200]
                return _empty_snapshot(sid, cfg)

        latest_sid = max(rows, key=lambda r: r[1])[0] if rows else None
        base = local_snapshot(latest_sid) if latest_sid else _empty_snapshot("", cfg)
        normal = sorted((r for r in rows if not str(r[0]).startswith("sess_subagent")),
                        key=lambda r: -r[1])[:6]
        suba = sorted((r for r in rows if str(r[0]).startswith("sess_subagent")),
                      key=lambda r: -r[1])[:6]
        ids = [r[0] for r in normal] + [r[0] for r in suba]
        seen = set()
        ids = [x for x in ids if not (x in seen or seen.add(x))]
        if latest_sid and latest_sid not in ids:
            ids.insert(0, latest_sid)
        # 远端命中的会话不进本地 ids 循环（本地 _session_snapshot 查不到只会产出零值行）
        remote_ids = [s for s in force_sids if s in remote_by]
        for fs in reversed(force_sids):
            if fs not in ids and fs not in remote_ids:
                ids.insert(0, fs)
        # recent 池瘦身（v8）：状态条只渲染 1 个会话，完整快照只给兜底候选
        # （force + latest + 最近活跃前 2），其余长尾行走轻量查询（单会话 38ms→2ms）。
        full_n = len(force_sids) + 3
        rec = []
        for i, sid in enumerate(ids):
            if sid == latest_sid:
                rec.append(base)
            else:
                rec.append(local_snapshot(sid, light=i >= full_n))
        # rec 建好后把远端快照挂到池首：overlay 按 sid 匹配 mine，顺序只影响兜底展示
        rec = ([remote_by[s] for s in reversed(remote_ids)] + rec) if scopes is None else (
            [{**_empty_snapshot(sid, cfg), **row} for (sid, _), row in remote_by.items()] + rec)
        if scopes is not None:
            local_rows = {row["sid"]: row for row in rec if not row.get("remote")}
            for sid, ident in scopes:
                if not ident.startswith("remote:"):
                    rec.insert(0, {**local_rows.get(sid, _empty_snapshot(sid, cfg)), "workspace_identity": ident})
        return {
            "local_error": local_error,
            "session": base,
            "last_turn": base["last_turn"],
            "last": base["last"],
            "today": {
                "requests": today[0], "input": today[1], "output": today[2],
                "cache_read": today[3], "total": today[4],
                "reasoning": today[6], "retries": today[7], "cache_write": today[8],
                "started": today[9] or 0, "last_at": today[10] or 0,
            },
            # 远端数据源（v12）：显示远端会话时 overlay 按其 remote_target 取对应主机的今日值；
            # dict 键=目标键。remote_error 保留首个错误（旧字段），remote_errors 按目标细分。
            "remote_today": remote_today,
            "remote_error": remote_err,
            "remote_errors": remote_errs,
            # 目标清单（泵路由用）：identity → 键；host_label 供日志/诊断
            "remote_targets": [
                {"key": k, "host_label": rc["host_label"], "identities": rc["identities"]}
                for k, rc in (setup or {}).get("targets", {}).items()
            ],
            "not_local": not_local,               # 不在本地库的 force 会话 id（issue #14 提示用）
            # v96 额度 chip 的会话无历史回退：全局最近一个完成的套餐档请求（账号级数据，
            # 与会话无关）。会话自身没有任何请求历史（新会话/刚切模型还没发请求）时，
            # 渲染端用它跟随账号当前套餐档，消除"切模型到首个请求完成之间 chip 空窗"。
            # 只取 account:*（内置套餐档）；最近请求是自定义 provider 时为空串，不回退。
            "provider_fallback": ((con.execute(
                """select provider_id from model_usage
                   where status='completed' and (query_source is null or query_source='main_turn')
                     and provider_id like 'account:%'
                   order by completed_at desc limit 1"""
            ).fetchone() or ("",))[0] or "") if con is not None else "",
            # SCNet 账本估算（无凭据）：主进程注入 quota-client 的 scnet 源；未配置为 None
            "scnet_estimate": _scnet_estimate(con),
            "remote_enabled": bool(setup),        # 是否存在可用远端目标（区分"没配"与"配了没查到"）
            "known_sids": known_sids,
            "context_window": base["context_window"],
            "context_auto": base["context_auto"],
            "code": base["code"],
            "ctx_exc": base["ctx_exc"],
            "tools": base["tools"],
            "recent": rec,
        }
    finally:
        if con is not None:
            con.close()


# ---------- CLI ----------

def serve():
    """常驻查询服务（v8 泵配套）：省每次 ~60-100ms 的解释器启动+模块加载费。
    stdin 每行一个请求（空行 = 无强制会话），stdout 每行一个 JSON 快照。
    stdin EOF = 泵已退出（管道断开），随即退出——孤儿进程自清理。
    每请求 snapshot() 内部新开 sqlite 连接：不持长读事务，WAL checkpoint 不受阻碍。"""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    while True:
        line = sys.stdin.readline()
        if not line:
            return
        try:
            force_sid, routes = _parse_query(line.strip())
            out = json.dumps(snapshot(force_sid, routes))
        except Exception as e:
            out = json.dumps({"error": str(e)[:200]})   # 单次查询失败不杀常驻进程
        sys.stdout.write(out + "\n")
        sys.stdout.flush()


def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    cmd = argv[0] if argv else "now"
    try:
        if cmd == "json":
            force_sid, routes = _parse_query(argv[1] if len(argv) > 1 else "")
            if len(argv) > 2 and not isinstance(routes, list):
                routes = _parse_routes(argv[2])
            print(json.dumps(snapshot(force_sid, routes)))
            return 0
        if cmd == "serve":
            serve()
            return 0
        con = connect()
        if cmd == "now":
            print(render_current(con))
        elif cmd == "today":
            print(render_today(con))
        elif cmd == "days":
            print(render_days(con, int(argv[1]) if len(argv) > 1 else 7))
        elif cmd == "sessions":
            print(render_sessions(con, int(argv[1]) if len(argv) > 1 else 10))
        elif cmd == "models":
            print(render_models(con, int(argv[1]) if len(argv) > 1 else 7))
        elif cmd == "workspace":
            print(render_workspace(con, argv[1] if len(argv) > 1 else ""))
        elif cmd == "session":
            print(render_session_detail(con, argv[1] if len(argv) > 1 else ""))
        elif cmd == "watch":
            sec = int(argv[1]) if len(argv) > 1 else 5
            while True:
                print("\x1b[2J\x1b[H", end="")
                print(render_current(con), flush=True)
                print(L(f"\n(每 {sec}s 刷新, Ctrl+C 退出)", f"(refreshes every {sec}s, Ctrl+C to quit)"), flush=True)
                time.sleep(sec)
        else:
            print(__doc__)
        con.close()
    except sqlite3.OperationalError as e:
        # 列/表变更不在 connect 的表存在性探测内（那会破坏按需裁剪的测试夹具库），
        # 在入口统一转换成可行动提示，替代整段查询栈回溯。
        print(L(f"查询失败：{e}", f"query failed: {e}"))
        print(L("多半是 ZCode 升级改了用量库结构（表/列变更）。请更新本插件后再查询；"
                "已落库的历史数据不受影响。",
                "Most likely ZCode changed the usage DB schema in an update. "
                "Update this plugin before querying; stored history is unaffected."))
        return 1
    return 0


def render_today(con):
    today = range_usage(con, _epoch_ms(_day_start()), _epoch_ms(_day_start() + timedelta(days=1)))
    head = L(f"■ 今日 ({datetime.now():%Y-%m-%d %a})", f"■ Today ({datetime.now():%Y-%m-%d %a})")
    row = L(f"  {today[0]} 次请求  input {fmt(today[1])} (cache read {fmt(today[3])})  "
            f"output {fmt(today[2])}  合计 {fmt(today[4])}",
            f"  {today[0]} requests  input {fmt(today[1])} (cache read {fmt(today[3])})  "
            f"output {fmt(today[2])}  total {fmt(today[4])}")
    return head + "\n" + row


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
