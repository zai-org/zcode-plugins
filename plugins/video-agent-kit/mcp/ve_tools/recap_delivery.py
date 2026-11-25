"""Movie delivery checks called explicitly by recap_contract."""
from __future__ import annotations

import json
import hashlib
from pathlib import Path


def read_status(path: Path) -> str:
    data = read_json(path)
    return str(data.get("status") or "") if data else ""



def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return value if isinstance(value, dict) else {}



def read_json_list(path: Path) -> list:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return value if isinstance(value, list) else []



def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()



def nonempty_file(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0



def qc_passed(path: Path) -> bool:
    data = read_json(path)
    status = str(data.get("status") or "").lower()
    if status in {"pass", "passed", "ok"}:
        return True
    return data.get("pass") is True



def final_qc_reports(out: Path) -> list[Path]:
    paths = [out / "final_qc_report.json", *out.glob("final*_qc_report.json")]
    unique: dict[str, Path] = {}
    for path in paths:
        if path.is_file():
            unique[str(path)] = path
    return sorted(unique.values(), key=lambda p: p.stat().st_mtime)



def semantic_review_gaps(out: Path, video_sha: str | None, render_report: Path | None = None) -> list[str]:
    """Bind content reviews to their inputs; a bare passed flag is insufficient."""
    gaps = []
    import sys
    mcp = str(Path(__file__).resolve().parents[1])
    if mcp not in sys.path:
        sys.path.insert(0, mcp)
    from ve_tools.picture_windows import enabled
    if enabled(out):
        try:
            from ve_tools.recap_checks import review_gaps
            gaps.extend(review_gaps(out, 'script_workflow'))
            gaps.extend(review_gaps(out, 'window_check'))
            from ve_tools.picture_semantics import audit_edit, audit_rendered, audit_script_binding
            edl = json.loads((out / 'edl.json').read_text())
            rows = edl.get('segments', []) if isinstance(edl, dict) else edl
            tts = json.loads((out / 'script_tts.json').read_text())
            if audit_script_binding(json.loads((out / 'narration_script.json').read_text()), tts):
                gaps.append('TTS records omit or change the anchored narration')
            issues = audit_edit(rows, tts, float(read_json(out / 'shots.json').get('fps', 24)), require_all=True)
            if issues:
                gaps.append('current EDL sentence/picture evidence failed: ' + str(len(issues)) + ' issues')
            actual = read_json(render_report or out / 'final.render_report.json')
            profile = read_json(out / 'production_profile.json')
            if profile.get('duration_policy') == 'target-window-v1':
                from ve_tools.narration_budget import duration_status
                duration = duration_status(profile, actual['total_frames'] / actual['fps'])
                if duration['status'] != 'within_target':
                    gaps.append('actual movie duration outside requested window: ' + str(duration))
            issues = audit_rendered(actual, tts)
            if issues:
                gaps.append('actual rendered sentence/picture evidence failed: ' + str(len(issues)) + ' issues')
            gaps.extend(review_gaps(out, 'final_review'))
        except (ImportError, OSError, ValueError, KeyError, TypeError, AttributeError, ZeroDivisionError):
            gaps.append('versioned recap evidence check unavailable or incomplete')
    inputs = {name: file_sha256(out / name) if nonempty_file(out / name) else None
              for name in ("writer_script.json", "edl.json", "script_tts.json")}
    requirements = {
        "script_gate.json": {"script_sha256": inputs["writer_script.json"]},
        "spot_review.json": {"script_sha256": inputs["writer_script.json"],
                             "edl_sha256": inputs["edl.json"],
                             "tts_sha256": inputs["script_tts.json"]},
        "edl_qc.json": {"edl_sha256": inputs["edl.json"]},
        "final_review.json": {"edl_sha256": inputs["edl.json"],
                              "tts_sha256": inputs["script_tts.json"],
                              "video_sha256": video_sha},
    }
    for name, hashes in requirements.items():
        review = read_json(out / name)
        if review.get("status") not in {"pass", "passed"}:
            gaps.append(f"out/{name} missing, invalid or not passed; perform the review.")
        for field, expected in hashes.items():
            if expected is None or review.get(field) != expected:
                gaps.append(f"out/{name} stale or missing {field}; review the current inputs again.")
    def valid_evidence(references) -> bool:
        if not isinstance(references, list) or not references:
            return False
        try:
            return all(isinstance(ref, str)
                       and (out.parent / ref).resolve().is_relative_to(out.resolve())
                       and nonempty_file((out.parent / ref).resolve()) for ref in references)
        except (OSError, ValueError, RuntimeError):
            return False

    final = read_json(out / "final_review.json")
    if not isinstance(final.get("evidence"), list) or not final["evidence"]:
        gaps.append("out/final_review.json has no evidence references.")
    elif not valid_evidence(final['evidence']):
        gaps.append("out/final_review.json references missing evidence or a path outside out/.")
    if type(final.get("visual_frames")) is not int or final["visual_frames"] < 1:
        gaps.append("out/final_review.json has no recorded final-video visual inspection.")
    render = read_json(render_report or out / "final.render_report.json")
    if nonempty_file(out / 'final.mp4'):
        try:
            from ve_tools.render_provenance import verify_render
            from ve_tools.run_context import RunContext
            from ve_tools.movie_refinement import timeline_name
            verify_render(out / 'final.mp4', RunContext(project_root=out.parent, create_dirs=False),
                          timeline_path=out / timeline_name(out))
        except (ImportError, OSError, ValueError, KeyError, TypeError):
            gaps.append('final render input byte bindings missing or changed; render and review current inputs.')
    for field, expected in {"output_sha256": video_sha, "edl_sha256": inputs["edl.json"],
                            "tts_sha256": inputs["script_tts.json"]}.items():
        if expected is None or render.get(field) != expected:
            gaps.append(f"final render report stale or missing {field}; render the current inputs.")
    if render.get("subtitle_burned") is not True:
        gaps.append("final render report does not confirm burned narration subtitles.")
    seam = render.get("seam_scan") if isinstance(render.get("seam_scan"), dict) else {}
    if seam.get("status") not in {"clean", "residual_frames", "not_applicable"}:
        gaps.append("final seam scan incomplete; rerun the scan before delivery.")
    elif seam.get("status") == "not_applicable" and seam.get("n_seams") != 0:
        gaps.append("final seam scan cannot be exempted when cuts exist.")
    elif seam.get("status") == "residual_frames":
        review = final.get("seam_review") if isinstance(final.get("seam_review"), dict) else {}
        if review.get("status") not in {"pass", "passed"} or not valid_evidence(review.get("evidence")):
            gaps.append("final seam warnings require a recorded content review or repair.")
    return gaps



def recap_gaps(out: Path, report: Path, *, strict_reviews: bool = False) -> list[str]:
    gaps: list[str] = []
    strict_reviews = strict_reviews or read_json(out / "production_profile.json").get("mode") == "isolated_movie_recap"
    movie_like = any(
        (out / name).exists()
        for name in ("edl.json", "edl_qc.json", "narration_script.json", "graph.json", "dialogue_axis.txt")
    )

    if movie_like:
        for name in ("media.json", "transcript.json"):
            if not nonempty_file(out / name):
                gaps.append(f"out/{name} missing or empty.")
        for name in ("shots.json", "dialogue_axis.txt", "dialogue_index.json", "outline.json", "reel.json", "writer_script.json", "narration_script.json", "script_tts.json", "edl.json"):
            if not nonempty_file(out / name):
                gaps.append(f"out/{name} missing or empty; finish the movie-recap pipeline before stopping.")
        edl_qc = out / "edl_qc.json"
        if not edl_qc.is_file():
            gaps.append("out/edl_qc.json missing; run bind_narration and keep its QC report.")
        elif read_status(edl_qc) not in {"pass", "passed"}:
            gaps.append("out/edl_qc.json status is not passed.")
        script_tts = read_json_list(out / "script_tts.json")
        failed = [
            str(item.get("seg_id") or "?")
            for item in script_tts
            if isinstance(item, dict) and (item.get("verify") or {}).get("status") == "fail"
        ]
        if failed:
            gaps.append(
                "out/script_tts.json has verify=fail segments ("
                + ", ".join(failed[:6])
                + "); rewrite those sentences and rerun TTS before rendering."
            )
        unverified = [str(item.get("seg_id") or "?") for item in script_tts
                      if isinstance(item, dict) and not item.get("use_original_audio")
                      and ((item.get("verify") or {}).get("status") not in {"pass", "warn", "fail"}
                           or (item.get("verify") or {}).get("asr_available") is False
                           or (item.get("verify") or {}).get("reason") == "asr_unavailable")]
        if unverified:
            gaps.append("out/script_tts.json has unverified speech segments ("
                        + ", ".join(unverified[:6]) + "); retry ASR on cached audio before delivery.")

    final = out / "final.mp4"
    finals = [final] if nonempty_file(final) else []
    newest_sha = None
    if not finals:
        gaps.append("out/final*.mp4 missing or empty; render the recap final video.")
    elif movie_like:
        newest = finals[-1]
        newest_sha = file_sha256(newest)
        reports = [path for path in final_qc_reports(out) if qc_passed(path)]
        if not reports:
            gaps.append(f"no passing final*_qc_report.json; run qc_preview on {newest.name}.")
        else:
            # 哈希算一次: Stop hook 有 90s 超时, 逐报告重算 GB 级成片的 sha256 会把它耗光
            # (超时的 Stop hook 不阻断, 契约门禁就静默失效)
            if not any(read_json(path).get("video_sha256") == newest_sha for path in reports):
                gaps.append(f"final QC report is stale; rerun qc_preview on {newest.name}.")

    if strict_reviews:
        gaps.extend(semantic_review_gaps(out, newest_sha,
                                       finals[-1].with_suffix(".render_report.json") if finals else None))

    if not nonempty_file(out / "spot_review.json"):
        gaps.append("out/spot_review.json missing; review sentence/picture alignment.")
    return gaps
