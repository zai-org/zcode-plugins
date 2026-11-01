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

if __name__ == "__main__":
    ss.start_http_service()
    print("session-stats 数据服务运行中: "
          f"http://{ss.HTTP_HOST}:{ss.HTTP_PORT}（Ctrl+C 退出）", flush=True)
    try:
        while True:
            time.sleep(3600)  # 保活
    except KeyboardInterrupt:
        pass
