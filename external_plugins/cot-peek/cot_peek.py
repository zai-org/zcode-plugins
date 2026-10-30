# -*- coding: utf-8 -*-
"""思考小窗 · ZCode —— 思维链翻译悬浮球

形态：屏幕右侧一枚圆形小球（无矩形底框），点击展开翻译窗，再点收起。
通道：
  1. 思考流翻译：监听 ~/.zcode/cli/rollout/model-io-session_*.jsonl
     （ReadDirectoryChangesW 目录事件 + 5s 兜底扫描），每次 API 往返完成
     追加的 response.reasoningText 逐轮翻成中文。
     点标题「思考流翻译」回溯翻译之前的思考；「暂停/继续」随时中断。
  2. 划词翻译：展开状态下复制英文，约 1 秒出中文。
翻译：火山 web 接口（主）→ cn.bing.com → MyMemory，
按行分块（≤900 字），代码围栏/URL/术语占位保护。
生命周期：×只关窗口收起回小球（收起=暂停）；小球右键「退出小窗」后，
本次 ZCode 会话内不再被计划任务拉起；ZCode 根进程退出即感知、小窗跟随退出
（OpenProcess+WaitForSingleObject，零轮询开销）；
--autospawn 供计划任务拉起（ZCode 未运行则直接退出）。
纯标准库 + tkinter，只读 ZCode 文件/进程快照，不做任何注入。
"""
import argparse
import base64
import ctypes
import ctypes.wintypes as wt
import glob
import http.client
import http.cookiejar
import itertools
import json
import math
import os
import queue
import re
import struct
import subprocess
import threading
import time
import tkinter as tk
import tkinter.ttk as ttk
import urllib.parse
import urllib.request
import zlib
from collections import OrderedDict

try:  # 先于 Tk 创建开启，避免整窗被系统位图拉伸发糊
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

CREATE_NO_WINDOW = 0x08000000
DEFAULT_ROLLOUT = os.path.expanduser("~/.zcode/cli/rollout")
HERE = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(HERE, "cot_peek.log")
CFG_PATH = os.path.join(HERE, "cot_peek.json")
LOCK_PATH = os.path.join(HERE, "cot_peek.lock")

BG = "#1f1f1f"
PANEL = "#252526"
BALL_BG = "#2d2d2d"
BALL_RIM = "#5a5a5a"
TRANSPARENT_KEY = "#0b0c0d"   # 小球窗口的 key 色，会被 -transparentcolor 抠掉
FG = "#d4d4d4"
DIM = "#808080"
LINE = "#3c3c3c"
FAIL = "#f48771"
FONT = ("Microsoft YaHei UI", 10)
FONT_S = ("Microsoft YaHei UI", 9)
FONT_S_ON = ("Microsoft YaHei UI", 9, "underline")   # 激活标签


def _hex_rgb(h):
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _png_b64(w, h, rows):
    """最小 PNG 编码（8bit RGB、无滤波），交给 Tk 的 PhotoImage 解码。"""
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    return base64.b64encode(png).decode("ascii")


def _circle_image(d, fill, rim, key, master):
    """画一个抗锯齿圆：圆外像素正好等于 key 色（供 -transparentcolor 抠掉），
    边缘按覆盖率在 rim→key 之间过渡，形成 1px 柔和描边而非锯齿。"""
    fr, fg_, fb = _hex_rgb(fill)
    rr, rg, rb = _hex_rgb(rim)
    kr, kg, kb = _hex_rgb(key)
    R = d / 2.0 - 0.7
    c = d / 2.0
    SS = 4
    rows = []
    for y in range(d):
        row = bytearray()
        for x in range(d):
            inside = 0
            for sy in range(SS):
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS - c
                    py = y + (sy + 0.5) / SS - c
                    if px * px + py * py <= R * R:
                        inside += 1
            cov = inside / (SS * SS)
            if cov <= 0.0:
                row += bytes((kr, kg, kb))
                continue
            dist = math.hypot(x + 0.5 - c, y + 0.5 - c)
            t = min(1.0, max(0.0, (R - dist) / 2.0))    # 0=最外圈 1=内部
            ir = rr + (fr - rr) * t
            ig = rg + (fg_ - rg) * t
            ib = rb + (fb - rb) * t
            row += bytes((int(kr + (ir - kr) * cov),
                          int(kg + (ig - kg) * cov),
                          int(kb + (ib - kb) * cov)))
        rows.append(bytes(row))
    return tk.PhotoImage(data=_png_b64(d, d, rows), master=master)


def log(msg):
    try:
        if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 100_000:
            os.remove(LOG_PATH)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(time.strftime("[%H:%M:%S] ") + str(msg) + "\n")
    except OSError:
        pass

# ---------------------------------------------------------------- ZCode 进程检测
# 进程内快照，不起子进程：NtQuerySystemInformation(4.3ms) → Toolhelp(7ms) →
# tasklist(405ms) 三级降级。ZCode 是 Electron，同名的 ZCode.exe 常有二三十个，
# 只有「父进程不是 ZCode.exe」的那个是根进程，用它做会话签名与退出等待。

_SYSTEM_PROCESS_INFORMATION = 5
_STATUS_INFO_LENGTH_MISMATCH = 0xC0000004


class _UNICODE_STRING(ctypes.Structure):
    _fields_ = [("Length", wt.USHORT), ("MaximumLength", wt.USHORT),
                ("Buffer", ctypes.c_void_p)]


class _SPI(ctypes.Structure):
    """SYSTEM_PROCESS_INFORMATION 的前半段（够取 pid/ppid/name）。"""
    _fields_ = [
        ("NextEntryOffset", wt.ULONG), ("ThreadCount", wt.ULONG),
        ("WorkingSetPrivateSize", ctypes.c_ulonglong), ("HardFaultCount", wt.ULONG),
        ("NumberOfThreadsHighWatermark", wt.ULONG), ("CycleTime", ctypes.c_ulonglong),
        ("CreateTime", ctypes.c_longlong), ("UserTime", ctypes.c_longlong),
        ("KernelTime", ctypes.c_longlong), ("ImageName", _UNICODE_STRING),
        ("BasePriority", ctypes.c_long), ("UniqueProcessId", ctypes.c_void_p),
        ("InheritedFromUniqueProcessId", ctypes.c_void_p),
    ]


class _PE32W(ctypes.Structure):
    _fields_ = [("dwSize", wt.DWORD), ("cntUsage", wt.DWORD),
                ("th32ProcessID", wt.DWORD), ("th32DefaultHeapID", ctypes.c_void_p),
                ("th32ModuleID", wt.DWORD), ("cntThreads", wt.DWORD),
                ("th32ParentProcessID", wt.DWORD), ("pcPriClassBase", ctypes.c_long),
                ("dwFlags", wt.DWORD), ("szExeFile", ctypes.c_wchar * 260)]


_proc_api = None


def _api():
    """惰性绑定 win32 函数原型（只在进程内快照路径用到）。"""
    global _proc_api
    if _proc_api is not None:
        return _proc_api
    ntdll = ctypes.WinDLL("ntdll")
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    ntdll.NtQuerySystemInformation.argtypes = [wt.ULONG, ctypes.c_void_p,
                                               wt.ULONG, ctypes.POINTER(wt.ULONG)]
    ntdll.NtQuerySystemInformation.restype = ctypes.c_long
    k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
    k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
    k32.Process32FirstW.argtypes = [wt.HANDLE, ctypes.c_void_p]
    k32.Process32NextW.argtypes = [wt.HANDLE, ctypes.c_void_p]
    k32.CloseHandle.argtypes = [wt.HANDLE]
    k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    k32.OpenProcess.restype = wt.HANDLE
    k32.WaitForSingleObject.argtypes = [wt.HANDLE, wt.DWORD]
    k32.WaitForSingleObject.restype = wt.DWORD
    _proc_api = (ntdll, k32)
    return _proc_api


def _procs_ntquery():
    ntdll, _ = _api()
    size = 1 << 20
    for _ in range(4):
        buf = ctypes.create_string_buffer(size)
        ret = wt.ULONG(0)
        st = ntdll.NtQuerySystemInformation(_SYSTEM_PROCESS_INFORMATION, buf, size,
                                            ctypes.byref(ret))
        if st == _STATUS_INFO_LENGTH_MISMATCH:
            size = ret.value + 65536
            continue
        if st != 0:
            return None
        out, addr = [], ctypes.addressof(buf)
        while True:
            spi = _SPI.from_address(addr)
            name = ""
            if spi.ImageName.Buffer and spi.ImageName.Length:
                name = ctypes.wstring_at(spi.ImageName.Buffer,
                                         spi.ImageName.Length // 2)
            out.append((int(spi.UniqueProcessId or 0), name,
                        int(spi.InheritedFromUniqueProcessId or 0)))
            if not spi.NextEntryOffset:
                return out
            addr += spi.NextEntryOffset
    return None


def _procs_toolhelp():
    _, k32 = _api()
    h = k32.CreateToolhelp32Snapshot(0x2, 0)   # TH32CS_SNAPPROCESS
    if not h or h == ctypes.c_void_p(-1).value:
        return None
    out = []
    try:
        pe = _PE32W()
        pe.dwSize = ctypes.sizeof(_PE32W)
        ok = k32.Process32FirstW(h, ctypes.byref(pe))
        while ok:
            out.append((pe.th32ProcessID, pe.szExeFile, pe.th32ParentProcessID))
            ok = k32.Process32NextW(h, ctypes.byref(pe))
    finally:
        k32.CloseHandle(h)
    return out


def _procs_tasklist():
    _, k32 = _api()
    try:
        r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq ZCode.exe",
                            "/FO", "CSV", "/NH"],
                           capture_output=True, timeout=10,
                           creationflags=CREATE_NO_WINDOW)
        text = r.stdout.decode("gbk", "replace")
        pids = []
        for row in text.splitlines():
            parts = [p.strip('"') for p in row.split('","')]
            if parts and parts[0].lower() == "zcode.exe" and len(parts) > 1 \
                    and parts[1].isdigit():
                pids.append(int(parts[1]))
        return [(p, "ZCode.exe", 0) for p in pids]
    except (OSError, subprocess.SubprocessError):
        return None


def _snapshot():
    for fn in (_procs_ntquery, _procs_toolhelp, _procs_tasklist):
        try:
            procs = fn()
        except OSError:
            procs = None
        if procs is not None:
            return procs
    return []


def zcode_pids():
    """全部 ZCode.exe 的 PID 列表（快照里没有则为空）。"""
    return [p[0] for p in _snapshot() if p[1].lower() == "zcode.exe"]


def zcode_root_pid(procs=None):
    """根进程 PID：父进程不是 ZCode.exe 的那个（回退到最小 PID）。"""
    procs = _snapshot() if procs is None else procs
    ids = {p[0] for p in procs if p[1].lower() == "zcode.exe"}
    if not ids:
        return None
    roots = [p[0] for p in procs
             if p[1].lower() == "zcode.exe" and p[2] not in ids]
    return min(roots) if roots else min(ids)


def zcode_procs():
    """返回 (是否在运行, 会话签名=根进程PID)。"""
    procs = _snapshot()
    root = zcode_root_pid(procs)
    return (root is not None, root)


def read_lock():
    try:
        with open(LOCK_PATH, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None

def write_lock(obj):
    try:
        with open(LOCK_PATH, "w", encoding="utf-8") as f:
            json.dump(obj, f)
    except OSError:
        pass

# ---------------------------------------------------------------- 基础工具

CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")
LATIN_RE = re.compile(r"[A-Za-z]")

def cjk_ratio(text):
    return len(CJK_RE.findall(text)) / max(1, len(text))

def chunk_text(text, cap=900):
    """块内兜底切分：优先 行/句末/空格 切，避开占位符中间。"""
    parts = [p for p in re.split(r"(?<=[.!?。！？])\s+|\n", text) if p.strip()]
    chunks, buf = [], ""
    for p in parts:
        buf = buf + "\n" + p if buf else p
        if len(buf) >= cap:
            chunks.append(buf)
            buf = ""
    if buf.strip():
        chunks.append(buf)
    fixed = []
    for c in chunks:
        while len(c) > cap:
            cut = max(c.rfind("\n", 0, cap), c.rfind(" ", 0, cap), c.rfind("⟧", 0, cap))
            if cut <= 0:
                cut = cap
            fixed.append(c[:cut + 1])
            c = c[cut + 1:]
        fixed.append(c)
    return fixed

# ------------------------------------------------------- 术语/代码占位保护

KEEP_TERMS = [
    "ZCode", "MCP", "LLM", "API", "SDK", "CLI", "JSON", "YAML", "TOML",
    "HTTP", "HTTPS", "SSE", "URL", "UI", "UX", "DOM", "CSS", "HTML",
    "JavaScript", "TypeScript", "Node.js", "React", "Git", "GitHub", "npm",
    "Python", "tkinter", "Windows", "Linux", "PowerShell", "OpenAI",
    "Claude", "GLM", "Bing", "Google", "DeepL", "DeepSeek", "pytest",
    "Session", "Token", "Prompt", "Context", "Plugin", "Hook", "Tool",
    "Stream", "Markdown", "Agent", "TodoWrite", "AskUserQuestion",
]
TERM_RE = re.compile(r"\b(?:" + "|".join(re.escape(t) for t in KEEP_TERMS) + r")\b")
FENCE_RE = re.compile(r"```[\s\S]*?```")
INLINE_RE = re.compile(r"`[^`\n]+`")
URL_RE = re.compile(r"https?://[^\s)\]}>\"']+")
PATH_RE = re.compile(r"[\w./\\:+-]+\.(?:py|js|ts|json|md|txt|html?|css|ya?ml|toml|ps1|sh|bat|exe|dll|png|jpg|svg|db|sqlite|log|csv|ini)\b", re.I)
TOKEN_OPEN, TOKEN_CLOSE = "[[", "]]"   # 火山/Bing/MyMemory 都能原样保留
RESTORE_RE = re.compile(r"(?:\[\[|\u27E6|\u3010)\s*(\d+)\s*(?:\]\]|\u27E7|\u3011)")

def protect(text):
    tokens = []

    def hold(m):
        tokens.append(m.group(0))
        return f"{TOKEN_OPEN}{len(tokens)}{TOKEN_CLOSE}"

    out = FENCE_RE.sub(hold, text)
    out = INLINE_RE.sub(hold, out)
    out = URL_RE.sub(hold, out)
    out = PATH_RE.sub(hold, out)
    out = TERM_RE.sub(hold, out)
    return out, tokens

def restore(text, tokens):
    return RESTORE_RE.sub(lambda m: tokens[int(m.group(1)) - 1]
                          if 0 < int(m.group(1)) <= len(tokens) else m.group(0), text)

# ---------------------------------------------------------------- 翻译后端

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "Chrome/126.0 Safari/537.36")

class Interrupted(Exception):
    """暂停被触发，当前文本翻译中止。"""

class BingCN:
    """cn.bing.com 免费网页翻译。token 缓存 45 分钟；POST 走 keep-alive
    长连接（每线程一个实例）；单次请求上限约 900 字，超长自行切块。"""

    def __init__(self):
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.token = None
        self.token_time = 0.0
        self.conn = None

    def _refresh(self):
        req = urllib.request.Request(
            "https://cn.bing.com/translator",
            headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml",
                     "Accept-Language": "zh-CN,zh;q=0.9"})
        html = self.opener.open(req, timeout=10).read().decode("utf-8", "replace")
        ig = re.search(r'IG:"([^"]+)"', html)
        params = re.search(r'params_AbusePreventionHelper\s*=\s*\[([^\]]+)\]', html)
        iid = re.search(r'data-iid="([^"]+)"', html)
        if not (ig and params):
            raise RuntimeError("bing 页面结构变化")
        p = json.loads("[" + params.group(1) + "]")
        self.token = (str(p[0]), p[1], ig.group(1),
                      iid.group(1) if iid else "translator.5023")
        self.token_time = time.time()

    def _drop_conn(self):
        if self.conn is not None:
            try:
                self.conn.close()
            except OSError:
                pass
            self.conn = None

    def _post(self, path, body):
        if self.conn is None:
            self.conn = http.client.HTTPSConnection("cn.bing.com", timeout=15)
        try:
            self.conn.request("POST", path, body=body,
                              headers={"User-Agent": UA, "Accept": "*/*",
                                       "Referer": "https://cn.bing.com/translator",
                                       "Origin": "https://cn.bing.com",
                                       "Content-Type": "application/x-www-form-urlencoded",
                                       "Accept-Language": "zh-CN,zh;q=0.9"})
            resp = self.conn.getresponse()
            raw = resp.read().decode("utf-8", "replace")
            if resp.status != 200:
                raise RuntimeError(f"http {resp.status}")
            return raw
        except Exception:
            self._drop_conn()
            raise

    def translate(self, text):
        if not self.token or time.time() - self.token_time > 2700:
            self._refresh()
        last = ""
        for _ in range(2):
            key, token, ig, iid = self.token
            body = urllib.parse.urlencode(
                {"fromLang": "en", "text": text[:900], "to": "zh-Hans",
                 "token": token, "key": key})
            try:
                raw = self._post(f"/ttranslatev3?IG={ig}&IID={iid}", body)
                out = json.loads(raw)
                if isinstance(out, list) and out and "translations" in out[0]:
                    t = out[0]["translations"][0]["text"]
                    if t.strip():
                        return t
                last = json.dumps(out, ensure_ascii=False)[:100]
            except (ValueError, IndexError, OSError, RuntimeError) as e:
                last = f"{type(e).__name__}: {str(e)[:60]}"
            self._refresh()
        raise RuntimeError("bing: " + last)

class Volc:
    """火山翻译免密 web 接口：约 0.2~0.8s/次，单请求约 4000 字上限，
    无需 key/cookie。500 为瞬态错误，重试一次。"""

    URL = "https://translate.volcengine.com/crx/translate/v1/"

    def translate(self, text):
        data = json.dumps({"source_language": "en", "text": text[:4000],
                           "target_language": "zh"}).encode()
        last = ""
        for attempt in (1, 2):
            try:
                req = urllib.request.Request(
                    self.URL, data=data,
                    headers={"User-Agent": UA, "Content-Type": "application/json"})
                raw = urllib.request.urlopen(req, timeout=10).read().decode("utf-8", "replace")
                out = json.loads(raw)
                t = out.get("translation") or ""
                if t.strip():
                    return t
                last = "空译文 " + json.dumps(out, ensure_ascii=False)[:80]
            except Exception as e:
                last = f"{type(e).__name__}: {str(e)[:60]}"
            if attempt == 1:
                time.sleep(0.4)
        raise RuntimeError("volc: " + last)

class MyMem:
    def __init__(self):
        self.opener = urllib.request.build_opener()

    def translate(self, text):
        q = urllib.parse.quote(text[:480])
        req = urllib.request.Request(
            f"https://api.mymemory.translated.net/get?q={q}&langpair=en|zh-CN",
            headers={"User-Agent": UA})
        out = json.loads(self.opener.open(req, timeout=10).read().decode("utf-8", "replace"))
        if out.get("responseStatus") == 200 and out.get("responseData"):
            return out["responseData"]["translatedText"]
        raise RuntimeError("mymem: " + json.dumps(out, ensure_ascii=False)[:100])

def make_blocks(text, cap=900):
    """按行组装成 ≤cap 字的块。无字母行/短行/中文行/代码围栏原样保留。"""
    blocks = []
    buf, blen = [], 0
    in_fence = False

    def flush():
        nonlocal buf, blen
        if buf:
            blocks.append(("\n".join(buf), False))
            buf, blen = [], 0

    for ln in text.split("\n"):
        s = ln.strip()
        if s.startswith("```"):
            flush()
            blocks.append((ln, True))
            in_fence = not in_fence
            continue
        if in_fence:
            flush()
            blocks.append((ln, True))
            continue
        if len(s) < 2 or not LATIN_RE.search(s) or cjk_ratio(s) > 0.4:
            flush()
            blocks.append((ln, True))
            continue
        if blen + len(ln) + 1 > cap and buf:
            flush()
        buf.append(ln)
        blen += len(ln) + 1
    flush()
    return blocks

def translate_any(text, translators, pause=None):
    """分块保护翻译：按 translators 顺序尝试（火山→Bing→MyMemory）；
    pause 置位时在块边界中止。返回 (译文, 失败块数, provider)。"""
    parts, failed, used = [], 0, []
    for content, verbatim in make_blocks(text):
        if pause is not None and pause.is_set():
            raise Interrupted()
        if verbatim:
            parts.append(content)
            continue
        shielded, tokens = protect(content)
        done = False
        for translator in translators:
            try:
                cap = 480 if isinstance(translator, MyMem) else 900
                out = "".join(translator.translate(c)
                              for c in chunk_text(shielded, cap=cap))
                parts.append(restore(out, tokens))
                used.append(type(translator).__name__)
                done = True
                break
            except Exception as e:
                log(f"块翻译失败({type(translator).__name__}): {e}")
        if not done:
            failed += 1
            parts.append(content)  # 全失败保底显示原文
        time.sleep(0.05)
    provider = "+".join(sorted(set(used))) if used else "none"
    return "\n".join(parts), failed, provider

# ---------------------------------------------------------------- 后台线程

def split_round(text, cap=1000):
    """整轮思考切成 ≤cap 字的段（句子/行边界优先），用于流式翻译。"""
    parts = [p for p in re.split(r"(?<=[.!?。！？])\s+|\n", text) if p.strip()]
    segs, buf = [], ""
    for p in parts:
        buf = buf + "\n" + p if buf else p
        if len(buf) >= cap:
            segs.append(buf)
            buf = ""
    if buf.strip():
        segs.append(buf)
    return segs or [text]

_ROUND_SEQ = itertools.count(1)

def enqueue_cot(job_q, state, text, label):
    """把一轮思考分段入队；已有 pending/done 的段跳过。
    返回 (新入队段数, 总段数)。"""
    segs = split_round(text)
    rid = next(_ROUND_SEQ)
    skip = tuple(i for i, seg in enumerate(segs) if seg in state)
    n = 0
    for i, seg in enumerate(segs):
        if seg in state:
            continue
        state[seg] = "pending"
        job_q.put(("cot", seg, (rid, label, i, len(segs), skip)))
        n += 1
    log(f"轮次 {len(text)}字 → {len(segs)}段, 新入队 {n}")
    return n, len(segs)

def _dir_watch_thread(path, ev, stop):
    """ReadDirectoryChangesW 阻塞监听目录：文件被写/新建/改名就 set(ev)。
    目录还不存在时每秒重试打开一次（ZCode 首次启动前就是这种状态）。"""
    _, k32 = _api()
    k32.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p,
                                wt.DWORD, wt.DWORD, wt.HANDLE]
    k32.CreateFileW.restype = wt.HANDLE
    k32.ReadDirectoryChangesW.argtypes = [wt.HANDLE, ctypes.c_void_p, wt.DWORD,
                                           wt.BOOL, wt.DWORD,
                                           ctypes.POINTER(wt.DWORD),
                                           ctypes.c_void_p, ctypes.c_void_p]
    k32.ReadDirectoryChangesW.restype = wt.BOOL
    FILE_LIST_DIRECTORY = 0x0001
    FILE_SHARE_ALL = 0x0007
    OPEN_EXISTING = 3
    FILE_FLAG_BACKUP_SEMANTICS = 0x02000000
    FILTER = 0x0001 | 0x0008 | 0x0010 | 0x0040   # 名字/大小/写入/创建
    invalid = ctypes.c_void_p(-1).value
    while not stop.is_set():
        h = k32.CreateFileW(path, FILE_LIST_DIRECTORY, FILE_SHARE_ALL, None,
                            OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None)
        if not h or h == invalid:
            stop.wait(1.0)
            continue
        try:
            while not stop.is_set():
                n = wt.DWORD(0)
                buf = ctypes.create_string_buffer(8192)
                if not k32.ReadDirectoryChangesW(h, buf, 8192, False, FILTER,
                                                 ctypes.byref(n), None, None):
                    break
                ev.set()
        finally:
            k32.CloseHandle(h)
        if not stop.is_set():
            stop.wait(0.5)


def watch_loop(rollout_dir, job_q, ui_q, pause, state, stop=None):
    """按文件独立跟踪各会话：启动时已有的文件跳过历史；启动后新出现的
    会话文件从头翻（≤2MB，整行可能已在轮询间隙写完；更大的续开旧会话
    只回看最后 8000 字）。多会话同时活跃时各自翻译，轮次带会话短标记。
    目录事件驱动（~0.15s 感知），5 秒兜底全扫防漏事件。"""
    stop = stop or threading.Event()
    ev = threading.Event()
    threading.Thread(target=_dir_watch_thread, args=(rollout_dir, ev, stop),
                     daemon=True).start()
    offsets = {}
    started = False
    active = {}          # path -> 会话短标记（出过轮次的才算活跃）
    last_newest = None
    while not stop.is_set():
        try:
            files = glob.glob(os.path.join(rollout_dir, "model-io-session_*.jsonl"))
            if not started:
                started = True
                for f in files:
                    offsets[f] = os.path.getsize(f)
            for f in files:
                try:
                    size = os.path.getsize(f)
                except OSError:
                    continue
                off = offsets.get(f)
                if off is None:
                    off = offsets[f] = 0 if size <= 2_000_000 else max(0, size - 8000)
                if size < off:
                    offsets[f] = size
                    continue
                if size > off:
                    with open(f, "rb") as fh:
                        fh.seek(off)
                        data = fh.read()
                    cut = data.rfind(b"\n") + 1
                    offsets[f] = off + cut
                    if pause.is_set() or not cut:
                        continue
                    tag = active.get(f)
                    if tag is None:
                        m = re.search(r"session_([0-9a-f]+)", f)
                        tag = active[f] = (m.group(1) if m else "?")[:6]
                    stamp = time.strftime("%H:%M:%S")
                    for line in data[:cut].split(b"\n"):
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            obj = json.loads(line)
                        except ValueError:
                            continue
                        rt = ((obj.get("response") or {}).get("reasoningText") or "").strip()
                        if not rt:
                            continue
                        label = stamp if len(active) == 1 else f"{stamp} · {tag}"
                        enqueue_cot(job_q, state, rt, label)
            newest = max(files, key=os.path.getmtime) if files else None
            if newest is not None and newest != last_newest:
                last_newest = newest
                ui_q.put(("cot_file", os.path.basename(newest), newest))
        except Exception as e:
            ui_q.put(("watch_error", f"{type(e).__name__}: {e}", None))
        # 目录事件到达即醒；否则最多等 5 秒兜底全扫一次
        ev.wait(5.0)
        ev.clear()

def zcode_watch(ui_q):
    """ZCode 退出后结束小窗：对根进程句柄做 WaitForSingleObject，进程一退出
    立刻返回（零唤醒、零 CPU）。句柄打不开时退回 2s 一次进程内快照。"""
    _, k32 = _api()
    alive = False
    while True:
        procs = _snapshot()
        root = zcode_root_pid(procs)
        if root is None:
            if alive:
                ui_q.put(("zcode_gone", None, None))
                return
            time.sleep(5.0)   # 手动启动且 ZCode 没开：低频等待，别白烧 CPU
            continue
        alive = True
        h = k32.OpenProcess(0x00100000, False, root)   # SYNCHRONIZE
        if h:
            try:
                k32.WaitForSingleObject(h, 0xFFFFFFFF)     # INFINITE
            finally:
                k32.CloseHandle(h)
            # PID 可能被复用：确认真的没有 ZCode 了再收摊
            if zcode_root_pid() is None:
                ui_q.put(("zcode_gone", None, None))
                return
        else:
            time.sleep(2.0)

CACHE_LOCK = threading.Lock()

def worker_thread(job_q, ui_q, pause, state, cache):
    """翻译线程（多个并发）：火山为主、Bing 次之、MyMemory 兜底。"""
    translators = [Volc(), BingCN(), MyMem()]

    def mark_done(text):
        state[text] = "done"
        if sum(1 for v in state.values() if v == "done") > 1200:
            stale = [k for k, v in state.items() if v == "done"][:200]
            for k in stale:
                state.pop(k, None)

    while True:
        kind, text, meta = job_q.get()
        if kind == "exit":
            return
        if kind == "cot" and pause.is_set():
            state.pop(text, None)   # 暂停：释放该段，之后可由「回溯」重入队
            continue
        with CACHE_LOCK:
            hit = cache.get(text)
        if hit is None:
            try:
                t0 = time.time()
                if cjk_ratio(text) > 0.4:
                    hit = (text.strip(), 0, time.time() - t0, False, "zh")
                else:
                    out, fail_n, provider = translate_any(text, translators, pause)
                    hit = (out, fail_n, time.time() - t0, False, provider)
                with CACHE_LOCK:
                    cache[text] = hit
                    if len(cache) > 500:
                        cache.popitem(last=False)
            except Interrupted:
                state.pop(text, None)   # 中断：释放，可重试
                log(f"{kind} 中断于 {meta[:2] if isinstance(meta, tuple) else meta}")
                ui_q.put(("result", kind, meta, "", -1))
                continue
            except Exception as e:
                hit = (text, 1, 0.0, False, "err")
                log(f"worker: {e}")
        out, fail_n, dt, cut, provider = hit
        if kind == "cot":
            mark_done(text)
        log(f"{kind} {dt:.1f}s {provider} fail={fail_n} {len(text)}字")
        ui_q.put(("result", kind, meta, out, fail_n if not cut else -2))

# ---------------------------------------------------------------- 界面

class App:
    def __init__(self, root, rollout_dir):
        self.root = root
        self.job_q = queue.Queue()
        self.ui_q = queue.Queue()
        self.pause = threading.Event()   # 置位 = 暂停思考流翻译
        self.stop_ev = threading.Event()  # 退出时让后台监听线程收摊
        self.state = {}                  # 段原文 -> "pending"/"done"（防重复、可重试）
        self.cache = OrderedDict()       # 段译文缓存（多线程共享）
        self.rbuf = {}                   # 轮次重排缓冲 rid -> {seq: (out, fail_n)}
        self.rnext = {}                  # rid -> 下一待显示 seq
        self.last_seq = None
        self.expanded = False
        self.cot_path = None
        self.s = max(1.0, root.winfo_fpixels("1i") / 96)  # DPI 缩放

        root.withdraw()
        try:
            ttk.Style().theme_use("clam")
        except tk.TclError:
            pass
        st = ttk.Style()
        st.configure("Dark.Vertical.TScrollbar", background="#333333",
                     troughcolor=BG, bordercolor=BG, lightcolor=BG,
                     darkcolor=BG, arrowcolor="#777777", arrowsize=9, width=9)
        st.map("Dark.Vertical.TScrollbar",
               background=[("active", "#444444")])

        self._load_cfg()
        self._build_ball()
        self._build_main()
        self.ball.deiconify()

        threading.Thread(target=watch_loop,
                         args=(rollout_dir, self.job_q, self.ui_q, self.pause,
                               self.state, self.stop_ev),
                         daemon=True).start()
        threading.Thread(target=zcode_watch, args=(self.ui_q,), daemon=True).start()
        for _ in range(3):
            threading.Thread(target=worker_thread,
                             args=(self.job_q, self.ui_q, self.pause,
                                   self.state, self.cache),
                             daemon=True).start()
        write_lock({"pid": os.getpid()})
        root.after(120, self._drain_ui)
        root.after(300, self._poll_clip)
        root.protocol("WM_DELETE_WINDOW", self.quit)

    # ---- 构建界面

    def _build_ball(self):
        d = int(30 * self.s)
        self.ball = tk.Toplevel(self.root)
        self.ball.overrideredirect(True)
        self.ball.attributes("-topmost", True)
        self.ball.configure(bg=TRANSPARENT_KEY)
        cv = tk.Canvas(self.ball, width=d, height=d, bg=TRANSPARENT_KEY,
                       highlightthickness=0, bd=0)
        cv.pack()
        self._ball_img = _circle_image(d, BALL_BG, BALL_RIM, TRANSPARENT_KEY,
                                       self.root)
        cv.create_image(0, 0, image=self._ball_img, anchor="nw")
        cv.create_text(d // 2, d // 2, text="译", fill=FG, font=FONT)
        # 圆外整块 key 色抠成透明，窗口只剩一个圆（无矩形底框）
        try:
            self.ball.attributes("-transparentcolor", TRANSPARENT_KEY)
        except tk.TclError:
            pass
        cv.bind("<Button-1>", self._ball_press)
        cv.bind("<B1-Motion>", self._ball_motion)
        cv.bind("<ButtonRelease-1>", self._ball_release)
        self.ball_menu = tk.Menu(self.ball, tearoff=0, bg=PANEL, fg=FG, font=FONT_S,
                                 activebackground=LINE, activeforeground=FG)
        self.ball_menu.add_command(label="显示", command=self.expand)
        self.ball_menu.add_command(label="退出小窗", command=self.quit_user)
        cv.bind("<Button-3>", lambda e: self._popup(self.ball_menu, e.x_root, e.y_root))
        x = self.cfg.get("ball_x", self.root.winfo_screenwidth() - d - 10)
        y = self.cfg.get("ball_y", int(self.root.winfo_screenheight() * 0.45))
        self.ball.geometry(f"{d}x{d}+{x}+{y}")
        self.ball_d = d
        self._ball_drag = None

    def _ball_press(self, e):
        self._ball_drag = (e.x_root, e.y_root, self.ball.winfo_x(), self.ball.winfo_y(), False)

    def _ball_motion(self, e):
        if not self._ball_drag:
            return
        x0, y0, bx, by, moved = self._ball_drag
        dx, dy = e.x_root - x0, e.y_root - y0
        if abs(dx) + abs(dy) > 4 * self.s:
            moved = True
            sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
            nx = min(max(0, bx + dx), sw - self.ball_d)
            ny = min(max(0, by + dy), sh - self.ball_d)
            self.ball.geometry(f"+{nx}+{ny}")
        self._ball_drag = (x0, y0, bx, by, moved)

    def _ball_release(self, e):
        if self._ball_drag and not self._ball_drag[4]:
            self.expand()
        self._ball_drag = None

    def _build_main(self):
        m = self.main = tk.Toplevel(self.root)
        m.overrideredirect(True)
        m.attributes("-topmost", True)
        m.configure(bg=BG)
        m.withdraw()
        m.columnconfigure(0, weight=1)
        m.rowconfigure(1, weight=1)

        # ---- 标签栏：思考流翻译 | 划词翻译 ...... 暂停 ×
        head = tk.Frame(m, bg=PANEL, height=int(30 * self.s))
        head.grid(row=0, column=0, sticky="ew")
        head.pack_propagate(False)
        self.tab_lbls = {}
        for i, (name, text) in enumerate((("cot", "思考流翻译"),
                                          ("clip", "划词翻译"))):
            lbl = tk.Label(head, text=text, bg=PANEL, fg=DIM, font=FONT_S,
                           cursor="hand2")
            lbl.pack(side="left", fill="y", padx=(8, 2) if i == 0 else (6, 2))
            lbl.bind("<Button-1>", lambda e, n=name: self._on_tab_click(n))
            self.tab_lbls[name] = lbl
            if i == 0:      # 标签间的竖分隔线
                tk.Frame(head, bg=LINE, width=1).pack(
                    side="left", fill="y", pady=int(8 * self.s))
        self.pause_btn = tk.Button(head, text="暂停", command=self.toggle_pause,
                                   bg=PANEL, fg=DIM, font=FONT_S, bd=0,
                                   highlightthickness=0, activebackground=LINE,
                                   activeforeground=FG, cursor="hand2")
        # × 只关窗口（收起回小球）；彻底退出在小球右键菜单
        tk.Button(head, text="×", command=self.collapse, bg=PANEL, fg=FG,
                  font=FONT_S, activebackground=LINE, activeforeground=FG,
                  bd=0, highlightthickness=0, width=3, cursor="hand2").pack(
            side="right", fill="y", padx=(0, 2))
        self.pause_btn.pack(side="right", padx=(0, 2), pady=int(4 * self.s))
        head.bind("<Button-1>", self._head_press)
        head.bind("<B1-Motion>", self._head_motion)
        self._head_drag = None

        # ---- 内容区：两个面板叠在同一格，切换时 grid / grid_remove
        self.content = tk.Frame(m, bg=BG)
        self.content.grid(row=1, column=0, sticky="nsew")
        self.content.columnconfigure(0, weight=1)
        self.content.rowconfigure(0, weight=1)
        self._build_pane("clip", height=4)
        self._build_pane("cot", height=8)
        self._switch_tab(self.cfg.get("tab", "cot"))

        w = int(self.cfg.get("main_w", 380 * self.s))
        h = int(self.cfg.get("main_h", 330 * self.s))
        x = self.cfg.get("main_x", self.root.winfo_screenwidth() - w - int(12 * self.s))
        y = self.cfg.get("main_y", int(80 * self.s))
        m.geometry(f"{w}x{h}+{x}+{y}")
        m.bind("<Escape>", lambda e: self.collapse())

        # ---- 改大小热区：左边 / 底边 / 右边 / 右下角（无边框窗口自绘）----
        self._rs = None
        edge = max(4, int(5 * self.s))
        self.edge_wl = tk.Frame(m, bg=BG, cursor="sb_h_double_arrow")
        self.edge_wl.place(relx=0, rely=0, anchor="nw", relheight=1, width=edge)
        self.edge_ns = tk.Frame(m, bg=BG, cursor="sb_v_double_arrow")
        self.edge_ns.place(relx=0, rely=1.0, anchor="sw", relwidth=1, height=edge)
        self.edge_we = tk.Frame(m, bg=BG, cursor="sb_h_double_arrow")
        self.edge_we.place(relx=1.0, rely=0, anchor="ne", relheight=1, width=edge)
        gs = int(16 * self.s)
        self.grip = tk.Canvas(m, width=gs, height=gs, bg=BG,
                              highlightthickness=0, cursor="bottom_right_corner")
        self.grip.place(relx=1.0, rely=1.0, anchor="se")
        self.grip.create_line(3, gs - 3, gs - 3, 3, fill="#555555")
        self.grip.create_line(gs // 2, gs - 3, gs - 3, gs // 2, fill="#555555")
        for wdg, mode in ((self.edge_wl, "wl"), (self.edge_ns, "ns"),
                          (self.edge_we, "we"), (self.grip, "both")):
            wdg.bind("<Button-1>", lambda e, md=mode: self._resize_press(e, md))
            wdg.bind("<B1-Motion>", self._resize_motion)
            wdg.bind("<ButtonRelease-1>", lambda e: self._save_cfg())

    def _resize_press(self, e, mode):
        self._rs = (e.x_root, e.y_root, self.main.winfo_x(),
                    self.main.winfo_y(), self.main.winfo_width(),
                    self.main.winfo_height(), mode)

    def _resize_motion(self, e):
        if not self._rs:
            return
        x0, y0, mx, my, w0, h0, mode = self._rs
        dx, dy = e.x_root - x0, e.y_root - y0
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        min_w, min_h = int(320 * self.s), int(260 * self.s)
        x, y, w, h = mx, my, w0, h0
        if mode in ("wl", "both"):
            w = max(min_w, w0 - dx)
            x = mx + (w0 - w)
        if mode in ("we", "both"):
            w = max(min_w, min(w0 + dx, sw - mx - int(8 * self.s)))
            x = mx
        if mode in ("ns", "both"):
            h = max(min_h, min(h0 + dy, sh - my - int(8 * self.s)))
            y = my
        x = max(0, min(x, sw - int(60 * self.s)))
        self.main.geometry(f"{w}x{h}+{x}+{y}")

    def _build_pane(self, name, height):
        box = tk.Frame(self.content, bg=BG)
        box.grid(row=0, column=0, sticky="nsew", padx=6, pady=(4, 2))
        box.columnconfigure(0, weight=1)
        box.rowconfigure(0, weight=1)
        text = tk.Text(box, wrap="word", relief="flat", bd=0, highlightthickness=0,
                       bg=BG, fg=FG, insertbackground=FG, padx=8, pady=4,
                       font=FONT, state="disabled", height=height)
        text.grid(row=0, column=0, sticky="nsew")
        text.tag_configure("sep", foreground=DIM)
        text.tag_configure("fail", foreground=FAIL)
        menu = tk.Menu(self.main, tearoff=0, bg=PANEL, fg=FG, font=FONT_S,
                       activebackground=LINE, activeforeground=FG)
        menu.add_command(label="清空", command=lambda: self._clear(text))
        text.bind("<Button-3>",
                  lambda e: self._popup(menu, e.x_root, e.y_root))
        if name == "clip":
            self.clip_box, self.clip_text = box, text
        else:
            self.cot_box, self.cot_text = box, text
            sb = ttk.Scrollbar(box, style="Dark.Vertical.TScrollbar",
                               command=text.yview)
            sb.grid(row=0, column=1, sticky="ns")
            text.configure(yscrollcommand=sb.set)

    def _switch_tab(self, name):
        """切换标签页：激活项亮色+下划线，其余面板 grid_remove 收起。"""
        self.tab = name
        self.cfg["tab"] = name
        for n, lbl in self.tab_lbls.items():
            on = n == name
            lbl.configure(fg=FG if on else DIM,
                          font=FONT_S_ON if on else FONT_S)
        self.cot_box.grid() if name == "cot" else self.cot_box.grid_remove()
        self.clip_box.grid() if name == "clip" else self.clip_box.grid_remove()
        if name == "cot":
            self.pause_btn.pack(side="right", padx=(0, 2),
                                pady=int(4 * self.s))   # × 之后重新 pack → 回到 × 左侧
        else:
            self.pause_btn.pack_forget()

    def _on_tab_click(self, name):
        self._switch_tab(name)
        if name == "cot":
            self.backlog()      # 点「思考流翻译」= 回溯补缺口（去重）

    @staticmethod
    def _popup(menu, x, y):
        try:
            menu.tk_popup(x, y)
        finally:
            menu.grab_release()

    # ---- 展开 / 收起 / 暂停 / 回溯 / 退出

    def expand(self):
        self.expanded = True
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        w, h = self.main.winfo_width(), self.main.winfo_height()
        if w <= 1:
            w = int(self.cfg.get("main_w", 380 * self.s))
            h = int(self.cfg.get("main_h", 330 * self.s))
        x = min(max(0, self.ball.winfo_x() - w - int(6 * self.s)), sw - w)
        y = min(max(0, self.ball.winfo_y() - int(30 * self.s)), sh - h - int(40 * self.s))
        self.main.geometry(f"+{x}+{y}")
        self.main.deiconify()
        self.main.lift()
        self.ball.withdraw()
        if self.pause.is_set():
            self.pause.clear()
            self.pause_btn.configure(text="暂停")
        self._switch_tab("cot")             # 点球默认开思考流翻译
        self.root.after(250, self.backlog)  # 并补缺口
        log("expand")

    def collapse(self):
        self.expanded = False
        self._save_cfg()
        self.main.withdraw()
        self.ball.deiconify()
        self.ball.lift()
        self.pause.set()  # 收起即暂停，零翻译开销
        self.pause_btn.configure(text="继续")
        log("collapse")

    def toggle_pause(self):
        if self.pause.is_set():
            self.pause.clear()
            self.pause_btn.configure(text="暂停")
        else:
            self.pause.set()
            self.pause_btn.configure(text="继续")

    def backlog(self, cap=8000):
        """点击「思考流翻译」：回溯翻译当前会话最近的思考（分段去重、可重试）。"""
        if self.pause.is_set():
            self.pause.clear()
            self.pause_btn.configure(text="暂停")
        path = self.cot_path
        if not path or not os.path.exists(path):
            return
        try:
            rounds = []
            with open(path, "rb") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except ValueError:
                        continue
                    rt = ((obj.get("response") or {}).get("reasoningText") or "").strip()
                    if rt:
                        rounds.append(rt)
        except OSError as e:
            log(f"backlog 读取失败: {e}")
            return
        picks, total = [], 0
        for rt in reversed(rounds):
            picks.append(rt)
            total += len(rt)
            if total >= cap:
                break
        n = 0
        for rt in reversed(picks):
            n += enqueue_cot(self.job_q, self.state, rt, time.strftime("%H:%M:%S"))[0]
        log(f"backlog 入队 {n} 段")

    def quit_user(self):
        """小球右键「退出小窗」：记录会话签名，本次 ZCode 会话内不再自动拉起。"""
        _, sig = zcode_procs()
        write_lock({"pid": os.getpid(), "closed": True, "sig": sig})
        self.quit()

    def quit(self):
        self._save_cfg()
        self.stop_ev.set()
        try:
            data = read_lock()
            if data and data.get("pid") == os.getpid() and not data.get("closed"):
                os.remove(LOCK_PATH)
        except OSError:
            pass
        self.root.destroy()

    def _head_press(self, e):
        self._head_drag = (e.x_root, e.y_root, self.main.winfo_x(), self.main.winfo_y())

    def _head_motion(self, e):
        if self._head_drag:
            x0, y0, mx, my = self._head_drag
            self.main.geometry(f"+{mx + e.x_root - x0}+{my + e.y_root - y0}")

    # ---- 配置

    def _load_cfg(self):
        try:
            with open(CFG_PATH, encoding="utf-8") as f:
                self.cfg = json.load(f)
            if self.cfg.get("v") != 2:  # v1 是未开 DPI 的虚拟坐标，弃用
                self.cfg = {"v": 2}
        except (OSError, ValueError):
            self.cfg = {"v": 2}

    def _save_cfg(self):
        try:
            self.cfg.update({
                "ball_x": self.ball.winfo_x(), "ball_y": self.ball.winfo_y(),
                "main_x": self.main.winfo_x(), "main_y": self.main.winfo_y(),
                "main_w": self.main.winfo_width(), "main_h": self.main.winfo_height(),
                "tab": self.tab,
            })
            with open(CFG_PATH, "w", encoding="utf-8") as f:
                json.dump(self.cfg, f)
        except (OSError, tk.TclError):
            pass

    # ---- 文本工具

    def _append(self, widget, text, tags=()):
        at_bottom = widget.yview()[1] > 0.995   # 仅当用户本来就在底部时才跟随
        widget.configure(state="normal")
        widget.insert("end", text, tags)
        excess = len(widget.get("1.0", "end")) - 80_000
        if excess > 0:
            widget.delete("1.0", f"1.0+{excess}c")
        widget.configure(state="disabled")
        if at_bottom and not widget.tag_ranges("sel"):
            widget.see("end")

    def _clear(self, widget):
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.configure(state="disabled")

    # ---- 主线程轮询

    def _drain_ui(self):
        while True:
            try:
                ev = self.ui_q.get_nowait()
            except queue.Empty:
                break
            name = ev[0]
            if name == "zcode_gone":
                log("ZCode 已退出，小窗跟随退出")
                self.quit()
                return
            elif name == "cot_file":
                self.cot_path = ev[2]
            elif name == "watch_error":
                log("watch: " + ev[1])
            elif name == "result":
                self._on_result(ev)
        self.root.after(120, self._drain_ui)

    def _on_result(self, ev):
        _, kind, meta, out, fail_n = ev
        if kind == "clip":
            if self.tab != "clip":      # 划词结果到达时切到划词页，免得看不见
                self._switch_tab("clip")
            self._clear(self.clip_text)
            self._append(self.clip_text, out, ("fail",) if fail_n else ())
            return
        rid, label, seq, total, skip = meta
        self.rbuf.setdefault(rid, {})[seq] = (out, fail_n)
        nxt = self.rnext.get(rid, 0)
        while nxt < total and (nxt in skip or nxt in self.rbuf[rid]):
            if nxt not in skip:
                o, f = self.rbuf[rid].pop(nxt)
                if f == -1:       # 中断
                    self._append(self.cot_text, "── 已中断 ──\n", ("sep",))
                else:
                    if nxt == 0:
                        self._append(self.cot_text, f"── {label} ──\n", ("sep",))
                    self._append(self.cot_text, o + "\n",
                                 ("fail",) if f else ())
            nxt += 1
        self.rnext[rid] = nxt
        if nxt >= total:
            self.rbuf.pop(rid, None)
            self.rnext.pop(rid, None)

    def _poll_clip(self):
        if self.expanded:
            try:
                seq = ctypes.windll.user32.GetClipboardSequenceNumber()
                if self.last_seq is None:
                    self.last_seq = seq
                elif seq != self.last_seq:
                    self.last_seq = seq
                    try:
                        text = self.root.clipboard_get()
                    except tk.TclError:
                        text = ""
                    if text and len(text.strip()) >= 2:
                        self.job_q.put(("clip", text.strip()[:6000],
                                        time.strftime("%H:%M:%S")))
            except Exception as e:
                log(f"clip: {e}")
        self.root.after(300, self._poll_clip)

# ---------------------------------------------------------------- 入口

def instance_blocked(manual):
    """True = 不应启动。手动启动只在有活实例时拒绝；
    自动拉起还尊重「用户已手动关闭本 ZCode 会话」的标记。"""
    lock = read_lock()
    if lock and lock.get("pid"):
        try:
            kernel32 = ctypes.windll.kernel32
            h = kernel32.OpenProcess(0x1000, False, int(lock["pid"]))
            if h:
                kernel32.CloseHandle(h)
                return True
        except (ValueError, OSError):
            pass
    if not manual and lock and lock.get("closed"):
        _, sig = zcode_procs()
        if sig is not None and sig == lock.get("sig"):
            return True
    return False

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rollout-dir", default=DEFAULT_ROLLOUT)
    ap.add_argument("--autospawn", action="store_true",
                    help="计划任务拉起模式：ZCode 未运行或被用户关闭则直接退出")
    args = ap.parse_args()
    if args.autospawn:
        running, _ = zcode_procs()
        if not running or instance_blocked(manual=False):
            return
        log("autospawn 启动")
    elif instance_blocked(manual=True):
        print("思考小窗已在运行。")
        return
    log("=== start")
    root = tk.Tk()
    App(root, args.rollout_dir)
    root.mainloop()

if __name__ == "__main__":
    main()
