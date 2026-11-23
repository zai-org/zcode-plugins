"""Public editing schemas, shared by MCP and CLI."""
import json

TOOL_SCHEMAS = json.loads(r'''
{
  "timeline_validate": {
    "description": "Validate timeline structure, source bounds and layout. Does not certify that every effect can render.",
    "inputSchema": {
      "type": "object",
      "required": [
        "timeline_path"
      ],
      "properties": {
        "timeline_path": {
          "type": "string"
        },
        "output_json": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  "timeline_patch": {
    "description": "Preview or apply a structured timeline patch; rejects invalid operations.",
    "inputSchema": {
      "type": "object",
      "required": [
        "timeline_path",
        "instructions"
      ],
      "properties": {
        "timeline_path": {
          "type": "string"
        },
        "instructions": {
          "type": "string"
        },
        "patch": {
          "type": "object"
        },
        "apply": {
          "type": "boolean",
          "default": false
        },
        "output_json": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  "subtitle_build": {
    "description": "Build editable timed cues, ASS and SRT from transcript and current local source.",
    "inputSchema": {
      "type": "object",
      "required": [
        "transcript_path",
        "source"
      ],
      "properties": {
        "transcript_path": {
          "type": "string"
        },
        "preset": {
          "type": "string",
          "enum": [
            "shortform_zh",
            "broadcast",
            "broadcast_en"
          ],
          "default": "shortform_zh"
        },
        "style": {
          "type": "object"
        },
        "speaker_names": {
          "type": "object"
        },
        "language": {
          "type": "string"
        },
        "silence_db": {
          "type": [
            "number",
            "string"
          ],
          "description": "Silence threshold in dB, or 'auto'."
        },
        "min_silence_seconds": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "snap_window_seconds": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "output_json": {
          "type": "string"
        },
        "output_ass": {
          "type": "string"
        },
        "output_srt": {
          "type": "string"
        },
        "source": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  "subtitle_layout": {
    "description": "Sample current video backgrounds and propose subtitle placement/style; returns images for agent review.",
    "inputSchema": {
      "type": "object",
      "required": [
        "source"
      ],
      "properties": {
        "preset": {
          "type": "string",
          "enum": [
            "shortform_zh",
            "broadcast",
            "broadcast_en"
          ],
          "default": "shortform_zh"
        },
        "style": {
          "type": "object"
        },
        "max_frames": {
          "type": "integer",
          "minimum": 2
        },
        "scene_threshold": {
          "type": "number",
          "exclusiveMinimum": 0,
          "exclusiveMaximum": 1
        },
        "frames_dir": {
          "type": "string"
        },
        "output_json": {
          "type": "string"
        },
        "source": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  "speech_index": {
    "description": "Index timed speech, pauses, repetition and a small visual survey for content selection.",
    "inputSchema": {
      "type": "object",
      "required": [
        "source",
        "transcript_path"
      ],
      "properties": {
        "transcript_path": {
          "type": "string"
        },
        "language": {
          "type": "string"
        },
        "unit_pause_seconds": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "max_unit_seconds": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "min_silence_seconds": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "silence_db": {
          "type": [
            "number",
            "string"
          ],
          "description": "Silence threshold in dB, or 'auto'."
        },
        "max_gap": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "visual_survey": {
          "type": "boolean",
          "default": true
        },
        "survey_frames": {
          "type": "integer",
          "minimum": 1
        },
        "scene_threshold": {
          "type": "number",
          "exclusiveMinimum": 0,
          "exclusiveMaximum": 1
        },
        "frames_dir": {
          "type": "string"
        },
        "max_table_rows": {
          "type": "integer",
          "minimum": 1
        },
        "output_json": {
          "type": "string"
        },
        "output_table": {
          "type": "string"
        },
        "source": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  "speech_plan": {
    "description": "Plan a speech cut from selected indexed units; emits timeline, prose script and remapped transcript.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "index_path": {
          "type": "string"
        },
        "keep": {
          "type": "array",
          "items": {
            "type": [
              "string",
              "object"
            ]
          },
          "description": "Unit ids/ranges such as 'u012-u031', or explicit {start,end} ranges."
        },
        "drop": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "tighten_pauses": {
          "type": "boolean",
          "default": true
        },
        "drop_fillers": {
          "type": [
            "boolean",
            "string"
          ],
          "description": "false/off, 'hard', or 'aggressive'."
        },
        "max_gap": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "lead_in": {
          "type": "number",
          "minimum": 0
        },
        "lead_out": {
          "type": "number",
          "minimum": 0
        },
        "min_clip": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "snap_window": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "min_silence_seconds": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "silence_db": {
          "type": [
            "number",
            "string"
          ],
          "description": "Silence threshold in dB, or 'auto'."
        },
        "target_duration": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "target_ratio": {
          "type": "number",
          "exclusiveMinimum": 0
        },
        "output_json": {
          "type": "string"
        },
        "timeline_json": {
          "type": "string"
        },
        "script_md": {
          "type": "string"
        },
        "output_transcript": {
          "type": "string"
        },
        "redline_json": {
          "type": "string"
        },
        "source": {
          "type": "string"
        }
      },
      "additionalProperties": false,
      "required": [
        "index_path"
      ]
    }
  },
  "speaker_audit": {
    "description": "Audit transcript speaker labels and return evidence windows; agent verifies identities.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "transcript_path": {
          "type": "string"
        },
        "window_pad": {
          "type": "number",
          "minimum": 0
        },
        "window_gap": {
          "type": "number",
          "minimum": 0
        },
        "max_windows": {
          "type": "integer",
          "minimum": 1
        },
        "output_json": {
          "type": "string"
        }
      },
      "additionalProperties": false,
      "required": [
        "transcript_path"
      ]
    }
  },
  "speaker_relabel": {
    "description": "Write corrected speaker labels from verified timed assignments; preserve wording.",
    "inputSchema": {
      "type": "object",
      "required": [
        "assignments",
        "transcript_path"
      ],
      "properties": {
        "transcript_path": {
          "type": "string"
        },
        "assignments": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "object",
            "required": [
              "start",
              "end",
              "speaker"
            ],
            "properties": {
              "start": {
                "type": "number",
                "minimum": 0
              },
              "end": {
                "type": "number",
                "minimum": 0
              },
              "speaker": {
                "type": "string"
              }
            },
            "additionalProperties": false
          }
        },
        "snap_seconds": {
          "type": "number",
          "minimum": 0
        },
        "output_path": {
          "type": "string",
          "description": "Corrected copy; defaults to a new output directory. Source is preserved."
        }
      },
      "additionalProperties": false
    }
  },
  "video_render": {
    "description": "Render a project timeline, subtitles, planned speech, or a narration EDL through shared execution. kind selects required inputs: timeline_path; source+subtitles_path; plan_path; narrated: source+edl_path+shots_path+narration_path. Output is MP4. Speech uses hard cuts and preserves planned output times. kind=narrated renders a bind_narration EDL with the synthesize_narration audio, sentence subtitles rebuilt on the output timeline and optional BGM; it rejects reused/overlapping/regressing shot windows and A/V drift, frame-checks every cut (data.seam_scan) and writes render provenance checked by video_qc.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string",
          "description": "Local media path, resolved relative to project directory."
        },
        "timeline_path": {
          "type": "string"
        },
        "plan_path": {
          "type": "string"
        },
        "subtitles_path": {
          "type": "string"
        },
        "output_path": {
          "type": "string"
        },
        "kind": {
          "type": "string",
          "enum": [
            "timeline",
            "subtitles",
            "speech",
            "narrated"
          ]
        },
        "mode": {
          "type": "string",
          "enum": [
            "burn",
            "soft",
            "both"
          ],
          "default": "burn"
        },
        "work_dir": {
          "type": "string"
        },
        "output_width": {
          "type": "integer",
          "minimum": 2
        },
        "output_height": {
          "type": "integer",
          "minimum": 2
        },
        "ass_path": {
          "type": "string"
        },
        "srt_path": {
          "type": "string"
        },
        "crf": {
          "type": "integer",
          "minimum": 0,
          "maximum": 51
        },
        "edl_path": {
          "type": "string",
          "description": "kind=narrated: EDL from bind_narration."
        },
        "shots_path": {
          "type": "string",
          "description": "kind=narrated: shots timeline from detect_shots (shot lookup and EDL gate)."
        },
        "narration_path": {
          "type": "string",
          "description": "kind=narrated: script_tts.json from synthesize_narration (audio and sentence timings)."
        },
        "burn_subtitles": {
          "type": "boolean",
          "default": true,
          "description": "kind=narrated: burn sentence subtitles; fails when no CJK-capable font is found (VE_FONT_DIRS)."
        },
        "subtitle_position": {
          "type": "string",
          "enum": [
            "top",
            "middle",
            "lower",
            "bottom"
          ],
          "default": "lower",
          "description": "kind=narrated."
        },
        "bgm": {
          "type": "boolean",
          "default": false,
          "description": "kind=narrated: mix scene-grouped background music."
        },
        "bgm_dir": {
          "type": "string",
          "description": "kind=narrated: BGM library with <emotion>/*.mp3 subdirectories. Default: VE_BGM_DIR."
        },
        "bgm_volume": {
          "type": "number",
          "exclusiveMinimum": 0,
          "default": 0.06,
          "description": "kind=narrated."
        },
        "bed_volume": {
          "type": "number",
          "minimum": 0,
          "maximum": 1,
          "default": 0.0,
          "description": "kind=narrated: original audio under narration; reviewed original-audio scenes keep their own audio."
        },
        "tail_volume": {
          "type": "number",
          "minimum": 0,
          "maximum": 1,
          "default": 0.0,
          "description": "kind=narrated: original audio in narration breathing tails."
        },
        "narration_gain": {
          "type": "number",
          "exclusiveMinimum": 0,
          "maximum": 4,
          "description": "kind=narrated: narration mixing gain (continuous normalized narration normally uses 1.0)."
        }
      },
      "required": [
        "kind"
      ],
      "additionalProperties": false
    }
  },
  "video_qc": {
    "description": "Check current media technically and optionally against subtitles or a speech plan. kind=subtitles returns cue images; kind=speech returns join images/waveforms. Bindings reject stale renders. Without source, subtitle checks inspect data only.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string",
          "description": "Local media path, resolved relative to project directory."
        },
        "timeline_path": {
          "type": "string"
        },
        "plan_path": {
          "type": "string"
        },
        "subtitles_path": {
          "type": "string"
        },
        "output_json": {
          "type": "string"
        },
        "kind": {
          "type": "string",
          "enum": [
            "video",
            "subtitles",
            "speech"
          ],
          "default": "video"
        },
        "frames_dir": {
          "type": "string"
        },
        "max_evidence_frames": {
          "type": "integer",
          "minimum": 1
        },
        "render_report_path": {
          "type": "string"
        },
        "max_evidence_joins": {
          "type": "integer",
          "minimum": 1
        }
      },
      "additionalProperties": false
    }
  }
}
''')

from .match_schemas import extend_editing
extend_editing(TOOL_SCHEMAS)
