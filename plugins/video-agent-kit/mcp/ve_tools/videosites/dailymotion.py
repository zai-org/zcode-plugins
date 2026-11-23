"""Video source adapter utilities."""
from __future__ import annotations

import re
from pathlib import Path

from . import _net as N

SITE = "dailymotion"
PREFIX = "dm"
FIELDS = "id,title,duration,created_time,owner.screenname,description,url,thumbnail_480_url,views_total"


def _row(r: dict) -> dict:
    vid = r.get("id")
    return {"id": f"{PREFIX}:{vid}", "site": SITE, "native_id": vid, "title": r.get("title") or "",
            "duration": float(r.get("duration") or 0) or None, "date": N.ymd(r.get("created_time")),
            "uploader": r.get("owner.screenname") or "", "url": r.get("url") or f"https://www.dailymotion.com/video/{vid}",
            "full": True, "thumb": r.get("thumbnail_480_url") or "", "description": (r.get("description") or "")[:1200],
            "views": r.get("views_total"), "tags": r.get("tags") or []}


def search(q: str, n: int = 20, page: int = 1) -> tuple[list[dict], bool]:
    d = N.get_json("https://api.dailymotion.com/videos",
                   params={"search": q, "fields": FIELDS, "limit": n, "page": max(1, page), "family_filter": "true"})
    if "list" not in d:
        raise N.NetError(f"dailymotion returned an unexpected structure: {str(d)[:100]}")
    return [_row(r) for r in d.get("list") or [] if r.get("id")][:n], bool(d.get("has_more"))


def meta(nid: str) -> dict | None:
    try:
        r = N.get_json(f"https://api.dailymotion.com/video/{nid}", params={"fields": FIELDS + ",tags"}, budget=40)
    except Exception:
        return None
    return _row(r) if r.get("id") else None


def fetch(nid: str, max_mb: int = 60) -> Path | None:
    stem = f"{SITE}_{N.safe_name(nid)}"
    hit = N.cached(stem)
    if hit:
        return hit
    N.MEDIA.mkdir(parents=True, exist_ok=True)
    return N.ytdlp(f"https://www.dailymotion.com/video/{nid}", N.MEDIA / stem, max_mb=max_mb)


def parse_url(u: str) -> str | None:
    m = re.search(r"(?:dailymotion\.com/(?:video|embed/video)/|dai\.ly/)([a-z0-9]+)", u)
    return m.group(1) if m else None
