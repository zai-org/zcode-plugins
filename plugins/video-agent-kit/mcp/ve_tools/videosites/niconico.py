"""Video source adapter utilities."""
from __future__ import annotations

import html as _html
import re
from pathlib import Path

from . import _net as N

SITE = "niconico"
PREFIX = "nico"
API = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search"
FIELDS = "contentId,title,lengthSeconds,startTime,thumbnailUrl,userId,channelId,description,viewCounter,tags"


def _desc(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", _html.unescape(t or ""))).strip()


def _row(r: dict, uploader: str = "") -> dict:
    cid = r["contentId"]
    return {"id": f"{PREFIX}:{cid}", "site": SITE, "native_id": cid, "title": r.get("title") or "",
            "duration": float(r.get("lengthSeconds") or 0) or None, "date": N.ymd(r.get("startTime")),
            "uploader": uploader or (f"user/{r['userId']}" if r.get("userId") else
                                     f"channel/ch{r['channelId']}" if r.get("channelId") else ""),
            "url": f"https://www.nicovideo.jp/watch/{cid}", "full": True, "thumb": r.get("thumbnailUrl") or "",
            "description": _desc(r.get("description"))[:1200], "views": r.get("viewCounter"),
            "tags": r.get("tags") or ""}


def _q(params: dict) -> list[dict]:
    d = N.get_json(API, params={"fields": FIELDS, "_context": "vdrbench", **params})
    if (d.get("meta") or {}).get("status") != 200:
        raise N.NetError(f"niconico snapshot {d.get('meta')}")
    return d.get("data") or []


def search(q: str, n: int = 20, page: int = 1) -> tuple[list[dict], bool]:
    rows = _q({"q": q, "targets": "title,description,tags", "_sort": "-viewCounter", "_limit": n,
               "_offset": (max(1, page) - 1) * n})
    return [_row(r) for r in rows if r.get("contentId")][:n], len(rows) >= n


def meta(nid: str) -> dict | None:
    try:
        rows = _q({"q": "", "targets": "title", "filters[contentId][0]": nid, "_limit": 1})
    except Exception:
        rows = []
    if rows:
        return _row(rows[0])

    try:
        import yt_dlp
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as y:
            i = y.extract_info(f"https://www.nicovideo.jp/watch/{nid}", download=False)
    except Exception:
        return None
    return {"id": f"{PREFIX}:{nid}", "site": SITE, "native_id": nid, "title": i.get("title") or "",
            "duration": float(i.get("duration") or 0) or None, "date": N.ymd(i.get("upload_date") and
                                                                              f"{i['upload_date'][:4]}-{i['upload_date'][4:6]}-{i['upload_date'][6:]}"),
            "uploader": i.get("uploader") or "", "url": f"https://www.nicovideo.jp/watch/{nid}", "full": True,
            "thumb": i.get("thumbnail") or "", "description": _desc(i.get("description"))[:1200]}


def fetch(nid: str, max_mb: int = 60) -> Path | None:
    stem = f"{SITE}_{N.safe_name(nid)}"
    hit = N.cached(stem)
    if hit:
        return hit
    N.MEDIA.mkdir(parents=True, exist_ok=True)
    return N.ytdlp(f"https://www.nicovideo.jp/watch/{nid}", N.MEDIA / stem, max_mb=max_mb)


def parse_url(u: str) -> str | None:
    m = re.search(r"(?:nicovideo\.jp/watch/|nico\.ms/)((?:sm|so|nm)\d+)", u)
    return m.group(1) if m else None
