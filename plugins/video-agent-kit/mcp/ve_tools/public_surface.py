"""Public provider labels; wire identifiers stay in internal configuration/recipes."""
import re


def public_text(value):
    def neutral_env(match):
        family, suffix = match.group(1).upper(), match.group(2).upper()
        prefix = 'ASR' if family == 'SEED_ASR' else 'TTS' if family in ('SEED_AUDIO', 'SEED_TTS') else 'VIDEO'
        if suffix in {'API_KEY', 'APP_KEY', 'ACCESS_KEY', 'ENDPOINT', 'BASE', 'MODEL', 'RESOURCE_ID', 'FLASH_RESOURCE_ID'}:
            return f'VE_{prefix}_{suffix}'
        return '[provider configuration option]'
    value = re.sub(r'VE_(SEEDANCE|SEED_ASR|SEED_AUDIO|SEED_TTS)_([A-Z_]+)', neutral_env, value, flags=re.I)
    # 3D generator: provider-specific configuration names map to the neutral VE_MODEL3D_* names.
    value = re.sub(r'(?<![A-Za-z0-9_])(?:VE_)?TRIPO_(API_KEY|BASE|PROXY)(?![A-Za-z0-9_])', r'VE_MODEL3D_\1', value, flags=re.I)
    # Credential variable names and the service hosts never reach the model (2026-11-05: the
    # agent used both to call a gateway from its shell and printed the values into the trace).
    value = re.sub(r'(?<![A-Za-z0-9_])VE_[A-Z0-9_]*?(?:API_KEY|APP_KEY|ACCESS_KEY|TOKEN)(?![A-Za-z0-9_])',
                   '[credential]', value, flags=re.I)
    value = re.sub(r'(?<![A-Za-z0-9_])LIBTV_TOKEN(?![A-Za-z0-9_])', '[credential]', value, flags=re.I)
    value = re.sub(r'https?://[^\s/"\']*(?:glm\.ai|stepfun\.ai)[^\s/"\']*(?:/[^\s"\']*)?', '[service endpoint]', value, flags=re.I)
    value = re.sub(r'(?<![\w.-])(?:api-gateway\.glm\.ai|httpproxy\.glm\.ai|api\.stepfun\.ai)(?![\w.-])',
                   '[service endpoint]', value, flags=re.I)
    replacements = [
        # ToolHub wire names of the TTS and 3D tools, the TTS model id and the 3D failure-code
        # prefix: the code must send them, the agent must never read them.
        (r'stepfun_tts', 'tts'),
        (r'step-?audio[a-zA-Z0-9._-]*', 'tts-model'),
        (r'(?<![\w.-])step-?fun(?![\w-])', 'tts-service'),
        (r'tripo_model3d', 'model3d'),
        (r'(?<![A-Za-z0-9])TRIPO_(TASK_[A-Z_]+)', r'\1'),
        (r'doubao-seedance-[a-zA-Z0-9.-]+', 'video-generator'),
        (r'seed-audio-[a-zA-Z0-9.-]+', 'audio-tts'),
        (r'volc\.[a-zA-Z0-9._-]+', 'asr-resource'),
        (r'doubao-seedream-[a-zA-Z0-9.-]+', 'image-generator'),
        (r'https?://[^\s/]*(?:bytedance|volces|volcengine|tripo3d)[^\s/]*(?:/[^\s]*)?', '[provider endpoint]'),
        (r'(?<![\w/.-])seedance(?![\w/.-])', 'video-generator'),
        (r'(?<![\w/.-])tripo(?:3d)?(?![\w/.-])', '3d-generator'),
    ]
    for pattern, replacement in replacements:
        value = re.sub(pattern, replacement, value, flags=re.I)
    return value


# Recognized/authored speech content: the summary must quote it exactly as the structured data does.
SPEECH_CONTENT_KEYS = {'transcript', 'script', 'segments', 'words', 'dialogue', 'cues'}


def source_fragments(value):
    authored = {'text', 'asr', 'target', 'line', 'quote', 'prompt', 'video_prompt',
                'speaker', 'name', 'epithet', 'traits', 'physique', 'notes', 'statement', 'relations', 'entry_state', 'exit_state', 'allowed_changes', 'url', 'source_url'} | SPEECH_CONTENT_KEYS
    fragments = []
    def visit(item, source=False):
        if isinstance(item, dict):
            for key, child in item.items():
                visit(child, source or key in authored)
        elif isinstance(item, list):
            for child in item:
                visit(child, source)
        elif source and isinstance(item, str) and item:
            fragments.extend((item, repr(item)[1:-1]))
    visit(value)
    return fragments


def public_text_preserving(value, fragments):
    fragments = sorted({s for s in fragments if isinstance(s, str) and s}, key=len, reverse=True)
    if not fragments:
        return public_text(value)
    pattern = re.compile('|'.join(re.escape(s) for s in fragments))
    pieces, end = [], 0
    for match in pattern.finditer(value):
        pieces.extend((public_text(value[end:match.start()]), match.group()))
        end = match.end()
    return ''.join(pieces) + public_text(value[end:])


def public_data(value, key=None, diagnostic=False, fragments=None):
    if fragments is None:
        fragments = []
    known = {'model', 'configured_model', 'provider', 'dialect', 'resource_id', 'endpoint',
             'provider_message', 'error', 'message', 'reasons', 'detail', 'reason'}
    diagnostic = diagnostic or (isinstance(key, str) and (key in known or key.endswith(('_error', '_message', '_reason', '_diagnostic'))))
    # User authored text and source locators keep their exact bytes even inside diagnostics.
    if key in {'prompt', 'video_prompt', 'text', 'asr', 'target', 'line', 'quote', 'speaker', 'name', 'notes', 'source', 'url', 'source_url'} | SPEECH_CONTENT_KEYS:
        diagnostic = False
    if isinstance(value, dict):
        local_fragments = fragments + source_fragments({k: v for k, v in value.items() if k in {'asr', 'target'}})
        return {k: public_data(v, k, diagnostic, local_fragments) for k, v in value.items()}
    if isinstance(value, list):
        return [public_data(v, key, diagnostic, fragments) for v in value]
    if isinstance(value, str) and diagnostic:
        return public_text_preserving(value, fragments)
    return value
