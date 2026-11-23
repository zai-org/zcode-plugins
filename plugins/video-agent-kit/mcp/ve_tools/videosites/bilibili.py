"""Video source adapter utilities."""
from __future__ import annotations

import hashlib
import html as _html
import re
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import quote, urlencode

from . import _net as N

SITE = "bilibili"
PREFIX = "bili"
REF = {"Referer": "https://www.bilibili.com/"}
SREF = {"Referer": "https://search.bilibili.com/"}
BV = re.compile(r"(BV[0-9A-Za-z]{10})")


def _s():
    return N.session("bili", "chrome", warm="https://www.bilibili.com/")


_MIX = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39,
        12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63,
        57, 62, 11, 36, 20, 34, 44, 52]
_wbi = {"key": "", "t": 0.0}
_wbi_lock = threading.Lock()


def _wbi_key() -> str:
    with _wbi_lock:
        if _wbi["key"] and time.time() - _wbi["t"] < 3600:
            return _wbi["key"]
    d = N.get_json("https://api.bilibili.com/x/web-interface/nav", headers=REF, sess=_s())
    wi = (d.get("data") or {}).get("wbi_img") or {}
    raw = "".join(u.rsplit("/", 1)[-1].split(".")[0] for u in (wi.get("img_url", ""), wi.get("sub_url", "")))
    key = "".join(raw[i] for i in _MIX if i < len(raw))[:32]
    with _wbi_lock:
        _wbi.update(key=key, t=time.time())
    return key


def wbi_sign(params: dict) -> dict:
    p = dict(params, wts=int(time.time()))
    p = {k: "".join(c for c in str(v) if c not in "!'()*") for k, v in sorted(p.items())}
    p["w_rid"] = hashlib.md5((urlencode(p, quote_via=quote) + _wbi_key()).encode()).hexdigest()
    return p


def _clean(t: str) -> str:
    return re.sub(r"</?em[^>]*>", "", _html.unescape(t or ""))


def _https(u: str) -> str:
    return "https:" + u if u.startswith("//") else u


def _row(nid: str, title, duration, date, uploader, thumb, description="", **extra) -> dict:
    bv = nid.split(":")[0]
    page = int(nid.split(":p")[1]) if ":p" in nid else 1
    return {"id": f"{PREFIX}:{nid}", "site": SITE, "native_id": nid, "title": title, "duration": duration,
            "date": date, "uploader": uploader,
            "url": f"https://www.bilibili.com/video/{bv}" + (f"?p={page}" if page > 1 else ""),
            "full": True, "thumb": _https(thumb or ""), "description": description, **extra}


PAGE = 20


def search(q: str, n: int = 20, page: int = 1) -> tuple[list[dict], bool]:
    start = (max(1, page) - 1) * n
    first = start // PAGE + 1
    rows, more = [], False
    for ap in range(first, (start + n - 1) // PAGE + 2):
        got, n_pages = _search_page(q, ap)
        rows += got
        more = ap < n_pages
        if not more:
            break
    lo = start - (first - 1) * PAGE
    return rows[lo:lo + n], more or len(rows) > lo + n


# search_pages gives each site 60 s. Keep the retry budget of one request below that, so a
# blocked endpoint is reported with its HTTP status instead of as an anonymous timeout.
_SEARCH_BUDGET = 35.0


def _search_page(q: str, page: int) -> tuple[list[dict], int]:
    params = {"search_type": "video", "keyword": q, "page": page}
    try:
        # One quick attempt without back-off. Risk control answers this unsigned endpoint with
        # HTTP 412 while the signed one below keeps serving; backing off here (4+8+16+32 s)
        # used up the whole search deadline, so the fallback never ran and the caller only saw
        # a 60 s timeout.
        d = N.get_json("https://api.bilibili.com/x/web-interface/search/type", params=params, headers=SREF,
                       sess=_s(), timeout=12, tries=1, retry_codes=())
    except N.NetError:
        d = {}
    res = (d.get("data") or {}).get("result")
    if d.get("code") != 0 or not res:
        try:
            # timeout bounds a hanging connection too: the budget only caps the waits between tries
            d = N.get_json("https://api.bilibili.com/x/web-interface/wbi/search/type", params=wbi_sign(params),
                           headers=SREF, sess=_s(), timeout=15, budget=_SEARCH_BUDGET)
        except N.NetError as exc:
            status = str(exc).split(" ←")[0]
            if status in ("HTTP 412", "HTTP 429"):
                raise N.NetError(f"bilibili search is blocked by the site's rate limiting ({status}); "
                                 "repeating the call now will fail the same way, search bilibili again "
                                 "after a few minutes") from exc
            raise
        res = (d.get("data") or {}).get("result")
        data = d.get("data") or {}
        if d.get("code") != 0 or (res is None and "numResults" not in data):
            reason = "risk-control voucher returned" if "v_voucher" in data else "no result field"
            raise N.NetError(f"bilibili search is blocked (code={d.get('code')} {d.get('message')}, {reason}); "
                             "search bilibili again after a few minutes")
        if not res and data.get("numResults"):
            raise N.NetError(f"bilibili search reports numResults={data.get('numResults')} but returned no rows "
                             "(likely risk control); search bilibili again after a few minutes")
        res = res or []
    out = []
    for r in res:
        if not r.get("bvid") or r.get("type", "video") != "video":
            continue
        out.append(_row(r["bvid"], _clean(r.get("title")), N.hms(r.get("duration")), N.ymd(r.get("pubdate")),
                        r.get("author", ""), r.get("pic", ""), (r.get("description") or "")[:600],
                        views=r.get("play"), tags=r.get("tag", "")))
    return out, int((d.get("data") or {}).get("numPages") or 0)


def _view(bv: str) -> dict:
    d = N.get_json("https://api.bilibili.com/x/web-interface/wbi/view", params=wbi_sign({"bvid": bv}),
                   headers=REF, sess=_s())
    if d.get("code") != 0 or not d.get("data"):
        raise N.NetError(f"wbi/view code={d.get('code')} {d.get('message')}")
    return d["data"]


def _page(v: dict, nid: str) -> dict:
    pno = int(nid.split(":p")[1]) if ":p" in nid else 1
    pages = v.get("pages") or []
    return next((p for p in pages if p.get("page") == pno), pages[0] if pages else {})


def meta(nid: str) -> dict | None:
    try:
        v = _view(nid.split(":")[0])
    except Exception:
        return None
    p = _page(v, nid)
    dim = p.get("dimension") or v.get("dimension") or {}
    w, h = dim.get("width"), dim.get("height")
    if dim.get("rotate"):
        w, h = h, w
    title = v.get("title", "")
    if len(v.get("pages") or []) > 1 and p.get("part"):
        title = f"{title} | P{p.get('page')} {p.get('part')}"
    return _row(nid, title, float(p.get("duration") or v.get("duration") or 0) or None, N.ymd(v.get("pubdate")),
                (v.get("owner") or {}).get("name", ""), v.get("pic", ""), v.get("desc", ""),
                width=w, height=h, n_pages=len(v.get("pages") or []), cid=p.get("cid"),
                tags=(v.get("tname") or ""))


def parse_url(u: str) -> str | None:
    if "bilibili.com" not in u and "b23.tv" not in u:
        return None
    m = BV.search(u)
    if not m:
        return None
    pm = re.search(r"[?&]p=(\d+)", u)
    return m.group(1) + (f":p{pm.group(1)}" if pm and pm.group(1) != "1" else "")


_EXTRA_MIRRORS = ("upos-sz-mirrorhw.bilivideo.com", "upos-sz-mirrorcosov.bilivideo.com",
                  "upos-sz-mirror08c.bilivideo.com", "upos-sz-mirrorali.bilivideo.com")


def _urls(track: dict) -> list[str]:
    raw = [u for u in [track.get("baseUrl") or track.get("base_url")] + list(track.get("backupUrl") or
                                                                             track.get("backup_url") or []) if u]
    out = [u for u in raw if "akamaized" not in u]
    tmpl = next((u for u in out if re.match(r"https://upos-[a-z]+-mirror[a-z0-9]+\.bilivideo\.com/", u)), None)
    if tmpl:
        for h in _EXTRA_MIRRORS:
            u = re.sub(r"^https://[^/]+/", f"https://{h}/", tmpl)
            if u not in out:
                out.append(u)
    out += [u for u in raw if "akamaized" in u]
    return out


_CODEC_PREF = {"avc": 0, "av01": 1, "hev": 2}


def _cpref(x: dict) -> int:
    c = str(x.get("codecs", ""))
    return next((v for k, v in _CODEC_PREF.items() if c.startswith(k)), 3)


def fetch(nid: str, max_mb: int = 60) -> Path | None:
    stem = f"{SITE}_{N.safe_name(nid)}"
    hit = N.cached(stem)
    if hit:
        return hit
    with N.host_slot(SITE, 3):
        hit = N.cached(stem)
        if hit:
            return hit
        try:
            return _fetch(nid, stem, max_mb)
        except Exception as exc:
            N.log(f"bilibili {nid} download raised {type(exc).__name__}: {str(exc)[:120]}")
            return None


def _fetch(nid: str, stem: str, max_mb: int) -> Path | None:
    bv = nid.split(":")[0]
    v = _view(bv)
    p = _page(v, nid)
    cid, dur = p.get("cid"), float(p.get("duration") or v.get("duration") or 0)
    if not cid:
        N.log(f"bilibili {nid}: the video page lists no playable part (no cid)")
        return None
    j = N.get_json("https://api.bilibili.com/x/player/playurl",
                   params={"bvid": bv, "cid": cid, "qn": 32, "fnval": 16 | 2048, "fourk": 0},
                   headers=REF, sess=_s())
    dash = (j.get("data") or {}).get("dash") or {}

    vids = [x for x in dash.get("video") or [] if (x.get("baseUrl") or x.get("base_url")) and (x.get("id") or 0) <= 32]
    if not vids:
        N.log(f"bilibili {nid}: playurl offers no DASH video track at 480p or below "
              f"(code={j.get('code')} {j.get('message')})")
        return None
    auds = sorted((a for a in dash.get("audio") or [] if a.get("baseUrl") or a.get("base_url")),
                  key=lambda x: x.get("bandwidth") or 0)
    budget = max_mb << 20

    def est(x):
        return (x.get("bandwidth") or 0) / 8 * (dur or 600) * 1.03
    by_q = sorted(vids, key=lambda x: (-(x.get("id") or 0), -min(x.get("width") or 0, x.get("height") or 0), _cpref(x)))
    at = auds[0] if auds else None
    vt = next((x for x in by_q if at and est(x) + est(at) <= budget), None)
    if vt is None:
        at = None
        vt = next((x for x in by_q if est(x) <= budget), None)
    if vt is None:
        vt = min(vids, key=lambda x: x.get("bandwidth") or 1 << 40)
    N.MEDIA.mkdir(parents=True, exist_ok=True)
    tmp = N.MEDIA / (stem + ".part")
    vpart, apart = Path(f"{tmp}.v.m4s"), Path(f"{tmp}.a.m4s")
    try:
        if not N.ranged_to(_urls(vt), vpart, headers=REF, workers=6, spread=True):
            N.log(f"bilibili {nid}: video track download failed")
            return None
        if at and not N.ranged_to(_urls(at), apart, headers=REF, workers=4, spread=True):
            at = None
        dest = N.MEDIA / (stem + ".mp4")
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(vpart)] + (["-i", str(apart)] if at else [])
        cmd += ["-map", "0:v:0"] + (["-map", "1:a:0"] if at else []) + ["-c", "copy"]
        cmd += [str(dest)]
        pr = subprocess.run(cmd, capture_output=True, timeout=1800)
        if pr.returncode != 0 or not dest.exists() or dest.stat().st_size < 10_000:
            dest.unlink(missing_ok=True)
            N.log(f"bilibili {nid}: muxing the tracks failed: {pr.stderr.decode('utf-8', 'replace')[-160:]}")
            return None
        N.write_info(dest, {"site": SITE, "native_id": nid, "source_duration": dur or None,
                            "got": f"{vt.get('width')}x{vt.get('height')}", "codec": vt.get("codecs"),
                            "audio": bool(at), "source_w": (p.get("dimension") or {}).get("width"),
                            "source_h": (p.get("dimension") or {}).get("height")})
        return dest
    finally:
        vpart.unlink(missing_ok=True)
        apart.unlink(missing_ok=True)
