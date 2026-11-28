# -*- coding: utf-8 -*-
"""「ZCode Token 用量状态栏」安装监控窗口（安装完成后自动弹出的常驻命令行）。

每 10 秒检测一次，全程只读（唯一的写操作是 TMP 替换，见下），不联网：
1. 存在待替换 TMP（客户端运行中导致原子替换失败的场景）：等 ZCode 退出后自动完成
   asar 替换 —— 取代旧的 schtasks 计划任务收尾方案（finalize_if_closed.py 已删）。
2. asar 已替换：持续提醒重启 ZCode；检测到 ZCode 换了新进程（进程集合与启动采集的
   不相交）后，用 diag-<n>.json 的更新时间确认注入链路已加载，显示成功并自动退出。
   diag 是启动后第一次数据拉取就回写的（pushCount==1），空闲也会写，不依赖用户发消息。

手动运行：python install_monitor.py [install_epoch 秒] [app.asar 路径] [运行时目录]
（缺省用当前时间/默认 asar 位置；diag 在运行时目录——标准安装是数据目录副本所在，
 --dev 安装传仓库目录，不传则用本脚本所在目录）
退出：生效确认后自动退出；或 Ctrl+C / 直接关闭窗口。

输出语言：运行时目录 config.json 的 "lang" 字段（zh/en，缺省 zh）——与安装器/CLI 同一来源。
"""
import csv
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent.resolve()
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")
# 手动命令模板里的解释器：用当前真实解释器绝对路径，不猜 python/python3 别名
# （Windows 上 python3 可能是 Microsoft Store 存根会静默失败；用户反馈 2026-11-03）
PYEXE = sys.executable or "python"
# 缺省仅兜底（patch_install.py 拉起时必传 argv[2]）：按平台取常见安装位置
ASAR = Path(sys.argv[2]) if len(sys.argv) > 2 else (
    Path("/Applications/ZCode.app/Contents/Resources/app.asar") if IS_MAC
    else Path("/opt/ZCode/resources/app.asar") if IS_LINUX
    else Path(r"D:\ZCode\resources\app.asar"))
RUNTIME_DIR = Path(sys.argv[3]) if len(sys.argv) > 3 else HERE
TMP = ASAR.with_name("app.asar.zusage.tmp")
RELAUNCH_REQUEST = RUNTIME_DIR / "relaunch-request.json"
RELAUNCH_MAX_AGE_MS = 15 * 60 * 1000
POLL = 10            # 检测间隔（秒）
CONFIRM_WAIT = 120   # 重启后等 diag 确认的超时（秒）
BYE = 8              # 成功提示停留秒数
# WMI 拉起（issue #208：launch_monitor 的脱离式通道）不继承调用方环境，静默开关由
# 尾部 --quiet 参数传达，等效于 ZUSAGE_MONITOR_QUIET=1；位置参数 epoch/asar/runtime
# 的索引不受影响（标志固定排在位置参数之后）。
if "--quiet" in sys.argv[1:]:
    os.environ["ZUSAGE_MONITOR_QUIET"] = "1"
QUIET = os.environ.get("ZUSAGE_MONITOR_QUIET") == "1"


def load_lang():
    try:
        lang = json.loads((RUNTIME_DIR / "config.json").read_text(encoding="utf-8")).get("lang")
        return lang if lang in ("zh", "en") else "zh"
    except (OSError, ValueError):
        return "zh"


LANG = load_lang()


def L(zh, en):
    """双语输出：按 LANG 返回对应文案（与 install.py 同款约定）。"""
    return en if LANG == "en" else zh


def zcode_pids():
    """ZCode 主进程 PID 集合（Windows=tasklist，macOS/Linux=pgrep）；探测命令不可用时返回 None。"""
    if os.name == "nt":
        try:
            r = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq ZCode.exe", "/FO", "CSV", "/NH"],
                capture_output=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),   # issue #221：静默监控无控制台，探测会弹终端窗
            )
        except OSError:
            return None
        pids = set()
        for row in csv.reader(r.stdout.decode("gbk", "replace").splitlines()):
            if len(row) >= 2 and row[0].strip().lower() == "zcode.exe":
                pids.add(row[1].strip())
        return pids
    try:
        r = subprocess.run(["pgrep", "-x", "ZCode"], capture_output=True)
    except OSError:
        return None
    if r.returncode == 1:
        return set()   # pgrep：无匹配进程
    if r.returncode != 0:
        return None    # pgrep 自身出错
    return {t.strip() for t in r.stdout.decode().split() if t.strip()}


def zcode_pid_starts(pids):
    """ZCode 各进程的启动时刻（epoch 秒）字典；探测命令不可用或一个都拿不到时返回
    None。Windows 走 PowerShell Get-Process（wmic 已从新系统移除），其余平台走
    ps lstart；个别进程拿不到启动时间就跳过，剩下的仍足以找出最早一批。调用方应
    只在 PID 集合变化时查询：PowerShell 冷启动可达数秒，不能每轮轮询都调（issue #185）。"""
    if not pids:
        return {}
    if os.name == "nt":
        try:
            r = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "Get-Process ZCode -ErrorAction SilentlyContinue | ForEach-Object { "
                 "try { '{0}|{1}' -f $_.Id, $_.StartTime.ToFileTime() } catch {} }"],
                capture_output=True, timeout=20,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))   # issue #221
        except (OSError, subprocess.TimeoutExpired):
            return None
        starts = {}
        for line in r.stdout.decode("gbk", "replace").splitlines():
            pid, sep, filetime = line.strip().partition("|")
            if not sep:
                continue
            try:
                starts[pid] = int(filetime) / 10000000 - 11644473600
            except ValueError:
                continue
        return starts or None
    try:
        r = subprocess.run(["ps", "-o", "pid=,lstart=", "-p", ",".join(sorted(pids))],
                           capture_output=True,
                           env=dict(os.environ, LC_ALL="C"))
    except OSError:
        return None
    starts = {}
    for line in r.stdout.decode("utf-8", "replace").splitlines():
        pid, sep, lstart = line.strip().partition(" ")
        if not sep:
            continue
        try:
            starts[pid] = time.mktime(time.strptime(lstart, "%a %b %d %H:%M:%S %Y"))
        except ValueError:
            continue
    return starts or None


def wait_any_exit(pids, timeout_s):
    """阻塞到任一 ZCode 进程退出或超时。Windows 用进程句柄事件驱动等待，消灭固定
    轮询间隔可能错过的「退出→立即重启」空档（等错过后监控只会看到新进程，永远收不了尾）；
    采集后已退出的 PID 视为退出已发生，立即返回；句柄不可得（权限/句柄数超限/非 Windows）
    时退化为普通睡眠。"""
    if os.name != "nt" or not pids:
        time.sleep(timeout_s)
        return
    import ctypes
    from ctypes import wintypes
    SYNCHRONIZE = 0x00100000
    ERROR_INVALID_PARAMETER = 87   # OpenProcess：该 PID 已没有进程
    MAX_WAIT = 60   # WaitForMultipleObjects 上限 64，留余量；进程数更多时退化为睡眠
    try:
        pids = [int(pid) for pid in pids]
    except ValueError:
        time.sleep(timeout_s)
        return
    if len(pids) > MAX_WAIT:
        time.sleep(timeout_s)
        return
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.WaitForMultipleObjects.argtypes = [
        wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE), wintypes.BOOL, wintypes.DWORD]
    kernel32.WaitForMultipleObjects.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handles = []
    try:
        for pid in pids:
            handle = kernel32.OpenProcess(SYNCHRONIZE, False, pid)
            if handle:
                handles.append(handle)
            elif ctypes.get_last_error() == ERROR_INVALID_PARAMETER:
                return   # 采集后已退出：「任一退出」已经发生，立即复查
        if not handles:
            # 进程都在但全部无权等待（如其它用户会话的 ZCode）：按轮询间隔睡，
            # 立即返回会让监控忙转。
            time.sleep(timeout_s)
            return
        array = (wintypes.HANDLE * len(handles))(*handles)
        kernel32.WaitForMultipleObjects(len(handles), array, False, int(timeout_s * 1000))
    finally:
        for handle in handles:
            kernel32.CloseHandle(handle)


def diag_fresh(since):
    """返回安装时刻之后更新过的 diag 文件名（注入链路已加载的证据），没有则 None。"""
    for f in sorted(RUNTIME_DIR.glob("diag-*.json")):
        try:
            if f.stat().st_mtime >= since:
                return f.name
        except OSError:
            pass
    return None


def patch_module():
    import patch_install as pi
    pi.set_target(ASAR)
    pi.set_runtime(RUNTIME_DIR)
    return pi


def finalize_tmp(verified=None):
    """监控按 sidecar 的 install/remove 收尾，不吞掉不可重试的完整性错误。"""
    pi = patch_module()
    return pi.finalize_tmp(operation=None, client_closed=lambda: zcode_pids() == set(),
                           verified=verified)


def _monitor_log(message):
    """静默监控没有控制台；收尾/拉起结果落盘，问题可事后取证（issue #372）。"""
    try:
        with open(RUNTIME_DIR / "install-monitor.log", "a", encoding="utf-8") as stream:
            stream.write("%s [%d] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), os.getpid(), message))
    except OSError:
        pass


def _drop_relaunch(reason):
    _monitor_log("relaunch dropped: " + reason)
    try:
        RELAUNCH_REQUEST.unlink()
    except OSError:
        pass
    return False


def _maybe_relaunch():
    """换包完成后按 inject-main 写下的交接请求拉起新实例（issue #372）。

    应用内重启不能走 app.relaunch()：Windows 的 relauncher 助手本身也是 ZCode.exe，
    monitor 的「全部进程退出」判据在重启期间永不成立。inject-main 改为 quit-only +
    请求文件；这里在 TMP 已收尾、所有 ZCode 进程退出后拉起。任何校验不过都删除请求，
    绝不拉起——宁可让用户手动重开，也不能多开一个实例。拉起一律裸启动
    zcode_exe_for(asar) 推导出的客户端 exe：请求里的 argv 尾部不消费（review 安全
    审查——提权监控进程里任意启动参数可经 --inspect-brk/--gpu-launcher 等获得提权
    代码执行），请求文件只承载「用户在应用内点过重启」这一意图。"""
    try:
        data = json.loads(RELAUNCH_REQUEST.read_text(encoding="utf-8"))
    except FileNotFoundError:
        # 常态（绝大多数收尾没有应用内重启请求）；留一行便于 issue #372 类空窗取证。
        _monitor_log("no relaunch request (finalize without in-app restart)")
        return False
    except (OSError, ValueError):
        return _drop_relaunch("invalid request")
    if not isinstance(data, dict) or data.get("version") != 1:
        return _drop_relaunch("invalid request")
    asar = data.get("asar")
    if (not isinstance(asar, str)
            or os.path.normcase(os.path.abspath(asar)) != os.path.normcase(os.path.abspath(str(ASAR)))):
        return _drop_relaunch("asar mismatch")
    created = data.get("createdAt")
    now_ms = time.time() * 1000
    if (not isinstance(created, (int, float)) or isinstance(created, bool)
            or created - now_ms > 60000   # 未来时间戳不得绕过 15 分钟窗（review 安全审查）
            or now_ms - created > RELAUNCH_MAX_AGE_MS):
        return _drop_relaunch("stale request")
    pids = zcode_pids()
    if pids is None or pids:   # 客户端仍在跑（quit 被取消/手动重开）或无法确认：不拉起
        return _drop_relaunch("client still running")
    pi = patch_module()
    if pi.is_elevated():
        # 提权监控不拉起：不以管理员令牌拉起 GUI 宿主，也封死提权链上的参数注入面
        #（review 安全审查）；用户手动重开即可。
        return _drop_relaunch("elevated monitor")
    expected = pi.zcode_exe_for(pi.ASAR)
    # 推导不出客户端 exe 一律不拉起：不做 basename 同名回退（可被指向任意同名
    # 二进制，review 安全审查）。
    if not expected or not os.path.isfile(str(expected)):
        return _drop_relaunch("executable undetermined")
    exe = os.path.abspath(str(expected))
    cwd = data.get("cwd")
    cwd = cwd if isinstance(cwd, str) and os.path.isdir(cwd) else None
    # 先删请求再拉起：用户手动重开时 loader 启动清理/此处删除都避免第二次拉起。
    try:
        RELAUNCH_REQUEST.unlink()
    except OSError:
        pass
    try:
        options = dict(cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, close_fds=True)
        if os.name == "nt":
            options["creationflags"] = (getattr(subprocess, "DETACHED_PROCESS", 0)
                                        | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        else:
            options["start_new_session"] = True
        subprocess.Popen([exe], **options)
        _monitor_log("relaunch ok")
        return True
    except OSError as e:
        _monitor_log("relaunch failed: %s" % e)
        return False


def draw(lines):
    os.system("cls" if os.name == "nt" else "clear")
    print("\n".join(lines), flush=True)


def quiet_finalize():
    """hook 无窗口收尾：来源由 repack 前 sidecar 决定，不用监控启动时间推断。"""
    pi = patch_module()
    verified = {}
    deadline = time.monotonic() + 86400
    while TMP.exists() and time.monotonic() < deadline:
        try:
            # 预校验并焐热 verified 缓存（issue #72）：每个 sidecar 世代只 hash 一次大包，
            # 此后轮询 stat 命中缓存；退出窗口内不再 hash 大包（剩余为 stat、client_closed
            # 进程探测、可选 publish_install 与 rename 等原有毫秒~亚秒级小步骤），
            # 不再输给新实例首进程亚秒级重开 asar 的竞速。哈希失败（OSError）下轮重试。
            meta = pi.pending_tmp(operation=None, verify_hash=True, verified=verified)
            pids = zcode_pids()
            if pids == set() and finalize_tmp(verified=verified):
                if meta["operation"] == "install":   # 与可见监控同一门控：只消费 install 收尾的交接请求
                    _maybe_relaunch()
                return
            if pids:   # 客户端在跑：事件驱动等任一进程退出，立即复查（见 wait_any_exit）
                wait_any_exit(pids, POLL)
                continue
        except pi.PendingTmpBusy:
            pass  # 发布中 journal（issue #228）：瞬时态，下轮读到新世代继续值守；此处
                  # 退出让位 + launch_monitor 去重跳过新拉起 = 孤儿 pending。
        except pi.PendingTmpError:
            return  # 完整性/来源失效立刻取消；不删旧包，更不能回滚客户端新版。
        except OSError:
            if not pi.target_writable():
                # 受保护目录且本进程无提权：replace 重试注定失败（issue #130），
                # 空转一天只会占着实例锁、挡住提权重跑重建收尾——立即退出让位。
                return
            pass  # 文件占用等系统错误才重试，最多一天。
        time.sleep(POLL)
    if not TMP.exists():
        # TMP 已被其他进程收尾：交接请求仍需消费（issue #372）。
        _maybe_relaunch()


def main():
    """单实例去重（issue #120）：同一目标只保留一个监控进程，已有实例持锁时静默
    退出——SessionStart 自动安装每次都会尝试拉起监控，不去重会随会话数线性堆积。
    进程退出（含被杀）由 OS 释放锁，无陈锁残留。"""
    with patch_module().monitor_instance_lock() as acquired:
        if not acquired:
            return
        _run()


def _run():
    if QUIET:
        quiet_finalize()
        return
    epoch = float(sys.argv[1]) if len(sys.argv) > 1 else time.time()
    if os.name == "nt":
        try:
            subprocess.run(["cmd", "/c", "title", L("ZCode Token 用量状态栏 - 安装监控", "ZCode Token Usage Status Bar - Install Monitor")])
        except OSError:
            pass
    pids0 = zcode_pids() or set()   # 启动采集 ≈ 安装时刻的进程集合（install 完成即拉起本窗口）
    t0 = time.time()
    new_since = None
    starts = None          # 进程启动时刻缓存：集合不变不重查（见 zcode_pid_starts）
    starts_key = None
    pi = patch_module()
    verified = {}
    deadline = time.monotonic() + 86400
    while True:
        pids = zcode_pids()
        now = time.time()
        done = False
        pending = None
        finished = False
        finalize_denied = False
        publishing = False
        if TMP.exists():
            try:
                # 同 quiet_finalize：等待期预校验焐热缓存，退出窗口内不再 hash 大包（issue #72）。
                pending = pi.pending_tmp(operation=None, verify_hash=True, verified=verified)
                if time.monotonic() >= deadline:
                    draw([L("[!] 待替换包收尾已超过一天，停止自动重试。文件保留，请重新安装。",
                            "[!] Pending finalization timed out after one day; files kept. Re-run install.")])
                    return
            except pi.PendingTmpBusy:
                # 发布中 journal（issue #228）：本轮不收尾不取消，下轮读到新世代继续值守。
                # deadline 在此同样生效：发布方死在 journal 写后（375MB 重 hash 窗口被杀、
                # os.replace 被占用）遗留的卡死 journal，不能让可见监控无限值守持锁。
                if time.monotonic() >= deadline:
                    draw([L("[!] 待替换包收尾已超过一天，停止自动重试。文件保留，请重新安装。",
                            "[!] Pending finalization timed out after one day; files kept. Re-run install.")])
                    return
                publishing = True
            except pi.PendingTmpError as e:
                draw([L(f"[!] 待替换包来源/身份失效，取消收尾，文件保留：{e}",
                        f"[!] Pending source/identity invalid; finalization cancelled, files kept: {e}"),
                      L("请重新运行 install/remove，不要手动覆盖新版 asar。",
                        "Re-run install/remove; do not manually overwrite a newer asar.")])
                return
            except OSError as e:
                draw([L(f"[!] 暂时无法检查待替换包，稍后重试：{e}",
                        f"[!] Cannot check pending package yet; will retry: {e}")])
                if time.monotonic() >= deadline:
                    return
                time.sleep(POLL)
                continue
        if pids is None:
            lines = [L("[!] 无法检测 ZCode 进程（探测命令不可用）。",
                       "[!] Cannot detect ZCode processes (detection command unavailable).")]
        elif pending is not None:
            # 和 quiet/--finalize 共用来源、TMP hash、自检及退出校验。
            if not pids:
                try:
                    finished = finalize_tmp(verified=verified)
                except pi.PendingTmpBusy:
                    # 预检后、收尾前 sidecar 翻成发布中 journal（并发 publish 的亚秒
                    # 窗口）：本轮不画「替换失败」误导屏（其手动指引同样会被 Busy
                    # 拒绝），下轮按 publishing 等待屏续守（issue #228）。
                    publishing = True
                    continue
                except pi.PendingTmpError as e:
                    draw([L(f"[!] 待替换包已失效，取消收尾，文件保留：{e}",
                            f"[!] Pending package invalid; finalization cancelled, files kept: {e}")])
                    return
                except OSError:
                    finished = False
                    finalize_denied = not pi.target_writable()
                if finished:
                    relaunched = pending["operation"] == "install" and _maybe_relaunch()
                    lines = [L("[OK] ZCode 已退出，asar 替换完成。", "[OK] ZCode has exited; app.asar replacement finished."),
                             "",
                             L("请启动 ZCode，悬浮条即可显示。", "Start ZCode and the floating bar will appear.")]
                    if pending["operation"] == "remove":
                        lines[-1] = L("注入已移除；重新启动 ZCode 后生效。",
                                      "Injection removed; takes effect when ZCode starts again.")
                        done = True
                    elif relaunched:
                        lines[-1] = L("已按重启请求自动重新启动 ZCode。",
                                      "ZCode has been restarted automatically.")
                elif finalize_denied:
                    # 受保护目录上的无提权监控重试注定失败（issue #130）：指引
                    # 管理员重跑后退出释放实例锁，让提权重跑能立即拉起新监控。
                    lines = [L("[!] 替换失败：对 ZCode 安装目录没有写权限（受保护目录需要管理员）。",
                               "[!] Replacement failed: no write permission on the ZCode install directory (protected locations need an administrator)."),
                             L("本窗口无法完成收尾，请以管理员身份重跑安装，然后完全退出 ZCode 并重新打开。",
                               "This window cannot finalize; re-run the install as administrator, then quit ZCode completely and reopen it.")]
                    done = True
                else:
                    tool = RUNTIME_DIR / "patch_install.py"
                    lines = [L("[!] ZCode 已退出但替换失败（文件仍被占用？）",
                               "[!] ZCode has exited but the replacement failed (file still locked?)"),
                             L("稍后自动重试；也可手动执行：", "Will retry automatically; you can also run manually:"),
                             "  \"" + PYEXE + "\" \"" + str(tool) + "\" "
                             + (f'remove --asar "{ASAR}"' if pending["operation"] == "remove"
                                else f'install --finalize --asar "{ASAR}" --runtime "{RUNTIME_DIR}"')]
            else:
                # issue #185：关窗常被当成退出（Windows 驻留托盘/后台），pending
                # 永远等不到空档。画面点名「关窗不等于退出」，并显示最早进程启动
                # 时刻与补丁排定时刻的先后——「没退干净」一眼可见。
                if pids != starts_key:
                    starts_key = pids
                    starts = zcode_pid_starts(pids)
                sched = time.strftime("%H:%M:%S", time.localtime(epoch))
                lines = [L("[等待] 有待替换文件，请完全退出 ZCode（关闭窗口不等于退出）。",
                           "[waiting] A pending replacement file exists; please quit ZCode completely (closing the window is not quitting)."),
                         L("退出后本窗口将自动完成 asar 替换。",
                           "This window will finish the asar replacement automatically once you quit."),
                         "", L("当前 ZCode 进程数：%d" % len(pids), "Current ZCode process count: %d" % len(pids))]
                if starts:
                    oldest_epoch = min(starts.values())
                    oldest = time.strftime("%H:%M:%S", time.localtime(oldest_epoch))
                    if oldest_epoch < epoch:
                        lines.append(L("最早进程 %s 启动，早于补丁排定 %s：这些进程不全部退出，替换不会触发。" % (oldest, sched),
                                       "The oldest process started at %s, before the patch was scheduled (%s); the replacement waits for all of them to exit." % (oldest, sched)))
                    else:
                        lines.append(L("最早进程 %s 启动（补丁排定 %s）。" % (oldest, sched),
                                       "The oldest process started at %s (patch scheduled at %s)." % (oldest, sched)))
                lines.append(L("若已关闭所有窗口仍未替换，说明 ZCode 仍驻留托盘/后台：请从托盘图标退出，或在任务管理器中确认没有 ZCode 进程残留。",
                               "If all windows are closed but the replacement is still pending, ZCode is still resident in the tray/background: quit it from the tray icon, or use Task Manager to confirm no ZCode processes remain."))
        elif publishing:
            # 发布中 journal（issue #228）：等待发布完成，不误报「取消收尾」或「请重启」。
            lines = [L("[等待] 待替换包正在发布，稍候自动恢复值守……",
                       "[waiting] The pending package is being published; the watch resumes shortly…")]
        elif not pids:
            lines = [L("ZCode 未运行。启动 ZCode 后悬浮条即生效。",
                       "ZCode is not running. The floating bar activates once you start ZCode.")]
        elif pids & pids0:
            lines = [L(">>>>>  请 重 启 Z Code  <<<<<", ">>>>>  PLEASE RESTART ZCODE  <<<<<"),
                     "",
                     L("安装已完成，但当前还是旧实例（%d 个进程），" % len(pids),
                       "Installation finished, but the old instance is still running (%d processes)," % len(pids)),
                     L("请完全退出 ZCode（所有窗口）后重新打开。",
                       "please quit ZCode completely (all windows) and reopen it.")]
        else:
            if new_since is None:
                new_since = now
            d = diag_fresh(epoch)
            if d:
                lines = [L("[OK] ZCode 已重启，注入已加载（%s 已更新）。" % d,
                           "[OK] ZCode restarted, injection loaded (%s updated)." % d),
                         L("悬浮条应已出现在输入框下方。", "The floating bar should now be visible."),
                         "", L("本窗口即将自动关闭。", "This window will close automatically.")]
                done = True
            elif now - new_since > CONFIRM_WAIT:
                tool = RUNTIME_DIR / "patch_install.py"
                lines = [L("[?] ZCode 已重启，但 %d 秒内未检测到注入加载。" % CONFIRM_WAIT,
                           "[?] ZCode restarted, but no injection load detected within %ds." % CONFIRM_WAIT),
                         L("若 ZCode 刚升级过，asar 会被官方版本覆盖，",
                           "If ZCode was just upgraded, app.asar was overwritten by the official build —"),
                         L(f'请重新运行："{PYEXE}" "{tool}" install --asar "{ASAR}"',
                           f'please re-run: "{PYEXE}" "{tool}" install --asar "{ASAR}"'),
                         L("（继续检测中，diag 一更新即确认）", "(still watching; will confirm as soon as diag updates)")]
            else:
                lines = [L("ZCode 已重启（新实例），正在确认注入加载……",
                           "ZCode restarted (new instance); confirming injection load…")]
        el = int(now - t0)
        # 收尾未落定（done 终屏与 finished/finalize_denied 当轮终屏除外）时不能说
        # 「可随时关闭」：关窗即杀死收尾者。提权监控是受保护目录上唯一能收尾的进程
        # （hook 重建不了它，issue #130），重建门槛是管理员重跑；非提权场景插件链
        # 下次会话可自动重建、独立链需重跑安装或手动收尾（issue #163），门槛低但
        # pending 仍会搁浅到那时——同样要警示。
        if pending is not None and pi.is_elevated() and not done and not finished and not finalize_denied:
            footer = L("收尾未完成前请保持本窗口开启：关闭窗口将停止自动替换，且需以管理员身份重跑安装才能重建。",
                       "Keep this window open until finalization completes; closing it stops the automatic replacement, and re-running the install as administrator is the only way to rebuild it.")
        elif pending is not None and not done and not finished and not finalize_denied:
            footer = L("收尾未完成前请保持本窗口开启：关闭窗口将停止自动替换，重新运行安装即可重建监控。",
                       "Keep this window open until finalization completes; closing it stops the automatic replacement. Re-run the install to bring the monitor back.")
        else:
            footer = L("本窗口可随时关闭，不影响安装结果。", "You can close this window at any time; the installation result is unaffected.")
        lines += ["", "-" * 52,
                  L("已等待 %02d:%02d | 每 %d 秒检测一次 | 生效后自动退出" % (el // 60, el % 60, POLL),
                    "waited %02d:%02d | checking every %ds | exits automatically once confirmed" % (el // 60, el % 60, POLL)),
                  footer]
        draw(lines)
        if done:
            time.sleep(BYE)
            return
        if pending is not None and pids:
            wait_any_exit(pids, POLL)   # 有待替换且客户端在跑：任一进程退出立即醒来复查
        else:
            time.sleep(POLL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
