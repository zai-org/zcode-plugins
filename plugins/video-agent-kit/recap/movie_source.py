"""Cheap source identity checks for large, immutable movie inputs."""
from __future__ import annotations

import hashlib
from pathlib import Path


def source_identity(path: Path) -> dict:
    """Bind size/mtime and three byte samples without hashing multi-GB media."""
    before = path.stat()
    if not path.is_file() or not before.st_size:
        raise ValueError("source_video_missing_or_empty")
    block = 65536
    offsets = sorted({0, max(0, before.st_size // 2 - block // 2), max(0, before.st_size - block)})
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for offset in offsets:
            stream.seek(offset)
            digest.update(offset.to_bytes(8, "big"))
            digest.update(stream.read(block))
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError("source_changed_while_fingerprinting")
    return {"version": "movie-source-v1", "size": before.st_size,
            "mtime_ns": before.st_mtime_ns, "sample_sha256": digest.hexdigest()}
