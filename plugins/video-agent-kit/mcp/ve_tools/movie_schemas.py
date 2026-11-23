"""Movie recap tools: shot detection, film indexing, footage arrangement, narration and binding.

Rendering a narration EDL is video_render kind=narrated (editing_schemas).
"""
import json

TOOL_SCHEMAS = json.loads(r'''
{
  "detect_shots": {
    "description": "Detect contiguous shot boundaries with PySceneDetect; no model API. Cache inputs bind the source and detection parameters. Coarse results are saved before optional boundary refinement, whose per-boundary checkpoint supports interruption recovery. Default parameters merge sub-min_len shots and refine all boundaries. preserve_short_shots=true requires min_len=0 and frame_skip=0, keeps detected short inserts and collects local candidate thumbnail signals during the scan. Coarse-first movie profiles call this with refine=false and preserve the resulting shots.json as their evidence index; production preparation later refines selected shots and bounded backups into shots_refined.json using the same shot IDs. Refinement records hard, soft or unknown boundaries; final cuts still require actual render checks. force=true redetects and invalidates dependent observations; do not use it to repair an already observed timeline.",
    "inputSchema": {
      "type": "object",
      "required": [
        "input_path"
      ],
      "properties": {
        "input_path": {
          "type": "string"
        },
        "output_json": {
          "type": "string",
          "default": "out/shots.json"
        },
        "threshold": {
          "type": "number",
          "exclusiveMinimum": 0,
          "default": 27.0,
          "description": "ContentDetector cut sensitivity; lower detects more cuts."
        },
        "min_len": {
          "type": "number",
          "minimum": 0,
          "default": 0.8,
          "description": "Shots shorter than this are merged into neighbors instead of dropped, keeping coverage gap-free."
        },
        "frame_skip": {
          "type": "integer",
          "minimum": 0,
          "default": 0
        },
        "preserve_short_shots": {
          "type": "boolean",
          "default": false,
          "description": "Movie coarse mode: keep short inserts and collect local thumbnail signals during detection. Requires min_len=0 and frame_skip=0."
        },
        "refine": {
          "type": "boolean",
          "default": true,
          "description": "Refine all boundaries now (ffmpeg + numpy). Coarse-first profiles use false; selected production cuts are refined later."
        },
        "force": {
          "type": "boolean",
          "default": false,
          "description": "Ignore an existing matching cache and redetect."
        }
      },
      "additionalProperties": false
    }
  },
  "build_film_index": {
    "description": "Probe a movie, run native ASR and shot detection concurrently, then build the dialogue axis and film_index.json. Reuse only source-bound completed products; uncached ASR calls its speech service. A production profile with shot_strategy=coarse-first-v1 preserves coarse shots and same-scan local candidate signals. Dialogue clusters and ASR gaps locate time windows, not observed scenes. Sparse dialogue remains a warning in this mode. Frame evidence comes later from the recap observation stage. Other profiles retain the original indexing behavior.",
    "inputSchema": {
      "type": "object",
      "required": [
        "input_path"
      ],
      "properties": {
        "input_path": {
          "type": "string",
          "description": "Source film path."
        },
        "language": {
          "type": "string",
          "description": "ASR language (zh for Chinese films, auto for foreign — never a concrete foreign code, it kills speaker diarization)."
        },
        "output_json": {
          "type": "string",
          "description": "Default: out/film_index.json"
        }
      },
      "additionalProperties": false
    }
  },
  "arrange_footage": {
    "description": "Deterministic footage arranger for dialogue-driven movie recaps (arrange-footage-first, write-narration-second). Three actions, no model API calls anywhere. action=dialogue converts a speaker-labelled transcript into a numbered dialogue axis (D0001[84s] speaker: line) plus dialogue_index.json — the single authority for D-ids the agent must cite when writing the outline. action=arrange turns dialogue_index + shots timeline + an agent-written outline (beats -> 2-4 points, each citing D-ids) + target minutes into a per-beat footage reel: each point is anchored at its cited dialogue moment and takes a continuous whole-shot block from there (a global monotonic cursor never rewinds; new seams only appear at point/beat boundaries; the first piece of every block must be >=1.5s to avoid short flashes), per-point seconds are normalized from the target length, and when the total reel overruns target/narration_ratio by >3% whole spans are trimmed back from the longest beats' tails; outputs reel.json, plan.json and a writing brief with hard char budgets per beat AND per point. An invalid outline returns a structured outline_invalid error for the agent to rewrite. action=anchor merges the agent-written narration (beats -> sentences tagged with their point number) with the reel: sentences are mechanically re-split on punctuation, bound to their OWN point's footage block (shots assigned by midpoint to exactly one sentence, so anchor sets are disjoint), and emitted as narration_script.json + graph.json for TTS and bind_narration; beats whose narration cannot physically fit their footage window (or whose film total exceeds the target length by >25%) return a structured over_budget error listing them so the agent shortens the text. action=refit (audio-first) runs AFTER TTS: it re-takes each beat's footage from its stored time window sized to the beat's REAL audio duration (script_tts.json), writing reel_fit.json — footage yields to audio. produce_film orchestrates refit only when fit_mode=legacy is explicitly selected; the default whole_shot flow fits pictures inside the windows the picture check already looked at.",
    "inputSchema": {
      "type": "object",
      "required": [
        "action"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "dialogue",
            "arrange",
            "anchor",
            "refit"
          ]
        },
        "tts_path": {
          "type": "string",
          "description": "refit: script_tts.json from synthesize_narration (real per-beat audio durations)."
        },
        "output_reel": {
          "type": "string",
          "description": "refit: output reel path. Default: out/reel_fit.json"
        },
        "budget_check": {
          "type": "boolean",
          "description": "anchor: set false to skip the over_budget gate (used by produce_film's re-anchor after refit). Default: true"
        },
        "transcript_path": {
          "type": "string",
          "description": "dialogue: speaker-labelled transcript JSON (transcribe output or segments array)."
        },
        "output_txt": {
          "type": "string",
          "description": "dialogue: dialogue axis path. Default: out/dialogue_axis.txt"
        },
        "output_json": {
          "type": "string",
          "description": "dialogue: dialogue index path. Default: out/dialogue_index.json"
        },
        "dialogue_index_path": {
          "type": "string",
          "description": "arrange: dialogue_index.json from action=dialogue."
        },
        "shots_path": {
          "type": "string",
          "description": "arrange: shots timeline from detect_shots."
        },
        "outline_path": {
          "type": "string",
          "description": "arrange: agent-written outline JSON (characters + beats/points/dlg)."
        },
        "visual_index_path": {
          "type": "string",
          "description": "arrange: visual_index.json from the film-watching step. Required when any outline point cites only V-ids (wordless plot evidence); V-ids are resolved to film time via this index."
        },
        "minutes": {
          "type": "number",
          "exclusiveMinimum": 0,
          "description": "arrange: target output minutes."
        },
        "sec_per_point": {
          "type": "number",
          "exclusiveMinimum": 0,
          "description": "arrange: override the normalized per-point footage seconds (regression/replay use)."
        },
        "chars_per_sec": {
          "type": "number",
          "minimum": 2,
          "maximum": 7,
          "description": "arrange: narration speaking rate used for the word-count budget (default 3.4; measure the selected TTS voice before large runs). Carried into reel.json and reused by action=anchor."
        },
        "trim": {
          "type": "boolean",
          "default": true,
          "description": "arrange: trim reel overrun back to target (disable only for replay)."
        },
        "reel_json": {
          "type": "string",
          "description": "arrange: reel output. Default: out/reel.json"
        },
        "plan_json": {
          "type": "string",
          "description": "arrange: plan output. Default: out/plan.json"
        },
        "brief_txt": {
          "type": "string",
          "description": "arrange: writing brief output. Default: out/writing_brief.txt"
        },
        "reel_path": {
          "type": "string",
          "description": "anchor: reel.json from action=arrange."
        },
        "plan_path": {
          "type": "string",
          "description": "anchor: plan.json from action=arrange."
        },
        "script_path": {
          "type": "string",
          "description": "anchor: agent-written narration JSON {beats:[{idx,sentences:[{text,point}]}]}."
        },
        "title": {
          "type": "string",
          "description": "anchor: film title recorded in the graph."
        },
        "output_script": {
          "type": "string",
          "description": "anchor: narration script output. Default: out/narration_script.json"
        },
        "output_graph": {
          "type": "string",
          "description": "anchor: event graph output. Default: out/graph.json"
        }
      },
      "additionalProperties": false
    }
  },
  "synthesize_narration": {
    "description": "Batch-synthesize commentary narration audio from a narration script.json (array of segments with seg_id/text/semantic_units, produced by arrange_footage action=anchor). For each segment it synthesizes one audio file (paragraph mode by default; by_sentence=true synthesizes per sentence and concatenates), then writes script_tts.json with segment-level audio_path/audio_dur/speech_dur/delivery_pause_sec plus a per-sentence sentences[] timeline (start/end offsets estimated from speech weight) that downstream shot binding relies on. Optional semantic_out writes a flat semantic timeline with per-sentence global offsets. Uses the shared TTS with one fixed preset voice for the whole film; identical requests reuse recorded audio and a lost response is never resubmitted automatically. Segment results are cached by a fingerprint of spoken text + semantic-unit mapping + pause + voice + rate, so unchanged segments are never re-synthesized while any script or voice change forces regeneration. With require_complete=true (default) any failed segment returns an error listing missing seg_ids and output_json is not written (per-file audio cache is kept for reruns); with false a partial output_json is written and flagged.",
    "inputSchema": {
      "type": "object",
      "required": [
        "script_path"
      ],
      "properties": {
        "style_instructions": {
          "type": "string",
          "description": "Global narration style. Recorded and part of the audio cache key, but the current TTS service does not take style instructions. Pass it unchanged when a recap command hands this call off."
        },
        "script_path": {
          "type": "string"
        },
        "output_json": {
          "type": "string",
          "default": "out/script_tts.json"
        },
        "audio_dir": {
          "type": "string",
          "default": ".video_agent/narration_tts"
        },
        "provider": {
          "type": "string",
          "enum": [
            "tts"
          ],
          "default": "tts",
          "description": "Compatibility field: only one TTS provider is available."
        },
        "voice": {
          "type": "string",
          "pattern": "^[A-Za-z0-9_-]{1,64}$",
          "description": "Voice ID for the configured TTS service. Defaults to VE_TTS_VOICE."
        },
        "rate": {
          "type": "string",
          "description": "Rate like +6% or -10%; mapped to TTS speed. Default: VE_NARRATION_TTS_RATE env, else +0%."
        },
        "continuous_delivery": {
          "type": "boolean",
          "default": false,
          "description": "Require ASR-aligned continuous paragraphs and normalize delivery."
        },
        "by_sentence": {
          "type": "boolean",
          "default": false,
          "description": "Synthesize per sentence and concatenate; gives real per-sentence timings and starves LLM-TTS of rewrite room."
        },
        "flatten_quotes": {
          "type": "boolean",
          "default": false,
          "description": "De-dramatize spoken text before synthesis: full-width colons become commas and quote marks are removed (punctuation only, words untouched; subtitles keep the original text). Prevents LLM-TTS from treating 'X said:' as a script speaker tag — measured failure mode: dropped attribution clauses, voice-acted quotes, invented dialogue."
        },
        "verify": {
          "type": "string",
          "enum": [
            "asr"
          ],
          "description": "Post-synthesis fidelity check: each segment audio is transcribed back (native ASR) and every sentence is checked by 4-gram content hit plus duration-vs-chars plausibility (ASR alone under-transcribes, duration is the independent second signal). hit<0.35 or duration outlier = bad; 0.35-0.7 = grey. Bad AND grey sentences are re-synthesized (per-sentence cache file deleted) for up to verify_retries rounds; only a still-grey final round is accepted as warn — grey no longer slips through unhealed. Short sentences (<6 chars) need dual evidence (zero hit + duration outlier). If ASR itself is unavailable, status is capped at warn with reason=asr_unavailable (never a fake pass). Speaker count >1 in narration is reported as a warning (voice-acted quotes). pass/warn are terminal; reruns re-verify only missing/failed segments."
        },
        "verify_retries": {
          "type": "integer",
          "minimum": 0,
          "maximum": 3,
          "default": 2,
          "description": "Max heal rounds per segment when verify finds bad sentences."
        },
        "semantic_out": {
          "type": "string"
        },
        "require_complete": {
          "type": "boolean",
          "default": true
        }
      },
      "additionalProperties": false
    }
  },
  "bind_narration": {
    "description": "Deterministically bind synthesized narration sentences (script_tts.json) to source footage and emit a render-ready EDL (schema 3.2-reel) plus a hard-QC report: zero shot reuse, monotonic source time, no short flashes, bounded breathing tails. fit_mode=whole_shot (default) lays chains of WHOLE shots per event from the event pool (writer-cited main shots as the spine, in-pool fill shots by film order), so every cut lands on a real shot boundary; shots longer than ~9s are portioned. The narration is voiced first and the whole film is arranged on that audio; the picture check looks at every sentence's exact windows before this binding, and the final fit keeps the checked windows (recorded swaps included). Tool-added fill shots and long-shot portions are listed under data.needs_review for the final review of the rendered film; an event that cannot be filled returns cannot_fill. Also writes out/fit_report.json. fit_mode=legacy binds with the tape-DP kernel inside each beat's reel tape (after arrange_footage action=refit), with optional original-audio inserts and tail_mode. Failures are structured [ERROR]s (footage_shortage, duration_mismatch, cannot_fill, QC failure) naming the beat and required vs available seconds: shorten that narration, re-synthesize and bind again. No model API calls. Render the EDL with video_render kind=narrated.",
    "inputSchema": {
      "type": "object",
      "required": [
        "script_path",
        "graph_path",
        "timeline_path",
        "reel_path"
      ],
      "properties": {
        "fit_mode": {
          "type": "string",
          "enum": [
            "whole_shot",
            "legacy"
          ],
          "default": "whole_shot",
          "description": "whole_shot (default): event-level whole-shot fit; inputs need the frame-refined shots timeline and per-sentence cited_shot_ids. legacy: tape-DP binding within each reel tape after arrange_footage action=refit."
        },
        "script_path": {
          "type": "string",
          "description": "script_tts.json from synthesize_narration."
        },
        "graph_path": {
          "type": "string",
          "description": "Event graph JSON from arrange_footage action=anchor."
        },
        "timeline_path": {
          "type": "string",
          "description": "Production shot timeline. Coarse-first movie profiles use shots_refined.json; other profiles use the refined shots.json from detect_shots (segment_version cover-all-v3-frame)."
        },
        "reel_path": {
          "type": "string",
          "description": "Reel JSON from arrange_footage; each event window bounds its shot pool (legacy: each segment binds only within its own reel tape)."
        },
        "output_edl": {
          "type": "string",
          "description": "Output EDL path. Default: out/edl.json"
        },
        "qc_json": {
          "type": "string",
          "description": "Output QC report path. Default: out/edl_qc.json"
        },
        "avoid_shot_ids": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Shot ids to avoid film-wide after a review found sentence/visual contradictions."
        },
        "fit_report": {
          "type": "string",
          "description": "whole_shot: Output per-event fit report path (spine/fill/partials/review status). Default: out/fit_report.json"
        },
        "fit_review_path": {
          "type": "string",
          "description": "whole_shot: Review state JSON (per-event rounds + approved_chain fingerprint); pass to persist the review state machine across calls."
        },
        "avoid_shot_ids_by_seg": {
          "type": "object",
          "description": "whole_shot: Per-event rejected fill shots: {seg_id: [shot_id,...]}. Re-fit those events excluding them."
        },
        "inserts_path": {
          "type": "string",
          "description": "legacy: Optional original-audio inserts JSON; reserved mode auto-degrades to replay when it would starve narration footage."
        },
        "tail_mode": {
          "type": "string",
          "enum": [
            "highlight",
            "all",
            "none"
          ],
          "default": "highlight",
          "description": "legacy: Breathing-tail policy. \"highlight\" (default): only beats marked highlight=true in the writer script get a <=3s tail — gaps are punctuation, not spaces; a gap after every beat reads as slack pacing. \"all\": legacy every-beat tails. \"none\": no tails."
        }
      },
      "additionalProperties": false
    }
  },
  "produce_film": {
    "description": "Assemble a movie recap using whole_shot picture fitting, continuous paragraph narration with ASR verification, reviewed original-audio scenes, subtitles and QC. Voice defaults to VE_TTS_VOICE; other defaults: continuous_delivery=true, fit_mode=whole_shot, bed_volume=0, tail_volume=0, bgm=false. Run recap_script.py prepare-production first: it confirms the script review, voices and verifies the narration, arranges the whole film on that audio and checks the pictures inside those windows; produce_film reuses exactly that audio and those windows and refuses to start when the prepared version no longer matches. Incomplete speech verification stops production. render=false assembles a reviewable EDL without final rendering; legacy fitting remains an explicit compatibility option. Unchanged inputs reuse cached stages.",
    "inputSchema": {
      "type": "object",
      "required": [
        "video_path",
        "script_path"
      ],
      "properties": {
        "video_path": {
          "type": "string",
          "description": "Source film path."
        },
        "script_path": {
          "type": "string",
          "description": "Writer script (out/writer_script.json)."
        },
        "title": {
          "type": "string"
        },
        "avoid_shot_ids": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Shots to exclude when re-binding (from spot-check contradiction/irrelevant windows)."
        },
        "render": {
          "type": "boolean",
          "default": true,
          "description": "false = stop after bind (out/edl.json); do the four-tier spot-check on the EDL first, then call again with render=true (cached steps are free)."
        },
        "style_instructions": {
          "type": "string",
          "description": "Override the built-in global narration style (rarely needed). The current TTS service does not take style instructions; the text is recorded but has no audible effect."
        },
        "voice": {
          "type": "string",
          "pattern": "^[A-Za-z0-9_-]{1,64}$",
          "description": "Voice ID for the configured TTS service, used for every narration paragraph. Defaults to VE_TTS_VOICE."
        },
        "provider": {
          "type": "string",
          "enum": [
            "tts"
          ],
          "default": "tts",
          "description": "Compatibility field: only one TTS provider is available."
        },
        "continuous_delivery": {
          "type": "boolean",
          "default": true,
          "description": "Continuous paragraph TTS with ASR word alignment, normalized loudness and transition pauses."
        },
        "original_audio_path": {
          "type": "string",
          "description": "Reviewed continuous original-audio scenes JSON."
        },
        "shot_ranges_path": {
          "type": "string",
          "description": "Reviewed action-complete source ranges keyed by shot ID."
        },
        "narration_gain": {
          "type": "number",
          "default": 1.0
        },
        "tail_volume": {
          "type": "number",
          "default": 0.0
        },
        "bed_volume": {
          "type": "number",
          "default": 0.0
        },
        "bgm": {
          "type": "boolean",
          "default": false
        },
        "reel_path": {
          "type": "string"
        },
        "plan_path": {
          "type": "string"
        },
        "timeline_path": {
          "type": "string"
        },
        "fit_mode": {
          "type": "string",
          "enum": [
            "legacy",
            "whole_shot"
          ],
          "default": "whole_shot",
          "description": "legacy = refit + tape-DP binding (cuts shots into windows mid-shot). whole_shot = event-level whole-shot fit (cuts only on shot boundaries, no cut flash; fill shots go through model review before finalizing). Same modes as bind_narration fit_mode."
        },
        "approve_segments": {
          "description": "whole_shot review: seg_ids (or {seg_id: chain_fp}) whose latest whole-shot chain the model has reviewed and ACCEPTED. The chain fingerprint is read from out/fit_report.json when omitted. Approved events drop out of the review queue on the next call.",
          "oneOf": [
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            {
              "type": "object"
            }
          ]
        },
        "avoid_shot_ids_by_seg": {
          "type": "object",
          "description": "whole_shot review: {seg_id: [shot_id,...]} fill shots the model REJECTED for that event. Increments the event's review round and re-fits without them; at 3 rounds the event returns cannot_fill."
        },
        "fit_review_path": {
          "type": "string",
          "description": "whole_shot: review state file (per-event rounds/approved_chain). Default: out/fit_review.json"
        },
        "graph_path": {
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  }
}
''')

from .match_schemas import extend_recap
extend_recap(TOOL_SCHEMAS)
