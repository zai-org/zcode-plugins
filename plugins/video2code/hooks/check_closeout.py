#!/usr/bin/env python3
"""Stop: 收尾契约检查 — 调用 skills/video2code/scripts/contract_audit.py 的
同一份规则 (单点, 防两份实现漂移)。

规则内容见 contract_audit.py 模块注释 (C1 覆盖率 / C2 report 已填 /
C3 D 项成对证据在 out/cmp/ / C4 证据归属含 id / C5 新鲜度联看口径 /
C6 锚点新鲜度 / C7 pass 行无 fix 残留)。
本 hook 是兜底: SKILL §4.6 要求模型收尾前先自己跑同一脚本自查补完,
这里只拦"忘了自查"的情形 — 触发率应趋近 0, 每次拦截记
.v2c/hook_state/interceptions.jsonl 供后续分析分层。

放行 (allow) 的全部情形, 按判定顺序:
- `V2C_NO_CLOSEOUT_HOOK=1`        → 用户或批量运行显式关掉本 hook;
- out/plan.md 不存在              → 该工作区没进入契约流程;
- 无缺口                          → 契约闭环;
- .v2c/contract_abandoned 存在    → 用户显式放弃该契约 (出口, 见 hook_common);
- 契约归属别的会话                → 别人的任务, 只提示不强制;
- 契约无归属 (遗留/未认领)        → 不强制 (防止把遗留任务塞给无关会话);
- 本会话被本规则拦满 BUDGET 次    → session_budget 用尽, 对该会话永久放行;
- stop_hook_active 或 strike 三振 → 原有防死循环阀门。

**契约是会话的义务, 不是工作区的义务**: 归属由 check_plan_first.py 在写
out/plan.md 或 app/src/** 时认领 (hook_common.claim_contract)。缺这层归属时, 一个被
放弃的契约会拦住之后在该工作区打开的每一个会话 (哪怕做的是无关任务); 而多会话互改
源码又会让证据反复过期, 审计在"全绿 → 再变红"之间震荡、strike 被 clear_strike 反复
归零, 于是回合永远收不掉 —— session_budget 是这一条的兜底上限。
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hook_common import (read_stdin_json, project_dir, state_dir, strike,  # noqa: E402
                         clear_strike, block_stop, allow, allow_with_note,
                         session_budget, read_contract_owner, contract_abandoned,
                         ABANDON_NAME)

RULE = "closeout"
BUDGET = 3          # 同一会话被本规则拦满这么多次后永久放行
_OFF_VALUES = {"", "0", "false", "no", "off"}


def _load_audit():
    """import 同插件内的 contract_audit 模块 (hooks/ 与 skills/ 平级)。"""
    p = (Path(__file__).resolve().parents[1]
         / "skills" / "video2code" / "scripts" / "contract_audit.py")
    spec = importlib.util.spec_from_file_location("contract_audit", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _log(kind: str, payload: dict) -> None:
    """拦截/放行留痕。kind 分层让审查者看得见"契约无归属/被放弃"这类本该为零的情形。"""
    try:
        with (state_dir() / "interceptions.jsonl").open("a") as f:
            f.write(json.dumps({"rule": RULE, "kind": kind,
                                "t": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                **payload}, ensure_ascii=False) + "\n")
    except OSError:
        pass


def main() -> None:
    data = read_stdin_json()
    sid = str(data.get("session_id") or "").strip()
    pd = project_dir()

    if str(os.environ.get("V2C_NO_CLOSEOUT_HOOK", "")).strip().lower() not in _OFF_VALUES:
        _log("released_env_off", {"sid": sid})
        allow()

    try:
        ca = _load_audit()
        res = ca.audit(pd)
    except Exception as e:  # noqa: BLE001 — 审计自身出错不能楔死会话
        print(f"[check_closeout] 审计模块异常, 放行: {e}", file=sys.stderr)
        allow()

    if res.get("not_applicable"):
        allow()  # 非复刻任务 (没进入契约流程), 不归本 hook 管
    if not res["gaps"]:
        clear_strike(RULE)
        allow()

    n_gaps = len(res["gaps"])

    # 出口 1: 用户显式放弃 — 助手在用户说"不做这个"时可以合法走到这一步
    ab = contract_abandoned()
    if ab is not None:
        _log("released_abandoned", {"sid": sid, "n_gaps": n_gaps, "reason": ab})
        allow_with_note(
            f"video2code: 工作区存在未闭环的复刻契约 ({n_gaps} 个缺口), 但 "
            f".v2c/{ABANDON_NAME} 已声明放弃 — 不强制收尾。"
            + (f" 放弃原因: {ab}" if ab else ""))

    # 出口 2/3: 契约归属别的会话, 或压根没有归属 (遗留任务) → 不强制继承
    owner = read_contract_owner()
    owner_sid = str(owner.get("session_id") or "").strip()
    if owner_sid and sid and owner_sid != sid:
        _log("released_not_owner", {"sid": sid, "owner": owner_sid, "n_gaps": n_gaps})
        allow_with_note(
            f"video2code: 工作区里有未闭环的复刻契约 ({n_gaps} 个缺口), 归属会话 "
            f"{owner_sid[:8]}… (认领于 {owner.get('t') or '?'}), 不是本会话 — 不强制本会话"
            "收尾。若确实要在本会话接手, 编辑 out/plan.md 或 app/src/** 即自动接管归属。")
    if not owner_sid:
        _log("released_unowned", {"sid": sid, "n_gaps": n_gaps})
        allow_with_note(
            f"video2code: 工作区里有未闭环的复刻契约 ({n_gaps} 个缺口), 但没有任何会话认领"
            " (多为已放弃的遗留任务) — 不强制本会话收尾。要接手就编辑 out/plan.md 或 "
            f"app/src/**; 确认不做可写 .v2c/{ABANDON_NAME} 以后不再提示。")

    # 到这里: 契约确是本会话认领的, 且确有缺口 → 该拦
    _log("blocked", {"sid": sid, "n_gaps": n_gaps, "gaps": res["gaps"][:12]})

    n_sess, exhausted = session_budget(RULE, sid, limit=BUDGET)
    n, released = strike(RULE)
    if exhausted or released or data.get("stop_hook_active"):
        _log("released_valve", {"sid": sid, "n_sess": n_sess, "strikes": n,
                                "exhausted": exhausted, "released": released,
                                "stop_hook_active": bool(data.get("stop_hook_active"))})
        allow()  # 三振/会话预算用尽/已顶回过 → 放行并已记录, 防死循环
    block_stop(
        "复刻契约未闭环, 不能收尾:\n- " + "\n- ".join(res["gaps"]) +
        "\n先自己跑审计脚本对账: node \"<plugin_root>/hooks/run_python.mjs\" "
        "\"<plugin_root>/skills/video2code/scripts/contract_audit.py\" "
        "(plugin_root 见会话开头横幅, 兜底 cat .v2c/plugin_root), "
        "按缺口逐条补完 (D 项成对证据用 composite_view 的 beats 视频输入一轮即出), "
        "全绿后再收尾。\n"
        "若用户本轮要的其实不是这个复刻任务 (契约是本会话早前认领的, 但用户已经转去别的事, "
        f"或明确说了不做): 先把这 {n_gaps} 个缺口一句话告诉用户并问要不要收尾 —— 用户说不做, "
        f"就写 .v2c/{ABANDON_NAME} (一行原因) 后正常收尾, 不要闷头替他做完; 用户说继续, "
        "再按上面补完。"
        f" (本规则第 {n}/3 次拦截; 本会话累计 {n_sess}/{BUDGET}, 用尽后不再拦)")


if __name__ == "__main__":
    main()
