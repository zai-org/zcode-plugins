"""Movie-recap review/production toolkit shipped inside video-agent-kit.

The agent runs the command-line entrypoints in this directory through its shell
(``python3 -B "$VE_RECAP_DIR/<script>.py" ...``). They are standalone tools, not
MCP tools. Text and frame judgments are prepared here and carried out by the
runtime's own review subagents; these processes do not call a separate review or
vision model service, and they persist task, usage and failure state on disk.

Importing the package makes the sibling ``mcp/`` directory importable so the
modules can reuse the shared ``ve_tools`` implementations of the same plugin.
"""
from __future__ import annotations

import sys
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = PACKAGE_DIR.parent
MCP_DIR = PLUGIN_ROOT / "mcp"

if not (MCP_DIR / "ve_tools").is_dir():
    raise ImportError("recap requires the video-agent-kit mcp/ve_tools package next to it")
if str(MCP_DIR) not in sys.path:
    sys.path.insert(0, str(MCP_DIR))
