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
- 双轨合一：同 session 已有 /regress-plan 的 planning 清单 → 直接盖章它
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
from host_env import ensure_utf8_stdio  # noqa: E402

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
# tongtu 2026-11-03 改制（commit 6078f33）：REGRESS-YYMMDD-hex4（尾段随机）。
# 独立编号空间——不与旧 NNN 续编，按其约定铸号（当日+随机尾+存在性防撞）。
_ID_NEW = re.compile(r"^REGRESS-(\d{6})-([0-9a-f]{4,8})$")  # 批190：4→8 hex（公网 issue#1①，万级日量）


def find_project_dir():
    """三段式定位（与 boundary_guard 同惯例）：PROJECT_DIR env → cwd → 向上找 .regress。"""
    start = (os.environ.get("ZCODE_PROJECT_DIR")
             or os.environ.get("CLAUDE_PROJECT_DIR")
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
    new_fmt = [i for i in ids if _ID_NEW.match(i)]
    if year_fmt:
        m = max((_ID_Y.match(i) for i in year_fmt), key=lambda x: int(x.group(2)))
        prefix, n = m.group(1), int(m.group(2)) + 1
    elif new_fmt:
        # 批187（tongtu 改制兼容审计必改项）：混合目录下原逻辑 all(_ID_N) 为
        # False 落 else 铸 REGRESS-001——与冻结旧空间撞车。新格式在场即按
        # 新约定铸号：当日 YYMMDD + 随机 hex4 + 存在性双查防撞。
        import glob as _g
        import random
        import time as _t
        for _ in range(8):
            hex8 = "%08x" % random.randint(0, 0xFFFFFFFF)  # 批190：8 hex（4 位万级日量裸碰撞≈100%）
            ymd = _t.strftime("%y%m%d")
            stem = f"{ymd}-{hex8}-native-plan"
            if not _g.glob(os.path.join(manifests_dir, stem + ".md")):
                return f"REGRESS-{ymd}-{hex8}", stem
        raise RuntimeError("新格式编号 8 次随机均撞——清单目录异常")
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


# 批155 体量分档（顾问两口径：计数=去重后真实触碰文件，滤锁/生成物；
# 环境类命中保守保留——非对称风险下偏保守：误判 M 代价=多填骨架，
# 漏判 M 代价=重批零验收）
_TIER_GEN = re.compile(
    r"(?:^|/)(?:node_modules|dist|build|coverage|__pycache__|\.next|vendor)/"
    r"|-(?:lock|checksum)\.(?:json|yaml|toml)$"
    r"|\.lockb?$|pnpm-lock|yarn\.lock|package-lock\.json")
_TIER_ENV = re.compile(
    r"docker-compose|dockerfile|\.env$|\.env\.|/deploy/|\.ya?ml$|\.sql$"
    r"|migrat|schema|package\.json$", re.I)


def _tier_for_paths(paths):
    """体量分档：滤生成物后 ≥4 文件，或环境类文件命中 → M；否则 S。

    只升不降由调用方处理（修订路径）。L 档无机器信号仍靠 plan.md 流程。
    """
    real = [p for p in (paths or []) if not _TIER_GEN.search(p)]
    if len(real) >= 4 or any(_TIER_ENV.search(p) for p in real):
        return "M"
    return "S"


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
        bnote = "计划文本未提取到路径——边界为空，一切靠 F3/track 回写（扩界留痕）兜底"
    # 批155：体量分档（≥4 真实文件或环境类命中→M），M 档骨架前置——
    # 实施期照骨架填、提交期天然合规（一次成本零来回，快节奏与根治的交汇）
    tier = _tier_for_paths(paths)
    card = (paths[0].rsplit("/", 1)[0] if "/" in (paths or [""])[0]
            else "（paths 无目录信号，实施期具体化）")
    if tier == "M":
        fm_extra = f"""rollback: "git revert 即回滚"
understood_intent:
  复述: "{title}"
  边界: "计划原文见正文（批准版为准）；不做事项以计划原文为准"
  判据: "验收标准节 EARS 表"
scan:
  entry: "计划原文转录（原生计划模式人在环批准）"
  test: "项目测试套件（门禁 6 节自跑）"
  card: "{card}"
"""
        body_extra = """
## 验收标准（EARS-lite·骨架——实施期逐行填+验证后行尾勾 ✅）

- When <条件>，则 <可观察结果>（验：<命令>）
（重批已按体量标 M——此节提交前须有真实判据行且全勾，缺节/未勾会被门禁拦）

## 深查节（骨架——提交前每问一行实答）

- 反问一·验证位错位：
- 反问二·判据外推：
- 反问三·心虚探测：
"""
    else:
        fm_extra = ""
        body_extra = ""
    body = f"""---
id: {mid}
requirement: "{title}"
status: in-progress
session: {sid}
tier: {tier}
{fm_extra}via: native-plan-bridge
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
{body_extra}
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
            # v1.108 §17：no-op 分支顺带对账化石——清单写成功而 journal 写崩的
            # 中间态在此自愈（补写幂等，双跑仍一条）
            _repair_fossils(project_dir, _fm_get(fm, "id"), sha)
            return
        paths = extract_paths(plan)
        mid = _fm_get(fm, "id")
        content = _build_manifest(mid, title, sid, plan, paths, at)
        # 批155：修订只升不降（旧 M 新计划变小→保持 M——档位是既成治理承诺，
        # 降档须人裁 track 显式改；升档自动+留痕）
        old_tier = (_fm_get(fm, "tier") or "S").upper()
        new_tier = _fm_get(re.search(r"^---\n(.*?)\n---", content, re.S)
                           .group(1), "tier") or "S"
        if old_tier == "M" and new_tier == "S":
            content = re.sub(r"^tier: S$", "tier: M  # 修订降档防护：原 M 保持（降档须人裁）",
                             content, count=1, flags=re.M)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)  # 计划修订：整档重写，approved 保留原批准时刻语义由重建承担
        if journal_append:
            journal_append("plan_refined", start_dir=project_dir,
                           manifest_id=mid, via="native-plan-bridge",
                           plan_hash=sha, **_run_kw(fm))
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
                           plan_hash=sha, note="dual-track: 盖章既有 planning 清单",
                           **_run_kw(fm))
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


def _run_kw(fm):
    """run 锚（v2.0.0 批162）：清单带 run: 字段则 journal 事件带 run_id
    （自迭代 run/哨兵轮次的因果链）；无 run 不带。"""
    r = _fm_get(fm or "", "run")
    return {"run_id": r} if r else {}


def _repair_fossils(project_dir, mid, sha):
    """幂等重入自愈（v1.108 批160，PHILOSOPHY §17 化石面）：清单写成功而
    journal 写崩过的中间态，重入时按幂等键对账补写缺失化石——崩溃窗口在
    下一次重入闭合（病灶：桥的 journal 写无守卫，plan_approved 曾会永久丢失）。

    判定：无 plan_approved（创建即崩）→ 补 approved；approved 在而其
    plan_hash ≠ 当前 sha（当前形态来自修订重写）且无对应 plan_refined →
    补 refined。查账失败宁可不补（守卫是增强，宁缺勿重）。"""
    if not journal_append:
        return
    try:
        from journal import load_journal
        events = load_journal(project_dir)
    except Exception:
        return
    approved = next((e for e in events
                     if e.get("kind") == "plan_approved"
                     and e.get("manifest_id") == mid), None)
    if approved is None:
        journal_append("plan_approved", start_dir=project_dir, manifest_id=mid,
                       via="native-plan-bridge", plan_hash=sha,
                       note="repair: 幂等重入补写（原写崩溃窗口，v1.108）")
        return
    if approved.get("plan_hash") != sha and not any(
            e.get("kind") == "plan_refined"
            and e.get("manifest_id") == mid
            and e.get("plan_hash") == sha for e in events):
        journal_append("plan_refined", start_dir=project_dir, manifest_id=mid,
                       via="native-plan-bridge", plan_hash=sha,
                       note="repair: 幂等重入补写（原写崩溃窗口，v1.108）")


def _fossil(project_dir, plan, sid, kind="design_rejected"):
    if not journal_append:
        return
    excerpt = plan.strip().replace("\n", " ")[:200]
    journal_append(kind, start_dir=project_dir, via="native-plan-bridge",
                   session=sid, title=plan_title(plan), excerpt=excerpt)


def main(argv=None):
    ensure_utf8_stdio()  # 批191：cp936 流垫片（emoji/中文输出根治）
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
    try:
        # 批135：定位两行入 try（原在 try 外——find_project_dir/sid 崩=exit 1）
        project_dir = find_project_dir()
        sid = sid_from_env() or "default"
        if not project_dir:  # 未接入项目：桥不惊动（无 .regress 不建产物）
            return 0
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
