#!/usr/bin/env python3
"""UserPromptSubmit 钩子：按 suite_mode 状态注入（上游"未触发=官方原样"铁律）。

  off（默认）        → 零注入（什么都不打印，纯净官方体验）
  discipline         → 每条用户消息注入一行：任务回显 + 阶段纪律提醒
  graded             → 分级任务协议徽章行（P1'：阶段+当前任务+红队灯）

fail-open：任何异常静默退出 0。状态缺失/损坏按 off 处理。
手动冒烟：
  python ../scripts/suite_mode.py on
  printf '%s' '{"prompt":"帮我修一下登录报错"}' | python hooks/on_prompt.py
  python ../scripts/suite_mode.py off
"""
import json
import os
import sys

_HOOK_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HOOK_DIR, os.pardir, "scripts"))

try:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    import suite_mode as sm
    import router_core as rc

    mode = sm.load_state().get("mode", "off")
    if mode == "off":
        raise SystemExit(0)

    raw = sys.stdin.read()
    prompt = ""
    try:
        data = json.loads(raw) if raw.strip() else {}
        p = data.get("prompt")
        if isinstance(p, list):
            prompt = " ".join(
                x if isinstance(x, str) else (x or {}).get("text", "") for x in p)
        elif isinstance(p, str):
            prompt = p
        elif isinstance(raw, str):
            prompt = raw  # 非 JSON 输入按纯文本处理
    except ValueError:
        prompt = raw

    if not prompt.strip():
        raise SystemExit(0)

    echo = prompt.strip()[:80] + ("…" if len(prompt.strip()) > 80 else "")
    preset = sm.load_state().get("preset", "standard")
    if mode == "graded":
        # P1'：graded 徽章行（阶段+当前唯一任务+红队灯），细节由 graded 状态补充
        print("[glm-routing-suite·graded] ★任务: %s | 规格未定稿前不进入开发；红队未裁不得打卡" % echo)
    elif preset == "spec":
        print(("[glm-routing-suite·spec 深思优先] 先读全上下文、穷尽歧义（两种以上实质不同解读就问）、"
               "长思维链推演后再动手；改前重读文件 | task: %s") % echo)
    elif preset == "react":
        print(("[glm-routing-suite·react 动手优先] 直接写/改代码，产出→验证→修复紧环；"
               "不搭没要的测试脚手架和仪式；交付前过 delivery_check | task: %s") % echo)
    else:
        task_class = rc.task_class_of(prompt)
        task_hint = {"build": "建造类：阶段2开发是重心", "fix": "修复类：阶段0排查是重心"}.get(
            task_class, "先判断 build/fix 再进阶段")
        print(("[glm-routing-suite] 阶段纪律：0了解/对齐→1拟合方案→2开发→3验证，完成信号才晋级，工具使用不跳级；"
               "宣告完成前必须过 delivery_check（%s）| task: %s") % (task_hint, echo))
except SystemExit:
    raise
except Exception:
    pass
sys.exit(0)
