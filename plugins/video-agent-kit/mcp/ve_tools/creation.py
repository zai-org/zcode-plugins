"""Generic creation entry points with current-byte evidence and shared status semantics."""
from __future__ import annotations

import copy
from ve_tools import file_lock
import re
import subprocess
from functools import wraps
from pathlib import Path

from . import creation_media as production, creation_evidence as evidence
from . import creation_review as review, creation_takes as takes, creation_acceptance as acceptance, audio_identity, generators
from .title_cards import title_cards  # noqa: F401 — exported through the creation tool group
from . import creation_style_policy as style_policy
from .creation_planning import digest, file_digest, number, native_audio_warnings, nexus_visual_plan, shot_plan_digest, shot_review_context, validate_plan
from .result import ToolResult

_TAKE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}")


def _unsafe_take_ids(args):
    """Take ids become file and directory names; reject unsafe ones before any path is built."""
    ids = [args.get(k) for k in ('take_id', 'source_take_id') if args.get(k) is not None]
    ids += [s.get('take_id') for s in args.get('shots') or [] if isinstance(s, dict) and s.get('take_id')]
    ids += [s.get('reference_take_id') for s in args.get('shots') or [] if isinstance(s, dict) and s.get('reference_take_id')]
    return [t for t in ids if not isinstance(t, str) or not _TAKE_ID.fullmatch(t)]


def _public(handler):
    @wraps(handler)
    def run(args, ctx):
        from .creation_schemas import TOOL_SCHEMAS
        import jsonschema
        try:
            jsonschema.validate(args, TOOL_SCHEMAS[handler.__name__]['inputSchema'])
        except jsonschema.ValidationError as exc:
            return ToolResult(text=exc.message, is_error=True)
        allowed = TOOL_SCHEMAS[handler.__name__]['inputSchema']['properties']
        unknown = set(args) - set(allowed)
        if unknown:
            return ToolResult(text='unknown arguments: ' + ', '.join(sorted(unknown)), is_error=True)
        if handler.__name__ in ('video_generate', 'creation_verify', 'creation_timeline_build') and _unsafe_take_ids(args):
            return ToolResult(text='take ids must be safe identifiers (letters, digits, _, -, .)', is_error=True)
        lock = ctx.resolve('.video_agent/creation.lock')
        lock.parent.mkdir(parents=True, exist_ok=True)
        try:
            with lock.open('a') as stream:
                try:
                    file_lock.flock(stream.fileno(), file_lock.LOCK_EX | file_lock.LOCK_NB)
                except BlockingIOError:
                    raise ValueError('another creation operation is active in this project; retry after it finishes')
                from .file_contract import input_paths, protect_outputs
                protected = input_paths(args, ctx)
                for name in ('out/creation/shotlist.json', 'out/creation/clips/takes.json',
                             'out/creation/verdicts.json', 'out/timeline.json',
                             'out/creation/review_package.json', 'out/creation/edit_verdicts.json'):
                    if handler.__name__ == 'creation_timeline_build' and name == 'out/timeline.json':
                        continue
                    path = ctx.resolve(name)
                    if path.is_file():
                        protected.add(path)
                        protected.update(input_paths(takes.read_object(path), ctx))
                for key in ('shotlist_path', 'takes_path', 'verdicts_path', 'timeline_path', 'package_path', 'clips_path'):
                    if args.get(key):
                        document = ctx.resolve(args[key])
                        if document.is_file():
                            protected.update(input_paths(takes.read_object(document), ctx))
                outputs = []
                default_outputs = {
                    'creation_plan_validate': 'out/creation/shotlist_validation.json',
                    'image_generate': 'out/creation/images.json',
                    'video_generate': 'out/creation/clips.json',
                    'creation_timeline_build': 'out/timeline.json',
                    'creation_review': ('out/creation/review_validation.json' if args.get('action') == 'validate'
                                        else 'out/creation/review_package.json'),
                }
                if handler.__name__ == 'creation_verify' and args.get('action') == 'speech':
                    default_outputs['creation_verify'] = 'out/creation/clips_verification.json'
                if handler.__name__ in default_outputs and not args.get('output_json'):
                    target = ctx.resolve(default_outputs[handler.__name__])
                    # Own output reports may be intentionally regenerated, but never when supplied as input.
                    protected.discard(target)
                    protected.update(input_paths(args, ctx))
                    outputs.append(target)
                    if handler.__name__ == 'creation_timeline_build':
                        outputs.append(target.with_name(target.name + '.creation-stage.json'))
                if args.get('output_json'):
                    target = ctx.resolve(args['output_json'])
                    outputs += [target, target.with_name(target.name + '.creation-stage.json')]
                if args.get('output'):
                    outputs.append(ctx.resolve(args['output']))
                if handler.__name__ == 'image_generate':
                    for item in args.get('items', []):
                        name = item.get('output_name') or f"{item.get('kind') or 'keyframe'}_{item['id']}.png"
                        outputs.append(ctx.resolve(Path(args.get('output_dir') or 'out/creation/images') / name))
                if handler.__name__ == 'video_generate':
                    directory = ctx.resolve(args.get('output_dir') or 'out/creation/clips')
                    for shot in args.get('shots', []):
                        existing_target = directory / (str(shot.get('take_id') or '') + '.mp4')
                        direct_inputs = input_paths(args, ctx)
                        if existing_target not in direct_inputs:
                            protected.discard(existing_target)
                        if shot.get('take_id'):
                            # Existing immutable take is reusable, but never a generation reference input.
                            outputs.append(directory / (str(shot['take_id']) + '.mp4'))
                        elif shot.get('shot_id') is not None:
                            # Legacy unversioned target <output_dir>/<shot_id>.mp4: same id and output guards.
                            from .creation_planning import safe_unit_id
                            outputs.append(directory / (safe_unit_id(shot['shot_id']) + '.mp4'))
                    for path in ('task_ids.json', 'takes.json'):
                        target = directory / path
                        if target in input_paths(args, ctx):
                            outputs.append(target)
                from .file_contract import protect_directories
                if handler.__name__ == 'creation_verify' and args.get('action', 'prepare') == 'prepare' and args.get('take_id'):
                    next_revision = int(evidence.load_ledger(ctx).get(args['take_id'], {}).get('review_revision') or 0) + 1
                    protect_directories([ctx.resolve(f"out/creation/verify/{args['take_id']}/revision-{next_revision}")],
                                        protected | {ctx.resolve(_candidate(args, ctx)[0]['clip'])})
                # Reserve internal ledgers even on the first invocation.
                reserved = {ctx.resolve(p) for p in ('.video_agent/creation_budget.json', '.video_agent/image_requests.json', '.video_agent/creation.lock', 'out/creation/verified.json', 'out/creation/verdicts.json', 'out/creation/edit_verdicts.json', 'out/creation/clips/takes.json', 'out/creation/clips/task_ids.json', 'out/creation/clips/.takes.lock')}
                reserved.add(ctx.resolve(acceptance.IMAGE_REVIEWS_REL))
                if handler.__name__ == 'video_generate':
                    directory = ctx.resolve(args.get('output_dir') or 'out/creation/clips')
                    reserved.update(directory / p for p in ('takes.json', 'task_ids.json'))
                    if args.get('action') == 'edit' and args.get('take_id'):
                        profile = generators.plan_profile(_plan(args.get('shotlist_path') or 'out/creation/shotlist.json', ctx))
                        outputs.append(directory / (args['take_id'] + ('.mov' if profile.get('task_type_param') else '.mp4')))
                # Internal state remains writable only by its owning implementation.
                if handler.__name__ == 'creation_verify' and args.get('take_id'):
                    reserved.add(ctx.resolve(f"out/creation/verify/{args['take_id']}/evidence.json"))
                protect_outputs(outputs, protected | reserved)
                from .file_contract import output_locks, rollback_outputs
                from contextlib import ExitStack
                owned = []
                if handler.__name__ == 'video_generate':
                    owned += [directory / p for p in ('takes.json', 'task_ids.json', '.takes.lock')]
                    owned += [ctx.resolve('.video_agent/creation_budget.json')]
                if handler.__name__ == 'image_generate':
                    owned += [ctx.resolve('.video_agent/image_requests.json')]
                if handler.__name__ == 'creation_verify':
                    if args.get('action') in ('image_prepare', 'image_record'):
                        owned.append(ctx.resolve(acceptance.IMAGE_REVIEWS_REL))
                    owned += [ctx.resolve(p) for p in (evidence.LEDGER_REL, 'out/creation/verdicts.json')]
                    if args.get('take_id'):
                        owned += [ctx.resolve(f"out/creation/verify/{args['take_id']}"), ctx.resolve(f"out/creation/reviews/{args['take_id']}")]
                derived = []
                frozen = {}
                if handler.__name__ == 'video_generate':
                    derived += [directory / 'chain_seeds', ctx.resolve('.video_agent/audio_derivations')]
                    # Only verified, internally submitted derivations may be reused.
                    # Explicit inputs in these directories still fail before execution.
                    for record in takes.read_object(directory / 'takes.json').get('takes', {}).values():
                        for raw, sha in record.get('submitted_reference_sha256', {}).items():
                            path = ctx.resolve(raw)
                            if any(root in path.parents for root in derived):
                                if not path.is_file() or file_digest(path) != sha:
                                    raise ValueError('submitted derivation changed; restore original bytes before recovery')
                                frozen[path] = sha
                if handler.__name__ == 'creation_verify' and args.get('action') in ('speech', 'voices'):
                    for rel in ('.video_agent/clip_verify', 'out/creation/asr'):
                        raw_dir = ctx.project_dir / rel
                        if any(p.is_symlink() for p in (raw_dir, *raw_dir.parents)):
                            raise ValueError('speech output directory cannot use symlinks')
                    derived += [ctx.resolve('.video_agent/clip_verify'), ctx.resolve('out/creation/asr')]
                direct = input_paths(args, ctx)
                if handler.__name__ == 'video_generate':
                    direct.update(input_paths(_plan(args.get('shotlist_path') or 'out/creation/shotlist.json', ctx), ctx))
                derived_inputs = (protected - set(frozen)) | direct
                protect_directories(derived, derived_inputs)
                for derived_dir in derived:
                    if derived_dir.is_dir():
                        protect_outputs([p for p in derived_dir.rglob('*') if p.is_file() and p.resolve() not in frozen], derived_inputs | set(frozen))
                for derived_dir in derived:
                    if any(p.is_symlink() for p in (derived_dir, *derived_dir.parents)):
                        raise ValueError('derived output directory cannot be a symlink')
                owned += derived
                if handler.__name__ == 'creation_review' and args.get('action', 'prepare') == 'prepare':
                    owned.append(ctx.resolve(args.get('output_dir') or 'out/creation/review'))
                protect_outputs([p for p in owned if p.suffix and p.is_file()], input_paths({k:v for k,v in args.items() if k not in ('takes_path','verdicts_path')}, ctx))
                with ExitStack() as publication:
                    from .file_contract import frozen_outputs
                    publication.enter_context(frozen_outputs(frozen))
                    publication.enter_context(output_locks(ctx, outputs + owned))
                    # Generation keeps submitted ids even on failure. Local writes roll back on exceptions.
                    publication.enter_context(rollback_outputs([p for p in outputs if not p.is_dir()]))
                    if handler.__name__ not in ('video_generate', 'image_generate'):
                        publication.enter_context(rollback_outputs([p for p in owned if not p.is_dir() and p.suffix]))
                    result = handler(copy.deepcopy(args), ctx)
                file_lock.flock(stream.fileno(), file_lock.LOCK_UN)
            data = result.data
            if data.get('blocked') or data.get('failures') or data.get('aspect_mismatches'):
                result.is_error = True
            if data.get('shots') and any(row.get('ok') is False for row in data['shots'] if isinstance(row, dict)):
                result.is_error = True
            result.artifacts = [str(p) for p in result.artifacts]
            return result
        except (ValueError, OSError, RuntimeError, KeyError, TypeError, subprocess.SubprocessError) as exc:
            return ToolResult(text=str(exc), data={'ok': False, 'error': type(exc).__name__}, is_error=True)
    return run


def _style_plan(path, ctx):
    source = takes.read_object(ctx.resolve(path))
    plan, blockers, _ = style_policy.resolve_human_style(source)
    if blockers:
        raise ValueError("; ".join(blockers))
    if plan != source:
        takes.write_object(ctx.resolve(path), plan)
    return plan


def _plan(path, ctx):
    plan = nexus_visual_plan(_style_plan(path, ctx))
    if str(plan.get('schema_version')) not in ('2', '3', '4'):
        raise ValueError(f"creation requires an explicit v2/v3/v4 plan (shotlist schema_version is "
                         f"{plan.get('schema_version', 'missing')!r}); set schema_version to 2, 3 or 4")
    errors, _, _ = validate_plan(plan, ctx)
    if errors:
        raise ValueError('invalid creation plan: ' + '; '.join(errors[:8]))
    return plan


def _candidate(args, ctx):
    if not args.get('take_id'):
        raise ValueError('take_id is required for prepare/record')
    path = args.get('takes_path') or 'out/creation/clips/takes.json'
    candidate = takes.read_object(ctx.resolve(path)).get('takes', {}).get(args['take_id'], {})
    if candidate.get('status') != 'generated' or not candidate.get('clip'):
        raise ValueError('take_id does not identify a generated candidate')
    clip = ctx.resolve(candidate['clip'])
    if not clip.is_file() or file_digest(clip) != candidate.get('source_sha256'):
        raise ValueError('candidate bytes changed or are missing')
    plan_path = args.get('shotlist_path') or 'out/creation/shotlist.json'
    plan = _plan(plan_path, ctx)
    unit = next((u for u in (plan.get('sequences') or plan.get('shots') or [])
                 if str(u.get('sequence_id') or u.get('shot_id')) == candidate.get('shot_id')), None)
    if unit is None:
        raise ValueError('candidate logical unit is absent from the current plan')
    return candidate, plan, unit, plan_path, path


@_public
def creation_plan_validate(args, ctx):
    return production.validate_creation_plan(args, ctx)


def _adopt_legacy_image(book, book_path, item, default_background, output_dir, path, sig, args, ctx):
    """Before 2026-11-05 an output_name without a suffix was published bare ("feibi_sheet"); it is
    now published as "feibi_sheet.png". A resumed task asking for the same image again must reuse
    the file it already generated, not generate it twice: when the bare file is still bound to this exact
    request, write its bytes (encoded for the new suffix) under the new name and bind that. The bare
    file stays where it is, since scripts written earlier may still read it."""
    legacy = production.legacy_image_name(item, default_background)
    old = ctx.resolve(str(Path(output_dir) / legacy))
    if old == path or path.exists() or not old.is_file() or args.get('force'):
        return
    entry = book.get(str(old)) or {}
    if entry.get('signature') != sig or entry.get('source_sha256') != file_digest(old):
        return
    data = production.encode_for_suffix(old.read_bytes(), path.suffix)
    staged = path.with_name(f'.{path.name}.adopt')
    staged.write_bytes(data)
    staged.replace(path)
    book[str(path)] = {'signature': sig, 'source_sha256': file_digest(path), 'adopted_from': str(old)}
    takes.write_object(book_path, book)


@_public
def image_generate(args, ctx):
    plan_path = ctx.resolve('out/creation/shotlist.json')
    plan = _style_plan(plan_path, ctx) if plan_path.is_file() else {}
    resolution = plan.get('style_resolution')
    if isinstance(resolution, dict) and resolution.get('status') == '暂定' and (
            not args.get('style_preset') or production.photoreal_hits(args['style_preset'])):
        args['style_preset'] = plan['style_preset']
    book_path = ctx.resolve('.video_agent/image_requests.json')
    book = takes.read_object(book_path)
    output_dir = args.get('output_dir') or 'out/creation/images'
    signatures = {}
    default_background = str(args.get('background') or 'auto').strip().lower()
    for item in args.get('items') or []:
        name = item.get('output_name') or f"{item.get('kind') or 'keyframe'}_{item['id']}.png"
        if Path(name).name != name or name in ('', '.', '..'):
            raise ValueError('image output_name must be a filename within output_dir')
        if any(production._clean_name(v) != v for v in (name, item['id'])):
            # The generator strips control characters/outer spaces; the bound path must be the published path.
            raise ValueError('image id/output_name must not contain control characters or outer spaces')
        # Bind the path the generator will actually publish (transparent items snap to .png).
        name = production.planned_image_name(item, default_background)
        path = ctx.resolve(str(Path(output_dir) / name))
        if str(path) in signatures:
            raise ValueError('duplicate image output path in one batch')
        recipe = {'item': item, 'settings': {k:args.get(k) for k in ('size','orientation','style_preset')}}
        recipe['configured_model'] = production.IMAGE_GENERATOR_LABEL
        recipe['effective_style'] = production._style_preset(args.get('style_preset'))
        recipe['effective_size'] = production._size_tier(item.get('size') or args.get('size'))
        recipe['effective_orientation'] = args.get('orientation') or 'landscape'
        recipe['canvas_orientation'] = production._plan_canvas_orientation(ctx, args)
        recipe['effective_bible'] = production._plan_style_bible(ctx, args)
        plan_path = ctx.resolve('out/creation/shotlist.json')
        recipe['style_bible'] = takes.read_object(plan_path).get('style_bible') if plan_path.is_file() else None
        recipe['reference_hashes'] = {str(ctx.resolve(r if isinstance(r,str) else r['path'])):
            file_digest(ctx.resolve(r if isinstance(r,str) else r['path'])) for r in item.get('reference_images',[])}
        sig = digest(recipe)
        _adopt_legacy_image(book, book_path, item, default_background, output_dir, path, sig, args, ctx)
        previous = book.get(str(path), {})
        if path.is_file() and not args.get('force'):
            if previous.get('signature') != sig or previous.get('source_sha256') != file_digest(path):
                raise ValueError('image request/reference/content changed or untracked; choose a new output_name or explicit force')
        signatures[str(path)] = sig
    from .file_contract import input_paths
    dependencies = {p: file_digest(p) for p in input_paths(args, ctx)}
    plan_path = ctx.resolve(args.get('shotlist_path') or 'out/creation/shotlist.json')

    def plan_inputs():
        # An image reads the style bible and the canvas orientation from the plan (both are in
        # its recipe signature). Binding the whole file threw a finished batch away when
        # the agent wrote voice cards or dialogue into the plan while the images rendered.
        raw = takes.read_object(plan_path).get('style_bible') if plan_path.is_file() else None
        return (raw, production._plan_style_bible(ctx, args), production._plan_canvas_orientation(ctx, args))

    plan_before = plan_inputs()
    result = production.generate_images(args, ctx)
    if (any(not p.is_file() or file_digest(p) != sha for p, sha in dependencies.items())
            or plan_inputs() != plan_before):
        raise ValueError('image generation dependencies changed during execution; choose a new request')
    for row in result.data.get('items',[]):
        path = ctx.resolve(row['path'])
        if path.is_file():
            book[str(path)] = {'signature': signatures[str(path)], 'source_sha256': file_digest(path),
                               'kind': row.get('kind'), 'id': row.get('id')}
    takes.write_object(book_path, book)
    plan = nexus_visual_plan(takes.read_object(plan_path)) if plan_path.is_file() else {}
    targets = acceptance.generated_image_targets(plan, result.data.get('items') or [], ctx)
    return style_policy.annotate_result(
        acceptance.add_warnings(result, acceptance.image_review_warnings(plan, ctx, targets)), plan)


@_public
def image_crop(args, ctx):
    if ctx.resolve(args.get('source') or '') == ctx.resolve(args.get('output') or ''):
        raise ValueError('crop output must differ from its source')
    return production.crop_reference_image(args, ctx)


@_public
def video_generate(args, ctx):
    action = args.pop('action', 'generate')
    plan_path = args.get('shotlist_path') or 'out/creation/shotlist.json'
    plan = _plan(plan_path, ctx)
    prof = generators.plan_profile(plan)
    if args.get('model') and generators.profile(args['model'])['name'] != prof['name']:
        raise ValueError('request generator differs from the directing plan')
    args['model'] = prof['model']
    args['shotlist_path'] = plan_path
    args['ratio'] = generators.effective_ratio(plan, args.get('ratio'))
    caps = plan['budget']
    for key in ('max_total_generations', 'max_total_generated_seconds'):
        if key in args and args[key] != caps[key]:
            raise ValueError('request budget differs from the directing plan')
        args[key] = caps[key]
    if action == 'edit':
        takes.bind_project_budget(ctx, ctx.resolve(args.get('output_dir') or 'out/creation/clips'), caps)
        return style_policy.annotate_result(production.edit_video_candidate(args, ctx), plan)
    if action != 'generate':
        raise ValueError('action must be generate or edit')
    shots = args.get('shots')
    if not isinstance(shots, list) or not shots or any(not isinstance(u, dict) or not u.get('take_id') for u in shots):
        raise ValueError('every video candidate requires an immutable take_id')
    for u in shots:
        for ref in u.get('reference_images', []):
            if not ref.get('path') or str(ref['path']).startswith(('http://','https://','data:')):
                raise ValueError('versioned video references require local files; download remote assets first')
    ids = {str(u.get('sequence_id') or u.get('shot_id')) for u in (plan.get('sequences') or plan.get('shots') or [])}
    if any(u.get('bridge') for u in shots):
        raise ValueError('generated bridges are not in this public contract; select/edit reviewed candidates')
    if any(u.get('shot_id') not in ids for u in shots):
        raise ValueError('candidate shot_id must identify a logical plan unit')
    # T08: prepare plan keyframes here; an empty explicit reference_images list is not the
    # final visual set. The media layer checks the actual payload after reference_take_id
    # and continuity_from are resolved too, using this plan's format from shotlist_path.
    units = {str(u.get('sequence_id') or u.get('shot_id')): u for u in (plan.get('sequences') or plan.get('shots') or [])}
    for request in shots:
        unit = units[request['shot_id']]
        if 'keyframes' not in request:
            request['keyframes'] = copy.deepcopy(unit.get('keyframes') or [])
        refs = shot_review_context(plan, units[request['shot_id']], ctx)['reference_files']
        if any(sha is None for sha in refs.values()):
            raise ValueError('referenced character/scene/prop/voice files must exist before generation')
    takes.bind_project_budget(ctx, ctx.resolve(args.get('output_dir') or 'out/creation/clips'), caps)
    reminders = native_audio_warnings([units[u['shot_id']] for u in shots], args)
    targets = acceptance.plan_image_targets(plan, ctx, [units[u['shot_id']] for u in shots])
    for request in shots:
        for frame in request.get('keyframes') or []:
            path = acceptance._image_path(frame, ctx)
            if path is not None:
                targets[str(path)] = 'keyframe'
    reminders += acceptance.image_review_warnings(plan, ctx, targets)
    reminders += acceptance.repeated_prop_warnings(plan, evidence.load_ledger(ctx))
    return style_policy.annotate_result(
        acceptance.add_warnings(production.generate_video_candidates(args, ctx), reminders), plan)


@_public
def creation_verify(args, ctx):
    action = args.pop('action', 'prepare')
    if action in ('image_prepare', 'image_record'):
        plan = _plan(args.get('shotlist_path') or 'out/creation/shotlist.json', ctx)
        return acceptance.review_image(dict(args, action=action), ctx, plan)
    if action == 'status':
        return evidence.creation_evidence_status({}, ctx)
    if action == 'speech':
        _plan(args.get('shotlist_path') or 'out/creation/shotlist.json', ctx)
        result = takes.creation_evidence_clips(args, ctx)
        result.data['acceptance'] = 'automatic hints; candidate visual/audio review is still required'
        return result
    if action == 'voices':
        _plan(args.get('shotlist_path') or 'out/creation/shotlist.json', ctx)
        result = evidence.collect_voice_consistency(args, ctx)
        result.data['acceptance'] = 'heuristic evidence; listen before deciding speaker identity'
        return result
    if action not in ('prepare', 'record'):
        raise ValueError('invalid creation_verify action')
    candidate, plan, unit, plan_path, takes_path = _candidate(args, ctx)
    tid = args['take_id']
    for raw, sha in {**candidate.get('reference_files', {}), **candidate.get('submitted_reference_sha256', {})}.items():
        if not ctx.resolve(raw).is_file() or file_digest(ctx.resolve(raw)) != sha:
            raise ValueError('generation reference changed; restore original bytes or use a new take')
    plan_hash = shot_plan_digest(plan, unit, ctx)
    plan_bytes = file_digest(ctx.resolve(plan_path))
    source_hash = candidate['source_sha256']
    generation_context = candidate.get('plan_unit_sha256')
    reassessment = bool(generation_context and generation_context != plan_hash)
    if reassessment and action == 'prepare' and not args.get('reassess'):
        raise ValueError('directing context changed; use reassess=true to review old footage against the new plan')
    if action == 'prepare':
        previous = evidence.load_ledger(ctx).get(tid, {})
        revision = int(previous.get('review_revision') or 0) + 1
        # A revision directory without a ledger revision is an abandoned attempt (failed or
        # rolled back). Its leftover audio must never be bound as this revision's evidence.
        stale_dir = ctx.resolve(f'out/creation/verify/{tid}/revision-{revision}')
        if stale_dir.is_symlink():
            raise ValueError('review revision directory cannot be a symlink')
        if stale_dir.is_dir():
            import shutil
            shutil.rmtree(stale_dir)
        prepared = dict(args, shot_id=candidate['shot_id'], evidence_id=tid, clip=candidate['clip'], _review_revision=revision)
        result = evidence.prepare_clip_evidence(prepared, ctx)
        if result.failed:
            return result
        if file_digest(ctx.resolve(candidate['clip'])) != source_hash or file_digest(ctx.resolve(plan_path)) != plan_bytes or shot_plan_digest(_plan(plan_path, ctx), unit, ctx) != plan_hash:
            raise ValueError('creation inputs changed during evidence extraction')
        ledger = evidence.load_ledger(ctx)
        entry = ledger[tid]
        entry.update(review_revision=revision, reassessment=reassessment, generation_request_sha256=candidate.get('request_sha256'), generation_plan_sha256=generation_context, take_id=tid, shot_id=candidate['shot_id'], source_sha256=source_hash,
                     shot_plan_sha256=plan_hash, shotlist_path=plan_path, takes_path=takes_path,
                     grid_sha256={g: file_digest(ctx.resolve(g)) for g in entry['grids']})
        revision_dir = ctx.resolve(f'out/creation/verify/{tid}/revision-{revision}')
        entry['evidence_audio_sha256'] = {str(p): file_digest(p) for p in revision_dir.glob('*.wav')}
        entry['evidence_signature'] = digest(entry)
        evidence.save_ledger(ctx, ledger)
        result.data.update(review_revision=revision, reassessment=reassessment, generation_request_sha256=candidate.get('request_sha256'), take_id=tid, evidence_signature=entry['evidence_signature'],
                           source_sha256=source_hash, shot_plan_sha256=plan_hash)
        takes.write_object(ctx.resolve(f'out/creation/verify/{tid}/revision-{revision}/evidence.json'), result.data)
        return result
    ledger = evidence.load_ledger(ctx)
    entry = ledger.get(tid, {})
    if not args.get('evidence_signature') or args['evidence_signature'] != entry.get('evidence_signature'):
        raise ValueError('record requires the current evidence_signature returned by prepare')
    canonical = dict(entry)
    canonical.pop('evidence_signature', None)
    if digest(canonical) != entry.get('evidence_signature'):
        raise ValueError('pending evidence ledger changed; prepare again')
    if entry.get('source_sha256') != source_hash or entry.get('shot_plan_sha256') != plan_hash:
        raise ValueError('candidate or directing/reference context changed; prepare again')
    for path, sha in {**entry.get('grid_sha256', {}), **entry.get('evidence_audio_sha256', {})}.items():
        if not ctx.resolve(path).is_file() or file_digest(ctx.resolve(path)) != sha:
            raise ValueError('evidence images changed; prepare again')
    performance = args.get('performance')
    if not isinstance(performance, dict) or any(performance.get(k) not in ('pass','fail','uncertain','not_applicable')
            for k in ('required_visuals','causality','intended_effect')):
        raise ValueError('performance must assess required_visuals, causality and intended_effect')
    if args.get('overall') in ('pass','mute_audio') and any(v != 'pass' for v in performance.values()):
        raise ValueError('passing candidate requires passing performance checks')
    if len(str(args.get('notes') or '').strip()) < 20:
        raise ValueError('notes must describe observed/heard evidence (at least 20 characters)')
    spans = args.get('usable_spans') or []
    if args.get('overall') in ('pass','mute_audio') and not spans:
        raise ValueError('passing candidate requires usable_spans')
    duration = entry['objective'].get('duration_s')
    for span in spans:
        a,b = number(span.get('start')),number(span.get('end'))
        if a is None or b is None or duration is None or not 0 <= a < b <= duration + 1e-6:
            raise ValueError('usable_spans must lie within the measured candidate')
    revision_file = ctx.resolve(f"out/creation/reviews/{tid}/revision-{entry['review_revision']}.json")
    if revision_file.exists():
        raise ValueError('review revision already exists; prepare a new revision')
    result = evidence.record_clip_verdict(dict(args, shot_id=tid), ctx)
    if result.failed:
        return result
    ledger = evidence.load_ledger(ctx)
    ledger[tid].update(performance=performance, usable_spans=spans)
    frozen = copy.deepcopy(ledger[tid])
    frozen.pop('verdict_signature', None)
    ledger[tid]['verdict_signature'] = digest(frozen)
    revision_file = ctx.resolve(f"out/creation/reviews/{tid}/revision-{ledger[tid]['review_revision']}.json")
    if revision_file.exists():
        raise ValueError('review revision already exists; prepare a new revision')
    result.data['entry'] = ledger[tid]
    result.data['needs_repair'] = ledger[tid]['status'] not in ('pass','mute_audio')
    # Publish the same versioned verdict contract consumed by assembly.
    from .file_contract import publish_files
    import json
    encode = lambda value: json.dumps(value, ensure_ascii=False, indent=2).encode()
    publish_files({revision_file: encode(ledger[tid]), ctx.resolve(evidence.LEDGER_REL): encode(ledger), ctx.resolve('out/creation/verdicts.json'): encode({'takes': ledger})})
    return acceptance.add_warnings(result, acceptance.repeated_prop_warnings(plan, ledger))


@_public
def creation_timeline_build(args, ctx):
    if not args.get('shotlist_path'):
        args['shotlist_path'] = 'out/creation/shotlist.json'
    plan = _plan(args['shotlist_path'], ctx)
    if not args.get('shots') or any(not s.get('take_id') for s in args['shots']):
        raise ValueError('assembly requires versioned take_id on every selected span')
    args.setdefault('verdicts_path', 'out/creation/verdicts.json')
    args.setdefault('canvas', plan.get('canvas', {}))
    args['probe_durations'] = True
    takes_path = args.get('takes_path') or 'out/creation/clips/takes.json'
    bindings = {str(ctx.resolve(p)): file_digest(ctx.resolve(p)) for p in (args['shotlist_path'], args['verdicts_path'], takes_path)}
    candidates = takes.read_object(ctx.resolve(takes_path)).get('takes', {})
    units = {str(u.get('sequence_id') or u.get('shot_id')): u for u in plan.get('sequences') or plan.get('shots') or []}
    targets = acceptance.candidate_image_targets(plan, ctx,
        [units.get(s.get('shot_id'), {}) for s in args['shots']],
        [candidates.get(s['take_id'], {}) for s in args['shots']])
    image_reminders = acceptance.image_review_warnings(plan, ctx, targets)
    for shot in args['shots']:
        path = ctx.resolve(shot.get('clip') or shot.get('source') or '')
        bindings[str(path)] = file_digest(path)
        # Same rule as prepare/record: changed generation reference bytes invalidate the
        # candidate's review; restore the original file or select a new take.
        candidate = candidates.get(shot['take_id']) if isinstance(candidates, dict) else None
        if isinstance(candidate, dict):
            for raw, sha in {**candidate.get('reference_files', {}), **candidate.get('submitted_reference_sha256', {})}.items():
                reference = ctx.resolve(raw)
                if not reference.is_file() or file_digest(reference) != sha:
                    raise ValueError(f"{shot['take_id']}: generation reference changed; restore original bytes or use a new take")
                bindings[str(reference)] = sha
    # Write to a distinct candidate file; validate before replacing the requested output.
    target = ctx.resolve(args.get('output_json') or 'out/timeline.json')
    stage = target.with_name(target.name + '.creation-stage.json')
    from .file_contract import protect_outputs
    protect_outputs([target, stage], bindings)
    args['output_json'] = str(stage)
    try:
        result = production.build_creation_timeline(args, ctx)
        acceptance.add_warnings(result, image_reminders)
        result.data['image_review_status'] = 'needs_review' if image_reminders else 'confirmed'
        from . import timeline
        import tempfile
        with tempfile.TemporaryDirectory(prefix='creation-validate-') as check_dir:
            validated = timeline.validate_timeline({'timeline_path': str(stage), 'output_json': str(Path(check_dir) / 'report.json')}, ctx)
        if validated.failed or validated.data.get('status') != 'pass':
            raise ValueError('assembled timeline invalid: ' + validated.text)
        if any(file_digest(Path(p)) != sha for p, sha in bindings.items()):
            raise ValueError('creation inputs changed during assembly')
        stage.replace(target)
        result.data['timeline_path'] = ctx.virtualize(target)
        result.artifacts = [str(target)]
        # T22: 原子发布内容寻址的 build manifest(永久证明),并记录材料完整性三态。
        from . import build_provenance
        materials = build_provenance.material_completeness(
            ctx, plan=plan, candidates=candidates, shots=args['shots'])
        manifest_path, manifest_sha = build_provenance.write_build_manifest(
            ctx, timeline_path=target, args=args, bindings=bindings, shots=args['shots'],
            plan_path=str(args['shotlist_path']), verdicts_path=str(args.get('verdicts_path')),
            takes_path=str(takes_path), materials_status=materials)
        result.data['build_manifest'] = ctx.virtualize(manifest_path)
        result.data['build_manifest_sha256'] = manifest_sha
        result.data['materials_status'] = materials['status']
        if materials['status'] != 'complete':
            result.data.setdefault('warnings', []).append(
                "T22 材料完整性 " + materials['status'] + ": " + "; ".join(materials['missing'][:5]))
        notes = (result.data.get('warnings') or []) if isinstance(result.data, dict) else []
        result.text = 'Creation timeline built; next use timeline_validate, video_render and video_qc.' + (
            '\nWarnings:\n' + '\n'.join(f'- {w}' for w in notes[:20]) if notes else '')
        return style_policy.annotate_result(result, plan)
    finally:
        stage.unlink(missing_ok=True)


@_public
def creation_review(args, ctx):
    action = args.pop('action', 'prepare')
    if action == 'prepare':
        return review.creation_review_package(args, ctx)
    if action == 'validate':
        return review.creation_review_validate(args, ctx)
    raise ValueError('creation_review action must be prepare or validate')


@_public
def voice_compare(args, ctx):
    return audio_identity.voice_similarity(args, ctx)
