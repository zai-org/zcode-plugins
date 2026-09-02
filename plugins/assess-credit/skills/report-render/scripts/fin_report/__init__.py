"""fin_report — build and verify institutional research PDFs with CJK support.

Extracted from two hand-built report generations whose architecture was ~80%
identical but whose literal line overlap was 12 lines of imports: each run
re-derived the same design from scratch with renamed identifiers. This package is
that design, once.

Typical use:

    from fin_report import Report, charts

    fig, ax = charts.new(7.4, 4.0)
    ax.bar(["2024", "2025E"], [190, 259], color=charts.theme.BLUE)
    charts.title(ax, "图1  中国人工智能算力市场规模")
    charts.source(fig, "资料来源:IDC,2025-03。单位:亿美元。")
    charts.save(fig, "c1_market.png")
    charts.write_meta()

    rep = Report("out/报告.pdf", "中国 GPU 芯片产业行业分析报告",
                 footer_note="数据截至 2026-07-25。供人工审阅,不构成投资建议。")
    rep.cover(meta_lines=["行业深度 · Sector Overview"])
    rep.h1("执行摘要")
    n = rep.refs.cite("IDC", "《中国人工智能计算力发展评估报告 2025》",
                      published="2025-03-31", retrieved="2026-07-25", url="https://…")
    rep.p(f"2025 年市场规模预计达 259 亿美元{n}。")
    rep.figure("c1_market.png", "图1  中国人工智能算力市场规模")
    rep.sources()
    rep.build()

Then always verify:

    python3 -m fin_report.verify out/报告.pdf --render out/qa

The same calls build a Word document where the deliverable is one someone will
edit — an internal working draft, a memo, a discussion paper. Swap the class and
the suffix; everything else, including ``[n]`` citations and provenance chips, is
unchanged:

    from fin_report import DocxReport

    rep = DocxReport("out/底稿.docx", "……")
    ...
    python3 -m fin_report.verify out/底稿.docx --render out/qa

Which format a deliverable gets is the formatting policy's call, not this
package's: unspecified long-form for circulation is PDF, and a draft whose next
reader edits it is DOCX.
"""
from . import charts, fonts, inline, ooxml, rules, theme, verify
from .doc import Report
from .refs import Refs, Source
from .word import DocxReport

__all__ = ["Report", "DocxReport", "Refs", "Source", "charts", "fonts", "inline",
           "ooxml", "rules", "theme", "verify"]
