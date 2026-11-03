# SPDX-License-Identifier: Apache-2.0
"""Installed ZCODE hook. Empty stdout always; append bounded metadata only."""
import fcntl
import json
import os
import re
import sys
import time
from pathlib import Path
from status_core import EVENTS, identity, alive
from common import ROOT, RUN_ENV, private_dir, json_read


def main():
    seq = time.monotonic_ns()
    root = os.environ.get(RUN_ENV)
    if not root:
        return  # Installed plugin does nothing in ordinary sessions.
    p = private_dir(root)
    if p.is_symlink() or p.stat().st_uid != os.getuid() or p.stat().st_mode & 0o077:
        return
    if (p / 'stop').exists():
        return
    cfg = json_read(p / 'run.json')
    if cfg['plugin_root'] != str(ROOT):
        return
    if os.environ.get('HERDR_PANE_ID') != cfg['pane'] or not alive(cfg['launcher']):
        return
    raw = sys.stdin.buffer.read(1048577)
    if len(raw) > 1048576:
        return
    x = json.loads(raw)
    ev = x.get('hook_event_name', x.get('hookEventName'))
    sid = x.get('session_id', x.get('sessionId'))
    if ev not in EVENTS or not isinstance(sid, str) or not re.fullmatch(r'sess_[a-zA-Z0-9-]{1,100}', sid):
        return
    if x.get('cwd') != cfg['cwd']:
        return
    pid, native, found = os.getppid(), None, False
    for _ in range(10):
        ident = identity(pid)
        if not ident or ident['uid'] != os.getuid():
            break
        if native is None and Path(f'/proc/{pid}/comm').read_text().strip() == 'zcode-cli':
            native = ident
        if all(ident[k] == cfg['child'][k] for k in ('pid', 'start', 'uid')):
            found = True
            break
        pid = ident['ppid']
    if not found or native is None:
        return
    e = {'seq': seq, 'wall_ms': time.time_ns() // 1000000, 'event': ev,
         'session_id': sid, 'native': native,
         'tool_use_id': x.get('tool_use_id', x.get('toolUseId'))}
    fd = os.open(p / 'events.jsonl', os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.write(json.dumps(e) + '\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        sys.stderr.write('zcode-status-observer:' + type(e).__name__ + '\n')
