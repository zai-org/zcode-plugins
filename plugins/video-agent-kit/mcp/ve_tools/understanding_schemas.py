"""Public schemas for shared video understanding capabilities."""
from __future__ import annotations

SITES = ["commons", "bilibili", "peertube", "dailymotion", "niconico", "acfun", "nasa"]
SOURCE = {"type": "string", "minLength": 1,
          "description": "Local file path, a supported video page URL, or a source id returned by video_search."}


def _schema(description: str, required: list[str], properties: dict) -> dict:
    return {"description": description,
            "inputSchema": {"type": "object", "required": required,
                            "properties": properties, "additionalProperties": False}}


TOOL_SCHEMAS = {
    "video_search": _schema(
        "Search supported full-video sites. Returns source ids, URLs, metadata, per-site pages and errors. "
        "Use short topic keywords, translate queries when useful, and observe candidate content before concluding.",
        ["query"], {"query": {"type": "string", "minLength": 1},
                    "page": {"type": "integer", "minimum": 1, "default": 1},
                    "sites": {"type": "array", "minItems": 1, "uniqueItems": True,
                              "items": {"type": "string", "enum": SITES}}}),
    "video_metadata": _schema(
        "Read local image/video metadata or remote video metadata. Local metadata includes duration and audio/subtitle "
        "availability; remote metadata includes available title, uploader, date, description and parts. "
        "Metadata alone does not verify video content.", ["source"], {"source": SOURCE}),
    "video_download": _schema(
        "Download a supported remote video in full to a unique directory in the workspace. Returns local path, "
        "measured duration and available source metadata. Does not silently truncate the video.",
        ["source"], {"source": SOURCE, "dest_dir": {"type": "string"}}),
    "video_observe": _schema(
        "Observe a local video/image or supported remote video using one shared interface. For videos choose a time "
        "window in seconds and fps or num_frames. Returns timestamped frames or contact sheets with an evidence index; "
        "sampling is capped and missing evidence is reported. include_transcript reuses embedded subtitles or the shared "
        "speech transcription backend; an empty transcript describes only the requested window. Raw audio is not returned.",
        ["source"], {"source": SOURCE,
                     "start_s": {"type": "number", "minimum": 0, "default": 0},
                     "end_s": {"type": "number", "minimum": 0},
                     "fps": {"type": "number", "exclusiveMinimum": 0},
                     "num_frames": {"type": "integer", "minimum": 1},
                     "layout": {"type": "string", "enum": ["frames", "contact_sheet"], "default": "contact_sheet"},
                     "include_frames": {"type": "boolean",
                                        "description": "Defaults to true, or false when include_transcript is true."},
                     "include_transcript": {"type": "boolean", "default": False},
                     "language": {"type": "string", "default": "auto"}}),
    "video_compare": _schema(
        "Compare local or supported remote footage with perceptual hashes and optional temporal alignment. "
        "Returns match scores and timestamps; supports clips and images. This is a similarity check, not semantic "
        "proof of the same event, person or place. Low-texture footage can give misleading matches.",
        ["source", "candidate"], {"source": SOURCE, "candidate": SOURCE,
                                  "offset_s": {"type": "number", "minimum": 0},
                                  "crop": {"type": "string",
                                           "description": "Optional crop expression on the candidate; the literal value 'default' selects the central region."},
                                  "threshold": {"type": "integer", "minimum": 1, "maximum": 32, "default": 10}}),
}
