"""session-stats 补丁守望（ZCode 更新不受影响的关键件）。

ZCode 自动更新会整包替换 app.asar，注入的 loader 随之丢失。本模块随常驻数据服务
在后台每分钟检查一次：发现「asar 已无补丁标记 且 ZCode 已完全退出」时，静默调用
部署在 %LOCALAPPDATA%\\session-stats\\patcher\\ 的 patch.mjs 重打补丁。

- ZCode 运行中：什么都不做（打不了，也不打扰）
- asar 有标记：什么都不做
- 重打全程写 watcher.log；也可独立运行：pythonw watch_update.py
"""
import ctypes
import json
import os
import subprocess
import threading
import time
from pathlib import Path

SVC_DIR = Path(__file__).resolve().parent
PATCHER = SVC_DIR / "patcher" / "patch.mjs"
INSTALL_INFO = SVC_DIR / "install.json"
LOG_FILE = SVC_DIR / "watcher.log"
CHECK_INTERVAL = 15          # 秒（ZCode 运行时只查进程，很便宜；关闭时才会读 asar 头）
HEAD_BYTES = 8 * 1024 * 1024  # asar 头部含全部文件名，8MB 足够覆盖
MARKER = b"session-stats-pills"

_psapi = ctypes.WinDLL("psapi")
_kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)


def _log(msg):
    try:
        line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n"
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line)
        if LOG_FILE.stat().st_size > 256 * 1024:  # 防无限增长：留后半
            text = LOG_FILE.read_text(encoding="utf-8", errors="replace")
            LOG_FILE.write_text(text[-128 * 1024:], encoding="utf-8")
    except Exception:
        pass


def zcode_running():
    """枚举进程查 ZCode.exe；查询失败按「在运行」处理（宁可不打，不可打坏）。"""
    try:
        buf = (ctypes.c_ulong * 2048)()
        needed = ctypes.c_ulong()
        if not _psapi.EnumProcesses(buf, ctypes.sizeof(buf), ctypes.byref(needed)):
            return True
        for i in range(needed.value // ctypes.sizeof(ctypes.c_ulong)):
            pid = buf[i]
            if not pid:
                continue
            h = _kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
            if not h:
                continue
            try:
                name = ctypes.create_unicode_buffer(512)
                n = ctypes.c_ulong(512)
                if _kernel32.QueryFullProcessImageNameW(h, 0, name, ctypes.byref(n)):
                    if str(name.value).lower().endswith("\\zcode.exe"):
                        return True
            finally:
                _kernel32.CloseHandle(h)
        return False
    except Exception:
        return True


def resources_dir():
    """定位 ZCode 的 resources 目录：优先 apply 时记录的 install.json，
    其次环境变量与常见安装位置（与 patch.mjs 的解析保持一致的方向）。"""
    try:
        info = json.loads(INSTALL_INFO.read_text(encoding="utf-8"))
        p = Path(info.get("resources") or "")
        if (p / "app.asar").exists():
            return p
    except Exception:
        pass
    cands = []
    env = os.environ.get("ZCODE_RESOURCES_DIR")
    if env:
        cands.append(Path(env))
    la = os.environ.get("LOCALAPPDATA")
    if la:
        cands.append(Path(la) / "Programs" / "ZCode" / "resources")
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    cands.append(Path(pf) / "ZCode" / "resources")
    for c in cands:
        if (c / "app.asar").exists():
            return c
    return None


def asar_has_marker(asar_path):
    """asar 头部 JSON 里出现补丁标记文件名即视为已打补丁。"""
    try:
        with open(asar_path, "rb") as f:
            head = f.read(HEAD_BYTES)
        return MARKER in head
    except OSError:
        return False


def _probe():
    """running（ZCode 在跑）/ patched（无需处理）/ missing（需要重打）/ unknown。"""
    if zcode_running():
        return "running"
    rd = resources_dir()
    if not rd:
        return "unknown"
    return "patched" if asar_has_marker(rd / "app.asar") else "missing"


def run_patcher():
    if not PATCHER.exists():
        _log("patcher 缺失: %s（重新运行一次 apply-patch.cmd 可修复部署）" % PATCHER)
        return
    try:
        r = subprocess.run(
            ["node", str(PATCHER), "apply"],
            cwd=str(PATCHER.parent), capture_output=True,
            encoding="utf-8", errors="replace",  # patch.mjs 输出 UTF-8，默认 GBK 解码会炸
            timeout=900, creationflags=0x08000000,  # CREATE_NO_WINDOW
        )
        out = ((r.stdout or "") + "\n" + (r.stderr or "")).strip().splitlines()  # die() 走 stderr
        _log("重打补丁 exit=%s | %s" % (r.returncode, " / ".join(out[-3:]) or "(无输出)"))
    except FileNotFoundError:
        _log("未找到 node：PATH 里需要 Node.js 才能自动重打")
    except Exception as e:
        _log("重打异常: %r" % (e,))


def _loop():
    last = None
    while True:
        try:
            state = _probe()
            if state != last:
                _log("状态: %s" % state)
                last = state
            if state == "missing":
                run_patcher()
                last = None  # 让下一轮重新记录结果
        except BaseException as e:  # 线程级兜底：任何异常都不许杀死守望
            _log("轮询异常: %r" % (e,))
        time.sleep(CHECK_INTERVAL)


def start_watcher():
    t = threading.Thread(target=_loop, name="ss-patch-watcher", daemon=True)
    t.start()
    return t


if __name__ == "__main__":
    _log("watch_update 独立运行")
    start_watcher()
    while True:
        time.sleep(3600)
