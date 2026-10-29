# -*- coding: utf-8 -*-
"""悬浮状态条的插件侧安装器（CLI + SessionStart hook 共用）。

CLI 用法（/install-overlay 与 /uninstall-overlay 背后就是它）：
  python3 overlay_install.py sync      # 仅同步运行时文件，stdout 输出 JSON（不读取 asar）
  python3 overlay_install.py install   # 同步运行时文件 + 写入 asar 注入行（幂等）
  python3 overlay_install.py remove    # 剥离注入行，并写豁免标记（hook 不再提示/自动安装）
  python3 overlay_install.py check     # 查看注入状态、运行时目录与开关

hook 用法：hooks/session-start.py 调 run_hook()，stdout 只输出 hook 协议 JSON。

与仓库根 install.py 的关系：根目录文件是正本，本插件目录里的运行时文件是
sync_plugin.py 生成的副本；本脚本把副本同步进稳定运行时目录
~/.zcode/zcode-token-usage-statusbar/（mtime 保护较新手改，升级时以记录 hash 识别托管文件），
再对运行时目录执行 patch_install.set_runtime() + install()——注入行指向稳定目录而非
插件缓存目录，插件升级换缓存目录不会让浮层失联。

测试接缝（环境变量）：ZUSAGE_PLUGIN_RUNTIME / ZUSAGE_PLUGIN_ASAR 可把运行时目录和
目标 asar 指到别处（自测用临时副本，不碰真机）。

自动安装开关（默认开，SessionStart hook 自动执行安装/修复）：
  运行时目录 config.json 写 "plugin_auto_install_overlay": false 可关闭；
  配置损坏或字段不是布尔值时不自动安装，环境变量 ZUSAGE_PLUGIN_AUTO_INSTALL 优先。

提示豁免：运行时目录写 .plugin-overlay-optout 后 hook 永久静默（remove 自动写入）；
未安装时每次 SessionStart 都提示；旧 .plugin-overlay-nudge 不再阻止提示，安装成功后清除。
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
import tempfile
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).parent.resolve()
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))
from runtime_lock import file_lock, update_config
# 会同步进运行时目录的插件副本（usage_mcp.py 不在其中：MCP 直接从插件目录跑）
RUNTIME_FILES = [
    "inject-main.cjs",
    "overlay.js",
    "zusage.py",
    "patch_install.py",
    "install_monitor.py",
    "plugin-updater.cjs",
    "plugin-release.cjs",
    "plugin-storage.cjs",
    "quota-client.cjs",
    "release_unpack.py",
    "runtime_lock.py", "usage_stats.py", "turn-stats.js",
    "token_rate.py", "renderer_bridge.py",
]


def sudo_user():
    """sudo 运行时的真实用户名（POSIX；非 sudo / Windows 返回 None）。"""
    if sys.platform == "win32" or not os.environ.get("SUDO_USER"):
        return None
    try:
        return os.environ["SUDO_USER"] if os.geteuid() == 0 else None
    except AttributeError:
        return None


def real_home():
    """真实用户家目录：sudo 会重置 HOME，Path.home() 指向 /root，而运行时目录、config.json
    与 hook 都以普通用户身份读写，必须落在 SUDO_USER 的家里（与根目录 install.py 同源）。
    Linux 上 /opt 等系统安装位置写入需要 root，这是本函数存在的唯一场景。"""
    user = sudo_user()
    if user:
        try:
            import pwd
            return Path(pwd.getpwnam(user).pw_dir)
        except (KeyError, OSError, ImportError):
            pass
    return Path.home()


def default_runtime():
    return real_home() / ".zcode" / "zcode-token-usage-statusbar"


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


def fixed_drives(letters):
    """本地固定盘盘符：离线的映射网络盘一被访问就触发重连（可卡数秒），光驱/读卡器可能无介质。"""
    try:
        import ctypes
        drive_type = ctypes.windll.kernel32.GetDriveTypeW
    except (ImportError, AttributeError, OSError):
        return []
    return [letter for letter in letters if drive_type(f"{letter}:\\") == 3]   # DRIVE_FIXED


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
    # 自定义盘符安装（如 D:\Program Files\ZCode）：逐个本地固定盘枚举两种常见布局；
    # %ProgramFiles% 只跟系统盘走。候选仍须通过 is_zcode_asar 包身份校验。
    candidates.extend(Path(f"{letter}:/{folder}/resources/app.asar")
                      for letter in fixed_drives("DEFGHIJKLMNOPQRSTUVWXYZ")
                      for folder in ("Program Files/ZCode", "ZCode"))
    if os.environ.get("LOCALAPPDATA"):
        programs = Path(os.environ["LOCALAPPDATA"]) / "Programs"
        candidates.extend(sorted(programs.glob("*/resources/app.asar")))
    return candidates


def is_zcode_asar(pi, asar):
    """生产目标必须由 asar 内 package.json 的 name 确认为 ZCode。"""
    try:
        with asar.open("rb") as stream:
            header, base = pi.read_header(stream)
            node = header["files"]["package.json"]
            if node.get("unpacked"):
                return False
            stream.seek(base + int(node["offset"]))
            package = json.loads(stream.read(int(node["size"])).decode("utf-8"))
        name = package.get("name")
        return isinstance(name, str) and "zcode" in name.lower()
    except Exception:
        return False


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
    fd, temporary = tempfile.mkstemp(prefix="." + dst.name + ".", dir=str(dst.parent))
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
        except FileNotFoundError:
            pass


VERIFY_TIMEOUT = 10   # 单次验收器运行上限（秒）


def _run_verifier(command, env):
    """运行一次验收器，输出按 UTF-8 解码（Node 恒写 UTF-8，系统区域编码会把中文路径解错）。
    超时先结束整棵进程树再上报 TimeoutExpired：subprocess.run 只杀直接子进程，且在
    Windows 上之后还会不限时地读完输出管道，子孙若继承了管道就永远等不到 EOF。
    收尾总耗时有界（taskkill 3 秒、回收 2 秒），叠加后仍在更新器 30 秒时限内。"""
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                               start_new_session=os.name != "nt")
    try:
        stdout, stderr = process.communicate(timeout=VERIFY_TIMEOUT)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            try:
                subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
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
    with tempfile.TemporaryDirectory(prefix="zusage-sync-verifier-") as directory:
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
  if (record.enabled === false || typeof record.installPath !== "string" || fs.realpathSync(record.installPath) !== root || record.version !== manifest.version) throw Error("同步插件与官方安装记录不一致或已禁用");
  const selected = release.readChannel(os.homedir(), storage);
  const channel = { kind: selected.kind, repository: selected.repository || "", source: selected.marketplace ? selected.marketplace.source : null };
  if (hasPending) {
    if (pending.pendingSync !== true) throw Error("待同步意图不完整，停止运行时同步");
    if (pending.pendingVersion && updater.compareVersions(record.version, pending.pendingVersion) <= 0) throw Error("插件安装尚未提交新版，停止运行时同步");
    if (pending.pendingRelease != null) {
      const expected = pending.pendingRelease, r = expected.release, m = expected.manifest;
      if (!r || !m || !expected.channel || !isDeepStrictEqual(channel, expected.channel)) throw Error("Release 更新意图无效或市场来源已变化，停止运行时同步");
      const validated = release.validateRelease({ tag_name: r.tag, draft: false, prerelease: false, assets: [r.archive, r.manifest] }, r.repository);
      if (!validated || validated.version !== r.version || channel.kind !== "release" || channel.repository !== r.repository) throw Error("Release 更新意图无效，停止运行时同步");
      release.validateManifest(m, validated);
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
                raise ValueError("运行时同步期间安装身份发生变化")
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
    cold_files = {"inject-main.cjs", "plugin-updater.cjs", "plugin-release.cjs", "plugin-storage.cjs", "quota-client.cjs"}
    if (load_runtime_config(runtime) or {}).get("hot_reload") is False:
        cold_files.update(("overlay.js", "zusage.py"))
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


def injected_status(pi):
    """True=当前运行时的唯一注入行 False=需修复 None=asar 不可读。"""
    try:
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


def auto_enabled(runtime):
    v = os.environ.get("ZUSAGE_PLUGIN_AUTO_INSTALL")
    if v is not None:
        return v.strip().lower() in ("1", "true", "yes", "on")
    config = load_runtime_config(runtime)
    return config is not None and config.get("plugin_auto_install_overlay", True) is True


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


def _nudge(output, message):
    from restart_notice import visible_context
    output["systemMessage"] = message
    output["hookSpecificOutput"] = {
        "hookEventName": "SessionStart",
        "additionalContext": visible_context("安装提醒", "状态条安装尚未完成。", message)}
    return output


def _install_overlay(runtime, pi):
    from restart_notice import record_restart
    return pi.install(before_publish=lambda installation: record_restart(
        runtime, {"state": "pending-install", "installation": installation}))


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
            # 杀毒扫描短暂锁文件/ACL 有建无删时清理自身不能炸——桥绝不影响主流程
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
            # hook 路径（quiet_monitor）stdout 只能是 hook JSON：publish/syntax 检查行
            # 全部重定向 stderr（与 auto-install 分支包 _install_overlay 同款）
            redirect = contextlib.redirect_stdout(sys.stderr) if quiet_monitor else contextlib.nullcontext()
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
                monitor_env = {name: os.environ.get(name) for name in
                               ("ZUSAGE_NO_MONITOR", "ZUSAGE_MONITOR_QUIET")}
                try:
                    if quiet_monitor:
                        # SessionStart 场景不弹监控黑窗，systemMessage 里已说明去向
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


def _bridge_notice(out, result, pi):
    """桥补装的用户可见提示（issue #67：受保护目录/客户端运行中不再静默失效）。
    pending 提示收敛（客户端退出收尾后转 present）；权限不足在目标持续不可写期间
    每次会话提示，与未安装时的 INSTALL_MESSAGE 同一强度。已有安装/重启提示时
    不覆盖——桥只是增强，优先级低于主链。"""
    if "systemMessage" in out:
        return out
    status = (result or {}).get("status")
    if status == "pending":
        from restart_notice import PREFIX, RESTART_ACTION
        return _nudge(out, PREFIX + "逐问速率行所需的一次性客户端补丁已排定："
                      "完全退出 ZCode（所有窗口）后会自动完成，之后重新打开即可；"
                      "其余功能不受影响。" + RESTART_ACTION)
    if status == "skipped-error" and result.get("permission"):
        # Windows 上 os.access 看不见 ACL（目录恒报可写），权限判定按真实
        # PermissionError 而不是 target_writable()，否则 Program Files 场景静默
        from restart_notice import PREFIX
        script = PLUGIN_ROOT / "overlay_install.py"
        if os.name == "nt":
            action = (f'以管理员身份打开终端，执行 python "{script}" install')
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


def run_hook():
    """SessionStart hook 主体：返回 hook 协议 JSON dict。任何异常都转成合法输出，
    绝不影响会话；patch_install 的人类可读输出重定向到 stderr，保证 stdout 纯 JSON。"""
    out = {"suppressOutput": True}
    runtime = Path(os.environ.get("ZUSAGE_PLUGIN_RUNTIME") or default_runtime())
    try:
        runtime, pi = resolve_paths()
        changed = sync_runtime(runtime, pi.ASAR)["changed"]
        try:
            from plugin_auto_update import start_auto_update
            start_auto_update(runtime, pi)
        except Exception as e:
            print(f"[zusage-plugin] 后台更新启动失败（已忽略）：{e}", file=sys.stderr)
        if optout_marker(runtime).exists():
            return out
        st = injected_status(pi)
        if st is None:
            return out  # 本机没有可定位的桌面客户端（远程会话等），静默
        save_runtime_config(runtime, pi)
        if st:
            bridge = ensure_renderer_bridge(pi, quiet_monitor=True)   # 已注入也可能缺桥（客户端升级重写 asar）：幂等补一次
            from restart_notice import session_notice
            cold_files = {"inject-main.cjs", "plugin-updater.cjs", "plugin-release.cjs", "plugin-storage.cjs", "quota-client.cjs"}
            if (load_runtime_config(runtime) or {}).get("hot_reload") is False:
                cold_files.update(("overlay.js", "zusage.py"))
            restart_files = [name for name in changed if name in cold_files]
            out = session_notice(runtime, out, injected=st, restart_files=restart_files)
            return _bridge_notice(out, bridge, pi)
        if auto_enabled(runtime):
            monitor_env = {name: os.environ.get(name) for name in
                           ("ZUSAGE_NO_MONITOR", "ZUSAGE_MONITOR_QUIET")}
            try:
                os.environ["ZUSAGE_NO_MONITOR"] = "1"
                os.environ["ZUSAGE_MONITOR_QUIET"] = "1"  # 无窗口后台收尾
                with contextlib.redirect_stdout(sys.stderr):
                    ok = _install_overlay(runtime, pi)
            finally:
                for name, value in monitor_env.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value
            if ok:
                bridge = ensure_renderer_bridge(pi, quiet_monitor=True)
                clear_markers(runtime)
                from restart_notice import session_notice
                out = session_notice(runtime, out, injected=injected_status(pi))
                return _bridge_notice(out, bridge, pi)
            else:
                from restart_notice import PREFIX
                _nudge(out, (PREFIX + "用量状态条自动安装未完成。"
                             "请运行 /install-overlay 重试；"
                             "不需要请运行 /uninstall-overlay，之后不再提示。"
                             "如果仍然失败，请查看客户端插件日志。"))
            return out
        from restart_notice import INSTALL_MESSAGE
        return _nudge(out, INSTALL_MESSAGE)
    except Exception as e:  # noqa: BLE001 — hook 绝不能抛
        message = f"zusage 插件自检失败（已忽略）：{e}"
        if optout_marker(runtime).exists():
            print("[zusage-plugin] " + message, file=sys.stderr)
            return {"suppressOutput": True}
        out["systemMessage"] = message
        out["hookSpecificOutput"] = {"hookEventName": "SessionStart", "additionalContext": message}
        return out


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
        print(f"auto install: {auto_enabled(runtime)}"
              f"（config.json 的 plugin_auto_install_overlay 或环境变量 ZUSAGE_PLUGIN_AUTO_INSTALL）")
        print(f"optout: {optout_marker(runtime).exists()}  nudge: {nudge_marker(runtime).exists()}")
        with contextlib.redirect_stdout(sys.stdout):
            pi.check()
        return
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
