#!/usr/bin/env python3
"""Smoke test: build a small report exercising every block, then verify it.

Run this after changing anything in fin_report/, and once in any new environment
to confirm a CJK font can be found. It is deliberately end-to-end — it renders
real charts, builds a real PDF **and a real DOCX**, and asserts on the built files
rather than on the code that wrote them.

The DOCX section additionally asserts the *honest degradation*: with no
LibreOffice on the machine the verifier must report that the layout was never
measured and exit 3. Set FIN_REPORT_WML_XSD to ISO-29500's wml.xsd to also
schema-validate every generated part, which is the closest available proxy for
"Word will open this".

    FIN_REPORT_FONT_DIR=/path/to/fonts python3 scripts/selftest.py [outdir]

Exit 0 if the built PDF passes verification, 1 otherwise.
"""
from __future__ import annotations

import os
import re
import sys
import zipfile
from pathlib import Path

from reportlab.lib.units import mm

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fin_report import DocxReport, Report, charts, theme, verify  # noqa: E402
from fin_report import cjk  # noqa: E402
from fin_report.refs import Refs  # noqa: E402


def build_charts(out_dir: Path) -> None:
    charts_dir = out_dir / "charts"

    # sparse: two bars -> should be sized narrow by the density tiers.
    # No charts.title() — these figures get PDF captions, which are the title.
    fig, ax = charts.new(6.4, 3.6)
    ax.bar(["2024", "2025E"], [190, 259], color=[theme.BLUE, theme.TEAL], width=0.45)
    ax.set_ylabel("市场规模（亿美元）")
    charts.source(fig, "资料来源：示例数据，非真实数据。单位：亿美元。")
    charts.save(fig, "sparse.png", charts_dir)

    # dense: many bars -> should be sized wide
    fig, ax = charts.new(7.6, 4.2)
    labels = [f"T{i}" for i in range(1, 19)]
    ax.bar(labels, [10 + (i * 7) % 40 for i in range(18)], color=theme.BLUE)
    ax.set_ylabel("数值")
    charts.source(fig, "资料来源：示例数据，非真实数据。")
    charts.save(fig, "dense.png", charts_dir)

    # titled: carries its own in-canvas title, so a caption must be refused
    fig, ax = charts.new(6.0, 3.4)
    ax.bar(["A", "B", "C"], [3, 5, 4], color=theme.TEAL)
    charts.title(ax, "图X  自带标题的图表（用于验证重复标题拦截）")
    charts.save(fig, "titled.png", charts_dir)

    charts.write_meta(charts_dir)


def build_report(out_dir: Path) -> Path:
    rep = Report(
        out_dir / "selftest.pdf",
        "报表渲染自检报告",
        subtitle="Report Render Selftest — 中英混排与引用链路验证",
        header_right="Selftest · fin_report",
        footer_note="示例数据，非真实数据。供人工审阅，不构成投资建议。",
        author="fin_report selftest",
        charts_dir=out_dir / "charts",
    )

    primary = rep.refs.cite(
        "上海证券交易所", "示例公司 2025 年年度报告",
        tier="一手", published="2026-03-28", retrieved="2026-07-25",
        url="https://www.sse.com.cn/disclosure/listedinfo/announcement/c/2026-04-15/600000_2026Q1.pdf",
    )
    secondary = rep.refs.cite(
        "示例财经媒体", "关于示例行业规模的报道",
        tier="二手", relays="示例研究院《行业追踪 2026》",
        published="2026-05-12", retrieved="2026-07-25",
        url="https://example.com/report",
    )
    # citing the same source twice must reuse its number, not append an entry
    again = rep.refs.repeat("上海证券交易所", "示例公司 2025 年年度报告")
    assert again == primary, "repeat() should reuse the original marker"

    rep.cover(
        meta_lines=[
            "自检范围：封面、页眉页脚、标题层级、图表密度分级、表格、要点框、引用与来源页",
            "检索于：2026-07-25",
        ],
        kpis=[("2", "图表数"), ("2", "来源条目"), ("A4", "版面"), ("88mm", "图高上限")],
    )

    rep.h1("一、正文与引用")
    rep.p(
        f"这一段用于验证中文断行、两端对齐与行内引用标记的渲染。示例公司 2025 年营业收入为 "
        f"143.8 亿元{primary}，行业规模的第三方口径则来自二手来源{secondary}。"
        "标点、括号（含全角）与百分号 36.2% 都应正常显示，不出现豆腐块或提前折行。"
    )
    rep.p("This paragraph mixes English with 中文 to confirm the family mapping and that "
          "<b>bold via markup</b> resolves to the Bold face rather than silently "
          "falling back to Regular.", align_left=True)
    rep.bullets([
        f"稀疏图表应被排得较窄{primary}",
        "密集图表应被排得较宽，且高度受 88mm 上限约束",
        "表格跨页时表头需重复",
    ])

    rep.h1("二、图表与表格")
    rep.figure("sparse.png", "图1  稀疏图表（两根柱子）")
    rep.figure("dense.png", "图2  密集图表（十八根柱子）")

    # A chart with its own in-canvas title must refuse a caption.
    duplicate_refused = False
    try:
        rep.figure("titled.png", "图3  这条图注会与图内标题重复")
    except ValueError:
        duplicate_refused = True
    assert duplicate_refused, "figure() should refuse to print a duplicate title"
    rep.figure("titled.png", "", note="图3 的标题在图内，此处仅作说明。")

    rows = [["项目", "数值", "口径", "说明"]]
    rows += [
        [f"第 {i} 行", f"{i * 11.3:.1f}", "示例", f"用于验证跨页表头重复与斑马纹的第 {i} 行"]
        for i in range(1, 31)
    ]
    rep.table(
        rows,
        caption="表1  长表格（30 行，必然跨页）",
        note=f"注：示例数据，非真实数据。{primary}",
        align_center=(1, 2),
    )

    rep.callout("核心判断", [
        f"引用标记与来源条目数量必须一致{secondary}",
        "二手来源必须写出转引链条",
        "未标注一手/二手的条目应当构建失败",
    ])

    rep.sources(
        preamble="以下来源按正文标注序号排列。〔一手〕为发布主体原始文件，〔二手〕注明转引链条。",
        disclaimer="免责声明：本文为 fin_report 自检产物，全部数据为示例，不构成任何投资建议。",
    )
    return rep.build()


def main() -> int:
    # Scratch by default, never a delivery directory: this is a development gate,
    # and a self-test artifact landing where deliverables are collected is
    # indistinguishable from a report nobody asked for.
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/fin_report_selftest")
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"font: {__import__('fin_report').fonts.resolve()}")
    build_charts(out_dir)
    meta = charts.read_meta(out_dir / "charts")
    print(f"chart meta: {meta}")

    pdf = build_report(out_dir)
    print(f"built: {pdf} ({pdf.stat().st_size:,} bytes)")

    report = verify.verify(pdf, render_dir=out_dir / "qa")
    print(
        f"pages={report.pages} cjk={report.cjk_chars} markers={report.markers} "
        f"links={report.links_internal}int+{report.links_external}ext"
    )
    print(f"embedded fonts: {', '.join(report.embedded_fonts) or 'NONE'}")
    print("ink: " + " ".join(f"{s:.1%}" for s in report.ink))

    # Assertions specific to the selftest's own content, beyond generic verify().
    checks = {
        "sparse chart sized narrower than dense": (
            _width(out_dir, "sparse.png") < _width(out_dir, "dense.png")
        ),
        "figure height respects the 88mm cap": all(
            _height(out_dir, n) <= theme.FIG_H_CAP + 0.01 for n in ("sparse.png", "dense.png")
        ),
        "exactly 2 source entries for 3 citations": report.markers == 2,
        "internal links present": report.links_internal > 0,
        "external links present": report.links_external > 0,
        "CJK present in text layer": report.cjk_chars > 100,
        "no heading stranded from its figure": not orphan_heading_sweep(out_dir),
        **orphan_block_sweep(out_dir),
        **centering_probe(out_dir),
        **chip_probe(out_dir),
        **provenance_probe(out_dir),
        **qa_leak_probe(out_dir),
        **fit_sweep(out_dir),
        **gap_probe(out_dir),
        **callout_probe(out_dir),
        **column_width_probe(out_dir),
        **overlap_probe(out_dir),
        **ref_metrics_probe(out_dir),
        **cover_furniture_probe(out_dir),
        **break_sweep(out_dir),
        **docx_probe(out_dir),
    }
    for name, passed in checks.items():
        print(f"  {'ok  ' if passed else 'FAIL'} {name}")

    for warning in report.warnings:
        print(f"  ! {warning}")
    for failure in report.failures:
        print(f"  x {failure}")

    if report.ok and all(checks.values()):
        print("\nOK - selftest passed")
        return 0
    print("\nFAIL - selftest failed", file=sys.stderr)
    return 1


def column_width_probe(out_dir: Path) -> dict[str, bool]:
    """A wide-label table must not starve its label column into wrapping.

    The default used to be `CONTENT_W / ncol`, which broke the shape this repo emits
    most: a 6-column 财务速览 whose label needed 34mm got 25mm and wrapped to three
    lines, while each numeric column got 25mm for 17–19mm of content. Natural width
    was 153mm against 174mm available — it fitted, the shares were wrong. The worst
    symptom was a starved numeric column letting CJK wrap break inside a number
    (`1,406.30` as `1,40` / `6.30`), which reads as a different figure.
    """
    from fin_report.doc import _CELL_PAD, _column_widths, _plain
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from fin_report import fonts as _fonts

    rows = [["指标", "26Q1", "25Q1", "同比", "25Q4", "环比"],
            ["营业收入(亿元)", "1,291.31[披露]", "847.05[披露]", "+52.4%[测算]",
             "1,406.30[披露]", "-8.2%[测算]"],
            ["经营活动现金流净额(亿元)", "336.81[披露]", "328.68[披露]", "+2.5%[测算]",
             "525.60[披露]", "-35.9%[测算]"]]
    widths = _column_widths(rows, 8.3)
    needed = [max(stringWidth(_plain(r[c]), _fonts.REGULAR, 8.3) for r in rows) + _CELL_PAD
              for c in range(6)]
    even = theme.CONTENT_W / 6
    return {
        "no column is starved into wrapping": all(w >= n - 0.01
                                                  for w, n in zip(widths, needed)),
        "the label column gets more than an equal share": widths[0] > even,
        "column widths still sum to the text column": abs(sum(widths) - theme.CONTENT_W) < 0.5,
        "an equal split would have starved a column": any(n > even for n in needed),
    }


def gap_probe(out_dir: Path) -> dict[str, bool]:
    """Build a document with a deliberate foot gap and assert the check reports it.

    The pairing is the assertion: the same filler length produces a 92mm gap when
    shrink-to-fit is disabled and ~1mm when it is enabled. A check that fired on
    both, or on neither, would be indistinguishable from one that always does.
    """
    charts_dir = out_dir / "charts"
    line = ("营业收入同比增长 18.4%,毛利率扩张 120bp,主要来自产品结构改善与定价纪律。"
            "分季度看,增速在下半年环比放缓,与行业库存周期基本吻合。")

    def build(tag: str, shrink: bool) -> Path:
        rep = Report(out_dir / f"_gap_{tag}.pdf", "留白探针", charts_dir=charts_dir)
        if not shrink:
            # Reproduces the pre-_FittedFigure behaviour: no shrink budget at all.
            rep.min_figure_width = lambda name: float("inf")
        rep.cover()
        rep.h1("1  章节")
        for _ in range(12):
            rep.p(line)
        rep.figure("dense.png", "图  留白探针", note="资料来源:示例数据,非真实数据。")
        for _ in range(6):
            rep.p(line)
        return rep.build()

    def gaps(path: Path) -> tuple[list[float], list[str]]:
        report = verify.verify(path, expect_cjk=True)
        mid = [g or 0.0 for g in report.foot_gaps[1:-1]]
        return mid, [w for w in report.warnings if "unused" in w]

    unshrunk, unshrunk_warnings = gaps(build("off", shrink=False))
    shrunk, shrunk_warnings = gaps(build("on", shrink=True))

    return {
        # Assert against the reporting floor, not the "well short" tier: the tier
        # boundary moved when the floor was re-calibrated to 78mm, and an assertion
        # pinned to the harsher tier failed on a fixture that was still correct.
        "foot gap measured on a page that ends early": bool(unshrunk)
            and max(unshrunk) >= verify.FOOT_GAP_FLOOR,
        "foot gap is reported as a warning": len(unshrunk_warnings) == 1,
        "shrink-to-fit closes the gap it can close": bool(shrunk)
            and max(shrunk) < verify.FOOT_GAP_FLOOR,
        "no foot-gap warning once the gap is closed": not shrunk_warnings,
        # 「接受还是修」需要落点,否则两者无法区分 —— 但落点在构建产物里,不在交付物上。
        "a flagged gap demands a 版面自检 disposition": _demands_layout_review(
            out_dir / "_gap_off.pdf"),
        "no 版面自检 demand when nothing is flagged": not _demands_layout_review(
            out_dir / "_gap_on.pdf"),
        "the sidecar satisfies it": not _demands_layout_review(
            out_dir / "_gap_off.pdf", sidecar=out_dir / "gapqa"),
        "the deliverable need not carry the line": verify.LAYOUT_LINE not in
            _pdf_text(out_dir / "_gap_off.pdf"),
    }


def _demands_layout_review(pdf: Path, sidecar: Path | None = None) -> bool:
    """Whether verify still asks for a disposition, optionally with one written."""
    if sidecar is not None:
        sidecar.mkdir(parents=True, exist_ok=True)
        (sidecar / verify.LAYOUT_REVIEW_FILE).write_text(
            f"{verify.LAYOUT_LINE}: 第2页 63mm — 已接受(图为不可拆分整块)。\n",
            encoding="utf-8")
    report = verify.verify(pdf, render_dir=sidecar)
    return any(verify.LAYOUT_LINE in w and "no `" in w for w in report.warnings)


def _pdf_text(pdf: Path) -> str:
    from pypdf import PdfReader
    return "\n".join((p.extract_text() or "") for p in PdfReader(str(pdf)).pages)


def cover_furniture_probe(out_dir: Path) -> dict[str, bool]:
    """A deliverable without a cover must open on the **body** template.

    reportlab starts on the first template registered, and `cover()` was the only
    thing that ever switched to `main`. So a 晨报 — which correctly opens on its
    first sentence — drew its body pages inside the cover's 66mm navy band, with no
    running header, no footer and no page number, until `sources()` switched
    templates. A NAVY caption landing in the band was invisible; a shipped
    2026-08-26 晨会纪要 lost 「表1 池内六标的」 that way.

    The pairing is the assertion, as in `gap_probe`: the *same* content built with
    and without `cover()` must differ in exactly one place — where the band is —
    and the with-cover build must be unchanged from what it always produced.
    """
    line = ("美股尚处周二盘中时段:纳斯达克指数报26100.58点、涨0.46%;标普500报7666.43点,"
            "较上收盘约涨0.18%。道指行情源本次不可获取(见文末覆盖说明)。")

    def build(tag: str, cover: bool) -> Path:
        rep = Report(out_dir / f"_furniture_{tag}.pdf", "晨会纪要 · 家具探针",
                     subtitle="封面家具不得漏用到正文页",
                     header_right="Selftest · furniture",
                     footer_note="示例数据,非真实数据。",
                     charts_dir=out_dir / "charts")
        if cover:
            rep.cover(meta_lines=["晨会纪要 · 探针"])
        rep.h1("一、隔夜外围")
        rep.p(line)
        # A NAVY caption is the element the band swallowed, so the probe carries one.
        rep.table([["#", "标的", "看点"], ["1", "示例A", "放量领涨"], ["2", "示例B", "增持收官"]],
                  caption="表1  探针表格(标题为 NAVY,落在色带里会看不见)")
        rep.p(line)
        return rep.build()

    def page_labels(path: Path) -> list[bool]:
        from pypdf import PdfReader
        return [bool(verify.PAGE_LABEL.search(page.extract_text() or ""))
                for page in PdfReader(str(path)).pages]

    def furniture_failures(path: Path) -> list[str]:
        return [f for f in verify.verify(path).failures if "cover** page template" in f]

    plain, covered = build("plain", cover=False), build("cover", cover=True)
    plain_labels, covered_labels = page_labels(plain), page_labels(covered)

    return {
        "a cover-less document numbers its first page": bool(plain_labels)
            and all(plain_labels),
        "a cover-less document trips no furniture failure": not furniture_failures(plain),
        # Unchanged behaviour on the path that has a cover: page 1 is the cover and
        # carries no number, every later page does.
        "a cover keeps page 1 unnumbered": len(covered_labels) > 1
            and not covered_labels[0] and all(covered_labels[1:]),
        "a cover trips no furniture failure either": not furniture_failures(covered),
        "the cover costs exactly one page": len(covered_labels) == len(plain_labels) + 1,
    }


def break_sweep(out_dir: Path, offsets: int = 46) -> dict[str, bool]:
    """Land a line break in the worst possible place, repeatedly, and check it holds.

    Every defect this guards is **intermittent by construction** — it depends on
    exactly how much column is left when the chip or the punctuation arrives — so a
    single fixture proves nothing and an eyeball proves less. The sweep grows a
    filler one character at a time, which walks the break across every offset in
    the sentence, and asserts on the built text layer with the same regexes
    `verify.py` uses.

    Baseline for the four assertions, measured on this sweep against reportlab
    4.4.3 unpatched: **2 split groups, 3 lines opening on punctuation, 2 lines
    holding only punctuation, 5 lines ending on an opener** — 12 defects in 304
    lines. With `fin_report.cjk` installed: zero of each, 308 lines, page count
    unchanged at 8. All four assertions were confirmed to fail against the unpatched
    breaker; a probe that cannot fail reports success.

    These counts are pypdf's, which merges some rendered lines and therefore
    under-reports: the same sweep scanned on *visual* lines shows 6 split groups.
    The scan uses pypdf anyway, because that is what `verify.py` sees.

    **The punctuation here is full-width on purpose.** reportlab's prohibition set
    is Japanese, and it happens to contain the *half-width* `,` `:` `;` — so a probe
    written with ASCII punctuation (the habit elsewhere in this file) passes against
    the unpatched breaker and asserts nothing. The characters under test are ``，；：``,
    ``）。`` and ``（``, and they have to appear as themselves.
    """
    filler = "公司中期报告披露本土市场游戏收入延续双位数增长态势并带动整体毛利改善公司管理层表示后续仍将投入"
    rep = Report(out_dir / "_breaks.pdf", "断行扫描", charts_dir=out_dir / "charts")
    for n in range(offsets):
        head = filler[:n]
        rep.p(f"{head}营销服务同比增速为{rep.tagged('+21.8%', '测算')}，"
              f"AI资本开支单季527.8亿元{rep.chip('披露')}。")
        rep.p(f"{head}云业务受AI需求带动提速（FY2025企业服务已录得高双位数增长）。")
        rep.p(f"{head}结构上三大主板块全面正增：营销服务同比+21.8%最快；游戏回暖、金企平稳。")
        rep.p(f"{head}集团毛利率56.92%→57.83%（披露整数口径57%→58%{rep.chip('披露')}）。")
    rep.legend()
    built = rep.build()

    from pypdf import PdfReader
    split = lead = alone = trail = 0
    for page in PdfReader(str(built)).pages:
        for raw in (page.extract_text() or "").splitlines():
            line = raw.strip()
            if not line or verify.BULLET_LINE.match(line):
                continue
            if (verify.SPLIT_GROUP_TAIL.search(line)
                    or verify.SPLIT_GROUP_HEAD.match(line)):
                split += 1
            if verify.LONE_PUNCT_LINE.fullmatch(line):
                alone += 1
            elif cjk.LEADING_PUNCT.match(line):
                lead += 1
            if cjk.TRAILING_OPEN.search(line):
                trail += 1

    return {
        "no [标签]/[n] split across a line break": split == 0,
        "no line opens on Chinese punctuation": lead == 0,
        "no line holds only punctuation": alone == 0,
        "no line ends on an opening bracket": trail == 0,
    }


def callout_probe(out_dir: Path) -> dict[str, bool]:
    """A callout longer than one page must still build, and must split.

    `callout` used to wrap its table in `_atomic`, which `_atomic`'s own docstring
    and `references/pitfalls.md` both rule out for content that can outgrow a page.
    A 60-item panel did not merely strand a page — reportlab raised `LayoutError`
    and **no document was produced at all**. The number of items is caller-supplied,
    so nothing bounded it.
    """
    line = "这是一条关键判断条目,用于验证超长面板在跨页时的行为与表头重复。"
    rep = Report(out_dir / "_callout.pdf", "callout 分页", charts_dir=out_dir / "charts")
    rep.cover()
    rep.h1("1  章节")
    for _ in range(6):
        rep.p(line * 3)
    rep.callout("核心判断", [f"{i + 1}. {line}" for i in range(60)])
    rep.p(line * 2)
    try:
        built = rep.build()
    except Exception:
        return {"a callout longer than a page still builds": False,
                "a long callout splits across pages": False}
    report = verify.verify(built, expect_cjk=True)
    return {
        "a callout longer than a page still builds": report.pages > 0 and not report.failures,
        "a long callout splits across pages": report.pages >= 3,
    }


def _sizes(out_dir: Path, name: str) -> tuple[float, float]:
    rep = Report(out_dir / "_probe.pdf", "probe", charts_dir=out_dir / "charts")
    return rep.figure_width(name)


def fit_sweep(out_dir: Path) -> dict[str, bool]:
    """Drive ``_FittedFigure.wrap`` at a range of remaining page heights.

    A unit probe rather than an assertion on the built PDF, deliberately: what
    matters is the decision taken at each remaining height, and reading that off
    a finished document would mean inferring it from page counts — which change
    for a dozen unrelated reasons. Each case below is one branch of ``wrap``, and
    each exists because the opposite behaviour is a real bug: a figure that jumps
    and strands 40% of a page, a figure scaled until its labels are unreadable, or
    a figure that shrinks a little more every time reportlab asks its size.
    """
    charts_dir = out_dir / "charts"
    rep = Report(out_dir / "_fit.pdf", "probe", charts_dir=charts_dir)
    rep.figure("dense.png", "图  拟合探针")
    figure = rep.story[-1]
    floor = rep.min_figure_width("dense.png")
    column = theme.PAGE_H - theme.MARGIN_T - theme.MARGIN_B

    _, natural = figure.wrap(theme.CONTENT_W, column)
    roomy = not figure.shrunk

    tight = natural - 10 * mm
    _, fitted = figure.wrap(theme.CONTENT_W, tight)
    shrank_in = figure.shrunk and fitted <= tight + 0.01
    legible = figure.image_width >= floor - 0.01

    _, again = figure.wrap(theme.CONTENT_W, tight)
    stable = abs(again - fitted) < 0.01

    _, restored = figure.wrap(theme.CONTENT_W, column)
    restores = abs(restored - natural) < 0.01 and not figure.shrunk

    # Too little room to reach even the floor: moving is the correct outcome, and
    # the block must come back at natural size so it fits the next page whole.
    _, cramped = figure.wrap(theme.CONTENT_W, 45 * mm)
    moves = cramped > 45 * mm and not figure.shrunk and cramped <= column

    # sparse.png is 92mm off a 6.4in canvas, i.e. already under the floor.
    narrow_rep = Report(out_dir / "_fit_sparse.pdf", "probe", charts_dir=charts_dir)
    narrow_rep.figure("sparse.png", "图  稀疏探针")
    narrow = narrow_rep.story[-1]
    _, narrow_natural = narrow.wrap(theme.CONTENT_W, column)
    narrow.wrap(theme.CONTENT_W, narrow_natural - 10 * mm)
    no_budget = not narrow.shrunk

    return {
        "figure keeps natural size when the page has room": roomy,
        "figure shrinks into the space left instead of jumping": shrank_in,
        "a shrunk figure stays above the legibility floor": legible,
        "shrinking does not accumulate across repeated wraps": stable,
        "figure returns to natural size when the room returns": restores,
        "figure still moves when it cannot fit legibly": moves,
        "a figure already under the floor is never shrunk": no_budget,
    }


def _width(out_dir: Path, name: str) -> float:
    return _sizes(out_dir, name)[0]


def _height(out_dir: Path, name: str) -> float:
    return _sizes(out_dir, name)[1]


def orphan_heading_sweep(out_dir: Path, rounds: int = 15) -> list[int]:
    """Return the filler lengths at which a heading strands from its figure.

    reportlab's keepWithNext only extends a heading's group to the next flowable
    if `_ktAllow` admits it, and `_ktAllow` rejects `KeepTogether`. So grouping a
    figure with KeepTogether silently made "keep the heading with the figure"
    impossible, with no error and no warning — it only shows up as a heading
    alone at the foot of a page, at some filler lengths and not others. This
    sweep is the regression test: measured 4/15 before the fix, 0/15 after.
    """
    import pypdfium2 as pdfium

    probe = out_dir / "orphan"
    fig, ax = charts.new(6.6, 3.6)
    ax.bar(["A", "B", "C"], [3, 5, 4], color=theme.TEAL)
    charts.save(fig, "probe.png", probe / "charts")
    charts.write_meta(probe / "charts")

    filler = "这是用于把标题推向页面底部的填充文字，" * 12
    stranded: list[int] = []
    for n in range(1, rounds + 1):
        pdf = probe / f"p{n}.pdf"
        rep = Report(pdf, "孤儿标题探测", charts_dir=probe / "charts")
        marker = rep.refs.cite("示例来源", "示例文档", retrieved="2026-07-26")
        rep.cover(meta_lines=["probe"])
        for _ in range(n):
            rep.p(filler)
        rep.h2("这一节标题必须与下方图块同页")
        rep.figure("probe.png", f"图1 探测图{marker}")
        rep.sources()
        rep.build()

        doc = pdfium.PdfDocument(str(pdf))
        try:
            pages = [doc[i].get_textpage().get_text_range() for i in range(len(doc))]
        finally:
            doc.close()
        head = next((i for i, t in enumerate(pages) if "这一节标题" in t), None)
        figure = next((i for i, t in enumerate(pages) if "探测图" in t), None)
        if head != figure:
            stranded.append(n)
    return stranded


def orphan_block_sweep(out_dir: Path, rounds: int = 15) -> dict[str, bool]:
    """A heading must never be the last thing on a page.

    `orphan_heading_sweep` covers the figure path only. `table()` and
    `callout()` group with `KeepTogether` because they must stay splittable, and
    reportlab's `_ktAllow` rejects `KeepTogether` — so a heading written the
    natural way (`rep.h2(...)` then `rep.table(...)`) had nothing to bind to and
    landed alone at a page foot. Measured before the fix: table 1/15, callout
    1/15, while `p` and `bullets` were 0/15 because both are `_ktAllow`-admitted.

    One filler length in fifteen is what makes this worth a sweep rather than a
    single case: it depends on exactly how much column is left when the heading
    is emitted, so any one document is likely to look fine.
    """
    import pypdfium2 as pdfium

    probe = out_dir / "orphan_block"
    head = "这一节标题必须与下方内容同页"
    filler = "这是用于把标题推向页面底部的填充文字，" * 12
    markers = {"table": "表列一", "callout": "要点一", "bullets": "要点甲",
               "para": "正文首行内容"}
    results: dict[str, bool] = {}

    for kind, marker in markers.items():
        stranded: list[int] = []
        for n in range(1, rounds + 1):
            pdf = probe / f"{kind}{n}.pdf"
            rep = Report(pdf, "标题孤行探测")
            cite = rep.refs.cite("示例来源", "示例文档", retrieved="2026-08-18")
            rep.cover(meta_lines=["probe"])
            for _ in range(n):
                rep.p(filler)
            rep.h2(head)
            if kind == "para":
                rep.p("正文首行内容用于验证标题不独占页尾。" * 5 + cite)
            elif kind == "table":
                rep.table([["列A", "列B"], ["表列一" + cite, "数值"], ["表列二", "数值"]])
            elif kind == "callout":
                rep.callout("关键判断", ["要点一" + cite, "要点二", "要点三"])
            else:
                rep.bullets(["要点甲" + cite, "要点乙", "要点丙"])
            rep.sources()
            rep.build()

            doc = pdfium.PdfDocument(str(pdf))
            try:
                pages = [doc[i].get_textpage().get_text_bounded() for i in range(len(doc))]
            finally:
                doc.close()
            hp = next((i for i, t in enumerate(pages) if head in t), None)
            bp = next((i for i, t in enumerate(pages) if marker in t), None)
            if hp is None or bp is None or hp != bp:
                stranded.append(n)
        results[f"no heading stranded from its {kind}"] = not stranded
    return results


def centering_probe(out_dir: Path) -> dict[str, bool]:
    """The drawn content must sit centred in its canvas, not just the canvas on
    the page.

    `Report.figure` centres the image box and the caption style is TA_CENTER, so
    the *box* was always centred — but matplotlib reserves the left margin for
    the y-label and tick labels and leaves the right one empty, so the picture
    inside the box hung left of its own 图n title. Measured across one batch:
    ink centre 4.9–5.6% left of canvas centre, up to 105px of dead white on the
    right against 0–19px on the left.

    Asserts on the written PNG, not on the figure object, because the thing that
    ships is the file. Also pins the canvas width: the tempting fix
    (`bbox_inches="tight"`) would centre the ink by cropping, and silently
    invalidate the `fig_w_in` the sidecar records for density sizing.
    """
    from PIL import Image

    probe = out_dir / "centering"
    fig, ax = charts.new(6.6, 3.6)
    ax.bar(["2024", "2025", "2026E"], [190, 259, 320], color=theme.BLUE)
    ax.set_ylabel("市场规模（亿元）")
    charts.save(fig, "centred.png", probe)
    charts.write_meta(probe)

    img = Image.open(probe / "centred.png").convert("L")
    w, h = img.size
    px = img.load()
    cols = [x for x in range(w)
            if any(px[x, y] < 245 for y in range(0, h, max(1, h // 140)))]
    offset = abs((cols[0] + cols[-1]) / 2 - w / 2) / w if cols else 1.0
    return {
        "chart ink is centred in its canvas": offset < 0.015,
        "centring did not crop the authored canvas": abs(w / 170 - 6.6) < 0.02,
    }


def chip_probe(out_dir: Path) -> dict[str, bool]:
    """Every provenance tag prints as a chip, in the policy colour, at ~6pt.

    `theme.CHIP` carried the colours from the first version; `theme.chip()` — the
    callable half the provenance policy's "one helper" actually needs — did not
    exist until 2026-08-19. Report scripts therefore rendered tags however each
    happened to, and one batch shipped three shapes of the same five tags: 6pt
    coloured chips, `#1c1c1c` body text after copying the hex values, and plain
    prose with no attempt at all.

    Asserts on the built PDF rather than the markup, because the thing that drifts
    is what reaches the page. Also asserts the tag is *smaller* than body text: a
    correctly-coloured chip at body size still competes with the number it
    annotates, which is what the policy's superscript register is for.
    """
    import fitz

    probe = out_dir / "chips"
    pdf = probe / "chips.pdf"
    rep = Report(pdf, "溯源标签渲染自检")
    cite = rep.refs.cite("示例来源", "示例文档", retrieved="2026-08-19")
    rep.cover(meta_lines=["probe"])
    rep.h1("标签")
    rep.legend()
    rep.p("".join(f"{tag}示例{rep.chip(tag)}。" for tag in
                  ("披露", "测算", "预期", "推断", "媒体")) + cite)
    rep.table([["项目", "值"], ["单位净利", f"0.104{rep.chip('测算')}"]])
    rep.sources()
    rep.build()

    doc = fitz.open(pdf)
    try:
        sizes, colours, body = [], [], []
        for page in doc:
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    for span in line.get("spans", []):
                        text = span["text"]
                        # The legend is a different register by design — its
                        # swatches sit at the size of the prose explaining them
                        # (`theme.swatch`), so measuring them here made "chips sit
                        # below body size" fail on a compliant document: the
                        # assertion is about the *annotation* form.
                        #
                        # Keyed on **bold**, not on the line carrying 标签口径.
                        # The legend is one paragraph and it wraps, so a
                        # line-level test skipped its first line and counted the
                        # swatches on every continuation line. `swatch()` emits
                        # `<b>` and `chip()` does not, which is a property of the
                        # span itself and survives any amount of reflow.
                        is_swatch = bool(span["flags"] & 16)
                        body.append((round(span["size"], 1), len(text)))
                        if not is_swatch and any(f"[{t}]" in text for t in
                                                 ("披露", "测算", "预期", "推断", "媒体")):
                            sizes.append(round(span["size"], 1))
                            colours.append(f"#{span['color']:06X}")
    finally:
        doc.close()

    wanted = {v.upper() for v in theme.CHIP.values()}
    body_pt = max({s for s, _ in body}, key=lambda s: sum(n for x, n in body if x == s))
    return {
        "every provenance tag renders as a chip": len(sizes) >= 6,
        "chips carry the policy colour": bool(colours) and set(colours) <= wanted,
        "chips sit below body size": bool(sizes) and max(sizes) < body_pt,
        "an inflected tag is refused": _chip_refuses("已披露"),
    }


def _chip_refuses(tag: str) -> bool:
    try:
        theme.chip(tag)
    except ValueError:
        return True
    return False


def provenance_probe(out_dir: Path) -> dict[str, bool]:
    """The legend and the tag-to-figure binding, both directions.

    `chip_probe` proves a tag *renders* correctly. These are the two things the
    2026-08-24 batch got wrong while every gate passed, so each is asserted as a
    pair — the compliant build must pass and the defective one must be caught:

    * **Legend.** 9 of 14 deliverables used 38–171 chips and shipped no legend.
      The rule was in `provenance.md` only — not in the guardrail vendored into
      the agents, not in 28 of the 38 prose skills' templates, and not here.
    * **Binding.** 12 clauses stacked mixed classes at their end
      (`环比+76.6%[披露][测算][5]`, where all three figures were in fact `[测算]`
      and the `[披露]` referred to a series the sentence never printed).
      `chip()` cannot express which figure a tag is about; `tagged()` can, and
      refuses a chip with nothing bound to it.
    """
    probe = out_dir / "prov"

    def build(name: str, *, legend: bool, pile: bool, uniform: bool = False,
              wedge: bool = False, echo: bool = False):
        rep = Report(probe / name, "溯源自检")
        cite = rep.refs.cite("示例来源", "示例文档", retrieved="2026-08-24")
        rep.cover(meta_lines=["probe"])
        rep.h1("正文")
        if legend:
            rep.legend()
        if uniform:
            # A run of figures that are all one class: ONE trailing chip covers
            # them, and that must pass. Chipping each separately is the noise the
            # provenance policy warns about, and failing this shape would push
            # authors straight into it.
            rep.p(f"同比 +102.7%、环比 +76.6%{rep.chip('测算')}{cite}。")
        elif echo:
            # The value printed twice: prose states it, then the same string is
            # handed to tagged(), which prints it again.
            rep.p(f"归母净利润 207.38 亿元{rep.tagged('207.38', '披露')}{cite}。")
        elif wedge:
            # The shipped spelling of the pile: the citation marker sits between
            # the two classes because that is the order the author emits them in.
            rep.p(f"季度均价 15.38 万元/吨，环比 +76.6%"
                  f"{rep.chip('披露')}{cite}{rep.chip('测算')}。")
        elif pile:
            rep.p(f"季度均价 15.38 万元/吨，环比 +76.6%"
                  f"{rep.chip('披露')}{rep.chip('测算')}{cite}。")
        else:
            rep.p(f"Q2 单季毛利率{rep.tagged('23.15%', '披露')}，"
                  f"环比{rep.tagged('-1.67pct', '测算')}{cite}。")
        rep.sources()
        return rep.build()

    def refused(**kw) -> bool:
        try:
            build(**kw)
        except ValueError:
            return True
        return False

    clean = build("clean.pdf", legend=True, pile=False)
    piled = build("piled.pdf", legend=True, pile=True)
    uniform = build("uniform.pdf", legend=True, pile=False, uniform=True)

    clean_report = verify.verify(clean)
    piled_report = verify.verify(piled)
    uniform_report = verify.verify(uniform)
    legend_text = "\n".join(
        page for page in _page_texts(clean)[:2]
    )

    def stacks(report) -> bool:
        return any("stack tags" in f for f in report.failures)

    swatch_pt, swatch_cols, gloss_pt = _legend_spans(clean)

    return {
        "a tagged deliverable with no legend is refused at build":
            refused(name="nolegend.pdf", legend=False, pile=False),
        "a legend with no tags to describe is refused at build":
            _legend_without_tags_refused(probe),
        "tagged() refuses a chip with nothing bound to it":
            _tagged_refuses_empty(),
        "the legend lists only the tags the document used":
            "[披露]" in legend_text and "[预期]" not in legend_text,
        # The legend is a colour key, so its swatches carry the policy colours and
        # are set at the size of the prose explaining them. Reusing the body chip
        # here printed them at 6pt raised against 7.6pt text — a key smaller and
        # harder to read than its own caption, in a footnote's register.
        "legend swatches carry the policy colour":
            bool(swatch_cols) and swatch_cols <= {v.upper() for v in theme.CHIP.values()},
        "legend swatches are not smaller than their own explanation":
            bool(swatch_pt) and bool(gloss_pt) and min(swatch_pt) >= max(gloss_pt),
        "a clause split at its class boundary passes verify": clean_report.ok,
        "a mixed-class tag stack fails verify": stacks(piled_report),
        # The other half, and the half a naive "one tag per figure" rule breaks:
        # same-class figures under a single trailing chip are correct, and a
        # repeated same-class tag is redundant rather than false.
        "a uniform-class run under one chip passes verify":
            uniform_report.ok and not stacks(uniform_report),
        "a repeated same-class tag is not reported as a stack":
            not _same_class_repeat_flagged(),
        # Placement. The call site does not decide it, which is the only reason
        # 12-of-14 cannot recur: every author writes h1() then legend().
        "the legend clears the first heading even when called after it":
            not any("body content above it" in f for f in clean_report.failures),
        "a legend one line under a heading fails the page-head check":
            not verify._legend_is_page_head(_INSIDE_SECTION_PAGES, 2),
        "the same legend at the head of the page passes it":
            verify._legend_is_page_head(_PAGE_HEAD_PAGES, 2),
        "placement='cover' puts the legend on the cover":
            _legend_on_cover(probe),
        "placement='cover' without a cover is refused":
            _bad_placement_refused(probe, "cover", cover=False),
        "an invented placement is refused":
            _bad_placement_refused(probe, "middle", cover=True),
        # A citation marker between the two classes is still a pile — anchoring on
        # adjacency alone reported zero on a document carrying seven.
        "a pile with a citation marker wedged between the classes fails verify":
            stacks(verify.verify(build("wedged.pdf", legend=True, pile=True,
                                       wedge=True))),
        "a chip handed a figure its own sentence already printed fails verify":
            any("already printed" in f
                for f in verify.verify(build("echo.pdf", legend=True, pile=False,
                                             echo=True)).failures),
        # Source naming. cite() refuses these, so the built-file check needs
        # synthetic input — which is also the case it exists for: a deliverable
        # assembled by hand or by an older script.
        "cite() refuses a server name in the publisher":
            _cite_refused(publisher="万得基金（wind-fund）", document="基金产品档案"),
        "cite() refuses a tool name in the document field":
            _cite_refused(publisher="天眼查",
                          document="企业基础画像（get_company_basic_profile 实时查询）"),
        "cite() refuses a bare-domain URL":
            _cite_refused(publisher="万得", document="一致预期",
                          url="https://www.wind.com.cn"),
        "cite() accepts the provider-plus-fields form with no URL":
            not _cite_refused(publisher="万得",
                              document="基金产品档案（成立日期/投资类型/业绩比较基准）",
                              url=""),
        "verify flags an interface name in a built deliverable":
            _naming_failure("[1] 〔一手〕万得基金（wind-fund） · 历任基金经理", "interface name"),
        "verify flags a bare-domain source URL":
            _naming_failure("[1] 〔一手〕中国人民银行 · M2:同比 "
                            "https://www.pbc.gov.cn/", "bare domain"),
        "verify accepts a specific page URL":
            not _naming_failure("[1] 〔一手〕天眼查 · 企业基础画像 "
                                "https://www.tianyancha.com/company/2343820668",
                                "bare domain"),
        # Coverage. Every check above asks whether the tags a document *has* are
        # placed correctly; none asked whether the figures needing one got one, so
        # a 业绩点评 with 64 tags passed exactly as cleanly as its 134-tag twin and
        # left all thirteen of its 环比 figures reading as disclosures.
        "an untagged 同比/环比 sentence is reported":
            _coverage_warned(_UNTAGGED_SENTENCE),
        "the same run under one trailing chip is not reported":
            not _coverage_warned(_TAGGED_RUN),
        "an exhibit's own 资料来源 note is not read as a claim":
            not _coverage_warned(_NOTE_ONLY),
        # Tables, which the built-file scan cannot reach: pypdf flattens the header
        # to 「同比环比毛利」 and the cells follow separately, so the cue and its
        # figure are never adjacent. Checked on the rows instead.
        "a bare 同比 column is refused at build":
            _table_refused([["分部", "2Q26收入", "同比"],
                            ["增值服务", "984.14亿", "+8.0%"]]),
        "one chip on the header cell clears the column":
            not _table_refused([["分部", "2Q26收入", "同比" + theme.chip("测算")],
                                ["增值服务", "984.14亿", "+8.0%"]]),
        "one chip on a body cell clears the column":
            not _table_refused([["分部", "2Q26收入", "同比"],
                                ["增值服务", "984.14亿",
                                 "+8.0%" + theme.chip("测算")]]),
        # The shipped shape: seven columns, no cell tagged, the 口径 explained in
        # the note. A reader cannot map that sentence onto cells.
        "a note explaining the 口径 does not discharge the column":
            _table_refused([["分部", "2Q26收入", "同比"],
                            ["增值服务", "984.14亿", "+8.0%"]], note=_NOTE_ONLY),
        "a table with no derived column is out of scope":
            not _table_refused([["分部", "估值方法", "对应价值"],
                                ["游戏", "15x PE", "2.1万亿"]]),
    }


#: Two synthetic page-2s, identical but for one line: the running header and
#: footer, then either the heading before the legend or the legend first. This is
#: the whole difference between the 12 defective deliverables and the 2 correct
#: ones, so it is asserted on the text rather than on a rebuilt PDF.
_CHROME = "示例股份 2026年一季报点评\n业绩点评 · 2026年8月\n供人工审阅的分析师底稿。"
_LEGEND_LINE = "标签口径：[披露] 公司公告；[测算] 本报告的计算与假设。"
_INSIDE_SECTION_PAGES = [
    "cover",
    f"{_CHROME}\n第 2 页\n核心观点\n{_LEGEND_LINE}\n公司于2026年4月15日披露一季报。",
    f"{_CHROME}\n第 3 页\n一、业绩总览\n营业收入1,291.31亿元。",
]
_PAGE_HEAD_PAGES = [
    "cover",
    f"{_CHROME}\n第 2 页\n{_LEGEND_LINE}\n核心观点\n公司于2026年4月15日披露一季报。",
    f"{_CHROME}\n第 3 页\n一、业绩总览\n营业收入1,291.31亿元。",
]


def _cite_refused(**kw) -> bool:
    """True when ``cite()`` rejects a source line the citation policy bans."""
    try:
        Refs().cite(kw.pop("publisher"), kw.pop("document"), retrieved="2026-08-24", **kw)
    except ValueError:
        return True
    return False


def _naming_failure(line: str, needle: str) -> bool:
    """True when ``_check_source_naming`` reports ``needle`` for a Sources line."""
    report = verify.Report(path="synthetic")
    verify._check_source_naming(report, ["cover", f"来源\n{line}"])
    return any(needle in f for f in report.failures)


#: Two synthetic pages differing only in whether the sentence carries a class. The
#: coverage check reads the built file's text layer, so it can be asserted on text
#: — and has to be asserted in both directions: 「一个尾标签覆盖同类连排」 is the
#: correct shape, so a check that fired on it would push authors into per-figure
#: chipping, which is the noise `provenance.md` warns about.
_UNTAGGED_SENTENCE = "2Q26 集团收入 2,047.85 亿元，同比 +11.0%、环比 +4.2%。"
_TAGGED_RUN = "2Q26 集团收入 2,047.85 亿元，同比 +11.0%、环比 +4.2%[测算][1]。"
#: The exhibit note that does *not* discharge a column, kept verbatim from the
#: deliverable that shipped it.
_NOTE_ONLY = "资料来源：全部为公司披露口径；毛利率及其变动为披露值按分部收入计算[测算]。"


def _coverage_warned(sentence: str) -> bool:
    """True when the coverage check reports an untagged derivation in ``sentence``."""
    report = verify.Report(path="synthetic")
    verify._check_tag_coverage(report, ["cover", f"第 2 页\n{sentence}"])
    return any("no provenance tag anywhere" in w for w in report.warnings)


def _table_refused(rows: list[list], *, note: str = "") -> bool:
    """True when ``build()`` refuses the table for an untagged derived column."""
    probe = Report("/dev/null", "表格自检")
    try:
        probe.table(rows, caption="表1　自检", note=note)
    except Exception:
        return False
    return bool(probe._untagged_tables)


def _legend_on_cover(probe: Path) -> bool:
    """True when ``placement='cover'`` renders the legend on page 1."""
    rep = Report(probe / "oncover.pdf", "封面图例")
    cite = rep.refs.cite("示例来源", "示例文档", retrieved="2026-08-24")
    rep.cover(meta_lines=["probe"])
    rep.legend(placement="cover")
    rep.h1("正文")
    rep.p(f"毛利率{rep.tagged('23.15%', '披露')}{cite}。")
    rep.sources()
    pages = _page_texts(rep.build())
    return "标签口径" in pages[0] and "标签口径" not in pages[1]


def _bad_placement_refused(probe: Path, placement: str, *, cover: bool) -> bool:
    rep = Report(probe / "badplacement.pdf", "图例落点")
    if cover:
        rep.cover(meta_lines=["probe"])
    try:
        rep.legend(placement=placement)
    except ValueError:
        return True
    return False


def _legend_spans(pdf: Path):
    """(swatch sizes, swatch colours, gloss sizes) within the legend's own block.

    Scoped to the **block**, not the line: the legend is one paragraph, so it is
    one block however many lines it wraps to. Line-level scoping found only its
    first line; document-level scoping picked up every grey note on the page.
    Swatches are the bold tagged spans (`theme.swatch` emits `<b>`, `chip()` does
    not), and the block holding one is the legend.
    """
    import fitz

    swatch_pt, swatch_cols, gloss_pt = [], set(), []
    doc = fitz.open(pdf)
    try:
        for page in doc:
            for block in page.get_text("dict")["blocks"]:
                spans = [s for line in block.get("lines", [])
                         for s in line.get("spans", []) if s["text"].strip()]
                tagged = [s for s in spans
                          if any(f"[{t}]" in s["text"] for t in theme.CHIP
                                 if not t.isascii())]
                bold_tagged = [s for s in tagged if s["flags"] & 16]
                if not bold_tagged:
                    continue
                for span in bold_tagged:
                    swatch_pt.append(round(span["size"], 1))
                    swatch_cols.add(f"#{span['color']:06X}")
                gloss_pt += [round(s["size"], 1) for s in spans if s not in tagged]
    finally:
        doc.close()
    return swatch_pt, swatch_cols, gloss_pt


def _same_class_repeat_flagged() -> bool:
    """`[测算][测算]` says nothing false, so it must not be scored as a pile."""
    return bool([
        run for run in verify.TAG_RUN.finditer("环比 +76.6%[测算][测算]")
        if len(set(verify.TAG.findall(run.group(0)))) >= 2
    ])


def _page_texts(pdf: Path) -> list[str]:
    from pypdf import PdfReader
    return [(page.extract_text() or "") for page in PdfReader(str(pdf)).pages]


def _tagged_refuses_empty() -> bool:
    try:
        theme.tagged("", "披露")
    except ValueError:
        return True
    return False


def _legend_without_tags_refused(probe: Path) -> bool:
    rep = Report(probe / "emptylegend.pdf", "溯源自检")
    rep.refs.cite("示例来源", "示例文档", retrieved="2026-08-24")
    rep.cover(meta_lines=["probe"])
    rep.h1("正文")
    rep.legend()
    rep.p("这一段没有任何标签[1]。")
    try:
        rep.sources()
        rep.build()
    except ValueError:
        return True
    return False


def qa_leak_probe(out_dir: Path) -> dict[str, bool]:
    """Build-QA wording must never reach a deliverable, and must be caught if it does.

    Two shipped examples drove this: a cover meta block reading 「财报披露日 … ｜
    报告撰写日 … ｜ 业绩点评 ｜ 未经视觉验收（已过数值版式检查）」, where the stamp sits
    among facts about the company as though it were one of them; and an industry
    primer whose last page closed with 「第5页因图3放不下留下63mm空隙（缩小图3后消除）」
    directly beneath its coverage table.

    Both were *mandated* at the time — the skill told the model to print them — so
    this probe checks the two halves that had to change together: a clean document
    passes, and a document carrying the wording fails rather than warns. Scope and
    legal statements are asserted to survive, because the easy over-correction is a
    filter that also strips 不构成投资建议.
    """
    import fitz

    probe = out_dir / "qaleak"

    def build(name: str, tail: str) -> Path:
        pdf = probe / name
        rep = Report(pdf, "QA 泄漏探测")
        cite = rep.refs.cite("示例来源", "示例文档", retrieved="2026-08-19")
        rep.cover(meta_lines=["probe"])
        rep.h1("一、正文")
        rep.p("这是一段正文内容，用于承载引用。" + cite)
        rep.p("免责声明：本报告为分析师底稿，不构成投资建议。数据截至 2026-08-19。")
        if tail:
            rep.p(tail)
        rep.sources()
        return rep.build()

    clean = verify.verify(build("clean.pdf", ""))
    leaked = verify.verify(build("leaked.pdf",
                                 "未经视觉验收（已过数值版式检查）。版面自检：第2页 63mm 已接受。"))
    text = "\n".join((p.get_text() or "") for p in fitz.open(probe / "clean.pdf"))

    def is_leak_failure(rep) -> bool:
        return any("build-QA wording" in f for f in rep.failures)

    return {
        "a clean deliverable carries no QA wording": not is_leak_failure(clean),
        "QA wording in the deliverable is a failure": is_leak_failure(leaked),
        "scope and legal statements survive": "不构成投资建议" in text and "数据截至" in text,
    }


def overlap_probe(out_dir: Path) -> dict[str, bool]:
    """Text drawn over text must be refused, and a clean figure must not be.

    The defect this exists for shipped through every gate: a two-panel figure
    whose left panel's twin-axis title and right panel's y-axis title were printed
    in the same place. The PDF verifier reads pages, not chart internals, so it saw
    a figure of the right size holding a normal amount of ink. Only a human caught
    it, on page 8 of a delivered report.

    Both directions are asserted. A collision checker that never fires is
    indistinguishable from no checker, and one that fires on correct charts gets
    turned off — the second is the likelier failure here, because a dual-axis chart
    legitimately draws every shared x tick label twice, in the same place.
    """
    import matplotlib.pyplot as plt

    charts.configure()
    probe = out_dir / "overlap"

    clean, clean_ax = charts.new(6.4, 3.4)
    clean_ax.bar(["甲", "乙", "丙"], [3, 5, 2])
    clean_ax.set_ylabel("金额(亿元)")
    clean_hits = len(charts._collisions(clean))
    charts.save(clean, "clean.png", out_dir=probe)

    # A dual-axis chart: the twin re-draws the shared x tick labels at identical
    # coordinates. Geometrically a 100% overlap; visually one label.
    twin_fig, twin_ax = charts.new(6.4, 3.4)
    twin_ax.bar(["2024A", "2025A", "2026E"], [3620, 4237, 6050])
    twin_ax.set_ylabel("营业收入(亿元)")
    second = twin_ax.twinx()
    second.plot([507, 722, 940], color=theme.RED)
    second.set_ylabel("归母净利润(亿元)")
    twin_hits = len(charts._collisions(twin_fig))
    charts.save(twin_fig, "twin.png", out_dir=probe)

    # Two data labels in one spot: nothing tight_layout can move, so it must raise.
    bad, bad_ax = charts.new(6.4, 3.4)
    bad_ax.bar(["2024A"], [3620])
    bad_ax.text(0, 3700, "3,620", ha="center")
    bad_ax.text(0, 3700, "507", ha="center")
    refused = False
    try:
        charts.save(bad, "bad.png", out_dir=probe)
    except ValueError as exc:
        refused = "printed on top of" in str(exc)
    plt.close("all")

    return {
        "a clean chart reports no text collision": clean_hits == 0,
        "a twin-axis chart is not a false positive": twin_hits == 0,
        "text over text is refused": refused,
    }


def ref_metrics_probe(out_dir: Path) -> dict[str, bool]:
    """The Sources list tightens only when tightening removes a page.

    The user requirement this encodes: 「不是指每一篇都必须」. A report whose
    sources already end cleanly must be byte-identical to before, so the check has
    to assert the *negative* case as hard as the positive one — a chooser that
    always tightens would pass a test that only looked for tightening.
    """
    from fin_report.doc import _pack_pages

    def metrics(count: int) -> tuple[tuple[float, float], list[int]]:
        rep = Report(out_dir / "_refprobe.pdf", "probe", charts_dir=out_dir / "charts")
        for i in range(count):
            rep.refs.cite(f"机构{i}", f"一篇长度大致典型的资料标题,编号 {i}",
                          tier="一手", published="2026-04-16", retrieved="2026-08-19",
                          url=f"https://www.example.com/articles/2026-04-16/{i}0.html")
        head = tail = 40.0
        pages = []
        for leading, after in theme.REF_STEPS:
            style = theme.ref_style(leading, after)
            heights = [rep._block_height(_para(line, style))
                       for line in rep.refs.lines()]
            pages.append(_pack_pages(heights, rep._COLUMN_H - head,
                                     rep._COLUMN_H, tail))
        return rep._ref_metrics(head, tail), pages

    # Walk outward from a page boundary until both a "no gain" and a "gain" case
    # are found, rather than hard-coding counts that the type ramp could move.
    loose_kept = tightened = None
    for count in range(2, 90):
        chosen, pages = metrics(count)
        if pages[0] == min(pages) and loose_kept is None:
            loose_kept = chosen == theme.REF_STEPS[0]
        if pages[0] > min(pages) and tightened is None:
            tightened = chosen != theme.REF_STEPS[0] and pages[
                theme.REF_STEPS.index(chosen)] == min(pages)
        if loose_kept is not None and tightened is not None:
            break

    return {
        "sources keep the loose default when no page is saved": bool(loose_kept),
        "sources tighten when it removes a page": bool(tightened),
        **_ref_stub_probe(out_dir, metrics),
    }


def _ref_stub_probe(out_dir: Path, metrics) -> dict[str, bool]:
    """End to end: the spilled-remainder page is reported, and the fix removes it.

    Paired, like `gap_probe`. The same entry count is built twice — once with the
    metrics chooser pinned to the loose setting (reproducing the behaviour that
    shipped a 12-page report whose page 12 held one source entry) and once with it
    active. A check that fired on both would be reporting page count, not a defect;
    one that fired on neither would be the unconditional last-page exemption again.

    Candidate counts come from the packing arithmetic rather than a hard-coded
    number, so the type ramp can move without silently turning this into a
    tautology — but the *assertion* is on the built PDF, because that is what a
    reader gets.
    """
    from reportlab.platypus import Paragraph  # noqa: F401  (kept for _para)

    def build(tag: str, count: int, pin_loose: bool) -> Path:
        rep = Report(out_dir / f"_refstub_{tag}.pdf", "来源探针",
                     charts_dir=out_dir / "charts")
        if pin_loose:
            rep._ref_metrics = lambda head, tail: theme.REF_STEPS[0]
        rep.cover()
        rep.h1("1  章节")
        markers: list[str] = []
        for i in range(count):
            markers.append(rep.refs.cite(
                f"机构{i}", f"一篇长度大致典型的资料标题,编号 {i}",
                tier="一手", published="2026-04-16", retrieved="2026-08-19",
                url=f"https://www.example.com/articles/2026-04-16/{i}0.html"))
        # Every entry needs its marker in the body or refs.problems() refuses the
        # section — batch them so the body stays short and the sources section is
        # what drives pagination.
        for start in range(0, len(markers), 8):
            rep.p("示例正文,数据为示例,非真实数据。" + "".join(markers[start:start + 8]))
        rep.sources()
        return rep.build()

    def reports_tail(path: Path) -> bool:
        return any("carries only the tail" in w
                   for w in verify.verify(path).warnings)

    candidates = [c for c in range(4, 90) if metrics(c)[1][0] > min(metrics(c)[1])]
    pinned = fixed = None
    for count in candidates[:4]:
        if reports_tail(build("loose", count, pin_loose=True)):
            pinned = True
            fixed = not reports_tail(build("auto", count, pin_loose=False))
            break

    return {
        "a spilled sources remainder is reported": bool(pinned),
        "the measured leading removes that page": bool(fixed),
    }


def _para(text: str, style):
    from reportlab.platypus import Paragraph
    return Paragraph(text, style)



# --------------------------------------------------------------------------
# docx backend
# --------------------------------------------------------------------------
def _docx_build(out_dir: Path, name: str = "selftest.docx", **kw) -> Path:
    """A small DOCX exercising every block, built with the same calls as the PDF."""
    rep = DocxReport(
        out_dir / name,
        "报表渲染自检报告（DOCX）",
        subtitle="Docx Backend Selftest — 中英混排与引用链路验证",
        header_right="Selftest · fin_report",
        footer_note="示例数据，非真实数据。供人工审阅，不构成投资建议。",
        author="fin_report selftest",
        charts_dir=out_dir / "charts",
        **kw,
    )
    primary = rep.refs.cite(
        "上海证券交易所", "示例公司 2025 年年度报告",
        tier="一手", published="2026-03-28", retrieved="2026-07-25",
        url="https://www.sse.com.cn/disclosure/listedinfo/announcement/c/600000.pdf",
    )
    secondary = rep.refs.cite(
        "示例财经媒体", "关于示例行业规模的报道",
        tier="二手", relays="示例研究院《行业追踪 2026》",
        published="2026-05-12", retrieved="2026-07-25", url="",
    )
    rep.cover(meta_lines=["自检文档 · Selftest", "检索于：2026-07-25"],
              kpis=[("259", "示例市场规模(亿美元)"), ("41%", "示例份额")])
    rep.legend()
    rep.h1("一、执行摘要")
    rep.p(f"示例市场规模 259 亿美元{rep.chip('披露')}{primary}。")
    rep.p(f"毛利率{rep.tagged('23.15%', '披露')}，环比{rep.tagged('-1.67pct', '测算')}{primary}。")
    rep.bullets([f"要点一{rep.chip('推断')}", f"要点二{secondary}"])
    rep.note("示例注释行。")
    rep.callout("核心判断", [f"判断一{primary}", f"判断二{secondary}"])
    rep.h2("1.1 图表与表格")
    rep.figure("sparse.png", "图1  示例市场规模",
               note=f"资料来源：示例数据，非真实数据。{primary}")
    rep.table(
        [["指标", "26Q1", "同比"],
         ["营业收入(亿元)", f"1,291.31{rep.chip('披露')}", f"{rep.tagged('+52.4%', '测算')}"],
         ["毛利率", f"23.15%{rep.chip('披露')}", f"{rep.tagged('-1.67pct', '测算')}"]],
        caption="表1  示例财务速览", note=f"注：示例数据。{primary}",
        col_widths=[3, 2, 2], align_center=(1, 2),
    )
    rep.sources(preamble="以下来源按正文标注序号排列。",
                disclaimer="免责声明：示例数据，不构成投资建议。")
    return rep.build()


def _docx_rewrite(src: Path, dst: Path, mutations: dict) -> Path:
    """Copy a .docx, applying a text substitution to named parts.

    Each negative case below breaks exactly one invariant this way. Rebuilding the
    package from mutated XML is the only way to test the *checker*: a defect the
    builder cannot produce still has to be caught, because a hand-assembled or
    older-script document can produce it.
    """
    with zipfile.ZipFile(src) as zin:
        parts = {name: zin.read(name) for name in zin.namelist()}
    for name, mutate in mutations.items():
        parts[name] = mutate(parts[name].decode("utf-8")).encode("utf-8")
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for name in sorted(parts):
            zout.writestr(name, parts[name])
    return dst


def _docx_failure(out_dir: Path, tag: str, mutations: dict, needle: str) -> bool:
    """True when the mutated document is rejected for the expected reason."""
    src = out_dir / "selftest.docx"
    dst = out_dir / f"probe-{tag}.docx"
    _docx_rewrite(src, dst, mutations)
    report = verify.verify_docx(dst)
    return any(needle in failure for failure in report.failures)


#: The Sources heading's own break, matched exactly — ``paragraph()`` emits
#: pPr children in schema order (pStyle → keepNext/keepLines → pageBreakBefore), and
#: a needle missing the keeps silently matches nothing. Two probes here reported a
#: working check as broken that way before the string was pinned in one place.
_BREAK_HEADING = ('<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/>'
                  "<w:keepLines/><w:pageBreakBefore/>")


def _unlink_one_marker(xml: str) -> str:
    """Unwrap one citation marker from its hyperlink, leaving the text in place.

    The document-wide "markers but no anchors" check cannot see this: the other
    markers are still linked, so only a per-marker scan catches the dead one.
    """
    match = re.search(r'<w:hyperlink w:anchor="ref\d+"[^>]*>(.*?)</w:hyperlink>', xml, re.S)
    return xml.replace(match.group(0), match.group(1), 1)


def _figure_line_rule_inherited(xml: str) -> str:
    """Drop the figure paragraph's own spacing, so it inherits the exact line grid.

    The regression this guards is precisely an *omission*: nothing was written and the
    paragraph picked up ``docDefaults``' 15.5pt ``lineRule="exact"``, which crops the
    inline image to a 15.5pt slice. Reproduced by deleting what the builder now writes.
    """
    return re.sub(r'<w:spacing w:after="60" w:line="240" w:lineRule="auto"/>', "", xml)


def _chip_to_background_fill(xml: str) -> str:
    """Repaint a chip the way the hand-rolled batch did: white text on a pale fill.

    `<w:color w:val="FFFFFF"/>` over `<w:shd w:fill="E7F3EC"/>` — observed on 132
    tags in one deliverable, and unreadable on every one of them.
    """
    # Size-agnostic: the chip size is a decision (DOCX_CHIP_PT), and pinning it here
    # made this probe fail the moment the chip was enlarged for on-screen reading.
    chip = re.search(r'<w:rPr><w:rFonts[^>]*/><w:color w:val="[0-9A-F]{6}"/>'
                     r'<w:sz w:val="\d+"/><w:szCs w:val="\d+"/>'
                     r'<w:vertAlign w:val="superscript"/>', xml)
    painted = re.sub(r'<w:color w:val="[0-9A-F]{6}"/>',
                     '<w:color w:val="FFFFFF"/>', chip.group(0))
    painted += '<w:shd w:val="clear" w:fill="E7F3EC"/>'
    return xml.replace(chip.group(0), painted, 1)


def _bookmark_before_ppr(xml: str) -> str:
    """Hoist a bookmark ahead of its paragraph's ``w:pPr``.

    ``w:pPr`` must be the first child of ``w:p``; a bookmark in front of it puts the
    paragraph out of schema and Word drops the bookmark while repairing, which is
    what made every citation in the observed batch unclickable.
    """
    match = re.search(r"<w:p>(<w:pPr>.*?</w:pPr>)(<w:bookmarkStart[^>]*/>)", xml, re.S)
    return xml.replace(match.group(0),
                       "<w:p>" + match.group(2) + match.group(1), 1)


def _append_trailing_break(xml: str) -> str:
    """Put an empty page-break paragraph at the very end of the body.

    The **last** sectPr, not the first: the first one now closes the cover's own
    zero-margin section, so injecting there produces an inner blank page and the
    document does not "end" on a break at all — which is what this probe reported
    before it was pinned to the end.
    """
    cut = xml.rfind("<w:sectPr>")
    empty = ('<w:p><w:pPr><w:pStyle w:val="Note"/><w:pageBreakBefore/>'
             "</w:pPr></w:p>")
    return xml[:cut] + empty + xml[cut:]


def _drop_first_cell(xml: str) -> str:
    """Remove one ``w:tc`` from the first row of the first table."""
    match = re.search(r"(<w:tr>(?:<w:trPr>.*?</w:trPr>)?)(<w:tc>.*?</w:tc>)", xml, re.S)
    return xml.replace(match.group(0), match.group(1), 1)


def _legend_into_section(xml: str) -> str:
    """Move the page break off the legend and onto the heading after it.

    The legend then sits *below* body content in its block, which is the defect.
    Moving the break matters: leave it on the legend and the legend simply starts a
    new block and still leads it — the first version of this probe made exactly that
    mistake and reported a working check as broken.
    """
    paragraphs = re.findall(r"<w:p>.*?</w:p>", xml, re.S)
    index = next(i for i, p in enumerate(paragraphs) if "标签口径" in p)
    legend, heading = paragraphs[index], paragraphs[index + 1]
    moved_heading = re.sub(r'(<w:pPr><w:pStyle w:val="Heading1"/>)',
                           r"\1<w:pageBreakBefore/>", heading, count=1)
    return xml.replace(legend + heading,
                       moved_heading + legend.replace("<w:pageBreakBefore/>", "", 1), 1)


def _docx_refuses(out_dir: Path, build) -> bool:
    """True when a DocxReport build raises — the refusal is the assertion."""
    try:
        build(DocxReport(out_dir / "probe-refuse.docx", "拒收用例",
                         charts_dir=out_dir / "charts"))
    except (ValueError, FileNotFoundError):
        return True
    return False


def docx_probe(out_dir: Path) -> dict[str, bool]:
    """The DOCX backend, asserted on the built package.

    Structure only where structure is the contract: bookmarks and anchors, the
    East Asian font on every CJK run, the running furniture and its PAGE field.
    Pagination is Word's, so this asserts the *honest degradation* instead — with
    no LibreOffice on the machine the verifier must say the layout was not measured
    and exit 3, because "not checked" reported as "clean" is the one outcome that
    cannot be recovered downstream.
    """
    built = _docx_build(out_dir)
    report = verify.verify_docx(built, render_dir=out_dir / "qa-docx")
    parts = verify._docx_parts(built)
    document = parts["word/document.xml"].decode("utf-8")
    rels = parts["word/_rels/document.xml.rels"].decode("utf-8")

    anchors = set(re.findall(r'w:anchor="(ref\d+)"', document))
    bookmarks = set(re.findall(r'w:bookmarkStart w:id="\d+" w:name="(ref\d+)"', document))
    cjk_runs = re.findall(r"<w:r>(.*?)</w:r>", document, re.S)
    cjk_without_font = [
        run for run in cjk_runs
        if verify.CJK.search(re.sub(r"<[^>]+>", "", run)) and "w:eastAsia" not in run
    ]

    surface = {
        name for name in dir(Report)
        if not name.startswith("_") and callable(getattr(Report, name))
    }
    docx_surface = {
        name for name in dir(DocxReport)
        if not name.startswith("_") and callable(getattr(DocxReport, name))
    }

    checks = {
        # --- the built package
        "docx: builds and passes the structural gate": report.ok,
        "docx: every [n] anchor has a bookmark": bool(anchors) and anchors <= bookmarks,
        "docx: markers equal source entries": report.markers == 2,
        "docx: the external URL is a real External relationship":
            'TargetMode="External"' in rels,
        "docx: the sourceless entry adds no hyperlink relationship":
            rels.count('TargetMode="External"') == 1,
        "docx: every CJK run names an East Asian font": not cjk_without_font,
        "docx: the image travels in the package": "word/media/image1.png" in parts,
        "docx: a PAGE field numbers the pages":
            "PAGE" in parts["word/footer1.xml"].decode("utf-8"),
        # The cover is a zero-margin section of its own — that is what makes the
        # colour block bleed to the paper edge, and it also means page 1 has no
        # furniture to suppress.
        # The cover is a section of its own with zero page margins, so the navy band
        # bleeds to the paper edge the way the PDF's does; the band is a one-cell
        # table because ``w:tcMar`` is the only thing that insets text from the *right*
        # without dragging the fill in with it. That section references no header or
        # footer, which is how page 1 carries no running furniture — no ``w:titlePg``
        # and no empty first-page pair. Word draws dashed gridlines around borderless
        # cells; the band's are hidden under the navy and the KPI strip's do not print.
        "docx: the cover is a zero-margin section with no running furniture": (
            'w:pgMar w:top="0"' in document
            and document.count("<w:sectPr>") == 2
            and "headerReference" not in document[:document.index("</w:sectPr>")]),
        "docx: the title band bleeds to the paper edge": (
            abs(sum(int(w) for w in re.findall(r'<w:gridCol w:w="(\d+)"/>',
                    document[:document.index("</w:tbl>")]))
                - theme.PAGE_W * 20) < 40),
        "docx: the KPI strip spans the text column": (
            abs(sum(int(w) for w in re.findall(
                    r'<w:gridCol w:w="(\d+)"/>',
                    document[document.index("</w:tbl>"):
                             document.index("</w:tbl>", document.index("</w:tbl>") + 1)]))
                - theme.CONTENT_W * 20) < 40),
        # An exact line height is only exact if the paragraph opts out of the
        # document grid; otherwise Word snaps it to the grid pitch.
        "docx: exact line heights opt out of the document grid": (
            document.count('<w:snapToGrid w:val="0"/>')
            == document.count('w:lineRule="exact"')),
        "docx: no table row may split across a page":
            document.count("<w:cantSplit/>") == document.count("<w:tr>"),
        "docx: Sources entries hang their wrapped lines":
            'w:hanging="440"' in parts["word/styles.xml"].decode(),
        "docx: A4 with the house margins":
            'w:w="11906" w:h="16838"' in document
            and f'w:left="{round(theme.MARGIN_L * 20)}"' in document,
        "docx: named styles ship, so the reader can edit":
            'w:styleId="Heading1"' in parts["word/styles.xml"].decode("utf-8"),
        "docx: the same calls build either format": surface == docx_surface,
        # 2026-08-27, third round: two deliverables built by this backend carried 514
        # and 534 fractional half-point sizes, zero-length bookmarks and hyperlinks
        # unlike anything Word writes; the reader reported an unclickable citation and
        # a cover that looked wrong. Each of those is now an assertion.
        "docx: every type size is a whole half-point":
            not re.search(r'w:val="\d*\.\d+"', document + parts["word/styles.xml"].decode()),
        "docx: hyperlinks carry w:history like Word's own":
            document.count('w:history="1"') == document.count("<w:hyperlink"),
        "docx: links use the Hyperlink character style":
            'w:type="character" w:styleId="Hyperlink"' in parts["word/styles.xml"].decode()
            and 'w:rStyle w:val="Hyperlink"' in document,
        "docx: no zero-length bookmark":
            not re.search(r"<w:bookmarkStart[^>]*/><w:bookmarkEnd", document),
        "docx: a newline in author text becomes a real w:br":
            "<w:br/>" in document,
        "docx: chips are legible on screen (>=7.5pt)": all(
            int(sz) >= 15 for sz in
            re.findall(r'<w:sz w:val="(\d+)"/><w:szCs[^>]*/><w:vertAlign', document)),

        # --- honest degradation, or a real layout measurement
        "docx: layout status matches whether LibreOffice exists": (
            report.status == verify.STATUS_OK if verify._soffice()
            else report.status == verify.STATUS_NO_PAGINATION
        ),
        "docx: an unmeasured layout is not exit 0": (
            verify._exit_code(report) == (0 if verify._soffice()
                                          else verify.EXIT_NO_PAGINATION)
        ),

        # --- the checker fires on a package that breaks one invariant each
        "docx: a run losing its eastAsia font fails": _docx_failure(
            out_dir, "eastasia",
            {"word/document.xml": lambda x: x.replace(' w:eastAsia="Noto Sans SC"', "")},
            "w:eastAsia"),
        "docx: an anchor with no bookmark fails": _docx_failure(
            out_dir, "dangling",
            {"word/document.xml": lambda x: re.sub(
                r'<w:bookmarkStart w:id="(\d+)" w:name="ref(\d+)"/>',
                r'<w:bookmarkStart w:id="\1" w:name="orphan\2"/>', x)},
            "resolve to no bookmark"),
        "docx: a hyperlink relationship without External fails": _docx_failure(
            out_dir, "internalmode",
            {"word/_rels/document.xml.rels":
                lambda x: x.replace(' TargetMode="External"', "")},
            'TargetMode="External"'),
        "docx: a footer with no PAGE field fails": _docx_failure(
            out_dir, "nopage",
            {"word/footer1.xml": lambda x: x.replace(' PAGE ', ' NOTAFIELD ')},
            "no PAGE field"),
        "docx: a hand-typed tag variant fails": _docx_failure(
            out_dir, "handtyped",
            {"word/document.xml": lambda x: x.replace(
                "示例注释行。", "示例注释行［媒体］。")},
            "hand-typed tag"),
        "docx: a severity icon fails": _docx_failure(
            out_dir, "icons",
            {"word/document.xml": lambda x: x.replace("示例注释行。", "🔴 示例注释行。")},
            "severity icons"),
        "docx: QA wording in the deliverable fails": _docx_failure(
            out_dir, "qaleak",
            {"word/document.xml": lambda x: x.replace(
                "示例注释行。", "未经视觉验收（已过结构检查）")},
            "build-QA wording"),
        # The legend is placed by build(), so this defect needs a hand-edited
        # package to exist at all — which is precisely the case the check is for:
        # the shared page-head check works off running-header chrome, and a DOCX
        # keeps its header in a separate part, so that check is inert here.
        "docx: a legend sitting inside a section fails": _docx_failure(
            out_dir, "legendinside",
            {"word/document.xml": _legend_into_section},
            "first thing in its block"),
        # Blank pages: the structural half of the PDF path's ink-share check, and
        # the half that survives having no LibreOffice. A break with nothing between
        # it and the next one is an empty page whatever the flow does.
        "docx: a break with nothing after it is a blank page": _docx_failure(
            out_dir, "blankpage",
            {"word/document.xml": lambda x: x.replace(
                _BREAK_HEADING,
                '<w:p><w:pPr><w:pStyle w:val="Note"/><w:pageBreakBefore/>'
                "</w:pPr></w:p>" + _BREAK_HEADING, 1)},
            "blank page"),
        "docx: a trailing break leaves an empty last page": _docx_failure(
            out_dir, "trailingbreak",
            {"word/document.xml": _append_trailing_break},
            "ends on a page break"),
        # Table geometry: Word does not shrink a table to fit, it hangs the last
        # column into the margin, so the width invariant is checked on the file.
        "docx: a table not spanning the text column fails": _docx_failure(
            out_dir, "narrowtable",
            {"word/document.xml": lambda x: re.sub(
                r'<w:gridCol w:w="\d+"/>', '<w:gridCol w:w="900"/>', x)},
            "text column"),
        "docx: a row with fewer cells than the grid fails": _docx_failure(
            out_dir, "raggedrow",
            {"word/document.xml": _drop_first_cell},
            "fewer cells"),
        # A figure paragraph inheriting the body's exact line grid: Word crops the
        # image to 15.5pt and the text lines run through the rest. 12/12 figures in one
        # shipped deliverable, and invisible in the XML because nothing was written.
        "docx: a figure paragraph on the exact line grid fails": _docx_failure(
            out_dir, "clippedfigure",
            {"word/document.xml": _figure_line_rule_inherited},
            'w:lineRule="auto"'),
        # The three defects a hand-rolled Word deliverable shipped on 2026-08-27,
        # each reproduced by breaking the built package the same way.
        "docx: a chip painted as a background fill fails": _docx_failure(
            out_dir, "chipfill",
            {"word/document.xml": _chip_to_background_fill},
            "background fill"),
        "docx: a bookmark before w:pPr fails": _docx_failure(
            out_dir, "bookmarkfirst",
            {"word/document.xml": _bookmark_before_ppr},
            "before w:pPr"),
        "docx: a reused bookmark id fails": _docx_failure(
            out_dir, "dupbookmarkid",
            {"word/document.xml": lambda x: re.sub(
                r'<w:bookmarkStart w:id="\d+"', '<w:bookmarkStart w:id="7"', x)},
            "bookmark id(s) are reused"),
        # 2026-08-27, second round: one deliverable linked its body markers and left
        # every figure/table note plain, so citations worked in the prose and died
        # under each exhibit — where a chart's only provenance lives.
        "docx: a [n] outside a hyperlink fails": _docx_failure(
            out_dir, "loosemarker",
            {"word/document.xml": _unlink_one_marker},
            "not inside a w:hyperlink"),
        "docx: a fractional type size fails": _docx_failure(
            out_dir, "fracsize",
            {"word/document.xml": lambda x: x.replace(
                '<w:sz w:val="20"/>', '<w:sz w:val="17.6"/>', 1)},
            "fractional half-point"),
        "docx: a bare-domain source URL fails": _docx_failure(
            out_dir, "baredomain",
            {"word/_rels/document.xml.rels": lambda x: re.sub(
                r'Target="https://[^"]+"', 'Target="https://www.sse.com.cn"', x)},
            "bare domain"),

        # --- the build-time refusals, which are the PDF path's own (rules.py)
        "docx: tags with no legend are refused": _docx_refuses(
            out_dir, lambda rep: (rep.p(f"毛利率{rep.tagged('23.15%', '披露')}。"),
                                  rep.build())),
        "docx: an untagged 同比 column is refused": _docx_refuses(
            out_dir, lambda rep: (rep.legend(),
                                  rep.p(f"引子{rep.chip('披露')}。"),
                                  rep.table([["项目", "同比"], ["收入", "+52.4%"]]),
                                  rep.build())),
        "docx: citing without sources() is refused": _docx_refuses(
            out_dir, lambda rep: (rep.refs.cite("交易所", "示例", published="2026-01-01",
                                                retrieved="2026-07-25", url=""),
                                  rep.build())),
        "docx: a legend on a cover-less document is refused": _docx_refuses(
            out_dir, lambda rep: rep.legend(placement="cover")),
        "docx: DocxReport refuses a .pdf path": _docx_refuses(
            out_dir, lambda rep: DocxReport(out_dir / "wrong.pdf", "x")),
        "docx: Report refuses a .docx path": _docx_refuses(
            out_dir, lambda rep: Report(out_dir / "wrong.docx", "x")),
    }
    if verify.SCHEMA_ENV in os.environ:
        checks["docx: every part validates against wml.xsd"] = not any(
            "WordprocessingML" in f for f in report.failures)
    else:
        print(f"  note {verify.SCHEMA_ENV} is unset, so no part was schema-validated "
              "— set it to ISO-29500's wml.xsd for the strongest available check "
              "that Word will open the file")
    return checks


if __name__ == "__main__":
    sys.exit(main())
