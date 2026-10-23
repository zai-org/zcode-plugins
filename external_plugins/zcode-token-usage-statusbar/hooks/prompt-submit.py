#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""UserPromptSubmit hook：每次用户发消息时
1) 记录"用户最后所处的会话"与提问时间戳到状态文件（--current 守卫依赖该时间戳）
2) 注入上一轮速率作为模型上下文（背景行）
速率统计行已改为确定性渲染（overlay.js 经 renderer 只读桥读取会话状态，完成的 turn
在消息流末尾由前端插入统计行），不再向模型下达"本问统计"指令——模型零配合、零额外
工具调用，回复末尾也不再有模型贴的统计行。
⚙ 面板开关：运行时 config.json 的 answer_rate_line（缺省=开启）；关闭后每次提问
仍记录时刻（守卫数据保持新鲜），且不再注入背景行——下一问即生效，无需重启。
输出只包含 hook 协议字段，诊断不得混入 stdout。
"""
import json
import os
import sys
import threading
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


def emit(ctx):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": ctx,
        }
    }, ensure_ascii=False))


def rate_line_enabled():
    """⚙ 面板开关：运行时 config.json 的 answer_rate_line（缺省=开启）。

    运行时目录与 overlay_install.default_runtime() 同源，含 ZUSAGE_PLUGIN_RUNTIME 测试接缝；
    文件缺失/损坏一律视为开启（开关失效不吞功能）。"""
    runtime = Path(os.environ.get("ZUSAGE_PLUGIN_RUNTIME")
                   or Path.home() / ".zcode" / "zcode-token-usage-statusbar")
    try:
        cfg = json.loads((runtime / "config.json").read_text(encoding="utf-8"))
    except Exception:
        return True
    return not (isinstance(cfg, dict) and cfg.get("answer_rate_line") is False)


def main():
    read_stdin()
    enabled = rate_line_enabled()   # 先判开关：关闭时不再开库查"上轮行"（白查还占锁）
    sid = os.environ.get("ZCODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID") or ""
    try:
        sys.path.insert(0, str(PLUGIN_ROOT))
        import token_rate
        if sid:
            token_rate.write_session_state(sid, "prompt-submit")
        prev = None if not enabled else token_rate.format_line(token_rate.query_latest(sid or None))
    except Exception:
        prev = None
    try:
        from restart_notice import reminder_context
        notice = reminder_context()
    except Exception:
        notice = ""
    try:
        head = (notice + "\n") if notice else ""
        if not enabled:
            emit(head)   # 关：只留重启提醒（若有），不注入背景行、不下达统计指令
            return
        emit(head + "【内部背景·勿展示】上一条回复:" + (prev or "暂无已完成的模型请求"))
    except Exception:
        emit("")


if __name__ == "__main__":
    # Windows 默认（无全局 PYTHONUTF8）下中文输出会按区域编码（GBK 等）写管道，
    # 宿主按 UTF-8 解码 hook stdout 会得到乱码——与 usage_mcp.py 同款防护。
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    main()
