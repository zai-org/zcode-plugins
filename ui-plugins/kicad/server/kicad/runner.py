"""Subprocess helpers around KiCad's bundled python and kicad-cli (always isolated: KiCad can crash/hang)."""
from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from . import paths

SCRIPTS = Path(__file__).parent / "scripts"
_NOISE = re.compile(r"(assert .* failed in Get\(\): create wxApp|^\s*$)")


class KiCadError(RuntimeError):
    """A KiCad subprocess failed. ``str(e)`` is safe to show to the agent."""


@dataclass
class Proc:
    returncode: int
    stdout: str
    stderr: str


def _clean(s: str, limit: int = 2000) -> str:
    lines = [ln for ln in s.splitlines() if not _NOISE.search(ln)]
    out = "\n".join(lines).strip()
    return out[-limit:]


def run(cmd: list[str], timeout: float = 120, cwd: Path | None = None) -> Proc:
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, cwd=str(cwd) if cwd else None, env=paths.kicad_env(),
        )
    except subprocess.TimeoutExpired as e:
        raise KiCadError(f"KiCad command timed out after {timeout:.0f}s: {' '.join(Path(c).name for c in cmd[:3])}") from e
    return Proc(r.returncode, r.stdout, r.stderr)


def run_pcb_script(mode: str, job: dict, workdir: Path, timeout: float = 180) -> None:
    """Run scripts/pcb_build.py <mode> inside KiCad's python with ``job`` as JSON."""
    jp = Path(workdir) / f"job_{mode}.json"
    jp.write_text(json.dumps(job))
    p = run([str(paths.kicad_python()), str(SCRIPTS / "pcb_build.py"), mode, str(jp)], timeout=timeout, cwd=workdir)
    if p.returncode != 0 or "OK" not in p.stdout:
        raise KiCadError(f"pcbnew script '{mode}' failed (exit {p.returncode}): {_clean(p.stderr) or _clean(p.stdout)}")


def run_cli(args: list[str], timeout: float = 180, cwd: Path | None = None, ok_codes: tuple[int, ...] = (0,)) -> Proc:
    p = run([str(paths.kicad_cli()), *args], timeout=timeout, cwd=cwd)
    if p.returncode not in ok_codes:
        raise KiCadError(f"kicad-cli {' '.join(args[:3])} failed (exit {p.returncode}): {_clean(p.stderr) or _clean(p.stdout)}")
    return p
