#!/usr/bin/env python3
"""plan_approve — 清单状态转写器（v1.13 批准落产物 / v1.14 受阻一等状态）。

「以产物为中心」的缺口补齐：
  1. 批准事件只活在对话里 → 转写为清单 frontmatter 的 approved.{at,note}
     + 考古地层 plan_approved 化石（何时、附言、漂移、**批准时工作区脏文件快照**）。
  2. 人↔产物直通：人类可直接编辑清单填 approved.at 批准（不经过对话），
     边界守卫视同已批准；本脚本随后对齐 status（不覆盖人类的时间戳）。
  3. 受阻是一等状态（v1.14）：卡住别硬磨别绕过——四问落产物
     （阻塞在哪/已试什么/为什么不能安全继续/需要人类什么），
     边界守卫拦编辑直到解阻。受阻是合法的停止，不是失败。

用法：
  plan_approve.py <manifest.md> [--note "批准附言"]            # 批准：planning→in-progress
  plan_approve.py <manifest.md> --cancel [--note ...]          # 取消：planning→cancelled
  plan_approve.py <manifest.md> --block --reason R [--tried T] [--unsafe U] [--need N]
                                                                # 受阻：in-progress/verifying→blocked
  plan_approve.py <manifest.md> --unblock [--resolution ...]   # 解阻：blocked→in-progress

漂移检查（版本确定性）：清单创建时戳 base_head；批准时 HEAD 已变则警示
"计划基于 <sha>，其间已有 N 个新提交"——只警示不阻断，由人类定夺。
"""
import argparse
import os
import re
import subprocess
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import journal
from journal import journal_append, load_journal
from manifest_fields import frontmatter, field, block_value  # v1.20 单一来源

# 行首（无缩进）的 status 行——脆弱点的缩进 status 不受影响
_STATUS_LINE = re.compile(r"^status:\s*\S+.*$", re.M)
# approved / blocked / provisional 块 + 其连续缩进行（删除后重建，避免局部修补出错）
_APPROVED_BLOCK = re.compile(r"^approved:\s*\n(?:[ \t]+.*\n?)*", re.M)
_BLOCKED_BLOCK = re.compile(r"^blocked:\s*\n(?:[ \t]+.*\n?)*", re.M)
_PROVISIONAL_BLOCK = re.compile(r"^provisional:\s*\n(?:[ \t]+.*\n?)*", re.M)
_BLOCK_KEYS = ("reason", "tried", "unsafe_why", "need", "at")
_SESSION_LINE = re.compile(r"^session:\s*\S+.*$", re.M)


def _stamp_session(content, manifest_dir):
    """批准/临行/受阻时盖 session 戳（v1.34 会话作用域）。

    身份来源：会话中继（UserPromptSubmit 钩子每轮写的 last-writer-wins 文件）
    优先，本进程 env 兜底——Bash 工具进程通常无会话 env，靠中继；两会话同项目
    并发时可能错归属一拍（错向=自己的清单被当他人的，可见可修，顾问预审认可）。
    """
    try:
        from session_relay import read_relay, sid_from_env
        project_dir = journal._find_project_dir(manifest_dir) or manifest_dir
        sid = (read_relay(project_dir) or {}).get("sid") or sid_from_env()
    except Exception:
        sid = ""
    if not sid:
        return content
    if _SESSION_LINE.search(content):
        return _SESSION_LINE.sub(f"session: {sid}", content, count=1)
    return _STATUS_LINE.sub(lambda m: m.group(0) + f"\nsession: {sid}",
                            content, count=1)


def _resolve_pending(mid):
    """P0-3 回流接线（评审批次一）：批准/取消/解阻 = 人类对该清单相关
    待决推送的事实裁决（useful）——自动 resolve 同 ref 的未决记录，
    闭环不再依赖人手工清账（旧记录无 ref 时按标题词边界唯一命中兜底）。
    best-effort：台账故障不影响转写主流程。"""
    if not mid:
        return 0
    try:
        from pending import resolve_by_ref
        return resolve_by_ref(mid)
    except Exception:
        return 0


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def _git(manifest_dir, *args):
    try:
        out = subprocess.run(["git", "-C", str(manifest_dir), *args],
                             capture_output=True, text=True, timeout=5)
        if out.returncode == 0:
            return out.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    return ""


def _drift_info(fm_text, manifest_dir):
    """计划基线 vs 当前 HEAD。返回 (可读描述, 附加入地层的字段)。

    P2#26 仓错配（评审活体：假警报 da7482b）：.regress 向上找 git 会撞到
    外层仓（工作区本身是 git 仓），拿别仓 HEAD 比对。清单 frontmatter 可选
    `repo:`（相对 .regress 父目录的路径）显式声明产物仓——显式优于聪明。"""
    base = field(fm_text, "base_head")
    if not base or "{{" in base:  # 模板占位符未填 = 无基线
        return "", {}
    repo = field(fm_text, "repo")
    if repo:  # repo: 相对 .regress 父目录（项目根）的产物仓路径
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(manifest_dir)))
        git_dir = os.path.join(project_root, repo)
    else:
        git_dir = manifest_dir
    cur = _git(git_dir, "rev-parse", "--short", "HEAD")
    if not cur or cur == base:
        return "", {}
    fields = {"base_head": base, "current_head": cur}
    n = _git(git_dir, "rev-list", "--count", f"{base}..HEAD")
    if n.isdigit():
        fields["commits_behind"] = int(n)
    cnt = fields.get("commits_behind", "?")
    return f"计划基于 {base}，当前 HEAD {cur}（其间 {cnt} 个新提交）", fields


def _apply(content, new_status, at, note):
    """重写 frontmatter：status 行 + approved 块。at=None 表示只改状态（取消）。

    P1#7：repl 走 lambda——re.sub 对普通替换串做转义处理，note 里的
    `C:\\docs` / `\\1` 会触发 re.error: bad escape（评审实测可清空清单）。"""
    content = _APPROVED_BLOCK.sub("", content)
    repl = f"status: {new_status}"
    if at is not None:
        repl += f'\napproved:\n  at: "{at}"\n  note: "{note}"'
    return _STATUS_LINE.sub(lambda _: repl, content, count=1)


def _set_blocked(content, fields):
    """status→blocked + blocked 四问块重建（approved 块不动）。

    四问文本来自 --reason/--tried/--unsafe/--need（用户输入）→ lambda 替换
    防转义炸（同 P1#7）。"""
    content = _BLOCKED_BLOCK.sub("", content)
    block = "blocked:"
    for k in _BLOCK_KEYS:
        block += f'\n  {k}: "{fields.get(k, "")}"'
    return _STATUS_LINE.sub(lambda _: f"status: blocked\n{block}", content, count=1)


def _append_resolved(content, resolved_at, resolution):
    """解阻：status→in-progress，blocked 块保留并追加 resolved_*（历史可见）。"""
    content = _STATUS_LINE.sub("status: in-progress", content, count=1)
    m = re.search(r"^blocked:\s*\n(?:[ \t]+.*\n?)*", content, re.M)
    if not m:
        return content
    block = m.group(0).rstrip("\n")
    block += f'\n  resolved_at: "{resolved_at}"\n  resolution: "{resolution}"'
    return content[:m.start()] + block + "\n" + content[m.end():]


def _set_provisional(content, at, advisor):
    """临行（伪全自动）：status→in-progress + provisional 块。顾问有否决权无批准权——
    临行的执行授权来自人类事前预授权，顾问预审只是安全网。advisor 文本 lambda 替换（P1#7）。"""
    content = _PROVISIONAL_BLOCK.sub("", content)
    block = f'provisional:\n  at: "{at}"\n  advisor: "{advisor}"'
    return _STATUS_LINE.sub(lambda _: f"status: in-progress\n{block}", content, count=1)


def _dirty_files(manifest_dir, cap=20):
    """批准时刻的工作区原点：git status --short（思想二·基线冻结的补全）。

    以仓库根为基准（manifest 目录是子目录，相对路径会失真）。
    """
    root = _git(manifest_dir, "rev-parse", "--show-toplevel")
    if not root:
        return []
    out = _git(root, "status", "--short")
    if not out:
        return []
    return [l.strip() for l in out.splitlines() if l.strip()][:cap]


def _already_journaled(kind, mid, manifest_dir):
    project_dir = journal._find_project_dir(manifest_dir)
    if not project_dir:
        return False
    for e in load_journal(project_dir):
        if e.get("kind") == kind and e.get("manifest_id") == mid:
            return True
    return False


def main():
    ap = argparse.ArgumentParser(description="清单状态转写器（批准/取消/受阻/解阻）")
    ap.add_argument("manifest", help="清单路径 (.regress/manifests/*.md)")
    ap.add_argument("--note", default="", help="批准附言/取消原因")
    ap.add_argument("--cancel", action="store_true", help="取消计划（planning→cancelled）")
    ap.add_argument("--block", action="store_true",
                    help="标受阻（in-progress/verifying→blocked，四问落产物）")
    ap.add_argument("--reason", default="", help="受阻：阻塞在哪（具体命令/代码位置/环境）")
    ap.add_argument("--tried", default="", help="受阻：已尝试的方法")
    ap.add_argument("--unsafe", default="", help="受阻：为什么不能安全继续")
    ap.add_argument("--need", default="", help="受阻：需要人类提供什么（信息/权限/决策）")
    ap.add_argument("--unblock", action="store_true", help="解阻（blocked→in-progress）")
    ap.add_argument("--resolution", default="", help="解阻：阻塞如何被解除的")
    ap.add_argument("--provisional", action="store_true",
                    help="临行（预授权+顾问预审无异议：planning→in-progress，进入否决窗）")
    ap.add_argument("--advisor", default="", help="顾问预审一句话结论（--provisional 必填；必须来自真实 consult，audit 可查）")
    args = ap.parse_args()

    if sum(bool(x) for x in (args.cancel, args.block, args.unblock, args.provisional)) > 1:
        print("plan_approve: --cancel/--block/--unblock/--provisional 一次只能一个", file=sys.stderr)
        return 2

    path = os.path.abspath(args.manifest)
    mdir = os.path.dirname(path)
    try:
        content = _read(path)
    except (IOError, OSError):
        print(f"plan_approve: 读不了清单 {path}", file=sys.stderr)
        return 2
    fm = frontmatter(content)
    if fm is None:
        print(f"plan_approve: {path} 无 frontmatter", file=sys.stderr)
        return 2

    mid = field(fm, "id") or os.path.basename(path)
    status = field(fm, "status")
    note = (args.note or "").replace('"', "'")
    now = datetime.now().isoformat(timespec="seconds")

    if args.block:
        if status not in ("in-progress", "verifying"):
            print(f"plan_approve: 只有进行中的任务能标受阻（当前 status={status}；"
                  f"planning 本身就是在等人类）", file=sys.stderr)
            return 1
        if not args.reason:
            print("plan_approve: --block 需要 --reason（阻塞在哪都说不清就不是受阻）",
                  file=sys.stderr)
            return 1
        fields = {
            "reason": args.reason.replace('"', "'"),
            "tried": args.tried.replace('"', "'"),
            "unsafe_why": args.unsafe.replace('"', "'"),
            "need": args.need.replace('"', "'"),
            "at": now,
        }
        new_content = _stamp_session(_set_blocked(content, fields), mdir)  # P1#7：先算后写
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
        journal_append("task_blocked", start_dir=mdir, manifest_id=mid,
                       reason=fields["reason"], need=fields["need"],
                       tried=fields["tried"], unsafe_why=fields["unsafe_why"])
        # 人类介入通知（v1.30）：受阻即推送——need 在等一个不在屏幕前的人
        try:
            from notify import notify as _notify
            _notify(os.path.dirname(os.path.dirname(mdir)), "blocked",
                    f"🛑 受阻 {mid}", (fields["need"] or fields["reason"] or "")[:80])
        except Exception:
            pass
        print(f"🛑 已受阻：{mid} → blocked（边界守卫将拦编辑，直到解阻）")
        print(f"   阻塞：{fields['reason']}")
        if fields["need"]:
            print(f"   需要人类：{fields['need']}")
        print("   → 把 need 转达给人类；解阻后 plan_approve.py <清单> --unblock")
        return 0

    if args.provisional:
        if status != "planning":
            print(f"plan_approve: 只有待批准计划能临行（当前 status={status}）", file=sys.stderr)
            return 1
        if not args.advisor:
            print("plan_approve: --provisional 需要 --advisor（预审结论；顾问有一票否决权，"
                  "有方向性异议时严禁临行）", file=sys.stderr)
            return 1
        if not _already_journaled("plan_advisor_review", mid, mdir):
            print("plan_approve: 临行需要真实的顾问预审化石在场（plan_advisor_review）——"
                  "先跑 /regress:plan 步骤 5a：consult 后 journal.py . add "
                  "plan_advisor_review '{\"manifest_id\":\"..\",\"verdict\":\"..\",\"summary\":\"..\"}'"
                  "（防代笔：预审必须留下可审计的痕迹）", file=sys.stderr)
            return 1
        new_content = _stamp_session(_set_provisional(  # P1#7：先算后写
            content, now, args.advisor.replace('"', "'")), mdir)
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
        journal_append("provisional_start", start_dir=mdir, manifest_id=mid,
                       advisor=args.advisor[:400])
        print(f"🚀 已临行：{mid} → in-progress（否决窗内，直到 done）")
        print(f"   预审：{args.advisor}")
        print("   · 执行授权来自人类的预授权，不来自顾问（顾问无批准权）")
        print("   · 人类否决 → plan_approve.py <清单> --cancel；给修改意见则完善计划重新预审")
        return 0

    if args.unblock:
        if status != "blocked":
            print(f"plan_approve: 无需解阻（当前 status={status}）", file=sys.stderr)
            return 1
        with open(path, "w", encoding="utf-8") as f:
            f.write(_append_resolved(content, now,
                                     (args.resolution or args.note).replace('"', "'")))
        journal_append("task_unblocked", start_dir=mdir, manifest_id=mid,
                       resolution=(args.resolution or args.note)[:400])
        print(f"✅ 已解阻：{mid} → in-progress（blocked 块保留 resolved 记录）")
        n = _resolve_pending(mid)
        if n:
            print(f"🔄 已自动回流 {n} 条待决（blocked 推送的裁决=阻塞已解除）")
        return 0

    if args.cancel:
        # 只有待批准或临行中（否决窗内）的计划可取消——正式批准/受阻的任务不许一销了之
        cancellable = status == "planning" or (
            status in ("in-progress", "verifying") and block_value(fm, "provisional", "at"))
        if not cancellable:
            print(f"plan_approve: 无需取消（当前 status={status}；"
                  f"只有待批准或临行中的计划可取消，正式任务走受阻/完成）", file=sys.stderr)
            return 1
        new_content = _apply(content, "cancelled", None, None)  # P1#7：先算后写
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
        if _already_journaled("plan_cancelled", mid, mdir):
            print(f"🗑️ 已取消：{mid} → cancelled（地层已有此事件，不重复埋）")
        else:
            journal_append("plan_cancelled", start_dir=mdir, manifest_id=mid, note=note)
            print(f"🗑️ 已取消：{mid} → cancelled（归档不实施，已入考古地层）")
        n = _resolve_pending(mid)
        if n:
            print(f"🔄 已自动回流 {n} 条待决（否决也是裁决）")
        return 0

    if status != "planning":
        print(f"plan_approve: 无需批准（当前 status={status}）", file=sys.stderr)
        return 1

    drift, dfields = _drift_info(fm, mdir)
    human_at = block_value(fm, "approved", "at")  # 人类产物直通的时间戳——保留，不覆盖
    at = human_at or datetime.now().isoformat(timespec="seconds")
    if not note:
        note = "产物直通（人类直接编辑 approved.at）" if human_at else "对话批准转写"
    new_content = _stamp_session(_apply(content, "in-progress", at, note), mdir)  # P1#7：先算后写
    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)

    dirty = _dirty_files(mdir)  # 批准时刻的工作区原点（思想二·基线冻结）

    already = _already_journaled("plan_approved", mid, mdir)
    if not already:
        journal_append("plan_approved", start_dir=mdir, manifest_id=mid,
                       approved_at=at, note=note, drift=drift or "none",
                       dirty_count=len(dirty), dirty_files=dirty, **dfields)
    print(f"✅ 已批准：{mid} → in-progress（approved.at={at}）")
    n = _resolve_pending(mid)
    if n:
        print(f"🔄 已自动回流 {n} 条待决（plan_approval 推送的裁决=已批准）")
    if dirty:
        print(f"📸 基线快照：{len(dirty)} 个未提交脏文件已入地层（此为工作区原点，"
              f"后续新脏文件对照此原点识别）")
        for d in dirty[:3]:
            print(f"   {d}")
        if len(dirty) > 3:
            print(f"   … 共 {len(dirty)} 个")
    if drift:
        print(f"⚠️ 计划漂移：{drift}")
        print("   计划基于的文件可能已变——把差异报告给人类确认后再继续实施")
    print("📜 已入考古地层（plan_approved）" if not already
          else "📜 地层已有此事件，不重复埋")
    return 0


if __name__ == "__main__":
    sys.exit(main())
