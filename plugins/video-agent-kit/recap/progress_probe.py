"""Read-only movie progress evidence; this is not a delivery or liveness verdict.

Only production content and subagent reports that answer their current task
produce milestones. Status files, logs and rewritten metadata cannot keep a
repair loop alive. Nothing here writes to the workspace.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

if not __package__:
    import _entry
    _entry.bootstrap()

MODE = 'movie-recap-progress'
VERSION = 1
# Production data, deliberately excluding reports, gates, logs and controller state.
JSON_ARTIFACTS = (
    'film_index.json', 'transcript.json', 'shots.json', 'dialogue_index.json',
    'visual_index.json', 'outline.json', 'writer_script.json',
    'narration_script.json', 'script_tts.json', 'edl.json',
)
TEXT_ARTIFACTS = ('dialogue_axis.txt', 'story_spine.md')
_VOLATILE = frozenset({
    'created_at', 'updated_at', 'generated_at', 'completed_at', 'checked_at',
    'recorded_at', 'heartbeat_at',
})


def _content(value):
    if isinstance(value, dict):
        return {key: _content(item) for key, item in value.items() if key not in _VOLATILE}
    if isinstance(value, list):
        return [_content(item) for item in value]
    return value


def _digest(value):
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False,
                     separators=(',', ':'), allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()


def _answered_tasks(out: Path, root: Path):
    """(task, report bytes) for every subagent report that answers its current task."""
    from recap import native_review
    for path in sorted(out.glob('*/*/task.json')):
        if path.is_symlink() or path.parent.is_symlink() or path.parent.parent.is_symlink():
            continue
        report = path.with_name('report.json')
        try:
            task = json.loads(path.read_text(encoding='utf-8'))
            if task.get('schema') != native_review.TASK_SCHEMA or not report.is_file() or report.is_symlink():
                continue
            if any(not Path(item['path']).resolve().is_relative_to(root)
                   for item in task['input_files'].values()):
                continue
            raw = report.read_bytes()
            if native_review.answers(task, json.loads(raw)):
                yield task, raw
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            # A half-written report or an old task shape is not progress.
            continue


def probe(root: Path) -> dict:
    root = Path(root).resolve()
    if not root.is_dir():
        raise ValueError('movie progress root missing')
    out = root / 'out'
    if out.is_symlink():
        raise ValueError('movie progress output directory is a symlink')
    milestones = set()
    artifacts = 0
    for name in (*JSON_ARTIFACTS, *TEXT_ARTIFACTS):
        path = out / name
        if path.is_symlink() or not path.is_file():
            continue
        try:
            value = path.read_text(encoding='utf-8')
            if name in JSON_ARTIFACTS:
                value = _content(json.loads(value))
                if not isinstance(value, (dict, list)):
                    continue
            else:
                value = value.strip()
            if not value:
                continue
            token = _digest(('artifact', name, value))
        except (ValueError, UnicodeError):
            # A partial draft may still need repair; it is not progress evidence.
            continue
        milestones.add(token)
        artifacts += 1
    answered = 0
    for task, raw in _answered_tasks(out, root):
        milestones.add(_digest(('subagent', task['task_id'], task['input_sha256'],
                                hashlib.sha256(raw).hexdigest())))
        answered += 1
    return {'mode': MODE, 'version': VERSION, 'ok': True,
            'milestones': sorted(milestones), 'production_artifacts': artifacts,
            'answered_subagent_tasks': answered}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = probe(args.root)
    except Exception:
        result = {'mode': MODE, 'version': VERSION, 'ok': False,
                  'error': 'movie_progress_probe_failed'}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
