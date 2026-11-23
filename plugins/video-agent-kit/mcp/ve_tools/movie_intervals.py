"""Source-time interval accounting shared by movie budgets and picture fitting."""
from __future__ import annotations

import math


def interval(value) -> tuple[float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        raise ValueError('invalid source interval')
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in value):
        raise ValueError('nonfinite source interval')
    a, b = map(float, value)
    if not 0 <= a < b:
        raise ValueError('empty or negative source interval')
    return a, b


def union(values) -> list[tuple[float, float]]:
    result = []
    for a, b in sorted(interval(value) for value in values):
        if result and a <= result[-1][1]:
            result[-1] = (result[-1][0], max(b, result[-1][1]))
        else:
            result.append((a, b))
    return result


def subtract(values, excluded) -> list[tuple[float, float]]:
    cuts = union(excluded)
    result = []
    for a, b in union(values):
        cursor = a
        for x, y in cuts:
            if y <= cursor:
                continue
            if x >= b:
                break
            if x > cursor:
                result.append((cursor, min(x, b)))
            cursor = max(cursor, y)
            if cursor >= b:
                break
        if cursor < b:
            result.append((cursor, b))
    return result


def seconds(values) -> float:
    return sum(b-a for a, b in union(values))


def shot_spans(shot: dict) -> list[tuple[float, float]]:
    source = interval([shot['start'], shot['end']])
    reviewed = interval(shot.get('reviewed_span') or source)
    spans = shot.get('effective_spans', [reviewed])
    clipped = []
    for span in spans:
        a, b = interval(span)
        a, b = max(a, source[0], reviewed[0]), min(b, source[1], reviewed[1])
        if a < b:
            clipped.append((a, b))
    return union(clipped)


def constrain_pool(pool: list[dict], excluded=()) -> list[dict]:
    """Retain source boundaries and carry usable excerpts separately."""
    result = []
    for shot in pool:
        spans = subtract(shot_spans(shot), excluded)
        if spans:
            result.append({**shot, 'effective_spans': spans})
    return result


def pool_report(pool: list[dict], excluded=()) -> dict:
    spans = []
    for shot in pool:
        spans.extend(shot_spans(shot))
    merged = union(spans)
    usable = subtract(merged, excluded)
    return {'source_intervals': [list(span) for span in usable],
            'raw_candidate_seconds': round(sum(b-a for a, b in spans), 6),
            'unique_candidate_seconds': round(seconds(merged), 6),
            'excluded_seconds': round(seconds(merged)-seconds(usable), 6),
            'available_seconds': round(seconds(usable), 6),
            'scope': 'unique_source_upper_bound; sentence constraints still require a feasible chain'}
