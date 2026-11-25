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
    import time as _t
    for attempt in range(24):  # 最多 ~8 分钟：计划任务 ExecutionTimeLimit 是 10 分钟
        state = w._probe()
        if attempt == 0 and _t.localtime().tm_min == 0:  # 每小时整点心跳一行
            w._log("watch_once 心跳: %s" % state)
        if state == "missing" and w.patcher_available():
            w.run_patcher()
            after = w._probe()
            w._log("watch_once: missing → 重打后 %s（第 %d 次）" % (after, attempt + 1))
            if after == "patched":
                return
            _t.sleep(20)  # 更新器可能还在分步写包：等一小会儿再试
        elif state == "unknown":
            _t.sleep(10)  # asar 短暂不存在（换包中），等它出现
        else:
            return  # running / patched：本轮回结束


if __name__ == "__main__":
    main()
