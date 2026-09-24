"""figure-plot 共享样式模块。

唯一事实源是 ../assets/publication.mplstyle；本模块只负责加载、
中文模式切换与强制导出验证。图脚本禁止再复制 rcParams 块。

图脚本标准开头：

    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path.home() / ".agents/skills/figure-plot/scripts"))
    from figstyle import load_style, save_fig

    load_style()            # 中文图：load_style(zh=True)
    # ... 绘图（每条序列带 label=，收尾 ax.legend()）...
    save_fig(fig, "fig5_convergence", outdir="figures")
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import numpy as np

_SKILL_DIR = Path(__file__).resolve().parent.parent
STYLE_FILE = _SKILL_DIR / "assets" / "publication.mplstyle"

# 中文模式回退链：Windows 宋体 → macOS 宋体-简 → Linux 开源宋体
ZH_SERIF = ["Times New Roman", "SimSun", "Songti SC", "Noto Serif CJK SC"]


def load_style(zh: bool = False):
    """加载出版样式；zh=True 时拉丁字符走 Times、中文走宋体（matplotlib>=3.6 按字形回退）。"""
    import matplotlib.pyplot as plt
    from matplotlib import rcParams

    plt.style.use(str(STYLE_FILE))
    if zh:
        # 按字形回退只在 font.family 收到显式列表时触发；经 'serif' 别名展开不生效
        # （实测会渲染成 LastResort 豆腐块），因此中文模式直接覆写 font.family。
        rcParams["font.family"] = ZH_SERIF
    return rcParams


def save_fig(
    fig, name: str, outdir="figures", check_fonts: bool = True, check_legends: bool = True
) -> Path:
    """导出 PDF 并强制验证（任一不过即报错，不产出文件）：

    1. 图例审计：同一子图内 ≥2 组视觉可分的序列必须配图例且逐组完整
       （check_legends=False 豁免，仅限单序列或全部序列已就地标注的图）。
    2. 文件存在且非空。
    3. pdffonts 可用时核对字体全部嵌入。

    返回导出文件的绝对路径——在回复中报告该路径后再交给用户。
    """
    if check_legends:
        _audit_legends(fig)
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{name}.pdf"
    fig.savefig(path)
    size = path.stat().st_size
    if size == 0:
        raise RuntimeError(f"导出失败：{path} 为空文件")
    print(f"[saved] {path.resolve()} ({size / 1024:.1f} KB)")

    if check_fonts:
        _check_embedded_fonts(path)
    return path


# ---------------------------------------------------------------------------
# 图例审计：无图例 / 图例不完整的图在导出前拦下
# ---------------------------------------------------------------------------


def _audit_legends(fig) -> None:
    """同轴 ≥2 组视觉可分的序列无图例、或图例缺 entry，即 RuntimeError。

    两阶段：先全图收集"已解释"的序列签名（带 label= 的 artist + 图例句柄，
    含代理句柄），再逐轴判定。多面板共享一个图例是合法设计——面板 B 的序列
    只要与任一已解释签名同色同款即算已解释。

    分组按（族, 颜色, 线型, marker），颜色只比 RGB（alpha 不参与分组）；
    填充（fill_between/散点面）与同色折线合并，"均值线 + 置信带"这类单序列
    图不会被误报。显式 label="_nolegend_" 的 artist 视为辅助元素（参考线、
    显著性括号等），跳过；无 label 的浅色底纹（场景分区背景带）同样跳过。
    """
    from matplotlib.container import BarContainer, ErrorbarContainer

    axes_list = list(fig.axes)
    legends = [a.get_legend() for a in axes_list if a.get_legend() is not None]
    legends += list(fig.legends)
    has_legend = bool(legends)

    # ---- 第一阶段：全图收集各轴分组与"已解释"签名 ----
    per_axes: list[tuple[int, object, dict]] = []
    explained: set[tuple] = set()

    for idx, ax in enumerate(axes_list):
        groups: dict[tuple, dict] = {}

        def _add(sig: tuple, labeled: bool, desc: str) -> None:
            g = groups.setdefault(sig, {"labeled": False, "desc": desc})
            g["labeled"] = g["labeled"] or labeled

        for ln in ax.lines:
            state = _label_state(ln)
            if state == "skip" or not _visible(ln):
                continue
            sig = _artist_sig(ln)
            if sig is None:
                continue
            labeled = state == "labeled"
            rgba = sig[1]
            ls, mk = sig[2], sig[3]
            if not labeled and _is_light(rgba):
                continue  # 无 label 的浅色线：底纹边界等装饰
            if not labeled and not ls and (not mk or mk in "+,._"):
                continue  # 无 label 的装饰性短刻度线（误差棒帽、fliers 等）
            if not labeled and _is_vref_line(ln):
                continue  # axvline 式竖参考线
            _add(sig, labeled, _desc_line(rgba, ls, mk))

        for coll in ax.collections:
            state = _label_state(coll)
            if state == "skip" or not _visible(coll):
                continue
            if type(coll).__name__ == "QuadMesh":
                continue  # pcolormesh 热力图走 colorbar，不走图例
            sig = _artist_sig(coll)
            if sig is None:
                continue
            labeled = state == "labeled"
            if not labeled and len(sig[1]) == 1 and _is_light(sig[1][0]):
                continue  # 无 label 的浅色底纹（场景分区背景带等）
            _add(sig, labeled, _desc_fill(sig[1]))

        for cont in ax.containers:
            if isinstance(cont, BarContainer):
                state = _label_state(cont)
                if state == "skip" or not cont.patches or not all(
                    _visible(p) for p in cont.patches
                ):
                    continue
                sig = _artist_sig(cont.patches[0])
                if sig is None:
                    continue
                labeled = state == "labeled"
                if not labeled and len(sig[1]) == 1 and _is_light(sig[1][0]):
                    continue
                _add(("bar", sig[1]), labeled, _desc_fill(sig[1]))
            elif isinstance(cont, ErrorbarContainer):
                state = _label_state(cont)
                data_line = cont[0]  # fmt='none' 时可能为 None
                if state == "skip" or not _visible(data_line):
                    continue
                sig = _artist_sig(data_line)
                if sig is None:
                    continue
                _add(sig, state == "labeled", _desc_line(sig[1], sig[2], sig[3]))

        # 填充与同色折线合并（均值线+置信带、散点云+趋势线属同一序列）
        line_colors = {sig[1] for sig in groups if sig[0] == "line"}
        for sig in [s for s in groups if s[0] == "fill"]:
            if len(sig[1]) == 1 and sig[1][0] in line_colors:
                merged = groups.pop(sig)
                for s2 in groups:
                    if s2[0] == "line" and s2[1] == sig[1][0]:
                        groups[s2]["labeled"] = groups[s2]["labeled"] or merged["labeled"]
                        break

        per_axes.append((idx, ax, groups))
        for sig, g in groups.items():
            if g["labeled"]:
                explained.add(sig)

    # 图例句柄签名：代理句柄（matplotlib.lines.Line2D 手造的）不在 axes 里，
    # 只能从图例本身拿
    for leg in legends:
        for h in getattr(leg, "legend_handles", None) or []:
            sig = _handle_sig(h)
            if sig is not None:
                explained.add(sig)

    # ---- 第二阶段：逐轴判定 ----
    problems: list[str] = []
    for idx, ax, groups in per_axes:
        n = len(groups)
        if n < 2:
            continue
        name = f"axes[{idx}]" + (f"「{ax.get_title()}」" if ax.get_title() else "")
        if not has_legend:
            descs = "、".join(g["desc"] for g in groups.values())
            problems.append(
                f"{name}: 检出 {n} 组视觉可分的序列（{descs}），但整图没有任何图例。"
                f"给每条序列的绘图调用加 label= 并调用 ax.legend(loc=...)；"
                f"仅当全部序列已就地直接标注时，才可用 save_fig(..., check_legends=False) 豁免"
            )
            continue
        missing = [
            g["desc"]
            for sig, g in groups.items()
            if not g["labeled"] and not any(_compatible(sig, e) for e in explained)
        ]
        if missing:
            problems.append(
                f"{name}: 图例不完整，以下序列没有 label=（任何图例都不会收录它们）："
                + "；".join(missing)
                + "。补 label= 后重新调用 ax.legend()；辅助元素显式 label=\"_nolegend_\""
            )

    if problems:
        raise RuntimeError("图例审计未通过（save_fig）:\n  - " + "\n  - ".join(problems))


def _artist_sig(art):
    """把 artist 归一成序列签名；不构成序列时返回 None。"""
    import matplotlib.lines as mlines

    if isinstance(art, mlines.Line2D):
        rgba = _rgba(art.get_color())
        if _transparent(rgba):
            return None
        return ("line", rgba[:3], _ls(art), _marker(art))
    try:
        key = _faces_key(art.get_facecolor)
        if _all_transparent(key):
            key = _faces_key(art.get_edgecolor)  # 空心散点：描边色才是身份
    except AttributeError:
        return None
    if _all_transparent(key):
        return None
    return ("fill", _rgb_only(key))


def _handle_sig(h):
    """图例句柄签名。Line2D 代理以 marker 展示序列，marker 色（面色→描边色）
    优先于线色——空心 marker 代理的线色是默认周期色，不代表序列身份。"""
    import matplotlib.lines as mlines

    if not isinstance(h, mlines.Line2D):
        return _artist_sig(h)
    mfc = _valid_rgb(h.get_markerfacecolor())
    if mfc is not None:
        return ("line", mfc, "", _marker(h))
    mec = _valid_rgb(h.get_markeredgecolor())
    if mec is not None:
        return ("line", mec, "", _marker(h))
    return _artist_sig(h)


def _valid_rgb(color):
    """解析出有效非透明 RGB；'auto'/'none'/非法色返回 None。"""
    rgba = _rgba(color)
    if len(rgba) == 4 and not _transparent(rgba):
        return rgba[:3]
    return None


def _compatible(sig_a: tuple, sig_b: tuple) -> bool:
    """两个序列签名是否指同一视觉序列：精确相等，或同为点状（散点/marker）且同色。"""
    if sig_a == sig_b:
        return True

    def _pointlike(s: tuple) -> bool:
        return s[0] == "fill" or (s[0] == "line" and s[2] == "")

    def _color(s: tuple):
        return s[1][0] if s[0] == "fill" else s[1]

    if _pointlike(sig_a) and _pointlike(sig_b):
        return _color(sig_a) == _color(sig_b)
    return False


def _label_state(art) -> str:
    """labeled=有有效 label；skip=显式 _nolegend_；unlabeled=空或自动生成的 _lineN/_childN。"""
    lbl = str(art.get_label())
    if lbl == "_nolegend_":
        return "skip"
    return "labeled" if lbl and not lbl.startswith("_") else "unlabeled"


def _visible(art) -> bool:
    if art is None or not art.get_visible():
        return False
    alpha = art.get_alpha()
    return alpha is None or alpha > 0


def _rgba(color) -> tuple:
    import matplotlib.colors as mcolors

    try:
        return tuple(round(float(v), 3) for v in mcolors.to_rgba(color))
    except (ValueError, TypeError):
        return ("unparsed", str(color))


def _transparent(rgba) -> bool:
    return len(rgba) == 4 and rgba[3] == 0


def _is_light(rgb) -> bool:
    """近白浅色（三通道均值 ≥0.85）在白底图上不可作数据序列，视为底纹装饰。"""
    return len(rgb) == 3 and sum(rgb) / 3 >= 0.85


def _ls(art) -> str:
    ls = art.get_linestyle()
    return "" if ls in ("None", "none", " ", "") else str(ls)


def _marker(art) -> str:
    m = art.get_marker()
    return "" if m in (None, "None", "none", "") else str(m)


def _is_vref_line(ln) -> bool:
    """axvline 式竖参考线：恰两个数据点且 x 恒定。"""
    try:
        xd = np.asarray(ln.get_xdata(orig=False), dtype=float)
    except (Exception, ValueError):
        return False
    return xd.size == 2 and xd[0] == xd[1]


def _faces_key(getter) -> tuple:
    try:
        fc = np.asarray(getter(), dtype=float)
    except Exception:
        return ("?",)
    if fc.size == 0:
        return ("none",)
    if fc.ndim == 1:
        fc = fc.reshape(1, -1)
    return tuple(sorted({tuple(round(float(v), 3) for v in row) for row in fc}))


def _all_transparent(key) -> bool:
    return key in ("?", ("none",)) or all(row[3] == 0 for row in key if isinstance(row, tuple))


def _rgb_only(key) -> tuple:
    """去掉 alpha 通道，只留 RGB 作为分组身份。"""
    return tuple(sorted({row[:3] for row in key if isinstance(row, tuple)}))


def _hex(rgb) -> str:
    import matplotlib.colors as mcolors

    try:
        return mcolors.to_hex(tuple(rgb[:3])).upper()
    except (ValueError, TypeError):
        return str(rgb)


def _desc_line(rgb, ls: str, mk: str) -> str:
    parts = ["折线"]
    if mk:
        parts.append(f"marker={mk}")
    if ls:
        parts.append(f"线型={ls}")
    return f"{'/'.join(parts)} 颜色 {_hex(rgb)}"


def _desc_fill(rgb_rows) -> str:
    if len(rgb_rows) == 1:
        return f"填充/散点/柱 颜色 {_hex(rgb_rows[0])}"
    return f"填充/散点/柱 共 {len(rgb_rows)} 种颜色"


def _check_embedded_fonts(pdf: Path) -> None:
    pdffonts = shutil.which("pdffonts")
    if not pdffonts:
        return
    result = subprocess.run(
        [pdffonts, str(pdf)], capture_output=True, text=True, check=False
    )
    unembedded = []
    for line in result.stdout.splitlines()[2:]:  # 跳过两行表头
        flags = re.findall(r"\b(yes|no)\b", line)
        if flags and flags[0] == "no":  # 每行第一个 yes/no 是 emb 列
            unembedded.append(line.split()[0])
    if unembedded:
        raise RuntimeError(
            f"字体未嵌入（pdf.fonttype 应为 42）: {', '.join(unembedded)}"
        )
    print("[fonts] 全部字体已嵌入 (pdffonts emb=yes)")
