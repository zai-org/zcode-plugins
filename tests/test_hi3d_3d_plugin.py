"""Behavioural contract for the hi3d-3d plugin.

Runs the real `mcp/server.mjs` over stdio against a fake ZCode API on loopback, the
same way the ZCode host drives it: identity arrives in `params._meta`, never in env.
Product downloads are served by the same fake server under separate GET paths.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import ssl
import stat
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / "plugins" / "hi3d-3d"
SERVER = PLUGIN / "mcp" / "server.mjs"
AUTH_KEY = "com.zcode/official-mcp-auth"
JWT = "Bearer test-zcode-jwt"
SCENARIO = "hi3d_model3d"
SUBMIT = "/api/v1/toolhub/tool/hi3d_model3d/invoke"
QUERY = "/api/v1/toolhub/tool/hi3d_model3d/tasks/query"
UPLOAD = "/api/v1/toolhub/files"
TRUNCATED = object()
# HTTP/1.0 reply with no Content-Length, cut off cleanly: the client sees a complete 200 with half a body.
CLIPPED = object()
CLIPPED_BODY = b'{"code":0,"data":{"invocation_id":"24300'
NO_LENGTH = "no-length"

# Realistic ids from the Hi3D integration doc: `<kind>:<Hi3D task id>`, opaque.
GEN = "gen:d9199fdccef240d5850152d91cd4ec62.jjewelry-aigc-merchant-api.YRlKHFVvuD"
TEX = "tex:5c1f0e8a7b9d4e2f8a6b3c1d0e9f8a7b.jjewelry-aigc-merchant-api.Qm9kZWxUZXg"
GLB = b"glTF\x02\x00\x00\x00" + b"\x00" * 32
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 24
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
AUTH_QUERY = "?auth_key=1763600000-0-0-0f3c2a"
IDENTITY_HEADERS = ("authorization", "x-usage-scenario", "x-caller-scenario", "idempotency-key")
MIB = 1024 * 1024


def with_userinfo(url, userinfo="user:pw"):
    """Insert credentials into a URL at run time.

    The public-mirror guard refuses any tracked file whose text holds a URL with userinfo, so the
    credential-bearing URLs these tests need are never written out literally.
    """
    return url.replace("://", f"://{userinfo}@", 1)


class Big:
    """A JSON-ish body of `size` bytes, sent with or without a Content-Length header."""

    def __init__(self, size, with_length=False):
        self.size = size
        self.with_length = with_length


class Slow:
    """Wait `seconds` before answering with `payload`, like a request that is still being processed."""

    def __init__(self, seconds, payload):
        self.seconds = seconds
        self.payload = payload


class FakeZCode(BaseHTTPRequestHandler):
    """Records every request; `script` maps a POST path to a queue of (status, body) replies."""

    requests: list[dict] = []
    downloads: list[dict] = []
    script: dict[str, list[tuple[int, object]]] = {}
    products: dict[str, tuple] = {}
    # GET path (without query) -> Location of a 302 answer.
    redirects: dict[str, str] = {}

    def log_message(self, *_args):  # keep test output quiet
        pass

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        FakeZCode.downloads.append({"path": path, "headers": {k.lower(): v for k, v in self.headers.items()}})
        if path in FakeZCode.redirects:
            self.send_response(302)
            self.send_header("Location", FakeZCode.redirects[path])
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        status, payload, *flags = FakeZCode.products.get(path, (404, b"missing"))
        self.send_response(status)
        self.send_header("Content-Type", "application/octet-stream")
        if NO_LENGTH not in flags:
            self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        FakeZCode.requests.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
        queue = FakeZCode.script.get(self.path) or [(404, {"code": 3705, "msg": "no route"})]
        status, payload = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(payload, Slow):
            time.sleep(payload.seconds)
            payload = payload.payload
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
        if payload is CLIPPED:
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(CLIPPED_BODY)
            return
        if isinstance(payload, Big):
            self.send_header("Content-Type", "application/json")
            if payload.with_length:
                self.send_header("Content-Length", str(payload.size))
            self.end_headers()
            chunk = b'{"code":0,"msg":"' + b"x" * (64 * 1024)
            try:
                for _ in range(payload.size // len(chunk) + 1):
                    self.wfile.write(chunk)
                self.wfile.flush()
            except OSError:
                pass  # the client stops reading at its cap and closes the connection
            return
        self.send_header("Content-Type", "text/html" if isinstance(payload, str) else "application/json")
        self.end_headers()
        try:
            if isinstance(payload, str):
                self.wfile.write(payload.encode())
            elif payload is not None:
                self.wfile.write(json.dumps(payload).encode())
        except (BrokenPipeError, ConnectionResetError):
            pass  # the client cancelled the call and went away before a slow answer arrived


def ok(data):
    return (200, {"code": 0, "msg": "", "data": data, "logid": "log-ok"})


def submitted(task_id=GEN):
    return ok({"invocation_id": "243003894946562048", "state": "SUCCEEDED", "output": {"task_id": task_id}})


def replayed(task_id=GEN):
    return ok({"invocation_id": "243003894946562048", "state": "SUCCEEDED", "replayed": True, "upstream_req_id": task_id})


def status(task_id, value, upstream):
    return ok({"task_id": task_id, "status": value, "upstream_status": upstream})


def unconfirmed():
    return ok({"invocation_id": "243003894946562049", "state": "UNKNOWN", "failure": {"code": "HI3D_TIMEOUT"}})


@unittest.skipUnless(shutil.which("node"), "node is required to run the MCP server")
class Hi3dServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeZCode)
        cls.origin = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        if getattr(cls, "httpsd", None):
            cls.httpsd.shutdown()

    def tls(self):
        """A second, https copy of the fake CDN on loopback, trusted by node through NODE_EXTRA_CA_CERTS.

        It stands in for a remote https product link: a chain that starts on https is not a local
        development chain, so its redirects must not reach this machine or the intranet.
        """
        cls = type(self)
        if getattr(cls, "httpsd", None) is None:
            if not shutil.which("openssl"):
                self.skipTest("openssl is required to create a test certificate")
            cls.cert_dir = Path(tempfile.mkdtemp())
            cert, key = cls.cert_dir / "cert.pem", cls.cert_dir / "key.pem"
            subprocess.run(
                ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
                 "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", str(key), "-out", str(cert)],
                check=True, capture_output=True,
            )
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            cls.httpsd = ThreadingHTTPServer(("127.0.0.1", 0), FakeZCode)
            cls.httpsd.socket = context.wrap_socket(cls.httpsd.socket, server_side=True)
            cls.tls_origin = f"https://127.0.0.1:{cls.httpsd.server_address[1]}"
            threading.Thread(target=cls.httpsd.serve_forever, daemon=True).start()
            cls.addClassCleanup(shutil.rmtree, cls.cert_dir, ignore_errors=True)
        return {"NODE_EXTRA_CA_CERTS": str(cls.cert_dir / "cert.pem")}

    def setUp(self):
        FakeZCode.requests = []
        FakeZCode.downloads = []
        FakeZCode.script = {}
        FakeZCode.redirects = {}
        FakeZCode.products = {
            "/static/hi3d/GLB0.glb": (200, GLB),
            "/static/hi3d/0.webp": (200, WEBP),
            "/fresh/hi3d/GLB0.glb": (200, GLB),
            "/expired/hi3d/GLB0.glb": (403, b"auth_key expired"),
        }
        self.sandbox = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.sandbox, ignore_errors=True)
        self.project = self.sandbox / "project"
        self.project.mkdir()
        self.data_dir = self.sandbox / "plugin-data"

    def finished(self, task_id=GEN, model="/static/hi3d/GLB0.glb", cover="/static/hi3d/0.webp", origin=None):
        origin = origin or self.origin
        return ok(
            {
                "task_id": task_id,
                "status": "succeeded",
                "upstream_status": "success",
                "output": {
                    "task_id": task_id,
                    "state": "success",
                    "url": f"{origin}{model}{AUTH_QUERY}",
                    "cover_url": f"{self.origin}{cover}{AUTH_QUERY}",
                },
            }
        )

    def call(self, arguments, tool="submit_hi3d_task", auth=None, base_url=None, wait_budget_ms=10_000, **extra_env):
        (result,) = self.call_many([(tool, arguments)], auth=auth, base_url=base_url, wait_budget_ms=wait_budget_ms, **extra_env)
        return result

    def call_many(self, calls, auth=None, base_url=None, wait_budget_ms=10_000, **extra_env):
        """Sends every (tool, arguments) pair to one server process in a single stdin batch."""
        meta = {
            AUTH_KEY: auth if auth is not None else {"ok": True, "headers": {"Authorization": JWT}},
            "progressToken": "p-1",
        }
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        ] + [
            {
                "jsonrpc": "2.0",
                "id": 3 + index,
                "method": "tools/call",
                "params": {"name": tool, "arguments": arguments, "_meta": meta},
            }
            for index, (tool, arguments) in enumerate(calls)
        ]
        env = self.env(base_url=base_url, wait_budget_ms=wait_budget_ms, **extra_env)
        proc = subprocess.run(
            ["node", str(SERVER)],
            input="".join(json.dumps(m) + "\n" for m in messages),
            capture_output=True,
            text=True,
            env=env,
            cwd=self.project,
            timeout=60,
        )
        lines = list(map(json.loads, proc.stdout.splitlines()))
        self.progress = [m for m in lines if m.get("method") == "notifications/progress"]
        replies = {r["id"]: r for r in lines if "id" in r}
        self.tools = replies[2]["result"]["tools"]
        self.assertEqual([t["name"] for t in self.tools], ["submit_hi3d_task", "get_hi3d_task"])
        return [replies[3 + index]["result"] for index in range(len(calls))]

    def env(self, base_url=None, wait_budget_ms=10_000, **extra_env):
        return {
            **os.environ,
            "ZCODE_BASE_URL": base_url or self.origin,
            "ZCODE_PROJECT_DIR": str(self.project),
            "ZCODE_PLUGIN_DATA": str(self.data_dir),
            "HI3D_3D_RETRY_DELAY_MS": "10",
            "HI3D_3D_POLL_INTERVAL_MS": "10",
            "HI3D_3D_WAIT_BUDGET_MS": str(wait_budget_ms),
            **extra_env,
        }

    def raw(self, stdin, **extra_env):
        """Feed raw protocol lines to the server; returns (exit code, parsed replies, stderr)."""
        proc = subprocess.run(
            ["node", str(SERVER)], input=stdin, capture_output=True, text=True, env=self.env(**extra_env), cwd=self.project, timeout=60
        )
        return proc.returncode, [json.loads(line) for line in proc.stdout.splitlines()], proc.stderr

    def tool_call(self, name, arguments, request_id=3):
        meta = {AUTH_KEY: {"ok": True, "headers": {"Authorization": JWT}}}
        message = {"jsonrpc": "2.0", "method": "tools/call", "params": {"name": name, "arguments": arguments, "_meta": meta}}
        if request_id is not None:
            message["id"] = request_id
        return message

    def text(self, result):
        return result["content"][0]["text"]

    def requests_to(self, path):
        return [r for r in FakeZCode.requests if r["path"] == path]

    def assert_scenario_headers(self, request):
        self.assertEqual(request["headers"]["authorization"], JWT)
        self.assertEqual(request["headers"]["x-usage-scenario"], SCENARIO)
        self.assertNotIn("x-caller-scenario", request["headers"])

    def pending_files(self):
        pending = self.data_dir / "pending"
        return sorted(pending.iterdir()) if pending.exists() else []

    # ── happy path ──

    def test_generate_submits_polls_and_downloads_model_and_cover(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [status(GEN, "queued", "queueing"), status(GEN, "running", "processing"), self.finished()]

        result = self.call({"action": "generate", "images": ["https://cdn.example.com/front.png"]})

        self.assertNotIn("isError", result, self.text(result))
        (submit,) = self.requests_to(SUBMIT)
        self.assert_scenario_headers(submit)
        self.assertTrue(submit["headers"]["idempotency-key"])
        self.assertEqual(json.loads(submit["body"]), {"action": "generate", "images": ["https://cdn.example.com/front.png"]})
        queries = self.requests_to(QUERY)
        self.assertEqual(len(queries), 3)
        for query in queries:
            self.assert_scenario_headers(query)
            self.assertEqual(json.loads(query["body"]), {"task_id": GEN})
            self.assertNotIn("idempotency-key", query["headers"])

        # Product URLs never receive identity or scenario headers.
        self.assertEqual(sorted(d["path"] for d in FakeZCode.downloads), ["/static/hi3d/0.webp", "/static/hi3d/GLB0.glb"])
        for download in FakeZCode.downloads:
            for header in IDENTITY_HEADERS:
                self.assertNotIn(header, download["headers"])

        (folder,) = (self.project / "generated-3d").iterdir()
        self.assertRegex(folder.name, r"^\d{8}-\d{6}-generate-model$")
        self.assertEqual((folder / "GLB0.glb").read_bytes(), GLB)
        self.assertEqual((folder / "0.webp").read_bytes(), WEBP)
        structured = result["structuredContent"]
        self.assertEqual(structured["status"], "succeeded")
        self.assertEqual(structured["task_id"], GEN)
        self.assertEqual(structured["action"], "generate")
        self.assertEqual(structured["kind"], "gen")
        self.assertEqual(structured["invocation_id"], "243003894946562048")
        self.assertEqual({Path(f["path"]).name for f in structured["files"]}, {"GLB0.glb", "0.webp"})
        for item in structured["files"]:
            self.assertNotIn(":", Path(item["path"]).name)
            self.assertNotIn("d9199fdccef2", item["path"])
        self.assertTrue(structured["links"]["model"].endswith(f"/static/hi3d/GLB0.glb{AUTH_QUERY}"))
        self.assertTrue(structured["links"]["cover"].endswith(f"/static/hi3d/0.webp{AUTH_QUERY}"))
        text = self.text(result)
        self.assertIn(str(folder / "GLB0.glb"), text)
        self.assertIn(GEN, text)
        self.assertIn("1 小时", text)
        self.assertIn("action=texture", text)
        # One progress notification per query round and per download, all with the caller's token.
        self.assertGreaterEqual(len(self.progress), 3)
        self.assertEqual(self.progress[0]["params"]["progressToken"], "p-1")
        # The first progress message carries the task_id, so a cancelled call can still be fetched later.
        self.assertIn(f"task_id：{GEN}", self.progress[0]["params"]["message"])

    def test_each_action_builds_only_documented_fields(self):
        cases = [
            (
                {
                    "action": "Generate",
                    "images": ["https://a.example/front.png", "https://a.example/left.png"],
                    "views": ["FRONT", "left"],
                    "geometry_only": True,
                    "face": "150000",
                    "format": "OBJ",
                },
                {
                    "action": "generate",
                    "images": ["https://a.example/front.png", "https://a.example/left.png"],
                    "views": ["front", "left"],
                    "geometry_only": True,
                    "face": 150000,
                    "format": "obj",
                },
            ),
            (
                {"action": "generate", "images": ["https://a.example/front.png"], "geometry_only": False, "face": 2000000},
                {"action": "generate", "images": ["https://a.example/front.png"], "face": 2000000},
            ),
            (
                {"action": "texture", "task_id": GEN, "image": "https://cdn.example.com/ref.png", "format": "fbx"},
                {"action": "texture", "task_id": GEN, "image": "https://cdn.example.com/ref.png", "format": "fbx"},
            ),
            (
                {"action": "texture", "model_url": "https://cdn.example.com/m.GLB?sig=1", "image": "https://cdn.example.com/ref.png"},
                {"action": "texture", "model_url": "https://cdn.example.com/m.GLB?sig=1", "image": "https://cdn.example.com/ref.png"},
            ),
            (
                {"action": "split", "model_url": "https://cdn.example.com/m.glb", "type": "character", "part": "a", "joint": "ball", "merge": "no"},
                {"action": "split", "model_url": "https://cdn.example.com/m.glb", "type": "character", "part": "a", "joint": "ball", "merge": "no"},
            ),
            (
                {"action": "split", "task_id": TEX, "type": "general", "level": "high", "format": "3mf"},
                {"action": "split", "task_id": TEX, "type": "general", "level": "high", "format": "3mf"},
            ),
            (
                {"action": "split", "task_id": GEN, "part": "f"},
                {"action": "split", "task_id": GEN, "part": "f"},
            ),
            (
                {"action": "split", "model_url": "https://cdn.example.com/m.stl"},
                {"action": "split", "model_url": "https://cdn.example.com/m.stl"},
            ),
        ]
        for arguments, expected in cases:
            with self.subTest(arguments=arguments):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [self.finished()]
                result = self.call({**arguments, "output_dir": f"out-{len(expected)}-{expected['action']}"})
                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(json.loads(self.requests_to(SUBMIT)[0]["body"]), expected)

    # ── local validation ──

    def test_local_validation_failures_make_no_request(self):
        (self.project / "notes.txt").write_text("x")
        long_id = "gen:" + "x" * 700
        cases = [
            ({}, "action"),
            ({"action": "rig", "task_id": GEN}, "generate / texture / split"),
            ({"action": "animation_library"}, "action"),
            ({"action": "generate"}, "images"),
            ({"action": "generate", "images": []}, "images"),
            ({"action": "generate", "images": ["https://a/1.png"] * 5}, "最多 4"),
            ({"action": "generate", "images": ["https://a/1.png", "https://a/2.png"], "views": ["front"]}, "长度"),
            ({"action": "generate", "images": ["https://a/1.png", "https://a/2.png"], "views": ["front", "front"]}, "重复"),
            ({"action": "generate", "images": ["https://a/1.png", "https://a/2.png"], "views": ["back", "left"]}, "front"),
            ({"action": "generate", "images": ["https://a/1.png"], "views": ["top"]}, "views[0]"),
            ({"action": "generate", "images": ["https://a/1.png"], "face": 99999}, "face"),
            ({"action": "generate", "images": ["https://a/1.png"], "face": 2000001}, "face"),
            ({"action": "generate", "images": ["https://a/1.png"], "face": 150000.5}, "face"),
            ({"action": "generate", "images": ["https://a/1.png"], "face": "lots"}, "face"),
            ({"action": "generate", "images": ["https://a/1.png"], "format": "gltf"}, "obj / glb / stl / fbx / usdz / 3mf"),
            ({"action": "generate", "images": ["https://a/1.png"], "geometry_only": "yes"}, "geometry_only"),
            ({"action": "generate", "images": ["https://a/1.png"], "task_id": GEN}, "task_id 只用于 action=texture / split"),
            ({"action": "generate", "images": ["ftp://a/1.png"]}, "https"),
            ({"action": "generate", "images": ["http://a/1.png"]}, "https"),
            ({"action": "generate", "images": [with_userinfo("https://a/1.png")]}, "https"),
            ({"action": "generate", "images": ["https://a/model.glb"]}, "3D 模型"),
            ({"action": "generate", "images": ["notes.txt"]}, "png / jpg / jpeg / webp"),
            ({"action": "generate", "images": ["missing.png"]}, "读不到"),
            ({"action": "generate", "images": ["data:image/gif;base64,R0lGODlh"]}, "png / jpeg / webp"),
            ({"action": "generate", "images": ["data:image/png;base64,***"]}, "base64"),
            ({"action": "texture", "task_id": GEN}, "image"),
            ({"action": "texture", "image": "https://a/r.png"}, "二选一"),
            ({"action": "texture", "task_id": GEN, "model_url": "https://a/m.glb", "image": "https://a/r.png"}, "二选一"),
            ({"action": "texture", "task_id": TEX, "image": "https://a/r.png"}, "gen:"),
            ({"action": "texture", "task_id": "split:abc", "image": "https://a/r.png"}, "gen:"),
            ({"action": "texture", "task_id": "gen:a b", "image": "https://a/r.png"}, "空白"),
            ({"action": "texture", "model_url": "https://a/m.obj", "image": "https://a/r.png"}, ".glb"),
            ({"action": "texture", "task_id": GEN, "image": "https://a/r.png", "views": ["front"]}, "views 只用于 action=generate"),
            ({"action": "split", "task_id": "split:abc"}, "gen: / tex:"),
            ({"action": "split", "task_id": long_id.replace("gen:", "gen-", 1)}, "gen: / tex:"),
            ({"action": "split", "model_url": "https://a/m.fbx"}, ".glb / .obj / .stl"),
            ({"action": "split", "model_url": "http://a/m.glb"}, "https"),
            ({"action": "split", "model_url": with_userinfo("https://a/m.glb", "u:p")}, "https"),
            ({"action": "split", "task_id": GEN, "type": "general", "part": "a"}, "level"),
            ({"action": "split", "task_id": GEN, "level": "low"}, "type=general"),
            ({"action": "split", "task_id": GEN, "type": "robot"}, "character / general"),
            ({"action": "split", "task_id": GEN, "part": "g"}, "a / b / c / d / e / f"),
            ({"action": "split", "task_id": GEN, "joint": "hinge"}, "none / ball / dovetail / pin"),
            ({"action": "split", "task_id": GEN, "merge": "maybe"}, "yes / no"),
            ({"action": "split", "task_id": GEN, "type": "general", "level": "max"}, "low / medium / high"),
            ({"action": "split", "task_id": GEN, "image": "https://a/r.png"}, "image 只用于 action=texture"),
            ({"action": "split", "task_id": GEN, "geometry_only": True}, "geometry_only 只用于 action=generate"),
        ]
        for arguments, expected in cases:
            with self.subTest(arguments=arguments):
                result = self.call(arguments)
                self.assertTrue(result.get("isError"), self.text(result))
                self.assertIn(expected, self.text(result))
        self.assertEqual(FakeZCode.requests, [])
        self.assertEqual(FakeZCode.downloads, [])

    def test_long_task_ids_are_accepted_verbatim(self):
        long_id = "gen:" + "a1b2c3d4" * 80 + ".jjewelry-aigc-merchant-api.YRlKHFVvuD"
        FakeZCode.script[SUBMIT] = [submitted("split:" + "f" * 600)]
        FakeZCode.script[QUERY] = [self.finished("split:" + "f" * 600)]
        result = self.call({"action": "split", "task_id": long_id})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(json.loads(self.requests_to(SUBMIT)[0]["body"])["task_id"], long_id)
        self.assertEqual(json.loads(self.requests_to(QUERY)[0]["body"]), {"task_id": "split:" + "f" * 600})
        self.assertEqual(result["structuredContent"]["task_id"], "split:" + "f" * 600)
        (folder,) = (self.project / "generated-3d").iterdir()
        self.assertRegex(folder.name, r"^\d{8}-\d{6}-split-model$")
        result_schema = next(t for t in self.tools if t["name"] == "get_hi3d_task")["inputSchema"]
        self.assertNotIn("maxLength", result_schema["properties"]["task_id"])

    def test_local_model_files_are_rejected(self):
        (self.project / "model.glb").write_bytes(GLB)
        cases = [
            {"action": "split", "model_url": "model.glb"},
            {"action": "texture", "model_url": "./model.glb", "image": "https://a/r.png"},
            {"action": "generate", "images": ["model.glb"]},
            {"action": "texture", "task_id": GEN, "image": "model.glb"},
        ]
        for arguments in cases:
            with self.subTest(arguments=arguments):
                result = self.call(arguments)
                self.assertTrue(result.get("isError"))
                self.assertIn("本地 3D 模型", self.text(result))
                self.assertIn("https", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_local_and_data_images_are_uploaded_before_submitting(self):
        (self.project / "front.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/toolhub/1.png?sig=1"}), ok({"url": "https://oss.example/toolhub/2.png?sig=2"})]
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call(
            {
                "action": "generate",
                "images": ["front.png", PNG_DATA_URL, "https://cdn.example/left.png"],
                "views": ["front", "back", "left"],
            }
        )

        self.assertNotIn("isError", result, self.text(result))
        uploads = self.requests_to(UPLOAD)
        self.assertEqual(len(uploads), 2)
        for upload in uploads:
            self.assert_scenario_headers(upload)
            self.assertIn("multipart/form-data", upload["headers"]["content-type"])
            self.assertNotIn("idempotency-key", upload["headers"])
        self.assertIn(PNG, uploads[0]["body"])
        self.assertIn(b"\x89PNG", uploads[1]["body"])
        self.assertEqual(
            json.loads(self.requests_to(SUBMIT)[0]["body"]),
            {
                "action": "generate",
                "images": ["https://oss.example/toolhub/1.png?sig=1", "https://oss.example/toolhub/2.png?sig=2", "https://cdn.example/left.png"],
                "views": ["front", "back", "left"],
            },
        )

    def test_texture_reference_image_is_uploaded(self):
        (self.project / "style.webp").write_bytes(WEBP)
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/toolhub/style.webp"})]
        FakeZCode.script[SUBMIT] = [submitted(TEX)]
        FakeZCode.script[QUERY] = [self.finished(TEX)]
        result = self.call({"action": "texture", "task_id": GEN, "image": "style.webp"})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(
            json.loads(self.requests_to(SUBMIT)[0]["body"]),
            {"action": "texture", "task_id": GEN, "image": "https://oss.example/toolhub/style.webp"},
        )
        self.assertIn("action=split", self.text(result))

    def test_failed_upload_does_not_submit(self):
        (self.project / "front.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [(400, {"code": 3707, "msg": "bad type", "logid": "log-up"})]
        result = self.call({"action": "generate", "images": ["front.png"]})
        self.assertTrue(result["isError"])
        self.assertIn("log-up", self.text(result))
        self.assertIn("没有提交任务", self.text(result))
        self.assertEqual(self.requests_to(SUBMIT), [])

    def test_paths_outside_the_workspace_are_refused_before_any_request(self):
        secret = self.sandbox / "secret.png"
        secret.write_bytes(PNG)
        outside = self.sandbox / "outside"
        outside.mkdir()
        (self.project / "link.png").symlink_to(secret)
        (self.project / "out-link").symlink_to(outside)
        cases = [
            {"action": "generate", "images": ["../secret.png"]},
            {"action": "generate", "images": [str(secret)]},
            {"action": "generate", "images": ["link.png"]},
            {"action": "texture", "task_id": GEN, "image": "../secret.png"},
            {"action": "generate", "images": ["https://a/1.png"], "output_dir": "../outside"},
            {"action": "generate", "images": ["https://a/1.png"], "output_dir": str(outside)},
            {"action": "generate", "images": ["https://a/1.png"], "output_dir": "out-link/new"},
        ]
        for arguments in cases:
            with self.subTest(arguments):
                FakeZCode.requests = []
                result = self.call(arguments)
                self.assertTrue(result["isError"])
                self.assertIn("工作区", self.text(result))
                self.assertEqual(FakeZCode.requests, [])
        result = self.call({"task_id": GEN, "output_dir": "../outside"}, tool="get_hi3d_task")
        self.assertTrue(result["isError"])
        self.assertIn("工作区", self.text(result))
        self.assertEqual(FakeZCode.requests, [])
        self.assertEqual(list(outside.iterdir()), [])

    def test_output_dir_never_overwrites_existing_files(self):
        out = self.project / "models"
        out.mkdir()
        (out / "GLB0.glb").write_bytes(b"keep")
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"action": "generate", "images": ["https://a/1.png"], "output_dir": "models"})

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual((out / "GLB0.glb").read_bytes(), b"keep")
        self.assertEqual((out / "GLB0-1.glb").read_bytes(), GLB)
        self.assertEqual((out / "0.webp").read_bytes(), WEBP)
        self.assertFalse((self.project / "generated-3d").exists())
        # A collision suffix is a rename too: references to the original name would no longer match.
        self.assertEqual(result["structuredContent"]["renamed_files"], [{"key": "model", "from": "GLB0.glb", "to": "GLB0-1.glb"}])
        self.assertIn('- "GLB0.glb" → "GLB0-1.glb"', self.text(result))
        self.assertIn("可能需要手动修正", self.text(result))

    def test_output_dir_that_is_a_file_is_refused_before_spending_quota(self):
        (self.project / "taken.glb").write_bytes(b"keep")
        result = self.call({"action": "generate", "images": ["https://a/1.png"], "output_dir": "taken.glb"})
        self.assertTrue(result["isError"])
        self.assertIn("不是目录", self.text(result))
        self.assertEqual(FakeZCode.requests, [])
        self.assertEqual((self.project / "taken.glb").read_bytes(), b"keep")

    # ── waiting ──

    def test_still_running_returns_task_id_without_resubmitting(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [status(GEN, "running", "processing")]

        result = self.call({"action": "generate", "images": ["https://a/1.png"]}, wait_budget_ms=100)

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["task_id"], GEN)
        self.assertEqual(result["structuredContent"]["status"], "running")
        self.assertIn("get_hi3d_task", self.text(result))
        self.assertIn(GEN, self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)
        self.assertFalse((self.project / "generated-3d").exists())
        # As documented: a submit that does not finish the task within the call carries no invocation_id.
        self.assertNotIn("invocation_id", result["structuredContent"])
        self.assertNotIn("243003894946562048", self.text(result))

    def succeeded_without_products(self, output):
        reply = self.finished()
        reply[1]["data"]["output"] = output
        return reply

    def test_succeeded_without_products_keeps_polling(self):
        # The status may flip to succeeded before the products are written: keep waiting instead of failing.
        cover_only = {"task_id": GEN, "state": "success", "cover_url": f"{self.origin}/static/hi3d/0.webp{AUTH_QUERY}"}
        empty = {"task_id": GEN, "state": "success", "url": "", "cover_url": ""}
        for output in (None, [], "pending", empty, cover_only):
            with self.subTest(output=output):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [self.succeeded_without_products(output), self.finished()]
                result = self.call({"action": "generate", "images": ["https://a/1.png"], "output_dir": "out"})

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(len(self.requests_to(QUERY)), 2)
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)
                self.assertEqual(Path(self.model_entry(result)["path"]).read_bytes(), GLB)
                self.assertTrue(any("产物还在准备" in m["params"]["message"] for m in self.progress))
                shutil.rmtree(self.project / "out")

    def test_succeeded_without_products_until_the_budget_runs_out_returns_the_task_id(self):
        # The task already succeeded (and is billed): say so with a distinct status and a stop condition,
        # instead of "still running", so the Agent does not poll a finished task forever.
        for tool, arguments in [("submit_hi3d_task", {"action": "generate", "images": ["https://a/1.png"]}), ("get_hi3d_task", {"task_id": GEN})]:
            with self.subTest(tool=tool):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [self.succeeded_without_products(None)]
                result = self.call(arguments, tool=tool, wait_budget_ms=200)

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(result["structuredContent"]["status"], "succeeded_pending_products")
                self.assertEqual(result["structuredContent"]["task_id"], GEN)
                text = self.text(result)
                self.assertIn(GEN, text)
                self.assertIn("已成功（已按成功计费）", text)
                self.assertIn("get_hi3d_task", text)
                self.assertIn("请停止查询，把 task_id 告诉用户", text)
                self.assertNotIn("还在进行", text)
                self.assertEqual(len(self.requests_to(SUBMIT)), 1 if tool == "submit_hi3d_task" else 0)
                self.assertFalse((self.project / "generated-3d").exists())

        # A task that is merely running keeps the plain still-running answer.
        FakeZCode.script[QUERY] = [status(GEN, "running", "running")]
        result = self.call({"task_id": GEN}, tool="get_hi3d_task", wait_budget_ms=200)
        self.assertEqual(result["structuredContent"]["status"], "running")
        self.assertNotIn("停止查询", self.text(result))
    def test_unknown_upstream_words_keep_polling(self):
        FakeZCode.script[QUERY] = [status(GEN, "warming", "warming"), status(GEN, "queued", "created"), self.finished()]
        result = self.call({"task_id": GEN}, tool="get_hi3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 3)

    def test_get_hi3d_task_only_polls_and_downloads(self):
        FakeZCode.script[QUERY] = [(500, {"code": 2007, "msg": "blip"}), (503, "<html>busy</html>"), self.finished(TEX)]

        result = self.call({"task_id": TEX}, tool="get_hi3d_task")

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(SUBMIT), [])
        self.assertEqual(len(self.requests_to(QUERY)), 3)
        (folder,) = (self.project / "generated-3d").iterdir()
        self.assertRegex(folder.name, r"^\d{8}-\d{6}-tex-model$")
        self.assertEqual((folder / "GLB0.glb").read_bytes(), GLB)
        self.assertEqual(result["structuredContent"]["kind"], "tex")
        # As documented: get_hi3d_task results have invocation_id null.
        self.assertIsNone(result["structuredContent"]["invocation_id"])
        self.assertNotIn("invocation_id", self.text(result))

    def test_failed_status_is_terminal_and_reports_the_failure_code(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [
            ok(
                {
                    "task_id": GEN,
                    "status": "failed",
                    "upstream_status": "failed",
                    "failure": {"code": "HI3D_TASK_FAILED", "message": "generation failed"},
                }
            )
        ]
        result = self.call({"action": "generate", "images": ["https://a/1.png"]})

        self.assertTrue(result["isError"])
        text = self.text(result)
        self.assertIn("HI3D_TASK_FAILED", text)
        self.assertIn("未扣费", text)
        self.assertIn(GEN, text)
        self.assertNotIn("get_hi3d_task", text)
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_unknown_task_is_terminal(self):
        FakeZCode.script[QUERY] = [(200, {"code": 3704, "msg": "TASK_NOT_FOUND", "logid": "log-4"})]
        result = self.call({"task_id": GEN}, tool="get_hi3d_task")

        self.assertTrue(result["isError"])
        self.assertIn("log-4", self.text(result))
        self.assertNotIn("继续查询", self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_query_failure_after_submit_keeps_the_task_id(self):
        # Unparsable 2xx query bodies are errors (only a submit treats them as "maybe accepted"), but the task_id survives.
        for reply in [(401, None), (404, "<html>gateway</html>"), (200, {"code": 3701, "msg": "down"}), (200, "null"), (200, CLIPPED)]:
            with self.subTest(reply=reply):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [reply]
                result = self.call({"action": "generate", "images": ["https://a/1.png"]})

                self.assertTrue(result["isError"])
                self.assertIn(GEN, self.text(result))
                self.assertIn("get_hi3d_task", self.text(result))
                self.assertIn("不要重新调用 submit_hi3d_task", self.text(result))
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)
                # As documented: an error after submission does not carry the invocation_id.
                self.assertNotIn("243003894946562048", self.text(result))

    def test_transient_query_errors_until_the_budget_still_return_the_task_id(self):
        # 5xx pages and transient codes keep polling until the waiting budget ends.
        for reply in [(503, "<html>busy</html>"), (500, {"code": 2007, "msg": "upstream"}), (429, None)]:
            with self.subTest(reply=reply):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [reply]
                result = self.call({"action": "generate", "images": ["https://a/1.png"]}, wait_budget_ms=200)
                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(result["structuredContent"]["task_id"], GEN)
                self.assertIn("get_hi3d_task", self.text(result))
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)
                self.assertGreater(len(self.requests_to(QUERY)), 1)

    # ── submit idempotency ──

    def test_transient_unknown_and_calling_replay_the_same_key(self):
        FakeZCode.script[SUBMIT] = [
            (500, {"code": 2007, "msg": "upstream"}),
            unconfirmed(),
            ok({"state": "CALLING"}),
            replayed(),
        ]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"action": "generate", "images": ["https://a/1.png"]})

        self.assertNotIn("isError", result, self.text(result))
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 4)
        self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)
        self.assertEqual(len({r["body"] for r in submits}), 1)
        self.assertEqual(json.loads(self.requests_to(QUERY)[0]["body"]), {"task_id": GEN})
        self.assertEqual(self.pending_files(), [])

    def test_truncated_submit_body_is_replayed_with_the_same_key(self):
        FakeZCode.script[SUBMIT] = [(200, TRUNCATED)]
        result = self.call({"action": "generate", "images": ["https://a/1.png"]})

        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        self.assertGreater(len(submits), 1)
        key = submits[0]["headers"]["idempotency-key"]
        self.assertEqual({r["headers"]["idempotency-key"] for r in submits}, {key})
        self.assertIn(key, self.text(result))
        self.assertIn("request_id", self.text(result))

    def test_clipped_2xx_submit_body_is_replayed_with_the_same_key(self):
        # A close-delimited 200 cut off mid-body: text() resolves, but the envelope does not parse.
        FakeZCode.script[SUBMIT] = [(200, CLIPPED), replayed()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"action": "generate", "images": ["https://a/1.png"]})

        self.assertNotIn("isError", result, self.text(result))
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 2)
        self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)
        self.assertEqual(len({r["body"] for r in submits}), 1)
        self.assertEqual(result["structuredContent"]["task_id"], GEN)
        self.assertEqual(self.pending_files(), [])

    def test_code_zero_without_a_task_id_is_replayed_with_the_same_key(self):
        FakeZCode.script[SUBMIT] = [ok({"invocation_id": "243003894946562048"}), replayed()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"action": "generate", "images": ["https://a/1.png"]})

        self.assertNotIn("isError", result, self.text(result))
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 2)
        self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)

    def test_unreadable_2xx_submit_on_every_attempt_hands_back_request_id_and_persists_body(self):
        replies = {
            "clipped": (200, CLIPPED),
            "html": (200, "<html>portal</html>"),
            "no task_id": ok({"invocation_id": "243003894946562048"}),
            "succeeded without task_id": ok({"state": "SUCCEEDED"}),
        }
        for name, reply in replies.items():
            with self.subTest(name):
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [reply]

                result = self.call({"action": "split", "task_id": GEN, "type": "general"})

                self.assertTrue(result["isError"])
                submits = self.requests_to(SUBMIT)
                self.assertGreater(len(submits), 1)
                key = submits[0]["headers"]["idempotency-key"]
                self.assertEqual({r["headers"]["idempotency-key"] for r in submits}, {key})
                self.assertIn(key, self.text(result))
                self.assertIn("request_id", self.text(result))
                (saved,) = self.pending_files()
                record = json.loads(saved.read_text())
                self.assertEqual(record["body"], json.loads(submits[0]["body"]))
                self.assertEqual(set(record["args"]), {"action", "task_id", "type"})
                self.assertEqual(self.requests_to(QUERY), [])

    def test_hard_error_after_an_uncertain_attempt_hands_back_request_id_and_persists_body(self):
        for second in [(401, None), (404, "<html>gateway</html>"), (200, {"code": 3701, "msg": "down"})]:
            with self.subTest(status=second[0]):
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [(200, TRUNCATED), second]
                result = self.call({"action": "split", "task_id": GEN, "type": "general"})

                self.assertTrue(result["isError"])
                first = self.requests_to(SUBMIT)[0]
                key = first["headers"]["idempotency-key"]
                self.assertIn(key, self.text(result))
                (saved,) = self.pending_files()
                self.assertEqual(saved.name, f"{key}.json")
                record = json.loads(saved.read_text())
                self.assertEqual(record["body"], json.loads(first["body"]))
                # Business arguments are kept only as per-field fingerprints, never request_id / output_dir or identity.
                self.assertEqual(set(record["args"]), {"action", "task_id", "type"})
                self.assertTrue(all(re.fullmatch(r"[0-9a-f]{64}", value) for value in record["args"].values()))
                self.assertEqual(stat.S_IMODE(saved.stat().st_mode), 0o600)
                self.assertNotIn("test-zcode-jwt", saved.read_text())

    def test_request_id_replay_reuses_the_persisted_body_and_notes_changes(self):
        (self.project / "style.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/1.png"}), ok({"url": "https://oss.example/2.png"})]
        FakeZCode.script[SUBMIT] = [unconfirmed()]
        first_args = {"action": "texture", "task_id": GEN, "image": "style.png"}
        result = self.call(first_args)
        self.assertTrue(result["isError"])
        first = self.requests_to(SUBMIT)[0]
        key = first["headers"]["idempotency-key"]
        self.assertEqual({r["headers"]["idempotency-key"] for r in self.requests_to(SUBMIT)}, {key})
        record = (self.data_dir / "pending" / f"{key}.json").read_bytes()

        for arguments, warned in [
            (first_args, None),
            ({**first_args, "output_dir": "elsewhere"}, None),
            ({**first_args, "task_id": GEN.replace("d9199", "aaaaa")}, ["task_id"]),
            ({**first_args, "image": "other.png", "format": "fbx"}, ["format", "image"]),
            ({"action": "split", "task_id": TEX}, ["action", "task_id", "image"]),
        ]:
            with self.subTest(arguments=arguments):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [unconfirmed(), replayed(TEX)]
                FakeZCode.script[QUERY] = [self.finished(TEX)]
                result = self.call({**arguments, "request_id": key})

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(self.requests_to(UPLOAD), [])
                for submit in self.requests_to(SUBMIT):
                    self.assertEqual(submit["headers"]["idempotency-key"], key)
                    self.assertEqual(submit["body"], first["body"])
                if warned:
                    self.assertEqual(self.replay_note_fields(self.text(result)), warned)
                else:
                    self.assertNotIn("没有生效", self.text(result))
                # The confirmed submission drops the persisted record; restore it for the next subtest.
                self.assertEqual(self.pending_files(), [])
                (self.data_dir / "pending").mkdir(parents=True, exist_ok=True)
                (self.data_dir / "pending" / f"{key}.json").write_bytes(record)

    def replay_note_fields(self, text):
        match = re.search(r"本次修改的 (\S+) 没有生效", text)
        return match.group(1).split("、") if match else []

    def test_replay_note_ignores_spellings_and_defaults_the_validators_treat_as_equal(self):
        image = "https://oss.example/a.png"
        cases = [
            (
                {"action": "Generate", "images": ["HTTPS://OSS.Example/a.png"], "views": ["FRONT"], "face": "200000"},
                {"action": "generate", "images": [image], "views": ["front"], "face": 200000, "format": "  ", "output_dir": "x"},
            ),
            # geometry_only false and an empty views list submit exactly what leaving them out submits.
            ({"action": "generate", "images": [image]}, {"action": "generate", "images": [image], "geometry_only": False, "views": []}),
            ({"action": "generate", "images": [image], "geometry_only": False}, {"action": "generate", "images": [image]}),
            (
                {"action": "split", "task_id": GEN, "type": "Character", "part": "B", "joint": "PIN", "merge": "No"},
                {"action": "SPLIT", "task_id": f" {GEN} ", "type": "character", "part": "b", "joint": "pin", "merge": "no"},
            ),
            (
                {"action": "texture", "model_url": "https://A.example/m.glb", "image": image, "format": "FBX"},
                {"action": "texture", "model_url": "https://a.example:443/m.glb", "image": image, "format": "fbx"},
            ),
        ]
        for original, same in cases:
            with self.subTest(original=original):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [unconfirmed()]
                self.assertTrue(self.call(original)["isError"])
                key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]

                FakeZCode.script[SUBMIT] = [replayed(GEN)]
                FakeZCode.script[QUERY] = [self.finished(GEN)]
                result = self.call({**same, "request_id": key})
                self.assertNotIn("isError", result, self.text(result))
                self.assertNotIn("没有生效", self.text(result))

        # geometry_only true is a real change and is still reported.
        FakeZCode.script[SUBMIT] = [unconfirmed()]
        self.assertTrue(self.call({"action": "generate", "images": [image]})["isError"])
        key = self.requests_to(SUBMIT)[-1]["headers"]["idempotency-key"]
        FakeZCode.script[SUBMIT] = [replayed(GEN)]
        FakeZCode.script[QUERY] = [self.finished(GEN)]
        result = self.call({"action": "generate", "images": [image], "geometry_only": True, "request_id": key})
        self.assertEqual(self.replay_note_fields(self.text(result)), ["geometry_only"])

    def test_replay_note_survives_an_error(self):
        FakeZCode.script[SUBMIT] = [unconfirmed()]
        result = self.call({"action": "split", "task_id": GEN})
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        self.assertTrue(result["isError"])

        FakeZCode.script[SUBMIT] = [unconfirmed()]
        result = self.call({"action": "split", "task_id": TEX, "request_id": key})
        self.assertTrue(result["isError"])
        self.assertIn("本次修改的 task_id 没有生效", self.text(result))
        self.assertIn(key, self.text(result))

    # A reply that the server accepted the key (the task may exist) and one that never reached a verdict.
    ACCEPTED = unconfirmed()
    NOT_ACCEPTED = (500, {"code": 2007, "msg": "upstream timeout"})

    def unconfirmed_key(self, arguments=None, first=None):
        """Leave one unconfirmed submission behind and return its request_id."""
        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [first or self.ACCEPTED]
        self.assertTrue(self.call(arguments or {"action": "split", "task_id": GEN})["isError"])
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        FakeZCode.requests = []
        return key

    def pending_record(self, key):
        return json.loads((self.data_dir / "pending" / f"{key}.json").read_text())

    def set_created_at(self, key, created_at):
        saved = self.data_dir / "pending" / f"{key}.json"
        record = json.loads(saved.read_text())
        record["createdAt"] = created_at
        saved.write_text(json.dumps(record))

    def test_expired_pending_body_is_not_replayed(self):
        # Expiry follows createdAt, written on the first save: a fresh mtime does not keep an old record alive.
        key = self.unconfirmed_key()
        saved = self.data_dir / "pending" / f"{key}.json"
        self.set_created_at(key, int((time.time() - 25 * 60 * 60) * 1000))
        self.assertLess(time.time() - saved.stat().st_mtime, 60)

        result = self.call({"action": "split", "task_id": GEN, "request_id": key})

        self.assertTrue(result["isError"])
        self.assertIn("找不到", self.text(result))
        self.assertEqual(FakeZCode.requests, [])
        self.assertFalse(saved.exists())

    def test_pending_created_at_survives_a_resave_and_drives_expiry(self):
        before = time.time() * 1000
        key = self.unconfirmed_key()
        record = self.pending_record(key)
        self.assertGreaterEqual(record["createdAt"], before - 1000)
        self.assertLessEqual(record["createdAt"], time.time() * 1000)

        # A replay that is still unconfirmed rewrites the record but keeps the first createdAt.
        created = int((time.time() - 23 * 60 * 60) * 1000)
        self.set_created_at(key, created)
        result = self.call({"action": "split", "task_id": GEN, "request_id": key})
        self.assertTrue(result["isError"])
        self.assertIn(f"request_id：{key}", self.text(result))
        self.assertEqual(self.pending_record(key)["createdAt"], created)

        # Once createdAt is more than 24 hours old the record is gone, however often it was rewritten.
        self.set_created_at(key, created - 2 * 60 * 60 * 1000)
        FakeZCode.requests = []
        result = self.call({"action": "split", "task_id": GEN, "request_id": key})
        self.assertIn("找不到", self.text(result))
        self.assertEqual(FakeZCode.requests, [])
        self.assertFalse((self.data_dir / "pending" / f"{key}.json").exists())

    def test_saving_a_record_prunes_other_expired_records(self):
        stale = self.unconfirmed_key()
        self.set_created_at(stale, int((time.time() - 25 * 60 * 60) * 1000))
        # A record that cannot be read may be half written by a parallel call: only its mtime can expire it.
        (self.data_dir / "pending" / "half-written.json").write_text('{"createdAt":')
        fresh = self.unconfirmed_key()
        names = sorted(p.name for p in (self.data_dir / "pending").iterdir())
        self.assertEqual(names, sorted([f"{fresh}.json", "half-written.json"]))

    def expected_code_text(self, code):
        return {3001: "请求参数不合法", 3703: "提交被拒绝", 3707: "参考图为空、过大或类型不支持"}[code]

    def test_definite_rejection_on_replay_drops_the_record_and_stops_replaying(self):
        # Only a key the server never accepted: every earlier attempt ended without a verdict (here 2007).
        for code in (3703, 3707):
            with self.subTest(code=code):
                key = self.unconfirmed_key(first=self.NOT_ACCEPTED)
                self.assertIs(self.pending_record(key)["accepted"], False)
                FakeZCode.script[SUBMIT] = [(200, {"code": code, "msg": "HI3D_TASK_NOT_READY", "logid": f"log-{code}"})]
                result = self.call({"action": "split", "task_id": GEN, "request_id": key})

                self.assertTrue(result["isError"])
                text = self.text(result)
                self.assertTrue(text.startswith(f"提交失败：{self.expected_code_text(code)}"), text)
                self.assertIn(f"log-{code}", text)
                self.assertIn(f"request_id {key} 没有创建任务，不要再用这个 request_id 重放", text)
                self.assertIn("不带 request_id 重新提交", text)
                self.assertIn("get_hi3d_task 等前一步完成", text)
                # Not the "unconfirmed, replay with request_id" message.
                self.assertNotIn("提交未确认", text)
                self.assertNotIn("带上 request_id", text)
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)
                self.assertFalse((self.data_dir / "pending" / f"{key}.json").exists())

                # The dropped request_id cannot be replayed again.
                FakeZCode.requests = []
                result = self.call({"action": "split", "task_id": GEN, "request_id": key})
                self.assertIn("找不到", self.text(result))
                self.assertEqual(FakeZCode.requests, [])

    def test_definite_rejection_after_an_uncertain_attempt_in_the_same_call(self):
        FakeZCode.script[SUBMIT] = [self.NOT_ACCEPTED, (200, {"code": 3703, "msg": "HI3D_REJECTED", "logid": "log-r"})]
        result = self.call({"action": "split", "task_id": GEN, "type": "general"})

        self.assertTrue(result["isError"])
        text = self.text(result)
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        self.assertEqual(len(self.requests_to(SUBMIT)), 2)
        self.assertEqual({r["headers"]["idempotency-key"] for r in self.requests_to(SUBMIT)}, {key})
        self.assertIn("log-r", text)
        self.assertIn("HI3D_REJECTED", text)
        self.assertIn(f"request_id {key} 没有创建任务", text)
        self.assertNotIn("提交未确认", text)
        self.assertEqual(self.pending_files(), [])

    def test_rejection_of_a_key_the_server_accepted_keeps_the_request_id_and_the_record(self):
        # Once the server accepted the key (UNKNOWN / CALLING / 3702 / an unreadable or oversized 2xx), a later 3703 or
        # 3707 (upstream rate limit, expired image link, ...) does not prove that the first attempt created no task.
        rejection = (200, {"code": 3703, "msg": "HI3D_RATE_LIMITED", "logid": "log-rl"})
        for first in [self.ACCEPTED, ok({"state": "CALLING"}), (200, {"code": 3702, "msg": "in flight"}), (200, TRUNCATED), (200, Big(2 * MIB))]:
            with self.subTest(first="oversized" if isinstance(first[1], Big) else first):
                # In the same call.
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [first, rejection]
                result = self.call({"action": "split", "task_id": GEN})
                text = self.text(result)
                key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
                self.assertTrue(result["isError"])
                self.assertEqual(len(self.requests_to(SUBMIT)), 2)
                self.assertIn("提交未确认", text)
                self.assertIn("log-rl", text)
                self.assertIn("之前已受理过这次提交，这次拒绝不能说明任务没有创建", text)
                self.assertIn(f"带上 request_id：{key}", text)
                self.assertNotIn("没有创建任务，不要再用", text)
                self.assertIs(self.pending_record(key)["accepted"], True)

        # On a later replay: the accepted flag was saved with the record.
        for code in (3703, 3707):
            with self.subTest(replay=code):
                key = self.unconfirmed_key()
                self.assertIs(self.pending_record(key)["accepted"], True)
                created = self.pending_record(key)["createdAt"]
                FakeZCode.script[SUBMIT] = [(200, {"code": code, "msg": "IMAGE_FETCH_FAILED", "logid": f"log-{code}"})]
                result = self.call({**{"action": "split", "task_id": GEN}, "request_id": key})
                text = self.text(result)
                self.assertTrue(result["isError"])
                self.assertIn("提交未确认", text)
                self.assertIn(f"log-{code}", text)
                self.assertIn(f"带上 request_id：{key}", text)
                self.assertNotIn("没有创建任务，不要再用", text)
                record = self.pending_record(key)
                self.assertEqual((record["createdAt"], record["accepted"]), (created, True))

        # A replay of a key that was never accepted, which the server now accepts and then rejects, keeps it too.
        key = self.unconfirmed_key(first=self.NOT_ACCEPTED)
        FakeZCode.script[SUBMIT] = [self.ACCEPTED, rejection]
        result = self.call({**{"action": "split", "task_id": GEN}, "request_id": key})
        self.assertIn(f"带上 request_id：{key}", self.text(result))
        self.assertIs(self.pending_record(key)["accepted"], True)

    def test_replay_that_ends_after_the_record_expired_does_not_renew_it(self):
        # The record is still fresh when the replay starts, but the slow submit only ends after its 24 hours:
        # it must not be rewritten with a new createdAt, and the Agent must not be promised another replay.
        key = self.unconfirmed_key()
        self.set_created_at(key, int((time.time() - 24 * 60 * 60 + 2) * 1000))
        FakeZCode.script[SUBMIT] = [(500, Slow(3, {"code": 2007, "msg": "upstream timeout"})), self.NOT_ACCEPTED]
        result = self.call({**{"action": "split", "task_id": GEN}, "request_id": key})

        self.assertTrue(result["isError"])
        text = self.text(result)
        self.assertGreater(len(self.requests_to(SUBMIT)), 1)
        self.assertIn(key, text)
        self.assertIn("超过 24 小时有效期", text)
        self.assertIn("由用户决定", text)
        self.assertFalse((self.data_dir / "pending" / f"{key}.json").exists())

    def test_errors_that_prove_nothing_on_replay_keep_the_request_id_and_the_record(self):
        replies = [
            (401, None),
            (403, {"code": 3101, "msg": "no coding plan", "logid": "log-31"}),
            (404, {"code": 3705, "msg": "no route"}),
            (403, {"code": 3706, "msg": "no zai account"}),
            (404, "<html>gateway</html>"),
            (200, {"code": 3701, "msg": "down"}),
            (500, {"code": 2007, "msg": "upstream"}),
            (200, {"code": 3002, "msg": "slow down"}),
            (200, {"code": 3702, "msg": "in progress"}),
            (200, Big(2 * MIB)),
            # 3001 may come from an incomplete team / personal scope, which has nothing to do with the key.
            (400, {"code": 3001, "msg": "incomplete plan scope", "logid": "log-30"}),
        ]
        for reply in replies:
            with self.subTest(reply=reply if not isinstance(reply[1], Big) else "oversized"):
                # Even for a key the server never accepted, these errors prove nothing about the task.
                key = self.unconfirmed_key(first=self.NOT_ACCEPTED)
                created = self.pending_record(key)["createdAt"]
                FakeZCode.script[SUBMIT] = [reply]
                result = self.call({"action": "split", "task_id": GEN, "request_id": key})

                self.assertTrue(result["isError"])
                text = self.text(result)
                self.assertIn("提交未确认", text)
                self.assertIn(f"带上 request_id：{key}", text)
                self.assertNotIn("没有创建任务，不要再用", text)
                self.assertEqual(self.pending_record(key)["createdAt"], created)
                self.assertEqual({r["headers"]["idempotency-key"] for r in self.requests_to(SUBMIT)}, {key})

    def test_replay_without_the_saved_body_stops_instead_of_looping_on_3702(self):
        FakeZCode.script[SUBMIT] = [unconfirmed()]
        first = self.call({"action": "generate", "images": ["https://a/1.png"]})
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        self.assertTrue(first["isError"])
        self.assertEqual(len(self.pending_files()), 1)

        shutil.rmtree(self.data_dir)
        FakeZCode.requests = []
        result = self.call({"action": "generate", "images": ["https://a/1.png"], "request_id": key})

        self.assertTrue(result["isError"])
        self.assertIn("找不到", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_submit_retries_stop_at_the_call_budget_and_hand_back_request_id(self):
        # A retry is only started while more than RETRY_DELAY + 100 ms of the call budget is left. With a budget of
        # exactly two delays a third attempt can never start, and the second one only needs the first answer within
        # 1.4 s, so the count does not depend on machine speed.
        FakeZCode.script[SUBMIT] = [unconfirmed()]
        result = self.call(
            {"action": "generate", "images": ["https://a/1.png"]},
            HI3D_3D_RETRY_DELAY_MS="1500",
            HI3D_3D_CALL_BUDGET_MS="3000",
        )
        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 2)
        self.assertIn(submits[0]["headers"]["idempotency-key"], self.text(result))

    def test_waiting_budget_counts_from_the_start_of_the_call(self):
        FakeZCode.script[SUBMIT] = [unconfirmed(), submitted()]
        FakeZCode.script[QUERY] = [status(GEN, "running", "processing")]
        result = self.call(
            {"action": "generate", "images": ["https://a/1.png"]},
            wait_budget_ms=500,
            HI3D_3D_RETRY_DELAY_MS="600",
        )
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["task_id"], GEN)
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_rejected_submit_is_not_retried(self):
        FakeZCode.script[SUBMIT] = [(200, {"code": 3703, "msg": "HI3D_TASK_NOT_READY", "logid": "log-3"})]
        result = self.call({"action": "split", "task_id": GEN})

        self.assertTrue(result["isError"])
        text = self.text(result)
        self.assertIn("log-3", text)
        self.assertIn("前一步任务尚未完成", text)
        self.assertIn("HI3D_TASK_NOT_READY", text)
        self.assertNotIn("request_id", text)
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)
        self.assertEqual(self.requests_to(QUERY), [])
        self.assertEqual(self.pending_files(), [])

    def test_403_envelope_3101_means_no_coding_plan(self):
        FakeZCode.script[SUBMIT] = [(403, {"code": 3101, "msg": "no subscription", "logid": "log-9"})]
        result = self.call({"action": "generate", "images": ["https://a/1.png"]})
        self.assertTrue(result["isError"])
        self.assertIn("Coding Plan", self.text(result))
        self.assertIn("log-9", self.text(result))
        self.assertIn("code 3101", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    def test_403_without_envelope_is_a_generic_permission_error(self):
        FakeZCode.script[SUBMIT] = [(403, "<html>forbidden</html>")]
        result = self.call({"action": "generate", "images": ["https://a/1.png"]})
        self.assertTrue(result["isError"])
        self.assertIn("没有使用 3D 建模的权限", self.text(result))
        self.assertNotIn("Coding Plan", self.text(result))

    def test_403_envelope_3706_names_the_account_binding(self):
        FakeZCode.script[SUBMIT] = [(403, {"code": 3706, "msg": "no zai account", "logid": "log-36"})]
        result = self.call({"action": "generate", "images": ["https://a/1.png"]})
        self.assertTrue(result["isError"])
        self.assertIn("手机号", self.text(result))
        self.assertIn("log-36", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    def test_tool_not_whitelisted_reports_3705(self):
        FakeZCode.script[SUBMIT] = [(404, {"code": 3705, "msg": "path not allowed", "logid": "log-5"})]
        result = self.call({"action": "generate", "images": ["https://a/1.png"]})
        self.assertTrue(result["isError"])
        self.assertIn("3D 接口未在 ZCode 服务端开放", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    # ── downloads ──

    def test_expired_product_link_is_refreshed_once(self):
        FakeZCode.script[QUERY] = [
            self.finished(model="/expired/hi3d/GLB0.glb"),
            self.finished(model="/fresh/hi3d/GLB0.glb"),
        ]
        result = self.call({"task_id": GEN}, tool="get_hi3d_task")

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 2)
        self.assertEqual(self.requests_to(SUBMIT), [])
        paths = [d["path"] for d in FakeZCode.downloads]
        self.assertEqual(paths.count("/expired/hi3d/GLB0.glb"), 1)
        self.assertEqual(paths.count("/fresh/hi3d/GLB0.glb"), 1)
        self.assertEqual(paths.count("/static/hi3d/0.webp"), 1)
        (folder,) = (self.project / "generated-3d").iterdir()
        self.assertEqual((folder / "GLB0.glb").read_bytes(), GLB)
        self.assertIn("/fresh/hi3d/GLB0.glb", result["structuredContent"]["links"]["model"])

    def test_still_expired_link_is_reported_not_failed(self):
        FakeZCode.script[QUERY] = [self.finished(model="/expired/hi3d/GLB0.glb")]
        result = self.call({"task_id": GEN}, tool="get_hi3d_task")

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 2)
        paths = [d["path"] for d in FakeZCode.downloads]
        self.assertEqual(paths.count("/expired/hi3d/GLB0.glb"), 2)
        model = next(f for f in result["structuredContent"]["files"] if "GLB0" in f["url"])
        self.assertIsNone(model["path"])
        self.assertIn("HTTP 403", self.text(result))
        self.assertIn("/expired/hi3d/GLB0.glb", self.text(result))
        self.assertIn("1 小时", self.text(result))

    def test_oversized_download_keeps_the_link_and_writes_nothing(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"action": "generate", "images": ["https://a/1.png"]}, HI3D_3D_MAX_DOWNLOAD_BYTES="1")
        self.assertNotIn("isError", result, self.text(result))
        self.assertTrue(all(f["path"] is None for f in result["structuredContent"]["files"]))
        self.assertIn("GLB0.glb", self.text(result))
        self.assertFalse((self.project / "generated-3d").exists())

    def test_downloads_are_skipped_when_the_call_budget_is_nearly_spent(self):
        # Driven by the MIN_DOWNLOAD_MS hook rather than by a short budget and a slow reply, so the outcome does not
        # depend on machine speed: no download may start with less than an hour of the 320 s budget left.
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": GEN}, tool="get_hi3d_task", HI3D_3D_MIN_DOWNLOAD_MS="3600000")

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(FakeZCode.downloads, [])
        files = result["structuredContent"]["files"]
        self.assertEqual([f["key"] for f in files], ["model", "cover"])
        self.assertTrue(all(f["path"] is None for f in files))
        model = f"{self.origin}/static/hi3d/GLB0.glb{AUTH_QUERY}"
        self.assertEqual(self.model_entry(result)["url"], model)
        text = self.text(result)
        self.assertIn(f"本次调用时间不够，未下载）：{model}", text)
        self.assertIn("0.webp", text)
        # Skipped for lack of time is not an expired link: no refresh query.
        self.assertEqual(len(self.requests_to(QUERY)), 1)
        self.assertIsNone(result["structuredContent"]["output_dir"])
        self.assertFalse((self.project / "generated-3d").exists() and any((self.project / "generated-3d").iterdir()))

    def test_two_tasks_in_the_same_second_get_separate_default_folders(self):
        for _ in range(2):
            FakeZCode.script[QUERY] = [self.finished()]
            result = self.call({"task_id": GEN}, tool="get_hi3d_task")
            self.assertNotIn("isError", result, self.text(result))
        folders = sorted((self.project / "generated-3d").iterdir())
        self.assertEqual(len(folders), 2)
        for folder in folders:
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ["0.webp", "GLB0.glb"])

    def test_parallel_calls_in_one_process_get_separate_default_folders(self):
        FakeZCode.script[QUERY] = [self.finished()]
        results = self.call_many([("get_hi3d_task", {"task_id": GEN}), ("get_hi3d_task", {"task_id": GEN})])

        for result in results:
            self.assertNotIn("isError", result, self.text(result))
        folders = sorted((self.project / "generated-3d").iterdir())
        self.assertEqual(len(folders), 2)
        for folder in folders:
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ["0.webp", "GLB0.glb"])
        # Each call reports exactly one folder, and the two calls report different ones.
        used = [{Path(f["path"]).parent for f in r["structuredContent"]["files"]} for r in results]
        self.assertEqual([len(u) for u in used], [1, 1])
        self.assertEqual(used[0] | used[1], {f.resolve() for f in folders})

    def test_streaming_download_over_the_cap_leaves_no_empty_folder(self):
        # No Content-Length: only the streaming cap can stop these downloads.
        FakeZCode.products["/stream/model.glb"] = (200, b"x" * 5000, NO_LENGTH)
        FakeZCode.products["/stream/cover.webp"] = (200, b"y" * 5000, NO_LENGTH)
        FakeZCode.script[QUERY] = [self.finished(model="/stream/model.glb", cover="/stream/cover.webp")]

        result = self.call({"task_id": GEN}, tool="get_hi3d_task", HI3D_3D_MAX_DOWNLOAD_BYTES="100")

        self.assertNotIn("isError", result, self.text(result))
        self.assertTrue(all(f["path"] is None for f in result["structuredContent"]["files"]))
        self.assertEqual(self.text(result).count("超过下载上限"), 2)
        self.assertIn("/stream/model.glb", self.text(result))
        root = self.project / "generated-3d"
        self.assertEqual(list(root.iterdir()) if root.exists() else [], [])

    def test_product_file_names_are_sanitised_and_stay_in_the_folder(self):
        long_name = "x" * 300 + ".glb"
        FakeZCode.products.update(
            {
                "/a/..%2F..%2F..%2Fevil.glb": (200, GLB),
                "/b/.hidden.webp": (200, WEBP),
                f"/c/{long_name}": (200, GLB),
                "/": (200, WEBP),  # `/d/%2E%2E` is a dot-dot segment: the URL normalises it to `/`.
            }
        )
        FakeZCode.script[QUERY] = [self.finished(model="/a/..%2F..%2F..%2Fevil.glb", cover="/b/.hidden.webp")]
        first = self.call({"task_id": GEN}, tool="get_hi3d_task")
        FakeZCode.script[QUERY] = [self.finished(model=f"/c/{long_name}", cover="/d/%2E%2E")]
        second = self.call({"task_id": GEN}, tool="get_hi3d_task")

        # Separators become "_" and leading dots are dropped; names are capped at 200 UTF-8 bytes (extension kept).
        expected = [["_.._.._evil.glb", "hidden.webp"], ["cover", "x" * 196 + ".glb"]]
        renamed = [
            [("../../../evil.glb", "_.._.._evil.glb"), (".hidden.webp", "hidden.webp")],
            [(long_name, "x" * 196 + ".glb")],  # the fallback "cover" has no upstream name, so it is not a rename
        ]
        for result, names, renames in zip([first, second], expected, renamed):
            self.assertNotIn("isError", result, self.text(result))
            paths = [Path(f["path"]) for f in result["structuredContent"]["files"]]
            self.assertEqual(sorted(p.name for p in paths), names)
            self.assertEqual([(r["from"], r["to"]) for r in result["structuredContent"]["renamed_files"]], renames)
            (folder,) = {p.parent for p in paths}
            self.assertEqual(folder.parent, (self.project / "generated-3d").resolve())
        self.assertEqual([p.relative_to(self.sandbox) for p in self.sandbox.rglob("*evil.glb")], [Path("project/generated-3d") / Path(first["structuredContent"]["files"][0]["path"]).parent.name / "_.._.._evil.glb"])

    def test_symlinked_generated_3d_outside_the_workspace_is_never_written(self):
        elsewhere = self.sandbox / "elsewhere"
        elsewhere.mkdir()
        (self.project / "generated-3d").symlink_to(elsewhere)
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"task_id": GEN}, tool="get_hi3d_task")

        self.assertNotIn("isError", result, self.text(result))
        self.assertTrue(all(f["path"] is None for f in result["structuredContent"]["files"]))
        self.assertEqual(set(result["structuredContent"]["links"]), {"model", "cover"})
        self.assertIn("保存失败", self.text(result))
        self.assertIn("工作区", self.text(result))
        self.assertIn("GLB0.glb", self.text(result))
        self.assertEqual(list(elsewhere.iterdir()), [])

    # ── identity and transport ──

    def test_missing_coding_plan_fails_before_any_request(self):
        result = self.call({"action": "generate", "images": ["https://a/1.png"]}, auth={"ok": False, "reason": "official_auth_plan_required"})
        self.assertTrue(result["isError"])
        self.assertIn("Coding Plan", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_redirect_is_refused(self):
        FakeZCode.script[SUBMIT] = [(302, None)]
        result = self.call({"action": "generate", "images": ["https://a/1.png"]})
        self.assertTrue(result["isError"])
        self.assertIn("重定向", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    def test_non_https_remote_origin_is_refused(self):
        result = self.call({"action": "generate", "images": ["https://a/1.png"]}, base_url="http://zcode.example")
        self.assertTrue(result["isError"])
        self.assertIn("https", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_tool_schemas(self):
        self.call({"task_id": ""}, tool="get_hi3d_task")
        submit = next(t for t in self.tools if t["name"] == "submit_hi3d_task")["inputSchema"]
        self.assertEqual(submit["properties"]["action"]["enum"], ["generate", "texture", "split"])
        self.assertEqual(submit["properties"]["format"]["enum"], ["obj", "glb", "stl", "fbx", "usdz", "3mf"])
        self.assertEqual(submit["properties"]["face"]["type"], ["integer", "string"])
        self.assertEqual(submit["properties"]["images"]["maxItems"], 4)
        self.assertNotIn("maxLength", submit["properties"]["task_id"])
        self.assertIn("output_dir", submit["properties"])
        self.assertIn("request_id", submit["properties"])
        self.assertFalse(submit["additionalProperties"])

    # ── review fixes: unknown arguments (CR-02) ──

    def test_unknown_or_misspelled_arguments_are_refused_before_auth_and_requests(self):
        cases = [
            ("submit_hi3d_task", {"action": "split", "task_id": GEN, "type": "general", "levle": "high"}, ["levle"]),
            ("submit_hi3d_task", {"action": "generate", "images": ["https://a.example/1.png"], "geometryonly": True}, ["geometryonly"]),
            ("submit_hi3d_task", {"action": "generate", "images": ["https://a/1.png"], "prompt": "x", "requestid": "k"}, ["prompt", "requestid"]),
            ("submit_hi3d_task", {"action": "generate", "images": ["https://a/1.png"], "_meta": {}}, ["_meta"]),
            ("get_hi3d_task", {"task_id": GEN, "format": "fbx"}, ["format"]),
        ]
        for tool, arguments, unknown in cases:
            for auth in (None, {"ok": False, "reason": "official_auth_unavailable"}):
                with self.subTest(tool=tool, arguments=arguments, signed_in=auth is None):
                    FakeZCode.requests = []
                    result = self.call(arguments, tool=tool, auth=auth)
                    self.assertTrue(result.get("isError"), self.text(result))
                    text = self.text(result)
                    self.assertIn(f"不支持的参数：{'、'.join(unknown)}", text)
                    # The accepted names are listed so the Agent can fix the spelling.
                    accepted = next(t for t in self.tools if t["name"] == tool)["inputSchema"]["properties"]
                    self.assertIn("可用的参数：" + "、".join(accepted), text)
                    self.assertNotIn("登录", text)
                    self.assertEqual(FakeZCode.requests, [])
                    self.assertEqual(self.pending_files(), [])

    def test_non_object_arguments_are_refused(self):
        for tool in ("submit_hi3d_task", "get_hi3d_task"):
            for arguments in (["generate"], "generate", 5):
                with self.subTest(tool=tool, arguments=arguments):
                    FakeZCode.requests = []
                    result = self.call(arguments, tool=tool)
                    self.assertTrue(result["isError"])
                    self.assertIn("参数必须是对象", self.text(result))
                    self.assertEqual(FakeZCode.requests, [])

    def test_host_meta_is_not_an_argument(self):
        # Identity arrives in params._meta next to the arguments; it must not be mistaken for an unknown argument.
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": GEN}, tool="get_hi3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(QUERY)[0]["headers"]["authorization"], JWT)

    def test_malformed_host_headers_fail_before_any_request(self):
        cases = [
            ({"ok": True, "headers": "Bearer x"}, "未登录"),
            ({"ok": True, "headers": ["Bearer x"]}, "未登录"),
            ({"ok": True, "headers": {"Authorization": "Bearer x\nX-Evil: 1"}}, "登录身份头不合法"),
            ({"ok": False, "reason": "constructor"}, "constructor"),
        ]
        for auth, reason in cases:
            with self.subTest(auth=auth):
                FakeZCode.requests = []
                result = self.call({"action": "generate", "images": ["https://a/1.png"]}, auth=auth)
                self.assertTrue(result["isError"])
                self.assertIn(reason, self.text(result))
                self.assertNotIn("request_id", self.text(result))
                self.assertEqual(FakeZCode.requests, [])

    # ── review fixes: download redirects (CR-01) ──

    HOP = "/hop/hi3d/GLB0.glb"

    def redirect_case(self, location, output_dir="out"):
        FakeZCode.redirects = {self.HOP: location}
        FakeZCode.downloads = []
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished(model=self.HOP)]
        shutil.rmtree(self.project / output_dir, ignore_errors=True)
        return self.call({"task_id": GEN, "output_dir": output_dir}, tool="get_hi3d_task")

    def model_entry(self, result):
        return next(f for f in result["structuredContent"]["files"] if f["key"] == "model")

    def saved_names(self, folder):
        folder = self.project / folder
        return sorted(p.name for p in folder.iterdir()) if folder.exists() else []

    def test_download_redirects_are_checked_hop_by_hop(self):
        port = self.httpd.server_address[1]
        refused = [
            "http://10.0.0.1/admin/model.glb",  # intranet, plain http
            "http://cdn.example/model.glb",  # remote, plain http
            f"http://0.0.0.0:{port}/fresh/hi3d/GLB0.glb",  # reaches this machine but is not an allowed loopback name
            f"http://127.0.0.2:{port}/fresh/hi3d/GLB0.glb",
            with_userinfo(f"http://127.0.0.1:{port}/fresh/hi3d/GLB0.glb"),  # credentials are never allowed
            "file:///etc/hosts",
            "ftp://cdn.example/model.glb",
            "http://[::1",  # unparsable Location
        ]
        link = f"{self.origin}{self.HOP}{AUTH_QUERY}"
        for location in refused:
            with self.subTest(location=location):
                result = self.redirect_case(location)
                self.assertNotIn("isError", result, self.text(result))
                entry = self.model_entry(result)
                self.assertIsNone(entry["path"])
                self.assertEqual(entry["url"], link)
                self.assertIn(f"跳转到了不允许的位置，未下载）：{link}", self.text(result))
                # The refused hop is never requested, and a refused hop is not an expired link: no refresh query.
                self.assertEqual([d["path"] for d in FakeZCode.downloads], [self.HOP, "/static/hi3d/0.webp"])
                self.assertEqual(len(self.requests_to(QUERY)), 1)
                self.assertEqual(self.saved_names("out"), ["0.webp"])

    def test_redirect_loop_and_overlong_chains_are_not_followed(self):
        result = self.redirect_case(self.HOP)
        self.assertNotIn("isError", result, self.text(result))
        self.assertIsNone(self.model_entry(result)["path"])
        self.assertIn("跳转次数过多，未下载", self.text(result))
        self.assertIn(f"{self.HOP}{AUTH_QUERY}", self.text(result))
        # The first request plus at most five followed hops (and the cover).
        self.assertEqual([d["path"] for d in FakeZCode.downloads].count(self.HOP), 6)

        # A chain of exactly five hops is still followed.
        FakeZCode.redirects = {f"/c{i}/hi3d/GLB0.glb": f"/c{i + 1}/hi3d/GLB0.glb" for i in range(4)}
        FakeZCode.redirects["/c4/hi3d/GLB0.glb"] = "/fresh/hi3d/GLB0.glb"
        FakeZCode.downloads = []
        FakeZCode.script[QUERY] = [self.finished(model="/c0/hi3d/GLB0.glb")]
        result = self.call({"task_id": GEN, "output_dir": "chain"}, tool="get_hi3d_task")
        self.assertEqual(Path(self.model_entry(result)["path"]).read_bytes(), GLB)
        self.assertEqual(len([d for d in FakeZCode.downloads if d["path"] != "/static/hi3d/0.webp"]), 6)

    def test_allowed_redirects_still_download_without_identity(self):
        port = self.httpd.server_address[1]
        # Relative and absolute hops to an allowed location (https in production; the loopback test CDN here).
        for location in ("/fresh/hi3d/GLB0.glb", f"http://127.0.0.1:{port}/fresh/hi3d/GLB0.glb?sig=2", f"http://localhost:{port}/fresh/hi3d/GLB0.glb"):
            with self.subTest(location=location):
                result = self.redirect_case(location)
                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(Path(self.model_entry(result)["path"]).read_bytes(), GLB)
                self.assertEqual([d["path"] for d in FakeZCode.downloads], [self.HOP, "/fresh/hi3d/GLB0.glb", "/static/hi3d/0.webp"])
                for download in FakeZCode.downloads:
                    for header in IDENTITY_HEADERS:
                        self.assertNotIn(header, download["headers"])

    def test_redirect_to_an_expired_link_still_refreshes_the_link(self):
        # The first link redirects (legally) to an expired one; the 403 still triggers one refresh query.
        FakeZCode.redirects = {self.HOP: "/expired/hi3d/GLB0.glb"}
        FakeZCode.downloads = []
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished(model=self.HOP), self.finished(model="/fresh/hi3d/GLB0.glb")]
        result = self.call({"task_id": GEN, "output_dir": "refreshed"}, tool="get_hi3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 2)
        self.assertEqual(self.requests_to(SUBMIT), [])
        self.assertEqual(Path(self.model_entry(result)["path"]).read_bytes(), GLB)
        self.assertIn("/fresh/hi3d/GLB0.glb", result["structuredContent"]["links"]["model"])

    def test_refreshed_link_is_checked_hop_by_hop_too(self):
        FakeZCode.redirects = {self.HOP: "http://10.0.0.1/model.glb"}
        FakeZCode.script[QUERY] = [self.finished(model="/expired/hi3d/GLB0.glb"), self.finished(model=self.HOP)]
        result = self.call({"task_id": GEN, "output_dir": "out"}, tool="get_hi3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 2)
        entry = self.model_entry(result)
        self.assertIsNone(entry["path"])
        self.assertTrue(entry["url"].endswith(f"{self.HOP}{AUTH_QUERY}"))
        self.assertIn("跳转到了不允许的位置，未下载", self.text(result))
        self.assertEqual([d["path"] for d in FakeZCode.downloads], ["/expired/hi3d/GLB0.glb", "/static/hi3d/0.webp", self.HOP])
        self.assertEqual(self.saved_names("out"), ["0.webp"])

    def download_rules(self, function, cases):
        """Runs the exported pure rule `function` of server.mjs on each argument list and returns the booleans."""
        script = (
            "const rules = await import(process.env.SERVER_URL);"
            "const cases = JSON.parse(process.env.CASES);"
            "process.stdout.write(JSON.stringify(cases.map((args) => rules[process.env.RULE](...args))));"
        )
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", script], capture_output=True, text=True, timeout=30,
            env={**os.environ, "SERVER_URL": SERVER.as_uri(), "RULE": function, "CASES": json.dumps(cases)},
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        results = json.loads(proc.stdout)
        self.assertEqual(len(results), len(cases))
        return results

    def test_redirect_rules_keep_remote_links_out_of_this_machine_and_the_intranet(self):
        # Loopback (development / test) mode: the API origin itself is a loopback address.
        api_origin = "http://127.0.0.1:9"
        remote = "https://cdn.vendor.example/x/model.glb"
        cases = [
            # A remote https link may only hop to another https link outside this machine and the intranet.
            (remote, "https://cdn.example/y/model.glb", True),
            (remote, "https://8.8.8.8/model.glb", True),
            (remote, "https://172.32.0.1/model.glb", True),
            (remote, "https://[2606:4700::1]/model.glb", True),
            (remote, "http://127.0.0.1:8080/admin/export", False),
            (remote, "http://localhost:8080/admin/export", False),
            (remote, "http://[::1]:8080/admin/export", False),
            (remote, "http://cdn.example/model.glb", False),
            (remote, "https://127.0.0.1/model.glb", False),
            (remote, "https://127.1.2.3/model.glb", False),
            (remote, "https://0x7f.1/model.glb", False),  # the URL parser turns these into 127.0.0.1
            (remote, "https://2130706433/model.glb", False),
            (remote, "https://localhost./model.glb", False),
            (remote, "https://api.localhost/model.glb", False),
            (remote, "https://0.0.0.0/model.glb", False),
            (remote, "https://10.0.0.1/model.glb", False),
            (remote, "https://100.64.0.1/model.glb", False),
            (remote, "https://169.254.169.254/latest/meta-data", False),
            (remote, "https://172.16.0.1/model.glb", False),
            (remote, "https://172.31.255.255/model.glb", False),
            (remote, "https://192.168.1.1/model.glb", False),
            (remote, "https://[::1]/model.glb", False),
            (remote, "https://[::]/model.glb", False),
            (remote, "https://[fd00::1]/model.glb", False),
            (remote, "https://[fe80::1]/model.glb", False),
            (remote, "https://[::ffff:127.0.0.1]/model.glb", False),
            (remote, "https://[::ffff:10.1.2.3]/model.glb", False),
            (remote, with_userinfo("https://cdn.example/model.glb"), False),
            # IPv4-mapped / -compatible / NAT64 IPv6 forms are judged by the IPv4 address inside them.
            (remote, "https://[::ffff:7f00:1]/model.glb", False),
            (remote, "https://[::ffff:10.0.0.1]/model.glb", False),
            (remote, "https://[::ffff:a9fe:a9fe]/model.glb", False),
            (remote, "https://[::127.0.0.1]/model.glb", False),
            (remote, "https://[64:ff9b::10.0.0.1]/model.glb", False),
            (remote, "https://[::ffff:8.8.8.8]/model.glb", True),
            (remote, "https://[64:ff9b::8.8.8.8]/model.glb", True),
            (remote, "http://[::ffff:127.0.0.1]:8080/model.glb", False),
            # Range edges: 100.64.0.0/10, 0.0.0.0/8, 169.254.0.0/16, fc00::/7, fe80::/10, multicast.
            (remote, "https://100.127.255.255/model.glb", False),
            (remote, "https://100.63.255.255/model.glb", True),
            (remote, "https://100.128.0.1/model.glb", True),
            (remote, "https://0.1.2.3/model.glb", False),
            (remote, "https://169.254.0.1/model.glb", False),
            (remote, "https://[fc00::1]/model.glb", False),
            (remote, "https://[fdff:ffff::1]/model.glb", False),
            (remote, "https://[fbff::1]/model.glb", True),
            (remote, "https://[febf::1]/model.glb", False),
            (remote, "https://[fec0::1]/model.glb", False),
            (remote, "https://[ff02::1]/model.glb", False),
            (remote, "https://224.0.0.1/model.glb", False),
            # Decimal, octal and hex IPv4 hosts are normalised by the URL parser before the check.
            (remote, "http://2130706433/model.glb", False),
            (remote, "https://0177.0.0.1/model.glb", False),
            (remote, "https://0x7f000001/model.glb", False),
            (remote, "https://0xa.1/model.glb", False),
            (remote, "https://167772161/model.glb", False),
            # https same-origin hops and hops to another public https host stay allowed.
            ("https://cdn.example/a/model.glb", "https://cdn.example/b/model.glb", True),
            (remote, "https://other-cdn.example/b/model.glb", True),
            # A same-origin hop reaches nothing new, even when the link itself is on a private address.
            ("https://10.0.0.5/a/model.glb", "https://10.0.0.5/b/model.glb", True),
            ("https://10.0.0.5/a/model.glb", "https://10.0.0.5:8443/b/model.glb", False),
            # Development chains that start on a local http loopback link.
            ("http://127.0.0.1:9/a/model.glb", "http://127.0.0.1:9/b/model.glb", True),
            ("http://localhost:9/a/model.glb", "https://127.0.0.1/b/model.glb", True),
            ("http://127.0.0.1:9/a/model.glb", "https://10.0.0.1/b/model.glb", True),  # documented development-mode rule
            ("http://127.0.0.1:9/a/model.glb", "http://10.0.0.1/b/model.glb", False),
            ("http://127.0.0.1:9/a/model.glb", with_userinfo("https://cdn.example/b/model.glb", "u:p"), False),
            # Plain http hops are allowed only when both ends are local loopback links.
            ("http://127.0.0.1:9/a/model.glb", "http://localhost:9/b/model.glb", True),
            ("http://127.0.0.1:9/a/model.glb", "http://[::1]:9/b/model.glb", True),
            ("http://127.0.0.1:9/a/model.glb", "http://2130706433:9/b/model.glb", True),
            ("http://127.0.0.1:9/a/model.glb", "http://[::ffff:127.0.0.1]:9/b/model.glb", False),
            ("http://cdn.example/a/model.glb", "http://127.0.0.1:9/b/model.glb", False),
            ("http://cdn.example/a/model.glb", "https://cdn.example/b/model.glb", False),
            ("http://10.0.0.1/a/model.glb", "http://10.0.0.1/b/model.glb", False),
            ("https://cdn.example/a/model.glb", "http://127.0.0.1:9/b/model.glb", False),
            (with_userinfo("https://cdn.example/a/model.glb"), "https://cdn.example/b/model.glb", False),
        ]
        results = self.download_rules("redirectAllowed", [[a, b, api_origin] for a, b, _ in cases])
        for (origin, location, allowed), actual in zip(cases, results):
            with self.subTest(origin=origin, location=location):
                self.assertIs(actual, allowed)

    def test_first_product_url_and_every_hop_follow_the_same_rule(self):
        # SG-01: the first product URL gets the same private-address check as a redirect hop. Loopback links are
        # accepted only when the API origin (ZCODE_BASE_URL) is itself a loopback address.
        loopback_api = ["http://127.0.0.1:9", "https://localhost:8443", "http://[::1]:9"]
        remote_api = ["https://zcode.example", "https://10.0.0.1", "https://127.0.0.2", None]
        public = ["https://cdn.vendor.example/hi3d/GLB0.glb", "https://8.8.8.8/GLB0.glb", "https://[2606:4700::1]/GLB0.glb",
                  "https://[::ffff:8.8.8.8]/GLB0.glb", "https://100.128.0.1/GLB0.glb"]
        loopback = ["http://127.0.0.1:9/GLB0.glb", "https://127.0.0.1/GLB0.glb", "http://localhost:9/GLB0.glb",
                    "http://[::1]:9/GLB0.glb", "http://2130706433:9/GLB0.glb"]
        private = ["https://10.0.0.1/GLB0.glb", "https://172.16.0.1/GLB0.glb", "https://192.168.1.1/GLB0.glb",
                   "https://169.254.169.254/latest/meta-data", "https://100.64.0.1/GLB0.glb", "https://0.0.0.0/GLB0.glb",
                   "https://224.0.0.1/GLB0.glb", "https://[fd00::1]/GLB0.glb", "https://[fe80::1]/GLB0.glb",
                   "https://[ff02::1]/GLB0.glb", "https://[::]/GLB0.glb", "https://[::ffff:127.0.0.1]/GLB0.glb",
                   "https://[::ffff:10.0.0.1]/GLB0.glb", "https://[64:ff9b::10.0.0.1]/GLB0.glb",
                   "https://0x7f.1/GLB0.glb", "https://0177.0.0.1/GLB0.glb", "https://167772161/GLB0.glb",
                   "https://localhost./GLB0.glb", "https://api.localhost/GLB0.glb", "https://127.1.2.3/GLB0.glb"]
        never = ["http://cdn.example/GLB0.glb", "http://10.0.0.1/GLB0.glb", with_userinfo("https://cdn.example/GLB0.glb"),
                 "file:///etc/hosts", "ftp://cdn.example/GLB0.glb", "not a url"]
        cases = []
        for api in loopback_api:
            cases += [(url, api, True) for url in public + loopback]
            cases += [(url, api, True) for url in private if url.startswith("https://")]  # development mode keeps today's rule
            cases += [(url, api, False) for url in never]
        for api in remote_api:
            cases += [(url, api, True) for url in public]
            cases += [(url, api, False) for url in loopback + private + never]
        results = self.download_rules("downloadableUrl", [[url, api] for url, api, _ in cases])
        for (url, api, allowed), actual in zip(cases, results):
            with self.subTest(url=url, api_origin=api):
                self.assertIs(actual, allowed)

        # Redirect hops are judged with the same API origin: outside loopback mode a hop to (or from) loopback is never
        # followed, and even a same-origin hop on a private address is refused because that link is not downloadable.
        hops = [
            ("https://cdn.vendor.example/x/GLB0.glb", "https://cdn.example/y/GLB0.glb", True),
            ("https://cdn.example/a/GLB0.glb", "https://cdn.example/b/GLB0.glb", True),
            ("https://cdn.vendor.example/x/GLB0.glb", "https://10.0.0.1/GLB0.glb", False),
            ("https://cdn.vendor.example/x/GLB0.glb", "https://[::ffff:7f00:1]/GLB0.glb", False),
            ("https://cdn.vendor.example/x/GLB0.glb", "http://127.0.0.1:9/GLB0.glb", False),
            ("http://127.0.0.1:9/a/GLB0.glb", "http://127.0.0.1:9/b/GLB0.glb", False),
            ("http://127.0.0.1:9/a/GLB0.glb", "https://cdn.example/b/GLB0.glb", False),
            ("https://127.0.0.1/a/GLB0.glb", "https://127.0.0.1/b/GLB0.glb", False),
            ("https://10.0.0.5/a/GLB0.glb", "https://10.0.0.5/b/GLB0.glb", False),
        ]
        for api in remote_api:
            results = self.download_rules("redirectAllowed", [[a, b, api] for a, b, _ in hops])
            for (origin, location, allowed), actual in zip(hops, results):
                with self.subTest(api_origin=api, origin=origin, location=location):
                    self.assertIs(actual, allowed)
        # The same hops in loopback mode: development chains between loopback links keep working.
        results = self.download_rules("redirectAllowed", [[a, b, "http://127.0.0.1:9"] for a, b, _ in hops])
        self.assertEqual(results, [True, True, False, False, False, True, True, True, True])

    def test_private_first_product_url_is_listed_but_never_fetched_outside_loopback_mode(self):
        # The test hook only tightens: it makes the download rule use a non-loopback API origin while the API calls
        # still reach the fake ZCode on loopback. A loopback value is ignored, so it cannot loosen production rules.
        port = self.httpd.server_address[1]
        strict = {"HI3D_3D_TEST_API_ORIGIN": "https://zcode.example"}
        cover = f"https://10.0.0.2/static/hi3d/0.webp{AUTH_QUERY}"
        for url in (f"{self.origin}/static/hi3d/GLB0.glb{AUTH_QUERY}", f"https://127.0.0.1:{port}/static/hi3d/GLB0.glb",
                    "https://10.0.0.1/static/hi3d/GLB0.glb", "https://169.254.169.254/latest/meta-data/GLB0.glb",
                    f"https://[::ffff:127.0.0.1]:{port}/static/hi3d/GLB0.glb", f"http://localhost:{port}/expired/hi3d/GLB0.glb"):
            with self.subTest(url=url):
                FakeZCode.downloads = []
                FakeZCode.requests = []
                FakeZCode.script[QUERY] = [
                    ok({"task_id": GEN, "status": "succeeded", "upstream_status": "success",
                        "output": {"task_id": GEN, "state": "success", "url": url, "cover_url": cover}})
                ]
                shutil.rmtree(self.project / "out", ignore_errors=True)
                result = self.call({"task_id": GEN, "output_dir": "out"}, tool="get_hi3d_task", **strict)
                self.assertNotIn("isError", result, self.text(result))
                files = {f["key"]: f for f in result["structuredContent"]["files"]}
                self.assertEqual({key: f["url"] for key, f in files.items()}, {"model": url, "cover": cover})
                for key, link in (("model", url), ("cover", cover)):
                    self.assertIsNone(files[key]["path"])
                    self.assertIn(f"链接不是 https，或指向本机、内网地址，未下载）：{link}", self.text(result))
                # No request reached the product links, and a refused link is not an expired one: no refresh query.
                self.assertEqual(FakeZCode.downloads, [])
                self.assertEqual(len(self.requests_to(QUERY)), 1)
                self.assertEqual(self.saved_names("out"), [])

        # A loopback value of the hook is ignored: the loopback API origin keeps development downloads and the
        # expired-link refresh working.
        FakeZCode.downloads = []
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [
            self.finished(model="/expired/hi3d/GLB0.glb"),
            self.finished(model="/fresh/hi3d/GLB0.glb"),
        ]
        result = self.call({"task_id": GEN, "output_dir": "dev"}, tool="get_hi3d_task", HI3D_3D_TEST_API_ORIGIN=f"http://localhost:{port}")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 2)
        self.assertEqual(Path(self.model_entry(result)["path"]).read_bytes(), GLB, self.text(result))
        self.assertEqual(sorted(d["path"] for d in FakeZCode.downloads),
                         ["/expired/hi3d/GLB0.glb", "/fresh/hi3d/GLB0.glb", "/static/hi3d/0.webp"])
        for download in FakeZCode.downloads:
            for header in IDENTITY_HEADERS:
                self.assertNotIn(header, download["headers"])

    def test_remote_https_links_cannot_redirect_into_this_machine(self):
        tls_env = self.tls()
        port = self.httpd.server_address[1]
        tls_port = self.httpsd.server_address[1]
        link = f"{self.tls_origin}{self.HOP}{AUTH_QUERY}"
        refused = [
            f"http://127.0.0.1:{port}/fresh/hi3d/GLB0.glb",  # CR-01: a local plain-http service
            f"http://localhost:{port}/fresh/hi3d/GLB0.glb",
            f"https://localhost:{tls_port}/fresh/hi3d/GLB0.glb",  # another origin on this machine
            "https://10.0.0.5/fresh/hi3d/GLB0.glb",
            "https://169.254.169.254/latest/meta-data/GLB0.glb",
        ]
        for location in refused:
            with self.subTest(location=location):
                FakeZCode.redirects = {self.HOP: location}
                FakeZCode.downloads = []
                FakeZCode.requests = []
                FakeZCode.script[QUERY] = [self.finished(model=self.HOP, origin=self.tls_origin)]
                shutil.rmtree(self.project / "out", ignore_errors=True)
                result = self.call({"task_id": GEN, "output_dir": "out"}, tool="get_hi3d_task", **tls_env)
                self.assertNotIn("isError", result, self.text(result))
                entry = self.model_entry(result)
                self.assertIsNone(entry["path"])
                self.assertEqual(entry["url"], link)
                self.assertIn(f"跳转到了不允许的位置，未下载）：{link}", self.text(result))
                # The https link was fetched; the hop was never requested, and no link refresh was asked for.
                self.assertEqual([d["path"] for d in FakeZCode.downloads], [self.HOP, "/static/hi3d/0.webp"])
                self.assertEqual(len(self.requests_to(QUERY)), 1)
                self.assertEqual(self.saved_names("out"), ["0.webp"])

        # A same-origin hop on the https link is still followed (and proves the test certificate is trusted).
        FakeZCode.redirects = {self.HOP: "/fresh/hi3d/GLB0.glb"}
        FakeZCode.downloads = []
        FakeZCode.script[QUERY] = [self.finished(model=self.HOP, origin=self.tls_origin)]
        result = self.call({"task_id": GEN, "output_dir": "same"}, tool="get_hi3d_task", **tls_env)
        self.assertEqual(Path(self.model_entry(result)["path"]).read_bytes(), GLB, self.text(result))
        self.assertEqual([d["path"] for d in FakeZCode.downloads], [self.HOP, "/fresh/hi3d/GLB0.glb", "/static/hi3d/0.webp"])
        for download in FakeZCode.downloads:
            for header in IDENTITY_HEADERS:
                self.assertNotIn(header, download["headers"])

    # ── round 4: DNS check (283 SG-01), http never in production (283 SG-02), product file names (284 SG-03/04) ──

    FAKE_NET = r"""
import dns from "node:dns";
import { appendFileSync } from "node:fs";

// Test-only preload: stands in for the internet. Every non-loopback fetch is answered here and logged, so a test can
// prove that a refused URL was never requested; dns.promises.lookup answers from FAKE_NET_DNS ("hang" never answers)
// and fails like an unknown name for anything else, so no test depends on the real network.
const routes = JSON.parse(process.env.FAKE_NET_ROUTES || "{}");
const answers = JSON.parse(process.env.FAKE_NET_DNS || "{}");
const log = (entry) => appendFileSync(process.env.FAKE_NET_LOG, JSON.stringify(entry) + "\n");
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return realFetch(input, init);
  log({ fetch: url.href, headers: Object.fromEntries(new Headers(init?.headers ?? {})) });
  const route = routes[url.href] ?? { status: 200 };
  if (route.location) return new Response(null, { status: route.status ?? 302, headers: { location: route.location } });
  return new Response(route.body ?? "glTF-fake-model", { status: route.status ?? 200 });
};
dns.promises.lookup = async (host, options) => {
  log({ lookup: host, options });
  const answer = answers[host];
  if (answer === "hang") return new Promise(() => {});
  if (!Array.isArray(answer)) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  return answer.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};
"""

    def fake_net(self, routes=None, answers=None, dns_hook=None, strict=True):
        """Environment for a server process whose internet is the FAKE_NET preload; returns (env, read_log)."""
        preload = self.sandbox / "fake-net.mjs"
        preload.write_text(self.FAKE_NET, encoding="utf-8")
        log = self.sandbox / f"fake-net-{len(list(self.sandbox.glob('fake-net-*.log')))}.log"
        log.write_text("", encoding="utf-8")
        env = {
            "NODE_OPTIONS": f"{os.environ.get('NODE_OPTIONS', '')} --import={preload.as_uri()}".strip(),
            "FAKE_NET_ROUTES": json.dumps(routes or {}),
            "FAKE_NET_DNS": json.dumps(answers or {}),
            "FAKE_NET_LOG": str(log),
        }
        if strict:
            env["HI3D_3D_TEST_API_ORIGIN"] = "https://zcode.example"
        if dns_hook is not None:
            env["HI3D_3D_TEST_DNS"] = json.dumps(dns_hook)

        def read_log():
            return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]

        return env, read_log

    def model_only(self, url):
        """A finished query whose only product is the model at `url` (no cover), so each case has one download."""
        return ok({"task_id": GEN, "status": "succeeded", "upstream_status": "success",
                   "output": {"task_id": GEN, "state": "success", "url": url}})

    def download_via(self, url, env, output_dir="out"):
        FakeZCode.downloads = []
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.model_only(url)]
        shutil.rmtree(self.project / output_dir, ignore_errors=True)
        result = self.call({"task_id": GEN, "output_dir": output_dir}, tool="get_hi3d_task", **env)
        self.assertNotIn("isError", result, self.text(result))
        return result

    def assert_refused(self, result, url, warning, output_dir="out"):
        (entry,) = result["structuredContent"]["files"]
        self.assertIsNone(entry["path"])
        self.assertEqual(entry["url"], url)
        self.assertIn(f"{warning}）：{url}", self.text(result))
        self.assertFalse((self.project / output_dir).exists() and any((self.project / output_dir).iterdir()))
        # A refused link is not an expired one: no refresh query.
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_product_hosts_that_resolve_to_private_addresses_are_refused_before_connecting(self):
        url = "https://cdn.hi3d.test/a/GLB0.glb"
        hop = "https://cdn-hop.hi3d.test/b/GLB0.glb"
        start = "https://8.8.8.8/a/GLB0.glb"
        public = ["93.184.216.34", "2606:2800:220:1::248"]
        for address in ("10.0.0.1", "127.0.0.1", "::ffff:10.0.0.1", "169.254.169.254", "fd00::1", "::1", "not-an-ip"):
            # The resolver says public; the test map adds a private address, and any private address refuses the URL.
            with self.subTest(first_url_mapped_to=address):
                env, read_log = self.fake_net(answers={"cdn.hi3d.test": public}, dns_hook={"cdn.hi3d.test": [address]})
                result = self.download_via(url, env)
                self.assert_refused(result, url, "链接的域名解析到本机或内网地址，未下载")
                self.assertEqual([e for e in read_log() if "fetch" in e], [])
            with self.subTest(hop_mapped_to=address):
                env, read_log = self.fake_net(
                    routes={start: {"location": hop}}, answers={"cdn-hop.hi3d.test": public},
                    dns_hook={"CDN-Hop.hi3d.test.": address},  # host names are compared case-insensitively, without the final dot
                )
                result = self.download_via(start, env)
                self.assert_refused(result, start, "跳转目标的域名解析到本机或内网地址，未下载")
                # Only the first (public literal) URL was requested; the hop never was.
                self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], [start])
            self.assertEqual(FakeZCode.downloads, [])

        # The resolver itself returning any private address (even next to a public one) refuses too, as first URL and as hop.
        for answer in (["10.1.2.3"], ["93.184.216.34", "192.168.0.7"], ["::ffff:127.0.0.1"], ["64:ff9b::a00:1"]):
            with self.subTest(resolved=answer):
                env, read_log = self.fake_net(routes={start: {"location": hop}}, answers={"cdn.hi3d.test": answer, "cdn-hop.hi3d.test": answer})
                self.assert_refused(self.download_via(url, env), url, "链接的域名解析到本机或内网地址，未下载")
                self.assert_refused(self.download_via(start, env), start, "跳转目标的域名解析到本机或内网地址，未下载")
                self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], [start])
                lookups = [e for e in read_log() if "lookup" in e]
                self.assertEqual([e["lookup"] for e in lookups], ["cdn.hi3d.test", "cdn-hop.hi3d.test"])
                self.assertTrue(all(e["options"] == {"all": True, "verbatim": True} for e in lookups))

    def test_product_hosts_that_resolve_publicly_are_downloaded_hop_by_hop(self):
        url = "https://cdn.hi3d.test/a/GLB0.glb"
        hop = "https://cdn-hop.hi3d.test/b/GLB0.glb"
        env, read_log = self.fake_net(
            routes={url: {"location": hop}},
            answers={"cdn.hi3d.test": ["93.184.216.34"], "cdn-hop.hi3d.test": ["2606:2800:220:1::248", "8.8.8.8"]},
            dns_hook={"cdn.hi3d.test": ["1.1.1.1"]},  # a public address in the test map changes nothing
        )
        result = self.download_via(url, env)
        (entry,) = result["structuredContent"]["files"]
        self.assertEqual(Path(entry["path"]).read_bytes(), b"glTF-fake-model", self.text(result))
        events = read_log()
        self.assertEqual([e.get("lookup") or e.get("fetch") for e in events], ["cdn.hi3d.test", url, "cdn-hop.hi3d.test", hop])
        for event in events:
            for header in IDENTITY_HEADERS:
                self.assertNotIn(header, event.get("headers", {}))

    def test_fake_ip_proxy_answers_are_downloaded_but_fake_ip_literals_are_not(self):
        # Clash / mihomo / Surge in TUN or fake-ip mode answer every name with 198.18.0.0/15 (and mihomo's
        # fdfe:dcba:9876::/64 for IPv6); refusing those would stop every download on such machines.
        url = "https://cdn.hi3d.test/a/GLB0.glb"
        hop = "https://cdn-hop.hi3d.test/b/GLB0.glb"
        for answer in (["198.18.0.5"], ["198.19.255.254"], ["198.18.0.23", "fdfe:dcba:9876::17"], ["FDFE:DCBA:9876:0:ffff::1"]):
            with self.subTest(resolved=answer):
                env, read_log = self.fake_net(routes={url: {"location": hop}}, answers={"cdn.hi3d.test": answer, "cdn-hop.hi3d.test": answer})
                result = self.download_via(url, env)
                (entry,) = result["structuredContent"]["files"]
                self.assertEqual(Path(entry["path"]).read_bytes(), b"glTF-fake-model", self.text(result))
                self.assertEqual([e.get("lookup") or e.get("fetch") for e in read_log()], ["cdn.hi3d.test", url, "cdn-hop.hi3d.test", hop])
        # The test map is a resolver answer too: a fake-ip address there does not refuse, and does not hide a private one.
        env, read_log = self.fake_net(answers={"cdn.hi3d.test": ["93.184.216.34"]}, dns_hook={"cdn.hi3d.test": ["198.18.0.5"]})
        self.assertIsNotNone(self.download_via(url, env)["structuredContent"]["files"][0]["path"])
        # Next to a private address, or just outside the fake-ip ranges, the name is still refused before connecting.
        for answer in (["198.18.0.5", "10.0.0.1"], ["fdfe:dcba:9876::17", "fd00::1"], ["fdfe:dcba:9876:1::1"], ["fdfe:dcba:9877::1"],
                       ["::ffff:198.18.0.5"]):
            with self.subTest(resolved=answer):
                env, read_log = self.fake_net(answers={"cdn.hi3d.test": answer})
                self.assert_refused(self.download_via(url, env), url, "链接的域名解析到本机或内网地址，未下载")
                self.assertEqual([e for e in read_log() if "fetch" in e], [])
        # Written as literals in the link (first URL or hop), the fake-ip ranges are refused as before.
        start = "https://8.8.8.8/a/GLB0.glb"
        for literal in ("https://198.18.0.5/GLB0.glb", "https://[fdfe:dcba:9876::17]/GLB0.glb"):
            with self.subTest(literal=literal):
                env, read_log = self.fake_net(routes={start: {"location": literal}})
                self.assert_refused(self.download_via(literal, env), literal, "链接不是 https，或指向本机、内网地址，未下载")
                self.assert_refused(self.download_via(start, env), start, "跳转到了不允许的位置，未下载")
                self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], [start])
                self.assertEqual([e for e in read_log() if "lookup" in e], [])

    def test_test_dns_map_can_only_make_the_check_stricter(self):
        # A public address in the map never lets a private literal, a private name, or an unresolvable name through.
        cases = [
            ("https://10.0.0.1/GLB0.glb", {"10.0.0.1": ["8.8.8.8"]}, "链接不是 https，或指向本机、内网地址，未下载"),
            ("https://[::ffff:10.0.0.1]/GLB0.glb", {"::ffff:10.0.0.1": ["8.8.8.8"], "[::ffff:a00:1]": ["8.8.8.8"]},
             "链接不是 https，或指向本机、内网地址，未下载"),
            ("https://localhost/GLB0.glb", {"localhost": ["8.8.8.8"]}, "链接不是 https，或指向本机、内网地址，未下载"),
            ("https://nowhere.hi3d.test/GLB0.glb", {"nowhere.hi3d.test": ["8.8.8.8"]}, "链接的域名无法解析，未下载"),
            ("https://inside.hi3d.test/GLB0.glb", {"inside.hi3d.test": ["8.8.8.8"]}, "链接的域名解析到本机或内网地址，未下载"),
        ]
        for url, hook, warning in cases:
            with self.subTest(url=url):
                env, read_log = self.fake_net(answers={"inside.hi3d.test": ["10.9.9.9"]}, dns_hook=hook)
                self.assert_refused(self.download_via(url, env), url, warning)
                self.assertEqual([e for e in read_log() if "fetch" in e], [])
        # Malformed hook values are ignored rather than loosening anything.
        for hook in ("not json", "[1, 2]", '"8.8.8.8"'):
            with self.subTest(hook=hook):
                env, read_log = self.fake_net(answers={"inside.hi3d.test": ["10.9.9.9"]})
                env["HI3D_3D_TEST_DNS"] = hook
                url = "https://inside.hi3d.test/GLB0.glb"
                self.assert_refused(self.download_via(url, env), url, "链接的域名解析到本机或内网地址，未下载")

    def test_unresolvable_product_hosts_are_refused_and_literals_are_not_looked_up(self):
        url = "https://gone.hi3d.test/GLB0.glb"
        start = "https://8.8.8.8/a/GLB0.glb"
        env, read_log = self.fake_net(routes={start: {"location": url}})
        self.assert_refused(self.download_via(url, env), url, "链接的域名无法解析，未下载")
        self.assert_refused(self.download_via(start, env), start, "跳转目标的域名无法解析，未下载")
        self.assertEqual([e.get("lookup") or e.get("fetch") for e in read_log()], [url.split("/")[2], start, url.split("/")[2]])

        # IP literals were already judged by downloadableUrl / redirectAllowed: they are fetched without a lookup.
        final = "https://[2606:4700::1]/b/GLB0.glb"
        env, read_log = self.fake_net(routes={start: {"location": final}})
        result = self.download_via(start, env)
        self.assertEqual(Path(result["structuredContent"]["files"][0]["path"]).read_bytes(), b"glTF-fake-model", self.text(result))
        self.assertEqual(read_log(), [{"fetch": start, "headers": {}}, {"fetch": final, "headers": {}}])

    def test_loopback_mode_does_not_look_up_product_hosts(self):
        # Development mode keeps today's rules: no lookup happens, so even a map that says "private" changes nothing.
        FakeZCode.products["/dev/hi3d/GLB0.glb"] = (200, GLB)
        env, read_log = self.fake_net(strict=False, dns_hook={"localhost": ["10.0.0.1"], "127.0.0.1": ["10.0.0.1"], "cdn.hi3d.test": ["10.0.0.1"]})
        for url in (f"{self.origin}/dev/hi3d/GLB0.glb{AUTH_QUERY}", "https://cdn.hi3d.test/dev/GLB0.glb"):
            with self.subTest(url=url):
                result = self.download_via(url, env)
                (entry,) = result["structuredContent"]["files"]
                self.assertIsNotNone(entry["path"], self.text(result))
        self.assertEqual([e for e in read_log() if "lookup" in e], [])
        self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], ["https://cdn.hi3d.test/dev/GLB0.glb"])

    def test_a_hanging_lookup_respects_the_call_budget_and_cancellation(self):
        url = "https://slow.hi3d.test/GLB0.glb"
        env, read_log = self.fake_net(answers={"slow.hi3d.test": "hang"})
        started = time.monotonic()
        result = self.download_via(url, {**env, "HI3D_3D_CALL_BUDGET_MS": "2500"})
        self.assertLess(time.monotonic() - started, 20)
        self.assert_refused(result, url, "下载失败（网络错误或超时）")
        self.assertEqual([e for e in read_log() if "fetch" in e], [])

        env, read_log = self.fake_net(answers={"slow.hi3d.test": "hang"})
        FakeZCode.script[QUERY] = [self.model_only(url)]
        proc = self.start_server(**env)
        proc.stdin.write(json.dumps(self.tool_call("get_hi3d_task", {"task_id": GEN, "output_dir": "out"})) + "\n")
        proc.stdin.flush()
        self.wait_for(lambda: any("lookup" in e for e in read_log()))
        self.cancel_and_finish(proc)
        self.assertEqual([e for e in read_log() if "fetch" in e], [])

    def test_http_is_never_downloaded_or_followed_outside_loopback_mode(self):
        # 283 SG-02: the development-mode leniency for http links must never apply with a non-loopback API origin.
        http_urls = ["http://8.8.8.8/GLB0.glb", "http://cdn.example/GLB0.glb", "http://cdn.hitem3d.ai/x/GLB0.glb",
                     "http://127.0.0.1:9/GLB0.glb", "http://localhost:9/GLB0.glb", "http://[::1]:9/GLB0.glb",
                     "http://10.0.0.1/GLB0.glb", "http://[2606:4700::1]/GLB0.glb"]
        targets = ["https://cdn.example/b/GLB0.glb", "https://8.8.8.8/b/GLB0.glb", "https://cdn.hitem3d.ai/b/GLB0.glb"]
        for api in ("https://zcode.example", "https://10.0.0.1", None):
            with self.subTest(api_origin=api):
                self.assertEqual(self.download_rules("downloadableUrl", [[url, api] for url in http_urls]), [False] * len(http_urls))
                hops = [[start, target, api] for start in http_urls for target in targets + http_urls]
                hops += [[start, start.replace("/GLB0.glb", "/b/GLB0.glb"), api] for start in http_urls]  # same origin
                hops += [[target, url, api] for target in targets for url in http_urls]  # https to http
                self.assertEqual(self.download_rules("redirectAllowed", hops), [False] * len(hops))
        # The same http hops in loopback mode are what development relies on; they must stay distinguishable.
        self.assertEqual(self.download_rules("redirectAllowed", [["http://127.0.0.1:9/a.glb", "https://cdn.example/b.glb", "http://127.0.0.1:9"]]), [True])

        # End to end: an http first URL is never requested, and an https link redirecting to http is not followed.
        start = "https://8.8.8.8/a/GLB0.glb"
        env, read_log = self.fake_net(routes={start: {"location": "http://8.8.4.4/b/GLB0.glb"}})
        for url in ("http://8.8.8.8/GLB0.glb", "http://cdn.hi3d.test/GLB0.glb", f"{self.origin}/static/hi3d/GLB0.glb{AUTH_QUERY}"):
            with self.subTest(url=url):
                self.assert_refused(self.download_via(url, env), url, "链接不是 https，或指向本机、内网地址，未下载")
        self.assert_refused(self.download_via(start, env), start, "跳转到了不允许的位置，未下载")
        self.assertEqual([e.get("fetch") for e in read_log()], [start])
        self.assertEqual(FakeZCode.downloads, [])

    def test_product_file_names_are_kept_unless_unsafe(self):
        astral = "\U00020000"
        cases = [
            # Safe on macOS, Linux and Windows: kept byte for byte, so references between product files keep working.
            ("material 0.mtl", "material 0.mtl"),
            ("tex(1).png", "tex(1).png"),
            ("Ünïcode 模型 (2) [final].obj", "Ünïcode 模型 (2) [final].obj"),
            ("e\u0301.png", "e\u0301.png"),  # a decomposed name is not re-normalised
            ("-rf.glb", "-rf.glb"),
            ("a..b.tar.gz", "a..b.tar.gz"),
            ("con artist.png", "con artist.png"),
            ("console.png", "console.png"),
            ("com10.png", "com10.png"),
            ("nul_", "nul_"),
            ("#1 &more%20=+,;'@!$~`.fbx", "#1 &more%20=+,;'@!$~`.fbx"),
            # Path separators, Windows-forbidden characters and control characters become "_".
            ("a/b.png", "a_b.png"),
            ("a\\b.png", "a_b.png"),
            ("a:b.png", "a_b.png"),
            ('a*?"<>|b.png', "a______b.png"),
            ("a\u0000b\tc\u001f\u007f\u0085.png", "a_b_c___.png"),
            ("../../etc/passwd", "_.._etc_passwd"),
            # Leading and trailing dots and spaces are dropped; dot-only names fall back.
            ("a.png.", "a.png"),
            ("x ", "x"),
            (" . .hidden.png", "hidden.png"),
            ("..", "FALLBACK"),
            (".", "FALLBACK"),
            (". . .", "FALLBACK"),
            ("", "FALLBACK"),
            # Windows reserved device names, any case, with or without an extension, get a "_" prefix.
            ("CON.png", "_CON.png"),
            ("nul", "_nul"),
            ("Aux", "_Aux"),
            ("prn.tar.gz", "_prn.tar.gz"),
            ("COM1.obj", "_COM1.obj"),
            ("lpt9.mtl", "_lpt9.mtl"),
            ("com¹.png", "_com¹.png"),
            ("CON .png", "_CON .png"),
            ("con.", "_con"),
            # Over-long names are cut on whole code points to 200 UTF-8 bytes, keeping the extension.
            ("a" * 192 + astral + "b.obj", "a" * 192 + astral + ".obj"),
            ("\u00e9" * 150 + ".png", "\u00e9" * 98 + ".png"),
            ("a" * 250, "a" * 200),
            ("a" * 195 + " " + "b" * 20 + ".png", "a" * 195 + ".png"),  # no trailing space is left after the cut
            ("a" * 220 + "." + "x" * 30, "a" * 200),
        ]
        names = [name for name, _ in cases]
        results = self.download_rules("sanitizeFileName", [[name, "FALLBACK"] for name in names])
        for (name, expected), actual in zip(cases, results):
            with self.subTest(name=name):
                self.assertEqual(actual, expected)
                self.assertLessEqual(len(actual.encode("utf-8")), 200)
        # Cleaning a clean name changes nothing.
        self.assertEqual(self.download_rules("sanitizeFileName", [[name, "FALLBACK"] for name in results]), results)

    def test_renamed_product_files_are_reported(self):
        FakeZCode.products.update({"/x/CON.glb": (200, GLB), "/x/a%3Ab.webp": (200, WEBP)})
        FakeZCode.script[QUERY] = [self.finished(model="/x/CON.glb", cover="/x/a%3Ab.webp")]
        result = self.call({"task_id": GEN, "output_dir": "out"}, tool="get_hi3d_task")
        self.assertNotIn("isError", result, self.text(result))
        structured = result["structuredContent"]
        self.assertEqual([Path(f["path"]).name for f in structured["files"]], ["_CON.glb", "a_b.webp"])
        self.assertEqual(structured["renamed_files"], [
            {"key": "model", "from": "CON.glb", "to": "_CON.glb"},
            {"key": "cover", "from": "a:b.webp", "to": "a_b.webp"},
        ])
        self.assertIn("mtllib", structured["rename_warning"])
        text = self.text(result)
        self.assertIn("以下文件保存时改了名", text)
        self.assertIn('- "CON.glb" → "_CON.glb"', text)
        self.assertIn('- "a:b.webp" → "a_b.webp"', text)
        self.assertIn(structured["rename_warning"], text)

        # A link refreshed after it expired is reported under its fresh name.
        FakeZCode.products.update({"/fresh/x/NUL.glb": (200, GLB)})
        FakeZCode.script[QUERY] = [self.finished(model="/expired/hi3d/GLB0.glb"), self.finished(model="/fresh/x/NUL.glb")]
        result = self.call({"task_id": GEN, "output_dir": "refreshed"}, tool="get_hi3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(Path(self.model_entry(result)["path"]).name, "_NUL.glb")
        self.assertEqual(result["structuredContent"]["renamed_files"], [{"key": "model", "from": "NUL.glb", "to": "_NUL.glb"}])

        # Nothing renamed: no warning at all; spaces and parentheses are kept.
        FakeZCode.products.update({"/x/tex(1)%20model%200.glb": (200, GLB), "/x/material%200.webp": (200, WEBP)})
        FakeZCode.script[QUERY] = [self.finished(model="/x/tex(1)%20model%200.glb", cover="/x/material%200.webp")]
        result = self.call({"task_id": GEN, "output_dir": "clean"}, tool="get_hi3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual([Path(f["path"]).name for f in result["structuredContent"]["files"]], ["tex(1) model 0.glb", "material 0.webp"])
        self.assertNotIn("renamed_files", result["structuredContent"])
        self.assertNotIn("rename_warning", result["structuredContent"])
        self.assertNotIn("改了名", self.text(result))

    # ── review fixes: API response cap (SG-06) ──

    def test_oversized_submit_response_is_treated_as_unconfirmed(self):
        for with_length in (False, True):
            with self.subTest(content_length=with_length):
                FakeZCode.requests = []
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.script[SUBMIT] = [(200, Big(3 * MIB, with_length))]
                result = self.call({"action": "split", "task_id": GEN})
                self.assertTrue(result["isError"])
                text = self.text(result)
                self.assertIn("服务端响应过大（超过 1 MiB）", text)
                submits = self.requests_to(SUBMIT)
                self.assertGreater(len(submits), 1)
                key = submits[0]["headers"]["idempotency-key"]
                self.assertEqual({r["headers"]["idempotency-key"] for r in submits}, {key})
                self.assertIn(f"request_id：{key}", text)
                self.assertTrue((self.data_dir / "pending" / f"{key}.json").is_file())

        # The same key then replays to a normal answer.
        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [replayed(TEX)]
        FakeZCode.script[QUERY] = [self.finished(TEX)]
        result = self.call({"action": "split", "task_id": GEN, "request_id": key})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"], key)

    def test_oversized_query_and_upload_responses_are_clear_errors(self):
        FakeZCode.script[QUERY] = [(200, Big(2 * MIB))]
        result = self.call({"task_id": GEN}, tool="get_hi3d_task")
        self.assertTrue(result["isError"])
        self.assertIn("服务端响应过大（超过 1 MiB）", self.text(result))
        self.assertIn(GEN, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 1)

        FakeZCode.requests = []
        (self.project / "front.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [(200, Big(2 * MIB, with_length=True))]
        result = self.call({"action": "generate", "images": ["front.png"]})
        self.assertTrue(result["isError"])
        self.assertIn("上传失败，没有提交任务：服务端响应过大", self.text(result))
        self.assertEqual(len(self.requests_to(UPLOAD)), 1)
        self.assertEqual(self.requests_to(SUBMIT), [])

    def test_normal_responses_just_under_the_cap_are_still_read(self):
        status_code, envelope = self.finished()
        envelope["data"]["output"]["note"] = "n" * (MIB - 4096)
        self.assertLess(len(json.dumps(envelope)), MIB)
        FakeZCode.script[QUERY] = [(status_code, envelope)]
        result = self.call({"task_id": GEN}, tool="get_hi3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(Path(self.model_entry(result)["path"]).read_bytes(), GLB)

    # ── review fixes: request_id replay snapshot (SG-04) ──

    def test_replay_note_covers_local_images_and_survives_a_second_uncertain_round(self):
        (self.project / "front.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/u/1.png"})]
        FakeZCode.script[SUBMIT] = [unconfirmed()]
        self.assertTrue(self.call({"action": "generate", "images": ["front.png"]})["isError"])
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]

        # Still unconfirmed on replay: the record keeps the first call's fingerprint.
        FakeZCode.requests = []
        result = self.call({"action": "generate", "images": ["front.png"], "request_id": key})
        self.assertTrue(result["isError"])
        self.assertNotIn("没有生效", self.text(result))

        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [replayed(GEN)]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call(
            {"action": "generate", "images": ["other.png", "back.png"], "views": ["front", "back"], "face": 200000, "request_id": key}
        )
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(UPLOAD), [])
        self.assertEqual(self.replay_note_fields(self.text(result)), ["images", "views", "face"])
        self.assertIn("https://oss.example/u/1.png", self.text(result))

    # ── review fixes: MCP protocol (SG-05) ──

    def test_tool_call_without_an_id_is_not_executed(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]
        for message in (
            self.tool_call("submit_hi3d_task", {"action": "generate", "images": ["https://a/1.png"]}, None),
            {**self.tool_call("get_hi3d_task", {"task_id": GEN}, None), "id": None},
        ):
            with self.subTest(message=message):
                FakeZCode.requests = []
                code, replies, stderr = self.raw(json.dumps(message) + "\n")
                self.assertEqual((code, replies), (0, []), stderr)
                self.assertEqual(FakeZCode.requests, [])
                self.assertFalse((self.project / "generated-3d").exists())

    def test_notifications_never_get_a_response(self):
        notifications = [
            {"jsonrpc": "2.0", "method": "ping"},
            {"jsonrpc": "2.0", "method": "tools/list"},
            {"jsonrpc": "2.0", "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "no/such/method", "id": None},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 1}},
        ]
        ping = {"jsonrpc": "2.0", "id": 7, "method": "ping"}
        code, replies, stderr = self.raw("".join(json.dumps(m) + "\n" for m in [*notifications, ping]))
        self.assertEqual(code, 0, stderr)
        # Only the real request is answered; nothing goes out without an id.
        self.assertEqual(replies, [{"jsonrpc": "2.0", "id": 7, "result": {}}])

    def test_unknown_protocol_version_falls_back_to_a_supported_one(self):
        cases = [("2024-11-05", "2024-11-05"), ("2025-03-26", "2025-03-26"), ("2025-06-18", "2025-06-18"),
                 ("2099-01-01", "2025-06-18"), ("garbage", "2025-06-18"), (None, "2025-06-18"), (5, "2025-06-18")]
        for asked, answered in cases:
            with self.subTest(asked=asked):
                params = {} if asked is None else {"protocolVersion": asked}
                _, replies, _ = self.raw(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": params}) + "\n")
                self.assertEqual(replies[0]["result"]["protocolVersion"], answered)

    def test_malformed_protocol_lines_and_inherited_tool_names_get_errors(self):
        ping = json.dumps({"jsonrpc": "2.0", "id": 9, "method": "ping"})
        inherited = json.dumps({"jsonrpc": "2.0", "id": 8, "method": "tools/call", "params": {"name": "constructor", "arguments": {}}})
        code, replies, stderr = self.raw("null\n5\n[1]\n{bad\n" + inherited + "\n\ufeff" + ping + "\n")
        self.assertEqual(code, 0, stderr)
        self.assertEqual([r.get("error", {}).get("code") for r in replies], [-32600, -32600, -32600, -32700, -32602, None])
        self.assertEqual(replies[-1]["id"], 9)
        self.assertEqual(FakeZCode.requests, [])

    def start_server(self, **extra_env):
        proc = subprocess.Popen(
            ["node", str(SERVER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, env=self.env(**extra_env), cwd=self.project,
        )
        self.addCleanup(proc.kill)
        return proc

    def wait_for(self, condition, seconds=10):
        deadline = time.monotonic() + seconds
        while not condition() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(condition(), "timed out waiting for the server")

    def cancel_and_finish(self, proc, request_id=3):
        started = time.monotonic()
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": request_id}}) + "\n")
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 4, "method": "ping"}) + "\n")
        stdout, stderr = proc.communicate(timeout=30)
        self.assertLess(time.monotonic() - started, 3, "cancelled call did not stop promptly")
        self.assertEqual(proc.returncode, 0, stderr)
        # No result for the cancelled call; the ping is still answered.
        self.assertEqual([json.loads(line).get("id") for line in stdout.splitlines() if "id" in json.loads(line)], [4])

    def test_cancelled_call_stops_polling_without_resubmitting(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [status(GEN, "running", "processing")]
        proc = self.start_server(HI3D_3D_POLL_INTERVAL_MS="5000", HI3D_3D_WAIT_BUDGET_MS="60000")
        proc.stdin.write(json.dumps(self.tool_call("submit_hi3d_task", {"action": "generate", "images": ["https://a/1.png"]})) + "\n")
        proc.stdin.flush()
        self.wait_for(lambda: self.requests_to(QUERY))
        self.cancel_and_finish(proc)
        time.sleep(0.3)
        # The confirmed submit is never sent again and polling stopped during its pause.
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)
        self.assertEqual(len(self.requests_to(QUERY)), 1)
        self.assertEqual(FakeZCode.downloads, [])

    def test_cancelled_call_aborts_an_in_flight_request(self):
        FakeZCode.script[QUERY] = [(200, Slow(8, self.finished()[1]))]
        proc = self.start_server()
        proc.stdin.write(json.dumps(self.tool_call("get_hi3d_task", {"task_id": GEN})) + "\n")
        proc.stdin.flush()
        self.wait_for(lambda: self.requests_to(QUERY))
        self.cancel_and_finish(proc)
        self.assertEqual(len(self.requests_to(QUERY)), 1)
        self.assertEqual(FakeZCode.downloads, [])
        self.assertFalse((self.project / "generated-3d").exists())

    def test_cancelled_submit_retry_is_not_sent_and_cancel_for_other_ids_is_ignored(self):
        FakeZCode.script[SUBMIT] = [unconfirmed()]
        proc = self.start_server(HI3D_3D_RETRY_DELAY_MS="5000")
        proc.stdin.write(json.dumps(self.tool_call("submit_hi3d_task", {"action": "generate", "images": ["https://a/1.png"]})) + "\n")
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 99}}) + "\n")
        proc.stdin.flush()
        self.wait_for(lambda: self.requests_to(SUBMIT))
        self.cancel_and_finish(proc)
        time.sleep(0.3)
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    # ── review fixes: documentation (SG-07) ──

    def test_docs_describe_the_pending_file_permissions_per_platform(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        self.assertNotIn("readable only by the current user", readme)
        self.assertNotIn("仅当前用户可读", readme_cn)
        for text in (readme, readme_cn):
            self.assertIn("Windows", text)
            self.assertIn("ACL", text)
            self.assertIn("0600", text)

    def test_unsaved_pending_record_is_reported_instead_of_promising_a_replay(self):
        # 插件数据目录不可写时，request_id 照样交回，但要明确告诉 Agent 重放会被拒绝，由用户决定。
        self.data_dir.write_text("not a directory")
        FakeZCode.script[SUBMIT] = [(200, TRUNCATED), (401, None)]
        result = self.call({"action": "generate", "images": ["https://cdn.example.com/front.png"]})

        self.assertTrue(result["isError"])
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        text = self.text(result)
        self.assertIn(key, text)
        self.assertIn("没能保存", text)
        self.assertIn("由用户决定", text)
        self.assertTrue(self.data_dir.is_file())


class Hi3dManifestTest(unittest.TestCase):
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

    def manifest(self):
        return json.loads((PLUGIN / ".zcode-plugin" / "plugin.json").read_text(encoding="utf-8"))

    def test_skill_frontmatter(self):
        text = (PLUGIN / "skills" / "hi3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        match = re.match(r"^---\nname: (.+)\ndescription: (.+)\n---\n", text)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), "hi3d-3d")
        for word in ["submit_hi3d_task", "get_hi3d_task", "request_id", "Coding Plan", "logid"]:
            self.assertIn(word, text)

    def test_manifest_declares_official_stdio_auth(self):
        manifest = self.manifest()
        self.assertEqual(manifest["name"], "hi3d-3d")
        self.assertEqual(manifest["skills"], "skills")
        self.assertEqual(list(manifest["mcpServers"]), ["hi3d_3d"])
        server = manifest["mcpServers"]["hi3d_3d"]
        self.assertEqual(server["type"], "stdio")
        self.assertEqual(server["command"], "node")
        self.assertEqual(server["args"], ["${ZCODE_PLUGIN_ROOT}/mcp/server.mjs"])
        self.assertEqual(server["cwd"], "${ZCODE_PROJECT_DIR}")
        self.assertEqual(server["timeoutMs"], 330000)
        self.assertEqual(server["auth"], {"type": "zcode_official", "provider": "jwt_token"})
        self.assertNotIn("env", server, "identity must come from _meta, never from static env")
        self.assertTrue((PLUGIN / "skills" / "hi3d-3d" / "SKILL.md").is_file())

    def test_versions_agree_everywhere(self):
        manifest = self.manifest()
        package = json.loads((PLUGIN / "package.json").read_text(encoding="utf-8"))
        source = SERVER.read_text(encoding="utf-8")
        self.assertEqual(package["name"], "@zcode/hi3d-3d-plugin")
        self.assertEqual(package["version"], manifest["version"])
        self.assertIn(f'const SERVER_VERSION = "{manifest["version"]}";', source)
        self.assertIn('const SERVER_NAME = "hi3d-3d";', source)
        self.assertIn(f'const USAGE_SCENARIO = "{SCENARIO}";', source)

    def test_marketplace_entry_agrees_with_the_manifest(self):
        marketplace = json.loads((ROOT / "marketplace.json").read_text(encoding="utf-8"))
        # Look the entry up by name: other plugins are appended independently, so its position is not fixed.
        entries = [item for item in marketplace["plugins"] if item.get("name") == "hi3d-3d"]
        self.assertEqual(len(entries), 1, "marketplace.json must contain exactly one hi3d-3d entry")
        (entry,) = entries
        manifest = self.manifest()
        self.assertEqual(entry["source"], "./plugins/hi3d-3d")
        self.assertEqual(entry["version"], manifest["version"])
        self.assertEqual(entry["description"], manifest["description"])
        self.assertEqual(entry["description_i18n"], manifest["description_i18n"])
        self.assertEqual(entry["category"], "游戏/3D")
        self.assertIs(entry["requiresPaidPlan"], True)
        self.assertEqual(entry["displayName_i18n"], {"en": "Hi3D", "zh-CN": "Hi3D"})
        self.assertEqual(entry["icon"], "https://cdn-zcode.z.ai/zcode/official-plugin/assets/hi3d-3d/icon.png")
        self.assertTrue((ROOT / "assets" / "hi3d-3d" / "icon.png").is_file())
        # Same entry shape as the other official ToolHub plugins (video-generation), plus example prompts.
        self.assertEqual(
            set(entry),
            {
                "name", "source", "icon", "requiresPaidPlan", "displayName", "displayName_i18n", "description", "description_i18n",
                "version", "author", "category", "keywords", "examplePrompts", "examplePrompts_i18n",
            },
        )
        self.assertTrue(2 <= len(entry["examplePrompts"]) <= 3)
        self.assertEqual(len(entry["examplePrompts_i18n"]["zh-CN"]), len(entry["examplePrompts"]))

    def test_plugin_contains_no_upstream_endpoints_or_tokens(self):
        for path in PLUGIN.rglob("*"):
            if path.is_file():
                text = path.read_text(encoding="utf-8")
                for word in ("toolhubapi", "autoglm", "Bearer "):
                    self.assertNotIn(word, text, f"{path.relative_to(ROOT)} mentions {word}")
                self.assertIsNone(re.search(r"https?://[^\s\"'`]*(debug|test|dev)[^\s\"'`]*", text), path)


    def test_submit_timeout_covers_the_toolhub_runtime_timeout(self):
        # 接入文档建议 hi3d_model3d 服务端超时 120s；插件放宽 10%，且必须留在单次调用 320s 预算内。
        source = SERVER.read_text(encoding="utf-8")
        submit_ms = int(re.search(r"const SUBMIT_TIMEOUT_MS = ([0-9_]+);", source).group(1).replace("_", ""))
        self.assertEqual(submit_ms, 132_000)
        self.assertGreaterEqual(submit_ms * 10, 120_000 * 11)
        self.assertLess(submit_ms, 320_000)


    def test_text_only_requests_are_routed_through_seedream(self):
        # 3D 厂商的方案是 文字 → 图片 → 3D：SKILL、README 和提交工具说明都要引导先用 Seedream 生图。
        skill = (PLUGIN / "skills" / "hi3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        for word in ("text → image → 3D", "`image-generation`", "`generate_image`", "do not call each other"):
            self.assertIn(word, skill)
        self.assertIn("Seedream", (PLUGIN / "README.md").read_text(encoding="utf-8"))
        self.assertIn("Seedream", (PLUGIN / "README_CN.md").read_text(encoding="utf-8"))
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn("image-generation 插件的 generate_image", source)

    def test_user_is_told_before_the_separately_billed_seedream_step(self):
        # SG-02: Seedream is a second, separately billed call. The Agent says so first; Hi3D only accepts images, so if
        # the user declines it asks for a reference image instead of submitting the text.
        skill = (PLUGIN / "skills" / "hi3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        text_only = skill[skill.index("## Text-only requests"):skill.index("## Recommended chains")]
        for phrase in ("Before you call Seedream, tell the user", "billed separately", "Call Seedream only if the user agrees",
                       "If the user declines the extra step, do not call Seedream: ask the user for a reference image instead",
                       "never submit the text itself"):
            self.assertIn(phrase, text_only)
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        section = readme[readme.index("## From text to 3D"):readme.index("## Inputs and outputs")]
        for phrase in ("Before it calls Seedream, the Agent tells you", "billed separately",
                       "If you decline, or Seedream is not installed, the Agent asks you for a reference image instead"):
            self.assertIn(phrase, section)
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        section_cn = readme_cn[readme_cn.index("## 只有文字描述时"):readme_cn.index("## 输入与产物")]
        for phrase in ("调用 Seedream 前，Agent 会先告诉你", "单独计费", "你不同意，或没有安装 Seedream 时，Agent 会请你提供参考图"):
            self.assertIn(phrase, section_cn)
        description = SERVER.read_text(encoding="utf-8")
        for phrase in ("调用 Seedream 前先告诉用户参考图要用 Seedream 生成、单独计费", "用户不同意或 Seedream 不可用时，不调用 Seedream，请用户提供参考图"):
            self.assertIn(phrase, description)

    def test_docs_say_the_first_product_url_and_every_hop_follow_the_same_rule(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        self.assertIn("The first product link and every redirect hop follow the same rule", readme)
        self.assertIn("only when `ZCODE_BASE_URL` itself is a loopback address", readme)
        # Development mode keeps the looser https rule (see the rule table); the docs must say so.
        self.assertIn("In that local-development mode any `https://` link is accepted as the first link, including one on a private address", readme)
        self.assertIn("a redirect from a loopback `http://` link may go to any accepted link", readme)
        self.assertIn("第一个产物链接和之后的每一跳重定向遵循同一条规则", readme_cn)
        self.assertIn("只有 `ZCODE_BASE_URL` 本身是本机回环地址（开发自测）时", readme_cn)
        self.assertIn("在这种开发自测模式下，任何 `https://` 链接都可以作为第一个链接下载，包括指向内网地址的链接", readme_cn)
        self.assertIn("从本机回环 `http://` 链接出发的跳转可以到达任何可接受的链接", readme_cn)
        for text in (readme, readme_cn):
            self.assertNotIn("follow at most five redirects. From an", text)
            self.assertNotIn("从 `https://` 产物链接出发时，每一跳都必须", text)

    def test_docs_describe_the_dns_check_and_the_file_name_rules(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        for phrase in ("the host name of the first link and of every redirect hop is also resolved", "or the name cannot be resolved",
                       "A DNS-rebinding window remains", "is kept exactly as the link gives it, including spaces, parentheses",
                       "Windows device names such as `CON`", "`renamed_files` and `rename_warning`",
                       "references inside OBJ / MTL files may need to be fixed by hand"):
            self.assertIn(phrase, readme)
        for phrase in ("请求第一个链接和每一跳之前还会解析链接的域名", "或者域名无法解析", "仍有 DNS 重绑定的窗口", "按链接给出的原样保留（包括空格、括号",
                       "Windows 设备名", "`renamed_files` 和 `rename_warning`", "OBJ / MTL 文件里的引用可能需要手动修正"):
            self.assertIn(phrase, readme_cn)
        for text in (readme, readme_cn):
            self.assertNotIn("domain names that resolve to private addresses are not checked", text)
        source = SERVER.read_text(encoding="utf-8")
        core = source[source.index("// ════════ 共享核心："):source.index("// ════════ 共享核心结束")]
        self.assertIn("剩余风险（DNS 重绑定）", core)
        self.assertIn("dns.promises.lookup(host, { all: true, verbatim: true })", core)
        self.assertNotIn("域名解析到内网的情况这里管不到", source)

    def test_docs_describe_the_default_folder_and_invocation_id_as_implemented(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        skill = (PLUGIN / "skills" / "hi3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        for text in (readme, readme_cn, skill):
            self.assertIn("generated-3d/<YYYYMMDD-HHMMSS>-<action", text)
            self.assertIn("-model/", text)
            self.assertNotIn("-<action>-model/", text)
            self.assertNotIn("<类型>-model", text)
            self.assertIn("`get_hi3d_task`", text)
            self.assertIn("`null`", text)
            for kind in ("`gen`", "`tex`", "`split`"):
                self.assertIn(kind, text)
        self.assertIn("<action or task kind>", readme)
        self.assertIn("<action 或任务种类>", readme_cn)
        self.assertIn("only present on the submitting call", readme)
        self.assertIn("only when that call itself finishes the task", readme)
        self.assertIn("still running", readme)
        self.assertIn("只在提交的那次调用", readme_cn)
        self.assertIn("本身等到任务完成", readme_cn)
        self.assertIn("仍在进行", readme_cn)
        self.assertIn("only when that call itself finishes the task", skill)
        self.assertIn("still-running submit result", skill)
        # The code builds the folder from the action (submit) or the task kind (get); Hi3D has no prompt, so the
        # slug is always "model".
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn("outputTarget(outputDir, action ?? kind, slugSource)", source)
        self.assertIn("slugSource: body.prompt", source)
        self.assertNotIn('"prompt"', source[source.index("const ACTION_FIELDS"):source.index("const ALL_FIELDS")])

    def test_skill_stops_replaying_a_request_id_that_stays_unconfirmed(self):
        skill = (PLUGIN / "skills" / "hi3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        waiting = skill[skill.index("## Waiting and resubmitting"):skill.index("## Billing")]
        self.assertIn("comes back unconfirmed 3 times in a row, stop replaying it", waiting)
        self.assertIn("let them decide", waiting)
        self.assertIn("submit again without `request_id`", waiting)
        for text in ((PLUGIN / "README.md").read_text(encoding="utf-8"), (PLUGIN / "README_CN.md").read_text(encoding="utf-8")):
            self.assertIn("3001", text)
            self.assertIn("3707", text)
            self.assertIn("24", text)

    def test_docs_only_call_a_rejection_definite_for_a_key_that_was_never_accepted(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        skill = (PLUGIN / "skills" / PLUGIN.name / "SKILL.md").read_text(encoding="utf-8")
        self.assertNotIn("(code 3001, 3703, or 3707)", readme)
        self.assertNotIn("（code 3001、3703、3707）", readme_cn)
        self.assertIn("If the service never accepted that `request_id` before", readme)
        self.assertIn("does not prove that no task was created", readme)
        self.assertIn("如果服务端此前从没受理过这个 `request_id`", readme_cn)
        self.assertIn("证明不了任务没有创建", readme_cn)
        self.assertIn("does not save the record again", readme)
        self.assertIn("不会再保存记录", readme_cn)
        for text in (readme, readme_cn, skill):
            self.assertIn("`succeeded_pending_products`", text)
        waiting = skill[skill.index("## Waiting and resubmitting"):skill.index("## Billing")]
        self.assertIn("if it reports the same again, stop and give the user the `task_id`", waiting)
        self.assertIn("Stop waiting after about 15 minutes of `get_hi3d_task` calls", waiting)
        # The code agrees: 3001 is not a definite rejection, and only a key that was never accepted is dropped.
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn("const DEFINITE_REJECTION_CODES = new Set([3703, 3707]);", source)
        self.assertIn("if (uncertain && definite && !accepted) {", source)

    def test_every_helper_is_used_and_the_shared_core_only_holds_shared_code(self):
        source = SERVER.read_text(encoding="utf-8")
        names = [a or b for a, b in re.findall(r"^(?:export )?(?:async )?function (\w+)|^const (\w+) =", source, re.M)]
        self.assertGreater(len(names), 50)
        unused = [name for name in names if len(re.findall(r"\b%s\b" % re.escape(name), source)) < 2]
        self.assertEqual(unused, [])
        # charCount / integerArg are not used by every sibling plugin, so they stay out of the shared core; Hi3D only
        # needs integerArg (for face), which lives in the Hi3D section.
        core = source[source.index("// ════════ 共享核心："):source.index("// ════════ 共享核心结束")]
        hi3d = source[source.index("// ════════ Hi3D 专属："):source.index("// ════════ 共享核心：")]
        self.assertNotIn("function charCount(", source)
        self.assertNotIn("function integerArg(", core)
        self.assertIn("function integerArg(", hi3d)


    def test_shared_blocks_match_the_sibling_3d_plugins(self):
        # 共享核心、MCP 协议块（以及 Meshy / Hyper3D 的动画库块）必须与仓库里已存在的兄弟 3D 插件逐字节一致。
        # 兄弟插件还没合入当前代码树时跳过对应比对；三个插件都在时，只改了其中一份就会在这里失败。
        def blocks(path):
            text = path.read_text(encoding="utf-8")
            found = {
                "共享核心": text[text.index("// ════════ 共享核心："):text.index("// ════════ 共享核心结束")],
                "MCP 协议": text[text.index("// ════════ 共享：最小 MCP stdio 协议"):],
            }
            if "// ════════ 共享：预设动画库" in text:
                found["动画库"] = text[text.index("// ════════ 共享：预设动画库"):text.index("// ════════ 共享：预设动画库结束")]
            return found

        mine = blocks(SERVER)
        siblings = [
            ROOT / "plugins" / name / "mcp" / "server.mjs"
            for name in ("meshy-3d", "hi3d-3d", "hyper3d-3d")
            if name != PLUGIN.name
        ]
        present = [path for path in siblings if path.is_file()]
        if not present:
            self.skipTest("no sibling 3D plugin in this tree yet")
        for path in present:
            theirs = blocks(path)
            for name in sorted(set(mine) & set(theirs)):
                with self.subTest(sibling=path.parents[1].name, block=name):
                    self.assertEqual(mine[name], theirs[name], f"{name} differs from {path.parents[1].name}; change all three plugins together")


if __name__ == "__main__":
    unittest.main()
