from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent


def read_commit() -> str:
    commit = os.environ.get("GIT_COMMIT", "").strip()
    if commit:
        return commit
    path = HERE / "commit.txt"
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise SystemExit(f"minimal: cannot read {path}: {exc}") from exc
    if not value:
        raise SystemExit(f"minimal: {path} is empty")
    return value


class Handler(BaseHTTPRequestHandler):
    commit = ""

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health.json":
            self.send_error(404)
            return
        body = json.dumps({"ok": True, "commit": self.commit}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args) -> None:
        return


def main() -> None:
    Handler.commit = read_commit()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "18790"))
    print(f"minimal listening on http://{host}:{port} commit={Handler.commit}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
