#!/usr/bin/env python3
"""UserPromptSubmit hook：用户发送消息时，把截至上一轮的真实用量统计作为
上下文注入，让模型在自己正常回复的末尾顺带附上一行统计。
零额外回合：不使用 Stop 延续，统计行并入模型本回合的回复。

真实 credits 数值无本地 API，以 token 为消耗口径。
"""
import json
import os
import sys
import glob
import time
from datetime import datetime

ROLL_DIR = os.environ.get("ZCODE_ROLLOUT_DIR") or os.path.expanduser(
    "~/.zcode/cli/rollout")
# 状态放版本无关的用户目录，插件升级不重置基准
STATE_DIR = os.path.expanduser("~/.zcode/usage-report-plugin/state")
MARKER = "📊 用量统计"

def find_rollout(sid):
    if sid:
        for cand in (sid, sid if sid.startswith("sess_") else "sess_" + sid):
            p = os.path.join(ROLL_DIR, "model-io-%s.jsonl" % cand)
            if os.path.exists(p):
                return p
    files = sorted(glob.glob(os.path.join(ROLL_DIR, "model-io-*.jsonl")),
                   key=os.path.getmtime, reverse=True)
    return files[0] if files else None

def parse_records(path):
    recs = []
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                u = (obj.get("usage") or
                     (obj.get("response") or {}).get("usage") or {})
                recs.append({
                    "completedAt": obj.get("completedAt"),
                    "durationMs": obj.get("durationMs") or 0,
                    "in": u.get("input_tokens", u.get("inputTokens", 0)) or 0,
                    "out": u.get("output_tokens", u.get("outputTokens", 0)) or 0,
                    "cache": u.get("cache_read_input_tokens",
                                   u.get("cacheReadTokens", 0)) or 0,
                })
    except OSError:
        pass
    return recs

def ts(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None

def fmt_dur(ms):
    s = int(ms // 1000)
    if s < 60:
        return "%ds" % s
    return "%dm%02ds" % (s // 60, s % 60)

def fmt_k(n):
    return "%.1fk" % (n / 1000) if n >= 1000 else str(n)

def stats(rs, label):
    tin = sum(r["in"] for r in rs) + sum(r["cache"] for r in rs)
    tout = sum(r["out"] for r in rs)
    # 纯算：各请求耗时之和（不含轮间空闲）；跨度：最早请求开始 → 最新请求完成的墙钟
    pure = sum(r["durationMs"] for r in rs)
    t0 = ts(rs[0]["completedAt"])
    t0 = (t0 - rs[0]["durationMs"] / 1000.0) if t0 else None
    t1 = ts(rs[-1]["completedAt"])
    span = (t1 - t0) * 1000 if (t0 and t1) else None
    return "%s ↑%s ↓%s ⏱%s/%s" % (label, fmt_k(tin), fmt_k(tout),
                                   fmt_dur(pure),
                                   fmt_dur(span) if span is not None else "?")

def main():
    try:
        json.load(sys.stdin)  # 消费 stdin（内容不依赖）
    except Exception:
        pass

    sid = os.environ.get("ZCODE_SESSION_ID") or os.environ.get("CLAUDE_SESSION_ID") or ""
    path = find_rollout(sid)
    if not path:
        sys.exit(0)
    recs = parse_records(path)

    os.makedirs(STATE_DIR, exist_ok=True)
    state_file = os.path.join(STATE_DIR, "prompt-%s.json" % os.path.basename(path))
    prev = None
    try:
        prev = json.load(open(state_file)).get("count", 0)
    except Exception:
        # 版本升级后新状态目录为空：从旧版本缓存里的状态文件继承基准
        old = sorted(glob.glob(os.path.expanduser(
            "~/.zcode/cli/plugins/cache/*/*/*/.state/prompt-%s.json"
            % os.path.basename(path))), key=os.path.getmtime)
        if old:
            try:
                prev = json.load(open(old[-1])).get("count", 0)
            except Exception:
                prev = None
    if prev is None:
        prev = 0
    json.dump({"count": len(recs), "at": time.time()}, open(state_file, "w"))

    if not recs:
        sys.exit(0)  # 会话首条消息，尚无任何用量，不注入

    # 上轮 = 上次注入以来的新增请求；累计 = 截至当前全部
    last = recs[prev:] if prev < len(recs) else recs[-1:]
    line = "%s｜%s｜%s" % (MARKER, stats(last, "上轮"),
                           stats(recs, "累计"))
    ctx = (
        "【系统统计注入】下面这行数据由系统钩子从本会话真实的模型请求日志"
        "（~/.zcode/cli/rollout/model-io-*.jsonl）自动统计得出（↑=输入tokens "
        "含缓存读，↓=输出tokens，⏱=纯算耗时/墙钟跨度，跨度含轮间空闲），"
        "是系统测量结果，截至上一轮，"
        "真实可靠。请在你本次回复的最末尾，单独一行原样附上它，"
        "不改数字、不加解释：\n" + line
    )
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": ctx,
        }
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
