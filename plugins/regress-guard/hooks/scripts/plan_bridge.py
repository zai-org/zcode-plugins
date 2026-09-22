#!/usr/bin/env python3
"""plan_bridge — 原生计划模式桥（v1.39：批准点对齐，单钩子原子）。

ZCode 原生计划模式的批准不产生任何产物——无清单、无边界、无门禁覆盖
（无活跃清单时 fail-open）。本桥把 ExitPlanMode 的批准时刻转录成治理清单：

    ExitPlanMode(计划原文) ──批准──→ PostToolUse → plan_bridge.py post：
                                  转录+盖章原子完成（approved+session+via:native）
                          ──拒绝──→ PostToolUseFailure → plan_bridge.py fail：
                                  零清单残留 + design_rejected 化石（带摘录可考古）

设计取舍（REGRESS-2026-028，2026-09-16 原生计划模式批准）：
- 单钩子原子：不用 Pre+Post 两段式（避免 planning 悬空与盖章竞态）
- 幂等键 = session + plan_hash（顾问修正采纳）：同 session 活跃 via:native 清单
  且 hash 不变 → 完全 no-op；hash 变 → 视为计划修订，重写正文并落 plan_refined
- 双轨合一：同 session 已有 /regress:plan 的 planning 清单 → 直接盖章它
  （两条批准通道，产物层只有一份）
- 顾问预审豁免有据：原生批准时人刚逐字读完计划=意图裁决（责任矩阵最高裁决，
  顾问否决权为保护不在场者）
- 双重防御：post 模式下 tool_response 带拒绝/错误特征也按拒绝处理（拒绝载荷
  语义未证——failure 事件与 response 特征双保险）
- 边界尽力提取（cap 12）+ F3/track 扩界留痕兜底；提取不到留空并在脆弱点声明
- stdout 静默：additionalContext 对 PostToolUse 是否合法未证，v1 不冒验
  schema 险（观察项）
- best-effort：任何异常 exit 0（桥是增强不是依赖）；REGRESS_PLAN_BRIDGE=off 关闭
- 已知边界：编号自推无锁，两会话同时首建可能撞号（罕见，哨兵可点名孤儿）
"""
import hashlib
import json
import os
import re
import sys

_LIB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib")
if _LIB_DIR not in sys.path:
    sys.path.insert(0, _LIB_DIR)

try:
    from journal import journal_append  # noqa: E402
    from session_relay import sid_from_env  # noqa: E402
except ImportError:  # lib 不在（未安装/半升级）——桥是增强不是依赖
    journal_append = None
    sid_from_env = None

ACTIVE = ("planning", "in-progress", "verifying", "blocked")
_PATH_TICK = re.compile(r"`([^`\n]{1,120})`")
_PATH_BARE = re.compile(r"(?<![\w./~-])((?:[\w-]+/)+[\w.-]+\.[A-Za-z0-9]{1,6})")
_ID_Y = re.compile(r"^(REGRESS-\d{4}-)(\d+)$")
_ID_N = re.compile(r"^(REGRESS-)(\d+)$")


def find_project_dir():
    """三段式定位（与 boundary_guard 同惯例）：PROJECT_DIR env → cwd → 向上找 .regress。"""
    start = (os.environ.get("CLAUDE_PROJECT_DIR")
             or os.environ.get("ZCODE_PROJECT_DIR")
             or os.getcwd())
    d = os.path.abspath(start)
    for _ in range(10):
        if os.path.isdir(os.path.join(d, ".regress")):
            return d
        nxt = os.path.dirname(d)
        if nxt == d:
            break
        d = nxt
    return None


def _read_fm(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError:
        return None, ""
    parts = content.split("---", 2)
    if len(parts) < 3:
        return None, content
    return parts[1], content


def _fm_get(fm_text, key):
    m = re.search(rf"^{key}:\s*[\"']?(.+?)[\"']?\s*$", fm_text, re.M)
    return m.group(1).strip() if m else ""


def allocate_and_write(manifests_dir, title, content_fn):
    """编号分配临界区（v1.56，五标本之一机器收口）：扫号+落盘同锁。

    两桥并发批准时 flock 串行化临界区，不再撞号；AI 手写清单路径不经此函数
    （纪律位：plan.md 选号前 ls）。content_fn(mid, stem) → 清单全文。
    """
    from filelock import file_lock
    with file_lock(os.path.join(manifests_dir, "id-alloc")):
        mid, stem = next_id_and_name(manifests_dir, title)
        path = os.path.join(manifests_dir, stem + ".md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(content_fn(mid, stem))
    return mid, path


def next_id_and_name(manifests_dir, title):
    """扫现有清单自推编号，保持项目既有格式（REGRESS-YYYY-NNN / REGRESS-NNN）。"""
    import glob
    ids = []
    for p in glob.glob(os.path.join(manifests_dir, "*.md")):
        fm, _ = _read_fm(p)
        mid = _fm_get(fm or "", "id")
        if mid:
            ids.append(mid)
    year_fmt = [i for i in ids if _ID_Y.match(i)]
    if year_fmt:
        m = max((_ID_Y.match(i) for i in year_fmt), key=lambda x: int(x.group(2)))
        prefix, n = m.group(1), int(m.group(2)) + 1
    elif ids and all(_ID_N.match(i) for i in ids):
        n = max(int(_ID_N.match(i).group(2)) for i in ids) + 1
        prefix = "REGRESS-"
    else:
        prefix, n = "REGRESS-", 1
    mid = f"{prefix}{n:03d}"
    stem = f"{n:03d}-native-plan"
    if prefix != "REGRESS-":
        stem = f"{prefix.split('-')[1]}-{n:03d}-native-plan"
    return mid, stem


def extract_paths(plan_text, cap=12):
    """从计划文本尽力提取文件路径（反引号段优先，裸路径样 token 兜底）。

    过滤：先剥 URL（裸路径正则会把 x.y/a/b.py 从 https:// 里抠出来），
    不含 / 的丢弃（纯文件名无边界价值）、含空白丢弃。"""
    seen, out = set(), []
    text = re.sub(r"https?://\S+", " ", plan_text)
    cands = [m for m in _PATH_TICK.findall(text)]
    cands += [m for m in _PATH_BARE.findall(text)]
    for c in cands:
        c = c.strip().strip("`.,;:()[]")
        if not c or " " in c or "/" not in c or c.startswith("http"):
            continue
        if c not in seen:
            seen.add(c)
            out.append(c)
        if len(out) >= cap:
            break
    return out


def plan_title(plan_text):
    for line in plan_text.splitlines():
        s = line.strip().lstrip("#").strip()
        if s:
            return s[:60]
    return "原生计划（无标题）"


def looks_rejected(data):
    """拒绝载荷双保险之一：成功的 PostToolUse 也可能内含拒绝语义。"""
    tr = data.get("tool_response") or data.get("tool_result")
    if isinstance(tr, dict):
        err = tr.get("error") or tr.get("isError")
        if err:
            return True
    if isinstance(tr, str) and re.search(r"reject|denied|拒绝", tr, re.I):
        return True
    return False


def _ensure_field(content, key, value):
    """frontmatter 无则插（status 行后），有则原样——盖章既有清单时补 via/plan_hash。"""
    if re.search(rf"^{key}:", content, re.M):
        return content
    return re.sub(r"^(status:\s*\S+.*)$",
                  rf"\1\n{key}: {value}", content, count=1, flags=re.M)


def _build_manifest(mid, title, sid, plan, paths, at):
    sha = hashlib.sha1(plan.encode("utf-8", "ignore")).hexdigest()[:12]
    if paths:
        planned = "\n".join(
            f'  - id: F{i + 1}\n    file: "{p}"\n    type: from-plan'
            for i, p in enumerate(paths))
        bnote = f"边界由计划文本尽力提取（{len(paths)} 文件，cap 12）"
    else:
        planned = "[]"
        bnote = "计划文本未提取到路径——边界为空，一切靠 F3/track 扩界留痕兜底"
    body = f"""---
id: {mid}
requirement: "{title}"
status: in-progress
session: {sid}
tier: S
via: native-plan-bridge
plan_hash: {sha}
approved:
  at: "{at}"
  note: "原生计划模式批准转录（人在环即最高裁决，顾问预审豁免）"
created_at: {at[:10]}
planned_changes:
{planned}
actual_changes: []
test_results: {{}}
---

# 原生计划转录：{title}

> 以下为 ExitPlanMode 批准原文（证据律：验收判据以此为准，不改写）。

{plan}

## 脆弱点

### FP1: 原生转译边界尽力提取（kind: machine）
{bnote}。计划没料到的文件由 F3/track 回写（扩界留痕）兜底。
verify: 提交时门禁自跑测试全绿；F3 回写后边界闭合。
"""
    return body


def _active_by_session(manifests_dir, sid):
    """同 session 的活跃清单（最新的优先）：返回 (via_native 的, planning 的)。"""
    import glob
    native, planning = None, None
    for p in sorted(glob.glob(os.path.join(manifests_dir, "*.md")), reverse=True):
        fm, content = _read_fm(p)
        if not fm:
            continue
        status = _fm_get(fm, "status")
        if status not in ACTIVE:
            continue
        if _fm_get(fm, "session") != sid:
            continue
        if _fm_get(fm, "via") == "native-plan-bridge":
            native = native or (p, fm, content)
        elif status == "planning":
            planning = planning or (p, fm, content)
        if native and planning:
            break
    return native, planning


def _receipt(mid, n=0):
    """additionalContext 回执（v1.52 试验位 → v1.79 转默认开）。

    契约已源码证实（2026-09-20 ZCode 3.14.0 开源仓考证）：PostToolUse 的
    additionalContext 经 call-runner appendHookAdditionalContexts 拼进工具
    结果尾；hookSpecificOutput.hookEventName 须严格匹配事件名（本实现合规）；
    stdout 以 { 开头才被解析且须唯一 JSON 输出（本文件唯一 stdout print 即此）。
    逃生：RG_PLAN_BRIDGE_RECEIPT=off/0/false。"""
    if os.environ.get("RG_PLAN_BRIDGE_RECEIPT", "").lower() in ("off", "0", "false"):
        return
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": f"📋 原生计划已转录为清单 {mid}"
                                 f"（via:native-plan-bridge，边界尽力提取 {n} 文件）"
                                 f"——边界守卫与提交门禁已对该任务激活",
        }}, ensure_ascii=False))


def do_post(project_dir, data, sid):
    import datetime
    manifests_dir = os.path.join(project_dir, ".regress", "manifests")
    os.makedirs(manifests_dir, exist_ok=True)
    plan = (data.get("tool_input") or {}).get("plan") or ""
    if not plan:
        return
    if looks_rejected(data):  # 双保险：成功事件内含拒绝语义 → 按拒绝处理
        _fossil(project_dir, plan, sid)
        return
    title = plan_title(plan)
    sha = hashlib.sha1(plan.encode("utf-8", "ignore")).hexdigest()[:12]
    at = datetime.datetime.now().isoformat(timespec="seconds")
    native, planning = _active_by_session(manifests_dir, sid)
    if native:
        path, fm, _ = native
        if _fm_get(fm, "plan_hash") == sha:  # 幂等键命中：重复事件 no-op
            return
        paths = extract_paths(plan)
        mid = _fm_get(fm, "id")
        content = _build_manifest(mid, title, sid, plan, paths, at)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)  # 计划修订：整档重写，approved 保留原批准时刻语义由重建承担
        if journal_append:
            journal_append("plan_refined", start_dir=project_dir,
                           manifest_id=mid, via="native-plan-bridge",
                           plan_hash=sha)
        _receipt(mid, len(paths))
        return
    if planning:
        path, fm, content = planning
        mid = _fm_get(fm, "id")
        try:  # 复用批准盖章三件套（plan_approve 单一来源）
            from plan_approve import _apply, _stamp_session
            content = _apply(content, "in-progress", at,
                             "原生计划模式批准（人在环即最高裁决，顾问预审豁免）")
            content = _stamp_session(content, os.path.dirname(path))
        except ImportError:
            content = re.sub(r"^status:\s*planning\s*$", "status: in-progress",
                             content, count=1, flags=re.M)
        content = _ensure_field(content, "via", "native-plan-bridge")
        content = _ensure_field(content, "plan_hash", sha)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        if journal_append:
            journal_append("plan_approved", start_dir=project_dir,
                           manifest_id=mid, via="native-plan-bridge",
                           plan_hash=sha, note="dual-track: 盖章既有 planning 清单")
        _receipt(mid)
        return
    paths = extract_paths(plan)
    mid, _ = allocate_and_write(
        manifests_dir, title,
        lambda m, s: _build_manifest(m, title, sid, plan, paths, at))
    if journal_append:
        journal_append("plan_approved", start_dir=project_dir, manifest_id=mid,
                       via="native-plan-bridge", plan_hash=sha)
    _receipt(mid, len(paths))


def _fossil(project_dir, plan, sid, kind="design_rejected"):
    if not journal_append:
        return
    excerpt = plan.strip().replace("\n", " ")[:200]
    journal_append(kind, start_dir=project_dir, via="native-plan-bridge",
                   session=sid, title=plan_title(plan), excerpt=excerpt)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    mode = argv[0] if argv else "post"
    if os.environ.get("REGRESS_PLAN_BRIDGE", "").lower() in ("off", "0", "false"):
        return 0
    try:
        raw = sys.stdin.read() if not sys.stdin.isatty() else ""
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        data = {}
    if "PlanMode" not in str(data.get("tool_name", "")):  # matcher 已滤，防御
        return 0
    project_dir = find_project_dir()
    sid = (sid_from_env() if sid_from_env else None) or "default"
    if not project_dir:  # 未接入项目：桥不惊动（无 .regress 不建产物）
        return 0
    try:
        if mode == "fail":
            plan = (data.get("tool_input") or {}).get("plan") or ""
            if plan:
                _fossil(project_dir, plan, sid)
        else:
            do_post(project_dir, data, sid)
    except Exception as e:  # best-effort：桥是增强不是依赖
        print(f"plan_bridge: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
