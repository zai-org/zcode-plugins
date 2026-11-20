"""Behavioural contract for the hyper3d-3d plugin (ZCode-official Hyper3D 3D modeling).

Runs the real `mcp/server.mjs` over stdio against a fake ZCode API on loopback, the
same way the ZCode host drives it: identity arrives in `params._meta`, never in env.
"""

from __future__ import annotations

import base64
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
PLUGIN = ROOT / "plugins" / "hyper3d-3d"
SERVER = PLUGIN / "mcp" / "server.mjs"
AUTH_KEY = "com.zcode/official-mcp-auth"
GLB = b"glTF\x02\x00\x00\x00" + b"\x00" * 64
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 24
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JWT = "Bearer test-zcode-jwt"
SUBMIT = "/api/v1/toolhub/tool/hyper3d_model3d/invoke"
QUERY = "/api/v1/toolhub/tool/hyper3d_model3d/tasks/query"
UPLOAD = "/api/v1/toolhub/files"
SCENARIO = "hyper3d_model3d"
TOOLS = ["submit_hyper3d_task", "get_hyper3d_task", "list_hyper3d_animations"]
TRUNCATED = object()
IDENTITY_HEADERS = ("authorization", "x-usage-scenario", "bigmodel-organization", "idempotency-key")
MIB = 1024 * 1024

# Real Hyper3D task ids are `kind:uuid~subscription_key` and 600+ characters long.
_KEY = base64.urlsafe_b64encode(bytes(range(256)) * 2).decode().rstrip("=")
TASK_ID = "gen:3ba98b28-b283-4f07-8970-561b11ffecb1~eyJhbGciOiJIUzI1NiJ9." + _KEY
TEX_TASK_ID = "tex:9c0f7d4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f~eyJhbGciOiJIUzI1NiJ9." + _KEY
POLY_TASK_ID = "poly:5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b~eyJhbGciOiJIUzI1NiJ9." + _KEY
RIG_TASK_ID = "rig:0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d~eyJhbGciOiJIUzI1NiJ9." + _KEY


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


class FakeZCode(BaseHTTPRequestHandler):
    """Records every request; `script` maps a path to a queue of (status, body[, delay_s]) replies.

    GET /files/chunked/... streams the payload without Content-Length (closing the connection to
    end it), so the client can only enforce its size cap while reading the body.
    """

    requests: list[dict] = []
    script: dict[str, list[tuple[int, object]]] = {}
    # GET path (without query) -> Location of a 302 answer.
    redirects: dict[str, str] = {}

    def log_message(self, *_args):  # keep test output quiet
        pass

    def record(self, body=b""):
        FakeZCode.requests.append(
            {
                "method": self.command,
                "path": self.path,
                "headers": {k.lower(): v for k, v in self.headers.items()},
                "body": body,
            }
        )

    def do_GET(self):
        self.record()
        path = self.path.split("?")[0]
        if path in FakeZCode.redirects:
            self.send_response(302)
            self.send_header("Location", FakeZCode.redirects[path])
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path.startswith("/files/") and not path.startswith("/files/missing"):
            payload = WEBP if path.endswith(".webp") else GLB
            chunked = path.startswith("/files/chunked/")
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            if chunked:
                self.send_header("Connection", "close")
                self.close_connection = True
            else:
                self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if chunked:
                for i in range(0, len(payload), 16):
                    self.wfile.write(payload[i : i + 16])
                    self.wfile.flush()
            else:
                self.wfile.write(payload)
            return
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.record(self.rfile.read(length))
        queue = FakeZCode.script.get(self.path) or [(404, {"code": 3705, "msg": "no route"})]
        status, payload, *delay = queue.pop(0) if len(queue) > 1 else queue[0]
        if delay:
            time.sleep(delay[0])
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


def submitted(task_id=TASK_ID):
    return ok({"invocation_id": "244006927289966592", "state": "SUCCEEDED", "output": {"task_id": task_id}})


def replayed(task_id=TASK_ID):
    return ok({"state": "SUCCEEDED", "replayed": True, "upstream_req_id": task_id})


def status(value, task_id=TASK_ID, files=None):
    output = {"uuid": "3ba98b28-b283-4f07-8970-561b11ffecb1", "status": "Done" if value == "succeeded" else "Generating"}
    if files is not None:
        output["files"] = files
    return ok({"task_id": task_id, "status": value, "upstream_status": output["status"], "output": output})


@unittest.skipUnless(shutil.which("node"), "node is required to run the MCP server")
class Hyper3DServerTest(unittest.TestCase):
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
        FakeZCode.script = {}
        FakeZCode.redirects = {}
        self.sandbox = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.sandbox, ignore_errors=True)
        self.project = self.sandbox / "project"
        self.project.mkdir()
        self.data_dir = self.sandbox / "plugin-data"

    def product_files(self):
        return [
            {"name": "base_basic_pbr.glb", "url": f"{self.origin}/files/base_basic_pbr.glb?Expires=1&Signature=abc"},
            {"name": "preview.webp", "url": f"{self.origin}/files/preview.webp"},
        ]

    def finished(self, task_id=TASK_ID, files=None):
        return status("succeeded", task_id, files if files is not None else self.product_files())

    def call(self, arguments, tool="submit_hyper3d_task", auth=None, base_url=None, wait_budget_ms=10_000, **extra_env):
        meta = {
            AUTH_KEY: auth if auth is not None else {"ok": True, "headers": {"Authorization": JWT}},
            "progressToken": "p-1",
        }
        messages = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": tool, "arguments": arguments, "_meta": meta},
            },
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
        self.assertEqual([t["name"] for t in self.tools], TOOLS)
        return replies[3]["result"]

    def env(self, base_url=None, wait_budget_ms=10_000, **extra_env):
        return {
            **os.environ,
            "ZCODE_BASE_URL": base_url or self.origin,
            "ZCODE_PROJECT_DIR": str(self.project),
            "ZCODE_PLUGIN_DATA": str(self.data_dir),
            "HYPER3D_3D_RETRY_DELAY_MS": "10",
            "HYPER3D_3D_POLL_INTERVAL_MS": "10",
            "HYPER3D_3D_WAIT_BUDGET_MS": str(wait_budget_ms),
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

    def downloads(self):
        return [r for r in FakeZCode.requests if r["method"] == "GET"]

    def assert_failed_without_requests(self, result, expected):
        self.assertTrue(result.get("isError"), result)
        self.assertIn(expected, self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    # ── happy path ──

    def test_generate_submits_polls_and_downloads_every_file(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [status("queued"), status("running"), self.finished()]

        result = self.call({"action": "generate", "prompt": "a small wooden treasure chest"})

        self.assertNotIn("isError", result, self.text(result))
        (submit,) = self.requests_to(SUBMIT)
        self.assertEqual(submit["headers"]["authorization"], JWT)
        self.assertEqual(submit["headers"]["x-usage-scenario"], SCENARIO)
        self.assertTrue(submit["headers"]["idempotency-key"])
        self.assertEqual(json.loads(submit["body"]), {"action": "generate", "prompt": "a small wooden treasure chest"})
        queries = self.requests_to(QUERY)
        self.assertEqual(len(queries), 3)
        for query in queries:
            # The 600+ character id round-trips byte for byte.
            self.assertEqual(json.loads(query["body"]), {"task_id": TASK_ID})
            self.assertNotIn("idempotency-key", query["headers"])
            self.assertEqual(query["headers"]["authorization"], JWT)
            self.assertEqual(query["headers"]["x-usage-scenario"], SCENARIO)
        # Product downloads never carry identity or scenario headers.
        gets = self.downloads()
        self.assertEqual(len(gets), 2)
        for get in gets:
            self.assertNotIn("authorization", get["headers"])
            self.assertNotIn("x-usage-scenario", get["headers"])

        structured = result["structuredContent"]
        self.assertEqual(structured["status"], "succeeded")
        self.assertEqual(structured["task_id"], TASK_ID)
        self.assertEqual(structured["action"], "generate")
        paths = [Path(f["path"]) for f in structured["files"]]
        self.assertEqual([p.name for p in paths], ["base_basic_pbr.glb", "preview.webp"])
        self.assertEqual(paths[0].read_bytes(), GLB)
        self.assertEqual(paths[1].read_bytes(), WEBP)
        folder = paths[0].parent
        self.assertEqual(folder.parent, (self.project / "generated-3d").resolve())
        self.assertRegex(folder.name, r"^\d{8}-\d{6}-generate-a-small-wooden-treasure$")
        self.assertNotIn("3ba98b28", str(folder))
        self.assertIn("7 天", self.text(result))
        self.assertIn(TASK_ID, self.text(result))
        self.assertIn("244006927289966592", self.text(result))
        self.assertGreaterEqual(len(self.progress), 3)
        self.assertEqual(self.progress[0]["params"]["progressToken"], "p-1")
        # The first progress message carries the task_id, so a cancelled call can still be fetched later.
        self.assertIn(f"task_id：{TASK_ID}", self.progress[0]["params"]["message"])

    def test_each_action_builds_only_documented_fields(self):
        cases = [
            (
                {
                    "action": "generate",
                    "images": ["https://a.example/front.png", "https://a.example/back.png"],
                    "image_labels": ["f", "B"],
                    "mesh_mode": "quad",
                    "quality": "extra-low",
                    "material": "pbr",
                    "format": "FBX",
                    "ta_pose": True,
                },
                {
                    "action": "generate",
                    "images": ["https://a.example/front.png", "https://a.example/back.png"],
                    "image_labels": ["F", "B"],
                    "mesh_mode": "Quad",
                    "quality": "extra-low",
                    "material": "PBR",
                    "format": "fbx",
                    "ta_pose": True,
                },
            ),
            (
                {
                    "action": "texture",
                    "model_url": "https://a.example/knight.glb",
                    "image": "https://a.example/ref.png",
                    "prompt": "silver armor",
                    "material": "Hybrid",
                    "format": "usdz",
                },
                {
                    "action": "texture",
                    "model_url": "https://a.example/knight.glb",
                    "image": "https://a.example/ref.png",
                    "prompt": "silver armor",
                    "material": "Hybrid",
                    "format": "usdz",
                },
            ),
            (
                {
                    "action": "rig",
                    "task_id": TASK_ID,
                    "bone_template": "human",
                    "animations": ["human_000002", "human_000007"],
                    "in_place": False,
                    "format": "fbx",
                },
                {
                    "action": "rig",
                    "task_id": TASK_ID,
                    "bone_template": "human",
                    "animations": ["human_000002", "human_000007"],
                    "in_place": False,
                    "format": "fbx",
                },
            ),
            (
                {"action": "rig", "model_url": "https://a.example/hero.FBX?sig=1", "prompt": "", "images": []},
                {"action": "rig", "model_url": "https://a.example/hero.FBX?sig=1"},
            ),
        ]
        for arguments, expected in cases:
            with self.subTest(action=arguments["action"], expected=expected):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [self.finished()]
                result = self.call(arguments)
                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(json.loads(self.requests_to(SUBMIT)[0]["body"]), expected)

    def test_local_validation_failures_make_no_request(self):
        (self.project / "ref.gif").write_bytes(b"GIF89a")
        too_long = "x" * 1025
        cases = [
            ({}, "action"),
            ({"action": "animation_library"}, "list_hyper3d_animations"),
            ({"action": "split", "prompt": "x"}, "generate / polygen / texture / rig"),
            ({"action": "generate"}, "prompt 或 images"),
            ({"action": "generate", "prompt": too_long}, "1024"),
            ({"action": "generate", "images": ["https://a.example/x.png"] * 6}, "最多 5"),
            ({"action": "generate", "prompt": "x", "image_labels": ["F"]}, "images"),
            ({"action": "generate", "images": ["https://a.example/x.png"], "image_labels": ["F", "B"]}, "个数"),
            ({"action": "generate", "images": ["https://a.example/x.png"], "image_labels": ["X"]}, "image_labels"),
            ({"action": "generate", "prompt": "x", "mesh_mode": "tri"}, "Raw / Quad"),
            ({"action": "generate", "prompt": "x", "quality": "ultra"}, "quality"),
            ({"action": "generate", "prompt": "x", "format": "gltf"}, "glb / usdz / fbx / obj / stl"),
            ({"action": "generate", "prompt": "x", "ta_pose": "yes"}, "ta_pose"),
            ({"action": "generate", "images": ["http://a.example/x.png"]}, "https"),
            ({"action": "generate", "images": [with_userinfo("https://a.example/x.png", "u:p")]}, "账号密码"),
            ({"action": "generate", "images": ["ftp://a.example/x.png"]}, "https"),
            ({"action": "generate", "images": ["https://a.example/model.glb"]}, "3D 模型"),
            ({"action": "generate", "images": ["missing.png"]}, "读不到"),
            ({"action": "generate", "images": ["ref.gif"]}, "png"),
            ({"action": "generate", "images": ["data:image/gif;base64,R0lGOD=="]}, "png / jpeg / webp"),
            ({"action": "generate", "images": ["data:image/png;base64,***"]}, "base64"),
            ({"action": "generate", "prompt": "x", "bone_template": "human"}, "bone_template 只用于 action=rig"),
            ({"action": "texture", "image": "https://a.example/r.png"}, "model_url"),
            ({"action": "texture", "model_url": "https://a.example/m.glb"}, "image"),
            ({"action": "texture", "model_url": "https://a.example/m.glb", "image": ["https://a.example/r.png"]}, "一张"),
            ({"action": "texture", "model_url": "https://a.example/m.usd", "image": "https://a.example/r.png"}, "texture 的 model_url"),
            ({"action": "texture", "model_url": "http://a.example/m.glb", "image": "https://a.example/r.png"}, "https"),
            (
                {"action": "texture", "model_url": "https://a.example/m.glb", "image": "https://a.example/r.png", "material": "None"},
                "PBR / Shaded / All / Hybrid",
            ),
            ({"action": "texture", "model_url": "https://a.example/m.glb", "image": "https://a.example/r.png", "task_id": TASK_ID}, "task_id 只用于 action=polygen / rig"),
            ({"action": "rig"}, "二选一"),
            ({"action": "rig", "task_id": TASK_ID, "model_url": "https://a.example/m.glb"}, "二选一"),
            ({"action": "rig", "model_url": "https://a.example/m.gltf"}, "rig 的 model_url"),
            ({"action": "rig", "task_id": TASK_ID, "animations": [f"human_{i:06d}" for i in range(11)]}, "最多 10"),
            ({"action": "rig", "task_id": TASK_ID, "animations": ["human_000002", "human_000002"]}, "重复"),
            ({"action": "rig", "task_id": TASK_ID, "format": "obj"}, "glb / fbx / usdz"),
            ({"action": "rig", "task_id": TASK_ID, "bone_template": "robot"}, "bone_template"),
            ({"action": "rig", "task_id": TASK_ID, "in_place": "true"}, "in_place"),
            ({"action": "rig", "task_id": TASK_ID, "quality": "low"}, "quality 只用于 action=generate"),
        ]
        for arguments, expected in cases:
            with self.subTest(arguments={k: (v[:40] if isinstance(v, str) else v) for k, v in arguments.items()}):
                FakeZCode.requests = []
                self.assert_failed_without_requests(self.call(arguments), expected)

    def test_rig_task_id_must_come_from_generate(self):
        cases = [
            ({"action": "rig", "task_id": TEX_TASK_ID}, "gen:"),
            ({"action": "rig", "task_id": "rig:abc~def"}, "gen:"),
            ({"action": "rig", "task_id": "3ba98b28-b283-4f07-8970-561b11ffecb1"}, "gen:"),
            ({"action": "rig", "task_id": TASK_ID[:300] + "\n" + TASK_ID[300:]}, "空白"),
        ]
        for arguments, expected in cases:
            with self.subTest(task_id=arguments["task_id"][:12]):
                FakeZCode.requests = []
                self.assert_failed_without_requests(self.call(arguments), expected)
        FakeZCode.requests = []
        self.assert_failed_without_requests(
            self.call({"task_id": TASK_ID[:300] + " " + TASK_ID[300:]}, tool="get_hyper3d_task"), "空白"
        )

    # ── polygen (Smart Low Poly) ──

    def test_polygen_builds_the_body_for_each_input_mode(self):
        cases = [
            # Rodin asset by task_id: only the given fields, no defaults filled in.
            ({"action": "polygen", "task_id": TASK_ID, "face_count": 4000}, {"action": "polygen", "task_id": TASK_ID, "face_count": 4000}),
            (
                {
                    "action": "polygen",
                    "task_id": TASK_ID,
                    "images": ["https://a.example/front.png"],
                    "prompt": "weathered bronze",
                    "face_count": " 1500 ",
                    "mesh_mode": "ngon",
                    "material": "pbr",
                    "format": "GLB",
                    "uhd_texture": True,
                },
                {
                    "action": "polygen",
                    "task_id": TASK_ID,
                    "images": ["https://a.example/front.png"],
                    "prompt": "weathered bronze",
                    "face_count": 1500,
                    "mesh_mode": "NGon",
                    "material": "PBR",
                    "format": "glb",
                    "uhd_texture": True,
                },
            ),
            # Uploaded model: an explicit transfer_texture false is sent; images may refine the mesh.
            (
                {"action": "polygen", "model_url": "https://a.example/hero.glb", "transfer_texture": False},
                {"action": "polygen", "model_url": "https://a.example/hero.glb", "transfer_texture": False},
            ),
            (
                {
                    "action": "polygen",
                    "model_url": "https://a.example/hero.USDC?sig=1",
                    "images": ["https://a.example/front.png", "https://a.example/back.png"],
                    "image_labels": ["f"],
                    "face_count": 10000,
                    "mesh_mode": "Raw",
                    "format": "fbx",
                    "transfer_texture": True,
                },
                {
                    "action": "polygen",
                    "model_url": "https://a.example/hero.USDC?sig=1",
                    "images": ["https://a.example/front.png", "https://a.example/back.png"],
                    "image_labels": ["F"],
                    "face_count": 10000,
                    "mesh_mode": "Raw",
                    "format": "fbx",
                    "transfer_texture": True,
                },
            ),
            # Values that count as "not given" are never sent, even where they would not apply.
            (
                {"action": "polygen", "model_url": "https://a.example/hero.obj", "prompt": " ", "material": "", "uhd_texture": False},
                {"action": "polygen", "model_url": "https://a.example/hero.obj"},
            ),
            # Reference images.
            (
                {"action": "polygen", "images": ["https://a.example/front.png"], "material": "PBR"},
                {"action": "polygen", "images": ["https://a.example/front.png"], "material": "PBR"},
            ),
            # Text.
            (
                {"action": "polygen", "prompt": "a low-poly wooden stool", "face_count": 200, "material": "None", "format": "obj"},
                {"action": "polygen", "prompt": "a low-poly wooden stool", "face_count": 200, "material": "None", "format": "obj"},
            ),
            ({"action": "polygen", "prompt": "a low-poly wooden stool"}, {"action": "polygen", "prompt": "a low-poly wooden stool"}),
            (
                {"action": "polygen", "prompt": "stool", "uhd_texture": False, "transfer_texture": False},
                {"action": "polygen", "prompt": "stool", "uhd_texture": False},
            ),
        ]
        for arguments, expected in cases:
            with self.subTest(expected=expected):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted(POLY_TASK_ID)]
                FakeZCode.script[QUERY] = [self.finished(POLY_TASK_ID)]
                result = self.call(arguments)
                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(json.loads(self.requests_to(SUBMIT)[0]["body"]), expected)
                structured = result["structuredContent"]
                self.assertEqual(structured["action"], "polygen")
                self.assertEqual(structured["kind"], "poly")
                self.assertRegex(Path(structured["files"][0]["path"]).parent.name, r"^\d{8}-\d{6}-polygen-")
        # The tool schema advertises the new action and fields.
        schema = next(t for t in self.tools if t["name"] == "submit_hyper3d_task")["inputSchema"]["properties"]
        self.assertEqual(schema["action"]["enum"], ["generate", "polygen", "texture", "rig"])
        self.assertEqual(schema["face_count"]["type"], ["integer", "string"])
        self.assertEqual(schema["transfer_texture"]["type"], "boolean")
        self.assertEqual(schema["uhd_texture"]["type"], "boolean")
        self.assertEqual(schema["mesh_mode"]["enum"], ["Raw", "Quad", "NGon"])
        self.assertIn("NGon", schema["mesh_mode"]["description"])
        self.assertIn("polygen", schema["material"]["description"])
        self.assertIn("默认 obj", schema["format"]["description"])

    def test_polygen_local_validation_failures_make_no_request(self):
        (self.project / "hero.glb").write_bytes(GLB)
        model = "https://a.example/hero.glb"
        cases = [
            ({"action": "polygen"}, "至少给一个"),
            ({"action": "polygen", "prompt": "   ", "images": []}, "至少给一个"),
            ({"action": "polygen", "task_id": TASK_ID, "model_url": model}, "二选一"),
            ({"action": "polygen", "task_id": TASK_ID[:300] + "\n" + TASK_ID[300:]}, "空白"),
            ({"action": "polygen", "model_url": "http://a.example/hero.glb"}, "https"),
            ({"action": "polygen", "model_url": "https://a.example/hero.gltf"}, "action=polygen 的 model_url"),
            ({"action": "polygen", "model_url": "hero.glb"}, "本地 3D 模型"),
            ({"action": "polygen", "images": ["https://a.example/x.png"] * 6}, "最多 5"),
            ({"action": "polygen", "images": ["http://a.example/x.png"]}, "https"),
            ({"action": "polygen", "images": "https://a.example/x.png"}, "images 必须是数组"),
            ({"action": "polygen", "prompt": "x" * 1025}, "1024"),
            ({"action": "polygen", "prompt": "x", "face_count": 199}, "200 到 10000"),
            ({"action": "polygen", "prompt": "x", "face_count": 10001}, "200 到 10000"),
            ({"action": "polygen", "prompt": "x", "face_count": "4k"}, "face_count"),
            ({"action": "polygen", "prompt": "x", "face_count": 1500.5}, "face_count"),
            ({"action": "polygen", "prompt": "x", "face_count": True}, "face_count"),
            ({"action": "polygen", "prompt": "x", "image_labels": ["F"]}, "必须和 images 一起"),
            ({"action": "polygen", "images": ["https://a.example/x.png"], "image_labels": ["F", "B"]}, "不能比 images 多"),
            ({"action": "polygen", "images": ["https://a.example/x.png"], "image_labels": ["Top"]}, "F / FL / FR"),
            ({"action": "polygen", "model_url": model, "prompt": "stool"}, "prompt 不适用"),
            ({"action": "polygen", "model_url": model, "material": "PBR"}, "material 不适用"),
            ({"action": "polygen", "model_url": model, "uhd_texture": True}, "uhd_texture 不适用"),
            ({"action": "polygen", "prompt": "stool", "transfer_texture": True}, "transfer_texture 只在"),
            ({"action": "polygen", "task_id": TASK_ID, "transfer_texture": True}, "transfer_texture 只在"),
            ({"action": "polygen", "model_url": model, "transfer_texture": "no"}, "transfer_texture 必须是 true 或 false"),
            ({"action": "polygen", "prompt": "x", "uhd_texture": "yes"}, "uhd_texture 必须是 true 或 false"),
            ({"action": "polygen", "prompt": "x", "mesh_mode": "tri"}, "Raw / Quad / NGon"),
            ({"action": "polygen", "prompt": "x", "format": "gltf"}, "obj / glb / usdz / fbx / stl"),
            ({"action": "polygen", "prompt": "x", "material": "Metal"}, "PBR / Shaded / All / Hybrid / None"),
            # Fields of other actions are refused on polygen ...
            ({"action": "polygen", "prompt": "x", "quality": "low"}, "quality 只用于 action=generate"),
            ({"action": "polygen", "prompt": "x", "ta_pose": True}, "ta_pose 只用于 action=generate"),
            ({"action": "polygen", "model_url": model, "image": "https://a.example/r.png"}, "image 只用于 action=texture"),
            ({"action": "polygen", "task_id": TASK_ID, "animations": ["human_000002"]}, "animations 只用于 action=rig"),
            # ... and the polygen-only fields are refused on the other actions.
            ({"action": "generate", "prompt": "x", "face_count": 4000}, "face_count 只用于 action=polygen"),
            ({"action": "generate", "prompt": "x", "uhd_texture": True}, "uhd_texture 只用于 action=polygen"),
            (
                {"action": "texture", "model_url": model, "image": "https://a.example/r.png", "transfer_texture": True},
                "transfer_texture 只用于 action=polygen",
            ),
            ({"action": "rig", "task_id": TASK_ID, "face_count": "4000"}, "face_count 只用于 action=polygen"),
        ]
        for arguments, expected in cases:
            for auth in (None, {"ok": False, "reason": "official_auth_unavailable"}):
                shown = {k: (v[:40] if isinstance(v, str) else v) for k, v in arguments.items()}
                with self.subTest(arguments=shown, signed_in=auth is None):
                    FakeZCode.requests = []
                    result = self.call(arguments, auth=auth)
                    # Rejected locally, before the identity is even read: never a sign-in error.
                    self.assert_failed_without_requests(result, expected)
                    self.assertNotIn("登录", self.text(result))

    def test_ngon_mesh_mode_is_only_accepted_for_polygen(self):
        for spelling in ("NGon", "ngon"):
            with self.subTest(spelling=spelling):
                FakeZCode.requests = []
                result = self.call({"action": "generate", "prompt": "x", "mesh_mode": spelling})
                self.assert_failed_without_requests(result, "只用于 action=polygen")
                self.assertIn("Raw / Quad", self.text(result))
        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [submitted(POLY_TASK_ID)]
        FakeZCode.script[QUERY] = [self.finished(POLY_TASK_ID)]
        result = self.call({"action": "polygen", "prompt": "x", "mesh_mode": "ngon"})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(json.loads(self.requests_to(SUBMIT)[0]["body"])["mesh_mode"], "NGon")

    def test_polygen_image_labels_may_be_shorter_than_images_but_never_longer(self):
        images = ["https://a.example/1.png", "https://a.example/2.png", "https://a.example/3.png"]
        for labels in (["F"], ["F", "B"], ["F", "B", "?"]):
            with self.subTest(labels=labels):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted(POLY_TASK_ID)]
                FakeZCode.script[QUERY] = [self.finished(POLY_TASK_ID)]
                result = self.call({"action": "polygen", "images": images, "image_labels": labels})
                self.assertNotIn("isError", result, self.text(result))
                body = json.loads(self.requests_to(SUBMIT)[0]["body"])
                self.assertEqual(body["image_labels"], labels)
                self.assertEqual(body["images"], images)
        FakeZCode.requests = []
        self.assert_failed_without_requests(
            self.call({"action": "polygen", "images": images[:2], "image_labels": ["F", "B", "L"]}), "不能比 images 多"
        )
        # generate keeps its "same length" rule.
        FakeZCode.requests = []
        self.assert_failed_without_requests(self.call({"action": "generate", "images": images, "image_labels": ["F"]}), "个数")

    def test_polygen_obj_result_downloads_the_obj_with_its_material_and_textures(self):
        files = [
            {"name": "base_basic_shaded.obj", "url": f"{self.origin}/files/poly/base_basic_shaded.obj?Expires=1&Signature=abc"},
            {"name": "base_basic_shaded.mtl", "url": f"{self.origin}/files/poly/base_basic_shaded.mtl?Expires=1"},
            {"name": "texture_diffuse.png", "url": f"{self.origin}/files/poly/texture_diffuse.png"},
            {"name": "texture_normal.png", "url": f"{self.origin}/files/poly/texture_normal.png"},
            {"name": "preview.webp", "url": f"{self.origin}/files/poly/preview.webp"},
        ]
        FakeZCode.script[SUBMIT] = [submitted(POLY_TASK_ID)]
        FakeZCode.script[QUERY] = [status("running", POLY_TASK_ID), status("succeeded", POLY_TASK_ID, files)]

        result = self.call({"action": "polygen", "task_id": TASK_ID, "material": "PBR"})

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.downloads()), len(files))
        saved = [Path(f["path"]) for f in result["structuredContent"]["files"]]
        # Original names, one folder: the OBJ still finds its .mtl, and the .mtl its textures.
        self.assertEqual([p.name for p in saved], [f["name"] for f in files])
        self.assertEqual({p.parent for p in saved}, {saved[0].parent})
        self.assertEqual(Path(result["structuredContent"]["output_dir"]), saved[0].parent)
        self.assertTrue(all(p.is_file() for p in saved))
        self.assertEqual(set(result["structuredContent"]["links"]), {f["name"] for f in files})
        text = self.text(result)
        self.assertIn(POLY_TASK_ID, text)
        # A poly: result cannot be chained by task_id; the Agent is told to pass the downloaded model as model_url.
        self.assertIn("model_url", text)
        self.assertNotIn("可把这个 task_id 原样用于", text)

    def test_poly_task_id_cannot_be_rigged_or_used_as_a_polygen_source(self):
        cases = [
            ({"action": "rig", "task_id": POLY_TASK_ID}, "poly"),
            ({"action": "polygen", "task_id": POLY_TASK_ID}, "poly"),
            ({"action": "polygen", "task_id": POLY_TASK_ID, "face_count": 500}, "poly"),
            ({"action": "polygen", "task_id": TEX_TASK_ID}, "tex"),
            ({"action": "polygen", "task_id": RIG_TASK_ID}, "rig"),
            ({"action": "polygen", "task_id": "3ba98b28-b283-4f07-8970-561b11ffecb1"}, None),
        ]
        for arguments, kind in cases:
            with self.subTest(action=arguments["action"], task_id=arguments["task_id"][:5]):
                FakeZCode.requests = []
                result = self.call(arguments)
                self.assert_failed_without_requests(result, "gen:")
                text = self.text(result)
                self.assertIn("model_url", text)
                self.assertIn("下载", text)
                if kind:
                    self.assertIn(f"收到的是 {kind}: 任务", text)
        # get_hyper3d_task still fetches poly: tasks; the folder uses the task kind.
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished(POLY_TASK_ID)]
        result = self.call({"task_id": POLY_TASK_ID}, tool="get_hyper3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["kind"], "poly")
        self.assertRegex(Path(result["structuredContent"]["files"][0]["path"]).parent.name, r"^\d{8}-\d{6}-poly-model$")
        self.assertIn("不能用于 rig 或 polygen", self.text(result))
        # A generate task id points at both follow-ups.
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")
        self.assertIn("action=polygen", self.text(result))

    def test_local_polygen_images_are_uploaded_after_validation(self):
        (self.project / "front.png").write_bytes(PNG)
        # An invalid argument after a local image: nothing is uploaded.
        self.assert_failed_without_requests(
            self.call({"action": "polygen", "images": ["front.png"], "face_count": 50}), "200 到 10000"
        )
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/toolhub/front.png?sig=1", "expires_at": "2026-11-20T00:00:00Z"})]
        FakeZCode.script[SUBMIT] = [submitted(POLY_TASK_ID)]
        FakeZCode.script[QUERY] = [self.finished(POLY_TASK_ID)]
        result = self.call({"action": "polygen", "images": ["front.png"], "image_labels": ["F"], "face_count": 800})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(UPLOAD)), 1)
        self.assertEqual(
            json.loads(self.requests_to(SUBMIT)[0]["body"]),
            {"action": "polygen", "images": ["https://oss.example/toolhub/front.png?sig=1"], "image_labels": ["F"], "face_count": 800},
        )

    def test_local_model_files_are_rejected(self):
        (self.project / "hero.glb").write_bytes(GLB)
        cases = [
            {"action": "rig", "model_url": "hero.glb"},
            {"action": "rig", "model_url": str(self.project / "hero.glb")},
            {"action": "texture", "model_url": "./hero.glb", "image": "https://a.example/r.png"},
            # A local model passed where an image is expected gets the same explanation.
            {"action": "generate", "images": ["hero.glb"]},
        ]
        for arguments in cases:
            with self.subTest(arguments):
                FakeZCode.requests = []
                result = self.call(arguments)
                self.assert_failed_without_requests(result, "本地 3D 模型")
                self.assertIn("https", self.text(result))
        FakeZCode.requests = []
        self.assert_failed_without_requests(
            self.call({"action": "rig", "model_url": (self.project / "hero.glb").as_uri()}), "https"
        )

    def test_local_and_data_images_are_uploaded_with_identity(self):
        (self.project / "ref.png").write_bytes(PNG)
        data_url = "data:image/png;base64," + base64.b64encode(PNG).decode()
        FakeZCode.script[UPLOAD] = [
            ok({"url": "https://oss.example/toolhub/1.png?sig=1", "expires_at": "2026-11-20T00:00:00Z"}),
            ok({"url": "https://oss.example/toolhub/2.png?sig=2", "expires_at": "2026-11-20T00:00:00Z"}),
        ]
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call(
            {"action": "generate", "images": ["ref.png", data_url, "https://cdn.example/c.png"], "image_labels": ["F", "B", "?"]}
        )

        self.assertNotIn("isError", result, self.text(result))
        uploads = self.requests_to(UPLOAD)
        self.assertEqual(len(uploads), 2)
        for upload in uploads:
            self.assertIn("multipart/form-data", upload["headers"]["content-type"])
            self.assertIn(PNG, upload["body"])
            self.assertEqual(upload["headers"]["authorization"], JWT)
            self.assertEqual(upload["headers"]["x-usage-scenario"], SCENARIO)
            self.assertNotIn("idempotency-key", upload["headers"])
        body = json.loads(self.requests_to(SUBMIT)[0]["body"])
        self.assertEqual(
            body["images"],
            ["https://oss.example/toolhub/1.png?sig=1", "https://oss.example/toolhub/2.png?sig=2", "https://cdn.example/c.png"],
        )

        FakeZCode.requests = []
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/toolhub/3.png?sig=3"})]
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"action": "texture", "model_url": "https://a.example/knight.glb", "image": "ref.png"})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(json.loads(self.requests_to(SUBMIT)[0]["body"])["image"], "https://oss.example/toolhub/3.png?sig=3")

    # ── workspace paths and downloads ──

    def test_paths_outside_the_workspace_are_refused_before_any_request(self):
        secret = self.sandbox / "secret.png"
        secret.write_bytes(PNG)
        (self.project / "link.png").symlink_to(secret)
        (self.project / "out-link").symlink_to(self.sandbox)
        cases = [
            {"action": "generate", "images": ["../secret.png"]},
            {"action": "generate", "images": [str(secret)]},
            {"action": "generate", "images": ["link.png"]},
            {"action": "generate", "prompt": "x", "output_dir": "../outside"},
            {"action": "generate", "prompt": "x", "output_dir": str(self.sandbox)},
            {"action": "generate", "prompt": "x", "output_dir": "out-link/models"},
        ]
        for arguments in cases:
            with self.subTest(arguments):
                FakeZCode.requests = []
                self.assert_failed_without_requests(self.call(arguments), "工作区")
        FakeZCode.requests = []
        self.assert_failed_without_requests(
            self.call({"task_id": TASK_ID, "output_dir": "../outside"}, tool="get_hyper3d_task"), "工作区"
        )
        self.assertFalse((self.sandbox / "outside").exists())

    def test_default_folder_behind_an_escaping_symlink_degrades_to_links(self):
        outside = self.sandbox / "outside"
        outside.mkdir()
        (self.project / "generated-3d").symlink_to(outside)
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")

        self.assertNotIn("isError", result, self.text(result))
        files = result["structuredContent"]["files"]
        self.assertEqual(len(files), 2)
        self.assertTrue(all(f["path"] is None for f in files))
        self.assertIn("工作区", self.text(result))
        self.assertIn("base_basic_pbr.glb?Expires=1", self.text(result))
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual(self.downloads(), [])

    def test_output_dir_that_is_a_file_is_refused(self):
        (self.project / "taken.txt").write_bytes(b"keep")
        self.assert_failed_without_requests(
            self.call({"action": "generate", "prompt": "x", "output_dir": "taken.txt"}), "不是目录"
        )
        self.assertEqual((self.project / "taken.txt").read_bytes(), b"keep")

    def test_existing_files_are_never_overwritten(self):
        out = self.project / "models"
        out.mkdir()
        (out / "base_basic_pbr.glb").write_bytes(b"keep")
        files = self.product_files() + [{"name": "preview.webp", "url": f"{self.origin}/files/second/preview.webp"}]
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished(files=files)]

        result = self.call({"action": "generate", "prompt": "chest", "output_dir": "models"})

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual((out / "base_basic_pbr.glb").read_bytes(), b"keep")
        names = [Path(f["path"]).name for f in result["structuredContent"]["files"]]
        self.assertEqual(names, ["base_basic_pbr-1.glb", "preview.webp", "preview-1.webp"])
        self.assertEqual((out / "base_basic_pbr-1.glb").read_bytes(), GLB)
        # A collision suffix is a rename too: OBJ / MTL references to the original name would no longer match.
        self.assertEqual(result["structuredContent"]["renamed_files"], [
            {"key": "base_basic_pbr.glb", "from": "base_basic_pbr.glb", "to": "base_basic_pbr-1.glb"},
            {"key": "preview.webp", "from": "preview.webp", "to": "preview-1.webp"},
        ])
        self.assertIn('- "base_basic_pbr.glb" → "base_basic_pbr-1.glb"', self.text(result))
        self.assertIn("可能需要手动修正", self.text(result))
        self.assertEqual(Path(result["structuredContent"]["output_dir"]), out.resolve())

    def test_file_names_are_sanitized_and_never_taken_from_the_task_id(self):
        files = [
            {"name": "../../escape.glb", "url": f"{self.origin}/files/a.glb"},
            {"name": "", "url": f"{self.origin}/files/from%20url.glb?x=1"},
            {"url": f"{self.origin}/files/"},
        ]
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished(files=files)]

        result = self.call({"action": "generate", "prompt": "chest", "output_dir": "models"})

        self.assertNotIn("isError", result, self.text(result))
        names = [Path(f["path"]).name for f in result["structuredContent"]["files"]]
        # Separators become "_" and leading dots are dropped; a safe name (with a space) is kept as is.
        self.assertEqual(names, ["_.._escape.glb", "from url.glb", "file-3"])
        self.assertEqual(result["structuredContent"]["renamed_files"], [{"key": "_.._escape.glb", "from": "../../escape.glb", "to": "_.._escape.glb"}])
        for f in result["structuredContent"]["files"]:
            self.assertEqual(Path(f["path"]).parent, (self.project / "models").resolve())
        self.assertFalse((self.sandbox / "escape.glb").exists())

    def test_failed_or_oversized_downloads_keep_the_link(self):
        files = self.product_files() + [{"name": "missing.glb", "url": f"{self.origin}/files/missing.glb"}]
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished(files=files)]
        result = self.call({"action": "generate", "prompt": "chest"})
        self.assertNotIn("isError", result, self.text(result))
        paths = [f["path"] for f in result["structuredContent"]["files"]]
        self.assertIsNotNone(paths[0])
        self.assertIsNone(paths[2])
        self.assertIn("HTTP 404", self.text(result))
        self.assertIn(f"{self.origin}/files/missing.glb", self.text(result))

        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task", HYPER3D_3D_MAX_DOWNLOAD_BYTES="1")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual([f["path"] for f in result["structuredContent"]["files"]], [None, None])
        self.assertIn("base_basic_pbr.glb?Expires=1", self.text(result))
        for folder in (self.project / "generated-3d").glob("*-gen-model"):
            self.assertEqual(list(folder.iterdir()), [])

    def test_size_cap_is_enforced_while_streaming_without_content_length(self):
        files = [{"name": "model.glb", "url": f"{self.origin}/files/chunked/model.glb"}]
        FakeZCode.script[QUERY] = [self.finished(files=files)]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")
        self.assertNotIn("isError", result, self.text(result))
        (saved,) = result["structuredContent"]["files"]
        self.assertEqual(Path(saved["path"]).read_bytes(), GLB)

        FakeZCode.requests = []
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task", HYPER3D_3D_MAX_DOWNLOAD_BYTES=str(len(GLB) - 1))
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.downloads()), 1)
        self.assertEqual([f["path"] for f in result["structuredContent"]["files"]], [None])
        self.assertIn("单个文件上限", self.text(result))
        self.assertIn(f"{self.origin}/files/chunked/model.glb", self.text(result))
        # Only the first, uncapped download is on disk; the capped one left nothing behind.
        saved_files = [f.resolve() for f in (self.project / "generated-3d").rglob("*") if f.is_file()]
        self.assertEqual(saved_files, [Path(saved["path"]).resolve()])

    def test_downloads_are_skipped_when_the_call_budget_is_nearly_spent(self):
        # Driven by the MIN_DOWNLOAD_MS hook rather than by a short budget and a slow reply, so the outcome does not
        # depend on machine speed: no download may start with less than an hour of the 320 s budget left.
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task", HYPER3D_3D_MIN_DOWNLOAD_MS="3600000")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.downloads(), [])
        self.assertEqual([f["path"] for f in result["structuredContent"]["files"]], [None, None])
        self.assertIsNone(result["structuredContent"]["output_dir"])
        self.assertFalse((self.project / "generated-3d").exists() and any((self.project / "generated-3d").iterdir()))
        self.assertIn("本次调用时间不够", self.text(result))
        self.assertIn("base_basic_pbr.glb?Expires=1", self.text(result))
        self.assertIn(f"{self.origin}/files/preview.webp", self.text(result))

    def test_at_most_twenty_files_are_downloaded(self):
        files = [{"name": f"part{i}.glb", "url": f"{self.origin}/files/part{i}.glb"} for i in range(22)]
        FakeZCode.script[QUERY] = [self.finished(files=files)]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.downloads()), 20)
        files = result["structuredContent"]["files"]
        self.assertEqual(len(files), 22)
        self.assertEqual([f["path"] is None for f in files], [False] * 20 + [True, True])
        self.assertEqual(len(result["structuredContent"]["links"]), 22)
        self.assertIn("part21.glb", self.text(result))
        self.assertIn("单次最多下载 20 个文件", self.text(result))

    # ── waiting ──

    def test_still_running_returns_task_id_without_resubmitting(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [status("running")]

        result = self.call({"action": "generate", "prompt": "chest"}, wait_budget_ms=100)

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["task_id"], TASK_ID)
        self.assertEqual(result["structuredContent"]["status"], "running")
        self.assertIn("get_hyper3d_task", self.text(result))
        self.assertIn(TASK_ID, self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)
        self.assertFalse((self.project / "generated-3d").exists())

    def test_invocation_id_appears_only_when_the_submit_call_finishes_with_products(self):
        # The docs promise exactly this: value on a completed submit, missing on a still-running submit,
        # null on a completed get_hyper3d_task.
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"action": "generate", "prompt": "chest", "output_dir": "done"})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["invocation_id"], "244006927289966592")
        self.assertIn("invocation_id：244006927289966592", self.text(result))

        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [status("running")]
        result = self.call({"action": "generate", "prompt": "chest"}, wait_budget_ms=100)
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["status"], "running")
        self.assertNotIn("invocation_id", result["structuredContent"])
        self.assertNotIn("invocation_id", self.text(result))

        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": TASK_ID, "output_dir": "got"}, tool="get_hyper3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["status"], "succeeded")
        self.assertIsNone(result["structuredContent"]["invocation_id"])
        self.assertNotIn("invocation_id", self.text(result))

    def test_succeeded_without_files_keeps_polling(self):
        FakeZCode.script[QUERY] = [self.finished(files=[]), status("succeeded"), self.finished()]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 3)
        self.assertEqual(len([f for f in result["structuredContent"]["files"] if f["path"]]), 2)
        self.assertTrue(any("产物还在准备" in m["params"]["message"] for m in self.progress))

        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished(files=[])]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task", wait_budget_ms=100)
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["status"], "succeeded_pending_products")
        self.assertEqual(result["structuredContent"]["task_id"], TASK_ID)

    def test_succeeded_without_usable_files_keeps_polling_after_submit(self):
        # The status may flip to succeeded before the files are written (or written without a usable url).
        unusable = [
            None,
            [],
            "pending",
            {"status": "Done"},
            {"files": "pending"},
            {"files": [None, {"name": "a.glb"}, {"name": "b.glb", "url": "  "}]},
        ]
        for output in unusable:
            with self.subTest(output=output):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [ok({"task_id": TASK_ID, "status": "succeeded", "output": output}), self.finished()]
                result = self.call({"action": "generate", "prompt": "chest", "output_dir": "out"})

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(len(self.requests_to(QUERY)), 2)
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)
                self.assertEqual(Path(result["structuredContent"]["files"][0]["path"]).read_bytes(), GLB)
                self.assertTrue(any("产物还在准备" in m["params"]["message"] for m in self.progress))
                shutil.rmtree(self.project / "out")

    def test_succeeded_without_files_until_the_budget_runs_out_returns_the_task_id(self):
        # The task already succeeded (and is billed): say so with a distinct status and a stop condition,
        # instead of "still running", so the Agent does not poll a finished task forever.
        for tool, arguments in [("submit_hyper3d_task", {"action": "generate", "prompt": "chest"}), ("get_hyper3d_task", {"task_id": TASK_ID})]:
            with self.subTest(tool=tool):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [self.finished(files=[])]
                result = self.call(arguments, tool=tool, wait_budget_ms=200)

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(result["structuredContent"]["status"], "succeeded_pending_products")
                self.assertEqual(result["structuredContent"]["task_id"], TASK_ID)
                text = self.text(result)
                self.assertIn(TASK_ID, text)
                self.assertIn("已成功（已按成功计费）", text)
                self.assertIn("get_hyper3d_task", text)
                self.assertIn("请停止查询，把 task_id 告诉用户", text)
                self.assertNotIn("还在进行", text)
                self.assertEqual(len(self.requests_to(SUBMIT)), 1 if tool == "submit_hyper3d_task" else 0)
                self.assertFalse((self.project / "generated-3d").exists())

        # A task that is merely running keeps the plain still-running answer.
        FakeZCode.script[QUERY] = [status("running")]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task", wait_budget_ms=200)
        self.assertEqual(result["structuredContent"]["status"], "running")
        self.assertNotIn("停止查询", self.text(result))
    def test_get_task_only_polls_and_resumes(self):
        FakeZCode.script[QUERY] = [(500, {"code": 2007, "msg": "blip"}), status("running"), self.finished()]

        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(SUBMIT), [])
        self.assertEqual(len(self.requests_to(QUERY)), 3)
        folder = Path(result["structuredContent"]["files"][0]["path"]).parent
        self.assertRegex(folder.name, r"^\d{8}-\d{6}-gen-model$")
        self.assertIsNone(result["structuredContent"]["action"])
        self.assertEqual(result["structuredContent"]["kind"], "gen")
        self.assertIn("action=rig", self.text(result))

    def test_failed_task_is_terminal_and_reports_the_failure_code(self):
        FakeZCode.script[QUERY] = [
            ok({"task_id": TASK_ID, "status": "failed", "failure": {"code": "HYPER3D_TASK_FAILED", "message": "mesh error"}})
        ]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")

        self.assertTrue(result["isError"])
        self.assertIn("HYPER3D_TASK_FAILED", self.text(result))
        self.assertIn("mesh error", self.text(result))
        self.assertIn("未扣费", self.text(result))
        self.assertNotIn("get_hyper3d_task", self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_unknown_task_stops_polling(self):
        FakeZCode.script[QUERY] = [(200, {"code": 3704, "msg": "TASK_NOT_FOUND", "logid": "log-44"})]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")

        self.assertTrue(result["isError"])
        self.assertIn("log-44", self.text(result))
        self.assertNotIn("get_hyper3d_task", self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_query_errors_after_submit_keep_the_task_id(self):
        for reply in [(401, None), (404, "<html>gateway</html>"), (200, {"code": 3701, "msg": "down"}), (200, "null")]:
            with self.subTest(reply=reply):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [reply]
                result = self.call({"action": "generate", "prompt": "chest"})

                self.assertTrue(result["isError"])
                self.assertIn(TASK_ID, self.text(result))
                self.assertIn("get_hyper3d_task", self.text(result))
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    def test_transient_query_errors_after_submit_keep_the_task_id(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [(500, {"code": 2007, "msg": "upstream"})]
        result = self.call({"action": "generate", "prompt": "chest"}, wait_budget_ms=100)
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["task_id"], TASK_ID)
        self.assertIn("get_hyper3d_task", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    # ── submit idempotency ──

    def test_submit_transients_replay_the_same_key(self):
        FakeZCode.script[SUBMIT] = [
            (500, {"code": 2007, "msg": "upstream"}),
            ok({"state": "UNKNOWN"}),
            ok({"state": "CALLING"}),
            replayed(),
        ]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"action": "generate", "prompt": "chest"})

        self.assertNotIn("isError", result, self.text(result))
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 4)
        self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)
        self.assertEqual(len({r["body"] for r in submits}), 1)
        self.assertEqual(json.loads(self.requests_to(QUERY)[0]["body"]), {"task_id": TASK_ID})
        self.assertFalse((self.data_dir / "pending").exists() and list((self.data_dir / "pending").iterdir()))

    def test_submit_body_cut_off_mid_read_is_replayed_with_the_same_key(self):
        FakeZCode.script[SUBMIT] = [(200, TRUNCATED)]
        result = self.call({"action": "generate", "prompt": "chest"})

        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        self.assertGreater(len(submits), 1)
        key = submits[0]["headers"]["idempotency-key"]
        self.assertEqual({r["headers"]["idempotency-key"] for r in submits}, {key})
        self.assertIn(f"request_id：{key}", self.text(result))

    def test_unreadable_2xx_submit_reply_is_replayed_with_the_same_key(self):
        for garbled in ['{"code":0,"data":{"invocation_id":"24400', "<html>interstitial</html>", "null", {"msg": "no code"}]:
            with self.subTest(garbled=garbled):
                FakeZCode.requests = []
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.script[SUBMIT] = [(200, garbled), replayed()]
                FakeZCode.script[QUERY] = [self.finished()]
                result = self.call({"action": "generate", "prompt": "chest"})

                self.assertNotIn("isError", result, self.text(result))
                submits = self.requests_to(SUBMIT)
                self.assertEqual(len(submits), 2)
                self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)
                self.assertEqual(result["structuredContent"]["task_id"], TASK_ID)

        # Still unreadable after every replay: the key comes back as request_id and the body is kept.
        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [(202, '{"code":0,"data":')]
        result = self.call({"action": "generate", "prompt": "chest"})
        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        self.assertGreater(len(submits), 1)
        key = submits[0]["headers"]["idempotency-key"]
        self.assertEqual({r["headers"]["idempotency-key"] for r in submits}, {key})
        self.assertIn(f"request_id：{key}", self.text(result))
        self.assertEqual(json.loads((self.data_dir / "pending" / f"{key}.json").read_text())["body"], json.loads(submits[0]["body"]))

    def test_accepted_submit_without_task_id_is_replayed_with_the_same_key(self):
        for accepted in [
            ok({"invocation_id": "244006927289966592", "state": "SUCCEEDED", "output": {}}),
            ok({"invocation_id": "244006927289966592", "state": "SUCCEEDED", "output": {"task_id": ""}}),
            ok("not an object"),
            ok({"state": "SOMETHING_NEW"}),
        ]:
            with self.subTest(accepted=accepted):
                FakeZCode.requests = []
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.script[SUBMIT] = [accepted, replayed()]
                FakeZCode.script[QUERY] = [self.finished()]
                result = self.call({"action": "generate", "prompt": "chest"})

                self.assertNotIn("isError", result, self.text(result))
                submits = self.requests_to(SUBMIT)
                self.assertEqual(len(submits), 2)
                self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)
                self.assertEqual(json.loads(self.requests_to(QUERY)[0]["body"]), {"task_id": TASK_ID})

        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [ok({"state": "SUCCEEDED", "output": {}})]
        result = self.call({"action": "texture", "model_url": "https://a.example/m.glb", "image": "https://a.example/t.png"})
        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        self.assertGreater(len(submits), 1)
        key = submits[0]["headers"]["idempotency-key"]
        self.assertEqual({r["headers"]["idempotency-key"] for r in submits}, {key})
        self.assertIn(f"request_id：{key}", self.text(result))
        self.assertIn("没有返回 task_id", self.text(result))
        self.assertTrue((self.data_dir / "pending" / f"{key}.json").exists())

    def test_hard_error_after_an_uncertain_attempt_hands_back_request_id_and_persists_body(self):
        for second in [(401, None), (404, "<html>gateway</html>"), (200, {"code": 3701, "msg": "down"})]:
            with self.subTest(status=second[0]):
                FakeZCode.requests = []
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.script[SUBMIT] = [(200, TRUNCATED), second]
                result = self.call({"action": "rig", "task_id": TASK_ID, "animations": ["human_000002"]})

                self.assertTrue(result["isError"])
                first = self.requests_to(SUBMIT)[0]
                key = first["headers"]["idempotency-key"]
                self.assertIn(key, self.text(result))
                saved = self.data_dir / "pending" / f"{key}.json"
                record = json.loads(saved.read_text())
                self.assertEqual(record["body"], json.loads(first["body"]))
                # Business arguments are kept only as per-field fingerprints, never request_id / output_dir or identity.
                self.assertEqual(set(record["args"]), {"action", "task_id", "animations"})
                self.assertTrue(all(re.fullmatch(r"[0-9a-f]{64}", value) for value in record["args"].values()))
                self.assertEqual(stat.S_IMODE(saved.stat().st_mode), 0o600)
                self.assertNotIn(JWT, saved.read_text())

    def test_request_id_replay_reuses_the_persisted_body_verbatim(self):
        (self.project / "ref.png").write_bytes(PNG)
        for arguments, warned in [
            ({"action": "generate", "prompt": "a chest", "images": ["ref.png"]}, None),
            ({"action": "generate", "prompt": "a dragon", "images": ["ref.png"]}, "prompt"),
            # Every business field is compared, so the dropped images are named too.
            ({"action": "rig", "task_id": TASK_ID}, "action、prompt、images、task_id"),
        ]:
            with self.subTest(arguments=arguments):
                FakeZCode.requests = []
                FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/1.png"}), ok({"url": "https://oss.example/2.png"})]
                FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
                result = self.call({"action": "generate", "prompt": "a chest", "images": ["ref.png"]})
                self.assertTrue(result["isError"])
                first = self.requests_to(SUBMIT)[0]
                key = first["headers"]["idempotency-key"]
                self.assertTrue((self.data_dir / "pending" / f"{key}.json").exists())

                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [replayed()]
                FakeZCode.script[QUERY] = [self.finished()]
                result = self.call({**arguments, "request_id": key})

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(self.requests_to(UPLOAD), [])
                (replay,) = self.requests_to(SUBMIT)
                self.assertEqual(replay["headers"]["idempotency-key"], key)
                self.assertEqual(replay["body"], first["body"])
                if warned:
                    self.assertIn(f"本次修改的 {warned} 没有生效", self.text(result))
                else:
                    self.assertNotIn("没有生效", self.text(result))
                self.assertFalse((self.data_dir / "pending" / f"{key}.json").exists())

    def test_replay_without_the_saved_body_stops_instead_of_looping_on_3702(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        first = self.call({"action": "generate", "prompt": "chest"})
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        self.assertTrue(first["isError"])

        shutil.rmtree(self.data_dir)
        FakeZCode.requests = []
        result = self.call({"action": "generate", "prompt": "chest", "request_id": key})

        self.assertTrue(result["isError"])
        self.assertIn("找不到", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_submit_retries_stop_at_the_call_budget_and_hand_back_request_id(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        # A retry is only started while more than RETRY_DELAY + 100 ms of the call budget is left. With a budget of
        # exactly two delays a third attempt can never start, and the second one only needs the first answer within
        # 1.4 s, so the count does not depend on machine speed.
        result = self.call(
            {"action": "generate", "prompt": "chest"},
            HYPER3D_3D_RETRY_DELAY_MS="1500",
            HYPER3D_3D_CALL_BUDGET_MS="3000",
        )
        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 2)
        self.assertIn(submits[0]["headers"]["idempotency-key"], self.text(result))

    def test_waiting_budget_counts_from_the_start_of_the_call(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"}), submitted()]
        FakeZCode.script[QUERY] = [status("running")]
        result = self.call({"action": "generate", "prompt": "chest"}, wait_budget_ms=500, HYPER3D_3D_RETRY_DELAY_MS="600")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["task_id"], TASK_ID)
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_rejected_submit_is_not_retried(self):
        FakeZCode.script[SUBMIT] = [(200, {"code": 3703, "msg": "HYPER3D_IMAGE_CONTENT_VIOLATION", "logid": "log-3"})]
        result = self.call({"action": "generate", "prompt": "chest"})

        self.assertTrue(result["isError"])
        self.assertIn("log-3", self.text(result))
        self.assertIn("没有创建任务", self.text(result))
        self.assertIn("HYPER3D_IMAGE_CONTENT_VIOLATION", self.text(result))
        self.assertNotIn("request_id", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)
        self.assertEqual(self.requests_to(QUERY), [])

    def test_forbidden_reads_the_envelope_first(self):
        FakeZCode.script[SUBMIT] = [(403, {"code": 3101, "msg": "no coding plan", "logid": "log-31"})]
        result = self.call({"action": "generate", "prompt": "chest"})
        self.assertTrue(result["isError"])
        self.assertIn("Coding Plan", self.text(result))
        self.assertIn("code 3101", self.text(result))
        self.assertIn("log-31", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [(403, {"code": 3706, "msg": "no zai account", "logid": "log-36"})]
        result = self.call({"action": "generate", "prompt": "chest"})
        self.assertTrue(result["isError"])
        self.assertIn("手机号", self.text(result))
        self.assertIn("log-36", self.text(result))

        for reply in [(403, "<html>forbidden</html>"), (403, None)]:
            with self.subTest(reply=reply):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [reply]
                result = self.call({"action": "generate", "prompt": "chest"})
                self.assertTrue(result["isError"])
                self.assertIn("没有使用 3D 建模的权限", self.text(result))
                self.assertNotIn("Coding Plan", self.text(result))

    def test_missing_coding_plan_fails_before_any_request(self):
        result = self.call({"action": "generate", "prompt": "chest"}, auth={"ok": False, "reason": "official_auth_plan_required"})
        self.assert_failed_without_requests(result, "Coding Plan")

    def test_redirect_is_refused(self):
        FakeZCode.script[SUBMIT] = [(302, None)]
        result = self.call({"action": "generate", "prompt": "chest"})
        self.assertTrue(result["isError"])
        self.assertIn("重定向", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    def test_non_https_remote_origin_is_refused(self):
        result = self.call({"action": "generate", "prompt": "chest"}, base_url="http://zcode.example")
        self.assert_failed_without_requests(result, "https")

    # ── animation library ──

    def test_animation_library_lists_and_truncates(self):
        animations = [{"id": f"human_{i:06d}", "name": f"Walk {i}", "category": "human"} for i in range(250)]
        FakeZCode.script[SUBMIT] = [
            (500, {"code": 2007, "msg": "blip"}),
            ok({"state": "SUCCEEDED", "output": {"task_id": "lib:0f1e2d", "animations": animations}}),
        ]

        result = self.call({"category": "Human"}, tool="list_hyper3d_animations")

        self.assertNotIn("isError", result, self.text(result))
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 2)
        self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)
        self.assertEqual(json.loads(submits[0]["body"]), {"action": "animation_library", "category": "human"})
        self.assertEqual(submits[0]["headers"]["x-usage-scenario"], SCENARIO)
        self.assertEqual(self.requests_to(QUERY), [])
        lines = self.text(result).splitlines()
        self.assertEqual(len([line for line in lines if line.startswith("human_")]), 200)
        self.assertIn("human_000199  Walk 199  [human]", lines)
        self.assertNotIn("human_000200", self.text(result))
        self.assertIn("还有 50 个，请用 category/search 缩小范围", self.text(result))
        self.assertEqual(result["structuredContent"]["total"], 250)
        self.assertEqual(result["structuredContent"]["animations"], animations)
        self.assertFalse((self.data_dir / "pending").exists())

    def test_animation_library_replay_without_output_asks_again_with_a_fresh_key(self):
        animations = [{"id": "human_000002", "name": "Walk", "category": "human"}]
        FakeZCode.script[SUBMIT] = [
            (500, {"code": 2007, "msg": "timeout"}),
            ok({"state": "SUCCEEDED", "replayed": True, "upstream_req_id": "lib:0f1e2d"}),
            ok({"state": "SUCCEEDED", "output": {"task_id": "lib:0f1e2d", "animations": animations}}),
        ]
        result = self.call({"category": "human"}, tool="list_hyper3d_animations")

        self.assertNotIn("isError", result, self.text(result))
        keys = [r["headers"]["idempotency-key"] for r in self.requests_to(SUBMIT)]
        self.assertEqual(len(keys), 3)
        self.assertEqual(keys[0], keys[1])
        self.assertNotEqual(keys[1], keys[2])
        self.assertEqual(result["structuredContent"]["animations"], animations)
        self.assertEqual(self.requests_to(QUERY), [])
        self.assertFalse((self.data_dir / "pending").exists())

    def test_animation_library_reads_top_level_list_and_filters_locally(self):
        FakeZCode.script[SUBMIT] = [
            ok({"state": "SUCCEEDED", "animations": [{"id": "a1", "name": "Run fast"}, {"id": "a2", "name": "Idle"}, "a3_run"]})
        ]
        result = self.call({"search": "RUN"}, tool="list_hyper3d_animations")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(json.loads(self.requests_to(SUBMIT)[0]["body"]), {"action": "animation_library"})
        self.assertIn("a1  Run fast", self.text(result))
        self.assertIn("a3_run", self.text(result))
        self.assertNotIn("Idle", self.text(result))
        self.assertEqual(result["structuredContent"]["total"], 2)

    def test_animation_library_rejects_unknown_category_locally(self):
        self.assert_failed_without_requests(self.call({"category": "robot"}, tool="list_hyper3d_animations"), "category")

    # ── shared behaviours (kept in step with the meshy-3d and hi3d-3d tests) ──

    def test_missing_route_names_the_3d_endpoint(self):
        result = self.call({"action": "generate", "prompt": "chest"})
        self.assertTrue(result["isError"])
        self.assertIn("3D 接口未在 ZCode 服务端开放", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    # A reply that the server accepted the key (the task may exist) and one that never reached a verdict.
    ACCEPTED = ok({"state": "UNKNOWN"})
    NOT_ACCEPTED = (500, {"code": 2007, "msg": "upstream timeout"})

    def unconfirmed_key(self, arguments=None, first=None):
        """Leave one unconfirmed submission behind and return its request_id."""
        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [first or self.ACCEPTED]
        self.assertTrue(self.call(arguments or {"action": "generate", "prompt": "chest"})["isError"])
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

        result = self.call({"action": "generate", "prompt": "chest", "request_id": key})

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
        result = self.call({"action": "generate", "prompt": "chest", "request_id": key})
        self.assertTrue(result["isError"])
        self.assertIn(f"request_id：{key}", self.text(result))
        self.assertEqual(self.pending_record(key)["createdAt"], created)

        # Once createdAt is more than 24 hours old the record is gone, however often it was rewritten.
        self.set_created_at(key, created - 2 * 60 * 60 * 1000)
        FakeZCode.requests = []
        result = self.call({"action": "generate", "prompt": "chest", "request_id": key})
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
                FakeZCode.script[SUBMIT] = [(200, {"code": code, "msg": "TASK_NOT_READY", "logid": f"log-{code}"})]
                result = self.call({"action": "generate", "prompt": "chest", "request_id": key})

                self.assertTrue(result["isError"])
                text = self.text(result)
                self.assertTrue(text.startswith(f"提交失败：{self.expected_code_text(code)}"), text)
                self.assertIn(f"log-{code}", text)
                self.assertIn(f"request_id {key} 没有创建任务，不要再用这个 request_id 重放", text)
                self.assertIn("不带 request_id 重新提交", text)
                self.assertIn("get_hyper3d_task 等前一步完成", text)
                # Not the "unconfirmed, replay with request_id" message.
                self.assertNotIn("提交未确认", text)
                self.assertNotIn("带上 request_id", text)
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)
                self.assertFalse((self.data_dir / "pending" / f"{key}.json").exists())

                # The dropped request_id cannot be replayed again.
                FakeZCode.requests = []
                result = self.call({"action": "generate", "prompt": "chest", "request_id": key})
                self.assertIn("找不到", self.text(result))
                self.assertEqual(FakeZCode.requests, [])

    def test_definite_rejection_after_an_uncertain_attempt_in_the_same_call(self):
        FakeZCode.script[SUBMIT] = [
            self.NOT_ACCEPTED,
            (200, {"code": 3703, "msg": "HYPER3D_IMAGE_CONTENT_VIOLATION", "logid": "log-r"}),
        ]
        result = self.call({"action": "rig", "task_id": TASK_ID, "animations": ["human_000002"]})

        self.assertTrue(result["isError"])
        text = self.text(result)
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        self.assertEqual(len(self.requests_to(SUBMIT)), 2)
        self.assertEqual({r["headers"]["idempotency-key"] for r in self.requests_to(SUBMIT)}, {key})
        self.assertIn("log-r", text)
        self.assertIn("HYPER3D_IMAGE_CONTENT_VIOLATION", text)
        self.assertIn(f"request_id {key} 没有创建任务", text)
        self.assertNotIn("提交未确认", text)
        self.assertFalse((self.data_dir / "pending").exists() and any((self.data_dir / "pending").iterdir()))

    def test_rejection_of_a_key_the_server_accepted_keeps_the_request_id_and_the_record(self):
        # Once the server accepted the key (UNKNOWN / CALLING / 3702 / an unreadable or oversized 2xx), a later 3703 or
        # 3707 (upstream rate limit, expired image link, ...) does not prove that the first attempt created no task.
        rejection = (200, {"code": 3703, "msg": "HYPER3D_RATE_LIMITED", "logid": "log-rl"})
        for first in [self.ACCEPTED, ok({"state": "CALLING"}), (200, {"code": 3702, "msg": "in flight"}), (200, TRUNCATED), (200, Big(2 * MIB))]:
            with self.subTest(first="oversized" if isinstance(first[1], Big) else first):
                # In the same call.
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [first, rejection]
                result = self.call({"action": "generate", "prompt": "chest"})
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
                result = self.call({**{"action": "generate", "prompt": "chest"}, "request_id": key})
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
        result = self.call({**{"action": "generate", "prompt": "chest"}, "request_id": key})
        self.assertIn(f"带上 request_id：{key}", self.text(result))
        self.assertIs(self.pending_record(key)["accepted"], True)

    def test_replay_that_ends_after_the_record_expired_does_not_renew_it(self):
        # The record is still fresh when the replay starts, but the slow submit only ends after its 24 hours:
        # it must not be rewritten with a new createdAt, and the Agent must not be promised another replay.
        key = self.unconfirmed_key()
        self.set_created_at(key, int((time.time() - 24 * 60 * 60 + 2) * 1000))
        FakeZCode.script[SUBMIT] = [(500, {"code": 2007, "msg": "upstream timeout"}, 3), self.NOT_ACCEPTED]
        result = self.call({**{"action": "generate", "prompt": "chest"}, "request_id": key})

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
                result = self.call({"action": "generate", "prompt": "chest", "request_id": key})

                self.assertTrue(result["isError"])
                text = self.text(result)
                self.assertIn("提交未确认", text)
                self.assertIn(f"带上 request_id：{key}", text)
                self.assertNotIn("没有创建任务，不要再用", text)
                self.assertEqual(self.pending_record(key)["createdAt"], created)
                self.assertEqual({r["headers"]["idempotency-key"] for r in self.requests_to(SUBMIT)}, {key})

    def test_replay_note_survives_an_error(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        self.assertTrue(self.call({"action": "generate", "prompt": "chest"})["isError"])
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]

        result = self.call({"action": "generate", "prompt": "barrel", "request_id": key})

        self.assertTrue(result["isError"])
        self.assertIn("本次修改的 prompt 没有生效", self.text(result))
        self.assertIn(key, self.text(result))

    def test_failed_upload_does_not_submit(self):
        (self.project / "ref.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [(400, {"code": 3707, "msg": "bad type", "logid": "log-up"})]
        result = self.call({"action": "generate", "images": ["ref.png"]})
        self.assertTrue(result["isError"])
        self.assertIn("log-up", self.text(result))
        self.assertIn("没有提交任务", self.text(result))
        self.assertEqual(self.requests_to(SUBMIT), [])

    def test_two_tasks_in_the_same_second_get_separate_default_folders(self):
        for _ in range(2):
            FakeZCode.script[QUERY] = [self.finished()]
            result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")
            self.assertNotIn("isError", result, self.text(result))
        folders = sorted((self.project / "generated-3d").iterdir())
        self.assertEqual(len(folders), 2)
        for folder in folders:
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ["base_basic_pbr.glb", "preview.webp"])

    # ── review fixes: unknown arguments (CR-02) ──

    def test_unknown_or_misspelled_arguments_are_refused_before_auth_and_requests(self):
        cases = [
            ("submit_hyper3d_task", {"action": "rig", "task_id": TASK_ID, "bone_templat": "human"}, ["bone_templat"]),
            ("submit_hyper3d_task", {"action": "generate", "prompt": "chest", "seed": 7}, ["seed"]),
            ("submit_hyper3d_task", {"action": "generate", "prompt": "x", "unknown_field": "dropped", "requestid": "k"}, ["unknown_field", "requestid"]),
            ("submit_hyper3d_task", {"action": "generate", "prompt": "x", "_meta": {}}, ["_meta"]),
            ("get_hyper3d_task", {"task_id": TASK_ID, "format": "fbx"}, ["format"]),
            ("list_hyper3d_animations", {"query": "walk"}, ["query"]),
        ]
        for tool, arguments, unknown in cases:
            for auth in (None, {"ok": False, "reason": "official_auth_unavailable"}):
                with self.subTest(tool=tool, unknown=unknown, signed_in=auth is None):
                    FakeZCode.requests = []
                    result = self.call(arguments, tool=tool, auth=auth)
                    self.assertTrue(result.get("isError"), self.text(result))
                    text = self.text(result)
                    self.assertIn(f"不支持的参数：{'、'.join(unknown)}", text)
                    # The accepted names come from this tool's own schema, so the Agent can fix the spelling.
                    accepted = next(t for t in self.tools if t["name"] == tool)["inputSchema"]["properties"]
                    self.assertIn("可用的参数：" + "、".join(accepted), text)
                    self.assertNotIn("登录", text)
                    self.assertEqual(FakeZCode.requests, [])

    def test_non_object_arguments_are_refused(self):
        for arguments in (["generate"], "generate", 5):
            with self.subTest(arguments=arguments):
                FakeZCode.requests = []
                result = self.call(arguments)
                self.assertTrue(result["isError"])
                self.assertIn("参数必须是对象", self.text(result))
                self.assertEqual(FakeZCode.requests, [])

    def test_host_meta_is_not_an_argument(self):
        # Identity arrives in params._meta next to the arguments; it must not be mistaken for an unknown argument.
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")
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
                result = self.call({"action": "generate", "prompt": "chest"}, auth=auth)
                self.assertTrue(result["isError"])
                self.assertIn(reason, self.text(result))
                self.assertNotIn("request_id", self.text(result))
                self.assertEqual(FakeZCode.requests, [])

    # ── review fixes: download redirects (CR-01) ──

    def cdn(self, path):
        return f"{self.origin}/files/{path}"

    def assert_clean_downloads(self):
        self.assertTrue(self.downloads())
        for download in self.downloads():
            for header in IDENTITY_HEADERS:
                self.assertNotIn(header, download["headers"], f"{header} leaked to {download['path']}")

    def redirect_case(self, location, hop="hop/model.glb"):
        FakeZCode.redirects = {f"/files/{hop}": location}
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished(files=[{"name": "model.glb", "url": self.cdn(hop)}])]
        shutil.rmtree(self.project / "out", ignore_errors=True)
        return self.call({"task_id": TASK_ID, "output_dir": "out"}, tool="get_hyper3d_task")

    def test_download_redirects_are_checked_hop_by_hop(self):
        port = self.httpd.server_address[1]
        refused = [
            "http://10.0.0.1/admin/model.glb",  # intranet, plain http
            "http://cdn.example/model.glb",  # remote, plain http
            f"http://0.0.0.0:{port}/files/a/model.glb",  # reaches this machine but is not an allowed loopback name
            f"http://127.0.0.2:{port}/files/a/model.glb",
            with_userinfo(f"http://127.0.0.1:{port}/files/a/model.glb"),  # credentials are never allowed
            "file:///etc/hosts",
            "ftp://cdn.example/model.glb",
            "http://[::1",  # unparsable Location
        ]
        for location in refused:
            with self.subTest(location=location):
                result = self.redirect_case(location)
                self.assertNotIn("isError", result, self.text(result))
                (entry,) = result["structuredContent"]["files"]
                self.assertIsNone(entry["path"])
                self.assertEqual(entry["url"], self.cdn("hop/model.glb"))
                text = self.text(result)
                self.assertIn(f"跳转到了不允许的位置，未下载）：{self.cdn('hop/model.glb')}", text)
                # The refused hop is never requested: only the first product URL reached the server.
                self.assertEqual([d["path"].split("?")[0] for d in self.downloads()], ["/files/hop/model.glb"])
                self.assertFalse((self.project / "out").exists() and any((self.project / "out").iterdir()))

    def test_redirect_loop_and_overlong_chains_are_not_followed(self):
        result = self.redirect_case("/files/hop/model.glb")
        self.assertNotIn("isError", result, self.text(result))
        self.assertIsNone(result["structuredContent"]["files"][0]["path"])
        self.assertIn("跳转次数过多，未下载", self.text(result))
        self.assertIn(self.cdn("hop/model.glb"), self.text(result))
        # The first request plus at most five followed hops.
        self.assertEqual(len(self.downloads()), 6)

        # A chain of exactly five hops is still followed.
        FakeZCode.redirects = {f"/files/h{i}/model.glb": f"/files/h{i + 1}/model.glb" for i in range(4)}
        FakeZCode.redirects["/files/h4/model.glb"] = "/files/final/model.glb"
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished(files=[{"name": "model.glb", "url": self.cdn("h0/model.glb")}])]
        result = self.call({"task_id": TASK_ID, "output_dir": "chain"}, tool="get_hyper3d_task")
        self.assertEqual(Path(result["structuredContent"]["files"][0]["path"]).read_bytes(), GLB)
        self.assertEqual(len(self.downloads()), 6)

    def test_allowed_redirects_still_download_without_identity(self):
        port = self.httpd.server_address[1]
        # Relative and absolute hops to an allowed location (https in production; the loopback test CDN here).
        for location in ("/files/final/model.glb", f"http://127.0.0.1:{port}/files/final/model.glb?sig=2"):
            with self.subTest(location=location):
                result = self.redirect_case(location)
                self.assertNotIn("isError", result, self.text(result))
                (entry,) = result["structuredContent"]["files"]
                self.assertEqual(Path(entry["path"]).read_bytes(), GLB)
                self.assertEqual([d["path"].split("?")[0] for d in self.downloads()], ["/files/hop/model.glb", "/files/final/model.glb"])
                self.assert_clean_downloads()

    def test_redirect_to_a_missing_file_keeps_the_http_status(self):
        result = self.redirect_case("/files/missing/model.glb")
        self.assertNotIn("isError", result, self.text(result))
        self.assertIsNone(result["structuredContent"]["files"][0]["path"])
        self.assertIn("HTTP 404", self.text(result))

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
        public = ["https://cdn.vendor.example/x/model.glb", "https://8.8.8.8/model.glb", "https://[2606:4700::1]/model.glb",
                  "https://[::ffff:8.8.8.8]/model.glb", "https://100.128.0.1/model.glb"]
        loopback = ["http://127.0.0.1:9/model.glb", "https://127.0.0.1/model.glb", "http://localhost:9/model.glb",
                    "http://[::1]:9/model.glb", "http://2130706433:9/model.glb"]
        private = ["https://10.0.0.1/model.glb", "https://172.16.0.1/model.glb", "https://192.168.1.1/model.glb",
                   "https://169.254.169.254/latest/meta-data", "https://100.64.0.1/model.glb", "https://0.0.0.0/model.glb",
                   "https://224.0.0.1/model.glb", "https://[fd00::1]/model.glb", "https://[fe80::1]/model.glb",
                   "https://[ff02::1]/model.glb", "https://[::]/model.glb", "https://[::ffff:127.0.0.1]/model.glb",
                   "https://[::ffff:10.0.0.1]/model.glb", "https://[64:ff9b::10.0.0.1]/model.glb",
                   "https://0x7f.1/model.glb", "https://0177.0.0.1/model.glb", "https://167772161/model.glb",
                   "https://localhost./model.glb", "https://api.localhost/model.glb", "https://127.1.2.3/model.glb"]
        never = ["http://cdn.example/model.glb", "http://10.0.0.1/model.glb", with_userinfo("https://cdn.example/model.glb"),
                 "file:///etc/hosts", "ftp://cdn.example/model.glb", "not a url"]
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
            ("https://cdn.vendor.example/x/model.glb", "https://cdn.example/y/model.glb", True),
            ("https://cdn.example/a/model.glb", "https://cdn.example/b/model.glb", True),
            ("https://cdn.vendor.example/x/model.glb", "https://10.0.0.1/model.glb", False),
            ("https://cdn.vendor.example/x/model.glb", "https://[::ffff:7f00:1]/model.glb", False),
            ("https://cdn.vendor.example/x/model.glb", "http://127.0.0.1:9/model.glb", False),
            ("http://127.0.0.1:9/a/model.glb", "http://127.0.0.1:9/b/model.glb", False),
            ("http://127.0.0.1:9/a/model.glb", "https://cdn.example/b/model.glb", False),
            ("https://127.0.0.1/a/model.glb", "https://127.0.0.1/b/model.glb", False),
            ("https://10.0.0.5/a/model.glb", "https://10.0.0.5/b/model.glb", False),
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
        strict = {"HYPER3D_3D_TEST_API_ORIGIN": "https://zcode.example"}
        for url in (self.cdn("first/model.glb"), f"https://127.0.0.1:{port}/files/first/model.glb",
                    "https://10.0.0.1/files/first/model.glb", "https://169.254.169.254/latest/meta-data/model.glb",
                    f"https://[::ffff:127.0.0.1]:{port}/files/first/model.glb", f"http://localhost:{port}/files/first/model.glb"):
            with self.subTest(url=url):
                FakeZCode.requests = []
                FakeZCode.script[QUERY] = [self.finished(files=[{"name": "model.glb", "url": url}])]
                shutil.rmtree(self.project / "out", ignore_errors=True)
                result = self.call({"task_id": TASK_ID, "output_dir": "out"}, tool="get_hyper3d_task", **strict)
                self.assertNotIn("isError", result, self.text(result))
                (entry,) = result["structuredContent"]["files"]
                self.assertIsNone(entry["path"])
                self.assertEqual(entry["url"], url)
                self.assertIn(f"链接不是 https，或指向本机、内网地址，未下载）：{url}", self.text(result))
                # No request reached the product link.
                self.assertEqual(self.downloads(), [])
                self.assertFalse((self.project / "out").exists() and any((self.project / "out").iterdir()))

        # A loopback value of the hook is ignored: the loopback API origin keeps development downloads working.
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished(files=[{"name": "model.glb", "url": self.cdn("first/model.glb")}])]
        result = self.call({"task_id": TASK_ID, "output_dir": "dev"}, tool="get_hyper3d_task",
                           HYPER3D_3D_TEST_API_ORIGIN=f"http://localhost:{port}")
        (entry,) = result["structuredContent"]["files"]
        self.assertEqual(Path(entry["path"]).read_bytes(), GLB, self.text(result))
        self.assertEqual([d["path"].split("?")[0] for d in self.downloads()], ["/files/first/model.glb"])
        self.assert_clean_downloads()

    def test_remote_https_links_cannot_redirect_into_this_machine(self):
        tls_env = self.tls()
        port = self.httpd.server_address[1]
        tls_port = self.httpsd.server_address[1]
        start = f"{self.tls_origin}/files/hop/model.glb"
        refused = [
            f"http://127.0.0.1:{port}/files/final/model.glb",  # CR-01: a local plain-http service
            f"http://localhost:{port}/files/final/model.glb",
            f"https://localhost:{tls_port}/files/final/model.glb",  # another origin on this machine
            "https://10.0.0.5/files/final/model.glb",
            "https://169.254.169.254/latest/meta-data/model.glb",
        ]
        for location in refused:
            with self.subTest(location=location):
                FakeZCode.redirects = {"/files/hop/model.glb": location}
                FakeZCode.requests = []
                FakeZCode.script[QUERY] = [self.finished(files=[{"name": "model.glb", "url": start}])]
                shutil.rmtree(self.project / "out", ignore_errors=True)
                result = self.call({"task_id": TASK_ID, "output_dir": "out"}, tool="get_hyper3d_task", **tls_env)
                self.assertNotIn("isError", result, self.text(result))
                (entry,) = result["structuredContent"]["files"]
                self.assertIsNone(entry["path"])
                self.assertEqual(entry["url"], start)
                self.assertIn(f"跳转到了不允许的位置，未下载）：{start}", self.text(result))
                # The https link was fetched; the hop was never requested.
                self.assertEqual([d["path"] for d in self.downloads()], ["/files/hop/model.glb"])
                self.assertFalse((self.project / "out").exists() and any((self.project / "out").iterdir()))

        # A same-origin hop on the https link is still followed (and proves the test certificate is trusted).
        FakeZCode.redirects = {"/files/hop/model.glb": "/files/final/model.glb"}
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished(files=[{"name": "model.glb", "url": start}])]
        result = self.call({"task_id": TASK_ID, "output_dir": "same"}, tool="get_hyper3d_task", **tls_env)
        (entry,) = result["structuredContent"]["files"]
        self.assertEqual(Path(entry["path"]).read_bytes(), GLB, self.text(result))
        self.assertEqual([d["path"] for d in self.downloads()], ["/files/hop/model.glb", "/files/final/model.glb"])
        self.assert_clean_downloads()

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
            env["HYPER3D_3D_TEST_API_ORIGIN"] = "https://zcode.example"
        if dns_hook is not None:
            env["HYPER3D_3D_TEST_DNS"] = json.dumps(dns_hook)

        def read_log():
            return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]

        return env, read_log

    def download_via(self, url, env, output_dir="out"):
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished(files=[{"name": "model.glb", "url": url}])]
        shutil.rmtree(self.project / output_dir, ignore_errors=True)
        result = self.call({"task_id": TASK_ID, "output_dir": output_dir}, tool="get_hyper3d_task", **env)
        self.assertNotIn("isError", result, self.text(result))
        return result

    def assert_refused(self, result, url, warning, output_dir="out"):
        (entry,) = result["structuredContent"]["files"]
        self.assertIsNone(entry["path"])
        self.assertEqual(entry["url"], url)
        self.assertIn(f"{warning}）：{url}", self.text(result))
        self.assertFalse((self.project / output_dir).exists() and any((self.project / output_dir).iterdir()))

    def test_product_hosts_that_resolve_to_private_addresses_are_refused_before_connecting(self):
        url = "https://cdn.hyper3d.test/a/model.glb"
        hop = "https://cdn-hop.hyper3d.test/b/model.glb"
        start = "https://8.8.8.8/a/model.glb"
        public = ["93.184.216.34", "2606:2800:220:1::248"]
        for address in ("10.0.0.1", "127.0.0.1", "::ffff:10.0.0.1", "169.254.169.254", "fd00::1", "::1", "not-an-ip"):
            # The resolver says public; the test map adds a private address, and any private address refuses the URL.
            with self.subTest(first_url_mapped_to=address):
                env, read_log = self.fake_net(answers={"cdn.hyper3d.test": public}, dns_hook={"cdn.hyper3d.test": [address]})
                result = self.download_via(url, env)
                self.assert_refused(result, url, "链接的域名解析到本机或内网地址，未下载")
                self.assertEqual([e for e in read_log() if "fetch" in e], [])
                self.assertEqual(self.downloads(), [])
            with self.subTest(hop_mapped_to=address):
                env, read_log = self.fake_net(
                    routes={start: {"location": hop}}, answers={"cdn-hop.hyper3d.test": public},
                    dns_hook={"CDN-Hop.hyper3d.test.": address},  # host names are compared case-insensitively, without the final dot
                )
                result = self.download_via(start, env)
                self.assert_refused(result, start, "跳转目标的域名解析到本机或内网地址，未下载")
                # Only the first (public literal) URL was requested; the hop never was.
                self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], [start])
                self.assertEqual(self.downloads(), [])

        # The resolver itself returning any private address (even next to a public one) refuses too, as first URL and as hop.
        for answer in (["10.1.2.3"], ["93.184.216.34", "192.168.0.7"], ["::ffff:127.0.0.1"], ["64:ff9b::a00:1"]):
            with self.subTest(resolved=answer):
                env, read_log = self.fake_net(routes={start: {"location": hop}}, answers={"cdn.hyper3d.test": answer, "cdn-hop.hyper3d.test": answer})
                self.assert_refused(self.download_via(url, env), url, "链接的域名解析到本机或内网地址，未下载")
                self.assert_refused(self.download_via(start, env), start, "跳转目标的域名解析到本机或内网地址，未下载")
                self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], [start])
                lookups = [e for e in read_log() if "lookup" in e]
                self.assertEqual([e["lookup"] for e in lookups], ["cdn.hyper3d.test", "cdn-hop.hyper3d.test"])
                self.assertTrue(all(e["options"] == {"all": True, "verbatim": True} for e in lookups))

    def test_product_hosts_that_resolve_publicly_are_downloaded_hop_by_hop(self):
        url = "https://cdn.hyper3d.test/a/model.glb"
        hop = "https://cdn-hop.hyper3d.test/b/model.glb"
        env, read_log = self.fake_net(
            routes={url: {"location": hop}},
            answers={"cdn.hyper3d.test": ["93.184.216.34"], "cdn-hop.hyper3d.test": ["2606:2800:220:1::248", "8.8.8.8"]},
            dns_hook={"cdn.hyper3d.test": ["1.1.1.1"]},  # a public address in the test map changes nothing
        )
        result = self.download_via(url, env)
        (entry,) = result["structuredContent"]["files"]
        self.assertEqual(Path(entry["path"]).read_bytes(), b"glTF-fake-model", self.text(result))
        events = read_log()
        self.assertEqual([e.get("lookup") or e.get("fetch") for e in events], ["cdn.hyper3d.test", url, "cdn-hop.hyper3d.test", hop])
        for event in events:
            for header in IDENTITY_HEADERS:
                self.assertNotIn(header, event.get("headers", {}))

    def test_fake_ip_proxy_answers_are_downloaded_but_fake_ip_literals_are_not(self):
        # Clash / mihomo / Surge in TUN or fake-ip mode answer every name with 198.18.0.0/15 (and mihomo's
        # fdfe:dcba:9876::/64 for IPv6); refusing those would stop every download on such machines.
        url = "https://cdn.hyper3d.test/a/model.glb"
        hop = "https://cdn-hop.hyper3d.test/b/model.glb"
        for answer in (["198.18.0.5"], ["198.19.255.254"], ["198.18.0.23", "fdfe:dcba:9876::17"], ["FDFE:DCBA:9876:0:ffff::1"]):
            with self.subTest(resolved=answer):
                env, read_log = self.fake_net(routes={url: {"location": hop}}, answers={"cdn.hyper3d.test": answer, "cdn-hop.hyper3d.test": answer})
                result = self.download_via(url, env)
                (entry,) = result["structuredContent"]["files"]
                self.assertEqual(Path(entry["path"]).read_bytes(), b"glTF-fake-model", self.text(result))
                self.assertEqual([e.get("lookup") or e.get("fetch") for e in read_log()], ["cdn.hyper3d.test", url, "cdn-hop.hyper3d.test", hop])
        # The test map is a resolver answer too: a fake-ip address there does not refuse, and does not hide a private one.
        env, read_log = self.fake_net(answers={"cdn.hyper3d.test": ["93.184.216.34"]}, dns_hook={"cdn.hyper3d.test": ["198.18.0.5"]})
        self.assertIsNotNone(self.download_via(url, env)["structuredContent"]["files"][0]["path"])
        # Next to a private address, or just outside the fake-ip ranges, the name is still refused before connecting.
        for answer in (["198.18.0.5", "10.0.0.1"], ["fdfe:dcba:9876::17", "fd00::1"], ["fdfe:dcba:9876:1::1"], ["fdfe:dcba:9877::1"],
                       ["::ffff:198.18.0.5"]):
            with self.subTest(resolved=answer):
                env, read_log = self.fake_net(answers={"cdn.hyper3d.test": answer})
                self.assert_refused(self.download_via(url, env), url, "链接的域名解析到本机或内网地址，未下载")
                self.assertEqual([e for e in read_log() if "fetch" in e], [])
        # Written as literals in the link (first URL or hop), the fake-ip ranges are refused as before.
        start = "https://8.8.8.8/a/model.glb"
        for literal in ("https://198.18.0.5/model.glb", "https://[fdfe:dcba:9876::17]/model.glb"):
            with self.subTest(literal=literal):
                env, read_log = self.fake_net(routes={start: {"location": literal}})
                self.assert_refused(self.download_via(literal, env), literal, "链接不是 https，或指向本机、内网地址，未下载")
                self.assert_refused(self.download_via(start, env), start, "跳转到了不允许的位置，未下载")
                self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], [start])
                self.assertEqual([e for e in read_log() if "lookup" in e], [])

    def test_test_dns_map_can_only_make_the_check_stricter(self):
        # A public address in the map never lets a private literal, a private name, or an unresolvable name through.
        cases = [
            ("https://10.0.0.1/model.glb", {"10.0.0.1": ["8.8.8.8"]}, "链接不是 https，或指向本机、内网地址，未下载"),
            ("https://[::ffff:10.0.0.1]/model.glb", {"::ffff:10.0.0.1": ["8.8.8.8"], "[::ffff:a00:1]": ["8.8.8.8"]},
             "链接不是 https，或指向本机、内网地址，未下载"),
            ("https://localhost/model.glb", {"localhost": ["8.8.8.8"]}, "链接不是 https，或指向本机、内网地址，未下载"),
            ("https://nowhere.hyper3d.test/model.glb", {"nowhere.hyper3d.test": ["8.8.8.8"]}, "链接的域名无法解析，未下载"),
            ("https://inside.hyper3d.test/model.glb", {"inside.hyper3d.test": ["8.8.8.8"]}, "链接的域名解析到本机或内网地址，未下载"),
        ]
        for url, hook, warning in cases:
            with self.subTest(url=url):
                env, read_log = self.fake_net(answers={"inside.hyper3d.test": ["10.9.9.9"]}, dns_hook=hook)
                self.assert_refused(self.download_via(url, env), url, warning)
                self.assertEqual([e for e in read_log() if "fetch" in e], [])
        # Malformed hook values are ignored rather than loosening anything.
        for hook in ("not json", "[1, 2]", '"8.8.8.8"'):
            with self.subTest(hook=hook):
                env, read_log = self.fake_net(answers={"inside.hyper3d.test": ["10.9.9.9"]})
                env["HYPER3D_3D_TEST_DNS"] = hook
                url = "https://inside.hyper3d.test/model.glb"
                self.assert_refused(self.download_via(url, env), url, "链接的域名解析到本机或内网地址，未下载")

    def test_unresolvable_product_hosts_are_refused_and_literals_are_not_looked_up(self):
        url = "https://gone.hyper3d.test/model.glb"
        start = "https://8.8.8.8/a/model.glb"
        env, read_log = self.fake_net(routes={start: {"location": url}})
        self.assert_refused(self.download_via(url, env), url, "链接的域名无法解析，未下载")
        self.assert_refused(self.download_via(start, env), start, "跳转目标的域名无法解析，未下载")
        self.assertEqual([e.get("lookup") or e.get("fetch") for e in read_log()], [url.split("/")[2], start, url.split("/")[2]])

        # IP literals were already judged by downloadableUrl / redirectAllowed: they are fetched without a lookup.
        final = "https://[2606:4700::1]/b/model.glb"
        env, read_log = self.fake_net(routes={start: {"location": final}})
        result = self.download_via(start, env)
        self.assertEqual(Path(result["structuredContent"]["files"][0]["path"]).read_bytes(), b"glTF-fake-model", self.text(result))
        self.assertEqual(read_log(), [{"fetch": start, "headers": {}}, {"fetch": final, "headers": {}}])

    def test_loopback_mode_does_not_look_up_product_hosts(self):
        # Development mode keeps today's rules: no lookup happens, so even a map that says "private" changes nothing.
        env, read_log = self.fake_net(strict=False, dns_hook={"localhost": ["10.0.0.1"], "127.0.0.1": ["10.0.0.1"], "cdn.hyper3d.test": ["10.0.0.1"]})
        for url in (self.cdn("dev/model.glb"), "https://cdn.hyper3d.test/dev/model.glb"):
            with self.subTest(url=url):
                result = self.download_via(url, env)
                (entry,) = result["structuredContent"]["files"]
                self.assertIsNotNone(entry["path"], self.text(result))
        self.assertEqual([e for e in read_log() if "lookup" in e], [])
        self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], ["https://cdn.hyper3d.test/dev/model.glb"])

    def test_a_hanging_lookup_respects_the_call_budget_and_cancellation(self):
        url = "https://slow.hyper3d.test/model.glb"
        env, read_log = self.fake_net(answers={"slow.hyper3d.test": "hang"})
        started = time.monotonic()
        result = self.download_via(url, {**env, "HYPER3D_3D_CALL_BUDGET_MS": "2500"})
        self.assertLess(time.monotonic() - started, 20)
        self.assert_refused(result, url, "下载失败（网络错误或超时）")
        self.assertEqual([e for e in read_log() if "fetch" in e], [])

        env, read_log = self.fake_net(answers={"slow.hyper3d.test": "hang"})
        FakeZCode.script[QUERY] = [self.finished(files=[{"name": "model.glb", "url": url}])]
        proc = self.start_server(**env)
        proc.stdin.write(json.dumps(self.tool_call("get_hyper3d_task", {"task_id": TASK_ID, "output_dir": "out"})) + "\n")
        proc.stdin.flush()
        self.wait_for(lambda: any("lookup" in e for e in read_log()))
        self.cancel_and_finish(proc)
        self.assertEqual([e for e in read_log() if "fetch" in e], [])

    def test_http_is_never_downloaded_or_followed_outside_loopback_mode(self):
        # 283 SG-02: the development-mode leniency for http links must never apply with a non-loopback API origin.
        http_urls = ["http://8.8.8.8/model.glb", "http://cdn.example/model.glb", "http://assets.hyper3d.ai/x/model.glb",
                     "http://127.0.0.1:9/model.glb", "http://localhost:9/model.glb", "http://[::1]:9/model.glb",
                     "http://10.0.0.1/model.glb", "http://[2606:4700::1]/model.glb"]
        targets = ["https://cdn.example/b/model.glb", "https://8.8.8.8/b/model.glb", "https://assets.hyper3d.ai/b/model.glb"]
        for api in ("https://zcode.example", "https://10.0.0.1", None):
            with self.subTest(api_origin=api):
                self.assertEqual(self.download_rules("downloadableUrl", [[url, api] for url in http_urls]), [False] * len(http_urls))
                hops = [[start, target, api] for start in http_urls for target in targets + http_urls]
                hops += [[start, start.replace("/model.glb", "/b/model.glb"), api] for start in http_urls]  # same origin
                hops += [[target, url, api] for target in targets for url in http_urls]  # https to http
                self.assertEqual(self.download_rules("redirectAllowed", hops), [False] * len(hops))
        # The same http hops in loopback mode are what development relies on; they must stay distinguishable.
        self.assertEqual(self.download_rules("redirectAllowed", [["http://127.0.0.1:9/a.glb", "https://cdn.example/b.glb", "http://127.0.0.1:9"]]), [True])

        # End to end: an http first URL is never requested, and an https link redirecting to http is not followed.
        start = "https://8.8.8.8/a/model.glb"
        env, read_log = self.fake_net(routes={start: {"location": "http://8.8.4.4/b/model.glb"}})
        for url in ("http://8.8.8.8/model.glb", "http://cdn.hyper3d.test/model.glb", self.cdn("prod/model.glb")):
            with self.subTest(url=url):
                self.assert_refused(self.download_via(url, env), url, "链接不是 https，或指向本机、内网地址，未下载")
                self.assertEqual(self.downloads(), [])
        self.assert_refused(self.download_via(start, env), start, "跳转到了不允许的位置，未下载")
        self.assertEqual([e.get("fetch") for e in read_log()], [start])
        self.assertEqual(self.downloads(), [])

    def test_product_file_names_are_kept_unless_unsafe(self):
        astral = "\U00020000"
        cases = [
            # Safe on macOS, Linux and Windows: kept byte for byte, so OBJ -> MTL -> texture references keep working.
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
        files = [
            {"name": "CON.glb", "url": self.cdn("x/CON.glb")},
            {"name": "a:b.fbx", "url": self.cdn("x/a.fbx")},
            {"name": "tex(1) model 0.obj", "url": self.cdn("x/model.obj")},
            {"url": self.cdn("x/material%200.mtl")},  # no name: taken from the link, decoded, kept as is
        ]
        FakeZCode.script[QUERY] = [self.finished(files=files)]
        result = self.call({"task_id": TASK_ID, "output_dir": "out"}, tool="get_hyper3d_task")
        self.assertNotIn("isError", result, self.text(result))
        structured = result["structuredContent"]
        self.assertEqual([Path(f["path"]).name for f in structured["files"]], ["_CON.glb", "a_b.fbx", "tex(1) model 0.obj", "material 0.mtl"])
        self.assertEqual(structured["renamed_files"], [
            {"key": "_CON.glb", "from": "CON.glb", "to": "_CON.glb"},
            {"key": "a_b.fbx", "from": "a:b.fbx", "to": "a_b.fbx"},
        ])
        self.assertIn("mtllib", structured["rename_warning"])
        text = self.text(result)
        self.assertIn("以下文件保存时改了名", text)
        self.assertIn('- "CON.glb" → "_CON.glb"', text)
        self.assertIn('- "a:b.fbx" → "a_b.fbx"', text)
        self.assertIn(structured["rename_warning"], text)
        self.assertNotIn('"tex(1) model 0.obj" →', text)
        self.assertNotIn('"material 0.mtl" →', text)

        # Nothing renamed: no warning at all.
        files = [{"name": "material 0.mtl", "url": self.cdn("y/a.mtl")}, {"name": "tex(1).png", "url": self.cdn("y/b.png")}]
        FakeZCode.script[QUERY] = [self.finished(files=files)]
        result = self.call({"task_id": TASK_ID, "output_dir": "clean"}, tool="get_hyper3d_task")
        self.assertEqual([Path(f["path"]).name for f in result["structuredContent"]["files"]], ["material 0.mtl", "tex(1).png"])
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
                result = self.call({"action": "generate", "prompt": "chest"})
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
        FakeZCode.script[SUBMIT] = [replayed()]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"action": "generate", "prompt": "chest", "request_id": key})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"], key)

    def test_oversized_query_upload_and_library_responses_are_clear_errors(self):
        FakeZCode.script[QUERY] = [(200, Big(2 * MIB))]
        result = self.call({"task_id": TASK_ID}, tool="get_hyper3d_task")
        self.assertTrue(result["isError"])
        self.assertIn("服务端响应过大（超过 1 MiB）", self.text(result))
        self.assertIn(TASK_ID, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 1)

        FakeZCode.requests = []
        (self.project / "front.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [(200, Big(2 * MIB, with_length=True))]
        result = self.call({"action": "generate", "images": ["front.png"]})
        self.assertTrue(result["isError"])
        self.assertIn("上传失败，没有提交任务：服务端响应过大", self.text(result))
        self.assertEqual(len(self.requests_to(UPLOAD)), 1)
        self.assertEqual(self.requests_to(SUBMIT), [])

        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [(200, Big(2 * MIB))]
        result = self.call({}, tool="list_hyper3d_animations")
        self.assertTrue(result["isError"])
        self.assertIn("服务端响应过大", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    def test_normal_responses_just_under_the_cap_are_still_read(self):
        animations = [{"id": f"human_{i:06d}", "name": "n" * 900, "category": "human"} for i in range(1000)]
        self.assertLess(len(json.dumps(animations)), MIB - 1024)
        FakeZCode.script[SUBMIT] = [ok({"state": "SUCCEEDED", "output": {"task_id": "lib:1", "animations": animations}})]
        result = self.call({}, tool="list_hyper3d_animations")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["total"], 1000)

    # ── review fixes: request_id replay snapshot (SG-04) ──

    def replay_note_fields(self, text):
        match = re.search(r"本次修改的 (\S+) 没有生效", text)
        return match.group(1).split("、") if match else []

    def test_request_id_replay_reports_every_changed_business_field(self):
        cases = [
            ({"action": "generate", "prompt": "chest"}, {"action": "generate", "prompt": "barrel"}, ["prompt"]),
            # Arrays, images and labels are compared with a stable serialisation.
            (
                {"action": "generate", "images": ["https://a.example/1.png", "https://a.example/2.png"], "image_labels": ["F", "B"]},
                {"action": "generate", "images": ["https://a.example/1.png", "https://a.example/3.png"], "image_labels": ["F", "B"]},
                ["images"],
            ),
            (
                {"action": "generate", "prompt": "chest", "quality": "low", "mesh_mode": "Quad"},
                {"action": "generate", "prompt": "chest", "quality": "high", "ta_pose": True},
                ["mesh_mode", "quality", "ta_pose"],
            ),
            # Texture inputs: the reference image and material.
            (
                {"action": "texture", "model_url": "https://a.example/m.glb", "image": "https://a.example/s.png", "material": "PBR"},
                {"action": "texture", "model_url": "https://a.example/m.glb", "image": "https://a.example/t.png", "material": "Shaded"},
                ["material", "image"],
            ),
            (
                {"action": "texture", "model_url": "https://a.example/m.glb", "image": "https://a.example/s.png"},
                {"action": "texture", "model_url": "https://a.example/n.glb", "image": "https://a.example/s.png", "prompt": "gold"},
                ["prompt", "model_url"],
            ),
            # output_dir is local only; reordered animations are a real change.
            (
                {"action": "rig", "task_id": TASK_ID, "animations": ["human_000001", "human_000002"]},
                {"action": "rig", "task_id": TASK_ID, "animations": ["human_000002", "human_000001"], "output_dir": "elsewhere"},
                ["animations"],
            ),
            (
                {"action": "rig", "task_id": TASK_ID, "bone_template": "human"},
                {"action": "rig", "task_id": TASK_ID, "in_place": True},
                ["bone_template", "in_place"],
            ),
            # polygen fields are fingerprinted like the others.
            (
                {"action": "polygen", "prompt": "stool", "face_count": 200, "mesh_mode": "NGon"},
                {"action": "polygen", "prompt": "stool", "face_count": "300", "mesh_mode": "NGon", "uhd_texture": True},
                ["face_count", "uhd_texture"],
            ),
            (
                {"action": "polygen", "model_url": "https://a.example/hero.glb"},
                {"action": "polygen", "model_url": "https://a.example/hero.glb", "transfer_texture": False},
                ["transfer_texture"],
            ),
            # Same values with whitespace or key order differences are not reported.
            ({"action": "generate", "prompt": "chest"}, {"action": "generate", "prompt": " chest ", "output_dir": "x"}, []),
        ]
        for original, changed, fields in cases:
            with self.subTest(fields=fields, original=original):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
                self.assertTrue(self.call(original)["isError"])
                first = self.requests_to(SUBMIT)[0]
                key = first["headers"]["idempotency-key"]

                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [replayed()]
                FakeZCode.script[QUERY] = [self.finished()]
                result = self.call({**changed, "request_id": key})

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(self.requests_to(SUBMIT)[0]["body"], first["body"])
                self.assertEqual(self.replay_note_fields(self.text(result)), fields)

    def test_replay_note_ignores_spellings_the_validators_treat_as_equal(self):
        cases = [
            (
                {"action": "Generate", "prompt": "chest", "mesh_mode": "quad", "quality": "HIGH", "format": "GLB", "material": "pbr"},
                {"action": "generate", "prompt": " chest", "mesh_mode": "Quad", "quality": "high", "format": "glb", "material": "PBR",
                 "images": [], "output_dir": "x"},
            ),
            (
                {"action": "generate", "images": ["HTTPS://A.Example/1.png"], "image_labels": ["f"]},
                {"action": "GENERATE", "images": ["https://a.example/1.png"], "image_labels": ["F"], "prompt": "  "},
            ),
            (
                {"action": "rig", "task_id": TASK_ID, "bone_template": "Human", "format": "FBX"},
                {"action": "rig", "task_id": f" {TASK_ID} ", "bone_template": "human", "format": "fbx", "animations": []},
            ),
            (
                {"action": "texture", "model_url": "https://A.example/m.glb", "image": "https://a.example/s.png", "material": "shaded"},
                {"action": "texture", "model_url": "https://a.example:443/m.glb", "image": "https://a.example/s.png", "material": "Shaded"},
            ),
            (
                {"action": "polygen", "task_id": TASK_ID, "face_count": "4000", "mesh_mode": "ngon", "format": "OBJ"},
                {"action": "Polygen", "task_id": TASK_ID, "face_count": 4000, "mesh_mode": "NGon", "format": "obj", "images": []},
            ),
        ]
        for original, same in cases:
            with self.subTest(original=original):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
                self.assertTrue(self.call(original)["isError"])
                key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]

                FakeZCode.script[SUBMIT] = [replayed()]
                FakeZCode.script[QUERY] = [self.finished()]
                result = self.call({**same, "request_id": key})
                self.assertNotIn("isError", result, self.text(result))
                self.assertNotIn("没有生效", self.text(result))

        # Hyper3D submits an explicit ta_pose false, so dropping it on the replay is a real change and is still reported.
        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        self.assertTrue(self.call({"action": "generate", "prompt": "chest", "ta_pose": False})["isError"])
        first = self.requests_to(SUBMIT)[0]
        self.assertEqual(json.loads(first["body"])["ta_pose"], False)
        FakeZCode.script[SUBMIT] = [replayed()]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"action": "generate", "prompt": "chest", "request_id": first["headers"]["idempotency-key"]})
        self.assertEqual(self.replay_note_fields(self.text(result)), ["ta_pose"])

    def test_replay_note_covers_local_images_and_survives_a_second_uncertain_round(self):
        (self.project / "front.png").write_bytes(PNG)
        (self.project / "other.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/u/1.png"})]
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        self.assertTrue(self.call({"action": "generate", "images": ["front.png"]})["isError"])
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]

        # Still unconfirmed on replay: the record keeps the first call's fingerprint.
        FakeZCode.requests = []
        result = self.call({"action": "generate", "images": ["front.png"], "request_id": key})
        self.assertTrue(result["isError"])
        self.assertNotIn("没有生效", self.text(result))

        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [replayed()]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"action": "generate", "images": ["other.png"], "ta_pose": True, "request_id": key})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(UPLOAD), [])
        self.assertEqual(self.replay_note_fields(self.text(result)), ["images", "ta_pose"])
        self.assertIn("https://oss.example/u/1.png", self.text(result))
        # The confirmed replay removes the pending record.
        self.assertFalse((self.data_dir / "pending" / f"{key}.json").exists())

    # ── review fixes: MCP protocol (SG-05) ──

    def test_tool_call_without_an_id_is_not_executed(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]
        for message in (
            self.tool_call("submit_hyper3d_task", {"action": "generate", "prompt": "chest"}, None),
            {**self.tool_call("list_hyper3d_animations", {}, None), "id": None},
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
        cases = [
            ("2024-11-05", "2024-11-05"),
            ("2025-03-26", "2025-03-26"),
            ("2025-06-18", "2025-06-18"),
            ("2099-01-01", "2025-06-18"),
            ("garbage", "2025-06-18"),
            (None, "2025-06-18"),
            (5, "2025-06-18"),
        ]
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
            ["node", str(SERVER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=self.env(**extra_env),
            cwd=self.project,
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
        FakeZCode.script[QUERY] = [status("running")]
        proc = self.start_server(HYPER3D_3D_POLL_INTERVAL_MS="5000", HYPER3D_3D_WAIT_BUDGET_MS="60000")
        proc.stdin.write(json.dumps(self.tool_call("submit_hyper3d_task", {"action": "generate", "prompt": "chest"})) + "\n")
        proc.stdin.flush()
        self.wait_for(lambda: self.requests_to(QUERY))
        self.cancel_and_finish(proc)
        time.sleep(0.3)
        # The confirmed submit is never sent again and polling stopped during its pause.
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)
        self.assertEqual(len(self.requests_to(QUERY)), 1)
        self.assertEqual(self.downloads(), [])

    def test_cancelled_call_aborts_an_in_flight_request(self):
        FakeZCode.script[QUERY] = [(*self.finished(), 8)]
        proc = self.start_server()
        proc.stdin.write(json.dumps(self.tool_call("get_hyper3d_task", {"task_id": TASK_ID})) + "\n")
        proc.stdin.flush()
        self.wait_for(lambda: self.requests_to(QUERY))
        self.cancel_and_finish(proc)
        self.assertEqual(len(self.requests_to(QUERY)), 1)
        self.assertEqual(self.downloads(), [])
        self.assertFalse((self.project / "generated-3d").exists())

    def test_cancelled_submit_retry_is_not_sent_and_cancel_for_other_ids_is_ignored(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        proc = self.start_server(HYPER3D_3D_RETRY_DELAY_MS="5000")
        proc.stdin.write(json.dumps(self.tool_call("submit_hyper3d_task", {"action": "generate", "prompt": "chest"})) + "\n")
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
            self.assertIn("0600", text)
            self.assertIn("Windows", text)
            self.assertIn("ACL", text)

    def test_unsaved_pending_record_is_reported_instead_of_promising_a_replay(self):
        # 插件数据目录不可写时，request_id 照样交回，但要明确告诉 Agent 重放会被拒绝，由用户决定。
        self.data_dir.write_text("not a directory")
        FakeZCode.script[SUBMIT] = [(200, TRUNCATED), (401, None)]
        result = self.call({"action": "generate", "prompt": "a small wooden treasure chest"})

        self.assertTrue(result["isError"])
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        text = self.text(result)
        self.assertIn(key, text)
        self.assertIn("没能保存", text)
        self.assertIn("由用户决定", text)
        self.assertTrue(self.data_dir.is_file())


class Hyper3DManifestTest(unittest.TestCase):
    def manifest(self):
        return json.loads((PLUGIN / ".zcode-plugin" / "plugin.json").read_text(encoding="utf-8"))

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
        server = self.manifest()["mcpServers"]["hyper3d_3d"]
        self.assertEqual(server["type"], "stdio")
        self.assertEqual(server["command"], "node")
        self.assertEqual(server["args"], ["${ZCODE_PLUGIN_ROOT}/mcp/server.mjs"])
        self.assertEqual(server["cwd"], "${ZCODE_PROJECT_DIR}")
        self.assertEqual(server["timeoutMs"], 330000)
        self.assertEqual(server["auth"], {"type": "zcode_official", "provider": "jwt_token"})
        self.assertNotIn("env", server, "identity must come from _meta, never from static env")

    def test_versions_agree(self):
        manifest = self.manifest()
        package = json.loads((PLUGIN / "package.json").read_text(encoding="utf-8"))
        source = SERVER.read_text(encoding="utf-8")
        self.assertEqual(manifest["name"], "hyper3d-3d")
        self.assertEqual(package["name"], "@zcode/hyper3d-3d-plugin")
        self.assertEqual(package["version"], manifest["version"])
        self.assertIn(f'const SERVER_VERSION = "{manifest["version"]}";', source)
        self.assertIn('const SERVER_NAME = "hyper3d-3d";', source)
        self.assertIn('const USAGE_SCENARIO = "hyper3d_model3d";', source)

    def test_marketplace_entry_agrees_with_the_manifest(self):
        marketplace = json.loads((ROOT / "marketplace.json").read_text(encoding="utf-8"))
        # Look the entry up by name: other plugins are appended independently, so its position is not fixed.
        entries = [item for item in marketplace["plugins"] if item.get("name") == "hyper3d-3d"]
        self.assertEqual(len(entries), 1, "marketplace.json must contain exactly one hyper3d-3d entry")
        (entry,) = entries
        manifest = self.manifest()
        self.assertEqual(entry["source"], "./plugins/hyper3d-3d")
        self.assertEqual(entry["version"], manifest["version"])
        self.assertEqual(entry["description"], manifest["description"])
        self.assertEqual(entry["description_i18n"], manifest["description_i18n"])
        self.assertEqual(entry["category"], "游戏/3D")
        self.assertIs(entry["requiresPaidPlan"], True)
        self.assertEqual(entry["displayName"], "Hyper3D")
        self.assertEqual(entry["displayName_i18n"], {"en": "Hyper3D", "zh-CN": "Hyper3D"})
        self.assertEqual(entry["icon"], "https://cdn-zcode.z.ai/zcode/official-plugin/assets/hyper3d-3d/icon.png")
        self.assertTrue((ROOT / "assets" / "hyper3d-3d" / "icon.png").is_file())
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
        # Distinguishable from the third-party hyper3d-rodin plugin.
        rodin = next(p for p in marketplace["plugins"] if p["name"] == "hyper3d-rodin")
        self.assertNotEqual(entry["displayName"], rodin["displayName"])

    def test_skill_frontmatter(self):
        text = (PLUGIN / "skills" / "hyper3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        match = re.match(r"^---\nname: (.+)\ndescription: (.+)\n---\n", text)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), "hyper3d-3d")
        for tool in TOOLS:
            self.assertIn(tool, text)

    def test_plugin_contains_no_private_endpoints_or_tokens(self):
        for path in PLUGIN.rglob("*"):
            if path.is_file():
                text = path.read_text(encoding="utf-8")
                for word in ("toolhubapi", "autoglm", "Bearer "):
                    self.assertNotIn(word, text, f"{path.relative_to(ROOT)} mentions {word}")
                # Only the loopback allowance (local development) may appear as an IP literal, plus the unroutable
                # 0.0.0.0 / 0.0.0.1 that the shared redirect check names when explaining IPv4-compatible IPv6, and the
                # 198.18.0.0/15 benchmarking range that proxy fake-IP modes answer with (named by the DNS check and docs).
                ips = set(re.findall(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", text)) - {"127.0.0.1", "0.0.0.0", "0.0.0.1", "198.18.0.0"}
                self.assertEqual(ips, set(), f"{path.relative_to(ROOT)} has an IP literal")
        self.assertNotRegex(SERVER.read_text(encoding="utf-8"), r"https?://[A-Za-z0-9]")


    def test_submit_timeout_covers_the_toolhub_runtime_timeout(self):
        # 接入文档建议 hyper3d_model3d 服务端超时 180s；插件放宽 10%，且必须留在单次调用 320s 预算内。
        source = SERVER.read_text(encoding="utf-8")
        submit_ms = int(re.search(r"const SUBMIT_TIMEOUT_MS = ([0-9_]+);", source).group(1).replace("_", ""))
        self.assertEqual(submit_ms, 198_000)
        self.assertGreaterEqual(submit_ms * 10, 180_000 * 11)
        self.assertLess(submit_ms, 320_000)


    def test_text_only_requests_are_routed_through_seedream(self):
        # 3D 厂商的方案是 文字 → 图片 → 3D：SKILL、README 和提交工具说明都要引导先用 Seedream 生图。
        skill = (PLUGIN / "skills" / "hyper3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        for word in ("text → image → 3D", "`image-generation`", "`generate_image`", "do not call each other"):
            self.assertIn(word, skill)
        self.assertIn("Seedream", (PLUGIN / "README.md").read_text(encoding="utf-8"))
        self.assertIn("Seedream", (PLUGIN / "README_CN.md").read_text(encoding="utf-8"))
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn("image-generation 插件的 generate_image", source)

    def test_user_is_told_before_the_separately_billed_seedream_step(self):
        # SG-02: Seedream is a second, separately billed call. The Agent says so first; if the user declines (or asked
        # for text only) it submits the text as `prompt` directly.
        skill = (PLUGIN / "skills" / "hyper3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        text_only = skill[skill.index("## Text-only requests"):skill.index("## Recommended chains")]
        for phrase in ("Before you call Seedream, tell the user", "billed separately", "Call Seedream only if the user agrees",
                       "If the user declines the extra step, or asked to generate from text only, do not call Seedream",
                       "the text as `prompt` directly"):
            self.assertIn(phrase, text_only)
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        section = readme[readme.index("## From text to 3D"):readme.index("## Inputs and outputs")]
        for phrase in ("Before it calls Seedream, the Agent tells you", "billed separately", "If you decline, or ask for text-only generation",
                       "directly as the `prompt`, without Seedream"):
            self.assertIn(phrase, section)
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        section_cn = readme_cn[readme_cn.index("## 只有文字描述时"):readme_cn.index("## 输入与产物")]
        for phrase in ("调用 Seedream 前，Agent 会先告诉你", "单独计费", "你不同意，或明确只要用文字生成时", "直接把文字作为 `prompt` 提交，不经过 Seedream"):
            self.assertIn(phrase, section_cn)
        description = SERVER.read_text(encoding="utf-8")
        for phrase in ("调用 Seedream 前先告诉用户这会多一步单独计费的生图", "用户不同意、明确要求只用文字生成", "不调用 Seedream，直接用 prompt 调用 generate"):
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


    def test_docs_describe_polygen(self):
        skill = (PLUGIN / "skills" / "hyper3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        for text in (skill, readme, readme_cn):
            self.assertIn("| `polygen` |", text)
            for word in ("`face_count`", "`transfer_texture`", "`uhd_texture`", "`NGon`", "`poly:`", "200–10000", "`.mtl`"):
                self.assertIn(word, text)
        chains = skill[skill.index("## Recommended chains"):skill.index("## Inputs and outputs")]
        self.assertIn("`generate` → `polygen`", chains)
        self.assertIn("geometry only", chains)
        self.assertIn("cannot** be rigged or re-polygened by `task_id`", chains)
        self.assertIn("pass it as `model_url`", chains)
        seedream = skill[skill.index("## Text-only requests"):skill.index("## Recommended chains")]
        self.assertIn("`polygen` with only `prompt`", seedream)
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn("polygen（智能低模", source)
        self.assertIn("低模（poly:）", source)

    def test_docs_describe_the_dns_check_and_the_file_name_rules(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        for phrase in ("the host name of the first link and of every redirect hop is also resolved", "or the name cannot be resolved",
                       "A DNS-rebinding window remains", "is kept exactly as the service gives it, including spaces, parentheses",
                       "Windows device names such as `CON`", "`renamed_files` and `rename_warning`",
                       "references inside OBJ / MTL files may need to be fixed by hand"):
            self.assertIn(phrase, readme)
        for phrase in ("请求第一个链接和每一跳之前还会解析链接的域名", "或者域名无法解析", "仍有 DNS 重绑定的窗口", "按服务端给出的原样保留（包括空格、括号",
                       "Windows 设备名", "`renamed_files` 和 `rename_warning`", "OBJ / MTL 文件里的引用可能需要手动修正"):
            self.assertIn(phrase, readme_cn)
        for text in (readme, readme_cn):
            self.assertNotIn("domain names that resolve to private addresses are not checked", text)
        source = SERVER.read_text(encoding="utf-8")
        core = source[source.index("// ════════ 共享核心："):source.index("// ════════ 共享核心结束")]
        self.assertIn("剩余风险（DNS 重绑定）", core)
        self.assertIn("dns.promises.lookup(host, { all: true, verbatim: true })", core)
        self.assertNotIn("域名解析到内网的情况这里管不到", source)

    def test_docs_say_uhd_texture_does_not_change_the_fixed_texture_resolution(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        skill = (PLUGIN / "skills" / "hyper3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("Tier, texture mode, and texture resolution are fixed by the service, also for `polygen`", readme)
        self.assertIn("`uhd_texture` (`polygen` only) just makes newly generated textures sharper; it does not change the texture resolution", readme)
        self.assertIn("档位、贴图模式和贴图分辨率由服务端固定（`polygen` 也一样）", readme_cn)
        self.assertIn("`uhd_texture`（仅 `polygen`）只让新生成的贴图更清晰，不改变贴图分辨率", readme_cn)
        self.assertIn("Tier, texture mode, and texture resolution are fixed by the service, also for `polygen`", skill)
        self.assertIn("`uhd_texture` only makes newly generated textures sharper and does not change the resolution", skill)

    def test_animation_library_uses_its_own_short_timeout(self):
        # 免费的同步查询不需要等提交那么久（提交要先拉取素材）。
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn("const LIBRARY_TIMEOUT_MS = 60_000;", source)
        block = source[source.index("// ════════ 共享：预设动画库"):source.index("// ════════ 共享：预设动画库结束")]
        self.assertIn("timeoutMs: LIBRARY_TIMEOUT_MS", block)
        self.assertNotIn("SUBMIT_TIMEOUT_MS", block)

    def test_docs_describe_the_default_folder_and_invocation_id_as_implemented(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        skill = (PLUGIN / "skills" / "hyper3d-3d" / "SKILL.md").read_text(encoding="utf-8")
        for text in (readme, readme_cn, skill):
            self.assertIn("generated-3d/<YYYYMMDD-HHMMSS>-<action", text)
            self.assertIn("-<slug>/", text)
            self.assertNotIn("-<action>-<description>/", text)
            self.assertNotIn("<类型>-<描述>", text)
            self.assertIn("`get_hyper3d_task`", text)
            self.assertIn("`null`", text)
        self.assertIn("<action or task kind>", readme)
        self.assertIn("<action 或任务种类>", readme_cn)
        self.assertIn("only present when the submitting call (`submit_hyper3d_task`) itself finishes with products", readme)
        self.assertIn("does not include it (the field is missing)", readme)
        self.assertIn("`null` in completed `get_hyper3d_task` results", readme)
        self.assertIn("只在提交的那次调用（`submit_hyper3d_task`）本身等到产物", readme_cn)
        self.assertIn("还在进行就返回时不包含这个字段", readme_cn)
        self.assertIn("only present when the submitting call itself finishes with products", skill)
        self.assertIn("missing when `submit_hyper3d_task` returns still running", skill)
        for text in (readme, readme_cn, skill):
            self.assertNotIn("only present on the submitting call;", text)
        # The code builds the folder from the action (submit) or the task kind (get), and the slug from the prompt.
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn("outputTarget(outputDir, action ?? kind, slugSource)", source)
        self.assertIn("slugSource: body.prompt", source)

    def test_skill_stops_replaying_a_request_id_that_stays_unconfirmed(self):
        skill = (PLUGIN / "skills" / "hyper3d-3d" / "SKILL.md").read_text(encoding="utf-8")
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
        self.assertIn("Stop waiting after about 15 minutes of `get_hyper3d_task` calls", waiting)
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
        # charCount and integerArg are not used by every sibling plugin, so they live in the Hyper3D section.
        core = source[source.index("// ════════ 共享核心："):source.index("// ════════ 共享核心结束")]
        hyper3d = source[source.index("// ════════ Hyper3D 专属："):source.index("// ════════ 共享核心：")]
        for helper in ("function charCount(", "function integerArg("):
            self.assertNotIn(helper, core)
            self.assertIn(helper, hyper3d)
            self.assertEqual(source.count(helper), 1)


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
