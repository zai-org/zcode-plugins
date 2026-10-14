#!/usr/bin/env python3
"""jev-sim 校准器：拿带标准答案的采样结果拟合温度，写入 calibration.json。

用法:
  python calibrate.py --results results.jsonl [--out calibration.json] [--alpha 0.08]

results.jsonl 每行:
  {"id": "ev01", "correct": "客服-退款", "probs": {"客服-退款": 1.0, "法务": 0.0, ...}}
probs 是 aggregate 前的原始频率概率（计票/K），correct 是正确选项原文。

输出指标:
  accuracy  argmax 命中率
  logloss   原始概率的 NLL
  ece       10 桶校准误差（置信度=最高概率 vs 实际正确率）
  temperature 拟合出的 T（黄金分割最小化平滑 NLL）

拟合前对 probs 做 label smoothing（默认 alpha=0.08），
否则全票通过的正确项会把 T 拉向 0（过锐）。
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def safe_path(root, *parts):
    p = os.path.realpath(os.path.join(root, *parts))
    r = os.path.realpath(root)
    if os.path.commonpath([r, p]) != r:
        raise ValueError("path escapes allowed dir: %s" % p)
    return p


def smooth(probs, alpha):
    items = list(probs.items())
    n = len(items)
    return {k: (1 - alpha) * v + alpha / n for k, v in items}


def nll(items, t):
    """items: [(probs_dict, correct)]，温度 t 下的平滑 NLL。"""
    total = 0.0
    for probs, correct in items:
        raw = [max(p, 1e-12) ** (1.0 / t) for p in probs.values()]
        s = sum(raw)
        pc = 0.0
        for (k, _), r in zip(probs.items(), raw):
            if k == correct:
                pc = r / s
                break
        total += -math.log(max(pc, 1e-12))
    return total / len(items)


def ece(items):
    """10 桶 ECE，按最高概率分桶。"""
    buckets = [[] for _ in range(10)]
    for probs, correct in items:
        conf = max(probs.values())
        hit = 1.0 if max(probs, key=probs.get) == correct else 0.0
        buckets[min(int(conf * 10), 9)].append((conf, hit))
    n = len(items)
    return sum(len(b) / n * abs(sum(h for _, h in b) / len(b) - sum(c for c, _ in b) / len(b))
               for b in buckets if b)


def golden_section(f, lo, hi, tol=1e-5):
    gr = (math.sqrt(5) - 1) / 2
    a, b = lo, hi
    while abs(b - a) > tol:
        c = b - gr * (b - a)
        d = a + gr * (b - a)
        if f(c) < f(d):
            b = d
        else:
            a = c
    return (a + b) / 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--alpha", type=float, default=0.08)
    args = ap.parse_args()

    items = []
    with open(args.results, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            r = json.loads(line)
            items.append((smooth(r["probs"], args.alpha), r["correct"]))

    acc = sum(1 for p, c in items if max(p, key=p.get) == c) / len(items)
    raw_items = [(p, c) for p, c in items]  # 已平滑
    e_before = ece(raw_items)
    t_fit = golden_section(lambda t: nll(items, t), 0.05, 20.0)
    e_after = ece([(temper_all(p, t_fit), c) for p, c in items])

    out_path = safe_path(SCRIPT_DIR, "calibration.json") if args.out is None else safe_path(os.getcwd(), args.out)
    result = {
        "temperature": round(t_fit, 4),
        "fitted_at": datetime.now().isoformat(timespec="seconds"),
        "n_items": len(items),
        "accuracy": round(acc, 4),
        "ece_before": round(e_before, 4),
        "ece_after": round(e_after, 4),
        "smoothing_alpha": args.alpha,
    }
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if acc == 1.0:
        print("警告：全部答对，温度拟合意义有限——评测集太简单，请加更有区分度的题。", file=sys.stderr)


def temper_all(probs, t):
    raw = [max(p, 1e-12) ** (1.0 / t) for p in probs.values()]
    s = sum(raw)
    return {k: r / s for r, (k, _) in zip(raw, probs.items())}


if __name__ == "__main__":
    main()
