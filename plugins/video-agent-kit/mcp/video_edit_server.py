#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from server_common import serve
from ve_tools.catalog import TOOL_SCHEMAS, TOOLS
from ve_tools.run_context import RunContext, load_secrets_into_process


def main() -> None:
    # Tool credentials come from the root-only secrets file (VE_SECRETS_FILE) into this process
    # only; the agent's shell environment never carries them.
    load_secrets_into_process()
    ctx = RunContext(session_kind="mcp")
    serve("video-agent-kit", TOOL_SCHEMAS, TOOLS, ctx)


if __name__ == "__main__":
    main()
