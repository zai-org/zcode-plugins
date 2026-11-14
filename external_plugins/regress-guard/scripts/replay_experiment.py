#!/usr/bin/env python3
"""replay_experiment — 历史重放实验（批136，效果证据链扩面）。

协议骨架复刻批108 cache_experiment：归档 workspace .regress/experiments/、
journal experiment_result 化石、条件化措辞（结构化 interpretation_boundary）。
与配对实验的差别：两侧不是 miss/hit 计时，而是**旧判定器 vs 新判定器**对同一
合成语料的判定结果对比——语料参数直取历史标本实测结构（不复制用户原文，
公开仓纪律）。

宣称上限：**标本范围已证效**（结构复刻语料上的判定器行为差异），非野外效果。
共变边界：批 111/122 区间内的其他改动未隔离（见归档 confounds 字段）。

旧实现=内联冻结快照（出处旁注；tests/test_replay_experiment.py 的 pinned-SHA
用例把快照常量与 git 历史父提交的旧码原文对账——防转写漂移）。
新实现=真导入生产代码（lib/journal.pending_corrections / 读门禁判据链公式）。

用法：python3 scripts/replay_experiment.py [workspace_dir]
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "hooks", "scripts", "lib"))

# ── 冻结快照常量（pinned：tests 用 git 父提交原文对账） ──────────
OLD_CORRECTION_WINDOW_MIN = 10   # 批122 前 reflection_check 节9：10 分钟墙钟窗（422b7f2^）
OLD_READ_FORMULA = "(edit_count+1)*ratio"  # 批111 前读门禁累计乘法（0c69523^）
OLD_RATIO = 2                    # f77a 实测 config ratio=2（野外报告#1）

# 语料参数（直取标本结构，确定性生成——无随机成分，档内 5 会话为形态枚举非重复采样）
GAPS_MIN = [2, 8, 12, 20, 32, 45]   # 0158a98b 逃逸形态=32 分钟档；边界落在 (8,12) 未采样精确阈值
SESSIONS_PER_GAP = 5
READ_FORMS = ["spiral", "blind_dive", "disciplined", "mixed"]  # f77a=spiral（39 改/20 读）


# ═══ 实验一：纠正闭环 v2（批122 高水位 vs 旧 10 分钟窗） ═══════════

def old_window_captures(correction_ts, stop_ts,
                        window_min=OLD_CORRECTION_WINDOW_MIN):
    """冻结快照：批122 前 Stop 反思只回看墙钟窗内的纠正（>10min 即逃逸）。"""
    return [t for t in correction_ts
            if timedelta(0) <= stop_ts - t <= timedelta(minutes=window_min)]


def new_highwater_captures(journal_path, stop_ts):
    """新实现：真导入 lib/journal.pending_corrections（高水位=最新处置之后的
    纠正全算 pending，与墙钟无关）。返回 pending 条数。"""
    from journal import pending_corrections
    # events.jsonl 在 <project>/.regress/journal/ 下——剥三层
    project = os.path.dirname(os.path.dirname(os.path.dirname(journal_path)))
    return len(pending_corrections(project, scan_cap=200))


def _write_journal(path, events):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for ev in events:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")


def run_correction_replay():
    """合成语料：每会话 1 条轮中段纠正 + Stop 在 gap 分钟后；确定性时间戳。"""
    results = []
    base = datetime(2026, 9, 24, 11, 0, 0)  # 0158a98b 标本当日形态（结构非内容）
    for gap in GAPS_MIN:
        for i in range(SESSIONS_PER_GAP):
            c_ts = base + timedelta(minutes=10 + i)      # 轮中段纠正
            stop_ts = c_ts + timedelta(minutes=gap)      # Stop 反思时刻
            with tempfile.TemporaryDirectory(prefix="replay-corr-") as td:
                jp = os.path.join(td, ".regress", "journal", "events.jsonl")
                _write_journal(jp, [{
                    "ts": c_ts.isoformat(), "kind": "user_correction",
                    "session": f"replay-{gap}-{i}",
                    "excerpt": f"synthetic-correction-{gap}-{i}",  # 结构占位，非用户原文
                }])
                old_n = len(old_window_captures([c_ts], stop_ts))
                new_n = new_highwater_captures(jp, stop_ts)
            results.append({"gap_min": gap, "session": i,
                            "old_captured": old_n, "new_captured": new_n})
    old_total = sum(r["old_captured"] for r in results)
    new_total = sum(r["new_captured"] for r in results)
    n = len(results)
    return {
        "corpus": {"deterministic": True, "gaps_min": GAPS_MIN,
                   "sessions_per_gap": SESSIONS_PER_GAP,
                   "specimen": "sess_0158a98b 纠正轮中段+Stop 32 分钟后逃逸形态"},
        "results": {"sessions": n,
                    "old_window_captures": old_total,
                    "new_highwater_captures": new_total,
                    "per_gap": {str(g): {
                        "old": sum(r["old_captured"] for r in results
                                   if r["gap_min"] == g),
                        "new": sum(r["new_captured"] for r in results
                                   if r["gap_min"] == g)} for g in GAPS_MIN}},
        "claim_wording": (f"结构复刻语料 {n} 会话（确定性）：旧 10 分钟窗捕获 "
                          f"{old_total}/{n}，高水位窗捕获 {new_total}/{n}——"
                          f"逃逸差异集中在 gap>10 分钟档（边界∈(8,12)分钟，未采样精确阈值）"),
    }


# ═══ 实验二：读门禁 per-file（批111 判据链 vs 旧累计乘法） ═════════

def _sequence(form):
    """四形态序列（结构直取标本）：返回 [(op, file)]。

    spiral（f77a）：39 次编辑散布 15 个文件，此前共读 20 次（15 文件各 1 次
    +5 次重读）——旧式累计乘法在第 39 改时要求 80 读。"""
    files = [f"src/m{i}.py" for i in range(15)]
    seq = []
    for k in range(39):
        if form == "disciplined":
            seq.append(("read", files[k % 15]))
            seq.append(("edit", files[k % 15]))
        elif form == "blind_dive":
            seq.append(("edit", files[k % 15]))
        elif form == "mixed":
            if k % 3 == 0:
                seq.append(("read", files[k % 15]))
            seq.append(("edit", files[(k + 7) % 15]))
        else:  # spiral：开头读 15 文件+5 重读，然后 39 连改
            if k == 0:
                for f in files:
                    seq.append(("read", f))
                for j in range(5):
                    seq.append(("read", files[j]))
            seq.append(("edit", files[(k * 7) % 15]))
    if form == "blind_dive":
        for j in range(3):  # 盲潜形态：开局 3 读后才进入编辑（对齐地板语义）
            seq.insert(j, ("read", files[j]))
    return seq


def old_cumulative_deficit(seq, ratio=OLD_RATIO):
    """冻结快照：required=(edit_count+1)*ratio——每编辑点的补读缺口曲线。"""
    reads = edits = 0
    curve = []
    for op, _f in seq:
        if op == "read":
            reads += 1
        else:
            edits += 1
            curve.append(max(0, (edits + 1) * ratio - reads))
    return curve


def new_perfile_deficit(seq, ratio=OLD_RATIO):
    """新判据链（111）：目标∈read_files→0；开局地板 min(ratio,3) 内→地板差；
    中间带→0（软提示非硬缺口——不要求补读）。"""
    bootstrap = min(int(ratio), 3)
    read_files = set()
    curve = []
    for op, f in seq:
        if op == "read":
            read_files.add(f)
        else:
            if len(read_files) < bootstrap and f not in read_files:
                curve.append(bootstrap - len(read_files))
            else:
                curve.append(0)
    return curve


def run_readgate_replay():
    forms_out = {}
    for form in READ_FORMS:
        seq = _sequence(form)
        old_c = old_cumulative_deficit(seq)
        new_c = new_perfile_deficit(seq)
        assert len(old_c) == len(new_c) == sum(1 for op, _ in seq if op == "edit")
        forms_out[form] = {
            "edits": len(old_c),
            "reads": sum(1 for op, _ in seq if op == "read"),
            "old_final_deficit": old_c[-1] if old_c else 0,
            "old_max_deficit": max(old_c) if old_c else 0,
            "new_final_deficit": new_c[-1] if new_c else 0,
            "new_max_deficit": max(new_c) if new_c else 0,
        }
    sp = forms_out["spiral"]
    return {
        "corpus": {"deterministic": True, "forms": READ_FORMS,
                   "specimen": "sess_f77a 死亡螺旋（39 改/20 读/ratio=2 被迫置 0）",
                   "old_formula": OLD_READ_FORMULA, "old_ratio": OLD_RATIO},
        "results": {"forms": forms_out},
        "claim_wording": (
            f"结构复刻语料（确定性）：spiral 形态旧式终点补读缺口 "
            f"{sp['old_final_deficit']} 读（线性增长——f77a 被迫置 0 的机制）vs "
            f"per-file 终点缺口 {sp['new_final_deficit']}（中间带=软提示非硬缺口）；"
            f"disciplined 形态新式 0 缺口——旧式对 1:1 正当流仍线性罚读"
            f"（(e+1)*ratio 数学下 1:1 永不满足，过度惩罚的另一半实证）"),
    }


# ═══ 归档+化石（批108 协议） ═════════════════════════════════

_BOUNDARY = {
    "specimen_id": "见 corpus.specimen 字段（结构复刻，非用户原文）",
    "within": "判定器行为差异（捕获数/补读缺口）——本机本语料确定性可复跑",
    "without": "野外效果（真实会话的处置率/实际读行为变化）；用户收益（捕获质量）",
    "confounds": ("批111 区间共存改动（112 状态竞态锁等）与批122 区间共存改动"
                  "（123/124 分母与卸载面）未隔离——效果差可能混入共变改动"),
}


def _archive_dir(workspace):
    d = os.path.join(str(workspace), ".regress", "experiments")
    os.makedirs(d, exist_ok=True)
    return d


def _finalize(res, name):
    res["feature"] = name
    res["date"] = datetime.now().strftime("%Y-%m-%d")
    res["interpretation_boundary"] = dict(_BOUNDARY)
    return res


def main():
    workspace = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(ROOT)
    for name, runner in (("correction-loop-replay", run_correction_replay),
                         ("read-gate-replay", run_readgate_replay)):
        res = _finalize(runner(), name)
        path = os.path.join(_archive_dir(workspace),
                            f"replay-{name.split('-')[0]}-{name.split('-')[1]}.json")
        json.dump(res, open(path, "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        print(f"[{name}] 归档 {path}")
        print(f"  {res['claim_wording']}")
        try:
            from journal import journal_append
            journal_append("experiment_result", start_dir=str(workspace),
                           feature=name,
                           summary=res["claim_wording"][:180])
        except Exception as e:
            print(f"  journal 化石失败（增强非依赖）: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
