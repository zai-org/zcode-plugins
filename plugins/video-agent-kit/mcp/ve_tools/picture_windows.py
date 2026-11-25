"""Exact per-sentence picture windows, picture swaps, fit feedback and sentence resolutions.

Movie profiles with ``picture_check_policy`` check the picture that will really be
on screen. After the narration is voiced, the arrangement computes each
sentence's exact source windows; the picture check samples frames inside them.
A sentence whose picture contradicts it gets its windows swapped for other
footage of the same length, so the audio and every other sentence's windows stay
exactly as they were. This module holds those deterministic parts, shared by the
rehearsal (picture_preflight) and the final fit (picture_fit); the check itself
lives in the plugin's ``recap.window_check``.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

POLICY = 'movie-picture-check-v1'
PROFILE_KEY = 'picture_check_policy'
REPORT = 'window_check.json'
RESOLUTIONS = 'sentence_resolutions.json'
RESOLUTION_VERSION = 'movie-sentence-resolutions-v1'
# Frames per window follow its length. Most narration windows are a few seconds
# of one shot, where the middle frame shows what is on screen; longer windows
# can change content and get their start and end (and middle) as well.
SINGLE_FRAME_SECONDS = 4.0
TWO_FRAME_SECONDS = 8.0
MAX_EDGE_MARGIN = 0.25
FEEDBACK_ALTERNATIVES = 5
MIN_ALTERNATIVE_SECONDS = 1.0


def _read(path: Path):
    return json.loads(Path(path).read_text())


def enabled(out: Path) -> bool:
    path = Path(out) / 'production_profile.json'
    try:
        return path.is_file() and _read(path).get(PROFILE_KEY) == POLICY
    except (OSError, ValueError, AttributeError):
        return False


def sample_times(start: float, end: float) -> list[float]:
    """Sample times strictly inside [start, end): one, two or three by window length.

    A small edge margin keeps start/end samples off the cut itself.
    """
    start, end = float(start), float(end)
    length = end - start
    if not (math.isfinite(start) and math.isfinite(end)) or length <= 0:
        raise ValueError('picture window must have a positive length')
    if length <= SINGLE_FRAME_SECONDS:
        return [round(start + length / 2, 3)]
    count = 2 if length <= TWO_FRAME_SECONDS else 3
    margin = min(MAX_EDGE_MARGIN, length * .1)
    first, last = start + margin, end - margin
    times = [round(first + (last - first) * k / (count - 1), 3) for k in range(count)]
    return [min(max(t, start), math.nextafter(end, start)) for t in times]


def _pieces_as_windows(chain: list[dict], fps: float) -> list[dict]:
    return [{'shot_id': piece['shot_id'], 'start_frame': round(piece['start'] * fps),
             'end_frame': round(piece['end'] * fps),
             'source_start': float(piece.get('source_start', piece['start'])),
             'source_end': float(piece.get('source_end', piece['end']))} for piece in chain]


def sentence_windows(chain: list[dict], sentences: list[dict], fps: float) -> list[dict]:
    """Each sentence's exact source windows (shot, in, out) under its own speech.

    Uses the same interval accounting as the final fit, so a window here is the
    part of the source that plays while this sentence is spoken.
    """
    from .picture_semantics import map_intervals
    windows = _pieces_as_windows(chain, fps)
    rows = map_intervals(windows, [{**s, 'unit_id': s['unit_id']} for s in sentences], fps) if windows else []
    result = []
    for sentence, row in zip(sentences, rows):
        merged = []
        for overlap in row['overlaps']:
            a, b = round(overlap['source_start'], 3), round(overlap['source_end'], 3)
            if b - a <= 1e-6:
                continue
            if merged and merged[-1]['shot_id'] == overlap['shot_id'] and abs(merged[-1]['source_end'] - a) < 1e-3:
                merged[-1]['source_end'] = b
            else:
                merged.append({'shot_id': overlap['shot_id'], 'source_start': a, 'source_end': b})
        for window in merged:
            window['seconds'] = round(window['source_end'] - window['source_start'], 3)
        result.append({'unit_id': sentence['unit_id'], 'text': sentence.get('text', ''),
                       'speech_start': round(float(sentence['start']), 3),
                       'speech_end': round(float(sentence['end']), 3),
                       'speech_seconds': round(float(sentence['end']) - float(sentence['start']), 3),
                       'windows': merged})
    return result


# ---------------------------------------------------------------------------
# Picture swaps: replace one sentence's footage, keep every frame around it.


def load_swaps(out: Path) -> dict:
    """``unit_id -> {'removed': windows, 'pieces': chain pieces}`` recorded by the picture check."""
    path = Path(out) / REPORT
    if not path.is_file():
        return {}
    return {uid: swap for uid, swap in (_read(path).get('swaps') or {}).items() if swap.get('pieces')}


def _output_frames(chain: list[dict], fps: float) -> list[tuple[int, int]]:
    bounds, cursor = [], 0
    for piece in chain:
        frames = round(piece['end'] * fps) - round(piece['start'] * fps)
        bounds.append((cursor, cursor + frames))
        cursor += frames
    return bounds


def _cut(piece: dict, first: int, last: int, fps: float) -> dict:
    """Frames [first, last) of a piece, counted from its own first output frame.

    Offsets are whole frames from the piece's own source start, so the frames
    on either side of a cut keep their exact source times.
    """
    start = piece['start'] + first / fps
    end = piece['start'] + last / fps if last < round(piece['end'] * fps) - round(piece['start'] * fps) else piece['end']
    return {**piece, 'start': start, 'end': end, 'dur': end - start, 'partial': True}


def _speech_frames(sentence: dict, fps: float, previous_end: float | None, next_start: float | None):
    """The output frames under this sentence's speech, never touching a neighbour's speech."""
    first = math.ceil(max(float(sentence['start']), previous_end or 0) * fps - 1e-6)
    last = math.floor(min(float(sentence['end']), next_start if next_start is not None else math.inf) * fps + 1e-6)
    return first, last


def _split(chain: list[dict], first: int, last: int, fps: float):
    """(pieces before, replaced pieces, pieces after, remainders) around output frames [first, last).

    Remainders are the parts of a piece cut at the boundary that stay on screen
    around the replacement; they become pieces of their own.
    """
    before, replaced, after, remainders = [], [], [], []
    for piece, (a, b) in zip(chain, _output_frames(chain, fps)):
        if b <= first:
            before.append(piece)
        elif a >= last:
            after.append(piece)
        else:
            if a < first:
                before.append(_cut(piece, 0, first - a, fps))
                remainders.append(before[-1])
            replaced.append(_cut(piece, max(0, first - a), min(b, last) - a, fps))
            if b > last:
                after.append(_cut(piece, last - a, b - a, fps))
                remainders.append(after[-1])
    return before, replaced, after, remainders


def _neighbours(sentences: list[dict], unit_id: str):
    ordered = sorted(sentences, key=lambda s: float(s['start']))
    index = next(i for i, s in enumerate(ordered) if s['unit_id'] == unit_id)
    previous_end = float(ordered[index - 1]['end']) if index else None
    next_start = float(ordered[index + 1]['start']) if index + 1 < len(ordered) else None
    return ordered[index], previous_end, next_start


def _window_rows(pieces: list[dict]) -> list[dict]:
    return [{'shot_id': p['shot_id'], 'source_start': round(p['start'], 3), 'source_end': round(p['end'], 3)}
            for p in pieces]


def _replacements(pool: list[dict], low: float, high: float, removed: list[dict], frames: int, fps: float,
                  min_piece: float):
    """Contiguous source runs of exactly ``frames`` frames inside (low, high), nearest first."""
    from .picture_source import edit_ranges, span_metadata
    segments = []
    for row in pool:
        for usable in edit_ranges(row):
            a, b = max(usable['start'], low), min(usable['end'], high)
            pieces = [(a, b)]
            for gone in removed:
                if gone['shot_id'] != row['shot_id']:
                    continue
                pieces = [part for x, y in pieces for part in ((x, min(y, gone['start'])), (max(x, gone['end']), y))
                          if part[1] - part[0] > 1e-6]
            segments.extend((x, y, row['shot_id'], span_metadata(usable)) for x, y in pieces if y - x > 1e-6)
    segments.sort()
    runs, current = [], []
    for segment in segments:
        if current and segment[0] - current[-1][1] > 1 / fps + 1e-6:
            runs.append(current)
            current = []
        current.append(segment)
    if current:
        runs.append(current)
    length = frames / fps
    centre = sum((g['start'] + g['end']) / 2 for g in removed) / len(removed)
    options = []
    for run in runs:
        lo, hi = run[0][0], run[-1][1]
        if hi - lo + 1e-6 < length:
            continue
        for start in (min(max(centre - length / 2, lo), hi - length), lo, hi - length):
            start = min(math.ceil(start * fps - 1e-6) / fps, hi - length)
            if start < lo - 1e-6:
                continue
            chosen = []
            for x, y, shot_id, span in run:
                a, b = max(x, start), min(y, start + length)
                if b - a > 1e-6:
                    chosen.append({'shot_id': shot_id, 'start': a, 'end': b, 'dur': b - a, 'partial': True,
                                   'boundary_in': 'hard', **span})
            if chosen and all(p['dur'] + 1e-6 >= min_piece for p in chosen):
                options.append((abs(start + length / 2 - centre), start, chosen))
    for _, _, chosen in sorted(options, key=lambda option: option[:2]):
        yield chosen


def find_swap(chain: list[dict], sentences: list[dict], unit_id: str, pool: list[dict], fps: float, *,
              min_piece: float, audit=None) -> dict | None:
    """Footage of the same length for one sentence, keeping every other frame of the chain.

    The replacement lies between the pieces around the sentence in source time
    (the film stays in source order), avoids the removed footage, and every new
    piece, including what is left of a split piece, is long enough to read.
    ``audit(chain)`` returns the source-ledger issues of a candidate chain.
    """
    sentence, previous_end, next_start = _neighbours(sentences, unit_id)
    first, last = _speech_frames(sentence, fps, previous_end, next_start)
    if last - first < 1:
        return None
    before, replaced, after, remainders = _split(chain, first, last, fps)
    if not replaced or any(p['dur'] + 1e-6 < min_piece for p in remainders):
        return None
    low = before[-1]['end'] if before else replaced[0]['start']
    high = after[0]['start'] if after else replaced[-1]['end']
    removed = [{'shot_id': p['shot_id'], 'start': p['start'], 'end': p['end']} for p in replaced]
    for pieces in _replacements(pool, low, high, removed, last - first, fps, min_piece):
        candidate = before + pieces + after
        if audit is None or not audit(candidate):
            return {'removed': _window_rows(replaced), 'pieces': pieces, 'output_frames': [first, last]}
    return None


def apply_swap(chain: list[dict], sentences: list[dict], unit_id: str, swap: dict, fps: float) -> list[dict] | None:
    """The chain with a recorded swap, or None when the sentence's footage is no longer what it replaced."""
    sentence, previous_end, next_start = _neighbours(sentences, unit_id)
    first, last = _speech_frames(sentence, fps, previous_end, next_start)
    before, replaced, after, _ = _split(chain, first, last, fps)
    frames = sum(round(p['end'] * fps) - round(p['start'] * fps) for p in swap['pieces'])
    if _window_rows(replaced) != swap['removed'] or frames != last - first:
        return None
    return before + [dict(p) for p in swap['pieces']] + after


def apply_swaps(chain: list[dict], sentences: list[dict], swaps: dict, fps: float) -> tuple[list[dict], dict]:
    """Apply every recorded swap of this paragraph; returns the chain and per-sentence outcomes."""
    outcomes = {}
    ids = {s['unit_id'] for s in sentences}
    for unit_id, swap in sorted(swaps.items()):
        if unit_id not in ids:
            continue
        swapped = apply_swap(chain, sentences, unit_id, swap, fps)
        outcomes[unit_id] = 'applied' if swapped is not None else 'stale'
        chain = swapped if swapped is not None else chain
    return chain, outcomes


# ---------------------------------------------------------------------------
# Fit feedback: numbers and options when a sentence or paragraph does not fit.


def _usable(row: dict) -> list[tuple[float, float]]:
    from .picture_source import edit_ranges
    return [(r['start'], r['end']) for r in edit_ranges(row)]


def fit_feedback(sentence: dict, window_row: dict, pool: list[dict], chain: list[dict],
                 cps: float, *, reason: str) -> dict:
    """Numbers and concrete options when a sentence does not fit its picture.

    Options: extend inside the same shot into adjacent footage, split the
    sentence, shorten it by N characters, or pick another window.
    """
    by_id = {row['shot_id']: row for row in pool}
    speech = max(0.0, float(sentence['end']) - float(sentence['start']))
    own = [sid for sid in list(sentence.get('required_shot_ids', [])) + list(sentence.get('mains', []))
           if sid in by_id]
    own = list(dict.fromkeys(own))
    own_seconds = round(sum(b - a for sid in own for a, b in _usable(by_id[sid])), 3)
    windows = window_row.get('windows', []) if window_row else []
    window_seconds = round(sum(w['seconds'] for w in windows), 3)
    reference = own_seconds if own else window_seconds
    shortage = round(max(0.0, speech - reference), 3)
    used = {piece['shot_id'] for piece in chain}
    options = []
    extend = []
    for window in windows:
        row = by_id.get(window['shot_id'])
        if row is None:
            continue
        for a, b in _usable(row):
            if a - 1e-6 <= window['source_start'] and window['source_end'] <= b + 1e-6:
                before, after = round(window['source_start'] - a, 3), round(b - window['source_end'], 3)
                if before > .05 or after > .05:
                    extend.append({'shot_id': window['shot_id'], 'window': [window['source_start'],
                                   window['source_end']], 'extra_seconds_before': before,
                                   'extra_seconds_after': after})
    if extend:
        options.append({'option': 'extend_within_shot', 'detail': extend})
    if shortage > 0:
        chars = max(1, math.ceil(shortage * cps))
        options.append({'option': 'shorten_sentence', 'characters': chars,
                        'detail': f'shorten by about {chars} characters ({shortage:.1f}s at {cps:.2f} chars/s)'})
    text = sentence.get('text', '')
    if len(own) >= 2 or (own and speech > max((b - a for sid in own for a, b in _usable(by_id[sid])), default=0)):
        options.append({'option': 'split_sentence', 'parts': max(2, min(len(own), 3) if len(own) >= 2 else 2),
                        'detail': 'split so each part is spoken over one of its own shots',
                        'characters': len(text)})
    anchor = (windows[0]['source_start'] if windows else
              min((by_id[sid]['start'] for sid in own), default=None))
    alternatives = sorted((row for row in pool if row['shot_id'] not in used and row['shot_id'] not in own
                           and sum(b - a for a, b in _usable(row)) >= MIN_ALTERNATIVE_SECONDS),
                          key=lambda row: (abs(row['start'] - anchor) if anchor is not None else 0, row['start']))
    picks = [{'shot_id': row['shot_id'], 'source_start': round(row['start'], 3), 'source_end': round(row['end'], 3),
              'usable_seconds': round(sum(b - a for a, b in _usable(row)), 3)}
             for row in alternatives[:FEEDBACK_ALTERNATIVES]]
    if picks:
        options.append({'option': 'pick_another_window', 'candidates': picks})
    return {'unit_id': sentence['unit_id'], 'reason': reason, 'speech_seconds': round(speech, 3),
            'chars': len(text), 'chars_per_second': round(cps, 3),
            'own_shot_ids': own, 'own_shot_seconds': own_seconds,
            'window_seconds': window_seconds, 'shortage_seconds': shortage,
            'windows': windows, 'options': options}


def segment_feedback(seg_id: str, speech: float, available: float, cps: float, pool: list[dict],
                     chain: list[dict], window: dict) -> dict:
    shortage = round(max(0.0, speech - available), 3)
    used = {piece['shot_id'] for piece in chain}
    t1 = float(window.get('t1', 0) or 0)
    later = [row for row in pool if row['shot_id'] not in used and row['start'] >= t1]
    return {'seg_id': seg_id, 'speech_seconds': round(speech, 3), 'available_seconds': round(available, 3),
            'shortage_seconds': shortage, 'options': [
                {'option': 'shorten_paragraph', 'characters': max(1, math.ceil(shortage * cps)) if shortage else 0},
                {'option': 'extend_paragraph_window', 'window': [round(float(window.get('t0', 0) or 0), 3),
                                                                 round(t1, 3)],
                 'unused_later_shots': [row['shot_id'] for row in later[:FEEDBACK_ALTERNATIVES]]}]}


# ---------------------------------------------------------------------------
# Sentence resolutions: a sentence that cannot be supported is softened to what
# the evidence supports or dropped, and the decision is recorded for delivery.


def load_resolutions(out: Path) -> dict:
    path = Path(out) / RESOLUTIONS
    if not path.is_file():
        return {'schema': RESOLUTION_VERSION, 'entries': {}}
    value = _read(path)
    if (not isinstance(value, dict) or value.get('schema') != RESOLUTION_VERSION
            or not isinstance(value.get('entries'), dict)):
        raise ValueError('sentence resolutions are invalid')
    for sid, entry in value['entries'].items():
        if (not isinstance(entry, dict) or entry.get('action') not in ('drop', 'soften')
                or (entry['action'] == 'soften' and not str(entry.get('text', '')).strip())
                or not isinstance(entry.get('reasons'), list)):
            raise ValueError('sentence resolution entry is invalid: ' + str(sid))
    return value


def record_resolution(out: Path, sentence: str, *, action: str, reason: dict, original_text: str,
                      origin: str, text: str = '') -> bool:
    """Add or update one decision; returns True when it changed.

    A coordinator's decision for the same wording is never replaced by an
    automatic one; the automatic reason is only added to it.
    """
    from .visual_review import atomic_json
    resolutions = load_resolutions(out)
    entry = resolutions['entries'].get(sentence)
    if entry and entry.get('origin') == 'coordinator' and origin != 'coordinator' \
            and entry.get('original_text') == original_text:
        if reason in entry['reasons']:
            return False
        entry['reasons'].append(reason)
    else:
        reasons = list(entry['reasons']) if entry and entry.get('original_text') == original_text else []
        new = {'action': action, 'origin': origin, 'original_text': original_text,
               'reasons': reasons + ([reason] if reason not in reasons else []),
               **({'text': text} if action == 'soften' else {})}
        if entry == new:
            return False
        resolutions['entries'][sentence] = new
    atomic_json(Path(out) / RESOLUTIONS, resolutions)
    return True


def sentence_id(unit: dict) -> str | None:
    beat, index = unit.get('beat_idx'), unit.get('sentence_idx')
    if type(beat) is int and type(index) is int:
        return f'B{beat:03d}S{index:03d}'
    return None


def apply_resolutions(narration: list[dict], resolutions: dict) -> tuple[list[dict], list[dict]]:
    """Drop or soften resolved sentences in the production narration only.

    The reviewed manuscript stays unchanged; every applied decision is returned
    for the delivery report. A softened sentence becomes one unit carrying the
    picture policy of its first unit, and makes no visual claim of its own.
    """
    entries = resolutions.get('entries', {})
    if not entries:
        return narration, []
    applied, result = [], []
    for segment in narration:
        units, done = [], set()
        for unit in segment.get('semantic_units', []):
            sid = sentence_id(unit)
            entry = entries.get(sid) if sid else None
            if entry is None:
                units.append(unit)
                continue
            if sid in done:
                continue
            done.add(sid)
            applied.append({'sentence_id': sid, 'seg_id': segment['seg_id'], 'action': entry['action'],
                            'reasons': entry['reasons']})
            if entry['action'] == 'soften':
                parts = [u for u in segment['semantic_units'] if sentence_id(u) == sid]
                merged = {k: v for k, v in unit.items() if k not in ('storyboard_part', 'spoken_text', 'subtitle_text')}
                merged['semantic_unit_id'] = parts[0]['semantic_unit_id'].split('_b')[0]
                merged['text'] = entry['text']
                merged['candidate_shot_ids'] = list(dict.fromkeys(s for u in parts for s in u.get('candidate_shot_ids', [])))
                merged['required_shot_ids'] = []
                merged.pop('picture_cues', None)
                merged['visual_requirement'] = 'background'
                merged['resolution'] = 'softened'
                units.append(merged)
        if not units:
            continue
        changed = dict(segment, semantic_units=units)
        if len(units) != len(segment.get('semantic_units', [])) or any(
                a is not b for a, b in zip(units, segment.get('semantic_units', []))):
            changed['text'] = ''.join(u['text'] for u in units)
            changed.pop('spoken_text', None)
            changed['target_sec'] = segment.get('target_sec')
        result.append(changed)
    return result, applied


def apply_resolution_file(out: Path) -> list[dict]:
    """Rewrite out/narration_script.json with the recorded resolutions."""
    out = Path(out)
    if not enabled(out):
        return []
    resolutions = load_resolutions(out)
    if not resolutions['entries']:
        return []
    # A decision applies only to the reviewed wording it was made for.
    writer = _read(out / 'writer_script.json') if (out / 'writer_script.json').is_file() else {'beats': []}
    texts = {f'B{beat.get("idx", pos):03d}S{i:03d}': str(sentence.get('text', ''))
             for pos, beat in enumerate(writer.get('beats', []), 1)
             for i, sentence in enumerate(beat.get('sentences', []), 1)}
    resolutions = {**resolutions, 'entries': {sid: e for sid, e in resolutions['entries'].items()
                                              if texts.get(sid) == e['original_text']}}
    path = out / 'narration_script.json'
    narration, applied = apply_resolutions(_read(path), resolutions)
    if applied:
        from .visual_review import atomic_json
        atomic_json(path, narration)
    return applied


def checked_windows(out: Path) -> dict:
    """Checked windows per sentence from the saved picture check (read only)."""
    path = Path(out) / REPORT
    if not path.is_file():
        return {}
    return {uid: row.get('windows', []) for uid, row in (_read(path).get('sentences') or {}).items()
            if row.get('verdict') in ('match', 'neutral')}


def drift(out: Path, semantic_rows: list[dict], tolerance: float = .5) -> list[dict]:
    """Final windows not inside a checked window of the same sentence (beyond tolerance)."""
    checked = checked_windows(out)
    rows = []
    for row in semantic_rows:
        windows = checked.get(row['semantic_unit_id'])
        if windows is None:
            continue
        for overlap in row.get('overlaps', []):
            a, b = overlap.get('source_start'), overlap.get('source_end')
            if a is None or b - a <= tolerance:
                continue
            if not any(w['shot_id'] == overlap['shot_id'] and w['source_start'] - tolerance <= a
                       and b <= w['source_end'] + tolerance for w in windows):
                rows.append({'semantic_unit_id': row['semantic_unit_id'], 'shot_id': overlap['shot_id'],
                             'source_start': round(a, 3), 'source_end': round(b, 3)})
    return rows
