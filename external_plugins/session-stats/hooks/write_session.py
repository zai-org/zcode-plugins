"""SessionStart hook：把当前 session_id 写进插件数据目录，供 MCP 服务器解析「当前会话」。

输入：stdin 一行 JSON（含 session_id）；输出：无（保持 stdout 干净，退出码恒 0，
绝不阻塞会话）。
"""

import json
import os
import sys
from pathlib import Path


def main() -> int:
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except Exception:  # noqa: BLE001
        req = {}
    sid = req.get("session_id") or os.environ.get("ZCODE_SESSION_ID") or ""
    data_dir = os.environ.get("ZCODE_PLUGIN_DATA", "")
    if not sid or not data_dir:
        return 0  # 静默跳过，由 MCP 服务器走 env/db 兜底
    try:
        p = Path(data_dir)
        p.mkdir(parents=True, exist_ok=True)
        (p / "current_session").write_text(sid, encoding="utf-8")
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
