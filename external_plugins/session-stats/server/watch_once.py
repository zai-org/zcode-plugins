"""单次探测版守望（供计划任务每 5 分钟调用）。

ZCode 退出且 asar 无补丁标记 → 调重打器；跑完即退出。
不依赖任何常驻进程存活——即使常驻服务被杀，计划任务下一轮照样补位。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import watch_update as w  # noqa: E402


def main() -> None:
    # CDP 注入优先：ZCode 在跑且带调试端口 → 每分钟兜底补注入（常驻注入器挂了也能接上）
    try:
        import injector  # noqa: E402
        n = injector.inject_once()
        if n:
            w._log("watch_once: CDP 注入 %d 个页面" % n)
    except Exception as e:  # noqa: BLE001
        w._log("watch_once: 注入异常 %r" % (e,))
    state = w._probe()
    import time as _t
    if _t.localtime().tm_min == 0:  # 每小时整点心跳一行——出问题时日志里看得见
        w._log("watch_once 心跳: %s" % state)
    if state == "missing":
        w.run_patcher()
        w._log("watch_once: missing → 重打后 %s" % w._probe())
    elif state == "unknown":
        w._log("watch_once: unknown（定位不到 ZCode resources，本轮跳过）")
    # running / patched：静默，不刷日志


if __name__ == "__main__":
    main()
