"""Evidence checks and a non-mutating picture rehearsal before synthesis."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from .picture_semantics import policy
from .picture_source import load_context, referenced_spans, structural_issues, structural_sequence_issues
from .source_usage import audit_usage, verified_pool
from .result import ToolResult


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def apply_reveal_limits(sentences: list[dict], pool: list[dict]) -> list[dict]:
    """Keep a withheld shot out of every sentence spoken before its reveal."""
    from .movie_picture import forbidden
    if not any(s.get('reveal_limits') for s in sentences):
        return pool
    pool_ids = sorted(r['shot_id'] for r in pool)
    for sentence in sentences:
        sentence['allowed_shot_ids'] = [sid for sid in pool_ids if sid not in forbidden(sentence)]
        required = sentence.get('required_shot_ids', [])
        sentence['mains'] = list(dict.fromkeys([sid for sid in required if sid in sentence['allowed_shot_ids']]
                                               + [sid for sid in sentence.get('mains', [])
                                                  if sid in sentence['allowed_shot_ids']]))
    return pool


def _measured_segments(segs: list[dict], previous: list[dict]) -> dict:
    """Reuse matching speech timing while evaluating the current picture policy.

    Changing candidate pictures does not change already spoken words. This is
    timing reuse for rehearsal only; production still checks full script/TTS
    binding, current picture requirements and the actual audio separately.
    """
    def speech_units(segment):
        return [(u['semantic_unit_id'], u.get('text', ''))
                for u in segment.get('semantic_units', [])]

    by_id = {s['seg_id']: s for s in previous}
    measured = {}
    for seg in segs:
        old = by_id.get(seg['seg_id'])
        if (old is None or seg.get('text', '') != old.get('text', '')
                or speech_units(seg) != speech_units(old)):
            continue
        duration = float(old.get('audio_dur') or 0)
        units = old.get('semantic_units', [])
        if (not math.isfinite(duration) or duration <= 0 or not units
                or any(type(u.get(k)) not in (int, float) or not math.isfinite(u[k])
                       for u in units for k in ('tts_start', 'tts_end'))
                or any(not 0 <= u['tts_start'] < u['tts_end'] <= duration + .05 for u in units)):
            continue
        measured[seg['seg_id']] = {'duration': duration,
            'units': {u['semantic_unit_id']: (u['tts_start'], u['tts_end']) for u in units}}
    return measured


def _window_feedback(report, record, seg_id, sentences, chain, pool, cps, fps, reel_beat, first_issue,
                     measured) -> None:
    """Exact windows per sentence plus explicit numbers and options for each misfit."""
    from . import picture_windows
    try:
        rows = picture_windows.sentence_windows(chain, sentences, fps)
    except ValueError:
        rows = []
    record['sentence_windows'] = rows
    by_unit = {row['unit_id']: row for row in rows}
    sentences_by_id = {s['unit_id']: s for s in sentences}
    feedback = []
    for target in (report['issues'], report['warnings']):
        for issue in target[first_issue if target is report['issues'] else 0:]:
            if issue.get('seg_id') != seg_id or 'fit' in issue:
                continue
            detail = issue.get('detail') if isinstance(issue.get('detail'), dict) else {}
            uid = issue.get('unit_id') or detail.get('semantic_unit_id')
            if uid in sentences_by_id:
                issue['fit'] = picture_windows.fit_feedback(
                    sentences_by_id[uid], by_unit.get(uid), pool, chain, cps,
                    reason=detail.get('reason') or issue['reason'])
                feedback.append(issue['fit'])
            elif issue['reason'] in ('clear_footage_shortage', 'speech_footage_shortage'):
                issue['fit'] = picture_windows.segment_feedback(
                    seg_id, record['estimated_seconds'], record['available_seconds'], cps, pool, chain,
                    reel_beat.get('window', {}))
                feedback.append(issue['fit'])
    # Sentences whose own chosen shots are shorter than their speech are listed even
    # when fill footage covers them: the fill is exactly what the picture check sees.
    for sentence in sentences:
        own = [p for p in pool if p['shot_id'] in set(sentence.get('mains', []))]
        if not own:
            continue
        own_seconds = sum(p['dur'] for p in own)
        speech = sentence['end'] - sentence['start']
        if speech - own_seconds > .5 and all(f['unit_id'] != sentence['unit_id'] for f in feedback):
            feedback.append(picture_windows.fit_feedback(sentence, by_unit.get(sentence['unit_id']), pool, chain,
                                                         cps, reason='own_shots_shorter_than_speech'))
    if feedback:
        record['fit_feedback'] = feedback
    record['timing_basis'] = 'measured_audio' if measured else 'estimated'


def _global_source_check(report: dict, edl: list[dict], measured: dict, fps: float, **source_args) -> None:
    """Use the final ledger across paragraphs, including intentional cold opens."""
    if source_args.get('source_edit_proof') is None:
        return
    from .narration_bind import MIN_WINDOW_SEC
    qc = audit_usage(edl, fps, min_window_sec=MIN_WINDOW_SEC, **source_args)
    report['source_usage'] = qc
    complete_timing = all(row['seg_id'] in measured for row in edl if not row.get('cold_open'))
    known = {(row.get('seg_id'), row.get('detail', {}).get('reason'),
              row.get('detail', {}).get('shot_id'), row.get('detail', {}).get('window_index'))
             for row in report['issues'] + report['warnings']}
    reasons = {'duplicate_shots': 'unplanned_source_replay', 'overlapping_source_frames': 'source_intervals_overlap',
               'source_time_regressions': 'source_time_regression', 'too_short_windows': 'short_source_window',
               'explicit_reuse': 'explicit_source_reuse', 'source_usage_errors': None}
    for key, reason in reasons.items():
        for row in qc[key]:
            detail = {**row, 'reason': reason or row['reason']}
            identity = (row.get('seg_id'), detail['reason'], row.get('shot_id'), row.get('window_index'))
            if identity in known:
                continue
            hard = complete_timing or key == 'source_usage_errors'
            target = report['issues'] if hard else report['warnings']
            target.append({'seg_id': row.get('seg_id'), 'reason': 'speech_timing_conflict' if hard
                           else 'estimated_timing_conflict', 'detail': detail})
            known.add(identity)


def _swap_pictures(report, seg_id, chain, sentences, pool, fps, swaps, requests, source_args) -> list[dict]:
    """Apply recorded swaps, and look for footage for requested ones (picture check only).

    A request replaces one sentence's windows with other footage of the same
    length; the result is reported so the check can record it and recheck it.
    """
    from . import picture_windows
    from .narration_bind import MIN_WINDOW_SEC
    from .source_usage import audit_chain_usage
    chain, outcomes = picture_windows.apply_swaps(chain, sentences, swaps, fps)
    for unit_id, outcome in outcomes.items():
        report['swaps'].append({'seg_id': seg_id, 'unit_id': unit_id, 'status': outcome})
    for sentence in sentences:
        uid = sentence['unit_id']
        if uid not in requests or outcomes.get(uid) == 'applied':
            continue
        found = None
        if sentence['visual_requirement'] == 'background' and not sentence.get('picture_cues'):
            found = picture_windows.find_swap(
                chain, sentences, uid, pool, fps, min_piece=MIN_WINDOW_SEC,
                audit=lambda candidate: audit_chain_usage(candidate, fps, **source_args))
        if found is None:
            report['swaps'].append({'seg_id': seg_id, 'unit_id': uid, 'status': 'no_replacement'})
            continue
        chain = picture_windows.apply_swap(chain, sentences, uid, found, fps)
        report['swaps'].append({'seg_id': seg_id, 'unit_id': uid, 'status': 'swapped',
                                'removed': found['removed'], 'pieces': found['pieces']})
    return chain


def preflight_picture(args: dict, ctx) -> ToolResult:
    from .picture_fit import _event_pool, _build_chain, FIT_TOPUP_EXTRA, FIT_TAIL_CAP_SEC
    from .picture_chain_search import chain_issues
    out = ctx.resolve('out')
    report = {'schema': 'picture-preflight-v1', 'status': 'failed', 'issues': [], 'warnings': [], 'segments': [],
              'timing': 'estimated; final fit uses verified speech timestamps'}
    try:
        paths = {k: ctx.resolve(args.get(k) or default) for k, default in
                 [('script_path', 'out/narration_script.json'), ('reel_path', 'out/reel.json'), ('timeline_path', 'out/shots.json')]}
        report['inputs'] = {k: digest(p) for k, p in paths.items()}
        segs = json.loads(paths['script_path'].read_text())
        reel_document = json.loads(paths['reel_path'].read_text())
        reels = reel_document['beats']
        timeline = json.loads(paths['timeline_path'].read_text())
        source_edit_proof, source_clock = load_context(paths['timeline_path'].parent, timeline)
        source_args = {'source_edit_proof': source_edit_proof, 'source_clock': source_clock}
        if source_edit_proof is not None:
            report['inputs']['source_edit_spans'] = digest(paths['timeline_path'].parent / 'source_edit_spans.json')
            report['source_edit_proof_id'] = source_edit_proof['proof_id']
        shots = sorted(timeline['shots'], key=lambda s: s['start'])
        from .movie_intervals import constrain_pool, pool_report
        if args.get('shot_ranges_path'):
            range_path = ctx.resolve(args['shot_ranges_path'])
            report['inputs']['shot_ranges'] = digest(range_path)
            ranges = json.loads(range_path.read_text())
            for shot in shots:
                span = ranges.get(shot['shot_id'])
                if span:
                    left, right = float(span['start']), float(span['end'])
                    if not span.get('reviewed') or not shot['start'] <= left < right <= shot['end']:
                        raise ValueError('invalid reviewed shot range: ' + shot['shot_id'])
                    shot['reviewed_span'] = [left, right]
        starts = [s['start'] for s in shots]
        fps = float(timeline.get('fps', 24))
        if not shots or not math.isfinite(fps) or fps <= 0:
            raise ValueError('no usable shot timeline')
        from . import picture_windows
        window_policy = picture_windows.enabled(out)
        if window_policy:
            report['picture_check_policy'] = picture_windows.POLICY
        swaps = picture_windows.load_swaps(out) if window_policy else {}
        swap_requests = set(args.get('swap_requests') or [])
        report['swaps'] = []
        avoided = set(args.get('avoid_shot_ids') or [])
        gap_path = out / 'visual_coverage_gaps.json'
        if gap_path.is_file():
            avoided.update(sid for gap in json.loads(gap_path.read_text()) for sid in gap.get('shot_ids', []))
            report['inputs']['visual_gaps'] = digest(gap_path)
        report['excluded_shot_ids'] = sorted(avoided)
        avoided_by_seg = args.get('avoid_shot_ids_by_seg') or {}
        report['excluded_shot_ids_by_seg'] = avoided_by_seg
        # Share the writer's calibrated delivery rate, including its breathing
        # allowance. Old or differently voiced TTS must not change this budget.
        from .narration_budget import planning_rate
        profile_path = out / 'production_profile.json'
        profile = json.loads(profile_path.read_text()) if profile_path.is_file() else {}
        exclusions = []
        original_path = out / 'original_audio.json'
        if profile.get('editorial_policy') == 'movie-editorial-v1' and original_path.is_file():
            exclusions = [(row['start'], row['end']) for row in json.loads(original_path.read_text())]
            report['inputs']['original_audio'] = digest(original_path)
        cps, rate_source = planning_rate(profile, reel_document, args.get('chars_per_second'))
        if profile_path.is_file():
            report['inputs']['voice_profile'] = digest(profile_path)
        measured = {}
        timing_path = ctx.resolve(args.get('timing_path') or 'out/script_tts.json')
        if timing_path.is_file():
            previous = json.loads(timing_path.read_text())
            measured = _measured_segments(segs, previous)
            if measured:
                report['inputs']['speech_timing'] = digest(timing_path)
                report['timing'] = 'current speech timestamps where available; remaining segments estimated'
        report['estimated_chars_per_second'] = cps
        report['rate_source'] = rate_source
        owners = {}
        span_owners = {}
        seg_span_ids = {seg['seg_id']: referenced_spans(seg, source_edit_proof) for seg in segs}
        for seg in segs:
            if not reels.get(seg['seg_id'], {}).get('cold_open'):
                for u in seg.get('semantic_units', []):
                    p = policy(u)
                    for sid in p['required_shot_ids'] or p['candidate_shot_ids']:
                        owners.setdefault(sid, seg['seg_id'])
                for span_id in seg_span_ids[seg['seg_id']]:
                    span_owners.setdefault(span_id, seg['seg_id'])
        used = set()
        used_spans = set()
        candidate_edl = []
        if source_edit_proof is not None:
            report['issues'].extend(structural_sequence_issues(segs, reels, fps))
        for seg in sorted(segs, key=lambda s: reels.get(s['seg_id'], {}).get('idx', 0)):
            sid = seg['seg_id']; rb = reels.get(sid, {}); cold = bool(rb.get('cold_open'))
            units = seg.get('semantic_units', [])
            if not units:
                report['issues'].append({'seg_id': sid, 'reason': 'missing_sentence_evidence'})
                continue
            own = {x for u in units for x in policy(u)['required_shot_ids'] + policy(u)['candidate_shot_ids']}
            reserved = {x for x, owner in owners.items() if owner != sid} - own
            reserved_spans = {x for x, owner in span_owners.items() if owner != sid} - seg_span_ids[sid]
            pool = _event_pool(rb.get('window', {}), shots, starts, reserved, set() if cold else used,
                               avoided | set(avoided_by_seg.get(sid, [])),
                               topup=FIT_TOPUP_EXTRA, **source_args,
                               used_edit_spans=set() if cold else used_spans,
                               reserved_edit_spans=reserved_spans)
            sentences = []; cursor = 0.0
            measured_seg = measured.get(sid)
            for unit in units:
                p = policy(unit); end = cursor + max(.1, len(unit.get('text', '')) / cps)
                start = cursor
                if measured_seg:
                    start, end = measured_seg['units'][unit['semantic_unit_id']]
                sentences.append({'unit_id': unit['semantic_unit_id'], 'text': unit.get('text', ''), 'start': start,
                                  'end': end, 'event_ids': unit.get('event_ids', []), 'claim_ids': unit.get('claim_ids', []),
                                  **p, 'mains': p['required_shot_ids'] + p['candidate_shot_ids']})
                cursor = end
            if measured_seg:
                cursor = measured_seg['duration']
            pool = apply_reveal_limits(sentences, pool)
            footage = pool_report(pool, exclusions)
            pool = constrain_pool(pool, exclusions)
            pool = verified_pool(pool, fps, **source_args)
            pool_ids = {p['shot_id'] for p in pool}
            first_issue = len(report['issues'])
            for sentence in sentences:
                req = set(sentence['required_shot_ids'])
                allowed = set(sentence.get('allowed_shot_ids', pool_ids)) & pool_ids
                missing = req - allowed
                if missing or (not req and sentence['visual_requirement'] == 'required'
                               and not allowed.intersection(sentence['candidate_shot_ids'])) or not allowed:
                    report['issues'].append({'seg_id': sid, 'unit_id': sentence['unit_id'],
                        'reason': 'required_picture_unavailable', 'missing_shot_ids': sorted(missing)})
            report['issues'].extend({'seg_id': sid, 'reason': 'picture_structure_conflict', 'detail': issue}
                                    for issue in structural_issues(sentences, pool, fps, **source_args))
            chain, info = _build_chain(pool, {}, sentences, cursor, FIT_TAIL_CAP_SEC, fps, **source_args)
            arranged = chain
            if measured_seg and (swaps or swap_requests):
                chain = _swap_pictures(report, sid, chain, sentences, pool, fps, swaps, swap_requests, source_args)
            record = {'seg_id': sid, 'estimated_seconds': round(cursor, 3),
                      'timing': 'measured_audio' if measured_seg else 'estimated',
                      'available_seconds': footage['available_seconds'], 'footage_accounting': footage,
                      'selected_shot_ids': [p['shot_id'] for p in chain], 'candidate_chain': chain, **info}
            report['segments'].append(record)
            entry = {'seg_id': sid, 'audio_dur': cursor, 'windows': [
                {**piece, 'start_frame': round(piece['start'] * fps), 'end_frame': round(piece['end'] * fps)}
                for piece in chain]}
            if cold:
                entry.update(cold_open=True, reuse_type='cold_open_teaser',
                             exemptions=['global_no_repeat', 'monotonic_time'])
                for window in entry['windows']:
                    window['cold_open'] = True
            candidate_edl.append(entry)
            if record['available_seconds'] + 1 / fps < cursor * .85:
                report['issues'].append({'seg_id': sid, 'reason': 'clear_footage_shortage',
                                        'estimated_missing_seconds': round(cursor-record['available_seconds'], 3)})
            # Use the same required-picture and cross-sentence support checks
            # as final fitting. Proven missing cue intervals above block even
            # before TTS. A duration-dependent estimated fit remains advisory;
            # matching measured speech surfaces actual conflicts before retry.
            for issue in chain_issues(chain, sentences, fps, **source_args):
                target = report['issues'] if measured_seg else report['warnings']
                target.append({'seg_id': sid, 'reason': 'speech_timing_conflict' if measured_seg
                               else 'estimated_timing_conflict', 'detail': issue})
            if measured_seg and info.get('shortage'):
                report['issues'].append({'seg_id': sid, 'reason': 'speech_footage_shortage'})
            if window_policy:
                _window_feedback(report, record, sid, sentences, chain, pool, cps, fps, rb, first_issue,
                                 measured_seg is not None)
            if not cold:
                # The arranged chain, not the swapped one, decides what later
                # paragraphs may use, so a swap never moves another paragraph.
                used.update(p['shot_id'] for p in arranged)
                used_spans.update(p['edit_span_id'] for p in arranged if 'edit_span_id' in p)
        _global_source_check(report, candidate_edl, measured, fps, **source_args)
        report['status'] = 'failed' if report['issues'] else 'passed'
    except FileNotFoundError as exc:
        report['issues'].append({'reason': 'missing_input', 'file': str(exc.filename)})
    except (ValueError, KeyError, TypeError) as exc:
        report['issues'].append({'reason': 'invalid_input', 'detail': str(exc)})
    out.mkdir(parents=True, exist_ok=True)
    path = ctx.resolve(args.get('report_path') or 'out/picture_preflight.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    ok = report['status'] == 'passed'
    return ToolResult(text='[PicturePreflight] passed' if ok else '[ERROR] picture_preflight: ' + report['status'],
                      data=report, artifacts=[str(path)])
