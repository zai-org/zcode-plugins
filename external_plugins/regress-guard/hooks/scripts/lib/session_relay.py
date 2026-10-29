#!/usr/bin/env python3
"""session_relay — 会话身份中继（v1.34 清单会话作用域）。

事实基础：PreToolUse/UserPromptSubmit 钩子进程带 CLAUDE_SESSION_ID /
ZCODE_SESSION_ID（活体证据：/tmp/regress-guard-fails-sess_*.jsonl 按会话
分文件），而 Bash 工具进程不带——agent 侧经 Bash 跑的脚本（plan_approve
盖章）无法自证会话身份，只能靠钩子侧中继。

写入点：UserPromptSubmit 每轮（含 / 命令轮——命令轮也是本会话的轮）。
读取点：plan_approve 批准/临行/受阻时给清单盖 session 戳。

last-writer-wins：两会话同项目并发时盖章可能错归属一拍——错向是
「自己的清单被当他人的」（拦截可见可修），不是静默放行（顾问预审认可）。
原子写：临时文件 + rename，防并发写半行（顾问补强点）。
"""
import datetime
import hashlib
import json
import os
import tempfile


def sid_from_env():
    return (
        os.environ.get("CLAUDE_SESSION_ID")
        or os.environ.get("ZCODE_SESSION_ID")
        or ""
    )


def relay_path(project_dir):
    key = hashlib.md5(os.path.abspath(project_dir).encode()).hexdigest()[:8]
    return os.path.join(tempfile.gettempdir(), f"regress-guard-session-{key}.json")


def write_relay(project_dir, sid=None):
    """钩子侧每轮写：当前在该项目说话的会话号。"""
    sid = sid if sid is not None else sid_from_env()
    if not sid:
        return False
    p = relay_path(project_dir)
    try:
        tmp = p + f".tmp{os.getpid()}"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"sid": sid, "ts": datetime.datetime.now().isoformat(
                timespec="seconds")}, f, ensure_ascii=False)
        os.replace(tmp, p)  # 原子：并发 last-writer-wins，不出现半行
        return True
    except (IOError, OSError):
        return False


def read_relay(project_dir):
    """agent 侧读：最近一轮在本项目说话的会话号（缺省空 dict=无中继）。"""
    try:
        with open(relay_path(project_dir), encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (IOError, OSError, json.JSONDecodeError):
        return {}
