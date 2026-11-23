from __future__ import annotations


TOOL_SCHEMAS: dict[str, dict] = {
    "transcribe": {
        "description": (
            "Transcribe a local video/audio file with ASR and write a timed "
            "transcript JSON for speech-aware video/audio editing. "
            "provider=auto is a compatibility alias for asr. Long media is "
            "chunked and merged; silent audio returns a valid empty transcript. "
            "The audio is uploaded to the ZCode ASR service (each upload <= 10 MiB, so keep "
            "chunk_seconds at or below the default). The service has no language parameter: "
            "language is recorded on the transcript only."
        ),
        "inputSchema": {
            "type": "object",
            "required": ["input_path"],
            "properties": {
                "input_path": {"type": "string"},
                "output_json": {"type": "string"},
                "provider": {
                    "type": "string",
                    "enum": ["auto", "asr"],
                    "default": "auto",
                },
                "language": {"type": "string", "default": "zh"},
                "chunk_seconds": {"type": "number", "exclusiveMinimum": 0},
                "timeout_seconds": {"type": "number", "exclusiveMinimum": 0},
                "poll_interval_seconds": {"type": "number", "exclusiveMinimum": 0},
                "retries": {"type": "integer", "minimum": 0, "maximum": 10},
                "retry_count": {"type": "integer", "minimum": 0, "maximum": 10},
                "retry_backoff_seconds": {"type": "number", "minimum": 0},
                "work_dir": {"type": "string"},
            },
            "additionalProperties": False,
        },
    },
    "tts_generate": {
        "description": (
            "Generate narration or dialogue audio with the ZCode TTS service (signed-in account, no key). "
            "voice is one of: zixinnansheng (default), elegantgentle-female, livelybreezy-female, "
            "qingshunvsheng, tianrunnvsheng, vibrant-youth, lively-girl, magnetic-voiced-male, "
            "soft-spoken-gentleman, Alfie, Ethan, Matthew (the English-named voices are English voices); "
            "omit it to use VE_TTS_VOICE. Reuse one fixed voice id for every line of the same character. "
            "speed changes the tempo locally (pitch kept). Output is WAV unless mp3/ogg_opus is requested. "
            "Identical requests reuse the recorded audio; a request whose response was lost is not "
            "resubmitted automatically. "
            "voice_card is REQUIRED for video-creation lines (output under out/creation/voice/): "
            "the synthesised line is scored against that character's "
            "voice card (both come from the same preset voice, so a low score means the synthesis "
            "drifted). The score lands in data.voice_card_check and is the same measure "
            "verification uses later. For a line with no character behind it — an audition, a "
            "sound effect, narration in a one-off voice — pass voice_card=\"none\" to skip the "
            "check on the record. voice_card_retries re-synthesises when the two are not the "
            "same voice at all."
        ),
        "inputSchema": {
            "type": "object",
            "required": ["text"],
            "properties": {
                "text": {"type": "string", "maxLength": 1000},
                "voice": {"type": "string", "pattern": "^[A-Za-z0-9_-]{1,64}$",
                          "description": "TTS service voice ID (see the tool description); defaults to VE_TTS_VOICE."},
                "speed": {"type": "number", "minimum": 0.5, "maximum": 2},
                "output_format": {"type": "string", "enum": ["wav", "mp3", "ogg_opus"]},
                "format": {"type": "string", "enum": ["wav", "mp3", "ogg_opus"]},
                "retries": {"type": "integer", "minimum": 0, "maximum": 10, "default": 3},
                "retry_count": {"type": "integer", "minimum": 0, "maximum": 10},
                "retry_backoff_seconds": {"type": "number", "minimum": 0, "default": 3},
                "sample_mode": {"type": "boolean", "default": False},
                "output_path": {"type": "string"},
                "voice_card": {"type": "string", "minLength": 1,
                               "description": "This character's voice card audio; the synthesised "
                                              "line is scored against it (data.voice_card_check). "
                                              "When output_path names a cast_id, this must be that "
                                              "character's card as the plan declares it, and voice "
                                              "must be that character's voice — one character keeps "
                                              "one card and one voice, and a disagreement is "
                                              "refused. Pass \"none\" only for a line with no "
                                              "character card — an audition, the card itself, a "
                                              "sound effect, narration owned by `narrator` — the "
                                              "skip is then on the record."},
                "voice_card_retries": {"type": "integer", "minimum": 0, "maximum": 5,
                                       "description": "Re-synthesise up to this many times while the "
                                                      "line scores below the voice card's fail line. "
                                                      "Needs voice_card. Defaults to 2 when a real "
                                                      "card is given; pass 0 to report without "
                                                      "re-synthesising."},
            },
            "additionalProperties": False,
        },
    },
}
