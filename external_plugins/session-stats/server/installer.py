"""session-stats 首启自装——把输入框统计条（CDP 注入）随插件装进本机。

市场安装只装插件本体（/stats、侧栏面板）；统计条依赖三件套：
  ① ZCode 快捷方式带 --remote-debugging-port（用户目录可写，不需要管理员）
  ② 每分钟计划任务（注入兜底；电池/唤醒/登录均生效）
  ③ 常驻注入器（窗口出现 ~2 秒注入）
本模块由 MCP 服务启动时在后台调用，幂等：装过即跳过，被删/被更新器覆盖则补回。
全程不退出 ZCode、不需要 Node——对方体验 = 装插件 → 重启 → 再从快捷方式启动一次。
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SVC_DIR = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")) / "session-stats"
CDP_PORT = 9223
TASK_NAME = "session-stats-watch"
# 部署到服务目录的文件：常驻服务/计划任务从这里起（插件缓存目录会随插件更新被清）
DEPLOY_FILES = [
    "stats_server.py", "pills.js", "pills-loader.js", "service_standalone.py",
    "watch_update.py", "watch_once.py", "injector.py",
]
SHORTCUT_CHECK_INTERVAL = 3600  # 秒：快捷方式检查节流（ZCode 更新可能重建无参数的快捷方式）

_LOG = SVC_DIR / "installer.log"


def _log(msg: str) -> None:
    try:
        SVC_DIR.mkdir(parents=True, exist_ok=True)
        with _LOG.open("a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except Exception:  # noqa: BLE001
        pass


def _pythonw() -> str:
    """计划任务/常驻服务用 pythonw（无窗口）：先取当前解释器同目录，再查 PATH。"""
    import shutil
    cand = Path(sys.executable).with_name("pythonw.exe")
    if cand.exists():
        return str(cand)
    which = shutil.which("pythonw")
    return which or sys.executable


def _startup_dir() -> Path:
    appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(appdata) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"


def _shortcut_dirs() -> list[str]:
    """ZCode 快捷方式可能所在目录（系统特殊文件夹，兼容桌面重定向到 OneDrive）。"""
    ps = (
        "[Environment]::GetFolderPath('Desktop');"
        "[Environment]::GetFolderPath('Programs');"
        "[Environment]::GetFolderPath('CommonPrograms');"
        "Join-Path $env:APPDATA 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'"
    )
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=15, creationflags=0x08000000,
        ).stdout
        return [ln.strip() for ln in out.splitlines() if ln.strip()]
    except Exception:  # noqa: BLE001
        return []


def deploy_files(svc_dir: Path = None) -> int:
    """把服务文件刷到服务目录（内容有变即覆盖），返回复制数量。"""
    svc_dir = svc_dir or SVC_DIR
    svc_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for name in DEPLOY_FILES:
        src = HERE / name
        if not src.exists():
            continue
        dst = svc_dir / name
        if not dst.exists() or dst.read_bytes() != src.read_bytes():
            dst.write_bytes(src.read_bytes())
            n += 1
    return n


def patch_shortcuts(dirs: list[str] = None, port: int = CDP_PORT) -> int:
    """给指向 ZCode.exe 的快捷方式加调试端口参数（幂等）；返回本次修改数。"""
    dirs = _shortcut_dirs() if dirs is None else dirs
    if not dirs:
        return 0
    lit = lambda p: "'" + str(p).replace("'", "''") + "'"  # noqa: E731
    script = (
        "$flag = '--remote-debugging-port=%d'\n"
        "$dirs = @(%s)\n"
        "$sh = New-Object -ComObject WScript.Shell\n"
        "$n = 0\n"
        "foreach ($dir in $dirs) {\n"
        "  if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }\n"
        "  Get-ChildItem -LiteralPath $dir -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {\n"
        "    try {\n"
        "      $lnk = $sh.CreateShortcut($_.FullName)\n"
        "      if ($lnk.TargetPath -like '*ZCode.exe' -and $lnk.Arguments -notlike '*remote-debugging-port*') {\n"
        "        $lnk.Arguments = ($lnk.Arguments + ' ' + $flag).Trim()\n"
        "        $lnk.Save()\n"
        "        $n++\n"
        "      }\n"
        "    } catch {}\n"
        "  }\n"
        "}\n"
        "Write-Output ('PATCHED=' + $n)\n"
    ) % (port, ", ".join(lit(d) for d in dirs))
    # PowerShell 5.1 读无 BOM 的 UTF-8 脚本会按 GBK 解析中文路径 → 必须带 BOM
    import tempfile
    fd, path = tempfile.mkstemp(suffix=".ps1")
    try:
        with os.fdopen(fd, "w", encoding="utf-8-sig") as f:
            f.write(script)
        out = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=30, creationflags=0x08000000,
        ).stdout
        for ln in out.splitlines():
            if ln.startswith("PATCHED="):
                return int(ln.split("=", 1)[1] or 0)
    except Exception as e:  # noqa: BLE001
        _log(f"快捷方式检查失败: {e!r}")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    return 0


def register_task(task_name: str = TASK_NAME, svc_dir: Path = None) -> bool:
    """注册每分钟计划任务（XML：去电池限制 + 唤醒补跑 + 登录触发）。"""
    svc_dir = svc_dir or SVC_DIR
    exe, script = _pythonw(), svc_dir / "watch_once.py"
    if not script.exists():
        return False
    bs = "\\"
    user = (os.environ.get("USERDOMAIN") or "") + bs + (os.environ.get("USERNAME") or "")
    xml = f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <TimeTrigger><Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>2026-01-01T00:00:00</StartBoundary><Enabled>true</Enabled></TimeTrigger>
    <LogonTrigger><Enabled>true</Enabled><UserId>{user}</UserId></LogonTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>{user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowHardTerminate>true</AllowHardTerminate>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions><Exec><Command>"{exe}"</Command><Arguments>"{script}"</Arguments></Exec></Actions>
</Task>
"""
    xml_path = svc_dir / "watch-task.xml"
    try:
        xml_path.write_text(xml, encoding="utf-16")  # 含 BOM，schtasks 要求 UTF-16
        r = subprocess.run(
            ["schtasks", "/Create", "/F", "/TN", task_name, "/XML", str(xml_path)],
            capture_output=True, timeout=20, creationflags=0x08000000,
        )
        return r.returncode == 0
    except Exception as e:  # noqa: BLE001
        _log(f"计划任务注册失败: {e!r}")
        return False


def task_exists(task_name: str = TASK_NAME) -> bool:
    try:
        r = subprocess.run(
            ["schtasks", "/Query", "/TN", task_name],
            capture_output=True, timeout=15, creationflags=0x08000000,
        )
        return r.returncode == 0
    except Exception:  # noqa: BLE001
        return True  # 查不到状态时按“存在”处理，避免反复注册


def write_startup_entry(svc_dir: Path = None, startup_dir: Path = None) -> bool:
    """登录自启常驻数据服务（Startup .cmd，必须 CRLF）。"""
    svc_dir = svc_dir or SVC_DIR
    startup_dir = startup_dir or _startup_dir()
    try:
        startup_dir.mkdir(parents=True, exist_ok=True)
        entry = startup_dir / "session-stats-service.cmd"
        content = '@echo off\r\nstart "" "%s" "%s"\r\n' % (_pythonw(), svc_dir / "service_standalone.py")
        entry.write_bytes(content.encode("utf-8"))
        return True
    except Exception as e:  # noqa: BLE001
        _log(f"登录自启项写入失败: {e!r}")
        return False


def service_healthy() -> bool:
    try:
        with urllib.request.urlopen("http://127.0.0.1:31710/health", timeout=1.5) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def ensure_standalone(svc_dir: Path = None) -> bool:
    """数据服务不在（无常驻实例）→ 拉起常驻服务（自带注入器+守望线程）。"""
    if service_healthy():
        return False
    svc_dir = svc_dir or SVC_DIR
    script = svc_dir / "service_standalone.py"
    if not script.exists():
        return False
    try:
        subprocess.Popen(  # noqa: S603
            [_pythonw(), str(script)],
            creationflags=0x00000008 | 0x00000200,  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True,
            cwd=str(svc_dir),
        )
        return True
    except Exception as e:  # noqa: BLE001
        _log(f"常驻服务拉起失败: {e!r}")
        return False


def ensure_installed() -> dict:
    """首启自装主流程：每一步独立兜底，任何失败都不影响插件本体。"""
    result = {"deployed": 0, "shortcuts": 0, "task": False, "startup": False, "spawned": False}
    try:
        SVC_DIR.mkdir(parents=True, exist_ok=True)
        result["deployed"] = deploy_files()
    except Exception as e:  # noqa: BLE001
        _log(f"部署失败: {e!r}")
        return result

    # 快捷方式：节流检查（ZCode 更新可能重建不带参数的快捷方式）
    try:
        stamp = SVC_DIR / "shortcut-check.stamp"
        fresh = stamp.exists() and (time.time() - stamp.stat().st_mtime) < SHORTCUT_CHECK_INTERVAL
        if not fresh:
            result["shortcuts"] = patch_shortcuts()
            stamp.write_text(str(int(time.time())), encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        _log(f"快捷方式处理异常: {e!r}")

    try:
        if not task_exists():
            result["task"] = register_task()
        else:
            result["task"] = True
    except Exception as e:  # noqa: BLE001
        _log(f"计划任务处理异常: {e!r}")

    try:
        result["startup"] = write_startup_entry()
    except Exception as e:  # noqa: BLE001
        _log(f"自启项处理异常: {e!r}")

    try:
        result["spawned"] = ensure_standalone()
    except Exception as e:  # noqa: BLE001
        _log(f"常驻服务处理异常: {e!r}")

    try:
        (SVC_DIR / "install.json").write_text(
            json.dumps({"mode": "cdp", "installedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                        "cdpPort": CDP_PORT}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:  # noqa: BLE001
        pass
    _log(f"自装检查完成: {json.dumps(result, ensure_ascii=False)}")
    return result


if __name__ == "__main__":
    print(json.dumps(ensure_installed(), ensure_ascii=False))
