"""Explicit, continuous original-audio scenes with source-order validation."""
from __future__ import annotations

import json
import math
from pathlib import Path


def subtitle_corrections(scenes: list[dict], dialogue: list[dict],
                         sources: dict) -> dict[tuple[int, str], dict]:
    """Validate small caption corrections against observed source frames.

    The ASR text and original audio remain unchanged. Callers supply sources
    from the current validated writing packet, never from an editable caption
    assertion alone. The returned evidence is also carried into the EDL.
    """
    by_id = {row['id']: row for row in dialogue if 'id' in row}
    corrected = {}
    for index, scene in enumerate(scenes):
        rows = scene.get('subtitle_corrections', [])
        if not isinstance(rows, list):
            raise ValueError('original_subtitle_corrections_invalid')
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError('original_subtitle_correction_invalid')
            did = row.get('dialogue_id')
            sid = row.get('source_id')
            if not isinstance(did, str) or not isinstance(sid, str):
                raise ValueError('original_subtitle_correction_source_missing')
            original, source = by_id.get(did), sources.get(sid)
            if original is None or source is None:
                raise ValueError('original_subtitle_correction_source_missing')
            if (index, did) in corrected:
                raise ValueError('original_subtitle_duplicate_correction')
            before, after = row.get('replace_from'), row.get('replace_to')
            if (not all(isinstance(v, str) and 0 < len(v) <= 16 and v.isprintable()
                        and not any(c.isspace() for c in v) for v in (before, after))
                    or before == after):
                raise ValueError('original_subtitle_correction_requires_local_replacement')
            if (row.get('original_text') != original['text']
                    or original['text'].count(before) != 1):
                raise ValueError('original_subtitle_correction_text_changed')
            quote, position = row.get('source_quote'), source.get('time')
            if (source.get('kind') != 'sparse_frame' or source.get('uncertainty')
                    or not isinstance(quote, str) or not quote
                    or quote not in source.get('text', '') or after not in quote):
                raise ValueError('original_subtitle_correction_unconfirmed')
            if (type(position) not in (int, float) or not math.isfinite(position)
                    or not original['start'] <= position <= original['end']
                    or not scene['start'] <= position <= scene['end']
                    or original['start'] < scene['start'] - .08
                    or original['end'] > scene['end'] + .08):
                raise ValueError('original_subtitle_correction_outside_dialogue')
            corrected[index, did] = {**row, 'corrected_text': original['text'].replace(before, after)}
    return corrected


def validate_scene_captions(out: Path, scenes: list[dict]) -> dict:
    if not any(scene.get('subtitle_corrections') for scene in scenes):
        return {}
    packet = json.loads((out / 'writing_packet.json').read_text())
    dialogue = json.loads((out / 'dialogue_index.json').read_text())
    if isinstance(dialogue, dict):
        dialogue = dialogue['lines']
    return subtitle_corrections(scenes, dialogue, packet['sources'])


def load_scenes(path: Path, timeline: dict) -> tuple[list[dict], set[str]]:
    scenes = json.loads(path.read_text())
    reserved = set()
    for scene in scenes:
        start, end = float(scene['start']), float(scene['end'])
        if not 0 <= start < end <= float(timeline['duration']):
            raise ValueError('Original-audio scene is outside the source')
        if end - start < 5 or end - start > 25:
            raise ValueError('Original-audio scenes must be complete 5-25 second excerpts')
        if not scene.get('reviewed') or not scene.get('reason'):
            raise ValueError('Original-audio scene requires content review and a reason')
        reserved.update(s['shot_id'] for s in timeline['shots']
                        if s['start'] < end and s['end'] > start)
    return scenes, reserved


def insert_scenes(edl: list[dict], scenes: list[dict], timeline: dict,
                  dialogue: list[dict], *, sources: dict | None = None,
                  source_edit_proof: dict | None = None, source_clock: dict | None = None) -> list[dict]:
    fps = float(timeline['fps'])
    corrections = subtitle_corrections(scenes, dialogue, sources or {})
    by_after = {}
    for index, scene in enumerate(scenes, 1):
        if scene['after_seg_id'] not in {e['seg_id'] for e in edl}:
            raise ValueError('Original-audio insertion point is missing')
        start, end = round(float(scene['start']) * fps) / fps, round(float(scene['end']) * fps) / fps
        lines = [d for d in dialogue if d['start'] < end and d['end'] > start]
        if any(d['start'] < start - 0.08 or d['end'] > end + 0.08 for d in lines):
            raise ValueError(f"Original-audio excerpt cuts a dialogue line: {scene['after_seg_id']}")
        windows = []
        for shot in timeline['shots']:
            left, right = max(start, shot['start']), min(end, shot['end'])
            if right > left:
                windows.append({'shot_id': shot['shot_id'], 'start': left, 'end': right,
                                'start_frame': round(left * fps), 'end_frame': round(right * fps),
                                'original_audio': True})
        if source_edit_proof is not None:
            from .source_usage import split_original_audio_windows
            windows = split_original_audio_windows(windows, fps, source_edit_proof=source_edit_proof,
                                                     source_clock=source_clock)
        captions = []
        for line in lines:
            correction = corrections.get((index - 1, line.get('id')))
            caption = {'start': max(0, line['start'] - start),
                       'end': min(end, line['end']) - start,
                       'text': correction['corrected_text'] if correction else line['text']}
            if correction:
                caption['correction'] = correction
            captions.append(caption)
        entry = {'seg_id': f'oa{index:03d}', 'original_audio': True,
                 'audio_dur': round(end - start, 6), 'video_dur': round(end - start, 6),
                 'tail_sec': 0, 'windows': windows, 'text': '',
                 'subtitle_lines': captions,
                 'review_reason': scene['reason']}
        if source_edit_proof is not None:
            entry['source_edit_proof_id'] = source_edit_proof['proof_id']
        by_after.setdefault(scene['after_seg_id'], []).append(entry)
    result = []
    for entry in edl:
        result.append(entry)
        result.extend(by_after.get(entry['seg_id'], []))
    from .render_narrated import audit_edl
    qc = audit_edl(result, fps=fps, source_edit_proof=source_edit_proof, source_clock=source_clock)
    if qc['status'] != 'passed':
        raise ValueError(f'Original-audio insertion violates source order or overlap: {qc}')
    return result
