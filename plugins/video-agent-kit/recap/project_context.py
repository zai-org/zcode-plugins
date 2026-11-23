"""RunContext bound to an explicit project root (workers and status readers)."""
from __future__ import annotations

from pathlib import Path

from ve_tools.recap_security import private_directory
from ve_tools.run_context import RunContext, project_dir


def default_root() -> Path:
    """Project root for a CLI run: the environment, else the working directory."""
    return project_dir()


def bind_root(root: str | Path) -> Path:
    """Resolve a --root/--out argument and make the whole process agree with it.

    ``clean_env`` locates .env files through ``VE_PROJECT_DIR``, so a CLI that
    only passed the root to its context would still read another project's
    configuration.
    """
    import os

    from ve_tools.visual_review import ReviewError
    resolved = Path(root).expanduser().resolve()
    if not resolved.is_dir():
        raise ReviewError("project_root_not_found", diagnostics={"root": str(resolved)})
    os.environ["VE_PROJECT_DIR"] = str(resolved)
    return resolved


class ProjectContext(RunContext):
    """Native RunContext path semantics without changing the process project dir.

    The shared RunContext follows the process environment (VE_PROJECT_DIR/cwd).
    Recap CLIs and host-side status readers also need an explicit root.
    """

    def __init__(self, session_kind: str = "cli", *, project_root: str | Path | None = None,
                 create_dirs: bool = True) -> None:
        self.session_kind = session_kind
        self.project_dir = Path(project_root).resolve() if project_root is not None else project_dir()
        self.output_dir = self.project_dir / "out"
        self.work_dir = self.project_dir / ".video_agent"
        if create_dirs:
            private_directory(self.output_dir)
            private_directory(self.work_dir)
