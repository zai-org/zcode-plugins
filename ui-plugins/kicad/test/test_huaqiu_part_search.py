from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import huaqiu_part_search as parts


def make_adapter(root: Path) -> Path:
    app = root / "KiCad.app"
    paths = parts.adapter_paths(app)
    paths["node"].parent.mkdir(parents=True)
    paths["node"].touch()
    paths["library"].parent.mkdir(parents=True)
    paths["library"].touch()
    return app


class HuaqiuPartSearchTest(unittest.TestCase):
    def test_search_arguments_are_normalized_and_bounded(self):
        got = parts.search_arguments(
            "  STM32F103  ",
            page=2,
            page_size=25,
            require_eda_model=False,
            requirements={"symbol": True, "supplier": False},
            language="en",
        )
        self.assertEqual(got["query"], "STM32F103")
        self.assertEqual(got["pageSize"], 25)
        self.assertFalse(got["requireEdaModel"])
        self.assertEqual(got["requirements"], {"symbol": True, "supplier": False})
        with self.assertRaisesRegex(ValueError, "page_size"):
            parts.search_arguments("resistor", page_size=51)
        with self.assertRaisesRegex(ValueError, "unknown requirements"):
            parts.search_arguments("resistor", requirements={"arbitrary": True})

    def test_part_and_supply_arguments_never_accept_arbitrary_fields(self):
        self.assertEqual(
            parts.part_arguments(" 42 ", " NE555 "),
            {"manufacturerId": "42", "mpn": "NE555", "language": "zh"},
        )
        got = parts.supply_arguments([{"manufacturer_id": "42", "mpn": "NE555"}])
        self.assertEqual(got, {"parts": [{"manufacturerId": "42", "mpn": "NE555"}]})
        with self.assertRaisesRegex(ValueError, "unknown fields"):
            parts.supply_arguments([{"manufacturer_id": "42", "mpn": "NE555", "url": "bad"}])

    def test_standard_edition_is_rejected_before_starting_a_process(self):
        with tempfile.TemporaryDirectory() as tmp:
            called = False

            def runner(*args, **kwargs):
                nonlocal called
                called = True
                raise AssertionError("runner must not be called")

            got = parts.execute("search", {"query": "x"}, app=Path(tmp), edition="standard", runner=runner)
            self.assertFalse(got["ok"])
            self.assertEqual(got["code"], "huaqiu_edition_required")
            self.assertFalse(called)

    def test_auto_edition_uses_a_detected_huaqiu_installation(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = make_adapter(Path(tmp))
            (app / "Contents/Resources/edge-headless/dsh").mkdir(parents=True)
            seen: list[list[str]] = []

            def runner(command, **kwargs):
                seen.append(command)
                payload = json.dumps({"ok": True, "result": {"parts": []}})
                return subprocess.CompletedProcess(command, 0, payload, "")

            got = parts.execute("search", {"query": "NE555"}, app=app, edition="auto", runner=runner)
            self.assertTrue(got["ok"])
            self.assertEqual(got["edition"], "huaqiu")
            self.assertEqual(len(seen), 1)

    def test_huaqiu_call_uses_fixed_executable_bridge_and_library(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = make_adapter(Path(tmp))
            seen = {}

            def runner(command, **kwargs):
                seen.update(command=command, kwargs=kwargs)
                return subprocess.CompletedProcess(command, 0, json.dumps({"ok": True, "result": {"total": 1}}), "")

            got = parts.execute("search", {"query": "NE555"}, app=app, edition="huaqiu", runner=runner)
            locations = parts.adapter_paths(app)
            self.assertTrue(got["ok"])
            self.assertEqual(got["result"], {"total": 1})
            self.assertEqual(
                seen["command"],
                [str(locations["node"]), str(locations["bridge"]), str(locations["library"])],
            )
            self.assertFalse(seen["kwargs"]["check"])
            request = json.loads(seen["kwargs"]["input"])
            self.assertEqual(request, {"operation": "search", "arguments": {"query": "NE555"}})

    def test_missing_runtime_timeout_and_upstream_errors_are_structured(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = parts.execute("search", {}, app=Path(tmp), edition="huaqiu")
            self.assertEqual(missing["code"], "huaqiu_part_search_unavailable")
            app = make_adapter(Path(tmp))

            def timeout(*args, **kwargs):
                raise subprocess.TimeoutExpired("node", 35)

            timed = parts.execute("search", {}, app=app, edition="huaqiu", runner=timeout)
            self.assertEqual(timed["code"], "huaqiu_part_search_timeout")

            def failed(command, **kwargs):
                payload = {"ok": False, "error": {"name": "PartNotFoundError", "message": "not found", "status": 404}}
                return subprocess.CompletedProcess(command, 1, json.dumps(payload), "")

            failure = parts.execute("detail", {}, app=app, edition="huaqiu", runner=failed)
            self.assertEqual(failure["code"], "huaqiu_part_search_failed")
            self.assertEqual(failure["error"], "not found")
            self.assertEqual(failure["upstream"]["status"], 404)


if __name__ == "__main__":
    unittest.main()
