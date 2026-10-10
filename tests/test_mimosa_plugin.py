from __future__ import annotations

import hashlib
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MIMOSA = ROOT / "plugins" / "mimosa"
PAYLOAD = MIMOSA / "payload"
sys.path.insert(0, str(ROOT / "scripts"))

import build_dist  # noqa: E402


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def runtime_test_env() -> dict[str, str]:
    # 安全回归必须使用原生引擎和默认 graded 策略，不能继承 runner 的演示/降级开关。
    env = {key: value for key, value in os.environ.items()
           if not key.startswith("MIMOSA_") and key not in {"NODE_OPTIONS", "NODE_PATH"}}
    env["MIMOSA_ENGINE"] = "native"
    return env


def run_node(*args: str, cwd: Path | None = None, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    node = shutil.which("node")
    if node is None:
        raise AssertionError("node must be available in PATH to validate Mimosa")
    return subprocess.run(
        [node, *args],
        cwd=cwd,
        env=runtime_test_env(),
        input=input_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
        check=False,
    )


def assert_no_activation_field(test: unittest.TestCase, value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            test.assertNotIn(key, {"enable", "enabled"})
            assert_no_activation_field(test, child)
    elif isinstance(value, list):
        for child in value:
            assert_no_activation_field(test, child)


class McpStdioClient:
    def __init__(self, server: Path, cwd: Path) -> None:
        node = shutil.which("node")
        if node is None:
            raise AssertionError("node must be available in PATH to validate Mimosa")
        env = runtime_test_env()
        self.process = subprocess.Popen(
            [node, str(server)],
            cwd=cwd,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        if self.process.stdin is None or self.process.stdout is None:
            raise AssertionError("failed to open Mimosa MCP stdio pipes")
        self._responses: queue.Queue[dict | None] = queue.Queue()
        self._next_id = 1
        self._reader = threading.Thread(target=self._read_stdout, daemon=True)
        self._reader.start()

    def _read_stdout(self) -> None:
        assert self.process.stdout is not None
        try:
            for line in self.process.stdout:
                self._responses.put(json.loads(line))
        finally:
            self._responses.put(None)

    def notify(self, method: str, params: dict) -> None:
        self._write({"jsonrpc": "2.0", "method": method, "params": params})

    def request(self, method: str, params: dict, timeout: float = 120) -> dict:
        request_id = self._next_id
        self._next_id += 1
        self._write(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params,
            }
        )
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AssertionError(f"timeout waiting for MCP response {request_id}")
            try:
                response = self._responses.get(timeout=remaining)
            except queue.Empty as error:
                raise AssertionError(f"timeout waiting for MCP response {request_id}") from error
            if response is None:
                stderr = self.process.stderr.read() if self.process.stderr is not None else ""
                raise AssertionError(f"MCP server exited before response {request_id}: {stderr}")
            if response.get("id") == request_id:
                return response

    def close(self) -> None:
        if self.process.stdin is not None and not self.process.stdin.closed:
            self.process.stdin.close()
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self._reader.join(timeout=5)
        for stream in (self.process.stdout, self.process.stderr):
            if stream is not None and not stream.closed:
                stream.close()

    def _write(self, message: dict) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
        self.process.stdin.flush()


def mcp_text_json(response: dict) -> dict:
    result = response.get("result", {})
    for item in result.get("content", []):
        if item.get("type") == "text":
            return json.loads(item["text"])
    raise AssertionError(f"MCP response has no JSON text content: {response}")


def assert_signed_inventory(test: unittest.TestCase, root: Path) -> None:
    manifest = load_json(root / "manifest.json")
    test.assertEqual(manifest.get("schema"), "mimosa-protected-build/v1")
    test.assertEqual(manifest["integrity"]["algorithm"], "Ed25519")
    test.assertTrue(manifest["integrity"]["signature"])

    declared = {item["path"]: item for item in manifest["files"]}
    actual = {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_file() and path.name not in {"manifest.json", ".DS_Store"}
    }
    test.assertEqual(actual, set(declared))
    for relative, item in declared.items():
        contents = (root / relative).read_bytes()
        test.assertEqual(len(contents), item["bytes"], relative)
        test.assertEqual(hashlib.sha256(contents).hexdigest(), item["sha256"], relative)


class MimosaPluginTest(unittest.TestCase):
    def test_runtime_env_does_not_inherit_hook_overrides(self) -> None:
        with mock.patch.dict(os.environ, {"MIMOSA_HOOK_BLOCK": "warn", "MIMOSA_NO_GIT_GATE": "1", "NODE_OPTIONS": "--invalid"}):
            env = runtime_test_env()
        self.assertNotIn("MIMOSA_HOOK_BLOCK", env)
        self.assertNotIn("MIMOSA_NO_GIT_GATE", env)
        self.assertNotIn("NODE_OPTIONS", env)
        self.assertEqual(env["MIMOSA_ENGINE"], "native")

    def test_marketplace_listing_uses_localized_product_name_and_published_icon(self) -> None:
        marketplace = load_json(ROOT / "marketplace.json")
        entry = next(item for item in marketplace["plugins"] if item["name"] == "mimosa")
        self.assertEqual(entry["version"], "1.0.4")
        self.assertEqual(entry["displayName"], "Code Security Protection")
        self.assertEqual(
            entry["displayName_i18n"],
            {"en": "Code Security Protection", "zh-CN": "代码安全防护"},
        )
        self.assertEqual(
            entry["icon"],
            "https://cdn-zcode.z.ai/zcode/official-plugin/assets/mimosa/icon.png",
        )
        icon = ROOT / "assets" / "mimosa" / "icon.png"
        self.assertTrue(icon.is_file())
        self.assertEqual(
            hashlib.sha256(icon.read_bytes()).hexdigest(),
            "05466a98ac49aa40fd96cd1f371ee3ff8574d76668f5649b24c62dd1dfd6361e",
        )

    def test_standard_manifest_and_compatibility_mirror_match(self) -> None:
        preferred = load_json(MIMOSA / ".zcode-plugin" / "plugin.json")
        compatible = load_json(MIMOSA / ".claude-plugin" / "plugin.json")
        self.assertEqual(preferred, compatible)
        self.assertEqual(preferred["name"], "mimosa")
        self.assertEqual(preferred["version"], "1.0.4")
        self.assertEqual(set(preferred["description_i18n"]), {"en", "zh-CN"})
        self.assertEqual(preferred["commands"], "payload/commands")
        self.assertEqual(preferred["skills"], "payload/skills")
        for redundant in ("hooks", "mcpServers"):
            self.assertNotIn(redundant, preferred)

    def test_signed_commands_publish_bilingual_metadata(self) -> None:
        commands = PAYLOAD / "commands"
        self.assertEqual(
            {path.name for path in commands.glob("*.md")},
            {"mimosa-scan.md", "mimosa-status.md", "mimosa-deep-audit.md"},
        )
        for command in commands.glob("*.md"):
            contents = command.read_text(encoding="utf-8")
            description = next(
                line.removeprefix("description:").strip()
                for line in contents.splitlines()
                if line.startswith("description:")
            )
            self.assertIn(" / ", description, command.name)
            self.assertTrue(any("a" <= char.lower() <= "z" for char in description))
            self.assertTrue(any("\u4e00" <= char <= "\u9fff" for char in description))

        assert_signed_inventory(self, PAYLOAD)

    def test_cross_platform_hook_and_mcp_contract(self) -> None:
        hooks_document = load_json(MIMOSA / "hooks" / "hooks.json")
        mcp_document = load_json(MIMOSA / ".mcp.json")
        assert_no_activation_field(self, hooks_document)
        assert_no_activation_field(self, mcp_document)
        hooks = hooks_document["hooks"]
        self.assertEqual(
            set(hooks),
            {"PreToolUse", "PostToolUse", "UserPromptSubmit", "SessionStart", "Stop"},
        )
        for event, groups in hooks.items():
            for group in groups:
                for hook in group["hooks"]:
                    self.assertEqual(hook["type"], "process")
                    self.assertEqual(hook["command"], "node")
                    self.assertEqual(len(hook["args"]), 3)
                    self.assertEqual(hook["args"][0], "${ZCODE_PLUGIN_ROOT}/hooks/run-hook.cjs")
                    self.assertEqual(hook["args"][2], event)

        server = mcp_document["mcpServers"]["mimosa"]
        self.assertEqual(server["type"], "stdio")
        self.assertNotIn("enable", server)
        self.assertNotIn("enabled", server)
        self.assertEqual(server["command"], "node")
        self.assertEqual(server["args"], ["${ZCODE_PLUGIN_ROOT}/payload/dist/mcp/server.js"])
        self.assertEqual(server["cwd"], "${ZCODE_PROJECT_DIR}")

    def test_protected_payload_matches_signed_inventory_and_declares_no_native_binaries(self) -> None:
        assert_signed_inventory(self, PAYLOAD)
        delivery = load_json(PAYLOAD / "DELIVERY-MANIFEST.json")
        protected = load_json(PAYLOAD / "manifest.json")
        self.assertEqual(delivery["schema"], "mimosa-node-sdk/v1")
        self.assertEqual(delivery["layout"], "node-single-artifact/v1")
        self.assertTrue(delivery["crossPlatform"])
        self.assertFalse(delivery["nativeBinaries"])
        self.assertFalse(protected["protection"]["nativeHost"]["enabled"])
        self.assertEqual(protected["protection"]["variantId"], "af8b4e5393f28ec0b00d678d")
        self.assertEqual(
            protected["integrity"]["publicKeySha256"],
            "f076043b8a7b5783e930fb900668749aedab1e34e6738a32d00f0625dccfa45a",
        )
        self.assertEqual(
            delivery["integrityPublicKeySha256"],
            protected["integrity"]["publicKeySha256"],
        )

        executable_magics = {
            b"\x7fELF",
            b"\xfe\xed\xfa\xce",
            b"\xce\xfa\xed\xfe",
            b"\xfe\xed\xfa\xcf",
            b"\xcf\xfa\xed\xfe",
            b"\xca\xfe\xba\xbe",
            b"\xbe\xba\xfe\xca",
        }
        for path in PAYLOAD.rglob("*"):
            if not path.is_file():
                continue
            prefix = path.read_bytes()[:4]
            self.assertNotIn(prefix, executable_magics, path.relative_to(PAYLOAD).as_posix())
            self.assertNotEqual(prefix[:2], b"MZ", path.relative_to(PAYLOAD).as_posix())

    def test_distribution_zip_contains_complete_standard_plugin(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mimosa-dist-test-") as directory:
            archive = Path(directory) / "plugin.zip"
            build_dist.build_zip(MIMOSA, archive)
            with zipfile.ZipFile(archive) as bundle:
                names = set(bundle.namelist())
            self.assertIn("mimosa/.zcode-plugin/plugin.json", names)
            self.assertIn("mimosa/.claude-plugin/plugin.json", names)
            self.assertIn("mimosa/hooks/hooks.json", names)
            self.assertIn("mimosa/hooks/run-hook.cjs", names)
            self.assertIn("mimosa/.mcp.json", names)
            self.assertIn("mimosa/payload/manifest.json", names)
            self.assertIn("mimosa/payload/dist/cli.js", names)
            self.assertIn("mimosa/payload/dist/mcp/server.js", names)
            self.assertIn("mimosa/payload/dist/mcp/security-scan-worker.js", names)
            self.assertIn("mimosa/payload/dist/mcp/security-scan-worker.mimosa", names)
            self.assertFalse(any("demo-smoke" in name for name in names))
            self.assertFalse(any("vendor/" in name for name in names))
            self.assertFalse(
                any(
                    part == "__MACOSX" or part == ".DS_Store" or part.startswith("._")
                    for name in names
                    for part in Path(name).parts
                )
            )

    def test_mcp_async_deep_scan_completes_and_seals_report(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mimosa-mcp-worker-test-") as directory:
            root = Path(directory)
            project = root / "project"
            output = root / "scans"
            project.mkdir()
            (project / "app.js").write_text(
                'const { exec } = require("node:child_process");\n'
                'function run(input) { exec("sh -c " + input); }\n',
                encoding="utf-8",
            )
            client = McpStdioClient(PAYLOAD / "dist" / "mcp" / "server.js", project)
            try:
                initialized = client.request(
                    "initialize",
                    {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "mimosa-plugin-test", "version": "1.0.0"},
                    },
                )
                self.assertEqual(initialized["result"]["serverInfo"]["name"], "mimosa")
                client.notify("notifications/initialized", {})
                started = mcp_text_json(
                    client.request(
                        "tools/call",
                        {
                            "name": "security_scan_start",
                            "arguments": {
                                "project": str(project),
                                "depth": "deep",
                                "outputDir": str(output),
                            },
                        },
                    )
                )
                job_id = started["job"]["jobId"]
                final = None
                for _ in range(100):
                    current = mcp_text_json(
                        client.request(
                            "tools/call",
                            {
                                "name": "security_scan_status",
                                "arguments": {"jobId": job_id},
                            },
                        )
                    )
                    if current["job"]["status"] in {
                        "failed",
                        "completed",
                        "cancelled",
                        "interrupted",
                    }:
                        final = current["job"]
                        break
                    time.sleep(0.1)
                self.assertIsNotNone(final, "MCP deep scan did not reach a terminal state")
                assert final is not None
                self.assertEqual(final["status"], "completed", final.get("error"))
                result = final["result"]
                self.assertGreaterEqual(result["findingCount"], 1)
                self.assertTrue(result["seal"].startswith("sha256:"))
                scan_dir = Path(result["scanDir"])
                for name in (
                    "scan-manifest.json",
                    "findings.json",
                    "coverage.json",
                    "seal.json",
                    "report.md",
                ):
                    self.assertTrue((scan_dir / name).is_file(), name)
            finally:
                client.close()

    def test_protected_runtime_scans_a_real_project(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mimosa-runtime-test-") as directory:
            project = Path(directory)
            (project / "app.js").write_text(
                'const { exec } = require("node:child_process");\n'
                'function run(input) { exec("sh -c " + input); }\n',
                encoding="utf-8",
            )
            result = run_node(str(PAYLOAD / "dist" / "cli.js"), "audit", str(project), "--json")
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report["runStatus"], "completed")
            self.assertEqual(report["coverage"]["status"], "complete")
            self.assertGreaterEqual(report["totals"]["high"], 1)
            findings = [finding for file in report["files"] for finding in file["findings"]]
            self.assertTrue(any("CWE-78" in finding["cwe"] for finding in findings))

    def test_pre_write_hook_blocks_command_injection(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mimosa-hook-test-") as directory:
            project = Path(directory)
            request = {
                "session_id": "mimosa-test-session",
                "hook_event_name": "PreToolUse",
                "cwd": str(project),
                "tool_name": "Write",
                "tool_input": {
                    "file_path": str(project / "unsafe.js"),
                    "content": (
                        'const { exec } = require("node:child_process");\n'
                        'export function run(input) { exec("sh -c " + input); }\n'
                    ),
                },
            }
            result = run_node(
                str(MIMOSA / "hooks" / "run-hook.cjs"), "scan-hook.mjs", "PreToolUse",
                cwd=project,
                input_text=json.dumps(request),
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(result.stdout.strip(),
                            f"PreToolUse returned no decision JSON; stderr={result.stderr[-2000:]!r}")
            try:
                response = json.loads(result.stdout)
            except json.JSONDecodeError as error:
                self.fail(f"PreToolUse returned invalid JSON: {error}; stderr={result.stderr[-2000:]!r}")
            decision = response["hookSpecificOutput"]
            self.assertEqual(decision["hookEventName"], "PreToolUse")
            self.assertEqual(decision["permissionDecision"], "deny")
            self.assertIn("命令注入", decision["permissionDecisionReason"])

    def test_hook_adapter_flushes_deny_under_stdout_backpressure(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mimosa-output-test-") as directory:
            root = Path(directory)
            shim = root / "slow-stdout.cjs"
            shim.write_text(
                "const w=process.stdout.write.bind(process.stdout);"
                "process.stdout.write=function(c,e,cb){"
                "if(typeof e==='function'){cb=e;e=undefined;}"
                "setTimeout(()=>w(c,e,cb),40);return true;};",
                encoding="utf-8",
            )
            request = {"session_id": "backpressure", "hook_event_name": "PreToolUse",
                       "cwd": str(root), "tool_name": "Write", "tool_input": {
                           "file_path": str(root / "unsafe.js"),
                           "content": 'const { exec } = require("node:child_process");\nexport function run(input) { exec("sh -c " + input); }\n'}}
            for attempt in range(3):
                with self.subTest(attempt=attempt), mock.patch.dict(os.environ, {"TMPDIR": str(root)}):
                    result = run_node("--require", str(shim), str(MIMOSA / "hooks" / "run-hook.cjs"),
                                      "scan-hook.mjs", "PreToolUse", cwd=root, input_text=json.dumps(request))
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")
                    self.assertEqual(list(root.glob("mimosa-hook-output-*")), [])

    def test_hook_adapter_rejects_arbitrary_hook_path(self) -> None:
        result = run_node(str(MIMOSA / "hooks" / "run-hook.cjs"), "../untrusted.js", "PreToolUse", input_text="{}")
        self.assertEqual(json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_protected_runtime_rejects_tampering(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mimosa-tamper-test-") as directory:
            root = Path(directory)
            copied_payload = root / "payload"
            shutil.copytree(PAYLOAD, copied_payload)
            command = copied_payload / "commands" / "mimosa-scan.md"
            command.write_bytes(command.read_bytes() + b"\n")
            project = root / "project"
            project.mkdir()
            (project / "safe.js").write_text("export const value = 1;\n", encoding="utf-8")

            result = run_node(
                str(copied_payload / "dist" / "cli.js"),
                "audit",
                str(project),
                "--json",
            )
            self.assertNotEqual(result.returncode, 0)
            combined = (result.stdout + result.stderr).lower()
            self.assertTrue(
                any(
                    marker in combined
                    for marker in ("integrity", "hash mismatch", "完整性校验失败", "文件哈希不匹配")
                ),
                combined,
            )


if __name__ == "__main__":
    unittest.main()
