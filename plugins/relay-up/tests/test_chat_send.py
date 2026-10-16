#!/usr/bin/env python3
"""TASK-011 chat_send.py 单元测试（仅标准库；子进程调用 + 临时 --root，不触生产 relay/）。

运行：
    python tests/task-010/test_chat_send.py
覆盖 TASK-011-Q01 卡要求：seq 递增（同收件人连发两条 seq=1,2）、非法 kind exit 2、
body 超 4000 字 exit 2、--to sess:xxxx 目录规范化为 to-sess-xxxx、UTF-8 中文正文写读一致。
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT_REPO = os.path.normpath(os.path.join(HERE, ".."))
CHAT_SEND = os.path.join(ROOT_REPO, "tools", "chat_send.py")
PY = sys.executable


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class Base(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="relay-chatsend-test-")

    def run_send(self, *extra):
        proc = subprocess.run(
            [PY, CHAT_SEND, "--root", self.root] + list(extra),
            capture_output=True, timeout=30)
        return (proc.returncode,
                proc.stdout.decode("utf-8", "replace"),
                proc.stderr.decode("utf-8", "replace"))

    def pend_dir(self, to_dir):
        return os.path.join(self.root, "relay", "chat", to_dir, "pending")

    def read_msg(self, to_dir):
        pend = self.pend_dir(to_dir)
        names = sorted(os.listdir(pend))
        self.assertEqual(len(names), 1)
        with open(os.path.join(pend, names[0]), encoding="utf-8") as f:
            raw = f.read()
        return names[0], raw, json.loads(raw)


class Seq(Base):
    def test_seq_increments_same_recipient(self):
        rc1, _, err1 = self.run_send("--from", "1111aaaa", "--to", "employee-4",
                                     "--kind", "NOTICE", "--body", "第一条")
        self.assertEqual(rc1, 0, err1)
        rc2, _, err2 = self.run_send("--from", "1111aaaa", "--to", "employee-4",
                                     "--kind", "NOTICE", "--body", "第二条")
        self.assertEqual(rc2, 0, err2)
        pend = self.pend_dir("to-employee-4")
        names = sorted(os.listdir(pend))
        self.assertEqual([n[:4] for n in names], ["0001", "0002"])
        seqs = []
        for n in names:
            with open(os.path.join(pend, n), encoding="utf-8") as f:
                seqs.append(json.load(f)["seq"])
        self.assertEqual(seqs, [1, 2])


class Guards(Base):
    def test_bad_kind_exit2_no_file(self):
        rc, _, err = self.run_send("--from", "1111aaaa", "--to", "employee-4",
                                   "--kind", "SHOUT", "--body", "x")
        self.assertEqual(rc, 2)
        self.assertIn("kind", err)
        self.assertFalse(os.path.isdir(self.pend_dir("to-employee-4")))

    def test_body_over_4000_exit2_no_file(self):
        rc, _, err = self.run_send("--from", "1111aaaa", "--to", "employee-4",
                                   "--kind", "CHAT", "--body", "x" * 4001)
        self.assertEqual(rc, 2)
        self.assertIn("4000", err)
        self.assertFalse(os.path.isdir(self.pend_dir("to-employee-4")))


class Addressing(Base):
    def test_sess_to_normalized_to_dir(self):
        rc, _, err = self.run_send("--from", "leader", "--to", "sess:abcd1234",
                                   "--kind", "DISPATCH", "--body", "定向消息")
        self.assertEqual(rc, 0, err)
        self.assertTrue(os.path.isdir(self.pend_dir("to-sess-abcd1234")))
        self.assertFalse(os.path.isdir(self.pend_dir("sess:abcd1234")))
        _, _, msg = self.read_msg("to-sess-abcd1234")
        self.assertEqual(msg["to"], "sess:abcd1234")   # 目录规范化，消息字段保留原值


class Encoding(Base):
    def test_utf8_chinese_roundtrip(self):
        body = "中文正文：员工自举完成，写读一致（含全角标点）。"
        rc, out, err = self.run_send("--from", "1111aaaa", "--to", "employee-4",
                                     "--kind", "NOTICE", "--body", body)
        self.assertEqual(rc, 0, err)
        self.assertTrue(out.startswith("OK "))
        name, raw, msg = self.read_msg("to-employee-4")
        self.assertIn("员工自举完成", raw)              # ensure_ascii=False，中文原样落盘
        self.assertEqual(msg["body"], body)
        self.assertEqual(msg["body_sha256"], sha256(body))
        self.assertEqual(msg["kind"], "NOTICE")


if __name__ == "__main__":
    unittest.main(verbosity=2)
