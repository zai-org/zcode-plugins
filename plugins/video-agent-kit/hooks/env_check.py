#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

from hook_common import plugin_root, project_dir, read_event_line


def doctor_script() -> Path:
    return plugin_root() / "skills" / "setup-guide" / "scripts" / "env_doctor.py"


def _doctor():
    """setup-guide 的体检脚本是依赖清单的唯一来源; 导入失败时回落到下面的内置清单。"""
    script = doctor_script()
    if not script.is_file():
        return None
    if str(script.parent) not in sys.path:
        sys.path.insert(0, str(script.parent))
    try:
        import env_doctor
    except Exception:
        return None
    return env_doctor


def under_zcode() -> bool:
    return bool((os.environ.get("ZCODE_BASE_URL") or os.environ.get("ZCODE_APP_VERSION") or "").strip())


def machine_checked() -> bool:
    """这台电脑跑过体检且基础组通过 (setup-guide 写的本机回执)。"""
    doctor = _doctor()
    if doctor is None:
        return True
    try:
        report = json.loads((doctor.MACHINE_STATE / "env_report.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(report, dict) and bool(report.get("core_ready"))


def check_deps() -> list[str]:
    doctor = _doctor()
    if doctor is not None:
        try:
            return doctor.cheap_missing()
        except Exception:
            pass
    missing: list[str] = []
    for cmd, why in (
        ("python3", "tool and MCP server runtime"),
        ("ffmpeg", "media observation, rendering and audio extraction"),
        ("ffprobe", "media metadata and rendered-output validation"),
    ):
        if shutil.which(cmd) is None:
            missing.append(f"{cmd} ({why})")

    for mod, why in (
        ("mcp", "MCP server SDK"),
        ("requests", "ASR, TTS and creation provider HTTP calls"),
        ("curl_cffi", "video_search / video_download / remote video_observe (site clients)"),
        ("yt_dlp", "video_download and remote metadata for the supported video sites"),
        ("PIL", "visual evidence and subtitle layout"),
        ("numpy", "frame comparison"),
        ("fontTools", "subtitle and title glyph coverage"),
        ("scenedetect", "movie recap shot detection (detect_shots)"),
        ("jieba", "Chinese subtitle line breaking and topic terms"),
    ):
        try:
            __import__(mod)
        except ImportError:
            missing.append(f"python3 import {mod} failed ({why})")
    return missing


def check_asr() -> list[str]:
    """Report ASR availability."""
    lines: list[str] = []
    sys.path.insert(0, str(plugin_root() / "mcp"))
    try:
        from ve_tools.official_auth import zcode_api_origin

        # The signed-in identity only arrives with each tool call, so only the host address is checkable here.
        origin, origin_error = zcode_api_origin()
        lines.append("[video-agent-kit] ASR: ZCode speech recognition via the signed-in account "
                     + (f"({origin})" if origin else f"(unavailable: {origin_error})"))
    except Exception as exc:
        lines.append(f"[video-agent-kit] ASR: asr status check failed: {exc}")
    return lines


def check_tts() -> list[str]:
    lines: list[str] = []
    sys.path.insert(0, str(plugin_root() / "mcp"))
    try:
        from ve_tools.official_auth import zcode_api_origin
        from ve_tools.tts import PRESET_VOICES, tts_config

        # The signed-in identity only arrives with each tool call, so only the host address is checkable here.
        origin, origin_error = zcode_api_origin()
        cfg = tts_config()
        line = (f"[video-agent-kit] TTS: ZCode TTS via the signed-in account, default voice={cfg['voice']} "
                + (f"({origin})" if origin else f"(unavailable: {origin_error})"))
        if cfg["voice"] not in PRESET_VOICES:
            line += f"; VE_TTS_VOICE={cfg['voice']!r} is not a preset voice"
        lines.append(line)
    except Exception as exc:
        lines.append(f"[video-agent-kit] TTS: status check failed: {exc}")
    return lines


def check_creation() -> list[str]:
    lines = []
    try:
        from ve_tools import generators
        from ve_tools.official_auth import zcode_api_origin
        origin, origin_error = zcode_api_origin()
        lines.append("[video-agent-kit] image generation: ZCode image generator via the signed-in account "
                     + (f"({origin})" if origin else f"(unavailable: {origin_error})"))
        prof = generators.profile()
        lines.append(f"[video-agent-kit] video generation: ZCode video generator via the signed-in account, "
                     f"{prof['min_seconds']}-{prof['max_seconds']}s, {prof['default_resolution']} "
                     + (f"({origin})" if origin else f"(unavailable: {origin_error})"))
    except Exception as exc:
        lines.append(f"[video-agent-kit] creation configuration: {exc}")
    try:
        # The face check needs numpy and onnxruntime; a missing core dependency must still
        # leave the diagnostics above on stdout instead of a traceback.
        from ve_tools.faceqc import availability
        face = availability()
        lines.append(f"[video-agent-kit] optional face diagnostics: {'available' if face['ok'] else face['reason']}")
    except Exception as exc:
        lines.append(f"[video-agent-kit] optional face diagnostics: unavailable ({type(exc).__name__}: {exc})")
    try:
        from ve_tools.audio_identity import scorer_status
        lines.append(f"[video-agent-kit] voice-card check: {scorer_status()}")
    except Exception as exc:
        lines.append(f"[video-agent-kit] voice-card check: unavailable ({type(exc).__name__}: {exc})")
    return lines


def main() -> None:
    # 诊断里有中文: Windows 的 cp936/cp1252 控制台编码会让 print 直接抛 UnicodeEncodeError 而丢掉全部输出
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        pass
    read_event_line()   # the SessionStart event's cwd is the project directory
    # The service checks below go through ve_tools.run_context, which knows only
    # VE_PROJECT_DIR and the process cwd; hand it the directory the event named, or a hook
    # started outside the workspace reports the workspace's .env credentials as missing.
    if not (os.environ.get("VE_PROJECT_DIR") or "").strip() or "${" in os.environ["VE_PROJECT_DIR"]:
        os.environ["VE_PROJECT_DIR"] = str(project_dir())
    root = plugin_root()
    lines = [
        # 首行不能以 "[" / "{" 开头: Codex 会把看起来像 JSON 却解析失败的 hook stdout
        # 整段静默丢弃 (0.154.0 实测), Claude Code 则按纯文本注入 —— 两边都用这行开头
        "video-agent-kit environment check:",
        f"[video-agent-kit] plugin_root: {root}",
        f"[video-agent-kit] MCP server: {root / 'mcp' / 'video_edit_server.py'}",
    ]
    recap = root / "recap"
    if recap.is_dir():
        # Movie recap scripts run as python3 -B "$VE_RECAP_DIR/<script>.py"; the host has no
        # session env file, so the skill uses this printed path when the variable is unset.
        current = (os.environ.get("VE_RECAP_DIR") or "").strip() or str(recap)
        lines.append(f"[video-agent-kit] movie recap scripts (VE_RECAP_DIR): {current}")
    # plugin_root 标记写失败 (只读项目目录等) 只是附属品, 绝不能吞掉下面的
    # 全部环境诊断输出
    work = project_dir() / ".video_agent"
    try:
        work.mkdir(parents=True, exist_ok=True)
        (work / "plugin_root").write_text(str(root), encoding="utf-8")
    except OSError as exc:
        lines.append(f"[video-agent-kit] warn: cannot write {work / 'plugin_root'}: {exc}")

    try:
        sys.path.insert(0, str(root / "mcp"))
        from ve_tools.run_context import load_secrets_into_process

        # Credentials live in the root-only secrets file; load them for this check only. The
        # report says configured/unconfigured and never names a variable or a config path.
        load_secrets_into_process()
    except Exception:
        pass
    missing = check_deps()
    script = doctor_script()
    if missing:
        lines.append("[video-agent-kit] missing dependencies: " + "; ".join(missing))
        if script.is_file() and under_zcode():
            lines.append("[video-agent-kit] 环境未就绪：开始任务前先按 setup-guide 技能处理（/setup-guide）。")
        elif script.is_file():
            lines.append(f"[video-agent-kit] check and install with: python3 \"{script}\" --fix")
        else:
            lines.append("[video-agent-kit] install with: python3 -m pip install -r <plugin_root>/requirements.txt"
                         " && python3 -m pip install --no-deps -r <plugin_root>/requirements-nodeps.txt")
    elif under_zcode() and script.is_file() and not machine_checked():
        lines.append("[video-agent-kit] 这台电脑还没有通过环境体检：开始任务前先加载 setup-guide 技能（/setup-guide）检查一遍。")
    lines.extend(check_asr())
    lines.extend(check_tts())
    lines.extend(check_creation())
    if under_zcode():
        lines.append("[video-agent-kit] 外部服务（语音识别、配音、生图、生视频）由平台统一提供：不要让用户申请或填写 API key；"
                     "未接入的功能如实说明暂不可用。")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
