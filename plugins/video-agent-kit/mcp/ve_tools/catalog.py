"""Tool groups exposed by both the MCP server and the CLI."""
from __future__ import annotations

from . import creation, editing, media, model3d, movie_handlers, swap, tts, video_observation, video_sources
from .creation_schemas import TOOL_SCHEMAS as CREATION_SCHEMAS
from .editing_schemas import TOOL_SCHEMAS as EDITING_SCHEMAS
from .model3d_schemas import TOOL_SCHEMAS as MODEL3D_SCHEMAS
from .movie_schemas import TOOL_SCHEMAS as RECAP_SCHEMAS
from .registry import ToolGroup, merge_tool_groups
from .schemas import TOOL_SCHEMAS as SPEECH_SCHEMAS
from .understanding_schemas import TOOL_SCHEMAS as UNDERSTANDING_SCHEMAS


TOOL_GROUPS = (
    ToolGroup(
        name="speech",
        schemas=SPEECH_SCHEMAS,
        implementations={
            "transcribe": media.transcribe,
            "tts_generate": tts.tts_generate,
        },
    ),
    ToolGroup(
        name="understanding",
        schemas=UNDERSTANDING_SCHEMAS,
        implementations={
            "video_search": video_sources.video_search,
            "video_metadata": video_sources.video_metadata,
            "video_download": video_sources.video_download,
            "video_observe": video_observation.video_observe,
            "video_compare": video_sources.video_compare,
        },
    ),
    ToolGroup(
        name="editing",
        schemas=EDITING_SCHEMAS,
        implementations={name: getattr(editing, name) for name in EDITING_SCHEMAS},
    ),
    ToolGroup(name="creation", schemas=CREATION_SCHEMAS,
              implementations={name: getattr(creation, name) for name in CREATION_SCHEMAS}),
    # Hosted 3D assets: generate / rig / animate, one task per call.
    ToolGroup(name="model3d", schemas=MODEL3D_SCHEMAS,
              implementations={name: getattr(model3d, name) for name in MODEL3D_SCHEMAS}),
    # Movie recap: shots, film index, footage arrangement, narration, binding, production.
    # Narration EDLs render through video_render kind=narrated (editing group).
    ToolGroup(name="recap", schemas=RECAP_SCHEMAS,
              implementations={name: getattr(movie_handlers, name) for name in RECAP_SCHEMAS}),
    # Video swap: person-replacement pipeline tools (scan/plan/storyboards/generate/assemble/verify).
    # Skill: skills/video-swap (fault modes D1-D12 in references/pitfalls.md).
    ToolGroup(name="swap", schemas=swap.SWAP_SCHEMAS, implementations=swap.SWAP_IMPLEMENTATIONS),
)

TOOL_SCHEMAS, TOOLS = merge_tool_groups(*TOOL_GROUPS)

# The MCP job envelope keeps the existing public tool set. Direct CLI calls stay synchronous.
import copy
BUSINESS_SCHEMAS = copy.deepcopy(TOOL_SCHEMAS)
TOOL_SCHEMAS = copy.deepcopy(TOOL_SCHEMAS)
from .jobs import augment_schemas
augment_schemas(TOOL_SCHEMAS)
