"""Behavioural contract for the image-generation plugin.

Runs the real `mcp/server.mjs` over stdio against a fake ZCode API on loopback, the
same way the ZCode host drives it: identity arrives in `params._meta`, never in env.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "image-generation"
SERVER = PLUGIN / "mcp" / "server.mjs"
AUTH_KEY = "com.zcode/official-mcp-auth"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JWT = "Bearer test-zcode-jwt"
TRUNCATED = object()


INVOKE = "/api/v1/toolhub/tool/image_generate/invoke"


class FakeZCode(BaseHTTPRequestHandler):
    """Records every request; `script` maps a path to a queue of (status, body) replies."""

    requests: list[dict] = []
    script: dict[str, list[tuple[int, object]]] = {}

    def log_message(self, *_args):  # keep test output quiet
        pass

    def do_GET(self):
        if self.path == "/img.png":
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.end_headers()
            self.wfile.write(PNG)
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        FakeZCode.requests.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
        queue = FakeZCode.script.get(self.path) or [(404, {"code": 3705, "msg": "no route"})]
        status, payload = queue.pop(0) if len(queue) > 1 else queue[0]
        self.send_response(status)
        if status in (301, 302):
            self.send_header("Location", "https://evil.example/steal")
        if payload is TRUNCATED:
            # Headers arrive, then the connection drops halfway through the body.
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", "500")
            self.end_headers()
            self.wfile.write(b'{"code":0')
            self.wfile.flush()
            self.connection.shutdown(socket.SHUT_RDWR)
            return
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        if payload is not None:
            self.wfile.write(json.dumps(payload).encode())


@unittest.skipUnless(shutil.which("node"), "node is required to run the MCP server")
class ImageGenerationServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeZCode)
        cls.origin = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def setUp(self):
        FakeZCode.requests = []
        FakeZCode.script = {}
        self.sandbox = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.sandbox, ignore_errors=True)
        self.project = self.sandbox / "project"
        self.project.mkdir()

    def succeed(self, invocation="inv-1"):
        return (
            200,
            {
                "code": 0,
                "data": {
                    "invocation_id": invocation,
                    "state": "SUCCEEDED",
                    "output": {"image_url": f"{self.origin}/img.png"},
                },
            },
        )

    def call(self, arguments, auth=None, base_url=None, **extra_env):
        meta = {AUTH_KEY: auth if auth is not None else {"ok": True, "headers": {"Authorization": JWT}}}
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "generate_image", "arguments": arguments, "_meta": meta},
            },
        ]
        env = {
            **os.environ,
            "ZCODE_BASE_URL": base_url or self.origin,
            "ZCODE_PROJECT_DIR": str(self.project),
            "IMAGE_GENERATION_RETRY_DELAY_MS": "10",
            **extra_env,
        }
        proc = subprocess.run(
            ["node", str(SERVER)],
            input="".join(json.dumps(m) + "\n" for m in messages),
            capture_output=True,
            text=True,
            env=env,
            cwd=self.project,
            timeout=60,
        )
        replies = {r["id"]: r for r in map(json.loads, proc.stdout.splitlines()) if "id" in r}
        self.assertEqual(replies[2]["result"]["tools"][0]["name"], "generate_image")
        return replies[3]["result"]

    def text(self, result):
        return result["content"][0]["text"]

    def invoke_requests(self):
        return [r for r in FakeZCode.requests if r["path"].endswith("/image_generate/invoke")]

    def test_text_to_image_sends_host_identity_and_saves_file(self):
        FakeZCode.script["/api/v1/toolhub/tool/image_generate/invoke"] = [self.succeed()]
        result = self.call({"prompt": "一只戴墨镜的橘猫"})

        self.assertNotIn("isError", result, self.text(result))
        (request,) = self.invoke_requests()
        self.assertEqual(request["headers"]["authorization"], JWT)
        self.assertTrue(request["headers"]["idempotency-key"])
        self.assertEqual(json.loads(request["body"]), {"query": "一只戴墨镜的橘猫"})
        saved = Path(result["structuredContent"]["path"])
        self.assertEqual(saved.parent, self.project / "generated-images")
        self.assertEqual(saved.read_bytes(), PNG)

    def test_local_reference_is_uploaded_then_used(self):
        (self.project / "ref.png").write_bytes(PNG)
        uploaded = "https://oss.example/toolhub/ref.png?sig=1"
        FakeZCode.script["/api/v1/toolhub/files"] = [(200, {"code": 0, "data": {"url": uploaded}})]
        FakeZCode.script["/api/v1/toolhub/tool/image_generate/invoke"] = [self.succeed()]

        result = self.call({"prompt": "改成水彩", "reference_image": "ref.png", "output_path": "out/cat.png"})

        self.assertNotIn("isError", result, self.text(result))
        upload = next(r for r in FakeZCode.requests if r["path"] == "/api/v1/toolhub/files")
        self.assertEqual(upload["headers"]["authorization"], JWT)
        self.assertIn("multipart/form-data", upload["headers"]["content-type"])
        self.assertIn(PNG, upload["body"])
        (invoke,) = self.invoke_requests()
        self.assertEqual(json.loads(invoke["body"]), {"query": "改成水彩", "image": uploaded})
        self.assertEqual((self.project / "out" / "cat.png").read_bytes(), PNG)

    def test_missing_coding_plan_fails_before_any_request(self):
        result = self.call({"prompt": "cat"}, auth={"ok": False, "reason": "official_auth_plan_required"})

        self.assertTrue(result["isError"])
        self.assertIn("Coding Plan", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_account_without_zai_binding_reports_3706(self):
        FakeZCode.script["/api/v1/toolhub/tool/image_generate/invoke"] = [
            (200, {"code": 3706, "msg": "no account", "logid": "log-9"})
        ]
        result = self.call({"prompt": "cat"})

        self.assertTrue(result["isError"])
        self.assertIn("Z.ai", self.text(result))
        self.assertIn("log-9", self.text(result))

    def test_calling_and_transient_errors_retry_with_the_same_key(self):
        FakeZCode.script["/api/v1/toolhub/tool/image_generate/invoke"] = [
            (500, {"code": 2007, "msg": "upstream"}),
            (200, {"code": 0, "data": {"state": "CALLING"}}),
            self.succeed(),
        ]
        result = self.call({"prompt": "cat"})

        self.assertNotIn("isError", result, self.text(result))
        keys = {r["headers"]["idempotency-key"] for r in self.invoke_requests()}
        self.assertEqual(len(self.invoke_requests()), 3)
        self.assertEqual(len(keys), 1)

    def test_response_cut_off_mid_read_is_retried_with_the_same_key(self):
        FakeZCode.script["/api/v1/toolhub/tool/image_generate/invoke"] = [(200, TRUNCATED), self.succeed()]
        result = self.call({"prompt": "cat"})

        self.assertNotIn("isError", result, self.text(result))
        invokes = self.invoke_requests()
        self.assertEqual(len(invokes), 2)
        self.assertEqual(len({r["headers"]["idempotency-key"] for r in invokes}), 1)

    def test_paths_outside_the_workspace_are_refused_before_any_request(self):
        secret = self.sandbox / "secret.png"
        secret.write_bytes(b"secret")
        victim = self.sandbox / "victim.png"
        victim.write_bytes(b"keep")
        (self.project / "link.png").symlink_to(secret)
        cases = [
            {"reference_image": "../secret.png"},
            {"reference_image": str(secret)},
            {"reference_image": "link.png"},
            {"output_path": "../victim.png"},
            {"output_path": str(victim)},
        ]
        for extra in cases:
            with self.subTest(extra):
                FakeZCode.requests = []
                result = self.call({"prompt": "cat", **extra})
                self.assertTrue(result["isError"])
                self.assertIn("工作区", self.text(result))
                self.assertEqual(FakeZCode.requests, [])
        self.assertEqual(victim.read_bytes(), b"keep")

    def test_unusable_output_path_is_refused_before_spending_quota(self):
        (self.project / "taken.png").write_bytes(b"keep")
        for path, reason in [("taken.png", "已存在"), ("notes.txt", "扩展名")]:
            with self.subTest(path):
                FakeZCode.requests = []
                result = self.call({"prompt": "cat", "output_path": path})
                self.assertTrue(result["isError"])
                self.assertIn(reason, self.text(result))
                self.assertEqual(self.invoke_requests(), [])
        self.assertEqual((self.project / "taken.png").read_bytes(), b"keep")

    def test_output_extension_follows_the_actual_media_type(self):
        FakeZCode.script[INVOKE] = [self.succeed()]
        result = self.call({"prompt": "cat", "output_path": "out/pic.webp"})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(Path(result["structuredContent"]["path"]).name, "pic.png")

    def test_oversized_download_keeps_the_link_and_writes_nothing(self):
        FakeZCode.script[INVOKE] = [self.succeed()]
        result = self.call({"prompt": "cat"}, IMAGE_GENERATION_MAX_DOWNLOAD_BYTES="1")
        self.assertNotIn("isError", result, self.text(result))
        self.assertIsNone(result["structuredContent"]["path"])
        self.assertIn("img.png", self.text(result))
        self.assertFalse((self.project / "generated-images").exists())

    def test_invoke_timeout_is_capped_by_the_call_budget(self):
        FakeZCode.script[INVOKE] = [self.succeed()]
        result = self.call({"prompt": "cat"}, IMAGE_GENERATION_CALL_BUDGET_MS="0")
        self.assertTrue(result["isError"])
        self.assertIn("超时", self.text(result))

    def test_exhausted_calling_warns_against_regenerating(self):
        FakeZCode.script[INVOKE] = [(200, {"code": 0, "data": {"state": "CALLING"}})]
        result = self.call({"prompt": "cat"})
        self.assertTrue(result["isError"])
        self.assertEqual(len(self.invoke_requests()), 3)
        self.assertIn("重复扣费", self.text(result))

    def test_unknown_state_is_not_silently_regenerated(self):
        FakeZCode.script["/api/v1/toolhub/tool/image_generate/invoke"] = [
            (200, {"code": 0, "data": {"state": "UNKNOWN"}})
        ]
        result = self.call({"prompt": "cat"})

        self.assertTrue(result["isError"])
        self.assertEqual(len(self.invoke_requests()), 1)

    def test_redirect_is_refused(self):
        FakeZCode.script["/api/v1/toolhub/tool/image_generate/invoke"] = [(302, None)]
        result = self.call({"prompt": "cat"})

        self.assertTrue(result["isError"])
        self.assertIn("重定向", self.text(result))

    def test_non_https_remote_origin_is_refused(self):
        result = self.call({"prompt": "cat"}, base_url="http://zcode.example")

        self.assertTrue(result["isError"])
        self.assertIn("https", self.text(result))
        self.assertEqual(FakeZCode.requests, [])


class ImageGenerationManifestTest(unittest.TestCase):
    def test_server_starts_through_a_symlinked_install_path(self):
        sandbox = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, sandbox, ignore_errors=True)
        link = sandbox / "plugin-link"
        link.symlink_to(SERVER.parent)
        for flags in [[], ["--preserve-symlinks-main"]]:
            with self.subTest(flags=flags):
                proc = subprocess.run(
                    ["node", *flags, str(link / SERVER.name)],
                    input=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping"}) + "\n",
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                self.assertEqual(json.loads(proc.stdout)["id"], 1)

    def test_manifest_declares_official_stdio_auth(self):
        manifest = json.loads((PLUGIN / ".zcode-plugin" / "plugin.json").read_text(encoding="utf-8"))
        server = manifest["mcpServers"]["image_generation"]
        self.assertEqual(server["type"], "stdio")
        self.assertEqual(server["auth"], {"type": "zcode_official", "provider": "jwt_token"})
        self.assertNotIn("env", server, "identity must come from _meta, never from static env")

    def test_names_do_not_expose_the_upstream_model(self):
        for path in PLUGIN.rglob("*"):
            if path.is_file():
                text = path.read_text(encoding="utf-8").lower()
                for word in ("seedream", "seedance", "volc", "doubao", "gpt-image"):
                    self.assertNotIn(word, text, f"{path.relative_to(ROOT)} mentions {word}")


if __name__ == "__main__":
    unittest.main()
