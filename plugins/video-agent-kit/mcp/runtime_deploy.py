"""deploy_website: serve a built static site on a stable local URL for ZCode Browser Use.

- The first deploy starts one `python3 -m http.server` bound to 127.0.0.1; later deploys
  reuse the same port and swap the served directory in place, so the URL never changes and
  the built-in browser tab only needs a `reload()` (a new port forces a new navigation and
  discards the tab state).
- The served root is the deployed dist itself, so absolute `/assets/...` references resolve.
- Servers are registered in-process; `stop_all()` stops them and removes the serve directories
  this process created when the MCP server exits.
- The plugin never starts Playwright/Chromium; navigation, screenshots and recordings go
  through ZCode's built-in browser (`control-browser` skill).
"""
from __future__ import annotations

import os
import re
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

_SERVERS: list[dict] = []

# Absolute image references inside the build (/assets/foo.png); bundle files are skipped.
_ASSET_REF_RE = re.compile(r"/assets/[\w\-./]+\.(?:png|jpe?g|gif|webp|svg|avif)", re.IGNORECASE)
_TESTID_RE = re.compile(r"data-testid[=:\"'\s]+[\"']?([A-Za-z0-9_-]+)")


def workspace() -> Path:
    for name in ("V2C_WORKSPACE", "VE_PROJECT_DIR"):
        value = (os.environ.get(name) or "").strip()
        if value:
            return Path(value).expanduser().resolve()
    return Path.cwd().resolve()


def _resolve(local_dir: str) -> Path:
    path = Path(local_dir).expanduser()
    return (path if path.is_absolute() else workspace() / path).resolve()


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


READY_TIMEOUT_SECONDS = 5.0


def _spawn_httpd(root: Path, port: int) -> subprocess.Popen | None:
    """Start http.server with this interpreter; None unless it is accepting connections."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=str(root), stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if proc.poll() is not None:      # exited, e.g. the port is already taken
            return None
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                pass
        except OSError:
            time.sleep(0.1)
            continue
        # Something answers; make sure it is our server and not another listener on the port.
        time.sleep(0.2)
        if proc.poll() is None:
            return proc
        return None
    proc.terminate()
    return None


def _start_failed(local_dir: str, port: int) -> dict:
    return {"status": "failed", "local_dir": local_dir,
            "error": {"kind": "server_start_failed",
                      "message": f"the local http server did not start listening on 127.0.0.1:{port}"}}


def _swap_contents(dst: Path, src: Path) -> None:
    """Replace dst's contents with src's; dst itself stays so http.server keeps serving."""
    for child in dst.iterdir():
        shutil.rmtree(child) if child.is_dir() else child.unlink()
    for item in src.iterdir():
        if item.is_dir():
            shutil.copytree(item, dst / item.name)
        else:
            shutil.copy2(item, dst / item.name)


def _newer_sources(dist: Path) -> list[Path]:
    """src/ files newer than the newest dist file (dist must be <app>/dist)."""
    if dist.name != "dist":
        return []
    src_dir = dist.parent / "src"
    if not (src_dir.is_dir() and (dist.parent / "package.json").is_file()):
        return []
    try:
        dist_mtime = max((f.stat().st_mtime for f in dist.rglob("*") if f.is_file()), default=0.0) \
            if dist.exists() else 0.0
        return [f for f in src_dir.rglob("*") if f.is_file() and f.stat().st_mtime > dist_mtime + 1.0]
    except OSError:
        return []


def _auto_build(dist: Path) -> tuple[str | None, str | None]:
    """Run `npm run build` when src/ is newer than dist. Returns (note, error)."""
    if os.environ.get("V2C_DEPLOY_AUTOBUILD", "1") == "0":
        return None, None
    newer = _newer_sources(dist)
    if not newer:
        return None, None
    app = dist.parent
    try:
        proc = subprocess.run(["npm", "run", "build"], cwd=str(app), capture_output=True,
                              text=True, timeout=240, stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        return None, None  # no npm: fall through to the stale warning
    except subprocess.TimeoutExpired:
        return None, "auto-build timed out (>240s); nothing deployed. Build manually and inspect."
    if proc.returncode != 0:
        tail = ((proc.stdout or "") + "\n" + (proc.stderr or ""))[-1500:]
        return None, "dist is older than src and the automatic `npm run build` failed; nothing deployed " \
                     "(deploying a stale build would mislead verification). Fix the build, then redeploy:\n" + tail
    return f"{len(newer)} src/ file(s) were newer than dist; ran `npm run build` before deploying.", None


def _scan(root: Path, pattern: re.Pattern, suffixes: tuple[str, ...], limit: int = 60) -> set[str]:
    found: set[str] = set()
    files = [root / "index.html"] + [p for p in root.rglob("*") if p.suffix.lower() in suffixes][:limit]
    for f in files:
        if not f.is_file():
            continue
        try:
            found.update(pattern.findall(f.read_text(encoding="utf-8", errors="ignore")))
        except OSError:
            continue
    return found


def deploy_website(args: dict) -> dict:
    local_dir = str(args.get("local_dir") or "")
    if not local_dir:
        return {"status": "failed", "error": {"kind": "invalid_arguments", "message": "local_dir is required"}}
    site_type = str(args.get("type") or "static")
    if site_type != "static":
        return {"status": "failed", "error": {"kind": "invalid_arguments", "message": "only type=static is supported"}}
    src = _resolve(local_dir)
    build_note, build_error = _auto_build(src)
    if build_error:
        return {"status": "failed", "local_dir": local_dir, "error": {"kind": "build_failed", "message": build_error}}
    if not src.is_dir():
        return {"status": "failed", "local_dir": local_dir,
                "error": {"kind": "local_dir_missing", "message": f"local_dir not found: {src}"}}
    if not (src / "index.html").is_file():
        return {"status": "failed", "local_dir": local_dir,
                "error": {"kind": "index_missing", "message": f"{src} has no index.html (build the project first)"}}

    serve_root = workspace() / ".v2c" / "serve"
    serve_root.mkdir(parents=True, exist_ok=True)

    live = next((s for s in reversed(_SERVERS) if s["proc"].poll() is None), None)
    same_url = True
    if live is not None:
        _swap_contents(live["dst"], src)
        port, dst = live["port"], live["dst"]
    elif _SERVERS:
        # The previous server died: restart on the same port/dir so the URL does not drift.
        # If that port has been taken meanwhile, fall back to a new port (the URL changes).
        prev = _SERVERS[-1]
        _swap_contents(prev["dst"], src)
        proc = _spawn_httpd(prev["dst"], prev["port"])
        if proc is None:
            same_url = False
            prev["port"] = _free_port()
            proc = _spawn_httpd(prev["dst"], prev["port"])
        if proc is None:
            return _start_failed(local_dir, prev["port"])
        prev["proc"] = proc
        port, dst = prev["port"], prev["dst"]
    else:
        same_url = False
        dst = serve_root / uuid.uuid4().hex[:10]
        shutil.copytree(src, dst)
        port = _free_port()
        proc = _spawn_httpd(dst, port)
        if proc is None:
            shutil.rmtree(dst, ignore_errors=True)
            return _start_failed(local_dir, port)
        _SERVERS.append({"proc": proc, "port": port, "dst": dst})

    url = f"http://localhost:{port}/"
    stale = [str(f.relative_to(src.parent / "src")) for f in _newer_sources(src)[:5]]
    refs = _scan(dst, _ASSET_REF_RE, (".js", ".css", ".html"))
    broken = sorted(ref for ref in refs if not (dst / ref.lstrip("/")).exists())
    testids = sorted(_scan(dst, _TESTID_RE, (".js", ".html")))

    result = {
        "status": "deployed",
        "url": url,
        "same_url": same_url,
        "local_dir": local_dir,
        "served_from": str(dst),
        "auto_build": build_note,
        "stale_src_files": stale,
        "data_testids": testids[:60],
        "broken_image_assets": broken,
        "browser": ("Open or reload this URL in ZCode's built-in browser (control-browser skill, IAB tab); "
                    "the deploy tool holds no browser and returns no screenshot."
                    + (" URL unchanged: recover the existing tab and reload()." if same_url else "")),
        "lifetime": "the server lives inside this MCP process; the URL dies with the session",
    }
    if stale:
        result["warning"] = ("src/ has files newer than the deployed dist; this deploy serves an OLD build. "
                             "Run `npm run build` and redeploy before judging the recent edits.")
    if broken:
        result["broken_image_assets_note"] = ("these /assets/ paths are referenced but missing — they render as "
                                              "broken images; place the files under public/assets/ or fix the "
                                              "references, rebuild, redeploy")
    return result


def stop_all() -> None:
    """Stop every server this process started and remove the serve directories it created."""
    for server in _SERVERS:
        try:
            server["proc"].terminate()
            server["proc"].wait(timeout=5)
        except Exception:
            pass
        shutil.rmtree(server["dst"], ignore_errors=True)
    _SERVERS.clear()
