"""video-agent-kit speech through ZCode ToolHub: Seed ASR (upload -> submit -> query) and StepFun TTS.

A local fake answers like zcode-server's ToolHub gateway (docs/api_toolhub.md): every call is
``POST /api/v1/toolhub/...`` with the signed-in identity, responses are the ``{code, msg, data,
logid}`` envelope, and local audio reaches Seed ASR only as an uploaded https URL. The identity
comes from the running tool call (``official_auth.CURRENT``), as the MCP server sets it.
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch

PLUGIN_MCP_DIR = Path(__file__).resolve().parents[1] / "plugins" / "video-agent-kit" / "mcp"
if str(PLUGIN_MCP_DIR) not in sys.path:
    sys.path.insert(0, str(PLUGIN_MCP_DIR))

try:
    import requests  # noqa: F401

    from ve_tools import asr, official_auth, toolhub, tts
    from ve_tools.official_auth import OfficialAuth
    from ve_tools.run_context import RunContext

    DEPS_AVAILABLE, DEPS_REASON = True, ""
except Exception as exc:  # noqa: BLE001
    DEPS_AVAILABLE, DEPS_REASON = False, f"plugin runtime deps unavailable: {exc}"

IDENTITY = {"Authorization": "Bearer jwt-1", "Bigmodel-Target-Type": "PERSONAL"}


def _wav(seconds: float = 0.6, rate: int = 24000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b"\x00\x01" * int(seconds * rate))
    return buffer.getvalue()


class _FakeToolHub(BaseHTTPRequestHandler):
    mode = "ok"
    calls: list[dict] = []

    def log_message(self, *_args):
        return

    def _reply(self, envelope: dict) -> None:
        body = json.dumps(envelope).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        headers = {k.lower(): v for k, v in self.headers.items()}
        multipart = headers.get("content-type", "").startswith("multipart/form-data")
        type(self).calls.append({"path": self.path, "headers": headers,
                                 "json": None if multipart else json.loads(raw or b"{}"),
                                 "bytes": len(raw)})
        if "authorization" not in headers:
            self.send_response(401)
            self.end_headers()
            return
        if type(self).mode == "no_zai_account":
            self._reply({"code": 3706, "msg": "tool identity unavailable", "logid": "l-3706"})
            return
        path = self.path
        if path == "/api/v1/toolhub/files":
            data = {"url": "https://bucket.example/toolhub/u/clip.wav?sig=1", "expires_at": "2026-11-24T10:00:00+08:00"}
        elif path == "/api/v1/toolhub/tool/stepfun_tts/invoke":
            data = {"state": "SUCCEEDED", "output": {"audio_base64": base64.b64encode(_wav()).decode("ascii")}}
        elif path == "/api/v1/toolhub/tool/seed_asr/invoke":
            data = {"state": "SUCCEEDED", "output": {"task_id": "task-1"}}
        elif path == "/api/v1/toolhub/tool/seed_asr/tasks/query":
            data = {"status": "succeeded", "output": {
                "text": "你好世界",
                "utterances": [
                    {"text": "你好", "start_time": 100, "end_time": 1000, "additions": {"speaker": "1"},
                     "words": [{"text": "你好", "start_time": 100, "end_time": 1000}]},
                    {"text": "世界", "start_time": 1200, "end_time": 1900, "additions": {"speaker": "2"},
                     "words": []},
                ]}}
        else:
            self._reply({"code": 3705, "msg": "tool route not found", "logid": "l-3705"})
            return
        self._reply({"code": 0, "msg": "", "data": data, "logid": "l-ok"})


@unittest.skipUnless(DEPS_AVAILABLE, DEPS_REASON)
class ToolHubSpeechTest(unittest.TestCase):
    ENV_KEYS = ("ZCODE_BASE_URL", "VE_PROJECT_DIR", "VE_TTS_VOICE")

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), _FakeToolHub)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        host, port = cls.server.server_address[:2]
        cls.origin = f"http://{host}:{port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        _FakeToolHub.mode, _FakeToolHub.calls = "ok", []
        saved = {k: os.environ.get(k) for k in self.ENV_KEYS}
        self.addCleanup(lambda: [os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
                                 for k, v in saved.items()])
        for key in self.ENV_KEYS:
            os.environ.pop(key, None)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        os.environ["VE_PROJECT_DIR"] = self.tmp.name
        os.environ["ZCODE_BASE_URL"] = self.origin
        official_auth._LATEST = None
        token = official_auth.CURRENT.set(OfficialAuth(headers=dict(IDENTITY)))
        self.addCleanup(official_auth.CURRENT.reset, token)
        self.addCleanup(setattr, official_auth, "_LATEST", None)

    # ── TTS ──────────────────────────────────────────────────────────────

    def test_tts_calls_stepfun_tts_with_the_preset_voice(self):
        ctx = RunContext()
        result = tts.request_tts({"text": "测试配音。", "voice": "zixinnansheng", "output_path": "out/line.wav"}, ctx)
        self.assertFalse(result.is_error, result.text)
        self.assertGreater(result.data["duration_seconds"], 0.5)
        self.assertTrue((Path(self.tmp.name) / "out" / "line.wav").is_file())

        (call,) = _FakeToolHub.calls
        self.assertEqual(call["path"], "/api/v1/toolhub/tool/stepfun_tts/invoke")
        self.assertEqual(call["json"], {"text": "测试配音。", "voice": "zixinnansheng"})
        self.assertEqual(call["headers"]["authorization"], IDENTITY["Authorization"])
        self.assertEqual(call["headers"]["bigmodel-target-type"], "PERSONAL")
        self.assertEqual(call["headers"]["x-usage-scenario"], "video-kit")
        self.assertTrue(call["headers"].get("idempotency-key"))

        again = tts.request_tts({"text": "测试配音。", "voice": "zixinnansheng", "output_path": "out/line.wav"}, ctx)
        self.assertTrue(again.data["cache_hit"])
        self.assertEqual(len(_FakeToolHub.calls), 1)

    def test_tts_without_a_zai_account_is_identity_unavailable(self):
        _FakeToolHub.mode = "no_zai_account"
        with self.assertRaises(tts._TTSFailure) as caught:
            tts._synthesize_chunk("你好", "zixinnansheng")
        self.assertEqual(caught.exception.code, "identity_unavailable")
        self.assertTrue(caught.exception.rejected)

    def test_no_identity_sends_nothing(self):
        official_auth.CURRENT.set(None)
        self.assertFalse(tts.tts_status()["available"])
        self.assertFalse(asr.asr_status()["available"])
        self.assertEqual(_FakeToolHub.calls, [])

    # ── ASR ──────────────────────────────────────────────────────────────

    def test_asr_uploads_then_submits_the_url_and_polls_seed_asr(self):
        source = Path(self.tmp.name) / "clip.wav"
        source.write_bytes(_wav(seconds=2.0, rate=16000))
        with patch.object(asr, "MIN_POLL_INTERVAL_SECONDS", 0.0):
            got = asr.asr_transcribe_payload(source, Path(self.tmp.name) / "work", language="zh",
                                             timeout_seconds=60, poll_interval_seconds=0.0, started=0.0)
        self.assertIsInstance(got, tuple, getattr(got, "text", got))
        payload, asr_audio = got
        self.assertEqual(asr_audio, source)  # a small wav uploads as-is

        paths = [c["path"] for c in _FakeToolHub.calls]
        self.assertEqual(paths, ["/api/v1/toolhub/files", "/api/v1/toolhub/tool/seed_asr/invoke",
                                 "/api/v1/toolhub/tool/seed_asr/tasks/query"])
        self.assertGreaterEqual(_FakeToolHub.calls[0]["bytes"], source.stat().st_size)
        self.assertEqual(_FakeToolHub.calls[1]["json"],
                         {"audio": "https://bucket.example/toolhub/u/clip.wav?sig=1", "format": "wav"})
        self.assertTrue(_FakeToolHub.calls[1]["headers"].get("idempotency-key"))
        self.assertEqual(_FakeToolHub.calls[2]["json"], {"task_id": "task-1"})

        self.assertEqual(payload["provider"], "asr")
        self.assertEqual([s["text"] for s in payload["segments"]], ["你好", "世界"])
        self.assertEqual((payload["segments"][0]["start"], payload["segments"][0]["end"]), (0.1, 1.0))
        self.assertTrue(payload["speaker_labels"])
        self.assertEqual(payload["asr_audio_sha256"], payload["source_video_sha256"])


if __name__ == "__main__":
    unittest.main()
