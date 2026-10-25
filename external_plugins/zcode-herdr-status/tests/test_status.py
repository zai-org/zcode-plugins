import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]/"hooks"))
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from status_core import State, identity, alive, snapshot


def ev(n, kind, sid='sess_A', **kw):
    return dict(seq=n, wall_ms=10000+n, event=kind, session_id=sid,
                native={'pid': 123, 'start': '1', 'uid': 997}, **kw)


def snap(uid='u1', completed=None, finish=None, code=None, error=None, created=10001):
    return {'user': {'id': uid, 'created': created}, 'assistant': {
        'id': 'a1', 'completed': completed, 'finish': finish, 'error_code': code, 'error': error}}


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.s = State(); self.s.event(ev(1, 'SessionStart')); self.s.event(ev(2, 'UserPromptSubmit'))

    def test_unknown_before_submission(self):
        self.assertEqual(State().decide(snap())[0], 'unknown')

    def test_working_before_assistant(self):
        x = snap(); x['assistant'] = None
        self.assertEqual(self.s.decide(x), ('working', 'turn-in-progress'))

    def test_permission_wait(self):
        self.s.event(ev(3, 'PermissionRequest', tool_use_id='t1'))
        self.assertEqual(self.s.decide(snap()), ('blocked', 'permission-wait'))

    def test_permission_success_clears_block(self):
        self.s.event(ev(3, 'PermissionRequest')); self.s.event(ev(4, 'PostToolUse'))
        self.assertEqual(self.s.decide(snap())[0], 'working')

    def test_permission_failure_clears_block(self):
        self.s.event(ev(3, 'PermissionRequest')); self.s.event(ev(4, 'PostToolUseFailure'))
        self.assertEqual(self.s.decide(snap())[0], 'working')

    def test_stop_is_not_completion(self):
        self.s.event(ev(3, 'Stop'))
        self.assertEqual(self.s.decide(snap())[0], 'working')

    def test_completed(self):
        self.assertEqual(self.s.decide(snap(completed=10020, finish='stop')), ('idle', 'turn-finished'))

    def test_denial_without_post_hook_clears_wait(self):
        self.s.event(ev(3, 'PermissionRequest', tool_use_id='t1'))
        x = snap(); x['tools'] = [{'call_id':'t1','status':'error','denied':True}]
        self.assertEqual(self.s.decide(x)[0], 'working')
        x['assistant'].update(completed=10020,finish='stop')
        self.assertEqual(self.s.decide(x), ('idle','turn-finished-after-denial'))

    def test_unrelated_tool_does_not_clear_wait(self):
        self.s.event(ev(3, 'PermissionRequest', tool_use_id='t1'))
        x = snap(); x['tools'] = [{'call_id':'other','status':'error','denied':True}]
        self.assertEqual(self.s.decide(x)[0], 'blocked')

    def test_tool_error_not_success(self):
        x = snap(completed=10020,finish='stop')
        x['tools'] = [{'call_id':'t1','status':'error','denied':False}]
        self.assertEqual(self.s.decide(x)[1], 'turn-finished-with-tool-error')

    def test_cancel_without_stop(self):
        self.assertEqual(self.s.decide(snap(completed=10020, code='model_request_cancelled', error='E')), ('idle', 'cancelled'))

    def test_other_error_not_success(self):
        self.assertEqual(self.s.decide(snap(completed=10020, error='E')), ('idle', 'failed'))

    def test_tool_round_not_final(self):
        self.assertEqual(self.s.decide(snap(completed=10020, finish='tool-calls'))[0], 'working')

    def test_old_user_not_current(self):
        self.assertEqual(self.s.decide(snap(created=10, completed=200, finish='stop'))[0], 'unknown')

    def test_old_completion_not_current(self):
        self.assertEqual(self.s.decide(snap(completed=9000, finish='stop'))[0], 'working')

    def test_database_unavailable(self):
        self.s.event(ev(3, 'PermissionRequest'))
        self.assertEqual(self.s.decide(None)[0], 'unknown')

    def test_new_user_before_hook_unknown(self):
        self.s.decide(snap())
        self.assertEqual(self.s.decide(snap(uid='u2', created=10050))[0], 'unknown')

    def test_new_submit_resets_completed(self):
        self.s.decide(snap(completed=10020, finish='stop'))
        self.s.event(ev(30, 'UserPromptSubmit'))
        self.assertEqual(self.s.decide(snap(uid='u2', created=10030))[0], 'working')

    def test_out_of_order_block_ignored(self):
        self.s.event(ev(5, 'PostToolUse'))
        self.assertFalse(self.s.event(ev(3, 'PermissionRequest')))
        self.assertEqual(self.s.decide(snap())[0], 'working')

    def test_duplicate_ignored(self):
        self.assertFalse(self.s.event(ev(2, 'UserPromptSubmit')))

    def test_new_session_resets_and_retires_old(self):
        self.s.event(ev(3, 'SessionStart', sid='sess_B'))
        self.assertEqual(self.s.decide(snap())[0], 'unknown')
        self.assertFalse(self.s.event(ev(4, 'SessionStart', sid='sess_A')))
        self.assertFalse(self.s.event(ev(5, 'Stop', sid='sess_A')))
        self.assertEqual(self.s.sid, 'sess_B')

    def test_unknown_session_does_not_bind(self):
        self.assertFalse(self.s.event(ev(4, 'PermissionRequest', sid='sess_other')))

    def test_pid_reuse_and_zombie(self):
        p = {'pid': 1, 'start': 'a', 'uid': 2}
        for actual in (None, dict(p, start='b', state='S'), dict(p, state='Z'), dict(p, uid=3, state='S')):
            with patch('status_core.identity', return_value=actual):
                self.assertFalse(alive(p))

    def test_current_process_alive(self):
        self.assertTrue(alive(identity(os.getpid())))

    def test_exact_session_and_parent_metadata_only(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'db.sqlite'
            c = sqlite3.connect(p)
            c.execute('create table message (id text, session_id text, time_created int, data text)')
            c.execute('create table part (message_id text, session_id text, data text)')
            for mid, sid, ts, data in [
                ('u', 'A', 1, {'role':'user','time':{'created':1}}),
                ('foreign', 'B', 99, {'role':'assistant','time':{'completed':99},'finish':'stop'}),
                ('wrong-parent', 'A', 3, {'role':'assistant','parentID':'old','finish':'stop'}),
                ('a', 'A', 2, {'role':'assistant','parentID':'u','time':{'completed':2},'finish':'stop','text':'DO NOT RETURN'})]:
                c.execute('insert into message values(?,?,?,?)',(mid,sid,ts,json.dumps(data)))
            c.commit(); c.close()
            result = snapshot(p,'A')
            self.assertEqual(result['assistant']['id'], 'a')
            self.assertNotIn('DO NOT RETURN',json.dumps(result))


if __name__ == '__main__':
    unittest.main()
