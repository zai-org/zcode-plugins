#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""逐问 token 输出速率：从 ZCode 自身 usage 数据库（model_usage 表）计算真实生成速率。

用法：
  python3 token_rate.py                  最近一次请求 + 会话统计（人类可读）
  python3 token_rate.py --turn           最新一问（本次提问触发的轮次）即时速率
  python3 token_rate.py --turn --current
                                         同上，但本问尚无入库数据时输出为空（--current 守卫，
                                         无身份时仅严格时间过滤，不保证轮次归属）
  python3 token_rate.py --turn --turn-id turn_x --session sess_x
                                         固定宿主轮次身份，不依赖提问时间状态
  python3 token_rate.py --turn --turn-ref msg_x --session sess_subagent_x
                                         按页面轮号固定轮次（子代理窗格统计行）：页面 data-turn-id
                                         即用量行的 parent_user_message_id，只认该会话内对应的那一轮，
                                         且 turn_usage 已有该轮终态行（完成、取消或出错）才输出，否则为空
  python3 token_rate.py --json           JSON 输出
  python3 token_rate.py --session sess_xxx 显式指定会话（优先于下面两个环境变量；钩子下达
                                         的统计指令带此参数，防止模型迟迟才跑该命令时，
                                         并行会话抢先提问把"最近提问会话"状态覆盖掉）
  ZCODE_SESSION_ID=xxx python3 ...       只统计指定会话
  ZCODE_USAGE_DB=/path/db.sqlite         指定数据库路径（最高优先；其次 config.json 的 hosts.zcode.db_path
                                         显式覆盖，与 zusage 同款，issue #314；都未设时默认镜像宿主
                                         agent 会话库解析：ZCODE_SESSION_DB_PATH/config.sessionDbPath
                                         优先，兼容 dataBaseDir 迁移目录并仲裁陈旧候选，回落 ~/.zcode）
  ZUSAGE_RATE_STATE_FILE=/path           指定钩子状态文件（测试接缝）

只读打开 WAL 数据库，不影响运行中的客户端。
速率口径（2026-10-14 据真库 raw_usage_json 与思考段时间分布裁决）：
  分子 = output_tokens（ZCode 的该列已包含思考 token，provider 原生 totalTokens
  = input + output 不另加 reasoning，不能再相加）；
  分母 = 纯生成时长——无思考段 completed_at − first_token_at，含思考段默认
  completed_at − started_at（思考 token 在 first_token_at 之前流出，窗口须前移）；
  「首块即落章」provider 例外（first_token_covers：ttft 不随推理量增长的供应商，
  思考在首字后随输出流出，首字窗口已含思考）改用 completed_at − first_token_at。
  按段累加，段间工具等待不计入。Claude 系列不单独上报思考 token（reasoning_tokens
  恒为 0）也按含思考段计时（2026-10-15 真库裁决，见 hides_reasoning）。
  会话均 = 全会话加权平均（Σ可评分段输出 ÷ Σ生成窗口，aggregate_requests 同款），
  与「近N次均」的算术平均互补：长段权重自然，不被碎片小段拉偏（2026-10-30 增加）。
"""
import json
import math
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

from runtime_lock import bounded_mkstemp, file_lock
from usage_stats import (MIN_GEN_MS, MAX_GEN_MS, hides_reasoning,
                         request_stats, aggregate_requests, round1 as _round1)
try:
    from usage_stats import query_first_token_covers
except ImportError:
    query_first_token_covers = None
try:
    import token_pricing as _pricing   # v376 本轮预估费用；可选，缺失时统计行不带费用段
except ImportError:
    _pricing = None


def _mirror_agent_db_path(value, home):
    """宿主 localUsageEvidence.resolveMirroredSessionDbPath 镜像：~/ 展开与绝对
    路径采纳；相对路径按 agent 工作区 cwd 解析、宿主视为无法镜像，返回 None 逐级回落。"""
    v = str(value or "").strip()
    if not v:
        return None
    if v.startswith("~/"):
        return home / v[2:]
    if re.match(r"^(?:[a-z]:[\\/]|\\\\|/)", v, re.IGNORECASE):
        return Path(v)
    return None


def _db_write_fresh(path):
    """库写入新鲜度：db.sqlite 与 -wal 的最新 mtime；-shm 只读连接也会更新，不入仲裁。"""
    fresh = 0.0
    for suffix in ("", "-wal"):
        try:
            fresh = max(fresh, os.stat(str(path) + suffix).st_mtime)
        except OSError:
            pass
    return fresh


def _adopt_migration_candidate(candidate, home):
    """issue #294 陈旧迁移库仲裁（zusage._adopt_migration_candidate 内联同款，
    改动两处同步）：3.18.0 宿主源码复核写库方（agent 链）恒写 HOME 默认库、
    不消费 dataBaseDir，迁移目录库与 HOME 库并存时可能是历史遗留。两库并存按
    写入新鲜度取舍：候选不落后（>=）才采纳；HOME 库未建仍采纳候选（#279 真迁移）。"""
    home_db = home / ".zcode" / "cli" / "db" / "db.sqlite"
    if not home_db.exists():
        return True
    return _db_write_fresh(candidate) >= _db_write_fresh(home_db)


def _default_db_path(env=None, home=None):
    """未设 ZCODE_USAGE_DB 时的默认库路径：与 zusage.resolve_db_path 同源解析
    （issue #279 及查漏补缺——镜像宿主 agent 会话库 localUsageEvidence 序并兼容
    3.17.x 迁移目录存在性 + issue #294 陈旧候选新鲜度仲裁；本脚本单独部署不
    import zusage，改动两处同步）。"""
    env = os.environ if env is None else env
    home = Path.home() if home is None else Path(home)
    picked = ""
    for key, value in env.items():
        if key in ("ZCODE_SESSION_DB_PATH", "ZCODE_SESSION_DB"):
            picked = value or ""   # 宿主双别名按 env 键序取后（含空值，空即弃用该来源）
    candidate = _mirror_agent_db_path(picked, home)
    if candidate:
        return candidate
    try:
        file = home / ".zcode" / "cli" / "config.json"
        if file.exists():
            raw = json.loads(file.read_text(encoding="utf-8-sig"))
            storage = raw.get("storage") if isinstance(raw, dict) else None
            candidate = _mirror_agent_db_path(
                storage.get("sessionDbPath") if isinstance(storage, dict) else None, home)
            if candidate:
                return candidate
    except Exception:
        pass   # 缺文件/损坏忽略（宿主读不出按默认），不拖垮统计链
    try:
        file = home / ".zcode" / "v2" / "setting.json"
        if file.exists():
            raw = json.loads(file.read_text(encoding="utf-8-sig"))
            base = str((raw.get("dataBaseDir") if isinstance(raw, dict) else "") or "").strip()
        else:
            base = ""
    except Exception:
        base = ""   # 损坏按无迁移处理；env 迁移标记不受其连累（与 Node 侧同构）
    if not base or not re.match(r"^(?:[a-z]:[\\/]|\\\\|/)", base, re.IGNORECASE):
        base = str(env.get("ZCODE_DATA_BASE_DIR") or "").strip()
    if base and re.match(r"^(?:[a-z]:[\\/]|\\\\|/)", base, re.IGNORECASE):
        candidate = Path(base) / ".zcode" / "cli" / "db" / "db.sqlite"
        if candidate.exists() and _adopt_migration_candidate(candidate, home):
            return candidate
    return home / ".zcode" / "cli" / "db" / "db.sqlite"


def _configured_db_path(home=None, script_dir=None):
    """config.json 的 hosts.zcode.db_path 显式覆盖（issue #314，规格 specs/db-path-config-override.md）：
    与 zusage.zcode_db_path 同款——两跳 config（脚本同目录 → ~/.zcode/zcode-token-usage-statusbar/
    config.json，UTF-8），hosts.zcode 对象先到者整段胜出（其 db_path 为空也遮蔽后一跳），非空串
    经 expandvars/expanduser；不检查存在性、不仲裁（显式来源即写库位）。本脚本单独部署不 import
    zusage，改动两处同步。缺失/损坏/无法展开一律返回 None（当未配置）：DB_PATH 在导入期求值，
    抛异常会连带丢掉 hook 的 write_session_state。"""
    home = Path.home() if home is None else Path(home)
    script_dir = Path(__file__).parent if script_dir is None else Path(script_dir)
    for file in (script_dir / "config.json",
                 home / ".zcode" / "zcode-token-usage-statusbar" / "config.json"):
        try:
            data = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        hosts = data.get("hosts") if isinstance(data, dict) else None
        entry = hosts.get("zcode") if isinstance(hosts, dict) else None
        if not isinstance(entry, dict):
            continue
        raw = entry.get("db_path")
        if not (isinstance(raw, str) and raw.strip()):
            return None   # 先到者整段胜出：空值同样遮蔽后一跳（与 zusage 一致）
        try:
            return Path(os.path.expandvars(raw.strip())).expanduser()
        except (RuntimeError, OSError):
            return None   # ~user 无法展开：当未配置，不在导入期抛
    return None


DB_PATH = os.environ.get("ZCODE_USAGE_DB") or str(_configured_db_path() or _default_db_path())
# 钩子状态文件：记录"用户最后所处的会话"与最近提问时刻（--current 守卫依赖 promptTs）
STATE_FILE = os.environ.get("ZUSAGE_RATE_STATE_FILE") or str(
    Path.home() / ".zcode" / "zusage-rate.last-session.json")
STATE_TTL_MS = 7 * 24 * 3600 * 1000  # 过旧的状态文件视为失效
N = 5                 # 上轮行的统计窗口（均/峰）


def valid_state_ts(value, now=None):
    now = time.time() * 1000 if now is None else now
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and 0 <= now - value <= STATE_TTL_MS)


def read_state():
    try:
        st = json.loads(Path(STATE_FILE).read_text(encoding="utf-8"))
    except Exception:
        return None
    return st if isinstance(st, dict) and valid_state_ts(st.get("ts")) else None


def _replace_state_file(tmp, path):
    """os.replace 短暂重试：Windows 上目标被任何句柄打开时（读者、杀软，也包括主进程自己的 fs 句柄，实测不论共享模式）
    替换会被拒绝，静默放弃会丢掉提问时刻、让 --current 守卫整轮失效；读者都是微秒级
    短开，重试窗口远大于它。POSIX 的 rename 不受并发读者影响，重试零成本。"""
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.01)


def write_session_state(session_id, source):
    """持久文件锁内合并每会话提问时刻，再原子替换；会话启动不伪造提问。"""
    path = Path(STATE_FILE)
    tmp = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with file_lock(str(path) + ".lock"):
            now = int(time.time() * 1000)
            try:
                prev = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                prev = None
            prompts = prev.get("prompts") if isinstance(prev, dict) else None
            # 迁移仅含全局字段的旧状态，且不把 SessionStart 的 ts 当提问。
            if not isinstance(prompts, dict):
                prompts = {}
                if isinstance(prev, dict) and prev.get("sessionId") \
                        and valid_state_ts(prev.get("promptTs"), now):
                    prompts[prev["sessionId"]] = prev["promptTs"]
            prompts = {k: v for k, v in prompts.items() if valid_state_ts(v, now)}
            if source == "prompt-submit":
                prompts[session_id] = max(prompts.get(session_id, 0), now)
            data = {"sessionId": session_id, "ts": now, "source": source, "prompts": prompts}
            if session_id in prompts:
                data["promptTs"] = prompts[session_id]
            fd, tmp = bounded_mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(data, stream)
            _replace_state_file(tmp, path)
    except Exception:
        pass
    finally:
        if tmp is not None:
            try:
                os.unlink(tmp)
            except OSError:
                pass


def open_db():
    """只读连接；库不存在/损坏返回 None（连接 ro URI 失败不会新建空库）。"""
    try:
        con = sqlite3.connect(f"file:{Path(DB_PATH).as_posix()}?mode=ro", uri=True, timeout=3)
        con.row_factory = sqlite3.Row
        return con
    except sqlite3.OperationalError:
        return None


def fallback_session_id(db):
    """未显式指定会话时：状态文件里"用户最后所处的会话"（切会话即跟随）→ 全局最近完成的会话。"""
    st = read_state()
    if st and st.get("sessionId"):
        return st["sessionId"]
    if db is None:
        return None
    row = db.execute(
        "select session_id from model_usage where status='completed'"
        " order by completed_at desc limit 1").fetchone()
    return row[0] if row else None


def _has_col(db, name):
    """旧库/测试桩可能缺列（见 _provider_fallback 的同款降级）：缺列时不把该列选进
    scope，消费端按缺省容错，别让整条查询崩掉。"""
    if db is None:
        return False
    try:
        return any(r[1] == name for r in db.execute("pragma table_info(model_usage)"))
    except sqlite3.OperationalError:
        return False


def _has_provider_col(db):
    return _has_col(db, "provider_id")


def scope_for(db, sid):
    """有 main_turn 数据时只统计 main_turn，否则回退为该会话全部请求。"""
    cols = ("model_id, output_tokens, reasoning_tokens, input_tokens,"
            " cache_read_input_tokens, started_at, first_token_at, completed_at,"
            " time_to_first_token_ms, status")
    if _has_provider_col(db):
        cols += ", provider_id"
    base = f"select {cols} from model_usage where status='completed' and query_source='main_turn'"
    tail = " and session_id = ?" if sid else ""
    args = [sid] if sid else []
    if db is not None:
        try:
            has_main = db.execute(base + tail + " limit 1", args).fetchone()
        except sqlite3.OperationalError:
            has_main = None
        if not has_main:
            base = base.replace(" and query_source='main_turn'", "")
    return base + tail, args


def first_token_covers(db):
    """「首块即落章」provider 集合（委派 usage_stats.query_first_token_covers，与
    zusage._provider_first_token_covers 同源；若运行目录 usage_stats.py 因热修保留为
    旧版则回退为空集合，绝不因 ImportError 中断逐问速率）。"""
    if query_first_token_covers is None:
        return frozenset()
    return query_first_token_covers(db)


def to_item(r, covers=frozenset()):
    item = request_stats(r, covers)
    item.update(inputTokens=r["input_tokens"] or 0,
                cacheRead=r["cache_read_input_tokens"] or 0)
    return item


def session_aggregate(db, scope_sql, args, rated, covers=frozenset()):
    """会话累计用独立 SUM（不受窗口限制）；均/峰由已评分窗口计算。
    sessionAvg = 全会话加权平均：把 scope 内全部行过一遍 request_stats 后交给
    aggregate_requests（Σ可评分输出 ÷ Σ生成窗口），长段权重自然；「近N次均」是
    算术平均，两者互补。全会话行数即会话请求量（几百行毫秒级），一次性进程可接受。"""
    if db is None:
        return None
    row = db.execute(
        f"select count(*), coalesce(sum(output_tokens),0), coalesce(sum(reasoning_tokens),0),"
        f" coalesce(sum(input_tokens),0), coalesce(sum(cache_read_input_tokens),0)"
        f" from ({scope_sql})", args).fetchone()
    whole = aggregate_requests(to_item(r, covers) for r in db.execute(scope_sql, args))
    return {
        "samples": len(rated),
        "requests": row[0],
        "avg": _round1(sum(i["tokPerSec"] for i in rated) / len(rated)) if rated else None,
        "max": max(i["tokPerSec"] for i in rated) if rated else None,
        "min": min(i["tokPerSec"] for i in rated) if rated else None,
        "sessionAvg": whole["tokPerSec"],
        "totalOutput": row[1],
        "totalReasoning": row[2],
        "totalInput": row[3],
        "totalCacheRead": row[4],
    }


def query_latest(session_id=None):
    """最近一次完成请求 + 会话统计（prompt-submit 注入的「上轮」行用）。"""
    db = open_db()
    try:
        sid = session_id or fallback_session_id(db)
        scope_sql, args = scope_for(db, sid)
        if db is None:
            items, rated, session = [], [], None
        else:
            covers = first_token_covers(db)
            rows = db.execute(scope_sql + " order by completed_at desc limit ?", args + [N]).fetchall()
            items = [to_item(r, covers) for r in rows]
            rated = [i for i in items if i["tokPerSec"] is not None]
            session = session_aggregate(db, scope_sql, args, rated, covers)
        latest = items[0] if items else None
        return {"sessionId": sid, "latest": latest, "session": session, "history": items[::-1]}
    finally:
        if db is not None:
            db.close()


# 一次用户消息的各段共享 turn_id。按整轮最早 started_at 排序，不能用完成时间：
# 上轮迟到的完成/工具后续段可能比本轮更晚，但轮次身份仍属上轮。
def latest_turn_id(db, sid, prompt_ts=None, allow_fallback=True):
    if db is None:
        return None
    sql = ("select turn_id from model_usage where session_id=? and query_source='main_turn'"
           " and turn_id is not null and turn_id != '' group by turn_id")
    args = [sid]
    # v458：无 main_turn 的会话（子代理窗格 sess_subagent_*）在不带提问时刻（非 --current 路径）
    # 时回退该会话除压缩请求外的全部行——方向同 scope_for 的全量回退，但压缩请求不参与选轮
    # （宿主给压缩行的 turn_id 独立时会被当成最新一轮；query_source 为空的行照常参与）。
    # --current 路径（prompt_ts 非空）的选轮与探测失败时都保持 main_turn 过滤：与改动前一致，
    # 宁可查不到也不放宽（fail-closed）。query_turn 里 --current 空结果的原因分类不带提问时刻，
    # 由调用方显式关掉回退（allow_fallback=False），同样与改动前一致。
    # 用不上回退的查询（带提问时刻，或调用方关掉了回退）不做这次探测，查询次数与改动前一致；
    # 探测与主查询同连接、同表同列，真实连接上探测会抛的异常主查询也会抛，跳过探测不改变异常面
    has_main = True
    if prompt_ts is None and allow_fallback:
        try:
            has_main = db.execute(
                "select 1 from model_usage where session_id=? and query_source='main_turn' limit 1",
                args).fetchone()
        except sqlite3.OperationalError:
            has_main = True
    if not has_main:
        sql = sql.replace(" and query_source='main_turn'",
                          " and (query_source is null or query_source!='compact')")
    if prompt_ts is not None:
        # 时间仅是旧宿主的有限兼容过滤，不证明身份；不允许向前借用旧轮。
        sql += " having min(started_at) >= ?"
        args.append(prompt_ts)
    try:
        row = db.execute(sql + " order by min(started_at) desc, turn_id desc limit 1", args).fetchone()
    except sqlite3.OperationalError:
        return None
    return row[0] if row else None


# 页面轮号：首字符不许 -（防止轮号被命令行解析当成开关，例如 --json 会同时被当成输出开关），
# 只许字母 / 数字 / 下划线 / 连字符，至多 80 字符。真库轮号恒为 msg_ 开头、49 字符。
# 用 fullmatch：re 的 $ 会放过结尾换行，JS 侧的正则不会，两端要一致。
TURN_REF_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_-]{0,79}")


def turn_id_for_ref(db, sid, ref):
    """v458 子代理窗格统计行：页面轮号 -> 库内 turn_id。

    页面 data-turn-id 就是宿主写在每条用量行上的 parent_user_message_id，与
    model_usage.turn_id 不是同一套 id（真库实测：主会话页面轮号命中 parent_user_message_id，
    与 turn_id 零命中）。同一会话内一个页面轮号只对应一个 turn_id（真库子代理会话
    39360 行实测无一对多）。对应不上、对应多个或库缺这一列都返回 None：不猜。"""
    try:
        rows = db.execute(
            "select distinct turn_id from model_usage where session_id=? and parent_user_message_id=?"
            " and turn_id is not null and turn_id != ''", [sid, ref]).fetchall()
    except sqlite3.OperationalError:
        return None
    return rows[0][0] if len(rows) == 1 else None


def turn_ended(db, sid, turn_id):
    """turn_usage 的行在轮结束时才写：进行中的轮没有行，已结束的轮有行且 status 只有
    completed / cancelled / error（真库实测：正在跑的轮无行，子代理会话 1493 轮里 1492 轮有行）。
    状态也一并核对：宿主若改成轮开始就写行（status 为进行中一类），这里同样判「未结束」。
    查不到行、状态不在终态集合里或表缺席都按「未结束」处理——调用方不出数，不把进行中的
    半截统计当成结果。"""
    try:
        return db.execute("select 1 from turn_usage where session_id=? and turn_id=?"
                          " and status in ('completed','cancelled','error') limit 1",
                          [sid, turn_id]).fetchone() is not None
    except sqlite3.OperationalError:
        return False


def last_prompt_ts(session_id=None, state=None):
    """仅接受本会话的有效提问时刻；映射缺项不借别的会话/SessionStart 的时刻。"""
    st = read_state() if state is None else state
    if not st:
        return None
    sid = session_id or st.get("sessionId")
    prompts = st.get("prompts")
    if isinstance(prompts, dict):
        ts = prompts.get(sid)
    elif st.get("sessionId") == sid:
        ts = st.get("promptTs")
    else:
        ts = None
    return ts if valid_state_ts(ts) else None


def query_turn(session_id=None, current=False, turn_id=None, turn_ref=None):
    db = open_db()
    try:
        sid = session_id or fallback_session_id(db)
        if not sid:
            return {"sessionId": None, "turnId": None, "turn": None, "session": None}
        scope_sql, args = scope_for(db, sid)
        session = None
        if db is not None:
            covers = first_token_covers(db)
            win = db.execute(scope_sql + " order by completed_at desc limit ?", args + [N]).fetchall()
            rated = [i for i in (to_item(r, covers) for r in win) if i["tokPerSec"] is not None]
            session = session_aggregate(db, scope_sql, args, rated, covers)
        prompt_ts = last_prompt_ts(sid) if current else None
        if current and turn_id is None and prompt_ts is None:
            return {"sessionId": sid, "turnId": None, "turn": None,
                    "noCurrentTurnData": True, "currentTurnUnavailableReason": "missingPromptState", "session": session}
        turn_pending = False
        if turn_ref is not None:
            # v458 子代理窗格统计行：按页面轮号精确定位这一轮。按会话取「最新一轮」分不清窗格里
            # 这一行属于哪一轮：该轮还在进行或库还没追上时「最新一轮」是上一轮，上一轮的富文本会
            # 被挂到这一轮下面；进行中的轮还会取出半截统计。只认该会话内该轮号对应的唯一一轮，且轮
            # 已结束才出数（turn_ended：完成、取消或出错都算结束）；与 --current / --turn-id 同给时
            # 按 fail-closed 处理（不替调用方决定按哪个身份）。
            if current or turn_id or db is None or not TURN_REF_RE.fullmatch(turn_ref):
                return {"sessionId": sid, "turnId": None, "turn": None, "session": session}
            identity_source = "parentTurnRef"
            turn_id = turn_id_for_ref(db, sid, turn_ref)
            if turn_id and not turn_ended(db, sid, turn_id):
                turn_id, turn_pending = None, True   # 轮还没结束：不出数，调用方稍后再问
        else:
            identity_source = "explicitTurnId" if turn_id else ("promptTimeCompatibility" if current else "latestTurn")
            turn_id = turn_id or latest_turn_id(db, sid, prompt_ts)
        if not turn_id or db is None:
            result = {"sessionId": sid, "turnId": turn_id, "turn": None, "session": session}
            if turn_pending:
                result["turnPending"] = True
            if current:
                # 「该会话有没有轮身份」：--current 路径只认 main_turn（关掉回退），与改动前一致
                has_identity = db is not None and latest_turn_id(db, sid, allow_fallback=False) is not None
                result.update(noCurrentTurnData=True,
                              currentTurnUnavailableReason="noMatchingTurn" if has_identity else "missingTurnIdentity")
            return result
        try:
            rows = db.execute(scope_sql + " and turn_id = ? order by started_at asc, completed_at asc",
                              args + [turn_id]).fetchall()
        except sqlite3.OperationalError:
            rows = []
        if not rows:
            result = {"sessionId": sid, "turnId": turn_id, "turn": None, "session": session,
                      "turnIdentitySource": identity_source, "currentTurnIdentityVerified": False}
            if current:
                result.update(noCurrentTurnData=True, currentTurnUnavailableReason="noMatchingTurn")
            return result
        items = [to_item(r, covers) for r in rows]
        turn = aggregate_requests(items)
        turn.update(ttftMs=items[0]["ttftMs"], firstAt=items[0]["completedAt"],
                    lastAt=max(i["completedAt"] for i in items))
        # v376 本轮模型 id（首次出现顺序去重，供统计行前置）与本轮预估费用 USD
        seen_models = []
        for it in items:
            mid = it.get("model")
            if mid and mid not in seen_models:
                seen_models.append(mid)
        turn["models"] = seen_models
        _pricing_configure_for_cost()
        turn["cost_usd"] = _turn_cost(db, sid, turn_id)
        return {"sessionId": sid, "turnId": turn_id, "turn": turn, "session": session,
                "turnIdentitySource": identity_source,
                "currentTurnIdentityVerified": identity_source in ("explicitTurnId", "parentTurnRef")}
    finally:
        if db is not None:
            db.close()


# 紧凑单位（注入行等需一眼扫读处）：千以下原始、千~万一位小数 k、万~百万取整 k、百万以上一位小数 M
def fmt_compact(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 10_000:
        return f"{round(n / 1000)}k"
    if n >= 1000:
        return f"{n / 1000:.1f}k"
    return str(n)


def fmt_num(n):
    return f"{n:,}"


def fmt_kmb(n):
    # 在原始 token 数上做半数进位，避免浮点缩放及 Python 偶数舍入差异。
    if n >= 1_000_000_000:
        return f"{(n + 5_000_000) // 10_000_000 / 100:.2f}B"
    if n >= 1_000_000:
        return f"{(n + 5_000) // 10_000 / 100:.2f}M"
    if n >= 1000:
        return f"{(n + 50) // 100 / 10:.1f}K"
    return str(n)


# 万/亿单位（本问统计行缺省；渲染端「中文单位」开关关闭时经 --no-cn-units 退回千分位/k）：≥1 亿用亿、
# ≥1 万用万，至多两位小数去尾零、数字与单位不留空格（58.25万 / 142万 / 1亿），不足 1 万沿用千分位。与 overlay.js fmt() 同规则。
def fmt_cn(n):
    if n >= 100_000_000:
        return _cn_unit(n / 100_000_000) + "亿"
    if n >= 10_000:
        return _cn_unit(n / 10_000) + "万"
    return fmt_num(n)


def _cn_unit(x):
    return f"{x:.2f}".rstrip("0").rstrip(".")


def _hhmmss(ms):
    return time.strftime("%H:%M:%S", time.localtime(ms / 1000))


def _cn_fulltime(ms):
    """本问统计行的采样时刻：完整中文日期时间（2026 年 10 月 23 日 11 点 20 分 28 秒），数字不补零。"""
    t = time.localtime(ms / 1000)
    return (f"{t.tm_year} 年 {t.tm_mon} 月 {t.tm_mday} 日 "
            f"{t.tm_hour} 点 {t.tm_min} 分 {t.tm_sec} 秒")


def _sec(ms):
    return f"{ms / 1000:.1f}" if isinstance(ms, (int, float)) else "-"


def _gen_duration(ms):
    """本轮行「生成 <耗时>」：分级中文单位（overlay-ui.md 时间文案规范）。
    <60s 沿用 _sec 一位小数 `3.2s`；≥60s `7分44.8秒`；≥1h `1时2分4.8秒`。
    秒保留一位小数、分/时取整不补零，数字与单位紧邻。非数值/≤0 返回 `-`/`0.0s`。"""
    if not isinstance(ms, (int, float)):
        return "-"
    if ms <= 0:
        return "0.0s"
    secs = ms / 1000
    # 先四舍五入到 0.1s 再分档：59.95s 起按 60.0s 走分档（输出 `1分0.0秒`），
    # 避免秒档冒出 `60.0s` 或分档冒出 `59分60.0秒`，与「≥60s 用分秒」规范一致。
    total_tenths = int(round(secs * 10))
    if total_tenths < 600:
        return f"{total_tenths / 10:.1f}s"
    minutes, sec10 = divmod(total_tenths, 600)   # 600 个 0.1s = 1 分；商=分钟、余=0.1s
    hours, minutes = divmod(minutes, 60)          # 60 分钟 = 1 时
    sec_txt = f"{sec10 / 10:.1f}秒"
    if hours:
        return f"{hours}时{minutes}分{sec_txt}"
    return f"{minutes}分{sec_txt}"


def _money(usd):
    """USD → 显示串（与 zusage._wb_money / overlay.fmtMoney 同口径）：有汇率走 ¥，否则 $；
    非有限/缺失返回 None（调用方整段省略，不显假 0）。价表模块缺失/汇率读失败按无汇率降 $。"""
    if not isinstance(usd, (int, float)) or isinstance(usd, bool) or not math.isfinite(usd):
        return None
    rate = 0
    if _pricing is not None:
        try:
            rate = float((_pricing.fx_view() or {}).get("rate") or 0)
        except Exception:
            rate = 0
    if rate > 0:
        v = usd * rate
        return "<¥0.01" if 0 < v < 0.01 else f"¥{v:.2f}"
    return "<$0.01" if 0 < usd < 0.01 else f"${usd:.2f}"


def _pricing_configure_for_cost():
    """让 token_pricing 定位 pricing-cache.json（汇率/运行时牌价）：config.json
    两跳与 _configured_db_path 同路径。任何失败静默，费用段按无汇率/内置价表降级。"""
    if _pricing is None:
        return
    try:
        home = Path.home()
        script_dir = Path(__file__).parent
        cfg = None
        for file in (script_dir / "config.json",
                     home / ".zcode" / "zcode-token-usage-statusbar" / "config.json"):
            try:
                cfg = json.loads(file.read_text(encoding="utf-8"))
                break
            except (OSError, ValueError):
                continue
        # config_dir=None：让 token_pricing 自己走「脚本目录 → ~/.zcode/zcode-token-usage-statusbar
        # 」双基地探测（与 zusage 一致）。不硬传 script_dir——否则源码 clone/混装时 config.json
        # 在 HOME 运行目录、pricing-cache.json 却定位到 clone，汇率不可得误显 $。
        _pricing.configure(cfg, None)
    except Exception:
        pass


def _turn_cost(db, sid, turn_id):
    """本轮预估费用（USD）：本轮已完成行按 (model_id, provider_id) 计价求和。
    直接查 model_usage（不经 scope_for——它的 SELECT 未含 turn_id/缓存写列，套子查询会
    缺列），turn_id 即本轮身份，已完成行即可；价表缺失/查询失败/无有效分组返回 None
    （消费端整段省略，不显假 0）。"""
    if _pricing is None or db is None:
        return None
    try:
        has_provider = _has_provider_col(db)
        has_creation = _has_col(db, "cache_creation_input_tokens")
        creation = "cache_creation_input_tokens" if has_creation else "0"
        cols = (f"input_tokens, output_tokens, cache_read_input_tokens, {creation} as cw, model_id"
                + (", provider_id" if has_provider else ""))
        rows = db.execute(
            f"select {cols} from model_usage where status='completed' and turn_id = ?"
            + (" and session_id = ?" if sid else ""),
            (turn_id, sid) if sid else (turn_id,),
        ).fetchall()
        groups = []
        for r in rows:
            groups.append((r["model_id"] or "", (r["provider_id"] or "") if has_provider else "",
                           r["input_tokens"] or 0, r["output_tokens"] or 0,
                           r["cache_read_input_tokens"] or 0, r["cw"] or 0))
        if not groups:
            return None
        return _pricing.merge_model_costs(groups)[0]
    except Exception:
        return None


# _round1 已由 usage_stats.round1 导入


# 本问统计行（回复收尾自测用）。调用方判定 turn 为空时（含 --current 守卫）不显示任何行。
# cn 缺省 True 与渲染端「中文单位」开关默认开启一致；只有开关关闭时 inject-main 才传 --no-cn-units。
def format_turn_line(r, cn=True, force_kmb=False, cost=True):
    t = r.get("turn")
    if not t:
        return "暂无本轮请求记录"
    num = fmt_kmb if force_kmb else (fmt_cn if cn else fmt_num)
    big = fmt_kmb if force_kmb else (fmt_cn if cn else fmt_compact)
    # v376 本轮模型 id 去重前置（首次出现顺序，空 id 跳过；旧快照/无模型时不拼）
    seen = []
    for m in (t.get("models") or []):
        if m and m not in seen:
            seen.append(str(m))
    model_prefix = "/".join(seen) + " " if seen else ""
    gen = _gen_duration(t['genMs']) if t.get('genMs') > 0 else '-'
    parts = [
        f"⚡ {model_prefix}{t['tokPerSec'] if t['tokPerSec'] is not None else '-'} token/s(本轮)",
        f"首字 {_sec(t['ttftMs'])}s",
        f"输出 {num(t['totalOutput'])}"
        f"{'(含 ' + num(t['totalReasoning']) + ' 思考)' if t['totalReasoning'] else ''}"
        f" token / 生成 {gen}",
    ]
    if t["requests"] > 1:
        parts.append(f"{t['requests']} 段 / 峰 {t['peak']} token/s" if t["peak"] is not None else f"{t['requests']} 段 / 峰 -")
    if r.get("session"):
        s = r["session"]
        if s.get("sessionAvg") is not None:
            parts.append(f"会话均 {s['sessionAvg']} token/s")
        parts.append(f"累计 {big(s['totalOutput'])} token")
    # v376 本轮预估费用（受 --no-cost 门控）：价表/费用不可得整段省略，不显假 0
    if cost:
        money = _money(t.get("cost_usd"))
        if money is not None:
            parts.append(f"预估费用 {money}")
    parts.append(f"⏱ {_cn_fulltime(t['lastAt'])}")
    return " · ".join(parts)


# 上轮行（prompt-submit 注入、CLI 默认输出用）
def format_line(r):
    l = r.get("latest")
    if not l:
        return "暂无已完成的模型请求"
    parts = [
        f"⚡ {l['tokPerSec'] if l['tokPerSec'] is not None else '-'} token/s(上轮)",
        f"首字 {_sec(l['ttftMs'])}s",
        f"输出 {fmt_num(l['outputTokens'])}"
        f"{'(含 ' + fmt_num(l['reasoningTokens']) + ' 思考)' if l['reasoningTokens'] else ''}"
        f" token / 生成 {_sec(l['genMs'])}s",
    ]
    s = r.get("session")
    if s:
        if s["samples"]:
            parts.append(f"近{s['samples']}次均 {s['avg']} / 峰 {s['max']} token/s")
        if s.get("sessionAvg") is not None:
            parts.append(f"会话均 {s['sessionAvg']} token/s")
        parts.append(f"累计 {fmt_compact(s['totalOutput'])} token")
    parts.append(f"⏱ {_hhmmss(l['completedAt'])}")
    return " · ".join(parts)


def _value_arg(argv, name):
    """解析 --session <id> / --session=<id>；返回 None 表示命令行未显式指定。"""
    for i, a in enumerate(argv):
        if a == name:
            return argv[i + 1] if i + 1 < len(argv) else None
        if a.startswith(name + "="):
            return a[len(name) + 1:]
    return None


def main(argv):
    json_out = "--json" in argv
    # 显式 --session 优先级最高：钩子下达统计指令时会带上本会话 id（见 prompt-submit.py），
    # 模型执行该命令的时刻可能远晚于钩子触发，其间若有并行会话提问，会改写状态文件里
    # "用户最后所处的会话"（fallback_session_id 的依据），env 变量在 Bash 工具里也不存在，
    # 没有 --session 时会错把别的会话的数据当成本问结果（2026-10-15 真机事故）。
    sid = (_value_arg(argv, "--session") or os.environ.get("ZCODE_SESSION_ID")
           or os.environ.get("CLAUDE_SESSION_ID") or None)
    if "--turn" in argv:
        turn_ref = _value_arg(argv, "--turn-ref")
        if "--turn-ref" in argv and turn_ref is None:
            turn_ref = ""   # --turn-ref 后面没有值：按非法轮号处理（fail-closed），不落到「最新一轮」
        r = query_turn(sid, current="--current" in argv, turn_id=_value_arg(argv, "--turn-id"),
                       turn_ref=turn_ref)
        if json_out:
            print(json.dumps(r, ensure_ascii=False))
        elif r.get("turn"):
            print(format_turn_line(r, cn="--no-cn-units" not in argv,
                                   force_kmb="--force-kmb" in argv,
                                   cost="--no-cost" not in argv))
        # --current 且本问尚无数据：不输出任何行，调用方据此不显示统计（绝不回退到上一轮）
    else:
        r = query_latest(sid)
        if json_out:
            print(json.dumps(r, ensure_ascii=False))
        else:
            print(format_line(r))
            s = r.get("session")
            if s:
                print(f"会话累计:输出 {fmt_num(s['totalOutput'])}"
                      f"{'(含 ' + fmt_num(s['totalReasoning']) + ' 思考)' if s['totalReasoning'] else ''}"
                      f" token · 输入 {fmt_num(s['totalInput'])} token(其中缓存读 {fmt_num(s['totalCacheRead'])})"
                      f" · 请求 {s['requests']} 次"
                      f"{' · 平均 ' + str(s['sessionAvg']) + ' token/s' if s.get('sessionAvg') is not None else ''}")
    return 0


if __name__ == "__main__":
    # Windows 默认（无全局 PYTHONUTF8）下中文输出会按区域编码（GBK 等）写管道，
    # 逐问速率行经代理终端/对话流展示前按 UTF-8 解码——与 usage_mcp.py 同款防护。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    sys.exit(main(sys.argv[1:]))
