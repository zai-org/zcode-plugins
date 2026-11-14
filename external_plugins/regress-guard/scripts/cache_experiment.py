#!/usr/bin/env python3
"""条件 4 配对实验首例：测试缓存命中省时实测（v1.91.0，批 108）。

est_saved_seconds=hits×118 的 118 是编造常数（字段带 est 自嘲）；本脚本换成
真配对协议（顾问三改全采）：①命中侧计时端到端（lookup 全路径=查找+TTL 校验，
即门禁命中时真正做的事）②每对内 miss/hit 顺序交替+非计时预热一次（防顺序/
热偏差），记录负载环境 ③报数组+中位+全距，宣称措辞严格限定
「本仓本树当时，N 对，中位省 X 秒（范围 Y–Z）」。

用法：python3 scripts/cache_experiment.py [--trials 3] [--archive DIR]
档案默认落工作区 .regress/experiments/cache-paired.json；journal 记
experiment_result 事件。重跑即刷新（数字随套件增长过期——解释边界在档）。
"""
import argparse
import json
import os
import statistics
import sys
import tempfile
import time
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "hooks", "scripts", "lib"))


def _archive_dir():
    ws = os.path.dirname(ROOT)  # 插件仓嵌在工作区
    return os.path.join(ws, ".regress", "experiments")


def _env_note():
    try:
        loadavg = [round(x, 2) for x in os.getloadavg()]
    except Exception:
        loadavg = None
    return {"loadavg_at_start": loadavg, "cpu_count": os.cpu_count()}


def run_experiment(trials):
    import test_cache
    from test_runner import run_tests

    key = test_cache.tree_key(ROOT)
    env = _env_note()

    def timed_miss():
        # 不设 RG_TEST_CACHE：run_tests 本就不查缓存（缓存是门禁层的事），
        # 设了反而泄漏进子 pytest 误伤缓存测试（本批活体）
        t0 = time.perf_counter()
        r = run_tests(ROOT, timeout=300)
        return time.perf_counter() - t0, r

    def timed_hit(tmp_regress):
        t0 = time.perf_counter()
        got = test_cache.lookup(ROOT, tmp_regress)
        return time.perf_counter() - t0, got

    miss_times, hit_times = [], []
    with tempfile.TemporaryDirectory(prefix="cache-exp-") as td:
        tmp_regress = os.path.join(td, ".regress")
        os.makedirs(tmp_regress, exist_ok=True)
        # 非计时预热：播种缓存（顾问②——测的是热缓存路径）
        _, r0 = timed_miss()
        assert r0.get("status") == "pass", f"预热跑失败：{r0}"
        test_cache.record(ROOT, tmp_regress, r0)
        for i in range(trials):
            order = "miss_first" if i % 2 == 0 else "hit_first"
            if order == "miss_first":
                tm, r = timed_miss()
                test_cache.record(ROOT, tmp_regress, r)
                th, _ = timed_hit(tmp_regress)
            else:
                th, _ = timed_hit(tmp_regress)
                tm, r = timed_miss()
                test_cache.record(ROOT, tmp_regress, r)
            miss_times.append(round(tm, 1))
            hit_times.append(round(th, 3))
            print(f"  对 {i + 1}/{trials}（{order}）：miss {tm:.1f}s | "
                  f"hit {th:.3f}s", file=sys.stderr)
    deltas = [round(m - h, 1) for m, h in zip(miss_times, hit_times)]
    out = {
        "feature": "test-cache-hit",
        "date": datetime.now().date().isoformat(),
        "trials": trials,
        "tree_key_head": str(key)[:12],
        "suite": r0.get("total"),
        "env": env,
        "miss_s": miss_times, "hit_s": hit_times, "delta_s": deltas,
        "median_delta_s": round(statistics.median(deltas), 1),
        "range_s": [min(deltas), max(deltas)],
        "claim_wording": "本仓本树当时，N 对配对，中位省 {median}s（范围 "
                         "{lo}–{hi}s）——单机单树，数字随套件增长过期",
        "interpretation_boundary": "首例档案非普查；只支撑缓存命中特性的"
                                   "『已证效（本特性范围）』宣称，不泛化到其他特性",
    }
    out["claim_wording"] = out["claim_wording"].format(
        median=out["median_delta_s"], lo=out["range_s"][0], hi=out["range_s"][1])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=3)
    ap.add_argument("--archive", default=None)
    args = ap.parse_args()
    out = run_experiment(args.trials)
    ad = args.archive or _archive_dir()
    os.makedirs(ad, exist_ok=True)
    path = os.path.join(ad, "cache-paired.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    try:
        from journal import journal_append
        journal_append("experiment_result", start_dir=os.path.dirname(
            os.path.dirname(ad)), feature="test-cache-hit",
            median_delta_s=out["median_delta_s"], trials=out["trials"])
    except Exception:
        pass
    print(json.dumps({k: out[k] for k in
                      ("trials", "median_delta_s", "range_s", "claim_wording")},
                     ensure_ascii=False, indent=1))
    print(f"档案：{path}", file=sys.stderr)


if __name__ == "__main__":
    main()
