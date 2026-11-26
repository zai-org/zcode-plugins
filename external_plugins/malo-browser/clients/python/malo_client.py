#!/usr/bin/env python3
"""malo-browser daemon 的 Python 传输层客户端（零第三方依赖）。

malo daemon = 后台 Electron broker：127.0.0.1:7410 分发端口租约（7411-7499），
session 工具走 HTTP（POST /v1/sessions/:id/tools/<tool>，双 token：lease+session）。
本模块只管传输与生命周期：按需拉起 daemon、租约（自动心跳/释放）、session
（profile 持久化登录态）、工具调用、capabilities 校验、profile 登录态导入。
页面语义由调用方负责。

用法：
    from malo_client import acquire_lease
    with acquire_lease("my-agent") as lease:
        with lease.new_session("work", profile="work") as s:
            s.call("navigate", {"url": "https://example.com"})
            print(s.call("snapshot", {"max_chars": 5000}))
"""

from __future__ import annotations

import contextlib
import fcntl
import itertools
import json
import os
import shlex
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from pathlib import Path

# 仓内自指：clients/python/ 的上上级即仓根（electron 与 out/main 都在这里）。
MALO_REPO = Path(__file__).resolve().parent.parent.parent
DEFAULT_DATA_DIR = Path.home() / ".malo-browser"
BROKER_JSON = DEFAULT_DATA_DIR / "broker.json"
DEFAULT_BROKER_ENDPOINT = "http://127.0.0.1:7410"
DEFAULT_LOG = DEFAULT_DATA_DIR / "daemon.log"
# daemon 的 CDP 调试口惯例值。没有鉴权，必须由调用方显式传入才会开。
DEFAULT_CDP_PORT = 9450

# 每个客户端按需声明必需工具；缺失 = daemon 版本过旧，fail-loud 不降级。
BASE_REQUIRED_TOOLS = ("navigate", "click", "fill", "snapshot", "assert", "close")
# 必需能力：没有 lease.holder 的 daemon 会忽略持有者、退回「同 agent 名共用租约」，
# 并行进程又会互踩——所以不当没事，直接失败提示重启。
BASE_REQUIRED_FEATURES = ("lease.holder",)

# 客户端自己管理这几个参数，调用方再传会与之冲突
RESERVED_DAEMON_ARGS = ("--mode", "--data-dir", "--daemon-port")
# 心跳间隔 = 租约 TTL 的三分之一，夹在这个范围内
HEARTBEAT_MIN_INTERVAL_S = 5.0
HEARTBEAT_MAX_INTERVAL_S = 60.0

_PROCESS_HOLDER: str | None = None
# 同一进程内多个线程首次申请租约时串行化：并发首发会在 daemon 侧各建一个租约
_ACQUIRE_LOCK = threading.Lock()


def _log(message: str) -> None:
    # 库不往标准输出写字：调用方常把自己的结果打到 stdout
    print(f"[malo] {message}", file=sys.stderr, flush=True)


def _holder() -> str:
    """本进程的持有者标识（进程级唯一）。"""
    global _PROCESS_HOLDER
    if _PROCESS_HOLDER is None:
        _PROCESS_HOLDER = uuid.uuid4().hex
    return _PROCESS_HOLDER


class MaloError(RuntimeError):
    """malo 链路失败（拉起/租约/工具），message 自带证据，不兜底。"""


def _timed_out(url: str, timeout: float, cause: BaseException) -> MaloError:
    return MaloError(
        f"malo 请求超时：{url} 在 {timeout:g}s 内没有响应（daemon 仍在处理这次请求，"
        f"长操作请显式加大 timeout）：{type(cause).__name__} {cause}"
    )


def _http(method: str, url: str, payload: dict | None = None,
          headers: dict | None = None, timeout: float = 30) -> dict:
    """一次 JSON HTTP 调用 → 解析后的 body；非 2xx 抛 MaloError（带响应体）。

    连不上、超时、HTTP 错误是三种不同的失败，报错里分开说。
    """
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("content-type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:1000]
        e.close()
        raise MaloError(f"malo HTTP {e.code} {url}: {detail}") from e
    except (TimeoutError, socket.timeout) as e:
        raise _timed_out(url, timeout, e) from e
    except urllib.error.URLError as e:
        if isinstance(e.reason, (TimeoutError, socket.timeout)):
            raise _timed_out(url, timeout, e) from e
        raise MaloError(f"malo 连不上 {url}: {type(e.reason).__name__} {e.reason}") from e
    except OSError as e:
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


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _read_broker_json(broker_file: Path) -> dict:
    try:
        parsed = json.loads(broker_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _broker_port(endpoint: str) -> int:
    try:
        return urllib.parse.urlsplit(endpoint).port or 80
    except ValueError:
        return 0


def _token_accepted(info: dict) -> bool:
    """broker.json 里的 token 是否正是运行中 daemon 认的那一个。

    端口开着不等于文件是新鲜的：daemon 先监听后写文件，旧文件残留的 token 会被拒。
    """
    token, endpoint = info.get("token"), info.get("endpoint")
    if not token or not endpoint:
        return False
    try:
        _http("GET", f"{endpoint}/v1/leases", None, {"x-malo-broker-token": token}, timeout=5)
        return True
    except MaloError:
        return False


def _version_tuple(version: object) -> tuple[int, ...]:
    parts: list[int] = []
    for chunk in str(version).split("."):
        digits = "".join(itertools.takewhile(str.isdigit, chunk))
        if not digits:
            break
        parts.append(int(digits))
    return tuple(parts)


def _repo_version() -> str | None:
    """本仓的版本；客户端被拷到仓外时读不到，返回 None（不做版本对账）。"""
    try:
        parsed = json.loads((MALO_REPO / "package.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    version = parsed.get("version")
    return version if isinstance(version, str) and version else None


@contextlib.contextmanager
def _start_lock(broker_file: Path):
    """同一次冷启动只让一个进程拉起 daemon，其余在锁上等它起来，拿到锁后直接复用。"""
    broker_file.parent.mkdir(parents=True, exist_ok=True)
    lock_path = broker_file.parent / "daemon.lock"
    with open(lock_path, "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _daemon_args(extra: list[str] | None) -> list[str]:
    """daemon 的附加启动参数：调用方显式给的 + 环境变量 MALO_DAEMON_ARGS（代理、限额之类）。"""
    args = shlex.split(os.environ.get("MALO_DAEMON_ARGS", "")) + list(extra or [])
    for arg in args:
        name = arg.split("=", 1)[0]
        if name in RESERVED_DAEMON_ARGS:
            raise ValueError(
                f"daemon 参数 {name} 由客户端管理，不能通过 daemon_args / MALO_DAEMON_ARGS 传入")
    return args


def _spawn_daemon(broker_file: Path, log_path: Path, debug_port: int | None = None,
                  extra_args: list[str] | None = None, started_by: str = "python-client") -> None:
    """后台拉起 daemon（detached，不抢焦点；日志追加到 log_path）。"""
    electron = MALO_REPO / "node_modules" / ".bin" / "electron"
    entry = MALO_REPO / "out" / "main" / "index.js"
    for p, hint in ((electron, f"malo 仓未装依赖: {MALO_REPO}"),
                    (entry, f"malo 未构建（out/main 缺失）: cd {MALO_REPO} && npm run build")):
        if not p.exists():
            raise MaloError(f"无法拉起 malo daemon——{hint}")
    cmd = [str(electron), ".", "--mode=daemon", f"--data-dir={broker_file.parent}"]
    # 沿用 broker.json 里记下的端口：换了端口的陈旧文件不会被悄悄改成默认端口
    stale = _read_broker_json(broker_file)
    stale_port = _broker_port(stale.get("endpoint") or "") if stale else 0
    if stale_port:
        cmd.append(f"--daemon-port={stale_port}")
    if debug_port:
        cmd.append(f"--remote-debugging-port={debug_port}")
    cmd += extra_args or []
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a") as log:
        log.write(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} spawn by {started_by} =====\n")
        log.flush()
        subprocess.Popen(
            cmd, cwd=MALO_REPO,
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            start_new_session=True)


def _wait_ready(broker_file: Path, wait_s: float, debug_port: int | None,
                log_path: Path, spawn: Callable[[], None]) -> dict:
    endpoint = _read_broker_json(broker_file).get("endpoint") or DEFAULT_BROKER_ENDPOINT
    spawn()
    deadline = time.time() + wait_s
    while time.time() < deadline:
        fresh = _read_broker_json(broker_file)
        if fresh.get("endpoint") and fresh.get("token") and _token_accepted(fresh):
            if debug_port is None or _port_open(f"http://127.0.0.1:{debug_port}", timeout=1.0):
                return fresh
        time.sleep(1.5)
    tail = ""
    try:
        tail = log_path.read_text(encoding="utf-8")[-600:] if log_path.is_file() else "(无日志)"
    except OSError:
        tail = "(日志读失败)"
    raise MaloError(f"malo daemon {wait_s:.0f}s 未就绪（{endpoint}）；启动日志尾:\n{tail}")


def _require_debug_port(info: dict, debug_port: int | None) -> None:
    if debug_port is None:
        return
    if not _port_open(f"http://127.0.0.1:{debug_port}"):
        raise MaloError(
            f"malo daemon 在跑（{info.get('endpoint')}）但 CDP 调试口 {debug_port} 未开。"
            f"该进程内可能挂着带登录态的 session，不自动杀；确认无需保留后执行："
            f"pkill -f 'malo.*--mode=daemon' 再重跑（本次会带调试口拉起）。")


def _warn_debug_port(debug_port: int | None) -> None:
    if debug_port is not None:
        _log(
            f"警告：要求 daemon 开 CDP 调试口 {debug_port}。这个口没有鉴权——本机任何进程连上都能操作"
            f"这个 daemon 里的全部会话和已登录档案，经它做的点击、输入也不进会话事件。"
            f"多人多 agent 共用的 daemon 不应开调试口；需要 Playwright 直连时建议用独立 data-dir 的 daemon。"
        )


def _refresh_if_stale(info: dict, debug_port: int | None) -> dict | None:
    """本仓版本比运行中的 daemon 新：没有租约在用就停掉它让新代码生效，有人用则明确拒绝。

    返回继续沿用的 broker 信息；旧 daemon 已被停掉、需要重新拉起时返回 None。
    """
    endpoint, token = info.get("endpoint"), info.get("token")
    running, repo = info.get("version"), _repo_version()
    if not (endpoint and token and running and repo):
        return info
    if _version_tuple(running) == _version_tuple(repo):
        return info
    if _version_tuple(running) > _version_tuple(repo):
        _log(f"运行中的 malo daemon 版本 {running} 比本仓 {repo} 新；继续复用它")
        return info
    state = _http("GET", f"{endpoint}/v1/state", None, {"x-malo-broker-token": token})
    busy = state.get("leases") or []
    if busy:
        agents = ", ".join(sorted({str(lease.get("agent_id")) for lease in busy}))
        raise MaloError(
            f"运行中的 malo daemon 版本 {running} 落后于本仓 {repo}，但还有 {len(busy)} 个租约在用"
            f"（agent: {agents}），不自动重启。等它们结束，或确认可停后执行：kill -TERM {info.get('pid')}")
    pid = info.get("pid")
    if not isinstance(pid, int) or pid <= 0:
        raise MaloError(f"broker.json 的 pid 无效（{pid!r}），无法重启旧版本 daemon：{info}")
    _log(f"运行中的 malo daemon 版本 {running} 落后于本仓 {repo}，且没有租约在用：重启让新版本生效")
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        _require_debug_port_off(debug_port)
        return None
    deadline = time.time() + 15
    while time.time() < deadline and _pid_alive(pid):
        time.sleep(0.3)
    if _pid_alive(pid):
        # SIGTERM 没能收干净（没有租约，强杀不会丢任何人的会话）
        os.kill(pid, signal.SIGKILL)
        while _pid_alive(pid) and time.time() < deadline + 5:
            time.sleep(0.2)
    _require_debug_port_off(debug_port)
    return None


def _require_debug_port_off(debug_port: int | None) -> None:
    if debug_port is not None and _port_open(f"http://127.0.0.1:{debug_port}"):
        raise MaloError(
            f"旧 daemon 已停，但 CDP 调试口 {debug_port} 仍被占用。确认占用者："
            f"lsof -nP -iTCP:{debug_port} -sTCP:LISTEN")


def ensure_daemon(wait_s: float = 60.0, log_path: Path | None = None,
                  debug_port: int | None = None, broker_file: Path | str | None = None,
                  daemon_args: list[str] | None = None, restart_stale: bool = True) -> dict:
    """broker 就绪（健康复用/死了拉起/版本落后且空闲就重启）→ 返回 broker.json 内容（endpoint/token）。

    多个进程同时发现 daemon 不在时，只由拿到启动锁的那个拉起，其余等它就绪后复用。
    就绪的判据是「broker.json 的 token 被运行中的 daemon 认」，不是端口开着。
    debug_port：要求 daemon 带 CDP 调试口跑（没有鉴权，见 _warn_debug_port）。daemon 活着但没带口时
    fail-loud（登录态在运行中的进程里，不静默杀进程重启——由调用方处置）。
    daemon_args / 环境变量 MALO_DAEMON_ARGS：冷启动时追加给 daemon 的参数（如 --proxy-server=...）；
    daemon 已在运行时无法追加，这些参数不生效。
    """
    _warn_debug_port(debug_port)
    broker_path = Path(broker_file) if broker_file else BROKER_JSON
    log = Path(log_path) if log_path else broker_path.parent / "daemon.log"
    extra = _daemon_args(daemon_args)

    def spawn() -> None:
        _spawn_daemon(broker_path, log, debug_port, extra)

    with _start_lock(broker_path):
        info = _read_broker_json(broker_path)
        endpoint = info.get("endpoint") or DEFAULT_BROKER_ENDPOINT
        if info.get("token") and _port_open(endpoint):
            if not _token_accepted(info):
                raise MaloError(
                    f"{endpoint} 上的进程不认 {broker_path} 里的 token（文件与运行中的 daemon 不一致），"
                    f"不拉起也不复用。确认端口上是谁：lsof -nP -iTCP:{_broker_port(endpoint)} -sTCP:LISTEN")
            _require_debug_port(info, debug_port)
            if not restart_stale:
                return info
            kept = _refresh_if_stale(info, debug_port)
            if kept is not None:
                return kept
        if not info.get("token") and _port_open(endpoint):
            raise MaloError(
                f"{endpoint} 有进程在监听，但 {broker_path} 里没有 broker token"
                f"（不是 malo daemon，或文件损坏），不拉起也不复用。"
                f"确认端口上是谁：lsof -nP -iTCP:{_broker_port(endpoint)} -sTCP:LISTEN")
        _log(f"daemon 不在（{endpoint}），后台拉起（{MALO_REPO}）")
        return _wait_ready(broker_path, wait_s, debug_port, log, spawn)


def acquire_lease(agent_id: str, required_tools: tuple[str, ...] = BASE_REQUIRED_TOOLS,
                  log_path: Path | None = None,
                  required_features: tuple[str, ...] = BASE_REQUIRED_FEATURES,
                  debug_port: int | None = None, broker_file: Path | str | None = None,
                  daemon_args: list[str] | None = None, heartbeat: bool = True) -> "MaloLease":
    """ensure daemon → 租约 → capabilities 校验。

    租约按「agent_id + 本进程持有者」发：同一进程里重复申请复用同一租约；不同进程
    即使同名也各拿各的，谁的 close/release 都不会放掉并行兄弟的会话。
    默认起一条后台线程按租约 TTL 的三分之一续租：agent 想事情再久、人登录再慢，租约也不会
    因为「没发请求」过期；release() 时线程随之停止。
    """
    broker = ensure_daemon(log_path=log_path, debug_port=debug_port, broker_file=broker_file,
                           daemon_args=daemon_args)
    endpoint = broker.get("endpoint") or DEFAULT_BROKER_ENDPOINT
    token = broker.get("token")
    if not token:
        raise MaloError(f"{broker_file or BROKER_JSON} 缺 token（daemon 端点 {endpoint}），无法租约")
    with _ACQUIRE_LOCK:
        lease = _http("POST", f"{endpoint}/v1/leases",
                      {"agent_id": agent_id, "holder": _holder()},
                      {"x-malo-broker-token": token})
        ml = MaloLease(endpoint=lease["endpoint"], token=lease["token"],
                       lease_id=lease["lease_id"], agent_id=agent_id,
                       broker_endpoint=endpoint, broker_token=token,
                       features=tuple(lease.get("features") or ()),
                       ttl_seconds=lease.get("ttl_seconds"))
        try:
            ml.check_capabilities(required_tools, required_features)
        except BaseException:
            ml.release()
            raise
        if heartbeat:
            ml.start_heartbeat()
    return ml


def import_profile_login(lease: "MaloLease", profile: str, cdp_url: str, domains: list[str],
                         session_cookie_ttl_days: int = 180) -> dict:
    """把源 Chromium（回环 CDP 端点）里指定域的 cookies 热导入 malo profile。

    domains 必填：只导入这些域（及其子域）的 cookie——不限定范围等于搬走源浏览器的全部登录态。
    返回 {cookies_total/cookies_matched/cookies_written/cookies_failed/...}；
    源连不上抛 MaloError(502 E_IMPORT_SOURCE_UNREACHABLE)，0 条命中抛 400。
    """
    if not domains or any(not isinstance(d, str) or not d.strip() for d in domains):
        raise ValueError("domains 必填：要导入的域，非空字符串列表，如 ['example.com']")
    body: dict = {"cdp_url": cdp_url, "domains": [d.strip() for d in domains],
                  "session_cookie_ttl_days": session_cookie_ttl_days}
    return lease._post(f"/v1/profiles/{profile}/import", body)


def _default_call_timeout(tool: str, payload: dict | None) -> float:
    """客户端等待时长不能短于 daemon 侧同一操作的最长等待，否则人还在登录客户端先超时。"""
    payload = payload or {}
    if tool == "login":
        mode = payload.get("mode", "auto")
        daemon_wait = payload.get("timeout_ms", 180_000 if mode == "watch" else 30_000)
        return max(30, float(daemon_wait) / 1000 + 30)
    if tool == "run_steps":
        steps = payload.get("steps") or []
        total = 0.0
        for step in steps:
            if not isinstance(step, dict):
                continue
            if step.get("type") == "sleep":
                total += max(0, float(step.get("ms", 0))) / 1000
            elif step.get("type") in ("wait_for", "assert"):
                total += float(step.get("timeout_ms", 10_000 if step["type"] == "wait_for" else 5_000)) / 1000
            else:
                total += 15
        return min(3600, total + 30)
    return 120


def open_session(agent_id: str, url: str, profile: str | None = None,
                 debug_port: int | None = None,
                 required_tools: tuple[str, ...] = BASE_REQUIRED_TOOLS,
                 log_path: Path | None = None,
                 settle_ms: int = 3000,
                 width: int = 1440, height: int = 900,
                 broker_file: Path | str | None = None,
                 daemon_args: list[str] | None = None) -> tuple["MaloLease", "MaloSession"]:
    """一步到位：拉起 daemon → 租约 → profile 会话 → 导航到 url。

    返回 (lease, session)；调用方 finally 里 session.close() + lease.release()
    （登录态已沉淀 profile，收尾失败不影响）。导航结果 ok:false 时抛 MaloError。
    debug_port 显式传入时 daemon 才带 CDP 调试口跑，之后 Playwright 可
    connect_over_cdp("http://127.0.0.1:<debug_port>") 直连会话页；它没有鉴权。
    width/height 是会话视口（CSS 内容区，录制场景按 16:9 给）。
    """
    lease = acquire_lease(agent_id, required_tools=required_tools, log_path=log_path,
                          debug_port=debug_port, broker_file=broker_file, daemon_args=daemon_args)
    try:
        session = lease.new_session(f"{profile or 'anon'}-session", profile=profile,
                                    width=width, height=height)
        r = session.call("navigate", {"url": url, "timeout_ms": 45_000,
                                      "settle_ms": settle_ms})
        if isinstance(r, dict) and r.get("ok") is False:
            raise MaloError(f"malo 会话导航失败（{url}）：{str(r)[:300]}")
        return lease, session
    except BaseException:
        lease.release()
        raise


class MaloLease:
    """一个端口租约：心跳续租、session 生命周期、工具调用入口。"""

    def __init__(self, endpoint: str, token: str, lease_id: str, agent_id: str,
                 broker_endpoint: str, broker_token: str,
                 features: tuple[str, ...] = (), ttl_seconds: int | None = None):
        self.endpoint = endpoint          # lease 端口，如 http://127.0.0.1:7411
        self.token = token                # lease token
        self.lease_id = lease_id
        self.agent_id = agent_id
        self.features = features          # daemon 握手带的能力清单
        self._headers = {"x-malo-lease-token": token}
        self._broker = (broker_endpoint, broker_token)
        self._interval = max(HEARTBEAT_MIN_INTERVAL_S, min(HEARTBEAT_MAX_INTERVAL_S, float(ttl_seconds or 300) / 3))
        self._hb_stop = threading.Event()
        self._hb_thread: threading.Thread | None = None
        self.heartbeat_error: MaloError | None = None

    def check_capabilities(self, required: tuple[str, ...] = BASE_REQUIRED_TOOLS,
                           required_features: tuple[str, ...] = BASE_REQUIRED_FEATURES) -> None:
        names = {t.get("name") for t in self._get("/v1/tools").get("tools", [])}
        missing = [t for t in required if t not in names]
        if missing:
            raise MaloError(f"运行中的 malo daemon 缺工具 {missing}（版本过旧），"
                            f"需升级 {MALO_REPO} 并重启 daemon")
        lacking = [f for f in required_features if f not in self.features]
        if lacking:
            raise MaloError(f"运行中的 malo daemon 缺能力 {lacking}（版本过旧），"
                            f"需升级 {MALO_REPO} 并重启 daemon")

    def heartbeat(self) -> None:
        # 心跳/释放都是 broker 路由（lease 端口只挂 session 工具）
        be, bt = self._broker
        _http("POST", f"{be}/v1/leases/{self.lease_id}/heartbeat",
              None, {"x-malo-broker-token": bt}, timeout=10)

    def start_heartbeat(self) -> None:
        """起后台续租线程（幂等）。心跳一旦失败就停：租约多半已被回收，之后的调用会带着这条原因失败。"""
        if self._hb_thread is not None:
            return
        self._hb_thread = threading.Thread(
            target=self._heartbeat_loop, name="malo-lease-heartbeat", daemon=True)
        self._hb_thread.start()

    def _heartbeat_loop(self) -> None:
        while not self._hb_stop.wait(self._interval):
            try:
                self.heartbeat()
            except MaloError as error:
                self.heartbeat_error = error
                _log(f"租约 {self.lease_id} 心跳失败，停止续租：{error}")
                return

    def _ensure_usable(self) -> None:
        if self.heartbeat_error is not None:
            raise MaloError(f"租约 {self.lease_id} 已失效（心跳失败后未再续期）：{self.heartbeat_error}")

    def release(self) -> None:
        """停心跳并释放租约（幂等）。释放是 broker 路由；失败不抛，只喊出来。"""
        self._hb_stop.set()
        if self._hb_thread is not None:
            self._hb_thread.join(timeout=15)
            self._hb_thread = None
        be, bt = self._broker
        try:
            _http("DELETE", f"{be}/v1/leases/{self.lease_id}",
                  None, {"x-malo-broker-token": bt})
        except MaloError as e:  # 收尾清理性失败不掩盖主流程结果
            if "HTTP 404" in str(e):
                _log(f"租约 {self.lease_id} 已不在 daemon 里（多半已过期），无需释放")
            else:
                _log(f"⚠️ 租约释放失败（不影响本次产出）：{e}")

    def new_session(self, name: str, profile: str | None = None,
                    width: int = 1440, height: int = 900) -> "MaloSession":
        self._ensure_usable()
        body: dict = {"name": name, "width": width, "height": height}
        if profile:
            body["profile"] = profile
        r = self._post("/v1/sessions", body)
        return MaloSession(self, r["session_id"], r["session_token"])

    def _get(self, path: str) -> dict:
        self._ensure_usable()
        return _http("GET", f"{self.endpoint}{path}", None, self._headers)

    def _post(self, path: str, payload: dict, timeout: float = 30) -> dict:
        self._ensure_usable()
        return _http("POST", f"{self.endpoint}{path}", payload, self._headers, timeout=timeout)

    def __enter__(self) -> "MaloLease":
        return self

    def __exit__(self, *exc) -> None:
        self.release()


class MaloSession:
    """一个浏览 session（同名 profile 跨 session 复用 cookies/登录态）。"""

    def __init__(self, lease: MaloLease, session_id: str, session_token: str):
        self.lease = lease
        self.id = session_id
        self._headers = {**lease._headers, "x-malo-session-token": session_token}

    def call(self, tool: str, payload: dict | None = None,
             timeout: float | None = None) -> dict:
        """调 session 工具 → result 字段；HTTP 层失败抛 MaloError。

        注意：业务失败（如 assert 不成立）是 HTTP 200 + result.ok=false，
        由调用方读语义，本层不吞不判。
        timeout 不传时按工具在 daemon 侧的最长等待推算（login、run_steps 会比默认长）。
        """
        wait = _default_call_timeout(tool, payload) if timeout is None else timeout
        r = _http("POST", f"{self.lease.endpoint}/v1/sessions/{self.id}/tools/{tool}",
                  payload or {}, self._headers, timeout=wait)
        return r.get("result", r)

    def close(self) -> None:
        try:
            self.call("close")
        except MaloError as e:
            _log(f"⚠️ session 关闭失败（登录态已在 profile，不影响）：{e}")

    def __enter__(self) -> "MaloSession":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
