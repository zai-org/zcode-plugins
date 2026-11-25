"""Video source adapter utilities."""
from __future__ import annotations

import html as _html
import json
import re
from pathlib import Path

from . import _net as N

SITE = "acfun"
PREFIX = "ac"
REF = {"Referer": "https://www.acfun.cn/"}


def _s():
    return N.session("acfun", "chrome")


def _txt(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", _html.unescape(t or ""))).strip()


def search(q: str, n: int = 20, page: int = 1) -> tuple[list[dict], bool]:
    params = {"type": "video", "keyword": q}
    if page > 1:
        params["pCursor"] = str(page)
    h = N.request("https://www.acfun.cn/search", params=params, sess=_s()).text
    pv = ""
    for m in re.finditer(r"bigPipe\.onPageletArrive\((\{.*?\})\);\s*</script>", h, re.S):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        if d.get("id") == "pagelet_video":
            pv = d.get("html") or ""
    out, seen = [], set()
    blks = re.split(r'<div class="search-video"', pv)[1:]
    for blk in blks:
        m = re.search(r'href="/v/ac(\d+)"', blk)
        if not m:
            continue
        g = lambda pat: (re.search(pat, blk, re.S) or [None, ""])[1]
        aid = m.group(1)
        if aid in seen:
            continue
        seen.add(aid)
        out.append({"id": f"{PREFIX}:{aid}", "site": SITE, "native_id": aid,
                    "title": _txt(g(r'class="video__main__title">\s*<a[^>]*>(.*?)</a>')),
                    "duration": N.hms(g(r'class="video__duration">([\d:]+)<')),
                    "date": N.ymd(g(r'class="info__create-time">([^<]+)<')),
                    "uploader": _txt(g(r'class="user-name">(.*?)</span>')),
                    "url": f"https://www.acfun.cn/v/ac{aid}", "full": True,
                    "thumb": _html.unescape(g(r'<img src="([^"]+)"')).split("?")[0],
                    "description": _txt(g(r'class="video__main__intro[^"]*">(.*?)</div>'))[:600]})
        if len(out) >= n:
            break
    if not out and page > 1:
        return [], False
    if not out:
        if "pagelet_video" not in h:
            raise N.NetError("AcFun search page is blocked or changed (no pagelet_video)")
        tot = re.search(r'data-total="(\d+)"', pv)
        if tot and int(tot.group(1)) > 0:
            raise N.NetError(f"AcFun search page reports data-total={tot.group(1)} but no row could be parsed "
                             "(page structure changed)")
    return out, len(blks) >= 20


def _info(nid: str) -> dict:
    from .json_extract import grab_json
    h = N.request(f"https://www.acfun.cn/v/ac{nid}", headers=REF, sess=_s()).text
    v = grab_json(h, "window.videoInfo =")
    if not v or not v.get("currentVideoInfo"):
        raise N.NetError("AcFun video page has no videoInfo (an article, or the video was removed)")
    return v


def _row(nid: str, v: dict) -> dict:
    return {"id": f"{PREFIX}:{nid}", "site": SITE, "native_id": nid, "title": (v.get("title") or "").strip(),
            "duration": ((v.get("currentVideoInfo") or {}).get("durationMillis") or v.get("durationMillis") or 0) / 1000 or None,
            "date": N.ymd(v.get("createTime")) or N.ymd((v.get("createTimeMillis") or 0) / 1000),
            "uploader": (v.get("user") or {}).get("name") or "", "url": f"https://www.acfun.cn/v/ac{nid}",
            "full": True, "thumb": (v.get("coverUrl") or "").split("?")[0], "description": v.get("description") or "",
            "tags": [t.get("name") for t in v.get("tagList") or [] if t.get("name")],
            "views": v.get("viewCount")}


def meta(nid: str) -> dict | None:
    try:
        return _row(nid, _info(nid))
    except Exception:
        return None


def fetch(nid: str, max_mb: int = 60) -> Path | None:
    stem = f"{SITE}_{N.safe_name(nid)}"
    hit = N.cached(stem)
    if hit:
        return hit
    try:
        v = _info(nid)
        kp = json.loads(v["currentVideoInfo"].get("ksPlayJson") or "{}")
        reps = (kp.get("adaptationSet") or [{}])[0].get("representation") or []
    except Exception:
        return None
    if not reps:
        return None

    dur = ((v.get("currentVideoInfo") or {}).get("durationMillis") or v.get("durationMillis") or 0) / 1000

    def est(r):
        return (r.get("avgBitrate") or r.get("maxBitrate") or 0) * 125 * (dur or 600)
    reps.sort(key=lambda r: r.get("height") or 9999)
    fit = [r for r in reps if (r.get("height") or 9999) <= 480 and est(r) <= max_mb << 20]
    rep = fit[-1] if fit else reps[0]
    N.MEDIA.mkdir(parents=True, exist_ok=True)
    for u in [rep.get("url")] + list(rep.get("backupUrl") or []):
        if not u:
            continue
        got = N.ffmpeg_hls(u, N.MEDIA / (stem + ".mp4"), headers=REF)
        if got:
            return got
    return None


def parse_url(u: str) -> str | None:
    m = re.search(r"acfun\.cn/v/ac(\d+(?:_\d+)?)", u)
    return m.group(1) if m else None
