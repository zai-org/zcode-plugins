"""Behavioural contract for the video-generation plugin.

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
PLUGIN = ROOT / "plugins" / "video-generation"
SERVER = PLUGIN / "mcp" / "server.mjs"
AUTH_KEY = "com.zcode/official-mcp-auth"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JWT = "Bearer test-zcode-jwt"
SUBMIT = "/api/v1/toolhub/tool/video_generate/invoke"
QUERY = "/api/v1/toolhub/tool/video_generate/tasks/query"
UPLOAD = "/api/v1/toolhub/files"
TRUNCATED = object()


class FakeZCode(BaseHTTPRequestHandler):
    """Records every request; `script` maps a path to a queue of (status, body) replies."""

    requests: list[dict] = []
    script: dict[str, list[tuple[int, object]]] = {}

    def log_message(self, *_args):  # keep test output quiet
        pass

    def do_GET(self):
        if self.path == "/clip.mp4":
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.end_headers()
            self.wfile.write(MP4)
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
        self.send_header("Content-Type", "text/html" if isinstance(payload, str) else "application/json")
        self.end_headers()
        if isinstance(payload, str):
            self.wfile.write(payload.encode())
        elif payload is not None:
            self.wfile.write(json.dumps(payload).encode())


def ok(data):
    return (200, {"code": 0, "data": data})


def submitted(task_id="cgt-1"):
    return ok({"invocation_id": "inv-1", "state": "SUCCEEDED", "output": {"task_id": task_id}})


def running(task_id="cgt-1"):
    return ok({"task_id": task_id, "status": "running"})


@unittest.skipUnless(shutil.which("node"), "node is required to run the MCP server")
class VideoGenerationServerTest(unittest.TestCase):
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
        self.data_dir = self.sandbox / "plugin-data"

    def finished(self, task_id="cgt-1"):
        return ok({"task_id": task_id, "status": "succeeded", "output": {"video_url": f"{self.origin}/clip.mp4"}})

    def call(self, arguments, tool="generate_video", auth=None, base_url=None, wait_budget_ms=2_000, **extra_env):
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
        env = {
            **os.environ,
            "ZCODE_BASE_URL": base_url or self.origin,
            "ZCODE_PROJECT_DIR": str(self.project),
            "ZCODE_PLUGIN_DATA": str(self.data_dir),
            "VIDEO_GENERATION_RETRY_DELAY_MS": "10",
            "VIDEO_GENERATION_POLL_INTERVAL_MS": "10",
            "VIDEO_GENERATION_WAIT_BUDGET_MS": str(wait_budget_ms),
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
        lines = list(map(json.loads, proc.stdout.splitlines()))
        self.progress = [m for m in lines if m.get("method") == "notifications/progress"]
        replies = {r["id"]: r for r in lines if "id" in r}
        self.assertEqual(
            [t["name"] for t in replies[2]["result"]["tools"]], ["generate_video", "get_video_result"]
        )
        return replies[3]["result"]

    def text(self, result):
        return result["content"][0]["text"]

    def requests_to(self, path):
        return [r for r in FakeZCode.requests if r["path"] == path]

    def test_text_to_video_submits_polls_and_saves_file(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [ok({"task_id": "cgt-1", "status": "queued"}), running(), self.finished()]

        result = self.call({"prompt": "一只卡通小鸟飞过"})

        self.assertNotIn("isError", result, self.text(result))
        (submit,) = self.requests_to(SUBMIT)
        self.assertEqual(submit["headers"]["authorization"], JWT)
        self.assertTrue(submit["headers"]["idempotency-key"])
        self.assertEqual(json.loads(submit["body"]), {"query": "一只卡通小鸟飞过"})
        queries = self.requests_to(QUERY)
        self.assertEqual(len(queries), 3)
        for query in queries:
            self.assertEqual(json.loads(query["body"]), {"task_id": "cgt-1"})
            self.assertNotIn("idempotency-key", query["headers"])
        saved = Path(result["structuredContent"]["path"])
        self.assertEqual(saved.parent, self.project / "generated-videos")
        self.assertEqual(saved.suffix, ".mp4")
        self.assertEqual(saved.read_bytes(), MP4)
        self.assertEqual(len(self.progress), 2)
        self.assertEqual(self.progress[0]["params"]["progressToken"], "p-1")

    def test_local_images_are_uploaded_and_remote_materials_pass_through(self):
        (self.project / "ref.png").write_bytes(PNG)
        (self.project / "voice.mp3").write_bytes(b"ID3fake")
        uploaded = "https://oss.example/toolhub/ref.png?sig=1"
        FakeZCode.script[UPLOAD] = [ok({"url": uploaded})]
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call(
            {
                "prompt": "让它动起来",
                "images": ["ref.png", "https://cdn.example/b.png"],
                "videos": ["asset://video-1"],
                "audios": ["voice.mp3"],
                "output_path": "out/clip.mp4",
            }
        )

        self.assertNotIn("isError", result, self.text(result))
        (upload,) = self.requests_to(UPLOAD)
        self.assertIn("multipart/form-data", upload["headers"]["content-type"])
        self.assertIn(PNG, upload["body"])
        body = json.loads(self.requests_to(SUBMIT)[0]["body"])
        self.assertEqual(body["images"], [uploaded, "https://cdn.example/b.png"])
        self.assertEqual(body["videos"], ["asset://video-1"])
        self.assertEqual(body["audios"], ["data:audio/mpeg;base64,SUQzZmFrZQ=="])
        self.assertEqual((self.project / "out" / "clip.mp4").read_bytes(), MP4)

    def test_first_and_last_frame(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"prompt": "过渡", "first_frame": "https://a/1.png", "last_frame": "https://a/2.png"})

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(
            json.loads(self.requests_to(SUBMIT)[0]["body"]),
            {"query": "过渡", "first_frame": "https://a/1.png", "last_frame": "https://a/2.png"},
        )

    def test_duration_and_ratio_pass_through(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"prompt": "竖屏短片", "duration": 8, "ratio": "9:16"})

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(
            json.loads(self.requests_to(SUBMIT)[0]["body"]),
            {"query": "竖屏短片", "duration": 8, "ratio": "9:16"},
        )

    def test_model_chosen_duration_and_adaptive_first_frame(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]

        result = self.call({"prompt": "动起来", "duration": "-1", "ratio": "ADAPTIVE", "first_frame": "https://a/1.png"})

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(
            json.loads(self.requests_to(SUBMIT)[0]["body"]),
            {"query": "动起来", "duration": -1, "ratio": "adaptive", "first_frame": "https://a/1.png"},
        )

    def test_invalid_duration_or_ratio_fail_before_any_request(self):
        cases = [
            ({"prompt": "x", "duration": 3}, "duration"),
            ({"prompt": "x", "duration": 31}, "duration"),
            ({"prompt": "x", "duration": 5.5}, "duration"),
            ({"prompt": "x", "ratio": "3:2"}, "ratio"),
            ({"prompt": "x", "ratio": "16:9", "first_frame": "https://a/1.png"}, "adaptive"),
        ]
        for arguments, expected in cases:
            with self.subTest(arguments=arguments):
                result = self.call(arguments)
                self.assertTrue(result["isError"])
                self.assertIn(expected, self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_invalid_material_combinations_fail_before_any_request(self):
        cases = [
            ({"prompt": "x", "last_frame": "https://a/2.png"}, "first_frame"),
            ({"prompt": "x", "first_frame": "https://a/1.png", "images": ["https://a/b.png"]}, "不能同时"),
            ({"prompt": "x", "videos": ["clip.mp4"]}, "https"),
            ({"prompt": "x", "images": ["https://a"] * 10}, "最多 9"),
        ]
        for arguments, expected in cases:
            with self.subTest(arguments=arguments):
                result = self.call(arguments)
                self.assertTrue(result["isError"])
                self.assertIn(expected, self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_submit_timeouts_and_unknown_replay_the_same_key(self):
        FakeZCode.script[SUBMIT] = [
            (500, {"code": 2007, "msg": "upstream"}),
            ok({"state": "UNKNOWN"}),
            ok({"state": "SUCCEEDED", "replayed": True, "upstream_req_id": "cgt-9"}),
        ]
        FakeZCode.script[QUERY] = [self.finished("cgt-9")]

        result = self.call({"prompt": "cat"})

        self.assertNotIn("isError", result, self.text(result))
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 3)
        self.assertEqual(len({r["headers"]["idempotency-key"] for r in submits}), 1)
        self.assertEqual(json.loads(self.requests_to(QUERY)[0]["body"]), {"task_id": "cgt-9"})

    def test_unconfirmed_submit_hands_back_request_id_for_replay(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        result = self.call({"prompt": "cat"})

        self.assertTrue(result["isError"])
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        self.assertEqual({r["headers"]["idempotency-key"] for r in self.requests_to(SUBMIT)}, {key})
        self.assertIn(key, self.text(result))

        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [ok({"state": "SUCCEEDED", "replayed": True, "upstream_req_id": "cgt-2"})]
        FakeZCode.script[QUERY] = [self.finished("cgt-2")]
        result = self.call({"prompt": "cat", "request_id": key})

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"], key)

    def test_replay_reports_changed_duration_and_ratio(self):
        for arguments, warned in [
            ({"prompt": "cat", "duration": 8, "ratio": "9:16"}, None),
            ({"prompt": "cat", "duration": "8", "ratio": "9:16"}, None),
            ({"prompt": "cat", "duration": 12, "ratio": "1:1"}, "时长、画幅"),
            ({"prompt": "cat"}, "时长、画幅"),
        ]:
            with self.subTest(arguments=arguments):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
                result = self.call({"prompt": "cat", "duration": 8, "ratio": "9:16"})
                self.assertTrue(result["isError"])
                first = self.requests_to(SUBMIT)[0]
                key = first["headers"]["idempotency-key"]

                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [ok({"state": "SUCCEEDED", "replayed": True, "upstream_req_id": "cgt-8"})]
                FakeZCode.script[QUERY] = [self.finished("cgt-8")]
                result = self.call({**arguments, "request_id": key})

                self.assertNotIn("isError", result, self.text(result))
                self.assertEqual(self.requests_to(SUBMIT)[0]["body"], first["body"])
                if warned:
                    self.assertIn(f"本次修改的{warned}没有生效", self.text(result))
                else:
                    self.assertNotIn("没有生效", self.text(result))

    def test_submit_body_cut_off_mid_read_is_replayed_with_the_same_key(self):
        FakeZCode.script[SUBMIT] = [(200, TRUNCATED)]
        result = self.call({"prompt": "cat"})

        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        self.assertGreater(len(submits), 1)
        key = submits[0]["headers"]["idempotency-key"]
        self.assertEqual({r["headers"]["idempotency-key"] for r in submits}, {key})
        self.assertIn(key, self.text(result))

    def test_replay_with_local_image_reuses_the_first_request_body(self):
        (self.project / "ref.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/1.png"}), ok({"url": "https://oss.example/2.png"})]
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        result = self.call({"prompt": "cat", "images": ["ref.png"]})
        self.assertTrue(result["isError"])
        first = self.requests_to(SUBMIT)[0]
        key = first["headers"]["idempotency-key"]

        FakeZCode.requests = []
        FakeZCode.script[SUBMIT] = [ok({"state": "SUCCEEDED", "replayed": True, "upstream_req_id": "cgt-7"})]
        FakeZCode.script[QUERY] = [self.finished("cgt-7")]
        result = self.call({"prompt": "cat", "images": ["ref.png"], "request_id": key})

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(UPLOAD), [])
        self.assertEqual(self.requests_to(SUBMIT)[0]["body"], first["body"])

    def test_poll_failure_after_submit_keeps_the_task_id(self):
        for reply in [(401, None), (404, "<html>gateway</html>")]:
            with self.subTest(status=reply[0]):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [submitted("cgt-9")]
                FakeZCode.script[QUERY] = [reply]
                result = self.call({"prompt": "cat"})

                self.assertTrue(result["isError"])
                self.assertIn("cgt-9", self.text(result))
                self.assertIn("get_video_result", self.text(result))

    def test_hard_error_after_an_uncertain_attempt_still_hands_back_request_id(self):
        for second in [(401, None), (404, "<html>gateway</html>"), (200, {"code": 3701, "msg": "down"})]:
            with self.subTest(status=second[0]):
                FakeZCode.requests = []
                FakeZCode.script[SUBMIT] = [(200, TRUNCATED), second]
                result = self.call({"prompt": "cat"})

                self.assertTrue(result["isError"])
                key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
                self.assertIn(key, self.text(result))

    def test_unexpected_poll_payload_keeps_the_task_id(self):
        FakeZCode.script[SUBMIT] = [submitted("cgt-4")]
        FakeZCode.script[QUERY] = [(200, "null")]
        result = self.call({"prompt": "cat"})

        self.assertTrue(result["isError"])
        self.assertIn("cgt-4", self.text(result))

    def test_paths_outside_the_workspace_are_refused_before_any_request(self):
        secret = self.sandbox / "secret.png"
        secret.write_bytes(PNG)
        victim = self.sandbox / "victim.mp4"
        victim.write_bytes(b"keep")
        (self.project / "link.png").symlink_to(secret)
        (self.project / "out-link").symlink_to(self.sandbox)
        cases = [
            {"images": ["../secret.png"]},
            {"images": [str(secret)]},
            {"images": ["link.png"]},
            {"first_frame": "../secret.png"},
            {"output_path": "../victim.mp4"},
            {"output_path": str(victim)},
            {"output_path": "out-link/new.mp4"},
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
        (self.project / "taken.mp4").write_bytes(b"keep")
        for path, reason in [("taken.mp4", "已存在"), ("notes.txt", "扩展名")]:
            with self.subTest(path):
                FakeZCode.requests = []
                result = self.call({"prompt": "cat", "output_path": path})
                self.assertTrue(result["isError"])
                self.assertIn(reason, self.text(result))
                self.assertEqual(self.requests_to(SUBMIT), [])
        self.assertEqual((self.project / "taken.mp4").read_bytes(), b"keep")

    def test_output_extension_follows_the_actual_media_type(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"prompt": "cat", "output_path": "out/clip.webm"})
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(Path(result["structuredContent"]["path"]).name, "clip.mp4")
        self.assertEqual((self.project / "out" / "clip.mp4").read_bytes(), MP4)

    def test_oversized_download_keeps_the_link_and_writes_nothing(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [self.finished()]
        result = self.call({"prompt": "cat"}, VIDEO_GENERATION_MAX_DOWNLOAD_BYTES="1")
        self.assertNotIn("isError", result, self.text(result))
        self.assertIsNone(result["structuredContent"]["path"])
        self.assertIn("clip.mp4", self.text(result))
        self.assertFalse((self.project / "generated-videos").exists())

    def test_oversized_request_body_is_refused_before_submitting(self):
        for name in ["a.mp3", "b.mp3"]:
            (self.project / name).write_bytes(b"\0" * (2 * 1024 * 1024 - 1))
        result = self.call({"prompt": "cat", "audios": ["a.mp3", "b.mp3"]})
        self.assertTrue(result["isError"])
        self.assertIn("4 MiB", self.text(result))
        self.assertEqual(self.requests_to(SUBMIT), [])

    def test_submit_retries_stop_at_the_call_budget_and_hand_back_request_id(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        result = self.call(
            {"prompt": "cat"},
            VIDEO_GENERATION_RETRY_DELAY_MS="1000",
            VIDEO_GENERATION_CALL_BUDGET_MS="1500",
        )
        self.assertTrue(result["isError"])
        submits = self.requests_to(SUBMIT)
        self.assertEqual(len(submits), 2)
        self.assertIn(submits[0]["headers"]["idempotency-key"], self.text(result))

    def test_waiting_budget_counts_from_the_start_of_the_call(self):
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"}), submitted("cgt-5")]
        FakeZCode.script[QUERY] = [running("cgt-5")]
        result = self.call(
            {"prompt": "cat"},
            wait_budget_ms=500,
            VIDEO_GENERATION_RETRY_DELAY_MS="600",
        )
        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["task_id"], "cgt-5")
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_replay_without_the_saved_body_stops_instead_of_looping_on_3702(self):
        (self.project / "ref.png").write_bytes(PNG)
        FakeZCode.script[UPLOAD] = [ok({"url": "https://oss.example/1.png"})]
        FakeZCode.script[SUBMIT] = [ok({"state": "UNKNOWN"})]
        first = self.call({"prompt": "cat", "images": ["ref.png"]})
        key = self.requests_to(SUBMIT)[0]["headers"]["idempotency-key"]
        self.assertTrue(first["isError"])
        self.assertEqual(len(list((self.data_dir / "pending").iterdir())), 1)

        shutil.rmtree(self.data_dir)
        FakeZCode.requests = []
        result = self.call({"prompt": "cat", "images": ["ref.png"], "request_id": key})

        self.assertTrue(result["isError"])
        self.assertIn("找不到", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_rejected_submit_is_not_retried(self):
        FakeZCode.script[SUBMIT] = [(200, {"code": 3703, "msg": "rejected", "logid": "log-3"})]
        result = self.call({"prompt": "cat"})

        self.assertTrue(result["isError"])
        self.assertIn("log-3", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)
        self.assertEqual(self.requests_to(QUERY), [])

    def test_still_running_returns_task_id_without_resubmitting(self):
        FakeZCode.script[SUBMIT] = [submitted()]
        FakeZCode.script[QUERY] = [running()]

        result = self.call({"prompt": "cat"}, wait_budget_ms=100)

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(result["structuredContent"]["task_id"], "cgt-1")
        self.assertEqual(result["structuredContent"]["status"], "running")
        self.assertIn("get_video_result", self.text(result))
        self.assertEqual(len(self.requests_to(SUBMIT)), 1)

    def test_get_video_result_only_polls(self):
        FakeZCode.script[QUERY] = [(500, {"code": 2007, "msg": "blip"}), self.finished("cgt-5")]

        result = self.call({"task_id": "cgt-5", "prompt": "cat"}, tool="get_video_result")

        self.assertNotIn("isError", result, self.text(result))
        self.assertEqual(self.requests_to(SUBMIT), [])
        self.assertEqual(len(self.requests_to(QUERY)), 2)
        self.assertEqual(Path(result["structuredContent"]["path"]).read_bytes(), MP4)

    def test_failed_task_reports_upstream_reason(self):
        FakeZCode.script[QUERY] = [
            ok({"task_id": "cgt-1", "status": "failed", "failure": {"code": "OutputVideoSensitive", "message": "blocked"}})
        ]
        result = self.call({"task_id": "cgt-1"}, tool="get_video_result")

        self.assertTrue(result["isError"])
        self.assertIn("OutputVideoSensitive", self.text(result))

    def test_unknown_task_stops_polling(self):
        FakeZCode.script[QUERY] = [(200, {"code": 3704, "msg": "not found"})]
        result = self.call({"task_id": "cgt-x"}, tool="get_video_result")

        self.assertTrue(result["isError"])
        self.assertEqual(len(self.requests_to(QUERY)), 1)

    def test_missing_coding_plan_fails_before_any_request(self):
        result = self.call({"prompt": "cat"}, auth={"ok": False, "reason": "official_auth_plan_required"})

        self.assertTrue(result["isError"])
        self.assertIn("Coding Plan", self.text(result))
        self.assertEqual(FakeZCode.requests, [])

    def test_redirect_is_refused(self):
        FakeZCode.script[SUBMIT] = [(302, None)]
        result = self.call({"prompt": "cat"})

        self.assertTrue(result["isError"])
        self.assertIn("重定向", self.text(result))

    def test_non_https_remote_origin_is_refused(self):
        result = self.call({"prompt": "cat"}, base_url="http://zcode.example")

        self.assertTrue(result["isError"])
        self.assertIn("https", self.text(result))
        self.assertEqual(FakeZCode.requests, [])


class VideoGenerationManifestTest(unittest.TestCase):
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
        server = manifest["mcpServers"]["video_generation"]
        self.assertEqual(server["type"], "stdio")
        self.assertEqual(server["auth"], {"type": "zcode_official", "provider": "jwt_token"})
        self.assertNotIn("env", server, "identity must come from _meta, never from static env")

    def test_marketplace_lists_the_plugin(self):
        marketplace = json.loads((ROOT / "marketplace.json").read_text(encoding="utf-8"))
        entry = next(p for p in marketplace["plugins"] if p["name"] == "video-generation")
        self.assertEqual(entry["source"], "./plugins/video-generation")
        manifest = json.loads((PLUGIN / ".zcode-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(entry["version"], manifest["version"])

    def test_names_do_not_expose_the_upstream_model(self):
        for path in PLUGIN.rglob("*"):
            if path.is_file():
                text = path.read_text(encoding="utf-8").lower()
                for word in ("seedream", "seedance", "volc", "doubao", "gpt-image"):
                    self.assertNotIn(word, text, f"{path.relative_to(ROOT)} mentions {word}")


if __name__ == "__main__":
    unittest.main()
