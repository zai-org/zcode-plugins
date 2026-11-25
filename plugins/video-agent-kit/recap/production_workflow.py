"""Prepare one reviewed script version for uninterrupted full-length production.

``prepare-production`` runs the steps that still need a decision before the
render: anchor the manuscript, refine the shots it can use, make sure the script
review is current, voice the narration, arrange the whole film on that audio and
run the picture check once. A passed check binds the production version; the
render then reuses exactly this audio and these windows.
"""
from __future__ import annotations

import time
from pathlib import Path

from recap import script_review
from recap import script_workflow as sw
from recap.movie_source import source_identity
from recap.project_context import ProjectContext as RunContext
from ve_tools import picture_windows, produce, production_ready
from ve_tools.recap_runtime_state import owner_identity, owner_liveness
from ve_tools.visual_review import ReviewError, atomic_json

PROGRESS = 'script_workflow/preparation.json'
PAUSED = ('awaiting_subagent', 'audio_pending', 'needs_picture_plan', 'needs_attention')


def load_arguments(root: Path, args_file: Path | None = None) -> dict:
    path = args_file or Path('out/produce_args.json')
    return sw.read_json(path if path.is_absolute() else root / path)


def _validate_arguments(ctx, args):
    out = ctx.resolve('out')
    profile = sw.read_json(out / 'production_profile.json')
    if profile.get('script_review_policy') != script_review.POLICY or not picture_windows.enabled(out):
        raise ReviewError('production_preparation_requires_movie_profile')
    if (args.get('fit_mode') or 'whole_shot') != 'whole_shot':
        raise ReviewError('production_preparation_requires_whole_shot')
    # The reviewers consume canonical artifacts; the anchored inputs must be
    # the same files rather than another unreviewed writer/reel/timeline.
    for key, canonical in production_ready.path_arguments(ctx).items():
        if canonical and ctx.resolve(args.get(key) or canonical) != ctx.resolve(canonical):
            raise ReviewError('production_preparation_requires_canonical_' + key)
    originals = ctx.resolve('out/original_audio.json')
    if args.get('original_audio_path'):
        if ctx.resolve(args['original_audio_path']) != originals:
            raise ReviewError('production_preparation_requires_canonical_original_audio_path')
    elif originals.is_file() and sw.read_json(originals):
        raise ReviewError('production_preparation_requires_original_audio_path')
    video = ctx.resolve(args['video_path'])
    if video != ctx.resolve(profile['video']):
        raise ReviewError('production_source_changed')
    identity = source_identity(video)
    if profile.get('source_identity') and profile['source_identity'] != identity:
        raise ReviewError('production_source_changed')


def window_scope(out: Path, reserved=()) -> set[str]:
    """Shots an arrangement may put on screen: the writer's choices and each paragraph's pool window."""
    from ve_tools.picture_fit import FIT_TOPUP_EXTRA
    narration = sw.read_json(out / 'narration_script.json')
    reel = sw.read_json(out / 'reel.json').get('beats', {})
    shots = sw._rows(sw.read_json(out / 'shots.json'), 'shots')
    selected = set(reserved)
    for segment in narration:
        window = (reel.get(segment['seg_id']) or {}).get('window') or {}
        t0, t1 = float(window.get('t0', 0) or 0), float(window.get('t1', 0) or 0) + FIT_TOPUP_EXTRA
        selected.update(s['shot_id'] for s in shots if t0 <= (s['start'] + s['end']) / 2 < t1)
        for unit in segment.get('semantic_units', []):
            selected.update(unit.get('required_shot_ids', []) + unit.get('candidate_shot_ids', []))
    return selected & {s['shot_id'] for s in shots}


def synthesize_verified(ctx, args: dict) -> dict:
    """Voice the production narration exactly as produce_film does (same cache).

    Continuous delivery voices whole paragraphs: an unchanged paragraph reuses
    its audio, a paragraph whose wording changed (a softened or dropped
    sentence) is the smallest unit voiced again. Returns the verification.
    """
    import os
    from ve_tools import narrate_tts
    continuous = bool(args.get('continuous_delivery', produce.DEFAULTS['continuous_delivery']))
    style = (str(args.get('style_instructions') or '').strip() or os.environ.get('VE_TTS_STYLE_DEFAULT', '').strip()
             or produce.DEFAULT_STYLE)
    result = narrate_tts.synthesize_narration({
        'script_path': 'out/narration_script.json', 'provider': args.get('provider') or produce.DEFAULTS['provider'],
        'voice': args.get('voice'), 'by_sentence': not continuous, 'continuous_delivery': continuous,
        'flatten_quotes': True, 'verify': 'asr', 'style_instructions': style}, ctx)
    verify = (result.data or {}).get('verify') or {}
    ok = (not result.text.startswith('[ERROR]') and verify and not verify.get('failed_seg_ids')
          and not verify.get('unverified_seg_ids'))
    return {'status': 'verified' if ok else 'audio_pending', 'verification': verify,
            'detail': None if ok else result.text[:400], **({} if ok else narrate_tts.handoff_of(result))}


def measured_timing(out: Path) -> Path | None:
    """Saved speech timing for paragraphs whose wording is unchanged (planning views only)."""
    path = out / 'script_tts.json'
    if not path.is_file():
        return None
    current = {s['seg_id']: s.get('text', '') for s in sw.read_json(out / 'narration_script.json')}
    rows = [row for row in sw.read_json(path)
            if isinstance(row, dict) and current.get(row.get('seg_id')) == row.get('text')]
    if not rows:
        return None
    target = out / 'window_check/timing.json'
    atomic_json(target, rows)
    return target


def arrange_windows(ctx, out: Path, args: dict, swap_requests=(), *, synthesize: bool = False) -> dict:
    """Re-anchor (with recorded resolutions) and compute every sentence's exact windows.

    With ``synthesize`` the narration is voiced and verified first and the
    windows follow the real audio; this is the only timing the picture check
    uses. Without it (planning views) saved measured timing is used where it
    matches and other paragraphs are marked as estimated. ``swap_requests`` are
    the sentences whose footage the picture check wants replaced.
    """
    from ve_tools.picture_preflight import preflight_picture
    anchored = produce.prepare_film_inputs(args, ctx, require_reviews=False)
    if anchored.failed:
        return {'status': 'failed', 'issues': [{'reason': 'anchor_failed', 'detail': anchored.text[:400]}],
                'segments': []}
    reserved = produce._picture_reservations(ctx, anchored.data['original_reserved'])
    if synthesize:
        audio = synthesize_verified(ctx, args)
        if audio['status'] != 'verified':
            return {'status': 'audio_pending', 'issues': [], 'segments': [], **audio}
        timing = out / 'script_tts.json'
    else:
        timing = measured_timing(out)
    preflight_args = {'reel_path': args.get('reel_path') or 'out/reel.json',
        'timeline_path': args.get('timeline_path') or 'out/' + movie_timeline(out),
        'avoid_shot_ids': sorted(set(args.get('avoid_shot_ids') or []) | set(reserved)),
        'avoid_shot_ids_by_seg': args.get('avoid_shot_ids_by_seg'),
        'shot_ranges_path': args.get('shot_ranges_path'), 'chars_per_second': args.get('chars_per_second'),
        'swap_requests': sorted(swap_requests),
        'report_path': str(out / 'window_check/arrangement.json')}
    if timing is not None:
        preflight_args['timing_path'] = str(timing)
    result = preflight_picture(preflight_args, ctx)
    return result.data or {'status': 'failed', 'issues': [], 'segments': []}


def movie_timeline(out: Path) -> str:
    from ve_tools import movie_refinement
    return movie_refinement.timeline_name(out)


def _refine(out: Path, ctx, args: dict, anchored, save) -> dict | None:
    """Refine the shots the arrangement may use; a stop result when it cannot."""
    from ve_tools import movie_edit_spans, movie_refinement
    from ve_tools.movie_sampling import exact_fps
    save(step='selected_refinement')
    selected = window_scope(out, anchored.data['original_reserved'])
    for refinement_round in range(3):
        save(refinement_round=refinement_round + 1)
        refined = movie_refinement.refine_selected(out, selected,
                                                   on_progress=lambda value: save(refinement_progress=value))
        if refined['status'] != 'ready':
            return {'status': 'needs_refinement', 'missing_shot_ids': refined['missing_shot_ids'],
                    'report': 'out/shot_refinement.json'}
        anchored = produce.prepare_film_inputs(args, ctx, require_reviews=False)
        if anchored.failed:
            return {'status': 'needs_revision', 'detail': anchored.text, **(anchored.data or {})}
        # Boundary shifts can move a paragraph's pool; the scope must settle.
        selected = window_scope(out, anchored.data['original_reserved'])
        if selected <= set(refined['refined_shot_ids']):
            movie_refinement.validate_selected(out, selected)
            break
    else:
        return {'status': 'needs_refinement', 'reason': 'window_scope_changed_after_refinement',
                'missing_shot_ids': sorted(selected - set(refined['refined_shot_ids'])),
                'report': 'out/shot_refinement.json'}
    timeline = sw.read_json(out / movie_refinement.TIMELINE)
    clock = movie_refinement.frame_clock(Path(timeline['video']), exact_fps(timeline), out / movie_refinement.CLOCK)
    save(step='source_edit_spans')
    proof = movie_edit_spans.prepare(out, timeline, clock, selected)
    save(source_edit_proof_id=proof['proof_id'])
    return None


def prepare_production(root: Path, *, args: dict | None = None) -> dict:
    """Anchor, refine, review, voice, arrange and check once; never render here.

    The CLI owns the production stage lock. Every step skips work that is still
    bound to the current inputs, so rerunning after a subagent report continues
    where the stage paused.
    """
    from recap import window_check
    from ve_tools import movie_refinement
    ctx = RunContext(project_root=root)
    out = ctx.resolve('out')
    args = load_arguments(ctx.project_dir) if args is None else dict(args)
    _validate_arguments(ctx, args)
    started = time.monotonic()
    progress = {'schema': production_ready.VERSION, 'status': 'running', 'owner': owner_identity(), 'step': 'anchor'}

    def save(**fields):
        progress.update(fields, elapsed_seconds=round(time.monotonic() - started, 3), updated_at=time.time())
        atomic_json(out / PROGRESS, progress)

    def stop(step, result):
        save(status=result['status'], step=step)
        return {**result, 'step': step}

    save()
    try:
        movie_refinement.initialize(out)
        anchored = produce.prepare_film_inputs(args, ctx, require_reviews=False)
        if anchored.failed:
            return stop('anchor', {'status': 'needs_revision', 'detail': anchored.text, **(anchored.data or {})})
        if movie_refinement.enabled(out):
            blocked = _refine(out, ctx, args, anchored, save)
            if blocked is not None:
                return stop('selected_refinement', blocked)
        save(step='script_review')
        if sw.validate_review_artifacts(out):
            gate = script_review.review(out)
            if gate['status'] == 'awaiting_subagent':
                return stop('script_review', gate)
            if gate['status'] not in ('passed', 'resolved'):
                return stop('script_review', {**gate, 'report': 'out/' + script_review.GATE})
        # Voice first, then arrange on the real audio, then check exactly those windows.
        save(step='narration_audio_and_picture_check')
        checked = window_check.run(out, lambda requests: arrange_windows(ctx, out, args, requests, synthesize=True))
        if checked['status'] in PAUSED:
            return stop('narration_audio' if checked['status'] == 'audio_pending' else 'picture_check', checked)
        gaps = window_check.review_gaps(out)
        if checked['status'] != 'passed' or gaps:
            return stop('picture_check', {**checked, 'status': 'needs_picture_check', 'gaps': gaps[:40]})
        save(step='ready')
        anchored = produce.prepare_film_inputs(args, ctx)
        if anchored.failed:
            return stop('anchor', {'status': 'needs_revision', 'detail': anchored.text, **(anchored.data or {})})
        report = sw.read_json(out / 'window_check/arrangement.json')
        snapshot = production_ready.capture_inputs(ctx, args)
        if sw.validate_review_artifacts(out) or window_check.review_gaps(out):
            raise ReviewError('production_review_inputs_changed')
        record = production_ready.write_ready(ctx, args, report, snapshot)
        return stop('ready', {'status': 'ready', 'ready_id': record['ready_id'],
                              'picture_check': checked.get('totals', {}),
                              'resolutions': checked.get('resolutions', []),
                              'warnings': report.get('warnings', []),
                              'next': 'produce_film with out/produce_args.json; render=true for the full-length draft'})
    except Exception as error:
        code = error.code if isinstance(error, ReviewError) else 'preparation_failed'
        save(status='failed', error_code=code)
        raise
    finally:
        if progress['status'] == 'running':
            save(status='interrupted')


def preparation_status(out: Path) -> dict:
    path = out / PROGRESS
    if not path.is_file():
        return {'status': 'not_started'}
    record = sw.read_json(path)
    liveness = owner_liveness(record.get('owner', {}))
    if record.get('status') == 'running' and liveness == 'stopped':
        record = {**record, 'status': 'interrupted'}
    elif record.get('status') == 'ready':
        try:
            ctx = RunContext(project_root=out.parent, create_dirs=False)
            result = production_ready.validate_ready(ctx, load_arguments(out.parent))
            if result is not None:
                record = {**record, 'status': 'needs_preparation', 'reason': result.data['error']}
        except (OSError, ValueError, KeyError, TypeError):
            record = {**record, 'status': 'needs_preparation', 'reason': 'production_arguments_missing_or_invalid'}
    return {**record, 'owner_liveness': liveness}
