"""Bind an approved production version without binding mutable audio/render output."""
from __future__ import annotations

import hashlib
import json

from .result import ToolResult
from .visual_review import atomic_json, encoded

VERSION = 'recap-production-ready-v1'
PATH = 'out/production_ready.json'
PATH_ARGS = {'script_path': 'out/writer_script.json', 'plan_path': 'out/plan.json',
             'reel_path': 'out/reel.json', 'timeline_path': 'out/shots.json',
             'graph_path': 'out/graph.json', 'original_audio_path': None, 'shot_ranges_path': None}
REQUIRED = ('production_profile.json', 'draft_story.md', 'writing_packet.json',
            'writer_script.json', 'script_gate.json', 'script_review.json',
            'narration_script.json', 'window_check.json',
            'visual_frames.jsonl', 'visual_coverage_gaps.json')
OPTIONAL = ('outline.json', 'story_spine.md', 'dialogue_index.json',
            'visual_characters.json', 'original_audio.json', 'sentence_resolutions.json')


def _digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def path_arguments(ctx) -> dict:
    from .movie_refinement import timeline_name
    return {**PATH_ARGS, 'timeline_path': 'out/' + timeline_name(ctx.resolve('out'))}


def capture_inputs(ctx, args: dict) -> dict:
    files = {'out/' + name: _digest(ctx.resolve('out/' + name)) for name in REQUIRED}
    for name in OPTIONAL:
        path = ctx.resolve('out/' + name)
        files['out/' + name] = _digest(path) if path.is_file() else None
    paths = {}
    for key, default in path_arguments(ctx).items():
        value = args.get(key) or default
        path = ctx.resolve(value) if value else None
        paths[key] = ctx.virtualize(path) if path else None
        if path:
            if key != 'graph_path' and not path.is_file():
                raise ValueError('production_input_missing:' + key)
            files[ctx.virtualize(path)] = _digest(path) if path.is_file() else None
    from . import movie_refinement
    out = ctx.resolve('out')
    if movie_refinement.enabled(out):
        report = json.loads((out / 'window_check.json').read_text())
        selected = {w['shot_id'] for row in report['sentences'].values() for w in row.get('windows', [])}
        originals = json.loads((out / 'original_audio.json').read_text()) if (out / 'original_audio.json').is_file() else []
        timeline = json.loads((out / movie_refinement.TIMELINE).read_text())
        selected.update(s['shot_id'] for s in timeline['shots']
                        if any(s['start'] < o['end'] and s['end'] > o['start'] for o in originals))
        movie_refinement.validate_selected(out, selected)
        for name in ('shots.json', movie_refinement.REPORT, movie_refinement.CLOCK,
                     'shot_seek_validation.json', 'sampling_plan.json'):
            files['out/' + name] = _digest(out / name)
        from .picture_source import load_context
        proof, _ = load_context(out, timeline)
        if proof is not None:
            if not selected <= proof['shots'].keys():
                raise ValueError('production_edit_spans_scope_missing')
            files['out/source_edit_spans.json'] = _digest(out / 'source_edit_spans.json')
    source = ctx.resolve(args['video_path'])
    if not source.is_file():
        raise ValueError('production_video_missing')
    stat = source.stat()
    # Cheap freshness checks remain private to movies. ASR and the final
    # native render proof bind full source bytes independently.
    video = {'path': str(source), 'size': stat.st_size, 'mtime_ns': stat.st_mtime_ns,
             'ctime_ns': stat.st_ctime_ns, 'inode': stat.st_ino, 'device': stat.st_dev}
    # Synthesized speech changes estimated timing on a later invocation. Its
    # cache and the latest preflight report are deliberately not fixed inputs.
    return {'files': files, 'paths': paths, 'source_fingerprint': video,
            'picture_settings': {'fit_mode': args.get('fit_mode') or 'whole_shot',
                'title': str(args.get('title') or ''),
                'avoid_shot_ids': sorted(set(args.get('avoid_shot_ids') or [])),
                'avoid_shot_ids_by_seg': {k: sorted(set(v)) for k, v in
                                        (args.get('avoid_shot_ids_by_seg') or {}).items()},
                'chars_per_second': args.get('chars_per_second')}}


def write_ready(ctx, args: dict, preflight: dict, expected_inputs: dict) -> dict:
    if preflight.get('status') != 'passed':
        raise ValueError('production_preflight_not_passed')
    inputs = capture_inputs(ctx, args)
    if inputs != expected_inputs:
        raise ValueError('production_inputs_changed')
    expected = {'script_path': inputs['files']['out/narration_script.json'],
                'reel_path': inputs['files'][inputs['paths']['reel_path']],
                'timeline_path': inputs['files'][inputs['paths']['timeline_path']]}
    if 'out/source_edit_spans.json' in inputs['files']:
        expected['source_edit_spans'] = inputs['files']['out/source_edit_spans.json']
    if any(preflight.get('inputs', {}).get(k) != v for k, v in expected.items()):
        raise ValueError('production_preflight_inputs_changed')
    record = {'schema': VERSION, 'status': 'ready', 'inputs': inputs, 'preflight': preflight,
              'scope': 'script_and_picture_preparation; final timing, video and audio reviews still required'}
    record['ready_id'] = hashlib.sha256(encoded(record)).hexdigest()
    path = ctx.resolve(PATH)
    if path.is_file():
        previous = json.loads(path.read_text())
        if previous != record:
            atomic_json(ctx.resolve('out/script_workflow/production_versions/' + _digest(path) + '.json'), previous)
    atomic_json(path, record)
    return record


def validate_ready(ctx, args: dict) -> ToolResult | None:
    """Profiles prepared by this flow (``production_flow_version``) need a current ready record.

    A workspace without that profile field is not gated here; it never ran prepare-production.
    """
    path = ctx.resolve(PATH)
    profile_path = ctx.resolve('out/production_profile.json')
    changes = None
    try:
        profile = json.loads(profile_path.read_text()) if profile_path.is_file() else {}
        if not path.is_file() and not profile.get('production_flow_version'):
            return None
        if not path.is_file():
            code = 'production_version_not_ready'
        else:
            record = json.loads(path.read_text())
            fingerprint = hashlib.sha256(encoded({k: v for k, v in record.items() if k != 'ready_id'})).hexdigest()
            if (record.get('schema') != VERSION or record.get('status') != 'ready'
                    or record.get('ready_id') != fingerprint or record.get('preflight', {}).get('status') != 'passed'):
                code = 'production_version_invalid'
            else:
                current = capture_inputs(ctx, args)
                if record.get('inputs') == current:
                    return None
                code = 'production_inputs_changed'
                changes = changed_dependencies(record.get('inputs') or {}, current)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        code = 'production_version_invalid'
    return ToolResult(text='[ERROR] produce_film/' + code +
                      ': run recap_script.py prepare-production --root <workspace>',
                      data={'failed_step': 'production_ready', 'status': 'needs_preparation', 'error': code,
                            **({'changed_dependencies': changes} if changes else {})})


def changed_dependencies(previous: dict, current: dict) -> dict:
    """Route a refresh without discarding unrelated review/audio caches.

    These are required validation stages, not approvals. prepare-production
    rebuilds an exact ready record and checks the saved reports before reuse.
    """
    old_files, new_files = previous.get('files', {}), current.get('files', {})
    changed = sorted(k for k in old_files.keys() | new_files.keys()
                     if old_files.get(k) != new_files.get(k))
    source_changed = previous.get('source_fingerprint') != current.get('source_fingerprint')
    story = {'production_profile.json', 'draft_story.md', 'writing_packet.json', 'writer_script.json',
             'script_gate.json', 'script_review.json',
             'outline.json', 'story_spine.md', 'dialogue_index.json', 'visual_characters.json'}
    review_changed = source_changed or any(k.rsplit('/', 1)[-1] in story for k in changed)
    return {'changed_files': changed, 'source_changed': source_changed,
            'script_review_needs_validation': review_changed,
            'picture_check_needs_refresh': True,
            'audio_reuse': 'text_voice_style_and_audio_byte_bindings',
            'next': 'prepare-production',
            'instruction': ('Validate the script review for the changed manuscript, then voice, arrange and check again.'
                            if review_changed else
                            'Keep the reviewed prose and matching speech. Arrange and check the pictures again.'),
            'cached_results_invalidated': False}
