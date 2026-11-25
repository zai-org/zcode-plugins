"""Model weights fetched from ModelScope the first time a check needs them.

Special-purpose weights stay out of environment setup: the setup guide installs what every
workflow uses, and a model that one check reads (the CAM++ speaker encoder behind the
voice-card check of video creation) is downloaded by the first call that needs it. The file
comes from ModelScope (modelscope.cn, reachable from mainland China without a proxy) at a
pinned revision, is checked against its sha256 — the thresholds that read its output were
calibrated on exactly these weights — and is cached under <VE_STATE_HOME or ~/.video_agent>/
models, shared by every project on the machine.
"""
from __future__ import annotations

import contextlib
import hashlib
import os
import time
from dataclasses import dataclass
from pathlib import Path

from .run_context import clean_env

ENDPOINT_ENV = "VE_MODELSCOPE_ENDPOINT"
DEFAULT_ENDPOINT = "https://modelscope.cn"
STATE_ENV = "VE_STATE_HOME"


class ModelUnavailable(RuntimeError):
    """The weights are neither cached nor downloadable right now."""


@dataclass(frozen=True)
class ModelFile:
    repo: str
    revision: str
    path: str
    size: int
    sha256: str
    purpose: str

    def url(self, endpoint: str) -> str:
        return f"{endpoint.rstrip('/')}/models/{self.repo}/resolve/{self.revision}/{self.path}"


CAMPP_WEIGHTS = ModelFile(
    repo="iic/speech_campplus_sv_zh-cn_16k-common",
    revision="013c18884dffb82846cf472dd06dd4a08d97e2cd",
    path="campplus_cn_common.bin",
    size=28036335,
    sha256="3388cf5fd3493c9ac9c69851d8e7a8badcfb4f3dc631020c4961371646d5ada8",
    purpose="CAM++ speaker encoder for the voice-card checks",
)


def cache_root() -> Path:
    return Path(clean_env(STATE_ENV) or (Path.home() / ".video_agent")).expanduser() / "models"


def cached_path(model: ModelFile) -> Path:
    return cache_root() / "modelscope" / model.repo / model.path


def is_cached(model: ModelFile) -> bool:
    path = cached_path(model)
    return path.is_file() and path.stat().st_size == model.size


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


@contextlib.contextmanager
def _download_lock(dest: Path):
    """Parallel tool workers wait for one download instead of each fetching the file."""
    from . import file_lock
    with dest.with_name(f".{dest.name}.lock").open("a") as lock:
        file_lock.flock(lock, file_lock.LOCK_EX)
        try:
            yield
        finally:
            file_lock.flock(lock, file_lock.LOCK_UN)


def _download(model: ModelFile, dest: Path, use_env_proxy: bool) -> None:
    import requests

    url = model.url(clean_env(ENDPOINT_ENV) or DEFAULT_ENDPOINT)
    part = dest.with_name(f".{dest.name}.{os.getpid()}.part")
    digest, received = hashlib.sha256(), 0
    try:
        with requests.Session() as session:
            session.trust_env = use_env_proxy
            with session.get(url, stream=True, timeout=(15, 60)) as response:
                response.raise_for_status()
                with part.open("wb") as fh:
                    for chunk in response.iter_content(1 << 20):
                        fh.write(chunk)
                        digest.update(chunk)
                        received += len(chunk)
        if received != model.size or digest.hexdigest() != model.sha256:
            raise ValueError(f"downloaded {received} bytes with sha256 {digest.hexdigest()[:12]}…, "
                             f"expected {model.size} bytes / {model.sha256[:12]}…")
        os.replace(part, dest)
    finally:
        part.unlink(missing_ok=True)


def ensure(model: ModelFile) -> Path:
    """Path of the verified file, downloading it on first use."""
    dest = cached_path(model)
    if is_cached(model):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    errors = []
    with _download_lock(dest):
        if is_cached(model):  # another worker finished it while this one waited
            return dest
        # The process proxy first (it is what reaches the internet here), then direct:
        # modelscope.cn is a mainland service, and a proxy that cannot reach it is common.
        for use_env_proxy in (True, False, True):
            try:
                _download(model, dest, use_env_proxy)
                return dest
            except Exception as exc:  # noqa: BLE001 — every failure is reported below
                errors.append(f"{'proxy' if use_env_proxy else 'direct'}: {type(exc).__name__}: {str(exc)[:160]}")
                time.sleep(2)
    raise ModelUnavailable(
        f"{model.purpose}: {model.path} is not cached and could not be downloaded from ModelScope "
        f"({'; '.join(errors)}). It is needed once (about {model.size // 1_000_000} MB). Retry when "
        f"the network is back, or save {model.url(DEFAULT_ENDPOINT)} as {dest}.")
