from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
import venv
from pathlib import Path
from unittest.mock import patch


DOCTOR_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "env-setup"
    / "scripts"
    / "env_doctor.py"
)
SPEC = importlib.util.spec_from_file_location("video2code_env_doctor", DOCTOR_PATH)
assert SPEC is not None and SPEC.loader is not None
env_doctor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = env_doctor
SPEC.loader.exec_module(env_doctor)


class McpDependencyProbeTest(unittest.TestCase):
    def test_rejects_mcp_2_x(self) -> None:
        with patch.object(env_doctor.importlib.util, "find_spec", return_value=object()), patch.object(
            env_doctor.importlib_metadata, "version", return_value="2.0.0"
        ):
            ok, detail = env_doctor.probe_mcp_sdk()

        self.assertFalse(ok)
        self.assertIn("mcp==1.9.0", detail)

    def test_accepts_exact_mcp_version(self) -> None:
        fake_spec = type("Spec", (), {"origin": "/tmp/mcp/__init__.py"})()
        with patch.object(env_doctor.importlib.util, "find_spec", return_value=fake_spec), patch.object(
            env_doctor.importlib_metadata, "version", return_value="1.9.0"
        ):
            ok, detail = env_doctor.probe_mcp_sdk()

        self.assertTrue(ok)
        self.assertIn("1.9.0", detail)

    def test_python_package_fixes_use_selected_interpreter(self) -> None:
        python_package_checks = [
            check for check in env_doctor.CHECKS if check.id.startswith("py-")
        ]

        self.assertGreaterEqual(len(python_package_checks), 4)
        for check in python_package_checks:
            with self.subTest(check=check.id):
                self.assertTrue(check.fix)
                self.assertTrue(check.fix[0].startswith(env_doctor.PIP_INSTALL))

    def test_virtualenv_fix_uses_its_own_package_directory(self) -> None:
        with tempfile.TemporaryDirectory(prefix="video2code venv ") as directory:
            venv.EnvBuilder(with_pip=True).create(directory)
            python = Path(directory) / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            probe = subprocess.run(
                [str(python), "-c",
                 "import json, runpy, sys; "
                 "doctor = runpy.run_path(sys.argv[1]); "
                 "print(json.dumps(doctor['PIP_INSTALL']))", str(DOCTOR_PATH)],
                capture_output=True, text=True, check=True,
            )
            command = json.loads(probe.stdout)
            result = subprocess.run(
                command + " --no-index v2c-smoke-nonexistent-package",
                shell=True, capture_output=True, text=True,
            )
            self.assertNotIn("--user", command)
            self.assertNotIn("--break-system-packages", command)
            self.assertIn("No matching distribution found", result.stderr)

    def test_fix_recheck_adds_new_user_site_to_current_process(self) -> None:
        check = env_doctor.Check(
            "fixture",
            "fixture",
            "fixture",
            lambda: (True, "ready"),
            fix=[f'{env_doctor.PYQ} -c "raise SystemExit(0)"'],
            auto=True,
        )
        missing = env_doctor.Result(check, "missing", "not ready")

        with tempfile.TemporaryDirectory() as directory, patch.object(
            env_doctor.site, "getusersitepackages", return_value=directory
        ), patch.object(env_doctor.site, "ENABLE_USER_SITE", True
        ), patch.object(env_doctor.importlib, "invalidate_caches") as invalidate, patch.object(
            env_doctor, "CHECKS", [check]
        ):
            if directory in sys.path:
                sys.path.remove(directory)
            try:
                result = env_doctor.do_fix([missing])
                self.assertIn(directory, sys.path)
                invalidate.assert_called_once_with()
                self.assertEqual(result[0].status, "ok")
            finally:
                if directory in sys.path:
                    sys.path.remove(directory)


if __name__ == "__main__":
    unittest.main()
