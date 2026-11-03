"""Hermetic tests for server/kicad_launch.py: a fake pcbnew process and real Unix sockets, no KiCad and no GUI.

Run by test/static.test.mjs (``pnpm test``) or directly: ``python3 test/test_launch.py``.
"""
from __future__ import annotations

import os
import shutil
import signal
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "server"))
import kicad_launch as kl  # noqa: E402

FIXTURE = HERE / "fixtures" / "pcbnew-translocated.ips"
FAST = dict(stable_s=0.2, socket_s=0.4, report_s=0.5, poll_s=0.02)

PCBNEW = r'''#!/usr/bin/env python3
import os
import shutil
import socket
import sys
import time
from pathlib import Path

root = Path(os.environ["FAKE_DIR"])
with (root / "pids").open("a") as f:
    f.write(str(os.getpid()) + "\n")
(root / "argv").write_text("\n".join(sys.argv[1:]))
(root / "child-env").write_text("KICAD_CONFIG_HOME=" + os.environ.get("KICAD_CONFIG_HOME", "<unset>") + "\nKICAD_DOCUMENTS_HOME=" + os.environ.get("KICAD_DOCUMENTS_HOME", "<unset>"))
mode = os.environ.get("FAKE_MODE", "stay")
if mode == "crash":
    shutil.copyfile(os.environ["FAKE_FIXTURE"], Path(os.environ["FAKE_REPORTS"]) / "pcbnew-2026-10-19-190037.ips")
    raise SystemExit(7)
if mode == "odd_crash":
    shutil.copyfile(os.environ["FAKE_FIXTURE"], Path(os.environ["FAKE_REPORTS"]) / "pcbnew-2026-10-19-190037.ips")
    raise SystemExit(8)
if mode == "die":
    raise SystemExit(9)
sock = None
if mode == "stay":
    socket_dir = Path(os.environ["FAKE_SOCKET_DIR"])
    socket_dir.mkdir(parents=True, exist_ok=True)
    sock = socket.socket(socket.AF_UNIX)
    sock.bind(str(socket_dir / ("api-" + str(os.getpid()) + ".sock")))
    sock.listen()
time.sleep(60)
'''

XATTR = """#!/bin/sh
echo "$@" >> "$FAKE_DIR/xattr.log"
for q in $FAKE_QUARANTINED; do
  if [ "$3" = "$q" ]; then echo "0081;00000000;Test;"; exit 0; fi
done
echo "xattr: $3: No such xattr: com.apple.quarantine" >&2
exit 1
"""


class LaunchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="kicad-launch-test-"))
        self.addCleanup(self.cleanup)
        self.bin = self.tmp / "bin"
        self.reports = self.tmp / "reports"
        self.sockets = self.tmp / "sockets"
        self.editor = self.tmp / "KiCad" / "PCB Editor.app"
        self.app_dir = self.tmp / "KiCad" / "KiCad.app"
        self.exe = kl.pcbnew_executable(self.editor)
        self.bin.mkdir()
        self.reports.mkdir()
        self.sockets.mkdir()
        self.exe.parent.mkdir(parents=True)
        self.exe.write_text(PCBNEW)
        self.exe.chmod(self.exe.stat().st_mode | stat.S_IXUSR)
        xattr = self.bin / "xattr"
        xattr.write_text(XATTR)
        xattr.chmod(xattr.stat().st_mode | stat.S_IXUSR)
        self.pcb = self.tmp / "board.kicad_pcb"
        self.pcb.write_text("(kicad_pcb)")
        saved = dict(os.environ)
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(saved)))
        os.environ.update(
            PATH=f"{self.bin}:/usr/bin:/bin",
            FAKE_DIR=str(self.tmp),
            FAKE_REPORTS=str(self.reports),
            FAKE_FIXTURE=str(FIXTURE),
            FAKE_SOCKET_DIR=str(self.sockets),
            FAKE_MODE="stay",
            FAKE_QUARANTINED="",
        )

    def cleanup(self):
        try:
            for raw in (self.tmp / "pids").read_text().splitlines():
                try:
                    os.kill(int(raw), signal.SIGTERM)
                except (ProcessLookupError, ValueError):
                    pass
        except OSError:
            pass
        time.sleep(0.02)
        kl.reap_children()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def launch(self, **kw):
        child_env = dict(os.environ)
        return kl.launch_editor(self.editor, self.pcb, self.app_dir, report_dir=self.reports, socket_dir=self.sockets, env=child_env, **{**FAST, **kw})

    def log(self, name):
        f = self.tmp / name
        return f.read_text().splitlines() if f.exists() else []

    def test_exact_child_stays_up_and_creates_live_socket(self):
        t = time.monotonic()
        self.assertEqual(self.launch(), (True, "opened in PCB Editor.app; live KiCad API ready"))
        self.assertGreaterEqual(time.monotonic() - t, FAST["stable_s"], "must watch the exact process for the whole stability window")
        self.assertEqual(self.log("argv"), [str(self.pcb)])
        self.assertEqual(self.log("xattr.log"), [], "nothing to diagnose when it runs")

    def test_no_socket_is_honest_but_file_round_trip_still_launched(self):
        os.environ["FAKE_MODE"] = "no_socket"
        ok, note = self.launch()
        self.assertTrue(ok)
        self.assertIn("live API did not appear", note)
        self.assertIn("Enable KiCad API", note)
        self.assertIn("file save/sync still works", note)

    def test_no_socket_with_enabled_api_diagnoses_an_older_window_or_lock(self):
        os.environ["FAKE_MODE"] = "no_socket"
        ok, note = self.launch(api_expected=True)
        self.assertTrue(ok)
        self.assertIn('"Enable KiCad API" is on', note)
        self.assertIn("older PCB Editor window", note)
        self.assertIn("project-lock dialog", note)
        self.assertIn("file save/sync still works", note)

    def test_passed_gui_environment_is_used(self):
        child_env = dict(os.environ)
        child_env.pop("KICAD_CONFIG_HOME", None)
        child_env.pop("KICAD_DOCUMENTS_HOME", None)
        ok, _ = kl.launch_editor(self.editor, self.pcb, self.app_dir, report_dir=self.reports, socket_dir=self.sockets, env=child_env, **FAST)
        self.assertTrue(ok)
        self.assertEqual(self.log("child-env"), ["KICAD_CONFIG_HOME=<unset>", "KICAD_DOCUMENTS_HOME=<unset>"])

    def test_missing_executable_fails_before_launch(self):
        self.exe.unlink()
        ok, note = self.launch()
        self.assertFalse(ok)
        self.assertIn("not found or not executable", note)
        self.assertFalse((self.tmp / "pids").exists())

    def test_outer_editor_symlink_resolves_to_the_nested_executable(self):
        app = self.tmp / "Distribution" / "KiCad.app"
        nested = app / "Contents" / "Applications" / "pcbnew.app"
        exe = nested / "Contents" / "MacOS" / "pcbnew"
        exe.parent.mkdir(parents=True)
        exe.write_text("binary")
        outer = app.parent / "PCB Editor.app"
        outer.symlink_to(nested)
        self.assertEqual(kl.pcbnew_executable(outer), exe.resolve())

    def test_translocation_crash_names_the_fix_and_never_runs_it(self):
        os.environ.update(FAKE_MODE="crash", FAKE_QUARANTINED=f"{self.app_dir} {self.app_dir.parent}")
        ok, note = self.launch()
        self.assertFalse(ok)
        self.assertIn("crashed right after it was opened", note)
        self.assertIn("Library not loaded: @rpath/libkicommon.10.0.6.dylib", note)
        self.assertIn("App Translocation", note)
        self.assertTrue(note.endswith(f"xattr -dr com.apple.quarantine {self.app_dir.parent}"), note)
        self.assertNotIn("Referenced from", note, "the note stays short")
        self.assertLess(len(note), 600)
        self.assertTrue(all(line.startswith("-p com.apple.quarantine ") for line in self.log("xattr.log")), "xattr may only read")

    def test_translocation_in_the_report_is_enough_without_the_flag(self):
        os.environ.update(FAKE_MODE="crash", FAKE_QUARANTINED="")
        ok, note = self.launch()
        self.assertFalse(ok)
        self.assertIn("temporary quarantined copy (App Translocation)", note)
        self.assertIn(f"xattr -dr com.apple.quarantine {self.app_dir.parent}", note)

    def test_died_without_report_and_without_quarantine(self):
        os.environ.update(FAKE_MODE="die", FAKE_QUARANTINED="")
        ok, note = self.launch()
        self.assertFalse(ok)
        self.assertIn("exit 9", note)
        self.assertIn("no crash report found", note)
        self.assertNotIn("xattr -dr", note)

    def test_report_from_before_the_launch_is_ignored(self):
        old = self.reports / "pcbnew-2026-10-18-101010.ips"
        shutil.copy(FIXTURE, old)
        os.utime(old, (time.time() - 3600, time.time() - 3600))
        os.environ["FAKE_MODE"] = "die"
        ok, note = self.launch()
        self.assertFalse(ok)
        self.assertIn("exit 9", note)
        self.assertNotIn("Library not loaded", note)

    def test_odd_reports_never_raise(self):
        for content in ("", "not json at all", "{}\n{}", "{}\n[1, 2]", '{"a":1}\n{"termination": {"reasons": "x"}', "\x00\x01\x02", "{}\n" + "x" * 5000):
            with self.subTest(content=content[:20]):
                for f in self.reports.glob("*"):
                    f.unlink()
                odd = self.tmp / "odd.ips"
                odd.write_text(content)
                os.environ.update(FAKE_MODE="odd_crash", FAKE_FIXTURE=str(odd))
                ok, note = self.launch()
                self.assertFalse(ok)
                self.assertIn("crashed right after it was opened", note)
                self.assertIn("pcbnew-2026-10-19-190037.ips", note)

    def test_missing_report_directory(self):
        os.environ["FAKE_MODE"] = "die"
        ok, note = kl.launch_editor(self.editor, self.pcb, self.app_dir, report_dir=self.tmp / "no-such-dir", socket_dir=self.sockets, env=dict(os.environ), **FAST)
        self.assertFalse(ok)
        self.assertIn("exit 9", note)

    def test_crash_reason_of_the_real_report_shape(self):
        reason, translocated = kl.crash_reason(FIXTURE)
        self.assertEqual(reason, "Library not loaded: @rpath/libkicommon.10.0.6.dylib")
        self.assertTrue(translocated)
        self.assertEqual(kl.crash_reason(self.tmp / "missing.ips"), ("", False))

    def test_fix_dir_never_is_applications(self):
        self.assertEqual(kl.fix_dir(Path("/Applications/KiCad/KiCad.app")), Path("/Applications/KiCad"))
        self.assertEqual(kl.fix_dir(Path("/Applications/KiCad.app")), Path("/Applications/KiCad.app"))
        self.assertEqual(kl.fix_dir(Path("/home/someone/Applications/KiCad.app")), Path("/home/someone/Applications/KiCad.app"))

    def test_reports_dir_ignores_an_isolated_home(self):
        os.environ["HOME"] = str(self.tmp / "isolated-profile")
        self.assertNotIn("isolated-profile", str(kl.reports_dir()))
        self.assertTrue(str(kl.reports_dir()).endswith("Library/Logs/DiagnosticReports"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
