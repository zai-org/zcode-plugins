"""Selection helpers for verified internal spans, preserving parent evidence IDs."""
from __future__ import annotations

from pathlib import Path

from .movie_intervals import shot_spans


def load_context(out: Path, timeline: dict) -> tuple[dict | None, dict | None]:
    """Only an independently validated sidecar enables internal-span selection."""
    from . import movie_edit_spans, movie_refinement
    from .movie_sampling import exact_fps

    if not (out / movie_edit_spans.FILE).exists():
        return None, None
    clock = movie_refinement.frame_clock(Path(timeline['video']), exact_fps(timeline),
                                         out / movie_refinement.CLOCK)
    return movie_edit_spans.load(out, timeline, clock), clock


def edit_ranges(shot: dict) -> list[dict]:
    """Intersect usable intervals without merging two independently proved spans.

    Pool metadata is populated by source_usage.verified_pool at the selection
    entry point. The source ledger separately checks every selected identity.
    """
    usable = shot_spans(shot)
    if 'edit_spans' not in shot:
        return [{'start': a, 'end': b, 'span_start': shot['start'], 'span_end': shot['end']}
                for a, b in usable]
    result = []
    for span in shot['edit_spans']:
        for a, b in usable:
            a, b = max(a, span['start']), min(b, span['end'])
            if a < b:
                result.append({**span, 'start': a, 'end': b,
                               'edit_span_id': span['span_id'],
                               'source_edit_proof_id': shot['source_edit_proof_id']})
    return sorted(result, key=lambda row: (row['start'], row['end']))


def span_metadata(span: dict) -> dict:
    return {key: span[key] for key in ('edit_span_id', 'source_edit_proof_id') if key in span}


def referenced_spans(segment: dict, proof: dict | None) -> set[str]:
    """Reserve future picture cues at their actual spans, not their coarse parent.

    Without a bound cue the whole parent's spans remain reserved, preserving
    the conservative treatment of an ambiguous parent-level reference.
    """
    if proof is None:
        return set()
    from .picture_semantics import policy

    result = set()
    for unit in segment.get('semantic_units', []):
        rule = policy(unit)
        for sid in rule['required_shot_ids'] + rule['candidate_shot_ids']:
            parent = proof['shots'].get(sid)
            if parent is None:
                continue
            cues = [cue['sample_span'] for cue in rule.get('picture_cues', [])
                    if cue['shot_id'] == sid and 'sample_span' in cue]
            result.update(span['span_id'] for span in parent['spans']
                          if not cues or any(a < span['end'] and b >= span['start'] for a, b in cues))
    return result


def structural_issues(sentences: list[dict], pool: list[dict], fps: float, *,
                      source_edit_proof: dict | None = None,
                      source_clock: dict | None = None) -> list[dict]:
    """Prove unavailable cue intervals without relying on estimated speech speed."""
    by_id = {row['shot_id']: row for row in pool}
    issues = []
    tolerance = 1 / fps + 1e-6
    for sentence in sentences:
        for cue in sentence.get('picture_cues', []):
            identity = {'semantic_unit_id': sentence['unit_id'], 'shot_id': cue['shot_id']}
            if 'sample_span' not in cue:
                issues.append({**identity, 'reason': 'picture_cue_not_bound'})
                continue
            shot = by_id.get(cue['shot_id'])
            ranges = edit_ranges(shot) if shot else []
            if source_edit_proof is not None:
                from .source_usage import normalize_window
                normalized = [normalize_window({'shot_id': cue['shot_id'], 'start': row['start'],
                                                'end': row['end'], **span_metadata(row)}, fps,
                                                source_edit_proof=source_edit_proof, source_clock=source_clock)
                              for row in ranges]
                ranges = [{'start': row['source_start'], 'end': row['source_end']} for row in normalized]
            a, b = cue['sample_span']
            # Cue validation requires all bound samples in one continuous
            # source window. No change in speaking rate can restore a removed
            # source interval or join across a verified natural cut.
            if not any(row['start'] <= a + tolerance and row['end'] + tolerance >= b
                       and row['end'] - row['start'] + tolerance >= cue['min_seconds']
                       for row in ranges):
                issues.append({**identity, 'reason': 'required_picture_interval_unavailable',
                               'sample_span': [a, b], 'minimum_seconds': cue['min_seconds']})
    return issues


def structural_sequence_issues(segments: list[dict], reels: dict, fps: float) -> list[dict]:
    """Bound cue order across normal segments is independent of speech duration."""
    previous = None
    issues = []
    for segment in sorted(segments, key=lambda row: reels.get(row['seg_id'], {}).get('idx', 0)):
        if reels.get(segment['seg_id'], {}).get('cold_open'):
            continue
        samples = [cue['sample_span'] for unit in segment.get('semantic_units', [])
                   for cue in unit.get('picture_cues', []) if 'sample_span' in cue]
        if not samples:
            continue
        first, last = min(a for a, _ in samples), max(b for _, b in samples)
        if previous is not None and first + 2 / fps + 1e-6 < previous[1]:
            issues.append({'seg_id': segment['seg_id'], 'reason': 'required_picture_order_conflict',
                           'previous_seg_id': previous[0], 'previous_required_source_end': previous[1],
                           'required_source_start': first})
        if previous is None or last > previous[1]:
            previous = (segment['seg_id'], last)
    return issues
