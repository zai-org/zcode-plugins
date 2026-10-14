#!/usr/bin/env python3
"""PreToolUse 软门禁（P2）：分级协议的规格阶段拦截 write/edit + 状态文件自保护。

协议（与 ZCode/Mimosa 实证格式一致）：
  允许   → 退出 0，无输出
  拦截   → 退出 0 + stdout JSON：
           {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                                    "permissionDecision": "deny",
                                    "permissionDecisionReason": "..."}}

门禁语义（九评审修订版）：
  1. 自保护（分级/提醒激活时）：Write/Edit/MultiEdit 指向 ~/.glm-routing-suite/ 状态文件
     一律拒——状态仅 CLI 进程可写，防提示注入篡改门禁（安全评审 #b）
  2. 阶段门（仅 graded 会话激活且 stage ∈ {brainstorm, l1-edit, l2-edit, review}）：
     拦 write/edit，理由附解锁命令
  3. 降级：连续拦 3 次（10 分钟窗口内）自动降级为警告放行，防误伤卡死（架构评审）
  4. fail-open：任何异常/超时/解析失败 → 静默放行（与 Mimosa 的 fail-closed 相反，
     本门禁是纪律工具不是安全边界，宁可放过不可卡死）

手动冒烟：
  printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"C:/x/y.txt"}}' | python hooks/gate_hook.py
"""
import json
import os
import sys
import time
from datetime import datetime

_HOOK_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HOOK_DIR, os.pardir, "scripts"))

STATE_DIR = os.path.realpath(os.path.join(os.path.expanduser("~"), ".glm-routing-suite"))
GATE_BLOCK_LIMIT = 3
GATE_WINDOW_S = 600

PRE_DEV_STAGES = ("brainstorm", "l1-edit", "l2-edit", "review")
GATED_TOOLS = {"Edit", "Write", "MultiEdit"}


def _deny(reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}, ensure_ascii=False))
    sys.exit(0)


def _safe_path_in_state_dir(path):
    try:
        p = os.path.realpath(path)
        return os.path.commonpath([STATE_DIR, p]) == STATE_DIR
    except (OSError, ValueError):
        return False


def _load_gate_counter():
    try:
        with open(os.path.join(STATE_DIR, "gate.json"), encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict) and time.time() - float(d.get("at", 0)) < GATE_WINDOW_S:
            return int(d.get("blocks", 0))
    except (OSError, ValueError, TypeError):
        pass
    return 0


def _save_gate_counter(n):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        tmp = os.path.join(STATE_DIR, "gate-%d.tmp" % int(time.time() * 1000))
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"blocks": n, "at": time.time()}, f)
        os.replace(tmp, os.path.join(STATE_DIR, "gate.json"))
    except OSError:
        pass


def main():
    try:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        tool = str(data.get("tool_name") or data.get("toolName") or "")
        if tool not in GATED_TOOLS:
            return  # matcher 已过滤，双保险

        file_path = str((data.get("tool_input") or data.get("toolInput") or {})
                        .get("file_path") or "")

        import suite_mode as sm
        import graded as gr

        mode = sm.load_state().get("mode", "off")
        gstate = gr.load_state()
        graded_active = gstate.get("stage") not in (None, "off")

        # 1) 自保护：状态文件仅 CLI 可写（mode 激活或 graded 会话存在时）
        if (mode != "off" or graded_active) and file_path and _safe_path_in_state_dir(file_path):
            _deny("[glm-routing-suite] 状态文件仅 CLI 进程可写（防篡改门禁）：请用 "
                  "suite_mode.py / graded.py 子命令操作状态，不要直接编辑 %s" % file_path)

        # 2) 阶段门：分级会话的规格阶段扣住 write/edit
        if graded_active and gstate["stage"] in PRE_DEV_STAGES:
            blocks = _load_gate_counter()
            if blocks >= GATE_BLOCK_LIMIT:
                _save_gate_counter(0)  # 降级后重置
                sys.stderr.write("[glm-routing-suite] 门禁已连续拦 %d 次，自动降级为警告放行"
                                 "（防误伤）\n" % blocks)
                return
            _save_gate_counter(blocks + 1)
            _deny("[glm-routing-suite·graded] 阶段=%s：规格未审核通过，write/edit 暂扣。"
                  "解锁：完成规格后跑 `python graded.py review --decision approve`；"
                  "或 `python graded.py off` 退出分级模式" % gstate["stage"])

        # 通过（develop/final 或未激活）→ 重置计数
        _save_gate_counter(0)
    except SystemExit:
        raise
    except Exception:
        pass  # fail-open
    sys.exit(0)


if __name__ == "__main__":
    main()
