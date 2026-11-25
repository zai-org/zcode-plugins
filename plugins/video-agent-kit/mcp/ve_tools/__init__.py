"""Implementation layer for video-agent-kit MCP tools."""

from . import proc_guard as _proc_guard

# ffmpeg/ffprobe children must not inherit the MCP stdio pipe (see proc_guard).
_proc_guard.install()
