"""MCP jobs: long tool calls run on a background thread of the MCP server process.

A long tool (generation, ASR, TTS, render) returns a job_id at once and the agent
collects the result with job_action=status, so no single MCP request has to stay
open past the host's request limit. Every job keeps request/state/result files in
``.video_agent/jobs/<job_id>/``; a heartbeat in state.json lets another process
(the CLI, a restarted server) tell a running job from one whose process is gone.

Portable by design (Linux, macOS, Windows): no child processes, no /proc. A job
cannot be killed; cancel marks it cancelled and its eventual result is discarded.
A job interrupted by a server restart is reported as interrupted; calling the tool
again with the same arguments resumes from the tool's own records (video takes,
3D and TTS requests, ASR chunks).
"""
from __future__ import annotations
import asyncio
import contextvars
import inspect
import os
import threading
import time
import traceback
import uuid
from pathlib import Path
from . import file_lock
from .creation_takes import read_object, write_object
from .result import ToolResult

LONG_TOOLS = {"image_generate", "video_generate", "video_render", "transcribe", "tts_generate",
              "detect_shots", "build_film_index", "synthesize_narration", "produce_film", "model3d_generate",
              # One image request per shot / one video task per window: minutes of work, well
              # past the host's request timeout when run as a waiting call.
              "swap_storyboards", "swap_generate"}
JOB_KEYS = {"job_action", "job_id"}


JOB_ACTIONS = ('submit', 'status', 'list', 'cancel')
JOB_ID_PATTERN = '^[a-f0-9]{32}$'
# Tool input schemas are sent verbatim to the model API by MCP hosts. A root-level
# anyOf/oneOf/allOf is rejected there, so the published schema stays a plain object and
# the job/business exclusivity is enforced by validate_arguments on the server.
ROOT_COMBINATORS = ('anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else')


class JobLimitError(ValueError):
    """The per-project active job limit is reached."""


def _requirement_note(business):
    """Describe requirements the flat published schema can no longer express."""
    notes = []
    required = business.get('required') or []
    if required:
        notes.append('requires ' + ', '.join(required))
    for keyword in ('anyOf', 'oneOf'):
        branches = []
        for branch in business.get(keyword) or []:
            if not isinstance(branch, dict) or not branch.get('required'):
                continue
            when = ['%s=%s' % (key, value['const']) for key, value in (branch.get('properties') or {}).items()
                    if isinstance(value, dict) and 'const' in value]
            branches.append((' and '.join(when) + ' requires ' if when else 'requires ') + ', '.join(branch['required']))
        if branches:
            notes.append('; or '.join(branches))
    return '; '.join(notes)


def augment_schemas(schemas):
    import copy
    for name, schema in schemas.items():
        business = schema['inputSchema']
        props = copy.deepcopy(business.get('properties', {}))
        clash = sorted(JOB_KEYS & set(props))
        if clash:
            raise ValueError(f'tool {name!r} business arguments collide with job controls: {clash}')
        props['job_action'] = {
            'type': 'string', 'enum': list(JOB_ACTIONS),
            'description': 'Job control. Omit (or submit) for a new call with the tool arguments. '
                           'status/cancel take only job_id; list takes no other argument.'}
        props['job_id'] = {'type': 'string', 'pattern': JOB_ID_PATTERN,
                           'description': 'Job id returned by an earlier call; only with job_action=status or cancel.'}
        schema['inputSchema'] = {'type': 'object', 'properties': props, 'additionalProperties': False}
        note = _requirement_note(business)
        if note:
            schema['description'] += f' A new call {note}; job_action=status/list/cancel calls take no tool arguments.'
        if name in LONG_TOOLS:
            schema['description'] += ' MCP returns a job_id. Collect status before dependent work; list/cancel are available.'


def _schema_error(exc):
    """One-line validation message; the default text embeds the whole schema and instance."""
    import jsonschema
    best = jsonschema.exceptions.best_match([exc]) or exc
    location = '/'.join(str(part) for part in best.absolute_path)
    message = best.message
    if best.validator in ('anyOf', 'oneOf') and not location:
        # "{...} is not valid under any of the given schemas" names no missing argument.
        note = _requirement_note({best.validator: best.validator_value})
        if note:
            message = 'arguments match no accepted form (' + note + ')'
    return 'invalid arguments: ' + message + (f' (at {location})' if location else '')


def validate_arguments(name, arguments, business_schema=None):
    import jsonschema
    if not isinstance(arguments, dict):
        raise ValueError('tool arguments must be a JSON object')
    action = arguments.get('job_action', 'submit')
    if action not in JOB_ACTIONS:
        raise ValueError('invalid job_action')
    if action in ('status', 'list', 'cancel'):
        if set(arguments) - JOB_KEYS:
            raise ValueError('job controls cannot include business arguments')
        if action in ('status', 'cancel'):
            import re
            if not isinstance(arguments.get('job_id'), str) or not re.fullmatch('[a-f0-9]{32}', arguments['job_id']):
                raise ValueError('status/cancel require a valid job_id')
        elif arguments.get('job_id'):
            raise ValueError('list does not accept job_id')
        return {}
    if arguments.get('job_id'):
        raise ValueError('submit cannot accept job_id')
    business = {k: v for k, v in arguments.items() if k not in JOB_KEYS}
    if business_schema is None:
        from .catalog import BUSINESS_SCHEMAS
        business_schema = BUSINESS_SCHEMAS[name]['inputSchema']
    try:
        jsonschema.validate(business, business_schema)
    except jsonschema.ValidationError as exc:
        raise ValueError(_schema_error(exc)) from None
    if set(business) - set(business_schema.get('properties', {})):
        raise ValueError('unknown business arguments')
    return business


def _directory(ctx):
    directory = ctx.work_dir / "jobs"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _paths(ctx, job_id):
    import re
    if not isinstance(job_id, str) or not re.fullmatch("[a-f0-9]{32}", job_id):
        raise ValueError("invalid job_id")
    directory = _directory(ctx) / job_id
    return directory, directory / "state.json"


HEARTBEAT_SECONDS = 5.0
STALE_SECONDS = 30.0          # a running job whose heartbeat is older belongs to a stopped process
FINAL = ("completed", "failed", "cancelled", "interrupted")
# This process's identity in state.json; a pid alone can be reused by another process.
_OWNER = uuid.uuid4().hex
_JOBS: dict[str, tuple[threading.Thread, Path]] = {}
_JOBS_LOCK = threading.Lock()
_HEARTBEAT: threading.Thread | None = None


def _job_context(ctx):
    from .run_context import RunContext
    return RunContext(session_kind="job", project_root=ctx.project_dir)


def submit(name, arguments, ctx, implementation=None, business_schema=None, official_auth=None):
    business = validate_arguments(name, arguments, business_schema)
    from .run_context import clean_env
    try:
        limit = max(1, int(clean_env("VE_MCP_WORKERS") or "2"))
    except ValueError:
        limit = 2
    # The lock file coordinates submissions from several MCP/CLI processes of one project.
    with (_directory(ctx) / ".submit.lock").open("a") as lock:
        file_lock.flock(lock, file_lock.LOCK_EX)
        active = 0
        for path in _directory(ctx).glob("*/state.json"):
            state = read_object(path)
            if state.get("status") in {"starting", "running"} and _alive(state):
                active += 1
        if active >= limit:
            raise JobLimitError("project job worker limit reached; collect/cancel active jobs before submitting")
        return _start(name, business, ctx, implementation, official_auth)


def _start(name, business, ctx, implementation=None, official_auth=None):
    if implementation is None:
        from .catalog import TOOLS
        implementation = TOOLS[name]
    job_id = uuid.uuid4().hex
    directory, state_path = _paths(ctx, job_id)
    directory.mkdir(mode=0o700)
    write_object(directory / "request.json", {"tool": name, "arguments": business,
                                              "project_dir": str(ctx.project_dir)})
    now = time.time()
    state = {"job_id": job_id, "tool": name, "status": "running", "created_at": now,
             "owner": _OWNER, "owner_pid": os.getpid(), "heartbeat": now}
    write_object(state_path, state)
    # The thread starts from a copy of this context, so it sees the ZCode identity set below.
    from .official_auth import CURRENT
    token = CURRENT.set(official_auth)
    try:
        context = contextvars.copy_context()
    finally:
        CURRENT.reset(token)
    thread = threading.Thread(target=context.run, args=(_run, job_id, implementation, business, ctx),
                              name=f"job-{name}-{job_id[:8]}", daemon=True)
    with _JOBS_LOCK:
        _JOBS[job_id] = (thread, state_path)
    _ensure_heartbeat()
    thread.start()
    return ToolResult("Job submitted; query job_action=status with job_id.", data=state)


def _invoke(implementation, business, ctx):
    """Run one tool body; every failure, SystemExit included, becomes an error result."""
    try:
        result = implementation(business, _job_context(ctx))
        if inspect.isawaitable(result):
            result = asyncio.run(result)
        if isinstance(result, str):
            result = ToolResult(text=result)
        elif not isinstance(result, ToolResult):
            raise TypeError("tool implementation must return a ToolResult")
        return result, None
    except (Exception, SystemExit) as exc:
        return ToolResult("[ERROR] " + str(exc), is_error=True), traceback.format_exc()


def _run(job_id, implementation, business, ctx):
    directory, state_path = _paths(ctx, job_id)
    try:
        result, trace = _invoke(implementation, business, ctx)
        if trace:
            with (directory / "job.log").open("a", encoding="utf-8") as log:
                log.write(trace)
        payload = result.to_dict()
        payload["_protected_texts"] = result.protected_texts
        write_object(directory / "result.json", payload)
        update_state(state_path, {"status": "failed" if result.failed else "completed", "ended_at": time.time()},
                     preserve_terminal=True)
    finally:
        with _JOBS_LOCK:
            _JOBS.pop(job_id, None)


def _ensure_heartbeat():
    global _HEARTBEAT
    with _JOBS_LOCK:
        if _HEARTBEAT is not None and _HEARTBEAT.is_alive():
            return
        _HEARTBEAT = threading.Thread(target=_beat, name="job-heartbeat", daemon=True)
        _HEARTBEAT.start()


def _beat():
    while True:
        time.sleep(HEARTBEAT_SECONDS)
        with _JOBS_LOCK:
            running = [state_path for thread, state_path in _JOBS.values() if thread.is_alive()]
        for state_path in running:
            try:
                update_state(state_path, {"heartbeat": time.time()}, preserve_terminal=True)
            except (OSError, ValueError):
                pass


def _alive(state):
    """Running here on a live thread, or in another process whose heartbeat is fresh."""
    with _JOBS_LOCK:
        entry = _JOBS.get(state.get("job_id"))
    if entry is not None:
        return entry[0].is_alive()
    if state.get("owner") == _OWNER:
        return False          # started by this process and no longer running
    try:
        return time.time() - float(state.get("heartbeat") or 0) < STALE_SECONDS
    except (TypeError, ValueError):
        return False


def control(name, arguments, ctx):
    action = arguments.get("job_action", "status")
    if action == "list":
        rows = []
        for path in sorted(_directory(ctx).glob("*/state.json")):
            state = read_object(path)
            if state.get("tool") == name and state.get("job_id"):
                # Rows carry job state only; a finished job's business result (a whole
                # transcript, image lists) is collected with job_action=status.
                try:
                    data = control(name, {"job_id": state["job_id"]}, ctx).data
                except (OSError, ValueError, KeyError, RuntimeError) as exc:
                    rows.append({"job_id": state["job_id"], "status": "unreadable", "error": str(exc)})
                    continue
                job = data["job"] if isinstance(data.get("job"), dict) and data["job"].get("job_id") == state["job_id"] else data
                rows.append({"job_id": job.get("job_id"), "status": job.get("status"), "job": job})
        return ToolResult(f"{len(rows)} {name} job(s) in this project", data={"jobs": rows})
    directory, state_path = _paths(ctx, arguments.get("job_id"))
    state = read_object(state_path)
    if not state or state.get("tool") != name:
        owner = f"; it was submitted with {state.get('tool')}, query it there" if state and state.get("tool") else ""
        raise ValueError("job does not belong to this tool/project" + owner)
    result_path = directory / "result.json"
    if state["status"] not in {"cancelled", "interrupted"} and result_path.is_file():
        payload = read_object(result_path)
        result = ToolResult(payload["text"], data=payload["data"], artifacts=payload["artifacts"],
                            image_paths=payload["image_paths"], video_paths=payload["video_paths"],
                            is_error=payload["status"] == "error", protected_texts=payload.get("_protected_texts", []))
        state.update(status='failed' if result.failed else 'completed', ended_at=state.get('ended_at') or time.time())
        state = update_state(state_path, state, preserve_terminal=True)
        result.data["job"] = state
        return result
    if action == "cancel" and state["status"] not in {"cancelled", "interrupted"}:
        state.update(status="cancelled", ended_at=time.time(),
                     recovery="The call may still finish in the background; its result is discarded. Video takes, "
                              "3D and TTS requests keep their upstream ids: call the tool again with the same "
                              "arguments to resume instead of resubmitting.")
        update_state(state_path, state)
    elif state["status"] in {"starting", "running"} and not _alive(state):
        state.update(status="interrupted", ended_at=time.time(),
                     recovery="The process running this job stopped (for example an MCP restart). Call the tool "
                              "again with the same arguments: video takes, 3D and TTS requests resume from their "
                              "records; image and ASR calls run again.")
        update_state(state_path, state, preserve_terminal=True)
    return ToolResult("Job " + state["status"], data=state,
                      is_error=state["status"] in {"cancelled", "interrupted"})


async def call(name, arguments, ctx, implementation=None, business_schema=None, official_auth=None):
    business = validate_arguments(name, arguments, business_schema)
    action = arguments.get("job_action")
    if action in {"list", "status", "cancel"}:
        return control(name, arguments, ctx)
    if name in LONG_TOOLS or action == "submit":
        # Hosts often start several long tools at once; a full project waits for a slot
        # (bounded by VE_MCP_QUEUE_SECONDS) instead of failing the extra submissions.
        patience = _queue_seconds()
        deadline = time.monotonic() + patience
        while True:
            try:
                return await asyncio.to_thread(submit, name, arguments, ctx, implementation, business_schema,
                                               official_auth)
            except JobLimitError as exc:
                if time.monotonic() >= deadline:
                    raise JobLimitError(f"{exc} (waited {patience:g}s for a free slot; VE_MCP_QUEUE_SECONDS)") from None
                await asyncio.sleep(1.0)
    # Short tools run inline on a worker thread; to_thread copies the context, identity included.
    if implementation is None:
        from .catalog import TOOLS
        implementation = TOOLS[name]
    from .official_auth import CURRENT
    token = CURRENT.set(official_auth)
    try:
        result, _ = await asyncio.to_thread(_invoke, implementation, business, ctx)
    finally:
        CURRENT.reset(token)
    return result


def _queue_seconds():
    from .run_context import clean_env
    try:
        value = float(clean_env("VE_MCP_QUEUE_SECONDS") or "120")
    except ValueError:
        return 120.0
    return value if value >= 0 and value == value else 120.0


def run_inline(name, arguments, ctx, implementation=None, business_schema=None):
    """One-shot processes (the CLI): run a call to completion in this process."""
    business = validate_arguments(name, arguments, business_schema)
    if implementation is None:
        from .catalog import TOOLS
        implementation = TOOLS[name]
    return _invoke(implementation, business, ctx)[0]


def job_status(data):
    job = data.get('job')
    return job.get('status') if isinstance(job, dict) else data.get('status')

async def collect_result(session, name, arguments):
    """Client helper: submit once, poll that job until the full tool result arrives."""
    result = await session.call_tool(name, arguments)
    data = result.structuredContent.get("data", {}) if result.structuredContent else {}
    if not data.get("job_id"):
        return result
    job_id = data["job_id"]
    while job_status(data) in {"starting", "running"}:
        await asyncio.sleep(.05)
        result = await session.call_tool(name, {"job_action": "status", "job_id": job_id})
        data = result.structuredContent.get("data", {})
    return result


def update_state(path, changes, preserve_terminal=False):
    with path.with_suffix('.lock').open('a') as lock:
        file_lock.flock(lock, file_lock.LOCK_EX)
        state = read_object(path)
        if preserve_terminal and state.get('status') in FINAL:
            changes = {k:v for k,v in changes.items() if k not in ('status','ended_at')}
        state.update(changes)
        write_object(path, state)
        return state
