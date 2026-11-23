"""Public creation contracts shared by MCP and CLI."""
TOOL_SCHEMAS = {'creation_plan_validate': {'inputSchema': {'type': 'object',
                                            'properties': {'shotlist': {'type': 'object'},
                                                           'shotlist_path': {'type': 'string'},
                                                           'target_total_seconds': {'type': 'number',
                                                                                    'exclusiveMinimum': 0},
                                                           'tolerance': {'type': 'number',
                                                                         'minimum': 0,
                                                                         'maximum': 1,
                                                                         'default': 0.2},
                                                           'shot_max_seconds': {'type': 'number',
                                                                                'exclusiveMinimum': 0,
                                                                                'default': 30},
                                                           'require_reference_images': {'type': 'boolean',
                                                                                        'default': False},
                                                           'output_json': {'type': 'string',
                                                                           'default': 'out/creation/shotlist_validation.json'}},
                                            'additionalProperties': False},
                            'description': 'Validate an explicit creation plan (v2 shots or v4 sequences), genre, '
                                           'references, directing/state contract, provider limits and cumulative '
                                           'generation budget. Duration is configured by the project, independent of '
                                           'schema; film is the default format. Returns per-unit hashes and errors '
                                           'before generation. Narrative formats also must pass the story layer: every beat has emotion (a turn written A → B), '
                                           'hook and stake; at least one beat per ~15s of screen time and per covered scene; every '
                                           'speaking cast member has motivation{want,need,flaw} (want and need required); every '
                                           'shots[].intent states narrative duty in >= 25 characters and does not repeat '
                                           'required_visuals. Narrative plans are also checked against their screenplay '
                                           '(out/screenplay.md or the plan\'s screenplay path): segments of at most 15s, every '
                                           'segment filmed by a unit naming it in segment, every plan line found in the '
                                           'screenplay; units describe shots as blocks[{start,end,framing,movement,action,'
                                           'line?,sound?}] and the tool compiles prompt/video_prompt from setting, blocks and '
                                           'notes into the plan file. Other formats get these as advisories.'},
 'image_generate': {'inputSchema': {'type': 'object',
                                    'required': ['items'],
                                    'properties': {'items': {'type': 'array',
                                                             'minItems': 1,
                                                             'items': {'type': 'object',
                                                                       'required': ['id', 'prompt'],
                                                                       'properties': {'id': {'type': 'string'},
                                                                                      'prompt': {'type': 'string'},
                                                                                      'reference_images': {'type': 'array',
                                                                                                           'items': {'anyOf': [{'type': 'string'},
                                                                                                                               {'type': 'object',
                                                                                                                                'properties': {'path': {'type': 'string'},
                                                                                                                                               'role': {'type': 'string'}},
                                                                                                                                'required': ['path']}]}},
                                                                                      'kind': {'type': 'string',
                                                                                               'enum': ['character',
                                                                                                        'scene', 'prop',
                                                                                                        'keyframe'],
                                                                                               'default': 'keyframe'},
                                                                                      'output_name': {'type': 'string',
                                                                                                      'description': 'File name inside output_dir. Without an image extension .png is appended (hero -> hero.png); .png/.jpg/.jpeg/.webp are kept and the file is encoded to match; a transparent item always ends in .png or .webp. Use the published path from the result.'},
                                                                                      'size': {'type': 'string',
                                                                                               'enum': ['1K', '1.5K', '2K']},
                                                                                      'orientation': {'type': 'string',
                                                                                                      'enum': ['landscape',
                                                                                                               'portrait',
                                                                                                               'square',
                                                                                                               'landscape_169',
                                                                                                               'portrait_916',
                                                                                                               'auto']}},
                                                                       'additionalProperties': False}},
                                                   'style_preset': {'type': 'string'},
                                                   'size': {'type': 'string',
                                                            'enum': ['1K', '1.5K', '2K'],
                                                            'default': '2K'},
                                                   'orientation': {'type': 'string',
                                                                   'enum': ['landscape', 'portrait', 'square',
                                                                            'landscape_169', 'portrait_916', 'auto'],
                                                                   'default': 'landscape'},
                                                   'output_dir': {'type': 'string', 'default': 'out/creation/images'},
                                                   'concurrency': {'type': 'integer',
                                                                   'minimum': 1,
                                                                   'maximum': 8,
                                                                   'default': 3},
                                                   'force': {'type': 'boolean', 'default': False},
                                                   'check_panel_layout': {'type': 'boolean', 'default': True},
                                                   'output_json': {'type': 'string',
                                                                   'default': 'out/creation/images.json'}},
                                    'additionalProperties': False},
                    'description': 'Generate character/scene/prop references or keyframes with the ZCode image '
                                   'generator (signed-in ZCode account; no API key). Returns image evidence, '
                                   'orientation/panel warnings and partial failures. Existing paths are not silently '
                                   'replaced; force is explicit. size is a resolution tier (1K, 1.5K or 2K); the '
                                   'aspect ratio follows orientation, which is stated in the prompt and verified on '
                                   'the result. Up to 10 reference_images per item, numbered in the order given '
                                   '(图1, 图2 ...). Outputs have an opaque background (no alpha channel).'},
 'image_crop': {'inputSchema': {'type': 'object',
                                'required': ['source', 'output', 'x1', 'y1', 'x2', 'y2'],
                                'properties': {'source': {'type': 'string'},
                                               'output': {'type': 'string'},
                                               'x1': {'type': 'integer', 'minimum': 0},
                                               'y1': {'type': 'integer', 'minimum': 0},
                                               'x2': {'type': 'integer', 'minimum': 1},
                                               'y2': {'type': 'integer', 'minimum': 1},
                                               'margin_ratio': {'type': 'number',
                                                                'minimum': 0,
                                                                'maximum': 0.25,
                                                                'default': 0.08},
                                               'upscale': {'type': 'integer',
                                                           'minimum': 1,
                                                           'maximum': 3,
                                                           'default': 2}},
                                'additionalProperties': False},
                'description': 'Crop an image from explicit pixel coordinates with margin and optional upscale. '
                               'Derived pixels preserve reference identity; returns the crop as image evidence.'},
 'video_generate': {'inputSchema': {'type': 'object',
                                    'properties': {'max_shots_per_call': {'type': 'integer', 'minimum': 1},
                                                   'shots': {'type': 'array',
                                                             'minItems': 1,
                                                             'items': {'type': 'object',
                                                                       'required': ['shot_id'],
                                                                       'properties': {'shot_id': {'type': 'string'},
                                                                                      'take_id': {'type': 'string'},
                                                                                      'reference_take_id': {'type': 'string'},
                                                                                      'reference_mode': {'type': 'string',
                                                                                                         'enum': ['context',
                                                                                                                  'continuation']},
                                                                                      'voice_ref': {'type': 'string'},
                                                                                      'prompt': {'type': 'string'},
                                                                                      'video_prompt': {'type': 'string'},
                                                                                      'duration': {'type': 'number',
                                                                                                   'exclusiveMinimum': 0},
                                                                                      'dialogue_audio': {'anyOf': [{'type': 'string'},
                                                                                                                   {'type': 'array',
                                                                                                                    'items': {'type': 'string'},
                                                                                                                    'minItems': 1,
                                                                                                                    'maxItems': 10}]},
                                                                                      'inner_audio': {'type': 'string'},
                                                                                      'inner_in_clip': {'type': 'boolean',
                                                                                                        'default': True},
                                                                                      'speaker': {'type': 'string'},
                                                                                      'motion_ref': {'type': 'string'},
                                                                                      'edit_from': {'type': 'string'},
                                                                                      'keyframes': {'type': 'array',
                                                                                                    'items': {'anyOf': [{'type': 'string'},
                                                                                                                        {'type': 'object',
                                                                                                                         'required': ['shot',
                                                                                                                                      'image'],
                                                                                                                         'properties': {'shot': {'type': 'integer',
                                                                                                                                                 'minimum': 1},
                                                                                                                                        'image': {'type': 'string'}}}]}},
                                                                                      'continuity_from': {'type': 'string'},
                                                                                      'reference_images': {'type': 'array',
                                                                                                           'maxItems': 9,
                                                                                                           'items': {'type': 'object',
                                                                                                                     'properties': {'path': {'type': 'string'},
                                                                                                                                    'url': {'type': 'string'},
                                                                                                                                    'role': {'type': 'string',
                                                                                                                                             'enum': ['reference_image',
                                                                                                                                                      'first_frame',
                                                                                                                                                      'last_frame'],
                                                                                                                                             'default': 'reference_image'},
                                                                                                                                    'label': {'type': 'string'}},
                                                                                                                     'additionalProperties': False}}},
                                                                       'additionalProperties': False}},
                                                   'model': {'type': 'string'},
                                                   'ratio': {'type': 'string',
                                                             'enum': ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9',
                                                                      'adaptive']},
                                                   'output_dir': {'type': 'string', 'default': 'out/creation/clips'},
                                                   'concurrency': {'type': 'integer',
                                                                   'minimum': 1,
                                                                   'maximum': 10,
                                                                   'default': 4},
                                                   'max_total_generations': {'type': 'number', 'exclusiveMinimum': 0},
                                                   'max_total_generated_seconds': {'type': 'number',
                                                                                   'exclusiveMinimum': 0},
                                                   'poll_interval_seconds': {'type': 'number', 'exclusiveMinimum': 0},
                                                   'timeout_seconds': {'type': 'number', 'exclusiveMinimum': 0},
                                                   'output_json': {'type': 'string',
                                                                   'default': 'out/creation/clips.json'},
                                                   'shotlist_path': {'type': 'string',
                                                                     'default': 'out/creation/shotlist.json'},
                                                   'augment_prompt': {'type': 'boolean', 'default': True},
                                                   'action': {'type': 'string',
                                                              'enum': ['generate', 'edit'],
                                                              'default': 'generate'},
                                                   'source_take_id': {'type': 'string'},
                                                   'take_id': {'type': 'string'},
                                                   'edit_instruction': {'type': 'string'}},
                                    'additionalProperties': False},
                    'description': 'Generate immutable, budgeted video candidates, or edit a recorded candidate into a '
                                   'NEW take_id (action=edit). Requires an explicit directing plan and stable '
                                   'cumulative caps. Failed/interrupted submissions count toward the caps; saved task '
                                   'ids permit recovery without a fresh submission. Uses the ZCode video generator (video-v2.5: 4-30 s per '
                                   'shot, 480p, silent clips; ratio 16:9/4:3/1:1/3:4/9:16/21:9/adaptive; at most 9 '
                                   'images, 3 videos and 3 audios per shot); action=edit is not available. Each generate '
                                   'shots[] item needs shot_id (a plan unit), a new safe take_id, prompt (or '
                                   'video_prompt) and an integer duration within the generator profile; chain with '
                                   'reference_take_id, and name continuity_from by the recorded upstream take_id.'},
 'creation_timeline_build': {'inputSchema': {'type': 'object',
                                             'required': ['shots'],
                                             'properties': {'shots': {'type': 'array',
                                                                      'minItems': 1,
                                                                      'items': {'type': 'object',
                                                                                'properties': {'shot_id': {'type': 'string'},
                                                                                               'segment_id': {'type': 'string'},
                                                                                               'take_id': {'type': 'string'},
                                                                                               'scene_id': {'type': 'string'},
                                                                                               'speed': {'type': 'number',
                                                                                                         'minimum': 0.1,
                                                                                                         'maximum': 8},
                                                                                               'volume': {'type': 'number',
                                                                                                          'minimum': 0},
                                                                                               'muted': {'type': 'boolean'},
                                                                                               'clip': {'type': 'string'},
                                                                                               'source': {'type': 'string'},
                                                                                               'duration': {'type': 'number',
                                                                                                            'exclusiveMinimum': 0},
                                                                                               'trim_start': {'type': 'number',
                                                                                                              'minimum': 0},
                                                                                               'trim_end': {'type': 'number',
                                                                                                            'exclusiveMinimum': 0},
                                                                                               'speech_in_clip': {'type': 'boolean'},
                                                                                               'mute_reason': {'type': 'string'},
                                                                                               'reason': {'type': 'string'},
                                                                                               'beat': {'type': 'string'}},
                                                                                'additionalProperties': False}},
                                                            'voice_clips': {'type': 'array',
                                                                            'items': {'type': 'object',
                                                                                      'properties': {'shot_id': {'type': 'string'},
                                                                                                     'segment_id': {'type': 'string'},
                                                                                                     'audio': {'type': 'string'},
                                                                                                     'path': {'type': 'string'},
                                                                                                     'text': {'type': 'string'},
                                                                                                     'line': {'type': 'string'},
                                                                                                     'speaker': {'type': 'string'},
                                                                                                     'kind': {'type': 'string',
                                                                                                              'enum': ['dialogue',
                                                                                                                       'inner',
                                                                                                                       'voiceover']},
                                                                                                     'at': {'type': 'number',
                                                                                                            'minimum': 0},
                                                                                                     'offset': {'type': 'number',
                                                                                                                'minimum': 0},
                                                                                                     'duration': {'type': 'number',
                                                                                                                  'exclusiveMinimum': 0}},
                                                                                      'additionalProperties': False}},
                                                            'title': {'type': 'string', 'default': 'drama'},
                                                            'canvas': {'type': 'object',
                                                                       'properties': {'width': {'type': 'integer',
                                                                                                'minimum': 2,
                                                                                                'default': 1280},
                                                                                      'height': {'type': 'integer',
                                                                                                 'minimum': 2,
                                                                                                 'default': 720},
                                                                                      'fps': {'type': 'number',
                                                                                              'exclusiveMinimum': 0,
                                                                                              'default': 24}},
                                                                       'additionalProperties': False},
                                                            'bgm': {'type': 'string'},
                                                            'bgm_volume': {'type': 'number',
                                                                           'minimum': 0,
                                                                           'default': 0.18},
                                                            'shotlist_path': {'type': 'string'},
                                                            'verdicts_path': {'type': 'string'},
                                                            'takes_path': {'type': 'string',
                                                                           'default': 'out/creation/clips/takes.json'},
                                                            'output_json': {'type': 'string',
                                                                            'default': 'out/timeline.json'}},
                                             'additionalProperties': False},
                             'description': 'Build the shared editing timeline from current versioned candidates and '
                                            'approved source spans. Binds the selected clip bytes, directing/reference '
                                            'hashes and verdicts. Optional explicit voice/music inputs. Uses measured '
                                            'media durations; render and QC with video_render and video_qc. Every '
                                            'shots[] item needs take_id and clip of a candidate with a current passing '
                                            'review, and trim_start/trim_end inside its usable_spans.'},
 'creation_verify': {'inputSchema': {'type': 'object',
                                     'properties': {'shotlist_path': {'type': 'string',
                                                                      'default': 'out/creation/shotlist.json'},
                                                    'fps': {'type': 'number', 'exclusiveMinimum': 0, 'default': 2},
                                                    'is_chain_head': {'type': 'boolean'},
                                                    'skip_asr': {'type': 'boolean', 'default': False},
                                                    'skip_face_qc': {'type': 'boolean', 'default': False},
                                                    'overall': {'type': 'string',
                                                                'enum': ['pass', 'mute_audio', 'regenerate']},
                                                    'checks': {'type': 'object',
                                                               'additionalProperties': {'type': 'object',
                                                                                        'required': ['ok', 'evidence'],
                                                                                        'properties': {'ok': {'type': 'boolean'},
                                                                                                       'evidence': {'type': 'string'},
                                                                                                       'tags': {'type': 'array',
                                                                                                                'items': {'type': 'string'}}}}},
                                                    'change_plan': {'type': 'string'},
                                                    'allow_thin_voice_evidence': {'type': 'boolean', 'default': False},
                                                    'notes': {'type': 'string'},
                                                    'action': {'type': 'string',
                                                               'enum': ['prepare', 'record', 'status', 'speech',
                                                                        'voices'],
                                                               'default': 'prepare'},
                                                    'take_id': {'type': 'string'},
                                                    'takes_path': {'type': 'string',
                                                                   'default': 'out/creation/clips/takes.json'},
                                                    'evidence_signature': {'type': 'string'},
                                                    'usable_spans': {'type': 'array',
                                                                     'items': {'type': 'object',
                                                                               'required': ['start', 'end'],
                                                                               'properties': {'start': {'type': 'number',
                                                                                                        'minimum': 0},
                                                                                              'end': {'type': 'number',
                                                                                                      'exclusiveMinimum': 0}},
                                                                               'additionalProperties': False}},
                                                    'performance': {'type': 'object',
                                                                    'required': ['required_visuals', 'causality',
                                                                                 'intended_effect'],
                                                                    'properties': {'required_visuals': {'type': 'string',
                                                                                                        'enum': ['pass',
                                                                                                                 'fail',
                                                                                                                 'uncertain',
                                                                                                                 'not_applicable']},
                                                                                   'causality': {'type': 'string',
                                                                                                 'enum': ['pass',
                                                                                                          'fail',
                                                                                                          'uncertain',
                                                                                                          'not_applicable']},
                                                                                   'intended_effect': {'type': 'string',
                                                                                                       'enum': ['pass',
                                                                                                                'fail',
                                                                                                                'uncertain',
                                                                                                                'not_applicable']}},
                                                                    'additionalProperties': False},
                                                    'clips_path': {'type': 'string'},
                                                    'output_json': {'type': 'string'},
                                                    'protected_terms': {'type': 'array', 'items': {'type': 'string'}}},
                                     'additionalProperties': False},
                     'description': 'Prepare or record versioned clip evidence (action=prepare|record|status), or '
                                    'collect automatic speech/voice hints (speech|voices). A take_id binds immutable '
                                    'candidate bytes and the logical plan unit. Prepare returns timed grids and '
                                    'objective diagnostics; record requires current evidence_signature, checks, '
                                    'usable_spans, performance and notes. Missing, changed or failed evidence cannot '
                                    'pass; metrics alone do not prove speaker or story identity. prepare/record '
                                    'require take_id; record also requires overall, checks for every listed dimension '
                                    'and notes of at least 20 characters, and pass/mute_audio needs usable_spans.'},
 'creation_review': {'inputSchema': {'type': 'object',
                                     'properties': {'timeline_path': {'type': 'string', 'default': 'out/timeline.json'},
                                                    'shotlist_path': {'type': 'string'},
                                                    'render_path': {'type': 'string'},
                                                    'track_id': {'type': 'string'},
                                                    'window_seconds': {'type': 'number',
                                                                       'minimum': 0.1,
                                                                       'maximum': 2,
                                                                       'default': 0.5},
                                                    'output_dir': {'type': 'string'},
                                                    'output_json': {'type': 'string'},
                                                    'package_path': {'type': 'string',
                                                                     'default': 'out/creation/review_package.json'},
                                                    'verdicts_path': {'type': 'string',
                                                                      'default': 'out/creation/edit_verdicts.json'},
                                                    'action': {'type': 'string',
                                                               'enum': ['prepare', 'validate'],
                                                               'default': 'prepare'}},
                                     'additionalProperties': False},
                     'description': 'Prepare actual cut evidence (action=prepare) or validate agent-authored '
                                    'cut/full-film verdicts (action=validate). Final review binds current timeline, '
                                    'render report, media and directing references. Returns contact sheets as images. '
                                    'Coverage/freshness validation is separate from the agent judging the observed '
                                    'content. validate requires the prepared package (with render_path) and a verdicts '
                                    'file at verdicts_path.'},
 'voice_compare': {'inputSchema': {'type': 'object',
                                   'required': ['audio_a', 'audio_b'],
                                   'properties': {'audio_a': {'type': 'string'}, 'audio_b': {'type': 'string'}},
                                   'additionalProperties': False},
                   'description': 'Compare two local voice samples with the configured speaker scorer. The default '
                                  'scorer (campp) needs the optional packages librosa and onnxruntime plus its '
                                  'model file under VE_SPEAKER_MODELS_DIR; VE_SPEAKER_SCORER=mfcc_f0 needs only '
                                  'librosa. The SessionStart environment check says whether this is available; '
                                  'when it is not, the call fails every time and the numeric check counts as '
                                  'missing evidence. Returns a similarity and a match/borderline/mismatch verdict '
                                  "on that scorer's scale, never proof of speaker identity. Unreadable audio is "
                                  'an explicit error.'}}

TOOL_SCHEMAS['creation_verify']['inputSchema']['properties']['reassess'] = {'type': 'boolean', 'description': 'Explicitly review existing footage against changed directing requirements; preserves the original generation recipe and creates a new review revision.'}
# T11 image review shares the public verify entry point, with an observation record.
_verify_properties = TOOL_SCHEMAS['creation_verify']['inputSchema']['properties']
_verify_properties['action']['enum'] += ['image_prepare', 'image_record']
_verify_properties.update({
    'image_path': {'type': 'string'},
    'image_kind': {'type': 'string', 'enum': ['keyframe', 'state', 'prop']},
    'image_verdict': {'type': 'string', 'enum': ['pass', 'fail', 'uncertain']},
    'viewed': {'type': 'boolean', 'description': 'Agent declaration that this exact image was actually viewed; decoding is not acceptance.'},
})
_verify_properties['checks']['additionalProperties']['properties']['prop_ids'] = {
    'type': 'array', 'items': {'type': 'string'}, 'description': 'For a failed props check, identify the observed props explicitly.'}
TOOL_SCHEMAS['creation_verify']['description'] += (
    ' image_prepare/image_record reviews a keyframe, state card or critical prop card using image_path/image_kind; '
    'prepare returns the image and evidence_signature, not acceptance. Record needs viewed=true, image_verdict, '
    'checks{identity,state,props,count,single_frame} with observations, and notes of at least 20 characters. '
    'Missing image acceptance produces advisory assembly reminders.')
# Generation and edit are distinct business shapes, independent of the job envelope.
TOOL_SCHEMAS['video_generate']['inputSchema']['anyOf'] = [
    {'properties': {'action': {'const': 'generate'}}, 'required': ['shots']},
    {'properties': {'action': {'const': 'edit'}}, 'required': ['action', 'source_take_id', 'take_id', 'edit_instruction']},
]

# Name / place cards composited over the rendered cut. Two actions on purpose: the generator
# cannot be trusted with text in frame (v45_b filled a prescription close-up with AI gibberish
# and argon caught it twice), and a card is only useful if it misses the face, the prop the
# shot is about, and the dialogue band — which depends on the actual frame, so `plan` measures
# the box against the frames it would cover and `render` refuses a card nobody looked at.
TOOL_SCHEMAS['title_cards'] = {
    'description': (
        'Composite 【name】/【place】 cards onto a rendered cut: a serif line (and optional '
        'qualifier such as 沈府二小姐) fading in and out over the picture. '
        'action=plan measures each card box against the frames it covers, writes a preview '
        'JPEG with the box drawn on the real frame, and flags boxes that sit on busy areas; '
        'read every preview, then action=render with placement_checked listing the card ids '
        'you looked at. Times are seconds on the cut\'s own clock. Use for a character\'s '
        'first appearance and for a place the audience cannot otherwise name — not for '
        'dialogue, which belongs to the subtitle workflow.'),
    'inputSchema': {
        'type': 'object',
        'required': ['action', 'video', 'cards'],
        'properties': {
            'action': {'type': 'string', 'enum': ['plan', 'render']},
            'video': {'type': 'string', 'description': 'The rendered cut the cards go over.'},
            'cards': {
                'type': 'array', 'minItems': 1,
                'items': {
                    'type': 'object',
                    'required': ['text', 'at'],
                    'properties': {
                        'id': {'type': 'string'},
                        'text': {'type': 'string', 'description': 'The name, e.g. 沈紫言.'},
                        'subtext': {'type': 'string',
                                    'description': 'Rank or role on a second, smaller line, e.g. 沈府二小姐.'},
                        'at': {'type': 'number', 'minimum': 0,
                               'description': "Start time in seconds on the cut's clock."},
                        'seconds': {'type': 'number', 'minimum': 1.2, 'maximum': 4.0,
                                    'description': 'Hold time; default 2.2.'},
                        'zone': {'type': 'string',
                                 'enum': ['upper_left', 'upper_right', 'mid_left', 'mid_right',
                                          'lower_left', 'lower_right'],
                                 'description': 'Which sixth of the frame to centre the card in. '
                                                'The bottom sixth is left to the dialogue band.'},
                    },
                    'additionalProperties': False},
            },
            'placement_checked': {
                'type': 'array', 'items': {'type': 'string'},
                'description': 'render only: the card ids whose plan previews you read. Every '
                               'card must be listed.'},
            'style': {
                'type': 'object',
                'properties': {'font_family': {'type': 'string',
                                               'description': 'Default Source Han Serif SC; falls back to any '
                                                              'installed CJK face and says so.'}},
                'additionalProperties': False},
            'output_path': {'type': 'string', 'description': 'render only; default out/preview_cards.mp4.'},
            'output_dir': {'type': 'string', 'description': 'plan only; where previews go. Default out/creation/title_cards.'},
        },
        'additionalProperties': False,
    },
}
