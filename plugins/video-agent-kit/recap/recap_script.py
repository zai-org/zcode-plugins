"""Coordinator entrypoint for the movie manuscript: packet, draft, review, resolutions, production."""
from __future__ import annotations

import argparse
import json
import os
import sys
from contextlib import nullcontext
from pathlib import Path

if not __package__:  # executed as a file: import siblings as recap.<name>
    import _entry
    _entry.bootstrap()
from ve_tools import file_lock
from recap.project_context import bind_root, default_root
from recap import script_workflow as workflow
from ve_tools.recap_runtime_state import RuntimeBusy, stage_run
from ve_tools.visual_review import ReviewError

ACTIONS = ['configure-duration', 'packet', 'import-draft', 'review', 'resolve', 'check',
           'prepare-production', 'window-check', 'status']
# Statuses that mean the command did its work (a paused stage included).
DONE = frozenset({'prepared', 'passed', 'resolved', 'ready', 'imported', 'planned', 'awaiting_subagent'})


def status(out: Path) -> dict:
    from recap import final_review, native_observation, script_review, window_check
    from recap.production_workflow import preparation_status
    gate = workflow.read_json(out / script_review.GATE) if (out / script_review.GATE).is_file() else {}
    script = {'status': gate.get('status', 'not_started'),
              **{k: gate[k] for k in ('reviews_used', 'reviews_limit') if k in gate},
              'blockers': len(gate.get('blockers', [])), 'gaps': script_review.review_gaps(out)}
    picture = workflow.read_json(out / window_check.REPORT) if (out / window_check.REPORT).is_file() else {}
    check = {'status': picture.get('status', 'not_started'), 'totals': picture.get('totals', {}),
             'gaps': window_check.review_gaps(out)}
    try:
        final = final_review.status(out)
    except (OSError, ValueError, KeyError, TypeError):
        final = {'status': 'not_planned'}
    except ReviewError as error:
        final = {'status': 'failed', 'error': {'code': error.code}}
    return {'observation': native_observation.status(out), 'script_review': script, 'picture_check': check,
            'preparation': preparation_status(out), 'final_review': final}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=ACTIONS)
    parser.add_argument('--root', type=Path, default=None,
                        help='Project root (default: the current project directory)')
    parser.add_argument('--target-minutes', type=float, nargs=2, metavar=('MIN', 'MAX'),
                        help='Explicit total duration including original audio and holds; configure-duration only')
    parser.add_argument('--replace-draft', action='store_true', help='Archive an existing draft before replacing it')
    parser.add_argument('--draft-file', type=Path,
                        help='Coordinator submission JSON for import-draft, relative to --root')
    parser.add_argument('--args-file', type=Path, default=Path('out/produce_args.json'),
                        help='Production arguments for prepare-production and window-check, relative to --root')
    parser.add_argument('--sentence-id', help='resolve: sentence ID such as B011S002')
    parser.add_argument('--text', help='resolve: softened wording that only states what the evidence supports')
    parser.add_argument('--drop', action='store_true', help='resolve: drop the sentence from the production narration')
    parser.add_argument('--reason', help='resolve: why the sentence is softened or dropped')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        args.root = bind_root(args.root or default_root())
        root = args.root.resolve()
        out = args.root / 'out'
        if (args.action == 'configure-duration') != (args.target_minutes is not None):
            raise ReviewError('movie_target_duration_requires_configure_action')
        if (args.action == 'import-draft') != (args.draft_file is not None):
            raise ReviewError('import_draft_requires_draft_file')
        if (args.sentence_id is not None or args.text is not None or args.drop) and args.action != 'resolve':
            raise ReviewError('sentence_resolution_requires_resolve_action')
        if args.action == 'status':
            print(json.dumps(status(out), ensure_ascii=False))
            return 0
        out.mkdir(parents=True, exist_ok=True)
        if args.action == 'window-check':
            # Planning view: the windows, frames and tasks the check would use, without voicing or checking.
            from recap.production_workflow import arrange_windows, load_arguments
            from recap.project_context import ProjectContext
            from recap.window_check import pack, plan
            data = arrange_windows(ProjectContext(project_root=root), out, load_arguments(root, args.args_file))
            claims, others = plan(out, data)
            print(json.dumps({'status': 'planned', 'arrangement': data.get('status'),
                              'sentences': len(claims) + len(others), 'with_visual_claim': len(claims),
                              'tasks': len(pack(claims)),
                              'fit_feedback': [f for row in data.get('segments', [])
                                               for f in row.get('fit_feedback', [])][:40],
                              'issues': data.get('issues', [])[:40]}, ensure_ascii=False))
            return 0
        with (out / '.script_workflow.lock').open('a') as lock:
            try:
                file_lock.flock(lock, file_lock.LOCK_EX | file_lock.LOCK_NB)
            except BlockingIOError:
                raise ReviewError('script_workflow_already_running') from None
            operation = (nullcontext(None) if args.action == 'check' else
                         stage_run(root, 'production', inputs={'operation': 'script_' + args.action}, outputs=[]))
            with operation as stage:
                if args.action == 'configure-duration':
                    from recap.movie_editorial import configure_duration
                    result = configure_duration(out, args.target_minutes)
                elif args.action == 'packet':
                    packet = workflow.build_packet(out)
                    result = {'status': 'prepared', 'packet_id': packet['packet_id'],
                              'beats': len(packet['beats']), 'sources': len(packet['sources'])}
                elif args.action == 'import-draft':
                    path = args.draft_file if args.draft_file.is_absolute() else args.root / args.draft_file
                    result = workflow.import_draft(out, workflow.read_json(path), replace=args.replace_draft)
                elif args.action == 'review':
                    from recap.script_review import review
                    result = review(out)
                elif args.action == 'resolve':
                    from recap.window_check import resolve
                    result = resolve(out, args.sentence_id, text=args.text, drop=args.drop,
                                     reason=args.reason or '')
                elif args.action == 'check':
                    gaps = workflow.validate_review_artifacts(out)
                    result = {'status': 'passed' if not gaps else 'needs_review', 'gaps': gaps}
                else:
                    from recap.production_workflow import load_arguments, prepare_production
                    result = prepare_production(root, args=load_arguments(root, args.args_file))
                if stage is not None:
                    if result['status'] in DONE:
                        stage.complete(operation='script_' + args.action, result_status=result['status'])
                    else:
                        stage.fail(result['status'])
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result['status'] in DONE else 1
    except ReviewError as error:
        print(json.dumps(error.result(), ensure_ascii=False))
        return 1
    except RuntimeBusy:
        print(json.dumps({'status': 'failed', 'error': {'code': 'production_writer_active'}}))
        return 1
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        # No tracebacks containing source material or configuration.
        print(json.dumps({'status': 'failed', 'error': {'code': 'script_input_invalid'}}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
