from __future__ import annotations

import json
import sys
import threading
import unittest
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402


class HealthTest(unittest.TestCase):
    def test_health_reports_commit(self) -> None:
        server.Handler.commit = "abc1234"
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            url = f"http://127.0.0.1:{httpd.server_port}/health.json"
            with urlopen(url, timeout=2) as response:
                payload = json.loads(response.read())
                self.assertEqual(response.status, 200)
        finally:
            httpd.shutdown()
            httpd.server_close()
        self.assertEqual(payload, {"ok": True, "commit": "abc1234"})


if __name__ == "__main__":
    unittest.main()
