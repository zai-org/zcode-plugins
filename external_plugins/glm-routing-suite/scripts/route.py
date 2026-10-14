#!/usr/bin/env python3
"""glm-routing-suite 路由 CLI：任务文本 → 模式路由 JSON。

用法:
  python route.py --text "帮我修一下登录报错"
  echo "写一个贪吃蛇游戏" | python route.py
  python route.py --text "..." --model glm-5.3-flash
  python route.py --text "..." --mode react        # 显式覆盖，不走分类

输出一行 JSON（stdout，UTF-8）。零文件写入、零网络、零第三方依赖。
"""
import argparse
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import router_core as rc


def style_hint(band, complex_task):
    if band == "react":
        base = "动手派：直接写/改代码，产出→验证→修复紧环；不搭用户没要的测试脚手架和仪式"
    elif band == "spec":
        base = "计划派：先排查定位、读代码再动手；改完验证"
    elif band == "mixed":
        base = "过渡带（上游实测不稳定区，仅显式选择时使用）：偏直接动手但保留计划"
    else:
        base = "自路由：先判断任务类型——build→动手生产 / fix→先排查再计划"
    if complex_task:
        base += "；任务复杂：先深入探索再动工"
    return base


def anchor_list(band, model_id):
    if band == "weak" and rc.is_flash_model(model_id):
        return [
            "回顾：动工前回顾本会话已完成的步骤，从断点继续，不重复",
            "收敛：聚焦当前单任务，先深想后产出",
            "反跑题：不做环境自检（echo/whoami/uname/版本号）和穷举式 grep/glob 扫描",
        ]
    return []


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", default=None, help="任务文本；缺省从 stdin 读")
    ap.add_argument("--model", default=None, help="模型 id（影响 weak persona 选择）")
    ap.add_argument("--mode", default=None, help="显式模式：spec/mixed/react/weak/auto 或 0-100")
    args = ap.parse_args()

    text = args.text
    if text is None:
        text = sys.stdin.read()

    if args.mode is not None:
        mode = rc.parse_mode(args.mode)
        if mode is None:
            print(json.dumps({"error": "无法解析 --mode：%r" % args.mode}, ensure_ascii=False))
            sys.exit(1)
        if mode in ("auto",):
            mode = rc.classify_task(text)
    else:
        mode = rc.classify_task(text)

    band = rc.band_for(mode)
    complex_task = rc.is_complex_task(text)
    out = {
        "source": "glm-routing-suite/0.4.0 (port of yjh051108/dsh-routing-suite, MIT)",
        "task_class": rc.task_class_of(text) if args.mode is None else "override",
        "mode": mode,
        "band": band,
        "persona": rc.persona_for(mode, args.model or ""),
        "style": style_hint(band, complex_task),
        "core_tools": rc.core_for(mode),
        "testiness": rc.testiness_for(mode),
        "complex": complex_task,
        "anchors": anchor_list(band, args.model or ""),
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
