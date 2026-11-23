"""Task files for the runtime's native subagents; no model transport here.

A stage writes ``out/<stage>/<batch>/task.json`` (materials, instructions, the
report format, ``input_sha256`` and the report path) and returns
``awaiting_subagent``. The coordinator dispatches the Agent tool with the task's
role and a short prompt, then reruns the stage. The stage reads the report and
accepts it only if it answers this exact task: the same task id and input
binding, a result matching the schema and the stage's own scope check. Anything
else is moved aside with its reason, so the next dispatch starts clean.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

from jsonschema import Draft202012Validator

from ve_tools.visual_review import ReviewError

TASK_SCHEMA = 'recap-subagent-task-v1'
ROLES = frozenset({'recap-observer', 'recap-text-reviewer', 'recap-final-reviewer'})
# A feature film needs a handful of tasks per stage; more parallel agents than
# this mostly contend for the same runtime without finishing the stage sooner.
MAX_AGENTS = 4
MAX_SCHEMA_ISSUES = 24
_NAME = re.compile(r'[a-z0-9][a-z0-9_-]{0,63}')


def _encoded(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'),
                      allow_nan=False).encode()


def digest(value) -> str:
    return hashlib.sha256(_encoded(value)).hexdigest()


def file_sha256(path: Path) -> str:
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_readable(path: Path, value) -> None:
    """Atomically write indented JSON: agents read these files a page at a time."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=1)
            stream.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def task_dir(out: Path, stage: str, batch: str) -> Path:
    if not _NAME.fullmatch(stage) or not _NAME.fullmatch(batch):
        raise ReviewError('subagent_task_name_invalid')
    return Path(out).resolve() / stage / batch


def prepare(out: Path, *, stage: str, batch: str, role: str, instructions: str, materials: dict,
            result_schema: dict, input_files: dict | None = None, max_agents: int = MAX_AGENTS) -> dict:
    """Write (or keep) the task file for these exact inputs and return it.

    An unchanged task keeps its file and any report already written for it. When
    the inputs change, the task is rewritten and a report for the old inputs is
    removed: it can no longer be accepted and would only mislead the next agent.
    """
    if role not in ROLES or not instructions.strip() or not isinstance(materials, dict):
        raise ReviewError('subagent_task_arguments_invalid')
    directory = task_dir(out, stage, batch)
    files = {name: {'path': str(Path(path).resolve()), 'sha256': file_sha256(path)}
             for name, path in sorted((input_files or {}).items())}
    binding = {'stage': stage, 'batch': batch, 'role': role, 'instructions': instructions,
               'materials': materials, 'result_schema': result_schema, 'input_files': files}
    input_sha256 = digest(binding)
    task_id = digest({'schema': TASK_SCHEMA, 'input_sha256': input_sha256})
    task = {'schema': TASK_SCHEMA, 'task_id': task_id, 'input_sha256': input_sha256,
            'stage': stage, 'batch': batch, 'role': role,
            'task_path': str(directory / 'task.json'), 'report_path': str(directory / 'report.json'),
            'max_concurrent_agents': max_agents, 'instructions': instructions,
            'report_format': {'task_id': task_id, 'input_sha256': input_sha256,
                              'result': 'an object matching result_schema'},
            'result_schema': result_schema, 'input_files': files, 'materials': materials}
    path = directory / 'task.json'
    if path.is_file():
        try:
            if json.loads(path.read_text()).get('task_id') == task_id:
                return task
        except ValueError:
            pass
    for name in ('report.json', 'rejection.json'):
        (directory / name).unlink(missing_ok=True)
    write_readable(path, task)
    return task


@dataclass
class Outcome:
    """``accepted`` with the validated result, ``missing``, or ``rejected`` with its reason."""
    status: str
    result: object = None
    error: dict | None = None


def _schema_issues(schema: dict, value) -> list[dict]:
    issues = []
    for error in Draft202012Validator(schema).iter_errors(value):
        field = '.'.join(str(key) for key in error.absolute_path) or 'result'
        issues.append({'field': field[:160], 'constraint': error.validator})
        if len(issues) >= MAX_SCHEMA_ISSUES:
            break
    return issues


def check_envelope(task: dict, report) -> None:
    """The report answers this task and its result has the task's shape; raises ReviewError otherwise."""
    if not isinstance(report, dict) or set(report) != {'task_id', 'input_sha256', 'result'}:
        raise ReviewError('report_envelope_invalid', diagnostics={
            'expected_fields': ['task_id', 'input_sha256', 'result']})
    if report['task_id'] != task['task_id'] or report['input_sha256'] != task['input_sha256']:
        raise ReviewError('report_answers_another_task')
    issues = _schema_issues(task['result_schema'], report['result'])
    if issues:
        raise ReviewError('report_schema_invalid', diagnostics={'issues': issues})


def answers(task: dict, report) -> bool:
    """Read-only form of the envelope check, for progress probes."""
    try:
        check_envelope(task, report)
    except (ReviewError, TypeError, KeyError, RecursionError):
        return False
    return True


def collect(out: Path, task: dict, validate=None) -> Outcome:
    """Accept the task's report, or reject it with a reason for the next dispatch.

    ``validate(result)`` is the stage's own check (scope coverage, references);
    it raises ReviewError on failure and may return a normalized result.
    """
    directory = task_dir(out, task['stage'], task['batch'])
    path = directory / 'report.json'
    if not path.is_file():
        return Outcome('missing')
    error = None
    try:
        report = json.loads(path.read_text())
        check_envelope(task, report)
        result = report['result']
        if validate is not None:
            checked = validate(result)
            result = result if checked is None else checked
    except ReviewError as exc:
        error = {'code': exc.code, **({'diagnostics': exc.diagnostics} if exc.diagnostics else {})}
    except (ValueError, TypeError, KeyError, AttributeError, RecursionError):
        error = {'code': 'report_json_invalid'}
    if error is None:
        (directory / 'rejection.json').unlink(missing_ok=True)
        return Outcome('accepted', result)
    path.replace(directory / 'report.rejected.json')
    write_readable(directory / 'rejection.json', {'task_id': task['task_id'], **error})
    return Outcome('rejected', error=error)


def dispatch_item(task: dict, outcome: Outcome) -> dict:
    """What the coordinator needs to start one agent for an unanswered task."""
    prompt = (f"Read the task file {task['task_path']} and do the task it describes. "
              f"Write your report to {task['report_path']} in the report_format it gives, then stop.")
    if outcome.status == 'rejected':
        prompt += (' A previous report for this task was rejected; read '
                   f"{Path(task['task_path']).with_name('rejection.json')} first and avoid that error.")
    return {'role': task['role'], 'task_path': task['task_path'], 'report_path': task['report_path'],
            'prompt': prompt, **({'rejected': outcome.error} if outcome.error else {})}


def awaiting(items: list[dict], *, max_agents: int = MAX_AGENTS, **extra) -> dict:
    return {'status': 'awaiting_subagent', 'tasks': items,
            'max_concurrent_agents': min(max_agents, len(items)),
            'next_action': ('Dispatch one Agent per task with its role as subagent_type and its prompt, '
                            'at most max_concurrent_agents at a time; when they finish, rerun this command.'),
            **extra}


def require_ids(rows, key: str, expected) -> dict:
    """Map rows by ``key`` and require exactly the expected ids, each once."""
    expected = list(expected)
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ReviewError('report_rows_invalid')
    seen = [row.get(key) for row in rows]
    if len(set(seen)) != len(seen) or set(seen) != set(expected):
        raise ReviewError('report_scope_mismatch', diagnostics={
            'missing': sorted(set(expected) - set(seen))[:40],
            'unexpected': sorted(str(v) for v in set(seen) - set(expected))[:40],
            'duplicates': sorted({str(v) for v in seen if seen.count(v) > 1})[:40]})
    return {row[key]: row for row in rows}
