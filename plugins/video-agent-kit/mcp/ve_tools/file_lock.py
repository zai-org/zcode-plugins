"""Advisory whole-file locks with the ``fcntl.flock`` call shape on every platform.

``flock(file_or_fd, LOCK_EX | LOCK_NB)`` behaves like ``fcntl.flock``: shared or
exclusive, blocking or not, and a non-blocking request that cannot be granted
raises ``BlockingIOError``. POSIX delegates to ``fcntl``. Windows has no
``fcntl``; it uses ``LockFileEx`` on one byte far past any real content, so the
lock never blocks reads or writes of the file itself. Locks are tied to the open
handle and released when it is closed. Converting a held lock (shared to
exclusive on the same handle) is not supported on Windows; open a new handle.
"""
from __future__ import annotations

import os

if os.name != "nt":
    import fcntl as _fcntl

    LOCK_SH = _fcntl.LOCK_SH
    LOCK_EX = _fcntl.LOCK_EX
    LOCK_NB = _fcntl.LOCK_NB
    LOCK_UN = _fcntl.LOCK_UN

    def flock(file, operation: int) -> None:
        _fcntl.flock(file, operation)

else:
    import ctypes
    import msvcrt
    from ctypes import wintypes

    LOCK_SH, LOCK_EX, LOCK_NB, LOCK_UN = 1, 2, 4, 8

    _FAIL_IMMEDIATELY = 0x1
    _EXCLUSIVE = 0x2
    _LOCK_VIOLATION = (33, 158)          # ERROR_LOCK_VIOLATION, ERROR_NOT_LOCKED
    # One byte near the top of the 64-bit range: outside any real file content.
    _OFFSET_LOW, _OFFSET_HIGH = 0xFFFFFFFE, 0x7FFFFFFF

    class _Overlapped(ctypes.Structure):
        _fields_ = [("Internal", ctypes.c_void_p), ("InternalHigh", ctypes.c_void_p),
                    ("Offset", wintypes.DWORD), ("OffsetHigh", wintypes.DWORD),
                    ("hEvent", wintypes.HANDLE)]

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _kernel32.LockFileEx.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                                     wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(_Overlapped)]
    _kernel32.LockFileEx.restype = wintypes.BOOL
    _kernel32.UnlockFileEx.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                                       wintypes.DWORD, ctypes.POINTER(_Overlapped)]
    _kernel32.UnlockFileEx.restype = wintypes.BOOL

    def flock(file, operation: int) -> None:
        fd = file if isinstance(file, int) else file.fileno()
        handle = wintypes.HANDLE(msvcrt.get_osfhandle(fd))
        overlapped = _Overlapped(0, 0, _OFFSET_LOW, _OFFSET_HIGH, None)
        if operation & LOCK_UN:
            if not _kernel32.UnlockFileEx(handle, 0, 1, 0, ctypes.byref(overlapped)):
                error = ctypes.get_last_error()
                if error not in _LOCK_VIOLATION:   # unlocking an unheld lock is a no-op, as with flock
                    raise ctypes.WinError(error)
            return
        flags = (_EXCLUSIVE if operation & LOCK_EX else 0) | (_FAIL_IMMEDIATELY if operation & LOCK_NB else 0)
        if not _kernel32.LockFileEx(handle, flags, 0, 1, 0, ctypes.byref(overlapped)):
            error = ctypes.get_last_error()
            if operation & LOCK_NB and error in _LOCK_VIOLATION:
                raise BlockingIOError(error, "file is locked by another handle")
            raise ctypes.WinError(error)
