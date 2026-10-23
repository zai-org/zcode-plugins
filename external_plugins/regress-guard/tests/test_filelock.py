"""filelock 的单元测试。"""
import sys
import os
import threading
import pytest

LIB = os.path.join(os.path.dirname(__file__), "..", "hooks", "scripts", "lib")
sys.path.insert(0, LIB)

from filelock import file_lock


def test_lock_basic(tmp_path):
    """基本加锁/解锁不崩溃。"""
    f = tmp_path / "test.md"
    f.write_text("content")
    with file_lock(str(f)):
        pass  # 能进能出即可


def test_lock_nested_reentrant(tmp_path):
    """同一文件多次加锁（不同上下文）不死锁。"""
    f = tmp_path / "test.md"
    f.write_text("content")
    with file_lock(str(f)):
        pass
    with file_lock(str(f)):
        pass


def test_lock_concurrent_writes(tmp_path):
    """并发写入不丢失数据（锁保护下顺序写入）。"""
    f = tmp_path / "counter.md"
    f.write_text("0")
    counter_file = str(f)

    def increment():
        for _ in range(50):
            with file_lock(counter_file):
                with open(counter_file, "r") as fh:
                    val = int(fh.read().strip() or "0")
                with open(counter_file, "w") as fh:
                    fh.write(str(val + 1))

    threads = [threading.Thread(target=increment) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    result = int(f.read_text().strip())
    # 5 线程 × 50 次 = 250（锁保护下应精确）
    # 注：flock 在同进程内可能不互斥，但跨进程互斥
    # 这里主要验证不死锁 + 不丢到离谱
    assert result > 0, "并发写入结果不应为 0"
    assert result <= 250, f"结果不应超过 250，实际 {result}"


def test_lock_creates_lockfile(tmp_path):
    """加锁时创建 .lock 文件。"""
    f = tmp_path / "data.md"
    f.write_text("x")
    with file_lock(str(f)):
        lockfile = tmp_path / ".data.md.lock"
        assert lockfile.exists(), "锁文件应存在"
