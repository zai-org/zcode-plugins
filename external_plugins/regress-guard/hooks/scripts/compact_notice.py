#!/usr/bin/env python3
"""SessionStart(compact) hook：上下文压缩刚发生时的记忆降级警告。

压缩 = 无损摘要也丢细节（文件行号、报错原文、已否决的方案都可能残缺）。
注入一条提醒：重要事实回读核对，别凭残缺记忆自决策；断点续作优先 /regress:resume
（v1.17 前指向 /handoff，已过时——第一入口是产物层单侧重建）。
"""
import sys
import json


def main():
    print(json.dumps({"additionalContext": (
        "【regress-guard 压缩警告】上下文刚被压缩——你的记忆是摘要不是原文：\n"
        "  • 断点续作优先 /regress:resume：从 .regress/ 产物层单侧重建现场"
        "（零号入口 .regress/README.md：三步上手 + 完成判据）\n"
        "  • 关键事实（文件路径/行号、版本号、报错原文、清单状态）先重新 Read 核对，"
        "禁止引用记忆里的细节直接改代码\n"
        "  • 已否决过的方案可能被遗忘——认知已物质化在文件里，别靠回忆：\n"
        "     - .regress/decisions.md（决策日志：决定/依据/否决过的方案）\n"
        "     - .regress/manifests/（清单：含脆弱点挂牌状态 fragile_points）\n"
        "     - .regress/journal/events.jsonl（考古地层：历次失败/风险/纠正化石）\n"
        "     动手前先读这三处，避免把否决路线再走一遍\n"
        "  • 任务复杂且 resume 后仍缺关键上下文时，再考虑 /handoff 重开会话，"
        "优于在残缺记忆上硬撑"
    )}, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
