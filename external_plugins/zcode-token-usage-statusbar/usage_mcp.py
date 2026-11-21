# -*- coding: utf-8 -*-
"""Token 用量 MCP server（stdio, 零依赖；注册名 zcode-token-usage-statusbar）。

提供工具 token_usage(scope, host)：current(默认)/today/days:N/sessions[:N]/models[:days]/session:<id前缀>/workspace:<目录关键词>。
host 缺省跟随配置（zcode | workbuddy），也可在单次调用里显式指定。
协议仅实现 initialize / tools/list / tools/call；调试信息只走 stderr。

启动时附带一项安装链补救（issue #163）：待替换 asar 包（客户端运行中安装遗留）的
唯一收尾者是安装监控进程，被提前关闭后独立安装链没有 SessionStart hook 重建它，
pending 会永久搁浅、状态条永不出现。MCP 进程由宿主随会话启动拉起，是独立链唯一
的会话级入口——检测到有效待收尾包且无存活监控时，静默重新拉起（无窗口，等客户端
退出后自动完成替换）。任何失败都不影响查询服务。
"""
import base64
import contextlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import zusage  # noqa: E402

PROTOCOL_VERSION = "2024-11-05"

L = zusage.L   # 输出语言与 CLI 同源（config.json 的 "lang"）


def revive_finalize_monitor():
    """待收尾包监控的尽力复活：config 所在目录即运行目录（独立链=数据目录，
    插件链 config 不在插件目录、回退标准数据目录，--dev=仓库目录），与待收尾包
    sidecar 记录的运行时目录一致，收尾来源授权才能通过。诊断走 stderr，绝不碰
    stdout（stdio 协议通道）。"""
    try:
        if zusage.detect_agent() != zusage.AGENT_ZCODE:
            return   # 只有 ZCode 客户端有 asar 注入链。「在哪个客户端跑」（agent）与
                     # 「读哪个库」（host）是两件事：ZCode 用户配 host=workbuddy 跨宿主
                     # 查询时，待收尾包自愈（issue #163）仍必须保留
        cfg_path = Path(__file__).parent / "config.json"
        if not cfg_path.is_file():
            cfg_path = Path.home() / ".zcode" / "zcode-token-usage-statusbar" / "config.json"
        asar = json.loads(cfg_path.read_text(encoding="utf-8")).get("asar_path")
        if not isinstance(asar, str) or not asar:
            return   # 无安装目标记录（未完成过安装）：无事可做
        import patch_install as pi   # 与本脚本同目录（运行清单/插件目录都携带）
        pi.set_target(asar)
        pi.set_runtime(cfg_path.parent)
        pi.revive_orphan_pending(pi, require_writable=False)
    except Exception as e:  # noqa: BLE001
        print(f"[zusage] monitor revive skipped: {e}", file=sys.stderr)


def tool_token_usage(scope: str = "current", host: str = "") -> str:
    """host 为空 = 跟随配置/环境判定（zusage.resolve_host）；显式传入只覆盖本次查询
    （按次传给 connect，不写进程级覆盖——同一 MCP 进程可能连续查两个宿主，
    粘滞覆盖会让「不传 host 跟随配置」的契约失效）。"""
    if str(host or "").strip() and zusage.normalize_host(host) is None:
        raise ValueError(f"unknown host: {host!r} (expected one of {', '.join(zusage.HOSTS)})")
    con = zusage.connect(host or None)
    try:
        if scope in ("current", "now"):
            return zusage.render_current(con)
        if scope == "today":
            return zusage.render_today(con)
        if scope.startswith("days:"):
            return zusage.render_days(con, int(scope.split(":", 1)[1]))
        if scope == "week":
            return zusage.render_days(con, 7)
        if scope.startswith("sessions"):
            n = int(scope.split(":", 1)[1]) if ":" in scope else 10
            return zusage.render_sessions(con, n)
        if scope.startswith("models"):
            d = int(scope.split(":", 1)[1]) if ":" in scope else 7
            return zusage.render_models(con, d)
        if scope.startswith("session:"):
            return zusage.render_session_detail(con, scope.split(":", 1)[1].strip())
        if scope.startswith("workspace:"):
            return zusage.render_workspace(con, scope.split(":", 1)[1].strip())
        return L(f"未知 scope: {scope!r}。可用: current | today | week | days:N | sessions[:N] | models[:days] | session:<id前缀> | workspace:<目录关键词>",
                 f"Unknown scope: {scope!r}. Available: current | today | week | days:N | sessions[:N] | models[:days] | session:<id prefix> | workspace:<dir keyword>")
    finally:
        con.close()


TOOLS = [
    {
        "name": "token_usage",
        "description": (
            L("查询 token 用量（只读本地库）。默认宿主 zcode（~/.zcode/cli/db/db.sqlite 的逐请求表），"
              "host=workbuddy 时读 ~/.workbuddy/workbuddy.db 的上下文 + 会话正文的逐次调用记录"
              "（token 分项/缓存/思考/速度/工具/费用都有；费用按牌价估算，未收录模型标不可得）。"
              "scope 可选: current(当前会话+今日,默认), today, week, days:N(近N天每日), "
              "sessions:N(最近N个会话), models:days(按模型), session:<id前缀>(指定会话,含按模型与子代理明细), "
              "workspace:<目录关键词>(按工作区聚合主会话+子代理,含按会话与按模型明细)。",
              "Query token usage (read-only local DB). Default host zcode (per-request tables in "
              "~/.zcode/cli/db/db.sqlite); with host=workbuddy it reads context from ~/.workbuddy/workbuddy.db "
              "plus per-call records in session transcripts (tokens/cache/thinking/speed/tools/cost; "
              "cost is estimated and unpriced models are reported unavailable). "
              "scope: current(current session+today, default), today, week, days:N(last N days per day), "
              "sessions:N(last N sessions), models:days(by model), session:<id prefix>(specific session, with per-model and subagent details), "
              "workspace:<dir keyword>(aggregate a workspace's main sessions+subagents, with per-session and per-model details).")
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "scope": {
                    "type": "string",
                    "description": L("查询范围，默认 current", "Query scope, default current"),
                },
                "host": {
                    "type": "string",
                    "enum": list(zusage.HOSTS),
                    "description": L("数据源宿主，缺省跟随配置（zcode | workbuddy）",
                                     "Data-source host; defaults to config (zcode | workbuddy)"),
                },
            },
        },
    }
]


_NOTIFY = object()   # 「无 id 成员」（JSON-RPC 通知）哨兵：与显式 "id": null（仍是请求，须回 id null）区分


def reply(req_id, result):
    if req_id is _NOTIFY:
        return   # 通知不回响应
    print(json.dumps({"jsonrpc": "2.0", "id": req_id, "result": result}), flush=True)


def reply_error(req_id, code, message):
    # 无效帧（-32700/-32600）按规范回 id=null；合法请求的错误本就带 id。
    # 通知（合法帧无 id 成员）的分支错误由调用方先判哨兵再调，不走到这里。
    if req_id is _NOTIFY and code not in (-32700, -32600):
        return
    print(json.dumps({"jsonrpc": "2.0", "id": req_id,
                      "error": {"code": code, "message": message}}), flush=True)


def _overlay_running():
    """CDP 注入器是否在跑：看它自己维护的锁文件心跳（每轮刷新，15s 内算活）。
    锁过期就当作残留——多起一个实例也无害，它自己会因锁被占用立即退出。"""
    lock = Path(tempfile.gettempdir()) / "zusage-wb-overlay.lock"
    try:
        data = json.loads(lock.read_text(encoding="utf-8"))
        return (time.time() * 1000 - float(data.get("at") or 0)) < 15000
    except (OSError, ValueError, TypeError):
        return False


def _spawn_via_wmi(cmd):
    """Windows 脱离式拉起：经 WMI Win32_Process.Create 创建进程（父进程是 WmiPrvSE，
    不在宿主的进程树/Job 内）。宿主给 MCP 子进程挂了 kill-on-close 的 Job，
    普通 detached 子进程会随 MCP 退出被一起杀掉（实测存活约半分钟），所以浮层必须走这条。
    与 patch_install._spawn_via_wmi 同一手法（后者属 asar 安装链，不随本构建分发）。
    隐藏控制台必须把 ShowWindow 放进 **Win32_ProcessStartup 实例**：直接给
    Invoke-CimMethod 传 ShowWindow 会报「无效的参数」，静默失败（踩过）。
    返回 PID，失败返回 None。"""
    if os.name != "nt":
        return None
    try:
        command_line = subprocess.list2cmdline([str(part) for part in cmd])
        script = ("$si = ([wmiclass]'Win32_ProcessStartup').CreateInstance(); "
                  "$si.ShowWindow = 0; "
                  "$r = ([wmiclass]'Win32_Process').Create('%s', $null, $si); "
                  "if ($r.ReturnValue -ne 0) { 'ERR:' + $r.ReturnValue; exit 1 }; "
                  "[int]$r.ProcessId" % command_line.replace("'", "''"))
        encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
            capture_output=True, timeout=20,
            creationflags=0x08000000 if os.name == "nt" else 0)   # CREATE_NO_WINDOW，防闪窗（同 patch_install）
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    try:
        return int(result.stdout.decode("ascii", "replace").strip())
    except ValueError:
        return None


def start_agent_overlay():
    """按 agent 启动浮层策略（进程启动时调用一次）。

    - zcode：overlay=asar。浮层由安装器 / SessionStart hook 的 asar 注入负责，
      **这里什么都不做**——原有机制一字不改。
    - workbuddy：overlay=cdp。它没有 asar 注入链，也不该改客户端程序文件，
      改为拉起 CDP 注入器（wb-overlay.cjs，连 --remote-debugging-port）。
    - cli：无浮层。
    任何失败只写 stderr，绝不影响查询；宿主可用 config.agents.<agent>.overlay 关掉。
    """
    try:
        agent = zusage.detect_agent()
        if zusage.overlay_mode(agent) != "cdp":
            return
        script = zusage.overlay_entrypoint()
        if not script.is_file():
            return   # ZCode 构建/旧包里没有注入器
        if _overlay_running():
            return
        nodes = zusage.node_candidates()
        if not nodes:
            print("[zusage] overlay skipped: node not found", file=sys.stderr)
            return
        cmd = [nodes[0], str(script)]
        if _spawn_via_wmi(cmd):
            return
        # 非 Windows 或 WMI 不可用：树内 detached 兜底（MCP 退出后可能被回收）
        kwargs = {
            "cwd": str(script.parent),
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
            "close_fds": True,
        }
        if os.name == "nt":
            # CREATE_NO_WINDOW | DETACHED_PROCESS；再试 BREAKAWAY_FROM_JOB——
            # 宿主 Job 允许脱离时子进程才真正独立，不允许会抛 WinError 5，退回不带该位。
            try:
                subprocess.Popen(cmd, creationflags=0x08000000 | 0x00000008 | 0x01000000, **kwargs)
                return
            except OSError:
                kwargs["creationflags"] = 0x08000000 | 0x00000008
        else:
            kwargs["start_new_session"] = True
        subprocess.Popen(cmd, **kwargs)
    except Exception as e:  # noqa: BLE001 — 浮层起不来不能拖垮查询服务
        print(f"[zusage] overlay start skipped: {e}", file=sys.stderr)


def main():
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            reply_error(None, -32700, "parse error")
            continue
        # 一帧坏消息（batch 数组、params 非对象等）不能带崩整个 server 进程；
        # 本 server 不实现 batch，按规范回 -32600（协议只实现 initialize/ping/tools-*/call）。
        if not isinstance(msg, dict):
            reply_error(None, -32600, "invalid request: batch is not supported")
            continue
        method = msg.get("method", "")
        req_id = msg["id"] if "id" in msg else _NOTIFY   # 显式 id:null 是请求（回 id null），非通知
        params = msg.get("params")
        if not isinstance(params, dict):
            params = {}
        if method == "initialize":
            # 只声明支持的协议版本：请求了未知版本时按规范回自身版本，不做假能力承诺
            requested = params.get("protocolVersion")
            reply(
                req_id,
                {
                    "protocolVersion": requested if requested == PROTOCOL_VERSION else PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "zcode-token-usage", "version": "1.0.0"},
                },
            )
        elif method == "ping":
            reply(req_id, {})
        elif method == "tools/list":
            reply(req_id, {"tools": TOOLS})
        elif method == "tools/call":
            name = params.get("name")
            if name != "token_usage":
                # 忽略 name 曾让任意工具名都执行 token_usage；未知/缺失工具名按规范报错
                if req_id is not _NOTIFY:
                    reply_error(req_id, -32602, f"unknown tool: {name!r}")
                continue
            args = params.get("arguments") or {}
            if not isinstance(args, dict):
                if req_id is not _NOTIFY:
                    reply_error(req_id, -32602, "arguments must be an object")
                continue
            try:
                text = tool_token_usage(**args)
                reply(req_id, {"content": [{"type": "text", "text": text}], "isError": False})
            except Exception as e:  # noqa: BLE001
                hint = ""
                if isinstance(e, sqlite3.OperationalError):
                    # 库结构漂移（宿主升级改列/表）给出可行动提示，与 zusage.py CLI 同款；
                    # 宿主名按当前判定取值，不把 WorkBuddy 的漂移说成 ZCode 升级。
                    label = zusage.host_label()
                    hint = L(f"\n多半是 {label} 升级改了用量库结构（表/列变更）。请更新本插件后再查询；"
                             "已落库的历史数据不受影响。",
                             f"\nMost likely {label} changed the usage DB schema in an update. "
                             "Update this plugin before querying; stored history is unaffected.")
                reply(
                    req_id,
                    {
                        "content": [{"type": "text",
                                     "text": L(f"查询失败: {e}", f"Query failed: {e}") + hint}],
                        "isError": True,
                    },
                )
        else:
            if req_id is not _NOTIFY:
                reply_error(req_id, -32601, f"unknown method {method}")


if __name__ == "__main__":
    try:
        # newline="\n"：Windows 文本模式默认把 \n 翻译成 \r\n，JSON-RPC 帧尾必须保持 LF
        # （launcher 字节透传，宿主按行分帧；\r 虽是合法 JSON 空白，统一 LF 不给分帧实现留歧义）
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", newline="\n")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    revive_finalize_monitor()
    start_agent_overlay()
    main()
