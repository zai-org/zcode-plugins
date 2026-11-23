"""Importable movie recap tool boundaries for the shared catalog and durable job worker."""
from __future__ import annotations

from . import arrange, film_index, narrate_tts, narration_bind, picture_fit as fitting, produce, render_narrated as rendering, shots
from .recap_security import redact_error_result, tool_error
from .result import ToolResult

_WHOLE_SHOT_ONLY = ("fit_report", "fit_review_path", "avoid_shot_ids_by_seg")
_LEGACY_ONLY = ("inserts_path", "tail_mode")


def _invoke(implementation, arguments, ctx):
    # Catch movie exceptions before the shared worker can serialize a traceback.
    # BaseException cancellation/interrupt signals still propagate normally.
    try:
        return redact_error_result(implementation(arguments, ctx))
    except Exception as error:
        return tool_error(error)


def _misplaced(arguments, keys, where):
    given = sorted(key for key in keys if key in arguments)
    if given:
        return ToolResult(f"[ERROR] {', '.join(given)}: only used with {where}", is_error=True,
                          data={"error_code": "invalid_arguments_or_input", "arguments": given})
    return None


def detect_shots(arguments, ctx):
    return _invoke(shots.detect_shots, arguments, ctx)


def build_film_index(arguments, ctx):
    return _invoke(film_index.build_film_index, arguments, ctx)


def arrange_footage(arguments, ctx):
    arguments = dict(arguments)
    mode = arguments.pop("mode", "movie")
    if mode == "match":
        from .match_recap import arrange as match_arrange
        return _invoke(match_arrange, arguments, ctx)
    if mode != "movie":
        return ToolResult("[ERROR] mode must be movie or match", is_error=True)
    from .match_schemas import ARRANGE_OPTIONS
    misplaced = _misplaced(arguments, ARRANGE_OPTIONS, "mode=match")
    if misplaced:
        return misplaced
    return _invoke(arrange.arrange_footage, arguments, ctx)


def synthesize_narration(arguments, ctx):
    arguments = dict(arguments)
    mode = arguments.pop("mode", "movie")
    if mode == "match":
        from .match_recap import synthesize as match_synthesize
        return _invoke(match_synthesize, arguments, ctx)
    if mode != "movie":
        return ToolResult("[ERROR] mode must be movie or match", is_error=True)
    return _invoke(narrate_tts.synthesize_narration, arguments, ctx)


def bind_narration(arguments, ctx):
    """fit_mode=whole_shot (default) is the event-level whole-shot fit; legacy is tape-DP."""
    arguments = dict(arguments)
    mode = arguments.pop("fit_mode", None) or "whole_shot"
    if mode == "legacy":
        return _misplaced(arguments, _WHOLE_SHOT_ONLY, "fit_mode=whole_shot") or \
            _invoke(narration_bind.bind_narration, arguments, ctx)
    if mode != "whole_shot":
        return ToolResult("[ERROR] fit_mode must be whole_shot or legacy", is_error=True,
                          data={"error_code": "invalid_arguments_or_input"})
    return _misplaced(arguments, _LEGACY_ONLY, "fit_mode=legacy") or _invoke(fitting.picture_fit, arguments, ctx)


def render_narrated(arguments, ctx):
    """Implementation of video_render kind=narrated (arguments in render_narrated names)."""
    return _invoke(rendering.render_narrated, arguments, ctx)


def produce_film(arguments, ctx):
    return _invoke(produce.produce_film, arguments, ctx)
