# -*- coding: utf-8 -*-
"""重新注入后的会话提醒；标记由客户端 loader 成功加载时清除。"""
import hashlib
import json
import os
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).parent.resolve()
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))
from runtime_lock import record_restart as _record_restart

MARKER = ".plugin-restart-required"
PREFIX = "🔴 zcode-token-usage-statusbar 插件提醒："
RESTART_ACTION = ("请完全退出 ZCode（所有窗口）：从 ZCode 菜单选择「退出」，然后重新打开 ZCode，"
                  "让窗口底部的用量状态条加载新版本。只关窗口、刷新页面或重开会话无效。")
MESSAGE = PREFIX + "用量状态条已安装或更新。" + RESTART_ACTION
INSTALL_MESSAGE = (PREFIX + "窗口底部的用量状态条还没有安装好。插件默认自动安装，但当前尚未完成。"
                   "需要请运行 /install-overlay（会修改客户端文件），"
                   "安装成功后再退出并重开 ZCode；仅重启不能完成安装。"
                   "不需要请运行 /uninstall-overlay，之后不再提示。")


def runtime_dir():
    return Path(os.environ.get("ZUSAGE_PLUGIN_RUNTIME") or
                Path.home() / ".zcode" / "zcode-token-usage-statusbar")


def record_restart(runtime, data=None):
    """同步传目标 hashes；重新注入可无 hashes，合并/确认共用永久 marker 锁。"""
    runtime = Path(runtime)
    runtime.mkdir(parents=True, exist_ok=True)
    return _record_restart(runtime, data or {})


def installation_status(runtime):
    try:
        from overlay_install import injected_status, resolve_paths
        return injected_status(resolve_paths(runtime)[1])
    except Exception:
        return None


def visible_context(label, detail, message):
    return ("【用户可见·" + label + "】" + detail +
            "请在下一条最终回复正文的第一行，用 Markdown 引用块原样提醒用户，整条提示加粗并保留红色圆点；"
            "不要使用会被客户端过滤的 HTML 颜色标签：\n> **" + message + "**" +
            "\n提醒之后继续回答用户当前问题；不要自行退出或重启客户端。")


def reminder(runtime=None, injected=None, restart_files=()):
    """只读判定；两个 hook 提示通道和 CLI 共用同一文案。"""
    runtime = Path(runtime) if runtime is not None else runtime_dir()
    marker = runtime / MARKER
    if not marker.is_file() or (runtime / ".plugin-overlay-optout").exists():
        return None
    status = installation_status(runtime) if injected is None else injected
    if status is None:
        return None
    if status is False:
        return {"message": INSTALL_MESSAGE,
                "context": visible_context("安装提醒", "客户端尚未完成状态条注入，重启不能代替安装。", INSTALL_MESSAGE)}
    message = MESSAGE
    detail = "检测到尚未确认加载的状态条更新记录。"
    incomplete = (runtime / "plugin-runtime-pending.json").exists()
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("state") not in (None, "pending-sync", "pending-install", "installed"):
            raise ValueError("提醒记录形状或状态无效")
        hashes = data.get("hashes", {})
        if not isinstance(hashes, dict) or any(
                name not in ("inject-main.cjs", "plugin-updater.cjs", "plugin-release.cjs",
                             "plugin-storage.cjs", "quota-client.cjs", "overlay.js", "zusage.py")
                or not isinstance(digest, str) or len(digest) != 64
                or any(char not in "0123456789abcdef" for char in digest)
                for name, digest in hashes.items()):
            raise ValueError("提醒记录 hashes 无效")
        if data.get("state") == "pending-sync" or hashes:
            incomplete = True
            record = json.loads((runtime / "plugin-runtime.json").read_text(encoding="utf-8"))
            complete = (not (runtime / "plugin-runtime-pending.json").exists() and hashes
                        and all(record.get("hashes", {}).get(name) == digest
                                and hashlib.sha256((runtime / name).read_bytes()).hexdigest() == digest
                                for name, digest in hashes.items()))
            incomplete = not complete
            if complete:
                detail = "状态条运行时同步已完成，但客户端尚未确认重新加载。"
        elif data.get("state") in ("pending-install", "installed"):
            # 发布前记录的是意图；仅实际注入为 True 才能解释为安装已完成。
            detail = "状态条注入已完成，但客户端尚未确认重新加载。"
        if data.get("state") == "pending-install" or data.get("installation") is not None:
            published_at = data.get("publishedAt")
            incomplete = incomplete or not (isinstance(published_at, (int, float))
                                            and not isinstance(published_at, bool))
    except FileNotFoundError:
        if not marker.exists():
            return None  # loader 在读取期间完成确认，不重建或补发提醒。
        incomplete = True
    except (OSError, ValueError, AttributeError, TypeError):
        incomplete = True
    if incomplete:
        detail = "状态条运行时同步尚未完成或提醒记录不可验证，不能确认安装成功。"
        message = (PREFIX + "用量状态条的安装或更新还没有完成，或记录无法确认。请运行 "
                   "/install-overlay 重试；仅重启不能保证修复。"
                   "如果仍然失败，请查看插件日志。")
        label = "安装提醒"
    else:
        label = "重启提醒"
        if restart_files:
            message = (PREFIX + "用量状态条已更新，重启 ZCode 后生效。" + RESTART_ACTION +
                       " 更新文件：" + " / ".join(restart_files))
    return {"message": message, "context": visible_context(label, detail, message)}


def reminder_context(runtime=None, injected=None):
    notice = reminder(runtime, injected)
    return notice["context"] if notice else ""


def session_notice(runtime, output, injected=None, restart_files=()):
    """仅展示仍待确认的记录；安装成功后不得重新记录已被 ack 的意图。"""
    notice = reminder(runtime, injected, restart_files)
    if notice:
        output["systemMessage"] = notice["message"]
        output["hookSpecificOutput"] = {
            "hookEventName": "SessionStart", "additionalContext": notice["context"]}
    return output
