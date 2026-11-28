# -*- coding: utf-8 -*-
"""悬浮状态条的插件侧安装器（CLI + SessionStart hook 共用）。

CLI 用法（/install-overlay 与 /uninstall-overlay 背后就是它）：
  python3 overlay_install.py sync      # 仅同步运行时文件，stdout 输出 JSON（不读取 asar）
  python3 overlay_install.py install   # 同步运行时文件 + 写入 asar 注入行（幂等）
  python3 overlay_install.py remove    # 剥离注入行，并写豁免标记（hook 不再提示/自动安装）
  python3 overlay_install.py check     # 查看注入状态、运行时目录与开关
  python3 overlay_install.py doctor    # 只读体检：安装登记、注入、待替换、运行目录与更新，给出修法

hook 用法：hooks/session-start.py 调 run_hook()，stdout 只输出 hook 协议 JSON。

与仓库根 install.py 的关系：根目录文件是正本，本插件目录里的运行时文件是
sync_plugin.py 生成的副本；本脚本把副本同步进稳定运行时目录
~/.zcode/zcode-token-usage-statusbar/（mtime 保护较新手改，升级时以记录 hash 识别托管文件），
再对运行时目录执行 patch_install.set_runtime() + install()——注入行指向稳定目录而非
插件缓存目录，插件升级换缓存目录不会让浮层失联。

测试接缝（环境变量）：ZUSAGE_PLUGIN_RUNTIME / ZUSAGE_PLUGIN_ASAR 可把运行时目录和
目标 asar 指到别处（自测用临时副本，不碰真机）。

自动安装（始终开启，SessionStart hook 自动执行安装/修复）：未注入时 hook 直接
安装，不再有开关；安装失败才有故障提示。不想安装用 /uninstall-overlay
（remove 写 .plugin-overlay-optout 豁免标记，hook 永久静默，不重注入不提示）；
旧 .plugin-overlay-nudge 不再阻止提示，安装成功后清除。
"""
import contextlib
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).parent.resolve()
# 手动命令模板里的解释器：用当前真实解释器绝对路径，不猜 python/python3 别名
# （Windows 上 python3 可能是 Microsoft Store 存根会静默失败；用户反馈 2026-11-03）
PYEXE = sys.executable or "python"
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))
from runtime_lock import (
    bounded_mkstemp,
    bounded_tempdir,
    file_lock,
    fixed_drives,
    real_home as _rt_real_home,
    sudo_user as _rt_sudo_user,
    update_config,
)
# 会同步进运行时目录的插件副本（usage_mcp.py 与 overlay_install.py 自身等插件入口
# 不在其中：它们从插件目录跑；inject-main.cjs 的相对 require 依赖必须全数在列，
# test_plugin_package 按此不变量守护）
RUNTIME_FILES = [
    "inject-main.cjs",
    "mobile-relay.cjs",
    "overlay.js",
    "zusage.py",
    "patch_install.py",
    "install_monitor.py",
    "plugin-updater.cjs",
    "plugin-release.cjs",
    "plugin-storage.cjs",
    "quota-client.cjs",
    "model-puller.cjs",
    "engine-patch.cjs",
    "sysmon-client.cjs",
    "release_unpack.py",
    "runtime_lock.py", "usage_stats.py", "turn-stats.js",
    "token_rate.py", "renderer_bridge.py", "token_pricing.py",
    "pending_zip_patch.py",
]


def sudo_user():
    """sudo 运行时的真实用户名（POSIX；非 sudo / Windows 返回 None）。"""
    return _rt_sudo_user(sys.platform)


def real_home():
    """真实用户家目录：sudo 会重置 HOME，Path.home() 指向 /root，而运行时目录、config.json
    与 hook 都以普通用户身份读写，必须落在 SUDO_USER 的家里（与根目录 install.py 同源）。"""
    return _rt_real_home(sudo_user, Path.home)


def default_runtime():
    return real_home() / ".zcode" / "zcode-token-usage-statusbar"


# 独立安装器（仓库根 install.py）把 MCP 服务注册在宿主 CLI 配置的 mcp.servers 里；插件渠道
# 另由 .mcp.json 注册同一工具。两条渠道并存时宿主每个会话会各拉起一份 usage_mcp.py，
# 内存占用翻倍；运行目录里的副本还可能停在旧版本。
# 插件渠道已经提供 MCP，这里只清指向本插件脚本的遗留条目，绝不改用户其它 MCP 服务。
LEGACY_MCP_NAMES = ("zcode-token-usage-statusbar", "token-usage", "zusage")
LEGACY_MCP_ENTRY_KEYS = frozenset(("command", "args", "type", "enabled"))
# 宿主里的插件与市场身份（与 plugin-updater.cjs 的 PLUGIN_ID、根 marketplace.json 的 name 同值）
PLUGIN_ID = "zcode-token-usage-statusbar@zusage-marketplace"
MARKETPLACE_ID = "zusage-marketplace"


def host_cli_config():
    """宿主 CLI 的 MCP 配置文件（与 install.py 的 ZCODE_CONFIG 同源）。"""
    override = os.environ.get("ZUSAGE_PLUGIN_HOST_CONFIG")   # 测试/排障接缝
    if override:
        try:
            return Path(override).expanduser()
        except (OSError, RuntimeError):   # 坏形态（如 ~未知用户）按字面路径处理，is_file 自然为 False
            return Path(override)
    return real_home() / ".zcode" / "cli" / "config.json"


def _mcp_string_values(value):
    """注册项内全部字符串（command/args 以及历史版本可能嵌套的列表）。"""
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _mcp_string_values(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _mcp_string_values(item)


def _owned_usage_mcp(entry, roots):
    """注册项是否指向本插件的 usage_mcp.py。

    只认 command/args/type/enabled 这组形态（install.py 生成的正是它）；带 env 等自定义
    键的条目可能是用户手改过的，保留不猜。路径父目录必须正好是运行目录或插件目录——
    同名服务指向别处（其它工具/别的仓库）一律不动。"""
    if not isinstance(entry, dict) or set(entry) - LEGACY_MCP_ENTRY_KEYS:
        return False
    normal_roots = set()
    for root in roots:
        try:
            normal_roots.add(os.path.normcase(str(Path(root).expanduser().resolve(strict=False))))
        except (OSError, RuntimeError):
            continue
    for raw in _mcp_string_values(entry):
        candidate = Path(os.path.expandvars(raw)).expanduser()
        if candidate.name.lower() != "usage_mcp.py":
            continue
        try:
            parent = candidate.resolve(strict=False).parent
        except (OSError, RuntimeError):
            parent = candidate.parent
        if os.path.normcase(str(parent)) in normal_roots:
            return True
    return False


def _legacy_mcp_names(servers, roots):
    return [name for name in LEGACY_MCP_NAMES
            if name in servers and _owned_usage_mcp(servers[name], roots)]


def dedupe_legacy_mcp(runtime=None, plugin_root=None):
    """移除独立安装遗留的 MCP 注册，消除每会话双份 usage_mcp 进程。

    返回 removed / absent / skipped-invalid / skipped-locked / skipped-io / skipped-env。
    永不抛异常：SessionStart hook 的任何失败都不能影响会话。结构异常（顶层非对象、mcp 或
    mcp.servers 不是对象）一律原样保留；锁内重读再改，同目录备份 + 原子替换消除截断窗口。
    """
    if os.environ.get("ZUSAGE_KEEP_LEGACY_MCP"):
        return "skipped-env"
    config = host_cli_config()
    try:
        if not config.is_file():
            return "absent"
    except OSError:
        return "absent"
    runtime = Path(runtime or os.environ.get("ZUSAGE_PLUGIN_RUNTIME") or default_runtime())
    roots = [runtime, Path(plugin_root or PLUGIN_ROOT)]

    def load():
        try:
            data = json.loads(config.read_text(encoding="utf-8-sig"))
        except FileNotFoundError:
            return "absent", None, None
        except (OSError, ValueError):
            return "invalid", None, None
        if not isinstance(data, dict):
            return "invalid", None, None
        mcp = data.get("mcp")
        if mcp is None:
            return "absent", None, None
        if not isinstance(mcp, dict):
            return "invalid", None, None
        servers = mcp.get("servers")
        if servers is None:
            return "absent", None, None
        if not isinstance(servers, dict):
            return "invalid", None, None
        return "ok", data, _legacy_mcp_names(servers, roots)

    state, data, gone = load()
    if state != "ok":
        return "absent" if state == "absent" else "skipped-invalid"
    if not gone:
        return "absent"
    lock_path = runtime / "legacy-mcp.lock"   # 锁放运行目录，不往宿主 CLI 配置目录添文件
    try:
        with file_lock(lock_path, timeout=5.0):
            state, data, gone = load()   # 锁内重读：不覆盖并发会话刚写入的其它改动
            if state != "ok":
                return "absent" if state == "absent" else "skipped-invalid"
            if not gone:
                return "absent"
            servers = data["mcp"]["servers"]
            for name in gone:
                del servers[name]
            try:   # 备份失败不阻塞清理；config 本身损坏时另有 invalid 分支
                shutil.copy2(config, config.with_name(config.name + ".zusage-mcp.bak"))
            except OSError:
                pass
            _atomic_write(config, json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8"), src=config)
    except TimeoutError:
        return "skipped-locked"
    except OSError:
        return "skipped-io"
    print("[zusage-plugin] 已移除独立安装遗留的 MCP 注册 {}：插件 .mcp.json 已提供同一工具，"
          "避免每个会话双份 usage_mcp 进程。".format(", ".join(gone)), file=sys.stderr)
    return "removed"


SYSTEM_NODE_LOCATIONS = ("/usr/local/bin/node", "/usr/bin/node", "/usr/bin/nodejs")


def _nvm_node_versions(nvm):
    """nvm 的版本目录（v24.12.0）按 SemVer 降序；目录名带 v 前缀，_version_key 不认。"""
    versions = []
    for path in nvm.glob("v*"):
        try:
            versions.append((_version_key(path.name.lstrip("v")), path))
        except ValueError:
            continue
    return [path / "bin" / "node" for _, path in sorted(versions, reverse=True)]


def _node_candidates():
    """验收器可用的 Node 解释器（按优先级，去重保序）。

    sudo 的 secure_path 会重置 PATH，nvm 装的 node 不在 root 的 PATH 里，
    `shutil.which("node")` 返回 None（issue #15）；因此还要探测 SUDO_USER 的 nvm
    目录与常见系统位置。候选仍会在启动失败时逐个回退，不做身份保证。"""
    from_path = shutil.which("node")   # which 已验证存在且可执行，不必再 is_file()
    candidates = []
    user = sudo_user()
    if user:
        try:
            import pwd
            nvm = Path(pwd.getpwnam(user).pw_dir) / ".nvm" / "versions" / "node"
            candidates.extend(_nvm_node_versions(nvm))
        except (KeyError, OSError, ImportError, ValueError):
            pass
    candidates.extend(SYSTEM_NODE_LOCATIONS)
    exists = [Path(from_path)] if from_path else []
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if path.is_file() and path not in exists:
            exists.append(path)
    return exists


def load_patch_install():
    if str(PLUGIN_ROOT) not in sys.path:
        sys.path.insert(0, str(PLUGIN_ROOT))
    import patch_install
    return patch_install


def load_runtime_config(runtime):
    """缺失配置可创建；损坏或非对象配置不能当空配置覆盖。"""
    try:
        config = json.loads((runtime / "config.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        return None
    return config if isinstance(config, dict) else None


def asar_candidates():
    """仅枚举当前平台常见位置；候选仍须通过包身份校验。"""
    if sys.platform == "darwin":
        return [Path("/Applications/ZCode.app/Contents/Resources/app.asar"),
                Path.home() / "Applications/ZCode.app/Contents/Resources/app.asar"]
    if sys.platform.startswith("linux"):
        return [Path(root) / "resources/app.asar" for root in
                ("/opt/ZCode", "/opt/zcode", "/usr/lib/zcode", "/usr/local/ZCode")]
    candidates = [Path(r"D:\ZCode\resources\app.asar"),
                  Path(r"C:\ZCode\resources\app.asar")]
    for variable, suffix in (("LOCALAPPDATA", "Programs/ZCode"),
                             ("LOCALAPPDATA", "ZCode"), ("ProgramFiles", "ZCode")):
        if os.environ.get(variable):
            candidates.append(Path(os.environ[variable]) / suffix / "resources/app.asar")
    # 自定义盘符安装（如 D:\Program Files\ZCode）：逐个本地固定盘枚举三种常见布局
    # （%ProgramFiles% 只跟系统盘走；盘根 Programs/ZCode 是用户自装位置）。候选仍须通过
    # is_zcode_asar 包身份校验。
    candidates.extend(Path(f"{letter}:/{folder}/resources/app.asar")
                      for letter in fixed_drives("DEFGHIJKLMNOPQRSTUVWXYZ")
                      for folder in ("Program Files/ZCode", "Programs/ZCode", "ZCode"))
    if os.environ.get("LOCALAPPDATA"):
        programs = Path(os.environ["LOCALAPPDATA"]) / "Programs"
        candidates.extend(sorted(programs.glob("*/resources/app.asar")))
    return candidates


def is_zcode_asar(pi, asar):
    """生产目标必须由 asar 内 package.json 的 name 确认为 ZCode。"""
    pkg = load_patch_install().read_asar_package(asar, pi=pi)
    name = pkg.get("name") if pkg else None
    return isinstance(name, str) and "zcode" in name.lower()


def resolve_paths(runtime=None):
    """返回 (runtime_dir, patch_install 模块)；无有效目标时 ASAR 为 None。"""
    pi = load_patch_install()
    runtime = Path(runtime or os.environ.get("ZUSAGE_PLUGIN_RUNTIME") or default_runtime()).expanduser().resolve()
    pi.set_runtime(runtime)
    test_asar = os.environ.get("ZUSAGE_PLUGIN_ASAR")
    if test_asar:
        pi.set_target(Path(test_asar).expanduser().resolve())
        return runtime, pi
    config = load_runtime_config(runtime)
    candidates = [os.environ.get("ZCODE_ASAR"), (config or {}).get("asar_path")]
    candidates.extend(asar_candidates())
    for candidate in candidates:
        if not isinstance(candidate, (str, Path)) or not candidate:
            continue
        asar = Path(os.path.expandvars(str(candidate))).expanduser().resolve()
        if is_zcode_asar(pi, asar):
            pi.set_target(asar)
            return runtime, pi
    # patch_install 是缓存模块；上次会话的目标绝不能作为本次探测兜底。
    pi.ASAR = pi.BAK = pi.TMP = pi.ZCODE_EXE = None
    return runtime, pi


def optout_marker(runtime):
    return runtime / ".plugin-overlay-optout"


def nudge_marker(runtime):
    return runtime / ".plugin-overlay-nudge"


def clear_markers(runtime):
    for m in (optout_marker(runtime), nudge_marker(runtime)):
        try:
            m.unlink()
        except FileNotFoundError:
            pass


def plugin_version():
    """优先读 ZCode manifest，兼容只有 Claude manifest 的插件副本。"""
    for folder in (".zcode-plugin", ".claude-plugin"):
        manifest = PLUGIN_ROOT / folder / "plugin.json"
        if manifest.is_file():
            return json.loads(manifest.read_text(encoding="utf-8"))["version"]
    raise FileNotFoundError("插件 manifest 不存在")


def _version_key(version):
    """SemVer 排序；忽略 build metadata，预发布版本低于正式版。"""
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?"
                         r"(?:\+[0-9A-Za-z.-]+)?", version)
    if not match:
        raise ValueError("无效插件版本：{}".format(version))
    prerelease = match.group(4)
    parts = tuple((0, int(part)) if part.isdigit() else (1, part)
                  for part in prerelease.split(".")) if prerelease else ()
    return tuple(int(match.group(i)) for i in (1, 2, 3)), prerelease is None, parts


def _atomic_write(dst, data, src=None):
    """同目录原子替换；已有运行时内容改变必须产生不同 mtime 供 loader 检测。"""
    previous_stat = dst.stat() if src is not None and dst.exists() else None
    fd, temporary = bounded_mkstemp(prefix="." + dst.name + ".", dir=str(dst.parent))
    temporary = Path(temporary)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        if src is not None:
            if previous_stat is None:
                shutil.copystat(src, temporary)
            else:
                shutil.copymode(src, temporary)
                stamp = max(time.time_ns(), previous_stat.st_mtime_ns + 1000000)
                os.utime(temporary, ns=(temporary.stat().st_atime_ns, stamp))
        os.replace(temporary, dst)
    finally:
        try:
            temporary.unlink()
        except OSError:
            pass


VERIFY_TIMEOUT = 10   # 单次验收器运行上限（秒）


def _run_verifier(command, env):
    """运行一次验收器，输出按 UTF-8 解码（Node 恒写 UTF-8，系统区域编码会把中文路径解错）。
    超时先结束整棵进程树再上报 TimeoutExpired：subprocess.run 只杀直接子进程，且在
    Windows 上之后还会不限时地读完输出管道，子孙若继承了管道就永远等不到 EOF。
    收尾总耗时有界（taskkill 3 秒、回收 2 秒），叠加后仍在更新器 30 秒时限内。"""
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                               start_new_session=os.name != "nt",
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))   # issue #227：GUI 候选（ZCode.exe）不受影响，回退控制台子系统 node.exe 时不再弹终端窗；POSIX 取 0 等价
    try:
        stdout, stderr = process.communicate(timeout=VERIFY_TIMEOUT)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            try:
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))   # issue #227
            except (OSError, subprocess.SubprocessError):
                pass
            process.kill()
            try:
                process.communicate(timeout=2)   # 读线程收尾；整棵树没结束干净时放弃，不能无限等
            except subprocess.TimeoutExpired:
                pass
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)   # 新会话即新进程组：连同子孙一起结束
            except OSError:
                process.kill()
            process.stdout.close()   # POSIX 的 communicate 不起读线程，直接关管道即可
            process.stderr.close()
        process.wait()
        raise
    return subprocess.CompletedProcess(command, process.returncode, stdout.decode("utf-8", "replace"),
                                       stderr.decode("utf-8", "replace"))


def _identity_diff(before, after):
    """锚定身份与当前身份的字段级差异：路径精确到键，长值截断、条目封顶，
    让「运行时同步期间安装身份发生变化」的排查不用再猜是谁在同步窗口内改了什么。"""
    missing = object()
    changes = []

    def brief(value):
        if value is missing:
            return "(无)"
        try:
            text = json.dumps(value, ensure_ascii=False, sort_keys=True)
        except (TypeError, ValueError):
            text = repr(value)
        return text if len(text) <= 120 else text[:117] + "..."

    def walk(old, new, path):
        if isinstance(old, dict) and isinstance(new, dict):
            for key in sorted(set(old) | set(new)):
                walk(old.get(key, missing), new.get(key, missing),
                     f"{path}.{key}" if path else key)
        elif isinstance(old, list) and isinstance(new, list):
            if old != new:
                changes.append(f"{path}: {brief(old)} → {brief(new)}")
        elif old is not missing or new is not missing:
            if old != new:
                changes.append(f"{path}: {brief(old)} → {brief(new)}")

    if isinstance(before, dict) and isinstance(after, dict):
        walk(before, after, "")
    else:
        changes.append(f"identity: {brief(before)} → {brief(after)}")
    return "; ".join(changes[:8]) + (f"（共 {len(changes)} 处差异）" if len(changes) > 8 else "")


@contextlib.contextmanager
def _sync_verifier(runtime, target_asar=None):
    """target_asar 是本轮已解析的安装目标（resolve_paths 已做过包身份校验）。sudo 下
    ZCODE_ASAR 与 /root 的 config 都为空，只有它能让 asar 旁的 ZCode 可执行文件参与验收。"""
    pending_path = runtime / "plugin-update.json"
    try:
        pending = json.loads(pending_path.read_text(encoding="utf-8"))
        if not isinstance(pending, dict):
            raise ValueError("plugin-update.json 必须是对象")
    except FileNotFoundError:
        pending = {}
    active = (pending.get("pendingSync") is True or pending.get("pendingRelease") is not None
              or pending.get("pendingPid"))
    base = runtime if (runtime / "plugin-updater.cjs").is_file() else PLUGIN_ROOT
    if active and base != runtime:
        raise ValueError("待恢复安装缺少可信运行时验收器，停止同步")
    nodes = _node_candidates()
    executable = None
    config = load_runtime_config(runtime) or {}
    asar = target_asar or os.environ.get("ZCODE_ASAR") or config.get("asar_path")
    if asar:
        target = Path(asar)
        candidates = ([target.parent.parent / "MacOS" / "ZCode"] if sys.platform == "darwin"
                      else [target.parent.parent / ("ZCode.exe" if sys.platform == "win32" else "zcode")])
        executable = next((str(item) for item in candidates if item.is_file()), None)
        # darwin 换 LSUIElement Helper 验收，Dock 不闪主二进制图标（issue #238）；
        # patch_install 缺该函数时按原二进制，下面的启动失败回退链不变。
        swap = getattr(load_patch_install(), "ui_element_exe_for", None)
        if swap is not None:
            executable = swap(executable)
    # asar 旁的同名可执行文件可能是外部应用/损坏文件（文件名不是身份依据）：
    # 启动失败（OSError/WinError 216）或启动后挂起超时，都回退 Node 再试。
    launch_candidates = list(dict.fromkeys(str(item) for item in
                                           ([executable] if executable else []) + nodes))
    if not launch_candidates:
        raise ValueError(
            "未找到运行时验收所需的 Node 可执行文件。sudo 会重置 PATH：nvm 等用户级 node "
            "不在 root 的 PATH 里。请改用保留环境的方式重跑，例如："
            " sudo env \"HOME=$HOME\" \"PATH=$PATH\" python3 overlay_install.py install"
            "（或把 node 加入 root 的 PATH / 设 ZCODE_ASAR 指向 /opt/ZCode/resources/app.asar）")
    names = ("plugin-updater.cjs", "plugin-release.cjs", "plugin-storage.cjs")
    with bounded_tempdir(prefix="zusage-sync-verifier-") as directory:
        snapshot = Path(directory)
        original = {}
        for name in names:
            original[name] = (base / name).read_bytes()
            (snapshot / name).write_bytes(original[name])
        if any((base / name).read_bytes() != data for name, data in original.items()):
            raise ValueError("可信验收器在读取期间变化，停止同步")
        # The migration contract belongs to this installer, never to the new
        # cache helper. Require only the frozen runtime modules; newer runtimes
        # retain their own verifier, while HEAD runtimes use this fixed adapter.
        verifier_script = r'''
const fs = require("fs"), path = require("path"), os = require("os");
const { isDeepStrictEqual } = require("util");
const [snapshot, runtime, pluginRoot] = process.argv.slice(1);
const updater = require(path.join(snapshot, "plugin-updater.cjs"));
function migrate() {
  const release = require(path.join(snapshot, "plugin-release.cjs"));
  const { resolvePluginStorage } = require(path.join(snapshot, "plugin-storage.cjs"));
  const readObject = (file, missing) => {
    let value;
    try { value = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return missing; throw error; }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("同步验收记录不是 JSON 对象: " + file);
    return value;
  };
  const root = fs.realpathSync(pluginRoot), id = "zcode-token-usage-statusbar@zusage-marketplace";
  const manifest = readObject(path.join(root, ".zcode-plugin", "plugin.json"), null);
  if (!manifest || manifest.name !== id.split("@")[0]) throw Error("同步插件清单身份无效");
  updater.compareVersions(manifest.version, manifest.version);
  const pending = readObject(path.join(runtime, "plugin-update.json"), null);
  const hasPending = pending && (pending.pendingSync === true || pending.pendingRelease != null || pending.pendingPid);
  const live = pid => {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== "ESRCH"; }
  };
  const legacy = path.join(runtime, "plugin-update.lock");
  try {
    let owner;
    try { owner = JSON.parse(fs.readFileSync(legacy, "utf8")); } catch (error) { owner = {}; }
    if ((owner && Number.isSafeInteger(owner.pid) && owner.pid > 0)
        ? live(owner.pid) : Date.now() - fs.statSync(legacy).mtimeMs < 600000) throw Error("旧更新进程仍在运行，停止运行时同步");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (pending && pending.pendingPid) {
    if (!Number.isSafeInteger(pending.pendingPid) || pending.pendingPid <= 0) throw Error("安装进程记录无效");
    if (live(pending.pendingPid)) throw Error("插件安装进程仍在运行，停止运行时同步");
  }
  const storage = resolvePluginStorage(os.homedir(), process.env);
  if (fs.existsSync(path.join(storage, "marketplaces", ".zusage-marketplace.transaction.json"))) throw Error("官方市场事务尚未完成，停止运行时同步");
  const inventory = readObject(path.join(storage, "installed_plugins.json"), null);
  if (inventory && !Array.isArray(inventory.plugins)) throw Error("官方安装记录形状无效");
  const records = inventory ? inventory.plugins.filter(row => row && row.id === id && row.scope === "user") : [];
  if (!records.length) {
    if (hasPending || inventory) throw Error("同步所需用户插件安装记录不存在");
    return { ok: true, pluginRoot: root, identity: { record: null, channel: null, pending, manifest } };
  }
  if (records.length !== 1) throw Error("同步所需用户插件安装记录不唯一");
  const record = records[0];
  if (record.enabled === false) throw Error("同步插件已被禁用，停止运行时同步");
  if (typeof record.installPath !== "string" || fs.realpathSync(record.installPath) !== root) throw Error("同步插件与官方安装记录不一致：安装器须从官方安装记录指向的插件根目录（插件缓存目录）运行，而非运行时目录");
  if (record.version !== manifest.version) throw Error("同步插件与官方安装记录版本不一致，停止运行时同步");
  const selected = release.readChannel(os.homedir(), storage);
  const channel = { kind: selected.kind, repository: selected.repository || "", source: selected.marketplace ? selected.marketplace.source : null };
  if (hasPending) {
    if (pending.pendingSync !== true) throw Error("待同步意图不完整，停止运行时同步");
    if (pending.pendingVersion && updater.compareVersions(record.version, pending.pendingVersion) <= 0) throw Error("插件安装尚未提交新版，停止运行时同步");
    if (pending.pendingRelease != null) {
      const expected = pending.pendingRelease, r = expected.release, m = expected.manifest;
      if (!r || !m || !expected.channel || !isDeepStrictEqual(channel, expected.channel)) throw Error("Release 更新意图无效或市场来源已变化，停止运行时同步");
      /* 与 updater.verifyRuntimeSync 同构：清单兜底意图（catalogSha256 标记）走专用形状门；
         运行目录 release 模块过旧无该导出时按旧规则拒绝，保持 fail-closed。 */
      const validated = r.catalogSha256 !== undefined && typeof release.validateGithubCatalogRelease === "function"
        ? release.validateGithubCatalogRelease(r)
        : release.validateRelease({ tag_name: r.tag, draft: false, prerelease: false, assets: [r.archive, r.manifest] }, r.repository);
      if (!validated || validated.version !== r.version || channel.kind !== "release" || channel.repository !== r.repository) throw Error("Release 更新意图无效，停止运行时同步");
      release.validateManifest(m, validated);
      if (r.catalogSha256 !== undefined && m.asset.sha256 !== r.catalogSha256) throw Error("发布 manifest 与渠道清单的 SHA256 不一致，停止运行时同步");
      const source = record.source;
      if (record.version !== r.version || !source || source.url !== r.archive.browser_download_url || source.sha256 !== m.asset.sha256 || source.source !== "url" || source.type !== "zip" || source.path !== "plugins/zcode-token-usage-statusbar" || (source.stripRoot !== undefined && source.stripRoot !== false) || source.headers !== undefined) throw Error("官方安装结果与选定 Release 不一致，停止运行时同步");
    } else if (channel.kind === "release") throw Error("历史更新意图缺少 Release 校验信息，停止运行时同步");
  }
  return { ok: true, pluginRoot: root, identity: { record, channel, pending, manifest } };
}
try {
  const result = typeof updater.verifyRuntimeSync === "function"
    ? updater.verifyRuntimeSync({ runtime, pluginRoot }) : migrate();
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) { console.error("[zusage-plugin] 同步验收失败:", error.message); process.exitCode = 1; }
'''
        def verify():
            result = None
            for candidate in list(launch_candidates):
                try:
                    result = _run_verifier([candidate, "-e", verifier_script, str(snapshot),
                                            str(runtime), str(PLUGIN_ROOT)],
                                           env=dict(os.environ, ELECTRON_RUN_AS_NODE="1"))
                    break
                except (OSError, subprocess.TimeoutExpired):
                    # 无法启动（非 PE/格式错误）或挂起不退出：本次同步不再试它，
                    # 否则每次复核都要再等满一个超时，叠加起来超过调用方的时限。
                    launch_candidates.remove(candidate)
            if result is None:
                raise ValueError("运行时验收所需可执行文件均无法启动或超时")
            if result.returncode:
                raise ValueError("运行时同步验收失败: " + result.stderr.strip()[:1000])
            data = json.loads(result.stdout)
            if data.get("ok") is not True or data.get("pluginRoot") != str(PLUGIN_ROOT.resolve()):
                raise ValueError("运行时同步验收结果无效")
            return data["identity"]
        # 惰性校验：首次 verify() 才拉起 node 验收进程并锚定身份，其后每次调用复核比对。
        # 稳态同步（无任何写入计划）由调用方直接跳过 verify —— 每次会话启动省 1-3 次
        # node 子进程（实测 ~400ms），写入路径的安全语义不变。
        anchor = {}
        def recheck():
            current = verify()
            if "identity" not in anchor:
                anchor["identity"] = current
            elif current != anchor["identity"]:
                raise ValueError("运行时同步期间安装身份发生变化（"
                                 + _identity_diff(anchor["identity"], current) + "）")
        yield recheck


def sync_runtime(runtime, target_asar=None):
    """All entry points verify installed identity before the shared transaction.

    target_asar 是本轮已解析的安装目标（可为 None）：随 sync 一起进入验收器，
    让 sudo 下也能用 asar 旁的 ZCode 可执行文件验收。"""
    runtime = Path(runtime)
    runtime.mkdir(parents=True, exist_ok=True)
    with file_lock(runtime / "plugin-runtime.lock"):
        with _sync_verifier(runtime, target_asar) as verify:
            result = _sync_runtime_locked(runtime, verify)
        chown_runtime_to_user(runtime)   # root 写的运行时文件须归还给 sudo 的真实用户。
        return result


def _sync_runtime_locked(runtime, verify=lambda: None):
    """可信 hash 持续保护手改；无基线迁移用 mtime，旧插件不能回滚新版。"""
    version = plugin_version()
    current_version = _version_key(version)
    plugin_root = str(PLUGIN_ROOT.resolve())
    record_path = runtime / "plugin-runtime.json"
    try:
        previous = json.loads(record_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        previous = {}
    if not isinstance(previous, dict):
        raise ValueError("plugin-runtime.json 必须是对象")
    previous_version = _version_key(previous["version"]) if previous else None
    journal_path = runtime / "plugin-runtime-pending.json"
    try:
        journal = json.loads(journal_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        journal = None
    if journal is not None:
        if not isinstance(journal, dict) or not isinstance(journal.get("targets"), dict) or not isinstance(journal.get("base"), dict):
            raise ValueError("运行时待同步记录损坏")
        if previous == journal["base"]:
            recovered = dict(previous)
            recovered_hashes = dict(previous.get("hashes", {}))
            for name, digest in journal["targets"].items():
                if (name == "mobile_relay_patch.py" and isinstance(digest, str)
                        and re.fullmatch("[0-9a-f]{64}", digest)):
                    # Read-only recovery for journals written before the file was retired.
                    continue
                if name not in RUNTIME_FILES or not isinstance(digest, str) or not re.fullmatch("[0-9a-f]{64}", digest):
                    raise ValueError("运行时待同步 hash 无效")
                target = runtime / name
                if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == digest:
                    recovered_hashes[name] = digest
            recovered["hashes"] = recovered_hashes
            if not previous and recovered_hashes:
                recovered.update(version="0.0.0", plugin_root=str(PLUGIN_ROOT.resolve()))
            if recovered != previous:
                verify()
                _atomic_write(record_path, (json.dumps(recovered) + "\n").encode("utf-8"))
                previous = recovered
        journal_path.unlink()
    downgrade = previous_version is not None and current_version < previous_version
    recorded_hashes = previous.get("hashes", {})
    if not isinstance(recorded_hashes, dict):
        raise ValueError("plugin-runtime.json hashes 必须是对象")
    hashes = {}
    for name, digest in recorded_hashes.items():
        if name not in RUNTIME_FILES:
            continue
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-fA-F]{64}", digest):
            raise ValueError("plugin-runtime.json 的 {} hash 损坏".format(name))
        hashes[name] = digest.lower()
    changed, skipped, preserved = [], [], []
    writes = []
    planned_targets = {}
    for name in RUNTIME_FILES:
        src, dst = PLUGIN_ROOT / name, runtime / name
        if not src.is_file() or downgrade:
            skipped.append(name)
            continue
        data = src.read_bytes()
        src_hash = hashlib.sha256(data).hexdigest()
        planned_targets[name] = hashlib.sha256(dst.read_bytes()).hexdigest() if dst.is_file() else None
        if dst.is_file():
            dst_hash = hashlib.sha256(dst.read_bytes()).hexdigest()
            if dst_hash == src_hash:
                hashes[name] = src_hash
                skipped.append(name)
                continue
            if name in hashes:
                protect = dst_hash != hashes[name]
                reason = "运行时 hash 与记录不同（可能含手改热修）"
            else:
                protect = src.stat().st_mtime_ns <= dst.stat().st_mtime_ns
                reason = "运行时副本更新（可能含手改热修）"
            if protect:
                print(f"[zusage-plugin] 跳过 {name}：{reason}，"
                      f"如需覆盖请手动替换 {dst}", file=sys.stderr)
                skipped.append(name)
                preserved.append(name)
                continue
        hashes[name] = src_hash
        changed.append(name)
        writes.append((dst, data, src))
    result = {"changed": changed, "skipped": skipped, "preserved": preserved,
              "version": version, "plugin_root": plugin_root, "hashes": hashes,
              "restartRecorded": True}
    cold_files = {"inject-main.cjs", "plugin-updater.cjs", "plugin-release.cjs", "plugin-storage.cjs", "quota-client.cjs", "model-puller.cjs", "engine-patch.cjs", "sysmon-client.cjs"}
    if (load_runtime_config(runtime) or {}).get("hot_reload") is False:
        cold_files.update(("overlay.js", "zusage.py", "mobile-relay.cjs"))
    restart_hashes = {name: hashes[name] for name in changed if name in cold_files}
    record = dict(result)
    if downgrade:
        record["version"] = previous["version"]
        record["plugin_root"] = previous["plugin_root"]
    # 稳态（无写入计划、无待恢复 journal、记录内容不变）：跳过 node 验收与重复落盘。
    # 无写入即无"覆盖手改"风险，身份校验保护的恰是写入路径；此路径是每次会话启动的
    # 常态，省 1-3 次 node 子进程（实测 ~400ms）。record != previous 的字段差异
    # （旧版本写入的历史记录缺 restartRecorded 等）仍走完整校验后落盘。
    steady = not writes and not restart_hashes and journal is None and record == previous
    if not steady:
        verify()
    if writes:
        journal_out = {"base": previous, "targets": {dst.name: hashes[dst.name] for dst, _, _ in writes}}
        _atomic_write(journal_path, (json.dumps(journal_out) + "\n").encode("utf-8"))
    if restart_hashes:
        from restart_notice import record_restart
        record_restart(runtime, {"hashes": restart_hashes, "changed": changed,
                                 "version": version, "state": "pending-sync"})
    for dst, data, src in writes:
        verify()
        current_hash = hashlib.sha256(dst.read_bytes()).hexdigest() if dst.is_file() else None
        if current_hash != planned_targets[dst.name]:
            raise ValueError("运行时文件在同步规划后发生变化，保留手改并停止同步: " + dst.name)
        _atomic_write(dst, data, src)
    if not steady:
        verify()
        _atomic_write(record_path, (json.dumps(record, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    if journal_path.exists():
        journal_path.unlink()
    return result


def injected_status(pi, *, entry=None):
    """True=当前运行时的唯一注入行 False=需修复 None=asar 不可读。"""
    try:
        if entry is None:
            entry = pi.entry_bytes_of(pi.ASAR)
        line = pi.INJECT_LINE
        if isinstance(line, str):
            line = line.encode("utf-8")
        return bool(line and entry.count(line) == 1 and
                    all(match.group() == line for match in pi.ZUSAGE_LINE_RE.finditer(entry)))
    except Exception:
        return None


def save_runtime_config(runtime, pi):
    """调用方已确认目标有效/安装成功；仅补 Python 路径与实际 asar 位置。"""
    if pi.ASAR is None:
        return False
    try:
        update_config(runtime, {"asar_path": str(pi.ASAR)}, {"python_path": sys.executable})
    except (OSError, ValueError, TimeoutError):
        print("[zusage-plugin] config.json 损坏、不可读或锁忙，保留原文件。", file=sys.stderr)
        return False
    return True


def write_marker(marker):
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("1", encoding="utf-8")
        return True
    except OSError:
        return False


def chown_runtime_to_user(runtime):
    """sudo 安装后把运行时目录归还给 SUDO_USER：root 写的文件属主是 root，之后普通用户
    身份运行的 hook / 自动更新无法再写（升级、豁免标记都会失败）。非 sudo 是 no-op。"""
    user = sudo_user()
    if not user:
        return
    try:
        import pwd
        record = pwd.getpwnam(user)
    except (KeyError, OSError, ImportError):
        return
    targets = [runtime]
    try:
        targets.extend(path for path in runtime.iterdir() if not path.is_dir())
    except OSError:
        pass
    for path in targets:
        try:
            os.chown(path, record.pw_uid, record.pw_gid)
        except OSError:
            pass


def _nudge(output, message, label="安装提醒", detail="状态条安装尚未完成。"):
    from restart_notice import visible_context
    output["systemMessage"] = message
    output["hookSpecificOutput"] = {
        "hookEventName": "SessionStart",
        "additionalContext": visible_context(label, detail, message)}
    return output


def _plan_bridge(pi):
    """并入 loader 安装事务的桥改写（renderer_bridge.plan_deploy）；任何失败都返回 None。"""
    try:
        from renderer_bridge import plan_deploy
        return plan_deploy(pi.ASAR)
    except Exception as e:  # noqa: BLE001 — 桥只是增强
        print(f"[zusage-plugin] renderer bridge plan failed（已忽略）：{e}", file=sys.stderr)
        return None


def _install_overlay(runtime, pi):
    from restart_notice import record_restart
    kwargs = {}
    if getattr(pi, "EXTRA_MODIFY", False) is True:
        # 已加载的 patch_install 支持把桥改写并入同一次重打包（specs/asar-single-transaction.md）；
        # 旧运行目录模块或替身没有该能力时不传钩子，install() 的调用形状不变。
        kwargs["extra_modify"] = lambda: _plan_bridge(pi)
    return pi.install(before_publish=lambda installation: record_restart(
        runtime, {"state": "pending-install", "installation": installation}), **kwargs)


_PATCH_LOCK_RETRY_BUDGET_S = 15.0
_PATCH_LOCK_RETRY_DELAY_S = 1.5
_PATCH_RETRYABLE_LOCKS = {"target lock busy", "patch build lock busy", "restart marker lock busy"}


@contextlib.contextmanager
def _quiet_hook_install():
    names = ("ZUSAGE_NO_MONITOR", "ZUSAGE_MONITOR_QUIET")
    monitor_env = {name: os.environ.get(name) for name in names}
    try:
        os.environ.update(dict.fromkeys(names, "1"))
        with contextlib.redirect_stdout(sys.stderr):
            yield
    finally:
        for name, value in monitor_env.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def ensure_archive_patches(pi, *, snapshot=None):
    """Repair missing archive patches together and report their distinct diagnostics."""
    can_supplement = getattr(pi, "PATCH_SUPPLEMENT", False) is True
    plan_bridge = None
    if can_supplement:
        try:
            from renderer_bridge import plan_supplement as plan_bridge
        except ImportError:
            pass  # Older copies of renderer_bridge still use their own repair entry point.
    bridge = None
    if plan_bridge is None:
        bridge = ensure_renderer_bridge(pi, quiet_monitor=True)
        if bridge.get("status") in ("pending", "deferred"):
            return bridge, {"status": "deferred", "detail": "existing pending operation"}
        if not can_supplement:
            return bridge, {"status": "skipped-error", "detail": "patch publication unavailable"}
        snapshot = None  # The legacy bridge path may have replaced the archive.

    kwargs = {"snapshot": snapshot} if snapshot is not None else {}
    with _quiet_hook_install():
        started = time.monotonic()
        report = pi.supplement_patches(plan_bridge, **kwargs)
        status = report["archive"]
        if (status.get("status") == "deferred" and status.get("detail") in _PATCH_RETRYABLE_LOCKS
                and time.monotonic() - started < _PATCH_LOCK_RETRY_BUDGET_S):
            time.sleep(_PATCH_LOCK_RETRY_DELAY_S)
            report = pi.supplement_patches(plan_bridge)
    for key in ("bridge", "relay"):
        if key == "bridge" and bridge is not None:
            continue
        result = report[key]
        if result.get("status") == "skipped-error" or (key == "bridge" and result.get("status") == "skipped-unknown"):
            print(f"[zusage-plugin] archive patch {key}: {result.get('status')} "
                  f"(v{result.get('version')}) {result.get('detail', '')}", file=sys.stderr)
    return report["bridge"] if bridge is None else bridge, report["relay"]


def _mobile_relay_enabled(runtime):
    def reject(value):
        raise ValueError(f"non-finite JSON constant: {value}")
    try:
        raw = (Path(runtime) / "config.json").read_bytes().decode("utf-8", "replace")
        cfg = json.loads(raw, parse_constant=reject)
    except Exception:
        return False
    relay = cfg.get("mobile_relay") if isinstance(cfg, dict) else None
    return isinstance(relay, dict) and relay.get("enabled") is True


_MOBILE_DEFERRED_NOTICE_FILE = ".mobile-deferred-notice.json"
_MOBILE_DEFERRED_NOTICE_INTERVAL_S = 24 * 3600.0


def _deferred_notice_allowed(runtime):
    try:
        data = json.loads((Path(runtime) / _MOBILE_DEFERRED_NOTICE_FILE).read_text(encoding="utf-8"))
        last = data.get("lastShownAt") if isinstance(data, dict) else None
        return not isinstance(last, (int, float)) or (time.time() - last) >= _MOBILE_DEFERRED_NOTICE_INTERVAL_S
    except Exception:
        return True


def _mark_deferred_notice_shown(runtime):
    try:
        _atomic_write(Path(runtime) / _MOBILE_DEFERRED_NOTICE_FILE,
                      json.dumps({"lastShownAt": time.time()}, ensure_ascii=False).encode("utf-8"))
    except Exception:
        pass


def _mobile_pending_notice(out, pi, mobile):
    if "systemMessage" in out or "hookSpecificOutput" in out or not _mobile_relay_enabled(pi.RUNTIME):
        return out
    status = (mobile or {}).get("status")
    if status not in ("pending", "deferred"):
        return out
    from restart_notice import PREFIX
    if status == "pending":
        return _nudge(out, PREFIX + "远控中继补丁已排定：完全退出 ZCode 后会自动完成替换，之后重新打开即可生效，"
                      "无需重试安装。注意关闭窗口不等于退出：若关窗后仍未生效，说明 ZCode 仍驻留"
                      "托盘/后台，请从托盘图标退出，或在任务管理器中确认没有 ZCode 进程残留。")
    if (mobile or {}).get("detail") == "existing pending operation":
        return _nudge(out, PREFIX + "远控中继补装暂缓：检测到已有待替换操作。请先按现有安装提示处理，"
                      "或运行 /zusage-doctor 检查待替换状态。之后的会话会再次检查是否需要补装。")
    if not _deferred_notice_allowed(pi.RUNTIME):
        return out
    result = _nudge(out, PREFIX + "远控页面的用量推送尚未就绪：在输入框输入 /install-overlay "
                    "回车重试，并按安装输出完成收尾。若提示需要重启，可点状态条 ⚙ 齿轮的「重启 ZCode」按钮。"
                    "若多次未成功，请从托盘完全退出 ZCode（关闭窗口不等于退出）后重新打开再试。")
    _mark_deferred_notice_shown(pi.RUNTIME)
    return result


def ensure_renderer_bridge(pi, quiet_monitor=False):
    """安装/更新后补桥：客户端官方升级会整体重写 asar，把只读桥抹掉。这里按
    renderer_bridge 的版本+哈希指纹表门控就地重打；未知版本 fail-closed 跳过，
    任何失败都不影响安装主流程。就地替换被系统拒绝（Windows 客户端运行中持有
    asar、或目标目录只读）时不再静默：把已构建的完整包转存为待替换文件
    （patch_install 的 TMP+monitor 链，客户端退出后自动收尾），状态交给
    run_hook/_bridge_notice 给用户可见提示。用户 remove 待收尾时让位——自动补桥
    绝不覆盖显式卸载意图。"""
    try:
        from renderer_bridge import ensure_deployed
        result = ensure_deployed(pi.ASAR)
    except Exception as e:
        print(f"[zusage-plugin] renderer bridge ensure failed（已忽略）：{e}", file=sys.stderr)
        return {"status": "skipped-error", "detail": str(e)}
    if result.get("status") == "replace-failed":
        stage = Path(result["stage"])

        def discard_stage():
            try:
                stage.unlink(missing_ok=True)
            except OSError:
                pass

        try:
            existing = pi.pending_operation()
        except Exception:
            existing = None
        if existing == "remove":
            discard_stage()
            result = {"status": "skipped-error", "version": result.get("version"),
                      "detail": "已有待收尾的卸载操作，桥补装让位"}
        else:
            redirect = contextlib.redirect_stdout(sys.stderr) if quiet_monitor else contextlib.nullcontext()
            # v359（issue #321）：待收尾包的入口指纹先于 publish 取（publish 接管并删除
            # stage）；落定成功后按主安装同语义（_install_overlay 的 before_publish）补记录
            # 重启意图——v172 取消会话文字提醒后，⚙ 红点标记（.plugin-restart-required）
            # 是 pending 唯一用户可见信号，缺它则「桥 pending→scope 属性缺席→富文本回推
            # fail-closed」整条链零可诊断。swap 时 patch_install._replace_pending 按该标记
            # 经 publish_install 记 publishedAt，下次启动 loader ack 销账，生命周期与主安装一致。
            installation = None
            try:
                installation = {"asar": str(pi.ASAR.resolve()),
                                "entryHash": hashlib.sha256(pi.entry_bytes_of(stage)).hexdigest()}
            except Exception as e:
                # 指纹取不到（异常包/杀毒锁）就不写标记：宁缺勿假——没有 installation 的
                # pending-install 标记 swap 后无法销账，红点会永远亮着
                print(f"[zusage-plugin] renderer bridge pending fingerprint failed（已忽略）：{e}", file=sys.stderr)
            try:
                with redirect:
                    pi.publish_external_pending(stage, source=result.get("source"), operation="install")
            except PermissionError as e:
                discard_stage()
                print(f"[zusage-plugin] renderer bridge pending publish failed（已忽略）：{e}", file=sys.stderr)
                result = {"status": "skipped-error", "version": result.get("version"),
                          "detail": f"pending publish failed: {e}", "permission": True}
            except Exception as e:
                discard_stage()
                print(f"[zusage-plugin] renderer bridge pending publish failed（已忽略）：{e}", file=sys.stderr)
                result = {"status": "skipped-error", "version": result.get("version"),
                          "detail": f"pending publish failed: {e}"}
            else:
                if installation is not None:
                    try:
                        from restart_notice import record_restart
                        record_restart(str(pi.RUNTIME), {"state": "pending-install", "installation": installation})
                    except Exception as e:
                        print(f"[zusage-plugin] renderer bridge restart marker failed（已忽略）：{e}", file=sys.stderr)
                monitor_env = {name: os.environ.get(name) for name in
                               ("ZUSAGE_NO_MONITOR", "ZUSAGE_MONITOR_QUIET")}
                try:
                    if quiet_monitor:
                        os.environ["ZUSAGE_NO_MONITOR"] = "1"
                        os.environ["ZUSAGE_MONITOR_QUIET"] = "1"
                    with redirect:
                        pi.launch_monitor(time.time())
                except Exception as e:
                    print(f"[zusage-plugin] renderer bridge monitor 启动失败（已忽略）：{e}", file=sys.stderr)
                finally:
                    for name, value in monitor_env.items():
                        if value is None:
                            os.environ.pop(name, None)
                        else:
                            os.environ[name] = value
                result = {"status": "pending", "version": result.get("version"),
                          "detail": result.get("detail")}
    if result.get("status") not in ("present",):
        print(f"[zusage-plugin] renderer bridge: {result.get('status')} "
              f"(v{result.get('version')}) {result.get('detail')}", file=sys.stderr)
    return result


def _bridge_notice(out, result, pi, quiet_hook=False):
    """桥补装的用户可见提示（issue #67：受保护目录不再静默失效）。pending 收敛
    由监控在客户端退出后自动完成，不再发文字提醒；权限不足在目标持续不可写期间
    每次会话提示（故障提示保留）。已有提示时不覆盖——桥只是增强，优先级低于主链。
    v258 quiet_hook（SessionStart 自动链，注入行在位）：静态桥缺席/打不上不影响
    统计主链——readFiberPaneScope fiber 兜底 + 渲染端运行时合成桥接手，DB 轮询
    保底，skipped-unknown/skipped-error（含受保护目录权限）一律静默放行，只在
    stderr 留既有诊断行；显式 /install-overlay CLI（quiet_hook=False）保留原提示。"""
    if "systemMessage" in out:
        return out
    status = (result or {}).get("status")
    if quiet_hook and status in ("skipped-unknown", "skipped-error"):
        return out
    if status == "skipped-error" and result.get("permission"):
        from restart_notice import PREFIX
        # PermissionError 在 Windows 上不只来自 ACL：客户端占用 asar、杀毒扫描新写入的
        # 大文件同样抛它。target_writable() 含真实写入探针（不止 os.access），探针能在
        # 同目录建文件说明不是受保护目录（如 %LOCALAPPDATA%\Programs\ZCode），此时让用户
        # 提权既无必要也不对症——只提示占用/拦截并给重试方式。
        try:
            protected = not pi.target_writable()
        except Exception:
            protected = True
        if not protected:
            return _nudge(out, PREFIX + f"状态条已安装，但逐问速率行所需的客户端补丁暂时无法写入 {pi.ASAR}"
                          f"（文件被 ZCode 占用或被安全软件拦截，并非权限不足）。"
                          f"完全退出 ZCode 后运行 /install-overlay 重试；不需要该功能可忽略本提示。")
        script = PLUGIN_ROOT / "overlay_install.py"
        if os.name == "nt":
            action = (f'以管理员身份打开终端，执行 "{PYEXE}" "{script}" install')
        else:
            action = (f'执行 sudo env HOME="$HOME" PATH="$PATH" python3 "{script}" install')
        return _nudge(out, PREFIX + f"状态条已安装，但逐问速率行所需的客户端补丁"
                      f"无法写入受保护目录：{pi.ASAR}。如需该功能请{action}，"
                      f"完成后完全退出并重开 ZCode；不需要该功能可忽略本提示。")
    return out


def remove_renderer_bridge(pi):
    """卸载对称清理：只剥本项目的桥（指纹表逐版本识别），失败不影响卸载结果。"""
    try:
        from renderer_bridge import remove_deployed
        result = remove_deployed(pi.ASAR)
        if result.get("status") not in ("absent",):
            print(f"[zusage-plugin] renderer bridge remove: {result.get('status')} "
                  f"(v{result.get('version')}) {result.get('detail')}", file=sys.stderr)
        return result
    except Exception as e:
        print(f"[zusage-plugin] renderer bridge remove failed（已忽略）：{e}", file=sys.stderr)
        return {"status": "skipped-error", "detail": str(e)}

def _pending_install_waiting(pi):
    """安装失败但「待收尾包已排定 + 客户端在跑」：重试 /install-overlay 无法前进
    （Windows 客户端持续运行期间只会再 repack 一次再失败），用户需要的动作是完全
    退出客户端让监控自动收尾（issue #120）。返回 None=判据不成立（回落到重试提示）；
    True=目标可写，hook 每次 SessionStart 都能重建收尾监控，「无需重试」承诺成立；
    False=受保护目录（issue #130）：hook 无提权收不了尾，提权 monitor 若已退出则
    无人收尾——必须引导以管理员身份重跑安装重建收尾者，不能再给「无需重试」。
    任何异常都按不成立处理。"""
    try:
        pi.pending_tmp("install")
        if not pi.client_running():
            return None
        return pi.target_writable()
    except Exception:
        return None


def _revive_orphan_pending(pi):
    """孤儿待收尾包自愈（issue #228，与 patch_install.revive_orphan_pending 同源）：
    合法 pending + 实例锁空闲 + 目标可写时补拉静默监控接管收尾。"""
    try:
        load_patch_install().revive_orphan_pending(pi, require_writable=True)
    except Exception as e:  # noqa: BLE001
        print(f"[zusage-plugin] 孤儿待收尾包监控复活失败（已忽略）：{e}", file=sys.stderr)


def _plugin_version():
    """本插件副本的版本号（hook 从宿主管理的插件缓存目录运行，即「已装版本」）。"""
    try:
        manifest = json.loads((PLUGIN_ROOT / ".zcode-plugin" / "plugin.json").read_text(encoding="utf-8"))
        version = manifest.get("version") if isinstance(manifest, dict) else None
        return version if isinstance(version, str) and version else ""
    except Exception:
        return ""


def _host_build(pi, *, package=None):
    """宿主客户端版本（asar 内 package.json）。读取失败返回 None：探测失败不改变
    既有行为，兼容性提示与强制更新都只建立在确凿读取之上。"""
    if pi.ASAR is None:
        return None
    if not isinstance(package, dict):
        package = load_patch_install().read_asar_package(pi.ASAR, pi=pi)
    version = package.get("version") if package else None
    return version if isinstance(version, str) and version else None


def _host_registered(version):
    """宿主版本是否登记在本插件渲染桥适配表（HOST_TARGETS）。表读取失败按已登记
    处理：提示与强制更新都建立在「确凿未登记」之上，不做悲观误报。"""
    try:
        from renderer_bridge import HOST_TARGETS
        return any(item.get("version") == version for item in HOST_TARGETS)
    except Exception:
        return True


def _auto_update_disabled(runtime):
    """插件自动更新是否不会拉起——口径与拉起层逐值一致（plugin_auto_update.py）：
    非 True 值（0/"false"/null 等）与损坏 config 都不拉起，提示不得谎称「已触发」；
    仅缺文件视为缺省开启。"""
    try:
        cfg = json.loads((runtime / "config.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return False   # 缺省开启（与 start_auto_update 的 cfg={} 同款）
    except Exception:
        return True    # 损坏 config 主链不拉起（plugin_auto_update.py except → return False）
    return not (isinstance(cfg, dict) and cfg.get("plugin_auto_update", True) is True)


def _compat_notice_line(runtime, host_version):
    """未登记宿主版本的用户可见说明（拼进既有故障提示之后，或单独成条）。带上
    最近一次自动更新失败原因，让「检查过了、什么都没发生」变成可行动的信息
    （issue #247：市场清单被宿主 CLI 静默刷新失败卡住四天无人知晓）。显式关闭
    自动更新时如实说明，不谎称「已触发」。"""
    version = _plugin_version() or "?"
    if _auto_update_disabled(runtime):
        line = (f"当前插件 v{version} 未登记适配 ZCode {host_version}："
                "请升级插件（⚙ → 插件更新手动检查，自动更新已被显式关闭），"
                "升级并重启 ZCode 后状态条才会恢复。")
    else:
        line = (f"当前插件 v{version} 未登记适配 ZCode {host_version}："
                "已触发插件自动更新，升级到新版并重启 ZCode 后状态条才会恢复。")
    try:
        state = json.loads((runtime / "plugin-update.json").read_text(encoding="utf-8"))
        error = state.get("lastError") if isinstance(state, dict) else None
        if isinstance(error, dict) and isinstance(error.get("message"), str) and error["message"]:
            line += f"最近一次自动更新失败：{error['message'][:200]}"
    except Exception:
        pass
    return line


def _notify_compat_once(runtime, pi, out, host_version):
    """已注入（或刚装好）但渲染桥按未知版本跳过（skipped-unknown）时的去重提示：
    同一宿主版本 × 已装版本只提示一次——状态条仍有运行时动态桥 + DB 轮询兜底，
    反复提示是打扰；宿主升级或插件换版后重新提示。同时再拉一次强制更新（run_hook
    开头那次不带桥结果；双拉由更新锁串行化，代价是一次检查）。任何失败只进 stderr，
    绝不影响 hook 主流程。"""
    try:
        from plugin_auto_update import start_auto_update
        from restart_notice import PREFIX
        marker = {"hostBuild": host_version, "pluginVersion": _plugin_version()}
        marker_file = runtime / ".plugin-compat-notice.json"
        try:
            previous = json.loads(marker_file.read_text(encoding="utf-8"))
        except Exception:
            previous = None
        start_auto_update(runtime, pi, force=True)
        if previous == marker:
            return
        try:
            marker_file.write_text(json.dumps(marker, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
        _nudge(out, PREFIX + _compat_notice_line(runtime, host_version),
               label="兼容性提醒", detail="当前插件版本未登记适配此 ZCode 版本。")
    except Exception as e:  # noqa: BLE001
        print(f"[zusage-plugin] 兼容性提示失败（已忽略）：{e}", file=sys.stderr)


LAST_DIAG = None   # 最近一次 run_hook 的兼容性诊断；session-start.py 读走记入 plugin-session-start.json


def run_hook():
    """SessionStart hook 主体：返回 hook 协议 JSON dict。任何异常都转成合法输出，
    绝不影响会话；patch_install 的人类可读输出重定向到 stderr，保证 stdout 纯 JSON。"""
    global LAST_DIAG
    LAST_DIAG = None
    out = {"suppressOutput": True}
    runtime = Path(os.environ.get("ZUSAGE_PLUGIN_RUNTIME") or default_runtime())
    try:
        runtime, pi = resolve_paths()
        sync_runtime(runtime, pi.ASAR)
        # 独立安装遗留的 MCP 注册与插件 .mcp.json 并存会让宿主每会话拉起双份 usage_mcp；
        # 清理是尽力而为的附加步骤，任何失败只进诊断，绝不挡会话（optout 也照常清理）。
        try:
            legacy_mcp = dedupe_legacy_mcp(runtime)
        except Exception as e:  # noqa: BLE001 — hook 契约：任何异常都不得上抛
            legacy_mcp = "skipped-error"
            print(f"[zusage-plugin] 遗留 MCP 清理失败（已忽略）：{e}", file=sys.stderr)
        snapshot = None
        if pi.ASAR is not None and getattr(pi, "REUSE_ARCHIVE_SNAPSHOT", False) is True:
            try:
                snapshot = pi._archive_snapshot(pi.ASAR)
            except Exception:
                pass  # The legacy loader and version probes can still report what is readable.
        entry, package = snapshot[1:] if snapshot is not None else (None, None)
        st = injected_status(pi, entry=entry)
        # 兼容性预判（issue #247）：已装版本未登记适配当前宿主 build 时，未注入分支的
        # 自动更新绕过 1h 限频立即升级——只重装旧版永远修不好状态条。optout 不豁免
        # 更新（既有契约），故预判在 optout 检查之前。
        host_version = _host_build(pi, package=package)
        unregistered = host_version is not None and not _host_registered(host_version)
        LAST_DIAG = {"hostBuild": host_version, "pluginVersion": _plugin_version(), "injected": st}
        if legacy_mcp != "absent":   # 只在真有遗留注册或清理失败时留档，别给常态诊断加噪声
            LAST_DIAG["legacyMcp"] = legacy_mcp
        try:
            from plugin_auto_update import start_auto_update
            start_auto_update(runtime, pi, force=unregistered and st is False)
        except Exception as e:
            print(f"[zusage-plugin] 后台更新启动失败（已忽略）：{e}", file=sys.stderr)
        if optout_marker(runtime).exists():
            return out
        if st is None:
            return out  # 本机没有可定位的桌面客户端（远程会话等），静默
        save_runtime_config(runtime, pi)
        if st:
            bridge, mobile = ensure_archive_patches(pi, snapshot=snapshot)
            if bridge.get("status") != "pending" and mobile.get("status") != "pending":
                _revive_orphan_pending(pi)
            LAST_DIAG["bridge"] = bridge.get("status")
            LAST_DIAG["mobileRelay"] = mobile.get("status")
            if unregistered and bridge.get("status") == "skipped-unknown":
                _notify_compat_once(runtime, pi, out, host_version)
            _mobile_pending_notice(out, pi, mobile)
            return _bridge_notice(out, bridge, pi, quiet_hook=True)   # 桥缺席由运行时动态桥兜底
        # 仅移除中继钩子也可能在无 loader 的归档上留下待收尾包；后续 SessionStart
        # 必须让位于显式卸载，否则自动安装会把 remove pending 反向覆盖成 install。
        try:
            pending = pi.pending_operation()
        except Exception:
            pending = None
        if pending == "remove":
            _revive_orphan_pending(pi)
            LAST_DIAG["pendingOperation"] = "remove"
            return out
        # 未注入：自动安装始终开启，失败只保留故障提示（补丁排定/受保护目录/请重试）
        with _quiet_hook_install():
            ok = _install_overlay(runtime, pi)
        if ok:
            bridge = ensure_renderer_bridge(pi, quiet_monitor=True)
            clear_markers(runtime)
            LAST_DIAG["bridge"] = bridge.get("status")
            LAST_DIAG["injected"] = True   # 自动安装刚成功：诊断按安装后的真实状态记录
            if unregistered and bridge.get("status") == "skipped-unknown":
                _notify_compat_once(runtime, pi, out, host_version)   # 装上了也带不动此宿主：明确说明，不静默（issue #247）
            return _bridge_notice(out, bridge, pi, quiet_hook=True)   # 自动安装刚成功（注入行在位）：同上，桥缺席静默交给运行时兜底
        from restart_notice import PREFIX
        # 未登记适配当前宿主时，三条故障提示都补上兼容性说明与最近失败原因：
        # 反复「已排定」至少要讲清为什么排定也修不好（issue #247）。
        compat_tail = ("\n" + _compat_notice_line(runtime, host_version)) if unregistered else ""
        waiting = _pending_install_waiting(pi)
        if waiting:
            # issue #185：「所有窗口」常被理解成「关掉窗口即退出」，Windows 客户端
            # 驻留托盘/后台时收尾永远等不到空档——点名关窗不等于退出与核对办法。
            _nudge(out, PREFIX + "状态条补丁已排定：完全退出 ZCode 后"
                     "会自动完成替换，之后重新打开即可生效，无需重试安装。"
                     "注意关闭窗口不等于退出：若关窗后仍未替换，说明 ZCode 仍驻留托盘/后台，"
                     "请从托盘图标退出，或在任务管理器中确认没有 ZCode 进程残留。"
                     "客户端增强补丁尚未就绪，后续 SessionStart 将继续补装，可能需要再次完全退出。"
                     "不需要请运行 /uninstall-overlay，之后不再提示。" + compat_tail)
        elif waiting is False:
            # 受保护目录（issue #130）：「无需重试」是假承诺，提权重跑才是
            # 唯一解——它复用已排定的待收尾包并重建提权收尾监控，秒级完成。
            script = PLUGIN_ROOT / "overlay_install.py"
            if os.name == "nt":
                action = f'以管理员身份打开终端，执行 "{PYEXE}" "{script}" install'
            else:
                action = f'执行 sudo env HOME="$HOME" PATH="$PATH" python3 "{script}" install'
            _nudge(out, (PREFIX + "状态条补丁已排定，但 ZCode 安装在受保护目录，"
                         "当前身份无法完成替换，也不会自动重建收尾进程。"
                         f"请{action}（会复用已排定的补丁，很快），"
                         "然后完全退出 ZCode（所有窗口）并重新打开。"
                         "不需要请运行 /uninstall-overlay，之后不再提示。" + compat_tail))
        else:
            _nudge(out, (PREFIX + "用量状态条自动安装未完成。"
                         "请运行 /install-overlay 重试；"
                         "不需要请运行 /uninstall-overlay，之后不再提示。"
                         "如果仍然失败，请查看客户端插件日志。" + compat_tail))
        return out
    except Exception as e:  # noqa: BLE001 — hook 绝不能抛
        message = f"zusage 插件自检失败（已忽略）：{e}"
        if optout_marker(runtime).exists():
            print("[zusage-plugin] " + message, file=sys.stderr)
            return {"suppressOutput": True}
        out["systemMessage"] = message
        out["hookSpecificOutput"] = {"hookEventName": "SessionStart", "additionalContext": message}
        return out


def _doctor_json(path):
    """读一个 JSON 文件：返回 (对象, 错误文案)。文件不存在时两者都是 None。"""
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, None
    except (OSError, ValueError) as e:
        return None, f"无法解析（{e.__class__.__name__}）"
    return (value, None) if isinstance(value, dict) else (None, "不是 JSON 对象")


def _doctor_storage():
    """宿主插件存储根（…/cli/plugins），取值顺序同宿主：ZCODE_STORAGE_DIR、宿主 CLI 配置的
    storage.dir、默认 ~/.zcode。项目级配置不参与，体检在任何工作目录下结果一致。"""
    home = real_home()
    directory = os.environ.get("ZCODE_STORAGE_DIR", "").strip()
    if not directory:
        config, _ = _doctor_json(host_cli_config())
        storage = config.get("storage") if config else None
        if isinstance(storage, dict) and isinstance(storage.get("dir"), str):
            directory = storage["dir"].strip()
    root = home / ".zcode"
    if directory:
        root = home / directory[2:] if directory.startswith("~/") else Path(directory).expanduser()
        root = root if root.is_absolute() else home / root
    return (root if root.name == "cli" else root / "cli") / "plugins"


def _doctor_channel(source):
    """市场登记的来源形态换算成更新渠道说明。"""
    if not isinstance(source, dict):
        return "无法识别"
    kind, url = source.get("source"), str(source.get("url") or "")
    if kind == "directory":
        return "本地目录市场（宿主按目录内容直接更新）"
    if kind == "url":
        return "清单直链"
    if kind in ("github", "git"):
        ref = source.get("ref")
        if ref == "plugin-releases":
            return "正式 Release 渠道（GitHub）"
        if ref == "plugin-releases-gitcode":
            return "正式 Release 渠道（GitCode）"
        where = "GitCode" if url.startswith("https://gitcode.com/") else "GitHub"
        return f"仓库源码（跟随 {ref or '默认分支'}，{where}，不经发布包校验）"
    return "无法识别"


def doctor(runtime, pi):
    """只读体检（/zusage-doctor 背后就是它，specs/zusage-doctor.md）：逐项给出
    [OK]/[WARN]/[FAIL] 与建议动作。返回 (文本, 统计)；任何一项出错都只记成该组的 FAIL。"""
    lines, counts, ranked = [], {"OK": 0, "WARN": 0, "FAIL": 0}, []
    facts = {}

    def add(level, item, detail, action=None, rank=4):
        counts[level] += 1
        lines.append(f"  [{level}] {item}: {detail}")
        if action is not None and all(action != text for _, text in ranked):
            ranked.append((rank, action))

    def section(title, body):
        lines.extend(("", title))
        try:
            body()
        except Exception as e:  # noqa: BLE001 — 一组检查出错不挡其余各组
            add("FAIL", title, f"这一组检查没能完成（{e.__class__.__name__}: {e}）")

    restart = "完全退出 ZCode（从托盘退出，只关窗口不算）再重新打开"
    reinstall = ("插件没有装上：按 README「安装方法」重新安装；GitHub 连不上时改用 "
                 "https://gitcode.com/tanranran/zcode-token-usage-statusbar.git#plugin-releases-gitcode")

    def environment():
        add("OK", "Python", f"{sys.version_info[0]}.{sys.version_info[1]}（{PYEXE}）")
        add("OK", "平台与运行目录", f"{sys.platform}；{runtime}"
            + ("（已存在）" if runtime.is_dir() else "（尚未创建，首次安装时生成）"))

    def registration():
        version = _plugin_version()
        add("OK", "当前插件版本", version or "读不到 manifest")
        storage = _doctor_storage()
        inventory, error = _doctor_json(storage / "installed_plugins.json")
        record = next((item for item in (inventory or {}).get("plugins", [])
                       if isinstance(item, dict) and item.get("id") == PLUGIN_ID), None)
        if error or record is None:
            add("FAIL", "插件安装登记", f"{storage} 里没有本插件的安装记录" if not error
                else f"installed_plugins.json {error}", reinstall, rank=1)
        else:
            installed = Path(str(record.get("installPath") or ""))
            present = installed.is_dir()
            add("OK" if present else "FAIL", "插件安装登记",
                f"v{record.get('version')}（{record.get('scope')}）{installed}" if present
                else f"登记的安装目录不存在：{installed}", None if present else reinstall, rank=1)
            if record.get("version") != version:
                add("WARN", "插件版本", f"宿主登记 v{record.get('version')}，正在运行的副本 v{version}",
                    restart + "，让宿主加载新版本")
        config, error = _doctor_json(host_cli_config())
        if error:
            add("FAIL", "插件启用状态", f"宿主 CLI 配置 {error}，判断不了是否启用",
                f"修复或移走 {host_cli_config()} 后重跑本命令", rank=1)
            return
        plugins = config.get("plugins") if config else None
        plugins = plugins if isinstance(plugins, dict) else {}
        enabled = plugins.get("enabledPlugins")
        enabled = enabled.get(PLUGIN_ID) if isinstance(enabled, dict) else None
        if plugins.get("enabled") is False:
            add("FAIL", "插件启用状态", "宿主的插件总开关已关闭",
                "在 ZCode 设置的插件管理里打开插件总开关，然后新建会话", rank=1)
        elif enabled is False:
            add("FAIL", "插件启用状态", "本插件已被禁用",
                "在 ZCode 设置的插件管理里启用 ZCode Token Usage Statusbar，然后新建会话", rank=1)
        else:
            add("OK", "插件启用状态", "已启用" if enabled is True else "未显式设置，按默认启用")
        known, error = _doctor_json(storage / "known_marketplaces.json")
        market = next((item for item in (known or {}).get("marketplaces", [])
                       if isinstance(item, dict) and item.get("id") == MARKETPLACE_ID), None)
        if error or market is None:
            add("WARN", "市场登记", "没有 zusage-marketplace 的登记，更新时找不到来源", reinstall)
            return
        channel = _doctor_channel(market.get("source"))
        add("WARN" if channel.startswith("仓库源码") else "OK", "市场登记", channel,
            "想跟随正式版时，在 ZCode 设置的插件管理里把市场来源换成 "
            "https://github.com/ByteRax/zcode-token-usage-statusbar#plugin-releases"
            "（国内 https://gitcode.com/tanranran/zcode-token-usage-statusbar.git#plugin-releases-gitcode）"
            if channel.startswith("仓库源码") else None)
        failure = market.get("lastRefreshFailure")
        if isinstance(failure, dict) and failure.get("message"):
            add("WARN", "市场刷新", f"最近一次刷新失败：{str(failure['message'])[:200]}",
                "检查网络后重新打开 ZCode 再试")

    def client_and_injection():
        if pi.ASAR is None:
            facts["missing"] = True
            add("FAIL", "客户端归档", "没有找到 ZCode 的 app.asar",
                "确认 ZCode 桌面客户端的安装位置；装在非常见位置时，用环境变量 ZCODE_ASAR 指定 "
                "app.asar 的完整路径后重跑本命令", rank=1)
            return
        add("OK", "客户端归档", str(pi.ASAR))
        read_error = None
        try:
            if getattr(pi, "REUSE_ARCHIVE_SNAPSHOT", False) is True:
                _, entry, package = pi._archive_snapshot(pi.ASAR)
            else:
                entry, package = pi.entry_bytes_of(pi.ASAR), None
        except Exception as error:
            read_error, package = error, None
        facts["version"] = _host_build(pi, package=package)
        add("OK" if facts["version"] else "WARN", "客户端版本",
            facts["version"] or "读不到归档内的 package.json")
        if read_error is not None:
            raise read_error
        loader_lines = [match.group() for match in pi.ZUSAGE_LINE_RE.finditer(entry)]
        if loader_lines == [pi.INJECT_LINE.encode()]:
            add("OK", "状态条注入", "已注入，指向当前运行目录")
        elif loader_lines:
            add("WARN", "状态条注入", "已注入，但指向另一个目录（下次安装会替换到当前运行目录）",
                "运行 /install-overlay")
        else:
            # 安装已排定时重跑 /install-overlay 只会复用同一个待替换包（issue #120）：注入行只报
            # 事实，该做的事由「待替换包」那一行给出
            staged = pi.pending_operation() == "install"
            add("FAIL", "状态条注入", "未注入（安装已排定，在等客户端退出，见下方待替换包）" if staged
                else "未注入", None if staged else "运行 /install-overlay；新建或恢复会话也会自动安装", rank=2)
        if pi.target_writable():
            add("OK", "安装目录可写", "可写")
        else:
            add("FAIL" if not loader_lines else "WARN", "安装目录可写",
                "当前身份写不了客户端安装目录（受保护目录）",
                "运行 /install-overlay，权限不足时按它的提示以管理员身份或 sudo 重跑同一条命令", rank=2)
        if package is not None:
            relay_ready, relay_detail = pi._relay_check_status(entry, package)
        else:
            legacy_check = getattr(pi, "_mobile_check_status", None)
            relay_detail = (legacy_check(pi.ASAR, entry) if callable(legacy_check)
                            else "无法检查（安装模块不支持中继诊断）")
            relay_ready = relay_detail in ("已注入", "patched")
        add("OK" if relay_ready else "WARN", "远控中继补丁", relay_detail)
        from renderer_bridge import _inspect_deploy
        kind, payload = _inspect_deploy(pi.ASAR)
        if kind == "patch":
            add("WARN", "逐问速率行补丁", f"未打上（客户端 {payload[4]}）",
                "运行 /install-overlay；状态条已注入时，新建或恢复会话也会自动补装")
        elif payload.get("status") == "present":
            add("OK", "逐问速率行补丁", "已部署")
        else:
            add("WARN", "逐问速率行补丁", f"{payload.get('status')}：{payload.get('detail')}")
        # 宿主版本没进指纹表、但桥已按结构推导打上时不算是问题（与 hook 的兼容性提示同口径：
        # 只在桥也打不上时才提醒）
        registered = _host_registered(facts["version"])
        adapted = registered or (kind != "patch" and payload.get("status") == "present")
        add("OK" if adapted else "WARN", "客户端版本适配",
            "当前插件已登记这个客户端版本" if registered else
            "当前插件按结构推导适配这个客户端版本（未登记指纹表）" if adapted else
            f"当前插件 v{_plugin_version() or '?'} 还没有登记 ZCode {facts['version']}",
            None if adapted else "检查插件更新（状态条设置面板的「插件更新」）；宿主刚升级时等插件发适配版")

    def pending_work():
        running = pi.client_running()
        add("OK", "客户端进程", "在运行" if running else "没检测到（按进程名探测，可能漏检）")
        operation = pi.pending_operation()
        if operation not in ("install", "remove"):
            add("OK", "待替换包", "无")
        else:
            try:
                pi.pending_tmp(operation)
                validity = "待替换包有效"
            except Exception:  # noqa: BLE001 — 校验没过的原因交给重跑安装解决
                validity = "待替换包校验没通过，重跑安装会重建"
            with pi.monitor_instance_lock() as free:
                monitored = not free
            if operation == "install":
                add("FAIL", "待替换包", f"{validity}，安装在等客户端退出（收尾监控"
                    f"{'在运行' if monitored else '没在运行'}）",
                    "安装已排定：完全退出 ZCode（从托盘退出，只关窗口不算）让收尾监控完成替换，"
                    "再重新打开；不需要重跑安装" if monitored else
                    "安装已排定，但现在没有收尾监控：重新打开 ZCode 并新建会话会自动补拉；"
                    "仍不生效时完全退出 ZCode 后，按 /install-overlay 输出里的命令手动收尾", rank=3)
            else:
                add("WARN", "待替换包", f"{validity}，卸载在等客户端退出",
                    "完全退出 ZCode（从托盘退出，只关窗口不算）让收尾监控完成卸载", rank=3)
        marker, error = _doctor_json(runtime / ".plugin-restart-required")
        if error:
            add("WARN", "待重启改动", f"标记读不出（{error}）", restart, rank=3)
        elif marker:
            version = f" v{marker['version']}" if isinstance(marker.get("version"), str) else ""
            add("WARN", "待重启改动", f"有（{marker.get('state')}{version}）", restart, rank=3)
        else:
            add("OK", "待重启改动", "无")

    def runtime_state():
        record, error = _doctor_json(runtime / "plugin-runtime.json")
        if error:
            add("WARN", "同步记录", f"plugin-runtime.json {error}")
        elif record:
            add("OK", "同步记录", f"版本 {record.get('version')}，来源 {record.get('plugin_root')}")
        else:
            add("WARN", "同步记录", "还没有（运行目录尚未同步过）", "运行 /install-overlay")
        missing, differ = [], []
        for name in RUNTIME_FILES:
            target, source = runtime / name, PLUGIN_ROOT / name
            if not target.is_file():
                missing.append(name)
            elif not source.is_file() or target.read_bytes() != source.read_bytes():
                differ.append(name)
        if missing or differ:
            detail = "；".join(part for part in (
                f"缺失 {', '.join(missing)}" if missing else "",
                f"与插件来源不同 {', '.join(differ)}" if differ else "") if part)
            add("WARN", "运行文件", detail, "运行 /install-overlay 重新同步运行目录")
        else:
            add("OK", "运行文件", f"{len(RUNTIME_FILES)} 个文件与插件来源一致")
        if (runtime / "config.json").exists() and load_runtime_config(runtime) is None:
            add("FAIL", "配置文件", "config.json 损坏或不是 JSON 对象",
                f"修复或移走 {runtime / 'config.json'} 后重跑本命令", rank=2)
        else:
            add("OK", "配置文件", "可解析" if (runtime / "config.json").exists()
                else "使用默认值（还没有 config.json）")
        if optout_marker(runtime).exists():
            add("WARN", "自动安装豁免", "存在 .plugin-overlay-optout：不会再自动安装状态条",
                "需要状态条时运行 /install-overlay")
        else:
            add("OK", "自动安装豁免", "无")
        record, error = _doctor_json(runtime / "plugin-session-start.json")
        if error:
            add("WARN", "会话启动记录", f"plugin-session-start.json {error}")
        elif record:
            result = record.get("result") if isinstance(record.get("result"), dict) else {}
            context = result.get("hookSpecificOutput") if isinstance(result.get("hookSpecificOutput"), dict) else {}
            message = context.get("additionalContext") or result.get("systemMessage")
            when = (time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(record["time"]))
                    if type(record.get("time")) in (int, float) else "时间未知")
            if isinstance(message, str) and message:
                add("WARN", "会话启动记录", f"{when}（{record.get('source') or '?'}）带着故障提示：{message}")
            else:
                host = record.get("host") if isinstance(record.get("host"), dict) else {}
                add("OK", "会话启动记录",
                    f"{when}（{record.get('source') or '?'}）宿主 {host.get('hostBuild')}，"
                    f"插件 v{host.get('pluginVersion')}，注入 {host.get('injected')}，桥 {host.get('bridge')}")
        else:
            add("OK", "会话启动记录", "还没有（插件装好后第一次会话启动才写）")

    def updates():
        config = load_runtime_config(runtime)
        automatic = isinstance(config, dict) and config.get("plugin_auto_update", True) is True
        add("OK" if automatic else "WARN", "自动更新", "开启" if automatic else "已显式关闭",
            None if automatic else "需要自动更新时在状态条设置面板里打开")
        state, error = _doctor_json(runtime / "plugin-update.json")
        if error:
            add("WARN", "更新记录", f"plugin-update.json {error}")
        elif not state:
            add("OK", "更新记录", "还没有（第一次检查更新后才有）")
        else:
            failure = state.get("lastError")
            if isinstance(failure, dict) and failure.get("message"):
                add("WARN", "更新记录", f"最近一次检查或安装失败：{str(failure['message'])[:200]}",
                    "检查网络（GitHub 连不上时可改用 GitCode 渠道地址）后，在状态条设置面板手动检查更新")
            else:
                add("OK", "更新记录", f"当前 v{state.get('currentVersion')}，最新 v{state.get('latestVersion')}"
                    if state.get("currentVersion") else "尚无版本记录")

    lines.append(f"zcode-token-usage-statusbar 体检（只读）  {time.strftime('%Y-%m-%d %H:%M:%S')}")
    section("运行环境", environment)
    section("插件登记", registration)
    section("客户端与注入", client_and_injection)
    section("待替换与重启", pending_work)
    section("运行目录", runtime_state)
    section("更新", updates)
    lines.extend(("", f"体检结果: OK {counts['OK']} / WARN {counts['WARN']} / FAIL {counts['FAIL']}"))
    if ranked:
        ranked.sort(key=lambda pair: pair[0])
        lines.append("建议动作:")
        lines.extend(f"  {number}. {text}" for number, (_, text) in enumerate(ranked, 1))
    else:
        lines.append("未发现需要处理的问题。")
    return "\n".join(lines), counts


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "sync":
        runtime = Path(os.environ.get("ZUSAGE_PLUGIN_RUNTIME") or default_runtime())
        try:
            result = sync_runtime(runtime)
        except Exception as e:
            print(f"[zusage-plugin] 同步失败：{e}", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(result, ensure_ascii=False))
        return
    runtime, pi = resolve_paths()
    if cmd == "doctor":
        try:
            report, _ = doctor(runtime, pi)
        except Exception as e:  # noqa: BLE001 — 体检自身出错必须可辨，不能带着半份报告正常退出
            print(f"[zusage-plugin] 体检未能完成：{e.__class__.__name__}: {e}", file=sys.stderr)
            sys.exit(1)
        print(report)
        return
    if cmd == "install":
        sync_runtime(runtime, pi.ASAR)
    if pi.ASAR is None:
        print("[zusage-plugin] 未找到有效 ZCode app.asar；请设置 ZCODE_ASAR。", file=sys.stderr)
        if cmd in ("install", "remove"):
            sys.exit(1)
        return
    if cmd == "install":
        clear_markers(runtime)  # 主动安装 = 重新参与提示逻辑
        ok = _install_overlay(runtime, pi)
        if ok:
            bridge = ensure_renderer_bridge(pi)
            if bridge.get("status") == "pending":
                print("客户端运行中，逐问速率行补丁已排定：完全退出 ZCode 后自动完成替换。")
            from restart_notice import reminder
            notice = reminder(runtime, injected=injected_status(pi))
            if notice:
                print(notice["message"])
        if ok or injected_status(pi) is not None:
            save_runtime_config(runtime, pi)
        chown_runtime_to_user(runtime)
    elif cmd == "remove":
        ok = pi.remove()
        if ok:
            remove_renderer_bridge(pi)
        if ok and not write_marker(optout_marker(runtime)):
            print("（豁免标记写入失败，hook 可能继续提示）")
        chown_runtime_to_user(runtime)
    else:
        st = injected_status(pi)
        print(f"runtime: {runtime}")
        print(f"asar:    {pi.ASAR}")
        print("injected:", {True: "是", False: "否", None: "asar 不可读"}[st])
        print("auto install: 始终开启（未注入时 hook 自动安装；/uninstall-overlay 可豁免）")
        print(f"optout: {optout_marker(runtime).exists()}  nudge: {nudge_marker(runtime).exists()}")
        with contextlib.redirect_stdout(sys.stdout):
            pi.check()
        return
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    # Windows 默认（无全局 PYTHONUTF8）下 stdout / stderr 接管道时按区域代码页（cp936 / cp1252）
    # 编码：非 CJK 代码页的机器上一句中文 print 就 UnicodeEncodeError 中断（check / doctor /
    # /install-overlay 全断），中文代码页下家目录含 GBK 外字符（emoji 等）时路径回显同样崩；
    # 宿主与 plugin-updater 的 sync 按 UTF-8 读这些输出——与 usage_mcp.py、hooks 同款防护。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    main()
