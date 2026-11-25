"""Match-specific options on the existing public tools."""
import copy

PATH = {"type": "string"}
PATHS = {"type": "object", "additionalProperties": PATH}
ARRANGE_OPTIONS = {
    "sport": {"type": "string", "enum": ["soccer", "basketball", "lol"]},
    "parts": {"type": "array", "minItems": 1, "items": {
        "type": "object", "required": ["video"], "properties": {"video": PATH, "name": PATH}, "additionalProperties": False}},
    "home": PATH, "away": PATH, "event_title": PATH, "labels_path": PATH,
    "match_path": PATH, "transcript_paths": PATHS, "shots_paths": PATHS,
    "events_path": PATH, "out_dir": PATH, "render_report_path": PATH, "review_path": PATH,
}
RENDER_OPTIONS = {"reel_path": PATH, "outline_path": PATH}


def extend_recap(schemas):
    for name in ("arrange_footage", "synthesize_narration"):
        schemas[name]["inputSchema"]["properties"]["mode"] = {
            "type": "string", "enum": ["movie", "match"],
            "description": "movie (default): existing movie contracts. match: match workflow contracts."}
    arrange = schemas["arrange_footage"]
    arrange["inputSchema"]["properties"].update(copy.deepcopy(ARRANGE_OPTIONS))
    arrange["inputSchema"]["properties"]["action"]["enum"].extend(["ingest", "review_prepare", "review_import"])
    arrange["description"] += (
        " mode=match: action=ingest requires sport, home, away and ordered parts[{video,name?}]; "
        "optional soccer labels_path reads event annotations. action=dialogue requires match_path and "
        "transcript_paths mapping part ids to source-bound transcriptions; writes a C-numbered commentary axis. "
        "action=arrange requires match_path and outline_path; soccer also requires shots_paths for all parts "
        "and yields a footage window/writing brief before TTS. Basketball/LoL require script_path from "
        "synthesize_narration mode=match and optionally events_path [{game,src_start,src_end,event_t?}]; "
        "fits clips to measured speech and confirmed action anchors. Long narration gaps are review evidence. "
        "action=review_prepare requires render_report_path: prepares one consolidated sampled review, at most six windows. "
        "action=review_import requires review_path: records actual observations; only concrete delivery errors allow "
        "one targeted repair/recheck. Unseen/unheard work stays unverified. The project ledger survives rerenders; "
        "neither review action calls a model API or extracts media. "
        "Match artifacts default to out/ (out_dir). Inapplicable mode/action parameters are rejected.")
    schemas["synthesize_narration"]["description"] += (
        " mode=match accepts script_path {beats:[{idx,sentences:[{text,t?,tier?,hard?,anchor?,offset?}]}]}, "
        "voice, rate, audio_dir and output_json only. Uses the shared TTS request adapter once per sentence; "
        "tier 0/1/2 scales speed by 1/1.06/1.12 with a single fixed voice. Writes measured sentence audio "
        "and current script/audio digests for match arrangement and rendering.")


def extend_editing(schemas):
    render = schemas["video_render"]
    render["inputSchema"]["properties"]["kind"]["enum"].append("match")
    render["inputSchema"]["properties"].update(copy.deepcopy(RENDER_OPTIONS))
    render["description"] += (
        " kind=match requires reel_path, narration_path and outline_path from match arrangement/synthesis. "
        "Optional output_path, work_dir and subtitle_position. Reuses the soccer or basketball/LoL render "
        "kernel with action-pinned speech, original-audio ducking and sentence subtitles. Publishes "
        "<output>.qc.json, <output>.placement.json and <output>.render_report.json bound to input bytes. "
        "Output is 1280x720 at 25fps. Repeated teasers and reviewed replays are allowed by the match plan; "
        "technical success still needs one bounded sampled review through arrange_footage mode=match action=review_prepare. "
        "Report playback/listening limits; do not repeat whole-cut reviews or open per-window reviewers.")
