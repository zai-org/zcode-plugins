#!/usr/bin/env python3
"""TASK-011 relay_hook v2 单元测试（仅标准库；合成 stdin + 临时 RELAY_HOOK_ROOT，不触生产 runtime）。

运行：
    python tests/task-010/test_relay_hook_chat.py
stdin 合同依据 reports/task-010-zcode-relay/EVENT-CHAIN.md（VERIFIED_LOCAL）：
公共字段双命名（snake_case 与 camelCase 同值），hook 以 snake_case 为规范、camelCase 兜底。
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
HOOK = os.path.join(ROOT_REPO, "hooks", "relay_hook.py")
CHAT_SEND = os.path.join(ROOT_REPO, "tools", "chat_send.py")
PY = sys.executable

EMP = "sess_1111aaaa-0000-0000-0000-000000000000"   # 短标识 1111aaaa
LEADER = "sess_9999bbbb-0000-0000-0000-000000000000"


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class Base(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="relay-hook-test-")
        for sub in ("inbox", "claimed", "outbox", "runtime", "chat"):
            os.makedirs(os.path.join(self.root, "relay", sub), exist_ok=True)

    def run_hook(self, event, sid=EMP, turn="t1", extra=None, cwd=None, raw=None, use_env_root=True):
        payload = {
            "session_id": sid, "sessionId": sid,
            "turn_id": turn, "turnId": turn,
            "cwd": cwd or self.root,
        }
        payload.update(extra or {})
        env = dict(os.environ)
        if use_env_root:
            env["RELAY_HOOK_ROOT"] = self.root
        else:
            env.pop("RELAY_HOOK_ROOT", None)
        proc = subprocess.run(
            [PY, HOOK, event],
            input=raw if raw is not None else json.dumps(payload).encode("utf-8"),
            capture_output=True, env=env, timeout=30)
        return proc.returncode, proc.stdout.decode("utf-8", "replace")

    def write_card(self, task_id="TASK-X01", worker="any", prompt="do the thing"):
        card = {"version": "1.1", "task_id": task_id, "worker": worker,
                "prompt": prompt, "prompt_sha256": sha256(prompt)}
        path = os.path.join(self.root, "relay", "inbox", task_id + ".json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(card, f, ensure_ascii=False)
        return path

    def write_chat(self, dirname, body="hi", msg_id="m1", good_sha=True, kind="NOTICE", frm="leader"):
        pend = os.path.join(self.root, "relay", "chat", dirname, "pending")
        os.makedirs(pend, exist_ok=True)
        msg = {"version": "1.0", "msg_id": msg_id, "seq": 1, "from": frm,
               "to": dirname, "kind": kind, "body": body, "ref": "", "created_at": "2026-09-18T00:00:00Z",
               "body_sha256": sha256(body) if good_sha else "0" * 64}
        path = os.path.join(pend, "0001-%s.json" % msg_id)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(msg, f, ensure_ascii=False)
        return path

    def claimed_files(self):
        return os.listdir(os.path.join(self.root, "relay", "claimed"))

    def chat_read(self, dirname):
        d = os.path.join(self.root, "relay", "chat", dirname, "read")
        return os.listdir(d) if os.path.isdir(d) else []


class StopCardAndChat(Base):
    def test_card_any_claim_and_inject(self):
        self.write_card("TASK-C1")
        rc, out = self.run_hook("Stop")
        self.assertEqual(rc, 0)
        self.assertEqual(len(self.claimed_files()), 1)
        data = json.loads(out)
        self.assertEqual(data["decision"], "block")
        self.assertIn("TASK-C1", data["reason"])

    def test_worker_zcode_claimable(self):  # 保留 v3 行为
        self.write_card("TASK-Z9", worker="zcode")
        rc, out = self.run_hook("Stop")
        self.assertEqual(rc, 0)
        self.assertEqual(len(self.claimed_files()), 1)
        self.assertIn("TASK-Z9", out)

    def test_chat_short_dir_claim_and_inject(self):
        self.write_chat("to-sess-1111aaaa", body="员工你好")
        rc, out = self.run_hook("Stop")
        self.assertEqual(rc, 0)
        self.assertIn("【relay 消息】", out)
        self.assertIn("员工你好", out)
        self.assertEqual(len(self.chat_read("to-sess-1111aaaa")), 1)

    def test_card_and_chat_merged_single_output(self):
        self.write_card("TASK-M1")
        self.write_chat("to-sess-1111aaaa", body="顺带消息")
        rc, out = self.run_hook("Stop")
        data = json.loads(out)
        self.assertEqual(data["decision"], "block")
        self.assertIn("【relay 自动续接】", data["reason"])
        self.assertIn("【relay 消息】", data["reason"])
        self.assertEqual(len(self.claimed_files()), 1)
        self.assertEqual(len(self.chat_read("to-sess-1111aaaa")), 1)

    def test_leader_gets_chat_not_card(self):
        with open(os.path.join(self.root, "relay", "runtime", "leader-sessions.txt"), "w", encoding="utf-8") as f:
            f.write(LEADER + "\n")
        self.write_card("TASK-L1")
        self.write_chat("to-leader", body="领导请审阅")
        rc, out = self.run_hook("Stop", sid=LEADER)
        self.assertEqual(rc, 0)
        self.assertEqual(self.claimed_files(), [])                       # 未领卡
        self.assertIn("TASK-L1.json", os.listdir(os.path.join(self.root, "relay", "inbox")))
        self.assertIn("【relay 消息】", out)
        self.assertEqual(len(self.chat_read("to-leader")), 1)

    def test_role_dir_via_roles_json(self):
        with open(os.path.join(self.root, "relay", "runtime", "roles.json"), "w", encoding="utf-8") as f:
            json.dump({"employees": {"employee-4": {"short": "1111aaaa"}}, "leader": {}}, f)
        self.write_chat("to-employee-4", body="按角色收")
        rc, out = self.run_hook("Stop")
        self.assertEqual(rc, 0)
        self.assertIn("按角色收", out)

    def test_other_session_chat_not_taken(self):
        self.write_chat("to-sess-7777cccc", body="别人的")
        rc, out = self.run_hook("Stop")
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")                                 # 无本会话内容 → 不注入
        pend = os.path.join(self.root, "relay", "chat", "to-sess-7777cccc", "pending")
        self.assertEqual(len(os.listdir(pend)), 1)                       # 原地不动


class Guards(Base):
    def test_same_turn_dedup(self):
        self.write_card("TASK-D1")
        self.run_hook("Stop", turn="t1")
        self.write_card("TASK-D2")                                       # 同 turn 再来一张
        rc, out = self.run_hook("Stop", turn="t1")
        self.assertEqual(out.strip(), "")
        self.assertEqual(sorted(os.listdir(os.path.join(self.root, "relay", "inbox"))), ["TASK-D2.json"])

    def test_max_chain_blocks(self):
        st_dir = os.path.join(self.root, "relay", "runtime")
        state = "chain-state-%s.json" % EMP[:13]
        with open(os.path.join(st_dir, state), "w", encoding="utf-8") as f:
            json.dump({"count": 3, "last_turn": "t0"}, f)
        self.write_card("TASK-K1")
        rc, out = self.run_hook("Stop", turn="t9", extra={"stopHookActive": True, "stop_hook_active": True})
        self.assertEqual(out.strip(), "")
        self.assertEqual(self.claimed_files(), [])
        self.assertEqual(sorted(os.listdir(os.path.join(self.root, "relay", "inbox"))), ["TASK-K1.json"])

    def test_chat_bad_sha_quarantined(self):
        self.write_chat("to-sess-1111aaaa", body="损坏消息", good_sha=False)
        rc, out = self.run_hook("Stop")
        self.assertEqual(out.strip(), "")
        read = self.chat_read("to-sess-1111aaaa")
        self.assertEqual(read, ["0001-m1.json.bad"])                     # 隔离为 .bad
        with open(os.path.join(self.root, "relay", "runtime", "chain-log.jsonl"), encoding="utf-8") as f:
            log = f.read()
        self.assertIn("chat-quarantine", log)

    def test_garbage_stdin_failopen(self):
        rc, out = self.run_hook("Stop", raw=b"not-json{")
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")

    def test_out_of_scope_cwd_ignored(self):
        self.write_card("TASK-S1")
        rc, out = self.run_hook("Stop", cwd=os.path.join(tempfile.gettempdir(), "elsewhere"))
        self.assertEqual(out.strip(), "")
        self.assertEqual(self.claimed_files(), [])

    def test_camel_only_naming(self):
        payload = {"sessionId": EMP, "turnId": "t1", "cwd": self.root}
        env = dict(os.environ)
        env["RELAY_HOOK_ROOT"] = self.root
        self.write_card("TASK-N1")
        proc = subprocess.run([PY, HOOK, "Stop"], input=json.dumps(payload).encode(),
                              capture_output=True, env=env, timeout=30)
        self.assertEqual(proc.returncode, 0)
        self.assertIn("TASK-N1", proc.stdout.decode("utf-8", "replace"))
        self.assertEqual(len(self.claimed_files()), 1)


class Ups(Base):
    def test_flag_off_silent(self):
        self.write_chat("to-sess-1111aaaa", body="门控关")
        rc, out = self.run_hook("UserPromptSubmit", extra={"prompt": "用户消息"})
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")

    def test_flag_on_injects_additional_context(self):
        open(os.path.join(self.root, "relay", "runtime", "ups-context-enabled"), "w").close()
        self.write_chat("to-sess-1111aaaa", body="门控开", kind="DISPATCH")
        rc, out = self.run_hook("UserPromptSubmit", extra={"prompt": "用户消息"})
        self.assertEqual(rc, 0)
        data = json.loads(out)
        ctx = data["hookSpecificOutput"]["additionalContext"]
        self.assertIn("【relay 消息】", ctx)
        self.assertIn("门控开", ctx)
        self.assertEqual(len(self.chat_read("to-sess-1111aaaa")), 1)


class V3MarkerRouting(Base):
    """v3：relay/relay.enabled 标记路由（多项目零配置激活）。"""

    def write_marker(self):
        with open(os.path.join(self.root, "relay", "relay.enabled"), "w", encoding="utf-8") as f:
            f.write("testproj 2026-09-18\n")

    def test_marker_dir_activates_without_env(self):
        self.write_marker()
        self.write_card("TASK-V3A")
        rc, out = self.run_hook("Stop", use_env_root=False)   # cwd=self.root 且有标记
        self.assertEqual(rc, 0)
        self.assertIn("TASK-V3A", out)
        self.assertEqual(len(self.claimed_files()), 1)
        self.assertTrue(os.path.isfile(os.path.join(self.root, "relay", "runtime", "chain-log.jsonl")))

    def test_no_marker_no_env_silent(self):
        self.write_card("TASK-V3B")                            # 无标记、无环境变量
        rc, out = self.run_hook("Stop", use_env_root=False)
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")
        self.assertEqual(self.claimed_files(), [])
        self.assertEqual(os.listdir(os.path.join(self.root, "relay", "runtime")), [])

    def test_marker_wins_over_env(self):
        self.write_marker()
        other = tempfile.mkdtemp(prefix="relay-hook-other-")   # 环境变量指向别处，标记应胜出
        self.write_card("TASK-V3C")
        env = dict(os.environ)
        env["RELAY_HOOK_ROOT"] = other
        payload = {"session_id": EMP, "sessionId": EMP, "turn_id": "t1", "turnId": "t1", "cwd": self.root}
        proc = subprocess.run([PY, HOOK, "Stop"], input=json.dumps(payload).encode(),
                              capture_output=True, env=env, timeout=30)
        self.assertIn("TASK-V3C", proc.stdout.decode("utf-8", "replace"))
        self.assertEqual(len(self.claimed_files()), 1)


class ChatSendRoundtrip(Base):
    def test_send_then_hook_claims(self):
        env = dict(os.environ)
        proc = subprocess.run(
            [PY, CHAT_SEND, "--from", "leader", "--to", "sess:1111aaaa",
             "--kind", "NOTICE", "--body", "回环消息", "--root", self.root],
            capture_output=True, env=env, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
        pend = os.path.join(self.root, "relay", "chat", "to-sess-1111aaaa", "pending")
        self.assertEqual(len(os.listdir(pend)), 1)
        rc, out = self.run_hook("Stop")
        self.assertIn("回环消息", out)
        self.assertEqual(len(self.chat_read("to-sess-1111aaaa")), 1)

    def test_send_rejects_bad_kind(self):
        proc = subprocess.run(
            [PY, CHAT_SEND, "--from", "leader", "--to", "employee-4",
             "--kind", "SHOUT", "--body", "x", "--root", self.root],
            capture_output=True, timeout=30)
        self.assertEqual(proc.returncode, 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
