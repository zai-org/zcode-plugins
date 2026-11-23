"""Final review of the rendered recap: plan the samples, collect reviewer reports, record human listening."""
from __future__ import annotations

import argparse
import json
import os
from contextlib import nullcontext
from pathlib import Path

if not __package__:  # executed as a file: import siblings as recap.<name>
    import _entry
    _entry.bootstrap()
from recap.project_context import bind_root, default_root
from recap import final_review as review
from ve_tools import visual_review as vr
from ve_tools.recap_runtime_state import RuntimeBusy, stage_run


def main() -> None:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'run', 'status', 'check', 'import-listening', 'import-visual'])
    parser.add_argument('--out', type=Path, default=None,
                        help="Review directory (default: 'out' under the current project directory)")
    parser.add_argument('--video', type=Path, help='plan: the rendered video (default out/final.mp4)')
    parser.add_argument('--new-version', action='store_true',
                        help='plan: archive the finished review and plan the one follow-up for a new render')
    parser.add_argument('--review', type=Path, help='Completed actual listening/playback review, bound to this plan/video')
    args = parser.parse_args()
    try:
        args.out = args.out.expanduser().resolve() if args.out else default_root() / 'out'
        bind_root(args.out.parent)
        operation = (nullcontext(None) if args.action == 'status' else
                     stage_run(args.out.resolve().parent, 'production',
                               inputs={'operation': 'final_review_' + args.action}, outputs=[]))
        with operation as stage:
            if args.action == 'plan':
                result = review.plan(args.out, args.video, new_version=args.new_version)
            elif args.action == 'run':
                result = review.run(args.out)
            elif args.action in ('import-listening', 'import-visual'):
                if not args.review:
                    parser.error(args.action + ' requires --review')
                result = (review.import_listening(args.out, args.review) if args.action == 'import-listening'
                          else review.import_visual(args.out, args.review))
            elif args.action == 'check':
                result = review.check(args.out)
            else:
                result = review.status(args.out)
            if stage is not None:
                stage.complete(operation='final_review_' + args.action, result_status=result['status'])
        print(json.dumps(result, ensure_ascii=False))
        # A complete automatic review that only awaits people is this run's delivery, not a failure.
        preview_ready = ((result.get('run_state') == 'awaiting_listening' and result.get('automatic_complete') is True)
                         or result.get('run_state') == 'awaiting_playback')
        if args.action == 'check' and result['status'] != 'passed' and not preview_ready:
            raise SystemExit(2)
    except RuntimeBusy:
        print(json.dumps(vr.ReviewError('production_writer_active').result()))
        raise SystemExit(2) from None
    except vr.ReviewError as error:
        print(json.dumps(error.result(), ensure_ascii=False))
        raise SystemExit(2) from None
    except (OSError, ValueError, KeyError, TypeError):
        print(json.dumps(vr.ReviewError('final_review_artifact_missing_or_invalid').result()))
        raise SystemExit(2) from None


if __name__ == '__main__':
    main()
