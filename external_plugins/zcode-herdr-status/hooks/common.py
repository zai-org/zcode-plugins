# SPDX-License-Identifier: Apache-2.0
"""Linux-only binding and local checks. No credential or transcript reads."""
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import subprocess
import sys

VERSION = '0.2.0'
NAME = 'zcode-herdr-status'
ROOT = Path(__file__).resolve().parent.parent
RUN_ENV = 'ZCODE_HERDR_STATUS_RUN'


def require(value, message):
    if not value:
        raise RuntimeError(message)


def private_dir(path, create=False):
    path = Path(path).absolute()
    require(path.resolve() == path, 'State directory must not traverse symlinks')
    if create:
        path.mkdir(parents=True, mode=0o700, exist_ok=True)
    s = path.stat()
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid() and not s.st_mode & 0o077,
            'State directory must be owned by this user with mode 0700')
    return path


def json_read(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as f:
        s = os.fstat(f.fileno())
        require(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid() and not s.st_mode & 0o077,
                'Private state file ownership/mode mismatch')
        require(s.st_size <= 1048576, 'Oversized state file')
        return json.load(f)


def json_write(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f, indent=2)


def command(args, env=None):
    p = subprocess.run([str(a) for a in args], capture_output=True, text=True,
                       timeout=5, env=env)
    require(p.returncode == 0, 'Local command failed: ' + Path(str(args[0])).name)
    return p.stdout.strip()


def socket_identity(path):
    p = Path(path)
    require(p.is_absolute() and not p.is_symlink(), 'Expected an absolute non-symlink Herdr socket')
    s = p.stat()
    require(stat.S_ISSOCK(s.st_mode) and s.st_uid == os.getuid(), 'Herdr socket must belong to this user')
    return {'dev': s.st_dev, 'ino': s.st_ino, 'uid': s.st_uid}


def bound_env(cfg):
    require(socket_identity(cfg['socket']) == cfg['socket_identity'], 'Herdr socket changed; refusing rebinding')
    return dict(os.environ, HERDR_SOCKET_PATH=cfg['socket'])


def enabled(cfg):
    rows = json.loads(command([cfg['zcode'], 'plugins', 'list', '--json']))
    return any(p.get('name') == NAME and p.get('version') == VERSION and p.get('enabled')
               and Path(p.get('rootPath', '')).resolve() == Path(cfg['plugin_root']) for p in rows)


def check_db(path):
    p = Path(path).absolute()
    require(p.resolve() == p and p.is_file() and p.stat().st_uid == os.getuid(),
            'Metadata database must be a regular, same-user file without symlinks')
    with sqlite3.connect(p.as_uri() + '?mode=ro', uri=True, timeout=.15) as c:
        c.execute('PRAGMA query_only=ON')
        c.execute("SELECT id,session_id,time_created,json_extract(data,'$.role') FROM message WHERE 0")
        c.execute("SELECT message_id,session_id,json_extract(data,'$.type') FROM part WHERE 0")
    return str(p)


def environment(args):
    require(sys.platform == 'linux', 'Only Linux with /proc is supported')
    require(os.environ.get('HERDR_ENV') == '1', 'Run inside a Herdr-managed pane')
    pane = os.environ.get('HERDR_PANE_ID', '')
    require(re.fullmatch(r'w[0-9A-Z]+:p[0-9A-Z]+', pane), 'Missing or invalid inherited pane identity')
    socket = os.environ.get('HERDR_SOCKET_PATH', '')
    zcode, herdr = shutil.which(args.zcode), shutil.which(args.herdr)
    require(zcode and herdr, 'ZCode and Herdr must already be installed and on PATH (or specified explicitly)')
    versions = {'zcode': command([zcode, 'version']), 'herdr': command([herdr, '--version'])}
    require(versions == {'zcode': '3.16.3', 'herdr': 'herdr 0.9.5'},
            'Unsupported runtime version; tested ZCode 3.16.3 and Herdr 0.9.5 only')
    cfg = {'plugin_version': VERSION, 'plugin_root': str(ROOT), 'pane': pane,
           'socket': socket, 'socket_identity': socket_identity(socket),
           'zcode': zcode, 'herdr': herdr, 'cwd': str(Path.cwd()), 'versions': versions,
           'db': None, 'max_seconds': args.max_seconds}
    require(enabled(cfg), 'This exact plugin installation must be enabled; check plugins list --json')
    current = json.loads(command([herdr, 'pane', 'get', pane], env=bound_env(cfg)))['result']['pane']
    require(current['pane_id'] == pane, 'Herdr returned a different pane')
    require(current.get('foreground_cwd', current.get('cwd')) == cfg['cwd'], 'Pane working directory differs')
    require(not current.get('agent'), 'Pane already contains a recognized agent')
    if args.experimental_db_status:
        cfg['db'] = check_db(args.db or Path.home() / '.zcode/cli/db/db.sqlite')
        s = Path(cfg['db']).stat()
        cfg['db_identity'] = [s.st_dev, s.st_ino]
    return cfg
