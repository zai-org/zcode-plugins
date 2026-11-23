"""Movie-only service URL policy, error redaction and local storage boundaries."""
from __future__ import annotations

import ipaddress
import os
from pathlib import Path
import re
from urllib.parse import urlsplit


class SecurityError(ValueError):
    """A fixed public code, with no URL, response body or credential attached."""


def service_url(value: str) -> str:
    """TLS for remote services; plain HTTP is limited to local development."""
    try:
        if not isinstance(value, str) or value != value.strip() or any(ord(c) < 33 for c in value):
            raise ValueError()
        address = urlsplit(value)
        if (address.scheme not in ('https', 'http') or not address.hostname or address.username
                or address.password or address.query or address.fragment or '\\' in value):
            raise ValueError()
        address.port  # Invalid/out-of-range ports must fail before a request or ledger entry.
        if address.scheme == 'http':
            try:
                local = ipaddress.ip_address(address.hostname).is_loopback
            except ValueError:
                local = address.hostname.lower() == 'localhost'
            if not local:
                raise ValueError()
    except (ValueError, TypeError):
        raise SecurityError('endpoint_requires_https_or_loopback') from None
    return value


def tool_error(error: Exception, schema: dict | None = None):
    """Do not expose jsonschema instances, file paths or third-party exception text."""
    from .result import ToolResult
    code = ('invalid_arguments_or_input' if isinstance(error, (ValueError, KeyError, TypeError))
            else 'local_io_failed' if isinstance(error, OSError) else 'movie_operation_failed')
    fields = [key for key in (schema or {}).get('required', [])
              if isinstance(key, str) and re.fullmatch('[a-z][a-z0-9_]{0,63}', key)]
    message = '[ERROR] ' + code
    if fields:
        message += '; required fields: ' + ', '.join(fields)
    return ToolResult(message, is_error=True, data={'error_code': code})


def private_directory(path: Path) -> None:
    if path.is_symlink():
        raise SecurityError('private_directory_must_not_be_symlink')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.chmod(0o700)


def redact_error_result(result):
    """Keep actionable error fields while removing credential echoes at publication."""
    if not result.failed:
        return result
    from .run_context import clean_env
    names = {name for name in os.environ if re.search(r'(?:KEY|TOKEN|SECRET|PASSWORD)$', name)}
    secrets = sorted({value for name in names if (value := clean_env(name)) and len(value) >= 8},
                     key=len, reverse=True)

    def scrub(value):
        if isinstance(value, str):
            for secret in secrets:
                value = value.replace(secret, '[credential redacted]')
            return re.sub(r'(?i)Bearer\s+[A-Za-z0-9._~+/=-]{8,}', 'Bearer [redacted]', value)
        if isinstance(value, dict):
            return {key: scrub(item) for key, item in value.items()}
        if isinstance(value, list):
            return [scrub(item) for item in value]
        return value

    result.text = scrub(result.text)
    result.data = scrub(result.data)
    result.protected_texts = scrub(result.protected_texts)
    return result
