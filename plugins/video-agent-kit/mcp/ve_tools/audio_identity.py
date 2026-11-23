"""Speaker-identity scoring behind one interface, so the scorer can be swapped and measured.

`mfcc_f0` — mean MFCC cosine damped by pitch distance — is what every run before 11-03 used.
Measured on v43's own 135 TTS-vs-card pairs it scores AUC 0.831, EER 27.1%: better than a
coin, but it mislabels more than one judgment in four, and a voice check that wrong is not
evidence. The two alternatives on the identical pairs:

    scorer        AUC      EER     same p5 / other p95
    mfcc_f0       0.8311   27.1%   0.595 / 0.837   <- overlapping: the ruler is broken
    resemblyzer   0.9694    6.7%   0.791 / 0.819
    campp         0.9783    6.7%   0.549 / 0.572

Those two were measured inside the container, through the ONNX path that actually runs —
not through torch on the host. The two differ by up to 0.04 (ONNX export, and the silence
trim), which is wider than the band between fail and ok, so calibrating on the host would
have handed the container a different ruler than the one it reads.

Thresholds are per-scorer and not interchangeable: a 0.55 means "borderline" to mfcc_f0 and
"this is the speaker" to campp. Each backend carries its own, calibrated on those pairs, and
whatever runs is named on the record so a score can never be read against the wrong scale.

Pick one with VE_SPEAKER_SCORER. campp is the default since v46. mfcc_f0 held the slot while
it was the only backend a container was guaranteed to be able to load; v45 settled both halves
of that: campp runs on a 24 MB onnxruntime and a mounted 28 MB graph, and it is the only one of
the three that discriminates *generated* speech — over v45's takes it spread 0.201-0.763 and
flagged two mismatches, where resemblyzer spread 0.722-0.915 and flagged essentially nothing.
One of those flags, `S05_t1` at 0.20, drove two regenerations of a line that had been
synthesised in the wrong character's voice; mfcc_f0 scores that same pair around its
different-speaker p95 of 0.837 and waves it through. Outside the container (a plugin host has
no mount and no onnxruntime) campp runs in numpy on the same weights from ModelScope, fetched
on first use; it reproduces the graph to float32 rounding, so it reads the same thresholds.

Scores from before v46 were taken on the mfcc_f0 scale and do not compare to campp's: read the
`scorer` field on the record, never the bare number.

One caveat these numbers do not cover: all of it is TTS against TTS. The verification-time
check scores *generated* speech against a card, where an earlier sweep put every scorer at or
below chance. A better scorer fixes the synthesis-time check; whether it rescues the
generated-speech one is exactly what v45_a and v45_b are run to find out.
"""
from __future__ import annotations

import os
from pathlib import Path

from .lazy_import import lazy_module
from .result import ToolResult
from .run_context import RunContext, clean_env

np = lazy_module("numpy")

SCORER_ENV = "VE_SPEAKER_SCORER"
SCORER_DEFAULT = "campp"


# fail below / ok at — per scorer, calibrated on v43's 135 pairs (see module docstring).
# `fail` sits under the same-speaker 5th percentile so a real match is not thrown away;
# `ok` sits above the different-speaker 95th percentile so an impostor is not waved through.
# Between them is "suspect": the scorer cannot tell, and a human or a retry decides.
THRESHOLDS: dict[str, tuple[float, float]] = {
    "mfcc_f0": (0.35, 0.55),
    "resemblyzer": (0.74, 0.84),
    "campp": (0.50, 0.59),
}


def active_scorer() -> str:
    name = (clean_env(SCORER_ENV) or SCORER_DEFAULT).strip().lower()
    return name if name in THRESHOLDS else SCORER_DEFAULT


def thresholds(scorer: str | None = None) -> tuple[float, float]:
    return THRESHOLDS[scorer or active_scorer()]


def _feats(path: str) -> tuple[np.ndarray, float]:
    import librosa

    y, sr = librosa.load(path, sr=16000, mono=True)
    if y.size < sr // 2:
        raise ValueError(f"audio too short for voice fingerprint: {path}")
    y, _ = librosa.effects.trim(y, top_db=25)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)[1:]  # drop c0 (loudness/channel)
    f0 = librosa.yin(y, fmin=60, fmax=500, sr=sr)
    f0 = f0[np.isfinite(f0)]
    f0 = f0[(f0 > 60) & (f0 < 500)]
    logf0 = float(np.log(np.median(f0))) if f0.size else 0.0
    return mfcc.mean(axis=1), logf0


def _cos(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def _score_mfcc_f0(a: str, b: str) -> tuple[float, dict]:
    ma, fa = _feats(a)
    mb, fb = _feats(b)
    cos = _cos(ma, mb)
    d_f0 = abs(fa - fb)
    sim = max(0.0, cos) * float(np.exp(-2.0 * d_f0))
    return sim, {"mfcc_cos": round(cos, 4), "d_log_f0": round(d_f0, 4)}


_SESSIONS: dict[str, object] = {}

MODELS_DIR_ENV = "VE_SPEAKER_MODELS_DIR"
MODELS_DIR_DEFAULT = "/opt/video_edit_models"
ONNX_FILES = {"resemblyzer": "resemblyzer.onnx", "campp": "campplus.onnx"}
CAMPP_WEIGHTS_ENV = "VE_SPEAKER_CAMPP_WEIGHTS"


def _onnx_path(scorer: str) -> Path:
    return Path(clean_env(MODELS_DIR_ENV) or MODELS_DIR_DEFAULT).expanduser() / ONNX_FILES[scorer]


def _session(scorer: str):
    """The ONNX encoder for a scorer, loaded once.

    Both encoders ship as ONNX rather than torch checkpoints: the PyPI Linux torch wheel for
    cp312 hard-links the nvidia-cu12 stack and refuses to import without ~3.5 GB of CUDA, for
    one CPU forward pass. onnxruntime is 24 MB and the two graphs are 34 MB together.
    """
    sess = _SESSIONS.get(scorer)
    if sess is not None:
        return sess
    import onnxruntime as ort

    path = _onnx_path(scorer)
    if not path.is_file():
        raise FileNotFoundError(
            f"{scorer} encoder not found at {path}; set {MODELS_DIR_ENV} or mount the models there")
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1  # one short utterance at a time; threads only add overhead
    sess = _SESSIONS[scorer] = ort.InferenceSession(
        str(path), sess_options=opts, providers=["CPUExecutionProvider"])
    return sess


def _campp_encoder() -> tuple[str, object]:
    """(backend, fbank (T, 80) -> 192-d embedding), loaded once per process.

    A mounted ONNX graph (VE_SPEAKER_MODELS_DIR, /opt/video_edit_models in the container) runs
    when it is there and onnxruntime imports. Everywhere else — a plugin host on a laptop has
    neither the mount nor torch — the same network runs in numpy (campplus_numpy) from
    ModelScope's published weights, downloaded on first use. The two agree to float32
    rounding, so the campp thresholds above hold for both.
    """
    enc = _SESSIONS.get("campp_encoder")
    if enc is not None:
        return enc
    if _onnx_path("campp").is_file():
        try:
            sess = _session("campp")
        except ImportError:
            sess = None
        if sess is not None:
            name = sess.get_inputs()[0].name
            enc = ("onnx", lambda fb: np.asarray(sess.run(None, {name: fb[None]})[0]).reshape(-1))
    if enc is None:
        from . import model_store
        from .campplus_numpy import CAMPPlus

        explicit = clean_env(CAMPP_WEIGHTS_ENV)
        if explicit:
            path = Path(explicit).expanduser()
            if model_store.sha256_of(path) != model_store.CAMPP_WEIGHTS.sha256:
                raise ValueError(f"{CAMPP_WEIGHTS_ENV}={path} is not {model_store.CAMPP_WEIGHTS.path} "
                                 "from ModelScope (sha256 differs); the campp thresholds were "
                                 "calibrated on that file only")
        else:
            path = model_store.ensure(model_store.CAMPP_WEIGHTS)
        enc = ("numpy", CAMPPlus.from_checkpoint(path))
    _SESSIONS["campp_encoder"] = enc
    return enc


_RESAMPLER = {"engine": "soxr"}


def _ffmpeg_16k(path: str, engine: str) -> np.ndarray:
    import subprocess

    resample = ["-af", "aresample=16000:resampler=soxr"] if engine == "soxr" else ["-ar", "16000"]
    proc = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-vn", "-ac", "1",
                           *resample, "-f", "f32le", "-"],
                          stdin=subprocess.DEVNULL, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg could not decode {path}: "
                           f"{proc.stderr.decode('utf-8', 'replace').strip()[-300:]}")
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def _load_16k(path: str) -> np.ndarray:
    """16 kHz mono float32, decoded by ffmpeg with the soxr resampler.

    soxr at its default precision is what librosa.load(sr=16000) resamples with (soxr_hq): on
    the 24 kHz voice cards the two score identically, while ffmpeg's own swr resampler moved
    CAM++ similarities by up to 0.02 — a fifth of the fail/ok band. An ffmpeg built without
    libsoxr falls back to librosa when it is installed, and to swr otherwise.
    """
    if _RESAMPLER["engine"] == "soxr":
        try:
            return _ffmpeg_16k(path, "soxr")
        except RuntimeError as exc:
            if "resampl" not in str(exc).lower() and "soxr" not in str(exc).lower():
                raise
            try:
                import librosa  # noqa: F401
                _RESAMPLER["engine"] = "librosa"
            except ImportError:
                _RESAMPLER["engine"] = "swr"
    if _RESAMPLER["engine"] == "librosa":
        import librosa

        y, _ = librosa.load(path, sr=16000, mono=True)
        return np.asarray(y, dtype=np.float32)
    return _ffmpeg_16k(path, "swr")


def _resemblyzer_embed(path: str) -> np.ndarray:
    from .speaker_features import (RESEMBLYZER_FRAMES_PER_PARTIAL, resemblyzer_mel,
                                   resemblyzer_partials, resemblyzer_preprocess)

    # Loudness normalisation and the VAD trim both change the embedding, so they run here
    # rather than being imported from resemblyzer (which would import torch).
    wav, _vad = resemblyzer_preprocess(_load_16k(path))
    mel = resemblyzer_mel(wav)
    if mel.shape[0] < RESEMBLYZER_FRAMES_PER_PARTIAL:
        mel = np.pad(mel, ((0, RESEMBLYZER_FRAMES_PER_PARTIAL - mel.shape[0]), (0, 0)))
    batch = np.stack([mel[s] for s in resemblyzer_partials(mel.shape[0])]).astype(np.float32)
    sess = _session("resemblyzer")
    out = sess.run(None, {sess.get_inputs()[0].name: batch})[0]
    e = np.asarray(out, dtype=np.float64).mean(axis=0)
    return e / (np.linalg.norm(e) + 1e-9)


def _score_resemblyzer(a: str, b: str) -> tuple[float, dict]:
    ea, eb = _resemblyzer_embed(a), _resemblyzer_embed(b)
    return _cos(ea, eb), {"embedding_dim": int(ea.shape[0])}


_EMBEDDINGS: dict[tuple, np.ndarray] = {}


def _campp_embed(path: str) -> np.ndarray:
    from .speaker_features import kaldi_fbank

    stat = Path(path).stat()
    key = (str(Path(path).resolve()), stat.st_mtime_ns, stat.st_size)
    cached = _EMBEDDINGS.get(key)
    if cached is not None:  # a film-wide pairwise check asks for each clip many times
        return cached
    # Kaldi's fbank expects the int16 scale, and CAM++ was trained with cepstral mean
    # normalisation; both are the upstream recipe, not tuning.
    fb = kaldi_fbank(_load_16k(path).astype(np.float64) * (1 << 15), 16000, 80)
    fb = fb - fb.mean(axis=0, keepdims=True)
    _backend, encoder = _campp_encoder()
    emb = _EMBEDDINGS[key] = np.asarray(encoder(fb.astype(np.float32)), dtype=np.float64).reshape(-1)
    return emb


def _score_campp(a: str, b: str) -> tuple[float, dict]:
    ea, eb = _campp_embed(a), _campp_embed(b)
    extra = {"embedding_dim": int(ea.shape[0]), "backend": _campp_encoder()[0]}
    if _RESAMPLER["engine"] == "swr":
        extra["resampler"] = "swr (ffmpeg without libsoxr; scores may differ by up to 0.02)"
    return _cos(ea, eb), extra


SCORERS = {"mfcc_f0": _score_mfcc_f0, "resemblyzer": _score_resemblyzer, "campp": _score_campp}


def similarity(a: str, b: str, scorer: str | None = None) -> tuple[float, dict]:
    """Score two audio files with one scorer (the active one by default), on its own scale."""
    return SCORERS[scorer or active_scorer()](str(a), str(b))


def scorer_status() -> str:
    """One line for the session-start check: which scorer runs and what it reads. Loads nothing."""
    import importlib.util

    scorer = active_scorer()
    if scorer != "campp":
        librosa = importlib.util.find_spec("librosa") is not None
        return f"{scorer} (librosa {'installed' if librosa else 'missing: pip install -r requirements-voice.txt'})"
    from . import model_store

    if _onnx_path("campp").is_file() and importlib.util.find_spec("onnxruntime") is not None:
        return f"campp, ONNX graph {_onnx_path('campp')}"
    if clean_env(CAMPP_WEIGHTS_ENV):
        return f"campp, weights {clean_env(CAMPP_WEIGHTS_ENV)}"
    if model_store.is_cached(model_store.CAMPP_WEIGHTS):
        return f"campp, weights cached ({model_store.cached_path(model_store.CAMPP_WEIGHTS)})"
    return (f"campp, weights download from ModelScope on first use "
            f"({model_store.CAMPP_WEIGHTS.size // 1_000_000} MB, once per machine)")


def availability(scorer: str | None = None) -> dict:
    """Whether a scorer can run here, checked without loading audio: {ok, scorer, reason}.

    campp needs no extra package: without a mounted ONNX graph it runs in numpy on weights
    fetched from ModelScope on first use. mfcc_f0 needs librosa; resemblyzer needs librosa,
    onnxruntime and its graph under VE_SPEAKER_MODELS_DIR."""
    import importlib.util

    scorer = scorer or active_scorer()
    if scorer == "campp":
        return {"ok": True, "scorer": scorer, "reason": ""}
    needed = ["librosa"] + (["onnxruntime"] if scorer in ONNX_FILES else [])
    missing = [name for name in needed if importlib.util.find_spec(name) is None]
    if missing:
        return {"ok": False, "scorer": scorer, "reason": "missing Python package(s): " + ", ".join(missing)}
    if scorer in ONNX_FILES and not _onnx_path(scorer).is_file():
        return {"ok": False, "scorer": scorer,
                "reason": f"model file {ONNX_FILES[scorer]} not found under {MODELS_DIR_ENV}"}
    return {"ok": True, "scorer": scorer, "reason": ""}
def voice_similarity(args: dict, ctx: RunContext) -> ToolResult:
    a_raw, b_raw = args.get("audio_a"), args.get("audio_b")
    if not a_raw or not b_raw:
        return ToolResult(text="[ERROR] audio_a and audio_b are required")
    a, b = ctx.resolve(str(a_raw)), ctx.resolve(str(b_raw))
    for p in (a, b):
        if not p.is_file():
            return ToolResult(text=f"[ERROR] audio not found: {p}")
    scorer = str(args.get("scorer") or active_scorer()).strip().lower()
    if scorer not in SCORERS:
        return ToolResult(text=f"[ERROR] unknown scorer {scorer!r}; one of {sorted(SCORERS)}")
    fail_below, ok_at = thresholds(scorer)
    try:
        sim, extra = SCORERS[scorer](str(a), str(b))
    except Exception as exc:  # noqa: BLE001 — a scorer problem is reported, never silent
        state = availability(scorer)
        hint = "" if state["ok"] else (f". Voice comparison is unavailable in this environment ({state['reason']}); "
                                       "repeating the call fails the same way, so treat the numeric voice check "
                                       "as missing evidence")
        return ToolResult(text=f"[ERROR] voice fingerprint failed ({scorer}): {exc}{hint}")
    sim = round(float(sim), 4)
    verdict = "match" if sim >= ok_at else ("borderline" if sim >= fail_below else "mismatch")
    detail = ", ".join(f"{k}={v}" for k, v in extra.items())
    return ToolResult(
        text=(f"voice similarity {sim:.3f} -> {verdict} "
              f"[{scorer}: mismatch<{fail_below} <=borderline< {ok_at}<=match]"
              + (f" ({detail})" if detail else "")
              + f"; {a.name} vs {b.name}"),
        data={"similarity": sim, "verdict": verdict, "scorer": scorer,
              "fail_below": fail_below, "ok_at": ok_at,
              "audio_a": str(a), "audio_b": str(b), **extra},
    )
