"""Container-local movie preparation and the coarse visual observation of the whole film.

``prepare`` writes the production profile and arguments from the pipeline seed;
``plan`` samples one frame per shot cluster; ``observe`` prepares or collects the
observer tasks and exports the visual index once every task is answered.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from contextlib import nullcontext
from pathlib import Path

if not __package__:  # executed as a file: import siblings as recap.<name>
    import _entry
    _entry.bootstrap()
from recap import native_observation
from recap.movie_source import source_identity
from recap.project_context import bind_root, default_root
from ve_tools import visual_review as vr
from ve_tools.recap_runtime_state import RuntimeBusy, stage_run


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def narration_voice() -> str:
    """The configured preset voice (VE_TTS_VOICE, else the service default). The id that used
    to be fixed here is no longer in the voice catalogue: every narration call made with it
    came back voice_id_invalid until the profile was edited by hand."""
    from ve_tools.tts import tts_config
    return tts_config()['voice']


def write_profile(root: Path, video: Path, meta: dict, seed_hash: str) -> dict:
    target = meta.get('target_minutes', [8, 12])
    if (not isinstance(target, list) or len(target) != 2
            or any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in target)
            or target[0] > target[1]):
        raise vr.ReviewError('movie_target_duration_invalid')
    voice = narration_voice()
    profile = {'mode': 'isolated_movie_recap', 'title': meta['title'], 'video': str(video),
               'source_identity': source_identity(video), 'seed_sha256': seed_hash,
               'continuous_delivery': True, 'fit_mode': 'whole_shot', 'tts_provider': 'tts',
               'voice': voice, 'target_minutes': list(target),
               'shot_strategy': 'coarse-first-v1', 'draft_origin': 'coordinator',
               'editorial_policy': 'movie-editorial-v1', 'script_review_policy': 'movie-script-bounded-v1',
               'picture_check_policy': 'movie-picture-check-v1', 'final_review_version': 'recap-final-v6-native',
               'production_flow_version': 'recap-production-ready-v1'}
    if 'target_minutes' in meta:
        profile['duration_policy'] = 'target-window-v1'
    vr.atomic_json(root / 'out/produce_args.json', {
        'video_path': str(video), 'script_path': 'out/writer_script.json',
        'title': meta['title'], 'continuous_delivery': True, 'fit_mode': 'whole_shot',
        'provider': 'tts', 'voice': voice, 'render': True,
        'timeline_path': 'out/shots_refined.json', 'bgm': False, 'bed_volume': 0, 'tail_volume': 0})
    vr.atomic_json(root / 'out/production_profile.json', profile)
    return profile


def prepare(seed: Path, video: Path, root: Path) -> dict:
    """Bind the workspace to the pipeline seed; a resumed workspace must match it exactly."""
    profile_path = root / 'out/production_profile.json'
    seed_hash = vr.digest(seed.read_bytes())
    if profile_path.exists():
        old = json.loads(profile_path.read_text())
        if old['seed_sha256'] != seed_hash or old['video'] != str(video):
            raise vr.ReviewError('seed_changed')
        if old.get('source_identity') != source_identity(video):
            raise vr.ReviewError('source_changed')
        return {'prepared': True, 'resumed': True}
    meta = json.loads(seed.read_bytes())
    if not isinstance(meta, dict) or meta.get('source_only') is not True or not str(meta.get('title') or '').strip():
        raise vr.ReviewError('seed_invalid')
    if video.stat().st_size != meta['source_size']:
        raise vr.ReviewError('source_size_changed')
    (root / 'out').mkdir(exist_ok=True)
    vr.atomic_json(root / 'out/recap_seed_metadata.json', meta)
    return {'prepared': True, 'indexing_required': True, **write_profile(root, video, meta, seed_hash)}


def plan_observation(root: Path) -> dict:
    """Sample the coarse scene index once; later runs reuse it while its inputs are unchanged."""
    from ve_tools import movie_sampling as sampling

    out = root / 'out'
    if (out / 'visual_review/plan.json').is_file():
        native_observation.load_plan(out)
        return native_observation.status(out)
    profile = json.loads((out / 'production_profile.json').read_text())
    video = Path(profile['video'])
    timeline = json.loads((out / 'shots.json').read_text())
    dialogue = json.loads((out / 'dialogue_index.json').read_text())
    metadata = out / 'recap_seed_metadata.json'
    meta = json.loads(metadata.read_text()) if metadata.exists() else {}
    rejected = set(meta.get('previously_rejected_frames', []))
    rejected_intervals = meta.get('previously_rejected_intervals', [])
    selection = sampling.select_coarse(timeline, dialogue, sampling.read_candidates(out, timeline),
                                       unavailable_intervals=rejected_intervals)
    inputs = {name: vr.digest((out / name).read_bytes()) for name in ('shots.json', 'dialogue_index.json')}
    selection['inputs'] = inputs
    selection['selection_id'] = sampling.digest({k: v for k, v in selection.items() if k != 'selection_id'})
    vr.atomic_json(out / 'sampling_plan.json', selection)
    directory = out / 'visual_review'
    frames = []
    for row in selection['frames']:
        # Frames an earlier run could not use stay unavailable: they become a
        # stated gap instead of being sent to an observer again.
        unavailable = (row['frame_number'] in rejected
                       or any(a <= row['time'] <= b for a, b in rejected_intervals))
        frames.append({**row, 'path': str(directory / row['image']), 'unavailable': unavailable})
    sampling.extract_selected(video, directory, [f for f in frames if not f['unavailable']],
                              duration=float(timeline['duration']), on_progress=emit)
    units = native_observation.make_units(frames, dialogue)
    plan = native_observation.write_plan(out, source=str(video), selection_id=selection['selection_id'],
                                         inputs=inputs, units=units)
    return {'plan_id': plan['plan_id'], **native_observation.status(out)}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'plan', 'observe', 'status'])
    parser.add_argument('--root', type=Path, default=None,
                        help='Project root (default: the current project directory)')
    parser.add_argument('--seed', type=Path, help='prepare: the pipeline-written seed JSON')
    parser.add_argument('--video', type=Path, help='prepare: the source film')
    args = parser.parse_args()
    try:
        args.root = bind_root(args.root or default_root())
        operation = (nullcontext(None) if args.action == 'status' else
                     stage_run(args.root.resolve(), 'production',
                               inputs={'operation': 'container_recap_' + args.action}, outputs=[]))
        with operation as stage:
            if args.action == 'prepare':
                if not args.seed or not args.video:
                    parser.error('prepare requires --seed and --video')
                emit(prepare(args.seed, args.video, args.root))
            elif args.action == 'plan':
                emit(plan_observation(args.root))
            elif args.action == 'observe':
                emit(native_observation.run(args.root / 'out'))
            else:
                emit(native_observation.status(args.root / 'out'))
            if stage is not None:
                stage.complete(operation='container_recap_' + args.action)
    except RuntimeBusy:
        emit(vr.ReviewError('production_writer_active').result())
        raise SystemExit(2) from None
    except vr.ReviewError as error:
        emit(error.result())
        raise SystemExit(2) from None


if __name__ == '__main__':
    main()
