"""Video source adapter utilities."""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

from . import _net as N

SITE = "nasa"
PREFIX = "nasa"
API = "https://images-api.nasa.gov"
ASSETS = "https://images-assets.nasa.gov/video"
PREF = ("~mobile.mp4", "~small.mp4", "~preview.mp4", "~medium.mp4", "~large.mp4", "~orig.mp4")


def _dur(md: dict) -> float | None:
    x = md.get("XMP:Duration")
    if isinstance(x, dict) and x.get("Value") and x.get("Scale"):
        return round(float(x["Value"]) * float(x["Scale"]), 2)
    for k in ("QuickTime:Duration", "Composite:Duration"):
        v = md.get(k)
        if v:
            s = N.hms(str(v).split(".")[0]) if ":" in str(v) else None
            if s is None:
                m = re.match(r"([\d.]+)\s*s", str(v))
                s = float(m.group(1)) if m else None
            if s:
                return s
    return None


def _md(nid: str) -> dict:
    try:
        return N.get_json(f"{ASSETS}/{quote(nid)}/metadata.json", budget=20, tries=2)
    except Exception:
        return {}


def _row(d: dict, thumb: str = "", md: dict | None = None) -> dict:
    nid = d.get("nasa_id")
    md = md or {}
    return {"id": f"{PREFIX}:{nid}", "site": SITE, "native_id": nid, "title": d.get("title") or "",
            "duration": _dur(md), "date": N.ymd(d.get("date_created")),
            "uploader": d.get("photographer") or d.get("secondary_creator") or f"NASA {d.get('center') or ''}".strip(),
            "url": f"https://images.nasa.gov/details/{quote(nid)}", "full": True,
            "thumb": thumb or f"{ASSETS}/{quote(nid)}/{quote(nid)}~thumb.jpg",
            "description": (d.get("description") or "")[:1500], "tags": d.get("keywords") or [],
            "width": (md.get("XMP:VideoFrameSize") or {}).get("W"), "height": (md.get("XMP:VideoFrameSize") or {}).get("H")}


def search(q: str, n: int = 20, page: int = 1) -> tuple[list[dict], bool]:
    d = N.get_json(f"{API}/search", params={"q": q, "media_type": "video", "page_size": n, "page": max(1, page)})
    if "collection" not in d:
        raise N.NetError(f"NASA returned an unexpected structure: {str(d)[:100]}")
    items = []
    for it in (d.get("collection") or {}).get("items") or []:
        data = (it.get("data") or [{}])[0]
        if data.get("nasa_id"):
            th = next((l.get("href") for l in it.get("links") or [] if l.get("rel") == "preview"), "")
            items.append((data, th))
        if len(items) >= n:
            break
    with ThreadPoolExecutor(4) as ex:
        mds = list(ex.map(lambda x: _md(x[0]["nasa_id"]), items))
    total = int(((d.get("collection") or {}).get("metadata") or {}).get("total_hits") or 0)
    return [_row(d, th, md) for (d, th), md in zip(items, mds)], max(1, page) * n < total


def meta(nid: str) -> dict | None:
    try:
        d = N.get_json(f"{API}/search", params={"nasa_id": nid, "media_type": "video"}, budget=40)
        it = ((d.get("collection") or {}).get("items") or [None])[0]
    except Exception:
        return None
    if not it:
        return None
    return _row((it.get("data") or [{}])[0], "", _md(nid))


def fetch(nid: str, max_mb: int = 60) -> Path | None:
    stem = f"{SITE}_{N.safe_name(nid)}"
    hit = N.cached(stem)
    if hit:
        return hit
    try:
        d = N.get_json(f"{API}/asset/{quote(nid)}", budget=40)
    except Exception:
        return None
    hrefs = [i.get("href", "").replace("http://", "https://", 1) for i in (d.get("collection") or {}).get("items") or []]
    mp4s = sorted({h for h in hrefs if h.endswith(".mp4")},
                  key=lambda h: next((i for i, p in enumerate(PREF) if h.endswith(p)), 99))
    N.MEDIA.mkdir(parents=True, exist_ok=True)
    for u in mp4s[:3]:
        got = N.download_file(u.replace(" ", "%20"), N.MEDIA / (stem + ".mp4"))
        if got:
            return got
    return None


def parse_url(u: str) -> str | None:
    m = re.search(r"images\.nasa\.gov/details/([^/?#]+)", u) or \
        re.search(r"images-assets\.nasa\.gov/video/([^/?#]+)/", u)
    return m.group(1) if m else None
