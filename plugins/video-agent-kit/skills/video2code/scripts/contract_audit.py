#!/usr/bin/env python3
"""video2code 契约审计 — 规则只此一份, 防漂移。

调用方只有模型自查 (video2game / video2fullstack 的收尾): 收尾前自己跑
`python3 <plugin_root>/skills/video2code/scripts/contract_audit.py`, 按缺口清单
补完, 全绿再填 report。跑批的完成判定不读这里的文件, 只要求最终构建通过, 视觉
与交互质量另行检查。

规则 (gap = 契约缺口, 未闭环; warn = 观测项, 不拦):
  C1 覆盖率     plan.md 每个 [S#]/[D#] 在 verify.jsonl 的最终状态是 pass|defer;
                且该状态必须写在字面量 `result` 键上、值在 pass|fail|defer 内 —
                写 verdict/status 或写 partial/ok 的行等于没验证, 旧口径只查
                "有记录且不是 fail" 会给这类行放绿灯。
  C2 report     out/report.md 存在且已填 (V2C_REPORT_SKELETON marker 已删)
  C3 D 项成对   [D] id 最终 pass 行的 evidence 必须在 out/cmp/ 下且文件存在
                (matched-beat SRC|REP 带, 用同目录的 composite.py 拼)
  C4 证据归属   [D] id 最终 pass 行的 evidence 文件名须含本 id (合并命名如
                D4_D12 合法) — 引别的 id 的产物 = 该 id 没验过
  C5 新鲜度     存在终态证据早于最后一次 app/src 编辑 **且** 该次编辑后 out/
                下没有任何新取证文件 → 缺口 (最后的编辑没买锚点重拍轮)。
  C6 锚点新鲜度 {core} id 的终态证据早于最后一次 src 编辑 → 缺口, 即使其后有
                新取证 — 锚点不允许 "目测无分歧保旧线" (SKILL §4.2/§4.3),
                必须从编辑后的重拍取证逐 id 追加 fresh 行。
  C7 账面纯度   pass 行的 diffs 内仍残留 disposition=fix 项 → 缺口 —
                "pass is legal only while nothing is left at fix" (§4.2)。
  C8 资产溯源   产物里的动态资产 (视频/gif/帧序列) 必须逐个对上 plan.md 某条
                {footage} 行的 asset= 声明; {render} 行不得带 asset=;
                {footage} 行须给源 clip 时间段; plan 判定 WebGL 却无 three
                依赖 = 场景层根本没建。
                规则针对的是 "用源自身像素顶替实时渲染" — 源页面真在播视频
                (hero reel / hover 预览) 时 ship 视频资产是正确复刻, 声明即可。
  W1 (warn)     [S] id 终态证据不在 out/cmp/ (自引用观测, 先不拦)
  W2 (warn)     [S] id 证据文件名不含本 id (一图证一节的多个 S id 是合法用法)
  W3 (warn)     {detail} id 终态证据早于最后一次 src 编辑但其后有新取证 —
                非锚点且编辑未波及其区域时保旧线合法, 波及则应补拍重判
  W4 (warn)     evidence 字段不是纯路径 (含注解/多路径拼接) — 审计已尽力解析,
                但注解应写进 measured/reason
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

_ID_RE = re.compile(r"^\s*(?:[-*]\s*)?\[([SD]\d+)\]", re.MULTILINE)
_TAG_LINE_RE = re.compile(r"^\s*(?:[-*]\s*)?\[([SD]\d+)\].*\{(core|detail)\}",
                          re.MULTILINE)
_SRC_TAG_RE = re.compile(r"\{(render|footage)\}")
_PLAN_LINE_RE = re.compile(r"^[ \t]*(?:[-*][ \t]*)?\[([SD]\d+)\]", re.MULTILINE)
_ASSET_DECL_RE = re.compile(r"asset\s*=\s*([^\s,;)\]]+)", re.IGNORECASE)
# "source clip 5.2–6.0s" / "clip 12-14s" / "@6.8s" — {footage} 判据须引源时间段
_CLIP_CITE_RE = re.compile(r"\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?\s*s|@\s*\d+(?:\.\d+)?\s*s",
                           re.IGNORECASE)
_CAPTURE_PATH_RE = re.compile(r"\S+\.(?:png|jpe?g|webp|mp4|webm|gif)", re.IGNORECASE)
_SKELETON_MARK = "V2C_REPORT_SKELETON"
_CAPTURE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".gif"}

# C8: 动态资产 = 源自身运动像素的各种马甲 (mp4 / gif / 动图 / 帧序列)
_MOTION_EXTS = {".mp4", ".webm", ".mov", ".m4v", ".ogv", ".gif", ".apng"}
# name_0001.png 形态; 同目录同前缀 ≥ _SEQ_MIN 个 = 一份帧序列
_FRAME_SEQ_RE = re.compile(r"^(.*?)[._-]?(\d{2,})$")
_SEQ_MIN = 8
_SEQ_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".avif"}
# WebGL 判定词 (plan.md 里模型自己写下的) — 命中即要求 three 依赖。
# 必须排除否定式: 实测 page_h 80 个产物里 7 个 plan 写着 "Not a WebGL page"
# / "Not WebGL:" / "no WebGL", 裸匹配会把这 7 个完好产物全判成 void。
_WEBGL_HINT_RE = re.compile(r"webgl|three\.js|threejs|default-3d|raymarch", re.IGNORECASE)
_WEBGL_NEG_RE = re.compile(
    r"(?:not|no|never|isn'?t|aren'?t|non-|without|avoid|skip)\s+(?:\w+[\s-]+){0,2}$",
    re.IGNORECASE)



def _project_dir(argv_dir: str | None) -> Path:
    p = argv_dir or os.environ.get("VE_PROJECT_DIR") \
        or os.environ.get("V2C_PROJECT_DIR")
    pd = Path(p).resolve() if p else Path.cwd().resolve()
    # cwd 容错: 从 app/ 等子目录跑时向上找到含 out/plan.md 的项目根
    if not (pd / "out" / "plan.md").is_file():
        for parent in pd.parents:
            if (parent / "out" / "plan.md").is_file():
                return parent
    return pd


def _plan_ids(plan_text: str) -> list[str]:
    seen: list[str] = []
    for i in _ID_RE.findall(plan_text):
        if i not in seen:
            seen.append(i)
    return seen


def _weight_tags(plan_text: str) -> dict[str, str]:
    """id -> core|detail (plan 行尾的权重标签; 未标记的 id 不入 dict)。"""
    tags: dict[str, str] = {}
    for rid, tag in _TAG_LINE_RE.findall(plan_text):
        tags.setdefault(rid, tag)
    return tags


def _source_tags(plan_text: str) -> dict[str, str]:
    """id -> render|footage (来源标签)。未标记的 id 不入 dict; 调用方按
    "缺省即 render" 处理 (SKILL Phase 3: 存疑归 render)。"""
    tags: dict[str, str] = {}
    for rid, block in _plan_lines(plan_text).items():
        m = _SRC_TAG_RE.search(block)
        if m:
            tags[rid] = m.group(1).lower()
    return tags


def _plan_lines(plan_text: str) -> dict[str, str]:
    """id -> 该 id 的完整 plan 条目 (从 [id] 起到下一个 [id]/章节标题为止)。
    按块而非按行取: plan 条目常换行续写, 207 那种把 asset= 和 {core} 写在
    第 5 行的写法, 单行正则会整条漏掉。"""
    starts: list[tuple[str, int]] = [
        (m.group(1), m.start()) for m in _PLAN_LINE_RE.finditer(plan_text)]
    blocks: dict[str, str] = {}
    for i, (rid, pos) in enumerate(starts):
        end = starts[i + 1][1] if i + 1 < len(starts) else len(plan_text)
        block = plan_text[pos:end]
        # 章节标题截断: 条目不会跨过 "## ..." 继续
        h = re.search(r"^#{1,6}\s", block[1:], re.MULTILINE)
        if h:
            block = block[:h.start() + 1]
        blocks.setdefault(rid, block)
    return blocks



def _claims_webgl(plan_text: str) -> bool:
    """plan.md 里有没有 **肯定式** 的 WebGL/three 判定。
    "Not a WebGL page" / "no WebGL" 这类否定句不算 — 绝大多数 2D 页面的 plan
    都会显式写一句否定, 裸匹配等于把它们全部误判。"""
    for m in _WEBGL_HINT_RE.finditer(plan_text):
        if not _WEBGL_NEG_RE.search(plan_text[max(0, m.start() - 48):m.start()]):
            return True
    return False


def _norm_asset(p: str) -> str:
    """asset= 声明与磁盘路径归一到 basename — 声明写 /assets/hero.mp4、
    public/assets/hero.mp4 或 hero.mp4 都算同一份。"""
    return Path(p.strip().strip("\"'`")).name.lower()


def _motion_assets(public_dir: Path) -> tuple[list[str], set[Path]]:
    """public/ 下的动态资产 -> (代表路径列表, 被判为帧序列成员的文件集合)。
    视频/动图逐个算一份; 帧序列整组算一份 (代表路径 = 首帧)。成员集合回给调用方,
    免得同一组帧在后续逐文件检查里再刷一遍屏。"""
    found: list[str] = []
    members_all: set[Path] = set()
    if not public_dir.is_dir():
        return found, members_all
    seq_groups: dict[tuple[str, str], list[Path]] = {}
    for p in sorted(public_dir.rglob("*")):
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        if ext in _MOTION_EXTS:
            found.append(p.relative_to(public_dir).as_posix())
        elif ext in _SEQ_EXTS:
            m = _FRAME_SEQ_RE.match(p.stem)
            if m and m.group(1):
                seq_groups.setdefault((p.parent.as_posix(), m.group(1) + ext), []).append(p)
    for members in seq_groups.values():
        if len(members) >= _SEQ_MIN:
            found.append(members[0].relative_to(public_dir).as_posix())
            members_all.update(members)
    return found, members_all


def _evidence_paths(ev: str) -> list[str]:
    """从 evidence 字段解析取证文件路径。纯路径原样返回; 含注解/多路径
    拼接 ("a.png (bottom) + b.png") 时尽力提取全部路径 token。"""
    ev = ev.strip()
    if not ev:
        return []
    if " " not in ev and "(" not in ev:
        return [ev]
    return [m.group(0).rstrip(",;)") for m in _CAPTURE_PATH_RE.finditer(ev)] or [ev]


def _final_records(verify_text: str) -> dict[str, dict]:
    """每个 id 的最后一行 (现行状态)。"""
    last: dict[str, dict] = {}
    for line in verify_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(obj, dict) and obj.get("id"):
            last[str(obj["id"])] = obj
    return last


def _fail_rounds(verify_text: str) -> dict[str, int]:
    """每个 id 的 fail 行数 (≈ 修复轮数, 导出分层用)。"""
    n: dict[str, int] = {}
    for line in verify_text.splitlines():
        try:
            obj = json.loads(line.strip())
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(obj, dict) and obj.get("result") == "fail" and obj.get("id"):
            n[str(obj["id"])] = n.get(str(obj["id"]), 0) + 1
    return n


def _name_has_id(path: str, rid: str) -> bool:
    """文件名含 id, 词元级匹配: S1 不命中 S12_*, D9 不命中 D9x 之外照常。"""
    return re.search(rf"(?i)(?<![a-z0-9]){re.escape(rid)}(?![0-9])",
                     Path(path).name) is not None


def _newest_mtime(root: Path, exts: set[str] | None = None) -> float:
    newest = 0.0
    if not root.is_dir():
        return newest
    for p in root.rglob("*"):
        if p.is_file() and (exts is None or p.suffix.lower() in exts):
            try:
                newest = max(newest, p.stat().st_mtime)
            except OSError:
                pass
    return newest


def audit(project_dir: Path) -> dict:
    """返回 {gaps: [...], warnings: [...], stats: {...}}; gaps 空 = 契约闭环。"""
    pd = Path(project_dir)
    out = pd / "out"
    plan_p, verify_p, report_p = out / "plan.md", out / "verify.jsonl", out / "report.md"
    gaps: list[str] = []
    warns: list[str] = []
    stats: dict = {}

    if not plan_p.is_file():
        # 没进入契约流程 (非复刻任务); 交由调用方决定语义
        return {"gaps": [], "warnings": [], "stats": {"plan_exists": False},
                "not_applicable": True}
    plan_text = plan_p.read_text(encoding="utf-8", errors="ignore")
    verify_text = verify_p.read_text(encoding="utf-8", errors="ignore") \
        if verify_p.is_file() else ""
    ids = _plan_ids(plan_text)
    final = _final_records(verify_text)
    stats["plan_exists"] = True
    stats["n_ids"] = len(ids)
    stats["fix_rounds"] = _fail_rounds(verify_text)

    # C1 覆盖率
    unverified = [i for i in ids if i not in final]
    failing = [i for i in ids if final.get(i, {}).get("result") == "fail"]
    # C1 字面量: 有记录不等于验证过 — 状态键必须叫 result, 值必须在枚举内。
    # 旧口径只查"有记录 + 不是 fail", 于是写 verdict/status 的行一路绿灯过审计,
    # 而管线 _closure_tier 读 result 拿到空 → 记 missing → 判 partial。一边全绿
    # 一边不合格就是这么来的 (peanut_260731 64 条非 verified 里 63 条是纯键漂移)。
    drifted: list[str] = []
    out_of_range: list[str] = []
    for i in ids:
        rec = final.get(i)
        if not rec:
            continue
        if "result" not in rec:
            alias = next((k for k in ("verdict", "status", "outcome", "state")
                          if k in rec), None)
            drifted.append(f"{i}(写成 {alias})" if alias else i)
        elif rec.get("result") not in ("pass", "fail", "defer"):
            out_of_range.append(f"{i}({rec.get('result')!r})")
    if unverified:
        gaps.append(f"C1 未验证 (verify.jsonl 无记录): {', '.join(unverified)}")
    if drifted:
        gaps.append("C1 状态键不是 result — 这些 id 的终态行等于没验证 (管线按 missing 记), "
                    "把该键改名为 result 重新追加一行: " + ", ".join(drifted))
    if out_of_range:
        gaps.append("C1 result 值越界 (只允许 pass / fail / defer, 没有第四种状态; "
                    "settle 不了的是 defer 并给 reason): " + ", ".join(out_of_range))
    if failing:
        gaps.append("C1 最后状态仍是 fail (修复后追加 pass, 或到 cap 后追加 defer): "
                    + ", ".join(failing))

    # C2 report
    if not report_p.is_file():
        gaps.append("C2 out/report.md 不存在 (shipped / deployed url / deferred 清单)")
    elif _SKELETON_MARK in report_p.read_text(encoding="utf-8", errors="ignore"):
        gaps.append("C2 out/report.md 仍是骨架 (含 V2C_REPORT_SKELETON marker): "
                    "填入实际内容并删除该 marker 行")

    # C3/C4 (D 项) + C7 账面纯度 + W1/W2 (S 项观测) + 证据存在性
    ev_paths: dict[str, list[Path]] = {}   # id -> 终态 evidence 解析后的存在文件
    n_selfref_s = n_selfref_d = n_fix_residue = 0
    annotated_ids: list[str] = []
    for rid in ids:
        rec = final.get(rid)
        if not rec or rec.get("result") != "pass":
            continue  # defer/fail/缺记录 → C1 管; defer 不需要成对证据
        residue = [d for d in (rec.get("diffs") or [])
                   if isinstance(d, dict)
                   and str(d.get("disposition", "")).strip().lower().startswith("fix")]
        if residue:
            n_fix_residue += 1
            what = str(residue[0].get("what", ""))[:60]
            gaps.append(
                f"C7 {rid} 的 pass 行 diffs 内仍残留 disposition=fix 项"
                f" ({what or '?'}{' 等' if len(residue) > 1 else ''}) — "
                "pass 仅在无 fix 残留时合法 (§4.2): 已修好→引用新证据追加干净 pass 行; "
                "未修→改记 fail 进修复环, 或到 cap 后诚实 defer")
        ev = str(rec.get("evidence") or "")
        parts = _evidence_paths(ev)
        if parts and (len(parts) > 1 or parts[0] != ev.strip()):
            annotated_ids.append(rid)
        resolved = [(pd / p) if not p.startswith("/") else Path(p) for p in parts]
        existing = [p for p in resolved if p.is_file()]
        ev_paths[rid] = existing
        in_cmp = any("/cmp/" in f"/{p}" for p in parts)
        is_d = rid.startswith("D")
        if not in_cmp:
            if is_d:
                n_selfref_d += 1
                gaps.append(
                    f"C3 {rid} 的收行证据 {ev or '(空)'} 不是 out/cmp/ 下的成对对比图 — "
                    f"在源片和你的录像里各取同一拍的帧 (same beat), 用同目录的 "
                    f"composite.py <源帧> <复刻帧> --out out/cmp/{rid}_....png --label "
                    "拼出 SRC|REP 带后追加新 pass 行")
            else:
                n_selfref_s += 1
                warns.append(f"W1 {rid} 终态证据不在 out/cmp/ ({ev}) — S 项建议同尺度成对图")
        if parts:
            missing = [str(p) for p, r in zip(parts, resolved) if not r.is_file()]
            if missing:
                gaps.append(f"C3 {rid} 证据文件不存在: {', '.join(missing)}")
            elif in_cmp and not any(_name_has_id(p, rid) for p in parts):
                if is_d:
                    gaps.append(f"C4 {rid} 的证据文件名不含本 id ({Path(parts[0]).name}) — "
                                f"每个 id 的检查要真的跑过; 引用共享产物请以合并名命名 "
                                f"(如 {rid}_D#_*.png) 并确认该产物确实覆盖 {rid}")
                else:
                    warns.append(f"W2 {rid} 证据文件名不含本 id ({Path(parts[0]).name}); "
                                 "一图证一节的多个 S id 属合法用法, 仅提示")
    if annotated_ids:
        warns.append("W4 evidence 字段不是纯路径 (含注解或多路径拼接), 审计已尽力解析: "
                     + ", ".join(annotated_ids[:8])
                     + " — 注解请写进 measured/reason, evidence 只放产物路径")
    stats["n_evidence"] = len(ev_paths)
    stats["n_selfref_d"] = n_selfref_d
    stats["n_selfref_s"] = n_selfref_s
    stats["n_selfref_evidence"] = n_selfref_d + n_selfref_s  # P4 兼容口径
    stats["n_pass_fix_residue"] = n_fix_residue

    # C5/C6/W3 新鲜度 (联看口径; 锚点={core} 按 B2 不允许保旧线)
    tags = _weight_tags(plan_text)
    newest_src = _newest_mtime(pd / "app" / "src")
    newest_capture = _newest_mtime(out, _CAPTURE_EXTS)
    n_stale = n_missing_ev = 0
    stale_ids: list[str] = []
    for rid, existing in ev_paths.items():
        if not existing:
            n_missing_ev += 1
            continue
        try:
            if max(p.stat().st_mtime for p in existing) < newest_src:
                n_stale += 1
                stale_ids.append(rid)
        except OSError:
            n_missing_ev += 1
    stale_core = [r for r in stale_ids if tags.get(r) == "core"]
    stale_rest = [r for r in stale_ids if tags.get(r) != "core"]
    stats["n_stale_evidence"] = n_stale
    stats["n_stale_core"] = len(stale_core)
    stats["n_evidence_missing"] = n_missing_ev
    stats["newest_src_mtime"] = newest_src
    stats["newest_capture_mtime"] = newest_capture
    if n_stale and newest_src and newest_capture < newest_src:
        gaps.append(
            f"C5 最后一次 app/src 编辑之后没有任何新取证, 而 {n_stale} 个终态证据"
            f"早于该次编辑 ({', '.join(stale_ids[:8])}) — 证据认证的是没发布过的旧构建。"
            "重拍锚点集 (一轮批量截图/录像), 逐锚点 id 重判并追加新行")
    else:
        if stale_core:
            gaps.append(
                f"C6 {len(stale_core)} 个 {{core}} 锚点 id 的终态证据早于最后一次 "
                f"src 编辑: {', '.join(stale_core[:8])} — 锚点不允许 \"目测无分歧"
                "保旧线\" (§4.2/§4.3): 用编辑后的重拍取证逐 id 重判, 每个 id 追加"
                " fresh 行 (无分歧也要落行)")
        if stale_rest:
            warns.append(
                f"W3 {len(stale_rest)} 个 {{detail}} id 终态证据早于最后一次 src 编辑"
                f"但其后有新取证: {', '.join(stale_rest[:8])} — 非锚点且编辑未波及其"
                "区域时保旧线合法; 若该编辑波及同区块/共享视觉系统, 补拍重判")

    # C8 资产溯源: 产物里的动态资产必须逐个对上 plan 的 {footage} 声明。
    # 治的是 "把源自身的运动像素顶替实时渲染" (轨迹 203: 整站 three.js 场景被
    # 7 段 ffmpeg 切出来的源录屏替代)。
    # 源页面本身在播视频 (hero reel / hover 预览) 是合法的 —— 声明即可放行。
    src_tags = _source_tags(plan_text)
    plan_lines = _plan_lines(plan_text)
    declared: dict[str, str] = {}     # 归一资产名 -> 声明它的 id
    for rid, line in plan_lines.items():
        tag = src_tags.get(rid, "render")
        decls = _ASSET_DECL_RE.findall(line)
        if tag == "footage":
            if not decls:
                gaps.append(
                    f"C8 {rid} 标了 {{footage}} 但没写 asset= — {{footage}} 行必须声明"
                    " 要 ship 的文件 (asset=/assets/<name>.mp4), 审计靠它与产物对账")
            if not _CLIP_CITE_RE.search(line):
                gaps.append(
                    f"C8 {rid} 的 {{footage}} 判据缺源 clip 时间段 — {{footage}} 是那条"
                    "便宜的路, 需正面证据: 在行内写出证明它是视频元素的源片段区间"
                    " (如 source clip 0.0–3.5s: 硬切/固定循环/与滚动无耦合)")
            for d in decls:
                declared.setdefault(_norm_asset(d), rid)
        elif decls:
            gaps.append(
                f"C8 {rid} 是 {{render}} 却带 asset={decls[0]} — {{render}} 区域的像素"
                "必须由代码运行时生成, 不能 ship 源自身的素材。若该区域实为源页面在"
                f"播视频, 把 {rid} 改标 {{footage}} 并补源 clip 判据; 否则删掉该资产改用代码实现")

    public_dir = pd / "app" / "public"
    motion_rel, _ = _motion_assets(public_dir)
    for rel in motion_rel:
        owner = declared.get(_norm_asset(rel))
        if owner is None:
            gaps.append(
                f"C8 app/public/{rel} 是动态资产, 但 plan.md 里没有任何 {{footage}} 行用"
                " asset= 声明它 — 未声明的运动素材一律视为 \"用源录屏顶替实时渲染\"。"
                "源页面真在播视频 → 给对应 id 标 {footage} + asset= + 源 clip 判据;"
                "否则删掉它, 用代码实现该效果 (帧序列/canvas 逐帧贴图同样不行)")

    if _claims_webgl(plan_text):
        pkg = pd / "app" / "package.json"
        has_three = False
        if pkg.is_file():
            try:
                pj = json.loads(pkg.read_text(encoding="utf-8", errors="ignore"))
                has_three = "three" in {**(pj.get("dependencies") or {}),
                                        **(pj.get("devDependencies") or {})}
            except (json.JSONDecodeError, ValueError, OSError):
                has_three = True   # 读不出来不冤枉
        if not has_three:
            gaps.append(
                "C8 plan.md 判定这是 WebGL/3D 页面, 但 app/package.json 没有 three 依赖 —"
                " 该组合只有一个含义: 场景层根本没建。按 3D 规则 (references/3d-notes.md) 用 default-3d 模板"
                " (init-webapp <title> default-3d) 手写 three 场景; 做不到源站保真度就降级"
                "实现并在 report.md Known-gaps 里写明, 不要用源录屏顶替")

    stats["n_motion_assets"] = len(motion_rel)
    stats["n_footage_declared"] = len(declared)
    stats["n_c8_gaps"] = sum(1 for g in gaps if g.startswith("C8 "))

    return {"gaps": gaps, "warnings": warns, "stats": stats}


def _mark_self_run(pd: Path) -> None:
    """模型主动自查留痕 (导出侧统计自查率); 管线跑传 --by=pipeline 不记。"""
    try:
        d = pd / ".v2c"
        d.mkdir(parents=True, exist_ok=True)
        with (d / "audit_runs.log").open("a") as f:
            f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')}\n")
    except OSError:
        pass


def main() -> None:
    args = [a for a in sys.argv[1:]]
    as_json = "--json" in args
    # --progress: 进度自查口径, 缺口清单照打但退出码恒 0。模型习惯把自查串在
    # `cat >> out/verify.jsonl <<EOF … EOF` 后面同轮跑 (省一轮, 是好习惯), 而
    # shell 取最后一条命令的退出码 → 追加明明成功, 整个 Bash 调用被标成
    # is_error。实测 atom_260731 里 1749 次串跑有 766 次这样被误标 (纯追加
    # 5305 次只报错 7 次), 轨迹里落下一堆"写台账失败"的假信号。
    # 管线 (--by=pipeline) 与 Stop hook 仍用默认退出码做闭环判定, 语义不变。
    progress = "--progress" in args
    by_pipeline = any(a.startswith("--by=") and a != "--by=model" for a in args)
    pos = [a for a in args if not a.startswith("--")]
    pd = _project_dir(pos[0] if pos else None)
    res = audit(pd)
    if not by_pipeline and not res.get("not_applicable"):
        _mark_self_run(pd)
    if as_json:
        print(json.dumps(res, ensure_ascii=False))
    else:
        if res.get("not_applicable"):
            print("out/plan.md 不存在 — 未进入复刻契约流程, 无可审计项。")
        elif res["gaps"]:
            print(f"契约未闭环, {len(res['gaps'])} 个缺口:")
            for g in res["gaps"]:
                print(f"  ✗ {g}")
        else:
            print("契约闭环 ✓ (覆盖率/成对证据/归属/新鲜度/资产溯源全部通过)")
        for w in res["warnings"]:
            print(f"  ⚠ {w}")
        if res.get("gaps"):
            # 审计输出必须自足: 缺口行已写明修复动作, 防模型转而通读本脚本源码
            # 找规则 (v2c_3d_gpu_smoke_v4 实测烧 3 轮 Bash 读源码)
            print("以上缺口清单即完整契约要求, 按行修复即可 — 无需阅读本脚本源码。")
    sys.exit(0 if progress else (1 if res["gaps"] else 0))


if __name__ == "__main__":
    main()
