"""Durable recap stages and bounded, filesystem-coordinated resource slots.

Locks are kernel flock locks, not PID files: never delete a lock file or kill an
owner to recover. Default resource limits span processes in the same filesystem
namespace. Cross-container limits require VE_RECAP_BUDGET_DIR mounted to the same
writable filesystem with working cross-client flock; a matching pathname alone
does not establish a shared budget. Owner liveness is only asserted for the same
host, boot, and PID namespace.
"""
from __future__ import annotations

import contextlib
from ve_tools import file_lock
import functools
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid


DEFAULT_LIMITS = {"tts": 1, "asr": 2, "render": 1, "prepare": 2}
# Resources with a registered VE_RECAP_LIMIT_<NAME> override; others use DEFAULT_LIMITS.
ENV_LIMITS = frozenset({"tts", "asr", "render", "prepare"})


class RuntimeBusy(RuntimeError):
    """Recoverable contention; retry after the current owner releases its lock."""


def _name(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[\w.-]{1,160}", value) \
            or value in (".", ".."):
        raise ValueError("runtime name must be one safe path component")
    return value


def _read(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        descriptor = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as out:
            json.dump(value, out, ensure_ascii=False, sort_keys=True, indent=2)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


ATTEMPT_JOURNAL_MAX_BYTES = 8 * 1024 * 1024
ATTEMPT_JOURNAL_KEEP = 3


def _rotate_attempts(folder: Path) -> None:
    """Caller holds attempts.lock. Rename is atomic; old generations are bounded."""
    journal = folder / "attempts.jsonl"
    try:
        if journal.stat().st_size < ATTEMPT_JOURNAL_MAX_BYTES:
            return
    except FileNotFoundError:
        return
    os.replace(journal, folder / f"attempts.{time.time_ns()}.jsonl")
    rotated = sorted(folder.glob("attempts.*.jsonl"))
    for old in rotated[:-ATTEMPT_JOURNAL_KEEP]:
        old.unlink(missing_ok=True)


def _append_attempt(folder: Path, record: dict) -> None:
    # O_APPEND alone is not atomic between clients of a network filesystem.
    # Serialize the complete record, including any short writes, under flock.
    # Keep this lock file stable, as with the resource ownership locks. The
    # journal is diagnostic: it is size-rotated and not fsynced per slot (the
    # slot record itself is written atomically and durably).
    payload = (json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n").encode()
    with (folder / "attempts.lock").open("a+") as lock:
        file_lock.flock(lock.fileno(), file_lock.LOCK_EX)
        try:
            _rotate_attempts(folder)
            descriptor = os.open(folder / "attempts.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            try:
                remaining = memoryview(payload)
                while remaining:
                    count = os.write(descriptor, remaining)
                    if count <= 0:
                        raise OSError("runtime attempt journal write made no progress")
                    remaining = remaining[count:]
            finally:
                os.close(descriptor)
        finally:
            file_lock.flock(lock.fileno(), file_lock.LOCK_UN)


_LOCAL_FILESYSTEMS = {"ext2", "ext3", "ext4", "xfs", "btrfs", "tmpfs", "overlay", "zfs", "f2fs", "ramfs"}


def _filesystem_type(path: Path) -> str | None:
    try:
        return _mount_type(str(path.resolve().parent))
    except OSError:
        return None


@functools.lru_cache(maxsize=4096)
def _mount_type(target: str) -> str | None:
    try:
        best, kind = "", None
        with open("/proc/self/mountinfo", encoding="utf-8") as mounts:
            for line in mounts:
                left, _, right = line.partition(" - ")
                fields = left.split()
                if len(fields) < 5 or not right:
                    continue
                point = fields[4].replace("\\040", " ")
                if (target == point or target.startswith(point.rstrip("/") + "/")) and len(point) >= len(best):
                    best, kind = point, right.split()[0]
        return kind
    except OSError:
        return None


def _kernel_lock_table(path: Path) -> bool | None:
    """True/False from /proc/locks for local filesystems; None when not conclusive."""
    try:
        stat = path.stat()
    except FileNotFoundError:
        return False
    except OSError:
        return None
    if _filesystem_type(path) not in _LOCAL_FILESYSTEMS:
        return None  # FUSE/network locks are not listed in the local table.
    wanted = (os.major(stat.st_dev), os.minor(stat.st_dev), stat.st_ino)
    try:
        with open("/proc/locks", encoding="utf-8") as table:
            for line in table:
                fields = line.split()
                if "->" in fields:
                    continue  # Blocked waiters do not hold the lock.
                for field in fields:
                    parts = field.split(":")
                    if len(parts) == 3:
                        try:
                            if (int(parts[0], 16), int(parts[1], 16), int(parts[2])) == wanted:
                                return True
                        except ValueError:
                            pass
                        break
    except OSError:
        return None
    return False


def _text(path: str) -> str | None:
    try:
        return Path(path).read_text().strip()
    except OSError:
        return None


def _pid_start(pid: int) -> str | None:
    """A process's start time as an opaque string; None when the process is gone or unreadable."""
    if sys.platform.startswith("linux"):
        text = _text(f"/proc/{pid}/stat")
        if not text:
            return None
        # Field 2 may contain spaces/parentheses; starttime is field 22.
        try:
            return text[text.rfind(")") + 2:].split()[19]
        except IndexError:
            return None
    if os.name == "nt":
        return _windows_process(pid)[1]
    try:   # macOS / BSD
        proc = subprocess.run(["ps", "-o", "lstart=", "-p", str(int(pid))], capture_output=True, text=True,
                              timeout=10, stdin=subprocess.DEVNULL)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return proc.stdout.strip() or None


def _windows_process(pid: int) -> tuple[bool | None, str | None]:
    """(exists, creation time) of a Windows process; exists is None when access is denied."""
    import ctypes
    from ctypes import wintypes
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    handle = kernel32.OpenProcess(0x1000, False, int(pid))   # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return (None if ctypes.get_last_error() == 5 else False), None   # 5: access denied
    try:
        code = wintypes.DWORD()
        if kernel32.GetExitCodeProcess(handle, ctypes.byref(code)) and code.value != 259:   # STILL_ACTIVE
            return False, None
        times = [wintypes.FILETIME() for _ in range(4)]
        if not kernel32.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
            return True, None
        return True, str((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime)
    finally:
        kernel32.CloseHandle(handle)


def _process_exists(pid: int) -> bool | None:
    if os.name == "nt":
        return _windows_process(pid)[0]
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return None
    return True


def _boot_id() -> str | None:
    if sys.platform.startswith("linux"):
        return _text("/proc/sys/kernel/random/boot_id")
    if sys.platform == "darwin":
        try:
            proc = subprocess.run(["sysctl", "-n", "kern.boottime"], capture_output=True, text=True,
                                  timeout=10, stdin=subprocess.DEVNULL)
        except (OSError, subprocess.SubprocessError):
            return None
        return proc.stdout.strip() or None
    return None   # Windows: process creation times (100 ns) already separate boots


def account_tag() -> str:
    """Stable per-user name for shared temp folders (uid on POSIX, login name on Windows)."""
    if hasattr(os, "getuid"):
        return str(os.getuid())
    import getpass
    try:
        return re.sub(r"[^A-Za-z0-9_.-]", "_", getpass.getuser())
    except (KeyError, OSError):
        return "user"


def owner_identity() -> dict:
    try:
        namespace = os.readlink("/proc/self/ns/pid") if sys.platform.startswith("linux") else None
    except OSError:
        namespace = None
    return {"hostname": socket.gethostname(), "boot_id": _boot_id(),
            "pid_namespace": namespace, "pid": os.getpid(),
            "process_start": _pid_start(os.getpid())}


def owner_liveness(owner: dict) -> str:
    local = owner_identity()
    if not owner.get("hostname") or not local.get("hostname"):
        return "unknown"
    # boot_id / pid_namespace exist only on some platforms: compare what both sides recorded.
    for key in ("boot_id", "pid_namespace"):
        if bool(owner.get(key)) != bool(local.get(key)):
            return "unknown"
    keys = [key for key in ("hostname", "boot_id", "pid_namespace") if local.get(key)]
    if any(owner[key] != local[key] for key in keys):
        return "unknown_remote"
    try:
        pid = int(owner.get("pid", 0))
    except (TypeError, ValueError):
        return "unknown"
    if pid <= 0 or not owner.get("process_start"):
        return "unknown"
    current = _pid_start(pid)
    stat = _text(f"/proc/{pid}/stat") if sys.platform.startswith("linux") else None
    if stat and stat[stat.rfind(")") + 2:].split()[0] in ("Z", "X"):
        return "stopped"
    if current == owner["process_start"]:
        return "alive"
    # The start time may be unreadable (restricted procfs, denied access); only a
    # missing process proves the owner stopped.
    if current is None:
        return "stopped" if _process_exists(pid) is False else "unknown"
    return "stopped"  # PID was reused by another process.


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _snapshot(value):
    # Use Path for file inputs; strings are literal parameters (never guessed).
    if isinstance(value, Path):
        path = value.resolve()
        return {"path": str(path), "sha256": _hash_file(path) if path.is_file() else None}
    if isinstance(value, dict):
        return {str(key): _snapshot(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_snapshot(item) for item in value]
    return value


def _outputs(paths: list[Path]) -> dict:
    return {str(path.resolve()): _hash_file(path) if path.is_file() else None for path in paths}


def _missing_file(value) -> bool:
    if isinstance(value, dict):
        return ("path" in value and "sha256" in value and value["sha256"] is None) \
            or any(_missing_file(item) for item in value.values())
    return isinstance(value, list) and any(_missing_file(item) for item in value)


class Stage:
    def __init__(self, workspace: Path, name: str, inputs: dict,
                 outputs: list[Path], heartbeat_seconds: float):
        self.name = _name(name)
        self.folder = Path(workspace) / ".video_agent/recap_runtime/stages"
        self.path = self.folder / f"{self.name}.json"
        self.outputs = [Path(path) for path in outputs]
        self._input_sources = inputs
        self.inputs = _snapshot(inputs)
        self.heartbeat_seconds = max(0.05, float(heartbeat_seconds))
        self.cached = False
        self.had_checkpoint = False
        self.record = {}
        self._stop = threading.Event()
        self._thread = None
        self._mutex = threading.Lock()
        self._handle = None

    def __enter__(self):
        self.folder.mkdir(parents=True, exist_ok=True)
        self._handle = (self.folder / f"{self.name}.lock").open("a+")
        try:
            file_lock.flock(self._handle.fileno(), file_lock.LOCK_EX | file_lock.LOCK_NB)
        except BlockingIOError:
            self._handle.close()
            self._handle = None
            raise RuntimeBusy(f"stage {self.name} already has an active writer; retry after release")
        try:
            previous = _read(self.path)
            self.had_checkpoint = bool(previous)
            current_outputs = _outputs(self.outputs)
            self.cached = bool(current_outputs) and all(current_outputs.values()) \
                and not _missing_file(self.inputs) \
                and previous.get("status") == "completed" \
                and previous.get("inputs") == self.inputs \
                and previous.get("outputs") == current_outputs
            now = time.time()
            self.record = {"version": 1, "stage": self.name, "status": "running",
                           "owner": owner_identity(), "started_at": now, "heartbeat_at": now,
                           "inputs": self.inputs, "outputs": current_outputs,
                           "cache_hit": self.cached, "attempt_id": uuid.uuid4().hex,
                           "heartbeat_seconds": self.heartbeat_seconds}
            _write(self.path, self.record)
            self._thread = threading.Thread(target=self._heartbeat, daemon=True)
            self._thread.start()
            return self
        except BaseException:
            self._handle.close()
            self._handle = None
            raise

    def _heartbeat(self):
        while not self._stop.wait(self.heartbeat_seconds):
            with self._mutex:
                self.record["heartbeat_at"] = time.time()
                try:
                    _write(self.path, self.record)
                except OSError:
                    # The owner still holds the lock. Readers see stale/unknown
                    # heartbeat instead of interpreting failed writes as exit.
                    pass

    def complete(self, **metrics):
        if _missing_file(self.inputs):
            raise ValueError(f"stage {self.name} cannot complete with missing file inputs")
        if _snapshot(self._input_sources) != self.inputs:
            raise ValueError(f"stage {self.name} inputs changed while running")
        outputs = _outputs(self.outputs)
        if any(value is None for value in outputs.values()):
            raise ValueError(f"stage {self.name} cannot complete with missing outputs")
        # The stage must not certify outputs against inputs changed during work.
        with self._mutex:
            self.record.update(status="completed", outputs=outputs,
                               completed_at=time.time(), metrics=metrics)
            _write(self.path, self.record)

    def fail(self, reason: str = "stage_failed"):
        with self._mutex:
            self.record.update(status="failed", failure_code=_name(reason), completed_at=time.time())
            _write(self.path, self.record)

    def __exit__(self, exc_type, exc, traceback):
        self._stop.set()
        if self._thread:
            self._thread.join()
        try:
            if exc_type:
                self.fail("interrupted" if issubclass(exc_type, (KeyboardInterrupt, SystemExit))
                          else exc_type.__name__)
            elif self.record.get("status") == "running":
                if (self.cached and _outputs(self.outputs) == self.record["outputs"]
                        and _snapshot(self._input_sources) == self.inputs):
                    self.complete()
                else:
                    self.fail("not_committed")
        finally:
            if self._handle:
                file_lock.flock(self._handle.fileno(), file_lock.LOCK_UN)
                self._handle.close()
        return False


def stage_run(workspace: str | Path, name: str, *, inputs: dict | None = None,
              outputs: list[str | Path] | None = None, heartbeat_seconds: float = 5.0) -> Stage:
    """Hold one stage writer; caller checks .cached and explicitly calls .complete().

    Use an outer ``production`` stage with no outputs to protect the full movie;
    inner stages can cache their own exact file inputs (Path) and output hashes.
    Exceptions/failure never certify old output files. No remote PID is killed.
    """
    return Stage(Path(workspace), name, inputs or {},
                 [Path(path) for path in outputs or []], heartbeat_seconds)


def runtime_snapshot(workspace: str | Path) -> dict:
    stages = []
    for path in sorted((Path(workspace) / ".video_agent/recap_runtime/stages").glob("*.json")):
        record = _read(path)
        if not record:
            continue
        status = record.get("status", "unknown")
        stages.append({key: record.get(key) for key in
                       ("stage", "status", "started_at", "completed_at", "heartbeat_at",
                        "failure_code", "cache_hit", "metrics")})
        stages[-1]["owner_state"] = owner_liveness(record.get("owner") or {}) \
            if status == "running" else "not_running"
        # Stage writers heartbeat; never take their lock from a monitor. The
        # kernel table is used where available, otherwise the heartbeat.
        held = _kernel_lock_table(path.with_suffix('.lock')) if path.with_suffix('.lock').exists() else False
        evidence = 'kernel_lock_table'
        if held is None:
            evidence = 'heartbeat'
            try:
                age = time.time() - float(record.get("heartbeat_at") or 0)
                interval = float(record.get("heartbeat_seconds") or 5.0)
            except (TypeError, ValueError):
                age, interval = None, 5.0
            held = (status == 'running' and age is not None and age <= max(30.0, 6 * interval)
                    and stages[-1]['owner_state'] != 'stopped')
        stages[-1]['writer_lock_held'] = held
        stages[-1]['writer_evidence'] = evidence
        if status == 'running' and (held is False or stages[-1]['owner_state'] == 'stopped'):
            stages[-1]['recorded_status'] = status
            stages[-1]['status'] = 'interrupted'
        try:
            stages[-1]["heartbeat_age_seconds"] = round(max(0, time.time() - float(
                record.get("heartbeat_at") or 0)), 1)
        except (TypeError, ValueError):
            stages[-1]["heartbeat_age_seconds"] = None
    return {"stages": stages,
            "note": "Remote process state is unknown unless checked in the same host/PID namespace."}


def _record_limit(folder: Path, config: dict, limit: int, *, reason: str) -> dict:
    """Caller holds config.lock. Keep every prior value and who changed it."""
    previous = [value for value in config.get("previous_limits", []) if isinstance(value, int)]
    if isinstance(config.get("limit"), int) and config["limit"] not in previous:
        previous.append(config["limit"])
    updated = {"limit": limit, "previous_limits": [value for value in previous if value != limit],
               "generation": int(config.get("generation", 0)) + 1, "changed_at": time.time(),
               "changed_by": owner_identity(), "reason": reason}
    _write(folder / "config.json", updated)
    payload = (json.dumps({"from": config.get("limit"), **updated}, sort_keys=True) + "\n").encode()
    descriptor = os.open(folder / "config_history.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(descriptor, payload)
    finally:
        os.close(descriptor)
    return updated


def reconfigure_limit(resource: str, limit: int, *, budget_dir: str | Path | None = None,
                      timeout: float = 60.0) -> dict:
    """Operator command: record a new shared limit for one resource."""
    resource = _name(resource)
    if type(limit) is not int or not 1 <= limit <= 256:
        raise ValueError("resource limit must be 1..256")
    folder = Path(budget_dir or os.getenv("VE_RECAP_BUDGET_DIR") or
                  Path(tempfile.gettempdir()) / f"ve-recap-budget-{account_tag()}") / resource
    folder.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with (folder / "config.lock").open("a+") as config_lock:
        while True:
            try:
                file_lock.flock(config_lock.fileno(), file_lock.LOCK_EX | file_lock.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() - started > timeout:
                    raise RuntimeBusy(f"resource {resource} configuration busy; retry later")
                time.sleep(0.1)
        config = _read(folder / "config.json")
        if config.get("limit") == limit:
            return config
        return _record_limit(folder, config, limit, reason="operator_reconfiguration")


@contextlib.contextmanager
def resource_slot(resource: str, *, limit: int | None = None,
                  budget_dir: str | Path | None = None, timeout: float = 60.0,
                  poll_seconds: float = 0.1):
    """Bounded cross-process slot; kernel automatically releases it on process exit."""
    resource = _name(resource)
    configured = os.getenv(f"VE_RECAP_LIMIT_{resource.upper()}") if resource in ENV_LIMITS else None
    limit = int(configured) if configured else int(limit or DEFAULT_LIMITS.get(resource, 1))
    if not 1 <= limit <= 256 or timeout < 0:
        raise ValueError("resource limit must be 1..256 and timeout nonnegative")
    folder = Path(budget_dir or os.getenv("VE_RECAP_BUDGET_DIR") or
                  Path(tempfile.gettempdir()) / f"ve-recap-budget-{account_tag()}") / resource
    folder.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    # Processes disagreeing about a resource's capacity must not silently exceed
    # the smaller budget. Configuration persists until an operator changes it.
    with (folder / "config.lock").open("a+") as config_lock:
        while True:
            try:
                file_lock.flock(config_lock.fileno(), file_lock.LOCK_EX | file_lock.LOCK_NB)
                break
            except BlockingIOError:
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    raise RuntimeBusy(f"resource {resource} configuration busy; retry later")
                time.sleep(min(max(0.01, poll_seconds), remaining))
        config_path = folder / "config.json"
        config = _read(config_path)
        if config and config.get("limit") != limit:
            if limit in config.get("previous_limits", []):
                # A process started before a recorded reconfiguration follows
                # the shared record; it never exceeds the recorded budget.
                limit = int(config["limit"])
            else:
                raise ValueError(f"inconsistent shared limit for resource {resource}; "
                                 "record a change with reconfigure_limit()")
        if not config:
            _write(config_path, {"limit": limit})
    handle, index = None, None
    while handle is None:
        for candidate in range(limit):
            opened = (folder / f"{candidate}.lock").open("a+")
            try:
                file_lock.flock(opened.fileno(), file_lock.LOCK_EX | file_lock.LOCK_NB)
                handle, index = opened, candidate
                break
            except BlockingIOError:
                opened.close()
        if handle is None:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise RuntimeBusy(f"resource {resource} busy; bounded wait expired, retry later")
            time.sleep(min(max(0.01, poll_seconds), remaining))
    record = {"resource": resource, "owner": owner_identity(), "status": "running",
              "started_at": time.time(), "wait_seconds": round(time.monotonic() - started, 3),
              "usage": None}
    path = folder / f"{index}.json"
    try:
        _write(path, record)
        yield record  # Callers may fill usage with service-reported values only.
        if record["status"] == "running":
            record["status"] = "completed"
    except BaseException as exc:
        record.update(status="failed", failure_code=type(exc).__name__)
        raise
    finally:
        try:
            record["completed_at"] = time.time()
            _write(path, record)
            # Failures with no reported usage stay null.
            _append_attempt(folder, record)
        finally:
            file_lock.flock(handle.fileno(), file_lock.LOCK_UN)
            handle.close()
