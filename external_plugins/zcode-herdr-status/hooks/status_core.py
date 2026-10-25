# SPDX-License-Identifier: Apache-2.0
"""Observation only. No permission decisions, model calls, or credential access."""
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path

EVENTS = {'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
          'PostToolUse', 'PostToolUseFailure', 'Stop'}


def identity(pid):
    try:
        p = Path('/proc') / str(pid)
        s = (p / 'stat').read_text()
        tail = s[s.rfind(')') + 2:].split()
        return {'pid': pid, 'start': tail[19], 'uid': p.stat().st_uid,
                'ppid': int(tail[1]), 'state': tail[0]}
    except (OSError, ValueError, IndexError):
        return None


def alive(expected):
    now = identity(expected['pid'])
    return bool(now and now['state'] not in ('Z', 'X') and
                all(now[k] == expected[k] for k in ('pid', 'start', 'uid')))


def snapshot(db, sid):
    """Exact session only; read metadata via JSON projections, never message text."""
    with closing(sqlite3.connect(Path(db).as_uri() + '?mode=ro', uri=True, timeout=.15)) as c:
        c.execute('PRAGMA query_only=ON')
        c.execute('BEGIN')  # One consistent read snapshot; close releases it every poll.
        user = c.execute("""SELECT id,json_extract(data,'$.time.created') FROM message
            WHERE session_id=? AND json_extract(data,'$.role')='user'
            ORDER BY time_created DESC,rowid DESC LIMIT 1""", (sid,)).fetchone()
        if not user:
            return {'user': None, 'assistant': None, 'tools': []}
        row = c.execute("""SELECT id,json_extract(data,'$.time.completed'),
            json_extract(data,'$.finish'),json_extract(data,'$.error.data.code'),
            json_extract(data,'$.error.name') FROM message
            WHERE session_id=? AND json_extract(data,'$.role')='assistant'
              AND json_extract(data,'$.parentID')=?
            ORDER BY time_created DESC,rowid DESC LIMIT 1""", (sid, user[0])).fetchone()
        tools = c.execute("""SELECT json_extract(p.data,'$.callID'),
            json_extract(p.data,'$.state.status'),
            json_extract(p.data,'$.state.error')='Denied in TUI'
            FROM part p JOIN message m ON p.message_id=m.id
            WHERE p.session_id=? AND m.session_id=?
            AND json_extract(m.data,'$.parentID')=? AND json_extract(p.data,'$.type')='tool'
            ORDER BY p.rowid""", (sid, sid, user[0])).fetchall()
        return {'user': {'id': user[0], 'created': user[1]},
                'tools': [dict(zip(('call_id', 'status', 'denied'), t)) for t in tools],
                'assistant': dict(zip(('id', 'completed', 'finish', 'error_code', 'error'), row)) if row else None}


class State:
    def __init__(self):
        self.sid = None
        self.retired = set()
        self.seq = -1
        self.phase = 'unknown'
        self.submitted = None
        self.turn = None
        self.call = None
        self.native = None

    def event(self, e):
        if e['seq'] <= self.seq or e['event'] not in EVENTS:
            return False
        sid, kind = e['session_id'], e['event']
        if sid != self.sid:
            if kind != 'SessionStart' or sid in self.retired:
                return False
            if self.sid:
                self.retired.add(self.sid)
            self.sid, self.phase, self.turn, self.submitted = sid, 'unknown', None, None
        self.seq = e['seq']
        self.native = e['native']
        if kind == 'UserPromptSubmit':
            self.phase, self.submitted, self.turn, self.call = 'working', e['wall_ms'], None, None
        elif kind == 'PermissionRequest':
            self.phase, self.call = 'blocked', e.get('tool_use_id')
        elif kind in ('PreToolUse', 'PostToolUse', 'PostToolUseFailure'):
            self.phase, self.call = 'working', None
        if kind == 'Stop':
            self.phase, self.call = 'unknown', None
        # Stop is not proof of completion: other hooks can continue the turn.
        return True

    def hooks_only(self):
        if not self.sid or self.submitted is None:
            return 'unknown', 'awaiting-current-turn'
        return self.phase, {'blocked': 'permission-wait', 'working': 'turn-in-progress',
                            'unknown': 'completion-unverified'}[self.phase]

    def decide(self, snap):
        if not self.sid or self.submitted is None:
            return 'unknown', 'awaiting-current-turn'
        if snap is None:
            return 'unknown', 'database-unavailable'
        u = snap['user']
        if not u or u['created'] < self.submitted - 1000:
            return 'unknown', 'awaiting-current-user-record'
        if self.turn is None:
            self.turn = u['id']
        if u['id'] != self.turn:
            return 'unknown', 'new-turn-awaiting-hook'
        a = snap['assistant']
        tools = snap.get('tools', [])
        # TUI rejection does not necessarily fire PostToolUseFailure.
        if self.phase == 'blocked' and self.call and any(
                t['call_id'] == self.call and t['status'] in ('completed', 'error') for t in tools):
            self.phase, self.call = 'working', None
        if a and a['completed'] and a['completed'] >= self.submitted:
            if a['error_code'] == 'model_request_cancelled':
                return 'idle', 'cancelled'
            if a['error']:
                return 'idle', 'failed'
            if a['finish'] in ('stop', 'end_turn'):
                if any(t['denied'] for t in tools):
                    return 'idle', 'turn-finished-after-denial'
                if any(t['status'] == 'error' for t in tools):
                    return 'idle', 'turn-finished-with-tool-error'
                return 'idle', 'turn-finished'
        return ('blocked', 'permission-wait') if self.phase == 'blocked' else ('working', 'turn-in-progress')
