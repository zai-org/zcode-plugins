"""figure-plotter 共享样式模块。

唯一事实源是 ../assets/publication.mplstyle；本模块只负责加载、
中文模式切换与强制导出验证。图脚本禁止再复制 rcParams 块。

图脚本标准开头：

    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path.home() / ".agents/skills/figure-plotter/scripts"))
    from figstyle import load_style, save_fig

    load_style()            # 中文图：load_style(zh=True)
    # ... 绘图 ...
    save_fig(fig, "fig5_convergence", outdir="figures")
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

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


def save_fig(fig, name: str, outdir="figures", check_fonts: bool = True) -> Path:
    """导出 PDF 并强制验证：文件存在且非空；pdffonts 可用时核对字体全部嵌入。

    返回导出文件的绝对路径——在回复中报告该路径后再交给用户。
    """
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
