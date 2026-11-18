from __future__ import annotations

import time
import urllib.error
import urllib.request
from typing import Any, Callable

READY_SECONDS = 15.0
RETRY_INTERVAL = 0.25
_MAX_BODY = 256_000


class ProbeNotReady(RuntimeError):
    """Raised when the probe target never answered inside the readiness budget."""

    def __init__(self, attempts: int, budget: float, last: BaseException) -> None:
        self.attempts = attempts
        self.budget = budget
        self.last = last
        super().__init__(
            f"no answer within {budget:.0f}s after {attempts} attempt(s): "
            f"{type(last).__name__}: {last}"
        )


def fetch(
    url: str,
    *,
    ready_seconds: float = READY_SECONDS,
    interval: float = RETRY_INTERVAL,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[int, str]:
    """Fetch a probe URL, waiting out a just-restarted service.

    `systemctl restart` returns once the process is spawned, not once it is
    listening; on a real host the port can refuse connections for ~150ms
    afterwards. Connection-level failures are therefore retried within a bounded
    readiness budget, while any HTTP answer is final and still subject to the
    caller's version check.
    """
    deadline = time.monotonic() + ready_seconds
    attempts = 0
    while True:
        attempts += 1
        try:
            with urllib.request.urlopen(url, timeout=15) as response:
                return response.getcode(), response.read(_MAX_BODY).decode(errors="replace")
        except urllib.error.HTTPError as exc:
            return exc.code, ""
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            if time.monotonic() >= deadline:
                raise ProbeNotReady(attempts, ready_seconds, exc) from exc
            sleep(interval)


def extract_commit(payload: dict[str, Any]) -> str | None:
    """Return the version field a probe response exposes, if any."""
    if "commit" not in payload:
        return None
    value = payload["commit"]
    return "" if value is None else str(value).strip()
