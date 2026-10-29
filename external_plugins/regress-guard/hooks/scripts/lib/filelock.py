#!/usr/bin/env python3
"""跨平台文件锁，保护 manifest 的并发读写。

Unix: fcntl.flock（ advisory lock）
Windows: msvcrt.locking
无两者时: 降级为无锁 + stderr 警告（不阻断主流程）
"""
import os
import sys
from contextlib import contextmanager

try:
    import fcntl
    _HAS_FCNTL = True
except ImportError:
    _HAS_FCNTL = False

try:
    import msvcrt
    _HAS_MSVCRT = True
except ImportError:
    _HAS_MSVCRT = False


@contextmanager
def file_lock(filepath, exclusive=True):
    """对 filepath 加文件锁（通过同路径的 .lock 文件）。

    用法：
        with file_lock(manifest_path):
            data = parse(manifest_path)
            update(manifest_path, data)

    Args:
        filepath: 要保护的文件路径（锁文件是其同目录下的 .<basename>.lock）
        exclusive: True=排他锁，False=共享锁
    """
    lock_path = os.path.join(
        os.path.dirname(filepath),
        "." + os.path.basename(filepath) + ".lock"
    )

    lock_fd = None
    locked = False

    try:
        lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)

        if _HAS_FCNTL:
            # Unix: flock
            op = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
            fcntl.flock(lock_fd, op)
            locked = True

        elif _HAS_MSVCRT:
            # Windows: locking
            try:
                msvcrt.locking(lock_fd, msvcrt.LK_LOCK if exclusive else msvcrt.LK_RLOCK, 1)
                locked = True
            except OSError:
                pass  # 锁失败不阻断
        else:
            # 无锁原语可用 → 降级
            print(
                "REGRESS-GUARD: 警告 - 当前平台无文件锁支持，并发写入可能竞争",
                file=sys.stderr
            )

        yield

    finally:
        if lock_fd is not None:
            try:
                if _HAS_FCNTL and locked:
                    fcntl.flock(lock_fd, fcntl.LOCK_UN)
                elif _HAS_MSVCRT and locked:
                    try:
                        os.lseek(lock_fd, 0, 0)
                        msvcrt.locking(lock_fd, msvcrt.LK_UNLCK, 1)
                    except OSError:
                        pass
            except OSError:
                pass
            try:
                os.close(lock_fd)
            except OSError:
                pass
