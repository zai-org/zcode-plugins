#!/usr/bin/env python3
"""malo-browser daemon 的 Python 传输层客户端（零第三方依赖）。

malo daemon = 后台 Electron broker：127.0.0.1:7410 分发端口租约（7411-7499），
session 工具走 HTTP（POST /v1/sessions/:id/tools/<tool>，双 token：lease+session）。
本模块只管传输与生命周期：按需拉起 daemon、租约（心跳/释放）、session
（profile 持久化登录态）、工具调用、capabilities 校验、profile 登录态导入。
页面语义由调用方负责。

用法：
    from malo_client import acquire_lease
    lease = acquire_lease("my-agent")
    try:
        with lease.new_session("work", profile="work") as s:
            s.call("navigate", {"url": "https://example.com"})
            print(s.call("snapshot", {"max_chars": 5000}))
    finally:
        lease.release()
"""

from __future__ import annotations

import json
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# 仓内自指：clients/python/ 的上上级即仓根（electron 与 out/main 都在这里）。
MALO_REPO = Path(__file__).resolve().parent.parent.parent
BROKER_JSON = Path.home() / ".malo-browser" / "broker.json"
DEFAULT_BROKER_ENDPOINT = "http://127.0.0.1:7410"
DEFAULT_LOG = Path.home() / ".malo-browser" / "daemon.log"
# daemon 的 CDP 调试口：带上后 session 页即普通 CDP target，
# Playwright connect_over_cdp 可直连（登录链等存量脚本的迁移通道）。
DEFAULT_CDP_PORT = 9450

# 每个客户端按需声明必需工具；缺失 = daemon 版本过旧，fail-loud 不降级。
BASE_REQUIRED_TOOLS = ("navigate", "click", "fill", "snapshot", "assert", "close")


class MaloError(RuntimeError):
    """malo 链路失败（拉起/租约/工具），message 自带证据，不兜底。"""


def _http(method: str, url: str, payload: dict | None = None,
          headers: dict | None = None, timeout: float = 30) -> dict:
    """一次 JSON HTTP 调用 → 解析后的 body；非 2xx 抛 MaloError（带响应体）。"""
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("content-type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise MaloError(f"malo HTTP {e.code} {url}: {detail}") from e
    except (urllib.error.URLError, socket.timeout, ConnectionError) as e:
        raise MaloError(f"malo 连不上 {url}: {type(e).__name__} {e}") from e
    try:
        return json.loads(body) if body else {}
    except json.JSONDecodeError as e:
        raise MaloError(f"malo 响应非 JSON {url}: {body[:200]}") from e


def _port_open(endpoint: str, timeout: float = 2.0) -> bool:
    try:
        host = urllib.parse.urlsplit(endpoint).hostname or "127.0.0.1"
        port = urllib.parse.urlsplit(endpoint).port or 80
    except ValueError:
        return False
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _read_broker_json() -> dict:
    try:
        return json.loads(BROKER_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _spawn_daemon(started_by: str, log_path: Path, debug_port: int | None = None) -> None:
    """后台拉起 daemon（detached，不抢焦点；日志追加到 log_path）。"""
    electron = MALO_REPO / "node_modules" / ".bin" / "electron"
    entry = MALO_REPO / "out" / "main" / "index.js"
    for p, hint in ((electron, f"malo 仓未装依赖: {MALO_REPO}"),
                    (entry, f"malo 未构建（out/main 缺失）: cd {MALO_REPO} && npm run build")):
        if not p.exists():
            raise MaloError(f"无法拉起 malo daemon——{hint}")
    cmd = [str(electron), ".", "--mode=daemon"]
    if debug_port:
        cmd.append(f"--remote-debugging-port={debug_port}")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a") as log:
        log.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} spawn by {started_by} =====\n")
        log.flush()
        subprocess.Popen(
            cmd, cwd=MALO_REPO,
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            start_new_session=True)


def ensure_daemon(wait_s: float = 60.0, log_path: Path | None = None,
                  debug_port: int | None = None) -> dict:
    """broker 就绪（健康复用/死了拉起）→ 返回 broker.json 内容（endpoint/token）。

    debug_port：要求 daemon 带 CDP 调试口跑。daemon 活着但没带口时 fail-loud
    （登录态在运行中的进程里，不静默杀进程重启——由调用方处置）。
    """
    info = _read_broker_json()
    endpoint = info.get("endpoint") or DEFAULT_BROKER_ENDPOINT
    broker_ok = _port_open(endpoint)
    cdp_ok = debug_port is None or _port_open(f"http://127.0.0.1:{debug_port}")
    if broker_ok and cdp_ok:
        return info or {"endpoint": endpoint}
    if broker_ok and not cdp_ok:
        raise MaloError(
            f"malo daemon 在跑（{endpoint}）但 CDP 调试口 {debug_port} 未开。"
            f"该进程内可能挂着带登录态的 session，不自动杀；确认无需保留后执行："
            f"pkill -f 'malo.*--mode=daemon' 再重跑（本次会带调试口拉起）。")
    print(f"[malo] daemon 不在（{endpoint}），后台拉起（{MALO_REPO}）")
    _spawn_daemon(started_by="python-client", log_path=log_path or DEFAULT_LOG,
                  debug_port=debug_port)
    deadline = time.time() + wait_s
    while time.time() < deadline:
        if _port_open(endpoint, timeout=1.0) and (
            debug_port is None or _port_open(f"http://127.0.0.1:{debug_port}", timeout=1.0)
        ):
            # 新实例会重写 broker.json；端点通了但文件没刷新 = 异常，如实报
            fresh = _read_broker_json()
            if fresh.get("endpoint"):
                return fresh
        time.sleep(1.5)
    tail = ""
    try:
        tail = (log_path or DEFAULT_LOG).read_text(encoding="utf-8")[-600:] if (log_path or DEFAULT_LOG).is_file() else "(无日志)"
    except OSError:
        tail = "(日志读失败)"
    raise MaloError(f"malo daemon {wait_s:.0f}s 未就绪（{endpoint}）；启动日志尾:\n{tail}")


def acquire_lease(agent_id: str, required_tools: tuple[str, ...] = BASE_REQUIRED_TOOLS,
                  log_path: Path | None = None) -> "MaloLease":
    """ensure daemon → 租约（同 agent_id 有效期内复用）→ capabilities 校验。"""
    broker = ensure_daemon(log_path=log_path)
    endpoint = broker.get("endpoint") or DEFAULT_BROKER_ENDPOINT
    token = broker.get("token")
    if not token:
        raise MaloError(f"{BROKER_JSON} 缺 token（daemon 端点 {endpoint}），无法租约")
    lease = _http("POST", f"{endpoint}/v1/leases",
                  {"agent_id": agent_id}, {"x-malo-broker-token": token})
    ml = MaloLease(endpoint=lease["endpoint"], token=lease["token"],
                   lease_id=lease["lease_id"], agent_id=agent_id,
                   broker_endpoint=endpoint, broker_token=token)
    ml.check_capabilities(required_tools)
    return ml


def import_profile_login(lease: "MaloLease", profile: str, cdp_url: str,
                         domains: list[str] | None = None,
                         session_cookie_ttl_days: int = 180) -> dict:
    """把源 Chromium（回环 CDP 端点）的 cookies 热导入 malo profile。

    返回 {cookies_total/cookies_matched/cookies_written/cookies_failed/...}；
    源连不上抛 MaloError(502 E_IMPORT_SOURCE_UNREACHABLE)，0 条命中抛 400。
    """
    body: dict = {"cdp_url": cdp_url, "session_cookie_ttl_days": session_cookie_ttl_days}
    if domains:
        body["domains"] = domains
    return lease._post(f"/v1/profiles/{profile}/import", body)


def open_session(agent_id: str, url: str, profile: str | None = None,
                 debug_port: int | None = DEFAULT_CDP_PORT,
                 required_tools: tuple[str, ...] = BASE_REQUIRED_TOOLS,
                 log_path: Path | None = None,
                 settle_ms: int = 3000,
                 width: int = 1440, height: int = 900) -> tuple["MaloLease", "MaloSession"]:
    """一步到位：拉起带 CDP 调试口的 daemon → 租约 → profile 会话 → 导航到 url。

    返回 (lease, session)；调用方 finally 里 session.close() + lease.release()
    （登录态已沉淀 profile，收尾失败不影响）。导航结果 ok:false 时抛 MaloError。
    Playwright 直连调试口（http://127.0.0.1:<debug_port>）可继续驱动该会话页。
    width/height 是会话视口（CSS 内容区，录制场景按 16:9 给）。
    """
    ensure_daemon(log_path=log_path, debug_port=debug_port)
    lease = acquire_lease(agent_id, required_tools=required_tools, log_path=log_path)
    try:
        session = lease.new_session(f"{profile or 'anon'}-session", profile=profile,
                                    width=width, height=height)
        r = session.call("navigate", {"url": url, "timeout_ms": 45_000,
                                      "settle_ms": settle_ms})
        if isinstance(r, dict) and r.get("ok") is False:
            raise MaloError(f"malo 会话导航失败（{url}）：{str(r)[:300]}")
        return lease, session
    except Exception:
        lease.release()
        raise


class MaloLease:
    """一个端口租约：心跳续租、session 生命周期、工具调用入口。"""

    def __init__(self, endpoint: str, token: str, lease_id: str, agent_id: str,
                 broker_endpoint: str, broker_token: str):
        self.endpoint = endpoint          # lease 端口，如 http://127.0.0.1:7411
        self.token = token                # lease token
        self.lease_id = lease_id
        self.agent_id = agent_id
        self._headers = {"x-malo-lease-token": token}
        self._broker = (broker_endpoint, broker_token)

    def check_capabilities(self, required: tuple[str, ...] = BASE_REQUIRED_TOOLS) -> None:
        names = {t.get("name") for t in self._get("/v1/tools").get("tools", [])}
        missing = [t for t in required if t not in names]
        if missing:
            raise MaloError(f"运行中的 malo daemon 缺工具 {missing}（版本过旧），"
                            f"需升级 {MALO_REPO} 并重启 daemon")

    def heartbeat(self) -> None:
        # 心跳/释放都是 broker 路由（lease 端口只挂 session 工具）
        be, bt = self._broker
        _http("POST", f"{be}/v1/leases/{self.lease_id}/heartbeat",
              None, {"x-malo-broker-token": bt})

    def release(self) -> None:
        # 释放是 broker 路由（lease 端口没有 DELETE /v1/leases/:id）
        be, bt = self._broker
        try:
            _http("DELETE", f"{be}/v1/leases/{self.lease_id}",
                  None, {"x-malo-broker-token": bt})
        except MaloError as e:  # 收尾清理性失败不掩盖主流程结果
            print(f"[malo] ⚠️ 租约释放失败（不影响本次产出）：{e}")

    def new_session(self, name: str, profile: str | None = None,
                    width: int = 1440, height: int = 900) -> "MaloSession":
        body = {"name": name, "width": width, "height": height}
        if profile:
            body["profile"] = profile
        r = self._post("/v1/sessions", body)
        return MaloSession(self, r["session_id"], r["session_token"])

    def _get(self, path: str) -> dict:
        return _http("GET", f"{self.endpoint}{path}", None, self._headers)

    def _post(self, path: str, payload: dict) -> dict:
        return _http("POST", f"{self.endpoint}{path}", payload, self._headers)


class MaloSession:
    """一个浏览 session（同名 profile 跨 session 复用 cookies/登录态）。"""

    def __init__(self, lease: MaloLease, session_id: str, session_token: str):
        self.lease = lease
        self.id = session_id
        self._headers = {**lease._headers, "x-malo-session-token": session_token}

    def call(self, tool: str, payload: dict | None = None,
             timeout: float = 120) -> dict:
        """调 session 工具 → result 字段；HTTP 层失败抛 MaloError。

        注意：业务失败（如 assert 不成立）是 HTTP 200 + result.ok=false，
        由调用方读语义，本层不吞不判。
        """
        r = _http("POST", f"{self.lease.endpoint}/v1/sessions/{self.id}/tools/{tool}",
                  payload or {}, self._headers, timeout=timeout)
        return r.get("result", r)

    def close(self) -> None:
        try:
            self.call("close")
        except MaloError as e:
            print(f"[malo] ⚠️ session 关闭失败（登录态已在 profile，不影响）：{e}")

    def __enter__(self) -> "MaloSession":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
