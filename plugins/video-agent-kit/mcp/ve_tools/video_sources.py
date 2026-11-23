"""Video search, source resolution, full downloads and footage comparison.

Site adapters and matching algorithms are shared by the understanding workflows.
Optional network and image dependencies are imported only when used.
"""
from __future__ import annotations

import hashlib
import json
import math
import shutil
import re
import subprocess
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .result import ToolResult
from .run_context import RunContext, clean_env
from .observation_media import _ffmpeg, _scale, probe

SEARCH_N = 20
FULL_SITES = ["commons", "bilibili", "peertube", "dailymotion", "niconico", "acfun", "nasa"]
CROP = "iw*0.76:ih*0.8"
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
_SEEN = {}
_SEEN_LOCK = threading.Lock()


def ffprobe_duration(path: Path) -> float | None:
    return probe(path)['duration'] or None


def grab_frame(path: Path, t: float, width: int = 426):
    from PIL import Image
    import io
    if _is_image(path):
        with Image.open(path) as source:
            im = source.convert('RGB')
        return im.resize((width, max(2, int(im.height * width / im.width)))) if width else im
    try:
        out = _ffmpeg(['-ss', f'{float(t):.3f}', '-i', str(path), '-frames:v', '1',
                       '-vf', _scale(width), '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'], timeout=90).stdout
        with Image.open(io.BytesIO(out)) as source:
            return source.convert('RGB')
    except (OSError, RuntimeError, subprocess.TimeoutExpired):
        return None

def media_dir() -> Path:
    return Path(clean_env("VE_VIDEOSITES_MEDIA_DIR") or "/tmp/video_agent_media").expanduser()


def _vs():
    """Import the vendored videosites lazily and point its download directory at VE_VIDEOSITES_MEDIA_DIR."""
    from . import videosites as VS
    from .videosites import _net as N
    N.MEDIA = media_dir()
    return VS


def norm_id(vid: str) -> str:
    """Source URL / bare BV id / `?p=N` link -> unified id; bilibili part 1 carries no `:p1` (same as
    search rows). Unrecognized input is returned unchanged. Shapes that need no network (prefixed id,
    digits, BV, common URLs) are parsed here; URLs that need an API call (Commons File: pages) are
    left to videosites.parse as well."""
    vid = str(vid or "").strip()
    if not vid or vid.isdigit():
        return vid
    VS = _vs()
    ps = VS.parse(vid)
    if not ps:
        return vid
    site, nid = ps
    if site == "bilibili" and nid.endswith(":p1"):
        nid = nid[:-3]
    return VS.make_id(site, nid)


def _remember(rows: list[dict]) -> None:
    with _SEEN_LOCK:
        for r in rows:
            if r.get("id"):
                _SEEN[r["id"]] = r


def _row_out(r: dict) -> dict:
    return {"id": r.get("id"), "site": r.get("site"), "title": r.get("title") or "",
            "duration": r.get("duration"), "date": (r.get("date") or "")[:10], "uploader": r.get("uploader") or "",
            "url": r.get("url") or r.get("page_url") or "", "rank": r.get("rank")}


def video_search(args: dict, ctx: RunContext) -> ToolResult:  # noqa: ARG001
    q = str(args.get("query") or "").strip()
    if not q:
        return ToolResult(text="[ERROR] query is required")
    try:
        page = max(1, int(args.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    requested_sites = args.get("sites")
    if requested_sites is not None and (not isinstance(requested_sites, list) or not requested_sites
                                       or any(s not in FULL_SITES for s in requested_sites)):
        return ToolResult(text="[ERROR] sites must be a nonempty list of supported sites")
    sites = requested_sites or None
    VS = _vs()
    rows, errors, pages = VS.search_pages(q, n_per_site=SEARCH_N, sites=sites, page=page)
    _remember(rows)
    head = "; ".join(f"{k} page {v['page']}: {v['n']} row(s)" + (", more pages" if v["more"] else ", no more pages")
                     for k, v in pages.items()) or "no site returned rows"
    bad = "; sites that failed: " + ", ".join(f"{e['site']} ({str(e['error'])[:200]})" for e in errors) if errors else ""
    text = (f"Search \"{q}\" page {page}: {len(rows)} row(s), interleaved by site ({head}{bad}). "
            "Rows are in data.rows (rank = position within that site's results for this query).")
    if any(r.get("site") == "bilibili" for r in rows):
        text += ("\nA bilibili BV id can hold several parts; the rows list part 1. video_observe reports the "
                 "part count; address part N as bili:BV…:pN.")
    if not rows and errors and not pages:
        text += ("\nNo site answered. This is a search gap, not evidence that the video does not exist: read the "
                 "failure reason above before repeating the same call, or search other sites.")
    elif not rows:
        text += "\nNo rows: try 2-4 short keywords (Chinese for bilibili, English for Commons), or another page."
    return ToolResult(text=text, is_error=not rows and bool(errors) and not pages, data={
        "query": q, "page": page, "rows": [_row_out(r) for r in rows],
        "pages": pages, "more": {k: v["more"] for k, v in pages.items()},
        "errors": [{"site": e["site"], "error": str(e["error"])[:200]} for e in errors]})


def _bili_parts(vid: str) -> str:
    """Bilibili multi-part video: one sentence with the part count and each part's title and duration
    (the next episode of a series is often the next part). Empty for a single-part video."""
    VS = _vs()
    ps = VS.parse(vid)
    if not ps or ps[0] != "bilibili":
        return ""
    try:
        from .videosites import bilibili as VB
        pages = VB._view(ps[1].split(":")[0]).get("pages") or []  # noqa: SLF001
    except Exception:  # noqa: BLE001
        return ""
    if len(pages) <= 1:
        return ""
    bv = ps[1].split(":")[0]
    cur = int(ps[1].split(":p")[1]) if ":p" in ps[1] else 1
    lst = "; ".join(f"P{p.get('page')} \"{(p.get('part') or '')[:30]}\" {int(p.get('duration') or 0)}s" for p in pages[:20])
    more = f" … {len(pages)} parts in total" if len(pages) > 20 else ""
    return (f"This is part {cur} of {len(pages)} of bili:{bv} (multi-part video). Parts: {lst}{more}. "
            f"Address part N as \"bili:{bv}:pN\" (part 1 is bili:{bv}); report it in the same form.")


def video_metadata(args: dict, ctx: RunContext) -> ToolResult:  # noqa: ARG001
    source = str(args.get("source") or "").strip()
    if not source:
        return ToolResult(text="[ERROR] source is required")
    local = _local_or_none(source, ctx)
    if local:
        if _is_image(local):
            from PIL import Image
            with Image.open(local) as image:
                data = {"kind": "image", "width": image.width, "height": image.height}
        else:
            data = {"kind": "video", **probe(local)}
        return ToolResult(text="Local source metadata.", data={"source": ctx.virtualize(local), **data})
    vid = norm_id(args.get("source"))
    if not vid:
        return ToolResult(text="[ERROR] source is required")
    m = _vs().meta(vid)
    if not m:
        return ToolResult(text=f"Cannot read metadata for {vid}: {_unsupported(vid) or 'the source site did not return it'}.",
                          data={"id": vid, "ok": False})
    _remember([m])
    keep = {k: v for k, v in m.items() if k not in ("thumb",) and v not in (None, "")}
    bp = _bili_parts(vid) if vid.startswith("bili:") else ""
    return ToolResult(text=f"Metadata for {vid}." + (f"\n{bp}" if bp else ""), data={"ok": True, **keep})


def _is_image(p: str | Path) -> bool:
    return str(p).lower().endswith(IMAGE_EXT)


def _local_or_none(ref: str, ctx: RunContext) -> Path | None:
    ref = str(ref or "").strip()
    if not ref or "://" in ref:
        return None
    try:
        p = ctx.resolve(ref)
    except (OSError, ValueError):
        return None
    return p if p.is_file() else None


_FETCH_NOTES: dict[str, list[str]] = {}


def _fetch_info(vid: str) -> dict | None:
    """Download the whole video (never truncated); None on failure. A long video can take minutes."""
    from .videosites import _net as N
    seen = N.log_mark()
    try:
        info = _vs().fetch_info(vid)
    except Exception as exc:  # noqa: BLE001
        N.log(f"fetch {vid} raised {type(exc).__name__}: {str(exc)[:120]}")
        info = None
    if not info:
        _FETCH_NOTES[vid] = list(dict.fromkeys(N.log_since(seen)))[-4:]
    return info


def _unsupported(vid: str) -> str:
    """Non-empty when the reference is not a local file, a supported site URL or a known id."""
    try:
        if _vs().parse(vid):
            return ""
    except Exception:  # noqa: BLE001
        return ""
    return ("it is not a local file in the workspace, a URL of a supported site or an id returned by "
            f"video_search (supported sites: {', '.join(FULL_SITES)})")


def fetch_failure(vid: str) -> str:
    """Why the last fetch of this source failed, for the tool result. The adapters only wrote the
    reason to the MCP log, which the caller cannot read."""
    reason = _unsupported(vid) or "; ".join(_FETCH_NOTES.get(vid) or [])
    return f" Reason: {reason[:500]}." if reason else ""


def resolve_media(ref: str, ctx: RunContext) -> tuple[Path | None, str, dict]:
    """ref = a local file path in the workspace, or an id / URL of any supported site.
    Returns (local file, unified id or local path, metadata row)."""
    local = _local_or_none(ref, ctx)
    if local:
        return local, ctx.virtualize(local), {}
    if not ref:
        return None, "", {}
    vid = norm_id(ref)
    row = _SEEN.get(vid) or {}
    info = _fetch_info(vid)
    if not info:
        return None, vid, row
    if not row:
        try:
            row = _vs().meta(vid) or {}
        except Exception:  # noqa: BLE001
            row = {}
        if row:
            _remember([row])
    return Path(info["path"]), vid, {**row, "_fetch": {k: info.get(k) for k in ("covered_s", "source_duration", "w", "h", "audio", "size_mb")}}


def video_download(args: dict, ctx: RunContext) -> ToolResult:
    vid = norm_id(args.get("source"))
    if not vid:
        return ToolResult(text="[ERROR] source is required")
    info = _fetch_info(vid)
    if not info:
        return ToolResult(text=f"Could not download {vid} in full.{fetch_failure(vid)} Use another candidate.",
                          data={"id": vid, "ok": False})
    src = Path(info["path"])
    dest_dir = ctx.resolve(args.get("dest_dir") or "out/media")
    dest_dir.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="download_", dir=dest_dir))
    dest = directory / src.name
    shutil.copy2(src, dest)
    row = _SEEN.get(vid) or {}
    data = {"ok": True, "id": vid, "local_path": ctx.virtualize(dest), "cache_path": str(src),
            "duration_s": info.get("covered_s"), "source_duration_s": info.get("source_duration"),
            "w": info.get("w"), "h": info.get("h"), "audio": info.get("audio"), "size_mb": info.get("size_mb"),
            "title": row.get("title"), "site": row.get("site"), "url": row.get("url")}
    return ToolResult(text=f"{vid} downloaded in full to {ctx.virtualize(dest)} ({info.get('covered_s')}s, {info.get('w')}x{info.get('h')}).",
                      artifacts=[str(dest)], data=data)


def _hash_dir(ctx: RunContext) -> Path:
    d = ctx.work_dir / "video_compare_hash"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _bits_from_gray(raw: bytes):
    import numpy as np
    g = np.frombuffer(raw[: len(raw) // 72 * 72], np.uint8).reshape(-1, 8, 9).astype(np.int16)
    return (g[:, :, 1:] > g[:, :, :-1]).reshape(len(g), 64)


def dhash_track(path: Path, ctx: RunContext, fps: float = 2.0, crop: str | None = None):
    """Cache timed perceptual hashes by source identity, sampling and crop settings.
    The bottom quarter is excluded to reduce overlays; images produce one hash.
    """
    import numpy as np
    stat = path.stat()
    tag = hashlib.sha256(f"{path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}|{stat.st_ctime_ns}|{fps}|{crop}".encode()).hexdigest()[:24]
    cache = _hash_dir(ctx) / f"{tag}.npz"
    if cache.is_file():
        try:
            with np.load(cache) as z:
                t, bits = z['t'], z['b']
                if len(t) and bits.shape == (len(t), 64) and np.isfinite(t).all() and np.isin(bits, [0, 1]).all():
                    return t, bits
        except (OSError, ValueError, KeyError):
            pass
        cache.unlink(missing_ok=True)
    if _is_image(path):
        if crop:
            raise ValueError('crop on image comparisons is unsupported; provide a cropped image')
        from PIL import Image
        im = Image.open(path).convert("L")
        w, h = im.size
        g = np.asarray(im.crop((0, 0, w, int(h * 0.75))).resize((9, 8)), dtype=np.int16)[None]
        bits = (g[:, :, 1:] > g[:, :, :-1]).reshape(1, 64)
        t = np.zeros(1)
    else:
        vf = f"fps={fps}," + (f"crop={crop}," if crop else "") + "crop=iw:ih*0.75:0:0,scale=9:8,format=gray"
        decoded = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-vf", vf, "-f", "rawvideo", "pipe:1"],
                                 capture_output=True, timeout=1800)
        if decoded.returncode != 0 or not decoded.stdout or len(decoded.stdout) % 72:
            detail = decoded.stderr.decode(errors='replace')[-400:]
            if crop:
                # The crop runs on the candidate at its own (often smaller, downloaded) resolution.
                try:
                    info = probe(path)
                    size = f"{info.get('width')}x{info.get('height')}"
                except (OSError, RuntimeError, ValueError):
                    size = "unknown-size"
                raise ValueError(f"video comparison decode failed with crop={crop} on the {size} candidate; the crop "
                                 "applies to the candidate's own resolution, so write it with iw/ih "
                                 "(e.g. iw*0.8:ih*0.8) or pixels that fit: " + detail)
            raise ValueError('video comparison decode failed: ' + detail)
        bits = _bits_from_gray(decoded.stdout)
        t = np.arange(len(bits)) / fps
    with tempfile.NamedTemporaryFile(dir=cache.parent, suffix=".npz", delete=False) as temporary:
        tmp_path = Path(temporary.name)
    try:
        np.savez(tmp_path, t=t, b=bits)
        tmp_path.replace(cache)
    finally:
        tmp_path.unlink(missing_ok=True)
    return t, bits


def _dhash(im) -> int:
    import numpy as np
    g = np.asarray(im.convert("L"), dtype=np.float64)
    h, w = g.shape
    ys = np.linspace(0, h, 9, dtype=int)
    xs = np.linspace(0, w, 10, dtype=int)
    cells = np.array([[g[ys[i]:ys[i + 1], xs[j]:xs[j + 1]].mean() for j in range(9)] for i in range(8)])
    return int("".join("1" if b else "0" for b in (cells[:, 1:] > cells[:, :-1]).flatten()), 2)


def fingerprint(path: Path, n: int = 10) -> list[int]:
    """dHash of n frames spread evenly over the whole file (2%-98%)."""
    if _is_image(path):
        return [_dhash(grab_frame(path, 0, width=160))]
    dur = ffprobe_duration(path) or 0
    if dur <= 0:
        return []
    stamps = [dur * (0.02 + 0.96 * i / max(1, n - 1)) for i in range(n)]
    with ThreadPoolExecutor(4) as ex:
        frs = list(ex.map(lambda t: grab_frame(path, t, width=160), stamps))
    return [_dhash(f) for f in frs if f is not None]


def same_footage(fa: list[int], fb: list[int], thr: int = 10) -> float:
    """Share of the frames in fa that have a near match in fb. >=0.5 counts as the same footage
    (transcode / shortened cut / reupload)."""
    if not fa or not fb:
        return 0.0
    return sum(1 for a in fa if min(bin(a ^ b).count("1") for b in fb) <= thr) / len(fa)


def clip_match(inp: Path, src: Path, ctx: RunContext, thr: int = 10, src_crop: str | None = None,
               expect_offset: float | None = None) -> dict:
    """Nearest source frame for every frame of the input (clip or image): hit share `frac`, median
    matched source time `at_s`, median offset `offset_s`, share of textured frames `textured`; with
    expect_offset also `aligned` (share of frames that match within +-1 s of the expected source time)."""
    import numpy as np
    ti, bi = dhash_track(inp, ctx)
    tc, bc = dhash_track(src, ctx, crop=src_crop)
    if not len(bi) or not len(bc):
        return {"frac": 0.0}
    # Bound temporary memory when either source is a long video.
    best = np.zeros(len(bi), dtype=int)
    mins = np.full(len(bi), 65, dtype=int)
    for i in range(0, len(bi), 64):
        a = bi[i:i + 64]
        for j in range(0, len(bc), 512):
            distances = (a[:, None, :] != bc[None, j:j + 512, :]).sum(-1)
            local_best = distances.argmin(1)
            local_min = distances[np.arange(len(a)), local_best]
            update = local_min < mins[i:i + len(a)]
            mins[i:i + len(a)][update] = local_min[update]
            best[i:i + len(a)][update] = local_best[update] + j
    ok = mins <= thr
    at = tc[best[ok]] if ok.any() else np.array([])
    pop = bi.sum(1)
    out = {"frac": round(float(ok.mean()), 3), "n": int(len(bi)), "median_dist": int(np.median(mins)),
           "at_s": round(float(np.median(at)), 1) if len(at) else None,
           "offset_s": round(float(np.median(at - ti[ok])), 1) if len(at) else None,
           "textured": round(float(((pop >= 8) & (pop <= 56)).mean()), 3)}
    if expect_offset is not None:
        hit = []
        for i in range(len(bi)):
            w = np.abs(tc - (ti[i] + expect_offset)) <= 1.0
            distances = (bi[i][None, :] != bc[w]).sum(-1)
            hit.append(bool(w.any()) and int(distances.min()) <= thr)
        out["aligned"] = round(float(np.mean(hit)), 3)
    return out


def aligned_match(inp: Path, src: Path, offset: float, ctx: RunContext, src_crop: str | None = None,
                  fps: float = 10.0, tol: float = 0.3, thr: int = 12) -> dict:
    """Frame-by-frame check of "input second t = source second offset+t": hashes are recomputed at
    `fps` only over the matching stretch of the source, and each input frame takes its nearest frame
    within +-tol seconds. Returns `aligned` (share of input frames with distance <= thr), median_dist
    and textured."""
    import numpy as np
    ti, bi = dhash_track(inp, ctx)
    if not len(bi):
        return {"aligned": 0.0}
    span = float(ti[-1]) + 2 * tol + 0.5
    lo = max(0.0, offset - tol - 0.25)
    vf = f"fps={fps}," + (f"crop={src_crop}," if src_crop else "") + "crop=iw:ih*0.75:0:0,scale=9:8,format=gray"
    decoded = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{lo:.3f}", "-t", f"{span:.3f}", "-i", str(src),
                              "-vf", vf, "-f", "rawvideo", "pipe:1"], capture_output=True, timeout=600)
    if decoded.returncode == 0 and not decoded.stdout:
        # offset_s beyond the candidate decodes nothing: that is "no aligned frames", not a tool failure.
        return {"aligned": 0.0, "n": int(len(bi)), "note": "offset_s is beyond the candidate duration"}
    if decoded.returncode != 0 or len(decoded.stdout) % 72:
        raise ValueError('aligned comparison decode failed: ' + decoded.stderr.decode(errors='replace')[-400:])
    bc = _bits_from_gray(decoded.stdout)
    tc = lo + np.arange(len(bc)) / fps
    best = []
    for i in range(len(bi)):
        w = np.abs(tc - (offset + ti[i])) <= tol
        best.append(int((bi[i][None, :] != bc[w]).sum(-1).min()) if w.any() else 64)
    best = np.array(best)
    pop = bi.sum(1)
    return {"aligned": round(float((best <= thr).mean()), 3), "median_dist": int(np.median(best)), "n": int(len(bi)),
            "textured": round(float(((pop >= 8) & (pop <= 56)).mean()), 3)}


_CROP_EXPRESSION = re.compile(r"[0-9A-Za-z_.*/+\-() ]+(?::[0-9A-Za-z_.*/+\-() ]+){1,3}")


def _media_size(path: Path) -> tuple[int, int] | None:
    try:
        if _is_image(path):
            from PIL import Image
            with Image.open(path) as im:
                return im.size
        info = probe(path)
        w, h = int(info.get("width") or 0), int(info.get("height") or 0)
        return (w, h) if w > 0 and h > 0 else None
    except Exception:  # noqa: BLE001
        return None


def crop_hypotheses(input_size: tuple[int, int], candidate_size: tuple[int, int]) -> list[str]:
    """Candidate-side crops that would give the candidate the input's aspect ratio.

    A screenshot that became a meme is usually a *crop* of the original frame
    (a 729x480 cut from a 852x480 game capture, a 4:3 phone crop of a 16:9
    upload), and a 9x8 dHash of the whole frame does not survive that:
    measured on a real frame, a left-aligned 85.6% width crop of it scores a
    Hamming distance of 20 against its own source — the same as an unrelated
    video — while the matching crop scores 12. So when the aspects differ by
    more than 3%, try the three alignments along the cropped axis; the caller
    keeps the best. Returns [] when the aspects already agree."""
    (iw, ih), (cw, ch) = input_size, candidate_size
    a_in, a_c = iw / ih, cw / ch
    if abs(a_in - a_c) / a_c <= 0.03:
        return []
    out = []
    if a_in < a_c:   # input is narrower: the original lost width
        f = a_in / a_c
        for x in ("0", f"(iw-iw*{f:.4f})/2", f"iw-iw*{f:.4f}"):
            out.append(f"iw*{f:.4f}:ih:{x}:0")
    else:            # input is wider: the original lost height
        f = a_c / a_in
        for y in ("0", f"(ih-ih*{f:.4f})/2", f"ih-ih*{f:.4f}"):
            out.append(f"iw:ih*{f:.4f}:0:{y}")
    return out


def video_compare(args: dict, ctx: RunContext) -> ToolResult:
    try:
        return _video_compare(args, ctx)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        return ToolResult(text='[ERROR] ' + str(exc), data={'ok': False, 'error': str(exc)}, is_error=True)


# Default Hamming threshold for an image query. The 10 used for clip-vs-video
# is tuned for same-encode footage; a screenshot re-saved as JPEG and rescaled
# lands at 12-14 against its own source frame (measured), so 10 rejects true
# provenance matches. Random textured frames sit near 32.
IMAGE_QUERY_THRESHOLD = 14


def _video_compare(args: dict, ctx: RunContext) -> ToolResult:
    if not str(args.get("source") or "").strip() or not str(args.get("candidate") or "").strip():
        return ToolResult(text="[ERROR] source and candidate are required")
    pa, ida, _ = resolve_media(args.get("source") or "", ctx)
    pb, idb, _ = resolve_media(args.get("candidate") or "", ctx)
    if not pa or not pb:
        missing = ida if not pa else idb
        return ToolResult(text=f"Cannot fetch the {'source' if not pa else 'candidate'}: {missing}.{fetch_failure(missing)}",
                          data={"ok": False})
    crop = args.get("crop") or None
    if crop == "default":
        crop = CROP
    elif crop is not None and not _CROP_EXPRESSION.fullmatch(str(crop)):
        # The value is spliced into an ffmpeg filter chain: "," / ";" / "[" / "=" would
        # append arbitrary filters (some of which write files).
        raise ValueError("crop must be 'default' or w:h[:x[:y]] built from numbers, iw/ih and + - * / ( )")
    thr = args.get("threshold", 10)
    if isinstance(thr, bool) or not isinstance(thr, int) or not 1 <= thr <= 32:
        return ToolResult(text="[ERROR] threshold must be an integer between 1 and 32")
    image_query = _is_image(pa)
    if image_query and "threshold" not in args:
        thr = IMAGE_QUERY_THRESHOLD
    offset = args.get("offset_s")
    if offset is not None and (isinstance(offset, bool) or not isinstance(offset, (int, float))
                               or not math.isfinite(offset) or offset < 0):
        return ToolResult(text="[ERROR] offset_s must be a finite nonnegative number")
    fa, fb = fingerprint(pa), fingerprint(pb)
    if not fa or not fb:
        raise ValueError('cannot decode comparison fingerprints')
    same = round(max(same_footage(fa, fb), same_footage(fb, fa)), 3)
    off = args.get("offset_s")
    expect = float(off) if off is not None else None
    # Crop search: the caller's crop wins; otherwise, when the input and the
    # candidate disagree on aspect ratio, try the alignments that would explain
    # the difference and keep the one with the most hits / smallest distance.
    tried: list[dict] = []
    crops: list[str | None] = [crop]
    if crop is None and not _is_image(pb):
        sa, sb = _media_size(pa), _media_size(pb)
        if sa and sb:
            crops += crop_hypotheses(sa, sb)
    cm, best_crop = None, crop
    for c in crops:
        r = clip_match(pa, pb, ctx, thr=thr, src_crop=c, expect_offset=expect)
        tried.append({"crop": c, "frac": r.get("frac"), "median_dist": r.get("median_dist"), "at_s": r.get("at_s")})
        key = (r.get("frac", 0.0), -(r.get("median_dist") or 64))
        if cm is None or key > (cm.get("frac", 0.0), -(cm.get("median_dist") or 64)):
            cm, best_crop = r, c
    assert cm is not None
    data = {"ok": True, "input": ida, "candidate": idb, "same_footage": same, "same_footage_scope": "uncropped full-frame fingerprint",
            "clip_match": cm, "crop": best_crop, "threshold": thr, "crop_search": tried if len(tried) > 1 else None}
    if off is not None:
        data["aligned_match"] = aligned_match(pa, pb, float(off), ctx, src_crop=best_crop, thr=max(thr, 12))
    verdict = []
    verdict.append("fingerprints indicate the same footage (same_footage>=0.5)" if same >= 0.5
                   else "fingerprints do not look like the same footage")
    verdict.append(f"{cm.get('frac', 0):.0%} of the input frames match a candidate frame"
                   + (f", around {cm['at_s']}s in the candidate" if cm.get("at_s") is not None else "")
                   + f" (median nearest-frame Hamming distance {cm.get('median_dist')}/64, threshold {thr})")
    if len(tried) > 1:
        verdict.append(f"the input and candidate aspect ratios differ; tried {len(tried)} crops, "
                       f"the best was {best_crop or 'no crop'}")
    if "aligned_match" in data:
        verdict.append(f"at offset {off}s aligned={data['aligned_match'].get('aligned')}")
    if cm.get("textured", 1) < 0.6:
        verdict.append("note: the input is almost flat or static, so its hashes resemble anything and are not evidence")
    if image_query and cm.get("frac", 0) == 0 and (cm.get("median_dist") or 64) <= thr + 6:
        verdict.append("the distance is close to the threshold: possibly the same picture cropped or scaled "
                       "differently; look near at_s with video_observe before deciding")
    return ToolResult(text="; ".join(verdict) + ".", data=data)
