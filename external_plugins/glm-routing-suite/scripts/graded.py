#!/usr/bin/env python3
"""graded：分级任务协议状态机（上游 dsh-graded-mode Apache-2.0 的语义移植，CLI 形态）。

七步链：脑暴定稿(commit_star) → L1 大类规格(edit_plan --level 1) → 锁定(lock_stage 1)
→ L2 小类规格(edit_plan --level 2) → 锁定(lock_stage 2) → 审核(review) → 开发打卡
(mark_task / redteam_verdict / revise_do) → 终验(final → delivery_check)。

阶段机：off → brainstorm → l1-edit → l2-edit → review → develop → final

门控语义（忠实上游）：
  - 拒绝=状态不变（校验失败不落盘）
  - 规格全必填（L1: title/spec/accept[]；L2: title/spec/accept[]/do/verify，concept 可选）
  - 已锁大类必须保留，不可新增/改名
  - mark_task 仅 develop/final；verify=redteam 且未裁决通过不得打卡（再审批铁律）
  - L1 completed 需组内小类全部 completed；in_progress 单线聚焦（同组其它复位）
  - commit_star 的 purpose ≥12 字、不得照抄任务原文；develop/final 阶段星象只读
  - revise_do 只改 do 并登记轨迹；verify 只读

状态文件 ~/.glm-routing-suite/graded.json（原子写；损坏=按无会话处理）。
默认回执=摘要（状态+下一步），--verbose 给完整规格单。
"""
import argparse
import json
import os
import sys
import tempfile
from datetime import datetime

STATE_DIR = os.path.join(os.path.expanduser("~"), ".glm-routing-suite")
STAGES = ["off", "brainstorm", "l1-edit", "l2-edit", "review", "develop", "final"]
MODES = ("correct", "experience", "research")
VERIFY_SPECIAL = "redteam"


def safe_path(root, *parts):
    p = os.path.realpath(os.path.join(root, *parts))
    r = os.path.realpath(root)
    if os.path.commonpath([r, p]) != r:
        raise ValueError("path escapes allowed dir: %s" % p)
    return p


def _now():
    return datetime.now().isoformat(timespec="seconds")


def init_state():
    return {"version": 1, "stage": "off", "star": None, "plan": {"groups": []},
            "review": None, "trail": [], "updated_at": _now()}


def load_state():
    try:
        with open(safe_path(STATE_DIR, "graded.json"), encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict) and d.get("stage") in STAGES:
            return d
    except (OSError, ValueError):
        pass
    return init_state()


def save_state(state):
    state["updated_at"] = _now()
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp_fd, tmp_name = tempfile.mkstemp(dir=STATE_DIR, prefix="graded-", suffix=".tmp")
    final = safe_path(STATE_DIR, "graded.json")
    if final:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp_name, final)
    return state


# ---------- 校验（拒绝=状态不变） ----------

def _strs(a):
    if isinstance(a, list):
        return [str(x).strip() for x in a if str(x).strip()]
    return []


def assert_l1(items):
    if not isinstance(items, list) or not items:
        return "大类列表为空：至少一个 L1 大类"
    titles = [str(it.get("title") or "").strip() for it in items]
    if any(not t for t in titles):
        return "存在空的大类名"
    if len(set(titles)) != len(titles):
        return "大类名重复：%s" % next(t for t in titles if titles.count(t) > 1)
    for it in items:
        if not str(it.get("spec") or "").strip():
            return "大类「%s」缺 spec（必须写清做什么）" % it.get("title")
        if not _strs(it.get("accept")):
            return "大类「%s」缺 accept（验收标准至少一条）" % it.get("title")
    return None


def assert_l2(groups, locked_titles):
    if not isinstance(groups, list) or not groups:
        return "小类树为空：至少一组"
    g_titles = [str(g.get("title") or "").strip() for g in groups]
    if any(not t for t in g_titles):
        return "存在空的大类名"
    if len(set(g_titles)) != len(g_titles):
        return "大类名重复：%s" % next(t for t in g_titles if g_titles.count(t) > 1)
    if locked_titles:
        missing = [t for t in locked_titles if t not in g_titles]
        if missing:
            return "小类编辑必须保留已锁定的大类：缺少 %s" % "、".join(missing)
        extra = [t for t in g_titles if t not in locked_titles]
        if extra:
            return "小类编辑不能新增/改名大类：%s（大类已锁定）" % "、".join(extra)
    for g in groups:
        items = g.get("items") or []
        if not items:
            return "大类「%s」下没有小类" % g.get("title")
        i_titles = [str(it.get("title") or "").strip() for it in items]
        if any(not t for t in i_titles):
            return "大类「%s」下存在空的小类名" % g.get("title")
        if len(set(i_titles)) != len(i_titles):
            return "大类「%s」下小类名重复：%s" % (g.get("title"), next(t for t in i_titles if i_titles.count(t) > 1))
        for it in items:
            t = it.get("title")
            for field, desc in (("spec", "规格"), ("do", "执行形态"), ("verify", "验证方式")):
                if not str(it.get(field) or "").strip():
                    return "小类「%s」缺 %s（全必填门控：写清楚再锁定）" % (t, field)
            if not _strs(it.get("accept")):
                return "小类「%s」缺 accept（验收标准至少一条）" % t
            m = str(it.get("mode") or "").strip()
            if m and m not in MODES:
                return "小类「%s」mode 非法：%s（correct/experience/research）" % (t, m)
    return None


# ---------- 命令语义 ----------

def cmd_commit_star(state, args):
    p = str(getattr(args, "purpose", "") or "").strip()
    if state["stage"] in ("develop", "final") and state.get("star"):
        return None, "开发/终验阶段星象只读（北极星已入规约）"
    if len(p) < 12:
        return None, "purpose 过短（<12 字）：请给出「为谁/处境/价值/结果」句式的目的宣言，而非口号"
    task = str((state.get("star") or {}).get("task") or "").strip()
    if task and (p == task or task in p):
        return None, "purpose 不得机械照抄任务原文：须重新表述"
    star = {"purpose": p, "requirements": _strs(getattr(args, "requirements", None)),
            "non_goals": _strs(getattr(args, "non_goals", None)),
            "assumptions": _strs(getattr(args, "assumptions", None))}
    mode = getattr(args, "mode", None)
    if mode:
        if mode not in MODES:
            return None, "mode 非法：%s（correct/experience/research）" % mode
        star["mode"] = mode
    if state["stage"] == "off":
        state["stage"] = "brainstorm"
    state["star"] = star
    return state, "★北极星定稿：%s\n下一步：edit_plan --level 1 拟大类规格（title/spec/accept[]）" % p


def _read_plan(args):
    plan = getattr(args, "plan", None)
    if plan and plan != "-":
        with open(plan, encoding="utf-8") as f:
            return json.load(f)
    return json.loads(sys.stdin.read())


def cmd_edit_plan(state, args):
    data = _read_plan(args)
    if getattr(args, "level", 0) == 1:
        if state["stage"] not in ("brainstorm", "l1-edit"):
            return None, "当前阶段 %s 不可编辑 L1（仅 brainstorm/l1-edit）" % state["stage"]
        err = assert_l1(data.get("items"))
        if err:
            return None, err
        if state["stage"] == "brainstorm":
            state["stage"] = "l1-edit"
        state["plan"]["groups"] = [
            {"title": str(it["title"]).strip(), "spec": str(it["spec"]).strip(),
             "accept": _strs(it.get("accept")), "locked": False,
             "items": [], "verify": str(it.get("verify") or "").strip(),
             "redteam": None, "status": "pending"}
            for it in data["items"]]
        return state, "L1 大类 %d 组已写入（未锁定）。下一步：lock_stage --level 1"
    # L2
    if state["stage"] not in ("l1-edit", "l2-edit"):
        return None, "当前阶段 %s 不可编辑 L2（需先锁定 L1）" % state["stage"]
    locked = {g["title"] for g in state["plan"]["groups"] if g.get("locked")}
    err = assert_l2(data.get("groups"), locked)
    if err:
        return None, err
    old = {g["title"]: g for g in state["plan"]["groups"]}
    groups = []
    for g in data["groups"]:
        prev = old.get(str(g["title"]).strip()) or {}
        items = []
        for it in g.get("items") or []:
            pi = next((x for x in (prev.get("items") or []) if x["title"] == str(it["title"]).strip()), {})
            items.append({
                "title": str(it["title"]).strip(),
                "concept": str(it.get("concept") or pi.get("concept") or "").strip(),
                "spec": str(it["spec"]).strip(),
                "accept": _strs(it.get("accept")),
                "do": str(it["do"]).strip(),
                "verify": str(it["verify"]).strip(),
                "mode": str(it.get("mode") or pi.get("mode") or "").strip(),
                "status": pi.get("status", "pending"),
                "redteam": pi.get("redteam"),
                "do_trail": pi.get("do_trail") or [],
            })
        groups.append({"title": str(g["title"]).strip(), "spec": prev.get("spec", ""),
                       "accept": prev.get("accept", []), "locked": prev.get("locked", False),
                       "items": items, "verify": prev.get("verify", ""),
                       "redteam": prev.get("redteam"), "status": prev.get("status", "pending")})
    state["plan"]["groups"] = groups
    if state["stage"] == "l1-edit":
        state["stage"] = "l2-edit"
    n = sum(len(g["items"]) for g in groups)
    return state, "L2 小类 %d 项已写入（未锁定）。下一步：lock_stage --level 2" % n


def cmd_lock_stage(state, args):
    if getattr(args, "level", 0) == 1:
        if state["stage"] != "l1-edit":
            return None, "当前阶段 %s 不可锁定 L1" % state["stage"]
        err = assert_l1([{"title": g["title"], "spec": g["spec"], "accept": g["accept"]}
                         for g in state["plan"]["groups"]])
        if err:  # 先复检后写入
            return None, "复检失败，锁定拒绝（状态不变）：%s" % err
        for g in state["plan"]["groups"]:
            g["locked"] = True
        state["stage"] = "l2-edit"
        return state, "L1 已锁定（%d 组）。下一步：edit_plan --level 2 细化小类（全必填）" % len(state["plan"]["groups"])
    if state["stage"] != "l2-edit":
        return None, "当前阶段 %s 不可锁定 L2" % state["stage"]
    locked = {g["title"] for g in state["plan"]["groups"]}
    err = assert_l2([{"title": g["title"], "items": g["items"]} for g in state["plan"]["groups"]], locked)
    if err:
        return None, "复检失败，锁定拒绝（状态不变）：%s" % err
    for g in state["plan"]["groups"]:
        g["locked"] = True
    state["stage"] = "review"
    return state, "L2 已锁定。完整规格单用 status --verbose 查看；下一步：review --decision approve|reject"


def cmd_review(state, args):
    if state["stage"] != "review":
        return None, "当前阶段 %s 不可审核（需 L2 锁定后）" % state["stage"]
    if getattr(args, "decision", "") == "approve":
        state["stage"] = "develop"
        state["review"] = {"decision": "approve", "at": _now()}
        return state, "审核通过 → 开发阶段。mark_task 逐项打卡；verify=redteam 项先 redteam_verdict"
    state["stage"] = "l2-edit"
    state["review"] = {"decision": "reject", "reason": getattr(args, "reason", "") or "", "at": _now()}
    return state, "审核拒绝 → 回到 l2-edit（reject-ack）。修订后重新 lock_stage --level 2"


def _find_item(state, title):
    for g in state["plan"]["groups"]:
        for it in g.get("items") or []:
            if it["title"] == title:
                return g, it
    return None, None


def cmd_mark_task(state, args):
    if state["stage"] not in ("develop", "final"):
        return None, "mark_task 仅在审核通过后的开发阶段可用（当前 %s）" % state["stage"]
    if getattr(args, "level", "") == "L2":
        g, it = _find_item(state, getattr(args, "title", ""))
        if not it:
            return None, "小类「%s」不在计划树里（请复制当前小类标题）" % getattr(args, "title", "")
        if it.get("verify") == VERIFY_SPECIAL and not (it.get("redteam") or {}).get("passed"):
            rounds = (it.get("redteam") or {}).get("rounds", 0)
            return None, ("小类「%s」verify=redteam：尚未裁决通过（轮次=%d）——"
                          "先 redteam_verdict --level L2 --title %s --verdict pass|reject；打回则修复后再裁决"
                          % (args.title, rounds, args.title))
        if args.status == "in_progress":
            for x in g["items"]:  # 单线聚焦：同组其它 in_progress 复位
                if x["title"] != args.title and x["status"] == "in_progress":
                    x["status"] = "pending"
        it["status"] = getattr(args, "status", "pending")
    else:
        g = next((x for x in state["plan"]["groups"] if x["title"] == getattr(args, "title", "")), None)
        if not g:
            return None, "大类「%s」不在计划树里" % getattr(args, "title", "")
        if args.status == "completed":
            if any((it.get("status") != "completed") for it in g.get("items") or []):
                return None, "大类「%s」下还有未完成小类（完成下的小类后才能标定大类）" % getattr(args, "title", "")
            if g.get("verify") == VERIFY_SPECIAL and not (g.get("redteam") or {}).get("passed"):
                return None, "大类「%s」组收官 verify=redteam：尚未裁决通过——先 redteam_verdict --level L1" % getattr(args, "title", "")
            g["locked"] = True  # 组级完成标记
        elif getattr(args, "status", "") == "pending":
            g["locked"] = False
        g["status"] = getattr(args, "status", "pending")
    if _all_done(state) and state["stage"] != "final":
        state["stage"] = "final"
        return state, "全部完成 → final。终验：跑 delivery_check 过交付门禁后向用户报告"
    return state, "已标定 %s %s → %s" % (getattr(args, "level", ""), getattr(args, "title", ""), getattr(args, "status", ""))


def _all_done(state):
    groups = state["plan"]["groups"]
    return bool(groups) and all(
        g.get("locked") or all((it.get("status") == "completed") for it in g.get("items") or [])
        for g in groups)


def cmd_redteam(state, args):
    if getattr(args, "verdict", "") not in ("pass", "reject"):
        return None, "verdict 非法：pass|reject"
    if getattr(args, "level", "") == "L2":
        _, it = _find_item(state, getattr(args, "title", ""))
        if not it:
            return None, "小类「%s」不在计划树里" % getattr(args, "title", "")
        if it.get("verify") != VERIFY_SPECIAL:
            return None, "小类「%s」未声明红队验证（verify=redteam）——裁决不可用" % args.title
        rt = it.get("redteam") or {"rounds": 0, "passed": False, "log": []}
        rt = {"rounds": rt["rounds"] + 1, "passed": getattr(args, "verdict", "") == "pass",
              "log": rt["log"] + [{"verdict": getattr(args, "verdict", ""), "issues": _strs(getattr(args, "issues", None)), "at": _now()}]}
        it["redteam"] = rt
        msg = ("裁决 pass（轮次=%d）——现在可 mark_task 标定完成" % rt["rounds"]) if rt["passed"] else (
            "裁决 reject（轮次=%d）——修复问题后重新裁决（再审批）：\n- %s" % (rt["rounds"], "\n- ".join(_strs(args.issues) or ["（未列问题）"])))
        return state, msg
    g = next((x for x in state["plan"]["groups"] if x["title"] == getattr(args, "title", "")), None)
    if not g:
        return None, "大类「%s」不在计划树里" % getattr(args, "title", "")
    if g.get("verify") != VERIFY_SPECIAL:
        return None, "大类「%s」未声明红队验证——裁决不可用" % args.title
    rt = g.get("redteam") or {"rounds": 0, "passed": False, "log": []}
    g["redteam"] = {"rounds": rt["rounds"] + 1, "passed": getattr(args, "verdict", "") == "pass",
                    "log": rt["log"] + [{"verdict": getattr(args, "verdict", ""), "issues": _strs(getattr(args, "issues", None)), "at": _now()}]}
    return state, "组级裁决 %s（轮次=%d）" % (args.verdict, g["redteam"]["rounds"])


def cmd_revise_do(state, args):
    if state["stage"] not in ("develop", "final"):
        return None, "revise_do 仅开发期可用（当前 %s）" % state["stage"]
    _, it = _find_item(state, getattr(args, "title", ""))
    if not it:
        return None, "小类「%s」不在计划树里" % getattr(args, "title", "")
    trail = it.get("do_trail") or []
    it["do_trail"] = trail + [{"from": it.get("do", ""), "to": getattr(args, "do", ""), "at": _now()}]
    it["do"] = getattr(args, "do", "")
    return state, "do 已修订并登记轨迹（第 %d 次）；verify 只读未动" % len(it["do_trail"])


def spec_sheet(state):
    lines = []
    star = state.get("star") or {}
    lines.append("★ %s" % star.get("purpose", "（未定稿）"))
    if star.get("mode"):
        lines.append("  验收模式：%s" % star["mode"])
    for label, key in (("需求", "requirements"), ("非目标", "non_goals"), ("假设", "assumptions")):
        for r in star.get(key) or []:
            lines.append("  %s：%s" % (label, r))
    for g in state["plan"]["groups"]:
        rt = " 🔴未裁" if (g.get("verify") == VERIFY_SPECIAL and not (g.get("redteam") or {}).get("passed")) else ""
        lines.append("■ %s%s [%s]" % (g["title"], rt, g.get("status", "pending")))
        for it in g.get("items") or []:
            irt = " 🔴" if (it.get("verify") == VERIFY_SPECIAL and not (it.get("redteam") or {}).get("passed")) else ""
            lines.append("  □ %s（%s）%s" % (it["title"], it.get("status", "pending"), irt))
            if it.get("spec"):
                lines.append("    spec: %s" % it["spec"])
            for a in it.get("accept") or []:
                lines.append("    accept: %s" % a)
            if it.get("do"):
                lines.append("    do: %s" % it["do"])
            if it.get("verify"):
                lines.append("    verify: %s" % it["verify"])
    return "\n".join(lines)


def cmd_status(state, args):
    total = sum(len(g.get("items") or []) for g in state["plan"]["groups"])
    done = sum(1 for g in state["plan"]["groups"] for it in g.get("items") or [] if it.get("status") == "completed")
    rt_open = sum(1 for g in state["plan"]["groups"] for it in g.get("items") or []
                  if it.get("verify") == VERIFY_SPECIAL and not (it.get("redteam") or {}).get("passed"))
    star = (state.get("star") or {}).get("purpose", "")
    if not getattr(args, "verbose", False):
        return state, ("stage=%s | ★%s | 小类 %d/%d | 红队未决 %d\n（--verbose 看完整规格单）"
                       % (state["stage"], (star[:40] + "…") if len(star) > 40 else star, done, total, rt_open))
    return state, spec_sheet(state)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("commit_star")
    p.add_argument("--purpose", required=True)
    p.add_argument("--requirements", nargs="*", default=[])
    p.add_argument("--non-goals", nargs="*", default=[], dest="non_goals")
    p.add_argument("--assumptions", nargs="*", default=[])
    p.add_argument("--mode", choices=list(MODES))

    p = sub.add_parser("edit_plan")
    p.add_argument("--level", type=int, required=True, choices=[1, 2])
    p.add_argument("--plan", help="计划 JSON 文件路径（items/groups 结构）；缺省读 stdin")

    p = sub.add_parser("lock_stage")
    p.add_argument("--level", type=int, required=True, choices=[1, 2])

    p = sub.add_parser("review")
    p.add_argument("--decision", required=True, choices=["approve", "reject"])
    p.add_argument("--reason")

    p = sub.add_parser("mark_task")
    p.add_argument("--level", required=True, choices=["L1", "L2"])
    p.add_argument("--title", required=True)
    p.add_argument("--status", required=True, choices=["pending", "in_progress", "completed"])

    p = sub.add_parser("redteam_verdict")
    p.add_argument("--level", required=True, choices=["L1", "L2"])
    p.add_argument("--title", required=True)
    p.add_argument("--verdict", required=True, choices=["pass", "reject"])
    p.add_argument("--issues", nargs="*", default=[])

    p = sub.add_parser("revise_do")
    p.add_argument("--title", required=True)
    p.add_argument("--do", required=True)

    p = sub.add_parser("status")
    p.add_argument("--verbose", action="store_true")

    sub.add_parser("off")

    args = ap.parse_args()
    state = load_state()

    if args.cmd == "off":
        save_state(init_state())
        print("graded 会话已清除（回到官方原样）")
        return
    if args.cmd == "commit_star":
        state, msg = cmd_commit_star(state, args)
    elif args.cmd == "edit_plan":
        state, msg = cmd_edit_plan(state, args)
    elif args.cmd == "lock_stage":
        state, msg = cmd_lock_stage(state, args)
    elif args.cmd == "review":
        state, msg = cmd_review(state, args)
    elif args.cmd == "mark_task":
        state, msg = cmd_mark_task(state, args)
    elif args.cmd == "redteam_verdict":
        state, msg = cmd_redteam(state, args)
    elif args.cmd == "revise_do":
        state, msg = cmd_revise_do(state, args)
    elif args.cmd == "status":
        state, msg = cmd_status(state, args)
    else:
        state, msg = None, "未知命令"

    if state is None:
        print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False))
        sys.exit(1)
    save_state(state)
    print(json.dumps({"ok": True, "stage": state["stage"], "message": msg}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
