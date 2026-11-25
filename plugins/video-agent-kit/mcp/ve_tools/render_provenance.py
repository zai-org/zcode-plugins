"""Verify the current bytes of a timeline render and all subtitle derivatives."""
import json
from pathlib import Path
from .creation_planning import file_digest


def report_candidates(path):
    path = Path(path)
    reports = [path.with_suffix('.render_report.json'), path.with_suffix('.subtitle_render_report.json')]
    if path.stem.endswith('_softsubs'):
        reports.append(path.with_name(path.stem[:-9] + '.subtitle_render_report.json'))
    return reports


def matching_report(path, ctx):
    path = ctx.resolve(path)
    sha = file_digest(path)
    matched = []
    for candidate in report_candidates(path):
        if not candidate.is_file():
            continue
        try:
            report = json.loads(candidate.read_text())
            expected = report.get('output_sha256')
            if isinstance(expected, dict):
                mode = next((m for m, raw in report.get('outputs', {}).items() if ctx.resolve(raw) == path), None)
                expected = expected.get(mode)
            if expected == sha:
                matched.append((candidate, report))
        except (ValueError, OSError, TypeError):
            continue
    if len(matched) != 1:
        raise ValueError('render provenance missing, stale or ambiguous; rerun video_render')
    return matched[0]


def verify_render(path, ctx, timeline_path=None, seen=None):
    path = ctx.resolve(path)
    seen = set() if seen is None else seen
    if path in seen:
        raise ValueError("cycle in render provenance")
    seen.add(path)
    report_path, report = matching_report(path, ctx)
    files = {str(report_path): file_digest(report_path), str(path): file_digest(path)}
    expected = report.get("output_sha256")
    if isinstance(expected, dict):
        mode = next((m for m, p in report.get("outputs", {}).items() if ctx.resolve(p) == path), None)
        expected = expected.get(mode)
    if expected != files[str(path)]:
        raise ValueError("render output bytes differ from provenance report")
    bindings = report.get("input_sha256")
    if not isinstance(bindings, dict) or not bindings:
        raise ValueError("render report has no input byte bindings")
    for raw, sha in bindings.items():
        source = ctx.resolve(raw)
        if not source.is_file() or file_digest(source) != sha:
            raise ValueError(f"render input changed: {source}")
        files[str(source)] = sha
    if report.get("parent_provenance_sha256") is not None:
        parent_files = verify_render(report["source_video"], ctx, timeline_path, seen)
        expected_parent = report.get("parent_provenance_sha256")
        if expected_parent != parent_files:
            raise ValueError("subtitle parent provenance changed; render subtitles again")
        files.update(parent_files)
    elif timeline_path is not None:
        target = ctx.resolve(timeline_path)
        if bindings.get(str(target)) != file_digest(target):
            raise ValueError("render does not bind the current timeline")
    return files
