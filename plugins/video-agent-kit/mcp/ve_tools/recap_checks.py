"""Load versioned recap review checkers from the plugin's ``recap`` package."""
from __future__ import annotations
import importlib
from pathlib import Path
import sys

_PLUGIN_ROOT = Path(__file__).resolve().parents[2]


class ReviewRuntimeError(ImportError):
    """A requested checker is not a module of the plugin's ``recap`` package."""


def load_review_checker(module: str):
    """Import one checker from the ``recap`` package shipped next to ``mcp/``."""
    if not module.isidentifier():
        raise ReviewRuntimeError('invalid_review_module')
    if not (_PLUGIN_ROOT / 'recap' / f'{module}.py').is_file():
        raise ReviewRuntimeError('review_runtime_missing')
    if str(_PLUGIN_ROOT) not in sys.path:
        sys.path.insert(0, str(_PLUGIN_ROOT))
    return importlib.import_module('recap.' + module)


_HOOKS: dict = {}


def register_recap_hook(name: str, function) -> None:
    """Let recap callers provide a callback (``"<module>.<function>"``) explicitly.

    ``ve_tools`` never imports ``recap`` at module import time; recap-owned
    validators are injected by callers, registered here, or loaded on demand
    through :func:`load_review_checker`, which sets up its own ``sys.path``.
    """
    if not callable(function):
        raise TypeError('recap hook must be callable')
    _HOOKS[name] = function


def recap_hook(name: str):
    """Resolve a recap callback; raises ``ReviewRuntimeError`` when unavailable."""
    if name in _HOOKS:
        return _HOOKS[name]
    module, _, attr = name.rpartition('.')
    if not module or not attr.isidentifier():
        raise ReviewRuntimeError('invalid_recap_hook')
    try:
        function = getattr(load_review_checker(module), attr)
    except ReviewRuntimeError:
        raise
    except (ImportError, AttributeError) as exc:
        raise ReviewRuntimeError(f'recap_hook_unavailable:{name}') from exc
    if not callable(function):
        raise ReviewRuntimeError(f'recap_hook_unavailable:{name}')
    return function


def review_gaps(out: Path, module: str, function: str = 'validate_review_artifacts') -> list[str]:
    try:
        checker = load_review_checker(module)
        return getattr(checker, function)(out)
    except ReviewRuntimeError as exc:
        return [f'{module} checker unavailable: {exc}']
    except (ImportError, AttributeError, OSError, ValueError, TypeError, KeyError) as exc:
        return [f'{module} checker unavailable or invalid: {type(exc).__name__}']
