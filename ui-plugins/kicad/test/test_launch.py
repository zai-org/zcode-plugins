"""Hermetic tests for server/kicad_launch.py: fake `open`, `pgrep` and `xattr` programs on PATH, a fixture crash report, no KiCad, no GUI.
Run by test/static.test.mjs (`pnpm test`) or directly: python3 test/test_launch.py
"""
from __future__ import annotations

import os
import shutil
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
FAST = dict(appear_s=2.0, stable_s=0.5, report_s=2.0, poll_s=0.05)  # the real defaults are 8 / 2 / 4 / 0.25 s

OPEN = """#!/bin/sh
echo "$@" >> "$FAKE_DIR/open.log"
case "$FAKE_OPEN" in
  fail)
    echo "The application cannot be opened for an unexpected reason" >&2
    exit 1 ;;
  stay)
    touch "$FAKE_DIR/alive" ;;
  crash)   # dies before pgrep ever sees it; the crash reporter writes the report a moment later
    ( sleep 0.15; cp "$FAKE_FIXTURE" "$FAKE_REPORTS/pcbnew-2026-10-19-190037.ips" ) >/dev/null 2>&1 &
    ;;
  die)     # pgrep sees it for FAKE_ALIVE_CALLS polls and then never again (counted, not timed: no race on a loaded machine); the report (if any) arrives FAKE_REPORT_DELAY s later
    touch "$FAKE_DIR/alive"
    if [ -n "$FAKE_FIXTURE" ]; then
      ( sleep "${FAKE_REPORT_DELAY:-0}"; cp "$FAKE_FIXTURE" "$FAKE_REPORTS/pcbnew-2026-10-19-190037.ips" ) >/dev/null 2>&1 &
    fi
    ;;
esac
exit 0
"""
PGREP = """#!/bin/sh
echo "$@" >> "$FAKE_DIR/pgrep.log"
if [ -e "$FAKE_DIR/alive" ]; then
  if [ -n "$FAKE_ALIVE_CALLS" ] && [ "$(wc -l < "$FAKE_DIR/pgrep.log")" -gt "$FAKE_ALIVE_CALLS" ]; then exit 1; fi
  echo 4242; exit 0
fi
exit 1
"""
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
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.bin = self.tmp / "bin"
        self.reports = self.tmp / "reports"
        self.bin.mkdir()
        self.reports.mkdir()
        for name, body in (("open", OPEN), ("pgrep", PGREP), ("xattr", XATTR)):
            f = self.bin / name
            f.write_text(body)
            f.chmod(f.stat().st_mode | stat.S_IXUSR)
        self.editor = Path("/fake/KiCad/PCB Editor.app")
        self.app_dir = Path("/fake/KiCad/KiCad.app")
        self.pcb = self.tmp / "board.kicad_pcb"
        saved = dict(os.environ)
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(saved)))
        os.environ.update(PATH=f"{self.bin}:/usr/bin:/bin", FAKE_DIR=str(self.tmp), FAKE_REPORTS=str(self.reports), FAKE_FIXTURE=str(FIXTURE), FAKE_OPEN="nothing",
                          FAKE_QUARANTINED="", FAKE_REPORT_DELAY="0")

    def launch(self, **kw):
        return kl.launch_editor(self.editor, self.pcb, self.app_dir, report_dir=self.reports, **{**FAST, **kw})

    def log(self, name):
        f = self.tmp / f"{name}.log"
        return f.read_text().splitlines() if f.exists() else []

    def test_stays_up(self):
        os.environ["FAKE_OPEN"] = "stay"
        t = time.monotonic()
        self.assertEqual(self.launch(), (True, "opened in PCB Editor.app"))
        self.assertGreaterEqual(time.monotonic() - t, FAST["stable_s"], "must have watched the process for the whole stable window")
        self.assertEqual(self.log("open"), [f"-a {self.editor} {self.pcb}"])
        self.assertIn("-x pcbnew", self.log("pgrep")[0])
        self.assertEqual(self.log("xattr"), [], "nothing to diagnose when it runs")

    def test_open_fails(self):
        os.environ["FAKE_OPEN"] = "fail"
        ok, note = self.launch()
        self.assertFalse(ok)
        self.assertEqual(note, "open failed: The application cannot be opened for an unexpected reason")

    def test_translocation_crash_names_the_fix_and_never_runs_it(self):
        os.environ.update(FAKE_OPEN="crash", FAKE_QUARANTINED="/fake/KiCad/KiCad.app /fake/KiCad")
        ok, note = self.launch()
        self.assertFalse(ok)
        self.assertIn("crashed right after it was opened", note)
        self.assertIn("Library not loaded: @rpath/libkicommon.10.0.6.dylib", note)
        self.assertIn("App Translocation", note)
        self.assertTrue(note.endswith("xattr -dr com.apple.quarantine /fake/KiCad"), note)
        self.assertNotIn("Referenced from", note, "the note stays short")
        self.assertLess(len(note), 600)
        self.assertTrue(all(line.startswith("-p com.apple.quarantine ") for line in self.log("xattr")), "xattr may only read: " + repr(self.log("xattr")))

    def test_translocation_in_the_report_is_enough_without_the_flag(self):
        os.environ.update(FAKE_OPEN="crash", FAKE_QUARANTINED="")
        ok, note = self.launch()
        self.assertFalse(ok)
        self.assertIn("temporary quarantined copy (App Translocation)", note)
        self.assertIn("xattr -dr com.apple.quarantine /fake/KiCad", note)

    def test_started_then_died_waits_for_the_crash_report(self):
        os.environ.update(FAKE_OPEN="die", FAKE_ALIVE_CALLS="2", FAKE_REPORT_DELAY="0.3", FAKE_QUARANTINED="/fake/KiCad")
        ok, note = self.launch(stable_s=30.0)  # never reached: the process is gone after two polls
        self.assertFalse(ok)
        self.assertIn("Library not loaded", note)
        self.assertIn("xattr -dr com.apple.quarantine /fake/KiCad", note)

    def test_died_without_report_and_without_quarantine(self):
        os.environ.update(FAKE_OPEN="die", FAKE_ALIVE_CALLS="2", FAKE_FIXTURE="")
        ok, note = self.launch(stable_s=30.0)
        self.assertFalse(ok)
        self.assertIn("quit again", note)
        self.assertIn("no crash report found", note)
        self.assertNotIn("xattr -dr", note, "no evidence of quarantine: do not send the user off to change attributes")

    def test_never_appears(self):
        os.environ.update(FAKE_OPEN="nothing", FAKE_QUARANTINED="/fake/KiCad/KiCad.app")
        t = time.monotonic()
        ok, note = self.launch()
        self.assertFalse(ok)
        self.assertGreaterEqual(time.monotonic() - t, FAST["appear_s"])
        self.assertIn("did not start within 2 s", note)
        self.assertIn("quarantine flag", note)
        self.assertIn("xattr -dr com.apple.quarantine /fake/KiCad", note)

    def test_report_from_before_the_launch_is_ignored(self):
        old = self.reports / "pcbnew-2026-10-18-101010.ips"
        shutil.copy(FIXTURE, old)
        os.utime(old, (time.time() - 3600, time.time() - 3600))
        os.environ["FAKE_OPEN"] = "nothing"
        ok, note = self.launch()
        self.assertFalse(ok)
        self.assertIn("did not start", note)
        self.assertNotIn("Library not loaded", note)

    def test_odd_reports_never_raise(self):
        for content in ("", "not json at all", "{}\n{}", "{}\n[1, 2]", '{"a":1}\n{"termination": {"reasons": "x"}', "\x00\x01\x02", "{}\n" + "x" * 5000):
            with self.subTest(content=content[:20]):
                for f in self.reports.glob("*"):
                    f.unlink()
                odd = self.tmp / "odd.ips"
                odd.write_text(content)
                os.environ.update(FAKE_OPEN="crash", FAKE_FIXTURE=str(odd))  # written during the launch, like a real report
                ok, note = self.launch()
                self.assertFalse(ok)
                self.assertIn("crashed right after it was opened", note)
                self.assertIn("pcbnew-2026-10-19-190037.ips", note, "unreadable report: name the file instead")

    def test_missing_report_directory(self):
        os.environ["FAKE_OPEN"] = "nothing"
        ok, note = kl.launch_editor(self.editor, self.pcb, self.app_dir, report_dir=self.tmp / "no-such-dir", **{**FAST, "appear_s": 0.2})
        self.assertEqual(ok, False)
        self.assertIn("did not start", note)

    def test_pgrep_unavailable_is_not_reported_as_a_failure(self):
        shutil.move(str(self.bin / "pgrep"), str(self.tmp / "pgrep-away"))
        os.environ["PATH"] = str(self.bin)  # no pgrep anywhere; the fake `open` only needs shell builtins in the "nothing" mode
        ok, note = self.launch()
        self.assertTrue(ok)
        self.assertIn("could not check", note)

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
