"""Resolved input/output collision checks shared by public tools."""
from pathlib import Path
from contextvars import ContextVar

_frozen_outputs = ContextVar('frozen_creation_outputs', default={})


def reuse_frozen_output(path):
    """A submitted derivation is read-only; never repair it under the old identity."""
    from .creation_planning import file_digest
    path = Path(path).resolve()
    expected = _frozen_outputs.get().get(path)
    if expected is None:
        return False
    if not path.is_file() or file_digest(path) != expected:
        raise ValueError(f'submitted derivation changed; restore original bytes: {path}')
    return True

OUTPUT_KEYS = {"output_json", "output_path", "output", "output_dir", "output_name", "output_ass", "output_srt", "frames_dir", "output_table", "timeline_json", "script_md", "output_transcript", "redline_json", "ass_path", "srt_path"}

def input_paths(value, ctx):
    paths = set()
    def visit(item):
        if isinstance(item, dict):
            for key, val in item.items():
                if key not in OUTPUT_KEYS:
                    visit(val)
                    if key in {"reference_files", "input_sha256", "files", "grid_sha256"} and isinstance(val, dict):
                        for raw in val:
                            visit(raw)
        elif isinstance(item, list):
            for val in item:
                visit(val)
        elif isinstance(item, str) and item and not item.startswith(("http://", "https://", "data:")):
            try:
                path = ctx.resolve(item)
                if path.is_file():
                    paths.add(path)
            except (ValueError, OSError):
                pass
    visit(value)
    return paths


def protect_directories(directories, inputs):
    for directory in directories:
        root = Path(directory).resolve()
        for source in inputs:
            source = Path(source).resolve()
            if source == root or root in source.parents:
                raise ValueError(f"output directory contains an input: {source}")


def protect_outputs(outputs, inputs):
    resolved = {Path(p).resolve() for p in inputs}
    previous = []
    for output in outputs:
        path = Path(output).resolve()
        if path in previous or (path.exists() and any(p.exists() and path.samefile(p) for p in previous)):
            raise ValueError(f"outputs alias each other: {path}")
        previous.append(path)
        if path in resolved:
            raise ValueError(f"output would overwrite an input: {path}")
        # Existing hard links also designate the same source bytes.
        if path.exists() and any(p.exists() and path.samefile(p) for p in resolved):
            raise ValueError(f"output aliases an input: {path}")


from contextlib import contextmanager

@contextmanager
def frozen_outputs(bindings):
    token = _frozen_outputs.set(bindings)
    try:
        yield
    finally:
        _frozen_outputs.reset(token)

@contextmanager
def rollback_outputs(paths):
    """Restore the previous publication if any file write or validation fails."""
    import shutil
    import tempfile
    paths = sorted({Path(p).resolve() for p in paths})
    with tempfile.TemporaryDirectory(prefix="video-publication-") as tmp:
        backups = {}
        for i, path in enumerate(paths):
            if path.is_file():
                backup = Path(tmp) / str(i)
                shutil.copy2(path, backup)
                backups[path] = backup
        try:
            yield
        except BaseException:
            for path in paths:
                if path in backups:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(backups[path], path)
                elif path.is_file():
                    path.unlink()
            raise


def publish_files(files):
    """Prepare all files on their target filesystems, then publish with rollback."""
    import os
    import shutil
    import tempfile
    staged = {}
    try:
        for target, source in files.items():
            target = Path(target)
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, raw = tempfile.mkstemp(prefix=".publish-", suffix=target.suffix, dir=target.parent)
            os.close(fd)
            temp = Path(raw)
            staged[target] = temp
            if isinstance(source, bytes):
                temp.write_bytes(source)
            else:
                shutil.copy2(source, temp)
        with rollback_outputs(staged):
            for target, temp in staged.items():
                os.replace(temp, target)
    finally:
        for temp in staged.values():
            temp.unlink(missing_ok=True)

import threading
_lock_context = threading.local()


@contextmanager
def output_locks(ctx, paths):
    """Lock targets exclusively, and ancestors shared, including owned directories."""
    from ve_tools import file_lock
    import hashlib
    handles = []
    held = getattr(_lock_context, 'held', None)
    if held is None:
        held = _lock_context.held = {}
    directory = ctx.work_dir / "output_locks"
    directory.mkdir(parents=True, exist_ok=True)
    targets = {Path(p).resolve() for p in paths}
    modes = {path: file_lock.LOCK_EX for path in targets}
    for path in targets:
        for parent in path.parents:
            if parent == ctx.project_dir.resolve().parent:
                break
            modes.setdefault(parent, file_lock.LOCK_SH)
    try:
        for path, mode in sorted(modes.items()):
            if path in held:
                if mode == file_lock.LOCK_EX and held[path] != file_lock.LOCK_EX:
                    raise ValueError(f'cannot overwrite an active output ancestor: {path}')
                continue
            handle = (directory / (hashlib.sha256(str(path).encode()).hexdigest() + ".lock")).open("a")
            handles.append((path, handle))
            try:
                file_lock.flock(handle, mode | file_lock.LOCK_NB)
                held[path] = mode
            except BlockingIOError as exc:
                raise ValueError(f"output is owned by another active job: {path}") from exc
        yield
    finally:
        for path, handle in reversed(handles):
            held.pop(path, None)
            handle.close()
