"""Movie expression requirements, bound to observed source frames.

The author chooses the task and required samples. This module derives their
source positions; it never invents precise action boundaries from sparse frames.
"""
from __future__ import annotations

import copy
import math

VERSION = 'movie-picture-expression-v1'
FIELDS = ('picture_intent', 'picture_cues', 'reveal_limits', 'beat_idx', 'sentence_idx')
PURPOSES = {'event', 'reaction', 'clue', 'establishing', 'transition', 'echo'}
CUE_KINDS = {'clue', 'action_result', 'reaction', 'dialogue_end'}


def _text(value, key):
    if not isinstance(value, str) or not value.strip() or len(value) > 2000:
        raise ValueError('invalid picture ' + key)
    return value.strip()


def _refs(value):
    if not isinstance(value, list) or not value or len(value) > 32:
        raise ValueError('picture evidence IDs required')
    return list(dict.fromkeys(_text(ref, 'evidence_id') for ref in value))


def annotations(unit: dict) -> dict:
    result = {k: copy.deepcopy(unit[k]) for k in FIELDS if k in unit}
    intent = result.get('picture_intent')
    if intent is not None:
        if not isinstance(intent, dict) or intent.get('purpose') not in PURPOSES:
            raise ValueError('invalid picture intent')
        _text(intent.get('task'), 'task')
        for key in ('scene_id', 'event_id', 'response_to'):
            if key in intent:
                _text(intent[key], key)
        if 'evidence_ids' in intent:
            _refs(intent['evidence_ids'])
        if intent.get('time_relation', 'unspecified') not in ('same_event', 'flashback', 'parallel', 'unspecified'):
            raise ValueError('invalid picture time relation')
        if intent['purpose'] == 'reaction' and not (intent.get('response_to') and intent.get('evidence_ids')):
            raise ValueError('reaction needs its event and source evidence')
    cues = result.get('picture_cues', [])
    if not isinstance(cues, list) or len(cues) > 20:
        raise ValueError('invalid picture cues')
    for cue in cues:
        if not isinstance(cue, dict) or cue.get('kind') not in CUE_KINDS:
            raise ValueError('invalid picture cue')
        _text(cue.get('shot_id'), 'cue_shot')
        _text(cue.get('description'), 'cue_description')
        _refs(cue.get('evidence_ids'))
        minimum = cue.get('min_seconds')
        if type(minimum) not in (int, float) or not math.isfinite(minimum) or not 0 < minimum <= 30:
            raise ValueError('invalid cue minimum exposure')
        after = cue.get('allow_after_seconds', 0)
        if type(after) not in (int, float) or not math.isfinite(after) or not 0 <= after <= 3:
            raise ValueError('invalid cue reaction hold')
        if 'sample_span' in cue:
            span = cue['sample_span']
            if (not isinstance(span, (list, tuple)) or len(span) != 2
                    or any(type(t) not in (int, float) or not math.isfinite(t) for t in span)
                    or not 0 <= span[0] <= span[1] or cue.get('observation') != 'sampled_frames'):
                raise ValueError('invalid bound cue span')
    limits = result.get('reveal_limits', [])
    if not isinstance(limits, list) or len(limits) > 200:
        raise ValueError('invalid reveal limits')
    for row in limits:
        if not isinstance(row, dict):
            raise ValueError('invalid reveal limit')
        _text(row.get('shot_id'), 'reveal_shot')
        _text(row.get('reason'), 'reveal_reason')
        for key, default in (('not_before_beat', None), ('not_before_sentence', 1)):
            if type(row.get(key, default)) is not int or row.get(key, default) <= 0:
                raise ValueError('invalid reveal location')
    if limits:
        for key in ('beat_idx', 'sentence_idx'):
            if type(result.get(key)) is not int or result[key] <= 0:
                raise ValueError('missing current story location')
    return result


def forbidden(unit: dict) -> set[str]:
    here = (unit.get('beat_idx', 0), unit.get('sentence_idx', 0))
    return {r['shot_id'] for r in unit.get('reveal_limits', [])
            if here < (r['not_before_beat'], r.get('not_before_sentence', 1))}


def bind(sentence: dict, packet: dict, beat_idx: int, sentence_idx: int, *, clock=None) -> dict:
    """Fill paragraph defaults and bind cue positions to actual evidence IDs."""
    beat = packet['beats'][beat_idx - 1]
    plan = beat['picture_plan']
    value = {k: copy.deepcopy(sentence[k]) for k in ('picture_intent', 'picture_cues') if k in sentence}
    value.setdefault('picture_intent', {k: plan[k] for k in
        ('purpose', 'task', 'scene_id', 'event_id', 'time_relation', 'response_to', 'evidence_ids') if k in plan})
    value.update(beat_idx=beat_idx, sentence_idx=sentence_idx,
                 reveal_limits=[copy.deepcopy(r) for b in packet['beats'] for r in b['picture_plan'].get('withhold', [])])
    value = annotations(value)
    intent = value['picture_intent']
    if any(ref not in packet['sources'] for ref in intent.get('evidence_ids', [])):
        raise ValueError('picture context evidence missing')
    for cue in value.get('picture_cues', []):
        if cue.get('allow_after_seconds', 0) > plan.get('hold_after_seconds', 0):
            raise ValueError('picture hold needs a paragraph time and sound budget')
        if cue['shot_id'] not in beat['available_shots']:
            raise ValueError('picture cue outside paragraph evidence')
        times = []
        for ref in cue['evidence_ids']:
            source = packet['sources'].get(ref, {})
            if source.get('kind') != 'sparse_frame' or source.get('shot_id') != cue['shot_id']:
                raise ValueError('picture cue needs observed frames from the same shot')
            if clock and ref.startswith('F') and ref[1:].isdigit():
                from .movie_refinement import source_frame_time
                stamp = source_frame_time(clock, int(ref[1:]))
            else:
                stamp = source['time']
            times.append(stamp)
        cue['sample_span'] = [min(times), max(times)]
        cue['observation'] = 'sampled_frames'
    return annotations(value)


def expand_storyboards(units: list[dict]) -> list[dict]:
    """Compile explicit movie boards into ordinary, independently checked units.

    The manuscript and paragraph audio stay intact. Each authored text span gets
    its own candidate assessment and actual speech interval in the existing
    alignment/assembly path. A parent cue or mandatory shot cannot disappear in
    this conversion, and the original sentence index continues to govern reveals.
    """
    result = []
    for source in units:
        board = source.get('storyboard')
        if not board:
            result.append(copy.deepcopy(source))
            continue
        if (not isinstance(board, list) or any(not isinstance(row, dict) for row in board)
                or any(not isinstance(row.get('text'), str) or not row['text'].strip() for row in board)
                or ''.join(row['text'] for row in board) != source.get('text')):
            raise ValueError('movie storyboard must preserve the complete sentence text')
        shot_groups = []
        for row in board:
            shots = row.get('shots')
            if (not isinstance(shots, list) or not shots
                    or any(not isinstance(sid, str) or not sid for sid in shots)):
                raise ValueError('movie storyboard part needs observed candidate shots')
            shot_groups.append(list(dict.fromkeys(shots)))
        mandatory = set(source.get('required_shot_ids', []))
        if not mandatory <= set().union(*(set(shots) for shots in shot_groups)):
            raise ValueError('movie storyboard omits a required shot')
        cues = source.get('picture_cues', [])
        cue_parts = {}
        for i, cue in enumerate(cues):
            matches = [j for j, shots in enumerate(shot_groups) if cue['shot_id'] in shots]
            if len(matches) != 1:
                raise ValueError('movie storyboard cue needs one unambiguous part')
            if cue.get('allow_after_seconds') and matches[0] != len(board) - 1:
                raise ValueError('movie storyboard reaction hold belongs to its final part')
            cue_parts[i] = matches[0]
        for index, (row, shots) in enumerate(zip(board, shot_groups)):
            unit = copy.deepcopy(source)
            unit.pop('storyboard')
            unit.update(semantic_unit_id=f"{source['semantic_unit_id']}_b{index + 1:02d}",
                        text=row['text'], anchor_shot_ids=shots, cited_shot_ids=shots,
                        candidate_shot_ids=shots,
                        required_shot_ids=[sid for sid in shots if sid in mandatory])
            if 'spoken_text' in source and source['spoken_text'] != source['text']:
                raise ValueError('compile movie storyboard before changing spoken wording')
            if 'spoken_text' in source:
                unit['spoken_text'] = row['text']
            if 'subtitle_text' in source and source['subtitle_text'] != source['text']:
                raise ValueError('movie storyboard needs matching subtitle text')
            if 'subtitle_text' in source:
                unit['subtitle_text'] = row['text']
            if 'picture_cues' in source:
                unit['picture_cues'] = [copy.deepcopy(cue) for i, cue in enumerate(cues)
                                        if cue_parts[i] == index]
            intent = unit.get('picture_intent')
            if intent is not None:
                intent.update(sentence_text=source['text'], sentence_task=intent['task'],
                              task='呈现本句中的这一部分：' + row['text'],
                              part_index=index + 1, part_count=len(board))
            # Retain the authored hold hint for diagnostics. Actual extended
            # exposure still requires the explicit cue and paragraph sound budget.
            unit['storyboard_part'] = {'parent_unit_id': source['semantic_unit_id'],
                                       'index': index + 1, 'count': len(board),
                                       'hold': bool(row.get('hold'))}
            annotations(unit)
            result.append(unit)
    identifiers = [unit['semantic_unit_id'] for unit in result]
    if len(identifiers) != len(set(identifiers)):
        raise ValueError('movie storyboard produces duplicate unit identifiers')
    return result


def cue_issues(row: dict, fps: float) -> list[dict]:
    issues = []
    tolerance = 1 / fps + 1e-6
    banned = forbidden(row)
    for overlap in row['overlaps']:
        if overlap['shot_id'] in banned and overlap['seconds'] > tolerance:
            issues.append({'semantic_unit_id': row['semantic_unit_id'], 'reason': 'premature_reveal',
                           'shot_id': overlap['shot_id']})
    for cue in row.get('picture_cues', []):
        if 'sample_span' not in cue:
            issues.append({'semantic_unit_id': row['semantic_unit_id'], 'reason': 'picture_cue_not_bound'})
            continue
        a, b = cue['sample_span']
        # One continuous selected source window must retain all required samples.
        candidates = row['overlaps']
        if cue.get('allow_after_seconds'):
            candidates = []
            for window in row.get('cue_windows', []):
                end = min(window['end'], row['tts_end'] + cue['allow_after_seconds'])
                if end > window['start']:
                    candidates.append({**window, 'end': end, 'seconds': end-window['start'],
                                       'source_end': min(window['source_end'], window['source_start']+end-window['start'])})
        matches = [o for o in candidates if o['shot_id'] == cue['shot_id']
                   and o['source_start'] <= a + tolerance and o['source_end'] + tolerance >= b]
        if not matches or max(min(o['seconds'], o['source_end']-o['source_start']) for o in matches) + tolerance < cue['min_seconds']:
            issues.append({'semantic_unit_id': row['semantic_unit_id'], 'reason': 'key_picture_interval_missing',
                           'shot_id': cue['shot_id'], 'sample_span': cue['sample_span'],
                           'minimum_seconds': cue['min_seconds'], 'kind': cue['kind']})
    return issues


def reveal_edit_issues(edl: list[dict], tts: list[dict], fps: float) -> list[dict]:
    """Check full output windows, including pauses and original-audio inserts."""
    scripts = {s['seg_id']: s for s in tts}
    locations, limits, windows = {}, {}, []
    cursor = 0.0
    for segment in edl:
        speech = scripts.get(segment['seg_id'], {})
        units = {u['semantic_unit_id']: u for u in speech.get('semantic_units', [])}
        for sentence in speech.get('sentences', []) or list(units.values()):
            unit = {**units.get(sentence.get('semantic_unit_id'), {}), **sentence}
            for limit in unit.get('reveal_limits', []):
                target = (limit['not_before_beat'], limit.get('not_before_sentence', 1))
                limits[(limit['shot_id'], target)] = limit
            if 'beat_idx' in unit and 'sentence_idx' in unit:
                key = (unit['beat_idx'], unit['sentence_idx'])
                start = cursor + unit.get('start', unit.get('tts_start', 0))
                locations[key] = min(locations.get(key, start), start)
        for window in segment.get('windows', []):
            duration = (window['end_frame'] - window['start_frame']) / fps
            windows.append((segment['seg_id'], window['shot_id'], cursor, cursor + duration))
            cursor += duration
    issues = []
    for (shot, target), limit in limits.items():
        release = locations.get(target)
        if release is None:
            issues.append({'reason': 'reveal_target_missing', 'shot_id': shot, 'target': target})
            continue
        for segment, sid, start, end in windows:
            if sid == shot and start < release - 1 / fps - 1e-6:
                issues.append({'seg_id': segment, 'reason': 'premature_reveal', 'shot_id': shot,
                               'output_start': start, 'not_before': release})
    return issues


def cue_starts(shot: dict, sentences: list[dict], output_start: float, fps: float) -> set[float]:
    """Place observed content inside its spoken sentence when taking a long shot."""
    starts = set()
    for sentence in sentences:
        for cue in sentence.get('picture_cues', []):
            if cue['shot_id'] != shot['shot_id'] or 'sample_span' not in cue:
                continue
            a, b = cue['sample_span']
            # Prefer space before the first sample as well as after the last one.
            offset = max(0, sentence['start'] - output_start)
            starts.add(max(shot['start'], a - offset - min(.5, cue['min_seconds'] / 2)))
    return starts
