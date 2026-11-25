"""Video source adapter utilities."""
from __future__ import annotations

import importlib
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, wait
from pathlib import Path


SITES = {'commons': {'prefix': '', 'full': True, 'enabled': True}, 'bilibili': {'prefix': 'bili', 'full': True, 'enabled': True}, 'peertube': {'prefix': 'pt', 'full': True, 'enabled': True}, 'dailymotion': {'prefix': 'dm', 'full': True, 'enabled': True}, 'niconico': {'prefix': 'nico', 'full': True, 'enabled': True}, 'acfun': {'prefix': 'ac', 'full': True, 'enabled': True}, 'nasa': {'prefix': 'nasa', 'full': True, 'enabled': True}}

_MOD = {site: site for site in SITES if (Path(__file__).parent / f"{site}.py").exists()}
_PREFIX2SITE = {v["prefix"]: k for k, v in SITES.items() if v["prefix"]}
LOG: list[dict] = []


def _mod(site: str):
    name = _MOD.get(site)
    if not name:
        raise KeyError(f"site {site} has no adapter")
    return importlib.import_module(f".{name}", __name__)


def default_sites() -> list[str]:
    return [s for s, v in SITES.items() if v["enabled"] and v["full"] and s in _MOD]


def make_id(site: str, native_id: str) -> str:
    p = SITES[site]["prefix"]
    return f"{p}:{native_id}" if p else str(native_id)


def parse(id_or_url: str) -> tuple[str, str] | None:
    s = (id_or_url or "").strip()
    if not s:
        return None
    if s.isdigit():
        return "commons", s
    if "://" not in s:
        pre, sep, rest = s.partition(":")
        if sep and pre in _PREFIX2SITE and rest:
            return _PREFIX2SITE[pre], rest
        if re.fullmatch(r"BV[0-9A-Za-z]{10}(:p\d+)?", s):
            return "bilibili", s
        return None
    for site in SITES:
        try:
            nid = _mod(site).parse_url(s)
        except Exception:
            nid = None
        if nid:
            return site, nid
    return None


def _one(site: str, q: str, n: int, page: int = 1) -> tuple[list[dict], bool]:
    got = _mod(site).search(q, n, page=page)
    rows, more = got if isinstance(got, tuple) else (got, len(got) >= n)
    for i, r in enumerate(rows):
        r.setdefault("site", site)
        r["full"] = bool(r.get("full")) and SITES[site]["full"]
        r["duration"] = float(r["duration"]) if r.get("duration") else None
        for k in ("date", "uploader", "thumb", "url", "title"):
            r[k] = str(r.get(k) or "")
        r["page"], r["rank"] = page, (page - 1) * n + i + 1
    return rows, bool(more)


def _interleave(per_site: list[list[dict]]) -> list[dict]:
    out, seen = [], set()
    for i in range(max((len(x) for x in per_site), default=0)):
        for rows in per_site:
            if i < len(rows) and rows[i]["id"] not in seen:
                seen.add(rows[i]["id"])
                out.append(rows[i])
    return out


def search_pages(q: str, n_per_site: int = 20, sites: list[str] | None = None, page: int = 1,
                 timeout: float = 60.0) -> tuple[list[dict], list[dict], dict[str, dict]]:
    page = max(1, int(page or 1))
    sites = list(sites) if sites else default_sites()
    errors: list[dict] = []
    todo = []
    for s in sites:
        if s not in SITES or s not in _MOD:
            errors.append({"site": s, "error": "unknown site or no search adapter", "secs": 0.0})
        else:
            todo.append(s)
    ex = ThreadPoolExecutor(max_workers=max(1, len(todo)), thread_name_prefix="vsites")
    t0 = time.time()
    futs = {s: ex.submit(_timed, s, q, n_per_site, page) for s in todo}
    wait(list(futs.values()), timeout=timeout)
    per_site, pages = [], {}
    for s in todo:
        f = futs[s]
        if not f.done():
            errors.append({"site": s, "error": f"timed out (>{timeout:.0f}s)", "secs": round(time.time() - t0, 1)})
            continue
        rows, more, err, secs = f.result()
        if err:
            errors.append({"site": s, "error": err, "secs": secs})
        else:
            pages[s] = {"page": page, "n": len(rows), "more": more}
        per_site.append(rows)
    ex.shutdown(wait=False, cancel_futures=True)
    if len(todo) >= 3 and not errors and not any(per_site) and page == 1:
        errors.append({"site": "*", "secs": round(time.time() - t0, 1),
                       "error": "every site returned 0 rows without an error: the query is probably too long or "
                                "too specific (sites match all words); retry with 2-4 keywords"})
    for e in errors:
        LOG.append({**e, "q": q, "page": page, "t": time.strftime("%H:%M:%S")})
        print(f"  [videosites] {e['site']} search failed: {e['error']}", file=sys.stderr)
    del LOG[:-200]
    return _interleave(per_site), errors, pages


def search_with_errors(q: str, n_per_site: int = 20, sites: list[str] | None = None,
                       timeout: float = 60.0, page: int = 1) -> tuple[list[dict], list[dict]]:
    rows, errors, _ = search_pages(q, n_per_site, sites, page, timeout)
    return rows, errors


def _timed(site: str, q: str, n: int, page: int = 1):
    t = time.time()
    try:
        rows, more = _one(site, q, n, page)
        return rows, more, "", round(time.time() - t, 1)
    except Exception as exc:
        return [], False, f"{type(exc).__name__}: {str(exc)[:200]}", round(time.time() - t, 1)


def search(q: str, n_per_site: int = 20, sites: list[str] | None = None, page: int = 1) -> list[dict]:
    return search_with_errors(q, n_per_site, sites, page=page)[0]


def meta(id: str) -> dict | None:
    p = parse(id)
    if not p or p[0] not in _MOD:
        return None
    try:
        r = _mod(p[0]).meta(p[1])
    except Exception:
        return None
    if r:
        r.setdefault("site", p[0])
        r["full"] = bool(r.get("full")) and SITES[p[0]]["full"]
    return r


def fetch(id: str, max_mb: int = 60) -> Path | None:
    return (fetch_info(id, max_mb) or {}).get("path_obj")


def fetch_info(id: str, max_mb: int = 60) -> dict | None:
    from . import _net as N
    p = parse(id)
    if not p or p[0] not in _MOD:
        N.log(f"{id} is not a supported source (supported sites: {', '.join(default_sites())})")
        return None
    t0 = time.time()
    try:
        path = _mod(p[0]).fetch(p[1], max_mb=max_mb)
    except Exception as exc:
        N.log(f"fetch {id} failed: {type(exc).__name__}: {str(exc)[:120]}")
        return None
    if not path:
        N.log(f"fetch {id} failed")
        return None
    path = Path(path)
    info = N.read_info(path)
    if info is None or "covered_s" not in info:
        src = (info or {}).get("source_duration")
        if not src:
            try:
                src = (_mod(p[0]).meta(p[1]) or {}).get("duration")
            except Exception:
                src = None
        try:
            info = N.write_info(path, {"site": p[0], "native_id": p[1], **(info or {}), "source_duration": src})
        except Exception:
            info = {"path": str(path), "truncated": False}
    if info.get("truncated"):
        N.log(f"fetch {id} is incomplete: {info.get('covered_s')}s of the source's "
              f"{info.get('source_duration')}s; treated as a failure")
        if path.stat().st_mtime >= t0 - 1:
            path.unlink(missing_ok=True)
            N.info_path(path).unlink(missing_ok=True)
        return None
    return {**info, "id": make_id(*p), "path": str(path), "path_obj": path}


__all__ = ["SITES", "search", "search_with_errors", "search_pages", "fetch", "fetch_info", "meta", "parse", "make_id", "default_sites", "LOG"]
