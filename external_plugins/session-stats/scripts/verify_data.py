"""数据验证 spike：核实 db.sqlite 的字段、单位、session 映射与缓存口径。

只读打开（file:...?mode=ro），WAL 并发安全。输出一份实测样例供实施对账。
用法：python verify_data.py [session_id]
"""
import json
import sqlite3
import sys
from pathlib import Path

DB = Path.home() / ".zcode" / "cli" / "db" / "db.sqlite"


def main() -> None:
    con = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True, timeout=5)
    con.execute("PRAGMA busy_timeout=5000")
    cur = con.cursor()

    print("== 1. 表结构核实 ==")
    for table in ("model_usage", "turn_usage", "tool_usage", "session"):
        cols = [r[1] for r in cur.execute(f"PRAGMA table_info({table})")]
        print(f"[{table}] {len(cols)} 列: {', '.join(cols)}")

    print("\n== 2. 时间戳类型与单位 ==")
    row = cur.execute(
        "SELECT typeof(started_at), typeof(completed_at), started_at, completed_at,"
        " time_to_first_token_ms, duration_ms FROM model_usage"
        " WHERE started_at IS NOT NULL ORDER BY id DESC LIMIT 1"
    ).fetchone()
    print(f"typeof(started_at)={row[0]} typeof(completed_at)={row[1]}")
    print(f"样例 started_at={row[2]!r} completed_at={row[3]!r} ttft_ms={row[4]} dur_ms={row[5]}")

    print("\n== 3. 索引核实（查询性能）==")
    for table in ("model_usage", "tool_usage", "turn_usage"):
        idx = cur.execute(f"PRAGMA index_list({table})").fetchall()
        names = []
        for i in idx:
            cols = [r[2] for r in cur.execute(f"PRAGMA index_info('{i[1]}')")]
            names.append(f"{i[1]}({','.join(cols)})")
        print(f"[{table}] {names or '无索引'}")

    print("\n== 4. 最近会话定位 ==")
    sess_cols = [r[1] for r in cur.execute("PRAGMA table_info(session)")]
    order_col = None
    for cand in ("updated_at", "last_activity_at", "created_at"):
        if cand in sess_cols:
            order_col = cand
            break
    if order_col is None:
        print(f"session 表无时间列，列清单: {sess_cols}")
        sessions = cur.execute("SELECT id FROM session ORDER BY rowid DESC LIMIT 5").fetchall()
    else:
        sessions = cur.execute(
            f"SELECT id, {order_col} FROM session ORDER BY {order_col} DESC LIMIT 5"
        ).fetchall()
    print(f"排序键: {order_col}，最近 5 个 session:")
    for s in sessions:
        n = cur.execute(
            "SELECT COUNT(*), COUNT(DISTINCT turn_id), COUNT(DISTINCT logical_request_id)"
            " FROM model_usage WHERE session_id=?", (s[0],)
        ).fetchone()
        print(f"  {s}  model_usage行数={n[0]} turns={n[1]} logical_requests={n[2]}")

    target = None
    if len(sys.argv) > 1:
        target = sys.argv[1]
    else:
        for s in sessions:
            if s[-1] and s[-1] > 0 if order_col else True:
                target = s[0]
                break
    if target is None:
        print("找不到有 model_usage 数据的会话，退出")
        return

    print(f"\n== 5. 目标会话 {target} 的统计实测 ==")
    base = "FROM model_usage WHERE session_id=? AND status IS NOT NULL"
    n = cur.execute(
        f"SELECT COUNT(*), COUNT(DISTINCT turn_id), COUNT(DISTINCT logical_request_id) {base}",
        (target,),
    ).fetchone()
    print(f"行数={n[0]} 轮次={n[1]} 步数(logical)={n[2]}")

    status = cur.execute(
        f"SELECT status, COUNT(*) FROM model_usage WHERE session_id=? GROUP BY status", (target,)
    ).fetchall()
    print(f"status 分布: {status}")

    attempt = cur.execute(
        "SELECT attempt_index, COUNT(*) FROM model_usage WHERE session_id=?"
        " GROUP BY attempt_index", (target,)
    ).fetchall()
    print(f"attempt_index 分布: {attempt}")

    agg = cur.execute(
        "SELECT SUM(duration_ms), AVG(time_to_first_token_ms), SUM(input_tokens),"
        " SUM(output_tokens), SUM(reasoning_tokens), SUM(cache_read_input_tokens),"
        " SUM(cache_creation_input_tokens)"
        " FROM model_usage WHERE session_id=?", (target,)
    ).fetchone()
    print(f"Σduration_ms={agg[0]} avg_ttft_ms={agg[1]}")
    print(
        f"Σinput={agg[2]} Σoutput={agg[3]} Σreasoning={agg[4]} "
        f"Σcache_read={agg[5]} Σcache_write={agg[6]}"
    )

    print("\n== 6. TPS 分母实测（completed_at - first_token_at）==")
    unit = "ms" if row[0] == "integer" and row[2] > 10**12 else "s?"
    print(f"假设时间单位: {unit}")
    tps_rows = cur.execute(
        "SELECT output_tokens, time_to_first_token_ms, duration_ms,"
        " started_at, completed_at, first_token_at"
        " FROM model_usage WHERE session_id=? AND output_tokens > 0"
        " AND completed_at IS NOT NULL AND first_token_at IS NOT NULL"
        " ORDER BY id DESC LIMIT 5",
        (target,),
    ).fetchone() if True else None
    if tps_rows:
        o, t, d, st, c, f = tps_rows
        print(f"样例行: output={o} ttft={t} dur={d}")
        print(f"  started={st} first_token={f} completed={c}")
        if st and f and c:
            span1 = (c - f) * (1 if unit == "ms" else 1000)
            print(f"  completed-first_token={c - f} (原始单位)")
            print(f"  若按该单位算 TPS = {o / (span1 / 1000):.1f} tok/s")
    else:
        print("无可用 TPS 样例行（first_token_at 为空？）")

    print("\n== 7. 缓存口径交叉验证（raw_usage_json）==")
    raw = cur.execute(
        "SELECT raw_usage_json, input_tokens, cache_read_input_tokens,"
        " cache_creation_input_tokens, output_tokens, reasoning_tokens, provider_id, model_id"
        " FROM model_usage WHERE session_id=? AND raw_usage_json IS NOT NULL"
        " AND (cache_read_input_tokens > 0 OR cache_creation_input_tokens > 0)"
        " ORDER BY id DESC LIMIT 1",
        (target,),
    ).fetchone()
    if raw:
        print(f"provider={raw[6]} model={raw[7]}")
        print(f"归一化: input={raw[1]} cache_read={raw[2]} cache_write={raw[3]} output={raw[4]} reasoning={raw[5]}")
        try:
            print(f"raw_usage_json: {json.dumps(json.loads(raw[0]), ensure_ascii=False)}")
        except Exception as e:  # noqa: BLE001
            print(f"raw 解析失败: {e}; 原文: {raw[0][:500]}")
    else:
        print("该会话无 cache 行；放宽到全局最近一条：")
        raw = cur.execute(
            "SELECT raw_usage_json, input_tokens, cache_read_input_tokens,"
            " cache_creation_input_tokens, output_tokens, reasoning_tokens, provider_id, model_id"
            " FROM model_usage WHERE raw_usage_json IS NOT NULL"
            " AND cache_read_input_tokens > 0 ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if raw:
            print(f"provider={raw[6]} model={raw[7]} input={raw[1]} cache_read={raw[2]} "
                  f"cache_write={raw[3]} output={raw[4]} reasoning={raw[5]}")
            try:
                print(f"raw_usage_json: {json.dumps(json.loads(raw[0]), ensure_ascii=False)}")
            except Exception as e:  # noqa: BLE001
                print(f"raw 解析失败: {e}")

    print("\n== 8. tool_usage 实测 ==")
    tool_cols = [r[1] for r in cur.execute("PRAGMA table_info(tool_usage)")]
    tool_agg = cur.execute(
        "SELECT COUNT(*), SUM(duration_ms) FROM tool_usage WHERE session_id=?",
        (target,),
    ).fetchone()
    print(f"tool_usage 行数={tool_agg[0]} Σduration_ms={tool_agg[1]}")

    con.close()
    print("\nspike 完成")


if __name__ == "__main__":
    main()
