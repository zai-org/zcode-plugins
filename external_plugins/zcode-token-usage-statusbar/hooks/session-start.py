#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SessionStart hook：stdin 收 hook 入参 JSON，stdout 只输出 hook 协议 JSON。

职责（由 overlay_install.run_hook 承担，见其 docstring）：
  同步运行时文件（热更新）；未注入即自动安装（恒开，v172 起无开关）；待重启/待更新
  不再注入会话文字，由 ⚙ 齿轮红点承载（plugin-updater 推送 markerAt 代际）。
任何异常都转成合法 JSON 输出，绝不抛出、绝不影响会话。
"""
import json
import os
import sys
import threading
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent


def read_stdin(timeout_s=2.0):
    """消费 stdin（协议要求），设超时兜底：客户端不给 EOF 也不挂起。内容不使用。"""
    result = {"raw": ""}

    def pump():
        try:
            result["raw"] = sys.stdin.read()
        except Exception:
            pass

    t = threading.Thread(target=pump, daemon=True)
    t.start()
    t.join(timeout_s)
    return result["raw"]


def main():
    raw = read_stdin()
    try:
        payload = json.loads(raw or "{}")
    except ValueError:
        payload = {}
    # 启动策略按 agent 分流：本 hook 只会做 ZCode 的事（同步运行目录、检查/修复 asar 注入）。
    # 装到 WorkBuddy 等其它宿主时必须在动手前退出——那些客户端没有 asar 注入链，
    # 更不能被改程序文件；它们的浮层由 MCP 进程按策略拉起（CDP）。
    try:
        sys.path.insert(0, str(PLUGIN_ROOT))
        import zusage
        agent = zusage.detect_agent()
        if agent != zusage.AGENT_ZCODE:
            print(json.dumps({"suppressOutput": True}, ensure_ascii=False))
            return
    except Exception as e:  # noqa: BLE001 — 判定失败按 ZCode 老路径继续，绝不能挡会话
        print(f"[zusage-plugin] agent 判定失败，按 ZCode 继续：{e}", file=sys.stderr)
    try:  # 记录会话启动时刻到速率状态文件（token_rate --current 守卫的会话跟随依据）
        sid = os.environ.get("ZCODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID")
        if sid:
            sys.path.insert(0, str(PLUGIN_ROOT))
            import token_rate
            token_rate.write_session_state(sid, "session-start")
    except Exception:  # noqa: BLE001 — 状态文件写不进去就跳过，不影响主职责
        pass
    try:
        sys.path.insert(0, str(PLUGIN_ROOT))
        import overlay_install
        result = overlay_install.run_hook()
    except Exception as e:  # noqa: BLE001 — hook 绝不能抛
        message = f"zusage 插件自检失败（已忽略）：{e}"
        result = {"suppressOutput": True}
        try:
            runtime = Path(os.environ.get("ZUSAGE_PLUGIN_RUNTIME") or Path.home() / ".zcode/zcode-token-usage-statusbar")
            (runtime / ".plugin-overlay-optout").stat()
            opted_out = True
        except FileNotFoundError:
            opted_out = False
        except (OSError, RuntimeError):
            opted_out = True
        if opted_out:
            print("[zusage-plugin] " + message, file=sys.stderr)
        else:
            result.update(systemMessage=message, hookSpecificOutput={
                "hookEventName": "SessionStart", "additionalContext": message})
    try:
        runtime = Path(os.environ.get("ZUSAGE_PLUGIN_RUNTIME") or Path.home() / ".zcode/zcode-token-usage-statusbar")
        record = {"time": time.time(), "pluginRoot": str(PLUGIN_ROOT),
                  "source": payload.get("source", "") if isinstance(payload, dict) else "",
                  "sessionId": os.environ.get("ZCODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID") or "",
                  "result": result}
        try:   # run_hook 的兼容性诊断（宿主 build × 已装版本 × 桥状态，issue #247）：排障不再只有「补丁已排定」
            import overlay_install as _overlay_install
            diag = getattr(_overlay_install, "LAST_DIAG", None)
            if isinstance(diag, dict):
                record["host"] = diag
        except Exception:
            pass
        overlay_install._atomic_write(runtime / "plugin-session-start.json",
                                     json.dumps(record, ensure_ascii=False, indent=2).encode("utf-8"))
    except Exception as e:
        print(f"[zusage-plugin] 会话启动诊断写入失败：{e}", file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    # Windows 默认（无全局 PYTHONUTF8）下中文输出会按区域编码（GBK 等）写管道，
    # 宿主按 UTF-8 解码 hook stdout 会得到乱码——与 usage_mcp.py 同款防护。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    main()
