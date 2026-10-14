#!/usr/bin/env python3
"""suite_mode：glm-routing-suite 运行模式开关（上游"未触发=官方原样"铁律的落地）。

状态文件 ~/.glm-routing-suite/state.json：
  {"version": 2, "mode": "off"|"discipline"|"graded",
   "preset": "standard"|"spec"|"react", "updated_at": "..."}

  mode（是否注入）：
    off        默认。零注入、零拦截、零额外交互——插件只提供 SKILL 协议与 CLI。
    discipline 开启每消息一行的阶段纪律提醒（UserPromptSubmit 钩子注入）。
    graded     分级任务协议激活态（commit_star 定稿后自动进入）。

  preset（纪律的风格档，P4 变体预设；对应上游 router-standard/spec/react 三预设）：
    standard 标准：按任务分类自动选侧重（build→动手 / fix→先查）
    spec     深思优先：读全上下文、穷尽歧义、长思维链后再动手（上游 router-spec）
    react    动手优先：直接写/改，产出→验证→修复紧环，不搭没要的脚手架（上游 router-react）

用法：
  python suite_mode.py status
  python suite_mode.py on                       # → discipline + standard
  python suite_mode.py on --mode graded
  python suite_mode.py on --preset spec         # 深思优先
  python suite_mode.py preset react             # 只换风格档，不动 mode
  python suite_mode.py off

原子写（temp+rename）；状态缺失/损坏一律按 off/standard 处理（fail-open）。
"""
import argparse
import json
import os
import sys
import tempfile
from datetime import datetime

STATE_DIR = os.path.join(os.path.expanduser("~"), ".glm-routing-suite")
MODES = ("off", "discipline", "graded")
PRESETS = ("standard", "spec", "react")


def safe_path(root, *parts):
    p = os.path.realpath(os.path.join(root, *parts))
    r = os.path.realpath(root)
    if os.path.commonpath([r, p]) != r:
        raise ValueError("path escapes allowed dir: %s" % p)
    return p


def load_state():
    try:
        with open(safe_path(STATE_DIR, "state.json"), encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict) and d.get("mode") in MODES:
            if d.get("preset") not in PRESETS:
                d["preset"] = "standard"
            return d
    except (OSError, ValueError):
        pass
    return {"version": 2, "mode": "off", "preset": "standard"}


def save_state(mode, preset="standard"):
    state = {"version": 2, "mode": mode, "preset": preset if preset in PRESETS else "standard",
             "updated_at": datetime.now().isoformat(timespec="seconds")}
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp_fd, tmp_name = tempfile.mkstemp(dir=STATE_DIR, prefix="state-", suffix=".tmp")
    final = safe_path(STATE_DIR, "state.json")
    if final:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp_name, final)
    return state


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["status", "on", "off", "preset"])
    ap.add_argument("value", nargs="?", default=None, help="preset 动作的档位值：standard|spec|react")
    ap.add_argument("--mode", default="discipline", choices=["discipline", "graded"])
    ap.add_argument("--preset", default="standard", choices=list(PRESETS))
    args = ap.parse_args()

    if args.action == "status":
        print(json.dumps(load_state(), ensure_ascii=False))
        return
    if args.action == "preset":
        cur = load_state()
        target = args.value or args.preset
        if target not in PRESETS:
            print(json.dumps({"error": "未知档位：%s（standard|spec|react）" % target}, ensure_ascii=False))
            sys.exit(1)
        print(json.dumps(save_state(cur.get("mode", "off"), target), ensure_ascii=False))
        return
    if args.action == "off":
        print(json.dumps(save_state("off", load_state().get("preset", "standard")), ensure_ascii=False))
        return
    print(json.dumps(save_state(args.mode, args.preset), ensure_ascii=False))


if __name__ == "__main__":
    main()
