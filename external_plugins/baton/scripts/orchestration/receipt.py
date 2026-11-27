"""Deterministic verification and sealed receipts for session assignments."""

from __future__ import annotations

import hashlib
import json
import os
import signal
import subprocess
from pathlib import Path
from typing import Any

from orchestration.git_run import run_git
from orchestration.model import TaskPacket
from orchestration.plan_model import utc_now
from orchestration.result import ResultEnvelope
from orchestration.session_model import finalize_task_packet


class ReceiptError(RuntimeError):
    """The assignment cannot produce a trusted receipt; ``code`` is the CLI
    error code."""

    code = "receipt"


RECEIPT_HASH_FIELD = "receiptHash"
RECEIPT_SEGMENTS_FIELD = "receiptSegments"

#: One verification command may run this long before its whole process group
#: is killed.
VERIFICATION_TIMEOUT_SECONDS = 1800

#: How much of a command's combined output is kept, per result.
OUTPUT_TAIL_CHARS = 2000


def canonical_receipt_json(body: dict[str, Any]) -> str:
    """Serialize a receipt body canonically for digesting.

    The canonical form is ``json.dumps`` with sorted object keys at every
    level, no insignificant whitespace (``separators=(",", ":")``) and
    ``ensure_ascii=False`` so the digest covers the same bytes regardless of
    how a writer escapes non-ASCII text. Only the ``receiptHash`` field is
    excluded; every other field (including ``receiptSegments``) is covered.
    """
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def compute_receipt_hash(receipt: dict[str, Any]) -> str:
    """Return ``sha256`` over the canonical body, excluding ``receiptHash``."""
    body = {key: value for key, value in receipt.items() if key != RECEIPT_HASH_FIELD}
    return hashlib.sha256(canonical_receipt_json(body).encode("utf-8")).hexdigest()


def _segment_digest(value: Any) -> str:
    payload = value if isinstance(value, str) else canonical_receipt_json(value)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_receipt_segments(receipt: dict[str, Any]) -> dict[str, str]:
    """Return per-field digests used to name the segment a tamper touched.

    These digests are only a diagnostic aid: the authoritative integrity
    check is :func:`compute_receipt_hash` over the whole body (which includes
    this table). Listing every top-level field, every list element and every
    verification-result field lets a rejected receipt report e.g.
    ``verification[0].exitCode`` instead of "something changed".
    """
    segments: dict[str, str] = {}
    for key in sorted(receipt):
        if key in {RECEIPT_HASH_FIELD, RECEIPT_SEGMENTS_FIELD}:
            continue
        value = receipt[key]
        if isinstance(value, list):
            segments[f"{key}.length"] = _segment_digest(len(value))
            for index, item in enumerate(value):
                if isinstance(item, dict):
                    for subkey in sorted(item):
                        segments[f"{key}[{index}].{subkey}"] = _segment_digest(
                            item[subkey]
                        )
                else:
                    segments[f"{key}[{index}]"] = _segment_digest(item)
        else:
            segments[key] = _segment_digest(value)
    return segments


def verify_receipt_body(receipt: dict[str, Any], *, source: str = "receipt") -> None:
    """Recompute the receipt digest from disk and reject any mismatch.

    Raises:
        ReceiptError: the receipt predates sealing (no ``receiptHash``) or its
            body no longer matches the digest. The message names the changed
            segment(s) when the (sealed) segment table can still tell.
    """
    stored = receipt.get(RECEIPT_HASH_FIELD)
    if not isinstance(stored, str) or not stored:
        raise ReceiptError(
            f"{source} is not sealed: missing {RECEIPT_HASH_FIELD} "
            "(re-seal it with `receipt.py seal`)"
        )
    actual = compute_receipt_hash(receipt)
    if stored == actual:
        return
    changed: list[str] = []
    stored_segments = receipt.get(RECEIPT_SEGMENTS_FIELD)
    if isinstance(stored_segments, dict):
        current = compute_receipt_segments(receipt)
        changed = sorted(
            key
            for key in set(current) | set(stored_segments)
            if current.get(key) != stored_segments.get(key)
        )
    if changed:
        detail = "changed segment(s): " + ", ".join(changed[:8])
        if len(changed) > 8:
            detail += f" (+{len(changed) - 8} more)"
    else:
        detail = (
            "no segment digest pins the edit "
            f"(the {RECEIPT_HASH_FIELD} or {RECEIPT_SEGMENTS_FIELD} table was rewritten)"
        )
    raise ReceiptError(
        f"{source} body digest mismatch: {detail}; "
        f"stored {RECEIPT_HASH_FIELD}={stored[:12]}..., recomputed={actual[:12]}..."
    )


def verify_sealed_receipt(
    receipt: dict[str, Any],
    *,
    claim_token: str,
    task_packet_hash: str = "",
) -> ResultEnvelope:
    """Verify a receipt read from disk and return its envelope.

    Checks the body digest first (so an edited ``exitCode``/``changed_files``/
    ``commit_sha`` is rejected before anything is integrated), then the claim
    token hash and, when given, the task packet hash.
    """
    verify_receipt_body(receipt, source="sealed receipt")
    expected_token_hash = hashlib.sha256(claim_token.encode("utf-8")).hexdigest()
    if receipt.get("claimTokenHash") != expected_token_hash:
        raise ReceiptError("sealed receipt claim token mismatch")
    if task_packet_hash and receipt.get("task_packet_hash") != task_packet_hash:
        raise ReceiptError("sealed receipt task packet hash mismatch")
    try:
        return ResultEnvelope.from_dict(receipt)
    except (KeyError, TypeError, ValueError) as exc:
        raise ReceiptError(f"malformed sealed receipt: {exc}") from exc


def shell_command(command: str, *, platform: str | None = None) -> list[str]:
    """Wrap a verification command in the platform's shell.

    POSIX runs a plain ``/bin/sh -c`` that inherits this process's
    environment. A login shell (``-l``) is deliberately avoided: macOS's
    ``path_helper`` rebuilds ``PATH`` for one, which resolves ``python3`` to
    the system interpreter and drops the toolchain the caller — and the
    subagent that developed the change — actually uses.
    """
    name = os.name if platform is None else platform
    if name == "nt":
        return ["powershell", "-NoProfile", "-NonInteractive", "-Command", command]
    return ["/bin/sh", "-c", command]


def _kill_process_group(process: subprocess.Popen) -> None:
    """Kill the command's whole process group, not just the shell fronting it."""
    if os.name == "nt":
        process.kill()
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        process.kill()


def run_verification_commands(
    worktree: Path, commands: list[str], *, timeout: int | None = None
) -> list[dict[str, Any]]:
    """Run the commands in ``worktree`` and report their exit codes.

    Stops at the first non-zero exit so the caller sees what broke without
    paying for the rest of the suite. Raises ``ReceiptError`` only when a
    command cannot be run to conclusion (none declared, cannot start, timed
    out) — a failing exit code is data, not an exception.
    """
    if not commands:
        raise ReceiptError("task packet has no verification commands")
    limit = VERIFICATION_TIMEOUT_SECONDS if timeout is None else timeout
    results: list[dict[str, Any]] = []
    for command in commands:
        results.append(_run_one_command(worktree, command, limit))
        if results[-1]["exitCode"] != 0:
            break
    return results


def _run_one_command(worktree: Path, command: str, timeout: int) -> dict[str, Any]:
    try:
        process = subprocess.Popen(
            shell_command(command),
            cwd=str(worktree),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            start_new_session=True,
        )
    except OSError as exc:
        raise ReceiptError(f"cannot start verification command {command!r}: {exc}") from exc
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        _kill_process_group(process)
        process.communicate()
        raise ReceiptError(f"verification timed out after {timeout}s: {command}") from None
    finally:
        for stream in (process.stdout, process.stderr):
            if stream is not None:
                stream.close()
    output = (stdout or "") + (stderr or "")
    return {
        "command": command,
        "exitCode": process.returncode,
        "outputSha256": hashlib.sha256(output.encode("utf-8")).hexdigest(),
        "outputTail": output[-OUTPUT_TAIL_CHARS:],
    }


def failed_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [item for item in results if item.get("exitCode") != 0]


def verification_summary(results: list[dict[str, Any]]) -> str:
    """``<command> exited <code>: <output tail>`` for each failing command."""
    summary: list[str] = []
    for item in failed_results(results)[:3]:
        tail = str(item.get("outputTail", "")).strip()
        line = f"{item['command']} exited {item['exitCode']}"
        if tail:
            line += f": {tail}"
        summary.append(line)
    return "\n".join(summary)


def _atomic_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


def _load_packet(packet_path: str | Path) -> tuple[Path, dict[str, Any], TaskPacket]:
    path = Path(packet_path).resolve()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReceiptError(f"cannot read packet {path}: {exc}") from exc
    raw_task = payload.get("taskPacket")
    if not isinstance(raw_task, dict):
        raise ReceiptError("packet is missing taskPacket")
    try:
        task = TaskPacket.from_dict(raw_task)
        actual = finalize_task_packet(TaskPacket.from_dict(raw_task)).task_packet_hash
    except (TypeError, ValueError) as exc:
        raise ReceiptError(f"malformed taskPacket in {path}: {exc}") from exc
    expected = task.task_packet_hash
    if not expected or expected != actual:
        raise ReceiptError("task packet hash mismatch")
    if not payload.get("assignmentId") or not payload.get("claimToken"):
        raise ReceiptError("packet is missing assignment identity or claim token")
    if not payload.get("worktreePath"):
        raise ReceiptError("packet is missing worktreePath")
    return path, payload, task


def _run_git(worktree: Path, args: list[str]) -> str:
    return run_git(args, cwd=worktree, error=ReceiptError).stdout.strip()


def _verification_path(payload: dict[str, Any], packet_path: Path) -> Path:
    raw = payload.get("verificationPath")
    return Path(raw).resolve() if raw else packet_path.with_name("verification.json")


def _receipt_path(payload: dict[str, Any], packet_path: Path) -> Path:
    raw = payload.get("receiptPath")
    return Path(raw).resolve() if raw else packet_path.with_name("receipt.json")


def _record_verification(
    payload: dict[str, Any], packet_path: Path, worktree: Path, task: TaskPacket
) -> list[dict[str, Any]]:
    """Run the packet's verification and always leave ``verification.json``
    behind — green or red — so a failure keeps its exit codes and output."""
    report_path = _verification_path(payload, packet_path)
    try:
        results = run_verification_commands(worktree, task.verification_commands)
        error = None if not failed_results(results) else (
            f"verification failed: {verification_summary(results)}"
        )
    except ReceiptError as exc:
        results, error = [], str(exc)
    _atomic_json(
        report_path,
        {
            "assignmentId": payload["assignmentId"],
            "taskPacketHash": task.task_packet_hash,
            "worktreePath": str(worktree),
            "ok": error is None,
            "verification": results,
            "error": error,
            "updated_at": utc_now(),
        },
    )
    if error is not None:
        raise ReceiptError(error)
    return results


def last_verification_failure(packet_path: str | Path) -> str:
    """The newest recorded verification failure for a packet, or ``''``.

    Read lightly on purpose: this is diagnostic context for a recover action,
    so a missing or damaged packet or report yields no text instead of an
    error of its own.
    """
    packet_path = Path(packet_path)
    try:
        payload = json.loads(packet_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    raw = payload.get("verificationPath") if isinstance(payload, dict) else None
    report_path = Path(raw) if raw else packet_path.with_name("verification.json")
    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    if not isinstance(report, dict) or report.get("ok", False):
        return ""
    return str(
        report.get("error") or verification_summary(report.get("verification", []))
    )


def verify_packet(packet_path: str | Path) -> dict[str, Any]:
    """Run the packet's declared checks as a pre-commit feedback loop."""
    path, payload, task = _load_packet(packet_path)
    worktree = Path(payload["worktreePath"]).resolve()
    results = _record_verification(payload, path, worktree, task)
    return {
        "assignmentId": payload["assignmentId"],
        "taskPacketHash": task.task_packet_hash,
        "worktreePath": str(worktree),
        "ok": True,
        "verification": results,
        "error": None,
    }


def seal_receipt(packet_path: str | Path) -> ResultEnvelope:
    """Re-run checks on committed code and atomically seal a ResultEnvelope."""
    path, payload, task = _load_packet(packet_path)
    worktree = Path(payload["worktreePath"]).resolve()
    expected_branch = str(payload["worktreeBranch"])
    branch = _run_git(worktree, ["branch", "--show-current"])
    if branch != expected_branch:
        raise ReceiptError(f"wrong branch: expected {expected_branch}, got {branch}")
    status = _run_git(worktree, ["status", "--porcelain"])
    if status:
        raise ReceiptError("worktree is dirty; commit all changes before sealing")
    head = _run_git(worktree, ["rev-parse", "HEAD"])
    base = str(payload.get("baseSha") or task.base_commit)
    if not base:
        raise ReceiptError("packet has no base SHA")
    if head == base:
        raise ReceiptError(
            "HEAD did not advance from the assignment baseline — commit the "
            "ticket's work. If the ticket legitimately changes no files (a "
            "verification/decision-only task), record that explicitly with "
            "`git commit --allow-empty -m \'<what you verified>\'`"
        )
    _run_git(worktree, ["merge-base", "--is-ancestor", base, head])
    verification = _record_verification(payload, path, worktree, task)
    changed = [
        line.strip()
        for line in _run_git(worktree, ["diff", "--name-only", f"{base}..{head}"]).splitlines()
        if line.strip()
    ]
    envelope = ResultEnvelope(
        task_id=task.task_id,
        status="succeeded",
        ticket_num=int(payload["ticketNum"]),
        assignment_id=str(payload["assignmentId"]),
        plan_revision=task.plan_revision,
        task_packet_hash=task.task_packet_hash,
        attempt=int(payload.get("attempt", 0)),
        commit_sha=head,
        receipt_path=str(_receipt_path(payload, path)),
        changed_files=changed,
        verification=verification,
    )
    receipt = envelope.to_dict()
    receipt["claimTokenHash"] = hashlib.sha256(
        str(payload["claimToken"]).encode("utf-8")
    ).hexdigest()
    receipt[RECEIPT_SEGMENTS_FIELD] = compute_receipt_segments(receipt)
    receipt[RECEIPT_HASH_FIELD] = compute_receipt_hash(receipt)
    _atomic_json(_receipt_path(payload, path), receipt)
    return envelope


__all__ = [
    "OUTPUT_TAIL_CHARS",
    "RECEIPT_HASH_FIELD",
    "RECEIPT_SEGMENTS_FIELD",
    "ReceiptError",
    "VERIFICATION_TIMEOUT_SECONDS",
    "canonical_receipt_json",
    "compute_receipt_hash",
    "compute_receipt_segments",
    "failed_results",
    "last_verification_failure",
    "run_verification_commands",
    "seal_receipt",
    "shell_command",
    "verification_summary",
    "verify_packet",
    "verify_receipt_body",
    "verify_sealed_receipt",
]
