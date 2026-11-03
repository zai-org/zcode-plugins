"""Start one exact KiCad PCB Editor process and verify its live-API socket.

Do not use ``open -a`` here.  Launch Services is allowed to reuse an already running
standalone PCB Editor, which means the requested board can open in a process that has
no KiCad 10 API server.  Executing the selected distribution's pcbnew binary creates a
fresh process and, when "Enable KiCad API" is on, a matching ``api-<pid>.sock`` (or the
first ``api.sock``).  This is what lets ZCode and that exact editor communicate live.

We still watch the child long enough to catch the quarantined/App-Translocation crash
that motivated the old launcher.  Crash reports are diagnosed read-only and any xattr
command is merely shown to the user; this module never changes an attribute itself.

Standard library only; test/test_launch.py uses a fake pcbnew executable.
"""
from __future__ import annotations

import json
import os
import shlex
import stat
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

STABLE_S = 2.0  # how long it must then stay alive
REPORT_S = 4.0  # how long to wait for the crash reporter once pcbnew is gone
POLL_S = 0.25
SOCKET_S = 8.0  # the window may be visible shortly before the API server is listening
BOARD_S = 8.0  # the socket can exist before pcbnew has opened the requested board (or while a lock dialog is showing)
SOCKET_DIR = Path("/tmp/kicad")
QUARANTINE = "com.apple.quarantine"
_children: list[subprocess.Popen] = []  # keep detached GUI Popen objects alive; otherwise Python warns while the intentional child is still running


def reap_children() -> None:
    """Forget GUI children that have exited; live ones remain deliberately detached."""
    _children[:] = [child for child in _children if child.poll() is None]


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


def pcbnew_executable(editor: Path) -> Path:
    """The canonical executable inside either ``PCB Editor.app`` or nested ``pcbnew.app``.

    KiCad's macOS installer makes ``PCB Editor.app`` a symlink.  Executing pcbnew
    through that outer spelling opens the GUI but does not start its API server;
    resolving it to the nested app before ``exec`` is therefore functional, not cosmetic.
    """
    return (editor / "Contents" / "MacOS" / "pcbnew").resolve()


def _socket_ready(path: Path) -> bool:
    try:
        return stat.S_ISSOCK(path.stat().st_mode)
    except OSError:
        return False


def wait_for_live_board(pcb: Path, status: Callable[[str, Path | None], dict[str, Any]], workspace: Path | None = None, *,
                        board_s: float = BOARD_S, poll_s: float = POLL_S) -> tuple[bool, dict[str, Any]]:
    """Wait until the live API reports that *pcb* is the open session board.

    A KiCad API socket only proves that an editor process is alive.  The board can
    still be unopened because pcbnew is starting or is displaying a project-lock
    dialog.  Keep this distinction explicit so callers never report a false live
    connection.  ``status`` is injected to keep this helper hermetic in tests.
    """
    deadline = time.monotonic() + max(0.0, board_s)
    last: dict[str, Any] = {}
    while True:
        try:
            last = status(str(pcb), workspace)
        except Exception as error:  # noqa: BLE001 - a diagnostic callback must not turn a successful GUI launch into an exception
            last = {"available": False, "reason": f"live board verification failed: {error}"}
        if last.get("available"):
            return True, last
        # These states cannot become ready merely by waiting for this process.
        if last.get("kipy") is False or last.get("api_enabled_in_preferences") is False:
            return False, last
        if time.monotonic() >= deadline:
            return False, last
        time.sleep(max(0.001, poll_s))


def launch_editor(editor: Path, pcb: Path, app_dir: Path, *, report_dir: Path | None = None, socket_dir: Path = SOCKET_DIR, stable_s: float = STABLE_S,
                  socket_s: float = SOCKET_S, report_s: float = REPORT_S, poll_s: float = POLL_S, env: dict[str, str] | None = None,
                  api_expected: bool | None = None) -> tuple[bool, str]:
    """Execute this distribution's pcbnew with ``pcb`` and watch that exact child.

    Returns ``(launched, note)``.  ``launched`` means the GUI process survived the
    stability window; the note separately says whether its live API socket appeared.
    No socket is treated as a usable file-round-trip editor, not as a failed launch.
    """
    reports = report_dir if report_dir is not None else reports_dir()
    reap_children()
    exe = pcbnew_executable(editor)
    if not exe.is_file() or not os.access(exe, os.X_OK):
        return False, f"KiCad PCB Editor executable not found or not executable: {exe}"
    try:
        socket_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        default_socket = socket_dir / "api.sock"
        default_existed = default_socket.exists()
    except OSError as e:
        return False, f"could not prepare the KiCad live API directory: {e}"
    started = time.time()
    try:
        child = subprocess.Popen(
            [str(exe), str(pcb)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            env=env,
        )
        _children.append(child)
    except OSError as e:
        note = f"could not start KiCad: {e}"
        if _quarantined(app_dir):
            note += _quarantine_hint(app_dir, False)
        return False, note

    pid_socket = socket_dir / f"api-{child.pid}.sock"

    stable_at = time.monotonic() + stable_s
    while time.monotonic() < stable_at:
        if child.poll() is not None:
            break
        time.sleep(poll_s)
    if child.poll() is None:
        deadline = time.monotonic() + socket_s
        while time.monotonic() < deadline and child.poll() is None:
            if _socket_ready(pid_socket) or (not default_existed and _socket_ready(default_socket)):
                return True, f"opened in {editor.name}; live KiCad API socket ready"
            time.sleep(poll_s)
        if child.poll() is None:
            if api_expected is True:
                return True, (f'opened in {editor.name}, but its live API socket did not appear even though "Enable KiCad API" is on; '
                              "close any older PCB Editor window or project-lock dialog for this board, then try again (file save/sync still works)")
            return True, f'opened in {editor.name}, but its live API did not appear; enable "Enable KiCad API" in KiCad Preferences for real-time access (file save/sync still works)'

    report = newest_report(reports, started)
    if report is None:
        deadline = time.monotonic() + report_s
        while report is None and time.monotonic() < deadline:
            time.sleep(poll_s)
            report = newest_report(reports, started)
    reason, translocated = crash_reason(report) if report else ("", False)
    if report is not None:
        what = f"PCB Editor crashed right after it was opened ({reason or report.name})."
    else:
        code = child.returncode
        what = f"PCB Editor quit right after it was opened (exit {code}; no crash report found)."
    if translocated or _quarantined(app_dir):
        what += _quarantine_hint(app_dir, translocated)
    return False, what
