"""stillview: still_crops + composite_view — 产图即内联, 消掉 Bash→Read 两轮定式。

动机 (两条轨迹的第三遍记账): crop/composite 的每次使用都是固定两轮 —
`Bash 跑 still.py/composite.py` → 下一轮 `Read` 产物 (121: ~5 对, 735: ~14 对)。
Bash 无法内联图片, 而同一轮里发 Bash+Read 违反 harness 契约 (同消息内工具调用
可并行执行, 依赖必须跨轮)。clip_video 早已是"产图即内联"形态, 这里补静帧侧的
对等物: 与 skills/video2code/scripts/{still,composite}.py 同逻辑同落盘命名
(脚本保留作 Bash 兜底通道), 产物路径照发 + 图片随 ToolResult 内联。
"""
from __future__ import annotations

from pathlib import Path

from .result import ToolResult
from .run_context import RunContext

# 单次抽帧上限: 与 server_common 内联上限 (16) 留余量, 也与 SKILL "a dozen
# parallel Reads" 的观察节奏一致 — 超过说明该用 clip_video 看时间窗了。
MAX_TIMES = 12

_VIDEO_EXTS = {".mp4", ".mov", ".webm", ".avi", ".mkv", ".m4v"}

# save_to 资产模式的缩略图回显宽度: 只为确认"切对了区域、无叠字污染",
# 不承担测量职能 (测量走全分辨率 inline 或 composite_view) — 压 token。
_ASSET_THUMB_W = 320
_ASSET_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def _asset_save(fr, save_to: str, ctx: RunContext, source_note: dict):
    """把帧存为 webapp 静态资产 (public/assets/<name>), 记 manifest, 产缩略图。

    返回 (asset_virtual_path, thumb_disk_path, err)。资产图本体不 inline —
    素材不需要进上下文, deploy 后 composite_view 自然验证; 缩略图只够确认区域。
    """
    import cv2
    name = Path(str(save_to)).name  # 只取 basename, 防路径穿越
    if not name:
        return None, None, "[ERROR] save_to 不能为空"
    if Path(name).suffix.lower() not in _ASSET_EXTS:
        name += ".png"
    if not ctx.app_dir.is_dir():
        return None, None, ("[ERROR] save_to 需要 webapp 已初始化 (app/ 不存在) — "
                            "先跑 init-webapp, 资产落 public/assets/ 才会进构建")
    assets_dir = ctx.app_dir / "public" / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    dst = assets_dir / name
    cv2.imwrite(str(dst), fr)
    # 溯源 manifest: 事后换帧重切/蒸馏侧审计的依据
    import json
    mf = ctx.work_dir / "assets_manifest.json"
    try:
        entries = json.loads(mf.read_text()) if mf.is_file() else []
        if not isinstance(entries, list):
            entries = []
    except Exception:
        entries = []
    entries = [e for e in entries if e.get("asset") != f"/assets/{name}"]
    entries.append({"asset": f"/assets/{name}", **source_note,
                    "size": [fr.shape[1], fr.shape[0]]})
    mf.write_text(json.dumps(entries, ensure_ascii=False, indent=1))
    # 缩略图
    h, w = fr.shape[:2]
    if w > _ASSET_THUMB_W:
        th = cv2.resize(fr, (_ASSET_THUMB_W, max(1, int(h * _ASSET_THUMB_W / w))),
                        interpolation=cv2.INTER_AREA)
    else:
        th = fr
    tdir = ctx.work_dir / "_asset_thumbs_"
    tdir.mkdir(parents=True, exist_ok=True)
    tp = tdir / f"thumb_{Path(name).stem}.jpg"
    cv2.imwrite(str(tp), th, [cv2.IMWRITE_JPEG_QUALITY, 80])
    return f"/assets/{name}", tp, None


def _parse_crop(raw) -> tuple[int, int, int, int] | None | str:
    """crop 入参 → (x,y,w,h) | None | 错误字符串。接受 [x,y,w,h] 数组或 "X,Y,W,H"。"""
    if raw in (None, "", []):
        return None
    vals = raw.split(",") if isinstance(raw, str) else raw
    try:
        x, y, w, h = (int(v) for v in vals)
    except (TypeError, ValueError):
        return f"[ERROR] crop 需要 X,Y,W,H 四个整数, 收到 {raw!r}"
    if w <= 0 or h <= 0:
        return f"[ERROR] crop 宽高必须为正: {raw!r}"
    return (x, y, w, h)


def _apply_crop_scale(fr, crop, scale):
    """还原 still.py 的裁剪+缩放语义 (越界夹取, 放大 CUBIC / 缩小 AREA)。"""
    import cv2
    if crop:
        fr = _slice(fr, crop)
        if fr is None:
            return None
    if scale != 1.0:
        fr = cv2.resize(fr, None, fx=scale, fy=scale,
                        interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)
    return fr


def _slice(img, box):
    """按 [x,y,w,h] 在本图自身像素坐标系裁剪, 越界夹取; 空区域返回 None。"""
    x, y, w, h = box
    ih, iw = img.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(iw, x + w), min(ih, y + h)
    if x1 <= x0 or y1 <= y0:
        return None
    return img[y0:y1, x0:x1]


def _draw_protractor(img, step=15, alpha=0.45):
    """叠半透明角度刻度环 (protractor): 0° 朝上、顺时针, 每 step° 一刻、90° 为主刻、
    45° 标度数, 中心十字。近旋转对称元素 (点阵环/密纹碟) 的转角一眼可读 —
    在 SRC|REP 两栏叠同一把量角器, 对齐特征读两侧刻度即得旋转量, 免反复抽帧目测。"""
    import math

    import cv2
    h, w = img.shape[:2]
    cx, cy = w // 2, h // 2
    R = max(8, int(0.45 * min(w, h)))
    ov = img.copy()
    C = (0, 255, 255)  # BGR 黄, 半透明叠加不挡底
    cv2.circle(ov, (cx, cy), R, C, 1, cv2.LINE_AA)
    for deg in range(0, 360, max(1, step)):
        a = math.radians(deg - 90)  # 0° 指正上, 顺时针增
        major = deg % 90 == 0
        r0 = int(R * (0.70 if major else 0.84))
        x1 = int(cx + r0 * math.cos(a)); y1 = int(cy + r0 * math.sin(a))
        x2 = int(cx + R * math.cos(a)); y2 = int(cy + R * math.sin(a))
        cv2.line(ov, (x1, y1), (x2, y2), C, 2 if major else 1, cv2.LINE_AA)
        if deg % 45 == 0:
            lx = int(cx + (R + 16) * math.cos(a)); ly = int(cy + (R + 16) * math.sin(a))
            cv2.putText(ov, str(deg), (lx - 10, ly + 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, C, 1, cv2.LINE_AA)
    cv2.drawMarker(ov, (cx, cy), C, cv2.MARKER_CROSS, 12, 1)
    cv2.addWeighted(ov, alpha, img, 1 - alpha, 0, img)
    return img


def still_crops(args: dict, ctx: RunContext):
    """从视频抽静帧 (可裁剪/放大) 并把产物图直接内联返回 — 等价于
    `still.py + Read` 但只花一轮。source 也接受静态图片 (裁剪/放大既有截图)。"""
    raw_src = args.get("source") or args.get("video_path")
    if not raw_src:
        return "[ERROR] source 必填 (视频或图片路径)"
    try:
        src = ctx.resolve(str(raw_src))
    except Exception as e:
        return f"[ERROR] 无法解析 source={raw_src!r}: {e}"
    if not src.is_file():
        return f"[ERROR] source not found: {raw_src}"

    crop = _parse_crop(args.get("crop"))
    if isinstance(crop, str):
        return crop
    try:
        scale = float(args.get("scale") or 1.0)
    except (TypeError, ValueError):
        return f"[ERROR] scale 必须是数字: {args.get('scale')!r}"
    if not (0.1 <= scale <= 8.0):
        return f"[ERROR] scale 超出合理范围 [0.1, 8]: {scale}"

    out_dir = ctx.resolve(str(args.get("out_dir") or "out/stills"))
    prefix = str(args.get("prefix") or "still")
    times = args.get("times")
    is_video = src.suffix.lower() in _VIDEO_EXTS

    save_to = args.get("save_to")
    inline = str(args.get("inline") or ("thumb" if save_to else "full")).lower()
    if inline not in ("thumb", "full", "none"):
        return f"[ERROR] inline 只接受 thumb|full|none: {inline!r}"
    if save_to and is_video and (not isinstance(times, list) or len(times) != 1):
        return ("[ERROR] save_to (资产落盘模式) 一次只切一个区域: times 必须恰好 1 个时刻。"
                "多个素材区域 = 多个并行 still_crops 调用 (同一轮内发出)。")
    if save_to and inline == "full":
        inline = "thumb"  # 资产本体不 inline; 确认走缩略图, 验证走 composite_view

    import cv2
    out_dir.mkdir(parents=True, exist_ok=True)
    suffix = "_crop" if crop else ""
    saved: list[str] = []
    warns: list[str] = []
    asset_lines: list[str] = []
    thumb_paths: list[str] = []

    if is_video:
        if not isinstance(times, list) or not times:
            return "[ERROR] source 是视频时 times 必填且为非空数组 (秒, 可小数)"
        if len(times) > MAX_TIMES:
            return (f"[ERROR] times 单次最多 {MAX_TIMES} 个 (收到 {len(times)}) — "
                    "更长的时间窗观察请改用 clip_video")
        try:
            ts = [float(t) for t in times]
        except (TypeError, ValueError):
            return f"[ERROR] times 必须全是数字: {times!r}"
        cap = cv2.VideoCapture(str(src))
        if not cap.isOpened():
            return f"[ERROR] 打不开视频: {raw_src}"
        for t in ts:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ok, fr = cap.read()
            if not ok or fr is None:
                warns.append(f"t={t:g}s 抽帧失败 (超出时长?)")
                continue
            fr = _apply_crop_scale(fr, crop, scale)
            if fr is None:
                warns.append(f"t={t:g}s 裁剪区域为空 (crop 超界?)")
                continue
            if save_to:
                ap, tp, err = _asset_save(fr, save_to, ctx, {
                    "source": str(raw_src), "t": t,
                    "crop": list(crop) if crop else None, "scale": scale})
                if err:
                    return err
                asset_lines.append(
                    f"素材已落盘: {ap} ({fr.shape[1]}x{fr.shape[0]}px, 来源 t={t:g}s"
                    + (f" crop={','.join(map(str, crop))}" if crop else "") + ")")
                thumb_paths.append(str(tp))
                continue
            # 与 still.py 同名同后缀: 裁剪版与全帧分名, 防覆盖
            p = out_dir / f"{prefix}_{t:g}s{suffix}.png"
            cv2.imwrite(str(p), fr)
            saved.append(ctx.virtualize(p))
        cap.release()
    else:
        if crop is None and scale == 1.0 and not save_to:
            return ("[ERROR] source 是图片且未给 crop/scale — 原图直接 Read 即可, "
                    "本工具用于裁剪/放大")
        fr = cv2.imread(str(src))
        if fr is None:
            return f"[ERROR] 读图失败: {raw_src}"
        fr = _apply_crop_scale(fr, crop, scale)
        if fr is None:
            return f"[ERROR] 裁剪区域为空 (crop 超界?): {args.get('crop')!r}"
        if save_to:
            ap, tp, err = _asset_save(fr, save_to, ctx, {
                "source": str(raw_src), "t": None,
                "crop": list(crop) if crop else None, "scale": scale})
            if err:
                return err
            asset_lines.append(
                f"素材已落盘: {ap} ({fr.shape[1]}x{fr.shape[0]}px, 来源 {raw_src}"
                + (f" crop={','.join(map(str, crop))}" if crop else "") + ")")
            thumb_paths.append(str(tp))
        else:
            p = out_dir / f"{prefix}_{src.stem}{suffix}.png"
            cv2.imwrite(str(p), fr)
            saved.append(ctx.virtualize(p))

    if asset_lines:
        lines = asset_lines
        lines.append("溯源已记 .v2c/assets_manifest.json (含 source/t/crop, 换帧重切时直接改这里的参数); "
                     "JSX 里用上面的 /assets/ 路径引用。")
        if inline == "none":
            return ToolResult(text="\n".join(lines))
        lines.insert(0, f"下方为 {len(thumb_paths)} 张低清缩略图, 只用于确认切对了区域/无叠字污染:")
        return ToolResult(text="\n".join(lines), image_paths=thumb_paths)

    if not saved:
        return "[ERROR] 没有产出任何帧: " + "; ".join(warns)
    lines = [f"已抽 {len(saved)} 帧并内联在下方 (同图已落盘, 路径可复用于 composite_view):"]
    lines += [f"  - {p}" for p in saved]
    if crop:
        lines.append(f"crop={','.join(map(str, crop))} scale={scale:g} (源像素坐标系)")
    if warns:
        lines += [f"[WARN] {w}" for w in warns]
    return ToolResult(text="\n".join(lines),
                      image_paths=[str(ctx.resolve(p)) for p in saved])


def _read_frame_at(path: Path, t: float):
    """从视频抽单帧 (BGR ndarray); 失败返回 None。"""
    import cv2
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000)
    ok, fr = cap.read()
    cap.release()
    return fr if ok else None


def composite_view(args: dict, ctx: RunContext):
    """源证据 vs 复刻证据拼同尺度对照图并直接内联返回 — 等价于
    `composite.py + Read` 但只花一轮。两侧除静态图片外也接受视频
    (源 clip / 自己的录像): 单拍给 source_time/replica_time, 多节拍给
    beats=[[t_src,t_rep],...] 一次产出整条 matched-beat SRC|REP 带 —
    [D] id 的收行证据一步到位, 不必先 still_crops 两侧再拼。"""
    raw_a, raw_b = args.get("source"), args.get("replica")
    if not raw_a or not raw_b:
        return "[ERROR] source 与 replica 都必填"
    try:
        pa, pb = ctx.resolve(str(raw_a)), ctx.resolve(str(raw_b))
    except Exception as e:
        return f"[ERROR] 路径解析失败: {e}"
    if not pa.is_file():
        return f"[ERROR] source not found: {raw_a}"
    if not pb.is_file():
        return f"[ERROR] replica not found: {raw_b}"

    mode = str(args.get("mode") or "h")
    if mode not in ("h", "v"):
        return f"[ERROR] mode 只能是 'h' 或 'v': {mode!r}"
    label = args.get("label", True)
    crop = _parse_crop(args.get("crop"))
    if isinstance(crop, str):
        return crop
    rep_crop = _parse_crop(args.get("replica_crop"))
    if isinstance(rep_crop, str):
        return rep_crop
    angle_ring = args.get("angle_ring")
    ring_step = 15
    if isinstance(angle_ring, dict):
        try:
            ring_step = int(angle_ring.get("step") or 15)
        except (TypeError, ValueError):
            return f"[ERROR] angle_ring.step 必须是整数: {angle_ring.get('step')!r}"
    try:
        scale = float(args.get("scale") or 1.0)
    except (TypeError, ValueError):
        return f"[ERROR] scale 必须是数字: {args.get('scale')!r}"
    if not (0.1 <= scale <= 8.0):
        return f"[ERROR] scale 超出合理范围 [0.1, 8]: {scale}"

    # --- 视频侧输入: 单拍时间 / 多节拍 beats ---
    a_video = pa.suffix.lower() in _VIDEO_EXTS
    b_video = pb.suffix.lower() in _VIDEO_EXTS
    t_a, t_b = args.get("source_time"), args.get("replica_time")
    beats = args.get("beats")
    if beats is not None:
        if not (a_video or b_video):
            return "[ERROR] beats 需要至少一侧是视频; 两侧都是图片时直接普通调用"
        if (not isinstance(beats, list) or not beats or len(beats) > 6
                or not all(isinstance(p, (list, tuple)) and len(p) == 2 for p in beats)):
            return "[ERROR] beats 需要 1-6 个 [t_src, t_rep] 数字对"
        try:
            beats = [(float(s), float(r)) for s, r in beats]
        except (TypeError, ValueError):
            return f"[ERROR] beats 必须全是数字对: {beats!r}"
    else:
        if a_video and t_a is None:
            return "[ERROR] source 是视频: 给 source_time (秒), 或用 beats 拼多节拍带"
        if b_video and t_b is None:
            return "[ERROR] replica 是视频: 给 replica_time (秒), 或用 beats 拼多节拍带"
        beats = [(t_a, t_b)]  # 单拍统一走 beats 流程; 图片侧时间为 None

    import cv2
    import numpy as np
    src_img = None if a_video else cv2.imread(str(pa))
    rep_img = None if b_video else cv2.imread(str(pb))
    if not a_video and src_img is None:
        return f"[ERROR] 读图失败: {raw_a}"
    if not b_video and rep_img is None:
        return f"[ERROR] 读图失败: {raw_b}"

    default_out = f"out/cmp/{pa.stem}_vs_{pb.stem}.png"
    out = ctx.resolve(str(args.get("out_path") or default_out))

    def tag(img, text):
        (tw, _), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
        cv2.rectangle(img, (0, 0), (tw + 12, 30), (0, 0, 0), -1)
        cv2.putText(img, text, (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (255, 255, 255), 2, cv2.LINE_AA)
        return img

    warns: list[str] = []
    rows: list = []
    dims_line = ""
    for ts, tr in beats:
        src = _read_frame_at(pa, ts) if a_video else src_img.copy()
        if src is None:
            return f"[ERROR] source t={ts:g}s 抽帧失败 (超出时长?)"
        rep = _read_frame_at(pb, tr) if b_video else rep_img.copy()
        if rep is None:
            return f"[ERROR] replica t={tr:g}s 抽帧失败 (超出时长?)"

        if crop or rep_crop:
            src_shape = src.shape
            if crop:
                s2 = _slice(src, crop)  # crop 在源图自身坐标系, 直接裁
                if s2 is None:
                    return f"[ERROR] crop 区域在源图外: {args.get('crop')!r}"
                src = s2
            if rep_crop is not None:
                # 复刻侧单独指定区域 (复刻图自身像素坐标) — 超长全页图对齐的正解:
                # 源帧给 crop, 全页图给 replica_crop=[x, y_in_fullpage, w, h], 各裁各的。
                r2 = _slice(rep, rep_crop)
                if r2 is None:
                    return f"[ERROR] replica_crop 区域在复刻图外: {args.get('replica_crop')!r}"
                rep = r2
            elif crop:
                # 未单独给 replica_crop: 沿用源 crop 按比例映射到复刻图 (同尺度截图适用)
                x, y, w, h = crop
                src_ar = src_shape[0] / max(1, src_shape[1])
                rep_ar = rep.shape[0] / max(1, rep.shape[1])
                if rep_ar > src_ar * 2 or rep_ar < src_ar / 2:
                    warns.append(
                        "replica 与 source 长宽比差 >2× (多半是超长全页截图), 源 crop 按比例"
                        "映射到复刻侧必失真 — 请改传 replica_crop=[x,y,w,h] 直接指定复刻侧区域"
                        "(复刻图自身像素坐标), 或改用 deploy 随部署的分屏截图。")
                fx = rep.shape[1] / src_shape[1]
                fy = rep.shape[0] / src_shape[0]
                r2 = _slice(rep, (int(x * fx), int(y * fy), int(w * fx), int(h * fy)))
                if r2 is None:
                    return f"[ERROR] crop 映射到复刻图后在图外: {args.get('crop')!r}"
                rep = r2

        if scale != 1.0:
            src = cv2.resize(src, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
            rep = cv2.resize(rep, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)

        if not dims_line:
            # 裁剪后、拼图归一前的双侧实测尺寸 — 容差表 (±20% 类) 直接对着比值读
            sw, sh = src.shape[1], src.shape[0]
            rw, rh = rep.shape[1], rep.shape[0]
            dims_line = (f"实测: SRC {sw}x{sh} | REP {rw}x{rh}"
                         f" (宽比 {rw / max(1, sw):.2f}x, 高比 {rh / max(1, sh):.2f}x)")

        rows.append((src, rep, ts, tr))

    multi = len(rows) > 1
    row_mode = "h" if multi else mode  # 多节拍固定每行 SRC|REP, 行间纵排
    sheets = []
    for src, rep, ts, tr in rows:
        ltxt = "SRC" + (f" @{ts:g}s" if a_video else "")
        rtxt = "REP" + (f" @{tr:g}s" if b_video else "")
        if row_mode == "h":
            hh = min(src.shape[0], rep.shape[0])
            src = cv2.resize(src, (max(1, int(src.shape[1] * hh / src.shape[0])), hh))
            rep = cv2.resize(rep, (max(1, int(rep.shape[1] * hh / rep.shape[0])), hh))
            if label:
                src, rep = tag(src, ltxt), tag(rep, rtxt)
            if angle_ring:
                src, rep = _draw_protractor(src, ring_step), _draw_protractor(rep, ring_step)
            gap = np.full((hh, 8, 3), 255, np.uint8)
            sheets.append(np.hstack([src, gap, rep]))
        else:
            ww = min(src.shape[1], rep.shape[1])
            src = cv2.resize(src, (ww, max(1, int(src.shape[0] * ww / src.shape[1]))))
            rep = cv2.resize(rep, (ww, max(1, int(rep.shape[0] * ww / rep.shape[1]))))
            if label:
                src, rep = tag(src, ltxt), tag(rep, rtxt)
            if angle_ring:
                src, rep = _draw_protractor(src, ring_step), _draw_protractor(rep, ring_step)
            gap = np.full((8, ww, 3), 255, np.uint8)
            sheets.append(np.vstack([src, gap, rep]))

    if multi:
        ww = max(s.shape[1] for s in sheets)
        padded = []
        for s in sheets:
            if s.shape[1] < ww:
                s = np.hstack([s, np.full((s.shape[0], ww - s.shape[1], 3), 255, np.uint8)])
            padded.append(s)
            padded.append(np.full((8, ww, 3), 255, np.uint8))
        sheet = np.vstack(padded[:-1])
    else:
        sheet = sheets[0]

    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), sheet)
    vp = ctx.virtualize(out)
    extra = f" crop={','.join(map(str, crop))}" if crop else ""
    if rep_crop is not None:
        extra += f" replica_crop={','.join(map(str, rep_crop))}"
    if scale != 1.0:
        extra += f" scale={scale:g}"
    if angle_ring:
        extra += f" +角度环(每{ring_step}°刻度, 0°朝上顺时针): 读两栏特征对齐的刻度差即旋转量"
    if multi:
        pairs = ", ".join(f"{s:g}s|{r:g}s" for _, _, s, r in rows)
        head = (f"matched-beat 对照带已拼好并内联在下方 ({len(rows)} 行 SRC|REP, "
                f"节拍 {pairs}{extra}), 落盘: {vp} — 作为该 [D] id 在 verify.jsonl "
                "的 evidence 路径直接引用。")
    else:
        head = (f"对照图已拼好并内联在下方 (SRC|REP 同尺度{extra}), 落盘: {vp} — "
                "作为 verify.jsonl 的 evidence 路径直接引用。")
    lines = [head, dims_line]
    lines += [f"[WARN] {w}" for w in warns]
    return ToolResult(text="\n".join(lines), image_paths=[str(out)])
