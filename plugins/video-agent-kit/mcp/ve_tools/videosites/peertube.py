"""Video source adapter utilities."""
from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlparse

from . import _net as N

SITE = "peertube"
PREFIX = "pt"
SEPIA = "https://sepiasearch.org/api/v1/search/videos"
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def _row(v: dict, host: str) -> dict:
    uuid = v["uuid"]
    th = v.get("thumbnailUrl") or v.get("thumbnailPath") or ""
    if th.startswith("/"):
        th = f"https://{host}{th}"
    ch = v.get("channel") or {}
    return {"id": f"{PREFIX}:{uuid}@{host}", "site": SITE, "native_id": f"{uuid}@{host}",
            "title": v.get("name") or "", "duration": float(v.get("duration") or 0) or None,
            "date": N.ymd(v.get("originallyPublishedAt") or v.get("publishedAt")),
            "uploader": ch.get("displayName") or (v.get("account") or {}).get("displayName") or "",
            "url": v.get("url") or f"https://{host}/w/{uuid}", "full": True, "thumb": th,
            "description": (v.get("description") or "")[:1200]}


def search(q: str, n: int = 20, page: int = 1) -> tuple[list[dict], bool]:
    start = (max(1, page) - 1) * n
    d = N.get_json(SEPIA, params={"search": q, "start": start, "count": n, "nsfw": "false"})
    if "data" not in d:
        raise N.NetError(f"sepiasearch returned an unexpected structure: {str(d)[:100]}")
    out = []
    for v in d.get("data") or []:
        host = (v.get("account") or {}).get("host") or (v.get("channel") or {}).get("host")
        if host and v.get("uuid") and not v.get("isLive"):
            out.append(_row(v, host))
    return out[:n], start + n < int(d.get("total") or 0)


_VIDEO_ID = re.compile(r"[0-9A-Za-z-]{1,64}")
_HOST = re.compile(r"(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?")


def _split(nid: str) -> tuple[str, str]:
    """The id is caller-supplied: it becomes a request URL and a cache file name, so
    path separators, dots-only segments and URL metacharacters are refused."""
    uuid, _, host = str(nid).partition("@")
    if not _VIDEO_ID.fullmatch(uuid) or not _HOST.fullmatch(host) or ".." in host:
        raise ValueError(f"invalid peertube id: {nid!r}")
    return uuid, host


def meta(nid: str) -> dict | None:
    try:
        uuid, host = _split(nid)
    except ValueError:
        return None
    try:
        v = N.get_json(f"https://{host}/api/v1/videos/{uuid}", budget=40)
    except Exception:
        return None
    return _row(v, host)


def fetch(nid: str, max_mb: int = 60) -> Path | None:
    try:
        uuid, host = _split(nid)
    except ValueError:
        N.log(f"peertube id is not valid: {str(nid)[:100]}")
        return None
    old = N.MEDIA / f"peertube_{N.safe_name(uuid)}.mp4"
    full = N.MEDIA / f"peertube_{N.safe_name(uuid)}_full.mp4"
    if full.exists() and full.stat().st_size > 10_000:
        return full
    try:
        vi = N.get_json(f"https://{host}/api/v1/videos/{uuid}", budget=120)
    except Exception as exc:
        if old.exists() and old.stat().st_size > 10_000 and N.read_info(old) and not N.read_info(old).get("truncated"):
            return old
        N.log(f"peertube {nid}: the instance API is unreachable: {str(exc)[:100]}")
        return None
    dest = old
    if old.exists() and old.stat().st_size > 10_000:
        info = N.read_info(old)
        if info is None or "covered_s" not in info:
            info = N.write_info(old, {"site": SITE, "native_id": nid, "source_duration": vi.get("duration")})
        if not info.get("truncated"):
            return old
        N.log(f"peertube {nid}: the cached file is truncated; downloading the full video")
        dest = full
    files = list(vi.get("files") or [])
    for pl in vi.get("streamingPlaylists") or []:
        files += pl.get("files") or []
    files = [f for f in files if ((f.get("resolution") or {}).get("id") or 1) > 0]
    files.sort(key=lambda f: f.get("size") or 1 << 40)
    fit = [f for f in files if (f.get("size") or 1 << 40) <= max_mb << 20 and
           ((f.get("resolution") or {}).get("id") or 0) <= 480]
    order = ([fit[-1]] if fit else []) + files
    N.MEDIA.mkdir(parents=True, exist_ok=True)
    tried = set()
    for f in order[:4]:
        for u in (f.get("fileUrl"), f.get("fileDownloadUrl")):
            if not u or u in tried:
                continue
            tried.add(u)
            got = N.download_file(u, dest)
            if got and N.ffprobe(got).get("duration"):
                return got
            dest.unlink(missing_ok=True)
    N.log(f"peertube {nid}: none of the file links could be downloaded")
    return None


def parse_url(u: str) -> str | None:
    m = re.search(r"https?://([^/]+)/(?:w|videos/watch|videos/embed)/([0-9A-Za-z-]+)", u or "")
    if not m:
        return None
    host, vid = m.group(1), m.group(2)
    if UUID.fullmatch(vid):
        return f"{vid}@{host}"
    try:
        v = N.get_json(f"https://{host}/api/v1/videos/{vid}", budget=20, tries=1)
        return f"{v['uuid']}@{host}" if v.get("uuid") else None
    except Exception:
        return None


def is_peertube_host(u: str) -> bool:
    return bool(re.search(r"/(?:w|videos/watch)/", urlparse(u).path or ""))
