"""Movie editorial planning, duration and prose diagnostics for the coordinator's draft."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re

from ve_tools.visual_review import ReviewError, atomic_json, encoded

VERSION = 'movie-editorial-v1'
PURPOSES = {'event', 'reaction', 'clue', 'establishing', 'transition', 'echo'}


def configure_duration(out: Path, target_minutes: list[float]) -> dict:
    """Apply an explicit user duration without rewriting prior review history."""
    if (not isinstance(target_minutes, list) or len(target_minutes) != 2
            or any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0
                   for v in target_minutes) or target_minutes[0] > target_minutes[1]):
        raise ReviewError('movie_target_duration_invalid')
    path = out / 'production_profile.json'
    profile = json.loads(path.read_text())
    target = list(map(float, target_minutes))
    if profile.get('target_minutes') == target and profile.get('duration_policy') == 'target-window-v1':
        return {'status': 'prepared', 'changed': False, 'target_minutes': target}
    identity = hashlib.sha256(encoded(profile)).hexdigest()
    history = out / 'script_workflow/profile_history' / (identity + '.json')
    if not history.exists():
        atomic_json(history, profile)
    profile.update(target_minutes=target, duration_policy='target-window-v1')
    atomic_json(path, profile)
    return {'status': 'prepared', 'changed': True, 'target_minutes': target,
            'previous_profile': str(history.relative_to(out)),
            'next': 'Rebuild the packet and allocate the new duration across story changes, original '
                    'audio and holds before revising prose. Source observations and unchanged audio are reused.'}


def duration_estimate(packet: dict, paragraphs: list[dict]) -> dict:
    """A deterministic writing diagnostic, before any review or speech request."""
    budget = packet.get('narration_budget') or {}
    rate = budget.get('chars_per_second')
    target = budget.get('target_seconds')
    if (type(rate) not in (int, float) or not math.isfinite(rate) or rate <= 0
            or not isinstance(target, list) or len(target) != 2):
        return {'status': 'unavailable'}
    characters = sum(len(p['text']) for p in paragraphs)
    narration = characters / rate
    fixed = budget.get('original_audio_seconds', 0) + budget.get('nonoverlap_pause_seconds', 0)
    total = narration + fixed
    status = 'short' if total < target[0] else 'long' if total > target[1] else 'within_target'
    return {'status': status, 'estimated_total_seconds': round(total, 2),
            'estimated_narration_seconds': round(narration, 2), 'reserved_seconds': round(fixed, 2),
            'target_seconds': target, 'characters': characters,
            'suggested_total_characters': budget.get('suggested_total_chars'),
            'scope': 'writing estimate from measured voice rate; final duration uses actual audio',
            'next': 'Allocate missing time to supported motivations, choices, consequences and original scenes; '
                    'compress repetition when over budget. Do not pad or slow playback to meet the target.'}


def text(value, name):
    if not isinstance(value, str) or not value.strip() or len(value) > 2000:
        raise ReviewError('editorial_invalid_' + name)
    return value.strip()


def planning(beat: dict, count: int, shot_ids: set[str]) -> dict:
    value = beat.get('editorial')
    picture = beat.get('picture_plan')
    if not isinstance(value, dict) or not isinstance(picture, dict):
        raise ReviewError('editorial_plan_required')
    result = {key: text(value.get(key), key) for key in
              ('story_change', 'audience_goal', 'budget_reason')}
    for key in ('keep', 'compress'):
        rows = value.get(key)
        if not isinstance(rows, list) or len(rows) > 20 or (key == 'keep' and not rows):
            raise ReviewError('editorial_invalid_' + key)
        result[key] = [text(row, key) for row in rows]
    weight = value.get('weight')
    if type(weight) not in (int, float) or not math.isfinite(weight) or not 0 < weight <= 10:
        raise ReviewError('editorial_weight_required')
    result['weight'] = weight
    dependencies = value.get('depends_on_beats', [])
    if (not isinstance(dependencies, list) or any(type(i) is not int or not 1 <= i <= count for i in dependencies)):
        raise ReviewError('editorial_dependencies_invalid')
    result['depends_on_beats'] = sorted(set(dependencies))
    purpose = picture.get('purpose')
    if purpose not in PURPOSES:
        raise ReviewError('editorial_picture_purpose_invalid')
    context = {key: picture[key] for key in ('scene_id', 'event_id', 'time_relation', 'response_to', 'evidence_ids')
               if key in picture}
    limits = picture.get('withhold', [])
    if not isinstance(limits, list) or len(limits) > 100:
        raise ReviewError('editorial_reveal_limits_invalid')
    checked = []
    for row in limits:
        if (not isinstance(row, dict) or row.get('shot_id') not in shot_ids
                or type(row.get('not_before_beat')) is not int
                or not 1 <= row['not_before_beat'] <= count):
            raise ReviewError('editorial_reveal_limit_invalid')
        sentence = row.get('not_before_sentence', 1)
        if type(sentence) is not int or sentence < 1:
            raise ReviewError('editorial_reveal_sentence_invalid')
        checked.append({'shot_id': row['shot_id'], 'not_before_beat': row['not_before_beat'],
                        'not_before_sentence': sentence,
                        'reason': text(row.get('reason'), 'reveal_reason')})
    hold = picture.get('hold_after_seconds', 0)
    if type(hold) not in (int, float) or not math.isfinite(hold) or not 0 <= hold <= 3:
        raise ReviewError('editorial_picture_hold_invalid')
    hold_fields = {}
    if hold:
        hold_fields = {'hold_after_seconds': hold, 'hold_reason': text(picture.get('hold_reason'), 'hold_reason'),
                       'hold_audio': 'silence'}
        if picture.get('hold_audio') != 'silence':
            raise ReviewError('editorial_hold_audio_requires_silence_or_separate_original_scene')
    return {'editorial': result, 'picture_plan': {'purpose': purpose,
            'task': text(picture.get('task'), 'picture_task'), 'withhold': checked, **context, **hold_fields}}


def prose_issues(paragraphs: list[dict]) -> list[dict]:
    """Flag production language, retaining genuine story-world uncertainty."""
    issues = []
    exact = re.compile(r'(?:制作备注|待补证据|待核实画面|接口(?:失败|报错)|审核(?:未完成|未通过)|'
                       r'具体经过尚无法确认|(?:目前|现有)(?:素材|画面)(?:不足|无法确认)|'
                       r'等待(?:审核结果|补图)|审稿(?:备注|意见))')
    seen = {}
    for paragraph in paragraphs:
        pid = paragraph['id']
        prose = paragraph['text']
        for match in exact.finditer(prose):
            issues.append({'paragraph_id': pid, 'quote': match.group(),
                           'kind': 'production_note', 'severity': 'must_fix'})
        for sentence in re.split(r'(?<=[。！？])', prose):
            normalized = re.sub(r'\s+', '', sentence)
            if len(normalized) < 16:
                continue
            if normalized in seen:
                issues.append({'paragraph_id': pid, 'previous_paragraph_id': seen[normalized],
                               'quote': sentence, 'kind': 'repeated_information', 'severity': 'suggestion'})
            else:
                seen[normalized] = pid
    return issues


def report(packet: dict, draft: dict) -> dict:
    from ve_tools.movie_intervals import subtract, seconds
    planned = {b['beat_idx']: b for b in packet['narration_budget']['beats']}
    rate = packet['narration_budget'].get('chars_per_second')
    reserved = [(row['start'], row['end']) for beat in packet['beats']
                for row in beat.get('original_audio_after', [])]
    reveal_limits = [row for beat in packet['beats']
                     for row in beat.get('picture_plan', {}).get('withhold', [])]
    rows = []
    for paragraph in draft['paragraphs']:
        indexes = paragraph['beat_indices']
        available = {sid for i in indexes for sid in packet['beats'][i-1].get('available_shots', [])}
        available -= {row['shot_id'] for row in reveal_limits
                      if row.get('not_before_beat', 0) > max(indexes)}
        shots = packet.get('shots', {})
        ranges = packet.get('reviewed_shot_ranges') or {}
        spans = []
        for sid in available:
            if sid not in shots:
                continue
            shot = shots[sid]
            bounds = ranges.get(sid) or shot
            start, end = max(shot['start'], bounds['start']), min(shot['end'], bounds['end'])
            if start < end:
                spans.append((start, end))
        capacity = seconds(subtract(spans, reserved))
        estimate = len(paragraph['text']) / rate if isinstance(rate, (int, float)) and rate > 0 else None
        rows.append({'paragraph_id': paragraph['id'], 'beat_indices': indexes,
                     'actual_characters': len(paragraph['text']),
                     'suggested_characters': sum(planned[i]['suggested_chars'] for i in indexes),
                     'purpose': [packet['beats'][i-1]['editorial']['story_change'] for i in indexes],
                     'required_information': [v for i in indexes for v in packet['beats'][i-1]['editorial']['keep']],
                     'picture_budget': {'estimated_narration_seconds': round(estimate, 3) if estimate else None,
                         'nonoverlap_source_upper_bound_seconds': round(capacity, 3),
                         'source_shortage': bool(estimate and estimate > capacity),
                         'scope': 'rough upper bound from observed candidate shots, excluding reserved original audio; '
                                  'required picture meaning, reveal limits and precise action boundaries still need checking'}})
    return {'schema': VERSION, 'packet_id': packet['packet_id'], 'paragraphs': rows,
            'duration': duration_estimate(packet, draft['paragraphs']),
            'issues': prose_issues(draft['paragraphs']),
            'scope': 'editorial_diagnostics; independent full-prose review remains required'}
