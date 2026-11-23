"""Schema of the 3D asset tool (model3d group).

One tool, three operations selected by ``operation``; each call creates at most one
3D generator task. The operation-specific requirements are a business-level ``anyOf`` (the published
MCP schema is flattened by ``jobs.augment_schemas``, like ``video_generate``'s ``action``);
fields that belong to another operation are rejected by the handler with a named error.
"""
from __future__ import annotations

VIEWS = ('front', 'left', 'back', 'right')
RIG_TYPES = ('biped', 'quadruped', 'hexapod', 'octopod', 'avian', 'serpentine', 'aquatic', 'others')
BIPED_ANIMATIONS = ('idle', 'walk', 'run', 'dive', 'climb', 'jump', 'slash', 'shoot', 'hurt', 'fall', 'turn')
# Non-biped rigs have one preset each; avian/others have none.
BODY_ANIMATIONS = {'quadruped': ('quadruped:walk',), 'hexapod': ('hexapod:walk',), 'octopod': ('octopod:walk',),
                   'serpentine': ('serpentine:march',), 'aquatic': ('aquatic:march',)}
ANIMATIONS = BIPED_ANIMATIONS + tuple(a for names in BODY_ANIMATIONS.values() for a in names)

COMMON_FIELDS = {'operation', 'output_name', 'force', 'timeout_seconds', 'poll_interval_seconds'}
OPERATION_FIELDS = {
    'generate': {'views', 'image'},
    'rig': {'source', 'rig_type'},
    'animate': {'source', 'animations'},
}

_DESCRIPTION = (
    'ZCode 3D asset generation (signed-in ZCode account). '
    'Each call runs one task and blocks until its files are in out/model3d/<output_name>/ (model.glb, '
    'preview image when provided, task.json). '
    'operation=generate: a textured GLB from views (all four of front, left, back, right of one subject in '
    'one pose on a plain background) or from one image. left/right are decided by where the camera stood, '
    'not by a sheet\'s panel label: in the left view (camera on the subject\'s left) the face points toward '
    'the image\'s left edge, in the right view toward the right edge; map the crops by that. Swapped '
    'left/right views make the model copy front features onto its back (a face on the back of the head, no '
    'back view), so render the result from front, left, back and right and compare each with its input '
    'before rigging; the preview shows the front only. For a character that will be rigged, use a T-pose or '
    'A-pose with limbs clear of the body. '
    'operation=rig: skeleton + skin weights for a generated model (source = its output_name). rig_type=auto '
    'first checks riggability and stops before the rig task when the model cannot be rigged. The biped '
    'skeleton has no tail, ear or jaw bones. '
    'operation=animate: preset animations (at most 5) on a rig (source = the rig\'s '
    'output_name); each preset becomes one named animation clip in the file. Biped rigs take the biped '
    'presets; other body types only their own "<type>:walk|march" preset; avian/others have none. '
    'Repeating a call with the same output_name and arguments reuses the finished files, collects a task '
    'that is still running, or recovers an interrupted submission with its original request key, without a '
    'new task; a different request needs a new output_name or force=true. When the project reaches its 3D '
    'call limit, or the service refuses the account, calls are refused - stop making 3D assets and report '
    'what is missing.'
)

TOOL_SCHEMAS = {
    'model3d_generate': {
        'inputSchema': {
            'type': 'object',
            'required': ['operation', 'output_name'],
            'properties': {
                'operation': {'type': 'string', 'enum': ['generate', 'rig', 'animate']},
                'output_name': {'type': 'string', 'pattern': r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$',
                                'description': 'Name of this asset step; files go to out/model3d/<output_name>/. '
                                               'Later rig/animate calls reference it as source.'},
                'views': {'type': 'object',
                          'properties': {v: {'type': 'string', 'description': f'{v} view image path (PNG/JPEG/WebP)'}
                                         for v in VIEWS},
                          'required': list(VIEWS), 'additionalProperties': False,
                          'description': 'generate: one image path per view (front, left, back, right) of the same '
                                         'subject in the same pose.'},
                'image': {'type': 'string', 'description': 'generate: a single reference image path.'},
                'source': {'type': 'string',
                           'description': 'rig: output_name of a generate step. animate: output_name of a rig step.'},
                'rig_type': {'type': 'string', 'enum': ['auto', *RIG_TYPES], 'default': 'auto',
                             'description': 'rig: body type; auto checks riggability first and uses the detected type.'},
                'animations': {'type': 'array', 'minItems': 1, 'maxItems': 5, 'uniqueItems': True,
                               'items': {'type': 'string', 'enum': list(ANIMATIONS)},
                               'description': 'animate: presets to put on the rig.'},
                'force': {'type': 'boolean', 'default': False,
                          'description': 'Replace an existing output_name with a new request.'},
                'timeout_seconds': {'type': 'number', 'exclusiveMinimum': 0, 'default': 3000,
                                    'description': 'How long to wait for the task (it keeps running after a timeout; '
                                                   'repeat the call to collect it).'},
                'poll_interval_seconds': {'type': 'number', 'exclusiveMinimum': 0, 'default': 5},
            },
            'additionalProperties': False,
        },
        'description': _DESCRIPTION,
    },
}

TOOL_SCHEMAS['model3d_generate']['inputSchema']['anyOf'] = [
    {'properties': {'operation': {'const': 'generate'}}, 'required': ['operation', 'output_name']},
    {'properties': {'operation': {'const': 'rig'}}, 'required': ['operation', 'output_name', 'source']},
    {'properties': {'operation': {'const': 'animate'}}, 'required': ['operation', 'output_name', 'source', 'animations']},
]
