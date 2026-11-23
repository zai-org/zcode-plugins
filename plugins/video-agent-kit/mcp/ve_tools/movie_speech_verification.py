"""One automatic speech repair per movie paragraph, preserved across resumes."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

from .narration_continuity import audio_hash

POLICY = 'movie-speech-check-v1'
MAX_REPAIRS = 1


def enabled(ctx, *, continuous: bool, by_sentence: bool) -> bool:
    if not continuous or by_sentence:
        return False
    profile = ctx.resolve('out/production_profile.json')
    return profile.is_file() and json.loads(profile.read_text()).get('editorial_policy') == 'movie-editorial-v1'


def repair_path(raw: str | Path) -> Path:
    raw = Path(raw)
    return raw.with_name(raw.stem + '_repair1' + raw.suffix)


class Journal:
    """Audio identities authorize reuse; this record never approves delivery.

    The TTS stage owns the project writer lock. Reserve the single repair before
    sending it, and keep the original waveform if repair fails or is interrupted.
    A lost output JSON or a picture-only edit must not reset the repair budget.
    """

    def __init__(self, tts_dir: Path, segment: dict):
        identity = {'seg_id': segment['seg_id'], 'tts_fingerprint': segment['_tts_fp']}
        key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        self.path = tts_dir / '_movie_verify' / (key + '.json')
        self.identity = identity
        self.value = {'policy': POLICY, **identity, 'repair_attempts': 0}
        if self.path.is_file():
            value = json.loads(self.path.read_text())
            if (not isinstance(value, dict) or value.get('policy') != POLICY
                    or any(value.get(k) != v for k, v in identity.items())
                    or type(value.get('repair_attempts')) is not int
                    or not 0 <= value['repair_attempts'] <= MAX_REPAIRS):
                raise ValueError('invalid movie speech verification journal')
            self.value = value
        else:
            # The native audio cache has already checked this legacy report's
            # waveform and synthesis inputs. Count its previous repairs too.
            previous = segment.get('verify') or {}
            rounds = previous.get('repair_attempts', previous.get('rounds', 0))
            if type(rounds) is int and rounds > 0:
                self.value['repair_attempts'] = min(rounds, MAX_REPAIRS)

    @property
    def repairs(self) -> int:
        return self.value['repair_attempts']

    def cached(self, audio: str) -> dict | None:
        report = self.value.get('report')
        if (self.value.get('state') == 'checked' and isinstance(report, dict)
                and report.get('status') in ('pass', 'warn', 'fail')
                and report.get('asr_available') is True
                and self.value.get('audio_sha256') == audio_hash(audio)):
            return copy.deepcopy(report)
        return None

    def reserve(self, audio: str) -> None:
        from .visual_review import atomic_json
        if self.repairs >= MAX_REPAIRS:
            raise ValueError('movie speech repair budget exhausted')
        self.value.update(state='repair_started', repair_attempts=self.repairs + 1,
                          audio_sha256=audio_hash(audio))
        self.value.pop('report', None)
        atomic_json(self.path, self.value)

    def finish(self, audio: str, report: dict) -> dict:
        from .visual_review import atomic_json
        report = {**report, 'policy': POLICY, 'repair_attempts': self.repairs,
                  'repair_limit': MAX_REPAIRS,
                  'listening_required': report.get('status') == 'warn'}
        self.value.update(state='checked', audio_sha256=audio_hash(audio), report=report)
        atomic_json(self.path, self.value)
        return report
