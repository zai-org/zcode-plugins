#!/usr/bin/env python3
"""video2code 环境体检: 逐项探测 → 输出「缺什么 / 挂哪个能力 / 本平台怎么装」。

跨平台 (macOS / Windows / Linux)。设计约束:
- **要求先于命令**: 每项先说清"需要什么"(名字 + 版本线), 再按当前平台给**一条**
  示例命令。用户的机器长什么样这里不知道 (有没有 brew/winget、有没有管理员权限、
  是不是 conda 环境), 所以命令是示例不是规定 —— 只有要求是硬的。
- **探测与修复分离**: 默认只读探测; `--fix` 才动手, 且只跑标了 auto 的项 (用户态、
  幂等)。要装系统级软件 (ffmpeg / node / 系统库) 的项永远只打印, 不自动执行。
- **单一事实源**: SessionStart hook (`hooks/env_check.py`) 直接 import 这里的
  cheap 检查项, 依赖清单不许两处各写一份 (漂移过一次就永远漂移)。
- **探测顺序即依赖顺序**: 后置项标 `needs`, 前置失败则整项跳过
  (报 skip 而不是伪失败), 免得一个根因炸出五条噪音。
- **平台不适用 ≠ 缺失**: 有的项只在某些平台成立 (node_modules 本地盘缓存要 .sh
  脚手架; bash/软链权限只有 Windows 会缺), 不适用就报 n/a 且不计入未就绪 ——
  否则用户永远看着几条修不掉的红叉。

用法:
  env_doctor.py            # 全量探测 + 修复计划
  env_doctor.py --cheap    # 只跑毫秒级项 (无子进程/无网络), hook 用
  env_doctor.py --json     # 机器可读
  env_doctor.py --fix      # 探测后自动装 auto 项, 再复测这些项
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import importlib.metadata as importlib_metadata
import json
import os
import site
import shutil
import subprocess
import sys
import sysconfig
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

PLUGIN_ROOT = Path(os.environ.get("CLAUDE_PLUGIN_ROOT")
                   or Path(__file__).resolve().parents[3])
PROJECT_DIR = Path(os.environ.get("CLAUDE_PROJECT_DIR") or Path.cwd())
WEB_SCRIPTS = PLUGIN_ROOT / "skills" / "web-replicate" / "scripts"
TPL_DIR = PLUGIN_ROOT / "skills" / "web-replicate" / "templates" / "default" / "template"
NM_LOCAL_ROOT = Path(os.environ.get("NM_LOCAL_ROOT", "/tmp/webapp-node-modules"))
PY = sys.executable or ("python" if os.name == "nt" else "python3")
# 命令行里用 PYQ: Windows 解释器路径常含空格, do_fix 又走 shell=True
PYQ = f'"{PY}"' if " " in PY else PY
PIP_INSTALL = f"{PYQ} -m pip install"
if sys.prefix == sys.base_prefix:
    PIP_INSTALL += " --user"
    if (Path(sysconfig.get_path("stdlib")) / "EXTERNALLY-MANAGED").is_file():
        PIP_INSTALL += " --break-system-packages"

OS = ("macos" if sys.platform == "darwin"
      else "windows" if os.name == "nt" else "linux")


def by_os(**variants: list[str]) -> list[str]:
    """按当前平台取一份修复示例; 缺本平台条目时回落 any。"""
    return variants.get(OS) or variants.get("any") or []


# ── 检查项模型 ───────────────────────────────────────────────────────────────
@dataclass
class Check:
    id: str
    label: str
    why: str                              # 缺了会挂掉哪个能力 (给模型/用户判断优先级)
    probe: Callable[[], tuple[bool, str]]  # → (ok, 细节一行)
    need: str = ""                         # 硬要求一行 ("装什么、什么版本线")
    fix: list[str] = field(default_factory=list)   # 本平台示例命令 (可空)
    cheap: bool = False                   # 毫秒级 (最多 -v 级子进程)、不碰网络 → hook 可跑
    auto: bool = False                    # --fix 允许自动执行 (只用户态、幂等)
    slow: bool = False                    # 修复耗时以分钟计, 需要长 timeout
    needs: str = ""                       # 前置检查项 id; 前置失败则本项 skip
    platforms: tuple[str, ...] = ()       # 限定平台 (空 = 全平台)


@dataclass
class Result:
    check: Check
    status: str   # ok | missing | skip | na
    detail: str


# ── 探测实现 ─────────────────────────────────────────────────────────────────
def probe_py_version() -> tuple[bool, str]:
    v = sys.version_info
    return v >= (3, 10), f"{v.major}.{v.minor}.{v.micro} at {PY}"


def probe_module(mod: str) -> Callable[[], tuple[bool, str]]:
    def _p() -> tuple[bool, str]:
        try:
            spec = importlib.util.find_spec(mod)
        except Exception as e:                       # 包坏了 (半装/依赖缺) 也算缺
            return False, f"find_spec 报错: {e}"
        return bool(spec), (spec.origin or "已装") if spec else "未安装"
    return _p


MCP_SDK_VERSION = "1.9.0"


def probe_mcp_sdk() -> tuple[bool, str]:
    """MCP 2.x 删除了 Server.list_tools/call_tool，不能只检查模块是否存在。"""
    try:
        spec = importlib.util.find_spec("mcp")
    except Exception as e:
        return False, f"find_spec 报错: {e}；需要 mcp=={MCP_SDK_VERSION}"
    if not spec:
        return False, f"未安装；需要 mcp=={MCP_SDK_VERSION}"
    try:
        version = importlib_metadata.version("mcp")
    except importlib_metadata.PackageNotFoundError:
        return False, f"无法读取版本；需要 mcp=={MCP_SDK_VERSION}"
    if version != MCP_SDK_VERSION:
        return False, f"当前 {version} 不兼容；需要 mcp=={MCP_SDK_VERSION}"
    return True, f"{version} at {spec.origin or '已装'}"


def probe_bins(*bins: str) -> Callable[[], tuple[bool, str]]:
    def _p() -> tuple[bool, str]:
        found = {b: shutil.which(b) for b in bins}
        miss = [b for b, p in found.items() if not p]
        if miss:
            return False, "PATH 上找不到: " + " ".join(miss)
        return True, "; ".join(f"{b}={p}" for b, p in found.items())
    return _p


def probe_node() -> tuple[bool, str]:
    exe = shutil.which("node")
    if not exe:
        return False, "PATH 上找不到 node"
    try:
        out = subprocess.run([exe, "-v"], capture_output=True, text=True,
                             timeout=15).stdout.strip()
    except Exception as e:
        return False, f"node -v 失败: {e}"
    try:
        major, minor = (int(x) for x in out.lstrip("v").split(".")[:2])
    except ValueError:
        return False, f"版本号无法解析: {out}"
    # 模板是 Vite 7, 官方要求 20.19+ / 22.12+; 20 以下 build 直接起不来。
    if major < 20:
        return False, f"{out} 过低 (Vite 7 要 20.19+ / 22.12+)"
    npm = shutil.which("npm")
    if not npm:
        return False, f"node {out} 在, 但 PATH 上找不到 npm"
    if (major, minor) < (20, 19) or (major == 22 and minor < 12):
        return True, f"{out} ⚠️ 低于 Vite 7 建议线 (20.19+ / 22.12+), 构建可能告警"
    return True, f"{out} at {exe}; npm={npm}"


def probe_tmp_space() -> tuple[bool, str]:
    """node_modules master 缓存要 ~1G + delta 构建临时占用; 本地盘满了会留残缺 master。"""
    target = NM_LOCAL_ROOT if NM_LOCAL_ROOT.exists() else NM_LOCAL_ROOT.parent
    try:
        free_gb = shutil.disk_usage(target).free / 2**30
    except OSError as e:
        return False, f"{target} 无法统计: {e}"
    return free_gb >= 3, f"{target} 剩余 {free_gb:.1f}G" + ("" if free_gb >= 3 else " (<3G)")


def probe_symlink() -> tuple[bool, str]:
    """能不能建软链 —— Windows 上默认不能 (要开发者模式/管理员)。

    这不是洁癖: init-webapp.sh 落位后硬断言 `[[ -L node_modules ]]`, 建不出软链
    就直接 abort, 脚手架整个用不了。宁可在体检里说清楚, 也不要让用户跑到一半才撞上。
    """
    import tempfile
    try:
        with tempfile.TemporaryDirectory() as d:
            src, dst = Path(d) / "src", Path(d) / "link"
            src.mkdir()
            os.symlink(src, dst, target_is_directory=True)
            ok = dst.is_symlink()
        return ok, "可创建目录软链" if ok else "os.symlink 成功但不是软链 (被复制了)"
    except OSError as e:
        return False, f"建软链失败: {e.__class__.__name__}: {e}"



def probe_npm_registry() -> tuple[bool, str]:
    """npm registry 可达性 —— 装 node_modules 的前提, 出网需要配置时这里先炸。"""
    npm = shutil.which("npm")     # Windows 上是 npm.cmd, 必须用解析后的完整路径
    if not npm:
        return False, "npm 缺失, 跳过连通性判断"
    try:
        p = subprocess.run([npm, "ping", "--registry",
                            os.environ.get("NPM_CONFIG_REGISTRY",
                                           "https://registry.npmjs.org")],
                           capture_output=True, text=True, timeout=30,
                           shell=(os.name == "nt"))
    except subprocess.TimeoutExpired:
        return False, "npm ping 30s 超时 (疑似需要 https_proxy)"
    except Exception as e:
        return False, f"npm ping 失败: {e}"
    if p.returncode == 0:
        return True, "registry 可达"
    tail = (p.stderr or p.stdout).strip().splitlines()[-1:] or [""]
    return False, f"npm ping 退出码 {p.returncode}: {tail[0][:200]}"


def _master_name() -> str | None:
    pkg = TPL_DIR / "package.json"
    if not pkg.is_file():
        return None
    return f"master-default-{hashlib.md5(pkg.read_bytes()).hexdigest()[:12]}"


def probe_nm_master() -> tuple[bool, str]:
    """webapp 依赖预热态 —— 哈希必须精确匹配当前模板 package.json。

    "存在任意 master 即就绪"会在模板依赖变更后放过旧 master, init 时走 delta 重建
    (inode 事故链一环), 所以这里跟 env_check.py 一样按哈希判定。
    """
    name = _master_name()
    if name is None:
        return False, f"模板缺失: {TPL_DIR / 'package.json'}"
    if (NM_LOCAL_ROOT / name).is_dir():
        return True, f"{NM_LOCAL_ROOT / name} 已就绪"
    if (NM_LOCAL_ROOT / ".preparing").exists():
        return False, "SessionStart 后台预热进行中 (见 prepare.log), 未完成"
    stale = sorted(NM_LOCAL_ROOT.glob("master-default-*")) if NM_LOCAL_ROOT.is_dir() else []
    return False, (f"缺 {name}" + (f"; 存在旧哈希 master {len(stale)} 份 (会走 delta 重建)"
                                   if stale else ""))


# ── 检查清单 (顺序即展示顺序) ────────────────────────────────────────────────
PY_MODULES = [
    ("cv2", "opencv-python-headless", "clip_video 差分选帧 / 抽帧"),
    ("numpy", "numpy", "选帧与白帧过滤的数值运算"),
    ("PIL", "pillow", "contact sheet 拼图 / still_crops"),
]

CHECKS: list[Check] = [
    Check("py", "Python ≥ 3.10", "hook 与 MCP server 用了 3.10+ 语法 (X | Y 注解)",
          probe_py_version,
          need="Python 3.10 或更高 (CC 调 hook/MCP 用的就是这个解释器)",
          fix=by_os(any=["# 换一个 3.10+ 解释器, 例如 conda create -n v2c python=3.12"]),
          cheap=True),
    Check("py-mcp", f"python 包: mcp=={MCP_SDK_VERSION}",
          "MCP server 本体 — 缺少或装到 2.x 会导致 deploy/clip_video 工具不存在",
          probe_mcp_sdk,
          need=f"pip 包 mcp=={MCP_SDK_VERSION} (2.x 已删除本插件使用的 Server decorator API)",
          fix=[f"{PIP_INSTALL} mcp=={MCP_SDK_VERSION}"],
          cheap=True, auto=True, needs="py"),
    *[Check(f"py-{mod}", f"python 包: {mod}", why, probe_module(mod),
            need=f"pip 包 {pkg} (装进上面那个解释器, 不是系统里随便哪个 python)",
            fix=[f"{PIP_INSTALL} {pkg}"], cheap=True, auto=True, needs="py")
      for mod, pkg, why in PY_MODULES],
    Check("ffmpeg", "ffmpeg + ffprobe", "video MCP 摄入 / clip 抽帧 / 时长探测 / url2video 把录制的 WebM 转成 MP4（必需）",
          probe_bins("ffmpeg", "ffprobe"),
          need="ffmpeg (含 ffprobe), 且在 PATH 上 —— 版本不挑, 4.x 起都行",
          fix=by_os(
              macos=["brew install ffmpeg"],
              windows=["winget install --id Gyan.FFmpeg -e",
                       "# 或 choco install ffmpeg / scoop install ffmpeg",
                       "# 装完新开一个终端, 否则 PATH 不刷新"],
              linux=["sudo apt-get install -y ffmpeg   # 或发行版对应的包管理器"],
              any=["# 无管理员权限时任何平台都可: conda install -c conda-forge ffmpeg"]),
          cheap=True),
    Check("node", "node ≥ 20 + npm", "webapp 模板构建 (Vite 7 + Tailwind v4)",
          probe_node,
          need="Node.js ≥ 20 (Vite 7 要 20.19+ / 22.12+; 建议 LTS) + 自带的 npm",
          fix=by_os(
              macos=["brew install node   # 或 nvm install --lts"],
              windows=["winget install --id OpenJS.NodeJS.LTS -e",
                       "# 或装 nvm-windows 后 nvm install lts",
                       "# 装完新开一个终端"],
              linux=["nvm install --lts   # 或发行版包管理器 / nodejs.org 官方 tarball"]),
          cheap=True),
    # ↓ 两项只在 Windows 上会失败, 但失败了 web-replicate 脚手架**整个用不了**,
    #   所以宁可在体检里先说清, 不要让用户跑到 init-webapp 才撞上。
    Check("bash", "bash 可用", "web-replicate 的 init/relink 是 .sh 脚本",
          probe_bins("bash"),
          need="bash (Windows 上装 Git for Windows 自带的 Git Bash, 或用 WSL)",
          fix=by_os(windows=["winget install --id Git.Git -e   # 装完 bash 在 PATH 上",
                             "# 或改用 WSL 里跑 Claude Code"]),
          cheap=True, platforms=("windows",)),
    Check("symlink", "可创建目录软链", "init-webapp.sh 落位后硬断言 node_modules 是软链, 建不出就 abort",
          probe_symlink,
          need="建目录软链的权限 (Windows: 打开「开发者模式」, 或以管理员身份运行)",
          fix=by_os(windows=["# 设置 → 隐私和安全性 → 开发者选项 → 开发人员模式 打开, 然后重开终端",
                             "# 或以管理员身份启动终端再跑 init-webapp.sh"]),
          cheap=True, platforms=("windows",)),
    Check("npm-net", "npm registry 可达", "装依赖的前提; 出网被挡时先炸在这里",
          probe_npm_registry,
          need="能访问 npm registry (公司网络/代理下经常要额外配置)",
          fix=["# 已有代理就带上重试: npm config set proxy <proxy> / set https-proxy <proxy>",
               "#   (或在 shell 里 export http_proxy= / https_proxy=)",
               "# 或换一个可达的镜像源: npm config set registry <mirror-url>"],
          needs="node"),
    # ↓ 以下两项属于 .sh 脚手架的本地盘缓存机制 (init-webapp.sh 会调 relink), 所以
    #   mac/linux 有意义、Windows 上 n/a (那边 bash/软链两道门先卡着, 见上面两项)。
    Check("tmp-space", "本地盘可用空间 ≥ 3G", "node_modules master 缓存 + delta 构建落在本地盘",
          probe_tmp_space,
          need=f"{NM_LOCAL_ROOT} 所在盘 ≥ 3G 空闲",
          fix=["# 清旧缓存, 或换盘: export NM_LOCAL_ROOT=<本地快盘路径>"],
          platforms=("linux", "macos")),
    Check("nm-master", "webapp node_modules 预热", "缺则首次 init-webapp 冷启动 (数分钟)",
          probe_nm_master,
          need="与模板 package.json 哈希匹配的 master 缓存 (非必需, 只影响首次耗时)",
          fix=[f"TEMPLATE_NAME=default bash {WEB_SCRIPTS / 'relink-node-modules.sh'} "
           f"{TPL_DIR} --prepare-only"],
          auto=True, slow=True, needs="npm-net", platforms=("linux", "macos")),
]

MARK = {"ok": "✓", "missing": "✗", "skip": "–", "na": "·"}


def run_checks(cheap_only: bool = False, only: set[str] | None = None) -> list[Result]:
    results: list[Result] = []
    failed: set[str] = set()
    for c in CHECKS:
        if cheap_only and not c.cheap:
            continue
        if only is not None and c.id not in only:
            continue
        if c.platforms and OS not in c.platforms:
            results.append(Result(c, "na", f"本平台 ({OS}) 不适用, 无需处理"))
            continue
        if c.needs and c.needs in failed:
            results.append(Result(c, "skip", f"前置 {c.needs} 未通过, 跳过"))
            failed.add(c.id)          # 依赖链上的后续项一并跳过
            continue
        try:
            ok, detail = c.probe()
        except Exception as e:         # 探测本身炸了也是环境问题, 不许静默
            ok, detail = False, f"探测异常 {type(e).__name__}: {e}"
        if not ok:
            failed.add(c.id)
        results.append(Result(c, "ok" if ok else "missing", detail))
    return results


def cheap_missing() -> list[str]:
    """SessionStart hook 用: 只跑毫秒级项, 返回 "标签 (为什么需要)" 列表。"""
    return [f"{r.check.label} ({r.check.why})"
            for r in run_checks(cheap_only=True) if r.status == "missing"]


def render(results: list[Result]) -> str:
    lines = [f"[env] video2code 环境体检 (平台 {OS}; 解释器 {PY})"]
    for r in results:
        lines.append(f"  {MARK[r.status]} {r.check.label:26} {r.detail}")
    # na = 本平台不适用, 不是缺口 —— 不计进未就绪, 否则 Mac/Win 用户永远看到修不掉的红叉
    bad = [r for r in results if r.status in ("missing", "skip")]
    if not bad:
        lines.append("[env] 全部就绪 — 无需安装。")
        return "\n".join(lines)

    lines.append(f"[env] {len(bad)}/{len(results)} 项未就绪。下面每项先说**要什么**, "
                 "再给本平台的一条示例命令 (用你惯用的装法也行, 要求才是硬的):")
    for i, r in enumerate(bad, 1):
        if r.status == "skip":
            # 没真探测过 → 不摆修复命令, 免得照着装一个可能压根不缺的东西
            lines.append(f"  {i}. {r.check.label} [未探测: 前置 {r.check.needs} 没过] — "
                         f"{r.check.why}; 修好前置后重跑本脚本")
            continue
        tag = ("自动可装" if r.check.auto else "要你自己装")
        if r.check.slow:
            tag += ", 耗时数分钟 → Bash timeout 拉到 600000"
        lines.append(f"  {i}. {r.check.label} [{tag}] — 缺了挂: {r.check.why}")
        if r.check.need:
            lines.append(f"       需要: {r.check.need}")
        for cmd in r.check.fix:
            lines.append(f"       {cmd}")
    if any(r.check.auto for r in bad if r.status == "missing"):
        lines.append(f"[env] 自动项可一把过: {PYQ} {Path(__file__).name} --fix "
                     "(只跑上面标 自动可装 的命令)")
    return "\n".join(lines)


def do_fix(results: list[Result]) -> list[Result]:
    """跑 auto 项的修复命令, 然后只复测这些项。非 auto 项一律不碰。"""
    todo = [r for r in results if r.status == "missing" and r.check.auto]
    if not todo:
        print("[env] 没有可自动装的项 (剩下的要你自己装, 见上面的『需要』行)。")
        return results
    fixed: set[str] = set()
    for r in todo:
        for cmd in r.check.fix:
            if cmd.lstrip().startswith("#"):
                continue
            print(f"[env] $ {cmd}", flush=True)
            p = subprocess.run(cmd, shell=True, timeout=1800)
            if p.returncode != 0:
                print(f"[env] ✗ 失败 (退出码 {p.returncode}): {r.check.label} — "
                      "先看上面的报错, 常见根因是网络/代理", flush=True)
                break
        else:
            fixed.add(r.check.id)
    if not fixed:
        return results
    user_site = site.getusersitepackages()
    if (site.ENABLE_USER_SITE and isinstance(user_site, str)
            and Path(user_site).is_dir() and user_site not in sys.path):
        site.addsitedir(user_site)
    importlib.invalidate_caches()
    recheck = {res.check.id: res for res in run_checks(only=fixed)}
    return [recheck.get(r.check.id, r) for r in results]


def main() -> int:
    ap = argparse.ArgumentParser(description="video2code 环境体检")
    ap.add_argument("--json", action="store_true", help="机器可读输出")
    ap.add_argument("--cheap", action="store_true", help="只跑毫秒级项 (hook 用)")
    ap.add_argument("--fix", action="store_true", help="自动安装 auto 项后复测")
    args = ap.parse_args()

    results = run_checks(cheap_only=args.cheap)
    if args.fix:
        results = do_fix(results)

    payload = {"plugin_root": str(PLUGIN_ROOT),
               "platform": OS,
               "python": PY,
               "checks": [{"id": r.check.id, "label": r.check.label,
                           "status": r.status, "detail": r.detail,
                           "why": r.check.why, "need": r.check.need,
                           "auto": r.check.auto,
                           "fix": r.check.fix if r.status == "missing" else []}
                          for r in results]}
    # na (本平台不适用) 不算缺口; skip (前置没过) 算 —— 它背后有个真缺口没修
    payload["missing"] = [c["id"] for c in payload["checks"]
                          if c["status"] in ("missing", "skip")]

    # 落回执: 下一轮/别的会话不用重跑一遍全量探测就知道上次结论。
    try:
        out = PROJECT_DIR / ".v2c"
        out.mkdir(parents=True, exist_ok=True)
        (out / "env_report.json").write_text(json.dumps(payload, ensure_ascii=False,
                                                        indent=2))
    except OSError:
        pass

    print(json.dumps(payload, ensure_ascii=False, indent=2) if args.json
          else render(results))
    return 1 if payload["missing"] else 0


if __name__ == "__main__":
    sys.exit(main())
