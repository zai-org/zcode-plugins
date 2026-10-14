#!/usr/bin/env python3
"""graded 状态机穷举单测：转移表、拒绝路径（状态不变）、门控、幂等。

用法: python test/graded_unit_test.py
（独立运行，不依赖 pytest；直接 import scripts/graded.py 的纯函数）
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, os.pardir, "scripts"))
import graded as G

PASS = 0
FAIL = 0


def check(name, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print("FAIL:", name)


class A:  # 最小 args 替身
    def __init__(self, **kw):
        self.__dict__.update(kw)


S = lambda: G.init_state()

# ---- commit_star 门控 ----
st, m = G.cmd_commit_star(S(), A(purpose="短", requirements=[]))
check("purpose 过短拒绝", st is None)
st, m = G.cmd_commit_star(S(), A(purpose="为独立开发者在多插件并行时保持交付纪律提供可观测的流程门禁", requirements=["r1"]))
check("purpose 合法定稿", st is not None and st["stage"] == "brainstorm" and st["star"]["purpose"].startswith("为独立"))
st2, m = G.cmd_commit_star(st, A(purpose="为独立开发者在多插件并行时保持交付纪律提供可观测的另一个目的宣言"))
check("brainstorm 阶段可再定稿", st2 is not None)

# ---- L1 校验拒绝=状态不变 ----
l1_bad = {"items": [{"title": "A", "spec": "", "accept": ["x"]}]}
err = G.assert_l1(l1_bad["items"])
check("L1 spec 缺失被拒", err is not None and "spec" in err)
err = G.assert_l1([])
check("L1 空列表被拒", err is not None)
err = G.assert_l1([{"title": "A", "spec": "s", "accept": []}, {"title": "A", "spec": "s", "accept": ["x"]}])
check("L1 重名被拒", err is not None and "重复" in err)

# ---- L1 写入+锁定 ----
st = st2
st["plan"]["groups"] = [{"title": "A", "spec": "s", "accept": ["x"], "locked": False, "items": [], "verify": "", "redteam": None, "status": "pending"}]
st["stage"] = "l1-edit"
st3, m = G.cmd_lock_stage(st, A(level=1))
check("L1 锁定成功→l2-edit", st3 is not None and st3["stage"] == "l2-edit" and st3["plan"]["groups"][0]["locked"])

# ---- L2 校验 ----
l2 = [{"title": "A", "items": [{"title": "a1", "spec": "s", "accept": ["ok"], "do": "做", "verify": "redteam"}]}]
err = G.assert_l2(l2, {"A"})
check("L2 合法通过", err is None)
err = G.assert_l2([{"title": "A", "items": [{"title": "a1", "spec": "s", "accept": ["ok"], "do": "", "verify": "v"}]}], {"A"})
check("L2 缺 do 被拒", err is not None and "do" in err)
err = G.assert_l2([{"title": "B", "items": [{"title": "a1", "spec": "s", "accept": ["ok"], "do": "d", "verify": "v"}]}], {"A"})
check("L2 新增锁定外大类被拒", err is not None and "锁定" in err)
err = G.assert_l2([{"title": "A", "items": []}], {"A"})
check("L2 空小类被拒", err is not None)

# ---- L2 写入（直接构造状态）+ 锁定 + 审核 ----
st3["plan"]["groups"][0]["items"] = [
    {"title": "a1", "concept": "", "spec": "s", "accept": ["ok"], "do": "做", "verify": "redteam",
     "mode": "", "status": "pending", "redteam": None, "do_trail": []},
    {"title": "a2", "concept": "", "spec": "s", "accept": ["ok2"], "do": "做2", "verify": "自测",
     "mode": "", "status": "pending", "redteam": None, "do_trail": []}]
st4, m = G.cmd_lock_stage(st3, A(level=2))
check("L2 锁定→review", st4 is not None and st4["stage"] == "review")

st5, m = G.cmd_review(st4, A(decision="reject", reason="规格太粗"))
check("审核拒绝回 l2-edit", st5 is not None and st5["stage"] == "l2-edit")
st5b, m = G.cmd_review(st5, A(decision="approve"))
check("l2-edit 直接审核被拒（须先重新锁定）", st5b is None)  # 上游语义：reject-ack 后必须修订→重锁→再审
st5c, m = G.cmd_lock_stage(st5, A(level=2))
check("重新锁定 L2 回 review", st5c is not None and st5c["stage"] == "review")
st6, m = G.cmd_review(st5c, A(decision="approve"))
check("审核通过→develop", st6 is not None and st6["stage"] == "develop")

# ---- mark 门禁 ----
st7, m = G.cmd_mark_task(st6, A(level="L2", title="a1", status="completed"))
check("红队未裁不得打卡", st7 is None and "redteam" in m)
st7, m = G.cmd_mark_task(S(), A(level="L2", title="a1", status="completed"))
check("非开发阶段不可打卡", st7 is None and "开发" in m)

st8, m = G.cmd_redteam(st6, A(level="L2", title="a1", verdict="reject", issues=["缺边界"]))
check("红队 reject 记轮次", st8 is not None and st8["plan"]["groups"][0]["items"][0]["redteam"]["rounds"] == 1
      and not st8["plan"]["groups"][0]["items"][0]["redteam"]["passed"])
sheet8_open = G.spec_sheet(st8)  # cmd_* 原地改 dict：先捕获，避免后续 pass 裁决的别名覆盖
st9, m = G.cmd_mark_task(st8, A(level="L2", title="a1", status="completed"))
check("reject 后仍不得打卡", st9 is None)
st10, m = G.cmd_redteam(st8, A(level="L2", title="a1", verdict="pass"))
check("红队 pass", st10 is not None and st10["plan"]["groups"][0]["items"][0]["redteam"]["passed"])
st11, m = G.cmd_mark_task(st10, A(level="L2", title="a1", status="completed"))
check("pass 后可打卡", st11 is not None and st11["plan"]["groups"][0]["items"][0]["status"] == "completed")

st12, m = G.cmd_redteam(st11, A(level="L2", title="a2", verdict="pass"))
check("非 redteam 项裁决被拒", st12 is None)

# ---- 单线聚焦 ----
st13, m = G.cmd_mark_task(st11, A(level="L2", title="a2", status="in_progress"))
check("单线聚焦：a2 进行中", st13 is not None and st13["plan"]["groups"][0]["items"][1]["status"] == "in_progress")
st14, m = G.cmd_mark_task(st13, A(level="L2", title="a1", status="in_progress"))
check("单线聚焦：a1 复位 a2", st14 is not None
      and st14["plan"]["groups"][0]["items"][1]["status"] == "pending"
      and st14["plan"]["groups"][0]["items"][0]["status"] == "in_progress")

# ---- L1 标定门 ----
st15, m = G.cmd_mark_task(st14, A(level="L1", title="A", status="completed"))
check("小类未全完不得标大类", st15 is None and "未完成小类" in m)

# ---- revise_do 轨迹 ----
st16, m = G.cmd_revise_do(st14, A(title="a1", do="改用并行"))
check("revise_do 登记", st16 is not None and len(st16["plan"]["groups"][0]["items"][0]["do_trail"]) == 1
      and st16["plan"]["groups"][0]["items"][0]["do"] == "改用并行")
st17, m = G.cmd_revise_do(S(), A(title="a1", do="x"))
check("非开发期 revise_do 拒", st17 is None)

# ---- 全完→final ----
st18, m = G.cmd_mark_task(st16, A(level="L2", title="a1", status="completed"))
st19, m = G.cmd_mark_task(st18, A(level="L2", title="a2", status="completed"))
check("全部完成→final", st19 is not None and st19["stage"] == "final")
st20, m = G.cmd_mark_task(st19, A(level="L1", title="A", status="completed"))
check("final 后 L1 标定仍可用", st20 is not None and st20["plan"]["groups"][0]["locked"])

# ---- 星象只读 ----
st21, m = G.cmd_commit_star(st20, A(purpose="另一个全新的十二字以上的目的宣言声明"))
check("final 阶段星象只读", st21 is None and "只读" in m)

# ---- 状态不变验证（拒绝路径不动状态）----
before = json.dumps(st6, sort_keys=True, ensure_ascii=False)
G.cmd_mark_task(st6, A(level="L2", title="a1", status="completed"))  # 拒
after = json.dumps(st6, sort_keys=True, ensure_ascii=False)
check("拒绝=状态不变", before == after)

# ---- spec_sheet 渲染 ----
sheet = G.spec_sheet(st19)
check("规格单含状态与北极星", "completed" in sheet and "★" in sheet)
check("红队未决时规格单亮灯", "🔴" in sheet8_open)  # reject 后未再裁的快照

print("\n%d passed, %d failed" % (PASS, FAIL))
sys.exit(1 if FAIL else 0)
