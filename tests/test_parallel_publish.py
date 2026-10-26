from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import publish_incremental as publish


class ParallelArchiveTest(unittest.TestCase):
    def setUp(self):
        self.items = [
            {"zip_path": Path(f"{name}.zip"), "rel": f"plugins/{name}/1.0.0/plugin.zip"}
            for name in ("a", "b", "c")
        ]

    def test_uploads_overlap_without_exceeding_the_limit(self):
        release = threading.Event()
        two_started = threading.Event()
        lock = threading.Lock()
        active = maximum = 0
        started = []

        def upload(_path, _bucket, _prefix, rel, **kwargs):
            nonlocal active, maximum
            self.assertEqual(kwargs["timeout_scale"], 2)
            with lock:
                active += 1
                maximum = max(maximum, active)
                started.append(rel)
                if active == 2:
                    two_started.set()
            try:
                if not release.wait(5):
                    raise AssertionError("test did not release the uploads")
            finally:
                with lock:
                    active -= 1

        with patch.object(publish, "DRY_RUN", False), \
             patch.object(publish, "oss_upload", side_effect=upload), \
             patch.object(publish, "log"), \
             ThreadPoolExecutor(max_workers=1) as caller:
            result = caller.submit(publish.upload_archives, self.items, "bucket", "prefix", 2)
            try:
                self.assertTrue(two_started.wait(5), "archive uploads did not overlap")
                self.assertFalse(result.done(), "returned before uploads completed")
                with lock:
                    self.assertEqual(len(started), 2)
            finally:
                release.set()
            result.result(timeout=5)
        self.assertEqual(maximum, 2)
        self.assertEqual(active, 0)
        self.assertCountEqual(started, [item["rel"] for item in self.items])

    def test_dry_run_and_single_worker_keep_deterministic_order(self):
        for dry_run, workers in ((True, 4), (False, 1)):
            with self.subTest(dry_run=dry_run, workers=workers), \
                 patch.object(publish, "DRY_RUN", dry_run), \
                 patch.object(publish, "ThreadPoolExecutor", side_effect=AssertionError("unexpected worker")), \
                 patch.object(publish, "oss_upload") as upload:
                publish.upload_archives(self.items, "bucket", "prefix", workers)
            self.assertEqual([c.args[3] for c in upload.call_args_list],
                             [item["rel"] for item in self.items])

    def test_default_and_override(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(publish.archive_upload_concurrency(), 4)
        with patch.dict(os.environ, {"OSS_UPLOAD_CONCURRENCY": "1"}):
            self.assertEqual(publish.archive_upload_concurrency(), 1)

    def test_parallel_timeout_allows_for_shared_uplink(self):
        size = 8 * 1024 * 1024
        serial = publish.upload_timeout(size) - publish.OSS_UPLOAD_BASE_TIMEOUT
        parallel = publish.upload_timeout(size, 4) - publish.OSS_UPLOAD_BASE_TIMEOUT
        self.assertEqual(parallel, serial * 4)

    def test_failure_waits_for_in_flight_uploads_before_returning(self):
        second_started = threading.Event()
        failure_raised = threading.Event()
        release = threading.Event()
        second_finished = threading.Event()

        def upload(_path, _bucket, _prefix, rel, **_kwargs):
            if rel.startswith("plugins/a/"):
                if not second_started.wait(5):
                    raise AssertionError("second upload did not start")
                failure_raised.set()
                raise RuntimeError("upload failed")
            second_started.set()
            if not release.wait(5):
                raise AssertionError("test did not release in-flight upload")
            second_finished.set()

        with patch.object(publish, "DRY_RUN", False), \
             patch.object(publish, "oss_upload", side_effect=upload), \
             patch.object(publish, "log"), \
             ThreadPoolExecutor(max_workers=1) as caller:
            result = caller.submit(publish.upload_archives, self.items[:2], "bucket", "prefix", 2)
            try:
                self.assertTrue(failure_raised.wait(5))
                self.assertFalse(result.done())
            finally:
                release.set()
            with self.assertRaisesRegex(RuntimeError, "upload failed"):
                result.result(timeout=5)
        self.assertTrue(second_finished.is_set())


class CatalogBarrierTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.output = self.root / "output"
        self.output.mkdir()
        entries = []
        for name in ("a", "b"):
            (self.root / "plugins" / name).mkdir(parents=True)
            entries.append({"name": name, "version": "1.0.0", "source": f"./plugins/{name}"})
        (self.root / "marketplace.json").write_text(json.dumps({"name": "test", "plugins": entries}))

        def build(_directory, path):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"archive")

        patches = [
            patch.dict(os.environ, {"OSS_BUCKET": "bucket", "OSS_PATH_PREFIX": "prefix",
                                   "CDN_BASE_URL": "https://cdn.example.test",
                                   "OSS_UPLOAD_CONCURRENCY": "2"}),
            patch.multiple(publish, ROOT=self.root, DRY_RUN=False,
                           FAILURE_FILE=self.root / "failure.txt"),
            patch.object(publish.shutil, "which", return_value="/test/ossutil"),
            patch.object(publish, "preflight_cache_control_style"),
            patch.object(publish.tempfile, "mkdtemp", return_value=str(self.output)),
            patch.object(publish, "oss_download", return_value=False),
            patch.object(publish, "oss_object_exists", return_value=False),
            patch.object(publish, "build_zip", side_effect=build),
            patch.object(publish, "build_index_entry", side_effect=lambda entry, *_: dict(entry)),
            patch.object(publish, "plan_assets", return_value=([], [], 0)),
            patch.object(publish, "oss_upload_assets"),
            patch.object(publish, "log"),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_catalog_is_uploaded_only_after_every_archive_finishes(self):
        completed = set()
        lock = threading.Lock()

        def upload(_path, _bucket, _prefix, rel, **_kwargs):
            with lock:
                if rel == "marketplace.json":
                    self.assertEqual(completed, {"a", "b"})
                else:
                    completed.add(rel.split("/")[1])

        with patch.object(publish, "oss_upload", side_effect=upload) as uploads, \
             patch.object(publish, "preload_cdn"), patch.object(publish, "refresh_cdn"):
            self.assertEqual(publish.main(), 0)
        self.assertEqual(uploads.call_args_list[-1].args[3], "marketplace.json")

    def test_failed_archive_prevents_catalog_and_cdn_publication(self):
        def upload(_path, _bucket, _prefix, rel, **_kwargs):
            if rel.startswith("plugins/a/"):
                raise SystemExit(1)

        with patch.object(publish, "oss_upload", side_effect=upload) as uploads, \
             patch.object(publish, "preload_cdn") as preload, \
             patch.object(publish, "refresh_cdn") as refresh:
            with self.assertRaises(SystemExit):
                publish.main()
        self.assertNotIn("marketplace.json", [c.args[3] for c in uploads.call_args_list])
        preload.assert_not_called()
        refresh.assert_not_called()

    def test_invalid_limit_fails_before_any_remote_operation(self):
        for value in ("0", "-1", "17", "many"):
            with self.subTest(value=value), \
                 patch.dict(os.environ, {"OSS_UPLOAD_CONCURRENCY": value}), \
                 patch.object(publish, "preflight_cache_control_style") as preflight:
                with self.assertRaises(SystemExit):
                    publish.main()
                preflight.assert_not_called()


if __name__ == "__main__":
    unittest.main()
