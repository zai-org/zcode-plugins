#!/usr/bin/env python3
"""gate_hook 门禁单测：拦截/放行/自保护/降级/fail-open 路径。

用法: python test/gate_unit_test.py
通过子进程真实调用 hooks/gate_hook.py（stdin 注入载荷，检查 stdout/exit）。
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, os.pardir))
HOOK = os.path.join(ROOT, "hooks", "gate_hook.py")
STATE_DIR = os.path.realpath(os.path.join(os.path.expanduser("~"), ".glm-routing-suite"))
PY = sys.executable

PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print("FAIL:", name, detail)


def run(payload):
    p = subprocess.run([PY, "-X", "utf8", HOOK], input=json.dumps(payload).encode(),
                       capture_output=True, timeout=15)
    out = p.stdout.decode("utf-8", "replace")
    return p.returncode, out, p.stderr.decode("utf-8", "replace")


def deny_of(out):
    try:
        return json.loads(out)["hookSpecificOutput"]["permissionDecision"]
    except (ValueError, KeyError, TypeError):
        return None


def reset_env(mode_state, graded_state):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(os.path.join(STATE_DIR, "state.json"), "w", encoding="utf-8") as f:
        json.dump(mode_state, f)
    with open(os.path.join(STATE_DIR, "graded.json"), "w", encoding="utf-8") as f:
        json.dump(graded_state, f)
    for fn in os.listdir(STATE_DIR):
        if fn.startswith("gate"):
            try:
                os.remove(os.path.join(STATE_DIR, fn))
            except OSError:
                pass


OFF = {"version": 1, "mode": "off"}
W = lambda path: {"tool_name": "Write", "tool_input": {"file_path": path}}
EMPTY_GRADED = {"version": 1, "stage": "off", "star": None, "plan": {"groups": []}}
DEVELOP_GRADED = {"version": 1, "stage": "develop", "star": {"purpose": "x" * 20},
                  "plan": {"groups": [{"title": "A", "spec": "s", "accept": ["x"], "locked": False,
                                       "items": [], "verify": "", "redteam": None, "status": "pending"}]}}
L2EDIT_GRADED = {"version": 1, "stage": "l2-edit", "star": {"purpose": "x" * 20},
                 "plan": {"groups": []}}
SCRATCH = os.path.join(STATE_DIR, "..", "rs-test-scratch.txt")  # 状态目录外

# 1. mode off + 无 graded → 放行无输出
reset_env(OFF, EMPTY_GRADED)
code, out, err = run(W("C:/tmp/normal.txt"))
check("off 放行", code == 0 and out.strip() == "", out)

# 2. graded 规格阶段 → deny + 解锁命令
reset_env({"version": 1, "mode": "graded"}, L2EDIT_GRADED)
code, out, err = run(W(SCRATCH))
d = deny_of(out)
check("规格阶段拦截", code == 0 and d == "deny", out)
check("拒绝理由含解锁命令", "review --decision approve" in out and "graded.py off" in out, out)

# 3. develop 阶段 → 放行
reset_env({"version": 1, "mode": "graded"}, DEVELOP_GRADED)
code, out, err = run(W(SCRATCH))
check("develop 放行", code == 0 and out.strip() == "", out)

# 4. 自保护：写状态文件（即使 mode off，graded 无会话也拦？规则=mode激活或graded活跃）
reset_env({"version": 1, "mode": "discipline"}, EMPTY_GRADED)
code, out, err = run(W(os.path.join(STATE_DIR, "graded.json")))
check("自保护拦状态文件", deny_of(out) == "deny" and "CLI" in out, out)

# 4b. mode off + 无 graded → 状态文件也不拦（全部惰性）
reset_env(OFF, EMPTY_GRADED)
code, out, err = run(W(os.path.join(STATE_DIR, "graded.json")))
check("全惰性时状态文件放行", code == 0 and out.strip() == "", out)

# 4c. 路径穿越变体（.. 与符号形式）仍命中自保护
reset_env({"version": 1, "mode": "graded"}, EMPTY_GRADED)
code, out, err = run(W(os.path.join(STATE_DIR, "..", ".glm-routing-suite", "state.json")))
check("穿越变体仍拦", deny_of(out) == "deny", out)

# 5. 非 gated 工具（Bash）→ 放行
reset_env({"version": 1, "mode": "graded"}, L2EDIT_GRADED)
code, out, err = run({"tool_name": "Bash", "tool_input": {"command": "ls"}})
check("Bash 不拦", code == 0 and out.strip() == "", out)

# 6. 垃圾输入 → fail-open 放行
reset_env({"version": 1, "mode": "graded"}, L2EDIT_GRADED)
p = subprocess.run([PY, "-X", "utf8", HOOK], input=b"not json {{{", capture_output=True, timeout=15)
check("垃圾输入放行", p.returncode == 0 and p.stdout.decode("utf-8", "replace").strip() == "")

# 7. 连续 3 次后降级放行
reset_env({"version": 1, "mode": "graded"}, L2EDIT_GRADED)
for i in range(3):
    code, out, err = run(W(SCRATCH))
check("前三次均拦", deny_of(out) == "deny")
code, out, err = run(W(SCRATCH))
check("第4次降级放行", code == 0 and out.strip() == "" and "降级" in err, "err=" + err)

# 8. 降级后计数重置（第5次恢复拦截）
code, out, err = run(W(SCRATCH))
check("降级后重新计数拦截", deny_of(out) == "deny", out)

# 清理
reset_env(OFF, EMPTY_GRADED)
check("清理完成", True)

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
