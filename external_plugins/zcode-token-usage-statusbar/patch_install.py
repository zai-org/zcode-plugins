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
import hashlib
import json
import os
import re
import stat
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from contextlib import nullcontext
from runtime_lock import file_lock, publish_install

IS_WIN = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"

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
        sudo_home = None
        if sys.platform != "win32" and os.environ.get("SUDO_USER"):
            try:
                if os.geteuid() == 0:
                    import pwd
                    sudo_home = Path(pwd.getpwnam(os.environ["SUDO_USER"]).pw_dir)
            except (KeyError, OSError, AttributeError):
                pass
        bases = [RUNTIME,
                 Path.home() / ".zcode" / "zcode-token-usage-statusbar"]
        if sudo_home:
            bases.append(sudo_home / ".zcode" / "zcode-token-usage-statusbar")
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
            ).stdout
            return "ZCode.exe" in out
        # macOS/Linux：pgrep 精确匹配主进程名；误判"未运行"在 POSIX 上也无害
        # （运行中替换本就允许：rename 语义，旧进程继续读旧 inode）
        return subprocess.run(["pgrep", "-x", "ZCode"], capture_output=True).returncode == 0
    except Exception:
        return True  # 查不到时按在跑处理，走安全路径


def _spawn_detached(cmd, flags, **kwargs):
    """Windows：优先带 CREATE_BREAKAWAY_FROM_JOB 拉起，让监控脱离父进程的 Job 对象——
    从 agent/工具会话里跑安装时，会话清理会整树杀掉子进程，监控等不到客户端退出就被杀，
    收尾只能寄望下次 SessionStart 重试。Job 不允许 breakaway 时降级为普通创建。"""
    if not IS_WIN:
        return None
    breakaway = getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0)
    try:
        return subprocess.Popen(cmd, creationflags=flags | breakaway, **kwargs)
    except OSError:
        return subprocess.Popen(cmd, creationflags=flags, **kwargs)


def launch_monitor(epoch):
    """Windows 开新控制台窗口跑安装监控（提醒重启 + 确认生效 + .tmp 收尾）；
    macOS/Linux 无控制台概念，后台静默跑（收尾与自动退出照常）。设 ZUSAGE_NO_MONITOR=1 可禁用。"""
    if os.environ.get("ZUSAGE_NO_MONITOR") and not os.environ.get("ZUSAGE_MONITOR_QUIET"):
        return
    monitor = HERE / "install_monitor.py"
    if not monitor.exists():
        return
    cmd = [sys.executable, str(monitor), "%.3f" % epoch, str(ASAR), str(RUNTIME)]
    try:
        if os.environ.get("ZUSAGE_MONITOR_QUIET"):
            if IS_WIN:
                return _spawn_detached(cmd, subprocess.CREATE_NO_WINDOW, cwd=str(HERE),
                                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL)
            return subprocess.Popen(cmd, creationflags=0, cwd=str(HERE),
                                    start_new_session=True,
                                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL)
        if IS_WIN:
            return _spawn_detached(cmd, subprocess.CREATE_NEW_CONSOLE, cwd=str(HERE))
        return subprocess.Popen(cmd, cwd=str(HERE),
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        print(L(f"（监控窗口启动失败，不影响安装：{e}）",
                f"(monitor window failed to launch; installation is unaffected: {e})"))
        return None


# ---------- asar 读写 ----------

def read_header(f):
    f.seek(0)
    a, b, c, d = struct.unpack("<4I", f.read(16))
    assert a == 4, f"unexpected pickle prefix {a}"
    header = json.loads(f.read(d))
    return header, 8 + b


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


def repack(src_path: Path, modify: dict, dst_path: Path):
    """重建 asar。modify: {asar内路径: 新内容bytes}。流式拷贝未改动文件。"""
    with open(src_path, "rb") as src:
        header, base = read_header(src)
        header = json.loads(json.dumps(header))  # 深拷贝
        nodes = dict(iter_files(header))
        missing = set(modify) - set(nodes)
        assert not missing, f"paths not in asar: {missing}"

        data_parts = []
        offset = 0
        for p, node in nodes.items():
            if node.get("unpacked"):
                node["offset"] = "0"
                continue
            if p in modify:
                data = modify[p]
                node["size"] = len(data)
                node["integrity"] = compute_integrity(data)
            else:
                src.seek(base + int(node["offset"]))
                data = src.read(node["size"])
            node["offset"] = str(offset)
            data_parts.append(data)
            offset += len(data)

        payload = b"".join(data_parts)
        header_bytes = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        d = len(header_bytes)
        c = (d + 4 + ALIGN - 1) // ALIGN * ALIGN
        b_total = c + 4
        with open(dst_path, "wb") as out:
            out.write(struct.pack("<4I", 4, b_total, c, d))
            out.write(header_bytes)
            out.write(b"\0" * (c - d - 4))  # pickle 对齐：数据区从 8+b = 12+c 处开始
            assert out.tell() == 8 + b_total, f"header pad mismatch: {out.tell()} vs {8 + b_total}"
            out.write(payload)
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
    找不到/无法运行 ZCode 可执行文件时跳过（自检是锦上添花，不应挡安装）。"""
    exe = ZCODE_EXE
    if not exe or not exe.is_file():
        print(L("  [check] 未找到 ZCode 可执行文件，跳过语法检查",
                "  [check] ZCode executable not found; syntax check skipped"))
        return True
    src = entry_bytes_of(asar_path)
    env = dict(os.environ, ELECTRON_RUN_AS_NODE="1")
    fd, name = tempfile.mkstemp(prefix=".entry-check.", suffix=".js", dir=HERE)
    tmp_js = Path(name)
    try:
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
        tmp_js.unlink(missing_ok=True)
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


def source_fingerprint(path):
    """流式 SHA256；hash 前后及打开的 inode 都须一致，避免读取升级中的混合包。"""
    before = file_stamp(path)
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        if _stat_stamp(os.fstat(stream.fileno())) != before:
            raise PendingTmpError("file changed before hashing")
        for block in iter(lambda: stream.read(BLOCK), b""):
            digest.update(block)
        if _stat_stamp(os.fstat(stream.fileno())) != before:
            raise PendingTmpError("file changed while hashing")
    if file_stamp(path) != before:
        raise PendingTmpError("file replaced while hashing")
    return dict(before, sha256=digest.hexdigest())


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


def _load_tmp_metadata():
    try:
        if TMP_META.is_symlink():
            raise PendingTmpError("sidecar is a symlink")
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


def _atomic_tmp_metadata(meta):
    fd, name = tempfile.mkstemp(prefix=TMP_META.name + ".", dir=TMP_META.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(meta, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, TMP_META)
    finally:
        Path(name).unlink(missing_ok=True)


def _target_lock():
    # Independent of runtime/update locks: never call runtime synchronization here.
    return file_lock(ASAR.with_name(ASAR.name + ".zusage.lock"))


def _checked_tmp_metadata(path, source, operation):
    if operation not in ("install", "remove"):
        raise PendingTmpError("invalid pending operation")
    _same_stamp(ASAR, source)
    before = source_fingerprint(path)
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


def _publish_pending(stage, source, operation, previous):
    """校验 stage 后按 journal→原子发布→sidecar 的次序落成 TMP（prepare 与桥链共用）。"""
    meta = _checked_tmp_metadata(stage, source, operation)
    # Two files cannot be atomically published together. Persist a cancelled
    # ownership journal first, so any interruption is safe and recoverable.
    journal = dict(meta, operation="cancelled", publishing=True)
    if previous is not None and TMP.exists():
        journal["previous_tmp"] = source_fingerprint(TMP)
    _atomic_tmp_metadata(journal)
    _same_stamp(ASAR, source)
    _same_stamp(stage, meta["tmp"])
    os.replace(stage, TMP)
    meta["tmp"] = source_fingerprint(TMP)
    _same_stamp(ASAR, source)
    _atomic_tmp_metadata(meta)
    return meta


def _prepare_tmp(modify, operation="install", source=None):
    source = source if source is not None else source_fingerprint(ASAR)
    _same_stamp(ASAR, source)
    previous = None
    if TMP.exists() or TMP.is_symlink() or TMP_META.exists() or TMP_META.is_symlink():
        previous = _owned_tmp_metadata()
    fd, name = tempfile.mkstemp(prefix=TMP.name + ".", suffix=".stage", dir=TMP.parent)
    os.close(fd)
    stage = Path(name)
    try:
        repack(ASAR, modify, stage)
        original_stat = ASAR.stat()
        if os.name != "nt":
            stage_stat = stage.stat()
            if (stage_stat.st_uid, stage_stat.st_gid) != (original_stat.st_uid, original_stat.st_gid):
                os.chown(stage, original_stat.st_uid, original_stat.st_gid)
        os.chmod(stage, stat.S_IMODE(original_stat.st_mode))
        return _publish_pending(stage, source, operation, previous)
    finally:
        # Only this invocation's exclusive name, never glob historical TMPs.
        stage.unlink(missing_ok=True)


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
        previous = None
        if TMP.exists() or TMP.is_symlink() or TMP_META.exists() or TMP_META.is_symlink():
            previous = _owned_tmp_metadata()
        try:
            if operation == "install" and previous is not None and previous["operation"] == "remove":
                raise PendingTmpError("pending remove in progress; install pending refused")
            return _publish_pending(stage, source, operation, previous)
        finally:
            stage.unlink(missing_ok=True)


def pending_operation():
    """当前待替换 sidecar 的 operation（install/remove/cancelled）；无合法 sidecar
    时返回 None。桥补装链用它让位：用户 remove 待收尾期间，自动补桥不得以
    install pending 覆盖卸载意图。"""
    try:
        return _load_tmp_metadata()["operation"]
    except PendingTmpError:
        return None


def pending_tmp(operation="install", verify_hash=False, verified=None):
    """校验来源及 TMP；verified 是单次监控的缓存，stat/sidecar 不变才复用 hash。"""
    meta = _load_tmp_metadata()
    if (meta["operation"] == "cancelled" or meta.get("validated") is not True or
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

def target_writable():
    """asar 与其所在目录都可写（/opt 等系统位置需要 root：只读目标不能再重打包）。"""
    return os.access(ASAR, os.W_OK) and os.access(ASAR.parent, os.W_OK)


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
        print(L('  python "{}" {}'.format(script, cmd).rstrip(),
                '  python "{}" {}'.format(script, cmd).rstrip()))
        return
    print(L(f"[权限] app.asar 或其所在目录不可写（Linux 上 /opt 等系统位置需要 root）：{ASAR}",
            f"[permission] app.asar or its directory is not writable (Linux system locations like /opt need root): {ASAR}"))
    print(L("请用 sudo 重跑，并保留当前 HOME 与 PATH（sudo 默认重置它们，会让 nvm 的 node "
            "和 ~/.zcode 下的运行时目录定位失败）：",
            "Re-run with sudo while keeping the current HOME and PATH (sudo resets both by default, "
            "which hides an nvm node and mislocates the runtime dir under ~/.zcode):"))
    print(L('  sudo env HOME="$HOME" PATH="$PATH" python3 "{}" {}'.format(script, cmd).rstrip(),
            '  sudo env HOME="$HOME" PATH="$PATH" python3 "{}" {}'.format(script, cmd).rstrip()))


def install(finalize=False, before_publish=None):
    """Serialize install/remove/finalize; optional callback precedes a new install's publication."""
    if finalize:
        return _install(finalize=True)
    try:
        with _target_lock():
            return _install(before_publish=before_publish)
    except OSError as e:
        print(L(f"安装锁获取失败：{e}", f"Cannot acquire install lock: {e}"))
        return False


def _install(finalize=False, before_publish=None):
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
    if not target_writable():
        sudo_hint()
        return False
    try:
        source = source_fingerprint(ASAR)  # 必须在读取待修改入口和 repack 前取得。
        entry = entry_bytes_of(ASAR)
        _same_stamp(ASAR, source)
    except (OSError, PendingTmpError) as e:
        print(L(f"来源校验失败：{e}", f"Source validation failed: {e}"))
        return False
    stripped = ZUSAGE_LINE_RE.sub(b"", entry)   # 剥离任何旧注入行（含指向旧目录的）
    if stripped + INJECT_LINE.encode() == entry:
        print(L("已安装，注入行已指向当前目录。如需重装先 remove。",
                "Already installed; the injection line points at the current directory. Run remove first to reinstall."))
        cleanup_legacy_bak()
        return True

    new_entry = stripped + INJECT_LINE.encode()
    if stripped != entry:
        print(L("检测到旧注入行（可能指向旧目录），将替换为新路径。",
                "Old injection line detected (possibly pointing at an old directory); it will be replaced with the new path."))
    print(L("重打包（307MB，约需十几秒）...", "repacking (307MB, takes ~10-20 seconds)..."))
    try:
        if before_publish is not None:
            before_publish({"asar": str(ASAR.resolve()),
                            "entryHash": hashlib.sha256(new_entry).hexdigest()})
        _prepare_tmp({"/" + ENTRY: new_entry}, source=source)
    except (OSError, PendingTmpError) as e:
        print(L(f"待替换包生成失败，未替换：{e}", f"Pending package preparation failed; not replaced: {e}"))
        return False
    if client_running():
        try:
            _replace_pending("install")
            print(L("\n客户端运行中，但 asar 原子替换成功（运行中进程仍读旧数据）。",
                    "\nZCode is running, but the asar was replaced atomically (running processes keep reading the old data)."))
            print(L("重启 ZCode 后悬浮条生效；已弹出监控窗口，确认生效后自动关闭。",
                    "The floating bar activates after restarting ZCode; a monitor window has opened and will close itself once the load is confirmed."))
            cleanup_legacy_bak()
            launch_monitor(time.time())
            return True
        except PendingTmpError as e:
            print(L(f"待替换包已失效，未替换：{e}", f"Pending package invalidated; not replaced: {e}"))
            return False
        except OSError as e:
            print(L(f"\n运行中替换失败（{e}）。已弹出监控窗口：完全退出 ZCode 后会自动完成替换，",
                    f"\nReplacement while running failed ({e}). A monitor window has opened: it finishes the replacement once ZCode quits completely,"))
            print(L(f'或之后手动执行：python patch_install.py install --finalize --asar "{ASAR}" --runtime "{RUNTIME}"',
                    f'or run manually afterwards: python patch_install.py install --finalize --asar "{ASAR}" --runtime "{RUNTIME}"'))
            launch_monitor(time.time())
            return False
    try:
        if not _replace_pending("install", client_closed=lambda: not client_running()):
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
    """True=已注入 False=未注入 None=asar 读不到；只读即可判定，不需要目标锁。"""
    try:
        return bool(ZUSAGE_LINE_RE.search(entry_bytes_of(ASAR)))
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
        source = source_fingerprint(ASAR)
        old = entry_bytes_of(ASAR)
        _same_stamp(ASAR, source)
    except (OSError, PendingTmpError) as e:
        print(L(f"卸载安全校验失败，未替换：{e}", f"Remove safety validation failed; not replaced: {e}"))
        return False
    stripped = ZUSAGE_LINE_RE.sub(b"", old)
    if stripped == old:
        print(L("当前 asar 未注入。", "The current asar is not injected."))
        cleanup_legacy_bak()
        return True
    print(L("重打包（剥离注入行，约需十几秒）...", "repacking (stripping the injection line, takes ~10-20 seconds)..."))
    try:
        _prepare_tmp({"/" + ENTRY: stripped}, operation="remove", source=source)
    except (OSError, PendingTmpError) as e:
        print(L(f"卸载待替换包生成失败：{e}", f"Remove pending package preparation failed: {e}"))
        return False
    running = client_running()
    try:
        _replace_pending("remove")
    except PendingTmpError as e:
        print(L(f"卸载待替换包已失效，未替换：{e}", f"Remove pending package invalidated; not replaced: {e}"))
        return False
    except OSError as e:
        print(L(f'\n替换失败（{e}）。请完全退出 ZCode 后重跑 python patch_install.py remove --asar "{ASAR}"，',
                f'\nReplacement failed ({e}). Quit ZCode completely and re-run python patch_install.py remove --asar "{ASAR}", '))
        print(L("待替换文件保留；不要手动 move/mv 覆盖可能已升级的 app.asar。",
                "Pending files kept; do not manually move/mv over a possibly upgraded app.asar."))
        return False
    print(L("已剥离注入行" + ("（客户端运行中，已原子替换，运行中进程仍读旧数据）" if running else "") + "。重启 ZCode 后生效。",
            "Injection line stripped" + (" (ZCode was running; replaced atomically, the running process keeps the old data)" if running else "") + ". Takes effect after restarting ZCode."))
    cleanup_legacy_bak()
    return True


def check():
    injected = bool(ZUSAGE_LINE_RE.search(entry_bytes_of(ASAR)))   # 宽松匹配任意目录的历史注入行（独立运行时 INJECT_LINE 指向仓库路径，精确匹配会误报未注入）
    print("asar:", ASAR, ASAR.stat().st_size, "bytes")
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
    main()
