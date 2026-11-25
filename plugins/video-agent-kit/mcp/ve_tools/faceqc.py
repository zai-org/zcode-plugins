"""Shared creation production support; media APIs and explicit evidence contracts."""
from __future__ import annotations

import json
import os
import re
import statistics
from pathlib import Path
from typing import Any

from ve_tools.lazy_import import lazy_module
from ve_tools.run_context import RunContext, clean_env

np = lazy_module("numpy")

FACE_FPS = 1.0            # frames sampled per second of clip
DET_SIZE = 320            # detector input (letterboxed square); 640 for the small faces on cards
CARD_DET_SIZE = 640
DET_THRESH = 0.5
NMS_IOU = 0.4
THREADS = 4               # onnxruntime intra-op threads — never the default (one per core)
MIN_FACE_PX = 120         # face box height below which the embedding is not trusted
CLAIM_SIM = 0.45          # best card ≥ this → recognised as that character
UNKNOWN_SIM = 0.30        # best card < this → a face that is nobody in the cast
AMBIGUOUS_MARGIN = 0.05   # two cards both ≥ CLAIM within this → cannot tell them apart
CARD_SIMILAR_WARN = 0.60  # face cards of two characters this alike = weak identity evidence
MODEL_FILES = ("det_10g.onnx", "w600k_r50.onnx")
ENGINE_DESC = "ArcFace buffalo_l (det_10g + w600k_r50) on onnxruntime CPU"

_SHOT_SPAN_RE = re.compile(r"Shot\s*(\d+)\s*[（(]\s*(\d+(?:\.\d+)?)\s*[-–—~]\s*(\d+(?:\.\d+)?)\s*[sS秒]?\s*[)）]")
_ARCFACE_POINTS = ((38.2946, 51.6963), (73.5318, 51.5014), (56.0252, 71.7366),
                   (41.5493, 92.3655), (70.7299, 92.2041))


# --------------------------------------------------------------------------- model location
def model_dir() -> Path | None:
    """First directory holding both model files, or None."""
    cands: list[Path] = []
    env_dir = clean_env("VE_FACEQC_DIR")
    if env_dir:
        cands.append(Path(env_dir).expanduser())
    assets = clean_env("VE_ASSETS_DIR")
    if assets:
        cands.append(Path(assets).expanduser() / "faceqc")
    cands.append(Path(__file__).resolve().parents[4] / "assets" / "faceqc")
    cands.append(Path.home() / ".insightface" / "models" / "buffalo_l")
    for d in cands:
        if all((d / f).is_file() for f in MODEL_FILES):
            return d
    return None


def availability() -> dict:
    try:
        import onnxruntime  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": f"onnxruntime not importable ({type(exc).__name__}) — pip install onnxruntime"}
    try:
        import cv2  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": f"cv2 not importable ({type(exc).__name__})"}
    d = model_dir()
    if d is None:
        return {"ok": False, "reason": "model files missing: put det_10g.onnx + w600k_r50.onnx (insightface buffalo_l) "
                                       "in <assets>/faceqc or set VE_FACEQC_DIR (models must be supplied explicitly)"}
    return {"ok": True, "dir": str(d)}


def _session_options(threads: int = THREADS):
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = max(1, int(threads))
    so.inter_op_num_threads = 1
    so.log_severity_level = 3
    return so


# --------------------------------------------------------------------------- geometry helpers
def umeyama(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """Similarity transform (rotation, uniform scale, translation) mapping src→dst, least squares.
    Same algorithm as skimage.transform.SimilarityTransform.estimate (Umeyama 1991), which is
    what insightface's norm_crop uses — returns the 3x3 homogeneous matrix."""
    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    num, dim = src.shape
    src_mean, dst_mean = src.mean(axis=0), dst.mean(axis=0)
    src_d, dst_d = src - src_mean, dst - dst_mean
    A = dst_d.T @ src_d / num
    d = np.ones((dim,), dtype=np.float64)
    if np.linalg.det(A) < 0:
        d[dim - 1] = -1
    T = np.eye(dim + 1, dtype=np.float64)
    U, S, V = np.linalg.svd(A)
    rank = np.linalg.matrix_rank(A)
    if rank == 0:
        return np.full_like(T, np.nan)
    if rank == dim - 1:
        if np.linalg.det(U) * np.linalg.det(V) > 0:
            T[:dim, :dim] = U @ V
        else:
            s = d[dim - 1]
            d[dim - 1] = -1
            T[:dim, :dim] = U @ np.diag(d) @ V
            d[dim - 1] = s
    else:
        T[:dim, :dim] = U @ np.diag(d) @ V
    scale = 1.0 / src_d.var(axis=0).sum() * (S @ d)
    T[:dim, dim] = dst_mean - scale * (T[:dim, :dim] @ src_mean.T)
    T[:dim, :dim] *= scale
    return T


def distance2bbox(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    return np.stack([points[:, 0] - distance[:, 0], points[:, 1] - distance[:, 1],
                     points[:, 0] + distance[:, 2], points[:, 1] + distance[:, 3]], axis=-1)


def distance2kps(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    cols = []
    for i in range(0, distance.shape[1], 2):
        cols.append(points[:, i % 2] + distance[:, i])
        cols.append(points[:, i % 2 + 1] + distance[:, i + 1])
    return np.stack(cols, axis=-1)


def anchor_centers(size: int, stride: int, num_anchors: int = 2) -> np.ndarray:
    h = w = size // stride
    ac = np.stack(np.mgrid[:h, :w][::-1], axis=-1).astype(np.float32) * stride
    ac = ac.reshape((-1, 2))
    if num_anchors > 1:
        ac = np.stack([ac] * num_anchors, axis=1).reshape((-1, 2))
    return ac


def nms(dets: np.ndarray, thresh: float = NMS_IOU) -> list[int]:
    """dets: (N, 5) x1 y1 x2 y2 score, sorted by score desc. Returns kept indices."""
    x1, y1, x2, y2, scores = dets[:, 0], dets[:, 1], dets[:, 2], dets[:, 3], dets[:, 4]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        w = np.maximum(0.0, xx2 - xx1 + 1)
        h = np.maximum(0.0, yy2 - yy1 + 1)
        ovr = (w * h) / (areas[i] + areas[order[1:]] - w * h)
        order = order[np.where(ovr <= thresh)[0] + 1]
    return keep


# --------------------------------------------------------------------------- engine
class FaceEngine:
    """SCRFD detector + ArcFace embedder on onnxruntime CPU with a capped thread pool."""

    def __init__(self, directory: Path, threads: int = THREADS) -> None:
        import onnxruntime as ort
        so = _session_options(threads)
        prov = ["CPUExecutionProvider"]
        self.dir = Path(directory)
        self.det = ort.InferenceSession(str(self.dir / "det_10g.onnx"), sess_options=so, providers=prov)
        self.rec = ort.InferenceSession(str(self.dir / "w600k_r50.onnx"), sess_options=so, providers=prov)
        self.det_in = self.det.get_inputs()[0].name
        self.det_out = [o.name for o in self.det.get_outputs()]
        self.rec_in = self.rec.get_inputs()[0].name
        self.rec_out = [o.name for o in self.rec.get_outputs()]
        self.threads = threads

    @staticmethod
    def _group_outputs(outs: list[np.ndarray]) -> tuple[list, list, list]:
        """SCRFD emits 3 strides x (scores, boxes, keypoints). Group by last dim (1/4/10) and order
        each group by row count desc (stride 8 has the most anchors), independent of output names."""
        by_dim: dict[int, list[np.ndarray]] = {1: [], 4: [], 10: []}
        for o in outs:
            k = int(o.shape[-1])
            if k in by_dim:
                by_dim[k].append(o)
        for k in by_dim:
            by_dim[k].sort(key=lambda a: -a.shape[0])
        return by_dim[1], by_dim[4], by_dim[10]

    def detect(self, img: np.ndarray, det_size: int = DET_SIZE, thresh: float = DET_THRESH) -> list[dict]:
        import cv2
        h, w = img.shape[:2]
        if h >= w:
            new_h, new_w = det_size, max(1, int(det_size / (h / w)))
        else:
            new_w, new_h = det_size, max(1, int(det_size * (h / w)))
        det_scale = new_h / h
        resized = cv2.resize(img, (new_w, new_h))
        canvas = np.zeros((det_size, det_size, 3), dtype=np.uint8)
        canvas[:new_h, :new_w] = resized
        blob = ((canvas[:, :, ::-1].astype(np.float32) - 127.5) / 128.0).transpose(2, 0, 1)[None]
        outs = self.det.run(self.det_out, {self.det_in: blob})
        scores_l, boxes_l, kps_l = self._group_outputs(outs)
        all_scores, all_boxes, all_kps = [], [], []
        for idx, stride in enumerate((8, 16, 32)):
            if idx >= len(scores_l) or idx >= len(boxes_l) or idx >= len(kps_l):
                break
            scores = scores_l[idx].reshape(-1)
            ac = anchor_centers(det_size, stride)
            if ac.shape[0] != scores.shape[0]:
                continue
            pos = np.where(scores >= thresh)[0]
            if pos.size == 0:
                continue
            boxes = distance2bbox(ac, boxes_l[idx].reshape(-1, 4) * stride)[pos]
            kps = distance2kps(ac, kps_l[idx].reshape(-1, 10) * stride)[pos].reshape(-1, 5, 2)
            all_scores.append(scores[pos]); all_boxes.append(boxes); all_kps.append(kps)
        if not all_scores:
            return []
        scores = np.concatenate(all_scores)
        boxes = np.concatenate(all_boxes) / det_scale
        kps = np.concatenate(all_kps) / det_scale
        order = scores.argsort()[::-1]
        dets = np.hstack([boxes, scores[:, None]]).astype(np.float32)[order]
        kps = kps[order]
        keep = nms(dets)
        return [{"bbox": dets[i, :4].tolist(), "det": float(dets[i, 4]), "kps": kps[i]} for i in keep]

    def embed(self, img: np.ndarray, kps: np.ndarray) -> np.ndarray:
        import cv2
        M = umeyama(np.asarray(kps, dtype=np.float32), np.array(_ARCFACE_POINTS, dtype=np.float32))[0:2, :]
        aimg = cv2.warpAffine(img, M, (112, 112), borderValue=0.0)
        blob = ((aimg[:, :, ::-1].astype(np.float32) - 127.5) / 127.5).transpose(2, 0, 1)[None]
        emb = self.rec.run(self.rec_out, {self.rec_in: blob})[0].reshape(-1).astype(np.float32)
        n = float(np.linalg.norm(emb))
        return emb / n if n > 0 else emb

    def faces(self, img: np.ndarray, det_size: int = DET_SIZE, min_px: int = 0) -> list[dict]:
        out = []
        for f in self.detect(img, det_size=det_size):
            x1, y1, x2, y2 = f["bbox"]
            h = int(round(y2 - y1))
            if h < min_px:
                out.append({**f, "h": h, "emb": None})
                continue
            out.append({**f, "h": h, "emb": self.embed(img, f["kps"])})
        return out


_ENGINE: FaceEngine | None = None
_CARD_CACHE: dict[tuple[str, int], tuple[np.ndarray | None, int]] = {}


def engine() -> FaceEngine:
    """One engine per process (the MCP server is long-lived; loading costs ~1 s)."""
    global _ENGINE
    if _ENGINE is None:
        d = model_dir()
        if d is None:
            raise RuntimeError(availability().get("reason") or "face QC models missing")
        _ENGINE = FaceEngine(d)
    return _ENGINE


# --------------------------------------------------------------------------- registration
def embed_card(path: Path) -> tuple[np.ndarray | None, int]:
    """Largest face on a card image → (embedding, face height px); (None, 0) when no face."""
    import cv2
    key = (str(path), path.stat().st_mtime_ns)
    if key in _CARD_CACHE:
        return _CARD_CACHE[key]
    img = cv2.imread(str(path))
    if img is None:
        _CARD_CACHE[key] = (None, 0)
        return _CARD_CACHE[key]
    faces = engine().faces(img, det_size=CARD_DET_SIZE)
    faces = [f for f in faces if f.get("emb") is not None]
    if not faces:
        _CARD_CACHE[key] = (None, 0)
    else:
        best = max(faces, key=lambda f: f["h"])
        _CARD_CACHE[key] = (best["emb"], best["h"])
    return _CARD_CACHE[key]


def register_cast(ctx: RunContext, cast: list[dict]) -> dict:
    """Embeddings for every cast member with a face on their headshot (fallback: body card).
    Also the card-vs-card matrix: two characters above CARD_SIMILAR_WARN are flagged."""
    ids: list[str] = []
    names: dict[str, str] = {}
    embs: dict[str, np.ndarray] = {}
    source: dict[str, str] = {}
    missing: list[str] = []
    for c in cast or []:
        if not isinstance(c, dict) or not c.get("id"):
            continue
        cid = str(c["id"])
        names[cid] = str(c.get("name") or cid)
        if c.get("kind") and str(c["kind"]) not in ("human", "person", "character"):
            continue          # creatures / objects have no ArcFace identity
        emb = None
        for key in ("headshot", "image", "image_side"):
            p = c.get(key)
            if not p:
                continue
            fp = ctx.resolve(str(p))
            if not fp.is_file():
                continue
            emb, _h = embed_card(fp)
            if emb is not None:
                source[cid] = key
                break
        if emb is None:
            missing.append(names[cid])
            continue
        ids.append(cid)
        embs[cid] = emb
    matrix = [[round(float(embs[a] @ embs[b]), 3) for b in ids] for a in ids]
    similar: list[list] = []
    for i, a in enumerate(ids):
        for j in range(i + 1, len(ids)):
            b = ids[j]
            if matrix[i][j] >= CARD_SIMILAR_WARN:
                similar.append([names[a], names[b], matrix[i][j]])
    return {"ids": ids, "names": names, "emb": embs, "matrix": matrix, "similar_pairs": similar,
            "missing": missing, "source": source}


# --------------------------------------------------------------------------- clip scan
def shot_spans(prompt: str | None) -> list[tuple[int, float, float]]:
    """[(shot_no, start_s, end_s)] from the sequence prompt's 'Shot N (a-bs)' blocks."""
    out = []
    for m in _SHOT_SPAN_RE.finditer(prompt or ""):
        out.append((int(m.group(1)), float(m.group(2)), float(m.group(3))))
    return out


def scan_clip(clip: Path, reg: dict, fps: float = FACE_FPS, eng: FaceEngine | None = None) -> dict:
    """Sample the clip at `fps`; every detected face gets its similarity to every registered card."""
    import cv2
    eng = eng or engine()
    ids = reg["ids"]
    cap = cv2.VideoCapture(str(clip))
    src = cap.get(cv2.CAP_PROP_FPS) or 24.0
    step = max(1, int(round(src / fps)))
    rows: list[dict] = []
    times: list[float] = []
    i = 0
    while True:
        if not cap.grab():
            break
        if i % step == 0:
            ok, fr = cap.retrieve()
            if ok and fr is not None:
                t = i / src
                times.append(round(t, 2))
                for f in eng.faces(fr, min_px=MIN_FACE_PX):
                    row = {"t": round(t, 2), "h": f["h"], "det": round(f["det"], 3),
                           "bbox": [round(v) for v in f["bbox"]]}
                    if f.get("emb") is not None and ids:
                        sims = {cid: float(f["emb"] @ reg["emb"][cid]) for cid in ids}
                        order = sorted(sims.items(), key=lambda kv: -kv[1])
                        row["best"], row["best_sim"] = order[0][0], round(order[0][1], 3)
                        row["second"] = order[1][0] if len(order) > 1 else None
                        row["second_sim"] = round(order[1][1], 3) if len(order) > 1 else None
                        row["sims"] = {k: round(v, 3) for k, v in sims.items()}
                    rows.append(row)
        i += 1
    cap.release()
    return {"frames": len(times), "times": times, "src_fps": src, "duration": round(i / src, 2) if src else None,
            "faces": rows}


def _dedupe(seq: list[str]) -> list[str]:
    return list(dict.fromkeys(s for s in seq if s))


def summarize(scan: dict, reg: dict, unit: dict, duration: float | None = None) -> dict:
    """Per-Shot aggregation of the scan against the schedule (speakers per Shot, sequence cast)."""
    names = reg["names"]
    name_to_id = {v: k for k, v in names.items()}
    spans = shot_spans(unit.get("prompt") or unit.get("video_prompt") or "")
    dur = duration or scan.get("duration") or (max(scan["times"]) + 1 if scan.get("times") else 0)
    if not spans:
        spans = [(0, 0.0, float(dur or 0))]      # shot 0 = whole clip, no Shot structure
    seq_cast = [str(c) for c in unit.get("character_ids") or []]
    dialogue = [d for d in unit.get("dialogue") or [] if isinstance(d, dict)]

    def shot_of(t: float) -> int:
        for n, a, b in spans:
            if a <= t < b:
                return n
        return spans[-1][0] if t >= spans[-1][2] else spans[0][0]

    frames_per_shot: dict[int, int] = {n: 0 for n, _, _ in spans}
    for t in scan.get("times") or []:
        frames_per_shot[shot_of(t)] = frames_per_shot.get(shot_of(t), 0) + 1
    seen: dict[int, dict[str, list[float]]] = {n: {} for n, _, _ in spans}
    unknown: dict[int, list[float]] = {n: [] for n, _, _ in spans}
    uncertain: dict[int, list[float]] = {n: [] for n, _, _ in spans}
    ambiguous: dict[int, dict[str, int]] = {n: {} for n, _, _ in spans}
    small = 0
    for r in scan.get("faces") or []:
        if r.get("best") is None:
            small += 1
            continue
        n = shot_of(float(r["t"]))
        seen.setdefault(n, {}); unknown.setdefault(n, []); uncertain.setdefault(n, []); ambiguous.setdefault(n, {})
        bs = float(r["best_sim"])
        if bs >= CLAIM_SIM:
            seen[n].setdefault(r["best"], []).append(bs)
            ss = r.get("second_sim")
            if ss is not None and float(ss) >= CLAIM_SIM and bs - float(ss) < AMBIGUOUS_MARGIN:
                pair = " / ".join(sorted([names.get(r["best"], r["best"]), names.get(r["second"], str(r["second"]))]))
                ambiguous[n][pair] = ambiguous[n].get(pair, 0) + 1
        elif bs < UNKNOWN_SIM:
            unknown[n].append(bs)
        else:
            uncertain[n].append(bs)

    shots_out: list[dict] = []
    notes: list[str] = []
    unexpected: list[dict] = []
    for n, a, b in spans:
        label = f"Shot {n} ({a:g}-{b:g}s)" if n else f"clip (0-{b:g}s)"
        scheduled = _dedupe([str(d.get("speaker")) for d in dialogue if (d.get("shot") == n or not n) and d.get("speaker")])
        seen_rows = {names.get(cid, cid): {"frames": len(v), "median": round(statistics.median(v), 2), "max": round(max(v), 2)}
                     for cid, v in sorted(seen.get(n, {}).items(), key=lambda kv: -len(kv[1]))}
        not_seen = [s for s in scheduled if name_to_id.get(s) in reg["ids"] and name_to_id.get(s) not in seen.get(n, {})]
        row = {"shot": n, "label": label, "span": [a, b], "frames": frames_per_shot.get(n, 0), "seen": seen_rows,
               "unregistered_faces": len(unknown.get(n, [])), "uncertain_faces": len(uncertain.get(n, [])),
               "scheduled_speakers": scheduled, "not_seen": not_seen,
               "ambiguous_pairs": ambiguous.get(n, {})}
        shots_out.append(row)
        for cid, v in seen.get(n, {}).items():
            if seq_cast and cid not in seq_cast:
                unexpected.append({"name": names.get(cid, cid), "shot": n, "frames": len(v),
                                   "median": round(statistics.median(v), 2)})
                notes.append(f"! {names.get(cid, cid)} recognised in {label} ({len(v)} frame(s), median {statistics.median(v):.2f}) "
                             f"but is NOT in this sequence's cast — 'presence' fails with extra_character (or 'identity' with "
                             f"identities_swapped) unless the grid shows the recogniser is wrong")
        if not_seen and frames_per_shot.get(n, 0) >= 2:
            notes.append(f"{label}: scheduled speaker(s) {', '.join(not_seen)} not recognised in any of "
                         f"{frames_per_shot.get(n, 0)} frames — a back / over-the-shoulder / profile Shot is legitimate; "
                         f"confirm on the grid that the line comes from them ('speaker_identity')")
        if len(unknown.get(n, [])) >= 2:
            notes.append(f"{label}: {len(unknown[n])} face(s) ≥{MIN_FACE_PX}px matching no card (best {max(unknown[n]):.2f}) — "
                         f"a stranger in frame, or a hard profile of a cast member; decide from the grid ('presence')")
        for pair, k in ambiguous.get(n, {}).items():
            notes.append(f"{label}: {pair} indistinguishable on {k} face(s) (both ≥{CLAIM_SIM}, within {AMBIGUOUS_MARGIN}) — "
                         f"judge 'identity' from hair / wardrobe, not the face")
    scored = sum(1 for r in scan.get("faces") or [] if r.get("best") is not None)
    if scan.get("frames") and scored == 0:
        notes.append(f"no face ≥{MIN_FACE_PX}px in {scan['frames']} frames (wide shots / backs / no people) — identity "
                     f"evidence unavailable here; judge from the grid")
    for a, b, s in reg.get("similar_pairs") or []:
        notes.append(f"face cards {a} vs {b} look alike to the recogniser ({s:.2f} ≥ {CARD_SIMILAR_WARN}) — identity "
                     f"evidence between these two is weak; use hair / wardrobe / build")
    if reg.get("missing"):
        notes.append(f"no face found on the card(s) of {', '.join(reg['missing'])} — they cannot be recognised in clips")
    return {
        "engine": f"{ENGINE_DESC}, det {DET_SIZE}, {FACE_FPS:g} fps, {THREADS} threads",
        "thresholds": {"min_face_px": MIN_FACE_PX, "recognised": CLAIM_SIM, "unregistered": UNKNOWN_SIM,
                       "ambiguous_margin": AMBIGUOUS_MARGIN, "card_similar_warn": CARD_SIMILAR_WARN},
        "frames": scan.get("frames", 0), "faces_scored": scored, "faces_small": small,
        "registration": {"ids": [names.get(i, i) for i in reg["ids"]], "similar_pairs": reg.get("similar_pairs") or [],
                         "missing": reg.get("missing") or [], "matrix": reg.get("matrix")},
        "shots": shots_out, "unexpected": unexpected, "notes": notes,
    }


def format_lines(fq: dict) -> list[str]:
    """Lines for the prepare text: one per Shot, then the notes."""
    th = fq.get("thresholds") or {}
    out = [f"face evidence ({fq.get('engine')}; faces ≥{th.get('min_face_px')}px, ≥{th.get('recognised')} = recognised, "
           f"<{th.get('unregistered')} = nobody in the cast; NOT a verdict — reconcile every line with the grids):"]
    for s in fq.get("shots") or []:
        seen = " ".join(f"{name}×{v['frames']} ({v['median']})" for name, v in (s.get("seen") or {}).items()) or "nobody recognised"
        extra = []
        if s.get("unregistered_faces"):
            extra.append(f"unregistered {s['unregistered_faces']}")
        if s.get("uncertain_faces"):
            extra.append(f"uncertain {s['uncertain_faces']}")
        sched = ", ".join(s.get("scheduled_speakers") or []) or "-"
        tail = f" → not recognised: {', '.join(s['not_seen'])}" if s.get("not_seen") else ""
        out.append(f"  {s['label']}: {seen}" + (f" | {' '.join(extra)}" if extra else "")
                   + f" | scheduled speakers: {sched}{tail}  [{s.get('frames', 0)} frames]")
    out += [f"  {n}" for n in fq.get("notes") or []]
    return out


def run_for_clip(ctx: RunContext, clip: Path, unit: dict, cast: list[dict], duration: float | None,
                 dump_to: Path | None = None) -> tuple[dict | None, list[str]]:
    """Best-effort: (face_qc summary, warnings). Never raises."""
    av = availability()
    if not av.get("ok"):
        return None, [f"face QC skipped: {av.get('reason')}"]
    try:
        reg = register_cast(ctx, cast)
        if not reg["ids"]:
            return None, ["face QC skipped: no cast face card yielded a face (headshot/image missing or faceless)"]
        scan = scan_clip(clip, reg)
        fq = summarize(scan, reg, unit, duration)
        if dump_to is not None:
            try:
                dump_to.write_text(json.dumps({"summary": fq, "faces": scan["faces"], "times": scan["times"]},
                                              ensure_ascii=False, indent=1), encoding="utf-8")
            except OSError:
                pass
        return fq, []
    except Exception as exc:  # noqa: BLE001
        return None, [f"face QC failed: {type(exc).__name__}: {str(exc)[:160]}"]


def card_similarity_notes(ctx: RunContext, cast: list[dict]) -> list[str]:
    """Registration-time check for drama_image_generate: which face cards look alike."""
    if not availability().get("ok"):
        return []
    try:
        reg = register_cast(ctx, cast)
    except Exception:  # noqa: BLE001
        return []
    notes = [f"{a} vs {b}: {s:.2f}" for a, b, s in reg.get("similar_pairs") or []]
    return notes
