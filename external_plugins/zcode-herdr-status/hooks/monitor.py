# SPDX-License-Identifier: Apache-2.0
"""Bounded observer. No input injection, permission replies or native process signals."""
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from common import ROOT, bound_env, enabled, json_read, json_write, private_dir, require
from status_core import State, alive, snapshot


def hook_decision(state, last_hook, now):
    if last_hook is None or now - last_hook >= 30:
        return 'unknown', 'hook-status-expired'
    return state.hooks_only()


def metadata_args(base, pane, source, seq, reason):
    label = {'cancelled': 'Cancelled', 'turn-finished-after-denial': 'Permission denied',
             'failed': 'Turn failed', 'turn-finished-with-tool-error': 'Tool failed',
             'completion-unverified': 'Completion unverified',
             'hook-status-expired': 'Status unverified'}.get(reason)
    args = base + ['report-metadata', pane, '--source', source + ':labels', '--agent', 'zcode',
                   '--applies-to-source', source, '--seq', str(seq), '--ttl-ms', '10000']
    if label:
        states = ('unknown',) if reason in ('completion-unverified', 'hook-status-expired') else ('idle', 'done')
        for state in states:
            args += ['--state-label', state + '=' + label]
    else:
        args += ['--clear-state-labels']
    return args


def main(root):
    root = private_dir(root)
    cfg = json_read(root / 'run.json')
    require(cfg['plugin_root'] == str(ROOT), 'Run belongs to another plugin installation')
    state = State()
    source = 'zcode-status:' + cfg['generation']
    base = [cfg['herdr'], 'pane']
    started = time.monotonic()
    offset, partial, previous = 0, b'', None
    last_inventory, last_report = float('-inf'), float('-inf')
    last_hook = None
    seqpath = private_dir(cfg['state_root']) / 'sequence'

    def record(kind, **kw):
        fd = os.open(root / 'transitions.jsonl', os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a') as f:
            f.write(json.dumps({'time_ms': time.time_ns() // 1000000, 'kind': kind,
                               'session_id': state.sid, 'turn_id': state.turn, **kw}) + '\n')

    def call(action, status=None, reason=None):
        fd = os.open(seqpath, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'r+') as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            n = int(f.read() or '0') + 1
            f.seek(0); f.truncate(); f.write(str(n)); f.flush()
        args = base + [action, cfg['pane'], '--source', source, '--agent', 'zcode', '--seq', str(n)]
        if status:
            args += ['--state', status, '--message', reason]
            if state.sid:
                args += ['--agent-session-id', state.sid]
        ok, metadata_ok = False, not bool(status)
        try:
            env = bound_env(cfg)
            if status:
                meta = subprocess.run(metadata_args(base, cfg['pane'], source, n, reason),
                                      env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=1)
                metadata_ok = meta.returncode == 0
            result = subprocess.run(args, env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=1)
            ok = result.returncode == 0
        except (RuntimeError, OSError, subprocess.TimeoutExpired):
            pass
        record('report' if status else 'release', state=status, reason=reason,
               acknowledged=ok, metadata_acknowledged=metadata_ok if status else None, seq=n)
        return ok and metadata_ok

    reason, released = 'monitor-error', False
    try:
        while time.monotonic() - started < cfg['max_seconds']:
            if not alive(cfg['launcher']) or not alive(cfg['child']):
                reason = 'process-exited'; break
            if (root / 'stop').exists():
                reason = 'requested-stop'; break
            now = time.monotonic()
            if now - last_inventory >= 5:
                if not enabled(cfg):
                    reason = 'plugin-disabled'; break
                last_inventory = now
            # Do not silently follow a replaced socket or reassign the selected pane.
            bound_env(cfg)
            path = root / 'events.jsonl'
            if path.exists():
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd, 'rb') as f:
                    f.seek(offset); data = f.read(262144); offset += len(data)
                lines = (partial + data).split(b'\n'); partial = lines.pop()
                if len(partial) > 16384:
                    raise ValueError('oversized event')
                for line in lines:
                    event = json.loads(line)
                    changed = state.event(event)
                    if changed:
                        last_hook = time.monotonic()
                    record('hook' if changed else 'ignored-event', event=event['event'], event_seq=event['seq'])
            if cfg['db']:
                try:
                    p = Path(cfg['db'])
                    s = p.stat()
                    require(not p.is_symlink() and s.st_uid == os.getuid() and
                            [s.st_dev, s.st_ino] == cfg['db_identity'], 'Database replaced')
                    snap = snapshot(p, state.sid) if state.sid else None
                except Exception:
                    snap = None
                decision = state.decide(snap)
            else:
                decision = hook_decision(state, last_hook, time.monotonic())
            current = (*decision, state.sid, state.turn)
            if current != previous or now - last_report >= 5:
                if call('report-agent', current[0], current[1]):
                    previous, last_report = current, now
            time.sleep(.25)
        else:
            reason = 'monitor-time-limit'
    except Exception as e:
        record('monitor-error', error=type(e).__name__)
    finally:
        call('report-agent', 'unknown', reason)
        # Release only this generation, including when an acknowledgement was lost.
        for _ in range(3):
            released = call('release-agent')
            if released:
                break
            time.sleep(.2)
        json_write(root / 'stopped.json', {'reason': reason, 'released': released,
                                         'session_id': state.sid, 'time_ms': time.time_ns() // 1000000})


if __name__ == '__main__':
    main(sys.argv[1])
