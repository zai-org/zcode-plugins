# SPDX-License-Identifier: Apache-2.0
"""Explicit current-pane entry point. Never starts services or changes permissions."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
from common import ROOT, RUN_ENV, environment, json_read, json_write, private_dir, require
from status_core import identity, alive


def stop(root):
    root = private_dir(root)
    cfg = json_read(root / 'run.json')
    require(cfg['plugin_root'] == str(ROOT), 'Run belongs to another plugin installation')
    fd = os.open(root / 'stop', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    deadline = time.monotonic() + 8
    watcher = json_read(root / 'watcher.json')
    while alive(watcher) and time.monotonic() < deadline:
        time.sleep(.1)
    require(not alive(watcher), 'Observer stop not confirmed; native agent was not killed')
    receipt = json_read(root / 'stopped.json')
    require(receipt['released'], 'Observer stopped but Herdr release was not acknowledged')
    print(json.dumps({'stopped': True, 'native_alive': alive(cfg['child']), 'released': True}))


def run(cfg, state, argv):
    state = private_dir(state, create=True)
    os.umask(0o077)
    # A stable lock per socket/pane; never use another session's focused pane.
    import hashlib
    key = hashlib.sha256((cfg['socket'] + '/' + cfg['pane']).encode()).hexdigest()
    fd = os.open(state / ('pane-' + key + '.lock'), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    lease = os.fdopen(fd, 'a+')
    fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    root = state / uuid.uuid4().hex
    root.mkdir(mode=0o700)
    cfg.update(generation=root.name, launcher=identity(os.getpid()), state_root=str(state))
    reader, writer = os.pipe()
    child = watcher = None
    try:
        # The native process cannot emit Hooks until its binding and observer exist.
        barrier = 'import os,sys; f=int(sys.argv[1]); b=os.read(f,1); os.close(f); b==b"1" or sys.exit(125); os.execv(sys.argv[2],sys.argv[2:])'
        child = subprocess.Popen([sys.executable, '-c', barrier, str(reader), cfg['zcode'], *argv],
                                 pass_fds=(reader,), env=dict(os.environ, **{RUN_ENV: str(root)}))
        os.close(reader); reader = None
        cfg['child'] = identity(child.pid)
        json_write(root / 'run.json', cfg)
        with open(root / 'observer.log', 'xb') as log:
            watcher = subprocess.Popen([sys.executable, str(ROOT / 'hooks/monitor.py'), str(root)],
                                       stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                                       start_new_session=True, pass_fds=(lease.fileno(),))
        json_write(root / 'watcher.json', identity(watcher.pid))
        print('Status observer run directory: ' + str(root), flush=True)
        os.write(writer, b'1'); os.close(writer); writer = None
        return child.wait()
    finally:
        for pipe in (reader, writer):
            if pipe is not None:
                os.close(pipe)
        if watcher:
            (root / 'stop').touch(mode=0o600, exist_ok=True)
            try:
                watcher.wait(timeout=8)
            except subprocess.TimeoutExpired:
                print('Observer stop unconfirmed; inspect the run directory', file=sys.stderr)
        lease.close()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='action', required=True)
    for name in ('doctor', 'run'):
        s = sub.add_parser(name)
        s.add_argument('--herdr', default='herdr')
        s.add_argument('--zcode', default='zcode')
        s.add_argument('--experimental-db-status', action='store_true')
        s.add_argument('--db', help='Explicit same-user metadata database, experimental mode only')
        s.add_argument('--max-seconds', type=int, default=3600)
        if name == 'run':
            s.add_argument('--state-dir', default=os.environ.get('ZCODE_PLUGIN_DATA') or
                           str(Path(os.environ.get('XDG_STATE_HOME', str(Path.home()/'.local/state'))) / 'zcode-herdr-status'))
            s.add_argument('zcode_args', nargs=argparse.REMAINDER)
    sub.add_parser('stop').add_argument('run_dir')
    a = p.parse_args()
    if a.action == 'stop':
        stop(a.run_dir)
        return 0
    require(1 <= a.max_seconds <= 86400, 'Observer lifetime must be 1..86400 seconds')
    require(not a.db or a.experimental_db_status, '--db requires explicit experimental opt-in')
    cfg = environment(a)
    if a.action == 'doctor':
        print(json.dumps({'ok': True, 'versions': cfg['versions'], 'pane': cfg['pane'],
                          'mode': 'experimental-db' if cfg['db'] else 'hooks-only',
                          'model_login': 'NOT_CHECKED'}))
        return 0
    argv = a.zcode_args[1:] if a.zcode_args[:1] == ['--'] else a.zcode_args
    return run(cfg, a.state_dir, argv)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as e:
        # Do not echo command output, environment, credentials or provider errors.
        print('Status bridge: ' + (str(e) if isinstance(e, RuntimeError) else type(e).__name__), file=sys.stderr)
        sys.exit(2)
