"""Shared error type and file helpers for the movie-recap observation and review records."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path


class ReviewError(Exception):
    """A fixed diagnostic code; never persist vendor bodies, tokens or data URLs."""
    def __init__(self, code: str, retryable: bool = False, diagnostics: dict | None = None):
        super().__init__(code)
        self.code, self.retryable = code, retryable
        self.diagnostics = diagnostics or {}

    def result(self) -> dict:
        return {'status': 'failed',
                'error': {'code': self.code, 'retryable': self.retryable,
                          **({'diagnostics': self.diagnostics} if self.diagnostics else {})}}


def object_schema(properties: dict) -> dict:
    return {'type': 'object', 'properties': properties,
            'required': list(properties), 'additionalProperties': False}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded(obj: object) -> bytes:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True).encode('utf-8')


def atomic_json(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encoded(obj) + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
