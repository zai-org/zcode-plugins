"""Video source adapter utilities."""
from __future__ import annotations

import html
import json
import re
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode
from urllib.request import Request, urlopen

from . import _net as N

SITE = "commons"
PREFIX = ""
API = "https://commons.wikimedia.org/w/api.php?"

DEFAULT_USER_AGENT = "video-agent-kit/0.4 python-urllib/3"


def user_agent() -> str:
    """Read at call time through the shared layering (process env > project .env > plugin .env)."""
    from ..run_context import clean_env
    return clean_env("VE_VIDEOSITES_WM_UA") or DEFAULT_USER_AGENT


class SearchError(RuntimeError):
    pass


WM_GAP = {"commons.wikimedia.org": 1.0, "upload.wikimedia.org": 3.0}
_wm_lock = threading.Lock()
_wm_last: dict[str, float] = {}


def wm_wait(url: str) -> None:
    host = url.split("/")[2] if "://" in url else ""
    gap = WM_GAP.get(host)
    if not gap:
        return
    with _wm_lock:
        now = time.time()
        t = max(now, _wm_last.get(host, 0) + gap)
        _wm_last[host] = t
    if t > now:
        time.sleep(t - now)


def backoff_429(exc: Exception, attempt: int, url: str = "") -> float:
    ra = None
    try:
        ra = float(getattr(exc, "headers", {}).get("Retry-After"))
    except (TypeError, ValueError, AttributeError):
        pass
    wait = min(300.0, ra if ra and ra > 0 else 20.0 * 2 ** attempt)
    host = url.split("/")[2] if "://" in url else ""
    if host in WM_GAP:
        with _wm_lock:
            _wm_last[host] = max(_wm_last.get(host, 0), time.time() + wait)
    return wait


def request_json(url: str, timeout: float = 40, retries: int = 3) -> dict:
    req = Request(url, headers={"User-Agent": user_agent(), "Accept": "application/json"})
    last: Exception | None = None
    n429 = attempt = 0
    while attempt < retries:
        wm_wait(url)
        try:
            with urlopen(req, timeout=timeout) as response:
                return json.loads(response.read())
        except HTTPError as exc:
            last = exc
            if exc.code == 429 and n429 < 5:
                time.sleep(backoff_429(exc, n429, url))
                n429 += 1
                continue
            if exc.code not in {403, 429, 500, 502, 503, 504} or attempt + 1 == retries:
                raise SearchError(f"HTTP {exc.code} from commons") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            if attempt + 1 == retries:
                raise SearchError(f"commons request failed: {exc}") from exc
        time.sleep(1.5 * (attempt + 1))
        attempt += 1
    raise SearchError(f"commons request failed: {last}")


def _strip_html(v: str | None) -> str:
    if not v:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(v))).strip()


def _q(params: dict) -> dict:
    return request_json(API + urlencode({"format": "json", "formatversion": 2, **params}), timeout=40)


_VI = {"prop": "videoinfo|categories", "clshow": "!hidden", "cllimit": "max",
       "viprop": "url|mime|size|user|timestamp|derivatives|extmetadata"}


def _page_row(p: dict) -> dict | None:
    vi = (p.get("videoinfo") or [{}])[0]
    if not str(vi.get("mime", "")).startswith("video/"):
        return None
    em = vi.get("extmetadata") or {}
    ders = [d for d in vi.get("derivatives") or [] if "webm" in (d.get("type") or "")]
    small = sorted((d for d in ders if (d.get("height") or 0) >= 200), key=lambda d: d.get("height") or 9999)
    return {
        "id": str(p["pageid"]), "title": p["title"],
        "page_url": vi.get("descriptionurl") or "https://commons.wikimedia.org/wiki/" + p["title"].replace(" ", "_"),
        "user": vi.get("user"), "uploaded": vi.get("timestamp"),
        "width": vi.get("width"), "height": vi.get("height"),
        "duration": vi.get("duration"), "size_bytes": vi.get("size"),
        "license": _strip_html((em.get("LicenseShortName") or {}).get("value")),
        "creator": _strip_html((em.get("Artist") or {}).get("value"))[:160],
        "date": _strip_html((em.get("DateTimeOriginal") or {}).get("value"))[:40],
        "description": _strip_html((em.get("ImageDescription") or {}).get("value"))[:1200],
        "derivative_url": small[0]["src"] if small else None,
        "derivative_h": small[0].get("height") if small else None,
    }


def _date(r: dict) -> str:
    return N.ymd(r.get("date")) or N.ymd(r.get("uploaded"))


def _thumb(r: dict) -> str:
    t = r.get("title") or ""
    if not t.startswith("File:"):
        return ""
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{t[5:].replace(' ', '_')}?width=320"


def _row(r: dict, with_desc: bool = True) -> dict:
    return {"id": r["id"], "site": SITE, "native_id": r["id"],
            "title": re.sub(r"^File:", "", r.get("title") or ""), "duration": r.get("duration"),
            "date": _date(r), "uploader": r.get("creator") or r.get("user") or "",
            "url": r.get("page_url") or "", "full": bool(r.get("derivative_url")), "thumb": _thumb(r),
            "description": (r.get("description") or "") if with_desc else "",
            "width": r.get("width"), "height": r.get("height"), "license": r.get("license", "")}


def search(q: str, n: int = 20, page: int = 1) -> tuple[list[dict], bool]:

    d = _q({"action": "query", "generator": "search", "gsrsearch": f"filetype:video {q}", "gsrnamespace": 6,
            "gsrlimit": n, "gsroffset": (max(1, page) - 1) * n, **_VI})
    pages = sorted(d.get("query", {}).get("pages", []), key=lambda p: p.get("index", 0))
    rows = [_page_row(p) for p in pages]
    return [_row(r) for r in rows if r and r.get("derivative_url")], "continue" in d


def _raw(nid: str) -> dict | None:
    d = _q({"action": "query", "pageids": nid, **_VI})
    pages = d.get("query", {}).get("pages", [])
    return _page_row(pages[0]) if pages and not pages[0].get("missing") else None


def meta(nid: str) -> dict | None:
    try:
        r = _raw(nid)
    except Exception:
        return None
    return _row(r) if r else None


def _complete(f: Path, src_dur) -> bool:
    info = N.read_info(f)
    if info is None or "covered_s" not in info:
        info = N.write_info(f, {"site": SITE, "source_duration": src_dur})
    return not info.get("truncated")


def fetch(nid: str, max_mb: int = 60) -> Path | None:
    media = N.MEDIA
    fulls = sorted(f for f in media.glob(f"commons_{nid}_*p_full.webm") if f.stat().st_size > 10_000)
    if fulls:
        return fulls[0]
    olds = sorted(f for f in media.glob(f"commons_{nid}_*p.webm") if f.stat().st_size > 10_000)
    try:
        r = _raw(nid)
        if not r or not r.get("derivative_url"):
            N.log(f"commons {nid} has no downloadable transcoded file")
            return olds[0] if olds and _complete(olds[0], (r or {}).get("duration")) else None
        if olds and _complete(olds[0], r.get("duration")):
            return olds[0]
        suffix = "_full" if olds else ""
        media.mkdir(parents=True, exist_ok=True)
        dest = media / f"commons_{nid}_{r.get('derivative_h')}p{suffix}.webm"
        wm_wait(r["derivative_url"])
        got = N.download_file(r["derivative_url"], dest, headers={"User-Agent": user_agent()})
        if not got:
            N.log(f"commons {nid} download failed")
        return got
    except Exception as exc:
        N.log(f"commons {nid} download raised {type(exc).__name__}: {str(exc)[:100]}")
        return None


def parse_url(u: str) -> str | None:
    if "wikimedia.org" not in u:
        return None
    m = re.search(r"[?&]curid=(\d+)", u)
    if m:
        return m.group(1)
    m = re.search(r"/wiki/(File:[^?#]+)", u)
    if not m:
        return None
    try:
        d = _q({"action": "query", "titles": unquote(m.group(1)).replace("_", " ")})
        p = (d.get("query", {}).get("pages") or [{}])[0]
        return str(p["pageid"]) if p.get("pageid") else None
    except Exception:
        return None
