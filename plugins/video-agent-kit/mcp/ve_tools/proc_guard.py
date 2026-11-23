"""Process-level guard: never let child processes inherit our stdin.

The MCP server talks JSON-RPC over stdin/stdout. Every ``subprocess.run`` /
``Popen`` that does not redirect stdin hands the *same* pipe to the child;
ffmpeg (interactive by default) then reads and "executes" the client's next
JSON-RPC frame (``ping`` / ``notifications/cancelled`` / the next
``tools/call``) -- reproduced with ffmpeg 6.1: the whole frame vanished and the
client waited until the tool timeout. Patching the two constructors once here
covers all call sites (server, CLI, hooks) without touching each command.

Explicit ``stdin=`` or ``input=`` arguments are respected.
"""
from __future__ import annotations

import subprocess

_INSTALLED = False


def install() -> None:
    global _INSTALLED
    if _INSTALLED:
        return
    _INSTALLED = True

    orig_run = subprocess.run
    orig_popen_init = subprocess.Popen.__init__

    def run(*args, **kwargs):  # noqa: ANN001, ANN202
        if "stdin" not in kwargs and kwargs.get("input") is None:
            kwargs["stdin"] = subprocess.DEVNULL
        return orig_run(*args, **kwargs)

    def popen_init(self, *args, **kwargs):  # noqa: ANN001, ANN202
        if "stdin" not in kwargs and len(args) < 4:  # positional stdin is the 4th arg
            kwargs["stdin"] = subprocess.DEVNULL
        return orig_popen_init(self, *args, **kwargs)

    subprocess.run = run
    subprocess.Popen.__init__ = popen_init
