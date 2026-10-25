# SPDX-License-Identifier: Apache-2.0
"""Synthetic fixtures only: local sockets/processes, no model or account access."""
import argparse
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

HOOKS = Path(__file__).resolve().parents[1] / 'hooks'
sys.path.insert(0, str(HOOKS))
import common
import bridge
from status_core import State, identity
from monitor import hook_decision


class Contracts(unittest.TestCase):
    def test_missing_terminal_hook_expires_instead_of_stuck_working(self):
        s=State()
        for n,kind in enumerate(('SessionStart','UserPromptSubmit')):
            s.event(dict(seq=n,wall_ms=1000+n,event=kind,session_id='sess_test',native={}))
        self.assertEqual(hook_decision(s,100,129),('working','turn-in-progress'))
        self.assertEqual(hook_decision(s,100,130),('unknown','hook-status-expired'))
        self.assertEqual(hook_decision(s,None,100),('unknown','hook-status-expired'))

    def test_hooks_only_stop_does_not_claim_completion(self):
        s = State()
        for n, kind in enumerate(('SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop')):
            s.event(dict(seq=n, wall_ms=1000+n, event=kind, session_id='sess_test', native={}))
            if kind == 'PermissionRequest':
                self.assertEqual(s.hooks_only(), ('blocked', 'permission-wait'))
        self.assertEqual(s.hooks_only(), ('unknown', 'completion-unverified'))

    def test_private_state_rejects_public_directory_and_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            alias = p/'alias'; alias.symlink_to(p, target_is_directory=True)
            with self.assertRaises(RuntimeError): common.private_dir(alias)
            p.chmod(0o755)
            with self.assertRaises(RuntimeError): common.private_dir(p)

    def test_json_read_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d); common.json_write(p/'data', {'ok': True})
            (p/'alias').symlink_to(p/'data')
            with self.assertRaises(OSError): common.json_read(p/'alias')

    def test_unbound_hook_has_no_output_or_writes(self):
        with tempfile.TemporaryDirectory() as d:
            env = dict(os.environ); env.pop(common.RUN_ENV, None)
            p = subprocess.run([sys.executable, '-B', str(HOOKS/'hook.py')], env=env,
                               input='{"prompt":"private input"}', capture_output=True, text=True, cwd=d)
            self.assertEqual((p.returncode, p.stdout, p.stderr), (0, '', ''))
            self.assertEqual(list(Path(d).iterdir()), [])

    def test_database_mismatch_and_symlink_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'db'
            with sqlite3.connect(p): pass
            with self.assertRaises(sqlite3.Error): common.check_db(p)
            alias=Path(d)/'alias'; alias.symlink_to(p)
            with self.assertRaises(RuntimeError): common.check_db(alias)

    def test_unsupported_version_rejected_before_installation_query(self):
        args = argparse.Namespace(zcode='zcode', herdr='herdr', max_seconds=5, experimental_db_status=False)
        with patch.dict(os.environ, HERDR_ENV='1', HERDR_PANE_ID='wA:p1'), \
             patch('common.shutil.which', side_effect=lambda x:x), \
             patch('common.command', side_effect=['3.99.0', 'herdr 0.9.5']):
            with self.assertRaisesRegex(RuntimeError, 'Unsupported runtime'): common.environment(args)


class Watchdog(unittest.TestCase):
    def run_case(self, mode):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); root=p/'run'; root.mkdir(mode=0o700)
            sock=socket.socket(socket.AF_UNIX); sock.bind(str(p/'herdr.sock'))
            yes=p/'enabled'; yes.touch()
            zcode=p/'zcode'; herdr=p/'herdr'
            row={'name':common.NAME,'enabled':True,'version':common.VERSION,'rootPath':str(common.ROOT)}
            zcode.write_text('#!'+sys.executable+'\nimport json,pathlib\nr='+repr(row)+'\nr["enabled"]=pathlib.Path('+repr(str(yes))+').exists()\nprint(json.dumps([r]))\n')
            herdr.write_text('#!'+sys.executable+'\nimport sys\nsys.exit('+('1' if mode=='transport' else '0')+')\n')
            zcode.chmod(0o700); herdr.chmod(0o700)
            children=[subprocess.Popen([sys.executable,'-c','import time;time.sleep(20)']) for _ in range(2)]
            watcher=None
            try:
                cfg={'generation':'synthetic','plugin_root':str(common.ROOT),'state_root':str(p),
                     'pane':'wZ:p1','socket':str(p/'herdr.sock'),'socket_identity':common.socket_identity(p/'herdr.sock'),
                     'zcode':str(zcode),'herdr':str(herdr),'launcher':identity(children[0].pid),
                     'child':identity(children[1].pid),'db':None,'max_seconds':.6 if mode in ('timeout','transport') else 10}
                common.json_write(root/'run.json',cfg)
                watcher=subprocess.Popen([sys.executable,'-B',str(HOOKS/'monitor.py'),str(root)],
                                         stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                common.json_write(root/'watcher.json',identity(watcher.pid))
                until=time.monotonic()+3
                while not (root/'transitions.jsonl').exists() and time.monotonic()<until: time.sleep(.02)
                self.assertTrue((root/'transitions.jsonl').exists())
                if mode=='child': children[1].terminate(); children[1].wait()
                elif mode=='parent': children[0].terminate(); children[0].wait()
                elif mode=='disable': yes.unlink()
                elif mode=='stop': bridge.stop(root)
                elif mode=='socket':
                    sock.close(); (p/'herdr.sock').rename(p/'old.sock')
                    sock=socket.socket(socket.AF_UNIX); sock.bind(str(p/'herdr.sock'))
                out,err=watcher.communicate(timeout=9)
                self.assertEqual(watcher.returncode,0,err.decode())
                receipt=common.json_read(root/'stopped.json')
                rows=[json.loads(x) for x in (root/'transitions.jsonl').read_text().splitlines()]
                self.assertFalse(any(r.get('state')=='idle' for r in rows))
                if mode=='transport': self.assertFalse(receipt['released'])
                elif mode=='socket':
                    # Socket ownership alone must not permit a new instance to inherit binding.
                    self.assertEqual(receipt['reason'],'monitor-error')
                    self.assertFalse(receipt['released'])
                else:
                    self.assertTrue(receipt['released'])
                    expected={'child':'process-exited','parent':'process-exited','disable':'plugin-disabled',
                              'stop':'requested-stop','timeout':'monitor-time-limit'}[mode]
                    self.assertEqual(receipt['reason'],expected)
                if mode in ('stop','disable','timeout','transport','socket'):
                    self.assertIsNone(children[1].poll(), 'Observer must never kill the native process')
            finally:
                sock.close()
                for proc in children:
                    if proc.poll() is None: proc.terminate()
                    proc.wait()
                if watcher and watcher.poll() is None: watcher.terminate(); watcher.communicate()

    def test_native_exit(self): self.run_case('child')
    def test_parent_exit(self): self.run_case('parent')
    def test_deadline(self): self.run_case('timeout')
    def test_unknown_transport(self): self.run_case('transport')
    def test_disable_leaves_native_alive(self): self.run_case('disable')
    def test_stop_leaves_native_alive(self): self.run_case('stop')
    def test_socket_replacement_not_rebound(self): self.run_case('socket')


if __name__ == '__main__':
    unittest.main()
