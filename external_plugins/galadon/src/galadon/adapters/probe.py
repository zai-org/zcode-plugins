from __future__ import annotations

import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from .release import DeployError

READY_SECONDS = 15.0
RETRY_INTERVAL = 0.25
_MAX_BODY = 256_000

# What a reverse proxy answers while its upstream is restarting. The ssh
# adapter puts every service behind one, so for the probe these are "not
# ready yet", exactly like a refused connection.
GATEWAY_STATUS = frozenset({502, 503, 504})


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


def readiness(ctx: Any, override: float | None) -> float:
    """How long the probe waits for the service: the adapter's own value when a
    test pinned one, otherwise `deploy.options.probe_ready_seconds`."""
    if override is not None:
        return override
    return float(ctx.config.deploy.options.get("probe_ready_seconds") or READY_SECONDS)


def require_probe_url(url: str) -> str:
    """Validate the probe URL before anything is built or switched: a missing
    or malformed URL must not be discovered with the new release already live."""
    url = (url or "").strip()
    if not url:
        raise DeployError(
            "deploy.probe_url is required; Galadon refuses to report success without a probe"
        )
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise DeployError(f"deploy.probe_url is not an http(s) URL: {url!r}")
    return url


def fetch(
    url: str,
    *,
    ready_seconds: float = READY_SECONDS,
    interval: float = RETRY_INTERVAL,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[int, str]:
    """Fetch a probe URL, waiting out a just-restarted service.

    `systemctl restart` returns once the process is spawned, not once it is
    listening. Directly the port refuses connections for a moment; behind a
    reverse proxy the proxy answers 502/503/504 instead. Both are retried
    inside a bounded readiness budget. Any other HTTP answer is final and
    still subject to the caller's version check.
    """
    deadline = time.monotonic() + ready_seconds
    attempts = 0
    while True:
        attempts += 1
        try:
            with urllib.request.urlopen(url, timeout=15) as response:
                return response.getcode(), response.read(_MAX_BODY).decode(errors="replace")
        except urllib.error.HTTPError as exc:
            # The error carries the response body open; close it here or the
            # connection waits for the garbage collector.
            code = exc.code
            exc.close()
            if code in GATEWAY_STATUS and time.monotonic() < deadline:
                sleep(interval)
                continue
            return code, ""
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            if time.monotonic() >= deadline:
                raise ProbeNotReady(attempts, ready_seconds, exc) from exc
            sleep(interval)
        except ValueError as exc:
            # urllib rejects a URL it cannot parse; this is final, not a wait.
            raise ProbeNotReady(attempts, 0.0, exc) from exc


def extract_commit(payload: dict[str, Any]) -> str | None:
    """Return the version field a probe response exposes, if any."""
    if "commit" not in payload:
        return None
    value = payload["commit"]
    return "" if value is None else str(value).strip()
