"""Video source adapter utilities."""
from __future__ import annotations

import re
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import urlparse


def media_dir() -> Path:
    import os
    return Path(os.environ.get("VE_VIDEOSITES_MEDIA_DIR") or "/tmp/video_agent_media").expanduser()


MEDIA = media_dir()

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


HOST_GAP = {
    "api.bilibili.com": 1.0, "www.bilibili.com": 1.0,
    "api.dailymotion.com": 0.5, "sepiasearch.org": 0.8,
    "snapshot.search.nicovideo.jp": 1.0, "www.nicovideo.jp": 1.0,
    "www.acfun.cn": 1.0, "images-api.nasa.gov": 0.5, "images-assets.nasa.gov": 0.2,
    "lighthouse.lbry.com": 1.0, "api.na-backend.odysee.com": 1.0, "player.odycdn.com": 6.0,
    "api.bitchute.com": 1.0, "archive.org": 1.0, "www.youtube.com": 1.5,
    "_default": 0.5,
}
_gap_lock = threading.Lock()
_next_slot: dict[str, float] = {}


def wait_host(url_or_host: str) -> None:
    host = urlparse(url_or_host).hostname if "://" in url_or_host else url_or_host
    host = host or "_default"
    gap = HOST_GAP.get(host, HOST_GAP["_default"])
    with _gap_lock:
        now = time.time()
        t = max(now, _next_slot.get(host, 0.0))
        _next_slot[host] = t + gap
    if t > now:
        time.sleep(t - now)


def push_back(url_or_host: str, wait: float) -> None:
    host = urlparse(url_or_host).hostname if "://" in url_or_host else url_or_host
    with _gap_lock:
        _next_slot[host or "_default"] = max(_next_slot.get(host or "_default", 0.0), time.time() + wait)


def retry_wait(headers, attempt: int, base: float = 4.0, cap: float = 60.0) -> float:
    try:
        ra = float((headers or {}).get("Retry-After"))
        if ra > 0:
            return min(cap, ra)
    except (TypeError, ValueError):
        pass
    return min(cap, base * 2 ** attempt)


_tls = threading.local()


def session(key: str = "default", impersonate: str = "chrome", warm: str | None = None):
    from curl_cffi import requests as R
    pool = getattr(_tls, "pool", None)
    if pool is None:
        pool = _tls.pool = {}
    s = pool.get(key)
    if s is None:
        s = R.Session(impersonate=impersonate)
        if warm:
            try:
                wait_host(warm)
                s.get(warm, timeout=20)
            except Exception:
                pass
        pool[key] = s
    return s


def reset_session(key: str = "default") -> None:
    pool = getattr(_tls, "pool", None) or {}
    pool.pop(key, None)


_slots_lock = threading.Lock()
_slots: dict[str, threading.Semaphore] = {}


def host_slot(key: str, n: int = 3) -> threading.Semaphore:
    with _slots_lock:
        if key not in _slots:
            _slots[key] = threading.Semaphore(n)
        return _slots[key]


class NetError(RuntimeError):
    pass


def request(url: str, *, method: str = "GET", params=None, json_body=None, headers=None, timeout: float = 25,
            tries: int = 3, sess=None, retry_codes=(412, 429, 503), budget: float = 90.0):
    s = sess or session()
    t0 = time.time()
    last = ""
    n_limited = 0
    attempt = 0
    while attempt < tries:
        wait_host(url)
        try:
            r = s.request(method, url, params=params, json=json_body, headers=headers, timeout=timeout)
        except Exception as exc:
            last = f"{type(exc).__name__}: {str(exc)[:120]}"
            attempt += 1
            if time.time() - t0 + 2 * attempt > budget:
                break
            time.sleep(2 * attempt)
            continue
        if r.status_code < 400:
            return r
        last = f"HTTP {r.status_code}"
        if r.status_code in retry_codes and n_limited < 4:
            w = retry_wait(r.headers, n_limited)
            if time.time() - t0 + w > budget:
                break
            push_back(url, w)
            n_limited += 1
            time.sleep(w)
            continue
        if r.status_code in (500, 502, 504):
            attempt += 1
            time.sleep(2 * attempt)
            continue
        break
    raise NetError(f"{last} ← {url[:100]}")


def get_json(url: str, **kw):
    r = request(url, **kw)
    try:
        return r.json()
    except Exception as exc:
        raise NetError(f"non-JSON response ({r.text[:60]!r}) ← {url[:100]}") from exc


def safe_name(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")[:120]


def cached(stem: str) -> Path | None:
    for f in MEDIA.glob(stem + ".*"):
        if ".part" in f.name or f.suffix in (".json", ".m4s"):
            continue
        if f.stat().st_size > 10_000:
            info = read_info(f)
            if info and info.get("truncated"):
                log(f"cached {f.name} is truncated ({info.get('covered_s')}s of {info.get('source_duration')}s); "
                    "deleting it to download again")
                f.unlink(missing_ok=True)
                info_path(f).unlink(missing_ok=True)
                continue
            return f
    return None


DL_TIMEOUT = 3600
CHUNK_TIMEOUT = 180
# TCP/TLS connect budget for a CDN host, separate from the transfer budget: a
# host that is unreachable from this network (geo-limited mirrors, ISP-only
# PCDN nodes) must fail in seconds, not sit on the OS connect timeout.
CONNECT_TIMEOUT = 8
PROBE_TIMEOUT = 8.0

_probe_lock = threading.Lock()
_host_probe: dict[str, float | None] = {}   # host -> latency (s) of a successful tiny GET, None = unreachable


def probe_urls(urls: list[str], headers=None, timeout: float = PROBE_TIMEOUT) -> list[str]:
    """Return `urls` with unreachable hosts dropped and the rest ordered by
    latency, measured with one parallel 1 KB range GET per host.

    Bilibili answers a playurl request with 5–8 mirror URLs and from outside its
    CDN's home network most of them never connect (measured on a Mac abroad:
    6 of 7 hosts time out, one `-ov` overseas mirror answers). Trying them in
    order cost ~75 s per dead host — a fixed ~5 min per download, even for a
    6 s clip. Hosts are cached per process so the audio track and later chunks
    reuse the verdict. If every host fails the original list is returned
    untouched, so the caller's own retry logic still runs.
    """
    from concurrent.futures import ThreadPoolExecutor
    from curl_cffi import CurlHttpVersion
    from curl_cffi import requests as R

    def host_of(u: str) -> str:
        try:
            return urlparse(u).netloc.lower()
        except Exception:
            return u

    pending = []
    with _probe_lock:
        for u in urls:
            h = host_of(u)
            if h not in _host_probe and h not in [host_of(p) for p in pending]:
                pending.append(u)

    def hit(u: str) -> tuple[str, float | None]:
        s = R.Session(impersonate="chrome")
        t0 = time.monotonic()
        try:
            r = s.get(u, headers={**(headers or {}), "Range": "bytes=0-1023"},
                      timeout=(timeout, timeout), http_version=CurlHttpVersion.V1_1)
            ok = r.status_code in (200, 206) and bool(r.content)
        except Exception:
            ok = False
        finally:
            try:
                s.close()
            except Exception:
                pass
        return host_of(u), (time.monotonic() - t0) if ok else None

    if pending:
        with ThreadPoolExecutor(min(8, len(pending))) as ex:
            results = list(ex.map(hit, pending))
        with _probe_lock:
            for h, lat in results:
                _host_probe[h] = lat
    with _probe_lock:
        verdict = {host_of(u): _host_probe.get(host_of(u)) for u in urls}
    good = [u for u in urls if verdict[host_of(u)] is not None]
    if not good:
        log(f"CDN 探测：{len(urls)} 个地址都连不上，按原顺序硬试 ← {urls[0][:70]}")
        return list(urls)
    good.sort(key=lambda u: verdict[host_of(u)])
    dropped = len(urls) - len(good)
    if dropped:
        log(f"CDN 探测：{dropped}/{len(urls)} 个地址连不上已跳过，优先 {host_of(good[0])}"
            f"（{verdict[host_of(good[0])]:.1f}s）")
    return good


# Latest adapter log lines of this process as (sequence, thread id, text). The MCP log is not
# visible to the caller, so a failed fetch quotes its own lines in the tool result instead of
# pointing at a log nobody can read. A sequence number (not a list index, which stops moving once
# the buffer is full) marks where a fetch started; the thread id keeps concurrent fetches apart.
RECENT: list[tuple[int, int, str]] = []
_log_lock = threading.Lock()
_log_seq = 0


def log(msg: str) -> None:
    import sys
    global _log_seq
    with _log_lock:
        _log_seq += 1
        RECENT.append((_log_seq, threading.get_ident(), str(msg)))
        del RECENT[:-200]
    print(f"  [videosites] {msg}", file=sys.stderr)


def log_mark() -> int:
    with _log_lock:
        return _log_seq


def log_since(mark: int) -> list[str]:
    """Lines this thread logged after log_mark() returned `mark`."""
    me = threading.get_ident()
    with _log_lock:
        return [text for seq, tid, text in RECENT if seq > mark and tid == me]


def stream_to(url: str, part: Path, *, headers=None, sess=None, tries: int = 8,
              timeout: float = DL_TIMEOUT) -> bool:
    s = sess or session()
    got, total = 0, None
    n_limited = attempt = loops = 0
    part.parent.mkdir(parents=True, exist_ok=True)
    while attempt < tries and loops < 500:
        loops += 1
        before = got
        h = dict(headers or {})
        if got:
            h["Range"] = f"bytes={got}-"
        wait_host(url)
        try:
            r = s.get(url, headers=h, timeout=timeout, stream=True)
            if r.status_code in (412, 429, 503) and n_limited < 8:
                w = retry_wait(r.headers, n_limited, base=8.0, cap=300.0)
                push_back(url, w)
                n_limited += 1
                r.close()
                time.sleep(w)
                continue
            if r.status_code not in (200, 206):
                r.close()
                log(f"download got HTTP {r.status_code} ← {url[:90]}")
                return False
            if r.status_code == 200:
                got = 0
                cl = r.headers.get("content-length")
                total = int(cl) if cl and cl.isdigit() else None
            elif total is None:
                m = re.search(r"/(\d+)", r.headers.get("content-range") or "")
                total = int(m.group(1)) if m else None
            with part.open("ab" if got else "wb") as fh:
                for chunk in r.iter_content(chunk_size=1 << 16):
                    fh.write(chunk)
                    got += len(chunk)
            r.close()
            if total is None or got >= total:
                return got > 10_000

        except Exception as exc:
            if got <= before:
                attempt += 1
                if attempt >= tries:
                    log(f"download failed ({type(exc).__name__}: {str(exc)[:80]}) ← {url[:90]}")
                time.sleep(min(120, 3 * 2 ** attempt))
                if sess is None:
                    reset_session()
                    s = session()
    log(f"download incomplete ({got}/{total} bytes) ← {url[:90]}")
    return False


def _get_chunk(urls: list[str], start: int, end: int, headers, rounds: int, prefer: int = 0):
    from curl_cffi import CurlHttpVersion
    from curl_cffi import requests as R
    s = session("ranged")
    n = len(urls)
    for i in range(rounds * n):
        u = urls[(prefer + i) % n]
        try:
            r = s.get(u, headers={**(headers or {}), "Range": f"bytes={start}-{end}"},
                      timeout=(CONNECT_TIMEOUT, CHUNK_TIMEOUT), http_version=CurlHttpVersion.V1_1)
        except Exception:
            _tls.pool["ranged"] = R.Session(impersonate="chrome")
            s = _tls.pool["ranged"]
            time.sleep(min(60, 2 * (i + 1)))
            continue
        if r.status_code in (412, 429, 503):
            # Rate-limited by the mirror. The old cap of 300 s turned one
            # throttled chunk into a silent 10+ minute stall; keep the backoff
            # short and say what is happening (the caller sees nothing else).
            w = retry_wait(r.headers, i, base=4.0, cap=60.0)
            log(f"CDN HTTP {r.status_code}（限流）等 {w:.0f}s 再试 {i + 1}/{rounds * n} ← {u.split('/')[2]}")
            time.sleep(w)
            continue

        cr = r.headers.get("content-range") or ""
        m = re.match(r"bytes (\d+)-(\d+)/(\d+)", cr)
        if r.status_code == 206 and m and int(m.group(1)) == start and \
                len(r.content) == int(m.group(2)) - start + 1 and int(m.group(2)) in (end, int(m.group(3)) - 1):
            return r.status_code, r.content, cr
        if r.status_code == 200 and r.content and start == 0:
            return r.status_code, r.content, ""
        time.sleep(min(60, 2 * (i + 1)))
    return None


def ranged_to(urls: list[str], part: Path, *, headers=None, chunk_mb: int = 2, workers: int = 4,
              rounds: int = 8, spread: bool = False) -> bool:
    from concurrent.futures import ThreadPoolExecutor
    step = chunk_mb << 20
    part.parent.mkdir(parents=True, exist_ok=True)
    urls = probe_urls(urls, headers)   # reachable mirrors only, fastest first (see probe_urls)
    if len({u.split("/")[2] for u in urls}) == 1:
        # Every chunk would hit the same host: six parallel range requests on
        # one mirror is exactly what gets it to answer 412 and throttle.
        workers = min(workers, 2)
    first = _get_chunk(urls, 0, step - 1, headers, rounds)
    if not first:
        log(f"ranged download failed on the first chunk ← {urls[0][:90]}")
        return False
    code, body, cr = first
    if code == 200:
        part.write_bytes(body)
        return len(body) > 10_000
    m = re.search(r"/(\d+)", cr)
    total = int(m.group(1)) if m else len(body)
    with part.open("wb") as fh:
        fh.write(body)
    if len(body) >= total:
        return True
    lock = threading.Lock()
    starts = list(range(len(body), total, step))

    def job(st):
        got = _get_chunk(urls, st, min(st + step, total) - 1, headers, rounds,
                         prefer=(st // step) % len(urls) if spread else 0)
        if not got or got[0] != 206:
            return False
        with lock, part.open("r+b") as fh:
            fh.seek(st)
            fh.write(got[1])
        return True
    with ThreadPoolExecutor(workers) as ex:
        ok = all(list(ex.map(job, starts)))
    if not ok or part.stat().st_size != total:
        log(f"ranged download lost chunks ({part.stat().st_size}/{total} bytes) ← {urls[0][:90]}")
        return False
    return True


def download_file(url: str, dest: Path, *, headers=None, sess=None) -> Path | None:
    if Path(dest).resolve().parent != MEDIA.resolve():
        # Cache names are built from remote/caller ids; nothing may leave the media directory.
        log(f"refused to write outside the media directory: {dest}")
        return None
    part = dest.with_name(dest.stem + ".part" + dest.suffix)
    if not stream_to(url, part, headers=headers, sess=sess):
        part.unlink(missing_ok=True)
        return None
    part.rename(dest)
    return dest


def ffmpeg_hls(url: str, dest: Path, *, headers: dict | None = None, timeout: int = 3 * DL_TIMEOUT) -> Path | None:
    part = dest.with_name(dest.stem + ".part.mp4")
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y", "-rw_timeout", "120000000",
           "-reconnect", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "30"]
    if headers:
        cmd += ["-headers", "".join(f"{k}: {v}\r\n" for k, v in headers.items())]
    cmd += ["-i", url, "-c", "copy", "-bsf:a", "aac_adtstoasc", str(part)]
    wait_host(url)
    import os
    env = dict(os.environ)
    for k in ("http_proxy", "https_proxy", "no_proxy"):
        if not env.get(k) and env.get(k.upper()):
            env[k] = env[k.upper()]
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        part.unlink(missing_ok=True)
        log(f"ffmpeg timed out fetching the HLS stream ← {url[:90]}")
        return None
    if p.returncode != 0 or not part.exists() or part.stat().st_size < 10_000:
        part.unlink(missing_ok=True)
        log(f"ffmpeg failed fetching the HLS stream: {p.stderr.decode('utf-8', 'replace')[-160:]} ← {url[:90]}")
        return None
    part.rename(dest)
    return dest


_FMT_GOOD = ("best[height<=480][height>=240][acodec!=none]/bv*[height<=480][height>=240]+ba/"
             "best[height<=480][acodec!=none]/bv*[height<=480]+ba/b[height<=480]/worst")
_FMT_SMALL = "worst[height>=144][acodec!=none]/wv*[height>=144]+wa/worst"


def _est_size(info: dict) -> float:
    fs = info.get("requested_formats") or [info]
    dur = info.get("duration") or 0
    return sum((f.get("filesize") or f.get("filesize_approx") or (f.get("tbr") or 0) * 125 * dur) for f in fs)


def ytdlp(url: str, dest_stem: Path, *, max_mb: int) -> Path | None:
    import yt_dlp
    base = {"quiet": True, "no_warnings": True, "noprogress": True, "noplaylist": True,
            "merge_output_format": "mp4", "outtmpl": str(dest_stem) + ".part.%(ext)s",
            "socket_timeout": 120, "concurrent_fragment_downloads": 4, "retries": 10, "fragment_retries": 10,
            "skip_unavailable_fragments": False}
    try:
        from yt_dlp.networking.impersonate import ImpersonateTarget
        base["impersonate"] = ImpersonateTarget("chrome")
    except Exception:
        pass

    def clean():
        for f in dest_stem.parent.glob(dest_stem.name + ".part*"):
            f.unlink(missing_ok=True)
    for attempt in range(4):
        wait_host(url)
        try:
            with yt_dlp.YoutubeDL({**base, "format": _FMT_GOOD}) as y:
                info = y.extract_info(url, download=False)
                if _est_size(info) <= max_mb << 20:
                    y.process_ie_result(info, download=True)
                else:
                    info = None
            if info is None:
                with yt_dlp.YoutubeDL({**base, "format": _FMT_SMALL}) as y:
                    y.extract_info(url, download=True)
            break
        except Exception as exc:
            clean()
            msg = str(exc)
            if "not a bot" in msg or "logged-in" in msg or "Private" in msg or "removed" in msg:
                log("yt-dlp: the site demands a login check (this network address is treated as a bot)"
                    if "not a bot" in msg else f"yt-dlp failed: {msg[:160]}")
                return None
            if attempt == 3:
                log(f"yt-dlp failed after 4 attempts: {msg[:160]}")
                return None
            time.sleep(10 * 2 ** attempt)
    got = next((f for f in dest_stem.parent.glob(dest_stem.name + ".part.*")
                if f.suffix in (".mp4", ".webm", ".mkv") and f.stat().st_size > 10_000), None)
    if not got:
        clean()
        log(f"yt-dlp finished but left no media file ← {url[:90]}")
        return None
    dest = Path(str(dest_stem) + got.suffix)
    got.rename(dest)
    clean()
    return dest


def ffprobe(path: Path) -> dict:
    import json
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size:stream=codec_type,width,height",
                        "-of", "json", str(path)], capture_output=True, text=True, timeout=60)
    try:
        d = json.loads(p.stdout)
    except Exception:
        return {}
    v = next((s for s in d.get("streams", []) if s.get("codec_type") == "video"), {})
    return {"duration": float((d.get("format") or {}).get("duration") or 0) or None,
            "size_mb": round(int((d.get("format") or {}).get("size") or 0) / 1048576, 1),
            "w": v.get("width"), "h": v.get("height"),
            "audio": any(s.get("codec_type") == "audio" for s in d.get("streams", []))}


def ymd(ts) -> str:
    if ts in (None, "", 0):
        return ""
    if isinstance(ts, (int, float)):
        return time.strftime("%Y-%m-%d", time.gmtime(ts))
    m = re.search(r"(\d{4})[-:/.](\d{1,2})[-:/.](\d{1,2})", str(ts))
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return ""


def hms(text) -> float | None:
    if isinstance(text, (int, float)):
        return float(text) or None
    parts = [p for p in re.split(r"[:：]", str(text or "").strip())]
    if not parts or not all(p.strip().isdigit() for p in parts):
        return None
    s = 0
    for p in parts:
        s = s * 60 + int(p)
    return float(s) or None


def info_path(media: Path) -> Path:
    return media.with_name(media.name + ".info.json")


def write_info(media: Path, extra: dict) -> dict:
    import json
    pr = ffprobe(media)
    src = extra.get("source_duration")
    cov = pr.get("duration")
    trunc = bool(src and cov and cov < src - max(3.0, 0.03 * src))
    info = {**extra, "path": str(media), "covered_s": round(cov, 2) if cov else None, "truncated": trunc,
            "w": pr.get("w"), "h": pr.get("h"), "audio": pr.get("audio"), "size_mb": pr.get("size_mb"),
            "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    info_path(media).write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    return info


def read_info(media: Path) -> dict | None:
    import json
    p = info_path(media)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None
