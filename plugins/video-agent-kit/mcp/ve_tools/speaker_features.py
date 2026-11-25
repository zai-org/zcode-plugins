"""Feature extraction for the ONNX speaker encoders, without torch.

The encoders themselves are ONNX (28 MB + 6 MB); their inputs are not. CAM++ wants Kaldi's
fbank and Resemblyzer wants its own mel, and both were originally computed by torch — whose
PyPI Linux wheel for cp312 hard-links the nvidia-cu12 stack and refuses to import without it.
3.5 GB of CUDA to run one CPU forward pass is not a trade worth making, so the two feature
front-ends are reimplemented here on numpy.

Reimplementation is only safe if it is numerically the same: a feature that drifts turns the
thresholds calibrated on the host into a different ruler inside the container, silently. Both
functions are checked against their torch originals in tests/test_speaker_features.py and must
agree to 1e-4; the Kaldi constants below (Povey window, 0.97 preemphasis, its own mel formula,
energy floor) are that recipe, not tuning.
"""
from __future__ import annotations

import numpy as np

# ---- Kaldi fbank (CAM++) -------------------------------------------------------------------
# torchaudio.compliance.kaldi.fbank defaults, which is how CAM++ was trained:
# 25 ms frame, 10 ms shift, Povey window, preemphasis 0.97, 80 mel bins, no dither.
_KALDI_FRAME_MS = 25.0
_KALDI_SHIFT_MS = 10.0
_KALDI_PREEMPH = 0.97
_KALDI_EPS = np.finfo(np.float32).eps


def _povey_window(n: int) -> np.ndarray:
    # Kaldi's Povey window is a Hann raised to 0.85.
    return np.power(0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / (n - 1)), 0.85)


def _mel_scale(f: np.ndarray | float) -> np.ndarray:
    return 1127.0 * np.log(1.0 + np.asarray(f, dtype=np.float64) / 700.0)


def _kaldi_mel_banks(num_bins: int, n_fft: int, sample_rate: int,
                     low_freq: float = 20.0, high_freq: float = 0.0) -> np.ndarray:
    """Kaldi's triangular mel filters in the mel domain (not librosa's slaney/htk)."""
    num_fft_bins = n_fft // 2
    nyquist = 0.5 * sample_rate
    if high_freq <= 0.0:
        high_freq += nyquist
    mel_low, mel_high = _mel_scale(low_freq), _mel_scale(high_freq)
    delta = (mel_high - mel_low) / (num_bins + 1)
    fft_freqs = np.arange(num_fft_bins) * (sample_rate / n_fft)
    mel_freqs = _mel_scale(fft_freqs)
    banks = np.zeros((num_bins, num_fft_bins), dtype=np.float64)
    for i in range(num_bins):
        left, center, right = mel_low + i * delta, mel_low + (i + 1) * delta, mel_low + (i + 2) * delta
        up = (mel_freqs - left) / (center - left)
        down = (right - mel_freqs) / (right - center)
        banks[i] = np.maximum(0.0, np.minimum(up, down))
    return banks


def kaldi_fbank(wav: np.ndarray, sample_rate: int = 16000, num_mel_bins: int = 80) -> np.ndarray:
    """(T, num_mel_bins) log-mel energies, matching torchaudio's kaldi.fbank defaults.

    `wav` is float on the int16 scale, which is the convention both Kaldi and the CAM++
    recipe assume; passing [-1, 1] audio shifts every log energy by a constant.
    """
    wav = np.asarray(wav, dtype=np.float64).reshape(-1)
    frame_len = int(sample_rate * _KALDI_FRAME_MS / 1000.0)
    frame_shift = int(sample_rate * _KALDI_SHIFT_MS / 1000.0)
    if wav.size < frame_len:
        raise ValueError(f"audio shorter than one {_KALDI_FRAME_MS} ms frame")
    num_frames = 1 + (wav.size - frame_len) // frame_shift
    idx = np.arange(frame_len)[None, :] + frame_shift * np.arange(num_frames)[:, None]
    frames = wav[idx]
    # Kaldi removes the per-frame mean, then preemphasises using the (already shifted) first
    # sample as the left neighbour, then windows.
    frames = frames - frames.mean(axis=1, keepdims=True)
    prev = np.concatenate([frames[:, :1], frames[:, :-1]], axis=1)
    frames = frames - _KALDI_PREEMPH * prev
    frames = frames * _povey_window(frame_len)[None, :]
    n_fft = 1
    while n_fft < frame_len:
        n_fft *= 2
    spec = np.abs(np.fft.rfft(frames, n=n_fft, axis=1))[:, :n_fft // 2] ** 2
    banks = _kaldi_mel_banks(num_mel_bins, n_fft, sample_rate)
    mel = spec @ banks.T
    return np.log(np.maximum(mel, _KALDI_EPS)).astype(np.float32)


# ---- Resemblyzer mel ----------------------------------------------------------------------
# Resemblyzer's own hparams: 16 kHz, 25 ms window, 10 ms step, 40 mel channels, librosa's
# default (slaney) mel — a different recipe from Kaldi's, so it gets its own function.
RESEMBLYZER_SAMPLE_RATE = 16000
RESEMBLYZER_MEL_CHANNELS = 40
RESEMBLYZER_WINDOW_MS = 25
RESEMBLYZER_STEP_MS = 10
# 160 frames at 10 ms = 1.6 s per partial utterance, Resemblyzer's inference window.
RESEMBLYZER_FRAMES_PER_PARTIAL = 160


def resemblyzer_mel(wav: np.ndarray, sample_rate: int = RESEMBLYZER_SAMPLE_RATE) -> np.ndarray:
    """(T, 40) mel spectrogram, matching resemblyzer.audio.wav_to_mel_spectrogram."""
    import librosa

    frames = librosa.feature.melspectrogram(
        y=np.asarray(wav, dtype=np.float32), sr=sample_rate,
        n_fft=int(sample_rate * RESEMBLYZER_WINDOW_MS / 1000),
        hop_length=int(sample_rate * RESEMBLYZER_STEP_MS / 1000),
        n_mels=RESEMBLYZER_MEL_CHANNELS)
    return frames.astype(np.float32).T


def resemblyzer_partials(n_frames: int) -> list[slice]:
    """The frame windows Resemblyzer averages over, as embed_utterance does.

    Its own helper walks 1.6 s windows with a 0.75 overlap and keeps a short tail only when
    it covers more than half a window; the embedding is the L2-normalised mean over them.
    """
    step = max(1, int(RESEMBLYZER_FRAMES_PER_PARTIAL * (1 - 0.75)))
    if n_frames <= RESEMBLYZER_FRAMES_PER_PARTIAL:
        return [slice(0, n_frames)]
    out = []
    for start in range(0, n_frames - RESEMBLYZER_FRAMES_PER_PARTIAL + 1, step):
        out.append(slice(start, start + RESEMBLYZER_FRAMES_PER_PARTIAL))
    last = out[-1].stop
    if n_frames - last > RESEMBLYZER_FRAMES_PER_PARTIAL / 2:
        out.append(slice(n_frames - RESEMBLYZER_FRAMES_PER_PARTIAL, n_frames))
    return out


# Resemblyzer's preprocess_wav, reimplemented for the same reason as the mel: importing it
# would import the package, which imports torch. Two steps matter and are kept; both change
# the embedding, so skipping either makes the container read a different ruler than the one
# the thresholds were calibrated on.
RESEMBLYZER_TARGET_DBFS = -30.0
_VAD_WINDOW_MS = 30
_VAD_MOVING_AVG_WIDTH = 8


def resemblyzer_normalize_volume(wav: np.ndarray, target_dbfs: float = RESEMBLYZER_TARGET_DBFS,
                                 increase_only: bool = False,
                                 decrease_only: bool = False) -> np.ndarray:
    wav = np.asarray(wav, dtype=np.float32)
    rms = np.sqrt(np.mean((wav.astype(np.float64)) ** 2))
    if rms == 0:
        return wav
    dbfs_change = target_dbfs - 20 * np.log10(rms)
    if (dbfs_change < 0 and increase_only) or (dbfs_change > 0 and decrease_only):
        return wav
    return (wav * (10 ** (dbfs_change / 20))).astype(np.float32)


def resemblyzer_trim_silences(wav: np.ndarray, sample_rate: int = RESEMBLYZER_SAMPLE_RATE
                              ) -> np.ndarray:
    """Drop long silences with webrtcvad; a no-op when webrtcvad is unavailable.

    Returned unchanged rather than guessed at: a home-rolled energy gate would be a third
    behaviour, and three rulers is worse than two. Tests pin which one ran.
    """
    try:
        import struct

        import webrtcvad
    except ImportError:
        return np.asarray(wav, dtype=np.float32)
    wav = np.asarray(wav, dtype=np.float32)
    samples_per_window = (_VAD_WINDOW_MS * sample_rate) // 1000
    wav = wav[:len(wav) - (len(wav) % samples_per_window)]
    if wav.size == 0:
        return np.asarray(wav, dtype=np.float32)
    pcm = struct.pack("%dh" % len(wav), *(np.round(wav * ((1 << 15) - 1)).astype(np.int16)))
    vad = webrtcvad.Vad(mode=3)
    flags = [vad.is_speech(pcm[2 * s:2 * (s + samples_per_window)], sample_rate=sample_rate)
             for s in range(0, len(wav), samples_per_window)]
    flags = np.array(flags)
    padded = np.concatenate((np.zeros((_VAD_MOVING_AVG_WIDTH - 1) // 2), flags,
                             np.zeros(_VAD_MOVING_AVG_WIDTH // 2)))
    smoothed = np.cumsum(padded, dtype=float)
    smoothed[_VAD_MOVING_AVG_WIDTH:] = smoothed[_VAD_MOVING_AVG_WIDTH:] - smoothed[:-_VAD_MOVING_AVG_WIDTH]
    audio_mask = np.round(smoothed[_VAD_MOVING_AVG_WIDTH - 1:] / _VAD_MOVING_AVG_WIDTH).astype(bool)
    audio_mask = np.repeat(audio_mask, samples_per_window)[:len(wav)]
    # binary dilation with a 4-wide structure, as upstream does
    for _ in range(2):
        audio_mask = audio_mask | np.roll(audio_mask, 1) | np.roll(audio_mask, -1)
    return wav[audio_mask]


# The VAD trim is off by default because it measurably hurts here. On v43's 135 pairs,
# in-container: without it AUC 0.9694 / EER 6.7%, with it AUC 0.9572 / EER 11.7%. Upstream
# tunes for minutes of enrolment audio; these are 2-6 s TTS lines where the trim removes
# breath and onset that carry identity. Keeping it off also makes the result independent of
# whether webrtcvad happens to be installed, which is how the host and the container
# disagreed by 0.04 before.
RESEMBLYZER_VAD_ENV = "VE_SPEAKER_RESEMBLYZER_VAD"


def resemblyzer_preprocess(wav: np.ndarray, sample_rate: int = RESEMBLYZER_SAMPLE_RATE
                           ) -> tuple[np.ndarray, bool]:
    """(preprocessed wav, whether the VAD trim ran)."""
    import os

    wav = resemblyzer_normalize_volume(wav, increase_only=True)
    if str(os.getenv(RESEMBLYZER_VAD_ENV) or "").strip().lower() not in ("1", "true", "yes"):
        return wav, False
    trimmed = resemblyzer_trim_silences(wav, sample_rate)
    ran = trimmed.shape != wav.shape or not np.array_equal(trimmed, wav)
    return (trimmed if trimmed.size else wav), bool(ran)
