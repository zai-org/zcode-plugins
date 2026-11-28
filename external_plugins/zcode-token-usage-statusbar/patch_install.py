# -*- coding: utf-8 -*-
"""ZCode app.asar 注入/卸载工具（token 用量悬浮条）。

用法：
  python patch_install.py install   # 安装/重定向（幂等；自动替换旧注入行，含指向旧目录的历史行；
                                    # 客户端运行中则生成 .tmp 待退出后替换）
  python patch_install.py install --finalize  # 客户端退出后完成替换
  python patch_install.py remove    # 卸载（从 asar 剥离本工具注入行，不依赖备份）
  python patch_install.py check     # 检查当前注入状态与入口语法
  python patch_install.py install --finalize --asar <app.asar 完整路径> --runtime <运行时目录>
                                    # standalone 运行须显式指定非默认安装位置的目标，
                                    # 否则按平台默认位置猜测，自定义路径下会猜错/找不到文件；
                                    # 也可各设一次环境变量 ZCODE_ASAR / ZCODE_RUNTIME 代替每次都传
                                    # （命令行参数优先于环境变量）。--runtime 只有 install --finalize
                                    # 需要——pending TMP 的 sidecar 记录了生成时的运行时目录，
                                    # standalone 默认 RUNTIME 是脚本自身所在目录，插件安装的运行时
                                    # 数据目录通常是另一个目录，不传会被来源授权校验拒绝；
                                    # remove/check 不受影响。install.py / overlay_install.py
                                    # 拉起时会调用 set_target()/set_runtime() 代为处理，不受此限制。

原理：asar 主入口 out/main/index.js 尾部追加一行 dynamic import(loader)（ESM 入口，实测见下）。
Electron fuses: EmbeddedAsarIntegrityValidation=0（已实测），改动 asar 可正常加载。

安装/卸载均只增删本工具自己的注入行（ZUSAGE_LINE_RE 识别，不限目录的历史行一并匹配），
不制作也不依赖 asar 备份：卸载不会连带移除其它工具后装的注入行；ZCode 官方升级覆盖 asar
之后再卸载，也不会把客户端降级回安装时的旧版本。历史版本遗留的 app.asar.zusage.bak
会在成功安装/卸载后自动清理。

安装成功后自动弹出常驻监控窗口（install_monitor.py，每 10 秒检测一次）：提醒重启
ZCode、确认注入加载后自动退出；运行中替换失败（.tmp 待替换）时还会在 ZCode 退出后
自动完成替换 —— 该收尾职责已由监控窗口承担，旧的 schtasks 计划任务方案废弃。
"""
import base64
import hashlib
import json
import os
import re
import stat
import struct
import subprocess
import sys
import time
from pathlib import Path
import contextlib
from contextlib import ExitStack, contextmanager, nullcontext

import runtime_lock
from runtime_lock import bounded_mkstemp, file_lock, publish_install, real_home, sudo_user

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
# 手动命令模板里的解释器：用当前正在跑的真实解释器绝对路径，不猜 python/python3
# 别名——Windows 上 python3 可能是 Microsoft Store 存根（静默失败），python 也可能
# 被禁用；能走到提示这一步说明本解释器一定可用（用户反馈 2026-11-03）。
PYEXE = sys.executable or "python"

if IS_WIN:
    ASAR_DEFAULT = Path(r"D:\ZCode\resources\app.asar")
    ZCODE_EXE_DEFAULT = Path(r"D:\ZCode\ZCode.exe")
elif IS_MAC:
    ASAR_DEFAULT = Path("/Applications/ZCode.app/Contents/Resources/app.asar")
    ZCODE_EXE_DEFAULT = Path("/Applications/ZCode.app/Contents/MacOS/ZCode")
else:
    ASAR_DEFAULT = Path("app.asar")   # 其它平台无默认位置，用 --asar / install.py 指定
    ZCODE_EXE_DEFAULT = None
ASAR = ASAR_DEFAULT          # 可被 set_target() 改指其它安装位置（install.py 探测后调用）
BAK = ASAR.with_name("app.asar.zusage.bak")
TMP = ASAR.with_name("app.asar.zusage.tmp")
TMP_META = TMP.with_name(TMP.name + ".json")
HERE = Path(__file__).parent.resolve()
# 运行时目录：install.py 标准安装时指向数据目录（~/.zcode/zcode-token-usage-statusbar，
# 经 set_runtime() 切换）；独立运行本脚本或 --dev 安装时保持仓库目录（向后兼容）。
RUNTIME = HERE
LOADER = RUNTIME / "inject-main.cjs"
ENTRY = "out/main/index.js"
# 入口是 ESM（package.json type:module，实测 2026-09-04）：必须用 dynamic import（CJS/ESM 通用），
# 指向 .cjs loader（在 type:module 包里仍按 CJS 加载，require 可用）；asar 内相对路径不可用，用绝对 file URL。
INJECT_LINE_TMPL = (
    '\n;import("{url}").then(() => null, (e) => console.error("[zusage] load failed", e));'
)
INJECT_LINE = INJECT_LINE_TMPL.format(url=(RUNTIME / "inject-main.cjs").as_uri())
# 匹配任何 zusage 注入行（不限当前目录）——迁移/重装/标准↔dev 互切时剥离旧行用
ZUSAGE_LINE_RE = re.compile(
    rb'\n;import\("[^"]*inject-main\.cjs"\)\.then\(\(\) => null, '
    rb'\(e\) => console\.error\("\[zusage\] load failed", e\)\);'
)
ZCODE_EXE = ZCODE_EXE_DEFAULT
# install(extra_modify=...) 的能力标记：调用方（overlay_install）按此探测——旧运行目录里的
# 模块或测试替身没有该常量时不传钩子，install() 的调用形状保持不变。
EXTRA_MODIFY = True
PATCH_SUPPLEMENT = hasattr(runtime_lock, "publish_supplement")
# overlay_install checks this before passing an initial snapshot or consuming diagnostic status.
REUSE_ARCHIVE_SNAPSHOT = True
ALIGN = 4
BLOCK = 4194304

# 输出语言：惰性读 config.json 的 "lang"（运行时目录优先，其次数据目录；缺省 zh）。
# install.py 标准安装流程里 set_runtime() 先于 install()，此时序下读到的就是本次安装写入的语言。
_LANG = None


def L(zh, en):
    global _LANG
    if _LANG is None:
        _LANG = "zh"
        # sudo 运行时（Linux 系统级安装）config 在真实用户的家目录，Path.home() 会指到 root
        user_home = real_home(lambda: sudo_user(sys.platform), Path.home)
        bases = [RUNTIME,
                 Path.home() / ".zcode" / "zcode-token-usage-statusbar"]
        if user_home != Path.home():
            bases.append(user_home / ".zcode" / "zcode-token-usage-statusbar")
        for base in bases:
            try:
                lang = json.loads((base / "config.json").read_text(encoding="utf-8")).get("lang")
                if lang in ("zh", "en"):
                    _LANG = lang
                    break
            except (OSError, ValueError):
                pass
    return en if _LANG == "en" else zh


def set_runtime(path):
    """改运行时目录（LOADER/INJECT_LINE 随动）。ZCode 端泵的全套路径都基于 __dirname，
    运行时副本目录即自洽运行，无需改运行时代码。"""
    global RUNTIME, LOADER, INJECT_LINE
    RUNTIME = Path(path)
    LOADER = RUNTIME / "inject-main.cjs"
    INJECT_LINE = INJECT_LINE_TMPL.format(url=LOADER.as_uri())


def zcode_exe_for(asar_path):
    """从 asar 位置推 ZCode 可执行文件（语法自检用）：Windows 布局 <root>/ZCode.exe，
    macOS bundle 布局 <root>/MacOS/ZCode，Linux 布局 <root>/zcode（deb/rpm 官方包，/opt/ZCode）；
    非 ZCode 布局（如 %LOCALAPPDATA%\\Programs 下其它 Electron 应用）返回 None——
    客户端进程名随之失去语义（客户端是别的应用），语法检查自动跳过。"""
    root = asar_path.parent.parent
    if IS_WIN:
        exe = root / "ZCode.exe"
        return exe if exe.is_file() else None
    if IS_MAC:
        return root / "MacOS" / "ZCode"
    if sys.platform.startswith("linux"):
        return root / "zcode"
    return None


def _safe_is_file(path):
    try:
        return bool(path) and Path(path).is_file()
    except OSError:
        return False


def ui_element_exe_for(exe_path):
    """darwin 后台拉起换 LSUIElement 的 Helper（plugin-updater.cjs cliExecutable 同款）：
    主 bundle 二进制即使带 ELECTRON_RUN_AS_NODE，部分客户端版本仍会向 LaunchServices
    登记 Foreground 应用，Dock 闪现「zcode」图标（issue #238）；Helper 登记 UIElement
    不进 Dock。Helper 缺失/不可执行/结构不符时原样返回——宁可闪图标不可更新/自检失败。"""
    if not IS_MAC or not exe_path:
        return exe_path
    helper = (Path(exe_path).parent.parent / "Frameworks" / "ZCode Helper.app"
              / "Contents" / "MacOS" / "ZCode Helper")
    if _safe_is_file(helper) and os.access(helper, os.X_OK):
        return helper
    return exe_path


def set_target(asar_path):
    """改指目标安装位置（BAK/TMP/ZCODE_EXE 随动）。ZCODE_EXE 只用于语法自检，缺了自动跳过。"""
    global ASAR, BAK, TMP, TMP_META, ZCODE_EXE
    asar_path = Path(asar_path).resolve()
    ASAR = asar_path
    BAK = asar_path.with_name("app.asar.zusage.bak")
    TMP = asar_path.with_name("app.asar.zusage.tmp")
    TMP_META = TMP.with_name(TMP.name + ".json")
    ZCODE_EXE = zcode_exe_for(asar_path)


def client_running():
    try:
        if IS_WIN:
            out = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq ZCode.exe"],
                capture_output=True, text=True, encoding="gbk", errors="replace",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),   # issue #221：无控制台宿主里探测会弹终端窗
            ).stdout
            return "ZCode.exe" in out
        # macOS/Linux：pgrep 精确匹配主进程名；误判"未运行"在 POSIX 上也无害
        # （运行中替换本就允许：rename 语义，旧进程继续读旧 inode）
        return subprocess.run(["pgrep", "-x", "ZCode"], capture_output=True).returncode == 0
    except Exception:
        return True  # 查不到时按在跑处理，走安全路径


def _spawn_detached(cmd, flags, fallback=True, **kwargs):
    """Windows：优先带 CREATE_BREAKAWAY_FROM_JOB 拉起，让监控脱离父进程的 Job 对象——
    从 agent/工具会话里跑安装时，会话清理会整树杀掉子进程，监控等不到客户端退出就被杀，
    收尾只能寄望下次 SessionStart 重试。Job 不允许 breakaway 时降级为普通创建，并留
    一行 stderr 线索（降级后的监控大概率活不过宿主回收，见 issue #208；静默场景的
    存活兜底由 launch_monitor 的 WMI 通道承担，这里只是最后一级回退）。
    fallback=False 时 breakaway 被拒直接抛 OSError，由调用方改走 WMI 脱离通道，
    不先留一个注定被回收的树内监控。"""
    if not IS_WIN:
        return None
    breakaway = getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0)
    try:
        return subprocess.Popen(cmd, creationflags=flags | breakaway, **kwargs)
    except OSError as e:
        if not fallback:
            raise
        _warn_breakaway_denied(e)
        return subprocess.Popen(cmd, creationflags=flags, **kwargs)


def _warn_breakaway_denied(e):
    print(L(f"（breakaway 被拒（{e}）：监控留在父进程 Job 内，会随宿主回收被杀，"
            f"可能收不了尾，见 issue #208）",
            f"(breakaway denied ({e}): the monitor stays inside the parent job and "
            f"will be killed with it; finalization may strand, see issue #208)"),
          file=sys.stderr)


WMI_TIMEOUT = 15   # powershell 冷启动 + CIM 创建的富余上限（秒）


def _wmi_interpreter():
    """WMI 创建没有创建标志位可用：静默监控必须用无控制台的 pythonw.exe，缺失时
    返回 None——不用 python.exe 顶替（会在交互会话闪现控制台窗，行为不能劣化，
    宁可跳过 WMI 走树内回退）。"""
    if not sys.executable:   # 嵌入式场景可能为空：Path("").with_name 会抛 ValueError
        return None
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    return str(pythonw) if pythonw.is_file() else None


def _spawn_via_wmi(cmd):
    """Windows 脱离式拉起：经 WMI Win32_Process.Create 创建监控（父进程是 WmiPrvSE，
    天然不在调用方的进程树/Job 内，宿主回收与会话清理都杀不到它）。插件宿主与
    agent/工具会话的 Job 常不允许 breakaway，树内监控实测只活几分钟，等不到
    「客户端完全退出」的收尾窗口（issue #208）。WMI 创建的进程不继承调用方环境，
    静默开关由监控的 --quiet 参数传达；返回新进程 PID，任何失败返回 None
    （调用方回退 _spawn_detached 树内拉起）。powershell -EncodedCommand 承载
    UTF-16LE base64 脚本，避开 argv→PS 字符串→argv 的三层引号嵌套。"""
    try:
        command_line = subprocess.list2cmdline([str(part) for part in cmd])
        script = ("$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create "
                  "-Arguments @{ CommandLine = '%s' }; "
                  "if ($r.ReturnValue -ne 0) { exit 1 }; [int]$r.ProcessId"
                  % command_line.replace("'", "''"))
        encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
            capture_output=True, timeout=WMI_TIMEOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))   # issue #221
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    try:
        return int(result.stdout.decode("ascii", "replace").strip())
    except ValueError:
        return None


def _spawn_survivor_monitor(epoch):
    """WMI 脱离式拉起无窗口 --quiet 监控（静默收尾与可见监控 breakaway 被拒共用）。
    ZUSAGE_MONITOR_NO_WMI=1 或无 pythonw.exe 时返回 None；解释器约束见 _wmi_interpreter。"""
    if os.environ.get("ZUSAGE_MONITOR_NO_WMI"):
        return None
    interpreter = _wmi_interpreter()
    if not interpreter:
        return None
    return _spawn_via_wmi([interpreter, str(HERE / "install_monitor.py"), "%.3f" % epoch,
                           str(ASAR), str(RUNTIME), "--quiet"])


def launch_monitor(epoch):
    """Windows 开新控制台窗口跑安装监控（提醒重启 + 确认生效 + .tmp 收尾）；
    macOS/Linux 无控制台概念，后台静默跑（收尾与自动退出照常）。设 ZUSAGE_NO_MONITOR=1 可禁用。
    同目标已有存活监控时不再拉起（issue #120：SessionStart 每次自动安装都会走到这里，
    不去重会随会话数线性堆积）；锁在 spawn 前释放，由监控进程自己去持有。
    返回值：Windows 走 WMI（静默分支，或可见分支 breakaway 被拒的幸存通道）时返回新进程
    PID，其余返回 Popen 对象或 None（当前调用方均不消费返回值；PID 供测试断言与排查用）。"""
    if os.environ.get("ZUSAGE_NO_MONITOR") and not os.environ.get("ZUSAGE_MONITOR_QUIET"):
        return
    monitor = HERE / "install_monitor.py"
    if not monitor.exists():
        return
    with monitor_instance_lock() as acquired:
        if not acquired:
            if not os.environ.get("ZUSAGE_MONITOR_QUIET"):   # 静默模式服务 hook，stdout 不夹文本
                print(L("（已有监控在值守同一目标，不再重复弹窗：完全退出 ZCode 后会自动完成替换）",
                        "(A monitor is already watching this target, so no new window is opened: the replacement finishes automatically once ZCode quits completely)"))
            return   # 已有同目标监控在等：复用即可，不叠加进程
    # 试锁成功即释放，锁的长期持有者是监控进程自己；极小竞态窗口内并发双拉起
    # 也无害——后到的监控抢锁失败会自行退出。
    cmd = [sys.executable, str(monitor), "%.3f" % epoch, str(ASAR), str(RUNTIME)]
    try:
        if os.environ.get("ZUSAGE_MONITOR_QUIET"):
            if IS_WIN:
                # 静默收尾必须活得过会话清理：优先 WMI 脱离式拉起（issue #208）；
                # 设 ZUSAGE_MONITOR_NO_WMI=1 可禁用（排查/测试出口）。WMI 创建不
                # 继承本进程环境、也没有创建标志位，解释器须换同目录 pythonw.exe
                #（无控制台；缺失时跳过 WMI 走树内回退——用 python.exe 会在交互
                # 会话闪现控制台窗，行为不能劣化），静默开关走 --quiet 参数。
                pid = _spawn_survivor_monitor(epoch)
                if pid is not None:
                    return pid
                return _spawn_detached(cmd, subprocess.CREATE_NO_WINDOW, cwd=str(HERE),
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL)
            return subprocess.Popen(cmd, creationflags=0, cwd=str(HERE),
                                    start_new_session=True,
                                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL)
        if IS_WIN:
            try:
                return _spawn_detached(cmd, subprocess.CREATE_NEW_CONSOLE, fallback=False,
                                       cwd=str(HERE))
            except OSError as denied:
                # breakaway 被拒：树内可见监控会在用户退出 ZCode 时随宿主回收一起消失，
                # 手动安装就永远收不了尾（issue #208 同源）。先试 WMI 脱离的静默监控，
                # 都不可用才回到原树内回退。注意 fallback=False 会把任意 Popen OSError
                # 一并抛到这里（AV 拦截/磁盘故障同码 WinError 5，无法按错误码区分）：
                # 行为只会多一次 WMI 尝试、永不劣于基线，警告标签按最常见原因措辞。
                pid = _spawn_survivor_monitor(epoch)
                if pid is not None:
                    print(L("（监控窗口无法脱离 ZCode 进程组，已改为后台静默监控：没有监控窗口、"
                            "也无需保持任何窗口，完全退出 ZCode 后会自动完成替换）",
                            "(The monitor window cannot detach from ZCode's process group, so a silent background monitor was started instead: "
                            "there is no window to keep open; the replacement finishes automatically once ZCode quits completely)"))
                    return pid
                _warn_breakaway_denied(denied)
                return subprocess.Popen(cmd, creationflags=subprocess.CREATE_NEW_CONSOLE, cwd=str(HERE))
        return subprocess.Popen(cmd, cwd=str(HERE),
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        print(L(f"（监控窗口启动失败，不影响安装：{e}）",
                f"(monitor window failed to launch; installation is unaffected: {e})"))
        return None


# ---------- asar 读写 ----------

ASSET = "/" + ENTRY
# 注入表达式（逗号表达式元素，求值后结果被丢弃）：stash 属宿主 bundle，本项目只 append。
STASH = "__zusageRelayStash"
# 只剥本项目的 loader 尾缀来复原指纹；其它尾部代码保持不动。
_INJECT_TAIL_RE = re.compile(ZUSAGE_LINE_RE.pattern + rb'\s*$')
# 桥接创建点：bridge.relayProtocol=<sym>,bridge.disposeBridge=...（混淆名随版本轮换）
_ANCHOR_RE = re.compile(rb"\b(\w+)\.relayProtocol=(\w+),\1\.disposeBridge\b")
# 注入串自身即补丁标记（符号随锚点）；remove/检测按它定位，不依赖原始锚点连续存在
_INJECT_RE = re.compile(
    rb"\(globalThis\.__zusageRelayStash=globalThis\.__zusageRelayStash\|\|\[\]\)"
    rb"\.push\(\{p:(\w+)\.protocol,b:(\w+)\}\),")
# uplink 钩子原始锚点：onRawTransportPayload:s(ve=>Fg(ye,ve),"onRawTransportPayload")
# ——包装符号(s)/箭头参数(ve)/原调用(Fg)/运行时(ye)随版本轮换，稳定的是属性名与
# 字符串标签；body 必须恰为「单次调用」形态（3.18.1 实测），复杂化时 derive 拒绝。
_UPLINK_ANCHOR_RE = re.compile(
    rb'onRawTransportPayload:(\w+)\((\w+)=>(\w+)\((\w+),\2\),"onRawTransportPayload"\)')
# 两代必须匹配完整回调，避免将游离的中段误认为可安全剥离的补丁。
_UPLINK_V1_RE = re.compile(
    rb'onRawTransportPayload:(?P<w>\w+)\((?P<p>\w+)=>'
    rb'\((?P=p)&&(?P=p)\.zuUp\?\(\(globalThis\.'
    rb'__zusageRelayUplinkQueue=globalThis\.__zusageRelayUplinkQueue\|\|\[\]\)\.push\((?P=p)\),'
    rb'true\):0\)\|\|(?P<f>\w+)\((?P<r>\w+),(?P=p)\),"onRawTransportPayload"\)')
# v2 回调（新/旧代共用）：箭头体捕获一次桥并入队；差异只在属性值是否带代际 marker。
_V2_HEAD = rb'(?P<w>\w+)\((?P<p>\w+)=>'
_V2_VALUE = (
    rb'\((?P=p)&&(?P=p)\.zuUp\?\(\((?P<b>\w+)\)=>\(\(globalThis\.'
    rb'__zusageRelayUplinkQueue=globalThis\.__zusageRelayUplinkQueue\|\|\[\]\)\.push\('
    rb'\{frame:(?P=p),b:(?P=b),relay:(?P=b)\?(?P=b)\.relayProtocol:void 0\}\),true\)\)'
    rb'\((?P<r>\w+)\.currentBridge\):0\)\|\|(?P<f>\w+)\((?P=r),(?P=p)\)')
_V2_SUFFIX = rb',"onRawTransportPayload"\)'
# 新代在 transport options 构造时（announce / 首帧之前）于属性值内用逗号表达式写
# 代际 marker：onRawTransportPayload:(globalThis.__zusageRelayUplinkGeneration=2,<原包装>)。
# 已安装的旧 v2（无 marker）仍可识别、剥离与升级；两种形态起始字节不同，
# 不会互相嵌套命中。
UPLINK_GENERATION = 2
_UPLINK_GENERATION_MARKER = b"__zusageRelayUplinkGeneration"
_UPLINK_V2_RE = re.compile(rb'onRawTransportPayload:' + _V2_HEAD + _V2_VALUE + _V2_SUFFIX)
_UPLINK_V2_MARKED_RE = re.compile(
    rb'onRawTransportPayload:\(globalThis\.' + _UPLINK_GENERATION_MARKER
    + b"=" + str(UPLINK_GENERATION).encode() + b","
    + _V2_HEAD + _V2_VALUE + _V2_SUFFIX + rb'\)')
_ROUTE_RE = re.compile(
    rb'function (?P<f>\w+)\((?P<r>\w+),(?P<p>\w+)\)\{let (?P<b>\w+)=(?P=r)\.currentBridge;'
    rb'return!(?P=b)\|\|(?P=b)\.degraded\?!1:(?P=b)\.relayProtocol\?\.acceptPayload\((?P=p)\)\?\?!1\}')
_UPLINK_MARKER = b"__zusageRelayUplinkQueue"
_STASH_MARKER = STASH.encode()
# 指纹表（新→旧）：版本以 asar package.json 为准，SHA 是剥尾缀后的原始 bundle。
MOBILE_RELAY_TARGETS = [
    {
        "version": "3.18.1",
        "asset": ASSET,
        # 剥 patch_install 注入尾缀后的原始 bundle 指纹（以实测为准；尾缀差异
        # 不影响——校验永远发生在剥尾缀之后）
        "sha256": "9f414b7c9391de3a92d6373511df1374a6f270ae260ce802647ef0a05fe5cde8",
        "anchor": b"relayProtocol=Ce,Q.disposeBridge",
        "anchor2": b'onRawTransportPayload:s(ve=>Fg(ye,ve),"onRawTransportPayload")',
    },
]


class RelayPatchError(ValueError):
    pass


def inject_for(anchor):
    """锚点 → 注入表达式。锚点形如 relayProtocol=<r>,<b>.disposeBridge；
    注入串插在 `relayProtocol=<r>,` 之后，捕获 <r>.protocol 与 <b> 整体。
    两侧都必须显式 globalThis.：主 bundle 是 ESM（严格模式），对未声明标识符
    赋值会 ReferenceError 炸掉桥接创建点。"""
    m = re.fullmatch(rb"relayProtocol=(\w+),(\w+)\.disposeBridge", anchor)
    if not m:
        raise RelayPatchError("Malformed anchor")
    relay, bridge = m.group(1), m.group(2)
    g = b"globalThis." + STASH.encode()
    return b"(" + g + b"=" + g + b"||[]).push({p:" + relay + b".protocol,b:" + bridge + b"}),"


def inject_for_uplink(anchor2):
    """包裹原回调；一次捕获当前桥，保持帧、桥和 relay 的对象身份。

    整个属性值（原包装调用）被外层逗号表达式包裹：marker 在 transport options
    构造时立即求值，announce 与任何帧都发生在其后，消费者据此在首帧前确认代际。"""
    m = _UPLINK_ANCHOR_RE.fullmatch(anchor2)
    if not m:
        raise RelayPatchError("Malformed uplink anchor")
    head = b"onRawTransportPayload:"
    wrapper, param, _fn, runtime = m.groups()
    bridge = b"__zuBridge"
    while bridge in m.groups():
        bridge += b"_"
    arrow = head + wrapper + b"(" + param + b"=>"
    mid = (b"(" + param + b"&&" + param + b".zuUp?((" + bridge + b")=>(("
           b"globalThis.__zusageRelayUplinkQueue=globalThis.__zusageRelayUplinkQueue||[]).push("
           b"{frame:" + param + b",b:" + bridge + b",relay:" + bridge + b"?" + bridge
           + b".relayProtocol:void 0}),true))(" + runtime + b".currentBridge):0)||")
    wrapped = arrow + mid + anchor2[len(arrow):]
    return (head + b"(globalThis." + _UPLINK_GENERATION_MARKER + b"="
            + str(UPLINK_GENERATION).encode() + b"," + wrapped[len(head):] + b")")


def _injection_state(prefix):
    """只接受完整、唯一的已知指纹；未知或混合代际一律拒绝。"""
    stash = list(_INJECT_RE.finditer(prefix))
    marked = list(_UPLINK_V2_MARKED_RE.finditer(prefix))
    uplinks = list(_UPLINK_V1_RE.finditer(prefix)) + list(_UPLINK_V2_RE.finditer(prefix)) + marked
    if len(stash) > 1 or prefix.count(_STASH_MARKER) != 2 * len(stash):
        raise RelayPatchError("Unknown or duplicate stash inject")
    if len(uplinks) > 1 or prefix.count(_UPLINK_MARKER) != 2 * len(uplinks):
        raise RelayPatchError("Unknown or duplicate uplink inject")
    if prefix.count(_UPLINK_GENERATION_MARKER) != len(marked):
        raise RelayPatchError("Unknown or duplicate uplink generation marker")
    return stash[0] if stash else None, uplinks[0] if uplinks else None


def _strip_injects(prefix):
    """剥离已知两代注入，逐字节还原 pristine 前缀。"""
    stash, uplink = _injection_state(prefix)
    if uplink:
        original = (b'onRawTransportPayload:' + uplink.group('w') + b'(' + uplink.group('p')
                    + b'=>' + uplink.group('f') + b'(' + uplink.group('r') + b','
                    + uplink.group('p') + b'),"onRawTransportPayload")')
        prefix = prefix[:uplink.start()] + original + prefix[uplink.end():]
    if stash:
        # 上行还原后重新定位 stash，且注入串两侧必须仍是同一桥的原始锚点。
        match = _INJECT_RE.search(prefix)
        relay, bridge = match.groups()
        before = bridge + b".relayProtocol=" + relay + b","
        after = bridge + b".disposeBridge"
        if (prefix[match.start() - len(before):match.start()] != before
                or not prefix.startswith(after, match.end())):
            raise RelayPatchError("Stash inject is not at the relay anchor")
        prefix = prefix[:match.start()] + prefix[match.end():]
    return prefix


def _derive_uplink_anchor(prefix):
    """表外版本需唯一匹配回调及其读取 currentBridge 的原始路由函数。"""
    matches = list(_UPLINK_ANCHOR_RE.finditer(prefix))
    if len(matches) != 1:
        raise RelayPatchError("Uplink anchor not derivable (missing or ambiguous)")
    match = matches[0]
    routes = [route for route in _ROUTE_RE.finditer(prefix) if route.group('f') == match.group(3)]
    if len(routes) != 1:
        raise RelayPatchError("Uplink bridge route not derivable (missing or ambiguous)")
    return match.group(0)


def _split_tail(data):
    """剥 patch_install 注入尾缀（有则剥，无则原样）。返回 (前缀, 尾缀)。"""
    m = _INJECT_TAIL_RE.search(data)
    if not m:
        return data, b""
    return data[:m.start()], data[m.start():]


def transform_mobile_entry(data, operation, target=None, *, package=None):
    """以同一份原始前缀校验布局并变换钩子，保留 loader 尾缀。"""
    if operation not in ("apply", "remove"):
        raise RelayPatchError("Unknown operation")
    if isinstance(package, str):
        raise RelayPatchError(package)
    prefix, tail = _split_tail(data)
    pristine = _strip_injects(prefix)
    pinned = False
    if package is not None:
        target, pinned = _resolve_target(package, pristine)
    if operation == "remove":
        if pristine != prefix and target is None:
            _derive_anchor(pristine)
            _derive_uplink_anchor(pristine)
        return pristine + tail
    # 始终从 pristine 重建，避免旧代和新代叠加；两个锚点都必须唯一。
    anchor = (target or {}).get("anchor")
    if anchor is None:
        anchor = _derive_anchor(pristine)
    anchor2 = (target or {}).get("anchor2")
    if anchor2 is None:
        anchor2 = _derive_uplink_anchor(pristine)
    if not pinned:
        if pristine.count(anchor) != 1:
            raise RelayPatchError("Missing or duplicate relay anchor")
        if pristine.count(anchor2) != 1:
            raise RelayPatchError("Missing or duplicate uplink anchor")
    inject = inject_for(anchor)
    split = anchor.split(b",", 1)[0] + b","  # relayProtocol=<sym>,
    patched_anchor = split + inject + anchor[len(split):]
    result = pristine.replace(anchor, patched_anchor, 1)
    result = result.replace(anchor2, inject_for_uplink(anchor2), 1)
    return result + tail


def _derive_anchor(prefix):
    """表外版本的严格推导：全 bundle 唯一的 bridge.relayProtocol 赋值锚点。"""
    matches = _ANCHOR_RE.findall(prefix)
    if len(matches) != 1:
        raise RelayPatchError("Relay anchor not derivable (missing or ambiguous)")
    bridge, relay = matches[0]   # 捕获组1=桥接宿主对象（Q），组2=relay 协议实例（Ce）
    return b"relayProtocol=" + relay + b"," + bridge + b".disposeBridge"


def _resolve_target(package, pristine):
    """返回目标锚点及是否已按登记指纹校验其唯一性。"""
    version = package.get("version")
    target = next((t for t in MOBILE_RELAY_TARGETS if t["version"] == version), None)
    if target is not None:
        if hashlib.sha256(pristine).hexdigest() != target["sha256"]:
            raise RelayPatchError(f"asset hash mismatch for pinned version {version}")
        if pristine.count(target["anchor"]) != 1:
            raise RelayPatchError("Pinned anchor drift")
        anchor2 = target.get("anchor2")
        if anchor2 is None or pristine.count(anchor2) != 1:
            raise RelayPatchError("Pinned uplink anchor drift")
        return target, True
    return {"anchor": _derive_anchor(pristine), "anchor2": _derive_uplink_anchor(pristine)}, False


def _relay_check_status(entry, package):
    """Return whether the current hooks are complete along with the localized detail."""
    try:
        updated = transform_mobile_entry(entry, "apply", package=package)
    except RelayPatchError as error:
        return False, L(f"无法检查（{error}）", f"unavailable ({error})")
    if updated == entry:
        return True, L("已注入", "patched")
    if _STASH_MARKER in entry or _UPLINK_MARKER in entry or _UPLINK_GENERATION_MARKER in entry:
        return False, L("可升级或补齐", "can be upgraded or completed")
    return False, L("未注入，可补装", "not patched; install can add it")


def _mobile_check_status(asar_path, entry):
    """Compatibility entry point for an older overlay_install doctor."""
    try:
        _, current, package = _archive_snapshot(asar_path)
        if current != entry:
            raise PendingTmpError("archive entry changed during inspection")
    except (OSError, ValueError, TypeError, KeyError, OverflowError, struct.error) as error:
        return L(f"无法检查（{error}）", f"unavailable ({error})")
    return _relay_check_status(entry, package)[1]


def read_header(f, *, digest=None):
    f.seek(0)
    prefix = f.read(16)
    a, b, c, d = struct.unpack("<4I", prefix)
    assert a == 4, f"unexpected pickle prefix {a}"
    raw = f.read(d)
    if digest is not None:
        digest.update(prefix)
        digest.update(raw)
    return json.loads(raw), 8 + b


def read_asar_package(asar_path, pi=None):
    """读取 asar 根目录 package.json 解析后的字典；非 asar、unpacked 外置或损坏时返回 None。"""
    reader = read_header if pi is None else getattr(pi, "read_header", read_header)
    try:
        with open(asar_path, "rb") as stream:
            header, base = reader(stream)
            node = header.get("files", {}).get("package.json")
            if not isinstance(node, dict) or node.get("unpacked") or "size" not in node:
                return None
            stream.seek(base + int(node["offset"]))
            data = stream.read(int(node["size"]))
        if b"\x00" in data:
            return None
        pkg = json.loads(data.decode("utf-8"))
        return pkg if isinstance(pkg, dict) else None
    except Exception:
        return None


def iter_files(node, path=""):
    """yield (path_in_asar, node_dict)。node_dict 为文件（含 size）。"""
    for name, ch in node.get("files", {}).items():
        p = f"{path}/{name}"
        if "files" in ch:
            yield from iter_files(ch, p)
        else:
            yield p, ch


def compute_integrity(data: bytes):
    return {
        "algorithm": "SHA256",
        "hash": hashlib.sha256(data).hexdigest(),
        "blockSize": BLOCK,
        "blocks": [hashlib.sha256(data[i:i + BLOCK]).hexdigest() for i in range(0, len(data), BLOCK)],
    }


class _Digest:
    """边写边算的整包摘要；size 记录喂入的字节数，对不上产物大小即不可信。"""

    def __init__(self):
        self.hash = hashlib.sha256()
        self.size = 0

    def update(self, data):
        self.hash.update(data)
        self.size += len(data)


_REPACK_SINK = None   # _repack_digest() 持有期间的摘要接收方


@contextmanager
def _repack_digest():
    """让其间的 repack() 边写边算产物的 SHA256。repack 被替身顶替或没写满时
    sink.size 为 0 或小于产物，调用方回退整包回读。"""
    global _REPACK_SINK
    sink = _Digest()
    _REPACK_SINK = sink
    try:
        yield sink
    finally:
        _REPACK_SINK = None


def repack(src_path: Path, modify: dict, dst_path: Path):
    """重建 asar。modify: {asar内路径: 新内容bytes}。逐文件边读边写，未改动文件不落内存。"""
    with open(src_path, "rb") as src:
        header, base = read_header(src)
        header = json.loads(json.dumps(header))  # 深拷贝
        nodes = dict(iter_files(header))
        missing = set(modify) - set(nodes)
        assert not missing, f"paths not in asar: {missing}"

        # 第一遍只定新偏移：改写项记新内容，其余记源数据起点，都不读数据
        plan, offset = [], 0
        for p, node in nodes.items():
            if node.get("unpacked"):
                node["offset"] = "0"
                continue
            if "link" in node:
                continue
            if p in modify:
                data = modify[p]
                node["size"] = len(data)
                node["integrity"] = compute_integrity(data)
                plan.append((None, data))
            else:
                plan.append((base + int(node["offset"]), node["size"]))
            node["offset"] = str(offset)
            offset += node["size"]

        header_bytes = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        d = len(header_bytes)
        c = (d + 4 + ALIGN - 1) // ALIGN * ALIGN
        b_total = c + 4
        sink = _REPACK_SINK
        with open(dst_path, "wb", buffering=BLOCK) as out:
            def write(data):
                out.write(data)
                if sink is not None:
                    sink.update(data)

            write(struct.pack("<4I", 4, b_total, c, d))
            write(header_bytes)
            write(b"\0" * (c - d - 4))  # pickle 对齐：数据区从 8+b = 12+c 处开始
            assert out.tell() == 8 + b_total, f"header pad mismatch: {out.tell()} vs {8 + b_total}"
            for start, payload in plan:
                if start is None:
                    write(payload)
                    continue
                src.seek(start)
                remaining = payload
                while remaining:
                    chunk = src.read(min(BLOCK, remaining))
                    if not chunk:
                        raise OSError(f"source archive truncated: {src_path}")
                    write(chunk)
                    remaining -= len(chunk)
    return dst_path


def entry_bytes_of(asar_path: Path) -> bytes:
    with open(asar_path, "rb") as f:
        header, base = read_header(f)
        nodes = dict(iter_files(header))
        node = nodes["/" + ENTRY]
        f.seek(base + int(node["offset"]))
        return f.read(node["size"])


def self_check(asar_path: Path, expect=True):
    """结构自检：header 可解析、文件数、入口注入行符合预期（install 期望有，remove 期望无）。"""
    with open(asar_path, "rb") as f:
        header, base = read_header(f)
        n = sum(1 for _ in iter_files(header))
    entry = entry_bytes_of(asar_path)
    has = INJECT_LINE.encode() in entry if expect else bool(ZUSAGE_LINE_RE.search(entry))
    ok = has == expect
    print(L(f"  [check] header ok, 文件数={n}, 注入行{'符合' if ok else '不符合'}预期（期望{'有' if expect else '无'}）",
            f"  [check] header ok, files={n}, injection line {'as expected' if ok else 'UNEXPECTED'} (expected {'present' if expect else 'absent'})"))
    return ok


def syntax_check(asar_path: Path):
    """用 ZCode 自身当 node（ELECTRON_RUN_AS_NODE）对入口做语法检查；
    找不到/无法运行 ZCode 可执行文件时跳过（此时不挡安装；收尾校验真跑出语法错误仍 fail-closed 拒收）。"""
    exe = ui_element_exe_for(ZCODE_EXE)
    if not _safe_is_file(exe):
        print(L("  [check] 未找到 ZCode 可执行文件，跳过语法检查",
                "  [check] ZCode executable not found; syntax check skipped"))
        return True
    src = entry_bytes_of(asar_path)
    env = dict(os.environ, ELECTRON_RUN_AS_NODE="1")
    fd, tmp_js, r, run_err = None, None, None, ""
    try:
        # 入口是 ESM（package.json type:module）：临时 .js 在 HERE（无 type:module 上下文）里
        # 会被 node --check 按 CJS goal 解析，顶层 import 必报语法错误；用 .mjs 按 ESM 检查。
        # 走 bounded_mkstemp：HERE 若位于受保护目录（无锁先行证明可写），stdlib 的
        # tempfile.mkstemp 在 Windows 上会吞掉 PermissionError 无限换名挂起（issue #360），
        # 根本进不了下方 except OSError 的跳过分支。
        fd, name = bounded_mkstemp(prefix=".entry-check.", suffix=".mjs", dir=HERE)
        tmp_js = Path(name)
        with os.fdopen(fd, "wb") as stream:
            stream.write(src)
        # Node 恒写 UTF-8：按区域编码解码，回显里的非 ASCII（中文路径/源码行）会让 Windows
        # 读线程崩溃（stderr 变 None）或解成乱码。
        r = subprocess.run([str(exe), "--check", str(tmp_js)], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", env=env)
    except OSError as e:
        r = None
        run_err = str(e)
    finally:
        if tmp_js is not None:
            try:
                tmp_js.unlink(missing_ok=True)   # mkstemp 本身失败时无临时文件可清
            except OSError:
                pass
    if r is None:
        print(L(f"  [check] 语法检查无法执行（{run_err}），跳过",
                f"  [check] syntax check failed to run ({run_err}); skipped"))
        return True
    # 当前输出编码打印不了的字符（cp1252/ASCII 管道上的中文路径等）转义，其余原样显示；
    # 重定向到 StringIO 时 encoding 为 None，按 UTF-8 处理。
    enc = getattr(sys.stdout, "encoding", None) or "utf-8"
    detail = r.stderr.strip()[:200].encode(enc, "backslashreplace").decode(enc)
    print(L("  [check] 语法检查 exit=", "  [check] node --check exit=") + str(r.returncode) + " " + detail)
    return r.returncode == 0


def cleanup_legacy_bak():
    """备份机制已退役（安装/卸载均改为剥离注入行）：清掉历史版本遗留的 .bak，省约 300MB 磁盘。"""
    if not BAK.exists():
        return
    try:
        BAK.unlink()
        print(L(f"已清理历史遗留备份 {BAK}", f"Removed legacy backup {BAK}"))
    except OSError as e:
        print(L(f"（遗留备份清理失败，可手动删除 {BAK}：{e}）",
                f"(failed to remove legacy backup {BAK}; delete it manually: {e})"))


# ---------- 待替换包的来源与身份 ----------

class PendingTmpError(ValueError):
    """来源/身份不可信：立即取消收尾，保留文件供诊断，不按文件占用重试。"""


class PatchSourceChanged(PendingTmpError):
    """补装的锁外构建遇到源归档变化；调用方可基于新入口重建一次。"""


class PatchLockBusy(TimeoutError):
    """零等待补装锁竞争，可由 SessionStart 按预算退避重试。"""


class PendingTmpBusy(PendingTmpError):
    """发布中 journal 的瞬时态（issue #228）：监控重试续守而非取消让位。_publish_pending
    先写 cancelled+publishing journal、全量 hash 大包后才落终版 sidecar——这个秒级
    窗口里轮询的旧监控若按 cancelled 退出让位，而 launch_monitor 的去重又认定
    「已有监控在等」不拉新监控，交接就断裂成孤儿 pending（之后重启不再替换）。子类化
    保持既有 except PendingTmpError 全部语义，监控循环按需先行捕获。"""


# Windows 的 st_ctime 是创建时间：内容修改不会改变它（没有防篡改价值），且杀软过滤
# 驱动下同一路径 lstat 与打开句柄 fstat 读到的 ctime_ns 可能恒不一致（NTFS 实测，
# size/mtime/dev/ino 均相同），纳入比对会让每次 source_fingerprint 都误报
# "file changed"。POSIX 的 ctime 是 inode 变更时间，写入会更新，保留作额外信号。
if sys.platform == "win32":
    _STAMP_FIELDS = ("size", "mtime_ns", "dev", "ino")
else:
    _STAMP_FIELDS = ("size", "mtime_ns", "ctime_ns", "dev", "ino")


def _stat_stamp(st):
    if not stat.S_ISREG(st.st_mode):
        raise PendingTmpError("not a regular file")
    values = {"size": st.st_size, "mtime_ns": st.st_mtime_ns,
              "ctime_ns": st.st_ctime_ns, "dev": st.st_dev, "ino": st.st_ino}
    return {key: values[key] for key in _STAMP_FIELDS}


def file_stamp(path):
    """廉价身份快照（不跟随 symlink）；每轮监控只读 stat 和小 sidecar。"""
    return _stat_stamp(Path(path).lstat())


def _hash_up_to(stream, digest, offset):
    """Feed the bytes up to an absolute offset into the same running digest."""
    if offset < digest.size:
        raise PendingTmpError("archive assets overlap")
    stream.seek(digest.size)
    while digest.size < offset:
        block = stream.read(min(BLOCK, offset - digest.size))
        if not block:
            raise PendingTmpError("file truncated while hashing")
        digest.update(block)


def source_fingerprint(path):
    """流式 SHA256；hash 前后及打开的 inode 都须一致，避免读取升级中的混合包。"""
    before = file_stamp(path)
    digest = _Digest()
    with open(path, "rb") as stream:
        if _stat_stamp(os.fstat(stream.fileno())) != before:
            raise PendingTmpError("file changed before hashing")
        _hash_up_to(stream, digest, before["size"])
        if _stat_stamp(os.fstat(stream.fileno())) != before:
            raise PendingTmpError("file changed while hashing")
    if file_stamp(path) != before:
        raise PendingTmpError("file replaced while hashing")
    return dict(before, sha256=digest.hash.hexdigest())


def _read_relay_package(raw, nodes, entry):
    if raw is None:
        raise RelayPatchError("Missing packed package.json")
    package = json.loads(raw.decode("utf-8"))
    if (not isinstance(package, dict)
            or (package.get("name"), package.get("type")) != ("@zcode/desktop", "module")):
        raise RelayPatchError("Unknown host package")
    if b"sourceMappingURL" in entry or any(
            item in nodes for item in (ASSET + ".map", ASSET[:-3] + ".map")):
        raise RelayPatchError("Unverified source map layout")
    return package


def _archive_extent(node, base, size):
    offset = base + int(node["offset"])
    length = int(node["size"])
    if offset < base or length < 0 or offset + length > size:
        raise PendingTmpError("archive asset extent is invalid")
    return offset, length


def _archive_snapshot(path, *, with_hash=False):
    """Read the entry and package metadata, hashing those same bytes in write paths."""
    before = file_stamp(path)
    digest = _Digest() if with_hash else None
    entry_path, package_path = "/" + ENTRY, "/package.json"
    read_errors = (OSError, ValueError, TypeError, KeyError, OverflowError, struct.error)
    with open(path, "rb") as stream:
        if _stat_stamp(os.fstat(stream.fileno())) != before:
            raise PendingTmpError("file changed before archive read")
        header, base = read_header(stream, digest=digest)
        nodes = dict(iter_files(header))
        entry_offset, entry_size = _archive_extent(nodes[entry_path], base, before["size"])
        regions = [(entry_offset, entry_size, entry_path)]
        package, package_node = None, nodes.get(package_path)
        if isinstance(package_node, dict) and not package_node.get("unpacked"):
            try:
                offset, length = _archive_extent(package_node, base, before["size"])
                if offset < entry_offset + entry_size and entry_offset < offset + length:
                    raise RelayPatchError("package.json overlaps the archive entry")
                regions.append((offset, length, package_path))
            except read_errors as error:
                package = str(error)

        payloads = {}
        for offset, length, name in sorted(regions):
            try:
                if digest is None:
                    stream.seek(offset)
                else:
                    _hash_up_to(stream, digest, offset)
                data = stream.read(length)
                if digest is not None:
                    digest.update(data)
                if len(data) != length:
                    raise PendingTmpError(f"archive asset truncated: {name}")
                payloads[name] = data
            except read_errors as error:
                if name == entry_path:
                    raise
                package = str(error)

        entry = payloads[entry_path]
        if package is None:
            try:
                package = _read_relay_package(payloads.get(package_path), nodes, entry)
            except read_errors as error:
                # Loader and bridge work can proceed when only relay metadata is unavailable.
                package = str(error)
        if digest is not None:
            _hash_up_to(stream, digest, before["size"])
        if _stat_stamp(os.fstat(stream.fileno())) != before:
            raise PendingTmpError("archive changed while reading")
    if file_stamp(path) != before:
        raise PendingTmpError("archive replaced while reading")
    if digest is not None:
        before["sha256"] = digest.hash.hexdigest()
    return before, entry, package


def _same_stamp(path, fingerprint):
    try:
        current = file_stamp(path)
    except FileNotFoundError as e:
        raise PendingTmpError(f"pending source/TMP disappeared: {path}") from e
    if current != {key: fingerprint[key] for key in _STAMP_FIELDS}:
        raise PendingTmpError(f"file identity changed: {path}")


def _same_fingerprint(current, recorded):
    """按当前平台字段集比较：升级前写的 sidecar 可能多带 Windows 已不比对的 ctime_ns；
    缺字段或非对象（未经校验的 previous_tmp）按不匹配处理。"""
    return isinstance(recorded, dict) and all(
        recorded.get(key) == value for key, value in current.items())


def _source_for_repack(inspection):
    """Bind the full source digest to the entry and metadata used to plan the patch."""
    stamp, entry, package = inspection
    source, current_entry, current_package = _archive_snapshot(ASAR, with_hash=True)
    if (not _same_fingerprint(stamp, source) or current_entry != entry
            or current_package != package):
        raise PendingTmpError("archive source content changed during inspection")
    return source


def _load_tmp_metadata():
    try:
        if TMP_META.is_symlink():
            raise PendingTmpError("sidecar is a symlink")
        # 有界读：sidecar 目录被写入已需特权，仍不无界读入内存（与 release_unpack 同策略）
        if TMP_META.stat().st_size > 256 * 1024:
            raise PendingTmpError("sidecar abnormally large")
        meta = json.loads(TMP_META.read_text(encoding="utf-8"))
        if (meta["version"] != 1 or meta["asar"] != str(ASAR.resolve()) or
                meta["tmp_path"] != str(TMP.absolute()) or
                meta["operation"] not in ("install", "remove", "cancelled")):
            raise PendingTmpError("sidecar target or operation mismatch")
        for field in ("source", "tmp"):
            fp = meta[field]
            if (not all(type(fp[key]) is int for key in _STAMP_FIELDS) or
                    not isinstance(fp["sha256"], str) or
                    not re.fullmatch("[0-9a-f]{64}", fp["sha256"])):
                raise PendingTmpError("invalid fingerprint")
        if not isinstance(meta["runtime"], str):
            raise PendingTmpError("invalid runtime")
        return meta
    except (FileNotFoundError, ValueError, KeyError, TypeError) as e:
        raise PendingTmpError(f"untrusted pending TMP; re-run install: {e}") from e


def _replace_retrying(source, target):
    """os.replace 的有界重试（实现与退避常量在 runtime_lock）。运行目录里的 runtime_lock 可能是热修
    保护下留下的旧版、没有这个函数：那时退回裸 os.replace，与引入重试之前的行为一致——不能因为一项
    可选的加固让本模块整个导入失败（待替换收尾、自检、卸载全断）。"""
    retry = getattr(runtime_lock, "_replace_retrying", None)
    if retry is None:
        return os.replace(source, target)
    return retry(source, target)


def _atomic_tmp_metadata(meta):
    fd, name = bounded_mkstemp(prefix=TMP_META.name + ".", dir=TMP_META.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(meta, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        # 刚写完的文件常被杀软 / 搜索索引瞬时打开：Windows 上此时 os.replace 被拒，有界重试
        _replace_retrying(name, TMP_META)
    finally:
        try:
            Path(name).unlink(missing_ok=True)
        except OSError:
            pass


def _target_lock(timeout=10.0):
    # Independent of runtime/update locks: never call runtime synchronization here.
    return file_lock(ASAR.with_name(ASAR.name + ".zusage.lock"), timeout=timeout)


def monitor_lock_path():
    """监控实例去重锁（issue #120）：与目标锁同目录、不同名，永久保留不删。"""
    return ASAR.with_name(ASAR.name + ".zusage.monitor.lock")


@contextmanager
def monitor_instance_lock():
    """监控实例去重锁（issue #120，非阻塞独占）：yield True=持有；False=同目标已有
    监控在跑。锁文件与目标锁同目录、不同名，永久保留不删。不用 file_lock：去重锁
    是纯 try-lock，没有等待与超时语义，还共用它的计时器会干扰既有测试对轮询节奏
    的断言。锁文件无法创建或本体不可写（满盘等）时都按持有处理：去重是锦上添花，
    不能挡住收尾主职责，更不能把去重失败变成安装失败。区域锁/flock 在句柄关闭
    （含进程退出、被杀）时由 OS 释放，无陈锁残留。"""
    try:
        fd = os.open(os.fspath(monitor_lock_path()), os.O_RDWR | os.O_CREAT, 0o600)
    except OSError:
        fd = None
    if fd is None:
        yield True
        return
    locked = False
    try:
        if os.name == "nt":
            import msvcrt
            try:
                if os.fstat(fd).st_size == 0:
                    os.write(fd, b"\0")
                os.lseek(fd, 0, os.SEEK_SET)
            except OSError:
                yield True   # 锁文件本体不可用：同上退化，不让异常打断安装/收尾链
                return
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                locked = True
            except OSError:
                pass
        else:
            import fcntl
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except OSError:
                pass
        yield locked
    finally:
        os.close(fd)   # 释放即关闭句柄：显式解锁与关闭之间的窗口没有意义


def _checked_tmp_metadata(path, source, operation, fingerprint=None):
    if operation not in ("install", "remove"):
        raise PendingTmpError("invalid pending operation")
    _same_stamp(ASAR, source)
    if fingerprint is None:
        before = source_fingerprint(path)
    else:
        # 重打包边写边算的摘要：身份戳仍对得上才沿用，对不上按既有语义失败
        _same_stamp(path, fingerprint)
        before = fingerprint
    try:
        ok = self_check(path, expect=operation == "install") and syntax_check(path)
    except (ValueError, AssertionError, KeyError, struct.error) as e:
        raise PendingTmpError(f"pending validation failed: {e}") from e
    if not ok:
        raise PendingTmpError("pending structure/syntax validation failed")
    _same_stamp(path, before)
    _same_stamp(ASAR, source)
    return {"version": 1, "asar": str(ASAR.resolve()), "tmp_path": str(TMP.absolute()),
            "runtime": str(RUNTIME.resolve()), "operation": operation,
            "validated": True, "source": source, "tmp": before}


def write_tmp_metadata(source, operation="install"):
    """Existing TMP helper: authorize only after structure and syntax validation."""
    with _target_lock():
        meta = _checked_tmp_metadata(TMP, source, operation)
        _atomic_tmp_metadata(meta)
        return meta


def _owned_tmp_metadata():
    """Only reclaim proven files, including our interrupted publication journal."""
    meta = _load_tmp_metadata()
    if TMP.exists() or TMP.is_symlink():
        current = source_fingerprint(TMP)
        matches = _same_fingerprint(current, meta["tmp"])
        if meta["operation"] == "cancelled" and meta.get("publishing") is True:
            # rename can change ctime. Same inode, content and other stamps prove
            # ownership; the prior package may still be present before rename.
            fields = ("size", "mtime_ns", "dev", "ino", "sha256")
            matches = matches or all(current[key] == meta["tmp"][key] for key in fields)
            matches = matches or _same_fingerprint(current, meta.get("previous_tmp"))
        if not matches:
            raise PendingTmpError("pending TMP no longer belongs to its sidecar")
    return meta


def _cancel_pending_install():
    if not TMP_META.exists() and not TMP_META.is_symlink():
        return
    meta = _load_tmp_metadata()
    if meta["operation"] == "install":
        meta["operation"] = "cancelled"
        _atomic_tmp_metadata(meta)


def cancel_pending_install():
    """remove/optout revokes prior install finalization under the target lock."""
    with _target_lock():
        _cancel_pending_install()


def _tmp_stamp():
    """TMP 的廉价身份戳（dev/ino/size/mtime…）；不存在或非普通文件返回 None。"""
    try:
        return file_stamp(TMP)
    except (OSError, ValueError):
        return None


def _rollback_publication(old_stamp, previous):
    """发布没落成时把盘面还原到发布前。是否已 rename 以盘上 TMP 的身份戳为准（发布前
    记下的 old_stamp），不看调用方的标志位——信号可以落在 os.replace 返回之后、标志位
    赋值之前，按标志位回滚会把新包留成无主 TMP。没 rename：无旧 pending 删 journal，
    有则原样写回 previous。rename 后且原先无 pending：新包已落 TMP 但终版 sidecar 没写成，
    连同 journal 一并撤掉，下次按需重建（待替换包是可再生的派生物）。rename 后且原先有
    pending：旧包已被 rename 覆盖、无从还原，保留 journal 交 _owned_tmp_metadata 认领
    （下一次 publish 重发）。新包撤不掉时同样保留 journal 作所有权凭证。"""
    try:
        if _tmp_stamp() != old_stamp:
            if previous is not None:
                return
            try:
                TMP.unlink(missing_ok=True)
            except OSError:
                return
            try:
                TMP_META.unlink(missing_ok=True)
            except OSError:
                pass   # journal 留成无包的 publishing 空壳：由 reclaim_stale_journal 超龄回收
        elif previous is None:
            TMP_META.unlink(missing_ok=True)
        else:
            _atomic_tmp_metadata(previous)
    except OSError:
        pass


def _same_renamed_file(current, before):
    # POSIX rename can update inode ctime without changing file contents.
    return all(current[key] == before[key] for key in ("size", "mtime_ns", "dev", "ino"))


def _publish_pending(stage, source, operation, previous, *, validated=None, fingerprint=None):
    """按 journal→原子发布→sidecar 落成 TMP。可复用已在锁外校验的私有 stage。
    fingerprint 是本进程重打包边写边算的 stage 指纹：有则免掉 stage 与落成后 TMP 的两次整包回读。"""
    meta = (dict(validated) if validated is not None
            else _checked_tmp_metadata(stage, source, operation, fingerprint))
    # Two files cannot be atomically published together. Persist a cancelled
    # ownership journal first, so any interruption is safe and recoverable.
    old_stamp = _tmp_stamp()
    journal = dict(meta, operation="cancelled", publishing=True)
    if previous is not None and TMP.exists():
        journal["previous_tmp"] = source_fingerprint(TMP)
    _atomic_tmp_metadata(journal)
    try:
        _same_stamp(ASAR, source)
        _same_stamp(stage, meta["tmp"])
        # stage 是刚落盘的整包：Windows 上杀毒 / 索引的瞬时句柄会让裸 os.replace 被拒，
        # 而这次拒绝的代价是整轮「待替换包生成失败」——有界重试，永久性拒绝照常上抛走回滚
        _replace_retrying(stage, TMP)
        moved = file_stamp(TMP)
        same_file = _same_renamed_file(moved, meta["tmp"])
        if validated is not None and not same_file:
            raise PendingTmpError("published TMP does not match validated stage")
        if same_file and (validated is not None or fingerprint is not None):
            meta["tmp"] = dict(moved, sha256=meta["tmp"]["sha256"])
        else:
            meta["tmp"] = source_fingerprint(TMP)
        _same_stamp(ASAR, source)
        _atomic_tmp_metadata(meta)
    except BaseException:
        # Ordinary exceptions and soft interrupts restore the previous publication state;
        # SIGKILL leftovers are reclaimed through the stale-journal path.
        _rollback_publication(old_stamp, previous)
        raise
    return meta


def reclaim_stale_journal():
    """回收被硬杀的发布留下的空 journal（cancelled+publishing、无 TMP、早于
    STALE_STAGE_SECONDS）。发布窗口只有秒级且全程持目标锁：锁内看到超龄的 publishing
    journal 必然无主；没有 TMP 就没有可收尾的包，留着只会让只读 sidecar 让位的调用链
    （远控中继补丁）永久 deferred。带 TMP 的（rename 后被杀）不在此列——那是可认领的完整
    包，交 _owned_tmp_metadata 由下一次 publish 重发；空壳对 publish 本身无碍（同样被认领后
    改写），所以只有「只读 sidecar 就让位」的链需要在让位前调用本函数。调用方必须已持有
    _target_lock。"""
    try:
        meta = _load_tmp_metadata()
        if meta.get("operation") != "cancelled" or meta.get("publishing") is not True:
            return False
        if TMP.exists() or TMP.is_symlink():
            return False
        if time.time() - TMP_META.lstat().st_mtime <= STALE_STAGE_SECONDS:
            return False
        TMP_META.unlink()
    except (OSError, PendingTmpError):
        return False
    return True

STALE_STAGE_SECONDS = 600


def _sweep_stale_stages(directory, *, supplement=False):
    """清理过期 stage；手机使用普通和旧版手机清扫器都不匹配的独立前缀。"""
    now = time.time()
    prefix = ".zusage-mobile-stage-" if supplement else TMP.name + "."
    for stale in Path(directory).glob(prefix + "*.stage"):
        try:
            if now - stale.stat().st_mtime > STALE_STAGE_SECONDS:
                stale.unlink()
        except OSError:
            pass


@contextmanager
def _archive_stage(*, supplement=False):
    prefix = ".zusage-mobile-stage-" if supplement else TMP.name + "."
    fd, name = bounded_mkstemp(prefix=prefix, suffix=".stage", dir=TMP.parent)
    os.close(fd)
    stage = Path(name)
    try:
        yield stage
    finally:
        try:
            stage.unlink(missing_ok=True)
        except OSError:
            pass


def _repack_stage(stage, modify):
    with _repack_digest() as sink:
        repack(ASAR, modify, stage)
    original_stat = ASAR.stat()
    if os.name != "nt":
        stage_stat = stage.stat()
        if (stage_stat.st_uid, stage_stat.st_gid) != (original_stat.st_uid, original_stat.st_gid):
            os.chown(stage, original_stat.st_uid, original_stat.st_gid)
    os.chmod(stage, stat.S_IMODE(original_stat.st_mode))
    # 身份戳取在 chown/chmod 之后（ctime 属于身份戳）；摘要只在喂满整个 stage 时可用，
    # repack 被替身顶替时 sink.size 为 0，返回 None 让调用方回退整包回读
    stamp = file_stamp(stage)
    if sink.size != stamp["size"]:
        return None
    return dict(stamp, sha256=sink.hash.hexdigest())


@contextmanager
def _patch_lock(path, busy_detail):
    with ExitStack() as stack:
        try:
            stack.enter_context(file_lock(path, timeout=0.0))
        except runtime_lock.FileLockBusy as error:
            raise PatchLockBusy(busy_detail) from error
        yield


def _check_patch_source(source):
    try:
        _same_stamp(ASAR, source)
    except PendingTmpError as error:
        raise PatchSourceChanged(str(error)) from error


def _validate_patch_stage(stage, modify, source):
    """锁外构建并完整验证独占 stage；返回短锁内复验身份所需的凭证。"""
    _check_patch_source(source)
    try:
        fingerprint = _repack_stage(stage, modify)
        if not _same_fingerprint(source_fingerprint(ASAR), source):
            raise PatchSourceChanged("patch source content changed during build")
        meta = _checked_tmp_metadata(stage, source, "install", fingerprint)
        with stage.open("rb") as stream:
            header, base = read_header(stream)
            nodes = dict(iter_files(header))
            for name, expected in modify.items():
                node = nodes[name]
                stream.seek(base + int(node["offset"]))
                if stream.read(node["size"]) != expected:
                    raise PendingTmpError(f"stage asset differs from intended bytes: {name}")
        _same_stamp(stage, meta["tmp"])
        return meta
    except PendingTmpError:
        _check_patch_source(source)
        raise


def _prepare_tmp(modify, operation="install", source=None):
    """Generate privately, validate and publish a regular pending package; caller owns locking."""
    source = source if source is not None else source_fingerprint(ASAR)
    _same_stamp(ASAR, source)
    _sweep_stale_stages(TMP.parent)
    previous = None
    if TMP.exists() or TMP.is_symlink() or TMP_META.exists() or TMP_META.is_symlink():
        previous = _owned_tmp_metadata()
    with _archive_stage() as stage:
        fingerprint = _repack_stage(stage, modify)
        return _publish_pending(stage, source, operation, previous, fingerprint=fingerprint)


def _has_pending_artifacts():
    return any(path.exists() or path.is_symlink() for path in (TMP, TMP_META))


def _patch_stage_published(stamp):
    """Check disk after an interrupted commit, with the target and marker locks still held."""
    try:
        if _same_renamed_file(file_stamp(ASAR), stamp):
            return True
    except (FileNotFoundError, PendingTmpError):
        pass
    except OSError:
        return True  # Cannot rule out a completed swap. Keep its intent.
    try:
        pending = pending_tmp("install")["tmp"]
        return pending["sha256"] == stamp["sha256"] and _same_renamed_file(pending, stamp)
    except PendingTmpError:
        return False
    except OSError:
        return True


def _commit_patch_stage(stage, source, validated, installation):
    """目标锁已持有：复查盘面、发布 intent，并直替或在同一把锁内发布 pending。"""
    reclaim_stale_journal()
    if _has_pending_artifacts():
        return {"status": "deferred", "detail": "existing pending operation"}

    stamp = validated["tmp"]
    _check_patch_source(source)
    _same_stamp(stage, stamp)
    try:
        with runtime_lock.publish_supplement(
                RUNTIME, installation,
                committed=lambda: _patch_stage_published(stamp)) as keep_pending:
            # Recheck identities next to the rename after writing the restart intent.
            _check_patch_source(source)
            _same_stamp(stage, stamp)
            try:
                os.replace(stage, ASAR)
            except OSError as error:
                if not isinstance(error, PermissionError) and getattr(error, "winerror", None) not in (5, 32):
                    raise
                try:
                    _publish_pending(stage, source, "install", None, validated=validated)
                except (OSError, PendingTmpError):
                    _check_patch_source(source)
                    raise
                keep_pending()
                return {"status": "pending"}
        return {"status": "patched"}
    except runtime_lock.RestartMarkerBusy as error:
        raise PatchLockBusy("restart marker lock busy") from error


def _supplement_blocked():
    """Only acquire the target lock when a pending artifact needs stale-journal arbitration."""
    if not _has_pending_artifacts():
        return False
    if not PATCH_SUPPLEMENT:
        return True
    try:
        with _patch_lock(ASAR.with_name(ASAR.name + ".zusage.lock"), "target lock busy"):
            reclaim_stale_journal()
    except PatchLockBusy:
        return True  # A pending operation was already observed. Let its owner finish.
    return _has_pending_artifacts()


def _apply_patch_plan(entry, modify, source):
    # Coordinate with sessions still running the older relay-only installer.
    build_lock_path = ASAR.with_name(ASAR.name + ".zusage.mobile-build.lock")
    with _patch_lock(build_lock_path, "patch build lock busy"):
        _sweep_stale_stages(TMP.parent, supplement=True)
        with _archive_stage(supplement=True) as stage:
            validated = _validate_patch_stage(stage, modify, source)
            installation = {"asar": validated["asar"],
                            "entryHash": hashlib.sha256(modify.get("/" + ENTRY, entry)).hexdigest()}
            with _patch_lock(ASAR.with_name(ASAR.name + ".zusage.lock"), "target lock busy"):
                return _commit_patch_stage(stage, source, validated, installation)


def prepare_tmp(modify, operation="install", source=None):
    """Generate privately, validate, then publish; unknown historical TMPs stay."""
    with _target_lock():
        return _prepare_tmp(modify, operation, source)


def publish_external_pending(stage, source=None, operation="install"):
    """把外部已构建好的完整 asar 镜像发布为待替换包（renderer 桥链：ensure_deployed
    就地替换被拒后转存）。与 prepare_tmp 同一套校验与 journal 语义；stage 一经移交，
    成功转存或失败清理都由本函数负责，调用方不再管理该文件。已有 pending 的
    operation 为 remove 时拒绝：自动补桥绝不覆盖用户的显式卸载意图——调用方的
    锁外快照（pending_operation）存在 TOCTOU，以锁内判定为准（issue #67 二审）。"""
    stage = Path(stage)
    source = source if source is not None else source_fingerprint(ASAR)
    with _target_lock():
        _sweep_stale_stages(TMP.parent)
        previous = None
        if TMP.exists() or TMP.is_symlink() or TMP_META.exists() or TMP_META.is_symlink():
            previous = _owned_tmp_metadata()
        try:
            if operation == "install" and previous is not None and previous["operation"] == "remove":
                raise PendingTmpError("pending remove in progress; install pending refused")
            return _publish_pending(stage, source, operation, previous)
        finally:
            try:
                stage.unlink(missing_ok=True)
            except OSError:
                pass


def pending_operation():
    """当前待替换 sidecar 的 operation（install/remove/cancelled）；无合法 sidecar
    时返回 None。桥补装链用它让位：用户 remove 待收尾期间，自动补桥不得以
    install pending 覆盖卸载意图。"""
    try:
        return _load_tmp_metadata()["operation"]
    except PendingTmpError:
        return None


def revive_orphan_pending(pi=None, require_writable=False):
    """检测有效待收尾包且实例锁空闲时静默补拉监控（SessionStart hook 与 MCP 启动共用）。
    传入 pi 模块/桩对象（默认本模块自身），保持测试 mock 接缝完整。"""
    target = sys.modules[__name__] if pi is None else pi
    if target.pending_operation() not in ("install", "remove"):
        return False
    with target.monitor_instance_lock() as acquired:
        if not acquired:
            return False
    if require_writable and not target.target_writable():
        return False
    previous = os.environ.get("ZUSAGE_MONITOR_QUIET")
    try:
        os.environ["ZUSAGE_MONITOR_QUIET"] = "1"
        with contextlib.redirect_stdout(sys.stderr):
            target.launch_monitor(time.time())
    finally:
        if previous is None:
            os.environ.pop("ZUSAGE_MONITOR_QUIET", None)
        else:
            os.environ["ZUSAGE_MONITOR_QUIET"] = previous
    return True


def pending_tmp(operation="install", verify_hash=False, verified=None):
    """校验来源及 TMP；verified 是单次监控的缓存，stat/sidecar 不变才复用 hash。"""
    meta = _load_tmp_metadata()
    if meta["operation"] == "cancelled":
        if meta.get("publishing") is True:
            raise PendingTmpBusy("pending publish in progress")   # 瞬时态：重试待新世代落定
        raise PendingTmpError("pending operation/runtime is no longer authorized")
    if (meta.get("validated") is not True or
            (operation is not None and meta["operation"] != operation) or
            (meta["operation"] == "install" and meta["runtime"] != str(RUNTIME.resolve()))):
        raise PendingTmpError("pending operation/runtime is no longer authorized")
    _same_stamp(ASAR, meta["source"])
    _same_stamp(TMP, meta["tmp"])
    if verify_hash and (verified is None or verified.get("metadata") != meta):
        if not (_same_fingerprint(source_fingerprint(ASAR), meta["source"]) and
                _same_fingerprint(source_fingerprint(TMP), meta["tmp"])):
            raise PendingTmpError("pending source/TMP hash mismatch")
        try:
            ok = self_check(TMP, expect=meta["operation"] == "install")
        except (ValueError, AssertionError, KeyError, struct.error) as e:
            raise PendingTmpError(f"pending self-check failed: {e}") from e
        if not ok:
            raise PendingTmpError("pending self-check failed")
        _same_stamp(ASAR, meta["source"])
        _same_stamp(TMP, meta["tmp"])
        if verified is not None:
            verified["metadata"] = meta
    return meta


def _replace_pending(operation, verified=None, client_closed=None):
    meta = pending_tmp(operation, verify_hash=True, verified=verified)
    if client_closed is not None and not client_closed():
        return False
    # 紧贴 rename 再核对。外部升级不共享 OS 锁，仍有无法彻底消除的极短 TOCTOU 窗口。
    if pending_tmp(operation) != meta:
        raise PendingTmpError("sidecar changed before replacement")
    publication = (publish_install(RUNTIME, {"asar": str(ASAR.resolve()),
                   "entryHash": hashlib.sha256(entry_bytes_of(TMP)).hexdigest()})
                   if meta["operation"] == "install" and (RUNTIME / ".plugin-restart-required").is_file()
                   else nullcontext())
    with publication:
        if pending_tmp(operation) != meta:
            raise PendingTmpError("sidecar changed before replacement")
        os.replace(TMP, ASAR)
    try:
        if _load_tmp_metadata() == meta:
            TMP_META.unlink()
    except (OSError, PendingTmpError):
        pass  # 替换已经成功；不能因 sidecar 清理失败重试并误报失败。
    return True


def finalize_tmp(operation="install", client_closed=None, verified=None):
    """只收尾可信包且客户端已退出；OSError 可重试，PendingTmpError 须取消。"""
    closed = client_closed if client_closed is not None else lambda: not client_running()
    if not closed():
        return False
    with _target_lock():
        if not closed():
            return False
        return _replace_pending(operation, verified=verified, client_closed=closed)


# ---------- 安装 / 卸载 ----------
#
# 临时文件创建统一走 runtime_lock.bounded_mkstemp（单次快错原语，语义见其
# docstring）：asar 同目录的 stage/写入探针一律经本模块导入名调用，不走会在
# Windows 受保护目录上无限换名挂起的 tempfile.mkstemp（issue #360）。


def target_writable():
    """asar 与其所在目录都可写（/opt 等系统位置需要 root：只读目标不能再重打包）。
    Windows 的 os.access 看不见 ACL，对受保护目录恒报可写（issue #67/#130 实测），
    快速判定通过后再在同目录做一次真实写入探针兜底（即建即删，判定不过会省掉
    一次注定失败的重打包，也让 hook 场景下「无人能收尾」可被正确识别）；
    探针走 bounded_mkstemp，不用会在 Windows 受保护目录上无限重试的
    tempfile.mkstemp（issue #360）。"""
    if not (os.access(ASAR, os.W_OK) and os.access(ASAR.parent, os.W_OK)):
        return False
    try:
        fd, name = bounded_mkstemp(prefix=".zusage-writable-probe.", dir=ASAR.parent)
    except OSError:
        return False
    os.close(fd)
    try:
        Path(name).unlink(missing_ok=True)
    except OSError:
        pass   # 已证明可写；残余探针文件无害，不为此改变判定
    return True


def is_elevated():
    """本进程是否具备越过目标目录写保护的身份（Windows 管理员 / POSIX root）；
    探测失败按无提权处理。受保护目录上提权 monitor 是唯一能收尾待替换包的进程
    （issue #130）：hook 无提权重不了尾也重建不了它，区分两者决定提示与页脚文案。"""
    try:
        if IS_WIN:
            import ctypes
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        return os.geteuid() == 0
    except (AttributeError, OSError):
        return False


def sudo_hint(operation="install"):
    """系统位置不可写时可操作的提示：sudo 默认重置 HOME/PATH，必须显式保留，
    否则 nvm 装的 node 与 ~/.zcode 下的运行时目录都会找错（issue #15）。
    插件安装走 overlay_install.py，仓库根一键安装走 install.py；用当前目录实际在的那个。
    operation 必须和调用方实际要做的事一致：install 场景提示装，remove 场景提示卸载，
    否则会把想卸载的用户引导去重新安装/注入（issue #15 的 review 发现）。
    Windows 没有 sudo：受保护目录（Program Files 等）的提示是以管理员身份重跑（issue #67）。"""
    here = Path(__file__).resolve().parent
    args = {"install": ("overlay_install.py", "install"), "remove": ("overlay_install.py", "remove")}[operation]
    fallback = ("install.py", "" if operation == "install" else "--remove")
    script, cmd = next(((here / name, cmd) for name, cmd in (args, fallback)
                        if (here / name).is_file()), (here / fallback[0], fallback[1]))
    if IS_WIN:
        print(L(f"[权限] app.asar 或其所在目录不可写（Program Files 等受保护位置需要管理员）：{ASAR}",
                f"[permission] app.asar or its directory is not writable (protected locations like Program Files need an administrator): {ASAR}"))
        print(L("请以管理员身份打开终端（右键终端图标，选「以管理员身份运行」），然后执行：",
                "Open a terminal as administrator (right-click the terminal icon, choose 'Run as administrator'), then run:"))
        print(L('  "{}" "{}" {}'.format(PYEXE, script, cmd).rstrip(),
                '  "{}" "{}" {}'.format(PYEXE, script, cmd).rstrip()))
        return
    print(L(f"[权限] app.asar 或其所在目录不可写（Linux 上 /opt 等系统位置需要 root）：{ASAR}",
            f"[permission] app.asar or its directory is not writable (Linux system locations like /opt need root): {ASAR}"))
    print(L("请用 sudo 重跑，并保留当前 HOME 与 PATH（sudo 默认重置它们，会让 nvm 的 node "
            "和 ~/.zcode 下的运行时目录定位失败）：",
            "Re-run with sudo while keeping the current HOME and PATH (sudo resets both by default, "
            "which hides an nvm node and mislocates the runtime dir under ~/.zcode):"))
    print(L('  sudo env HOME="$HOME" PATH="$PATH" python3 "{}" {}'.format(script, cmd).rstrip(),
            '  sudo env HOME="$HOME" PATH="$PATH" python3 "{}" {}'.format(script, cmd).rstrip()))


def _reusable_pending_install(new_entry):
    """磁盘已有「同来源、同运行时、入口与本次安装目标完全一致」的有效待收尾包时
    判定可复用（issue #120）：pending_tmp 以 stat 级校验 sidecar 的 validated/runtime
    与来源、TMP 的 stamp 未变——sidecar 发布时已做过整包 hash、自检与语法检查，
    stamp 未变即内容未变；再比对 TMP 入口与本次将写入的 new_entry 逐字节一致。
    最终替换仍走原有全量校验链。任何不确定（文件缺失、stamp 变化、结构异常）都
    返回 False 走原有重打包路径。"""
    try:
        pending_tmp("install")
        return entry_bytes_of(TMP) == new_entry
    except (OSError, ValueError, AssertionError, KeyError, struct.error):
        return False


def _extra_modifications(hook, source):
    """并入同一次重打包的旁路改写（渲染桥等）。返回 {} 表示不并入：未提供钩子、抛异常、
    形态不符、不是基于同一份来源归档算出的、路径不在归档内、路径是外置/链接项，或触碰
    主入口。旁路改写绝不影响 loader 安装。"""
    if hook is None:
        return {}
    try:
        planned = hook()
        extra = planned.get("modify") if isinstance(planned, dict) else None
        if not isinstance(extra, dict) or not extra or not _same_fingerprint(source, planned.get("source")):
            return {}
        with open(ASAR, "rb") as stream:
            nodes = dict(iter_files(read_header(stream)[0]))
        if any(not isinstance(path, str) or path == "/" + ENTRY or not isinstance(data, bytes)
               or not data or path not in nodes or nodes[path].get("unpacked") or "link" in nodes[path]
               for path, data in extra.items()):
            return {}
        return dict(extra)
    except Exception:
        return {}


def supplement_patches(plan_bridge=None, *, snapshot=None):
    """Apply available archive patches to the current loader in one short-lock transaction."""
    for attempt in range(2):
        report = {"archive": {"status": "present"}}
        try:
            if _supplement_blocked():
                status = {"status": "deferred", "detail": "existing pending operation"}
                return {"archive": status, "relay": status, "bridge": status}
            if attempt == 0 and snapshot is not None:
                inspection = snapshot
                _check_patch_source(inspection[0])
            else:
                try:
                    inspection = _archive_snapshot(ASAR)
                except PendingTmpError as error:
                    raise PatchSourceChanged(str(error)) from error
            stamp, entry, package = inspection
            loader_lines = [match.group() for match in ZUSAGE_LINE_RE.finditer(entry)]
            if loader_lines != [INJECT_LINE.encode()]:
                status = {"status": "deferred", "detail": "loader path does not match runtime"}
                return {"archive": status, "relay": status, "bridge": status}

            modify = {}
            if plan_bridge is not None:
                report["bridge"], bridge_modify = plan_bridge(ASAR, stamp)
                modify.update(bridge_modify)
            try:
                relay_entry = transform_mobile_entry(entry, "apply", package=package)
                if relay_entry == entry:
                    report["relay"] = {"status": "present"}
                else:
                    modify["/" + ENTRY] = relay_entry
                    report["relay"] = {"status": "planned"}
            except RelayPatchError as error:
                report["relay"] = {"status": "skipped-unknown", "detail": str(error)}
            _check_patch_source(stamp)
            if not modify:
                return report
            if not PATCH_SUPPLEMENT:
                raise PendingTmpError("patch publication unavailable")
            try:
                source = _source_for_repack(inspection)
            except PendingTmpError as error:
                raise PatchSourceChanged(str(error)) from error
            except (OSError, ValueError, TypeError, KeyError, OverflowError, struct.error):
                _check_patch_source(stamp)
                raise
            if not target_writable():
                raise PermissionError("target not writable")
            outcome = _apply_patch_plan(entry, modify, source)
            if outcome["status"] == "pending":
                launch_monitor(time.time())
        except PatchSourceChanged as error:
            if attempt == 0:
                continue
            outcome = {"status": "deferred", "detail": str(error)}
        except PatchLockBusy as error:
            detail = "existing pending operation" if _has_pending_artifacts() else str(error)
            outcome = {"status": "deferred", "detail": detail}
        except Exception as error:
            outcome = {"status": "skipped-error", "detail": str(error)}
            if isinstance(error, PermissionError):
                outcome["permission"] = True
        report["archive"] = outcome
        for key in ("bridge", "relay"):
            if report.get(key, {}).get("status", "planned") == "planned":
                report[key] = dict(report.get(key, {}), **outcome)
        return report


def install(finalize=False, before_publish=None, *, extra_modify=None):
    """Install the loader and available archive patches in a single package."""
    if finalize:
        return _install(finalize=True)
    assert LOADER.exists(), L(f"loader 缺失：{LOADER}", f"loader missing: {LOADER}")
    if not target_writable():
        sudo_hint()
        return False
    try:
        with _target_lock():
            return _install(before_publish=before_publish, extra_modify=extra_modify)
    except OSError as e:
        print(L(f"安装锁获取失败：{e}", f"Cannot acquire install lock: {e}"))
        return False


def _install(finalize=False, before_publish=None, extra_modify=None):
    """返回 True=已安装/已指向当前目录，False=失败或待收尾。"""
    if finalize:
        try:
            ok = finalize_tmp(operation="install")
        except (OSError, PendingTmpError) as e:
            print(L(f"收尾未完成，保留 TMP，请确认退出客户端并重新安装：{e}",
                    f"Finalization not completed; TMP kept, quit the client and re-run install: {e}"))
            return False
        if ok:
            cleanup_legacy_bak()
        return ok
    assert LOADER.exists(), L(f"loader 缺失：{LOADER}", f"loader missing: {LOADER}")
    try:
        inspection = _archive_snapshot(ASAR)
        stamp, entry, package = inspection
        try:
            mobile_entry = transform_mobile_entry(entry, "apply", package=package)
        except RelayPatchError as error:
            mobile_entry = entry
            print(L(f"远控中继布局无法验证（{error}），保留原代码，继续安装用量状态栏。",
                    f"Could not verify the remote control relay layout ({error}). Preserving the existing code and continuing the status bar install."))
        loader_line = INJECT_LINE.encode()
        new_entry = ZUSAGE_LINE_RE.sub(b"", mobile_entry) + loader_line
        _same_stamp(ASAR, stamp)
        changed = new_entry != entry
        reuse_pending = changed and _reusable_pending_install(new_entry)
        source = _source_for_repack(inspection) if changed and not reuse_pending else None
    except (OSError, ValueError, AssertionError, KeyError, TypeError, OverflowError, struct.error) as e:
        print(L(f"来源校验失败：{e}", f"Source validation failed: {e}"))
        return False
    if not changed:
        print(L("已安装，注入行已指向当前目录。", "Already installed; the injection points at the current directory."))
        cleanup_legacy_bak()
        return True

    original_without_loader = ZUSAGE_LINE_RE.sub(b"", entry)
    if original_without_loader != entry and original_without_loader + loader_line != entry:
        print(L("检测到旧注入行（可能指向旧目录），将替换为新路径。",
                "Old injection line detected (possibly pointing to an old directory); it will be replaced with the new path."))
    verified = {}
    if reuse_pending:
        # 客户端持续运行期间每次 SessionStart 自动安装都会走到这里：直接复用磁盘上
        # 已排定的待收尾包，不再整包重打包/重写（issue #120 的写放大）。不新建意图。
        print(L("已有有效的待收尾包（内容一致），跳过重打包。",
                "A valid identical pending package already exists; skipping the repack."))
    else:
        print(L("重打包（约需十几秒）...", "repacking (takes ~10-20 seconds)..."))
        try:
            if before_publish is not None:
                before_publish({"asar": str(ASAR.resolve()),
                                "entryHash": hashlib.sha256(new_entry).hexdigest()})
            modify = {"/" + ENTRY: new_entry}
            modify.update(_extra_modifications(extra_modify, source))
            _prepare_tmp(modify, source=source)
            # 本进程刚生成并完整校验过待替换包，目标锁也全程未放：把 sidecar 登记进本进程
            # 的校验缓存，紧随其后的替换只核对身份戳。读不回就按未校验处理，照常完整验包。
            try:
                verified["metadata"] = _load_tmp_metadata()
            except PendingTmpError:
                pass
        except (OSError, PendingTmpError) as e:
            print(L(f"待替换包生成失败，未替换：{e}", f"Pending package preparation failed; not replaced: {e}"))
            return False
    if client_running():
        try:
            _replace_pending("install", verified=verified)
            print(L("\n客户端运行中，但 asar 原子替换成功（运行中进程仍读旧数据）。",
                    "\nZCode is running, but the asar was replaced atomically (running processes keep reading the old data)."))
            print(L("重启 ZCode 后悬浮条生效。若弹出了监控窗口，它会确认结果后自动关闭。",
                    "The floating bar activates after restarting ZCode. If a monitor window opened, it confirms the result and closes automatically."))
            cleanup_legacy_bak()
            launch_monitor(time.time())
            return True
        except PendingTmpError as e:
            print(L(f"待替换包已失效，未替换：{e}", f"Pending package invalidated; not replaced: {e}"))
            return False
        except OSError as e:
            tool = RUNTIME / "patch_install.py"
            win_why = L("Windows 下运行中的 ZCode 会锁定 app.asar，这是预期现象而非安装故障。",
                        "On Windows a running ZCode locks app.asar; this is expected, not an install fault. ") if IS_WIN else ""
            print(L(f"\n运行中替换失败（{e}）。{win_why}监控会在完全退出 ZCode 后自动完成替换，",
                    f"\nReplacement while running failed ({e}). {win_why}A monitor finishes the replacement once ZCode quits completely,"))
            print(L(f"若弹出了监控窗口请勿关闭；没有窗口或已关闭时，可手动执行：\"{PYEXE}\" \"{tool}\" install --finalize --asar \"{ASAR}\" --runtime \"{RUNTIME}\"",
                    f"keep any monitor window open; with no window or after closing it, run manually: \"{PYEXE}\" \"{tool}\" install --finalize --asar \"{ASAR}\" --runtime \"{RUNTIME}\""))
            launch_monitor(time.time())
            return False
    try:
        if not _replace_pending("install", verified=verified, client_closed=lambda: not client_running()):
            launch_monitor(time.time())
            return False
    except PendingTmpError as e:
        print(L(f"待替换包已失效，未替换：{e}", f"Pending package invalidated; not replaced: {e}"))
        return False
    except OSError as e:
        print(L(f"替换失败，监控将等待退出并重试：{e}", f"Replacement failed; monitor will wait for exit and retry: {e}"))
        launch_monitor(time.time())
        return False
    print(L("完成。启动 ZCode 即可在窗口底部看到悬浮条。", "Done. Start ZCode and the floating bar appears at the bottom of the window."))
    cleanup_legacy_bak()
    launch_monitor(time.time())
    return True


def injected_state():
    """True=存在 loader 或可识别手机注入；False=未注入；None=asar 读不到。"""
    try:
        entry = entry_bytes_of(ASAR)
        if ZUSAGE_LINE_RE.search(entry):
            return True
        return any(marker in entry for marker in (_STASH_MARKER, _UPLINK_MARKER, _UPLINK_GENERATION_MARKER))
    except (OSError, ValueError, AssertionError, KeyError, struct.error):
        return None


def remove():
    # 系统位置（/opt 等）下普通用户拿不到 asar 锁：此时只有"确无注入"才该免 root 放行。
    # 安装从未成功过（issue #15 的常见状态）不需要剥离任何东西，豁免标记必须能写，
    # 否则「关闭自动安装与提醒」这件事本身也被权限卡住。
    if not target_writable():
        state = injected_state()
        if state is False:
            try:
                _cancel_pending_install()
            except (OSError, PendingTmpError) as e:
                print(L(f"（未注入，但旧安装意图清理失败：{e}）",
                        f"(not injected, but cleaning the stale install intent failed: {e})"))
            print(L("当前 asar 未注入，无需 root 权限。", "The current asar is not injected; root is not needed."))
            cleanup_legacy_bak()
            return True
        if state is None:
            # 读都读不到：把"关闭提醒"交回给调用方，别把 optout 也一起卡住。
            print(L("无法读取 app.asar（不存在或权限不足），无法确认注入状态。",
                    "Cannot read app.asar (missing or permission denied); the injection state is unknown."))
            return False
        sudo_hint("remove")
        return False
    try:
        with _target_lock():
            return _remove()
    except OSError as e:
        print(L(f"卸载锁获取失败：{e}", f"Cannot acquire remove lock: {e}"))
        return False


def _remove():
    """卸载：从当前 asar 剥离本工具注入行（不依赖备份，其它工具的注入行不受影响）。
    返回 True=已卸载/本就未注入，False=需人工处理（替换失败待收尾）。"""
    try:
        _cancel_pending_install()  # 即使目标未注入，也不能让旧 install TMP 在 optout 后重注入。
        inspection = _archive_snapshot(ASAR)
        stamp, original, package = inspection
        old = original
        if (_STASH_MARKER in old or _UPLINK_MARKER in old or _UPLINK_GENERATION_MARKER in old):
            try:
                old = transform_mobile_entry(old, "remove", package=package)
            except RelayPatchError as e:
                print(L(f"无法安全移除远控中继补丁：{e}", f"Cannot safely remove the mobile relay patch: {e}"))
                return False
        stripped = ZUSAGE_LINE_RE.sub(b"", old)
        _same_stamp(ASAR, stamp)
        source = _source_for_repack(inspection) if stripped != original else None
    except (OSError, ValueError, AssertionError, KeyError, TypeError, OverflowError, struct.error) as e:
        print(L(f"卸载安全校验失败，未替换：{e}", f"Remove safety validation failed; not replaced: {e}"))
        return False
    if stripped == original:
        print(L("当前 asar 未注入。", "The current asar is not injected."))
        cleanup_legacy_bak()
        return True
    print(L("重打包（剥离注入行，约需十几秒）...", "repacking (stripping the injection line, takes ~10-20 seconds)..."))
    verified = {}
    try:
        _prepare_tmp({"/" + ENTRY: stripped}, operation="remove", source=source)
        # 同 _install：本进程刚生成并完整校验过，替换前只核对身份戳
        try:
            verified["metadata"] = _load_tmp_metadata()
        except PendingTmpError:
            pass
    except (OSError, PendingTmpError) as e:
        print(L(f"卸载待替换包生成失败：{e}", f"Remove pending package preparation failed: {e}"))
        return False
    running = client_running()
    try:
        _replace_pending("remove", verified=verified)
    except PendingTmpError as e:
        print(L(f"卸载待替换包已失效，未替换：{e}", f"Remove pending package invalidated; not replaced: {e}"))
        return False
    except OSError as e:
        tool = RUNTIME / "patch_install.py"
        print(L(f'\n替换失败（{e}）。请完全退出 ZCode 后重跑 "{PYEXE}" "{tool}" remove --asar "{ASAR}"，',
                f'\nReplacement failed ({e}). Quit ZCode completely and re-run "{PYEXE}" "{tool}" remove --asar "{ASAR}", '))
        print(L("待替换文件保留；不要手动 move/mv 覆盖可能已升级的 app.asar。",
                "Pending files kept; do not manually move/mv over a possibly upgraded app.asar."))
        return False
    print(L("已剥离注入行" + ("（客户端运行中，已原子替换，运行中进程仍读旧数据）" if running else "") + "。重启 ZCode 后生效。",
            "Injection line stripped" + (" (ZCode was running; replaced atomically, the running process keeps the old data)" if running else "") + ". Takes effect after restarting ZCode."))
    cleanup_legacy_bak()
    return True


def check():
    # CLI 诊断入口：坏目标（缺文件/非 asar）给可读提示，不抛裸 traceback
    try:
        stamp, entry, package = _archive_snapshot(ASAR)
        injected = bool(ZUSAGE_LINE_RE.search(entry))   # 宽松匹配任意目录的历史注入行（独立运行时 INJECT_LINE 指向仓库路径，精确匹配会误报未注入）
    except (OSError, ValueError, AssertionError, KeyError, TypeError, OverflowError, struct.error) as e:
        print(L(f"[check] 读取 asar 失败（{e}）：{ASAR}",
                f"[check] failed to read asar ({e}): {ASAR}"))
        return 1
    print("asar:", ASAR, stamp["size"], "bytes")
    print(L("注入状态:", "Injection:"), L("已注入", "injected") if injected else L("未注入", "not injected"))
    print(L("遗留备份（机制已退役，成功安装/卸载后自动清理）:", "Legacy backup (retired; auto-removed on successful install/remove):"), BAK.exists())
    if injected:
        syntax_check(ASAR)
    if TMP.exists():
        # 待替换 TMP 可能是 install 也可能是 remove（sidecar 的 operation 字段），命令不能
        # 写死 install --finalize——remove 的 TMP 照抄这条命令会被 pending_tmp 的操作类型
        # 校验拒绝；读不到/不可信时保留原本的 install --finalize 兜底（成功率更高的默认值）。
        try:
            operation = _load_tmp_metadata().get("operation")
        except PendingTmpError:
            operation = None
        if operation == "remove":
            hint = L(f'（退出 ZCode 后跑 remove --asar "{ASAR}"）',
                     f'(quit ZCode, then run remove --asar "{ASAR}")')
        else:
            hint = L(f'（退出 ZCode 后跑 install --finalize --asar "{ASAR}" --runtime "{RUNTIME}"）',
                     f'(quit ZCode, then run install --finalize --asar "{ASAR}" --runtime "{RUNTIME}")')
        print(L("存在待替换 TMP:", "Pending replacement TMP exists:"), TMP, hint)
    _, relay_detail = _relay_check_status(entry, package)
    print(L("远控中继补丁:", "Mobile relay patch:"), relay_detail)


def _consume_flag_arg(argv, name):
    """取出并剥离 --<name> <value> / --<name>=<value>（不论在 argv 哪个位置），返回
    (value_or_None, 剩余 argv)；剩余 argv 保持原有顺序，cmd/--finalize 解析不受影响。
    出现多次时取最后一次（与常见 CLI 行为一致）；紧跟的下一个 token 本身像另一个 flag
    （以 -- 开头）时按缺值处理，原样保留在剩余 argv 里，不会被误吞成这个 flag 的值。"""
    flag = f"--{name}"
    value, remaining, i = None, [], 0
    while i < len(argv):
        a = argv[i]
        if a == flag and i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            value = argv[i + 1]
            i += 2
            continue
        if a.startswith(flag + "="):
            value = a[len(flag) + 1:]
            i += 1
            continue
        remaining.append(a)
        i += 1
    return value, remaining


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    # standalone 运行（install.py/overlay_install.py 拉起时已 set_target()/set_runtime()，
    # 不会带这两个参数）：命令行优先于对应环境变量；都没有时沿用模块级默认值。
    # --asar 不猜自定义安装位置（按平台默认猜测，猜错即 FileNotFoundError）；
    # --runtime 不对就算 --asar 对了也无济于事——install --finalize 要求 sidecar 记录的
    # runtime 与当前 RUNTIME 一致（pending_tmp 的来源授权校验，二者各自 .resolve() 后比较，
    # 不受符号链接影响），standalone 默认 RUNTIME=HERE（脚本所在目录），插件安装时 sidecar
    # 记的却是运行时数据目录，两者不一致会被拒绝 "pending operation/runtime is no longer
    # authorized"。两者均见文件顶部用法说明。
    asar_arg, args = _consume_flag_arg(args, "asar")
    asar_arg = asar_arg or os.environ.get("ZCODE_ASAR")
    if asar_arg:
        set_target(os.path.expandvars(os.path.expanduser(asar_arg)))
    runtime_arg, args = _consume_flag_arg(args, "runtime")
    runtime_arg = runtime_arg or os.environ.get("ZCODE_RUNTIME")
    if runtime_arg:
        # 不用 .resolve()：各打印点原样回显当前 RUNTIME（见上方 install/check 的提示），
        # 用户复制粘贴后必须字节级还原成同一个值——self_check() 用 RUNTIME 现算的
        # INJECT_LINE 与 TMP 里已固化的内容做字面比较，不再重新 resolve；若这里 resolve，
        # 符号链接路径上（如 macOS /var 对 /private/var）会生成不同字符串，白白通过授权
        # 校验却自检失败。但 LOADER.as_uri() 要求绝对路径，手动输入相对路径会直接崩溃
        # （提示本身回显的永远是绝对路径，不受影响）；os.path.abspath 只补全成绝对路径、
        # 不跟随符号链接解析，对已是绝对路径的输入是纯粹的 no-op，两头都不破。
        set_runtime(os.path.abspath(os.path.expandvars(os.path.expanduser(runtime_arg))))
    cmd = args[0] if args else "check"
    if cmd == "install":
        return install(finalize="--finalize" in args[1:])
    return {"remove": remove, "check": check}.get(cmd, check)()


if __name__ == "__main__":
    # check 等子命令的失败退出码必须真正生效（曾裸 main() 恒 0）；bool 返回值不能直接
    # sys.exit——True 会被当成退出码 1（失败），False 变 0（成功），成功失败颠倒。
    # stdout / stderr 接管道时钉 UTF-8：Windows 默认按区域代码页编码，check / install 的中文
    # 提示在 cp1252 管道上 UnicodeEncodeError 中断，GBK 管道上则是按 UTF-8 读不清的字节
    # ——与 usage_mcp.py、hooks、overlay_install.py 同款防护。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    result = main()
    sys.exit(0 if result is True or result is None else (result or 1))
