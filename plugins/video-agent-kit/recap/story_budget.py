"""Estimate narration against original audio, usable footage and one voice rate."""
from __future__ import annotations

import math


def _number(value, name):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError('invalid story budget ' + name)
    return float(value)


def _planning_shots(shots: dict, reviewed_ranges) -> dict:
    planning_shots = {sid: dict(shot) for sid, shot in shots.items()}
    for sid, span in (reviewed_ranges or {}).items():
        if sid not in planning_shots:
            continue
        start, end = _number(span['start'], 'reviewed_start'), _number(span['end'], 'reviewed_end')
        shot = planning_shots[sid]
        if not span.get('reviewed') or not shot['start'] <= start < end <= shot['end']:
            raise ValueError('invalid reviewed story budget range: ' + sid)
        shot['reviewed_span'] = [start, end]
    return planning_shots


def _footprint(planning_shots: dict, ids: set, beats: list[dict], beat: dict, originals: list[dict]) -> dict:
    """Unique usable source seconds of a beat's shots, minus withheld reveals and original audio."""
    from ve_tools.movie_intervals import pool_report
    withheld = {r['shot_id'] for b in beats for r in b.get('picture_plan', {}).get('withhold', [])
                if beat['idx'] < r['not_before_beat']}
    return pool_report([planning_shots[sid] for sid in sorted(ids - withheld) if sid in planning_shots],
                       [(o['start'], o['end']) for o in originals])


def plan_budget(profile: dict, beats: list[dict], reel: dict, shots: dict, originals: list[dict],
                *, reviewed_ranges=None) -> dict:
    number = _number
    target = profile.get('target_minutes', [8, 12])
    if not isinstance(target, list) or len(target) != 2:
        raise ValueError('story budget requires a target duration range')
    low, high = (number(value, 'target_minutes') * 60 for value in target)
    if low <= 0 or high < low:
        raise ValueError('invalid story target range')
    original_seconds = 0.0
    for original in originals:
        start, end = (number(original[k], k) for k in ('start', 'end'))
        if end <= start:
            raise ValueError('original audio must have positive duration')
        original_seconds += end-start
    pauses = number(profile.get('nonoverlap_pause_seconds', 0), 'nonoverlap_pause_seconds')
    pauses += sum(number(b.get('picture_plan', {}).get('hold_after_seconds', 0), 'picture_hold') for b in beats)
    from ve_tools.narration_budget import planning_rate
    rate, rate_source = planning_rate(profile, reel)
    available = (low + high) / 2 - original_seconds - pauses
    if available <= 0:
        raise ValueError('original audio and pauses exhaust the target duration')
    weights = [number(b['editorial']['weight'], 'editorial_weight') for b in beats]
    total_weight = sum(weights)
    if total_weight <= 0:
        raise ValueError('story budget requires positive editorial weight')
    planning_shots = _planning_shots(shots, reviewed_ranges)
    rows = []
    for beat, weight in zip(beats, weights):
        footprint = _footprint(planning_shots, set(beat['available_shots']), beats, beat, originals)
        usable = footprint['available_seconds']
        seconds = available * weight / total_weight
        rows.append({'beat_idx': beat['idx'], 'narration_seconds': round(seconds, 2),
                     'suggested_chars': round(seconds * rate), 'cited_footage_seconds': round(usable, 2),
                     'original_audio_seconds': round(sum(o['end']-o['start'] for o in beat['original_audio_after']), 2),
                     'needs_more_candidate_footage': usable + 0.1 < seconds,
                     'footage_accounting': footprint,
                     'budget_reason': beat['editorial']['budget_reason']})
    return {'schema': 'movie-story-budget-v1', 'target_seconds': [low, high],
            'original_audio_seconds': round(original_seconds, 2), 'nonoverlap_pause_seconds': pauses,
            'narration_seconds': round(available, 2), 'suggested_total_chars': round(available * rate),
            'chars_per_second': round(rate, 4), 'rate_source': rate_source, 'beats': rows,
            'timing_basis': 'observation_timeline_and_reviewed_ranges; selected source PTS are rechecked in production preflight',
            'scope': 'planning_estimate; actual paragraph audio and approved candidate footage decide the edit'}
