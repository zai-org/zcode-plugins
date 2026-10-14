#!/usr/bin/env python3
"""jev-sim 聚合器：选票 → 概率分布 → 温度缩放校准 → 决策 JSON。

用法:
  python aggregate.py --input votes.json [--threshold 0.6]

输出带 status 三态：answer（正常决策）/ none（NONE 票占多数，无选项成立）/
clarify（最高概率低于阈值）。choice/score 的 letter 可以是 "NONE"（v0.2 起）。

votes.json 支持三种原语:

choice / score（score 的 options 即量规等级，可加 "values" 数组给每级数值）:
{
  "primitive": "choice",
  "question": "…",
  "options": ["原选项1", "原选项2", "原选项3"],
  "votes": [
    {"rotation": 0, "order": ["原选项1", "原选项2", "原选项3"], "letter": "B"},
    {"rotation": 1, "order": ["原选项2", "原选项3", "原选项1"], "letter": "A"}
  ]
}

noul:
{
  "primitive": "noul",
  "proposition": "…",
  "estimates": [
    {"framing": "positive",  "p_true": 0.85},
    {"framing": "reversed",  "p_true": 0.10},
    {"framing": "evidence",  "p_true": 0.80}
  ]
}
reversed 框架下 p_true 已经是"命题为真"的口径（调用方负责 1-x 反转），这里直接平均。

温度缩放: 若本脚本同目录存在 calibration.json ({"temperature": T})，
choice/score 做 p_cal ∝ p_raw^(1/T)，noul 做二值温度缩放。
"""
import argparse
import json
import math
import os
import sys

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
ALPHA = 0.08  # 平滑系数：计数→概率时混入均匀分布，避免 0/1 硬概率令校准失真
PROTOCOL = "jev-sim/0.2"


def load_temperature():
    cal_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "calibration.json")
    if os.path.exists(cal_path):
        with open(cal_path, encoding="utf-8") as f:
            t = float(json.load(f).get("temperature", 1.0))
            if t > 0:
                return t, True
    return 1.0, False


def temper(probs, t):
    """多项温度缩放 p^(1/T) 后归一化。"""
    if t == 1.0:
        return probs
    raw = [max(p, 1e-12) ** (1.0 / t) for p in probs]
    s = sum(raw)
    return [r / s for r in raw]


def temper_binary(p, t):
    """二值温度缩放。"""
    if t == 1.0:
        return p
    a = max(p, 1e-12) ** (1.0 / t)
    b = max(1.0 - p, 1e-12) ** (1.0 / t)
    return a / (a + b)


def agg_choice(data, threshold, calibrated):
    options = data["options"]
    n = len(options)
    counts = {o: 0 for o in options}
    none_votes = 0
    samples = []
    for v in data["votes"]:
        order = v["order"]
        letter = str(v["letter"]).strip().upper()
        if letter == "NONE":
            none_votes += 1
            samples.append({"rotation": v.get("rotation"), "vote": "NONE"})
            continue
        idx = LETTERS.index(letter)
        picked = order[idx]
        counts[picked] += 1
        samples.append({"rotation": v.get("rotation"), "vote": picked})
    k = len(data["votes"])
    # NONE 作为伪选项进入同一平滑空间竞争（多数票语义）；选项概率在排除 NONE 后重归一报告
    denom = k + ALPHA * (n + 1)
    p_full = [(counts[o] + ALPHA) / denom for o in options]
    p_none = (none_votes + ALPHA) / denom
    t, cal = load_temperature()
    if cal and t != 1.0:
        vec = temper(p_full + [p_none], t)
        p_full, p_none = vec[:-1], vec[-1]
    mass_opt = 1.0 - p_none
    p_cond = [p / mass_opt for p in p_full] if mass_opt > 1e-9 else [1.0 / n] * n
    best = max(range(n), key=lambda i: p_full[i])
    conf = p_cond[best]
    if none_votes > 0 and p_none > p_full[best]:
        status = "none"
    elif conf < threshold:
        status = "clarify"
    else:
        status = "answer"
    out = {
        "primitive": "choice",
        "protocol": PROTOCOL,
        "status": status,
        "question": data.get("question", ""),
        "decision": {
            "type": "choice",
            "choice": None if status == "none" else options[best],
            "none": status == "none",
            "probability": round(conf, 4),
        },
        "probabilities": [
            {"option": o, "probability": round(p, 4)} for o, p in sorted(
                zip(options, p_cond), key=lambda x: -x[1])
        ],
        "none_probability": round(p_none, 4),
        "confidence": round(conf, 4),
        "threshold": threshold,
        "abstained": status != "answer",
        "none_votes": none_votes,
        "n_samples": k,
        "samples": samples,
        "raw_vote_counts": counts,
        "calibrated": calibrated and cal,
        "temperature": t if cal else None,
    }
    if status == "none":
        out["recommendation"] = "NONE 票占多数（%d/%d）：无选项成立，考虑改问题或补选项" % (none_votes, k)
    elif status == "clarify":
        out["recommendation"] = "低于阈值 %.2f，建议人工处理或补充背景后重问" % threshold
    return out


def agg_score(data, threshold, calibrated):
    out = agg_choice(data, 0.0, calibrated)
    out["primitive"] = "score"
    options = data["options"]
    probs = [d["probability"] for d in out["probabilities"]]
    pmap = {d["option"]: d["probability"] for d in out["probabilities"]}
    values = data.get("values", list(range(1, len(options) + 1)))
    vmap = {o: values[i] for i, o in enumerate(options)}
    expected = sum(pmap[o] * vmap[o] for o in options)
    top = out["probabilities"][0]
    out["decision"] = {
        "type": "score",
        "level": None if out["status"] == "none" else top["option"],
        "none": out["status"] == "none",
        "probability": top["probability"],
        "expected_value": round(expected, 3),
    }
    return out


def agg_noul(data, threshold, calibrated):
    ests = [float(e["p_true"]) for e in data["estimates"]]
    p_raw = sum(ests) / len(ests)
    t, cal = load_temperature()
    p_cal = temper_binary(p_raw, t) if cal else p_raw
    abstained = (p_cal < threshold) and (1.0 - p_cal < threshold)
    out = {
        "primitive": "noul",
        "protocol": PROTOCOL,
        "status": "clarify" if abstained else "answer",
        "proposition": data.get("proposition", ""),
        "decision": {
            "type": "noul",
            "holds": p_cal >= 0.5,
            "p_true": round(p_cal, 4),
        },
        "estimates": data["estimates"],
        "confidence": round(max(p_cal, 1 - p_cal), 4),
        "threshold": threshold,
        "abstained": abstained,
        "n_samples": len(ests),
        "calibrated": calibrated and cal,
        "temperature": t if cal else None,
    }
    if abstained:
        out["recommendation"] = "概率落在 [%.2f, %.2f] 灰区，建议人工处理" % (1 - threshold, threshold)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="votes JSON 文件路径，或 '-' 从 stdin 读")
    ap.add_argument("--threshold", type=float, default=0.6, help="弃答阈值，默认 0.6")
    ap.add_argument("--uncalibrated", action="store_true", help="强制不做温度缩放（调试用）")
    args = ap.parse_args()

    raw = sys.stdin.read() if args.input == "-" else open(args.input, encoding="utf-8").read()
    data = json.loads(raw)
    prim = data.get("primitive", "choice")

    if prim == "noul":
        out = agg_noul(data, args.threshold, not args.uncalibrated)
    elif prim == "score":
        out = agg_score(data, args.threshold, not args.uncalibrated)
    else:
        out = agg_choice(data, args.threshold, not args.uncalibrated)

    print(json.dumps(out, ensure_ascii=False, indent=2))
    if not out.get("calibrated"):
        print("注意：未应用校准（无 calibration.json 或被 --uncalibrated 跳过），概率偏自信。", file=sys.stderr)


if __name__ == "__main__":
    main()
