"""Behavioural contract for the meshy-3d plugin.

Runs the real `mcp/server.mjs` over stdio against a fake ZCode API on loopback, the
same way the ZCode host drives it: identity arrives in `params._meta`, never in env.
Product downloads are served by the same fake server under /cdn/ so the tests can
check that no identity header ever reaches a product URL.
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
PLUGIN = ROOT / "plugins" / "meshy-3d"
SERVER = PLUGIN / "mcp" / "server.mjs"
AUTH_KEY = "com.zcode/official-mcp-auth"
JWT = "Bearer test-zcode-jwt"
SUBMIT = "/api/v1/toolhub/tool/meshy_model3d/invoke"
QUERY = "/api/v1/toolhub/tool/meshy_model3d/tasks/query"
UPLOAD = "/api/v1/toolhub/files"
SCENARIO = "meshy_model3d"
TOOLS = ["submit_meshy_task", "get_meshy_task", "list_meshy_animations"]
TRUNCATED = object()

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
GLB = b"glTF\x02\x00\x00\x00" + b"\x00" * 32
FBX = b"Kaydara FBX Binary  \x00" + b"\x00" * 16
OBJ = b"o model\nv 0 0 0\n"
PREVIEW = "preview:01a1ed7b-5c8e-7f3a-9b2d-4e6f8a0c1d2e"
REFINE = "refine:01a1ed95-2b4c-7d6e-8f0a-1b2c3d4e5f60"
REMESH = "remesh:01a1ed95-9a8b-7c6d-5e4f-3a2b1c0d9e8f"
RIG = "rig:01a1edab-1111-7222-8333-944455556666"
PRODUCTS = {".glb": GLB, ".fbx": FBX, ".obj": OBJ, ".usdz": b"PK\x03\x04usdz", ".png": PNG}
IDENTITY_HEADERS = ("authorization", "x-usage-scenario", "bigmodel-organization", "idempotency-key")
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
    """Records every request; `script` maps a path to a queue of (status, body) replies."""

    requests: list[dict] = []
    downloads: list[dict] = []
    script: dict[str, list[tuple[int, object]]] = {}
    # GET path (without query) -> Location of a 302 answer.
    redirects: dict[str, str] = {}

    def log_message(self, *_args):  # keep test output quiet
        pass

    def do_GET(self):
        FakeZCode.downloads.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}})
        path = self.path.split("?", 1)[0]
        if path in FakeZCode.redirects:
            self.send_response(302)
            self.send_header("Location", FakeZCode.redirects[path])
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        payload = PRODUCTS.get(os.path.splitext(path)[1])
        if not path.startswith("/cdn/") or "/missing/" in path or payload is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        if "/stream/" in path:
            # No Content-Length: the body is close-delimited and arrives in several pieces,
            # so only the per-chunk cap in the client can stop an oversized download.
            self.end_headers()
            for _ in range(8):
                self.wfile.write(payload)
                self.wfile.flush()
            return
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


def submitted(task_id=PREVIEW):
    return ok({"invocation_id": "inv-1", "state": "SUCCEEDED", "output": {"task_id": task_id}})


def replayed(task_id):
    return ok({"invocation_id": "inv-2", "state": "SUCCEEDED", "replayed": True, "upstream_req_id": task_id})


def running(task_id=PREVIEW, status="running", upstream="IN_PROGRESS"):
    return ok({"task_id": task_id, "status": status, "upstream_status": upstream})


@unittest.skipUnless(shutil.which("node"), "node is required to run the MCP server")
class MeshyServerTest(unittest.TestCase):
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
        # 服务端按真实路径写文件（macOS 的 /var 是 /private/var 的符号链接），断言也用真实路径。
        self.sandbox = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.sandbox, ignore_errors=True)
        self.project = (self.sandbox / "project").resolve()
        self.project.mkdir()
        self.data_dir = self.sandbox / "plugin-data"

    # ── fixtures ──

    def cdn(self, path):
        return f"{self.origin}/cdn/{path}?Expires=1767225600&Signature=abc%3D&Key-Pair-Id=K1"

    def model_output(self, task_id=PREVIEW, kind="text-to-3d", base="tasks/0193a1"):
        return {
            "task_id": task_id,
            "type": kind,
            "status": "SUCCEEDED",
            "progress": 100,
            "model_urls": {
                "glb": self.cdn(f"{base}/output/model.glb"),
                "fbx": self.cdn(f"{base}/output/model.fbx"),
                "obj": self.cdn(f"{base}/output/model.obj"),
                "usdz": self.cdn(f"{base}/output/model.usdz"),
            },
            "thumbnail_url": self.cdn(f"{base}/output/preview.png"),
            "consumed_credits": 20,
        }

    def finished(self, task_id=PREVIEW, output=None):
        return ok(
            {
                "task_id": task_id,
                "status": "succeeded",
                "upstream_status": "SUCCEEDED",
                "output": output if output is not None else self.model_output(task_id),
            }
        )

    def rig_output(self):
        return {
            "task_id": RIG,
            "type": "rig",
            "status": "SUCCEEDED",
            "progress": 100,
            "model_urls": {"glb": self.cdn("rig/a/model.glb"), "fbx": self.cdn("rig/a/model.fbx")},
            "thumbnail_url": self.cdn("rig/a/preview.png"),
            "result": {
                "rigged_character_glb_url": self.cdn("rig/b/model.glb"),
                "rigged_character_fbx_url": self.cdn("rig/b/Character_output.fbx"),
                "basic_animations": {
                    "walking_glb_url": self.cdn("rig/b/Animation_Walking_withSkin.glb"),
                    "running_glb_url": self.cdn("rig/b/Animation_Running_withSkin.glb"),
                    "walking_fbx_url": self.cdn("rig/b/Animation_Walking_withSkin.fbx"),
                },
            },
            "consumed_credits": 5,
        }

    # ── harness ──

    def call(self, arguments, tool="submit_meshy_task", auth=None, base_url=None, wait_budget_ms=10_000, **extra_env):
        meta = {
            AUTH_KEY: auth
            if auth is not None
            else {"ok": True, "headers": {"Authorization": JWT, "Bigmodel-Organization": "org-1"}},
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
            "MESHY_3D_RETRY_DELAY_MS": "10",
            "MESHY_3D_POLL_INTERVAL_MS": "10",
            "MESHY_3D_WAIT_BUDGET_MS": str(wait_budget_ms),
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

    def submit_bodies(self):
        return [json.loads(r["body"]) for r in self.requests_to(SUBMIT)]

    def assert_rejected_locally(self, arguments, expected, tool="submit_meshy_task"):
        FakeZCode.requests = []
        result = self.call(arguments, tool=tool)
        self.assertTrue(result.get("isError"), f"{arguments} was accepted: {self.text(result)}")
        self.assertIn(expected, self.text(result))
        self.assertEqual(FakeZCode.requests, [], f"{arguments} made a request")

    def assert_clean_downloads(self):
        self.assertTrue(FakeZCode.downloads)
        for download in FakeZCode.downloads:
            for header in IDENTITY_HEADERS:
                self.assertNotIn(header, download["headers"], f"{header} leaked to {download['path']}")

    # ── tool listing ──

    def test_tools_list_schema(self):
        FakeZCode.script[SUBMIT] = [(200, {"code": 3703, "msg": "rejected"})]
        self.call({"action": "generate", "prompt": "x"})
        submit, result, animations = self.tools
        props = submit["inputSchema"]["properties"]
        self.assertEqual(props["action"]["enum"], ["generate", "refine", "retexture", "remesh", "convert", "rig", "animate"])
        self.assertNotIn("maxLength", props["task_id"])
        self.assertEqual(props["target_polycount"]["type"], ["integer", "string"])
        self.assertEqual(submit["inputSchema"]["required"], ["action"])
        self.assertIn("remesh", submit["description"])
        self.assertIn("38 万", submit["description"])
        self.assertEqual(result["inputSchema"]["required"], ["task_id"])
        self.assertNotIn("maxLength", result["inputSchema"]["properties"]["task_id"])
        self.assertEqual(set(result["inputSchema"]["properties"]), {"task_id", "output_dir", "formats"})
        self.assertEqual(set(animations["inputSchema"]["properties"]), {"category", "search"})

    # ── happy paths ──

    def test_text_generate_submits_polls_and_downloads(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [running(status="queued", upstream="PENDING"), running(), self.finished()]

        result = self.call({"action": "generate", "prompt": "a cute cartoon knight, full body", "pose_mode": "A-POSE"})

        self.assertNotIn("isError", result, self.text(result))
        (submit,) = self.requests_to(SUBMIT)
        self.assertEqual(submit["headers"]["authorization"], JWT)
        self.assertEqual(submit["headers"]["bigmodel-organization"], "org-1")
        self.assertEqual(submit["headers"]["x-usage-scenario"], SCENARIO)
        self.assertTrue(submit["headers"]["idempotency-key"])
        self.assertEqual(
            json.loads(submit["body"]),
            {"action": "generate", "prompt": "a cute cartoon knight, full body", "pose_mode": "a-pose"},
        )
        queries = self.requests_to(QUERY)
        self.assertEqual(len(queries), 3)
        for query in queries:
            self.assertEqual(json.loads(query["body"]), {"task_id": PREVIEW})
            self.assertNotIn("idempotency-key", query["headers"])
            self.assertEqual(query["headers"]["x-usage-scenario"], SCENARIO)
            self.assertEqual(query["headers"]["authorization"], JWT)

        structured = result["structuredContent"]
        self.assertEqual(structured["status"], "succeeded")
        self.assertEqual(structured["task_id"], PREVIEW)
        self.assertEqual(structured["action"], "generate")
        saved = [Path(f["path"]) for f in structured["files"] if f["path"]]
        self.assertEqual([p.name for p in saved], ["model.glb"])
        self.assertEqual(saved[0].read_bytes(), GLB)
        folder = saved[0].parent
        self.assertEqual(folder.parent, self.project / "generated-3d")
        self.assertRegex(folder.name, r"^\d{8}-\d{6}-generate-a-cute-cartoon-knight-fu$")
        self.assertNotIn(":", str(folder.relative_to(self.project)))
        self.assertEqual(structured["links"]["thumbnail_url"], self.cdn("tasks/0193a1/output/preview.png"))
        text = self.text(result)
        self.assertIn(str(saved[0]), text)
        self.assertIn("model.fbx", text)
        self.assertIn("preview.png", text)
        self.assertIn("3 天", text)
        self.assertIn("inv-1", text)
        # One progress notification per query round and per download, all with the caller's token.
        self.assertGreaterEqual(len(self.progress), 3)
        self.assertEqual(self.progress[0]["params"]["progressToken"], "p-1")
        # The first progress message carries the task_id, so a cancelled call can still be fetched later.
        self.assertIn(f"task_id：{PREVIEW}", self.progress[0]["params"]["message"])
        self.assert_clean_downloads()

    def test_each_action_builds_only_documented_fields(self):
        cases = [
            (
                {
                    "action": "generate",
                    "images": ["https://cdn.example/front.png", "https://cdn.example/side.png"],
                    "geometry_only": True,
                    "formats": ["GLB", "fbx", "glb"],
                },
                {
                    "action": "generate",
                    "images": ["https://cdn.example/front.png", "https://cdn.example/side.png"],
                    "geometry_only": True,
                    "formats": ["glb", "fbx"],
                },
                "multi:01a1",
            ),
            (
                {"action": "refine", "task_id": PREVIEW, "texture_prompt": "silver armor, red cape"},
                {"action": "refine", "task_id": PREVIEW, "texture_prompt": "silver armor, red cape"},
                REFINE,
            ),
            (
                {
                    "action": "retexture",
                    "model_url": "https://cdn.example/models/knight.glb?sig=1",
                    "texture_image": "https://cdn.example/style.png",
                    "formats": ["fbx"],
                },
                {
                    "action": "retexture",
                    "model_url": "https://cdn.example/models/knight.glb?sig=1",
                    "texture_image": "https://cdn.example/style.png",
                },
                "retexture:01a1",
            ),
            (
                {"action": "remesh", "task_id": REFINE, "topology": "QUAD", "target_polycount": "100000", "formats": ["blend", "glb"]},
                {"action": "remesh", "task_id": REFINE, "topology": "quad", "target_polycount": 100000, "formats": ["blend", "glb"]},
                REMESH,
            ),
            (
                {"action": "convert", "task_id": REMESH, "formats": ["usdz"]},
                {"action": "convert", "task_id": REMESH, "formats": ["usdz"]},
                "convert:01a1",
            ),
            (
                {"action": "rig", "task_id": REMESH, "height_meters": "1.2", "include_fingers": True, "skeleton_template": "meshyrig"},
                {"action": "rig", "task_id": REMESH, "skeleton_template": "meshyrig", "height_meters": 1.2, "include_fingers": True},
                RIG,
            ),
            (
                {"action": "animate", "task_id": RIG, "action_ids": [0, "2"]},
                {"action": "animate", "task_id": RIG, "action_ids": [0, 2]},
                "anim:01a1",
            ),
        ]
        for arguments, expected, task_id in cases:
            with self.subTest(action=arguments["action"]):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted(task_id)]
                FakeZCode.script[QUERY] = [self.finished(task_id)]
                result = self.call(arguments)
                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(self.submit_bodies(), [expected])
                self.assertEqual(json.loads(self.requests_to(QUERY)[0]["body"]), {"task_id": task_id})

    def test_rig_on_an_unremeshed_task_is_not_blocked_locally(self):
        FakeZCode.script[SUBMIT] = [submitted(RIG)]
        FakeZCode.script[QUERY] = [self.finished(RIG, self.rig_output())]
        result = self.call({"action": "rig", "task_id": REFINE})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.submit_bodies(), [{"action": "rig", "task_id": REFINE}])

    def test_local_and_data_images_are_uploaded(self):
        (self.project / "front.png").write_bytes(PNG)
        data_url = "data:image/png;base64," + base64.b64encode(PNG).decode()
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/u/1.png?sig=1"}), ok({"url": "https://oss.example/u/2.png?sig=2"})]
        FakeZCode.script[SUBMIT] = [submitted("multi:01a1")]
        FakeZCode.script[QUERY] = [self.finished("multi:01a1")]

        result = self.call({"action": "generate", "images": ["front.png", data_url, "https://cdn.example/back.png"]})

        self.assertNotIn("isError", result, self.text(result))
        uploads = self.requests_to(UPLOAD)
        self.assertEqual(len(uploads), 2)
        for upload in uploads:
            self.assertIn("multipart/form-data", upload["headers"]["content-type"])
            self.assertIn(PNG, upload["body"])
            self.assertEqual(upload["headers"]["x-usage-scenario"], SCENARIO)
            self.assertEqual(upload["headers"]["authorization"], JWT)
            self.assertNotIn("idempotency-key", upload["headers"])
        self.assertEqual(
            self.submit_bodies()[0]["images"],
            ["https://oss.example/u/1.png?sig=1", "https://oss.example/u/2.png?sig=2", "https://cdn.example/back.png"],
        )

    def test_a_bad_image_stops_before_any_upload(self):
        (self.project / "front.png").write_bytes(PNG)
        (self.project / "empty.png").write_bytes(b"")
        cases = [
            (["front.png", "missing.png"], "missing.png"),
            (["front.png", "empty.png"], "空文件"),
            (["front.png", "data:image/png;base64,@@@@"], "base64"),
            (["front.png", "data:image/gif;base64,R0lGOD=="], "png / jpeg / webp"),
        ]
        for images, expected in cases:
            with self.subTest(images=images):
                self.assert_rejected_locally({"action": "generate", "images": images}, expected)

    def test_local_texture_image_is_uploaded(self):
        (self.project / "style.webp").write_bytes(b"RIFF\x00\x00\x00\x00WEBPVP8 ")
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/u/style.webp"})]
        FakeZCode.script[SUBMIT] = [submitted(REFINE)]
        FakeZCode.script[QUERY] = [self.finished(REFINE)]
        result = self.call({"action": "refine", "task_id": PREVIEW, "texture_image": "style.webp"})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(
            self.submit_bodies(), [{"action": "refine", "task_id": PREVIEW, "texture_image": "https://oss.example/u/style.webp"}]
        )

    def test_rig_products_are_collected_from_result_into_the_default_folder(self):
        FakeZCode.script[QUERY] = [self.finished(RIG, self.rig_output())]

        result = self.call({"task_id": RIG}, tool="get_meshy_task")

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(SUBMIT), [])
        files = result["structuredContent"]["files"]
        saved = [Path(f["path"]) for f in files if f["path"]]
        self.assertEqual(
            [p.name for p in saved],
            ["model.glb", "model-1.glb", "Animation_Walking_withSkin.glb", "Animation_Running_withSkin.glb"],
        )
        self.assertTrue(all(p.read_bytes() == GLB for p in saved))
        self.assertEqual(len({p.parent for p in saved}), 1)
        self.assertRegex(saved[0].parent.name, r"^\d{8}-\d{6}-rig-model$")
        self.assertEqual(result["structuredContent"]["kind"], "rig")
        text = self.text(result)
        self.assertIn(f"- model_urls.glb：{saved[0]}", text)
        self.assertIn(f"- result.rigged_character_glb_url：{saved[1]}", text)
        self.assertIn(f"- result.basic_animations.walking_glb_url：{saved[2]}", text)
        self.assertIn("Character_output.fbx", text)
        self.assertIn("Animation_Walking_withSkin.fbx", text)
        self.assertIn("result.basic_animations.walking_fbx_url", text)
        self.assertEqual(result["structuredContent"]["links"]["result"]["rigged_character_fbx_url"], self.cdn("rig/b/Character_output.fbx"))
        self.assert_clean_downloads()
        self.assertNotIn("/cdn/rig/b/Character_output.fbx", [d["path"].split("?")[0] for d in FakeZCode.downloads])

    def test_formats_choose_what_is_downloaded(self):
        cases = [
            (["fbx"], ["model.fbx", "Character_output.fbx", "Animation_Walking_withSkin.fbx"], self.rig_output(), RIG),
            (["obj", "usdz"], ["model.obj", "model.usdz"], None, PREVIEW),
        ]
        for formats, names, output, task_id in cases:
            with self.subTest(formats=formats):
                FakeZCode.requests = []
                FakeZCode.script[QUERY] = [self.finished(task_id, output)]
                result = self.call({"task_id": task_id, "formats": formats, "output_dir": f"out-{formats[0]}"}, tool="get_meshy_task")
                self.assertNotIn("isError", result, self.text(result))
                saved = [Path(f["path"]) for f in result["structuredContent"]["files"] if f["path"]]
                self.assertEqual([p.name for p in saved], names)
                self.assertTrue(all(p.parent == self.project / f"out-{formats[0]}" for p in saved))

    def test_downloads_are_skipped_when_the_call_budget_is_nearly_spent(self):
        # Driven by the MIN_DOWNLOAD_MS hook rather than by a short budget and a slow reply, so the outcome does not
        # depend on machine speed: no download may start with less than an hour of the 320 s budget left.
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task", MESHY_3D_MIN_DOWNLOAD_MS="3600000")

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(FakeZCode.downloads, [])
        (entry,) = result["structuredContent"]["files"]
        self.assertIsNone(entry["path"])
        self.assertEqual(entry["url"], self.cdn("tasks/0193a1/output/model.glb"))
        text = self.text(result)
        self.assertIn(f"本次调用时间不够，未下载）：{self.cdn('tasks/0193a1/output/model.glb')}", text)
        self.assertIn("preview.png", text)
        self.assertIsNone(result["structuredContent"]["output_dir"])
        self.assertFalse((self.project / "generated-3d").exists() and any((self.project / "generated-3d").iterdir()))

    def test_existing_files_are_never_overwritten(self):
        out = self.project / "out"
        out.mkdir()
        (out / "model.glb").write_bytes(b"keep")
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"action": "generate", "prompt": "knight", "output_dir": "out"})

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual((out / "model.glb").read_bytes(), b"keep")
        self.assertEqual((out / "model-1.glb").read_bytes(), GLB)
        # A collision suffix is a rename too: OBJ / MTL references to the original name would no longer match.
        self.assertEqual(result["structuredContent"]["renamed_files"], [{"key": "model_urls.glb", "from": "model.glb", "to": "model-1.glb"}])
        self.assertIn('- "model.glb" → "model-1.glb"', self.text(result))
        self.assertIn("可能需要手动修正", self.text(result))

    def test_output_dir_that_is_a_file_is_refused_before_any_request(self):
        (self.project / "taken.glb").write_bytes(b"keep")
        self.assert_rejected_locally({"action": "generate", "prompt": "knight", "output_dir": "taken.glb"}, "不是目录")
        self.assertEqual((self.project / "taken.glb").read_bytes(), b"keep")

    def test_failed_download_keeps_the_link_and_does_not_fail_the_call(self):
        output = self.model_output()
        output["model_urls"]["glb"] = self.cdn("missing/model.glb")
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task")
        self.assertNotIn("isError", result, self.text(result))
        (entry,) = result["structuredContent"]["files"]
        self.assertIsNone(entry["path"])
        self.assertIn("missing/model.glb", self.text(result))
        self.assertIn("HTTP 404", self.text(result))

    def test_oversized_download_keeps_the_link_and_writes_nothing(self):
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task", MESHY_3D_MAX_DOWNLOAD_BYTES="1")
        self.assertNotIn("isError", result, self.text(result))
        self.assertIsNone(result["structuredContent"]["files"][0]["path"])
        self.assertIn("model.glb", self.text(result))
        self.assertFalse((self.project / "generated-3d").exists())

    def test_streamed_download_without_length_is_capped_while_reading(self):
        output = self.model_output()
        output["model_urls"] = {"glb": self.cdn("stream/model.glb")}
        for cap, saved in [(str(len(GLB) * 3), False), (str(len(GLB) * 8), True)]:
            with self.subTest(cap=cap):
                shutil.rmtree(self.project / "out", ignore_errors=True)
                FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
                result = self.call({"task_id": PREVIEW, "output_dir": "out"}, tool="get_meshy_task", MESHY_3D_MAX_DOWNLOAD_BYTES=cap)
                self.assertNotIn("isError", result, self.text(result))
                (entry,) = result["structuredContent"]["files"]
                if saved:
                    self.assertEqual(Path(entry["path"]).read_bytes(), GLB * 8)
                else:
                    self.assertIsNone(entry["path"])
                    self.assertIn("stream/model.glb", self.text(result))
                    self.assertFalse((self.project / "out").exists() and any((self.project / "out").iterdir()))

    def test_hostile_product_names_stay_inside_the_output_dir(self):
        long_stem = "a" * 192
        output = self.model_output()
        output["model_urls"] = {
            "glb": self.cdn("x/..%2F..%2F..%2Fevil.glb"),
            "fbx": self.cdn("x/%2Fetc%2Fpasswd.fbx"),
            # Names are capped at 200 UTF-8 bytes (extension kept) and cut on whole code points: the astral
            # character fills bytes 193-196, so it is kept whole and the "b" after it is dropped.
            "obj": self.cdn(f"x/{long_stem}%F0%A0%80%80b.obj"),
        }
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]

        result = self.call({"task_id": PREVIEW, "formats": ["glb", "fbx", "obj"], "output_dir": "out"}, tool="get_meshy_task")

        self.assertNotIn("isError", result, self.text(result))
        saved = [Path(f["path"]) for f in result["structuredContent"]["files"]]
        self.assertEqual([p.name for p in saved], ["_.._.._evil.glb", "_etc_passwd.fbx", f"{long_stem}\U00020000.obj"])
        self.assertEqual(
            [(r["from"], r["to"]) for r in result["structuredContent"]["renamed_files"]],
            [("../../../evil.glb", "_.._.._evil.glb"), ("/etc/passwd.fbx", "_etc_passwd.fbx"),
             (f"{long_stem}\U00020000b.obj", f"{long_stem}\U00020000.obj")],
        )
        for path in saved:
            self.assertEqual(path.parent, self.project / "out")
            self.assertTrue(path.is_file())
        self.assertLessEqual({p.name for p in self.sandbox.iterdir()}, {"plugin-data", "project"})
        self.assertEqual(sorted(p.name for p in self.project.iterdir()), ["out"])

    def test_default_folder_behind_an_escaping_symlink_degrades_to_links(self):
        outside = self.sandbox / "outside"
        outside.mkdir()
        (self.project / "generated-3d").symlink_to(outside)
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task")

        self.assertNotIn("isError", result, self.text(result))
        files = result["structuredContent"]["files"]
        self.assertTrue(files)
        self.assertTrue(all(f["path"] is None for f in files))
        self.assertIn("工作区", self.text(result))
        self.assertIn("model.glb", self.text(result))
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual(FakeZCode.downloads, [])

    def test_output_dir_can_be_the_workspace_root(self):
        for value in [".", str(self.project)]:
            with self.subTest(output_dir=value):
                for leftover in self.project.iterdir():
                    leftover.unlink()
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [self.finished()]
                result = self.call({"action": "generate", "prompt": "knight", "output_dir": value})
                self.assertNotIn("isError", result, self.text(result))
                (entry,) = result["structuredContent"]["files"]
                self.assertEqual(Path(entry["path"]), self.project / "model.glb")
                self.assertEqual((self.project / "model.glb").read_bytes(), GLB)

    def test_default_folder_name_keeps_astral_characters_whole(self):
        prompt = "a" * 23 + "\U00020000" + "bcd"
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"action": "generate", "prompt": prompt})

        self.assertNotIn("isError", result, self.text(result))
        path = Path(result["structuredContent"]["files"][0]["path"])
        self.assertTrue(path.parent.name.endswith("-generate-" + "a" * 23 + "\U00020000"), path.parent.name)
        self.assertTrue(path.is_file())
        self.assertEqual([p.name for p in (self.project / "generated-3d").iterdir()], [path.parent.name])

    # ── local validation ──

    def test_invalid_arguments_fail_before_any_request(self):
        long_prompt = "a" * 801
        cases = [
            ({}, "action"),
            ({"action": "sculpt"}, "action"),
            ({"action": "animation_library"}, "action"),
            ({"action": "generate"}, "prompt"),
            ({"action": "generate", "prompt": "x", "images": ["https://a.example/1.png"]}, "二选一"),
            ({"action": "generate", "images": ["https://a.example/1.png"] * 5}, "最多 4"),
            ({"action": "generate", "images": "https://a.example/1.png"}, "数组"),
            ({"action": "generate", "prompt": long_prompt}, "800"),
            ({"action": "generate", "prompt": "x", "pose_mode": "x-pose"}, "a-pose / t-pose"),
            ({"action": "generate", "prompt": "x", "formats": ["blend"]}, "blend"),
            ({"action": "generate", "prompt": "x", "formats": ["gltf"]}, "glb / fbx"),
            ({"action": "generate", "prompt": "x", "formats": []}, "formats"),
            ({"action": "generate", "prompt": "x", "geometry_only": "yes"}, "geometry_only"),
            ({"action": "generate", "images": ["http://a.example/1.png"]}, "https"),
            ({"action": "generate", "images": ["ftp://a.example/1.png"]}, "https"),
            ({"action": "generate", "images": [with_userinfo("https://a.example/1.png")]}, "账号密码"),
            ({"action": "generate", "images": ["ref.gif"]}, "png"),
            ({"action": "generate", "images": ["missing.png"]}, "missing.png"),
            ({"action": "generate", "prompt": "x", "target_polycount": 1000}, "target_polycount 只用于"),
            ({"action": "generate", "prompt": "x", "task_id": PREVIEW}, "task_id 只用于"),
            ({"action": "refine", "task_id": PREVIEW, "model_url": "https://a.example/m.glb"}, "model_url 只用于"),
            ({"action": "refine", "texture_prompt": "x"}, "task_id"),
            ({"action": "refine", "task_id": PREVIEW, "texture_prompt": "a" * 601}, "600"),
            ({"action": "retexture", "task_id": REFINE}, "texture_prompt"),
            ({"action": "remesh"}, "task_id"),
            ({"action": "remesh", "task_id": REFINE, "model_url": "https://a.example/m.glb"}, "二选一"),
            ({"action": "remesh", "task_id": REFINE, "target_polycount": 99}, "100 到 300000"),
            ({"action": "remesh", "task_id": REFINE, "target_polycount": 300001}, "100 到 300000"),
            ({"action": "remesh", "task_id": REFINE, "target_polycount": 1.5}, "100 到 300000"),
            ({"action": "remesh", "task_id": REFINE, "target_polycount": "lots"}, "100 到 300000"),
            ({"action": "remesh", "task_id": REFINE, "topology": "ngon"}, "quad / triangle"),
            ({"action": "remesh", "task_id": "refine:01a1 ed95"}, "空白"),
            ({"action": "generate", "images": ["https://a.example/model.glb"]}, "3D 模型"),
            ({"action": "remesh", "task_id": REFINE, "texture_prompt": "x"}, "texture_prompt 只用于"),
            ({"action": "convert", "task_id": REMESH}, "formats"),
            ({"action": "convert", "task_id": REMESH, "formats": ["max"]}, "blend"),
            ({"action": "rig", "task_id": REMESH, "height_meters": 0}, "大于 0"),
            ({"action": "rig", "task_id": REMESH, "height_meters": -1.7}, "大于 0"),
            ({"action": "rig", "task_id": REMESH, "height_meters": "tall"}, "大于 0"),
            ({"action": "rig", "task_id": REMESH, "include_fingers": "true"}, "include_fingers"),
            ({"action": "rig", "model_url": "https://a.example/m.fbx"}, ".glb"),
            ({"action": "remesh", "model_url": "https://a.example/m.zip"}, ".glb / .gltf / .obj / .fbx / .stl"),
            ({"action": "remesh", "model_url": "http://a.example/m.glb"}, "https"),
            ({"action": "remesh", "model_url": "data:model/gltf-binary;base64,AAAA"}, "https"),
            ({"action": "remesh", "model_url": with_userinfo("https://a.example/m.glb", "u:p")}, "账号密码"),
            ({"action": "animate", "task_id": RIG}, "action_ids"),
            ({"action": "animate", "task_id": RIG, "action_ids": list(range(11))}, "1–10"),
            ({"action": "animate", "task_id": RIG, "action_ids": [1, 1]}, "重复"),
            ({"action": "animate", "task_id": RIG, "action_ids": [1, "1"]}, "重复"),
            ({"action": "animate", "task_id": RIG, "action_ids": [-1]}, "action_ids"),
            ({"action": "animate", "task_id": RIG, "action_ids": ["walk"]}, "action_ids"),
            ({"action": "animate", "task_id": RIG, "action_ids": [1.5]}, "action_ids"),
            ({"action": "animate", "model_url": "https://a.example/m.glb", "action_ids": [1]}, "model_url 只用于"),
        ]
        for arguments, expected in cases:
            with self.subTest(arguments=arguments):
                self.assert_rejected_locally(arguments, expected)

    def test_task_id_prefix_rules(self):
        cases = [
            ({"action": "refine", "task_id": "image:01a1", "texture_prompt": "x"}, "preview:"),
            ({"action": "refine", "task_id": REFINE, "texture_prompt": "x"}, "preview:"),
            ({"action": "animate", "task_id": REMESH, "action_ids": [0]}, "rig:"),
            ({"action": "animate", "task_id": "anim:01a1", "action_ids": [0]}, "rig:"),
            ({"action": "rig", "task_id": RIG}, "preview / refine / image / multi / retexture / remesh"),
            ({"action": "remesh", "task_id": "convert:01a1"}, "「convert」"),
            ({"action": "retexture", "task_id": "anim:01a1", "texture_prompt": "x"}, "「anim」"),
            ({"action": "convert", "task_id": "01a1ed95-no-kind", "formats": ["fbx"]}, "未知"),
            ({"action": "rig", "task_id": "lib:01a1"}, "「lib」"),
        ]
        for arguments, expected in cases:
            with self.subTest(arguments=arguments):
                self.assert_rejected_locally(arguments, expected)
        for kind in ["preview", "refine", "image", "multi", "retexture", "remesh"]:
            with self.subTest(kind=kind):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted("convert:01a1")]
                FakeZCode.script[QUERY] = [self.finished("convert:01a1")]
                result = self.call({"action": "convert", "task_id": f"{kind}:01a1", "formats": ["fbx"]})
                self.assertNotIn("isError", result, self.text(result))

    def test_local_model_file_is_rejected(self):
        (self.project / "models").mkdir()
        (self.project / "models" / "knight.glb").write_bytes(GLB)
        for value in ["models/knight.glb", str(self.project / "models" / "knight.glb"), "file:///tmp/knight.glb"]:
            with self.subTest(value=value):
                expected = "https" if value.startswith("file:") else "本地 3D 模型"
                self.assert_rejected_locally({"action": "remesh", "model_url": value}, expected)
        # A local model passed where an image is expected gets the same explanation.
        self.assert_rejected_locally({"action": "generate", "images": ["models/knight.glb"]}, "本地 3D 模型")

    def test_paths_outside_the_workspace_are_refused_before_any_request(self):
        secret = self.sandbox / "secret.png"
        secret.write_bytes(PNG)
        (self.project / "link.png").symlink_to(secret)
        (self.project / "out-link").symlink_to(self.sandbox)
        cases = [
            {"action": "generate", "images": ["../secret.png"]},
            {"action": "generate", "images": [str(secret)]},
            {"action": "generate", "images": ["link.png"]},
            {"action": "refine", "task_id": PREVIEW, "texture_image": "../secret.png"},
            {"action": "generate", "prompt": "x", "output_dir": "../elsewhere"},
            {"action": "generate", "prompt": "x", "output_dir": str(self.sandbox)},
            {"action": "generate", "prompt": "x", "output_dir": "out-link/new"},
        ]
        for arguments in cases:
            with self.subTest(arguments):
                self.assert_rejected_locally(arguments, "工作区")
        self.assertFalse((self.sandbox / "elsewhere").exists())
        FakeZCode.requests = []
        result = self.call({"task_id": PREVIEW, "output_dir": "../elsewhere"}, tool="get_meshy_task")
        self.assertTrue(result["isError"])
        self.assertEqual(FakeZCode.requests, [])

    # ── waiting ──

    def test_still_running_returns_task_id_without_resubmitting(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [running()]

        result = self.call({"action": "generate", "prompt": "knight"}, wait_budget_ms=100)

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["task_id"], PREVIEW)
        self.assertEqual(result["structuredContent"]["status"], "running")
        self.assertIn("get_meshy_task", self.text(result))
        self.assertIn(PREVIEW, self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    def test_unknown_status_words_keep_polling(self):
        FakeZCode.script[QUERY] = [running(status="processing", upstream="WARMING_UP"), self.finished()]
        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 2)

    def succeeded_without_products(self, output):
        reply = self.finished()
        reply[1]["data"]["output"] = output
        return reply

    def test_succeeded_without_products_keeps_polling(self):
        # The status may flip to succeeded before the products are written: keep waiting instead of failing.
        empty = {"task_id": PREVIEW, "status": "SUCCEEDED", "model_urls": {}, "thumbnail_url": ""}
        # A thumbnail or other non-model links alone are not the product: the model is still missing.
        thumbnail_only = {**empty, "thumbnail_url": self.cdn("tasks/0193a1/output/preview.png")}
        non_model_result = {
            **thumbnail_only,
            "model_urls": {"glb": ""},
            "result": {"preview_image_url": self.cdn("tasks/0193a1/output/pose.png")},
        }
        for output in (None, [], "pending", empty, thumbnail_only, non_model_result):
            with self.subTest(output=output):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [self.succeeded_without_products(output), self.finished()]
                result = self.call({"action": "generate", "prompt": "knight", "output_dir": "out"})

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(len(self.requests_to(QUERY)), 2)
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)
                self.assertEqual(Path(result["structuredContent"]["files"][0]["path"]).read_bytes(), GLB)
                self.assertTrue(any("产物还在准备" in m["params"]["message"] for m in self.progress))
                shutil.rmtree(self.project / "out")

    def test_succeeded_with_models_only_in_result_completes_at_once(self):
        # Rig / animate products live in result: a model URL there completes the task even without model_urls,
        # whether the format shows in the link's extension or only in the key name.
        output = self.rig_output()
        output["model_urls"] = {}
        output["result"] = {
            "rigged_character_glb_url": self.cdn("rig/b/model.glb"),
            "rigged_character_fbx_url": self.cdn("rig/b/signed-download"),
        }
        FakeZCode.script[QUERY] = [self.finished(RIG, output)]
        result = self.call({"task_id": RIG, "output_dir": "rigged"}, tool="get_meshy_task")

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 1)
        self.assertEqual(result["structuredContent"]["status"], "succeeded")
        self.assertEqual(Path(result["structuredContent"]["files"][0]["path"]).name, "model.glb")

        output["result"] = {"rigged_character_fbx_url": self.cdn("rig/b/signed-download")}
        FakeZCode.requests = []
        FakeZCode.script[QUERY] = [self.finished(RIG, output)]
        result = self.call({"task_id": RIG}, tool="get_meshy_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 1)
        self.assertEqual(result["structuredContent"]["status"], "succeeded")

    def test_succeeded_without_products_until_the_budget_runs_out_returns_the_task_id(self):
        # The task already succeeded (and is billed): say so with a distinct status and a stop condition,
        # instead of "still running", so the Agent does not poll a finished task forever.
        for tool, arguments in [("submit_meshy_task", {"action": "generate", "prompt": "knight"}), ("get_meshy_task", {"task_id": PREVIEW})]:
            with self.subTest(tool=tool):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted()]
                FakeZCode.script[QUERY] = [self.succeeded_without_products(None)]
                result = self.call(arguments, tool=tool, wait_budget_ms=200)

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(result["structuredContent"]["status"], "succeeded_pending_products")
                self.assertEqual(result["structuredContent"]["task_id"], PREVIEW)
                text = self.text(result)
                self.assertIn(PREVIEW, text)
                self.assertIn("已成功（已按成功计费）", text)
                self.assertIn("get_meshy_task", text)
                self.assertIn("请停止查询，把 task_id 告诉用户", text)
                self.assertNotIn("还在进行", text)
                self.assertEqual(len(self.requests_to(SUBMIT)), 1 if tool == "submit_meshy_task" else 0)
                self.assertFalse((self.project / "generated-3d").exists())

        # A task that is merely running keeps the plain still-running answer.
        FakeZCode.script[QUERY] = [running()]
        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task", wait_budget_ms=200)
        self.assertEqual(result["structuredContent"]["status"], "running")
        self.assertNotIn("停止查询", self.text(result))

    def test_get_meshy_task_only_polls_and_survives_transient_errors(self):
        FakeZCode.script[QUERY] = [(500, {"code": 2007, "msg": "blip"}), (429, None), (502, "<html>bad gateway</html>"), self.finished()]

        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task")

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(SUBMIT), [])
        self.assertEqual(len(self.requests_to(QUERY)), 4)
        self.assertEqual(Path(result["structuredContent"]["files"][0]["path"]).read_bytes(), GLB)

    def test_failed_task_reports_the_failure_without_a_resubmit_hint(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [
            ok({"task_id": PREVIEW, "status": "failed", "upstream_status": "FAILED",
                "failure": {"code": "MESHY_TASK_FAILED", "message": "Prompt rejected by moderation"}})
        ]
        result = self.call({"action": "generate", "prompt": "knight"})

        self.assertTrue(result["isError"])
        text = self.text(result)
        self.assertIn("MESHY_TASK_FAILED", text)
        self.assertIn("Prompt rejected by moderation", text)
        self.assertIn("未扣费", text)
        self.assertIn(PREVIEW, text)
        self.assertNotIn("get_meshy_task", text)
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_unknown_task_is_terminal(self):
        FakeZCode.script[QUERY] = [(200, {"code": 3704, "msg": "TASK_NOT_FOUND", "logid": "log-44"})]
        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task")

        self.assertTrue(result["isError"])
        self.assertIn("log-44", self.text(result))
        self.assertNotIn("get_meshy_task", self.text(result))
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_query_failure_after_submit_keeps_the_task_id(self):
        for reply in [(401, None), (404, "<html>gateway</html>"), (200, "null"), (200, {"code": 3701, "msg": "down"})]:
            with self.subTest(reply=reply):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted(REMESH)]
                FakeZCode.script[QUERY] = [reply]
                result = self.call({"action": "remesh", "task_id": REFINE})

                self.assertTrue(result["isError"])
                self.assertIn(REMESH, self.text(result))
                self.assertIn("get_meshy_task", self.text(result))
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    # ── submit idempotency ──

    def test_uncertain_submits_replay_the_same_key(self):
        FakeZCode.script[SUBMIT] = [
            (500, {"code": 2007, "msg": "upstream"}),
            ok({"invocation_id": "inv-1", "state": "UNKNOWN"}),
            ok({"invocation_id": "inv-1", "state": "CALLING"}),
            replayed(REMESH),
        ]
        FakeZCode.script[QUERY] = [self.finished(REMESH)]

        result = self.call({"action": "remesh", "task_id": REFINE, "target_polycount": 100000})

        self.assertNotIn("isError", result, self.text(result))
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 4)
        self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)
        self.assertEqual(len({r["body"] for r in submits}), 1)
        self.assertEqual(json.loads(self.requests_to(QUERY)[0]["body"]), {"task_id": REMESH})
        self.assertFalse((self.data_dir / "pending").exists() and any((self.data_dir / "pending").iterdir()))

    def test_truncated_submit_body_is_replayed_and_handed_back(self):
        FakeZCode.script[SUBMIT] = [(200, TRUNCATED)]
        result = self.call({"action": "generate", "prompt": "knight"})

        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        self.assertGreater(len(submits), 1)
        key = submits[0]["headers"]["idempotency-key"]
        self.assertEqual({r["headers"]["idempotency-key"] for r in submits}, {key})
        self.assertIn(key, self.text(result))
        self.assertIn("request_id", self.text(result))

    def test_hard_error_after_an_uncertain_attempt_hands_back_request_id_and_persists_the_body(self):
        for second in [(401, None), (404, "<html>gateway</html>"), (200, {"code": 3701, "msg": "down"})]:
            with self.subTest(status=second):
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [(200, TRUNCATED), second]
                result = self.call({"action": "generate", "prompt": "knight"})

                self.assertTrue(result["isError"])
                first = self.requests_to(SUBMIT)[0]
                key = first["headers"]["idempotency-key"]
                self.assertIn(key, self.text(result))
                saved = self.data_dir / "pending" / f"{key}.json"
                self.assertTrue(saved.is_file())
                self.assertEqual(stat.S_IMODE(saved.stat().st_mode), 0o600)
                record = json.loads(saved.read_text())
                self.assertEqual(record["body"], json.loads(first["body"]))
                # Business arguments are kept only as per-field fingerprints, never request_id / output_dir or identity.
                self.assertEqual(set(record["args"]), {"action", "prompt"})
                self.assertTrue(all(re.fullmatch(r"[0-9a-f]{64}", value) for value in record["args"].values()))
                self.assertNotIn("Bearer", saved.read_text())

    def test_request_id_replay_reuses_the_persisted_body_verbatim(self):
        (self.project / "front.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/u/1.png"}), ok({"url": "https://oss.example/u/2.png"})]
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        result = self.call({"action": "generate", "images": ["front.png"], "pose_mode": "t-pose"})
        self.assertTrue(result["isError"])
        first = self.requests_to(SUBMIT)[0]
        key = first["headers"]["idempotency-key"]

        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [replayed("image:01a1")]
        FakeZCode.script[QUERY] = [self.finished("image:01a1")]
        result = self.call({"action": "generate", "images": ["front.png"], "pose_mode": "t-pose", "request_id": key})

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(UPLOAD), [])
        (replay,) = self.requests_to(SUBMIT)
        self.assertEqual(replay["headers"]["idempotency-key"], key)
        self.assertEqual(replay["body"], first["body"])
        self.assertNotIn("没有生效", self.text(result))
        self.assertFalse((self.data_dir / "pending" / f"{key}.json").exists())

    def replay_note_fields(self, text):
        match = re.search(r"本次修改的 (\S+) 没有生效", text)
        return match.group(1).split("、") if match else []

    def test_request_id_replay_reports_fields_that_did_not_take_effect(self):
        cases = [
            ({"action": "generate", "prompt": "knight"}, {"action": "generate", "prompt": "dragon"}, ["prompt"]),
            ({"action": "remesh", "task_id": REFINE}, {"action": "remesh", "task_id": PREVIEW}, ["task_id"]),
            ({"action": "remesh", "task_id": REFINE}, {"action": "convert", "task_id": REFINE, "formats": ["fbx"]}, ["action", "formats"]),
            (
                {"action": "retexture", "model_url": "https://a.example/m.glb", "texture_prompt": "gold"},
                {"action": "retexture", "model_url": "https://a.example/n.glb", "texture_prompt": "gold"},
                ["model_url"],
            ),
            # Arrays, texture fields and numbers are compared too, with a stable serialisation.
            (
                {"action": "generate", "images": ["https://a.example/1.png", "https://a.example/2.png"]},
                {"action": "generate", "images": ["https://a.example/1.png", "https://a.example/3.png"]},
                ["images"],
            ),
            (
                {"action": "retexture", "task_id": REFINE, "texture_prompt": "gold", "texture_image": "https://a.example/s.png"},
                {"action": "retexture", "task_id": REFINE, "texture_prompt": "silver", "texture_image": "https://a.example/t.png"},
                ["texture_prompt", "texture_image"],
            ),
            (
                {"action": "remesh", "task_id": REFINE, "target_polycount": 100000, "topology": "quad"},
                {"action": "remesh", "task_id": REFINE, "target_polycount": 200000},
                ["topology", "target_polycount"],
            ),
            (
                {"action": "animate", "task_id": RIG, "action_ids": [1, 2]},
                {"action": "animate", "task_id": RIG, "action_ids": [2, 1], "output_dir": "elsewhere"},
                ["action_ids"],
            ),
        ]
        for original, changed, fields in cases:
            with self.subTest(fields=fields):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
                self.assertTrue(self.call(original)["isError"])
                first = self.requests_to(SUBMIT)[0]
                key = first["headers"]["idempotency-key"]

                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [replayed(REMESH)]
                FakeZCode.script[QUERY] = [self.finished(REMESH)]
                result = self.call({**changed, "request_id": key})

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(self.requests_to(SUBMIT)[0]["body"], first["body"])
                self.assertEqual(self.replay_note_fields(self.text(result)), fields)

    def test_replay_note_ignores_spellings_the_validators_treat_as_equal(self):
        cases = [
            (
                {"action": "Generate", "images": ["HTTPS://A.Example/1.png"], "formats": ["GLB"], "pose_mode": "A-Pose"},
                {"action": "generate", "images": ["https://a.example/1.png"], "formats": [".glb", "glb"], "pose_mode": "a-pose",
                 "prompt": "  ", "output_dir": "elsewhere"},
            ),
            (
                {"action": "remesh", "task_id": REFINE, "target_polycount": "100000", "topology": "QUAD", "formats": ["fbx", "OBJ"]},
                {"action": "REMESH", "task_id": f"  {REFINE} ", "target_polycount": 100000, "topology": "quad", "formats": ["fbx", "obj"]},
            ),
            (
                {"action": "animate", "task_id": RIG, "action_ids": ["1", "2"]},
                {"action": "animate", "task_id": RIG, "action_ids": [1, 2], "formats": []},
            ),
            (
                {"action": "rig", "model_url": "https://A.example/m.glb", "height_meters": "1.80"},
                {"action": "rig", "model_url": "https://a.example:443/m.glb", "height_meters": 1.8},
            ),
        ]
        for original, same in cases:
            with self.subTest(original=original):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
                self.assertTrue(self.call(original)["isError"])
                key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]

                FakeZCode.script[SUBMIT] = [replayed(REMESH)]
                FakeZCode.script[QUERY] = [self.finished(REMESH)]
                result = self.call({**same, "request_id": key})
                self.assertNotIn("isError", result, self.text(result))
                self.assertNotIn("没有生效", self.text(result))

        # Meshy submits an explicit false, so dropping it on the replay is a real change and is still reported.
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        self.assertTrue(self.call({"action": "generate", "images": ["https://a.example/1.png"], "geometry_only": False})["isError"])
        key = self.requests_to(SUBMIT)[-1]["headers"]["idempotency-key"]
        FakeZCode.script[SUBMIT] = [replayed(REMESH)]
        FakeZCode.script[QUERY] = [self.finished(REMESH)]
        result = self.call({"action": "generate", "images": ["https://a.example/1.png"], "request_id": key})
        self.assertEqual(self.replay_note_fields(self.text(result)), ["geometry_only"])

    # A reply that the server accepted the key (the task may exist) and one that never reached a verdict.
    ACCEPTED = ok({"state": "UNKNOWN"})
    NOT_ACCEPTED = (500, {"code": 2007, "msg": "upstream timeout"})

    def unconfirmed_key(self, arguments=None, first=None):
        """Leave one unconfirmed submission behind and return its request_id."""
        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [first or self.ACCEPTED]
        self.assertTrue(self.call(arguments or {"action": "generate", "prompt": "knight"})["isError"])
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

        result = self.call({"action": "generate", "prompt": "knight", "request_id": key})

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
        result = self.call({"action": "generate", "prompt": "knight", "request_id": key})
        self.assertTrue(result["isError"])
        self.assertIn(f"request_id：{key}", self.text(result))
        self.assertEqual(self.pending_record(key)["createdAt"], created)

        # Once createdAt is more than 24 hours old the record is gone, however often it was rewritten.
        self.set_created_at(key, created - 2 * 60 * 60 * 1000)
        FakeZCode.requests = []
        result = self.call({"action": "generate", "prompt": "knight", "request_id": key})
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

    def test_definite_rejection_on_replay_drops_the_record_and_stops_replaying(self):
        # Only a key the server never accepted: every earlier attempt ended without a verdict (here 2007).
        for code in (3703, 3707):
            with self.subTest(code=code):
                key = self.unconfirmed_key(first=self.NOT_ACCEPTED)
                self.assertIs(self.pending_record(key)["accepted"], False)
                FakeZCode.script[SUBMIT] = [(200, {"code": code, "msg": "TASK_NOT_READY", "logid": f"log-{code}"})]
                result = self.call({"action": "generate", "prompt": "knight", "request_id": key})

                self.assertTrue(result["isError"])
                text = self.text(result)
                self.assertTrue(text.startswith(f"提交失败：{self.expected_code_text(code)}"), text)
                self.assertIn(f"log-{code}", text)
                self.assertIn(f"request_id {key} 没有创建任务，不要再用这个 request_id 重放", text)
                self.assertIn("不带 request_id 重新提交", text)
                self.assertIn("get_meshy_task 等前一步完成", text)
                # Not the "unconfirmed, replay with request_id" message.
                self.assertNotIn("提交未确认", text)
                self.assertNotIn("带上 request_id", text)
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)
                self.assertFalse((self.data_dir / "pending" / f"{key}.json").exists())

                # The dropped request_id cannot be replayed again.
                FakeZCode.requests = []
                result = self.call({"action": "generate", "prompt": "knight", "request_id": key})
                self.assertIn("找不到", self.text(result))
                self.assertEqual(FakeZCode.requests, [])

    def expected_code_text(self, code):
        return {3001: "请求参数不合法", 3703: "提交被拒绝", 3707: "参考图为空、过大或类型不支持"}[code]

    def test_definite_rejection_after_an_uncertain_attempt_in_the_same_call(self):
        FakeZCode.script[SUBMIT] = [self.NOT_ACCEPTED, (200, {"code": 3703, "msg": "MESHY_400", "logid": "log-r"})]
        result = self.call({"action": "rig", "task_id": REFINE})

        self.assertTrue(result["isError"])
        text = self.text(result)
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        self.assertEqual(len(self.requests_to(SUBMIT)), 2)
        self.assertIn("log-r", text)
        self.assertIn("remesh", text)  # the rig hint is kept
        self.assertIn(f"request_id {key} 没有创建任务", text)
        self.assertNotIn("提交未确认", text)
        self.assertFalse((self.data_dir / "pending").exists() and any((self.data_dir / "pending").iterdir()))

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
                result = self.call({"action": "generate", "prompt": "knight", "request_id": key})

                self.assertTrue(result["isError"])
                text = self.text(result)
                self.assertIn("提交未确认", text)
                self.assertIn(f"带上 request_id：{key}", text)
                self.assertNotIn("没有创建任务，不要再用", text)
                self.assertEqual(self.pending_record(key)["createdAt"], created)
                self.assertEqual({r["headers"]["idempotency-key"] for r in self.requests_to(SUBMIT)}, {key})

    def test_rejection_of_a_key_the_server_accepted_keeps_the_request_id_and_the_record(self):
        # Once the server accepted the key (UNKNOWN / CALLING / 3702 / an unreadable or oversized 2xx), a later 3703 or
        # 3707 (upstream rate limit, expired image link, ...) does not prove that the first attempt created no task.
        rejection = (200, {"code": 3703, "msg": "MESHY_RATE_LIMITED", "logid": "log-rl"})
        for first in [self.ACCEPTED, ok({"state": "CALLING"}), (200, {"code": 3702, "msg": "in flight"}), (200, TRUNCATED), (200, Big(2 * MIB))]:
            with self.subTest(first="oversized" if isinstance(first[1], Big) else first):
                # In the same call.
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [first, rejection]
                result = self.call({"action": "generate", "prompt": "knight"})
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
                result = self.call({"action": "generate", "prompt": "knight", "request_id": key})
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
        result = self.call({"action": "generate", "prompt": "knight", "request_id": key})
        self.assertIn(f"带上 request_id：{key}", self.text(result))
        self.assertIs(self.pending_record(key)["accepted"], True)

    def test_replay_that_ends_after_the_record_expired_does_not_renew_it(self):
        # The record is still fresh when the replay starts, but the slow submit only ends after its 24 hours:
        # it must not be rewritten with a new createdAt, and the Agent must not be promised another replay.
        key = self.unconfirmed_key()
        self.set_created_at(key, int((time.time() - 24 * 60 * 60 + 2) * 1000))
        FakeZCode.script[SUBMIT] = [(500, Slow(3, {"code": 2007, "msg": "upstream timeout"})), self.NOT_ACCEPTED]
        result = self.call({"action": "generate", "prompt": "knight", "request_id": key})

        self.assertTrue(result["isError"])
        text = self.text(result)
        self.assertGreater(len(self.requests_to(SUBMIT)), 1)
        self.assertIn(key, text)
        self.assertIn("超过 24 小时有效期", text)
        self.assertIn("由用户决定", text)
        self.assertFalse((self.data_dir / "pending" / f"{key}.json").exists())

    def test_accepted_submit_without_an_output_task_id(self):
        # Top-level task_id is accepted as is.
        FakeZCode.script[SUBMIT] = [ok({"invocation_id": "i", "state": "SUCCEEDED", "task_id": PREVIEW})]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"action": "generate", "prompt": "knight"})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)
        self.assertEqual(json.loads(self.requests_to(QUERY)[0]["body"]), {"task_id": PREVIEW})

        # A 2xx answer with no task_id anywhere may still have created the task: replay with the same key.
        for first in [ok({"invocation_id": "i", "state": "SUCCEEDED"}), ok(None), ok({"state": "WEIRD"})]:
            with self.subTest(first=first):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [first, replayed(PREVIEW)]
                FakeZCode.script[QUERY] = [self.finished()]
                result = self.call({"action": "generate", "prompt": "knight"})
                self.assertNotIn("isError", result, self.text(result))
                submits = self.requests_to(SUBMIT)
                self.assertEqual(len(submits), 2)
                self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)

        # If it never resolves, the key comes back as request_id and the body is kept for the replay.
        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [ok(None)]
        result = self.call({"action": "generate", "prompt": "knight"})
        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        key = submits[0]["headers"]["idempotency-key"]
        self.assertEqual({r["headers"]["idempotency-key"] for r in submits}, {key})
        self.assertIn("request_id", self.text(result))
        self.assertIn(key, self.text(result))
        self.assertTrue((self.data_dir / "pending" / f"{key}.json").is_file())

    def test_replay_without_the_saved_body_stops_instead_of_looping_on_3702(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        first = self.call({"action": "generate", "prompt": "knight"})
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        self.assertTrue(first["isError"])
        self.assertEqual(len(list((self.data_dir / "pending").iterdir())), 1)

        shutil.rmtree(self.data_dir)
        FakeZCode.requests = []
        result = self.call({"action": "generate", "prompt": "knight", "request_id": key})

        self.assertTrue(result["isError"])
        self.assertIn("找不到", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_submit_retries_stop_at_the_call_budget_and_hand_back_request_id(self):
        # A retry is only started while more than RETRY_DELAY + 100 ms of the call budget is left. With a budget of
        # exactly two delays a third attempt can never start, and the second one only needs the first answer within
        # 1.4 s, so the count does not depend on machine speed.
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        result = self.call(
            {"action": "generate", "prompt": "knight"},
            MESHY_3D_RETRY_DELAY_MS="1500",
            MESHY_3D_CALL_BUDGET_MS="3000",
        )
        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 2)
        self.assertIn(submits[0]["headers"]["idempotency-key"], self.text(result))

    def test_waiting_budget_counts_from_the_start_of_the_call(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"}), submitted(REMESH)]
        FakeZCode.script[QUERY] = [running(REMESH)]
        result = self.call(
            {"action": "remesh", "task_id": REFINE},
            wait_budget_ms=500,
            MESHY_3D_RETRY_DELAY_MS="600",
        )
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["task_id"], REMESH)
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    # ── server errors ──

    def test_rejected_submit_is_not_retried(self):
        FakeZCode.script[SUBMIT] = [(200, {"code": 3703, "msg": "MESHY_400", "logid": "log-3"})]
        result = self.call({"action": "rig", "task_id": REFINE})

        self.assertTrue(result["isError"])
        text = self.text(result)
        self.assertIn("log-3", text)
        self.assertIn("没有创建任务", text)
        self.assertIn("remesh", text)
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)
        self.assertEqual(self.requests_to(QUERY), [])
        self.assertNotIn("request_id", text)

    def test_forbidden_reads_the_envelope_first(self):
        cases = [
            ((403, {"code": 3101, "msg": "no coding plan", "logid": "log-31"}), ["Coding Plan", "3101", "log-31"]),
            ((403, {"code": 3706, "msg": "no zai account", "logid": "log-36"}), ["手机号", "log-36"]),
            ((403, None), ["没有使用 3D 建模的权限"]),
            ((403, "<html>forbidden</html>"), ["没有使用 3D 建模的权限"]),
        ]
        for reply, expected in cases:
            with self.subTest(reply=reply):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [reply]
                result = self.call({"action": "generate", "prompt": "knight"})
                self.assertTrue(result["isError"])
                for word in expected:
                    self.assertIn(word, self.text(result))
                self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    def test_missing_route_names_the_3d_endpoint(self):
        result = self.call({"action": "generate", "prompt": "knight"})
        self.assertTrue(result["isError"])
        self.assertIn("3D 接口未在 ZCode 服务端开放", self.text(result))

    def test_missing_coding_plan_fails_before_any_request(self):
        result = self.call({"action": "generate", "prompt": "knight"}, auth={"ok": False, "reason": "official_auth_plan_required"})

        self.assertTrue(result["isError"])
        self.assertIn("Coding Plan", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_redirect_is_refused(self):
        FakeZCode.script[SUBMIT] = [(302, None)]
        result = self.call({"action": "generate", "prompt": "knight"})

        self.assertTrue(result["isError"])
        self.assertIn("重定向", self.text(result))

    def test_non_https_remote_origin_is_refused(self):
        result = self.call({"action": "generate", "prompt": "knight"}, base_url="http://zcode.example")

        self.assertTrue(result["isError"])
        self.assertIn("https", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    # ── animation library ──

    def test_animation_library_lists_animations_without_polling(self):
        animations = [
            {"action_id": 0, "name": "Idle", "category": "DailyActions", "subcategory": "Idle", "preview_url": "https://x/0.gif"},
            {"action_id": 2, "name": "Wave", "category": "DailyActions"},
            {"action_id": 7, "name": "Walking"},
        ]
        FakeZCode.script[SUBMIT] = [
            (500, {"code": 2007, "msg": "blip"}),
            ok({"invocation_id": "inv-l", "state": "SUCCEEDED", "output": {"task_id": "lib:01a1", "animations": animations}}),
        ]

        result = self.call({"category": "DailyActions", "search": "  "}, tool="list_meshy_animations")

        self.assertNotIn("isError", result, self.text(result))
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 2)
        self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)
        self.assertEqual(json.loads(submits[0]["body"]), {"action": "animation_library", "category": "DailyActions"})
        self.assertEqual(submits[0]["headers"]["x-usage-scenario"], SCENARIO)
        self.assertEqual(self.requests_to(QUERY), [])
        text = self.text(result)
        self.assertIn("0  Idle  [DailyActions/Idle]", text)
        self.assertIn("2  Wave  [DailyActions]", text)
        self.assertIn("7  Walking", text)
        self.assertEqual(result["structuredContent"]["animations"], animations)
        self.assertEqual(result["structuredContent"]["total"], 3)

    def test_animation_library_uses_a_fresh_key_per_call(self):
        reply = ok({"state": "SUCCEEDED", "output": {"task_id": "lib:1", "animations": []}})
        keys = set()
        for _ in range(2):
            FakeZCode.requests = []
            FakeZCode.script[SUBMIT] = [reply]
            result = self.call({}, tool="list_meshy_animations")
            self.assertNotIn("isError", result, self.text(result))
            self.assertEqual(json.loads(self.requests_to(SUBMIT)[0]["body"]), {"action": "animation_library"})
            keys.add(self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"])
        self.assertEqual(len(keys), 2)

    def test_animation_library_replay_without_a_list_retries_with_a_new_key(self):
        animations = [{"action_id": 0, "name": "Idle"}]
        FakeZCode.script[SUBMIT] = [
            (200, TRUNCATED),
            ok({"invocation_id": "inv-l", "state": "SUCCEEDED", "replayed": True, "upstream_req_id": "lib:01a1"}),
            ok({"invocation_id": "inv-m", "state": "SUCCEEDED", "output": {"task_id": "lib:01a2", "animations": animations}}),
        ]

        result = self.call({}, tool="list_meshy_animations")

        self.assertNotIn("isError", result, self.text(result))
        keys = [r["headers"]["idempotency-key"] for r in self.requests_to(SUBMIT)]
        self.assertEqual(len(keys), 3)
        self.assertEqual(keys[0], keys[1])
        self.assertNotEqual(keys[1], keys[2])
        self.assertEqual(result["structuredContent"]["animations"], animations)
        self.assertEqual(self.requests_to(QUERY), [])

    def test_long_animation_library_is_truncated_in_text(self):
        animations = [{"action_id": i, "name": f"Move {i}", "category": "Fighting"} for i in range(250)]
        FakeZCode.script[SUBMIT] = [ok({"state": "SUCCEEDED", "task_id": "lib:1", "animations": animations})]

        result = self.call({}, tool="list_meshy_animations")

        self.assertNotIn("isError", result, self.text(result))
        text = self.text(result)
        self.assertIn("199  Move 199", text)
        self.assertNotIn("200  Move 200", text)
        self.assertIn("还有 50 个", text)
        self.assertIn("category", text)
        self.assertEqual(len(result["structuredContent"]["animations"]), 250)

    def test_animation_library_errors_are_reported(self):
        FakeZCode.script[SUBMIT] = [(200, {"code": 3701, "msg": "TOOL_DISABLED", "logid": "log-l"})]
        result = self.call({}, tool="list_meshy_animations")
        self.assertTrue(result["isError"])
        self.assertIn("log-l", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    # ── shared behaviours (kept in step with the hi3d-3d and hyper3d-3d tests) ──

    def test_unparsable_2xx_submit_is_replayed_with_the_same_key(self):
        FakeZCode.script[SUBMIT] = [(200, "null"), replayed(PREVIEW)]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"action": "generate", "prompt": "knight"})

        self.assertNotIn("isError", result, self.text(result))
        keys = [r["headers"]["idempotency-key"] for r in self.requests_to(SUBMIT)]
        self.assertEqual(len(keys), 2)
        self.assertEqual(len(set(keys)), 1)

    def test_replay_note_survives_an_error(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        self.assertTrue(self.call({"action": "remesh", "task_id": REFINE})["isError"])
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]

        result = self.call({"action": "remesh", "task_id": PREVIEW, "request_id": key})

        self.assertTrue(result["isError"])
        self.assertIn("本次修改的 task_id 没有生效", self.text(result))
        self.assertIn(key, self.text(result))

    def test_failed_upload_does_not_submit(self):
        (self.project / "front.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [(400, {"code": 3707, "msg": "bad type", "logid": "log-up"})]
        result = self.call({"action": "generate", "images": ["front.png"]})
        self.assertTrue(result["isError"])
        self.assertIn("log-up", self.text(result))
        self.assertIn("没有提交任务", self.text(result))
        self.assertEqual(self.requests_to(SUBMIT), [])

    def test_two_tasks_in_the_same_second_get_separate_default_folders(self):
        for _ in range(2):
            FakeZCode.script[QUERY] = [self.finished()]
            result = self.call({"task_id": PREVIEW}, tool="get_meshy_task")
            self.assertNotIn("isError", result, self.text(result))
        folders = sorted((self.project / "generated-3d").iterdir())
        self.assertEqual(len(folders), 2)
        for folder in folders:
            self.assertRegex(folder.name, r"^\d{8}-\d{6}-preview-model(-1)?$")
            self.assertEqual([p.name for p in folder.iterdir()], ["model.glb"])

    # ── review fixes: unknown arguments (CR-02) ──

    def test_unknown_or_misspelled_arguments_are_refused_before_auth_and_requests(self):
        cases = [
            ("submit_meshy_task", {"action": "remesh", "task_id": REFINE, "target_polycounts": 100000}, ["target_polycounts"]),
            ("submit_meshy_task", {"action": "generate", "images": ["https://a.example/1.png"], "geometry_onyl": True}, ["geometry_onyl"]),
            ("submit_meshy_task", {"action": "generate", "prompt": "x", "unknown_field": "dropped", "requestid": "k"}, ["unknown_field", "requestid"]),
            ("submit_meshy_task", {"action": "generate", "prompt": "x", "_meta": {}}, ["_meta"]),
            ("get_meshy_task", {"task_id": PREVIEW, "format": ["fbx"]}, ["format"]),
            ("list_meshy_animations", {"query": "walk"}, ["query"]),
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
        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task")
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
                result = self.call({"action": "generate", "prompt": "knight"}, auth=auth)
                self.assertTrue(result["isError"])
                self.assertIn(reason, self.text(result))
                self.assertNotIn("request_id", self.text(result))
                self.assertEqual(FakeZCode.requests, [])

    # ── review fixes: download redirects (CR-01) ──

    def redirect_case(self, location, hop="hop/model.glb"):
        output = self.model_output()
        output["model_urls"] = {"glb": self.cdn(hop)}
        FakeZCode.redirects = {f"/cdn/{hop}": location}
        FakeZCode.downloads = []
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
        shutil.rmtree(self.project / "out", ignore_errors=True)
        return self.call({"task_id": PREVIEW, "output_dir": "out"}, tool="get_meshy_task")

    def test_download_redirects_are_checked_hop_by_hop(self):
        port = self.httpd.server_address[1]
        refused = [
            "http://10.0.0.1/admin/model.glb",  # intranet, plain http
            "http://cdn.example/model.glb",  # remote, plain http
            f"http://0.0.0.0:{port}/cdn/a/model.glb",  # reaches this machine but is not an allowed loopback name
            f"http://127.0.0.2:{port}/cdn/a/model.glb",
            with_userinfo(f"http://127.0.0.1:{port}/cdn/a/model.glb"),  # credentials are never allowed
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
                self.assertEqual([d["path"].split("?")[0] for d in FakeZCode.downloads], ["/cdn/hop/model.glb"])
                self.assertFalse((self.project / "out").exists() and any((self.project / "out").iterdir()))

    def test_redirect_loop_and_overlong_chains_are_not_followed(self):
        result = self.redirect_case("/cdn/hop/model.glb")
        self.assertNotIn("isError", result, self.text(result))
        self.assertIsNone(result["structuredContent"]["files"][0]["path"])
        self.assertIn("跳转次数过多，未下载", self.text(result))
        self.assertIn(self.cdn("hop/model.glb"), self.text(result))
        # The first request plus at most five followed hops.
        self.assertEqual(len(FakeZCode.downloads), 6)

        # A chain of exactly five hops is still followed.
        output = self.model_output()
        output["model_urls"] = {"glb": self.cdn("h0/model.glb")}
        FakeZCode.redirects = {f"/cdn/h{i}/model.glb": f"/cdn/h{i + 1}/model.glb" for i in range(4)}
        FakeZCode.redirects["/cdn/h4/model.glb"] = "/cdn/final/model.glb"
        FakeZCode.downloads = []
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
        result = self.call({"task_id": PREVIEW, "output_dir": "chain"}, tool="get_meshy_task")
        self.assertEqual(Path(result["structuredContent"]["files"][0]["path"]).read_bytes(), GLB)
        self.assertEqual(len(FakeZCode.downloads), 6)

    def test_allowed_redirects_still_download_without_identity(self):
        port = self.httpd.server_address[1]
        # Relative and absolute hops to an allowed location (https in production; the loopback test CDN here).
        for location in ("/cdn/final/model.glb", f"http://127.0.0.1:{port}/cdn/final/model.glb?sig=2"):
            with self.subTest(location=location):
                result = self.redirect_case(location)
                self.assertNotIn("isError", result, self.text(result))
                (entry,) = result["structuredContent"]["files"]
                self.assertEqual(Path(entry["path"]).read_bytes(), GLB)
                self.assertEqual([d["path"].split("?")[0] for d in FakeZCode.downloads], ["/cdn/hop/model.glb", "/cdn/final/model.glb"])
                self.assert_clean_downloads()

    def test_redirect_to_a_missing_file_keeps_the_http_status(self):
        result = self.redirect_case("/cdn/missing/model.glb")
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
        remote = "https://assets.meshy.ai/x/model.glb"
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
        public = ["https://assets.meshy.ai/x/model.glb", "https://8.8.8.8/model.glb", "https://[2606:4700::1]/model.glb",
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
            ("https://assets.meshy.ai/x/model.glb", "https://cdn.example/y/model.glb", True),
            ("https://cdn.example/a/model.glb", "https://cdn.example/b/model.glb", True),
            ("https://assets.meshy.ai/x/model.glb", "https://10.0.0.1/model.glb", False),
            ("https://assets.meshy.ai/x/model.glb", "https://[::ffff:7f00:1]/model.glb", False),
            ("https://assets.meshy.ai/x/model.glb", "http://127.0.0.1:9/model.glb", False),
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
        strict = {"MESHY_3D_TEST_API_ORIGIN": "https://zcode.example"}
        for url in (self.cdn("first/model.glb"), f"https://127.0.0.1:{port}/cdn/first/model.glb",
                    "https://10.0.0.1/cdn/first/model.glb", "https://169.254.169.254/latest/meta-data/model.glb",
                    f"https://[::ffff:127.0.0.1]:{port}/cdn/first/model.glb", f"http://localhost:{port}/cdn/first/model.glb"):
            with self.subTest(url=url):
                output = self.model_output()
                output["model_urls"] = {"glb": url}
                FakeZCode.downloads = []
                FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
                shutil.rmtree(self.project / "out", ignore_errors=True)
                result = self.call({"task_id": PREVIEW, "output_dir": "out"}, tool="get_meshy_task", **strict)
                self.assertNotIn("isError", result, self.text(result))
                (entry,) = result["structuredContent"]["files"]
                self.assertIsNone(entry["path"])
                self.assertEqual(entry["url"], url)
                self.assertIn(f"链接不是 https，或指向本机、内网地址，未下载）：{url}", self.text(result))
                # No request reached the product link.
                self.assertEqual(FakeZCode.downloads, [])
                self.assertFalse((self.project / "out").exists() and any((self.project / "out").iterdir()))

        # A loopback value of the hook is ignored: the loopback API origin keeps development downloads working.
        output = self.model_output()
        output["model_urls"] = {"glb": self.cdn("first/model.glb")}
        FakeZCode.downloads = []
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
        result = self.call({"task_id": PREVIEW, "output_dir": "dev"}, tool="get_meshy_task",
                           MESHY_3D_TEST_API_ORIGIN=f"http://localhost:{port}")
        (entry,) = result["structuredContent"]["files"]
        self.assertEqual(Path(entry["path"]).read_bytes(), GLB, self.text(result))
        self.assertEqual([d["path"].split("?")[0] for d in FakeZCode.downloads], ["/cdn/first/model.glb"])
        self.assert_clean_downloads()

    def test_remote_https_links_cannot_redirect_into_this_machine(self):
        tls_env = self.tls()
        port = self.httpd.server_address[1]
        tls_port = self.httpsd.server_address[1]
        start = f"{self.tls_origin}/cdn/hop/model.glb"
        refused = [
            f"http://127.0.0.1:{port}/cdn/final/model.glb",  # CR-01: a local plain-http service
            f"http://localhost:{port}/cdn/final/model.glb",
            f"https://localhost:{tls_port}/cdn/final/model.glb",  # another origin on this machine
            "https://10.0.0.5/cdn/final/model.glb",
            "https://169.254.169.254/latest/meta-data/model.glb",
        ]
        for location in refused:
            with self.subTest(location=location):
                output = self.model_output()
                output["model_urls"] = {"glb": start}
                FakeZCode.redirects = {"/cdn/hop/model.glb": location}
                FakeZCode.downloads = []
                FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
                shutil.rmtree(self.project / "out", ignore_errors=True)
                result = self.call({"task_id": PREVIEW, "output_dir": "out"}, tool="get_meshy_task", **tls_env)
                self.assertNotIn("isError", result, self.text(result))
                (entry,) = result["structuredContent"]["files"]
                self.assertIsNone(entry["path"])
                self.assertEqual(entry["url"], start)
                self.assertIn(f"跳转到了不允许的位置，未下载）：{start}", self.text(result))
                # The https link was fetched; the hop was never requested.
                self.assertEqual([d["path"] for d in FakeZCode.downloads], ["/cdn/hop/model.glb"])
                self.assertFalse((self.project / "out").exists() and any((self.project / "out").iterdir()))

        # A same-origin hop on the https link is still followed (and proves the test certificate is trusted).
        output = self.model_output()
        output["model_urls"] = {"glb": start}
        FakeZCode.redirects = {"/cdn/hop/model.glb": "/cdn/final/model.glb"}
        FakeZCode.downloads = []
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
        result = self.call({"task_id": PREVIEW, "output_dir": "same"}, tool="get_meshy_task", **tls_env)
        (entry,) = result["structuredContent"]["files"]
        self.assertEqual(Path(entry["path"]).read_bytes(), GLB, self.text(result))
        self.assertEqual([d["path"] for d in FakeZCode.downloads], ["/cdn/hop/model.glb", "/cdn/final/model.glb"])
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
            env["MESHY_3D_TEST_API_ORIGIN"] = "https://zcode.example"
        if dns_hook is not None:
            env["MESHY_3D_TEST_DNS"] = json.dumps(dns_hook)

        def read_log():
            return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]

        return env, read_log

    def download_via(self, url, env, output_dir="out"):
        output = self.model_output()
        output["model_urls"] = {"glb": url}
        FakeZCode.downloads = []
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
        shutil.rmtree(self.project / output_dir, ignore_errors=True)
        result = self.call({"task_id": PREVIEW, "output_dir": output_dir}, tool="get_meshy_task", **env)
        self.assertNotIn("isError", result, self.text(result))
        return result

    def assert_refused(self, result, url, warning, output_dir="out"):
        (entry,) = result["structuredContent"]["files"]
        self.assertIsNone(entry["path"])
        self.assertEqual(entry["url"], url)
        self.assertIn(f"{warning}）：{url}", self.text(result))
        self.assertFalse((self.project / output_dir).exists() and any((self.project / output_dir).iterdir()))

    def test_product_hosts_that_resolve_to_private_addresses_are_refused_before_connecting(self):
        url = "https://cdn.meshy.test/a/model.glb"
        hop = "https://cdn-hop.meshy.test/b/model.glb"
        start = "https://8.8.8.8/a/model.glb"
        public = ["93.184.216.34", "2606:2800:220:1::248"]
        for address in ("10.0.0.1", "127.0.0.1", "::ffff:10.0.0.1", "169.254.169.254", "fd00::1", "::1", "not-an-ip"):
            # The resolver says public; the test map adds a private address, and any private address refuses the URL.
            with self.subTest(first_url_mapped_to=address):
                env, read_log = self.fake_net(answers={"cdn.meshy.test": public}, dns_hook={"cdn.meshy.test": [address]})
                result = self.download_via(url, env)
                self.assert_refused(result, url, "链接的域名解析到本机或内网地址，未下载")
                self.assertEqual([e for e in read_log() if "fetch" in e], [])
            with self.subTest(hop_mapped_to=address):
                env, read_log = self.fake_net(
                    routes={start: {"location": hop}}, answers={"cdn-hop.meshy.test": public},
                    dns_hook={"CDN-Hop.meshy.test.": address},  # host names are compared case-insensitively, without the final dot
                )
                result = self.download_via(start, env)
                self.assert_refused(result, start, "跳转目标的域名解析到本机或内网地址，未下载")
                # Only the first (public literal) URL was requested; the hop never was.
                self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], [start])
            self.assertEqual(FakeZCode.downloads, [])

        # The resolver itself returning any private address (even next to a public one) refuses too, as first URL and as hop.
        for answer in (["10.1.2.3"], ["93.184.216.34", "192.168.0.7"], ["::ffff:127.0.0.1"], ["64:ff9b::a00:1"]):
            with self.subTest(resolved=answer):
                env, read_log = self.fake_net(routes={start: {"location": hop}}, answers={"cdn.meshy.test": answer, "cdn-hop.meshy.test": answer})
                self.assert_refused(self.download_via(url, env), url, "链接的域名解析到本机或内网地址，未下载")
                self.assert_refused(self.download_via(start, env), start, "跳转目标的域名解析到本机或内网地址，未下载")
                self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], [start])
                lookups = [e for e in read_log() if "lookup" in e]
                self.assertEqual([e["lookup"] for e in lookups], ["cdn.meshy.test", "cdn-hop.meshy.test"])
                self.assertTrue(all(e["options"] == {"all": True, "verbatim": True} for e in lookups))

    def test_product_hosts_that_resolve_publicly_are_downloaded_hop_by_hop(self):
        url = "https://cdn.meshy.test/a/model.glb"
        hop = "https://cdn-hop.meshy.test/b/model.glb"
        env, read_log = self.fake_net(
            routes={url: {"location": hop}},
            answers={"cdn.meshy.test": ["93.184.216.34"], "cdn-hop.meshy.test": ["2606:2800:220:1::248", "8.8.8.8"]},
            dns_hook={"cdn.meshy.test": ["1.1.1.1"]},  # a public address in the test map changes nothing
        )
        result = self.download_via(url, env)
        (entry,) = result["structuredContent"]["files"]
        self.assertEqual(Path(entry["path"]).read_bytes(), b"glTF-fake-model", self.text(result))
        events = read_log()
        self.assertEqual([e.get("lookup") or e.get("fetch") for e in events], ["cdn.meshy.test", url, "cdn-hop.meshy.test", hop])
        for event in events:
            for header in IDENTITY_HEADERS:
                self.assertNotIn(header, event.get("headers", {}))

    def test_fake_ip_proxy_answers_are_downloaded_but_fake_ip_literals_are_not(self):
        # Clash / mihomo / Surge in TUN or fake-ip mode answer every name with 198.18.0.0/15 (and mihomo's
        # fdfe:dcba:9876::/64 for IPv6); refusing those would stop every download on such machines.
        url = "https://cdn.meshy.test/a/model.glb"
        hop = "https://cdn-hop.meshy.test/b/model.glb"
        for answer in (["198.18.0.5"], ["198.19.255.254"], ["198.18.0.23", "fdfe:dcba:9876::17"], ["FDFE:DCBA:9876:0:ffff::1"]):
            with self.subTest(resolved=answer):
                env, read_log = self.fake_net(routes={url: {"location": hop}}, answers={"cdn.meshy.test": answer, "cdn-hop.meshy.test": answer})
                result = self.download_via(url, env)
                (entry,) = result["structuredContent"]["files"]
                self.assertEqual(Path(entry["path"]).read_bytes(), b"glTF-fake-model", self.text(result))
                self.assertEqual([e.get("lookup") or e.get("fetch") for e in read_log()], ["cdn.meshy.test", url, "cdn-hop.meshy.test", hop])
        # The test map is a resolver answer too: a fake-ip address there does not refuse, and does not hide a private one.
        env, read_log = self.fake_net(answers={"cdn.meshy.test": ["93.184.216.34"]}, dns_hook={"cdn.meshy.test": ["198.18.0.5"]})
        self.assertIsNotNone(self.download_via(url, env)["structuredContent"]["files"][0]["path"])
        # Next to a private address, or just outside the fake-ip ranges, the name is still refused before connecting.
        for answer in (["198.18.0.5", "10.0.0.1"], ["fdfe:dcba:9876::17", "fd00::1"], ["fdfe:dcba:9876:1::1"], ["fdfe:dcba:9877::1"],
                       ["::ffff:198.18.0.5"]):
            with self.subTest(resolved=answer):
                env, read_log = self.fake_net(answers={"cdn.meshy.test": answer})
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
            ("https://nowhere.meshy.test/model.glb", {"nowhere.meshy.test": ["8.8.8.8"]}, "链接的域名无法解析，未下载"),
            ("https://inside.meshy.test/model.glb", {"inside.meshy.test": ["8.8.8.8"]}, "链接的域名解析到本机或内网地址，未下载"),
        ]
        for url, hook, warning in cases:
            with self.subTest(url=url):
                env, read_log = self.fake_net(answers={"inside.meshy.test": ["10.9.9.9"]}, dns_hook=hook)
                self.assert_refused(self.download_via(url, env), url, warning)
                self.assertEqual([e for e in read_log() if "fetch" in e], [])
        # Malformed hook values are ignored rather than loosening anything.
        for hook in ("not json", "[1, 2]", '"8.8.8.8"'):
            with self.subTest(hook=hook):
                env, read_log = self.fake_net(answers={"inside.meshy.test": ["10.9.9.9"]})
                env["MESHY_3D_TEST_DNS"] = hook
                url = "https://inside.meshy.test/model.glb"
                self.assert_refused(self.download_via(url, env), url, "链接的域名解析到本机或内网地址，未下载")

    def test_unresolvable_product_hosts_are_refused_and_literals_are_not_looked_up(self):
        url = "https://gone.meshy.test/model.glb"
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
        env, read_log = self.fake_net(strict=False, dns_hook={"localhost": ["10.0.0.1"], "127.0.0.1": ["10.0.0.1"], "cdn.meshy.test": ["10.0.0.1"]})
        for url in (self.cdn("dev/model.glb"), "https://cdn.meshy.test/dev/model.glb"):
            with self.subTest(url=url):
                result = self.download_via(url, env)
                (entry,) = result["structuredContent"]["files"]
                self.assertIsNotNone(entry["path"], self.text(result))
        self.assertEqual([e for e in read_log() if "lookup" in e], [])
        self.assertEqual([e["fetch"] for e in read_log() if "fetch" in e], ["https://cdn.meshy.test/dev/model.glb"])

    def test_a_hanging_lookup_respects_the_call_budget_and_cancellation(self):
        url = "https://slow.meshy.test/model.glb"
        env, read_log = self.fake_net(answers={"slow.meshy.test": "hang"})
        started = time.monotonic()
        result = self.download_via(url, {**env, "MESHY_3D_CALL_BUDGET_MS": "2500"})
        self.assertLess(time.monotonic() - started, 20)
        self.assert_refused(result, url, "下载失败（网络错误或超时）")
        self.assertEqual([e for e in read_log() if "fetch" in e], [])

        env, read_log = self.fake_net(answers={"slow.meshy.test": "hang"})
        output = self.model_output()
        output["model_urls"] = {"glb": url}
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
        proc = self.start_server(**env)
        proc.stdin.write(json.dumps(self.tool_call("get_meshy_task", {"task_id": PREVIEW, "output_dir": "out"})) + "\n")
        proc.stdin.flush()
        self.wait_for(lambda: any("lookup" in e for e in read_log()))
        self.cancel_and_finish(proc)
        self.assertEqual([e for e in read_log() if "fetch" in e], [])

    def test_http_is_never_downloaded_or_followed_outside_loopback_mode(self):
        # 283 SG-02: the development-mode leniency for http links must never apply with a non-loopback API origin.
        http_urls = ["http://8.8.8.8/model.glb", "http://cdn.example/model.glb", "http://assets.meshy.ai/x/model.glb",
                     "http://127.0.0.1:9/model.glb", "http://localhost:9/model.glb", "http://[::1]:9/model.glb",
                     "http://10.0.0.1/model.glb", "http://[2606:4700::1]/model.glb"]
        targets = ["https://cdn.example/b/model.glb", "https://8.8.8.8/b/model.glb", "https://assets.meshy.ai/b/model.glb"]
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
        for url in ("http://8.8.8.8/model.glb", "http://cdn.meshy.test/model.glb", self.cdn("prod/model.glb")):
            with self.subTest(url=url):
                self.assert_refused(self.download_via(url, env), url, "链接不是 https，或指向本机、内网地址，未下载")
        self.assert_refused(self.download_via(start, env), start, "跳转到了不允许的位置，未下载")
        self.assertEqual([e.get("fetch") for e in read_log()], [start])
        self.assertEqual(FakeZCode.downloads, [])

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
        output = self.model_output()
        output["model_urls"] = {
            "glb": self.cdn("x/CON.glb"),
            "fbx": self.cdn("x/a%3Ab.fbx"),
            "obj": self.cdn("x/tex(1)%20model%200.obj"),
        }
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
        result = self.call({"task_id": PREVIEW, "formats": ["glb", "fbx", "obj"], "output_dir": "out"}, tool="get_meshy_task")
        self.assertNotIn("isError", result, self.text(result))
        structured = result["structuredContent"]
        self.assertEqual([Path(f["path"]).name for f in structured["files"]], ["_CON.glb", "a_b.fbx", "tex(1) model 0.obj"])
        self.assertEqual(structured["renamed_files"], [
            {"key": "model_urls.glb", "from": "CON.glb", "to": "_CON.glb"},
            {"key": "model_urls.fbx", "from": "a:b.fbx", "to": "a_b.fbx"},
        ])
        self.assertIn("mtllib", structured["rename_warning"])
        text = self.text(result)
        self.assertIn("以下文件保存时改了名", text)
        self.assertIn('- "CON.glb" → "_CON.glb"', text)
        self.assertIn('- "a:b.fbx" → "a_b.fbx"', text)
        self.assertIn(structured["rename_warning"], text)
        self.assertNotIn('"tex(1) model 0.obj" →', text)

        # Nothing renamed: no warning at all.
        output["model_urls"] = {"glb": self.cdn("x/material%200.glb"), "obj": self.cdn("x/tex(1).obj")}
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
        result = self.call({"task_id": PREVIEW, "formats": ["glb", "obj"], "output_dir": "clean"}, tool="get_meshy_task")
        self.assertEqual([Path(f["path"]).name for f in result["structuredContent"]["files"]], ["material 0.glb", "tex(1).obj"])
        self.assertNotIn("renamed_files", result["structuredContent"])
        self.assertNotIn("rename_warning", result["structuredContent"])
        self.assertNotIn("改了名", self.text(result))

    def test_an_appended_extension_alone_is_not_reported_as_a_rename(self):
        # An extension-less model_urls link is saved as `<name>.<format>`; that alone is not a rename. If the name is
        # also unsafe or clashes, the report shows the appended extension on both sides.
        env, _ = self.fake_net(answers={"assets.meshy.test": ["93.184.216.34"]})
        output = self.model_output()
        output["model_urls"] = {"glb": "https://assets.meshy.test/x/model?Expires=1", "fbx": "https://assets.meshy.test/x/CON?Expires=1"}
        cases = [
            (["glb"], "ext", {}, ["model.glb"], None),
            (["glb", "fbx"], "ext2", {"model.glb": b"x"}, ["model-1.glb", "_CON.fbx"], [
                {"key": "model_urls.glb", "from": "model.glb", "to": "model-1.glb"},
                {"key": "model_urls.fbx", "from": "CON.fbx", "to": "_CON.fbx"},
            ]),
        ]
        for formats, output_dir, existing, names, renamed in cases:
            with self.subTest(formats=formats):
                (self.project / output_dir).mkdir()
                for name, data in existing.items():
                    (self.project / output_dir / name).write_bytes(data)
                FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
                result = self.call({"task_id": PREVIEW, "formats": formats, "output_dir": output_dir}, tool="get_meshy_task", **env)
                structured = result["structuredContent"]
                self.assertEqual([Path(f["path"]).name for f in structured["files"]], names, self.text(result))
                if renamed is None:
                    self.assertNotIn("renamed_files", structured)
                    self.assertNotIn("改了名", self.text(result))
                else:
                    self.assertEqual(structured["renamed_files"], renamed)
                    self.assertIn('- "model.glb" → "model-1.glb"', self.text(result))

    # ── review fixes: API response cap (SG-06) ──

    def test_oversized_submit_response_is_treated_as_unconfirmed(self):
        for with_length in (False, True):
            with self.subTest(content_length=with_length):
                FakeZCode.requests = []
                shutil.rmtree(self.data_dir, ignore_errors=True)
                FakeZCode.script[SUBMIT] = [(200, Big(3 * MIB, with_length))]
                result = self.call({"action": "generate", "prompt": "knight"})
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
        FakeZCode.script[SUBMIT] = [replayed(PREVIEW)]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"action": "generate", "prompt": "knight", "request_id": key})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"], key)

    def test_oversized_query_upload_and_library_responses_are_clear_errors(self):
        FakeZCode.script[QUERY] = [(200, Big(2 * MIB))]
        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task")
        self.assertTrue(result["isError"])
        self.assertIn("服务端响应过大（超过 1 MiB）", self.text(result))
        self.assertIn(PREVIEW, self.text(result))
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
        result = self.call({}, tool="list_meshy_animations")
        self.assertTrue(result["isError"])
        self.assertIn("服务端响应过大", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    def test_normal_responses_just_under_the_cap_are_still_read(self):
        animations = [{"action_id": i, "name": "n" * 900} for i in range(1000)]
        self.assertLess(len(json.dumps(animations)), MIB - 1024)
        FakeZCode.script[SUBMIT] = [ok({"state": "SUCCEEDED", "output": {"task_id": "lib:1", "animations": animations}})]
        result = self.call({}, tool="list_meshy_animations")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["total"], 1000)

    # ── review fixes: request_id replay snapshot (SG-04) ──

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
        FakeZCode.script[SUBMIT] = [replayed("image:01a1")]
        FakeZCode.script[QUERY] = [self.finished("image:01a1")]
        result = self.call({"action": "generate", "images": ["other.png"], "geometry_only": True, "request_id": key})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(UPLOAD), [])
        self.assertEqual(self.replay_note_fields(self.text(result)), ["images", "geometry_only"])
        self.assertIn("https://oss.example/u/1.png", self.text(result))

    # ── review fixes: explicit formats (SG-03) ──

    def test_explicit_formats_that_are_missing_are_reported_not_replaced(self):
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": PREVIEW, "formats": ["stl"], "output_dir": "out"}, tool="get_meshy_task")
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["files"], [])
        self.assertEqual(result["structuredContent"]["missing_formats"], ["stl"])
        self.assertEqual(FakeZCode.downloads, [])
        text = self.text(result)
        self.assertIn("请求的格式 stl 没有返回，未下载", text)
        self.assertIn("glb / fbx / obj / usdz", text)
        for name in ("model.glb", "model.fbx", "model.obj", "model.usdz"):
            self.assertIn(name, text)
        self.assertFalse((self.project / "out").exists() and any((self.project / "out").iterdir()))

        # Partly available: download what exists and name what is missing.
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"task_id": PREVIEW, "formats": ["fbx", "3mf"], "output_dir": "out2"}, tool="get_meshy_task")
        saved = [Path(f["path"]).name for f in result["structuredContent"]["files"] if f["path"]]
        self.assertEqual(saved, ["model.fbx"])
        self.assertIn("请求的格式 3mf 没有返回", self.text(result))

    def test_without_formats_the_default_falls_back_to_the_first_available(self):
        output = self.model_output()
        del output["model_urls"]["glb"]
        FakeZCode.script[QUERY] = [self.finished(PREVIEW, output)]
        result = self.call({"task_id": PREVIEW}, tool="get_meshy_task")
        self.assertNotIn("isError", result, self.text(result))
        saved = [Path(f["path"]).name for f in result["structuredContent"]["files"] if f["path"]]
        self.assertEqual(saved, ["model.fbx"])
        self.assertNotIn("missing_formats", result["structuredContent"])
        self.assertNotIn("没有返回", self.text(result))

    def test_replayed_generate_keeps_the_submitted_formats_for_downloading(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        self.assertTrue(self.call({"action": "generate", "prompt": "knight", "formats": ["fbx"]})["isError"])
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [replayed(PREVIEW)]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"action": "generate", "prompt": "knight", "formats": ["fbx"], "request_id": key})
        saved = [Path(f["path"]).name for f in result["structuredContent"]["files"] if f["path"]]
        self.assertEqual(saved, ["model.fbx"])

    def test_replay_with_changed_formats_downloads_what_the_note_says(self):
        # generate / remesh / convert submit formats: a replay downloads by the first submission's formats, so the
        # "formats did not take effect" note is true and formats never submitted are not reported as missing.
        cases = [
            ({"action": "generate", "prompt": "knight", "formats": ["glb"]}, {"formats": ["fbx"]}, ["model.glb"]),
            ({"action": "generate", "prompt": "knight"}, {"formats": ["stl"]}, ["model.glb"]),
            ({"action": "remesh", "task_id": REFINE, "formats": ["fbx"]}, {"formats": None}, ["model.fbx"]),
            ({"action": "convert", "task_id": REFINE, "formats": ["obj"]}, {"formats": ["3mf"]}, ["model.obj"]),
        ]
        for original, change, saved_names in cases:
            with self.subTest(original=original, change=change):
                FakeZCode.requests = []
                FakeZCode.downloads = []
                FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
                self.assertTrue(self.call(original)["isError"])
                first = self.requests_to(SUBMIT)[0]
                key = first["headers"]["idempotency-key"]

                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [replayed(REMESH)]
                FakeZCode.script[QUERY] = [self.finished(REMESH)]
                replay = {k: v for k, v in {**original, **change}.items() if v is not None}
                result = self.call({**replay, "request_id": key})

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(self.requests_to(SUBMIT)[0]["body"], first["body"])
                self.assertEqual(self.replay_note_fields(self.text(result)), ["formats"])
                saved = [Path(f["path"]).name for f in result["structuredContent"]["files"] if f["path"]]
                self.assertEqual(saved, saved_names)
                self.assertNotIn("missing_formats", result["structuredContent"])
                self.assertNotIn("没有返回", self.text(result))

    def test_replay_of_a_download_only_formats_action_uses_the_formats_passed_now(self):
        # refine does not submit formats and the first call's download choice is not stored, so an unchanged replay
        # must still download the formats passed on the replay.
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        self.assertTrue(self.call({"action": "refine", "task_id": PREVIEW, "formats": ["fbx"]})["isError"])
        first = self.requests_to(SUBMIT)[0]
        self.assertNotIn("formats", json.loads(first["body"]))
        key = first["headers"]["idempotency-key"]
        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [replayed(REFINE)]
        FakeZCode.script[QUERY] = [self.finished(REFINE)]
        result = self.call({"action": "refine", "task_id": PREVIEW, "formats": ["fbx"], "request_id": key})
        self.assertNotIn("isError", result, self.text(result))
        self.assertNotIn("没有生效", self.text(result))
        saved = [Path(f["path"]).name for f in result["structuredContent"]["files"] if f["path"]]
        self.assertEqual(saved, ["model.fbx"])

    # ── review fixes: MCP protocol (SG-05) ──

    def test_tool_call_without_an_id_is_not_executed(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]
        for message in (self.tool_call("submit_meshy_task", {"action": "generate", "prompt": "knight"}, None),
                        {**self.tool_call("list_meshy_animations", {}, None), "id": None}):
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
        FakeZCode.script[QUERY] = [running()]
        proc = self.start_server(MESHY_3D_POLL_INTERVAL_MS="5000", MESHY_3D_WAIT_BUDGET_MS="60000")
        proc.stdin.write(json.dumps(self.tool_call("submit_meshy_task", {"action": "generate", "prompt": "knight"})) + "\n")
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
        proc.stdin.write(json.dumps(self.tool_call("get_meshy_task", {"task_id": PREVIEW})) + "\n")
        proc.stdin.flush()
        self.wait_for(lambda: self.requests_to(QUERY))
        self.cancel_and_finish(proc)
        self.assertEqual(len(self.requests_to(QUERY)), 1)
        self.assertEqual(FakeZCode.downloads, [])
        self.assertFalse((self.project / "generated-3d").exists())

    def test_cancelled_submit_retry_is_not_sent_and_cancel_for_other_ids_is_ignored(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        proc = self.start_server(MESHY_3D_RETRY_DELAY_MS="5000")
        proc.stdin.write(json.dumps(self.tool_call("submit_meshy_task", {"action": "generate", "prompt": "knight"})) + "\n")
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 99}}) + "\n")
        proc.stdin.flush()
        self.wait_for(lambda: self.requests_to(SUBMIT))
        self.cancel_and_finish(proc)
        time.sleep(0.3)
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    # ── review fixes: documentation (SG-01, SG-07) ──

    def test_docs_match_the_refine_contract_and_the_pending_file_permissions(self):
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        readme_cn = (PLUGIN / "README_CN.md").read_text(encoding="utf-8")
        skill = (PLUGIN / "skills" / "meshy-3d" / "SKILL.md").read_text(encoding="utf-8")
        def refine_row(text):
            (row,) = [line for line in text.splitlines() if line.startswith("| `refine`")]
            return row.split("|")

        # README tables: | action | what | required | optional | — texture inputs are optional for refine.
        for text in (readme, readme_cn):
            cells = refine_row(text)
            self.assertNotIn("texture_prompt", cells[3])
            self.assertIn("texture_prompt", cells[4])
            self.assertIn("texture_image", cells[4])
        self.assertIn("optional `texture_prompt`", refine_row(skill)[3])
        self.assertNotIn("readable only by the current user", readme)
        self.assertNotIn("仅当前用户可读", readme_cn)
        self.assertIn("Windows", readme)
        self.assertIn("Windows", readme_cn)
        self.assertIn("0600", readme)
        self.assertIn("0600", readme_cn)

    def test_unsaved_pending_record_is_reported_instead_of_promising_a_replay(self):
        # 插件数据目录不可写时，request_id 照样交回，但要明确告诉 Agent 重放会被拒绝，由用户决定。
        self.data_dir.write_text("not a directory")
        FakeZCode.script[SUBMIT] = [(200, TRUNCATED), (401, None)]
        result = self.call({"action": "generate", "prompt": "knight"})

        self.assertTrue(result["isError"])
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        text = self.text(result)
        self.assertIn(key, text)
        self.assertIn("没能保存", text)
        self.assertIn("由用户决定", text)
        self.assertTrue(self.data_dir.is_file())


class MeshyManifestTest(unittest.TestCase):
    def manifest(self):
        return json.loads((PLUGIN / ".zcode-plugin" / "plugin.json").read_text(encoding="utf-8"))

    @unittest.skipUnless(shutil.which("node"), "node is required to run the MCP server")
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
        manifest = self.manifest()
        self.assertEqual(manifest["name"], "meshy-3d")
        self.assertEqual(list(manifest["mcpServers"]), ["meshy_3d"])
        server = manifest["mcpServers"]["meshy_3d"]
        self.assertEqual(server["type"], "stdio")
        self.assertEqual(server["command"], "node")
        self.assertEqual(server["args"], ["${ZCODE_PLUGIN_ROOT}/mcp/server.mjs"])
        self.assertEqual(server["cwd"], "${ZCODE_PROJECT_DIR}")
        self.assertEqual(server["timeoutMs"], 330000)
        self.assertEqual(server["auth"], {"type": "zcode_official", "provider": "jwt_token"})
        self.assertNotIn("env", server, "identity must come from _meta, never from static env")

    def test_versions_agree(self):
        version = self.manifest()["version"]
        package = json.loads((PLUGIN / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["name"], "@zcode/meshy-3d-plugin")
        self.assertEqual(package["version"], version)
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn(f'const SERVER_VERSION = "{version}";', source)
        self.assertIn('const SERVER_NAME = "meshy-3d";', source)
        self.assertIn('const USAGE_SCENARIO = "meshy_model3d";', source)

    def test_marketplace_entry_agrees_with_the_manifest(self):
        marketplace = json.loads((ROOT / "marketplace.json").read_text(encoding="utf-8"))
        # Look the entry up by name: other plugins are appended independently, so its position is not fixed.
        entries = [item for item in marketplace["plugins"] if item.get("name") == "meshy-3d"]
        self.assertEqual(len(entries), 1, "marketplace.json must contain exactly one meshy-3d entry")
        (entry,) = entries
        manifest = self.manifest()
        self.assertEqual(entry["source"], "./plugins/meshy-3d")
        self.assertEqual(entry["version"], manifest["version"])
        self.assertEqual(entry["description"], manifest["description"])
        self.assertEqual(entry["description_i18n"], manifest["description_i18n"])
        self.assertEqual(entry["category"], "游戏/3D")
        self.assertIs(entry["requiresPaidPlan"], True)
        self.assertEqual(entry["displayName_i18n"], {"en": "Meshy", "zh-CN": "Meshy"})
        self.assertEqual(entry["icon"], "https://cdn-zcode.z.ai/zcode/official-plugin/assets/meshy-3d/icon.png")
        self.assertTrue((ROOT / "assets" / "meshy-3d" / "icon.png").is_file())
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

    def test_skill_frontmatter(self):
        text = (PLUGIN / "skills" / "meshy-3d" / "SKILL.md").read_text(encoding="utf-8")
        match = re.match(r"^---\nname: (.+)\ndescription: (.+)\n---\n", text)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), "meshy-3d")
        for word in ["submit_meshy_task", "get_meshy_task", "list_meshy_animations", "remesh", "request_id", "Coding Plan"]:
            self.assertIn(word, text)

    def test_plugin_files_do_not_leak_internal_endpoints_or_tokens(self):
        allowed_hosts = {"z.ai", "json.schemastore.org"}
        for path in PLUGIN.rglob("*"):
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8")
            rel = path.relative_to(ROOT)
            for word in ("toolhubapi", "autoglm", "Bearer "):
                self.assertNotIn(word.lower(), text.lower(), f"{rel} mentions {word}")
            for host in re.findall(r"https?://([A-Za-z0-9.-]+\.[A-Za-z]{2,})", text):
                self.assertIn(host, allowed_hosts, f"{rel} mentions host {host}")


    def test_submit_timeout_covers_the_toolhub_runtime_timeout(self):
        # 接入文档建议 meshy_model3d 服务端超时 120s；插件放宽 10%，且必须留在单次调用 320s 预算内。
        source = SERVER.read_text(encoding="utf-8")
        submit_ms = int(re.search(r"const SUBMIT_TIMEOUT_MS = ([0-9_]+);", source).group(1).replace("_", ""))
        self.assertEqual(submit_ms, 132_000)
        self.assertGreaterEqual(submit_ms * 10, 120_000 * 11)
        self.assertLess(submit_ms, 320_000)


    def test_text_only_requests_are_routed_through_seedream(self):
        # 3D 厂商的方案是 文字 → 图片 → 3D：SKILL、README 和提交工具说明都要引导先用 Seedream 生图。
        skill = (PLUGIN / "skills" / "meshy-3d" / "SKILL.md").read_text(encoding="utf-8")
        for word in ("text → image → 3D", "`image-generation`", "`generate_image`", "do not call each other"):
            self.assertIn(word, skill)
        self.assertIn("Seedream", (PLUGIN / "README.md").read_text(encoding="utf-8"))
        self.assertIn("Seedream", (PLUGIN / "README_CN.md").read_text(encoding="utf-8"))
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn("image-generation 插件的 generate_image", source)

    def test_user_is_told_before_the_separately_billed_seedream_step(self):
        # SG-02: Seedream is a second, separately billed call. The Agent says so first; if the user declines (or asked
        # for text only) it submits the text as `prompt` directly.
        skill = (PLUGIN / "skills" / "meshy-3d" / "SKILL.md").read_text(encoding="utf-8")
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
        skill = (PLUGIN / "skills" / "meshy-3d" / "SKILL.md").read_text(encoding="utf-8")
        for text in (readme, readme_cn, skill):
            self.assertIn("generated-3d/<YYYYMMDD-HHMMSS>-<action", text)
            self.assertIn("-<slug>/", text)
            self.assertNotIn("-<action>-<description>/", text)
            self.assertNotIn("<类型>-<描述>", text)
            self.assertIn("`get_meshy_task`", text)
            self.assertIn("`null`", text)
        self.assertIn("<action or task kind>", readme)
        self.assertIn("<action 或任务种类>", readme_cn)
        self.assertIn("only present on the submitting call", readme)
        self.assertIn("只在提交的那次调用", readme_cn)
        # The code builds the folder from the action (submit) or the task kind (get), and the slug from the prompt.
        source = SERVER.read_text(encoding="utf-8")
        self.assertIn("outputTarget(outputDir, action ?? kind, slugSource)", source)
        self.assertIn("slugSource: body.prompt", source)

    def test_skill_stops_replaying_a_request_id_that_stays_unconfirmed(self):
        skill = (PLUGIN / "skills" / "meshy-3d" / "SKILL.md").read_text(encoding="utf-8")
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
        self.assertIn("Stop waiting after about 15 minutes of `get_meshy_task` calls", waiting)
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
        # charCount / integerArg are not used by every sibling plugin, so they live in the Meshy section.
        core = source[source.index("// ════════ 共享核心："):source.index("// ════════ 共享核心结束")]
        meshy = source[source.index("// ════════ Meshy 专属："):source.index("// ════════ 共享核心：")]
        for helper in ("charCount", "integerArg"):
            self.assertNotIn(f"function {helper}(", core)
            self.assertIn(f"function {helper}(", meshy)



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
