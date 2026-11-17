"""session-stats CDP 注入器（不依赖 app.asar 补丁）。

ZCode 以 --remote-debugging-port=<port> 启动后，本模块轮询 DevTools 的 /json 列表，
发现页面目标就连 WebSocket，用 Page.addScriptToEvaluateOnNewDocument 把 pills-loader
注册到「此后每个新文档」，再用 Runtime.evaluate 注入当前文档。loader 幂等
（window.__SSPILLS_LOADER__ 挡重复），统计条因此随窗口出现 ~2 秒内生效，
ZCode 更新与否完全无关。

仅依赖 Python 标准库（内置最小 WebSocket 客户端，无第三方包）。
"""
import base64
import json
import os
import socket
import struct
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOADER_PATH = HERE / "pills-loader.js"
CDP_PORT = int(os.environ.get("ZCODE_STATS_CDP_PORT", "9223"))
POLL_SECONDS = 2.0

_log_fn = None


def _log(msg):
    if _log_fn:
        _log_fn(msg)


# --------------------------------------------------------------- 最小 WS 客户端
class _WS:
    """够用的 RFC6455 文本帧客户端：握手、发收 JSON、8s 超时。"""

    def __init__(self, url: str, timeout: float = 8.0):
        # url 形如 ws://127.0.0.1:9223/devtools/page/<id>
        assert url.startswith("ws://"), url
        rest = url[len("ws://"):]
        hostport, path = rest.split("/", 1)
        self.host, self.port = hostport.split(":")
        self.path = "/" + path
        self.sock = socket.create_connection((self.host, int(self.port)), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {hostport}\r\n"
            "Upgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("WS 握手中断")
            buf += chunk
        head, _, tail = buf.partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise ConnectionError("WS 握手被拒: " + head.split(b"\r\n")[0].decode(errors="replace"))
        self._buf = bytearray(tail)

    def _read_exact(self, n: int) -> bytes:
        while len(self._buf) < n:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("WS 读中断")
            self._buf += chunk
        out = bytes(self._buf[:n])
        del self._buf[:n]
        return out

    def send_text(self, text: str) -> None:
        payload = text.encode("utf-8")
        mask = os.urandom(4)
        header = bytearray([0x81])  # FIN + text
        n = len(payload)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def recv_text(self) -> str:
        while True:
            b1, b2 = self._read_exact(2)
            opcode = b1 & 0x0F
            masked = b2 & 0x80
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read_exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read_exact(8))[0]
            mask = self._read_exact(4) if masked else b""
            payload = self._read_exact(n)
            if masked:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x1:  # text
                return payload.decode("utf-8", "replace")
            if opcode == 0x9:  # ping → pong
                pong = bytearray([0x8A, 0x80 | len(payload)]) + os.urandom(4)
                pong += bytes(len(payload))
                self.sock.sendall(bytes(pong))
                continue
            if opcode == 0x8:  # close
                raise ConnectionError("WS 被对端关闭")

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


def _cdp_call(ws: _WS, method: str, params: dict | None, msg_id: int) -> None:
    msg = {"id": msg_id, "method": method}
    if params:
        msg["params"] = params
    ws.send_text(json.dumps(msg))


def _targets(port: int) -> list[dict]:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=3) as r:
        return json.loads(r.read().decode("utf-8"))


def inject_target(ws_url: str, loader_source: str) -> bool:
    """对一个页面目标执行注入；返回是否成功。"""
    ws = None
    try:
        ws = _WS(ws_url)
        _cdp_call(ws, "Page.enable", None, 1)
        _cdp_call(ws, "Page.addScriptToEvaluateOnNewDocument", {"source": loader_source}, 2)
        # 实例已死（页面被宿主重置过）→ 清掉 loader 守卫，让下面的 loader 重新拉起 pills
        _cdp_call(ws, "Runtime.evaluate",
                  {"expression": "if(!window.__SSPILLS__){window.__SSPILLS_LOADER__=false;}"}, 3)
        _cdp_call(ws, "Runtime.evaluate", {"expression": loader_source}, 4)
        deadline = time.time() + 8
        seen = set()
        while len(seen) < 4 and time.time() < deadline:
            data = json.loads(ws.recv_text())
            if "id" in data:
                seen.add(data["id"])
                if "error" in data:
                    _log(f"CDP {data['id']} 错误: {data['error'].get('message', '')[:80]}")
        return len(seen) >= 3
    except Exception as e:  # noqa: BLE001
        _log(f"注入 {ws_url[-16:]} 失败: {e!r}")
        return False
    finally:
        if ws:
            ws.close()


def read_loader() -> str:
    return LOADER_PATH.read_text(encoding="utf-8")


def inject_once(port: int = CDP_PORT, only_file: bool = True) -> int:
    """扫一遍当前所有页面目标并注入；返回成功数（ZCode 未开/无端口则 0）。"""
    try:
        targets = _targets(port)
    except Exception:
        return 0
    loader = read_loader()
    ok = 0
    for t in targets:
        if t.get("type") != "page":
            continue
        if only_file and not str(t.get("url", "")).startswith("file://"):
            continue
        if inject_target(t["webSocketDebuggerUrl"], loader):
            ok += 1
    return ok


def _maybe_repatch(log) -> None:
    """ZCode 已退出且 asar 丢补丁 → 立即重打（带锁防并发）。

    这是「不依赖启动入口」的主路：一旦重打成功，之后任何方式启动 ZCode 都有统计条。
    更新器换包期间 ZCode 会完全退出 1~2 分钟，2 秒级轮询能直接抓到这个窗口。
    """
    try:
        import watch_update as w
    except Exception:
        return
    if w.zcode_running():
        return
    rd = w.resources_dir()
    if not rd or w.asar_has_marker(rd / "app.asar"):
        return
    lock = HERE / "patch.lock"
    try:
        if lock.exists() and (time.time() - lock.stat().st_mtime) < 1200:
            return  # 另一个重打进行中/刚失败，交给下一轮
        lock.write_text(str(os.getpid()), encoding="utf-8")
    except OSError:
        return
    try:
        log("检测到 asar 无补丁且 ZCode 已退出 → 立即重打")
        w.run_patcher()
    finally:
        try:
            lock.unlink()
        except OSError:
            pass


def start_injector(log=lambda m: None) -> None:
    """常驻线程：端口出现页面就注入；ZCode 退出且丢补丁就立刻重打。"""
    global _log_fn
    _log_fn = log
    import threading

    state = {"last_patch_check": 0.0}

    def loop():
        while True:
            try:
                n = inject_once()
                if n:
                    _log(f"CDP 注入 {n} 个页面")
                now = time.time()
                # 每 ~6 秒检查一次「退出且丢补丁」；重打本身要几十秒，不必更频
                if now - state["last_patch_check"] >= 6:
                    state["last_patch_check"] = now
                    _maybe_repatch(_log)
                time.sleep(10 if n else POLL_SECONDS)
            except BaseException as e:  # noqa: BLE001
                _log(f"注入线程异常: {e!r}")
                time.sleep(5)

    threading.Thread(target=loop, name="ss-cdp-injector", daemon=True).start()


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "loop":
        start_injector(log=lambda m: print(time.strftime("%H:%M:%S "), m, flush=True))
        while True:
            time.sleep(3600)
    else:
        port = int(sys.argv[1]) if len(sys.argv) > 1 else CDP_PORT
        print("injected pages:", inject_once(port))
