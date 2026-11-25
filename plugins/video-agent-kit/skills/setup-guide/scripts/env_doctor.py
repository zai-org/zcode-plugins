#!/usr/bin/env python3
"""video-agent-kit 环境向导的体检脚本: 探测 → 选下载源 → 报「缺什么 / 影响什么 / 本机怎么装」 → 可选自动安装。

服务对象是第一次在一台空白电脑上用 ZCode + 本插件的用户 (见 skills/setup-guide/SKILL.md)。

设计约束:
- **要求先于命令**: 每项先说要什么, 再给本机可以直接执行的示例命令。命令是示例, 要求才是硬的。
- **探测与修复分离**: 默认只读。``--fix`` 只装用户态、幂等的项 (pip 包)。``--system`` 才执行系统级
  安装命令 (macOS 的 brew、Windows 的 winget; winget 装某些软件时 Windows 会弹权限确认), 由 agent
  先征得用户同意, 而且只装同意的范围: 默认只有基础组, 可选组要 ``--with``, ``--only`` 可精确到某几项。
  要 sudo、要输入密码或手动点安装包的步骤永远只打印。不卸载任何东西。
- **单一事实源**: Python 依赖直接读 ``requirements.txt`` 与 ``requirements-nodeps.txt`` (后者只能
  ``--no-deps`` 安装); SessionStart hook (``hooks/env_check.py``) import 这里的 ``cheap_missing()``。
  加依赖改这两个文件 (系统级依赖则在这里加一个 Check)。
- **下载源自动挑**: 国内网络默认走镜像, 但哪个镜像能通取决于出口 (实测: 清华源对部分出口直接回
  403; 华为云的 Blender 目录是 200 的占位页)。所以对每类下载源的候选并行探测, 而且校验返回的内容,
  用最快能通的那个、偏向国内镜像; 海外网络会自然选回官方源。用户自己配置过的源照用。
- **探测顺序即依赖顺序**: 前置没过的项报「未检查」, 不给修复命令, 免得一个根因炸出五条噪音。
- **"装了" ≠ "能用"**: ffmpeg 查编码器/滤镜 (Homebrew 的 ffmpeg 不带 libass, 要 ffmpeg-full), 字体查
  cmap 真覆盖中文, Python 包真 import 一遍, 插件启动用的 ``python3`` 要和装包的解释器是同一个环境。
- **只用标准库, 兼容 Python 3.8+**: 空白 Mac 上的 ``python3`` 可能是系统自带的 3.9, 体检也必须跑得
  起来, 才能告诉用户"要先升级 Python"。

用法:
  env_doctor.py                          # 全量探测 + 待办清单
  env_doctor.py --fix                    # + 自动装基础组的 pip 依赖 (用户态)
  env_doctor.py --fix --system           # + 基础组的系统软件 (先征得用户同意)
  env_doctor.py --fix --system --with web    # + 网页复刻组 (可选组: web / 3d / extras / all)
  env_doctor.py --fix --system --only ffmpeg # 只处理指定的项 (检查项 id, 逗号分隔)
  env_doctor.py --cheap                  # 只跑快速、不联网的基础项 (hook 用)
  env_doctor.py --json                   # 机器可读 (只读体检用; --fix 时安装日志走 stderr)
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple, Union
from urllib.parse import urlsplit


def _plugin_root() -> Path:
    here = Path(__file__).resolve().parents[3]
    if (here / "requirements.txt").is_file():
        return here
    env = os.environ.get("ZCODE_PLUGIN_ROOT") or os.environ.get("VE_PLUGIN_ROOT")
    return Path(env).resolve() if env else here


def _project_dir() -> Path:
    # 与 hooks/hook_common.project_dir 同口径: VE_PROJECT_DIR 优先, 空值/未展开的 ${...} 视为未设置;
    # 脚本由 agent 在项目目录里运行, 其次用 cwd
    value = (os.environ.get("VE_PROJECT_DIR") or "").strip()
    if value and "${" not in value:
        return Path(value)
    return Path.cwd()


PLUGIN_ROOT = _plugin_root()
PROJECT_DIR = _project_dir()
REQUIREMENTS = PLUGIN_ROOT / "requirements.txt"
REQUIREMENTS_NODEPS = PLUGIN_ROOT / "requirements-nodeps.txt"   # 只能 --no-deps 安装
SCRIPT = Path(__file__).resolve()
PY = sys.executable or "python3"
# 命令行里用 PYQ: Windows 解释器路径常含空格, 修复命令走 shell=True
PYQ = f'"{PY}"' if " " in PY else PY
OS = "macos" if sys.platform == "darwin" else "windows" if os.name == "nt" else "linux"
ARCH = platform.machine().lower()
# 插件的 MCP server 和 hooks 都以 `python3` 启动 (.zcode-plugin/plugin.json mcpServers / hooks/hooks.json)
LAUNCHER = "python3"
MIN_PY = (3, 10)
MIN_FREE_GB = 5
MACHINE_STATE = Path(os.environ.get("VE_STATE_HOME") or (Path.home() / ".video_agent"))

WEB_SCRIPTS = PLUGIN_ROOT / "skills" / "web-replicate" / "scripts"
TPL_DIR = PLUGIN_ROOT / "skills" / "web-replicate" / "templates" / "default" / "template"
NM_LOCAL_ROOT = Path(os.environ.get("NM_LOCAL_ROOT", "/tmp/webapp-node-modules"))

GROUPS = [
    ("core", "基础：所有视频功能都要"),
    ("web", "网页 / 游戏 / 全栈复刻（video2code 系列）"),
    ("3d", "3D 动画渲染（code2video 3D，可选）"),
    ("extras", "可选增强"),
    ("services", "外部服务（由平台统一提供，用户无需申请账号）"),
]

_NETWORK = True    # --cheap 时关掉: hook 里绝不联网
_QUICK = False     # --cheap 时打开: 子进程超时压到 hook 的时限之内


def _timeout(full: float) -> float:
    return min(full, 5.0) if _QUICK else full


# ── 下载源 (国内镜像 / CDN) ─────────────────────────────────────────────────────
@dataclass
class Source:
    name: str
    base: str          # 给命令用的基础 URL
    probe: str         # 探测用的相对路径
    expect: str = ""   # 响应里必须出现的片段; "!html" = 必须是文件而不是网页 (挡掉 200 的占位页)
    browse: str = ""   # 给用户在浏览器里打开的地址 (空 = 探测地址所在目录)


PY_VER = "3.12.8"


def _brew_tag() -> str:
    """Homebrew 7 先取 api/internal/packages.<tag>.jws.json; 有的镜像没有这个文件 (实测阿里云 404),
    brew 就悄悄回到官方源, 所以探测要问它真正会取的那个文件。"""
    if OS != "macos":
        return ""
    names = {11: "big_sur", 12: "monterey", 13: "ventura", 14: "sonoma", 15: "sequoia", 26: "tahoe"}
    try:
        major = int(platform.mac_ver()[0].split(".")[0])
    except ValueError:
        return ""
    name = names.get(major, "")
    return (f"arm64_{name}" if ARCH in ("arm64", "aarch64") else name) if name else ""


def sources(kind: str) -> List[Source]:
    if kind == "pypi":
        return [Source(n, b, "/pip/", "pip-") for n, b in (
            ("阿里云", "https://mirrors.aliyun.com/pypi/simple"),
            ("清华", "https://pypi.tuna.tsinghua.edu.cn/simple"),
            ("腾讯云", "https://mirrors.cloud.tencent.com/pypi/simple"),
            ("华为云", "https://mirrors.huaweicloud.com/repository/pypi/simple"),
            ("官方 PyPI", "https://pypi.org/simple"))]
    if kind == "npm":
        return [Source("npmmirror", "https://registry.npmmirror.com", "/-/ping"),
                Source("官方 npm", "https://registry.npmjs.org", "/-/ping")]
    if kind == "homebrew":
        tag = _brew_tag()
        probe = f"/api/internal/packages.{tag}.jws.json" if tag else "/api/formula.jws.json"
        return [Source(n, b, probe) for n, b in (
            ("中科大", "https://mirrors.ustc.edu.cn/homebrew-bottles"),
            ("清华", "https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"),
            ("腾讯云", "https://mirrors.cloud.tencent.com/homebrew-bottles"),
            ("阿里云", "https://mirrors.aliyun.com/homebrew/homebrew-bottles"))]
    if kind == "conda-forge":
        return [Source(n, b, "/noarch/repodata.json") for n, b in (
            ("中科大", "https://mirrors.ustc.edu.cn/anaconda/cloud/conda-forge"),
            ("清华", "https://mirrors.tuna.tsinghua.edu.cn/anaconda/cloud/conda-forge"),
            ("北外", "https://mirrors.bfsu.edu.cn/anaconda/cloud/conda-forge"),
            ("官方 conda-forge", "https://conda.anaconda.org/conda-forge"))]
    if kind == "python-dl":
        fname = f"python-{PY_VER}-amd64.exe" if OS == "windows" else f"python-{PY_VER}-macos11.pkg"
        return [Source("华为云", "https://mirrors.huaweicloud.com/python", f"/{PY_VER}/{fname}", "!html"),
                Source("npmmirror", "https://registry.npmmirror.com/-/binary/python", f"/{PY_VER}/{fname}", "!html",
                       f"https://registry.npmmirror.com/binary.html?path=python/{PY_VER}/"),
                Source("python.org 官方站", "https://www.python.org/ftp/python", f"/{PY_VER}/{fname}", "!html")]
    if kind == "node-dl":
        return [Source("npmmirror", "https://registry.npmmirror.com/-/binary/node", "/latest-v22.x/SHASUMS256.txt",
                       "node-v22", "https://registry.npmmirror.com/binary.html?path=node/latest-v22.x/"),
                Source("nodejs.org 官方站", "https://nodejs.org/dist", "/latest-v22.x/SHASUMS256.txt", "node-v22")]
    if kind == "blender-dl":
        return [Source(n, b, "/Blender4.5/", "blender-4.5.") for n, b in (
            ("阿里云", "https://mirrors.aliyun.com/blender/release"),
            ("清华", "https://mirrors.tuna.tsinghua.edu.cn/blender/release"),
            ("华为云", "https://mirrors.huaweicloud.com/blender"),
            ("blender.org 官方站", "https://download.blender.org/release"))]
    raise KeyError(kind)


# 我们自己的显式覆盖 (部署方/开发者刻意指定): 直接用, 不探测
MIRROR_OVERRIDE_ENV = {"pypi": ("VE_PIP_INDEX",), "npm": ("VE_NPM_REGISTRY",)}
# 用户机器上已有的源配置: 照用, 但先探测 —— 很多人多年前配过的源已经失效 (被拒、停服)
CONFIG_ENV = {"pypi": ("PIP_INDEX_URL",), "npm": ("npm_config_registry", "NPM_CONFIG_REGISTRY")}
PROBE_TIMEOUT = 5.0


@dataclass
class Mirror:
    kind: str
    name: str
    url: str
    latency: Optional[float]                      # None = 未探测 / 不可达 / 用户指定
    tried: List[str] = field(default_factory=list)  # 探测记录, 例如 "清华 HTTP 403"
    browse: str = ""
    note: str = ""                                # 例如 "你配置的源连不上, 本次改用..."

    @property
    def ok(self) -> bool:
        return self.latency is not None or self.name == "用户指定"

    def label(self) -> str:
        """给用户看的来源说明: 「阿里云镜像」/「python.org 官方站」。"""
        return self.name if "官方" in self.name else f"{self.name}镜像"


_MIRROR_CACHE: Dict[str, Mirror] = {}
_SSL_CTX = None


def _ssl_context():
    """python.org 的 macOS 安装包在运行 Install Certificates.command 之前没有 CA 证书, urllib 的每个
    HTTPS 请求都会证书校验失败 —— 那时所有镜像都会被误判成"连不上"。所以有 certifi 用 certifi,
    否则在系统证书文件里找一个。"""
    global _SSL_CTX
    if _SSL_CTX is not None:
        return _SSL_CTX
    import ssl

    try:
        import certifi  # type: ignore

        _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
        return _SSL_CTX
    except Exception:  # noqa: BLE001
        pass
    ctx = ssl.create_default_context()
    paths = ssl.get_default_verify_paths()
    if not (paths.cafile and os.path.exists(paths.cafile)):
        for cand in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt"):
            if os.path.exists(cand):
                try:
                    ctx.load_verify_locations(cand)
                    break
                except Exception:  # noqa: BLE001
                    continue
    _SSL_CTX = ctx
    return ctx


def _probe_url(url: str, timeout: float = PROBE_TIMEOUT, expect: str = "") -> Tuple[Optional[float], str]:
    """一个小 GET (Range 64KB), 走与 pip/npm 相同的环境代理, 并校验内容。返回 (延迟秒数或 None, 结论)。"""
    import urllib.error
    import urllib.request

    req = urllib.request.Request(url, headers={"Range": "bytes=0-65535", "User-Agent": "video-agent-kit-setup/1"})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:  # noqa: S310
            body = resp.read(65536)
            code = resp.status
            ctype = (resp.headers.get("Content-Type") or "").lower()
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001 - 超时/DNS/TLS 都只是"这个候选不通"
        reason = getattr(e, "reason", e)
        return None, f"{type(reason).__name__}: {str(reason)[:80]}"
    elapsed = time.monotonic() - t0
    if code not in (200, 206):
        return None, f"HTTP {code}"
    if expect == "!html" and "html" in ctype:
        return None, "返回的是网页而不是文件"
    if expect and expect != "!html" and expect.encode() not in body:
        return None, "内容不对（像是占位页）"
    return elapsed, f"{elapsed:.2f}s"


def _probe_source(src: Source) -> Tuple[Optional[float], str]:
    """探两次取较快的一次, 让选源不随一次抖动来回变; 第一次就不通则不再浪费时间。"""
    best: Optional[float] = None
    note = ""
    for _ in range(2):
        lat, note = _probe_url(src.base + src.probe, expect=src.expect)
        if lat is None:
            return (best, f"{best:.2f}s") if best is not None else (None, note)
        best = lat if best is None else min(best, lat)
    return best, f"{best:.2f}s"


def _configured_source(kind: str) -> Optional[Tuple[str, str]]:
    """用户机器上已有的源配置 (环境变量、pip 配置的 index-url、npm 的 registry)。公司内网常只放行内部
    源, 这时用 `-i 公共镜像` 绕过它反而装不上, 所以能用就照用。返回 (说明, URL)。"""
    for name in CONFIG_ENV.get(kind, ()):
        value = (os.environ.get(name) or "").strip()
        if value:
            return (name, value)
    try:
        if kind == "pypi":
            out = subprocess.run([PY, "-m", "pip", "config", "list"], capture_output=True, text=True,
                                 timeout=15).stdout
            m = re.search(r"^(?:global|install)\.index-url\s*=\s*'?([^'\s]+)'?", out, re.MULTILINE)
            return ("pip 配置", m.group(1)) if m else None
        npm = shutil.which("npm")
        if kind == "npm" and npm:
            out = subprocess.run([npm, "config", "get", "registry"], capture_output=True, text=True,
                                 timeout=15).stdout.strip()
            if out.startswith("http") and "registry.npmjs.org" not in out:
                return ("npm 配置", out)
    except Exception:  # noqa: BLE001 - 读不到配置就当没配
        return None
    return None


def pick(kind: str) -> Mirror:
    """这一类下载源里最快能通的候选。显式覆盖直接用; 用户已有的配置能连通就照用, 连不上就说明并改用
    自动选择的源 (只作用于本次安装命令, 不改用户的配置); 不联网模式下返回第一个候选 (不保证可达)。"""
    if kind in _MIRROR_CACHE:
        return _MIRROR_CACHE[kind]
    for name in MIRROR_OVERRIDE_ENV.get(kind, ()):
        value = (os.environ.get(name) or "").strip().rstrip("/")
        if value:
            _MIRROR_CACHE[kind] = Mirror(kind, "用户指定", value, None, [f"{name}={value}"])
            return _MIRROR_CACHE[kind]
    cands = sources(kind)
    if not _NETWORK:
        first = cands[0]
        return Mirror(kind, first.name, first.base, None, ["未探测 (不联网模式)"], _browse(first))
    note = ""
    configured = _configured_source(kind) if kind in CONFIG_ENV else None
    if configured:
        label, url = configured[0], configured[1].rstrip("/")
        lat, why = _probe_url(url + cands[0].probe, expect=cands[0].expect)
        if lat is not None:
            _MIRROR_CACHE[kind] = Mirror(kind, "用户指定", url, lat, [f"{label}={url}"])
            return _MIRROR_CACHE[kind]
        note = f"你配置的源（{label}）{url} 连不上（{why}），本次安装改用自动选择的源，你的配置没有改动"
    with ThreadPoolExecutor(max_workers=len(cands)) as ex:
        results = list(ex.map(_probe_source, cands))
    tried = [f"{c.name} {r[1]}" for c, r in zip(cands, results)]
    good = [(r[0], i) for i, r in enumerate(results) if r[0] is not None]
    if good:
        # 一次小请求的延迟只反映连通性, 不反映大文件下载速度 (官方站首包快、在国内下大文件常常很慢)。
        # 候选按"国内镜像在前"排好, 不比最快的明显慢就用排在前面的; 安装包动辄几十上百 MB, 偏好更强。
        slack = (3.0, 0.5) if kind.endswith("-dl") else (2.0, 0.3)
        best = min(lat for lat, _ in good)
        lat, i = next((lat, i) for lat, i in sorted(good, key=lambda x: x[1]) if lat <= best * slack[0] + slack[1])
        m = Mirror(kind, cands[i].name, cands[i].base, lat, tried, _browse(cands[i]), note)
    else:
        last = cands[-1]   # 全不通: 记官方源, 由调用方报"网络不通"
        m = Mirror(kind, last.name, last.base, None, tried, _browse(last), note)
    _MIRROR_CACHE[kind] = m
    return m


def _browse(src: Source) -> str:
    if src.browse:
        return src.browse
    path = src.probe if src.probe.endswith("/") else src.probe.rsplit("/", 1)[0] + "/"
    return src.base + path


def resolve_mirrors() -> None:
    """把报告头里要显示的下载源一次并行探测好 (每类内部也是并行的)。"""
    kinds = ["pypi", "npm"] + (["homebrew"] if OS == "macos" else [])
    with ThreadPoolExecutor(max_workers=len(kinds)) as ex:
        list(ex.map(pick, kinds))


def mirror_line(kind: str) -> str:
    m = pick(kind)
    if m.name == "用户指定":
        return f"{m.url}（{m.tried[0].split('=')[0]} 指定）"
    tail = f"；{m.note}" if m.note else ""
    if m.latency is None:
        return f"{m.name} {m.url}（所有候选都连不上：{'；'.join(m.tried)}{tail}）" if m.tried else f"{m.name} {m.url}"
    return f"{m.name} {m.url}（{m.latency:.2f}s{tail}）"


def proxy_summary() -> str:
    """环境里的代理 (只报 scheme://host:port, 不回显账号密码)。"""
    seen: List[str] = []
    for key in ("https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"):
        value = (os.environ.get(key) or "").strip()
        if not value:
            continue
        try:
            parts = urlsplit(value if "://" in value else "http://" + value)
            shown = f"{parts.scheme}://{parts.hostname}" + (f":{parts.port}" if parts.port else "")
        except ValueError:
            shown = "（格式无法解析）"
        item = f"{key.lower()}={shown}"
        if item not in seen:
            seen.append(item)
    return "、".join(seen) if seen else "无"


def brew_env() -> Dict[str, str]:
    """brew 安装命令用的镜像环境变量: bottle + API 走镜像, 并关掉安装前的自动 update
    (自动 update 走 GitHub 的 git 远端, 国内常卡几分钟)。只作用于这一条命令, 不改用户的 brew 配置。"""
    m = pick("homebrew")
    if not m.ok:
        return {"HOMEBREW_NO_AUTO_UPDATE": "1"}
    return {"HOMEBREW_BOTTLE_DOMAIN": m.url, "HOMEBREW_API_DOMAIN": m.url + "/api", "HOMEBREW_NO_AUTO_UPDATE": "1"}


def env_prefix(env: Dict[str, str]) -> str:
    return " ".join(f"{k}={v}" for k, v in env.items()) + " "


# ── 检查项模型 ─────────────────────────────────────────────────────────────────
Lines = Union[List[str], Callable[[], List[str]]]


@dataclass
class Check:
    id: str
    group: str
    label: str
    why: str                                      # 缺了会挂掉哪个能力
    probe: Callable[[], Tuple[bool, str]]         # → (ok, 一行细节)
    need: str = ""                                # 硬要求一行
    fix: Lines = field(default_factory=list)      # 用户态修复命令 (--fix 执行; # 开头是说明)
    sys_fix: Lines = field(default_factory=list)  # 系统级命令 (--fix --system 执行, 无 sudo/密码)
    manual: Lines = field(default_factory=list)   # 只能由用户手动完成的步骤 (永远只打印)
    cheap: bool = False                           # 快速、不联网 → hook 可跑
    auto: bool = False                            # --fix 可执行 fix
    slow: bool = False                            # 修复要几分钟
    needs: str = ""                               # 前置检查项 id
    platforms: Tuple[str, ...] = ()               # 限定平台
    soft: bool = False                            # 缺了只降级不致命
    info: bool = False                            # 纯信息行, 永不算缺口
    env: Callable[[], Dict[str, str]] = field(default_factory=lambda: dict)


@dataclass
class Result:
    check: Check
    status: str   # ok | missing | skip | na | info
    detail: str


def _lines(value: Lines) -> List[str]:
    return list(value() if callable(value) else value)


def by_os(**variants: List[str]) -> List[str]:
    return list(variants.get(OS) or variants.get("any") or [])


# ── Python 与 pip ─────────────────────────────────────────────────────────────
def _dist_version(name: str) -> Optional[str]:
    try:
        from importlib.metadata import version

        return version(name)
    except Exception:  # noqa: BLE001
        return None


def externally_managed() -> bool:
    """PEP 668: Homebrew / Debian 12+ / Ubuntu 23.04+ 的系统 Python 拒绝 pip 直接装包。"""
    if sys.prefix != getattr(sys, "base_prefix", sys.prefix):
        return False   # venv 里不受限
    import sysconfig

    candidates = [Path(sys.prefix) / "EXTERNALLY-MANAGED"]
    try:
        stdlib = Path(sysconfig.get_path("stdlib"))
        candidates += [stdlib / "EXTERNALLY-MANAGED", stdlib.parent / "EXTERNALLY-MANAGED"]
    except Exception:  # noqa: BLE001
        pass
    return any(c.is_file() for c in candidates)


def pip_cmd(*specs: str, no_deps: bool = False, extra: str = "") -> str:
    quoted = " ".join(f'"{s}"' if any(ch in s for ch in "<>=!,") else s for s in specs)
    flags = ["--disable-pip-version-check", "-i", pick("pypi").url]
    if externally_managed():
        # 装进用户目录, 不碰系统包; 这是 PEP 668 环境下 pip 唯一放行的直装方式
        flags += ["--user", "--break-system-packages"]
    if no_deps:
        flags.append("--no-deps")
    if extra:
        flags.append(extra)
    return f"{PYQ} -m pip install {' '.join(flags)} {quoted}"


_REQ_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")
# pip 包名 → import 名 (没装时只能靠这张表猜; 装了以后以包自己的 top_level.txt 为准)
IMPORT_NAMES = {"pillow": "PIL", "fonttools": "fontTools", "opencv-python-headless": "cv2", "yt-dlp": "yt_dlp",
                "pyyaml": "yaml", "scikit-image": "skimage", "python-dotenv": "dotenv"}
PACKAGE_WHY = {
    "mcp": "MCP 服务本体 —— 缺了插件的所有工具都不出现",
    "requests": "语音/生成服务的 HTTP 调用",
    "curl_cffi": "video_search / video_download（视频站点检索与下载）",
    "yt-dlp": "video_download 与在线视频的元数据",
    "numpy": "抽帧、帧比较与 QC 扫描",
    "pillow": "联系表拼图、字幕排版测宽（模型看到的那些图）",
    "fonttools": "字体覆盖检查（烧字幕前拦下豆腐块）",
    "opencv-python-headless": "抽帧与镜头检测",
    "scenedetect": "镜头切分（电影/比赛解说、长视频剪辑）",
    "jieba": "中文分词与词性：字幕断行禁则、口播精简的主题词（缺了会退回逐字切分）",
}
RIDERS = ("click", "platformdirs", "tqdm")   # scenedetect 的运行依赖, 跟它一起装


def _read_requirements(path: Path) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return out
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        m = _REQ_RE.match(line)
        if m:
            out.append((m.group(1).lower(), line))
    return out


def requirements() -> List[Tuple[str, str]]:
    """requirements.txt + requirements-nodeps.txt → [(包名, 原始 spec)], 与插件实际安装清单保持唯一来源。"""
    return _read_requirements(REQUIREMENTS) + _read_requirements(REQUIREMENTS_NODEPS)


# requirements-nodeps.txt 里的包 (scenedetect): 声明依赖 opencv-python(GUI 版), 直装会盖坏 headless 版的 cv2
NO_DEPS = {pkg for pkg, _ in _read_requirements(REQUIREMENTS_NODEPS)} or {"scenedetect"}


def req_spec(package: str, default: str) -> str:
    return next((spec for pkg, spec in requirements() if pkg == package), default)


def import_name(package: str) -> str:
    try:
        from importlib.metadata import distribution

        top = (distribution(package).read_text("top_level.txt") or "").split()
        if top:
            return top[0]
    except Exception:  # noqa: BLE001
        pass
    return IMPORT_NAMES.get(package, package.replace("-", "_"))


def _spec_ok(package: str, spec: str, version: Optional[str]) -> Optional[bool]:
    """已装版本是否满足 spec; 判断不了 (没有 packaging) 返回 None。"""
    if version is None:
        return None
    rest = spec[len(package):].strip() if spec.lower().startswith(package) else ""
    if not rest:
        return True
    try:
        try:
            from packaging.specifiers import SpecifierSet
            from packaging.version import Version
        except ImportError:
            from pip._vendor.packaging.specifiers import SpecifierSet  # type: ignore
            from pip._vendor.packaging.version import Version  # type: ignore
        return Version(version) in SpecifierSet(rest)
    except Exception:  # noqa: BLE001
        return None


_IMPORT_ERRORS: Optional[Dict[str, str]] = None


def import_errors() -> Dict[str, str]:
    """在子进程里把所有依赖真 import 一遍 (半装/轮子不匹配的包 find_spec 能找到, import 会炸;
    子进程里炸了也不会拖垮体检)。快速模式不做。返回 {模块: 错误}。"""
    global _IMPORT_ERRORS
    if _IMPORT_ERRORS is not None:
        return _IMPORT_ERRORS
    mods = sorted({import_name(p) for p, _ in requirements()})
    code = ("import importlib, json, sys\nerr = {}\nfor m in sys.argv[1:]:\n    try:\n        importlib.import_module(m)\n"
            "    except BaseException as e:\n        err[m] = (type(e).__name__ + ': ' + str(e)).splitlines()[0][:160]\n"
            "print(json.dumps(err))")
    try:
        out = subprocess.run([PY, "-c", code, *mods], capture_output=True, text=True, timeout=120)
        _IMPORT_ERRORS = json.loads(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else {}
    except Exception:  # noqa: BLE001 - 检查不了就不下结论
        _IMPORT_ERRORS = {}
    return _IMPORT_ERRORS


def probe_package(package: str, spec: str) -> Callable[[], Tuple[bool, str]]:
    def _p() -> Tuple[bool, str]:
        version = _dist_version(package)
        note = ""
        if version is None and package == "opencv-python-headless" and _dist_version("opencv-python"):
            version, note = _dist_version("opencv-python"), "（装的是 GUI 版 opencv-python，也能用）"
        mod = import_name(package)
        try:
            found = version is not None or importlib.util.find_spec(mod) is not None
        except Exception as e:  # noqa: BLE001 - 半装/依赖缺也算缺
            return False, f"查找出错: {type(e).__name__}: {e}"
        if not found:
            return False, "未安装"
        if _NETWORK and not _QUICK:
            err = import_errors().get(mod)
            if err:
                return False, f"已安装但导入失败: {err}"
        if _spec_ok(package, spec, version) is False and not note:
            return False, f"已装 {version}，但要求 {spec}"
        return True, f"{version or '已装'}{note}"
    return _p


def probe_py_version() -> Tuple[bool, str]:
    v = sys.version_info
    return v[:2] >= MIN_PY, f"{v[0]}.{v[1]}.{v[2]}（{PY}）"


def probe_launcher() -> Tuple[bool, str]:
    """插件以 `python3` 启动; 依赖必须装进**那个**解释器的环境。ZCode 里 MCP、hook 和终端看到的 PATH
    相同, 所以这里解析出来的就是插件实际会用的那个。比较 sys.prefix 而不只比较文件: venv 里的
    python3 往往就是基础解释器的软链, 文件相同但装包的地方不同。"""
    exe = shutil.which(LAUNCHER)
    if not exe:
        return False, f"PATH 上没有 {LAUNCHER} 命令 —— 插件的工具服务起不来"
    code = "import sys;print(sys.executable);print('%d.%d' % sys.version_info[:2]);print(sys.prefix)"
    try:
        out = subprocess.run([exe, "-c", code], capture_output=True, text=True, timeout=_timeout(20))
    except Exception as e:  # noqa: BLE001
        return False, f"{exe} 无法运行: {type(e).__name__}: {e}"
    lines = out.stdout.strip().splitlines()
    if out.returncode != 0 or len(lines) < 3:
        text = (out.stderr or out.stdout).strip()
        if OS == "windows" and ("Microsoft Store" in text or out.returncode == 9009):
            return False, f"{exe} 是 Windows 应用商店的占位程序，不是真的 Python"
        return False, f"{exe} 运行失败: {text[:120]}"
    target, ver, prefix = lines[0], lines[1], lines[2]
    same = _same_file(target, PY) and os.path.normcase(os.path.abspath(prefix)) == os.path.normcase(
        os.path.abspath(sys.prefix))
    if not same:
        return False, (f"{LAUNCHER} → {target}（Python {ver}，环境 {prefix}），但本次体检用的是 {PY}（{sys.prefix}）"
                       f" —— 依赖要装进 {LAUNCHER} 的那个环境，请改用 `{LAUNCHER}` 重新运行体检")
    return True, f"{LAUNCHER} → {target}（就是本解释器）"


def _same_file(a: str, b: str) -> bool:
    try:
        return os.path.samefile(a, b)
    except OSError:
        return os.path.normcase(a) == os.path.normcase(b)


def probe_pip() -> Tuple[bool, str]:
    if importlib.util.find_spec("pip") is None:
        return False, "pip 不可用（python -m pip 失败）"
    note = "；外部托管环境(PEP 668)，自动改为装进用户目录" if externally_managed() else ""
    return True, f"pip {_dist_version('pip') or ''}{note}".strip()


def probe_mcp(spec: str) -> Callable[[], Tuple[bool, str]]:
    base = probe_package("mcp", spec)

    def _p() -> Tuple[bool, str]:
        ok, detail = base()
        ver = _dist_version("mcp") or ""
        if ok and ver and not ver.startswith("1."):
            return False, f"{ver}，需要 1.x（2.x 改了插件用的 Server API）"
        return ok, detail
    return _p


def probe_cv2_conflict() -> Tuple[bool, str]:
    gui, headless = _dist_version("opencv-python"), _dist_version("opencv-python-headless")
    if gui and headless:
        return False, f"同时装了 opencv-python {gui} 和 opencv-python-headless {headless}（会互相覆盖文件）"
    return True, f"opencv-python-headless {headless}" if headless else "未见混装"


def probe_certs() -> Tuple[bool, str]:
    """python.org 的 macOS Python 装完后要运行一次 Install Certificates.command, 否则用标准库发的 HTTPS
    请求全都证书校验失败 (pip 自带证书, 不受影响)。"""
    import ssl

    paths = ssl.get_default_verify_paths()
    if paths.cafile and os.path.exists(paths.cafile):
        return True, "有 CA 证书"
    if importlib.util.find_spec("certifi") is not None:
        return True, "使用 certifi 的证书"
    return False, "这个 Python 没有 CA 证书（python.org 安装包装完后没运行 Install Certificates.command）"


# ── 系统软件 ───────────────────────────────────────────────────────────────────
def probe_bins(*bins: str) -> Callable[[], Tuple[bool, str]]:
    def _p() -> Tuple[bool, str]:
        found = {b: shutil.which(b) for b in bins}
        miss = [b for b, p in found.items() if not p]
        if miss:
            return False, "找不到 " + "、".join(miss)
        return True, "；".join(f"{b}={p}" for b, p in found.items())
    return _p


def _ffmpeg_list(kind: str) -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        return ""
    try:
        p = subprocess.run([exe, "-hide_banner", f"-{kind}"], capture_output=True, text=True, timeout=_timeout(60))
    except Exception:  # noqa: BLE001
        return ""
    return p.stdout + p.stderr


def probe_ffmpeg_encoders() -> Tuple[bool, str]:
    text = _ffmpeg_list("encoders")
    if not text:
        return False, "ffmpeg -encoders 无输出"
    want = {"libx264": "视频编码", "aac": "音频编码", "libmp3lame": "mp3 中间件"}
    miss = [f"{k}（{v}）" for k, v in want.items() if not re.search(rf"\s{k}\s", text)]
    return (False, "缺编码器 " + "、".join(miss)) if miss else (True, "libx264 / aac / libmp3lame 齐")


def probe_ffmpeg_filters() -> Tuple[bool, str]:
    text = _ffmpeg_list("filters")
    if not text:
        return False, "ffmpeg -filters 无输出"
    want = {"subtitles": "字幕烧录(libass)", "ass": "ASS 字幕(libass)", "drawtext": "标题卡(libfreetype)",
            "xfade": "转场"}
    miss = [f"{k}（{v}）" for k, v in want.items() if not re.search(rf"\s{k}\s", text)]
    return (False, "缺滤镜 " + "、".join(miss)) if miss else (True, "subtitles / ass / drawtext / xfade 齐")


def _load_kit_module(name: str):
    """直接问插件自己的代码 (字体解析、服务配置), 不在这里另写一份会漂移的逻辑。"""
    mcp_dir = str(PLUGIN_ROOT / "mcp")
    if mcp_dir not in sys.path:
        sys.path.insert(0, mcp_dir)
    from importlib import import_module

    return import_module(f"ve_tools.{name}")


def probe_font() -> Tuple[bool, str]:
    """字幕渲染那条路径找得到的、cmap 真覆盖中文的字体 (fc-match 会把没有汉字的 DejaVu 交出来)。"""
    try:
        found = str(_load_kit_module("subtitle_style").find_cjk_font())
    except Exception as e:  # noqa: BLE001
        return False, f"字体检查失败: {type(e).__name__}: {e}"
    if found.startswith("[ERROR]"):
        return False, "没找到能显示中文的字体（烧出来会是方块）"
    return True, found


def probe_disk() -> Tuple[bool, str]:
    target = PROJECT_DIR if PROJECT_DIR.exists() else PROJECT_DIR.parent
    try:
        free = shutil.disk_usage(str(target)).free / 2 ** 30
    except OSError as e:
        return False, f"{target} 无法统计: {e}"
    return free >= MIN_FREE_GB, f"{target} 剩余 {free:.1f} GB" + ("" if free >= MIN_FREE_GB else f"（< {MIN_FREE_GB} GB）")


def probe_node() -> Tuple[bool, str]:
    exe = shutil.which("node")
    if not exe:
        return False, "未安装 Node.js"
    try:
        out = subprocess.run([exe, "-v"], capture_output=True, text=True, timeout=15).stdout.strip()
        major, minor = (int(x) for x in out.lstrip("v").split(".")[:2])
    except Exception as e:  # noqa: BLE001
        return False, f"node -v 失败: {e}"
    if major < 20:
        return False, f"{out} 太旧（网页模板用 Vite 7，要 20.19+ / 22.12+）"
    if not shutil.which("npm"):
        return False, f"node {out} 在，但找不到 npm"
    warn = "（低于 Vite 7 建议的 20.19+ / 22.12+，构建可能告警）" if (major, minor) < (20, 19) or (
        major == 22 and minor < 12) else ""
    return True, f"{out}{warn}"


def probe_git_bash() -> Tuple[bool, str]:
    exe = shutil.which("bash")
    if not exe:
        return False, "找不到 bash"
    if "system32" in exe.lower():
        return False, f"{exe} 是 WSL 的 bash；网页脚手架需要 Git for Windows 的 Git Bash（放在 PATH 前面）"
    return True, exe


def probe_symlink() -> Tuple[bool, str]:
    """脚手架用 Git Bash 的 `ln -sfn` 建 node_modules 软链; Git Bash 默认会退化成复制目录 (除非开了
    开发者模式并设置 MSYS=winsymlinks:nativestrict), init-webapp 随后会因"不是软链"而中止。所以用
    同一个 bash 实际试一次。"""
    import tempfile

    bash = shutil.which("bash")
    if not bash:
        return False, "没有 bash，无法检查"
    with tempfile.TemporaryDirectory() as d:
        try:
            p = subprocess.run([bash, "-c", "mkdir a && ln -sfn a b && test -L b"], cwd=d, capture_output=True,
                               text=True, timeout=30)
        except Exception as e:  # noqa: BLE001
            return False, f"检查失败: {e}"
    if p.returncode == 0:
        return True, "Git Bash 能创建目录软链"
    return False, "Git Bash 建出来的不是软链（会退化成复制，网页脚手架会中止）"


def probe_registry() -> Tuple[bool, str]:
    m = pick("npm")
    if m.name == "用户指定":
        lat, why = _probe_url(m.url + "/-/ping")
        return lat is not None, f"{m.url} {why}"
    if m.latency is None:
        return False, "npm 源都连不上：" + "；".join(m.tried)
    return True, mirror_line("npm")


def _master_name() -> Optional[str]:
    pkg = TPL_DIR / "package.json"
    if not pkg.is_file():
        return None
    # 与 relink-node-modules.sh 的 PKG_HASH (md5 前 12 位) 一致
    return f"master-default-{hashlib.md5(pkg.read_bytes()).hexdigest()[:12]}"  # noqa: S324 - cache key


def probe_nm_master() -> Tuple[bool, str]:
    name = _master_name()
    if name is None:
        return False, f"模板缺失: {TPL_DIR / 'package.json'}"
    if (NM_LOCAL_ROOT / name).is_dir():
        return True, f"已预热 {NM_LOCAL_ROOT / name}"
    return False, "未预热（第一次搭网页工程时会现装依赖，多花几分钟）"


def _blender_candidates() -> List[str]:
    cands = [shutil.which("blender") or ""]
    if OS == "macos":
        cands.append("/Applications/Blender.app/Contents/MacOS/Blender")
    elif OS == "windows":
        import glob

        cands += sorted(glob.glob(r"C:\Program Files\Blender Foundation\Blender*\blender.exe"), reverse=True)
    return [c for c in cands if c and Path(c).exists()]


def probe_blender() -> Tuple[bool, str]:
    for exe in _blender_candidates():
        try:
            out = subprocess.run([exe, "-v"], capture_output=True, text=True, timeout=60).stdout
        except Exception as e:  # noqa: BLE001
            return False, f"{exe} 无法运行: {e}"
        m = re.search(r"Blender (\d+)\.(\d+)(?:\.(\d+))?", out)
        if not m:
            return False, f"{exe} 版本无法识别"
        if (int(m.group(1)), int(m.group(2))) < (4, 2):
            return False, f"Blender {m.group(1)}.{m.group(2)} 太旧（3D 流程用 EEVEE Next，要 4.2+）"
        return True, f"Blender {m.group(0)[8:]}（{exe}）"
    return False, "未安装（只有做 3D 动画才需要）"


def probe_jieba() -> Tuple[bool, str]:
    found = importlib.util.find_spec("jieba") is not None
    return found, "已装" if found else "未装 —— 中文字幕会退回逐字断行，断句没那么自然"


def probe_services() -> Tuple[bool, str]:
    """语音识别 / 配音 / 生图 / 生视频是外部服务, 由平台统一接入 (后续以 MCP 提供)。这里只报状态,
    不给配置命令: 不能让用户自己去申请账号或填 key。"""
    parts: List[str] = []

    def _try(label: str, fn: Callable[[], bool]) -> None:
        try:
            parts.append(f"{label}{'已配置' if fn() else '未接入'}")
        except Exception:  # noqa: BLE001 - 依赖没装齐时状态函数本身会失败
            parts.append(f"{label}未知")

    def _asr() -> bool:
        # Recognition uses the signed-in ZCode account; only the host address can be checked here.
        return bool((os.environ.get("ZCODE_BASE_URL") or "").strip())

    def _tts() -> bool:
        # TTS uses the signed-in ZCode account; only the host address can be checked here.
        return bool((os.environ.get("ZCODE_BASE_URL") or "").strip())

    def _image() -> bool:
        # The image generator uses the signed-in ZCode account; only the host address can be checked here.
        return bool((os.environ.get("ZCODE_BASE_URL") or "").strip())

    def _video() -> bool:
        # The video generator uses the signed-in ZCode account; only the host address can be checked here.
        return bool((os.environ.get("ZCODE_BASE_URL") or "").strip())

    for label, fn in (("语音识别", _asr), ("配音", _tts), ("生图", _image), ("生视频", _video)):
        _try(label, fn)
    return True, "；".join(parts) + " —— 未接入的功能暂不可用，用户无需自己申请账号"


# ── 修复命令 (按平台) ──────────────────────────────────────────────────────────
def _has(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def sys_python() -> List[str]:
    # Homebrew 里只有默认的 python 公式会提供 `python3` 命令 (python@3.12 这类只给 python3.12)
    if OS == "macos" and _has("brew"):
        return [env_prefix(brew_env()) + "brew install python"]
    return []


def manual_python() -> List[str]:
    dl = pick("python-dl")
    if OS == "macos":
        return ([] if not _has("brew") else ["# 或者不用 Homebrew，手动安装："]) + [
            f"# 下载安装包（{dl.label()}）并双击安装：{dl.url}/{PY_VER}/python-{PY_VER}-macos11.pkg",
            f"# 装完在「访达 → 应用程序 → Python 3.12」里双击 Install Certificates.command（装证书，只需一次）",
            "# 然后完全退出并重新打开 ZCode，再输入 /setup-guide 继续"]
    if OS == "windows":
        return ["# 推荐：打开 Microsoft Store，搜索「Python 3.12」安装（会自带 python3 命令）",
                f"# 或下载 python.org 安装包（{dl.label()}）：{dl.url}/{PY_VER}/python-{PY_VER}-amd64.exe",
                "#   安装时勾选 “Add python.exe to PATH”；之后按体检里 python3 那一项处理",
                "# 装完完全退出并重新打开 ZCode，再输入 /setup-guide 继续"]
    return ["sudo apt-get install -y python3 python3-pip python3-venv   # Ubuntu 22.04+ / Debian 12+ 自带 3.10+",
            "# 发行版太旧时可用 miniforge 装 Python 3.12"]


def manual_launcher() -> List[str]:
    if OS == "windows":
        if "windowsapps" in PY.lower():
            return ["# 当前是应用商店版 Python；完全退出并重新打开 ZCode 后再体检，python3 一般就能用"]
        return ["# 让 `python3` 指向这个 Python（复制一份 python.exe 改名为 python3.exe）：",
                f'copy "{Path(PY).with_name("python.exe")}" "{Path(PY).with_name("python3.exe")}"',
                "# 并在 设置 → 应用 → 高级应用设置 → 应用执行别名 里关掉 python3 的「应用安装程序」别名",
                "# 然后完全退出并重新打开 ZCode"]
    return [f'# 用插件实际会用的解释器重新体检：{LAUNCHER} "{SCRIPT}"',
            "# 若 python3 指向系统自带的旧版本：把新装 Python 的目录放到 PATH 前面，然后重开 ZCode"]


def sys_ffmpeg() -> List[str]:
    if OS == "macos" and _has("brew"):
        # Homebrew 的 ffmpeg 公式不带 libass/freetype (烧不了字幕), 带全的是 keg-only 的 ffmpeg-full,
        # 要 link 进 PATH 才能被插件找到; 已链接的其他 ffmpeg 版本占着同名文件, brew 会拒绝覆盖,
        # 所以先取消它们的链接 (不删除)。不加 --overwrite: 那会删掉前缀里用户自己放的同名文件
        return ["# 会先取消已链接的其他 ffmpeg 版本（只取消链接，不删除），再把 ffmpeg-full 链接到 PATH",
                env_prefix(brew_env()) + "brew install ffmpeg-full && { for f in ffmpeg ffmpeg@7 ffmpeg@6; do "
                "brew unlink $f >/dev/null 2>&1; done; brew link --force ffmpeg-full; }"]
    if OS == "windows" and _has("winget"):
        # Gyan 的 full 构建带 libass; 从 GitHub 下载, 国内可能慢
        return ["winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements"]
    return []


def manual_ffmpeg() -> List[str]:
    conda = (["# 已经在用 conda 的话也可以（装进当前 conda 环境）：conda install -c "
              f"{pick('conda-forge').url} ffmpeg"] if _has("conda") else [])
    if OS == "macos" and not _has("brew"):
        return homebrew_install_steps() + ["# Homebrew 装好后输入 /setup-guide，让我帮你装 ffmpeg"] + conda
    if OS == "linux":
        return ["sudo apt-get install -y ffmpeg   # 发行版的 ffmpeg 一般带全部编码器和 libass"] + conda
    if OS == "windows" and not _has("winget"):
        return ["# 到 https://www.gyan.dev/ffmpeg/builds/ 下载 ffmpeg-release-full.7z，",
                "#   解压后把其中的 bin 目录加入 PATH，然后完全退出并重新打开 ZCode"] + conda
    return conda


def homebrew_install_steps() -> List[str]:
    # 中科大镜像文档给的安装方式; 要输入开机密码, 可能先弹窗安装「命令行开发者工具」——只能用户自己在终端里做
    return ["# 先安装 Homebrew：打开「终端」App，把下面几行一起粘贴进去回车；它会要求输入开机密码（输入时不显示），",
            "#   如果弹窗要求安装「命令行开发者工具」，点「安装」并等它装完：",
            'export HOMEBREW_BREW_GIT_REMOTE="https://mirrors.ustc.edu.cn/brew.git"',
            'export HOMEBREW_CORE_GIT_REMOTE="https://mirrors.ustc.edu.cn/homebrew-core.git"',
            'export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.ustc.edu.cn/homebrew-bottles"',
            'export HOMEBREW_API_DOMAIN="https://mirrors.ustc.edu.cn/homebrew-bottles/api"',
            '/bin/bash -c "$(curl -fsSL https://mirrors.ustc.edu.cn/misc/brew-install.sh)"',
            "# 装完照屏幕最后的提示执行它给出的 `eval \"$(/opt/homebrew/bin/brew shellenv)\"` 等两行，然后重开 ZCode"]


def sys_node() -> List[str]:
    if OS == "macos" and _has("brew"):
        return [env_prefix(brew_env()) + "brew install node"]
    if OS == "windows" and _has("winget"):
        # 机器级安装, Windows 会弹权限确认 (需要用户点「是」); 从 nodejs.org 下载
        return ["winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements"]
    return []


def manual_node() -> List[str]:
    dl = pick("node-dl")
    alt = ["# 或者手动安装："] if sys_node() else []
    if OS == "macos":
        return alt + [f"# 下载 node-v22.*.pkg（{dl.label()}）并双击安装：{dl.browse}", "# 装好后完全退出并重新打开 ZCode"]
    if OS == "windows":
        return alt + [f"# 下载 node-v22.*-x64.msi（{dl.label()}）并安装：{dl.browse}", "# 装好后完全退出并重新打开 ZCode"]
    return [f"# 下载 node-v22.*-linux-x64.tar.xz（{dl.label()}）：{dl.browse}",
            "#   解压到 ~/.local/node 并把 ~/.local/node/bin 加入 PATH；或用发行版/NodeSource 的包"]


def sys_git_bash() -> List[str]:
    return ["winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements"] if _has(
        "winget") else []


def manual_symlink() -> List[str]:
    return ["# 1) 设置 → 系统 → 开发者选项 → 打开「开发人员模式」",
            "# 2) 让 Git Bash 创建真正的软链（写入用户环境变量，先征得用户同意）：setx MSYS winsymlinks:nativestrict",
            "# 3) 完全退出并重新打开 ZCode，再体检"]


def manual_blender() -> List[str]:
    dl = pick("blender-dl")
    arch = "arm64" if ARCH in ("arm64", "aarch64") else "x64"
    if OS == "macos":
        return [f"# 下载 blender-4.5.*-macos-{arch}.dmg（{dl.label()}），打开后拖进「应用程序」：{dl.browse}"]
    if OS == "windows":
        return [f"# 下载 blender-4.5.*-windows-x64.msi（{dl.label()}）并安装：{dl.browse}"]
    return [f"# 下载 blender-4.5.*-linux-x64.tar.xz（{dl.label()}），解压后把目录加入 PATH：{dl.browse}"]


def manual_font() -> List[str]:
    if OS == "linux":
        return ["sudo apt-get install -y fonts-noto-cjk   # Debian/Ubuntu；其他发行版装 Noto Sans CJK",
                "# 没有 sudo：把任意中文字体文件放进一个目录，设置 VE_FONT_DIRS=<目录> 后重开 ZCode"]
    return ["# macOS/Windows 自带苹方/微软雅黑，正常不会缺；若字体被删，装一个中文字体，",
            "#   或设置 VE_FONT_DIRS=<字体所在目录> 后重开 ZCode"]


def manual_certs() -> List[str]:
    return ["# 在「访达 → 应用程序 → Python 3.x」里双击 Install Certificates.command，然后重新体检"]


def fix_scenedetect() -> List[str]:
    deps = [spec for pkg, spec in requirements() if pkg in RIDERS]
    return ([pip_cmd(*deps)] if deps else []) + [pip_cmd(req_spec("scenedetect", "scenedetect"), no_deps=True),
                                                  "# --no-deps 是硬要求：它声明的 opencv-python(GUI 版) 会盖坏 headless 版"]


def fix_nm_master() -> List[str]:
    return [f"TEMPLATE_NAME=default bash \"{WEB_SCRIPTS / 'relink-node-modules.sh'}\" \"{TPL_DIR}\" --prepare-only"]


# ── 检查清单 (顺序即展示/依赖顺序) ───────────────────────────────────────────────
def build_checks() -> List[Check]:
    checks: List[Check] = [
        Check("py", "core", f"Python ≥ {MIN_PY[0]}.{MIN_PY[1]}", "插件的工具服务和启动检查都靠它运行",
              probe_py_version, need=f"Python {MIN_PY[0]}.{MIN_PY[1]} 或更高（推荐 3.12）",
              sys_fix=sys_python, manual=manual_python, cheap=True),
        Check("launcher", "core", f"插件启动用的 {LAUNCHER}", "ZCode 用这个命令启动插件；依赖必须装进它对应的环境",
              probe_launcher, need=f"`{LAUNCHER}` 命令存在，且就是装依赖的那个 Python 环境",
              manual=manual_launcher, cheap=True, needs="py"),
        Check("certs", "core", "Python 的 HTTPS 证书", "插件用标准库访问 HTTPS 时的证书校验", probe_certs,
              need="CA 证书（python.org 安装包需运行一次 Install Certificates.command）", manual=manual_certs,
              soft=True, needs="py", platforms=("macos",)),
        Check("pip", "core", "pip（Python 包管理）", "所有 Python 依赖都靠它安装", probe_pip,
              need="python3 -m pip 可用", fix=[f"{PYQ} -m ensurepip --upgrade"], auto=True, cheap=True, needs="py",
              manual=by_os(linux=["sudo apt-get install -y python3-pip"])),
    ]
    for package, spec in requirements():
        if package in RIDERS:
            continue
        cid = f"py-{package}"
        why = PACKAGE_WHY.get(package, "插件代码依赖")
        if package == "mcp":
            checks.append(Check(cid, "core", "Python 包 mcp（1.x）", why, probe_mcp(spec), need=f"pip 包 {spec}",
                                fix=lambda spec=spec: [pip_cmd(spec)], auto=True, slow=True, cheap=True, needs="pip"))
        elif package in NO_DEPS:
            checks.append(Check(cid, "core", f"Python 包 {package}", why, probe_package(package, spec),
                                need=f"pip 包 {spec}（必须 --no-deps 安装）", fix=fix_scenedetect,
                                auto=True, slow=True, cheap=True, needs="pip"))
        else:
            checks.append(Check(cid, "core", f"Python 包 {package}", why, probe_package(package, spec),
                                need=f"pip 包 {spec}", fix=lambda spec=spec: [pip_cmd(spec)],
                                auto=True, slow=True, cheap=True, needs="pip"))
    cv2_spec = req_spec("opencv-python-headless", "opencv-python-headless")
    checks += [
        Check("cv2-clean", "core", "OpenCV 没有混装", "GUI 版和 headless 版混装会让抽帧半坏", probe_cv2_conflict,
              need="只保留 opencv-python-headless",
              manual=lambda: [f"{PYQ} -m pip uninstall -y opencv-python   # 卸载前先问用户：GUI 版可能是别的项目装的",
                              pip_cmd(cv2_spec, extra="--force-reinstall")],
              cheap=True, needs="py-opencv-python-headless"),
        Check("ffmpeg", "core", "ffmpeg + ffprobe", "读视频、剪切、渲染、抽帧 —— 缺了所有剪辑功能都用不了",
              probe_bins("ffmpeg", "ffprobe"), need="带 libx264 / libass 的完整版 ffmpeg（含 ffprobe），在 PATH 上",
              sys_fix=sys_ffmpeg, manual=manual_ffmpeg, cheap=True),
        Check("ffmpeg-encoders", "core", "ffmpeg 编码器", "成片编码；缺了渲染到最后一步才失败", probe_ffmpeg_encoders,
              need="带 libx264、aac、libmp3lame 的完整版 ffmpeg", sys_fix=sys_ffmpeg, manual=manual_ffmpeg,
              cheap=True, needs="ffmpeg"),
        Check("ffmpeg-filters", "core", "ffmpeg 字幕/文字滤镜", "烧录字幕、标题卡、转场", probe_ffmpeg_filters,
              need="带 libass（subtitles/ass）和 libfreetype（drawtext）的 ffmpeg（Homebrew 要装 ffmpeg-full）",
              sys_fix=sys_ffmpeg, manual=manual_ffmpeg, cheap=True, needs="ffmpeg"),
        Check("font-cjk", "core", "中文字体", "字幕、标题卡里的中文（缺了会显示成方块）", probe_font,
              need="一个真能显示中文的字体（macOS 苹方 / Windows 微软雅黑 / Linux Noto CJK）",
              manual=manual_font, needs="py-fonttools"),
        Check("disk", "core", f"磁盘空间 ≥ {MIN_FREE_GB} GB", "成片和抽帧图都写在项目目录", probe_disk,
              need=f"项目所在磁盘至少 {MIN_FREE_GB} GB 空闲", manual=["# 清理项目里 out/ 和 .video_agent/ 下的旧产物"],
              cheap=True, soft=True),
        # 网页/游戏/全栈复刻
        Check("node", "web", "Node.js ≥ 20 + npm", "搭建和构建复刻出来的网页工程", probe_node,
              need="Node.js 20.19+ 或 22.12+（推荐 22 LTS），自带 npm", sys_fix=sys_node, manual=manual_node),
        Check("bash", "web", "Git Bash", "网页工程脚手架是 .sh 脚本", probe_git_bash,
              need="Git for Windows 自带的 Git Bash", sys_fix=sys_git_bash,
              manual=["# 或手动安装 Git for Windows：https://registry.npmmirror.com/binary.html?path=git-for-windows/"],
              platforms=("windows",)),
        Check("symlink", "web", "Git Bash 能建软链", "脚手架要求 node_modules 是软链", probe_symlink,
              need="开发者模式 + MSYS=winsymlinks:nativestrict", manual=manual_symlink, needs="bash",
              platforms=("windows",)),
        Check("npm-registry", "web", "npm 下载源", "安装网页工程依赖", probe_registry,
              need="能访问一个 npm 源（自动选用最快的国内镜像或官方源）",
              manual=["# 公司网络需要代理时：在系统里设好 https_proxy 后重开 ZCode，再运行体检"], needs="node"),
        Check("nm-master", "web", "网页依赖预热", "第一次搭网页工程时少等几分钟（非必需）", probe_nm_master,
              need="与模板 package.json 匹配的 node_modules 缓存", fix=fix_nm_master,
              env=lambda: {"npm_config_registry": pick("npm").url}, auto=True, slow=True, soft=True,
              needs="npm-registry", platforms=("macos", "linux")),
        # 3D
        Check("blender", "3d", "Blender ≥ 4.2", "code2video 的 3D 动画渲染（2D 动画和其他功能不需要）",
              probe_blender, need="Blender 4.2 或更高（推荐 4.5 LTS）", manual=manual_blender, soft=True),
        # 可选增强。只放通用的东西：某个功能才用的模型（如创作声纹检查的 CAM++）由该功能
        # 第一次调用时从魔搭下载（ve_tools/model_store.py），不在环境体检里装。
        Check("jieba", "extras", "中文分词 jieba", "中文字幕按词断行（没有也能用，按字断行）", probe_jieba,
              need="pip 包 jieba", fix=lambda: [pip_cmd("jieba>=0.42.1")], auto=True, soft=True, needs="pip"),
        # 外部服务
        Check("services", "services", "语音 / 生成服务", "转写、配音、AI 生图生视频", probe_services,
              info=True, needs="py-requests"),
    ]
    return checks


CHECKS = build_checks()
MARK = {"ok": "✓", "missing": "✗", "skip": "–", "na": "·", "info": "i"}


def _pad(text: str, width: int) -> str:
    """按显示宽度补空格 (中文占两格), 让标签列在终端里对齐。"""
    import unicodedata

    shown = sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in text)
    return text + " " * max(1, width - shown)


def run_checks(cheap_only: bool = False, only_groups: Optional[set] = None) -> List[Result]:
    results: List[Result] = []
    failed: set = set()
    for c in CHECKS:
        if cheap_only and not c.cheap:
            continue
        if only_groups is not None and c.group not in only_groups:
            continue
        if c.platforms and OS not in c.platforms:
            results.append(Result(c, "na", f"本平台（{OS}）不需要"))
            continue
        if c.needs and c.needs in failed:
            results.append(Result(c, "skip", f"前置项 {c.needs} 未通过，暂未检查"))
            failed.add(c.id)
            continue
        try:
            ok, detail = c.probe()
        except Exception as e:  # noqa: BLE001 - 探测本身炸了也是环境问题, 不许静默
            ok, detail = False, f"检查出错 {type(e).__name__}: {e}"
        if not ok and not c.info:
            failed.add(c.id)
        status = "info" if c.info else ("ok" if ok else "missing")
        results.append(Result(c, status, detail))
    return results


def cheap_missing() -> List[str]:
    """SessionStart hook 用: 只跑快速、不联网的基础项, 返回缺失项「标签（为什么需要）」列表。
    前置没过而跳过的项不列 (它们的根因已经在列表里)。"""
    global _NETWORK, _QUICK
    saved = (_NETWORK, _QUICK)
    _NETWORK, _QUICK = False, True
    try:
        return [f"{r.check.label}（{r.check.why}）" for r in run_checks(cheap_only=True, only_groups={"core"})
                if r.status == "missing" and not r.check.soft]
    finally:
        _NETWORK, _QUICK = saved


def _is_pydep(r: Result) -> bool:
    return r.check.id.startswith("py-") and r.check.auto and r.check.group == "core"


def _summary(rows: List[Result]) -> str:
    """缺口的一句话说法: 一串 Python 包合并成「Python 依赖 N 个」, 免得汇总行比清单还长。"""
    deps = [r for r in rows if _is_pydep(r)]
    names = [f"Python 依赖 {len(deps)} 个"] if len(deps) > 1 else [r.check.label for r in deps]
    return "、".join(names + [r.check.label for r in rows if not _is_pydep(r)])


def capabilities(results: List[Result]) -> List[Tuple[str, Optional[bool], List[Result]]]:
    """(能力, 是否就绪 / None=没检查, 缺的项)。前置没过而跳过的项不算"缺" (根因已经在列表里),
    但能力不算就绪。"""
    by_group: Dict[str, List[Result]] = {}
    for r in results:
        by_group.setdefault(r.check.group, []).append(r)

    def state(group: str) -> Tuple[Optional[bool], List[Result]]:
        rows = [r for r in by_group.get(group, []) if r.status != "na" and (not r.check.soft or group == "3d")]
        if not rows:
            return None, []
        bad = [r for r in rows if r.status in ("missing", "skip")]
        return not bad, [r for r in bad if r.status == "missing"]

    core_ok, core_miss = state("core")
    web_ok, web_miss = state("web")
    d3_ok, d3_miss = state("3d")

    def both(a: Optional[bool], b: Optional[bool]) -> Optional[bool]:
        return None if b is None else (bool(a) and b)

    return [("视频理解 / 剪辑 / 字幕 / 解说（本地处理部分）", core_ok, core_miss),
            ("网页 / 游戏 / 全栈复刻", both(core_ok, web_ok), web_miss),
            ("3D 动画渲染", both(core_ok, d3_ok), d3_miss)]


def render(results: List[Result]) -> str:
    out = [f"video-agent-kit 环境体检（{OS} {ARCH} · Python {sys.version.split()[0]} · {PY}）"]
    if _NETWORK:
        out.append(f"下载源：pip → {mirror_line('pypi')}；npm → {mirror_line('npm')}")
        if OS == "macos":
            out.append(f"        Homebrew → {mirror_line('homebrew')}")
        out.append(f"代理：{proxy_summary()}")
    else:
        out.append("（快速模式：只查了基础组里不联网的项；字体、下载源、网页和 3D 相关项没有检查）")
    for gid, title in GROUPS:
        rows = [r for r in results if r.check.group == gid]
        if not rows:
            continue
        out.append(f"\n【{title}】")
        for r in rows:
            out.append(f"  {MARK[r.status]} {_pad(r.check.label, 30)}{r.detail}")
    out.append("\n能力汇总：")
    caps = capabilities(results)
    core_ready = bool(caps[0][1])
    for i, (name, ready, missing) in enumerate(caps):
        if ready is None:
            out.append(f"  – {name}：没有检查")
            continue
        if ready:
            text = "就绪"
        else:
            bits = (["先完成基础组"] if i > 0 and not core_ready else []) + (
                ["缺 " + _summary(missing)] if missing else [])
            text = "；".join(bits) or "等前面的项装好后复查"
        out.append(f"  {'✓' if ready else '✗'} {name}：{text}")
    todo = [r for r in results if r.status == "missing" and not r.check.info]
    later = [r for r in results if r.status == "skip" and not r.check.info]
    if not todo and not later:
        out.append("\n全部就绪，不需要安装任何东西。" if _NETWORK else "\n快速检查的项都就绪。")
        return "\n".join(out)
    out.append("\n待处理（按顺序）：")
    n = 0
    deps = [r for r in todo if _is_pydep(r)]
    if deps:
        n += 1
        names = "、".join(r.check.label.replace("Python 包 ", "") for r in deps)
        out.append(f"  {n}. Python 依赖 {len(deps)} 个（{names}）  [自动安装（--fix），约几分钟]")
        out.append("     影响：插件的工具服务本身（mcp），以及读视频、抽帧、字幕排版、视频检索下载、镜头切分要用的库")
        out.append(f"     下载源：{mirror_line('pypi') if _NETWORK else pick('pypi').url}")
    shown_sys: set = set()
    for r in todo:
        if _is_pydep(r):
            continue
        c = r.check
        n += 1
        sys_cmds = [x for x in _lines(c.sys_fix) if x not in shown_sys]
        kind = ("自动安装（--fix）" if c.auto and c.group == "core" else
                f"可选，自动安装需 --fix --with {c.group}" if c.auto else
                "系统软件（征得同意后 --fix --system" + ("" if c.group == "core" else f" --with {c.group}") + "）"
                if _lines(c.sys_fix) else "需要用户手动完成")
        out.append(f"  {n}. {c.label}（id: {c.id}）  [{kind}{'，只影响部分功能' if c.soft else ''}{'，耗时几分钟' if c.slow else ''}]")
        out.append(f"     影响：{c.why}")
        if c.need:
            out.append(f"     需要：{c.need}")
        if _lines(c.sys_fix) and not sys_cmds:
            out.append("     （和上面同一条安装命令）")
            continue
        for cmd in _lines(c.fix) + sys_cmds + _lines(c.manual):
            out.append(f"     {cmd}")
        shown_sys.update(sys_cmds)
    if later:
        out.append(f"  另有 {len(later)} 项要等上面的装好后再检查：" + "、".join(r.check.label for r in later))
    out.append("\n下一步：")
    if any(_is_pydep(r) or (r.check.auto and r.check.group == "core") for r in todo):
        out.append(f"  · 自动安装 Python 依赖：{LAUNCHER} \"{SCRIPT}\" --fix")
    if any(_lines(r.check.sys_fix) for r in todo):
        out.append(f"  · 系统软件（先征得用户同意，只装同意的那几项）：{LAUNCHER} \"{SCRIPT}\" --fix --system --only <项 id>")
    out.append("  · 装完后重新运行本体检确认；装了新软件后若仍检测不到，完全退出并重新打开 ZCode 再试")
    return "\n".join(out)


def in_scope(c: Check, with_: set, only: set) -> bool:
    """--fix 动手的范围: 指定了 --only 就只处理那几项 (id、id 前缀或组名; `ffmpeg` 同时覆盖
    ffmpeg-encoders / ffmpeg-filters, `py` 覆盖所有 py-* 包); 否则基础组 + --with 打开的组。"""
    if only:
        return any(c.id == x or c.id.startswith(x + "-") or c.group == x for x in only)
    return c.group == "core" or c.group in with_ or "all" in with_


def _run(cmd: str, env: Optional[Dict[str, str]] = None, to_stderr: bool = False) -> int:
    print(f"$ {cmd}", file=sys.stderr if to_stderr else sys.stdout, flush=True)
    try:
        return subprocess.run(cmd, shell=True, timeout=1800, env={**os.environ, **(env or {})},
                              stdout=sys.stderr if to_stderr else None).returncode
    except subprocess.TimeoutExpired:
        print("  超时（30 分钟）", file=sys.stderr if to_stderr else sys.stdout, flush=True)
        return 124


def do_fix(results: List[Result], system: bool, with_: set, only: set, to_stderr: bool = False) -> int:
    """执行范围内缺失项的修复命令; 返回执行了几组。同一条命令只跑一次 (ffmpeg 的三项共用一条安装命令)。
    manual 步骤 (sudo、密码、手动下载、卸载) 永远不执行。"""
    ran, done = 0, set()
    out = sys.stderr if to_stderr else sys.stdout
    for r in results:
        c = r.check
        if r.status != "missing" or not in_scope(c, with_, only):
            continue
        cmds: List[str] = []
        if c.auto:
            cmds += [x for x in _lines(c.fix) if not x.lstrip().startswith("#")]
        if system:
            cmds += [x for x in _lines(c.sys_fix) if not x.lstrip().startswith("#")]
        cmds = [x for x in cmds if x not in done]
        if not cmds:
            continue
        ran += 1
        print(f"\n── 安装：{c.label}", file=out, flush=True)
        env = c.env() if callable(c.env) else {}
        for cmd in cmds:
            done.add(cmd)
            code = _run(cmd, env, to_stderr)
            if code != 0:
                print(f"  ✗ 失败（退出码 {code}）—— 看上面的报错；常见原因：网络/代理、权限不足、磁盘满", file=out, flush=True)
                break
    if not ran:
        print("没有可自动执行的安装项（剩下的需要用户手动完成，或不在这次同意的范围内）。", file=out, flush=True)
    importlib.invalidate_caches()
    return ran


def payload(results: List[Result]) -> dict:
    checks = [{"id": r.check.id, "group": r.check.group, "label": r.check.label, "status": r.status,
               "detail": r.detail, "why": r.check.why, "need": r.check.need, "soft": r.check.soft,
               "auto": r.check.auto,
               "fix": (_lines(r.check.fix) + _lines(r.check.sys_fix) + _lines(r.check.manual))
               if r.status == "missing" else []} for r in results]
    data = {
        "plugin_root": str(PLUGIN_ROOT), "platform": OS, "arch": ARCH, "python": PY,
        "python_version": sys.version.split()[0], "checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "network_checked": _NETWORK, "proxy": proxy_summary(), "checks": checks,
        # 放在 checks 之后: 生成修复命令时才会探测安装包镜像, 这里要把它们一并记下
        "mirrors": {k: {"name": m.name, "url": m.url, "latency_s": m.latency, "tried": m.tried}
                    for k, m in _MIRROR_CACHE.items()},
        "capabilities": [{"name": n, "ready": ok, "missing": [r.check.label for r in miss]}
                         for n, ok, miss in capabilities(results)],
    }
    data["missing"] = [c["id"] for c in checks if c["status"] in ("missing", "skip")]
    data["blocking"] = [c["id"] for c in checks
                        if c["status"] in ("missing", "skip") and c["group"] == "core" and not c["soft"]]
    data["core_ready"] = not data["blocking"]
    return data


def write_receipts(data: dict) -> None:
    """落回执: 项目内一份 (给后续轮次看), 本机一份 (hook 据此判断这台电脑是否做过体检)。"""
    text = json.dumps(data, ensure_ascii=False, indent=2)
    for folder in (PROJECT_DIR / ".video_agent", MACHINE_STATE):
        try:
            folder.mkdir(parents=True, exist_ok=True)
            (folder / "env_report.json").write_text(text, encoding="utf-8")
        except OSError:
            pass


def main(argv: Optional[List[str]] = None) -> int:
    global _NETWORK, _QUICK
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001 - Windows cp936 控制台
            pass
    ap = argparse.ArgumentParser(description="video-agent-kit 环境体检与安装")
    ap.add_argument("--fix", action="store_true", help="自动安装基础组的 Python 依赖（用户态）")
    ap.add_argument("--system", action="store_true", help="配合 --fix：执行系统级安装命令（brew/winget）")
    ap.add_argument("--with", dest="with_", action="append", default=[], choices=["web", "3d", "extras", "all"],
                    help="配合 --fix：把可选组也纳入安装范围")
    ap.add_argument("--only", default="", help="配合 --fix：只处理这些检查项 id 或组名（逗号分隔）")
    ap.add_argument("--cheap", action="store_true", help="只跑不联网的快速基础项（hook 用）")
    ap.add_argument("--json", action="store_true", help="机器可读输出")
    args = ap.parse_args(argv)

    _NETWORK, _QUICK = not args.cheap, args.cheap
    if _NETWORK:
        resolve_mirrors()
    results = run_checks(cheap_only=args.cheap)
    if args.fix and not args.cheap:
        if not args.json:
            print(render(results) + "\n", flush=True)
        only = {x.strip() for x in args.only.split(",") if x.strip()}
        do_fix(results, system=args.system, with_=set(args.with_), only=only, to_stderr=args.json)
        # 复查放到新进程里: --user 安装可能刚创建用户 site-packages, 本进程的 sys.path 看不到它,
        # 同进程复查会把刚装好的包误报成"未安装"。
        print("\n── 安装后复查 ──", file=sys.stderr if args.json else sys.stdout, flush=True)
        recheck = [PY, str(SCRIPT)] + (["--json"] if args.json else [])
        return subprocess.run(recheck, env={**os.environ, "PYTHONIOENCODING": "utf-8"}).returncode
    data = payload(results)
    if not args.cheap:
        write_receipts(data)
    print(json.dumps(data, ensure_ascii=False, indent=2) if args.json else render(results))
    return 1 if data["blocking"] else 0


if __name__ == "__main__":
    sys.exit(main())
