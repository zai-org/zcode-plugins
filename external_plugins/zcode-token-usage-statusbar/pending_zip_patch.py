# -*- coding: utf-8 -*-
"""ZCode 桌面 pending 更新包清理工具（macOS）。

历史与废除原因（issue #298）：本模块曾按「方案 B」在 Squirrel 取包前改写 pending zip
内的 app.asar 补注入行，让「更新重启」后插件一次生效。该设计结构性不可行——ZCode 桌面
（electron-updater 6.8.10 + autoInstallOnAppQuit=false）下载完成时把官方 Content-Length
固化进 MacUpdater 本地代理（zipFileInfo.info.size 或下载完成时的 stat），用户点
「重启以更新」时 Squirrel 经该代理按此长度拉流，而改写后的 zip 总大小必然偏离官方值
（实测 3.18.0 官方 305,360,451 B → 重写后 317,024,560 B），拉包被截断/失配即 Squirrel
解析失败，宿主静默 relaunch 回旧版（日志仅 ~/.zcode/v2/logs/ 一行 warn）；restage 缓存
命中同一坏包，连续重试全部复现。sha512 在下载完成与缓存复用轮各验一次字节，安装
拉流阶段不复验，挡不住这一层。

现行为反转为清理自愈：旧版改写会在运行目录 pending-zip-patch.json 记账。本工具对账本
中记录的 zip 逐个核对当前字节 sha256——仍与改写时一致（还是坏包）即删除，宿主下次
更新检查按缓存失效重新下载官方 zip；字节已变（宿主已重下官方包）只清账本绝不动文件。
没有账本记录的 zip（含官方字节）永远不碰；update-info.json 恒不读不写（宿主缓存有效性
判定依据）。顺带清扫旧版改写链的工作目录与候选临时文件残留。

用法（inject-main.cjs 自动调用；手动等价）：
  python pending_zip_patch.py --zip <pending zip> --runtime <运行目录>
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent.resolve()
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import patch_install  # noqa: E402
from runtime_lock import bounded_mkstemp, file_lock  # noqa: E402

STATE_NAME = "pending-zip-patch.json"
STATE_VERSION = 1
STATE_LIMIT = 8
COPY_BLOCK = 4 * 1024 * 1024


def _log(message):
    print(patch_install.L(f"[pending-zip] {message}", f"[pending-zip] {message}"))


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(COPY_BLOCK), b""):
            digest.update(block)
    return digest.hexdigest()


def load_state(runtime):
    try:
        state = json.loads((runtime / STATE_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version": STATE_VERSION, "files": {}}
    if not isinstance(state, dict) or not isinstance(state.get("files"), dict):
        return {"version": STATE_VERSION, "files": {}}
    # 记录值损坏按未记录处理：宁少清一次也不把坏记录当依据删文件
    state["files"] = {name: value for name, value in state["files"].items()
                      if isinstance(value, dict) and isinstance(value.get("sha256"), str)}
    return state


def save_state(runtime, state):
    files = state.get("files") if isinstance(state.get("files"), dict) else {}
    if len(files) > STATE_LIMIT:   # LRU 淘汰：只留最近处理的包，防状态文件随版本累积膨胀
        recent = sorted(files.items(), key=lambda kv: kv[1].get("patchedAt", 0), reverse=True)
        state["files"] = dict(recent[:STATE_LIMIT])
    state["version"] = STATE_VERSION
    fd, name = bounded_mkstemp(prefix=STATE_NAME + ".", dir=runtime)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(state, stream, separators=(",", ":"))
        os.replace(name, runtime / STATE_NAME)
    finally:
        try:
            Path(name).unlink(missing_ok=True)
        except OSError:
            pass


def _forget(runtime, name):
    with file_lock(runtime / (STATE_NAME + ".lock")):
        state = load_state(runtime)
        # 恒落盘：load_state 已把损坏条目滤在内存之外，这里写回即顺带清掉它们，
        # 否则 Node 候选（只看键名）会为坏条目每 60s 空转一次 spawn
        if name in state["files"]:
            del state["files"][name]
        save_state(runtime, state)


STALE_WORKDIR_SECONDS = 3600


def stat_anchor(path):
    st = path.stat()
    return {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "ino": st.st_ino}


def _sweep_stale_workdirs(directory):
    """清掉旧版改写链的残留：超龄 .zusage-pendingzip-* 工作目录（正常路径由 finally
    清理，硬杀/登出没有机会执行，按 mtime 超龄兜底；刚创建的不动）与任意
    .zusage-zip-*.tmp 候选临时文件（旧版重写中断的孤儿，宿主清缓存前一直占盘）。"""
    now = time.time()
    for stale in Path(directory).glob(".zusage-pendingzip-*"):
        try:
            if now - stale.stat().st_mtime > STALE_WORKDIR_SECONDS:
                shutil.rmtree(stale, ignore_errors=True)
        except OSError:
            pass
    for tmp in Path(directory).glob(".zusage-zip-*.tmp"):
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def undo_zip(zip_path, runtime=None):
    """清理曾被旧版预注入改写、至今仍躺在 pending 的 zip。返回 0=清理完成/无事可做，
    1=失败（坏包仍在，由下一轮触发重试）。"""
    zip_path = Path(zip_path)
    runtime = Path(runtime) if runtime else HERE
    if not zip_path.is_file():
        _forget(runtime, zip_path.name)   # 宿主已清缓存：只剩账本条目待清
        return 0
    _sweep_stale_workdirs(zip_path.parent)
    with file_lock(runtime / (STATE_NAME + ".lock")):
        record = load_state(runtime)["files"].get(zip_path.name)
    if not isinstance(record, dict):
        # 无记录（含 sha256 缺失被 load_state 滤掉的坏条目）：zip 不动，条目清掉，
        # 否则 Node 候选只看键名会对坏条目 60s 空转 spawn
        _log(f"{zip_path.name}: no patch record; leave it alone")
        _forget(runtime, zip_path.name)
        return 0
    if record.get("runtime") != str(runtime.absolute()):
        _log(f"{zip_path.name}: record belongs to another runtime; leave it alone")
        return 0
    anchor = stat_anchor(zip_path)
    digest = sha256_of(zip_path)
    if record.get("sha256") != digest:
        # 字节与改写时记账不一致：宿主已重新下载官方包，只清账本，绝不动文件
        _log(f"{zip_path.name}: bytes no longer match patched record (host redownload?); keep file, drop record")
        _forget(runtime, zip_path.name)
        return 0
    try:
        if stat_anchor(zip_path) != anchor:
            # 摘要算的是旧字节，文件已被并发改写（宿主重下中）：本轮放弃，下轮按新字节对账
            _log(f"{zip_path.name}: changed during hashing; retry next tick")
            return 1
        zip_path.unlink()
    except OSError as e:
        _log(f"{zip_path.name}: remove failed: {e}")
        return 1
    _forget(runtime, zip_path.name)
    _log(f"{zip_path.name}: patched zip removed; host will redownload official bytes")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Remove pending update zips previously rewritten by this plugin (issue #298)")
    parser.add_argument("--zip", required=True)
    parser.add_argument("--runtime", default=None, help="plugin runtime dir (defaults to script dir)")
    args = parser.parse_args(argv)
    if sys.platform != "darwin":
        # 清理对象只存在于 macOS 的 electron-updater 缓存；其它平台本工具不该被调用。
        _log(f"unsupported platform {sys.platform}; skip")
        return 0
    zip_path = Path(os.path.abspath(os.path.expandvars(os.path.expanduser(args.zip))))
    runtime_arg = args.runtime or os.environ.get("ZUSAGE_RUNTIME")
    # 与 patch_install 的 --runtime 同纪律：不 resolve（macOS /var 符号链接会破坏
    # 账本 runtime 字段的字面一致性），abspath 只补绝对化。
    runtime = Path(os.path.abspath(os.path.expandvars(os.path.expanduser(runtime_arg)))) if runtime_arg else HERE
    try:
        return undo_zip(zip_path, runtime)
    except Exception as e:   # 兜底：任何未预期异常都不裸 traceback，原 zip 不动退 1
        _log(f"unexpected failure, original zip kept: {type(e).__name__}: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
