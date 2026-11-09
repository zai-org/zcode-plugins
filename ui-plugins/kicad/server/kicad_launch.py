"""Start the KiCad PCB Editor on macOS and say honestly whether it is running afterwards.

`open -a` exits 0 as soon as Launch Services has accepted the request, even if the program dies a moment later. The case that motivated this module: a KiCad
copied into /Applications with the download quarantine flag is "translocated" by Launch Services (only the nested pcbnew.app is run from a random read-only
copy), dyld cannot find @rpath/libkicommon.*.dylib there and pcbnew aborts before any window appears, while `open` reports success.

So after `open` we wait for a `pcbnew` process that stays alive; if it never shows up, or dies again, we look for the crash report macOS wrote
(~/Library/Logs/DiagnosticReports/pcbnew-*.ips), put the reason into the note and, for the quarantine case, name the command the *user* must run. This code never
changes an attribute itself.

Standard library only: test/test_launch.py tests it with fake `open`, `pgrep` and `xattr` programs on PATH and a fixture crash report.
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import time
from pathlib import Path

PROCESS = "pcbnew"
APPEAR_S = 8.0  # how long pcbnew may take to show up after `open`
STABLE_S = 2.0  # how long it must then stay alive
REPORT_S = 4.0  # how long to wait for the crash reporter once pcbnew is gone
POLL_S = 0.25
QUARANTINE = "com.apple.quarantine"


def reports_dir() -> Path:
    """The real user's DiagnosticReports directory. Not $HOME: ZCode may run plugins with HOME pointing at an isolated profile."""
    try:
        import pwd

        home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    except (ImportError, KeyError, OSError):
        home = Path.home()
    return home / "Library" / "Logs" / "DiagnosticReports"


def _run(cmd: list[str], timeout: float) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None


def _running() -> bool | None:
    """Is a process named pcbnew alive? None when pgrep itself cannot tell (missing, blocked, failing)."""
    r = _run(["pgrep", "-x", PROCESS], 5)
    if r is None or r.returncode not in (0, 1):
        return None
    return r.returncode == 0


def newest_report(report_dir: Path, since: float) -> Path | None:
    """The newest pcbnew-*.ips written at or after `since` (epoch seconds), or None."""
    best: tuple[float, Path] | None = None
    try:
        for p in report_dir.glob("pcbnew-*.ips"):
            try:
                mtime = p.stat().st_mtime
            except OSError:
                continue
            if mtime >= since and (best is None or mtime > best[0]):
                best = (mtime, p)
    except OSError:
        return None
    return best[1] if best else None


def crash_reason(report: Path) -> tuple[str, bool]:
    """(short reason, translocated) from an .ips crash report: line 1 is a JSON header, the rest a JSON body with `termination.reasons`.
    Anything unreadable or unexpected gives ("", False); this never raises."""
    try:
        text = report.read_text(encoding="utf-8", errors="replace")
        head, _, body = text.partition("\n")
        data = json.loads(body) if body.strip() else json.loads(head)
        term = data.get("termination") or {}
        reasons = [str(r) for r in (term.get("reasons") or [])]
        translocated = "AppTranslocation" in " ".join(reasons) or "AppTranslocation" in str(data.get("procPath", ""))
        reason = reasons[0] if reasons else str(term.get("indicator") or "")
        if not reason:
            signal = (data.get("exception") or {}).get("signal")
            reason = f"signal {signal}" if signal else ""
        return " ".join(reason.split())[:160], translocated
    except Exception:  # noqa: BLE001 - an odd crash report must never break the answer
        return "", False


def _quarantined(app_dir: Path) -> bool:
    """Does KiCad.app or the directory around it carry the download quarantine flag? (`xattr -p` only reads.)"""
    for p in (app_dir, app_dir.parent):
        r = _run(["xattr", "-p", QUARANTINE, str(p)], 5)
        if r is not None and r.returncode == 0:
            return True
    return False


def fix_dir(app_dir: Path) -> Path:
    """The directory the user is told to clear: the folder holding KiCad.app (/Applications/KiCad), but never /Applications itself."""
    parent = app_dir.parent
    return app_dir if parent.name in ("", "Applications") else parent


def _quarantine_hint(app_dir: Path, translocated: bool) -> str:
    cause = ("macOS ran PCB Editor from a temporary quarantined copy (App Translocation), where KiCad's libraries are missing."
             if translocated else "KiCad still carries the macOS download quarantine flag, a likely cause (App Translocation).")
    return f" {cause} Fix it yourself in Terminal, then open the board again: xattr -dr {QUARANTINE} {shlex.quote(str(fix_dir(app_dir)))}"


def launch_editor(editor: Path, pcb: Path, app_dir: Path, *, report_dir: Path | None = None, appear_s: float = APPEAR_S, stable_s: float = STABLE_S,
                  report_s: float = REPORT_S, poll_s: float = POLL_S) -> tuple[bool, str]:
    """`open -a editor pcb`, then check that pcbnew really runs. Returns (launched, note); launched is False when it never appeared or died again.
    Takes up to appear_s + stable_s seconds (about 10 s with the defaults), a bit more when it has to wait for a crash report."""
    reports = report_dir if report_dir is not None else reports_dir()
    started = time.time()
    try:
        r = subprocess.run(["open", "-a", str(editor), str(pcb)], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, f"could not start KiCad: {e}"
    if r.returncode != 0:
        return False, f"open failed: {r.stderr.strip()[:200]}"

    t0 = time.monotonic()
    seen: float | None = None
    died = False
    while True:
        alive = _running()
        now = time.monotonic()
        if alive is None:
            return True, f"opened in {editor.name} (could not check that it stays running: pgrep is unavailable)"
        if alive:
            seen = now if seen is None else seen
            if now - seen >= stable_s:
                return True, f"opened in {editor.name}"
        elif seen is not None:
            died = True
            break
        elif newest_report(reports, started) is not None or now - t0 >= appear_s:  # crashed before we ever saw it, or never started
            break
        time.sleep(poll_s)

    report = newest_report(reports, started)
    if report is None and died:  # the crash reporter writes its file a moment after the process is gone
        deadline = time.monotonic() + report_s
        while report is None and time.monotonic() < deadline:
            time.sleep(poll_s)
            report = newest_report(reports, started)
    reason, translocated = crash_reason(report) if report else ("", False)
    if report is not None:
        what = f"PCB Editor crashed right after it was opened ({reason or report.name})."
    elif died:
        what = f"PCB Editor started but quit again within {stable_s:g} s (no crash report found)."
    else:
        what = f"PCB Editor did not start within {appear_s:g} s (no pcbnew process and no crash report found)."
    if translocated or _quarantined(app_dir):
        what += _quarantine_hint(app_dir, translocated)
    return False, what
