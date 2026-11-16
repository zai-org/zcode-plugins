"""session-stats 独立常驻数据服务。

由补丁器部署到 %LOCALAPPDATA%\\session-stats\\ 并写入登录自启，
与 MCP 服务器内置的 HTTP 服务共用同一套单实例仲裁（bind 失败 + 健康探测）——
谁先占用端口谁服务，后到者静默退出。统计条因此不再随会话生灭。
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stats_server as ss  # noqa: E402

# 扁平部署布局（本文件与 pills.js 同目录）下，把本目录的 pills.js 插到下发候选首位
ss.PILLS_CANDIDATES.insert(0, str(Path(__file__).resolve().parent / "pills.js"))


def _run():
    if not ss.start_http_service():
        # 端口已有健康实例（如自动重打补丁后 installService 又拉起了一个）：本进程退出，
        # 避免空转实例随每次重打累积。
        print("已有实例在服务，本进程退出", flush=True)
        sys.exit(0)
    print("session-stats 数据服务运行中: "
          f"http://{ss.HTTP_HOST}:{ss.HTTP_PORT}（Ctrl+C 退出）", flush=True)
    # 补丁守望：ZCode 更新替换 app.asar 后，后台自动重打（打补丁的前提是 ZCode 已退出）
    try:
        import watch_update  # noqa: E402
        watch_update.start_watcher()
    except Exception:
        pass
    # CDP 注入：ZCode 带 --remote-debugging-port 启动时，窗口出现 ~2 秒内注入统计条
    # （不依赖 asar 补丁，更新无感；需要快捷方式带该参数）
    try:
        import injector  # noqa: E402
        injector.start_injector()
    except Exception:
        pass
    try:
        while True:
            time.sleep(3600)  # 保活
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    try:
        _run()
    except SystemExit:
        raise
    except BaseException:  # 致命异常落盘——2026-11-11 出现过常驻进程无声消失，别再无迹可查
        import traceback
        crash = Path(__file__).resolve().parent / "service-crash.log"
        try:
            with crash.open("a", encoding="utf-8") as f:
                f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + traceback.format_exc() + "\n")
        except Exception:
            pass
        raise
