"""3D assets: images to a textured model, automatic rigging, preset animations.

`model3d_generate` drives the ZCode 3D generator (ToolHub; the signed-in ZCode
account, no key): upload the reference images, create a task, poll it, download the result.
It follows the conventions of the other generators in this package:

- every action carries an Idempotency-Key; the key and the exact request body are recorded
  before submission, so an interrupted submission is replayed with the SAME key (the
  generator returns the original task id) instead of creating a second task; status reads go to
  the generic ``tasks/query`` endpoint and carry no key (not recorded);
- the task id is recorded right after creation, so repeating the call collects the same task
  (after a timeout, a cancelled job or a failed download) instead of creating a new one;
- an identical request reuses its finished files; a different request under the same
  ``output_name`` is refused unless ``force`` is set;
- usage per project is kept in ``.video_agent/model3d_usage.json``; once it reaches the
  project limit (``VE_MODEL3D_USAGE_CAP``, default 1000) new tasks are refused before anything is
  uploaded or submitted. The usage comes from the generator's task status.
"""
from __future__ import annotations

from ve_tools import file_lock
import os
import tempfile
import time
from contextlib import contextmanager
from functools import wraps
from pathlib import Path

from .creation_media import _DIRECT
from .creation_planning import digest, file_digest
from .creation_takes import read_object, write_object
from .model3d_schemas import (BIPED_ANIMATIONS, BODY_ANIMATIONS, COMMON_FIELDS, OPERATION_FIELDS,
                              TOOL_SCHEMAS, VIEWS)
from .result import ToolResult
from .run_context import RunContext, clean_env

DEFAULT_CAP = 1000.0
REQUESTS_REL = '.video_agent/model3d_requests.json'
USAGE_REL = '.video_agent/model3d_usage.json'
LEGACY_USAGE_REL = '.video_agent/model3d_credits.json'   # read once, then superseded
LOCK_REL = '.video_agent/model3d.lock'
OUTPUT_ROOT = 'out/model3d'
IMAGE_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp'}
MAX_IMAGE_BYTES = 20 * 1024 * 1024
FAILED = frozenset({'failed', 'cancelled', 'banned', 'expired'})
# tasks/query reports failure.code as <PROVIDER>_TASK_<STATE>; only the TASK_<STATE> part is
# read and kept, so the provider prefix never reaches the ledger or the agent.
FAILURE_STATES = {'TASK_FAILED': 'failed', 'TASK_CANCELLED': 'cancelled',
                  'TASK_BANNED': 'banned', 'TASK_EXPIRED': 'expired'}


def _failure_code(code: object) -> str:
    """'<PROVIDER>_TASK_FAILED' -> 'TASK_FAILED'; other codes unchanged."""
    text = str(code or '')
    head, sep, tail = text.partition('_TASK_')
    return f'TASK_{tail}' if sep and head else text
ACTIVE = frozenset({'submitted', 'running', 'completed'})
# Creation errors whose outcome is unknown: the task may exist.
UNKNOWN_KINDS = frozenset({'transport', 'provider_error'})
MODEL_KEYS = ('model_url', 'pbr_model_url', 'base_model_url', 'model', 'pbr_model', 'base_model')
PREVIEW_KEYS = ('rendered_image_url', 'rendered_image', 'preview_url', 'generated_image_url')
SUBMIT_REPLAYS = 3          # UNKNOWN / CALLING / lost response: replay the SAME key
SUBMIT_REPLAY_DELAY_SECONDS = 5.0


class Model3DError(RuntimeError):
    """A failure with a stable kind for ``data.error`` (usage_limit, account_limit, ...)."""

    def __init__(self, message: str, kind: str = 'error', **extra):
        super().__init__(message)
        self.kind = kind
        self.extra = extra


# ------------------------------------------------------------------ generator api (ToolHub)
def _from_toolhub(exc) -> Model3DError:
    """Map a ToolHubError: transient failures leave a submission's outcome unknown."""
    code, text = exc.code, str(exc)[:500]
    if exc.detail.get('auth_error') or code is None and 'identity' in text:
        return Model3DError(f'the ZCode identity is unavailable for the 3D generator: {text}', 'auth')
    if code == 3706:
        return Model3DError(f'this ZCode account cannot use the 3D generator: {text}', 'auth')
    if code in (3701, 3705):
        return Model3DError(f'the 3D generator is not available for this account here: {text}', 'not_configured')
    if code == 3704:
        return Model3DError(f'3D task not found: {text}', 'not_found')
    if code == 3703:
        lowered = text.lower()
        if 'credit' in lowered or '额度' in text or 'balance' in lowered:
            return Model3DError('the 3D service refused this account for now; stop making 3D assets and '
                                'report it', 'account_limit')
        return Model3DError(f'the 3D generator refused the request: {text}', 'invalid_request')
    if code == 3001:
        return Model3DError(f'the 3D generator rejected the request: {text}', 'invalid_request')
    if exc.retry_same_key:
        return Model3DError(f'3D generator request failed: {text}', 'transport')
    return Model3DError(f'3D generator request failed: {text}', 'provider_error')


class _Api:
    def __init__(self):
        from . import toolhub
        state = toolhub.status()
        if not state['available']:
            raise Model3DError('3D generation is unavailable: ' + '; '.join(state['reasons']), 'not_configured')

    @staticmethod
    def get(task_id: str) -> dict:
        """One status read through ``tasks/query`` (no Idempotency-Key).

        Returns the task's ``output`` with ``status='success'`` once it succeeded; a failed task
        as ``{'status': <failed|cancelled|banned|expired>, 'error_message', 'failure'}``; anything
        else as ``{'status': 'queued'|'running'}`` (unknown states count as running, and running
        tasks carry no output, so there is no progress figure).
        """
        from . import toolhub
        try:
            data, _ = toolhub.invoke_with_retries(toolhub.PATH_MODEL3D_QUERY, json_body={'task_id': task_id},
                                                  timeout_seconds=toolhub.QUERY_TIMEOUT_SECONDS)
        except toolhub.ToolHubError as exc:
            if exc.retry_same_key:
                return {'status': 'running'}           # transient upstream fault: keep polling
            raise _from_toolhub(exc) from exc
        status = str(data.get('status') or '').lower()
        if status == 'succeeded':
            output = data.get('output')
            if not isinstance(output, dict):
                raise Model3DError('3D task succeeded but its status carries no output', 'provider_error')
            return {**output, 'status': 'success'}
        if status == 'failed':
            failure = data.get('failure') if isinstance(data.get('failure'), dict) else {}
            failure = {**failure, 'code': _failure_code(failure.get('code'))}
            state = FAILURE_STATES.get(failure['code'], 'failed')
            return {'status': state, 'error_message': str(failure.get('message') or failure.get('code') or ''),
                    'failure': failure}
        return {'status': status if status == 'queued' else 'running'}

    @staticmethod
    def create(body: dict, key: str) -> str:
        """Create a task with ``key``; replays the same key until the task id is known."""
        from . import toolhub
        last = None
        for attempt in range(SUBMIT_REPLAYS + 1):
            if attempt:
                time.sleep(SUBMIT_REPLAY_DELAY_SECONDS)
            try:
                data, meta = toolhub.invoke_with_retries(toolhub.PATH_MODEL3D, json_body=body, idempotency_key=key,
                                                         timeout_seconds=toolhub.SUBMIT_TIMEOUT_SECONDS)
            except toolhub.ToolHubError as exc:
                error = _from_toolhub(exc)
                if error.kind == 'transport' and attempt < SUBMIT_REPLAYS:
                    last = str(exc)
                    continue
                raise error from exc
            output = data.get('output') if isinstance(data.get('output'), dict) else {}
            task_id = output.get('task_id') or (data.get('upstream_req_id') if data.get('replayed') else None)
            if data.get('state') == 'SUCCEEDED' and task_id:
                return str(task_id)
            last = f"state {data.get('state')!r} (logid {meta.get('logid')})"
        raise Model3DError(f'3D submission outcome unknown after same-key replays ({last})', 'transport')

    @staticmethod
    def upload(path: Path) -> str:
        """Local reference image -> public https URL (png/jpeg/webp up to 10 MiB; larger is re-encoded)."""
        from . import toolhub
        source, staged = path, None
        if path.stat().st_size > toolhub.MAX_UPLOAD_BYTES:
            from PIL import Image
            fd, raw = tempfile.mkstemp(prefix='m3d-ref-', suffix='.jpg', dir=str(path.parent))
            os.close(fd)
            staged = Path(raw)
            with Image.open(path) as im:
                im.convert('RGB').save(staged, format='JPEG', quality=90)
            source = staged
        try:
            url, _ = toolhub.upload_file(source)
        except toolhub.ToolHubError as exc:
            raise _from_toolhub(exc) from exc
        finally:
            if staged is not None:
                staged.unlink(missing_ok=True)
        return url


def _wait(api: _Api, task_id: str, timeout: float, interval: float) -> dict:
    deadline = time.monotonic() + timeout
    while True:
        data = api.get(task_id)
        status = str(data.get('status') or '').lower()
        if status == 'success' or status in FAILED:
            return data
        if time.monotonic() >= deadline:
            raise Model3DError(f'task still {status or "pending"} after {timeout:g}s', 'timeout')
        time.sleep(interval)


def _units(data: dict) -> float | None:
    # usage as the task status reports it (wire field names)
    for key in ('credits_consumed', 'consumed_credit', 'credits'):
        value = data.get(key)
        if value is not None and not isinstance(value, bool):
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
    return None


# ------------------------------------------------------------------ downloads
def _kind_ok(kind: str, head: bytes) -> str | None:
    """File suffix for verified content of the expected kind, else None."""
    if kind == 'glb':
        return '.glb' if head[:4] == b'glTF' else None
    if head.startswith(b'\x89PNG'):
        return '.png'
    if head[:3] == b'\xff\xd8\xff':
        return '.jpg'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return '.webp'
    return None


def _download(url: str, directory: Path, stem: str, kind: str) -> Path:
    """Stream to a temporary file, verify length and content type, then publish atomically.
    No identity headers: the files live on the generator's own storage (links expire in minutes)."""
    directory.mkdir(parents=True, exist_ok=True)
    fd, raw = tempfile.mkstemp(prefix='.download-', dir=directory)
    os.close(fd)
    part = Path(raw)
    try:
        with _DIRECT.get(url, timeout=(30, 120), stream=True) as resp:
            resp.raise_for_status()
            expected = int(resp.headers.get('Content-Length') or 0)
            with part.open('wb') as stream:
                for chunk in resp.iter_content(1 << 20):
                    stream.write(chunk)
        size = part.stat().st_size
        if not size or (expected and size != expected):
            raise Model3DError(f'download truncated at {size}/{expected} bytes', 'download_failed')
        with part.open('rb') as stream:
            suffix = _kind_ok(kind, stream.read(64))
        if suffix is None:
            raise Model3DError(f'downloaded file is not a {kind} file', 'download_failed')
        target = directory / f'{stem}{suffix}'
        part.replace(target)
        return target
    except Model3DError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise Model3DError(f'download failed: {str(exc)[:200]}', 'download_failed') from exc
    finally:
        part.unlink(missing_ok=True)


def _first(output: dict, keys) -> str | None:
    for key in keys:
        value = output.get(key)
        if isinstance(value, str) and value.startswith('https://'):
            return value
    return None


# ------------------------------------------------------------------ ledgers
@contextmanager
def _locked(ctx: RunContext):
    path = ctx.resolve(LOCK_REL)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a') as stream:
        file_lock.flock(stream.fileno(), file_lock.LOCK_EX)
        try:
            yield
        finally:
            file_lock.flock(stream.fileno(), file_lock.LOCK_UN)


def _requests(ctx: RunContext) -> dict:
    return read_object(ctx.resolve(REQUESTS_REL))


def _save_record(ctx: RunContext, name: str, record: dict | None) -> None:
    with _locked(ctx):
        path = ctx.resolve(REQUESTS_REL)
        ledger = read_object(path)
        if record is None:
            ledger.pop(name, None)
        else:
            ledger[name] = record
        write_object(path, ledger)


def _cap() -> float:
    try:
        value = float(clean_env('VE_MODEL3D_USAGE_CAP') or clean_env('VE_MODEL3D_CREDIT_CAP') or DEFAULT_CAP)
    except ValueError:
        return DEFAULT_CAP
    return value if value >= 0 else DEFAULT_CAP


def _row_units(row: dict) -> float | None:
    value = row.get('units', row.get('credits'))          # 'credits' = rows written by older versions
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def _usage_calls(ctx: RunContext) -> list[dict]:
    path = ctx.resolve(USAGE_REL)
    source = path if path.is_file() else ctx.resolve(LEGACY_USAGE_REL)
    calls = [c for c in read_object(source).get('calls') or [] if isinstance(c, dict)]
    for row in calls:
        if 'credits' in row:
            row['units'] = _row_units(row)
            row.pop('credits', None)
    return calls


def _spent(ctx: RunContext) -> float:
    return sum(_row_units(c) or 0.0 for c in _usage_calls(ctx))


def _charge(ctx: RunContext, task_id: str, operation: str, name: str, units: float | None, status: str) -> float:
    """Record a finished task's usage once per task id; returns the project total."""
    with _locked(ctx):
        calls = _usage_calls(ctx)
        row = next((c for c in calls if c.get('task_id') == task_id), None)
        if row is None:
            row = {'task_id': task_id}
            calls.append(row)
        row.update(operation=operation, output_name=name, units=units, status=status,
                   ts=time.strftime('%Y-%m-%dT%H:%M:%S'))
        spent = sum(_row_units(c) or 0.0 for c in calls)
        write_object(ctx.resolve(USAGE_REL), {'cap': _cap(), 'used': spent, 'calls': calls})
        return spent


# ------------------------------------------------------------------ request plans
def _input_image(ctx: RunContext, raw: str) -> Path:
    path = ctx.resolve(raw)
    if not path.is_file():
        raise ValueError(f'image not found: {raw}')
    if path.suffix.lower() not in IMAGE_SUFFIXES:
        raise ValueError(f'image must be PNG, JPEG or WebP: {raw}')
    if path.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError(f'image larger than 20 MB: {raw}')
    return path


def _finished(ledger: dict, name: str, operation: str) -> dict | None:
    record = ledger.get(name)
    if not isinstance(record, dict):
        return None
    if record.get('operation') != operation or record.get('status') != 'success' or not record.get('task_id'):
        raise ValueError(f'source {name!r} is not a finished {operation} step '
                         f'(it is {record.get("operation")}, {record.get("status")})')
    return record


def _plan_generate(args: dict, ctx: RunContext, ledger: dict) -> dict:
    given = [k for k in ('views', 'image') if args.get(k) is not None]
    if len(given) != 1:
        raise ValueError('operation=generate takes exactly one of views or image')
    if args.get('views'):
        missing = [v for v in VIEWS if v not in args['views']]
        if missing:
            raise ValueError(f'views needs all four of {", ".join(VIEWS)} (missing {", ".join(missing)}); '
                             'or pass a single image')
        files = {v: _input_image(ctx, args['views'][v]) for v in VIEWS}
    else:
        files = {'image': _input_image(ctx, args['image'])}
    recipe = {'operation': 'generate', 'inputs': {k: file_digest(p) for k, p in files.items()}}

    def submit(api: _Api):
        # Four images go in front, left, back, right order (multiview); one image is image-to-model.
        return {'action': 'generate', 'images': [api.upload(files[k]) for k in files]}, {}

    return {'recipe': recipe, 'submit': submit, 'format': 'glb',
            'inputs': {k: ctx.virtualize(p) for k, p in files.items()}, 'params': {}}


def _plan_rig(args: dict, ctx: RunContext, ledger: dict) -> dict:
    raw = args['source']
    rig_type = args.get('rig_type', 'auto')
    if raw not in ledger:
        names = sorted(n for n, r in ledger.items() if isinstance(r, dict) and r.get('operation') == 'generate')
        raise ValueError(f'source {raw!r} is not a generate output_name {names}')
    upstream = _finished(ledger, raw, 'generate')
    source = {'output_name': raw, 'task_id': upstream['task_id'], 'model_sha256': upstream['files']['model']['sha256']}
    recipe = {'operation': 'rig', 'source': source, 'rig_type': rig_type}

    def submit(api: _Api):
        kind = rig_type
        if kind == 'auto':
            # Riggability check: stop before the rig task when the model cannot be rigged.
            from . import toolhub
            check_id = api.create({'action': 'rig_check', 'task_id': upstream['task_id']},
                                  toolhub.new_idempotency_key())
            check = _wait(api, check_id, float(args.get('timeout_seconds') or 3000),
                          float(args.get('poll_interval_seconds') or 5))
            if str(check.get('status')).lower() != 'success':
                raise Model3DError(f'riggability check ended {check.get("status")}', 'task_failed')
            if not check.get('riggable'):
                raise Model3DError('the model cannot be rigged (riggability check); no rig task was created. '
                                   'Regenerate it in a clear T-pose or A-pose', 'not_riggable')
            kind = str(check.get('rig_type') or 'biped')
        return {'action': 'rig', 'task_id': upstream['task_id'], 'rig_type': kind}, {'rig_type': kind}

    return {'recipe': recipe, 'submit': submit, 'format': 'glb', 'inputs': {'source': raw},
            'params': {'rig_type': rig_type}}


def _plan_animate(args: dict, ctx: RunContext, ledger: dict) -> dict:
    raw = args['source']
    if raw not in ledger:
        names = sorted(n for n, r in ledger.items() if isinstance(r, dict) and r.get('operation') == 'rig')
        raise ValueError(f'source {raw!r} is not a rig output_name {names}')
    rig = _finished(ledger, raw, 'rig')
    rig_type = rig.get('rig_type') or 'biped'
    allowed = BIPED_ANIMATIONS if rig_type == 'biped' else BODY_ANIMATIONS.get(rig_type, ())
    animations = list(args['animations'])
    wrong = [a for a in animations if a not in allowed]
    if wrong:
        raise ValueError(f'a {rig_type} rig cannot take {wrong}; allowed: {list(allowed) or "none"}')
    recipe = {'operation': 'animate', 'source': {'output_name': raw, 'task_id': rig['task_id'],
                                                 'model_sha256': rig['files']['model']['sha256']},
              'animations': animations}

    def submit(api: _Api):
        return ({'action': 'animate', 'task_id': rig['task_id'], 'animations': [f'preset:{a}' for a in animations]},
                {'rig_type': rig_type, 'animations': animations})

    return {'recipe': recipe, 'submit': submit, 'format': 'glb', 'inputs': {'source': raw},
            'params': {'animations': animations}}


PLANNERS = {'generate': _plan_generate, 'rig': _plan_rig, 'animate': _plan_animate}


# ------------------------------------------------------------------ debug mode: seeded products
def _seed() -> tuple[Path, dict] | None:
    """(seed root, manifest['seed']) when the pipeline froze generation calls for this stage
    (VE_PAID_ASSETS=frozen, VE_ASSET_SEED=<mount>, 'model3d' in VE_ASSET_SEED_STAGES); else None."""
    if (clean_env('VE_PAID_ASSETS') or '').strip().lower() != 'frozen':
        return None
    root = clean_env('VE_ASSET_SEED')
    stages = {s.strip() for s in (clean_env('VE_ASSET_SEED_STAGES') or '').split(',') if s.strip()}
    if not root or 'model3d' not in stages:
        return None
    manifest = read_object(Path(root) / 'manifest.json')
    return Path(root), dict((manifest or {}).get('seed') or {})


def _frozen(ctx: RunContext, args: dict, plan: dict, signature: str, seeded: tuple[Path, dict]) -> ToolResult:
    """Serve the seeded product for this operation under the requested output_name: copy the files,
    write a ledger record (so identical repeats reuse and the audit's sha check passes), create
    no task. The request is answered as if generated; the result data carries frozen=True."""
    import shutil
    root, seed = seeded
    operation, name = args['operation'], args['output_name']
    seed_name = (seed.get('model3d') or {}).get(operation)
    if not seed_name:
        raise Model3DError(f'debug mode (frozen assets): the seed has no {operation} product, nothing is generated',
                           'frozen_assets')
    entry = read_object(root / REQUESTS_REL).get(seed_name)
    if not isinstance(entry, dict) or entry.get('status') != 'success' or not entry.get('files'):
        raise Model3DError(f'debug mode (frozen assets): seed entry {seed_name!r} is not a finished {operation}',
                           'frozen_assets')
    if operation == 'animate':
        have = set(entry.get('animations') or (entry.get('params') or {}).get('animations') or [])
        missing = sorted(set(args['animations']) - have)
        if missing:
            raise Model3DError(f'debug mode (frozen assets): the seeded animation has {sorted(have)}; '
                               f'{missing} are not available, request a subset of the seeded ones', 'frozen_assets')
    src = root / OUTPUT_ROOT / seed_name
    dst = ctx.resolve(f'{OUTPUT_ROOT}/{name}')
    dst.mkdir(parents=True, exist_ok=True)
    model_name = Path(entry['files']['model']['path']).name
    for f in src.iterdir():
        if f.is_file():
            shutil.copy2(f, dst / f.name)
    model = dst / model_name
    if not model.is_file():
        raise Model3DError(f'debug mode (frozen assets): seed product {seed_name!r} has no model file', 'frozen_assets')
    task_json = dst / 'task.json'
    task = read_object(task_json) if task_json.is_file() else {}
    task.update(output_name=name, frozen_from=seed_name, debug_mode='frozen_assets')
    task.pop('credits_consumed', None)
    write_object(task_json, task)
    files = {'model': {'path': ctx.virtualize(model), 'sha256': file_digest(model)},
             'task': {'path': ctx.virtualize(task_json), 'sha256': file_digest(task_json)}}
    preview = dst / 'preview.png'
    if preview.is_file():
        files['preview'] = {'path': ctx.virtualize(preview), 'sha256': file_digest(preview)}
    carried = {k: entry[k] for k in ('endpoint', 'format', 'rig_type', 'animations', 'text') if k in entry}
    record = {**carried, 'operation': operation, 'output_name': name, 'signature': signature, 'status': 'success',
              'task_id': entry.get('task_id'), 'inputs': plan['inputs'], 'params': plan['params'],
              'files': files, 'units': 0.0, 'frozen_from': seed_name, 'seed_units': entry.get('units', entry.get('credits')),
              'submitted_at': time.strftime('%Y-%m-%dT%H:%M:%S'), 'finished_at': time.strftime('%Y-%m-%dT%H:%M:%S')}
    _save_record(ctx, name, record)
    result = _result(ctx, record, reused=True)
    result.data['frozen'] = True
    result.data['seed_product'] = seed_name
    result.text += ' (debug mode: seeded product, no task created)'
    return result


# ------------------------------------------------------------------ tool
def _public(handler):
    @wraps(handler)
    def run(args, ctx):
        import jsonschema
        operation = args.get('operation')
        if operation in OPERATION_FIELDS:
            foreign = sorted(set(args) - COMMON_FIELDS - OPERATION_FIELDS[operation])
            if foreign:
                return ToolResult(f'operation={operation} does not take: {", ".join(foreign)}',
                                  data={'ok': False, 'error': 'invalid_arguments'}, is_error=True)
            missing = [k for k in {'rig': ['source'], 'animate': ['source', 'animations']}.get(operation, [])
                       if args.get(k) is None]
            if missing:
                return ToolResult(f'operation={operation} requires: {", ".join(missing)}',
                                  data={'ok': False, 'error': 'invalid_arguments'}, is_error=True)
        try:
            jsonschema.validate(args, TOOL_SCHEMAS[handler.__name__]['inputSchema'])
        except jsonschema.ValidationError as exc:
            where = '/'.join(str(p) for p in exc.absolute_path)
            return ToolResult(f'{where + ": " if where else ""}{exc.message}'[:600],
                              data={'ok': False, 'error': 'invalid_arguments'}, is_error=True)
        try:
            from .file_contract import input_paths, output_locks, protect_directories
            out_dir = ctx.resolve(f'{OUTPUT_ROOT}/{args["output_name"]}')
            protect_directories([out_dir], input_paths(args, ctx))
            with output_locks(ctx, [out_dir]):
                return handler(dict(args), ctx)
        except Model3DError as exc:
            return ToolResult(str(exc), data={'ok': False, 'error': exc.kind, **exc.extra}, is_error=True)
        except (ValueError, OSError, RuntimeError, KeyError, TypeError) as exc:
            return ToolResult(str(exc), data={'ok': False, 'error': type(exc).__name__}, is_error=True)
    return run


def _intact(ctx: RunContext, record: dict) -> bool:
    files = record.get('files') or {}
    for entry in files.values():
        path = ctx.resolve(entry['path'])
        if not path.is_file() or file_digest(path) != entry['sha256']:
            return False
    return 'model' in files


@_public
def model3d_generate(args: dict, ctx: RunContext) -> ToolResult:
    operation, name = args['operation'], args['output_name']
    timeout = float(args.get('timeout_seconds') or 3000)
    interval = float(args.get('poll_interval_seconds') or 5)
    ledger = _requests(ctx)
    plan = PLANNERS[operation](args, ctx, ledger)
    signature = digest(plan['recipe'])
    previous = ledger.get(name) if isinstance(ledger.get(name), dict) else None

    if previous and previous.get('signature') == signature and not args.get('force'):
        status = previous.get('status')
        if status == 'success' and _intact(ctx, previous):
            return _result(ctx, previous, reused=True)
        if status in ('submitting', 'submit_unknown'):
            if previous.get('idempotency_key') and previous.get('request_body'):
                # Replay the SAME key and body: the generator answers with the original task id
                # (or creates it once if it never arrived), so no second task is created.
                api = _Api()
                try:
                    task_id = api.create(previous['request_body'], previous['idempotency_key'])
                except Model3DError as exc:
                    raise Model3DError(f'the earlier submission is still unresolved ({exc}); repeat the call later. '
                                       'It is not resent with a new key', 'submit_unknown') from exc
                record = {**previous, 'task_id': task_id, 'status': 'submitted'}
                record.pop('error', None)
                _save_record(ctx, name, record)
                return _collect(ctx, api, record, plan, timeout, interval)
            raise Model3DError('an earlier submission of this request ended without a task id; it may exist, so it '
                               'is not resent. Use force=true only once you are sure no task was created',
                               'submit_unknown')
        if previous.get('task_id') and status not in FAILED:
            return _collect(ctx, _Api(), previous, plan, timeout, interval)   # no new task
        if status in FAILED:
            raise Model3DError(f'the earlier task for {name!r} ended {status}: {previous.get("error") or ""}. '
                               'Change the cause and use a new output_name, or force=true to submit the '
                               'same request again', 'task_failed')
    elif previous and not args.get('force'):
        raise ValueError(f'output_name {name!r} already holds a different {previous.get("operation")} request; '
                         'choose a new output_name or pass force=true')
    if previous and args.get('force') and previous.get('status') in ACTIVE:
        if previous.get('status') == 'completed':
            raise ValueError(f'the task for {name!r} ({previous.get("task_id")}) already finished; only '
                             'its files are not saved yet. Repeat the call without force to download them '
                             '(no new task), or choose a new output_name for a different asset')
        raise ValueError(f'a task for {name!r} is still running; collect it first (repeat the call without force) '
                         'or choose a new output_name')

    seeded = _seed()
    if seeded is not None:
        return _frozen(ctx, args, plan, signature, seeded)       # debug mode: no task is created

    spent, cap = _spent(ctx), _cap()
    if spent >= cap:
        raise Model3DError('this project has reached its 3D call limit; no request was sent. Stop making 3D '
                           'assets and report what is missing', 'usage_limit')
    api = _Api()
    body, meta = plan['submit'](api)                    # uploads and the riggability check; no task yet
    from . import toolhub
    # Key and exact body are recorded before the submission: an interrupted call is
    # replayed with them (see above) instead of creating a second task.
    record = {'operation': operation, 'output_name': name, 'signature': signature, 'status': 'submitting',
              'task_id': None, 'endpoint': body['action'], 'inputs': plan['inputs'], 'params': plan['params'],
              'format': plan['format'], 'submitted_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
              'idempotency_key': toolhub.new_idempotency_key(), 'request_body': body, **meta}
    _save_record(ctx, name, record)
    try:
        record['task_id'] = api.create(body, record['idempotency_key'])
    except Model3DError as exc:
        if exc.kind in UNKNOWN_KINDS:
            _save_record(ctx, name, {**record, 'status': 'submit_unknown', 'error': str(exc)[:400]})
            raise Model3DError(f'{exc}. The task may have been created; repeat this call with the same arguments to '
                               'recover it with the same request key (no second task)', 'submit_unknown') from exc
        _save_record(ctx, name, previous)               # refused before creation: restore
        raise
    record['status'] = 'submitted'
    _save_record(ctx, name, record)
    return _collect(ctx, api, record, plan, timeout, interval)


def _collect(ctx: RunContext, api: _Api, record: dict, plan: dict, timeout: float, interval: float) -> ToolResult:
    name, task_id = record['output_name'], record['task_id']
    try:
        data = _wait(api, task_id, timeout, interval)
    except Model3DError as exc:
        if exc.kind in ('auth', 'not_found', 'invalid_request'):
            raise
        _save_record(ctx, name, {**record, 'status': 'running'})
        raise Model3DError(f'{exc}; task {task_id} keeps running. Repeat this call with the same arguments to '
                           'collect it (no new task)', exc.kind, task_id=task_id) from exc
    status = str(data.get('status')).lower()
    units = _units(data)
    # A failed task reports no usage.
    spent = _charge(ctx, task_id, record['operation'], name, units, status)
    if status in FAILED:
        error = str(data.get('error_message') or data.get('error') or data.get('error_code') or '')[:300]
        _save_record(ctx, name, {**record, 'status': status, 'error': error})
        raise Model3DError(f'task {task_id} ended {status}' + (f': {error}' if error else ''),
                           'blocked' if status == 'banned' else 'task_failed', task_id=task_id)
    record = {**record, 'status': 'completed', 'units': units}
    _save_record(ctx, name, record)
    out_dir = ctx.resolve(f'{OUTPUT_ROOT}/{name}')
    model, preview, last = None, None, None
    for attempt in range(2):
        if attempt:
            data = api.get(task_id)                    # output URLs expire within minutes: refresh once
        url = _first(data, MODEL_KEYS)             # api.get already returns the task's output object
        if not url:
            raise Model3DError(f'task {task_id} finished, but its status carries no model file yet. '
                               'Repeat this call with the same arguments (not force) to fetch it again; no new '
                               'task', 'provider_error', task_id=task_id)
        try:
            model = _download(url, out_dir, 'model', plan['format'])
            break
        except Model3DError as exc:
            last = exc
    if model is None:
        raise Model3DError(f'{last}; task {task_id} is finished. Repeat this call to download it again',
                           'download_failed', task_id=task_id)
    preview_url = _first(data, PREVIEW_KEYS)
    if preview_url:
        try:
            preview = _download(preview_url, out_dir, 'preview', 'image')
        except Model3DError:
            preview = None
    task_json = out_dir / 'task.json'
    write_object(task_json, {
        'operation': record['operation'], 'output_name': name, 'task_id': task_id,
        'type': data.get('type'), 'status': status,
        'inputs': record.get('inputs'), 'params': record.get('params'),
        **{k: record[k] for k in ('rig_type', 'animations') if k in record},
        'files': [ctx.virtualize(p) for p in (model, preview) if p],
    })
    files = {'model': {'path': ctx.virtualize(model), 'sha256': file_digest(model)},
             'task': {'path': ctx.virtualize(task_json), 'sha256': file_digest(task_json)}}
    if preview:
        files['preview'] = {'path': ctx.virtualize(preview), 'sha256': file_digest(preview)}
    record = {**record, 'status': 'success', 'files': files, 'finished_at': time.strftime('%Y-%m-%dT%H:%M:%S')}
    _save_record(ctx, name, record)
    return _result(ctx, record, reused=False, spent=spent)


def _result(ctx: RunContext, record: dict, reused: bool, spent: float | None = None) -> ToolResult:
    files = record['files']
    operation, name = record['operation'], record['output_name']
    data = {'ok': True, 'operation': operation, 'output_name': name, 'task_id': record['task_id'],
            'model_file': files['model']['path'], 'task_json': files['task']['path'],
            'preview': (files.get('preview') or {}).get('path'), 'reused': reused}
    for key in ('rig_type', 'animations'):
        if key in record:
            data[key] = record[key]
    origin = 'reused, no new task' if reused else f'task {record["task_id"]}'
    text = f'[OK] {operation} {name}: {data["model_file"]} ({origin}).'
    if operation == 'generate':
        text += (' Render it from front, left, back and right and compare each with its input before rigging; '
                 'the preview shows the front only.')
    if operation == 'rig':
        text += f' Rig type {record.get("rig_type")}.'
    preview = ctx.resolve(data['preview']) if data['preview'] else None
    return ToolResult(text, data=data, artifacts=[str(ctx.resolve(files['model']['path'])),
                                                  str(ctx.resolve(files['task']['path']))],
                      image_paths=[str(preview)] if operation == 'generate' and preview else [])
