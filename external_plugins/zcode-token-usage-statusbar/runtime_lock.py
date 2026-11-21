# -*- coding: utf-8 -*-
"""Permanent-file OS locks shared by the runtime synchronizer and Node helpers."""
import argparse
import errno
import json
import os
import shutil
import stat
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

_MKSTEMP_ATTEMPTS = 16


def bounded_mkstemp(prefix, dir=None, suffix=""):
    """受限次数的临时文件创建：与 tempfile.mkstemp 同形态（返回可用 fd 与路径），
    但 PermissionError 单次即原样抛出；形参顺序与 tempfile.mkstemp 不同，
    只应关键字传参。stdlib 的 _mkstemp_inner 在 Windows 上吞掉 PermissionError
    换随机名重试：旧形态（3.13.12 及更早、3.12 全线、3.14.0-3.14.3）还要求
    os.access 报可写（os.access 看不见 ACL，受保护目录恒真），TMP_MAX 取
    Windows 的 2^31-1，等于无限挂起（issue #360）；新形态（3.13.13+ 与 3.14.4+）
    自限 TMP_MAX=20 不再挂起、受保护目录上最终仍原样抛 PermissionError，但仍有
    20 次无谓重试且行为跨版本不一致。os.open 的单次失败是快错：只有
    FileExistsError（随机名碰撞）才换名重试，至多 _MKSTEMP_ATTEMPTS 次。"""
    directory = os.fspath(dir) if dir is not None else tempfile.gettempdir()
    for _ in range(_MKSTEMP_ATTEMPTS):
        name = os.path.join(directory, prefix + os.urandom(8).hex() + suffix)
        try:
            return os.open(name, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600), name
        except FileExistsError:
            continue
    raise FileExistsError(errno.EEXIST, "No usable temporary file name found")


@contextmanager
def bounded_tempdir(prefix, dir=None, suffix=""):
    """受限次数的临时目录创建与容错清理：stdlib 的 tempfile.mkdtemp 在 Windows 上
    与 _mkstemp_inner 同构（os.access 看不见 ACL 时吞掉 PermissionError 重试 TMP_MAX 次），
    且 TemporaryDirectory.__exit__ 在 Windows 子进程/杀软短暂持有句柄时会因 rmtree
    PermissionError（WinError 32/5）把已成功的上层调用打崩（Python 3.8/3.9 亦无
    ignore_cleanup_errors）。这里单次快错 PermissionError、仅 FileExistsError 换名重试
    至多 _MKSTEMP_ATTEMPTS 次，退出时 ignore_errors=True 清理。"""
    base = os.fspath(dir) if dir is not None else tempfile.gettempdir()
    created = None
    for _ in range(_MKSTEMP_ATTEMPTS):
        candidate = os.path.join(base, prefix + os.urandom(8).hex() + suffix)
        try:
            os.mkdir(candidate, 0o700)
            created = candidate
            break
        except FileExistsError:
            continue
    if created is None:
        raise FileExistsError(errno.EEXIST, "No usable temporary directory name found")
    try:
        yield created
    finally:
        try:
            shutil.rmtree(created, ignore_errors=True)
        except OSError:
            pass


def sudo_user(sys_platform=None):
    """sudo 运行时的真实用户名（POSIX；非 sudo / Windows 返回 None）。"""
    plat = sys.platform if sys_platform is None else sys_platform
    if plat == "win32" or not os.environ.get("SUDO_USER"):
        return None
    try:
        return os.environ["SUDO_USER"] if os.geteuid() == 0 else None
    except AttributeError:
        return None


def real_home(sudo_user_fn=None, home_fn=None):
    """真实用户家目录：sudo 会重置 HOME，Path.home() 指向 /root，而数据/运行目录与配置
    必须落在 SUDO_USER 的家目录。"""
    user = (sudo_user if sudo_user_fn is None else sudo_user_fn)()
    if user:
        try:
            import pwd
            return Path(pwd.getpwnam(user).pw_dir)
        except (KeyError, OSError, ImportError, AttributeError):
            pass
    return (Path.home if home_fn is None else home_fn)()


def fixed_drives(letters):
    """本地固定盘盘符：离线的映射网络盘一被访问就触发重连（可卡数秒），光驱/读卡器可能无介质。"""
    try:
        import ctypes
        drive_type = ctypes.windll.kernel32.GetDriveTypeW
    except (ImportError, AttributeError, OSError):
        return []
    return [letter for letter in letters if drive_type(f"{letter}:\\") == 3]   # DRIVE_FIXED


@contextmanager
def file_lock(path, timeout=10.0):
    """Acquire an advisory lock or raise TimeoutError; never unlink the lock file."""
    fd = os.open(os.fspath(path), os.O_RDWR | os.O_CREAT, 0o600)
    locked = False
    deadline = time.monotonic() + max(0.0, timeout)
    try:
        if os.name == "nt":
            import msvcrt
            if os.fstat(fd).st_size == 0:
                os.write(fd, b"\0")
        else:
            import fcntl
        while True:
            try:
                if os.name == "nt":
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
                else:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
                break
            except OSError as exc:
                if exc.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                    raise
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("runtime lock is busy: " + os.fspath(path)) from exc
                time.sleep(min(0.05, remaining))
        yield
    finally:
        try:
            if locked:
                if os.name == "nt":
                    os.lseek(fd, 0, os.SEEK_SET)
                    msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def _read_marker(marker):
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _hashes(value):
    if not isinstance(value, dict):
        return {}
    return {key: digest for key, digest in value.items()
            if isinstance(key, str) and not key.startswith("_")
            and isinstance(digest, str) and digest}


def _write_marker(marker, data, preserve=None):
    fd, name = bounded_mkstemp(prefix=marker.name + ".", suffix=".tmp", dir=marker.parent)
    try:
        if preserve is not None:
            if os.name != "nt":
                current = os.fstat(fd)
                if (current.st_uid, current.st_gid) != (preserve.st_uid, preserve.st_gid):
                    os.fchown(fd, preserve.st_uid, preserve.st_gid)
            os.chmod(name, stat.S_IMODE(preserve.st_mode))
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            fd = None
            json.dump(data, stream, ensure_ascii=False)
            stream.write("\n")
        os.replace(name, marker)
    finally:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(name)
        except OSError:
            pass


def update_config(runtime, changes, defaults=None, merge=None):
    """Reread under lock, then apply defaults, top-level changes and one-level merges.

    merge maps literal top-level object keys to direct child replacements; it never
    interprets dot paths or recursively merges values.
    """
    if not isinstance(changes, dict) or (defaults is not None and not isinstance(defaults, dict)):
        raise ValueError("config changes/defaults must be JSON objects")
    if merge is not None:
        if not isinstance(merge, dict):
            raise ValueError("config merge must be a JSON object")
        unsafe_keys = {"__proto__", "constructor", "prototype"}
        for key, value in merge.items():
            if not isinstance(key, str) or key in unsafe_keys or not isinstance(value, dict):
                raise ValueError("config merge must map safe string keys to JSON objects")
            if any(not isinstance(child, str) or child in unsafe_keys for child in value):
                raise ValueError("config merge child keys must be safe strings")
    runtime = Path(runtime)
    runtime.mkdir(parents=True, exist_ok=True)
    config = runtime / "config.json"
    lock_path = runtime / "plugin-config.lock"
    with file_lock(lock_path):
        owner = config.stat() if config.exists() else runtime.stat()
        if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0:
            lock_stat = lock_path.stat()
            if (lock_stat.st_uid, lock_stat.st_gid) != (owner.st_uid, owner.st_gid):
                os.chown(lock_path, owner.st_uid, owner.st_gid)
        try:
            current = json.loads(config.read_text(encoding="utf-8"))
        except FileNotFoundError:
            current = {}
        if not isinstance(current, dict):
            raise ValueError("config.json must be a JSON object")
        updated = dict(current)
        for key, value in (defaults or {}).items():
            updated.setdefault(key, value)
        updated.update(changes)
        merge_changed = False
        for key, value in (merge or {}).items():
            previous = updated.get(key)
            nested = dict(previous) if isinstance(previous, dict) else {}
            nested.update(value)
            updated[key] = nested
            # Python considers True == 1 and False == 0; a merge must persist JSON types.
            merge_changed = merge_changed or (json.dumps(nested, sort_keys=True)
                                               != json.dumps(current.get(key), sort_keys=True))
        if not merge_changed and updated == current and config.exists():
            return False
        _write_marker(config, updated, config.stat() if config.exists() else None)
        return True


def update_enhance_provider(runtime, revision, changes):
    """Update the restricted enhancement settings under the shared runtime lock."""
    if os.name == "nt":
        raise ValueError("secure enhancement provider storage unavailable")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0 or not isinstance(changes, dict):
        raise ValueError("invalid enhancement settings")
    fields = {"mode", "source", "providerId", "target", "baseUrl", "protocol", "model", "keyAction", "apiKey", "allowDowngrade", "saveHistory"}
    if set(changes) - fields or changes.get("keyAction", "keep") not in ("keep", "replace", "clear"):
        raise ValueError("invalid enhancement settings")
    runtime = Path(runtime)
    info = runtime.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        raise ValueError("unsafe runtime directory")
    config = runtime / "enhance-provider.json"
    lock = runtime / "enhance-provider.lock"
    if lock.is_symlink():
        raise ValueError("unsafe lock")
    with file_lock(lock):
        try:
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            fd = os.open(os.fspath(config), flags)
        except FileNotFoundError:
            current = {"version": 1, "revision": 0, "mode": "default"}
        else:
            with os.fdopen(fd, "r", encoding="utf-8") as stream:
                st = os.fstat(stream.fileno())
                if not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid() or st.st_nlink != 1 or st.st_mode & 0o077:
                    raise ValueError("unsafe enhancement settings")
                current = json.load(stream)
            if not isinstance(current, dict) or current.get("version") != 1 or not isinstance(current.get("revision"), int):
                raise ValueError("invalid enhancement settings")
        if current["revision"] != revision:
            raise ValueError("enhancement settings conflict")
        updated = dict(current)
        for key in fields - {"keyAction", "apiKey"}:
            if key in changes:
                value = changes[key]
                if key in ("allowDowngrade", "saveHistory"):
                    if not isinstance(value, bool):
                        raise ValueError("invalid enhancement settings")
                elif not isinstance(value, str) or len(value) > 2048 or any(ord(c) < 32 for c in value):
                    raise ValueError("invalid enhancement settings")
                updated[key] = value
        action = changes.get("keyAction", "keep")
        if action == "replace":
            key = changes.get("apiKey")
            if not isinstance(key, str) or not key or len(key) > 4096 or any(ord(c) < 32 for c in key):
                raise ValueError("invalid enhancement settings")
            updated["apiKey"] = key
        elif action == "clear":
            updated.pop("apiKey", None)
        if updated.get("mode") not in ("default", "custom") or updated.get("source", "manual") not in ("manual", "host"):
            raise ValueError("invalid enhancement settings")
        if (current.get("baseUrl"), current.get("protocol"), current.get("source", "manual")) != (updated.get("baseUrl"), updated.get("protocol"), updated.get("source", "manual")) and action == "keep":
            updated.pop("apiKey", None)
        updated["revision"] = revision + 1
        fd, name = bounded_mkstemp(prefix=".enhance-provider-", suffix=".tmp", dir=runtime)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                fd = None
                json.dump(updated, stream, ensure_ascii=False)
                stream.write("\n")
            os.replace(name, config)
        finally:
            if fd is not None:
                os.close(fd)
            try:
                os.unlink(name)
            except OSError:
                pass
        return updated


def record_restart(runtime, data):
    """Merge a restart notification while holding the independent marker lock."""
    if not isinstance(data, dict):
        raise ValueError("restart data must be a JSON object")
    runtime = Path(runtime)
    marker = runtime / ".plugin-restart-required"
    with file_lock(runtime / "plugin-restart.lock"):
        previous = _read_marker(marker)
        hashes = _hashes(previous.get("hashes"))
        hashes.update(_hashes(data.get("hashes")))
        if data.get("state") == "pending-install":
            previous.pop("publishedAt", None)  # A retry/new intent cannot inherit an earlier publication.
        previous.update(data)
        previous.update(createdAt=time.time(), hashes=hashes)
        _write_marker(marker, previous)
    return {"ok": True}


@contextmanager
def publish_install(runtime, installation):
    """ASAR publication and its existing intent share the ack lock; never recreate a marker."""
    runtime = Path(runtime)
    marker = runtime / ".plugin-restart-required"
    if not marker.is_file():
        yield
        return
    with file_lock(runtime / "plugin-restart.lock"):
        data = _read_marker(marker)
        owned = data.get("installation") == installation
        yield
        if owned and marker.is_file() and _read_marker(marker) == data:
            data["publishedAt"] = time.time() * 1000
            try:
                _write_marker(marker, data)
            except OSError as exc:
                # ASAR is already published. Leave the intent unconfirmed, not a false success.
                print("[zusage-plugin] installation publication record failed: " + str(exc), file=sys.stderr)


def ack_restart(runtime, loaded):
    """Remove only hashes actually loaded; preserve newer legacy notifications."""
    if not isinstance(loaded, dict):
        raise ValueError("loaded hashes must be a JSON object")
    runtime = Path(runtime)
    marker = runtime / ".plugin-restart-required"
    with file_lock(runtime / "plugin-restart.lock"):
        if not marker.exists():
            return {"ok": True, "cleared": False}
        data = _read_marker(marker)
        loaded_at = loaded.get("_loadedAt")
        hot_loaded = loaded.get("_hotLoadedAt")
        created_at = data.get("createdAt")
        if not isinstance(created_at, (int, float)) or isinstance(created_at, bool):
            created_at = marker.stat().st_mtime
        if isinstance(loaded_at, (int, float)) and not isinstance(loaded_at, bool) and created_at * 1000 > loaded_at:
            # 本进程启动后才写入的 marker 默认不动（启动快照没见过这份通知）。唯一例外：
            # 主进程在运行期热重载了全部相关模块——_hotLoadedAt[文件]=热替换完成时刻，
            # 且 loaded 已持有 marker 记录的同一 digest（热替换加载的正是 marker 想让
            # 重启后生效的字节）。inject-main.cjs 是 loader 自身，永远只能随进程重启
            # 生效，不参与热销账。缺任何一项证据整单保留；下方 pending-install /
            # installation 门控不受热时间戳影响（asar 替换必须真重启）。
            hot_cleared = False
            if isinstance(hot_loaded, dict):
                hot_hashes = _hashes(data.get("hashes"))
                if hot_hashes:
                    hot_cleared = True
                    for hot_key, hot_digest in hot_hashes.items():
                        hot_stamp = hot_loaded.get(hot_key)
                        if (hot_key == "inject-main.cjs" or loaded.get(hot_key) != hot_digest
                                or not isinstance(hot_stamp, (int, float)) or isinstance(hot_stamp, bool)
                                or hot_stamp != hot_stamp or hot_stamp < created_at * 1000):   # != 自身过滤 NaN（json.loads 会放行）
                            hot_cleared = False
                            break
            if hot_cleared and data.get("asarPatch") is True:
                # asar 中段补丁只能随进程完全重启加载；热重载的运行时模块不能替它
                # 销账——即使合并进来的 pending-sync hashes 已全部热加载。下一次真正
                # 启动（createdAt 早于 loadedAt）仍走下方正常 hash/installation 流程清除。
                return {"ok": True, "cleared": False}
            if not hot_cleared:
                return {"ok": True, "cleared": False}
        installation = data.get("installation")
        if data.get("state") == "pending-install" or installation is not None:
            published_at = data.get("publishedAt")
            if (not isinstance(installation, dict)
                    or not isinstance(published_at, (int, float)) or isinstance(published_at, bool)
                    or not isinstance(loaded_at, (int, float)) or isinstance(loaded_at, bool)
                    or loaded_at <= published_at):
                return {"ok": True, "cleared": False}
        hashes = _hashes(data.get("hashes"))
        if hashes:
            remaining = {key: digest for key, digest in hashes.items() if loaded.get(key) != digest}
            if remaining:
                data["hashes"] = remaining
                _write_marker(marker, data)
                return {"ok": True, "cleared": False}
        marker.unlink()
    return {"ok": True, "cleared": True}


def main():
    parser = argparse.ArgumentParser()
    operation = parser.add_mutually_exclusive_group(required=True)
    operation.add_argument("--hold", metavar="LOCKPATH")
    operation.add_argument("--record-restart", metavar="RUNTIME")
    operation.add_argument("--ack-restart", nargs=2, metavar=("RUNTIME", "HASHES_JSON"))
    operation.add_argument("--update-config", metavar="RUNTIME")
    operation.add_argument("--update-enhance-provider", metavar="RUNTIME")
    args = parser.parse_args()
    if args.hold:
        try:
            with file_lock(args.hold, timeout=0):
                print(json.dumps({"locked": True}, separators=(",", ":")), flush=True)
                while sys.stdin.buffer.read(65536):
                    pass
        except TimeoutError:
            print(json.dumps({"locked": False}, separators=(",", ":")), flush=True)
    elif args.record_restart:
        print(json.dumps(record_restart(args.record_restart, json.load(sys.stdin))))
    elif args.update_enhance_provider:
        try:
            data = json.load(sys.stdin)
            updated = update_enhance_provider(args.update_enhance_provider, data.get("revision"), data.get("changes"))
            print(json.dumps({"ok": True, "revision": updated["revision"]}))
        except (OSError, ValueError, TypeError, AttributeError):
            print(json.dumps({"ok": False, "error": "enhance_provider_save_failed"}))
            return 1
    elif args.update_config:
        data = json.load(sys.stdin)
        if not isinstance(data, dict) or "changes" not in data:
            raise ValueError("config update must contain changes")
        changed = update_config(args.update_config, data["changes"], data.get("defaults"), data.get("merge"))
        print(json.dumps({"ok": True, "changed": changed}))
    else:
        print(json.dumps(ack_restart(args.ack_restart[0], json.loads(args.ack_restart[1]))))


if __name__ == "__main__":
    raise SystemExit(main())   # main() 的 return 1（事务失败）必须传播为非零退出码，否则调用方把失败当成功
