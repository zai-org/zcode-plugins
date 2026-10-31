"""ZCode session-stats MCP 服务器（stdio，Python 标准库，零第三方依赖）。

协议：JSON-RPC 2.0 按行读写（MCP stdio 传输），日志走 stderr。
数据源：~/.zcode/cli/db/db.sqlite（只读 URI 打开，WAL 下并发安全）。

指标口径（2026-10-31 对本机 db 实测定案）：
- 时间戳为 epoch 毫秒；TPS = Σoutput / Σ((completed_at - first_token_at)/1000)
- input_tokens 已包含 cache_read_input_tokens（GLM 供应商实测），
  缓存命中 = cache_read / input；total = input + output
- 子代理会话通过 session.parent_id 挂在主会话下，current 口径聚合主+子
- 错误/取消的请求行同样计步计耗时（与 DeepSeek harness 口径一致）
"""

import json
import os
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SERVER_NAME = "session-stats"
SERVER_VERSION = "0.2.0"
UI_URI = "ui://session-stats/panel.html"
PLUGIN_ROOT = Path(__file__).resolve().parent.parent
PANEL_FILE = PLUGIN_ROOT / "ui" / "panel.html"

TOOLS = [
    {
        "name": "get_stats",
        "description": (
            "获取 ZCode 会话统计（轮次/步数、模型用时、工具用时、TTFT 均值、"
            "TPS、token 用量、缓存命中率）。scope=current 返回当前会话（含子代理），"
            "scope=today 返回今日全部会话汇总。"
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "session_id": {
                    "type": "string",
                    "description": "可选。指定主会话 id（sess_ 开头）；缺省自动解析当前会话。",
                },
                "scope": {
                    "type": "string",
                    "enum": ["current", "today"],
                    "description": "统计口径，默认 current。",
                },
            },
        },
        "_meta": {"ui": {"visibility": ["model", "app"]}},
    },
    {
        "name": "open_stats_panel",
        "description": "打开/聚焦会话统计侧栏面板（无参数）。",
        "inputSchema": {"type": "object", "properties": {}},
        "_meta": {"ui": {"visibility": ["model", "app"]}},
    },
]

RESOURCES = [
    {"uri": UI_URI, "name": "panel", "title": "会话统计", "mimeType": "text/html"}
]

# ---------------------------------------------------------------- sqlite ----

_local = threading.local()
_db_cols: dict[str, set[str]] = {}


def log(msg: str) -> None:
    print(f"[session-stats] {msg}", file=sys.stderr, flush=True)


def get_conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        env_db = os.environ.get("ZCODE_SESSION_DB_PATH", "")
        db = Path(env_db) if env_db else Path.home() / ".zcode" / "cli" / "db" / "db.sqlite"
        if not db.exists():
            raise RuntimeError(f"会话数据库不存在: {db}")
        conn = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True, timeout=5)
        conn.execute("PRAGMA busy_timeout=5000")
        conn.row_factory = sqlite3.Row
        _local.conn = conn
    return conn


def close_local_conn() -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except sqlite3.Error:
            pass
        _local.conn = None


def cols(table: str) -> set[str]:
    if table not in _db_cols:
        rows = get_conn().execute(f"PRAGMA table_info({table})").fetchall()
        _db_cols[table] = {r[1] for r in rows}
    return _db_cols[table]


# ------------------------------------------------------------- 会话解析 ----


def read_hook_session() -> str | None:
    """SessionStart hook 把 session_id 写进插件数据目录的 current_session 文件。"""
    data_dir = os.environ.get("ZCODE_PLUGIN_DATA", "")
    if not data_dir:
        return None
    try:
        return (Path(data_dir) / "current_session").read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def fallback_session() -> str | None:
    """兜底：最近一个有 model_usage 的非子代理会话。"""
    row = get_conn().execute(
        "SELECT session_id FROM model_usage WHERE session_id NOT LIKE 'sess_subagent%'"
        " ORDER BY started_at DESC LIMIT 1"
    ).fetchone()
    return row[0] if row else None


def resolve_session_id(explicit: str | None) -> tuple[str | None, str]:
    if explicit:
        return explicit, "param"
    env_sid = os.environ.get("ZCODE_SESSION_ID")
    if env_sid:
        return env_sid, "env"
    hooked = read_hook_session()
    if hooked:
        return hooked, "hook"
    fb = fallback_session()
    return fb, "fallback"


def session_family(main_id: str) -> list[str]:
    """主会话 + 其子代理会话（session.parent_id 关联）。"""
    try:
        kids = [
            r[0]
            for r in get_conn().execute(
                "SELECT id FROM session WHERE parent_id = ?", (main_id,)
            ).fetchall()
        ]
    except sqlite3.Error:
        kids = []
    return [main_id] + kids


# ------------------------------------------------------------- 聚合统计 ----

# 请求行的过滤条件由调用方给（current: session_id IN (...)，today: started_at >= ?）

_DECODE_GUARD = (
    "output_tokens > 0 AND first_token_at IS NOT NULL "
    "AND completed_at IS NOT NULL AND completed_at > first_token_at"
)


def agg_model(cur, cond: str, params: list) -> dict:
    r = cur.execute(
        f"""
        SELECT
          COUNT(DISTINCT logical_request_id)                            AS steps,
          COALESCE(SUM(duration_ms), 0)                                 AS model_ms,
          AVG(time_to_first_token_ms)                                   AS ttft_avg,
          COALESCE(SUM(CASE WHEN time_to_first_token_ms IS NOT NULL
                       THEN 1 ELSE 0 END), 0)                           AS ttft_steps,
          COALESCE(SUM(input_tokens), 0)                                AS t_in,
          COALESCE(SUM(output_tokens), 0)                               AS t_out,
          COALESCE(SUM(reasoning_tokens), 0)                            AS t_reason,
          COALESCE(SUM(cache_read_input_tokens), 0)                     AS t_cread,
          COALESCE(SUM(cache_creation_input_tokens), 0)                 AS t_cwrite,
          COALESCE(SUM(CASE WHEN {_DECODE_GUARD}
                       THEN output_tokens END), 0)                      AS decode_tokens,
          COALESCE(SUM(CASE WHEN {_DECODE_GUARD}
                       THEN completed_at - first_token_at END), 0)      AS decode_ms
        FROM model_usage WHERE {cond}
        """,
        params,
    ).fetchone()
    return dict(r)


def agg_tools(cur, cond: str, params: list) -> dict:
    r = cur.execute(
        "SELECT COALESCE(COUNT(*), 0) AS calls, COALESCE(SUM(duration_ms), 0) AS tool_ms"
        f" FROM tool_usage WHERE {cond}",
        params,
    ).fetchone()
    return dict(r)


def models_breakdown(cur, cond: str, params: list) -> list[dict]:
    rows = cur.execute(
        f"""
        SELECT model_id,
               COUNT(DISTINCT logical_request_id)                      AS steps,
               COALESCE(SUM(input_tokens), 0)                          AS t_in,
               COALESCE(SUM(output_tokens), 0)                         AS t_out,
               COALESCE(SUM(cache_read_input_tokens), 0)               AS t_cread,
               COALESCE(SUM(cache_creation_input_tokens), 0)           AS t_cwrite,
               COALESCE(SUM(CASE WHEN {_DECODE_GUARD}
                            THEN output_tokens END), 0)                AS decode_tokens,
               COALESCE(SUM(CASE WHEN {_DECODE_GUARD}
                            THEN completed_at - first_token_at END), 0) AS decode_ms
        FROM model_usage WHERE {cond}
        GROUP BY model_id ORDER BY t_in + t_out DESC
        """,
        params,
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["tps"] = round(d["decode_tokens"] * 1000.0 / d["decode_ms"], 1) if d["decode_ms"] > 0 else None
        out.append(d)
    return out


def recent_requests(cur, cond: str, params: list, limit: int = 6) -> list[dict]:
    """最近几条请求的原始计时（供 pill 算实时 TPS）。started_at 倒序。"""
    rows = cur.execute(
        f"""
        SELECT logical_request_id, output_tokens, first_token_at, completed_at,
               started_at, model_id
        FROM model_usage WHERE {cond}
        ORDER BY started_at DESC LIMIT {int(limit)}
        """,
        params,
    ).fetchall()
    return [
        {
            "rid": r[0], "out": r[1], "fta": r[2], "done_at": r[3],
            "started": r[4], "model": r[5],
        }
        for r in rows
    ]


def build_stats(scope: str, session_id: str | None, session_source: str) -> dict:
    cur = get_conn().cursor()
    payload = {
        "scope": scope,
        "session_id": session_id,
        "session_source": session_source,
        "generated_at": int(time.time() * 1000),
        "turns": None,
        "steps": 0,
        "model_ms": 0,
        "tool_ms": 0,
        "tool_calls": 0,
        "ttft_ms_avg": None,
        "ttft_steps": 0,
        "tps": None,
        "decode_tokens": 0,
        "decode_ms": 0,
        "tokens": {
            "input": 0, "output": 0, "reasoning": 0,
            "cache_read": 0, "cache_write": 0, "total": 0,
        },
        "cache_hit_pct": None,
        "models": [],
        "subagent_count": 0,
    }

    if scope == "today":
        # 本地零点（epoch ms）
        midnight = int(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
        cond = "started_at >= ?"
        params: list = [midnight]
        n = cur.execute(
            "SELECT COUNT(DISTINCT CASE WHEN session_id NOT LIKE 'sess_subagent%'"
            " THEN session_id END) FROM model_usage WHERE started_at >= ?",
            params,
        ).fetchone()
        payload["sessions"] = n[0]
    else:
        if not session_id:
            payload["error"] = "无法解析当前会话 id（hook/env/db 兜底均未命中）"
            return payload
        ids = session_family(session_id)
        payload["subagent_count"] = len(ids) - 1
        cond = "session_id IN (" + ",".join("?" * len(ids)) + ")"
        params = list(ids)
        payload["turns"] = cur.execute(
            "SELECT COUNT(DISTINCT turn_id) FROM model_usage WHERE session_id = ?",
            (session_id,),
        ).fetchone()[0]

    m = agg_model(cur, cond, params)
    t = agg_tools(cur, cond, params)
    payload["steps"] = m["steps"]
    payload["model_ms"] = m["model_ms"]
    payload["ttft_ms_avg"] = round(m["ttft_avg"]) if m["ttft_avg"] is not None else None
    payload["ttft_steps"] = m["ttft_steps"]
    payload["decode_tokens"] = m["decode_tokens"]
    payload["decode_ms"] = m["decode_ms"]
    payload["tps"] = round(m["decode_tokens"] * 1000.0 / m["decode_ms"], 1) if m["decode_ms"] > 0 else None
    payload["tool_calls"] = t["calls"]
    payload["tool_ms"] = t["tool_ms"]
    payload["tokens"] = {
        "input": m["t_in"],
        "output": m["t_out"],
        "reasoning": m["t_reason"],
        "cache_read": m["t_cread"],
        "cache_write": m["t_cwrite"],
        "total": m["t_in"] + m["t_out"],
    }
    # input 已含 cache_read（spike 实测）；其他供应商若口径不同会 >100，钳制并让 UI 展示明细
    hit = m["t_cread"] * 100.0 / m["t_in"] if m["t_in"] > 0 else None
    payload["cache_hit_pct"] = round(min(hit, 100.0), 1) if hit is not None else None
    payload["models"] = models_breakdown(cur, cond, params)
    payload["recent"] = recent_requests(cur, cond, params)
    return payload


# ------------------------------------------------------------- MCP 协议 ----


def tool_get_stats(args: dict) -> dict:
    scope = args.get("scope") or "current"
    if scope not in ("current", "today"):
        scope = "current"
    if scope == "today":
        sid, source = None, "n/a"
    else:
        sid, source = resolve_session_id(args.get("session_id"))
    payload = build_stats(scope, sid, source)
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    return {"content": [{"type": "text", "text": text}], "structuredContent": payload}


def tool_open_panel(_args: dict) -> dict:
    return {
        "content": [{"type": "text", "text": "会话统计面板已打开（stats-panel）。"}],
        "_meta": {"ui": {"surface": "stats-panel"}},
    }


def read_panel_html() -> str:
    try:
        return PANEL_FILE.read_text(encoding="utf-8")
    except OSError as e:
        log(f"panel.html 读取失败: {e}")
        return (
            "<!doctype html><meta charset='utf-8'><body style='font-family:sans-serif'>"
            f"panel.html 缺失：{PANEL_FILE}</body>"
        )


def reply(rid, result: dict) -> None:
    send({"jsonrpc": "2.0", "id": rid, "result": result})


def send_err(rid, code: int, message: str) -> None:
    send({"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}})


def send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle(req: dict) -> None:
    method = req.get("method")
    rid = req.get("id")

    if method == "initialize":
        client_pv = (req.get("params") or {}).get("protocolVersion") or "2025-06-18"
        reply(rid, {
            "protocolVersion": client_pv,
            "capabilities": {"tools": {}, "resources": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": "session-stats: 只读查询 ZCode 本地会话统计。",
        })
        return

    if rid is None:
        return  # notification（notifications/initialized 等）一律不回

    if method == "ping":
        reply(rid, {})
    elif method == "tools/list":
        reply(rid, {"tools": TOOLS})
    elif method == "tools/call":
        params = req.get("params") or {}
        name = params.get("name", "")
        args = params.get("arguments") or {}
        try:
            if name == "get_stats":
                result = tool_get_stats(args)
            elif name == "open_stats_panel":
                result = tool_open_panel(args)
            else:
                send_err(rid, -32602, f"unknown tool: {name}")
                return
        except Exception as e:  # noqa: BLE001
            log(f"tools/call {name} 失败: {e!r}")
            reply(rid, {"content": [{"type": "text", "text": f"统计失败: {e}"}], "isError": True})
            return
        reply(rid, result)
    elif method == "resources/list":
        reply(rid, {"resources": RESOURCES})
    elif method == "resources/read":
        uri = (req.get("params") or {}).get("uri")
        if uri != UI_URI:
            send_err(rid, -32602, f"unknown resource: {uri}")
            return
        reply(rid, {"contents": [{"uri": UI_URI, "mimeType": "text/html", "text": read_panel_html()}]})
    else:
        send_err(rid, -32601, f"method not found: {method}")


# ------------------------------------------------------- 本地数据服务 ----
# 渲染层注入 pill 的数据源：http://127.0.0.1:31710。
# 生命周期跟随 MCP 服务器进程（会话存活期间）；多实例靠端口单例 + 健康探测，
# 谁先绑定谁服务，后到的发现健康实例就静默退出。仅响应 file:// 页面
# （Origin: null/缺失），其余 Origin 一律 403。

HTTP_HOST = "127.0.0.1"
HTTP_PORT = int(os.environ.get("ZCODE_STATS_HTTP_PORT", "31710"))
# pill 代码下发路径解析顺序：环境变量（开发者热更新用）→ 插件内置副本（共享默认）→ 开发目录
PILLS_CANDIDATES = [
    os.environ.get("ZCODE_STATS_PILLS_PATH", ""),
    str(PLUGIN_ROOT / "server" / "pills.js"),
    str(PLUGIN_ROOT.parents[1] / "patches" / "pills.js"),
]


def read_pills_js() -> str | None:
    for p in PILLS_CANDIDATES:
        if p:
            try:
                return Path(p).read_text(encoding="utf-8")
            except OSError:
                continue
    return None


def _health_check() -> bool:
    try:
        with urllib.request.urlopen(
            f"http://{HTTP_HOST}:{HTTP_PORT}/health", timeout=1
        ) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


class _StatsHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        allowed = False
        try:
            origin = self.headers.get("Origin")
            allowed = origin in (None, "", "null")
            parsed = urllib.parse.urlparse(self.path)
            if not allowed:
                self._send(403, {"error": "origin rejected"}, cors=False)
            elif parsed.path == "/health":
                self._send(200, {"ok": True, "version": SERVER_VERSION})
            elif parsed.path == "/pills.js":
                code = read_pills_js()
                if code is None:
                    self._send(404, {"error": "pills.js not configured"})
                else:
                    body = code.encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/javascript; charset=utf-8")
                    self.send_header("Access-Control-Allow-Origin", "null")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(body)
            elif parsed.path == "/stats":
                qs = urllib.parse.parse_qs(parsed.query)
                scope = qs.get("scope", ["current"])[0]
                if scope not in ("current", "today"):
                    scope = "current"
                if scope == "today":
                    payload = build_stats("today", None, "n/a")
                else:
                    sid_param = (qs.get("session_id") or [None])[0]
                    if sid_param is not None and not str(sid_param).startswith(("sess_", "session_")):
                        sid_param = None  # 格式守卫，防宿主 DOM 传来 draft 等占位值
                    sid, source = resolve_session_id(sid_param)
                    payload = build_stats("current", sid, source)
                self._send(200, payload)
            else:
                self._send(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            log(f"HTTP 处理异常: {e!r}")
            try:
                self._send(500, {"error": str(e)}, cors=allowed)
            except Exception:  # noqa: BLE001
                pass
        finally:
            close_local_conn()

    def _send(self, code: int, obj: dict, cors: bool = True) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if cors:
            self.send_header("Access-Control-Allow-Origin", "null")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args) -> None:  # noqa: N802
        pass  # 静默访问日志


def start_http_service() -> None:
    class _Server(ThreadingHTTPServer):
        # Windows 上 SO_REUSEADDR 会允许重复绑定活跃端口，关闭以靠异常探测单例
        allow_reuse_address = False
        daemon_threads = True

    for _ in range(3):
        try:
            srv = _Server((HTTP_HOST, HTTP_PORT), _StatsHandler)
        except OSError:
            if _health_check():
                log(f"端口 {HTTP_PORT} 已有健康实例，跳过启动")
                return
            time.sleep(0.5)
            continue
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        log(f"数据服务已启动 http://{HTTP_HOST}:{HTTP_PORT}")
        return
    log(f"数据服务启动失败（端口 {HTTP_PORT} 被占用且无健康实例）")


def main() -> None:
    try:
        sys.stdout.reconfigure(newline="\n", encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    log(f"started; plugin_root={PLUGIN_ROOT}")
    start_http_service()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            log(f"非法 JSON 行: {e}; line={line[:120]!r}")
            continue
        try:
            handle(req)
        except Exception as e:  # noqa: BLE001
            log(f"handle 异常: {e!r}")
            if req.get("id") is not None:
                send_err(req["id"], -32603, f"internal error: {e}")


if __name__ == "__main__":
    main()
