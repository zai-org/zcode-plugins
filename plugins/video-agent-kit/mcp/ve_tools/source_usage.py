"""Source-frame accounting for explicitly verified Movie Recap edit spans.

The historical start_frame/end_frame fields remain the output-duration clock.
Only source_frame_start/source_frame_end identify physical source frames.  A
span ID is a lookup into a separately loaded proof, never a reuse permission
supplied by an EDL window itself.
"""
from __future__ import annotations

import math

from . import movie_refinement
from .movie_intervals import shot_spans


class SourceUsageError(ValueError):
    def __init__(self, reason: str, detail: str = '') -> None:
        self.reason = reason
        super().__init__(reason + (': ' + detail if detail else ''))


def declares_proof(edl: list[dict]) -> bool:
    """A lost sidecar must not silently restore the legacy audit rules."""
    return any('source_edit_proof_id' in row or 'edit_span_id' in row
               for entry in edl for row in [entry, *entry.get('windows', [])])


def _context(source_edit_proof: dict | None, source_clock: dict | None) -> None:
    if source_edit_proof is None:
        return
    if source_clock is None:
        raise SourceUsageError('source_clock_missing')
    if (not source_edit_proof.get('proof_id')
            or source_edit_proof.get('schema') != 'movie-edit-spans-v1'
            or source_edit_proof.get('frame_clock_id') != source_clock.get('clock_id')
            or not source_clock.get('source_sha256')
            or source_edit_proof.get('source_sha256') != source_clock['source_sha256']):
        raise SourceUsageError('source_edit_proof_binding_mismatch')


def _claim(row: dict, proof: dict | None) -> None:
    if 'source_edit_proof_id' in row:
        if proof is None:
            raise SourceUsageError('source_edit_proof_missing')
        if row['source_edit_proof_id'] != proof['proof_id']:
            raise SourceUsageError('source_edit_proof_id_mismatch')
    if 'edit_span_id' in row and proof is None:
        raise SourceUsageError('source_edit_proof_missing')


def _number(value, name: str) -> float:
    if type(value) not in (float, int) or not math.isfinite(value):
        raise SourceUsageError('invalid_source_interval', name)
    return float(value)


def _frame(value, name: str) -> int:
    if type(value) is not int or value < 0:
        raise SourceUsageError('invalid_source_frame', name)
    return value


def normalize_window(window: dict, fps: float, *, source_edit_proof: dict | None = None,
                     source_clock: dict | None = None) -> dict:
    """Resolve actual selected frames and verify all supplied source identities.

    Seconds are the renderer's input. Explicit source indices must select the
    very same half-open PTS interval; legacy frame fields are not reinterpreted.
    Callers must load/validate the proof and clock against the source first.
    """
    if not math.isfinite(fps) or fps <= 0:
        raise SourceUsageError('invalid_frame_rate')
    _context(source_edit_proof, source_clock)
    _claim(window, source_edit_proof)
    sid = window.get('shot_id')
    if not isinstance(sid, str) or not sid:
        raise SourceUsageError('invalid_parent_shot_id')
    explicit = ('source_frame_start' in window, 'source_frame_end' in window)
    if any(explicit) and not all(explicit):
        raise SourceUsageError('incomplete_source_frame_interval')
    if 'start' in window or 'end' in window:
        if 'start' not in window or 'end' not in window:
            raise SourceUsageError('invalid_source_interval', 'missing endpoint')
        start, end = _number(window['start'], 'start'), _number(window['end'], 'end')
    elif all(explicit) and source_clock is not None:
        try:
            start = movie_refinement.source_frame_time(source_clock, _frame(window['source_frame_start'], 'start'))
            end = movie_refinement.source_frame_time(source_clock, _frame(window['source_frame_end'], 'end'))
        except ValueError as exc:
            raise SourceUsageError('invalid_source_frame', str(exc)) from exc
    elif source_edit_proof is None and 'start_frame' in window and 'end_frame' in window:
        start = _frame(window['start_frame'], 'start_frame') / fps
        end = _frame(window['end_frame'], 'end_frame') / fps
    else:
        raise SourceUsageError('invalid_source_interval', 'missing source seconds')
    if end <= start:
        raise SourceUsageError('empty_source_interval')
    if source_clock is not None:
        first, last = movie_refinement.picture_span(source_clock, start, end-start)
        if not 0 <= first < last <= source_clock['frame_count']:
            raise SourceUsageError('empty_source_frame_interval')
        source_start = movie_refinement.source_frame_time(source_clock, first)
        source_end = movie_refinement.source_frame_time(source_clock, last)
    else:
        if all(explicit):
            raise SourceUsageError('source_clock_missing')
        first, last = round(start*fps), round(end*fps)
        if not 0 <= first < last:
            raise SourceUsageError('empty_source_frame_interval')
        source_start, source_end = first/fps, last/fps
    if all(explicit) and (first, last) != (
            _frame(window['source_frame_start'], 'source_frame_start'),
            _frame(window['source_frame_end'], 'source_frame_end')):
        raise SourceUsageError('source_frame_time_mismatch')
    for key, expected in (('source_start', source_start), ('source_end', source_end)):
        if key in window and abs(_number(window[key], key)-expected) > .0000011:
            raise SourceUsageError('source_frame_time_mismatch', key)
    span = None
    if source_edit_proof is not None:
        from .movie_edit_spans import locate
        if sid not in source_edit_proof['shots']:
            raise SourceUsageError('unverified_parent_shot', sid)
        try:
            span = locate(source_edit_proof, sid, first, last)
        except ValueError as exc:
            raise SourceUsageError('source_window_outside_edit_span', str(exc)) from exc
        if span is None:
            raise SourceUsageError('unverified_parent_shot', sid)
        if 'edit_span_id' in window and window['edit_span_id'] != span['span_id']:
            raise SourceUsageError('edit_span_id_mismatch', sid)
    if 'start_frame' in window or 'end_frame' in window:
        if 'start_frame' not in window or 'end_frame' not in window:
            raise SourceUsageError('invalid_output_duration')
        output_duration = (_frame(window['end_frame'], 'end_frame')
                           - _frame(window['start_frame'], 'start_frame')) / fps
    else:
        output_duration = end-start
    # Original audio is rendered as one continuous range. A short bookkeeping
    # piece at an internal cut can contain a real source frame but no distinct
    # output tick (VFR or a lower output rate); the entry owns the total clock.
    if output_duration < 0 or (output_duration == 0 and not (
            source_clock is not None and window.get('original_audio') is True)):
        raise SourceUsageError('invalid_output_duration')
    result = {**window, 'shot_id': sid, 'source_frame_start': first, 'source_frame_end': last,
              'source_start': source_start, 'source_end': source_end,
              'output_duration': output_duration}
    if span is not None:
        result.update(edit_span_id=span['span_id'], source_edit_proof_id=source_edit_proof['proof_id'])
    return result


def split_original_audio_windows(windows: list[dict], fps: float, *,
                                 source_edit_proof: dict | None = None,
                                 source_clock: dict | None = None) -> list[dict]:
    """Split continuous original-audio bookkeeping at verified source cuts.

    Keep the original outer seconds and output ticks. This neither trims nor
    replays the source, and never changes entry audio, captions or duration.
    Already claimed span identities must validate instead of being rewritten.
    """
    _context(source_edit_proof, source_clock)
    if source_edit_proof is None:
        for window in windows:
            _claim(window, None)
        return [dict(window) for window in windows]
    result = []
    for window in windows:
        if window.get('original_audio') is not True:
            raise SourceUsageError('original_audio_window_required')
        _claim(window, source_edit_proof)
        if 'edit_span_id' in window:
            result.append(normalize_window(window, fps, source_edit_proof=source_edit_proof,
                                           source_clock=source_clock))
            continue
        # Resolve the unsplit physical interval before looking up its verified
        # child spans; do not forge a temporary single-span proof to admit it.
        whole = normalize_window({key: value for key, value in window.items()
                                  if key != 'source_edit_proof_id'}, fps, source_clock=source_clock)
        first, end = whole['source_frame_start'], whole['source_frame_end']
        parent = source_edit_proof['shots'].get(whole['shot_id'])
        if parent is None or not parent['frame_start'] <= first < end <= parent['frame_end']:
            raise SourceUsageError('source_window_outside_parent_shot')
        parts = [(max(first, span['frame_start']), min(end, span['frame_end']), span)
                 for span in parent['spans'] if span['frame_start'] < end and first < span['frame_end']]
        if (not parts or parts[0][0] != first or parts[-1][1] != end
                or any(a[1] != b[0] for a, b in zip(parts, parts[1:]))):
            raise SourceUsageError('incomplete_original_audio_source_coverage')
        removed = {'start', 'end', 'start_frame', 'end_frame', 'source_start', 'source_end',
                   'source_frame_start', 'source_frame_end', 'output_duration'}
        metadata = {key: value for key, value in window.items() if key not in removed}
        for index, (left, right, span) in enumerate(parts):
            start = window['start'] if index == 0 else movie_refinement.source_frame_time(source_clock, left)
            finish = window['end'] if index == len(parts)-1 else movie_refinement.source_frame_time(source_clock, right)
            sf = window.get('start_frame', round(start*fps)) if index == 0 else round(start*fps)
            ef = window.get('end_frame', round(finish*fps)) if index == len(parts)-1 else round(finish*fps)
            child = {**metadata, 'start': start, 'end': finish, 'start_frame': sf, 'end_frame': ef,
                     'source_frame_start': left, 'source_frame_end': right,
                     'source_edit_proof_id': source_edit_proof['proof_id'], 'edit_span_id': span['span_id']}
            result.append(normalize_window(child, fps, source_edit_proof=source_edit_proof,
                                           source_clock=source_clock))
    if any(a['source_frame_end'] != b['source_frame_start'] for a, b in zip(result, result[1:])):
        raise SourceUsageError('original_audio_source_gap_or_overlap')
    return result


def verified_pool(pool: list[dict], fps: float, *, source_edit_proof: dict | None = None,
                  source_clock: dict | None = None) -> list[dict]:
    """Keep one immutable parent row; attach its available verified subranges."""
    if source_edit_proof is None:
        return [dict(shot) for shot in pool]
    _context(source_edit_proof, source_clock)
    result = []
    for shot in pool:
        parent = source_edit_proof['shots'].get(shot['shot_id'])
        if parent is None:
            raise SourceUsageError('unverified_parent_shot', shot['shot_id'])
        rows = []
        for left, right in shot_spans(shot):
            for span in parent['spans']:
                a, b = max(left, span['start']), min(right, span['end'])
                if a >= b:
                    continue
                first, end = movie_refinement.picture_span(source_clock, a, b-a)
                if first >= end:
                    continue
                row = normalize_window({'shot_id': shot['shot_id'], 'start': a, 'end': b,
                                        'edit_span_id': span['span_id']}, fps,
                                       source_edit_proof=source_edit_proof, source_clock=source_clock)
                rows.append({'span_id': row['edit_span_id'], 'edit_span_id': row['edit_span_id'],
                             'parent_shot_id': shot['shot_id'], 'start': a, 'end': b,
                             'span_start': span['start'], 'span_end': span['end'],
                             'frame_start': row['source_frame_start'], 'frame_end': row['source_frame_end']})
        result.append({**shot, 'edit_spans': rows, 'source_edit_proof_id': source_edit_proof['proof_id']})
    return result


def _entry_mode(entry: dict) -> str:
    """Existing intentional replay declarations get an independent local ledger."""
    windows = entry.get('windows', [])
    cold = bool(entry.get('cold_open') or any(w.get('cold_open') for w in windows))
    replay = bool(entry.get('replay') or any(w.get('replay') for w in windows))
    exemptions = entry.get('exemptions') or []
    if not isinstance(exemptions, list):
        raise SourceUsageError('invalid_replay_declaration')
    if cold:
        if (replay or entry.get('original_audio') or entry.get('cold_open') is not True
                or entry.get('reuse_type') != 'cold_open_teaser'
                or not {'global_no_repeat', 'monotonic_time'} <= set(exemptions)
                or not all(w.get('cold_open') is True for w in windows)):
            raise SourceUsageError('invalid_cold_open_declaration')
        return 'cold_open'
    if replay:
        if (entry.get('original_audio') is not True or entry.get('replay') is not True
                or entry.get('reuse_type') != 'original_audio_replay'
                or not {'global_no_repeat', 'monotonic_time', 'min_window'} <= set(exemptions)
                or not all(w.get('replay') is True and w.get('original_audio') is True for w in windows)):
            raise SourceUsageError('invalid_replay_declaration')
        return 'original_audio_replay'
    return 'main'


class _Ledger:
    def __init__(self) -> None:
        self.windows: list[dict] = []
        self.spans: dict[str, set[str | None]] = {}
        self.end = -1

    def add(self, row: dict, original_audio: bool) -> tuple[bool, bool, bool, int]:
        sid, span = row['shot_id'], row.get('edit_span_id')
        start, end = row['source_frame_start'], row['source_frame_end']
        previous = self.windows[-1] if self.windows else None
        contiguous = bool(previous and previous['shot_id'] == sid and start == self.end)
        seen = self.spans.get(sid, set())
        different_verified_span = bool(span and seen and span not in seen and None not in seen)
        duplicate = bool(seen and not contiguous and not different_verified_span and not original_audio)
        overlap = any(start < w['source_frame_end'] and w['source_frame_start'] < end for w in self.windows)
        regression, gap = start < self.end, start-self.end
        self.spans.setdefault(sid, set()).add(span)
        self.windows.append(row)
        self.end = max(self.end, end)
        return duplicate, overlap, regression, gap


def _unique_frames(windows: list[dict]) -> int:
    ranges = sorted((w['source_frame_start'], w['source_frame_end']) for w in windows)
    total, end = 0, -1
    for first, last in ranges:
        total += max(0, last-max(first, end))
        end = max(end, last)
    return total


def audit_usage(edl: list[dict], fps: float, min_window_sec: float = 1.25, *,
                source_edit_proof: dict | None = None, source_clock: dict | None = None,
                frame_gap_tol: int = 2) -> dict:
    """Shared EDL ledger. Replay groups are checked internally, never skipped."""
    report = {'status': 'passed', 'n_segments': len(edl), 'n_windows': 0,
              'duplicate_shots': [], 'overlapping_source_frames': [], 'source_time_regressions': [],
              'too_short_windows': [], 'explicit_reuse': [], 'source_usage_errors': [], 'fps': fps}
    main = _Ledger()
    for entry in edl:
        try:
            _context(source_edit_proof, source_clock)
            _claim(entry, source_edit_proof)
            mode = _entry_mode(entry) if source_edit_proof is not None else 'main'
        except (ValueError, TypeError) as exc:
            report['source_usage_errors'].append({'seg_id': entry.get('seg_id'),
                'reason': getattr(exc, 'reason', 'invalid_source_usage'), 'detail': str(exc)})
            mode = 'main'
        ledger = main if mode == 'main' else _Ledger()
        for index, window in enumerate(entry.get('windows', [])):
            identity = {'seg_id': entry.get('seg_id'), 'window_index': index, 'shot_id': window.get('shot_id')}
            try:
                row = normalize_window(window, fps, source_edit_proof=source_edit_proof, source_clock=source_clock)
            except (ValueError, TypeError, KeyError) as exc:
                report['source_usage_errors'].append({**identity,
                    'reason': getattr(exc, 'reason', 'invalid_source_usage'), 'detail': str(exc)})
                continue
            identity.update(source_frame_start=row['source_frame_start'], source_frame_end=row['source_frame_end'])
            if row.get('edit_span_id'):
                identity['edit_span_id'] = row['edit_span_id']
            duplicate, overlap, regression, gap = ledger.add(row, bool(entry.get('original_audio')))
            for bad, key in ((duplicate, 'duplicate_shots'), (overlap, 'overlapping_source_frames'),
                             (regression, 'source_time_regressions'), (bool(window.get('reused')), 'explicit_reuse')):
                if bad:
                    report[key].append(identity)
            if (mode == 'main' and not entry.get('original_audio')
                    and row['output_duration'] + 1e-6 < min_window_sec
                    and float(entry.get('audio_dur', 0)) >= min_window_sec
                    and not 0 <= gap <= frame_gap_tol):
                report['too_short_windows'].append(identity)
    dwells = []
    previous_end = None
    for row in main.windows:
        first, end = row['source_frame_start'], row['source_frame_end']
        if previous_end is not None and 0 <= first-previous_end <= frame_gap_tol:
            dwells[-1] += row['output_duration']
        else:
            dwells.append(row['output_duration'])
        previous_end = end
    total = sum(dwells)
    report.update(n_windows=len(main.windows), unique_source_frames=_unique_frames(main.windows),
                  rhythm={'n_cuts': len(dwells), 'cuts_per_min': round(len(dwells)/(total/60), 1) if total else 0,
                          'avg_dwell_sec': round(total/len(dwells), 2) if dwells else 0,
                          'pct_under_2s': round(sum(d < 2 for d in dwells)/len(dwells), 2) if dwells else 0,
                          'pct_over_5s': round(sum(d > 5 for d in dwells)/len(dwells), 2) if dwells else 0})
    if source_edit_proof is not None:
        report['source_edit_proof_id'] = source_edit_proof['proof_id']
    if any(report[key] for key in ('duplicate_shots', 'overlapping_source_frames', 'source_time_regressions',
                                  'too_short_windows', 'explicit_reuse', 'source_usage_errors')):
        report['status'] = 'failed'
    return report


class ChainLedger:
    """Incremental proof-path ``audit_chain_usage`` for one growing search chain.

    Valid only for prefixes that already passed: such a prefix is strictly
    monotonic and non-overlapping, so a new piece overlaps an earlier window
    exactly when it starts before the prefix end. Each step normalizes only the
    new piece instead of re-auditing the whole chain. Immutable; ``extend``
    returns a new ledger.
    """
    __slots__ = ('fps', 'proof', 'clock', 'last', 'end', 'spans')

    def __init__(self, fps: float, *, source_edit_proof: dict, source_clock: dict | None,
                 _state=(None, -1, None)):
        self.fps, self.proof, self.clock = fps, source_edit_proof, source_clock
        self.last, self.end, spans = _state
        self.spans = {} if spans is None else spans

    def extend(self, piece: dict) -> tuple[list[dict], 'ChainLedger | None']:
        identity = {'window_index': None, 'shot_id': piece.get('shot_id')}
        try:
            row = normalize_window(piece, self.fps, source_edit_proof=self.proof, source_clock=self.clock)
        except (ValueError, TypeError, KeyError) as exc:
            return [{**identity, 'reason': getattr(exc, 'reason', 'invalid_source_usage'), 'detail': str(exc)}], None
        sid, span = row['shot_id'], row.get('edit_span_id')
        start, end = row['source_frame_start'], row['source_frame_end']
        contiguous = bool(self.last and self.last['shot_id'] == sid and start == self.end)
        seen = self.spans.get(sid, frozenset())
        different_verified_span = bool(span and seen and span not in seen and None not in seen)
        issues = []
        if seen and not contiguous and not different_verified_span:
            issues.append({'reason': 'unplanned_source_replay', **identity})
        if start < self.end:
            issues += [{'reason': 'source_intervals_overlap', **identity},
                       {'reason': 'source_time_regression', **identity}]
        if piece.get('reused'):
            issues.append({'reason': 'explicit_source_reuse', **identity})
        if issues:
            return issues, None
        spans = dict(self.spans)
        spans[sid] = seen | {span}
        return [], ChainLedger(self.fps, source_edit_proof=self.proof, source_clock=self.clock,
                               _state=(row, max(self.end, end), spans))


def audit_chain_usage(chain: list[dict], fps: float, *, source_edit_proof: dict | None = None,
                      source_clock: dict | None = None) -> list[dict]:
    """The selection search and final EDL gate use the same physical ledger."""
    if source_edit_proof is None and not declares_proof([{'windows': chain}]):
        # Preserve the selection engine's historical one-frame tolerance. The
        # stricter source-frame ledger is an explicit Movie Recap contract.
        issues = []
        if any(a['end'] > b['start'] + 1/fps for a, b in zip(chain, chain[1:])):
            issues.append({'reason': 'source_intervals_overlap'})
        seen = {}
        for piece in chain:
            previous = seen.get(piece['shot_id'])
            if previous is not None and abs(previous-piece['start']) > 1/fps:
                issues.append({'reason': 'unplanned_source_replay', 'shot_id': piece['shot_id']})
            seen[piece['shot_id']] = piece['end']
        return issues
    report = audit_usage([{'windows': chain}], fps, min_window_sec=0,
                         source_edit_proof=source_edit_proof, source_clock=source_clock)
    reasons = {'duplicate_shots': 'unplanned_source_replay', 'overlapping_source_frames': 'source_intervals_overlap',
               'source_time_regressions': 'source_time_regression', 'explicit_reuse': 'explicit_source_reuse'}
    return [*report['source_usage_errors'], *({'reason': reason, **row}
            for key, reason in reasons.items() for row in report[key])]
