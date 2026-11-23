"""Movie-recap delivery contract probe (stdout: {"mode","ok","missing"} JSON).

The pipeline runs it after each agent round to decide on a bounded repair round.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys

if not __package__:  # executed as a file: import siblings as recap.<name>
    import _entry
    _entry.bootstrap()

REQUIRED = ('production_profile.json', 'visual_index.json', 'visual_coverage_gaps.json',
            'script_gate.json', 'spot_review.json', 'story_spine.md', 'report.md')


def _delivery_checker(plugin: Path):
    """The delivery checker shipped in the same plugin as this probe, loaded from there only."""
    hook = plugin / 'mcp/ve_tools/recap_delivery.py'
    if not hook.is_file():
        return None, 'closeout_checker_missing'
    hook = hook.resolve()
    expected = hook.parent
    for name, loaded in tuple(sys.modules.items()):
        if name == 've_tools' or name.startswith('ve_tools.'):
            source = getattr(loaded, '__file__', None)
            if source and not Path(source).resolve().is_relative_to(expected):
                return None, 'closeout_checker_origin_mismatch'
    mcp = str(hook.parents[1])
    if mcp in sys.path:
        sys.path.remove(mcp)
    sys.path.insert(0, mcp)
    spec = importlib.util.spec_from_file_location('recap_closeout', hook)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, None


def probe(root: Path, plugin: Path | None = None) -> dict:
    out = root / 'out'
    plugin = Path(plugin) if plugin is not None else Path(__file__).resolve().parents[1]
    module, error = _delivery_checker(plugin)
    if module is None:
        return {'mode': 'movie-recap', 'ok': False, 'missing': ['recap:' + error]}
    gaps = module.recap_gaps(out, out / 'report.md', strict_reviews=True)
    for name in REQUIRED:
        p = out / name
        if not p.is_file() or not p.stat().st_size:
            gaps.append(f'{name} missing')
    for name in ['script_gate.json', 'spot_review.json']:
        try:
            value = json.loads((out / name).read_text())
            if value.get('status') not in ['pass', 'passed', 'resolved']:
                gaps.append(f'{name} not passed')
        except (OSError, ValueError, AttributeError):
            gaps.append(f'{name} invalid')
    # The coarse index is complete and the picture every sentence plays over was checked.
    from recap import native_observation, window_check
    gaps.extend(native_observation.coverage_gaps(out))
    gaps.extend(window_check.review_gaps(out))
    try:
        edl = json.loads((out / 'edl.json').read_text())
        rows = edl.get('segments', []) if isinstance(edl, dict) else edl
        used = {w['shot_id'] for s in rows for w in s['windows']}
        from ve_tools import movie_refinement
        if movie_refinement.enabled(out):
            movie_refinement.validate_selected(out, used)
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        gaps.append('EDL shot refinement check incomplete')
    return {'mode': 'movie-recap', 'ok': not gaps, 'missing': ['recap:' + g for g in gaps]}


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--plugin', type=Path)
    args = parser.parse_args()
    try:
        result = probe(args.root, args.plugin)
    except Exception:
        result = {'mode': 'movie-recap', 'ok': False, 'missing': ['recap:contract_probe_failed']}
    print(json.dumps(result, ensure_ascii=False))
