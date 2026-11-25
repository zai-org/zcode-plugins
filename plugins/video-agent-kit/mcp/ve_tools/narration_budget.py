"""One planning voice rate for movie writing and picture preparation.

The reel stores the effective delivery rate; calibration stores the raw probe
rate. Apply the delivery factor exactly once. Actual matching paragraph audio
continues to take precedence over estimates during picture assembly.
"""
from __future__ import annotations

import math


def duration_status(profile: dict, seconds: float, *, tolerance_seconds: float = .05) -> dict:
    """Check an explicitly requested total duration, including original audio/holds."""
    if profile.get('duration_policy') != 'target-window-v1':
        return {'status': 'unconfigured'}
    minutes = profile.get('target_minutes')
    if (not isinstance(minutes, list) or len(minutes) != 2
            or any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in minutes)
            or minutes[0] > minutes[1]
            or type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds <= 0):
        raise ValueError('movie_duration_configuration_or_measurement_invalid')
    target = [v * 60 for v in minutes]
    state = ('short' if seconds < target[0] - tolerance_seconds else
             'long' if seconds > target[1] + tolerance_seconds else 'within_target')
    return {'status': state, 'total_seconds': round(seconds, 3), 'target_seconds': target,
            'includes': ['narration', 'original_audio', 'nonoverlapping_holds']}


def planning_rate(profile: dict, reel: dict, override=None) -> tuple[float, str]:
    from .arrange import CHARS_PER_SEC, CPS_DELIVERY_FACTOR

    def number(value, name):
        if type(value) not in (int, float) or not math.isfinite(value) or not 1 <= value <= 8:
            raise ValueError('invalid narration rate: ' + name)
        return float(value)

    calibrated = profile.get('measured_chars_per_sec')
    arranged = reel.get('chars_per_sec')
    if calibrated is not None:
        rate = number(calibrated, 'measured_chars_per_sec') * CPS_DELIVERY_FACTOR
        source = 'profile_voice_calibration_with_delivery_factor'
        if arranged is not None and not math.isclose(number(arranged, 'reel.chars_per_sec'),
                                                     rate, abs_tol=.01, rel_tol=0):
            raise ValueError('narration_rate_reel_mismatch: rearrange with the current voice calibration')
    elif arranged is not None:
        rate, source = number(arranged, 'reel.chars_per_sec'), 'reel_delivery_estimate'
    else:
        rate, source = CHARS_PER_SEC * CPS_DELIVERY_FACTOR, 'uncalibrated_estimate'
    if override is not None:
        requested = number(override, 'chars_per_second')
        if (calibrated is not None or arranged is not None) and not math.isclose(
                requested, rate, abs_tol=.01, rel_tol=0):
            raise ValueError('narration_rate_override_mismatch: update the shared writing budget first')
        rate, source = requested, 'explicit_delivery_estimate'
    return number(rate, 'effective_delivery_rate'), source
