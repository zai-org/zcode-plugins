"""Sentence/picture interval accounting and evidence-aware picture requirements."""
from __future__ import annotations

import math


from .movie_picture import FIELDS, annotations, cue_issues

POLICY_FIELDS = ('visual_requirement', 'required_shot_ids', 'candidate_shot_ids', 'role') + FIELDS


def policy(unit: dict) -> dict:
    mode = unit.get('visual_requirement')
    if mode not in (None, 'required', 'background'):
        raise ValueError('visual_requirement must be required or background')
    extra = annotations(unit)
    required = unit.get('required_shot_ids') or []
    candidates = unit.get('candidate_shot_ids') or []
    for values in (required, candidates):
        if not isinstance(values, list) or not all(isinstance(s, str) and s for s in values):
            raise ValueError('picture requirements must contain shot ID arrays')
    required = list(dict.fromkeys(required + [c['shot_id'] for c in extra.get('picture_cues', [])]))
    if mode == 'background' and required:
        raise ValueError('background sentences cannot require specific action shots')
    candidates = candidates or unit.get('cited_shot_ids') or unit.get('anchor_shot_ids') or unit.get('mains') or []
    if not isinstance(candidates, list) or not all(isinstance(s, str) and s for s in candidates):
        raise ValueError('candidate evidence must contain shot IDs')
    if mode is None:
        mode = 'required' if required or candidates else 'background'
    return {'visual_requirement': mode, 'required_shot_ids': list(dict.fromkeys(required)),
            'candidate_shot_ids': list(dict.fromkeys(candidates)), **extra}


def map_intervals(windows: list[dict], sentences: list[dict], fps: float) -> list[dict]:
    """Account every true speech/window overlap; padding never becomes speech."""
    if not math.isfinite(fps) or fps <= 0:
        raise ValueError('invalid frame rate')
    records = []
    ids = set()
    for s in sentences:
        uid = s['unit_id']
        left, right = float(s['start']), float(s['end'])
        if uid in ids or not all(math.isfinite(x) for x in (left, right)) or not 0 <= left < right:
            raise ValueError('invalid or duplicate sentence interval: ' + str(uid))
        ids.add(uid)
        records.append({'semantic_unit_id': uid, 'text': s.get('text', ''),
                        'tts_start': left, 'tts_end': right,
                        'event_ids': s.get('event_ids', []), 'claim_ids': s.get('claim_ids', []),
                        'anchor_shot_ids': s.get('mains', []), **policy(s),
                        'selected_shot_ids': [], 'overlaps': [], 'covered_seconds': 0.0})
    cursor = 0.0
    for wi, w in enumerate(windows):
        duration = (int(w['end_frame']) - int(w['start_frame'])) / fps
        if duration <= 0:
            raise ValueError('empty picture interval')
        left, right = cursor, cursor + duration
        w.update(output_start=round(left, 9), output_end=round(right, 9), sentence_overlaps=[])
        source_start = float(w.get('source_start', w['start_frame'] / fps))
        source_end = float(w.get('source_end', w['end_frame'] / fps))
        if not all(math.isfinite(t) for t in (source_start, source_end)) or source_end < source_start:
            raise ValueError('invalid source picture interval')
        for row in records:
            hold = max((c.get('allow_after_seconds', 0) for c in row.get('picture_cues', [])), default=0)
            if hold:
                ca, cb = max(left, row['tts_start']), min(right, row['tts_end'] + hold)
                if cb > ca:
                    row.setdefault('cue_windows', []).append({'shot_id': w['shot_id'], 'start': ca, 'end': cb,
                        'seconds': cb-ca, 'source_start': min(source_end, source_start+ca-left),
                        'source_end': min(source_end, source_start+cb-left)})
            a, b = max(left, row['tts_start']), min(right, row['tts_end'])
            if b - a <= 1e-9:
                continue
            overlap = {'window_index': wi, 'shot_id': w['shot_id'],
                       'start': round(a, 9), 'end': round(b, 9), 'seconds': round(b-a, 9)}
            overlap.update(source_start=round(min(source_end, source_start + a-left), 9),
                           source_end=round(min(source_end, source_start + b-left), 9))
            row['overlaps'].append(overlap)
            row['covered_seconds'] += b-a
            if w['shot_id'] not in row['selected_shot_ids']:
                row['selected_shot_ids'].append(w['shot_id'])
            w['sentence_overlaps'].append({'semantic_unit_id': row['semantic_unit_id'], **overlap})
        w['semantic_unit_ids'] = [r['semantic_unit_id'] for r in w['sentence_overlaps']]
        cursor = right
    for row in records:
        row['covered_seconds'] = round(row['covered_seconds'], 9)
    return records


def audit_requirements(records: list[dict], fps: float) -> dict:
    issues = []
    tolerance = 1 / fps + 1e-6
    for row in records:
        issues.extend(cue_issues(row, fps))
        duration = row['tts_end'] - row['tts_start']
        if duration - row['covered_seconds'] > tolerance:
            issues.append({'semantic_unit_id': row['semantic_unit_id'], 'reason': 'picture_gap',
                           'missing_seconds': round(duration-row['covered_seconds'], 6)})
        if row['visual_requirement'] == 'background':
            continue
        exposure = {}
        for overlap in row['overlaps']:
            exposure[overlap['shot_id']] = exposure.get(overlap['shot_id'], 0) + overlap['seconds']
        # A flash touching the sentence boundary does not satisfy a required picture.
        minimum = min(0.25, duration / 2)
        visible = {sid for sid, sec in exposure.items() if sec + 1e-6 >= minimum}
        required, candidates = set(row['required_shot_ids']), set(row['candidate_shot_ids'])
        missing = required - visible
        if missing or (not required and (not candidates or not candidates & visible)):
            issues.append({'semantic_unit_id': row['semantic_unit_id'], 'reason': 'required_picture_missing',
                           'required_shot_ids': sorted(required), 'candidate_shot_ids': sorted(candidates),
                           'missing_shot_ids': sorted(missing), 'actual_shot_ids': sorted(visible),
                           'tts_start': row['tts_start'], 'tts_end': row['tts_end']})
    return {'schema': 'picture-semantic-qc-v1', 'status': 'failed' if issues else 'passed',
            'checked_units': len(records), 'issues': issues}


def audit_edit(edl: list[dict], tts: list[dict], fps: float, *, require_all: bool = False) -> list[dict]:
    """Recompute from the current EDL and speech, never trust saved semantic_map."""
    import copy
    scripts = {s['seg_id']: s for s in tts}
    issues = []
    if len(scripts) != len(tts) or len({s['seg_id'] for s in edl}) != len(edl):
        issues.append({'reason': 'duplicate_segment_id'})
    if require_all:
        actual_ids = {s['seg_id'] for s in edl if not s.get('original_audio')}
        expected_ids = {s['seg_id'] for s in tts if not s.get('original_audio') and not s.get('use_original_audio')}
        if actual_ids != expected_ids:
            issues.append({'reason': 'narration_segment_coverage_incomplete',
                           'missing_seg_ids': sorted(expected_ids-actual_ids), 'unknown_seg_ids': sorted(actual_ids-expected_ids)})
    for segment in edl:
        if segment.get('original_audio'):
            continue
        windows = segment.get('windows', [])
        if not require_all and not any(w.get('engine') == 'whole_shot' for w in windows):
            continue
        sid = segment['seg_id']; script = scripts.get(sid, {})
        units = {u['semantic_unit_id']: u for u in script.get('semantic_units', [])}
        if require_all and script.get('sentences') and units:
            actual = [s.get('semantic_unit_id') for s in script['sentences']]
            if set(actual) != set(units) or len(actual) != len(set(actual)):
                issues.append({'seg_id': sid, 'reason': 'sentence_coverage_incomplete'})
        sentences = []
        for sentence in script.get('sentences', []):
            uid = sentence.get('semantic_unit_id')
            unit = {**units.get(uid, {}), **sentence}
            sentences.append({'unit_id': uid, 'text': unit.get('text', ''), 'start': unit['start'], 'end': unit['end'],
                              **policy(unit), 'mains': unit.get('anchor_shot_ids', []),
                              'claim_ids': unit.get('claim_ids', []), 'event_ids': unit.get('event_ids', [])})
        if not sentences:
            for uid, unit in units.items():
                sentences.append({'unit_id': uid, 'text': unit.get('text', ''), 'start': unit['tts_start'], 'end': unit['tts_end'],
                                  **policy(unit), 'mains': unit.get('anchor_shot_ids', []),
                                  'claim_ids': unit.get('claim_ids', []), 'event_ids': unit.get('event_ids', [])})
        if not sentences:
            issues.append({'seg_id': sid, 'reason': 'missing_sentence_timing'})
            continue
        rows = map_intervals(copy.deepcopy(windows), sentences, fps)
        issues.extend({'seg_id': sid, **issue} for issue in audit_requirements(rows, fps)['issues'])
    from .movie_picture import reveal_edit_issues
    issues.extend(reveal_edit_issues(edl, tts, fps))
    return issues


def audit_rendered(report: dict, tts: list[dict]) -> list[dict]:
    """Check mandatory pictures again after real render trimming/rounding."""
    if report.get('actual_timeline_status') != 'measured':
        return [{'reason': 'actual_render_timeline_unavailable'}]
    edl = []
    for segment in report['actual_segments']:
        windows = [w for w in report['actual_windows'] if w['segment_id'] == segment['seg_id']]
        if (not windows or windows[0]['start_frame'] != segment['start_frame']
                or windows[-1]['end_frame'] != segment['end_frame']
                or any(a['end_frame'] != b['start_frame'] for a,b in zip(windows, windows[1:]))):
            return [{'seg_id': segment['seg_id'], 'reason': 'actual_render_window_gap'}]
        edl.append({'seg_id': segment['seg_id'], 'original_audio': segment.get('original_audio', False),
                    'windows': [{'shot_id': w['shot_id'], 'engine': 'whole_shot', 'start_frame': 0,
                                 'end_frame': w['end_frame']-w['start_frame'],
                                 **{k: w[k] for k in ('source_start', 'source_end') if k in w}}
                                for w in windows]})
    return audit_edit(edl, tts, float(report['fps']), require_all=True)


def audit_script_binding(narration: list[dict], tts: list[dict]) -> list[dict]:
    """Speech records must preserve every anchored sentence and its current policy."""
    expected = {s['seg_id']: s for s in narration}
    actual = {s['seg_id']: s for s in tts}
    if not expected or set(expected) != set(actual) or len(expected) != len(narration) or len(actual) != len(tts):
        return [{'reason': 'tts_script_segment_mismatch'}]
    issues = []
    for sid, source in expected.items():
        target = actual[sid]
        if source.get('text', '') != target.get('text', ''):
            issues.append({'seg_id': sid, 'reason': 'tts_source_text_changed'})
        def content(segment):
            return [(u['semantic_unit_id'], u.get('text', ''), policy(u)) for u in segment.get('semantic_units', [])]
        if content(source) != content(target):
            issues.append({'seg_id': sid, 'reason': 'tts_source_units_changed'})
    return issues
