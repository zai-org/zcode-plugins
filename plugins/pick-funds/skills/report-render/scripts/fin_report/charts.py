"""Chart helpers: consistent styling, one source-note position, auto sizing metadata.

Neither hand-built generation factored its charts into functions — all eight were
inline top-level blocks — so nothing was reusable and every convention was
re-decided per chart. The worst of it was the source note: one generation had
eight hand-tuned ``fig.text(0.5, -0.0x, ...)`` calls that only worked because of
``bbox_inches="tight"``.

What this module standardises:

* rcParams and the CJK font, once;
* ``source()`` — one in-canvas position, one size, for every chart;
* ``save()`` — writes the PNG *and* a sizing sidecar derived by introspecting the
  figure, so the PDF builder can size figures by information density without the
  chart author hand-counting bars.
"""
from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # headless; must precede pyplot

import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Rectangle, Wedge  # noqa: E402

from . import fonts, theme  # noqa: E402

META_FILE = "_chart_meta.json"
_meta: dict[str, dict] = {}
_configured = False

#: Overlap of two rendered text boxes, as a share of the **smaller** box's area.
#: Above FAIL the pair is printed on top of itself and the figure is wrong; between
#: WARN and FAIL it is a near miss worth recording but not worth failing a build
#: over. Measured on the defect that prompted this: a two-panel figure whose left
#: panel's twin-axis title 「归母净利润(亿元)」 and right panel's y-axis title
#: 「市盈率(倍)」 were drawn in the same place, ~100% overlapped, and whose bar
#: labels collided with its line labels at roughly 45%.
OVERLAP_FAIL = 0.30
OVERLAP_WARN = 0.10
#: Roles whose collision is always a defect. Axis titles, chart titles and legend
#: entries are furniture: their positions are computed, not chosen, so two of them
#: in one place means the layout is under-spaced rather than that an author made a
#: judgement call. Annotation-on-annotation is included because a data label
#: printed over another data label misreads as a single number — the same class of
#: defect as a table column starving a figure into wrapping mid-number.
_STRUCTURAL_ROLES = frozenset({"title", "axis label", "legend"})


def configure(base_size: float = theme.CHART_BASE_PT) -> None:
    """Register the CJK font and set the global chart style. Idempotent."""
    global _configured
    if _configured:
        return
    family = fonts.register_matplotlib()
    plt.rcParams.update({
        "font.family": family,
        "font.size": base_size,
        "axes.unicode_minus": False,   # or a minus sign renders as tofu
        "axes.edgecolor": theme.GREY,
        "axes.labelcolor": theme.INK,
        "text.color": theme.INK,
        "xtick.color": theme.INK,
        "ytick.color": theme.INK,
        "figure.facecolor": "white",
        "savefig.facecolor": "white",
    })
    _configured = True


def new(w: float = 7.4, h: float = 4.0, **kw):
    """A styled figure+axes: no top/right spines, y gridlines behind the data."""
    configure()
    fig, ax = plt.subplots(figsize=(w, h), **kw)
    for axes in _each(ax):
        style_axes(axes)
    return fig, ax


def _each(ax):
    """Iterate one Axes, a tuple of them, or a subplots ndarray, uniformly."""
    if hasattr(ax, "flat"):
        return list(ax.flat)
    if isinstance(ax, (list, tuple)):
        return list(ax)
    return [ax]


def style_axes(ax) -> None:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color=theme.GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def title(ax, text: str, size: float = 12) -> None:
    """Set an in-canvas chart title. Centred, navy, bold.

    Only for charts consumed on their own (a slide, a Markdown deliverable, an
    image handed to someone). A chart going into a Report gets its title from the
    PDF caption instead — setting both prints the same sentence twice, which
    ``Report.figure`` refuses. Policy: state a chart's title and its source
    exactly once each.
    """
    ax.set_title(text, fontsize=size, fontweight="bold", color=theme.NAVY, pad=10)


def source(fig, text: str, size: float = 7.2) -> None:
    """The chart's source note, in figure coordinates, inside the canvas.

    **For a standalone chart only.** A figure going into a PDF states its source
    in ``Report.figure(..., note=...)`` instead — calling both prints the
    attribution twice, once as unselectable pixels and once as real text
    (the house formatting policy).

    In figure coordinates rather than axes coordinates so it can never overlap
    the plot area, and at a positive y so it does not depend on
    ``bbox_inches="tight"`` to be visible at all.
    """
    fig.text(0.012, 0.012, text, fontsize=size, color=theme.GREY, ha="left", va="bottom")


def density(fig) -> dict:
    """Count drawn elements across all axes, to drive display sizing later.

    Introspecting the figure beats hand-fed counts: the numbers cannot drift out
    of step with the chart, and a chart edited later re-measures itself.
    """
    items = 0
    panels = 0
    for ax in fig.get_axes():
        panels += 1
        items += sum(1 for p in ax.patches if isinstance(p, Rectangle))  # bars
        items += sum(1 for p in ax.patches if isinstance(p, Wedge))      # pie slices
        for coll in ax.collections:                                      # scatter
            try:
                items += len(coll.get_offsets())
            except (AttributeError, TypeError):
                pass
        for line in ax.lines:                                            # line vertices
            try:
                items += min(len(line.get_xdata()), 24)
            except (AttributeError, TypeError):
                pass
        items += len([t for t in ax.get_xticklabels() if t.get_text()])
    return {"elements": int(items), "panels": panels}


def center_ink(fig) -> float:
    """Shift the axes so the drawn content sits centred in the canvas.

    matplotlib reserves an asymmetric margin by default: the left side carries
    the y-label and tick labels, the right side carries nothing, so the axes box
    ends around x=0.90 while the ink starts around x=0.02. The canvas is centred
    on the page and the caption above it is centred too, but the *picture* inside
    that canvas is not — measured across one batch's figures, the ink centre sat
    4.9–5.6% left of the canvas centre, i.e. 87–105px of dead white down the
    right edge and none on the left. The reader sees a chart hanging left of its
    own 图n title.

    The obvious fix — ``savefig(..., bbox_inches="tight")`` — is wrong here. It
    changes the written image's dimensions, while ``save()`` records
    ``fig_w_in`` / ``aspect_wh`` from ``fig.get_size_inches()``; the sidecar
    would then describe a canvas that was never written, and both the density
    width tiers and ``min_figure_width``'s legibility floor read those fields.
    Cropping the canvas silently corrupts figure sizing.

    So the canvas is left exactly as authored and the axes are translated inside
    it. The shift is clamped so nothing can be pushed off-canvas — a figure whose
    ink is already wider than the canvas keeps its position rather than losing an
    edge. Returns the applied shift in figure fractions (0.0 when nothing moved),
    for tests and QA.
    """
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    try:
        bbox = fig.get_tightbbox(renderer)
    except TypeError:                      # older matplotlib signatures
        bbox = fig.get_tightbbox()
    if bbox is None:
        return 0.0
    # `Figure.get_tightbbox` reports **inches**, not pixels — verified against
    # matplotlib 3.10.5, where a 6.6in canvas returned x1=5.94. Dividing by a
    # pixel width instead put the shift near +0.5 and drove every figure hard
    # against the right edge, so the unit is worth stating rather than assuming.
    width_in = float(fig.get_size_inches()[0])
    if width_in <= 0:
        return 0.0
    x0, x1 = bbox.x0 / width_in, bbox.x1 / width_in
    shift = 0.5 - (x0 + x1) / 2.0
    # Never push ink past an edge; a canvas narrower than its ink stays put.
    shift = max(min(shift, 1.0 - x1), -x0)
    if abs(shift) < 0.002:                 # under ~0.2% is not worth a redraw
        return 0.0
    for axes in fig.get_axes():
        pos = axes.get_position()
        axes.set_position([pos.x0 + shift, pos.y0, pos.width, pos.height])
    return shift


def _text_artists(fig) -> list[tuple[str, object, int]]:
    """(role, artist, axes index) for every text a reader will see.

    ``axes index`` is -1 for figure-level text. It exists so a collision between
    two *different* panels can be told from one inside a single panel: the first
    is a spacing problem the figure can fix by itself, the second is an authoring
    choice only the author can resolve.
    """
    found: list[tuple[str, object, int]] = []
    for index, ax in enumerate(fig.get_axes()):
        found.append(("title", ax.title, index))
        found.append(("axis label", ax.xaxis.label, index))
        found.append(("axis label", ax.yaxis.label, index))
        for tick in list(ax.get_xticklabels()) + list(ax.get_yticklabels()):
            found.append(("tick", tick, index))
        for text in ax.texts:
            found.append(("annotation", text, index))
        legend = ax.get_legend()
        if legend is not None:
            for text in legend.get_texts():
                found.append(("legend", text, index))
    for text in fig.texts:
        found.append(("figure text", text, -1))
    return found


def _overlap_share(a, b) -> float:
    """Intersection area as a share of the smaller box. 0.0 when disjoint.

    Share of the *smaller* box, not of the union: a short label swallowed whole by
    a long one is the worst case and would read as a small union fraction.
    """
    dx = min(a.x1, b.x1) - max(a.x0, b.x0)
    dy = min(a.y1, b.y1) - max(a.y0, b.y0)
    if dx <= 0 or dy <= 0:
        return 0.0
    smaller = min(a.width * a.height, b.width * b.height)
    return (dx * dy) / smaller if smaller > 0 else 0.0


def _coincident(text_a: str, box_a, text_b: str, box_b, tol: float = 1.0) -> bool:
    """True for the same string drawn twice in the same place.

    ``twinx`` gives the twin its own copy of the shared x-axis, so every x tick
    label exists twice at identical coordinates. Geometrically that is a 100%
    overlap on two different Axes — the exact signature of the defect this module
    is looking for — but the reader sees one label, because the two are printed
    over each other pixel for pixel. Without this the check would fail every
    dual-axis chart in the repo and be switched off within a day.

    Only *exact* coincidence is excused. A duplicate offset by more than a point
    prints as a smudge and stays a finding.
    """
    if text_a != text_b:
        return False
    return (abs(box_a.x0 - box_b.x0) <= tol and abs(box_a.y0 - box_b.y0) <= tol
            and abs(box_a.x1 - box_b.x1) <= tol and abs(box_a.y1 - box_b.y1) <= tol)


def _seg_hits_box(p0, p1, box) -> bool:
    """线段是否与文本框相交（含端点落在框内）。"""
    x0, y0 = p0
    x1, y1 = p1
    if box.x0 <= x0 <= box.x1 and box.y0 <= y0 <= box.y1:
        return True
    if box.x0 <= x1 <= box.x1 and box.y0 <= y1 <= box.y1:
        return True
    # 与四条边分别求交
    edges = (((box.x0, box.y0), (box.x1, box.y0)),
             ((box.x1, box.y0), (box.x1, box.y1)),
             ((box.x1, box.y1), (box.x0, box.y1)),
             ((box.x0, box.y1), (box.x0, box.y0)))

    def ccw(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    for e0, e1 in edges:
        d1, d2 = ccw(p0, p1, e0), ccw(p0, p1, e1)
        d3, d4 = ccw(e0, e1, p0), ccw(e0, e1, p1)
        if ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0)):
            return True
    return False


def _text_over_data(fig, renderer) -> list[dict]:
    """文字压在数据线上。

    `_collisions` 只比对**文字与文字**，所以「标注盖在曲线上」这一类从来没被查过。
    实测一张货币-信用象限轨迹图里，`DR007 = 政策利率（宽/紧分界）` 正压在那条红色
    虚线上、`2025-07 社融峰值 9.0%` 压在蓝色曲线上、中位数说明压在浅蓝曲线上 ——
    三处都通过了原有的全部检查，因为它们彼此不重叠，只是各自压在线上。

    判据是几何相交而不是像素：把每条 Line2D 的顶点变换到显示坐标，逐段测它是否
    穿过文本框。参考线（axhline/axvline）横贯整个坐标区，最容易被压中，也最该查。
    """
    # 只查**作者放置**的文字。刻度标签贴在坐标轴边缘，而参考线正好终止在那里，
    # 把它算进来会对每条 axhline/axvline 各报一次误检。
    _AUTHORED = frozenset({"annotation", "text"})
    out: list[dict] = []
    for role, artist, index in _text_artists(fig):
        if role not in _AUTHORED or index < 0:
            continue
        try:
            if not artist.get_visible():
                continue
            label = artist.get_text()
            if not label or not label.strip():
                continue
            box = artist.get_window_extent(renderer)
        except (AttributeError, ValueError, RuntimeError):
            continue
        if box.width <= 0 or box.height <= 0:
            continue
        axes = list(fig.axes)
        if index >= len(axes):
            continue
        ax = axes[index]
        for line in ax.get_lines():
            try:
                if not line.get_visible():
                    continue
                pts = line.get_xydata()
                if pts is None or len(pts) < 2:
                    continue
                disp = ax.transData.transform(pts)
            except (AttributeError, ValueError, RuntimeError):
                continue
            hit = any(_seg_hits_box(disp[i], disp[i + 1], box)
                      for i in range(len(disp) - 1))
            if hit:
                out.append({
                    "a": f"{role} {label.strip()!r}",
                    "b": f"data line {line.get_label() or '<unnamed>'!r}",
                    "overlap": 1.0, "cross_panel": False, "severity": "warn",
                })
                break
    return out


def _collisions(fig) -> list[dict]:
    """Overlapping text pairs above OVERLAP_WARN, worst first."""
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    boxes: list[tuple[str, str, int, object]] = []
    for role, artist, index in _text_artists(fig):
        try:
            if not artist.get_visible():
                continue
            label = artist.get_text()
            if not label or not label.strip():
                continue
            box = artist.get_window_extent(renderer)
        except (AttributeError, ValueError, RuntimeError):
            continue
        if box.width <= 0 or box.height <= 0:
            continue
        boxes.append((role, label.strip(), index, box))

    out: list[dict] = []
    for i in range(len(boxes)):
        role_a, text_a, ax_a, box_a = boxes[i]
        for j in range(i + 1, len(boxes)):
            role_b, text_b, ax_b, box_b = boxes[j]
            if _coincident(text_a, box_a, text_b, box_b):
                continue
            share = _overlap_share(box_a, box_b)
            if share < OVERLAP_WARN:
                continue
            structural = bool(_STRUCTURAL_ROLES & {role_a, role_b}) or (
                role_a == role_b == "annotation")
            out.append({
                "a": f"{role_a} {text_a!r}", "b": f"{role_b} {text_b!r}",
                "overlap": round(share, 3),
                "cross_panel": ax_a != ax_b and -1 not in (ax_a, ax_b),
                "severity": "fail" if (structural and share >= OVERLAP_FAIL)
                            else "warn",
            })
    out.extend(_text_over_data(fig, renderer))
    out.sort(key=lambda c: -c["overlap"])
    return out


def check_text_spacing(fig, name: str = "figure", strict: bool = True) -> list[dict]:
    """Find text drawn on top of other text; fix what the figure can fix itself.

    Nothing in this module used to look at text at all, so a figure could ship
    with two axis titles printed in the same place and every automated gate passed
    it — the PDF verifier reads the page, not the chart's internals, so it sees a
    figure of the right size holding the right amount of ink. It took a human.

    The one collision class a figure can resolve without an authoring decision is
    a panel-spacing shortfall: matplotlib reserves gutter width for the y-axis
    furniture it knows about when asked, and an author who never asked gets
    panels sized as though those labels were not there. So ``tight_layout`` is
    attempted once, and only when there is already a failure to fix — never
    speculatively, because it would move the axes of every correct chart.

    Returns the surviving pairs (for the sidecar). Raises when ``strict`` and a
    structural pair still overlaps, because a figure whose furniture is
    illegible is worse than a late build.
    """
    collisions = _collisions(fig)
    if any(c["severity"] == "fail" for c in collisions):
        try:
            fig.tight_layout()
        except (ValueError, RuntimeError, AttributeError, Warning):
            pass  # a figure tight_layout cannot handle still gets its verdict below
        collisions = _collisions(fig)

    failures = [c for c in collisions if c["severity"] == "fail"]
    if failures and strict:
        lines = [f"  - {c['a']} over {c['b']} ({c['overlap']:.0%} of the smaller"
                 + (", different panels)" if c["cross_panel"] else ")")
                 for c in failures]
        raise ValueError(
            f"{name}: text is printed on top of other text:\n" + "\n".join(lines)
            + "\n  Widen the figure, raise the gap between panels "
            "(subplots_adjust(wspace=...)), shorten an axis title, or drop one "
            "series' data labels. A twin y-axis needs gutter width on the side it "
            "sits on — a second panel placed there will land on its title. "
            "charts.save(..., allow_overlap=True) records it instead if the "
            "overlap is genuinely intended."
        )
    return collisions


def save(fig, name: str, out_dir: str | Path = "charts", dpi: int = 170,
         allow_overlap: bool = False) -> Path:

    """Write the PNG and accumulate its sizing metadata.

    Refuses a figure whose furniture is printed on top of itself — see
    ``check_text_spacing``. ``allow_overlap=True`` downgrades that to a recorded
    warning, for the rare figure where two texts genuinely share a spot.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / name
    overlaps = check_text_spacing(fig, name, strict=not allow_overlap)
    center_ink(fig)
    w_in, h_in = (float(v) for v in fig.get_size_inches())
    titled = any(ax.get_title().strip() for ax in fig.get_axes()) or bool(
        getattr(fig, "_suptitle", None) and fig._suptitle.get_text().strip()
    )
    _meta[name] = {
        "fig_w_in": round(w_in, 3),
        "fig_h_in": round(h_in, 3),
        # Named aspect_wh deliberately: the two prior generations both wrote a
        # field called "aspect" meaning OPPOSITE things (w/h in one, h/w in the
        # other), which would silently transpose every figure if merged.
        "aspect_wh": round(w_in / h_in, 4),
        # The font size actually in force when this figure was drawn. Display
        # sizing scales the whole canvas, so it scales this too — the PDF builder
        # needs it to know how small a label would become on the page, and
        # therefore how far the figure may be shrunk. Read from rcParams rather
        # than assumed, because a chart author may call configure(base_size=...).
        "base_pt": round(float(plt.rcParams["font.size"]), 2),
        # Recorded so Report.figure can refuse to print the same title twice.
        "titled": titled,
        **density(fig),
    }
    if overlaps:
        _meta[name]["text_overlaps"] = overlaps
    fig.savefig(path, dpi=dpi)
    plt.close(fig)
    return path


def write_meta(out_dir: str | Path = "charts") -> Path:
    """Flush the sidecar. Call once after the last save()."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / META_FILE
    path.write_text(json.dumps(_meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def read_meta(out_dir: str | Path = "charts") -> dict:
    """Load the sidecar, tolerating its absence — a missing sidecar degrades
    figure sizing to a default, it does not crash the build."""
    path = Path(out_dir) / META_FILE
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
