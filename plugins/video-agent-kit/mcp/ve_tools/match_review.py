"""Bounded local match-review records; no model transport or media extraction.

One sampled review and, for concrete delivery errors only, one targeted recheck.
Each reviewed subject (sport + match) owns one ledger, so several matches can be
rendered and reviewed in one project; a subject's ledger survives re-rendering
and output-name changes.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from .creation_planning import file_digest
from .file_contract import output_locks, protect_outputs, publish_files
from .result import ToolResult

VERSION = "match-review-v1"
MAX_WINDOWS = 6
WINDOW_SECONDS = 24
POLICY = {"version": VERSION, "sample_rounds": 1, "targeted_recheck_rounds": 1,
          "max_windows": MAX_WINDOWS, "frames_per_window": 6,
          "scope": "Sampled visual review; playback and listening must be reported separately."}


def _read(path, label="file"):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(f"{label} not found: {path}") from None
    except (OSError, UnicodeDecodeError) as error:
        raise ValueError(f"{label} unreadable: {path} ({type(error).__name__})") from None
    except ValueError:
        raise ValueError(f"{label} is not valid JSON: {path}") from None


def _required(args, name, action):
    value = args.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"action={action} requires {name}")
    return value


def _digest_file(path, label):
    try:
        return file_digest(path)
    except FileNotFoundError:
        raise ValueError(f"{label} not found: {path}") from None
    except OSError as error:
        raise ValueError(f"{label} unreadable: {path} ({type(error).__name__})") from None


def _encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def _digest(value):
    return hashlib.sha256(_encoded(value)).hexdigest()


def _bundle(raw, ctx):
    path = ctx.resolve(raw)
    report = _read(path, "render report")
    if not isinstance(report, dict) or report.get("kind") != "match" or report.get("sport") not in {"soccer", "basketball", "lol"}:
        raise ValueError("review requires a match render report")
    missing = [k for k in ("output_path", "reel_path", "outline_path", "narration_path", "duration")
               if report.get(k) in (None, "")]
    if missing:
        raise ValueError("render report is missing " + ", ".join(missing) + "; render with the current match renderer")
    output = ctx.resolve(report["output_path"])
    qc, placement = output.with_suffix(".qc.json"), output.with_suffix(".placement.json")
    paths = [path, output, qc, placement]
    hashes = {str(p): _digest_file(p, "rendered artifact") for p in paths}
    if hashes[str(output)] != report.get("output_sha256"):
        raise ValueError("review output changed since rendering")
    for key, p in (("qc", qc), ("placement", placement)):
        if hashes[str(p)] != report.get(key + "_sha256"):
            raise ValueError("review needs current bound QC/placement; use the current match renderer")
    if _read(qc, "QC report").get("pass") is not True:
        raise ValueError("resolve technical QC errors before content review")
    reel_path = ctx.resolve(report["reel_path"])
    # Check editable review inputs; do not hash the full broadcast again.
    for key in ("reel_path", "outline_path", "narration_path"):
        p = ctx.resolve(report[key])
        if _digest_file(p, key.removesuffix("_path")) != (report.get("input_sha256") or {}).get(str(p)):
            raise ValueError("review inputs changed; render the updated cut first")
    reel = _read(reel_path, "reel")
    if not isinstance(reel, dict) or not reel.get("match_path"):
        raise ValueError("reel is missing match_path")
    duration = report["duration"]
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise ValueError("invalid rendered duration")
    return {"report_path": str(path), "output_path": str(output), "duration": duration,
            "subject": {"sport": report["sport"], "match_path": str(ctx.resolve(reel["match_path"]))},
            "bindings": hashes, "identity": _digest(hashes), "reel": reel,
            "placement": _read(placement, "placement"), "qc": _read(qc, "QC report")}


def _subject(raw, ctx):
    report = _read(ctx.resolve(raw), "render report")
    if not isinstance(report, dict) or report.get("kind") != "match" or not report.get("reel_path"):
        raise ValueError("review requires a match render report")
    reel = _read(ctx.resolve(report["reel_path"]), "reel")
    if not isinstance(reel, dict) or not reel.get("match_path"):
        raise ValueError("reel is missing match_path")
    return {"sport": report.get("sport"), "match_path": str(ctx.resolve(reel["match_path"]))}


def _window(anchor, bundle):
    duration = bundle["duration"]
    kind = anchor["kind"]
    if kind == "opening":
        start, end = 0, min(duration, 12)
    elif kind == "ending":
        start, end = max(0, duration - 16), duration
    elif kind == "middle":
        start, end = max(0, duration / 2 - 8), min(duration, duration / 2 + 8)
    elif kind == "gap":
        gap = bundle["qc"].get("narration_gaps", {})
        start = max(0, float(gap.get("at", 0)) - 2)
        end = min(duration, start + WINDOW_SECONDS)
    else:
        row = next((p for p in bundle["placement"] if p.get("sentence_id") == anchor["sentence_id"]), None)
        if row is None:
            raise ValueError("targeted review anchor removed; record the limit for human acceptance")
        start = max(0, row["start"] - 4)
        end = min(duration, row["start"] + max(8, row.get("dur", 0)) + 4)
        seg = next((s for s in bundle["reel"]["segs"] if s["beat"] == row["beat"]
                    and s["reel_in"] <= row["start"] <= s["reel_in"] + s["out"] - s["in"]), None)
        if seg:
            start = max(0, min(start, seg["reel_in"] - 1))
            end = min(duration, max(end, seg["reel_in"] + seg["out"] - seg["in"] + 1))
    limited = end - start > WINDOW_SECONDS
    if limited:
        # Keep the call in view; disclose actions that cannot fit this bounded sample.
        center = row["start"] if kind == "sentence" else (start + end) / 2
        start = max(start, center - WINDOW_SECONDS / 2)
        end = min(end, start + WINDOW_SECONDS)
    return {"anchor": anchor, "start_s": round(start, 3), "end_s": round(end, 3),
            "limited_action_scope": limited}


def _samples(bundle):
    anchors = [{"kind": kind} for kind in ("opening", "ending", "middle")]
    if bundle["qc"].get("narration_gaps", {}).get("needs_review"):
        anchors.append({"kind": "gap"})
    hard = [p for p in bundle["placement"] if p.get("hard") and p.get("sentence_id")]
    slots = MAX_WINDOWS - len(anchors)
    if hard:
        indices = sorted({round(i * (len(hard) - 1) / max(1, slots - 1)) for i in range(slots)})
        anchors.extend({"kind": "sentence", "sentence_id": hard[i]["sentence_id"],
                        "beat": hard[i]["beat"], "claim": hard[i]["text"]} for i in indices)
    windows = []
    for anchor in anchors:
        window = _window(anchor, bundle)
        if any((window["start_s"], window["end_s"]) == (w["start_s"], w["end_s"]) for w in windows):
            continue
        windows.append({"sample_id": f"S{len(windows) + 1}", **window})
    return windows


def _subject_key(subject):
    return _digest(subject)[:16]


def _paths(ctx, key):
    """Ledger, current request and public report of one reviewed subject."""
    folder = ctx.work_dir / "match_reviews"
    return (folder / f"{key}.ledger.json", folder / f"{key}.request.json",
            ctx.output_dir / f"spot_review.match-{key}.json")


def _legacy_state(ctx, subject):
    """Adopt the earlier single project ledger only for its own subject."""
    legacy = ctx.work_dir / "match_review.json"
    if not legacy.is_file():
        return None
    state = _read(legacy, "match review ledger")
    return state if isinstance(state, dict) and state.get("subject") == subject else None


def _ledger_for_request(ctx, request_id):
    folder = ctx.work_dir / "match_reviews"
    found = []
    for ledger in sorted(folder.glob("*.ledger.json")) if folder.is_dir() else []:
        state = _read(ledger, "match review ledger")
        ids = [r.get("request", {}).get("request_id") for r in state.get("rounds", [])]
        if request_id in ids:
            found.append((ledger.name.removesuffix(".ledger.json"), state, ids[-1] == request_id))
    if not found:
        raise ValueError("review result request_id matches no prepared match review; run action=review_prepare first")
    key, state, current = found[0]
    if not current:
        raise ValueError("review result belongs to a different request")
    return key, state


def _save(state, ctx):
    ledger, request, report = _paths(ctx, state["key"])
    payload = {"version": VERSION, "status": state["status"], "policy": POLICY,
               "rounds_used": len(state["rounds"]), "full_video_verified": False,
               "current_output_path": state.get("current_output_path"),
               "current_render_report_path": state.get("current_render_report_path"),
               "human_acceptance_required": state.get("human_acceptance_required", True),
               "limitations": state.get("limitations", []), "rounds": state["rounds"]}
    files = {ledger: _encoded(state), report: _encoded(payload)}
    if state["rounds"]:
        files[request] = _encoded(state["rounds"][-1]["request"])
    publish_files(files)


def _result(state, ctx):
    ledger, request, report = _paths(ctx, state["key"])
    pending = state["status"] in {"sample_review_pending", "targeted_recheck_pending"}
    return ToolResult("Match review: " + state["status"],
                      data={"status": state["status"], "rounds_used": len(state["rounds"]),
                            "review_key": state["key"], "subject": state["subject"],
                            "review_request_path": str(request) if pending else None,
                            "review_report_path": str(report), "policy": POLICY,
                            "next_action": "review_import" if pending else
                                           "repair_recorded_delivery_errors_once" if state["status"] == "repair_required" else "deliver_with_review_limits"},
                      artifacts=[str(ledger), str(report)] + ([str(request)] if pending else []))


def prepare(args, ctx):
    raw = _required(args, "render_report_path", "review_prepare")
    # Locate the subject cheaply so each subject locks only its own files;
    # the full bound bundle is validated under the lock.
    key = _subject_key(_subject(raw, ctx))
    ledger, request, report = _paths(ctx, key)
    with output_locks(ctx, [ledger, request, report]):
        bundle = _bundle(raw, ctx)
        if _subject_key(bundle["subject"]) != key:
            raise ValueError("render report changed while preparing review; retry")
        protect_outputs([ledger, request, report], bundle["bindings"])
        state = (_read(ledger, "match review ledger") if ledger.is_file() else _legacy_state(ctx, bundle["subject"])) or {
            "version": VERSION, "subject": bundle["subject"], "rounds": [], "status": "new"}
        if state.get("version") != VERSION or state.get("subject") != bundle["subject"]:
            raise ValueError("match review ledger does not belong to this match; do not reset its ledger")
        state["key"] = key
        state.update(current_output_path=bundle["output_path"], current_render_report_path=bundle["report_path"])
        previous = state["rounds"][-1] if state["rounds"] else None
        same = previous and previous["request"]["artifact_identity"] == bundle["identity"]
        if previous and same:
            return _result(state, ctx)
        if previous and (state["status"] != "repair_required" or len(state["rounds"]) >= 2):
            state.update(status="human_review_required", human_acceptance_required=True,
                         limitations=[*state.get("limitations", []), "Output changed outside the one permitted targeted repair; current cut is unverified."])
            _save(state, ctx)
            return _result(state, ctx)
        if previous:
            errors = {r["sample_id"] for r in previous["result"]["samples"] if r["status"] == "delivery_error"}
            try:
                windows = [{"sample_id": w["sample_id"], **_window(w["anchor"], bundle)}
                           for w in previous["request"]["samples"] if w["sample_id"] in errors]
            except ValueError as error:
                state.update(status="human_review_required", human_acceptance_required=True,
                             limitations=[*state.get("limitations", []), str(error)])
                _save(state, ctx)
                return _result(state, ctx)
            phase = "targeted_recheck"
        else:
            windows, phase = _samples(bundle), "sample_review"
        task = {"version": VERSION, "phase": phase, "policy": POLICY, "samples": windows,
                "artifact_identity": bundle["identity"], "bindings": bundle["bindings"],
                "render_report_path": bundle["report_path"], "output_path": bundle["output_path"],
                "instructions": "Inspect these windows in one consolidated review. Reuse existing evidence; at most six frames per window. "
                                "Keep key scores, identities and outcomes consistent with the already checked source evidence. "
                                "Report frames, playback and listening separately. Sparse frames cannot prove motion or audio. "
                                "Only concrete delivery errors allow one targeted repair; preferences and uncertainty go in the report. "
                                "Do not launch per-window reviewers, call a review API, extract progressively denser frames, or restart full review.",
                "result_fields": {"request_id": "copy request_id", "samples": [{"sample_id": "copy sample_id",
                    "status": "ok | delivery_error | uncertain | not_checked", "observations": "what was actually observed; name any concrete error",
                    "visual": "frames | playback | unverified", "audio": "listened | unverified", "evidence_paths": ["actual image/playback observation record"]}]}}
        task["request_id"] = _digest(task)
        state["rounds"].append({"request": task})
        state["status"] = phase + "_pending"
        _save(state, ctx)
        return _result(state, ctx)


def collect(args, ctx):
    result_path = ctx.resolve(_required(args, "review_path", "review_import"))
    result = _read(result_path, "review result")
    if not isinstance(result, dict) or not isinstance(result.get("request_id"), str):
        raise ValueError("review result must be an object with request_id copied from the review request")
    key, _ = _ledger_for_request(ctx, result["request_id"])
    ledger, request, report = _paths(ctx, key)
    with output_locks(ctx, [ledger, request, report]):
        state = _read(ledger, "match review ledger")
        state["key"] = key
        current = state["rounds"][-1]
        task = current["request"]
        if result.get("request_id") != task["request_id"]:
            raise ValueError("review result belongs to a different request")
        bundle = _bundle(task["render_report_path"], ctx)
        if bundle["identity"] != task["artifact_identity"]:
            raise ValueError("reviewed artifacts changed; do not import a stale review")
        if "result" in current:
            if _digest(result) != current["result_sha256"]:
                raise ValueError("submitted review is immutable")
            return _result(state, ctx)
        if state["status"] not in {"sample_review_pending", "targeted_recheck_pending"}:
            raise ValueError("automated review is closed; preserve the human-review status")
        rows = result.get("samples")
        expected = {w["sample_id"] for w in task["samples"]}
        if not isinstance(rows, list) or len(rows) != len(expected) or {r.get("sample_id") for r in rows} != expected:
            raise ValueError("report every requested sample, using not_checked for unseen windows")
        evidence = {str(result_path): file_digest(result_path)}
        limits = list(state.get("limitations", []))
        for row in rows:
            if row.get("status") not in {"ok", "delivery_error", "uncertain", "not_checked"}:
                raise ValueError("invalid sample review status")
            if row.get("visual") not in {"frames", "playback", "unverified"} or row.get("audio") not in {"listened", "unverified"}:
                raise ValueError("report visual observation and listening separately")
            if not isinstance(row.get("observations"), str) or not row["observations"].strip():
                raise ValueError("describe observations or why the sample remains unverified")
            paths = row.get("evidence_paths", [])
            if not isinstance(paths, list):
                raise ValueError("evidence_paths must be an array")
            if row["status"] in {"ok", "delivery_error"} and (row["visual"] == "unverified" or not paths):
                raise ValueError("unseen material cannot be marked checked")
            if row["audio"] == "listened" and not paths:
                raise ValueError("listening needs an actual observation record")
            for raw in paths:
                if not isinstance(raw, str) or not raw.strip():
                    raise ValueError("evidence_paths entries must be non-empty paths")
                p = ctx.resolve(raw)
                evidence[str(p)] = _digest_file(p, "evidence")
            if row["visual"] != "playback" or row["audio"] != "listened" or row["status"] in {"uncertain", "not_checked"}:
                limits.append(f"{task['phase']} {row['sample_id']}: visual={row['visual']}; audio={row['audio']}; status={row['status']}")
        protect_outputs([ledger, request, report], [*bundle["bindings"], *evidence])
        for window in task["samples"]:
            if window["limited_action_scope"]:
                limits.append(f"{window['sample_id']}: bounded sample does not cover the full action.")
        errors = any(r["status"] == "delivery_error" for r in rows)
        uncertain = any(r["status"] in {"uncertain", "not_checked"} for r in rows)
        status = "repair_required" if errors and len(state["rounds"]) == 1 else (
            "human_review_required" if errors or uncertain else "sampled_review_complete")
        if len(state["rounds"]) == 2:
            limits.append("Only the recorded delivery errors were rechecked on this render; other ranges were reviewed on the prior version.")
        current.update(result=result, result_sha256=_digest(result), evidence_sha256=evidence)
        state.update(status=status, limitations=sorted(set(limits)), human_acceptance_required=bool(limits or errors or uncertain))
        _save(state, ctx)
        return _result(state, ctx)
